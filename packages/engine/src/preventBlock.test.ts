import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
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
//     catalog prints the rule that splits them (Palafin sv03-145: "(Damage is not
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
    expect(deriveAttackEffect(WIDE_TEXT.replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(WIDE_TEXT),
    );
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

  it("refuses the FIVE printings of this family it deliberately does not map", () => {
    // Every one is real text from the local D1, and each is refused by a
    // different property of the whole-sentence anchor — the list a future slice
    // inherits instead of re-censusing (effects.ts carries the same table).
    for (const text of [
      // The attacker-CLASS narrowings — a field and a predicate this op has not
      // got. Fletchling sv01-150 / Bombirdier sv02-153/-246, and Iron Moth
      // sv06.5-009's index-1 "Anachronism Repulsor".
      "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.",
      "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.",
      // Grimmsnarl sv02-148 "Accelerate" — gated on the attack's own RESULT.
      "If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      // Squawkabilly sv01-162 "Fly" — a SECOND consequent on the same flip.
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      // Palafin sv03-145 "Oracle Press" — the THIRD reading, effects WITHOUT
      // damage, and the printing whose parenthetical is this slice's spec.
      "During your opponent's next turn, prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
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
    const wide = against("sv03-004", HEADS_SEEDS[6], "fix-attacker", { id: "fix-energy", count: 1 }, 2);
    expect(types(wide.events)).not.toContain("STATUS_APPLIED");
    expect(find(wide.events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p1" });
    expect(wide.state.players.p1.active?.conditions.rotation).toBe("none");

    const narrow = against("sv03-151", HEADS_SEEDS[6], "fix-attacker", { id: "fix-energy", count: 1 }, 2);
    expect(find(narrow.events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "asleep" });
    expect(types(narrow.events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(narrow.state.players.p1.active?.conditions.rotation).toBe("asleep");
  });

  it("refuses the §11 RETREAT LOCK — two durated blocks meeting, one refusing the other", () => {
    const wide = against("sv03-004", HEADS_SEEDS[7], "sv02-016", { id: "fix-grass-energy", count: 1 });
    expect(types(wide.events)).not.toContain("RETREAT_BLOCKED");
    expect(types(wide.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(wide.state.players.p1.active?.retreatBlocked).toBe(false);
    // The attack's DAMAGE is refused by the other half of the same block.
    expect(find(wide.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });

    const narrow = against("sv03-151", HEADS_SEEDS[7], "sv02-016", { id: "fix-grass-energy", count: 1 });
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
    const wide = against("sv03-004", HEADS_SEEDS[8], "sv02-097", { id: "fix-psychic-energy", count: 2 });
    expect(types(wide.events)).not.toContain("COUNTERS_PLACED");
    expect(types(wide.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(wide.state.players.p1.active?.damage).toBe(0);

    const narrow = against("sv03-151", HEADS_SEEDS[8], "sv02-097", { id: "fix-psychic-energy", count: 2 });
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
    const wide = against("sv03-004", HEADS_SEEDS[9], "sv02-072", { id: "fix-lightning-energy", count: 3 });
    expect(find(wide.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(types(wide.events)).not.toContain("ENERGY_DISCARDED");
    expect(types(wide.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(wide.state.players.p1.active?.energy).toHaveLength(1);
    // The refusal is taken in FRONT of the candidate scan, so the opponent is
    // never parked on a pick that will not happen.
    expect(wide.state.phase.kind).not.toBe("effect:choose");

    const narrow = against("sv03-151", HEADS_SEEDS[9], "sv02-072", { id: "fix-lightning-energy", count: 3 });
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
    let state = must(applyAction(installed(HEADS_SEEDS[4], "sv03-004"), {
      type: "endTurn",
      seat: "p2",
    }));
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
  function attackOpKinds(): Set<string> {
    const kinds = new Set<string>();
    const walk = (ops: EffectOp[]) => {
      for (const op of ops) {
        kinds.add(op.op);
        if (op.op === "coinFlipGate") walk(op.then);
      }
    };
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walk(derived);
      }
      const authored = programFor(card.id)?.attack;
      for (const ops of Object.values(authored ?? {})) walk(ops);
    }
    return kinds;
  }

  /** The classification the §11 block owes every one of them. `blocked` = this op
      can do something TO one of the opponent's Pokémon, so a live block must
      refuse it (or, for damage, null it); `untouched` = it cannot, so the block
      has no business near it. TOTAL over the discovered set, which is the point:
      a slice that teaches the deriver a new op fails HERE until it has said which
      side of the §11 reading that op falls on. */
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
    damageDefender: "untouched", // routes into snipeActive, which IS guarded
    discardDeckTop: "untouched", // the opponent's DECK is not a Pokémon
    bottomFromOpponentHand: "untouched", // …nor is their hand
    coinFlipGate: "untouched", // procedure; its body is classified above
    preventDamage: "untouched", // the installer itself, on its own body
    // D143's self-lock, and the first op to be classified by this table rather
    // than by the slice that wrote it — which is exactly what the table is for.
    // UNTOUCHED: it writes a stamp onto the CONTROLLER's own Active, so there is
    // no opponent-side body for a §11 block to protect from it. (Note this is
    // NOT the same claim as "a block cannot stop a lock": a locked Pokémon that
    // also carries a block simply carries both, on two different turns.)
    preventAttack: "untouched",
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
});
