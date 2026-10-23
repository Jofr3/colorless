import type { CardProgram } from "../programTypes";
import { programFor } from "../registry";
import { activated, searchThenShuffle } from "../registryBuilders";

// Programs for the fixture pool's synthetic `fix-*` bodies. They are test-only: the vitest setup
// file hands them to `registerTestPrograms`, so the production registry never carries them.

/**
 * Fixture: a flat pre-W/R bonus as the holder's own printed passive, so an Ability lock can switch
 * it off, unlike Vitality Band.
 */
const FIX_BOOSTER_ABILITY: CardProgram = { passive: { damageBonusBeforeWR: 30 } };

/**
 * Fixture for the clamp in `koPrizeReduction`: `by: 2` on a 1-Prize body. No printed card can reach
 * the clamp.
 */
const FIX_KOPRIZE: CardProgram = {
  triggered: [
    {
      name: "Oh No You Don't",
      trigger: "onKnockOut",
      program: [],
      onKoPrizeReduction: { by: 2, requiresInPlay: "Pecharunt ex" },
    },
  ],
};

/**
 * Fixture for an on-KO Ability that parks on a decision mid-sweep; the sweep resumes after the
 * answer.
 */
const FIX_ONKO: CardProgram = {
  triggered: [
    {
      name: "Last Wish",
      trigger: "onKnockOut",
      program: searchThenShuffle({ filter: { kind: "basicPokemon" }, dest: "hand", max: 1 }),
    },
  ],
};

/**
 * Fixture Special Energy providing two distinct types ({R} and {W}), so `providesEnergy` is tested
 * beyond the first unit.
 */
const FIX_BLEND: CardProgram = {
  energy: { provides: ["Fire", "Water"] },
};

/**
 * Fixture Special Energy providing {G}{G}: one card, two units. `countAttachedEnergy` counts it as
 * 1.
 */
const FIX_GRASSDOUBLE: CardProgram = {
  energy: { provides: ["Grass", "Grass"] },
};

/**
 * Fixture: a `providesEnergy` filter on a deck search matches nothing, because provision is only
 * read while attached.
 */
const FIX_PILESCAN: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "providesEnergy", energyType: "Fire" },
    dest: "hand",
    max: 1,
  }),
};

/**
 * Fixture: the gate reads the board as of the gate, an arm's ops are spliced to the front of the
 * queue, and ops after the gate still run.
 */
const FIX_GATEORDER: CardProgram = {
  trainer: [
    { op: "attachEnergyFrom", source: "hand" },
    {
      op: "conditionGate",
      cond: { kind: "noEnergyOnYourPokemon" },
      ops: [{ op: "drawCards", count: 3 }],
      otherwise: [
        { op: "drawCards", count: 1 },
        { op: "drawCards", count: 4 },
      ],
    },
    { op: "drawCards", count: 2 },
  ],
};

/**
 * Constructed program: a bare `othersToSelf` used from the Bench, which distinguishes it from
 * `benchToActive` + `anySource`. Registered on a `fix-*` id only.
 */
const GATHER_INWARD: CardProgram = {
  abilities: [
    activated({
      name: "Gather Inward",
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "anyEnergy" },
          max: "any",
          route: "othersToSelf",
          anySource: true,
        },
      ],
    }),
  ],
};

/** FIXTURE (id fix-attacher): the DISCARD-source + type-filter branch of
    attachEnergyFrom (attach a Basic Fire Energy from the discard pile to a chosen
    Pokémon). The clean real discard-attach card without extra riders; Koraidon
    "Dino Cry" (multi + "your turn ends") still needs later ops. */
const FIX_ATTACHER: CardProgram = {
  abilities: [
    activated({
      name: "Recharge",
      program: [{ op: "attachEnergyFrom", source: "discard", energyType: "Fire" }],
    }),
  ],
};

/** fix-condgate — FIXTURE demonstrator, no printed card: a conditionGate whose
    BOTH arms hold a PARKING op. Neither real card needs this (Falkner and Grusha
    branch into automatic draws only), but runProgram splices a branch into the
    work queue precisely so an op inside one can still park — this is the fixture
    that proves it, on both the `then` and the `otherwise` side. */
