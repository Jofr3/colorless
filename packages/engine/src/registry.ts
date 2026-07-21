import { ANY_ENERGY } from "./cards";
import type { BoardCondition, EffectOp } from "./effects";

// The id-keyed card-program registry (D8, "op programs are keyed by card id").
// It sits ABOVE the text deriver: attacks resolve `programFor(id)?.attack ??
// deriveAttackEffect(text)` (effects.ts), and Trainers/Abilities have no text
// deriver at all — an unauthored Trainer simply can't be played, an unauthored
// Ability can't be used (both surface loudly rather than guessing).
//
// This is the REPRESENTATIVE set (M4 slice 2), one card per archetype so the
// interpreter and both action paths are exercised end to end. Broad coverage
// across the SV pool is a later Workflow fan-out that adds rows here — the
// mechanics live in interpreter.ts, so a new card in a known family is a few
// lines of op data, exactly as D8 intended.

/** A cost paid to USE an activated Ability (§9) — checked and paid before the
    program runs; an unpayable cost blocks the use (cardplay.ts useAbility).
    Currently only Meowscarada ex "Bouquet Magic": "You must discard a Basic {G}
    Energy card from your hand in order to use this Ability." A discard of a
    basic Energy card of `energyType` from hand — its copies are fungible, so
    there is no WHICH-card choice to make. */
export type AbilityCost = { kind: "discardBasicEnergy"; energyType: string };

/** A card's activated Ability (§9). Passive/continuous abilities are `passive`
    below; triggered abilities are `triggered` (TriggeredAbility). */
export interface AbilityProgram {
  name: string;
  /** §9/§15.J — usable once per turn per Pokémon (tracked in TurnAllowances). */
  oncePerTurn: boolean;
  /** The Ability may only be used while this Pokémon is the Active (Chien-Pao's
      "if this Pokémon is in the Active Spot"). */
  activeOnly: boolean;
  /** A cost paid from hand to use it (Meowscarada's {G}-Energy discard). */
  cost?: AbilityCost;
  /** The Ability ENDS the controller's turn once its program completes
      (Koraidon "Dino Cry": "If you use this Ability, your turn ends."). Folded by
      flow.ts settleProgram — instead of returning to turn:action, it seeds the
      turn tail. Assumes the program does not damage (Koraidon attaches Energy). */
  endsTurn?: true;
  /** The op program `useAbility` runs (may park like a Trainer's). */
  program: EffectOp[];
}

/** When a triggered Ability (§9) fires. The four scan points:
    - `onPlayToBench` — a Basic played from hand onto the Bench during the
      controller's turn (turn.ts playBasicToBench — NOT a setup placement);
    - `onEvolve` — the controller evolved one of their Pokémon (turn.ts evolve);
    - `betweenTurns` — the Pokémon Checkup (§13, flow.ts runCheckup);
    - `onKnockOut` — this Pokémon was Knocked Out (§8.1, flow.ts KO sweep). It
      fires during the OPPONENT's turn, mid-KO-sweep, which is why the program
      folds through settleProgram with `resumeTail`: a decision PARKS and the
      sweep RESUMES draining the remaining prize/promotion stages afterwards. */
export type TriggerTiming = "onPlayToBench" | "onEvolve" | "betweenTurns" | "onKnockOut";

/** A card's triggered Ability (§9) — one that FIRES on a game event rather than
    being player-activated. The framework runs `program` through the shared
    interpreter (triggers.ts): a board trigger (onPlayToBench/onEvolve, the
    controller's turn) PARKS on effect:choose like a Trainer and resumes to
    turn:action; a betweenTurns trigger is NON-PARKING by construction (a
    heal-each / a fixed counter placement) and runs synchronously inside the
    one Checkup reduction. */
export interface TriggeredAbility {
  name: string;
  trigger: TriggerTiming;
  /** The op program to run (interpreter EffectOps). */
  program: EffectOp[];
  /** "You may …": the trigger is optional. The framework currently AUTO-FIRES
      optional triggers (every representative is pure upside — search / heal /
      snipe — so declining is never strategically needed); where the underlying
      op is "up to" (searchDeck), the player can still take none. A yes/no
      confirm for a trigger with a downside is the follow-up. */
  optional?: boolean;
  /** Fires only while this Pokémon is in the Active Spot (Trevenant's "if this
      Pokémon is in the Active Spot"). Not consulted for `onKnockOut` — a
      Knocked Out Pokémon has left play, so its "when Knocked Out" Ability fires
      regardless of where it sat. */
  activeOnly?: boolean;
  /** `onKnockOut` only — a coin-flip Prize denial (Glimmora "Shattering
      Crystal": "flip a coin; if heads, your opponent can't take any Prize cards
      for it"). Resolved by the KO sweep itself (flow.ts collectKnockOuts), NOT
      the interpreter: it modifies the KO's Prize, and the prize/KO tail is
      flow.ts's alone (the interpreter never touches it). Kept separate from
      `program` (a general on-KO effect run as a koTrigger stage) — an on-KO
      Ability carries at most one of the two in the representative set. */
  onKoPrizeGuard?: "coinFlipPrevent";
}

/** Continuous modifiers read by the pipeline while the Pokémon is in play.
    Carried by a Pokémon's own printed passive Ability (Bouffalant) OR by an
    attached Pokémon Tool (§7.4) — continuous.ts aggregates the top card's
    entry with every attached Tool's, so both sources feed one read site. */
export interface PassiveEffects {
  /** Flat HP subtracted from the attack damage this Pokémon TAKES, applied
      AFTER Weakness and Resistance (Bouffalant "Bouffer", §8.5/§15.B). */
  damageReductionAfterWR?: number;
  /** Flat HP added to the attack damage this Pokémon DEALS to the opponent's
      Active, applied BEFORE Weakness and Resistance (Vitality Band). Only
      attacks that already do damage get it (a 0-damage attack stays 0). */
  damageBonusBeforeWR?: number;
  /** Max-HP added while the holder's TOP card is a Basic Pokémon (Bravery
      Charm — "The Basic Pokémon this card is attached to gets +50 HP");
      evolving the holder ends it, the Tool staying attached notwithstanding.
      This is the one effect that can LOWER effective max HP on evolution: a
      charmed Basic damaged into the window is Knocked Out the instant it
      evolves (§8.1), which `evolve` now checks via the mid-turn KO flow (M4
      slice 4 — turn.ts evolve → flow.ts resolveMidTurnKnockOuts). */
  basicHpBonus?: number;
}

