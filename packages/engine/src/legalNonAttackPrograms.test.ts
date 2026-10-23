import type { Card } from "@colorless/schema";
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
  completeSetup,
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
  findEvent,
} from "./testFixtures";

const LANDED = [
  {
    program: "Inviting Wink (Lillie's Ribombee)",
    fixture: null,
    ids: ["sv09-067", "sv09-164", "svp-183"],
    legal: 3,
    ops: "onEvolve trigger + optional + bottomFromOpponentHand{basicPokemon, dest bench, upTo \"any\"} — Mandibuzz's op on Arven's Greedent's trigger, at a count the card does not name",
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
    fixture: null,
    ids: ["sv06-053", "sv06-174", "svp-117"],
    legal: 3,
    ops: "betweenTurns trigger + counterEachAll{10, abilityPokemon, exceptNamed:\"Froslass\"} — the FIRST engine diff in four slices. `healEachAll`'s COUNTER TWIN, and the printed parenthetical is the argument for the seat-blind walk: Picnic Basket prints \"each Pokemon (both yours and your opponent's)\" and this card prints the same six words. The noun reuses D285's existing `abilityPokemon` member whole and the exemption reuses D273's `exceptNamed` rider spelling verbatim, so the only NEW thing is the op. \u26a0\ufe0f THE TWO PREDICATES SUBTRACT RATHER THAN CONJOIN — a Froslass HAS an Ability, so it satisfies the noun and is removed only by the rider; an `&&` would counter every Froslass on the table. NO `activeOnly` (Garganacl's shape, not Trevenant's) and NO `doesNotStack`, so three Froslass in play place three counters",
  },
  {
    program: "Cursed Blast (Dusclops)",
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
    fixture: null,
    ids: ["svp-153", "svp-159", "sv08-059"],
    legal: 3,
    ops: "activated ability (oncePerTurn, no activeOnly) + attachEnergyFrom{source discard, targetType Lightning} × THREE + knockOutSelf — **ZERO engine diff**, the first row in five slices to cost none. Ὥ1 THREE OPS AND NOT `count: 3`: `ASSEMBLE_ALLOY`'s call (D263) at a third unit, and `attachEnergyFrom.count`'s own doc — the printed *in any way you like* is N INDEPENDENT decisions that may land on N bodies, where `count` parks ONCE and pins the batch. NO `energyType`, because the printed noun is the bare *Basic Energy cards* with no brace code; `targetType` is the OTHER printed noun. `knockOutSelf` LAST, because every attach PARKS and a KO authored first would destroy a target the prompt was still offering. AND THIS ROW IS THE ONE D345 REFUSED IN ERROR — the ladder bullet below has priced it correctly since D263 (*the attach IS expressible, 3 ops, targetType Lightning*), D345 spent the one blocker that bullet named and then rewrote the residue note to claim a different one, in NINE FILES. **A RESIDUE NOTE CAN ROT BY BEING REWRITTEN, and that rot disagrees with nothing, so no re-derivation catches it**",
  },
  {
    program: "Buzzing Boost (Yanmega ex)",
    fixture: null,
    ids: ["sv10-003", "sv10-206", "sv10-228"],
    legal: 3,
    ops: "activated ability (oncePerTurn, activeOnly, playableIf yourActivePromotedThisTurn) + attachFromDeck{basicEnergy Grass, max 3, toSelf} + shuffleDeck — **ZERO engine diff, and the first row in this table whose BOTH pieces were bought by other slices for other cards**: `attachFromDeck.toSelf` is D171's (authored at `max: 1` for Pawmot, and this is its first row above one) and `BoardCondition.yourActivePromotedThisTurn` is D124's, authored for the ATTACK-column printings of the SAME clause (Revavroom ex ×2, Keldeo ex ×3, *If this Pokémon moved from your Bench to the Active Spot this turn…*). THE DESIGN CALL IS A NAMED EXCEPTION TO `playableIf`'s OWN DOC, which forbids per-body predicates because `conditionHolds` takes a seat and no uid: `activeOnly: true` GIVES the self-pronoun its referent by pinning the host to the one body the predicate reads, so the exception is the CONJUNCTION and not the predicate. D310's standing question (*the second per-body printing generalises `remainingHpAtMost`*) is therefore answered NO, and answered in that field's own doc block rather than left to be re-asked — D346's spent-note rule applied to a spent QUESTION. RECORDED LIMITATION: the print is a MOMENT and this is a GATE re-checked at use time, so a body switched back DOWN in the same turn loses the use; it REFUSES rather than affords (D222) and §6 drives it",
  },
  {
    program: "Glittering Star Pattern (Ledian)",
    fixture: null,
    ids: ["svp-133", "sv07-003", "sv07-144"],
    legal: 3,
    ops: "onEvolve trigger + gust{remainingHpAtMost 90} — DEFIANT_HORN's two pieces with one printed relative clause on the candidate scan",
  },
  {
    program: "Bianca's Devotion",
    fixture: null,
    ids: ["sv05-142", "sv05-197", "sv05-209"],
    legal: 3,
    ops: "healChosen{amount all, remainingHpAtMost 30} — Potion's op, and the FIRST printing that forced this op a `programPlayable` line",
  },
] as const;

