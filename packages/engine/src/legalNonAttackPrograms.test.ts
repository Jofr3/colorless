import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter, topUid } from "./cards";
import { programPlayable } from "./cardplay";
import { passivesOf } from "./continuous";
import {
  applyAction,
  createGame,
  effectiveRetreatCost,
  hasFreeRetreatAura,
  programFor,
} from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  discardFromDeck,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  specialEnergy,
  toDeckTop,
  trainerCard,
  types,
} from "./testFixtures";

// D199 — THE SECOND REGISTRY-ONLY SWEEP, and the first whose candidate list was
// DERIVED rather than inherited.
//
// ⚠️ WHY THIS TIER MATTERS OUT OF ALL PROPORTION TO ITS SIZE.
// `docs/reference/coverage-backlog-legal.md` (D187): of the **651 Standard-legal
// Ability / Trainer / Special-Energy printings**, exactly **6 were built — 0.9 %**.
// Attack text is 806-of-1,732 built because a deriver ARM is a text parser and its
// sentences transfer across sets. Abilities and Trainers have **no deriver at
// all** — each one is a hand-authored registry row, forever, keyed by card id —
// and 172 of the registry's 178 pre-D190 ids are rotated out of Standard. D190
// took that census's list of 7 candidates, built 3 and dropped 4, and exhausted
// it.
//
// THIS SLICE RE-CENSUSED THE WHOLE 651 against the remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`; 3,786 rows / 20 sets, of which 2,021
// carry `legal_standard = 1`) on 2026-08-04: every distinct sentence in
// `abilities_json` and in `effect`, grouped by text, ranked by legal printings,
// and each asked ONE question — does it map onto ops that ALREADY EXIST, with no
// new op, no new field, no new `CardFilter` kind, and no change to any engine
// file but `registry.ts`?
//
// ⚠️⚠️ **THE ANSWER IS 28 PROGRAMS / 47 PRINTINGS — 7.2 % OF THE 651 — AND THE
// OTHER ~604 ARE OP-BOUND RATHER THAN AUTHORING-BOUND.** That is the finding, and
// `DROPPED` below is worth more than `LANDED`: it names the cheapest twenty of
// them WITH THE EXACT MISSING PIECE, which is a ranked work order for the engine
// changes that unlock the next tranche. Every `DROPPED` id is asserted to still
// have NO program, so the list cannot rot into prose.
//
// 🛑 **D349 — THE "NO CHANGE TO ANY ENGINE FILE BUT `registry.ts`" CLAUSE ABOVE
// STOPPED DESCRIBING `LANDED` AT D340, AND THIS IS THE FIRST TIME ANYONE HAS
// WRITTEN THAT DOWN.** Measured, not argued: "Freezing Shroud" (D340) shipped with
// the new `EffectOp` `counterEachAll`, and both "Cursed Blast" rows (D345) shipped
// with `knockOutSelf` — all three are rows in the table below. The paragraph is a
// faithful record of what the D199 SWEEP asked of its own seven candidates; it is
// not, and has not been for nine slices, the membership rule of this table, which
// is simply *the non-attack registry programs that landed*. **RECORDED AS SPENT
// RATHER THAN REWRITTEN**: the sweep's question was real and its answer (28
// programs / 47 printings, 7.2 %) is the finding this block exists for.
//
// ⚠️ THE DOCTRINE IS D190's, UNCHANGED: *EXACT MAP OR FLAG*. A registry row has
// no deriver behind it to refuse a sentence it cannot parse — whatever is
// authored IS what the card does, forever. An unauthored Ability at least
// surfaces loudly; a wrong-but-plausible one does not.

/** The programs that LANDED, with their MEASURED legal printing counts. Every id
    was re-queried on 2026-08-04: each group returned `legal_standard = 1` on every
    id, exactly ONE distinct printed sentence, and exactly ONE card name.

    ⚠️ **THE LENGTH IS DELIBERATELY NOT WRITTEN IN THIS SENTENCE ANY MORE (D334).**
    D269 corrected it from "35" to 38 and the count rotted again within eleven
    slices — it read "41" against an array of 45 — because the ASSERTION below is
    the thing that reddens and prose is not. **A COUNT IN A COMMENT IS A COUNT THAT
    WILL BE WRONG**; the two `expect` calls at the foot of this file are the only
    honest place for one, and they are re-added from the rows rather than
    incremented. Each row's `ids` were re-queried against the remote D1 `luminous`
    on the day the row landed, by the rule this block states. */
const LANDED = [
  {
    program: "Inviting Wink (Lillie's Ribombee)",
    fixture: null,
    ids: ["sv09-067", "sv09-164", "svp-183"],
    legal: 3,
    ops: 'onEvolve trigger + optional + bottomFromOpponentHand{basicPokemon, dest bench, upTo "any"} — Mandibuzz\'s op on Arven\'s Greedent\'s trigger, at a count the card does not name',
  },
  {
    program: "Biting Spree (Team Rocket's Crobat ex)",
    fixture: "fix-bitingspree",
    ids: ["sv10-122", "sv10-217", "sv10-234", "sv10-242"],
    legal: 4,
    ops: "onEvolve trigger + damageChosen{opponentAny, 20, count 2, optional} — Hawlucha's op, retargeted",
  },
  {
    program: "Attract Customers (Tatsugiri)",
    fixture: "fix-attractcustomers",
    ids: ["svp-118", "sv06-131", "sv06-186"],
    legal: 3,
    ops: "lookAtTopN{n 6, supporter, max 1} + shuffleDeck — Pokégear 3.0 on the Ability surface",
  },
  {
    program: "Scalding Steam (Volcanion ex)",
    fixture: "fix-scaldingsteam",
    ids: ["sv09-031", "sv09-171", "sv09-182"],
    legal: 3,
    ops: "applyStatus{defender, burned} — the controller-relative arm, from an ACTIVATED Ability",
  },
  {
    program: "Sudden Shearing (Durant ex)",
    fixture: "fix-suddenshearing",
    ids: ["sv08-004", "sv08-215", "sv08-236"],
    legal: 3,
    ops: "onPlayToBench trigger + discardDeckTop{opponent, 1} — Flamigo's timing, D130's op",
  },
  {
    program: "Calming Light (Shiinotic)",
    fixture: "fix-calminglight",
    ids: ["sv08-009", "sv08-194"],
    legal: 2,
    ops: "applyStatus{defender, asleep} — Scalding Steam one StatusName over",
  },
  {
    program: "Inferno Fandango (Emboar)",
    fixture: "fix-infernofandango",
    ids: ["sv10.5w-013", "sv10.5w-098"],
    legal: 2,
    ops: "attachEnergyFrom{hand, Fire}, oncePerTurn:false — Baxcalibur's Super Cold as pure data",
  },
  {
    program: "Enhanced Hammer",
    fixture: "fix-enhancedhammer",
    ids: ["sv06-148", "sv06-224"],
    legal: 2,
    ops: "discardEnergy{opponentChosen, specialEnergy} — fix-hammer's arm with Giacomo's filter",
  },
  {
    program: "Fennel",
    fixture: "fix-fennel",
    ids: ["sv10.5b-082", "sv10.5b-162"],
    legal: 2,
    ops: "healEach 40 — Garganacl's op, NOT Picnic Basket's both-boards healEachAll",
  },
  {
    program: "Night Stretcher",
    fixture: "fix-nightstretcher",
    ids: ["sv06.5-061", "sv08-251"],
    legal: 2,
    ops: "discardPileRetrieval{pokemonOrBasicEnergy, hand, max 1} — Super Rod's filter to hand",
  },
  {
    program: "Kofu",
    fixture: "fix-kofu",
    ids: ["sv07-138", "sv07-165"],
    legal: 2,
    ops: "payFromHand{2, deckBottom, recordAs paid} + recordGate → reorderTop{2, from bottom} + drawCards 4 — Dendra at 2-for-4, plus the printed 'in any order' (D343)",
  },
  {
    program: "Maximum Belt",
    fixture: "fix-maximumbelt",
    ids: ["sv05-154", "sv08.5-117"],
    legal: 2,
    ops: "damageBonusBeforeWRIfTarget{50, ex} — Choice Belt with the suffix that has legal printings",
  },
  {
    program: "Binding Mochi",
    fixture: "fix-bindingmochi",
    ids: ["sv06.5-055", "sv08.5-095"],
    legal: 2,
    ops: "damageBonusBeforeWRIf{40, yourActivePoisoned} — Defiance Band's shape, D116's member",
  },
  {
    program: "Levincia",
    fixture: "fix-levincia",
    ids: ["sv09-150", "sv10-244"],
    legal: 2,
    ops: "stadium.ability → discardPileRetrieval{basicEnergy Lightning, hand, 2} — the first non-search Stadium ability",
  },
  {
    program: "Spiky Energy",
    fixture: "fix-spikyenergy",
    ids: ["sv09-159", "sv09-190"],
    legal: 2,
    ops: "energy{provides C, passive damageAttacker 20} — the SECOND writer of EnergyProgram.passive",
  },
  {
    program: "Sneaky Bite (Team Rocket's Golbat)",
    fixture: "fix-sneakybite",
    ids: ["sv10-121"],
    legal: 1,
    ops: "Biting Spree with count 1",
  },
  {
    program: "Defiant Horn (Hop's Dubwool)",
    fixture: "fix-defianthorn",
    ids: ["sv09-136"],
    legal: 1,
    ops: "onEvolve trigger + gust",
  },
  {
    program: "Seething Spirit (Blaziken ex)",
    fixture: "fix-seethingspirit",
    ids: ["sv09-024"],
    legal: 1,
    ops: "attachEnergyFrom{discard} — the printed card `fix-attacher` was standing in for",
  },
  {
    program: "Charging Up (Team Rocket's Spidops)",
    fixture: "fix-chargingup",
    ids: ["sv10-020", "sv10-187"],
    legal: 2,
    ops: "attachEnergyFrom{discard, toSelf} — Seething Spirit's op with D221's UID rider",
  },
  {
    program: "Dynamotor (Eelektrik)",
    fixture: "fix-dynamotor",
    ids: ["sv10.5b-031", "sv10.5b-114"],
    legal: 2,
    ops: "attachEnergyFrom{discard, energyType Lightning, benchOnly} — the same op wearing the printed brace code and zone word",
  },
  {
    program: "Assemble Alloy (Archaludon ex)",
    fixture: "fix-assemblealloy",
    ids: ["sv08-130", "sv08-224", "sv08-241"],
    legal: 3,
    ops: "onEvolve trigger + TWO attachEnergyFrom{discard, energyType Metal, targetType Metal} — D205's 'in any way you like' expansion, hand-authored to match the deriver's own",
  },
  {
    program: "Confectionary Gift (Alcremie ex)",
    fixture: "fix-confectionarygift",
    ids: ["sv09-075"],
    legal: 1,
    ops: "healChosen 30 — Potion's op on the Ability surface",
  },
  {
    program: "Insomnia (Hoothoot)",
    fixture: "fix-insomnia",
    ids: ["sv08.5-077"],
    legal: 1,
    ops: "statusImmunities ['asleep'] — Pachirisu one StatusName over",
  },
  {
    program: "Reconstitute (Team Rocket's Porygon-Z)",
    fixture: "fix-reconstitute",
    ids: ["sv10-155"],
    legal: 1,
    ops: "payFromHand{2, discard} + drawCards 1 — Trade's numbers swapped",
  },
  {
    program: "Up-Tempo (Quaquaval)",
    fixture: "fix-uptempo",
    ids: ["sv08-052"],
    legal: 1,
    ops: "payFromHand{1, deckBottom} + drawUntilHandSize 5 — the first ABILITY paying anywhere but the discard",
  },
  {
    program: "Max Rod",
    fixture: "fix-maxrod",
    ids: ["sv08.5-116"],
    legal: 1,
    ops: "discardPileRetrieval{pokemonOrBasicEnergy, hand, max 5}",
  },
  {
    program: "Miracle Headset",
    fixture: "fix-miracleheadset",
    ids: ["sv08-183"],
    legal: 1,
    ops: "discardPileRetrieval{supporter, hand, max 2}",
  },
  {
    program: "Energy Recycler",
    fixture: "fix-energyrecycler",
    ids: ["sv10-164"],
    legal: 1,
    ops: "discardPileRetrieval{basicEnergy, deck, max 5} + shuffleDeck",
  },
  {
    program: "Sacred Ash",
    fixture: "fix-sacredash",
    ids: ["sv10-168"],
    legal: 1,
    ops: "discardPileRetrieval{anyPokemon, deck, max 5} + shuffleDeck — Miriam's FIRST sentence, without its second",
  },
  {
    program: "Master Ball",
    fixture: "fix-masterball",
    ids: ["sv05-153"],
    legal: 1,
    ops: "searchDeck{anyPokemon, hand, 1} + shuffleDeck — Poké Ball without the coin gate",
  },
  {
    program: "Treasure Tracker",
    fixture: "fix-treasuretracker",
    ids: ["sv08.5-131"],
    legal: 1,
    ops: "searchDeck{toolCard, hand, 5} + shuffleDeck — Town Store's filter, to hand",
  },
  {
    program: "Dangerous Laser",
    fixture: "fix-dangerouslaser",
    ids: ["sv06.5-058"],
    legal: 1,
    ops: "applyStatus{defender, burned} + applyStatus{defender, confused} — two ops, two slots on the model",
  },
  {
    program: "Lana's Aid",
    fixture: "fix-lanasaid",
    ids: ["sv06-155", "sv06-207", "sv06-219"],
    legal: 3,
    ops: "discardPileRetrieval{anyOf[anyPokemon+noRuleBox, basicEnergy], hand, max 3} — Max Rod's program with the Pokémon half narrowed",
  },
  {
    program: "Greedy Order (Arven's Greedent)",
    fixture: "fix-greedyorder",
    ids: ["sv10-159", "sv10-205"],
    legal: 2,
    ops: "onEvolve trigger + discardPileRetrieval{byName 'Arven's Sandwich' +cardNoun, hand, max 2} — Archaludon's trigger over Night Stretcher's op",
  },
  {
    program: "Buddy-Buddy Poffin",
    fixture: "fix-buddybuddypoffin",
    ids: ["sv05-144", "sv06-223", "sv08.5-101"],
    legal: 3,
    ops: "searchDeck{basicPokemon +maxHp 70, bench, max 2} + shuffleDeck — Nest Ball's program with the printed HP threshold",
  },
  {
    program: "Gentle Fin (Alomomola)",
    fixture: "fix-gentlefin",
    ids: ["sv10.5b-024", "sv10.5b-108"],
    legal: 2,
    ops: "activated{oncePerTurn, activeOnly} + discardPileRetrieval{basicPokemon +maxHp 70, bench, max 1} — the SAME filter as the row above, on a different op and a different source zone",
  },
  {
    program: "Clemont's Quick Wit",
    fixture: "fix-clemontsquickwit",
    ids: ["sv08-167", "sv08-229", "sv08-243"],
    legal: 3,
    ops: "healEach{60, pokemonType Lightning} — Fennel's op with D266's TYPE GATE, a BOARD read of the top card's `types`",
  },
  {
    program: "Skyliner (Latias ex)",
    fixture: "fix-skyliner",
    ids: ["sv08-076", "sv08-220", "sv08-239"],
    legal: 3,
    ops: "passive noRetreatCostAura{stage 'Basic'} — Lunar Zone's aura with D267's STAGE gate instead of an energy clause",
  },
  {
    program: "Distorted Future (Gothitelle)",
    fixture: "fix-distortedfuture",
    ids: ["svp-211", "sv10.5w-043"],
    legal: 2,
    ops: "activated{oncePerTurn, activeOnly} + handRefresh{who 'opponent', fixed 3} — Judge's op with D268's THIRD `who` member: the opponent's seat ALONE",
  },
  {
    program: "Picnicker (Supporter)",
    fixture: "fix-picnicker",
    ids: ["svp-114"],
    legal: 1,
    ops: "coinFlipGate{then drawCards 4, otherwise drawCards 2} — D269's `otherwise`, and the whole card is the field",
  },
  {
    program: "Drasna (Supporter)",
    fixture: "fix-drasna",
    ids: ["sv08-173", "sv08-231"],
    legal: 2,
    ops: "coinFlipGate{then handRefresh 8, otherwise handRefresh 3} — LACEY's two-armed shape with a COIN for a condition",
  },
  {
    program: "Harlequin (Supporter)",
    fixture: "fix-harlequin",
    ids: ["sv10.5w-083", "sv10.5w-163"],
    legal: 2,
    ops: "coinFlipGate{then handRefresh who 'both' perSeat 5/3, otherwise perSeat 3/5} — D270's per-seat DRAW, and DRASNA's program with two seats",
  },
  {
    program: "Lisia's Appeal (Supporter)",
    fixture: "fix-lisiasappeal",
    ids: ["sv08-179", "sv08-234", "sv08-246"],
    legal: 3,
    ops: "gust{basicOnly} + applyStatus{defender, confused} — D330's Florges pair with the coin gate off and one adjective on, and the adjective is the op's FIRST narrowing (`gustTargets`, asked by the interpreter and by `programPlayable` alike)",
  },
  {
    program: "Drayton (Supporter)",
    fixture: "fix-drayton",
    ids: ["sv08-174", "sv08-232", "sv08-244", "sv08.5-172"],
    legal: 4,
    ops: "lookAtTopN{n 7, anyPokemon, max 1, also{trainerCard, max 1}, reveal} + shuffleDeck — Great Ball's program with a second noun, and the second noun is a PROMPT field (`chooseCards.caps`) because `validateChoice` enforces one flat total across six producers",
  },
  {
    program: "Roto-Stick (Item)",
    fixture: "fix-rotostick",
    ids: ["sv08.5-127"],
    legal: 1,
    ops: 'lookAtTopN{n 4, supporter, max "any", reveal} + shuffleDeck — Pokégear 3.0 with the cap taken off, and the cost was NOT the resolution the work order priced: D241 had already spelled this printed phrase as `max: n` under a pinned case, so the row is a REVERSAL forced by the CAPTION',
  },
  {
    program: "Bug Catching Set (Item)",
    fixture: "fix-bugcatchingset",
    ids: ["sv06-143", "sv08.5-102"],
    legal: 2,
    ops: "lookAtTopN{n 7, anyOf[typedPokemon{Grass}, basicEnergy{Grass}], max 2, reveal} + shuffleDeck — ZERO new engine code, and `anyOf`'s SECOND live prompt consumer rather than its first (Lana's Aid, D264, beat it by sixty-nine decisions). NOT `also`: \"2 in any combination\" is one flat cap over a union, where `also` is one cap per noun and would refuse the two-Pokémon take the card permits",
  },
  {
    program: "Explorer's Guidance (Supporter)",
    fixture: "fix-explorersguidance",
    ids: ["sv05-147", "sv05-200", "sv08.5-107"],
    legal: 3,
    ops: 'lookAtTopN{n 6, anyCard, max 2, exact, restTo:"discard"} and NOTHING ELSE — the FIRST row on this op with no trailing `shuffleDeck`, because its leftovers LEAVE the deck. `exact` is the printed "put 2 of them" (no "up to", no "you may"), and it cost a caption arm as well as the wire floor the price named — `lookNote` reads the same number. The leftovers make `DECK_TOP_DISCARDED` a THREE-op event with FOUR paths, and needed no renderer arm because `actor === seat` on an own-deck look. (D334 spelled the value `discardRest: true`; D335 widened the key to `restTo`.)',
  },
  {
    program: "Recon Directive (Drakloak)",
    fixture: "fix-drakloak",
    ids: ["sv06-129", "sv08.5-072"],
    legal: 2,
    ops: 'lookAtTopN{n 2, anyCard, max 1, exact, restTo:"bottom"} and NOTHING ELSE, under `oncePerTurn` / `activeOnly: false` — the leftovers DESTINATION D334 left on the resume point, and the value whose cards never leave the deck, so it rides NO event: `DECK_TOP_DISCARDED`\'s own qualifying test is "left the deck without anyone deciding about them" and `CARD_TO_BOTTOM_OF_DECK` is singular, hand-sourced and named only because the hand was publicly revealed. The printed "you may" is the ABILITY\'s decline and the take inside it is still mandatory, which is the `exact` + optional interaction nothing had exercised — and at `max: 1` the `exact` is INVISIBLE in the caption and observable only as `prompt.min`',
  },
  {
    program: "Larry's Skill (Supporter)",
    fixture: "fix-larrysskill",
    ids: ["sv08.5-115", "sv08.5-139"],
    legal: 2,
    ops: 'discardHand + searchDeck{anyPokemon, hand, max 1, reveal, also:[supporter 1, basicEnergy 1]} + shuffleDeck — the THREE-noun search, and `also` here is a LIST where the sibling op\'s is a single PAIR, because this op\'s printings spell 3 and 4. The prompt half really was free (`chooseCards.caps` is `readonly {uids;max}[]` since D332 and BOTH its readers are arity-blind), and the price\'s "buys only its own op field" was FALSE: `searchNote` took ONE filter and ONE number with NO join at all, so an unpaid caption would have read "Search your deck for up to 3 Pokémon into your hand." — the flat SUM against the FIRST group\'s noun. `discardHand` leads, because the printed "Discard your hand AND search" means the find IS the hand afterwards',
  },
  {
    program: "Secret Box (Item)",
    fixture: "fix-secretbox",
    ids: ["sv06-163"],
    legal: 1,
    ops: "payFromHand{3, discard} + searchDeck{item, hand, max 1, reveal, also:[toolCard 1, supporter 1, stadium 1]} + shuffleDeck — Ultra Ball's program with a wider middle, and the FOUR-noun arity that is the whole argument for a list rather than a second pair. The printed \"3 OTHER cards\" needs no rider, Ultra Ball's reason verbatim: `playTrainer` discards the card before the program runs. All four Trainer subtypes are mutually exclusive, so the conservative overlap rule never fires on this row",
  },
  {
    program: "Ethan's Adventure (Supporter)",
    fixture: "fix-ethansadventure",
    ids: ["sv10-165", "sv10-221", "sv10-236"],
    legal: 3,
    ops: "searchDeck{anyOf[ownerPokemon{Ethan}, basicEnergy{Fire}], hand, max 3, reveal} + shuffleDeck — ZERO new engine code, and the EXACT INVERSE of the row above it: one FLAT cap over a UNION where `also` is one cap PER NOUN. The two printed sentences are one clause apart and mean opposite things about a legal answer, so `also` is asserted ABSENT — it would refuse the three-Ethan's-Pokémon take this card explicitly permits. `anyOf`'s FIRST consumer on THIS op (Lana's Aid reads it through `discardPileRetrieval`, Bug Catching Set through `lookAtTopN`), so the combinator has now been read by three ops and gained a line for none. The price flagged the CAPTION as most likely false and it HELD — the \" or \" join is D264's established reading and this is its THIRD witness; what the slice actually cost was the FIXTURE POOL, which held no `Ethan's ` anything, and FOUR prefixed bodies then expired the owner-prefix enumeration in FOUR other files",
  },
  {
    program: "Freezing Shroud (Froslass)",
    // 🛑 NO SHARED-POOL DEMONSTRATOR, AND THAT IS A CENSUS DECISION RATHER THAN A
    // TIDINESS ONE. `freezingShroud.test.ts` drives all three real ids on a LOCAL
    // `cardPool` (D275's idiom, D338's and D339's practice), so nothing enters
    // `FIXTURE_POOL`; neither `sv06` nor `svp` is among `catalogManifest`'s six
    // sets, so a shared body would have owed a `fix-froslass` key AND reddened
    // `revealClause`'s `swept.size` — exactly what D335's `fix-drakloak`, also a
    // POKEMON and also `sv06`, had to pay. THE KEY IS THE SET, NOT THE SURFACE.
    fixture: null,
    ids: ["sv06-053", "sv06-174", "svp-117"],
    legal: 3,
    ops: "betweenTurns trigger + counterEachAll{10, abilityPokemon, exceptNamed:\"Froslass\"} — the FIRST engine diff in four slices. `healEachAll`'s COUNTER TWIN, and the printed parenthetical is the argument for the seat-blind walk: Picnic Basket prints \"each Pokemon (both yours and your opponent's)\" and this card prints the same six words. The noun reuses D285's existing `abilityPokemon` member whole and the exemption reuses D273's `exceptNamed` rider spelling verbatim, so the only NEW thing is the op. \u26a0\ufe0f THE TWO PREDICATES SUBTRACT RATHER THAN CONJOIN — a Froslass HAS an Ability, so it satisfies the noun and is removed only by the rider; an `&&` would counter every Froslass on the table. NO `activeOnly` (Garganacl's shape, not Trevenant's) and NO `doesNotStack`, so three Froslass in play place three counters",
  },
  {
    program: "Cursed Blast (Dusclops)",
    // NO SHARED-POOL DEMONSTRATOR, for D340's reason at a NEW split:
    // `cursedBlast.test.ts` drives all six real ids on a LOCAL `cardPool`, and
    // `sv08.5` is not among `catalogManifest`'s six sets while `sv06.5` IS — so
    // FOUR of these six could have gone in the shared pool and two could not.
    // **A ROW CAN BE HALF-ADMISSIBLE, WHICH IS WHY THE RULE IS PER CARD.**
    fixture: null,
    ids: ["sv06.5-019", "sv06.5-069", "sv08.5-036"],
    legal: 3,
    ops: "activated ability (oncePerTurn, no activeOnly) + damageChosen{opponentAny, 50, count 1, source ability} + knockOutSelf — the SECOND engine diff in six slices, and the op is FIELD-FREE because the clause is byte-identical across all three sentences that print it (three-column census: 9 printings / 9 legal / 3 sentences, remote D1 2026-08-15). \u26a0\ufe0f THE ORDER IS LOAD-BEARING: `damageChosen` PARKS, so the Knock Out resolves on the RESUME. \ud83d\uded1 AND THIS ROW FOUND A LIVE DEFECT rather than only a gap — `programPlayable`'s `damageChosen` arm read the opponent's BENCH LENGTH for an op whose `opponentAny` arm offers their Active. Every earlier registry producer was a Bench snipe and every `opponentAny` producer was an ATTACK, which never reaches that gate (\u00a78); this is the first registry `opponentAny` row and the first board that could see it",
  },
  {
    program: "Cursed Blast (Dusknoir)",
    fixture: null,
    ids: ["sv06.5-020", "sv06.5-070", "sv08.5-037"],
    legal: 3,
    ops: "the row above at 130 instead of 50 \u2014 a SEPARATE program object, because D199's near-twin rule is about printed SENTENCES and these are two. `cursedBlast.test.ts` \u00a71 asserts the pair is neither `toBe` nor `toEqual`, so a factory shared between them would go red there AND would show up in `censusAtHead`'s object decomposition as +1 where it must be +2",
  },
  {
    program: "Overvolt Discharge (Magneton)",
    // NO SHARED-POOL DEMONSTRATOR, D275's idiom: `overvoltDischarge.test.ts` drives
    // all three real ids on a LOCAL `cardPool` and ASSERTS, id by id, that nothing it
    // defines reached `FIXTURE_POOL`. Neither `svp` nor `sv08` is among
    // `catalogManifest`'s six sets, so a shared-pool body would have owed a `fix-*`
    // key — this row is fully INadmissible where D345's was half-admissible.
    fixture: null,
    ids: ["svp-153", "svp-159", "sv08-059"],
    legal: 3,
    ops: "activated ability (oncePerTurn, no activeOnly) + attachEnergyFrom{source discard, targetType Lightning} × THREE + knockOutSelf — **ZERO engine diff**, the first row in five slices to cost none. Ὥ1 THREE OPS AND NOT `count: 3`: `ASSEMBLE_ALLOY`'s call (D263) at a third unit, and `attachEnergyFrom.count`'s own doc — the printed *in any way you like* is N INDEPENDENT decisions that may land on N bodies, where `count` parks ONCE and pins the batch. NO `energyType`, because the printed noun is the bare *Basic Energy cards* with no brace code; `targetType` is the OTHER printed noun. `knockOutSelf` LAST, because every attach PARKS and a KO authored first would destroy a target the prompt was still offering. AND THIS ROW IS THE ONE D345 REFUSED IN ERROR — the ladder bullet below has priced it correctly since D263 (*the attach IS expressible, 3 ops, targetType Lightning*), D345 spent the one blocker that bullet named and then rewrote the residue note to claim a different one, in NINE FILES. **A RESIDUE NOTE CAN ROT BY BEING REWRITTEN, and that rot disagrees with nothing, so no re-derivation catches it**",
  },
  {
    program: "Buzzing Boost (Yanmega ex)",
    // NO SHARED-POOL DEMONSTRATOR, D275's idiom for the second slice running:
    // `buzzingBoost.test.ts` drives all three real ids on a LOCAL `cardPool` and its
    // §7 ASSERTS, id by id, that nothing it defines reached `FIXTURE_POOL`. `sv10` is
    // not among `catalogManifest`'s six sets, so a shared-pool body would have owed a
    // `fix-*` key.
    fixture: null,
    ids: ["sv10-003", "sv10-206", "sv10-228"],
    legal: 3,
    ops: "activated ability (oncePerTurn, activeOnly, playableIf yourActivePromotedThisTurn) + attachFromDeck{basicEnergy Grass, max 3, toSelf} + shuffleDeck — **ZERO engine diff, and the first row in this table whose BOTH pieces were bought by other slices for other cards**: `attachFromDeck.toSelf` is D171's (authored at `max: 1` for Pawmot, and this is its first row above one) and `BoardCondition.yourActivePromotedThisTurn` is D124's, authored for the ATTACK-column printings of the SAME clause (Revavroom ex ×2, Keldeo ex ×3, *If this Pokémon moved from your Bench to the Active Spot this turn…*). THE DESIGN CALL IS A NAMED EXCEPTION TO `playableIf`'s OWN DOC, which forbids per-body predicates because `conditionHolds` takes a seat and no uid: `activeOnly: true` GIVES the self-pronoun its referent by pinning the host to the one body the predicate reads, so the exception is the CONJUNCTION and not the predicate. D310's standing question (*the second per-body printing generalises `remainingHpAtMost`*) is therefore answered NO, and answered in that field's own doc block rather than left to be re-asked — D346's spent-note rule applied to a spent QUESTION. RECORDED LIMITATION: the print is a MOMENT and this is a GATE re-checked at use time, so a body switched back DOWN in the same turn loses the use; it REFUSES rather than affords (D222) and §6 drives it",
  },
  {
    program: "Glittering Star Pattern (Ledian)",
    // NO SHARED-POOL DEMONSTRATOR, D275's idiom for the third slice running:
    // `remainingHpWindow.test.ts` drives all three real ids on a LOCAL `cardPool`
    // and its §6 ASSERTS, id by id, that nothing it defines reached `FIXTURE_POOL`.
    // Neither `svp` nor `sv07` is among `catalogManifest`'s six sets, so a
    // shared-pool body would have owed a `fix-*` key AND joined two censuses.
    fixture: null,
    ids: ["svp-133", "sv07-003", "sv07-144"],
    legal: 3,
    ops: "onEvolve trigger + gust{remainingHpAtMost 90} — DEFIANT_HORN's two pieces with one printed relative clause on the candidate scan",
  },
  {
    program: "Bianca's Devotion",
    // NO SHARED-POOL DEMONSTRATOR — and THIS is the row where that was a decision
    // rather than a habit, because a SUPPORTER has to be played out of a hand and
    // the reflex is to pool it. `deductionKit.test.ts` (D344) is the precedent: a
    // LOCAL `cardPool` carrying the REAL id is strictly stronger, since there is no
    // second body that could drift from the one the printings resolve to.
    fixture: null,
    ids: ["sv05-142", "sv05-197", "sv05-209"],
    legal: 3,
    ops: "healChosen{amount all, remainingHpAtMost 30} — Potion's op, and the FIRST printing that forced this op a `programPlayable` line",
  },
] as const;

