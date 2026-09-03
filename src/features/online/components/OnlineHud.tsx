import type { GameAction } from "@luminous/engine";
import { otherSeat } from "@luminous/engine";
import type {
  RedactedAbility,
  RedactedAttack,
  RedactedBoard,
  RedactedEffectPrompt,
  RedactedGame,
  RedactedInPlay,
  RedactedPokemonRef,
  RedactedRareCandyOption,
  RedactedRetreat,
  RedactedStadiumAbility,
  RedactedTrainer,
  MatchSeat,
} from "@luminous/schema";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { EnergyDots } from "../../game/EnergyDots";
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
} from "../../game/hudRows";
import {
  GLASS_ACCENT_BUTTON,
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
  GLASS_NEUTRAL_BUTTON,
  GLASS_PANEL,
} from "../../../lib/glass";
import type { PlayerId } from "../../playmat/types";

// The interactive HUD for an online match (P4). The online client holds only a
// redacted view (a `RedactedGame`), not the full engine state, so each panel is
// driven purely by what the server put on the wire — chooseFirst / the mulligan
// draw / the place → ready gate (2a), the turn:action attack list (payability
// computed server-side) plus the ko:takePrizes / ko:promote decisions (2b-i),
// and — from increment 2b-ii — the retreat button + dialog (cost + a `can` gate
// computed server-side; the energies to discard and the Bench to promote to ride
// the already-public board), plus — from 2b-iii-a — the effect:choose `mayDraw`
// dialog (Ortega's "your opponent may draw a card"), plus — from 2b-iii-b — the
// PUBLIC-REF effect prompts (choosePokemon / choosePokemonMulti / moveEnergy /
// discardEnergy), whose candidates are all in-play refs and attached-Energy uids
// already public on the redacted board, plus — from 2b-iii-c — the HIDDEN-
// CANDIDATE prompts (chooseCards / attachCards), whose candidates are the
// ANSWERER's own deck/top/hand cards: the server puts a full `RedactedCard` per
// candidate on the wire (the reveal), sent to that seat alone, so the dialog
// names them straight off the prompt rather than the board, plus — from D201 —
// `chooseAttack` (D157's kind), which had been on the wire WITHOUT a dialog here
// since it landed and soft-locked any online match that parked it. Every
// EffectPrompt kind now has an online dialog, and from D201 that sentence is
// enforced rather than asserted: `EffectChooseDialog`'s switch is annotated and
// floored with `never`, so a tenth kind fails the build. From increment 3b the turn:action panel also
// carries the acting viewer's activated Abilities + non-Stadium Trainers, each
// with a server-folded `disabled` flag + greyed-row `reason` (the same
// programPlayable / conditionHolds / handCostUnmet the local HUD reads off the
// full state, computed server-side and shipped as the result) — dispatching
// `useAbility` / `playTrainer`. Stadiums still play by the board drag. From
// increment 3b-ii the Trainer list also carries RARE CANDY, flagged: its row
// opens a two-step dialog (pick a Basic, then a Stage 2) over the phase's
// server-computed `rareCandy` pairings and answers with the `rareCandy` action.
// From D210 the panel also carries the §7.3 SHARED STADIUM's activated ability
// (`useStadiumAbility`) — the genuinely last deferred turn affordance, and the
// one that never appeared in either list because a Stadium is on neither board
// and in neither hand. The pass control lives in PlaymatView's TurnControls.
//
// Every panel is gated on `waitingOn === "you"` (the D17 rule the local HUD uses)
// so a prompt never appears on the wrong screen, and the actions carry the
// client's own seat (the DO rebinds it regardless). With every prompt kind
// dialoged, resolveEffect goes ONTO the DO allowlist (2b-iii-c); the surface stays
// test-only until real decks, since the fixed pure-basic decks can't park at
// effect:choose (D64).

const TOP_PANEL_CLASS = "left-1/2 top-16 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2";
const PANEL_CLASS = `pointer-events-auto absolute z-[75] rounded-2xl p-4 ${GLASS_PANEL} ${TOP_PANEL_CLASS}`;
const ACCENT_BUTTON = `cursor-pointer rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-40 ${GLASS_ACCENT_BUTTON}`;
const NEUTRAL_BUTTON = `cursor-pointer rounded-full px-4 py-2 text-sm font-medium ${GLASS_NEUTRAL_BUTTON}`;
// The compact left-aligned row buttons the effect-prompt dialogs share now come
// from `features/game/hudRows` — they were restated here byte for byte (D62/D63's
// restate-per-surface choice is about the WIRE SHAPE; a string of Tailwind
// classes has no wire shape to restate, so the restatement was a plain duplicate
// and it kept both HUDs outside D90's reduced-motion guard). See D214.

export function OnlineHud({
  game,
  waitingOn,
  activePlaced,
  onAction,
}: {
  game: RedactedGame;
  waitingOn: PlayerId | null;
  /** Whether the viewer has placed an Active — gates the setup Ready button. */
  activePlaced: boolean;
  onAction: (action: GameAction) => void;
}) {
  const seat = game.seat;
  const acting = waitingOn === "you";

  switch (game.phase.kind) {
    case "setup:chooseFirst":
      return acting ? (
        <Panel label="Coin flip" title="You won the flip — who goes first?">
          <div className="flex gap-2">
            <button
              type="button"
              className={ACCENT_BUTTON}
              onClick={() => onAction({ type: "chooseFirstPlayer", seat, first: seat })}
            >
              Go first
            </button>
            <button
              type="button"
              className={NEUTRAL_BUTTON}
              onClick={() => onAction({ type: "chooseFirstPlayer", seat, first: otherSeat(seat) })}
            >
              Go second
            </button>
          </div>
        </Panel>
      ) : null;

    case "setup:drawExtra":
      return acting ? (
        <DrawExtraPanel owed={game.phase.owed} seat={seat} onAction={onAction} />
      ) : null;

    case "setup:place":
      return acting ? (
        <Panel
          label="Setup"
          title={
            activePlaced
              ? "Drag more Basic Pokémon to your Bench, then Ready."
              : "Drag a Basic Pokémon from your hand to the Active spot."
          }
        >
          <button
            type="button"
            className={ACCENT_BUTTON}
            disabled={!activePlaced}
            onClick={() => onAction({ type: "setupReady", seat })}
          >
            Ready
          </button>
        </Panel>
      ) : null;

    case "turn:action":
      return acting ? (
        <AttackPanel
          active={game.board.you.active}
          bench={game.board.you.bench}
          attacks={game.phase.attacks}
          retreat={game.phase.retreat}
          abilities={game.phase.abilities}
          trainers={game.phase.trainers}
          rareCandy={game.phase.rareCandy}
          stadiumAbility={game.phase.stadiumAbility}
          firstTurn={game.turn === 1}
          seat={seat}
          onAction={onAction}
        />
      ) : null;

    case "ko:takePrizes":
      return acting ? (
        <TakePrizesDialog
          count={game.phase.count}
          prizesRemaining={game.board.you.prizesRemaining}
          seat={seat}
          onAction={onAction}
        />
      ) : null;

    case "ko:promote":
      return acting ? (
        <PromoteDialog bench={game.board.you.bench} seat={seat} onAction={onAction} />
      ) : null;

    case "effect:choose": {
      // The redacted prompt is non-null ONLY for the seat that must answer it
      // (the server withholds it from everyone else), and `acting` is that same
      // seat — so the two agree. The null case is now ONLY the non-answerer (every
      // prompt kind is dialoged); nothing shows for them.
      const prompt = game.phase.prompt;
      // Key on the prompt so a NEW park (a second effect:choose of the SAME kind —
      // e.g. Ultra Ball's hand cost then deck search, both chooseCards) REMOUNTS
      // the dialog and resets its local picks, instead of carrying stale ones into
      // an offer they aren't valid for (the local GameHud's promptKey rule; a
      // different-kind park already remounts via the child switch).
      return acting && prompt !== null ? (
        <EffectChooseDialog
          key={JSON.stringify(prompt)}
          prompt={prompt}
          board={game.board}
          seat={seat}
          onAction={onAction}
        />
      ) : null;
    }

    default:
      // gameOver renders no panel here (OnlineMatch's overlay handles it).
      return null;
  }
}

/** Routes a redacted `effect:choose` prompt to its dialog. The caller has already
    gated on `acting` + a non-null prompt, so this only picks the shape.

    AN EXHAUSTIVE SWITCH WITH A DECLARED RETURN TYPE AND A `never` FLOOR, and
    D201 wrote it that way because the previous shape had already cost a live
    match. This function had NO declared return type and NO floor, so an
    unmatched `kind` fell off the end as `undefined` and React rendered NOTHING —
    and the comment that used to sit here claimed the opposite ("a new wire arm is
    a compile error until its dialog lands"), which was never true. `chooseAttack`
    (D157) shipped its schema arm, its redactor arm, its projection arm and its
    LOCAL dialog, and no arm here: an online Medicham sv01-111 / Oranguru
    sv02-094 parked a prompt this client could not render, in a phase that
    swallows Escape and offers no decline. That is not a missing feature, it is a
    SOFT-LOCK — the match cannot proceed without an answer no rendered control can
    send. D186 found it and corrected the comment; this slice closes it.

    THE FLOOR IS THE DELIVERABLE, NOT THE ARM. Two nets, deliberately both:
    the annotated `ReactElement` return type makes a fall-through "not all code
    paths return a value" AT THIS FUNCTION, and the `never` assignment below names
    the offending kind in the error text. A tenth prompt kind added to
    `redactedEffectPromptSchema` is then a BUILD failure here — the same guard
    `redactPrompt` (engine) and `effectDecisionFromPrompt` (projection.ts) have
    always carried, finally on the surface that actually renders. The runtime
    `throw` is unreachable by construction for any snapshot this build's schema
    describes, and is reachable only under DEPLOY SKEW (channel.ts casts the
    frame rather than parsing it, so a newer DO could send a kind this bundle has
    never heard of). It throws rather than returning null because the app's
    top-level ErrorBoundary turns a throw into an error screen WITH A RELOAD,
    while a null is the silent freeze this whole comment is about. */
