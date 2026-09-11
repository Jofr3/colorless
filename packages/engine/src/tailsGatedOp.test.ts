import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  TAILS_GATE_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  types,
  walkProgram,
} from "./testFixtures";

// 0.92.0 → 0.93.0 — the TAILS GATE (P3-M5 long tail, D144):
//
//   "Flip a coin. If tails, during your next turn, this Pokémon can't attack."
//                                                              (5 printings)
//
// Item 1 of D143's remainder list, and the cheapest slice this family has taken:
// D132's INVENTORY RULE ON BOTH HALVES AT ONCE. The consequent is D143's
// `preventAttack`; the gate is `coinFlipGate`, which has spliced a branch into the
// work queue since 0.x; and the ONLY thing that did not exist is WHICH FACE
// unshifts the branch. One optional field, one regex, one deriver arm, one
// comparison in `runProgram` — and no `attack.ts` / `types.ts` / `continuous.ts` /
// `redact.ts` / `turn.ts` / `events.ts` / `log.ts` diff at all.
//
// Four things this file is really about:
//
//   • THE LOSING FACE IS THE ONE THAT DOES SOMETHING. Every other gated sentence
//     in the pool pays out on heads, so "nothing happened" and "the coin missed"
//     look the same from a board delta. Here they are INVERTED: a build that
//     ignored the field would install the drawback on exactly the declarations
//     that did NOT earn it, silently, with the printed damage landing either way
//     and nothing on the board looking wrong. Both faces are therefore driven end
//     to end, across the turn boundary, for every claim;
//   • THE INDEX IS NOT CONSTANT ACROSS THE FIVE PRINTINGS — 1 on the three
//     Oinkologne printings and 0 on the two Paldean Clodsire ex ones. No list said
//     so. Both fixtures are here for that reason and every case sweeps them;
//   • THE FIELD IS ABSENT, NEVER `false`, on the eight heads-gated programs the
//     engine already emits — swept over the pool rather than asserted at one site,
//     because the derived shapes are compared by value against registry rows;
//   • `cardplay.ts`'s `programPlayable` DESCENDS INTO `then`, and its argument
//     never mentioned a face. That is the shape this engine has three times found
//     to be an accident (D139 → D140 → D143's `placeSnipe` comment), so it is
//     asserted here rather than left in a comment.

const TAILS_TEXT = "Flip a coin. If tails, during your next turn, this Pokémon can't attack.";
/** D143's BARE printing of the SAME rider — the `then` this gate must wrap byte
    for byte, and the cross-family control every window case is measured against. */
const BARE_TEXT = "During your next turn, this Pokémon can't attack.";

/** Seeds on which the install flip comes up TAILS — i.e. on which the LOCK lands —
    measured over [1..40] on `TAILS_GATE_DECK`, and the SAME list for both gated
    installers because the install is the first coin either board draws after setup
    and every surgery below consumes no rng. Pinned by its own case, so a deck edit
    that shifts the shuffle fails loudly here instead of silently turning the
    cross-turn assertions vacuous. */
const TAILS_SEEDS = [
  1, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 17, 19, 21, 24, 25, 26, 31, 32, 33, 37, 39, 40,
] as const;
/** …and the complement — the face on which NOTHING is installed, which on this
    sentence is the interesting half. */
const HEADS_SEEDS = [2, 3, 7, 11, 16, 18, 20, 22, 23, 27, 28, 29, 30, 34, 35, 36, 38] as const;

/** The two gated fixtures, with the INDEX and the printed damage each carries —
    the family's two indices, which is the fact no remainder list mentioned. */
const INSTALLERS = [
  { id: "sv01-157", index: 1, damage: 130, attack: "Leg Stomp" },
  { id: "sv02-130", index: 0, damage: 200, attack: "Needle Bone" },
] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. P2's
    Active is fix-titan (340 HP, NO attacks) so no install can end the turn on a
    Knock Out and derail a window assertion, and no defender attack interleaves
    rows. The installer goes on P1's Active with exactly the Energy its printed
    attack costs — and NONE of these surgeries touch `rngState`, which is what
    makes one seed table right for every installer. */
