// The authoritative, PURE, per-viewer game redactor (P4). The engine produces
// ONE full-information `GameState`; a client must never see the opponent's hand,
// deck order or prize contents (engine events.ts / setup.ts leave redaction to
// P4). `redactGame(state, seat)` builds the `RedactedGame` wire snapshot one
// viewer at a time — the lobby Durable Object runs it server-side, once per
// connected socket, so no full state ever crosses the network.
//
// It applies the SAME hidden-information rules the web app's playmat projection
// applies for hot-seat play (src/features/game/projection.ts), but produces the
// neutral `@luminous/schema` wire shape instead of playmat `CardModel`s: no
// image URLs (the client builds them from `cardId`), no engine imports on the
// far side. Phase derivation is shared with that projection through
// `phaseViewOf` (phaseView.ts); only the board redaction is restated here,
// against the wire shape.
//
// What crosses the wire per card: PUBLIC cards keep their engine uid as `id`
// (the animation layer tracks one object across zones) plus catalog identity;
// HIDDEN cards carry a POSITIONAL id and the `hidden` sentinel (never the uid —
// leaking it would let a client track a hidden card across zones); empty in-play
// slots the `empty` sentinel. Prizes/decks are counts; the mid-effect decision's
// prompt crosses ONLY to the seat that must answer it (redactedPromptOf) — for a
// hidden-candidate prompt (chooseCards/attachCards) that carries the revealed
// deck-card identities, so the answerer gate is the hidden-info barrier there.
//
// SPECTATORS (P4 3c-vii): `redactGame(state, side, true)` is the view for someone
// with no seat, watching from `side` of the table. It is the same snapshot with
// three things taken away — BOTH hands, BOTH sides' setup placements, and every
// actor affordance (the turn:action lists, the effect prompt). The threat model is
// not a stranger: it is a PLAYER opening a spectator view of their own match to
// read the other hand, so "a spectator sees strictly less than either player"
// is the property, and the sides are treated symmetrically. Note the actor lists
// name cards in a HAND, so withholding the hand without withholding them would
// leak exactly what was hidden — hence one `actor = null` gate rather than a
// field-by-field decision that a future affordance could miss.

import type {
  RedactedAbility,
  RedactedAttack,
  RedactedCard,
  RedactedDiscardable,
  RedactedDiscardScope,
  RedactedEffectPrompt,
  RedactedGame,
  RedactedInPlay,
  RedactedOutcome,
  RedactedPhase,
  RedactedPokemonRef,
  RedactedRareCandyOption,
  RedactedRetreat,
  RedactedSide,
  RedactedStadiumAbility,
  RedactedTrainer,
  Viewer,
} from "@luminous/schema";
import { EMPTY_CARD_ID, EMPTY_CARD_NAME, HIDDEN_CARD_ID, HIDDEN_CARD_NAME } from "@luminous/schema";
import { attackCostAt, costMet } from "./attack";
import { pendingMulligansOf } from "./mulligans";
import {
  abilityBodyGateClause,
  abilityBodyGateMet,
  abilityUsedKey,
  // 🆕🆕🆕 D576 — the Antique Fossil row's Bench-space gate.
  fossilPlayable,
  programPlayable,
  rareCandyOptions,
  trainerProgramPlayable,
} from "./cardplay";
import { cardOfUid, topCardOf, topUid } from "./cards";
import {
  attackLocked,
  // 🆕🆕🆕 D578 — the ATTACK MENU: the wire's attack rows (printed, Memory Dive, Tool).
  attackMenuOf,
  disabledAbilityUids,
  effectiveMaxHp,
  effectiveRetreatCost,
  firstTurnAttackBanned,
  handPlayBarred,
  lockedAttackIndexes,
  lockedAttackNames,
  opposingRetreatBlocked,
  providedEnergy,
  retreatLocked,
} from "./continuous";
import type { DiscardScope, EffectPrompt, PokemonRef } from "./interpreter";
import {
  attackAgainBarred,
  attackBarredByAbility,
  attackTimingBlocked,
  conditionHolds,
  conditionNote,
  handCostAction,
  handCostUnmet,
} from "./interpreter";
import { inSetup, phaseViewOf } from "./phaseView";
import { discardableTargets } from "./turn";
import { programFor } from "./registry";
import type {
  GameOutcome,
  GameState,
  InPlayPokemon,
  Phase,
  PokemonTarget,
  Seat,
  SpecialConditions,
} from "./types";
import { isImmobilized, otherSeat } from "./types";

/** Redact `state` for `viewerSeat`: same state + seat in, structurally-equal
    snapshot out. Pure — nothing aliases the input state.

    `spectating` builds the SEATLESS view instead (3c-vii): `viewerSeat` then only
    picks which side of the table is rendered as "you", and that side's hand,
    setup placements and turn affordances are withheld exactly as the opposite
    side's already were. Everything a spectator sees, both players can already
    see. */
export function redactGame(state: GameState, viewerSeat: Seat, spectating = false): RedactedGame {
  const opponentSeat = otherSeat(viewerSeat);
  const view = phaseViewOf(state, viewerSeat);
  // Setup placements are face-down until both players ready, so the opponent's
  // in-play stacks (battle rows included) redact until then. The viewer's own
  // placements stay face-up — they placed them. A SPECTATOR placed nothing, so
  // the same setup gate applies to BOTH sides for them.
  const setup = inSetup(state);
  return {
    seat: viewerSeat,
    turn: state.turn,
    phase: redactPhase(state, viewerSeat, spectating),
    board: {
      // §7.3 — the one shared Stadium, public to both viewers.
      stadium: state.stadium === null ? null : redactedCardOf(state, state.stadium.uid),
      you: redactedSideOf(state, viewerSeat, {
        faceUpHand: !spectating,
        faceUpInPlay: spectating ? !setup : true,
      }),
      opponent: redactedSideOf(state, opponentSeat, { faceUpHand: false, faceUpInPlay: !setup }),
    },
    activePlayer: asViewer(view.activeSeat, viewerSeat),
    waitingOn: asViewer(view.waitingSeat, viewerSeat),
    outcome: view.outcome === null ? null : redactOutcome(view.outcome, viewerSeat),
  };
}

/** The redacted phase — the discriminant the client routes ACTIONS on. Carries
    the kind plus only non-sensitive fields (setup:drawExtra the viewer's OWN
    owed compensation count, setup:place the viewer-relative ready flags,
    turn:action the viewer's OWN attack options, the ko interrupts their counts);
    the effect:choose prompt goes ONLY to the seat that must answer it
    (`redactedPromptOf`), null for every other viewer. */
function redactPhase(state: GameState, viewerSeat: Seat, spectating: boolean): RedactedPhase {
  const phase = state.phase;
  switch (phase.kind) {
    case "setup:chooseFirst":
      return { kind: "setup:chooseFirst" };
    case "setup:drawExtra":
      return { kind: "setup:drawExtra", owed: phase.owed[viewerSeat] };
    case "setup:place":
      return {
        kind: "setup:place",
        ready: { you: phase.ready[viewerSeat], opponent: phase.ready[otherSeat(viewerSeat)] },
        ...(phase.stage === undefined ? {} : { stage: phase.stage }),
        ...(phase.bonusCards === undefined
          ? {}
          : { bonusCards: spectating ? [] : phase.bonusCards[viewerSeat] }),
      };
    case "turn:action": {
      // turn:action's actor is phase.seat (phaseView) — only they get an attack
      // list, a retreat option, an ability/trainer list and the Rare Candy
      // pairings; the opponent's view of the same phase carries none (empty
      // attacks/abilities/trainers/rareCandy, null retreat).
      //
      // A SPECTATOR has NO actor: `null` can never equal a seat, so every helper
      // below withholds through the guard it already had. One gate rather than
      // five `spectating ? [] : …` — which is the point, because the affordance
      // added HERE next must be withheld by default, not by remembering to. It is
      // load-bearing beyond neatness: the trainer/ability lists name cards in the
      // actor's HAND, so leaking them to a spectator would leak the hand the
      // board redaction just hid.
      const actor = spectating ? null : phase.seat;
      // 🆕🆕🆕 D570 (R-FL1) — inside Festival Lead's attack-again window only `attack` and
      // `endTurn` are legal (turn.ts `turnGate`), so every OTHER affordance is withheld:
      // `null` for this one projection's non-attack lists, through the same `actor`
      // guard each helper already honours — no schema shape change (empty lists and a
      // null retreat are what the opponent's view of turn:action already carries).
      const mainPhase = state.allowances.attackAgainUid === null ? actor : null;
      return {
        kind: "turn:action",
        attacks: redactedAttacksOf(state, viewerSeat, actor),
        retreat: redactedRetreatOf(state, viewerSeat, mainPhase),
        abilities: redactedAbilitiesOf(state, viewerSeat, mainPhase),
        trainers: redactedTrainersOf(state, viewerSeat, mainPhase),
        rareCandy: redactedRareCandyOf(state, viewerSeat, mainPhase),
        stadiumAbility: redactedStadiumAbilityOf(state, viewerSeat, mainPhase),
        // 🆕🆕🆕 D576 — the Antique Fossils' "discard this card from play" offers (R-FO3).
        discardable: redactedDiscardableOf(state, viewerSeat, mainPhase),
      };
    }
    case "ko:takePrizes":
      return { kind: "ko:takePrizes", count: phase.count };
    case "ko:promote":
      return { kind: "ko:promote" };
    case "effect:choose":
      // A prompt's candidates can be the answerer's own deck cards; nobody who
      // cannot ANSWER it may see it, and a spectator never can.
      return {
        kind: "effect:choose",
        prompt: spectating ? null : redactedPromptOf(state, phase, viewerSeat),
      };
    case "gameOver":
      return { kind: "gameOver" };
  }
}