// 🆕 **D340 — `fixture` IS NULLABLE AS OF THIS ROW, AND THE NULL IS THE POINT.**
// Every row above names a `fix-*` body because its suite plays the card off the
// SHARED `FIXTURE_POOL`. The three slices before this one (D338, D339, D340) drove
// their real catalog ids on a LOCAL `cardPool` instead, which is what has kept
// `raw.length`'s two lines 0 apart and `swept.size` at 27 for three sessions
// running. 🛑 **D343: THE SECOND CONJUNCT IS RETIRED.** `revealClause`'s sweep
// reads `registryCardIds()` ∪ the pool now and `swept.size` is **103**; the
// LOCAL-pool idiom still keeps `raw.length`'s two lines 0 apart, and it no
// longer keeps anything out of that sweep. Spelling that as `null` rather than inventing an unused `fix-*` string
// keeps this column HONEST: it records what the suite actually seats, and a reader
// can tell the two idioms apart without opening the suite.

// ⚠️ **RIKA `sv04-172`/`-241`/`-258` IS BUILT AND IS DELIBERATELY NOT IN THE TABLE
// ABOVE** (D335). It is `lookAtTopN{n 4, anyCard, max 2, exact,
// restTo:"shuffledBottom"}`, the only printed consumer of the third leftovers
// destination — and all three of its printings are `legal_standard = 0`, so it
// cannot have a row here: every row asserts `ids.length === legal`, and this table
// is the STANDARD-LEGAL registry map by construction. Hydreigon `sv02-140`
// ("Tri Howl", `attachFromTop.restTo: "discard"` — 🆕 D352, was `discardRest`) has been
// out of it since M5 for the same
// reason. **A registry row and a LANDED row are not the same population**, which is
// the D187 distinction one table down from where it is usually made.

/** ⚠️ THE WORK ORDER. The cheapest sentences the census surfaced that this
    vocabulary CANNOT spell, each with the printings it would buy and THE EXACT
    PIECE OF ENGINE IT NEEDS. Ranked by legal printings. Every `id` is asserted
    below to still have NO program, so a later slice cannot silently half-build
    one and leave this table lying. */
const DROPPED = [
  {
    sentence: "If Festival Grounds is in play, this Pokémon may use an attack it has twice…",
    ids: ["sv06-018", "sv06-044", "sv06-089", "sv06-170", "sv08.5-010", "sv08.5-020", "sv08.5-021"],
    legal: 7,
    needs:
      "an ATTACK-AGAIN mechanism. §5.3 makes an attack end the turn unconditionally (turn.ts seeds the turn tail from attack.ts's epilogue); there is no state for 'this seat may declare a second attack', no `CardProgram` field to request one, and the printed gate is a named STADIUM in play, which no `BoardCondition` member expresses either. Two absences, and the bigger one is the turn machine.",
  },
  // ✅ D208 BUILT THIS ROW — "If this Pokémon has full HP and would be Knocked Out
  // by damage from an attack, it is not Knocked Out, and its remaining HP becomes
  // 10." (Pikachu ex "Resolute Heart" sv08-057/-219/-238/-247, sv08.5-179; Crustle
  // "Sturdy" sv10.5b-052/-130 — 7 printings, 7 Standard-legal, ONE sentence under
  // TWO Ability names). The row is REMOVED rather than annotated in place, because
  // the assertion below is what keeps this list honest and a built row would make
  // it fail — D204's and D207's precedent. `DROPPED` is now 17.
  //
  // ⚠️ THE `needs` STRING WAS HALF RIGHT AND THE WRONG HALF WAS THE PLACEMENT, which
  // is the part worth keeping. It correctly said no existing prevention fits: every
  // one of them bites INSIDE the §8.5 pipeline, before the number lands, and this
  // sentence lets the damage land. It then concluded the hook belonged on the KO
  // SWEEP (flow.ts `collectKnockOuts`), and that is exactly where it cannot go. The
  // antecedent is "has FULL HP" — a fact about the PRE-damage board — and
  // `isLethallyDamaged`, the sweep's own and only lethality test, reads
  // `pokemon.damage` AFTER the hit is already in it. By the time any sweep, any of
  // the four KO/post-KO detection sites, or `onKoPrizeGuard` runs, the datum the
  // sentence turns on has been destroyed. So it is neither a pipeline prevention nor
  // a sweep hook: it is a CLAMP AT THE DAMAGE WRITE (continuous.ts
  // `koSurvivalClamp`, called from the four sites that emit DAMAGE_DEALT), which is
  // the one place the pre-hit value is still in scope. It cost ONE `PassiveEffects`
  // flag, one shared helper and four call sites, and NO new detection site — D171
  // bought the fourth at a high price and this slice deliberately bought none.
  {
    sentence:
      "Attacks used by your Future Pokémon, except any Iron Crown ex, do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    ids: ["svp-146", "sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158"],
    legal: 6,
    needs:
      "🛑 RE-PRICED AT D330, AND THE AURA HALF IS NO LONGER TRUE. This row read 'a SEAT-WIDE pre-W/R damage AURA. `damageBonusBeforeWR` and both its gated siblings are folded by `passivesOf(attacker)` — they modify their HOLDER only. … i.e. `seatDamageReductionAfterWR`'s scan shape pointed at the bonus seam. It ALSO needs a subtype predicate (Future) and a by-name exemption… The bare version of the same shape — Attacks used by your Pokémon do 20 more damage… (sv10.5b-003/-156/-164, 3 legal) — needs only the aura, and is the cheapest entry point.' — and the aura it asks for SHIPPED AT D243 as `PassiveEffects.seatDamageBonusBeforeWR`, deliberately OUTSIDE `passivesOf`'s fold and built to `seatDamageReductionAfterWR`'s scan shape, which is what this string describes almost word for word. D245 then added BOTH riders: `beneficiary?: CardFilter` (whose attacks get the bonus) and `target?: CardFilter` (who is being hit). 🛑 AND THE 'CHEAPEST ENTRY POINT' IT NAMES IS ITSELF BUILT — `sv10.5b-003` is `REGAL_CHEER`, `{ seatDamageBonusBeforeWR: { amount: 20 } }`, pinned in `seatDamageAura.test.ts`. So a work order pointed a later slice at a row that had already been done, and nothing could redden: this table's assertion guards each row's `ids`, and the entry point lives in the PROSE. WHAT REMAINS IS TWO PIECES AND NEITHER IS AN AURA: (1) a subtype predicate for 'Future' — `beneficiary` takes a `CardFilter` and no member of that union reads a Pokémon SUBTYPE (`typedPokemon` is the ENERGY type; `ownerPokemon` is the printed name prefix); (2) the by-name exemption 'except any Iron Crown ex', which no filter negates. 🆕 A `needs` STRING THAT DESCRIBES A PIECE BY ITS SHAPE RATHER THAN BY ITS NAME ROTS SILENTLY — nobody greps for 'the scan shape pointed at the bonus seam', so D243 built exactly that and this row went on saying it was missing for 87 decisions.",
  },
  // 🛑🛑 **THE BLOOD MOON ROW LIVED HERE FROM D199 UNTIL D242, AND ITS DECLINE WAS
  // WRONG ON THE FACTS.** It read: *"an ATTACK-NAME gate on
  // `attackCostDiscountPerOpponentPrize`. … Authoring the ungated field would
  // discount the card's OTHER ATTACK too — a silent behavioural bug on a common
  // line."* The grammar half is right and is still recorded (registry.ts
  // `SEASONED_SKILL`, as a flagged assumption). **The CARD half was never checked:
  // Bloodmoon Ursaluna ex has exactly ONE attack, and it is named Blood Moon —
  // on all six printings** (`json_array_length(attacks_json) = 1`, remote D1,
  // 2026-08-06). There is no other attack for the ungated field to reach, so the
  // bug it feared is UNREACHABLE on every printing in the legal pool.
  // 🆕 **A DECLINE IS A CLAIM TOO, AND IT ROTS THE SAME WAY A COUNT DOES.** This
  // table exists so a `needs` string cannot rot into prose — and this row proves
  // the guard has to cover the REASON as well as the ids: it stayed correct-looking
  // for 43 decisions while resting on a fact about a card nobody had queried.
  // BUILT at D242; the flagged assumption and its alarm are in
  // `abilityAttackGate.test.ts`.
  // ✅ **D244 BUILT THIS ROW** — Iron Leaves ex "Rapid Vernier" (`svp-128`,
  // `sv05-025`/`-186`/`-203`/`-213`, `sv08.5-176`; 6 legal printings on one
  // sentence, backlog row 14-R). REMOVED rather than annotated in place, for the
  // reason the assertion below exists and D204/D207/D208/D242 each paid: a built
  // row would make this list fail.
  //
  // 🆕 **AND ITS `needs` STRING WAS RIGHT ON ALL THREE COUNTS — THE FIRST ROW IN
  // THIS TABLE TO SURVIVE BEING BUILT WITHOUT A CORRECTION.** It asked for (1) a
  // switch naming the body the trigger fired on, (2) `moveEnergy` off its
  // single-source coupling, (3) a destination pinned to the source uid. What
  // shipped is exactly that: `switchActive.fromSource`, `anySource` at its second
  // route, and `moveEnergy.route: "othersToSelf"` resolving BOTH ends through
  // `sourceRef`. The one thing it did not price is the fourth piece — "any
  // amount" needed `max: number | "any"` — and a fourth piece it never claimed to
  // enumerate is not the same defect as the three previous rows' wrong ones.
  // ⚠️ **THE CONTRAST WORTH KEEPING IS WITH THE BLOOD MOON ROW ABOVE**: that one
  // was wrong about a CARD, this one was right about the CODE, and both were
  // written by the same pass. **A `needs` string is a claim about the engine and a
  // decline is a claim about the card, and they rot independently.**
  //
  // ⚠️ **IT ALSO UNDER-COUNTED ITS OWN FAMILY, WHICH THIS TABLE CANNOT SEE.** The
  // ids are the row's; the op field ships SEVEN legal printings because
  // Meowscarada `sv09-018` prints the same pronoun clause as an ACTIVATED Ability.
  // This table is keyed by SENTENCE, so a sibling sentence is invisible to it —
  // `censusAtHead.test.ts`'s `BENCH_SWITCH_FAMILY` is where that is driven.
  // ✅ D251 BUILT THIS ROW — Cornerstone Mask Ogerpon ex "Cornerstone Stance"
  // (`sv06-112`/`-199`/`-215`, `sv08.5-058`/`-160`, 5 legal printings on ONE
  // sentence). REMOVED rather than annotated in place, D204's precedent: the
  // assertion below is what keeps this list honest and a built row would fail it.
  //
  // 🆕 **AND ITS `needs` STRING WAS RIGHT ON EVERY COUNT INCLUDING THE FIELD NAME
  // — THE SECOND ROW IN THIS TABLE TO SURVIVE BEING BUILT WITHOUT A CORRECTION,
  // AND THE FIRST TO BE RIGHT ABOUT A NUMBER THE SESSION HANDOFF GOT WRONG.** It
  // asked for (1) a `preventDamageFromHasAbility` sibling of
  // `preventDamageFromType` — shipped under that exact name, (2) "resolved at the
  // FOUR read sites" — there are four (attack.ts's main hit, interpreter.ts's
  // spread, `deals` and snipe arms) and the handoff that sent the slice here
  // predicted ONE, (3) "the attacker's card has a non-empty `abilities`" — that is
  // `cards.ts hasPrintedAbility` verbatim, and (4) Tier 2 for being a new field.
  // ⚠️ **THE TRANSFERABLE PART IS THE PRECEDENCE ORDER.** A row's own prescribed
  // REMEDY is written against the code by whoever last read the code; a handoff's
  // price is written against a memory of it. When the two disagree, READ THE ROW.
  // ✅ D204 BUILT THIS ROW — Iono's Bellibolt ex "Electric Streamer" (svp-194,
  // sv09-053/-172/-183/-188, 5 legal printings), the item this list called **THE
  // SINGLE HIGHEST-VALUE MISSING PIECE IN THE WHOLE CENSUS**. It needed TWO
  // slices, not one, and the split is the interesting part: D200 landed the CARD
  // predicate (`CardFilter.ownerPokemon`) and could not reach this sentence with
  // it, because no op took a predicate for an IN-PLAY TARGET; D204 added the
  // rider (`AttachTargetRiders.ownerPokemon`) that does. The row is REMOVED
  // rather than left with a note, because the assertion below is what keeps this
  // list honest and a built row would make it fail. `DROPPED` is now 19.
  // ✅ **D327 BUILT THIS ROW** — "Food Prep": Crabominable `svp-134`/`sv07-042`/
  // `-149` AND **Veluza `sv07-045`**, 4 legal printings on ONE byte-identical
  // `abilities_json`. REMOVED rather than annotated in place, D204's precedent and
  // the assertion below is what makes that the only honest option. `DROPPED` is now 4.
  //
  // 🛑 **ITS `needs` STRING WAS RIGHT ABOUT THE OBSTACLE, RIGHT ABOUT THE RULE IT
  // CITED, AND DELIBERATELY UNDECIDED ABOUT THE ROAD — THE FIRST ROW IN THIS TABLE
  // TO LEAVE A FORK OPEN AND HAVE BOTH PRONGS STILL BE LIVE WHEN IT WAS BUILT.**
  // It priced the row at *"a second field or a parameterised one"* and named D162's
  // rule for why. The slice took the FIRST prong —
  // `attackCostDiscountPerNamedInDiscard: { name, amount }` — and the reason is one
  // this row could not have known: `attackCostDiscountPerOpponentPrize` is read by
  // THREE test files by name, and retyping it to `{ amount, scale }` would have
  // bought this sentence nothing while making every existing reader carry a
  // discriminant it never branches on (D135, from the other end). **A `needs`
  // string that names a fork is worth more than one that names a road**, because
  // the road is chosen against the code as it stands on the day, and this row's
  // fork was still exactly the live choice 165 decisions later.
  //
  // ⚠️ **AND IT UNDER-COUNTED ITS OWN FAMILY IN A WAY THIS TABLE STRUCTURALLY
  // CANNOT SEE — the same blindness the Rapid Vernier row above records, at the
  // other end.** This table is keyed by SENTENCE. The ORTHOGONAL width (`%less for
  // each%`, 12 legal, remote D1 `luminous` 2026-08-11) returns 6 built Bloodmoon
  // Ursaluna ex + these 4 + **Incineroar ex `sv05-034`/`sv05-187` "Hustle Play"**,
  // a sibling sentence on the SAME seam that was in no row of this table, no
  // `needs` string and no session log — `git grep sv05-034 -- packages/` returned
  // NOTHING AT ALL. It shipped in the same slice, and the whole `%less for each%`
  // cost family is now 12 of 12 with an EMPTY residue.
  // ✅ D249 BUILT THIS ROW — Hydrapple ex "Ripening Charge" (sv07-014/-156/-167,
  // sv08.5-011, 4 legal printings). REMOVED rather than annotated in place: D204's
  // precedent, and the assertion below is what makes that the only honest option.
  //
  // 🛑 AND ITS `needs` WAS RIGHT ABOUT THE OBSTACLE AND WRONG ABOUT THE ROAD —
  // A FOURTH FAILURE MODE FOR A `needs` STRING, after the wrong CARD (Blood Moon),
  // the ALREADY-BUILT piece (Lacey) and the piece built at a COARSER GRAIN
  // (Metallic Signal). It priced the sentence at "`attachEnergyFrom.recordAs` AND
  // a heal that reads the recorded TARGET", and the shipped program carries
  // NEITHER: it is ONE op, `attachEnergyFrom { source:"hand", energyType:"Grass",
  // healTarget: 30 }`, with no record and no gate. The observation the string was
  // built on is exactly true — `EffectRecord` files card uids, not board refs, so
  // a §9.2 gate genuinely cannot reach "that Pokémon" — but D236 had already drawn
  // the opposite conclusion from the same fact and put the heal ON the op, as a
  // rider applied to the `ref` the op already holds. 🆕 **AN OBSTACLE THAT IS
  // REAL DOES NOT MAKE THE ROAD AROUND IT THE ONLY ONE, AND A `needs` STRING
  // RECORDS THE ROAD.** `DROPPED` is now 13. See `ripeningCharge.test.ts`.
  // ✅ D259 BUILT THIS ROW — Fraxure `sv06.5-045`/`-077` and Cetitan ex
  // `sv10-065`/`-210` (4 legal printings), together with Rhyperior `sv07-076`
  // "Wide Wall" (1 more, the Supporter-only seat spelling). REMOVED rather than
  // annotated in place, D204's precedent, because the assertion below is what
  // keeps this list honest and a built row would make it fail.
  //
  // ⚠️ AND THIS ROW'S `needs` WAS WRONG IN ITS LOAD-BEARING CLAUSE, WHICH IS THE
  // PART WORTH KEEPING. It priced the sentence at "a read site PER TARGETING OP,
  // which is why it is expensive and not a field" — and the shipped slice is ONE
  // field, ONE scan and **TWO** read sites, because it did not add gates: it
  // WIDENED the one funnel every effect op has consulted since D142
  // (`attackEffectRefused`, renamed `effectRefused`). `applyStatus` was already on
  // it and cost ZERO lines; only `gust` and `discardEnergy`'s candidate scan
  // needed anything, and both took a filter rather than a guard.
  //
  // 🆕 **A `needs` STRING THAT SAYS "PER OP" IS A CLAIM ABOUT WHETHER A FUNNEL
  // EXISTS, AND THAT IS A GREP AND NOT AN INTUITION.** The string was written
  // before D142's funnel had eight callers; nobody re-read it afterwards. Two rows
  // in a row have now been mispriced in the same direction (D258's `DROPPED` audit
  // found the last), so: before trusting a `needs`, grep for the funnel it assumes
  // is absent. `DROPPED` is now 10.
  // ✅ D207 BUILT THIS ROW — Lacey (sv07-139/-166/-172, sv08.5-114/-175, 5 legal
  // printings), together with Emcee's Hype (sv10-163/-220, 2 more). D204's
  // precedent: REMOVED rather than annotated in place, because the assertion
  // below is what keeps this list honest and a built row would make it fail.
  //
  // ⚠️ AND THIS ROW'S `needs` WAS WRONG WHEN IT WAS WRITTEN, WHICH IS THE
  // INTERESTING PART. It priced the sentence at "ONE new union member" and named
  // only `morePrizesThanOpponent` as the member that could not carry it. The
  // member it was asking for — `BoardCondition.opponentPrizesRemaining
  // { counts }` — was ALREADY IN THE UNION at D199's own commit (`git show
  // 21623b5:packages/engine/src/effects.ts`) and already folded by
  // `conditionHolds`, having landed with the M5 board-condition slice for
  // Krokorok's and Houndstone's damage bonuses. The rest of the row was exact:
  // the shape really is two `handRefresh` ops with exactly one running, which is
  // Grusha's `otherwise` arm. So the cost was not one union member and two
  // registry rows — it was two registry rows, and seven Standard-legal printings
  // waited on a sentence in a `needs` string. `DROPPED` is now 18.
  // ✅ D245 BUILT THIS ROW — Genesect ex "Metallic Signal" (sv10.5b-067/-161/-169,
  // 3 legal printings). REMOVED rather than annotated in place (D204's precedent,
  // and the assertion below is what makes that the only honest option).
  //
  // 🛑 AND ITS `needs` WAS RIGHT, SATISFIED SEVEN DECISIONS AGO, AND STILL DID NOT
  // UNBLOCK THE CARD — WHICH IS A THIRD FAILURE MODE FOR A `needs` STRING. It
  // asked for "a POKÉMON-TYPE refinement on the Pokémon `CardFilter` kinds". That
  // is `typedPokemon`, and it landed at **D238**. What D238 shipped was the TYPE
  // axis plus a `stage` rider whose ONLY value was `"basic"` — and this sentence
  // needs `"evolution"`, so the row's named piece arrived, nothing went red, and
  // three printings went on waiting. 🆕 **A `needs` STRING NAMES A PIECE AT SOME
  // GRAIN, AND IT GOES STALE IN SILENCE WHEN THE PIECE IS BUILT AT A COARSER ONE.**
  // Lacey (above) named a piece that already existed; this one named a piece that
  // was then built and was still not enough. Both are invisible to this
  // assertion, which only ever fires in the other direction. **The cheap check the
  // list still does not have: when a slice lands a piece, grep `needs` for its
  // NAME.** D238's own resume point would have found these three.
  //
  // ⚠️ ITS OTHER CLAUSE WAS FALSE TOO: "it also unlocks Hyper Aroma's stage
  // refinement's neighbours" — Hyper Aroma is a Trainer whose filter is a plain
  // `basicPokemon`, and no neighbour of it was ever waiting on a type. `DROPPED`
  // is now 14.
  // ✅ D255 BUILT THIS ROW — "Prevent all damage done to this Pokémon by attacks
  // from your opponent's Pokémon ex." (Sylveon sv08.5-040, Crustle sv10-012/-186,
  // 3 legal printings). REMOVED rather than annotated in place, D245's precedent
  // above and D204's before it. `DROPPED` is now 13.
  //
  // ✅ **AND THIS IS THE FIRST `needs` STRING ON THIS LIST THAT WAS RIGHT, STAYED
  // RIGHT, AND WAS BUILT AS WRITTEN** — worth the lines precisely because the two
  // rows above it are the catalogue of the opposite. It said: an ex-ONLY gate;
  // `preventDamageFromExV` is `isExOrV` (ex OR V) and Mimikyu really does print
  // both, so authoring the existing flag would prevent damage from a Pokémon V the
  // card does not mention; the difference is unobservable in a legal game (no
  // Pokémon V is Standard-legal) and observable in THIS engine, whose fixture pool
  // has three; the fix is a `targetSuffix`-style parameter. D255 built exactly
  // that — `cards.ts PreventedAttackerClass`, a record whose `suffix` is compared
  // for EQUALITY against `pokemonSuffixOf` — and `preventedAttackerClass.test.ts`
  // drives the Pokémon-V board the string predicted would be the only witness.
  //
  // 🆕 **A `needs` STRING SURVIVES WHEN IT NAMES THE PRINTED DIFFERENCE RATHER
  // THAN THE PIECE THAT WOULD CLOSE IT.** Lacey's named a piece that already
  // existed; Genesect's named one that was later built at the wrong grain; this
  // one named the CLAUSE ("ex alone, not ex or V") and stayed true through four
  // engine versions, because a printed clause cannot be built at a coarser grain.
  //
  // ⚠️ D255 ALSO BUILT THE ROW'S 2-PRINTING NEIGHBOUR — "…from your opponent's
  // **Basic** Pokémon ex" (Farigiraf ex sv05-108/-194) — which was never on this
  // list at all, only in `censusAtHead.test.ts`'s row-15 unbuilt set. It cost one
  // registry object on top of this row, because the record has a `stage` key.
  // ✅ D267 BUILT THE LATIAS ex ROW — "Your Basic Pokémon in play have no Retreat
  //    Cost." (sv08-076/-220/-239, 3 legal). REMOVED rather than annotated in
  //    place, D204's precedent: the assertion below is what keeps this list honest
  //    and a built row would make it fail. `DROPPED` is now 6.
  //
  //    ⚠️ **ITS `needs` STRING WAS RIGHT ON EVERY COUNT — the second in a row, and
  //    the second written by a slice that had MEASURED the row rather than
  //    inherited the claim.** It read:
  //
  //      needs: "a STAGE refinement on `noRetreatCostAura`. The field carries
  //        `requiresEnergyType` only; this printing gates on Basic-ness instead.
  //        One optional field beside the existing one, and the read site
  //        (`hasFreeRetreatAura`) already has the Pokémon."
  //
  //    Every clause held: one optional field (`stage?: "Basic"`), placed beside
  //    `requiresEnergyType` rather than replacing it; `hasFreeRetreatAura` is the
  //    SOLE read site and it did already take the `InPlayPokemon`. 🆕 **WHAT IT DID
  //    NOT SAY IS WHICH END OF THE SCAN THE CONJUNCT BELONGS TO** — that loop holds
  //    a HOLDER card (`top`) and a TARGET body (`pokemon`) at the same moment, and
  //    the printed noun phrase is about the TARGET. A string can name the right
  //    function and still leave the only decision in it open; the answer came from
  //    READING the signature, which is what "already has the Pokémon" was pointing
  //    at without saying.
  // ✅ **D331 BUILT THIS ROW** — Lisia's Appeal `sv08-179`/`-234`/`-246`
  // (Supporter, 3 Standard-legal printings and the WHOLE population of the
  // sentence). REMOVED rather than annotated in place, D204's precedent and every
  // precedent since: the assertion below is what keeps this list honest, and a
  // built row would make it fail. `DROPPED` is now 3.
  //
  // 🛑 **AND ITS `needs` STRING NAMED THE RIGHT PIECE WHILE BEING WRONG ABOUT WHO
  // ELSE READ IT — A ROT MODE THIS TABLE HAD NOT YET RECORDED.** The row, re-priced
  // at D329 and re-confirmed at D330, ended: *"WHAT REMAINS IS ONE PIECE: a Basic
  // rider on `gust`'s candidate scan (`oppBenchRefs`, **shared with that refusal, so
  // the whiff arm follows for free**)"*. The piece is exactly right — `gust`'s scan
  // genuinely carried no stage rider, and `recordAs` genuinely was not needed. **The
  // SHARING was invented.** `programPlayable` refused a gust by reading
  // `state.players[otherSeat(seat)].bench.length === 0` — a raw bench LENGTH that
  // never touched `oppBenchRefs`, shares nothing with the scan, and cannot see a
  // rider. Ridden scan alone, the card would have been PLAYABLE into a Bench of pure
  // Evolutions: §7.2's one Supporter spent on a prompt with zero candidates.
  //
  // ⚠️ **SO THE ROW COST TWO PIECES AGAINST A PRICE OF ONE**: `gust.basicOnly` AND
  // `gustTargets`, the sole funnel both readers now ask. That is D206's finding one
  // op over, arriving eleven decisions late — D206 replaced this exact shape on
  // `switchActive` and left the mirror op alone, because no printing had yet
  // narrowed a gust. **A LENGTH TEST IS A CANDIDATE SCAN ONLY WHILE NOTHING NARROWS
  // THE SET.**
  //
  // 🆕 **THE TRANSFERABLE LESSON, AND IT IS SHARPER THAN "THE PRICE WAS WRONG".**
  // Every earlier rot mode here was about the PIECE — wrong card (Blood Moon), piece
  // already shipped (the Future aura), wrong grain, wrong vocabulary. This one names
  // the piece correctly and then asserts a SHARING that does not exist. D328's rule
  // was *"when a slice makes a number movable, ask what else reads it"*; this is its
  // exact instance, and the answer was TWO readers where the handoff assumed one.
  // **GREP THE READERS OF THE THING YOU ARE ABOUT TO NARROW BEFORE BELIEVING
  // ANYTHING DOWNSTREAM IS FREE** — a `needs` string can be right about the noun and
  // wrong about the verb. See `lisiasAppeal.test.ts`.
  // ✅ D266 BUILT CLEMONT'S QUICK WIT'S ROW — "Heal 60 damage from each of your
  //    {L} Pokémon." (sv08-167 / sv08-229 / sv08-243, legal 3). Its `needs`
  //    string is re-homed here rather than deleted, because grading it is the
  //    result:
  //
  //      needs: "a TYPE gate on `healEach`. The op heals every one of the
  //       controller's Pokémon unconditionally; this sentence heals a typed
  //       subset. `Card.types` is the datum and the op already has the seat, so
  //       it is one optional field — but it is a field, and Fennel (built above)
  //       is the ungated printing that shows the op is otherwise right."
  //
  //    ⚠️ **IT WAS RIGHT IN FULL, AND IT IS THE SECOND CONSECUTIVE ONE** — the
  //    field really was absent (re-read against `effects.ts` and `interpreter.ts`
  //    before a line was written, which is D263's and D264's lesson each found
  //    twice), `Card.types` really is the datum, Fennel really is the ungated
  //    control, and the whole cost really was ONE optional field plus ONE
  //    conjunct inside the existing loop. 🆕 **BUT THE STRING NAMED THE DATUM
  //    WITHOUT NAMING THE ZONE.** "`Card.types` is the datum" is true of a CARD
  //    read and of a BOARD read alike, and the two want different instruments:
  //    `CardFilter.typedPokemon` already exists and is the WRONG one here,
  //    because this gate walks IN-PLAY bodies and must read the TOP card of a
  //    stack. A work order that names a FIELD still under-specifies the READ.
  // ✅ **D332 BUILT THIS ROW** — Drayton `sv08-174`/`sv08-232`/`sv08-244`/
  // `sv08.5-172` (Supporter, 4 Standard-legal printings and the WHOLE population
  // of the sentence). REMOVED rather than annotated in place, D204's precedent and
  // every precedent since: the assertion below is what keeps this list honest, and
  // a built row would make it fail. `DROPPED` is now 2.
  //
  // 🛑 **AND ITS `needs` STRING NAMED THE RIGHT OP, THE RIGHT WINDOW AND THE WRONG
  // HALF OF THE COST — A THIRD ROT MODE, AFTER D330's AND D331's.** The row read:
  // *"TWO filters on one `lookAtTopN` window. The op takes one `filter` and one
  // `max`; this sentence takes one of each of two kinds out of a SHARED window,
  // which two sequential ops cannot express (the second would re-look at a window
  // the first did not consume)."* — and the resume point that carried it added
  // *"One op field or a second `max`."*
  //
  // ✅ **THE FIRST CLAUSE IS TRUE**, and reading the park makes it sharper than the
  // row did: `top` is `deck.slice(0, op.n)` recomputed at every op, so a second
  // `lookAtTopN` sees a card that slid INTO the window behind the first take. The
  // obvious repair — a second op at `n - 1` — is right on the take-one path and
  // WRONG on the DECLINE this printed *"you may"* permits, where index 6 goes
  // unreachable.
  //
  // 🛑 **"ONE OP FIELD OR A SECOND `max`" IS THE FALSE HALF, AND IT IS FALSE IN
  // EXACTLY THE CLAUSE THAT MADE THE ROW LOOK CHEAP.** `lookAtTopN.max` is
  // forwarded straight into `prompt.max`, and `validateChoice` (cardplay.ts)
  // enforces ONE FLAT TOTAL shared by all six `chooseCards` producers — so a second
  // `max` on the OP is invisible to the only thing that checks a wire answer, and
  // under a total of 2 a client takes TWO Pokémon. The cap had to reach the PROMPT,
  // and the prompt has a wire tail (`redact.ts`, the zod schema, `projection.ts`,
  // the dialog).
  //
  // 🛑 **AND THE PIECE THE ROW TREATED AS THE OBSTACLE WAS FREE ALL ALONG.**
  // `{ kind: "anyOf" }` has been in `CardFilter` since D245 and produces exactly
  // this candidate set. It is still not used, and why is the second finding:
  // `retrieveNoun`'s `anyOf` arm is documented UNREACHABLE FROM ANY PROMPT and
  // joins its members with **" or "** — deliberately — so Drayton would have given
  // a green-and-dead member its first live caption saying the opposite of the card.
  // **D330's shape, one arm over, and it would have arrived as a REGRESSION rather
  // than as an absence.**
  //
  // 🆕 **THE TRANSFERABLE LESSON, AND IT COMPLETES A SET.** D330's row named a
  // piece that had already SHIPPED. D331's named its piece correctly and invented
  // a SHARING. This one names the piece correctly, names the obstacle, and gets
  // WHICH END of the obstacle is hard exactly backwards. **A `needs` STRING CAN BE
  // RIGHT ABOUT WHAT IS HARD AND WRONG ABOUT WHICH PART OF IT IS HARD** — and the
  // way to tell, every time, is to read the thing that CHECKS the answer rather
  // than the thing that OFFERS it. See `draytonWindow.test.ts`.
  // ✅ D268 BUILT GOTHITELLE'S "DISTORTED FUTURE" ROW — "Once during your turn, if
  //    this Pokémon is in the Active Spot, you may have your opponent shuffle
  //    their hand into their deck and draw 3 cards." (`svp-211`/`sv10.5w-043`,
  //    legal 2). REMOVED rather than annotated in place, because the assertion
  //    below is what keeps this list honest and a built row would make it fail.
  //    `DROPPED` is now 5. Its `needs` string is re-homed here rather than
  //    deleted, because GRADING it is the result:
  //
  //      needs: "`handRefresh.who: 'opponent'`. The union is `'you' | 'both'` —
  //       the OPPONENT-only arm is the one reading nothing prints in the sv01–03
  //       pool and two cards print here. A one-member widening with a real read
  //       site behind it already (Iono/Judge drive `both`)."
  //
  //    ✅ **THE MECHANICAL HALF WAS RIGHT IN FULL, AND IT IS THE THIRD
  //    CONSECUTIVE `needs` STRING THAT WAS** — the union really was `'you' |
  //    'both'` (re-read against `effects.ts` and `interpreter.ts` before a line
  //    was written), the third member really was absent under any spelling, the
  //    read site really is ONE expression (`interpreter.ts`'s `const seats:
  //    Seat[] = …`), and the whole engine diff really was that one expression
  //    plus the union member. `activeOnly` and `oncePerTurn` were already on the
  //    Ability surface, exactly as the row's neighbours claimed.
  //    🆕 **BUT ITS PARENTHETICAL NAMED A READ SITE THAT IS NOT STANDARD-LEGAL,
  //    AND THE LEGALITY CLAIM IS NOT THE SAME CLAIM AS THE CODE CLAIM.** "Iono/
  //    Judge drive `both`" is true of the REGISTRY and false of the FORMAT: every
  //    Iono, Judge, Youngster and Brassius printing in the catalog is
  //    `legal_standard = 0` (measured 2026-08-07), so the sentence that
  //    exercises the `both` arm today is not a legal one at all. The arm is still
  //    live and still driven — by `handRefresh.test.ts`, off registry ids — but a
  //    work order that prices a widening by "there is already a read site" must
  //    say WHICH POOL the read site lives in. **A REGISTRY PRECEDENT AND A LEGAL
  //    PRECEDENT ARE DIFFERENT FACTS.**
  //    🆕 **AND THE WIDER CENSUS FOUND THE VARIANT THIS ROW MUST NOT COVER, ON
  //    THE SAME NOUN.** `%hand into%deck%` at `legal_standard = 1` over all three
  //    text columns returns **16 printings on 8 sentences** (bare noun `%shuffle%`
  //    = 281): this row (2); Lacey (5, `who: "you"`, BUILT); Drasna (2, `"you"` +
  //    a coin-gated draw); Victini "Flippity Flap" (1, an ATTACK); Mr. Mime
  //    "Mimic" (1, a draw counted off the OPPONENT's hand size); and then the
  //    three that look like this op and are NOT it — Unfair Stamp (1), Team
  //    Rocket's Archer (2) and Harlequin (2), all "Each player shuffles their
  //    hand into their deck" with an ASYMMETRIC draw ("you draw 5 cards, and your
  //    opponent draws 2/3"). `HandRefreshDraw` is ONE value for EVERY affected
  //    seat, so those 5 printings need a PER-SEAT draw and no `who` member of any
  //    spelling reaches them. **The residue on this noun is 5 legal printings on
  //    3 sentences, and it is a different widening on a different field.**
  //    🆕 **D270 BUILT THAT FIELD AND TOOK 2 OF THE 5** — `HandRefreshDraw.perSeat`,
  //    Harlequin `sv10.5w-083`/`-163`, a LANDED row above. The `needs` string was
  //    RIGHT about the field and RIGHT about the count it could reach: the other 3
  //    (Unfair Stamp 1, Team Rocket's Archer 2) are held back by their PLAY GATE
  //    and not by their draw — *"only if any of your Pokémon were Knocked Out
  //    during your opponent's last turn"*, a datum `GameState` does not carry
  //    (grepped at D270). **The residue on this noun is now 3 legal printings on 2
  //    sentences, and what they wait on is a STATE field, not another draw kind.**
  // 🛑 D263 RE-HOMED ONE ROW OUT OF THIS TABLE AND IT IS THE SLICE'S SHARPEST
  //    FINDING, SO IT IS RECORDED HERE RATHER THAN DELETED WITH IT. The entry
  //    read:
  //
  //      "Once during your turn, you may attach a Basic Energy card from your
  //       discard pile to this Pokémon."  (sv10-020, sv10-187, legal 2)
  //      needs: "`attachEnergyFrom`'s SELF target — D190's Teal Dance finding,
  //       printed a second time on the DISCARD source. … the gap is exactly one
  //       field wide."
  //
  //    ⚠️ **THE `needs` STRING WAS RIGHT, AND THE FIELD IT ASKED FOR LANDED AT
  //    D221 — THIRTY-EIGHT DECISIONS BEFORE THIS ONE.** `attachEnergyFrom.toSelf`
  //    was built for Teal Mask Ogerpon ex on the HAND source and reached this
  //    zone for free, because `source` is a field on the op and not a fork in it.
  //    Nothing re-read the work order, so the row sat here asserting UNBUILT
  //    against a satisfied requirement for eleven slices. 🆕 **A `DROPPED` TABLE
  //    ROTS IN BOTH DIRECTIONS: the loud one is a row that gets BUILT and is not
  //    removed (which this suite catches, and did); the QUIET one is a row whose
  //    PIECE gets built by a slice that never opened this file — and nothing
  //    catches that at all.** The standing "re-check any arm believed dead" rule
  //    now has a sibling: **re-check any WORK ORDER believed blocked**, and do it
  //    against the code rather than against the string. It is now a LANDED row
  //    ("Charging Up (Team Rocket's Spidops)") and is driven below.
  // ✅ D265 BUILT ALOMOMOLA's ROW — "Once during your turn, if this Pokémon is in
  //    the Active Spot, you may put a Basic Pokémon with 70 HP or less from your
  //    discard pile onto your Bench." (sv10.5b-024/-108, 2 legal). REMOVED rather
  //    than annotated in place, because the assertion below is what keeps this
  //    list honest and a built row would make it fail. `DROPPED` is now 8.
  //
  //    ⚠️ **ITS `needs` STRING WAS RIGHT — THE FIRST ONE IN FOUR SLICES THAT WAS**,
  //    and it was written by the slice that MEASURED the row (D264) rather than
  //    inherited. What it named is exactly what shipped: ONE union rider
  //    (`basicPokemon.maxHp`), ONE `matchesFilter` conjunct, ONE `retrieveNoun`
  //    phrase, ZERO new ops, ZERO new op fields, ZERO anchors — and `activeOnly`
  //    was already on the Ability surface, as it claimed. 🆕 **THE SHELF LIFE OF A
  //    WORK ORDER IS THE TIME SINCE ITS LAST MEASUREMENT, NOT SINCE IT WAS
  //    WRITTEN**: the three re-homed before it (D258's, D263's, D264's own) had
  //    each been inherited across dozens of decisions, and all three had rotted.
  //    Its full text, and D264's account of the two directions the PREVIOUS
  //    version was wrong in, are kept below.
  //
  //    needs: "an HP-THRESHOLD `CardFilter` rider (`basicPokemon.maxHp`), and that
  //      is now the WHOLE gap — `discardPileRetrieval.dest: 'bench'` was built at
  //      D238 and this string outlived it. The printed noun is a CARD read of
  //      printed HP (`Card.hp`), not the board read Bianca's Devotion prints; the
  //      same rider lands Buddy-Buddy Poffin (3 legal) on `searchDeck`, so it is 5
  //      printings on 2 sentences across 2 ops. The second clause here, 'if this
  //      Pokémon is in the Active Spot', is the `activeOnly` flag the Ability
  //      surface already carries (Attract Customers, driven above)."
  //
  //    🛑 D264 RE-HOMED THIS `needs` STRING RATHER THAN DELETING IT, AND IT WAS
  //    WRONG IN BOTH DIRECTIONS AT ONCE — the loud one and the quiet one, in a
  //    single sentence. It read:
  //
  //      "`discardPileRetrieval.dest: 'bench'` plus an HP-threshold filter. The
  //       op's destinations are `hand` and `deck`; `searchDeck` has the bench
  //       arm and the wrong source zone. The HP threshold (also Buddy-Buddy
  //       Poffin, 3 legal, and Bianca's Devotion, 3 legal) has no `CardFilter`
  //       expression at all."
  //
  //    ⚠️ **THE FIRST HALF EXPIRED AT D238**, twenty-six decisions before this
  //    one: `dest: "bench"` is a member of this op's own union and has been
  //    since the brace-code slice, so the string named a piece that was lying
  //    right there — D263's finding, printed a second time on the SAME op.
  //    ✅✅ **D349 BUILT BIANCA'S DEVOTION, AND THE CLASSIFICATION BELOW IS WHY IT
  //    TOOK 168 DECISIONS.** The board read never did get a `CardFilter`
  //    expression and never will: it is `healChosen.remainingHpAtMost`, a NUMBER on
  //    the op, sharing `remainingHpWithin` with `gust.remainingHpAtMost` (Ledian ×3,
  //    the same clause in the `abilities_json` column) and with D310's host gate.
  //    **THE SENTENCE BELOW IS THEREFORE RECORDED AS SPENT AND NOT REWRITTEN** — its
  //    diagnosis was exactly right, and what it could not say is that the answer
  //    would arrive on a different axis from the one it was measuring.
  //
  //    ⚠️ **AND THE SECOND HALF NAMED A SIBLING THAT IS NOT ONE.** Bianca's
  //    Devotion prints *"1 of your Pokémon that has 30 HP **or less
  //    remaining**"* — a BOARD read, current HP against a body in play — where
  //    this sentence and Buddy-Buddy Poffin's print *"a Basic Pokémon **with**
  //    70 HP or less"*, a CARD read of the printed HP. A `CardFilter` cannot
  //    express the first at any width, so counting it toward this row's price
  //    overstated the yield by three printings. **Classify a predicate by KIND
  //    before you count what it buys.** The re-derived yield of an HP-threshold
  //    `CardFilter` rider is Buddy-Buddy Poffin (3, `searchDeck`) + this row (2)
  //    = **5 legal printings on 2 sentences**; Fan Rotom (2) and Mandibuzz (2)
  //    carry the same noun behind other machinery.
] as const;

