// The phase-driven HUD layered over the playmat on /play. THE gating rule
// (D17): every control here checks `projection.waitingOn === "you"`, never
// turn ownership — during ko:promote the acting seat is the KO'd NON-turn
// player, and a HUD keyed on the turn soft-locks the game. The hot-seat
// viewer follows waitingOn (useLocalGame), so in practice these panels are
// always for the person holding the device; the gate stays anyway. GameHud
// enforces it ONCE, at its phase switch — the panels never re-check it.

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { Attack, Card } from "@luminous/schema";
import type {
  EffectPrompt,
  GameAction,
  GameState,
  InPlayPokemon,
  PokemonRef,
  PokemonTarget,
  Seat,
} from "@luminous/engine";
import {
  abilityUsedKey,
  attackLocked,
  attacksOf,
  cardOfUid,
  conditionHolds,
  conditionNote,
  handCostAction,
  handCostUnmet,
  costMet,
  effectiveAttackCost,
  attackBarredByAbility,
  effectiveRetreatCost,
  isImmobilized,
  lockedAttackIndexes,
  opposingRetreatBlocked,
  otherSeat,
  programFor,
  programPlayable,
  providedEnergy,
  rareCandyOptions,
  STATUS_LABELS,
  topCardOf,
  topUid,
} from "@luminous/engine";
import {
  GLASS_ACCENT_BUTTON,
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
  GLASS_NEUTRAL_BUTTON,
  GLASS_PANEL,
} from "../../lib/glass";
import { EnergyDots } from "./EnergyDots";
import {
  ATTACK_ROW_BASE,
  PICK_ROW_BASE,
  PICK_ROW_SPLIT_BASE,
  PRIZE_CARD_BASE,
  PRIZE_CARD_IDLE,
  PRIZE_CARD_PICKED,
  PROMOTE_ROW,
  ROW_BUTTON_BASE,
  ROW_BUTTON_DISABLED,
  ROW_BUTTON_ENABLED,
  ROW_BUTTON_SELECTED,
  ROW_BUTTON_UNSELECTED,
} from "./hudRows";
import { GAME_OVER_DETAIL, type GameProjection } from "./projection";

export interface GameHudProps {
  game: GameState;
  projection: GameProjection;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  dispatch: (action: GameAction) => void;
  onPlayAgain: () => void;
}

const ACCENT_BUTTON_CLASS = `cursor-pointer rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-40 ${GLASS_ACCENT_BUTTON}`;
const NEUTRAL_BUTTON_CLASS = `cursor-pointer rounded-full px-4 py-2 text-sm font-medium disabled:cursor-default disabled:opacity-40 ${GLASS_NEUTRAL_BUTTON}`;

/** A Trainer playable from `seat`'s hand (an Item/Supporter with a registry
    program, or an authored Stadium — Tools are drag gestures, not buttons),
    deduped to one entry per distinct card. `disabled` mirrors the engine's
    coarse gates (§4/§7.2 Supporter, §7.3 Stadium once-per-turn + same-name)
    so the button greys out before the reject. */
interface TrainerOption {
  uid: string;
  name: string;
  disabled: boolean;
  /** Rare Candy (§7.1) is a Trainer that EVOLVES — its button opens the Rare
      Candy dialog (pick a Basic + a Stage 2) instead of dispatching playTrainer. */
  rareCandy: boolean;
  /** Why a printed `trainerPlayableIf` gate greyed this row out — the tooltip that
      replaces the reject pill the player can no longer reach by clicking. Only
      set for that gate; the coarse §4/§7.2/§7.3 ones are self-evident. */
  reason?: string;
}
function playableTrainers(game: GameState, seat: Seat): TrainerOption[] {
  const side = game.players[seat];
  const inPlayStadium = game.stadium === null ? undefined : cardOfUid(game, game.stadium.uid)?.name;
  // §7.1 legality (a Basic in play + a matching Stage 2 in hand + timing) is the
  // engine's — greying Rare Candy out before the reject. Computed LAZILY (its
  // cardPool scan is only worth paying when a Rare Candy is actually in hand).
  let canRareCandy: boolean | null = null;
  const rareCandyPlayable = (): boolean => {
    if (canRareCandy === null) canRareCandy = rareCandyOptions(game, seat).length > 0;
    return canRareCandy;
  };
  const seen = new Set<string>();
  const out: TrainerOption[] = [];
  for (const uid of side.hand) {
    const card = cardOfUid(game, uid);
    if (card === undefined || card.category !== "Trainer" || seen.has(card.id)) continue;
    const program = programFor(card.id);
    if (program === undefined) continue;
    const isRareCandy = program.rareCandy === true;
    const isStadium = card.trainerType === "Stadium";
    // A card with no play path (no program, no stadium, not Rare Candy) is not
    // offered — the coverage strategy surfaces it as "not simulated" on attempt.
    if (
      !isRareCandy &&
      (isStadium ? program.stadium === undefined : program.trainer === undefined)
    ) {
      continue;
    }
    seen.add(card.id);
    const isSupporter = card.trainerType === "Supporter";
    // The card's own printed "You can use this card only if …" gate (Fighting Au
    // Lait) — evaluated with the engine's own predicate, so the button greys out
    // EXACTLY when playTrainer would reject with PLAY_CONDITION_NOT_MET, and the
    // reason rides along as the row's tooltip (a printed rule the player cannot
    // otherwise read off the HUD, unlike "you already played a Supporter").
    // Scoped to the Item/Supporter path on purpose: `trainerPlayableIf` sits on
    // CardProgram, but cardplay.ts reads it ONLY in playTrainer's Item/Supporter
    // branch — playStadium, the rareCandy action and useAbility all ignore it. A
    // broader grey-out here would disagree with the engine (and a Stadium is
    // droppable on the shared slot, bypassing this list entirely).
    const gated = !isRareCandy && !isStadium ? program.trainerPlayableIf : undefined;
    const gateUnmet = gated !== undefined && !conditionHolds(game, seat, gated);
    // The card's SECOND printed "only if" — the §7.5 hand COST (Ultra Ball's
    // "only if you discard 2 OTHER cards from your hand"). Same doctrine and the
    // same engine predicate as the board-condition gate above, because playTrainer
    // rejects on both with the SAME code: leaving this one out is how the row that
    // is dead most often — Ultra Ball on a nearly-empty hand — stays lit.
    //
    // `uid` is passed, which is the whole point: the played card is still in this
    // hand while we ask, and the printed word "other" is exactly its exclusion.
    // Scoped to the Item/Supporter path with the gate above, for the same reason.
    const costUnmet =
      !isRareCandy && !isStadium ? handCostUnmet(game, seat, program.trainer ?? [], uid) : null;
    // The card's THIRD way of being dead — not a printed rule this time but the
    // engine's would-only-whiff judgement (§7 / ruling/284): Boss's Orders into
    // an empty opponent Bench, Ortega into an empty opponent hand. playTrainer
    // rejects these with NO_LEGAL_TARGET, so a lit row here can only ever be
    // clicked and refused — the exact recurring finding the two mirrors above
    // were each added to close, arriving a third time because the predicate was
    // engine-private until 0.32.0. Every input it reads is public to this seat
    // (zone counts, both boards), and hidden-zone CONTENTS never decide
    // playability inside it (the Poké Ball rule), so mirroring leaks nothing.
    // Scoped to the Item/Supporter path with the two above: playStadium and the
    // rareCandy action never consult it.
    const noTarget =
      !isRareCandy && !isStadium && !programPlayable(game, program.trainer ?? [], seat);
    // ⚠️ THE §4 TERM CARRIES THE CARD'S OWN EXEMPTION (D223,
    // `trainerFirstTurnExempt`: Carmine's "If you go first, you may use this card
    // during your first turn."), exactly as redact.ts's online twin does. A flag
    // the engine honours and the HUD does not leaves the card engine-legal and
    // UNCLICKABLE on the one turn it is printed for — the afford-then-reject
    // finding with its sign flipped, and the quieter direction, because a greyed
    // row is never clicked and so never reports itself. The §7.2 once-per-turn
    // term beside it is NOT exempted: the sentence licenses timing, not a second
    // Supporter.
    const disabled =
      gateUnmet ||
      costUnmet !== null ||
      noTarget ||
      (isRareCandy
        ? !rareCandyPlayable()
        : isSupporter
          ? (game.turn === 1 && program.trainerFirstTurnExempt !== true) ||
            game.allowances.supporterPlayed
          : isStadium && (game.allowances.stadiumPlayed || card.name === inPlayStadium));
    out.push({
      uid,
      name: card.name,
      disabled,
      rareCandy: isRareCandy,
      reason:
        gateUnmet && gated !== undefined
          ? `Only if ${conditionNote(gated)}`
          : costUnmet !== null
            ? `Only if you ${handCostAction(costUnmet, true)}`
            : noTarget
              ? // No printed clause to quote — this is the engine's rule, not the
                // card's — so the tooltip says the plain fact, in the words the
                // engine's own rejection uses.
                "No legal target"
              : undefined,
    });
  }
  return out;
}

/** An activated Ability on one of `seat`'s in-play Pokémon (passive abilities
    are always-on and show no button). `disabled` mirrors the §9 Active-only /
    once-per-turn gate AND the §7.5 hand COST, the same printed rule the Trainer
    row greys out on: "You must discard a card from your hand in order to use this
    Ability" is a precondition for the use, so an Ability that cannot be paid for
    is dead, and a dead row must say so rather than being clicked and refused
    (`ABILITY_COST_UNMET`). `reason` carries the printed clause for the row's
    tooltip + sr-only text, exactly as the Trainer list does.

    `where` disambiguates two copies of the same card carrying the same Ability —
    Skwovet ×2 is the first board that makes the labels identical, and DOM order
    is not something a screen reader can read off a button. */
interface AbilityOption {
  target: PokemonTarget;
  abilityName: string;
  label: string;
  disabled: boolean;
  reason?: string;
}
function usableAbilities(game: GameState, seat: Seat): AbilityOption[] {
  const side = game.players[seat];
  const out: AbilityOption[] = [];
  const consider = (pokemon: InPlayPokemon | null, target: PokemonTarget) => {
    if (pokemon === null) return;
    const uid = topUid(pokemon);
    const card = uid === undefined ? undefined : cardOfUid(game, uid);
    if (uid === undefined || card === undefined) return;
    for (const ability of programFor(card.id)?.abilities ?? []) {
      // No `excludeUid`: an Ability's card is on the BOARD, not in the hand it
      // pays out of — which is why none of these cards prints the "other" that
      // every Trainer in the family does.
      const costUnmet = handCostUnmet(game, seat, ability.program);
      // useAbility gates on programPlayable exactly as playTrainer does
      // (Meowscarada ex's snipe needs an opponent Bench), so the Ability row
      // mirrors it for the Trainer row's reason — this list has carried the
      // afford-then-reject since D29, and the predicate is exported now.
      //
      // ⚠️ D222 — `uid` IS THE FOURTH ARGUMENT, AND OMITTING IT WOULD BE A LIVE
      // AFFORD-THEN-REJECT rather than a tidiness point. `useAbility` passes the
      // Pokémon's own uid so a `from: "self"` board cost is asked about the right
      // body (Iono's Kilowattrel); a HUD that dropped it would ask about the
      // Active, light a benched Kilowattrel holding no {L}, and the click would
      // come back NO_LEGAL_TARGET.
      const noTarget = !programPlayable(game, ability.program, seat, uid);
      // D272 — the §9 printed board gate (Fezandipiti ex's "if any of your
      // Pokémon were Knocked Out during your opponent's last turn"), the
      // Ability-surface sibling of the `trainerPlayableIf` row's own gate below.
      const gateUnmet =
        ability.playableIf !== undefined && !conditionHolds(game, seat, ability.playableIf);
      const disabled =
        (ability.activeOnly && target.spot !== "active") ||
        // ⚠️ THE KEY COMES FROM `abilityUsedKey`, NEVER SPELLED HERE. A
        // "sharedByName" Ability (Fezandipiti ex: "You can't use more than 1 Flip
        // the Script Ability each turn") keys on its NAME alone; a HUD still
        // building `${uid}:` would leave the second copy's row lit after the
        // first spent the turn's one use — a live afford-then-reject of exactly
        // the D222 kind.
        (ability.oncePerTurn && game.allowances.abilitiesUsed.includes(abilityUsedKey(uid, ability))) ||
        gateUnmet ||
        costUnmet !== null ||
        noTarget;
      const where = target.spot === "active" ? "Active" : `Bench ${target.index + 1}`;
      out.push({
        target,
        abilityName: ability.name,
        label: `${ability.name} · ${card.name} (${where})`,
        disabled,
        reason:
          costUnmet !== null
            ? `Only if you ${handCostAction(costUnmet, false)}`
            : ability.playableIf !== undefined && gateUnmet
              ? `Only if ${conditionNote(ability.playableIf)}`
              : noTarget
                ? "No legal target"
                : undefined,
      });
    }
  };
  consider(side.active, { spot: "active" });
  side.bench.forEach((pokemon, index) => consider(pokemon, { spot: "bench", index }));
  return out;
}

