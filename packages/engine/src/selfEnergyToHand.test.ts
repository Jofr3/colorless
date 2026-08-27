import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackGateClause,
} from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import {
  SELF_ENERGY_HAND_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.309.0 → 0.310.0 — 🆕🆕 D405: THE MANDATORY OWN-BOARD ENERGY RETRIEVAL.
//
// "Put an Energy attached to this Pokémon into your hand." — 1 sentence / 5 legal
// printings, and it is here because a PRICE COMPARISON chose it over a bigger head.
// The largest sentence left in D404's split-aware residue is *"Heal from this Pokémon
// the same amount of damage you did to your opponent's Active Pokémon."* at SIX
// printings; it lost, and the reason is in `docs/decisions.md` and restated in the
// version block. In one line: every `EffectSlot` this engine files is a LIST OF CARD
// UIDS and that sentence needs an HP FIGURE, so the cheapest honest build widens a type
// that rides `EffectContinuation` across the wire. This one widens nothing.
//
// 🛑 WHAT SHIPS IS ONE ANCHOR, ONE ARM AND ONE CAPTION BRANCH. The op is D96's
// `discardEnergy`, the destination is D295's `to: "hand"`, the count is the op's
// documented absent-means-one, and the park is the one arms 7/8/9 have had since 0.x.
// ZERO new ops, fields, readers, prompts, choice kinds, events, registry rows or
// `packages/schema` bytes — so `MATCH_RECORD_VERSION` stays 25.
//
// 🛑 AND THE TWO FALSIFIERS THE HANDOFF NAMED WERE CHECKED BEFORE A LINE WAS WRITTEN,
// with opposite answers. **FIELD 2 (the `count` default) HELD**: the interpreter spells
// the absence `{ kind: "total", count: op.count ?? 1 }` and `discardNote` reads it as
// the printed article, so nothing takes an absent count for "all" — §5 drives both.
// **FIELD 1 (the caption) FIRED**: `discardNote`'s `yourActive` arm had no `putBack`
// branch at all, because until this sentence no own-board printing put Energy into a
// HAND. It costs a BRANCH and not a FIELD, which is why the build went ahead — §7 is
// that branch, and its control is that the plain self-discard's caption is unmoved.

/** Every reader `censusAtHead.test.ts` sweeps with, so a sentence this file calls
    "unread" is unread by the WHOLE engine and not merely by the one reader it is about
    (D382's rule). */
const READERS: readonly ((t: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  // 🆕🆕 D419 — the TWELFTH reader (D417, `deriveAttackCancelRequirement`), which
  // this list never had.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** THE SENTENCE THIS SLICE BUYS, byte for byte from `legalAttackCorpus()`. */
const TAKEN = "Put an Energy attached to this Pokémon into your hand.";

/** THE DECLINABLE TWIN, printed on the OPPONENT's Active — D296's sentence, and this
    file's control at every seam where "mandatory" has to be told from "may". */
const MAY_TWIN = "You may put an Energy attached to your opponent's Active Pokémon into their hand.";

/** THE ONE REAL NEAR-MISS IN THE SAME COLUMN, and it differs in THREE printed places at
    once (the "may", the "all", and a payoff tail) — which is exactly why §3 pins the
    refusals on constructed ONE-TOKEN variants instead (D399's rule). */
const ALL_FOR_DAMAGE =
  "You may put all Energy attached to this Pokémon into your hand to have this attack do 80 more damage.";

/** The PROGRAM, spelled once so no case can pass against a hand-copied literal that has
    drifted from what this file means by it. */
const PROGRAM = [
  { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, to: "hand" },
];

describe("D405 §1 — the sentence, measured live over the legal column", () => {
  it("🆕🆕 D419 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE AND D418's WORDING. This
    // copy was hand-kept and NOTHING compared it to what `effects.ts` exports, so
    // it could sit short of the module indefinitely — which is precisely the state
    // `censusAtHead.test.ts` was in before D417 and thirty more files were in after
    // D418. A guard in another file guards that file's copy alone.
    //
    // ⚠️ AND THE FIGURES NO LONGER COME OFF THIS LIST AT ALL. Resolution below is
    // computed through `resolvedByAnyReader` IMPORTED from `censusAttackCorpus.ts`,
    // off the MODULE surface, so no edit here can move a census number again. What
    // survives is a DECLARED EXPECTATION, and this rung is its only remaining job.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this list in the SAME commit, and the figures would then move
    // with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("is really in the column, ONCE, at FIVE printings — raw AND split-aware", () => {
    // The attribution control (D183): without it every rung below could be green
    // against a paraphrase no card prints. Asked in BOTH columns because D403's rule
    // is that a residue figure is the SPLIT one — here the two agree, and that
    // agreement is the measurement rather than an assumption.
    const rows = legalAttackCorpus().filter(([, s]) => s === TAKEN);
    expect([rows.length, units(rows)]).toEqual([1, 5]);
    expect(splitAttackGateClause(TAKEN)).toBeNull();
    const split = legalAttackCorpus().filter(([, s]) => {
      const gate = splitAttackGateClause(s);
      return (gate === null ? s : gate.body) === TAKEN;
    });
    expect([split.length, units(split)]).toEqual([1, 5]);
  });

  it("🛑 the arm is its ONLY reader — the other ELEVEN refuse it", () => {
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(TAKEN), read.name).toBeNull();
    }
  });

  it("🛑 the column prints ONE quantifier on this skeleton, and it is 'an'", () => {
    // The measurement behind NOT widening to `(an|\d+)` the way the opponent-side twin
    // is widened. Named as a number rather than left implied (D400): the family of
    // sentences that put Energy off THIS Pokémon into a hand has exactly two members,
    // and the other one is the compound below.
    const family = legalAttackCorpus().filter(([, s]) =>
      /Energy attached to this Pokémon into your hand/.test(s),
    );
    expect(family.map(([, s]) => s).sort()).toEqual([ALL_FOR_DAMAGE, TAKEN].sort());
    expect(units(family)).toBe(6);
    // …so a numeric spelling would resolve a sentence nobody prints (D190b).
    expect(deriveAttackEffect("Put 2 Energy attached to this Pokémon into your hand.")).toBeNull();
  });

  it("⚠️ the ALL-for-damage compound is a real printing and is still refused by all twelve", () => {
    // It is a slice of its own (an `optional` cost with a damage payoff — D381's
    // family), and its being refused here is what stops this anchor drifting toward it.
    const rows = legalAttackCorpus().filter(([, s]) => s === ALL_FOR_DAMAGE);
    expect([rows.length, units(rows)]).toEqual([1, 1]);
    // 🆕🆕 D419 — THE REFUSAL IS NOW ASSERTED OFF THE MODULE FIRST. The loop
    // below names WHICH reader broke and is kept for that; but it can only ever
    // walk the readers this file happens to list, which is the failure mode D418
    // measured in 38 files. This line walks whatever `effects.ts` exports today.
    expect(resolvedByAnyReader(ALL_FOR_DAMAGE), ALL_FOR_DAMAGE).toBe(false);
    for (const read of READERS) expect(read(ALL_FOR_DAMAGE), read.name).toBeNull();
  });
});