// ── The demonstrator pool. One synthetic `fix-*` body per LANDED program, so
//    each can be driven end to end.
//
//    ⚠️ THEY ARE DEFINED HERE, NOT IN `testFixtures.ts`, AND NOT AS REAL CARDS —
//    D190's idiom and D190's reason. A fixture id naming a real printing must
//    appear in `catalogManifest.ts` (catalogManifest.test.ts case (c)), and that
//    manifest is GENERATED off the LOCAL sqlite: `bun run
//    scripts/catalog-manifest.ts` dies SQLITE_CANTOPEN in this clone, and the
//    manifest it holds measures a 978-row / 6-set catalog containing none of
//    sv05 / sv07 / sv08 / sv08.5 / sv09 / sv10 / sv10.5b / sv10.5w / svp. So the
//    47 printings cannot be fielded, and a real-card fixture would only make the
//    manifest stale. `createGame` takes its `cardPool` as a PARAMETER, which is
//    how a local pool stays local — `FIXTURE_POOL` is untouched, and the `fix-*`
//    prefix is what the manifest's generator and checker both skip.
//
//    Every fixture carries its printed sentence VERBATIM off the remote D1, so a
//    later census can SEE the text (D174's rule: a comment cannot go red). ──

function abilityBody(
  id: string,
  name: string,
  effect: string,
  overrides: Partial<Card> = {},
): Card {
  return battler(id, {
    name: id,
    hp: 140,
    retreat: 1,
    abilities: [{ type: "Ability", name, effect }],
    ...overrides,
  });
}

/** A Stage 1 that evolves from `fix-basic-1` — the evolution-trigger carriers.
    ⚠️ D263 WIDENED THE EXISTING HELPER RATHER THAN ADDING A PARALLEL ONE: Assemble
    Alloy's carrier has to be a **{M}** body (its own `targetType` must admit it),
    and `battler` defaults a `fix-*` id to Colorless. The overrides land AFTER the
    stage/evolveFrom pair so a caller can still only add, never silently unmake an
    evolution. */
