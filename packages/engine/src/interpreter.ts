import type { Card } from "@luminous/schema";
import {
  energyProvidesOf,
  isBasicPokemon,
  isEnergyCard,
  isSpecialEnergy,
  topCardOf,
  topUid,
} from "./cards";
import { effectiveMaxHp, passivesOf, providesEnergyType } from "./continuous";
import { STATUS_WORD_OF } from "./effects";
import type {
  AttachTargetRiders,
  BoardCondition,
  CardFilter,
  EffectOp,
  EffectSlot,
  HandRefreshDraw,
} from "./effects";
import type { GameEvent } from "./events";
import { flipCoin, shuffle } from "./rng";
import type { GameState, InPlayPokemon, PlayerSide, PokemonTarget, Seat } from "./types";
import {
  BENCH_MAX,
  DEFAULT_POISON_DAMAGE,
  drawToHand,
  makeInPlay,
  noConditions,
  otherSeat,
  presentStatuses,
  takenPrizes,
  withActive,
  withSide,
  without,
} from "./types";

// The shared effect interpreter (D8) — the one place a GameState changes under
// an op program, whether the program came from an attack (effects.ts deriver),
// a Trainer, or an Ability (registry.ts). M3's interpreter was attack-private
// and synchronous; M4 needs mid-effect PARKING (search a deck → pick a card;
// gust → pick which benched Pokémon) so this returns a resumable result and
// the whole continuation (`pendingOp` + the rest of the program + context) is
// JSON so it stores in the `effect:choose` phase and replays identically.
//
// The interpreter can PLACE damage (spreadDamage — an attack's spread hit on
// the opponent's Bench) but never KOs or ends the game: the Knock Out check
// stays in the attack epilogue (attack.ts finishAttack), which sweeps the
// whole board through the shared collectKnockOuts (flow.ts) after the program
// runs. So the interpreter still never touches the KO/win tail — it only moves
// damage, and flow.ts owns every Knock Out.

/** The controller of an effect (the seat playing the card). "self" ops target
    this seat's Active, "defender"/gust the opponent's. */
export interface EffectContext {
  seat: Seat;
  /** The top-card uid of the Pokémon whose effect this is — the printed "this
      Pokémon" (Pawmot "Electrogenesis"). Set wherever the runner knows which
      body the program belongs to: an activated Ability's own Pokémon
      (useAbility), a trigger's (runBoardTrigger / runCheckupTriggers /
      runKoTrigger), the attacker (attack.ts). ABSENT for a Trainer program — a
      Trainer has no "this Pokémon", and an op that reads the source whiffs
      without one. Constant for the whole run, like `seat` (the accumulator
      shape lives on `EffectRecord`), and it rides `EffectContinuation` across
      parks: plain JSON, so a parked program still replays identically (D14). */
  sourceUid?: string;
}

/** A specific in-play Pokémon, addressed by the board it sits on and the spot.
    The one shape a targeting decision resolves to (own bench, opponent bench,
    own Active — the interpreter validates the ref against the live board). */
export interface PokemonRef {
  seat: Seat;
  spot: PokemonTarget;
}

/** What a parked op is asking the controller to decide. `note` is a short
    human string for the prompt UI / log; the arrays are the legal options
    (a client that offers anything else is rejected by resolveEffect). */
export type EffectPrompt =
  /** Pick `min`..`max` card uids to move to `dest`. `dest` is display metadata;
      the op owns the actual move, and `note` carries the accurate prompt text.

      `min` is what tells the two consumers (the dialog's Confirm button and
      resolveEffect's wire validator) whether the pick is DECLINABLE, and it is
      required rather than optional so every park site has to say which it is:

        • **`min: 0`** — the printed "up to", every pile-scanning op (searchDeck
          moves deck → bench/hand; discardPileRetrieval moves the discard pile →
          hand/deck; lookAtTopN takes from the deck top). Taking none is a legal
          answer.
        • **`min === max === count`** — a MANDATORY exact pick, the printed hand
          COST (`payFromHand`, dest `"discard"` or `"deck"`): the only decision is
          WHICH cards, never whether, so there is no decline. */
  | {
      kind: "chooseCards";
      candidates: string[];
      min: number;
      max: number;
      /** Where the picked cards are going. `"deck"` is "into the deck", which for
          every op that says it means SHUFFLED in (Pal Pad / Super Rod); the
          bottom of the deck is its own member, because "put it under your deck"
          and "shuffle it into your deck" are different promises to a player and
          the destination is the ENGINE's to state — a client deriving one from
          the other is the guess `min` exists to prevent. */
      dest: "bench" | "hand" | "deck" | "deckBottom" | "discard";
      note: string;
    }
  /** Pick exactly one in-play Pokémon (switchActive / gust / healChosen). */
  | { kind: "choosePokemon"; candidates: PokemonRef[]; note: string }
  /** Pick `min`..`max` in-play Pokémon — the multi-target snipe (damageChosen:
      Hawlucha's "choose 2", Meowscarada ex / Radiant Blastoise's "on 1 of your
      opponent's Benched Pokémon"). Distinct from choosePokemon (exactly one) in
      that the answer is a SET, dispatched in one go.

      The printed number is EXACT unless the card says "up to" (§9.1): the
      snipes all carry `min === max`, and the "up to" print is `min: 0` —
      healChosen's `upTo` arm (Saguaro's "up to 2 of your Pokémon", the range's
      first consumer; Janine's Secret Art looked like the one coming in but its
      pick collapsed into the attachCards map).

      `declinable` is the separate, printed "**you may**", and it is why a floor
      alone cannot describe this prompt: Hawlucha's "you may choose 2" is
      ALL-OR-NOTHING — 2 refs or none, never 1 of 2 — so the legal answers are
      `min..max` PLUS the empty set. It exists only because the framework
      auto-fires optional triggers (triggers.ts): the decline of a "you may" that
      is never asked about anywhere else has to live in the pick it governs. A
      prompt with `min: 0` is declinable by construction and does not set it. */
  | {
      kind: "choosePokemonMulti";
      candidates: PokemonRef[];
      min: number;
      max: number;
      declinable: boolean;
      note: string;
    }
  /** Move up to `max` Energy from ONE source Pokémon (all picks share a source)
      to ONE destination — the compound moveEnergy decision (Energy Switch /
      Poppy). `movable` pairs each takeable Energy uid with the Pokémon it sits
      on (`from`); `destinations` are the eligible destination Pokémon (all the
      controller's own in-play — the source-exclusion is per-pick, validated
      against the chosen source). Declinable (pick none). */
  | {
      kind: "moveEnergy";
      movable: { uid: string; from: PokemonRef }[];
      destinations: PokemonRef[];
      max: number;
      note: string;
    }
  /** Discard Energy off the board — the energy-removal family (Crushing Hammer /
      Giacomo / Mawile), its attack twins (Pincurchin / Dedenne) and the §8
      self-discard attack cost (Houndoom / Corviknight / Koraidon). `discardable`
      pairs each takeable Energy uid with the Pokémon it sits on — the opponent's,
      or the controller's own Active for the self-discard arm; `scope` says how
      many to pick: **`{kind:"total", count}`** = exactly `count` uids across the
      whole offer (1 for "an Energy", 2 for Corviknight's "Discard 2 Energy"),
      **`{kind:"each"}`** = exactly one uid from EVERY distinct `from` present.
      MANDATORY — there is NO decline, and the op only parks when a real choice
      exists: `discardable` holds at most `count` representatives per
      interchangeable class (the same Energy on the same Pokémon — interpreter.ts
      interchangeableCandidates), and an offer no bigger than `count` auto-resolves
      instead of parking. So **every distinguishable answer is reachable, and no
      row survives beyond what the pick could want** — which above `count: 1` is
      NOT the same as "no two rows give the same answer": three interchangeable
      {F} offered for a pick of 3 yield several uid-subsets landing on one board,
      and that is correct — the player is choosing between identical cards, as in
      paper. What the cap removes is the copy that could ONLY ever duplicate.
      validateChoice's "was it offered" check keys on this collapsed set. Every
      candidate is Energy sitting face up on the table, so the prompt leaks
      nothing. */
  | {
      kind: "discardEnergy";
      discardable: { uid: string; from: PokemonRef }[];
      scope: DiscardScope;
      note: string;
    }
  /** Attach cards out of the controller's DECK onto their own Pokémon — off the
      TOP (Electric Generator / Hydreigon "Tri Howl" — `attachFromTop`) or out of
      a SEARCH of the whole deck (Charizard ex "Infernal Reign", Janine's Secret
      Art — `attachFromDeck`). The first prompt whose answer is a MAP rather than
      a list: every picked card names its OWN destination, where moveEnergy's
      picks all share one.

      `candidates` are the cards the op's filter admits — among the looked-at top
      N in deck order (index 0 was the top) for `attachFromTop`, or the deck-wide
      matches COLLAPSED to at most `max` per interchangeable class for
      `attachFromDeck`, whose source zone is big enough for the difference to
      matter. They are HIDDEN information the controller is being shown — that is
      what "look at the top N" and "search your deck" both mean — so this prompt
      goes to the controller alone, exactly like lookAtTopN's chooseCards; the
      ones actually attached become public through ENERGY_ATTACHED, and the ones
      left unattached stay unnamed unless `discardRest` puts them in the (public)
      discard pile. `targets` are the eligible own Pokémon (attachEnergyTargets,
      with the op's targetType/benchOnly riders); `max` is how many may be
      attached — the printed "up to 2", or the whole candidate set for "any
      number", already resolved to a number here so the dialog and the wire
      validator both read one field.

      `maxPerTarget` caps how many may land on any ONE of those targets — the
      printed "for each of those Pokémon" (Janine's Secret Art, one Energy
      apiece). Absent is the printed "in any way you like": no limit, every split
      legal including all of them on a single Pokémon. It is a separate field
      rather than a smaller `max` because the two bound different things — three
      cards spread one-per-Pokémon is `max: 3, maxPerTarget: 1`, and neither
      number can be recovered from the other.

      DECLINABLE: attaching none is a legal answer ("up to" / "any number"), and
      the op's leftovers clause still runs. */
  | {
      kind: "attachCards";
      candidates: string[];
      targets: PokemonRef[];
      max: number;
      maxPerTarget?: number;
      note: string;
    }
  /** A yes/no: the answering seat may draw `count` cards (opponentMayDraw —
      Ortega's "your opponent may draw a card"). The engine's first pure binary
      prompt, and the first whose ANSWERER is not the program's controller: the
      park carries a `decider` and the phase files it as `answerer`, so this
      prompt reaches the OTHER seat's screen while the controller's turn stands
      still around it. `note` speaks to that answerer ("You may draw a card." —
      every prompt addresses the seat that answers it, and here that is not the
      seat that played the card). Carries no candidates: the decision is the
      whole content, and `count` is the printed number the dialog and the wire
      validator both read. Only ever parked when the draw could actually move a
      card (an empty deck auto-resolves — the M1 no-choice rule), so "yes" is
      never a no-op. */
  | { kind: "mayDraw"; count: number; note: string };

/** How many Energy a parked `discardEnergy` is asking for — a total across the
    whole offer, or one from each Pokémon it offered. Named (rather than inlined)
    because validateChoice and the HUD dialog both branch on it. */
export type DiscardScope = { kind: "total"; count: number } | { kind: "each" };

/** The controller's answer, off the resolveEffect action (wire-checked there). */
export type EffectChoice =
  | { kind: "cards"; uids: string[] }
  | { kind: "pokemon"; ref: PokemonRef }
  | { kind: "pokemonMulti"; refs: PokemonRef[] }
  /** The moveEnergy answer: up to `max` movable Energy uids (all sharing one
      source) moved onto `dest` — the compound decision validateChoice checks
      (same source, dest distinct from it). An empty `uids` is a decline. */
  | { kind: "moveEnergy"; uids: string[]; dest: PokemonRef }
  /** The discardEnergy answer: the Energy uids to discard — exactly `count` in
      total (`{kind:"total"}`) or exactly one per offered source Pokémon
      (`{kind:"each"}`), as validateChoice enforces. Never empty (mandatory). */
  | { kind: "discardEnergy"; uids: string[] }
  /** The attachCards answer: each card to attach paired with the Pokémon it goes
      on — "in any way you like", so the pairing IS the decision. Every uid was
      offered and appears once (one physical card cannot land on two Pokémon), and
      every `to` is an offered target, as validateChoice enforces. An empty list is
      a legal decline. */
  | { kind: "attachCards"; assignments: { uid: string; to: PokemonRef }[] }
  /** The mayDraw answer — `draw: true` takes the cards, `false` is the printed
      decline. A plain boolean (wire-checked to be one: a P4 client's truthy
      string must not read as consent), answered by the phase's `answerer`. */
  | { kind: "mayDraw"; draw: boolean };

/** What the ops ALREADY RUN in this program left behind for the ops still to
    come — each recording op's moved uids under its printed `EffectSlot` (§9.2:
    "in this way", "if you do", "with the effect of this card"). Threaded through
    a run as a mutable accumulator, exactly like `events`, and carried across a
    park inside the continuation.

    DELIBERATELY NOT A FIELD ON `EffectContext`, which the backlog named as the
    likely home. The context is WHO the program is running for — one seat, fixed
    for the whole program, and read by ~30 helpers that would then be holding a
    value going stale under them mid-run. This is the opposite: an accumulator
    that changes at nearly every op. Its sibling is `rest` ("the ops still to
    run") on the continuation, not `seat`. */
export type EffectRecord = { [K in EffectSlot]?: string[] };

/** The JSON continuation stored in the effect:choose phase: the op awaiting a
    choice, the ops after it, the context, and what earlier ops recorded.
    Replaying `applyChoice(pendingOp) → runProgram(rest)` resumes exactly where
    it parked. `record` is absent when nothing has been recorded, so every
    program in the vocabulary that predates §9.2 stores a byte-identical phase. */
export interface EffectContinuation {
  pendingOp: EffectOp;
  rest: EffectOp[];
  ctx: EffectContext;
  record?: EffectRecord;
}

export type RunResult =
  | { kind: "done"; state: GameState }
  | {
      kind: "parked";
      state: GameState;
      prompt: EffectPrompt;
      cont: EffectContinuation;
      /** The seat that must ANSWER, when it is not the program's controller —
          opponentMayDraw is the one producer (Ortega's "your opponent may").
          Absent everywhere else, so settleProgram files the phase's `answerer`
          only for the park that needs it and every pre-D52 park stays
          byte-identical. */
      decider?: Seat;
    };

/** Run an op program from the top. Synchronous ops apply in order; the first
    op that needs a decision PARKS (returns the prompt + a continuation), and
    an empty/forced decision auto-resolves without a prompt (the M1 doctrine:
    a choice with no choice in it is not a choice). A coin-flip gate splices
    its heads-branch into the work queue so parking works uniformly through
    a gate too (no representative program parks inside one — but the shape is
    correct if one ever does). */
export function runProgram(
  state: GameState,
  program: readonly EffectOp[],
  ctx: EffectContext,
  events: GameEvent[],
  /** What earlier ops recorded (§9.2). Every caller but `resumeProgram` starts a
      program from the top, where nothing has run yet — hence the default, which
      is also what keeps this widening invisible to attack.ts / cardplay.ts /
      triggers.ts / flow.ts. Mutated in place as the run proceeds, like `events`. */
  record: EffectRecord = {},
): RunResult {
  let next = state;
  const queue: EffectOp[] = [...program];
  while (queue.length > 0) {
    const op = queue.shift() as EffectOp;
    if (op.op === "coinFlipGate") {
      const [face, rngState] = flipCoin(next.rngState);
      next = { ...next, rngState };
      events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat: ctx.seat, result: face });
      if (face === "heads") queue.unshift(...op.then);
      continue;
    }
    if (op.op === "conditionGate") {
      // The deterministic gate (Falkner's Stadium, Grusha's "instead"), spliced
      // like the coin flip so an op inside a branch can still park. Evaluated
      // against `next` — the board AS OF this point, with every earlier op in
      // the program applied. No event: the condition is public (BoardCondition),
      // so unlike a coin flip it tells the opponent nothing they can't see.
      queue.unshift(...(conditionHolds(next, ctx.seat, op.cond) ? op.then : (op.otherwise ?? [])));
      continue;
    }
    if (op.op === "recordGate") {
      // The printed "in this way" / "if you do" (§9.2 — Miriam, Dendra), spliced
      // like the other two gates so an op inside a branch can still park. Reads
      // the RUNNING record, not `ctx`: what makes this gate different from the
      // other two is that its answer is produced by this very program, so it
      // must see writes made since the run started — including one made by an
      // op that parked and resolved through resolveEffect. No event: the
      // recording op already announced these cards by uid.
      queue.unshift(...(recordGateHolds(next, ctx, op, record) ? op.then : (op.otherwise ?? [])));
      continue;
    }
    const stepped = stepOp(next, op, ctx, events, record);
    if ("park" in stepped) {
      // rest = the queue as it stands after shifting `op` — a plain EffectOp[].
      return {
        kind: "parked",
        state: next,
        // The prompt describes its own op; a §9.2 gate makes the ANSWER buy
        // something the op cannot see. `queue` is the only place that is
        // knowable, which is why this is folded in here and not in the note.
        prompt: withConsequence(stepped.park, op, queue),
        cont: { pendingOp: op, rest: [...queue], ctx, ...carriedRecord(record) },
        ...(stepped.decider === undefined ? {} : { decider: stepped.decider }),
      };
    }
    next = stepped.done;
  }
  return { kind: "done", state: next };
}