function EffectChooseDialog({
  prompt,
  board,
  seat,
  onAction,
}: {
  prompt: RedactedEffectPrompt;
  board: RedactedBoard;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}): ReactElement {
  switch (prompt.kind) {
    case "mayDraw":
      return <MayDrawDialog prompt={prompt} seat={seat} onAction={onAction} />;
    case "confirm":
      return <ConfirmPromptDialog prompt={prompt} seat={seat} onAction={onAction} />;
    case "choosePokemon":
      return <ChoosePokemonDialog prompt={prompt} board={board} seat={seat} onAction={onAction} />;
    case "choosePokemonMulti":
      return (
        <ChoosePokemonMultiDialog prompt={prompt} board={board} seat={seat} onAction={onAction} />
      );
    case "moveEnergy":
      // 🆕 D442 — TWO DIALOGS FOR ONE PROMPT KIND, split on the rider exactly as
      // the local HUD splits it. `anyDest` changes the SHAPE of the decision (one
      // destination for the answer versus one per pick), so the two hold different
      // state; the two HUDs must split the same way or the same prompt gets two
      // different interactions on the two screens (D412's third-read-site rule).
      return prompt.anyDest === true ? (
        <MoveEnergySpreadDialog prompt={prompt} board={board} seat={seat} onAction={onAction} />
      ) : (
        <MoveEnergyDialog prompt={prompt} board={board} seat={seat} onAction={onAction} />
      );
    case "discardEnergy":
      return <DiscardEnergyDialog prompt={prompt} board={board} seat={seat} onAction={onAction} />;
    case "chooseCards":
      return <ChooseCardsDialog prompt={prompt} seat={seat} onAction={onAction} />;
    case "attachCards":
      return <AttachCardsDialog prompt={prompt} board={board} seat={seat} onAction={onAction} />;
    case "chooseAttack":
      return <ChooseAttackDialog prompt={prompt} onAction={onAction} seat={seat} />;
    case "orderCards":
      return <OrderCardsDialog prompt={prompt} seat={seat} onAction={onAction} />;
  }
  // Every arm above returns, so `prompt` narrows to `never` here — until a kind
  // is added without one, when this assignment is the compile error.
  const unhandled: never = prompt;
  throw new Error(
    `OnlineHud: no dialog for effect prompt kind ${(unhandled as RedactedEffectPrompt).kind}`,
  );
}

/** The mid-effect "your opponent may draw a card" (§15 — Ortega), answered by
    the seat that did NOT play the card. Mirrors the local HUD's MayDrawDialog
    over the wire shape: the whole decision is the redacted prompt's `note` +
    `count`, so each button IS the answer (no local state, no Confirm) and
    dispatches `resolveEffect` on the tap. MANDATORY — a native <dialog> with no
    `onDismiss`, so Escape is swallowed (the program is parked on this answer).
    Unlike the local dialog it needs no seat name: online has no hot-seat
    ambiguity, this client IS the answerer. Draw sits FIRST in DOM order (where
    showModal lands focus) so an unprepared Enter doesn't silently forfeit the
    card; `flex-row-reverse` keeps Decline reading on the left, the siblings'
    layout. */