function evoBody(id: string, name: string, effect: string, overrides: Partial<Card> = {}): Card {
  return abilityBody(id, name, effect, {
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    hp: 160,
    ...overrides,
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  "fix-bitingspree": evoBody(
    "fix-bitingspree",
    "Biting Spree",
    "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may choose 2 of your opponent's Pokémon and put 2 damage counters on each of them.",
  ),
  "fix-sneakybite": evoBody(
    "fix-sneakybite",
    "Sneaky Bite",
    "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may put 2 damage counters on 1 of your opponent's Pokémon.",
  ),
  "fix-defianthorn": evoBody(
    "fix-defianthorn",
    "Defiant Horn",
    "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
  ),
  "fix-attractcustomers": abilityBody(
    "fix-attractcustomers",
    "Attract Customers",
    "Once during your turn, if this Pokémon is in the Active Spot, you may look at the top 6 cards of your deck, reveal a Supporter card you find there, and put it into your hand. Shuffle the other cards back into your deck.",
  ),
  "fix-scaldingsteam": abilityBody(
    "fix-scaldingsteam",
    "Scalding Steam",
    "Once during your turn, if this Pokémon is in the Active Spot, you may make your opponent's Active Pokémon Burned.",
  ),
  "fix-calminglight": abilityBody(
    "fix-calminglight",
    "Calming Light",
    "Once during your turn, if this Pokémon is in the Active Spot, you may make your opponent's Active Pokémon Asleep.",
  ),
  "fix-suddenshearing": abilityBody(
    "fix-suddenshearing",
    "Sudden Shearing",
    "When you play this Pokémon from your hand onto your Bench during your turn, you may discard the top card of your opponent's deck.",
  ),
  "fix-infernofandango": abilityBody(
    "fix-infernofandango",
    "Inferno Fandango",
    "As often as you like during your turn, you may attach a Basic {R} Energy card from your hand to 1 of your Pokémon.",
  ),
  "fix-seethingspirit": abilityBody(
    "fix-seethingspirit",
    "Seething Spirit",
    "Once during your turn, you may attach a Basic Energy card from your discard pile to 1 of your Pokémon.",
  ),
  // ── D263 — the ability half of backlog row 9. Each sentence VERBATIM off the
  //    remote D1 `luminous` (2026-08-07), so a later census can see the text. ──
  "fix-chargingup": abilityBody(
    "fix-chargingup",
    "Charging Up",
    "Once during your turn, you may attach a Basic Energy card from your discard pile to this Pokémon.",
  ),
  "fix-dynamotor": abilityBody(
    "fix-dynamotor",
    "Dynamotor",
    "Once during your turn, you may attach a Basic {L} Energy card from your discard pile to 1 of your Benched Pokémon.",
  ),
  "fix-assemblealloy": evoBody(
    "fix-assemblealloy",
    "Assemble Alloy",
    "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may attach up to 2 Basic {M} Energy cards from your discard pile to your {M} Pokémon in any way you like.",
    { types: ["Metal"] },
  ),
  /** D263 — a plain {M} Basic with no Ability: the SECOND eligible body under
      Assemble Alloy's `targetType`, and therefore the thing that makes "in any
      way you like" two PARKS rather than two forced attaches. */
  "fix-metalbody": battler("fix-metalbody", { types: ["Metal"], hp: 140, retreat: 1 }),
  "fix-confectionarygift": abilityBody(
    "fix-confectionarygift",
    "Confectionary Gift",
    "Once during your turn, you may heal 30 damage from 1 of your Pokémon.",
  ),
  "fix-insomnia": abilityBody("fix-insomnia", "Insomnia", "This Pokémon can't be Asleep."),
  "fix-reconstitute": abilityBody(
    "fix-reconstitute",
    "Reconstitute",
    "You must discard 2 cards from your hand in order to use this Ability. Once during your turn, you may draw a card.",
  ),
  "fix-uptempo": abilityBody(
    "fix-uptempo",
    "Up-Tempo",
    "You must put a card from your hand on the bottom of your deck in order to use this Ability. Once during your turn, you may draw cards until you have 5 cards in your hand.",
  ),
  "fix-enhancedhammer": trainerCard(
    "fix-enhancedhammer",
    "Item",
    "Discard a Special Energy from 1 of your opponent's Pokémon.",
  ),
  "fix-fennel": trainerCard("fix-fennel", "Supporter", "Heal 40 damage from each of your Pokémon."),
  "fix-nightstretcher": trainerCard(
    "fix-nightstretcher",
    "Item",
    "Put a Pokémon or a Basic Energy card from your discard pile into your hand.",
  ),
  "fix-maxrod": trainerCard(
    "fix-maxrod",
    "Item",
    "Put up to 5 in any combination of Pokémon and Basic Energy cards from your discard pile into your hand.",
  ),
  "fix-miracleheadset": trainerCard(
    "fix-miracleheadset",
    "Item",
    "Put up to 2 Supporter cards from your discard pile into your hand.",
  ),
  "fix-energyrecycler": trainerCard(
    "fix-energyrecycler",
    "Item",
    "Shuffle up to 5 Basic Energy cards from your discard pile into your deck.",
  ),
  "fix-sacredash": trainerCard(
    "fix-sacredash",
    "Item",
    "Shuffle up to 5 Pokémon from your discard pile into your deck.",
  ),
  "fix-masterball": trainerCard(
    "fix-masterball",
    "Item",
    "Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
  ),
  "fix-treasuretracker": trainerCard(
    "fix-treasuretracker",
    "Item",
    "Search your deck for up to 5 Pokémon Tool cards, reveal them, and put them into your hand. Then, shuffle your deck.",
  ),
  "fix-dangerouslaser": trainerCard(
    "fix-dangerouslaser",
    "Item",
    "Your opponent's Active Pokémon is now Burned and Confused.",
  ),
  "fix-kofu": trainerCard(
    "fix-kofu",
    "Supporter",
    "Put 2 cards from your hand on the bottom of your deck in any order. If you put 2 cards on the bottom of your deck in this way, draw 4 cards. (If you can't put 2 cards from your hand on the bottom of your deck, you can't use this card.)",
  ),
  "fix-maximumbelt": trainerCard(
    "fix-maximumbelt",
    "Tool",
    "Attacks used by the Pokémon this card is attached to do 50 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance).",
  ),
  "fix-bindingmochi": trainerCard(
    "fix-bindingmochi",
    "Tool",
    "Attacks used by the Poisoned Pokémon this card is attached to do 40 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
  ),
  "fix-levincia": trainerCard(
    "fix-levincia",
    "Stadium",
    "Once during each player's turn, that player may put up to 2 Basic {L} Energy cards from their discard pile into their hand.",
  ),
  "fix-spikyenergy": specialEnergy(
    "fix-spikyenergy",
    "fix-spikyenergy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon.",
  ),
  // ── D264 — backlog row 13's ABILITY and TRAINER halves. ──
  "fix-lanasaid": trainerCard(
    "fix-lanasaid",
    "Supporter",
    "Put up to 3 in any combination of Pokémon that don't have a Rule Box and Basic Energy cards from your discard pile into your hand. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
  ),
  "fix-greedyorder": evoBody(
    "fix-greedyorder",
    "Greedy Order",
    "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may put up to 2 Arven's Sandwich cards from your discard pile into your hand.",
  ),
  /** ⚠️ D264 — THE ONLY FIXTURE IN THIS POOL WHOSE `name` IS NOT ITS `id`, AND
      IT HAS TO BE: `byName` matches `card.name` for EQUALITY, so a demonstrator
      called "fix-arvenssandwich" would make Greedy Order's filter match nothing
      and every assertion below vacuous. The name is the printed one, and the
      catalog row it stands in for (`sv10-161`, a Standard-legal Item) was checked
      to exist before the registry row was written. */
  "fix-arvenssandwich": {
    ...trainerCard("fix-arvenssandwich", "Item", "Heal 30 damage from 1 of your Pokémon."),
    name: "Arven's Sandwich",
  },
  /** ⚠️ D264 — THE ONE CARD THAT SEPARATES `anyPokemon.noRuleBox` FROM
      `basicPokemon.noRuleBox`, and without it Lana's Aid's whole row is green
      under the wrong filter. An EVOLUTION Pokémon with no Rule Box: Artazon's
      Basic-only noun refuses it, Lana's Aid's stage-free noun takes it. No
      Ability, so it cannot be confused with the `evoBody` carriers above. */
  "fix-plainstage1": battler("fix-plainstage1", {
    name: "fix-plainstage1",
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    hp: 150,
    retreat: 1,
  }),
  // ── D265 — the HP-THRESHOLD rider (`basicPokemon.maxHp`), on TWO ops. Each
  //    sentence VERBATIM off the remote D1 `luminous` (2026-08-07). ──
  "fix-buddybuddypoffin": trainerCard(
    "fix-buddybuddypoffin",
    "Item",
    "Search your deck for up to 2 Basic Pokémon with 70 HP or less and put them onto your Bench. Then, shuffle your deck.",
  ),
  "fix-gentlefin": abilityBody(
    "fix-gentlefin",
    "Gentle Fin",
    "Once during your turn, if this Pokémon is in the Active Spot, you may put a Basic Pokémon with 70 HP or less from your discard pile onto your Bench.",
  ),
  /** 🆕 D265 — THE CARD THAT SEPARATES THE **HP** CONJUNCT FROM THE **STAGE** ONE,
      and without it every assertion about the threshold is confounded. A Stage 1
      at 60 HP: it SATISFIES `maxHp: 70` and FAILS `isBasicPokemon`, so a build
      that dropped the stage question would offer it and a build that dropped the
      threshold would not be told apart from a correct one by this card alone.
      The threshold's own negative is `fix-bigbody` (a Basic at **200** HP, read
      out of `testFixtures.ts` rather than assumed) — the pair is what makes a
      dropped `maxHp` conjunct observable. No Ability, so it cannot be confused
      with the `evoBody` carriers above. */
  "fix-smallstage1": battler("fix-smallstage1", {
    name: "fix-smallstage1",
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    hp: 60,
    retreat: 1,
  }),
  // ── D266 — the TYPE GATE on `healEach` (`pokemonType`). Sentence VERBATIM off
  //    the row this table dropped until now. ──
  "fix-clemontsquickwit": trainerCard(
    "fix-clemontsquickwit",
    "Supporter",
    "Heal 60 damage from each of your {L} Pokémon.",
  ),
  /** 🆕 D266 — THE GATE'S POSITIVE. A {L} Basic at 200 HP, big enough to carry
      100 damage without the KO sweep taking it off the board mid-assertion.
      ⚠️ **THE POOL HAD NO {L} BODY AT ALL** — `fix-lightning-energy` is an
      ENERGY, which `printedTypesOf` was read to confirm rather than assumed, and
      every other Basic here is Colorless, Fire, Grass, Water, Psychic, Metal,
      Darkness or Dragon. Without this card the type gate is green at ANY type,
      because nothing on the board would ever satisfy it. */
  "fix-lightningbody": battler("fix-lightningbody", { types: ["Lightning"], hp: 200 }),
  /** 🆕 D266 — THE GATE'S DUAL-TYPE WITNESS, and the one card that separates
      `includes` from equality. `types` is a LIST: a body printed {L}{M} is a
      "{L} Pokémon" and must heal. A build comparing `types[0]` or the whole
      array would refuse it and pass every other assertion in this file. */
  "fix-dualtypebody": battler("fix-dualtypebody", { types: ["Metal", "Lightning"], hp: 200 }),
  // ── D267 — the STAGE GATE on `noRetreatCostAura` (`stage: "Basic"`). Sentence
  //    VERBATIM off the row this table dropped until now. ──
  /** 🆕 D267 — THE AURA SOURCE. Latias ex's own printed shape, because the row's
      SELF case depends on it: the source is itself a BASIC with a NON-ZERO
      printed Retreat Cost (210 HP, retreat 2), so "self-inclusive" is an
      assertion about a number that moves rather than a card that was already
      free. Its Ability is a PASSIVE, not an activated one — it is never `useOn`'d,
      it just has to be in play. */
  "fix-skyliner": abilityBody(
    "fix-skyliner",
    "Skyliner",
    "Your Basic Pokémon in play have no Retreat Cost.",
    { hp: 210, retreat: 2, types: ["Psychic"] },
  ),
  // ── D268 — `handRefresh.who: "opponent"`, the union's third member. Sentence
  //    VERBATIM off the row this table dropped until now. ──
  /** 🆕 D268 — THE ACTIVATED ABILITY THAT REACHES ACROSS THE TABLE. No overrides:
      nothing this row asserts is about HP, retreat or type — the whole content of
      `who` is WHICH SEAT'S HAND MOVES, and that is a property of the two boards
      either side of the op, not of the carrier. */
  "fix-distortedfuture": abilityBody(
    "fix-distortedfuture",
    "Distorted Future",
    "Once during your turn, if this Pokémon is in the Active Spot, you may have your opponent shuffle their hand into their deck and draw 3 cards.",
  ),
  // ── D269 — `coinFlipGate.otherwise`. TWO Supporters, and the pair is the point:
  //    one puts a bare `drawCards` in each arm (so the ONLY difference between
  //    heads and tails is a count in one hand) and the other puts a whole
  //    `handRefresh` in each (LACEY's shape, so the shuffle must happen on BOTH
  //    faces). A build that spliced `otherwise` only when `then` was empty, or
  //    that ran BOTH arms, would be green on one of these and red on the other. ──
  "fix-picnicker": trainerCard(
    "fix-picnicker",
    "Supporter",
    "Flip a coin. If heads, draw 4 cards. If tails, draw 2 cards.",
  ),
  "fix-drasna": trainerCard(
    "fix-drasna",
    "Supporter",
    "Shuffle your hand into your deck. Then, flip a coin. If heads, draw 8 cards. If tails, draw 3 cards.",
  ),
  // ── D270 — `HandRefreshDraw.perSeat`. ONE Supporter, and it is Drasna's program
  //    with two seats: the same two-armed gate, the same whole-`handRefresh`-in-
  //    each-arm shape, `who: "both"` instead of `"you"`, and a printed PAIR where
  //    the fixed count was. The pair is SWAPPED between the arms, so no board on
  //    which only one hand is read can tell the four candidate mis-builds apart. ──
  "fix-harlequin": trainerCard(
    "fix-harlequin",
    "Supporter",
    "Each player shuffles their hand into their deck. Then, flip a coin. If heads, you draw 5 cards, and your opponent draws 3 cards. If tails, you draw 3 cards, and your opponent draws 5 cards.",
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The Pokémon-surface deck: the thirteen bodies, the evolution base they all
    evolve from, an attacker, and a REAL Supporter (Nemona sv01-180) so
    `lookAtTopN`'s `supporter` filter has something honest to find. */
const MON_DECK = deckOf({
  "fix-basic-1": 4,
  "fix-bitingspree": 2,
  "fix-sneakybite": 2,
  "fix-defianthorn": 2,
  "fix-attractcustomers": 2,
  "fix-scaldingsteam": 2,
  "fix-calminglight": 2,
  "fix-suddenshearing": 2,
  "fix-infernofandango": 2,
  "fix-seethingspirit": 2,
  "fix-confectionarygift": 2,
  "fix-insomnia": 2,
  "fix-reconstitute": 2,
  "fix-uptempo": 2,
  "fix-attacker": 2,
  "fix-fire-energy": 4,
  "fix-energy": 4,
  "sv01-180": 2,
  "fix-bigbody": 18,
});

/** The Trainer/Tool/Stadium/Energy deck. `fix-attacker-ex` is the Pokémon **ex**
    Maximum Belt's suffix gate names; `fix-special` is an UNAUTHORED Special
    Energy — Enhanced Hammer's victim, and the one whose presence beside a Basic
    Energy makes the `specialEnergy` filter's narrowing observable. */
/** ⚠️ D263 — THE DISCARD-ATTACH ABILITY ROWS GET THEIR **OWN** DECK RATHER THAN
    SIX MORE LINES IN `MON_DECK`, and that is a seeded-suite decision rather than
    tidiness: every board above is built from a numbered seed, so re-weighting the
    shared deck moves what setup deals for **every other row in this file**. A
    separate 60 leaves those untouched by construction.

    `fix-metalbody` is the SECOND {M} body (what makes Assemble Alloy's "in any
    way you like" two independent parks), `fix-bigbody` is the Colorless control
    its `targetType` must refuse, and `fix-energy` is the Colorless Basic Energy
    Dynamotor's `energyType` must refuse. */
const ALLOY_DECK = deckOf({
  "fix-basic-1": 8, // the evolution base Assemble Alloy is played onto
  "fix-assemblealloy": 4,
  "fix-chargingup": 4,
  "fix-dynamotor": 4,
  "fix-metalbody": 4,
  "fix-metal-energy": 8,
  "fix-lightning-energy": 8,
  "fix-energy": 8, // Colorless — the energyType negative for both typed rows
  "fix-bigbody": 12, // dominant Basic filler, and the non-{M} target control
});

/** ⚠️ D264 — A THIRD 60, FOR D263's REASON RESTATED: `TRN_DECK` and `MON_DECK`
    both feed seeded boards, so adding rows to either moves what setup deals for
    every row already in this file. Both of this slice's programs read the DISCARD
    PILE, so the deck's job is to hold one of each thing their two filters must
    tell apart:
      • `fix-plainstage1` — an EVOLUTION Pokémon with no Rule Box (the card that
        separates `anyPokemon.noRuleBox` from `basicPokemon.noRuleBox`);
      • `fix-attacker-ex` — "Fixmon ex", the Rule-Box control `noRuleBox` drops;
      • `fix-bigbody` — a plain Basic, admitted by both readings;
      • `fix-energy` — the Basic Energy the `anyOf`'s SECOND member admits, and
        the card that makes `.some` observably not `.every`;
      • `fix-special` — a Special Energy, which `basicEnergy` must refuse;
      • `fix-arvenssandwich` — the NAMED card, ×4 so `max: 2` is a real clamp;
      • `fix-item` — an Item that is NOT that name, so `byName` is observably
        narrower than `item`. */
const RECOVERY_DECK = deckOf({
  "fix-basic-1": 8, // the evolution base Greedy Order is played onto
  "fix-greedyorder": 4,
  "fix-lanasaid": 4,
  "fix-arvenssandwich": 4,
  "fix-plainstage1": 4,
  "fix-attacker-ex": 4,
  "fix-item": 4,
  "fix-special": 4,
  "fix-energy": 8,
  "fix-bigbody": 16,
});

/** ⚠️ D265 — A FOURTH 60, FOR D263's AND D264's REASON RESTATED A THIRD TIME:
    every board in this file is dealt from a numbered seed, so re-weighting
    `MON_DECK` / `TRN_DECK` / `ALLOY_DECK` / `RECOVERY_DECK` moves what setup deals
    for every row already in them. A separate 60 leaves all four untouched by
    construction.

    Both of this slice's programs read the SAME filter — `basicPokemon` with
    `maxHp: 70` — so the deck's job is to hold one of each thing that filter's
    THREE conjuncts must tell apart, and to hold them where BOTH ops can see them
    (Poffin searches the DECK, Gentle Fin the DISCARD PILE, and the pile is seeded
    out of this deck):
      • `fix-basic-1` — a Basic at **60** HP: the card both programs must take;
      • `fix-bigbody` — a Basic at **200** HP: the THRESHOLD's negative, and the
        one card that makes a dropped `maxHp` conjunct observable;
      • `fix-smallstage1` — a Stage 1 at **60** HP: the STAGE conjunct's negative,
        and the card that keeps the two conjuncts from being confounded;
      • `fix-item` — a Trainer, whose `hp` is NULL: the data-gap negative. `null <=
        70` is TRUE in JavaScript, so an unguarded comparison offers it;
      • `fix-attacker` — a Basic at 120 HP, a second body above the line so the
        threshold is not a claim about one card.
    ⚠️ `fix-bigbody` is the dominant filler here as everywhere else in this file,
    which means the deck is mostly INELIGIBLE — deliberate: a `max: 2` search that
    accidentally ignored the filter would fill the Bench with 200 HP bodies. */
const POFFIN_DECK = deckOf({
  "fix-basic-1": 8,
  "fix-smallstage1": 4,
  "fix-buddybuddypoffin": 4,
  "fix-gentlefin": 4,
  "fix-item": 4,
  "fix-attacker": 4,
  "fix-energy": 8,
  "fix-bigbody": 24,
});

/** ⚠️ D266 — A FIFTH 60, for the reason D263, D264 and D265 each wrote down:
    every board in this file is dealt from a numbered seed, so re-weighting
    `MON_DECK` / `TRN_DECK` / `ALLOY_DECK` / `RECOVERY_DECK` / `POFFIN_DECK`
    moves what setup deals for every row already in them. A separate 60 leaves
    all five untouched by construction. It is four slices running now, and the
    idiom is settled.

    The gate is a BOARD read, so this deck's job is to supply BODIES rather than
    search targets — one of each thing the `types` comparison must tell apart,
    in enough copies that `benchFromDeck` can seat several at once:
      • `fix-lightningbody` — a {L} Basic at **200** HP: the card that heals, and
        the pool's FIRST {L} body of any kind;
      • `fix-dualtypebody` — a {M}{L} Basic: `includes`, not equality;
      • `fix-bigbody` — a **Colorless** Basic at 200 HP: the gate's negative, and
        the one card that makes a dropped `pokemonType` conjunct observable;
      • `fix-basic-1` / `fix-attacker` — a Colorless and a Fire Basic, so "not
        {L}" is not a claim about one card;
      • `fix-fennel` — the UNGATED sentence, on the SAME board, so "absent means
        ungated" is asserted rather than assumed;
      • `fix-energy` — filler that keeps the count at 60.
    ⚠️ THE DECK IS MOSTLY OFF-TYPE ON PURPOSE: a heal that ignored the gate would
    have to be told apart from one that honoured it, and a board where every body
    is {L} cannot do that. */
const QUICKWIT_DECK = deckOf({
  "fix-lightningbody": 12,
  "fix-dualtypebody": 4,
  "fix-clemontsquickwit": 4,
  "fix-fennel": 2,
  "fix-basic-1": 8,
  "fix-attacker": 4,
  "fix-energy": 8,
  "fix-bigbody": 18,
});

/** ⚠️ D267 — A SIXTH 60, for the reason the five before it were cut: adding rows
    to `MON_DECK` / `TRN_DECK` / `ALLOY_DECK` / `RECOVERY_DECK` / `POFFIN_DECK` /
    `QUICKWIT_DECK` moves what setup deals for every row already in them. Five
    slices running; the idiom is settled.

    The gate is a BOARD read of a printed STAGE, so this deck's job is to supply
    a STAGE pair that is also a RETREAT pair — a body with a printed Retreat Cost
    on each side of the Basic/Evolution line, or the gate is green at any stage:
      • `fix-skyliner` — the aura source: a BASIC with retreat 2, so the printed
        sentence's SELF case (Latias ex frees itself) is a number that moves;
      • `fix-retreat2` — a plain Basic, retreat 2: the FREED beneficiary and, with
        no source in play, the aura-off control;
      • `fix-stage1` — a Colorless Stage 1, retreat 2: the STAGE gate's NEGATIVE,
        and the one body that makes a dropped `stage` conjunct observable;
      • `fix-basic-1` — a second Basic (retreat 1), so "Basic" is not a claim
        about one card, and the EVOLVE BASE for the live-read case
        (`fix-stage1` evolves from it);
      • `sv03-082` — Clefable ex "Lunar Zone", the UNGATED-on-stage sentence, on
        the SAME board: it frees an EVOLUTION carrying {P}, so "absent means
        ungated" is asserted rather than assumed;
      • `fix-psychic-energy` — Basic {P}, which is what Lunar Zone's own clause
        needs (Skyliner has no energy clause at all — the freed bodies here carry
        NOTHING, which is the other half of "absent means ungated");
      • `fix-bigbody` — 200 HP Colorless Basic: the DOMINANT mulligan-free starter
        and the bench filler a retreat needs;
      • `fix-energy` — filler that keeps the count at 60. */
const SKYLINER_DECK = deckOf({
  "fix-skyliner": 4,
  "fix-retreat2": 8,
  "fix-stage1": 4,
  "fix-basic-1": 8,
  "sv03-082": 2,
  "fix-psychic-energy": 6,
  "fix-bigbody": 24,
  "fix-energy": 4,
});

/** ⚠️ D268 — A SEVENTH 60, for the reason the six before it were cut: adding rows
    to `MON_DECK` / `TRN_DECK` / `ALLOY_DECK` / `RECOVERY_DECK` / `POFFIN_DECK` /
    `QUICKWIT_DECK` / `SKYLINER_DECK` moves what setup deals for every row already
    in them. Six slices running; the idiom is settled.

    🆕 AND THIS ONE IS DEALT TO **BOTH SEATS** AND ITS JOB IS THE DECK BEHIND THE
    HAND, not the hand itself. `localSetup` gives `p1` and `p2` the same list, and
    what this row asserts is that the OPPONENT's hand goes into the OPPONENT's deck
    and three come back — so the deck must be deep enough that a 3-card draw off a
    freshly reshuffled pile cannot deck out or run short at turn 3, and boring
    enough that nothing on it has a trigger, an aura or a §12 clause that could
    move a hand behind the op's back:
      • `fix-distortedfuture` — the carrier, in enough copies that the ONCE-per-turn
        assertion has a second body available if it ever wants one;
      • `fix-bigbody` — the 200 HP Colorless Basic that is the dominant
        mulligan-free starter everywhere else in this file;
      • `fix-basic-1` / `fix-attacker` — plain Basics, so the opening hands on both
        seats are non-trivial without being interesting;
      • `fix-energy` — filler that keeps the count at 60 and gives the reshuffled
        deck bulk to draw off.
    ⚠️ NOTHING HERE CARRIES AN ABILITY EXCEPT THE CARRIER. A body with a trigger in
    the opponent's hand or deck could move a count this suite is measuring. */
const DISTORTED_DECK = deckOf({
  "fix-distortedfuture": 4,
  "fix-bigbody": 20,
  "fix-basic-1": 8,
  "fix-attacker": 4,
  "fix-energy": 24,
});

/** ⚠️ D269 — A SEVENTH 60, FOR THE REASON THE SIX BEFORE IT WERE BUILT: every
    board in this file is dealt from a numbered seed, so adding rows to `MON_DECK`
    / `TRN_DECK` / `ALLOY_DECK` / `RECOVERY_DECK` / `POFFIN_DECK` / `QUICKWIT_DECK`
    / `SKYLINER_DECK` / `DISTORTED_DECK` moves what setup deals for every row
    already in them. Seven slices running; the idiom is settled.

    🆕 AND THIS ONE IS SIZED FOR A **SWEPT** SUITE RATHER THAN A CHOSEN BOARD.
    Both arms of both cards must be DRIVEN, and there is no way to force a coin —
    `runProgram` takes it from `rngState` before anything else — so the assertions
    below sweep a fixed seed list and read the face off the emitted
    `ATTACK_EFFECT_COIN_FLIP` row, exactly as `multiCoinFlip.test.ts` does. That
    puts two demands on the deck:
      • **DEEP ENOUGH FOR THE BIGGEST DRAW ON EVERY SEED.** Drasna's heads arm
        reshuffles the hand and draws 8 off the top; a deck that could short-draw
        on some seed would make "8" a property of the seed rather than of the arm.
        45 non-carrier cards behind a 7-card opening hand clears it with room.
      • **BORING ENOUGH THAT NOTHING ELSE MOVES A HAND.** No body here carries an
        Ability, a trigger or a §12 clause, so between the flip and the assertion
        the only thing that touched either hand is the arm under test.
    Both carriers ride the same 60 because they are the same field: sharing the
    deck means a heads board for one is a heads board for the other on the same
    seed, which is what lets the two rows be compared rather than merely both
    passing. */
const FLIP_DRAW_DECK = deckOf({
  "fix-picnicker": 4,
  "fix-drasna": 4,
  "fix-bigbody": 20,
  "fix-basic-1": 8,
  "fix-energy": 24,
});

/** ⚠️ D270 — AN EIGHTH 60, for the reason the seven before it were built: every
    board in this file is dealt from a numbered seed, so adding rows to an existing
    list moves what setup deals for every row already in it. `FLIP_DRAW_DECK` is
    the nearest neighbour and is deliberately NOT re-weighted — eight slices
    running.

    🆕 AND THIS ONE IS SIZED FOR **BOTH SEATS**, which `FLIP_DRAW_DECK` never had
    to be. `localSetup` deals the same list to `p1` and `p2`, so both seats hold a
    real dealt hand and no surgery is needed — but this card refreshes BOTH of
    them, so both decks must survive a 5-card draw off a freshly shuffled pile on
    every swept seed, and neither hand may be empty before the play or "your hand
    went back" is vacuously true. 47 non-carrier cards behind a 7-card opening hand
    clears the first; the guard in each `it` measures the second rather than
    assuming it.

    ⚠️ BORING ON PURPOSE, exactly as `FLIP_DRAW_DECK` is: no body here carries an
    Ability, a trigger or a §12 clause, so between the flip and the assertion the
    only thing that touched either hand is the arm under test. */
const HARLEQUIN_DECK = deckOf({
  "fix-harlequin": 4,
  "fix-bigbody": 20,
  "fix-basic-1": 8,
  "fix-energy": 28,
});

const TRN_DECK = deckOf({
  "fix-attacker": 4,
  "fix-attacker-ex": 4,
  "fix-bigbody": 6,
  "fix-enhancedhammer": 2,
  "fix-fennel": 2,
  "fix-nightstretcher": 2,
  "fix-maxrod": 2,
  "fix-miracleheadset": 2,
  "fix-energyrecycler": 2,
  "fix-sacredash": 2,
  "fix-masterball": 2,
  "fix-treasuretracker": 2,
  "fix-dangerouslaser": 2,
  "fix-kofu": 2,
  "fix-maximumbelt": 2,
  "fix-bindingmochi": 2,
  "fix-levincia": 2,
  "fix-spikyenergy": 2,
  "fix-tool": 2,
  "fix-item": 2,
  "sv01-180": 2,
  "fix-special": 2,
  "fix-special-2": 2,
  "fix-lightning-energy": 3,
  "fix-energy": 3,
});

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** `driveSetup`, against the LOCAL pool — the one thing `testFixtures.ts` cannot
    do for us, because it closes over `FIXTURE_POOL` (D190's helper verbatim). */
function localSetup(seed: number, first: Seat, deck: string[]): GameState {
  const created = createGame({ seed, decks: { p1: deck, p2: deck }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
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

/** P1 to move, on `turn`. The DEFAULT is 3, not 1: P1 goes first here, and §4
    bars the going-first player from attacking, playing a Supporter or evolving on
    turn 1 — three restrictions this slice's rows have nothing to do with. */
function board(seed: number, deck: string[], turn = 3): GameState {
  let state = localSetup(seed, "p1", deck);
  while (state.turn < turn) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    const seat = state.turn % 2 === 1 ? "p1" : "p2";
    state = must(applyAction(state, { type: "endTurn", seat }));
  }
  return state;
}

/** P1's turn on the Pokémon deck with `bodyId` as P1's Active and a clean Bench.
    Copies dealt into the opening hand are returned to the deck first, so the
    surgery never depends on which seed dealt what. */
function withActive(seed: number, bodyId: string, turn = 3, deck: string[] = MON_DECK): GameState {
  let state = handToDeck(board(seed, deck, turn), "p1", bodyId);
  state = setActiveFromDeck(state, "p1", bodyId);
  return clearBench(state, "p1");
}

/** Put one copy of `cardId` into P1's hand, RESTOCKING the deck from hand first
    so no surgery depends on which seed dealt what (these boards are at turn 3,
    by which point a 2-copy card is often entirely in hand). */
function toHand(state: GameState, cardId: string): GameState {
  return handFromDeck(handToDeck(state, "p1", cardId), "p1", cardId, 1);
}

/** Play a Trainer from P1's hand (pulled out of the deck first). */
function playFromHand(state: GameState, cardId: string): ReturnType<typeof mustApply> {
  const next = toHand(state, cardId);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid: handUid(next, "p1", cardId) });
}

/** `attachFromDeck` / `discardFromDeck` / `attachToolFromDeck` with the same
    restock in front of them. */
function stocked(state: GameState, seat: Seat, cardId: string): GameState {
  return handToDeck(state, seat, cardId);
}

const useOn = (abilityName: string) =>
  ({ type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName }) as const;

function chooseCards(state: GameState, uids: string[]): ReturnType<typeof mustApply> {
  return mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });
}

/** TEST SURGERY: shrink P1's hand to `size` by returning the surplus to the deck
    — `drawUntilHandSize` and `payFromHand` both read the CURRENT hand, and the
    opening hand is big enough to make either vacuous. */
function trimHand(state: GameState, size: number): GameState {
  const side = state.players.p1;
  if (side.hand.length <= size) return state;
  const keep = side.hand.slice(0, size);
  const back = side.hand.slice(size);
  return {
    ...state,
    players: { ...state.players, p1: { ...side, hand: keep, deck: [...side.deck, ...back] } },
  };
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards")
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  return state.phase.prompt;
}

/** 🆕 D343 — the `orderCards` park's twin of `cardsPrompt`. Kofu is the first
    program in THIS file to park twice on two different prompt KINDS, so the
    narrowing has to be per-kind rather than one shared accessor: a helper that
    returned either would let a test assert an ordering window against a
    `chooseCards` park and pass. */
function orderPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "orderCards")
    throw new Error(`expected orderCards, got ${state.phase.prompt.kind}`);
  return state.phase.prompt;
}

function orderCards(state: GameState, uids: string[]): ReturnType<typeof mustApply> {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "orderCards", uids },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("D199 — the registry map", () => {
  // 🆕 D335 — THE COUNT IS GONE FROM THIS TITLE RATHER THAN CORRECTED. It read
  // "registers all 87 Standard-legal printings" over an assertion of 90 — one slice
  // stale, and D334's own lesson come due on the very next slice: a count in a title
  // is a count that will be wrong, and the two `expect` calls at the foot of this
  // block are the only honest place for one. **Delete it or make it executable.**
  it("registers every Standard-legal printing in the table, one shared object per program", () => {
    for (const { program, ids, fixture, legal } of LANDED) {
      expect(ids, `${program}: id list disagrees with its measured legal count`).toHaveLength(
        legal,
      );
      const first = programFor(ids[0] as string);
      expect(first, `${program}: ${ids[0]} has no program`).toBeDefined();
      for (const id of ids) expect(programFor(id), `${id} left ${program}`).toBe(first);
      // The demonstrator carries the SAME object, so what is driven below is
      // literally what the printings resolve to — never a copy of it.
      //
      // 🆕 **D340 — A NULL `fixture` IS NOT AN EXEMPTION FROM THAT CLAIM, IT IS A
      // STRICTLY STRONGER FORM OF IT.** The demonstrator exists so the body a suite
      // DRIVES and the body the printings RESOLVE TO cannot drift apart. A suite
      // that drives the REAL catalog ids on a local `cardPool` (D275's idiom) closes
      // that gap by construction — there is no second body to disagree — so what is
      // owed here is not a weaker check but a DIFFERENT one: prove the row really is
      // real-id-driven. **This can go RED**: set `fixture: null` on a row whose ids
      // are `fix-*` demonstrator keys and nothing would be driving a catalog
      // printing at all, which is the defect the null would otherwise hide.
      if (fixture === null) {
        for (const id of ids) {
          expect(id.startsWith("fix-"), `${program}: ${id} is a demonstrator, not a printing`).toBe(
            false,
          );
          expect(
            Object.hasOwn(FIXTURE_POOL, id),
            `${program}: ${id} is in the SHARED pool, so it owes a demonstrator row`,
          ).toBe(false);
        }
      } else {
        expect(programFor(fixture), `${fixture} is not ${program}`).toBe(first);
      }
    }
    // 🆕 D331: 41 -> 42 rows and 77 -> 80 legal printings, the +3 being Lisia's
    // Appeal's whole population. RE-ADDED against the table rather than incremented
    // from the old literal — D330 shipped a split summing to 21 against a total of
    // 18 and a 9/4 that was a 9/5, and the `reduce` on the line below is the only
    // reason a wrong number here cannot survive the run.
    // 🆕 D332: 42 -> 43 rows and 80 -> 84 legal printings, the +4 being Drayton's
    // whole population. RE-ADDED against the table by the `reduce` below rather
    // than incremented from the old literal, which is the only reason a wrong
    // number here cannot survive the run.
    // 🆕 D333: 43 -> 45 rows and 84 -> 87 legal printings — Roto-Stick's 1 and Bug
    // Catching Set's 2. RE-ADDED against the table by the `reduce` below rather
    // than incremented: 84 + 1 + 2 = 87, and 45 rows for 87 printings because these
    // two rows carry 1 and 2 where the table's mean is nearer 2.
    expect(LANDED).toHaveLength(58); // 🆕🆕 D350 +1 (Inviting Wink), carrying +3 legal — ONE card with THREE printings, the D334/D337/D340/D346/D347 split rather than D349's pair. ⚠️ **THE UNIT, RE-READ BEFORE EDITING FOR THE FOURTH SLICE RUNNING: this table steps by ROWS (cards) and the sum below steps by LEGAL PRINTINGS**, so "+1 here and +3 there" is one row and not a discrepancy. `fixture: null` for the EIGHTH row running — the suite drives the three REAL ids on a LOCAL `cardPool` and asserts the `FIXTURE_POOL` abstinence by id in §7. // 🆕🆕 D349 +2 (Glittering Star Pattern, Bianca's Devotion), carrying +6 legal — TWO cards with THREE printings each, D345's row-pair shape and the widest single-slice legal step this table has recorded since D345. 🛑 **AND THE PAIR IS NOT ONE ABILITY NAME ON TWO CARDS (D345) BUT ONE printed CLAUSE ON TWO OPS IN TWO COLUMNS** — a `triggered` Ability and a Supporter, which is a split this table has never carried before. ⚠️ **THE UNIT, RE-READ BEFORE EDITING FOR THE THIRD SLICE RUNNING: this table steps by ROWS (cards) and the sum below steps by LEGAL PRINTINGS**, so "+2 here and +6 there" is two rows and not a discrepancy. `fixture: null` on both, for the sixth and seventh rows running. // 🆕 D347 +1 (Buzzing Boost), carrying +3 legal — ONE card with THREE printings, the same split D346/D340/D337/D334 took. ⚠️ **THE UNIT, RE-READ BEFORE EDITING FOR THE SECOND SLICE RUNNING: this table steps by ROWS (cards) and the sum below steps by LEGAL PRINTINGS**, so "+1 here and +3 there" is one row and not a discrepancy. `fixture: null` for the fifth row running. // 🆕 D346 +1 (Overvolt Discharge), carrying +3 legal — ONE card with THREE printings, D334/D337/D340's split rather than D336's. ⚠️ **THE UNIT: this table steps by ROWS (cards) and the sum below steps by LEGAL PRINTINGS**, which is D341's lesson and one of D345's own two non-count misses — a slice that predicts "+3" here has confused the two instruments. `fixture: null` for the fourth row running. // 🆕🆕 D345 +2 (Cursed Blast ×2), carrying +6 legal — TWO cards with THREE printings each, the first row-pair this table has taken from ONE Ability NAME on TWO cards, and the widest single-slice legal step it has recorded since D334. Both carry `fixture: null` (D340's idiom), and the SPLIT inside the pair is new: `sv06.5` IS among `catalogManifest`'s six sets and `sv08.5` is not, so four of the six ids were shared-pool-admissible and two were not. **A ROW CAN BE HALF-ADMISSIBLE, WHICH IS WHY THE RULE IS PER CARD.** // 🆕 D340 +1 (Freezing Shroud), carrying +3 legal — ONE card with THREE printings, which is D334's and D337's split rather than D336's, and the FIRST row this table has taken whose suite seats no shared-pool body at all (`fixture: null`). 🆕 D337 +1 (Ethan's Adventure), carrying +3 legal — ONE card with THREE printings, which is D334's split rather than D336's, and the widest single-row legal step this table has taken since D334. 🆕 D336 +2 (Larry's Skill, Secret Box), carrying +3 legal — TWO cards where D334's and D335's steps were one each, and the 2/1 split is why the rows step by 2 and the legal sum by 3. 🆕 D335 +1 (Recon Directive), carrying +2 legal — ONE card, and the slice's OTHER card is out of Standard and so has no row here at all. 🆕 D334 +1 (Explorer's Guidance), carrying +3 legal — ONE card where D333's step was two
    expect(LANDED.reduce((n, l) => n + l.legal, 0)).toBe(122); // 🆕🆕 D350 +3 — 119 + 3 = 122, re-added from the rows rather than incremented. // 🆕🆕 D349 +6 — 113 + 3 + 3 = 119, re-added from the rows rather than incremented. // 🆕 D347 +3 — 110 + 3 = 113, re-added from the rows rather than incremented. // 🆕 D346 +3 — 107 + 3 = 110, and the sum is re-added from the rows rather than incremented. // 🆕🆕 D345 +6 — 101 + 3 + 3 = 107, and the sum is re-added from the rows rather than incremented. // 🆕 D340 +3 — 98 + 3 = 101, and the sum is re-added from the rows rather than incremented. 🆕 D337 +3 — 95 + 3 = 98, and the sum is re-added from the rows rather than incremented. 🆕 D336 +3 — 92 + 2 + 1 = 95, and the sum is re-added from the rows rather than incremented. 🆕 D335 +2 — 90 + 2 = 92, and the sum is re-added from the rows rather than incremented. 🆕 D334 +3 — 87 + 3 = 90, and the sum is re-added from the rows rather than incremented
  });

  it("does NOT share an object with the near-twin each was modelled on", () => {
    // ⚠️ THE MISTAKE AN AUTHOR ACTUALLY MAKES HERE. Every row in this slice was
    // written by reading a neighbouring program; the reprint idiom says
    // byte-identical text SHARES the object, and NONE of these sentences is
    // byte-identical to the one it was modelled on. Sharing would make a later
    // edit to one card silently move another that never printed the same words.
    const pairs: [string, string][] = [
      ["sv10-122", "sv01-118"], // Biting Spree ← Hawlucha "Flying Entry"
      ["sv10-121", "sv10-122"], // Sneaky Bite ← Biting Spree (its own evolution!)
      ["svp-118", "sv01-186"], // Attract Customers ← Pokégear 3.0
      ["sv09-031", "sv08-009"], // Scalding Steam ↮ Calming Light
      ["sv10.5w-013", "sv02-060"], // Inferno Fandango ← Baxcalibur "Super Cold"
      ["sv08.5-077", "sv01-068"], // Insomnia ← Pachirisu "Electricity Pouches"
      ["sv10-155", "sv09-098"], // Reconstitute ← N's Zoroark ex "Trade"
      ["sv05-154", "sv02-176"], // Maximum Belt ← Choice Belt
      ["sv06.5-055", "sv01-169"], // Binding Mochi ← Defiance Band
      ["sv10-168", "sv01-179"], // Sacred Ash ← Miriam (SAME first sentence, no second)
      ["sv05-153", "sv01-185"], // Master Ball ← Poké Ball
      ["sv10.5b-082", "sv01-184"], // Fennel ↮ Picnic Basket (healEach vs healEachAll)
      ["sv08-167", "sv10.5b-082"], // Clemont's Quick Wit ↮ Fennel (the type GATE, and the amount)
      ["sv06-148", "fix-hammer"], // Enhanced Hammer ← the discardEnergy fixture
      ["sv09-024", "fix-attacher"], // Seething Spirit ← the attachEnergyFrom fixture
      ["sv10-020", "sv09-024"], // Charging Up ← Seething Spirit (one rider apart)
      ["sv10.5b-031", "sv09-024"], // Dynamotor ← Seething Spirit (two riders apart)
      ["sv08-130", "sv06.5-025"], // Assemble Alloy ← Battle-Hardened (the other triggered attach)
    ];
    for (const [mine, twin] of pairs) {
      expect(programFor(mine), `${mine} shares an object with ${twin}`).not.toBe(programFor(twin));
    }
    // …and the two that would be genuinely WRONG if shared, spelled out:
    expect(programFor("sv10.5b-082")?.trainer).toEqual([{ op: "healEach", amount: 40 }]);
    expect(programFor("sv01-184")?.trainer).toEqual([{ op: "healEachAll", amount: 30 }]);
    // ⚠️ D266 — THE GATE IS ASSERTED PRESENT ON ONE ROW AND ABSENT ON THE OTHER,
    // in the same `toEqual`, because "absent means ungated" is the fact the two
    // sentences differ by. Fennel's object above carries NO `pokemonType` key.
    expect(programFor("sv08-167")?.trainer).toEqual([
      { op: "healEach", amount: 60, pokemonType: "Lightning" },
    ]);
    expect(programFor("sv10-168")?.trainer).toHaveLength(2); // no recordGate…
    expect(programFor("sv01-179")?.trainer).toHaveLength(3); // …where Miriam has one
  });

  it("authors every program EXACTLY, ops named", () => {
    expect(programFor("sv10-122")?.triggered).toEqual([
      {
        name: "Biting Spree",
        trigger: "onEvolve",
        optional: true,
        program: [
          {
            op: "damageChosen",
            target: "opponentAny",
            amount: 20,
            count: 2,
            source: "ability",
            optional: true,
          },
        ],
      },
    ]);
    expect(programFor("sv10-121")?.triggered?.[0]?.program).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 20,
        count: 1,
        source: "ability",
        optional: true,
      },
    ]);
    expect(programFor("svp-118")?.abilities).toEqual([
      {
        name: "Attract Customers",
        oncePerTurn: true,
        activeOnly: true,
        program: [
          // D225's rider — "reveal a Supporter card you find there".
          { op: "lookAtTopN", n: 6, filter: { kind: "supporter" }, max: 1, reveal: true },
          { op: "shuffleDeck" },
        ],
      },
    ]);
    expect(programFor("sv09-031")?.abilities?.[0]?.program).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
    expect(programFor("sv08-009")?.abilities?.[0]?.program).toEqual([
      { op: "applyStatus", target: "defender", status: "asleep" },
    ]);
    expect(programFor("sv08-004")?.triggered).toEqual([
      {
        name: "Sudden Shearing",
        trigger: "onPlayToBench",
        optional: true,
        program: [{ op: "discardDeckTop", whose: "opponent", count: 1 }],
      },
    ]);
    expect(programFor("sv09-136")?.triggered?.[0]).toMatchObject({
      trigger: "onEvolve",
      program: [{ op: "gust" }],
    });
    expect(programFor("sv10.5w-013")?.abilities?.[0]).toMatchObject({
      oncePerTurn: false,
      program: [{ op: "attachEnergyFrom", source: "hand", energyType: "Fire" }],
    });
    expect(programFor("sv09-024")?.abilities?.[0]?.program).toEqual([
      { op: "attachEnergyFrom", source: "discard" },
    ]);
    // ── D263. The three rows are spelled EXACTLY, because each is the row above
    //    plus riders and a missing rider is invisible in a `toMatchObject`. ──
    expect(programFor("sv10-020")?.abilities).toEqual([
      {
        name: "Charging Up",
        oncePerTurn: true,
        activeOnly: false,
        program: [{ op: "attachEnergyFrom", source: "discard", toSelf: true }],
      },
    ]);
    expect(programFor("sv10.5b-031")?.abilities).toEqual([
      {
        name: "Dynamotor",
        oncePerTurn: true,
        activeOnly: false,
        program: [
          { op: "attachEnergyFrom", source: "discard", energyType: "Lightning", benchOnly: true },
        ],
      },
    ]);
    // ⚠️ TWO ops, not `count: 2` — the printed "in any way you like" (D205), and
    // the one claim about this program a reader is most likely to get wrong.
    // 🆕 D358 — and each op carries `declinable: true`, the printed "up to 2".
    // The two fields answer different questions and both are spelled here: `count`
    // (absent) would pin the pair to ONE body, `declinable` lets the player stop
    // after the first. `optional: true` above is a THIRD thing again — the
    // trigger's own "you may", which buys only the empty answer (§9.1).
    expect(programFor("sv08-130")?.triggered).toEqual([
      {
        name: "Assemble Alloy",
        trigger: "onEvolve",
        optional: true,
        program: [
          {
            op: "attachEnergyFrom",
            source: "discard",
            energyType: "Metal",
            targetType: "Metal",
            declinable: true,
          },
          {
            op: "attachEnergyFrom",
            source: "discard",
            energyType: "Metal",
            targetType: "Metal",
            declinable: true,
          },
        ],
      },
    ]);
    expect(programFor("sv09-075")?.abilities?.[0]?.program).toEqual([
      { op: "healChosen", amount: 30 },
    ]);
    expect(programFor("sv08.5-077")?.passive).toEqual({ statusImmunities: ["asleep"] });
    expect(programFor("sv10-155")?.abilities?.[0]?.program).toEqual([
      { op: "payFromHand", count: 2, to: "discard" },
      { op: "drawCards", count: 1 },
    ]);
    expect(programFor("sv08-052")?.abilities?.[0]?.program).toEqual([
      { op: "payFromHand", count: 1, to: "deckBottom" },
      { op: "drawUntilHandSize", size: 5 },
    ]);
    expect(programFor("sv06-148")?.trainer).toEqual([
      { op: "discardEnergy", from: "opponentChosen", filter: { kind: "specialEnergy" } },
    ]);
    expect(programFor("sv06.5-061")?.trainer).toEqual([
      {
        op: "discardPileRetrieval",
        filter: { kind: "pokemonOrBasicEnergy" },
        dest: "hand",
        max: 1,
      },
    ]);
    expect(programFor("sv08.5-116")?.trainer).toEqual([
      {
        op: "discardPileRetrieval",
        filter: { kind: "pokemonOrBasicEnergy" },
        dest: "hand",
        max: 5,
      },
    ]);
    expect(programFor("sv08-183")?.trainer).toEqual([
      { op: "discardPileRetrieval", filter: { kind: "supporter" }, dest: "hand", max: 2 },
    ]);
    expect(programFor("sv10-164")?.trainer).toEqual([
      { op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "deck", max: 5 },
      { op: "shuffleDeck" },
    ]);
    expect(programFor("sv10-168")?.trainer).toEqual([
      { op: "discardPileRetrieval", filter: { kind: "anyPokemon" }, dest: "deck", max: 5 },
      { op: "shuffleDeck" },
    ]);
    // `reveal: true` on both — D225's printed-clause rider ("reveal it" /
    // "reveal them"); the `discardPileRetrieval` rows above take none, because
    // the discard pile is public and no §7.1 recovery Item prints the word.
    expect(programFor("sv05-153")?.trainer).toEqual([
      { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 1, reveal: true },
      { op: "shuffleDeck" },
    ]);
    expect(programFor("sv08.5-131")?.trainer).toEqual([
      { op: "searchDeck", filter: { kind: "toolCard" }, dest: "hand", max: 5, reveal: true },
      { op: "shuffleDeck" },
    ]);
    expect(programFor("sv06.5-058")?.trainer).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
      { op: "applyStatus", target: "defender", status: "confused" },
    ]);
    // 🆕 D343 — the THIRD op is the printed "in any order", and it is inside the
    // gate rather than beside the payment: `recordGateHolds` is "anything filed",
    // so a run that paid nothing never opens an ordering window over two cards
    // nobody put there. Order within the gate is printed too — the sentence
    // finishes the putting before it starts the drawing.
    expect(programFor("sv07-138")?.trainer).toEqual([
      { op: "payFromHand", count: 2, to: "deckBottom", recordAs: "paid" },
      {
        op: "recordGate",
        slot: "paid",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "reorderTop", n: 2, from: "bottom" },
          { op: "drawCards", count: 4 },
        ],
      },
    ]);
    expect(programFor("sv05-154")?.passive).toEqual({
      damageBonusBeforeWRIfTarget: { amount: 50, targetSuffix: "ex" },
    });
    expect(programFor("sv06.5-055")?.passive).toEqual({
      damageBonusBeforeWRIf: { amount: 40, cond: { kind: "yourActivePoisoned" } },
    });
    expect(programFor("sv09-150")?.stadium).toEqual({
      ability: {
        label: "Levincia",
        program: [
          {
            op: "discardPileRetrieval",
            filter: { kind: "basicEnergy", energyType: "Lightning" },
            dest: "hand",
            max: 2,
          },
        ],
      },
    });
    expect(programFor("sv09-159")?.energy).toEqual({
      provides: ["Colorless"],
      passive: { damageAttacker: { amount: 20 } },
    });
  });

  it("⚠️ the DROPPED sentences are still UNBUILT — the work order cannot rot", () => {
    for (const { sentence, ids } of DROPPED) {
      for (const id of ids) {
        expect(programFor(id), `${id} (${sentence.slice(0, 40)}…) was half-built`).toBeUndefined();
      }
    }
    // The list's own arithmetic: 13 sentences (20 at D199 — the Iono's attach was
    // built by D204, Lacey's prize gate by D207, the §8.1 KO-survival clamp by
    // D208, **Blood Moon's cost discount by D242, whose `needs` string turned
    // out to be false about the card rather than expensive**, and **Iron Leaves
    // ex's on-bench switch by D244, whose `needs` string was RIGHT on all three
    // pieces — the first row here to be built without a correction**, and
    // **Genesect ex's typed Evolution search by D245, whose `needs` string was
    // right, was SATISFIED at D238, and still left the card unbuilt for seven
    // decisions because it priced the axis and not the value**, and **Hydrapple
    // ex's heal-on-attach Ability by D249, whose `needs` string was right about
    // the OBSTACLE and wrong about the ROAD — it named a §9.2 record the shipped
    // program does not carry**), and every one of them names its missing piece
    // rather than shrugging.
    // ⚠️ THE PROSE ABOVE SAID **15** AGAINST AN ASSERTION OF **14** AT D248's
    // HEAD, and D249 found it while decrementing: a narrative count beside a
    // machine-checked one drifts in the direction only the machine notices. The
    // number below is the authority; the sentence now quotes it.
    // ⚠️ D251 DECREMENTS IT AGAIN (13 → 12) — Cornerstone Mask Ogerpon ex's
    // attacker-HAS-AN-ABILITY prevent, and the SECOND row here to be built with no
    // correction to its `needs` string (D244's was the first). See
    // `cornerstoneStance.test.ts`.
    // ⚠️ D265 DECREMENTS IT AGAIN (9 → 8) — Alomomola's "Gentle Fin", and the
    // FIRST row here whose `needs` string was right in full. See the annotation
    // where the row stood.
    // ⚠️ D266 DECREMENTS IT AGAIN (8 → 7) — Clemont's Quick Wit, the TYPE gate on
    // `healEach`, and the SECOND consecutive row whose `needs` string was right.
    // 🆕 It was right about the PIECE and silent about the ZONE, which is the
    // refinement this slice adds to the rule: naming `Card.types` does not say
    // whether the read is of a CARD or of a BOARD, and the two have different
    // instruments (`CardFilter.typedPokemon` vs an op field beside `targetType`).
    // ⚠️ D267 DECREMENTS IT AGAIN (7 → 6) — Latias ex's "Skyliner", the STAGE gate
    // on `noRetreatCostAura`.
    // ⚠️ D268 DECREMENTS IT AGAIN (6 → 5) — Gothitelle's "Distorted Future",
    // `handRefresh.who: "opponent"`, and the FOURTH consecutive row whose `needs`
    // string was right about the code. 🆕 Its refinement: the string priced the
    // widening by "there is already a read site (Iono/Judge)" and every Iono and
    // Judge printing is `legal_standard = 0`, so the precedent it cited is a
    // REGISTRY fact and not a LEGAL one. Both are true; they are not the same
    // claim, and only one of them belongs in a sentence about printings.
    // 🆕 **D330 RE-PRICED ALL FOUR REMAINING ROWS AGAINST THE CODE AND TWO OF
    // THEM WERE ROTTED IN THE SAME DIRECTION — THE *ALREADY-BUILT* MODE, WHICH IS
    // NOW THE COMMONEST OF THE FOUR AND HAS CLAIMED FIVE ROWS.** The aura row asked
    // for `seatDamageBonusBeforeWR` without naming it (D243) and named a "cheapest
    // entry point" that was itself BUILT; the `lookAtTopN` row called
    // `{ kind: "trainerCard" }` absent when it was a fully wired union member.
    // 🛑 **AND THE SECOND ONE IS A NEW SHAPE: THE PIECE WAS NOT MERELY BUILT, IT
    // WAS GREEN ON EVERY LINE AND DEAD TO EVERY PRINTED CARD.** `trainerCard` had
    // `matchesFilter`, `retrieveNoun` and `HAND_SEARCH_NOUNS` rows and ZERO registry
    // consumers, so every instrument this repo owns said it was fine and no printed
    // sentence depended on it. **REACHING A LINE IS NOT A CARD DEPENDING ON IT**,
    // and a `needs` string written by someone grepping for a CARD will call such a
    // member missing every time. The cheap check: grep the UNION, not the registry.
    // 🛑 **AND BOTH CORRECTIONS WERE INVISIBLE TO THE ASSERTION BELOW, BECAUSE
    // THE CARDS THEY FREED ARE NAMED ONLY IN PROSE.** Florges `sv06-088` lives in a
    // `needs` string and Team Rocket's Petrel `sv10-176`/`-226` in a PARENTHETICAL;
    // neither is in any row's `ids`, so D330 built three legal printings out of this
    // table while `DROPPED` stayed at 4 and nothing here moved. **THIS GUARD COVERS
    // THE ids AND NOT THE REASONS**, which is the quiet rot direction the Charging Up
    // note above names — and it is now on record twice.
    // 🆕 **D331 IS THE FIRST SLICE IN THIS SERIES WHOSE BUILD ACTUALLY MOVES THIS
    // NUMBER**, 4 -> 3, because unlike Florges and Team Rocket's Petrel the card it
    // shipped is named in a row's own `ids` and not merely in a `needs` string. That
    // is the contrast the note above was written for: the guard covers the ids, so it
    // fires exactly when the ids are built and stays silent when the prose rots.
    expect(DROPPED).toHaveLength(2);
    for (const d of DROPPED) {
      expect(d.needs.length, `${d.sentence.slice(0, 30)}… has no reason`).toBeGreaterThan(80);
      expect(d.ids, `${d.sentence.slice(0, 30)}… miscounts its printings`).toHaveLength(d.legal);
    }
  });
});