function armed(seed: number, installer: string): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: TAILS_GATE_DECK, p2: TAILS_GATE_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = setActiveFromDeck(state, "p1", installer);
  if (state.players.p1.bench.length === 0) throw new Error("armed() left P1 with no bench");
  if (state.turn !== 2) throw new Error(`armed() expected turn 2, got ${state.turn}`);
  if (installer === "sv01-157") return attachFromDeck(state, "p1", "fix-energy", 3);
  if (installer === "sv02-130") {
    return attachFromDeck(attachFromDeck(state, "p1", "fix-dark-energy", 1), "p1", "fix-energy", 2);
  }
  // sv01-048 Alomomola — D143's bare sentence, {W}{W}{C}.
  return attachFromDeck(attachFromDeck(state, "p1", "fix-water-energy", 2), "p1", "fix-energy", 1);
}

/** `armed`, then the install declared — the board every cross-turn case starts
    from. ASSERTS the coin actually came up tails rather than trusting the seed
    table, so a shuffle drift can never leave a case asserting "nothing was
    refused" against a board that never locked anything. Returns P2's turn 3. */
function installed(seed: number, installer: string, index: number): GameState {
  const { state, events } = mustApply(armed(seed, installer), {
    type: "attack",
    seat: "p1",
    index,
  });
  if (find(events, "ATTACK_LOCKED") === undefined) {
    throw new Error(`seed ${seed} did not lock ${installer} (heads?)`);
  }
  if (state.turn !== 3) throw new Error(`expected P2's turn 3, got ${state.turn}`);
  return state;
}

/** Hand the turn back to P1 — the LOCKED turn, `state.turn + 2` from the install. */
function heldTurn(state: GameState): GameState {
  const next = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (next.turn !== 4) throw new Error(`expected the holder's turn 4, got ${next.turn}`);
  return next;
}

/** The engine's rejection code for an attack, or `"ok"`. */
function refusal(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? "ok" : result.error.code;
}

/** The face this declaration's ONE coin came up. Throws when there was no flip —
    a gate that stopped flipping would otherwise read as a permanent heads. */
function faceOf(events: GameEvent[]): "heads" | "tails" {
  const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
  if (flip === undefined) throw new Error("no ATTACK_EFFECT_COIN_FLIP row");
  return flip.result;
}

