import type { DamageModifier } from "./cards";
import type { Banner } from "./banners";
import type { AttackerClass, CardFilter, PokemonType, StampedPlayLockKey } from "./effects";
import type { CoinFace } from "./rng";
import type { GameOutcome, PokemonTarget, ScheduledEffect, Seat } from "./types";

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
  /** In-turn Basic played to the bench (§5.2). (🆕🆕🆕 D576: or an Antique Fossil, an ITEM played onto
      the Bench as a 60-HP Basic {C} Pokémon — filed right after its `TRAINER_PLAYED`, R-FO1.)

      🆕 **D294 — `actor` IS THE OPTIONAL "SOMEBODY ELSE PUT IT THERE".** Absent
      (the §5.2 play, every row before this slice) means `seat` benched it out of
      their OWN hand. Present means the OTHER seat did, out of `seat`'s hand:
      Mandibuzz `sv10.5w-064`/`-145` "Look for Prey" — *"…you put a Basic Pokémon
      with 70 HP or less that you find there onto your opponent's Bench."*

      The ENERGY_DISCARDED / CARD_TO_BOTTOM_OF_DECK convention, which this file
      already states: `seat` is the OWNER whose zone changed and `actor` is who
      caused it, and `log.ts` files the row under the ACTOR. Without it the two
      rows are typographically identical, and "you chose to bench that" versus
      "your opponent benched that FOR you" is exactly the distinction a player
      cannot recover afterwards from anything else — the second one hands the
      opponent a Prize-worth body and the reveal that found it.

      An OPTIONAL field rather than a second event: the board outcome, the log
      verb and every reader downstream are the same, and a parallel event would
      be two spellings of one fact (D222's rule). `GameEvent` is not persisted —
      `MatchRecord` stores the RENDERED `SeatLogEntry[]` — so this is a row-wording
      seam for NEW rows only and moves no `MATCH_RECORD_VERSION` byte. */
  | { type: "POKEMON_BENCHED"; seat: Seat; uid: string; actor?: Seat }
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
  /** 🆕🆕 §10 (D433) — the INVERSE of the row above: the highest Stage
      Evolution card (`from`, the uid that WAS the stack top) came off the in-play
      Pokémon on `seat`'s board and was shuffled into `seat`'s deck; `to` is the card
      the stack now tops out at. Damage, Energy and Tools stay attached (§10's
      carry-over, unchanged by direction); Special Conditions are removed — a separate
      STATUS_CLEARED with reason "devolved" lists any that were, exactly as the
      evolution row announces its "evolved" clear.

      🛑 **`actor` IS A CARRIED FIELD AND NOT A DERIVED ONE, AND D425 IS THE
      REASON.** `seat` OWNS the devolved body, as every zone-changing row in this file
      does; the player whose card did it is the OTHER seat on every board this op's one
      printed sentence can build (*"each of YOUR OPPONENT'S evolved Pokémon"*). A
      `log.ts` that recomputed the actor as `otherSeat(event.seat)` would be TRUE today
      and true only by accident — which is precisely the closed-world assumption D425
      found shipped on `DAMAGE_DEALT` and had to repair, where four producers all
      happened to aim across the table until one did not. The field is carried so the
      first same-side devolution (row 87's hand twin, or any own-board print) cannot
      make the log credit the wrong player.

      ⚠️ **NO `target`, unlike POKEMON_EVOLVED.** That row carries one because its
      caller already holds the action's `PokemonTarget` object; this op names no target
      at all — it sweeps a whole board — and nothing reads a spot off this row. A field
      with no reader is a second spelling of the uid (D104).

      ⚠️ **ONE ROW PER BODY AND ONE `SHUFFLE` FOR THE WHOLE SWEEP.** The cards are
      gathered and the deck is touched at most once (`returnSelf`'s stated rule), so a
      sweep that devolves three bodies files three of these and ONE `SHUFFLE`, and a
      sweep that devolves nothing files neither. 🆕🆕🆕 **D540: that sentence is
      scoped to `devolveEach` and stays true of it; `devolveChosen` files ONE row and
      NO `SHUFFLE` at all**, which is what the `zone` rider below exists to say.

      🆕🆕🆕 **D540 — `zone`, THE OPTIONAL DESTINATION RIDER, AND IT IS ADDED BECAUSE
      WITHOUT IT THE HAND MOVE IS ANNOUNCED NOWHERE.** This row was authored
      destination-AGNOSTIC: it names the two uids and the seats and no zone, and
      log.ts's row renders *"devolved X → Y"* and names none either. That was complete
      while the ONE producer always shuffled into the owner's DECK, and a reader could
      infer the zone from the `SHUFFLE` beside it. Row 87 puts the card into the
      owner's HAND with no `SHUFFLE` on the path, so the two producers would have
      emitted INDISTINGUISHABLE rows for two different board changes.

      ⚠️ **OPTIONAL AND NOT REQUIRED, WHICH IS D425's CALL AND D125's WIDENING.**
      Absent means the DECK — exactly what every row written before this slice meant —
      so `devolveEach` emits byte-identical rows and no shipped consumer changes.
      `GameEvent` is NOT persisted at all (`MatchRecord` stores the RENDERED
      `SeatLogEntry[]`), so no `MATCH_RECORD_VERSION` question arises either way; the
      rider is optional because the DEFAULT is meaningful, not to duck a bump. */
  | {
      type: "POKEMON_DEVOLVED";
      seat: Seat;
      actor: Seat;
      from: string;
      to: string;
      zone?: "hand";
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
      The bench stays dense: the retreater fills the promoted Pokémon's
      `promotedFrom` slot at `benchedTo`. Both indices are in the payload so an
      animator — or a P4 client addressing the bench positionally — never has
      to re-derive the reducer's placement rule. `discardedEnergy` lists the
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
      top card's attacks); `uid` is the attacker's top card.
      [🆕🆕🆕 D578 (D539): *"its printed attack"* and *"index into the top card's attacks"* are
      WITHDRAWN — `index` is the flat ATTACK MENU index `AttackAction.index` carries
      (continuous.ts `attackMenuOf`), and `attack` is that menu row's own name. For a printed
      attack the two readings agree byte for byte (printed attacks come FIRST, so the flat index
      IS the printed index); a Relicanth "Memory Dive" row names an attack printed on a card
      UNDER the top, and a Technical Machine row one printed on the attached Tool, each at its
      flat menu index (`memoryDiveD578.test.ts` §3, `tmFluoriteD578.test.ts`). `uid` is still the
      attacker's top card. No shape change.]
      🆕🆕🆕 D573 — `as` is the COPIED attack's printed name when `attack` is a copy-attack
      (Night Joker / Foul Play / Metronome / Gemstone Mimicry / Try to Imitate) that resolved
      as another Pokémon's attack. ABSENT on every other declaration, and on a copy that found
      nothing to copy (D135) — 🆕🆕🆕 D573 review: and on a copy that RESOLVED nothing: Try to
      Imitate's tails, a Confusion tails, a flip-lock tails. attack.ts stamps it onto the event
      only once the copied attack is known to resolve, so the log never reads "(as Smash)" over
      an attack that did nothing. `attack` stays the COPIER's own name (R-CP7). */
  | { type: "ATTACK_DECLARED"; seat: Seat; uid: string; attack: string; index: number; as?: string }
  /** 🆕🆕🆕 D574 — the SECOND HALF of a resolve-time copy (Haughty Order / Seek Inspiration)
      resolved as another Pokémon's attack `as`. ATTACK_DECLARED went out with the FIRST half
      (before the reveal / mill and the park), so the copied name cannot ride its `as` — this row
      carries it instead, once the copied attack is known to resolve, and `attack` stays the
      COPIER's name (R-CP7). Never emitted on a decline, an empty find or a tails. A new union
      member (D125); not persisted (D141). */
  | { type: "ATTACK_COPY_RESOLVED"; seat: Seat; uid: string; attack: string; as: string }
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
      `seat`/`uid` name the DAMAGED body (the seat owns the uid, as everywhere),
      `dealt` what this attack added and `damage` that body's cumulative
      total after.

      🆕🆕 **D425 — `by` NAMES THE SEAT THAT DEALT IT, AND IT IS REQUIRED BECAUSE THE
      ONE READER THAT NEEDED IT WAS DERIVING IT (D222's rule on a log row).**
      `log.ts` rendered this row under `otherSeat(event.seat)` — a hand-spelled
      closed-world assumption meaning *"whoever was damaged, the OTHER player did
      it"*. That held for every producer this engine had, and it held by ACCIDENT:
      all four write sites aimed across the table, and `damageSelf` — the one op
      that does not — emits `COUNTERS_PLACED`, never this row.

      🛑 **D425's own-side bench spread is the first `DAMAGE_DEALT` whose `seat` IS
      the attacker's**, and under the old line the log credited the DEFENDER with
      damage the ATTACKER had just done to its own Bench. A false row, in the
      direction that misreads the board.

      ⚠️ **REQUIRED RATHER THAN AN OPTIONAL `selfInflicted` RIDER, on D421's test:
      an optional key must be chosen so that LOSING it is detectable, and a lost
      rider here degrades into exactly the plausible-looking wrong attribution
      above.** A required field makes a new damage site that forgets it a COMPILE
      ERROR instead. It is `otherSeat(seat)` on every pre-D425 board, so every
      shipped log row renders byte-identically — asserted in `ownBenchSpread.test.ts`
      rather than claimed here.

      ⚠️ **NOTHING PERSISTED MOVES.** `MatchRecord` holds `state` and the already-
      RENDERED `log: SeatLogEntry[]`; raw events are transient inputs to
      `logFromEvents` and are never written. So this field is invisible to
      `MATCH_RECORD_VERSION`, which stays 26. */
  | {
      type: "DAMAGE_DEALT";
      seat: Seat;
      /** The seat whose Pokémon DEALT this damage — the attacker, or the
          controller of the Ability that placed it. Equal to `otherSeat(seat)` on
          every board printed before D425, and NOT equal to it on an own-side
          bench spread. */
      by: Seat;
      uid: string;
      base: number;
      /** HP the attack's own printed damage-scaling clause added to `base`
          BEFORE Weakness/Resistance (Paldean Tauros "Raging Horns" — 10 per
          damage counter on the attacker). Present only when it applied. Distinct
          from `bonus`, a CONTINUOUS effect (Vitality Band); both land at the same
          pre-W/R step. */
      scaled?: number;
      /** Flat HP ADDED to the attacker's output BEFORE Weakness/Resistance, from
          BOTH of the places the pool prints that: the always-on continuous half
          off the catalog (Vitality Band, Choice Belt, Defiance Band, Practice
          Studio, Binding Mochi — §15.B, folded by `attackerPreWRBonus`) and, since
          D155, the DURATED half installed onto the board by an attack ("During
          your next turn, this Pokémon's {AttackName} attack does {N} more damage
          (before applying …)."). Present only when the sum actually applied.

          ⚠️ ONE FIELD FOR TWO SOURCES, AND THAT IS THE ROW's STANDING SHAPE
          RATHER THAN AN ECONOMY: `reduction` below has summed a catalog half with
          an attack-installed one since D147, and `debuff` an installed half with
          an aura since D151. This row reports one number per STEP AND DIRECTION,
          never one per card — which is why `debuff` is a second field (opposite
          direction, same step) and this is not (same direction, same step). A
          reader can still reconstruct §8.5 in printed order from the fields as
          they stand; what they cannot do is attribute HP to a card, and no row in
          this family ever could (D141's judgement, third occurrence). */
      bonus?: number;
      /** Flat HP taken off the ATTACKER's output BEFORE Weakness/Resistance, from
          all THREE of the places the pool prints that: the attack-installed debuff
          (D149 — Houndoom "Snarl", Pikachu/Pidove "Growl", Florges "Moonblast":
          "During your opponent's next turn, the Defending Pokémon's attacks do {N}
          less damage (before applying Weakness and Resistance).") and its always-on
          aura twin (D151 — Entei "Pressure"), plus, since D163, the attack's OWN
          printed self-scaling clause ("This attack does {10|20} less damage for
          each damage counter on this Pokémon." — Skeledirge ex "Burning Voice",
          Cetitan "Sweeping Tackle"). Present only when it actually took something
          off.

          ⚠️ D163's SOURCE IS THE FIRST ONE THAT IS NEITHER INSTALLED NOR AIMED AT
          THE ATTACKER — it is a fact about the attack being used. It still lands
          here rather than in a field of its own for the reason `bonus` above
          gives: one number per STEP AND DIRECTION. Its sibling clause with the
          opposite adjective ("{N} MORE damage for each damage counter") is
          reported through `scaled`, one field up, which is the same rule seen from
          the adding side.

          ⚠️ IT IS A FIELD OF ITS OWN RATHER THAN A NEGATIVE `bonus`, and the row
          is where that decision is observable. `bonus` is documented above as
          what the attacker's continuous effects ADDED and is emitted only when
          positive, so folding a debuff into it would drop the number from the row
          and from the log line a player reads — while the same arithmetic
          reported in two fields lets the reader reconstruct the pipeline in
          printed order (types.ts `AttackDamageDebuff`).

          It is `reduction`'s MIRROR one field down: that one is the DEFENDER's
          number applied after the modifiers, this one the ATTACKER's applied
          before them, and a row can legitimately carry BOTH. */
      debuff?: number;
      weakness: DamageModifier | null;
      resistance: DamageModifier | null;
      /** Flat HP the defender's continuous effects removed AFTER Weakness/
          Resistance (Bouffalant "Bouffer", a defending Tool — §15.B).
          Present only when it actually reduced. */
      reduction?: number;
      /** 🆕🆕🆕 D547 — Flat HP ADDED to the hit AFTER Weakness/Resistance by an
          attack-installed NEXT-TURN VULNERABILITY on the damaged Pokémon ("During
          your next turn, the Defending Pokémon takes 50 more damage from attacks
          (after applying Weakness and Resistance).", `censusAttackCorpus.ts:150`).
          `reduction`'s MIRROR at the same step — a field of its own and NOT a
          negative `reduction`, D149's rule (one field per step AND direction), so
          the row still reconstructs §8.5 in printed order and a row may carry
          BOTH. Present only when it applied. An optional field on a non-persisted
          event: a widening (D141). */
      vulnerability?: number;
      /** True when the defender fully PREVENTED this attack's damage (Mimikyu
          "Safeguard" — all damage from an opponent's Pokémon ex/V), so `dealt` is
          0 for that reason rather than because the attack does no damage. Present
          only when a prevention actually fired. */
      prevented?: true;
      /** True when the §8.1 KO-SURVIVAL clamp fired on this write — the defender
          had FULL HP, `dealt` would have Knocked it Out, and its printed Ability
          left it standing on 10 HP instead (Pikachu ex "Resolute Heart", Crustle
          "Sturdy" — continuous.ts `koSurvivalClamp`). Present only when it
          actually fired.
          [🆕🆕🆕 D598 (D539): *"the defender had FULL HP"* is WITHDRAWN as the only case, kept as
          written — the flag is also set when the coin-flip survival saved the body on heads (Mega
          Hawlucha ex "Tenacious Body", Annihilape "Durable Body" — continuous.ts
          `koSurvivalCoinFlip`), which has no full-HP antecedent.]

          ⚠️ THIS IS THE ONE ROW WHERE `damage` IS NOT `the previous total + dealt`,
          AND THE FLAG EXISTS TO SAY SO RATHER THAN TO LET A READER GUESS. `dealt`
          stays the §8.5 pipeline's real output — what the attack did, and what the
          `dealt > 0` gates on `damageAttacker` and the `onDamagedByAttack` trigger
          correctly still read — while `damage` reports the CLAMPED total the board
          now carries. A row saying `dealt: 200, damage: 110, survived: true` on a
          120 HP body reconstructs the whole event in printed order; the same row
          without the flag would look like an arithmetic bug.

          `prevented`'s shape one field up, and its widening rule: an OPTIONAL new
          field on an existing event is a WIDENING and does not move
          `MATCH_RECORD_VERSION` — every record written before this slice means
          exactly what it meant, namely that no clamp fired. */
      survived?: true;
      dealt: number;
      damage: number;
    }
  // — M3 special conditions (§12) and the Pokémon Checkup (§13). `seat` on
  //   STATUS_APPLIED / STATUS_CLEARED / COUNTERS_PLACED / HEALED always OWNS
  //   the affected Pokémon; `uid` is the stack-top uid of its Active.
  /** An attack effect inflicted `status` (§12). `poisonDamage` is present
      iff status === "poisoned": the damage placed at each Checkup (10 unless
      the attack raised it). 🆕🆕 `confusionDamage` (D501) is its exact twin and is
      present iff status === "confused": the HP the body places on ITSELF when the
      §8 step-3 flip misses (30 unless the attack raised it). A rotation status
      (asleep/paralyzed/confused) REPLACES any previous rotation — no separate
      cleared event fires for the overwritten one.

      ⚠️ BOTH AMOUNT KEYS ARE OPTIONAL ON THE EVENT AND ALWAYS WRITTEN BY THE ONE
      PRODUCER, which is not a contradiction: the optionality is the UNION's (the
      other three statuses carry neither), and `interpreter.ts`'s `applyStatus`
      resolves the op's absent rider to the rule default before filing the row. So
      a reader may rely on the key being present whenever the status matches, and
      `log.ts` compares it against the default rather than testing for absence. */
  | {
      type: "STATUS_APPLIED"
      seat: Seat
      uid: string
      status: StatusName
      poisonDamage?: number
      confusionDamage?: number
    }
  /** §12 (D172) — a Special Condition was REFUSED by the target's own printed
      immunity ("This Pokémon can't be Burned." / "…can't be Paralyzed."). The
      exact negative of the row above it: same `seat`/`uid` contract (they own the
      Pokémon the condition was aimed at, which here is also the Pokémon whose own
      Ability did the refusing), same `status` vocabulary, and it fires INSTEAD of
      STATUS_APPLIED rather than beside it.

      ⚠️ IT EXISTS BECAUSE THE ALTERNATIVE IS SILENCE, WHICH IS THE DEFECT D159
      SPENT A WHOLE SLICE FIXING ON THE OTHER PIPELINE. Without this row a Burn
      aimed at Dachsbun reads as "Scovillain used Hot Bite · dealt 20 damage" and
      nothing else — indistinguishable from an attack whose status clause the
      engine forgot, on a board where the reader cannot see the difference. Every
      other way an effect can be nulled already says so (`ATTACK_EFFECT_PREVENTED`,
      `ATTACK_EFFECT_SKIPPED`, `DAMAGE_DEALT.prevented`); this is the fifth.

      ⚠️ IT CARRIES THE `status` AND NOT THE REASON, WHICH IS THE OPPOSITE CALL
      FROM `ATTACK_EFFECT_PREVENTED` ONE FAMILY DOWN, AND BOTH ARE RIGHT. That row
      names no cause because five different rules set one flag and the event has
      never claimed to discriminate them. Here there is exactly ONE rule and the
      thing a reader cannot otherwise recover is WHICH condition was refused — a
      body immune to one of several conditions an attack applies would emit an
      uninterpretable row without it. NOT reachable from a non-attack caller
      today (the only Trainer that applies a status poisons its own Active, and
      nothing in the pool is Poison-immune), so the wording stays about the
      CONDITION rather than about the attack. */
  | { type: "STATUS_PREVENTED"; seat: Seat; uid: string; status: StatusName }
  /** Conditions leaving a Pokémon: `statuses` lists every one that was
      actually removed. "benched" (retreat, §11/§12) and "evolved" (§10) both
      clear everything at once — the latter's `uid` is the NEW top card (the
      evolution the conditions vanished under); the remaining reasons are
      single-condition Checkup recoveries (§13) and always carry exactly one
      entry.

      ⚠️ "recovered" (D174) IS THE FIRST REASON THAT IS NEITHER A PLACEMENT NOR A
      CHECKUP STEP — a CONTINUOUS effect clearing what it covers (Therapeutic Energy
      sv02-193, "The Pokémon this card is attached to recovers from being Asleep,
      Confused, or Paralyzed"). It carries a SUBSET rather than everything, unlike
      "benched"/"evolved": the effect names its conditions, so a Burned and Asleep
      body attached to this Energy reports `["asleep"]` and keeps burning. It is a
      new REASON and not a new EVENT because nothing about the row differs — same
      seat/uid contract, same list, same rendering verb — and a second event for one
      reading is D131's drift. */
  | {
      type: "STATUS_CLEARED";
      seat: Seat;
      uid: string;
      statuses: StatusName[];
      /** 🆕🆕 "devolved" (D433) is "evolved"'s inverse and NOT a re-use of it:
          §12 names the two events separately (*"retreats / moves to Bench, evolves,
          devolves, or by card effect"*), and the two rows render under DIFFERENT
          seats' agency — an evolution is always the owner's own play, a devolution in
          this pool is always the opponent's attack. A shared reason would make one
          fact two readings (D131) in the one direction a player cannot recover
          afterwards. */
      reason:
        | "benched"
        | "evolved"
        | "devolved"
        | "wokeUp"
        | "burnCured"
        | "paralysisEnded"
        | "recovered";
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
  /** §7.1/§7.2 (D283) — an attack effect barred `seat` from playing `cards` from
      hand for exactly their next turn (Scream Tail ex sv06-094/-197, Galvantula
      ex sv07-051/-159/-168, Budew sv08.5-004, Frillish sv10.5w-044/-126).
      `seat` is the BARRED player — RETREAT_BLOCKED's victim-side rule, and for
      the same reason: the rider is printed as something done TO them.

      🛑 **NO `uid`, WHICH IS THE WHOLE DIFFERENCE FROM ITS TWO SIBLINGS.**
      RETREAT_BLOCKED and ATTACK_LOCKED each name the Pokémon they stamped; this
      row has none to name, because the bar is on the PLAYER and survives every
      §10 clear that lifts those two (types.ts `handPlayLockedTurn`). A `uid` here
      would be the attacker's, and a log line that named it would read as though
      the bar could be escaped by switching that body out.

      There is deliberately no `…_ENDED` twin, for `ATTACK_BLOCK_INSTALLED`'s
      reason one block down: the bar is a TURN STAMP that expires by arithmetic,
      so there is no boundary walk to announce it from and nothing to announce.

      ⚠️ **`StampedPlayLockKey` AND NOT `HandPlayClass`/`PokemonPlayAct` (D284,
      WIDENED BY D285).** Only the ATTACK source emits a row at all — a CONTINUOUS
      bar is a standing board fact with no moment to announce, exactly as
      `preventTrainerEffects` has none — so a `"Tool"` or `"bench"` value here
      would be one no board could produce.

      🆕 **THE FIELD IS `bars` AND IT WAS `cards` UNTIL D285.** Bronzong `sv05-069`
      "Evolution Jammer" bars an ACT (`"evolve"`), and a row whose payload is
      called `cards` cannot honestly carry it — log.ts renders the value directly,
      so the rename is what stopped the row reading "can't play evolve cards". */
  | { type: "HAND_PLAY_BLOCKED"; seat: Seat; bars: StampedPlayLockKey }
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
      early half of RETREAT_BLOCK_ENDED.

      `fromClass` (D146, an `AttackerClass` record since D239) is the printed
      ATTACKER-CLASS narrowing — present exactly when the sentence says "…by
      attacks from Basic [non-{X}] Pokémon", absent when the block refuses every
      attacker. ⚠️ It is carried STRUCTURED and rendered by `log.ts`, not carried
      as a caption: D238's rule is that a brace code must never reach a player's
      eyes, so the row holds `{ stage, excludingType }` and the renderer spells
      "non-Colorless". It is on the row for `effects`' reason
      verbatim: a player told only "protected" cannot work out what is about to
      hit them, and here the gap is wider than the Poison one — a filtered block
      lets a Stage 1 through for full damage, so a row that omitted the class
      would read as a bug the moment the next attack landed. There is deliberately
      NO row for a block that FAILS to match: the attack's own DAMAGE_DEALT
      (`prevented` absent, the real number in `dealt`) already says the whole
      thing, and announcing a rule that declined would be announcing a non-event —
      loudness in this engine is owed to UNREAD TEXT, not to a read rule saying
      no (D140). */
  /** ⚠️ D240 ADDS `maxDamage` FOR `fromClass`'s REASON AND A SHARPER VERSION OF
      IT. A capped block ("prevent all damage … if that damage is 40 or less") is
      the FOURTH thing this row can be describing, and a row that said only
      "protected from damage from attacks" would be an outright lie about a
      90-damage attack landing next turn in full — worse than the `fromClass` gap,
      because there the player at least sees a class to reason about. The number is
      on the row rather than looked up on the board, so the wording cannot drift
      from what `attackBlockOf` will enforce, exactly as the class is. */
  | {
      type: "ATTACK_BLOCK_APPLIED";
      seat: Seat;
      uid: string;
      effects: boolean;
      fromClass?: AttackerClass;
      maxDamage?: number;
    }
  /** §8/§11 (D143, widened D148) — an attack LOCKED a Pokémon out of attacking on
      its controller's next turn. `seat` OWNS THE LOCKED POKÉMON, which is D136's
      finding 1 and the only part of this row's contract that has ever mattered —
      and since D148 that seat is the ACTOR's own on 22 printings ("During your
      next turn, this Pokémon can't attack.") and the ACTOR'S OPPONENT's on 4
      ("…the Defending Pokémon can't attack."). It is the one row of the three
      durated families that reports a DRAWBACK rather than a protection, and the
      wording has to say so: a player who reads "protected" where the card cost
      them their next attack has been told the opposite of what happened.

      ⚠️ ONE ROW, ONE WORDING, BOTH DIRECTIONS — AND THAT IS A RESULT, NOT A
      SAVING. D143 phrased its copy from the HOLDER's side ("<name> can't attack
      next turn") deliberately, "so it reads as RETREAT_BLOCKED's sibling — which
      is exactly what it is, with the direction flipped". RETREAT_BLOCKED is a
      VICTIM-side row. So the phrasing D143 chose for an active-voiced row was
      already the passive-side one, and the direction it was written to flip is the
      direction D148 added: the row renders honestly under either seat with no new
      arm, no `target` on the event, and nothing for a reader to disambiguate,
      because "next turn" means the LOCKED player's next turn in both readings.
      Contrast D146, which needed a THIRD phrasing the moment its field landed —
      the difference is that `fromClass` changes what the rule DOES and `target`
      only changes whose name the row already carries. Driven and read in sequence
      rather than argued (D144's rule), from both seats.

      No `…_ENDED` twin, for ATTACK_BLOCK_APPLIED's reasons verbatim (a turn stamp
      expires by arithmetic, with no boundary walk to announce it from), and the
      EARLY endings — retreating, being switched out, evolving — are already told
      by their own POKEMON_SWITCHED / RETREATED / POKEMON_EVOLVED row.

      The REFUSAL needs no event either, and that is where this family differs
      from D142's `ATTACK_EFFECT_PREVENTED`: a refused attack clause is silent
      unless something says so, but a refused ATTACK DECLARATION comes back to the
      player as an `ATTACK_PREVENTED` rejection with a message (actions.ts). The
      action never happened, so there is no history row to write.

      ⚠️ `attack` IS D154's PER-ATTACK NARROWING, AND IT IS A FIELD ON THIS EVENT
      RATHER THAN A SIBLING EVENT — D113's rule, and D153's application of it three
      weeks running. The game fact is one fact ("this body has been barred from
      attacking next turn"); what the printed sentence adds is HOW MUCH of it is
      barred, and ABSENT means "all of it" (D135's absent-key rule, the polarity
      `AttackBlock.fromClass` and `preventAttack.target` are already under). The
      renderer branches on presence, and the branch is REQUIRED rather than
      cosmetic: "<name> can't attack next turn" printed for a Skarmory that may
      still declare "Peck" is not stilted, it is FALSE — which is the test D153
      left behind (does the row ASSERT something the path makes untrue?).

      It carries the printed NAME and not the index the state stores, because a log
      row is read by a player holding the card: the index is the engine's
      addressing and the name is the card's. The install resolves one to the other
      once (interpreter.ts) and puts both where they are read.

      The row is still emitted by ONE op each — `preventAttack` writes it bare,
      `preventAttackUse` writes it with the name — and the VOICE rule is unchanged
      in both: `seat` owns the LOCKED Pokémon (D136's finding 1). D154's op has no
      defender arm, so its rows are always the actor's own; D148's remain the
      actor's on 22 printings and the victim's on 4. "next turn" means the NAMED
      player's next turn under either, which is what makes one wording carry all
      three paths (D148's finding, re-checked by rendering the new row under both
      seats rather than by citing it).

      🆕🆕 **D421 — A SECOND OPTIONAL RIDER, ON THE OTHER AXIS, AND D153's TEST IS
      WHY IT IS OWED.** *"This Pokémon can't use Blaze Blitz again until it leaves
      the Active Spot."* (5 legal printings, Gouging Fire ex sv05-038/-188/-204/
      -214 and svp-144) bars ONE attack with NO clock. `attack` alone already
      renders `"<name> can't use Blaze Blitz next turn"` — and that row is not
      stilted, it is **FALSE**, and false in the direction that costs a player a
      turn: they wait one turn, press the button and the server refuses it again,
      forever. The question is never "does the row NAME the duration?" but "does
      it ASSERT something this path makes untrue?", and it does.

      `until` is the SAME key with the SAME value as the op's (effects.ts) and the
      record's (types.ts `LockedAttack`), which is the point rather than a
      coincidence: one spelling on three surfaces means a reader cannot honour the
      rider in one place and forget it in another. ABSENT keeps meaning the
      next-turn window on every path that had one, so `attack` and `until` are two
      independent presence branches over ONE fact and neither is a sibling event
      (D113's rule, held for the fourth time at this address).

      THE SEAT RULE IS UNTOUCHED AND THE WORDING IS CHECKED AGAINST IT RATHER THAN
      ASSUMED: `seat` still owns the BARRED Pokémon, and the new phrasing carries
      no "next turn" and no player name at all, so it reads identically under
      either seat — rendered under both and READ (`untilLeavesActiveBar.test.ts`
      §7), which is what this family does instead of citing itself.

      🆕🆕🆕 **D547 — A THIRD OPTIONAL RIDER, `flip?: true`, AND D421's TEST IS WHY IT
      IS OWED.** *"During your opponent's next turn, if the Defending Pokémon tries
      to use an attack, your opponent flips a coin. If tails, that attack doesn't
      happen."* (`censusAttackCorpus.ts:176`, 2 legal printings) installs a lock that
      leaves the declaration LEGAL. Without the rider the row renders *"<name> can't
      attack next turn"* — FALSE, in the direction that costs a player a turn: they
      would not press a button that works on heads. A RIDER and not a sibling event
      for D113's reason (one fact — "this body's attacks are constrained next turn"
      — with a presence branch); the seat rule is unchanged (`seat` owns the LOCKED
      Pokémon). Written only by `flipLockAttack`'s installer; never beside
      `attack`/`until`. A `GameEvent` is not persisted (D141).
      🆕🆕🆕 D636 — `coins?: 2` beside `flip` for Jet of Ink's two coins ("flips 2 coins. If either of them is
      tails"): without it the row would promise one coin. Written only by `flipLockAttack`'s `coins === 2` arm. */
  | {
      type: "ATTACK_LOCKED";
      seat: Seat;
      uid: string;
      attack?: string;
      until?: "leavesActive";
      flip?: true;
      coins?: 2;
    }
  /** §8.5/§11 (D147) — an attack INSTALLED a durated DAMAGE REDUCTION on its own
      Active ("During your opponent's next turn, this Pokémon takes {N} less
      damage from attacks (after applying Weakness and Resistance)."). `amount` is
      the HP subtracted, and it is on the row because it is the whole content of
      the rule: unlike ATTACK_BLOCK_APPLIED — where "protected" plus a spelling
      says everything a reader needs — a reduction that did not say HOW MUCH would
      leave the reader unable to predict a single number on the very next turn,
      and the pool prints four different amounts (20/30/50/100) behind one
      sentence. It is the MERGED number, not the printed one, for the same reason
      ATTACK_BLOCK_APPLIED reports the merged `effects`: the row must describe the
      state that now exists.

      `seat` owns the protected Pokémon, which — as with the two rows above — is
      the ACTOR's own, so this too renders honestly in the ACTIVE voice.

      No `…_ENDED` twin, for ATTACK_BLOCK_APPLIED's reasons verbatim (a turn stamp
      expires by arithmetic, with no boundary walk to announce it from), and the
      EARLY endings are already told by their own POKEMON_SWITCHED / RETREATED /
      POKEMON_EVOLVED row.

      AND NO ROW WHEN IT FIRES. A reduction that actually bites is already fully
      reported by `DAMAGE_DEALT.reduction`, which has carried that number since
      Bouffalant "Bouffer" and names the FACT — this much was taken off — which is
      identical whichever source supplied it. Announcing WHICH would owe the row a
      member to say something the install row above already put in the reader's
      hands (D142's argument for `prevented`, on the number instead of the flag). */
  | {
      type: "DAMAGE_REDUCTION_APPLIED";
      seat: Seat;
      uid: string;
      amount: number;
      /** 🆕🆕🆕 D630 — the printed attacker class (Metal Block), a fresh copy; absent = every attacker. */
      fromClass?: AttackerClass;
    }
  /** 🆕🆕 §8.5/§11 (D432) — an attack INSTALLED a durated NO-WEAKNESS bar on
      the CONTROLLER's own Active ("During your opponent's next turn, this Pokémon
      has no Weakness."). ACTOR-voiced by construction, exactly as
      DAMAGE_REDUCTION_APPLIED is: the op has no defender arm, so the row always
      renders under the INSTALLER's name and may therefore keep the PRINTED words
      "during your opponent's next turn" — which are true only under that name
      (ATTACK_DEBUFF_APPLIED's whole argument, arriving at the answer instead of
      the exception).

      ⚠️ **NO `amount`, AND NO FIELD AT ALL BEYOND THE BODY — WHICH IS WHY THIS ROW
      IS NOT DAMAGE_REDUCTION_APPLIED's SHAPE.** Every durated row above carries a
      number *because the number IS the rule*. Here the rule is the ABSENCE of a
      step, so there is nothing for a number to report and a `0` would be a lie in
      the shape of a fact.

      No `…_ENDED` twin, for ATTACK_BLOCK_APPLIED's reasons verbatim (a turn stamp
      expires by arithmetic, with no boundary walk to announce it from), and the
      EARLY endings — retreating, being Switched out, evolving — are already told
      by their own POKEMON_SWITCHED / RETREATED / POKEMON_EVOLVED row.

      AND NO ROW WHEN IT BITES — but the biting is still fully reported, and by a
      field rather than by silence: `DAMAGE_DEALT.weakness` is `null` on exactly
      the hit the bar shortened, where the same board without the bar carries
      `{ op: "multiply", amount: 2 }`. That is the one place in this family where
      the "no row when it fires" rule (D140/D146) is backed by a DIFFERENCE a
      reader can see rather than by an argument. */
  | { type: "WEAKNESS_REMOVED"; seat: Seat; uid: string }
  /** §8.5/§11 (D149) — an attack INSTALLED a durated ATTACK-DAMAGE DEBUFF on the
      DEFENDING Pokémon ("During your opponent's next turn, the Defending
      Pokémon's attacks do {N} less damage (before applying Weakness and
      Resistance)."). `amount` is the HP that will come off every damage that
      Pokémon's attacks do next turn, and it is on the row for
      DAMAGE_REDUCTION_APPLIED's reason verbatim: the number IS the rule, and the
      pool prints three of them (20/30/100) behind two sentences. It is the MERGED
      number, not the printed one.

      ⚠️ `seat` OWNS THE DEBUFFED POKÉMON — D136's finding 1 — AND HERE THAT IS
      THE ACTOR'S OPPONENT, WHICH MAKES THIS THE FIRST ROW IN THE DURATED FAMILY
      THAT IS VICTIM-SIDE BY CONSTRUCTION RATHER THAN BY WHICH PRINTING FIRED.
      ATTACK_BLOCK_APPLIED and DAMAGE_REDUCTION_APPLIED are always the actor's own
      (both ops write to `ctx.seat`); ATTACK_LOCKED is the actor's on 22 printings
      and the victim's on 4 (D148). This op has no self arm at all, so the row is
      ALWAYS rendered under the victim's name — which is precisely why its wording
      could not be copied from DAMAGE_REDUCTION_APPLIED's. That row says "…during
      your opponent's next turn", the printed words, and they are true because it
      renders under the INSTALLER's name. Under the victim's name the same words
      would name the wrong turn. See log.ts.

      No `…_ENDED` twin, for ATTACK_BLOCK_APPLIED's reasons verbatim (a turn stamp
      expires by arithmetic, with no boundary walk to announce it from), and the
      EARLY endings — retreating, being Switched out, evolving — are already told
      by their own POKEMON_SWITCHED / RETREATED / POKEMON_EVOLVED row.

      AND NO ROW WHEN IT FIRES. A debuff that actually bites is fully reported by
      `DAMAGE_DEALT.debuff` on the very hit it shrank, which names the FACT — this
      much came off before the modifiers — exactly as `reduction` has named its
      own since Bouffalant "Bouffer" (D140/D146: loudness is owed to UNREAD TEXT,
      not to a read rule doing its job). */
  | { type: "ATTACK_DEBUFF_APPLIED"; seat: Seat; uid: string; amount: number }
  /** 🆕🆕🆕 §8.5/§11 (D547) — an attack made the DEFENDING Pokémon VULNERABLE for the
      installer's next turn ("During your next turn, the Defending Pokémon takes 50
      more damage from attacks (after applying Weakness and Resistance).",
      `censusAttackCorpus.ts:150`). ATTACK_DEBUFF_APPLIED's contract directly above:
      `seat` OWNS the exposed Pokémon (the actor's opponent, D136's finding 1), and
      `amount` is the MERGED number the record now holds, so the row describes the
      state that exists. The hit that pays it reports the same figure in
      `DAMAGE_DEALT.vulnerability`. Not persisted (D141). */
  | { type: "DAMAGE_VULNERABILITY_APPLIED"; seat: Seat; uid: string; amount: number }
  /** 🆕🆕🆕 §8.5/§11 (D552) — an attack RETYPED the Defending Pokémon's Weakness until the
      end of the installer's next turn ("Until the end of your next turn, the Defending
      Pokémon's Weakness is now {C}. (The amount of Weakness doesn't change.)",
      `censusAttackCorpus.ts:629`). DAMAGE_VULNERABILITY_APPLIED's contract: `seat` OWNS the
      marked Pokémon (D136's finding 1). `weaknessType` is the type the printed Weakness now
      names (`"Colorless"`), named so rather than `type`, which is the event discriminator.
      Not persisted (D141). */
  /** 🆕🆕🆕 D640 — `asTimesTwo`: Overwriting Bolt's "(Apply Weakness as ×2.)" (the record's own key); absent
      on D552's sentence, whose row says the amount doesn't change. */
  | { type: "WEAKNESS_RETYPED"; seat: Seat; uid: string; weaknessType: string; asTimesTwo?: true }
  /** 🆕🆕🆕 §8.2/§11 (D549) — an attack TAXED the Defending Pokémon's costs for its
      controller's next turn ("During your opponent's next turn, attacks used by the
      Defending Pokémon cost {C} more, and its Retreat Cost is {C} more.",
      `censusAttackCorpus.ts:171`). `seat` OWNS the taxed Pokémon (D136's finding 1).
      A NEW event and NOT an `ATTACK_LOCKED` rider (D421): the body is not locked, and
      that row's every rendering says it cannot attack. No amount: the tax is the
      printed single {C} on both costs (types.ts `costTaxTurn`). Not persisted (D141). */
  | { type: "COST_TAX_APPLIED"; seat: Seat; uid: string }
  /** 🆕🆕🆕 §8.1/§11 (D549) — an attack put a KNOCK OUT BOUNTY on the Defending
      Pokémon for the installer's next turn ("During your next turn, if the Defending
      Pokémon is Knocked Out, take 2 more Prize cards.", `censusAttackCorpus.ts:149`).
      DAMAGE_VULNERABILITY_APPLIED's contract: `seat` OWNS the marked Pokémon and
      `amount` is the MERGED number the record now holds. The Knock Out that pays it
      files PRIZE_BONUS (with no ABILITY_TRIGGERED in front). Not persisted (D141). */
  | { type: "KO_BOUNTY_APPLIED"; seat: Seat; uid: string; amount: number }
  /** 🆕🆕🆕 §8/§11 (D549) — an attack LOCKED a whole SIDE's attacks for that side's
      controller's next turn (`censusAttackCorpus.ts:169`, `maxEnergy: null`; `:170`,
      `maxEnergy: 2`). `seat` owns the LOCKED side — HAND_PLAY_BLOCKED's rule, and for
      its reason: NO `uid`, because the lock is on the SIDE and survives every body
      leaving play, including the installer (a `uid` would read as though switching
      that body out escaped it). `maxEnergy` is the MERGED value the record holds.
      Not persisted (D141). */
  | { type: "SIDE_ATTACKS_LOCKED"; seat: Seat; maxEnergy: number | null }
  /** 🆕🆕🆕 §8.5 (D556) — a Trainer installed a THIS-TURN side-wide pre-W/R bonus
      (Black Belt's Training: *"During this turn, attacks used by your Pokémon do 40
      more damage to your opponent's Active Pokémon ex (before applying Weakness and
      Resistance)."*). `seat` is the INSTALLER — the side whose attacks get it (the
      turn's own player). NO `uid`, `SIDE_ATTACKS_LOCKED`'s reason: the bonus is on the
      SIDE, and a Pokémon promoted after the play gets it too. `target` is the printed
      defender noun, carried as the rule's own `CardFilter` (log.ts renders it through
      `retrieveNoun`, the one noun reader). Emitted even when no ex is Active (R1: the
      play whiffs visibly). Not persisted (D141). */
  /** 🆕🆕🆕 D621 — `attacker` is the printed attacker noun when the print has one (Gladion's Final
      Battle, Premium Power Pro); ABSENT = every attacker. */
  | { type: "SIDE_ATTACKS_BOOSTED"; seat: Seat; amount: number; target: CardFilter; attacker?: CardFilter }
  /** 🆕🆕🆕 §8.5 (D564) — a Supporter installed a SIDE-WIDE post-W/R reduction for the
      opponent's next turn (Jasmine's Gaze: *"During your opponent's next turn, all of your
      Pokémon take 30 less damage from attacks from your opponent's Pokémon (after applying
      Weakness and Resistance)."*). `seat` is the INSTALLER, which is also the SHIELDED side.
      NO `uid`, `SIDE_ATTACKS_LOCKED`'s reason: the record is on the SIDE, and a Pokémon
      that comes into play afterwards is covered too. Not persisted (D141). */
  | {
      type: "SIDE_DAMAGE_REDUCTION_INSTALLED";
      seat: Seat;
      amount: number;
      /** 🆕🆕🆕 D630 — Iron Defender's printed holder type; absent = every Pokémon (Jasmine's Gaze). */
      pokemonType?: PokemonType;
    }
  /** 🆕🆕🆕 §11 (D621) — Acerola's Mischief shielded `seat`'s chosen body `uid` (its TOP card at the
      install) from the damage and effects of attacks by `fromClass` for the opponent's next turn.
      `fromClass` is a fresh copy. Not persisted (D141). */
  | { type: "CHOSEN_ATTACK_SHIELD_INSTALLED"; seat: Seat; uid: string; fromClass: AttackerClass }
  /** 🆕🆕🆕 §11 (D621) — Roxie's Performance locked the retreat of `seat`'s `status` Pokémon (the
      VICTIM's seat) for that seat's next turn. Not persisted (D141). */
  | { type: "SIDE_RETREAT_LOCKED"; seat: Seat; status: "poisoned" }
  /** 🆕🆕🆕 §11 (D575) — an attack installed a SIDE-WIDE, class-filtered damage block on
      `seat`'s `banner` Pokémon for the opponent's next turn (Miraidon `sv08-069` "C.O.D.E.:
      Protect"). `uid` is the SOURCE (the printed "this Pokémon" of the terminator);
      `fromClass` is the printed attacker class, a fresh copy (no alias into the state). Not
      persisted (D141). */
  | {
      type: "SIDE_ATTACK_BLOCK_APPLIED";
      seat: Seat;
      uid: string;
      banner: Banner;
      fromClass: AttackerClass;
    }
  /** 🆕🆕🆕 §11 (D575) — the side-wide block ENDED because its source `uid` left `seat`'s
      Active Spot inside the window (the printed *"If this Pokémon is no longer your Active
      Pokémon, this effect ends."*, cleared by `switchInto` — R-MI1). */
  | { type: "SIDE_ATTACK_BLOCK_ENDED"; seat: Seat; uid: string }
  /** 🆕🆕🆕 §6.2/§11 (D575) — the DEFENDING Pokémon `uid` (owned by `seat`) was marked for
      `seat`'s next turn: `barred` — Energy cards can't be attached to it from `seat`'s hand
      (Glimmora "Corrosive Shards"); `endsTurn` — attaching one from hand ends `seat`'s turn
      (Hypno "Daydream"). The MERGED mark after this install. */
  // 🆕🆕🆕 D636 — `counters`: Electrified Incisors' damage counters per Energy card attached from hand (0 when none).
  | { type: "HAND_ATTACH_MARKED"; seat: Seat; uid: string; barred: boolean; endsTurn: boolean; counters: number }
  /** 🆕🆕🆕 §7 (D636) — `seat`'s Trainer plays from hand are flip-locked for its next turn (Seismitoad "Quaking
      Fist", `PlayerSide.trainerFlipLockTurn`). `seat` owns the LOCKED side (HAND_PLAY_BLOCKED's rule). */
  | { type: "TRAINER_FLIP_LOCKED"; seat: Seat }
  /** 🆕🆕🆕 §7 (D636) — the Quaking Fist coin `seat` flipped trying to use the Trainer card `uid` from hand:
      heads, the play goes on; tails, `uid` went from the hand to the discard pile instead (R-QF1). */
  | { type: "TRAINER_FLIP_LOCK_CHECK"; seat: Seat; uid: string; result: CoinFace }
  /** 🆕🆕🆕 §8 (D646) — `seat` used Backtrack Badge `uid` (a Pokémon Tool on its attacking {C} Pokémon): the `count`
      coins just flipped for the attack are ignored and flipped again (the new faces follow as their own coin rows).
      Not persisted (D141). */
  | { type: "COINS_REFLIPPED"; seat: Seat; uid: string; count: number }
  /** 🆕🆕🆕 (D575) — `actor` LOOKED AT the face-down Prize card in slot `index` of `seat`'s
      row (Team Rocket's Blipbug "Searching Eyes"). SLOT-ONLY, and that is the
      confidentiality rule (`DECK_TOP_REORDERED`'s): the log is broadcast to BOTH seats, so
      naming the card here would publish it to the row's owner; the card reaches the looker
      alone, through the `orderCards` park `redactPrompt` resolves for the answerer (R-BL2). */
  | { type: "PRIZE_LOOKED_AT"; seat: Seat; actor: Seat; index: number }
  /** 🆕🆕🆕 §5.3 (D564) — a Supporter SCHEDULED an end-of-turn hand discard (Amarys: *"At
      the end of this turn, if you have 5 or more cards in your hand, discard your hand."*).
      `atLeast` is the printed threshold. The discard itself, when it happens, is the
      shipped `HAND_DISCARDED` row filed by flow.ts's `endTurn` stage. Not persisted (D141). */
  | { type: "HAND_DISCARD_SCHEDULED"; seat: Seat; atLeast: number }
  /** 🆕🆕🆕 §5.3/§8 (D570) — Festival Lead's attack-again window opened: `seat`'s Active
      `uid` may declare a SECOND attack this turn (*"If Festival Grounds is in play, this
      Pokémon may use an attack it has twice."*), or end the turn instead. Filed by flow.ts's
      `resumeTurn` stage, the moment turn:action comes back after the first attack (and
      after any Knock Out it caused has been prized and promoted) — 🆕 D570 third review: and
      only while that declaration is NOT barred (`attackAgainBarred`, R-FL2's re-read), so a
      promotion that silences the licence offers nothing. A new union member
      (D125); not persisted (D141). */
  | { type: "ATTACK_AGAIN_OFFERED"; seat: Seat; uid: string }
  /** 🆕🆕 §13 (D434 as `COUNTERS_SCHEDULED`, RENAMED AND GENERALISED AT D435) — an
      attack SCHEDULED a delayed effect onto `seat`'s Active for the END of
      `scheduled.turn`. Three payloads share the row because they share the clock:
      counters (D434), a DISCARD and a KNOCK OUT (D435). `seat` OWNS the scheduled
      Pokémon, which is the sibling rows' contract above verbatim, so the log row
      renders as a system/passive line rather than in the owner's voice.

      🛑 **IT CARRIES THE WHOLE `ScheduledEffect` RECORD, WHICH IS D421's "SAME FACT,
      SAME SPELLING, EVERY SURFACE" AND NOT A CONVENIENCE.** The op, the persisted
      per-body field and this event now all spell the appointment with the identical
      shape, so a renderer honouring the discard and forgetting the Knock Out is a
      missing `switch` arm rather than a silently mis-worded row. The `turn` inside it
      is D434's field, kept for D434's reason (D421's log rule): a row saying "at the
      end of your next turn" on a schedule with no clock would be a claim this path
      makes untrue the moment the body leaves the Active Spot, and carrying the number
      lets a consumer check the arithmetic against whatever eventually fires.

      ⚠️ **THE FIRING ROW IS NOT ONE ROW BUT THREE, AND THAT IS THE PRIZE DISTINCTION
      REACHING THE LOG.** Counters fire as `COUNTERS_PLACED` with `source: "delayed"`;
      the discard fires as `POKEMON_RETURNED` with `dest: "discard"` and NO prize
      stage; the Knock Out fires as §8.1's own `KNOCKED_OUT` plus a `takePrizes`. A
      match that ends before the Checkup shows this row with no second — which is the
      truth about the board, not a gap. */
  | { type: "EFFECT_SCHEDULED"; seat: Seat; uid: string; scheduled: ScheduledEffect }
  /** §9/§11 (D152) — an attack ARMED a durated REACTIVE RECOIL on the
      CONTROLLER's own Active ("During your opponent's next turn, if this Pokémon
      is damaged by an attack (even if it is Knocked Out), put 10 damage counters
      on the Attacking Pokémon."). `amount` is the HP that will land on whatever
      damages this Pokémon next turn — HP, not counters, because every consumer
      downstream speaks HP and the deriver converted once (effects.ts) — and it is
      on the row for DAMAGE_REDUCTION_APPLIED's reason verbatim: the number IS the
      rule. It is the MERGED number, not the printed one.

      `seat` OWNS THE ARMED POKÉMON (D136's finding 1) and here that is the
      ACTOR's own, exactly as ATTACK_BLOCK_APPLIED's and
      DAMAGE_REDUCTION_APPLIED's are — the op has no defender arm. So the row is
      ACTIVE-voiced and may safely carry the printed "during your opponent's next
      turn", which is the wording D149 could NOT copy because its row renders
      under the victim's name (see log.ts).

      🆕🆕 **D456 — `ofDamageTaken` IS PRESENT WHEN THE ARMED TRAP READS ITS AMOUNT
      OFF THE HIT** (corpus line 180, *"…put damage counters on the Attacking Pokémon
      equal to the damage done to this Pokémon."*, 2 legal printings). `amount` is then
      the FLOOR rather than the whole answer, and `log.ts` has a second arm rather than
      a second row. 🛑 **THE FLAG EXISTS BECAUSE THE ROW WOULD OTHERWISE BE FALSE, NOT
      BECAUSE THE FIELD IS TIDY.** A pure line-180 install carries floor 0, and the
      unwidened row rendered *"…will counterattack for 0 damage during your opponent's
      next turn"* — a claim that a trap does nothing, printed at the exact moment a real
      one is armed. D421's rule (*a log row is a claim with the same standing as a
      predicate*) makes that a defect and not a wording preference, and it is the ONE
      site in this slice that a purely engine-side reading would have missed.

      ⚠️ **IT IS A WIDENING AND MOVES NO `MATCH_RECORD_VERSION` BYTE**: a `GameEvent` is
      not persisted — `MatchRecord.log` holds the RENDERED `SeatLogEntry[]` — so this is
      new TEXT in NEW records only, D141's already-settled case (see match.ts's own
      block, which says exactly this about `RECOIL_ARMED`'s original row).

      No `…_ENDED` twin, for ATTACK_BLOCK_APPLIED's reasons verbatim (a turn stamp
      expires by arithmetic, with no boundary walk to announce it from), and the
      EARLY endings — being Switched out, evolving — are already told by their own
      POKEMON_SWITCHED / POKEMON_EVOLVED row.

      ⚠️ AND NO ROW OF ITS OWN WHEN IT FIRES, WHICH IS THE STRONGEST CASE THIS
      FAMILY HAS MADE FOR THE RULE. The recoil that actually lands is reported by
      COUNTERS_PLACED `source: "counterattack"` — D141's MECHANISM label — and
      that row CANNOT be split by provenance, because `passivesOf`'s catalog fold
      and this installation are SUMMED into one number before the site sees it
      (attack.ts §9). A second row here, or a member on that one, would be a claim
      about which card supplied HP that no longer exists as a distinction. */
  | { type: "RECOIL_ARMED"; seat: Seat; uid: string; amount: number; ofDamageTaken?: true }
  /** §8.5/§11 (D155) — an attack INSTALLED a durated PER-ATTACK DAMAGE BUFF on the
      CONTROLLER's own Active ("During your next turn, this Pokémon's {AttackName}
      attack does {N} more damage (before applying Weakness and Resistance).").
      `amount` is the HP that will be added BEFORE the modifiers, and it is on the
      row for DAMAGE_REDUCTION_APPLIED's reason verbatim: the number IS the rule.
      It is the MERGED number, not the printed one.

      ⚠️ `attack` IS REQUIRED HERE WHERE ATTACK_LOCKED's IS OPTIONAL, AND THAT IS
      D153's test answered by the OP rather than by the path. That event has two
      producers and one of them bars the whole Pokémon, so absence has a meaning
      ("all of it", D135's absent-key rule). This one has a single producer and the
      sentence cannot be printed without naming an attack — a row that said
      "<name> does 100 more damage next turn" would assert something no printing
      makes true, which is exactly the falsehood D154 found in the bare lock
      wording. A field whose absence is unreachable is not optional.

      It carries the printed NAME and not the index the state stores, for
      ATTACK_LOCKED's reason verbatim: a log row is read by a player holding the
      card, so the index is the engine's addressing and the name is the card's. The
      install resolves one to the other once (interpreter.ts).

      `seat` OWNS THE BOOSTED POKÉMON (D136's finding 1) and here that is the
      ACTOR's own — the op has no defender arm — so the row is ACTIVE-voiced, like
      DAMAGE_REDUCTION_APPLIED's and RECOIL_ARMED's and unlike
      ATTACK_DEBUFF_APPLIED's. It still says "next turn" rather than the printed
      "During your next turn", for D148's reason: under this family's seat rule
      that phrase always means the NAMED player's own next turn, which is what the
      `+ 2` stamp encodes. Rendered under both seats and read (D155's suite).

      No `…_ENDED` twin, for ATTACK_BLOCK_APPLIED's reasons verbatim (a turn stamp
      expires by arithmetic, with no boundary walk to announce it from), and the
      EARLY endings — retreating, being Switched out, evolving — are already told
      by their own POKEMON_SWITCHED / RETREATED / POKEMON_EVOLVED row.

      AND NO ROW OF ITS OWN WHEN IT FIRES. A buff that actually lands is reported
      by `DAMAGE_DEALT.bonus` on the very hit it grew — the field that has carried
      "what the attacker's continuous effects added before the modifiers" since
      Vitality Band — which names the FACT and not the source, exactly as
      `reduction` and `debuff` do for the other two directions (D140/D146:
      loudness is owed to UNREAD TEXT, not to a read rule doing its job).
      🆕🆕 D544 — the BASE-SET mode lands the same way, in the field that already
      names it: `DAMAGE_DEALT.base` reads the override (240), not the printed base.

      🆕🆕 D544 — `base?: true`: the row announces a BASE-SET install ("…Hyper Fang
      attack's base damage is 240."), and `amount` then carries the BASE number, not
      a bonus. Without the key `log.ts` would render "does 240 more damage next
      turn", which is FALSE (D421: a row whose wording is a claim owes the rider).
      A WIDENING — a `GameEvent` is not persisted (`MatchRecord.log` holds the
      RENDERED `SeatLogEntry[]`, D141) — and written only on base installs.

      🆕🆕🆕 D546 — `attack: string | null`: `null` announces an ALL-ATTACKS install
      ("During your next turn, attacks used by this Pokémon do 120 more damage to
      your opponent's Active Pokémon …", `censusAttackCorpus.ts:148`/`:76`), which
      names no attack. `log.ts` renders it "'s attacks do N more damage next turn";
      the named wording would be FALSE of it (D421), and a template literal would
      print the word "null" — a site `tsc` cannot see, pinned by a log rung and a
      mutant. A widening of a non-persisted event (D141).

      🆕🆕🆕 D563 — `thisTurn?: true`: the install is stamped for the CURRENT turn
      (Feraligatr "Torrential Heart", *"during this turn, attacks used by this Pokémon do
      120 more damage …"*), so `log.ts` says "this turn" — "next turn" would be FALSE of
      it (D421). Written only on this-turn installs; a widening of a non-persisted event
      (D141). ⚠️ *"the op has no defender arm — so the row is ACTIVE-voiced"* still holds,
      but the boosted body is now the SOURCE body when the op carries `holder: "source"`
      (possibly Benched), and `uid` names it. */
  | {
      type: "ATTACK_BOOSTED";
      seat: Seat;
      uid: string;
      attack: string | null;
      amount: number;
      base?: true;
      thisTurn?: true;
    }
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
  /** §11 (D259) — a played Item or Supporter's effect refused by the TARGET's own
      continuous Ability (Fraxure "Unnerve", Cetitan ex "Snow Camouflage",
      Rhyperior "Wide Wall"). `uid` is the SHIELDED body's top card and `seat` is
      the side that owns it, exactly as in `ATTACK_EFFECT_PREVENTED` above.

      ⚠️ A SEPARATE MEMBER RATHER THAN A FIELD ON THAT ROW, AND THE LOG IS THE
      REASON. That row renders "… prevented the effect of the attack"; nothing was
      attacking here, and a `source` discriminator on one member would make the
      rendered sentence a runtime branch on a row whose text has been fixed since
      D142. Two printed situations, two rows, one funnel behind both — the same
      split `DAMAGE_DEALT.prevented` deliberately does NOT make, because there the
      FACT is identical and here the CAUSE is what the player needs read back.

      `trainerType` is on the row because the shielded player's question is which
      of their opponent's cards just did nothing, and because the two sentences in
      this family disagree about exactly that: Rhyperior refuses Supporters only.
      New text in NEW records only — D141's settled case, so `MATCH_RECORD_VERSION`
      does not move for it. */
  | {
      type: "TRAINER_EFFECT_PREVENTED";
      seat: Seat;
      uid: string;
      trainerType: "item" | "supporter";
    }
  /** 🆕🆕🆕 §11 (D614) — the ABILITY channel's row: an effect of the opponent's Pokémon's Ability was
      refused by the shielded body's own Ability (Mega Clefable ex "Luminous Wing"). `uid` / `seat`
      as in `TRAINER_EFFECT_PREVENTED` above, and a separate member for that row's log reason. New
      text in NEW records only (D141), so `MATCH_RECORD_VERSION` does not move. */
  | { type: "ABILITY_EFFECT_PREVENTED"; seat: Seat; uid: string }
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
        | "counterattack"
        // 🆕🆕 D434 — counters an attack SCHEDULED a turn earlier and the §13 Checkup
        // is placing now. A PROVENANCE label like "attack" rather than a mechanism
        // label like "counterattack": the amount has exactly one source (the printed
        // sentence that armed it) and the EFFECT_SCHEDULED row a turn back names
        // it. It is NOT `"attack"`, because that member's log row renders inside the
        // attack's own resolution and this one lands between turns, next to Poison.
        | "delayed"
        // 🆕🆕🆕 D557 — counters an ITEM put on a body: Team Rocket's Venture Bomb
        // `sv10-179`, heads (`damageChosen`, on 1 of the opponent's Pokémon) and tails
        // (`damageSelf`, on the player's own Active). A PROVENANCE label like `"attack"`
        // and `"delayed"`, and the no-bump reading is D434's for `"delayed"` (the member
        // landed beside a `MATCH_RECORD_VERSION` bump that paid for the REQUIRED
        // `InPlayPokemon.scheduledCounters` field, never for the member) together with
        // this block's own rule above: a member is a WIDENING of the enum, and events are
        // rendered into `record.log` rows rather than persisted (DECK_TOP_REVEALED's
        // note). `seat` owns the damaged body, as for every member.
        | "trainer";
    }
  /** A §13 Checkup recovery flip for `seat`'s Active: burn's cure flip
      (§13.2) or asleep's wake flip (§13.3). Heads is followed by the
      matching STATUS_CLEARED; tails, the condition stays. */
  | { type: "CHECKUP_COIN_FLIP"; seat: Seat; status: "asleep" | "burned"; result: CoinFace }
  /** The §8 step-3 confusion flip for the declared attack — tails is
      followed by ATTACK_FAILED, heads by the normal resolution. */
  | { type: "CONFUSION_CHECK"; seat: Seat; uid: string; result: CoinFace }
  /** 🆕🆕🆕 §8 (D547) — the FLIP-TO-ATTACK lock's coin for the declared attack,
      CONFUSION_CHECK's sibling at the same seam: tails is followed by
      ATTACK_FAILED `"flipLock"`, heads by the normal resolution. `seat` is the
      DECLARING seat — the printed "your opponent flips a coin" names the locked
      Pokémon's controller, who is the attacker here. Filed only while the lock is
      live (`attackFlipLocked`), so no rng is spent on an unlocked declaration; and
      BEFORE any CONFUSION_CHECK — the official rulebook's "Full details of
      attacking" applies "effects that might alter or cancel the attack" (step B)
      before the Confusion check (step C), so a lock tails files no
      CONFUSION_CHECK at all (docs/decisions.md D547 ruling 1). */
  | { type: "ATTACK_FLIP_LOCK_CHECK"; seat: Seat; uid: string; result: CoinFace }
  /** The declared attack did NOT resolve: no damage to the defender, no
      effects — and the turn still ends [🆕🆕🆕 D570 (D539): or, after a FIRST attack under Festival Lead with Festival Grounds in play, the attack-again window opens instead (flow.ts `finishAttack`) — a failed or cancelled attack is still an attack that was USED] either way. Three reasons, and they differ
      only in what follows:
        • "confusion" — §12, the step-3 flip came up tails; the self-damage
          follows as COUNTERS_PLACED. 🆕🆕 **CORRECTED AT D501, WHICH FALSIFIED IT.**
          This line read *"the 30 self-damage"* from P3-M3 until D501 made the
          amount a per-body field (`SpecialConditions.confusionDamage`), so the row
          that follows now carries whatever the inflicting effect printed — 30 on
          every board a bare Confusion reaches, and 80 on the one printing that
          raises it. The ROW was never wrong (it reads `event.amount`); only this
          sentence was, which is D450's *grep every consumer for the REASONS it
          asserts* at a second address.
        • "requirement" — D125, the attack's printed "If <clause>, this attack
          does nothing." and the clause held (Palafin "Justice Kick" without the
          promotion, Lycanroc "Finishing Fang" into an undamaged Active). Nothing
          follows; the attacker is untouched.
        • "coinFlip" — D126, the attack's printed "Flip a coin. If tails, this
          attack does nothing." came up tails. PRECEDED by the
          ATTACK_EFFECT_COIN_FLIP that announces the face, and followed by
          nothing; the attacker is untouched.
        • 🆕🆕 "preDamage" — D429, the attack's printed pre-damage act had nothing to
          do and the sentence says so: "Before doing damage, discard all Pokémon
          Tools from this Pokémon. If you can't discard any, this attack does
          nothing." (1 legal printing). Nothing follows and nothing PRECEDES either —
          the silent-no-op rule means no TOOLS_DISCARDED row is filed on this path,
          so this row is the whole of what a reader is told, which is why it is a
          FOURTH reason rather than a reuse of "requirement". The two are genuinely
          different facts: "requirement" is a BOARD condition read before the attack
          did anything, this one is the RESULT of an act the attack already performed.
      Each widening is a WIDENING of the reason enum, not a shape change — no
      MATCH_RECORD_VERSION bump for any of them (see match.ts's own doc block);
      a record written by an older deploy stays readable, it simply never carries
      the newer reasons. */
  | {
      type: "ATTACK_FAILED";
      seat: Seat;
      uid: string;
      /** 🆕🆕🆕 D547 — `"flipLock"`: the FLIP-TO-ATTACK lock's coin came up tails
          ("If tails, that attack doesn't happen."). PRECEDED by its own
          ATTACK_FLIP_LOCK_CHECK row and followed by nothing — no counters, no
          damage; the turn ends [🆕🆕🆕 D570 (D539): or, after a FIRST attack under Festival Lead with Festival Grounds in play, the attack-again window opens instead (flow.ts `finishAttack`) — a failed or cancelled attack is still an attack that was USED]. A free widening of this enum (above). */
      reason: "confusion" | "requirement" | "coinFlip" | "preDamage" | "flipLock";
    }
  /** Damage removed from one of `seat`'s IN-PLAY Pokémon by an effect; `amount`
      is what actually came off (clamped at the damage present — never 0), so a
      whiff on an undamaged body emits nothing at all. The Active is only the
      commonest `uid`, not the only one: `healEach`, `healChosen` (D135) and the
      counter move (D138) all reach the Bench. `amount` is what MOVED, never what
      was printed — the half a log-only implementation gets wrong. */
  | { type: "HEALED"; seat: Seat; uid: string; amount: number }
  /** An attack effect's own "Flip a coin. If heads, …" gate (effects.ts):
      heads runs the gated steps, tails skips them. `seat` is the seat that
      flipped: the attacker, except that `opponentPerTails` files under the
      opponent (D550). ~~`seat` is the attacker.~~ — withdrawn at D550 (D539):
      *"Your opponent flips a coin for each of their Benched Pokémon."* is
      flipped by the defending seat, and its rows say so, after D547's
      `ATTACK_FLIP_LOCK_CHECK` precedent above. */
  | { type: "ATTACK_EFFECT_COIN_FLIP"; seat: Seat; result: CoinFace }
  /** §8.1 — `seat`'s `uid` was Knocked Out: the whole stack (evolution
      cards, energy, tools) left play for `seat`'s discard; `discarded` lists
      every uid that moved, in pile order.
      🆕🆕🆕 D572 — `toHand` is the OPTIONAL split (Huntail "Diver's Catch"): the Basic {W}
      Energy that went to `seat`'s HAND instead, and then `discarded` lists only what reached
      the pile (the two partition the stack). ABSENT on every other Knock Out (D135), so those
      rows are byte-identical; `GameEvent` is not persisted (D141), so no record moves.
      [🆕🆕🆕 D598 (D539): *"the Basic {W} Energy that went to `seat`'s HAND"* is WITHDRAWN as the
      whole of `toHand`, kept as written — Gengar "Infinite Shadow" puts the Pokémon's own `stack`
      there too (its Energy and Tools stay in `discarded`); log.ts `koToHandTail` counts each kind.] */
  | { type: "KNOCKED_OUT";seat: Seat; uid: string; discarded: string[]; toHand?: string[] }
  /** `seat` owes a prize pick (which face-down cards, §8.1) — announced when
      the game parks on ko:takePrizes so an event-only client never hangs on
      an unseen prompt. Forced picks resolve straight to PRIZES_TAKEN.
      🆕🆕🆕 D548: *"face-down cards"* is PARTLY false — the pick is over the WHOLE row, and a
      slot in `PlayerSide.faceUpPrizes` is pickable too (see `PRIZES_TAKEN` below). */
  | { type: "PRIZES_OWED"; seat: Seat; count: number }
  /** `seat` took face-down prizes into hand. `indices` are the slots picked
      (the prize row compacts like the bench); full-information like every M1
      event — hiding the uids from the opponent is P4's filter. 🆕🆕🆕 D548: a picked
      slot may be a FACE-UP one (`PlayerSide.faceUpPrizes`); the event is unchanged and
      the LOG stays count-only for every take — see `PRIZE_TURNED_FACE_UP`. */
  | { type: "PRIZES_TAKEN"; seat: Seat; uids: string[]; indices: number[]; remaining: number }
  /** 🆕🆕🆕 D548 — `seat` turned the prize at slot `index` (uid `uid`) FACE UP, the cost of
      Cresselia `sv06.5-021` "Crescent Purge" (`turnPrizeFaceUp`). The card is PUBLIC from
      this moment (it rides `RedactedSide.faceUpPrizes` for both seats and spectators), so
      the log NAMES it. `PRIZES_TAKEN` stays COUNT-ONLY on purpose, even for a face-up take:
      the log row describes the move to a hand the other player must not read, and one
      wording for every take keeps it from telling a face-up take from a face-down one by
      its shape. Not persisted (D141).
      🆕🆕🆕 D567 — `actor`: Team Rocket's Bother-Bot turns the OPPONENT's prize, so `seat` stays
      the ROW's owner and `actor` names the controller who turned it — present ONLY when the two
      differ (spread-when-present, D135), so every D548 row is byte-identical. A D125 widening. */
  | { type: "PRIZE_TURNED_FACE_UP"; seat: Seat; index: number; uid: string; actor?: Seat }
  /** 🆕🆕🆕 D567 — Redeemable Ticket `sv09-156`: `seat`'s `count` Prize cards were shuffled
      and put under their deck, and `count` new cards from the deck top became the (face-down)
      prize row. Names NO uid on purpose — every card on both rows is hidden (a uid would let a
      client follow a hidden card across zones, redact.ts' rule), and `faceUpPrizes` is emptied.
      A new union member (D125); not persisted (D141). */
  | { type: "PRIZES_CYCLED"; seat: Seat; count: number }
  /** 🆕🆕🆕 D567 — Team Rocket's Bother-Bot's *"You may have your opponent switch those
      cards."*: in `seat`'s prize row, slot `index` held `prizeUid` (face up — this card turned
      it) and now holds `handUid` (the card revealed from `seat`'s hand), still FACE UP (R-BB1);
      `prizeUid` went into `seat`'s hand. `actor` is the controller. Both uids are PUBLIC — one
      was a face-up prize, the other was just revealed — so the log names both. A new union
      member (D125); not persisted (D141). */
  | {
      type: "PRIZE_SWITCHED_WITH_HAND";
      seat: Seat;
      actor: Seat;
      index: number;
      prizeUid: string;
      handUid: string;
    }
  /** `seat` must promote a benched Pokémon into the empty Active spot
      (§8.1) — the ko:promote prompt twin of PRIZES_OWED. */
  | { type: "PROMOTION_REQUIRED"; seat: Seat }
  /** `uid` (top of its stack) moved bench → Active; the vacated bench slot
      closes up. */
  | { type: "POKEMON_PROMOTED"; seat: Seat; uid: string; benchIndex: number }
  // — M4 Trainer / Ability plays (§7/§9) and the effect ops they run (§15). —
  /** `seat` played a Trainer `uid` from hand. Where the card LANDS follows
      its `trainerType`: an Item/Supporter discards after its effect resolves,
      a Stadium moves into the shared stadium zone (§7.3 — a replaced
      predecessor announces its own STADIUM_DISCARDED). Tools are not played
      through this event — attaching is TOOL_ATTACHED.
      (🆕🆕🆕 D576 (D539): ~~"an Item … discards after its effect resolves"~~ is no longer every
      Item — an Antique Fossil (`trainerType: "Item"`) lands on the BENCH, and its arrival is the
      `POKEMON_BENCHED` filed right after this one, R-FO1.) */
  | { type: "TRAINER_PLAYED"; seat: Seat; uid: string; trainerType: string }
  /** §7.4 — `seat` attached the Pokémon Tool `uid` from hand to their own
      in-play Pokémon at `target`. It stays attached (rides the stack through
      evolution, discards with a KO'd stack) — there is no detach in scope. */
  | { type: "TOOL_ATTACHED"; seat: Seat; uid: string; target: PokemonTarget }
  /** 🆕🆕 **D428 — §7.4/§8: every POKÉMON TOOL attached to `seat`'s ACTIVE left
      play for `seat`'s OWN discard pile, driven by an attack's printed
      *"Before doing damage, discard all Pokémon Tools from your opponent's Active
      Pokémon."*** — the first detach this engine has that is not a Knock Out
      (`TOOL_ATTACHED`'s own note above says "there is no detach in scope", and this
      row is that sentence expiring).

      `seat` is the OWNER whose board lost the cards, `actor` is the controller
      whose card caused it — `ENERGY_DISCARDED`'s convention, and the two are
      OPPOSITE for every printing that exists today. `log.ts` files the row under
      the ACTOR. A Tool goes to its own controller's pile (§7.4), never the
      attacker's, which is why the two seats cannot be collapsed.

      `host` is the stripped Pokémon's TOP-CARD uid, and it is what a consumer must
      name it by, for `ENERGY_DISCARDED`'s reason verbatim: the same attack's damage
      can Knock that body Out in the SAME batch, so resolving a spot against the
      post-state yields "the Active spot".

      ⚠️ NEVER EMITTED FOR AN EMPTY `uids` — a defender with no Tool is a silent
      no-op, exactly as `HEALED` is never filed at 0.

      🆕🆕🆕 **D543 RE-POINTED THE PARAGRAPH ABOVE RATHER THAN REWRITING IT, AND THE
      PRE-DAMAGE REASON IS KEPT VERBATIM BECAUSE IT IS STILL TRUE OF ITS OWN ROW**
      (D178/D418). Everything said above describes the `when: "preDamage"` row
      exactly as it always did; what moved is that this event now has a SECOND
      producer (🆕 D562, annotated in place per D539: and now a THIRD, the
      `when: "consumed"` self-discard of a consumable Tool — see `when` below;
      the `seat`/`actor`/`host`/empty-`uids` rules hold of it too, with
      `seat === actor`). D543's `discardTools` op fires the same row at the PROGRAM TAIL,
      from an attack's printed *"Discard up to 2 Pokémon Tools from your
      opponent's Pokémon."* — so `seat` is still the OWNER whose board lost the
      cards, `actor` still the controller whose card caused it, `host` still a
      single top-card uid (which is why a multi-host answer emits ONE ROW PER HOST
      and the field needs no widening), and the empty-`uids` rule still holds.

      🛑 **`when` IS REQUIRED, AND THAT IS THE WHOLE POINT OF ADDING IT.** An
      optional field defaulting to the pre-damage meaning would have let the NEW
      producer inherit the OLD row's wording in silence — `log.ts` hard-codes
      *"before doing damage"* on this row, and a tail discard rendered with that
      tail would be a log that LIES about when it happened while the board is
      identical (`D543-event-when-flipped` is the declared row, and it moves no
      board at all). REQUIRED makes `tsc` name the one pre-existing emit site
      (`attack.ts`'s pre-damage hook) instead, so the old meaning is re-declared by
      hand. D421's rule: a log row is a claim with the same standing as a predicate.

      ⚠️ WIDENING THIS UNION OWES NO `MATCH_RECORD_VERSION` BUMP: `GameEvent` is not
      persisted at all (`MatchRecord` stores the RENDERED `SeatLogEntry[]`), so this
      is a row-wording seam for NEW rows only — and that sentence is quoted rather
      than re-argued at D543, since the tree already says it here. */
  | {
      type: "TOOLS_DISCARDED";
      seat: Seat;
      actor: Seat;
      uids: string[];
      host: string;
      /** 🆕 D543 — WHEN in the attack this happened, because the row's own wording
          depends on it: `"preDamage"` is D428's §8 hook (the row reads *"… before
          doing damage"*, and it is pushed in FRONT of the §8.5 `DAMAGE_DEALT` it
          precedes, so the claim is one this path makes true); `"effect"` is D543's
          program-tail `discardTools`, after the damage, where that tail would be
          false.

          🆕🆕🆕 **D562 — `"consumed"`, A THIRD PRODUCER.** A consumable Tool discarding
          ITSELF because its own printed effect just paid (a type Berry after the hit it
          reduced, a Survival Brace after the clamp, a Deluxe Bomb after its counters —
          *"… and discard this card."*). `seat === actor` (the card's owner discards it),
          and the row is pushed AFTER the `DAMAGE_DEALT` / `COUNTERS_PLACED` it follows,
          so neither of the other two wordings would be true of it: it is not "before
          doing damage", and it is not the attack's effect. A NEW member rather than a
          reuse, for the field's own D543 reason (a reused member inherits a tail that
          lies). A union widening on an unpersisted event (`GameEvent` is not in
          `MatchRecord`), so `MATCH_RECORD_VERSION` stays 35.
          🆕🆕🆕 **D643 — `"trimmed"`, A FOURTH PRODUCER**: Multi Adapter's trim (interpreter.ts `trimToolsApply`) —
          the OWNER discarding down to the cap once the Ability went away (`seat === actor`). Unpersisted, so no
          version moves for it. */
      when: "preDamage" | "effect" | "consumed" | "trimmed";
    }
  /** §7.3 — the Stadium `uid` left play for its OWNER `seat`'s discard pile,
      replaced by a different-named Stadium (whose own TRAINER_PLAYED rides in
      the same batch).
      🆕🆕🆕 Card revision B22 — `cause`, because that is no longer the only way out:
      `"replaced"` is `playStadium`'s replace path (cardplay.ts), `"effect"` is the
      `discardStadium` op (interpreter.ts — Wreck, Somersault Dive, Ground Melter,
      World Ender, Blazing Destruction, …), which leaves the zone EMPTY. The log read
      every row as "replaced" before. Unpersisted (`GameEvent` is not in
      `MatchRecord`), so no record version moves for it. */
  | { type: "STADIUM_DISCARDED"; seat: Seat; uid: string; cause: "replaced" | "effect" }
  /** 🆕🆕🆕 §7.3 (D577) — Area Zero Underdepths' TRIM: `seat` discarded the Benched Pokémon
      `uids` (their TOP cards, in Bench order) with every attached card (`discarded`, the
      whole pile that went to `seat`'s discard pile) to get back to 5 — no Knock Out, no Prize
      (R-AZ5). Filed under the OWNER: they chose (R-AZ4). Never emitted for an empty pick. */
  | { type: "BENCH_TRIMMED"; seat: Seat; uids: string[]; discarded: string[] }
  /** 🆕🆕🆕 D577 — Tyme: `seat` told the opponent the NAME of a Pokémon in their hand (public;
      the card itself stays face down — no uid, no HP, R-TY3). */
  | { type: "POKEMON_NAMED"; seat: Seat; name: string }
  /** 🆕🆕🆕 D577 — Tyme's REVEAL: `seat`'s named card `uid` prints `hp` (null: no printed HP);
      the opponent guessed `guess`, `right` or not, and `drawer` draws (the opponent when right,
      `seat` when wrong). Public — the card is revealed. */
  | { type: "HP_GUESSED"; seat: Seat; uid: string; guess: number; hp: number | null; right: boolean; drawer: Seat }
  /** 🆕🆕🆕 D580 — Mr. Mime "Look-Alike Show": `seat` (the ATTACKER) used the effect of the
      Supporter `uid` found in the opponent's revealed hand as the effect of the attack. The card
      does not move (R-LA1). Public — the hand was revealed. Not persisted (D141).
      🆕🆕🆕 D638 — `milled`: Ninetales "Supernatural Shapeshifter" used a Supporter it discarded from the top of
      its controller's deck (absent: Look-Alike Show). */
  | { type: "SUPPORTER_EFFECT_USED"; seat: Seat; uid: string; milled?: true }
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
      destination from the op.
      🆕🆕🆕 D561 — `"deckTop"` (Academy at Night) puts them ON TOP of the deck,
      hidden → hidden like `"deckBottom"`; and `"deckBottom"` is now also Perrin's
      declinable reveal-and-return, whose printed "Reveal" is NOT rendered per card —
      the log still counts (R-PR; reversal: a per-seat event filter, P4, that shows
      the revealed uids to both seats). */
  | {
      type: "HAND_COST_PAID";
      seat: Seat;
      uids: string[];
      to: "discard" | "deckBottom" | "deckTop";
      /** 🆕🆕🆕 D611 — `payFromHand.swapWithTop` (Evidence Gathering): the old TOP card of the
          deck, which went into the hand as the paid card went on top. Hidden → hidden like the
          payment, so the log counts it. Absent on every other payment. */
      took?: string[];
      /** 🆕 Card revision B36 — an ATTACK's program paid it (`ctx.invokedBy === "attack"`): Skarmory
          "Steel Cutter" / Mawile "Double Eater" *"Discard up to 2 … Energy cards from your hand, and
          this attack does …"*, Klefki "Stick 'n' Draw" *"Discard a card from your hand. If you do, …"*.
          No attack sentence prints a cost — the discard is the attack's EFFECT — so the log drops
          "to pay a cost" on this row. Absent (D135) on every Trainer / Ability payment, which IS the
          printed cost. Events are not persisted (no record bump). */
      effect?: true;
    }
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
  /** §8.1 — an on-KO Ability REDUCED (rather than denied) the Prize card(s) for
      `seat`'s Knocked Out `uid` (Munkidori ex "Oh No You Don't": "your opponent
      takes 1 fewer Prize card"). `by` is how many fewer and `count` is what the
      opponent still takes, so the row can state both without the reader doing the
      subtraction. A SEPARATE row from PRIZE_PREVENTED because a decrement is not a
      denial: on an ex this is 2 → 1, and telling a player "no Prize card is taken"
      while they take one is simply false. Follows the ABILITY_TRIGGERED row that
      names the Ability; the takePrizes stage is queued with the reduced count. */
  | { type: "PRIZE_REDUCED"; seat: Seat; uid: string; by: number; count: number }
  /** 🆕 §8.1 (D323) — a SEAT-WIDE Ability on the PRIZE-TAKING side added Prize
      cards for `seat`'s Knocked Out `uid` (Togekiss "Wonder Kiss" heads, Hydreigon
      ex "Greedy Eater"). `seat` names the side that LOST the Pokémon, exactly as
      PRIZE_REDUCED and PRIZE_PREVENTED do, so the three rows agree on whose corpse
      they are describing; `by` is how many extra and `count` is the new total.

      🛑 **A SEPARATE ROW FROM PRIZE_REDUCED RATHER THAN A SIGNED `by`.** The two
      are printed by opposite players about the same Knock Out — a reduction is the
      DYING side's own Ability defending itself, a bonus is the KILLING side's
      Ability pressing its advantage — and one row with a sign would leave the log
      unable to say which of them acted. Follows the ABILITY_TRIGGERED row (and,
      for Wonder Kiss, the ABILITY_COIN_FLIP row) that names the Ability and the
      body carrying it.

      🆕🆕🆕 **D549 — AND NOT ONLY AN ABILITY ANY MORE (the *"SEAT-WIDE Ability"* and
      *"Follows the ABILITY_TRIGGERED row"* above are WITHDRAWN as a description of
      EVERY row, D539; true of the two Ability sources still).** The attack-installed
      KNOCK OUT BOUNTY (*"During your next turn, if the Defending Pokémon is Knocked
      Out, take 2 more Prize cards."*, `censusAttackCorpus.ts:149`) files this row
      with NO ABILITY_TRIGGERED in front of it: the source was named when it was
      INSTALLED (`KO_BOUNTY_APPLIED`), and the bonus is paid by the rules, not by a
      body acting now. Same shape, same seat rule (`seat` lost the Pokémon), same
      `by`/`count` — the bounty's row follows the seat bonuses' rows, in the order
      `koPrizeBonus` adds them. */
  | { type: "PRIZE_BONUS"; seat: Seat; uid: string; by: number; count: number }
  /** The controller's whole hand went to the discard (Professor's Research). */
  | { type: "HAND_DISCARDED"; seat: Seat; uids: string[] }
  /** 🆕🆕 D426 — `seat` discarded `uids` from their OWN hand because the OTHER
      player's card told them to, and **`seat` is the player who CHOSE them**
      (*"Your opponent discards 2 cards from their hand."*).

      🛑🛑 **D485 — THE CLAUSE ABOVE IS NO LONGER TRUE OF EVERY PRODUCER, AND IT IS
      CORRECTED IN PLACE RATHER THAN REWRITTEN (D178/D442).** `discardFromOpponentHand`
      files this row too, and under it **nobody chose anything**: *"Discard all Item
      cards and Pokémon Tool cards you find there."* names a PREDICATE, so the board
      picks the cards and neither seat is asked. ⚠️ **THE ROW'S SHAPE AND ITS FILING
      ARE UNCHANGED, AND THAT IS THE POINT** — everything the paragraph below argues
      (`seat` is the owner, the destination is the owner's own pile, there is no
      second seat for a segment to name, the LOG speaks in counts) is true of BOTH
      producers, and only the sentence about WHO CHOSE is producer-specific. A row
      that had derived a chooser would have had to be split; this one does not, which
      is the reason the D426 shape absorbed a second producer for free. **The
      condition that would buy an `actor` is still the one stated below**, and it is
      now closer: two producers, one of which HAS a distinct causer.

      🛑 **THE ROW IS FILED UNDER THE DISCARDER AND NAMES NO ACTOR, WHICH IS WHERE
      THIS EVENT DIFFERS FROM EVERY OTHER CROSS-SEAT MOVE IN THIS FILE.**
      `RANDOM_CARD_TAKEN` and `CARD_TO_BOTTOM_OF_DECK` carry both `seat` (the
      zone's owner) and `actor` (whose card did it) because the ACTOR reached
      across the table and moved the card; the log then files them under `actor`
      and names the owner outright. Nobody reaches across the table here — the
      owner picked their own cards out of their own hand and put them in their own
      pile — so the active voice under `seat` is the true one and there is no
      second seat for a segment to name. `HAND_REVEALED`'s rule ("filed under the
      REVEALING seat, not the actor whose card caused it — the ATTACK_DECLARED row
      directly above names the cause"), reached by a different road.

      ⚠️ **SO THERE IS NO `actor` FIELD, AND THE CONDITION THAT WOULD BUY ONE IS
      STATED RATHER THAN LEFT TO BE GUESSED (D422).** It is owed the moment a
      consumer needs to name the causer — and a consumer that reaches for it must
      NOT write `otherSeat(event.seat)`, which is true of this op only because the
      op is cross-seat by construction. That is precisely the closed-world shape
      D425 found on `DAMAGE_DEALT`, and the whole point of not shipping a derived
      seat is that nothing can derive one from a row that does not mention it.

      ⚠️ **DISTINCT FROM `HAND_DISCARDED` DESPITE THE IDENTICAL SHAPE.** That row is
      the controller's WHOLE hand going at once (Professor's Research) and speaks
      in the first person about a player's own play; this is a PARTIAL discard
      imposed from the other side of the table. Two rows rather than one flag, for
      `PRIZE_REDUCED`/`PRIZE_BONUS`'s reason: one row with a rider would leave the
      log unable to say which of the two things happened.

      The LOG speaks in COUNTS (log.ts), like every card leaving the hidden hand —
      `HAND_COST_PAID`'s convention, and its `to: "discard"` arm is this exact
      journey. ~~The cards do land face up in the §2 public pile, so a curious player
      reads them off the pile rather than off the row.~~

      🆕🆕🆕 **D542 — `to` ARRIVES, AND THE SENTENCE STRUCK OUT ABOVE IS THE ONE
      THING THIS BUILD FALSIFIES.** *"Your opponent chooses 3 cards from their hand
      and shuffles those cards into their deck."* fills this row's second
      destination: the owner still picks their own cards out of their own hand, but
      they land in a HIDDEN, about-to-be-shuffled deck and **no player can read them
      off any pile**. The struck sentence stays because of what it CAUGHT (D418) —
      it is the reason the LOG ROW IS A COUNT, and that verdict is unchanged for
      both arms. What it can no longer do is JUSTIFY `uids`.

      🛑 **SO THE JUSTIFICATION FOR `uids` IS RE-POINTED RATHER THAN THE FIELD
      DROPPED, AND THE NEW ONE IS A WIRE FACT RATHER THAN A BOARD FACT.** Raw
      `GameEvent`s never cross the wire: `logFromEvents` runs SERVER-SIDE
      (`lobbyDO.ts`, `match.ts`) and the LOG is what is broadcast, so `uids` here is
      read by the log builder and by nothing a player holds. That is what keeps the
      deck arm honest — **provided the log row stays a COUNT and names the deck**,
      which `D542-log-row-says-discard` is the declared row for. A consumer that
      ever renders these uids client-side on the `"deck"` arm is publishing a hidden
      zone; that condition (D422) is stated here rather than left to be re-derived.

      🛑 **WHY THIS IS A WIDENING AND NOT A SECOND ROW — THE REFUSAL BELOW IS
      ABOUT A DIFFERENT AXIS AND WAS READ BEFORE IT WAS SET ASIDE.**
      `CARD_DISCARDED_FROM_HAND`'s block (D445) refuses widening this row for the neighbouring
      row on VOICE: *"The card is CHOSEN from across the table rather than picked by
      its owner, so the active voice belongs to the actor … Widening
      `FORCED_HAND_DISCARD` would have given one event two voices."* **This row's
      voice is IDENTICAL to this event's**: the owner picks, out of their own hand,
      into their own zone, with no `actor` to name — every clause of the block above
      about seats and about the absent `actor` field is as true of the deck arm as
      of the discard one. Only the DESTINATION differs, and destination is the axis
      this file widens ON ONE ROW, twice: `RANDOM_CARD_TAKEN` carries
      `to: "discard" | "deck"` on one voice, and `POKEMON_RETURNED` carries a
      three-valued `dest`. `HAND_COST_PAID` carries a `to` on a hand event already.

      ⚠️ **THE REAL COUNTER-ARGUMENT IS THE NAME, AND IT IS RECORDED RATHER THAN
      WAVED OFF.** `FORCED_HAND_DISCARD` names a deck move *discard*. It is
      accepted for the reason the OPS in this very family already accept it —
      `randomFromOpponentHand` and `bottomFromOpponentHand` both name the zone the
      cards LEAVE in the identifier and let a FIELD say where they land — because the
      name fixes the zone the cards LEAVE, which is the hand on both arms, and because the
      alternative is two rows that agree on seat, voice, shape and count and differ
      in one prepositional phrase. `PRIZE_REDUCED`/`PRIZE_BONUS` were split for the
      opposite reason (*"one row with a rider would leave the log unable to say
      which of the two things happened"*); here the rider is exactly what lets the
      log say.
      🆕 **THAT CLAUSE IS A RE-SCOPE, AND THE SPELLING IT REPLACES IS WITHDRAWN
      RATHER THAN SILENTLY RETYPED (D539).** It first read ~~*"`randomFromOpponentHand.to`
      and `bottomFromOpponentHand.dest` both name one destination in the identifier and
      carry others"*~~. MEASURED at the two addresses: TRUE of `bottomFromOpponentHand`,
      whose identifier says *bottom* while `effects.ts:10809` declares
      `dest?: "bench" | "discard"` — so it is the STRONGER case, carrying a destination
      in the name and overriding it in the field — and FALSE of `randomFromOpponentHand`,
      whose identifier names a SELECTION MODE over a SOURCE zone and no destination at
      all (`effects.ts:10961`: `to: "discard" | "deck"`, REQUIRED — the very spelling
      the paragraph in `effects.ts` declares refused for THIS op). (🆕🆕🆕 D567 NOTE
      (D539): that quote is DATED — the union is now THREE-valued, `to: "discard" |
      "deck" | "reveal"` with an optional `recordAs`, declared at `effects.ts:12430` at
      D567, and every `effects.ts:` line number in this paragraph is as measured when it
      was written. Still REQUIRED, and the identifier still names no destination
      (`"reveal"` moves no card — Bother-Bot's card STAYS in the hand), so the
      re-scope is unchanged by the third value.) The conclusion the
      pair was cited for is UNCHANGED, because the axis they really share is the one
      stated above and at `effects.ts:11064-11071`. ⚠️ **THIS ADDRESS IS THE ONE THE
      WITHDRAWAL'S FIRST SWEEP MISSED** — the correction landed in `effects.ts`,
      `index.ts` and `progress.md` and not here, which is exactly the failure D539's
      rule exists to prevent: a withdrawn claim is SWEPT, never corrected only where it
      was noticed.
      **THE CONDITION THAT WOULD REVERSE IT** (D422): a third destination
      that is neither owner-zone nor owner-picked — at that point the name is
      carrying two axes and the row should split.

      **ABSENT MEANS THE DISCARD PILE**, a positive statement about every pre-D542
      row rather than a default, exactly as `POKEMON_RETURNED.attachmentsTo` reads.
      🛑 **NO SHUFFLE EVENT IS IMPLIED BY `to: "deck"`** — the op emits a real
      SHUFFLE row after this one, as `RANDOM_CARD_TAKEN`'s deck arm and
      `POKEMON_RETURNED`'s already do. One event per thing that happened. */
  | { type: "FORCED_HAND_DISCARD"; seat: Seat; uids: string[]; to?: "deck" }
  /** A deck search resolved: `uids` moved deck → `dest` (§15.E).

      `reveal` carries the printed *"reveal it/them"* clause off the `searchDeck`
      op (D225), and it is the ONLY thing that lets the log name the cards. It
      has to ride the EVENT rather than be re-read from the op, because `log.ts`
      is handed events and a post-state and never sees the program that produced
      them. Absent means the print carried no reveal — the row stays a count, and
      for `dest: "hand"` that is the difference between an announcement and a
      leak (Cassiopeia searches for unfiltered *"cards"*). A `dest: "bench"`
      search is public whether or not the flag is set: the card enters play.

      🆕 **D342 — `"deckTop"` IS THE THIRD DESTINATION AND IT IS A COUNT ROW,
      DELIBERATELY.** Ciphermaniac's Codebreaking / Dialga put the found cards
      back on top of the deck they came out of: the print carries no *"reveal"*,
      the cards end up in a HIDDEN zone, and naming them would hand the opponent
      the next two draws of a deck the sentence exists to set up privately. It is
      the leakiest of the three destinations and so the one where the standing
      rule — **the flag is the SENTENCE, never the destination** — pays most.
      ⚠️ AND `reorderTop` FILES ITS OWN ROW A MOMENT LATER (`DECK_TOP_REORDERED`,
      a count and an actor), so the log tells the whole printed story in two rows
      without either of them naming a card. */
  | {
      type: "DECK_SEARCHED";
      seat: Seat;
      // 🆕🆕🆕 D557 — `"discard"` (Brilliant Blender): the cards went to the searcher's
      // own discard pile, public, so the log names them. Not persisted — no bump.
      dest: "bench" | "hand" | "deckTop" | "discard";
      uids: string[];
      reveal?: true;
    }
  /** A discard-pile retrieval resolved: `uids` moved discard → `dest` — the §7.1
      recovery Items (Energy Retrieval to hand; Pal Pad / Super Rod back into the
      deck, where a trailing SHUFFLE then scrambles them) and, since D237,
      **onto the Bench** (the attack column's "Put up to 3 Duskull from your
      discard pile onto your Bench."). The discard pile is public, so naming the
      cards leaks nothing in any of the three.

      ⚠️ WIDENING THIS UNION OWES NO `MATCH_RECORD_VERSION` BUMP: events are
      rendered into `record.log` rows and are not themselves persisted, and the
      parked `chooseCards` prompt that produces one has spelled `"bench"` since
      `searchDeck`. A version-12 record can hold every inhabitant it could hold
      before.

      🆕 CARD REVISION B02 — `played: true` marks the one move that is NOT a retrieval: Caretaker's
      *"shuffle this Caretaker into your deck instead of discarding it"* (interpreter.ts
      `shufflePlayedCardIntoDeck`). `playTrainer` parked the card in the discard pile before the
      program ran, so the board move is discard → deck, but the printed event is the played card going
      into the deck instead of the discard, and log.ts names it that way. Optional and absent on every
      other producer; events are not persisted (no bump). */
  | { type: "DISCARD_RETRIEVED"; seat: Seat; dest: "hand" | "deck" | "bench"; uids: string[]; played?: true }
  /** A look-at-the-top-N resolved: `uids` moved deck → `dest`. The other
      looked-at cards are shuffled back — a trailing SHUFFLE in the same batch
      hides the deck order.
      🆕🆕🆕 D574 (D539): ~~`uids` moved deck → `dest`~~ is no longer true of
      every row — with `dest: "deck"` (Team Rocket's Persian ex "Haughty
      Order") NOTHING moves: `uids` are the top cards REVEALED to BOTH players
      (`reveal: true`) and left in the deck, and the trailing SHUFFLE takes all
      of them. The look-only reading below (D225 / D241) is the other dests'.

      **THE NAME RECORDS THE LOOK, NOT THE ANNOUNCEMENT** (D225). The top `n` was
      revealed to its OWNER, which is what makes the pick legal; whether the
      TAKEN cards are shown to the opponent is the printed *"you may reveal a
      Pokémon you find there"* clause, and it rides `reveal` exactly as it does
      on `DECK_SEARCHED`. This doc block used to assert the reveal outright and
      the row named nothing — and the assertion was false besides: Explorer's
      Guidance, Hassel and Drakloak all put looked-at cards in hand with no
      reveal printed anywhere.

      🛑🛑 **D241 — IT NOW FIRES ON THE EMPTY LOOK TOO, AND THAT IS THE WHOLE
      `DECK_TOP_REVEALED` FIDELITY DEBT `coverage-backlog-legal.md` NAMED.** The
      old rule was *"only fires with ≥1 card (a 'take none' moves nothing)"*, so
      the WHIFF (nothing up there matched) and the DECLINE (the player looked and
      took nothing) both emitted **absolutely nothing** — and those are precisely
      the looks the opponent never saw. A look is a transfer of INFORMATION, not
      of cards: the looker now knows the top `n` of a deck and the other player
      has to be told that happened, because the whole point of shuffling the
      leftovers back is that the knowledge is supposed to be spent. `uids: []` is
      that row, and it is count-only in the strongest possible sense.

      **THIS IS D232's PRECEDENT TRANSFERRED, WITH ITS SIGN CHECKED RATHER THAN
      ASSUMED.** D232 ruled that a printed HAND reveal is INSTANTANEOUS, so the
      unconditional face-down hand is the correct projection and the LOG is the
      whole channel. The deck top is the same shape and MORE so — the looked-at
      cards were never face-up to anybody but the looker, and they go back under a
      shuffle — so `redact.ts` and `projection.ts` owe nothing here (the
      answerer-only `chooseCards` gate already resolves the identities to the
      looker alone). What does NOT transfer is the completeness: a hand reveal
      always moves the whole hand into view and therefore always had a row, where
      a look could end with nothing moved and therefore had none. **The channel
      was right and the coverage was not.**

      ⚠️ **NO `actor` FIELD, AND THAT WAS PRICED RATHER THAN SKIPPED.** Its
      sibling `DECK_TOP_DISCARDED` carries one (D136/D153) because the mill reads
      one player's deck on another player's turn, so its row's VOICE is a claim
      about agency. Every `lookAtTopN` printing reads the controller's OWN deck
      (`stepOp` slices `state.players[ctx.seat].deck` and nothing else), so
      `actor === seat` on every path today and the field would have no observable
      meaning (D135's rule). Row 11's *"Look at the top 5 cards of your
      **opponent's** deck and put them back in any order"* is what buys it, and
      that sentence needs an ORDERED answer this engine has no prompt kind for —
      so it is left measured on the backlog rather than half-built here.
      (🆕🆕🆕 D567 NOTE (D539): *"Every `lookAtTopN` printing reads the controller's OWN
      deck"* and *"NO `actor` FIELD"* are WITHDRAWN, kept as written — Accompanying Flute
      `sv06-142` (`lookAtTopN.whose: "opponent"`) reads the OPPONENT's deck, so `actor` is
      now observable on this row and is bought here, present ONLY on that path.)

      🆕🆕 **D341 BOUGHT IT, AND NOT ON THIS ROW.** `reorderTop.side` is the fork,
      and the `actor` it buys sits on `DECK_TOP_REORDERED` below rather than here —
      because the argument above is about THIS event's producers, and `lookAtTopN`
      still has only one seat. **A FIELD PRICED IN ADVANCE IS PRICED FOR THE ROW
      THAT ACTUALLY GAINS THE SECOND SEAT, NOT FOR THE ROW THAT PREDICTED IT**, and
      D135's rule holds on both ends: retrofitting it here would ship a field that
      is still unobservable on every path this event has.
      ⚠️ AND THE PRINTING COUNT IN THE PARAGRAPH ABOVE WAS ONE OVER. Re-measured at
      D341: `instr(attacks_json,'deck and put them back in any order')` is **6
      printings / 4 legal**, of which the OPPONENT sentence is **3** (Team Rocket's
      Dottler `sv10-088`, Gothorita `sv10.5w-042`/`-125`) and the own-deck one is 1
      (Iron Valiant `sv05-080`). The "4 legal printings" here was the whole family,
      attributed to one of its two sentences.

      ⚠️ WIDENING THIS UNION OWES NO `MATCH_RECORD_VERSION` BUMP, for
      `DISCARD_RETRIEVED`'s reason exactly: events are rendered into `record.log`
      rows and are not themselves persisted. */
  | {
      type: "DECK_TOP_REVEALED";
      seat: Seat;
      /** ABSENT means the HAND, mirroring the op's own field (D135).
          🆕🆕🆕 D574 — `"deck"`: the cards were REVEALED and STAYED in the deck (Team Rocket's
          Persian ex "Haughty Order" reveals the opponent's top 10, then shuffles them back —
          attack.ts `copyAtResolution`); `seat` the deck's owner, `actor` the attacker, `reveal`
          true. A D125 widening; not persisted — no bump.
          🆕 Card revision B45 — Sizzlipede "Bug Out" (`revealDeckBottomCount`) reveals its OWN bottom 7 on
          this row (`from: "bottom"`, no `actor`); the revealed Pokémon are shuffled back, and the rest leave
          on the `DECK_BOTTOM_DISCARDED` row that follows — so "stayed in the deck" is the reveal's own
          claim, not every card's fate. Not persisted — no bump. */
      dest?: "bench" | "discard" | "deck";
      uids: string[];
      reveal?: true;
      /** 🆕🆕🆕 D557 — Dusk Ball: the window was the BOTTOM of the deck. ABSENT means
          the top, mirroring `lookAtTopN.from` (D135). Not persisted — no bump. */
      from?: "bottom";
      /** 🆕🆕🆕 D567 — Accompanying Flute (`lookAtTopN.whose: "opponent"`): `seat` is the
          DECK's owner (whose Bench gained the cards) and `actor` the controller who looked.
          PRESENT ONLY on that seat-crossing path (D135), so every own-deck row is
          byte-identical. A D125 widening; not persisted — no bump. */
      actor?: Seat;
    }
  /** `uids` went from the top of `seat`'s DECK to `seat`'s DISCARD PILE, in deck
      order, top first — which is the order the pile gained them (§2). That is the
      whole game fact, and it is deliberately stated without a cause: THREE ops
      produce this row and they are not the same kind of effect.

      🆕 **D334 — THE QUALIFYING TEST IS PRINTED HERE ONCE, BECAUSE A THIRD OP JOINED
      ON IT.** A card belongs on this row when it LEFT THE DECK WITHOUT ANYONE
      DECIDING ABOUT IT — the leftovers of a look, the cards a mill took. That is
      what makes `lookAtTopN`'s own `dest: "discard"` (Rockruff's *"You may discard
      that card"*) a `DECK_TOP_REVEALED` and its `restTo: "discard"` (Explorer's
      Guidance's *"Discard the other cards"*) a row here, on ONE op and often in ONE
      printing: the split is by whether a decision was made about the card, **never
      by where the card ended up.** Two discards can be two events.

      🆕🆕 **D335 — AND THE TEST HAS NOW REFUSED A CARD, WHICH IS WHAT MAKES IT A TEST
      RATHER THAN A DESCRIPTION.** `lookAtTopN.restTo` gained two more values —
      `"bottom"` (Drakloak *"Put the other card on the bottom of your deck"*) and
      `"shuffledBottom"` (Rika *"Shuffle the other cards and put them on the bottom of
      your deck"*) — and **NEITHER produces this row, because neither card LEFT the
      deck.** So this event still has THREE producers and FOUR paths after a slice
      that doubled the field feeding one of them. The sibling rule below ("Shuffle the
      other cards back into your deck" emits nothing of its own) is the same
      judgement, and D335 is the first time it has been applied to a destination the
      deck's own order actually changes for.

      **`seat` IS THE DECK'S OWNER, on every producer** — the player who lost the
      cards, exactly as DAMAGE_DEALT's seat names the defender. It is sometimes the
      actor and sometimes not, and since D131 ONE producer is both depending on its
      own field, which is why this is the OWNER rather than "the player whose card
      did it":
        • attachFromTop `restTo: "discard"` (🆕 D352 — was `discardRest`) — Hydreigon
          "Tri Howl"'s printed "Discard the
          other cards": the looked-at top cards a from-the-top ATTACH did NOT
          attach. Own deck, so `seat` is the ACTOR. The cards that WERE attached
          are named by their own ENERGY_ATTACHED rows, never here.
        • lookAtTopN `restTo: "discard"` (D334, renamed D335) — Explorer's Guidance's
          identical printed clause one op over: the looked-at top cards a mandatory
          TAKE did not take. ⚠️ **ONLY THAT ONE VALUE OF THAT FIELD**: its two D335
          siblings put the leftovers UNDER the deck and produce nothing here.
          Own deck again, so `seat` is the ACTOR again. The cards that WERE taken
          are named by that op's own DECK_TOP_REVEALED row, never here — the exact
          division of labour Tri Howl's line above states, which is why this
          producer needed no field and no renderer arm.
        • discardDeckTop (D130, widened D131) — the MILL, and the ONE producer that
          can be either seat: its `whose` field aims the same action at the
          opponent's deck ("Discard the top 2 cards of your opponent's deck" —
          Chi-Yu ex sv02-040; "For each heads, …" — Wugtrio sv01-057) or at the
          actor's OWN ("Discard the top 5 cards of your deck" — Gyarados
          swsh10.5-022 "Wild Splash"). `seat` is the deck's owner either way, which
          is exactly why this event never needed to name a cause.
      A consumer that read `seat` as "whoever is taking the turn" would credit
      every mill to the wrong player — the same mistake ENERGY_DISCARDED shipped
      once and now carries a separate `actor` to prevent.

      **`actor` IS THE PLAYER WHOSE CARD DID IT** (D153), and it exists for exactly
      the reason ENERGY_DISCARDED's does. D136 read this event, saw that no row it
      produced NAMED a cause, and concluded it needed no `actor` — then fixed the
      mill's voice defect by making the one wording PASSIVE. But a row renders after
      its seat's name, so its VOICE asserts an actor whether or not any segment names
      one: active says "this seat did it", passive says "this seat had it done to
      them". Both are claims about agency, and with `seat` the OWNER and the cause
      varying per path, ONE constant wording is provably false on some path — passive
      lies about Tri Howl and the SELF-mill, active lied about the opponent-mill. The
      distinguishing datum is `actor === seat`, and it is a fact about the effect that
      only the producer knows, so it rides the event rather than being guessed at by a
      renderer that sees one event and no turn context. FOUR paths, one comparison:
        • attachFromTop `restTo: "discard"` — `actor === seat` (own deck, own action);
        • lookAtTopN `restTo: "discard"` — `actor === seat` (D334, own deck, own
          action; its `"bottom"`/`"shuffledBottom"` siblings are on no path here);
        • discardDeckTop `whose: "self"` — `actor === seat` (Wild Splash's own cost);
        • discardDeckTop `whose: "opponent"` — `actor !== seat` (the mill proper).
      🆕 **D334's PATH COST THE RENDERER NOTHING, AND THAT IS THE FIELD EARNING ITS
      KEEP RATHER THAN A COINCIDENCE**: the comparison is the honest key precisely
      because it is a fact about the EFFECT, so a fourth producer on the self side
      lands on an arm that was already written. A per-op flag would have owed a
      fourth case here.
      D113's rule is untouched: the EVENT is still reused rather than joined by a
      sibling, and its game fact is unchanged. What grew is the fact's provenance,
      which is the thing the message needs in order not to lie. This is now the
      THIRD event carrying an owner/actor pair — ENERGY_DISCARDED and
      CARD_TO_BOTTOM_OF_DECK are the others — so the shape is the file's convention
      for "a row whose seat is the target rather than the cause", not a one-off.

      Naming the uids leaks nothing on either producer: the discard pile is PUBLIC.

      ONLY FIRES WITH ≥1 CARD on all three — a zero-card mill (an already-empty
      deck) and a zero-card leftover emit nothing. But both leftovers producers DO
      fire when nothing was taken at all (an empty look, or a declined one): the
      discard is a cost the card charges regardless. The sibling clause "Shuffle the
      other cards back into your deck" (Electric Generator, Great Ball) emits nothing
      of its own — those cards never left the deck, and the trailing SHUFFLE row is
      the whole story. */
  | { type: "DECK_TOP_DISCARDED"; seat: Seat; actor: Seat; uids: string[] }
  /** 🆕🆕🆕 D565 — `seat` discarded `uids` off the BOTTOM of their OWN deck
      (`discardDeckBottom`, Misty's Psyduck "Flustered Leap"). A sibling of
      `DECK_TOP_DISCARDED` rather than a reuse, because that event's caption says
      *"from the top of their deck"* and a reused row would say the wrong end. No
      `actor`: the one producer mills the actor's own deck, so the voice is fixed
      (ACTIVE — the player did it). Naming the uids leaks nothing (the pile is public);
      fires only with ≥1 card. A new union member (D125). */
  | { type: "DECK_BOTTOM_DISCARDED"; seat: Seat; uids: string[] }
  /** An effect moved `uids` (Energy cards) between two of `seat`'s in-play Pokémon
      (`from` → `to`) — the §6 manual Energy movement (Energy Switch: a Basic
      Energy; Poppy: up to 2 any Energy). All moved Energy shares the one source;
      the Pokémon stay put (no bench compaction), so both targets resolve against
      the post-state. A public table fact on either board.

      🆕🆕 **D443 — `seat` NAMES THE BOARD AND `actor` NAMES THE CAUSE, AND THIS
      BLOCK USED TO SAY "Own-board only".** It was true of all four producers and
      true by accident, exactly as D425 found `DAMAGE_DEALT`'s dealer-from-victim
      derivation to be: the op could not reach the other side of the table, so
      `ctx.seat` answered both questions and `log.ts` resolved BOTH targets against
      it. The two opponent-board printings make the two questions different, and a
      renderer deriving one from the other would name the ATTACKER's Pokémon at the
      DEFENDER's spots — the same row, entirely wrong, on a board that looks normal.

      **`actor` IS REQUIRED, AND THAT IS D425's CALL RATHER THAN D421's.** An
      optional `actor` forgotten at a future producer reads as `undefined` and the
      renderer falls back to the seat, which reproduces precisely the attribution
      bug this field exists to remove — a plausible-looking wrong answer. Required
      makes the next producer a compile error instead. It costs nothing at the
      version boundary because **no `GameEvent` is persisted**: `MatchRecord` is
      `{version, seed, startedAt, names, state, log}`, `state` is a `GameState`
      (which holds no events), and `log` is the RENDERED `SeatLogEntry[]`.

      This is the FOURTH event carrying an owner/actor pair — `ENERGY_DISCARDED`,
      `DECK_TOP_DISCARDED` and `CARD_TO_BOTTOM_OF_DECK` are the others — so the
      shape is this file's convention for "a row whose seat is the target rather
      than the cause", and `log.ts` forks on the COMPARISON (`actor === seat`),
      which is `DECK_TOP_DISCARDED`'s stated rule and what keeps every own-board
      row byte-identical to the one it has always rendered.

      ⚠️ `fromUid` NAMES THE SOURCE POKÉMON BY UID, AND IT EXISTS BECAUSE THE
      "resolves against the post-state" GUARANTEE ABOVE STOPPED BEING TRUE (D171).
      Exp. Share sv01-174 moves Energy OFF a body that is Knocked Out later in the
      very same reduction: by the time `logFromEvents` renders, `{spot:"active"}`
      either resolves to nothing or — worse, on a board that auto-promotes — to the
      PROMOTED Pokémon, and the row names a Pokémon that was never involved. The uid
      is immune to that, since `cardIdByUid` is fixed for the whole game (types.ts),
      which is the same trick KNOCKED_OUT already uses to name a card after it left
      play. Emitted on every move (identical rendering for a source that survives);
      OPTIONAL only so the type stays additive for a record written before it. */
  | {
      type: "ENERGY_MOVED";
      /** The board the Energy moved ON — both endpoints are this seat's. */
      seat: Seat;
      /** 🆕 D443 — the seat whose card caused it. Equal to `seat` for every
          own-board printing, the other one for the two that name it. */
      actor: Seat;
      uids: string[];
      from: PokemonTarget;
      fromUid?: string;
      to: PokemonTarget;
    }
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
      /** 🆕 **D295 — WHERE THE ENERGY WENT.** ABSENT = `seat`'s DISCARD PILE,
          which is what this row's NAME says and what every producer before this
          slice does; `"hand"` = `seat`'s OWN HAND (Chill Teaser Toy `sv08-166`,
          the `discardEnergy` `to` field). OPTIONAL so a record written before
          this slice reads back unchanged, exactly as D294's `POKEMON_BENCHED.actor`
          and `ENERGY_MOVED.fromUid` are.

          🛑 **AND IT IS AN INFORMATION FACT, WHICH IS WHY THE ROW STILL NAMES THE
          CARDS.** The discard pile is public (§2) and so is attached Energy, so
          this row has always been free to name uids. A card put back into a HAND
          is entering a HIDDEN zone — but it was PUBLIC on the board an instant
          earlier and both players watched it leave, so naming it leaks nothing
          the opponent did not already see. That is RANDOM_CARD_TAKEN's rule
          (log.ts) read in the opposite direction: that row may name a card
          because it is no longer hidden; this one may because it was not hidden
          when it moved.

          🆕🆕 **D383 — `"deck"` IS THE THIRD VALUE**: `seat`'s OWN DECK, which for
          this destination is the ACTOR's deck as well (Wellspring Mask Ogerpon ex
          `sv06-064` "Torrential Pump" — *"shuffle 3 Energy attached to this Pokémon
          into your deck"*, the `discardEnergy` `to` field's own third member). The
          naming argument above carries over unchanged and is if anything stronger:
          the cards were face up on the table an instant earlier, and the SHUFFLE
          that follows (its own `SHUFFLE` row, from the trailing `shuffleDeck` op)
          is what makes their POSITION unknowable — which is the only thing a deck
          hides that a discard pile does not. */
      to?: "hand" | "deck";
    }
  /** `seat` shuffled its whole hand (`count` cards) into its deck, then drew (a
      separate CARDS_DRAWN) — the hand-refresh Supporter family (Youngster, Judge,
      Brassius, Katy). COUNT-ONLY: a shuffled hand card is hidden, so the opponent
      (and, for Judge's both-player refresh, the controller about the opponent)
      learns only how many. The deck was reordered as part of this (no separate
      SHUFFLE event). `count` may be 0 (an empty hand still "shuffles" — the deck
      is reshuffled either way). 🆕🆕🆕 D640 — not always followed by a draw: Gholdengo's
      "Celebration" files it from flow.ts' `shuffleHandIntoDeck` stage with no CARDS_DRAWN. */
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
  /** 🆕 **D341 — `actor` LOOKED AT THE TOP `count` CARDS OF `seat`'s DECK AND SET
      THE ORDER THEY ARE LEFT IN.** `reorderTop`'s only row.

      **COUNT-ONLY, AND HERE THAT IS A CONFIDENTIALITY RULE RATHER THAN A
      CONVENIENCE.** `HAND_TO_BOTTOM_OF_DECK` above is count-only because a hidden
      hand stays hidden; this row is count-only because naming the cards would
      publish, to the seat that must NOT learn it, exactly the knowledge the card
      just bought — and on the opponent-deck printings it would publish the deck's
      new top to its own owner, which no printed sentence does. The looked-at cards
      are resolved to the ANSWERER ALONE by `redactPrompt`, and this row is what the
      other player is owed instead: that it happened, to whose deck, by whom, and
      how many.

      🛑 **`actor` EXISTS AND `DECK_TOP_REVEALED`'s DOES NOT, AND THAT ASYMMETRY IS
      D135's RULE HOLDING RATHER THAN AN INCONSISTENCY.** That row's doc block
      priced this field in advance and declined it in writing — *"Every
      `lookAtTopN` printing reads the controller's OWN deck, so `actor === seat` on
      every path today and the field would have no observable meaning. Row 11's
      'Look at the top 5 cards of your opponent's deck and put them back in any
      order' is what buys it"* — and it is bought HERE, on the op that actually has
      two seats, rather than retrofitted onto a row where it would still be
      unobservable. `DECK_TOP_DISCARDED`'s `actor` (D136/D153) is the precedent for
      the shape: an op that reads one player's deck on another player's turn owes a
      row whose VOICE is a claim about agency.
      (🆕🆕🆕 D567 NOTE (D539): the asymmetry is RETIRED, kept as written — `lookAtTopN`
      gained its second seat (Accompanying Flute), so `DECK_TOP_REVEALED` carries `actor?`
      too, by the rule this paragraph states: the row that actually gains the seat.)

      **`seat` IS THE DECK's OWNER on both paths**, `DECK_TOP_REVEALED`'s and
      `DECK_TOP_DISCARDED`'s rule, so the own-deck printing renders with
      `actor === seat` and needs no second arm.

      ⚠️ `count` MAY BE 0 — an empty deck. The row still fires, D241's rule
      transferred verbatim: *"a look is a transfer of INFORMATION, not of cards"*,
      and the look that found nothing is precisely the one the opponent never saw.
      ⚠️ It also fires on the 1-card window that did NOT park, because the look
      happened whether or not an ordering decision existed.

      ⚠️ WIDENING THIS UNION OWES NO `MATCH_RECORD_VERSION` BUMP, for
      `DISCARD_RETRIEVED`'s and `DECK_TOP_REVEALED`'s reason exactly: events are
      rendered into `record.log` rows and are not themselves persisted.

      🆕🆕 **D343 — `end` NAMES WHICH END OF THE DECK WAS ORDERED, AND IT IS
      OPTIONAL SO THAT ABSENT KEEPS MEANING WHAT IT ALWAYS MEANT.** `reorderTop`
      grew a `from: "bottom"` window fork for Kofu `sv07-138`/`-165` (*"Put 2
      cards from your hand on the bottom of your deck **in any order**"*), and a
      row that said "the top" over a bottom window would be the one thing a
      count-only event must never be: false about the fact it exists to report.
      Every construction site written before this slice omits the field and keeps
      its exact shape — which is deliberate, and is what lets D341's exact-shape
      assertions stand unedited.

      🛑 **THE ROW FIRES ON THE BOTTOM FORK EVEN THOUGH KOFU TEACHES NOBODY
      ANYTHING**, and the exemption was considered and refused in writing. On Kofu
      the controller put those two cards there out of their own hand one op
      earlier, so the "look" is vacuous and `HAND_COST_PAID` has already filed the
      only public fact. But that is true of the CARD and false of the FORK — a
      printing that said *"look at the bottom 3 cards of your deck and put them
      back in any order"* would be a genuine look at hidden cards — so suppressing
      the row would key a CONFIDENTIALITY rule to a WINDOW. D241's rule stays
      unconditional and the row stays honest instead.

      ⚠️ **AND `end` IS A FIELD RATHER THAN A SECOND EVENT TYPE** for the reason
      `side` is a field on the op rather than a second op: one op with a window
      fork owes one row with a window fork, and splitting it would leave two rows
      whose `actor`/`seat` doctrine has to be kept in step by hand. The type name
      still says TOP because that is the op's name and the family's default; the
      field is what makes the name a default rather than a claim. */
  | {
      type: "DECK_TOP_REORDERED";
      seat: Seat;
      actor: Seat;
      count: number;
      /** Absent = the deck's TOP (D341's four printings). `"bottom"` is
          `reorderTop { from: "bottom" }` — Kofu, D343. */
      end?: "bottom";
    }
  /** 🆕 **D344 — `count` CARDS WENT FROM THE TOP OF `seat`'s DECK TO THE BOTTOM
      OF IT, SHUFFLED.** `bottomDeckTop`'s only row — Deduction Kit `sv08-171`'s
      printed second arm, *"…or shuffle them and put them on the bottom of your
      deck."*

      **COUNT-ONLY, AND FOR `HAND_TO_BOTTOM_OF_DECK`'s REASON RATHER THAN
      `DECK_TOP_REORDERED`'s.** That row withholds the cards because naming them
      would teach the deck's owner their own top; these cards go **hidden →
      hidden** and the shuffle means not even the controller — who did just look
      at them — knows the order they land in. So there is no reading under which
      a uid list here is a fact either player is owed.

      **NO `actor`, AND THAT IS D135 APPLIED RATHER THAN AN OMISSION.** The
      op reads the controller's OWN deck and has no side fork; `actor === seat` on
      every path this row has, so the field would carry no observable meaning.
      `DECK_TOP_REVEALED`'s doc block argues exactly this and then records D341
      buying the field on the row that actually gained a second seat — **a field
      is priced for the row that gains it, not for the row that predicts it.**

      ⚠️ **AND IT IS NOT A `SHUFFLE` ROW.** `SHUFFLE` says the DECK was
      randomized; this says a window under it was. The deck's own order — and so
      the next draws below the window — is untouched, which is precisely the fact
      a player watching needs and precisely what `SHUFFLE` would misreport.

      `count` may be smaller than the printed window (a short deck moves what it
      has) and is 0 on an empty deck — but the op is only ever reached from a
      park that a deck of fewer than 2 cards refuses, so no shipped path emits 0.
      Stated rather than guarded, `HAND_TO_BOTTOM_OF_DECK`'s convention. */
  | { type: "DECK_TOP_TO_BOTTOM"; seat: Seat; count: number }
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
  /** 🆕🆕🆕 D633 — `seat` REVEALED SOME of its hand: the `uids` it picked under a `revealFromHand`
      (Doublade "Weaponized Swords"). Named, `HAND_REVEALED`'s reason: those cards are public now.
      Nothing moves; the cards stay in the hand. Never emitted for an empty pick. */
  | { type: "HAND_CARDS_REVEALED"; seat: Seat; uids: string[] }
  /** ONE card went from `seat`'s hand to the BOTTOM of `seat`'s own deck,
      chosen by `actor` — the other player (Ortega, Greavard: the reveal-and-
      bottom family; `actor` is the ENERGY_DISCARDED precedent). Names the uid
      because the whole move happened face up: the hand was just revealed
      (HAND_REVEALED) and the pick was made in the open, so both players know
      exactly which card sits on the bottom until something shuffles — as at a
      table. Contrast HAND_COST_PAID `to: "deckBottom"` (Dendra), where the
      payer's hidden card goes hidden → hidden and only the payer ever knew it. */
  | { type: "CARD_TO_BOTTOM_OF_DECK"; seat: Seat; uid: string; actor: Seat }
  /** 🆕🆕🆕 D634 — ONE card went from `seat`'s revealed hand INTO `seat`'s deck, chosen by `actor` (the
      other player; Watchog "Snap Inspection"). Named, `CARD_TO_BOTTOM_OF_DECK`'s reason: the pick was
      made in the open. A real `SHUFFLE` row follows. */
  | { type: "HAND_CARD_SHUFFLED_INTO_DECK"; seat: Seat; uid: string; actor: Seat }
  /** ⚠️⚠️ D232 — ONE card left `seat`'s hand AT RANDOM, taken by `actor` (the
      other player) and put either in `seat`'s own discard pile ("Discard a random
      card from your opponent's hand.") or back into their deck, which is then
      shuffled ("Choose a random card from your opponent's hand. Your opponent
      reveals that card and shuffles it into their deck.").

      NAMES THE UID ON BOTH ROUTES, and the two reasons are DIFFERENT rather than
      one reason applied twice — worth saying, because the visibility rule in this
      file is per-destination:
        · `discard` — the §2 discard pile is ordered and PUBLIC, so the card is
          face up the instant it lands. The event names what the board already
          shows (the DECK_TOP_DISCARDED precedent).
        · `deck` — the deck is NOT public, and this one is named because the card
          itself is PRINTED as revealed ("Your opponent reveals that card"). The
          `SHUFFLE` that follows on the same seat is what takes its POSITION back
          away, exactly as at a table: both players know the card is in there and
          neither knows where.
      Contrast HAND_COST_PAID, where a hidden card goes hidden → hidden and stays
      count-shaped, and CARD_TO_BOTTOM_OF_DECK, whose card is known because the
      whole HAND was revealed first. Here nothing but this one card is ever seen —
      a random discard leaks exactly one card and the rest of the hand stays shut,
      which is the printed difference between this family and the reveal one.
      (🆕🆕🆕 D624 (D539): one card PER ROW — Furfrou "Hand Trim"'s `untilHandSize` emits one
      row per card it takes, each its own RNG draw; the rest of the hand still stays shut.)

      `actor` is the ENERGY_DISCARDED / CARD_TO_BOTTOM_OF_DECK precedent: `seat`
      owns the hand and the destination, `actor` caused it. NEVER EMITTED FOR AN
      EMPTY HAND — no card moved, so there is nothing to announce (and no RNG was
      spent; see the op). */
  | { type: "RANDOM_CARD_TAKEN"; seat: Seat; uid: string; actor: Seat; to: "discard" | "deck" }
  /** 🆕🆕🆕 D567 — `actor` chose a RANDOM card from `seat`'s hand and `seat` REVEALED it; the
      card STAYED in the hand (Team Rocket's Bother-Bot: *"choose a random card from your
      opponent's hand. Your opponent reveals that card."*). A SIBLING of `RANDOM_CARD_TAKEN`
      rather than a third `to` on it: that row's name and its `to` both claim a MOVE, and here
      nothing moved. Names only that one card — the rest of the hand stays shut. Never emitted
      for an empty hand (no card, no rng). A new union member (D125); not persisted (D141). */
  | { type: "RANDOM_CARD_REVEALED"; seat: Seat; uid: string; actor: Seat }
  /** 🆕🆕 D445 — `actor` CHOSE one card out of `seat`'s REVEALED hand and put it in
      `seat`'s own discard pile (*"Your opponent reveals their hand. Discard a card you
      find there."*).

      🛑 **THE CHOSEN TWIN OF `RANDOM_CARD_TAKEN`'s `discard` ROUTE, AND A SEPARATE ROW
      BECAUSE THE LOG HAS TO BE ABLE TO SAY WHICH HAPPENED.** That row's own comment in
      `log.ts` states the rule outright — *"the word 'random' is in the row on purpose;
      without it this reads exactly like a card the ACTOR chose … a materially different
      thing to have happened to you"* — so a `to`-style flag on that event would be one
      row unable to distinguish the two halves of its own family. `PRIZE_REDUCED` /
      `PRIZE_BONUS`'s argument, at a hand.

      🛑 **AND IT IS NOT `FORCED_HAND_DISCARD` EITHER, WHICH IS THE CONDITION THAT ROW
      NAMED FOR ITSELF.** D426's block says there is no `actor` field *"and the condition
      that would buy one is stated rather than left to be guessed: it is owed the moment
      a consumer needs to name the causer — and a consumer that reaches for it must NOT
      write `otherSeat(event.seat)`"*. This is that consumer. The card is CHOSEN from
      across the table rather than picked by its owner, so the active voice belongs to
      the actor, and the row names the owner outright. Widening `FORCED_HAND_DISCARD`
      would have given one event two voices and left every existing reader deriving which
      one it was — D425's `DAMAGE_DEALT` defect, invited.

      🆕🆕🆕 **D542 DID WIDEN `FORCED_HAND_DISCARD`, AND THIS PARAGRAPH IS WHY THAT IS
      NOT A REVERSAL.** The refusal above is quantified over VOICE and says so in its own
      words; D542's row (*"Your opponent chooses 3 cards from their hand and shuffles those
      cards into their deck."*) has `FORCED_HAND_DISCARD`'s voice EXACTLY — the owner picks
      from their own hand into their own zone, and there is no actor to name — and differs
      only in DESTINATION, which is the axis `RANDOM_CARD_TAKEN` and `POKEMON_RETURNED`
      each widen on one row. **THIS BLOCK IS UNCHANGED IN EVERY CLAUSE**: the row it
      refuses to fold in is still a different voice and still gets its own event. Read
      together, the two say the rule: fold a DESTINATION in, split a VOICE out.

      **NAMES THE UID**, and the reason is the same one `CARD_TO_BOTTOM_OF_DECK` gives
      one row up: the whole HAND was revealed a moment earlier and the pick was made in
      the open, so nothing is disclosed that both players did not just see. The §2
      discard pile is public besides, so the card is face up the instant it lands — the
      module header's rule is *never name a card that is STILL hidden*, and this one is
      not.

      `actor` is REQUIRED, not optional. No `GameEvent` is in a `MatchRecord` at all
      (`{version, seed, startedAt, names, state, log}` — `state` holds no events and
      `log` is rendered), so required costs nothing at the wire (D443/D425) and makes the
      next producer of this row a compile error rather than a silent attribution bug. */
  | { type: "CARD_DISCARDED_FROM_HAND"; seat: Seat; uid: string; actor: Seat }
  /** An effect switched `seat`'s Active with their benched `nowActive`
      (Switch / Boss's Orders gust): the old Active (`wasActive`) went to the
      bench from `fromBench`'s freed slot and landed at `toBench`; the bench
      compacts and the old Active is appended. Conditions cleared on the
      outgoing Active are a separate STATUS_CLEARED reason "benched".
      No energy is paid (not a retreat). */
  | {
      type: "POKEMON_SWITCHED";
      seat: Seat;
      wasActive: string;
      nowActive: string;
      fromBench: number;
      toBench: number;
    }
  /** 🆕 D299 — A BENCHED POKÉMON LEFT PLAY WITHOUT BEING KNOCKED OUT: `seat`'s
      body `uid` and everything attached to it (`uids`, §2's pile order) went to
      `dest`, put there by `actor` (Illumise `sv06-010` shuffles the OPPONENT's,
      Chimecho `sv06-085` its controller's own — so the two seats differ on one
      printing and agree on the others, which is why both are on the row).

      ⚠️ **`uids` IS THE WHOLE BODY AND `uid` IS ONE OF ITS MEMBERS** — the
      KNOCKED_OUT precedent, whose `discarded` is likewise the entire pile while
      `uid` names the top card. The reader that wants "which Pokémon" reads
      `uid`; the reader that wants "which cards moved" reads `uids`; neither has
      to reconstruct the other from the board, which is already gone by the time
      this is read.

      🛑 **NO SHUFFLE EVENT IS IMPLIED BY `dest: "deck"`.** The op emits a real
      SHUFFLE row after this one, exactly as RANDOM_CARD_TAKEN's deck arm does —
      one event per thing that happened, so a log reader never has to know that
      one of these words secretly means two.

      🆕 **D313 — `dest` GAINS `"discard"` AND `attachmentsTo` ARRIVES BESIDE IT.**
      The third zone is Revavroom ex `sv06.5-015`/`-081`'s *"Discard this Pokémon and
      all attached cards."*; widening an enum is not a `MATCH_RECORD_VERSION` bump
      (the standing rule) and no older deploy can author the new member.
      `attachmentsTo` is the SPLIT — Team Rocket's Crobat ex `sv10-122`/`-217`/
      `-234`/`-242`, *"You may put this Pokémon into your hand. (Discard all cards
      attached to this Pokémon.)"* — where `dest` is where the BODY PILE went and
      this names where the ATTACHMENTS went instead. ⚠️ **IT CARRIES THE ZONE AND
      THE SUBSET IN ONE FIELD ON PURPOSE**: a zone with no cards cannot be rendered
      and cards with no zone cannot be attributed, so the two are only ever true
      together and one field cannot let them disagree. **ABSENT MEANS THE
      ATTACHMENTS FOLLOWED THE BODY** — a positive statement, not a default, and it
      is what every pre-D313 row means. `uids` stays the WHOLE pile either way. */
  /** 🆕🆕🆕 D565 — Palafin "Zero to Hero": `seat`'s body whose top card was `fromUid` now
      has `toUid` (a Palafin ex from the deck) on top instead, IN PLACE — attachments,
      damage, conditions and turns in play stayed on the body — and `fromUid` went into
      the deck (a `SHUFFLE` row follows). Not an evolution, so not `POKEMON_EVOLVED`: no
      evolve moment is announced and none fires. Both cards are named (the new one is
      face up in play; the old one was face up a moment ago). A new union member (D125). */
  | { type: "POKEMON_SWAPPED_FROM_DECK"; seat: Seat; fromUid: string; toUid: string }
  /** 🆕🆕🆕 D566 — Ogre's Mask: `seat`'s body whose top card was `fromUid` now has `toUid`
      (a Pokémon ex from the DISCARD PILE) on top instead, IN PLACE, and `fromUid` went to
      the discard pile (no shuffle, no `SHUFFLE` row). A SIBLING of the deck row rather than a
      zone rider on it — a rider would make `POKEMON_SWAPPED_FROM_DECK` name the wrong pile
      (`DECK_BOTTOM_DISCARDED`'s reason, D565). Both cards are public (the discard pile is).
      A new union member (D125); not persisted (D141). */
  | { type: "POKEMON_SWAPPED_FROM_DISCARD"; seat: Seat; fromUid: string; toUid: string }
  | {
      type: "POKEMON_RETURNED";
      seat: Seat;
      uid: string;
      actor: Seat;
      /** 🆕🆕🆕 D565 — `"deckTop"` (Flustered Leap's "put this Pokémon on top of your
          deck"), placed with no shuffle. A union widening (D125). */
      dest: "deck" | "deckTop" | "hand" | "discard";
      uids: string[];
      attachmentsTo?: { dest: "discard"; uids: string[] };
    }
  /** `seat` must resolve a mid-effect decision (the effect:choose prompt) —
      the prompt twin of PRIZES_OWED, so an event-only client never hangs. */
  | { type: "EFFECT_PENDING"; seat: Seat; note: string }
  | { type: "TURN_ENDED"; turn: number; seat: Seat }
  | { type: "GAME_OVER"; outcome: GameOutcome };