/** A Stadium's continuous effects (§7.3) — applied to BOTH players' boards
    while the card sits in the shared zone (continuous.ts reads them off
    `GameState.stadium`). Activated "once during each player's turn" Stadiums
    (Artazon, Mesagoza, Town Store) are a later slice, with the triggered
    abilities. */
export interface StadiumEffects {
  /** §11 retreat costs THIS much less for every Basic Pokémon in play
      (Beach Court), floored at a free retreat. */
  basicRetreatDiscount?: number;
  /** Attacks of every Basic Pokémon in play cost this many {C} more
      (Pokémon League Headquarters). */
  basicAttackCostSurcharge?: number;
}

/** A Special Energy's on-attach effect (§6.1) — runs the moment it is attached
    from hand. Kept a tiny tagged union (not an EffectOp program) because these
    read the ATTACH context, which the {seat}-only interpreter doesn't carry. */
export type EnergyOnAttach =
  /** Jet Energy: attaching to a Benched Pokémon switches it to the Active Spot. */
  { kind: "switchIfBenched" };

/** A Special Energy's rules text (§6.1), read while attached. `provides` is the
    units it contributes to attack costs (a concrete type, or `ANY_ENERGY` for
    a wildcard — Luminous "every type of Energy but 1 at a time"); multi-unit is
    allowed. A Special Energy WITH this entry provisions through it; one WITHOUT
    falls back to the conservative Colorless provider (cards.ts energyProvidesOf),
    so an unauthored special energy stays playable (energy always provides
    something) rather than loudly rejecting like a Trainer. */
export interface EnergyProgram {
  provides: string[];
  /** Luminous: the units provided INSTEAD when the holder already has another
      Special Energy attached ("this card provides {C} Energy instead"). */
  demoteWithOtherSpecial?: string[];
  /** Effect run on attach from hand (Jet's switch). */
  onAttach?: EnergyOnAttach;
}

export interface CardProgram {
  /** Overrides the text-derived attack effect. Unused by the representative
      set (kept as the `programFor(id).attack ?? derive(text)` seam). */
  attack?: EffectOp[];
  /** Activated Abilities printed on this card. */
  abilities?: AbilityProgram[];
  /** The Trainer's play effect (Item/Supporter — §7.1/§7.2). */
  trainer?: EffectOp[];
  /** The printed "You can use this card only if <board condition>" legality gate
      (Fighting Au Lait: "…only if you have more Prize cards remaining than your
      opponent"). playTrainer checks it BEFORE the card leaves hand, so a failed
      gate costs the player nothing — a printed RULE, categorically different
      from `programPlayable`'s would-only-whiff heuristics (which are the
      engine's judgement about ops that would do nothing, not text on the card).
      The condition reads only public state (BoardCondition), so the HUD greys
      the card out with the same evaluator instead of offering a dead button.

      NAMED `trainer…` BECAUSE IT IS HONOURED ON EXACTLY ONE PATH — playTrainer's
      Item/Supporter branch. `playStadium`, the `rareCandy` action, `attachTool`
      and `useAbility` all return before it and would ignore it SILENTLY, so an
      Ability-level gate (Luxray's "if you have more Prize cards remaining",
      which also needs an in-hand Ability surface this engine does not have) must
      NOT be authored here — it needs its own check on useAbility, sharing the
      same `conditionHolds`. The `trainerEndsTurn` flag above is scoped the same
      way for the same reason. */
  trainerPlayableIf?: BoardCondition;
  /** Triggered Abilities printed on this card (§9) — fire on a game event
      (played to Bench / evolved / between turns), not player-activated. */
  triggered?: TriggeredAbility[];
  /** Continuous/passive modifiers (a Pokémon's passive Ability, or a Tool's
      effect on its holder — read while in play). A Tool with this entry is
      attachable; one without is "not simulated" (coverage strategy). */
  passive?: PassiveEffects;
  /** The Stadium's continuous effects (§7.3). A Stadium with this entry is
      playable; one without is "not simulated" (coverage strategy). */
  stadium?: StadiumEffects;
  /** A Special Energy's rules text (§6.1). */
  energy?: EnergyProgram;
  /** Marks the Rare Candy Item (§7.1): the Basic→Stage 2 evolve-skip. It runs
      no op program (it evolves, which the interpreter must never do — flow.ts
      owns every Knock Out), so it is NOT a `trainer` array; the dedicated
      `rareCandy` action (cardplay.ts) carries the target Basic + the Stage 2,
      reuses the shared evolution placement (turn.ts placeEvolution), and
      resolves the mid-turn evolve-below-HP KO + the on-evolve trigger through
      the same machinery as `evolve`. `programFor(id)?.rareCandy === true` is
      how playTrainer rejects it (like a Tool) and how the HUD knows to open the
      Rare Candy dialog instead of dispatching playTrainer. */
  rareCandy?: true;
  /** The `trainer` play ENDS the controller's turn once its program completes
      (Katy: "Shuffle your hand into your deck. Then, draw 8 cards. Your turn
      ends."). playTrainer passes this to flow.ts settleProgram, which folds it
      EXACTLY like AbilityProgram.endsTurn — instead of returning to turn:action it
      seeds the turn tail. Only meaningful alongside `trainer`; assumes the program
      does not damage (Katy only draws), so no mid-turn KO sweep is owed. */
  trainerEndsTurn?: true;
}

// ── The programs, authored from the printed text (verified vs the live
//    catalog, 2026-07-17) — see docs/workstreams/simulator.md "M4 slice 2". ──

/** "Discard your hand and draw 7 cards." (Supporter) */
const PROFESSORS_RESEARCH: CardProgram = {
  trainer: [{ op: "discardHand" }, { op: "drawCards", count: 7 }],
};

/** "Search your deck for a Basic Pokémon and put it onto your Bench. Then,
    shuffle your deck." (Item) */
const NEST_BALL: CardProgram = {
  trainer: [
    { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1 },
    { op: "shuffleDeck" },
  ],
};

/** "Switch in 1 of your opponent's Benched Pokémon to the Active Spot."
    (Supporter — the gust archetype) */
const BOSSS_ORDERS: CardProgram = { trainer: [{ op: "gust" }] };

/** "Switch your Active Pokémon with 1 of your Benched Pokémon." (Item) */
const SWITCH: CardProgram = { trainer: [{ op: "switchActive" }] };

/** "Heal 30 damage from 1 of your Pokémon." (Item) */
const POTION: CardProgram = { trainer: [{ op: "healChosen", amount: 30 }] };

/** "Search your deck for a Basic Energy card, reveal it, and put it into your
    hand. Then, shuffle your deck." (Item) */
