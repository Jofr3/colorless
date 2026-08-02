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
      /** HP the attack's own printed damage-scaling clause added to `base`
          BEFORE Weakness/Resistance (Paldean Tauros "Raging Horns" — 10 per
          damage counter on the attacker). Present only when it applied. Distinct
          from `bonus`, a CONTINUOUS effect (Vitality Band); both land at the same
          pre-W/R step. */
      scaled?: number;
      /** Flat HP the attacker's continuous effects added BEFORE Weakness/
          Resistance (Vitality Band, §15.B). Present only when it applied. */
      bonus?: number;
      weakness: DamageModifier | null;
      resistance: DamageModifier | null;
      /** Flat HP the defender's continuous effects removed AFTER Weakness/
          Resistance (Bouffalant "Bouffer", a defending Tool — §15.B).
          Present only when it actually reduced. */
      reduction?: number;
      /** True when the defender fully PREVENTED this attack's damage (Mimikyu
          "Safeguard" — all damage from an opponent's Pokémon ex/V), so `dealt` is
          0 for that reason rather than because the attack does no damage. Present
          only when a prevention actually fired. */
      prevented?: true;
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
  /** §11 — an attack effect locked `seat`'s Active in place ("During your
      opponent's next turn, the Defending Pokémon can't retreat."). Deliberately
      NOT a STATUS_APPLIED: the block is not one of the five §12 conditions, so it
      carries no `StatusName`, shows no status chip and does not gate attacking. */
  | { type: "RETREAT_BLOCKED"; seat: Seat; uid: string }
  /** The §11 retreat block expiring, at the Checkup that ends the blocked
      player's OWN next turn — the §13.4 paralysis lifetime, `seat` being the
      seat whose turn just ended. The block also ends early whenever an effect of
      an attack ends (the Pokémon leaves the Active Spot or evolves); those paths
      stay SILENT, announced by their own POKEMON_SWITCHED/RETREATED/
      POKEMON_EVOLVED row rather than a second one here. */
  | { type: "RETREAT_BLOCK_ENDED"; seat: Seat; uid: string }
  /** §11 — an attack INSTALLED a damage block on its own Active ("During your
      opponent's next turn, prevent all damage [from and effects of] attacks done
      to this Pokémon."). `effects` is the wider of the two printed spellings.
      `seat` owns the SHIELDED Pokémon, which here is the ACTOR's own — the exact
      mirror of RETREAT_BLOCKED, where `seat` owns the victim — so this is the one
      block row that renders honestly in the ACTIVE voice.

      There is deliberately no `…_ENDED` twin. The block is a TURN STAMP, so it
      expires by arithmetic with nothing to announce and no boundary walk to
      announce it from (types.ts `AttackBlock`); the EARLY endings — leaving the
      Active Spot, evolving — are already told by their own POKEMON_SWITCHED /
      RETREATED / POKEMON_EVOLVED row, which is the same call D112 made for the
      early half of RETREAT_BLOCK_ENDED. */
  | { type: "ATTACK_BLOCK_APPLIED"; seat: Seat; uid: string; effects: boolean }
  /** §11 — an attack's EFFECT was refused by the block above ("…prevent all
      damage FROM AND EFFECTS OF attacks…"), on the Pokémon the effect was aimed
      at. One row per refused op, so Poison Ring's two clauses produce two.

      `seat`/`uid` own the PROTECTED Pokémon (the event family's contract), and
      here that Pokémon is also the one whose own installation did the refusing —
      the causer and the affected body are the same card — so the row is the
      shielded player's and reads in the active voice.

      The DAMAGE half needs no event of its own: `DAMAGE_DEALT` has carried
      `prevented?: true` since Mimikyu "Safeguard" (0.58.0), and that field names
      the FACT — this damage was prevented — which is identical whichever
      prevention did it. Announcing WHICH is not something the row has ever
      claimed, and adding it would owe a member to say what the ATTACK_DECLARED
      and ATTACK_BLOCK_APPLIED rows above already put in the reader's hands. */
  | { type: "ATTACK_EFFECT_PREVENTED"; seat: Seat; uid: string }
  /** Damage counters placed OUTSIDE the §8.5 attack pipeline (poison/burn
      Checkup ticks, the confusion self-hit, an attack's own "does N damage to
      itself" recoil clause) — `amount` is HP of damage, and weakness/resistance
      never apply (§13, §8 recoil). `"self"` is a recoil the attacker DEALS to
      its own Active mid-attack (Skeledirge "Blazing Shout"), so its `seat` owns
      the damaged Pokémon exactly as the confusion self-hit's does. `"moved"`
      (D138) is the destination half of a printed counter MOVE — Dedenne ex
      "Tail Swap", where the same counters came off one of the attacker's own
      Benched Pokémon in the HEALED row immediately above, carrying the same
      `amount`. It is its own member rather than `"ability"` because `seat` here
      owns the DAMAGED Pokémon (the non-actor) while the row's provenance is an
      ATTACK: labelling it "Ability" would be the D136 log-voice defect written
      in at the source. `"attack"` (D139) is the same refusal made a second time,
      for the ATTACK printing of a plain placement — "Put {N} damage counters on
      your opponent's Active Pokémon." (Mimikyu "Ghost Eye", Polteageist "Pour
      Tea"). It shares the `damageActive` op and every board effect with
      `"ability"` and differs only in what the row may honestly say, which is
      precisely why the op carries the provenance as a FIELD rather than the two
      being separate ops. Since D140 it has a SECOND producer, on a second op:
      `damageChosen`'s counter path, reached by Ting-Lu ex sv02-127/-243/-263/-275
      "Land Scoop" ("Put {N} damage counters on 1 of your opponent's Benched
      Pokémon.") — the printing that turned `placeSnipe`'s hardcoded `"ability"`
      from correct into false. That producer needed NO new member, which is the
      argument for having made `source` a field rather than minting one op per
      provenance.
      `"counterattack"` (D141) is the §9 reactive recoil — the `damageAttacker`
      passive putting counters on the ATTACKING Pokémon when its holder is damaged
      ("…put N damage counters on the Attacking Pokémon."). It is the first member
      since `"confusion"` added on the MECHANISM axis rather than the provenance
      one, and that is FORCED rather than chosen: `passivesOf` SUMS the recoil over
      the holder's own passive AND every attached Tool into one seat-free number,
      so a single row can be an Ability's 50 plus a Tool's 20. That board is not
      hypothetical — Stunfisk sv03-112 "Custom Trap" does not fire AT ALL unless a
      Tool is attached, and Rocky Helmet sv01-193 is a Tool. No provenance label
      (`"ability"`, a new `"tool"`, or either of them) can be true of that row: the
      amount has two provenances and the row has one label. It replaces a hardcoded
      `"ability"` that has been false for every Rocky Helmet in every match since
      0.57.0 — D136's finding 1 on a THIRD axis (not the voice, not
      attack-vs-Ability, but Ability-vs-Tool) and the one instance of it that was
      LIVE rather than latent.
      Each new member is a WIDENING of the source enum, not a shape change — no
      MATCH_RECORD_VERSION bump (the ATTACK_FAILED.reason precedent below); an
      older record stays readable, it simply never carries the newer sources. */
  | {
      type: "COUNTERS_PLACED";
      seat: Seat;
      uid: string;
      amount: number;
      source:
        | "poison"
        | "burn"
        | "confusion"
        | "ability"
        | "self"
        | "moved"
        | "attack"
        | "counterattack";
    }
  /** A §13 Checkup recovery flip for `seat`'s Active: burn's cure flip
      (§13.2) or asleep's wake flip (§13.3). Heads is followed by the
      matching STATUS_CLEARED; tails, the condition stays. */
  | { type: "CHECKUP_COIN_FLIP"; seat: Seat; status: "asleep" | "burned"; result: CoinFace }
  /** The §8 step-3 confusion flip for the declared attack — tails is
      followed by ATTACK_FAILED, heads by the normal resolution. */
  | { type: "CONFUSION_CHECK"; seat: Seat; uid: string; result: CoinFace }
  /** The declared attack did NOT resolve: no damage to the defender, no
      effects — and the turn still ends either way. Three reasons, and they differ
      only in what follows:
        • "confusion" — §12, the step-3 flip came up tails; the 30 self-damage
          follows as COUNTERS_PLACED.
        • "requirement" — D125, the attack's printed "If <clause>, this attack
          does nothing." and the clause held (Palafin "Justice Kick" without the
          promotion, Lycanroc "Finishing Fang" into an undamaged Active). Nothing
          follows; the attacker is untouched.
        • "coinFlip" — D126, the attack's printed "Flip a coin. If tails, this
          attack does nothing." came up tails. PRECEDED by the
          ATTACK_EFFECT_COIN_FLIP that announces the face, and followed by
          nothing; the attacker is untouched.
      Each widening is a WIDENING of the reason enum, not a shape change — no
      MATCH_RECORD_VERSION bump for any of them (see match.ts's own doc block);
      a record written by an older deploy stays readable, it simply never carries
      the newer reasons. */
  | {
      type: "ATTACK_FAILED";
      seat: Seat;
      uid: string;
      reason: "confusion" | "requirement" | "coinFlip";
    }
  /** Damage removed from one of `seat`'s IN-PLAY Pokémon by an effect; `amount`
      is what actually came off (clamped at the damage present — never 0), so a
      whiff on an undamaged body emits nothing at all. The Active is only the
      commonest `uid`, not the only one: `healEach`, `healChosen` (D135) and the
      counter move (D138) all reach the Bench. `amount` is what MOVED, never what
      was printed — the half a log-only implementation gets wrong. */
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
  /** §7.3 — `seat` activated the shared Stadium's "once during each player's
      turn" ability (`uid` is the Stadium in the shared zone; `stadium` its name —
      Artazon / Mesagoza / Town Store). Its ops follow in the same batch (and may
      park on a deck-search choice), like ABILITY_USED. */
  | { type: "STADIUM_ABILITY_ACTIVATED"; seat: Seat; uid: string; stadium: string }
  /** §7/§9 — a printed HAND cost was paid: `uids` left `seat`'s hand to make a
      play legal (Ultra Ball's "only if you discard 2 other cards", Tinkaton /
      Meowscarada ex's "you must discard … in order to use this Ability", Dendra's
      "put a card from your hand on the bottom of your deck. If you do, …").
      Fires from the `payFromHand` op, so it follows TRAINER_PLAYED or
      ABILITY_USED in the same batch and PRECEDES whatever the cost bought — the
      order the printed sentence is in.

      `to` is where they went, and it is the difference between a payment the
      opponent can read and one nobody ever sees again: `"discard"` lands them
      face up in the public pile, `"deckBottom"` puts them UNDER the deck (hidden
      zone → hidden zone). The LOG speaks in counts either way, since they came
      out of a hidden hand (the HAND_DISCARDED precedent), but the verb it prints
      differs — and a P4 per-seat filter keys on `to` rather than re-deriving the
      destination from the op. */
  | { type: "HAND_COST_PAID"; seat: Seat; uids: string[]; to: "discard" | "deckBottom" }
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
  /** `uids` went from the top of `seat`'s DECK to `seat`'s DISCARD PILE, in deck
      order, top first — which is the order the pile gained them (§2). That is the
      whole game fact, and it is deliberately stated without a cause: TWO ops
      produce this row and they are not the same kind of effect.

      **`seat` IS THE DECK'S OWNER, on every producer** — the player who lost the
      cards, exactly as DAMAGE_DEALT's seat names the defender. It is sometimes the
      actor and sometimes not, and since D131 ONE producer is both depending on its
      own field, which is why this is the OWNER rather than "the player whose card
      did it":
        • attachFromTop `discardRest` — Hydreigon "Tri Howl"'s printed "Discard the
          other cards": the looked-at top cards a from-the-top ATTACH did NOT
          attach. Own deck, so `seat` is the ACTOR. The cards that WERE attached
          are named by their own ENERGY_ATTACHED rows, never here.
        • discardDeckTop (D130, widened D131) — the MILL, and the ONE producer that
          can be either seat: its `whose` field aims the same action at the
          opponent's deck ("Discard the top 2 cards of your opponent's deck" —
          Chi-Yu ex sv02-040; "For each heads, …" — Wugtrio sv01-057) or at the
          actor's OWN ("Discard the top 5 cards of your deck" — Gyarados
          swsh10.5-022 "Wild Splash"). `seat` is the deck's owner either way, which
          is exactly why this event never needed to name a cause.
      A consumer that read `seat` as "whoever is taking the turn" would credit
      every mill to the wrong player — the same mistake ENERGY_DISCARDED shipped
      once and now carries a separate `actor` to prevent. This event needs no
      `actor`: neither producer's row says who caused it, and the ATTACK_DECLARED /
      TRAINER_PLAYED row above it does.

      Naming the uids leaks nothing on either producer: the discard pile is PUBLIC.

      ONLY FIRES WITH ≥1 CARD on both — a zero-card mill (an already-empty deck)
      and a zero-card leftover emit nothing. But Tri Howl's DOES fire when nothing
      was attached at all (an empty look, or a declined one): the discard is a cost
      the card charges regardless. The sibling clause "Shuffle the other cards back
      into your deck" (Electric Generator) emits nothing of its own — those cards
      never left the deck, and the trailing SHUFFLE row is the whole story. */
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
  /** `seat` REVEALED its whole hand — every uid, because that is what the
      printed word means at a table: both players see all of it (Ortega,
      Greavard "Underworld Stroll"). The uid-carrying opposite of the two
      count-only hand events above, and deliberately so — the reveal is the
      moment those cards STOP being hidden, and an event that named fewer would
      be hiding what the effect just showed. Same idea as MULLIGAN_REVEALED (the
      only other event that makes a whole hand public), though not the same
      payload: that one calls the array `hand` because a mulligan reveal IS the
      hand and nothing else, while this one uses the `uids` every zone-moving
      event in this file uses, since the cards named here are about to be
      picked from.
      `uids` may be empty (revealing an empty hand is honest — the
      HAND_DISCARDED "(0 cards)" precedent; reachable only via the attack twin,
      the Trainer path being gated on the public hand count). */
  | { type: "HAND_REVEALED"; seat: Seat; uids: string[] }
  /** ONE card went from `seat`'s hand to the BOTTOM of `seat`'s own deck,
      chosen by `actor` — the other player (Ortega, Greavard: the reveal-and-
      bottom family; `actor` is the ENERGY_DISCARDED precedent). Names the uid
      because the whole move happened face up: the hand was just revealed
      (HAND_REVEALED) and the pick was made in the open, so both players know
      exactly which card sits on the bottom until something shuffles — as at a
      table. Contrast HAND_COST_PAID `to: "deckBottom"` (Dendra), where the
      payer's hidden card goes hidden → hidden and only the payer ever knew it. */
  | { type: "CARD_TO_BOTTOM_OF_DECK"; seat: Seat; uid: string; actor: Seat }
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