/** The redacted mid-effect prompt for `viewerSeat` — non-null ONLY for the seat
    that must ANSWER it: `phase.answerer ?? phase.seat`. Every other viewer gets
    null. This gate is the hidden-information barrier: a prompt's candidates are
    built from the ANSWERER's own private zones — a deck search's uids, a "look at
    the top N", 🆕 D426's opponent-chosen HAND discard — so the raw prompt must
    never reach the other side of the wire.

    🛑 🆕🆕 **"THE ANSWERER" IS NOT A SYNONYM FOR "THE CONTROLLER", AND D426 IS THE
    FIRST PARK WHERE THE DIFFERENCE CAN LEAK A CARD.** This paragraph used to say
    the candidates were *the controller's own deck cards*, which was true of every
    hidden-candidate producer until D426 and true BY ACCIDENT: the two `decider`
    producers were Ortega's `opponentMayDraw` (non-controller, but its prompt
    resolves no card at all) and nothing else. `opponentDiscardsFromHand` parks a
    `chooseCards` on the NON-controller over that seat's OWN HIDDEN HAND — so the
    line below is what keeps the ATTACKER from receiving a face-up list of the
    DEFENDER's hand, and answering it. It reads `answerer`; it derives nothing.
    Driven from both chairs in `opponentHandDiscard.test.ts` §4.

    This is STRICTER than `phaseViewOf`'s local `withheld` (phaseView.ts), and
    deliberately: that hot-seat projection only withholds an EXPLICIT-answerer
    park (`answerer !== undefined && !== viewer`), leaving a controller-answered
    prompt's `pendingDecision` present for BOTH viewers — harmless there because
    one device shows one viewer and the HUD gates on `waitingOn === "you"`. The
    wire has no such gate: it physically delivers the payload to a client, so a
    controller-answered prompt must go to the CONTROLLER ALONE. The two coincide
    exactly when `answerer` is set — ALWAYS for `mayDraw` — so a mayDraw park
    round-trips to the local projection for BOTH viewers. The public-ref
    (2b-iii-b) and hidden-candidate (2b-iii-c) families are CONTROLLER-answered, so
    `answerer` is undefined and this gate is strictly stricter than `phaseViewOf`'s
    (which keeps the prompt for both): such a park round-trips for the ANSWERER's
    view only, not the opponent's — the round-trip pin is scoped accordingly, and
    this gate stays as-is (tightening the projection instead would be the wrong
    direction — the wire is the barrier, and for a deck search it is the ONLY thing
    keeping the revealed deck-card identities off the opponent's snapshot).

    Every prompt kind now has an online dialog (2b-iii-a/b/c), so for the answerer
    this always returns a non-null redacted prompt; null is now ONLY the
    answerer-gate result. */
function redactedPromptOf(
  state: GameState,
  phase: Extract<Phase, { kind: "effect:choose" }>,
  viewerSeat: Seat,
): RedactedEffectPrompt | null {
  const answerer = phase.answerer ?? phase.seat;
  if (answerer !== viewerSeat) return null;
  return redactPrompt(state, phase.prompt);
}

/** Map the engine's full `EffectPrompt` to the neutral wire shape — the answerer
    has already been established, so this only decides what identity crosses.
    Three families: `mayDraw` (count + note, no references — 2b-iii-a); the
    PUBLIC-REF family (choosePokemon / choosePokemonMulti / moveEnergy /
    discardEnergy — 2b-iii-b), whose candidates are all in-play `PokemonRef`s and
    attached-Energy uids ALREADY public on the redacted board (fresh ref/scope
    copies, no card resolution); and the HIDDEN-CANDIDATE family (chooseCards /
    attachCards — 2b-iii-c), whose candidates are the ANSWERER's own deck/top/
    hand/discard cards — the deck ones hidden until this effect REVEALS them — so
    each candidate uid is resolved to a `RedactedCard` (identity keyed by that
    uid, which the answer dispatches back). That resolution goes to the answerer
    ALONE (the gate above), which is what keeps a deck uid off the opponent's
    wire. 🆕 **D426 CORRECTED "CONTROLLER" TO "ANSWERER" HERE**: those were the
    same seat for every hidden-candidate producer until `opponentDiscardsFromHand`
    parked one on the NON-controller, and the gate above has always said
    `answerer` — the word in this sentence was the one that was wrong. The switch stays EXHAUSTIVE so a new engine prompt kind is a compile
    error here, not a silent null. Every branch builds FRESH objects (the
    ref/scope copies and redactedCardOf), so nothing aliases the input state — the
    redactor's purity contract, like copyConditions. */
