import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
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
// ⚠️ THE DOCTRINE IS D190's, UNCHANGED: *EXACT MAP OR FLAG*. A registry row has
// no deriver behind it to refuse a sentence it cannot parse — whatever is
// authored IS what the card does, forever. An unauthored Ability at least
// surfaces loudly; a wrong-but-plausible one does not.

/** The 28 programs that LANDED, with their MEASURED legal printing counts. Every
    id was re-queried on 2026-08-04: each group returned `legal_standard = 1` on
    every id, exactly ONE distinct printed sentence, and exactly ONE card name. */
const LANDED = [
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
    ops: "payFromHand{2, deckBottom, recordAs paid} + recordGate → drawCards 4 — Dendra at 2-for-4",
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
] as const;

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
      "a SEAT-WIDE pre-W/R damage AURA. `damageBonusBeforeWR` and both its gated siblings are folded by `passivesOf(attacker)` — they modify their HOLDER only. This sentence's source is one body and its beneficiaries are every 'Future Pokémon' the seat owns, i.e. `seatDamageReductionAfterWR`'s scan shape pointed at the bonus seam. It ALSO needs a subtype predicate ('Future') and a by-name exemption, neither of which any filter or field carries. The bare version of the same shape — 'Attacks used by your Pokémon do 20 more damage…' (sv10.5b-003/-156/-164, 3 legal) — needs only the aura, and is the cheapest entry point.",
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
  {
    sentence: "Attacks used by this Pokémon cost {C} less for each Kofu card in your discard pile.",
    ids: ["svp-134", "sv07-042", "sv07-045", "sv07-149"],
    legal: 4,
    needs:
      "a DISCARD-PILE COUNT source for the cost seam. `attackCostDiscountPerOpponentPrize` hard-codes the multiplicand in its NAME (D162's rule: the count is not implied by 'discount'), so a second count source is a second field or a parameterised one — and the count itself ('cards named X in your discard') has no reader anywhere.",
  },
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
  {
    sentence: "Your Basic Pokémon in play have no Retreat Cost.",
    ids: ["sv08-076", "sv08-220", "sv08-239"],
    legal: 3,
    needs:
      "a STAGE refinement on `noRetreatCostAura`. The field carries `requiresEnergyType` only; this printing gates on Basic-ness instead. One optional field beside the existing one, and the read site (`hasFreeRetreatAura`) already has the Pokémon.",
  },
  {
    sentence:
      "Switch in 1 of your opponent's Benched Basic Pokémon to the Active Spot. If you do, the new Active Pokémon is now Confused.",
    ids: ["sv08-179", "sv08-234", "sv08-246"],
    legal: 3,
    needs:
      "`gust` with (a) a target FILTER and (b) a `recordAs`. Without the filter a non-Basic is a legal pick; without the record the trailing `applyStatus` fires on a board where nothing switched (an empty opponent Bench makes `gust` a no-op and 'the NEW Active' does not exist). Either absence alone is a wrong card. The same two gaps drop Zoroark ex's coin-gated twin (sv06-088).",
  },
  {
    sentence: "Heal 60 damage from each of your {L} Pokémon.",
    ids: ["sv08-167", "sv08-229", "sv08-243"],
    legal: 3,
    needs:
      "a TYPE gate on `healEach`. The op heals every one of the controller's Pokémon unconditionally; this sentence heals a typed subset. `Card.types` is the datum and the op already has the seat, so it is one optional field — but it is a field, and Fennel (built above) is the ungated printing that shows the op is otherwise right.",
  },
  {
    sentence:
      "Look at the top 7 cards of your deck. You may reveal a Pokémon AND a Trainer card you find there and put them into your hand.",
    ids: ["sv08-174", "sv08-232", "sv08-244", "sv08.5-172"],
    legal: 4,
    needs:
      "TWO filters on one `lookAtTopN` window. The op takes one `filter` and one `max`; this sentence takes one of each of two kinds out of a SHARED window, which two sequential ops cannot express (the second would re-look at a window the first did not consume). It also needs a `trainer` `CardFilter` kind — `supporter` and `toolCard` exist, the supertype does not (which alone drops Team Rocket's Petrel, 2 legal).",
  },
  {
    sentence:
      "Once during your turn, if this Pokémon is in the Active Spot, you may have your opponent shuffle their hand into their deck and draw 3 cards.",
    ids: ["svp-211", "sv10.5w-043"],
    legal: 2,
    needs:
      "`handRefresh.who: 'opponent'`. The union is `'you' | 'both'` — the OPPONENT-only arm is the one reading nothing prints in the sv01–03 pool and two cards print here. A one-member widening with a real read site behind it already (Iono/Judge drive `both`).",
  },
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
  {
    sentence:
      "Once during your turn, if this Pokémon is in the Active Spot, you may put a Basic Pokémon with 70 HP or less from your discard pile onto your Bench.",
    ids: ["sv10.5b-024", "sv10.5b-108"],
    legal: 2,
    needs:
      "`discardPileRetrieval.dest: 'bench'` plus an HP-threshold filter. The op's destinations are `hand` and `deck`; `searchDeck` has the bench arm and the wrong source zone. The HP threshold (also Buddy-Buddy Poffin, 3 legal, and Bianca's Devotion, 3 legal) has no `CardFilter` expression at all.",
  },
] as const;