const FIX_CONDGATE: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "morePrizesThanOpponent" },
      ops: [{ op: "healChosen", amount: 30 }],
      otherwise: [{ op: "gust" }],
    },
  ],
};

/** fix-gatedsup — FIXTURE demonstrator: a gated SUPPORTER. Every real card with
    a `trainerPlayableIf` is an Item, so nothing else pins that the gate is
    checked BEFORE `allowances.supporterPlayed` is written — a rejected gated
    Supporter must not burn the one-Supporter-per-turn allowance (§7.2). */
const FIX_GATEDSUP: CardProgram = {
  trainerPlayableIf: { kind: "morePrizesThanOpponent" },
  trainer: [{ op: "drawCards", count: 1 }],
};

/** fix-hammer — FIXTURE Item, no printed card: Crushing Hammer's `opponentChosen`
    discard WITHOUT the coin gate. Every real card that reaches this arm is behind
    a flip, so the fixture is what pins the arm's own behaviour — the park, the
    forced auto-resolve and the `programPlayable` whiff gate — without threading a
    seeded coin flip through each assertion. */
const FIX_HAMMER: CardProgram = {
  trainer: [{ op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" } }],
};

/** The program a real printing carries, reused on a fixture body. Each row's comment names the
    registry constant. */
function printed(cardId: string): CardProgram {
  const program = programFor(cardId);
  if (program === undefined) throw new Error(`fixture registry: ${cardId} has no program`);
  return program;
}

export const FIXTURE_REGISTRY: Readonly<Record<string, CardProgram>> = {
  "fix-booster-ability": FIX_BOOSTER_ABILITY, // an Ability-lockable pre-W/R bonus
  // fix-onko — FIXTURE demonstrator: an on-KO Ability that PARKS (resume-the-tail)
  "fix-onko": FIX_ONKO,
  "fix-koprize": FIX_KOPRIZE, // the Prize reduction on a one-Prize body, to reach the clamp
  "fix-azureseas": printed("sv05-050"), // AZURE_SEAS: drives the row on a synthetic body
  "fix-sturdy": printed("sv08-057"), // KO_SURVIVAL: 120 HP Basic, the demonstrator that DRIVES the row
  "fix-sturdytiny": printed("sv08-057"), // KO_SURVIVAL: 20 HP Basic: the CHECKUP-boundary witness
  "fix-suppresswall": printed("sv02-150"), // REDUCE_30_AFTER_WR: ×2 Fire and −30 after W/R, which orders Weakness before reduction
  "fix-carapace-tough": printed("sv02-150"), // REDUCE_30_AFTER_WR
  "fix-resistwall": printed("sv02-150"), // REDUCE_30_AFTER_WR: −30 Fire Resistance and −30 after W/R
  "fix-attacher": FIX_ATTACHER, // the discard-source attach branch
  "fix-condgate": FIX_CONDGATE, // a parking op inside each gate arm
  "fix-gateorder": FIX_GATEORDER, // gate timing, splice order, surviving tail
  "fix-gatedsup": FIX_GATEDSUP, // a GATED Supporter (the allowance ordering)
  "fix-hammer": FIX_HAMMER, // the opponentChosen arm without the coin gate
  "fix-pilescan": FIX_PILESCAN, // the filter handed to a DECK search: no match
  "fix-blend": FIX_BLEND, // a Special providing TWO distinct types
  "fix-grassdouble": FIX_GRASSDOUBLE, // a Special providing ONE type TWICE
  // FIXTURE demonstrators — synthetic `fix-*` bodies (never catalog rows) that
  // carry Poison Point, Trade and Metal Bridge so `registryOnlyPrograms.test.ts` can DRIVE
  // each one through the real engine. The eleven printings cannot be fielded
  // themselves: a fixture id naming a real printing must appear in
  // `catalogManifest.ts`, which is generated off the LOCAL sqlite — absent in
  // this clone, and measuring a 978-row / 6-set catalog that holds none of
  // `sv05`/`sv07`/`sv08.5`/`sv09`/`sv10.5b` anyway.
  "fix-poisonpoint": printed("sv05-008"), // POISON_POINT
  "fix-trade": printed("sv09-098"), // NS_ZOROARK_EX
  "fix-metalbridge": printed("sv07-107"), // METAL_BRIDGE
  // FIXTURE demonstrators — `fix-spherical`'s reason verbatim: the manifest holds
  // no `sv05`/`sv08` Energy row, and the manifest generator cannot run (§ the
  // top-of-file note in progress.md), so a REAL-id fixture may not be added.
  "fix-mist-energy": printed("sv05-161"), // MIST_ENERGY
  "fix-enriching-energy": printed("sv08-191"), // ENRICHING_ENERGY
  "fix-neo-upper-energy": printed("sv05-162"), // NEO_UPPER_ENERGY
  "fix-prism-energy": printed("sv10.5b-086"), // PRISM_ENERGY
  "fix-reversal-energy": printed("sv04-266"), // REVERSAL_ENERGY
  "fix-legacy-energy": printed("sv06-167"), // LEGACY_ENERGY
  "fix-lillies-pearl": printed("sv09-151"), // LILLIES_PEARL
  "fix-bitingspree": printed("sv10-122"), // TEAM_ROCKETS_CROBAT_EX
  "fix-sneakybite": printed("sv10-121"), // SNEAKY_BITE
  "fix-attractcustomers": printed("svp-118"), // ATTRACT_CUSTOMERS
  "fix-scaldingsteam": printed("sv09-031"), // SCALDING_STEAM
  "fix-captivatinginvitation": printed("sv06-088"), // CAPTIVATING_INVITATION
  "fix-lisiasappeal": printed("sv08-179"), // LISIAS_APPEAL
  "fix-drayton": printed("sv08-174"), // DRAYTON
  "fix-rotostick": printed("sv08.5-127"), // ROTO_STICK
  "fix-bugcatchingset": printed("sv06-143"), // BUG_CATCHING_SET
  "fix-explorersguidance": printed("sv05-147"), // EXPLORERS_GUIDANCE
  "fix-drakloak": printed("sv06-129"), // DRAKLOAK
  "fix-rika": printed("sv04-172"), // RIKA
  "fix-larrysskill": printed("sv08.5-115"), // LARRYS_SKILL
  "fix-secretbox": printed("sv06-163"), // SECRET_BOX
  "fix-ethansadventure": printed("sv10-165"), // ETHANS_ADVENTURE
  "fix-trainersearch": printed("sv10-176"), // TRAINER_SEARCH
  "fix-calminglight": printed("sv08-009"), // CALMING_LIGHT
  "fix-suddenshearing": printed("sv08-004"), // SUDDEN_SHEARING
  "fix-defianthorn": printed("sv09-136"), // DEFIANT_HORN
  "fix-infernofandango": printed("sv10.5w-013"), // INFERNO_FANDANGO
  "fix-seethingspirit": printed("sv09-024"), // SEETHING_SPIRIT
  "fix-chargingup": printed("sv10-020"), // CHARGING_UP
  "fix-dynamotor": printed("sv10.5b-031"), // DYNAMOTOR
  "fix-assemblealloy": printed("sv08-130"), // ASSEMBLE_ALLOY
  "fix-confectionarygift": printed("sv09-075"), // CONFECTIONARY_GIFT
  "fix-insomnia": printed("sv08.5-077"), // INSOMNIA
  "fix-reconstitute": printed("sv10-155"), // RECONSTITUTE
  "fix-uptempo": printed("sv08-052"), // UP_TEMPO
  "fix-enhancedhammer": printed("sv06-148"), // ENHANCED_HAMMER
  "fix-fennel": printed("sv10.5b-082"), // FENNEL
  "fix-clemontsquickwit": printed("sv08-167"), // CLEMONTS_QUICK_WIT
  "fix-nightstretcher": printed("sv06.5-061"), // NIGHT_STRETCHER
  "fix-maxrod": printed("sv08.5-116"), // MAX_ROD
  "fix-miracleheadset": printed("sv08-183"), // MIRACLE_HEADSET
  "fix-energyrecycler": printed("sv10-164"), // ENERGY_RECYCLER
  "fix-sacredash": printed("sv10-168"), // SACRED_ASH
  "fix-masterball": printed("sv05-153"), // MASTER_BALL
  "fix-treasuretracker": printed("sv08.5-131"), // TREASURE_TRACKER
  "fix-dangerouslaser": printed("sv06.5-058"), // DANGEROUS_LASER
  "fix-kofu": printed("sv07-138"), // KOFU
  "fix-maximumbelt": printed("sv05-154"), // MAXIMUM_BELT
  "fix-bindingmochi": printed("sv06.5-055"), // BINDING_MOCHI
  "fix-levincia": printed("sv09-150"), // LEVINCIA
  "fix-spikyenergy": printed("sv09-159"), // SPIKY_ENERGY
  "fix-lanasaid": printed("sv06-155"), // LANAS_AID
  "fix-greedyorder": printed("sv10-159"), // GREEDY_ORDER
  "fix-buddybuddypoffin": printed("sv05-144"), // BUDDY_BUDDY_POFFIN
  "fix-gentlefin": printed("sv10.5b-024"), // GENTLE_FIN
  "fix-skyliner": printed("sv08-076"), // SKYLINER
  "fix-distortedfuture": printed("svp-211"), // DISTORTED_FUTURE
  "fix-picnicker": printed("svp-114"), // PICNICKER
  "fix-drasna": printed("sv08-173"), // DRASNA
  "fix-harlequin": printed("sv10.5w-083"), // HARLEQUIN
  "fix-unfairstamp": printed("sv06-165"), // UNFAIR_STAMP
  "fix-hassel": printed("sv06-151"), // HASSEL
  "fix-archer": printed("sv10-170"), // TEAM_ROCKETS_ARCHER
  "fix-stamp": printed("sv06-165"), // UNFAIR_STAMP
  "fix-championscall": printed("sv10-103"), // CHAMPIONS_CALL
  "fix-swimtogether": printed("sv10-050"), // SWIM_TOGETHER
  "fix-hopsbag": printed("sv09-147"), // HOPS_BAG
  "fix-summoningsign": printed("sv10-083"), // SUMMONING_SIGN
  "fix-invitingflowers": printed("sv09-068"), // LILLIES_COMFEY
  "fix-spikemuthgym": printed("sv10-169"), // SPIKEMUTH_GYM
  "fix-electricstreamer": printed("sv09-053"), // IONOS_BELLIBOLT_EX
  "fix-nsppup": printed("sv09-153"), // NS_PP_UP
  "fix-punkup": printed("sv10-136"), // MARNIES_GRIMMSNARL_EX
  "fix-goldenflame": printed("sv10-039"), // ETHANS_HO_OH_EX
  "fix-tealdance": printed("svp-166"), // TEAL_DANCE
  "fix-ripening": printed("sv07-014"), // RIPENING_CHARGE
  "fix-flashingdraw": printed("svp-182"), // FLASHING_DRAW
  "fix-callbell": printed("sv08-165"), // CALL_BELL
  "fix-chillteaser": printed("sv08-166"), // CHILL_TEASER_TOY
  "fix-carmine": printed("sv06-145"), // CARMINE
  "fix-proton": printed("sv10-177"), // TEAM_ROCKETS_PROTON
  "fix-nsplan": printed("sv10.5b-083"), // NS_PLAN
  "fix-powersaver": printed("svp-205"), // POWER_SAVER
  "fix-seasoned": printed("svp-177"), // SEASONED_SKILL
  // `fix-cynthia-body` and `fix-plain-body` deliberately carry no program: they are the
  // beneficiaries the filter is read against, and a program on them would be indistinguishable from
  // a second aura.
  "fix-regalcheer": printed("sv10.5b-003"), // REGAL_CHEER
  "fix-cynthia-aura": printed("sv10-008"), // CHEER_ON_TO_GLORY
  "fix-hop-aura": printed("svp-184"), // EXTRA_HELPINGS
  "fix-sunnyday": printed("sv09-007"), // SUNNY_DAY
  "fix-victorycheer": printed("sv08-021"), // VICTORY_CHEER
  "fix-primalknowledge": printed("sv07-038"), // PRIMAL_KNOWLEDGE
  "fix-metallicsignal": printed("sv10.5b-067"), // METALLIC_SIGNAL
  "fix-rapidvernier": printed("svp-128"), // RAPID_VERNIER
  "fix-showtime": printed("sv09-018"), // SHOWTIME
  // A `fix-*` id only: a constructed program, deliberately unreachable from any printed card.
  "fix-othersmove": GATHER_INWARD,
  "fix-cornerstone": printed("sv06-112"), // CORNERSTONE_STANCE
  "fix-mightyshell": printed("sv10.5b-023"), // MIGHTY_SHELL
  "fix-teaparty": printed("sv06-020"), // CURIOUS_TEA_PARTY
  // FIXTURE demonstrator — `fix-teaparty`'s reason verbatim: the manifest holds no
  // `sv05-024` row either (it is the ROTATED six-set population).
  "fix-spherical": printed("sv05-024"), // SPHERICAL_SHIELD
  // FIXTURE demonstrators — `fix-spherical`'s reason verbatim: the manifest holds
  // no `sv06.5`/`sv07`/`sv10` row either. TWO of them, because this row is TWO
  // printed sentences and one demonstrator could show neither the Item/Supporter
  // split nor the holder/seat split.
  "fix-unnerve": printed("sv06.5-045"), // UNNERVE
  "fix-widewall": printed("sv07-076"), // WIDE_WALL
  // FIXTURE demonstrator — `fix-spherical`'s reason verbatim (the manifest holds
  // no `sv10` row). ONE, because this row is ONE printed sentence.
  "fix-potentglare": printed("sv10-113"), // POTENT_GLARE
  // FIXTURE demonstrators — `fix-spherical`'s reason verbatim (no `sv08`/`sv10`
  // row in the manifest). TWO, because this row is TWO printed sentences and one
  // body could show neither the fold/scan split nor the target-group filter.
  "fix-unaware": printed("sv08-031"), // UNAWARE
  "fix-repellingveil": printed("sv10-051"), // REPELLING_VEIL
  // FIXTURE demonstrators — `fix-spherical`'s reason verbatim: the manifest holds no
  // `sv05`/`sv08.5`/`sv10` row either. TWO of them, because this row is TWO printed
  // sentences and a single demonstrator could not show the stage conjunct at all.
  "fix-safeguardex": printed("sv08.5-040"), // PREVENT_FROM_EX
  "fix-armortail": printed("sv05-108"), // PREVENT_FROM_BASIC_EX
  // FIXTURE demonstrator — `fix-spherical`'s reason verbatim: the manifest holds no
  // `sv10` row either.
  "fix-flowercurtain": printed("sv10-010"), // FLOWER_CURTAIN
  // FIXTURE demonstrator — `fix-flowercurtain`'s reason verbatim: the manifest
  // holds no `sv07` row either.
  "fix-imperviousshell": printed("sv07-044"), // IMPERVIOUS_SHELL
  // The SAME program on a body that differs by ONE printed field (a {G} Weakness
  // ×2), which is what turns "the threshold is read against the number that would
  // ACTUALLY be placed" into a controlled comparison rather than an assertion.
  "fix-imperviousweak": printed("sv07-044"), // IMPERVIOUS_SHELL
  // FIXTURE demonstrators — `fix-imperviousshell`'s reason verbatim: the manifest
  // holds no `sv06`/`sv08` row either. TWO of them, because this row is TWO printed
  // sentences and one demonstrator could not show the Energy conjunct at all.
  "fix-adrenapheromone": printed("sv06-096"), // ADRENA_PHEROMONE
  "fix-experthider": printed("sv08-150"), // EXPERT_HIDER
  // FIXTURE demonstrator — the manifest holds no `sv05` row (`fix-imperviousshell`'s
  // reason verbatim). ONE, because this row is ONE printed sentence.
  "fix-emergencyevolution": printed("sv05-133"), // EMERGENCY_EVOLUTION
};