function redactPrompt(state: GameState, prompt: EffectPrompt): RedactedEffectPrompt {
  switch (prompt.kind) {
    case "mayDraw":
      return { kind: "mayDraw", count: prompt.count, note: prompt.note };
    case "guessHp":
      // 🆕🆕🆕 D577 — Tyme's guess, routed to the OPPONENT (the answerer gate above): the told
      // NAME and the note, never the face-down card's uid or HP (R-TY3). Fresh object.
      return { kind: "guessHp", name: prompt.name, note: prompt.note };
    case "confirm":
      // The printed "you may" (the `optional` op). The SECOND no-reference arm,
      // and a strictly smaller one than `mayDraw`: there is not even a `count` to
      // carry, because the whole decision is the sentence. Nothing is resolved
      // out of a private zone and nothing aliases the input — the two-field
      // object below is fresh, like every branch here.
      // 🆕🆕🆕 D557 — Kieran's two button captions, copied FRESH (not aliased) and
      // spread only when present (D135): an unlabeled park redacts to the byte-
      // identical two-field object it always did. Public — they paraphrase the print.
      return {
        kind: "confirm",
        note: prompt.note,
        ...(prompt.labels === undefined
          ? {}
          : { labels: { yes: prompt.labels.yes, no: prompt.labels.no } }),
        ...(prompt.cards === undefined
          ? {}
          : {
              cards: {
                yes: redactedCardOf(state, prompt.cards.yes),
                ...(prompt.cards.no === undefined
                  ? {}
                  : { no: redactedCardOf(state, prompt.cards.no) }),
              },
            }),
        ...(prompt.targets === undefined ? {} : { targets: prompt.targets.map(redactedRefOf) }),
      };
    case "orderCards":
      // 🆕 D341 — THE ORDERED WINDOW, RESOLVED TO THE ANSWERER ALONE. Identical in
      // shape to `chooseCards`'s candidate resolution and load-bearing in a way it
      // has never been: on three of the four printings these cards come out of the
      // OTHER seat's deck, so the resolution here is the only thing standing
      // between the deck's owner and their own top. `redactedPromptOf` (the caller)
      // is what routes this to the answering seat and nothing else; the seat whose
      // deck it is receives the count-only `DECK_TOP_REORDERED` log row instead.
      //
      // ⚠️ ORDER-PRESERVING, WHICH NO OTHER ARM HERE HAS TO BE. `map` keeps the
      // deck order the prompt was built in (index 0 = the top), and that order is
      // the state the dialog starts from — a redactor that sorted or de-duplicated
      // would silently change what "put them back in any order" is ordering. Fresh
      // objects per candidate, the no-alias purity contract, like every branch.
      //
      // 🆕 D344 — `alt` RIDES THROUGH AS A CONDITIONAL SPREAD, this file's
      // ABSENT-KEY rule (D135): `alt: undefined` is not the same wire value as no
      // key at all, and every park authored before this slice must redact to the
      // byte-identical two-field object it always did. The caption is printed card
      // text and hides nothing, so unlike `candidates` it needs no answerer gate.
      return {
        kind: "orderCards",
        candidates: prompt.candidates.map((uid) => redactedCardOf(state, uid)),
        note: prompt.note,
        ...(prompt.alt === undefined ? {} : { alt: prompt.alt }),
      };
    case "choosePokemon":
      // 🆕 D358/D359 — the printed CEILING rides through as a conditional spread,
      // this file's ABSENT-KEY rule (D135, and `alt` two arms up): `upTo:
      // undefined` is not the same wire value as no key at all, and every
      // MANDATORY park must redact to the byte-identical two-field object it
      // always did.
      // 🛑 **IT HIDES NOTHING, AND THAT IS A PROPERTY OF THE NUMBER RATHER THAN
      // OF THIS ARM.** `upTo` is the PRINTED ceiling, never a count of what the
      // controller actually holds, and the `note` beside it already says "up to
      // N". (🆕🆕🆕 D574 (D539): ~~"the PRINTED ceiling, never a count"~~ is WITHDRAWN for
      // one producer — Sableye / Alakazam's loop prints no number, so its Q1 `upTo` IS a
      // live count: R-AK1's engine-written BUDGET — the counters on the op's source zone when it
      // first stepped, less what earlier rounds moved. That budget also counts counters on
      // §11-shielded bodies (R-AK2), which can never move, so it is NOT "the counters still
      // movable": a `take` above what the chosen source holds is clamped SILENTLY (the
      // behaviour is right; only the number can over-promise). It still hides nothing — damage
      // counters are face-up on the table — and its `note` quotes the same live number, so the
      // caption and the ceiling agree.) (⚠️ It would not leak even if it were: `redactPhase` sends this whole
      // prompt only to the seat that must ANSWER it. The reason the ceiling is
      // unclamped is that `note` quotes the printed number, so a clamped one would
      // contradict its own caption — see the field's doc in `interpreter.ts`.)
      // 🆕🆕🆕 D572 — `takeVerb` rides through the SAME conditional spread (D135): absent on every
      // park but Adrena-Brain's destination (🆕🆕🆕 D579 (D539): ~~"absent on every park but
      // Adrena-Brain's destination"~~ — stale since D574 (Sableye's `"move"`) and more so now that
      // Walking Wake's `putCountersOnSelfChosen` parks `"put"`; absent on every park that sets no caption
      // verb), so every older prompt redacts byte-identically. It is
      // a caption word and hides nothing.
      return {
        kind: "choosePokemon",
        candidates: prompt.candidates.map(redactedRefOf),
        ...(prompt.upTo === undefined ? {} : { upTo: prompt.upTo }),
        note: prompt.note,
        ...(prompt.takeVerb === undefined ? {} : { takeVerb: prompt.takeVerb }),
      };
    case "choosePokemonMulti":
      return {
        kind: "choosePokemonMulti",
        candidates: prompt.candidates.map(redactedRefOf),
        min: prompt.min,
        max: prompt.max,
        declinable: prompt.declinable,
        note: prompt.note,
      };
    case "moveEnergy":
      return {
        kind: "moveEnergy",
        movable: prompt.movable.map(redactedOfferOf),
        destinations: prompt.destinations.map(redactedRefOf),
        max: prompt.max,
        // 🆕 D441 — the FLOOR crosses for the ceiling's reason: `validateChoice`
        // runs against the WIRE prompt for an online seat, and the online dialog
        // decides from this object alone whether to render "Move none". A floor the
        // wire drops is a mandatory move the remote player is offered the right to
        // refuse — D358's exact defect on the other prompt, arriving here. Spread,
        // so a declinable prompt's wire bytes are unchanged.
        ...(prompt.min === undefined ? {} : { min: prompt.min }),
        // D226 — N's Plan's lifted single-source coupling. It has to CROSS: the
        // online dialog stages its pick by source and the wire validator enforces
        // the coupling, and both read this object rather than the op. Spread so a
        // single-source prompt's wire shape is byte-identical to what it was
        // before the rider existed (the schema's field is optional for the same
        // reason).
        ...(prompt.anySource === undefined ? {} : { anySource: prompt.anySource }),
        // 🆕 D442 — the DESTINATION-side rider crosses for the source-side rider's
        // reason, word for word. The online dialog decides from this object alone
        // whether each pick names its own destination, and the wire validator
        // enforces the coupling off the same object; a rider the wire drops is a
        // spread the remote player cannot build and the engine would refuse anyway.
        // Spread, so a coupled prompt's wire bytes are byte-identical to what they
        // were before this rider existed.
        ...(prompt.anyDest === undefined ? {} : { anyDest: prompt.anyDest }),
        note: prompt.note,
      };
    case "discardEnergy":
      return {
        kind: "discardEnergy",
        discardable: prompt.discardable.map(redactedOfferOf),
        scope: redactedScopeOf(prompt.scope),
        note: prompt.note,
      };
    case "discardTools":
      // 🆕 D543 — the public-ref family's reading, one attached-card array over: a
      // Tool sitting on an in-play Pokémon is face up on the table, so the wire
      // carries the uid + host ref and the client resolves the display name off the
      // board it already has. FRESH objects per offer (`redactedOfferOf`), like every
      // branch here — the redactor's no-alias purity contract.
      return {
        kind: "discardTools",
        discardable: prompt.discardable.map(redactedOfferOf),
        scope: redactedScopeOf(prompt.scope),
        note: prompt.note,
      };
    case "chooseCards":
      return {
        kind: "chooseCards",
        // The reveal: each candidate uid resolved to its identity (the deck
        // cards this search turned face-up), keyed by the uid the answer sends.
        candidates: prompt.candidates.map((uid) => redactedCardOf(state, uid)),
        min: prompt.min,
        max: prompt.max,
        dest: prompt.dest,
        // 🆕 D332 — the per-kind caps (Drayton). Spread-when-present, this
        // redactor's rule for an ABSENT key: `caps: undefined` is not the same
        // wire value as no key at all, and these prompts are compared by value.
        // FRESH objects and fresh arrays per entry, like every branch here — the
        // no-alias purity contract, which also stops the wire holding a reference
        // into the engine's own prompt.
        ...(prompt.caps === undefined
          ? {}
          : { caps: prompt.caps.map((cap) => ({ uids: [...cap.uids], max: cap.max })) }),
        // 🆕🆕🆕 D566 — the DISJUNCTIVE caps (Brock's Scouting), by `caps`' rule one key up:
        // spread-when-present, fresh objects and arrays per entry.
        ...(prompt.capsAnyOf === undefined
          ? {}
          : {
              capsAnyOf: prompt.capsAnyOf.map((entry) => ({
                uids: [...entry.uids],
                max: entry.max,
              })),
            }),
        note: prompt.note,
      };
    case "attachCards":
      return {
        kind: "attachCards",
        candidates: prompt.candidates.map((uid) => redactedCardOf(state, uid)),
        targets: prompt.targets.map(redactedRefOf),
        max: prompt.max,
        // Absent = "in any way you like" (no per-target cap); passed through as
        // undefined, which the wire drops and the schema's optional accepts.
        maxPerTarget: prompt.maxPerTarget,
        // 🆕 D457 — the printed "1 of your Pokémon", carried the same way and for
        // the same reason: the client dialog must not offer a second body its own
        // server would refuse. `true` or absent; there is no `false` to send.
        oneTarget: prompt.oneTarget,
        note: prompt.note,
      };
    case "chooseAttack":
      // D157 — the PUBLIC-REF family's reading (no card resolution, no private
      // zone: a face-up Active's printed attacks are on the table for both
      // players) with the HIDDEN family's mechanics (a server-resolved label),
      // because the wire has no board projection of an attack ROW to resolve an
      // index against. FRESH objects per candidate, like every branch above — the
      // redactor's no-alias purity contract, and here it also stops the wire
      // holding a reference into the engine's own prompt.
      return {
        kind: "chooseAttack",
        candidates: prompt.candidates.map((c) => ({ index: c.index, name: c.name })),
        note: prompt.note,
      };
    case "choosePrize":
      // 🆕🆕🆕 D548 — INDICES ONLY, copied fresh. Every offered slot is FACE DOWN, so no
      // uid and no card id crosses (a uid would let a client track a hidden card across
      // zones); the client paints the offer from `prizesRemaining` + `faceUpPrizes`.
      // 🆕🆕🆕 D567 — Bother-Bot parks this over the OPPONENT's row: the rule above holds on
      // either row (every offered slot is still face down), and both dialogs draw the tiles by
      // INDEX alone, so nothing here moves; `note` names whose row.
      // 🆕🆕🆕 D575 — Team Rocket's Blipbug "Searching Eyes" parks this over the OPPONENT's row too,
      // answered BLIND by the attacker (R-BL1); the card it then looks at reaches the attacker through
      // the `orderCards` arm below — ONE candidate, resolved for the answerer alone (R-BL2). Nothing
      // here moves.
      return { kind: "choosePrize", indices: [...prompt.indices], note: prompt.note };
  }
}

/** A fresh copy of an engine `PokemonRef` for the wire — never an alias into
    game state (the redactor's no-alias purity contract). The `seat` is ABSOLUTE;
    see `RedactedPokemonRef` for why that is not a leak.

    🛑 **D543 — THE LAST SENTENCE OF THIS BLOCK USED TO READ *“Rebuilding `spot`
    explicitly (rather than spreading) makes an added `PokemonTarget` field a
    compile error here rather than a silent alias”*, AND THE *“compile error
    here”* HALF IS MEASURED FALSE.** Re-pointed in place with its reason kept
    (D178/D418), because the reason is still the right one and only the
    consequence was overstated. MEASURED at this head rather than argued (D429):
    give both `PokemonTarget` arms a required `probeField: number` and run
    `bunx tsc -b --force` — `redact.ts` reports exactly TWO errors, at `:767` and
    `:768`, where a `PokemonTarget` LITERAL is passed as an ARGUMENT, and **not one
    at this function**. An explicit rebuild in a RETURN position whose annotated
    type is the WIRE shape cannot error on a field the wire shape does not have:
    it drops it.
    ⚠️ **WHAT THE EXPLICIT REBUILD ACTUALLY BUYS IS STILL WORTH ITS KEEP, AND IT
    IS TWO THINGS, NEITHER OF THEM AN ERROR:** the returned object is a FRESH one,
    so no wire frame aliases a live `GameState` ref (the contract this block
    opens with); and a new engine field is dropped **by construction** rather than
    carried across by a spread, so widening `PokemonTarget` can never silently
    LEAK a field onto the wire. The failure mode a spread would have — a hidden
    engine key riding out to both clients — is the one this shape is actually
    proof against. The compile error that WOULD catch a needed field is the one on
    the WIRE side: add it to `redactedPokemonRefSchema` and this return reddens at
    once. */
function redactedRefOf(ref: PokemonRef): RedactedPokemonRef {
  return {
    seat: ref.seat,
    spot:
      ref.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: ref.spot.index },
  };
}

/** A fresh copy of one offered Energy (uid + its host ref) for the wire. */
function redactedOfferOf(offer: { uid: string; from: PokemonRef }): {
  uid: string;
  from: RedactedPokemonRef;
} {
  return { uid: offer.uid, from: redactedRefOf(offer.from) };
}