/** The uids filed under `slot`, or none. */
function recorded(record: EffectRecord, slot: EffectSlot): readonly string[] {
  return record[slot] ?? [];
}

/** The slot a parking op will file its answer under, if any. */
function recordSlotOf(op: EffectOp): EffectSlot | undefined {
  return op.op === "payFromHand" ||
    op.op === "discardPileRetrieval" ||
    op.op === "attachFromDeck" ||
    op.op === "bottomFromOpponentHand"
    ? op.recordAs
    : undefined;
}

/** Does the record satisfy this gate? The base test is "did the earlier op file
    anything" — a whiffed op files an EMPTY array, which is why the length and not
    the key is what is asked.

    `contains: "yourActive"` narrows it to "is any of those cards on the
    controller's Active" (Janine's Secret Art's "if you attached Energy to your
    **Active** Pokémon in this way"). Read off the live board rather than out of
    the record — see the op's doc for why the record's values stay one kind of
    thing, and for the three ops that would make this board reading differ from
    the historical one if a future card sequenced them in between — and against
    `state` AS OF the gate, with every earlier op applied. */
function recordGateHolds(
  state: GameState,
  ctx: EffectContext,
  op: Extract<EffectOp, { op: "recordGate" }>,
  record: EffectRecord,
): boolean {
  const filed = recorded(record, op.slot);
  if (filed.length === 0) return false;
  if (op.contains !== "yourActive") return true;
  const active = state.players[ctx.seat].active;
  if (active === null) return false;
  return filed.some((uid) => active.energy.includes(uid));
}

/** THE PROMPT MUST SAY WHAT THE ANSWER BUYS. Every prompt note before §9.2 was
    the whole printed effect, because an op WAS the whole effect. A recording op
    is the first that is not: Miriam's dialog describes a deck shuffle while the
    answer silently decides three cards, and "take none" reads as declining a
    minor extra rather than forfeiting the draw and the turn's only Supporter.

    So a parking op that records looks DOWN THE QUEUE for the gate that reads it
    and appends the printed conditional. The queue is where this is knowable —
    a note builder sees one op, and the gate is a different op entirely.

    Silence beats a guess: an unrecognised op in the branch yields no clause at
    all rather than a partial one, so a future gate branch this describer has no
    phrase for degrades to the pre-§9.2 note instead of announcing half a
    consequence. Only TOP-LEVEL gates are scanned, matching every other scan over
    a program (`programPlayable`, `handCostUnmet`). */
function withConsequence(
  prompt: EffectPrompt,
  op: EffectOp,
  queue: readonly EffectOp[],
): EffectPrompt {
  const slot = recordSlotOf(op);
  if (slot === undefined) return prompt;
  const gate = queue.find((q) => q.op === "recordGate" && q.slot === slot);
  if (gate === undefined || gate.op !== "recordGate") return prompt;
  const clause = describeBranch(gate.then);
  if (clause === null) return prompt;
  // The CONDITION, not just the consequence. "If you do" is right for a gate that
  // asks whether the op did anything at all; it is wrong — and quietly wrong, the
  // worst kind in a dialog — for one that asks where the cards LANDED. A player
  // reading "If you do, it is now Poisoned" over Janine's prompt would take the
  // poison for a certainty of attaching at all, and pick two Benched Pokémon.
  const condition = describeCondition(op, gate);
  return condition === null ? prompt : { ...prompt, note: `${prompt.note} ${condition}, ${clause}.` };
}

/** The gate's CONDITION as a printed phrase, or null when there is none to give.
 *
 *  A gate with no `contains` is the plain "did the earlier op do anything", and
 *  "If you do" says that for every op that can record — it is the wording both
 *  §9.2 cards print.
 *
 *  A NARROWED gate needs the narrowing spelled out, and it needs the op's own
 *  verb to do it: "If your Active Pokémon is among them" — an earlier draft —
 *  reads as a fact about the eligible targets rather than about where the cards
 *  went, since "them" binds to the nearest list, which in the note above is
 *  "your Darkness Pokémon". That is a softer form of exactly the misreading the
 *  narrowing exists to prevent. So the phrase is built per RECORDING OP, and an
 *  op this has no words for yields **null** — dropping the clause entirely rather
 *  than describing a narrowed gate in the broad gate's words, which would promise
 *  the consequence on any answer at all. `describeBranch`'s rule, applied to the
 *  other half of the sentence. */
function describeCondition(
  op: EffectOp,
  gate: Extract<EffectOp, { op: "recordGate" }>,
): string | null {
  // Ortega prints its plain gate LONG — "If you put a card on the bottom of
  // your opponent's deck in this way" — so its op says those words rather than
  // the two-word form below: the note is the printed text, and this is the
  // text printed. (Checked before the plain default for exactly that reason.)
  //
  // The `contains === undefined` half of this test is UNREACHABLE today and
  // kept deliberately: `contains` has one member, consumed by one other op, so
  // no gate can currently be both narrowed and pointed at this op. Dropping it
  // is a passing mutation — and it is the exact mutation this function's own
  // doc warns about, since a narrowed gate would then be announced in the broad
  // gate's words ("if you put a card on the bottom" promising a consequence
  // that in fact needs the card to have landed somewhere specific).
  if (gate.contains === undefined && op.op === "bottomFromOpponentHand") {
    return "If you put a card on the bottom of your opponent's deck in this way";
  }
  if (gate.contains === undefined) return "If you do";
  if (gate.contains === "yourActive" && op.op === "attachFromDeck") {
    return "If you attach one to your Active Pokémon";
  }
  return null;
}

/** A gate branch as a printed phrase, or null when any op in it has none.
    Deliberately TINY — it covers exactly the automatic ops the two §9.2 gates
    branch into today (Miriam draws 3, Dendra draws to 5) and refuses everything
    else, because a describer that guesses is how a dialog starts lying. Grow it
    one case per card, the `retrieveNoun` rule. */
function describeBranch(ops: readonly EffectOp[]): string | null {
  const parts: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "drawCards":
        parts.push(op.count === 1 ? "draw a card" : `draw ${op.count} cards`);
        break;
      case "drawUntilHandSize":
        parts.push(`draw cards until you have ${op.size} cards in your hand`);
        break;
      case "opponentMayDraw":
        // Ortega's consequence, addressed to the CONTROLLER reading the pick
        // prompt (the mayDraw prompt itself speaks to the opponent — see
        // mayDrawNote; this clause describes what the answer buys THEM).
        parts.push(
          op.count === 1
            ? "your opponent may draw a card"
            : `your opponent may draw ${op.count} cards`,
        );
        break;
      case "applyStatus":
        // Only the controller-relative arm: "self" is the controller's own Active
        // in a Trainer/Ability program (applyStatus reads ctx.seat), which is what
        // Janine's "it is now Poisoned" refers to. The "defender" arm belongs to
        // an ATTACK program, where no §9.2 gate exists to describe.
        if (op.target !== "self") return null;
        parts.push(`it is now ${STATUS_WORD_OF[op.status]}`);
        break;
      default:
        return null;
    }
  }
  return parts.length === 0 ? null : parts.join(", then ");
}

/** File `uids` under `slot`, if the op asked for it. Always a FRESH array: the
    record a park stored lives inside `GameState` (the phase's continuation), and
    a resumed run seeds its accumulator from it — so writes must replace entries,
    never mutate the arrays behind them. */
function recordMoved(
  record: EffectRecord,
  slot: EffectSlot | undefined,
  uids: readonly string[],
): void {
  if (slot !== undefined) record[slot] = [...uids];
}

/** The continuation's `record` field, or NOTHING when nothing has been recorded
    — so a program that never touches §9.2 parks into the exact phase shape it
    parked into before this existed. Copied, so the stored record cannot be
    reached by a later write to the running accumulator. */
function carriedRecord(record: EffectRecord): { record?: EffectRecord } {
  return Object.keys(record).length === 0 ? {} : { record: { ...record } };
}

/** Resume a parked effect: apply the awaited op with the (already validated)
    choice, then run the rest of the program. */
export function resumeProgram(
  state: GameState,
  cont: EffectContinuation,
  choice: EffectChoice,
  events: GameEvent[],
): RunResult {
  // Seed the accumulator from the stored record (a COPY — the stored one is
  // inside GameState), let the resolving op file its own result into it, then
  // run the rest against it. This is the whole of what makes §9.2 survive a
  // park: Superior Energy Retrieval's cost and Miriam's retrieval both PARK, so
  // every recording this engine can do happens on exactly this path.
  const record: EffectRecord = { ...cont.record };
  const applied = applyChoice(state, cont.pendingOp, choice, cont.ctx, events, record);
  return runProgram(applied, cont.rest, cont.ctx, events, record);
}

/** One synchronous step, or a park request. Parking ops compute their
    candidates: an empty candidate set is a no-op (nothing to choose), a single
    forced candidate auto-resolves (except searchDeck, which is "up to" and
    always lets the player decline, so it parks whenever ≥1 candidate). */
