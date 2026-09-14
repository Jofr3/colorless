import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { attackReaderSurface, resolvedByAnyReader } from "./censusAttackCorpus";
import { installedNoWeakness, seatRemovesWeakness } from "./continuous";
import {
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, engineVersion, otherSeat, programFor } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  NO_WEAKNESS_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.333.0 → 0.334.0 — 🆕🆕 D432: THE INSTALLED "NO WEAKNESS" BAR, and the THIRD
// distinct way this engine can null §8.5's Weakness step.
//
//   "During your opponent's next turn, this Pokémon has no Weakness."
//
// **1 sentence / 3 legal printings** — `censusAttackCorpus.ts` row 192. ONE anchor
// (`SELF_NO_WEAKNESS`), ONE arm in `deriveAttackEffect` (19d-bis), ONE field-free
// `EffectOp` (`installNoWeakness`), ONE `stepOp` case, ONE interpreter installer,
// ONE new `InPlayPokemon` field (`noWeaknessTurn`), ONE new reader
// (`installedNoWeakness`), ONE new event (`WEAKNESS_REMOVED`) with ONE log row,
// FOUR §10 clear literals and TWO read-site disjuncts.
//
// 🛑 **THE REQUIRED-VS-OPTIONAL DECISION IS THE SLICE, AND IT BUMPS
// `MATCH_RECORD_VERSION` 26 → 27.** An optional `noWeaknessTurn?: number` is a
// WIDENING and would have been free at the storage boundary. D421 takes that road
// safely by *choosing the rest of the record so that LOSING the key is
// detectable* — its `LockedAttack.turn` is stamped with the INSTALL turn so a
// dropped rider produces a bar for a turn already spent, visible on the next
// board. **That mitigation is unavailable here, because there IS no rest of the
// record**: the printed sentence carries no amount, no attacker filter and no type
// narrowing, so the record is one number and dropping it reproduces the pre-D432
// engine exactly — Weakness doubles the hit and the board looks entirely normal.
// That is D124's benign soft landing, refused for the sixth time at this address
// (D124 `promotedTurn`, D142 `attackBlock`, D143 `attackLockedTurn`, D147
// `damageReduction`, D412 `retreatLockedTurn`, now this). §8 drives BOTH
// directions, including the soft landing itself.
//
// 🛑 **THE STORAGE IS A THIRD STORE, AND NEITHER EXISTING ONE COULD BE WIDENED.**
// Both Weakness read sites already carried a null path before this slice:
// `AttackDamageSuppression.weakness` (D192) is a PARSE of the attacker's declared
// sentence, alive for one declaration and with no body to live on; and
// `seatRemovesWeakness` (D161, Florges "Blooming Garden") is a seat-wide catalog
// AURA that a §9 Ability-lock switches OFF — which an attack INSTALLATION must be
// immune to, D147's own structural reason for keeping `installedReductionOf` out
// of `passivesOf`. This one is per-body, installed and turn-scoped: none of the
// three is a special case of another. §10 drives all three on one board.
//
// 🛑 **TWO READ SITES, AND A BUILD THAT WIDENS ONE IS INVISIBLE TO A SUITE THAT
// SWINGS THE OTHER.** `attack.ts`'s main hit and `interpreter.ts`'s `snipeActive`
// are separate expressions in separate files. §4 and §5 drive them on their own
// boards, and the mutant `D432-snipe-bar-not-read` is exactly the one-sided build.