/** §7.3 — the SHARED Stadium's "once during each player's turn" activated ability
    (Artazon / Mesagoza / Town Store / Levincia / Spikemuth Gym), as one nullable
    row. The Ability/Trainer rows' shape (`disabled` + an optional `reason` the
    greyed row explains itself with), because it greys for the same kinds of
    reason and must read the same way.

    ⚠️ IT IS NEITHER A `TrainerOption` NOR AN `AbilityOption`, WHICH IS WHY IT HAD
    NO LOCAL CONTROL AT ALL. `usableAbilities` walks the viewer's own Active +
    Bench and a Stadium is on NEITHER board (it may well be the opponent's card —
    ownership is not the discriminant, the turn is); `playableTrainers` walks the
    viewer's own HAND and a Stadium in play has left it. So both lists
    structurally exclude it, and the action the engine has driven since 0.53.0
    (`useStadiumAbility`, cardplay.ts, D102) reached NO client — local or online —
    until D210 gave it the online half and this gives it the local one. Levincia
    sv09-150/sv10-244 and Spikemuth Gym sv10-169 are Standard-legal and in the
    registry, so a hot-seat player could put one down and never be offered its
    printed effect.

    THE LOCAL/ONLINE SPLIT. The online HUD renders a `RedactedStadiumAbility` the
    server already folded (`redactedStadiumAbilityOf`, redact.ts); this surface has
    the live `GameState`, so it folds the SAME THREE TERMS here — a Stadium in
    play, that Stadium's program carrying an `ability`, and
    `allowances.stadiumAbilityUsed || !programPlayable(...)`. Term for term with
    `cardplay.ts`'s gate, so the button and the engine cannot disagree. It lives
    HERE beside its two siblings rather than inside TurnPanel for the reason they
    do: the fold is testable without a DOM, and a component-local derivation is
    how the two halves drift.

    ⚠️ NO SEAT OR TURN TERM, DELIBERATELY. The wire fold needs `viewerSeat !==
    turnSeat` because a redaction answers for a viewer who may be anyone; this one
    is called from TurnPanel, which `GameHud`'s phase switch mounts ONLY at
    `turn:action` for `waitingOn === "you"` (the D17 gate, enforced once). Adding a
    second turn check here would be a second authority for the rule the switch
    already owns.

    ⚠️ `allowances` IS NOT PER-SEAT. `TurnAllowances` is ONE object that RESETS at
    the turn boundary (turn.ts), so `stadiumAbilityUsed` means "the seat whose turn
    this is has already activated it" — which is exactly the seat this row is for.
    That is how the printed "once during EACH player's turn" needs no per-seat
    bookkeeping, and why caching who used it would grey the opponent's fresh turn.

    ⚠️ THE `programPlayable` TERM IS CORRECT AND, TODAY, UNREACHABLE: no printed
    Stadium ability program contains a whiff-gated op (they search decks or
    retrieve from a discard, and `programPlayable` gates neither), so it cannot
    currently return false and no board over the real pool can discriminate it. It
    is kept because the engine gate has it, and the vacuity is PINNED rather than
    papered over — `packages/engine/src/redactStadiumAbility.test.ts` fails the day
    a registry Stadium ability carries a gated op. */
interface StadiumAbilityOption {
  /** `StadiumAbility.label` — the Stadium's own name, the same string the
      STADIUM_ABILITY_ACTIVATED log row carries. */
  label: string;
  disabled: boolean;
  /** Why a greyed row is greyed, when it is not self-evident. Left undefined for
      "already used this turn" — the Ability/Trainer rows' contract. */
  reason?: string;
}
function stadiumAbilityOption(game: GameState, seat: Seat): StadiumAbilityOption | null {
  const stadium = game.stadium;
  if (stadium === null) return null;
  const card = cardOfUid(game, stadium.uid);
  // A continuous-only Stadium (Beach Court, Pokémon League HQ) has a `stadium`
  // program with no `ability` — no row at all, rather than a dead button for a
  // card that prints no activation.
  const ability = card === undefined ? undefined : programFor(card.id)?.stadium?.ability;
  if (ability === undefined) return null;
  // D222 — the Stadium's uid, term for term with `useStadiumAbility`.
  const noTarget = !programPlayable(game, ability.program, seat, stadium.uid);
  return {
    label: ability.label,
    disabled: game.allowances.stadiumAbilityUsed || noTarget,
    reason: noTarget ? "No legal target" : undefined,
  };
}

