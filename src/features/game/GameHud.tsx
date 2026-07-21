// The phase-driven HUD layered over the playmat on /play. THE gating rule
// (D17): every control here checks `projection.waitingOn === "you"`, never
// turn ownership — during ko:promote the acting seat is the KO'd NON-turn
// player, and a HUD keyed on the turn soft-locks the game. The hot-seat
// viewer follows waitingOn (useLocalGame), so in practice these panels are
// always for the person holding the device; the gate stays anyway. GameHud
// enforces it ONCE, at its phase switch — the panels never re-check it.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Attack, BasicEnergyType, Card } from "@luminous/schema";
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
  attacksOf,
  cardOfUid,
  conditionHolds,
  conditionNote,
  costMet,
  effectiveAttackCost,
  effectiveRetreatCost,
  isImmobilized,
  otherSeat,
  programFor,
  providedEnergy,
  rareCandyOptions,
  topCardOf,
  topUid,
} from "@luminous/engine";
import { ENERGY_COLORS } from "../../lib/energyPalette";
import {
  GLASS_ACCENT_BUTTON,
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
  GLASS_NEUTRAL_BUTTON,
  GLASS_PANEL,
} from "../../lib/glass";
import { STATUS_LABELS } from "./logFromEvents";
import type { GameProjection } from "./projection";

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
/** Compact left-aligned row button — the Trainer/Ability lists and the effect
    picker share it (the same look as the attack rows). */
const ROW_BUTTON_ENABLED =
  "cursor-pointer bg-white/[0.06] text-white/90 ring-white/15 hover:bg-white/[0.1] active:scale-[0.98]";
const ROW_BUTTON_DISABLED = "cursor-default bg-white/[0.03] text-white/40 ring-white/8";
const ROW_BUTTON_BASE =
  "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ring-1 ring-inset transition-all";

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
  const inPlayStadium =
    game.stadium === null ? undefined : cardOfUid(game, game.stadium.uid)?.name;
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
    if (!isRareCandy && (isStadium ? program.stadium === undefined : program.trainer === undefined)) {
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
    const disabled =
      gateUnmet ||
      (isRareCandy
        ? !rareCandyPlayable()
        : isSupporter
          ? game.turn === 1 || game.allowances.supporterPlayed
          : isStadium && (game.allowances.stadiumPlayed || card.name === inPlayStadium));
    out.push({
      uid,
      name: card.name,
      disabled,
      rareCandy: isRareCandy,
      reason: gateUnmet && gated !== undefined ? `Only if ${conditionNote(gated)}` : undefined,
    });
  }
  return out;
}

/** An activated Ability on one of `seat`'s in-play Pokémon (passive abilities
    are always-on and show no button). `disabled` mirrors the §9 Active-only /
    once-per-turn gate. */
interface AbilityOption {
  target: PokemonTarget;
  abilityName: string;
  label: string;
  disabled: boolean;
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
      const disabled =
        (ability.activeOnly && target.spot !== "active") ||
        (ability.oncePerTurn && game.allowances.abilitiesUsed.includes(`${uid}:${ability.name}`));
      out.push({ target, abilityName: ability.name, label: `${ability.name} · ${card.name}`, disabled });
    }
  };
  consider(side.active, { spot: "active" });
  side.bench.forEach((pokemon, index) => consider(pokemon, { spot: "bench", index }));
  return out;
}