/** A fresh copy of a `DiscardScope` for the wire — one arm per engine member,
    with a `never` floor so a FOURTH member is a compile error here rather than a
    silent drop.

    🛑 **D543 — THE OLD BLOCK CLAIMED *“a `satisfies` pins that a new arm is a
    compile error rather than a silent drop”* AND THAT CLAIM WAS FALSE AS
    WRITTEN.** It is re-pointed in place rather than deleted (D178/D418), because
    what it was REACHING FOR is exactly what the switch below now delivers, and
    the way it failed is the reusable part:
      · the old body was a two-arm TERNARY, so `upTo` — an engine member since
        D359 — fell into the `else` and crossed the wire as `{ kind: "each" }`. A
        DECLINABLE 0..max question arrived at the remote dialog as a MANDATORY
        one-per-Pokémon one, and the server then refused the answer that dialog
        could build. **The engine, the validator and the local HUD were all
        correct; only the wire lied**, which is why no engine assertion saw it;
      · and the `satisfies DiscardScope` typed the ternary's OUTPUT against the
        ENGINE union, not the wire one. A `satisfies` on a RESULT can only say
        "this value inhabits that type" — it cannot say "every input was
        considered" (that is what a `never` floor says) and it cannot say
        "this is the WIRE shape" (that is what the annotated return type says).
        Both of the engine's mandatory members happen to be structurally legal
        `RedactedDiscardScope`s too, so the assertion was green on a value that
        had already lost the information the wire needed.
    ⚠️ **A `satisfies` AGAINST THE SOURCE UNION IS NOT AN EXHAUSTIVENESS CHECK.**
    That is the generalisation, and `D543-wire-scope-collapses-upto` is the
    declared row that drives it: restoring the ternary leaves `bun run check`
    GREEN on the engine and reddens only the wire round-trip. */
function redactedScopeOf(scope: DiscardScope): RedactedDiscardScope {
  switch (scope.kind) {
    case "total":
      return { kind: "total", count: scope.count };
    case "each":
      return { kind: "each" };
    case "upTo":
      // The CEILING crosses as a ceiling. Copied by value like every other branch
      // in this file — the redactor's no-alias purity contract — which here also
      // means the wire object and the engine prompt's own scope are never `===`.
      return { kind: "upTo", max: scope.max };
  }
  const unhandled: never = scope;
  throw new Error(`redactedScopeOf: unhandled discard scope ${(unhandled as DiscardScope).kind}`);
}

/** The acting viewer's Active's attacks with server-computed payability, for the
    online turn HUD — the opponent's view of the same turn gets [] (only the turn
    owner may attack). Mirrors GameHud's TurnPanel `disabled` on the full state
    the wire deliberately withholds: §8.2 payability under every continuous cost
    effect in play (effectiveAttackCost + providedEnergy — the Stadium's Basic
    surcharge, the opposing Ability aura and the holder's own discount — 🆕🆕🆕 and
    since D545 the printed COST CLAUSE on the attack too, through `attackCostAt`
    (attack.ts), which is now the payability seam and wraps `effectiveAttackCost`), the §4
    first-turn ban, and the §12 immobilize gate — folded into one `playable`
    boolean so the client needs no engine logic. Own Active only (public), so no
    hidden information leaves the DO.

    ⚠️ AND SINCE THE COST SEAM GAINED A DISCOUNT IT ALSO PUBLISHES THE COST ITSELF.
    `cost` is still the PRINTED cost; `effectiveCost` is the one the gate charges,
    emitted only when the two differ. The pair exists because `playable` and `cost`
    were derived from different numbers — see the comment at the map below. */
function redactedAttacksOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedAttack[] {
  if (viewerSeat !== turnSeat) return [];
  const active = state.players[viewerSeat].active;
  if (active === null) return [];
  const card = topCardOf(state, active);
  if (card === undefined) return [];
  const provided = providedEnergy(state, active);
  // §4 — turn 1 is by construction the going-first player's turn (the same
  // check the local TurnPanel makes); §12 asleep/paralyzed blocks attacking; and
  // §8/§11 (D143) the attack-installed LOCK does too. That third one rides
  // `playable` rather than a new wire field for the reason `redactedRetreatOf`
  // folds the retreat block into `can` (D112): the client needs to know it cannot
  // attack, not why, and the reason is already in the log as an ATTACK_LOCKED row.
  // ⚠️ NOT OPTIONAL — this projection is the ONLY thing standing between a locked
  // player and a button the server will reject with ATTACK_PREVENTED, so every §8
  // gate that refuses a DECLARATION owes this line as well as its own.
  // ⚠️ AND SINCE D148 THE LOCK CAN HAVE BEEN WRITTEN BY THE OPPONENT'S ATTACK
  // ("…the Defending Pokémon can't attack.", 4 printings) rather than by the
  // viewer's own drawback. This line needs NO diff for it — `attackLocked` reads
  // the same field and the viewer is the locked seat either way — but the case is
  // the sharper one to get wrong, because the player never chose the lock and has
  // no card in front of them explaining the greyed-out button. It is swept from
  // BOTH seats in defenderLock.test.ts rather than inherited from D143's sweep.
  // …and, since D242, the ALWAYS-ON gate the body's own printed Ability imposes
  // ("Power Saver"). It rides `banned` rather than `barred` because it is a fact
  // about the whole BODY — every row greys together, which is `attackLocked`'s
  // shape and the exact opposite of the per-index bar below. Boolean-ised here:
  // the reader returns the unmet CONDITION so the §8 gate can name it, and this
  // projection has nowhere to put a reason (`redactedAttackSchema` has no field
  // for one and adding an unread one is D135's defect).
  // ⚠️ **THE §4 FIRST-TURN BAN USED TO RIDE THIS LINE AND D281 MOVED IT INTO THE
  // MAP.** D277 put it here because the licence that lifts it ("Debut
  // Performance", Meloetta ex) is a printed Ability and therefore a fact about the
  // whole BODY — every row un-greyed together. D281 added a SECOND licence for the
  // same ban, printed on one ATTACK (Volbeat `sv06-009`, Exeggcute
  // `sv08-001`/`-192`), so the answer is now per-index and a `banned` term
  // computed once would grey Volbeat's licensed "Quick Sign" along with the
  // "Coordinated Strike" that really is banned. The reader is unchanged and still
  // shared with `attack.ts` and GameHud; what moved is WHERE it is asked.
  // 🆕🆕🆕 D570 (R-FL2) — …and Festival Lead's second-declaration bar: inside the
  // attack-again window a body that no longer holds it (moved, replaced, locked, Festival
  // Grounds gone) may not attack, which greys every row together — a BODY fact,
  // `attackBarredByAbility`'s shape. Through `attackAgainBarred`, attack.ts's own reader.
  const banned =
    isImmobilized(active.conditions) ||
    attackLocked(state, active) ||
    attackBarredByAbility(state, viewerSeat, active) !== undefined ||
    attackAgainBarred(state, viewerSeat, active);
  // §8/§11 (D154) — …and the PER-ATTACK bar, which is the first thing on this line
  // that is not a property of the whole DECLARATION. It rides `playable` for
  // `banned`'s reason verbatim (the client needs to know it cannot use this
  // attack, not why) but it CANNOT ride `banned` itself: that boolean is computed
  // once and applied to every row, and the whole content of this rule is that the
  // card's OTHER attack stays legal. So it is read once, outside the map, and
  // asked per index inside it — the shape `lockedAttackIndexes` returns a set for
  // (continuous.ts).
  // ⚠️ AND SINCE D165 IT IS A SET RATHER THAN ONE INDEX, WHICH IS THIS LINE'S
  // WHOLE REASON FOR EXISTING RESTATED. `lockedAttacks` has TWO writers (D154's
  // self-side bar and D157's imposed one) whose stamps collide from adjacent
  // turns, so a body can carry two live bars — and a projection that marked only
  // one would offer a button the §8 gate rejects, which is the exact failure this
  // line was added to prevent. THIS IS THE ENUMERATING CALLER: it does not know
  // which indices are barred until it is handed the set.
  // ⚠️ NOT OPTIONAL, and MORE load-bearing here than `banned` is: a player under a
  // whole-Pokémon lock has every button greyed and cannot mistake the board, while
  // this one greys exactly one row on an otherwise live panel. The server-side
  // gate (attack.ts §8) rejects with ATTACK_PREVENTED naming the attack; this line
  // is what stops the client offering the button at all.
  const barred = lockedAttackIndexes(state, active);
  // 🆕🆕🆕 D578 (R-MD4, RULED: fixed at the landing) — …and the NAME-keyed bars a borrowed row's own
  // self-lock wrote (`lockedAttackNames`): the row of that name is greyed, the §8 gate's twin.
  const barredNames = lockedAttackNames(state, active);
  // 🆕🆕🆕 D578 — the rows are the ATTACK MENU (`attackMenuOf`): the printed attacks first (each
  // flat `index` its printed index, so every pre-D578 frame is byte-identical), then Relicanth's
  // Memory Dive rows, then a Technical Machine's. `cost` is the cost printed on the row's OWN
  // card; the per-attack bar is compared per PRINTED index (a borrowed row has none, R-MD4)
  // [🆕🆕🆕 D578 (R-MD4, RULED: fixed at the landing): a borrowed row is barred by NAME instead —
  // `barredNames` above].
  return attackMenuOf(state, viewerSeat, active).map(({ attack, origin, sourceIndex }, index) => {
    const printed = attack.cost ?? [];
    // §8.2/§7.3 — the cost the gate CHARGES, folding the Stadium's Basic surcharge,
    // the opposing "Quaking Zone" aura and the holder's own "Excited Heart"
    // discount. Computed ONCE and used twice: for `playable` (as it always was) and
    // for the `effectiveCost` sibling below.
    // ⚠️ THE SIBLING EXISTS BECAUSE THESE TWO LINES USED TO DISAGREE. `playable`
    // has folded the EFFECTIVE cost since this projection was written while `cost`
    // published the PRINTED one, and no field carried the difference — harmless
    // while the only modifier in the pool was a surcharge (a greyed button with no
    // explanation), actively wrong once a DISCOUNT can light the button up while
    // the dots still show a cost the player has not paid. `cost` keeps meaning
    // PRINTED (schema `redactedAttackSchema`); the effective number arrives beside
    // it, and ONLY when the two actually differ, so every board with no cost
    // modifier in play puts a byte-identical frame on the wire.
    // 🆕🆕🆕 D545 — through `attackCostAt`, so the printed COST CLAUSE (corpus
    // `:316`'s alternate {F}, `:324`'s waive) reaches the wire: `effectiveCost`
    // publishes `["Fighting"]` or `[]` when the clause is what the gate charges.
    // The identity check below is KEPT: with no clause in play `attackCostAt`
    // returns `effectiveAttackCost`'s own answer, so the no-modifier frame is still
    // byte-identical, and a waived `[]` against a non-empty printed cost is a
    // length difference the check sees.
    const effective = attackCostAt(state, viewerSeat, active, index, provided);
    const modified =
      effective.length !== printed.length || effective.some((s, i) => s !== printed[i]);
    return {
      index,
      name: attack.name,
      cost: [...printed],
      ...(modified ? { effectiveCost: [...effective] } : {}),
      damage: attack.damage === undefined ? null : String(attack.damage),
      playable:
        !banned &&
        !(origin === "printed" && barred.includes(sourceIndex)) &&
        !barredNames.includes(attack.name) &&
        // §4 (D277, per-INDEX since D281) — the first-turn ban and the two
        // licences that lift it, one printed as an Ability on the body and one
        // printed on this very attack. Asked HERE rather than on `banned` above
        // because the second licence makes the answer differ between two rows of
        // one card.
        !firstTurnAttackBanned(state, active, index) &&
        // §4/§8 (D281) — …and the printed TIMING CLAUSE on this attack, the
        // server-side twin of GameHud's `timingBlocked`. It rides `playable` for
        // `banned`'s reason verbatim (the client needs to know it cannot use this
        // attack, not why) and it CANNOT ride `banned` itself, for the per-index
        // bar's reason verbatim: Terapagos ex's idx 1 "Crown Opal" is live on the
        // exact turn its idx 0 is barred.
        attackTimingBlocked(state, viewerSeat, active, index) === undefined &&
        costMet(effective, provided),
    };
  });
}