function stepOp(
  state: GameState,
  op: EffectOp,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): { done: GameState } | { park: EffectPrompt; decider?: Seat } {
  switch (op.op) {
    case "applyStatus":
      return { done: applyStatus(state, op, ctx, events) };
    case "heal":
      return { done: healSelf(state, op.amount, ctx, events) };
    case "healEach":
      return { done: healEach(state, op.amount, ctx, events) };
    case "damageActive":
      return { done: damageActive(state, op.amount, ctx, events) };
    case "spreadDamage":
      return { done: spreadDamage(state, op.amount, ctx, events) };
    case "damageSelf":
      return { done: damageSelf(state, op.amount, ctx, events) };
    case "damageChosen": {
      // The snipe (Hawlucha / Meowscarada): choose `count` of the opponent's
      // Benched Pokémon and put counters on each. An empty Bench is a no-op.
      // The pick asks for `count` EXACTLY — the printed number is a floor as
      // well as a ceiling (effects.ts) — clamped to the Bench by §8.6 "do as
      // much as you can", which is the only thing that softens it.
      //
      // WHAT DECIDES BETWEEN A PROMPT AND AN AUTO-TAKE IS `optional`, NOT THE
      // BENCH SIZE. A mandatory snipe over a Bench of `count` or fewer has no
      // decision left in it, so it auto-takes (the M1 no-choice doctrine, and
      // the parkOrForce family's rule at one candidate). A DECLINABLE one always
      // has a decision left — "you may" — and it is the same decision on a Bench
      // of 1 as on a Bench of 5, so it parks at every non-empty Bench. Auto-
      // taking there would honour Hawlucha's printed "you may" only when the
      // opponent has more than 2 Benched Pokémon, which is not what the card
      // says: placing counters is not always wanted (it can KO a body the
      // opponent is happy to lose, free a Bench slot, or fire an on-KO Ability).
      // The framework auto-fires the TRIGGER (triggers.ts), so this pick is the
      // only place that "may" can live at all.
      const candidates = oppBenchRefs(state, ctx.seat);
      if (candidates.length === 0) return { done: state };
      // Wo-Chien "Covetous Ivy" scales the amount by the opponent's TAKEN Prizes;
      // 0 taken → 0 damage, so there is nothing to place OR to ask about.
      const amount = snipeAmount(op, state, ctx);
      if (amount <= 0) return { done: state };
      const declinable = op.optional === true;
      // §8.6: with fewer Benched Pokémon than the printed number, take them all.
      const take = Math.min(op.count, candidates.length);
      if (!declinable && candidates.length <= op.count) {
        return { done: placeSnipe(state, candidates, amount, op.deals === true, ctx, events) };
      }
      return {
        park: {
          kind: "choosePokemonMulti",
          candidates,
          min: take,
          max: take,
          declinable,
          note: snipeNote(amount, take, declinable, op.deals === true),
        },
      };
    }
    case "drawCards":
      return { done: drawToHand(state, ctx.seat, op.count, "effect", events) };
    case "drawUntilHandSize":
      // "Draw cards until you have N cards in your hand" (Grusha). Fully
      // automatic. A hand already at or above `size` draws NOTHING — drawToHand
      // no-ops at count ≤ 0 and emits no event, so a topped-up hand leaves no
      // misleading "drew 0 cards" row; a shallow deck short-draws, like every
      // other draw (§14.3 deck-out is checked at turn start, not here).
      return {
        done: drawToHand(
          state,
          ctx.seat,
          op.size - state.players[ctx.seat].hand.length,
          "effect",
          events,
        ),
      };
    case "discardHand":
      return { done: discardHand(state, ctx, events) };
    case "shuffleDeck":
      return { done: shuffleDeck(state, ctx, events) };
    case "searchDeck": {
      const candidates = state.players[ctx.seat].deck.filter((uid) =>
        matchesFilter(cardOf(state, uid), op.filter),
      );
      const max = op.dest === "bench" ? Math.min(op.max, benchSpace(state, ctx.seat)) : op.max;
      if (candidates.length === 0 || max <= 0) {
        // A search that can find nothing (or has nowhere to put it) is a
        // no-op — the trailing shuffleDeck op still fires.
        return { done: state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 0, // "up to" — taking none is a legal answer
          max,
          dest: op.dest,
          note: searchNote(op.filter, op.dest, max),
        },
      };
    }
    case "discardPileRetrieval": {
      // The discard-pile twin of searchDeck (§7.1 recovery Items). Hand and deck
      // have no capacity cap, so `max` is used as printed (no bench-space clamp).
      // Also "up to" → parks on the SAME chooseCards prompt whenever ≥1 candidate
      // (the player may still take none); an empty match is a no-op, and any
      // trailing shuffleDeck op still fires — exactly like searchDeck's whiff.
      //
      // `exclude` is Superior Energy Retrieval's "(You can't choose a card you
      // discarded with the effect of this card.)" — the cards its own cost paid
      // INTO this pile a moment ago (§9.2). Applied to the CANDIDATES, which is
      // the only place it can bite: the offer is what resolveEffect's
      // validateChoice checks a pick against, so an excluded uid is unreachable
      // from the wire as well as absent from the dialog.
      const barred = new Set(op.exclude === undefined ? [] : recorded(record, op.exclude));
      const candidates = state.players[ctx.seat].discard.filter(
        (uid) => !barred.has(uid) && matchesFilter(cardOf(state, uid), op.filter),
      );
      // A whiff FILES AN EMPTY ANSWER rather than filing nothing. Both are false
      // to the gate that may follow ("if you shuffled any cards … in this way" —
      // you shuffled none), but only one of them is false to a slot some earlier
      // op already wrote: an op that ran and moved nothing must overwrite, or a
      // stale value survives it. Unreachable while each slot has one writer, and
      // the closed `EffectSlot` union makes reuse easy rather than hard — so the
      // two recording ops agree here instead of differing by accident.
      if (candidates.length === 0 || op.max <= 0) {
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 0, // "up to" — taking none is a legal answer
          max: op.max,
          dest: op.dest,
          note: retrieveNote(op.filter, op.dest, op.max, op.exclude !== undefined),
        },
      };
    }
    case "lookAtTopN": {
      // Look at the top n cards (index 0 = top); the candidates are those
      // matching the filter, in deck order. "Up to"/declinable like searchDeck →
      // parks whenever ≥1 candidate (the player may still take none); an empty
      // top-n match is a no-op. The candidate set is the top-n matches ALONE, so
      // resolveEffect's validateChoice (picks ⊆ candidates) already forbids a
      // deeper card. "Shuffle the other cards back" is the trailing shuffleDeck op.
      const top = state.players[ctx.seat].deck.slice(0, Math.max(0, op.n));
      const candidates = top.filter((uid) => matchesFilter(cardOf(state, uid), op.filter));
      if (candidates.length === 0 || op.max <= 0) return { done: state };
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 0, // "up to" — taking none is a legal answer
          max: op.max,
          dest: "hand",
          note: lookNote(op.filter, op.n, op.max),
        },
      };
    }
    case "attachFromTop": {
      // Look at the top n (index 0 = the top) and attach the Energy among them
      // onto your own Pokémon, "in any way you like" (Electric Generator /
      // Hydreigon). Two coupled decisions PER CARD — which cards, and where each
      // one goes — so it parks on the compound attachCards prompt and applies
      // atomically on resolve.
      //
      // Every non-parking path goes through the SAME apply with no assignments,
      // rather than returning `state`: the leftovers clause must fire whether the
      // look found nothing, the board had nowhere to put it, or the player
      // declined (Tri Howl discards the top 3 either way). Routing the empty
      // cases through the one apply is what keeps a branch from forgetting it.
      // The no-TARGET case is a live path, not a theoretical one: there is no
      // `programPlayable` gate on this op (see effects.ts), so Electric Generator
      // into a board with no Benched {L} Pokémon lands exactly here and resolves
      // to its printed shuffle.
      const { candidates, targets, max } = attachFromTopOffer(state, ctx.seat, op);
      if (candidates.length === 0 || targets.length === 0 || max <= 0) {
        return { done: attachFromTopApply(state, [], op, ctx, events) };
      }
      return { park: { kind: "attachCards", candidates, targets, max, note: attachNote(op) } };
    }
    case "attachFromDeck": {
      // SEARCH the deck for Energy and attach it onto your own Pokémon (Charizard
      // ex "Infernal Reign" / Janine's Secret Art). The same compound decision
      // attachFromTop parks on — which cards, and where each one goes — over a
      // candidate set drawn from the whole deck rather than a window on its top.
      //
      // A dead end here returns `state` rather than routing through the apply, and
      // that is the one structural difference from attachFromTop: this op has NO
      // leftovers clause to charge on the empty paths (nothing was ever taken out
      // of the deck, so there is nothing to put back or discard). The printed
      // "Then, shuffle your deck" lives in the trailing `shuffleDeck` op, which
      // runs on the whiff, the decline and the no-target board alike — exactly as
      // it does behind every other search in this vocabulary. No `programPlayable`
      // gate, so the no-target board IS a live path (see the op's doc).
      //
      // The dead end still FILES AN EMPTY ANSWER, the rule `discardPileRetrieval`
      // states above: an op that ran and moved nothing must OVERWRITE its slot, or
      // a stale value from an earlier writer survives it and the gate answers for
      // the wrong op. Unreachable while each slot has one writer — and kept so
      // that stays a property of the PROGRAMS rather than an accident of which
      // branch remembered. With three recording ops now, the one that differed
      // would have been this one.
      const { candidates, targets, max } = attachFromDeckOffer(state, ctx, op);
      if (candidates.length === 0 || targets.length === 0 || max <= 0) {
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      return {
        park: {
          kind: "attachCards",
          candidates,
          targets,
          max,
          ...(op.maxPerTarget === undefined ? {} : { maxPerTarget: op.maxPerTarget }),
          note: attachFromDeckNote(op),
        },
      };
    }
    case "moveEnergy": {
      // Move up to `max` Energy from ONE own Pokémon to ANOTHER (Energy Switch /
      // Poppy). Two coupled decisions (which Energy + where), so it parks on the
      // compound moveEnergy prompt and applies atomically on resolve. A no-op
      // needs no movable Energy OR no distinct destination (fewer than two of the
      // controller's Pokémon in play) — the programPlayable gate blocks the play,
      // but stay a no-op here too (a mid-program board could reach it).
      const { movable, destinations, needed } = moveEndpoints(state, ctx.seat, op);
      if (movable.length === 0 || destinations.length < needed || op.max <= 0) {
        return { done: state };
      }
      return {
        park: { kind: "moveEnergy", movable, destinations, max: op.max, note: moveNote(op) },
      };
    }
    case "discardEnergy": {
      // Discard Energy off the OPPONENT's board (Crushing Hammer / Giacomo /
      // Mawile). Mandatory and exactly one per affected Pokémon, so the only
      // question is WHICH: nothing matching is a no-op, a forced pick
      // auto-resolves (the parkOrForce doctrine), and anything else parks.
      const discardable = discardableEnergies(state, ctx.seat, op);
      if (discardable.length === 0) return { done: state };
      // "Discard ALL Energy from this Pokémon" (Pawmot / Raichu) asks nothing —
      // every match comes off, so it resolves inline like any automatic op. The
      // FULL set, not the collapsed one: interchangeability is about which to
      // pick, and here nothing is picked.
      if (op.count === "all") {
        return { done: discardEnergyApply(state, discardable.map((d) => d.uid), op, ctx, events) };
      }
      const scope: DiscardScope =
        op.from === "opponentEach" ? { kind: "each" } : { kind: "total", count: op.count ?? 1 };
      // A pick can never want more than `count` copies of one interchangeable
      // Energy, so that is exactly how many of each survive the collapse: with
      // cap 1 this is the single-Energy rule ("three {R} on a Houndoom ask
      // nothing"), and with cap 3 a Koraidon discarding 3 off FOUR identical {F}
      // is likewise no question at all.
      const cap = scope.kind === "each" ? 1 : scope.count;
      const candidates = interchangeableCandidates(state, discardable, cap);
      const forced = forcedDiscards(candidates, scope);
      if (forced !== null) return { done: discardEnergyApply(state, forced, op, ctx, events) };
      return {
        park: { kind: "discardEnergy", discardable: candidates, scope, note: discardNote(op) },
      };
    }
    case "payFromHand": {
      // Pay the printed hand cost — to the DISCARD (Ultra Ball / Earthen Vessel /
      // Tinkaton / Revavroom / Meowscarada ex / Radiant Blastoise) or to the
      // BOTTOM OF THE DECK (Dendra) — always the FIRST op of its program, so it
      // runs before anything it buys.
      //
      // MANDATORY and exact: the only decision is WHICH cards, so there is no
      // decline and the prompt asks for `count` on the nose. An offer no bigger
      // than the count has no decision left in it and resolves inline (the M1
      // doctrine) — which is what keeps Meowscarada, whose Basic {G} Energy are
      // interchangeable and collapse to one candidate, asking nothing at all,
      // exactly as its pre-op `AbilityCost` field did.
      //
      // A SHORT hand (fewer candidates than `count`) also lands in that branch
      // and pays what there is. Unreachable through either action path — both
      // gate on `handCostUnmet` before the card is committed — and deliberately
      // NOT an exception here: an interpreter that threw or no-opped mid-program
      // would leave the play half-resolved, where "do as much as you can" is the
      // rule this engine already applies to a short board (§8.6).
      const candidates = handCostCandidates(state, ctx.seat, op);
      if (candidates.length <= op.count) {
        const paid = payFromHandApply(state, candidates, op, ctx, events);
        recordMoved(record, op.recordAs, paid.paid);
        return { done: paid.state };
      }
      // HIDDEN INFORMATION — the candidates are cards in the controller's own
      // HAND, and this prompt is the first that carries any. Do not reason from
      // the apply's rule ("the paid cards land in the public discard, so naming
      // them leaks nothing"): the OFFER is strictly bigger than the payment, so
      // with Ultra Ball three uids are named and only two ever become public —
      // the third stays in hand with its identity given away. The collapse leaks
      // a second thing, the hand's DUPLICATE STRUCTURE: hand size is public but
      // `candidates.length` against it says how many cards are copies.
      //
      // `to: "deckBottom"` is the WORST case of the three and the reason this
      // note is not softening: a card paid to the discard at least becomes
      // public, while Dendra's goes hand → deck and is never seen again, so
      // naming its uid gives away a card that is now hidden for the rest of the
      // game (and, with a full hand offered, names every card in that hand).
      //
      // Safe today because the prompt is only ever shown to the seat that owns
      // it. It reaches a client through `projection.ts`'s `pendingDecision`,
      // which is NOT yet gated on `phase.seat` — a pre-existing P4 hole (deck
      // uids already ride it) that this op is the first to widen to the HAND.
      // That gate is P4's job; see docs/workstreams/simulator.md.
      return {
        park: {
          kind: "chooseCards",
          candidates,
          // No decline: min === max is what makes this the one MANDATORY
          // chooseCards park (every other consumer is a printed "up to").
          min: op.count,
          max: op.count,
          dest: op.to,
          note: payFromHandNote(op),
        },
      };
    }
    case "bottomFromOpponentHand": {
      // Reveal FIRST, and totally — the whole hand goes public in one event
      // before any question is asked, because that is the printed order ("Your
      // opponent reveals their hand, and you choose…"). Emitted here and never
      // in the apply, so a park tells the story once: the reveal rides the
      // action that parked, the pick rides the resolveEffect that answers.
      const revealed = otherSeat(ctx.seat);
      events.push({ type: "HAND_REVEALED", seat: revealed, uids: [...state.players[revealed].hand] });
      // The offer: the filtered hand, one representative per interchangeable
      // class (see the op's doc for why collapsing is sound here and not in
      // payFromHand). No match is the whiff (files [], Greavard into a
      // Supporter-less hand); one class is a forced pick and resolves inline
      // (the M1 doctrine); anything else parks the second-ever mandatory
      // chooseCards.
      const candidates = bottomFromOpponentHandOffer(state, ctx, op);
      if (candidates.length === 0) {
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      if (candidates.length === 1) {
        const moved = bottomFromOpponentHandApply(state, candidates, ctx, events);
        recordMoved(record, op.recordAs, moved.moved);
        return { done: moved.state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 1,
          max: 1,
          dest: "deckBottom",
          note: bottomFromOpponentHandNote(op),
        },
      };
    }
    case "opponentMayDraw": {
      // The opponent's printed "may" — the one park whose ANSWERER is the other
      // seat (the decider below; settleProgram files it as phase.answerer). An
      // empty opponent deck makes both answers the same state, so the question
      // does not exist and the op resolves silently (the M1 no-choice rule —
      // drawCards' own empty-deck no-op, asked about first).
      const drawer = otherSeat(ctx.seat);
      if (state.players[drawer].deck.length === 0) return { done: state };
      return {
        park: { kind: "mayDraw", count: op.count, note: mayDrawNote(op) },
        decider: drawer,
      };
    }
    case "handRefresh":
      // Put the affected player(s)' hand back into their deck — shuffled in
      // (Youngster / Judge / Brassius / Katy) or under it (Iono) — then draw.
      // Fully automatic — no decision, so it never parks (like drawCards /
      // discardHand / shuffleDeck).
      return { done: handRefresh(state, op, ctx, events) };
    case "switchActive":
      return parkOrForce(state, ownBenchRefs(state, ctx.seat), (ref) => switchOwn(state, ref, ctx, events), "Switch to which Benched Pokémon?");
    case "gust":
      return parkOrForce(state, oppBenchRefs(state, ctx.seat), (ref) => gust(state, ref, ctx, events), "Gust up which of the opponent's Benched Pokémon?");
    case "healChosen": {
      if (op.upTo !== undefined) {
        // The printed "up to N … each" (Saguaro). §8.6 clamps the ASK to the
        // board; min is 0 because "up to" legalizes taking fewer — including
        // none — so unlike the mandatory single arm below this parks at every
        // non-empty board: the take-fewer right is the same decision over one
        // candidate as over six (the declinable-snipe rule, D47).
        const candidates = ownInPlayRefs(state, ctx.seat);
        if (candidates.length === 0) return { done: state };
        const max = Math.min(op.upTo, candidates.length);
        return {
          park: {
            kind: "choosePokemonMulti",
            candidates,
            min: 0,
            max,
            declinable: false,
            note: healUpToNote(op.amount, max),
          },
        };
      }
      return parkOrForce(state, ownInPlayRefs(state, ctx.seat), (ref) => healChosen(state, ref, op.amount, ctx, events), "Heal which of your Pokémon?");
    }
    case "attachEnergyFrom": {
      // Same-type Basic Energy is fungible, so the ONLY decision is the target;
      // a source with no matching Energy is a no-op (nothing to attach). The
      // candidates are the eligible targets (targetType + notIfKO riders).
      if (firstAttachableEnergy(state, ctx.seat, op.source, op.energyType) === undefined) {
        return { done: state };
      }
      return parkOrForce(
        state,
        attachEnergyTargets(state, ctx.seat, op),
        (ref) => attachEnergyFrom(state, op, ref, ctx, events),
        "Attach the Energy to which of your Pokémon?",
      );
    }
    // All three gates are spliced by runProgram's queue loop (never reach here).
    case "coinFlipGate":
    case "conditionGate":
    case "recordGate":
      return { done: state };
  }
}

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
    case "noEnergyOnYourPokemon": {
      const side = state.players[seat];
      return [side.active, ...side.bench].every((p) => p === null || p.energy.length === 0);
    }
  }
}

/** The condition as a printed-text fragment, for the reject message a failed
    play gate returns ("<card> can only be used if <this>"). */
export function conditionNote(cond: BoardCondition): string {
  switch (cond.kind) {
    case "morePrizesThanOpponent":
      return "you have more Prize cards remaining than your opponent";
    case "yourStadiumInPlay":
      return "you have a Stadium in play";
    case "noEnergyOnYourPokemon":
      return "none of your Pokémon have any Energy attached";
  }
}

/** A mandatory targeting op: no candidate = no-op, one = forced (auto-resolve),
    ≥2 = park on a choosePokemon prompt. */
function parkOrForce(
  state: GameState,
  candidates: PokemonRef[],
  apply: (ref: PokemonRef) => GameState,
  note: string,
): { done: GameState } | { park: EffectPrompt } {
  if (candidates.length === 0) return { done: state };
  if (candidates.length === 1) return { done: apply(candidates[0] as PokemonRef) };
  return { park: { kind: "choosePokemon", candidates, note } };
}

// ── Choice application (shared by the forced auto-resolve and resolveEffect) ──

/** Apply a parked op given its validated choice. The auto-resolve path calls
    the per-op helpers directly (single forced ref); this is the resolveEffect
    entry, matching the choice shape to the op. */
export function applyChoice(
  state: GameState,
  op: EffectOp,
  choice: EffectChoice,
  ctx: EffectContext,
  events: GameEvent[],
  /** The running §9.2 record — the two recording ops both PARK, so this path is
      where nearly every recording is actually made (see resumeProgram). */
  record: EffectRecord = {},
): GameState {
  switch (op.op) {
    case "searchDeck":
      return choice.kind === "cards"
        ? searchMove(state, choice.uids, op.dest, ctx, events)
        : state;
    case "discardPileRetrieval": {
      if (choice.kind !== "cards") return state;
      const retrieved = retrieveMove(state, choice.uids, op.dest, ctx, events);
      // What was RETRIEVED, not what was offered or picked: a wire-dropped uid
      // (one no longer in the discard) never moved, so Miriam's "if you
      // shuffled any cards into your deck in this way" must not count it.
      recordMoved(record, op.recordAs, retrieved.moved);
      return retrieved.state;
    }
    case "lookAtTopN":
      return choice.kind === "cards" ? revealFromTop(state, choice.uids, ctx, events) : state;
    case "payFromHand": {
      if (choice.kind !== "cards") return state;
      const paid = payFromHandApply(state, choice.uids, op, ctx, events);
      recordMoved(record, op.recordAs, paid.paid);
      return paid.state;
    }
    case "bottomFromOpponentHand": {
      if (choice.kind !== "cards") return state;
      const moved = bottomFromOpponentHandApply(state, choice.uids, ctx, events);
      // What actually MOVED, not what was picked — the retrieval/payment rule
      // (§9.2): a wire-dropped uid never left the hand, and Ortega's "if you
      // put a card on the bottom of your opponent's deck in this way" must not
      // count it. The reveal is NOT re-emitted here — it already rode the
      // action that parked.
      recordMoved(record, op.recordAs, moved.moved);
      return moved.state;
    }
    case "opponentMayDraw":
      // The drawer is the answerer — the controller's OPPONENT (the op's whole
      // point); a decline moves nothing and says nothing.
      return choice.kind === "mayDraw" && choice.draw
        ? drawToHand(state, otherSeat(ctx.seat), op.count, "effect", events)
        : state;
    case "switchActive":
      return choice.kind === "pokemon" ? switchOwn(state, choice.ref, ctx, events) : state;
    case "gust":
      return choice.kind === "pokemon" ? gust(state, choice.ref, ctx, events) : state;
    case "healChosen":
      // The "up to N" arm answers with a SET (each ref healed `amount`,
      // clamped per Pokémon; the empty set is the legal "none" of §9.1's
      // "up to"); the exact-1 arm with a single ref. Each shape only ever
      // reaches its own prompt — validateChoice matches the choice against
      // the PARKED prompt — so the cross arms are the wire belt.
      if (choice.kind === "pokemonMulti") {
        return choice.refs.reduce(
          (healed, ref) => healChosen(healed, ref, op.amount, ctx, events),
          state,
        );
      }
      return choice.kind === "pokemon"
        ? healChosen(state, choice.ref, op.amount, ctx, events)
        : state;
    case "damageChosen":
      // Recompute the (possibly Prize-scaled) amount from state: no KO has
      // happened between parking and this pick, so the count is unchanged — the
      // same value snipeNote quoted in the prompt.
      return choice.kind === "pokemonMulti"
        ? placeSnipe(state, choice.refs, snipeAmount(op, state, ctx), op.deals === true, ctx, events)
        : state;
    case "attachEnergyFrom":
      return choice.kind === "pokemon"
        ? attachEnergyFrom(state, op, choice.ref, ctx, events)
        : state;
    case "attachFromTop":
      return choice.kind === "attachCards"
        ? attachFromTopApply(state, choice.assignments, op, ctx, events)
        : state;
    case "attachFromDeck": {
      if (choice.kind !== "attachCards") return state;
      const attached = attachFromDeckApply(state, choice.assignments, ctx, events);
      // What was ATTACHED, not what was offered or picked — the retrieval/payment
      // rule (§9.2): a uid the wire dropped, repeated, or aimed at a Pokémon that
      // is not there never moved, so Janine's "if you attached Energy to your
      // Active Pokémon in this way" must not count it.
      recordMoved(record, op.recordAs, attached.attached);
      return attached.state;
    }
    case "moveEnergy":
      return choice.kind === "moveEnergy" ? moveEnergyApply(state, choice.uids, choice.dest, ctx, events) : state;
    case "discardEnergy":
      return choice.kind === "discardEnergy" ? discardEnergyApply(state, choice.uids, op, ctx, events) : state;
    default:
      // Synchronous ops never park, so never reach the choice path.
      return state;
  }
}