const ENERGY_SEARCH: CardProgram = {
  trainer: [
    { op: "searchDeck", filter: { kind: "basicEnergy" }, dest: "hand", max: 1 },
    { op: "shuffleDeck" },
  ],
};

/** Chien-Pao ex — "Shivery Chill": once/turn, Active-only, "search your deck
    for up to 2 Basic {W} Energy cards … put them into your hand. Then, shuffle." */
const CHIEN_PAO: CardProgram = {
  abilities: [
    {
      name: "Shivery Chill",
      oncePerTurn: true,
      activeOnly: true,
      program: [
        { op: "searchDeck", filter: { kind: "basicEnergy", energyType: "Water" }, dest: "hand", max: 2 },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Bouffalant — "Bouffer": "This Pokémon takes 20 less damage from attacks
    (after applying Weakness and Resistance)." (passive) */
const BOUFFALANT: CardProgram = { passive: { damageReductionAfterWR: 20 } };

// ── M4 slice 3: the persistent-zone Trainers (Stadium §7.3, Tool §7.4). ──

/** Beach Court — "The Retreat Cost of each Basic Pokémon in play (both yours
    and your opponent's) is {C} less." (Stadium) */
const BEACH_COURT: CardProgram = { stadium: { basicRetreatDiscount: 1 } };

/** Pokémon League Headquarters — "Attacks used by each Basic Pokémon in play
    (both yours and your opponent's) cost {C} more." (Stadium) */
const POKEMON_LEAGUE_HQ: CardProgram = { stadium: { basicAttackCostSurcharge: 1 } };

/** Vitality Band — "The attacks of the Pokémon this card is attached to do 10
    more damage to your opponent's Active Pokémon (before applying Weakness
    and Resistance)." (Tool) */
const VITALITY_BAND: CardProgram = { passive: { damageBonusBeforeWR: 10 } };

/** Bravery Charm — "The Basic Pokémon this card is attached to gets +50 HP."
    (Tool) */
const BRAVERY_CHARM: CardProgram = { passive: { basicHpBonus: 50 } };

// ── M4 slice 5: Special Energy (§6.1). ──

/** Jet Energy — "provides {C} Energy. When you attach this card from your hand
    to 1 of your Benched Pokémon, switch that Pokémon with your Active Pokémon." */
const JET_ENERGY: CardProgram = {
  energy: { provides: ["Colorless"], onAttach: { kind: "switchIfBenched" } },
};

/** Luminous Energy — "provides every type of Energy but provides only 1 Energy
    at a time. If the Pokémon this card is attached to has any other Special
    Energy attached, this card provides {C} Energy instead." */
const LUMINOUS_ENERGY: CardProgram = {
  energy: { provides: [ANY_ENERGY], demoteWithOtherSpecial: ["Colorless"] },
};

// ── M4 slice 6: triggered Abilities (§9) — fire on a game event. ──

/** Flamigo — "Insta-Flock": "When you play this Pokémon from your hand onto
    your Bench during your turn, you may search your deck for up to 3 Flamigo,
    reveal them, and put them into your hand. Then, shuffle your deck." */
const FLAMIGO: CardProgram = {
  triggered: [
    {
      name: "Insta-Flock",
      trigger: "onPlayToBench",
      optional: true,
      program: [
        { op: "searchDeck", filter: { kind: "byName", name: "Flamigo" }, dest: "hand", max: 3 },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Arboliva — "Enriching Oil": "When you play this Pokémon from your hand to
    evolve 1 of your Pokémon during your turn, you may heal all damage from 1 of
    your Pokémon." */
const ARBOLIVA: CardProgram = {
  triggered: [
    {
      name: "Enriching Oil",
      trigger: "onEvolve",
      optional: true,
      program: [{ op: "healChosen", amount: "all" }],
    },
  ],
};

/** Garganacl — "Blessed Salt": "During Pokémon Checkup, heal 20 damage from
    each of your Pokémon." (mandatory; non-parking, so it fires from anywhere in
    play — Active or Bench) */
const GARGANACL: CardProgram = {
  triggered: [
    {
      name: "Blessed Salt",
      trigger: "betweenTurns",
      program: [{ op: "healEach", amount: 20 }],
    },
  ],
};

/** Trevenant — "Forest Miasma": "During Pokémon Checkup, if this Pokémon is in
    the Active Spot, put 1 damage counter on your opponent's Active Pokémon."
    (mandatory; active-only; the placed counter can KO — the Checkup's own KO
    sweep resolves it) */
const TREVENANT: CardProgram = {
  triggered: [
    {
      name: "Forest Miasma",
      trigger: "betweenTurns",
      activeOnly: true,
      program: [{ op: "damageActive", amount: 10 }],
    },
  ],
};

// ── M4 slice 8: the mid-turn-damage snipe (§9). ──

/** Hawlucha — "Flying Entry": "When you play this Pokémon from your hand onto
    your Bench during your turn, you may choose 2 of your opponent's Benched
    Pokémon and put 1 damage counter on each of them." A TRIGGERED Ability
    (onPlayToBench); the placed counters are flat (not attack damage) and can
    KO — triggers.ts folds the result through settleProgram, which sweeps the
    board for a mid-turn Knock Out. */
const HAWLUCHA: CardProgram = {
  triggered: [
    {
      name: "Flying Entry",
      trigger: "onPlayToBench",
      optional: true,
      program: [{ op: "damageChosen", target: "opponentBench", amount: 10, count: 2 }],
    },
  ],
};

/** Meowscarada ex — "Bouquet Magic": "You must discard a Basic {G} Energy card
    from your hand in order to use this Ability. Once during your turn, you may
    put 3 damage counters on 1 of your opponent's Benched Pokémon." An ACTIVATED
    Ability with the engine's first activation COST (discard a Basic {G} Energy);
    usable from anywhere in play (not Active-only), once per turn. The counters
    are flat and can KO — useAbility folds through settleProgram's mid-turn sweep. */
const MEOWSCARADA: CardProgram = {
  abilities: [
    {
      name: "Bouquet Magic",
      oncePerTurn: true,
      activeOnly: false,
      cost: { kind: "discardBasicEnergy", energyType: "Grass" },
      program: [{ op: "damageChosen", target: "opponentBench", amount: 30, count: 1 }],
    },
  ],
};

// ── M4 slice 9: on-KO triggered Abilities (§9) — fire when Knocked Out. ──

/** Glimmora — "Shattering Crystal": "When this Pokémon is Knocked Out, flip a
    coin. If heads, your opponent can't take any Prize cards for it." A TRIGGERED
    Ability firing on Knock Out (during the OPPONENT's turn, mid-KO-sweep). The
    coin-flip Prize denial is `onKoPrizeGuard` (resolved by the KO sweep, not the
    interpreter) — it has no op program, so no koTrigger stage is queued for it. */
const GLIMMORA: CardProgram = {
  triggered: [
    {
      name: "Shattering Crystal",
      trigger: "onKnockOut",
      program: [],
      onKoPrizeGuard: "coinFlipPrevent",
    },
  ],
};

/** FIXTURE-ONLY demonstrator (id `fix-onko`) for the resume-the-tail on-KO
    PARKING path: an on-KO Ability whose program needs a DECISION, so it parks
    mid-KO-sweep on effect:choose (the KO'd player searches their deck) and the
    sweep resumes draining prizes/promotions afterwards. No real SV-era on-KO
    Ability requires a decision (Glimmora / Munkidori are a coin flip / a fixed
    condition), so — like the fix-sniper spread demonstrator (slice 4) — a fixture
    proves the machinery until a live card lands with the coverage fan-out. */
const FIX_ONKO: CardProgram = {
  triggered: [
    {
      name: "Last Wish",
      trigger: "onKnockOut",
      optional: true,
      program: [
        { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "hand", max: 1 },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

// ── M4 slice 7: Rare Candy (§7.1) — the Basic→Stage 2 evolve-skip Item. ──

/** Rare Candy — "Choose 1 of your Basic Pokémon in play. If you have a Stage 2
    card in your hand that evolves from that Pokémon, put that card onto the
    Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card
    during your first turn or on a Basic Pokémon that was put into play this
    turn." (Item) — a marker, not a program (see CardProgram.rareCandy). */
const RARE_CANDY: CardProgram = { rareCandy: true };

// ── M5 coverage pass #1 (2026-07-19): the cards across the SV01–03 pool whose
//    printed text maps EXACTLY onto the existing op vocabulary — authored from a
//    classify→verify Workflow fan-out (the 5 authorable of 140; the other 113
//    need new ops, tracked in docs/reference/coverage-backlog.md). ──

/** Poké Ball — "Flip a coin. If heads, search your deck for a Pokémon, reveal it,
    and put it into your hand. Then, shuffle your deck." (Item) — the search AND
    the shuffle are BOTH gated on heads (tails does nothing), so shuffleDeck sits
    INSIDE the gate's `then`, not after it. */
const POKE_BALL: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [
        { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 1 },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Pokémon Catcher — "Flip a coin. If heads, switch in 1 of your opponent's
    Benched Pokémon to the Active Spot." (Item — a coin-gated gust). */
const POKEMON_CATCHER: CardProgram = {
  // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
  trainer: [{ op: "coinFlipGate", then: [{ op: "gust" }] }],
};

/** Nemona — "Draw 3 cards." (Supporter) */
const NEMONA: CardProgram = { trainer: [{ op: "drawCards", count: 3 }] };

/** Copperajah ex — "Bronze Body": "This Pokémon takes 30 less damage from
    attacks (after applying Weakness and Resistance)." (passive — the Bouffalant
    "Bouffer" shape, a bigger flat reduction). */
const COPPERAJAH_EX: CardProgram = { passive: { damageReductionAfterWR: 30 } };

/** Stonjourner — "Exoskeleton": "This Pokémon takes 20 less damage from attacks
    (after applying Weakness and Resistance)." (passive) */
const STONJOURNER: CardProgram = { passive: { damageReductionAfterWR: 20 } };

// ── M5 op-slice: attachEnergyFrom (§6 energy acceleration) — the top backlog
//    unlock; this slice covers the clean single-attach-from-hand core, the
//    discard/deck/multi/rider variants layer later ops on top. ──

/** Quaquaval — "Energy Carnival": "Once during your turn, you may attach a Basic
    Energy card from your hand to 1 of your Pokémon." (activated, once/turn) */
const QUAQUAVAL: CardProgram = {
  abilities: [
    {
      name: "Energy Carnival",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "attachEnergyFrom", source: "hand" }],
    },
  ],
};

/** Baxcalibur — "Super Cold": "As often as you like during your turn, you may
    attach a Basic {W} Energy card from your hand to 1 of your Pokémon."
    (activated, REPEATABLE → oncePerTurn:false, so it never locks out). */
const BAXCALIBUR: CardProgram = {
  abilities: [
    {
      name: "Super Cold",
      oncePerTurn: false,
      activeOnly: false,
      program: [{ op: "attachEnergyFrom", source: "hand", energyType: "Water" }],
    },
  ],
};

/** FIXTURE (id fix-attacher): the DISCARD-source + type-filter branch of
    attachEnergyFrom (attach a Basic Fire Energy from the discard pile to a chosen
    Pokémon). The clean real discard-attach card without extra riders; Koraidon
    "Dino Cry" (multi + "your turn ends") still needs later ops. */
const FIX_ATTACHER: CardProgram = {
  abilities: [
    {
      name: "Recharge",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "attachEnergyFrom", source: "discard", energyType: "Fire" }],
    },
  ],
};

/** Koraidon ex — "Dino Cry": "Once during your turn, you may attach up to 2 Basic
    {F} Energy cards from your discard pile to your Basic {F} Pokémon in any way
    you like. If you use this Ability, your turn ends." — MULTI-attach (up to 2) is
    two attachEnergyFrom ops in a row (each parks on its own Basic {F} target; the
    second no-ops if a single {F} was in the discard), and `endsTurn` folds the
    turn end. once/turn, not Active-only. */
const KORAIDON_EX: CardProgram = {
  abilities: [
    {
      name: "Dino Cry",
      oncePerTurn: true,
      activeOnly: false,
      endsTurn: true,
      program: [
        { op: "attachEnergyFrom", source: "discard", energyType: "Fighting", targetType: "Fighting", basicOnly: true },
        { op: "attachEnergyFrom", source: "discard", energyType: "Fighting", targetType: "Fighting", basicOnly: true },
      ],
    },
  ],
};

/** Gardevoir ex — "Psychic Embrace": "As often as you like during your turn, you
    may attach a Basic {P} Energy card from your discard pile to 1 of your {P}
    Pokémon. If you attached Energy to a Pokémon in this way, put 2 damage counters
    on that Pokémon. You can't use this Ability on a Pokémon that would be Knocked
    Out." — the attachEnergyFrom RIDERS: discard source + {P} energy + {P}-only
    targets + 20 HP (2 counters) + the not-would-be-KO'd guard; REPEATABLE. */
const GARDEVOIR_EX: CardProgram = {
  abilities: [
    {
      name: "Psychic Embrace",
      oncePerTurn: false,
      activeOnly: false,
      program: [
        {
          op: "attachEnergyFrom",
          source: "discard",
          energyType: "Psychic",
          targetType: "Psychic",
          bonusCounters: 20,
          notIfKO: true,
        },
      ],
    },
  ],
};

// ── M5 op-slice: discardPileRetrieval (§7.1 recovery Items) — the discard-pile
//    mirror of searchDeck; the next-biggest new-op unlock after attachEnergyFrom.
//    (verified vs the local catalog 2026-07-20). ──

/** Energy Retrieval — "Put up to 2 Basic Energy cards from your discard pile
    into your hand." (Item) — a single retrieval to hand, no shuffle. */
const ENERGY_RETRIEVAL: CardProgram = {
  trainer: [{ op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "hand", max: 2 }],
};

/** Pal Pad — "Shuffle up to 2 Supporter cards from your discard pile into your
    deck." (Item) — retrieve to deck, then shuffle (the Nest Ball
    search-then-shuffle pattern; a whiff still shuffles, like a whiffed search). */
const PAL_PAD: CardProgram = {
  trainer: [
    { op: "discardPileRetrieval", filter: { kind: "supporter" }, dest: "deck", max: 2 },
    { op: "shuffleDeck" },
  ],
};

/** Super Rod — "Shuffle up to 3 in any combination of Pokémon and Basic Energy
    cards from your discard pile into your deck." (Item) — the pokemonOrBasicEnergy
    filter is the "any combination" (each pick is independently a Pokémon or a
    Basic Energy); retrieve to deck, then shuffle. */
const SUPER_ROD: CardProgram = {
  trainer: [
    { op: "discardPileRetrieval", filter: { kind: "pokemonOrBasicEnergy" }, dest: "deck", max: 3 },
    { op: "shuffleDeck" },
  ],
};

// ── M5 op-slice: lookAtTopN (§15.E deck-top look) — the top-of-deck twin of
//    searchDeck; candidates are only the top-N matches, then shuffle. The clean
//    "reveal → hand" cards land now; the from-the-top ATTACH variants (Electric
//    Generator, Hydreigon) layer a later op. (verified vs the local catalog
//    2026-07-20). ──

/** Great Ball — "Look at the top 7 cards of your deck. You may reveal a Pokémon
    you find there and put it into your hand. Shuffle the other cards back into
    your deck." (Item) — lookAtTopN then the trailing shuffle (the Nest Ball
    search-then-shuffle pattern; a whiff still shuffles). */
const GREAT_BALL: CardProgram = {
  trainer: [
    { op: "lookAtTopN", n: 7, filter: { kind: "anyPokemon" }, max: 1 },
    { op: "shuffleDeck" },
  ],
};

/** Pokégear 3.0 — "Look at the top 7 cards of your deck. You may reveal a
    Supporter card you find there and put it into your hand. Shuffle the other
    cards back into your deck." (Item) — the `supporter` filter (added with
    Pal Pad) narrows Great Ball's shape to Supporters. */
const POKEGEAR: CardProgram = {
  trainer: [
    { op: "lookAtTopN", n: 7, filter: { kind: "supporter" }, max: 1 },
    { op: "shuffleDeck" },
  ],
};

// ── M5 op-slice: moveEnergy (§6 manual Energy movement) — move Energy between
//    your own Pokémon. The clean own→own Trainers land now; the fixed-endpoint
//    ({R} benched→Active, Armarouge) / opponent-side (Mismagius) / on-KO Tool
//    (Exp. Share) riders layer later ops. (verified vs the local catalog
//    2026-07-20). ──

/** Energy Switch — "Move a Basic Energy from 1 of your Pokémon to another of
    your Pokémon." (Item) — a single Basic Energy, own → own. */
const ENERGY_SWITCH: CardProgram = {
  trainer: [{ op: "moveEnergy", filter: { kind: "basicEnergy" }, max: 1 }],
};

/** Poppy — "Move up to 2 Energy from 1 of your Pokémon to another of your
    Pokémon." (Supporter) — up to 2 ANY Energy (Basic or Special → the anyEnergy
    filter), both off the SAME source Pokémon, own → own. */
const POPPY: CardProgram = {
  trainer: [{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 2 }],
};

// ── M5 op-slice: the providesEnergy filter — "an Energy that PROVIDES {X}".
//    Its second consumer (the first is the typed self-discard family, which is
//    DERIVED and so has no rows here): the moveEnergy fixed-endpoint route the
//    row above deferred. (verified vs the local catalog 2026-07-21). ──

/** fix-blend — FIXTURE Special Energy, no printed card in the sv01–03 pool: one
    that provides TWO DISTINCT concrete types ({R} and {W}), the multi-unit shape
    `EnergyProgram.provides: string[]` has always promised and no authored card
    has ever exercised. Both authored Special Energies today are single-valued
    (Jet `["Colorless"]`, Luminous `[ANY_ENERGY]`), so without this the
    `providesEnergy` predicate's "is this type among the units" would be
    indistinguishable from "is it the FIRST unit" — a distinction that only starts
    to matter with a Blend/Reversal-style print, and one nobody would notice
    breaking. */
const FIX_BLEND: CardProgram = {
  energy: { provides: ["Fire", "Water"] },
};

/** fix-pilescan — FIXTURE Item, no printed card and none imaginable: a
    `providesEnergy` filter handed to a DECK search, which is the one authoring
    mistake this filter invites. Provision is a while-attached property, so a card
    sitting in a deck provides nothing and matches nothing — the search finds no
    candidates and the play is a loud no-op rather than a quiet grab of "a Basic
    Fire Energy card", which is what guessing here would have taken. Pinned by a
    fixture because a REGISTRY row is the only way to author it (the deriver never
    emits this pairing), and an unpinned safety property is one refactor from
    silently becoming a wrong match. */
const FIX_PILESCAN: CardProgram = {
  trainer: [
    { op: "searchDeck", filter: { kind: "providesEnergy", energyType: "Fire" }, dest: "hand", max: 1 },
    { op: "shuffleDeck" },
  ],
};

/** Armarouge — "Fire Off": "As often as you like during your turn, you may move
    a {R} Energy from 1 of your Benched Pokémon to your Active Pokémon."

    THREE readings the flags encode, each from the printed words:
    - "As often as you like" → NOT `oncePerTurn`, so the allowance is never
      stamped and the Ability may be used again and again in one turn (each use
      moves one Energy: `max: 1`);
    - the text never says "if this Pokémon is in the Active Spot", so
      `activeOnly: false` — Abilities work from the Bench unless the card says
      otherwise (§9), and this one names its endpoints outright rather than
      saying "this Pokémon", so a benched Armarouge moving its OWN {R} to the
      Active is a legal and correct use (the EffectContext-has-no-source-uid gap
      simply does not apply here);
    - "a {R} Energy" is `providesEnergy`, not a Basic Fire print: a Luminous
      Energy on the Bench provides every type and so IS a {R} Energy to move —
      until another Special Energy beside it demotes it to {C}. */
const ARMAROUGE: CardProgram = {
  abilities: [
    {
      name: "Fire Off",
      oncePerTurn: false,
      activeOnly: false,
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "providesEnergy", energyType: "Fire" },
          max: 1,
          route: "benchToActive",
        },
      ],
    },
  ],
};

// ── M5 op-slice: handRefresh (the Iono/Judge hand-refresh Supporter family) —
//    put your hand back into your deck, then draw. The reshuffle-and-draw
//    Supporters landed first; Iono (the bottom-of-deck placement + the
//    prize-count draw + the any-moved draw gate) closes the family — the SV-era
//    catalog holds no Marnie. (verified vs the local catalog 2026-07-20/21). ──

/** Youngster — "Shuffle your hand into your deck. Then, draw 5 cards."
    (Supporter) — the self-only fixed refresh. */
const YOUNGSTER: CardProgram = {
  trainer: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 5 } }],
};

/** Judge — "Each player shuffles their hand into their deck and draws 4 cards."
    (Supporter) — the both-player refresh (the first op to reach the OPPONENT's
    hand/deck; count-only events keep every shuffled/drawn card hidden). */
const JUDGE: CardProgram = {
  trainer: [{ op: "handRefresh", who: "both", draw: { kind: "fixed", count: 4 } }],
};

/** Brassius — "Count the cards in your hand, shuffle those cards into your deck,
    then draw that many cards plus 1." (Supporter) — handPlus draws the PRE-shuffle
    hand size + 1 (net +1 card, reshuffled). */
const BRASSIUS: CardProgram = {
  trainer: [{ op: "handRefresh", who: "you", draw: { kind: "handPlus", delta: 1 } }],
};

/** Katy — "Shuffle your hand into your deck. Then, draw 8 cards. Your turn ends."
    (Supporter) — the fixed refresh + the `trainerEndsTurn` fold (the Koraidon
    `endsTurn` precedent, now on the Trainer path). */
const KATY: CardProgram = {
  trainer: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],
  trainerEndsTurn: true,
};

/** Iono — "Each player shuffles their hand and puts it on the bottom of their
    deck. If either player put any cards on the bottom of their deck in this way,
    each player draws a card for each of their remaining Prize cards." (Supporter)
    — the both-player refresh that leaves BOTH decks' order intact (`toBottom`),
    draws by each player's own remaining Prizes (`prizeCount` — so the player
    behind on Prizes draws more), and draws nothing at all if both hands were
    already empty (`onlyIfAnyMoved`). */
const IONO: CardProgram = {
  trainer: [
    {
      op: "handRefresh",
      who: "both",
      toBottom: true,
      draw: { kind: "prizeCount" },
      onlyIfAnyMoved: true,
    },
  ],
};

// ── M5 op-slice: board conditions (2026-07-21) — one BoardCondition vocabulary
//    with two consumers: the printed PLAY GATE (`trainerPlayableIf`, checked before the
//    card leaves hand) and the mid-program `conditionGate` branch. ──

/** Fighting Au Lait — "You can use this card only if you have more Prize cards
    remaining than your opponent. / Heal 60 damage from 1 of your Pokémon."
    (Item) — the first `trainerPlayableIf` card. The condition is the card's printed
    LEGALITY line, so it blocks the play outright (and greys the HUD button)
    rather than letting the card be spent on nothing; the effect itself is the
    Potion op at a bigger number. */
const FIGHTING_AU_LAIT: CardProgram = {
  trainerPlayableIf: { kind: "morePrizesThanOpponent" },
  trainer: [{ op: "healChosen", amount: 60 }],
};

/** Falkner — "Draw 2 cards. If you have a Stadium in play, draw 2 more cards."
    (Supporter) — a ONE-ARMED conditionGate: the base draw is unconditional and
    the bonus is a SECOND drawCards inside the gate. Two ops rather than one
    computed count, so the log shows the two draws exactly as they happen and
    the gate is evaluated after the base draw (drawing cannot move a Stadium, so
    the order is immaterial — but this is the order the card is written in). */
const FALKNER: CardProgram = {
  trainer: [
    { op: "drawCards", count: 2 },
    {
      op: "conditionGate",
      cond: { kind: "yourStadiumInPlay" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "drawCards", count: 2 }],
    },
  ],
};

/** Grusha — "Draw cards until you have 5 cards in your hand. If none of your
    Pokémon have any Energy attached, draw cards until you have 7 cards in your
    hand INSTEAD." (Supporter) — the printed "instead" is a genuine if/ELSE, so
    this is the one card using the gate's `otherwise` arm: exactly one of the two
    draws ever runs, and the condition is measured on the board as it stands
    before any card is drawn (drawing to hand cannot attach Energy either way). */
const GRUSHA: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "noEnergyOnYourPokemon" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "drawUntilHandSize", size: 7 }],
      otherwise: [{ op: "drawUntilHandSize", size: 5 }],
    },
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
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "healChosen", amount: 30 }],
      otherwise: [{ op: "gust" }],
    },
  ],
};

