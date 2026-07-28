import type { Card } from "@luminous/schema";
import type {
  ApplyResult,
  AttachToolAction,
  PlayTrainerAction,
  RareCandyAction,
  ResolveEffectAction,
  UseAbilityAction,
  UseStadiumAbilityAction,
} from "./actions";
import { err, ok } from "./actions";
import { cardOfUid, isBasicPokemon, topUid } from "./cards";
import { disabledAbilityUids } from "./continuous";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { settleProgram } from "./flow";
import type { EffectChoice, EffectPrompt, PokemonRef } from "./interpreter";
import {
  attachEnergyTargets,
  conditionHolds,
  conditionNote,
  discardEnergyPlayable,
  firstAttachableEnergy,
  handCostAction,
  handCostUnmet,
  moveEnergyPlayable,
  resumeProgram,
  runProgram,
} from "./interpreter";
import { programFor } from "./registry";
import { isBenchIndex, isPokemonTarget, placeEvolution, turnGate } from "./turn";
import type { GameState, InPlayPokemon, PlayerSide, PokemonTarget, Seat } from "./types";
import { otherSeat, withSide, without } from "./types";

// The M4 card-play actions (§7 Trainers, §9 Abilities) and the resolver for the
// mid-effect decisions they park on (§15.E/G). playTrainer/useAbility/
// resolveEffect orchestrate the same shared interpreter (interpreter.ts):
// validate the play, announce it, run the op program, and either finish (back
// to turn:action) or PARK on effect:choose. The two persistent-zone plays are
// different animals — a Stadium (§7.3) moves into the shared zone and a Tool
// (§7.4, attachTool) onto a Pokémon, both with CONTINUOUS effects the
// pipeline reads (continuous.ts) rather than programs the interpreter runs.

/** §7.1–§7.3 — play a Trainer from hand: an Item (any number) or Supporter
    (one per turn) resolves its authored program then discards; a Stadium (one
    play per turn) replaces the shared zone's occupant — different names only —
    and STAYS in play, its continuous effects live from this moment. */