// ── Op implementations ──

function applyStatus(
  state: GameState,
  op: Extract<EffectOp, { op: "applyStatus" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = op.target === "self" ? ctx.seat : otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  if (op.status === "poisoned") {
    const poisonDamage = op.poisonDamage ?? DEFAULT_POISON_DAMAGE;
    events.push({ type: "STATUS_APPLIED", seat, uid, status: "poisoned", poisonDamage });
    return withActive(state, seat, { ...active, conditions: { ...active.conditions, poisonDamage } });
  }
  if (op.status === "burned") {
    events.push({ type: "STATUS_APPLIED", seat, uid, status: "burned" });
    return withActive(state, seat, { ...active, conditions: { ...active.conditions, burned: true } });
  }
  events.push({ type: "STATUS_APPLIED", seat, uid, status: op.status });
  return withActive(state, seat, {
    ...active,
    conditions: { ...active.conditions, rotation: op.status },
  });
}

/** Spread damage: place `amount` HP on EACH of the opponent's Benched Pokémon
    (§8.5 — Weakness/Resistance never apply on the Bench, so it is flat there).
    A benched Pokémon's own continuous damage REDUCTION still applies though
    (Bouffalant "Bouffer" / a defending Tool — the passive that is not
    Active-only), floored at 0; the attacker's pre-W/R bonus (Vitality Band) is
    Active-target-only and does NOT reach the Bench. One DAMAGE_DEALT per benched
    Pokémon (seat/uid name the DEFENDER, as everywhere). Only raises damage — the
    KO check runs in attack.ts's epilogue, so this never KOs or ends the game
    (interpreter header). */
function spreadDamage(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  const opponent = otherSeat(ctx.seat);
  const side = state.players[opponent];
  if (side.bench.length === 0) return state;
  const bench = side.bench.map((pokemon) => {
    const uid = topUid(pokemon);
    if (uid === undefined) return pokemon;
    const reduction = passivesOf(state, pokemon).damageReductionAfterWR;
    const dealt = Math.max(0, amount - reduction);
    const damage = pokemon.damage + dealt;
    events.push({
      type: "DAMAGE_DEALT",
      seat: opponent,
      uid,
      base: amount,
      weakness: null,
      resistance: null,
      reduction: reduction > 0 ? reduction : undefined,
      dealt,
      damage,
    });
    return { ...pokemon, damage };
  });
  return withSide(state, opponent, { ...side, bench });
}

/** Snipe: put `amount` HP of damage counters on the opponent's Benched Pokémon
    named by `refs` (the forced set, or the ones the player chose — validated
    upstream, so only refs that are the opponent's own bench slots land). Flat —
    a counter placement, NOT attack damage, so no Weakness/Resistance and no
    reduction passive (Bouffer reduces "damage from attacks", which a placed
    counter is not — the damageActive rule). One COUNTERS_PLACED source "ability"
    per Pokémon actually hit. Only raises damage; the KO check runs in the
    caller's mid-turn sweep (flow.ts), so this never KOs. */
function placeSnipe(
  state: GameState,
  refs: readonly PokemonRef[],
  amount: number,
  deals: boolean,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  const opponent = otherSeat(ctx.seat);
  const targeted = new Set<number>();
  for (const ref of refs) {
    if (ref.seat === opponent && ref.spot.spot === "bench") targeted.add(ref.spot.index);
  }
  if (targeted.size === 0) return state;
  const side = state.players[opponent];
  const bench = side.bench.map((pokemon, index) => {
    if (!targeted.has(index)) return pokemon;
    const uid = topUid(pokemon);
    if (uid === undefined) return pokemon;
    if (!deals) {
      // The default put-counter snipe (Hawlucha / Meowscarada): flat, no W/R and
      // no reduction passive (a placed counter is not "damage from an attack").
      events.push({ type: "COUNTERS_PLACED", seat: opponent, uid, amount, source: "ability" });
      return { ...pokemon, damage: pokemon.damage + amount };
    }
    // Wo-Chien "Covetous Ivy": ATTACK DAMAGE to a Benched Pokémon — no Weakness/
    // Resistance (§8.5, Benched), but a benched reduction passive still applies,
    // exactly like spreadDamage. Emitted as DAMAGE_DEALT, so the log reads "dealt"
    // rather than "counters placed".
    const reduction = passivesOf(state, pokemon).damageReductionAfterWR;
    const dealt = Math.max(0, amount - reduction);
    events.push({
      type: "DAMAGE_DEALT",
      seat: opponent,
      uid,
      base: amount,
      weakness: null,
      resistance: null,
      reduction: reduction > 0 ? reduction : undefined,
      dealt,
      damage: pokemon.damage + dealt,
    });
    return { ...pokemon, damage: pokemon.damage + dealt };
  });
  return withSide(state, opponent, { ...side, bench });
}

/** The effective snipe amount — `amount`, or `amount × the opponent's TAKEN
    Prizes` when the op scales by them (Wo-Chien "Covetous Ivy"). Read from state
    at the moment the op runs (and again at the pick, unchanged — no KO intervenes),
    the interpreter's counterpart to attack.ts's pre-W/R Prize fold. */
function snipeAmount(
  op: { amount: number; perTakenPrize?: true },
  state: GameState,
  ctx: EffectContext,
): number {
  return op.perTakenPrize === true ? op.amount * takenPrizes(state, otherSeat(ctx.seat)) : op.amount;
}

/** The choosePokemonMulti prompt string. For the put-counter snipe, counters are
    the printed unit, so the HP `amount` reads back as counters (one counter = 10
    HP, §12); for a `deals` hit (Wo-Chien "Covetous Ivy") the printed unit is
    damage. The heading quotes the card: a bare "Choose 2" for the exact pick every
    consumer prints, and "you may" only where the card says it (an optional trigger,
    whose decline the dialog offers as taking none). Never "up to". */
function snipeNote(amount: number, count: number, optional: boolean, deals: boolean): string {
  const verb = optional ? "You may choose" : "Choose";
  const each = deals
    ? `${amount} damage`
    : `${Math.round(amount / 10)} damage counter${Math.round(amount / 10) === 1 ? "" : "s"}`;
  return `${verb} ${count} of your opponent's Benched Pokémon (${each} each).`;
}

/** The heading for healChosen's "up to N" park. Quotes the card (Saguaro:
    "Choose up to 2 of your Pokémon and heal 50 damage from each of them"),
    with `max` already §8.6-clamped to the board — one Pokémon in play asks
    "up to 1", because doing as much as you can is about the number, not the
    whether. `"all"` has no printed consumer with `upTo` yet; the phrase is
    ready so an author can never park a heading that lies about the amount. */
function healUpToNote(amount: number | "all", max: number): string {
  const what = amount === "all" ? "all damage" : `${amount} damage`;
  return `Choose up to ${max} of your Pokémon and heal ${what} from each of them.`;
}

/** Heal `amount` HP from EACH of the controller's own in-play Pokémon
    (Garganacl "Blessed Salt", between turns). Each heal is clamped to the
    Pokémon's damage and emits its own HEALED (an undamaged Pokémon heals 0 and
    emits nothing). Active then bench, in index order. Never parks. */
function healEach(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const healOne = (pokemon: InPlayPokemon): InPlayPokemon => {
    const uid = topUid(pokemon);
    const healed = Math.min(amount, pokemon.damage);
    if (uid === undefined || healed <= 0) return pokemon;
    events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
    return { ...pokemon, damage: pokemon.damage - healed };
  };
  const active = side.active === null ? null : healOne(side.active);
  const bench = side.bench.map(healOne);
  return withSide(state, ctx.seat, { ...side, active, bench });
}

/** PUT `amount` HP of damage counters on the OPPONENT's Active Pokémon
    (Trevenant "Forest Miasma"). "Put damage counters" is NOT attack damage: no
    Weakness/Resistance (§8.5) AND no damage-reduction passive — Bouffalant's
    "Bouffer" reduces "damage from attacks", which a counter placed by an
    Ability is not (the same reason the poison/burn Checkup ticks place their
    counters flat). So this is a flat placement, distinct from spreadDamage
    (an ATTACK's damage, which Bouffer does reduce). Emitted as COUNTERS_PLACED
    source "ability". Only raises damage; the KO check runs in the caller's
    sweep (the Checkup's, flow.ts), so this never KOs. */
function damageActive(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  const opponent = otherSeat(ctx.seat);
  const active = state.players[opponent].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  events.push({ type: "COUNTERS_PLACED", seat: opponent, uid, amount, source: "ability" });
  return withActive(state, opponent, { ...active, damage: active.damage + amount });
}

/** PLACE `amount` HP of SELF-damage on the controller's OWN Active — the attack
    recoil "This Pokémon also does N damage to itself" (Skeledirge sv01-038
    "Blazing Shout"). Self-damage sits OUTSIDE the §8.5 pipeline: no Weakness/
    Resistance (you have no Weakness to your own attack) and no reduction, so it
    is a flat placement emitted as COUNTERS_PLACED source "self", the confusion
    self-hit's own model (attack.ts). "itself" is the attacking Pokémon — for a
    §8 attack that is the Active, and no derived single-op program moves it before
    this runs. Only raises damage; the resulting self-KO is caught by the attack
    epilogue's TWO-seat sweep (flow.ts finishAttack) and prizes to the defender,
    so this — like every op — never KOs or touches the flow tail. */
function damageSelf(state: GameState, amount: number, ctx: EffectContext, events: GameEvent[]): GameState {
  if (amount <= 0) return state;
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  events.push({ type: "COUNTERS_PLACED", seat: ctx.seat, uid, amount, source: "self" });
  return withActive(state, ctx.seat, { ...active, damage: active.damage + amount });
}

/** Heal the controller's own Active (attack "heal from it" op). */
function healSelf(state: GameState, amount: number, ctx: EffectContext, events: GameEvent[]): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const healed = Math.min(amount, active.damage);
  if (healed <= 0) return state;
  events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
  return withActive(state, ctx.seat, { ...active, damage: active.damage - healed });
}

function discardHand(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const side = state.players[ctx.seat];
  if (side.hand.length === 0) return state;
  events.push({ type: "HAND_DISCARDED", seat: ctx.seat, uids: [...side.hand] });
  return withSide(state, ctx.seat, { ...side, hand: [], discard: [...side.discard, ...side.hand] });
}

function shuffleDeck(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const side = state.players[ctx.seat];
  const [deck, rngState] = shuffle(side.deck, state.rngState);
  events.push({ type: "SHUFFLE", seat: ctx.seat });
  return { ...withSide(state, ctx.seat, { ...side, deck }), rngState };
}

/** Put the affected player(s)' whole hand back into their deck, then draw
    (Youngster / Judge / Brassius / Katy / Iono — the hand-refresh Supporter
    family). Two passes over the affected seats, each in a FIXED order (the
    controller first, then — for `who: "both"`: Judge, Iono — the opponent):

    1. MOVE. Capture the seat's pre-move hand size, then either shuffle the hand
       INTO the deck (default — append and shuffle the combined pile; the insert
       position is irrelevant since the shuffle randomizes it all) or, with
       `toBottom` (Iono), shuffle the HAND ALONE and append it UNDER the deck,
       leaving the deck's own order — and so the very next draws — untouched.
       One count-only event per seat.
    2. DRAW. Each affected seat draws a constant, its captured hand size + delta,
       or its own remaining Prize count. `onlyIfAnyMoved` (Iono's "if either player
       put any cards on the bottom of their deck in this way") skips the whole pass
       when no affected seat moved a card — an ALL-OR-NOTHING gate across the seats,
       which is why every move happens before any draw.

    A shuffled/bottomed or drawn card is hidden, so every event here is count-only
    (the drawn uids ride drawToHand's standard contract) — nothing leaks even when
    the op reaches the OPPONENT's hand. Never parks (no decision), never KOs. */
function handRefresh(
  state: GameState,
  op: Extract<EffectOp, { op: "handRefresh" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seats: Seat[] = op.who === "both" ? [ctx.seat, otherSeat(ctx.seat)] : [ctx.seat];
  let next = state;
  // One entry per affected seat, in the same order — pass 2 zips over it, so the
  // captured pre-move hand size can never go missing (no lookup, no default).
  const moved: { seat: Seat; handCount: number }[] = [];
  for (const seat of seats) {
    const side = next.players[seat];
    const handCount = side.hand.length;
    moved.push({ seat, handCount });
    if (op.toBottom) {
      // Only the hand is randomized; the deck keeps its order above it.
      const [bottom, rngState] = shuffle(side.hand, next.rngState);
      const deck = [...side.deck, ...bottom];
      events.push({ type: "HAND_TO_BOTTOM_OF_DECK", seat, count: handCount });
      next = { ...withSide(next, seat, { ...side, hand: [], deck }), rngState };
    } else {
      // The deck is reordered even from an empty hand (count 0), so the following
      // draw is off a freshly shuffled deck either way.
      const [deck, rngState] = shuffle([...side.deck, ...side.hand], next.rngState);
      events.push({ type: "HAND_SHUFFLED_INTO_DECK", seat, count: handCount });
      next = { ...withSide(next, seat, { ...side, hand: [], deck }), rngState };
    }
  }
  if (op.onlyIfAnyMoved && !moved.some((m) => m.handCount > 0)) return next;
  for (const { seat, handCount } of moved) {
    const count = handRefreshDrawCount(next, seat, op.draw, handCount);
    next = drawToHand(next, seat, count, "effect", events);
  }
  return next;
}

/** How many cards `seat` draws in a handRefresh: a constant, its own pre-move
    hand size + delta (Brassius), or its own remaining Prize count (Iono). */
function handRefreshDrawCount(
  state: GameState,
  seat: Seat,
  draw: HandRefreshDraw,
  handCount: number,
): number {
  switch (draw.kind) {
    case "fixed":
      return draw.count;
    case "handPlus":
      return handCount + draw.delta;
    case "prizeCount":
      return state.players[seat].prizes.length;
  }
}

// (deck shuffling reuses rng.ts's vetted Fisher–Yates — the M1 review caught a
// biased hand-rolled variant; there is exactly one shuffle in the engine.)

/** Move the chosen searched cards deck → dest (bench Basics enter play stamped
    this turn; hand cards just append). Wire-safe: only uids actually in the
    deck move (resolveEffect already checked them against the candidate set). */
function searchMove(
  state: GameState,
  uids: readonly string[],
  dest: "bench" | "hand",
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  // Bench-bound cards clamp to the remaining bench space HERE, before anything
  // leaves the deck — so the set removed from the deck is EXACTLY the set that
  // lands (a slice-after-remove would strand the excess in neither zone, the
  // card-destruction shape the M1 review called out). Hand has no cap.
  const inDeck = uids.filter((uid) => side.deck.includes(uid));
  const moved = dest === "bench" ? inDeck.slice(0, benchSpace(state, ctx.seat)) : inDeck;
  if (moved.length === 0) return state;
  const picked = new Set(moved);
  const deck = side.deck.filter((uid) => !picked.has(uid));
  const updated: PlayerSide =
    dest === "bench"
      ? { ...side, deck, bench: [...side.bench, ...moved.map((uid) => makeInPlay(uid, state.turn))] }
      : { ...side, deck, hand: [...side.hand, ...moved] };
  events.push({ type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved] });
  return withSide(state, ctx.seat, updated);
}