/** fix-gateorder — FIXTURE demonstrator, no printed card. Pins the three claims
    about the gate that no REAL card can exercise, because Falkner's gate is last
    in its program, Grusha's gate IS its whole program, and neither arm holds
    more than one op:
      1. the gate is evaluated against the board AS OF the gate — the leading
         attach BREAKS `noEnergyOnYourPokemon`, so the `otherwise` arm runs (a
         gate reading the program's ENTRY state would take `then` instead);
      2. an arm's ops are spliced to the FRONT of the queue (draw 1 then 4 come
         before the trailing draw 2, not after it);
      3. the ops AFTER the gate survive the splice (the trailing draw 2 fires).
    Each claim shows up as a different CARDS_DRAWN sequence, so one assertion on
    the ordered draw counts kills all three mutants. */
const FIX_GATEORDER: CardProgram = {
  trainer: [
    { op: "attachEnergyFrom", source: "hand" },
    {
      op: "conditionGate",
      cond: { kind: "noEnergyOnYourPokemon" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "drawCards", count: 3 }],
      otherwise: [
        { op: "drawCards", count: 1 },
        { op: "drawCards", count: 4 },
      ],
    },
    { op: "drawCards", count: 2 },
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

// ── M5 op-slice: discardEnergy (the §15 energy-removal "hammer" family) —
//    discard Energy off the OPPONENT's Pokémon. All three `from` arms land with a
//    real printed card. The SELF-discard attacks ("Discard an Energy from this
//    Pokémon") landed with the attackEpilogue slice (engine 0.22.0) and need NO
//    registry row at all — effects.ts derives them from the printed sentence.
//    (verified vs the local catalog 2026-07-21). ──

/** Crushing Hammer — "Flip a coin. If heads, discard an Energy from 1 of your
    opponent's Pokémon." (Item) — the coin-gated hammer, and the `opponentChosen`
    arm: the controller picks the Energy, which IS picking the Pokémon (exactly one
    comes off). The discard sits INSIDE the gate, so a tails play does nothing at
    all — but the play into an Energy-LESS board is rejected outright, because
    `programPlayable` descends into a coin gate's `then` (§7 / Compendium 906: the
    flip is procedure, not effect, so it cannot make a target-less card playable). */
const CRUSHING_HAMMER: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" } }],
    },
  ],
};

