import type { Card } from "@colorless/schema";
import {
  activeTop,
  cardOfUid,
  evolveFromOf,
  hasPrintedAbility,
  isExOrV,
  isStage1Pokemon,
  isStage2Pokemon,
  matchesFilter,
  pokemonSuffixOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
import { isBasicPokemon } from "./cardClasses";
import {
  attackGateOf,
  countAttachedEnergy,
  countEnergyInPlay,
  effectiveRetreatCost,
  hasAttachedEnergy,
  inPlayCardOf,
  inPlayToHandBlocked,
  installedNoWeakness,
  installedWeaknessRetypeOf,
  installedWeaknessRewriteOf,
  passivesOf,
  remainingHpWithin,
  seatPreWRDamageBonus,
  seatRemovesWeakness,
  seatWeaknessRewrite,
  selfPreWRBonusPerOpponentPrize,
} from "./continuous";
import type { AttackTimingGate, BoardCondition, CardFilter } from "./effectTypes";
import { foldApostrophes } from "./deriver/vocabulary";
import { hasAnyDamageCounters, opponentKnockedOutByDamage } from "./effectTargets";
// `conditionHolds` reads the turn owner from the one exhaustive switch over `Phase` rather than
// re-deriving it by turn parity.
import { phaseViewOf } from "./phaseView";
import type { GameState, InPlayPokemon, Seat } from "./types";
import {
  damageCountersOn,
  HP_PER_COUNTER,
  inPlayOf,
  isFirstTurnOf,
  koedDuringOpponentsLastTurn,
  koedMarksOnOpponentsLastTurn,
  otherSeat,
  presentStatuses,
  usedAttackOnYourLastTurn,
} from "./types";

// Board predicates: `conditionHolds` evaluates a BoardCondition and `conditionNote` captions it,
// with the board counts and attack/evolve licences they share.

/** Evaluate a `BoardCondition` for `seat` — PURE, and reading only PUBLIC state
    (Prize counts, the Stadium zone's owner, Energy sitting face up), so the
    answer is one the opponent could derive too. The single evaluator behind all
    three consumers: the `conditionGate` op above, the printed play gate
    playTrainer checks before the card leaves hand (cardplay.ts `playableIf`),
    and the HUD, which greys out a card whose condition is unmet rather than
    offering a button that can only reject. */
export function conditionHolds(state: GameState, seat: Seat, cond: BoardCondition): boolean {
  switch (cond.kind) {
    case "morePrizesThanOpponent":
      return state.players[seat].prizes.length > state.players[otherSeat(seat)].prizes.length;
    case "yourStadiumInPlay":
      // §7.3 — presence is not enough; the Stadium must be the one YOU played.
      return state.stadium !== null && state.stadium.owner === seat;
    case "opponentStadiumInPlay":
      // The arm above from the other seat (Scorching Earth).
      return state.stadium !== null && state.stadium.owner === otherSeat(seat);
    case "stadiumInPlay":
      // "A Stadium is in play": the arm above without the owner test, since the Stadium zone is
      // shared.
      return state.stadium !== null;
    case "noEnergyOnYourPokemon": {
      const side = state.players[seat];
      return [side.active, ...side.bench].every((p) => p === null || p.energy.length === 0);
    }
    case "opponentActiveDamaged": {
      // "your opponent's Active Pokémon ALREADY has any damage counters on it" —
      // the OPPONENT of `seat` (this is the one cross-board member of the
      // vocabulary). Damage is HP on the model, so "any counters" is `> 0`; the
      // "already" is a TIMING word the caller honours by asking at declaration,
      // not something this predicate can enforce.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && active.damage > 0;
    }
    case "opponentActiveIsEvolution": {
      // Evolution means `evolveFromOf` is non-null. An empty Active Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && evolveFromOf(spot.card) !== null;
    }
    case "opponentActiveIsBasic": {
      // Reuses `isBasicPokemon` so there is one reading of "Basic". Read off the top card; an empty
      // Active Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isBasicPokemon(spot.card);
    }
    case "opponentActiveIsStage1": {
      // Stage 1 via `isStage1Pokemon`, not "is evolved", which would also match Stage 2, VSTAR and
      // VMAX. Read off the top card; an empty Active Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isStage1Pokemon(spot.card);
    }
    case "opponentActiveIsStage2": {
      // Stage 2 via `isStage2Pokemon`. Read off the top card; an empty Active Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isStage2Pokemon(spot.card);
    }
    case "yourActiveDamaged": {
      // "This Pokémon has any damage counters on it", resolved to your Active by the clause table.
      // Read at declaration, so it is the damage the attacker walked in with.
      const active = state.players[seat].active;
      return active !== null && active.damage > 0;
    }
    case "yourActiveUndamaged": {
      // Not written as the negation of `yourActiveDamaged`, which would make an empty Active Spot
      // count as undamaged.
      const active = state.players[seat].active;
      return active !== null && active.damage === 0;
    }
    case "yourBenchDamaged":
      // "your Benched Pokémon have any damage counters on them" — the plural is
      // collective, so ANY one damaged benched Pokémon satisfies it. The Active is
      // deliberately not consulted, and an empty Bench is false rather than
      // vacuously true (nothing there is carrying counters).
      return state.players[seat].bench.some((p) => p !== null && p.damage > 0);
    case "yourBenchAllDamaged": {
      // "All of your Benched Pokémon" is false on an empty Bench (no vacuous truth); a wrong true
      // would pay the bonus on common boards.
      const bench = state.players[seat].bench;
      return bench.length > 0 && bench.every((p) => p !== null && p.damage > 0);
    }
    case "yourBenchNamedDamaged":
      // Damage and name are tested on the same body. The name is read from the top card, so an
      // evolved body no longer matches. An empty Bench is false.
      return state.players[seat].bench.some(
        (p) => p !== null && p.damage > 0 && topCardOf(state, p)?.name === cond.name,
      );
    case "opponentActivePoisoned": {
      // §12 — Poison is stored as the counter amount an effect may raise, so
      // "is Poisoned" is `> 0`, exactly as the Checkup reads it (flow.ts).
      const active = state.players[otherSeat(seat)].active;
      return active !== null && active.conditions.poisonDamage > 0;
    }
    case "opponentActiveHasSpecialCondition": {
      // §12 — ANY condition: the rotation slot, Poison or Burn. `presentStatuses`
      // is the same list the status chips and STATUS_CLEARED events are built
      // from, so "affected" cannot drift from what the board shows.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && presentStatuses(active.conditions).length > 0;
    }
    case "yourActiveHasSpecialCondition": {
      // Self version of the arm above: "If this Pokémon is affected by a Special Condition".
      const active = state.players[seat].active;
      return active !== null && presentStatuses(active.conditions).length > 0;
    }
    case "yourActivePoisoned": {
      // "This Pokémon is Poisoned" (Okidogi ex), resolved to your Active by the clause table.
      const active = state.players[seat].active;
      return active !== null && active.conditions.poisonDamage > 0;
    }
    case "yourActiveBurnedOrPoisoned": {
      // "If this Pokémon is Burned or Poisoned" (Larry's Staraptor): either alone holds.
      const active = state.players[seat].active;
      if (active === null) return false;
      const present = presentStatuses(active.conditions);
      return present.includes("burned") || present.includes("poisoned");
    }
    case "yourActiveAsleep": {
      // Snorlax "Good Sleep": "If this Pokémon remains Asleep".
      const active = state.players[seat].active;
      return active !== null && presentStatuses(active.conditions).includes("asleep");
    }
    case "opponentActiveBurned": {
      // Reads `presentStatuses`, not the raw `conditions.burned`, so Burned always implies affected
      // by a Special Condition.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && presentStatuses(active.conditions).includes("burned");
    }
    case "opponentActiveConfused": {
      // Not `isImmobilized`, which excludes Confused, and not `rotation !== "none"`, which would
      // include Asleep.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && presentStatuses(active.conditions).includes("confused");
    }
    case "opponentActiveIsExOrV": {
      // ex or V only, not VMAX/VSTAR/GX. An empty Active Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isExOrV(spot.card);
    }
    case "opponentActiveIsEx": {
      // ex only: false for a Pokémon V, unlike `opponentActiveIsExOrV`. An empty Active Spot is
      // false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && pokemonSuffixOf(spot.card) === "ex";
    }
    case "yourActiveHasEnergyAttached": {
      // Types are read by provision via continuous.ts, matching the §8.2 cost check. False with an
      // empty Active Spot.
      const active = state.players[seat].active;
      return active !== null && hasAttachedEnergy(state, active, cond.energy);
    }
    case "opponentActiveHasEnergyAttached": {
      // Seat mirror of the arm above. Types read by provision; false with an empty Active Spot.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && hasAttachedEnergy(state, active, cond.energy);
    }
    case "yourActiveHasNamedEnergyAttached": {
      // Matches attached Energy by printed name, not provision, folding the card name like the
      // stored clause. An unresolvable uid is false.
      const active = state.players[seat].active;
      if (active === null) return false;
      return active.energy.some((uid) => {
        const card = cardOfUid(state, uid);
        return card !== undefined && foldApostrophes(card.name) === cond.name;
      });
    }
    case "yourBenchHasNamedEnergyAttached":
      // Zarude "Shadowy Whip": the arm above over your Benched Pokémon only.
      return state.players[seat].bench.some((p) =>
        p.energy.some((uid) => {
          const attached = cardOfUid(state, uid);
          return attached !== undefined && foldApostrophes(attached.name) === cond.name;
        }),
      );
    case "opponentPrizesRemaining":
      // The printed "exactly" makes this set membership. Face-up prizes still count.
      return cond.counts.includes(state.players[otherSeat(seat)].prizes.length);
    case "yourPrizesRemaining":
      // Seat mirror of the arm above.
      return cond.counts.includes(state.players[seat].prizes.length);
    case "opponentHandAtMost":
      // The SIZE of their hand, never its contents — the line the union's
      // public-state invariant draws, and the reason this survives P4 redaction
      // (the wire ships face-down backs with a real length).
      return state.players[otherSeat(seat)].hand.length <= cond.count;
    case "handSizesEqual":
      // Seat-symmetric: equality commutes. Sizes only.
      return state.players[seat].hand.length === state.players[otherSeat(seat)].hand.length;
    case "yourHandExactly":
      // "You don't have exactly 3 cards in your hand" read positive: the attacker's own hand,
      // strict equality. Sizes only.
      return state.players[seat].hand.length === cond.count;
    case "yourHandAtLeast":
      // "If you have 10 or more cards in your hand": read at the gate, after the program's first
      // draw and after the Supporter left the hand.
      return state.players[seat].hand.length >= cond.count;
    case "yourHandNotEmpty":
      // Payability of "You may discard your hand": `> 0`, since an empty hand cannot pay and must
      // not earn the bonus.
      return state.players[seat].hand.length > 0;
    case "yourFaceDownPrizeRemains": {
      // Payability of Crescent Purge's cost: some prize must still be face down; a row whose prizes
      // are all face up cannot pay.
      const side = state.players[seat];
      return side.prizes.some((uid) => !side.faceUpPrizes.includes(uid));
    }
    case "yourDeckAtMost":
      // The size of your own deck, which is public. `<=`, so an empty deck is true: deck-out is
      // only checked at the draw step.
      return state.players[seat].deck.length <= cond.count;
    case "yourDeckNotEmpty":
      // Naveen's gate: the complement of `yourDeckAtMost 0`.
      return state.players[seat].deck.length > 0;
    case "yourActiveEnergyAtLeast": {
      // Counts Energy cards, not units. An optional `energy` type filters the count (Abomasnow
      // "Frozen Wood"). False with an empty Active Spot.
      const own = state.players[seat].active;
      return own !== null && countAttachedEnergy(state, own, cond.energy ?? null) >= cond.count;
    }
    case "activeEnergyCountsEqual": {
      // Counts Energy cards on the two Active Pokémon only, not the Bench. False when either Active
      // Spot is empty.
      const own = state.players[seat].active;
      const theirs = state.players[otherSeat(seat)].active;
      return (
        own !== null &&
        theirs !== null &&
        countAttachedEnergy(state, own, null) === countAttachedEnergy(state, theirs, null)
      );
    }
    case "moreActiveEnergyThanOpponent": {
      // Strictly more, attacker on the left. False when either Active Spot is empty; treating a
      // missing defender as zero would arm the clause.
      const own = state.players[seat].active;
      const theirs = state.players[otherSeat(seat)].active;
      return (
        own !== null &&
        theirs !== null &&
        countAttachedEnergy(state, own, null) > countAttachedEnergy(state, theirs, null)
      );
    }
    case "opponentActiveHasType": {
      // The same read Weakness and Resistance make two lines later in the §8.5
      // pipeline (`cards.ts` `weaknessOf`), so a printed type cannot mean one
      // thing to this clause and another to the multiplier it feeds. `types` is
      // null on Trainers and Energy, hence the `?? []`. Empty Active Spot is
      // FALSE, as with the two other card-reading members.
      const spot = activeTop(state, otherSeat(seat));
      // Reads in-play types (`inPlayCardOf`), so a retyped body counts.
      return (
        spot !== null &&
        ((inPlayCardOf(state, spot.active) ?? spot.card).types ?? []).includes(cond.type)
      );
    }
    case "yourActiveHasType": {
      // Dragon Elixir's "your Active {N} Pokémon": the arm above on your own seat.
      const spot = activeTop(state, seat);
      // Reads in-play types (`inPlayCardOf`).
      return (
        spot !== null &&
        ((inPlayCardOf(state, spot.active) ?? spot.card).types ?? []).includes(cond.type)
      );
    }
    case "opponentActiveHasResistance": {
      // Does not use `resistanceOf`, which only returns a Resistance that applies to the attacker's
      // types; this asks whether the defender has the Resistance at all. Matches on `type` alone.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && (spot.card.resistances ?? []).some((r) => r.type === cond.type);
    }
    case "opponentActiveRetreatCostAtLeast": {
      // Uses `effectiveRetreatCost`, not the printed cost, so Stadium and Ability modifiers apply.
      // `>=` for "or more". False with an empty Active Spot.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && effectiveRetreatCost(state, active) >= cond.count;
    }
    case "opponentActiveNoRetreatCost": {
      // Carnivine "Chomp Whole": the arm above's effective cost at zero.
      const foeActive = state.players[otherSeat(seat)].active;
      return foeActive !== null && effectiveRetreatCost(state, foeActive) === 0;
    }
    case "yourActiveWeakToOpponentActiveType": {
      // Adversity Policy: your Active's effective Weakness against the opponent's Active's in-play
      // types, applying the same rewrites as the §8.5 sites. False if either Spot is empty.
      const mine = state.players[seat].active;
      const theirs = state.players[otherSeat(seat)].active;
      if (mine === null || theirs === null) return false;
      if (seatRemovesWeakness(state, seat) || installedNoWeakness(state, mine)) return false;
      const holder = inPlayCardOf(state, mine);
      const attacker = inPlayCardOf(state, theirs);
      if (holder === undefined || attacker === undefined) return false;
      return (
        weaknessOf(
          attacker,
          holder,
          installedWeaknessRetypeOf(state, mine),
          // Overwriting Bolt's installed rewrite first.
          installedWeaknessRewriteOf(state, mine) ?? seatWeaknessRewrite(state, seat, holder),
        ) !== null
      );
    }
    case "yourBenchHasType":
      // Bench only: both printings are on Metal attackers, so including the Active would make the
      // bonus unconditional. Reads the in-play types of the top card.
      return state.players[seat].bench.some(
        // Reads in-play types (`inPlayCardOf`).
        (p) => p !== null && (inPlayCardOf(state, p)?.types ?? []).includes(cond.type),
      );
    case "yourBenchHasStage2OfType":
      // Sableye "Cocky Claw": the arm above and `isStage2Pokemon` on the same Benched body.
      return state.players[seat].bench.some((p) => {
        const benched = inPlayCardOf(state, p);
        return (
          benched !== undefined &&
          isStage2Pokemon(benched) &&
          (benched.types ?? []).includes(cond.type)
        );
      });
    case "opponentInPlayHasType":
      // "Your opponent has any {W} Pokémon in play": the opponent's Active and Bench only, never
      // your own side. Reads in-play types; nothing in play is false.
      return [
        state.players[otherSeat(seat)].active,
        ...state.players[otherSeat(seat)].bench,
        // Reads in-play types (`inPlayCardOf`).
      ].some((p) => p !== null && (inPlayCardOf(state, p)?.types ?? []).includes(cond.type));
    case "inPlayTypesIntersect": {
      // "Any of your Pokémon in play are the same type as any of your opponent's": both whole
      // boards, and any shared type counts. An empty side is false.
      const typesInPlay = (s: Seat): string[] => {
        const side = state.players[s];
        return [side.active, ...side.bench].flatMap((p) =>
          // Reads in-play types (`inPlayCardOf`).
          p === null ? [] : (inPlayCardOf(state, p)?.types ?? []),
        );
      };
      const theirs = new Set(typesInPlay(otherSeat(seat)));
      return typesInPlay(seat).some((type) => theirs.has(type));
    }
    case "yourBenchHasNamed":
      // Bench only — the printed word is "Bench", and the Active Spot is excluded
      // exactly as `yourBenchDamaged` excludes it. Bench slots are nullable and a
      // stack can outrun the catalog, so the name is read through `topCardOf`
      // (the stack TOP is the Pokémon's identity, §1.2: evolving a Falinks into
      // something else stops satisfying this, which is the right answer).
      return state.players[seat].bench.some(
        (p) => p !== null && topCardOf(state, p)?.name === cond.name,
      );
    case "yourBenchHasNameContaining":
      // Substring match, not prefix or equality: Team Rocket's Nidoqueen names "Nidoking",
      // satisfied by Team Rocket's Nidoking ex. Case-sensitive. An unresolvable card is false.
      return state.players[seat].bench.some(
        (p) => p !== null && (topCardOf(state, p)?.name.includes(cond.fragment) ?? false),
      );
    case "yourNamedPokemonInPlay": {
      // "In play" includes the Active Spot; keep this separate from the Bench-only arm, since
      // Falinks would otherwise satisfy its own clause. Read from the top card.
      const side = state.players[seat];
      return [side.active, ...side.bench].some(
        (p) => p !== null && topCardOf(state, p)?.name === cond.name,
      );
    }
    case "yourEnergyInPlayAtLeast":
      // Active + Bench, counting cards rather than units, `>=` for "at least".
      return countEnergyInPlay(state, seat, cond.energy) >= cond.count;
    case "yourBasicEnergyInDiscardAtLeast": {
      // A discarded Energy provides nothing, so count printed cards via `matchesFilter`, not
      // provision. `>=` for "or more".
      const filter: CardFilter = { kind: "basicEnergy", energyType: cond.energy };
      return countCardsInDiscardPile(state, seat, filter) >= cond.count;
    }
    case "yourBasicEnergyInHandAtLeast": {
      // The hand version of the arm above, using the same predicate `handCostCandidates` pays with,
      // so the gate and the payment agree.
      const handFilter: CardFilter = { kind: "basicEnergy", energyType: cond.energy };
      return countCardsInHand(state, seat, handFilter) >= cond.count;
    }
    case "yourActiveHasToolAttached": {
      // `> 0` rather than `=== 1`: some effects raise the one-Tool cap. False with an empty Active
      // Spot.
      const active = state.players[seat].active;
      return active !== null && active.tools.length > 0;
    }
    case "opponentActiveHasToolAttached": {
      // The opponent's Active version of the arm above. False with an empty Active Spot.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && active.tools.length > 0;
    }
    case "youPlayedSupporterThisTurn":
      // `state.allowances` belongs to the turn owner, so the seat must be the active seat from
      // `phaseViewOf` (never turn parity). Between turns this is false for both seats.
      return phaseViewOf(state, seat).activeSeat === seat && state.allowances.supporterPlayed;
    case "yourActivePromotedThisTurn": {
      // No seat guard needed: `promotedTurn` is stamped on the Pokémon and compared with the global
      // turn counter. A Knock Out promotion on the opponent's turn never matches the controller's
      // turn.
      const active = state.players[seat].active;
      return active !== null && active.promotedTurn === state.turn;
    }
    case "yourActiveHealedThisTurn": {
      // No seat guard, as above. Picnic Basket can stamp the opponent's Active, but that only reads
      // true during the turn it was healed.
      const active = state.players[seat].active;
      return active !== null && active.healedTurn === state.turn;
    }
    case "yourActiveEvolvedFromThisTurn": {
      // The card evolved from is one below the top of the stack (`stack[length - 2]`); a stack of
      // one gives undefined. Both the turn and name tests are needed.
      const active = state.players[seat].active;
      if (active === null || active.evolvedTurn !== state.turn) return false;
      const beneath = active.stack[active.stack.length - 2];
      return beneath !== undefined && cardOfUid(state, beneath)?.name === cond.name;
    }
    case "yourActiveUsedAttackLastTurn": {
      // Safe off-turn by parity: `state.turn - 2` matches only the same seat's previous turn, so
      // the non-turn seat reads false.
      const active = state.players[seat].active;
      return active !== null && usedAttackOnYourLastTurn(state, active, cond.attack);
    }
    case "yourPokemonUsedAttackLastTurn": {
      // "1 of your Pokémon": checks every in-play body. Reads the record on the body, not
      // `topCardOf`, so evolving keeps the history.
      const side = state.players[seat];
      return [side.active, ...side.bench].some(
        (p) => p !== null && usedAttackOnYourLastTurn(state, p, cond.attack),
      );
    }
    case "yourBenchAtLeast":
      // Victini "V-Force": "4 or fewer Benched Pokémon" under a cancel is stored as a floor of 5
      // with `>=`. Bench only; `bench` is dense.
      return state.players[seat].bench.length >= cond.count;
    case "opponentBenchAtLeast":
      // The opponent's Bench version of the arm above. `>=` for "or more"; Bench only.
      return state.players[otherSeat(seat)].bench.length >= cond.count;
    case "yourOwnerPokemonInPlayAtLeast":
      // "4 or more Team Rocket's Pokémon in play": Active + Bench top cards, matched with
      // `matchesFilter`'s `ownerPokemon` arm. `>=` for "or more".
      return countOwnerPokemonInPlay(state, seat, cond.owner) >= cond.count;
    case "yourPokemonAllOwner": {
      // "If all of your Pokémon in play are Team Rocket's Pokémon": an empty board is false.
      const side = state.players[seat];
      const inPlay = side.bench.length + (side.active === null ? 0 : 1);
      return inPlay > 0 && countOwnerPokemonInPlay(state, seat, cond.owner) === inPlay;
    }
    case "yourActiveOwner": {
      // Arven's Sandwich: the Active's top card via the `ownerPokemon` matcher. Empty Spot is
      // false.
      const spot = activeTop(state, seat);
      return spot !== null && matchesFilter(spot.card, { kind: "ownerPokemon", owner: cond.owner });
    }
    case "yourActiveHasAbility": {
      // Reads the printed Ability on the Active's top card; a locked Ability still counts, so
      // `disabledAbilityUids` is not consulted.
      const spot = activeTop(state, seat);
      return spot !== null && (spot.card.abilities ?? []).some((a) => a.name === cond.name);
    }
    case "yourActiveNamed": {
      // Latios "Lustrous Assist": the Active's top card by exact printed name. Empty Spot is false.
      const spot = activeTop(state, seat);
      return spot !== null && spot.card.name === cond.name;
    }
    case "opponentHasExOrVInPlay": {
      // Slaking ex: any Pokémon ex or V among the opponent's Active and Bench top cards.
      const side = state.players[otherSeat(seat)];
      const bodies = inPlayOf(side);
      return bodies.some((pokemon) => {
        const card = topCardOf(state, pokemon);
        return card !== undefined && isExOrV(card);
      });
    }
    case "yourActiveDamageCountersAtLeast": {
      // The field is the printed counter count; one counter is 10 damage. Empty Spot is false.
      const active = state.players[seat].active;
      return active !== null && active.damage >= cond.count * HP_PER_COUNTER;
    }
    case "opponentActiveHasAbility": {
      // Galvantula: the defender's top card has a printed Ability; a locked Ability still counts.
      // Empty Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && hasPrintedAbility(spot.card);
    }
    case "yourActiveRemainingHpAtMost": {
      // Weavile "Retaliatory Claw": remaining HP of your Active. Empty Spot is false.
      const ownActive = state.players[seat].active;
      return ownActive !== null && remainingHpWithin(state, ownActive, cond.hp);
    }
    case "opponentActiveDamageCountersExactly": {
      // Mega Absol ex "Terminal Period": damage counters on the defender. Empty Spot is false.
      const defending = state.players[otherSeat(seat)].active;
      return defending !== null && damageCountersOn(defending) === cond.count;
    }
    case "opponentKnockedOutByDamage":
      // An opponent's body the §8.1 sweep will Knock Out, not by an effect's doom (`koByEffect`).
      return opponentKnockedOutByDamage(state, seat);
    case "opponentDiscardHasNameContaining":
      // Kyurem "Plasma Bane": any card in the opponent's discard pile with "Colress" in its name,
      // case-sensitive.
      return state.players[otherSeat(seat)].discard.some(
        (uid) => cardOfUid(state, uid)?.name.includes(cond.fragment) === true,
      );
    case "yourDiscardHasNamed":
      // Serperior "Solar Coiling": your discard pile, exact name (folded).
      return state.players[seat].discard.some((uid) => {
        const discarded = cardOfUid(state, uid);
        return discarded !== undefined && foldApostrophes(discarded.name) === cond.name;
      });
    case "yourDiscardPokemonWithAbilityNamedAtLeast": {
      // Hide 'n' Sneak count: Pokémon cards in your discard pile whose printed Abilities include
      // the name. Trainer cards printing an Ability never count.
      const holders = state.players[seat].discard.filter((uid) => {
        const discarded = cardOfUid(state, uid);
        return (
          discarded !== undefined &&
          discarded.category === "Pokemon" &&
          (discarded.abilities ?? []).some(
            (printed) => foldApostrophes(printed.name) === cond.ability,
          )
        );
      });
      return holders.length >= cond.count;
    }
    case "youPlayedSupporterNamedThisTurn": {
      // The allowance bag belongs to the turn owner, so a non-turn seat reads false.
      if (phaseViewOf(state, seat).activeSeat !== seat) return false;
      const played = state.allowances.supporterPlayedUid;
      if (played === null) return false;
      // `cardOfUid` resolves the uid in any zone, so a Supporter shuffled back into the deck still
      // counts as played.
      const name = cardOfUid(state, played)?.name;
      if (name === undefined) return false;
      if (cond.name !== undefined) return name === cond.name;
      return cond.nameContains !== undefined && name.includes(cond.nameContains);
    }
    case "stadiumInPlayNamed": {
      // Caretaker's "if Community Center is in play": a name test with no owner test, since no
      // possessive is printed.
      const stadium = state.stadium;
      return stadium !== null && cardOfUid(state, stadium.uid)?.name === cond.name;
    }
    case "yourBannerPokemonInPlay": {
      // "You have any Tera Pokémon in play": the seat's Active and Bench, each body's top card
      // (§1.2).
      const side = state.players[seat];
      const bodies = inPlayOf(side);
      return bodies.some((body) =>
        matchesFilter(topCardOf(state, body), { kind: "bannerPokemon", banner: cond.banner }),
      );
    }
    case "yourBannerPokemonOnBench":
      // "On your Bench": the Active is excluded.
      return state.players[seat].bench.some((body) =>
        matchesFilter(topCardOf(state, body), { kind: "bannerPokemon", banner: cond.banner }),
      );
    case "opponentActiveIsBanner":
      // An empty Active Spot is false.
      return matchesFilter(activeTop(state, otherSeat(seat))?.card, {
        kind: "bannerPokemon",
        banner: cond.banner,
      });
    case "opponentBannerPokemonInPlay": {
      // "Your opponent has any Future Pokémon in play": the other seat's Active and Bench, top
      // cards only.
      const theirs = state.players[otherSeat(seat)];
      const theirBodies = inPlayOf(theirs);
      return theirBodies.some((body) =>
        matchesFilter(topCardOf(state, body), { kind: "bannerPokemon", banner: cond.banner }),
      );
    }
    case "yourOtherBannerPokemonAttackedLastTurn": {
      // Koraidon "Unrelenting Onslaught": reads the seat-level `recentAttackers` record so a
      // departed attacker still counts. The window is the seat's previous turn (`- 2`), the banner
      // is read off the card by uid, and Koraidon's own Active stack is excluded. Safe off-turn: a
      // seat is only stamped on its own turns.
      const attacker = state.players[seat].active;
      const own = attacker === null ? [] : attacker.stack;
      return state.recentAttackers[seat].some(
        (entry) =>
          entry.turn === state.turn - 2 &&
          !own.includes(entry.uid) &&
          matchesFilter(cardOfUid(state, entry.uid), {
            kind: "bannerPokemon",
            banner: cond.banner,
          }),
      );
    }
    case "yourPlayedBannerSupporterThisTurn": {
      // "If you played an Ancient/Future Supporter card from your hand during this turn". The
      // allowance bag is the turn owner's, hence the seat guard; the uid resolves in any zone.
      if (phaseViewOf(state, seat).activeSeat !== seat) return false;
      const playedUid = state.allowances.supporterPlayedUid;
      return (
        playedUid !== null &&
        matchesFilter(cardOfUid(state, playedUid), { kind: "bannerCard", banner: cond.banner })
      );
    }
    case "opponentStage2PokemonInPlay": {
      // "Your opponent has any Stage 2 Pokémon in play": the other seat's Active and Bench, top
      // cards only.
      const foes = state.players[otherSeat(seat)];
      const foeBodies = inPlayOf(foes);
      return foeBodies.some((body) => {
        const top = topCardOf(state, body);
        return top !== undefined && isStage2Pokemon(top);
      });
    }
    case "yourMegaExInPlay": {
      // "If you have any [{T}] Mega Evolution Pokémon ex in play": your Active and Bench, each
      // body's in-play card (with its in-play types).
      const own = state.players[seat];
      return [own.active, ...own.bench].some((body) => {
        if (body === null) return false;
        const card = inPlayCardOf(state, body);
        if (card === undefined || !matchesFilter(card, { kind: "megaEvolutionEx" })) return false;
        return cond.type === undefined || (card.types ?? []).includes(cond.type);
      });
    }
    case "yourInPlayToHandAllowed":
      // The negation of the Milotic lock on the reading seat's own cards (Zarude "Jungle Whip"'s
      // cost gate).
      return !inPlayToHandBlocked(state, seat);
    case "extraEnergyBeyondAttackCost":
      // Psyspear's gate needs the declared attack's charged cost, which no board read has;
      // `resolveDeclarationGates` answers it at declaration, so this is false otherwise.
      return false;
    case "yourPokemonKoedOnOpponentsLastTurn":
      // "Any of your Pokémon were Knocked Out during your opponent's last turn." `lastKoTurn` is a
      // per-seat record, so unlike `youPlayedSupporterThisTurn` this is safe off-turn and needs no
      // `phaseViewOf` guard. The owner and cause narrowings are optional; absent means unnarrowed.
      if (cond.owner === undefined && cond.byAttack === undefined) {
        return koedDuringOpponentsLastTurn(state, seat);
      }
      // `koedMarksOnOpponentsLastTurn` returns an empty list when the window is shut, so the
      // narrowed gate is a strict subset of the bare one. The mark carries the printed card name
      // and `owner` is the bare subgroup, so the possessive is built here as `matchesFilter`'s
      // `ownerPokemon` arm builds it.
      return koedMarksOnOpponentsLastTurn(state, seat).some(
        (mark) =>
          (cond.owner === undefined || mark.name.startsWith(`${cond.owner}'s `)) &&
          (cond.byAttack === undefined || mark.byAttack),
      );
    case "youGoSecond":
      // A seat-assignment question, not a turn question, so it needs no `activeSeat` guard.
      // `firstPlayer` is null through setup; the `!== null` guard stops this reading true for both
      // seats.
      return state.firstPlayer !== null && state.firstPlayer !== seat;
    case "allOf":
      // `.every`: the printed conjunction is "and". The tuple type refuses the empty list, so this
      // cannot be vacuously true.
      return cond.conditions.every((inner) => conditionHolds(state, seat, inner));
    case "yourFirstTurn":
      // "Once during your first turn" (Fan Rotom "Fan Call"). Seat-relative and safe off-turn: the
      // operands do not depend on whose turn it is, so no `phaseViewOf` guard is needed.
      return isFirstTurnOf(state, seat);
    case "notYourFirstTurn":
      // The complement (Spiteful Evolution's printed first-turn ban).
      return !isFirstTurnOf(state, seat);
  }
}

/**
 * How many of `seat`'s in-play Pokémon carry the owner prefix `owner` ("Team Rocket's"). Active and
 * Bench, stack tops only. Exported for tests but deliberately not re-exported from `index.ts`.
 */
export function countOwnerPokemonInPlay(state: GameState, seat: Seat, owner: string): number {
  return countPokemonInPlay(state, seat, { kind: "ownerPokemon", owner });
}

/**
 * How many of `seat`'s Pokémon in play match `filter`: Active and Bench, top cards only (an evolved
 * stack is one Pokémon). An empty Active Spot counts just the Bench, and a top card missing from
 * the catalog is skipped.
 */
export function countPokemonInPlay(
  state: GameState,
  seat: Seat,
  filter: CardFilter,
  /**
   * When true, count only bodies with damage counters ("for each of your Pokémon that has any
   * damage counters on it"), decided through `hasAnyDamageCounters`. Checked before `topCardOf`, so
   * an undamaged body never costs a catalog lookup.
   */
  damagedOnly = false,
): number {
  const side = state.players[seat];
  return [side.active, ...side.bench].filter((body) => {
    if (body === null) return false;
    if (damagedOnly && !hasAnyDamageCounters(body)) return false;
    // The in-play card, so a typed count reads the types each body has in play.
    const card = inPlayCardOf(state, body);
    return card !== undefined && matchesFilter(card, filter);
  }).length;
}

/**
 * How many cards in `seat`'s discard pile match `filter`. A card in the pile provides no Energy, so
 * an Energy noun is the printed card class (§6.5). An unresolvable uid counts 0.
 */
export function countCardsInDiscardPile(state: GameState, seat: Seat, filter: CardFilter): number {
  let matched = 0;
  for (const uid of state.players[seat].discard) {
    if (matchesFilter(cardOfUid(state, uid), filter)) matched += 1;
  }
  return matched;
}

/**
 * How many cards in `seat`'s hand match `filter`. A card in hand provides no Energy, so an Energy
 * noun is the printed card class (§6.5). This is a full-information count; whether the answer may
 * be shown is decided by the caller. An unresolvable uid counts 0.
 */
export function countCardsInHand(state: GameState, seat: Seat, filter: CardFilter): number {
  let held = 0;
  for (const uid of state.players[seat].hand) {
    if (matchesFilter(cardOfUid(state, uid), filter)) held += 1;
  }
  return held;
}

/**
 * Is `pokemon` barred from attacking by its own always-on printed Ability ("This Pokémon can't
 * attack unless you have 4 or more Team Rocket's Pokémon in play")? Returns the first unmet
 * condition so the §8 gate can name it, or undefined when the body may attack. Read through
 * `passivesOf` so a §9 Ability lock suppresses it; evaluated here because the condition is
 * seat-relative and `passivesOf` has no seat.
 */
export function attackBarredByAbility(
  state: GameState,
  seat: Seat,
  pokemon: InPlayPokemon,
): BoardCondition | undefined {
  return passivesOf(state, pokemon).cantAttackUnless.find(
    (cond) => !conditionHolds(state, seat, cond),
  );
}

/**
 * Does `pokemon`'s printed attack-again licence hold right now for `seat`? "Festival Lead": "If
 * Festival Grounds is in play, this Pokémon may use an attack it has twice." A §9-locked holder
 * contributes no passive, so the licence is silent under an Ability lock.
 */
export function attackAgainLicensed(state: GameState, seat: Seat, pokemon: InPlayPokemon): boolean {
  return passivesOf(state, pokemon).attackTwiceIf.some((cond) => conditionHolds(state, seat, cond));
}

/**
 * Is a declaration by `seat`'s Active barred because the attack-again window is open and this body
 * no longer holds it? While `TurnAllowances.attackAgainUid` is set, only that uid may attack, only
 * from the Active Spot, and only while its licence still holds. False whenever the window is
 * closed. The bag describes the turn's owner only.
 */
export function attackAgainBarred(state: GameState, seat: Seat, active: InPlayPokemon): boolean {
  const uid = state.allowances.attackAgainUid;
  if (uid === null) return false;
  return topUid(active) !== uid || !attackAgainLicensed(state, seat, active);
}

/**
 * The arms of `AttackTimingGate` that can block a declaration. Derived with `Exclude` so a new
 * member lands here by default and must be excluded on purpose.
 */
export type BlockingAttackGate = Exclude<
  AttackTimingGate,
  { kind: "firstTurnExempt" } | { kind: "alternateCostIf" } | { kind: "costWaivedIf" }
>;

/**
 * Is the attack at `index` blocked right now by a printed timing clause on the card? Returns the
 * blocking gate so the §8 reject can name it, or undefined. `onlyIf` blocks while the condition
 * does not hold, `barredIf` while it does; `firstTurnExempt` and the cost clauses never block (they
 * are read by `firstTurnAttackBanned` and `attackCostAt`).
 */
export function attackTimingBlocked(
  state: GameState,
  seat: Seat,
  pokemon: InPlayPokemon,
  index: number,
): BlockingAttackGate | undefined {
  const gate = attackGateOf(state, pokemon, index);
  if (gate === undefined || gate.kind === "firstTurnExempt") return undefined;
  // Cost clauses never block. Returned before the condition is asked: a cost clause whose condition
  // holds makes the attack cheaper, and the polarity line below would refuse it.
  if (gate.kind === "alternateCostIf" || gate.kind === "costWaivedIf") return undefined;
  const holds = conditionHolds(state, seat, gate.condition);
  return (gate.kind === "onlyIf") === holds ? undefined : gate;
}

/** The reject message for a blocked attack index, in the printed polarity. */
export function attackTimingNote(gate: BlockingAttackGate): string {
  return gate.kind === "onlyIf"
    ? `it can only be used if ${conditionNote(gate.condition)}`
    : `it cannot be used while ${conditionNote(gate.condition)}`;
}

/**
 * Is `pokemon` licensed to evolve early right now (the first-turn and played-this-turn bans lifted)
 * for `seat`? True iff a live printed licence on the stack top has its own antecedent holding. Each
 * ban keeps its own error code; this only says whether to skip it. It does not lift Rare Candy's
 * own restriction, and the zone clause is resolved in the fold only for printings that print it.
 * Read through `passivesOf` so a §9 Ability lock silences it.
 */
export function evolveEarlyLicensed(state: GameState, seat: Seat, pokemon: InPlayPokemon): boolean {
  // `.some` and not `.every`: the licences are alternatives (registry.ts's rule
  // that two sources can name one field), so ONE satisfied antecedent is enough —
  // the polarity opposite of `attackBarredByAbility`'s `.find`, which hunts for a
  // gate that FAILS. `undefined` is the entry whose clause the fold already
  // consumed and which has nothing further to ask.
  return passivesOf(state, pokemon).evolveEarlyExempt.some(
    (cond) => cond === undefined || conditionHolds(state, seat, cond),
  );
}

/**
 * Does an Ability on `target` let `card` evolve it under an alias? Eevee ex "Rainbow DNA": "This
 * Pokémon can evolve into any Pokémon ex that evolves from Eevee if you play it from your hand onto
 * this Pokémon." Read through `passivesOf` so a §9 lock silences it. Only the hand evolve asks it;
 * a deck evolve does not.
 */
export function evolveAliasLicensed(state: GameState, target: InPlayPokemon, card: Card): boolean {
  const from = evolveFromOf(card);
  if (from === null) return false;
  const suffix = pokemonSuffixOf(card);
  return passivesOf(state, target).evolveAsNamed.some(
    (alias) => alias.name === from && alias.intoSuffix === suffix,
  );
}

/** The condition as a printed-text fragment, for the reject message a failed
    play gate returns ("<card> can only be used if <this>"). */
export function conditionNote(cond: BoardCondition): string {
  switch (cond.kind) {
    case "morePrizesThanOpponent":
      return "you have more Prize cards remaining than your opponent";
    case "yourStadiumInPlay":
      return "you have a Stadium in play";
    case "opponentStadiumInPlay":
      return "your opponent has a Stadium in play";
    case "stadiumInPlay":
      return "a Stadium is in play";
    case "noEnergyOnYourPokemon":
      return "none of your Pokémon have any Energy attached";
    case "opponentActiveDamaged":
      // The printed clause drops the "already" — that word is about WHEN the
      // condition is read, and a reject/tooltip fragment is read in the present.
      return "your opponent's Active Pokémon has damage counters on it";
    case "opponentActiveIsEvolution":
      return "your opponent's Active Pokémon is an Evolution Pokémon";
    case "opponentActiveIsBasic":
      // The printed "the Defending Pokémon" is dropped: a reject/tooltip fragment is read off the
      // board, where nothing is defending.
      return "your opponent's Active Pokémon is a Basic Pokémon";
    case "opponentActiveIsStage1":
      return "your opponent's Active Pokémon is a Stage 1 Pokémon";
    case "opponentActiveIsStage2":
      return "your opponent's Active Pokémon is a Stage 2 Pokémon";
    case "yourActiveDamaged":
      return "your Active Pokémon has damage counters on it";
    case "yourActiveUndamaged":
      return "your Active Pokémon has no damage counters on it";
    case "yourBenchDamaged":
      return "1 of your Benched Pokémon has damage counters on it";
    case "yourBenchAllDamaged":
      // "All" is kept because the quantifier is the content; without it the note would describe the
      // sibling member.
      return "all of your Benched Pokémon have at least 1 damage counter on them";
    case "yourBenchNamedDamaged":
      return `1 of your Benched ${cond.name} has damage counters on it`;
    case "opponentActivePoisoned":
      return "your opponent's Active Pokémon is Poisoned";
    case "opponentActiveHasSpecialCondition":
      return "your opponent's Active Pokémon is affected by a Special Condition";
    case "yourActiveHasSpecialCondition":
      return "your Active Pokémon is affected by a Special Condition";
    case "yourActivePoisoned":
      return "your Active Pokémon is Poisoned";
    case "yourActiveBurnedOrPoisoned":
      return "your Active Pokémon is Burned or Poisoned";
    case "yourActiveAsleep":
      return "your Active Pokémon is Asleep";
    case "opponentActiveBurned":
      return "your opponent's Active Pokémon is Burned";
    case "opponentActiveConfused":
      return "your opponent's Active Pokémon is Confused";
    case "opponentActiveIsExOrV":
      return "your opponent's Active Pokémon is a Pokémon ex or Pokémon V";
    case "opponentActiveIsEx":
      return "your opponent's Active Pokémon is a Pokémon ex";
    case "yourActiveHasEnergyAttached":
      // Energy reads as the printed name, not the brace code. The basic-Energy arm is spelled out
      // because the template-string fallback would compile and render the wrong text.
      if (cond.energy === "basic") return "your Active Pokémon has a Basic Energy attached";
      return cond.energy === "special"
        ? "your Active Pokémon has a Special Energy attached"
        : `your Active Pokémon has ${cond.energy} Energy attached`;
    case "opponentActiveHasEnergyAttached":
      return cond.energy === "special"
        ? "your opponent's Active Pokémon has a Special Energy attached"
        : `your opponent's Active Pokémon has ${cond.energy} Energy attached`;
    case "yourActiveHasNamedEnergyAttached":
      // The name already ends in "Energy", so it is printed whole.
      return `your Active Pokémon has a ${cond.name} attached`;
    case "opponentPrizesRemaining":
      // Built from the parameter, agreement and all: the printed sentences read
      // "exactly 1 Prize card" and "exactly 2 or 4 Prize cards", so the noun is
      // singular exactly when the only admitted count is 1. `printedList` spells
      // the list the way the pool does, Oxford comma included.
      return `your opponent has exactly ${printedList(cond.counts)} Prize card${
        cond.counts.length === 1 && cond.counts[0] === 1 ? "" : "s"
      } remaining`;
    case "yourPrizesRemaining":
      // The noun is singular exactly when the only admitted count is 1.
      return `you have exactly ${printedList(cond.counts)} Prize card${
        cond.counts.length === 1 && cond.counts[0] === 1 ? "" : "s"
      } remaining`;
    case "opponentHandAtMost":
      return `your opponent has ${cond.count} or fewer cards in their hand`;
    case "handSizesEqual":
      return "you have the same number of cards in your hand as your opponent";
    case "yourHandAtLeast":
      return `you have ${String(cond.count)} or more cards in your hand`;
    case "yourHandExactly":
      // The pill says what the board must look like, so it does not match the printed negative
      // ("you don't have exactly 3…").
      if (cond.count === 1) return "you have exactly 1 card in your hand";
      // Slowbro "All Out" prints the zero as "no cards".
      if (cond.count === 0) return "you have no cards in your hand";
      return `you have exactly ${cond.count} cards in your hand`;
    case "yourHandNotEmpty":
      return "you have at least 1 card in your hand";
    case "yourFaceDownPrizeRemains":
      return "you have at least 1 face-down Prize card";
    case "yourDeckAtMost":
      return `you have ${cond.count} or fewer cards in your deck`;
    case "yourDeckNotEmpty":
      // Naveen's gate: "If you can't draw any cards in this way".
      return "you have at least 1 card in your deck";
    case "yourActiveEnergyAtLeast":
      // `Special` is the card class, not a type, so it reads "Special Energy" rather than "Special
      // Energy Energy"; an absent filter reads plain "Energy".
      return `your Active Pokémon has ${cond.count} or more ${
        cond.energy === undefined
          ? "Energy"
          : cond.energy === "special"
            ? "Special Energy"
            : `${cond.energy} Energy`
      } attached`;
    case "activeEnergyCountsEqual":
      return "your Active Pokémon and your opponent's Active Pokémon have the same amount of Energy attached";
    case "moreActiveEnergyThanOpponent":
      return "your Active Pokémon has more Energy attached than your opponent's Active Pokémon";
    case "opponentActiveHasType":
      return `your opponent's Active Pokémon is a ${cond.type} Pokémon`;
    case "yourActiveHasType":
      return `your Active Pokémon is a ${cond.type} Pokémon`;
    case "opponentActiveHasResistance":
      return `your opponent's Active Pokémon has ${cond.type} Resistance`;
    case "opponentActiveRetreatCostAtLeast":
      return `the Retreat Cost of your opponent's Active Pokémon is ${String(cond.count)} or more`;
    case "yourBenchHasType":
      return `you have any ${cond.type} Pokémon on your Bench`;
    case "opponentInPlayHasType":
      return `your opponent has any ${cond.type} Pokémon in play`;
    case "inPlayTypesIntersect":
      return "any of your Pokémon in play are the same type as any of your opponent's Pokémon in play";
    case "yourBenchHasNamed":
      return `${cond.name} is on your Bench`;
    case "yourBenchHasNameContaining":
      // The quotation marks are printed on the card; dropping them would make the fragment read as
      // a whole card name.
      return `a Pokémon that has "${cond.fragment}" in its name is on your Bench`;
    case "yourNamedPokemonInPlay":
      return `you have ${cond.name} in play`;
    case "yourEnergyInPlayAtLeast":
      // Energy reads as the printed name, not the brace code. The untyped branch is needed because
      // `${null} Energy` would compile and render "null Energy".
      if (cond.energy === null) return `you have at least ${cond.count} Energy in play`;
      return cond.energy === "special"
        ? `you have at least ${cond.count} Special Energy in play`
        : `you have at least ${cond.count} ${cond.energy} Energy in play`;
    case "yourBasicEnergyInDiscardAtLeast":
      return `you have at least ${cond.count} Basic ${cond.energy} Energy cards in your discard pile`;
    case "yourBasicEnergyInHandAtLeast":
      // Singular agreement matters here: counts of 1 are printed ("a Basic {G} Energy card").
      return cond.count === 1
        ? `you have a Basic ${cond.energy} Energy card in your hand`
        : `you have at least ${cond.count} Basic ${cond.energy} Energy cards in your hand`;
    case "yourActiveHasToolAttached":
      return "your Active Pokémon has a Pokémon Tool attached";
    case "opponentActiveHasToolAttached":
      return "your opponent's Active Pokémon has a Pokémon Tool attached";
    case "youPlayedSupporterThisTurn":
      // A full ROUND-TRIP, the family's cleanest: this clause names no pronoun to
      // resolve (the printed subject is already "you", which is what a
      // seat-relative predicate means), no timing word to drop and no card-face
      // glyph to spell out. The printed sentence, verbatim.
      return "you played a Supporter card from your hand during this turn";
    case "yourActivePromotedThisTurn":
      return "your Active Pokémon moved from your Bench to the Active Spot this turn";
    case "yourActiveHealedThisTurn":
      return "your Active Pokémon was healed during this turn";
    case "yourActiveEvolvedFromThisTurn":
      return `your Active Pokémon evolved from ${cond.name} during this turn`;
    case "yourActiveUsedAttackLastTurn":
      return `your Active Pokémon used ${cond.attack} during your last turn`;
    case "yourPokemonUsedAttackLastTurn":
      // The subject is "1 of your Pokémon", not "your Active Pokémon", since a benched body may be
      // the one that bars the attack.
      return `1 of your Pokémon used ${cond.attack} during your last turn`;
    case "yourBenchAtLeast":
      // The POSITIVE fact, in the printed noun — a note is read off the board by a
      // person, so it says what the player must HAVE and never repeats the
      // sentence's "4 or fewer". Reads as a floor because it is one.
      return `you have ${String(cond.count)} or more Benched Pokémon`;
    case "opponentBenchAtLeast":
      return `your opponent has ${String(cond.count)} or more Benched Pokémon`;
    case "yourOwnerPokemonInPlayAtLeast":
      // `owner` is the bare subgroup name, so the possessive is added here, as `matchesFilter`'s
      // `ownerPokemon` arm does.
      return `you have ${String(cond.count)} or more ${cond.owner}'s Pokémon in play`;
    case "yourPokemonAllOwner":
      return `all of your Pokémon in play are ${cond.owner}'s Pokémon`;
    case "yourActiveOwner":
      // The article follows the `ownerPokemon` noun's rule ("an Arven's Pokémon").
      return `your Active Pokémon is ${/^[AEIOU]/.test(cond.owner) ? "an" : "a"} ${cond.owner}'s Pokémon`;
    case "yourActiveHasAbility":
      return `your Active Pokémon has the ${cond.name} Ability`;
    case "yourActiveNamed":
      return `your Active Pokémon is ${cond.name}`;
    case "opponentHasExOrVInPlay":
      // The permission `cantAttackUnless` stores, read as "can't attack unless <this>".
      return "your opponent has a Pokémon ex or Pokémon V in play";
    case "yourActiveDamageCountersAtLeast":
      return `your Active Pokémon has ${cond.count} or more damage counters on it`;
    case "yourActiveRemainingHpAtMost":
      return `your Active Pokémon's remaining HP is ${String(cond.hp)} or less`;
    case "opponentActiveDamageCountersExactly":
      return `your opponent's Active Pokémon has exactly ${String(cond.count)} damage counters on it`;
    case "opponentKnockedOutByDamage":
      return "your opponent's Pokémon is Knocked Out by damage from this attack";
    case "opponentActiveNoRetreatCost":
      return "your opponent's Active Pokémon has no Retreat Cost";
    case "yourActiveWeakToOpponentActiveType":
      return "your Active Pokémon has Weakness to your opponent's Active Pokémon's type";
    case "yourDiscardHasNamed":
      return `${cond.name} is in your discard pile`;
    case "yourDiscardPokemonWithAbilityNamedAtLeast":
      return `you have ${String(cond.count)} or more Pokémon that have the ${cond.ability} Ability in your discard pile`;
    case "yourBenchHasStage2OfType":
      return `you have any Stage 2 ${cond.type} Pokémon on your Bench`;
    case "yourBenchHasNamedEnergyAttached":
      return `your Benched Pokémon have any ${cond.name} attached`;
    case "opponentActiveHasAbility":
      return "your opponent's Active Pokémon has an Ability";
    case "opponentDiscardHasNameContaining":
      // The quotation marks are printed on the card.
      return `your opponent has any cards in their discard pile that have "${cond.fragment}" in the name`;
    case "youPlayedSupporterNamedThisTurn":
      // The Factory's substring form keeps its printed quotation marks; Crobat's exact form names
      // the card.
      return cond.name !== undefined
        ? `you played ${cond.name} from your hand this turn`
        : `you played a Supporter card that has "${cond.nameContains ?? ""}" in its name from your hand this turn`;
    case "stadiumInPlayNamed":
      return `${cond.name} is in play`;
    case "yourBannerPokemonInPlay":
      return `you have any ${cond.banner} Pokémon in play`;
    case "yourBannerPokemonOnBench":
      return `you have any ${cond.banner} Pokémon on your Bench`;
    case "opponentActiveIsBanner":
      return `your opponent's Active Pokémon is a ${cond.banner} Pokémon`;
    case "opponentBannerPokemonInPlay":
      return `your opponent has any ${cond.banner} Pokémon in play`;
    case "yourOtherBannerPokemonAttackedLastTurn":
      return `1 of your other ${cond.banner} Pokémon used an attack during your last turn`;
    case "yourPlayedBannerSupporterThisTurn":
      return `you played ${cond.banner === "Ancient" ? "an" : "a"} ${cond.banner} Supporter card from your hand during this turn`;
    case "opponentStage2PokemonInPlay":
      return "your opponent has any Stage 2 Pokémon in play";
    case "yourMegaExInPlay":
      return cond.type === undefined
        ? "you have any Mega Evolution Pokémon ex in play"
        : `you have any ${cond.type} Mega Evolution Pokémon ex in play`;
    case "yourInPlayToHandAllowed":
      // No printed clause; named after the lock.
      return "your Pokémon in play and attached cards can be put into your hand";
    case "extraEnergyBeyondAttackCost":
      return `this Pokémon has at least ${cond.extra} extra Energy attached (in addition to this attack's cost)`;
    case "yourPokemonKoedOnOpponentsLastTurn":
      // Keeps the printed possessive "your opponent's last turn". The owner and cause narrowings
      // are assembled in printed order, so a card printing both renders its own sentence.
      return `any of your ${cond.owner === undefined ? "" : `${cond.owner}'s `}Pokémon were Knocked Out ${cond.byAttack === undefined ? "" : "by damage from an attack "}during your opponent's last turn`;
    case "youGoSecond":
      return "you go second";
    case "allOf": {
      // Joined with " and ", which does not reproduce the printed scaffolding (Call Bell: "only if
      // you go second, and only during your first turn") but reads correctly after cardplay.ts's
      // "can only be used if". The join is " and " at every arity; no printed sentence conjoins
      // three clauses.
      return cond.conditions.map(conditionNote).join(" and ");
    }
    case "yourFirstTurn":
      // "Once during" belongs to the once-per-turn lock, not the gate, so it is dropped.
      return "it is your first turn";
    case "notYourFirstTurn":
      return "it is not your first turn";
  }
}

/** "1", "2 or 4", "2, 4, or 6" — the pool's own way of printing a count list
    (all three arities appear in it), used by `conditionNote` so a generated
    fragment reads like the card it came from. */
function printedList(values: readonly number[]): string {
  if (values.length <= 1) return String(values[0] ?? 0);
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

/**
 * The attacker's total pre-W/R damage bonus (§8.5) for a hit on the opponent's Active
 * `defenderCard`: unconditional Tool bonuses, board-conditional ones whose condition holds for the
 * attacking `seat`, target-conditional ones whose suffix matches the defender, and the seat-wide
 * aura scan. Shared by both attack-damage sites so each gate is evaluated once.
 */
export function attackerPreWRBonus(
  state: GameState,
  pokemon: InPlayPokemon,
  seat: Seat,
  defenderCard: Card,
): number {
  const passives = passivesOf(state, pokemon);
  // Plus Supreme Overlord's per-Prize term, a scan because it needs the holder's seat.
  let bonus = passives.damageBonusBeforeWR + selfPreWRBonusPerOpponentPrize(state, pokemon);
  for (const { amount, cond } of passives.conditionalDamageBonusBeforeWR) {
    if (conditionHolds(state, seat, cond)) bonus += amount;
  }
  for (const { amount, targetSuffix } of passives.targetConditionalDamageBonusBeforeWR) {
    if (pokemonSuffixOf(defenderCard) === targetSuffix) bonus += amount;
  }
  // The attacker's in-play card for a typed `beneficiary`, and the defender's card for the aura's
  // `target` rider.
  return bonus + seatPreWRDamageBonus(state, seat, inPlayCardOf(state, pokemon), defenderCard);
}