/** A choose-Pokémon candidate's display name, resolved off the live board. */
function refName(game: GameState, ref: PokemonRef): string {
  const side = game.players[ref.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (pokemon == null) return "a Pokémon";
  return topCardOf(game, pokemon)?.name ?? "a Pokémon";
}

/** Floating glass panel for the in-flow phase prompts (not the modals). */
function HudPanel({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={`absolute z-[75] rounded-2xl p-4 ${GLASS_PANEL} ${className}`}
    >
      {children}
    </section>
  );
}

const TOP_PANEL_CLASS = "left-1/2 top-16 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2";

/** Native <dialog> modal (the BackToMenu pattern: top layer, focus trap).
    Mounted = open: callers render it conditionally, the mount effect calls
    showModal, and unmounting removes it from the top layer. Without
    `onDismiss` the decision is mandatory — Escape is swallowed. */
function HudDialog({
  label,
  onDismiss,
  children,
}: {
  label: string;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onCancel={(event) => {
        if (onDismiss === undefined) event.preventDefault();
      }}
      onClose={() => onDismiss?.()}
      className="leave-dialog m-auto border-0 bg-transparent p-0 text-white"
    >
      <div className={`w-[min(24rem,calc(100vw-2.5rem))] ${GLASS_DIALOG_PANEL}`}>{children}</div>
    </dialog>
  );
}

function ChooseFirstPanel({
  viewerSeat,
  names,
  dispatch,
  coinWinner,
}: GameHudProps & { coinWinner: Seat }) {
  // createGame convention: heads means p1 won the toss (setup.ts).
  const face = coinWinner === "p1" ? "heads" : "tails";
  return (
    <HudPanel label="Coin toss" className={TOP_PANEL_CLASS}>
      <p className="text-sm text-white/80">
        Coin toss: <span className="font-semibold text-white">{face}</span> —{" "}
        <span className="font-semibold text-white">{names[viewerSeat]}</span> chooses who goes
        first.
      </p>
      <div className="mt-3 flex gap-2.5">
        <button
          type="button"
          className={ACCENT_BUTTON_CLASS}
          onClick={() =>
            dispatch({ type: "chooseFirstPlayer", seat: viewerSeat, first: viewerSeat })
          }
        >
          Go first
        </button>
        <button
          type="button"
          className={NEUTRAL_BUTTON_CLASS}
          onClick={() =>
            dispatch({ type: "chooseFirstPlayer", seat: viewerSeat, first: otherSeat(viewerSeat) })
          }
        >
          Go second
        </button>
      </div>
    </HudPanel>
  );
}

function DrawExtraPanel({
  game,
  viewerSeat,
  names,
  dispatch,
  owed,
}: GameHudProps & { owed: number }) {
  const [count, setCount] = useState(0);
  const opponentMulligans = game.players[otherSeat(viewerSeat)].mulligans;
  const clamped = Math.min(count, owed);
  return (
    <HudPanel label="Mulligan draw" className={TOP_PANEL_CLASS}>
      <p className="text-sm text-white/80">
        <span className="font-semibold text-white">{names[otherSeat(viewerSeat)]}</span> mulliganed{" "}
        {opponentMulligans} time{opponentMulligans === 1 ? "" : "s"} — you may draw up to {owed}{" "}
        extra card{owed === 1 ? "" : "s"}.
      </p>
      <div className="mt-3 flex items-center gap-2.5">
        <button
          type="button"
          aria-label="Fewer cards"
          className={`${NEUTRAL_BUTTON_CLASS} px-3`}
          disabled={clamped <= 0}
          onClick={() => setCount(Math.max(0, clamped - 1))}
        >
          −
        </button>
        <span className="w-6 text-center text-sm font-bold tabular-nums text-white">{clamped}</span>
        <button
          type="button"
          aria-label="More cards"
          className={`${NEUTRAL_BUTTON_CLASS} px-3`}
          disabled={clamped >= owed}
          onClick={() => setCount(Math.min(owed, clamped + 1))}
        >
          +
        </button>
        <button
          type="button"
          className={ACCENT_BUTTON_CLASS}
          onClick={() => {
            dispatch({ type: "setupDrawExtra", seat: viewerSeat, count: clamped });
            setCount(0);
          }}
        >
          {clamped === 0 ? "Skip the draw" : `Draw ${clamped}`}
        </button>
      </div>
    </HudPanel>
  );
}

function PlacePanel({ projection, viewerSeat, dispatch }: GameHudProps) {
  const activePlaced = projection.board.you.active !== null;
  return (
    <HudPanel label="Setup placement" className={TOP_PANEL_CLASS}>
      <p className="text-sm text-white/80">
        {activePlaced
          ? "Drag more Basic Pokémon to your Bench, then press Ready."
          : "Drag a Basic Pokémon from your hand to the Active slot."}
      </p>
      <div className="mt-3">
        <button
          type="button"
          className={ACCENT_BUTTON_CLASS}
          disabled={!activePlaced}
          onClick={() => dispatch({ type: "setupReady", seat: viewerSeat })}
        >
          Ready
        </button>
      </div>
    </HudPanel>
  );
}

/** The turn:action side panel: printed attacks with engine-computed
    payability, the retreat entry point, and the per-turn allowance state. */
function TurnPanel(props: GameHudProps) {
  const { game, projection, viewerSeat, dispatch } = props;
  const [retreatOpen, setRetreatOpen] = useState(false);
  // The Rare Candy card uid whose dialog is open (§7.1), or null.
  const [rareCandyUid, setRareCandyUid] = useState<string | null>(null);

  const side = game.players[viewerSeat];
  const active = side.active;
  const activeCard = active === null ? undefined : topCardOf(game, active);
  if (active === null || activeCard === undefined) return null;

  // Payability, precomputed the way the engine checks it (§8.2): the units the
  // attached energies provide (basic types + special-energy units incl.
  // wildcards) vs the printed cost. ONE shared helper with the engine's own
  // cost check (providedEnergy), so the HUD preview can't drift from it.
  const provided = providedEnergy(game, active);
  const attacks = attacksOf(activeCard);
  // §4 — turn 1 is by construction the going-first player's turn.
  const firstTurnBan = game.turn === 1;

  // Battle state off the PROJECTED board (the viewer's Active is always
  // board.you.active) — the surface online clients will have, unlike the raw
  // GameState reads above (the acknowledged P4 blocker).
  const battle = projection.board.you.active?.battle;
  const conditions = battle?.conditions;
  const rotation = conditions?.rotation ?? "none";
  // The engine's own §12 gate (isImmobilized: asleep or paralyzed blocks
  // attacking AND retreating; confusion blocks neither — it flips at
  // resolution). Calling the engine predicate makes the mirror CODE-enforced
  // rather than comment-enforced; the playmat-typed conditions fit because
  // projection.ts pins BattleConditions ≡ SpecialConditions at compile time.
  const immobilized = conditions !== undefined && isImmobilized(conditions);
  // §8/§11 (D143) — an attack locked this Pokémon out of attacking on THIS turn.
  // Read off raw GameState through the engine's own predicate, exactly as
  // `retreatBlocked` is below and for the same reason: it is not a §12 condition,
  // so it is deliberately absent from the projected/wire `conditions` shape. The
  // server-side twin is `redactedAttacksOf`'s `banned` (redact.ts); both exist so
  // that no path offers a button `attack` will reject with ATTACK_PREVENTED.
  //
  // D148 — the lock may have been written by the OPPONENT's attack ("…the
  // Defending Pokémon can't attack.", Eiscue ex sv03-042/-210/-222 and Houndoom ex
  // sv03-134) as well as by this Pokémon's own drawback. No diff is needed for it
  // (one field, one predicate, and the viewer is the locked seat either way), and
  // it is the case where the greyed-out button matters MOST: the player never
  // chose this one and has no card of their own to read the reason off.
  const attackLockedNow = attackLocked(game, active);
  // §8/§11 (D154) — …and the PER-ATTACK bar ("During your next turn, this Pokémon
  // can't use {AttackName}."), read off raw GameState through the engine's own
  // reader exactly as the whole-Pokémon lock above is. It is a SET OF INDICES
  // rather than a boolean because the whole content of the rule is that the card's
  // OTHER attacks stay legal, so it cannot join `attackLockedNow` — membership is
  // asked per row inside the map below. The server-side twin is
  // `redactedAttacksOf`'s `barred` (redact.ts); both exist so that no path offers
  // a button `attack` will reject with ATTACK_PREVENTED.
  //
  // D165 — a SET rather than one index, because `lockedAttacks` has TWO writers
  // (the self-side bar and D157's imposed one) whose stamps collide from adjacent
  // turns. A panel that greyed only the last-written bar would offer a button the
  // server rejects, on a board where the player has a card in front of them saying
  // it should not be there.
  const barredAttackIndexes = lockedAttackIndexes(game, active);
  // §8/§9 (D242) — …and the ALWAYS-ON gate the body's OWN printed Ability imposes
  // ("This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in
  // play"), read off raw GameState through the engine's own reader exactly as the
  // two locks above are. It joins `attackLockedNow` rather than the index set
  // because it is a fact about the whole BODY — every row greys together.
  //
  // ⚠️ IT IS A THIRD READ AND NOT A THIRD CLAUSE ON THE FIRST, BECAUSE IT CLEARS
  // DIFFERENTLY. The two locks above expire on the clock; this one clears the
  // instant the player drops a fourth Team Rocket's Pokémon onto their Bench —
  // so the panel must re-derive it from the board on every render, which it does
  // for free by being a live read rather than a stamp. The server-side twin is
  // `redactedAttacksOf`'s `banned` (redact.ts).
  const abilityGateUnmet = attackBarredByAbility(game, viewerSeat, active) !== undefined;

  // THE retreat derivation site — RetreatDialog receives these as props. The
  // cost is the CONTINUOUS one (§7.3 — Beach Court discounts Basics), the
  // same number the engine's retreat handler will check.
  const retreatCost = effectiveRetreatCost(game, active);
  const canRetreat =
    !immobilized &&
    // §11 — an attack effect holding it in place ("the Defending Pokémon can't
    // retreat"). Read off raw GameState: it is not a §12 condition, so it is
    // deliberately absent from the projected/wire `conditions` shape.
    !active.retreatBlocked &&
    // §11 — the same hold from an opposing CONTINUOUS Ability (Snorlax "Block"),
    // read live off both Active spots rather than off a flag on this Pokémon.
    !opposingRetreatBlocked(game, active) &&
    !game.allowances.retreated &&
    side.bench.length > 0 &&
    active.energy.length >= retreatCost;

  // Trainer/Ability plays (§7/§9) — read off raw GameState like payability
  // above (the acknowledged P4 blocker); the engine still owns fine legality.
  const trainerOptions = playableTrainers(game, viewerSeat);
  const abilityOptions = usableAbilities(game, viewerSeat);
  // §7.3 — the shared Stadium's activated ability, the one turn affordance that
  // fits in NEITHER list above (see stadiumAbilityOption). Null = no row.
  const stadiumAbility = stadiumAbilityOption(game, viewerSeat);

  return (
    <>
      {/* Just above the hand, clear of the pass-turn control at right-center. */}
      <HudPanel label="Turn actions" className="bottom-[calc(var(--hand-h)+16px)] right-4 w-72">
        <div className="flex items-baseline justify-between">
          <span className="truncate text-sm font-semibold text-white">{activeCard.name}</span>
          {battle !== undefined && battle.hp !== null && (
            <span className="ml-2 shrink-0 text-xs tabular-nums text-white/55">
              {Math.max(0, battle.hp - battle.damage)}/{battle.hp} HP
            </span>
          )}
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {attacks.length === 0 && (
            <li className="text-xs text-white/45">This Pokémon has no attacks.</li>
          )}
          {attacks.map((attack: Attack, index: number) => {
            // §8.2 payability under EVERY continuous cost effect in play — the
            // Stadium's Basic surcharge (§7.3, League HQ), the opposing "Quaking
            // Zone" aura and the holder's own "Excited Heart" discount — exactly as
            // the engine checks it. The dots below render THIS array rather than
            // the printed one: a discount lights the button up, and dots still
            // showing the full cost would tell the player they cannot afford an
            // attack the engine will happily let them declare.
            const effectiveCost = effectiveAttackCost(game, active, attack.cost ?? []);
            const payable = costMet(effectiveCost, provided);
            const disabled =
              !payable ||
              firstTurnBan ||
              immobilized ||
              attackLockedNow ||
              abilityGateUnmet ||
              barredAttackIndexes.includes(index);
            return (
              <li key={`${attack.name}-${index}`}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => dispatch({ type: "attack", seat: viewerSeat, index })}
                  className={`${ATTACK_ROW_BASE} ${
                    disabled ? ROW_BUTTON_DISABLED : ROW_BUTTON_ENABLED
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{attack.name}</span>
                    <EnergyDots cost={effectiveCost} />
                  </span>
                  {attack.damage !== undefined && (
                    <span className="shrink-0 text-sm font-bold tabular-nums">
                      {String(attack.damage)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {firstTurnBan && (
          <p className="mt-2 text-[11px] text-white/45">No attacking on the first turn (§4).</p>
        )}
        {/* The extra !== "none" only narrows the type for the label lookup —
            immobilized already guarantees an asleep/paralyzed rotation. */}
        {immobilized && rotation !== "none" && (
          <p className="mt-2 text-[11px] text-white/45">
            {STATUS_LABELS[rotation]} — cannot attack or retreat.
          </p>
        )}
        {rotation === "confused" && (
          <p className="mt-2 text-[11px] text-white/45">
            Confused: attacking flips a coin — tails: 30 damage to itself, turn ends.
          </p>
        )}
        {abilityOptions.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Abilities
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {abilityOptions.map((opt) => (
                // Same shape as the Trainer rows below, and for the same reason:
                // `title` on the LI (a disabled button is out of the tab order)
                // with an sr-only twin, since the §7.5 cost can grey this row too.
                <li
                  key={`${opt.abilityName}-${opt.target.spot === "bench" ? opt.target.index : "active"}`}
                  title={opt.reason}
                >
                  <button
                    type="button"
                    disabled={opt.disabled}
                    onClick={() =>
                      dispatch({
                        type: "useAbility",
                        seat: viewerSeat,
                        target: opt.target,
                        abilityName: opt.abilityName,
                      })
                    }
                    className={`${ROW_BUTTON_BASE} ${opt.disabled ? ROW_BUTTON_DISABLED : ROW_BUTTON_ENABLED}`}
                  >
                    <span className="truncate">{opt.label}</span>
                  </button>
                  {opt.reason !== undefined && <span className="sr-only">{opt.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {trainerOptions.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Trainers
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {trainerOptions.map((opt) => (
                // `title` sits on the LI, not the button: a disabled button is
                // out of the tab order, so the row is the only place the reason
                // stays reachable (the sr-only span carries it to a reader).
                <li key={opt.uid} title={opt.reason}>
                  <button
                    type="button"
                    disabled={opt.disabled}
                    onClick={() =>
                      opt.rareCandy
                        ? setRareCandyUid(opt.uid)
                        : dispatch({ type: "playTrainer", seat: viewerSeat, uid: opt.uid })
                    }
                    className={`${ROW_BUTTON_BASE} ${opt.disabled ? ROW_BUTTON_DISABLED : ROW_BUTTON_ENABLED}`}
                  >
                    <span className="truncate">{opt.name}</span>
                  </button>
                  {/* Outside the button on purpose: inside, it would join the
                      button's ACCESSIBLE NAME ("sv02-181 Only if…") rather than
                      read as the separate explanation it is. */}
                  {opt.reason !== undefined && <span className="sr-only">{opt.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* §7.3 — the SHARED Stadium's "once during each player's turn" activated
            ability. Its own section under the same reasoning as the online HUD's
            (D210): the Stadium belongs to neither player's board and sits in
            neither hand, so neither list above can name it. The dispatch carries
            the seat and NOTHING else — there is exactly one Stadium and the action
            takes no target — which is why it could never have ridden `useAbility`'s
            target-shaped row. Greyed and explained exactly as the Ability rows are.
            (The action is named in BACKTICKS in this file's prose and never as a
            quoted string literal: a source scan for the double-quoted type would
            otherwise be satisfied by a comment and stay green through a deletion of
            the button below. That is not hypothetical — D210's first draft did it.) */}
        {stadiumAbility !== null && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Stadium
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {/* `title` on the LI with an sr-only twin, the Ability/Trainer rows'
                  doctrine: a disabled button is out of the tab order, so the row is
                  the only place the reason stays reachable. */}
              <li title={stadiumAbility.reason}>
                <button
                  type="button"
                  disabled={stadiumAbility.disabled}
                  onClick={() => dispatch({ type: "useStadiumAbility", seat: viewerSeat })}
                  className={`${ROW_BUTTON_BASE} ${stadiumAbility.disabled ? ROW_BUTTON_DISABLED : ROW_BUTTON_ENABLED}`}
                >
                  <span className="truncate">{stadiumAbility.label}</span>
                </button>
                {stadiumAbility.reason !== undefined && (
                  <span className="sr-only">{stadiumAbility.reason}</span>
                )}
              </li>
            </ul>
          </div>
        )}
        {/* Retreat + Pass share the panel's footer. Pass lives HERE because this
            panel (z-[75], bottom-right) COVERED the playmat's old ⟶ control
            (z-20, right-edge centred) at every ordinary viewport height — a click
            there landed on an attack row instead — and since P5-4 that control is
            not rendered on this surface at all. The panel appears exactly when
            `waitingOn === "you" && turn:action`, so this button needs no disabled
            state: if it is on screen, passing is legal. */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            className={`${NEUTRAL_BUTTON_CLASS} px-3 py-1.5 text-xs`}
            disabled={!canRetreat}
            onClick={() => setRetreatOpen(true)}
          >
            Retreat ({retreatCost})
          </button>
          <button
            type="button"
            className={`${ACCENT_BUTTON_CLASS} px-3 py-1.5 text-xs`}
            onClick={() => dispatch({ type: "endTurn", seat: viewerSeat })}
          >
            {/* "Pass", not "Pass turn": the name was chosen while the playmat's
                ⟶ still owned that label, and it is kept because it is the name
                this control has been verified and tested under. The "Turn
                actions" region label supplies the context. */}
            Pass
          </button>
        </div>
        <p className="mt-1.5 text-right text-[10px] leading-tight text-white/40">
          {game.allowances.energyAttached ? "energy attached ✓" : "drag an energy to attach"}
          {game.allowances.retreated ? " · retreated ✓" : ""}
        </p>
      </HudPanel>
      {retreatOpen && (
        <RetreatDialog
          game={game}
          viewerSeat={viewerSeat}
          dispatch={dispatch}
          activeCard={activeCard}
          cost={retreatCost}
          energyUids={active.energy}
          bench={side.bench}
          onClose={() => setRetreatOpen(false)}
        />
      )}
      {rareCandyUid !== null && (
        <RareCandyDialog
          game={game}
          viewerSeat={viewerSeat}
          dispatch={dispatch}
          rareCandyUid={rareCandyUid}
          onClose={() => setRareCandyUid(null)}
        />
      )}
    </>
  );
}

/** §7.1 Rare Candy — evolve a Basic straight to a Stage 2, skipping the Stage 1.
    A two-pick decision the engine can't express through effect:choose (it needs
    a Basic in play AND a Stage 2 in hand), so it is its own dialog: the legal
    pairings come from the engine's `rareCandyOptions` (the authority), and the
    picked pair dispatches the `rareCandy` action. Mounted only while open, so
    the useState is the fresh-picks-per-open reset. */
function RareCandyDialog({
  game,
  viewerSeat,
  dispatch,
  rareCandyUid,
  onClose,
}: {
  game: GameState;
  viewerSeat: Seat;
  dispatch: (action: GameAction) => void;
  /** The Rare Candy Item uid being played. */
  rareCandyUid: string;
  onClose: () => void;
}) {
  const options = rareCandyOptions(game, viewerSeat);
  // Pre-select when there is only one Basic to evolve (skip straight to the
  // Stage 2 pick); otherwise the player chooses the Basic first.
  const [basicUid, setBasicUid] = useState<string | null>(
    options.length === 1 ? (options[0]?.basicUid ?? null) : null,
  );
  const chosen = options.find((o) => o.basicUid === basicUid) ?? null;
  const cardName = (uid: string) => cardOfUid(game, uid)?.name ?? uid;

  return (
    <HudDialog label="Rare Candy" onDismiss={onClose}>
      <h2 className="text-lg font-semibold text-white">Rare Candy</h2>
      {chosen === null ? (
        <>
          <p className="mt-1.5 text-sm text-white/55">
            Choose a Basic Pokémon to evolve, skipping the Stage 1.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {options.map((option) => (
              <li key={option.basicUid}>
                <button
                  type="button"
                  onClick={() => setBasicUid(option.basicUid)}
                  className={`${ROW_BUTTON_BASE} ${ROW_BUTTON_ENABLED}`}
                >
                  <span className="truncate">{cardName(option.basicUid)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-white/55">
            Put a Stage 2 onto <span className="text-white/80">{cardName(chosen.basicUid)}</span>:
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {chosen.stage2Uids.map((uid) => (
              <li key={uid}>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({
                      type: "rareCandy",
                      seat: viewerSeat,
                      uid: rareCandyUid,
                      target: chosen.target,
                      evolutionUid: uid,
                    });
                    onClose();
                  }}
                  className={`${ROW_BUTTON_BASE} ${ROW_BUTTON_ENABLED}`}
                >
                  <span className="truncate">{cardName(uid)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {/* Rare Candy is an optional play — always offer an on-screen dismiss (the
          RetreatDialog pattern), and Back only when the Basic pick was a real
          choice (>1 option). */}
      <div className="mt-4 flex justify-between gap-2">
        <button type="button" onClick={onClose} className={GLASS_DIALOG_GHOST_BUTTON}>
          Cancel
        </button>
        {chosen !== null && options.length > 1 && (
          <button
            type="button"
            onClick={() => setBasicUid(null)}
            className={GLASS_DIALOG_GHOST_BUTTON}
          >
            ← Back
          </button>
        )}
      </div>
    </HudDialog>
  );
}

/** The retreat decision modal. Every retreat derivation (the Active's card,
    the cost, the discardable energy, the bench) is computed ONCE in
    TurnPanel — its only caller — and passed down, keeping a single site for
    retreat-cost logic. Mounted only while open: the useState initializers
    ARE the fresh-picks-per-open reset. */
function RetreatDialog({
  game,
  viewerSeat,
  dispatch,
  activeCard,
  cost,
  energyUids,
  bench,
  onClose,
}: {
  game: GameState;
  viewerSeat: Seat;
  dispatch: (action: GameAction) => void;
  /** Top card of the Active being retreated. */
  activeCard: Card;
  /** Its retreat cost — TurnPanel's derivation, not recomputed here. */
  cost: number;
  /** The Active's attached energy uids, the discard-pick pool. */
  energyUids: readonly string[];
  /** The bench to promote from. */
  bench: readonly InPlayPokemon[];
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [benchIndex, setBenchIndex] = useState<number | null>(null);

  const toggleEnergy = (uid: string) => {
    setChosen((prev) =>
      prev.includes(uid)
        ? prev.filter((u) => u !== uid)
        : prev.length < cost
          ? [...prev, uid]
          : prev,
    );
  };

  const ready = chosen.length === cost && benchIndex !== null;

  return (
    <HudDialog label="Retreat" onDismiss={onClose}>
      <h2 className="text-lg font-semibold text-white">Retreat {activeCard.name}</h2>
      {cost > 0 && (
        <>
          <p className="mt-1.5 text-sm text-white/55">
            Discard exactly {cost} attached energ{cost === 1 ? "y" : "ies"} ({chosen.length}/{cost}
            ):
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {energyUids.map((uid) => {
              const selected = chosen.includes(uid);
              return (
                <li key={uid}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleEnergy(uid)}
                    className={`${PICK_ROW_BASE} ${
                      selected ? ROW_BUTTON_SELECTED : ROW_BUTTON_UNSELECTED
                    }`}
                  >
                    {cardOfUid(game, uid)?.name ?? uid}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="mt-3 text-sm text-white/55">Promote to Active:</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {bench.map((pokemon, index) => {
          const name = topCardOf(game, pokemon)?.name ?? "Unknown";
          const selected = benchIndex === index;
          return (
            <li key={topUid(pokemon) ?? index}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => setBenchIndex(index)}
                className={`${PICK_ROW_SPLIT_BASE} ${
                  selected ? ROW_BUTTON_SELECTED : ROW_BUTTON_UNSELECTED
                }`}
              >
                <span className="truncate">{name}</span>
                {pokemon.damage > 0 && (
                  <span className="ml-2 shrink-0 text-xs font-bold text-rose-300">
                    {pokemon.damage} dmg
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className={GLASS_DIALOG_GHOST_BUTTON}>
          Cancel
        </button>
        <button
          type="button"
          className={ACCENT_BUTTON_CLASS}
          disabled={!ready}
          onClick={() => {
            if (benchIndex === null) return;
            dispatch({
              type: "retreat",
              seat: viewerSeat,
              discardEnergy: chosen,
              promoteBenchIndex: benchIndex,
            });
            onClose();
          }}
        >
          Retreat
        </button>
      </div>
    </HudDialog>
  );
}

/** ko:takePrizes — pick exactly `count` of the REMAINING face-down slots.
    Legal indices are 0..prizes.length-1 (the engine's row compacts as prizes
    leave, takePrizes validation), so the grid is built from the live count.
    Mounted only while the decision is parked on the viewer (the phase
    switch), so the useState initializer is the fresh-picks-per-decision
    reset. */
function PrizeDialog({ game, projection, viewerSeat, dispatch }: GameHudProps) {
  const [picked, setPicked] = useState<number[]>([]);
  const pending = projection.pendingDecision;
  // Narrowing only — the phase switch mounts this exactly when the viewer's
  // takePrizes decision is parked.
  if (pending?.kind !== "takePrizes") return null;
  const count = pending.count;
  const remaining = game.players[viewerSeat].prizes.length;

  const toggle = (index: number) => {
    setPicked((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : prev.length < count
          ? [...prev, index]
          : prev,
    );
  };

  return (
    <HudDialog label="Take prizes">
      <h2 className="text-lg font-semibold text-white">
        Take {count} prize card{count === 1 ? "" : "s"}
      </h2>
      <p className="mt-1.5 text-sm text-white/55">
        Pick {count} of your face-down prize card{count === 1 ? "" : "s"} to add to your hand.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {Array.from({ length: remaining }, (_, index) => {
          const selected = picked.includes(index);
          return (
            <button
              key={index}
              type="button"
              aria-pressed={selected}
              aria-label={`Prize ${index + 1}`}
              onClick={() => toggle(index)}
              className={`${PRIZE_CARD_BASE} ${selected ? PRIZE_CARD_PICKED : PRIZE_CARD_IDLE}`}
            />
          );
        })}
      </div>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className={ACCENT_BUTTON_CLASS}
          disabled={picked.length !== count}
          onClick={() => dispatch({ type: "takePrizes", seat: viewerSeat, prizeIndices: picked })}
        >
          Take {picked.length}/{count}
        </button>
      </div>
    </HudDialog>
  );
}

/** ko:promote — the KO'd DEFENDER picks mid-opponent-turn; picking is the
    whole decision, so each row dispatches directly. */
function PromoteDialog({ game, viewerSeat, names, dispatch }: GameHudProps) {
  const side = game.players[viewerSeat];
  return (
    <HudDialog label="Promote a Pokémon">
      <h2 className="text-lg font-semibold text-white">
        {names[viewerSeat]} — choose your next Active
      </h2>
      <p className="mt-1.5 text-sm text-white/55">
        Your Active Pokémon was Knocked Out. Promote one from your Bench.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {side.bench.map((pokemon, index) => {
          const name = topCardOf(game, pokemon)?.name ?? "Unknown";
          return (
            <li key={topUid(pokemon) ?? index}>
              <button
                type="button"
                onClick={() => dispatch({ type: "promote", seat: viewerSeat, benchIndex: index })}
                className={PROMOTE_ROW}
              >
                <span className="truncate">{name}</span>
                {pokemon.damage > 0 && (
                  <span className="ml-2 shrink-0 text-xs font-bold text-rose-300">
                    {pokemon.damage} dmg
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </HudDialog>
  );
}

/** effect:choose — an effect the viewer's action set in motion parked on a
    decision (§15.E/G): a Trainer/Ability the viewer played, OR a triggered
    Ability that fired off a bench-play/evolve drag (M4 slice 6) — both reach
    the SAME phase, so this dialog is origin-agnostic. Dispatches resolveEffect.
    Mounted only while the decision is parked on the viewer (the phase switch),
    so the sub-dialogs' useState is the fresh-picks-per-decision reset. */
function EffectChooseDialog(props: GameHudProps): ReactElement | null {
  const pending = props.projection.pendingDecision;
  // Narrowing only — the phase switch mounts this exactly at effect:choose.
  if (pending?.kind !== "effectChoose") return null;
  const prompt = pending.prompt;
  // AN EXHAUSTIVE SWITCH WITH A DECLARED RETURN TYPE, NOT A TERNARY CHAIN ENDING
  // IN A CATCH-ALL. It was the latter until `confirm` landed, and the difference
  // is the difference between two ways of failing. The old chain's last arm was
  // `<ChoosePokemonDialog prompt={prompt}>`, so a new prompt kind widened the
  // narrowed `prompt` and mismatched that dialog's `Extract<…, "choosePokemon">`
  // prop — which is a compile error, but an INCIDENTAL one: it is bought by a
  // sibling component's prop type, and it evaporates the day a catch-all dialog
  // takes `EffectPrompt` whole or a `kind` gets added whose shape happens to fit.
  // What it fails to be is a statement. This switch is: every arm returns, the
  // return type is annotated, and an unhandled kind is "not all code paths return
  // a value" AT THIS FUNCTION — the same guard `effectDecisionFromPrompt`
  // (projection.ts) and `redactPrompt` (engine) already carry, now on the surface
  // that actually renders. THAT MATTERS MORE HERE THAN ANYWHERE ELSE: a park with
  // no dialog is not a missing feature, it is a SOFT-LOCK — the phase swallows
  // Escape, has no decline, and the game cannot proceed without an answer that no
  // rendered control can send.
  switch (prompt.kind) {
    case "chooseCards":
      return <ChooseCardsDialog {...props} prompt={prompt} />;
    case "choosePokemonMulti":
      return <ChoosePokemonMultiDialog {...props} prompt={prompt} />;
    case "moveEnergy":
      return <MoveEnergyDialog {...props} prompt={prompt} />;
    case "discardEnergy":
      return <DiscardEnergyDialog {...props} prompt={prompt} />;
    case "attachCards":
      return <AttachCardsDialog {...props} prompt={prompt} />;
    case "mayDraw":
      return <MayDrawDialog {...props} prompt={prompt} />;
    case "chooseAttack":
      return <ChooseAttackDialog {...props} prompt={prompt} />;
    case "confirm":
      return <ConfirmPromptDialog {...props} prompt={prompt} />;
    case "choosePokemon":
      return <ChoosePokemonDialog {...props} prompt={prompt} />;
  }
}

/** The printed "**You may** …" answered by the CONTROLLER — the engine's
    `optional` op, whose "yes" splices the wrapped ops into the running program
    and whose "no" runs nothing.

    `MayDrawDialog`'s shape with two deliberate differences, both following from
    WHO answers. It carries NO seat name: every other dialog in this file appears
    because the viewer just did something and "you" is unambiguous — MayDrawDialog
    is the lone exception because it interrupts the OPPONENT's turn, and this one
    is not that. And its accept button is a plain "Yes": mayDraw's label is built
    from the prompt's printed `count` ("Draw 2 cards"), and a generic confirm has
    no number to render — the sentence is already the heading, so a button
    restating it would be the same words twice.

    NO local state and no Confirm step — each button IS the answer and dispatches
    on the tap (D44/D50's "a list of one is not a decision" at its limit), which
    is also why `promptKey` needs no arm for this kind: there are no gathered
    picks that could go stale, exactly as its `default` block already argues for
    `mayDraw`. Escape is swallowed (no `onDismiss`): the program is parked on this
    answer and declining is a real answer, not a dismissal — it must be SAID. */
function ConfirmPromptDialog({
  viewerSeat,
  dispatch,
  prompt,
}: GameHudProps & { prompt: Extract<EffectPrompt, { kind: "confirm" }> }) {
  const answer = (yes: boolean) =>
    dispatch({ type: "resolveEffect", seat: viewerSeat, choice: { kind: "confirm", yes } });
  return (
    <HudDialog label="You may">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      <div className="mt-5 flex justify-end gap-2">
        {/* Yes FIRST in DOM order — where showModal() lands the initial focus —
            for MayDrawDialog's reason: Escape is swallowed, so an unprepared
            Enter must not land on the arm that irreversibly forfeits the
            printed upside. `flex-row-reverse` keeps No reading on the left,
            the siblings' layout. Neither answer is styled as the default:
            both are printed, and declining is not a lesser action. */}
        <div className="flex flex-row-reverse gap-2">
          <button type="button" className={ACCENT_BUTTON_CLASS} onClick={() => answer(true)}>
            Yes
          </button>
          <button type="button" className={NEUTRAL_BUTTON_CLASS} onClick={() => answer(false)}>
            No
          </button>
        </div>
      </div>
    </HudDialog>
  );
}

/** §8/§11 (D157) — pick ONE of the opposing Active's printed attacks to bar for
    its controller's next turn ("Choose 1 of your opponent's Active Pokémon's
    attacks…" — Medicham sv01-111, Oranguru sv02-094). ChoosePokemonDialog's shape,
    on a candidate that is not a Pokémon: no local state and no Confirm, because
    picking IS the whole decision (the "a list of one is not a decision" rule at
    its other limit — the engine never parks this prompt below two candidates).

    The rows carry the attack's own printed NAME straight off the prompt rather
    than being looked up in `game`, and that is the one difference from every
    sibling dialog here worth stating: this component runs on a projection whose
    online form is a wire payload, and the wire has no attack rows for the
    OPPONENT's board at all (`RedactedAttack[]` is the viewer's own Active only).
    The engine resolves the label at the park for exactly that reason, so both
    origins render from the same field. */
function ChooseAttackDialog({
  viewerSeat,
  dispatch,
  prompt,
}: GameHudProps & { prompt: Extract<EffectPrompt, { kind: "chooseAttack" }> }) {
  return (
    <HudDialog label="Choose an attack">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      <ul className="mt-3 flex flex-col gap-1.5">
        {prompt.candidates.map((attack) => (
          <li key={attack.index}>
            <button
              type="button"
              onClick={() =>
                dispatch({
                  type: "resolveEffect",
                  seat: viewerSeat,
                  choice: { kind: "attack", index: attack.index },
                })
              }
              className={`${ROW_BUTTON_BASE} ${ROW_BUTTON_ENABLED}`}
            >
              <span className="truncate">{attack.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </HudDialog>
  );
}

/** The printed "you may" answered by the seat that did NOT play the card
    (Ortega's "your opponent may draw a card") — the engine's first pure yes/no,
    and the first prompt this HUD shows to the non-controller mid-play.
    `projection.waitingOn` already routes it: the engine files the answerer on
    the phase, the projection makes it the waiting seat, and useLocalGame flips
    the hot-seat viewer to them exactly as it does for a KO promotion.

    NO local state and no Confirm: unlike every sibling dialog there is nothing
    to gather, so each button IS the answer and dispatches on the tap — the
    "a list of one is not a decision" rule (D44/D50) at its limit. Both answers
    are equally printed, so neither is styled as the default: declining is not
    a lesser action, and a card the opponent draws is the controller's problem,
    not theirs. Escape is swallowed (no `onDismiss`): the program is parked on
    this answer and there is no third option. */
function MayDrawDialog({
  viewerSeat,
  names,
  dispatch,
  prompt,
}: GameHudProps & { prompt: Extract<EffectPrompt, { kind: "mayDraw" }> }) {
  const answer = (draw: boolean) =>
    dispatch({ type: "resolveEffect", seat: viewerSeat, choice: { kind: "mayDraw", draw } });
  return (
    <HudDialog label="You may draw">
      {/* WHOSE decision this is, BY NAME, above the question itself. Every other
          dialog in this file appears because the viewer just did something, so
          "you" is unambiguous; this one appears on the other player's screen in
          the middle of an opponent's turn, and on a hot-seat device the wrong
          player is holding it. The only other thing that names a seat is the
          handoff banner, and that sits OUTSIDE the modal — once <dialog>
          showModal() runs, the banner is in the inert, backdrop-covered
          subtree. Without this line the device says "You may draw a card" to
          whoever is looking at it, and the engine accepts the answer. */}
      <p className="text-xs font-semibold uppercase tracking-wide text-white/45">
        {names[viewerSeat]} — your opponent's card is asking
      </p>
      <h2 className="mt-1 text-lg font-semibold text-white">{prompt.note}</h2>
      {/* NO <output> here, unlike every sibling dialog, and the absence is the
          considered choice: a live region earns its place by announcing a
          CHANGE (the siblings' running pick counts), and this dialog has no
          state, so any text here would be constant and announce nothing on
          change. The heading and the two buttons are the whole decision. */}
      <div className="mt-5 flex justify-end gap-2">
        {/* Draw FIRST in DOM order, which is where showModal() puts the initial
            focus. Both answers are printed and neither is styled as a default,
            but focus has to land somewhere, and it should not land on the arm
            that silently forfeits a card: Escape is swallowed (this decision is
            owed), so an unprepared player pressing Enter would otherwise
            decline irreversibly. Visual order is reversed by `flex-row-reverse`
            so Decline still reads on the left, the siblings' layout. */}
        <div className="flex flex-row-reverse gap-2">
          <button type="button" className={ACCENT_BUTTON_CLASS} onClick={() => answer(true)}>
            {prompt.count === 1 ? "Draw a card" : `Draw ${prompt.count} cards`}
          </button>
          <button type="button" className={NEUTRAL_BUTTON_CLASS} onClick={() => answer(false)}>
            Decline
          </button>
        </div>
      </div>
    </HudDialog>
  );
}

/** A card pick, origin-agnostic — a deck search (§15.E), a discard-pile
    retrieval (§7.1), a look at the deck top, or a printed hand COST (§7.5),
    whether it is paid to the discard (Ultra Ball) or under the deck (Dendra).
    The prompt's `note` says which; the candidate cards are public in every case
    (deck picks are revealed, the discard pile is open, and a cost is paid out of
    the viewer's OWN hand).

    `prompt.min` is the whole behavioural split, and it is the ENGINE's answer
    rather than this component's guess about the prompt's origin: at 0 the pick is
    the printed "up to" and "Take none" is a legal answer, so Confirm is always
    live; above 0 it is MANDATORY and exact (a cost — the only decision is which
    cards), so Confirm stays disabled until the count is met. Dispatching a short
    pick would be rejected by resolveEffect anyway; disabling is what keeps the
    player from being told no. */
function ChooseCardsDialog({
  game,
  viewerSeat,
  dispatch,
  prompt,
}: GameHudProps & { prompt: Extract<EffectPrompt, { kind: "chooseCards" }> }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (uid: string) => {
    setPicked((prev) =>
      prev.includes(uid)
        ? prev.filter((u) => u !== uid)
        : prev.length < prompt.max
          ? [...prev, uid]
          : prev,
    );
  };
  const mandatory = prompt.min > 0;
  const short = picked.length < prompt.min;
  return (
    <HudDialog label="Choose cards">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {/* An <output> (role=status), not a <p>, and it is the ONE live region —
          the running total is otherwise unannounceable, exactly as
          DiscardEnergyDialog documents: `aria-pressed` is spoken only for the row
          that HAS focus, and Confirm is `disabled` (out of the tab order) while
          the count is the thing you need. It stays MOUNTED in every state, so the
          transition that matters most — short → satisfied, when Confirm becomes
          reachable — is announced. A region that unmounts on satisfaction says
          nothing at the only moment it had something to say.

          The mandatory branch also states that the cost cannot be declined: the
          absence of a "Take none" button is not something a screen reader
          announces. `min === max` at every park site the engine has (0 for the
          printed "up to", `count` here), so the pick is exact. */}
      <output className="mt-1.5 block text-sm text-white/55">
        {mandatory
          ? `Pick ${prompt.min} (${picked.length}/${prompt.max}). ${
              short ? `Pick ${prompt.min - picked.length} more — this cost must be paid.` : "Ready."
            }`
          : `Pick up to ${prompt.max} (${picked.length}/${prompt.max}).`}
      </output>
      <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {prompt.candidates.map((uid) => {
          const selected = picked.includes(uid);
          // At the cap a further click is REFUSED, which for a cost is every
          // completed payment (min === max, so you always finish at the cap).
          // Marked aria-disabled and NOT `disabled`, so the row stays focusable:
          // the rows are how you read the offer. A silently inert button is the
          // one thing the <output> above cannot announce — nothing changes, so
          // nothing is spoken (the DiscardEnergyDialog rule).
          const refused = !selected && picked.length >= prompt.max;
          return (
            <li key={uid}>
              <button
                type="button"
                aria-pressed={selected}
                aria-disabled={refused || undefined}
                onClick={() => toggle(uid)}
                className={`${ROW_BUTTON_BASE} ${
                  selected
                    ? "bg-white/[0.12] text-white ring-white/40"
                    : refused
                      ? ROW_BUTTON_DISABLED
                      : ROW_BUTTON_ENABLED
                }`}
              >
                <span className="truncate">{cardOfUid(game, uid)?.name ?? uid}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          disabled={short}
          className={ACCENT_BUTTON_CLASS}
          onClick={() =>
            dispatch({
              type: "resolveEffect",
              seat: viewerSeat,
              choice: { kind: "cards", uids: picked },
            })
          }
        >
          {mandatory
            ? // A cost is PAID, not taken — the verb has to match the card, and
              // `dest` is the ENGINE's word for which payment this is: a discard,
              // or Dendra's card going under the deck. (`"deckBottom"` is its own
              // destination for exactly this reason — "under the deck" and
              // "shuffled into the deck" are different promises, and deriving one
              // from the other here would be the guess `min` exists to prevent.)
              // It carries the DENOMINATOR too, because once Confirm is finally
              // focusable it is the only surface a keyboard user reaches that can
              // say what was required (the sibling's rule).
              `${prompt.dest === "deckBottom" ? "Put under deck" : "Discard"} ${picked.length}/${prompt.min}`
            : // The same rule on the "up to" side: the verb follows the ENGINE's
              // destination. A retrieval into the DECK is a shuffle, and the
              // heading right above already says so ("Shuffle up to 5 Pokémon …
              // into your deck"), so a Confirm reading "Take 2" contradicted it —
              // on Pal Pad and Super Rod since 0.15.0, and now on Miriam, where
              // the same count also decides whether you draw.
              `${prompt.dest === "deck" ? "Shuffle" : "Take"} ${picked.length === 0 ? "none" : picked.length}`}
        </button>
      </div>
    </HudDialog>
  );
}

/** Choose exactly one Pokémon (switch / gust / heal). Picking is the whole
    decision, so each row dispatches directly. */
function ChoosePokemonDialog({
  game,
  viewerSeat,
  dispatch,
  prompt,
}: GameHudProps & { prompt: Extract<EffectPrompt, { kind: "choosePokemon" }> }) {
  return (
    <HudDialog label="Choose a Pokémon">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      <ul className="mt-3 flex flex-col gap-1.5">
        {prompt.candidates.map((ref) => (
          <li
            key={`${ref.seat}-${ref.spot.spot}-${ref.spot.spot === "bench" ? ref.spot.index : "a"}`}
          >
            <button
              type="button"
              onClick={() =>
                dispatch({
                  type: "resolveEffect",
                  seat: viewerSeat,
                  choice: { kind: "pokemon", ref },
                })
              }
              className={`${ROW_BUTTON_BASE} ${ROW_BUTTON_ENABLED}`}
            >
              <span className="truncate">{refName(game, ref)}</span>
              {ref.seat !== viewerSeat && (
                <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                  opponent
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </HudDialog>
  );
}

/** The snipe (§9): multi-select `min`..`max` opponent Pokémon. The twin of
    ChoosePokemonDialog (exactly one) — picking is not the whole decision here, so
    a confirm button dispatches every pick at once, the ChooseCardsDialog shape
    lifted to Pokémon refs. Mounted only while the decision is parked on the
    viewer, so useState resets per decision.

    Confirm is live only on an answer the ENGINE will accept, which for this
    prompt is not simply "≥ min": `declinable` adds the empty pick as a second
    legal answer without making the ones between it and `min` legal (Hawlucha's
    printed "you may choose 2" is 2 or none, never 1). So the button reads "Take
    none" at zero and is disabled in the gap — the same doctrine as
    ChooseCardsDialog, which is that a dispatch the engine would reject should
    never be offered. */
function ChoosePokemonMultiDialog({
  game,
  viewerSeat,
  dispatch,
  prompt,
}: GameHudProps & { prompt: Extract<EffectPrompt, { kind: "choosePokemonMulti" }> }) {
  const [picked, setPicked] = useState<PokemonRef[]>([]);
  const keyOf = (ref: PokemonRef) =>
    `${ref.seat}-${ref.spot.spot}-${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
  const pickedKeys = new Set(picked.map(keyOf));
  const toggle = (ref: PokemonRef) => {
    setPicked((prev) => {
      const key = keyOf(ref);
      if (prev.some((r) => keyOf(r) === key)) return prev.filter((r) => keyOf(r) !== key);
      return prev.length < prompt.max ? [...prev, ref] : prev;
    });
  };
  const exact = prompt.min === prompt.max;
  // The gap between "some, but not enough" and a legal answer. An empty pick is
  // legal iff the engine says so — `min: 0` (a printed "up to") or `declinable`
  // (a printed "you may"), never inferred from the note.
  const short = picked.length < prompt.min && !(prompt.declinable && picked.length === 0);
  return (
    <HudDialog label="Choose Pokémon">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {/* A live region for the same reason ChooseCardsDialog's is one: the
          running total is otherwise unannounceable (`aria-pressed` is spoken only
          for the focused row, and Confirm leaves the tab order while disabled),
          and the transition that matters is short → satisfied. It also states the
          two things the layout alone implies — that the pick is EXACT, and
          whether taking none is allowed. */}
      <output className="mt-1.5 block text-sm text-white/55">
        {`Pick ${exact ? prompt.min : `up to ${prompt.max}`} (${picked.length}/${prompt.max}).`}
        {short
          ? ` Pick ${prompt.min - picked.length} more${prompt.declinable ? ", or none at all." : "."}`
          : prompt.declinable && picked.length === 0
            ? " Taking none is allowed."
            : ""}
      </output>
      <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {prompt.candidates.map((ref) => {
          const selected = pickedKeys.has(keyOf(ref));
          // At the cap a further click is REFUSED, and the row SAYS so — the one
          // thing the live region above cannot announce, because clicking changes
          // nothing (ChooseCardsDialog's rule; this dialog reaches the cap on
          // every mandatory pick, since min === max).
          const refused = !selected && picked.length >= prompt.max;
          return (
            <li key={keyOf(ref)}>
              <button
                type="button"
                aria-pressed={selected}
                aria-disabled={refused || undefined}
                onClick={() => toggle(ref)}
                className={`${ROW_BUTTON_BASE} ${
                  selected
                    ? "bg-white/[0.12] text-white ring-white/40"
                    : refused
                      ? ROW_BUTTON_DISABLED
                      : ROW_BUTTON_ENABLED
                }`}
              >
                <span className="truncate">{refName(game, ref)}</span>
                {ref.seat !== viewerSeat && (
                  <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                    opponent
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          disabled={short}
          className={ACCENT_BUTTON_CLASS}
          onClick={() =>
            dispatch({
              type: "resolveEffect",
              seat: viewerSeat,
              choice: { kind: "pokemonMulti", refs: picked },
            })
          }
        >
          {/* "Take none" names the DECLINE, so it may only appear on a pick the
              engine would accept as one; otherwise the button carries the
              denominator, which is what a keyboard user reaches last. A printed
              "up to" has no denominator to carry (`min` is 0 and every count up
              to `max` is a legal answer), so it says only what is picked. */}
          {picked.length === 0 && !short
            ? "Take none"
            : exact
              ? `Confirm ${picked.length}/${prompt.min}`
              : `Confirm ${picked.length}`}
        </button>
      </div>
    </HudDialog>
  );
}

/** moveEnergy (§6) — move up to `max` Energy from ONE of your Pokémon to ANOTHER
    (Energy Switch / Poppy). A compound decision the engine parks in one prompt
    (which Energy + where), so it is a staged dialog like Rare Candy: pick the
    source Pokémon (auto when only one has movable Energy), then its Energy and a
    distinct destination, then Confirm — or Move none to decline ("up to"). The
    engine re-validates the whole choice (same source, distinct destination).
    Mounted only while parked on the viewer, so the useState is the per-decision
    reset.

    ⚠️ `prompt.anySource` (D226 — N's Plan) REMOVES THE SOURCE STAGE, and that is
    why the rider had to reach this file at all. The stage is not decoration: it
    FILTERS the Energy list to one host, so a dialog that kept it would make the
    card's whole point — one Energy off each of two benched bodies — unreachable
    from the UI while the engine happily accepted it. With the rider every offered
    Energy is listed at once, labelled by the Pokémon it sits on, and the
    destination list drops any host a pick currently sits on (the per-pick
    self-move rule the validator applies, mirrored so the client cannot build an
    answer the engine will refuse). */
function MoveEnergyDialog({
  game,
  viewerSeat,
  dispatch,
  prompt,
}: GameHudProps & { prompt: Extract<EffectPrompt, { kind: "moveEnergy" }> }) {
  const keyOf = (ref: PokemonRef) =>
    `${ref.seat}-${ref.spot.spot}-${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
  // The distinct source Pokémon (those that hold movable Energy), first-seen order.
  const sources: PokemonRef[] = [];
  const seenSource = new Set<string>();
  for (const { from } of prompt.movable) {
    const key = keyOf(from);
    if (!seenSource.has(key)) {
      seenSource.add(key);
      sources.push(from);
    }
  }
  // D226 — the printed plural. With it there is NO source stage: `staged` is
  // false and every offered Energy is on one list.
  const anySource = prompt.anySource === true;
  // Pre-select when only one Pokémon can be the source (skip straight to the
  // Energy + destination pick), otherwise the player chooses the source first.
  const [sourceKey, setSourceKey] = useState<string | null>(
    sources.length === 1 ? keyOf(sources[0] as PokemonRef) : null,
  );
  const [pickedUids, setPickedUids] = useState<string[]>([]);
  const [destKey, setDestKey] = useState<string | null>(null);

  // Under the rider there is no staged source AT ALL — not even the auto-selected
  // one a single-source board would get, because "which host" stops being a
  // question the moment the answer may span hosts.
  const source = anySource ? null : (sources.find((ref) => keyOf(ref) === sourceKey) ?? null);
  // The Energy on offer: one host's under the coupling, ALL of them under D226's
  // rider — which is the whole behavioural difference in this dialog.
  const offered =
    source === null
      ? anySource
        ? prompt.movable
        : []
      : prompt.movable.filter(({ from }) => keyOf(from) === sourceKey);
  // Destinations are the offered ones minus the source(s) the picks sit on (no
  // self-move). Under the coupling that is the single staged source; under the
  // rider it is every host a pick currently comes off, recomputed as picks change
  // — the same per-pick rule cardplay.ts applies, so the dialog cannot assemble
  // an answer the engine would refuse.
  const pickedHosts = new Set(
    prompt.movable.filter(({ uid }) => pickedUids.includes(uid)).map(({ from }) => keyOf(from)),
  );
  const dests = prompt.destinations.filter((ref) =>
    anySource ? !pickedHosts.has(keyOf(ref)) : keyOf(ref) !== sourceKey,
  );
  // A SOLE destination is already chosen — the same rule the source list above
  // follows, for the same reason: a list of one is not a decision. It became
  // worth stating when the benchToActive route (Armarouge's "Fire Off") made a
  // single destination the NORMAL case rather than an edge one — otherwise every
  // use of an as-often-as-you-like Ability costs a redundant click on the only
  // legal target. Derived, not state: `dests` shifts when the source changes, and
  // a stored key would have to be resynced.
  const dest =
    dests.find((ref) => keyOf(ref) === destKey) ??
    (dests.length === 1 ? (dests[0] as PokemonRef) : null);
  const declineDest = prompt.destinations[0];

  const reset = () => {
    setPickedUids([]);
    setDestKey(null);
  };
  const togglePick = (uid: string) => {
    setPickedUids((prev) =>
      prev.includes(uid)
        ? prev.filter((u) => u !== uid)
        : prev.length < prompt.max
          ? [...prev, uid]
          : prev,
    );
  };
  const ready = pickedUids.length > 0 && dest !== null;
  // Past the source stage — either because it was answered, or (D226) because
  // there was never one. Confirm and the Energy list both hang off this.
  const picking = anySource || source !== null;

  return (
    <HudDialog label="Move Energy">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {!picking ? (
        <>
          <p className="mt-1.5 text-sm text-white/55">Choose which Pokémon to move Energy from.</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {sources.map((ref) => (
              <li key={keyOf(ref)}>
                <button
                  type="button"
                  onClick={() => {
                    setSourceKey(keyOf(ref));
                    reset();
                  }}
                  className={`${ROW_BUTTON_BASE} ${ROW_BUTTON_ENABLED}`}
                >
                  <span className="truncate">{refName(game, ref)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {/* <output> — an implicit polite LIVE REGION, the house pattern its
              DiscardEnergyDialog sibling already follows, and the argument carries
              over verbatim: `aria-pressed` is only spoken for the row that HAS
              focus, and the Confirm button ("Move 1") is `disabled` until ready —
              out of the tab order exactly while the count is what you need. It
              also carries the destination, which is the part this dialog now
              decides on the player's behalf when only one is legal: otherwise the
              only way to learn where the Energy is going is to tab onto a row that
              is already pressed without anyone having pressed it. */}
          <output className="mt-1.5 block text-sm text-white/55">
            {source === null ? (
              "Pick up to "
            ) : (
              <>
                From <span className="text-white/80">{refName(game, source)}</span> — pick up to{" "}
              </>
            )}
            {prompt.max} ({pickedUids.length}/{prompt.max})
            {dest !== null && (
              <>
                , moving to <span className="text-white/80">{refName(game, dest)}</span>
              </>
            )}
            :
          </output>
          <ul className="mt-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
            {offered.map(({ uid, from }) => {
              const selected = pickedUids.includes(uid);
              const name = cardOfUid(game, uid)?.name ?? uid;
              return (
                <li key={uid}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => togglePick(uid)}
                    className={`${ROW_BUTTON_BASE} ${
                      selected ? "bg-white/[0.12] text-white ring-white/40" : ROW_BUTTON_ENABLED
                    }`}
                  >
                    {/* With no source stage the host is not implied by anything
                        else on screen, so each row carries it (D226). */}
                    <span className="truncate">
                      {source === null ? `${name} — ${refName(game, from)}` : name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm text-white/55">Move to:</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {dests.map((ref) => {
              const selected = dest !== null && keyOf(dest) === keyOf(ref);
              return (
                <li key={keyOf(ref)}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDestKey(keyOf(ref))}
                    className={`${ROW_BUTTON_BASE} ${
                      selected ? "bg-white/[0.12] text-white ring-white/40" : ROW_BUTTON_ENABLED
                    }`}
                  >
                    <span className="truncate">{refName(game, ref)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="mt-5 flex justify-between gap-2">
        {declineDest !== undefined && (
          <button
            type="button"
            className={GLASS_DIALOG_GHOST_BUTTON}
            onClick={() =>
              dispatch({
                type: "resolveEffect",
                seat: viewerSeat,
                choice: { kind: "moveEnergy", uids: [], dest: declineDest },
              })
            }
          >
            Move none
          </button>
        )}
        <div className="flex gap-2">
          {source !== null && sources.length > 1 && (
            <button
              type="button"
              className={GLASS_DIALOG_GHOST_BUTTON}
              onClick={() => {
                setSourceKey(null);
                reset();
              }}
            >
              ← Back
            </button>
          )}
          {picking && (
            <button
              type="button"
              className={ACCENT_BUTTON_CLASS}
              disabled={!ready}
              onClick={() => {
                if (dest === null) return;
                dispatch({
                  type: "resolveEffect",
                  seat: viewerSeat,
                  choice: { kind: "moveEnergy", uids: pickedUids, dest },
                });
              }}
            >
              Move {pickedUids.length}
            </button>
          )}
        </div>
      </div>
    </HudDialog>
  );
}

/** discardEnergy (§15) — take Energy off the OPPONENT's board (Crushing Hammer /
    Giacomo / Mawile) or off the viewer's OWN Active (the §8 self-discard attack
    cost — Paldean Tauros' "Blaze Dash"), which is why every group carries its
    side. MANDATORY, so there is no decline button: the only question is which
    Energy, and the engine only parks when that question is real (a forced pick,
    or a set of interchangeable ones, auto-resolved before the dialog could
    mount). Two shapes off the
    prompt's `scope`: "total" is a flat pick of exactly `count` candidates
    (1 for a Crushing Hammer, 2 for Corviknight's "Discard 2 Energy from this
    Pokémon"), grouped under the Pokémon each sits on so a one-pick choice reads
    as "which Pokémon, which Energy"; "each" (Giacomo) asks for exactly one per
    group, and Confirm stays disabled until every group has its pick. Mounted
    only while parked on the viewer, so the useState is the per-decision reset. */
function DiscardEnergyDialog({
  game,
  viewerSeat,
  dispatch,
  prompt,
}: GameHudProps & { prompt: Extract<EffectPrompt, { kind: "discardEnergy" }> }) {
  // Hoisted so the pick handler's closure keeps the discriminant narrowed.
  const scope = prompt.scope;
  const keyOf = (ref: PokemonRef) =>
    `${ref.seat}-${ref.spot.spot}-${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
  // The candidates grouped by the Pokémon they sit on, first-seen (board) order —
  // the same grouping `scope: "each"` counts against.
  const groups: { key: string; ref: PokemonRef; uids: string[] }[] = [];
  for (const { uid, from } of prompt.discardable) {
    const key = keyOf(from);
    const group = groups.find((g) => g.key === key);
    if (group === undefined) groups.push({ key, ref: from, uids: [uid] });
    else group.uids.push(uid);
  }
  // "each" (Giacomo) PRE-ANSWERS every group holding a single candidate: that
  // group is not a question — the engine's own `forcedDiscards` would have
  // auto-resolved the whole op if they all were (the M1 "a choice with no choice
  // in it is not a choice" doctrine), and it is only the ONE Pokémon carrying two
  // Special Energy that parks the play. Without this the player has to re-click
  // every forced group before Confirm lights up. Same shape as MoveEnergyDialog
  // pre-selecting a sole source. "one" starts empty — there the whole answer is
  // a single uid, so nothing is forced unless the engine already resolved it.
  const [picked, setPicked] = useState<string[]>(() =>
    scope.kind === "each"
      ? groups.flatMap((group) => (group.uids.length === 1 ? [group.uids[0] as string] : []))
      : [],
  );
  // "each": ONE pick per Pokémon — a pick REPLACES that group's previous one
  // rather than adding to it, exactly the rule the engine re-validates.
  // "total": a flat multi-select of `count` Energy from anywhere in the offer,
  // since an exact-N discard takes all N off one Pokémon. Clicking a selected row
  // clears it; AT THE CAP a further click is REFUSED — the rule ChooseCardsDialog
  // and ChoosePokemonMultiDialog already follow — except at count 1, where
  // replacing the single pick is the established feel and nothing is ambiguous.
  // Deliberately NOT evict-the-oldest above 1: that silently un-presses a row the
  // user is not looking at, and since interchangeable copies can now legitimately
  // be offered more than once, the evictable rows may be identical by name.
  const pick = (groupUids: readonly string[], uid: string) => {
    setPicked((prev) => {
      if (scope.kind === "each") {
        const others = prev.filter((u) => !groupUids.includes(u));
        return prev.includes(uid) ? others : [...others, uid];
      }
      if (prev.includes(uid)) return prev.filter((u) => u !== uid);
      // "upTo" (Hail Blade's "any amount") is a flat multi-select like "total",
      // but declinable and capped at `max` — never a replace-at-1, since 0 is a
      // legal answer and there is no single mandatory pick to swap.
      if (scope.kind === "upTo") return prev.length < scope.max ? [...prev, uid] : prev;
      if (prev.length < scope.count) return [...prev, uid];
      return scope.count === 1 ? [uid] : prev;
    });
  };
  // "upTo" is DECLINABLE — any count 0..max is a valid answer, so Confirm is
  // always ready; the mandatory scopes need an exact count.
  const required =
    scope.kind === "total" ? scope.count : scope.kind === "upTo" ? scope.max : groups.length;
  const ready = scope.kind === "upTo" || picked.length === required;

  return (
    <HudDialog label="Discard Energy">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {/* <output> — an implicit polite LIVE REGION (the house pattern), because
          the running total is otherwise unannounceable:
          `aria-pressed` is only spoken for the row that has focus, and the
          Confirm button's "Discard 1/2" is `disabled` until ready — so out of the
          tab order exactly while the count is the thing you need. Doubly so now
          that two rows may share a name (interchangeable copies are legitimately
          offered for an exact-N pick) and that a click at the cap is REFUSED:
          without this, silence is the only feedback either produces. */}
      <output className="mt-1.5 block text-sm text-white/55">
        {scope.kind === "each"
          ? `Pick one Energy from each Pokémon (${picked.length}/${required}).`
          : scope.kind === "upTo"
            ? `Pick any amount of Energy to discard (${picked.length} selected).`
            : required > 1
              ? `Pick ${required} Energy to discard (${picked.length}/${required}).`
              : "Pick the Energy to discard."}
      </output>
      <div className="mt-3 flex max-h-64 flex-col gap-3 overflow-y-auto">
        {/* fieldset/legend, not a bare heading + list: this is the only HUD
            dialog whose candidate rows are GROUPED, and every row reads
            "Basic Energy" or the like, so without the host being part of the
            group's accessible name a screen reader never says WHICH Pokémon
            the Energy would come off. The flat-list siblings need nothing. */}
        {groups.map((group) => (
          <fieldset key={group.key} className="min-w-0">
            {/* The SPOT rides the legend — unlike the flat sibling dialogs, which
                name the Pokémon alone — because for a Crushing Hammer WHICH host
                loses the Energy is the entire decision, and two Pokémon sharing a
                name would otherwise give two identical legends. (Interchangeable
                copies of one Energy print on ONE Pokémon collapse in the engine to
                as many rows as the pick could want — so a one-Energy discard shows
                a single row, and only an exact-N discard can show repeats, where
                identical rows are genuinely interchangeable answers.)
                The SIDE rides it too, the same `opponent` marker
                ChoosePokemonDialog puts on its rows: this dialog now serves both
                boards — the opponent's for the hammer family and the viewer's OWN
                Active for a self-discard attack cost — and the legend is the only
                context a screen reader gets for the rows under it. */}
            <legend className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              {refName(game, group.ref)} ·{" "}
              {group.ref.spot.spot === "active" ? "Active" : `Bench ${group.ref.spot.index + 1}`}
              {group.ref.seat !== viewerSeat && " · opponent"}
            </legend>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {group.uids.map((uid) => {
                const selected = picked.includes(uid);
                // A row the cap has closed off says so, rather than just doing
                // nothing when clicked: `pick` REFUSES at `count` (above 1), and
                // a silently inert row is the one thing the <output> above cannot
                // announce — nothing changes, so nothing is spoken. Marked
                // aria-disabled and NOT `disabled`, so it stays focusable: the
                // rows are how you read the offer, and dropping them out of the
                // tab order at the cap would hide half the board from a keyboard
                // user mid-decision.
                // `scope.count > 1` matters: at count 1 a click REPLACES the pick,
                // so no row is ever refused there — mirroring `pick` exactly.
                const refused =
                  !selected &&
                  ((scope.kind === "total" && scope.count > 1 && picked.length >= scope.count) ||
                    (scope.kind === "upTo" && picked.length >= scope.max));
                return (
                  <li key={uid}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-disabled={refused || undefined}
                      onClick={() => pick(group.uids, uid)}
                      className={`${ROW_BUTTON_BASE} ${
                        selected
                          ? "bg-white/[0.12] text-white ring-white/40"
                          : refused
                            ? ROW_BUTTON_DISABLED
                            : ROW_BUTTON_ENABLED
                      }`}
                    >
                      <span className="truncate">{cardOfUid(game, uid)?.name ?? uid}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className={ACCENT_BUTTON_CLASS}
          disabled={!ready}
          onClick={() =>
            dispatch({
              type: "resolveEffect",
              seat: viewerSeat,
              choice: { kind: "discardEnergy", uids: picked },
            })
          }
        >
          {scope.kind === "upTo"
            ? picked.length === 0
              ? "Discard none"
              : `Discard ${picked.length}`
            : `Discard ${picked.length}/${required}`}
        </button>
      </div>
    </HudDialog>
  );
}

/** attachFromTop (§15.E + §6) — attach cards found on the deck TOP onto your own
    Pokémon, "in any way you like" (Electric Generator / Hydreigon "Tri Howl").
    The one dialog whose answer is a MAP: each card carries its own destination,
    where MoveEnergyDialog's picks share one. So it is a two-step LOOP rather than
    a two-step wizard — pick a card, pick where it goes, repeat — and the target
    list is mounted only while a card is waiting for one. A target list of ONE
    never mounts at all: a list of one is not a decision (the MoveEnergyDialog
    rule, and the shape of every `toSelf` offer — the engine already resolved
    "this Pokémon" to a single ref), so the tap commits the attach outright and
    the row's own "→" readback says where it went.
    Clicking an already-assigned card TAKES IT BACK (there is no other way to undo
    a misplaced attach, and the alternative — closing the dialog — is not offered
    for a parked decision). Declinable with "Attach none", which is not the same as
    doing nothing: the card's leftovers clause still runs (Tri Howl still discards
    what it looked at). Mounted only while parked on the viewer, so the useState is
    the per-decision reset. */
function AttachCardsDialog({
  game,
  viewerSeat,
  dispatch,
  prompt,
}: GameHudProps & { prompt: Extract<EffectPrompt, { kind: "attachCards" }> }) {
  const keyOf = (ref: PokemonRef) =>
    `${ref.seat}-${ref.spot.spot}-${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
  const [assignments, setAssignments] = useState<{ uid: string; to: PokemonRef }[]>([]);
  /** The card waiting for a destination — the only reason the target list shows. */
  const [pending, setPending] = useState<string | null>(null);
  const destOf = (uid: string) => assignments.find((a) => a.uid === uid)?.to;
  /** How many are already going to this Pokémon, and whether that is all it may
      take. `maxPerTarget` is the printed "for each of those Pokémon" (Janine's
      Secret Art — one Energy apiece); absent is "in any way you like", where a
      Pokémon can take every card in the offer. The engine rejects an over-stacked
      answer either way, so this is about not OFFERING one: a target row that
      cannot legally take the pending card has to say so, the same rule the card
      rows already follow at the cap. */
  const assignedTo = (ref: PokemonRef) =>
    assignments.filter((a) => keyOf(a.to) === keyOf(ref)).length;
  const targetFull = (ref: PokemonRef) =>
    prompt.maxPerTarget !== undefined && assignedTo(ref) >= prompt.maxPerTarget;
  /** No Pokémon can legally take another card — reachable only under a
      per-target cap (Janine, whose Energy go one apiece). On every offer the
      ENGINE builds this is never the DECIDING term: `attachFromDeckOffer` clamps
      `max` to `targets × maxPerTarget`, so "every target is full" can only arrive
      together with the count cap, never before it — Janine on a one-{D}-Pokémon
      board parks at `max: 1` and reaches both at 1/1. What it decides there is
      the SENTENCE below, not whether the next pick is refused.
      It is folded into `atCap` rather than handled beside it for the case that
      clamp does NOT cover — an offer that somehow arrived unclamped — so that
      picking a card with nowhere to put it is refused UP FRONT, exactly as
      picking one past the printed maximum is: the alternative is a dialog that
      accepts the pick, shows a list of rows that all refuse it, and leaves the
      way out (tap the card again) to be guessed. The length guard keeps `every`
      from reading an empty target list as "full" — stepOp never parks with no
      targets, and this does not depend on that. */
  const noRoom = prompt.targets.length > 0 && prompt.targets.every(targetFull);
  const atCap = assignments.length >= prompt.max || noRoom;
  /** The offer's only Pokémon, when it has only one — every `toSelf` offer
      (Pawmot: "this Pokémon" arrives as a single ref) and any board that
      leaves one eligible target (Janine over a lone {D} Pokémon). `tapCard`
      then commits the attach itself and the target list never mounts. A full
      sole target needs no guard of its own: it makes `noRoom`, which is
      already folded into `atCap`. */
  const soleTarget = prompt.targets.length === 1 ? (prompt.targets[0] ?? null) : null;
  const spotOf = (ref: PokemonRef) =>
    ref.spot.spot === "active" ? "Active" : `Bench ${ref.spot.index + 1}`;
  /** A row's readback: the Pokémon AND its spot, because `benchOnly` cards offer
      several benched Pokémon that may share a name — "→ fix-lightning-1" alone
      cannot tell the player which one they just chose, and releasing the
      assignment to find out is the only alternative. */
  const destLabel = (ref: PokemonRef) => `${refName(game, ref)} · ${spotOf(ref)}`;

  const tapCard = (uid: string) => {
    if (destOf(uid) !== undefined) {
      // Releasing an assignment leaves any OTHER card's pending pick alone: the
      // two are independent decisions, and clearing it would silently throw away
      // a selection the player made and can still see highlighted.
      setAssignments((prev) => prev.filter((a) => a.uid !== uid));
      setPending((prev) => (prev === uid ? null : prev));
      return;
    }
    if (soleTarget !== null) {
      // Commits outright — but the cap still refuses the pick up front, by
      // calling no setter at all: the card rows' no-announce rule at `atCap`.
      if (!atCap) setAssignments((prev) => [...prev, { uid, to: soleTarget }]);
      return;
    }
    setPending((prev) => (prev === uid ? null : atCap ? prev : uid));
  };
  const assign = (to: PokemonRef) => {
    if (pending === null || targetFull(to)) return;
    setAssignments((prev) => [...prev, { uid: pending, to }]);
    setPending(null);
  };
  const pendingName = pending === null ? null : (cardOfUid(game, pending)?.name ?? pending);

  return (
    <HudDialog label="Attach cards">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {/* <output> — an implicit polite LIVE REGION, the house pattern its
          MoveEnergy/DiscardEnergy siblings follow. It carries strictly more here:
          the running count (unannounceable otherwise — `aria-pressed` is spoken
          only for the focused row) and WHICH card is waiting for a destination,
          since the target list appearing below is a silent change on its own.
          It does NOT announce a refused click: `tapCard` returns the previous
          state there, so React bails out and nothing re-renders — the same
          honest limit DiscardEnergyDialog's own note records. That is why the
          at-cap text says what you CAN do (release one) instead of repeating
          "pick a card", which at the cap is exactly what you cannot do. */}
      <output className="mt-1.5 block text-sm text-white/55">
        {pendingName === null
          ? // `noRoom` is a SECOND reason the next pick is refused, and it reads
            // nothing like the first: the count is at its ceiling either way, but
            // "Attaching 1/1" over a prompt that printed "up to 2" looks like a
            // dropped card unless the sentence says the {D} Pokémon, not the
            // Energy, are what ran out. (The at-cap wording itself is the block
            // above's rule.) Under a sole target, "move it" would promise a
            // second destination that does not exist — the undo verb is "take
            // it back" — and the idle line drops "then where it goes", which is
            // not a step the player will be given.
            `Attaching ${assignments.length}/${prompt.max}. ${
              noRoom
                ? soleTarget !== null
                  ? `${refName(game, soleTarget)} already has one — tap the attached card to take it back.`
                  : "Every eligible Pokémon already has one — tap an attached card to move it."
                : atCap
                  ? soleTarget !== null
                    ? "Tap an attached card to take it back."
                    : "Tap an attached card to move it."
                  : soleTarget !== null
                    ? "Pick a card to attach."
                    : "Pick a card, then where it goes."
            }`
          : `Attaching ${assignments.length}/${prompt.max}. Where does ${pendingName} go?`}
      </output>
      <ul className="mt-3 flex max-h-52 flex-col gap-1.5 overflow-y-auto">
        {prompt.candidates.map((uid) => {
          const dest = destOf(uid);
          const selected = pending === uid;
          const name = cardOfUid(game, uid)?.name ?? uid;
          // A row the cap has closed off says so rather than silently ignoring
          // the click — the DiscardEnergyDialog rule. aria-disabled, NOT
          // `disabled`: the rows are how you read the offer, and an assigned row
          // must stay reachable because clicking it is the only undo. (`selected`
          // need not be excluded — a pending card only exists below the cap — but
          // the guard is kept so the predicate reads without that invariant.)
          const refused = dest === undefined && !selected && atCap;
          return (
            <li key={uid}>
              <button
                type="button"
                // The state is spoken as part of the row's NAME rather than left
                // to the adjacent span: separate elements are trimmed and
                // concatenated by the accessible-name algorithm, so the visible
                // "Lightning Energy → Pikachu" would otherwise be announced as one
                // run-on word.
                aria-label={
                  dest === undefined
                    ? selected
                      ? `${name} — choosing where it goes`
                      : name
                    : `${name} → ${destLabel(dest)}`
                }
                // ONLY a committed assignment is "pressed". A pending card is NOT:
                // Confirm dispatches `assignments`, which does not contain it, so
                // announcing it as pressed would promise an attach that will not
                // happen. `aria-current` is the honest state for "this is the one
                // being worked on", and the ring/label carry it visually.
                aria-pressed={dest !== undefined}
                aria-current={selected || undefined}
                aria-disabled={refused || undefined}
                onClick={() => tapCard(uid)}
                className={`${ROW_BUTTON_BASE} ${
                  dest !== undefined
                    ? "bg-white/[0.12] text-white ring-white/40"
                    : selected
                      ? "bg-white/[0.06] text-white ring-accent/70"
                      : refused
                        ? ROW_BUTTON_DISABLED
                        : ROW_BUTTON_ENABLED
                }`}
              >
                <span className="truncate">{name}</span>
                {(dest !== undefined || selected) && (
                  <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                    {dest === undefined ? "choosing…" : `→ ${destLabel(dest)}`}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {pending !== null && (
        <>
          <p className="mt-3 text-sm text-white/55">Attach to:</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {/* The SPOT rides every row (the DiscardEnergyDialog legend's rule):
                `benchOnly` cards offer several benched Pokémon that may share a
                name, and which one gets the Energy is the whole decision. */}
            {prompt.targets.map((ref) => {
              // aria-disabled, not `disabled`: the rows are how the player reads
              // which Pokémon are eligible at all, so a full one must stay
              // readable and focusable — the card rows' rule at the cap.
              const full = targetFull(ref);
              return (
                <li key={keyOf(ref)}>
                  <button
                    type="button"
                    aria-label={full ? `${destLabel(ref)} — already has one` : destLabel(ref)}
                    aria-disabled={full || undefined}
                    onClick={() => assign(ref)}
                    className={`${ROW_BUTTON_BASE} ${full ? ROW_BUTTON_DISABLED : ROW_BUTTON_ENABLED}`}
                  >
                    <span className="truncate">{refName(game, ref)}</span>
                    <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                      {/* The spot RIDES the full state, it is not replaced by it
                          — the block above's rule, and Janine is the board it was
                          written for: two identically-named {D} Pokémon, told
                          apart by nothing else. Swapping "Bench 1" for "has one"
                          left the sighted reader resolving the list by
                          elimination, which is the exact reasoning the spot
                          exists to make unnecessary. (The accessible name always
                          carried both.) */}
                      {full ? `${spotOf(ref)} · has one` : spotOf(ref)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className={ACCENT_BUTTON_CLASS}
          onClick={() =>
            dispatch({
              type: "resolveEffect",
              seat: viewerSeat,
              choice: {
                kind: "attachCards",
                // Filtered against the OFFER at dispatch time. Today this is a
                // no-op: the `promptKey` remount clears `assignments` between two
                // parks, so every uid here was offered. It is here because the
                // failure mode if that key ever stops discriminating is not a bad
                // attach — it is an UNESCAPABLE dialog. A stale uid renders no row
                // (the offer changed), so it cannot be released; every dispatch,
                // "Attach none" included, is rejected as not-offered; the state
                // never changes, so the prompt never changes, so the dialog never
                // remounts. This one filter turns that soft-lock into a lost pick.
                assignments: assignments.filter((a) => prompt.candidates.includes(a.uid)),
              },
            })
          }
        >
          {assignments.length === 0 ? "Attach none" : `Attach ${assignments.length}`}
        </button>
      </div>
    </HudDialog>
  );
}

function GameOverOverlay({ projection, viewerSeat, names, onPlayAgain }: GameHudProps) {
  const outcome = projection.outcome;
  if (outcome === null) return null;
  const title =
    outcome.result === "win"
      ? `${outcome.winner === "you" ? names[viewerSeat] : names[otherSeat(viewerSeat)]} wins!`
      : "It's a tie";
  const detail =
    outcome.result === "win"
      ? GAME_OVER_DETAIL[outcome.reason]
      : "Both players met a win condition at the same time.";
  return (
    <div className="absolute inset-0 z-[85] flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
      <section
        aria-label="Game over"
        className={`w-[min(24rem,calc(100vw-2.5rem))] text-center ${GLASS_DIALOG_PANEL}`}
      >
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        <p className="mt-2 text-sm text-white/60">{detail}</p>
        <div className="mt-6 flex justify-center">
          <button type="button" className={ACCENT_BUTTON_CLASS} onClick={onPlayAgain}>
            Play again
          </button>
        </div>
      </section>
    </div>
  );
}

/** A stable identity for one parked decision — the prompt kind plus whatever it
    offers. Two consecutive parks of the same kind differ here whenever their
    candidates do, which is what makes the dialog's local picks reset between
    them (see the effect:choose case below). */
function promptKey(prompt: EffectPrompt): string {
  switch (prompt.kind) {
    case "chooseCards":
      // The BOUNDS ride the key beside the candidates, for the reason `scope`
      // rides discardEnergy's: the dialog's picked-state is only valid for the
      // bounds it was gathered under, and min/max decide whether Confirm is even
      // reachable. Ultra Ball is the codebase's likeliest double-park on ONE
      // prompt kind (a hand cost, then a deck search), and while those two
      // candidate sets cannot actually collide — hand uids then deck uids — the
      // key's job is not to depend on that: a stale pick surviving into the
      // second park would render rows that do not exist and leave the dialog
      // unescapable, since it has no decline and swallows Escape.
      return `cards:${prompt.min}:${prompt.max}:${prompt.candidates.join(",")}`;
    case "discardEnergy":
      // The SCOPE rides the key too: the dialog's picked-state is only valid for
      // the count it was gathered under, so two parks offering the same uids at
      // different counts must not share one. (Unreachable today — resolving a
      // discard always removes Energy, so the offer changes — but the key's whole
      // job is "any change the state depends on is a new key".)
      return `discard:${prompt.scope.kind === "total" ? prompt.scope.count : "each"}:${prompt.discardable
        .map((d) => d.uid)
        .join(",")}`;
    case "moveEnergy":
      // The DESTINATIONS ride the key for the same reason the scope rides the one
      // above — the dialog's `dest` is derived from them (a sole destination is
      // pre-chosen), so the same movable set offered against a different
      // destination set is a different question. `max` rides too, since it caps
      // the pick. The one path that leaves `movable` untouched is the DECLINE
      // ("Move none" moves nothing), so a program with two moveEnergy ops whose
      // first was declined is exactly the case a movable-only key would let
      // inherit a stale pick. No program has two today; the key's job is not to
      // depend on that.
      return `move:${prompt.max}:${prompt.destinations
        .map((d) => `${d.seat}-${d.spot.spot === "bench" ? d.spot.index : "active"}`)
        .join(",")}:${prompt.movable.map((m) => m.uid).join(",")}`;
    case "attachCards":
      // BOTH halves ride the key, because both are half of every answer: the
      // cards on offer AND the Pokémon they may go on (`max` and `maxPerTarget`
      // too, since they cap the pick — an assignment gathered under "in any way
      // you like" is not a legal answer to a one-apiece prompt). An
      // as-often-as-you-like Ability makes this the likeliest dialog to park
      // twice in one turn, and a second Tri Howl looking at three new cards must
      // not inherit a pick keyed to the last three.
      return `attach:${prompt.max}:${prompt.maxPerTarget ?? "any"}:${prompt.targets
        .map((t) => `${t.seat}-${t.spot.spot === "bench" ? t.spot.index : "active"}`)
        .join(",")}:${prompt.candidates.join(",")}`;
    case "choosePokemonMulti":
      // The CANDIDATES and the bounds ride the key, like every sibling above —
      // the note alone was never enough, and it is now the least identifying
      // part of the prompt (two snipes of the same size and amount print the
      // same sentence). A stale pick here is not merely a wrong target: refs
      // that are no longer offered are rejected on dispatch, and a mandatory
      // prompt has no decline, so the dialog would be unescapable.
      return `pokemonMulti:${prompt.min}:${prompt.max}:${prompt.declinable}:${prompt.candidates
        .map((c) => `${c.seat}-${c.spot.spot === "bench" ? c.spot.index : "active"}`)
        .join(",")}`;
    default:
      // `mayDraw` deliberately has NO arm of its own, and it is the one prompt
      // kind where that is provably right rather than merely untested. Every
      // arm above exists because its dialog gathers LOCAL PICKS that are only
      // valid for the offer they were gathered under, so a changed offer must
      // remount and reset them. MayDrawDialog gathers nothing — both buttons
      // dispatch on the tap and every label is derived from `prompt.count` on
      // each render — so a same-key re-render with a new prompt simply
      // re-renders correctly, and no bespoke key can be observed to do
      // anything. (A first draft added `mayDraw:${count}` with a comment about
      // stale labels; gutting it to a constant passed every test, because there
      // was nothing there to catch.) The `kind:note` default still gives it a
      // per-count identity, since the note carries the number.
      return `${prompt.kind}:${prompt.note}`;
  }
}

export function GameHud(props: GameHudProps) {
  const { game, projection } = props;
  // Exactly one panel per phase. Every interactive panel is mounted only
  // while the viewer is the seat being waited on (D17 rule one); gameOver has
  // no actor — waitingOn is null — so the outcome overlay sits OUTSIDE the
  // acting gate.
  const acting = projection.waitingOn === "you";
  // Keys tie panel-local state (retreat picks, draw counts, prize picks) to
  // the seat and turn they were opened for — a hot-seat flip must never
  // inherit them. The switch mounts at most ONE panel, so the keys only
  // govern remount-on-seat/turn; there is no sibling list to keep unique.
  const seatKey = `${props.viewerSeat}-${game.turn}`;
  switch (game.phase.kind) {
    case "setup:chooseFirst":
      return acting ? <ChooseFirstPanel {...props} coinWinner={game.phase.coinWinner} /> : null;
    case "setup:drawExtra":
      return acting ? (
        <DrawExtraPanel
          key={`draw:${props.viewerSeat}`}
          {...props}
          owed={game.phase.owed[props.viewerSeat]}
        />
      ) : null;
    case "setup:place":
      return acting ? <PlacePanel {...props} /> : null;
    case "turn:action":
      return acting ? <TurnPanel key={`turn:${seatKey}`} {...props} /> : null;
    case "ko:takePrizes":
      return acting ? <PrizeDialog key={`prizes:${seatKey}`} {...props} /> : null;
    case "ko:promote":
      return acting ? <PromoteDialog {...props} /> : null;
    case "effect:choose":
      // Keyed on the PROMPT, not just seat+turn: one program can park more than
      // once, and two parks inside one turn share `seatKey`. The remount between
      // them is what clears the picks today, but a program that parks twice on
      // the SAME prompt kind would keep a stale uid selected — `ready` would be
      // true, Confirm would light up, and the dispatch would be rejected. Now
      // impossible: any change to the offered candidates is a new key. (An attack
      // effect can park mid-turn since engine 0.22.0, which is exactly the
      // direction that makes multi-park programs likely.)
      return acting ? (
        <EffectChooseDialog key={`effect:${seatKey}:${promptKey(game.phase.prompt)}`} {...props} />
      ) : null;
    case "gameOver":
      return <GameOverOverlay {...props} />;
  }
}