// ── The evolve-trigger family ────────────────────────────────────────────────

describe("Biting Spree / Sneaky Bite — driven through the real engine", () => {
  /** P1 on turn 3 with a fix-basic-1 Active to evolve, `evo` in hand; P2 with an
      Active and two Benched bodies. */
  function evolveBoard(seed: number, evo: string): GameState {
    let state = withActive(seed, "fix-basic-1", 3);
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-bigbody");
    state = benchFromDeck(state, "p2", "fix-bigbody");
    return toHand(state, evo);
  }

  const evolveActive = (state: GameState, evo: string) =>
    ({
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", evo),
      target: { spot: "active" },
    }) as const;

  it("offers the opponent's ACTIVE as a target — `opponentAny`, not `opponentBench`", () => {
    const state = deepFreeze(evolveBoard(1, "fix-bitingspree"));
    const { state: parked } = mustApply(state, evolveActive(state, "fix-bitingspree"));
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemonMulti")
      throw new Error("expected choosePokemonMulti");
    const prompt = parked.phase.prompt;
    // ⚠️ THE MUTANT THIS KILLS: `target: "opponentBench"` (Hawlucha's value, and
    // the value a copy of Hawlucha's program would carry). The printed noun is
    // "your opponent's Pokémon" with no zone word, so the Active is a candidate.
    expect(prompt.candidates.some((c) => c.spot.spot === "active" && c.seat === "p2")).toBe(true);
    expect(prompt.candidates).toHaveLength(3); // Active + 2 Benched
    // "choose 2" is exact — a floor as well as a ceiling — and "you may" makes
    // NONE legal (`optional`), which is the only partiality allowed.
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    expect(prompt.declinable).toBe(true);
  });

  it("puts 2 damage counters (20 HP) on EACH of the two picks", () => {
    const state = evolveBoard(2, "fix-bitingspree");
    const { state: parked } = mustApply(state, evolveActive(state, "fix-bitingspree"));
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemonMulti")
      throw new Error("expected choosePokemonMulti");
    const refs = parked.phase.prompt.candidates;
    const active = refs.find((r) => r.spot.spot === "active");
    const bench0 = refs.find((r) => r.spot.spot === "bench");
    if (active === undefined || bench0 === undefined) throw new Error("missing candidates");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [active, bench0] },
    });
    const placed = findAll(events, "COUNTERS_PLACED");
    expect(placed).toHaveLength(2);
    // ⚠️ THE MUTANT THIS KILLS: `amount: 10` (one counter — the number Hawlucha
    // prints, and the units slip this family is one conversion away from).
    for (const e of placed) expect(e.amount).toBe(20);
    // Counters, never attack damage: the row says "Ability" and no W/R applies.
    for (const e of placed) expect(e.source).toBe("ability");
    expect(done.players.p2.active?.damage).toBe(20);
    expect(done.players.p2.bench[0]?.damage).toBe(20);
    expect(done.players.p2.bench[1]?.damage).toBe(0);
  });

  it("Sneaky Bite asks for exactly ONE — the `count` that separates it from its own evolution", () => {
    const state = evolveBoard(3, "fix-sneakybite");
    const { state: parked } = mustApply(state, evolveActive(state, "fix-sneakybite"));
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemonMulti")
      throw new Error("expected choosePokemonMulti");
    expect(parked.phase.prompt.min).toBe(1);
    expect(parked.phase.prompt.max).toBe(1);
  });

  it("Defiant Horn GUSTS on evolve — the opponent's Benched body becomes their Active", () => {
    const state = evolveBoard(4, "fix-defianthorn");
    const benchedUid = state.players.p2.bench[0]?.stack[0];
    const { state: parked } = mustApply(state, evolveActive(state, "fix-defianthorn"));
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    const pick = parked.phase.prompt.candidates.find(
      (c) => c.spot.spot === "bench" && c.spot.index === 0,
    );
    if (pick === undefined) throw new Error("no bench candidate");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: pick },
    });
    expect(types(events)).toContain("POKEMON_SWITCHED");
    expect(done.players.p2.active?.stack[0]).toBe(benchedUid);
  });
});

describe("Sudden Shearing — driven through the real engine", () => {
  it("mills the OPPONENT's deck top, not the controller's", () => {
    let state = withActive(5, "fix-bigbody");
    state = toHand(state, "fix-suddenshearing");
    const uid = handUid(state, "p1", "fix-suddenshearing");
    const oppTop = state.players.p2.deck[0];
    const ownDeckBefore = state.players.p1.deck.length;
    const ownDiscardBefore = state.players.p1.discard.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p1",
      ability: "Sudden Shearing",
    });
    // ⚠️ THE MUTANT THIS KILLS: `whose: "self"`. Both halves are asserted, because
    // one of them alone is satisfied by a program that mills nobody.
    expect(done.players.p2.discard).toContain(oppTop);
    expect(done.players.p2.deck[0]).not.toBe(oppTop);
    expect(done.players.p1.deck).toHaveLength(ownDeckBefore);
    expect(done.players.p1.discard).toHaveLength(ownDiscardBefore);
  });
});

// ── The activated-Ability family ─────────────────────────────────────────────

describe("Attract Customers — driven through the real engine", () => {
  it("looks at the top SIX only — a Supporter at depth 7 is not a candidate", () => {
    let state = withActive(6, "fix-attractcustomers");
    // Bury a Supporter at depth 7 (below the window), then five fillers, then a
    // Supporter on top: the window holds exactly ONE match.
    state = toDeckTop(stocked(state, "p1", "sv01-180"), "p1", "sv01-180", 1); // …depth 7 after the pushes below
    state = toDeckTop(state, "p1", "fix-bigbody", 5);
    state = toDeckTop(state, "p1", "sv01-180", 1);
    const inWindow = state.players.p1.deck[0] as string;
    const belowWindow = state.players.p1.deck[6] as string;
    deepFreeze(state);
    const { state: parked } = mustApply(state, useOn("Attract Customers"));
    const prompt = cardsPrompt(parked);
    // ⚠️ THE MUTANTS THIS KILLS: `n: 7` (Pokégear's window — the deeper Supporter
    // would appear) and `filter: anyPokemon` (the five fillers would appear).
    expect(prompt.candidates).toEqual([inWindow]);
    expect(prompt.candidates).not.toContain(belowWindow);
    expect(prompt.max).toBe(1);
    const { state: done, events } = chooseCards(parked, [inWindow]);
    expect(done.players.p1.hand).toContain(inWindow);
    // "Shuffle the other cards back into your deck" — the trailing op.
    expect(types(events)).toContain("SHUFFLE");
  });

  it("is ACTIVE-ONLY and ONCE per turn — both printed clauses", () => {
    let state = withActive(7, "fix-bigbody");
    state = benchFromDeck(state, "p1", "fix-attractcustomers");
    const fromBench = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Attract Customers",
    });
    expect(fromBench.ok).toBe(false);
    if (!fromBench.ok) expect(fromBench.error.code).toBe("ABILITY_ACTIVE_ONLY");

    let live = withActive(8, "fix-attractcustomers");
    live = toDeckTop(stocked(live, "p1", "sv01-180"), "p1", "sv01-180", 1);
    const { state: parked } = mustApply(live, useOn("Attract Customers"));
    const done = chooseCards(parked, [cardsPrompt(parked).candidates[0] as string]).state;
    const again = applyAction(done, useOn("Attract Customers"));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ABILITY_ALREADY_USED");
  });
});

describe("Scalding Steam / Calming Light / Dangerous Laser — the §12 writers", () => {
  it("Scalding Steam BURNS the OPPONENT's Active, and leaves the controller's alone", () => {
    const state = deepFreeze(withActive(9, "fix-scaldingsteam"));
    const { state: done, events } = mustApply(state, useOn("Scalding Steam"));
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "burned" });
    expect(done.players.p2.active?.conditions.burned).toBe(true);
    // ⚠️ TWO MUTANTS AT ONCE: `target: "self"` (the controller would burn) and
    // `status: "asleep"` (the rotation slot would move instead of the flag).
    expect(done.players.p1.active?.conditions.burned).toBe(false);
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("Calming Light puts the OPPONENT's Active ASLEEP — the rotation slot, not the Burn flag", () => {
    const state = deepFreeze(withActive(10, "fix-calminglight"));
    const { state: done, events } = mustApply(state, useOn("Calming Light"));
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "asleep" });
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
    expect(done.players.p2.active?.conditions.burned).toBe(false);
  });

  it("Dangerous Laser lands BOTH conditions — two ops, two places on the model", () => {
    const state = deepFreeze(board(11, TRN_DECK));
    const { state: done, events } = playFromHand(state, "fix-dangerouslaser");
    const applied = findAll(events, "STATUS_APPLIED").map((e) => e.status);
    // ⚠️ THE MUTANT THIS KILLS: dropping either op. Both are asserted, and they
    // land in different fields, so one cannot be mistaken for the other.
    expect(applied).toEqual(["burned", "confused"]);
    expect(done.players.p2.active?.conditions.burned).toBe(true);
    expect(done.players.p2.active?.conditions.rotation).toBe("confused");
  });
});

describe("Insomnia — the §12 IMMUNITY, driven through a real attack", () => {
  it("REFUSES the Sleep an attack tries to apply — and the same attack lands it on a body without it", () => {
    // fix-attacker's index-2 "Yawn" prints "Your opponent's Active Pokémon is now
    // Asleep." and DERIVES, so the sleep arrives through the real §12 writer.
    const yawn = { type: "attack", seat: "p2", index: 2 } as const;
    let state = board(12, MON_DECK, 2); // P2 to move
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    state = clearBench(state, "p2");
    state = setActiveFromDeck(state, "p1", "fix-insomnia");
    state = clearBench(state, "p1");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, yawn);
    expect(find(events, "STATUS_PREVENTED")).toMatchObject({ seat: "p1", status: "asleep" });
    expect(done.players.p1.active?.conditions.rotation).toBe("none");

    // The non-vacuous control: the SAME attack on a body without the Ability.
    let control = board(13, MON_DECK, 2);
    control = setActiveFromDeck(control, "p2", "fix-attacker");
    control = clearBench(control, "p2");
    control = setActiveFromDeck(control, "p1", "fix-bigbody");
    control = clearBench(control, "p1");
    const after = mustApply(control, yawn).state;
    expect(after.players.p1.active?.conditions.rotation).toBe("asleep");
  });
});

describe("Inferno Fandango / Seething Spirit — the attachEnergyFrom rows", () => {
  it("Inferno Fandango attaches a Basic FIRE from HAND and is repeatable in one turn", () => {
    let state = withActive(14, "fix-infernofandango");
    state = handFromDeck(stocked(state, "p1", "fix-fire-energy"), "p1", "fix-fire-energy", 2);
    deepFreeze(state);
    const first = mustApply(state, useOn("Inferno Fandango"));
    // One eligible target (the Active alone) and interchangeable Energy → forced.
    expect(first.state.players.p1.active?.energy).toHaveLength(1);
    // ⚠️ THE MUTANT THIS KILLS: `oncePerTurn: true`. "As often as you like" is the
    // printed clause, and Baxcalibur is the only other card in the file with it.
    const second = mustApply(first.state, useOn("Inferno Fandango"));
    expect(second.state.players.p1.active?.energy).toHaveLength(2);
    expect(findAll(second.events, "ENERGY_ATTACHED")).toHaveLength(1);
  });

  it("Inferno Fandango is REFUSED with only a non-Fire Basic Energy in hand — the `energyType` gate", () => {
    let state = withActive(15, "fix-infernofandango");
    state = handFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 2); // Colorless-providing basics
    // Strip any Fire the opening hand happens to hold, so the only Basic Energy
    // in hand is the wrong type.
    const side = state.players.p1;
    const fires = side.hand.filter((u) => state.cardIdByUid[u] === "fix-fire-energy");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          hand: side.hand.filter((u) => !fires.includes(u)),
          deck: [...side.deck, ...fires],
        },
      },
    };
    const rejected = applyAction(state, useOn("Inferno Fandango"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("Seething Spirit attaches from the DISCARD PILE, not the hand", () => {
    let state = withActive(16, "fix-seethingspirit");
    state = discardFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    const fromPile = state.players.p1.discard[state.players.p1.discard.length - 1] as string;
    const handBefore = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, useOn("Seething Spirit"));
    expect(find(events, "ENERGY_ATTACHED")?.uid).toBe(fromPile);
    // ⚠️ THE MUTANT THIS KILLS: `source: "hand"` (Quaquaval's value). The pile
    // shrank and the hand did not.
    expect(done.players.p1.discard).not.toContain(fromPile);
    expect(done.players.p1.hand).toHaveLength(handBefore);
    expect(done.players.p1.active?.energy).toContain(fromPile);
  });
});

// ── D263 — THE ABILITY HALF OF BACKLOG ROW 9 ────────────────────────────────
//
// The `%attach%…%discard pile%` ladder run at D263 (all three text columns,
// `json_each`, case-insensitive, `legal_standard = 1`, GROUPED BY SENTENCE,
// remote D1 `luminous`, 2026-08-07) returns **38 printings on 24 sentences**:
// ability 14/7, attack 17/12, effect 7/5. 🛑 **RUNG 1 — the resume point's own
// `%from your discard pile%attach%` — RETURNS ZERO ROWS**, because this corpus
// prints the verb FIRST every single time ("Attach … from your discard pile"),
// never the reverse. The phrase order was a guess and the ladder falsified it on
// the first rung, which is exactly what a ladder is for.
//
// Subtracting the ONE false positive (Huntail `sv10-055` "Diver's Catch", which
// says "instead of the discard pile" and is a KO-trigger recovery, not an attach)
// leaves **ability 13 / 6 sentences** — D234's figure to the digit, re-derived
// rather than inherited. One printing was authored (`sv09-024`); these three
// sentences are 7 more, and the residue is **5 on 2 sentences, both seam-blocked**:
//   • Magneton `svp-153`/`svp-159`/`sv08-059` "Overvolt Discharge" (3) — the
//     attach is expressible (3 ops, `targetType: "Lightning"`), but the second
//     printed clause is "If you use this Ability, this Pokémon is Knocked Out"
//     and NO OP IN THE ENGINE KNOCKS OUT ITS OWN HOST. Grepped, not assumed.
// ✅✅ **D346 TOOK IT, AND THIS BULLET WAS RIGHT ALL ALONG — WHICH IS THE FINDING.**
//     `knockOutSelf` landed at D345 and spent the ONE blocker named here, so the card
//     became a registry row and nothing else. But D345 did not read this bullet: it
//     wrote a NEW residue note claiming the *"in any way you like"* DISTRIBUTION was a
//     second blocker, and propagated it to NINE FILES. That was false when written —
//     the phrase at a PRINTED COUNT is N `attachEnergyFrom` ops, which is D263's own
//     `ASSEMBLE_ALLOY` two screens down and `attachEnergyFrom.count`'s doc since D205.
// 🛑🛑 **THE TRANSFERABLE LESSON, AND IT IS THE EXPENSIVE HALF OF D341's.**
//     D341/D344 found residue notes that rotted by STANDING STILL while the code moved;
//     those re-derive, because note and code disagree and the code wins. **This one
//     rotted by being REWRITTEN**, and a rewritten note disagrees with nothing: it
//     carries a fresh decision's authority, names a real mechanism, and routes the next
//     slice past a card that is already buildable. **WHEN A SLICE SPENDS A BLOCKER, THE
//     NOTE THAT NAMED IT MUST BE DELETED — not re-pointed at the next mechanism that
//     comes to mind without re-running the method's step (3) against the code.**
//     The `DROPPED`-rots-in-both-directions rule D263 wrote is the same rule; this is
//     its third direction, and the only one no assertion can see.
//   • Lycanroc `sv09-085`/`sv09-166` "Spike-Clad" (2) — "up to 2 **Spiky Energy**
//     cards", a card named by NAME. `attachEnergyFrom` narrows by `energyType`
//     and `anyEnergy` and has no name axis; `CardFilter.byName` exists one op
//     over, and D246 refused to give this op a filter for a measured reason.
//
// ⚠️ WHAT THIS SUITE CAN AND CANNOT PUT RED, SAID UP FRONT (the guard rule):
// * Dropping `toSelf` from Charging Up parks instead of forcing on the boards
//   below — they hold TWO eligible own bodies — and the Energy may land on the
//   Bench. BOTH halves are asserted, because either alone is satisfied by a
//   program that attaches nothing.
// * Dropping `benchOnly` from Dynamotor feeds the HOLDER, which is the Active on
//   every board here. Asserted as "the Active ends with zero Energy".
// * Changing Dynamotor's `energyType` is caught by the Colorless-pile case.
// * Dropping ONE of Assemble Alloy's two ops, or welding them into `count: 2`,
//   is caught by the two-park case: `count` pins the batch to one body, and the
//   board below lands one Energy on EACH of two.
// * Dropping `targetType` is caught by the candidate-set assertion (the Colorless
//   `fix-bigbody` on the Bench must never be offered).
// * Dropping `optional` changes no behaviour today (`TriggeredAbility.optional`
//   AUTO-FIRES), so it is killed by the DECLARATION snapshot above and by nothing
//   else — the same verdict `battleHardened.test.ts` records for its own.

