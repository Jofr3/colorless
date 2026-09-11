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
  benchFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  types,
  walkProgram,
} from "./testFixtures";
import { koByEffectMarker } from "./types";

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
    //
    // 🛑 D496 — SWEPT OVER BOTH SPELLINGS, WHICH IT WAS NOT UNTIL D496. Every
    // probe here used to be spelled against `WIDE_TEXT` alone, so this family's
    // two anchors shared ONE anchor's evidence and the NARROW one's `^` and
    // terminator were pinned by nothing at all. Measured, not argued:
    // `D496-narrow-anchor-loses-its-caret` and
    // `D496-narrow-anchor-loses-its-terminator` each SURVIVED the WHOLE suite —
    // 481 files / 10,969 tests green — while their WIDE twins died here on the
    // first probe. A PAIR of anchors needs a PAIR of probes (D463).
    //
    // ⚠️ AND NO CENSUS COULD EVER HAVE CAUGHT IT. Measured over all 640 rows of
    // `legalAttackCorpus()`, dropping the `^` or the terminator from either
    // anchor claims exactly the SAME rows it claimed before (1/15 wide, 1/4
    // narrow), so `BUILT.attack`, the residue and `resolvedByAnyReader` are
    // byte-identical under both mutants. A constructed near-miss is the only
    // instrument that separates the two builds.
    //
    // Written as a sweep rather than as six lines so a third printed spelling of
    // this family arrives INSIDE the guard instead of needing a seventh.
    for (const text of [WIDE_TEXT, NARROW_TEXT]) {
      expect(deriveAttackEffect(`Then, ${text}`), `leading text — ${text}`).toBeNull();
      expect(deriveAttackEffect(text.slice(0, -1)), `truncated — ${text}`).toBeNull();
      expect(deriveAttackEffect(text.toLowerCase()), `lowercased — ${text}`).toBeNull();
    }
    // ⚠️ THE TERMINATOR IS PINNED BY THE TRUNCATION AND NEVER BY A TRAILING
    // COMPOUND (D464/D495). Once a sentence derives, `splitAttackTrailingClause`
    // composes `⟨it⟩. ⟨claimed tail⟩` for free — measured at this head, it splits
    // `⟨WIDE⟩. Draw a card.` and `⟨NARROW⟩. Draw a card.` into head+tail pairs —
    // so a trailing near-miss asserted `toBeNull` here would be RED on its first
    // run, and the `$` end of these anchors cannot be demonstrated the way the
    // `^` end can.
    //
    // The UNGATED body alone is not this sentence — the coin is printed, and a
    // reader that matched the tail would flip nothing and install unconditionally.
    // One body per spelling: the two differ, so a single line would leave the
    // other's tail unprobed for exactly the reason the sweep above exists.
    for (const body of [
      "During your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      "During your opponent's next turn, prevent all damage done to this Pokémon by attacks.",
    ]) {
      expect(deriveAttackEffect(body), `ungated body — ${body}`).toBeNull();
    }
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
    ).toEqual([{ op: "preventDamage", fromClass: { stage: "basic" } }]);
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
    // 🆕 D276 — THE RECURSION IS GONE, EXTRACTED INTO `walkProgram`. The four arms
    // below were patched in ONE AT A TIME across D148, D150 and D227, each time
    // after a fixture happened to print the shape that exposed the previous
    // omission — five findings that were really one missing abstraction. The
    // shared walker asks about the SHAPE of a property rather than the NAME of an
    // op, so a fifth branching op is swept the day it is authored; the guard that
    // notices the union grew is `programWalk.test.ts`'s carrier pin.
    // ⚠️ THE HISTORY THE FOUR DELETED ARMS CARRIED, RE-HOMED RATHER THAN DROPPED.
    //   • D148 — the descent existed for `coinFlipGate` ALONE, because that was the
    //     only gate an ATTACK could derive at 0.91.0. Houndoom ex sv03-134 is the
    //     first printed attack whose program is a `conditionGate`; with that arm
    //     missing its `preventAttack` was invisible to the table below and the
    //     sweep went GREEN while the one op that most needed classifying sat a
    //     level down inside a branch. Six slices unnoticed.
    //   • D150 — `recordGate`, the same shape again.
    //   • D227 — `optional` (D186) had been derivable from ATTACK text since D202's
    //     two "You may draw" anchors and this walker never descended into it, nor
    //     did the table carry the op, because NO FIXTURE PRINTED ONE. "A gate the
    //     pool cannot reach is a gate the guard cannot notice it is blind to."
    // Each patch closed the hole the pool had just exposed and left the NEXT one
    // open. `walkProgram` closes them all at once and, more to the point, closes
    // the ones no fixture has printed yet.
    for (const op of walkProgram(ops)) kinds.add(op.op);
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
    // 🆕🆕 D341 — THE THIRD SOURCE, AND IT CLOSES A HOLE THIS SWEEP HAS CARRIED
    // SINCE D275's LOCAL-`cardPool` IDIOM BECAME THE HOUSE STYLE. Everything above
    // reads `FIXTURE_POOL`, so an op the deriver emits for REAL catalog sentences
    // that the shared pool does not carry is INVISIBLE HERE — the table goes green
    // with the op unclassified, and the "nothing in the table is dead weight" half
    // below actively FORBIDS classifying it. That is exactly D318's finding at a
    // new site ("a program assembled where the sweep cannot reach it is invisible
    // to every structural auditor in this repo"), and it bites harder now than it
    // did then: five of the last six slices drove their printings on a local pool
    // precisely to keep `swept.size` and `raw.length` still, and each one made
    // this sweep a little less total than its own doc claims.
    //
    // 🛑 THE REPAIR IS TO SWEEP THE *DERIVER*, NOT THE POOL. The set of ops
    // `deriveAttackEffect` can emit is a property of the READER; `FIXTURE_POOL` is
    // one sample of its input, and a sample is not a domain. Feeding it real
    // printed sentences the pool lacks is a strict WIDENING — no kind can leave
    // the set by adding an input — and it costs nothing on the census, which is
    // the whole reason the local-pool idiom exists.
    //
    // ⚠️ REAL PRINTED BYTES, verbatim off the remote D1 (D183's rule), never
    // paraphrases: a sentence that no card prints would classify an op no card can
    // reach, which is the mirror defect.
    for (const effect of OFF_POOL_ATTACK_TEXT) {
      const derived = deriveAttackEffect(effect);
      expect(derived, `off-pool sentence stopped deriving: ${effect}`).not.toBeNull();
      if (derived !== null) walkKinds(derived, kinds);
    }
    return kinds;
  }

  /** 🆕 D341 — REAL Standard-legal attack sentences whose printings are driven on
      a LOCAL `cardPool` and therefore never enter `FIXTURE_POOL`. See the third
      source above for why the sweep needs them.

      Iron Valiant `sv05-080` "Calculation" — the own-deck reorder. Its three
      opponent-deck siblings (`sv10-088`, `sv10.5w-042`/`-125`) emit the SAME op
      kind, so one sentence is what this set owes: it is keyed on the op the
      deriver can emit, not on the printings that emit it.

      🆕🆕 **D414 — THE SECOND SENTENCE, AND IT IS HERE BY DESIGN RATHER THAN BY
      OVERSIGHT.** `knockOutDefender`'s demonstrator (`fix-kod`) lives in a
      FILE-LOCAL `cardPool` inside `knockOutDefender.test.ts` — D275's idiom, taken
      deliberately: putting the sentence into `FIXTURE_POOL` would have reddened
      this 2,273-line suite over a slice whose business was §8.1, not §11. The
      third source above is exactly the repair for that trade, so the op enters the
      sweep through the DERIVER instead of through the pool and the table is total
      again without a shared-pool edit. The op's two other printed sentences
      ("Both Active Pokémon are Knocked Out." and the coin-gated self-damage form)
      emit the SAME op kind, so one sentence is all this set owes — the rule the
      `reorderTop` entry above states. */
  const OFF_POOL_ATTACK_TEXT: readonly string[] = [
    "Look at the top 4 cards of your deck and put them back in any order.",
    "If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out.",
    // 🆕🆕 D434 — THE THIRD SENTENCE, and it is here for D414's reason verbatim:
    // `scheduleCounters`' demonstrator (`fix-doom`) lives in a FILE-LOCAL `cardPool`
    // inside `delayedCounters.test.ts`, so the op would have been invisible to the
    // pool-keyed sources above and this table would have gone green with it
    // unclassified. Real printed bytes off `censusAttackCorpus.ts` row 54.
    "At the end of your opponent's next turn, put 9 damage counters on the Defending Pokémon.",
  ];

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
    // 🆕🆕🆕 D450 — the FOLD, and it is `blocked` for `damageActive`'s reason with
    // one extra edge: it reaches every body it names, so the block refuses THAT
    // BODY and the rest of the fold still lands. The probe below empties p1's Bench
    // so the shielded Active is the whole of the walk and "did not land" is exact;
    // the per-body half is driven on a three-body board in `counterFold.test.ts` §7.
    counterEachAll: "blocked",
    // 🆕🆕🆕 D451 — the HP-TARGET placement, `blocked` for the same reason and asked
    // at the same seam: §11 is consulted PER BODY and AFTER the amount, so a shielded
    // body files one row and takes nothing while its Bench-mates still fill. The probe
    // below aims at the ACTIVE (one body, so "did not land" is exact); the per-body
    // half over a Bench is driven in `counterUntilHp.test.ts` §8.
    counterUntilRemainingHp: "blocked",
    damageChosen: "blocked", // put-counter arm an effect; `deals` arm damage
    moveCountersToDefender: "blocked", // the destination half of a printed MOVE
    // ⚠️ D216 — THE FIRST VERDICT IN THIS TABLE THAT IS TRUE OF A DESTINATION THE
    // PLAYER CHOOSES, WHICH MAKES "blocked" A CLAIM ABOUT A REACHABLE BOARD
    // RATHER THAN ABOUT EVERY BOARD. The op's destination is "1 of your
    // opponent's Pokémon"; when that is the shielded ACTIVE the block refuses the
    // WHOLE printed move (both rows or neither — the probe below drives exactly
    // that board, with the opponent's Bench emptied so the pick is forced onto
    // it), and when the player picks a BENCHED body the block is not in the path
    // at all and the move lands. That second half is driven in
    // counterMoveChosen.test.ts rather than here, because this table's contract
    // is ONE board per op — and it is named here so the verdict is not read as
    // "this op is refused on every board", which is the misreading this whole
    // table exists to prevent.
    moveCountersChosen: "blocked",
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
    // D227 — the FOURTH gate, arriving in this table five slices after the op
    // landed (D186) and three after the deriver learned to emit it (D202), because
    // no fixture printed a "You may" until now. UNTOUCHED for the two gates' exact
    // reason: it is a QUESTION, not something done to a Pokémon, and its body is
    // classified on its own line. ⚠️ A block that could suppress the ASKING would
    // be a rule no printing states — the §11 clause is about what an attack does
    // to the shielded body, and the answer's consequences are already governed by
    // whatever `then` holds.
    optional: "untouched",
    // D227 — and the THIRD gate arrives in the same slice for the same reason: the
    // §9.2 gate has existed since D172 and no attack in the pool derived one until
    // Iron Bundle `sv06-062` "Interjet". Same verdict, same argument as the other
    // three — a branch over what an earlier op FILED is bookkeeping, and the ops on
    // either side of it are classified on their own lines.
    recordGate: "untouched",
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
    // 🆕🆕 **D432 — THE TWENTY-FIFTH OP, and the durated NO-WEAKNESS bar.**
    // UNTOUCHED for `reduceDamage`'s verdict verbatim — it writes a stamp onto the
    // CONTROLLER's own Active, so there is no opponent-side body a §11 block could
    // be protecting from it, and `installNoWeakness` (interpreter.ts) calls
    // `effectRefused` nowhere, exactly as `reduceDamage` and `installRecoil` do not.
    //
    // ⚠️ AND THE PAIRING WITH `weakenDefenderAttacks` FOUR ROWS DOWN IS THE USEFUL
    // PART, because the two read as one mechanism and land on OPPOSITE sides of this
    // table: both shorten what an attack does at §8.5, and the table asks about the
    // BODY rather than about the step. That one is written onto the DEFENDING
    // Pokémon and is squarely an effect of an attack done to it; this one is written
    // onto the actor's own.
    //
    // ⚠️ WHAT THIS ROW DOES **NOT** COVER, said for `switchActive`'s reason: the op
    // installs at ONE address and is READ at TWO (attack.ts's main hit and
    // `snipeActive`), and a build that widened one read site and not the other keeps
    // this verdict and this probe green — the probe reads the RECORD, not a damage
    // number. `noWeaknessBar.test.ts` drives both read sites on their own boards.
    installNoWeakness: "untouched",
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
    // 🆕🆕 D434 — the DELAYED counter placement. BLOCKED, for the line above's reason
    // verbatim and with the live-block case DRIVEN rather than merely classified
    // (`delayedCounters.test.ts` §9, under Mist Energy `sv05-161`'s effects-only
    // shield): it is an effect of an attack done TO the Defending Pokémon in the
    // plainest sense, since it puts damage counters on that body. ⚠️ AND THE GATE IS
    // ASKED AT THE INSTALL RATHER THAN AT THE FIRING, which is a decision and is
    // pinned as one — a block that arrives after the schedule lands does not save the
    // body, because the printed refusal is about the effect being DONE and the doing
    // is the install. A second gate at the Checkup would be a second opinion that can
    // disagree with the first (`koRecoilOf`'s rule, one seam over).
    scheduleCounters: "blocked",
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
    // D181's three, and they arrive in two different ways — which is the whole
    // reason this table is TOTAL rather than curated. None of the three is a new
    // op; each is an op the Trainer path has run since M4 and that the deriver
    // learned to read off ATTACK text, so the verdict is owed even though nothing
    // in the interpreter moved.
    //
    // UNTOUCHED, and for `discardDeckTop`'s reason one level closer to home: a
    // DECK is not a Pokémon, and these two do not even reach the opponent's — they
    // are the ACTOR's own deck and the ACTOR's own hand. A §11 block protects a
    // body from what an attack does TO it; there is no body in either op.
    drawCards: "untouched",
    drawUntilHandSize: "untouched",
    // 🆕🆕 **D404 — THE TWENTY-SECOND OP, AND IT ARRIVED THE WAY D181's THREE DID
    // RATHER THAN THE WAY D313's DID.** `discardHand` is not new code: it has run on
    // the Trainer path since Professor's Research and D385 reached it from ATTACK
    // text inside `optionalCostOps`. What made it visible HERE is that D404's arm is
    // the first TOP-LEVEL attack producer of it — and `fix-handdraw` is in the shared
    // pool, which is the population half of the rule `returnSelf`'s row above states.
    // **THE TABLE CAUGHT IT BY GOING RED, WHICH IS WHAT IT IS FOR**: this row was
    // written because the sweep named the op, not because the slice remembered.
    //
    // UNTOUCHED, and it is `drawCards`' argument with the direction reversed: the two
    // zones are the ACTOR's own HAND and the ACTOR's own DISCARD PILE, and neither is
    // a Pokémon. A §11 block protects a body from what an attack does TO it; there is
    // no body in this op at all, and no opponent-side zone either. A block that
    // stopped it would let the Defending Pokémon veto what its opponent does with
    // their own hand.
    discardHand: "untouched",
    // ⚠️⚠️ D237 — backlog row 13's op, arriving in this table because the sweep
    // above is TOTAL over what the deriver can emit and an attack now emits it.
    // UNTOUCHED, and for `drawCards`' reason with one more zone on the list: the
    // three zones this op touches are the ACTOR's own discard pile, their own
    // hand and their own BENCH. A §11 block protects a body from what an attack
    // does TO it, and there is no opponent-side body anywhere in the op — not
    // even on the `dest: "bench"` arm, where the body that arrives is the
    // ACTOR's and arrives from their own pile.
    discardPileRetrieval: "untouched",
    // ⚠️ AND THE GUST IS THE INTERESTING ONE, BECAUSE IT PLAINLY TOUCHES THE
    // SHIELDED BODY AND IS STILL `untouched`. It drags the block's holder off the
    // Active Spot. The reading is the §11 clause's own scope: the block prevents
    // damage from and effects of attacks done TO THIS POKÉMON, and the printed
    // subject of this sentence is "1 of your opponent's BENCHED Pokémon" — the
    // body that comes UP. The Active's displacement is the consequence of the
    // Bench pick, not the effect aimed at it.
    //
    // ⚠️ AND THIS VERDICT IS NOT NEW WITH THIS SLICE, WHICH IS WHY IT IS NOT A
    // JUDGEMENT CALL. This very file already DRIVES it on the Trainer path: "ends
    // when the Pokémon leaves the Active Spot — a Boss's Orders inside the window"
    // plays `sv02-172` against a live block, the gust lands, and the protection
    // ends BECAUSE the holder left the spot (§10 sheds the stamp). A `blocked`
    // verdict here would contradict a case that has been green since D142 and
    // would make that early-clear unreachable — the clause's only reachable clear.
    // The attack printing is the same op from the same chair; only the seam moved.
    gust: "untouched",
    // D189's self-switch, and it is the NINTH op classified by this table rather
    // than by the slice that wrote it — arriving, like D181's three, as an op the
    // Trainer path has run since M4 that the deriver learned to read off ATTACK
    // text. Nothing in the interpreter moved; the verdict is owed anyway.
    //
    // UNTOUCHED, and it is the second-cleanest case in the table after
    // `clearStatus` — for that row's reason rather than for `gust`'s. `gust`'s
    // entry has to argue about SCOPE (it does reach the shielded body, and lands
    // anyway, because the printed subject is the Bench Pokémon coming up). This op
    // does not reach the opponent's board AT ALL: both bodies it moves belong to
    // the ATTACKER. A §11 block protects a Pokémon from what an attack does TO it,
    // and there is no opponent-side body in this op to protect.
    //
    // ⚠️ AND IT IS THE MIRROR OF `gust` AT THE INTERPRETER — one `otherSeat`
    // apart — WHICH LANDS ON THE SAME SIDE OF THIS TABLE FOR THE OPPOSITE REASON.
    // That pairing is the useful part: a build that crossed the two seats would
    // keep this table green (both verdicts are `untouched`), so the table is
    // explicitly NOT the guard against that mutant — `derivedDrawAndGust.test.ts`
    // drives which side of the board moved, and this row says so rather than
    // letting a reader think it is covered here.
    switchActive: "untouched",
    // D227's opponent-chosen switch-out, and it is the TENTH op classified by this
    // table rather than by the slice that wrote it. UNTOUCHED, and the argument is
    // `gust`'s verbatim because the BOARD MOVE is `gust`'s verbatim: one
    // `switchInto` on the opponent's seat, whose printed subject is the BENCHED
    // body coming up rather than the shielded Active going down. A §11 block
    // protects a Pokémon from what an attack does TO it, and being switched out is
    // not done to the Active — it is the consequence of another body being
    // promoted, which is why `gust` has never carried an `attackEffectRefused`
    // check either.
    //
    // ⚠️ AND THE VERDICT IS THE SAME AS `gust`'s FOR THE SAME REASON, WHICH MEANS
    // THIS TABLE IS EXPLICITLY NOT THE GUARD AGAINST THE SLICE'S REAL MUTANT.
    // `opponentSwitchOut` and `gust` differ by ONE FIELD — the park's `decider` —
    // and a build that dropped it would keep both verdicts and both probes green.
    // `derivedOpponentSwitchOut.test.ts` drives WHO the park belongs to; this row
    // says so rather than letting a reader think the seat is covered here, the
    // same disclaimer `switchActive`'s row carries one line up.
    opponentSwitchOut: "untouched",
    // D228's flat §8.5 hit on the promoted body, and it is the ELEVENTH op this
    // table classifies. **BLOCKED**, and unlike every verdict above it this one is
    // not an argument at all: the op's whole body is a `snipeActive` call, which
    // is the same function `damageDefender` routes into eight lines up, so the
    // verdict is inherited from a row D150 already settled BY DRIVING IT rather
    // than by claiming who owes the check.
    //
    // ⚠️ AND THE PAIRING IS THE USEFUL PART, BECAUSE THE COMPOSED BOARD IS THE ONE
    // THING A READER COULD GET WRONG ABOUT THIS SLICE. The two ops of the printed
    // sentence land on OPPOSITE sides of this table — the promotion is `untouched`
    // (being switched out is not done TO the shielded Active) and the hit is
    // `blocked` (damage squarely is) — and yet on a board where the promotion
    // SUCCEEDS the block protects nothing: the body it shields has left the Active
    // Spot by the time the damage op asks who is Active, and the hit lands on the
    // unshielded body that came up. The block only ever bites here when the
    // promotion WHIFFED (an empty opponent Bench, ungated family), which leaves
    // the shielded Active in place to take the zero. That board is driven in
    // `derivedNewActiveDamage.test.ts`; this row is the op alone, which is this
    // table's contract.
    damageNewActive: "blocked",
    // D229's attacker-own-Energy move, and it is the TWELFTH op this table
    // classifies — arriving, like D181's three and D189's, as an op the TRAINER
    // path has run since M4 that the deriver has only now learned to read off
    // ATTACK text. Nothing in the interpreter's §11 handling moved; the verdict is
    // owed anyway, which is exactly what this table is total for.
    //
    // UNTOUCHED, and it is `switchActive`'s case with the noun changed: both
    // bodies this op reaches belong to the ATTACKER, so there is no opponent-side
    // body a §11 block could be protecting from it. A block that stopped it would
    // let the Defending Pokémon veto how its opponent arranges their own Energy.
    //
    // ⚠️ AND THE ROUTE IS THE PART THIS ROW DOES **NOT** COVER, said here for
    // `switchActive`'s and `opponentSwitchOut`'s reason: `selfToBench` and
    // `benchToActive` differ by which end is which, and a build that crossed them
    // would keep this verdict and this probe green. `derivedSelfEnergyMove.test.ts`
    // drives which body lost the Energy and which gained it.
    moveEnergy: "untouched",
    // D230's deck search onto the actor's own Bench, and the THIRTEENTH and
    // FOURTEENTH ops this table classifies — arriving together, and like D181's
    // three, D189's and D229's as ops the TRAINER path has run since M4 that the
    // deriver has only now learned to read off ATTACK text. Nothing in the
    // interpreter's §11 handling moved; the verdicts are owed anyway.
    //
    // UNTOUCHED, both, and it is `drawCards`'s case with one more zone: the only
    // zones either op reaches are the ACTOR's own deck and the ACTOR's own Bench.
    // A §11 block protects a Pokémon from what an attack does TO it, and there is
    // no opponent-side body in either op to protect — a block that stopped them
    // would let the Defending Pokémon veto how its opponent stocks their own
    // board.
    //
    // ⚠️ AND THE BENCH IS THE INTERESTING HALF, BECAUSE THE SHIELDED BODY SITS
    // BESIDE A BENCH TOO. `gust`'s row above has to argue about SCOPE for a case
    // where the op genuinely touches the block's holder; this one does not arise
    // at all — `searchMove` writes into `state.players[ctx.seat].bench`, and
    // `ctx.seat` is the ATTACKER's. That is the same one-`otherSeat`-apart pairing
    // `switchActive`'s row warns about, so it is said here too: a build that
    // benched the found cards on the OPPONENT's side would keep this verdict and
    // this probe green. `derivedBenchSearch.test.ts` drives which side grew.
    searchDeck: "untouched",
    // …and the trailing shuffle, which reaches no board at all: it permutes the
    // actor's own deck. It is in this table because the printed sentence puts it
    // in the derived program ("Then, shuffle your deck."), which is exactly the
    // TOTALITY this table is for — the op nobody would think to classify is the
    // one that gets missed.
    shuffleDeck: "untouched",
    // ⚠️⚠️ D232 — THE TWO OPPONENT-HAND OPS, and their verdict is
    // `bottomFromOpponentHand`'s ("…nor is their hand") for the same reason: the
    // §11 clause is about what an attack does to the SHIELDED BODY, and a hand is
    // not a Pokémon. Listed as two rows rather than one because the table is keyed
    // by op and its totality is the whole point — but the argument is one.
    //
    // ⚠️ AND THE `randomFromOpponentHand` ROW CARRIES A SECOND CLAIM THIS TABLE
    // HAS NEVER HAD TO MAKE: the op consumes RNG, so "the block does not stop it"
    // has to mean the DRAW happened too, not merely that the state moved. The
    // probe below reads the taken card AND the advanced `rngState`, because a
    // build that refused the op in front of the pick would leave both untouched
    // and a state-only witness could not tell that from a card that happened to
    // stay put.
    revealOpponentHand: "untouched",
    randomFromOpponentHand: "untouched",
    // 🆕🆕 **D426 — THE TWENTY-FOURTH OP, AND THE THIRD ON THE OPPONENT'S HAND.**
    // *"Your opponent discards 2 cards from their hand."* — the OPPONENT-CHOOSES half
    // of the family whose two random halves sit directly above.
    //
    // **UNTOUCHED**, and the argument is the one those two rows already make, which
    // is why it is stated once and cited rather than re-derived: the §11 clause is
    // about what an attack does to the SHIELDED BODY, and **a hand is not a
    // Pokémon**. A block that stopped this would let the Defending Pokémon veto a
    // move between two zones neither player's Active is in — and the cards never
    // even leave the block-holder's own side of the table under this op; their
    // owner picks them out of their own hand and puts them in their own pile.
    //
    // ⚠️ **AND THIS ROW CARRIES A CLAIM NEITHER SIBLING DOES: the op PARKS, and the
    // park's ANSWERER is the seat holding the block.** So "the block does not stop
    // it" has to mean the PROMPT ARRIVED, and arrived for the right seat — a build
    // that refused the op in front of the park would leave the board byte-identical
    // and a state-only witness could not tell that from a hand that happened to stay
    // put. The probe below reads `r.parked`, which is `attachEnergyFrom`'s and
    // `searchDeck`'s witness reached from a different direction.
    //
    // ⚠️ AND THE PART THIS ROW DOES **NOT** COVER: the verdict says nothing about
    // WHICH hand emptied. A build that read `ctx.seat` instead of
    // `otherSeat(ctx.seat)` would empty the ATTACKER's hand, keep this verdict and
    // keep this probe green — `opponentHandDiscard.test.ts` §5 drives which side
    // shrank, from both chairs.
    opponentDiscardsFromHand: "untouched",
    // ⚠️⚠️ D234 — the discard-pile attach, and the FIFTEENTH op this table
    // classifies. It arrives, like D181's three, D189's, D229's and D230's, as an
    // op the ABILITY path has run since M5 that the deriver has only now learned
    // to read off ATTACK text: nothing in the interpreter's §11 handling moved,
    // and the verdict is owed anyway, which is exactly what this table is total
    // for.
    //
    // UNTOUCHED, and it is `moveEnergy`'s case with one zone changed: both ends
    // this op reaches — the actor's own discard pile and the actor's own in-play
    // Pokémon — belong to the ATTACKER. A §11 block protects a Pokémon from what
    // an attack does TO it, and there is no opponent-side body here to protect. A
    // block that stopped it would let the Defending Pokémon veto how its opponent
    // stocks their own board, which is the same absurdity `searchDeck`'s row
    // names one op over.
    //
    // ⚠️ AND THE PART THIS ROW DOES **NOT** COVER, said here for `switchActive`'s
    // and `moveEnergy`'s reason: this op is one `source` value away from the HAND
    // (backlog row 12) and one rider away from landing on the wrong body, and a
    // build that crossed either would keep this verdict and this probe green.
    // `derivedDiscardAttach.test.ts` drives which zone the Energy came out of and
    // which body it landed on.
    attachEnergyFrom: "untouched",
    // ⚠️⚠️ D235 — THE DECK SEARCH THAT ATTACHES (backlog row 10). The SECOND op in
    // two slices that the ABILITY path has run since M5 and the deriver has only
    // now learned to read off ATTACK text — Charizard ex "Infernal Reign" and
    // Janine's Secret Art have produced it since D50. Nothing in the interpreter's
    // §11 handling moved; the verdict is owed anyway, which is exactly what this
    // table is total for, and its absence until now is the FOURTH time this page
    // has caught an op that was reachable but unclassified.
    //
    // UNTOUCHED, and it is `attachEnergyFrom`'s case with one zone changed once
    // more: both ends this op reaches — the actor's own DECK and the actor's own
    // in-play Pokémon — belong to the ATTACKER. A §11 block protects a Pokémon
    // from what an attack does TO it, and there is no opponent-side body here to
    // protect. A block that stopped it would let the Defending Pokémon veto how
    // its opponent stocks their own board, which is `searchDeck`'s absurdity two
    // rows up wearing a different destination.
    //
    // ⚠️ AND THE PART THIS ROW DOES **NOT** COVER: this op is one rider away from
    // landing on the wrong body and one `filter` away from taking the wrong card,
    // and a build that crossed either would keep this verdict and this probe
    // green. `derivedDeckSearchAttach.test.ts` drives which cards were offered and
    // which bodies could receive them.
    attachFromDeck: "untouched",
    // ⚠️⚠️ D241 — LOOK AT THE TOP N (backlog row 11), and the SEVENTEENTH and
    // EIGHTEENTH ops this table classifies. `lookAtTopN` has run since M5 (Great
    // Ball, Pokégear 3.0) and `attachFromTop` since M5 too (Electric Generator,
    // Hydreigon "Tri Howl"); both arrive here as ops the TRAINER and ABILITY paths
    // have long produced that the deriver has only now learned to read off ATTACK
    // text. Nothing in the interpreter's §11 handling moved; the verdicts are owed
    // anyway, which is exactly what this table is total for — and this is the
    // FIFTH time the page has caught an op that was reachable but unclassified.
    //
    // UNTOUCHED, both, and it is `searchDeck`'s case at a narrower window: every
    // zone either op reaches — the actor's own DECK TOP, their own hand, Bench,
    // discard pile and in-play Pokémon — belongs to the ATTACKER. A §11 block
    // protects a Pokémon from what an attack does TO it, and there is no
    // opponent-side body in either op to protect. A block that stopped them would
    // let the Defending Pokémon veto how its opponent stocks their own board.
    //
    // ⚠️ AND THE PART THESE ROWS DO **NOT** COVER, said for `searchDeck`'s reason:
    // `lookAtTopN` is one `dest` value away from putting a card in play and — with
    // row 11's residue — one `whose` fork away from reading the OPPONENT's deck, at
    // which point this verdict has to be re-argued rather than inherited. A build
    // that crossed either would keep this verdict and this probe green.
    // `derivedLookAtTop.test.ts` drives which zone each destination wrote to.
    lookAtTopN: "untouched",
    // 🆕🆕 D341 — THE ORDERED ANSWER, and the op `lookAtTopN`'s note above named
    // as the thing that would force this verdict to be RE-ARGUED rather than
    // inherited: *"`lookAtTopN` is … one `whose` fork away from reading the
    // OPPONENT's deck, at which point this verdict has to be re-argued."* That
    // fork has arrived as `reorderTop.side`, so the argument is made from scratch
    // and not carried over.
    //
    // UNTOUCHED, and it survives the re-argument for a reason that is NOT the one
    // the neighbours use. Their argument is "every zone belongs to the ATTACKER";
    // this op reaches the DEFENDER's deck on three of its four printings, so that
    // sentence is simply false here. What holds instead is the §11 clause's own
    // SCOPE: the block prevents damage from and effects of attacks done TO THIS
    // POKÉMON, and a deck is not a Pokémon — `discardDeckTop`'s verdict, which has
    // reached the opponent's deck since D131 and is `untouched` for exactly this
    // reason. **THE ZONE'S OWNER WAS NEVER THE TEST; THE ZONE'S KIND WAS**, and
    // the neighbours' shorter argument happened to coincide with it while no op
    // crossed sides. A block that stopped this would let a Defending Pokémon veto
    // how its opponent's DECK is ordered, which no printed §11 sentence says.
    reorderTop: "untouched",
    attachFromTop: "untouched",
    // ⚠️⚠️ D247 — THE UNBOUNDED HAND ATTACH (backlog row 12), and the NINETEENTH
    // op this table classifies. Unlike the six above it, this one is NEW code
    // rather than an ability-path op the deriver has just learned to read — which
    // makes the verdict owed for the ordinary reason rather than the surprising
    // one, and makes this the first row in five slices that the page could not
    // have been caught missing.
    //
    // UNTOUCHED, and it is `attachFromDeck`'s case with one zone changed a THIRD
    // time: both ends this op reaches — the actor's own HAND and the actor's own
    // in-play Pokémon — belong to the ATTACKER. A §11 block protects a Pokémon
    // from what an attack does TO it, and there is no opponent-side body here to
    // protect. A block that stopped it would let the Defending Pokémon veto how
    // its opponent stocks their own board.
    //
    // ⚠️ AND THE PART THIS ROW DOES **NOT** COVER: this op is one `filter` away
    // from taking a Special Energy and — the day a printing spells one — one
    // rider away from landing on the wrong body, and a build that crossed either
    // would keep this verdict and this probe green.
    // `derivedAnyNumberAttach.test.ts` drives which cards were offered and which
    // bodies could receive them.
    attachFromHand: "untouched",
    // 🆕 🛑 **D313 — THE TWENTIETH OP, AND THE WAY IT ARRIVED IS THE FINDING.**
    // `returnSelf` has been reachable from an ATTACK since D312 (Gholdengo
    // `sv08-131` idx 1, "Surf Back") and this table never noticed, because
    // `attackOpKinds()` sweeps **`FIXTURE_POOL`** and D311 and D312 both drove
    // their printings off LOCAL `cardPool`s (D275's idiom) with no demonstrator in
    // the shared pool at all. D313 authors Lillie's Comfey's index 1 — and
    // `fix-invitingflowers` carries the SAME `CardProgram` object, so the op became
    // visible here the moment the demonstrator did. ⚠️ **THE DEMONSTRATOR-SHARING
    // RULE `legalNonAttackPrograms.test.ts` ENFORCES IS WHAT MADE THIS SWEEP TOTAL
    // AGAIN** — the same slice that was corrected for splitting an object got this
    // for free by being made to share it. 🛑 **AND IT IS THE THIRD TIME THIS TABLE
    // HAS BEEN BLIND FOR A REASON ITS OWN COMMENT ALREADY NAMES**: D148/D150/D227
    // were blind to a TRAVERSAL, D276 closed those, and this one was blind to a
    // POPULATION. *A sweep is as total as its walker AND as its pool.*
    //
    // UNTOUCHED, and it is `attachFromDeck`'s verdict with the zones changed once
    // more: every end this op reaches — the actor's own in-play body, and its own
    // deck, hand or discard pile — belongs to the ATTACKER. A §11 block protects a
    // Pokémon from what an attack does TO it, and there is no opponent-side body
    // in this op to protect. A block that stopped it would let the Defending
    // Pokémon veto whether its opponent may take their OWN Pokémon off the board.
    //
    // ⚠️ AND THE PART THIS ROW DOES **NOT** COVER, said for `searchDeck`'s reason:
    // the op reads `ctx.sourceRef`, so it is one ref-source away from reaching the
    // opponent's board, at which point this verdict has to be re-argued rather
    // than inherited — and a build that crossed it would keep this probe green.
    // `assassinsReturn.test.ts` drives which zone each destination wrote to.
    returnSelf: "untouched",
    // 🆕🆕 **D380 — THE TWENTY-FIRST OP, AND THE FIRST WHOSE SUBJECT IS NOT IN A
    // PLAYER'S ZONE AT ALL.** `discardStadium` moves the card out of §7.3's SHARED
    // slot and into its OWNER's pile.
    //
    // UNTOUCHED, and it is `bottomFromOpponentHand`'s verdict with the zone changed:
    // **a Stadium is not a Pokémon**, so there is no body for a §11 block to
    // protect and no damage for it to null. A block that stopped this would let the
    // Defending Pokémon veto a move between two zones neither of them is in.
    //
    // ⚠️ AND THE PART THIS ROW DOES **NOT** COVER: the op reads `stadium.owner` to
    // pick the destination pile, so the day a printing routes it somewhere else
    // this verdict is unchanged but the DESTINATION is not — `stadiumDiscard.test.ts`
    // §3 drives which pile received it, on a board where the two seats disagree.
    discardStadium: "untouched",
    // 🆕🆕 **D414 — THE TWENTY-THIRD OP, AND THE FIRST THAT REACHES THIS TABLE
    // THROUGH `OFF_POOL_ATTACK_TEXT` RATHER THAN THROUGH A POOL.** Its
    // demonstrator sits in a file-local `cardPool` in `knockOutDefender.test.ts`
    // (see that set's D414 note), so `attackOpKinds()`'s FIRST two sources are
    // blind to it exactly as they were blind to `returnSelf` at D313 — and the
    // THIRD source, which D341 added for precisely this, catches it. **THE
    // POPULATION HOLE D313 NAMED IS NOW A PAID DEBT RATHER THAN A RECURRENCE.**
    //
    // **BLOCKED**, and it is `preventRetreat`'s verdict for `preventRetreat`'s
    // reason: the op reaches the OPPONENT's Active and nothing else, which is
    // squarely an effect of an attack done to the Defending Pokémon. The
    // implementation says so itself — `knockOutDefender` (interpreter.ts) calls
    // `effectRefused(state, seat, ctx, events)` on `otherSeat(ctx.seat)` and
    // returns the state UNTOUCHED when it is true, which is the
    // `ATTACK_EFFECT_PREVENTED` half of this table's `blocked` vocabulary.
    //
    // ⚠️ AND IT IS THE SIBLING SPLIT, WHICH IS THE PART A READER COULD GET WRONG:
    // `knockOutSelf` does NOT ask §11 and is not in this table at all (no attack
    // in the sweep's reach emits it bare — the both-sides printing pairs it with
    // this op). That is a SEAT difference, not an inconsistency: `knockOutSelf`
    // kills its own host, which no block on the opponent's body has any claim
    // over. The same split `preventAttack` (blocked, defender arm) and
    // `preventAttackUse` (untouched, own body) already carry two families up.
    //
    // ⚠️ AND THE REFUSAL IS TAKEN BEFORE THE STAMP IS WRITTEN, which is why the
    // probe below can read the MARKER as its witness: a refused Knock Out leaves
    // `markers` empty rather than stale, driven on the printed board in
    // `knockOutDefender.test.ts` §6.
    knockOutDefender: "blocked",
    // 🆕🆕 **D431 — THE TWENTY-FOURTH OP, AND THE FIRST WHOSE SUBJECT IS THE
    // ATTACKER'S OWN PRIZE ROW.** `takePrize` queues §8.1's prize decision from an
    // attack's EFFECT rather than from a Knock Out.
    //
    // **UNTOUCHED**, and it is `knockOutSelf`'s verdict for `knockOutSelf`'s reason,
    // one zone over: §11 prevents *effects of attacks done to THIS Pokémon*, and every
    // end this op reaches — the actor's own prize row and the actor's own hand —
    // belongs to the ATTACKER. There is no opponent-side body in it for a block to
    // protect. A block that stopped this would let the Defending Pokémon veto whether
    // its opponent may reveal one of their OWN face-down cards, which is not a claim
    // §11 gives it. The implementation says so itself: `queueTakePrize`
    // (interpreter.ts) does not call `effectRefused` at all, exactly as `knockOutSelf`
    // does not — where `knockOutDefender` one row up does.
    //
    // ⚠️ AND THE PART THIS ROW DOES **NOT** COVER: the seat is `ctx.seat`, so the day a
    // printing hands the prize to the OPPONENT ("your opponent takes a Prize card") the
    // verdict has to be re-argued rather than inherited — that op reaches across the
    // table and this one does not. `takePrizeAttack.test.ts` §4 drives which seat's row
    // shortened, on a board where the two seats disagree.
    takePrize: "untouched",
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

  it("…and D227's two: the `optional` wrapper and the §9.2 gate", () => {
    // ⚠️ SAME REASON AS THE CASE ABOVE, AND THE SAME BLINDNESS ONE GATE OVER. Both
    // arms are complete BY LUCK off the pool: `opponentSwitchOut` is emitted bare
    // by "Kick Away" as well as inside "Winding Waves"' wrapper, and
    // `switchActive` is emitted bare by "Slip Away" as well as inside "Interjet"'s
    // gate — so deleting either descent fails NOTHING through `attackOpKinds`.
    // The walker is therefore called DIRECTLY, on the two REAL derived programs,
    // where the assertion is about the descent rather than about the pool.
    const wrapped = deriveAttackEffect(
      "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    );
    expect(wrapped?.[0]?.op).toBe("optional");
    expect([...walkKinds(wrapped ?? [], new Set<string>())].sort()).toEqual([
      "opponentSwitchOut",
      "optional",
    ]);
    const compound = deriveAttackEffect(
      "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    );
    expect(compound?.[1]?.op).toBe("recordGate");
    expect([...walkKinds(compound ?? [], new Set<string>())].sort()).toEqual([
      "opponentSwitchOut",
      "recordGate",
      "switchActive",
    ]);
    // …and the pool really does reach both gates, so the table's rows for them are
    // not dead weight either.
    expect(attackOpKinds().has("optional")).toBe(true);
    expect(attackOpKinds().has("recordGate")).toBe(true);
  });

  it("`invokedBy` and D139/D140's `source` agree on every op the deriver emits", () => {
    // The provenance is stated twice in the engine — once on the OP for a log
    // label (D139/D140) and once on the CONTEXT for this rule — so the two are
    // pinned to agree. Everything the ATTACK deriver produces says "attack"; every
    // registry-authored ABILITY program says "ability". If they ever diverge one
    // of them is wrong, and this is where that shows up.
    // 🆕 D276 — THE FIFTH AND NARROWEST HAND-ROLLED WALKER, now the shared one.
    // It descended `coinFlipGate.then` and NOTHING else, so a `damageChosen` under
    // a `conditionGate`, a `recordGate` or an `optional` never had its provenance
    // checked at all — and, being an `else if` chain, a gate op could not reach the
    // assertion arm even when the walk did reach the gate.
    const walk = (ops: EffectOp[], expected: "ability" | "attack") => {
      for (const op of walkProgram(ops)) {
        if (op.op === "damageActive" || op.op === "damageChosen") {
          expect(op.source, `${op.op} under ${expected}`).toBe(expected);
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
    /** 🆕 **D313 — THE `ctx` WAS TOTAL OVER OPS THAT READ ONLY `seat`, AND
        `returnSelf` IS THE FIRST CLASSIFIED OP THAT READS `sourceUid`.** Driven
        with the standard ctx it is a SILENT NO-OP (`sourceRef` returns nothing
        without a source), so the probe would have "landed" by doing nothing at
        all — the exact vacuity `landed` exists to prevent, arriving through the
        harness instead of through the predicate. An op that names its own body
        supplies it here. */
    sourceUid?: (state: GameState) => string | undefined;
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
    counterEachAll: {
      // 🆕🆕🆕 D450 — `side: "opponent"` and an EMPTY opponent Bench, so the walk is
      // exactly the shielded Active and `landed` is a total answer about it. The
      // `anyPokemon` noun is the printed one for corpus line 415 and admits the probe
      // body whatever it is, which keeps this probe about the BLOCK and not the filter.
      op: {
        op: "counterEachAll",
        amount: 30,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
      },
      board: () => {
        const state = probeBoard();
        return {
          ...state,
          players: { ...state.players, p1: { ...state.players.p1, bench: [] } },
        };
      },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    counterUntilRemainingHp: {
      // 🆕🆕🆕 D451 — `opponentActive`, so the walk IS the shielded body and `landed`
      // is a total answer about it with no board surgery at all. `remainingHp: 10` is
      // a printed destination and it is far below this Active's remaining HP, so the
      // UNBLOCKED run places a large positive amount — the probe must not be one where
      // "nothing happened" and "already at the destination" look the same.
      op: { op: "counterUntilRemainingHp", target: "opponentActive", remainingHp: 10, source: "attack" },
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
    moveCountersChosen: {
      // D216's twin of the row above, and its board differs in ONE way that is the
      // whole point: P1's BENCH IS EMPTIED, so "1 of your opponent's Pokémon" has
      // exactly one candidate and the destination pick is FORCED onto the shielded
      // Active. Without that, the op parks on a destination prompt and the probe
      // would report "did not land" for a reason that has nothing to do with §11 —
      // the silent-inertness failure this harness's `refused || nulled` assertion
      // exists to catch.
      op: { op: "moveCountersChosen" },
      board: () => {
        const state = setActiveFromDeck(probeBoard(), "p2", "fix-attacker");
        const bench = state.players.p2.bench;
        expect(bench.length).toBe(1); // the displaced Active — the forced SOURCE
        return clearBench(
          {
            ...state,
            players: {
              ...state.players,
              p2: { ...state.players.p2, bench: bench.map((p) => ({ ...p, damage: 20 })) },
            },
          },
          "p1",
        );
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
    // 🆕🆕 D434 — the DELAYED counter placement. Classified `blocked` for the three
    // rows above it verbatim: it is an effect of an attack done TO the Defending
    // Pokémon, and the evidence is the RECORD rather than the damage, because the
    // damage does not land until the next Checkup.
    scheduleCounters: {
      op: { op: "scheduleCounters", amount: 90 },
      landed: (r) => p1Active(r.after)?.scheduledEffect != null,
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
    // D228 — the row above with the count taken off the printed sentence instead
    // of a slot, so the probe needs no record at all. It is driven on the STANDARD
    // board rather than after a promotion on purpose: this table asks one question
    // per op ("does a live block stop it"), and pairing it with a gust here would
    // be testing the composition rather than the op — the promotion has its own
    // row and `derivedNewActiveDamage.test.ts` owns the sequence.
    damageNewActive: {
      op: { op: "damageNewActive", amount: 30 },
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
    discardStadium: {
      op: { op: "discardStadium" },
      // 🆕🆕 D380 — A SURGERY, AND SAID SO RATHER THAN SKIPPED (`benchBlockedBoard`'s
      // rule). The probe deck holds no Stadium and adding one would reshuffle every
      // board in this file; the op reads `state.stadium` and NOTHING else — it never
      // resolves the card — so a zone written directly is the same input a played
      // Beach Court gives it. The uid is lifted OUT of P1's deck so the board stays
      // consistent: a Stadium in play is in no other zone.
      board: () => {
        const state = probeBoard();
        const [uid, ...rest] = state.players.p1.deck;
        if (uid === undefined) throw new Error("p1's deck is empty");
        return {
          ...state,
          players: { ...state.players, p1: { ...state.players.p1, deck: rest } },
          stadium: { uid, owner: "p1" as const },
        };
      },
      landed: (r) => r.before.stadium !== null && r.after.stadium === null,
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
    // D227 — the fourth gate's probe, and its witness is the ASKING, exactly as
    // `coinFlipGate`'s is the coin. This op ALWAYS parks (its own doc: the two
    // answers differ by everything in `then`, so the M1 no-choice shortcut is not
    // available), so the `confirm` prompt arriving under a live block IS the
    // landing. Reading the branch instead would test `heal`, which has its own row.
    optional: {
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      op: { op: "optional", note: "You may draw a card.", then: [{ op: "drawCards", count: 1 }] },
      landed: (r) => r.parked,
    },
    // D227 — the §9.2 gate. `drive` seeds every run's record with
    // `{ discarded: ["one-card"] }`, so a gate on that slot HOLDS and its branch
    // is the witness — which makes this a probe of the gate running, not of an
    // empty-slot skip (that path would land nothing and read as "blocked" for the
    // wrong reason entirely).
    recordGate: {
      op: {
        op: "recordGate",
        slot: "discarded",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "heal", target: "self", amount: 10 }],
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
    // 🆕🆕 D432 — the actor's own body again, so `landed` is read off P2 (the
    // chair the probe runs from) exactly as `reduceDamage`'s is. Field-free op, so
    // the literal is the whole program.
    installNoWeakness: {
      op: { op: "installNoWeakness" },
      landed: (r) => p2Active(r.after)?.noWeaknessTurn != null,
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
    // D181 — the actor's own hand, twice, and the shielded body's Bench once.
    drawCards: {
      op: { op: "drawCards", count: 1 },
      landed: (r) => r.after.players.p2.hand.length > r.before.players.p2.hand.length,
    },
    // 🆕🆕 D404. `landed` reads the DISCARD PILE rather than the hand, and that is not
    // interchangeable here: an op that emptied the hand and dropped the cards on the
    // floor would satisfy "the hand is smaller", and this table's whole business is
    // telling a landed effect from a swallowed one. The probe board's hand is asserted
    // non-empty first, because the op is SILENT on an empty one — a probe that read
    // "untouched" off nothing to discard would be the vacuous guard this file exists
    // to refuse (D205).
    discardHand: {
      op: { op: "discardHand" },
      landed: (r) =>
        r.after.players.p2.hand.length === 0 &&
        r.after.players.p2.discard.length ===
          r.before.players.p2.discard.length + r.before.players.p2.hand.length &&
        r.before.players.p2.hand.length > 0,
    },
    // A NAMED board, for `clearStatus`'s reason from the other direction: this op
    // draws `size − hand.length`, so a probe on a hand that is already at or above
    // `size` draws NOTHING and would read "untouched" off an op that resolved
    // silently. P2's hand is trimmed to one card so there is something to draw.
    drawUntilHandSize: {
      op: { op: "drawUntilHandSize", size: 5 },
      board: () => {
        const state = probeBoard();
        const p2 = state.players.p2;
        expect(p2.hand.length).toBeGreaterThan(1);
        return {
          ...state,
          players: {
            ...state.players,
            p2: { ...p2, hand: p2.hand.slice(0, 1), deck: [...p2.hand.slice(1), ...p2.deck] },
          },
        };
      },
      landed: (r) => r.after.players.p2.hand.length === 5,
    },
    // ⚠️ THE PROBE THAT MOVES THE SHIELDED BODY ITSELF. P1's Bench is trimmed to
    // ONE so `parkOrForce` takes its forced branch and the run completes without a
    // prompt — the same arrangement `damageChosen`'s probe uses, and the reason
    // `landed` can read a board rather than a park. What lands is the SWAP: the
    // benched body is Active and the block's holder is on the Bench.
    gust: {
      op: { op: "gust" },
      board: () => {
        const state = probeBoard();
        expect(state.players.p1.bench.length).toBeGreaterThan(0);
        return {
          ...state,
          players: {
            ...state.players,
            p1: { ...state.players.p1, bench: state.players.p1.bench.slice(0, 1) },
          },
        };
      },
      landed: (r) => r.after.players.p1.active?.stack[0] !== r.before.players.p1.active?.stack[0],
    },
    // D189 — `gust`'s probe with the seat flipped, which is the whole content of
    // the op. The board is trimmed to ONE bench body on the ACTOR's side (P2), so
    // `parkOrForce` forces rather than parks and the probe reads a finished board
    // — the same arrangement the gust probe above uses on the other side.
    switchActive: {
      op: { op: "switchActive" },
      board: () => {
        // The ACTOR's own Bench, which the standard board does not have — every
        // other probe on this page reaches ACROSS the table, so P2's side has
        // never needed one. Exactly one body, so `parkOrForce` forces.
        const state = benchFromDeck(probeBoard(), "p2", "fix-titan");
        expect(state.players.p2.bench).toHaveLength(1);
        return state;
      },
      // The ACTOR's Active changed — and the assertion is deliberately about P2's
      // spot, not P1's: a build that ran `gust` here would move P1's and this
      // would read `false`.
      landed: (r) => r.after.players.p2.active?.stack[0] !== r.before.players.p2.active?.stack[0],
    },
    // D227 — `gust`'s probe with the ANSWERER moved and nothing else, on the same
    // one-body board so `parkOrForce` forces rather than parking (a park would make
    // `landed` read a board where nothing has happened YET, which is not the
    // question this table asks). P1's shielded Active is the body switched OUT, so
    // this is the §11 verdict on a real reachable board rather than on a surgery.
    opponentSwitchOut: {
      op: { op: "opponentSwitchOut" },
      board: () => {
        const state = probeBoard();
        expect(state.players.p1.bench.length).toBeGreaterThan(0);
        return {
          ...state,
          players: {
            ...state.players,
            p1: { ...state.players.p1, bench: state.players.p1.bench.slice(0, 1) },
          },
        };
      },
      landed: (r) => r.after.players.p1.active?.stack[0] !== r.before.players.p1.active?.stack[0],
    },
    // D229 — the attacker's own Energy onto its own Bench, and it needs BOTH
    // endpoints on the ACTOR's side, which the standard board has neither of: an
    // Energy on P2's Active and a body on P2's Bench. Every other probe on this
    // page reaches ACROSS the table, so P2's own side has only ever been built out
    // for `switchActive`.
    //
    // THE WITNESS IS THE PARK, `optional`'s reason verbatim: this op ALWAYS parks
    // when its endpoints exist (there is no forced branch — which Energy to take
    // and where to put it are two live decisions even at one of each), so the
    // prompt arriving under a live block IS the landing. Reading the moved board
    // instead would be testing `resolveEffect`, which the sibling suite owns.
    moveEnergy: {
      op: { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "selfToBench" },
      board: () => {
        const state = benchFromDeck(
          attachFromDeck(probeBoard(), "p2", "fix-energy", 1),
          "p2",
          "fix-titan",
        );
        expect(state.players.p2.active?.energy.length).toBeGreaterThan(0);
        expect(state.players.p2.bench).toHaveLength(1);
        return state;
      },
      landed: (r) => r.parked,
    },
    // D230 — the deck search onto the ACTOR's own Bench. THE WITNESS IS THE PARK,
    // `optional`'s and `moveEnergy`'s reason verbatim: the op is "up to" (`min: 0`,
    // so taking none is a legal answer), which means it parks whenever it has a
    // candidate and bench space rather than ever auto-resolving. The prompt
    // arriving under a live block IS the landing; reading the moved board instead
    // would be testing `searchMove`, which the sibling suite owns.
    //
    // The standard board is enough — `PREVENT_BLOCK_DECK` is thick with Basics and
    // P2's Bench is not full — but BOTH preconditions are asserted rather than
    // assumed, because either one failing turns the park into a silent no-op and
    // this probe would read "blocked" for a reason that has nothing to do with §11.
    searchDeck: {
      op: { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1 },
      board: () => {
        const state = probeBoard();
        expect(state.players.p2.bench.length).toBeLessThan(5);
        const basics = state.players.p2.deck.filter(
          (uid) => FIXTURE_POOL[state.cardIdByUid[uid] ?? ""]?.stage === "Basic",
        );
        expect(basics.length).toBeGreaterThan(0);
        return state;
      },
      landed: (r) => r.parked,
    },
    // D230 — and the trailing shuffle, whose witness is the SHUFFLE row. It moves
    // no card between zones, so there is no board difference to read: a probe that
    // compared deck LENGTH would pass on an op deleted entirely.
    shuffleDeck: {
      op: { op: "shuffleDeck" },
      landed: (r) => types(r.events).includes("SHUFFLE"),
    },
    // ⚠️⚠️ D232 — the bare reveal. Its witness is the EVENT and it could not be
    // anything else: the op moves no card, so every zone on both boards is
    // byte-identical before and after, and a probe that compared state would pass
    // on an op deleted entirely (`coinFlipGate`'s row, arrived at from a different
    // direction). The probe board's P1 holds a real hand — `installed` deals one —
    // so a zero-uid reveal is not what is being read here.
    revealOpponentHand: {
      op: { op: "revealOpponentHand" },
      board: () => {
        const state = probeBoard();
        // The op reads P2's OPPONENT, i.e. P1 — whose hand must be non-empty, or
        // "the reveal happened" and "there was nothing to reveal" look alike.
        expect(state.players.p1.hand.length).toBeGreaterThan(0);
        return state;
      },
      landed: (r) => (find(r.events, "HAND_REVEALED")?.uids.length ?? 0) > 0,
    },
    // ⚠️⚠️ D232 — the random take, and the ONE probe in this table whose witness
    // is TWO facts. A card left the opponent's hand AND the RNG advanced: a build
    // that refused the op in front of the pick would leave both untouched, and a
    // card-only witness could not tell a refusal from a pick that happened to be
    // undone. `discard` is the route chosen because its destination is public.
    randomFromOpponentHand: {
      op: { op: "randomFromOpponentHand", to: "discard" },
      board: () => {
        const state = probeBoard();
        expect(state.players.p1.hand.length).toBeGreaterThan(0);
        return state;
      },
      landed: (r) =>
        r.after.players.p1.hand.length < r.before.players.p1.hand.length &&
        r.after.rngState !== r.before.rngState,
    },
    // 🆕🆕 **D426 — the opponent-CHOOSES discard, and THE WITNESS IS THE PARK** —
    // `attachEnergyFrom`'s, `searchDeck`'s and `discardPileRetrieval`'s reason,
    // reached here by the one route that makes it mandatory rather than
    // convenient: this op moves NOTHING until the prompt is answered, so on a
    // parking board every zone is byte-identical before and after and a
    // state-comparing probe would pass on an op deleted entirely
    // (`revealOpponentHand`'s row, one family up).
    //
    // ⚠️ **THE PRECONDITION IS THE COUNT AND IT IS ASSERTED RATHER THAN ASSUMED**
    // (D416): the op FORCES at a hand of `count` or fewer and PARKS only above it,
    // so a board whose P1 held one or two cards would read "blocked" for a reason
    // that has nothing to do with §11 — and the forced ending is a real state
    // change, so it would not even fail in the honest direction. `count: 1` against
    // the standard board's dealt hand leaves the margin as wide as this page's board
    // allows.
    opponentDiscardsFromHand: {
      op: { op: "opponentDiscardsFromHand", count: 1 },
      board: () => {
        const state = probeBoard();
        // Strictly greater than the printed count, or this parks nothing.
        expect(state.players.p1.hand.length).toBeGreaterThan(1);
        return state;
      },
      landed: (r) => r.parked,
    },
    // ⚠️⚠️ D234 — the discard-pile attach. THE WITNESS IS THE PARK, `optional`'s,
    // `moveEnergy`'s and `searchDeck`'s reason verbatim: with more than one
    // eligible body the op always parks on WHICH one, so the prompt arriving
    // under a live block IS the landing. Reading the moved board instead would be
    // testing `attachEnergyFrom` itself, which `attachEnergyFrom.test.ts` and
    // `derivedDiscardAttach.test.ts` own between them.
    //
    // The op is spelled with NO riders — the un-narrowed form the anchor emits
    // for "…to 1 of your Pokémon" — because a rider would make the park depend on
    // this board's types rather than on the block, which is what is under test.
    // BOTH preconditions are asserted rather than assumed: without a matching
    // Basic Energy in P2's own discard pile the op is a silent no-op, and with
    // fewer than two eligible bodies it FORCES instead of parking — either one
    // would read "blocked" for a reason that has nothing to do with §11.
    attachEnergyFrom: {
      op: { op: "attachEnergyFrom", source: "discard" },
      board: () => {
        // P2's own side has to be built out on BOTH ends — the standard board
        // gives them neither a stocked discard pile nor a Bench, which is the
        // same gap `moveEnergy`'s probe pays one op over (every other probe on
        // this page reaches ACROSS the table).
        const state = benchFromDeck(
          discardFromDeck(probeBoard(), "p2", "fix-energy", 1),
          "p2",
          "fix-titan",
        );
        expect(state.players.p2.discard).toHaveLength(1);
        expect(state.players.p2.active).not.toBeNull();
        expect(state.players.p2.bench).toHaveLength(1);
        return state;
      },
      landed: (r) => r.parked,
    },
    // ⚠️⚠️ D235 — the deck search that attaches. THE WITNESS IS THE PARK again,
    // and here it is not even a choice of convenience: this op's prompt is the
    // COMPOUND `attachCards` one (which cards, and where each goes), which it
    // raises whenever the deck holds a match and any body is eligible. So the
    // prompt arriving under a live block IS the landing, and reading the moved
    // board instead would be testing `attachFromDeck` itself — which
    // `attachFromDeck.test.ts` and `derivedDeckSearchAttach.test.ts` own between
    // them.
    //
    // The op is spelled with NO riders — the un-narrowed form the anchor emits
    // for "…to your Pokémon in any way you like" — because a rider would make the
    // park depend on this board's types rather than on the block, which is what
    // is under test. UNLIKE its discard-pile sibling one row up, the source zone
    // needs NO preparation: the probe's decks are dealt from `deckOf` and the
    // Basic Energy is already sitting in them, which is the whole practical
    // difference between the two families. Both preconditions are asserted rather
    // than assumed anyway.
    // ⚠️⚠️ D237 — the discard-pile retrieval. THE WITNESS IS THE PARK for the
    // fourth family running: this op raises the `chooseCards` prompt whenever its
    // own discard pile holds a match, so the prompt arriving under a live block IS
    // the landing, and reading the moved board would be testing
    // `discardPileRetrieval` itself (`discardRetrieval.test.ts` and
    // `derivedDiscardRetrieval.test.ts` own that between them).
    //
    // `dest: "hand"` rather than the new `"bench"` arm, deliberately: the BENCH
    // arm's park depends on P2's bench SPACE, so a probe on it would go green or
    // red on how many bodies the standard board seats rather than on the block —
    // which is the same reason the attach probes above spell their ops with no
    // riders. The verdict is about the op, and both destinations reach the same
    // three own-side zones.
    //
    // The precondition is asserted rather than assumed: with an empty discard
    // pile the op is a silent no-op, which would read "blocked" for a reason
    // that has nothing to do with §11.
    discardPileRetrieval: {
      op: { op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "hand", max: 1 },
      board: () => {
        const state = discardFromDeck(probeBoard(), "p2", "fix-energy", 1);
        expect(state.players.p2.discard).toHaveLength(1);
        return state;
      },
      landed: (r) => r.parked,
    },
    attachFromDeck: {
      op: { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 1 },
      board: () => {
        const state = probeBoard();
        expect(
          state.players.p2.deck.filter((uid) => state.cardIdByUid[uid]?.includes("energy")).length,
        ).toBeGreaterThan(0);
        expect(state.players.p2.active).not.toBeNull();
        return state;
      },
      landed: (r) => r.parked,
    },
    // ⚠️ D241 — the two deck-top ops. Both PARK on a board that has anything to
    // offer, so `landed` is the park exactly as `attachFromDeck`'s is: a block
    // that refused them would return to `turn:action` with an
    // ATTACK_EFFECT_PREVENTED row instead, which is the positive evidence the
    // `blocked` half of this suite demands and the `untouched` half forbids.
    lookAtTopN: {
      op: { op: "lookAtTopN", n: 7, filter: { kind: "anyCard" }, max: 1 },
      board: () => {
        const state = probeBoard();
        // The window has to hold something, or the op no-ops for a reason that
        // has nothing to do with the block — the vacuous-probe shape.
        expect(state.players.p2.deck.length).toBeGreaterThan(0);
        return state;
      },
      landed: (r) => r.parked,
    },
    // 🆕 D341 — the ordered reorder. Driven on the ACTOR's OWN deck (the bare op),
    // which is the arm whose verdict is least obviously `untouched`: the
    // opponent-deck arm reaches a zone the block plainly does not guard, so the
    // own-deck one is the honest probe of "this block has no business here".
    reorderTop: {
      op: { op: "reorderTop", n: 5 },
      board: () => {
        const state = probeBoard();
        // Two or more, or the op resolves inline for a reason that has nothing to
        // do with the block — the vacuous-probe shape, and here it is arithmetic:
        // one card admits exactly one ordering, so a 1-card deck never parks.
        expect(state.players.p2.deck.length).toBeGreaterThan(1);
        return state;
      },
      landed: (r) => r.parked,
    },
    attachFromTop: {
      op: { op: "attachFromTop", n: 10, filter: { kind: "anyEnergy" }, max: "any" },
      board: () => {
        const state = probeBoard();
        expect(
          state.players.p2.deck
            .slice(0, 10)
            .filter((uid) => state.cardIdByUid[uid]?.includes("energy")).length,
        ).toBeGreaterThan(0);
        expect(state.players.p2.active).not.toBeNull();
        return state;
      },
      landed: (r) => r.parked,
    },
    // ⚠️ D247 — the HAND-source attach. Parks exactly as its two deck-side
    // siblings do, so `landed` is the park; the precondition is asserted rather
    // than assumed, because a hand holding no Basic Energy makes this op a silent
    // no-op that would read "blocked" for a reason nothing to do with §11.
    attachFromHand: {
      op: { op: "attachFromHand", filter: { kind: "basicEnergy" } },
      board: () => {
        const state = handFromDeck(probeBoard(), "p2", "fix-energy", 2);
        expect(
          state.players.p2.hand.filter((uid) => state.cardIdByUid[uid] === "fix-energy").length,
        ).toBeGreaterThanOrEqual(2);
        expect(state.players.p2.active).not.toBeNull();
        return state;
      },
      landed: (r) => r.parked,
    },
    // 🆕 D313 — the twentieth op, and the first that names its OWN body. The
    // §11 block is on P1's Active; this op only ever reaches P2's, so
    // "untouched" is the verdict and an emptied Active Spot on the ATTACKER's
    // side is what landing looks like.
    returnSelf: {
      op: { op: "returnSelf", dest: "deck" },
      sourceUid: (state) => {
        const active = state.players.p2.active;
        expect(active).not.toBeNull();
        return active === null ? undefined : active.stack[active.stack.length - 1];
      },
      landed: (r) => r.before.players.p2.active !== null && r.after.players.p2.active === null,
    },
    // 🆕🆕 D414 — the §8.1 doom, driven on the STANDARD board: the op reaches
    // `otherSeat(ctx.seat)`'s Active, which from P2's chair is the shielded body
    // itself, so no surgery is needed to put the block in the path.
    //
    // ⚠️ THE WITNESS IS THE MARKER **AND** THE DAMAGE, because either alone would
    // be satisfied by half a landing: the op marks the body lethal against
    // `effectiveMaxHp` and stamps `koByEffect:<turn>` so `flow.ts` can tell this
    // Knock Out from one done BY DAMAGE, and a build that did one without the
    // other has not run the op. The §8.1 sweep itself is NOT in the path here —
    // `runProgram` marks and `resolveMidTurnKnockOuts` collects — so reading the
    // emptied Active Spot would be reading a seam this harness does not cross.
    knockOutDefender: {
      op: { op: "knockOutDefender" },
      board: () => {
        const state = probeBoard();
        // Undoomed to start with, or "did not land" would be true for a reason
        // that has nothing to do with §11 — the vacuous-probe shape.
        expect(p1Active(state)?.damage).toBe(0);
        expect(p1Active(state)?.markers).toEqual([]);
        return state;
      },
      landed: (r) => {
        const after = p1Active(r.after);
        if (after === null || after === undefined) return false;
        return (
          after.markers.includes(koByEffectMarker(r.before.turn)) &&
          after.damage > (p1Active(r.before)?.damage ?? 0)
        );
      },
    },
    takePrize: {
      op: { op: "takePrize" },
      // 🆕🆕 D431 — the witness is the QUEUE, because that is the whole of what this
      // op does: it appends no card and emits no event, it inserts the §8.1 decision
      // stage and lets `advance` resolve it. Read as "P2's own row is now owed a prize",
      // never as "the pending queue got longer" — the seat is the half a block could
      // plausibly be thought to have a claim over, and it is the half this row's
      // classification turns on.
      board: () => {
        const state = probeBoard();
        // Nothing owed to start with, or "did not land" would be true for a reason
        // that has nothing to do with §11 — the vacuous-probe shape `knockOutDefender`
        // above spells out.
        expect(state.pending).toEqual([]);
        expect(state.players.p2.prizes.length).toBeGreaterThan(0);
        return state;
      },
      landed: (r) =>
        r.after.pending.some(
          (stage) => stage.kind === "takePrizes" && stage.seat === "p2" && stage.count === 1,
        ),
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
    const sourceUid = probe.sourceUid?.(before);
    const result = runProgram(
      before,
      [probe.op],
      sourceUid === undefined
        ? { seat: "p2", invokedBy: "attack" }
        : { seat: "p2", invokedBy: "attack", sourceUid },
      events,
      { discarded: ["one-card"] },
    );
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