export function playTrainer(state: GameState, action: PlayTrainerAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  const side = state.players[action.seat];
  if (!side.hand.includes(action.uid)) {
    return err("CARD_NOT_IN_HAND", `${action.uid} is not in ${action.seat}'s hand`);
  }
  const card = cardOfUid(state, action.uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${action.uid}`);
  }
  if (card.category !== "Trainer") {
    return err("NOT_A_TRAINER", `${card.name} is not a Trainer card`);
  }
  const entry = programFor(card.id);
  if (entry?.rareCandy === true) {
    // Rare Candy evolves (it carries a target Basic + a Stage 2), so it is not
    // a program-running Trainer — it goes through the dedicated `rareCandy`
    // action (the same shape as a Tool routing to attachTool).
    return err("TRAINER_TYPE_UNSUPPORTED", "Rare Candy is played via the rareCandy action (§7.1)");
  }
  const trainerType = card.trainerType;
  if (trainerType === "Stadium") {
    return playStadium(state, action, card.id, card.name);
  }
  if (trainerType === "Tool") {
    // Not a play — Tools attach (attachTool carries the required target).
    return err("TRAINER_TYPE_UNSUPPORTED", "Pokémon Tools are attached via attachTool (§7.4)");
  }
  if (trainerType !== "Item" && trainerType !== "Supporter") {
    return err("TRAINER_TYPE_UNSUPPORTED", `${trainerType ?? "this"} Trainers are not supported yet`);
  }
  const program = entry?.trainer;
  if (program === undefined) {
    // Coverage strategy: an unauthored Trainer surfaces loudly rather than
    // playing as a silent no-op that still costs the player the card.
    return err("TRAINER_NOT_SIMULATED", `${card.name} is not simulated yet`);
  }
  if (trainerType === "Supporter") {
    // §4 — the going-first player may not play a Supporter on turn 1 (turn 1 is
    // by construction their turn, and the gate proved this is the actor's turn).
    if (state.turn === 1) {
      return err("FIRST_TURN_SUPPORTER", "the going-first player cannot play a Supporter on turn 1 (§4)");
    }
    if (state.allowances.supporterPlayed) {
      return err("SUPPORTER_ALREADY_PLAYED", "only one Supporter per turn (§7.2)");
    }
  }
  // The card's own printed "You can use this card only if …" line (Fighting Au
  // Lait). Checked HERE — before the card leaves hand below — so a rejected play
  // costs nothing; and against `state`, the board the player is looking at.
  const playGate = entry?.trainerPlayableIf;
  if (playGate !== undefined && !conditionHolds(state, action.seat, playGate)) {
    return err("PLAY_CONDITION_NOT_MET", `${card.name} can only be used if ${conditionNote(playGate)}`);
  }
  // The card's OTHER printed "only if" — a hand COST rather than a board
  // condition (Ultra Ball's "only if you discard 2 OTHER cards from your hand";
  // Dendra's "(If you have no OTHER cards in your hand, you can't use this
  // card.)", the same gate stated as its contrapositive).
  // Checked beside the gate above because both are printed RULES, not
  // programPlayable's would-only-whiff heuristics; and checked with the played
  // uid EXCLUDED, which is exactly what the printed word "other" means — the card
  // is still in hand right now and cannot pay for itself (it is about to become
  // the discard's newest card, not one of the two the player picks).
  const unpayable = handCostUnmet(state, action.seat, program, action.uid);
  if (unpayable !== null) {
    return err(
      "PLAY_CONDITION_NOT_MET",
      `${card.name} can only be used if you ${handCostAction(unpayable, true)}`,
    );
  }
  if (!programPlayable(state, program, action.seat)) {
    return err("NO_LEGAL_TARGET", `${card.name} has no legal target`);
  }

  // Play it: the card leaves hand for the discard (Item/Supporter discard after
  // resolving — none in scope references itself mid-effect, so discarding up
  // front is equivalent and spares threading its uid through the continuation).
  const events: GameEvent[] = [
    { type: "TRAINER_PLAYED", seat: action.seat, uid: action.uid, trainerType },
  ];
  let next: GameState = withSide(state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
    discard: [...side.discard, action.uid],
  });
  if (trainerType === "Supporter") {
    next = { ...next, allowances: { ...next.allowances, supporterPlayed: true } };
  }
  // Katy "your turn ends": a Trainer that ends the turn on completion, folded by
  // settleProgram exactly like an Ability's endsTurn (the Koraidon precedent).
  const endsTurn = entry?.trainerEndsTurn === true;
  return settleProgram(runProgram(next, program, { seat: action.seat }, events), action.seat, events, {
    endsTurn,
  });
}

/** §7.3 — the Stadium play, split out of playTrainer's Item/Supporter path
    (hand/uid/category already validated there): one play per turn, replaces a
    DIFFERENT-named predecessor (which goes to its owner's discard), and the
    card sits in the shared zone with no program to run — its authored effects
    are continuous, read by the pipeline (continuous.ts) while it stays. */
function playStadium(
  state: GameState,
  action: PlayTrainerAction,
  cardId: string,
  cardName: string,
): ApplyResult {
  if (programFor(cardId)?.stadium === undefined) {
    // Coverage strategy, same as the Item/Supporter path: an unauthored
    // Stadium cannot be played rather than sitting in the zone doing nothing.
    return err("TRAINER_NOT_SIMULATED", `${cardName} is not simulated yet`);
  }
  if (state.allowances.stadiumPlayed) {
    return err("STADIUM_ALREADY_PLAYED", "only one Stadium play per turn (§7.3)");
  }
  const current = state.stadium;
  const currentCard = current === null ? undefined : cardOfUid(state, current.uid);
  // §7.3 — the same NAME cannot replace itself (no resetting the zone);
  // different prints of one Stadium share the name, so this compares names,
  // not ids. An unresolvable occupant (structurally impossible) reads as
  // replaceable — stay total.
  if (currentCard !== undefined && currentCard.name === cardName) {
    return err("STADIUM_SAME_NAME", `${cardName} is already in play (§7.3)`);
  }

  const events: GameEvent[] = [
    { type: "TRAINER_PLAYED", seat: action.seat, uid: action.uid, trainerType: "Stadium" },
  ];
  const side = state.players[action.seat];
  let next: GameState = withSide(state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
  });
  if (current !== null) {
    // The replaced Stadium goes to its OWNER's discard pile — read off `next`
    // so an actor discarding their own earlier Stadium keeps the hand update.
    const ownerSide = next.players[current.owner];
    next = withSide(next, current.owner, {
      ...ownerSide,
      discard: [...ownerSide.discard, current.uid],
    });
    events.push({ type: "STADIUM_DISCARDED", seat: current.owner, uid: current.uid });
  }
  next = {
    ...next,
    stadium: { uid: action.uid, owner: action.seat },
    allowances: { ...next.allowances, stadiumPlayed: true },
  };
  return ok(next, events);
}

/** §7.4 — attach a Pokémon Tool from hand to one of the actor's own in-play
    Pokémon. Not capped per turn and consumes NO allowance (unlike energy);
    one Tool per Pokémon at a time; there is no detach — it rides the stack
    through evolution and leaves play only with a KO. Its effects are
    continuous (continuous.ts), so nothing runs here. */
export function attachTool(state: GameState, action: AttachToolAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  const side = state.players[action.seat];
  if (!side.hand.includes(action.uid)) {
    return err("CARD_NOT_IN_HAND", `${action.uid} is not in ${action.seat}'s hand`);
  }
  const card = cardOfUid(state, action.uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${action.uid}`);
  }
  if (card.category !== "Trainer" || card.trainerType !== "Tool") {
    return err("NOT_A_TOOL", `${card.name} is not a Pokémon Tool card`);
  }
  if (programFor(card.id)?.passive === undefined) {
    // Coverage strategy: an unauthored Tool would occupy the one Tool slot
    // while doing nothing — reject loudly instead.
    return err("TRAINER_NOT_SIMULATED", `${card.name} is not simulated yet`);
  }
  // Wire shape check (types are not validation), then the same indexed
  // write-back attachEnergy uses — including its string-index trap.
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "tool target must name the Active spot or a bench index");
  }

  const hand = without(side.hand, action.uid);
  let updated: PlayerSide;
  if (action.target.spot === "active") {
    if (side.active === null) {
      return err("NO_TARGET", "no Active Pokémon to attach to");
    }
    if (side.active.tools.length > 0) {
      return err("TOOL_ALREADY_ATTACHED", "one Tool per Pokémon (§7.4)");
    }
    updated = {
      ...side,
      hand,
      active: { ...side.active, tools: [...side.active.tools, action.uid] },
    };
  } else {
    const index = action.target.index;
    const benched = isBenchIndex(index) ? side.bench[index] : undefined;
    if (benched === undefined) {
      return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(index)}`);
    }
    if (benched.tools.length > 0) {
      return err("TOOL_ALREADY_ATTACHED", "one Tool per Pokémon (§7.4)");
    }
    const bench = side.bench.map((pokemon, i) =>
      i === index ? { ...pokemon, tools: [...pokemon.tools, action.uid] } : pokemon,
    );
    updated = { ...side, hand, bench };
  }
  return ok(withSide(state, action.seat, updated), [
    // The target is copied: the action object belongs to the caller (events.ts).
    { type: "TOOL_ATTACHED", seat: action.seat, uid: action.uid, target: { ...action.target } },
  ]);
}

/** §7.1 — Rare Candy: evolve one of the actor's own Basic Pokémon straight to a
    Stage 2 from hand, skipping the Stage 1. An Item (unbounded per turn, no
    allowance), but it EVOLVES rather than running an interpreter program — so it
    reuses the shared evolution placement (turn.ts placeEvolution) and thus the
    on-evolve triggered Ability + the evolve-below-HP mid-turn KO, exactly like
    `evolve`. Timing mirrors evolve (§4 first-turn ban + not a Basic that came
    into play this turn). Every wire value is runtime-checked (the D14 contract):
    the target shape and index, both hand uids, and the Basic-and-chain link. */
