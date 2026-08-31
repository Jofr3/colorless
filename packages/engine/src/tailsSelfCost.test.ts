import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  TAILS_SELF_COST_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.93.0 → 0.94.0 — the TAILS-GATED SELF-COSTS (P3-M5 long tail, D145), and the
// two arms that CLOSE the bare tails-gated family:
//
//   "Flip a coin. If tails, discard all Energy from this Pokémon."     (2)
//   "Flip a coin. If tails, this Pokémon also does 60 damage to itself."  (1)
//
// Item 1 of D144's remainder list, taken as ONE slice because the two sentences
// are one shape: an IMMEDIATE cost on the attacker's OWN body, paid on the losing
// face, where D144's member of the same shape installed a DURATED state. D132's
// inventory rule with nothing at all left over — the gate is 0.x's, the `onTails`
// field is D144's, and both consequent ops have been read off their BARE printings
// since 0.x — so the whole slice is TWO regexes and TWO deriver arms, with no new
// op, no new field, no new event, no new park and no `interpreter.ts` /
// `attack.ts` / `types.ts` / `continuous.ts` / `flow.ts` / `log.ts` / `redact.ts`
// / `registry.ts` diff.
//
// Five things this file is really about:
//
//   • THE LOSING FACE IS THE ONE THAT DOES SOMETHING, D144's inversion again and
//     sharper: the printed damage (220 / 170 / 160) lands on BOTH faces, so a
//     build that ignored `onTails` would strip the attacker's Energy — or hurt
//     it — on precisely the declarations that did not earn it, with nothing on
//     the DEFENDER's side of the board looking wrong. Both faces are driven end
//     to end for every claim, on all three printings;
//   • THE PRINTED "ALSO" IS THE TAIL PLACEMENT. An `EffectOp` runs after the §8.5
//     pipeline (D125), which is exactly what "this Pokémon ALSO does 60 damage to
//     itself" says — and it has two consequences neither sentence states: the
//     recoil never re-enters §8.5, so no Weakness touches it; and the program
//     runs even when the main hit dealt ZERO because the defender PREVENTED it;
//   • THE SELF-KO IS REACHABLE HERE, which D134's fixture-HP trap is the warning
//     about. Oinkologne is 120 HP and the recoil is 60: a fresh body survives it
//     twice and a body already carrying 60 does not, so the KO is one `setDamage`
//     away and never an accident;
//   • THE WHIFF IS SILENT. `count: "all"` on an empty attachment set files an
//     empty record and returns — no event, and certainly no loud skipped row. It
//     is UNREACHABLE from these two printings (the printed cost floors the
//     attachment at three), so it is pinned where it lives rather than pretended
//     into a board;
//   • THE INDEX IS 1 ON ALL THREE PRINTINGS, checked printing by printing.
//     D144 found a family whose index is not internally constant, so the question
//     is asked per printing for good — and here the answer happens to be uniform.

const DISCARD_TEXT = "Flip a coin. If tails, discard all Energy from this Pokémon.";
const RECOIL_TEXT = "Flip a coin. If tails, this Pokémon also does 60 damage to itself.";
/** The BARE printings of the same two consequents — the `then` each gate must
    wrap byte for byte, and the anchors that must not claim the gated strings. */
const BARE_DISCARD = "Discard all Energy from this Pokémon.";
const BARE_RECOIL = "This Pokémon also does 60 damage to itself.";

/** Seeds on which the declaration's ONE coin comes up TAILS — i.e. on which the
    drawback is PAID — measured over [1..40] on `TAILS_SELF_COST_DECK`, and the
    SAME list for all THREE installers because the declaration is the first coin
    either board draws after setup and every surgery in `armed` consumes no rng.
    Pinned by its own case, so a deck edit that shifts the shuffle fails loudly
    here instead of silently turning every both-faces assertion vacuous. */
const TAILS_SEEDS = [
  1, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 21, 24, 25, 26, 27, 29, 31, 32, 33, 36, 37, 39, 40,
] as const;
/** …and the complement — the face on which NOTHING is paid, which on these two
    sentences is the half a board delta cannot distinguish from a bug. */
const HEADS_SEEDS = [2, 3, 6, 7, 16, 18, 20, 22, 23, 28, 30, 34, 35, 38] as const;

/** The two DISCARD printings, with the index and printed damage each carries.
    Two cards from two sets, which is D121's warrant in D139's stronger form. */
const DISCARDERS = [
  { id: "sv02-063", index: 1, damage: 220, attack: "Dynamic Bolt", typed: "fix-lightning-energy" },
  { id: "sv03-054", index: 1, damage: 170, attack: "Frost Purge", typed: "fix-water-energy" },
] as const;
/** …and the RECOIL printing, which is one card. Warranted by the SHAPE rather
    than by the printing (D134's rule) — see the family case at the bottom. */
const RECOILER = { id: "sv03-183", index: 1, damage: 160, attack: "High-Impact Kick" } as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    defender is fix-titan (340 HP, NO attacks) unless a case names another, so no
    declaration ends the turn on a Knock Out and no defender attack interleaves
    rows. The installer goes on P1's Active with EXACTLY the Energy its printed
    attack costs — `surplus` attaches more, which is the only way "discard ALL"
    says anything at all. NONE of these surgeries touches `rngState`, which is
    what makes one seed table right for all three installers. */