/** Move the chosen retrieved cards discard → dest (§7.1 recovery Items): hand
    appends; deck appends to the end, where a trailing `shuffleDeck` op then
    scrambles them ("shuffle … into your deck"). Wire-safe like searchMove: only
    uids actually in the discard pile move (resolveEffect already checked them
    against the candidate set, and rejects a uid picked twice).

    Hands back the uids that ACTUALLY moved, for the §9.2 record (Miriam) — the
    same list the event names, so what a later clause reads is exactly what the
    game announced. */
function retrieveMove(
  state: GameState,
  uids: readonly string[],
  dest: "hand" | "deck",
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: string[] } {
  const side = state.players[ctx.seat];
  const moved = uids.filter((uid) => side.discard.includes(uid));
  if (moved.length === 0) return { state, moved };
  const picked = new Set(moved);
  const discard = side.discard.filter((uid) => !picked.has(uid));
  const updated: PlayerSide =
    dest === "hand"
      ? { ...side, discard, hand: [...side.hand, ...moved] }
      : { ...side, discard, deck: [...side.deck, ...moved] };
  events.push({ type: "DISCARD_RETRIEVED", seat: ctx.seat, dest, uids: [...moved] });
  return { state: withSide(state, ctx.seat, updated), moved };
}

/** Move the chosen looked-at cards deck → hand (lookAtTopN — Great Ball /
    Pokégear 3.0). Wire-safe like searchMove/retrieveMove: only uids actually in
    the deck move, and resolveEffect already checked them against the candidate
    set (the top-n matches), so a deeper card can never reach here. The cards are
    REVEALED (the printed "reveal … put it into your hand"), so DECK_TOP_REVEALED
    names them. The trailing shuffleDeck op then scrambles the deck (the top cards
    were looked at), whether or not anything was taken. */
function revealFromTop(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const moved = uids.filter((uid) => side.deck.includes(uid));
  if (moved.length === 0) return state;
  const picked = new Set(moved);
  const deck = side.deck.filter((uid) => !picked.has(uid));
  events.push({ type: "DECK_TOP_REVEALED", seat: ctx.seat, uids: [...moved] });
  return withSide(state, ctx.seat, { ...side, deck, hand: [...side.hand, ...moved] });
}

/** Pay a hand cost: move the chosen `uids` out of the controller's hand — into
    their own discard pile (§7/§9 — Ultra Ball, Tinkaton, Meowscarada ex) or
    UNDER their own deck (Dendra). Wire-safe in the same way searchMove /
    retrieveMove are: only uids actually in the hand move, and a uid repeated on
    the wire pays once, so a card is never duplicated into the destination nor
    left in neither zone. Emits ONE event naming the cards and where they went.

    The paid cards keep the order they were PICKED IN when they go under the deck
    — the printed sentence pays one card ("Put a card…"), so no card in the family
    can tell a chosen order from any other, and preserving the pick is the answer
    that needs no rng. Deck order is otherwise untouched: this is the placement
    Iono exists for (`handRefresh` `toBottom`), which shuffles because it moves a
    WHOLE hand and hiding its order is the point.

    Never damages, so it never KOs.

    Hands back the uids ACTUALLY paid, for the §9.2 record: Superior Energy
    Retrieval bars exactly these from the retrieval that follows, and Dendra
    gates its draw on there being any ("if you do"). */
function payFromHandApply(
  state: GameState,
  uids: readonly string[],
  op: Extract<EffectOp, { op: "payFromHand" }>,
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; paid: string[] } {
  const side = state.players[ctx.seat];
  const inHand = new Set(side.hand);
  const paid: string[] = [];
  const spent = new Set<string>();
  for (const uid of uids) {
    if (!inHand.has(uid) || spent.has(uid)) continue;
    spent.add(uid);
    paid.push(uid);
  }
  if (paid.length === 0) return { state, paid };
  events.push({ type: "HAND_COST_PAID", seat: ctx.seat, uids: [...paid], to: op.to });
  const hand = side.hand.filter((uid) => !spent.has(uid));
  return {
    state: withSide(
      state,
      ctx.seat,
      op.to === "deckBottom"
        ? { ...side, hand, deck: [...side.deck, ...paid] }
        : { ...side, hand, discard: [...side.discard, ...paid] },
    ),
    paid,
  };
}

/** The reveal-and-bottom offer (Ortega, Greavard "Underworld Stroll"): the
    opponent's hand filtered by the op, collapsed to ONE representative per
    interchangeable class in hand order — the pick is "a card", so no class can
    ever want a second copy (the payFromHand cap logic at count 1, keyed by
    `cardIdentity` like attachFromDeck because the catalog prints one Basic
    Energy under several ids, and two of those in a hand are one answer wearing
    two uids). Collapsing here leaks nothing: the whole hand just went out in
    HAND_REVEALED, so the offer's shape has no secret left to give away — the
    exact leak that keeps payFromHand's own-hidden-hand offer from doing this. */
function bottomFromOpponentHandOffer(
  state: GameState,
  ctx: EffectContext,
  op: Extract<EffectOp, { op: "bottomFromOpponentHand" }>,
): string[] {
  const hand = state.players[otherSeat(ctx.seat)].hand;
  const kept = new Set<string>();
  const candidates: string[] = [];
  for (const uid of hand) {
    if (op.filter !== undefined && !matchesFilter(cardOf(state, uid), op.filter)) continue;
    const key = cardIdentity(state, uid);
    if (kept.has(key)) continue;
    kept.add(key);
    candidates.push(uid);
  }
  return candidates;
}

/** Move the chosen card out of the OPPONENT's hand onto the bottom of the
    OPPONENT's own deck (appended — payFromHandApply's `deckBottom` placement,
    on the other seat's zones). Wire-safety like every mover in this file: the
    hand is re-read live and only uids actually sitting in it move, so a stale
    or repeated uid drops out rather than duplicating a card. Hands back what
    ACTUALLY moved for the §9.2 record (Ortega's "in this way").

    Emits CARD_TO_BOTTOM_OF_DECK naming the uid — public the whole way (the
    hand was just revealed, the pick made in the open), with `actor` = the
    controller who chose and `seat` = the owner whose zones both are. */
function bottomFromOpponentHandApply(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: string[] } {
  const owner = otherSeat(ctx.seat);
  const side = state.players[owner];
  const inHand = new Set(side.hand);
  const moved: string[] = [];
  const taken = new Set<string>();
  for (const uid of uids) {
    if (!inHand.has(uid) || taken.has(uid)) continue;
    taken.add(uid);
    moved.push(uid);
  }
  if (moved.length === 0) return { state, moved };
  for (const uid of moved) {
    events.push({ type: "CARD_TO_BOTTOM_OF_DECK", seat: owner, uid, actor: ctx.seat });
  }
  return {
    state: withSide(state, owner, {
      ...side,
      hand: side.hand.filter((uid) => !taken.has(uid)),
      deck: [...side.deck, ...moved],
    }),
    moved,
  };
}

/** The pick prompt's printed sentence — the whole clause, since the op IS the
    whole clause (the payFromHandNote rule). Grown one printed form per card
    (the retrieveNoun rule): bare = Ortega's, `supporter` = Greavard's. An
    unphrased future filter gets the bare form's structure with no guessed
    noun — "a card" is never a lie, merely less than the card prints. */
function bottomFromOpponentHandNote(
  op: Extract<EffectOp, { op: "bottomFromOpponentHand" }>,
): string {
  if (op.filter?.kind === "supporter") {
    return "Your opponent reveals their hand. Choose a Supporter card you find there and put it on the bottom of their deck.";
  }
  return "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.";
}

/** The mayDraw prompt speaks to its ANSWERER — the opponent of the seat that
    played the card — so the printed "your opponent may draw a card" turns
    around into the second person, the way it is said across a table. */
function mayDrawNote(op: Extract<EffectOp, { op: "opponentMayDraw" }>): string {
  return op.count === 1 ? "You may draw a card." : `You may draw ${op.count} cards.`;
}

/** The cards in `seat`'s hand that may pay a `payFromHand`, with
    INTERCHANGEABLE copies collapsed to at most `count` representatives each —
    the set the player is actually asked about, and the same set the play gate
    counts.

    `excludeUid` is the printed "**other**" (Ultra Ball's "2 other cards"): the
    Trainer paying the cost is still in hand while the GATE runs, and it may not
    pay for itself. The apply never needs it — playTrainer moves the played card
    to the discard before the program runs — so this is the one place the word
    has to be honoured, which is why it is a parameter here rather than a field
    on the op (see effects.ts).

    ONE collapsed set serves both readers, and that is sound because collapsing
    at cap `count` cannot cross the gate's threshold: if the hand really holds
    `count` matching cards then either one class alone has that many (and
    contributes `count`) or every class survives whole — so `kept >= count` iff
    `actual >= count`. A gate reading raw counts and a prompt reading collapsed
    ones could otherwise offer a pick the player cannot complete. */
function handCostCandidates(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "payFromHand" }>,
  excludeUid?: string,
): string[] {
  const kept = new Map<string, number>();
  const out: string[] = [];
  for (const uid of state.players[seat].hand) {
    if (uid === excludeUid) continue;
    const card = cardOf(state, uid);
    if (op.filter !== undefined && !matchesFilter(card, op.filter)) continue;
    if (op.filter === undefined && card === undefined) continue;
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= op.count) continue;
    kept.set(key, already + 1);
    out.push(uid);
  }
  return out;
}

/** The first top-level `payFromHand` in `program` whose cost the seat
    cannot pay, or null when every one of them can be. The printed "you can use
    this card only if …" / "you must discard … in order to use this Ability"
    gate, checked by BOTH action paths before anything is committed (cardplay.ts)
    — a card whose cost cannot be paid is not played, so the effect it buys never
    resolves for free.

    Deliberately NOT part of `programPlayable`: that function is the ENGINE's
    would-only-whiff heuristic, this is the CARD's own printed rule (the
    `trainerPlayableIf` distinction), and it needs the played uid, which
    `programPlayable` has no way to know. Like `programPlayable` it scans only
    TOP-LEVEL ops — no printed card puts a cost inside a coin or condition gate,
    and a cost that could be skipped by a branch would not be a cost.

    NOT COMPOSITIONAL, and the limit is exactly one cost per program. Each op is
    checked against the SAME starting hand, so a hypothetical program with two
    costs would pass the gate on a hand that can only pay one, and the second
    would then resolve free (the short-hand branch in `stepOp` pays what there
    is). Every printed card in the family charges once — the cost is the price of
    a play, and a play happens once — so this is a scope statement, not a bug;
    folding it would mean deciding which cards the FIRST cost spends before asking
    what the second can still afford, which is only answerable once a card exists
    to say what the right answer is. */
export function handCostUnmet(
  state: GameState,
  seat: Seat,
  program: readonly EffectOp[],
  excludeUid?: string,
): Extract<EffectOp, { op: "payFromHand" }> | null {
  for (const op of program) {
    if (op.op !== "payFromHand") continue;
    if (handCostCandidates(state, seat, op, excludeUid).length < op.count) return op;
  }
  return null;
}

/** How a hand cost reads as a printed noun phrase — "2 other cards", "another
    card", "an Energy card", "a Basic Grass Energy card". `other` spells the word
    the TRAINERS carry and the Abilities do not, which is not a stylistic split:
    a Trainer is in the very hand it pays out of, an Ability's card is on the
    board (see effects.ts). Shared by the prompt heading (`other: false` — by then
    the played card has already left the hand, so every offered card IS another
    one) and by both rejection messages (`other` as printed). */
export function handCostPhrase(
  op: Extract<EffectOp, { op: "payFromHand" }>,
  other: boolean,
): string {
  const { singular, plural } =
    op.filter === undefined ? { singular: "a card", plural: "cards" } : retrieveNoun(op.filter);
  if (op.count > 1) return `${op.count} ${other ? "other " : ""}${plural}`;
  // "a card" → "another card"; no printed card pairs `other` with a filter, but
  // the article strip keeps it reading correctly if one ever does.
  return other ? `another ${singular.replace(/^an? /, "")}` : singular;
}

/** The whole printed cost clause — the noun phrase above under the VERB its
    destination prints: "discard 2 other cards from your hand" (Ultra Ball) /
    "put another card from your hand on the bottom of your deck" (Dendra). One
    string for the three readers that must agree on the wording: the park's
    heading, both rejection messages (cardplay.ts) and the HUD's disabled-card
    hint. Lower-case and verb-first, so a caller can say "can only be used if you
    …", "Only if you …" or capitalize it into a sentence of its own. */
export function handCostAction(
  op: Extract<EffectOp, { op: "payFromHand" }>,
  other: boolean,
): string {
  const phrase = handCostPhrase(op, other);
  return op.to === "deckBottom"
    ? `put ${phrase} from your hand on the bottom of your deck`
    : `discard ${phrase} from your hand`;
}

/** The park's heading — the cost clause as an instruction ("Discard a card from
    your hand." / "Put a card from your hand on the bottom of your deck."). The
    played Trainer has already left the hand by the time this is asked, so every
    offered card IS another one and the printed "other" is not repeated here. */