/** Giacomo — "Discard a Special Energy from each of your opponent's Pokémon."
    (Supporter) — the `opponentEach` sweep: EVERY one of the opponent's in-play
    Pokémon that holds a Special Energy loses exactly one (a Pokémon with none is
    skipped, one carrying several is the player's choice — rare, and the only
    reason this parks at all). A TOP-LEVEL op, so the whiff gate applies: with no
    Special Energy anywhere on the opponent's board the play is rejected rather
    than burning the turn's one Supporter. */
const GIACOMO: CardProgram = {
  trainer: [{ op: "discardEnergy", from: "opponentEach", filter: { kind: "specialEnergy" } }],
};

/** Mawile — "Special Eater": "When you play this Pokémon from your hand onto your
    Bench during your turn, you may discard a Special Energy from your opponent's
    Active Pokémon." — a TRIGGERED (onPlayToBench) Ability and the `opponentActive`
    arm. Auto-fires like every optional trigger (pure upside — it only takes from
    the opponent); with no Special Energy on their Active the op is a no-op, so the
    ABILITY_TRIGGERED row stands alone (the Flamigo-into-an-empty-deck precedent). */
const MAWILE: CardProgram = {
  triggered: [
    {
      name: "Special Eater",
      trigger: "onPlayToBench",
      optional: true,
      program: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "specialEnergy" } }],
    },
  ],
};