const DROPPED: { sentence: string; ids: string[]; legal: number; needs: string }[] = [] as const;

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
  "fix-arvenssandwich": {
    ...trainerCard("fix-arvenssandwich", "Item", "Heal 30 damage from 1 of your Pokémon."),
    name: "Arven's Sandwich",
  },
  "fix-plainstage1": battler("fix-plainstage1", {
    name: "fix-plainstage1",
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    hp: 150,
    retreat: 1,
  }),
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
  "fix-smallstage1": battler("fix-smallstage1", {
    name: "fix-smallstage1",
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    hp: 60,
    retreat: 1,
  }),
  "fix-clemontsquickwit": trainerCard(
    "fix-clemontsquickwit",
    "Supporter",
    "Heal 60 damage from each of your {L} Pokémon.",
  ),
  "fix-lightningbody": battler("fix-lightningbody", { types: ["Lightning"], hp: 200 }),
  "fix-dualtypebody": battler("fix-dualtypebody", { types: ["Metal", "Lightning"], hp: 200 }),
  "fix-skyliner": abilityBody(
    "fix-skyliner",
    "Skyliner",
    "Your Basic Pokémon in play have no Retreat Cost.",
    { hp: 210, retreat: 2, types: ["Psychic"] },
  ),
  "fix-distortedfuture": abilityBody(
    "fix-distortedfuture",
    "Distorted Future",
    "Once during your turn, if this Pokémon is in the Active Spot, you may have your opponent shuffle their hand into their deck and draw 3 cards.",
  ),
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

const DISTORTED_DECK = deckOf({
  "fix-distortedfuture": 4,
  "fix-bigbody": 20,
  "fix-basic-1": 8,
  "fix-attacker": 4,
  "fix-energy": 24,
});