describe("Charging Up / Dynamotor / Assemble Alloy — the discard-attach ABILITY rows", () => {
  /** The last uid pushed onto P1's discard pile. */
  const topOfPile = (state: GameState): string =>
    state.players.p1.discard[state.players.p1.discard.length - 1] as string;

  it("Charging Up feeds ITSELF from the pile, with a second own body standing right there", () => {
    let state = withActive(60, "fix-chargingup", 3, ALLOY_DECK);
    state = benchFromDeck(state, "p1", "fix-bigbody");
    state = discardFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    const fromPile = topOfPile(state);
    const handBefore = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, useOn("Charging Up"));
    // ⚠️ THE MUTANT THIS KILLS: dropping `toSelf` (Seething Spirit's shape). Two
    // own bodies are eligible under the un-narrowed reading, so the op would PARK.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(find(events, "ENERGY_ATTACHED")?.uid).toBe(fromPile);
    expect(done.players.p1.active?.energy).toContain(fromPile);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(0);
    // The PILE shrank and the hand did not — `source: "discard"`, not "hand".
    expect(done.players.p1.discard).not.toContain(fromPile);
    expect(done.players.p1.hand).toHaveLength(handBefore);
  });

  it("Dynamotor attaches a Basic {L} to the BENCH and never to its own holder", () => {
    let state = withActive(61, "fix-dynamotor", 3, ALLOY_DECK);
    state = benchFromDeck(state, "p1", "fix-bigbody");
    state = discardFromDeck(
      stocked(state, "p1", "fix-lightning-energy"),
      "p1",
      "fix-lightning-energy",
      1,
    );
    const fromPile = topOfPile(state);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, useOn("Dynamotor"));
    expect(find(events, "ENERGY_ATTACHED")?.uid).toBe(fromPile);
    expect(done.players.p1.bench[0]?.energy).toContain(fromPile);
    // ⚠️ THE MUTANT THIS KILLS: dropping `benchOnly`. The holder is the Active and
    // is the FIRST ref `attachEnergyTargets` offers, so the defect is invisible on
    // any board that only checks "did the Bench get one".
    expect(done.players.p1.active?.energy).toHaveLength(0);
  });

  it("Dynamotor is REFUSED with only a Colorless Basic in the pile — the `energyType` gate", () => {
    let state = withActive(62, "fix-dynamotor", 3, ALLOY_DECK);
    state = benchFromDeck(state, "p1", "fix-bigbody");
    state = discardFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 2);
    // Non-vacuous: a Bench target EXISTS, so the refusal can only be the type.
    expect(state.players.p1.bench).toHaveLength(1);
    const rejected = applyAction(state, useOn("Dynamotor"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("Dynamotor is REFUSED on an EMPTY Bench even with the right Energy in the pile", () => {
    let state = withActive(63, "fix-dynamotor", 3, ALLOY_DECK);
    state = discardFromDeck(
      stocked(state, "p1", "fix-lightning-energy"),
      "p1",
      "fix-lightning-energy",
      2,
    );
    expect(state.players.p1.bench).toHaveLength(0);
    const rejected = applyAction(state, useOn("Dynamotor"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("NO_LEGAL_TARGET");
  });

  /** P1 on turn 3 with a `fix-basic-1` Active to evolve, a {M} body and a
      Colorless body on the Bench, `n` Basic {M} Energy in the pile, and the
      carrier in hand. */
  function alloyBoard(seed: number, metalInPile: number): GameState {
    let state = withActive(seed, "fix-basic-1", 3, ALLOY_DECK);
    state = benchFromDeck(state, "p1", "fix-metalbody");
    state = benchFromDeck(state, "p1", "fix-bigbody");
    state = discardFromDeck(
      stocked(state, "p1", "fix-metal-energy"),
      "p1",
      "fix-metal-energy",
      metalInPile,
    );
    return toHand(state, "fix-assemblealloy");
  }

  const evolveIntoAlloy = (state: GameState) =>
    ({
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-assemblealloy"),
      target: { spot: "active" },
    }) as const;

  function pickTarget(state: GameState, spot: "active" | "bench", index = 0) {
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (state.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    const ref = state.phase.prompt.candidates.find((c) =>
      spot === "active"
        ? c.spot.spot === "active"
        : c.spot.spot === "bench" && c.spot.index === index,
    );
    if (ref === undefined) throw new Error(`no ${spot} candidate`);
    return mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref },
    });
  }

  it("offers only the {M} bodies — the Colorless Bench body is not a candidate", () => {
    const state = deepFreeze(alloyBoard(64, 2));
    const { state: parked } = mustApply(state, evolveIntoAlloy(state));
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    const candidates = parked.phase.prompt.candidates;
    // ⚠️ THE MUTANT THIS KILLS: dropping `targetType`. Three own bodies are in
    // play and only TWO of them are {M} — the freshly evolved Active and
    // `fix-metalbody`. `fix-bigbody` on bench index 1 is Colorless.
    expect(candidates).toHaveLength(2);
    expect(candidates.some((c) => c.spot.spot === "bench" && c.spot.index === 1)).toBe(false);
    expect(candidates.some((c) => c.spot.spot === "active")).toBe(true);
  });

  it("asks TWICE and may land the two Energy on DIFFERENT bodies — 'in any way you like'", () => {
    const state = alloyBoard(65, 2);
    const { state: parked } = mustApply(state, evolveIntoAlloy(state));
    // First decision → the Active. Second decision → the benched {M} body.
    const { state: mid } = pickTarget(parked, "active");
    expect(mid.phase.kind).toBe("effect:choose");
    const { state: done, events } = pickTarget(mid, "bench", 0);
    expect(done.phase.kind).not.toBe("effect:choose");
    // ⚠️ THE MUTANT THIS KILLS: welding the two ops into one `count: 2`. A pinned
    // batch puts BOTH Energy on the one chosen body; two ops put one on each.
    expect(done.players.p1.active?.energy).toHaveLength(1);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(0);
    expect(findAll(events, "ENERGY_ATTACHED")).toHaveLength(1); // the second op's
  });

  it("attaches what the pile HAS and stops — one {M} in the pile is one attach", () => {
    const state = alloyBoard(66, 1);
    const pileBefore = state.players.p1.discard.filter(
      (u) => state.cardIdByUid[u] === "fix-metal-energy",
    ).length;
    expect(pileBefore).toBe(1);
    const { state: parked } = mustApply(state, evolveIntoAlloy(state));
    const { state: done } = pickTarget(parked, "active");
    // The printed "up to": the second op finds an empty pile and whiffs rather
    // than parking again, so the program completes with ONE Energy moved.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.active?.energy).toHaveLength(1);
    expect(
      done.players.p1.discard.filter((u) => done.cardIdByUid[u] === "fix-metal-energy"),
    ).toHaveLength(0);
  });

  it("does nothing at all when the pile holds no Basic {M} — the `energyType` gate on a TRIGGER", () => {
    let state = withActive(67, "fix-basic-1", 3, ALLOY_DECK);
    state = benchFromDeck(state, "p1", "fix-metalbody");
    state = discardFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 3);
    state = toHand(state, "fix-assemblealloy");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, evolveIntoAlloy(state));
    // The trigger still FIRES (it is not gated on the pile) — it just moves nothing.
    expect(types(events)).toContain("ABILITY_TRIGGERED");
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(findAll(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.active?.energy).toHaveLength(0);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(0);
  });
});

describe("Confectionary Gift — driven through the real engine", () => {
  it("heals exactly 30 from a CHOSEN one of your Pokémon", () => {
    let state = withActive(17, "fix-confectionarygift");
    state = setDamage(state, "p1", 100);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, useOn("Confectionary Gift"));
    // ⚠️ THE MUTANT THIS KILLS: `amount: "all"` (Arboliva's value — the same op,
    // the neighbouring literal). 100 → 70, not 100 → 0.
    expect(find(events, "HEALED")?.amount).toBe(30);
    expect(done.players.p1.active?.damage).toBe(70);
  });
});

describe("Reconstitute / Up-Tempo — the hand-cost rows", () => {
  it("Reconstitute pays TWO to the discard and draws ONE", () => {
    const state = withActive(18, "fix-reconstitute");
    const handBefore = state.players.p1.hand.length;
    const { state: parked } = mustApply(state, useOn("Reconstitute"));
    const prompt = cardsPrompt(parked);
    // ⚠️ THE MUTANT THIS KILLS: Trade's numbers (pay 1, draw 2).
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    const picks = prompt.candidates.slice(0, 2) as string[];
    const { state: done, events } = chooseCards(parked, picks);
    expect(find(events, "HAND_COST_PAID")?.uids).toEqual(picks);
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(1);
    for (const uid of picks) expect(done.players.p1.discard).toContain(uid);
    expect(done.players.p1.hand).toHaveLength(handBefore - 2 + 1);
  });

  it("Up-Tempo pays to the DECK BOTTOM — the first Ability in the registry that does", () => {
    // A 3-card hand, so paying 1 leaves 2 and the draw to 5 is OBSERVABLE. The
    // opening hand is already ≥5, where `drawUntilHandSize` correctly draws
    // nothing — a case that would have made this test vacuous.
    const state = trimHand(withActive(19, "fix-uptempo"), 3);
    const deckBefore = state.players.p1.deck.length;
    const discardBefore = state.players.p1.discard.length;
    const { state: parked } = mustApply(state, useOn("Up-Tempo"));
    const pick = cardsPrompt(parked).candidates[0] as string;
    const { state: done } = chooseCards(parked, [pick]);
    // ⚠️ THE MUTANT THIS KILLS: `to: "discard"` (every other Ability in the file).
    expect(done.players.p1.discard).toHaveLength(discardBefore);
    expect(done.players.p1.deck[done.players.p1.deck.length - 1]).toBe(pick);
    // …and the draw measures the hand AFTER the payment (3 − 1 = 2, so 3 drawn),
    // which is what the printed sentence order means.
    expect(done.players.p1.hand).toHaveLength(5);
    expect(done.players.p1.deck).toHaveLength(deckBefore + 1 - 3);
  });

  it("Up-Tempo draws NOTHING when the hand is already at 5 — the op reads the CURRENT hand", () => {
    const state = trimHand(withActive(45, "fix-uptempo"), 6);
    const { state: parked } = mustApply(state, useOn("Up-Tempo"));
    const { state: done, events } = chooseCards(parked, [
      cardsPrompt(parked).candidates[0] as string,
    ]);
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expect(done.players.p1.hand).toHaveLength(5);
  });

  it("Up-Tempo is REFUSED with an empty hand, and the message names the DESTINATION", () => {
    const state = withActive(20, "fix-uptempo");
    const emptied: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          hand: [],
          deck: [...state.players.p1.deck, ...state.players.p1.hand],
        },
      },
    };
    const rejected = applyAction(emptied, useOn("Up-Tempo"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe("ABILITY_COST_UNMET");
      // cardplay.ts wrote this message to read `to` rather than hard-code
      // "discard", and said in a comment that no printed Ability paid anywhere
      // else "today". This is that card; the generality is now exercised.
      expect(rejected.error.message).toContain("bottom of your deck");
      expect(rejected.error.message).not.toContain("discard");
    }
  });
});

// ── The Trainer rows ─────────────────────────────────────────────────────────

describe("Enhanced Hammer — driven through the real engine", () => {
  it("offers ONLY Special Energy on the opponent's board, and discards one", () => {
    let state = board(21, TRN_DECK);
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-bigbody");
    state = attachBenchFromDeck(stocked(state, "p2", "fix-special"), "p2", 0, "fix-special", 1);
    // A BASIC Energy on the opponent's Active — the card the narrowed filter must
    // refuse. Without it the test passes on `anyEnergy` too.
    state = stocked(state, "p2", "fix-energy");
    const withBasic = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active:
            state.players.p2.active === null
              ? null
              : {
                  ...state.players.p2.active,
                  energy: [
                    state.players.p2.deck.find(
                      (u) => state.cardIdByUid[u] === "fix-energy",
                    ) as string,
                  ],
                },
          deck: state.players.p2.deck.filter((u) => state.cardIdByUid[u] !== "fix-energy"),
        },
      },
    };
    const special = withBasic.players.p2.bench[0]?.energy[0] as string;
    const basic = withBasic.players.p2.active?.energy[0] as string;
    const { state: done, events } = playFromHand(withBasic, "fix-enhancedhammer");
    // ⚠️ THE MUTANT THIS KILLS: `filter: anyEnergy` (fix-hammer's value). With the
    // Basic on the Active in the offer there would be TWO candidates and the op
    // would PARK; the narrowed filter leaves exactly one, so it is FORCED and the
    // play settles straight back to the turn. The absence of the park is the
    // assertion, and the surviving Basic is its second half.
    expect(done.phase.kind).toBe("turn:action");
    expect(types(events)).toContain("ENERGY_DISCARDED");
    expect(done.players.p2.discard).toContain(special);
    expect(done.players.p2.bench[0]?.energy).toHaveLength(0);
    expect(done.players.p2.active?.energy).toEqual([basic]);
  });

  it("PARKS when the opponent holds TWO different Special Energy — the pick is real", () => {
    let state = board(46, TRN_DECK);
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-bigbody");
    state = attachBenchFromDeck(stocked(state, "p2", "fix-special"), "p2", 0, "fix-special", 1);
    state = stocked(state, "p2", "fix-special-2");
    const withSecond: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active:
            state.players.p2.active === null
              ? null
              : {
                  ...state.players.p2.active,
                  energy: [
                    state.players.p2.deck.find(
                      (u) => state.cardIdByUid[u] === "fix-special-2",
                    ) as string,
                  ],
                },
          deck: state.players.p2.deck.filter((u) => state.cardIdByUid[u] !== "fix-special-2"),
        },
      },
    };
    const { state: parked } = playFromHand(withSecond, "fix-enhancedhammer");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.discardable).toHaveLength(2);
    expect(parked.phase.prompt.scope).toEqual({ kind: "total", count: 1 });
  });

  it("is REFUSED into a board with no Special Energy — Crushing Hammer's gate, without the coin", () => {
    let state = board(22, TRN_DECK);
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    state = toHand(state, "fix-enhancedhammer");
    const rejected = applyAction(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-enhancedhammer"),
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("NO_LEGAL_TARGET");
  });
});

describe("Fennel — driven through the real engine", () => {
  it("heals 40 from EVERY one of the controller's Pokémon and NONE of the opponent's", () => {
    let state = board(23, TRN_DECK);
    state = setActiveFromDeck(state, "p1", "fix-bigbody");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-bigbody");
    state = setDamage(state, "p1", 100);
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    state = setDamage(state, "p2", 100);
    const withBenchDamage: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          bench: state.players.p1.bench.map((b, i) => (i === 0 ? { ...b, damage: 30 } : b)),
        },
      },
    };
    const { state: done, events } = playFromHand(withBenchDamage, "fix-fennel");
    expect(findAll(events, "HEALED")).toHaveLength(2);
    expect(done.players.p1.active?.damage).toBe(60);
    // Clamped per Pokémon: 30 damage heals 30, not 40.
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    // ⚠️ THE MUTANT THIS KILLS: `healEachAll` (Picnic Basket's op — the opponent
    // would heal too). The printed sentence has no "(both yours and your
    // opponent's)", and that absence is the whole difference between the ops.
    expect(done.players.p2.active?.damage).toBe(100);
  });
});

describe("Clemont's Quick Wit — the TYPE GATE on healEach, driven through the real engine", () => {
  /** P1 with a four-body board on `QUICKWIT_DECK`, every one of them damaged:
      Active a {L} at 100, bench 0 a {L} at 30 (BELOW the heal amount, so the
      clamp is observable), bench 1 a COLORLESS at 100 (the gate's negative) and
      bench 2 a {M}{L} at 100 (the `includes` witness). P2's Active is a {L} at
      100 too — the seat scope's negative, and the only thing that separates this
      op from `healEachAll`. */
  function quickWitBoard(seed: number): GameState {
    let state = board(seed, QUICKWIT_DECK);
    state = setActiveFromDeck(state, "p1", "fix-lightningbody");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-lightningbody");
    state = benchFromDeck(state, "p1", "fix-bigbody");
    state = benchFromDeck(state, "p1", "fix-dualtypebody");
    state = setDamage(state, "p1", 100);
    state = setActiveFromDeck(state, "p2", "fix-lightningbody");
    state = clearBench(state, "p2");
    state = setDamage(state, "p2", 100);
    const damage = [30, 100, 100];
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          bench: state.players.p1.bench.map((b, i) => ({ ...b, damage: damage[i] ?? b.damage })),
        },
      },
    };
  }

  it("heals 60 from each {L} body, clamped, and leaves the COLORLESS one alone", () => {
    const { state: done, events } = playFromHand(quickWitBoard(68), "fix-clemontsquickwit");
    // Three HEALED rows, not four: the Colorless bench body is skipped as
    // SILENTLY as an undamaged one, which is what a FILTER inside the loop means.
    expect(findAll(events, "HEALED")).toHaveLength(3);
    expect(done.players.p1.active?.damage).toBe(40);
    // Clamped per Pokémon, exactly as the ungated op already was: 30 heals 30.
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    // ⚠️ THE MUTANT THIS KILLS: a dropped `pokemonType` conjunct. Without the
    // gate this body heals to 40 and the card becomes Fennel with a bigger
    // number — the ONE assertion the whole slice exists for.
    expect(done.players.p1.bench[1]?.damage).toBe(100);
    // ⚠️ AND THIS ONE: `types` compared for equality (or `types[0]`) instead of
    // `includes`. A {M}{L} body IS a "{L} Pokémon" and must heal.
    expect(done.players.p1.bench[2]?.damage).toBe(40);
    // ⚠️ AND `healEachAll`: the OPPONENT's {L} Active is not "your {L} Pokémon",
    // and the gate does not make the seat scope any less load-bearing.
    expect(done.players.p2.active?.damage).toBe(100);
  });

  it("names the healed bodies by uid — the gate decides the EVENTS, not just the damage", () => {
    const state = quickWitBoard(69);
    const offType = state.players.p1.bench[1];
    const skipped = offType === undefined ? undefined : topUid(offType);
    expect(skipped).toBeDefined();
    const { state: done, events } = playFromHand(state, "fix-clemontsquickwit");
    const healed = findAll(events, "HEALED");
    expect(healed.every((e) => e.seat === "p1")).toBe(true);
    expect(healed.map((e) => e.amount)).toEqual([60, 30, 60]);
    // The Colorless body's uid appears in NO HEALED row. Asserting the damage
    // alone would stay green under a build that emitted a 0-amount row for it.
    expect(healed.some((e) => e.uid === skipped)).toBe(false);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("is a NO-OP, not a refusal, on a board with no {L} Pokémon at all", () => {
    let state = board(70, QUICKWIT_DECK);
    state = setActiveFromDeck(state, "p1", "fix-bigbody");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = setDamage(state, "p1", 100);
    // Fennel has no playability gate and neither does this: the Supporter is
    // spent, nothing heals, and no HEALED row is emitted. A whiff is SILENT —
    // per Pokémon for the ungated op, and per Pokémon here too.
    const { state: done, events } = playFromHand(state, "fix-clemontsquickwit");
    expect(findAll(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.active?.damage).toBe(100);
  });

  it("leaves the UNGATED sentence ungated — Fennel still heals a {L} body", () => {
    // ⚠️ THE ATTRIBUTION CONTROL. An absent `pokemonType` must NOT mean
    // `Colorless`: Fennel's printed "each of your Pokémon" heals a {L} body, and
    // a build that defaulted the field would pass every assertion above and
    // break the two sentences apart in the wrong place.
    let state = board(71, QUICKWIT_DECK);
    state = setActiveFromDeck(state, "p1", "fix-lightningbody");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-bigbody");
    state = setDamage(state, "p1", 100);
    const withBench: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          bench: state.players.p1.bench.map((b, i) => (i === 0 ? { ...b, damage: 100 } : b)),
        },
      },
    };
    const { state: done, events } = playFromHand(withBench, "fix-fennel");
    expect(findAll(events, "HEALED")).toHaveLength(2);
    expect(done.players.p1.active?.damage).toBe(60);
    expect(done.players.p1.bench[0]?.damage).toBe(60);
  });
});

describe("the discardPileRetrieval rows — Night Stretcher / Max Rod / Miracle Headset / Energy Recycler / Sacred Ash", () => {
  /** P1's turn with a discard pile holding one of each of: a Pokémon, a Basic
      Energy, a Supporter and an Item. Every filter below must pick a different
      subset of exactly these four. */
  function seededPile(seed: number): GameState {
    let state = board(seed, TRN_DECK);
    state = discardFromDeck(stocked(state, "p1", "fix-bigbody"), "p1", "fix-bigbody", 1);
    state = discardFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    state = discardFromDeck(stocked(state, "p1", "sv01-180"), "p1", "sv01-180", 1);
    state = discardFromDeck(stocked(state, "p1", "fix-item"), "p1", "fix-item", 1);
    return state;
  }

  const pileUid = (state: GameState, cardId: string) =>
    state.players.p1.discard.find((u) => state.cardIdByUid[u] === cardId) as string;

  it("Night Stretcher offers a Pokémon OR a Basic Energy — max ONE", () => {
    const state = seededPile(24);
    const mon = pileUid(state, "fix-bigbody");
    const energy = pileUid(state, "fix-energy");
    const { state: parked } = playFromHand(state, "fix-nightstretcher");
    const prompt = cardsPrompt(parked);
    expect([...prompt.candidates].sort()).toEqual([mon, energy].sort());
    // ⚠️ THE MUTANT THIS KILLS: `max: 5` (Max Rod's value, the sibling row).
    expect(prompt.max).toBe(1);
    const { state: done } = chooseCards(parked, [mon]);
    expect(done.players.p1.hand).toContain(mon);
    expect(done.players.p1.discard).not.toContain(mon);
  });

  it("Max Rod offers the SAME set at max FIVE", () => {
    const state = seededPile(25);
    const { state: parked } = playFromHand(state, "fix-maxrod");
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.max).toBe(5);
    const { state: done } = chooseCards(parked, [...prompt.candidates] as string[]);
    expect(done.players.p1.hand).toContain(pileUid(state, "fix-bigbody"));
    expect(done.players.p1.hand).toContain(pileUid(state, "fix-energy"));
  });

  it("Miracle Headset offers ONLY Supporters, to the HAND", () => {
    const state = seededPile(26);
    const supporter = pileUid(state, "sv01-180");
    const { state: parked } = playFromHand(state, "fix-miracleheadset");
    const prompt = cardsPrompt(parked);
    // The Item in the pile is what makes "Supporter" narrower than "Trainer".
    expect(prompt.candidates).toEqual([supporter]);
    expect(prompt.max).toBe(2);
    const { state: done, events } = chooseCards(parked, [supporter]);
    expect(done.players.p1.hand).toContain(supporter);
    // ⚠️ THE MUTANT THIS KILLS: `dest: "deck"` (Pal Pad's value) — there would be
    // a shuffle and the card would not be in hand.
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("Energy Recycler puts Basic Energy back into the DECK and shuffles", () => {
    // The played Item is pulled to hand FIRST so `deckBefore` measures the deck
    // the retrieval actually returns into.
    const state = toHand(seededPile(27), "fix-energyrecycler");
    const energy = pileUid(state, "fix-energy");
    const deckBefore = state.players.p1.deck.length;
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-energyrecycler"),
    });
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toEqual([energy]);
    expect(prompt.max).toBe(5);
    const { state: done, events } = chooseCards(parked, [energy]);
    // ⚠️ THE MUTANT THIS KILLS: `dest: "hand"` (Energy Retrieval's value).
    expect(done.players.p1.deck).toContain(energy);
    expect(done.players.p1.hand).not.toContain(energy);
    expect(done.players.p1.deck).toHaveLength(deckBefore + 1);
    expect(types(events)).toContain("SHUFFLE");
  });

  it("Sacred Ash puts POKÉMON back into the deck — and does NOT draw, where Miriam does", () => {
    const state = seededPile(28);
    const mon = pileUid(state, "fix-bigbody");
    const handBefore = state.players.p1.hand.length;
    const { state: parked } = playFromHand(state, "fix-sacredash");
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toEqual([mon]);
    const { state: done, events } = chooseCards(parked, [mon]);
    expect(done.players.p1.deck).toContain(mon);
    // ⚠️ THE MUTANT THIS KILLS: sharing Miriam's object (the first sentence is
    // byte-identical). Miriam's second sentence would draw 3.
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expect(done.players.p1.hand).toHaveLength(handBefore); // +1 drawn from deck, −1 played
  });
});

describe("the searchDeck rows — Master Ball / Treasure Tracker", () => {
  it("Master Ball searches the WHOLE deck for a Pokémon, with NO coin flip", () => {
    const state = board(29, TRN_DECK);
    const { state: parked, events } = playFromHand(state, "fix-masterball");
    // ⚠️ THE MUTANT THIS KILLS: Poké Ball's `coinFlipGate` wrapper.
    expect(types(events)).not.toContain("EFFECT_COIN_FLIP");
    const prompt = cardsPrompt(parked);
    expect(prompt.max).toBe(1);
    const pick = prompt.candidates[0] as string;
    for (const uid of prompt.candidates) {
      expect(POOL[parked.cardIdByUid[uid] as string]?.category).toBe("Pokemon");
    }
    const { state: done, events: tail } = chooseCards(parked, [pick]);
    expect(done.players.p1.hand).toContain(pick);
    expect(types(tail)).toContain("SHUFFLE");
  });

  it("Treasure Tracker searches for up to FIVE Pokémon Tool cards", () => {
    const state = board(30, TRN_DECK);
    const { state: parked } = playFromHand(state, "fix-treasuretracker");
    const prompt = cardsPrompt(parked);
    expect(prompt.max).toBe(5);
    // fix-tool, fix-maximumbelt and fix-bindingmochi are the pool's Tools; every
    // candidate must be one, and a Supporter/Item must not appear.
    for (const uid of prompt.candidates) {
      expect(POOL[parked.cardIdByUid[uid] as string]?.trainerType).toBe("Tool");
    }
    expect(prompt.candidates.length).toBeGreaterThan(1);
    const picks = [...prompt.candidates].slice(0, 2) as string[];
    const { state: done } = chooseCards(parked, picks);
    for (const uid of picks) expect(done.players.p1.hand).toContain(uid);
  });
});

describe("Kofu — driven through the real engine", () => {
  it("pays 2 to the DECK BOTTOM, then the §9.2 gate draws 4", () => {
    const state = board(31, TRN_DECK);
    const handBefore = state.players.p1.hand.length;
    const deckBefore = state.players.p1.deck.length;
    const { state: parked } = playFromHand(state, "fix-kofu");
    const prompt = cardsPrompt(parked);
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    const picks = prompt.candidates.slice(0, 2) as string[];
    const { state: paidState, events: payEvents } = chooseCards(parked, picks);
    expect(find(payEvents, "HAND_COST_PAID")?.uids).toEqual(picks);
    // 🆕 D343 — THE PAYMENT NO LONGER FINISHES THE CARD. The printed "in any
    // order" is a SECOND park, and it is here rather than riding the pick's array
    // because `chooseCards`'s validator is free to treat that array as a set
    // (D341) and because `payFromHand` skips the pick entirely when the offer is
    // no bigger than the count. The draw has NOT happened yet.
    expect(find(payEvents, "CARDS_DRAWN")).toBeUndefined();
    const order = orderPrompt(paidState);
    // ⚠️ THE WINDOW IS THE PAYMENT, BY CONSTRUCTION AND NOT BY A CHANNEL — D342's
    // trick at the other end of the same deck. `payFromHand{to:"deckBottom"}`
    // appends, so the two paid cards ARE the last two, and `reorderTop
    // {from:"bottom"}` reads exactly them. Asserted as a SEQUENCE (deck order,
    // index 0 nearer the top), which is the whole subject of the row.
    expect(order.candidates).toEqual(picks);
    // ⚠️ THE MUTANT THIS KILLS: `to: "discard"`. The two cards are UNDER the deck.
    expect(paidState.players.p1.deck.slice(-2)).toEqual(picks);
    for (const uid of picks) expect(paidState.players.p1.discard).not.toContain(uid);
    // Answer with the window REVERSED — the identity permutation would be green
    // against an engine that ignored the answer entirely, which is exactly the
    // mutant this row exists to catch.
    const reversed = [...picks].reverse();
    const { state: done, events } = orderCards(paidState, reversed);
    // 🛑 THE BOARD, NOT THE FIELD (D342's shared shape). The bottom of the deck
    // is the answer's own sequence, and everything above the window is untouched.
    expect(done.players.p1.deck.slice(-2)).toEqual(reversed);
    // ⚠️ THE MIDDLE IS COMPARED PAST THE DRAW, and the `4` is why this assertion
    // is worth writing rather than eyeballing: the gate's second op takes 4 cards
    // off the TOP in the same reduction, so "everything above the window is
    // untouched" is only checkable against the pre-draw deck with those 4 dropped.
    // A reorder that spliced at the wrong end would show up here and nowhere else.
    expect(done.players.p1.deck.slice(0, -2)).toEqual(paidState.players.p1.deck.slice(4, -2));
    // 🛑 THE ROW SAYS WHICH END, AND IT RIDES THE ACTION THAT *PARKED* — which
    // is the PAYMENT's reduction, not this one. D341's rule inherited by the new
    // fork without a line of its own: the event reports that the window was read,
    // and that happened whether or not the ordering answer ever arrives. Asserted
    // on `payEvents` for that reason, and re-asserted absent here so a future
    // author cannot quietly start emitting it twice.
    expect(find(payEvents, "DECK_TOP_REORDERED")).toEqual({
      type: "DECK_TOP_REORDERED",
      seat: "p1",
      actor: "p1",
      count: 2,
      end: "bottom",
    });
    expect(events.filter((e) => e.type === "DECK_TOP_REORDERED")).toEqual([]);
    // …and the gate fired: +1 Kofu drawn from hand, −2 paid, +4 drawn.
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(4);
    expect(done.players.p1.hand).toHaveLength(handBefore + 1 - 1 - 2 + 4 - 0);
    expect(done.players.p1.deck).toHaveLength(deckBefore - 1 + 2 - 4);
  });

  it("🆕 D343 — asks for the ORDER even when the PAYMENT had no choice in it", () => {
    // 🛑🛑 THE BOARD THAT JUSTIFIES THE WHOLE ROW, and the one the two-op program
    // silently got wrong. `payFromHand` resolves INLINE when the offer is no
    // bigger than the count ("the only decision is WHICH cards") — so on Kofu
    // plus exactly two other cards there is no `chooseCards` park at all and the
    // pair used to land in raw hand order. The printed "in any order" was not
    // under-specified on this board; it was ABSENT. The ordering is a separate
    // op precisely so that it does not inherit the payment's no-choice branch.
    let state = board(33, TRN_DECK);
    state = toHand(state, "fix-kofu");
    const kofu = handUid(state, "p1", "fix-kofu");
    const spares = state.players.p1.hand.filter((u) => u !== kofu).slice(0, 2);
    expect(spares).toHaveLength(2);
    const thin: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          hand: [kofu, ...spares],
          deck: [
            ...state.players.p1.deck,
            ...state.players.p1.hand.filter((u) => u !== kofu && !spares.includes(u)),
          ],
        },
      },
    };
    const played = mustApply(thin, { type: "playTrainer", seat: "p1", uid: kofu });
    // The payment took no answer — it never parked — and the cards are already
    // under the deck in hand order.
    expect(find(played.events, "HAND_COST_PAID")?.uids).toEqual(spares);
    expect(played.state.players.p1.deck.slice(-2)).toEqual(spares);
    // …and the engine is nevertheless parked on the ORDERING, over exactly the
    // two cards that were just paid. This is the assertion the old program could
    // not have passed.
    const order = orderPrompt(played.state);
    expect(order.candidates).toEqual(spares);
    // 🛑 THE CAPTION IS THE BOTTOM SENTENCE, NOT THE TOP ONE WITH A WORD SWAPPED.
    // "back" would assert a return that never happened — these cards came out of
    // the player's own hand, they were never on the deck to be put BACK.
    expect(order.note).toBe("Put these cards on the bottom of your deck in any order.");
    // The reversed answer reaches the board, and the draw is still owed.
    const flipped = [...spares].reverse();
    const { state: done, events } = orderCards(played.state, flipped);
    expect(done.players.p1.deck.slice(-2)).toEqual(flipped);
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(4);
  });

  it("REFUSES the play when the hand cannot spare two OTHER cards — the printed parenthetical", () => {
    let state = board(32, TRN_DECK);
    state = toHand(state, "fix-kofu");
    const kofu = handUid(state, "p1", "fix-kofu");
    // Exactly Kofu plus ONE other card: the printed "from your hand" cannot mean
    // Kofu itself (playTrainer excludes the played uid), so 2 cannot be paid.
    const spare = state.players.p1.hand.find((u) => u !== kofu) as string;
    const thin: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          hand: [kofu, spare],
          deck: [
            ...state.players.p1.deck,
            ...state.players.p1.hand.filter((u) => u !== kofu && u !== spare),
          ],
        },
      },
    };
    const rejected = applyAction(thin, { type: "playTrainer", seat: "p1", uid: kofu });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("PLAY_CONDITION_NOT_MET");
  });
});

// ── The Tool rows ────────────────────────────────────────────────────────────