function armed(
  seed: number,
  installer: string,
  opts: { defender?: string; surplus?: number } = {},
): GameState {
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: TAILS_SELF_COST_DECK, p2: TAILS_SELF_COST_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p2", opts.defender ?? "fix-titan");
  state = setActiveFromDeck(state, "p1", installer);
  if (state.players.p1.bench.length === 0) throw new Error("armed() left P1 with no bench");
  if (state.turn !== 2) throw new Error(`armed() expected turn 2, got ${String(state.turn)}`);
  const surplus = opts.surplus ?? 0;
  if (installer === "sv02-063") {
    // {L}{L}{C} — a MIXED pile, so "all" is a claim about the anyEnergy filter.
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 2 + surplus);
    return attachFromDeck(state, "p1", "fix-energy", 1);
  }
  if (installer === "sv03-054") {
    state = attachFromDeck(state, "p1", "fix-water-energy", 2 + surplus);
    return attachFromDeck(state, "p1", "fix-energy", 1);
  }
  // sv03-183 Oinkologne — {C}{C}{C}, one line, no typed symbol at all.
  return attachFromDeck(state, "p1", "fix-energy", 3 + surplus);
}

/** The face this declaration's ONE coin came up. Throws when there was no flip —
    a gate that stopped flipping would otherwise read as a permanent heads. */
function faceOf(events: GameEvent[]): "heads" | "tails" {
  const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
  if (flip === undefined) throw new Error("no ATTACK_EFFECT_COIN_FLIP row");
  return flip.result;
}

/** The engine's rejection code for an attack, or `"ok"`. */
function refusal(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? "ok" : result.error.code;
}

/** Hand the turn back to P1 — the turn after the one that paid the cost. */
function nextOwnTurn(state: GameState): GameState {
  const next = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (next.turn !== 4) throw new Error(`expected the holder's turn 4, got ${String(next.turn)}`);
  return next;
}

/** The log, rendered under real names and flattened to plain lines — the only
    honest way to answer the VOICE question (D144's habit: drive it, do not
    reason about it). `turn` entries carry no segments. */
function lines(events: GameEvent[], state: GameState): string[] {
  return rendered(events, state).map(({ text }) => text);
}

/** …and the same rows WITH the seat each renders under, which is the half the
    voice question actually turns on: a row is printed after its seat's name, so
    "whose line is this?" is `who` and not the wording (D136's finding 1). */
function rendered(
  events: GameEvent[],
  state: GameState,
): { who: "p1" | "p2" | "system"; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:07" };
  const out: { who: "p1" | "p2" | "system"; text: string }[] = [];
  for (const entry of logFromEvents(events, ctx)) {
    if (entry.kind === "turn") out.push({ who: "system", text: "" });
    else out.push({ who: entry.who, text: entry.segments.map((s) => s.text).join("") });
  }
  return out;
}