// ── The demonstrator pool. 28 synthetic `fix-*` bodies carry the 28 programs so
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
function evoBody(
  id: string,
  name: string,
  effect: string,
  overrides: Partial<Card> = {},
): Card {
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

// ─────────────────────────────────────────────────────────────────────────────

describe("D199 — the registry map", () => {
  it("registers all 47 Standard-legal printings, one shared object per program", () => {
    for (const { program, ids, fixture, legal } of LANDED) {
      expect(ids, `${program}: id list disagrees with its measured legal count`).toHaveLength(
        legal,
      );
      const first = programFor(ids[0] as string);
      expect(first, `${program}: ${ids[0]} has no program`).toBeDefined();
      for (const id of ids) expect(programFor(id), `${id} left ${program}`).toBe(first);
      // The demonstrator carries the SAME object, so what is driven below is
      // literally what the printings resolve to — never a copy of it.
      expect(programFor(fixture), `${fixture} is not ${program}`).toBe(first);
    }
    expect(LANDED).toHaveLength(31);
    expect(LANDED.reduce((n, l) => n + l.legal, 0)).toBe(54);
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
    expect(programFor("sv08-130")?.triggered).toEqual([
      {
        name: "Assemble Alloy",
        trigger: "onEvolve",
        optional: true,
        program: [
          { op: "attachEnergyFrom", source: "discard", energyType: "Metal", targetType: "Metal" },
          { op: "attachEnergyFrom", source: "discard", energyType: "Metal", targetType: "Metal" },
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
    expect(programFor("sv07-138")?.trainer).toEqual([
      { op: "payFromHand", count: 2, to: "deckBottom", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 4 }] },
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
    expect(DROPPED).toHaveLength(9);
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
      spot === "active" ? c.spot.spot === "active" : c.spot.spot === "bench" && c.spot.index === index,
    );
    if (ref === undefined) throw new Error(`no ${spot} candidate`);
    return mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
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
    const { state: done, events } = chooseCards(parked, picks);
    expect(find(events, "HAND_COST_PAID")?.uids).toEqual(picks);
    // ⚠️ THE MUTANT THIS KILLS: `to: "discard"`. The two cards are UNDER the deck.
    const tail = done.players.p1.deck.slice(-2);
    expect([...tail].sort()).toEqual([...picks].sort());
    for (const uid of picks) expect(done.players.p1.discard).not.toContain(uid);
    // …and the gate fired: +1 Kofu drawn from hand, −2 paid, +4 drawn.
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(4);
    expect(done.players.p1.hand).toHaveLength(handBefore + 1 - 1 - 2 + 4 - 0);
    expect(done.players.p1.deck).toHaveLength(deckBefore - 1 + 2 - 4);
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