export function rareCandy(state: GameState, action: RareCandyAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  // §7.1/§4 — no Rare Candy on your own first turn (the same ban evolve carries;
  // firstPlayer takes odd turns, so their first turn is 1 and the other's is 2).
  if (state.turn === (action.seat === state.firstPlayer ? 1 : 2)) {
    return err("FIRST_TURN_EVOLVE", "cannot use Rare Candy on your first turn (§4/§7.1)");
  }
  const side = state.players[action.seat];
  if (!side.hand.includes(action.uid)) {
    return err("CARD_NOT_IN_HAND", `${action.uid} is not in ${action.seat}'s hand`);
  }
  const card = cardOfUid(state, action.uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${action.uid}`);
  }
  if (card.category !== "Trainer") {
    return err("NOT_A_TRAINER", `${card.name} is not a Trainer card`);
  }
  if (programFor(card.id)?.rareCandy !== true) {
    return err("TRAINER_NOT_SIMULATED", `${card.name} is not Rare Candy`);
  }
  // Resolve the target Basic (the actor's own in-play) — wire shape check, then
  // the string-index trap at the bench use site (same as attachEnergy/evolve).
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "Rare Candy target must name the Active spot or a bench index");
  }
  let target: InPlayPokemon;
  let benchIndex = -1;
  if (action.target.spot === "active") {
    if (side.active === null) return err("NO_TARGET", "no Active Pokémon to evolve");
    target = side.active;
  } else {
    benchIndex = action.target.index;
    const benched = isBenchIndex(benchIndex) ? side.bench[benchIndex] : undefined;
    if (benched === undefined) {
      return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(benchIndex)}`);
    }
    target = benched;
  }
  const fromUid = topUid(target);
  const targetCard = fromUid === undefined ? undefined : cardOfUid(state, fromUid);
  if (fromUid === undefined || targetCard === undefined) {
    return err("UNKNOWN_CARD", "the target Pokémon has no resolvable top card");
  }
  // §7.1 — the target must be a BASIC in play, and not one that came into play
  // this turn (the same window evolve rejects with EVOLVE_TOO_SOON).
  if (!isBasicPokemon(targetCard)) {
    return err("NOT_A_BASIC_POKEMON", "Rare Candy only evolves a Basic Pokémon (§7.1)");
  }
  if (target.turnPlayed >= state.turn) {
    return err("EVOLVE_TOO_SOON", `${targetCard.name} came into play this turn — Rare Candy cannot evolve it (§7.1)`);
  }
  // §7.1 — the Stage 2 in hand that evolves (through its Stage 1) from that
  // Basic. Distinct from the Rare Candy card itself, actually in hand, a valid
  // chain (stage2EvolvesFromBasic bridges Basic→Stage 2 via the Stage 1 name).
  if (action.evolutionUid === action.uid || !side.hand.includes(action.evolutionUid)) {
    return err("CARD_NOT_IN_HAND", `${action.evolutionUid} is not in ${action.seat}'s hand`);
  }
  const stage2 = cardOfUid(state, action.evolutionUid);
  if (stage2 === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${action.evolutionUid}`);
  }
  if (!stage2EvolvesFromBasic(state, stage2, targetCard.name)) {
    return err(
      "RARE_CANDY_NO_STAGE2",
      `${stage2.name} is not a Stage 2 that evolves from ${targetCard.name} (§7.1)`,
    );
  }
  // Play it: Rare Candy → discard, the Stage 2 leaves hand onto the stack. Both
  // leave hand together (up front), then the shared placement runs the evolve +
  // its on-evolve trigger + the evolve-below-HP mid-turn KO check.
  const hand = without(without(side.hand, action.uid), action.evolutionUid);
  const stateAfterHand = withSide(state, action.seat, {
    ...side,
    hand,
    discard: [...side.discard, action.uid],
  });
  const events: GameEvent[] = [
    { type: "TRAINER_PLAYED", seat: action.seat, uid: action.uid, trainerType: "Item" },
  ];
  return placeEvolution(
    stateAfterHand,
    action.seat,
    action.target,
    benchIndex,
    target,
    fromUid,
    action.evolutionUid,
    events,
  );
}

/** Rare Candy (§7.1): does `stage2` (a card in the actor's hand) evolve —
    through its Stage 1 — from a Basic named `basicName`? The catalog stores only
    each card's IMMEDIATE `evolveFrom` (a Stage 2 names its Stage 1, never the
    Basic), so we BRIDGE: `stage2.evolveFrom` names a Stage 1, and some card in
    the pool with that Stage-1 name evolves from `basicName`. The bridge Stage 1
    need not be in play or hand — only KNOWN to the card pool (the two decks'
    cards). DOCUMENTED GAP: a deck that runs no copy of the Stage 1 at all cannot
    resolve the link until the full evolution family is persisted at ingest (the
    same ingest-debt class as prizeValueOf = 1 and name-derived energy). */
function stage2EvolvesFromBasic(state: GameState, stage2: Card, basicName: string): boolean {
  if (stage2.category !== "Pokemon" || stage2.stage !== "Stage2") return false;
  const stage1Name = stage2.evolveFrom;
  if (stage1Name === null) return false;
  return Object.values(state.cardPool).some(
    (c) => c.stage === "Stage1" && c.name === stage1Name && c.evolveFrom === basicName,
  );
}

/** A legal Rare Candy play the HUD can offer (§7.1): one of the actor's Basics
    in play that has ≥1 matching Stage 2 in hand. The engine authority the Rare
    Candy dialog reads so it never offers an illegal pairing — the `rareCandy`
    handler still re-validates every wire value. */
export interface RareCandyOption {
  /** The Basic's spot (Active or a bench index). */
  target: PokemonTarget;
  /** The Basic's stack-top uid (display / stable key). */
  basicUid: string;
  /** The matching Stage 2 uids in the actor's hand. */
  stage2Uids: string[];
}

/** Every legal Rare Candy target for `seat` right now (empty on the first turn
    — the §4 ban — or when no Basic-in-play links to a Stage 2 in hand). Mirrors
    the handler's Basic / turnPlayed / chain checks, so an option here always
    resolves to a legal `rareCandy` action. */
export function rareCandyOptions(state: GameState, seat: Seat): RareCandyOption[] {
  if (state.turn === (seat === state.firstPlayer ? 1 : 2)) return [];
  const side = state.players[seat];
  const options: RareCandyOption[] = [];
  const consider = (pokemon: InPlayPokemon | null, target: PokemonTarget) => {
    if (pokemon === null || pokemon.turnPlayed >= state.turn) return;
    const uid = topUid(pokemon);
    const card = uid === undefined ? undefined : cardOfUid(state, uid);
    if (uid === undefined || card === undefined || !isBasicPokemon(card)) return;
    const stage2Uids = side.hand.filter((h) => {
      const c = cardOfUid(state, h);
      return c !== undefined && stage2EvolvesFromBasic(state, c, card.name);
    });
    if (stage2Uids.length > 0) options.push({ target, basicUid: uid, stage2Uids });
  };
  consider(side.active, { spot: "active" });
  side.bench.forEach((pokemon, index) => consider(pokemon, { spot: "bench", index }));
  return options;
}

/** §9 — use an in-play Pokémon's activated Ability. Does not cost energy, does
    not end the turn (once-per-turn per Pokémon, tracked in TurnAllowances). */
export function useAbility(state: GameState, action: UseAbilityAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "ability target must name the Active spot or a bench index");
  }
  const resolved = resolveOwnPokemon(state, action.seat, action.target);
  if (resolved.reject !== undefined) return resolved.reject;
  const uid = resolved.uid;
  const card = cardOfUid(state, uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${uid}`);
  }
  const ability = (programFor(card.id)?.abilities ?? []).find((a) => a.name === action.abilityName);
  if (ability === undefined) {
    return err("NO_SUCH_ABILITY", `${card.name} has no usable Ability "${action.abilityName}"`);
  }
  // §9 — a continuous Ability-lock aura (Klefki / Spiritomb / Ting-Lu ex) turns
  // this Pokémon's Abilities off. Checked before activeOnly/oncePerTurn/cost so a
  // locked Pokémon reports the lock, not an incidental cost failure.
  if (disabledAbilityUids(state).has(uid)) {
    return err("ABILITY_DISABLED", `${card.name} has no Abilities right now (§9)`);
  }
  if (ability.activeOnly && action.target.spot !== "active") {
    return err("ABILITY_ACTIVE_ONLY", `${ability.name} can only be used from the Active Spot (§9)`);
  }
  const usedKey = `${uid}:${ability.name}`;
  if (ability.oncePerTurn && state.allowances.abilitiesUsed.includes(usedKey)) {
    return err("ABILITY_ALREADY_USED", `${ability.name} was already used this turn (§9)`);
  }
  // A card that would do NOTHING cannot be used — the snipe needs an opponent
  // Bench, exactly as a gust needs one (the shared programPlayable gate). This
  // also guards Meowscarada's discard cost from being spent for no effect.
  if (!programPlayable(state, ability.program, action.seat)) {
    return err("NO_LEGAL_TARGET", `${ability.name} has no legal target`);
  }
  // §9 activation cost — the printed "You must discard … from your hand in order
  // to use this Ability" (Meowscarada ex, Radiant Blastoise, Revavroom,
  // Tinkaton). The cost is the FIRST op of the Ability's own program, so the
  // payment itself happens in the interpreter (it can PARK on which cards); what
  // has to happen HERE is refusing the use before anything is committed, since a
  // program that ran with an unpayable cost would hand out the effect for free.
  //
  // No `excludeUid`: an Ability's card is on the BOARD, not in the hand it pays
  // out of — which is why none of these cards prints the "other" that every
  // Trainer in the family does.
  const unpayable = handCostUnmet(state, action.seat, ability.program);
  if (unpayable !== null) {
    return err(
      "ABILITY_COST_UNMET",
      // The VERB comes from the destination, like the Trainer path's message: no
      // printed Ability pays anywhere but the discard today, and a message that
      // hard-codes "discard" is the same latent bug the Trainer side just fixed.
      `${ability.name} can only be used if you ${handCostAction(unpayable, false)} (§9)`,
    );
  }

  const events: GameEvent[] = [{ type: "ABILITY_USED", seat: action.seat, uid, ability: ability.name }];
  let next = state;
  if (ability.oncePerTurn) {
    next = {
      ...next,
      allowances: {
        ...next.allowances,
        abilitiesUsed: [...next.allowances.abilitiesUsed, usedKey],
      },
    };
  }
  return settleProgram(
    runProgram(next, ability.program, { seat: action.seat, sourceUid: uid }, events),
    action.seat,
    events,
    { endsTurn: ability.endsTurn === true },
  );
}