/** The acting viewer's retreat option for the online turn HUD — null for the
    opponent (only the turn owner retreats). Mirrors GameHud's TurnPanel
    `canRetreat` on the full state the wire withholds: the CONTINUOUS retreat cost
    (§7.3 — Beach Court discounts Basics), and a `can` folding the §12 immobilize
    gate (asleep/paralyzed blocks retreating), the §11 attack-applied retreat block
    and its continuous-Ability twin (Snorlax "Block") — both of which ride `can`
    rather than a new wire field, the client needing to know it cannot retreat,
    not why — the once-per-turn `retreated`
    allowance, a non-empty Bench (something to promote to) and enough attached
    energy to pay the cost. The energies to discard and the Bench are already on
    the public board, so nothing hidden leaves the DO. */
function redactedRetreatOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedRetreat | null {
  if (viewerSeat !== turnSeat) return null;
  const active = state.players[viewerSeat].active;
  if (active === null) return null;
  const cost = effectiveRetreatCost(state, active);
  const can =
    !isImmobilized(active.conditions) &&
    // D412 — `retreatLocked` and not the bare field: the self-installed lock is
    // the same fact from the other direction, and a HUD that greyed only the
    // imposed one would offer a retreat the §11 gate then refuses — an
    // afford-then-reject, which is the defect D222 paid for at the attach sites.
    !retreatLocked(state, active) &&
    // §11 — the opposing CONTINUOUS Ability block (Snorlax "Block"), which rides
    // `can` for the same reason the attack-applied one does: no new wire field.
    !opposingRetreatBlocked(state, active) &&
    !state.allowances.retreated &&
    state.players[viewerSeat].bench.length > 0 &&
    active.energy.length >= cost;
  return { cost, can };
}

/** The acting viewer's activated Abilities with server-computed playability, for
    the online turn HUD (increment 3b) — [] for the opponent (only the turn owner
    may use one). Mirrors GameHud's `usableAbilities` on the full state the wire
    withholds: it walks the viewer's OWN Active + Bench, enumerates each stack-top
    card's activated `abilities` (never passive/triggered), and folds the §9
    Active-only gate, the §9/§15.J once-per-turn `abilitiesUsed` flag, the §7.5
    hand cost (`handCostUnmet` — reads the OWN hand) and the would-only-whiff
    `programPlayable` gate into ONE `disabled` boolean, EXACTLY as the local Ability
    row — so the client needs no engine logic. Everything read is the viewer's own
    public board + own hand, and it is emitted only to the actor, so nothing hidden
    leaves the DO. `target` is a fresh seatless `PokemonTarget` literal (no alias
    into state — the redactor's purity contract) the `useAbility` action dispatches
    back verbatim. */
function redactedAbilitiesOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedAbility[] {
  if (viewerSeat !== turnSeat) return [];
  const side = state.players[viewerSeat];
  const out: RedactedAbility[] = [];
  // §9 — Pokémon under a continuous Ability-lock aura render their Ability rows
  // greyed, mirroring useAbility's ABILITY_DISABLED reject so the HUD never
  // offers a button the engine will refuse.
  const lockedUids = disabledAbilityUids(state);
  const consider = (pokemon: InPlayPokemon | null, target: PokemonTarget) => {
    if (pokemon === null) return;
    const uid = topUid(pokemon);
    const card = uid === undefined ? undefined : cardOfUid(state, uid);
    if (uid === undefined || card === undefined) return;
    for (const ability of programFor(card.id)?.abilities ?? []) {
      // No excludeUid: an Ability's card is on the BOARD, not the hand it pays out
      // of (which is why none of these cards prints the Trainer's "other").
      const costUnmet = handCostUnmet(state, viewerSeat, ability.program);
      // 🆕🆕🆕 D611 — the body's `uid` is passed, as `useAbility` and GameHud pass it: a gate that
      // reads "this Pokémon" (Spiteful Evolution's hand offer) has no referent without it.
      const noTarget = !programPlayable(state, ability.program, viewerSeat, uid);
      // D272 — the §9 printed board gate (Fezandipiti ex), folded in beside the
      // rest so the HUD greys a row `useAbility` would reject with
      // ABILITY_CONDITION_NOT_MET. Unlike Active-only/already-used it is NOT
      // self-evident from the board the player is looking at, so it carries a
      // `reason` below.
      const gateUnmet =
        ability.playableIf !== undefined && !conditionHolds(state, viewerSeat, ability.playableIf);
      // 🆕 D310 — the §9 PER-BODY gate (Pidove's "if this Pokémon's remaining HP is
      // 30 or less"), through the shared `abilityBodyGateMet` and never spelled
      // here: this mirror is exactly the reader `abilityUsedKey`'s doc block warns
      // about, and a per-body rule re-derived by hand in three places is how the
      // HUD and the engine come to disagree. Carries a `reason` for the same cause
      // the board gate does — a Pokémon's remaining HP is on the board, but the
      // THRESHOLD is printed on the card and the greyed row has to name it.
      const bodyGateUnmet = !abilityBodyGateMet(state, ability, pokemon);
      const disabled =
        lockedUids.has(uid) ||
        (ability.activeOnly && target.spot !== "active") ||
        bodyGateUnmet ||
        // 🆕🆕🆕 D565 — `benchOnly`, `activeOnly`'s mirror (Flustered Leap).
        (ability.benchOnly === true && target.spot !== "bench") ||
        // The KEY comes from `abilityUsedKey`, never spelled here: a
        // "sharedByName" Ability (Fezandipiti ex) keys on its name alone, and a
        // mirror that kept building `${uid}:` would leave the second copy's row
        // lit after the first copy spent the turn's one use.
        (ability.oncePerTurn &&
          state.allowances.abilitiesUsed.includes(abilityUsedKey(uid, ability))) ||
        gateUnmet ||
        costUnmet !== null ||
        noTarget;
      const where = target.spot === "active" ? "Active" : `Bench ${target.index + 1}`;
      out.push({
        // A FRESH target per row (never the shared `consider` param — a card with
        // two activated abilities would otherwise alias one literal across both
        // rows), rebuilt explicitly like redactedRefOf — the redactor's no-alias
        // purity contract.
        target:
          target.spot === "active" ? { spot: "active" } : { spot: "bench", index: target.index },
        abilityName: ability.name,
        // Disambiguates two copies of the same card carrying the same Ability
        // (Skwovet ×2) by its board position, exactly as the local list does.
        label: `${ability.name} · ${card.name} (${where})`,
        disabled,
        // The printed clause a greyed row shows; null when enabled or the disable
        // is self-evident (Active-only / already-used), matching the local row.
        reason:
          costUnmet !== null
            ? `Only if you ${handCostAction(costUnmet, false)}`
            : ability.playableIf !== undefined && gateUnmet
              ? `Only if ${conditionNote(ability.playableIf)}`
              : // 🆕 D310 — below the board gate in the chain, matching the reject
                // order in `useAbility`, so the two surfaces name the same clause
                // on a board where both are unmet.
                // 🆕🆕🆕 D572 — the clause through `abilityBodyGateClause` (Adrena-Brain's {D} gate).
                bodyGateUnmet
                ? `Only if ${abilityBodyGateClause(ability) ?? "its printed condition holds"}`
                : noTarget
                  ? "No legal target"
                  : null,
      });
    }
  };
  consider(side.active, { spot: "active" });
  side.bench.forEach((pokemon, index) => consider(pokemon, { spot: "bench", index }));
  return out;
}

