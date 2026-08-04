import { describe, expect, it } from "vitest";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  PREVENT_BLOCK_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  types,
} from "./testFixtures";

// 0.90.0 → 0.91.0 — the GATED PREVENT clause (P3-M5 long tail, D142):
//
//   "Flip a coin. If heads, during your opponent's next turn, prevent all damage
//    FROM AND EFFECTS OF attacks done to this Pokémon."          (11 printings)
//   "Flip a coin. If heads, during your opponent's next turn, prevent all damage
//    done to this Pokémon by attacks."                           ( 2 printings)
//
// The biggest un-taken count in D134's gated census, and the first slice in this
// family that buys a CONTINUOUS-EFFECT MECHANISM rather than a reader. Four
// things it turns on, and every one of them is a lifetime question:
//
//   • the state is a TURN STAMP on `InPlayPokemon` (D124), not a flag cleared at
//     a turn boundary — because the boundary clear D112 reused for the retreat
//     block runs for the seat whose turn just ENDED, and this block sits on the
//     INSTALLER's own body, so that clock lifts it a full turn EARLY;
//   • both spellings refuse DAMAGE at the four sites Mimikyu's Safeguard is
//     honoured at; only the wider one refuses an attack's EFFECTS, and the
//     catalog prints the rule that splits them (Bronzong sv03-145: "(Damage is not
//     an effect.)"), which is why a placed damage COUNTER is on the effects side;
//   • "effects of ATTACKS" is a provenance question the target cannot answer, so
//     it rides `EffectContext.invokedBy` — a Trainer played inside the window is
//     NOT refused, and Crushing Hammer proves it on the same op an attack uses;
//   • it ends EARLY wherever an effect of an attack ends: leaving the Active Spot
//     (a Boss's Orders inside the window is the reachable one) or evolving.

const WIDE_TEXT =
  "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";
const NARROW_TEXT =
  "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks.";

/** Seeds on which the install flip comes up HEADS, measured over [1..40] on this
    deck — and the SAME list for both installers, because the install is the first
    coin either board draws after setup and the surgeries below consume no rng.
    Pinned by its own case, so a deck edit that shifts the shuffle fails loudly
    here instead of silently turning every cross-turn assertion vacuous. */
const HEADS_SEEDS = [2, 3, 6, 7, 16, 18, 20, 22, 23, 27, 28, 30, 34, 35, 38] as const;
/** …and the complement, so the tails face is driven rather than assumed. */
const TAILS_SEEDS = [1, 4, 5, 8, 9, 10, 11, 12, 13, 14] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    installer goes on P1's Active with the one {C} its index-0 attack costs; the
    board it will be attacked on is set up per case, because every case needs a
    different attacker. */
function armed(seed: number, installer: string): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: PREVENT_BLOCK_DECK, p2: PREVENT_BLOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", installer);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** `armed`, then the install declared — the board every cross-turn case starts
    from. Asserts the flip actually came up heads rather than trusting the seed
    table, so a shuffle drift can never leave a case asserting "nothing was
    blocked" against a board that never installed anything. Returns P2's turn. */
function installed(seed: number, installer: string): GameState {
  const { state, events } = mustApply(armed(seed, installer), {
    type: "attack",
    seat: "p1",
    index: 0,
  });
  if (find(events, "ATTACK_BLOCK_APPLIED") === undefined) {
    throw new Error(`seed ${seed} did not install a block on ${installer} (tails?)`);
  }
  return state;
}