function payFromHandNote(op: Extract<EffectOp, { op: "payFromHand" }>): string {
  const action = handCostAction(op, false);
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}.`;
}

/** Switch the controller's Active with their benched `ref` (§G). The outgoing
    Active loses its Special Conditions (§12 — it left the Active spot). */
function switchOwn(state: GameState, ref: PokemonRef, ctx: EffectContext, events: GameEvent[]): GameState {
  return switchInto(state, ctx.seat, ref, events);
}

/** Gust: switch the OPPONENT's Active with their benched `ref` (Boss's Orders). */
function gust(state: GameState, ref: PokemonRef, ctx: EffectContext, events: GameEvent[]): GameState {
  return switchInto(state, otherSeat(ctx.seat), ref, events);
}

/** The shared switch move for `seat`'s board: `ref` (a bench index on that
    board) becomes Active; the old Active goes to the bench with its Special
    Conditions cleared. The bench stays dense (the promoted slot closes up, the
    retreater lands at the end) — the same compaction retreat uses. Exported for
    Jet Energy's on-attach switch (turn.ts attachEnergy). */
export function switchInto(
  state: GameState,
  seat: Seat,
  ref: PokemonRef,
  events: GameEvent[],
): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (ref.spot.spot !== "bench" || active === null) return state;
  const index = ref.spot.index;
  const incoming = side.bench[index];
  if (incoming === undefined) return state;
  const wasActive = topUid(active);
  const nowActive = topUid(incoming);
  if (wasActive === undefined || nowActive === undefined) return state;
  const cleared = presentStatuses(active.conditions);
  const benched = { ...active, conditions: noConditions() };
  const bench = [...side.bench.slice(0, index), ...side.bench.slice(index + 1), benched];
  events.push({
    type: "POKEMON_SWITCHED",
    seat,
    wasActive,
    nowActive,
    fromBench: index,
    toBench: bench.length - 1,
  });
  if (cleared.length > 0) {
    events.push({ type: "STATUS_CLEARED", seat, uid: wasActive, statuses: cleared, reason: "benched" });
  }
  return withSide(state, seat, { ...side, active: incoming, bench });
}

/** Heal from the controller's own in-play `ref`: `amount` HP, or all of its
    damage when `amount` is "all" (Potion 30 / Arboliva's Enriching Oil). */
function healChosen(
  state: GameState,
  ref: PokemonRef,
  amount: number | "all",
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (ref.seat !== ctx.seat) return state;
  const side = state.players[ctx.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (pokemon === undefined || pokemon === null) return state;
  const uid = topUid(pokemon);
  if (uid === undefined) return state;
  const healed = amount === "all" ? pokemon.damage : Math.min(amount, pokemon.damage);
  if (healed <= 0) return state;
  events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
  const updated = { ...pokemon, damage: pokemon.damage - healed };
  if (ref.spot.spot === "active") return withActive(state, ctx.seat, updated);
  const bench = side.bench.map((p, i) =>
    i === (ref.spot as { index: number }).index ? updated : p,
  );
  return withSide(state, ctx.seat, { ...side, bench });
}

/** The first Basic Energy uid in `seat`'s `source` zone (hand or discard)
    matching `energyType` (any Basic Energy when undefined) — what
    attachEnergyFrom moves onto a Pokémon. Same-type Basic Energy cards are
    fungible, so the first match is as good as any (no WHICH-card choice).
    Exported for programPlayable (cardplay.ts): an Ability whose attach could only
    whiff can't be activated — the gust/snipe "no legal target" precedent. */
export function firstAttachableEnergy(
  state: GameState,
  seat: Seat,
  source: "hand" | "discard",
  energyType: string | undefined,
): string | undefined {
  const zone = source === "hand" ? state.players[seat].hand : state.players[seat].discard;
  return zone.find((uid) => {
    const card = cardOf(state, uid);
    return (
      card !== undefined &&
      isEnergyCard(card) &&
      card.energyType === "Normal" && // "Normal" = a BASIC energy (Special is a special energy)
      (energyType === undefined || energyProvidesOf(card) === energyType)
    );
  });
}

/** The controller's own in-play Pokémon an ATTACH may target, as refs (Active
    first, then bench in index order), filtered by the printed riders
    (AttachTargetRiders, effects.ts): `targetType` keeps only those whose TOP card
    is that type (Gardevoir's "your {P} Pokémon"), `basicOnly` only Basics
    (Koraidon's), `benchOnly` drops the Active outright (Electric Generator's
    "your Benched {L} Pokémon"), and `notIfKO` drops any whose `bonusCounters`
    would Knock it Out ("you can't use this on a Pokémon that would be Knocked
    Out"), so the placed counters are always non-lethal. No riders → every own
    in-play Pokémon (the base ops' targets).

    ONE rule, two op-shaped readers — `attachEnergyFrom` (hand / discard source)
    and `attachFromTop` (the deck top) — which is why the parameter is the riders
    interface rather than either op type: an eligibility rule that drifted between
    the two would make the same board legal for one attach and not the other.
    Exported for programPlayable too: an attach with no eligible target can't be
    played (the gust/snipe precedent). */
export function attachEnergyTargets(
  state: GameState,
  seat: Seat,
  riders: AttachTargetRiders,
): PokemonRef[] {
  const side = state.players[seat];
  const eligible = (pokemon: InPlayPokemon): boolean => {
    if (riders.targetType !== undefined || riders.basicOnly === true) {
      const card = topCardOf(state, pokemon);
      if (riders.targetType !== undefined && !(card?.types ?? []).includes(riders.targetType)) {
        return false;
      }
      if (riders.basicOnly === true && (card === undefined || !isBasicPokemon(card))) return false;
    }
    if (riders.notIfKO === true && riders.bonusCounters !== undefined) {
      const hp = effectiveMaxHp(state, pokemon);
      if (hp !== null && pokemon.damage + riders.bonusCounters >= hp) return false;
    }
    return true;
  };
  const refs: PokemonRef[] = [];
  if (riders.benchOnly !== true && side.active !== null && eligible(side.active)) {
    refs.push({ seat, spot: { spot: "active" } });
  }
  side.bench.forEach((pokemon, index) => {
    if (eligible(pokemon)) refs.push({ seat, spot: { spot: "bench", index } });
  });
  return refs;
}

/** The printed "this Pokémon" as a (zero- or one-element) target list: the
    controller's in-play Pokémon whose TOP card is `ctx.sourceUid`. A top-card
    uid sits in exactly one spot, so at most one ref comes back — and EMPTY is a
    live answer, not an error, in two honest ways: the context carries no source
    at all (a Trainer program authored with `toSelf` — the field means nothing
    there), or the Pokémon is no longer a board TOP (evolved over, bounced,
    Knocked Out mid-program). Both fall into the op's usual whiff path, where
    the trailing shuffle still runs.

    By TOP uid, not stack membership, deliberately: a card evolved over is no
    longer "this Pokémon" — the body the printed sentence pointed at has a new
    top card, and an attach aimed at it would be the evolution's, not ours. */
function sourceRef(state: GameState, ctx: EffectContext): PokemonRef[] {
  if (ctx.sourceUid === undefined) return [];
  const side = state.players[ctx.seat];
  if (side.active !== null && topUid(side.active) === ctx.sourceUid) {
    return [{ seat: ctx.seat, spot: { spot: "active" } }];
  }
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === ctx.sourceUid);
  return index === -1 ? [] : [{ seat: ctx.seat, spot: { spot: "bench", index } }];
}

/** What an `attachFromTop` op is offering: the cards among the looked-at top `n`
    its filter admits (deck order, top first), the eligible targets, and the
    resolved cap.

    The cap is `min(printed, candidates.length)` for BOTH forms, which is what
    makes `"any"` ("attach any number") just the degenerate case rather than a
    branch: a card cannot be attached twice, so the whole candidate set is the
    real ceiling either way. Clamping the printed number too is what keeps the
    prompt honest — "up to 2" with one Basic {L} in the window is a pick of one,
    and a prompt saying `max: 2` there would have the dialog count "0/2" over a
    single row and invite a pick that does not exist.

    NOTE — this reads the DECK, so it is only ever asked at the moment the op
    runs. It is deliberately NOT a `programPlayable` input; see the op's own
    doc (effects.ts) for why that gate does not exist. */
function attachFromTopOffer(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "attachFromTop" }>,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  const top = state.players[seat].deck.slice(0, Math.max(0, op.n));
  const candidates = top.filter((uid) => matchesFilter(cardOf(state, uid), op.filter));
  return {
    candidates,
    targets: attachEnergyTargets(state, seat, op),
    max: Math.min(op.max === "any" ? candidates.length : op.max, candidates.length),
  };
}

/** What an `attachFromDeck` op is offering: the deck-wide matches for its filter
    (deck order), the eligible targets, and the resolved cap.

    **The collapse is the difference from `attachFromTopOffer`.** That one reads a
    window of `n` cards, so its candidate list is small by construction; this one
    reads the WHOLE deck, where a real list holds a dozen Basic {R} Energy. Twelve
    rows for a pick of three is one question wearing twelve hats, so the offer
    keeps at most `max` representatives per interchangeable class — the D42 rule
    the mandatory discards run on (`interchangeableCandidates`), with the same cap
    logic and for the same reason: a pick can never want more than `max` copies of
    one class, and the copies that survive are still interchangeable with each
    other, so every DISTINGUISHABLE answer remains reachable. Keying is
    `cardIdentity`, which reads a Basic Energy by what it PROVIDES — the catalog
    prints the same Basic Fire Energy under four ids (sve-002/-010/-018 plus
    sv03-230 "Basic Fire Energy", which `energyProvidesOf` reads identically), and
    an id key would offer
    them as three separate answers.

    There is no host to key on here (these cards are in a pile, attached to
    nothing), which is exactly why the discard collapse's `refKeyOf(from)` prefix
    is absent: WHICH Pokémon loses an Energy is always a real choice, but which of
    three identical Energy comes out of the deck never is.

    **THE CAP IS THE BOARD'S AS WELL AS THE PRINT'S**, for `attachFromTop`'s
    reason — "a prompt reading `max: 3` over a single row invites a pick that does
    not exist" — and this op has a SECOND way to be short. Three ceilings, and the
    real one is their minimum:
      • the printed `max` ("up to 2");
      • how many cards are actually there (the clamp attachFromTop already takes);
      • **`targets.length × maxPerTarget`**, which is the one a per-target rule
        introduces. Janine on the ordinary board — one {D} Pokémon — prints "up to
        2" and can legally attach exactly ONE, so a prompt saying 2 would have the
        dialog count "0/2" over a board where 1 is the ceiling, and invite a
        second pick the validator then refuses. Without a per-target rule this
        ceiling does not exist (one Pokémon can take every card), which is why it
        reads as `op.max` when the rider is absent rather than as `targets.length`.

    The board ceiling is taken BEFORE the collapse and the collapse runs at that
    cap, so the offer holds no representative the pick could not use: a pick that
    can only want one card is shown one row. The candidate clamp is then taken
    after, so it counts offered rows.

    NOTE — this reads the DECK, so it is only ever asked at the moment the op
    runs, and is deliberately NOT a `programPlayable` input (see the op's doc). */
function attachFromDeckOffer(
  state: GameState,
  ctx: EffectContext,
  op: Extract<EffectOp, { op: "attachFromDeck" }>,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  const seat = ctx.seat;
  const targets =
    op.toSelf === true ? sourceRef(state, ctx) : attachEnergyTargets(state, seat, op);
  const cap =
    op.maxPerTarget === undefined ? op.max : Math.min(op.max, targets.length * op.maxPerTarget);
  const matches = state.players[seat].deck.filter((uid) =>
    matchesFilter(cardOf(state, uid), op.filter),
  );
  const kept = new Map<string, number>();
  const candidates: string[] = [];
  for (const uid of matches) {
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= cap) continue;
    kept.set(key, already + 1);
    candidates.push(uid);
  }
  return { candidates, targets, max: Math.min(cap, candidates.length) };
}

/** Apply a deck-search attach (Charizard ex "Infernal Reign" / Janine's Secret
    Art): move each assigned card out of the deck onto the Pokémon it was assigned
    to, and hand back the uids that ACTUALLY moved (§9.2 — the record).

    **`validateChoice` is the ONE gate** on what may be attached — the cap, the
    per-target cap, that every uid was offered, that no uid appears twice, and
    that every destination is an offered target. This function re-derives none of
    it, for `attachFromTopApply`'s reason: two readers of one rule drift. What it
    does carry is the same wire-safety every mover in this file carries — the DECK
    is re-read live and only uids actually sitting in it move, so a stale uid, a
    repeated one, or a target that is not on the board is SKIPPED rather than
    conjured. Dropping the bench-index check would silently DESTROY a card: the
    `bench.map` no-ops, the event fires, and the uid still leaves the deck.

    Each attach emits its own ENERGY_ATTACHED — the card lands face up on the
    board, so nothing else has to announce it, and in particular there is no
    "searched" event: what a search *found* is the controller's private business
    (they saw their own deck), and what it *took* is public through this. The
    target rides the event REBUILT field by field, never spread off the client's
    ref (the §2 copy contract).

    The deck keeps its order minus the taken cards; the trailing `shuffleDeck` op
    is what scrambles it, so a search that takes nothing still leaves the printed
    shuffle to the op that prints it. Never damages, so it never KOs and never
    touches the flow tail.

    Takes no `op`, unlike its from-the-top twin: with the cap, the filter, the
    window and the leftovers all belonging to somebody else, the assignments and
    the live deck are the whole input. */
function attachFromDeckApply(
  state: GameState,
  assignments: readonly { uid: string; to: PokemonRef }[],
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; attached: string[] } {
  const side = state.players[ctx.seat];
  const inDeck = new Set(side.deck);
  let active = side.active;
  let bench = side.bench;
  const attached = new Set<string>();
  for (const { uid, to } of assignments) {
    if (!inDeck.has(uid) || attached.has(uid) || to.seat !== ctx.seat) continue;
    if (to.spot.spot === "active") {
      if (active === null) continue;
      active = { ...active, energy: [...active.energy, uid] };
    } else {
      const index = to.spot.index;
      if (bench[index] === undefined) continue;
      bench = bench.map((p, i) => (i === index ? { ...p, energy: [...p.energy, uid] } : p));
    }
    attached.add(uid);
    events.push({
      type: "ENERGY_ATTACHED",
      seat: ctx.seat,
      uid,
      target:
        to.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: to.spot.index },
    });
  }
  if (attached.size === 0) return { state, attached: [] };
  return {
    state: withSide(state, ctx.seat, {
      ...side,
      active,
      bench,
      deck: side.deck.filter((uid) => !attached.has(uid)),
    }),
    attached: [...attached],
  };
}

/** Attach the first matching Basic Energy from `op.source` (hand/discard) onto
    the chosen own Pokémon `ref` (§6 energy acceleration). Re-finds the energy at
    apply time — fungible, so the parked decision was only the TARGET. Moves the
    card OUT of its source zone and onto the Pokémon's energy, emitting
    ENERGY_ATTACHED (its host resolves by the energy uid, robust to any same-batch
    move). This is not the §6.3 one-per-turn manual attach — no allowance is
    touched; it is the Ability's own effect. The `bonusCounters` rider then puts
    that many HP of damage counters on the same Pokémon (Gardevoir's 2) — always
    non-lethal, because attachEnergyTargets already excluded would-be-KO'd targets
    (notIfKO), so this op never KOs and never touches the flow tail. */
function attachEnergyFrom(
  state: GameState,
  op: Extract<EffectOp, { op: "attachEnergyFrom" }>,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (ref.seat !== ctx.seat) return state;
  const energyUid = firstAttachableEnergy(state, ctx.seat, op.source, op.energyType);
  if (energyUid === undefined) return state;
  const side = state.players[ctx.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (pokemon === undefined || pokemon === null) return state;
  const targetUid = topUid(pokemon);
  if (targetUid === undefined) return state;
  let updated: InPlayPokemon = { ...pokemon, energy: [...pokemon.energy, energyUid] };
  // Remove the Energy from its source zone (hand or the public discard pile).
  const base: PlayerSide =
    op.source === "hand"
      ? { ...side, hand: without(side.hand, energyUid) }
      : { ...side, discard: without(side.discard, energyUid) };
  events.push({ type: "ENERGY_ATTACHED", seat: ctx.seat, uid: energyUid, target: { ...ref.spot } });
  if (op.bonusCounters !== undefined && op.bonusCounters > 0) {
    updated = { ...updated, damage: updated.damage + op.bonusCounters };
    events.push({
      type: "COUNTERS_PLACED",
      seat: ctx.seat,
      uid: targetUid,
      amount: op.bonusCounters,
      source: "ability",
    });
  }
  if (ref.spot.spot === "active") return withSide(state, ctx.seat, { ...base, active: updated });
  const index = (ref.spot as { index: number }).index;
  return withSide(state, ctx.seat, {
    ...base,
    bench: side.bench.map((p, i) => (i === index ? updated : p)),
  });
}

/** Apply a from-the-top attach (Electric Generator / Hydreigon "Tri Howl"): move
    each assigned card off the deck TOP onto the Pokémon it was assigned to, then
    settle the leftovers clause.

    **`validateChoice` is the ONE gate** on what may be attached: it alone
    enforces the cap, that every uid was offered (so the filter and the window
    boundary hold), that no uid appears twice, and that every destination is an
    offered target. This function re-derives nothing — duplicating those rules
    here would be two readers that can drift, which is the shape this codebase
    keeps collapsing. What it does carry is wire-safety of the same kind
    searchMove / moveEnergyApply carry: the looked-at WINDOW is re-read off the
    live deck and only uids actually sitting in it move, so a stale uid, a
    repeated one, or a target that is not there is SKIPPED rather than conjured —
    a card is never duplicated, and never lands in neither zone (drop the
    bench-index check and an out-of-range target silently deletes a card: the
    `bench.map` no-ops, the event fires, and the uid still leaves the deck). Each
    attach emits its own ENERGY_ATTACHED, the same event the hand/discard attach
    uses: the card lands face up on the board, so nothing else has to announce it.
    The target rides the event REBUILT field by field, never spread off the
    client's ref (the §2 copy contract — see moveEnergyApply).

    The leftovers run LAST and on EVERY path, including the empty ones stepOp
    routes here: `discardRest` (Hydreigon's "Discard the other cards") is a cost
    the card charges whether or not the look found anything to attach, and one
    apply is what keeps a branch from skipping it. `discardRest` absent (Electric
    Generator) leaves the unattached cards exactly where they are — still on top
    of the deck, for the trailing `shuffleDeck` op to scramble.

    Never damages, so it never KOs and never touches the flow tail. */
function attachFromTopApply(
  state: GameState,
  assignments: readonly { uid: string; to: PokemonRef }[],
  op: Extract<EffectOp, { op: "attachFromTop" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const window = side.deck.slice(0, Math.max(0, op.n));
  const inWindow = new Set(window);
  let active = side.active;
  let bench = side.bench;
  const attached = new Set<string>();
  for (const { uid, to } of assignments) {
    if (!inWindow.has(uid) || attached.has(uid) || to.seat !== ctx.seat) continue;
    if (to.spot.spot === "active") {
      if (active === null) continue;
      active = { ...active, energy: [...active.energy, uid] };
    } else {
      const index = to.spot.index;
      if (bench[index] === undefined) continue;
      bench = bench.map((p, i) => (i === index ? { ...p, energy: [...p.energy, uid] } : p));
    }
    attached.add(uid);
    events.push({
      type: "ENERGY_ATTACHED",
      seat: ctx.seat,
      uid,
      target:
        to.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: to.spot.index },
    });
  }
  // Deck order, top first — the order the discard pile gains them (§2).
  const rest = op.discardRest === true ? window.filter((uid) => !attached.has(uid)) : [];
  if (attached.size === 0 && rest.length === 0) return state;
  const removed = new Set([...attached, ...rest]);
  if (rest.length > 0) events.push({ type: "DECK_TOP_DISCARDED", seat: ctx.seat, uids: [...rest] });
  return withSide(state, ctx.seat, {
    ...side,
    active,
    bench,
    deck: side.deck.filter((uid) => !removed.has(uid)),
    discard: rest.length === 0 ? side.discard : [...side.discard, ...rest],
  });
}

/** Move the chosen Energy `uids` off their source Pokémon onto the controller's
    own `destRef` (Energy Switch / Poppy). validateChoice already proved every uid
    is on ONE source Pokémon distinct from the destination; this re-finds each on
    the live board (wire-safety, like searchMove/retrieveMove) and moves only those
    actually attached to an own in-play Pokémon OTHER than the destination — a stale
    or self-targeting uid is skipped, never duplicated. The Pokémon stay put (no
    bench compaction), so the ENERGY_MOVED `from`/`to` targets are valid against
    the post-state. Atomic: strip then re-attach in one reduction, so an Energy is
    never left detached. */
function moveEnergyApply(
  state: GameState,
  uids: readonly string[],
  destRef: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (uids.length === 0 || destRef.seat !== ctx.seat) return state;
  const side = state.players[ctx.seat];
  const destSpot = destRef.spot;
  const picks = new Set(uids);
  // The one source target the moved Energy came from (validateChoice guarantees a
  // single source) — recorded as the first non-destination Pokémon a pick sits on.
  let from: PokemonTarget | undefined;
  const moved: string[] = [];
  const isDest = (target: PokemonTarget): boolean =>
    destSpot.spot === target.spot &&
    (destSpot.spot === "active" || destSpot.index === (target as { index: number }).index);
  const strip = (pokemon: InPlayPokemon, target: PokemonTarget): InPlayPokemon => {
    if (isDest(target)) return pokemon; // never strip the destination (no self-move)
    const kept = pokemon.energy.filter((uid) => {
      if (picks.has(uid)) {
        moved.push(uid);
        from ??= target;
        return false;
      }
      return true;
    });
    return kept.length === pokemon.energy.length ? pokemon : { ...pokemon, energy: kept };
  };
  const activeStripped = side.active === null ? null : strip(side.active, { spot: "active" });
  const benchStripped = side.bench.map((pokemon, index) => strip(pokemon, { spot: "bench", index }));
  if (moved.length === 0 || from === undefined) return state; // nothing actually moved
  // Re-attach onto the destination, read off the stripped board (the destination
  // was never stripped, so this can't drop a just-moved uid).
  const addTo = (pokemon: InPlayPokemon): InPlayPokemon => ({
    ...pokemon,
    energy: [...pokemon.energy, ...moved],
  });
  let active = activeStripped;
  let bench = benchStripped;
  if (destSpot.spot === "active") {
    if (active === null) return state;
    active = addTo(active);
  } else {
    if (benchStripped[destSpot.index] === undefined) return state;
    bench = benchStripped.map((pokemon, index) =>
      index === destSpot.index ? addTo(pokemon) : pokemon,
    );
  }
  // The destination is REBUILT field by field, never spread off `destSpot` — that
  // object came from the WIRE. `validateChoice` proves it `refEquals` an offered
  // ref, but refEquals compares only seat/spot/index, so any extra key a client
  // hangs on it (`{spot:"active", index:99, evil:"…"}`) rides the spread straight
  // into an event that is handed to the animator, the log and, in P4, broadcast to
  // both players. The state was always safe (the extra keys are inert); the EVENT
  // is the §2 copy contract, and a copy of attacker-controlled data is not a copy
  // of the engine's own value.
  const to: PokemonTarget =
    destSpot.spot === "active" ? { spot: "active" } : { spot: "bench", index: destSpot.index };
  events.push({ type: "ENERGY_MOVED", seat: ctx.seat, uids: [...moved], from, to });
  return withSide(state, ctx.seat, { ...side, active, bench });
}

/** Discard the chosen Energy `uids` off the VICTIM's Pokémon into the VICTIM's
    discard pile — the cards are the host owner's, so they go to that owner's own
    pile (the §8.1 KO cleanup rule, applied to a single Energy). The victim is the
    opponent for the hammer arms and the CONTROLLER for `yourActive` (the §8
    self-discard cost), which is exactly why the pile is read off `op` rather than
    hardcoded to the opponent. validateChoice already proved every uid was offered
    and that no Pokémon gives up two; this re-finds each on the live board
    (wire-safety, like moveEnergyApply) and takes only those actually attached, so
    a stale uid is skipped rather than conjured. Emits ONE event per affected
    Pokémon (Giacomo hits several), in board order — the Pokémon stay put (no
    bench compaction), so each `from` target resolves against the post-state.
    Never damages, so it never KOs. */
function discardEnergyApply(
  state: GameState,
  uids: readonly string[],
  op: Extract<EffectOp, { op: "discardEnergy" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (uids.length === 0) return state;
  const victim = discardVictimSeat(ctx.seat, op);
  const side = state.players[victim];
  const picks = new Set(uids);
  // Per affected Pokémon: the spot it sits on and what came off it. Collected in
  // one pass so the events read Active-then-bench, the board's own order.
  // `host` is captured HERE, off the pre-strip stack: an attack can take Energy
  // off a defender its own damage Knocked Out, and by the time the batch renders
  // that slot is empty — so the event names the Pokémon by uid, not by spot.
  const pulled: { target: PokemonTarget; host: string; uids: string[] }[] = [];
  const strip = (pokemon: InPlayPokemon, target: PokemonTarget): InPlayPokemon => {
    const taken: string[] = [];
    const kept = pokemon.energy.filter((uid) => {
      if (!picks.has(uid)) return true;
      taken.push(uid);
      return false;
    });
    if (taken.length === 0) return pokemon;
    pulled.push({ target, host: topUid(pokemon) ?? "", uids: taken });
    return { ...pokemon, energy: kept };
  };
  const active = side.active === null ? null : strip(side.active, { spot: "active" });
  const bench = side.bench.map((pokemon, index) => strip(pokemon, { spot: "bench", index }));
  if (pulled.length === 0) return state; // nothing was actually attached
  const discarded: string[] = [];
  for (const entry of pulled) {
    discarded.push(...entry.uids);
    events.push({
      type: "ENERGY_DISCARDED",
      seat: victim,
      actor: ctx.seat,
      uids: [...entry.uids],
      from: { ...entry.target },
      host: entry.host,
    });
  }
  return withSide(state, victim, {
    ...side,
    active,
    bench,
    discard: [...side.discard, ...discarded],
  });
}

// ── Candidate builders + small shared helpers ──

/** The in-play Energy on `seat`'s board that `filter` admits, each paired with
    the Pokémon it currently sits on — Active first, then bench in index order.
    `activeOnly` keeps just the Active (the discardEnergy `opponentActive` arm).
    Shared by the two Energy-picking ops: moveEnergy's movable set (the
    controller's own board) and discardEnergy's discardable set — the opponent's
    board for the hammer arms, the controller's OWN Active for `yourActive`. */
function attachedEnergies(
  state: GameState,
  seat: Seat,
  filter: CardFilter,
  scope: "all" | "active" | "bench" = "all",
): { uid: string; from: PokemonRef }[] {
  const side = state.players[seat];
  const out: { uid: string; from: PokemonRef }[] = [];
  const collect = (pokemon: InPlayPokemon, from: PokemonRef) => {
    for (const uid of pokemon.energy) {
      if (matchesAttached(state, pokemon, uid, filter)) out.push({ uid, from });
    }
  };
  if (side.active !== null && scope !== "bench") {
    collect(side.active, { seat, spot: { spot: "active" } });
  }
  if (scope === "active") return out;
  side.bench.forEach((pokemon, index) => collect(pokemon, { seat, spot: { spot: "bench", index } }));
  return out;
}

/** Does the Energy `uid`, ATTACHED TO `pokemon`, match `filter`? The in-play
    counterpart of `matchesFilter`, and the only place `providesEnergy` can be
    answered: what an Energy provides is a property of the card ON ITS HOST (§6.3
    — Luminous provides every type alone and only {C} beside another Special
    Energy), so the card alone cannot decide it. Every other filter kind is a
    pure card predicate and defers to `matchesFilter` unchanged. */
function matchesAttached(
  state: GameState,
  pokemon: InPlayPokemon,
  uid: string,
  filter: CardFilter,
): boolean {
  if (filter.kind === "providesEnergy") {
    return providesEnergyType(state, pokemon, uid, filter.energyType);
  }
  return matchesFilter(cardOf(state, uid), filter);
}

/** The board a `discardEnergy` op takes Energy OFF: the controller's own for
    `yourActive` (the §8 self-discard attack cost), the opponent's for the three
    hammer arms. One helper so the candidate scan and the apply can never
    disagree about whose Pokémon is stripped and whose discard pile it lands in. */
function discardVictimSeat(seat: Seat, op: Extract<EffectOp, { op: "discardEnergy" }>): Seat {
  return op.from === "yourActive" ? seat : otherSeat(seat);
}

/** The Energy a `discardEnergy` op may take, in board order — the two `…Active`
    arms see only that Active, the other two the whole victim board. Exported for
    programPlayable: a top-level discard with nothing to take can only whiff (the
    gust / moveEnergy precedent). */
export function discardableEnergies(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "discardEnergy" }>,
): { uid: string; from: PokemonRef }[] {
  const activeOnly = op.from === "opponentActive" || op.from === "yourActive";
  return attachedEnergies(state, discardVictimSeat(seat, op), op.filter, activeOnly ? "active" : "all");
}

/** What a card IS, for the purpose of "would taking this one rather than that
    one make any difference?" — the interchangeability key behind both mandatory
    discards: `interchangeableCandidates` (Energy attached to the board, keyed
    together with its HOST) and `handCostCandidates` (cards in hand, where there
    is no host and this key is the whole story).

    A **Basic** Energy has no identity beyond the type it provides: the
    catalog prints the very same Basic Fire Energy under several ids (sve-002 /
    sve-010 / sve-018, identical in every field that matters), so keying on the id
    would treat three interchangeable Fire Energy in one real deck as three
    separate answers. This is exactly the fungibility `attachEnergyFrom` already
    asserts ("same-type Basic Energy is fungible, so the only decision is the
    TARGET"), read from the other end.

    Everything else keys on the catalog **id**: two Special Energy prints carry
    different rules text, so only two copies of the SAME print are interchangeable.
    The `basic:` / `card:` prefixes keep the two spaces apart, so a Basic Fire and
    a Special Energy that happens to provide {R} never collapse into each other.
    A uid with no catalog card gets a key of its own — park and ask rather than
    guess. (Unreachable today: `attachedEnergies` filters through
    `matchesAttached`, whose card-only arm rejects an unresolvable card and whose
    `providesEnergy` arm reads that card's provision, so no such uid can enter the
    candidate list. Kept because the fallback costs nothing and the alternative is
    a silent collapse of things this function cannot actually compare. The hand
    reader can reach it: an unresolvable uid there is filtered out before the key
    is taken, so this stays the belt to that braces.) */
function cardIdentity(state: GameState, uid: string): string {
  const card = cardOf(state, uid);
  if (card === undefined) return `?${uid}`;
  return isEnergyCard(card) && card.energyType === "Normal"
    ? `basic:${energyProvidesOf(card)}`
    : `card:${card.id}`;
}

/** The discardable Energy with INTERCHANGEABLE candidates collapsed to at most
    `cap` representatives each, board order preserved — the set the player is
    actually asked about.

    Two candidates are interchangeable when they are the same Energy (above) on
    the same Pokémon: discarding either leaves the identical board and puts an
    identical card in the identical owner's discard pile, so offering both is one
    question wearing two hats. WHICH POKÉMON loses the Energy is ALWAYS a real
    choice, so the key includes the host: two identical Basic Energy on two
    different Pokémon stay two candidates.

    `cap` is how many the pick could possibly want from one class — 1 for the
    single-Energy arms, N for an exact-N discard. Keeping N rather than 1 is what
    makes "Discard 3 Energy" off three identical {F} + one {W} answerable at all
    (collapsing to one {F} would leave two candidates for a three-card pick); the
    surviving copies within a class are still interchangeable with each other, so
    the DISTINGUISHABLE answers are the ways to split the count across classes.

    Collapsing here rather than at the park is what makes Houndoom's "Fire Blast"
    with three {R} attached resolve with no prompt at all: one representative
    remains, and the forced-pick rule below sees an offer no bigger than the
    count. */
function interchangeableCandidates(
  state: GameState,
  discardable: readonly { uid: string; from: PokemonRef }[],
  cap: number,
): { uid: string; from: PokemonRef }[] {
  const kept = new Map<string, number>();
  const out: { uid: string; from: PokemonRef }[] = [];
  for (const candidate of discardable) {
    const key = `${refKeyOf(candidate.from)}|${cardIdentity(state, candidate.uid)}`;
    const already = kept.get(key) ?? 0;
    if (already >= cap) continue;
    kept.set(key, already + 1);
    out.push(candidate);
  }
  return out;
}

/** The picks a discardEnergy makes with NO choice left in it (the M1 doctrine),
    or null when the player must decide. Runs over the COLLAPSED candidate set
    above, so "as many candidates as the count" already means "as many
    DISTINGUISHABLE ones".
    "total": the offer holds no more than the count — every candidate comes off,
    which covers both the exact fit (one candidate for "an Energy"; three for
    Koraidon's "Discard 3") and the SHORT board, where "do as much as you can"
    takes everything there is and asks nothing.
    "each": every affected Pokémon has exactly one — the common Giacomo board,
    where "one Special Energy off each" names itself. */
function forcedDiscards(
  discardable: readonly { uid: string; from: PokemonRef }[],
  scope: DiscardScope,
): string[] | null {
  if (scope.kind === "total") {
    return discardable.length <= scope.count ? discardable.map((d) => d.uid) : null;
  }
  const perSource = new Map<string, string[]>();
  for (const { uid, from } of discardable) {
    const key = refKeyOf(from);
    const bucket = perSource.get(key);
    if (bucket === undefined) perSource.set(key, [uid]);
    else bucket.push(uid);
  }
  const picks: string[] = [];
  for (const bucket of perSource.values()) {
    const only = bucket[0];
    if (bucket.length !== 1 || only === undefined) return null; // a real choice
    picks.push(only);
  }
  return picks;
}

/** A stable key for grouping/comparing refs inside the interpreter (cardplay.ts
    has its own copy for wire validation — the two never share a value). */
function refKeyOf(ref: PokemonRef): string {
  return `${ref.seat}:${ref.spot.spot}:${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
}