/** The acting viewer's hand Trainers (Items/Supporters + Rare Candy + 🆕 D288
    STADIUMS) playable from their OWN hand, with server-computed playability, for
    the online turn HUD (3b) — [] for the opponent. Mirrors GameHud's
    `playableTrainers` on the full state the wire withholds, deduped to one entry
    per distinct card. (Tools are drag gestures and fall out on
    `program.trainer === undefined` with no `program.stadium` either.)
    🆕 🛑 **D288 — STADIUMS ARE HERE NOW, AND THE OLD EXCLUSION'S STATED GROUND WAS
    NOT ITS REAL ONE.** This docstring used to read *"they play by the board DRAG —
    offered here too would double the affordance"*. The LOCAL list has shown Stadium
    button rows all along AND they are draggable there too, so "double affordance"
    was never a property of Stadiums — it was a description of the local page that
    was true of it and cited as a reason to differ from it. The asymmetry it
    justified was the actual defect: `playableTrainers` greys a barred Stadium row
    (D287) and this projection emitted none, so an online seat got no Stadium button
    at all where a local seat got a correctly-greyed one. RARE CANDY is included and
    FLAGGED (3b-ii): it evolves rather than running a program, so its row opens the
    two-step dialog fed by `redactedRareCandyOf` and answers with the `rareCandy`
    action — but it is still a hand Trainer, so it belongs in this list, exactly as
    the local HUD has it. `disabled` folds the §4 first-turn Supporter ban + §7.2
    one-per-turn, the printed `trainerPlayableIf` board gate (`conditionHolds` reads
    prize counts + the Stadium OWNER the wire withholds), the §7.5 hand cost
    (`handCostUnmet`, the played uid excluded — the printed "OTHER cards"), the
    would-only-whiff `programPlayable` gate and — for Rare Candy alone — the §7.1
    "is there a legal pairing" gate into ONE boolean, EXACTLY as the local Trainer
    row. Every input is the viewer's own hand + public counts/boards, emitted only
    to the actor, so nothing hidden leaves the DO. `uid` (already on the viewer's
    own face-up hand) is what the `playTrainer` / `rareCandy` action dispatches
    back. */
function redactedTrainersOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedTrainer[] {
  if (viewerSeat !== turnSeat) return [];
  const side = state.players[viewerSeat];
  // §7.1 legality (a Basic in play + a matching Stage 2 in hand + timing) is the
  // engine's — greying Rare Candy out before the reject. Computed LAZILY (its
  // cardPool scan is only worth paying when a Rare Candy is actually in hand),
  // the local list's own shape.
  let candyOptions: number | null = null;
  const rareCandyPlayable = (): boolean => {
    if (candyOptions === null) candyOptions = rareCandyOptions(state, viewerSeat).length;
    return candyOptions > 0;
  };
  // §7.3 — the SHARED zone's current occupant NAME, for the same-name rule. Public
  // to both seats (`state.stadium` is on the wire already), and a NAME rather than
  // an id because different prints of one Stadium share it — `playStadium` compares
  // names, so this must too. Resolved once, outside the loop, exactly as the local
  // list has it.
  const inPlayStadium =
    state.stadium === null ? undefined : cardOfUid(state, state.stadium.uid)?.name;
  const seen = new Set<string>();
  const out: RedactedTrainer[] = [];
  for (const uid of side.hand) {
    const card = cardOfUid(state, uid);
    if (card === undefined || card.category !== "Trainer" || seen.has(card.id)) continue;
    const program = programFor(card.id);
    if (program === undefined) continue;
    const isRareCandy = program.rareCandy === true;
    const isStadium = card.trainerType === "Stadium";
    // No play path (a Tool, an unauthored Trainer, an unauthored Stadium) — not
    // offered; the coverage strategy surfaces it as "not simulated" on attempt.
    // Rare Candy is exempt: it is a marker program (`{rareCandy: true}`) with no
    // `trainer` ops, since the `rareCandy` action evolves instead of running one.
    // (🆕🆕🆕 D576: and so is an Antique Fossil — `{playAsPokemon: true}`, no `trainer` ops,
    // since `playTrainer` puts it onto the Bench instead of running one.)
    // ⚠️ A STADIUM'S PLAY PATH IS `program.stadium`, NOT `program.trainer` — the
    // local list's own discriminant, and the reason D287's `if (card.trainerType
    // === "Stadium") continue;` was DEAD CODE: every authored Stadium is
    // `{stadium: …}` with `trainer` undefined, so the line below already skipped
    // every one of them and deleting the guard moved NOTHING.
    // 🆕🆕🆕 D576 — an Antique Fossil's play path is `playAsPokemon` (no `trainer` array).
    const isFossil = program.playAsPokemon === true;
    if (
      !isRareCandy &&
      (isStadium ? program.stadium === undefined : program.trainer === undefined && !isFossil)
    ) {
      continue;
    }
    seen.add(card.id);
    const isSupporter = card.trainerType === "Supporter";
    // The three Item/Supporter gates are scoped OFF Rare Candy exactly as the local
    // list scopes them: cardplay.ts reads `trainerPlayableIf` / the hand cost / the
    // whiff predicate only in playTrainer's Item/Supporter branch, and the
    // `rareCandy` action consults none of them — greying on one here would disagree
    // with the engine.
    // ⚠️ AND OFF STADIUMS TOO (D288), for the SAME reason and the same measurement:
    // `playStadium` reads none of the three — not `trainerPlayableIf`, not the §7.5
    // hand cost, not the whiff predicate — so greying a Stadium row on any of them
    // would disagree with the engine. `program.trainer` is `undefined` on every
    // Stadium, so `handCostUnmet`/`programPlayable` over `[]` would answer
    // vacuously rather than wrongly; the scoping is written anyway because a
    // vacuous answer is an accident, not a decision.
    const gated = isRareCandy || isStadium ? undefined : program.trainerPlayableIf;
    const gateUnmet = gated !== undefined && !conditionHolds(state, viewerSeat, gated);
    const costUnmet =
      isRareCandy || isStadium
        ? null
        : handCostUnmet(state, viewerSeat, program.trainer ?? [], uid);
    // 🆕🆕🆕 D576 — a fossil runs no program; its one gate is a free Bench slot (R-FO1).
    const noTarget =
      !isRareCandy &&
      !isStadium &&
      (isFossil
        ? !fossilPlayable(state, viewerSeat)
        : !trainerProgramPlayable(state, program.trainer ?? [], viewerSeat));
    // ⚠️ THE §4 TERM CARRIES THE CARD'S OWN EXEMPTION (D223,
    // `trainerFirstTurnExempt`: Carmine's "If you go first, you may use this card
    // during your first turn."). Without it this mirror would grey out a row
    // playTrainer ACCEPTS — the afford-then-reject defect inverted, and worse,
    // because a dead-looking row is never clicked and so never reports itself.
    // The §7.2 term beside it is NOT exempted: the printed sentence licenses the
    // timing, not a second Supporter.
    // ⚠️ THE IMPOSED BAR (D283, `handPlayBarred`) IS A TERM OF ITS OWN AND SITS
    // OUTSIDE THE `isSupporter` PARENTHESES, because it reaches the ITEM rows too
    // (Galvantula ex / Budew / Frillish bar Items; Scream Tail ex bars
    // Supporters).
    // Rare Candy is NOT barred by THIS TERM — and 🆕 🛑 **D286 CHANGED THE REASON
    // WITHOUT CHANGING THE LINE.** D283 wrote *"it is not played through
    // `playTrainer`'s Item branch at all"*, which is TRUE about this engine's
    // shape and IRRELEVANT to the rule: Rare Candy IS an Item card played from
    // hand (`trainer_type = "Item"`), so the `"Item"` bar reaches it and
    // `cardplay.ts rareCandy` now refuses it.
    // ⚠️ **THE ROW IS STILL GREYED — BY THE `!rareCandyPlayable()` ARM BELOW, NOT
    // BY THIS ONE.** The bar is folded SEAT-WIDE into `rareCandyOptions`
    // (cardplay.ts), which is what that arm reads, so a barred seat's row goes
    // dark AND the dialog behind it goes empty. **A SECOND TERM HERE WOULD BE A
    // LINE THAT CANNOT GO RED** — `barred ⟹ !rareCandyPlayable()` for this row by
    // construction — which conventions.md forbids. ⚠️ MEASURED, NOT ARGUED: the
    // term was written, the suite (`rareCandyBar.test.ts` §5, which compares this
    // mirror against `applyAction`'s own answer) stayed green with and without it,
    // and it was cut. **THE STAGE 2 IT PUTS IS A DIFFERENT CARD AND A DIFFERENT
    // QUESTION** (D285's *"put ≠ play"*) — nothing here asks it.
    // 🆕 🛑 **D288 — THE STADIUM ARM ARRIVES ON BOTH TERMS AT ONCE, AND THAT PAIRING
    // IS THE SLICE.** D287 shipped the engine gate inside `playStadium` and the
    // LOCAL row's `barred` term, and left this projection emitting no Stadium row
    // at all — so there was nothing here to grey. Emitting the row without the bar
    // would have been strictly WORSE than the gap it closes: a lit row the engine
    // refuses, which is the afford-then-reject defect this whole mirror exists to
    // close. The row and its bar are therefore one edit.
    // ⚠️ THE CLASS IS THE CARD'S OWN FIELD, NARROWED RATHER THAN TRANSLATED — the
    // local list's shape (`HandPlayClass` is spelled in `Card.trainerType`'s words),
    // which retires the `card.trainerType === "Item" ? "Item" : "Supporter"` ternary
    // this line used to carry. `"Tool"` never appears because a Tool has no row in
    // this list at all.
    // ⚠️ RARE CANDY IS STILL EXCLUDED AND STILL FOR D286's MEASURED REASON: the bar
    // is folded seat-wide into `rareCandyOptions`, so `barred ⟹ !rareCandyPlayable()`
    // by construction and a term here could not go red.
    const klass = card.trainerType;
    const barred =
      !isRareCandy &&
      (klass === "Item" || klass === "Supporter" || klass === "Stadium") &&
      // ⚠️ **THE CARD IS PASSED AND THE ACE SPEC ARM ARRIVES FREE ON THE WIRE**
      // (D291). This projection runs SERVER-side over the full catalog `Card`, so
      // Genesect's rarity bar is answerable here even though `RedactedCard`
      // carries no `rarity` field and gains none — the client is told `disabled`,
      // not why in terms it would need the label to compute. That is the
      // asymmetry D287/D288 had to BUILD for Stadiums, arriving for nothing here.
      handPlayBarred(state, viewerSeat, klass, card);
    const disabled =
      gateUnmet ||
      costUnmet !== null ||
      noTarget ||
      barred ||
      (isRareCandy
        ? !rareCandyPlayable()
        : isSupporter
          ? (state.turn === 1 && program.trainerFirstTurnExempt !== true) ||
            state.allowances.supporterPlayed
          : // §7.3's OWN two mechanics, which only a Stadium row has: one Stadium
            // play per turn, and the same NAME cannot replace itself. Both are
            // board facts this projection already carries, which is why the row
            // costs no new field — a DERIVED READ, not a new `GameState` key.
            isStadium && (state.allowances.stadiumPlayed || card.name === inPlayStadium));
    out.push({
      uid,
      name: card.name,
      disabled,
      // The printed/engine clause a greyed row shows; null when enabled or the
      // disable is self-evident (the §4/§7.2 timing, and — like the local row —
      // Rare Candy's no-legal-pairing, which the empty dialog would only restate),
      // matching the local row.
      reason:
        gateUnmet && gated !== undefined
          ? `Only if ${conditionNote(gated)}`
          : costUnmet !== null
            ? `Only if you ${handCostAction(costUnmet, true)}`
            : noTarget
              ? "No legal target"
              : null,
      rareCandy: isRareCandy,
    });
  }
  return out;
}