describe("Maximum Belt — driven through the real engine", () => {
  /** P1's fix-attacker (Bite: {C}, 30) with one Energy, facing `defender`. */
  function belted(seed: number, defender: string, tool?: string): GameState {
    let state = board(seed, TRN_DECK);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = clearBench(state, "p1");
    state = attachFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    if (tool !== undefined)
      state = attachToolFromDeck(stocked(state, "p1", tool), "p1", "active", tool);
    state = setActiveFromDeck(state, "p2", defender);
    return clearBench(state, "p2");
  }

  const bite = { type: "attack", seat: "p1", index: 0 } as const;

  it("adds 50 against a Pokémon ex and NOTHING against a body without the suffix", () => {
    const versusEx = mustApply(deepFreeze(belted(33, "fix-attacker-ex", "fix-maximumbelt")), bite);
    // ⚠️ TWO MUTANTS AT ONCE: `amount: 30` (Choice Belt's number) and
    // `targetSuffix: "V"` (Choice Belt's suffix — the second would deal a bare 30).
    expect(find(versusEx.events, "DAMAGE_DEALT")?.dealt).toBe(80);
    const versusPlain = mustApply(deepFreeze(belted(34, "fix-bigbody", "fix-maximumbelt")), bite);
    expect(find(versusPlain.events, "DAMAGE_DEALT")?.dealt).toBe(30);
    // The non-vacuous control: the same ex defender with no Tool at all.
    const noTool = mustApply(deepFreeze(belted(35, "fix-attacker-ex")), bite);
    expect(find(noTool.events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });
});

describe("Binding Mochi — driven through the real engine", () => {
  function mochi(seed: number, poison: "holder" | "defender" | "none"): GameState {
    let state = board(seed, TRN_DECK);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = clearBench(state, "p1");
    state = attachFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    state = attachToolFromDeck(
      stocked(state, "p1", "fix-bindingmochi"),
      "p1",
      "active",
      "fix-bindingmochi",
    );
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    if (poison === "holder") state = setConditions(state, "p1", { poisonDamage: 10 });
    if (poison === "defender") state = setConditions(state, "p2", { poisonDamage: 10 });
    return state;
  }

  const bite = { type: "attack", seat: "p1", index: 0 } as const;

  it("adds 40 only while the HOLDER is Poisoned — the clause the board condition reads", () => {
    const poisoned = mustApply(deepFreeze(mochi(36, "holder")), bite);
    expect(find(poisoned.events, "DAMAGE_DEALT")?.dealt).toBe(70);
    const clean = mustApply(deepFreeze(mochi(37, "none")), bite);
    expect(find(clean.events, "DAMAGE_DEALT")?.dealt).toBe(30);
    // ⚠️ THE MUTANT THIS KILLS: `cond: { kind: "opponentActivePoisoned" }` — the
    // sibling member one line away in the union, and the one a reader skimming
    // "Poisoned Pokémon" would reach for. Poisoning the DEFENDER buys nothing.
    const wrongSide = mustApply(deepFreeze(mochi(38, "defender")), bite);
    expect(find(wrongSide.events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("⚠️ a BENCHED holder contributes nothing — the fold reads the ATTACKER and no one else", () => {
    // The printed subject is "the Pokémon this card is attached to"; the field
    // reads "your Active". The two coincide because a body attacking IS the
    // Active — which means a Tool on the Bench never reaches the fold at all,
    // even on a board where the seat's Active is Poisoned. Asserted rather than
    // argued, because it is the one place the two readings could have parted.
    let state = board(39, TRN_DECK);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = clearBench(state, "p1");
    state = attachFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    state = benchFromDeck(state, "p1", "fix-bigbody");
    state = attachToolFromDeck(
      stocked(state, "p1", "fix-bindingmochi"),
      "p1",
      0,
      "fix-bindingmochi",
    );
    state = setConditions(state, "p1", { poisonDamage: 10 });
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    const { events } = mustApply(deepFreeze(state), bite);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });
});

// ── The Stadium and the Special Energy ───────────────────────────────────────

describe("Levincia — the first Stadium ability that is not a deck search", () => {
  it("retrieves up to 2 Basic {L} Energy from the activating player's discard", () => {
    let state = board(40, TRN_DECK);
    state = discardFromDeck(
      stocked(state, "p1", "fix-lightning-energy"),
      "p1",
      "fix-lightning-energy",
      2,
    );
    state = discardFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    const lightning = state.players.p1.discard.filter(
      (u) => state.cardIdByUid[u] === "fix-lightning-energy",
    );
    const plain = state.players.p1.discard.find(
      (u) => state.cardIdByUid[u] === "fix-energy",
    ) as string;
    state = playFromHand(state, "fix-levincia").state;
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    const prompt = cardsPrompt(parked);
    // ⚠️ THE MUTANT THIS KILLS: dropping `energyType` — the untyped Basic would be
    // offered, which is Energy Retrieval's filter and not this card's.
    expect([...prompt.candidates].sort()).toEqual([...lightning].sort());
    expect(prompt.candidates).not.toContain(plain);
    expect(prompt.max).toBe(2);
    const { state: done } = chooseCards(parked, lightning);
    for (const uid of lightning) expect(done.players.p1.hand).toContain(uid);
    // A hand destination, so no shuffle — and the Stadium stays in play.
    expect(done.stadium?.uid).toBeDefined();
  });

  it("is once per PLAYER TURN — refused twice on one turn, live again next turn", () => {
    let state = board(41, TRN_DECK);
    state = discardFromDeck(
      stocked(state, "p1", "fix-lightning-energy"),
      "p1",
      "fix-lightning-energy",
      3,
    );
    state = playFromHand(state, "fix-levincia").state;
    const first = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    const settled = chooseCards(first.state, [
      cardsPrompt(first.state).candidates[0] as string,
    ]).state;
    const again = applyAction(settled, { type: "useStadiumAbility", seat: "p1" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("STADIUM_ABILITY_ALREADY_USED");
  });
});

describe("Spiky Energy — the second writer of EnergyProgram.passive", () => {
  /** P2's Active carries Spiky Energy; P1's fix-attacker Bites it. */
  function spiked(seed: number): GameState {
    let state = board(seed, TRN_DECK);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = clearBench(state, "p1");
    state = attachFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    return state;
  }

  const bite = { type: "attack", seat: "p1", index: 0 } as const;

  it("retaliates for 2 damage counters when its holder is damaged in the Active Spot", () => {
    let state = stocked(spiked(42), "p2", "fix-spikyenergy");
    const withEnergy: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active:
            state.players.p2.active === null
              ? null
              : {
                  ...state.players.p2.active,
                  energy: [
                    state.players.p2.deck.find(
                      (u) => state.cardIdByUid[u] === "fix-spikyenergy",
                    ) as string,
                  ],
                },
          deck: state.players.p2.deck.filter((u) => state.cardIdByUid[u] !== "fix-spikyenergy"),
        },
      },
    };
    const { state: done, events } = mustApply(deepFreeze(withEnergy), bite);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    // ⚠️ THE MUTANT THIS KILLS: `amount: 30` (Counterattack Quills' number — the
    // program this row was read off, whose antecedent is byte-identical).
    expect(done.players.p1.active?.damage).toBe(20);
    // The non-vacuous control: the same board without the Energy attached.
    state = spiked(43);
    const bare = mustApply(deepFreeze(state), bite);
    expect(bare.state.players.p1.active?.damage).toBe(0);
  });

  it("reaches `passivesOf` from the ENERGY source, and provides {C} for a cost", () => {
    let state = spiked(44);
    // Attach it to P1's own Active instead, so the SAME card both pays a cost and
    // contributes a passive off one uid.
    state = stocked(state, "p1", "fix-spikyenergy");
    const uid = state.players.p1.deck.find(
      (u) => state.cardIdByUid[u] === "fix-spikyenergy",
    ) as string;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active:
            state.players.p1.active === null ? null : { ...state.players.p1.active, energy: [uid] },
          deck: state.players.p1.deck.filter((u) => u !== uid),
        },
      },
    };
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    expect(passivesOf(state, active).damageAttacker).toBe(20);
    // …and the FIRST printed clause: {C}, so Bite ({C}, 30) is payable off it
    // alone. A whiffed provision would fail the attack, not the assertion.
    const { events } = mustApply(state, bite);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D264 — backlog row 13's ABILITY and TRAINER halves: the discard pile into the
// HAND, on the two nouns the `CardFilter` vocabulary could not previously spell.

describe("Lana's Aid — driven through the real engine", () => {
  /** P1's turn with a pile holding one of each of the five things Lana's Aid's
      two-member `anyOf` must tell apart. Every assertion below is a statement
      about which of these five is offered. */
  function lanaPile(seed: number): GameState {
    let state = board(seed, RECOVERY_DECK);
    state = discardFromDeck(stocked(state, "p1", "fix-bigbody"), "p1", "fix-bigbody", 1);
    state = discardFromDeck(stocked(state, "p1", "fix-plainstage1"), "p1", "fix-plainstage1", 1);
    state = discardFromDeck(stocked(state, "p1", "fix-attacker-ex"), "p1", "fix-attacker-ex", 1);
    state = discardFromDeck(stocked(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    state = discardFromDeck(stocked(state, "p1", "fix-special"), "p1", "fix-special", 1);
    return state;
  }

  const pileUid = (state: GameState, cardId: string) =>
    state.players.p1.discard.find((u) => state.cardIdByUid[u] === cardId) as string;

  it("offers the two Rule-Box-LESS Pokémon and the Basic Energy — and nothing else", () => {
    const state = lanaPile(70);
    const { state: parked } = playFromHand(state, "fix-lanasaid");
    const prompt = cardsPrompt(parked);
    expect([...prompt.candidates].sort()).toEqual(
      [
        pileUid(state, "fix-bigbody"),
        pileUid(state, "fix-plainstage1"),
        pileUid(state, "fix-energy"),
      ].sort(),
    );
    // ⚠️ THE MUTANT THIS KILLS: `anyOf` read as `.every` rather than `.some`. No
    // card in the pile is BOTH a Rule-Box-less Pokémon and a Basic Energy, so an
    // intersection reading offers an empty prompt — a Supporter that pays nobody.
    expect(prompt.candidates.length).toBeGreaterThan(0);
    // ⚠️ AND: `max: 5` (Max Rod's value, the program this one was modelled on).
    expect(prompt.max).toBe(3);
  });

  it("⚠️ takes an EVOLUTION Pokémon — the card that separates `anyPokemon` from `basicPokemon`", () => {
    const state = lanaPile(71);
    const stage1 = pileUid(state, "fix-plainstage1");
    const { state: parked } = playFromHand(state, "fix-lanasaid");
    // ⚠️ THE MUTANT THIS KILLS, AND THE REASON THIS ROW COST A UNION RIDER:
    // `{ kind: "basicPokemon", noRuleBox: true }` (Artazon's filter) compiles,
    // captions almost right, and silently drops every Stage 1 / Stage 2 in the
    // pile. `fix-plainstage1` is the only card here that tells the two apart.
    expect(cardsPrompt(parked).candidates).toContain(stage1);
    const { state: done } = chooseCards(parked, [stage1]);
    expect(done.players.p1.hand).toContain(stage1);
    expect(done.players.p1.discard).not.toContain(stage1);
  });

  it("⚠️ refuses the Pokémon ex — the `noRuleBox` rider, which is the whole clause", () => {
    const state = lanaPile(72);
    const { state: parked } = playFromHand(state, "fix-lanasaid");
    // ⚠️ THE MUTANT THIS KILLS: dropping `noRuleBox`. "Fixmon ex" is a Pokémon
    // sitting in the pile, so a bare `anyPokemon` offers it and the printed
    // parenthetical ("Pokémon ex, Pokémon V, etc. have Rule Boxes.") becomes a
    // sentence the engine does not read.
    expect(cardsPrompt(parked).candidates).not.toContain(pileUid(state, "fix-attacker-ex"));
  });

  it("⚠️ refuses the SPECIAL Energy — `basicEnergy`, not `anyEnergy`", () => {
    const state = lanaPile(73);
    const { state: parked } = playFromHand(state, "fix-lanasaid");
    expect(cardsPrompt(parked).candidates).not.toContain(pileUid(state, "fix-special"));
  });

  it("captions the prompt with the printed noun, joined — the `anyOf` arm's first witness", () => {
    const state = lanaPile(74);
    const { state: parked } = playFromHand(state, "fix-lanasaid");
    // 🛑 `retrieveNoun`'s `anyOf` arm has been in the file since D245 and NOTHING
    // could reach it: its only printing was a passive aura, which parks no prompt.
    // This is the first board that renders it, and it renders BOTH new phrases —
    // the joiner and the stage-free `noRuleBox` plural.
    expect(cardsPrompt(parked).note).toBe(
      "Put up to 3 Pokémon that don't have a Rule Box or Basic Energy cards from your discard pile into your hand.",
    );
  });

  it("moves up to THREE at once, into the hand, with no shuffle", () => {
    const state = lanaPile(75);
    const { state: parked } = playFromHand(state, "fix-lanasaid");
    const picks = [...cardsPrompt(parked).candidates] as string[];
    expect(picks).toHaveLength(3);
    const { state: done, events } = chooseCards(parked, picks);
    for (const uid of picks) expect(done.players.p1.hand).toContain(uid);
    // ⚠️ THE MUTANT THIS KILLS: `dest: "deck"` (Sacred Ash's value) — the cards
    // would land in the deck and a SHUFFLE would fire.
    expect(types(events)).not.toContain("SHUFFLE");
  });
});

describe("Greedy Order (Arven's Greedent) — driven through the real engine", () => {
  /** P1 on turn 3 with a `fix-basic-1` Active to evolve, `sandwiches` copies of
      the NAMED Item in the pile beside two decoys, and the carrier in hand. */
  function greedBoard(seed: number, sandwiches: number): GameState {
    let state = withActive(seed, "fix-basic-1", 3, RECOVERY_DECK);
    state = discardFromDeck(
      stocked(state, "p1", "fix-arvenssandwich"),
      "p1",
      "fix-arvenssandwich",
      sandwiches,
    );
    state = discardFromDeck(stocked(state, "p1", "fix-item"), "p1", "fix-item", 1);
    state = discardFromDeck(stocked(state, "p1", "fix-bigbody"), "p1", "fix-bigbody", 1);
    return toHand(state, "fix-greedyorder");
  }

  const evolveIntoGreedent = (state: GameState) =>
    ({
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-greedyorder"),
      target: { spot: "active" },
    }) as const;

  it("fires ON EVOLVE and offers ONLY the named card — not the other Item", () => {
    const state = deepFreeze(greedBoard(76, 3));
    const sandwiches = state.players.p1.discard.filter(
      (u) => state.cardIdByUid[u] === "fix-arvenssandwich",
    );
    const { state: parked, events } = mustApply(state, evolveIntoGreedent(state));
    expect(types(events)).toContain("ABILITY_TRIGGERED");
    const prompt = cardsPrompt(parked);
    // ⚠️ THE MUTANT THIS KILLS: `{ kind: "item" }` (or `trainerCard`) in place of
    // `byName`. `fix-item` is an Item in the same pile and must NOT be offered;
    // all three copies of the named card must be.
    expect([...prompt.candidates].sort()).toEqual([...sandwiches].sort());
    // ⚠️ AND: `max: 3` (Lana's Aid's value, the sibling row) — three are eligible
    // and the print takes two.
    expect(prompt.max).toBe(2);
  });

  it("puts the two picks in the HAND, leaving the third in the pile", () => {
    const state = greedBoard(77, 3);
    const { state: parked } = mustApply(state, evolveIntoGreedent(state));
    const picks = [...cardsPrompt(parked).candidates].slice(0, 2) as string[];
    const { state: done, events } = chooseCards(parked, picks);
    for (const uid of picks) expect(done.players.p1.hand).toContain(uid);
    expect(
      done.players.p1.discard.filter((u) => done.cardIdByUid[u] === "fix-arvenssandwich"),
    ).toHaveLength(1);
    // ⚠️ THE MUTANT THIS KILLS: `dest: "deck"` — the cards would leave for the
    // deck and a shuffle would fire.
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("captions the prompt with the printed 'cards' — the `cardNoun` rider", () => {
    const state = greedBoard(78, 3);
    const { state: parked } = mustApply(state, evolveIntoGreedent(state));
    // ⚠️ THE MUTANT THIS KILLS: dropping `cardNoun`. `byName`'s bare arm exists
    // for Flamigo, whose printed noun really is invariant ("up to 3 Flamigo"); a
    // Trainer name prints the word after it, and without the rider the dialog
    // reads "…up to 2 Arven's Sandwich from your discard pile…".
    expect(cardsPrompt(parked).note).toBe(
      "Put up to 2 Arven's Sandwich cards from your discard pile into your hand.",
    );
  });

  it("does nothing at all when the pile holds no Arven's Sandwich — the trigger still FIRES", () => {
    let state = withActive(79, "fix-basic-1", 3, RECOVERY_DECK);
    state = discardFromDeck(stocked(state, "p1", "fix-item"), "p1", "fix-item", 2);
    state = toHand(state, "fix-greedyorder");
    deepFreeze(state);
    const handBefore = state.players.p1.hand.length;
    const { state: done, events } = mustApply(state, evolveIntoGreedent(state));
    // The trigger is not gated on the pile — it parks nothing and moves nothing,
    // which is the printed "up to" rather than a refusal.
    expect(types(events)).toContain("ABILITY_TRIGGERED");
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.hand).toHaveLength(handBefore - 1); // the carrier evolved
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D265 — the HP-THRESHOLD `CardFilter` rider (`basicPokemon.maxHp`): ONE union
// rider read by TWO ops, on the two sentences that print it.
//
// ⚠️ THE TWO SUITES BELOW ARE DELIBERATELY NOT MERGED, AND THE REASON IS THE
// SLICE'S OWN THESIS. The filter is shared; the OPS are not. Buddy-Buddy Poffin
// puts `searchDeck` over the DECK from a Trainer, Gentle Fin puts
// `discardPileRetrieval` over the DISCARD PILE from an activated Ability, and a
// rider that worked on one and not the other would be green on a merged suite
// that only ever drove one of them. Each suite therefore asserts the SAME three
// conjuncts through its own op — which is the evidence that the threshold belongs
// on the FILTER rather than as a field on either op.

describe("Buddy-Buddy Poffin — driven through the real engine", () => {
  /** P1's turn on the threshold deck. Nothing is seeded: `searchDeck` reads the
      deck, and the deck is what the fixture list above weights. */
  const poffinBoard = (seed: number) => board(seed, POFFIN_DECK);

  const idsOf = (state: GameState, uids: readonly string[]) =>
    [...new Set(uids.map((u) => state.cardIdByUid[u] as string))].sort();

  it("offers ONLY the Basic Pokémon at or under 70 HP — three conjuncts, one prompt", () => {
    const state = poffinBoard(80);
    const { state: parked } = playFromHand(state, "fix-buddybuddypoffin");
    const prompt = cardsPrompt(parked);
    // ⚠️ THE THREE MUTANTS THIS KILLS, ONE PER EXCLUDED ID:
    //   • `fix-bigbody` (a Basic at 200 HP) — dropping the `maxHp` conjunct;
    //   • `fix-smallstage1` (a Stage 1 at 60 HP) — dropping `isBasicPokemon`,
    //     which the HP card alone could not tell apart from a correct build;
    //   • `fix-item` (a Trainer, `hp` null) — writing `hp! <= max` and letting
    //     JavaScript's `null <= 70` decide, which admits every card with no HP.
    expect(idsOf(parked, prompt.candidates)).toEqual(["fix-basic-1"]);
    expect(prompt.candidates.length).toBeGreaterThan(0);
    // ⚠️ AND: `max: 1` (Nest Ball's value, the program this one was modelled on).
    expect(prompt.max).toBe(2);
  });

  it("captions the prompt with the printed noun — the rider is a CAPTION rider too", () => {
    const state = poffinBoard(81);
    const { state: parked } = playFromHand(state, "fix-buddybuddypoffin");
    // ⚠️ THE MUTANT THIS KILLS: a `maxHp` that filters correctly and captions as
    // the bare "Basic Pokémon". The dialog would then name a wider set than the
    // rows under it — the engine speaking a second vocabulary, which is the exact
    // failure `searchNote`'s own doc block was written about.
    expect(cardsPrompt(parked).note).toBe(
      "Search your deck for up to 2 Basic Pokémon with 70 HP or less onto your Bench.",
    );
  });

  it("benches BOTH picks and shuffles afterwards", () => {
    const state = poffinBoard(82);
    const { state: parked } = playFromHand(state, "fix-buddybuddypoffin");
    const picks = [...cardsPrompt(parked).candidates].slice(0, 2) as string[];
    const benchBefore = parked.players.p1.bench.length;
    const { state: done, events } = chooseCards(parked, picks);
    expect(done.players.p1.bench).toHaveLength(benchBefore + 2);
    const benched = done.players.p1.bench.map((b) => topUid(b));
    for (const uid of picks) expect(benched).toContain(uid);
    // ⚠️ THE MUTANT THIS KILLS: dropping the trailing `shuffleDeck` op — the
    // printed "Then, shuffle your deck." is its own sentence and its own op.
    expect(types(events)).toContain("SHUFFLE");
  });

  it("⚠️ the threshold is INCLUSIVE — `<= 70`, not `< 70`", () => {
    // The pool prints no Basic at exactly 70, so the boundary is asserted on the
    // predicate itself rather than through a board: a `<` build refuses a body the
    // printed "70 HP or less" takes, and no fixture in this file sits on the line.
    // 🛑 A CONSTRUCTED CARD, LABELLED AS ONE (D146's rule) — it exists to drive
    // the comparator and nothing else.
    const onTheLine = battler("fix-line-70", { hp: 70 });
    expect(matchesFilter(onTheLine, { kind: "basicPokemon", maxHp: 70 })).toBe(true);
    expect(
      matchesFilter(battler("fix-line-71", { hp: 71 }), { kind: "basicPokemon", maxHp: 70 }),
    ).toBe(false);
  });

  it("⚠️ a NULL printed hp is REFUSED rather than admitted — the data-gap arm", () => {
    // `hpOf` reads null for a non-positive printed value as well as for a missing
    // one, and `null <= 70` is TRUE in JavaScript. The `hp !== null` conjunct is
    // what stands between this filter and every gap row in the catalog; the two
    // cards below are the only way to see it, because a Trainer is already
    // refused by `isBasicPokemon` one conjunct earlier.
    expect(
      matchesFilter(battler("fix-gap-null", { hp: null }), { kind: "basicPokemon", maxHp: 70 }),
    ).toBe(false);
    expect(
      matchesFilter(battler("fix-gap-zero", { hp: 0 }), { kind: "basicPokemon", maxHp: 70 }),
    ).toBe(false);
    // …and the SAME two cards are still taken by the filter WITHOUT the rider, so
    // what the assertions above witness is the rider and not the fixture.
    expect(matchesFilter(battler("fix-gap-null", { hp: null }), { kind: "basicPokemon" })).toBe(
      true,
    );
  });
});

describe("Gentle Fin (Alomomola) — driven through the real engine", () => {
  /** P1 on turn 3 with `fix-gentlefin` Active and the pile holding one of each
      thing the filter's three conjuncts must tell apart. */
  function finBoard(seed: number): GameState {
    let state = withActive(seed, "fix-gentlefin", 3, POFFIN_DECK);
    state = discardFromDeck(stocked(state, "p1", "fix-basic-1"), "p1", "fix-basic-1", 1);
    state = discardFromDeck(stocked(state, "p1", "fix-bigbody"), "p1", "fix-bigbody", 1);
    state = discardFromDeck(stocked(state, "p1", "fix-smallstage1"), "p1", "fix-smallstage1", 1);
    state = discardFromDeck(stocked(state, "p1", "fix-item"), "p1", "fix-item", 1);
    return state;
  }

  const pileUid = (state: GameState, cardId: string) =>
    state.players.p1.discard.find((u) => state.cardIdByUid[u] === cardId) as string;

  it("offers ONLY the small Basic out of the pile — the same three conjuncts, the other op", () => {
    const state = finBoard(83);
    const { state: parked } = mustApply(state, useOn("Gentle Fin"));
    const prompt = cardsPrompt(parked);
    expect([...prompt.candidates]).toEqual([pileUid(state, "fix-basic-1")]);
    expect(prompt.candidates).not.toContain(pileUid(state, "fix-bigbody"));
    expect(prompt.candidates).not.toContain(pileUid(state, "fix-smallstage1"));
    expect(prompt.candidates).not.toContain(pileUid(state, "fix-item"));
    // ⚠️ AND: `max: 3` (Lana's Aid's value, the sibling row on the same op) — the
    // printed noun here is SINGULAR.
    expect(prompt.max).toBe(1);
  });

  it("captions the prompt with the printed sentence, verb and destination included", () => {
    const state = finBoard(84);
    const { state: parked } = mustApply(state, useOn("Gentle Fin"));
    // ⚠️ THE MUTANTS THIS KILLS: `dest: "hand"` (the caption would read "into your
    // hand", which is Lana's Aid's destination on the same op) and a dropped
    // `maxHp` in `retrieveNoun` (the noun would read "a Basic Pokémon").
    expect(cardsPrompt(parked).note).toBe(
      "Put a Basic Pokémon with 70 HP or less from your discard pile onto your Bench.",
    );
  });

  it("puts the pick onto the BENCH — not into the hand, and with no shuffle", () => {
    const state = finBoard(85);
    const { state: parked } = mustApply(state, useOn("Gentle Fin"));
    const pick = pileUid(state, "fix-basic-1");
    const { state: done, events } = chooseCards(parked, [pick]);
    expect(done.players.p1.bench.map((b) => topUid(b))).toContain(pick);
    expect(done.players.p1.hand).not.toContain(pick);
    expect(done.players.p1.discard).not.toContain(pick);
    // ⚠️ THE MUTANT THIS KILLS: a trailing `shuffleDeck` — a Trainer's habit
    // landing on an Ability. Nothing here goes back to the deck.
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("⚠️ is refused from the BENCH — the `activeOnly` flag, which is a printed clause", () => {
    const state = finBoard(86);
    // Move the carrier off the Active Spot by promoting it to the Bench: the same
    // body, the same Ability, the wrong spot.
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const benched: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, active: null, bench: [...state.players.p1.bench, active] },
      },
    };
    const refused = applyAction(benched, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: benched.players.p1.bench.length - 1 },
      abilityName: "Gentle Fin",
    });
    // ⚠️ THE MUTANT THIS KILLS: `activeOnly: false`. The printed "if this Pokémon
    // is in the Active Spot" is a clause, not flavour, and the whole card is a
    // Bench-filler that would otherwise work from the Bench it fills.
    expect(refused.ok).toBe(false);
  });

  it("⚠️ is ONCE per turn — the second use is refused on the same board", () => {
    const state = finBoard(87);
    const { state: parked } = mustApply(state, useOn("Gentle Fin"));
    const { state: done } = chooseCards(parked, [pileUid(state, "fix-basic-1")]);
    // ⚠️ THE MUTANT THIS KILLS: `oncePerTurn: false` (Inferno Fandango's value,
    // the "as often as you like" printing) — the pile would empty into the Bench
    // in one turn.
    expect(applyAction(done, useOn("Gentle Fin")).ok).toBe(false);
  });

  it("does nothing at all when the pile holds no eligible body — the Ability still RUNS", () => {
    let state = withActive(88, "fix-gentlefin", 3, POFFIN_DECK);
    state = discardFromDeck(stocked(state, "p1", "fix-bigbody"), "p1", "fix-bigbody", 2);
    const benchBefore = state.players.p1.bench.length;
    const { state: done } = mustApply(state, useOn("Gentle Fin"));
    // The printed "you may" is the use itself plus the park; an empty candidate
    // set is a no-op rather than a refusal, exactly as a whiffed search is.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.bench).toHaveLength(benchBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D267 — Skyliner (Latias ex sv08-076/-220/-239): "Your Basic Pokémon in play
// have no Retreat Cost."
//
// The STAGE refinement on `noRetreatCostAura`, and the third row on that field.
// Everything about the aura already existed — the own-board scan, the derived
// seat, the §9 gate, the SET-TO-ZERO precedence over Beach Court's ± delta — so
// what is driven here is exactly the new conjunct and the two ways it can be
// wrong: read off the HOLDER instead of the TARGET, or applied when the field is
// ABSENT. Both need a board with a stage pair on it, which is why the deck holds
// one Basic and one Evolution that BOTH print a non-zero Retreat Cost.
// ─────────────────────────────────────────────────────────────────────────────

describe("Skyliner (Latias ex) — driven through the real engine", () => {
  /** P1 with `bodyId` Active on `SKYLINER_DECK` and a clean Bench. */
  const skylinerBoard = (seed: number, bodyId: string) =>
    withActive(seed, bodyId, 3, SKYLINER_DECK);

  /** P1's Active under every continuous retreat modifier in play. */
  function activeCost(state: GameState): number {
    const active = state.players.p1.active;
    if (active === null) throw new Error("p1 has no Active");
    return effectiveRetreatCost(state, active);
  }

  function activeBody(state: GameState) {
    const active = state.players.p1.active;
    if (active === null) throw new Error("p1 has no Active");
    return active;
  }

  it("authors the three printings as a STAGE-gated aura with NO energy clause", () => {
    // ⚠️ `toEqual`, not `toMatchObject`: a `requiresEnergyType` that crept in
    // would make this card free only bodies carrying an Energy it never names.
    expect(programFor("sv08-076")?.passive).toEqual({ noRetreatCostAura: { stage: "Basic" } });
    expect(programFor("sv08-220")).toBe(programFor("sv08-076"));
    expect(programFor("sv08-239")).toBe(programFor("sv08-076"));
    // …and NOT the object either neighbour on this field carries.
    expect(programFor("sv08-076")).not.toBe(programFor("sv03-082")); // Lunar Zone
    expect(programFor("sv08-076")).not.toBe(programFor("sv07-107")); // Metal Bridge
  });

  it("with no source in play the printed cost stands", () => {
    const state = skylinerBoard(90, "fix-retreat2");
    expect(hasFreeRetreatAura(state, activeBody(state))).toBe(false);
    expect(activeCost(state)).toBe(2);
  });

  it("a benched Latias ex frees a BASIC teammate carrying no Energy at all", () => {
    // ⚠️ THE MUTANT THIS KILLS: a `requiresEnergyType` on this row. The printed
    // sentence has NO energy clause, so the beneficiary here is deliberately
    // bare — an aura that demanded a provision would leave it at 2.
    const state = benchFromDeck(skylinerBoard(91, "fix-retreat2"), "p1", "fix-skyliner");
    expect(activeBody(state).energy).toHaveLength(0);
    expect(hasFreeRetreatAura(state, activeBody(state))).toBe(true);
    expect(activeCost(state)).toBe(0);
  });

  it("⚠️ an EVOLUTION on the same board is NOT freed — the gate is per TARGET", () => {
    // 🛑 THE MUTANT THIS KILLS, AND THE ONE THE LOOP INVITES: reading the stage
    // off `top` (the HOLDER's card) instead of the target's. Latias ex is itself
    // a Basic, so a holder-side read is green on every assertion above and frees
    // this Stage 1 too. Same seed family, same source, only the target differs.
    const state = benchFromDeck(skylinerBoard(92, "fix-stage1"), "p1", "fix-skyliner");
    expect(hasFreeRetreatAura(state, activeBody(state))).toBe(false);
    expect(activeCost(state)).toBe(2);
  });

  it("is SELF-inclusive: Latias ex frees its OWN printed retreat 2", () => {
    // The source set contains the target set — Latias ex is a Basic in play, and
    // the print carries no "other" and no "in the Active Spot". Unlike Clefable
    // ex (which must itself carry {P}) this holds unconditionally.
    const state = skylinerBoard(93, "fix-skyliner");
    expect(activeCost(state)).toBe(0);
  });

  it("🆕 the read is LIVE: evolving the freed Basic takes its freedom away", () => {
    let state = benchFromDeck(skylinerBoard(94, "fix-basic-1"), "p1", "fix-skyliner");
    expect(activeCost(state)).toBe(0); // a Basic, retreat 1 → free
    state = toHand(state, "fix-stage1");
    const { state: evolved } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-stage1"),
      target: { spot: "active" },
    });
    // §1.2 — a Pokémon's identity is its TOP card, so the same body stops being
    // Basic mid-turn and the aura stops reaching it in the same breath. Nothing
    // is stamped at attach time; a build that cached the stage passes everything
    // above and fails here.
    expect(activeCost(evolved)).toBe(2);
  });

  it("🛑 ABSENT is not 'Basic': Lunar Zone still frees an EVOLUTION carrying {P}", () => {
    // THE ATTRIBUTION CONTROL, on the same board and the same target as the
    // negative two cases up. `stage` absent means UNGATED on that axis; a build
    // that defaulted it to "Basic" passes every Skyliner assertion in this file
    // and silently un-builds Clefable ex's printed "All of your Pokémon".
    let state = benchFromDeck(skylinerBoard(95, "fix-stage1"), "p1", "sv03-082");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    expect(hasFreeRetreatAura(state, activeBody(state))).toBe(true);
    expect(activeCost(state)).toBe(0);
  });

  it("…and the two clauses do not leak into each other in the other direction", () => {
    // Lunar Zone alone, on a BASIC carrying no {P}: still 2. So "Skyliner frees
    // this Basic" above is attributable to Skyliner rather than to any aura being
    // in play, and the energy clause is still read when it IS spelled.
    const state = benchFromDeck(skylinerBoard(96, "fix-retreat2"), "p1", "sv03-082");
    expect(activeCost(state)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D268 — Distorted Future (Gothitelle svp-211/sv10.5w-043): "Once during your
// turn, if this Pokémon is in the Active Spot, you may have your opponent
// shuffle their hand into their deck and draw 3 cards."
//
// `handRefresh`'s THIRD `who` member, and the whole of its content is WHICH SEAT
// the op's seat list holds. Everything else on this op has been driven since M5
// (`handRefresh.test.ts`, off the Judge/Iono/Youngster registry ids) and none of
// it is re-litigated here.
//
// 🛑 EVERY ASSERTION BELOW IS A TWO-SEAT ONE, AND IT HAS TO BE. The two ways a
// one-member widening of a SEAT union goes wrong are `[ctx.seat]` (the `"you"`
// arm, reached by a fallthrough) and `[ctx.seat, otherSeat(ctx.seat)]` (the
// `"both"` arm, reached by a copy-paste). A board that only looks at the
// opponent's hand is GREEN on the second; a board that only looks at the
// controller's is GREEN on the first. Only asserting on BOTH hands in the same
// breath tells the three arms apart — which is why the deck is dealt to both
// seats and every `it` below reads both sides of the table.
// ─────────────────────────────────────────────────────────────────────────────

describe("Distorted Future (Gothitelle) — driven through the real engine", () => {
  /** P1 on turn 3 with `fix-distortedfuture` Active, on the two-seat deck. Both
      seats hold a real dealt hand — no surgery, because the hands are exactly
      what this row is about and trimming one would beg the question. */
  const distortedBoard = (seed: number) =>
    withActive(seed, "fix-distortedfuture", 3, DISTORTED_DECK);

  it("authors the two printings as an ACTIVE-ONLY once-per-turn opponent refresh", () => {
    // ⚠️ `toEqual`, not `toMatchObject`: a `toBottom` or an `onlyIfAnyMoved` that
    // crept in from Iono — the op's other two riders, neither of them printed
    // here — would leave the opponent's deck order intact or skip the draw off an
    // empty hand, and both are wrong-but-plausible cards.
    expect(programFor("svp-211")?.abilities).toEqual([
      {
        name: "Distorted Future",
        oncePerTurn: true,
        activeOnly: true,
        program: [{ op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 3 } }],
      },
    ]);
    expect(programFor("sv10.5w-043")).toBe(programFor("svp-211"));
    // …and NOT the object any other `handRefresh` author carries. Judge is the
    // `"both"` arm this row narrows and Skwovet is the other Ability on this op.
    expect(programFor("svp-211")).not.toBe(programFor("sv01-176")); // Judge
    expect(programFor("svp-211")).not.toBe(programFor("sv01-151")); // Skwovet
  });

  it("🛑 moves the OPPONENT's hand and leaves the CONTROLLER's alone — `who`'s whole content", () => {
    const state = distortedBoard(100);
    const mine = [...state.players.p1.hand];
    const theirs = [...state.players.p2.hand];
    // Both seats must actually be holding something, or "yours did not move" is
    // vacuously true and the assertion below proves nothing.
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);

    const { state: done } = mustApply(state, useOn("Distorted Future"));

    // ⚠️ THE MUTANT THIS KILLS: `who: "both"` (Judge's value). P1's hand is
    // IDENTICAL — the same uids in the same order, not merely the same size.
    expect(done.players.p1.hand).toEqual(mine);
    expect(done.players.p1.deck).toEqual(state.players.p1.deck);
    // ⚠️ THE MUTANT THIS KILLS: `who: "you"` (Youngster's value, and the arm a
    // fallthrough reaches). The opponent's hand is a NEW three cards, and none of
    // what they were holding survived into it.
    expect(done.players.p2.hand).toHaveLength(3);
    for (const uid of theirs) expect(done.players.p2.hand).not.toContain(uid);
  });

  it("the opponent's whole hand goes back into the OPPONENT's deck, and 3 come out", () => {
    const state = distortedBoard(101);
    const before = state.players.p2;
    const { state: done } = mustApply(state, useOn("Distorted Future"));
    // Conservation across the opponent's own two zones: hand + deck is unchanged
    // in total, and the hand end of it is exactly the printed 3.
    expect(done.players.p2.hand.length + done.players.p2.deck.length).toBe(
      before.hand.length + before.deck.length,
    );
    expect(done.players.p2.deck).toHaveLength(before.deck.length + before.hand.length - 3);
    // …and nothing was discarded or prized on the way — this op moves between two
    // zones and no others, on either seat.
    expect(done.players.p2.discard).toEqual(before.discard);
    expect(done.players.p2.prizes).toEqual(before.prizes);
  });

  it("emits ONE count-only shuffle event, and it names the OPPONENT's seat", () => {
    const state = distortedBoard(102);
    const held = state.players.p2.hand.length;
    const { events } = mustApply(state, useOn("Distorted Future"));
    const shuffles = findAll(events, "HAND_SHUFFLED_INTO_DECK");
    // ⚠️ THE MUTANT THIS KILLS: `who: "both"` again, from the LOG's side — two
    // events would be emitted and the first would name `p1`. And `toBottom` would
    // emit HAND_TO_BOTTOM_OF_DECK instead, which is Iono's rider, not this card's.
    expect(shuffles).toHaveLength(1);
    expect(shuffles[0]?.seat).toBe("p2");
    expect(shuffles[0]?.count).toBe(held);
    expect(types(events)).not.toContain("HAND_TO_BOTTOM_OF_DECK");
    // The draw is the opponent's too — a count-only fact about a hidden hand.
    const drawn = findAll(events, "CARDS_DRAWN");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.seat).toBe("p2");
    expect(drawn[0]?.uids).toHaveLength(3);
  });

  it("draws the printed 3 even from an EMPTY opponent hand — no `onlyIfAnyMoved`", () => {
    // ⚠️ THE MUTANT THIS KILLS: `onlyIfAnyMoved: true` (Iono's rider). This
    // sentence has no "if they do", so an opponent with nothing in hand still
    // reshuffles and still draws 3 — and the reshuffle is what makes it visible.
    const state = distortedBoard(103);
    const emptied: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          hand: [],
          deck: [...state.players.p2.deck, ...state.players.p2.hand],
        },
      },
    };
    const { state: done, events } = mustApply(emptied, useOn("Distorted Future"));
    expect(done.players.p2.hand).toHaveLength(3);
    expect(find(events, "HAND_SHUFFLED_INTO_DECK")?.count).toBe(0);
    // …and the controller still paid nothing on the empty-hand path either.
    expect(done.players.p1.hand).toEqual(state.players.p1.hand);
  });

  it("⚠️ is refused from the BENCH — the `activeOnly` flag, which is a printed clause", () => {
    const state = distortedBoard(104);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const benched: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, active: null, bench: [...state.players.p1.bench, active] },
      },
    };
    const refused = applyAction(benched, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: benched.players.p1.bench.length - 1 },
      abilityName: "Distorted Future",
    });
    // ⚠️ THE MUTANT THIS KILLS: `activeOnly: false` (Skwovet's value, the other
    // Ability on this op — which really does work from the Bench). "If this
    // Pokémon is in the Active Spot" is a clause, not flavour.
    expect(refused.ok).toBe(false);
  });

  it("⚠️ is ONCE per turn — the second use is refused on the same board", () => {
    const state = distortedBoard(105);
    const { state: done } = mustApply(state, useOn("Distorted Future"));
    // ⚠️ THE MUTANT THIS KILLS: `oncePerTurn: false` (Inferno Fandango's value) —
    // the opponent's deck would be reshuffled to nothing in a single turn.
    expect(applyAction(done, useOn("Distorted Future")).ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D269 — `coinFlipGate.otherwise`: the printed "Flip a coin. If heads, X. **If
// tails, Y.**" Picnicker svp-114 ("…draw 4 cards. If tails, draw 2 cards.") and
// Drasna sv08-173/-231 ("Shuffle your hand into your deck. Then, flip a coin. If
// heads, draw 8 cards. If tails, draw 3 cards.").
//
// ONE optional field on an existing op, spliced by the gate's EXISTING `unshift`.
// The coin itself, the event it emits, the rng account and the parking behaviour
// have all been driven since 0.x (`flipGatedOp.test.ts`, `multiCoinFlip.test.ts`,
// `tailsGatedOp.test.ts`) and none of it is re-litigated here.
//
// 🛑 THE FIELD'S WHOLE CONTENT IS WHAT THE **LOSING** FACE DOES, WHICH IS WHY
// EVERY ASSERTION BELOW IS SWEPT RATHER THAN SEEDED. There is no way to force a
// coin — `runProgram` takes it from `rngState` before it consults a branch — so
// the idiom is `multiCoinFlip.test.ts`'s: sweep a fixed seed list, read the face
// off the emitted ATTACK_EFFECT_COIN_FLIP row, and assert the arm that face
// selects. An `otherwise` that silently never ran would be GREEN on every heads
// board, so a suite that did not reach tails would assert nothing at all — hence
// the explicit both-faces-were-seen guard on every sweep.
//
// 🛑 AND THE THREE MUTANTS THIS SHAPE HAS TO TELL APART: splicing NOTHING on the
// losing face (the pre-D269 meaning, and the one a forgotten `?? []` restores),
// splicing `otherwise` on the WINNING face (the arms swapped), and splicing BOTH
// arms (a second `unshift` instead of a ternary). Picnicker separates them by a
// COUNT in one hand; Drasna separates them by whether the SHUFFLE happened, which
// is a different observable on the same field.
// ─────────────────────────────────────────────────────────────────────────────

describe("Picnicker / Drasna — the coin gate's `otherwise`, driven through the real engine", () => {
  /** The swept seed list. Fixed and small, so the sweep is deterministic and no
      single seed is load-bearing; 12 is comfortably enough for both faces on
      this deck (measured below by the both-faces guard each `it` carries). */
  const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  /** P1 on turn 3 with the flip-draw 60, the named Supporter pulled into hand and
      NOT yet played — so the caller can read the pre-play hand, which every count
      below is stated against. */
  function ready(seed: number, cardId: string): GameState {
    return toHand(board(seed, FLIP_DRAW_DECK), cardId);
  }

  function play(state: GameState, cardId: string): ReturnType<typeof mustApply> {
    return mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", cardId),
    });
  }

  /** The face this play actually landed, read off the log rather than off a seed. */
  function faceOf(events: GameEvent[]): "heads" | "tails" {
    const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip === undefined) throw new Error("no coin flip was emitted");
    return flip.result;
  }

  it("authors both printings as ONE two-armed coin gate each", () => {
    // ⚠️ `toEqual`, not `toMatchObject`: an `onTails: true` that crept in from the
    // op's OTHER optional field would swap which arm each face runs — a
    // wrong-but-plausible card that draws 2 on heads — and `toMatchObject` would
    // not see the extra key. The two fields are different axes and this is where
    // that is pinned.
    expect(programFor("svp-114")?.trainer).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: [{ op: "drawCards", count: 4 }],
        otherwise: [{ op: "drawCards", count: 2 }],
      },
    ]);
    expect(programFor("sv08-173")?.trainer).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],
        otherwise: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 3 } }],
      },
    ]);
    expect(programFor("sv08-231")).toBe(programFor("sv08-173"));
    // …and NOT the object either was modelled on. Lacey is the two-armed shape
    // Drasna copies with a COIN where its condition is, and sharing would make an
    // edit to one silently move a card that never printed the same words.
    expect(programFor("sv08-173")).not.toBe(programFor("sv07-139")); // Lacey
    expect(programFor("svp-114")).not.toBe(programFor("sv08-173"));
  });

  it("🛑 Picnicker draws 4 on heads and 2 on TAILS — the losing face is not nothing", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const state = ready(seed, "fix-picnicker");
      const held = state.players.p1.hand.length;
      const { state: done, events } = play(state, "fix-picnicker");
      const face = faceOf(events);
      seen.add(face);
      const drawn = face === "heads" ? 4 : 2;
      // ⚠️ THE MUTANT THIS KILLS on the tails rows: an absent/ignored `otherwise`
      // (the pre-D269 splice), which draws NOTHING on the losing face. The played
      // Supporter leaves the hand, so the hand moves by `drawn − 1`.
      expect(done.players.p1.hand).toHaveLength(held - 1 + drawn);
      // ⚠️ THE MUTANT THIS KILLS: splicing BOTH arms — six cards, one deck, and a
      // second CARDS_DRAWN row. Exactly ONE arm runs.
      const rows = findAll(events, "CARDS_DRAWN");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.seat).toBe("p1");
      expect(rows[0]?.uids).toHaveLength(drawn);
      expect(done.players.p1.deck).toHaveLength(state.players.p1.deck.length - drawn);
      // The opponent is untouched on either face — this card names one seat.
      expect(done.players.p2.hand).toEqual(state.players.p2.hand);
      expect(done.players.p2.deck).toEqual(state.players.p2.deck);
    }
    // 🛑 WITHOUT THIS THE WHOLE SWEEP IS VACUOUS. An `otherwise` that never ran is
    // green on every heads board, so a seed list that only reached heads would
    // assert nothing about the field this slice built.
    expect(seen).toEqual(new Set(["heads", "tails"]));
  });

  it("🛑 Drasna SHUFFLES ON BOTH FACES and draws 8 or 3 — LACEY's shape, coin-gated", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const state = ready(seed, "fix-drasna");
      const held = state.players.p1.hand.length;
      const { state: done, events } = play(state, "fix-drasna");
      const face = faceOf(events);
      seen.add(face);
      const drawn = face === "heads" ? 8 : 3;
      // ⚠️ THE SHARPEST ASSERTION IN THIS FILE FOR THIS FIELD: the hand is an
      // ABSOLUTE count, not a delta, because the whole of it went back first. An
      // ignored `otherwise` leaves the tails hand at ZERO; a swapped pair leaves
      // it at 8.
      expect(done.players.p1.hand).toHaveLength(drawn);
      // ⚠️ AND THE SHUFFLE IS IN BOTH ARMS ON PURPOSE — the card shuffles either
      // way and only the DRAW COUNT is what the second sentence replaces. A build
      // that hoisted the refresh out of the arms, or that put it in `then` alone,
      // is red here on the tails rows. `held − 1` because playTrainer takes the
      // played Supporter out of the hand before the program runs.
      const shuffles = findAll(events, "HAND_SHUFFLED_INTO_DECK");
      expect(shuffles).toHaveLength(1);
      expect(shuffles[0]?.seat).toBe("p1");
      expect(shuffles[0]?.count).toBe(held - 1);
      // …and it is the SHUFFLE form, not Iono's bottom-of-deck rider.
      expect(findAll(events, "HAND_TO_BOTTOM_OF_DECK")).toHaveLength(0);
      // Exactly one arm ran: one refresh, one draw.
      const rows = findAll(events, "CARDS_DRAWN");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.uids).toHaveLength(drawn);
      // Conservation across P1's own two zones, on either face.
      expect(done.players.p1.hand.length + done.players.p1.deck.length).toBe(
        held - 1 + state.players.p1.deck.length,
      );
      // `who: "you"` — the opponent's hand and deck are untouched on both arms.
      expect(done.players.p2.hand).toEqual(state.players.p2.hand);
      expect(done.players.p2.deck).toEqual(state.players.p2.deck);
    }
    expect(seen).toEqual(new Set(["heads", "tails"]));
  });

  it("⚠️ emits exactly ONE coin row on either face — the arm did not change the event", () => {
    // 🛑 THE PREDICTION THIS SLICE WROTE DOWN, MEASURED RATHER THAN ARGUED. The
    // flip is taken and announced BEFORE any branch is consulted, so a two-armed
    // gate emits precisely the one row a one-armed gate does — and the losing face
    // emits it too, which is what separates "the coin was taken and lost" from
    // "no coin was taken".
    for (const cardId of ["fix-picnicker", "fix-drasna"]) {
      for (const seed of SEEDS) {
        const state = ready(seed, cardId);
        const { state: done, events } = play(state, cardId);
        const flips = findAll(events, "ATTACK_EFFECT_COIN_FLIP");
        expect(flips, `${cardId} @${seed}`).toHaveLength(1);
        expect(flips[0]?.seat).toBe("p1");
        // The coin is taken on BOTH faces, so rngState always advances — the
        // account `flipGatedOp.test.ts` keeps for the one-armed gate, restated
        // for the two-armed one.
        expect(done.rngState).not.toBe(state.rngState);
      }
    }
  });

  it("⚠️ a two-armed gate is PLAYABLE while EITHER arm can act — cardplay's `or`", () => {
    // The descent in `programPlayable` used to rest on "a coin gate has no
    // `otherwise`, so `then` is the only thing the card can ever do". That is now
    // false, and the rule it was replaced with is `or`, not `and`. No printed row
    // can reach it — both arms of both cards are draws — so it is driven as a
    // CONSTRUCTED program, which is the honest shape for a rule with no card.
    const state = board(0, FLIP_DRAW_DECK);
    const empty = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, bench: [] } },
    };
    // `gust` into an empty opponent Bench is the canonical whiff-only op.
    const whiffOnly: EffectOp[] = [{ op: "gust" }];
    const canAct: EffectOp[] = [{ op: "drawCards", count: 1 }];
    /** One factory rather than four literals, so the four cases below differ by
        their ARMS alone and the union's `then` key is spelled once. */
    const gate = (arm: EffectOp[], other?: EffectOp[]): EffectOp[] => [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: arm,
        ...(other === undefined ? {} : { otherwise: other }),
      },
    ];
    // The ONE-ARMED refusal, unchanged by this slice: `then` is all the card does.
    expect(programPlayable(empty, gate(whiffOnly), "p1")).toBe(false);
    // ⚠️ THE MUTANT THIS KILLS: refusing on `then` alone. The tails arm draws, so
    // the card CAN do something and §7's "no valid target" refusal does not apply.
    expect(programPlayable(empty, gate(whiffOnly, canAct), "p1")).toBe(true);
    // …and symmetrically, so the rule is not accidentally reading only `otherwise`.
    expect(programPlayable(empty, gate(canAct, whiffOnly), "p1")).toBe(true);
    // BOTH arms whiff-only is still a refusal — the `and` half of the `or`.
    expect(programPlayable(empty, gate(whiffOnly, whiffOnly), "p1")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D270 — `HandRefreshDraw.perSeat`: the printed "…**you** draw 5 cards, and
// **your opponent** draws 3 cards." Harlequin sv10.5w-083/-163, inside the coin
// gate D269 gave a second arm — "Each player shuffles their hand into their deck.
// Then, flip a coin. If heads, you draw 5 cards, and your opponent draws 3 cards.
// If tails, you draw 3 cards, and your opponent draws 5 cards."
//
// ONE union member on an EXISTING field, read by the op's EXISTING per-seat draw
// loop. The seats are `who: "both"`'s, unchanged since Judge; the shuffle, the
// count-only events and the hiding are all M5 behaviour and none of it is
// re-litigated here. What is new is that the COUNT is a function of WHICH seat.
//
// 🛑 THE CONTRAST IS TWO-DIMENSIONAL — A FACE **AND** A SEAT — SO EVERY `it`
// CARRIES BOTH GUARDS. A coin cannot be forced (`runProgram` takes it from
// `rngState` before it consults a branch), so the face is swept and read off the
// emitted ATTACK_EFFECT_COIN_FLIP row; and because the printed pair is SWAPPED
// between the two arms, {5,3} is dealt to somebody on every board under every
// wrong build. Only reading BOTH hands on BOTH faces separates them.
//
// 🛑 THE FOUR MIS-BUILDS THIS SHAPE HAS TO TELL APART:
//   1. `you` for EVERY affected seat (the `seat === controller` test dropped) —
//      green on the controller's hand on both faces, red on the opponent's;
//   2. the PAIR read backwards (`opponent` to the controller) — green on the
//      totals and on every count-conservation sum, red on WHICH hand got the 5;
//   3. the ARMS swapped (5/3 on tails) — green on every single-face board;
//   4. the member collapsing to one of the older kinds (`fixed` 5, say) — green
//      on the controller and red on the opponent, and green on a `who: "you"`
//      board, which is why this suite is the one that must hold two seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("Harlequin — `handRefresh`'s PER-SEAT draw, driven through the real engine", () => {
  /** The swept seed list, `FLIP_DRAW_DECK`'s idiom on this slice's own 60. Fixed
      and small, so no single seed is load-bearing; the both-faces guard on each
      `it` measures that 12 is enough rather than asserting it in prose. */
  const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  /** P1 on turn 3 with the Harlequin 60 and one copy in hand, NOT yet played — so
      the caller reads the pre-play hands of BOTH seats, which every count below is
      stated against. */
  function ready(seed: number): GameState {
    return toHand(board(seed, HARLEQUIN_DECK), "fix-harlequin");
  }

  function play(state: GameState): ReturnType<typeof mustApply> {
    return mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-harlequin"),
    });
  }

  /** The face this play actually landed, read off the log rather than off a seed. */
  function faceOf(events: GameEvent[]): "heads" | "tails" {
    const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip === undefined) throw new Error("no coin flip was emitted");
    return flip.result;
  }

  it("authors the printing as ONE two-armed gate over a per-seat pair", () => {
    // ⚠️ `toEqual`, not `toMatchObject`: the whole content of this row is a pair of
    // NUMBERS and which key each sits under, and `toMatchObject` would not see an
    // `onTails: true` that swapped the arms or a stray fourth key on the draw.
    expect(programFor("sv10.5w-083")?.trainer).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
        otherwise: [
          { op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 3, opponent: 5 } },
        ],
      },
    ]);
    expect(programFor("sv10.5w-163")).toBe(programFor("sv10.5w-083"));
    // …and NOT the object it was modelled on. Drasna is the same two-armed gate
    // with ONE seat and a `fixed` pair of counts; sharing would make an edit to
    // either silently move a card that never printed the same words.
    expect(programFor("sv10.5w-083")).not.toBe(programFor("sv08-173")); // Drasna
    expect(programFor("sv10.5w-083")).not.toBe(programFor("sv07-139")); // Lacey
  });

  it("🛑 deals 5 to the CONTROLLER and 3 to the OPPONENT on heads — and swaps on TAILS", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const state = ready(seed);
      const p1Held = state.players.p1.hand.length;
      const p2Held = state.players.p2.hand.length;
      // 🛑 WITHOUT THIS THE SECOND HALF OF EVERY ASSERTION BELOW IS VACUOUS. "The
      // opponent's whole hand went back" says nothing about a hand that was empty.
      expect(p1Held, `p1 pre-hand @${seed}`).toBeGreaterThan(1);
      expect(p2Held, `p2 pre-hand @${seed}`).toBeGreaterThan(0);
      const { state: done, events } = play(state);
      const face = faceOf(events);
      seen.add(face);
      const [mine, theirs] = face === "heads" ? [5, 3] : [3, 5];
      // ⚠️ ABSOLUTE counts, not deltas: the whole of each hand went back first, so
      // what is left IS what was drawn. `p1Held − 1` never appears here — the
      // played Supporter left the hand before the refresh, and the refresh then
      // took everything else.
      // ⚠️ THE MUTANTS THIS KILLS, and it takes both seats in the same breath:
      // `you` for every seat (p2 would hold `mine`), the pair read backwards (p1
      // would hold `theirs`), and the member collapsing to `fixed` (p2 would hold
      // p1's number). Each is green on exactly one of these two lines.
      expect(done.players.p1.hand, `p1 @${seed} ${face}`).toHaveLength(mine);
      expect(done.players.p2.hand, `p2 @${seed} ${face}`).toHaveLength(theirs);
      // ⚠️ AND THE ARMS-SWAPPED MUTANT IS KILLED BY THE FACE, NOT BY THE COUNTS:
      // 5 and 3 are both dealt on either face, so the only thing that separates
      // `then` from `otherwise` is which seat holds which on which coin.
      expect(mine === 5).toBe(face === "heads");
    }
    // 🛑 A per-seat pair that is never swapped is GREEN on a heads-only sweep.
    expect(seen).toEqual(new Set(["heads", "tails"]));
  });

  it("⚠️ shuffles BOTH hands back first — `who: 'both'`, on either face", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const state = ready(seed);
      const p1Held = state.players.p1.hand.length;
      const p2Held = state.players.p2.hand.length;
      const { state: done, events } = play(state);
      const face = faceOf(events);
      seen.add(face);
      const [mine, theirs] = face === "heads" ? [5, 3] : [3, 5];
      // TWO count-only rows, one per seat, in seat order — the controller first,
      // which is the order `handRefresh`'s seat list is built in.
      const shuffles = findAll(events, "HAND_SHUFFLED_INTO_DECK");
      expect(shuffles, `@${seed}`).toHaveLength(2);
      expect(shuffles[0]?.seat).toBe("p1");
      // `p1Held − 1`: playTrainer takes the played Supporter out of the hand
      // before the program runs, so the refresh never sees it.
      expect(shuffles[0]?.count).toBe(p1Held - 1);
      expect(shuffles[1]?.seat).toBe("p2");
      expect(shuffles[1]?.count).toBe(p2Held);
      // …and it is the SHUFFLE form, not Iono's bottom-of-deck rider.
      expect(findAll(events, "HAND_TO_BOTTOM_OF_DECK")).toHaveLength(0);
      // Exactly one arm ran — two draws, not four, and one per seat.
      const rows = findAll(events, "CARDS_DRAWN");
      expect(rows).toHaveLength(2);
      expect(rows[0]?.seat).toBe("p1");
      expect(rows[0]?.uids).toHaveLength(mine);
      expect(rows[1]?.seat).toBe("p2");
      expect(rows[1]?.uids).toHaveLength(theirs);
      // Conservation, per seat and across the two zones the op moves cards
      // between. The played Supporter is in neither, hence the `− 1` on p1.
      expect(done.players.p1.hand.length + done.players.p1.deck.length).toBe(
        p1Held - 1 + state.players.p1.deck.length,
      );
      expect(done.players.p2.hand.length + done.players.p2.deck.length).toBe(
        p2Held + state.players.p2.deck.length,
      );
    }
    expect(seen).toEqual(new Set(["heads", "tails"]));
  });

  it("⚠️ the count is CONTROLLER-relative, not `p1`-relative — P2 plays the same object", () => {
    // 🛑 THE MUTANT THIS KILLS AND NOTHING ELSE IN THIS FILE CAN: a `perSeat` arm
    // that hard-codes `p1` (or reads the loop's seat against a literal) is green on
    // every board above, because P1 is the controller in all of them. The op is
    // controller-relative like every other field in this vocabulary, so the SAME
    // program object played from the other seat must mirror the pair.
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      // P1 opens and immediately passes, so it is P2's turn on the same 60.
      const opening = board(seed, HARLEQUIN_DECK);
      const p2Turn = must(applyAction(opening, { type: "endTurn", seat: "p1" }));
      const state = handFromDeck(
        handToDeck(p2Turn, "p2", "fix-harlequin"),
        "p2",
        "fix-harlequin",
        1,
      );
      const p1Held = state.players.p1.hand.length;
      const p2Held = state.players.p2.hand.length;
      expect(p1Held, `p1 pre-hand @${seed}`).toBeGreaterThan(0);
      expect(p2Held, `p2 pre-hand @${seed}`).toBeGreaterThan(1);
      const { state: done, events } = mustApply(state, {
        type: "playTrainer",
        seat: "p2",
        uid: handUid(state, "p2", "fix-harlequin"),
      });
      const face = faceOf(events);
      seen.add(face);
      const [mine, theirs] = face === "heads" ? [5, 3] : [3, 5];
      // MIRRORED: "you" is now P2 and "your opponent" is now P1.
      expect(done.players.p2.hand, `controller p2 @${seed} ${face}`).toHaveLength(mine);
      expect(done.players.p1.hand, `opponent p1 @${seed} ${face}`).toHaveLength(theirs);
      // The controller is dealt FIRST whichever seat it is — the seat list is
      // `[ctx.seat, otherSeat(ctx.seat)]`, not `[p1, p2]`.
      const rows = findAll(events, "CARDS_DRAWN");
      expect(rows[0]?.seat).toBe("p2");
      expect(rows[1]?.seat).toBe("p1");
    }
    expect(seen).toEqual(new Set(["heads", "tails"]));
  });

  it("⚠️ the OTHER `draw` kinds are untouched — a widening, not a rewrite", () => {
    // 🆕 D268's LESSON, APPLIED TO THIS UNION: a one-member widening must re-run
    // the arms it did not change, because the sharpest mutant is the new member
    // SWALLOWING an old one. `handRefresh.test.ts` drives `fixed`/`handPlus`/
    // `prizeCount` off registry ids and is the killer for that class; this row is
    // the cheap structural half — the three older kinds still author as they did,
    // and none of them grew a seat key.
    expect(programFor("fix-drasna")?.trainer).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],
        otherwise: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 3 } }],
      },
    ]);
    expect(programFor("fix-distortedfuture")?.abilities?.[0]?.program).toEqual([
      { op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 3 } },
    ]);
  });
});