/** §7.3 — activate the shared Stadium's "once during each player's turn" ability
    (Artazon / Mesagoza / Town Store). Simpler than useAbility: there is exactly
    ONE shared Stadium, so no target; the turnGate admits only the turn's own
    player (turn:action, phase.seat), so "each player's turn" needs no
    non-active-seat routing — the opponent activates it on THEIR own turn, off
    their own fresh allowance. Not affected by the D100 ability-lock aura (that
    targets Pokémon, and a Stadium is neither). No hand-cost path: no printed
    Stadium ability pays one. The program runs under the activating seat, so it
    searches THAT player's deck and benches onto THEIR board. */
export function useStadiumAbility(
  state: GameState,
  action: UseStadiumAbilityAction,
): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  const stadium = state.stadium;
  if (stadium === null) {
    return err("STADIUM_ABILITY_UNAVAILABLE", "no Stadium is in play (§7.3)");
  }
  const card = cardOfUid(state, stadium.uid);
  const ability = card === undefined ? undefined : programFor(card.id)?.stadium?.ability;
  if (ability === undefined) {
    return err(
      "STADIUM_ABILITY_UNAVAILABLE",
      "the Stadium in play has no activated Ability (§7.3)",
    );
  }
  if (state.allowances.stadiumAbilityUsed) {
    return err("STADIUM_ABILITY_ALREADY_USED", `${ability.label} was already used this turn (§7.3)`);
  }
  // Would-only-whiff gate, exactly as useAbility (Mesagoza's heads-branch search
  // is always playable enough; a search that can only whiff is still a search).
  if (!programPlayable(state, ability.program, action.seat)) {
    return err("NO_LEGAL_TARGET", `${ability.label} has no legal target`);
  }
  const events: GameEvent[] = [
    { type: "STADIUM_ABILITY_ACTIVATED", seat: action.seat, uid: stadium.uid, stadium: ability.label },
  ];
  const next: GameState = {
    ...state,
    allowances: { ...state.allowances, stadiumAbilityUsed: true },
  };
  return settleProgram(
    runProgram(next, ability.program, { seat: action.seat, sourceUid: stadium.uid }, events),
    action.seat,
    events,
  );
}