/** The acting viewer's legal Rare Candy pairings (§7.1) — what the online Rare
    Candy dialog offers behind the `rareCandy`-flagged Trainer row (increment
    3b-ii) — [] for the opponent, who never plays one. The legality is the
    ENGINE's: `rareCandyOptions` already folds the §4 first-turn ban, the
    Basic-in-play + came-into-play-this-turn checks and the Basic→Stage 1→Stage 2
    chain bridge (a cardPool scan the wire could not carry), so this only maps its
    result to the wire shape and resolves the two display names. Everything named
    is the actor's OWN in-play stack top + OWN hand — face-up to this viewer
    already, and emitted to them alone — so nothing hidden leaves the DO. The
    `target` literal is rebuilt fresh (never the option's own object) to keep the
    redactor's no-alias purity contract, as `redactedRefOf` does. */
function redactedRareCandyOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedRareCandyOption[] {
  if (viewerSeat !== turnSeat) return [];
  return rareCandyOptions(state, viewerSeat).map((option) => ({
    target:
      option.target.spot === "active"
        ? { spot: "active" }
        : { spot: "bench", index: option.target.index },
    basicUid: option.basicUid,
    basicName: cardOfUid(state, option.basicUid)?.name ?? option.basicUid,
    stage2: option.stage2Uids.map((uid) => ({
      uid,
      name: cardOfUid(state, uid)?.name ?? uid,
    })),
  }));
}

/** §7.3 — the SHARED Stadium's "once during each player's turn" activated
    ability, folded for the online turn HUD (D210) — null for the non-acting
    viewer (and so for a spectator, whose `turnSeat` is null), exactly as
    `redactedRetreatOf` returns null and `redactedAbilitiesOf` returns [].

    THE ONE OFFER ON THIS ARM THAT IS NOT A LIST AND NOT ON THE VIEWER'S OWN
    BOARD. `redactedAbilitiesOf` walks the viewer's Active + Bench and resolves
    `programFor(card.id)?.abilities`; a Stadium is neither a Pokémon nor a target,
    so it is invisible to that walk — which is why the action (`useStadiumAbility`,
    cardplay.ts, D102) had no wire surface at all from D102 until here, and the
    two Standard-legal drivers (Levincia sv09-150/sv10-244, Spikemuth Gym
    sv10-169) reached real online matches with their printed effect unreachable.

    It mirrors `cardplay.ts`'s `useStadiumAbility` gate TERM FOR TERM, so the
    button and the engine can never disagree: a Stadium in play, that Stadium's
    program carrying an `ability` (a continuous-only Stadium like Beach Court has
    none — null, no row), the per-turn `allowances.stadiumAbilityUsed` flag, and
    the would-only-whiff `programPlayable` gate. The `turnGate` half needs no term
    here — this is a `turn:action` arm and the offer already goes to `phase.seat`
    alone, which is the same seat the gate admits.
    🆕🆕🆕 D564 — and a SIXTH, the Stadium ability's own printed gate (`StadiumAbility.
    playableIf`: Community Center, Team Rocket's Factory), asked for an UNSPENT use by an
    early return that greys the row with the printed clause (`useStadiumAbility` asks it after
    the once-per-turn flag, so a spent use keeps its self-evident null reason). REACHABLE —
    every turn before a Supporter is played — and driven in `trainerBundleD564.test.ts` §8.
    🆕🆕🆕 D561 (R-AN) — the gate grew a FIFTH term and this fold follows it: Academy at
    Night `sv06.5-054`'s program is a `payFromHand { count: 1, to: "deckTop" }`, and
    `useStadiumAbility` now refuses an unpayable hand cost (`handCostUnmet`,
    PLAY_CONDITION_NOT_MET) after `programPlayable`. Without the term here an EMPTY
    hand would light a row the engine answers with a refusal — the D46/D47
    afford-then-reject. Unlike the `programPlayable` term below it is REACHABLE and
    driven (`stadiumsD561.test.ts` §3); its `reason` sits under "No legal target" in
    the chain, matching the engine's reject order.

    ⚠️ `allowances` IS NOT PER-SEAT and must not be read as if it were.
    `TurnAllowances` is ONE object on the state that RESETS at every turn
    boundary (turn.ts), so `stadiumAbilityUsed` always means "the seat whose turn
    this is has already activated it" — which is the acting viewer, the only one
    this fold answers for. That is why the printed "once during EACH player's
    turn" needs no per-seat bookkeeping and why an opponent-side lookup here would
    be a bug rather than a refinement.

    ⚠️ THE `programPlayable` TERM IS CORRECT AND, TODAY, UNREACHABLE. No printed
    Stadium ability program contains a whiff-gated op (Levincia retrieves from a
    discard pile, Spikemuth Gym / Artazon / Mesagoza / Town Store search a deck —
    `programPlayable` gates none of those; 🆕🆕🆕 D561: Academy at Night pays a hand
    card to the deck top, and `programPlayable` gates `payFromHand` neither — its
    hand cost is the separate `costUnmet` term, which IS reachable), so it cannot currently return false
    here and no test over the real pool can discriminate it. It is kept because
    the engine gate has it and a projection that dropped it would offer a button
    `useStadiumAbility` answers with NO_LEGAL_TARGET the day a gated Stadium
    program lands. That day is PINNED, not hoped for: `redactStadiumAbility.test.ts`
    fails the moment a registry Stadium ability carries a gated op, so the
    unreachability is re-checked instead of inherited.
    🆕🆕🆕 D606 (D539) — "TODAY, UNREACHABLE" and "cannot currently return false" are
    WITHDRAWN: Surfing Beach `me01-129` / `me04-114` is a `switchActive { targetType: "Water" }`,
    and a {W} Active with no Benched {W} greys this row "No legal target" — driven in
    `redactStadiumAbility.test.ts`'s D606 block, which now kills D210-programPlayable. And the
    pin did NOT fail on its own when that program landed: its loop scans a hand-kept id list,
    not the registry.

    Nothing hidden leaves the DO: the Stadium card is PUBLIC to both viewers
    already (`board.stadium`), so the only thing this adds to the wire is the
    ACTOR's affordance — and it is withheld from the other viewer anyway, because
    a future gated program's `programPlayable` would read the actor's own deck. */
function redactedStadiumAbilityOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedStadiumAbility | null {
  if (viewerSeat !== turnSeat) return null;
  const stadium = state.stadium;
  if (stadium === null) return null;
  const card = cardOfUid(state, stadium.uid);
  const ability = card === undefined ? undefined : programFor(card.id)?.stadium?.ability;
  if (ability === undefined) return null;
  // 🆕🆕🆕 D564 — the Stadium ability's own printed gate (`StadiumAbility.playableIf`:
  // Community Center, Team Rocket's Factory), term for term with `useStadiumAbility`, which
  // asks it AFTER the once-per-turn flag — so a spent use keeps its self-evident null reason
  // and only an UNSPENT, gated use greys with the printed clause.
  if (
    !state.allowances.stadiumAbilityUsed &&
    ability.playableIf !== undefined &&
    !conditionHolds(state, viewerSeat, ability.playableIf)
  ) {
    return {
      label: ability.label,
      disabled: true,
      reason: `Only if ${conditionNote(ability.playableIf)}`,
    };
  }
  const noTarget = !programPlayable(state, ability.program, viewerSeat);
  // 🆕🆕🆕 D561 (R-AN) — the printed hand cost; no `excludeUid` (the Stadium is in the
  // shared zone, not the hand), exactly as `useStadiumAbility` asks it.
  const costUnmet = handCostUnmet(state, viewerSeat, ability.program);
  return {
    label: ability.label,
    disabled: state.allowances.stadiumAbilityUsed || noTarget || costUnmet !== null,
    // The printed clause a greyed row shows; null when enabled or the disable is
    // self-evident (already used this turn), matching the Ability/Trainer rows.
    reason: noTarget
      ? "No legal target"
      : costUnmet !== null
        ? `Only if you ${handCostAction(costUnmet, false)}`
        : null,
  };
}

/** How much of a side the viewer may see. The two redactions are independent:
    the opponent's HAND is always face-down, their IN-PLAY stacks only during
    setup. The viewer's own side is always fully face-up. */
interface SideVisibility {
  faceUpHand: boolean;
  faceUpInPlay: boolean;
}

function redactedSideOf(state: GameState, seat: Seat, visibility: SideVisibility): RedactedSide {
  const side = state.players[seat];
  return {
    hand: visibility.faceUpHand
      ? side.hand.map((uid) => redactedCardOf(state, uid))
      : hiddenHand(side.hand.length),
    active:
      side.active === null
        ? null
        : visibility.faceUpInPlay
          ? redactedInPlayOf(state, side.active)
          : hiddenInPlay("opponent-active-hidden"),
    // Index-stable: an (engine-impossible) empty stack projects as a slot
    // placeholder rather than vanishing — compacting the bench would desync
    // every index-addressed slot from the engine's.
    bench: visibility.faceUpInPlay
      ? side.bench.map(
          (pokemon, index) => redactedInPlayOf(state, pokemon) ?? emptySlot(seat, index),
        )
      : side.bench.map((_, index) => hiddenInPlay(`opponent-bench-${index}-hidden`)),
    // Counts only — prizes are face-down for BOTH players (§3.8), so no uid or
    // catalog id of a prize or deck card may appear anywhere.
    // 🆕🆕🆕 D548 — RE-SCOPED: that holds for FACE-DOWN prizes (and every deck card) only.
    // A prize turned face up by Crescent Purge is PUBLIC, and rides `faceUpPrizes` below
    // for BOTH seats and for a spectator (the same function builds all three views).
    prizesRemaining: side.prizes.length,
    // 🆕🆕🆕 D548 — index-STABLE: `index` is the slot's position in the live row (the one
    // `takePrizes` and `choosePrize` address), derived here from the stored UID because the
    // row compacts on every take (types.ts). Row order, not turn order, so a client can
    // lay tiles out without sorting. Only face-up slots appear; a face-down one contributes
    // nothing but the count above.
    faceUpPrizes: side.prizes.flatMap((uid, index) =>
      side.faceUpPrizes.includes(uid) ? [{ index, card: redactedCardOf(state, uid) }] : [],
    ),
    deckCount: side.deck.length,
    mulliganCount: pendingMulligansOf(state, seat),
    // §2 — the discard pile is ordered and public.
    discard: side.discard.map((uid) => redactedCardOf(state, uid)),
  };
}

/** 🆕🆕🆕 D576 — the acting viewer's own bodies whose top card (an Antique Fossil) may be
    discarded from play now (R-FO3), each with a FRESH seatless target (the no-alias contract)
    and a display label in the Ability rows' `(Active)` / `(Bench N)` spelling. Read off the
    engine's ONE funnel (`discardableTargets`, turn.ts), which `discardFromPlay` accepts exactly;
    [] for any viewer who is not the acting seat (and a spectator, whose `turnSeat` is null). */
function redactedDiscardableOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedDiscardable[] {
  if (viewerSeat !== turnSeat) return [];
  const side = state.players[viewerSeat];
  return discardableTargets(state, viewerSeat).map((target) => {
    const body = target.spot === "active" ? side.active : side.bench[target.index];
    const name =
      (body === null || body === undefined ? undefined : topCardOf(state, body)?.name) ?? "?";
    const where = target.spot === "active" ? "Active" : `Bench ${target.index + 1}`;
    return {
      target:
        target.spot === "active" ? { spot: "active" } : { spot: "bench", index: target.index },
      label: `${name} (${where})`,
    };
  });
}

/** A public card: full identity, keyed by its engine uid. Carries the raw
    category + trainerType (the client derives its render type from them) and
    `hasImage` (the client builds the asset URL from `cardId`). */
function redactedCardOf(state: GameState, uid: string): RedactedCard {
  const card = cardOfUid(state, uid);
  if (card === undefined) {
    // Unreachable in practice (createGame validates every deck id against the
    // pool), but the redactor stays total: an identity-only placeholder that
    // still animates under its uid. "Trainer" is the neutral category.
    const cardId = state.cardIdByUid[uid] ?? uid;
    return {
      id: uid,
      cardId,
      name: cardId,
      category: "Trainer",
      trainerType: null,
      hasImage: false,
    };
  }
  return {
    id: uid,
    cardId: card.id,
    name: card.name,
    category: card.category,
    trainerType: card.trainerType,
    hasImage: card.image !== null,
  };
}

/** An in-play Pokémon's top card (§1.2) with its face-up battle row and
    attached energy/tools. Only in-play top cards carry `battle`, and only
    face-up ones — setup-phase hidden backs go through hiddenInPlay so redaction
    never leaks a printed HP. */
function redactedInPlayOf(state: GameState, pokemon: InPlayPokemon): RedactedInPlay | null {
  const uid = topUid(pokemon);
  if (uid === undefined) return null; // stacks are never empty, but stay total
  return {
    ...redactedCardOf(state, uid),
    battle: {
      damage: pokemon.damage,
      // The CONTINUOUS max HP (printed + Tool bonuses), the number the engine's
      // KO check reads; null stays the data gap.
      hp: effectiveMaxHp(state, pokemon),
      conditions: copyConditions(pokemon.conditions),
    },
    attached: {
      tools: pokemon.tools.map((toolUid) => redactedCardOf(state, toolUid)),
      energies: pokemon.energy.map((energyUid) => redactedCardOf(state, energyUid)),
    },
  };
}

/** A field-by-field COPY (never an alias) of the engine conditions — a consumer
    mutating a snapshot must not reach back into game state. The `satisfies`
    makes an added engine field a compile error here rather than a silent drop. */
function copyConditions(conditions: SpecialConditions): SpecialConditions {
  const { rotation, poisonDamage, burned, confusionDamage } = conditions;
  return { rotation, poisonDamage, burned, confusionDamage } satisfies SpecialConditions;
}

/** Face-down backs for the opponent's hand. Ids are positional
    (`opponent-hand-N`), NOT the engine uids: a uid is stable across zones, so
    leaking it here would let a client track a specific hidden card from the
    moment it was drawn — exactly what redaction must prevent. */
function hiddenHand(count: number): RedactedCard[] {
  return Array.from({ length: count }, (_, index) => hiddenCard(`opponent-hand-${index}`));
}

/** A face-down back for an opponent in-play stack during setup. Positional id,
    NOT the engine uid (same reason as hiddenHand). No battle row / attachments
    — a battle row would leak the printed HP. */
function hiddenInPlay(id: string): RedactedInPlay {
  return hiddenCard(id);
}

function hiddenCard(id: string): RedactedCard {
  return {
    id,
    cardId: HIDDEN_CARD_ID,
    name: HIDDEN_CARD_NAME,
    category: "Trainer", // neutral, mirrors the synthetic deck/prize backs
    trainerType: null,
    hasImage: false,
  };
}

/** The slot-holder for an (engine-impossible) empty in-play stack. Positional
    id like the hidden backs; a distinct `empty` sentinel because "empty" is NOT
    a face-down card — there is nothing there. */
function emptySlot(seat: Seat, index: number): RedactedCard {
  return {
    id: `${seat}-bench-${index}-empty`,
    cardId: EMPTY_CARD_ID,
    name: EMPTY_CARD_NAME,
    category: "Trainer",
    trainerType: null,
    hasImage: false,
  };
}

/** Engine seat → the viewer's vocabulary. */
function asViewer(seat: Seat | null, viewerSeat: Seat): Viewer | null {
  if (seat === null) return null;
  return seat === viewerSeat ? "you" : "opponent";
}

/** Viewer-map a finished game's outcome — fresh objects, nothing aliased. */
function redactOutcome(outcome: GameOutcome, viewerSeat: Seat): RedactedOutcome {
  if (outcome.result === "win") {
    return {
      result: "win",
      winner: outcome.winner === viewerSeat ? "you" : "opponent",
      reason: outcome.reason,
    };
  }
  return {
    result: "tie",
    reasons: {
      you: outcome.reasons[viewerSeat],
      opponent: outcome.reasons[otherSeat(viewerSeat)],
    },
  };
}