function MayDrawDialog({
  prompt,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "mayDraw" }>;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const answer = (draw: boolean) =>
    onAction({ type: "resolveEffect", seat, choice: { kind: "mayDraw", draw } });
  return (
    <Dialog label="You may draw">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/45">
        Your opponent's card is asking
      </p>
      <h2 className="mt-1 text-lg font-semibold text-white">{prompt.note}</h2>
      <div className="mt-5 flex justify-end gap-2">
        <div className="flex flex-row-reverse gap-2">
          <button type="button" className={ACCENT_BUTTON} onClick={() => answer(true)}>
            {prompt.count === 1 ? "Draw a card" : `Draw ${prompt.count} cards`}
          </button>
          <button type="button" className={NEUTRAL_BUTTON} onClick={() => answer(false)}>
            Decline
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** The printed "**You may** …" (the engine's `optional` op), answered by the
    CONTROLLER — the seat that played the card. Restates the local HUD's
    `ConfirmPromptDialog` over the wire shape (the D62/D63 restate-per-surface
    choice), which here is barely a restatement at all: the redacted arm carries
    only `note`, so both surfaces render the same sentence and the same two
    buttons off the same field. Each button IS the answer (no local state, no
    Confirm step). MANDATORY — no `onDismiss`, so Escape is swallowed: the program
    is parked on this answer and "no" is an answer that must be SAID. Yes sits
    FIRST in DOM order (where showModal lands focus) so an unprepared Enter does
    not forfeit the printed upside; `flex-row-reverse` keeps No reading on the
    left, the siblings' layout.

    ⚠️ Named `ConfirmPromptDialog`, not `ConfirmDialog`: this directory already
    exports a `ConfirmDialog` (the reusable leave/abandon modal used by
    `OnlineMatch` and `LobbyRoom`), and that one is a DISMISSABLE confirmation of
    a UI action. This is a parked ENGINE decision. Same word, opposite contract. */
function ConfirmPromptDialog({
  prompt,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "confirm" }>;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const answer = (yes: boolean) =>
    onAction({ type: "resolveEffect", seat, choice: { kind: "confirm", yes } });
  return (
    <Dialog label="You may">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      <div className="mt-5 flex justify-end gap-2">
        <div className="flex flex-row-reverse gap-2">
          <button type="button" className={ACCENT_BUTTON} onClick={() => answer(true)}>
            Yes
          </button>
          <button type="button" className={NEUTRAL_BUTTON} onClick={() => answer(false)}>
            No
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// --- Public-ref effect prompts (2b-iii-b) ------------------------------------
//
// choosePokemon / choosePokemonMulti / moveEnergy / discardEnergy. Their
// candidates are in-play `PokemonRef`s and attached-Energy uids ALREADY public
// on the redacted board, so these dialogs resolve display names off the board
// (the helpers below) instead of the full GameState the local GameHud reads.
// They restate the local dialogs over the wire shape (the D62/D63 restate-per-
// surface choice); the dispatched refs are the engine's own absolute-seat
// `PokemonRef`s, carried verbatim through resolveEffect.

/** Resolve a prompt's `PokemonRef` (absolute seat) to the in-play Pokémon on the
    redacted board. The wire is viewer-relative, so the ref's absolute seat maps
    to `you` when it equals the viewer's own seat, else `opponent`. */
function pokemonAt(
  board: RedactedBoard,
  viewerSeat: MatchSeat,
  ref: RedactedPokemonRef,
): RedactedInPlay | null {
  const side = ref.seat === viewerSeat ? board.you : board.opponent;
  return ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
}

/** A ref's display name off the board — the redacted equivalent of GameHud's
    `refName` over the full state. */
function refName(board: RedactedBoard, viewerSeat: MatchSeat, ref: RedactedPokemonRef): string {
  return pokemonAt(board, viewerSeat, ref)?.name ?? "a Pokémon";
}

/** An offered Energy's display name — found among its host's public attachments
    (the `from` ref locates the host, then the uid the Energy on it). */
function energyName(
  board: RedactedBoard,
  viewerSeat: MatchSeat,
  from: RedactedPokemonRef,
  uid: string,
): string {
  return (
    pokemonAt(board, viewerSeat, from)?.attached?.energies.find((e) => e.id === uid)?.name ?? uid
  );
}

/** A stable key for a ref — GameHud's dialog `keyOf`, over the wire shape. */
function refKey(ref: RedactedPokemonRef): string {
  return `${ref.seat}-${ref.spot.spot}-${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
}

/** The spot label a grouped/target row shows (GameHud's `spotOf`). */
function spotLabel(ref: RedactedPokemonRef): string {
  return ref.spot.spot === "active" ? "Active" : `Bench ${ref.spot.index + 1}`;
}

/** The quantities a `choosePokemon` row offers, in printed order — `GameHud`'s
    twin, and the same shape for the same reason: the two dialogs answer the SAME
    wire prompt, so an answer one of them can produce and the other cannot is a
    seat-dependent card. `[undefined]` on a mandatory prompt and on `upTo: 1`,
    which is what keeps every dialog written before D359 rendering the same DOM. */
function takeOptions(upTo: number | undefined): (number | undefined)[] {
  if (upTo === undefined || upTo <= 1) return [undefined];
  return Array.from({ length: upTo }, (_, i) => i + 1);
}

/** choosePokemon (§9 — switch / gust / heal): pick exactly one in-play Pokémon.
    Picking is the whole decision, so each row dispatches directly (the local
    ChoosePokemonDialog over the wire refs).

    🆕 D358 — **AND ON A PROMPT CARRYING A CEILING, `{ kind: "pokemon" }` WITH NO
    `ref` IS THE PRINTED *"up to N"* DECLINE**, offered as its own trailing row
    for the reason the local twin gives. The ceiling reaches this component
    because it is on the WIRE prompt: the op is server-side and the dialog can
    only read what was redacted to it, which is why the schema carries the field
    at all.

    🆕🆕 D359 — **AND ABOVE `upTo: 1`, THE QUANTITY RIDES THE SAME ROW**, so a
    body is offered once per legal answer. `upTo` is the PRINTED ceiling and never
    a count of what the controller holds, which is why the row labels can name it
    without the dialog knowing anything about the zone the Energy comes out of. */
function ChoosePokemonDialog({
  prompt,
  board,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "choosePokemon" }>;
  board: RedactedBoard;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  return (
    <Dialog label="Choose a Pokémon">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      <ul className="mt-3 flex flex-col gap-1.5">
        {prompt.candidates.flatMap((ref) =>
          takeOptions(prompt.upTo).map((take) => (
            <li key={`${refKey(ref)}-${take ?? "all"}`}>
              <button
                type="button"
                onClick={() =>
                  onAction({
                    type: "resolveEffect",
                    seat,
                    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
                  })
                }
                className={`${ROW_BUTTON_BASE} ${ROW_BUTTON_ENABLED}`}
              >
                <span className="truncate">
                  {refName(board, seat, ref)}
                  {take === undefined ? "" : ` — attach ${take}`}
                </span>
                {ref.seat !== seat && (
                  <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                    opponent
                  </span>
                )}
              </button>
            </li>
          )),
        )}
        {prompt.upTo !== undefined && (
          <li className="mt-1.5 border-t border-white/10 pt-1.5">
            <button
              type="button"
              onClick={() => onAction({ type: "resolveEffect", seat, choice: { kind: "pokemon" } })}
              className={`${ROW_BUTTON_BASE} ${ROW_BUTTON_ENABLED}`}
            >
              <span className="truncate">Take none</span>
            </button>
          </li>
        )}
      </ul>
    </Dialog>
  );
}

/** choosePokemonMulti (§9 — the multi-target snipe): pick `min`..`max` Pokémon,
    dispatched in one go. `declinable` adds the empty pick as a second legal
    answer WITHOUT the gap between it and `min` (Hawlucha's "you may choose 2" is
    2 or none), so Confirm reads "Take none" at zero and is disabled short — the
    local ChoosePokemonMultiDialog's doctrine, over the wire shape. */
function ChoosePokemonMultiDialog({
  prompt,
  board,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "choosePokemonMulti" }>;
  board: RedactedBoard;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const [picked, setPicked] = useState<RedactedPokemonRef[]>([]);
  const pickedKeys = new Set(picked.map(refKey));
  const toggle = (ref: RedactedPokemonRef) =>
    setPicked((prev) => {
      const key = refKey(ref);
      if (prev.some((r) => refKey(r) === key)) return prev.filter((r) => refKey(r) !== key);
      return prev.length < prompt.max ? [...prev, ref] : prev;
    });
  const exact = prompt.min === prompt.max;
  // The gap between "some, but not enough" and a legal answer — an empty pick is
  // legal only when the engine says so (min: 0 or declinable), never inferred.
  const short = picked.length < prompt.min && !(prompt.declinable && picked.length === 0);
  return (
    <Dialog label="Choose Pokémon">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {/* A live region — the running total is otherwise unannounceable
          (aria-pressed speaks only the focused row, Confirm leaves the tab order
          while disabled), and the transition that matters is short → satisfied. */}
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
          const selected = pickedKeys.has(refKey(ref));
          // At the cap a further click is refused, and the row says so (the one
          // thing the live region can't announce — clicking changes nothing).
          const refused = !selected && picked.length >= prompt.max;
          return (
            <li key={refKey(ref)}>
              <button
                type="button"
                aria-pressed={selected}
                aria-disabled={refused || undefined}
                onClick={() => toggle(ref)}
                className={`${ROW_BUTTON_BASE} ${
                  selected
                    ? ROW_BUTTON_SELECTED
                    : refused
                      ? ROW_BUTTON_DISABLED
                      : ROW_BUTTON_ENABLED
                }`}
              >
                <span className="truncate">{refName(board, seat, ref)}</span>
                {ref.seat !== seat && (
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
          className={ACCENT_BUTTON}
          onClick={() =>
            onAction({
              type: "resolveEffect",
              seat,
              choice: { kind: "pokemonMulti", refs: picked },
            })
          }
        >
          {picked.length === 0 && !short
            ? "Take none"
            : exact
              ? `Confirm ${picked.length}/${prompt.min}`
              : `Confirm ${picked.length}`}
        </button>
      </div>
    </Dialog>
  );
}

/** moveEnergy (§6 — Energy Switch / Poppy): move up to `max` Energy from ONE
    source Pokémon to ONE destination. A staged dialog (pick source, auto when
    only one; then Energy + a distinct destination; then Confirm — or Move none to
    decline), mirroring the local MoveEnergyDialog over the wire shape.

    ⚠️ `prompt.anySource` (D226 — N's Plan's printed "from your Benched Pokémon",
    plural) REMOVES THE SOURCE STAGE. That stage filters the Energy list down to
    one host, so keeping it would make the card's whole point — one Energy off
    each of two benched bodies — unreachable from this dialog while the server
    accepted it: the answer would exist and no client could build it. Both HUDs
    preview `moveEnergy` targets, so BOTH pay, which is why the rider was priced
    against its read sites rather than its field. */
function MoveEnergyDialog({
  prompt,
  board,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "moveEnergy" }>;
  board: RedactedBoard;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  // The distinct source Pokémon (those holding movable Energy), first-seen order.
  const sources: RedactedPokemonRef[] = [];
  const seenSource = new Set<string>();
  for (const { from } of prompt.movable) {
    const key = refKey(from);
    if (!seenSource.has(key)) {
      seenSource.add(key);
      sources.push(from);
    }
  }
  // D226 — the printed plural: no source stage, every offered Energy at once.
  const anySource = prompt.anySource === true;
  // Pre-select a sole source (skip straight to Energy + destination).
  const [sourceKey, setSourceKey] = useState<string | null>(
    sources.length === 1 ? refKey(sources[0] as RedactedPokemonRef) : null,
  );
  const [pickedUids, setPickedUids] = useState<string[]>([]);
  const [destKey, setDestKey] = useState<string | null>(null);

  // Under the rider there is no staged source at all — not even the auto-selected
  // one, since "which host" stops being a question once the answer may span hosts.
  const source = anySource ? null : (sources.find((ref) => refKey(ref) === sourceKey) ?? null);
  const offered =
    source === null
      ? anySource
        ? prompt.movable
        : []
      : prompt.movable.filter(({ from }) => refKey(from) === sourceKey);
  // Destinations are the offered ones minus the source(s) the picks sit on (no
  // self-move); a sole destination is pre-chosen (derived, since `dests` shifts
  // with the source or, under the rider, with the picks — the same per-pick rule
  // cardplay.ts enforces, mirrored so this dialog cannot assemble a refusal).
  const pickedHosts = new Set(
    prompt.movable.filter(({ uid }) => pickedUids.includes(uid)).map(({ from }) => refKey(from)),
  );
  const dests = prompt.destinations.filter((ref) =>
    anySource ? !pickedHosts.has(refKey(ref)) : refKey(ref) !== sourceKey,
  );
  const dest =
    dests.find((ref) => refKey(ref) === destKey) ??
    (dests.length === 1 ? (dests[0] as RedactedPokemonRef) : null);
  // 🆕🆕 D441 — THE PRINTED FLOOR. 0 (or absent) is this dialog's whole history
  // — every `moveEnergy` park before Castform could be answered with nothing. At
  // `min === max` the quantity stops being a decision: the ONLY legal answer takes
  // every offered Energy, so "Move none" must not be on screen and Confirm must not
  // enable until the pick is complete. Both fall out of this one number.
  const floor = prompt.min ?? 0;
  // ⚠️ WITHHELD RATHER THAN DISABLED — the local dialog's rule, and it has to be
  // the SAME rule: two HUDs answering one prompt differently is D412's
  // third-read-site defect waiting to happen.
  // 🆕 D442 — a BOOLEAN, where this pulled `prompt.destinations[0]` to fill the
  // decline frame's mandatory `dest`. The map answer's decline is `picks: []` and
  // names nobody.
  const canDecline = floor === 0;

  const reset = () => {
    setPickedUids([]);
    setDestKey(null);
  };
  const togglePick = (uid: string) =>
    setPickedUids((prev) =>
      prev.includes(uid)
        ? prev.filter((u) => u !== uid)
        : prev.length < prompt.max
          ? [...prev, uid]
          : prev,
    );
  // D441 — the local dialog's line verbatim; see it for why the 1 is a `Math.max`
  // rather than a replacement.
  const ready = pickedUids.length >= Math.max(1, floor) && dest !== null;
  // Past the source stage — answered, or (D226) never asked.
  const picking = anySource || source !== null;

  return (
    <Dialog label="Move Energy">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {!picking ? (
        <>
          <p className="mt-1.5 text-sm text-white/55">Choose which Pokémon to move Energy from.</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {sources.map((ref) => (
              <li key={refKey(ref)}>
                <button
                  type="button"
                  onClick={() => {
                    setSourceKey(refKey(ref));
                    reset();
                  }}
                  className={`${ROW_BUTTON_BASE} ${ROW_BUTTON_ENABLED}`}
                >
                  <span className="truncate">{refName(board, seat, ref)}</span>
                  {/* 🆕🆕 D443 — THE SIDE MARKER, the twin of the one the local HUD
                      grew in the same edit. `moveEnergy` now serves both boards and
                      this was the only public-ref dialog family without it; the
                      wire ref's `seat` is ABSOLUTE, which is what makes the test
                      meaningful on a viewer-relative board. */}
                  {ref.seat !== seat && (
                    <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                      opponent
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {/* A live region carrying the count AND the destination (which this
              dialog picks for the player when only one is legal). */}
          <output className="mt-1.5 block text-sm text-white/55">
            {/* D441 — "all" where the print says all; the local dialog's copy. */}
            {source === null ? (
              floor > 0 ? (
                "Pick all "
              ) : (
                "Pick up to "
              )
            ) : (
              <>
                From <span className="text-white/80">{refName(board, seat, source)}</span> —{" "}
                {floor > 0 ? "pick all " : "pick up to "}
              </>
            )}
            {prompt.max} ({pickedUids.length}/{prompt.max})
            {dest !== null && (
              <>
                , moving to <span className="text-white/80">{refName(board, seat, dest)}</span>
              </>
            )}
            :
          </output>
          <ul className="mt-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
            {offered.map(({ uid, from }) => {
              const selected = pickedUids.includes(uid);
              const name = energyName(board, seat, from, uid);
              return (
                <li key={uid}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => togglePick(uid)}
                    className={`${ROW_BUTTON_BASE} ${selected ? ROW_BUTTON_SELECTED : ROW_BUTTON_ENABLED}`}
                  >
                    {/* With no source stage the host is implied by nothing else on
                        screen, so each row names it (D226). */}
                    <span className="truncate">
                      {source === null ? `${name} — ${refName(board, seat, from)}` : name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm text-white/55">Move to:</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {dests.map((ref) => {
              const selected = dest !== null && refKey(dest) === refKey(ref);
              return (
                <li key={refKey(ref)}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDestKey(refKey(ref))}
                    className={`${ROW_BUTTON_BASE} ${selected ? ROW_BUTTON_SELECTED : ROW_BUTTON_ENABLED}`}
                  >
                    <span className="truncate">{refName(board, seat, ref)}</span>
                    {/* 🆕 D443 — the destination list's half of the same marker. */}
                    {ref.seat !== seat && (
                      <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                        opponent
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="mt-5 flex justify-between gap-2">
        {canDecline && (
          <button
            type="button"
            className={GLASS_DIALOG_GHOST_BUTTON}
            onClick={() =>
              onAction({
                type: "resolveEffect",
                seat,
                choice: { kind: "moveEnergy", picks: [] },
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
              className={ACCENT_BUTTON}
              disabled={!ready}
              onClick={() => {
                if (dest === null) return;
                onAction({
                  type: "resolveEffect",
                  seat,
                  // The coupled answer IS a map whose entries agree — one
                  // destination, spelled once per pick.
                  choice: {
                    kind: "moveEnergy",
                    picks: pickedUids.map((uid) => ({ uid, dest })),
                  },
                });
              }}
            >
              Move {pickedUids.length}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** 🆕🆕 **D442 — moveEnergy with the printed "in any way you like" (§6)**, over the
    wire shape. Each picked Energy names its OWN destination, so this is a two-step
    LOOP (pick an Energy, pick where it goes, repeat) rather than the wizard
    `MoveEnergyDialog` is — the `AttachCardsDialog` model one prompt over, and the
    local `MoveEnergySpreadDialog`'s twin. The two HUDs must split on this rider the
    same way and offer the same answers: a spread one client can build and the other
    cannot is a seat-dependent card (D226's pair, D412's third-read-site rule).

    Three printed sentences reach it and they differ on the OTHER axes: Kilowattrel's
    "Move all …" is MANDATORY (`min === max`) and single-source; the two "You may
    move any amount …" printings are declinable and multi-source. Both facts are read
    off the prompt, so this dialog carries no card knowledge. */
function MoveEnergySpreadDialog({
  prompt,
  board,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "moveEnergy" }>;
  board: RedactedBoard;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const [moves, setMoves] = useState<{ uid: string; dest: RedactedPokemonRef }[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const destOf = (uid: string) => moves.find((m) => m.uid === uid)?.dest;
  const hostOf = (uid: string) => prompt.movable.find((m) => m.uid === uid)?.from;
  const floor = prompt.min ?? 0;
  const atCap = moves.length >= prompt.max;
  /** Where the PENDING Energy may go: every offered destination except the body it
      sits on — the printed "other", per pick. */
  const destsFor = (uid: string) => {
    const host = hostOf(uid);
    return prompt.destinations.filter((ref) => host === undefined || refKey(ref) !== refKey(host));
  };
  /** 🆕🆕 **D443 — NO SIDE MARKER HERE, THE LOCAL SPREAD DIALOG'S REFUSAL VERBATIM.**
      This dialog renders only under `prompt.anyDest`, and no printed sentence carries
      `anyDest` and `side: "opponent"` at once, so a marker would be a line no board
      can reach. `derivedOpponentEnergyMove.test.ts` §1 sweeps the corpus for that
      pair; the day it goes red, copy the coupled twin's marker into both spread
      dialogs. */
  const destLabel = (ref: RedactedPokemonRef) => `${refName(board, seat, ref)} · ${spotLabel(ref)}`;

  const tapEnergy = (uid: string) => {
    if (destOf(uid) !== undefined) {
      setMoves((prev) => prev.filter((m) => m.uid !== uid));
      setPending((prev) => (prev === uid ? null : prev));
      return;
    }
    const only = destsFor(uid);
    if (only.length === 1) {
      if (!atCap) setMoves((prev) => [...prev, { uid, dest: only[0] as RedactedPokemonRef }]);
      return;
    }
    setPending((prev) => (prev === uid ? null : atCap ? prev : uid));
  };
  const assign = (dest: RedactedPokemonRef) => {
    if (pending === null) return;
    setMoves((prev) => [...prev, { uid: pending, dest }]);
    setPending(null);
  };
  const pendingHost = pending === null ? null : hostOf(pending);
  const pendingName =
    pending === null || pendingHost === undefined || pendingHost === null
      ? null
      : energyName(board, seat, pendingHost, pending);
  const ready = moves.length >= Math.max(1, floor);

  return (
    <Dialog label="Move Energy">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      <output className="mt-1.5 block text-sm text-white/55">
        {pendingName === null
          ? `${floor > 0 ? "Moving all" : "Moving"} ${moves.length}/${prompt.max}. ${
              atCap ? "Tap a placed Energy to move it." : "Pick an Energy, then where it goes."
            }`
          : `Moving ${moves.length}/${prompt.max}. Where does ${pendingName} go?`}
      </output>
      <ul className="mt-3 flex max-h-52 flex-col gap-1.5 overflow-y-auto">
        {prompt.movable.map(({ uid, from }) => {
          const dest = destOf(uid);
          const selected = pending === uid;
          const name = energyName(board, seat, from, uid);
          const refused = dest === undefined && !selected && atCap;
          return (
            <li key={uid}>
              <button
                type="button"
                aria-label={
                  dest === undefined
                    ? selected
                      ? `${name} on ${destLabel(from)} — choosing where it goes`
                      : `${name} on ${destLabel(from)}`
                    : `${name} on ${destLabel(from)} → ${destLabel(dest)}`
                }
                aria-pressed={dest !== undefined}
                aria-current={selected || undefined}
                aria-disabled={refused || undefined}
                onClick={() => tapEnergy(uid)}
                className={`${ROW_BUTTON_BASE} ${
                  dest !== undefined
                    ? ROW_BUTTON_SELECTED
                    : selected
                      ? ROW_BUTTON_ENABLED
                      : refused
                        ? ROW_BUTTON_DISABLED
                        : ROW_BUTTON_ENABLED
                }`}
              >
                <span className="truncate">{`${name} — ${refName(board, seat, from)}`}</span>
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
          <p className="mt-3 text-sm text-white/55">Move to:</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {destsFor(pending).map((ref) => (
              <li key={refKey(ref)}>
                <button
                  type="button"
                  aria-label={destLabel(ref)}
                  onClick={() => assign(ref)}
                  className={`${ROW_BUTTON_BASE} ${ROW_BUTTON_ENABLED}`}
                >
                  <span className="truncate">{refName(board, seat, ref)}</span>
                  <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                    {spotLabel(ref)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-5 flex justify-between gap-2">
        {/* 🆕 D442 — the gate is INLINE and not a named local, deliberately: its
            coupled twin above spells `const canDecline = floor === 0;` and a
            byte-identical second copy would make `D441-*-hud-keeps-the-decline`
            match twice (D437's converse of the copied-function trap). */}
        {floor === 0 && (
          <button
            type="button"
            className={GLASS_DIALOG_GHOST_BUTTON}
            onClick={() =>
              onAction({
                type: "resolveEffect",
                seat,
                choice: { kind: "moveEnergy", picks: [] },
              })
            }
          >
            Move none
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={ACCENT_BUTTON}
            disabled={!ready}
            onClick={() =>
              onAction({
                type: "resolveEffect",
                seat,
                // Filtered against the OFFER at dispatch time — the local twin's
                // rule and its reason (a stale uid renders no row, so it could not
                // be released, and every dispatch would be refused on a prompt that
                // never changes: a soft-lock turned into a lost pick).
                choice: {
                  kind: "moveEnergy",
                  picks: moves.filter((m) => prompt.movable.some((o) => o.uid === m.uid)),
                },
              })
            }
          >
            Move {moves.length}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** discardEnergy (§15 — Crushing Hammer / Giacomo, or a §8 self-discard cost):
    take Energy off the board, grouped by the Pokémon each sits on. MANDATORY (no
    decline). Two shapes off `scope`: "total" is a flat pick of exactly `count`;
    "each" asks for one per group. Mirrors the local DiscardEnergyDialog over the
    wire shape — every candidate is Energy public on the board. */
function DiscardEnergyDialog({
  prompt,
  board,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "discardEnergy" }>;
  board: RedactedBoard;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  // Hoisted so the pick handler's closure keeps the discriminant narrowed.
  const scope = prompt.scope;
  // Candidates grouped by host Pokémon, first-seen order (what "each" counts).
  const groups: { key: string; ref: RedactedPokemonRef; uids: string[] }[] = [];
  for (const { uid, from } of prompt.discardable) {
    const key = refKey(from);
    const group = groups.find((g) => g.key === key);
    if (group === undefined) groups.push({ key, ref: from, uids: [uid] });
    else group.uids.push(uid);
  }
  // "each" pre-answers every single-candidate group (not a question — the engine
  // would have auto-resolved the whole op if all were); "total" starts empty.
  const [picked, setPicked] = useState<string[]>(() =>
    scope.kind === "each"
      ? groups.flatMap((group) => (group.uids.length === 1 ? [group.uids[0] as string] : []))
      : [],
  );
  // "each": one pick per group — a pick REPLACES that group's previous one.
  // "total": a flat multi-select of `count`; at the cap a click is refused
  // (above 1), except at count 1 where a pick replaces the single one.
  const pick = (groupUids: readonly string[], uid: string) =>
    setPicked((prev) => {
      if (scope.kind === "each") {
        const others = prev.filter((u) => !groupUids.includes(u));
        return prev.includes(uid) ? others : [...others, uid];
      }
      if (prev.includes(uid)) return prev.filter((u) => u !== uid);
      if (prev.length < scope.count) return [...prev, uid];
      return scope.count === 1 ? [uid] : prev;
    });
  const required = scope.kind === "total" ? scope.count : groups.length;
  const ready = picked.length === required;

  return (
    <Dialog label="Discard Energy">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      <output className="mt-1.5 block text-sm text-white/55">
        {scope.kind === "each"
          ? `Pick one Energy from each Pokémon (${picked.length}/${required}).`
          : required > 1
            ? `Pick ${required} Energy to discard (${picked.length}/${required}).`
            : "Pick the Energy to discard."}
      </output>
      <div className="mt-3 flex max-h-64 flex-col gap-3 overflow-y-auto">
        {/* fieldset/legend so a screen reader says WHICH Pokémon the Energy comes
            off — the host + spot ride the legend (two Pokémon can share a name),
            plus the `opponent` marker (this dialog serves both boards). */}
        {groups.map((group) => (
          <fieldset key={group.key} className="min-w-0">
            <legend className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              {refName(board, seat, group.ref)} · {spotLabel(group.ref)}
              {group.ref.seat !== seat && " · opponent"}
            </legend>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {group.uids.map((uid) => {
                const selected = picked.includes(uid);
                const refused =
                  !selected &&
                  scope.kind === "total" &&
                  scope.count > 1 &&
                  picked.length >= scope.count;
                return (
                  <li key={uid}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-disabled={refused || undefined}
                      onClick={() => pick(group.uids, uid)}
                      className={`${ROW_BUTTON_BASE} ${
                        selected
                          ? ROW_BUTTON_SELECTED
                          : refused
                            ? ROW_BUTTON_DISABLED
                            : ROW_BUTTON_ENABLED
                      }`}
                    >
                      <span className="truncate">{energyName(board, seat, group.ref, uid)}</span>
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
          className={ACCENT_BUTTON}
          disabled={!ready}
          onClick={() =>
            onAction({
              type: "resolveEffect",
              seat,
              choice: { kind: "discardEnergy", uids: picked },
            })
          }
        >
          Discard {picked.length}/{required}
        </button>
      </div>
    </Dialog>
  );
}

// --- Hidden-candidate effect prompts (2b-iii-c) ------------------------------
//
// chooseCards / attachCards. Their candidates are the ANSWERER's own deck /
// looked-at-top / hand / discard cards — the deck ones HIDDEN until this effect
// reveals them — so unlike the public-ref family they DON'T resolve off the
// board: the server puts a full `RedactedCard` per candidate on the wire (sent
// to the answering seat alone), and the dialog names them straight off the
// prompt. The answer dispatches each pick's `id` (the engine uid). Restated from
// the local GameHud dialogs over the wire shape.
//
// 🛑 🆕🆕 **D426 CORRECTED "CONTROLLER" TO "ANSWERER" IN BOTH SENTENCES ABOVE, AND
// THE DIFFERENCE IS NOT COSMETIC.** They were the same seat for every
// hidden-candidate producer until `opponentDiscardsFromHand` (*"Your opponent
// discards 2 cards from their hand."*) parked a `chooseCards` on the
// NON-controller, over that seat's own hidden HAND. The server gate has always
// read `phase.answerer ?? phase.seat` (`redactedPromptOf`), so nothing here had
// to change — but a successor reading "sent to the controller alone" would have
// been reading a sentence that describes a live hidden-information leak, and
// might have "fixed" the gate to match it.

/** chooseCards (§15.E / §7.1 / §7.5) — pick min..max cards: a deck search, a
    discard retrieval, a look-at-top, or a §7.5 hand cost. `min > 0` is a
    MANDATORY exact cost (no decline, Confirm gated to the count); `min: 0` is the
    printed "up to" (Confirm always live). The candidate identities ride the wire
    (RedactedCard), so the rows name them directly. */
function ChooseCardsDialog({
  prompt,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "chooseCards" }>;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id)
        ? prev.filter((u) => u !== id)
        : prev.length < prompt.max
          ? [...prev, id]
          : prev,
    );
  const mandatory = prompt.min > 0;
  const short = picked.length < prompt.min;
  return (
    <Dialog label="Choose cards">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {/* A live region — the running total is otherwise unannounceable; the
          mandatory branch also states the pick cannot be declined (the absent
          "Take none" is not something a screen reader announces).
          🆕🆕 D426 — was "this cost must be paid", and `GameHud.tsx`'s twin of this
          block carries the whole argument: the sentence was written when the only
          mandatory producer was a printed COST and was already false for two
          shipped ops before this slice added a third. Changed in the SAME edit as
          the local panel, D412's rule. */}
      <output className="mt-1.5 block text-sm text-white/55">
        {mandatory
          ? `Pick ${prompt.min} (${picked.length}/${prompt.max}). ${
              short ? `Pick ${prompt.min - picked.length} more — this pick can't be declined.` : "Ready."
            }`
          : `Pick up to ${prompt.max} (${picked.length}/${prompt.max}).`}
      </output>
      <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {prompt.candidates.map((card) => {
          const selected = picked.includes(card.id);
          const refused = !selected && picked.length >= prompt.max;
          return (
            <li key={card.id}>
              <button
                type="button"
                aria-pressed={selected}
                aria-disabled={refused || undefined}
                onClick={() => toggle(card.id)}
                className={`${ROW_BUTTON_BASE} ${
                  selected
                    ? ROW_BUTTON_SELECTED
                    : refused
                      ? ROW_BUTTON_DISABLED
                      : ROW_BUTTON_ENABLED
                }`}
              >
                <span className="truncate">{card.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          disabled={short}
          className={ACCENT_BUTTON}
          onClick={() =>
            onAction({ type: "resolveEffect", seat, choice: { kind: "cards", uids: picked } })
          }
        >
          {/* The verb follows the ENGINE's `dest` — a cost is Discarded / Put
              under deck; an "up to" retrieval into the deck is a Shuffle. */}
          {mandatory
            ? `${prompt.dest === "deckBottom" ? "Put under deck" : "Discard"} ${picked.length}/${prompt.min}`
            : `${prompt.dest === "deck" ? "Shuffle" : "Take"} ${picked.length === 0 ? "none" : picked.length}`}
        </button>
      </div>
    </Dialog>
  );
}

/** 🆕 orderCards (D341) — put the looked-at cards back IN ANY ORDER (Iron Valiant
    "Calculation"; Dottler / Gothorita, which order the OPPONENT's deck). Restated
    from the local `OrderCardsDialog` over the wire shape, whose candidates carry
    their own `name` so nothing has to be resolved off the board.

    CLICK-TO-PLACE, front to back: each click appends the card to the new deck top,
    the row shows the ordinal it took, and `Undo last` pops the tail (un-picking
    from the middle would renumber rows a screen reader never re-announces).

    MANDATORY, and here that is a permutation rather than a floor: Confirm is
    disabled until every offered card has a position, because the engine's
    `validateChoice` refuses anything shorter. No `onDismiss` — the printed
    sentence carries no "you may", so Escape is swallowed like every other
    parked-program dialog here; leaving the deck as it was is the IDENTITY
    ordering, reached by clicking top to bottom. */
function OrderCardsDialog({
  prompt,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "orderCards" }>;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const place = (id: string) => {
    setOrder((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };
  const total = prompt.candidates.length;
  const short = order.length < total;
  return (
    <Dialog label="Put the cards back in order">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {/* A live region — the running position is otherwise unannounceable, and it
          states which END of the deck is being built ("1st" is meaningless
          without it). */}
      <output className="mt-1.5 block text-sm text-white/55">
        {short
          ? `Click cards in order, starting with the new top card (${order.length}/${total}). ${
              order.length === 0 ? "Nothing placed yet." : `Next is #${order.length + 1}.`
            }`
          : `All ${total} placed — #1 is the new top card.`}
      </output>
      <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {prompt.candidates.map((card) => {
          // Rendered in the deck order they ARRIVED in and never re-sorted into
          // the pick order: a list that reshuffled under the cursor would move the
          // row the player is aiming at.
          const at = order.indexOf(card.id);
          const placed = at >= 0;
          return (
            <li key={card.id}>
              <button
                type="button"
                aria-pressed={placed}
                onClick={() => {
                  place(card.id);
                }}
                className={`${ROW_BUTTON_BASE} ${placed ? ROW_BUTTON_SELECTED : ROW_BUTTON_ENABLED}`}
              >
                {/* The ordinal is inside the accessible NAME: it is the whole of
                    what the click did, and `aria-pressed` alone would say only
                    "selected" for a row whose meaning is WHICH position it took. */}
                <span className="truncate">
                  {placed ? `#${at + 1} — ` : ""}
                  {card.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-between gap-2">
        <button
          type="button"
          disabled={order.length === 0}
          className={ROW_BUTTON_BASE}
          onClick={() => {
            setOrder((prev) => prev.slice(0, -1));
          }}
        >
          Undo last
        </button>
        <button
          type="button"
          disabled={short}
          className={ACCENT_BUTTON}
          onClick={() => {
            onAction({ type: "resolveEffect", seat, choice: { kind: "orderCards", uids: order } });
          }}
        >
          {`Put back ${order.length}/${total}`}
        </button>
      </div>
      {/* 🆕 D344 — THE PRINTED SECOND ARM (Deduction Kit `sv08-171`: *"…, or
          shuffle them and put them on the bottom of your deck"*), rendered only
          when the prompt carries one. Its answer is the EMPTY ordering, which
          `validateChoice` admits exactly when `alt` is present — so this button
          dispatches `uids: []` and is never disabled by the gathered picks: the
          alternative is a whole printed arm, not a shortcut through this one, and
          a player half-way through an order must still be able to take it.

          BELOW the row of controls rather than beside them, and full width: it is
          neither "undo" nor "confirm what you gathered" but the OTHER thing the
          card does, and putting it in that row would read as a third step of the
          same action. */}
      {prompt.alt === undefined ? null : (
        <button
          type="button"
          className={`${NEUTRAL_BUTTON} mt-2 w-full`}
          onClick={() => {
            onAction({ type: "resolveEffect", seat, choice: { kind: "orderCards", uids: [] } });
          }}
        >
          {prompt.alt}
        </button>
      )}
    </Dialog>
  );
}

/** attachCards (§15.E + §6) — attach revealed deck/top cards onto your own
    Pokémon, "in any way you like" (Electric Generator / Charizard ex / Janine).
    The answer is a MAP (each card names its own destination), so it is a two-step
    loop: tap a card, tap where it goes — with a sole target auto-committing and a
    per-target cap (`maxPerTarget`). Candidate identities ride the wire; the
    targets resolve off the board. Restated from the local AttachCardsDialog. */
function AttachCardsDialog({
  prompt,
  board,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "attachCards" }>;
  board: RedactedBoard;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const [assignments, setAssignments] = useState<{ uid: string; to: RedactedPokemonRef }[]>([]);
  /** The card waiting for a destination — the only reason the target list shows. */
  const [pending, setPending] = useState<string | null>(null);
  const destOf = (uid: string) => assignments.find((a) => a.uid === uid)?.to;
  const cardName = (uid: string) => prompt.candidates.find((c) => c.id === uid)?.name ?? uid;
  const assignedTo = (ref: RedactedPokemonRef) =>
    assignments.filter((a) => refKey(a.to) === refKey(ref)).length;
  // 🆕 D457 — the printed "1 of your Pokémon": with one card placed, every other
  // body is full. GameHud.tsx carries the same predicate for the same reason.
  const targetFull = (ref: RedactedPokemonRef) =>
    (prompt.maxPerTarget !== undefined && assignedTo(ref) >= prompt.maxPerTarget) ||
    (prompt.oneTarget === true && assignments.length > 0 && assignedTo(ref) === 0);
  // The two rules close a row for OPPOSITE reasons — "already has its share" vs
  // "the Energy are going elsewhere" — and a body holding NOTHING must not be
  // told it already has one. GameHud.tsx carries the argument.
  const fullReason = (ref: RedactedPokemonRef) =>
    prompt.oneTarget === true && assignedTo(ref) === 0
      ? "they all go on 1 Pokémon"
      : "already has one";
  // No Pokémon can take another card — reachable only under a per-target cap.
  const noRoom = prompt.targets.length > 0 && prompt.targets.every(targetFull);
  const atCap = assignments.length >= prompt.max || noRoom;
  // The offer's only Pokémon, when it has one — the tap commits outright.
  const soleTarget = prompt.targets.length === 1 ? (prompt.targets[0] ?? null) : null;
  const destLabel = (ref: RedactedPokemonRef) => `${refName(board, seat, ref)} · ${spotLabel(ref)}`;

  const tapCard = (uid: string) => {
    if (destOf(uid) !== undefined) {
      // Releasing an assignment leaves any other card's pending pick alone.
      setAssignments((prev) => prev.filter((a) => a.uid !== uid));
      setPending((prev) => (prev === uid ? null : prev));
      return;
    }
    if (soleTarget !== null) {
      if (!atCap) setAssignments((prev) => [...prev, { uid, to: soleTarget }]);
      return;
    }
    setPending((prev) => (prev === uid ? null : atCap ? prev : uid));
  };
  const assign = (to: RedactedPokemonRef) => {
    if (pending === null || targetFull(to)) return;
    setAssignments((prev) => [...prev, { uid: pending, to }]);
    setPending(null);
  };
  const pendingName = pending === null ? null : cardName(pending);

  return (
    <Dialog label="Attach cards">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      {/* A live region carrying the count AND which card is waiting for a target
          (the target list appearing below is a silent change on its own). */}
      <output className="mt-1.5 block text-sm text-white/55">
        {pendingName === null
          ? `Attaching ${assignments.length}/${prompt.max}. ${
              noRoom
                ? soleTarget !== null
                  ? `${refName(board, seat, soleTarget)} already has one — tap the attached card to take it back.`
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
        {prompt.candidates.map((card) => {
          const dest = destOf(card.id);
          const selected = pending === card.id;
          const refused = dest === undefined && !selected && atCap;
          return (
            <li key={card.id}>
              <button
                type="button"
                // State rides the row's NAME (separate spans would be announced
                // as one run-on word by the accessible-name algorithm).
                aria-label={
                  dest === undefined
                    ? selected
                      ? `${card.name} — choosing where it goes`
                      : card.name
                    : `${card.name} → ${destLabel(dest)}`
                }
                aria-pressed={dest !== undefined}
                aria-current={selected || undefined}
                aria-disabled={refused || undefined}
                onClick={() => tapCard(card.id)}
                className={`${ROW_BUTTON_BASE} ${
                  dest !== undefined
                    ? ROW_BUTTON_SELECTED
                    : selected
                      ? "bg-white/[0.06] text-white ring-accent/70"
                      : refused
                        ? ROW_BUTTON_DISABLED
                        : ROW_BUTTON_ENABLED
                }`}
              >
                <span className="truncate">{card.name}</span>
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
            {prompt.targets.map((ref) => {
              const full = targetFull(ref);
              return (
                <li key={refKey(ref)}>
                  <button
                    type="button"
                    aria-label={full ? `${destLabel(ref)} — ${fullReason(ref)}` : destLabel(ref)}
                    aria-disabled={full || undefined}
                    onClick={() => assign(ref)}
                    className={`${ROW_BUTTON_BASE} ${full ? ROW_BUTTON_DISABLED : ROW_BUTTON_ENABLED}`}
                  >
                    <span className="truncate">{refName(board, seat, ref)}</span>
                    <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                      {full ? `${spotLabel(ref)} · has one` : spotLabel(ref)}
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
          className={ACCENT_BUTTON}
          onClick={() =>
            onAction({
              type: "resolveEffect",
              seat,
              choice: {
                kind: "attachCards",
                // Filtered against the offer — a stale uid (offer changed) would
                // otherwise make a mandatory-less dialog dispatch a rejected pick.
                assignments: assignments.filter((a) =>
                  prompt.candidates.some((c) => c.id === a.uid),
                ),
              },
            })
          }
        >
          {assignments.length === 0 ? "Attach none" : `Attach ${assignments.length}`}
        </button>
      </div>
    </Dialog>
  );
}

// --- The chosen-attack prompt (D157's kind, dialoged online at D201) ----------
//
// chooseAttack sits in NEITHER family above, which is exactly why it was the one
// left without a dialog here. By hidden information it is PUBLIC-REF — the
// candidates are the printed attacks of a face-up opposing Active, readable off
// the table by both players, so the answerer gate is a convenience and not a
// barrier. By MECHANICS it is hidden-candidate: the wire carries a server-
// resolved `name` per candidate, because an attack INDEX resolves against
// nothing the client holds (`RedactedCard` has no attack rows and
// `RedactedAttack[]` is published for the viewer's OWN Active only). So this
// dialog reads its labels STRAIGHT OFF THE PROMPT like ChooseCardsDialog, and
// takes no `board` at all — the one effect dialog here that needs none.

/** chooseAttack (D157 — Medicham sv01-111 "Acu-Punch-Ture", Oranguru sv02-094
    "Plotter's Command"): pick exactly ONE of the opposing Active's printed
    attacks, barred for that Pokémon's next turn. ChoosePokemonDialog's shape over
    a candidate that is not a Pokémon — each row dispatches on the tap, with no
    local state and no Confirm, because picking IS the whole decision (the "a list
    of one is not a decision" rule at its other limit: the engine resolves a
    no-attack and a one-attack defender inline and never parks below two).

    MANDATORY — the printed sentence is "Choose 1" with no "you may", so there is
    no decline row and no `onDismiss`: Escape is swallowed, like every parked
    answer here. Restates the local `ChooseAttackDialog` (GameHud) over the wire
    shape, and the restatement is unusually thin — both surfaces render the same
    `note` and the same server-resolved `name`s, for the reason the section
    comment gives. Unlike its local twin it needs no seat name: online has no
    hot-seat ambiguity, this client IS the answerer (the controller). */
function ChooseAttackDialog({
  prompt,
  seat,
  onAction,
}: {
  prompt: Extract<RedactedEffectPrompt, { kind: "chooseAttack" }>;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  return (
    <Dialog label="Choose an attack">
      <h2 className="text-lg font-semibold text-white">{prompt.note}</h2>
      <ul className="mt-3 flex flex-col gap-1.5">
        {prompt.candidates.map((attack) => (
          // Keyed by the INDEX, which is the answer's whole content and the
          // engine's own addressing for an attack — two printings could in
          // principle share a name, and the index cannot collide.
          <li key={attack.index}>
            <button
              type="button"
              onClick={() =>
                onAction({
                  type: "resolveEffect",
                  seat,
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
    </Dialog>
  );
}

/** The turn:action panel: the viewer's Active, a button per printed attack
    (disabled off the server-computed `playable` flag — §8.2 payability + the §4
    ban + §12 immobilize, all folded server-side, so the client adds no rule
    logic), the activated Abilities + hand Trainers (increment 3b — each
    disabled off a server-folded `disabled` flag with the greyed row's `reason`
    tooltip, dispatching `useAbility` / `playTrainer`), and the retreat entry point
    (disabled off the server-computed `retreat.can`, opening the RetreatDialog).
    Bottom-right, clear of the pass control, mirroring the local TurnPanel.
    🆕 **STADIUM ROWS APPEAR HERE FROM D288, AND NEEDED NO CODE BELOW.** A Stadium
    dispatches the same `playTrainer` action every other non-Rare-Candy row does
    (`playTrainer` routes it to `playStadium`), so the widening was entirely
    server-side and this panel's whole diff is this sentence. They are ALSO
    draggable onto the shared slot, exactly as on the local page — the button and
    the drag have never been alternatives there, which is what made the old
    *"they play by the board DRAG, so they never appear in `trainers`"* a
    description of this projection rather than a reason for it.
    RARE CANDY does (3b-ii), flagged — its row opens the RareCandyDialog over the
    phase's `rareCandy` pairings instead of dispatching `playTrainer`.

    From D210 it also carries the §7.3 STADIUM section: the shared Stadium's
    "once during each player's turn" activated ability, one nullable row
    dispatching the seat-bound `useStadiumAbility` action. (Named in BACKTICKS
    and never as a quoted string literal, here or anywhere else in this file's
    prose: `OnlineHud.stadiumAbility.test.ts` proves a control exists by scanning
    this directory's sources for the double-quoted action type, so a comment
    spelling it that way would satisfy the scan with NO control at all. That is
    not hypothetical — the first draft of this comment did exactly that, and the
    biconditional stayed green through a deletion of the button below.) Its own
    section because the
    Stadium is on NEITHER board and in NEITHER hand, so `abilities` (which walks
    the actor's own Active + Bench) and `trainers` (which walks the actor's own
    hand) both structurally exclude it — the reason this affordance had no online
    surface at all from D102 until D210 while Levincia / Spikemuth Gym were
    reaching real matches. */
function AttackPanel({
  active,
  bench,
  attacks,
  retreat,
  abilities,
  trainers,
  rareCandy,
  stadiumAbility,
  firstTurn,
  seat,
  onAction,
}: {
  active: RedactedInPlay | null;
  bench: readonly RedactedInPlay[];
  attacks: readonly RedactedAttack[];
  retreat: RedactedRetreat | null;
  abilities: readonly RedactedAbility[];
  trainers: readonly RedactedTrainer[];
  /** The legal §7.1 pairings the Rare Candy row's dialog offers (server-computed;
      empty exactly when that row is disabled). */
  rareCandy: readonly RedactedRareCandyOption[];
  /** §7.3 — the shared Stadium's "once during each player's turn" activated
      ability (D210), server-folded; null when there is no row to render (no
      Stadium in play, or a continuous-only one like Beach Court). */
  stadiumAbility: RedactedStadiumAbility | null;
  firstTurn: boolean;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const [retreatOpen, setRetreatOpen] = useState(false);
  // The Rare Candy Item uid whose dialog is open (null = closed) — the local
  // HUD's `rareCandyUid` over the wire shape.
  const [rareCandyUid, setRareCandyUid] = useState<string | null>(null);
  // No Active means nothing to attack with (defensive — a turn:action always
  // has one); render nothing rather than an empty panel.
  if (active === null) return null;
  const battle = active.battle;
  return (
    <>
      <section
        aria-label="Turn actions"
        className={`pointer-events-auto absolute bottom-[calc(var(--hand-h)+16px)] right-4 z-[75] w-72 rounded-2xl p-4 ${GLASS_PANEL}`}
      >
        <div className="flex items-baseline justify-between">
          <span className="truncate text-sm font-semibold text-white">{active.name}</span>
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
          {attacks.map((attack) => (
            <li key={attack.index}>
              <button
                type="button"
                disabled={!attack.playable}
                onClick={() => onAction({ type: "attack", seat, index: attack.index })}
                className={`${ATTACK_ROW_BASE} ${
                  attack.playable ? ROW_BUTTON_ENABLED : ROW_BUTTON_DISABLED
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{attack.name}</span>
                  {/* The EFFECTIVE cost when the wire carries one (a Stadium
                      surcharge, an opposing cost aura, or the holder's own
                      discount is in play), else the printed cost — the local HUD
                      renders `effectiveAttackCost` here and this is the same
                      number, server-computed. `playable` beside it is derived from
                      exactly this array, which is the divergence the sibling field
                      closes. */}
                  <EnergyDots cost={attack.effectiveCost ?? attack.cost} />
                </span>
                {attack.damage !== null && (
                  <span className="shrink-0 text-sm font-bold tabular-nums">{attack.damage}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {firstTurn && (
          <p className="mt-2 text-[11px] text-white/45">No attacking on the first turn (§4).</p>
        )}
        {abilities.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Abilities
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {abilities.map((opt) => (
                // `title` on the LI (a disabled button is out of the tab order)
                // with an sr-only twin, since the §7.5 cost can grey this row too —
                // the local GameHud's doctrine, over the wire shape.
                <li
                  key={`${opt.abilityName}-${opt.target.spot === "bench" ? opt.target.index : "active"}`}
                  title={opt.reason ?? undefined}
                >
                  <button
                    type="button"
                    disabled={opt.disabled}
                    onClick={() =>
                      onAction({
                        type: "useAbility",
                        seat,
                        target: opt.target,
                        abilityName: opt.abilityName,
                      })
                    }
                    className={`${ROW_BUTTON_BASE} ${opt.disabled ? ROW_BUTTON_DISABLED : ROW_BUTTON_ENABLED}`}
                  >
                    <span className="truncate">{opt.label}</span>
                  </button>
                  {opt.reason !== null && <span className="sr-only">{opt.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {trainers.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Trainers
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {trainers.map((opt) => (
                <li key={opt.uid} title={opt.reason ?? undefined}>
                  <button
                    type="button"
                    disabled={opt.disabled}
                    // Rare Candy is the one row that opens a dialog rather than
                    // playing on click — it needs a Basic AND a Stage 2 (§7.1),
                    // a pair no single dispatch can carry.
                    onClick={() =>
                      opt.rareCandy
                        ? setRareCandyUid(opt.uid)
                        : onAction({ type: "playTrainer", seat, uid: opt.uid })
                    }
                    className={`${ROW_BUTTON_BASE} ${opt.disabled ? ROW_BUTTON_DISABLED : ROW_BUTTON_ENABLED}`}
                  >
                    <span className="truncate">{opt.name}</span>
                  </button>
                  {opt.reason !== null && <span className="sr-only">{opt.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* §7.3 — the SHARED Stadium's "once during each player's turn" activated
            ability (D210). Its own section, not a row in `Abilities` or
            `Trainers`: the Stadium belongs to NEITHER player's board (it may well
            be the opponent's card — either player activates it on their own turn)
            and it is not in the actor's hand, so neither list can name it. The
            dispatch carries the seat and NOTHING else — there is exactly one
            Stadium and the action takes no target — which is precisely why it
            could not ride `useAbility`'s target-shaped row. `disabled`/`reason`
            are server-folded (`allowances.stadiumAbilityUsed` + `programPlayable`,
            state this client never sees), greyed and tooltipped exactly as the
            Ability rows above. */}
        {stadiumAbility !== null && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Stadium
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {/* `title` on the LI, sr-only twin beside it — a disabled button is
                  out of the tab order, the Ability rows' doctrine. */}
              <li title={stadiumAbility.reason ?? undefined}>
                <button
                  type="button"
                  disabled={stadiumAbility.disabled}
                  onClick={() => onAction({ type: "useStadiumAbility", seat })}
                  className={`${ROW_BUTTON_BASE} ${stadiumAbility.disabled ? ROW_BUTTON_DISABLED : ROW_BUTTON_ENABLED}`}
                >
                  <span className="truncate">{stadiumAbility.label}</span>
                </button>
                {stadiumAbility.reason !== null && (
                  <span className="sr-only">{stadiumAbility.reason}</span>
                )}
              </li>
            </ul>
          </div>
        )}
        {/* Retreat + Pass share the footer. Pass lives HERE, not only on the
            playmat's ⟶ control, because this panel (z-[75], bottom-right) COVERS
            that control (z-20, right-edge centred) at every ordinary viewport
            height — a click there lands on an attack row instead. This panel
            renders exactly when `waitingOn === "you" && turn:action`, which is
            exactly OnlineMatch's `passDisabled === false`, so the button needs no
            disabled state: if it is on screen, passing is legal. */}
        <div className="mt-3 flex items-center justify-end gap-2">
          {retreat !== null && (
            <button
              type="button"
              disabled={!retreat.can}
              onClick={() => setRetreatOpen(true)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium disabled:cursor-default disabled:opacity-40 ${GLASS_NEUTRAL_BUTTON}`}
            >
              Retreat ({retreat.cost})
            </button>
          )}
          <button
            type="button"
            onClick={() => onAction({ type: "endTurn", seat })}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${GLASS_ACCENT_BUTTON}`}
          >
            {/* "Pass", not "Pass turn" — the name was chosen while the playmat's
                ⟶ still owned that label, and kept since (see the GameHud twin);
                P5-4 removed that control from this surface, where it was only
                ever enabled underneath this panel. */}
            Pass
          </button>
        </div>
      </section>
      {retreatOpen && retreat !== null && (
        <RetreatDialog
          active={active}
          bench={bench}
          cost={retreat.cost}
          seat={seat}
          onAction={onAction}
          onClose={() => setRetreatOpen(false)}
        />
      )}
      {rareCandyUid !== null && (
        <RareCandyDialog
          options={rareCandy}
          rareCandyUid={rareCandyUid}
          seat={seat}
          onAction={onAction}
          onClose={() => setRareCandyUid(null)}
        />
      )}
    </>
  );
}

/** §7.1 Rare Candy — evolve a Basic straight to a Stage 2, skipping the Stage 1
    (increment 3b-ii). Mirrors the local HUD's RareCandyDialog over the wire shape:
    a two-pick decision the engine can't express as an effect:choose prompt (it
    needs a Basic in play AND a Stage 2 in hand), so it is its own dialog fed by
    the server-computed `rareCandy` pairings — the engine's `rareCandyOptions`,
    folded server-side, so a listed pair is always legal and the client adds no
    rule logic. Native <dialog>, dismissable — Rare Candy is an optional play.
    Mounted only while open, so the useState initializer is the fresh-picks-per-
    open reset. */
function RareCandyDialog({
  options,
  rareCandyUid,
  seat,
  onAction,
  onClose,
}: {
  options: readonly RedactedRareCandyOption[];
  /** The Rare Candy Item uid being played (the clicked Trainer row's). */
  rareCandyUid: string;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
  onClose: () => void;
}) {
  // Pre-select when there is only one Basic to evolve (skip straight to the
  // Stage 2 pick); otherwise the player chooses the Basic first.
  const [basicUid, setBasicUid] = useState<string | null>(
    options.length === 1 ? (options[0]?.basicUid ?? null) : null,
  );
  const chosen = options.find((o) => o.basicUid === basicUid) ?? null;

  return (
    <Dialog label="Rare Candy" onDismiss={onClose}>
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
                  <span className="truncate">{option.basicName}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-white/55">
            Put a Stage 2 onto <span className="text-white/80">{chosen.basicName}</span>:
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {chosen.stage2.map((stage2) => (
              <li key={stage2.uid}>
                <button
                  type="button"
                  onClick={() => {
                    onAction({
                      type: "rareCandy",
                      seat,
                      uid: rareCandyUid,
                      target: chosen.target,
                      evolutionUid: stage2.uid,
                    });
                    onClose();
                  }}
                  className={`${ROW_BUTTON_BASE} ${ROW_BUTTON_ENABLED}`}
                >
                  <span className="truncate">{stage2.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {/* Rare Candy is optional — always offer an on-screen dismiss (the
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
    </Dialog>
  );
}

/** The retreat decision modal (§11) — mirrors the local HUD's RetreatDialog.
    Pick exactly `cost` of the Active's attached energies to discard and a Bench
    Pokémon to promote, then dispatch `retreat`. Both the energies (the viewer's
    own attachments) and the Bench are already public on the wire; only the cost
    was server-computed (RedactedRetreat). Native <dialog>, dismissable — retreat
    is optional, so Escape / Cancel close it. Mounted only while open, so the
    useState initializers are the fresh-picks-per-open reset. */
function RetreatDialog({
  active,
  bench,
  cost,
  seat,
  onAction,
  onClose,
}: {
  active: RedactedInPlay;
  bench: readonly RedactedInPlay[];
  /** The retreat cost — RedactedRetreat's, not recomputed here. */
  cost: number;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [benchIndex, setBenchIndex] = useState<number | null>(null);
  // The Active's attached energy uids — the discard-pick pool (public own zone).
  const energies = active.attached?.energies ?? [];

  const toggleEnergy = (uid: string) =>
    setChosen((prev) =>
      prev.includes(uid)
        ? prev.filter((u) => u !== uid)
        : prev.length < cost
          ? [...prev, uid]
          : prev,
    );

  const ready = chosen.length === cost && benchIndex !== null;

  return (
    <Dialog label="Retreat" onDismiss={onClose}>
      <h2 className="text-lg font-semibold text-white">Retreat {active.name}</h2>
      {cost > 0 && (
        <>
          <p className="mt-1.5 text-sm text-white/55">
            Discard exactly {cost} attached energ{cost === 1 ? "y" : "ies"} ({chosen.length}/{cost}
            ):
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {energies.map((energy) => {
              const selected = chosen.includes(energy.id);
              return (
                <li key={energy.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleEnergy(energy.id)}
                    className={`${PICK_ROW_BASE} ${
                      selected ? ROW_BUTTON_SELECTED : ROW_BUTTON_UNSELECTED
                    }`}
                  >
                    {energy.name}
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
          const selected = benchIndex === index;
          return (
            <li key={pokemon.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => setBenchIndex(index)}
                className={`${PICK_ROW_SPLIT_BASE} ${
                  selected ? ROW_BUTTON_SELECTED : ROW_BUTTON_UNSELECTED
                }`}
              >
                <span className="truncate">{pokemon.name}</span>
                {pokemon.battle !== undefined && pokemon.battle.damage > 0 && (
                  <span className="ml-2 shrink-0 text-xs font-bold text-rose-300">
                    {pokemon.battle.damage} dmg
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
          className={ACCENT_BUTTON}
          disabled={!ready}
          onClick={() => {
            if (benchIndex === null) return;
            onAction({
              type: "retreat",
              seat,
              discardEnergy: chosen,
              promoteBenchIndex: benchIndex,
            });
            onClose();
          }}
        >
          Retreat
        </button>
      </div>
    </Dialog>
  );
}

/** ko:takePrizes — the KOing player picks `count` of their face-down prizes.
    The wire carries only the counts (prizes are face-down for both players, §3.8),
    so the picker is `prizesRemaining` anonymous backs, exactly like the local
    PrizeDialog. */
function TakePrizesDialog({
  count,
  prizesRemaining,
  seat,
  onAction,
}: {
  count: number;
  prizesRemaining: number;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
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
    <Dialog label="Take prizes">
      <h2 className="text-lg font-semibold text-white">
        Take {count} prize card{count === 1 ? "" : "s"}
      </h2>
      <p className="mt-1.5 text-sm text-white/55">
        Pick {count} of your face-down prize card{count === 1 ? "" : "s"} to add to your hand.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {Array.from({ length: prizesRemaining }, (_, index) => {
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
          className={ACCENT_BUTTON}
          disabled={picked.length !== count}
          onClick={() => onAction({ type: "takePrizes", seat, prizeIndices: picked })}
        >
          Take {picked.length}/{count}
        </button>
      </div>
    </Dialog>
  );
}

/** ko:promote — the KO'd player chooses their next Active from the Bench. Their
    own Bench is public on the wire, so each row dispatches the pick directly
    (choosing is the whole decision), like the local PromoteDialog. */
function PromoteDialog({
  bench,
  seat,
  onAction,
}: {
  bench: readonly RedactedInPlay[];
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  return (
    <Dialog label="Promote a Pokémon">
      <h2 className="text-lg font-semibold text-white">Choose your next Active</h2>
      <p className="mt-1.5 text-sm text-white/55">
        Your Active Pokémon was Knocked Out. Promote one from your Bench.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {bench.map((pokemon, index) => (
          <li key={pokemon.id}>
            <button
              type="button"
              onClick={() => onAction({ type: "promote", seat, benchIndex: index })}
              className={PROMOTE_ROW}
            >
              <span className="truncate">{pokemon.name}</span>
              {pokemon.battle !== undefined && pokemon.battle.damage > 0 && (
                <span className="ml-2 shrink-0 text-xs font-bold text-rose-300">
                  {pokemon.battle.damage} dmg
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** The mulligan-compensation draw (§3.5): draw 0..owed cards. */
function DrawExtraPanel({
  owed,
  seat,
  onAction,
}: {
  owed: number;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const [count, setCount] = useState(owed);
  const clamped = Math.max(0, Math.min(owed, count));
  return (
    <Panel label="Compensation" title={`Your opponent mulliganed — draw up to ${owed}.`}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={NEUTRAL_BUTTON}
            onClick={() => setCount((c) => Math.max(0, c - 1))}
          >
            −
          </button>
          <span className="w-6 text-center text-sm font-semibold tabular-nums">{clamped}</span>
          <button
            type="button"
            className={NEUTRAL_BUTTON}
            onClick={() => setCount((c) => Math.min(owed, c + 1))}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className={ACCENT_BUTTON}
          onClick={() => onAction({ type: "setupDrawExtra", seat, count: clamped })}
        >
          {clamped === 0 ? "Skip the draw" : `Draw ${clamped}`}
        </button>
      </div>
    </Panel>
  );
}

/** A top-center in-flow prompt panel (the setup phases). */
function Panel({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className={PANEL_CLASS}>
      <p className="mb-3 text-sm text-white/85">{title}</p>
      {children}
    </section>
  );
}

/** A native-<dialog> modal (the same top-layer + focus-trap treatment as the
    local HUD's HudDialog). Mounted = open (the caller renders it conditionally,
    the mount effect calls showModal). Without `onDismiss` the decision is
    MANDATORY — Escape is swallowed and there is no dismiss affordance (the ko:*
    dialogs); with it, Escape / an on-screen Cancel close the modal (the optional
    retreat). */
function Dialog({
  label,
  onDismiss,
  children,
}: {
  label: string;
  onDismiss?: () => void;
  children: React.ReactNode;
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
      className="m-auto border-0 bg-transparent p-0 text-white"
    >
      <div className={`w-[min(24rem,calc(100vw-2.5rem))] ${GLASS_DIALOG_PANEL}`}>{children}</div>
    </dialog>
  );
}