describe("the tails-gated self-costs — derived, not authored", () => {
  it("derives both sentences to a coinFlipGate carrying `onTails`", () => {
    expect(deriveAttackEffect(DISCARD_TEXT)).toEqual([
      {
        op: "coinFlipGate",
        onTails: true,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
        ],
      },
    ]);
    expect(deriveAttackEffect(RECOIL_TEXT)).toEqual([
      {
        op: "coinFlipGate",
        onTails: true,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "damageSelf", amount: 60 }],
      },
    ]);
    // The KEY SET, not just the value: the gate takes no other field and `toEqual`
    // alone would not catch a stray one (D144's assertion, re-made per arm).
    for (const text of [DISCARD_TEXT, RECOIL_TEXT]) {
      const op = (deriveAttackEffect(text) as EffectOp[])[0] as object;
      expect(Object.keys(op).sort(), text).toEqual(["onTails", "op", "then"]);
    }
  });

  it("wraps each BARE program byte for byte — one action, printed two ways", () => {
    // ⚠️ THE FAMILY'S CHECKABLE CLAIM, on its third and fourth sentences (D134's
    // on the heads face, D144's on this one): the gated program's `then` is
    // EXACTLY what the bare anchor derives, so there is one action per sentence
    // and the coin is procedure in front of it — not a modifier on the op, not a
    // second op, and not a new union member.
    for (const [gatedText, bareText] of [
      [DISCARD_TEXT, BARE_DISCARD],
      [RECOIL_TEXT, BARE_RECOIL],
    ] as const) {
      const gated = deriveAttackEffect(gatedText) as EffectOp[];
      expect(gated, gatedText).toHaveLength(1);
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      expect(gated[0], gatedText).toMatchObject({ then: deriveAttackEffect(bareText) });
      // …and the two anchors are NOT the same reading. A build where either
      // claimed the other's string would return the inner op UNWRAPPED (or wrap a
      // sentence with no coin in it), which is what this pair catches.
      expect(deriveAttackEffect(gatedText), gatedText).not.toEqual(deriveAttackEffect(bareText));
    }
    // Spelled out, because these are the ops the gates must wrap and nothing else:
    expect(deriveAttackEffect(BARE_DISCARD)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ]);
    expect(deriveAttackEffect(BARE_RECOIL)).toEqual([{ op: "damageSelf", amount: 60 }]);
  });

  it("CAPTURES the recoil amount rather than hardcoding the printed 60", () => {
    // The bare anchor reads any N, so the gated body does too — which is what
    // keeps the `then` byte-identical to the bare output for EVERY N rather than
    // for one. (`FLIP_DECK_TOP_MILL`'s deliberate narrowing was about TWO axes at
    // once, where widening invents readings; one number is not that case, and
    // `FLIP_SELF_HEAL` is the closer precedent — it captures too.)
    expect(deriveAttackEffect("Flip a coin. If tails, this Pokémon also does 10 damage to itself.")).toEqual(
      [
        {
          op: "coinFlipGate",
          onTails: true,
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "damageSelf", amount: 10 }],
        },
      ],
    );
    // A printed 0 is not a real card and would derive to a silent no-op — the
    // bare arm's guard, carried through the gate rather than lost behind it.
    expect(
      deriveAttackEffect("Flip a coin. If tails, this Pokémon also does 0 damage to itself."),
    ).toBeNull();
  });

  it("is anchored end to end, on both sentences", () => {
    for (const text of [DISCARD_TEXT, RECOIL_TEXT]) {
      for (const variant of [
        `Then, ${text}`,
        `${text} Draw a card.`,
        text.slice(0, -1),
        text.toLowerCase(),
        // The two sentences joined without the printed space.
        text.replace(". If", ".If"),
        // ⚠️ THE HEADS SPELLING IS NOT PRINTED ANYWHERE IN THE POOL for either
        // consequent (censused: zero heads-gated printings of both), so it stays
        // LOUD rather than deriving to the same op without the field. Mapping it
        // would invent a reading the ingest has never produced — the rule that
        // keeps `onTails` honest.
        text.replace("If tails", "If heads"),
      ]) {
        expect(deriveAttackEffect(variant), variant).toBeNull();
      }
      // Outer whitespace SURVIVES by design (the deriver trims), which states
      // which drift is tolerated and which is not.
      expect(deriveAttackEffect(`\t  ${text}\n`), text).toEqual(deriveAttackEffect(text));
    }
  });

  it("is mutually exclusive with its own BARE anchor, in BOTH directions", () => {
    // ⚠️ THE GUARD, ASSERTED RATHER THAN ARGUED. Each pair is kept apart by the
    // capitalised first word PLUS `^…$`, and neither alone is enough: the gated
    // string's consequent is lowercase and mid-sentence, so `^Discard` / `^This`
    // cannot reach it; the bare string has no "Flip a coin." prefix, so this
    // file's gate patterns cannot reach that. Adding /i anywhere would collapse
    // one of the two guards for both pairs at once.
    expect(deriveAttackEffect(BARE_DISCARD)).not.toEqual(deriveAttackEffect(DISCARD_TEXT));
    expect(deriveAttackEffect(BARE_RECOIL)).not.toEqual(deriveAttackEffect(RECOIL_TEXT));
    // The bare readings are UNWRAPPED — a single op, not a gate.
    for (const bare of [BARE_DISCARD, BARE_RECOIL]) {
      const ops = deriveAttackEffect(bare) as EffectOp[];
      expect(ops, bare).toHaveLength(1);
      expect(ops[0]?.op, bare).not.toBe("coinFlipGate");
    }
    // …and the gated readings are gates, with the field set.
    for (const gated of [DISCARD_TEXT, RECOIL_TEXT]) {
      const ops = deriveAttackEffect(gated) as EffectOp[];
      expect(ops[0]?.op, gated).toBe("coinFlipGate");
    }
  });

  it("keeps the CONSEQUENT censuses' refusals LOUD — the four compound discards", () => {
    // ⚠️ D142's RULE, APPLIED TO D144's OWN CENSUS. That one was run for the
    // FACE; this slice re-ran it for each CONSEQUENT, and the discard half is
    // where the width of an anchor actually matters. Ten attack printings say
    // "discard all Energy from this Pokémon": 4 BARE (Pawmot sv01-076/-209,
    // Raichu sv02-064/-211 — already simulated), 2 TAILS-gated (this arm), and
    // FOUR that print a SECOND SENTENCE after the discard. A wider anchor would
    // swallow all four and ship half of each card — and the hazard is LIVE, not
    // theoretical: Eiscue's rider is item 4 of D144's own remainder list, so the
    // day that family lands both halves derive and this must still not match.
    for (const text of [
      // Weavile sv06.5-014 "Hail Claw" — the discard plus a Paralyze.
      "Discard all Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // 🆕🆕 RE-POINTED AT D441, NOT DELETED, AND THE POLARITY IS THE POINT (D438).
    // The MOVE verb — Blissey sv01-145, Tropius sv02-007/-195, Darkrai sv03-136 —
    // stood in the list above as a NULL witness for "a reader keying on 'all Energy
    // from this Pokémon' would have claimed these four printings". D441 gave it a
    // reader, so `toBeNull` is no longer available; the claim this arm needs was
    // never *"nothing reads this sentence"* but *"THIS anchor does not reach it"*,
    // exactly as the Kyurem paragraph below records for D401.
    //
    // 🛑 IT IS ASSERTED AS A SHAPE AND NOT AS A BOOLEAN. `deriveAttackEffect(...) !==
    // null` would be true under the real build AND under a build where this file's
    // `discard all Energy` anchor swallowed the sentence — the two are
    // indistinguishable to a truthiness test, which is precisely how D436 disarmed
    // D368's tripwire. So the rung names the op that owns it and asserts the
    // discarding one is absent: the ONE thing that must never come back is a
    // `discardEnergy` on a sentence whose verb is "Move".
    const moveAll = deriveAttackEffect(
      "Move all Energy from this Pokémon to 1 of your Benched Pokémon.",
    );
    expect(moveAll).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: "all", route: "selfToBench" },
    ]);
    expect(moveAll?.some((op) => op.op === "discardEnergy")).toBe(false);
    // …and the SPREAD sentence one clause away carries the SAME verb and must also
    // never produce a discard. 🆕 **RE-POINTED AT D442, NOT DELETED** — it stood
    // here as a `toBeNull` control from D441 until the map answer claimed it, and a
    // bare `!== null` in its place would be true under exactly the build this rung
    // exists to refuse. The claim that survives the collection is the SHAPE one:
    // whatever reader owns a "Move" sentence, the program it returns is a move.
    const moveSpread = deriveAttackEffect(
      "Move all Energy from this Pokémon to your Benched Pokémon in any way you like.",
    );
    expect(moveSpread).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: "all",
        route: "selfToBench",
        anyDest: true,
      },
    ]);
    expect(moveSpread?.some((op) => op.op === "discardEnergy")).toBe(false);
    // ⚠️ RE-POINTED AT D401, NOT DELETED — Kyurem sv06.5-047 "Trifrost" (the discard
    // plus a three-target snipe) stood in the list above as a NULL witness until
    // `SELF_DISCARD_THEN_ANY_TARGET` mapped it. The claim this arm needs was never
    // "nothing reads this sentence"; it was "THIS anchor does not reach it", so the
    // row becomes a SHAPE claim — strictly stronger, because a build where the
    // TAILS-gated body claimed the compound would return the inner op UNWRAPPED, and
    // a `toBeNull` could not tell that from a correct refusal.
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "damageChosen", target: "opponentAny", amount: 110, count: 3, source: "attack", deals: true },
    ]);
    // ⚠️ RE-POINTED AT D147, NOT DELETED, AND THE FORECAST ONE LINE UP IS WHAT
    // CAME TRUE. This list said of Eiscue sv02-048/-205 "Frigid Block" that "the
    // day that family lands both halves derive and this must still not match" —
    // D147 is that day. The claim moves from NULL to SHAPE (D145's own move,
    // applied to D145's own witness): the compound derives to the discard op this
    // very anchor produces PLUS the durated reduction, in printed order, and the
    // tails-gated anchor above still refuses the whole string.
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "reduceDamage", amount: 100 },
    ]);
    // The BARE recoil family is 47 printings and every one of them still derives
    // — the gated arm took nothing away from it. Three of its printed amounts,
    // none of which is the gated 60 (the 47 print 10/20/30/50/90).
    for (const amount of [10, 30, 90]) {
      expect(deriveAttackEffect(`This Pokémon also does ${String(amount)} damage to itself.`)).toEqual([
        { op: "damageSelf", amount },
      ]);
    }
  });

  it("costs zero registry rows — all three printings simulate off their printed text", () => {
    // `programFor(id)` at all, not `?.attack`: none of these three cards carries a
    // row of any kind, which is a stronger statement than "no attack row" (D139).
    for (const { id } of [...DISCARDERS, RECOILER]) expect(programFor(id), id).toBeUndefined();
  });

  it("keeps the fixtures' printed text verbatim — and the family's ONE index", () => {
    // ⚠️ THE INDEX IS A CHECKED FACT, PRINTING BY PRINTING. D144 found a family
    // whose index is NOT internally constant (1 on three printings, 0 on two), so
    // it is never inferred from a sibling again. Here all three are 1 — and that
    // is a measurement, not an assumption.
    expect(FIXTURE_POOL["sv02-063"]?.attacks?.[1]).toEqual({
      cost: ["Lightning", "Lightning", "Colorless"],
      name: "Dynamic Bolt",
      damage: 220,
      effect: DISCARD_TEXT,
    });
    expect(FIXTURE_POOL["sv03-054"]?.attacks?.[1]).toEqual({
      cost: ["Water", "Water", "Colorless"],
      name: "Frost Purge",
      damage: 170,
      effect: DISCARD_TEXT,
    });
    expect(FIXTURE_POOL["sv03-183"]?.attacks?.[1]).toEqual({
      cost: ["Colorless", "Colorless", "Colorless"],
      name: "High-Impact Kick",
      damage: 160,
      effect: RECOIL_TEXT,
    });
    // Each card's index-0 attack is its control, and Oinkologne's is the sharpest
    // of the three: it carries effect text read by a DIFFERENT arm of the SAME
    // deriver, so the two indices of one card must produce two different programs.
    expect(FIXTURE_POOL["sv02-063"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv03-054"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(deriveAttackEffect(FIXTURE_POOL["sv03-183"]?.attacks?.[0]?.effect ?? "")).toEqual([
      { op: "applyStatus", status: "confused", target: "defender" },
    ]);
    // Every printing carries a FLAT printed `damage` and no "+"/"×" marker, so
    // `modifierSimulated` (attack.ts) is untouched by this family and the drawback
    // really is the whole of the effect text.
    for (const { id, index, damage } of [...DISCARDERS, RECOILER]) {
      expect(FIXTURE_POOL[id]?.attacks?.[index]?.damage, id).toBe(damage);
    }
    // ⚠️ NEITHER SENTENCE CARRIES AN APOSTROPHE AT ALL — the first pair in this
    // family with no D136/D137 exposure to class, stated here so the next reader
    // does not go looking for a `['’]` slot that was left out.
    for (const text of [DISCARD_TEXT, RECOIL_TEXT]) {
      expect(text, text).not.toContain("'");
      expect(text, text).not.toContain("’");
    }
  });
});