/** fix-hammer — FIXTURE Item, no printed card: Crushing Hammer's `opponentChosen`
    discard WITHOUT the coin gate. Every real card that reaches this arm is behind
    a flip, so the fixture is what pins the arm's own behaviour — the park, the
    forced auto-resolve and the `programPlayable` whiff gate — without threading a
    seeded coin flip through each assertion. */
const FIX_HAMMER: CardProgram = {
  trainer: [{ op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" } }],
};

/** card id → program. Reprints of the same card (identical text) map to the
    same program object; keyed by id per D8, so an unauthored reprint id simply
    falls through to the loud "not simulated" path until its id is added. */
const REGISTRY: Record<string, CardProgram> = {
  // Professor's Research (SV base prints)
  "sv01-189": PROFESSORS_RESEARCH,
  "sv01-190": PROFESSORS_RESEARCH,
  "sv01-240": PROFESSORS_RESEARCH,
  "sv01-241": PROFESSORS_RESEARCH,
  // Nest Ball
  "sv01-181": NEST_BALL,
  "sv01-255": NEST_BALL,
  // Boss's Orders
  "sv02-172": BOSSS_ORDERS,
  "sv02-248": BOSSS_ORDERS,
  "sv02-265": BOSSS_ORDERS,
  // Switch
  "sv01-194": SWITCH,
  // Potion
  "sv01-188": POTION,
  // Energy Search
  "sv01-172": ENERGY_SEARCH,
  // Chien-Pao ex — Shivery Chill (activated ability)
  "sv02-061": CHIEN_PAO,
  "sv02-236": CHIEN_PAO,
  "sv02-261": CHIEN_PAO,
  "sv02-274": CHIEN_PAO,
  // Bouffalant — Bouffer (passive)
  "sv03-174": BOUFFALANT,
  // — M4 slice 3: Stadiums + Tools (verified vs local D1 2026-07-18). —
  // Beach Court (Stadium)
  "sv01-167": BEACH_COURT,
  // Pokémon League Headquarters (Stadium)
  "sv03-192": POKEMON_LEAGUE_HQ,
  // Vitality Band (Tool)
  "sv01-197": VITALITY_BAND,
  // Bravery Charm (Tool)
  "sv02-173": BRAVERY_CHARM,
  // — M4 slice 5: Special Energy (verified vs local D1 2026-07-18). —
  // Jet Energy — {C} + switch-on-bench-attach
  "sv02-190": JET_ENERGY,
  // Luminous Energy — wildcard (any 1 type), {C} if another Special attached
  "sv02-191": LUMINOUS_ENERGY,
  // — M4 slice 6: triggered Abilities (verified vs local D1 2026-07-18). —
  // Flamigo — Insta-Flock (on-play-to-Bench: search up to 3 Flamigo)
  "sv02-170": FLAMIGO,
  "sv02-227": FLAMIGO,
  // Arboliva — Enriching Oil (on-evolve: heal all from 1 of your Pokémon)
  "sv01-023": ARBOLIVA,
  // Garganacl — Blessed Salt (between-turns: heal 20 from each of your Pokémon)
  "sv02-123": GARGANACL,
  // Trevenant — Forest Miasma (between-turns, Active-only: 1 counter on opp Active)
  "sv03-012": TREVENANT,
  // — M4 slice 7: Rare Candy (verified vs local D1 2026-07-18). —
  // Rare Candy — Basic→Stage 2 evolve-skip Item
  "sv01-191": RARE_CANDY,
  "sv01-256": RARE_CANDY,
  // — M4 slice 8: the mid-turn-damage snipe (verified vs the live api 2026-07-19). —
  // Hawlucha — Flying Entry (onPlayToBench: choose 2 opp Benched, 1 counter each)
  "sv01-118": HAWLUCHA,
  // Meowscarada ex — Bouquet Magic (activated, {G}-discard cost: 3 counters on 1 opp Benched)
  "sv02-015": MEOWSCARADA,
  "sv02-256": MEOWSCARADA,
  // — M4 slice 9: on-KO triggered Abilities (verified vs the live catalog 2026-07-19). —
  // Glimmora — Shattering Crystal (on-KO: flip; heads → opponent takes no prize for it)
  "sv02-126": GLIMMORA,
  // fix-onko — FIXTURE demonstrator: an on-KO Ability that PARKS (resume-the-tail)
  "fix-onko": FIX_ONKO,
  // — M5 coverage pass #1: existing-op cards (verified vs the local catalog 2026-07-19). —
  "sv01-185": POKE_BALL, // Poké Ball — coin-gated search a Pokémon → hand
  "sv01-187": POKEMON_CATCHER, // Pokémon Catcher — coin-gated gust
  "sv01-180": NEMONA, // Nemona — draw 3 (Supporter)
  "sv02-150": COPPERAJAH_EX, // Copperajah ex — Bronze Body (−30 after W/R)
  "sv01-121": STONJOURNER, // Stonjourner — Exoskeleton (−20 after W/R)
  // — M5 op-slice: attachEnergyFrom (verified vs the local catalog 2026-07-19). —
  "sv01-054": QUAQUAVAL, // Quaquaval — Energy Carnival (attach a Basic Energy from hand)
  "sv02-060": BAXCALIBUR, // Baxcalibur — Super Cold (attach a Basic {W} from hand, repeatable)
  "sv02-210": BAXCALIBUR, // Baxcalibur (reprint)
  "fix-attacher": FIX_ATTACHER, // FIXTURE — the discard-source attach branch
  // — attachEnergyFrom riders: Gardevoir ex (targetType + bonusCounters + notIfKO). —
  "sv01-086": GARDEVOIR_EX, // Gardevoir ex — Psychic Embrace
  "sv01-228": GARDEVOIR_EX, // (reprint)
  "sv01-245": GARDEVOIR_EX, // (reprint)
  // — attachEnergyFrom multi + endsTurn: Koraidon ex "Dino Cry" (the sv01 prints
  //   carry the ability; sv03-124 is a different Koraidon ex without it). —
  "sv01-125": KORAIDON_EX,
  "sv01-231": KORAIDON_EX,
  "sv01-247": KORAIDON_EX,
  "sv01-254": KORAIDON_EX,
  // — M5 op-slice: discardPileRetrieval (verified vs the local catalog 2026-07-20). —
  "sv01-171": ENERGY_RETRIEVAL, // Energy Retrieval — 2 Basic Energy from discard → hand
  "sv01-182": PAL_PAD, // Pal Pad — 2 Supporters from discard → deck (shuffle)
  "sv02-188": SUPER_ROD, // Super Rod — 3 Pokémon/Basic Energy from discard → deck (shuffle)
  "sv02-276": SUPER_ROD, // Super Rod (reprint)
  // — M5 op-slice: lookAtTopN (verified vs the local catalog 2026-07-20). —
  "sv02-183": GREAT_BALL, // Great Ball — look at top 7, reveal a Pokémon → hand (shuffle)
  "sv01-186": POKEGEAR, // Pokégear 3.0 — look at top 7, reveal a Supporter → hand (shuffle)
  // — M5 op-slice: moveEnergy (verified vs the local catalog 2026-07-20). —
  "sv01-173": ENERGY_SWITCH, // Energy Switch — move a Basic Energy, own → own
  "sv03-193": POPPY, // Poppy — move up to 2 any Energy, own → own (Supporter)
  "sv03-220": POPPY, // Poppy (reprint)
  "sv03-227": POPPY, // Poppy (reprint)
  // — M5 op-slice: handRefresh (the hand-refresh Supporter family; verified vs
  //   the local catalog 2026-07-20). —
  "sv01-198": YOUNGSTER, // Youngster — shuffle hand into deck, draw 5
  "sv01-176": JUDGE, // Judge — each player shuffles hand into deck, draws 4
  "sv03-187": BRASSIUS, // Brassius — shuffle hand into deck, draw (hand size + 1)
  "sv01-177": KATY, // Katy — shuffle hand into deck, draw 8, your turn ends
  "sv01-237": KATY, // Katy (reprint)
  "sv02-185": IONO, // Iono — each player's hand to the BOTTOM, draw their Prize count
  "sv02-254": IONO, // Iono (reprint)
  "sv02-269": IONO, // Iono (reprint)
  // — M5 op-slice: board conditions (verified vs the local catalog 2026-07-21). —
  "sv02-181": FIGHTING_AU_LAIT, // Fighting Au Lait — play gate: more Prizes left; heal 60
  "sv02-180": FALKNER, // Falkner — draw 2, +2 more if YOUR Stadium is in play
  "sv02-251": FALKNER, // Falkner (reprint)
  "sv02-184": GRUSHA, // Grusha — draw until 5 in hand, until 7 if no Energy on your board
  "sv02-253": GRUSHA, // Grusha (reprint)
  "sv02-268": GRUSHA, // Grusha (reprint)
  "fix-condgate": FIX_CONDGATE, // FIXTURE — a parking op inside each gate arm
  "fix-gateorder": FIX_GATEORDER, // FIXTURE — gate timing, splice order, surviving tail
  "fix-gatedsup": FIX_GATEDSUP, // FIXTURE — a GATED Supporter (the allowance ordering)
  // — M5 op-slice: discardEnergy (verified vs the local catalog 2026-07-21). —
  "sv01-168": CRUSHING_HAMMER, // Crushing Hammer — coin-gated: an Energy off 1 opp Pokémon
  "sv02-182": GIACOMO, // Giacomo — a Special Energy off EACH of the opponent's Pokémon
  "sv02-252": GIACOMO, // Giacomo (reprint)
  "sv02-267": GIACOMO, // Giacomo (reprint)
  "sv03-143": MAWILE, // Mawile — Special Eater (on-bench: a Special Energy off their Active)
  "fix-hammer": FIX_HAMMER, // FIXTURE — the opponentChosen arm without the coin gate
  // — M5 op-slice: the providesEnergy filter (verified vs the local catalog
  //   2026-07-21). The typed self-discard family it also lands is DERIVED from
  //   printed text (Kilowattrel, Arcanine ex ×2, Charmeleon, Charizard), so it
  //   adds no rows here — these two are the filter's SECOND consumer. —
  "sv01-041": ARMAROUGE, // Armarouge — Fire Off ({R} benched→Active, as often as you like)
  "sv01-203": ARMAROUGE, // Armarouge (reprint)
  "fix-pilescan": FIX_PILESCAN, // FIXTURE — the filter handed to a DECK search: no match
  "fix-blend": FIX_BLEND, // FIXTURE — a Special providing TWO distinct types
};

/** The authored program for a catalog card id, or undefined when the card has
    none (an unsimulated Trainer/Ability, or a Pokémon whose attacks are wholly
    text-derived). */
export function programFor(cardId: string): CardProgram | undefined {
  return REGISTRY[cardId];
}
