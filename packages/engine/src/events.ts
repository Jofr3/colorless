import type { DamageModifier } from "./cards";
import type { CoinFace } from "./rng";
import type { GameOutcome, PokemonTarget, Seat } from "./types";

// GameEvents are the animation and wire contract (simulator.md): semantic
// "what happened" facts, never "how to render" instructions. Every state
// change the reducer makes is described by the events it returns alongside.
// M1 events are full-information — hidden-info filtering is P4's job.
//
// Payload arrays are always COPIES, never the state's own arrays or the
// caller's action arrays: an event is a value handed to consumers (animators,
// the P4 broadcast, a persisted log), and a consumer that sorts or splices one
// must not be able to reach back into game state or into a retained snapshot.

/** Why cards moved deck → hand; lets the UI animate each draw differently.
    "effect" covers any Trainer/Ability draw (Professor's Research, §15.E). */
export type DrawReason = "opening" | "mulligan" | "compensation" | "turnStart" | "effect";

/** The §12 Special Conditions as event vocabulary. The state stores them
    structurally (SpecialConditions: rotation / poisonDamage / burned) — the
    events name them flat, one word per condition. */
export type StatusName = "asleep" | "paralyzed" | "confused" | "burned" | "poisoned";

export type GameEvent =
  | { type: "SHUFFLE"; seat: Seat }
  | { type: "COIN_FLIP"; result: CoinFace; winner: Seat }
  | { type: "FIRST_PLAYER_CHOSEN"; first: Seat; chosenBy: Seat }
  | { type: "CARDS_DRAWN"; seat: Seat; uids: string[]; reason: DrawReason }
  /** A hand with no Basic Pokémon, shown before it is shuffled back (§3.5). */
  | { type: "MULLIGAN_REVEALED"; seat: Seat; hand: string[] }
  /** Setup placement — face-down until SETUP_REVEALED. */
  | { type: "POKEMON_PLACED"; seat: Seat; uid: string; spot: "active" | "bench" }
  /** In-turn Basic played to the bench (§5.2). */
  | { type: "POKEMON_BENCHED"; seat: Seat; uid: string }
  /** §10 — an Evolution card (`to`, now the stack top) was placed on top of
      the in-play Pokémon whose top card was `from`, at `target` on the
      actor's own board. Damage, Energy and Tools carry over (they stay on the
      stack); Special Conditions are removed — a separate STATUS_CLEARED with
      reason "evolved" lists any that were, exactly as retreat announces its
      "benched" clear. */
  | {
      type: "POKEMON_EVOLVED";
      seat: Seat;
      from: string;
      to: string;
      target: PokemonTarget;
    }
  /** The compensation decision resolving (§3.5) — fires even when the owed
      player declines, because the phase advances either way and an
      event-only consumer must not be left waiting on the prompt. */
  | { type: "COMPENSATION_DECIDED"; seat: Seat; drawn: number; owed: number }
  | { type: "PRIZES_SET"; seat: Seat; uids: string[] }
  | { type: "SETUP_READY"; seat: Seat }
  /** Both players ready: everything flips face-up (§3.9). The board is in
      the state, so the event needs no payload. */
  | { type: "SETUP_REVEALED" }
  | { type: "TURN_STARTED"; turn: number; seat: Seat }
  | { type: "ENERGY_ATTACHED"; seat: Seat; uid: string; target: PokemonTarget }
  /** `retreated`/`promoted` are the top uids of the two stacks that swapped.
      The bench stays dense, so the swap re-indexes it: the promoted Pokémon
      vacates `promotedFrom` (everything after it slides down one) and the
      retreater lands at `benchedTo`. Both indices are in the payload so an
      animator — or a P4 client addressing the bench positionally — never has
      to re-derive the reducer's compaction rule. `discardedEnergy` lists the
      cost payment in the order the discard pile gained it (§2 — pile order,
      i.e. attachment order), NOT the order the action named them — the same
      contract as KNOCKED_OUT's `discarded`. */
  | {
      type: "RETREATED";
      seat: Seat;
      retreated: string;
      promoted: string;
      promotedFrom: number;
      benchedTo: number;
      discardedEnergy: string[];
    }
  /** `seat`'s Active declared its printed attack `attack` (index into the
      top card's attacks); `uid` is the attacker's top card. */
  | { type: "ATTACK_DECLARED"; seat: Seat; uid: string; attack: string; index: number }
  /** The declared attack carries text (or a damage modifier like "60+") the
      engine does not simulate yet — that is M4's effect-op system. The
      numeric base damage still applied; consumers surface the skipped text
      rather than let it be silently guessed (simulator.md coverage
      strategy). */
  | {
      type: "ATTACK_EFFECT_SKIPPED";
      seat: Seat;
      attack: string;
      effect: string | null;
      damageModifier: string | null;
    }
  /** Attack damage landing on the Defending Pokémon with the §8.5 math
      spelled out for the animator: base → weakness → resistance, floored at
      0. `weakness`/`resistance` are the PARSED printed modifiers as applied
      (modern weakness multiplies ×2, the old-era prints add +20, resistance
      subtracts — cards.ts DamageModifier); null = did not apply.
      `seat`/`uid` name the DEFENDER (the seat owns the uid, as everywhere),
      `dealt` what this attack added and `damage` the defender's cumulative
      total after. */
  | {
      type: "DAMAGE_DEALT";
      seat: Seat;
      uid: string;
      base: number;
      /** Flat HP the attacker's continuous effects added BEFORE Weakness/
          Resistance (Vitality Band, §15.B). Present only when it applied. */
      bonus?: number;
      weakness: DamageModifier | null;
      resistance: DamageModifier | null;
      /** Flat HP the defender's continuous effects removed AFTER Weakness/
          Resistance (Bouffalant "Bouffer", a defending Tool — §15.B).
          Present only when it actually reduced. */
      reduction?: number;
      dealt: number;
      damage: number;
    }
  // — M3 special conditions (§12) and the Pokémon Checkup (§13). `seat` on
  //   STATUS_APPLIED / STATUS_CLEARED / COUNTERS_PLACED / HEALED always OWNS
  //   the affected Pokémon; `uid` is the stack-top uid of its Active.
  /** An attack effect inflicted `status` (§12). `poisonDamage` is present
      iff status === "poisoned": the damage placed at each Checkup (10 unless
      the attack raised it). A rotation status (asleep/paralyzed/confused)
      REPLACES any previous rotation — no separate cleared event fires for
      the overwritten one. */
  | { type: "STATUS_APPLIED"; seat: Seat; uid: string; status: StatusName; poisonDamage?: number }
  /** Conditions leaving a Pokémon: `statuses` lists every one that was
      actually removed. "benched" (retreat, §11/§12) and "evolved" (§10) both
      clear everything at once — the latter's `uid` is the NEW top card (the
      evolution the conditions vanished under); the remaining reasons are
      single-condition Checkup recoveries (§13) and always carry exactly one
      entry. */
  | {
      type: "STATUS_CLEARED";
      seat: Seat;
      uid: string;
      statuses: StatusName[];
      reason: "benched" | "evolved" | "wokeUp" | "burnCured" | "paralysisEnded";
    }
  /** Damage counters placed OUTSIDE the §8.5 attack pipeline (poison/burn
      Checkup ticks, the confusion self-hit) — `amount` is HP of damage, and
      weakness/resistance never apply (§13). */
  | {
      type: "COUNTERS_PLACED";
      seat: Seat;
      uid: string;
      amount: number;
      source: "poison" | "burn" | "confusion" | "ability";
    }
  /** A §13 Checkup recovery flip for `seat`'s Active: burn's cure flip
      (§13.2) or asleep's wake flip (§13.3). Heads is followed by the
      matching STATUS_CLEARED; tails, the condition stays. */
  | { type: "CHECKUP_COIN_FLIP"; seat: Seat; status: "asleep" | "burned"; result: CoinFace }
  /** The §8 step-3 confusion flip for the declared attack — tails is
      followed by ATTACK_FAILED, heads by the normal resolution. */
  | { type: "CONFUSION_CHECK"; seat: Seat; uid: string; result: CoinFace }
  /** The declared attack did NOT resolve (confusion tails, §12): no damage
      to the defender, no effects — the 30 self-damage follows as
      COUNTERS_PLACED and the turn still ends. */
  | { type: "ATTACK_FAILED"; seat: Seat; uid: string; reason: "confusion" }
  /** Damage removed from `seat`'s Active by an attack effect; `amount` is
      what actually healed (clamped at the damage present — never 0). */
  | { type: "HEALED"; seat: Seat; uid: string; amount: number }
  /** An attack effect's own "Flip a coin. If heads, …" gate (effects.ts):
      heads runs the gated steps, tails skips them. `seat` is the attacker. */
  | { type: "ATTACK_EFFECT_COIN_FLIP"; seat: Seat; result: CoinFace }
  /** §8.1 — `seat`'s `uid` was Knocked Out: the whole stack (evolution
      cards, energy, tools) left play for `seat`'s discard; `discarded` lists
      every uid that moved, in pile order. */
  | { type: "KNOCKED_OUT"; seat: Seat; uid: string; discarded: string[] }
  /** `seat` owes a prize pick (which face-down cards, §8.1) — announced when
      the game parks on ko:takePrizes so an event-only client never hangs on
      an unseen prompt. Forced picks resolve straight to PRIZES_TAKEN. */
  | { type: "PRIZES_OWED"; seat: Seat; count: number }
  /** `seat` took face-down prizes into hand. `indices` are the slots picked
      (the prize row compacts like the bench); full-information like every M1
      event — hiding the uids from the opponent is P4's filter. */
  | { type: "PRIZES_TAKEN"; seat: Seat; uids: string[]; indices: number[]; remaining: number }
  /** `seat` must promote a benched Pokémon into the empty Active spot
      (§8.1) — the ko:promote prompt twin of PRIZES_OWED. */
  | { type: "PROMOTION_REQUIRED"; seat: Seat }
  /** `uid` (top of its stack) moved bench → Active; the bench compacts the
      same way RETREATED describes. */
  | { type: "POKEMON_PROMOTED"; seat: Seat; uid: string; benchIndex: number }
  // — M4 Trainer / Ability plays (§7/§9) and the effect ops they run (§15). —
  /** `seat` played a Trainer `uid` from hand. Where the card LANDS follows
      its `trainerType`: an Item/Supporter discards after its effect resolves,
      a Stadium moves into the shared stadium zone (§7.3 — a replaced
      predecessor announces its own STADIUM_DISCARDED). Tools are not played
      through this event — attaching is TOOL_ATTACHED. */
  | { type: "TRAINER_PLAYED"; seat: Seat; uid: string; trainerType: string }
  /** §7.4 — `seat` attached the Pokémon Tool `uid` from hand to their own
      in-play Pokémon at `target`. It stays attached (rides the stack through
      evolution, discards with a KO'd stack) — there is no detach in scope. */
  | { type: "TOOL_ATTACHED"; seat: Seat; uid: string; target: PokemonTarget }
  /** §7.3 — the Stadium `uid` left play for its OWNER `seat`'s discard pile,
      replaced by a different-named Stadium (whose own TRAINER_PLAYED rides in
      the same batch). */
  | { type: "STADIUM_DISCARDED"; seat: Seat; uid: string }
  /** `seat` used the Ability named `ability` on their in-play `uid`. */
  | { type: "ABILITY_USED"; seat: Seat; uid: string; ability: string }
  /** §9 — an activated Ability's cost was paid from hand: `uid` (a Basic
      `energyType` Energy card) was discarded to use it (Meowscarada ex "Bouquet
      Magic"). Follows the ABILITY_USED row in the same batch. */
  | { type: "ABILITY_COST_PAID"; seat: Seat; uid: string; energyType: string }
  /** A TRIGGERED Ability fired automatically (§9): `seat`'s in-play `uid`
      reached its trigger condition — played to the Bench / evolved (during
      that seat's turn), the Pokémon Checkup (between turns), or being Knocked
      Out (during the OPPONENT's turn, mid-KO-sweep). Unlike ABILITY_USED it is
      not a player action; the ops it runs follow in the same batch (and may
      park on effect:choose for a board or on-KO trigger). */
  | { type: "ABILITY_TRIGGERED"; seat: Seat; uid: string; ability: string }
  /** §9 — a triggered Ability's own "flip a coin" resolving (Glimmora
      "Shattering Crystal", on Knock Out): `seat` owns `uid` (the Pokémon whose
      Ability flipped). Distinct from the attack/Checkup coin-flip events —
      those name their pipeline; this one names the Ability. */
  | { type: "ABILITY_COIN_FLIP"; seat: Seat; uid: string; ability: string; result: CoinFace }
  /** §8.1 — an on-KO Ability prevented the Prize card(s) for `seat`'s Knocked
      Out `uid` (Glimmora "Shattering Crystal" heads): the opponent takes NO
      prize for that Pokémon. Follows the ABILITY_COIN_FLIP row; the takePrizes
      stage for that KO is simply never queued. */
  | { type: "PRIZE_PREVENTED"; seat: Seat; uid: string }
  /** The controller's whole hand went to the discard (Professor's Research). */
  | { type: "HAND_DISCARDED"; seat: Seat; uids: string[] }
  /** A deck search resolved: `uids` moved deck → `dest` (revealed, §15.E). */
  | { type: "DECK_SEARCHED"; seat: Seat; dest: "bench" | "hand"; uids: string[] }
  /** A discard-pile retrieval resolved: `uids` moved discard → `dest` — the §7.1
      recovery Items (Energy Retrieval to hand; Pal Pad / Super Rod back into the
      deck, where a trailing SHUFFLE then scrambles them). The discard pile is
      public, so naming the cards leaks nothing. */
  | { type: "DISCARD_RETRIEVED"; seat: Seat; dest: "hand" | "deck"; uids: string[] }
  /** A look-at-the-top-N resolved: `uids` moved deck → hand, REVEALED (the
      printed "reveal a Pokémon/Supporter … put it into your hand" — Great Ball,
      Pokégear 3.0). Only fires with ≥1 card (a "take none" moves nothing). The
      other looked-at cards are shuffled back — a trailing SHUFFLE in the same
      batch hides the deck order, so naming the taken (revealed) cards is safe. */
  | { type: "DECK_TOP_REVEALED"; seat: Seat; uids: string[] }
  /** The looked-at top cards a from-the-top ATTACH did NOT attach went to
      `seat`'s discard pile — Hydreigon "Tri Howl"'s printed "Discard the other
      cards" (attachFromTop `discardRest`). `uids` is in deck order, top first,
      which is the order the pile gained them (§2). The discard pile is public, so
      naming them leaks nothing — and the cards that WERE attached are named by
      their own ENERGY_ATTACHED rows, never here.

      Only fires with ≥1 leftover, but it DOES fire when nothing was attached at
      all (an empty look, or a declined one): the discard is a cost the card
      charges regardless. The sibling clause "Shuffle the other cards back into
      your deck" (Electric Generator) emits nothing of its own — those cards never
      left the deck, and the trailing SHUFFLE row is the whole story. */
  | { type: "DECK_TOP_DISCARDED"; seat: Seat; uids: string[] }
  /** An effect moved `uids` (Energy cards) from one of `seat`'s own in-play
      Pokémon (`from`) to another (`to`) — the §6 manual Energy movement (Energy
      Switch: a Basic Energy; Poppy: up to 2 any Energy). All moved Energy shares
      the one source; the Pokémon stay put (no bench compaction), so both targets
      resolve against the post-state. Own-board only — a public table fact. */
  | { type: "ENERGY_MOVED"; seat: Seat; uids: string[]; from: PokemonTarget; to: PokemonTarget }
  /** An effect discarded `uids` (Energy cards) off `seat`'s in-play Pokémon at
      `from`, into `seat`'s OWN discard pile — the §15 energy-removal family
      (Crushing Hammer, Giacomo, Mawile) and the §8 self-discard attack cost
      (Houndoom "Fire Blast", Pawmot "Electro Paws"). `seat` OWNS the Pokémon that
      lost the Energy, i.e. the victim, exactly as DAMAGE_DEALT's seat names the
      defender; `actor` is the controller whose card caused it.

      The two are the SAME seat for a self-discard and opposite for a hammer,
      which is why `actor` is carried rather than inferred: a consumer that read
      it as "the other seat" (the log did, before the self arm existed) would
      credit a Houndoom's own discard to its opponent. One event per affected
      Pokémon (a Giacomo sweep emits several), each naming its own spot.

      `host` is the stripped Pokémon's TOP-CARD uid, and it is what a consumer
      must name it by: `from` says WHERE it sat, which no longer identifies it
      afterwards. An ATTACK can discard Energy from a defender its own damage
      Knocked Out (§8 resolves the whole attack before the §8.1 check, so the
      Energy comes off a Pokémon that is about to leave) — and the KO empties
      that slot in the very same batch, so resolving `from` against the post-state
      yields "the Active spot". A uid stays resolvable through `cardIdByUid`
      forever, exactly as KNOCKED_OUT's does. Attached Energy and the discard pile
      are both public, so naming the cards leaks nothing. */
  | {
      type: "ENERGY_DISCARDED";
      seat: Seat;
      actor: Seat;
      uids: string[];
      from: PokemonTarget;
      host: string;
    }
  /** `seat` shuffled its whole hand (`count` cards) into its deck, then drew (a
      separate CARDS_DRAWN) — the hand-refresh Supporter family (Youngster, Judge,
      Brassius, Katy). COUNT-ONLY: a shuffled hand card is hidden, so the opponent
      (and, for Judge's both-player refresh, the controller about the opponent)
      learns only how many. The deck was reordered as part of this (no separate
      SHUFFLE event). `count` may be 0 (an empty hand still "shuffles" — the deck
      is reshuffled either way). */
  | { type: "HAND_SHUFFLED_INTO_DECK"; seat: Seat; count: number }
  /** `seat` shuffled its whole hand (`count` cards) and put it on the BOTTOM of
      its deck — the same hand-refresh family, other placement (Iono). Distinct
      from HAND_SHUFFLED_INTO_DECK because the fact is different and publicly
      observable: the deck's existing order is UNTOUCHED (only the hand is
      randomized, underneath it), so the next draws are the same cards they would
      have been. COUNT-ONLY for the same reason: a hidden hand's cards stay hidden
      as they go under the deck. `count` may be 0 (an empty hand moves nothing —
      Iono's draw gate reads exactly that). */
  | { type: "HAND_TO_BOTTOM_OF_DECK"; seat: Seat; count: number }
  /** An effect switched `seat`'s Active with their benched `nowActive`
      (Switch / Boss's Orders gust): the old Active (`wasActive`) went to the
      bench from `fromBench`'s freed slot and landed at `toBench`; the bench
      compacts like RETREATED. Conditions cleared on the outgoing Active are a
      separate STATUS_CLEARED reason "benched". No energy is paid (not a retreat). */
  | {
      type: "POKEMON_SWITCHED";
      seat: Seat;
      wasActive: string;
      nowActive: string;
      fromBench: number;
      toBench: number;
    }
  /** `seat` must resolve a mid-effect decision (the effect:choose prompt) —
      the prompt twin of PRIZES_OWED, so an event-only client never hangs. */
  | { type: "EFFECT_PENDING"; seat: Seat; note: string }
  | { type: "TURN_ENDED"; turn: number; seat: Seat }
  | { type: "GAME_OVER"; outcome: GameOutcome };