describe("D405 §2 — the program, and the two producers that must NOT be confused", () => {
  it("derives ONE already-shipped op with ONE already-shipped destination", () => {
    expect(deriveAttackEffect(TAKEN)).toEqual(PROGRAM);
  });

  it("🛑 NO `optional` WRAPPER — and the declinable twin still HAS one", () => {
    // THE RUNG THE SHAPE CALL TURNS ON. Both sentences reach `discardEnergy` with
    // `to: "hand"`; only one of them prints "You may", and that word is the entire
    // difference between a pick and a pick-or-decline. A wrapper added here would hand
    // the player a "No" this card does not print; a wrapper dropped there would take
    // away one the other card does.
    const mine = deriveAttackEffect(TAKEN) as { op: string }[];
    expect(mine.map((op) => op.op)).toEqual(["discardEnergy"]);
    const twin = deriveAttackEffect(MAY_TWIN) as { op: string; then?: unknown[] }[];
    expect(twin.map((op) => op.op)).toEqual(["optional"]);
    expect(twin[0]?.then).toEqual([
      { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" }, to: "hand" },
    ]);
  });

  it("⚠️ the absent `count` is the printed article, and it is ABSENT rather than 1", () => {
    // The op's doc says an absent count means one; a program that spelled `count: 1`
    // would be a different object and would not be byte-identical to the bare
    // self-discard's shape. This is the assertion that stops a "helpful" default being
    // written into the arm — and §5 is the one that proves the interpreter agrees.
    const [op] = deriveAttackEffect(TAKEN) as Record<string, unknown>[];
    expect(op).toBeDefined();
    expect(Object.hasOwn(op ?? {}, "count")).toBe(false);
    // …and the bare self-discard, which differs ONLY in the destination.
    expect(deriveAttackEffect("Discard an Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
  });
});

describe("D405 §3 — the refusals, each pinned on ONE printed token this anchor OWNS", () => {
  it("🛑 the POSSESSIVE, the ARTICLE, the SUBJECT and the VERB refuse INDEPENDENTLY", () => {
    // D399's rule: a near-miss the anchor already refuses for some OTHER reason proves
    // nothing about the byte you meant to test. Each string below differs from `TAKEN`
    // in exactly one token. THE POSITIVE CONTROL FIRST.
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
    // …the POSSESSIVE alone. "their hand" is the OPPONENT's zone, which is the twin's
    // destination on the twin's `from`; reading it here would put the attacker's own
    // Energy into the other player's hand.
    expect(
      deriveAttackEffect("Put an Energy attached to this Pokémon into their hand."),
    ).toBeNull();
    // …the ARTICLE alone (see §1: no such printing exists).
    expect(deriveAttackEffect("Put an Energy attached to this Pokémon into your deck.")).toBeNull();
    // …the SUBJECT alone: "your opponent's Active Pokémon" is a different body and a
    // different `from`, and this arm has no branch that could aim there.
    expect(
      deriveAttackEffect("Put an Energy attached to your opponent's Active Pokémon into your hand."),
    ).toBeNull();
    // …the VERB alone: "Discard" is arms 7/8/9's sentence and has no `to` at all.
    expect(deriveAttackEffect("Discard an Energy attached to this Pokémon into your hand.")).toBeNull();
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing clause is refused", () => {
    for (const text of [
      `Draw a card. ${TAKEN}`,
      `${TAKEN} Then, shuffle your deck.`,
      `${TAKEN} If you do, this attack does 60 more damage.`,
      `You may ${TAKEN[0]?.toLowerCase()}${TAKEN.slice(1)}`,
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      TAKEN.toLowerCase(),
      TAKEN.toUpperCase(),
      // The trailing period is required — the failure mode this repo names first,
      // because a regex written from a paraphrase matches no real card.
      "Put an Energy attached to this Pokémon into your hand",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. One fixture, and the ATTACHED Energy is the instrument.
// ─────────────────────────────────────────────────────────────────────────────

const attack = { type: "attack", seat: "p1", index: 0 } as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function activeEnergy(state: GameState, seat: Seat): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1 goes second, so their
    first turn carries no §4 attack restriction. P1 fields `fix-selfenergyhand`; P2's
    Active is a 200 HP neutral body the flat 30 never Knocks Out, so no KO tail can land
    between the pick and the hand write.

    ⚠️ **THE TWO SEATS DIFFER BEFORE ANY ASSERTION IS MADE ABOUT EITHER** (D380): only
    P1 ever attacks and only P1 ever holds the Energy under test, so a `seat` read off
    the wrong side cannot come back right by symmetry. */
function board(
  seed: number,
  attached: readonly string[],
  attacker = "fix-selfenergyhand",
): GameState {
  const setup = driveSetup(
    seed,
    { p1: SELF_ENERGY_HAND_DECK, p2: SELF_ENERGY_HAND_DECK },
    { first: "p2" },
  );
  let state = mustApply(setup, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attacker);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  for (const id of attached) state = attachFromDeck(state, "p1", id, 1);
  return state;
}

describe("D405 §4 — the FORCED board: one Energy, no prompt, and the card lands in the HAND", () => {
  it("🛑 resolves inline and the Energy is in the ATTACKER'S OWN HAND, in neither pile", () => {
    // THE RUNG THE DESTINATION TURNS ON. A build that fell back to the discard pile —
    // the op's own name, and its behaviour on every `from: "yourActive"` printing that
    // predates this slice — would satisfy every "the Energy left the body" assertion.
    // So the claim is made about THREE zones at once, by uid.
    const state = board(11, ["fix-energy"]);
    const [uid] = activeEnergy(state, "p1");
    expect(uid).toBeDefined();
    deepFreeze(state);

    const { state: done, events } = mustApply(state, attack);

    // The op asked NOTHING — one candidate is no decision (the M1 rule), so the whole
    // program resolved inside the attack and the turn is already over.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).toContain("ENERGY_DISCARDED");
    expect(activeEnergy(done, "p1")).toEqual([]);
    expect(done.players.p1.hand).toContain(uid);
    expect(done.players.p1.discard).not.toContain(uid);
    expect(done.players.p2.hand).not.toContain(uid);
    expect(done.players.p2.discard).not.toContain(uid);
  });

  it("the event names the victim, the actor and the DESTINATION", () => {
    const { events } = mustApply(board(12, ["fix-energy"]), attack);
    const row = find(events, "ENERGY_DISCARDED");
    // The victim IS the actor here — `discardVictimSeat` returns the controller for
    // `yourActive`, which is what makes the printed "your hand" need no seat branch.
    expect(row).toMatchObject({ seat: "p1", actor: "p1", from: { spot: "active" }, to: "hand" });
  });

  it("⚠️ the printed 30 still lands — nothing here is a damage reader", () => {
    // `programDamage` stays FALSE (neither op is a `damageDefender`), so the flat base
    // must survive §8.5 untouched. A base that ever came back 0 would mean a reader had
    // claimed a number this sentence never spends.
    const { state: done, events } = mustApply(board(13, ["fix-energy"]), attack);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 30 });
    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("D405 §5 — the PARK: a real decision, and exactly ONE card comes off", () => {
  it("🛑 two DIFFERENT prints park with scope `total 1` — the absent count, read", () => {
    // FIELD 2 OF THE HANDOFF, DRIVEN. The op's absent `count` is documented to mean
    // one; this is the board where a read site that took it for "all" would strip the
    // attacker of BOTH Energy, and where one that took it for "no cap" would offer an
    // unbounded pick. The scope is the interpreter's own answer to that question.
    const state = board(14, ["fix-energy", "fix-lightning-energy"]);
    const attached = activeEnergy(state, "p1");
    expect(attached).toHaveLength(2);
    deepFreeze(state);

    const { state: parked } = mustApply(state, attack);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.scope).toEqual({ kind: "total", count: 1 });
    expect(parked.phase.prompt.discardable.map((d) => d.uid).sort()).toEqual([...attached].sort());
    // Nothing has moved yet — the pick is a decision, not a formality.
    expect(activeEnergy(parked, "p1")).toEqual(attached);

    const chosen = attached[1] as string;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });
    // EXACTLY ONE came off, and it is the one that was PICKED — the other stayed put.
    expect(done.players.p1.hand).toContain(chosen);
    expect(activeEnergy(done, "p1")).toEqual([attached[0]]);
    expect(done.players.p1.discard).not.toContain(chosen);
  });

  it("⚠️ two IDENTICAL prints do NOT park — the interchangeable collapse", () => {
    // The other side of the same claim, and it is what makes the rung above a statement
    // about a DECISION rather than about a count: same two-Energy board, same op, and
    // no prompt at all, because the two candidates are the same printed card on the
    // same body. A build that switched the collapse off would prompt here.
    const state = board(15, ["fix-energy", "fix-energy"]);
    expect(activeEnergy(state, "p1")).toHaveLength(2);
    const { state: done } = mustApply(state, attack);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeEnergy(done, "p1")).toHaveLength(1);
    expect(done.players.p1.hand.filter((uid) => done.cardIdByUid[uid] === "fix-energy").length)
      .toBeGreaterThan(0);
  });

  it("🛑 the filter is `anyEnergy` — a SPECIAL Energy on the attacker is OFFERED", () => {
    // The filter is a field of the program and could plausibly have been written
    // `basicEnergy` (D402's noun is one member away). The printed sentence says
    // "an Energy" with no adjective, so a Special print must be pickable — this is the
    // one board where the two readings disagree.
    const state = board(16, ["fix-energy", "fix-special"]);
    const special = activeEnergy(state, "p1").find((uid) => state.cardIdByUid[uid] === "fix-special");
    expect(special).toBeDefined();
    const { state: parked } = mustApply(state, attack);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.discardable.map((d) => d.uid)).toContain(special);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [special as string] },
    });
    expect(done.players.p1.hand).toContain(special);
  });
});

describe("D405 §6 — the ORDER of the tail, and the turn that follows", () => {
  it("the op runs at the attack's TAIL and the epilogue is queued BEHIND the park", () => {
    const state = board(17, ["fix-energy", "fix-lightning-energy"]);
    const { state: parked, events: attackEvents } = mustApply(state, attack);
    // Damage first, then the decision — and the turn has NOT ended.
    expect(types(attackEvents)).toContain("DAMAGE_DEALT");
    expect(types(attackEvents)).not.toContain("ENERGY_DISCARDED");
    expect(types(attackEvents)).not.toContain("TURN_ENDED");
    expect(parked.pending.map((stage) => stage.kind)).toEqual(["attackEpilogue"]);

    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const chosen = parked.phase.prompt.discardable[0]?.uid as string;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });
    // …and only THEN the §5.3 tail ran, in one batch.
    expect(types(events)).toEqual(["ENERGY_DISCARDED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });
});

describe("D405 §7 — the CAPTION, which is the falsifier that FIRED", () => {
  it("🛑 the prompt is the PRINTED SENTENCE, not the word 'Discard'", () => {
    // FIELD 1 OF THE HANDOFF. `discardNote`'s `yourActive` arm read only `shuffleBack`
    // before this slice, so this park would have captioned itself
    // "Discard an Energy from this Pokémon." — the board right and the one screen that
    // tells the player what their pick does WRONG, and here wrong about who KEEPS the
    // card rather than merely about where it lands. The expectation is the corpus
    // sentence itself, so a caption that drifted from print fails by construction.
    const state = board(18, ["fix-energy", "fix-lightning-energy"]);
    const { state: parked } = mustApply(state, attack);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.note).toBe(TAKEN);
  });

  it("⚠️ THE CONTROL: the BARE self-discard's caption is UNMOVED, on the same arm", () => {
    // What stops a fix that simply captions every own-board pick the new way (D295's
    // own paired control, one destination over). Charcadet `sv01-039` "Ember" prints
    // *"Discard an Energy from this Pokémon."* — the SAME op, the SAME `from`, the SAME
    // filter, and the same `case "yourActive"` of the same switch. The destination is
    // the only field between the two programs, so this is the sharpest control the
    // caption has: both notes come out of one arm and they must differ.
    const state = board(19, ["fix-fire-energy", "fix-energy"], "sv01-039");
    const { state: parked } = mustApply(state, attack);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.note).toBe("Discard an Energy from this Pokémon.");
    // …and the Energy really does land in the PILE for that card, not in the hand —
    // the destination and the caption move together or the pair proves nothing.
    const chosen = parked.phase.prompt.discardable[0]?.uid as string;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });
    expect(done.players.p1.discard).toContain(chosen);
    expect(done.players.p1.hand).not.toContain(chosen);
  });
});