/** Resolve the parked effect:choose decision: validate the choice against the
    prompt, apply the awaited op, and run the rest of the program (which may
    park again). */
export function resolveEffect(state: GameState, action: ResolveEffectAction): ApplyResult {
  if (state.phase.kind !== "effect:choose") {
    return err("BAD_PHASE", `resolveEffect is not legal during ${state.phase.kind}`);
  }
  const phase = state.phase;
  // Who may ANSWER: the phase's answerer when one is filed (the opponent's
  // printed "may" — Ortega's mayDraw park), else the controller as ever. The
  // controller cannot answer the opponent's "may" for them, and vice versa.
  const answerer = phase.answerer ?? phase.seat;
  if (answerer !== action.seat) {
    return err("WRONG_SEAT", `only ${answerer} resolves this effect`);
  }
  // A resumeTail park is MID-TAIL: the stages that finish the job (the KO sweep's
  // prizes/promotions, or an attack's epilogue) must still be queued behind it,
  // because settleProgram's resumeTail branch hands control to `advance` and
  // writes NO phase of its own — an empty queue there would return this very
  // effect:choose phase again, with the same continuation, forever. Unreachable
  // through the engine's own transitions (both producers queue before they run),
  // so this is the ko:* handlers' crafted-snapshot guard (attack.ts) applied to
  // the one fold that cannot recover on its own.
  if (phase.resumeTail === true && state.pending.length === 0) {
    return err("PHASE_DESYNC", "a mid-tail effect park has no pending tail to resume");
  }
  const invalid = validateChoice(phase.prompt, action.choice);
  if (invalid !== null) return invalid;
  const events: GameEvent[] = [];
  // resumeTail (§9 on-KO trigger, flow.ts): this park was made MID-KO-SWEEP, so
  // finishing the program resumes the remaining prize/promotion tail rather than
  // folding back to a turn. Absent for every other parked effect (turn:action).
  return settleProgram(resumeProgram(state, phase.cont, action.choice, events), phase.seat, events, {
    resumeTail: phase.resumeTail === true,
    // endsTurn (Koraidon "Dino Cry"): the parked Ability ends the turn once its
    // program finishes, threaded across re-parks by settleProgram.
    endsTurn: phase.endsTurn === true,
  });
}

/** A program whose only effect targets a zone that is empty does nothing, and a
    card/Ability that would do nothing cannot be played (gust and the snipe need
    an opponent Bench, Switch needs your own Bench). Search/draw/heal are always
    "playable enough" (they may whiff — fail a search, heal an undamaged
    Pokémon), which also matches the rule's own limit: the deck is not public
    knowledge, so "this search will find nothing" is not a fact the game state
    establishes. Shared by playTrainer and useAbility — and EXPORTED for the
    HUD's row lighting (D52): every input it reads is public to the seat asking
    (zone counts and the seat's own board), so the web can grey a dead Trainer
    row with the engine's own predicate instead of offering a button the click
    will refuse — the recurring review HIGH, closed at the source. */