const FLIP_DRAW_DECK = deckOf({
  "fix-picnicker": 4,
  "fix-drasna": 4,
  "fix-bigbody": 20,
  "fix-basic-1": 8,
  "fix-energy": 24,
});

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

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function localSetup(seed: number, first: Seat, deck: string[]): GameState {
  const created = createGame({ seed, decks: { p1: deck, p2: deck }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  state = completeSetup(state);
  return state;
}

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
  it("registers every Standard-legal printing in the table, one shared object per program", () => {
    for (const { program, ids, fixture, legal } of LANDED) {
      expect(ids, `${program}: id list disagrees with its measured legal count`).toHaveLength(
        legal,
      );
      const first = programFor(ids[0] as string);
      expect(first, `${program}: ${ids[0]} has no program`).toBeDefined();
      for (const id of ids) expect(programFor(id), `${id} left ${program}`).toBe(first);
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
    expect(LANDED).toHaveLength(58);
    expect(LANDED.reduce((n, l) => n + l.legal, 0)).toBe(122);
  });

  it("does NOT share an object with the near-twin each was modelled on", () => {
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
    expect(programFor("sv07-138")?.trainer).toEqual([
      { op: "payFromHand", count: 2, to: "deckBottom", recordAs: "paid" },
      {
        op: "recordGate",
        slot: "paid",
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

  it("the DROPPED sentences are still UNBUILT — the work order cannot rot ( D570: the list is EMPTY, so the guard asserts the GRADUATION of its last row instead)", () => {
    expect(DROPPED).toEqual([]);
    for (const id of [
      "sv06-018",
      "sv06-044",
      "sv06-089",
      "sv06-170",
      "sv08.5-010",
      "sv08.5-020",
      "sv08.5-021",
    ]) {
      expect(
        programFor(id)?.passive?.attackTwiceIf,
        `${id} graduated from DROPPED at D570`,
      ).toEqual({
        kind: "stadiumInPlayNamed",
        name: "Festival Grounds",
      });
    }
    expect(DROPPED).toHaveLength(0);
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
    for (const e of placed) expect(e.amount).toBe(20);
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
    expect(findEvent(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p1",
      ability: "Sudden Shearing",
    });
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
    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "burned" });
    expect(done.players.p2.active?.conditions.burned).toBe(true);
    expect(done.players.p1.active?.conditions.burned).toBe(false);
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("Calming Light puts the OPPONENT's Active ASLEEP — the rotation slot, not the Burn flag", () => {
    const state = deepFreeze(withActive(10, "fix-calminglight"));
    const { state: done, events } = mustApply(state, useOn("Calming Light"));
    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "asleep" });
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
    expect(done.players.p2.active?.conditions.burned).toBe(false);
  });

  it("Dangerous Laser lands BOTH conditions — two ops, two places on the model", () => {
    const state = deepFreeze(board(11, TRN_DECK));
    const { state: done, events } = playFromHand(state, "fix-dangerouslaser");
    const applied = findAll(events, "STATUS_APPLIED").map((e) => e.status);
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
    expect(findEvent(events, "STATUS_PREVENTED")).toMatchObject({ seat: "p1", status: "asleep" });
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
    expect(findEvent(events, "ENERGY_ATTACHED")?.uid).toBe(fromPile);
    expect(done.players.p1.discard).not.toContain(fromPile);
    expect(done.players.p1.hand).toHaveLength(handBefore);
    expect(done.players.p1.active?.energy).toContain(fromPile);
  });
});

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
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(findEvent(events, "ENERGY_ATTACHED")?.uid).toBe(fromPile);
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
    expect(findEvent(events, "ENERGY_ATTACHED")?.uid).toBe(fromPile);
    expect(done.players.p1.bench[0]?.energy).toContain(fromPile);
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
    expect(findEvent(events, "HEALED")?.amount).toBe(30);
    expect(done.players.p1.active?.damage).toBe(70);
  });
});

describe("Reconstitute / Up-Tempo — the hand-cost rows", () => {
  it("Reconstitute pays TWO to the discard and draws ONE", () => {
    const state = withActive(18, "fix-reconstitute");
    const handBefore = state.players.p1.hand.length;
    const { state: parked } = mustApply(state, useOn("Reconstitute"));
    const prompt = cardsPrompt(parked);
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    const picks = prompt.candidates.slice(0, 2) as string[];
    const { state: done, events } = chooseCards(parked, picks);
    expect(findEvent(events, "HAND_COST_PAID")?.uids).toEqual(picks);
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(1);
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
    expect(done.players.p2.active?.damage).toBe(100);
  });
});

