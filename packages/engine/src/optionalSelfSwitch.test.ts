import { describe, expect, it } from "vitest";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState } from "./index";
import { applyAction, engineVersion, phaseViewOf, programFor, redactGame } from "./index";
import {
  FIXTURE_POOL,
  TRAINER_OPS_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.323.0 → 0.324.0 — 🆕🆕 D422, THE OPTIONAL SELF-SWITCH: the last unbuilt
// printing of a family D181 opened and D189 half-closed, and the third slice in a
// row whose real finding is that a REFUSAL had outlived its own reason.
//
//   "You may switch this Pokémon with 1 of your Benched Pokémon."
//   — **3 Standard-legal printings** (`censusAttackCorpus.ts`).
//
// 🛑 THE PRICE, AND WHY TWO SLICES GOT IT WRONG. D181 and D189 both refused this
// sentence on a mechanism: *"`switchActive` parks a `choosePokemon`, a prompt shape
// with no `declinable` field, and `parkOrForce` auto-applies at one candidate, so a
// decline has nowhere to live"* — concluding the route was a new prompt key plus a
// decline answer, both PERSISTED, i.e. a `MATCH_RECORD_VERSION` bump. **Every
// factual clause of that was true and the conclusion was wrong**, because it looked
// for the decline in the PICK. It lives one op earlier, in the `confirm` that D186's
// `optional` parks:
//
//   [{ op: "optional", note: effect, then: [{ op: "switchActive" }] }]
//
// ONE anchor, ONE `deriveAttackEffect` arm. No new op, no new field, no new prompt
// kind, no event, no log row, no redaction, no HUD dialog, no persisted shape.
// `parkOrForce` is untouched in either direction: behind a "yes" the pick is the
// same MANDATORY `choosePokemon` the bare sentence has had since D189, still forced
// at one candidate (§4 drives that the ref-less answer is REFUSED there).
//
// ⚠️ AND THE ANSWER WAS ALREADY WRITTEN DOWN. **D227 proved this exact route on the
// MIRROR sentence** — *"You may switch out your opponent's Active Pokémon to the
// Bench. (…)"* → `optional` over `opponentSwitchOut`, in one line — and left a note
// in `optionalDraw.test.ts`'s own `NEAR_MISSES` saying *"the MECHANISM now has a
// producer, so the reason this stays null has changed."* **That note sat unread for
// ~195 decisions** while two other files went on quoting the dead price.
// conventions.md's D413 rule at its sharpest: *a refusal carries its own expiry date
// if it says what it is waiting for* — here the trigger had not merely fired, a
// neighbouring slice had fired it and said so in writing.
//
// ⚠️ THE NAMED BLOCKER HAD ALSO ROTTED UNDERNEATH. `declinable` was RENAMED to
// `upTo?: number` on `choosePokemon` at D359, so *"the prompt has no `declinable`
// field"* had stopped being a GAP and become a TAUTOLOGY — and the guard D189 left
// to watch it (`derivedDrawAndGust.test.ts`) had been unfalsifiable ever since.
// D422 replaced it with one that asserts the shape this arm rides.
// ⚠️ `declinable` is NOT gone from the engine and a successor must not read it that
// way: `choosePokemonMulti` still carries it as a REQUIRED boolean, projected to the
// wire by `redact.ts` and read by both HUDs. D359 renamed ONE member.
//
// ── 🛑🛑 THE MECHANISM THE SENTENCE DOES NOT ADVERTISE: THE EMPTY-BENCH ASK ────
//
// `optional` ALWAYS parks; `switchActive` no-ops silently at zero candidates. So an
// attacker with an EMPTY Bench is asked *"You may switch this Pokémon…?"*, answers
// YES, and nothing happens. **D422 ACCEPTS THE ASK**, and the reasoning is written
// at the arm in `effects.ts`; §5 below is the DRIVEN board, because a decision that
// is not pinned is indistinguishable from an oversight. In short: (b) a
// bench-not-empty `conditionGate` costs a new `BoardCondition` union member (there
// are nine and not one counts a Bench — measured) plus a D222 sweep, for a sentence
// that prints no condition, and would be a SECOND READER of a fact `switchActive`'s
// own zero-candidate arm already owns; (c) extending the M1 no-choice rule to
// `optional` means asking whether an arbitrary `then` is a no-op on this board,
// which is running the program to find out.
//
// ⚠️ **THE PRECEDENT WAS UNDRIVEN WHEN THIS SLICE CITED IT.** The shipped mirror
// behaves identically on an empty OPPONENT Bench and **nothing asserted that** —
// `derivedOpponentSwitchOut.test.ts`'s empty-Bench case ran the BARE op, which never
// asks. D422 drove the wrapped mirror's board there too, in the file that owns the
// sentence. Leaving a precedent unpinned while citing it is exactly how a false
// claim propagates.
//
// ⚠️ NO LOG ROW ON THIS PATH MAKES A CLAIM A DECLINE FALSIFIES — checked rather than
// assumed (D421's lesson, where a row would have printed a lie). `log.ts` has no
// `optional`/`confirm` row at all, and the only row this program can emit is
// `POKEMON_SWITCHED` ("<name> was switched to the Active spot"), which is emitted by
// `switchInto` and therefore only on the branch where a switch happened. A decline
// and an empty-Bench yes both emit nothing, so there is no row to be wrong. §7 pins
// the emptiness in both directions.
//
// SEED-FREE except for the shuffles `driveSetup` needs: the sentence carries no
// coin, so a seed table here would describe a deck order rather than a rule.

/** The printed sentence, verbatim — the byte source for every case below. */
const SENTENCE = "You may switch this Pokémon with 1 of your Benched Pokémon.";

/** The BARE sibling D189 built, and the string this one is the offer over. */
const BARE = "Switch this Pokémon with 1 of your Benched Pokémon.";

/** The COIN-GATED sibling D189 built — the third member of the family, here as the
    discrimination control: all three share `SELF_SWITCH_CLAUSE` and must derive to
    three different programs. */
const FLIP = "Flip a coin. If heads, switch this Pokémon with 1 of your Benched Pokémon.";

/** The MIRROR — the same wrapper over the opponent-seat op, shipped at D227, and
    the precedent this slice's empty-Bench decision leans on. */
const MIRROR =
  "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";

/** U+2019, spelled as an escape: the two apostrophes render nearly identically, so
    the curly one is always written where a reader can see it. */
const RSQUO = "’";

// ── The board. `fix-trainerops` indices, unchanged by this slice. ──
/** Index 7, "Strafe" — the printing D189 fielded ON PURPOSE so the absence had a
    live subject. It is D422's subject now, and the case that pinned it as loud is
    inverted in `derivedDrawAndGust.test.ts` rather than deleted. */
const STRAFE = 7;
/** Index 5, "Slip Away" — the BARE sentence. The control for everything: same op,
    same prompt kind, same body, no offer in front of it. */
const SLIP_AWAY = 5;
/** Index 6, "Ride the Wind" — the COIN-GATED sentence. The second control, and the
    sharper one for §6: it also reaches `switchActive` behind a gate, but the gate is
    a coin rather than a question, so it parks ONCE where D422 parks TWICE. */
const RIDE_THE_WIND = 6;

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: TRAINER_OPS_DECK, p2: TRAINER_OPS_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops` and holds `ownBench` benched bodies; p2 holds
    `oppBench`. Both Benches are set explicitly, because the OWN Bench is the whole
    subject here and the opponent's is the control that proves a crossed build
    would have had somewhere to go. */
function ready(seed: number, ownBench: number, oppBench: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  for (let i = 0; i < oppBench; i++) state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

/** The mirror board for the SECOND SEAT: p2 attacks with `fix-trainerops` on their
    own turn. Every claim about "the controller" has to hold on both seats or it is
    a claim about p1. */
function readyP2(seed: number, ownBench: number, oppBench: number): GameState {
  let state = driveSetup(seed, { p1: TRAINER_OPS_DECK, p2: TRAINER_OPS_DECK }, { first: "p1" });
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, "p2", "fix-trainerops");
  state = attachFromDeck(state, "p2", "fix-energy", 1);
  state = clearBench(state, "p2");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p2", "fix-basic-1");
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = clearBench(state, "p1");
  for (let i = 0; i < oppBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The `effect:choose` phase or a thrown error — every case here is about a park,
    so a state that is not parked is a test failure rather than a branch. */
function parkOf(state: GameState): Extract<GameState["phase"], { kind: "effect:choose" }> {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected an effect:choose park, got ${state.phase.kind}`);
  }
  return state.phase;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE ANCHOR, AND THE BYTES IT COMMITS TO
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, measured rather than remembered", () => {
  it("🛑 carries NO APOSTROPHE OF EITHER CLASS — so the anchor carries no `['’]`", () => {
    // 🛑 THIS IS MEASURED ON THE BYTES AND NOT INHERITED FROM THE NEIGHBOURS, AND
    // THE REASON IS A TWO-SIDED HISTORY. D227's first draft reasoned from D189's
    // "no apostrophe class" call and got it WRONG in the narrowing direction (its
    // sentences print "opponent's" and needed the class; `clauseApostrophe.test.ts`
    // turned red on it). D421's handoff brief reasoned from memory and got it wrong
    // in the OTHER direction, asserting a U+2019 on a sentence that prints U+0027.
    // The rule that survives both is: read the bytes.
    //
    // This sentence names *this Pokémon* and *your* Bench — no possessive — and
    // contains no contraction, so there is no character for a re-ingest to curl and
    // the anchor is right to carry no class.
    expect(SENTENCE).not.toContain("'");
    expect(SENTENCE).not.toContain(RSQUO);
    // The control: the MIRROR is the same wrapper over the other seat and it DOES
    // carry one, so "no apostrophe" is a fact about this sentence rather than about
    // the family or about this file's ability to look.
    expect(MIRROR).toContain("'");
    // …and so does the exact seat-swap of this sentence, which is nobody's printing
    // and must stay refused — the string an over-wide class starts admitting.
    const SWAPPED = "You may switch this Pokémon with 1 of your opponent's Benched Pokémon.";
    expect(SWAPPED).toContain("'");
    expect(deriveAttackEffect(SWAPPED)).toBeNull();
    // ⚠️ AND THE CONSEQUENCE FOR THE CENSUS, STATED SO IT IS NOT RE-DERIVED:
    // `clauseApostrophe.test.ts`'s derivable-sentence sweep does NOT step for this
    // slice (it stays at 141). A census keyed on a CHARACTER cannot see a sentence
    // that carries none, however derivable it becomes.
  });

  it("is the catalog's string, and the fixture fields it at index 7", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks[STRAFE]?.effect).toBe(SENTENCE);
    expect(attacks[STRAFE]?.name).toBe("Strafe");
    // Its two siblings sit beside it on the SAME body, which is what makes every
    // "this sentence and not that one" case below a same-fixture comparison.
    expect(attacks[SLIP_AWAY]?.effect).toBe(BARE);
    expect(attacks[RIDE_THE_WIND]?.effect).toBe(FLIP);
  });

  it("🛑 the anchor is WHOLE-STRING and commits to CASE — the rewrites it refuses", () => {
    // The `^…$` convention, spelled as the population it protects. Each rewrite is a
    // build someone could plausibly have written.
    const refused = [
      // Case, both ends — the capital "Switch" is `ATTACK_SELF_SWITCH`'s and this
      // anchor must not take it, which is the whole reason there are two anchors
      // rather than one `/i`.
      "You may Switch this Pokémon with 1 of your Benched Pokémon.",
      "you may switch this Pokémon with 1 of your Benched Pokémon.",
      // The trailing period, and a trailing clause — the `$`.
      SENTENCE.slice(0, -1),
      `${SENTENCE} If you do, draw a card.`,
      // A LEADING clause — the `^`. Real shape: the family's compounds all put a
      // whole mechanic in front of the switch.
      `Draw a card. ${SENTENCE}`,
      // The count, which is LITERAL in this anchor exactly as in the other three:
      // every printing prints 1, and `switchActive` parks a single-pick
      // `choosePokemon`, so a printed 2 would be a different op.
      "You may switch this Pokémon with 2 of your Benched Pokémon.",
      // The seat, and the possessive that comes with it.
      "You may switch this Pokémon with 1 of your opponent's Benched Pokémon.",
      // The MODAL — "can" is not "may", and no printing spells it.
      "You can switch this Pokémon with 1 of your Benched Pokémon.",
      // The Switch ITEM's own string: Trainer text, and the attack reader has no
      // business claiming it.
      FIXTURE_POOL["sv01-194"]?.effect ?? "",
    ];
    for (const text of refused) expect(deriveAttackEffect(text), text).toBeNull();
    // …and the real sentence is not in that list by construction, which is what
    // stops the loop above from being a list of strings nobody checked.
    expect(refused).not.toContain(SENTENCE);
    expect(deriveAttackEffect(SENTENCE)).not.toBeNull();
  });

  it("hands nothing to the COIN reader — the sentence prints no flip", () => {
    expect(deriveAttackCoinFlip(SENTENCE)).toBeNull();
    // The control: its coin-gated sibling is a coin sentence to the EFFECT reader
    // and still not to the coin reader, because the gate is an op rather than a
    // §8.5 fold. So "null here" is not a fact about every switch sentence.
    expect(deriveAttackCoinFlip(FLIP)).toBeNull();
    expect(deriveAttackEffect(FLIP)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE PROGRAM: A WRAPPER OVER A SHIPPED OP, AND NOTHING ELSE
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the arm COMPOSES: two shipped ops, zero new vocabulary", () => {
  it("derives to `optional` over `switchActive`, with the printed sentence as note", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([
      {
        op: "optional",
        note: SENTENCE,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "switchActive" }],
      },
    ]);
  });

  it("🛑 the `then` is BYTE-IDENTICAL to the BARE sentence's whole program", () => {
    // The family's checkable claim (D134's shape): there is ONE action here, printed
    // twice, and the "you may" is a gate in front of it. Read the gate apart rather
    // than re-typing the inner op, so a copy-paste cannot pass it.
    const gated = deriveAttackEffect(SENTENCE);
    expect(gated).toHaveLength(1);
    const gate = gated?.[0];
    expect(gate?.op).toBe("optional");
    expect(gate?.op === "optional" ? gate.then : undefined).toEqual(deriveAttackEffect(BARE));
    // …and it also equals the REGISTRY program printed on the Switch ITEM, which is
    // the same board action read off two different seams by two different readers.
    expect(deriveAttackEffect(BARE)).toEqual(programFor("sv01-194")?.trainer);
  });

  it("NO `otherwise` — a decline buys nothing, and the sentence prints nothing", () => {
    // 🛑 D316 gave `optional` an `otherwise` arm for *"You may do 120 more damage"*,
    // whose decline still deals the base. This sentence prints no alternative, so
    // the key is ABSENT rather than empty — the absent-field rule, and the
    // difference a `toEqual` would hide.
    const gate = deriveAttackEffect(SENTENCE)?.[0];
    expect(gate?.op).toBe("optional");
    expect("otherwise" in (gate ?? {})).toBe(false);
  });

  it("the three sentences of the family derive to THREE DISTINCT programs", () => {
    // All three share `SELF_SWITCH_CLAUSE`, so the risk this case exists against is
    // one anchor eating another's sentence — the failure that could not be asserted
    // at all while the third was null.
    const programs = [BARE, FLIP, SENTENCE].map((t) => JSON.stringify(deriveAttackEffect(t)));
    expect(new Set(programs).size).toBe(3);
    for (const p of programs) expect(p).not.toBe("null");
  });

  it("wraps through the SAME gate as the MIRROR — one shape, two seats", () => {
    // D227's arm and D422's arm differ by the inner op and by NOTHING else, which is
    // the claim D186 made when it built the wrapper before it had a second body.
    const mine = deriveAttackEffect(SENTENCE)?.[0];
    const theirs = deriveAttackEffect(MIRROR)?.[0];
    expect(mine?.op).toBe("optional");
    expect(theirs?.op).toBe("optional");
    expect(Object.keys(mine ?? {}).sort()).toEqual(Object.keys(theirs ?? {}).sort());
    expect(mine?.op === "optional" ? mine.then : undefined).toEqual([{ op: "switchActive" }]);
    expect(theirs?.op === "optional" ? theirs.then : undefined).toEqual([
      { op: "opponentSwitchOut" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE ACCEPT, ON BOTH SEATS
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the ACCEPT: two parks in order, and the switch lands", () => {
  it("asks the CONTROLLER, then asks them again for the body — in that order", () => {
    const state = ready(70, 2, 2);
    const attacker = activeUid(state, "p1");
    const oppActive = activeUid(state, "p2");

    // Question one: the printed offer. The note is the sentence, VERBATIM — it is
    // the only prose either dialog renders, so byte equality and not "non-empty".
    const { state: confirming, events: askEvents } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    const first = parkOf(confirming);
    expect(first.prompt.kind).toBe("confirm");
    expect(first.prompt.note).toBe(SENTENCE);
    // NO `answerer`: the printed "you" is the controller. (The MIRROR's second park
    // is the one that files one — asserted in §6 as the contrast.)
    expect(first.answerer).toBeUndefined();
    expect(first.seat).toBe("p1");
    // Nothing has moved yet, and the turn has NOT folded.
    expect(activeUid(confirming, "p1")).toBe(attacker);
    expect(types(askEvents)).not.toContain("TURN_ENDED");

    // Question two: the body, behind the yes. Same seat, different prompt kind.
    const { state: choosing } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    const second = parkOf(choosing);
    expect(second.prompt.kind).toBe("choosePokemon");
    expect(second.answerer).toBeUndefined();
    if (second.prompt.kind !== "choosePokemon") throw new Error("unreachable");
    // The candidates are the CONTROLLER's own Bench, and only that.
    expect(second.prompt.candidates).toHaveLength(2);
    expect(second.prompt.candidates.every((ref) => ref.seat === "p1")).toBe(true);
    expect(second.prompt.candidates.every((ref) => ref.spot.spot === "bench")).toBe(true);

    // The answer: the attacker leaves the spot and the chosen body arrives.
    const chosen = choosing.players.p1.bench[1]?.stack.at(-1);
    const { state: done, events } = mustApply(choosing, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 1 } } },
    });
    expect(activeUid(done, "p1")).toBe(chosen);
    expect(activeUid(done, "p1")).not.toBe(attacker);
    // The OPPONENT's board is untouched — the seat, driven rather than assumed.
    expect(activeUid(done, "p2")).toBe(oppActive);
    expect(done.players.p2.bench).toHaveLength(2);
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(1);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("🛑 the SECOND SEAT gets the identical sequence — p2 attacking on p2's turn", () => {
    // Every claim about "the controller" is a claim about p1 until it is run on p2.
    const state = readyP2(71, 2, 2);
    const attacker = activeUid(state, "p2");
    const { state: confirming } = mustApply(state, {
      type: "attack",
      seat: "p2",
      index: STRAFE,
    });
    const first = parkOf(confirming);
    expect(first.prompt.kind).toBe("confirm");
    expect(first.prompt.note).toBe(SENTENCE);
    expect(first.seat).toBe("p2");
    expect(first.answerer).toBeUndefined();
    // 🛑 THE CROSSED-BUILD CONTROL: p1 must NOT be able to answer p2's offer.
    const stolen = applyAction(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(stolen.ok).toBe(false);
    const { state: choosing } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "confirm", yes: true },
    });
    const second = parkOf(choosing);
    if (second.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(second.prompt.candidates.every((ref) => ref.seat === "p2")).toBe(true);
    const chosen = choosing.players.p2.bench[0]?.stack.at(-1);
    const { state: done, events } = mustApply(choosing, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
    });
    expect(activeUid(done, "p2")).toBe(chosen);
    expect(activeUid(done, "p2")).not.toBe(attacker);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("`phaseViewOf` shows the offer to the controller and WITHHOLDS it from the other", () => {
    // The wire projection of a park nobody else may answer. No new redaction was
    // bought — this asserts the shipped one reaches this park.
    const { state: confirming } = mustApply(ready(72, 2, 2), {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    const mine = phaseViewOf(confirming, "p1");
    const theirs = phaseViewOf(confirming, "p2");
    // Both views agree on WHOSE turn it is and WHO is being waited for — the half
    // a withheld prompt must not take away, or the other client soft-locks.
    expect(mine.activeSeat).toBe("p1");
    expect(theirs.activeSeat).toBe("p1");
    expect(mine.waitingSeat).toBe("p1");
    expect(theirs.waitingSeat).toBe("p1");
    // The controller sees the offer, and it is a `confirm` carrying the sentence.
    const decision = mine.pendingDecision;
    if (decision?.kind !== "effectChoose") throw new Error("expected effectChoose");
    expect(decision.prompt.kind).toBe("confirm");

    // 🛑 A FINDING, WRITTEN DOWN BECAUSE THE FIRST DRAFT OF THIS CASE ASSUMED THE
    // OPPOSITE AND WENT RED. `phaseViewOf` does NOT withhold this prompt from the
    // opponent — its `withheld` term is `phase.answerer !== undefined && …`, so it
    // fires only for a CROSS-SEAT park (D227's mirror). An own-seat park has been
    // visible in the LOCAL projection since M4 and D422 changes nothing about that.
    // It is correct here and it is not an accident worth "fixing": a `confirm`
    // carries no reference and no hidden identity — its whole payload is the printed
    // card text, which is public on both boards — so there is nothing to leak.
    expect(theirs.pendingDecision).not.toBeNull();

    // 🛑 THE WIRE IS THE GATE THAT MATTERS, AND IT DOES WITHHOLD. `redactedPromptOf`
    // compares `phase.answerer ?? phase.seat` to the viewer, so the opponent's
    // redacted game carries NO prompt for this park — which is what stops the other
    // client rendering a dialog for a question it may not answer.
    const wireMine = redactGame(confirming, "p1").phase;
    const wireTheirs = redactGame(confirming, "p2").phase;
    if (wireMine.kind !== "effect:choose") throw new Error("expected effect:choose on the wire");
    if (wireTheirs.kind !== "effect:choose") throw new Error("expected effect:choose on the wire");
    expect(wireMine.prompt?.kind).toBe("confirm");
    expect(wireTheirs.prompt).toBeNull();
    // …and the withheld side still gets the PHASE, so it renders "waiting for your
    // opponent" rather than a dead board — the prompt is the only thing taken away.
    expect(wireTheirs.kind).toBe(wireMine.kind);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE DECLINE, AND WHERE IT LIVES
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the DECLINE lives in the CONFIRM, and the pick behind it stays MANDATORY", () => {
  it("a NO moves nobody, asks nothing further, and ends the turn", () => {
    const state = ready(73, 2, 2);
    const attacker = activeUid(state, "p1");
    const benchBefore = state.players.p1.bench.map((s) => s.stack.at(-1));
    const { state: confirming } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    const { state: done, events } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    // No second park — the `otherwise` is absent, so the "no" buys NO ops.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeUid(done, "p1")).toBe(attacker);
    expect(done.players.p1.bench.map((s) => s.stack.at(-1))).toEqual(benchBefore);
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(0);
    // 🛑 AND IT IS NOT A SKIPPED EFFECT. A decline is the card working, not the
    // engine failing to read it — the distinction the loud row exists to make.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("🛑 the pick behind a YES REFUSES a ref-less answer — `parkOrForce` untouched", () => {
    // 🛑 THIS IS THE CASE THAT PINS THE DESIGN. D181/D189 refused this sentence
    // because `choosePokemon`'s answer `{ kind: "pokemon"; ref?: PokemonRef }` has an
    // OPTIONAL ref — the decline — and `validateChoice` refuses it for a MANDATORY
    // pick, and they concluded a new prompt key was needed. The pick behind the YES
    // is still that MANDATORY pick and D422 did not touch it: having said yes, the
    // player must name a body. The decline was spent one op earlier.
    const { state: confirming } = mustApply(ready(74, 2, 2), {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    const { state: choosing } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    const refused = applyAction(choosing, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    });
    expect(refused.ok).toBe(false);
    // …and the park is still there, unspent, so the refusal is a rejection rather
    // than a silent consumption.
    expect(parkOf(choosing).prompt.kind).toBe("choosePokemon");
    // The prompt carries NO ceiling key: absent `upTo` is what MANDATORY means on
    // this prompt since D359, and it is what makes the line above true.
    const prompt = parkOf(choosing).prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.upTo).toBeUndefined();
    // 🛑 AND THE FORCED ARM IS UNCHANGED AT ONE CANDIDATE, which is the other half of
    // "parkOrForce untouched": with a single benched body the YES resolves the switch
    // outright and never asks a second question.
    const { state: onePark } = mustApply(ready(75, 1, 2), {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    const lone = onePark.players.p1.bench[0]?.stack.at(-1);
    const { state: forced } = mustApply(onePark, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(forced.phase.kind).not.toBe("effect:choose");
    expect(activeUid(forced, "p1")).toBe(lone);
  });

  it("the DECLINE is refused from the other seat, on both seats", () => {
    // A "no" is an answer, so it is governed by the same seat gate the "yes" is.
    const { state: p1park } = mustApply(ready(76, 2, 2), {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    expect(
      applyAction(p1park, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "confirm", yes: false },
      }).ok,
    ).toBe(false);
    const { state: p2park } = mustApply(readyP2(77, 2, 2), {
      type: "attack",
      seat: "p2",
      index: STRAFE,
    });
    expect(
      applyAction(p2park, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "confirm", yes: false },
      }).ok,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE EMPTY BENCH: THE DECISION, PINNED ON A DRIVEN BOARD
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the EMPTY-BENCH ASK is a DECISION, and this is the board that pins it", () => {
  it("🛑🛑 ASKS on an empty own Bench, and the YES does nothing — accepted, not overlooked", () => {
    // 🛑 THE MECHANISM THE SENTENCE DOES NOT ADVERTISE. `optional` ALWAYS parks;
    // `switchActive` no-ops silently at zero candidates. So the question is asked
    // mid-attack on a board where both answers reach the same state — which is
    // precisely the shape the M1 no-choice rule retires everywhere it CAN.
    //
    // D422 ACCEPTS IT. The full reasoning is at the arm in `effects.ts`; the reason
    // it is pinned HERE rather than only argued there is conventions.md: *a decision
    // that is not pinned is indistinguishable from an oversight*, and a successor
    // finding this board undriven would read the ask as a bug and "fix" it.
    //
    // ⚠️ IF YOU ARE HERE TO CHANGE IT: this case is the thing to change, and the two
    // alternatives were priced and refused rather than missed — (b) a bench-not-empty
    // `conditionGate` needs a tenth `BoardCondition` member (none of the nine counts
    // a Bench) plus a D222 sweep, and duplicates a fact `switchActive` already owns;
    // (c) extending M1 to `optional` means deciding whether an arbitrary `then` is a
    // no-op on this board.
    const state = ready(80, 0, 2);
    const attacker = activeUid(state, "p1");
    const oppActive = activeUid(state, "p2");
    expect(state.players.p1.bench).toHaveLength(0);
    // The opponent's Bench is STOCKED, so a crossed build would have found
    // candidates and this case would not be about an empty candidate set at all.
    expect(state.players.p2.bench).toHaveLength(2);
    deepFreeze(state);

    const { state: confirming, events: askEvents } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    // IT ASKS.
    const park = parkOf(confirming);
    expect(park.prompt.kind).toBe("confirm");
    expect(park.prompt.note).toBe(SENTENCE);
    expect(park.answerer).toBeUndefined();
    expect(types(askEvents)).not.toContain("TURN_ENDED");

    // THE YES DOES NOTHING — and says nothing, which is the property that makes the
    // ask tolerable rather than misleading.
    const { state: done, events } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeUid(done, "p1")).toBe(attacker);
    expect(activeUid(done, "p2")).toBe(oppActive);
    expect(done.players.p1.bench).toHaveLength(0);
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(0);
    // The attack was USED: an empty Bench is not a failure to read the sentence.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("the NO on an empty Bench reaches the SAME board as the YES — the two answers agree", () => {
    // The other half of the decision, and the sharpest statement of what is being
    // accepted: on this board the question genuinely has one outcome. Asserted as a
    // STATE EQUALITY rather than described, so a build in which the yes-branch did
    // something on an empty Bench is red here even if it moved nothing visible.
    const yes = mustApply(
      mustApply(ready(81, 0, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } },
    ).state;
    const no = mustApply(
      mustApply(ready(81, 0, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } },
    ).state;
    expect(JSON.stringify(yes)).toBe(JSON.stringify(no));
    // ⚠️ THE CONTROL THAT KEEPS THE ABOVE FROM BEING VACUOUS: on a STOCKED Bench the
    // same two answers reach DIFFERENT boards. Without this, "yes === no" would also
    // pass on a build whose `then` never ran at all.
    const yesStocked = mustApply(
      mustApply(ready(82, 2, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } },
    ).state;
    const noStocked = mustApply(
      mustApply(ready(82, 2, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } },
    ).state;
    expect(JSON.stringify(yesStocked)).not.toBe(JSON.stringify(noStocked));
  });

  it("the BARE sibling on the SAME empty board never asks at all — the contrast", () => {
    // What the wrapper actually costs on this board, stated as a difference between
    // two indices of ONE fixture rather than as a claim about `optional`.
    const { state: done, events } = mustApply(ready(83, 0, 2), {
      type: "attack",
      seat: "p1",
      index: SLIP_AWAY,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
    // …and the wrapped one on the identical board DOES park. One fixture, one
    // board, two indices, one difference.
    const { state: parked } = mustApply(ready(83, 0, 2), {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    expect(parkOf(parked).prompt.kind).toBe("confirm");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE TWO-PARK ORDERING, AND THE TURN THAT WAITS FOR IT
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — TWO PARKS in order, and the turn folds only after the second", () => {
  it("🛑 confirm FIRST, choosePokemon SECOND — and the turn ends at neither park", () => {
    // ⚠️ D216's correction, exercised: a PROGRAM parks twice because `runProgram(rest)`
    // parks again the moment an op in `rest` needs a decision. `continuationOps`
    // splices `then` on the yes and that spliced `switchActive` is what parks the
    // second time — so this ordering is the composition working, not a special case.
    const state = ready(84, 3, 2);
    const { state: first, events: e1 } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    expect(parkOf(first).prompt.kind).toBe("confirm");
    expect(types(e1)).not.toContain("TURN_ENDED");

    const { state: second, events: e2 } = mustApply(first, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(parkOf(second).prompt.kind).toBe("choosePokemon");
    // 🛑 THE TURN HAS STILL NOT FOLDED. The `attackEpilogue` rides `pending` behind
    // BOTH parks, which is the machinery D189 paid for and this arm inherits.
    expect(types(e2)).not.toContain("TURN_ENDED");
    expect(second.pending.length).toBeGreaterThan(0);

    const { state: done, events: e3 } = mustApply(second, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    // …and it folds exactly once the second answer is paid.
    expect(types(e3)).toContain("TURN_ENDED");
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("the COIN-GATED sibling parks ONCE on the same board — the gate is not a question", () => {
    // The control that makes "two parks" a fact about the WRAPPER rather than about
    // `switchActive`: `coinFlipGate` also puts `switchActive` behind a gate, and
    // that gate asks nobody anything.
    const { state: parked, events } = mustApply(ready(85, 3, 2), {
      type: "attack",
      seat: "p1",
      index: RIDE_THE_WIND,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
    const kind = parked.phase.kind === "effect:choose" ? parked.phase.prompt.kind : "none";
    expect(kind).not.toBe("confirm");
    // …and D422's index on the same board flips no coin and asks a question.
    const { state: mine, events: mineEvents } = mustApply(ready(85, 3, 2), {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    expect(all(mineEvents, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(parkOf(mine).prompt.kind).toBe("confirm");
  });

  it("BOTH parks belong to the CONTROLLER — unlike the MIRROR's second one", () => {
    // 🛑 THE SHARPEST CONTRAST IN THE FAMILY, and the reason this suite exists beside
    // `derivedOpponentSwitchOut.test.ts` rather than inside it. D227's wrapper puts
    // the two questions on TWO DIFFERENT SEATS (controller consents, opponent picks);
    // D422's puts both on ONE. Same wrapper, same ordering, different answerers — so
    // a build that filed a `decider` on this arm's inner op is red here.
    const { state: mine } = mustApply(ready(86, 2, 2), {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    const { state: minePick } = mustApply(mine, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(parkOf(mine).answerer).toBeUndefined();
    expect(parkOf(minePick).answerer).toBeUndefined();
    // The mirror, on the same fixture, two indices over: its second park files p2.
    const MIRROR_INDEX = 10; // `fix-trainerops` "Winding Waves", appended by D227.
    expect((FIXTURE_POOL["fix-trainerops"]?.attacks ?? [])[MIRROR_INDEX]?.effect).toBe(MIRROR);
    const { state: theirs } = mustApply(ready(86, 2, 2), {
      type: "attack",
      seat: "p1",
      index: MIRROR_INDEX,
    });
    const { state: theirsPick } = mustApply(theirs, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(parkOf(theirs).answerer).toBeUndefined();
    expect(parkOf(theirsPick).answerer).toBe("p2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — NOTHING IS LOUD IN EITHER DIRECTION
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — no ATTACK_EFFECT_SKIPPED on ANY branch, and no log row a decline falsifies", () => {
  it("accept, decline and empty-Bench all resolve QUIETLY", () => {
    // The loud row is the engine saying "I could not read this sentence". D422's
    // sentence is read on every branch, so it must never appear — and this case
    // sweeps the branches rather than asserting it once on the lucky one.
    const branches: [string, GameState][] = [];
    // Accept, stocked.
    {
      const a = mustApply(ready(90, 2, 2), { type: "attack", seat: "p1", index: STRAFE }).state;
      const b = mustApply(a, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "confirm", yes: true },
      }).state;
      branches.push(["accept", b]);
    }
    for (const [name, state] of branches) expect(state, name).toBeDefined();

    const runs: [string, GameEvent[]][] = [];
    const accept = mustApply(ready(91, 2, 2), { type: "attack", seat: "p1", index: STRAFE });
    const pick = mustApply(accept.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    const finished = mustApply(pick.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    runs.push(["attack", accept.events], ["yes", pick.events], ["chose", finished.events]);
    const declined = mustApply(
      mustApply(ready(92, 2, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } },
    );
    runs.push(["no", declined.events]);
    const emptyYes = mustApply(
      mustApply(ready(93, 0, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } },
    );
    runs.push(["empty-yes", emptyYes.events]);
    for (const [name, events] of runs) {
      expect(all(events, "ATTACK_EFFECT_SKIPPED"), name).toHaveLength(0);
    }
    // ⚠️ THE ATTRIBUTION CONTROL (D214), AND IT IS NOT OPTIONAL HERE: a suite that
    // only ever asserts `toHaveLength(0)` on a row is green on a build that stopped
    // emitting the row at all, and green on a board that could never have produced
    // it. So the loud row is DRIVEN on this same fixture. Index 42 is the ONE index
    // of `fix-trainerops`'s 61 that no reader claims (measured at this head — index
    // 7 used to be the other one, and D422 is why it no longer is).
    // 🆕🛑 **D457 — 42 → 71, AND THE RE-POINT WAS FORCED BY THE DEMONSTRATOR
    // RUNNING OUT.** D422 moved this constant off index 7 when that sentence was
    // built; D457 built index 42, and unlike D422 there was NO other unread index
    // to move to — all 71 of `fix-trainerops`' attacks were claimed by a live
    // reader at this head (measured over `resolvedByAnyReader`). So the fixture
    // gained index 71, the Future-banner attach (corpus line 404), which is
    // DATA-BLOCKED rather than merely unbuilt: no ingested column classifies the
    // banner, so this control cannot be silently disarmed by the next slice that
    // writes an anchor. `testFixtures.ts` carries the whole argument.
    const UNREAD = 71;
    const unread = (FIXTURE_POOL["fix-trainerops"]?.attacks ?? [])[UNREAD]?.effect ?? "";
    expect(unread).not.toBe("");
    expect(deriveAttackEffect(unread)).toBeNull();
    const { events: loud } = mustApply(ready(94, 2, 2), {
      type: "attack",
      seat: "p1",
      index: UNREAD,
    });
    expect(all(loud, "ATTACK_EFFECT_SKIPPED")).toHaveLength(1);
  });

  it("🛑 the ONLY row this program can emit rides the branch where it is TRUE", () => {
    // ⚠️ D421's lesson, checked rather than assumed: *a log row is a claim with the
    // same standing as a predicate*, and its brief's row would have printed a lie.
    // `log.ts` has NO `optional`/`confirm` row at all — the offer and its answer are
    // invisible to the log — and the only row reachable from this program is
    // `POKEMON_SWITCHED` ("<name> was switched to the Active spot"), emitted inside
    // `switchInto`. So the row exists exactly when a switch happened, and there is
    // no sentence a decline could falsify. Driven on all three branches.
    const accepted = mustApply(
      mustApply(ready(95, 2, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } },
    ).state;
    const { events: switched } = mustApply(accepted, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    expect(all(switched, "POKEMON_SWITCHED")).toHaveLength(1);
    const { events: declined } = mustApply(
      mustApply(ready(96, 2, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } },
    );
    expect(all(declined, "POKEMON_SWITCHED")).toHaveLength(0);
    const { events: emptyYes } = mustApply(
      mustApply(ready(97, 0, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } },
    );
    expect(all(emptyYes, "POKEMON_SWITCHED")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED QUESTION: `MATCH_RECORD_VERSION` STAYS 26, DRIVEN BOTH WAYS
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — `MATCH_RECORD_VERSION` stays 26, and BOTH parks are driven through a round trip", () => {
  // ⚠️ `MATCH_RECORD_VERSION` IS NOT EXPORTED FROM THIS PACKAGE (it lives in
  // `apps/api/src/lobby/match.ts`), so the claim is DRIVEN rather than asserted
  // against the constant. The bump trigger at this address is a MISSING REQUIRED
  // FIELD on a persisted structure (D136, D189, D359, D386/D393/D412). D422 adds no
  // field anywhere, so the prediction is a LITERAL ZERO DIFF — and a prediction of
  // zero is exactly the kind that gets asserted instead of measured, so both parks
  // are round-tripped through JSON (which is what persistence does to them) and
  // REPLAYED through `applyAction`, with the key sets compared against parks this
  // same build writes for SHIPPED sentences.

  it("🛑 the CONFIRM park round-trips and replays, and carries no key the MIRROR's lacks", () => {
    const live = mustApply(ready(100, 2, 2), { type: "attack", seat: "p1", index: STRAFE }).state;
    const saved = JSON.parse(JSON.stringify(live)) as GameState;
    // The park survived the trip intact.
    const park = parkOf(saved);
    expect(park.prompt.kind).toBe("confirm");
    expect(park.prompt.note).toBe(SENTENCE);
    // …and it REPLAYS: an answer given to the deserialised board does the work.
    const { state: resumed } = mustApply(saved, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(parkOf(resumed).prompt.kind).toBe("choosePokemon");

    // 🛑 THE ZERO-DIFF ASSERTION, AGAINST A PARK THIS BUILD WRITES FOR A SENTENCE
    // THAT SHIPPED AT D227. If D422's park carried ANY key the mirror's does not,
    // the prediction was wrong and the bump is owed.
    const MIRROR_INDEX = 10;
    const mirror = mustApply(ready(100, 2, 2), {
      type: "attack",
      seat: "p1",
      index: MIRROR_INDEX,
    }).state;
    const mirrorPark = parkOf(mirror);
    expect(Object.keys(park).sort()).toEqual(Object.keys(mirrorPark).sort());
    expect(Object.keys(park.prompt).sort()).toEqual(Object.keys(mirrorPark.prompt).sort());
    expect(Object.keys(park.cont).sort()).toEqual(Object.keys(mirrorPark.cont).sort());
    // The pending stack too — the `attackEpilogue` is the persisted shape D189 paid
    // for, and it is the one this arm rides behind BOTH parks.
    expect(saved.pending.map((p) => Object.keys(p).sort())).toEqual(
      mirror.pending.map((p) => Object.keys(p).sort()),
    );
    // …and the in-play bodies, which is where a grown key would actually land.
    expect(Object.keys(saved.players.p1.active ?? {}).sort()).toEqual(
      Object.keys(mirror.players.p1.active ?? {}).sort(),
    );
  });

  it("🛑 the CHOOSEPOKEMON park behind the YES is the BARE sentence's park, key for key", () => {
    // The second direction, and the one that matters most: this is the park D181 and
    // D189 said would have to grow a field. It did not. It is compared against the
    // park the BARE sentence produces on the same board — the SAME op reached without
    // a wrapper — so any key the wrapper leaked onto it is red here.
    const wrapped = mustApply(
      mustApply(ready(101, 2, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } },
    ).state;
    const saved = JSON.parse(JSON.stringify(wrapped)) as GameState;
    const park = parkOf(saved);
    if (park.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // No ceiling key — the pick is MANDATORY and stayed that way.
    expect("upTo" in park.prompt).toBe(false);

    const bare = mustApply(ready(101, 2, 2), {
      type: "attack",
      seat: "p1",
      index: SLIP_AWAY,
    }).state;
    const barePark = parkOf(bare);
    expect(barePark.prompt.kind).toBe("choosePokemon");
    expect(Object.keys(park.prompt).sort()).toEqual(Object.keys(barePark.prompt).sort());
    expect(Object.keys(park).sort()).toEqual(Object.keys(barePark).sort());
    expect(Object.keys(park.cont).sort()).toEqual(Object.keys(barePark.cont).sort());
    expect(saved.pending.map((p) => Object.keys(p).sort())).toEqual(
      bare.pending.map((p) => Object.keys(p).sort()),
    );
    expect(Object.keys(saved.players.p1.active ?? {}).sort()).toEqual(
      Object.keys(bare.players.p1.active ?? {}).sort(),
    );
    // …and it REPLAYS from the deserialised board all the way to the switch.
    const chosen = saved.players.p1.bench[0]?.stack.at(-1);
    const { state: done, events } = mustApply(saved, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    expect(activeUid(done, "p1")).toBe(chosen);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("the DECLINE replays off a saved board too — the other answer, same record", () => {
    // A saved `confirm` park has TWO legal answers and a version claim about it is
    // only half-driven if the suite always says yes.
    const saved = JSON.parse(
      JSON.stringify(
        mustApply(ready(102, 2, 2), { type: "attack", seat: "p1", index: STRAFE }).state,
      ),
    ) as GameState;
    const attacker = activeUid(saved, "p1");
    const { state: done, events } = mustApply(saved, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeUid(done, "p1")).toBe(attacker);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — PURITY
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the frozen-board pair: neither branch mutates the state it was handed", () => {
  it("a FROZEN board survives the attack, the YES, the pick and the NO", () => {
    // `deepFreeze` turns an in-place write into a thrown TypeError, so this is a
    // structural-sharing check rather than a deep-equality one. Both branches, because
    // an `optional` that mutated on the decline would pass a yes-only pair.
    const state = deepFreeze(ready(110, 2, 2));
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: STRAFE });
    deepFreeze(parked);
    const { state: choosing } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    deepFreeze(choosing);
    mustApply(choosing, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    // The DECLINE branch off the SAME frozen park.
    mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    // …and the original board is untouched: still unparked, still holding its Active.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p1.bench).toHaveLength(2);
  });

  it("a FROZEN empty-Bench board survives the ask and the empty YES", () => {
    // The zero-candidate path has its own writes (or rather, its own absence of
    // them), so it gets its own frozen board rather than riding the pair above.
    const state = deepFreeze(ready(111, 0, 2));
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: STRAFE });
    deepFreeze(parked);
    mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(state.players.p1.bench).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — THE CAST
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — the fixtures this suite drives, named", () => {
  it("the demonstrator fields all three sentences of the family, at the indices used here", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks[SLIP_AWAY]?.effect).toBe(BARE);
    expect(attacks[RIDE_THE_WIND]?.effect).toBe(FLIP);
    expect(attacks[STRAFE]?.effect).toBe(SENTENCE);
    // Every one of the three derives — the family, whole, off ONE body.
    for (const index of [SLIP_AWAY, RIDE_THE_WIND, STRAFE]) {
      expect(deriveAttackEffect(attacks[index]?.effect ?? ""), `index ${index}`).not.toBeNull();
    }
    // 🛑 AND NO REGISTRY ROW WAS AUTHORED: this sentence is a deriver arm, which is
    // what makes it serve every reprint rather than three card ids.
    const ops: EffectOp[] = deriveAttackEffect(SENTENCE) ?? [];
    expect(ops).toHaveLength(1);
    expect(programFor("fix-trainerops")?.attack).toBeUndefined();
  });
});