describe("the tails-gated self-costs — the seed table, pinned", () => {
  it("lands the face the table claims, on all THREE installers, for every seed", () => {
    // ⚠️ WITHOUT THIS, EVERY BOTH-FACES CASE BELOW COULD BE VACUOUS. A deck edit
    // that reshuffles the boards would silently move the faces, and a case that
    // expected a paid cost and found none would still pass its "nothing happened"
    // half — which on these two sentences is the ONLY half a board delta shows.
    for (const id of [...DISCARDERS.map((d) => d.id), RECOILER.id]) {
      for (const seed of TAILS_SEEDS) {
        expect(faceOf(mustApply(armed(seed, id), { type: "attack", seat: "p1", index: 1 }).events), `${id}/${String(seed)}`).toBe("tails");
      }
      for (const seed of HEADS_SEEDS) {
        expect(faceOf(mustApply(armed(seed, id), { type: "attack", seat: "p1", index: 1 }).events), `${id}/${String(seed)}`).toBe("heads");
      }
    }
    // ONE TABLE FOR THREE INSTALLERS, and the reason is structural rather than
    // lucky: the declaration is the first coin either board draws after setup, and
    // every surgery in `armed` (setActiveFromDeck, attachFromDeck) is rng-pure.
    // The two lists are disjoint and cover [1..40] between them.
    expect([...TAILS_SEEDS, ...HEADS_SEEDS].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, i) => i + 1),
    );
  });

  it("takes the coin on BOTH faces — `rngState` advances either way", () => {
    // The property that keeps an ONLINE match in step, and the one a local suite
    // asserting only board deltas cannot see: `coinFlipGate` flips FIRST and
    // splices second, so a heads (which does nothing on either sentence) still
    // spends the draw. A build that checked the face before flipping would
    // desynchronise the next coin for both players, invisibly.
    for (const id of [...DISCARDERS.map((d) => d.id), RECOILER.id]) {
      for (const seed of [TAILS_SEEDS[0], HEADS_SEEDS[0]]) {
        const before = armed(seed, id);
        const { state: done } = mustApply(before, { type: "attack", seat: "p1", index: 1 });
        expect(done.rngState, `${id}/${String(seed)}`).not.toBe(before.rngState);
      }
    }
    // …and each card's index-0 control takes NO coin at all on the same deck,
    // which is what makes "the flip belongs to the gate" a claim rather than a
    // coincidence of this deck's shuffle.
    for (const id of [...DISCARDERS.map((d) => d.id), RECOILER.id]) {
      const bare = armed(TAILS_SEEDS[0], id);
      const { state: done, events } = mustApply(bare, { type: "attack", seat: "p1", index: 0 });
      expect(done.rngState, id).toBe(bare.rngState);
      expect(types(events), id).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    }
  });
});