describe("Clemont's Quick Wit — the TYPE GATE on healEach, driven through the real engine", () => {
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
    expect(done.players.p1.bench[1]?.damage).toBe(100);
    expect(done.players.p1.bench[2]?.damage).toBe(40);
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
    expect(healed.some((e) => e.uid === skipped)).toBe(false);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("is a NO-OP, not a refusal, on a board with no {L} Pokémon at all", () => {
    let state = board(70, QUICKWIT_DECK);
    state = setActiveFromDeck(state, "p1", "fix-bigbody");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = setDamage(state, "p1", 100);
    const { state: done, events } = playFromHand(state, "fix-clemontsquickwit");
    expect(findAll(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.active?.damage).toBe(100);
  });

  it("leaves the UNGATED sentence ungated — Fennel still heals a {L} body", () => {
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
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expect(done.players.p1.hand).toHaveLength(handBefore); // +1 drawn from deck, −1 played
  });
});

describe("the searchDeck rows — Master Ball / Treasure Tracker", () => {
  it("Master Ball searches the WHOLE deck for a Pokémon, with NO coin flip", () => {
    const state = board(29, TRN_DECK);
    const { state: parked, events } = playFromHand(state, "fix-masterball");
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
    expect(findEvent(payEvents, "HAND_COST_PAID")?.uids).toEqual(picks);
    expect(findEvent(payEvents, "CARDS_DRAWN")).toBeUndefined();
    const order = orderPrompt(paidState);
    expect(order.candidates).toEqual(picks);
    expect(paidState.players.p1.deck.slice(-2)).toEqual(picks);
    for (const uid of picks) expect(paidState.players.p1.discard).not.toContain(uid);
    const reversed = [...picks].reverse();
    const { state: done, events } = orderCards(paidState, reversed);
    expect(done.players.p1.deck.slice(-2)).toEqual(reversed);
    expect(done.players.p1.deck.slice(0, -2)).toEqual(paidState.players.p1.deck.slice(4, -2));
    expect(findEvent(payEvents, "DECK_TOP_REORDERED")).toEqual({
      type: "DECK_TOP_REORDERED",
      seat: "p1",
      actor: "p1",
      count: 2,
      end: "bottom",
    });
    expect(events.filter((e) => e.type === "DECK_TOP_REORDERED")).toEqual([]);
    // …and the gate fired: +1 Kofu drawn from hand, −2 paid, +4 drawn.
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(4);
    expect(done.players.p1.hand).toHaveLength(handBefore + 1 - 1 - 2 + 4 - 0);
    expect(done.players.p1.deck).toHaveLength(deckBefore - 1 + 2 - 4);
  });

  it("D343 — asks for the ORDER even when the PAYMENT had no choice in it", () => {
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
    expect(findEvent(played.events, "HAND_COST_PAID")?.uids).toEqual(spares);
    expect(played.state.players.p1.deck.slice(-2)).toEqual(spares);
    // …and the engine is nevertheless parked on the ORDERING, over exactly the
    // two cards that were just paid. This is the assertion the old program could
    // not have passed.
    const order = orderPrompt(played.state);
    expect(order.candidates).toEqual(spares);
    expect(order.note).toBe("Put these cards on the bottom of your deck in any order.");
    // The reversed answer reaches the board, and the draw is still owed.
    const flipped = [...spares].reverse();
    const { state: done, events } = orderCards(played.state, flipped);
    expect(done.players.p1.deck.slice(-2)).toEqual(flipped);
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(4);
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
    expect(findEvent(versusEx.events, "DAMAGE_DEALT")?.dealt).toBe(80);
    const versusPlain = mustApply(deepFreeze(belted(34, "fix-bigbody", "fix-maximumbelt")), bite);
    expect(findEvent(versusPlain.events, "DAMAGE_DEALT")?.dealt).toBe(30);
    // The non-vacuous control: the same ex defender with no Tool at all.
    const noTool = mustApply(deepFreeze(belted(35, "fix-attacker-ex")), bite);
    expect(findEvent(noTool.events, "DAMAGE_DEALT")?.dealt).toBe(30);
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
    expect(findEvent(poisoned.events, "DAMAGE_DEALT")?.dealt).toBe(70);
    const clean = mustApply(deepFreeze(mochi(37, "none")), bite);
    expect(findEvent(clean.events, "DAMAGE_DEALT")?.dealt).toBe(30);
    const wrongSide = mustApply(deepFreeze(mochi(38, "defender")), bite);
    expect(findEvent(wrongSide.events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("a BENCHED holder contributes nothing — the fold reads the ATTACKER and no one else", () => {
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
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
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
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });
});

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
    expect(prompt.candidates.length).toBeGreaterThan(0);
    expect(prompt.max).toBe(3);
  });

  it("takes an EVOLUTION Pokémon — the card that separates `anyPokemon` from `basicPokemon`", () => {
    const state = lanaPile(71);
    const stage1 = pileUid(state, "fix-plainstage1");
    const { state: parked } = playFromHand(state, "fix-lanasaid");
    expect(cardsPrompt(parked).candidates).toContain(stage1);
    const { state: done } = chooseCards(parked, [stage1]);
    expect(done.players.p1.hand).toContain(stage1);
    expect(done.players.p1.discard).not.toContain(stage1);
  });

  it("refuses the Pokémon ex — the `noRuleBox` rider, which is the whole clause", () => {
    const state = lanaPile(72);
    const { state: parked } = playFromHand(state, "fix-lanasaid");
    expect(cardsPrompt(parked).candidates).not.toContain(pileUid(state, "fix-attacker-ex"));
  });

  it("refuses the SPECIAL Energy — `basicEnergy`, not `anyEnergy`", () => {
    const state = lanaPile(73);
    const { state: parked } = playFromHand(state, "fix-lanasaid");
    expect(cardsPrompt(parked).candidates).not.toContain(pileUid(state, "fix-special"));
  });

  it("captions the prompt with the printed noun, joined — the `anyOf` arm's first witness", () => {
    const state = lanaPile(74);
    const { state: parked } = playFromHand(state, "fix-lanasaid");
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
    expect([...prompt.candidates].sort()).toEqual([...sandwiches].sort());
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
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("captions the prompt with the printed 'cards' — the `cardNoun` rider", () => {
    const state = greedBoard(78, 3);
    const { state: parked } = mustApply(state, evolveIntoGreedent(state));
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
    expect(idsOf(parked, prompt.candidates)).toEqual(["fix-basic-1"]);
    expect(prompt.candidates.length).toBeGreaterThan(0);
    expect(prompt.max).toBe(2);
  });

  it("captions the prompt with the printed noun — the rider is a CAPTION rider too", () => {
    const state = poffinBoard(81);
    const { state: parked } = playFromHand(state, "fix-buddybuddypoffin");
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
    expect(types(events)).toContain("SHUFFLE");
  });

  it("the threshold is INCLUSIVE — `<= 70`, not `< 70`", () => {
    const onTheLine = battler("fix-line-70", { hp: 70 });
    expect(matchesFilter(onTheLine, { kind: "basicPokemon", maxHp: 70 })).toBe(true);
    expect(
      matchesFilter(battler("fix-line-71", { hp: 71 }), { kind: "basicPokemon", maxHp: 70 }),
    ).toBe(false);
  });

  it("a NULL printed hp is REFUSED rather than admitted — the data-gap arm", () => {
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
    expect(prompt.max).toBe(1);
  });

  it("captions the prompt with the printed sentence, verb and destination included", () => {
    const state = finBoard(84);
    const { state: parked } = mustApply(state, useOn("Gentle Fin"));
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
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("is refused from the BENCH — the `activeOnly` flag, which is a printed clause", () => {
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
    expect(refused.ok).toBe(false);
  });

  it("is ONCE per turn — the second use is refused on the same board", () => {
    const state = finBoard(87);
    const { state: parked } = mustApply(state, useOn("Gentle Fin"));
    const { state: done } = chooseCards(parked, [pileUid(state, "fix-basic-1")]);
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
    const state = benchFromDeck(skylinerBoard(91, "fix-retreat2"), "p1", "fix-skyliner");
    expect(activeBody(state).energy).toHaveLength(0);
    expect(hasFreeRetreatAura(state, activeBody(state))).toBe(true);
    expect(activeCost(state)).toBe(0);
  });

  it("an EVOLUTION on the same board is NOT freed — the gate is per TARGET", () => {
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

  it("the read is LIVE: evolving the freed Basic takes its freedom away", () => {
    let state = benchFromDeck(skylinerBoard(94, "fix-basic-1"), "p1", "fix-skyliner");
    expect(activeCost(state)).toBe(0); // a Basic, retreat 1 → free
    state = toHand(state, "fix-stage1");
    const { state: evolved } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-stage1"),
      target: { spot: "active" },
    });
    expect(activeCost(evolved)).toBe(2);
  });

  it("ABSENT is not 'Basic': Lunar Zone still frees an EVOLUTION carrying {P}", () => {
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

describe("Distorted Future (Gothitelle) — driven through the real engine", () => {
  const distortedBoard = (seed: number) =>
    withActive(seed, "fix-distortedfuture", 3, DISTORTED_DECK);

  it("authors the two printings as an ACTIVE-ONLY once-per-turn opponent refresh", () => {
    expect(programFor("svp-211")?.abilities).toEqual([
      {
        name: "Distorted Future",
        oncePerTurn: true,
        activeOnly: true,
        program: [{ op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 3 } }],
      },
    ]);
    expect(programFor("sv10.5w-043")).toBe(programFor("svp-211"));
    expect(programFor("svp-211")).not.toBe(programFor("sv01-176")); // Judge
    expect(programFor("svp-211")).not.toBe(programFor("sv01-151")); // Skwovet
  });

  it("moves the OPPONENT's hand and leaves the CONTROLLER's alone — `who`'s whole content", () => {
    const state = distortedBoard(100);
    const mine = [...state.players.p1.hand];
    const theirs = [...state.players.p2.hand];
    // Both seats must actually be holding something, or "yours did not move" is
    // vacuously true and the assertion below proves nothing.
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);

    const { state: done } = mustApply(state, useOn("Distorted Future"));

    expect(done.players.p1.hand).toEqual(mine);
    expect(done.players.p1.deck).toEqual(state.players.p1.deck);
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
    expect(findEvent(events, "HAND_SHUFFLED_INTO_DECK")?.count).toBe(0);
    // …and the controller still paid nothing on the empty-hand path either.
    expect(done.players.p1.hand).toEqual(state.players.p1.hand);
  });

  it("is refused from the BENCH — the `activeOnly` flag, which is a printed clause", () => {
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
    expect(refused.ok).toBe(false);
  });

  it("is ONCE per turn — the second use is refused on the same board", () => {
    const state = distortedBoard(105);
    const { state: done } = mustApply(state, useOn("Distorted Future"));
    expect(applyAction(done, useOn("Distorted Future")).ok).toBe(false);
  });
});

describe("Picnicker / Drasna — the coin gate's `otherwise`, driven through the real engine", () => {
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
    const flip = findEvent(events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip === undefined) throw new Error("no coin flip was emitted");
    return flip.result;
  }

  it("authors both printings as ONE two-armed coin gate each", () => {
    expect(programFor("svp-114")?.trainer).toEqual([
      {
        op: "coinFlipGate",
        then: [{ op: "drawCards", count: 4 }],
        otherwise: [{ op: "drawCards", count: 2 }],
      },
    ]);
    expect(programFor("sv08-173")?.trainer).toEqual([
      {
        op: "coinFlipGate",
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

  it("Picnicker draws 4 on heads and 2 on TAILS — the losing face is not nothing", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const state = ready(seed, "fix-picnicker");
      const held = state.players.p1.hand.length;
      const { state: done, events } = play(state, "fix-picnicker");
      const face = faceOf(events);
      seen.add(face);
      const drawn = face === "heads" ? 4 : 2;
      expect(done.players.p1.hand).toHaveLength(held - 1 + drawn);
      const rows = findAll(events, "CARDS_DRAWN");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.seat).toBe("p1");
      expect(rows[0]?.uids).toHaveLength(drawn);
      expect(done.players.p1.deck).toHaveLength(state.players.p1.deck.length - drawn);
      // The opponent is untouched on either face — this card names one seat.
      expect(done.players.p2.hand).toEqual(state.players.p2.hand);
      expect(done.players.p2.deck).toEqual(state.players.p2.deck);
    }
    expect(seen).toEqual(new Set(["heads", "tails"]));
  });

  it("Drasna SHUFFLES ON BOTH FACES and draws 8 or 3 — LACEY's shape, coin-gated", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const state = ready(seed, "fix-drasna");
      const held = state.players.p1.hand.length;
      const { state: done, events } = play(state, "fix-drasna");
      const face = faceOf(events);
      seen.add(face);
      const drawn = face === "heads" ? 8 : 3;
      expect(done.players.p1.hand).toHaveLength(drawn);
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

  it("emits exactly ONE coin row on either face — the arm did not change the event", () => {
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

  it("a two-armed gate is PLAYABLE while EITHER arm can act — cardplay's `or`", () => {
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
        then: arm,
        ...(other === undefined ? {} : { otherwise: other }),
      },
    ];
    expect(programPlayable(empty, gate(whiffOnly), "p1")).toBe(false);
    expect(programPlayable(empty, gate(whiffOnly, canAct), "p1")).toBe(true);
    // …and symmetrically, so the rule is not accidentally reading only `otherwise`.
    expect(programPlayable(empty, gate(canAct, whiffOnly), "p1")).toBe(true);
    // BOTH arms whiff-only is still a refusal — the `and` half of the `or`.
    expect(programPlayable(empty, gate(whiffOnly, whiffOnly), "p1")).toBe(false);
  });
});

describe("Harlequin — `handRefresh`'s PER-SEAT draw, driven through the real engine", () => {
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
    const flip = findEvent(events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip === undefined) throw new Error("no coin flip was emitted");
    return flip.result;
  }

  it("authors the printing as ONE two-armed gate over a per-seat pair", () => {
    expect(programFor("sv10.5w-083")?.trainer).toEqual([
      {
        op: "coinFlipGate",
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

  it("deals 5 to the CONTROLLER and 3 to the OPPONENT on heads — and swaps on TAILS", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const state = ready(seed);
      const p1Held = state.players.p1.hand.length;
      const p2Held = state.players.p2.hand.length;
      expect(p1Held, `p1 pre-hand @${seed}`).toBeGreaterThan(1);
      expect(p2Held, `p2 pre-hand @${seed}`).toBeGreaterThan(0);
      const { state: done, events } = play(state);
      const face = faceOf(events);
      seen.add(face);
      const [mine, theirs] = face === "heads" ? [5, 3] : [3, 5];
      expect(done.players.p1.hand, `p1 @${seed} ${face}`).toHaveLength(mine);
      expect(done.players.p2.hand, `p2 @${seed} ${face}`).toHaveLength(theirs);
      expect(mine === 5).toBe(face === "heads");
    }
    expect(seen).toEqual(new Set(["heads", "tails"]));
  });

  it("shuffles BOTH hands back first — `who: 'both'`, on either face", () => {
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

  it("the count is CONTROLLER-relative, not `p1`-relative — P2 plays the same object", () => {
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

  it("the OTHER `draw` kinds are untouched — a widening, not a rewrite", () => {
    expect(programFor("fix-drasna")?.trainer).toEqual([
      {
        op: "coinFlipGate",
        then: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],
        otherwise: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 3 } }],
      },
    ]);
    expect(programFor("fix-distortedfuture")?.abilities?.[0]?.program).toEqual([
      { op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 3 } },
    ]);
  });
});