const SENTENCE = "During your opponent's next turn, this Pokémon has no Weakness.";
const VEIL = 0; // fix-nowk index 0 — the sentence
const PLAIN = 1; // fix-nowk index 1 — the ONE-AXIS control: same cost, same damage, no effect
const RETYPE = 2; // fix-nowk index 2 — a REAL unbuilt corpus sentence, the loud-path control

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function count(events: GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

function must0(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("expected a Pokémon");
  return pokemon;
}

/** Both seats field `fix-nowk`; `first` has already ended their turn, so the OTHER
    seat owns turn 2 and may attack (§4 forbids the going-first player's turn-1
    attack). Seed-free by construction: nothing this suite declares flips a coin,
    and every Active, benched body and attachment is placed by surgery. */
function board(first: Seat = "p2", seed = 4): GameState {
  const state = driveSetup(
    seed,
    { p1: NO_WEAKNESS_DECK, p2: NO_WEAKNESS_DECK },
    { first, active: { p1: "fix-nowk", p2: "fix-nowk" } },
  );
  return mustApply(state, { type: "endTurn", seat: first }).state;
}

/** `installer` owns the turn with one {C} on its `fix-nowk`, and the OTHER seat's
    Active has already been surgically set to `swinger` (`fix-bolt`, printed 50, or
    Rotom `sv01-069`, the `opponentAny` snipe at 20) with one {C} of its own —
    placed BEFORE the install so nothing about the swinger's arrival can be confused
    with the bar. */
function armed(installer: Seat, swinger: string): GameState {
  const victimSeat = otherSeat(installer);
  let state = board(victimSeat);
  state = setActiveFromDeck(state, victimSeat, swinger);
  state = attachFromDeck(state, installer, "fix-energy", 1);
  return attachFromDeck(state, victimSeat, "fix-energy", 1);
}

/** The installer declares `index`, which ENDS its turn (§5.3); the swinger then
    declares its index-0 attack on the very next turn — the bar's whole window. */
function exchange(installer: Seat, swinger: string, index: number) {
  const victimSeat = otherSeat(installer);
  const installed = mustApply(armed(installer, swinger), {
    type: "attack",
    seat: installer,
    index,
  });
  const swung = mustApply(installed.state, { type: "attack", seat: victimSeat, index: 0 });
  return { installed, swung };
}

/** Rendered log rows as `{ who, text }`, the idiom every sibling suite uses. */
function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ana", p2: "Ben" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((seg) => seg.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the sentence, the population, and what cannot be resolved here.
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — one sentence, three printings, and the family read to its edges", () => {
  it("the corpus prints exactly this sentence at exactly this count", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === SENTENCE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(3);
  });

  it("🛑 the LOOSEST plausible family grep returns 73 rows, and ONE of them removes a Weakness", () => {
    // D424/D425's rule: grep the LOOSEST shape and read EVERY hit, then publish the
    // pattern so the next reader can see its edges. `/Weakness/i` is as loose as this
    // family gets — it matches the NOUN alone, so it cannot miss a possessive, a
    // plural, a parenthetical, a different verb or a duration this slice did not
    // imagine. All 73 were read; the partition is stated rather than sampled.
    const hits = legalAttackCorpus().filter(([, text]) => /Weakness/i.test(text));
    expect(hits).toHaveLength(73);
    // The overwhelming majority is the BENCH CLARIFIER — "(Don't apply Weakness and
    // Resistance for Benched Pokémon.)" — which is a note about where §8.5 applies,
    // not an effect on anybody's Weakness.
    const clarifier = hits.filter(([, t]) =>
      t.includes("Don't apply Weakness and Resistance for Benched Pokémon."),
    );
    expect(clarifier).toHaveLength(43);
    // Then the two shipped families that really do reach the step: D192's
    // attacker-side PARSE ("This attack's damage isn't affected by Weakness…") and
    // the W/R PARENTHETICAL on the durated number families ("(before|after) applying
    // Weakness and Resistance", D147/D149/D155).
    const suppression = hits.filter(([, t]) => t.includes("isn't affected by Weakness"));
    expect(suppression).toHaveLength(11);
    const parenthetical = hits.filter(([, t]) => /applying Weakness and Resistance\)/.test(t));
    expect(parenthetical).toHaveLength(17);
    // …and the four classes PARTITION the 73 rather than merely covering them: no
    // row is in two of them, which is what makes the two-row remainder below a
    // remainder rather than a leftover of an arbitrary filter order.
    expect(clarifier.length + suppression.length + parenthetical.length).toBe(71);
    // …which leaves exactly TWO rows that speak about a body's Weakness itself.
    const rest = hits.filter(
      ([, t]) =>
        !t.includes("Don't apply Weakness and Resistance for Benched Pokémon.") &&
        !t.includes("isn't affected by Weakness") &&
        !/applying Weakness and Resistance\)/.test(t),
    );
    expect(rest.map(([, t]) => t).sort()).toEqual([
      SENTENCE,
      // 🛑 THE ONE PRINTED NEAR-MISS IN THE WHOLE COLUMN, and it is a RETYPE rather
      // than a removal — a different duration, a different body AND a different verb.
      // It is what `fix-nowk` index 2 prints, so this suite's loud-path control is a
      // real legal sentence rather than an invented one; and it is NOT the refusal
      // rung's near-miss, because a three-axis miss tests nothing about any of them
      // (D427). §2's near-misses vary one token each.
      "Until the end of your next turn, the Defending Pokémon's Weakness is now {C}. (The amount of Weakness doesn't change.)",
    ]);
    // …and the retype stays REFUSED, which is what keeps `fix-nowk` index 2 a
    // control rather than a second built sentence.
    expect(resolvedByAnyReader(rest.map(([, t]) => t).sort()[1] as string)).toBe(false);
  });

  it("the apostrophe is U+0027 — MEASURED off the corpus row, not remembered", () => {
    // D421's defect verbatim: that slice's brief asserted a U+2019 from memory and
    // the byte was U+0027. The row is read here instead of transcribed.
    const row = legalAttackCorpus().find(([, text]) => /this Pokémon has no Weakness/.test(text));
    expect(row?.[1]).toBe(SENTENCE);
    expect(row?.[1]).toContain("'");
    expect(row?.[1]).not.toContain("’");
    // …and the é is the PRECOMPOSED U+00E9, not e + U+0301.
    expect(row?.[1]).toContain("é");
  });

  it("🛑 the three carrier ids are UNRESOLVED, and are stated so rather than invented", () => {
    // This checkout has no D1 — no local sqlite, no remote credentials — and the
    // corpus is grouped BY SENTENCE and records the COUNT, not the ids. So the three
    // printings cannot be named here, and a plausible-looking invented id would be
    // indistinguishable from a real one to every later reader (D425).
    //
    // The falsifier is executable rather than prose: the demonstrator is a `fix-*`
    // key with no catalog row behind it, and the day the ids are resolvable this rung
    // is what a successor edits.
    expect(FIXTURE_POOL["fix-nowk"]?.id).toBe("fix-nowk");
    expect(FIXTURE_POOL["fix-nowk"]?.attacks?.[VEIL]?.effect).toBe(SENTENCE);
    const printed = legalAttackCorpus().filter(([, text]) => text === SENTENCE);
    expect(printed[0]?.[0]).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation, its refusals, and the anchors it sits between.
// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — the anchor claims the sentence WHOLE, and each near-miss differs on ONE axis", () => {
  it("derives to the bare field-free op", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "installNoWeakness" }]);
  });

  it("the U+2019 spelling derives IDENTICALLY", () => {
    const curly = SENTENCE.replace("'", "’");
    expect(curly).not.toBe(SENTENCE);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(SENTENCE));
  });

  it("🛑 four near-misses are REFUSED, each varying ONE token — and the anchor still ADMITS", () => {
    // D424's rule: every "X is refused" rung owes a neighbouring "Y is admitted" on
    // the same axis, or it passes trivially against a reader that refuses everything.
    // D427's rule: a near-miss that differs on more than one axis tests nothing about
    // either feature. So each string below is the RESOLVING one with a single token
    // changed, and the admitted twin is asserted in this same `it`.
    const admitted = deriveAttackEffect(SENTENCE);
    expect(admitted).toEqual([{ op: "installNoWeakness" }]);

    // (a) the DURATION — "your" for "your opponent's". A real printed duration
    //     elsewhere in the pool, and it names the installer's own turn, on which the
    //     holder is the ATTACKER and its Weakness is never consulted.
    expect(
      deriveAttackEffect("During your next turn, this Pokémon has no Weakness."),
    ).toBeNull();
    // (b) the BODY — "the Defending Pokémon" for "this Pokémon". The stamp would have
    //     to land on the other seat, which is `weakenDefenderAttacks`'s address and
    //     not this op's; the op has no `target` field to say so with.
    expect(
      deriveAttackEffect("During your opponent's next turn, the Defending Pokémon has no Weakness."),
    ).toBeNull();
    // (c) the OBJECT — "Resistance" for "Weakness". Nothing in the pool prints it,
    //     and `resistanceOf` has no defender-side null path at all (D192 says so at
    //     the site).
    expect(
      deriveAttackEffect("During your opponent's next turn, this Pokémon has no Resistance."),
    ).toBeNull();
    // (d) the TERMINATOR — the trailing period. `^…$` is what keeps this sentence off
    //     every prefix path, and a build that dropped the `$` would claim compounds
    //     whose tail nothing reads.
    expect(
      deriveAttackEffect("During your opponent's next turn, this Pokémon has no Weakness"),
    ).toBeNull();
  });

  it("the three anchors in this block are mutually exclusive in BOTH directions", () => {
    // The neighbours 19d and 19e read the durated REDUCTION, bare and compound. All
    // three share the four-word duration prefix and the "this Pokémon" holder, so
    // the claim that they cannot cross is worth driving rather than asserting.
    const reduction =
      "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).";
    const compound =
      "Discard all Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).";
    expect(deriveAttackEffect(reduction)).toEqual([{ op: "reduceDamage", amount: 30 }]);
    expect(deriveAttackEffect(compound)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "reduceDamage", amount: 100 },
    ]);
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "installNoWeakness" }]);
  });

  it("the sentence is claimed by a READER and by neither splitter — the census attribution", () => {
    // Which route claims it decides which census summand moves (D426's mechanism).
    // It is a whole-sentence reader claim: `SPLIT_ATTACK_UNITS` and
    // `COMPOUND_ATTACK_UNITS` stand still, and the reader SURFACE does too, because
    // the arm is inside `deriveAttackEffect` rather than a fourteenth reader.
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
    expect(attackReaderSurface()).toHaveLength(13);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the install: the stamp, the row, the loud path, and idempotence.
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — what the install writes, and what it announces", () => {
  it("stamps the installer's OWN Active with `state.turn + 1`", () => {
    const state = armed("p1", "fix-bolt");
    expect(state.turn).toBe(2);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: VEIL });
    // Declaring ENDS the turn (§5.3), so the board is already on the window.
    expect(after.turn).toBe(3);
    expect(must0(after.players.p1.active).noWeaknessTurn).toBe(3);
    // …and nothing landed on the opponent's body: the op has no defender arm.
    expect(must0(after.players.p2.active).noWeaknessTurn).toBeNull();
    // The row is ACTOR-voiced and names the installing body.
    expect(find(events, "WEAKNESS_REMOVED")).toEqual({
      type: "WEAKNESS_REMOVED",
      seat: "p1",
      uid: activeUid(state, "p1"),
    });
  });

  it("the log row reads back the printed words under the INSTALLER's name", () => {
    const state = armed("p1", "fix-bolt");
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: VEIL });
    const rows = render(events, after);
    const row = rows.find((r) => r.text.includes("has no Weakness"));
    expect(row?.text).toBe("fix-nowk has no Weakness during your opponent's next turn");
    // 🛑 THE ROW IS A CLAIM WITH THE SAME STANDING AS A PREDICATE (D421). "during
    // your opponent's next turn" is TRUE here only because the row renders under the
    // INSTALLER's name — `ATTACK_DEBUFF_APPLIED` had to reword its otherwise
    // identical ending for exactly this reason. So the voice is asserted, not just
    // the words: under the other player's name the same sentence names the one turn
    // the bar is NOT live on.
    expect(row?.who).toBe("p1");
  });

  it("🛑 NO `ATTACK_EFFECT_SKIPPED` for the built sentence — and the SAME BODY still emits one", () => {
    // The half a one-sided assertion cannot make: index 2 prints a REAL legal
    // sentence no reader claims, on the same card, at the same cost, for the same
    // printed damage. If the loud path had gone quiet across the board, this rung
    // reddens; if the new arm had not landed, the rung above does.
    const built = mustApply(armed("p1", "fix-bolt"), { type: "attack", seat: "p1", index: VEIL });
    expect(count(built.events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    const loud = mustApply(armed("p1", "fix-bolt"), { type: "attack", seat: "p1", index: RETYPE });
    expect(count(loud.events, "ATTACK_EFFECT_SKIPPED")).toBe(1);
    // …and the one-axis control emits neither, because it prints no sentence at all.
    const plain = mustApply(armed("p1", "fix-bolt"), { type: "attack", seat: "p1", index: PLAIN });
    expect(count(plain.events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    expect(count(plain.events, "WEAKNESS_REMOVED")).toBe(0);
  });

  it("idempotent BY THE STAMP — a second install in one turn writes nothing and says nothing", () => {
    // Unreachable off any printing (one attack per turn, and no card prints two of
    // these), so it is CONSTRUCTED and pinned. There is no amount for a `Math.max` to
    // be about, which is what makes this `retreatLockedTurn`'s answer rather than
    // `reduceDamage`'s.
    const state = armed("p1", "fix-bolt");
    const events: GameEvent[] = [];
    const once = runProgram(state, [{ op: "installNoWeakness" }], { seat: "p1", invokedBy: "attack" }, events);
    expect(count(events, "WEAKNESS_REMOVED")).toBe(1);
    expect(must0(once.state.players.p1.active).noWeaknessTurn).toBe(3);
    const again: GameEvent[] = [];
    const twice = runProgram(once.state, [{ op: "installNoWeakness" }], { seat: "p1", invokedBy: "attack" }, again);
    expect(count(again, "WEAKNESS_REMOVED")).toBe(0);
    expect(must0(twice.state.players.p1.active).noWeaknessTurn).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — READ SITE ONE: `attack.ts`'s §8.5 main hit. The number MOVES.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — the main hit: 100 becomes 50, and the control differs on ONE axis", () => {
  for (const installer of ["p1", "p2"] as const) {
    const victim = otherSeat(installer);

    it(`${installer} installs: the ×2 Lightning hit reads 50 instead of 100`, () => {
      const { swung } = exchange(installer, "fix-bolt", VEIL);
      const row = find(swung.events, "DAMAGE_DEALT");
      expect(row?.base).toBe(50);
      expect(row?.dealt).toBe(50);
      // 🛑 THE STEP IS GONE, NOT SHRUNK. `DAMAGE_DEALT.weakness` is the modifier
      // itself, so a build that subtracted 50 somewhere else would still report the
      // ×2 here. This is the field the log renders, and its absence IS the report
      // (there is no `WEAKNESS_REMOVED` row on the biting turn, by design).
      expect(row?.weakness).toBeNull();
      expect(must0(swung.state.players[installer].active).damage).toBe(50);
    });

    it(`${installer} declares the PLAIN twin instead: the same board reads 100`, () => {
      // The one-axis control. Same card, same index cost, same printed 10, same
      // turn, same swinger, same energy — the ONLY difference is that index 1 has no
      // printed sentence, so no bar is installed.
      const { swung } = exchange(installer, "fix-bolt", PLAIN);
      const row = find(swung.events, "DAMAGE_DEALT");
      expect(row?.base).toBe(50);
      expect(row?.dealt).toBe(100);
      expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
      expect(must0(swung.state.players[installer].active).damage).toBe(100);
    });

    it(`${installer}'s bar does not touch RESISTANCE or the victim's own Weakness`, () => {
      // The bar is per-body: the installer's Weakness is gone and the swinger's is
      // untouched. `fix-bolt` is ×2 Fighting, so its own Weakness is not engaged by
      // a Water attacker either way — what is asserted here is the RECORD.
      const { swung } = exchange(installer, "fix-bolt", VEIL);
      expect(must0(swung.state.players[installer].active).noWeaknessTurn).toBe(3);
      expect(must0(swung.state.players[victim].active).noWeaknessTurn).toBeNull();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — READ SITE TWO: `interpreter.ts`'s `snipeActive`. Driven on its OWN board.
// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — the snipe path: 40 becomes 20, through a DIFFERENT expression in a DIFFERENT file", () => {
  // 🛑 THIS SECTION IS THE DEFECT A SINGLE-PATH SUITE CANNOT SEE. `attack.ts:~2230`
  // and `interpreter.ts:~7370` are two separate `||` chains; a build that widened
  // one and not the other passes every board in §4. Rotom `sv01-069` "Linear Attack"
  // is an `opponentAny` snipe with an EMPTY opposing Bench, so the pick is forced
  // onto the Active and `snipeActive` is the arm that runs.
  it("the bar nulls the sniped Active's Weakness", () => {
    const { swung } = exchange("p1", "sv01-069", VEIL);
    const row = find(swung.events, "DAMAGE_DEALT");
    expect(row?.base).toBe(20);
    expect(row?.dealt).toBe(20);
    expect(row?.weakness).toBeNull();
  });

  it("…and WITHOUT the bar the same snipe doubles — the one-axis control", () => {
    const { swung } = exchange("p1", "sv01-069", PLAIN);
    const row = find(swung.events, "DAMAGE_DEALT");
    expect(row?.base).toBe(20);
    expect(row?.dealt).toBe(40);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
  });

  it("BOTH read sites move on ONE board — the numbers are 50 and 20, not one of them", () => {
    // The pairing that makes the two sections one claim rather than two: the same
    // install, read by both files, with numbers that cannot be confused for each
    // other (the main hit is a printed 50, the snipe a printed 20).
    const main = find(exchange("p2", "fix-bolt", VEIL).swung.events, "DAMAGE_DEALT");
    const snipe = find(exchange("p2", "sv01-069", VEIL).swung.events, "DAMAGE_DEALT");
    expect([main?.dealt, snipe?.dealt]).toEqual([50, 20]);
    expect([main?.weakness, snipe?.weakness]).toEqual([null, null]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the CLOCK: live on the opponent's next turn, dead on the one after.
// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — turn-scoped, and a stale stamp answers nothing without being cleared", () => {
  it("live on turn 3, DEAD on turn 5, with the field never touched in between", () => {
    const armedState = armed("p1", "fix-bolt");
    const after = mustApply(armedState, { type: "attack", seat: "p1", index: VEIL }).state;
    expect(after.turn).toBe(3);
    expect(installedNoWeakness(after, must0(after.players.p1.active))).toBe(true);

    // Turn 3 — the window. The swinger hits for 50.
    const inWindow = mustApply(after, { type: "attack", seat: "p2", index: 0 });
    expect(find(inWindow.events, "DAMAGE_DEALT")?.dealt).toBe(50);
    expect(inWindow.state.turn).toBe(4);

    // Turn 4 — p1 does NOT re-install (that would move the stamp and make the case
    // about the second install rather than about the clock).
    let later = mustApply(inWindow.state, { type: "endTurn", seat: "p1" }).state;
    expect(later.turn).toBe(5);
    // 🛑 THE STAMP IS STILL THERE. Nothing cleared it — it simply stopped naming the
    // turn being played, which is the whole of the read-through-a-stamp contract
    // (D124). A build that had cleared it at the turn boundary would pass the damage
    // assertion below and fail this line.
    expect(must0(later.players.p1.active).noWeaknessTurn).toBe(3);
    expect(installedNoWeakness(later, must0(later.players.p1.active))).toBe(false);

    // …and the very next hit lands at FULL price.
    later = attachFromDeck(later, "p2", "fix-energy", 1);
    const outside = mustApply(later, { type: "attack", seat: "p2", index: 0 });
    expect(find(outside.events, "DAMAGE_DEALT")?.dealt).toBe(100);
    expect(find(outside.events, "DAMAGE_DEALT")?.weakness).toEqual({ op: "multiply", amount: 2 });
  });

  it("the INSTALLER's own turn is not the window — the bar never protects on the turn it lands", () => {
    // The stamp is `+ 1`, and the sentence says so. Asserted through the reader on
    // the installing board itself, where `state.turn` is already the window's number
    // because declaring ended the turn — so this is asserted on the PREVIOUS turn's
    // board instead, which is the only place the distinction is visible.
    const before = armed("p1", "fix-bolt");
    expect(before.turn).toBe(2);
    const events: GameEvent[] = [];
    const ran = runProgram(before, [{ op: "installNoWeakness" }], { seat: "p1", invokedBy: "attack" }, events);
    expect(must0(ran.state.players.p1.active).noWeaknessTurn).toBe(3);
    expect(installedNoWeakness(ran.state, must0(ran.state.players.p1.active))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the CLEAR decision: by SITE as well as by stamp, on all three §10 routes.
// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — leaving the Active Spot LIFTS it, and all three literals are driven", () => {
  // 🛑 THE DECISION, PINNED RATHER THAN ASSUMED (D421's rule about a discrepancy
  // that is not pinned being indistinguishable from an oversight): the bar expires
  // BY STAMP and is ALSO cleared BY SITE at all four literals, which is
  // `damageReduction`'s answer verbatim — same holder, same window, same
  // reachability story. §10 sheds the effects of ATTACKS and this is one.
  //
  // ⚠️ AND IT IS THE ONE MEMBER OF THE DURATED FAMILY WHOSE CLEAR NO NUMBER CAN
  // WITNESS. §8.5 applies Weakness only to the ACTIVE, so after any of these three
  // routes the body is either benched or a different Pokémon and there is no
  // Weakness step left for the bar to have removed. The field IS the witness, which
  // is why this section reads it directly and why `attackLock.test.ts`'s three-route
  // sweep carries `noWeaknessTurn` too.
  function barred(): GameState {
    const state = mustApply(armed("p1", "fix-bolt"), { type: "attack", seat: "p1", index: VEIL })
      .state;
    // Turn 4 — p1's own turn, where all three routes are legal. The stamp (3) is
    // stale but PRESENT, which is `attackLock.test.ts`'s `99` sentinel reached off a
    // real install instead of by surgery.
    const p1Turn = mustApply(state, { type: "attack", seat: "p2", index: 0 }).state;
    expect(p1Turn.turn).toBe(4);
    expect(must0(p1Turn.players.p1.active).noWeaknessTurn).toBe(3);
    return benchFromDeck(p1Turn, "p1", "fix-titan");
  }

  function stampOf(pokemon: InPlayPokemon | undefined): number | null {
    if (pokemon === undefined) return -1;
    return pokemon.noWeaknessTurn;
  }

  it("1. RETREAT (turn.ts `clearOnLeavingActive`)", () => {
    const state = barred();
    const uid = activeUid(state, "p1");
    const retreated = must(
      applyAction(state, {
        type: "retreat",
        seat: "p1",
        discardEnergy: (state.players.p1.active?.energy ?? []).slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    expect(stampOf(retreated.players.p1.bench.find((p) => p.stack.includes(uid)))).toBeNull();
  });

  it("2. FORCED SWITCH (interpreter.ts `switchInto`), via the Switch Item", () => {
    const state = handFromDeck(barred(), "p1", "sv01-194", 1);
    const uid = activeUid(state, "p1");
    let switched = must(
      applyAction(state, {
        type: "playTrainer",
        seat: "p1",
        uid: handUid(state, "p1", "sv01-194"),
      }),
    );
    if (switched.phase.kind === "effect:choose") {
      switched = must(
        applyAction(switched, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    expect(stampOf(switched.players.p1.bench.find((p) => p.stack.includes(uid)))).toBeNull();
  });

  it("3. EVOLVE (types.ts `placeEvolution`)", () => {
    const state = handFromDeck(barred(), "p1", "fix-nowk-stage1", 1);
    const evolved = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-nowk-stage1"),
        target: { spot: "active" },
      }),
    );
    expect(stampOf(evolved.players.p1.active ?? undefined)).toBeNull();
    // …and the EVOLVED body is still ×2 Lightning, so "the bar is gone" and "the
    // body stopped being weak" are different claims and this rung asserts the first.
    expect(FIXTURE_POOL["fix-nowk-stage1"]?.weaknesses).toEqual([
      { type: "Lightning", value: "×2" },
    ]);
  });

  it("4. A FRESH BODY carries none (types.ts `makeInPlay`)", () => {
    const fresh = board();
    expect(must0(fresh.players.p1.active).noWeaknessTurn).toBeNull();
    expect(must0(fresh.players.p2.active).noWeaknessTurn).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED QUESTION: `MATCH_RECORD_VERSION` 26 → 27, driven BOTH ways.
// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — the bump, and the soft landing it refuses", () => {
  // ⚠️ `MATCH_RECORD_VERSION` IS NOT EXPORTED FROM THIS PACKAGE (it lives in
  // `apps/api/src/lobby/match.ts`, where the version gate and its argument sit, and
  // where `match.test.ts` pins the literal 27 and drives ±1 to null). What is
  // driven HERE is the ENGINE-side fact the constant is about: whether a record
  // written by the previous deploy can be read benignly by this one.
  function inWindow(): GameState {
    const state = mustApply(armed("p1", "fix-bolt"), { type: "attack", seat: "p1", index: VEIL })
      .state;
    expect(state.turn).toBe(3);
    return JSON.parse(JSON.stringify(state)) as GameState;
  }

  it("🛑 DIRECTION 1 — a v27 record round-trips and the bar STILL bites", () => {
    const saved = inWindow();
    expect(must0(saved.players.p1.active).noWeaknessTurn).toBe(3);
    const swung = mustApply(saved, { type: "attack", seat: "p2", index: 0 });
    expect(find(swung.events, "DAMAGE_DEALT")?.dealt).toBe(50);
    expect(find(swung.events, "DAMAGE_DEALT")?.weakness).toBeNull();
  });

  it("🛑 DIRECTION 2 — a v26-SHAPED body loses the bar SILENTLY, which is the retirement reason", () => {
    // The v26 shape is BUILT rather than imagined: the key is genuinely DELETED from
    // a JSON round-tripped board, which is what a record written by the previous
    // deploy actually looks like.
    const legacy = inWindow();
    const body = must0(legacy.players.p1.active) as Omit<InPlayPokemon, "noWeaknessTurn"> & {
      noWeaknessTurn?: number;
    };
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT. `= undefined` leaves it PRESENT, which is the exact distinction D124's rule turns on and the one this case exists to drive.
    delete body.noWeaknessTurn;
    // ABSENT, not `undefined` — the distinction D124 refuses to blur and a `toEqual`
    // would hide.
    expect("noWeaknessTurn" in body).toBe(false);

    // 🛑 IT READS BACK BENIGNLY, AND THAT IS EXACTLY THE PROBLEM. `undefined ===
    // state.turn` is FALSE, so the bar simply stops existing: the very next hit lands
    // at 100 with a `×2` on the row, and NOTHING anywhere says a rule was lost. A
    // player who spent a whole attack buying this protection is handed a doubled hit
    // on the one turn it was for.
    // 🛑 THE CAST IS THE FINDING, NOT A CONVENIENCE. `tsc` refuses to pass this body
    // to `installedNoWeakness` — *"Type 'undefined' is not assignable to type
    // 'number | null'"* — which is `MATCH_RECORD_VERSION`'s argument stated by the
    // compiler: a v26 record's in-play Pokémon is not an inhabitant of this deploy's
    // type. The cast reproduces what the STORAGE layer would do, which is hand the
    // engine a value the type system would have refused.
    expect(installedNoWeakness(legacy, body as unknown as InPlayPokemon)).toBe(false);
    const swung = mustApply(legacy, { type: "attack", seat: "p2", index: 0 });
    expect(find(swung.events, "DAMAGE_DEALT")?.dealt).toBe(100);
    expect(find(swung.events, "DAMAGE_DEALT")?.weakness).toEqual({ op: "multiply", amount: 2 });

    // …and the STRUCTURAL fact the version gate keys on: this body is not an
    // inhabitant of the new type at all. Asserted as a key-set diff in both
    // directions, because a diff between two boards from ONE build is blind to a key
    // that grew on both (D279).
    const live = must0(inWindow().players.p1.active);
    expect(Object.keys(body).sort()).not.toEqual(Object.keys(live).sort());
    expect(Object.keys(live).sort().filter((k) => !Object.keys(body).includes(k))).toEqual([
      "noWeaknessTurn",
    ]);
  });

  it("🛑 THE OPTIONAL-KEY ROAD WAS DRIVEN TOO, and it is the reason the constant moved", () => {
    // D425's rule: apply the test, do not copy the outcome. An OPTIONAL
    // `noWeaknessTurn?: number` would have made the case above legal rather than
    // retired — and the case above IS the pre-D432 engine. D421 can take that road
    // because its record has a SECOND field to make the loss loud; this record is one
    // number and has none, so there is nothing to choose. The two boards below are
    // the whole argument, side by side.
    const withKey = inWindow();
    const withoutKey = inWindow();
    const stripped = must0(withoutKey.players.p1.active) as Omit<
      InPlayPokemon,
      "noWeaknessTurn"
    > & { noWeaknessTurn?: number };
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT. `= undefined` leaves it PRESENT, which is the exact distinction D124's rule turns on and the one this case exists to drive.
    delete stripped.noWeaknessTurn;
    const a = mustApply(withKey, { type: "attack", seat: "p2", index: 0 });
    const b = mustApply(withoutKey, { type: "attack", seat: "p2", index: 0 });
    // Same board, same action, same event TYPES — and a 50-point difference in what
    // the defender takes. A log-shaped assertion could not have seen this (D430).
    expect(types(a.events)).toEqual(types(b.events));
    expect([find(a.events, "DAMAGE_DEALT")?.dealt, find(b.events, "DAMAGE_DEALT")?.dealt]).toEqual([
      50, 100,
    ]);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — purity, and the frozen board.
// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — the install mutates nothing it was handed", () => {
  it("a deep-frozen board survives the install and the hit that reads it", () => {
    const state = deepFreeze(armed("p1", "fix-bolt"));
    const installed = mustApply(state, { type: "attack", seat: "p1", index: VEIL });
    expect(must0(state.players.p1.active).noWeaknessTurn).toBeNull();
    expect(must0(installed.state.players.p1.active).noWeaknessTurn).toBe(3);

    const frozen = deepFreeze(installed.state);
    const swung = mustApply(frozen, { type: "attack", seat: "p2", index: 0 });
    expect(must0(frozen.players.p1.active).damage).toBe(0);
    expect(must0(swung.state.players.p1.active).damage).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — THREE STORES, ONE STEP: the design claim, driven on one board.
// ─────────────────────────────────────────────────────────────────────────────
describe("§10 — the bar is neither the aura nor the parse, and all three null the same step", () => {
  it("the installed bar is live while the AURA is absent and the PARSE is empty", () => {
    // The claim the storage argument rests on. If the bar had been folded into
    // `seatRemovesWeakness` (the aura) this rung would read `true` on the seat, and
    // if it had been folded into `AttackDamageSuppression.weakness` (the parse) it
    // would be a property of the swinger's sentence rather than of the holder.
    const state = mustApply(armed("p1", "fix-bolt"), { type: "attack", seat: "p1", index: VEIL })
      .state;
    expect(installedNoWeakness(state, must0(state.players.p1.active))).toBe(true);
    // (a) NOT the seat-wide aura: no body on p1's side prints "Your Pokémon in play
    //     have no Weakness", so the catalog fold answers false while the bar is live.
    expect(seatRemovesWeakness(state, "p1")).toBe(false);
    expect(programFor("fix-nowk")?.passive?.removeWeakness).toBeUndefined();
    // (b) NOT the attacker-side parse: the swinger's index-0 attack prints no
    //     sentence at all, so nothing about the declaration could have nulled the
    //     step. The 50 in §4 therefore has exactly one possible source.
    expect(FIXTURE_POOL["fix-bolt"]?.attacks?.[0]?.effect).toBeUndefined();
  });

  it("the bar is per-BODY, not per-seat — a benched teammate is untouched", () => {
    // The sharpest available separation from the aura, which reaches every body on
    // the seat regardless of zone.
    const state = mustApply(armed("p1", "fix-bolt"), { type: "attack", seat: "p1", index: VEIL })
      .state;
    const benched = benchFromDeck(state, "p1", "fix-nowk");
    expect(must0(benched.players.p1.active).noWeaknessTurn).toBe(3);
    expect(benched.players.p1.bench[0]?.noWeaknessTurn).toBeNull();
    expect(installedNoWeakness(benched, must0(benched.players.p1.active))).toBe(true);
    const teammate = benched.players.p1.bench[0];
    expect(teammate === undefined ? null : installedNoWeakness(benched, teammate)).toBe(false);
  });
});