/** A moveEnergy op does something iff the controller has ≥1 Energy the filter
    admits AND ≥2 of their own Pokémon in play (a source WITH a distinct
    destination). Exported for programPlayable: a play that could only whiff can't
    be made (the gust / attachEnergyFrom precedent). */
export function moveEnergyPlayable(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "moveEnergy" }>,
): boolean {
  const { movable, destinations, needed } = moveEndpoints(state, seat, op);
  return op.max > 0 && movable.length > 0 && destinations.length >= needed;
}

/** What a `moveEnergy` op can take, where it can put it, and how many
    destinations that route needs to be worth asking about — ONE rule with two
    readers (the op's own no-op test and the `programPlayable` gate above), for
    the same reason the filter reads provision through one helper: the play gate
    and the play itself disagreeing is how a card becomes playable and then does
    nothing, or is refused while a legal move existed.

    The free route (Energy Switch / Poppy) takes from anywhere and needs TWO
    Pokémon in play, because the source is also a candidate destination and a
    Pokémon may not move Energy onto itself. `benchToActive` (Armarouge) takes
    from the bench alone and its sole destination is the Active, so source and
    destination are disjoint by construction and ONE destination is enough — a
    bench source already had to exist for `movable` to be non-empty.

    A vacant Active makes `destinations` empty and the route a no-op. That state
    is not reachable through the action API today (the Active spot is only empty
    during a `ko:promote` park, where `turnGate` refuses `useAbility` and
    `playTrainer` outright), which is why it is asserted here rather than tested
    from a board — but it is asserted in exactly one place now, so it cannot rot
    in two of three copies. */