describe("the gated PREVENT clause — derived, not authored", () => {
  it("derives the WIDE spelling to a gated preventDamage carrying `effects`", () => {
    expect(deriveAttackEffect(WIDE_TEXT)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "preventDamage", effects: true }],
      },
    ]);
    // The typographic apostrophe derives identically — a re-ingest that changes
    // only punctuation must not silently un-simulate ELEVEN printings (D136/D137).
    expect(deriveAttackEffect(WIDE_TEXT.replace(/'/g, "’"))).toEqual(deriveAttackEffect(WIDE_TEXT));
  });

  it("derives the NARROW spelling with the `effects` key ABSENT, not false", () => {
    const derived = deriveAttackEffect(NARROW_TEXT);
    expect(derived).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "preventDamage" }],
      },
    ]);
    // ABSENT rather than `false` (D135's rule for `zone`): the printed sentence
    // never says "from and effects of", so the op carries no claim about the
    // wider reading at all. `toEqual` ignores undefined keys, so the key set is
    // asserted directly — this is the assertion, not the one above.
    const gate = derived?.[0] as Extract<EffectOp, { op: "coinFlipGate" }>;
    expect(Object.keys(gate.then[0] as object)).toEqual(["op"]);
    expect(deriveAttackEffect(NARROW_TEXT.replace(/'/g, "’"))).toEqual(derived);
  });

  it("the two spellings differ in EXACTLY the `effects` field", () => {
    // The widen-don't-add claim (D131), asserted rather than argued: strip the
    // one field and the two derived programs are byte-identical, so a second op
    // member would have been two copies of one installation.
    const wide = deriveAttackEffect(WIDE_TEXT) as EffectOp[];
    const narrow = deriveAttackEffect(NARROW_TEXT) as EffectOp[];
    const stripped = JSON.parse(JSON.stringify(wide).replace(',"effects":true', ""));
    expect(stripped).toEqual(narrow);
  });

  it("is anchored end to end", () => {
    // Leading text, a missing period, a lowercase opener — each keeps the attack
    // on the loud ATTACK_EFFECT_SKIPPED path rather than half-simulating.
    expect(deriveAttackEffect(`Then, ${WIDE_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(WIDE_TEXT.slice(0, -1))).toBeNull();
    expect(deriveAttackEffect(WIDE_TEXT.toLowerCase())).toBeNull();
    // The UNGATED body alone is not this sentence — the coin is printed, and a
    // reader that matched the tail would flip nothing and install unconditionally.
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      ),
    ).toBeNull();
  });

  it("refuses the FOUR printings of this family it deliberately does not map", () => {
    // Every one is real text from the local D1, and each is refused by a
    // different property of the whole-sentence anchor — the list a future slice
    // inherits instead of re-censusing (effects.ts carries the same table).
    for (const text of [
      // ⚠️ RE-POINTED AT D146, NOT DELETED. The BASIC-filtered spelling that used
      // to head this list is now MAPPED (`preventDamage { fromClass: "Basic" }`,
      // classBlock.test.ts) — and its two cards were misnamed here as "Fletchling
      // sv01-150 / Bombirdier sv02-153/-246"; the D1 says Staraptor and Noivern
      // ex. Its ANCIENT sibling stays, and stays for a HARDER reason than "no
      // predicate yet": the Ancient/Future banner is printed on the card FACE and
      // exists in no column of the catalog and no field of tcgdex's own model, so
      // there is no datum a predicate could read. Iron Moth sv06.5-009, index 1.
      "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.",
      // Corviknight sv02-148 "Accelerate" — gated on the attack's own RESULT.
      "If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      // Squawkabilly sv01-162 "Fly" — a SECOND consequent on the same flip.
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      // Bronzong sv03-145 "Oracle Press" — the THIRD reading, effects WITHOUT
      // damage, and the printing whose parenthetical is this slice's spec.
      "During your opponent's next turn, prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // …and the sentence that LEFT this list is asserted to have left it, so the
    // re-pointing above is a fact rather than a comment (D144's own move applied
    // to D142's own witness).
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.",
      ),
    ).toEqual([{ op: "preventDamage", fromClass: "Basic" }]);
    // …and the ONE sentence that shares this duration and is NOT refused stays
    // exactly where D112 left it — a different op, on the other side of the
    // table. The two durated riders are told apart by their whole sentence, not
    // by the words they share.
    expect(
      deriveAttackEffect("During your opponent's next turn, the Defending Pokémon can't retreat."),
    ).toEqual([{ op: "preventRetreat" }]);
  });

  it("costs zero registry rows — both cards simulate off their printed text", () => {
    // `programFor(id)?.attack` rather than `programFor(id)`: a row on the CARD is
    // not a row on the ATTACK (D139/D140), and Mimikyu below proves the two differ.
    expect(programFor("sv03-004")).toBeUndefined();
    expect(programFor("sv03-151")).toBeUndefined();
    expect(programFor("sv02-097")?.attack).toBeUndefined();
  });

  it("keeps the fixtures' printed text verbatim — the sentence is load-bearing", () => {
    expect(FIXTURE_POOL["sv03-004"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Agility",
      damage: 10,
      effect: WIDE_TEXT,
    });
    expect(FIXTURE_POOL["sv03-151"]?.attacks?.[0]?.effect).toBe(NARROW_TEXT);
    // No printed `damage` on the narrow installer — the install is the entire
    // visible result of that declaration.
    expect(FIXTURE_POOL["sv03-151"]?.attacks?.[0]?.damage).toBeUndefined();
    for (const text of [WIDE_TEXT, NARROW_TEXT]) {
      expect(text).toContain("opponent's");
      expect(text).toContain("Pokémon");
      expect(text).not.toContain("’");
    }
  });
});

describe("the gated PREVENT clause — installing it", () => {
  it("HEADS stamps the OPPONENT's next turn and announces it in the actor's voice", () => {
    const state = armed(HEADS_SEEDS[0], "sv03-004");
    const installer = activeUid(state, "p1");
    expect(state.turn).toBe(2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(find(events, "ATTACK_BLOCK_APPLIED")).toEqual({
      type: "ATTACK_BLOCK_APPLIED",
      seat: "p1",
      uid: installer,
      effects: true,
    });
    // THE STAMP IS THE DURATION: turn 2 installed it, turn 3 is the opponent's,
    // and that is the only turn it answers on. Not a flag, so nothing anywhere
    // has to remember to clear it.
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Attacker-relative, like every "self" op: the DEFENDER is untouched, and so
    // is every benched body on both boards.
    expect(done.players.p2.active?.attackBlock).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) expect(benched.attackBlock).toBeNull();
    }
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("keeps the printed 10 — a D125 tail board, damage AND an install", () => {
    const state = armed(HEADS_SEEDS[1], "sv03-004");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const order = types(events);
    // The §8.5 hit lands FIRST and the install rides the tail behind it, which is
    // where every EffectOp runs — and is free here rather than lucky, since the
    // block's whole effect is in the future (D125's placement rule).
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ATTACK_BLOCK_APPLIED"));
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(done.players.p2.active?.damage).toBe(10);
  });

  it("the NARROW spelling installs `effects: false`, and prints no damage at all", () => {
    const state = armed(HEADS_SEEDS[0], "sv03-151");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "ATTACK_BLOCK_APPLIED")?.effects).toBe(false);
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: false });
    // No printed damage on "Defense Curl", so the install is the whole result.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("TAILS installs nothing — and is a RESOLVED attack, not a skipped effect", () => {
    for (const seed of TAILS_SEEDS.slice(0, 4)) {
      const { state: done, events } = mustApply(armed(seed, "sv03-004"), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
      expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
      expect(done.players.p1.active?.attackBlock).toBeNull();
      // The sentence WAS read — the coin decided. A loud row here would be a lie
      // (D134), and the printed damage still lands on a tails.
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    }
  });

  it("the coin is TAKEN on both faces — rngState advances either way", () => {
    for (const seed of [HEADS_SEEDS[0], TAILS_SEEDS[0]]) {
      const before = armed(seed, "sv03-004");
      const { state: after } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
      expect(after.rngState).not.toBe(before.rngState);
    }
    // …and the seed table itself is pinned, so a deck edit that reshuffles this
    // suite fails HERE rather than turning every cross-turn case vacuous.
    for (const seed of HEADS_SEEDS) {
      const { events } = mustApply(armed(seed, "sv03-004"), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    }
    for (const seed of TAILS_SEEDS) {
      const { events } = mustApply(armed(seed, "sv03-004"), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    }
  });

  it("does not inherit down the attack index — Cut installs nothing", () => {
    let state = armed(HEADS_SEEDS[0], "sv03-004");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(done.players.p1.active?.attackBlock).toBeNull();
  });
});

describe("the gated PREVENT clause — the DAMAGE half (both spellings)", () => {
  it("nulls the main §8.5 hit to 0 and flags it prevented", () => {
    for (const installer of ["sv03-004", "sv03-151"] as const) {
      let state = installed(HEADS_SEEDS[2], installer);
      state = setActiveFromDeck(state, "p2", "fix-attacker");
      state = attachFromDeck(state, "p2", "fix-energy", 1);
      deepFreeze(state);
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });

      // fix-attacker is FIRE and both installers are ×2 Fire-weak, so an unblocked
      // Bite is 60. The pipeline still RUNS — Weakness is reported on the row —
      // and the block nulls the RESULT, exactly like Mimikyu's Safeguard beside it.
      const hit = find(events, "DAMAGE_DEALT");
      expect(hit).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
      expect(hit?.weakness).toEqual({ op: "multiply", amount: 2 });
      expect(done.players.p1.active?.damage).toBe(0);
    }
  });

  it("protects THIS Pokémon and not the rest of the board", () => {
    // One declaration, two answers: Spread Shot's 30 on the shielded Active is
    // prevented while its 20 lands on every benched body — "done to this Pokémon"
    // is a per-Pokémon claim, and the block never travels off the card it is on.
    let state = installed(HEADS_SEEDS[3], "sv03-004");
    state = setActiveFromDeck(state, "p2", "fix-sniper");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const benchBefore = state.players.p1.bench.map((p) => p.damage);
    expect(benchBefore.length).toBeGreaterThan(0);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });

    const rows = findAll(events, "DAMAGE_DEALT");
    const activeRow = rows.find((r) => r.uid === activeUid(state, "p1"));
    expect(activeRow).toMatchObject({ dealt: 0, prevented: true });
    for (const [i, before] of benchBefore.entries()) {
      expect(done.players.p1.bench[i]?.damage).toBe(before + 20);
    }
  });

  it("expires by arithmetic — the very next hit a turn later lands in full", () => {
    let state = installed(HEADS_SEEDS[4], "sv03-004");
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    // Turn 3 (the opponent's next turn): prevented.
    const blocked = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(find(blocked.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    // Turn 4 is P1's; they pass. Turn 5 is P2's again — and the stamp says 3.
    expect(blocked.state.turn).toBe(4);
    expect(blocked.state.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    const p2Again = must(applyAction(blocked.state, { type: "endTurn", seat: "p1" }));
    expect(p2Again.turn).toBe(5);
    const { state: done, events } = mustApply(p2Again, { type: "attack", seat: "p2", index: 0 });
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ dealt: 60 }); // ×2 Fire weakness, unblocked
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(60);
    // The stale stamp is STILL SITTING THERE and answers nothing — which is the
    // whole design: no boundary walk clears it and none has to.
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
  });

  it("does NOT lift at the Checkup that ends the INSTALLER's own turn", () => {
    // The D112 clock would have. Installing ends P1's turn, so a Checkup runs
    // immediately with endedSeat = p1 — the holder's OWN seat — and a paralysis-
    // clock clear keyed on `endedSeat` lifts the block a full turn EARLY, before
    // its window has opened at all. That failure is invisible on the retreat
    // block, whose holder is the DEFENDER, which is exactly why this one is a
    // stamp. The install events carry that whole Checkup.
    const { state: done, events } = mustApply(armed(HEADS_SEEDS[5], "sv03-004"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).toContain("TURN_STARTED");
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
  });
});

describe("the gated PREVENT clause — the EFFECTS half, and the field that splits it", () => {
  /** The same declaration into a WIDE block and into a NARROW one — the pair
      every case below runs, because the field's whole content is the difference. */
  function against(
    installer: string,
    seed: number,
    attacker: string,
    energy: { id: string; count: number },
    index = 0,
  ) {
    let state = installed(seed, installer);
    state = setActiveFromDeck(state, "p2", attacker);
    state = attachFromDeck(state, "p2", energy.id, energy.count);
    return mustApply(state, { type: "attack", seat: "p2", index });
  }

  it("refuses a §12 Special Condition — and the NARROW block does not", () => {
    const wide = against(
      "sv03-004",
      HEADS_SEEDS[6],
      "fix-attacker",
      { id: "fix-energy", count: 1 },
      2,
    );
    expect(types(wide.events)).not.toContain("STATUS_APPLIED");
    expect(find(wide.events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p1" });
    expect(wide.state.players.p1.active?.conditions.rotation).toBe("none");

    const narrow = against(
      "sv03-151",
      HEADS_SEEDS[6],
      "fix-attacker",
      { id: "fix-energy", count: 1 },
      2,
    );
    expect(find(narrow.events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "asleep" });
    expect(types(narrow.events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(narrow.state.players.p1.active?.conditions.rotation).toBe("asleep");
  });

  it("refuses the §11 RETREAT LOCK — two durated blocks meeting, one refusing the other", () => {
    const wide = against("sv03-004", HEADS_SEEDS[7], "sv02-016", {
      id: "fix-grass-energy",
      count: 1,
    });
    expect(types(wide.events)).not.toContain("RETREAT_BLOCKED");
    expect(types(wide.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(wide.state.players.p1.active?.retreatBlocked).toBe(false);
    // The attack's DAMAGE is refused by the other half of the same block.
    expect(find(wide.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });

    const narrow = against("sv03-151", HEADS_SEEDS[7], "sv02-016", {
      id: "fix-grass-energy",
      count: 1,
    });
    expect(find(narrow.events, "RETREAT_BLOCKED")).toMatchObject({ seat: "p1" });
    expect(narrow.state.players.p1.active?.retreatBlocked).toBe(true);
    // …while the DAMAGE is still refused, because both spellings stop damage.
    expect(find(narrow.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });

  it("refuses a placed damage COUNTER — the sharpest split, because it is NOT damage", () => {
    // Mimikyu "Ghost Eye" puts 7 counters (70 HP). A placed counter skips
    // Weakness, Resistance and every reduction passive in this engine (D138/D139)
    // and the catalog prints the rule — "(Damage is not an effect.)" — so it is
    // an EFFECT, refused by the wide block and untouched by the narrow one.
    const wide = against("sv03-004", HEADS_SEEDS[8], "sv02-097", {
      id: "fix-psychic-energy",
      count: 2,
    });
    expect(types(wide.events)).not.toContain("COUNTERS_PLACED");
    expect(types(wide.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(wide.state.players.p1.active?.damage).toBe(0);

    const narrow = against("sv03-151", HEADS_SEEDS[8], "sv02-097", {
      id: "fix-psychic-energy",
      count: 2,
    });
    expect(find(narrow.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: 70,
      source: "attack",
    });
    expect(narrow.state.players.p1.active?.damage).toBe(70);
  });

  it("refuses an Energy discard off the defender — and takes the WHOLE op, not the prompt", () => {
    // Pincurchin "Needle Crush" is 70 damage AND a discard, so ONE declaration
    // shows the two halves together (wide) and SPLIT (narrow).
    const wide = against("sv03-004", HEADS_SEEDS[9], "sv02-072", {
      id: "fix-lightning-energy",
      count: 3,
    });
    expect(find(wide.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(types(wide.events)).not.toContain("ENERGY_DISCARDED");
    expect(types(wide.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(wide.state.players.p1.active?.energy).toHaveLength(1);
    // The refusal is taken in FRONT of the candidate scan, so the opponent is
    // never parked on a pick that will not happen.
    expect(wide.state.phase.kind).not.toBe("effect:choose");

    const narrow = against("sv03-151", HEADS_SEEDS[9], "sv02-072", {
      id: "fix-lightning-energy",
      count: 3,
    });
    expect(find(narrow.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(types(narrow.events)).toContain("ENERGY_DISCARDED");
    expect(narrow.state.players.p1.active?.energy).toHaveLength(0);
  });

  it("a counter PUT through the NARROW block can still KNOCK OUT the holder", () => {
    // The "KO'd while blocked" ordering, and the only board that reaches it: the
    // wide block refuses the placement outright, and the damage half refuses
    // every hit, so the ONLY lethal route to a shielded body is an effect that
    // places counters through the narrow spelling.
    let state = installed(HEADS_SEEDS[10], "sv03-151");
    state = setDamage(state, "p1", 20); // 80 HP Togedemaru, 70 counters incoming
    state = setActiveFromDeck(state, "p2", "sv02-097");
    state = attachFromDeck(state, "p2", "fix-psychic-energy", 2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    const order = types(events);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(find(events, "PRIZES_OWED")).toMatchObject({ seat: "p2" });
    expect(done.phase.kind).toBe("ko:takePrizes");
  });
});

describe("the gated PREVENT clause — what it does NOT block", () => {
  it("a TRAINER inside the window — the same op, refused only for an ATTACK", () => {
    // fix-hammer is `discardEnergy from: "opponentChosen"`, the arm Crushing
    // Hammer reaches; Pincurchin's attack reaches `opponentActive`. Same op, same
    // victim, same window — and only the ATTACK is refused, because the block
    // covers "effects of ATTACKS" and the provenance rides the INVOCATION
    // (`EffectContext.invokedBy`), never the target.
    let state = installed(HEADS_SEEDS[0], "sv03-004");
    expect(state.players.p1.active?.energy).toHaveLength(1);
    state = handFromDeck(state, "p2", "fix-hammer", 1);
    const { state: done, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "fix-hammer"),
    });
    expect(types(events)).toContain("ENERGY_DISCARDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p1.active?.energy).toHaveLength(0);
    // …and the block is untouched by the Trainer having resolved.
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
  });

  it("an ABILITY on the SAME op, inside the window — Trevenant's Checkup counter", () => {
    // The sharpest provenance case available, because nothing else differs: an
    // ATTACK reaching `damageActive` is refused (the counter-PUT case above) and
    // an ABILITY reaching the very same op is not. And the timing is the hostile
    // one — "Forest Miasma" fires at the Checkup that ENDS the opponent's turn,
    // when `state.turn` is still the block's own window number, so the turn stamp
    // cannot save this: only `invokedBy` can.
    let state = installed(HEADS_SEEDS[3], "sv03-004");
    state = setActiveFromDeck(state, "p2", "sv03-012");
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({ ability: "Forest Miasma" });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: 10,
      source: "ability",
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p1.active?.damage).toBe(10);
  });

  it("a §13 Checkup tick — a Special Condition is not an attack", () => {
    // Poison placed before the window (surgery: the deck prints no poisoner) still
    // ticks at the Checkup that ends the opponent's turn, INSIDE the window. The
    // block refuses effects of ATTACKS; §12/§13 is neither.
    let state = installed(HEADS_SEEDS[1], "sv03-004");
    state = setConditions(state, "p1", { poisonDamage: 10 });
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p1", source: "poison" });
    expect(done.players.p1.active?.damage).toBe(10);
  });

  it("nothing the HOLDER does on their own turn — the stamp makes that structural", () => {
    // The window is the OPPONENT's turn by construction, so a block can never be
    // live while its holder is acting. Drive it: P2 passes, P1 attacks on turn 4
    // with the block still stamped for turn 3, and every one of its own effects
    // resolves normally.
    let state = installed(HEADS_SEEDS[2], "sv03-004");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    state = setActiveFromDeck(state, "p1", "sv02-016");
    state = attachFromDeck(state, "p1", "fix-grass-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("RETREAT_BLOCKED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});

describe("the gated PREVENT clause — the early clears (an effect of an attack ends)", () => {
  it("ends when the Pokémon leaves the Active Spot — a Boss's Orders inside the window", () => {
    // THE REACHABLE CLEAR, and the one the retreat block could not have: the
    // holder is the ATTACKER's own body, so the opponent can drag it off the spot
    // during the very turn the block covers, and the protection goes with it.
    let state = installed(HEADS_SEEDS[3], "sv03-151");
    const shielded = activeUid(state, "p1");
    expect(state.players.p1.bench.length).toBeGreaterThan(0);
    state = handFromDeck(state, "p2", "sv02-172", 1);
    const gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    });
    let next = gusted.state;
    if (next.phase.kind === "effect:choose") {
      next = must(
        applyAction(next, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = next.players.p1.bench.find((p) => p.stack.includes(shielded));
    expect(benched?.attackBlock).toBeNull();
    // Silent: the switch row already tells the story (D112's call, events.ts).
    expect(types(gusted.events)).not.toContain("ATTACK_BLOCK_APPLIED");
    // And it is GONE rather than merely unread: Spread Shot reaches the Bench, so
    // the very body that was shielded a moment ago now takes its 20 — the
    // assertion a build that skipped the clear would fail even though the field
    // is off the Active Spot and nothing else in the game would notice.
    const benchIndex = next.players.p1.bench.findIndex((p) => p.stack.includes(shielded));
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    next = setActiveFromDeck(next, "p2", "fix-sniper");
    next = attachFromDeck(next, "p2", "fix-energy", 1);
    const { state: hit, events } = mustApply(next, { type: "attack", seat: "p2", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
    expect(hit.players.p1.bench[benchIndex]?.damage).toBe(20);
  });

  it("ends on evolution (§10) — unreachable in play, pinned anyway", () => {
    // NO LEGAL SEQUENCE REACHES THIS. Installing ends the turn (§5.3), the window
    // is the opponent's turn, and a player cannot evolve during it — so by the
    // time the holder may evolve, the stamp has already expired. The clear is
    // written because §10 sheds the effects of ATTACKS and this is one; the
    // surgery is what lets the rule be asserted at all.
    // Turn 4 — P1's SECOND turn, since §4/§10 forbid evolving on your first.
    let state = must(
      applyAction(installed(HEADS_SEEDS[4], "sv03-004"), {
        type: "endTurn",
        seat: "p2",
      }),
    );
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // biome-ignore lint/style/noNonNullAssertion: the surgery above set it.
          active: { ...state.players.p1.active!, attackBlock: { turn: 99, effects: true } },
        },
      },
    };
    state = handFromDeck(state, "p1", "fix-stage1", 1);
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-stage1"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p1.active?.attackBlock).toBeNull();
  });

  it("ends on a RETREAT, the deliberate half of the same move", () => {
    let state = armed(HEADS_SEEDS[5], "sv03-004");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // biome-ignore lint/style/noNonNullAssertion: armed() places the Active.
          active: { ...state.players.p1.active!, attackBlock: { turn: 99, effects: true } },
        },
      },
    };
    const shielded = activeUid(state, "p1");
    expect(state.players.p1.bench.length).toBeGreaterThan(0);
    const { state: done } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: state.players.p1.active?.energy ?? [],
      promoteBenchIndex: 0,
    });
    const benched = done.players.p1.bench.find((p) => p.stack.includes(shielded));
    expect(benched?.attackBlock).toBeNull();
  });

  it("installing again REPLACES the stamp rather than accumulating", () => {
    // Two installs, two turns apart. The second writes its own window; nothing
    // adds up and nothing lingers, which is what a stamp buys over a counter.
    let state = installed(HEADS_SEEDS[6], "sv03-004");
    expect(state.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    const again = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const flip = find(again.events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip?.result === "heads") {
      expect(again.state.players.p1.active?.attackBlock).toEqual({ turn: 5, effects: true });
    } else {
      // A tails leaves the stale turn-3 stamp exactly where it was — harmless,
      // because it answers nothing, which is the point of not clearing it.
      expect(again.state.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    }
  });
});

describe("the gated PREVENT clause — the guard is SWEPT, not listed", () => {
  /** Every op kind any ATTACK in the fixture pool can produce, discovered from
      the deriver rather than listed — `coinFlipGate` bodies included, since the
      whole family this slice maps hides inside one. */
  /** THE ONE walker, hoisted out of `attackOpKinds` at D148 so a case can feed it
      a program of its own — see "the sweep DESCENDS every gate" below, which is
      what makes the branch arms a GUARD rather than a comment. */
  function walkKinds(ops: readonly EffectOp[], kinds: Set<string>): Set<string> {
    for (const op of ops) {
      kinds.add(op.op);
      // ⚠️ EVERY GATE, NOT JUST THE COIN (D148). This descent was written for
      // `coinFlipGate` because that was the only gate an ATTACK could derive at
      // 0.91.0 — an accident of the candidate sets, exactly the D139 → D140 →
      // D143 shape, and it went unnoticed for six slices. Houndoom ex sv03-134 is
      // the first printed attack whose program is a `conditionGate`, and with
      // this arm missing its `preventAttack` would be invisible to the table
      // below: the sweep would go green while the one op that most needed
      // classifying sat a level down inside a branch.
      if (op.op === "coinFlipGate") walkKinds(op.then, kinds);
      if (op.op === "conditionGate") {
        walkKinds(op.then, kinds);
        if (op.otherwise !== undefined) walkKinds(op.otherwise, kinds);
      }
      if (op.op === "recordGate") {
        walkKinds(op.then, kinds);
        if (op.otherwise !== undefined) walkKinds(op.otherwise, kinds);
      }
    }
    return kinds;
  }

  function attackOpKinds(): Set<string> {
    const kinds = new Set<string>();
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walkKinds(derived, kinds);
        // ⚠️ THE SECOND SOURCE, ADDED AT D150 — and it is D148's finding one level
        // out. `deriveAttackEffect` is not the only reader that hands an attack a
        // PROGRAM: `deriveAttackCoinFlip`'s `programPerHeads` member (D130) carries
        // `ops: EffectOp[]` of its own, run once per heads by attack.ts, and this
        // sweep never looked at it. It is complete by luck today — both printings
        // (Wugtrio sv01-057, Gyarados swsh10.5-022) expand to `discardDeckTop`,
        // which D142's own reading emits bare as well — which is the SAME accident
        // D148 found in the walker: a sweep total over what it traverses and blind
        // to a whole traversal. The day a per-heads program carries an op no other
        // printing emits, the table would have gone green with it unclassified.
        const coin = attack.effect === undefined ? null : deriveAttackCoinFlip(attack.effect);
        if (coin !== null && coin.kind === "programPerHeads") walkKinds(coin.ops, kinds);
      }
      const authored = programFor(card.id)?.attack;
      for (const ops of Object.values(authored ?? {})) walkKinds(ops, kinds);
    }
    return kinds;
  }

  /** The classification the §11 block owes every one of them. `blocked` = a live
      `{ effects: true }` block on the body this op reaches STOPS it — by refusing
      it outright (`ATTACK_EFFECT_PREVENTED`) or by nulling its damage to 0;
      `untouched` = it lands in full, because the block has no business near it.
      TOTAL over the discovered set, which is the point: a slice that teaches the
      deriver a new op fails HERE until it has said which side of the §11 reading
      that op falls on.

      ⚠️ AND SINCE D150 EVERY VERDICT IS DRIVEN (see the probe table at the foot of
      this file). Until then this was documentation sitting inside a test —
      flipping a verdict failed NOTHING, measured at D148, re-measured at D149 and
      measured a third time at D150 before it was fixed. A verdict here is now a
      claim about a board, and both directions fail when flipped. */
  const CLASSIFIED: Record<string, "blocked" | "untouched"> = {
    // — reaches one of the opponent's Pokémon —
    applyStatus: "blocked", // §12 condition on the defender (the "self" arm is inert)
    preventRetreat: "blocked", // the §11 rider
    damageActive: "blocked", // a PLACED counter — an effect, not damage
    damageChosen: "blocked", // put-counter arm an effect; `deals` arm damage
    moveCountersToDefender: "blocked", // the destination half of a printed MOVE
    spreadDamage: "blocked", // attack damage, on the Bench (nulled by the damage half)
    discardEnergy: "blocked", // the `opponentActive` arm; `yourActive` is the cost
    // — cannot touch the opponent's board at all —
    heal: "untouched",
    healEach: "untouched",
    healChosen: "untouched",
    damageSelf: "untouched",
    // ⚠️ MOVED AT D150, BY BEING DRIVEN — the FOURTH verdict this table has
    // settled and the first settled by a board rather than by an argument. It
    // read "untouched — routes into snipeActive, which IS guarded", which is a
    // claim about who owes the CHECK; this table is about what a live block
    // DOES, and a wide block nulls this op's damage to 0 with `prevented: true`
    // exactly as it nulls the main §8.5 hit. Driven below.
    damageDefender: "blocked",
    discardDeckTop: "untouched", // the opponent's DECK is not a Pokémon
    bottomFromOpponentHand: "untouched", // …nor is their hand
    coinFlipGate: "untouched", // procedure; its body is classified above
    conditionGate: "untouched", // a board-condition branch; its body is classified above
    preventDamage: "untouched", // the installer itself, on its own body
    // D143's self-lock, and the first op to be classified by this table rather
    // than by the slice that wrote it — which is exactly what the table is for.
    //
    // ⚠️ IT MOVED AT D148, AND THAT IS THIS TABLE EARNING ITS PLACE A SECOND TIME.
    // It sat at UNTOUCHED for three slices on a reason that was true of the OPS
    // THE DERIVER COULD EMIT rather than of the op itself: "it writes a stamp onto
    // the CONTROLLER's own Active, so there is no opponent-side body for a §11
    // block to protect from it". D148's `target: "defender"` arm writes the stamp
    // onto the DEFENDER, which is squarely an effect of an attack done to the
    // Defending Pokémon — so the classification flips and the interpreter owes
    // `attackEffectRefused`, exactly as `preventRetreat` two lines up does. This
    // table refused to go green until that was said, which is the whole design.
    // (Still NOT the same claim as "a block cannot stop a lock": a Pokémon that
    // carries both simply carries both, on two different turns.)
    preventAttack: "blocked",
    // D147's durated damage reduction, and the SECOND op classified by this table
    // rather than by the slice that wrote it — the guard doing its job twice.
    // UNTOUCHED for `preventDamage`'s reason verbatim: it writes a stamp onto the
    // CONTROLLER's own Active, so there is no opponent-side body a §11 block
    // could be protecting from it. What it does NOT mean is that the two never
    // meet — a body carrying both takes 0 from a blocked hit and `N` less from a
    // hit the block does not reach, which is a real board and is driven in
    // damageReduction.test.ts.
    reduceDamage: "untouched",
    // D149's attacker-side debuff, and the THIRD op classified by this table
    // rather than by the slice that wrote it. BLOCKED, and it is `reduceDamage`'s
    // verdict INVERTED for the reason its op doc gives: the two are the same
    // `{ turn, amount }` record on opposite bodies, and this one is written onto
    // the DEFENDING Pokémon — squarely an effect of an attack done to it, exactly
    // as `preventRetreat` and D148's `preventAttack { target: "defender" }` are.
    //
    // ⚠️ AND THE VERDICT IS DRIVEN, NOT ONLY DECLARED — because D148 measured that
    // this table forces a verdict without checking one (flipping `blocked` to
    // `untouched` here fails NOTHING by itself, re-measured at D149 and still
    // true). The live-block case is in `attackDebuff.test.ts`, where a wide
    // `{ effects: true }` block on the Defending Pokémon refuses Snarl's install
    // and the row is `ATTACK_EFFECT_PREVENTED` — so the behaviour this line
    // describes is pinned somewhere, which is the most the table can offer until
    // it is hardened.
    weakenDefenderAttacks: "blocked",
    // D152's attack-armed §9 recoil, and the FOURTH op classified by this table
    // rather than by the slice that wrote it. UNTOUCHED for `reduceDamage`'s
    // verdict verbatim — it writes a stamp onto the CONTROLLER's own Active, so
    // there is no opponent-side body a §11 block could be protecting from it. What
    // it does NOT mean is that the two never meet: the armed body's recoil still
    // wants `dealt > 0`, and a block that nulls the hit to 0 stops the retaliation
    // without ever touching this record (driven in installedRecoil.test.ts).
    installRecoil: "untouched",
    // D154's per-attack lock, and the FIFTH op classified by this table rather
    // than by the slice that wrote it. UNTOUCHED for `reduceDamage`'s and
    // `installRecoil`'s verdict verbatim — it writes a record onto the
    // CONTROLLER's own Active, so there is no opponent-side body a §11 block could
    // be protecting from it.
    //
    // ⚠️ AND IT IS THE ONE PLACE IN THIS TABLE WHERE `preventAttack` AND ITS
    // SIBLING DISAGREE, which is worth saying because they read as one mechanism.
    // That op is `blocked` ONLY because D148 gave it a DEFENDER arm; this one has
    // no such arm and cannot acquire one from the pool (the opponent-side twin
    // needs a park to choose the attack, so it would be a third op, not this one's
    // second arm). Two ops that write the same kind of fact land on opposite sides
    // of this table because the table asks about the BODY, not about the rule.
    preventAttackUse: "untouched",
    // D155's per-attack damage BUFF, and the SIXTH op classified by this table
    // rather than by the slice that wrote it. UNTOUCHED for `preventAttackUse`'s
    // verdict verbatim — same holder, same body, same window — and the pairing is
    // the useful part: the two ops write OPPOSITE facts to the same address and
    // land on the SAME side of this table, because the table asks about the BODY
    // and not about whether the fact helps its holder. A §11 block protects a
    // Pokémon from what an attack does TO it; there is nothing to protect here in
    // either direction.
    boostAttack: "untouched",
    // D157's OPPONENT-side per-attack lock, and the SEVENTH op classified by this
    // table rather than by the slice that wrote it. **BLOCKED**, and it is the
    // first op in the per-attack family a wide block stops — the two lines above
    // are `untouched` because they write onto the CONTROLLER's own Active, and
    // this one writes onto the DEFENDING Pokémon, which is squarely an effect of
    // an attack done to it (`preventRetreat`'s, `weakenDefenderAttacks`'s and
    // D148's `preventAttack { target: "defender" }`'s verdict verbatim).
    //
    // ⚠️ SO THE PER-ATTACK FAMILY NOW STRADDLES THIS TABLE EXACTLY AS
    // `preventAttack` AND `preventAttackUse` DO, AND FOR THE SAME REASON: the
    // table asks about the BODY, not about the rule. Three ops write the same
    // `{ turn, attackIndex }`-shaped fact and land on two different sides of it.
    //
    // ⚠️ AND IT IS THE FIRST `blocked` OP THAT WOULD OTHERWISE HAVE **PARKED**,
    // which is what makes the placement of its guard visible rather than
    // stylistic: the refusal is taken IN FRONT OF the candidate scan
    // (`discardEnergy`'s rule), so the probe below returns `parked: false` and a
    // build that checked afterwards would ask the attacker to pick an attack it
    // was never going to bar.
    preventChosenAttack: "blocked",
    // D177's DISCRETE §12 recovery ("This Pokémon recovers from all Special
    // Conditions." — Gardevoir ex sv01-086/-228/-245 "Miracle Force"), and the
    // EIGHTH op classified by this table rather than by the slice that wrote it —
    // the guard doing its job an eighth time, and this time on an op whose slice
    // reached the verdict independently and found the table already asking.
    //
    // UNTOUCHED, and it is the CLEANEST case the table has ever had. Every other
    // `untouched` row above argues from WHERE the fact is written (the
    // controller's own Active, so there is no opponent-side body to protect); this
    // op does not write a fact at all, it REMOVES one, and it removes it from the
    // ATTACKER. A §11 block protects a Pokémon from what an attack does TO it, and
    // the only body this op reaches is the one that declared the attack. Gating it
    // would ask the defender for permission to heal yourself.
    //
    // ⚠️ AND UNLIKE ITS `untouched` NEIGHBOURS, THE TWO GENUINELY CANNOT MEET —
    // which is worth stating because those rows are careful to say that they CAN.
    // `preventDamage` only ever installs on the ATTACKER's own Active and is live
    // during that holder's OPPONENT's turn, so the body carrying a block is never
    // the body running this op. There is no board in this pool, or constructible
    // from it, where the question arises.
    clearStatus: "untouched",
  };

  it("classifies EVERY op an attack in the pool can produce", () => {
    const kinds = [...attackOpKinds()].sort();
    expect(kinds.length).toBeGreaterThan(10);
    for (const kind of kinds) {
      expect(CLASSIFIED[kind], `unclassified attack op: ${kind}`).toBeDefined();
    }
    // …and nothing in the table is dead weight, so it cannot rot into a list of
    // ops the deriver stopped emitting.
    for (const kind of Object.keys(CLASSIFIED)) expect(kinds).toContain(kind);
  });

  it("the sweep DESCENDS every gate, not only the coin", () => {
    // ⚠️ THE DESCENT ABOVE WAS AN ACCIDENT OF THE CANDIDATE SETS FOR SIX SLICES,
    // and this case is what makes it a guard (D139 → D140 → D143 → D146, the
    // shape again). `walk` only followed `coinFlipGate` because that was the only
    // gate an ATTACK could derive at 0.91.0; Houndoom ex sv03-134 "Evil Claw"
    // (D148) is the first printed attack whose whole program is a `conditionGate`.
    //
    // ⚠️ AND IT IS ASSERTED HERE RATHER THAN INSIDE `attackOpKinds`, BECAUSE THE
    // POOL CANNOT SEE IT. Removing the `conditionGate` arm fails nothing off the
    // FIXTURE_POOL sweep: the gate is discovered at top level and the op inside
    // it is also emitted bare by D143's 22 printings, so the classification
    // stays complete by luck. The day a printing puts an op ONLY inside a gate,
    // that blindness becomes a missing classification nobody is told about — so
    // the walker is called DIRECTLY on Houndoom ex's real derived program, where
    // the gate's body is the only place its op appears.
    const gated = deriveAttackEffect(
      "If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.",
    );
    expect(gated?.[0]?.op).toBe("conditionGate");
    expect([...walkKinds(gated ?? [], new Set<string>())].sort()).toEqual([
      "conditionGate",
      "preventAttack",
    ]);
    // …and both arms of a two-armed gate, which no printing has yet: the printed
    // "…instead" (Grusha) is a Trainer, so an ATTACK reaching `otherwise` is a
    // rule with no card — D144's precedent for pinning one anyway.
    expect(
      [
        ...walkKinds(
          [
            {
              op: "conditionGate",
              cond: { kind: "opponentActiveIsBasic" },
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
              then: [{ op: "preventAttack", target: "defender" }],
              otherwise: [{ op: "preventRetreat" }],
            },
          ],
          new Set<string>(),
        ),
      ].sort(),
    ).toEqual(["conditionGate", "preventAttack", "preventRetreat"]);
    // …and the sweep the table actually runs sees the gate off the pool.
    expect(attackOpKinds().has("conditionGate")).toBe(true);
  });

  it("`invokedBy` and D139/D140's `source` agree on every op the deriver emits", () => {
    // The provenance is stated twice in the engine — once on the OP for a log
    // label (D139/D140) and once on the CONTEXT for this rule — so the two are
    // pinned to agree. Everything the ATTACK deriver produces says "attack"; every
    // registry-authored ABILITY program says "ability". If they ever diverge one
    // of them is wrong, and this is where that shows up.
    const walk = (ops: EffectOp[], expected: "ability" | "attack") => {
      for (const op of ops) {
        if (op.op === "coinFlipGate") walk(op.then, expected);
        else if (op.op === "damageActive" || op.op === "damageChosen") {
          expect(op.source).toBe(expected);
        }
      }
    };
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walk(derived, "attack");
      }
      for (const ability of programFor(card.id)?.abilities ?? []) walk(ability.program, "ability");
      for (const trigger of programFor(card.id)?.triggered ?? []) walk(trigger.program, "ability");
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D150 — THE TABLE ABOVE IS A PROOF FROM HERE DOWN.
  //
  // D148 measured that the classification FORCES a verdict and never CHECKS
  // one: flipping `blocked` to `untouched` failed nothing. D149 re-measured it
  // and it was still true; this slice measured it a THIRD time (flipping
  // `weakenDefenderAttacks` — 33 tests, all green) and then fixed it. Every op
  // in the table is now DRIVEN under a live wide block, and both verdicts are
  // load-bearing: flipping either direction fails here.
  //
  // ⚠️ THE VOCABULARY IS BEHAVIOURAL, AND SHARPENING IT MOVED A VERDICT.
  // `blocked` now means "a live `{ effects: true }` block on the body this op
  // reaches STOPS it" — either by refusing it outright (the
  // `ATTACK_EFFECT_PREVENTED` row, seven guarded op sites) or by nulling its
  // damage to 0 with `prevented: true` (the damage half, which needs no per-op
  // guard). `untouched` means "it lands in full anyway". Under that reading
  // `damageDefender` MOVED from untouched to blocked: its old comment
  // ("routes into snipeActive, which IS guarded") was an argument about who
  // owes the CHECK, and this table is about what a block DOES. That is the
  // fourth verdict this table has settled and the first it settled by being
  // driven rather than by being argued.
  //
  // Constructed one-op programs, not printed attacks (D144's precedent): the
  // question is per-OP and a printed attack answers for its whole program, so
  // one board per op with the op fed straight to `runProgram` is both sharper
  // and total — a printing does not exist for every arm, and the arms that
  // have one are already driven above and in the sibling suites.
  // ─────────────────────────────────────────────────────────────────────────

  /** The board every probe runs on: a live WIDE block on P1's Active, P2 to
      move on turn 3 with an Active of their own (the attacker `invokedBy`
      resolves through), and P2's own bodies damaged so the heals have work. */
  function probeBoard(): GameState {
    let state = installed(HEADS_SEEDS[0], "sv03-004");
    expect(state.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    expect(state.turn).toBe(3);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    state = setDamage(state, "p2", 30);
    return state;
  }

  /** …and the same block stamped on a BENCHED body of P1's. NO PRINTING
      REACHES THIS — the install writes the stamp onto the installer's own
      Active and §10 sheds it the moment that body leaves the spot (the Boss's
      Orders case above drives exactly that) — so the two Bench-reaching ops
      are driven from a surgery, and said so rather than skipped. */
  function benchBlockedBoard(): GameState {
    const state = probeBoard();
    const bench = state.players.p1.bench;
    expect(bench.length).toBeGreaterThan(0);
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          bench: bench.map((p, i) =>
            i === 0 ? { ...p, attackBlock: { turn: 3, effects: true } } : p,
          ),
        },
      },
    };
  }

  type Probe = {
    /** The op exactly as some reader emits it (or, where no printing reaches an
        arm, the arm the op's own type admits). */
    op: EffectOp;
    /** The board, when the standard one will not do. */
    board?: () => GameState;
    /** Did the op LAND? Read off the run, not off the absence of a refusal —
        "nothing was prevented" is not evidence that anything happened. */
    landed: (r: {
      before: GameState;
      after: GameState;
      events: GameEvent[];
      parked: boolean;
    }) => boolean;
  };

  const p1Active = (s: GameState) => s.players.p1.active;
  const p2Active = (s: GameState) => s.players.p2.active;

  const PROBES: Record<string, Probe> = {
    // — the seven ops that carry an `attackEffectRefused` check of their own —
    applyStatus: {
      op: { op: "applyStatus", target: "defender", status: "asleep" },
      landed: (r) => p1Active(r.after)?.conditions.rotation === "asleep",
    },
    preventRetreat: {
      op: { op: "preventRetreat" },
      landed: (r) => p1Active(r.after)?.retreatBlocked === true,
    },
    damageActive: {
      op: { op: "damageActive", amount: 30, source: "attack" },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    damageChosen: {
      // `opponentAny` with an EMPTY opponent Bench, so the pick is forced onto
      // the Active and the run completes without a park — the placement arm,
      // which routes into `damageActive` (interpreter) and is therefore the arm
      // the §11 guard sits on.
      op: { op: "damageChosen", target: "opponentAny", amount: 30, count: 1, source: "attack" },
      board: () => {
        const state = probeBoard();
        return {
          ...state,
          players: { ...state.players, p1: { ...state.players.p1, bench: [] } },
        };
      },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    moveCountersToDefender: {
      op: { op: "moveCountersToDefender" },
      board: () => {
        // `setActiveFromDeck` displaces the current Active onto the Bench, which
        // is how this board gets the benched SOURCE the printed "move" needs.
        const state = setActiveFromDeck(probeBoard(), "p2", "fix-attacker");
        const bench = state.players.p2.bench;
        expect(bench.length).toBeGreaterThan(0);
        // Exactly ONE damaged benched body, so the source pick is forced.
        return {
          ...state,
          players: {
            ...state.players,
            p2: {
              ...state.players.p2,
              bench: bench.map((p, i) => (i === 0 ? { ...p, damage: 20 } : { ...p, damage: 0 })),
            },
          },
        };
      },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    discardEnergy: {
      op: { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
      landed: (r) =>
        (p1Active(r.after)?.energy.length ?? 0) < (p1Active(r.before)?.energy.length ?? 0),
    },
    preventAttack: {
      op: { op: "preventAttack", target: "defender" },
      landed: (r) => p1Active(r.after)?.attackLockedTurn != null,
    },
    weakenDefenderAttacks: {
      op: { op: "weakenDefenderAttacks", amount: 20 },
      landed: (r) => p1Active(r.after)?.attackDamageDebuff != null,
    },
    // — the two DAMAGE ops a block stops without any per-op guard: the null is
    //   taken at the damage site, so the evidence is the row, not a refusal —
    spreadDamage: {
      op: { op: "spreadDamage", target: "opponentBench", amount: 20 },
      board: benchBlockedBoard,
      landed: (r) =>
        (r.after.players.p1.bench[0]?.damage ?? 0) > (r.before.players.p1.bench[0]?.damage ?? 0),
    },
    damageDefender: {
      // The §9.2 slot count is fed directly — the op multiplies `per` by what an
      // earlier op recorded, and `runProgram` takes that record as an argument.
      op: { op: "damageDefender", per: 30, count: "discarded" },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    // — and the ops a live block has no business near: every one LANDS —
    heal: {
      op: { op: "heal", target: "self", amount: 10 },
      landed: (r) => (p2Active(r.after)?.damage ?? 0) < (p2Active(r.before)?.damage ?? 0),
    },
    healEach: {
      op: { op: "healEach", amount: 10 },
      landed: (r) => (p2Active(r.after)?.damage ?? 0) < (p2Active(r.before)?.damage ?? 0),
    },
    healChosen: {
      // One damaged own body, so the pick is forced and the run completes.
      op: { op: "healChosen", amount: 10 },
      landed: (r) =>
        (p2Active(r.after)?.damage ?? 0) < (p2Active(r.before)?.damage ?? 0) || r.parked,
    },
    damageSelf: {
      op: { op: "damageSelf", amount: 10 },
      landed: (r) => (p2Active(r.after)?.damage ?? 0) > (p2Active(r.before)?.damage ?? 0),
    },
    discardDeckTop: {
      op: { op: "discardDeckTop", whose: "opponent", count: 1 },
      landed: (r) => r.after.players.p1.deck.length < r.before.players.p1.deck.length,
    },
    // D177 — the DISCRETE §12 recovery, and the actor's own body a FIFTH time.
    // Needs a NAMED board for a reason none of the other own-body probes have:
    // this op REMOVES a fact rather than writing one, so a probe on the standard
    // board would find nothing to remove and read "untouched" off an op that
    // resolved silently — the same shape as `preventAttackUse`'s missing-attack
    // trap, arrived at from the opposite direction. P2's own Active is Burned so
    // there is something for the recovery to take off.
    clearStatus: {
      op: { op: "clearStatus" },
      board: () => setConditions(probeBoard(), "p2", { burned: true }),
      landed: (r) =>
        p2Active(r.before)?.conditions.burned === true &&
        p2Active(r.after)?.conditions.burned === false,
    },
    bottomFromOpponentHand: {
      // The opponent's HAND is not a Pokémon, so the block cannot reach it. The
      // op parks on the pick when the hand holds a candidate and is inert when
      // it does not; either way the run is offered rather than refused, and the
      // PARK is the landing (the block would have to stop it in FRONT of the
      // scan, which is exactly what `discardEnergy` two blocks up does).
      op: { op: "bottomFromOpponentHand", filter: { kind: "supporter" } },
      board: () => handFromDeck(probeBoard(), "p1", "sv02-172", 1),
      landed: (r) => r.parked || r.after.players.p1.hand.length < r.before.players.p1.hand.length,
    },
    coinFlipGate: {
      // A procedure: the evidence it ran is that the COIN WAS TAKEN. Its body is
      // classified on its own line, which is what makes this the right witness
      // rather than a weaker one about the branch.
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      op: { op: "coinFlipGate", then: [{ op: "heal", target: "self", amount: 10 }] },
      landed: (r) => types(r.events).includes("ATTACK_EFFECT_COIN_FLIP"),
    },
    conditionGate: {
      // Both arms heal, so the branch taken does not decide the witness — the
      // question here is whether the GATE runs at all under a live block.
      op: {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "heal", target: "self", amount: 10 }],
        otherwise: [{ op: "heal", target: "self", amount: 10 }],
      },
      landed: (r) => (p2Active(r.after)?.damage ?? 0) < (p2Active(r.before)?.damage ?? 0),
    },
    preventDamage: {
      op: { op: "preventDamage", effects: true },
      landed: (r) => p2Active(r.after)?.attackBlock != null,
    },
    reduceDamage: {
      op: { op: "reduceDamage", amount: 20 },
      landed: (r) => p2Active(r.after)?.damageReduction != null,
    },
    // D152 — the actor's own body again, so `landed` is read off P2 (the chair the
    // probe runs from) exactly as `reduceDamage`'s is.
    installRecoil: {
      op: { op: "installRecoil", amount: 100 },
      landed: (r) => p2Active(r.after)?.installedRecoil != null,
    },
    // D154 — the actor's own body a third time. It needs a NAMED board rather than
    // the standard one, and that is a property of the op rather than a convenience:
    // it resolves the printed noun against the HOLDER's printed attacks, so a probe
    // run against whatever body setup happened to deal would install nothing and
    // the case would read "untouched" off an op that never ran. `fix-attacker`'s
    // index-0 "Bite" is the name, dealt onto P2's Active explicitly.
    preventAttackUse: {
      op: { op: "preventAttackUse", attack: "Bite" },
      board: () => setActiveFromDeck(probeBoard(), "p2", "fix-attacker"),
      landed: (r) => (p2Active(r.after)?.lockedAttacks.length ?? 0) > 0,
    },
    // D155 — the actor's own body a fourth time, and it needs a NAMED board for
    // `preventAttackUse`'s reason verbatim: it resolves the printed noun against
    // the HOLDER's printed attacks, so a probe run against whatever body setup
    // happened to deal would install nothing and the case would read "untouched"
    // off an op that never ran. Same card, same "Bite", opposite verb.
    boostAttack: {
      op: { op: "boostAttack", attack: "Bite", amount: 100 },
      board: () => setActiveFromDeck(probeBoard(), "p2", "fix-attacker"),
      landed: (r) => p2Active(r.after)?.boostedAttack != null,
    },
    // D157 — the first probe in this table whose op would PARK on the standard
    // board, and `landed` says so explicitly rather than reading the record alone:
    // a park is not a landing (nothing has been written yet), but it IS evidence
    // the block did not stop the op, which is the distinction the `blocked` case
    // below turns on. P1's shielded Active is Scyther sv03-004, which prints TWO
    // attacks, so the unblocked run genuinely reaches the prompt.
    preventChosenAttack: {
      op: { op: "preventChosenAttack" },
      landed: (r) => r.parked || (p1Active(r.after)?.lockedAttacks.length ?? 0) > 0,
    },
  };

  /** One probe run: the op fed to the interpreter as an ATTACK's program, from
      P2's chair, against P1's shielded Active. */
  function drive(kind: string): {
    before: GameState;
    after: GameState;
    events: GameEvent[];
    parked: boolean;
    refused: boolean;
    nulled: boolean;
  } {
    const probe = PROBES[kind] as Probe;
    const before = (probe.board ?? probeBoard)();
    const events: GameEvent[] = [];
    const result = runProgram(before, [probe.op], { seat: "p2", invokedBy: "attack" }, events, {
      discarded: ["one-card"],
    });
    const damage = findAll(events, "DAMAGE_DEALT");
    return {
      before,
      after: result.state,
      events,
      parked: result.kind === "parked",
      refused: types(events).includes("ATTACK_EFFECT_PREVENTED"),
      nulled: damage.length > 0 && damage.every((row) => row.prevented === true && row.dealt === 0),
    };
  }

  it("has a driven probe for EVERY classified op, and no probe for anything else", () => {
    // The pairing is what stops the hardening from rotting: a slice that teaches
    // the deriver a new op must now write a BOARD as well as a verdict, and a
    // probe left behind by an op the deriver stopped emitting fails here too.
    for (const kind of Object.keys(CLASSIFIED)) {
      expect(PROBES[kind], `classified but never driven: ${kind}`).toBeDefined();
    }
    for (const kind of Object.keys(PROBES)) {
      expect(CLASSIFIED[kind], `driven but never classified: ${kind}`).toBeDefined();
    }
  });

  it("drives every `blocked` op under a live wide block — and the block STOPS it", () => {
    const blocked = Object.keys(CLASSIFIED).filter((k) => CLASSIFIED[k] === "blocked");
    expect(blocked.length).toBeGreaterThanOrEqual(9);
    for (const kind of blocked) {
      const r = drive(kind);
      // The op did not land…
      expect(PROBES[kind]?.landed(r), `${kind} landed under a live wide block`).toBe(false);
      // …and there is POSITIVE evidence of why: the refusal row, or a damage row
      // nulled to 0 and flagged. One or the other, never neither.
      expect(r.refused || r.nulled, `${kind} was silently inert, not blocked`).toBe(true);
      if (r.refused) {
        // The row names the VICTIM's seat and the shielded body (D136's finding 1).
        expect(find(r.events, "ATTACK_EFFECT_PREVENTED")).toEqual({
          type: "ATTACK_EFFECT_PREVENTED",
          seat: "p1",
          uid: activeUid(r.before, "p1"),
        });
      }
    }
  });

  it("drives every `untouched` op under the SAME live block — and it lands in full", () => {
    // The other half, and the reason a one-sided proof would not have been one:
    // a guard that refused EVERYTHING would pass the case above and fail here.
    const untouched = Object.keys(CLASSIFIED).filter((k) => CLASSIFIED[k] === "untouched");
    expect(untouched.length).toBeGreaterThanOrEqual(9);
    for (const kind of untouched) {
      const r = drive(kind);
      expect(PROBES[kind]?.landed(r), `${kind} did not land under a live wide block`).toBe(true);
      expect(r.refused, `${kind} was refused by a block that has no business near it`).toBe(false);
      expect(r.nulled, `${kind} had its damage nulled`).toBe(false);
    }
  });

  it("the probes are driven against a block that is actually LIVE", () => {
    // The case that stops every assertion above from going vacuous the day the
    // seed table drifts or the stamp arithmetic changes: the same board, with
    // the block SURGICALLY REMOVED, must let a `blocked` op through.
    const bare = (() => {
      const state = probeBoard();
      return {
        ...state,
        players: {
          ...state.players,
          // biome-ignore lint/style/noNonNullAssertion: installed() places the Active.
          p1: { ...state.players.p1, active: { ...state.players.p1.active!, attackBlock: null } },
        },
      };
    })();
    const events: GameEvent[] = [];
    const after = runProgram(
      bare,
      [{ op: "preventRetreat" }],
      { seat: "p2", invokedBy: "attack" },
      events,
    );
    expect(types(events)).toContain("RETREAT_BLOCKED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(after.state.players.p1.active?.retreatBlocked).toBe(true);
  });
});