export function programPlayable(state: GameState, program: readonly EffectOp[], seat: Seat): boolean {
  for (const op of program) {
    if (op.op === "coinFlipGate") {
      // DESCEND INTO THE HEADS BRANCH. A coin gate has no `otherwise`, so its
      // `then` is the only thing the card can ever do — tails does nothing at
      // all. A heads branch that could only whiff therefore means the whole card
      // could only whiff, and §7's "you cannot play a card if it has no valid
      // target" applies: the flip is PROCEDURE, not effect (the rulebook's own
      // attack sequence separates "flip a coin" from applying effects), so it
      // cannot be the effect that makes the card playable. Compendium ruling/906
      // ("you cannot play a card if it has no valid target", reconfirmed by the
      // TPCi Rules Team 2025-06-26) with ruling/284 drawing the line this sits
      // on: "playing a card for no effect happens when THE GAME STATE ITSELF
      // prevents any effect from taking place". The apparent counter-precedent
      // (Unown-E's Hidden Power forcing all flips tails, yet flip Trainers stay
      // playable) is the OTHER branch of that same ruling — blocked by an effect
      // in play, not by the board. Reaches Crushing Hammer (no Energy anywhere on
      // the opponent's board) and Pokémon Catcher (an empty opponent Bench);
      // Poké Ball is untouched, since a deck search is always playable enough.
      //
      // NOT extended to `conditionGate`: no printed sv01–03 card puts a
      // whiff-able op inside one (Falkner and Grusha branch into draws), and
      // deciding it properly means EVALUATING the condition here and scanning
      // only the arm that will actually run — a bigger claim than this pure
      // implication, and one no card needs yet.
      if (!programPlayable(state, op.then, seat)) return false;
      continue;
    }
    if (op.op === "gust" && state.players[otherSeat(seat)].bench.length === 0) return false;
    if (op.op === "damageChosen" && state.players[otherSeat(seat)].bench.length === 0) return false;
    if (op.op === "bottomFromOpponentHand" && state.players[otherSeat(seat)].hand.length === 0) {
      // An empty opponent hand is PUBLIC knowledge (the count shows), so
      // "this can only whiff" is a fact the board states — the Catcher/Hammer
      // class, not Poké Ball's. Reads hand LENGTH and never the op's filter:
      // whether a non-empty hidden hand holds a match is exactly what the game
      // state does NOT establish (ruling/284's line), so a filtered op into a
      // matchless hand stays playable and reveals — which is also the played
      // card working as printed (the reveal happens; the pick whiffs).
      return false;
    }
    if (op.op === "switchActive" && state.players[seat].bench.length === 0) return false;
    if (
      op.op === "attachEnergyFrom" &&
      (firstAttachableEnergy(state, seat, op.source, op.energyType) === undefined ||
        attachEnergyTargets(state, seat, op).length === 0)
    ) {
      // No matching Basic Energy in the source zone, OR no eligible target
      // (targetType / notIfKO riders) → the attach can only whiff.
      return false;
    }
    // `attachFromTop` and `attachFromDeck` are deliberately NOT gated — see the
    // ops' own docs (effects.ts). A gate here would be an AND over ops applied to
    // a card whose OTHER printed clause always resolves, which is precisely the
    // case ruling/284 (quoted above) excludes: every card carrying either op also
    // prints a shuffle, and shuffling your deck is an effect players buy on
    // purpose. Note this bites HARDER on the search op than on the top-N one,
    // because a Supporter carries it — Janine's Secret Art into a board with no
    // {D} Pokémon spends the turn's one Supporter (§7.2) on a bare shuffle, where
    // Electric Generator only spends a card. Doctrine over cost; the prompt is the
    // mitigation (see the Miriam precedent, docs/workstreams/simulator.md).
    //
    // `payFromHand` is not gated here either, for the opposite reason:
    // it DOES veto the whole card, but on the card's own printed authority
    // ("You can use this card only if…") rather than this function's judgement
    // about ops that would whiff — and the Trainer form needs the played uid
    // excluded, which this function cannot see. Both action paths call
    // `handCostUnmet` themselves, beside `trainerPlayableIf`.
    if (op.op === "moveEnergy" && !moveEnergyPlayable(state, seat, op)) {
      // No movable Energy, or fewer than two of your Pokémon in play (no distinct
      // destination) → the move can only whiff (Energy Switch / Poppy).
      return false;
    }
    if (op.op === "discardEnergy" && !discardEnergyPlayable(state, seat, op)) {
      // Nothing matching on the opponent's board → the discard can only whiff
      // (Giacomo into a board with no Special Energy — rejected rather than
      // spending the turn's one Supporter, §7.2).
      //
      // THIS REACHES CRUSHING HAMMER TOO, through the coinFlipGate branch above.
      // An earlier version of this comment claimed the opposite ("only TOP-LEVEL
      // ops are scanned, so Crushing Hammer's coin-GATED discard stays playable
      // either way") — it predated D41, which added that descent for exactly
      // this card and says so in its own comment. The descent wins, and it is
      // the intended reading: ruling/906 makes the flip PROCEDURE, not effect,
      // so a heads branch that could only whiff means the card could only whiff.
      // Corrected here rather than in one place only, because the two comments
      // disagreeing is how a reader concludes either behaviour is fine — and
      // since 0.32.0 the HUD greys the row with this predicate, so the
      // disagreement would now read to a player as a printed rule.
      return false;
    }
  }
  return true;
}

/** Resolve one of the actor's own in-play Pokémon off a wire target: the
    Active (must be present) or a benched index (checked like every wire index). */