function moveEndpoints(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "moveEnergy" }>,
): { movable: { uid: string; from: PokemonRef }[]; destinations: PokemonRef[]; needed: number } {
  const benchToActive = op.route === "benchToActive";
  const active = state.players[seat].active;
  return {
    movable: attachedEnergies(state, seat, op.filter, benchToActive ? "bench" : "all"),
    destinations: benchToActive
      ? active === null
        ? []
        : [{ seat, spot: { spot: "active" } }]
      : ownInPlayRefs(state, seat),
    needed: benchToActive ? 1 : 2,
  };
}

/** A discardEnergy op does something iff the victim's board (or, for the two
    `…Active` arms, that Active) holds ≥1 Energy the filter admits. Exported
    for programPlayable — a play that could only whiff can't be made, so Giacomo
    into a board with no Special Energy is rejected rather than burning the turn's
    one Supporter (§7.2). Crushing Hammer is covered too: programPlayable descends
    into a `coinFlipGate`'s heads branch, since a coin gate has no `otherwise` and
    the flip is procedure rather than effect (see cardplay.ts). */
export function discardEnergyPlayable(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "discardEnergy" }>,
): boolean {
  return discardableEnergies(state, seat, op).length > 0;
}

function ownBenchRefs(state: GameState, seat: Seat): PokemonRef[] {
  return state.players[seat].bench.map((_, index) => ({ seat, spot: { spot: "bench", index } }));
}

function oppBenchRefs(state: GameState, seat: Seat): PokemonRef[] {
  const opp = otherSeat(seat);
  return state.players[opp].bench.map((_, index) => ({ seat: opp, spot: { spot: "bench", index } }));
}

/** Every in-play Pokémon the controller could heal — Active first, then bench. */
function ownInPlayRefs(state: GameState, seat: Seat): PokemonRef[] {
  const refs: PokemonRef[] = [];
  if (state.players[seat].active !== null) refs.push({ seat, spot: { spot: "active" } });
  for (let index = 0; index < state.players[seat].bench.length; index++) {
    refs.push({ seat, spot: { spot: "bench", index } });
  }
  return refs;
}

function benchSpace(state: GameState, seat: Seat): number {
  return BENCH_MAX - state.players[seat].bench.length;
}

function cardOf(state: GameState, uid: string): Card | undefined {
  const id = state.cardIdByUid[uid];
  return id === undefined ? undefined : state.cardPool[id];
}

function matchesFilter(card: Card | undefined, filter: CardFilter): boolean {
  if (card === undefined) return false;
  switch (filter.kind) {
    case "basicPokemon":
      return isBasicPokemon(card);
    case "anyPokemon":
      return card.category === "Pokemon";
    case "basicEnergy":
      return (
        isEnergyCard(card) &&
        card.energyType === "Normal" &&
        (filter.energyType === undefined || energyProvidesOf(card) === filter.energyType)
      );
    case "byName":
      return card.name === filter.name;
    case "supporter":
      return card.category === "Trainer" && card.trainerType === "Supporter";
    case "pokemonOrBasicEnergy":
      // A basic Energy is `energyType: "Normal"` (Special is excluded, matching
      // Super Rod's "Basic Energy"); a Pokémon is any category "Pokemon".
      return card.category === "Pokemon" || (isEnergyCard(card) && card.energyType === "Normal");
    case "anyEnergy":
      // Any Energy card — Basic OR Special (Poppy moves "up to 2 Energy").
      return isEnergyCard(card);
    case "specialEnergy":
      // A SPECIAL Energy only (Giacomo / Mawile) — the exact complement of
      // `basicEnergy` inside `anyEnergy`, off the catalog's own tag.
      return isSpecialEnergy(card);
    case "providesEnergy":
      // FALSE, always — and deliberately, not as a gap. This function scans
      // cards in a DECK, HAND or DISCARD PILE (searchDeck / lookAtTopN /
      // discardPileRetrieval), and provision is a while-ATTACHED property ("As
      // long as this card is attached to a Pokémon, it provides…"): a card in a
      // pile is attached to nothing and provides nothing. The in-play scanner
      // `matchesAttached` is where this filter is answered, with the host it
      // needs. So authoring `providesEnergy` into a pile-scanning op yields an
      // empty candidate set — a loud no-op, never a wrong card — where guessing
      // "a Basic Energy of that type" would silently take the wrong print
      // (Decidueye's "Basic {G} Energy card from your hand" is the row that
      // really wants `basicEnergy`, and it says CARD for exactly this reason).
      return false;
  }
}

/** The chooseCards note for a deck search — the printed "Search your deck for
    [up to N] {noun} [onto your Bench | into your hand]".

    Reads its noun off the SHARED `retrieveNoun` table, like the retrieval and
    look-at-top notes beside it. It used to carry a second, hand-rolled table that
    spelled only the SINGULAR, so the plural branch prefixed a count onto an
    ARTICLE: "Search your deck for up to 2 **a Basic Water Energy** into your
    hand."

    That was a LIVE bug on a SHIPPED card, not a latent one this slice tripped:
    **Chien-Pao ex "Shivery Chill"** (four catalog prints) is a `basicEnergy`
    search at max 2 and has read that way since it was authored. It survived
    because no test asserted any search note at all — the plural branch's only
    other reader is `byName` (Flamigo's "up to 3 Flamigo"), which reads correctly
    because that noun carries no article. Both forms are pinned by tests now. */
function searchNote(filter: CardFilter, dest: "bench" | "hand", max: number): string {
  const { singular, plural } = retrieveNoun(filter);
  const where = dest === "bench" ? "onto your Bench" : "into your hand";
  return max > 1
    ? `Search your deck for up to ${max} ${plural} ${where}.`
    : `Search your deck for ${singular} ${where}.`;
}

/** The chooseCards note for a discard-pile retrieval — reproduces the printed
    verb ("Put" into hand / "Shuffle" into deck) and a noun that reads like the
    card text (Energy Retrieval / Pal Pad / Super Rod). Every retrieval Item in
    scope has max ≥ 2, so the plural is what ships; the singular fallback stays
    total. Nouns are spelled per kind rather than "+s" so "Pokémon" stays
    invariant.

    `excluded` reproduces Superior Energy Retrieval's printed parenthetical. The
    player WATCHES the two cards they paid land in the public discard pile (the
    playmat renders it) and is then handed an offer those two are missing from —
    so without this the dialog silently contradicts what the board shows. The
    card answers it in so many words, and the engine already knows the answer. */
function retrieveNote(
  filter: CardFilter,
  dest: "hand" | "deck",
  max: number,
  excluded: boolean,
): string {
  const { singular, plural } = retrieveNoun(filter);
  const verb = dest === "hand" ? "Put" : "Shuffle";
  const where = dest === "hand" ? "into your hand" : "into your deck";
  const note =
    max > 1
      ? `${verb} up to ${max} ${plural} from your discard pile ${where}.`
      : `${verb} ${singular} from your discard pile ${where}.`;
  return excluded
    ? `${note} (You can't choose a card you discarded with the effect of this card.)`
    : note;
}

/** The chooseCards note for a lookAtTopN (Great Ball / Pokégear 3.0) —
    reproduces the printed "Look at the top N cards … and put a {noun} into your
    hand." Both cards in scope take at most 1 (the singular), but the plural stays
    total for a future look-at-top that takes several. Reuses retrieveNoun for the
    filter's noun phrase (anyPokemon → "a Pokémon"; supporter → "a Supporter card"). */
function lookNote(filter: CardFilter, n: number, max: number): string {
  const { singular, plural } = retrieveNoun(filter);
  return max > 1
    ? `Look at the top ${n} cards of your deck and put up to ${max} ${plural} into your hand.`
    : `Look at the top ${n} cards of your deck and put ${singular} into your hand.`;
}

/** The attachCards prompt string (Electric Generator / Hydreigon "Tri Howl") —
    the printed "Look at the top N cards of your deck and attach [up to N | any
    number of] {noun} you find there to your [Benched] [{type}] Pokémon in any way
    you like." Built from the OP, not from any text: Hydreigon's is an Ability,
    whose printed sentence also carries the "Once during your turn, you may" and
    the leftovers clause, neither of which belongs in a prompt asking what to
    attach. The noun comes from retrieveNoun, so it reads as the PRINT the filter
    scans for ("Basic Lightning Energy cards", "Energy cards"), matching the card
    names in the rows below it; the target type spells out in full ("Lightning"),
    the same choice energyNoun makes for the same reason.

    The two clauses kept from the print earn their place: **"you find there"** is
    what tells the player the rows are the window and not the deck at large, and
    **"in any way you like"** is the only cue that both Energy may go on ONE
    Pokémon — the misconception the dialog's shape otherwise invites (§15.E). */
function attachNote(op: Extract<EffectOp, { op: "attachFromTop" }>): string {
  const { plural } = retrieveNoun(op.filter);
  const how = op.max === "any" ? "any number of" : `up to ${op.max}`;
  const where = `${op.benchOnly === true ? "Benched " : ""}${
    op.targetType === undefined ? "" : `${op.targetType} `
  }Pokémon`;
  return `Look at the top ${op.n} cards of your deck and attach ${how} ${plural} you find there to your ${where} in any way you like.`;
}

/** The attachCards prompt string for a deck SEARCH (Charizard ex "Infernal
    Reign" / Janine's Secret Art) — the printed "Search your deck for up to N
    {noun} and attach [them|it] to your [{type}] Pokémon [in any way you like]".

    Built from the OP, like `attachNote`: both consumers print more around this
    clause than belongs in a prompt asking what to attach (Charizard's is a
    triggered Ability whose sentence opens "When you play this Pokémon…", and both
    end in "Then, shuffle your deck", which is the NEXT op's business).

    The wordings this switches between are the printed ones. `toSelf` is the
    printed "attach it to **this Pokémon**" (Pawmot "Electrogenesis") — kept
    verbatim, because the offered target row alone cannot say that the CHOICE of
    destination is not one. Otherwise the difference is exactly `maxPerTarget`:
      • absent → "**in any way you like**", the only cue that several Energy may
        go on ONE Pokémon (§15.E — the misconception the dialog's shape invites);
      • present → the phrase is a lie, so it is dropped and replaced by what
        Janine actually prints — "for each of those Pokémon", one apiece. Saying
        "in any way you like" over a prompt that rejects two on one Pokémon would
        be the dialog contradicting the validator. */
function attachFromDeckNote(op: Extract<EffectOp, { op: "attachFromDeck" }>): string {
  const { singular, plural } = retrieveNoun(op.filter);
  if (op.toSelf === true) {
    return op.max > 1
      ? `Search your deck for up to ${op.max} ${plural} and attach them to this Pokémon.`
      : `Search your deck for ${singular} and attach it to this Pokémon.`;
  }
  const where = `${op.benchOnly === true ? "Benched " : ""}${
    op.targetType === undefined ? "" : `${op.targetType} `
  }Pokémon`;
  if (op.maxPerTarget !== undefined) {
    // "attach 1 to each", not "attach a Basic Darkness Energy card to each" —
    // the noun is already in the first clause, and repeating it there produced a
    // sentence long enough that the per-target rule stopped being the thing the
    // reader noticed, which is the one thing this branch exists to say.
    const each = op.maxPerTarget === 1 ? "1" : `up to ${op.maxPerTarget}`;
    return `Search your deck for up to ${op.max} ${plural} and attach ${each} to each of up to ${op.max} of your ${where}.`;
  }
  return op.max > 1
    ? `Search your deck for up to ${op.max} ${plural} and attach them to your ${where} in any way you like.`
    : `Search your deck for ${singular} and attach it to your ${where}.`;
}

/** The moveEnergy prompt string (Energy Switch / Poppy) — the printed "Move [up
    to N] {noun} from 1 of your Pokémon to another of your Pokémon". Only the two
    filters those cards use are spelled (Basic Energy / Energy); a future filter
    falls back to the generic "Energy". */
function moveNote(op: Extract<EffectOp, { op: "moveEnergy" }>): string {
  const noun =
    op.filter.kind === "basicEnergy"
      ? `Basic ${op.filter.energyType === undefined ? "" : `${op.filter.energyType} `}Energy`
      : energyNoun(op.filter);
  const where =
    op.route === "benchToActive"
      ? "from 1 of your Benched Pokémon to your Active Pokémon"
      : "from 1 of your Pokémon to another of your Pokémon";
  // "an Energy", "a Basic Energy", "a Fire Energy" — the article follows the noun,
  // the same rule discardNote applies. Unreachable at max 1 today (the only
  // `anyEnergy` mover is Poppy at max 2, which takes the "up to" branch), which is
  // precisely why it read "Move a Energy" unnoticed.
  const article = noun === "Energy" ? "an" : "a";
  return op.max > 1 ? `Move up to ${op.max} ${noun} ${where}.` : `Move ${article} ${noun} ${where}.`;
}

/** How a filter's Energy reads inside a prompt sentence. Only the filters the
    energy ops actually carry are spelled; anything else stays the generic
    "Energy".

    A TYPED one reads as its full type name ("a Fire Energy"), not the printed
    brace code ("a {R} Energy"), even though two of the five cards in the family
    print the code. The note is built from the OP, not from any text — Armarouge's
    is an authored Ability with no printed attack sentence at all — and the rows
    the player then clicks are card NAMES ("Fire Energy"), so the heading and the
    offer speak one vocabulary. */
function energyNoun(filter: CardFilter): string {
  if (filter.kind === "specialEnergy") return "Special Energy";
  if (filter.kind === "providesEnergy") return `${filter.energyType} Energy`;
  return "Energy";
}

/** The discardEnergy prompt string — reproduced from the printed sentence, so
    the dialog's heading IS the card's own instruction (Crushing Hammer "…from 1
    of your opponent's Pokémon", Giacomo "…from each of…", Mawile "…from your
    opponent's Active Pokémon", Corviknight "Discard 2 Energy from this Pokémon").
    Only the two filters those cards use are spelled; any other reads as the
    generic "an Energy". `count: "all"` never reaches here — that arm asks
    nothing, so it has no prompt to caption. */
function discardNote(op: Extract<EffectOp, { op: "discardEnergy" }>): string {
  const noun = energyNoun(op.filter);
  // A numeric count is printed as the bare number ("Discard 2 Energy…"), where
  // one is printed as the article ("Discard an Energy…").
  const what =
    typeof op.count === "number" && op.count > 1
      ? `${op.count} ${noun}`
      : `${noun === "Energy" ? "an" : "a"} ${noun}`;
  switch (op.from) {
    case "opponentActive":
      return `Discard ${what} from your opponent's Active Pokémon.`;
    case "opponentChosen":
      return `Discard ${what} from 1 of your opponent's Pokémon.`;
    case "opponentEach":
      return `Discard ${what} from each of your opponent's Pokémon.`;
    case "yourActive":
      // The printed attack sentence verbatim — "this Pokémon" is the Active (§8).
      return `Discard ${what} from this Pokémon.`;
  }
}

/** The noun phrase (singular / plural) each filter reads as in a retrieval note. */
function retrieveNoun(filter: CardFilter): { singular: string; plural: string } {
  switch (filter.kind) {
    case "anyPokemon":
      return { singular: "a Pokémon", plural: "Pokémon" };
    case "supporter":
      return { singular: "a Supporter card", plural: "Supporter cards" };
    case "pokemonOrBasicEnergy":
      return { singular: "a Pokémon or Basic Energy card", plural: "Pokémon or Basic Energy cards" };
    case "anyEnergy":
      return { singular: "an Energy card", plural: "Energy cards" };
    case "specialEnergy":
      return { singular: "a Special Energy card", plural: "Special Energy cards" };
    case "byName":
      return { singular: filter.name, plural: filter.name };
    case "basicPokemon":
      return { singular: "a Basic Pokémon", plural: "Basic Pokémon" };
    case "basicEnergy": {
      const kind = filter.energyType === undefined ? "Basic" : `Basic ${filter.energyType}`;
      return { singular: `a ${kind} Energy card`, plural: `${kind} Energy cards` };
    }
    case "providesEnergy":
      // Unreachable through a pile-scanning op (matchesFilter rejects this
      // filter there, so such an op offers nothing to caption). Spelled anyway:
      // the phrase is what the note builders below want, and an exhaustive
      // switch that throws would be a worse answer than a correct sentence.
      return {
        singular: `a ${filter.energyType} Energy`,
        plural: `${filter.energyType} Energy`,
      };
  }
}