describe("the tails gate — derived, not authored", () => {
  it("derives the sentence to a coinFlipGate carrying `onTails`", () => {
    expect(deriveAttackEffect(TAILS_TEXT)).toEqual([
      {
        op: "coinFlipGate",
        onTails: true,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "preventAttack" }],
      },
    ]);
    // The key set, not just the value: the op takes NO other field, and `toEqual`
    // alone would not catch a stray one.
    const op = (deriveAttackEffect(TAILS_TEXT) as EffectOp[])[0] as object;
    expect(Object.keys(op).sort()).toEqual(["onTails", "op", "then"]);
  });

  it("wraps D143's BARE program byte for byte — one action, printed three ways", () => {
    // ⚠️ THE CLAIM OF THE WHOLE SLICE, and D134's claim on the other face: the
    // gated program's `then` is IDENTICAL to what the bare sentence derives, so
    // there is one action here and the coin is procedure in front of it — not a
    // modifier on the op, not a second op, not a new union member.
    const gated = deriveAttackEffect(TAILS_TEXT) as EffectOp[];
    expect(gated).toHaveLength(1);
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    expect(gated[0]).toMatchObject({ then: deriveAttackEffect(BARE_TEXT) });
    // …and the two anchors are NOT the same reading: the bare one derives a naked
    // op, the gated one a gate. A reader that let either claim the other's string
    // would return the inner op unwrapped (or wrap a sentence with no coin in it).
    expect(deriveAttackEffect(BARE_TEXT)).toEqual([{ op: "preventAttack" }]);
    expect(deriveAttackEffect(TAILS_TEXT)).not.toEqual(deriveAttackEffect(BARE_TEXT));
  });

  it("derives the U+2019 spelling IDENTICALLY (D136/D137)", () => {
    // The exposed slot is the CONTRACTION "can't" — the same slot D137 found two
    // whole tables missing — and the assertion is EQUALITY with the straight form,
    // never merely non-null.
    const curly = TAILS_TEXT.replace(/'/g, "’");
    expect(curly).not.toBe(TAILS_TEXT);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(TAILS_TEXT));
  });

  it("is anchored end to end", () => {
    for (const text of [
      `Then, ${TAILS_TEXT}`,
      `${TAILS_TEXT} Draw a card.`,
      TAILS_TEXT.slice(0, -1),
      TAILS_TEXT.toLowerCase(),
      // The two sentences joined without the printed space.
      TAILS_TEXT.replace(". If", ".If"),
      // ⚠️ THE HEADS SPELLING IS NOT PRINTED ANYWHERE IN THE POOL, so it stays
      // LOUD rather than deriving to the same op without the field. Mapping it
      // would invent a reading the ingest has never produced — this file's whole
      // rule, and the one that keeps the field honest.
      TAILS_TEXT.replace("If tails", "If heads"),
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), which states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${TAILS_TEXT}\n`)).toEqual(deriveAttackEffect(TAILS_TEXT));
  });

  it("keeps the `onTails` field ABSENT on every heads-gated program the engine emits", () => {
    // ⚠️ D135's ABSENT-FIELD RULE, SWEPT RATHER THAN SAMPLED. The derived shapes
    // are compared by value against hand-authored registry rows (Pokémon Catcher's
    // `{ op: "coinFlipGate", then: [{ op: "gust" }] }`), so an explicit
    // `onTails: false` — or `undefined` — would break `toEqual` identity across
    // the whole engine, in a way that only shows up in whichever suite compares
    // that particular row. Discovered from the pool + the registry, so a gate
    // added by a later slice is swept the day it lands.
    // 🆕 D276 — THROUGH THE SHARED `walkProgram`, WHICH FINDS A BRANCH BY SHAPE.
    // The hand-rolled recursion this replaces descended `coinFlipGate.then`,
    // `conditionGate`'s two arms and `recordGate`'s two — and NOT
    // `coinFlipGate.otherwise` (the gap D269 flagged) nor `optional.then` (the
    // one that was actually live). A gate hidden under either was invisible to
    // this sweep, and a sweep that reaches less goes GREEN, not red.
    const gates: { where: string; op: Extract<EffectOp, { op: "coinFlipGate" }> }[] = [];
    const walk = (where: string, ops: readonly EffectOp[]) => {
      for (const op of walkProgram(ops)) {
        if (op.op === "coinFlipGate") gates.push({ where, op });
      }
    };
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walk(`${id} attack ${index}`, derived);
      }
      const authored = programFor(id);
      for (const [index, ops] of Object.entries(authored?.attack ?? {})) {
        walk(`${id} authored attack ${index}`, ops);
      }
      for (const ability of authored?.abilities ?? []) {
        walk(`${id} ${ability.name}`, ability.program);
      }
      walk(`${id} trainer`, authored?.trainer ?? []);
    }
    // The sweep found something — otherwise every assertion below is vacuous,
    // which is the failure mode a "no bad rows" test has by construction.
    expect(gates.length).toBeGreaterThan(3);
    const tailsGates = gates.filter((g) => g.op.onTails === true);
    const headsGates = gates.filter((g) => g.op.onTails !== true);
    expect(tailsGates.length).toBeGreaterThan(0);
    expect(headsGates.length).toBeGreaterThan(0);
    // ⚠️ ABSENT, not `false` and not `undefined`: the KEY must not be present.
    for (const { where, op } of headsGates) {
      expect(Object.keys(op), `${where} carries an onTails key`).not.toContain("onTails");
    }
    // …and every tails gate in the whole engine comes off one of the THREE bare
    // tails-gated sentences — this one (D144) and the two self-costs D145 added.
    // Stated as the producer SET rather than as a per-row predicate, so a fourth
    // producer fails here loudly instead of being quietly absorbed. The family is
    // CLOSED (8 printings / 3 sentences), so there should never be a fourth
    // without a new census in front of it.
    const producers = new Set(tailsGates.map((g) => g.where.split(" ")[0]));
    expect([...producers].sort()).toEqual(["sv01-157", "sv02-063", "sv02-130", "sv03-054", "sv03-183"]);
  });

  it("refuses the OTHER FIVE tails-carrying sentences in the pool", () => {
    // Every one is real text off the local D1 (2026-08-02, 978 cards / 6 sets) — the census
    // this slice ran for the TAILS FACE as its own question, rather than reading
    // D143's conclusion, which had counted these five as refusals of the "can't
    // attack" question and therefore says nothing about the face. 28 printings
    // carry a tails consequent; this arm takes 5, and each refusal below is a
    // property of the anchor rather than luck. THE STANDING NOTE: when a later
    // slice maps one of these, RE-POINT the row at another unmapped one — never
    // delete it (D143 re-pointed three and deleted none).
    //
    // ⚠️ TWO ROWS LEFT THIS LIST AT D145 AND NEITHER WAS DELETED — the tails
    // gate's two unmapped siblings (Pikachu ex sv02-063 / Beartic sv03-054's
    // "discard all Energy", Oinkologne sv03-183's 60 to itself) were exactly ONE
    // regex and ONE arm away, as this file predicted, and they moved to SHAPE
    // claims in the case below rather than out of the suite. What remains is
    // FIVE, four of them unmapped by any reader; the bare tails-gated family is
    // CLOSED at 3 sentences / 8 printings, so this list can only shrink again
    // once a MECHANISM arrives (an `otherwise`, or an opponent-side durated flip).
    for (const text of [
      // ALREADY SIMULATED, by a DIFFERENT reader: `deriveAttackCoinFlip`'s
      // `cancelOnTails` (D126, 11 printings), which runs in FRONT of the §8.5
      // pipeline because it retracts damage. The engine's other tails reading, and
      // the two are disjoint by consequent exactly as the heads pair is.
      "Flip a coin. If tails, this attack does nothing.",
      // A DURATED gate that makes the OPPONENT flip on their own turn (4 printings
      // — Dolliv sv01-022/-200 "Apply Oil", Quaxly sv02-049/-206 "Apply Gel"). The
      // only tails-gated attack LOCK in the pool this op could not express even
      // with the field.
      "During your opponent's next turn, if the Defending Pokémon tries to attack, your opponent flips a coin. If tails, that attack doesn't happen.",
      // TWO consequents on ONE flip — an `otherwise` this op deliberately does not
      // have (D142's Squawkabilly refusal, verbatim). Note the field brings none
      // of these closer: an `onTails` gate still runs exactly one branch.
      "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.",
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck. If tails, discard a card from your hand.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("costs zero registry rows — both fixtures simulate off their printed text", () => {
    // `programFor(id)?.attack` rather than `programFor(id)`: a row on the CARD is
    // not a row on the ATTACK (D139/D140). Neither card has either.
    for (const { id } of INSTALLERS) expect(programFor(id)).toBeUndefined();
  });

  it("keeps the fixtures' printed text verbatim — and the family's TWO indices", () => {
    // ⚠️ THE INDEX IS A CHECKED FACT AND IT IS NOT CONSTANT: 1 on the Oinkologne
    // printings and 0 on the Clodsire ones. A suite pinned to either number alone
    // would simulate the wrong attack on two of the five printings (D139's Pour
    // Tea, D143's Nine-Tailed Dance — the third slice running to find this).
    expect(FIXTURE_POOL["sv01-157"]?.attacks?.[1]).toEqual({
      cost: ["Colorless", "Colorless", "Colorless"],
      name: "Leg Stomp",
      damage: 130,
      effect: TAILS_TEXT,
    });
    expect(FIXTURE_POOL["sv02-130"]?.attacks?.[0]).toEqual({
      cost: ["Darkness", "Colorless", "Colorless"],
      name: "Needle Bone",
      damage: 200,
      effect: TAILS_TEXT,
    });
    // Oinkologne's index-0 "Ram" is a plain hit with NO effect text: the control
    // that proves no program leaks across indices, AND the attack a locked body is
    // refused. Clodsire has no second attack at all, which is why the "locks the
    // Pokémon, not the attack" claim is made on Oinkologne.
    expect(FIXTURE_POOL["sv01-157"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv02-130"]?.attacks).toHaveLength(1);
    // Every printing carries a FLAT printed `damage` and no "+"/"×" marker, so
    // `modifierSimulated` (attack.ts) is untouched by this family and the drawback
    // really is the whole of the effect text.
    for (const { id, index, damage } of INSTALLERS) {
      expect(FIXTURE_POOL[id]?.attacks?.[index]?.damage).toBe(damage);
    }
    expect(TAILS_TEXT).toContain("can't");
    expect(TAILS_TEXT).not.toContain("’");
  });
});

describe("the tails gate — the seed table, pinned", () => {
  it("lands the face the table claims, on both installers, for every seed", () => {
    // ⚠️ WITHOUT THIS, EVERY CROSS-TURN CASE BELOW COULD BE VACUOUS. A deck edit
    // that reshuffles the boards would silently move the faces, and a case that
    // expected a lock and found none would still pass its "not locked" half.
    for (const { id, index } of INSTALLERS) {
      for (const seed of TAILS_SEEDS) {
        expect(faceOf(mustApply(armed(seed, id), { type: "attack", seat: "p1", index }).events)).toBe(
          "tails",
        );
      }
      for (const seed of HEADS_SEEDS) {
        expect(faceOf(mustApply(armed(seed, id), { type: "attack", seat: "p1", index }).events)).toBe(
          "heads",
        );
      }
    }
    // ONE TABLE FOR BOTH INSTALLERS, and the reason is structural rather than
    // lucky: the install is the first coin either board draws after setup, and
    // every surgery in `armed` (setActiveFromDeck, attachFromDeck) is pure. The
    // two lists are disjoint and cover [1..40] between them.
    expect([...TAILS_SEEDS, ...HEADS_SEEDS].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, i) => i + 1),
    );
  });

  it("takes the coin on BOTH faces — `rngState` advances either way", () => {
    // The property that keeps an ONLINE match in step, and the one a local suite
    // asserting only board deltas cannot see: `coinFlipGate` flips FIRST and
    // splices second, so a heads (which does nothing here) still spends the draw.
    // A build that checked the face before flipping would desynchronise the next
    // coin for both players.
    for (const seed of [TAILS_SEEDS[0], HEADS_SEEDS[0]]) {
      const before = armed(seed, "sv01-157");
      const { state: done } = mustApply(before, { type: "attack", seat: "p1", index: 1 });
      expect(done.rngState).not.toBe(before.rngState);
    }
    // …and D143's BARE sentence on the SAME deck takes NO coin at all, which is
    // what makes "the flip belongs to the gate" a claim rather than a coincidence
    // of this deck's shuffle.
    const bare = armed(TAILS_SEEDS[0], "sv01-048");
    const { state: done, events } = mustApply(bare, { type: "attack", seat: "p1", index: 1 });
    expect(done.rngState).toBe(bare.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(find(events, "ATTACK_LOCKED")).toBeDefined();
  });
});

describe("the tails gate — installing it, on BOTH faces", () => {
  it("TAILS installs the lock and stamps `state.turn + 2`", () => {
    for (const [i, { id, index, damage }] of INSTALLERS.entries()) {
      const state = armed(TAILS_SEEDS[i] as number, id);
      const installer = activeUid(state, "p1");
      expect(state.turn).toBe(2);
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });

      expect(faceOf(events)).toBe("tails");
      expect(find(events, "ATTACK_LOCKED")).toEqual({
        type: "ATTACK_LOCKED",
        seat: "p1",
        uid: installer,
      });
      // D143's window, unchanged: turn 2 installed it, turn 3 is the OPPONENT's
      // (declaring an attack ends the turn, §5.3), turn 4 is the printed one.
      expect(done.players.p1.active?.attackLockedTurn).toBe(4);
      expect(done.turn).toBe(3);
      // The printed damage lands on BOTH faces — the coin gates the drawback and
      // nothing else, which is exactly why a board delta cannot tell the faces
      // apart and why the lock row is the only witness.
      expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(damage);
      // Attacker-relative: nothing on the opponent's board carries a lock.
      expect(done.players.p2.active?.attackLockedTurn).toBeNull();
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("HEADS installs NOTHING — the same declaration, the same damage, no lock", () => {
    // ⚠️ THE WHOLE SLICE, AND THE MUTATION TOMBSTONE. A build that dropped
    // `onTails` (or left `runProgram` comparing against "heads") passes every
    // assertion in the case above and fails here — and in play it would install
    // the drawback on precisely the declarations that did not earn it, with the
    // printed damage landing either way and nothing on the board looking wrong.
    for (const [i, { id, index, damage }] of INSTALLERS.entries()) {
      const { state: done, events } = mustApply(armed(HEADS_SEEDS[i] as number, id), {
        type: "attack",
        seat: "p1",
        index,
      });
      expect(faceOf(events)).toBe("heads");
      expect(types(events)).not.toContain("ATTACK_LOCKED");
      expect(done.players.p1.active?.attackLockedTurn).toBeNull();
      expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(damage);
      // A HEADS IS NOT A SKIPPED EFFECT (D134's rule, on the other face): the
      // sentence WAS read and the coin decided. The loud row would be a lie.
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("does not inherit down the attack index — Oinkologne's index 0 flips nothing", () => {
    // "Ram" carries no effect text at all, so the declaration takes no coin and
    // installs nothing. The control that proves a program does not leak across
    // indices on a card where one attack has one.
    const { state: done, events } = mustApply(armed(TAILS_SEEDS[0], "sv01-157"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ATTACK_LOCKED");
    expect(done.players.p1.active?.attackLockedTurn).toBeNull();
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(50);
  });

  it("reads correctly in the LOG — the coin row and the cost row, in that order", () => {
    // ⚠️ THE VOICE QUESTION, DRIVEN RATHER THAN ARGUED. Two rows land on one
    // declaration and they are voiced differently on purpose: the flip is a
    // NEUTRAL fact about the actor ("flipped tails for the effect", shared with
    // every Trainer coin since M5), the lock is the ACTIVE voice reporting a cost
    // the player just paid — the only durated row in the engine that does. Read in
    // sequence under a real name, they have to say who did what to whom, and this
    // is the one sentence in the family where the coin's LOSING face is the one
    // that caused the second row.
    const names: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
    const { state: done, events } = mustApply(armed(TAILS_SEEDS[0], "sv01-157"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const ctx: LogContext = { names, state: done, elapsed: "+00:07" };
    const text = logFromEvents(events, ctx)
      .filter((entry) => entry.kind !== "turn")
      .map((entry) => entry.segments.map((s) => s.text).join(""));
    expect(text).toContain("flipped tails for the effect");
    expect(text).toContain("Oinkologne can't attack next turn");
    // ORDER: the attack, then the damage it dealt, then the coin, then the cost.
    const at = (needle: string) => text.findIndex((line) => line.includes(needle));
    expect(at("used")).toBeLessThan(at("flipped tails"));
    expect(at("flipped tails")).toBeLessThan(at("can't attack next turn"));
    // …and the HEADS declaration produces the coin row and NOT the cost row, so
    // the log tells the two faces apart even though the board cannot.
    const heads = mustApply(armed(HEADS_SEEDS[0], "sv01-157"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const headsText = logFromEvents(heads.events, {
      names,
      state: heads.state,
      elapsed: "+00:07",
    }).map((entry) => (entry.kind === "turn" ? "" : entry.segments.map((s) => s.text).join("")));
    expect(headsText).toContain("flipped heads for the effect");
    expect(headsText.some((line) => line.includes("can't attack next turn"))).toBe(false);
  });
});

describe("the tails gate — the WINDOW, driven across the turn boundary on both faces", () => {
  it("TAILS: not live on the opponent's turn, refuses BOTH attacks on the window turn", () => {
    const state = installed(TAILS_SEEDS[1] as number, "sv01-157", 1);
    expect(state.turn).toBe(3);
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);

    const held = heldTurn(state);
    expect(held.players.p1.active?.attackLockedTurn).toBe(held.turn);
    // ⚠️ THE LOCK IS ON THE POKÉMON, NOT ON THE ATTACK. Index 1 installed it and
    // index 0 is a different attack on the same card — both are refused. That is
    // the assertion separating this family from the eight "can't use {AttackName}"
    // printings the engine deliberately leaves LOUD, inherited from D143 and
    // re-made here because the gate is a different producer of the same op.
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    expect(refusal(held, "p1", 0)).toBe("ATTACK_PREVENTED");
  });

  it("TAILS: it is a REJECTION — nothing is spent and the turn stays", () => {
    const held = heldTurn(installed(TAILS_SEEDS[2] as number, "sv01-157", 1));
    deepFreeze(held);
    const result = applyAction(held, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ATTACK_PREVENTED");
      expect(result.error.message).toContain("§11");
    }
    expect(held.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(held.players.p1.active?.energy).toHaveLength(3);
  });

  it("TAILS: the coin is spent ONCE, at the install — nothing between draws again", () => {
    // ⚠️ A CLAIM D143's SEED-FREE SUITE STRUCTURALLY COULD NOT MAKE, and only a
    // family that flips can. The install's flip is the ONE draw the whole window
    // costs: two turn ENDS with their Checkups, an opponent's entire turn and a
    // refused declaration all happen in between, and `rngState` is where the
    // install left it. A §8 gate placed AFTER the coin — the shape a session
    // "simplifying" the gate into the program would write — would burn a draw on
    // every refused button press and leave the two players' streams apart for the
    // rest of an ONLINE match, with no board delta to notice it by.
    const seed = TAILS_SEEDS[7] as number;
    const afterInstall = installed(seed, "sv01-157", 1);
    const held = heldTurn(afterInstall);
    expect(held.rngState).toBe(afterInstall.rngState);
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    // …and the NEXT legal declaration, two turns on, takes exactly one more.
    let later = must(applyAction(held, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.rngState).toBe(afterInstall.rngState);
    const { state: done, events } = mustApply(later, { type: "attack", seat: "p1", index: 1 });
    expect(types(events).filter((t) => t === "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
    expect(done.rngState).not.toBe(later.rngState);
  });

  it("HEADS: the holder attacks freely on the turn a tails would have locked", () => {
    // ⚠️ THE OTHER HALF OF THE TOMBSTONE, and the one that can only be driven
    // across a turn boundary. On the heads seeds turn 4 is an ordinary turn, and
    // the SAME attack that was refused above resolves — coin, damage and all.
    let state = mustApply(armed(HEADS_SEEDS[1] as number, "sv01-157"), {
      type: "attack",
      seat: "p1",
      index: 1,
    }).state;
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
    state = heldTurn(state);
    expect(refusal(state, "p1", 1)).toBe("ok");
    expect(refusal(state, "p1", 0)).toBe("ok");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(130);
    expect(faceOf(events)).toBeTruthy();
  });

  it("TAILS: expires by arithmetic — the holder attacks again two turns later", () => {
    let state = heldTurn(installed(TAILS_SEEDS[3] as number, "sv02-130", 0));
    expect(refusal(state, "p1", 0)).toBe("ATTACK_PREVENTED");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(6);
    // The stale stamp stays and answers nothing — no boundary clear, D142's rule.
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(200);
    // …and the fresh flip decides the NEXT window on its own, whichever way it
    // fell: the two declarations are independent coins.
    expect(faceOf(events)).toBeTruthy();
  });

  it("is NOT a §12 condition — a different code, and no status anywhere", () => {
    const held = heldTurn(installed(TAILS_SEEDS[4] as number, "sv01-157", 1));
    expect(held.players.p1.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    // The §12 gate one line above it in `attack.ts` reports its own code, and the
    // ORDER is deliberate (D143): an Asleep AND locked Pokémon says Asleep.
    expect(refusal(setConditions(held, "p1", { rotation: "asleep" }), "p1", 1)).toBe(
      "STATUS_PREVENTS_ATTACK",
    );
  });

  it("the HUD projection agrees with the gate on BOTH faces, attack by attack", () => {
    // ⚠️ NOT DECORATION, AND NOT NEW WORK EITHER — D143 installed both projections
    // (`redactedAttacksOf`'s `banned` and GameHud's `disabled`) and this slice adds
    // no gate, so what is owed here is EVIDENCE that the new producer reaches the
    // same line. Swept over both attacks in both directions and on both faces,
    // because a projection that agreed only under a lock would be untestable.
    const locked = redactGame(heldTurn(installed(TAILS_SEEDS[5] as number, "sv01-157", 1)), "p1")
      .phase;
    if (locked.kind !== "turn:action") throw new Error(`expected turn:action, got ${locked.kind}`);
    expect(locked.attacks).toHaveLength(2);
    for (const attack of locked.attacks) {
      expect(attack.playable, `attack ${attack.index} offered under a lock`).toBe(false);
    }
    // The HEADS board on the SAME turn offers them — so the assertion above is
    // about the lock rather than about an unpayable cost or a §4 ban.
    const free = redactGame(
      heldTurn(
        mustApply(armed(HEADS_SEEDS[2] as number, "sv01-157"), {
          type: "attack",
          seat: "p1",
          index: 1,
        }).state,
      ),
      "p1",
    ).phase;
    if (free.kind !== "turn:action") throw new Error(`expected turn:action, got ${free.kind}`);
    expect(free.attacks.some((a) => a.playable)).toBe(true);
  });

  it("§10 clears it early — retreating out of a tails-installed lock", () => {
    // The gate produces D143's op, so it inherits D143's three §10 clear sites
    // unchanged; `attackLock.test.ts` SWEEPS all three against the whole
    // §10-sheddable field set and that case is the one a fourth stamped field
    // fails. What is worth driving HERE is that a lock installed through the gate
    // is the same lock — retreat it out and the drawback is gone.
    let held = heldTurn(installed(TAILS_SEEDS[6] as number, "sv01-157", 1));
    const locked = activeUid(held, "p1");
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    held = must(
      applyAction(held, {
        type: "retreat",
        seat: "p1",
        discardEnergy: (held.players.p1.active?.energy ?? []).slice(0, 2),
        promoteBenchIndex: 0,
      }),
    );
    expect(held.players.p1.bench.find((p) => p.stack.includes(locked))?.attackLockedTurn).toBeNull();
  });
});

describe("the tails gate — `programPlayable` is FACE-AGNOSTIC, asserted", () => {
  it("refuses a card whose TAILS branch could only whiff, exactly as a heads one", () => {
    // ⚠️ THE GUARD THAT WOULD OTHERWISE BE AN ACCIDENT (D139 → D140 → D143's
    // `placeSnipe` comment — three slices running). `programPlayable` descends
    // into `then` on the strength of "a coin gate has no `otherwise`, so `then` is
    // the only thing the card can ever do", and that argument never mentions WHICH
    // face splices it. True for `onTails` too — but true-by-argument is exactly
    // the state the last three findings were in, so it is driven.
    //
    // A CONSTRUCTED PROGRAM, and honestly so: the pool's only tails-gated TRAINER
    // (Egg Incubator swsh10.5-066/-087) is a two-consequent sentence this op
    // cannot express, so there is no card to drive and the rule is asserted where
    // it lives.
    const state = armed(HEADS_SEEDS[3] as number, "sv01-157");
    const emptyBench = {
      ...state,
      players: {
        ...state.players,
        p2: { ...state.players.p2, bench: [] },
      },
    };
    expect(emptyBench.players.p2.bench).toHaveLength(0);
    const gust: EffectOp[] = [{ op: "gust" }];
    // The bare op is unplayable into an empty opponent Bench (Pokémon Catcher's
    // own rule), which is what makes the two gated forms below say anything.
    expect(programPlayable(emptyBench, gust, "p1")).toBe(false);
    for (const onTails of [undefined, true] as const) {
      const gated: EffectOp[] =
        onTails === undefined
          ? // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
            [{ op: "coinFlipGate", then: gust }]
          : // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
            [{ op: "coinFlipGate", onTails, then: gust }];
      expect(programPlayable(emptyBench, gated, "p1"), `onTails=${String(onTails)}`).toBe(false);
      // …and PLAYABLE again the moment the branch has a target, on both faces —
      // so the refusal above is about the empty Bench and not about the gate.
      expect(programPlayable(state, gated, "p1"), `onTails=${String(onTails)} (bench)`).toBe(true);
    }
  });
});

describe("the tails gate — the census, asserted as a shape", () => {
  it("pins 5 printings on ONE sentence, and the tails SHAPE at 8 across 3", () => {
    // The numbers the slice claims and the numbers a re-census has to reproduce
    // (local D1, 2026-08-02, 978 cards / 6 sets). `attacks_json LIKE '%if tails%'` returns
    // 26 printings / 8 sentences, plus 2 on a Trainer and 0 on any Ability = 28.
    // Exactly THREE of those sentences are a bare "Flip a coin. If tails, <one
    // consequent>." — the shape the FIELD buys — and they are 8 printings.
    const PRINTINGS = [
      { id: "sv01-157", name: "Oinkologne", index: 1 },
      { id: "sv01-158", name: "Oinkologne ex", index: 1 },
      { id: "sv01-234", name: "Oinkologne ex", index: 1 },
      { id: "sv02-130", name: "Paldean Clodsire ex", index: 0 },
      { id: "sv02-244", name: "Paldean Clodsire ex", index: 0 },
    ] as const;
    expect(PRINTINGS).toHaveLength(5);
    // TWO indices across five printings, which is the fact the resume list did not
    // carry and the reason this suite has two fixtures rather than one.
    expect(new Set(PRINTINGS.map((p) => p.index))).toEqual(new Set([0, 1]));
    // Both fixtures are real members of that list, at the index it claims.
    for (const { id } of INSTALLERS) {
      const row = PRINTINGS.find((p) => p.id === id);
      expect(row).toBeDefined();
      expect(FIXTURE_POOL[id]?.attacks?.[row?.index ?? -1]?.effect).toBe(TAILS_TEXT);
    }
    // ⚠️ THE SHAPE GENERALISED, AND IT WAS SPENT ONE SLICE LATER. The evidence for
    // a FIELD over a sibling op member was that the other two sentences' consequent
    // ops already existed, so each was one regex and one arm away — D145 wrote both
    // arms and the family is now CLOSED at 3 sentences / 8 printings. The two rows
    // that used to make a NULL claim here are RE-POINTED to the strictly stronger
    // SHAPE claim (D144's own move, applied to D144's own witnesses): each gated
    // program's `then` is the bare anchor's output, byte for byte.
    expect(deriveAttackEffect("Discard all Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ]);
    expect(deriveAttackEffect("This Pokémon also does 60 damage to itself.")).toEqual([
      { op: "damageSelf", amount: 60 },
    ]);
    for (const [gated, bare] of [
      ["Flip a coin. If tails, discard all Energy from this Pokémon.", "Discard all Energy from this Pokémon."],
      [
        "Flip a coin. If tails, this Pokémon also does 60 damage to itself.",
        "This Pokémon also does 60 damage to itself.",
      ],
    ] as const) {
      expect(deriveAttackEffect(gated), gated).toEqual([
        {
          op: "coinFlipGate",
          onTails: true,
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: deriveAttackEffect(bare),
        },
      ]);
    }
  });
});