/** A choose-Pokémon candidate's display name, resolved off the live board. */
function refName(game: GameState, ref: PokemonRef): string {
  const side = game.players[ref.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (pokemon == null) return "a Pokémon";
  return topCardOf(game, pokemon)?.name ?? "a Pokémon";
}

/** §6.1 energy-symbol dot tints, from the shared app palette (one "Fire red"
    across builder + HUD). Keyed by the printed COST symbols: every basic
    energy — Fairy included, old prints still show it in costs — plus
    Colorless as the neutral cost. Typing the keys off the schema vocabulary
    makes a schema change a compile error here, not a silent fallback dot. */
type CostSymbol = BasicEnergyType | "Colorless";
const ENERGY_DOT_COLORS: Record<CostSymbol, string> = {
  Grass: ENERGY_COLORS.Grass,
  Fire: ENERGY_COLORS.Fire,
  Water: ENERGY_COLORS.Water,
  Lightning: ENERGY_COLORS.Lightning,
  Psychic: ENERGY_COLORS.Psychic,
  Fighting: ENERGY_COLORS.Fighting,
  Darkness: ENERGY_COLORS.Darkness,
  Metal: ENERGY_COLORS.Metal,
  Fairy: ENERGY_COLORS.Fairy,
  Colorless: ENERGY_COLORS.Colorless,
};

/** Cost symbols arrive as free strings (schema `attack.cost`); an unknown
    one (future symbol, bad data) falls back to the neutral Colorless tint. */
function dotColor(symbol: string): string {
  return Object.hasOwn(ENERGY_DOT_COLORS, symbol)
    ? ENERGY_DOT_COLORS[symbol as CostSymbol]
    : ENERGY_COLORS.Colorless;
}

function EnergyDots({ cost }: { cost: readonly string[] }) {
  if (cost.length === 0) {
    return <span className="text-[10px] uppercase tracking-wide text-white/40">free</span>;
  }
  return (
    <span className="flex items-center gap-1" aria-label={`cost: ${cost.join(", ")}`}>
      {cost.map((symbol, index) => (
        <span
          key={index}
          title={symbol}
          style={{ backgroundColor: dotColor(symbol) }}
          className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/30"
        />
      ))}
    </span>
  );
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

  // THE retreat derivation site — RetreatDialog receives these as props. The
  // cost is the CONTINUOUS one (§7.3 — Beach Court discounts Basics), the
  // same number the engine's retreat handler will check.
  const retreatCost = effectiveRetreatCost(game, active);
  const canRetreat =
    !immobilized &&
    !game.allowances.retreated &&
    side.bench.length > 0 &&
    active.energy.length >= retreatCost;

  // Trainer/Ability plays (§7/§9) — read off raw GameState like payability
  // above (the acknowledged P4 blocker); the engine still owns fine legality.
  const trainerOptions = playableTrainers(game, viewerSeat);
  const abilityOptions = usableAbilities(game, viewerSeat);

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
            // Payability under the Stadium's continuous cost effects (§7.3 —
            // League HQ's Basic surcharge), exactly as the engine checks it;
            // the dots still show the PRINTED cost.
            const payable = costMet(effectiveAttackCost(game, active, attack.cost ?? []), provided);
            const disabled = !payable || firstTurnBan || immobilized;
            return (
              <li key={`${attack.name}-${index}`}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => dispatch({ type: "attack", seat: viewerSeat, index })}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-all ${
                    disabled
                      ? "cursor-default bg-white/[0.03] text-white/40 ring-white/8"
                      : "cursor-pointer bg-white/[0.06] text-white/90 ring-white/15 hover:bg-white/[0.1] active:scale-[0.98]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{attack.name}</span>
                    <EnergyDots cost={attack.cost ?? []} />
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
                <li key={`${opt.abilityName}-${opt.target.spot === "bench" ? opt.target.index : "active"}`}>
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
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            className={`${NEUTRAL_BUTTON_CLASS} px-3 py-1.5 text-xs`}
            disabled={!canRetreat}
            onClick={() => setRetreatOpen(true)}
          >
            Retreat ({retreatCost})
          </button>
          <span className="text-right text-[10px] leading-tight text-white/40">
            {game.allowances.energyAttached ? "energy attached ✓" : "drag an energy to attach"}
            {game.allowances.retreated ? " · retreated ✓" : ""}
          </span>
        </div>
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
          <button type="button" onClick={() => setBasicUid(null)} className={GLASS_DIALOG_GHOST_BUTTON}>
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
                    className={`w-full cursor-pointer rounded-xl px-3 py-2 text-left text-sm ring-1 ring-inset transition-all ${
                      selected
                        ? "bg-white/[0.12] text-white ring-white/40"
                        : "bg-white/[0.04] text-white/70 ring-white/10 hover:bg-white/[0.08]"
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
                className={`flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm ring-1 ring-inset transition-all ${
                  selected
                    ? "bg-white/[0.12] text-white ring-white/40"
                    : "bg-white/[0.04] text-white/70 ring-white/10 hover:bg-white/[0.08]"
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
              className={`h-16 w-11 cursor-pointer rounded-md bg-gradient-to-br from-sky-800 to-indigo-950 ring-2 transition-all ${
                selected
                  ? "ring-white/80 shadow-[0_0_14px_rgba(255,255,255,0.35)]"
                  : "ring-white/15 hover:ring-white/40"
              }`}
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
                className="flex w-full cursor-pointer items-center justify-between rounded-xl bg-white/[0.06] px-3 py-2 text-left text-sm text-white/90 ring-1 ring-inset ring-white/15 transition-all hover:bg-white/[0.1] active:scale-[0.98]"
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
function EffectChooseDialog(props: GameHudProps) {
  const pending = props.projection.pendingDecision;
  // Narrowing only — the phase switch mounts this exactly at effect:choose.
  if (pending?.kind !== "effectChoose") return null;
  const prompt = pending.prompt;
  return prompt.kind === "chooseCards" ? (
    <ChooseCardsDialog {...props} prompt={prompt} />
  ) : prompt.kind === "choosePokemonMulti" ? (
    <ChoosePokemonMultiDialog {...props} prompt={prompt} />
  ) : prompt.kind === "moveEnergy" ? (
    <MoveEnergyDialog {...props} prompt={prompt} />
  ) : (
    <ChoosePokemonDialog {...props} prompt={prompt} />
  );
}

/** "Up to N" card pick: multi-select up to max, or take none — origin-agnostic
    (a deck search, §15.E, or a discard-pile retrieval, §7.1), both always
    declinable. The prompt's `note` says which; the candidate cards are public
    either way (deck picks are revealed, the discard pile is open). */
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
  return (
    <HudDialog label="Choose cards">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      <p className="mt-1.5 text-sm text-white/55">
        Pick up to {prompt.max} ({picked.length}/{prompt.max}).
      </p>
      <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {prompt.candidates.map((uid) => {
          const selected = picked.includes(uid);
          return (
            <li key={uid}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(uid)}
                className={`${ROW_BUTTON_BASE} ${
                  selected ? "bg-white/[0.12] text-white ring-white/40" : ROW_BUTTON_ENABLED
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
          className={ACCENT_BUTTON_CLASS}
          onClick={() =>
            dispatch({ type: "resolveEffect", seat: viewerSeat, choice: { kind: "cards", uids: picked } })
          }
        >
          {picked.length === 0 ? "Take none" : `Take ${picked.length}`}
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
          <li key={`${ref.seat}-${ref.spot.spot}-${ref.spot.spot === "bench" ? ref.spot.index : "a"}`}>
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "resolveEffect", seat: viewerSeat, choice: { kind: "pokemon", ref } })
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

/** "Up to N" snipe (§9): multi-select up to `max` opponent Pokémon, or take
    none. The twin of ChoosePokemonDialog (exactly one) — picking is not the
    whole decision here, so a confirm button dispatches every pick at once, the
    ChooseCardsDialog shape lifted to Pokémon refs. Mounted only while the
    decision is parked on the viewer, so useState resets per decision. */
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
  return (
    <HudDialog label="Choose Pokémon">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      <p className="mt-1.5 text-sm text-white/55">
        Pick up to {prompt.max} ({picked.length}/{prompt.max}).
      </p>
      <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {prompt.candidates.map((ref) => {
          const selected = pickedKeys.has(keyOf(ref));
          return (
            <li key={keyOf(ref)}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(ref)}
                className={`${ROW_BUTTON_BASE} ${
                  selected ? "bg-white/[0.12] text-white ring-white/40" : ROW_BUTTON_ENABLED
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
          className={ACCENT_BUTTON_CLASS}
          onClick={() =>
            dispatch({
              type: "resolveEffect",
              seat: viewerSeat,
              choice: { kind: "pokemonMulti", refs: picked },
            })
          }
        >
          {picked.length === 0 ? "Take none" : `Confirm ${picked.length}`}
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
    reset. */
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
  // Pre-select when only one Pokémon can be the source (skip straight to the
  // Energy + destination pick), otherwise the player chooses the source first.
  const [sourceKey, setSourceKey] = useState<string | null>(
    sources.length === 1 ? keyOf(sources[0] as PokemonRef) : null,
  );
  const [pickedUids, setPickedUids] = useState<string[]>([]);
  const [destKey, setDestKey] = useState<string | null>(null);

  const source = sources.find((ref) => keyOf(ref) === sourceKey) ?? null;
  const sourceEnergies =
    source === null ? [] : prompt.movable.filter(({ from }) => keyOf(from) === sourceKey);
  // Destinations are the offered ones minus the chosen source (no self-move).
  const dests = prompt.destinations.filter((ref) => keyOf(ref) !== sourceKey);
  const dest = dests.find((ref) => keyOf(ref) === destKey) ?? null;
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

  return (
    <HudDialog label="Move Energy">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {source === null ? (
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
          <p className="mt-1.5 text-sm text-white/55">
            From <span className="text-white/80">{refName(game, source)}</span> — pick up to{" "}
            {prompt.max} ({pickedUids.length}/{prompt.max}):
          </p>
          <ul className="mt-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
            {sourceEnergies.map(({ uid }) => {
              const selected = pickedUids.includes(uid);
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
                    <span className="truncate">{cardOfUid(game, uid)?.name ?? uid}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm text-white/55">Move to:</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {dests.map((ref) => {
              const selected = destKey === keyOf(ref);
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
          {source !== null && (
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

function GameOverOverlay({ projection, viewerSeat, names, onPlayAgain }: GameHudProps) {
  const outcome = projection.outcome;
  if (outcome === null) return null;
  const title =
    outcome.result === "win"
      ? `${outcome.winner === "you" ? names[viewerSeat] : names[otherSeat(viewerSeat)]} wins!`
      : "It's a tie";
  const detail =
    outcome.result === "win"
      ? outcome.reason === "prizesTaken"
        ? "All prize cards taken."
        : outcome.reason === "noPokemon"
          ? "The opponent has no Pokémon left in play."
          : "The opponent's deck ran out of cards."
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
      return acting ? <EffectChooseDialog key={`effect:${seatKey}`} {...props} /> : null;
    case "gameOver":
      return <GameOverOverlay {...props} />;
  }
}