describe("the DISCARD — `Flip a coin. If tails, discard all Energy from this Pokémon.`", () => {
  it("TAILS strips EVERY attached Energy — mixed types, and beyond the printed cost", () => {
    for (const [i, { id, index, damage }] of DISCARDERS.entries()) {
      // FOUR attached against a three-symbol cost: "all" is only a claim when
      // there is a surplus to leave behind, and only a claim about `anyEnergy`
      // when the pile is MIXED (two typed + one Colorless + one more typed).
      const state = armed(TAILS_SEEDS[i] as number, id, { surplus: 1 });
      const attacker = activeUid(state, "p1");
      expect(state.players.p1.active?.energy).toHaveLength(4);
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });

      expect(faceOf(events), id).toBe("tails");
      expect(done.players.p1.active?.energy, id).toEqual([]);
      const discarded = find(events, "ENERGY_DISCARDED");
      expect(discarded?.uids, id).toHaveLength(4);
      // The row is filed under the ACTOR — the attacker's own seat pays its own
      // cost — and it names the Pokémon that LOST the Energy by uid.
      expect(discarded, id).toMatchObject({ seat: "p1", actor: "p1", host: attacker });
      // All four cards really reached the discard pile, not just the attachment.
      for (const uid of discarded?.uids ?? []) expect(done.players.p1.discard, id).toContain(uid);
      // THE PRINTED DAMAGE LANDS ANYWAY — the coin gates the drawback and nothing
      // else, which is exactly why the defender's side of the board cannot tell
      // the two faces apart.
      expect(find(events, "DAMAGE_DEALT")?.dealt, id).toBe(damage);
      expect(types(events), id).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("HEADS strips NOTHING — the same declaration, the same damage, no row", () => {
    // ⚠️ THE MUTATION TOMBSTONE. A build that dropped `onTails` (or left
    // `runProgram` comparing against "heads") passes every assertion in the case
    // above and fails here — and in play it would empty the attacker on precisely
    // the declarations that did not earn it, with the printed 220 landing either
    // way and nothing on the defender's side looking wrong.
    for (const [i, { id, index, damage }] of DISCARDERS.entries()) {
      const state = armed(HEADS_SEEDS[i] as number, id, { surplus: 1 });
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(faceOf(events), id).toBe("heads");
      expect(types(events), id).not.toContain("ENERGY_DISCARDED");
      expect(done.players.p1.active?.energy, id).toHaveLength(4);
      expect(find(events, "DAMAGE_DEALT")?.dealt, id).toBe(damage);
      // A HEADS IS NOT A SKIPPED EFFECT (D134's rule, on the other face): the
      // sentence WAS read and the coin decided. The loud row would be a lie.
      expect(types(events), id).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("lands the rows in §8 printed order — damage, then the coin, then the discard", () => {
    // D125's tail placement, made visible: an `EffectOp` runs strictly AFTER the
    // §8.5 pipeline, so the coin is not even taken until the damage is on the
    // board. A build that moved the gate in FRONT of §8.5 (where
    // `deriveAttackCoinFlip`'s members correctly live, because THEY fold damage)
    // would reorder these three rows and change nothing else.
    const { events } = mustApply(armed(TAILS_SEEDS[2] as number, "sv02-063"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(types(events).slice(0, 4)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "ENERGY_DISCARDED",
    ]);
  });

  it("PAYS THE COST EVEN WHEN THE MAIN HIT DEALT ZERO — the §11 prevention board", () => {
    // ⚠️ THE ORDERING QUESTION WITH TEETH, AND THE REASON PIKACHU EX IS THE
    // FIXTURE. Mimikyu sv02-097's Safeguard nulls all damage from an opponent's
    // Pokémon ex/V, and `isExOrV` reads the rule box off the NAME — so this is
    // the one board in the pool where §8.5 deals 0 and the effect program at the
    // tail still runs. §11 prevents the DAMAGE, not the attack: the coin is still
    // taken and, on a tails, every Energy still comes off. That is a real ruling
    // and it is the opposite of what a CANCELLED attack does (D125's requirement
    // gate and D126's `cancelOnTails` both return in FRONT of the program — and
    // neither of these three printings carries either sentence, the anchors being
    // whole-string).
    const state = armed(TAILS_SEEDS[3] as number, "sv02-063", { defender: "sv02-097" });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.prevented).toBe(true);
    expect(dealt?.dealt).toBe(0);
    // Mimikyu is 70 HP and the printed 220 would have swept it off the board, so
    // the prevention is visible rather than asserted.
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(faceOf(events)).toBe("tails");
    expect(find(events, "ENERGY_DISCARDED")?.uids).toHaveLength(3);
    expect(done.players.p1.active?.energy).toEqual([]);
  });

  it("leaves the attacker unable to pay ANY attack on its next turn", () => {
    // What the drawback MEANS in play, driven across the turn boundary rather
    // than asserted off an energy array: a stripped Pikachu ex cannot afford
    // "Dynamic Bolt" ({L}{L}{C}) OR its own one-symbol "Pika Punch" ({C}) two
    // turns later, and both projections agree with the gate.
    const paid = mustApply(armed(TAILS_SEEDS[4] as number, "sv02-063"), {
      type: "attack",
      seat: "p1",
      index: 1,
    }).state;
    expect(paid.players.p1.active?.energy).toEqual([]);
    const own = nextOwnTurn(paid);
    expect(refusal(own, "p1", 1)).toBe("ATTACK_COST_UNMET");
    expect(refusal(own, "p1", 0)).toBe("ATTACK_COST_UNMET");
    const view = redactGame(own, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    for (const attack of view.attacks) {
      expect(attack.playable, `attack ${String(attack.index)} offered with no Energy`).toBe(false);
    }
    // The HEADS board on the SAME turn offers both — so the assertion above is
    // about the discard and not about a §4 ban or a stale projection.
    const kept = nextOwnTurn(
      mustApply(armed(HEADS_SEEDS[2] as number, "sv02-063"), {
        type: "attack",
        seat: "p1",
        index: 1,
      }).state,
    );
    expect(refusal(kept, "p1", 0)).toBe("ok");
    const free = redactGame(kept, "p1").phase;
    if (free.kind !== "turn:action") throw new Error(`expected turn:action, got ${free.kind}`);
    expect(free.attacks.every((a) => a.playable)).toBe(true);
  });

  it("does not inherit down the attack index — Pika Punch flips nothing", () => {
    // "Pika Punch" carries no effect text at all, so the declaration takes no
    // coin and strips nothing. The control that proves a program does not leak
    // across indices on a card where one attack has one.
    const state = armed(TAILS_SEEDS[5] as number, "sv02-063", { surplus: 1 });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(done.players.p1.active?.energy).toHaveLength(4);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("reads correctly in the LOG — the coin row, then the cost row, in the payer's voice", () => {
    // ⚠️ THE VOICE QUESTION, DRIVEN RATHER THAN ARGUED (D144's habit). Two rows
    // land on one declaration: `ATTACK_EFFECT_COIN_FLIP` is a NEUTRAL fact about
    // the actor ("flipped tails for the effect", shared with every Trainer coin
    // since M5), and `ENERGY_DISCARDED` reads from its `actor` — which for a
    // self-discard is the SAME seat that owns the stripped Pokémon, and names the
    // owner outright so a mirror match cannot print two identical rows (D136's
    // finding 1 is the reason that field exists).
    const { state: done, events } = mustApply(armed(TAILS_SEEDS[0], "sv02-063"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const text = lines(events, done);
    expect(text).toContain("Pikachu ex used Dynamic Bolt");
    expect(text).toContain("flipped tails for the effect");
    expect(text.some((l) => l.startsWith("discarded ") && l.includes("from Ember's Pikachu ex"))).toBe(
      true,
    );
    const at = (needle: string) => text.findIndex((line) => line.includes(needle));
    expect(at("used Dynamic Bolt")).toBeLessThan(at("flipped tails"));
    expect(at("flipped tails")).toBeLessThan(at("discarded "));
    // …and the HEADS declaration produces the coin row and NOT the cost row, so
    // the log tells the two faces apart even though the defender's board cannot.
    const heads = mustApply(armed(HEADS_SEEDS[0], "sv02-063"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const headsText = lines(heads.events, heads.state);
    expect(headsText).toContain("flipped heads for the effect");
    expect(headsText.some((l) => l.startsWith("discarded "))).toBe(false);
  });
});

describe("the RECOIL — `Flip a coin. If tails, this Pokémon also does 60 damage to itself.`", () => {
  it("TAILS places 60 on the ATTACKER as COUNTERS_PLACED source 'self', after the main hit", () => {
    const state = armed(TAILS_SEEDS[0], RECOILER.id);
    const attacker = activeUid(state, "p1");
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });

    expect(faceOf(events)).toBe("tails");
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: attacker,
      amount: 60,
      source: "self",
    });
    expect(done.players.p1.active?.damage).toBe(60);
    // THE PRINTED "ALSO", read as an ORDER: the main hit lands first (§8.5), the
    // coin is taken at the tail, the recoil follows it. 120 HP against a 60
    // recoil means a FRESH body survives — the KO case below arms it on purpose.
    expect(types(events).slice(0, 4)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "COUNTERS_PLACED",
    ]);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(RECOILER.damage);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("HEADS places NOTHING — the same declaration, the same 160, an untouched body", () => {
    // The tombstone for this sentence. A board delta on the DEFENDER cannot tell
    // the faces apart; the attacker's own damage is the entire witness.
    const { state: done, events } = mustApply(armed(HEADS_SEEDS[0], RECOILER.id), {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });
    expect(faceOf(events)).toBe("heads");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(done.players.p1.active?.damage).toBe(0);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(RECOILER.damage);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("is FLAT — the defender's ×2 doubles the main hit and leaves the recoil at 60", () => {
    // ⚠️ THE §8.5 QUESTION, ANSWERED BY MEASUREMENT. `damageSelf` is a flat
    // placement OUTSIDE the damage pipeline (the confusion-self-hit's model), so
    // no Weakness, no Resistance and no reduction can reach it — and the sharpest
    // proof is that the SAME declaration whose main hit doubles still places
    // exactly 60. A build that routed the recoil through §8.5, or that read it
    // off `dealt`, cannot pass both halves.
    const neutral = mustApply(armed(TAILS_SEEDS[6] as number, RECOILER.id), {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });
    expect(find(neutral.events, "DAMAGE_DEALT")?.dealt).toBe(160);
    expect(find(neutral.events, "COUNTERS_PLACED")?.amount).toBe(60);
    const doubled = mustApply(
      armed(TAILS_SEEDS[6] as number, RECOILER.id, { defender: "fix-colorless-weak-big" }),
      { type: "attack", seat: "p1", index: RECOILER.index },
    );
    // fix-colorless-weak-big is ×2 Colorless against a Colorless attacker: 320.
    expect(find(doubled.events, "DAMAGE_DEALT")?.dealt).toBe(320);
    expect(find(doubled.events, "COUNTERS_PLACED")?.amount).toBe(60);
  });

  it("SELF-KNOCKS-OUT a primed body, prizes it to the DEFENDER, and does not end the turn early", () => {
    // ⚠️ D134's FIXTURE HP TRAP, TURNED INTO THE CASE IT WARNS ABOUT. Oinkologne
    // is 120 HP; 60 of prior damage plus a 60 recoil is exactly lethal, and the
    // §8.1 sweep that catches it is `finishAttack`'s TWO-seat one (flow.ts) —
    // widened for `damageSelf` back in M5 and reached here through a GATE for the
    // first time. The prize is owed to the OPPONENT of the Knocked Out side.
    const state = setDamage(armed(TAILS_SEEDS[7] as number, RECOILER.id), "p1", 60);
    const attacker = activeUid(state, "p1");
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });

    expect(faceOf(events)).toBe("tails");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p1", uid: attacker });
    expect(after.players.p1.discard).toContain(attacker);
    // Oinkologne carries no rule box, so it is worth exactly ONE Prize — and the
    // turn does NOT end here: the KO interrupts with its own queue behind it.
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(after.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
    expect(types(events)).not.toContain("TURN_ENDED");
    // The defender never took a lethal hit — fix-titan carries the 160 — so this
    // is a PURE self-KO, the shape a single-seat sweep would have dropped.
    expect(after.players.p2.active?.damage).toBe(160);
    // Drive it out: p2 takes its prize, p1 force-promotes its lone bench body,
    // and only THEN does the turn pass.
    const next = must(applyAction(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    expect(next.players.p2.prizes).toHaveLength(5);
    expect(next.players.p1.active).not.toBeNull();
    expect(next.players.p1.active?.stack).not.toContain(attacker);
    expect(next.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("HEADS on the SAME primed board survives — the coin is the whole difference", () => {
    // The other half of the KO tombstone, and the one that matters most in play:
    // a build ignoring the field would sweep this body off the board on a face
    // that earned nothing.
    const state = setDamage(armed(HEADS_SEEDS[1] as number, RECOILER.id), "p1", 60);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });
    expect(faceOf(events)).toBe("heads");
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(after.players.p1.active?.damage).toBe(60);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("does not inherit down the attack index — Confounding Cologne is a DIFFERENT arm", () => {
    // The sharpest control in the slice: index 0 carries effect text too, read by
    // a different arm of the SAME deriver. It must take no coin, place no
    // counters, and derive a status op instead — so neither index can claim the
    // other's string and neither program leaks across the pair.
    const { state: done, events } = mustApply(armed(TAILS_SEEDS[8] as number, RECOILER.id), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(done.players.p1.active?.damage).toBe(0);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(done.players.p2.active?.conditions.rotation).toBe("confused");
  });

  it("reads correctly in the LOG — the recoil is the ATTACKER's own voice", () => {
    // ⚠️ THE VOICE QUESTION AGAIN, AND A DIFFERENT ANSWER FROM THE DISCARD's.
    // `COUNTERS_PLACED` seat OWNS the damaged Pokémon (D136's finding 1) — which
    // for source "self" is the ACTOR's own body, and the attacker CHOSE this
    // attack, so unlike the confusion self-hit it renders in the active voice
    // under its own seat rather than as a system row. Read in sequence with the
    // KO it causes, the three rows have to say who did what to whom.
    const state = setDamage(armed(TAILS_SEEDS[9] as number, RECOILER.id), "p1", 60);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });
    const text = lines(events, done);
    expect(text).toContain("Oinkologne used High-Impact Kick");
    expect(text).toContain("flipped tails for the effect");
    expect(text).toContain("Oinkologne did 60 damage to itself");
    expect(text).toContain("Oinkologne was Knocked Out");
    const at = (needle: string) => text.findIndex((line) => line.includes(needle));
    expect(at("flipped tails")).toBeLessThan(at("did 60 damage to itself"));
    expect(at("did 60 damage to itself")).toBeLessThan(at("was Knocked Out"));
    // WHOSE LINE EACH ROW IS. Rows render after their seat's name, so the whole
    // voice claim is `who`: the declaration, the coin and the recoil are all the
    // ATTACKER's (a self-cost is the payer's own line, not a system fact), while
    // the PRIZE the self-KO owes belongs to the OPPONENT — which is what makes a
    // self-KO read correctly instead of crediting the wrong player.
    const rows = rendered(events, done);
    const whoSaid = (needle: string) => rows.find((r) => r.text.includes(needle))?.who;
    for (const needle of ["used High-Impact Kick", "flipped tails", "did 60 damage to itself"]) {
      expect(whoSaid(needle), needle).toBe("p1");
    }
    expect(whoSaid("prize")).toBe("p2");
  });
});

describe("the tails-gated self-costs — the whiff, and purity", () => {
  it("discards SILENTLY on an empty attachment set — not loud, not skipped", () => {
    // ⚠️ ASKED BECAUSE THE FAMILY OWES THE QUESTION, ANSWERED WHERE IT LIVES.
    // `count: "all"` with nothing attached files an empty record and returns
    // `done` — no `ENERGY_DISCARDED`, no `ATTACK_EFFECT_SKIPPED`, no park. That
    // is D134's three-state rule (a tails is not a skipped effect; a run that
    // whiffed is not a run that never happened), and D140's: only an UNREAD
    // sentence deserves the loud row.
    //
    // It is UNREACHABLE from either printing — declaring the attack pays a
    // three-symbol cost, so the attachment can never be empty when the op runs —
    // which is exactly why it is driven as a CONSTRUCTED program rather than
    // pretended into a board (D144's precedent for its face-agnostic descent).
    const state = armed(HEADS_SEEDS[3] as number, "sv02-063");
    const active = state.players.p1.active;
    if (active === null) throw new Error("no active");
    const stripped: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: { ...active, energy: [] } } },
    };
    const events: GameEvent[] = [];
    const bare = deriveAttackEffect(BARE_DISCARD) as EffectOp[];
    const out = runProgram(stripped, bare, { seat: "p1", sourceUid: activeUid(stripped, "p1") }, events);
    expect("state" in out).toBe(true);
    expect(events).toEqual([]);
    // …and the same op through the GATE spends the coin and still says nothing,
    // which is the combination a reader has to see once.
    const gatedEvents: GameEvent[] = [];
    const gated = deriveAttackEffect(DISCARD_TEXT) as EffectOp[];
    runProgram(stripped, gated, { seat: "p1", sourceUid: activeUid(stripped, "p1") }, gatedEvents);
    expect(types(gatedEvents)).toEqual(["ATTACK_EFFECT_COIN_FLIP"]);
  });

  it("never mutates the state it was given (purity), on either sentence", () => {
    for (const id of ["sv02-063", RECOILER.id]) {
      const state = deepFreeze(armed(TAILS_SEEDS[10] as number, id));
      expect(() => applyAction(state, { type: "attack", seat: "p1", index: 1 })).not.toThrow();
    }
  });
});

describe("the tails-gated self-costs — the family, CLOSED", () => {
  it("reads all THREE bare tails-gated sentences and refuses the other FIVE", () => {
    // ⚠️ THE FAMILY IS CLOSED, WHICH IS THE MOST USEFUL THING THIS FILE STATES.
    // D144's census (local D1, 2026-08-02, 978 cards / 6 sets): `attacks_json LIKE
    // '%if tails%'` returns 26 printings / 8 sentences, plus 2 on a Trainer and 0
    // on any Ability — 28 in all. Exactly THREE of those sentences are a bare
    // "Flip a coin. If tails, <one consequent>.", the shape `onTails` buys, and
    // they are 8 printings. D144 took 5; this slice takes the other 3. There is
    // no fourth, and the 20 refusals below are refused by their SHAPE rather than
    // by any anchor's spelling — so the next tails printing this op can express
    // is one the pool does not print.
    for (const text of [
      "Flip a coin. If tails, during your next turn, this Pokémon can't attack.",
      DISCARD_TEXT,
      RECOIL_TEXT,
    ]) {
      const ops = deriveAttackEffect(text) as EffectOp[] | null;
      expect(ops, text).not.toBeNull();
      expect(ops?.[0], text).toMatchObject({ op: "coinFlipGate", onTails: true });
    }
    for (const text of [
      // ALREADY SIMULATED, by a DIFFERENT reader — `deriveAttackCoinFlip`'s
      // `cancelOnTails` (D126, 11 printings), which runs in FRONT of the §8.5
      // pipeline because it retracts damage. Null HERE is correct: the two tails
      // readings are disjoint by consequent, exactly as the heads pair is.
      "Flip a coin. If tails, this attack does nothing.",
      // A DURATED gate that makes the OPPONENT flip on their own turn (4 —
      // Dolliv sv01-022/-200 "Apply Oil", Quaxly sv02-049/-206 "Apply Gel"). Not
      // a `coinFlipGate` at all, and the field brings it no closer.
      "During your opponent's next turn, if the Defending Pokémon tries to attack, your opponent flips a coin. If tails, that attack doesn't happen.",
      // TWO consequents on ONE flip (5 printings across 4 sentences, one of them
      // a TRAINER) — an `otherwise` this op deliberately does not have (D142's
      // Squawkabilly refusal, verbatim). ⚠️ THESE ARE THE LIVE UNMAPPED WITNESSES
      // this family leaves behind: when a later slice maps one, RE-POINT the row
      // at another rather than deleting it.
      "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.",
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck. If tails, discard a card from your hand.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("pins the shape at 8 printings across 3 sentences, and this slice's 3 by id", () => {
    // The numbers a re-census has to reproduce, and the ids that carry them.
    const SHAPE = [
      { sentence: "can't attack", ids: ["sv01-157", "sv01-158", "sv01-234", "sv02-130", "sv02-244"] },
      { sentence: "discard all Energy", ids: ["sv02-063", "sv03-054"] },
      { sentence: "60 damage to itself", ids: ["sv03-183"] },
    ] as const;
    expect(SHAPE).toHaveLength(3);
    expect(SHAPE.flatMap((s) => s.ids)).toHaveLength(8);
    // Every id this slice claims is a real fixture printing the sentence at the
    // index the slice claims — the catalog half of the census, checkable here.
    for (const { id, index } of [...DISCARDERS, RECOILER]) {
      expect(FIXTURE_POOL[id]?.attacks?.[index]?.effect, id).toBe(
        id === RECOILER.id ? RECOIL_TEXT : DISCARD_TEXT,
      );
      expect(index, id).toBe(1);
    }
    // ⚠️ AND sv03-183 IS A DIFFERENT CARD FROM D144's sv01-157, not another
    // rarity of it — D135's Arboliva finding, applied before it could bite. The
    // two are the trap in its purest form: SAME NAME, same evolution line, same
    // types, same retreat and even the SAME 120 HP, so every cheap discriminator
    // agrees they are one card. What differs is the SET and all four ATTACKS —
    // which is why a printing is checked by id and attack, never by name.
    expect(FIXTURE_POOL["sv03-183"]?.name).toBe(FIXTURE_POOL["sv01-157"]?.name);
    expect(FIXTURE_POOL["sv03-183"]?.hp).toBe(FIXTURE_POOL["sv01-157"]?.hp);
    const names = (id: string) => (FIXTURE_POOL[id]?.attacks ?? []).map((a) => a.name);
    expect(names("sv03-183")).toEqual(["Confounding Cologne", "High-Impact Kick"]);
    expect(names("sv01-157")).toEqual(["Ram", "Leg Stomp"]);
  });
});