function resolveOwnPokemon(
  state: GameState,
  seat: Seat,
  target: PokemonTarget,
): { pokemon: InPlayPokemon; uid: string; reject?: undefined } | { reject: ApplyResult } {
  const side = state.players[seat];
  let pokemon: InPlayPokemon;
  if (target.spot === "active") {
    if (side.active === null) return { reject: err("NO_TARGET", "no Active Pokémon") };
    pokemon = side.active;
  } else {
    const benched = isBenchIndex(target.index) ? side.bench[target.index] : undefined;
    if (benched === undefined) {
      return { reject: err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(target.index)}`) };
    }
    pokemon = benched;
  }
  const uid = topUid(pokemon);
  if (uid === undefined) return { reject: err("UNKNOWN_CARD", "the Pokémon has no resolvable top card") };
  return { pokemon, uid };
}

/** Wire-check a resolveEffect choice against the parked prompt (a P4 client
    controls it): the right kind, and every uid/ref among the legal options. */
function validateChoice(prompt: EffectPrompt, choice: EffectChoice): ApplyResult | null {
  if (typeof choice !== "object" || choice === null) {
    return err("BAD_EFFECT_CHOICE", "choice must be an object");
  }
  switch (prompt.kind) {
    case "chooseCards": {
      if (choice.kind !== "cards" || !Array.isArray(choice.uids)) {
        return err("BAD_EFFECT_CHOICE", "expected a card choice");
      }
      if (choice.uids.length > prompt.max) {
        return err("BAD_EFFECT_CHOICE", `pick at most ${prompt.max} card(s)`);
      }
      // The FLOOR — 0 for every printed "up to" (a decline is a legal answer),
      // `count` for the mandatory hand COST, where the only decision is which
      // cards and an empty answer would take the effect without paying for it.
      if (choice.uids.length < prompt.min) {
        return err("BAD_EFFECT_CHOICE", `pick at least ${prompt.min} card(s)`);
      }
      const candidates = new Set(prompt.candidates);
      const seen = new Set<string>();
      for (const uid of choice.uids) {
        if (typeof uid !== "string" || !candidates.has(uid)) {
          // Reads off the PROMPT: this validator now serves a deck search, a
          // discard-pile retrieval, a look at the deck top AND a hand cost, so
          // "searchable" was only ever right for the first of them.
          return err("BAD_EFFECT_CHOICE", `${String(uid)} is not a legal card for this choice`);
        }
        if (seen.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
        seen.add(uid);
      }
      return null;
    }
    case "choosePokemonMulti": {
      // `min`..`max` DISTINCT offered refs — and the printed number is EXACT
      // unless the card says "up to" ("put 3 damage counters on 1 of your
      // opponent's Benched Pokémon" is not "up to 1"), so the floor is what
      // stops a player from paying an irreversible hand cost and then placing
      // nothing. An "up to" prompt (Saguaro's heal) carries min: 0, and there
      // the floor never rejects — 0, 1, … max are all printed answers.
      //
      // The empty answer is legal only where the card prints "you may"
      // (`declinable` — Hawlucha, whose trigger the framework auto-fires, so the
      // decline has nowhere else to live). It is ALL-OR-NOTHING: none, or the
      // full `min`, never one of two.
      if (choice.kind !== "pokemonMulti" || !Array.isArray(choice.refs)) {
        return err("BAD_EFFECT_CHOICE", "expected a Pokémon multi-choice");
      }
      if (choice.refs.length > prompt.max) {
        return err("BAD_EFFECT_CHOICE", `pick at most ${prompt.max} Pokémon`);
      }
      if (choice.refs.length < prompt.min && !(prompt.declinable && choice.refs.length === 0)) {
        return err("BAD_EFFECT_CHOICE", `pick ${prompt.min} Pokémon`);
      }
      const seen = new Set<string>();
      for (const ref of choice.refs) {
        if (!isPokemonRef(ref) || !prompt.candidates.some((c) => refEquals(c, ref))) {
          return err("BAD_EFFECT_CHOICE", "that Pokémon is not a legal target");
        }
        const key = refKey(ref);
        if (seen.has(key)) return err("BAD_EFFECT_CHOICE", "a Pokémon picked twice");
        seen.add(key);
      }
      return null;
    }
    case "choosePokemon": {
      // Exactly one of the offered refs.
      if (choice.kind !== "pokemon" || !isPokemonRef(choice.ref)) {
        return err("BAD_EFFECT_CHOICE", "expected a Pokémon choice");
      }
      if (!prompt.candidates.some((c) => refEquals(c, choice.ref))) {
        return err("BAD_EFFECT_CHOICE", "that Pokémon is not a legal target");
      }
      return null;
    }
    case "moveEnergy": {
      // Up to `max` movable Energy uids moved onto `dest` (Energy Switch / Poppy).
      // The couplings the compound decision must hold: every picked uid is an
      // offered movable Energy (distinct), all picks share ONE source Pokémon
      // (the printed "from 1 of your Pokémon"), the destination is an offered one,
      // and the source differs from the destination (no moving Energy onto itself).
      // An empty pick is a legal decline.
      if (choice.kind !== "moveEnergy" || !Array.isArray(choice.uids) || !isPokemonRef(choice.dest)) {
        return err("BAD_EFFECT_CHOICE", "expected an energy-move choice");
      }
      if (choice.uids.length > prompt.max) {
        return err("BAD_EFFECT_CHOICE", `move at most ${prompt.max} Energy`);
      }
      if (!prompt.destinations.some((d) => refEquals(d, choice.dest))) {
        return err("BAD_EFFECT_CHOICE", "that Pokémon is not a legal destination");
      }
      const sourceOf = new Map(prompt.movable.map((m) => [m.uid, m.from]));
      const seen = new Set<string>();
      let source: PokemonRef | undefined;
      for (const uid of choice.uids) {
        const from = typeof uid === "string" ? sourceOf.get(uid) : undefined;
        if (from === undefined) {
          return err("BAD_EFFECT_CHOICE", `${String(uid)} is not a movable Energy`);
        }
        if (seen.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
        seen.add(uid);
        if (source === undefined) source = from;
        else if (!refEquals(source, from)) {
          return err("BAD_EFFECT_CHOICE", "every Energy must come from the same Pokémon");
        }
      }
      if (source !== undefined && refEquals(source, choice.dest)) {
        return err("BAD_EFFECT_CHOICE", "cannot move a Pokémon's Energy onto itself");
      }
      return null;
    }
    case "discardEnergy": {
      // Crushing Hammer / Giacomo / Mawile, the attack twins, and the §8
      // self-discard cost. MANDATORY — an empty pick is NOT a decline here
      // (unlike chooseCards / moveEnergy), so the count is exact: "total" takes
      // exactly `count` Energy across the whole offer, "each" exactly one from
      // EVERY Pokémon the prompt offered. Both rest on the same two rules —
      // every uid was offered, and no uid twice — plus the required count, which
      // for "each" is the number of distinct sources, so "one each, none skipped"
      // follows by pigeonhole once no Pokémon may give up two.
      //
      // The one-per-Pokémon rule is "each"-only: an exact-N discard takes all N
      // off the SAME Pokémon (every printed one is "…from this Pokémon"), which
      // is exactly what that rule forbids. AUTHORING NOTE — nothing here then
      // pins a multi-count pick to a single host, so a future "discard 2 Energy
      // from 1 of your opponent's Pokémon" would need a same-host rule of its
      // own; the deriver is the only author of a numeric count and only ever
      // pairs it with the single-Pokémon `yourActive` arm.
      if (choice.kind !== "discardEnergy" || !Array.isArray(choice.uids)) {
        return err("BAD_EFFECT_CHOICE", "expected an energy-discard choice");
      }
      const scope = prompt.scope;
      const sourceOf = new Map(prompt.discardable.map((d) => [d.uid, d.from]));
      // "You may discard any amount" (Chien-Pao ex "Hail Blade"): DECLINABLE, so
      // 0..`max` rather than an exact count — every uid still offered and none
      // twice (the two rules every scope shares), but no per-source rule and an
      // empty pick is a legal decline. Branched out before the exact-count path
      // below, which "each" and "total" share.
      if (scope.kind === "upTo") {
        if (choice.uids.length > scope.max) {
          return err("BAD_EFFECT_CHOICE", `discard at most ${scope.max} Energy`);
        }
        const picked = new Set<string>();
        for (const uid of choice.uids) {
          if (typeof uid !== "string" || !sourceOf.has(uid)) {
            return err("BAD_EFFECT_CHOICE", `${String(uid)} is not a discardable Energy`);
          }
          if (picked.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
          picked.add(uid);
        }
        return null;
      }
      const required =
        scope.kind === "total"
          ? scope.count
          : new Set(prompt.discardable.map((d) => refKey(d.from))).size;
      if (choice.uids.length !== required) {
        return err("BAD_EFFECT_CHOICE", `discard exactly ${required} Energy`);
      }
      const seen = new Set<string>();
      const sources = new Set<string>();
      for (const uid of choice.uids) {
        const from = typeof uid === "string" ? sourceOf.get(uid) : undefined;
        if (from === undefined) {
          return err("BAD_EFFECT_CHOICE", `${String(uid)} is not a discardable Energy`);
        }
        if (seen.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
        seen.add(uid);
        if (scope.kind === "each") {
          const key = refKey(from);
          if (sources.has(key)) {
            return err("BAD_EFFECT_CHOICE", "only one Energy per Pokémon");
          }
          sources.add(key);
        }
      }
      return null;
    }
    case "attachCards": {
      // Electric Generator / Hydreigon / Charizard ex / Janine's Secret Art —
      // "attach … in any way you like", so each pick carries its OWN destination
      // and the answer is a list of PAIRS rather than the flat uid list every
      // other card prompt takes. Five couplings: at most `max` of them; every uid
      // one the prompt offered (which is what keeps a client off a card DEEPER in
      // the deck than the look reached — the lookAtTopN rule — and off a card the
      // filter or the interchangeable collapse excluded, and it also keeps a hand
      // card out of an attach that must come from the deck); no uid twice, since
      // one physical card cannot land on two Pokémon and the apply would otherwise
      // be asked to duplicate it; every destination an offered target (the printed
      // "your Benched {L} Pokémon" — the opponent's board is never among them);
      // and, when the prompt sets it, at most `maxPerTarget` on any ONE Pokémon.
      //
      // That last one is the printed "for each of those Pokémon" (Janine's Secret
      // Art: up to 2 Basic {D} Energy, one apiece). It is enforced HERE and only
      // here, like every other coupling above — the apply re-derives none of them,
      // so a rule that lived in both places could drift and let one path attach
      // what the other refuses.
      //
      // An empty list is a legal DECLINE ("up to" / "any number"), and it is not
      // the same as nothing happening: the op's leftovers clause still runs.
      if (choice.kind !== "attachCards" || !Array.isArray(choice.assignments)) {
        return err("BAD_EFFECT_CHOICE", "expected a card-attach choice");
      }
      if (choice.assignments.length > prompt.max) {
        return err("BAD_EFFECT_CHOICE", `attach at most ${prompt.max} card(s)`);
      }
      const candidates = new Set(prompt.candidates);
      const seen = new Set<string>();
      const perTarget = new Map<string, number>();
      // The entries come off the WIRE, so each is checked as an unknown shape
      // (TypeScript's `{uid, to}` is a claim about the action, not about the JSON).
      for (const entry of choice.assignments as readonly ({
        uid?: unknown;
        to?: unknown;
      } | null)[]) {
        if (typeof entry !== "object" || entry === null) {
          return err("BAD_EFFECT_CHOICE", "each attachment must name a card and a Pokémon");
        }
        const uid = entry.uid;
        if (typeof uid !== "string" || !candidates.has(uid)) {
          return err("BAD_EFFECT_CHOICE", `${String(uid)} is not an attachable card`);
        }
        if (seen.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
        seen.add(uid);
        const to = entry.to;
        if (!isPokemonRef(to) || !prompt.targets.some((t) => refEquals(t, to))) {
          return err("BAD_EFFECT_CHOICE", "that Pokémon is not a legal attach target");
        }
        if (prompt.maxPerTarget !== undefined) {
          const key = refKey(to);
          const count = (perTarget.get(key) ?? 0) + 1;
          if (count > prompt.maxPerTarget) {
            return err(
              "BAD_EFFECT_CHOICE",
              `attach at most ${prompt.maxPerTarget} card(s) to any one Pokémon`,
            );
          }
          perTarget.set(key, count);
        }
      }
      return null;
    }
    case "mayDraw": {
      // A plain boolean, and CHECKED to be one: a P4 client's truthy string
      // ("yes", 1) must not read as consent to draw — the wire rule every
      // index and count in this file already lives by.
      if (choice.kind !== "mayDraw" || typeof choice.draw !== "boolean") {
        return err("BAD_EFFECT_CHOICE", "expected a yes/no draw choice");
      }
      return null;
    }
  }
}

function isPokemonRef(value: unknown): value is PokemonRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as { seat?: unknown; spot?: unknown };
  if (ref.seat !== "p1" && ref.seat !== "p2") return false;
  return isPokemonTarget(ref.spot);
}

/** A stable string key for de-duping picked refs (the multi-choice's "no
    Pokémon twice" check). */
function refKey(ref: PokemonRef): string {
  return `${ref.seat}:${ref.spot.spot}:${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
}

function refEquals(a: PokemonRef, b: PokemonRef): boolean {
  if (a.seat !== b.seat || a.spot.spot !== b.spot.spot) return false;
  if (a.spot.spot === "bench" && b.spot.spot === "bench") return a.spot.index === b.spot.index;
  return true;
}
