import { describe, expect, it } from "vitest";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
  programFor,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { flipCoin } from "./rng";
import {
  COIN_FLIP_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const SURPRISE_ATTACK = "Flip a coin. If tails, this attack does nothing.";

const SECOND_CONSEQUENT_BUILT =
  "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";

/** Litwick sv03-036 "Firebreathing", verbatim. The smallest of the pool's seven
    printed N values, and the sentence whose "+" marker the reader consumes. */
const FIREBREATHING = "Flip a coin. If heads, this attack does 10 more damage.";

const PRINTED_BONUSES = [10, 20, 30, 50, 60, 80, 90] as const;

const NBSP = "\u00a0";

const ONE_FLIP = { kind: "printed", count: 1 } as const;

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Both attackers carry exactly ONE attack, so the index cannot be got wrong —
    named all the same, because a reprint that added a second attack would
    otherwise silently move it. */
const FLIP_INDEX = 0;

/** How far the seed sweeps run. The established number (coverage.test.ts): 24
    seeds is far past the point where a fair coin has failed to show both faces,
    and every case that uses it asserts it SAW both rather than trusting the loop. */
const SEEDS = 24;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: COIN_FLIP_DECK, p2: COIN_FLIP_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Litwick in the seat's Active Spot with Firebreathing's single {R} paid.
    SURGERY: both attackers are Basic and COULD be dealt, but a swept seed cannot
    be relied on to deal any particular one, so every case fields its attacker. */
function litwickActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv03-036"), seat, "fix-fire-energy", 1);
}

/** Tarountula in the seat's Active Spot with Surprise Attack's single {G} paid. */
function tarountulaActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-018"), seat, "fix-grass-energy", 1);
}

/** The 60 HP ×2 FIRE body in the seat's Active Spot — the pre-Weakness fold
    defender. Litwick is Fire, so the multiplier is live; Tarountula is Grass, so
    it is inert and no cancel case ever meets it. 40 < 60, so heads does not KO. */
function weakDefender(state: GameState, seat: Seat): GameState {
  return setActiveFromDeck(state, seat, "fix-weak");
}

/** The seat's Active damage — read straight off the board so the "nothing
    happened" cases are a real comparison and not an event-log inference. */
function activeDamage(state: GameState, seat: Seat): number | undefined {
  return state.players[seat].active?.damage;
}

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Tarountula sv01-018", () => {
    const attack = FIXTURE_POOL["sv01-018"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(SURPRISE_ATTACK);
    expect(attack?.name).toBe("Surprise Attack");
    expect(attack?.damage).toBe(30);
    expect(typeof attack?.damage).toBe("number");
    expect(attack?.cost).toEqual(["Grass"]);
    expect(FIXTURE_POOL["sv01-018"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv01-018"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Litwick sv03-036", () => {
    const attack = FIXTURE_POOL["sv03-036"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(FIREBREATHING);
    expect(attack?.name).toBe("Firebreathing");
    expect(attack?.damage).toBe("10+");
    expect(typeof attack?.damage).toBe("string");
    expect(attack?.cost).toEqual(["Fire"]);
    expect(FIXTURE_POOL["sv03-036"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv03-036"]?.abilities).toBeNull();
  });

  it("keeps the card facts the two faces are measured against", () => {
    expect(FIXTURE_POOL["sv01-018"]?.name).toBe("Tarountula");
    expect(FIXTURE_POOL["sv01-018"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-018"]?.types).toEqual(["Grass"]);
    expect(FIXTURE_POOL["sv01-018"]?.hp).toBe(60);
    expect(FIXTURE_POOL["sv01-018"]?.retreat).toBe(2);
    expect(FIXTURE_POOL["sv01-018"]?.weaknesses).toEqual([{ type: "Fire", value: "×2" }]);
    expect(FIXTURE_POOL["sv01-018"]?.resistances).toBeNull();

    expect(FIXTURE_POOL["sv03-036"]?.name).toBe("Litwick");
    expect(FIXTURE_POOL["sv03-036"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv03-036"]?.types).toEqual(["Fire"]);
    expect(FIXTURE_POOL["sv03-036"]?.hp).toBe(60);
    expect(FIXTURE_POOL["sv03-036"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv03-036"]?.weaknesses).toEqual([{ type: "Water", value: "×2" }]);
    expect(FIXTURE_POOL["sv03-036"]?.resistances).toBeNull();

    expect(FIXTURE_POOL["fix-weak"]?.weaknesses).toEqual([{ type: "Fire", value: "×2" }]);
    expect(FIXTURE_POOL["fix-weak"]?.hp).toBe(60);
    // …and the neutral defender has none at all, so the non-Weakness cases read
    // the printed number unmodified.
    expect(FIXTURE_POOL["fix-bigbody"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-bigbody"]?.resistances).toBeNull();
  });

  it("pins the BYTES — and that both sentences are PURE ASCII", () => {
    expect(SURPRISE_ATTACK.length).toBe(48);
    expect(utf8Bytes(SURPRISE_ATTACK)).toBe(48);
    expect(FIREBREATHING.length).toBe(55);
    expect(utf8Bytes(FIREBREATHING)).toBe(55);
    for (const sentence of [SURPRISE_ATTACK, FIREBREATHING]) {
      // PURE ASCII, asserted over the characters rather than inferred from the
      // equal totals above (which a pair of compensating drifts could fake).
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual([]);
      expect(sentence).not.toContain("é");
      expect(sentence).not.toContain("’"); // U+2019 — the pool holds zero of them
      expect(sentence).not.toContain(NBSP);
      expect(sentence.startsWith("Flip a coin. ")).toBe(true);
      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence).toBe(sentence.trim());
    }
    expect(SURPRISE_ATTACK).toContain("If tails,");
    expect(FIREBREATHING).toContain("If heads,");
  });
});

describe("deriveAttackCoinFlip — two sentences, ZERO new vocabulary", () => {
  it("reads all SEVEN printed N values off the one regex", () => {
    // No table exists, so this is not a coverage check on a Map — it is the claim
    // that the shape is PARAMETERISED and every printed value is inside it. A
    // reader built on literal sentences would need seven rows for this.
    for (const per of PRINTED_BONUSES) {
      const text = `Flip a coin. If heads, this attack does ${per} more damage.`;
      expect(deriveAttackCoinFlip(text)).toEqual({ kind: "bonusOnHeads", flips: ONE_FLIP, per });
    }
    expect(deriveAttackCoinFlip(FIREBREATHING)).toEqual({
      kind: "bonusOnHeads",
      flips: ONE_FLIP,
      per: 10,
    });
  });

  it("reads the cancel sentence as a BARE TAG", () => {
    const flip = deriveAttackCoinFlip(SURPRISE_ATTACK);
    expect(flip).toEqual({ kind: "cancelOnTails" });
    // No parameter to get wrong: the member is one key wide. "does nothing" has
    // no number in it, and the union member has no field for one.
    expect(Object.keys(flip ?? {})).toEqual(["kind"]);
  });

  it("derives off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading
    // the derivation straight off the fixture is what proves the two never drifted
    // apart in the same edit.
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-018"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "cancelOnTails" });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv03-036"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "bonusOnHeads", flips: ONE_FLIP, per: 10 });
  });

  it("buys ZERO NEW VOCABULARY — neither sentence reaches a clause table", () => {
    expect(deriveAttackRequirement(SURPRISE_ATTACK)).toBeNull();
    expect(deriveAttackRequirement(FIREBREATHING)).toBeNull();
    expect(SURPRISE_ATTACK.endsWith("this attack does nothing.")).toBe(true);
    expect(SURPRISE_ATTACK.startsWith("If ")).toBe(false);
    for (const text of [SURPRISE_ATTACK, FIREBREATHING]) {
      const flip = deriveAttackCoinFlip(text);
      if (flip === null) throw new Error("unreachable");
      expect(Object.keys(flip).sort()).toEqual(
        flip.kind === "bonusOnHeads" ? ["flips", "kind", "per"] : ["kind"],
      );
      expect(flip).not.toHaveProperty("cond");
      expect(flip).not.toHaveProperty("count");
      // …and the added key is the PRINTED one, not a board read: no `energy` filter
      // to resolve and no state to ask.
      expect(flip).not.toHaveProperty("flips.energy");
    }
  });

  it("is EXCLUSIVE by construction — no string is both members", () => {
    expect(deriveAttackCoinFlip(SURPRISE_ATTACK)?.kind).toBe("cancelOnTails");
    expect(deriveAttackCoinFlip(FIREBREATHING)?.kind).toBe("bonusOnHeads");
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does nothing.")).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip a coin. If tails, this attack does 10 more damage."),
    ).toBeNull();
  });
});

describe("deriver disjointness — a fourth reader that crosses none of the other three", () => {
  it("keeps BOTH flip sentences off the effect/bonus/multiplier/requirement readers", () => {
    // The leading "Flip a coin." sentence denies all three leading-`If` families
    // their `^` anchor, and the consequent keeps them off `deriveAttackEffect`.
    // Each refuses at its own OUTER anchor, before any clause table is consulted.
    for (const sentence of [SURPRISE_ATTACK, FIREBREATHING]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
    }
  });

  it("keeps a REAL sentence of each of the four families off deriveAttackCoinFlip", () => {
    // The mirror, one live representative per family, so the nulls above are
    // refusals in both directions and not one reader being dead.
    const representatives = [
      // deriveAttackEffect — a plain status op (Tarountula's own family neighbour).
      "Your opponent's Active Pokémon is now Paralyzed.",
      "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
      // deriveAttackDamageMultiplier — the Prize-count "×" shape.
      "This attack does 50 damage for each Prize card your opponent has taken.",
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
    ];
    for (const sentence of representatives) {
      expect(deriveAttackCoinFlip(sentence)).toBeNull();
    }
    // …and each really is live for its own reader, so the nulls are refusals and
    // not four dead strings.
    expect(deriveAttackEffect(representatives[0] ?? "")).not.toBeNull();
    expect(deriveAttackDamageBonus(representatives[1] ?? "")).not.toBeNull();
    expect(deriveAttackDamageMultiplier(representatives[2] ?? "")).not.toBeNull();
    expect(deriveAttackRequirement(representatives[3] ?? "")).not.toBeNull();
  });
});

describe("the rest of the coin family stays LOUD", () => {
  it("refuses a SECOND CONSEQUENT riding the same flip — at the `$` anchor", () => {
    for (const text of [
      // Floette sv01-092 — a heal riding the same heads branch.
      "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.",
      // Conkeldurr V swsh10.5-040 — a status riding the same heads branch.
      "Flip a coin. If heads, this attack does 90 more damage, and your opponent's Active Pokémon is now Confused.",
      // Dragonite ex sv03-159 — a whole extra TAILS branch. The mapped shape's
      // first sentence pair is present verbatim; the third sentence is what the
      // `$` refuses, and it is a self-penalty the engine has no way to carry.
      "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
      expect(text.startsWith("Flip a coin. ")).toBe(true); // reached the anchor
    }
    expect(deriveAttackCoinFlip(SECOND_CONSEQUENT_BUILT)).toEqual({
      kind: "cancelOnTailsElseProgram",
      ops: [{ op: "preventDamage", effects: true }],
    });
    expect(deriveAttackCoinFlip(SECOND_CONSEQUENT_BUILT)).not.toEqual({ kind: "cancelOnTails" });
    // The two prefixes really are the mapped sentences, so the refusals above are
    // the `$` doing the work and not the `^` or the middle of the pattern.
    expect(SECOND_CONSEQUENT_BUILT.startsWith(SURPRISE_ATTACK)).toBe(true);
    expect(
      "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.".startsWith(
        "Flip a coin. If heads, this attack does 140 more damage.",
      ),
    ).toBe(true);
  });

  it("refuses a DIFFERENT NUMBER OF FLIPS — at the literal `^Flip a coin\\.`", () => {
    const magikarp = "Flip 2 coins. If both of them are heads, this attack does 20 more damage.";
    const bisharp =
      "Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 60 more damage. If all of them are heads, this attack does 120 more damage.";
    for (const text of [magikarp, bisharp]) {
      expect(text.startsWith("Flip a coin. ")).toBe(false); // the opening sentence differs
    }
    expect(deriveAttackCoinFlip(magikarp)).toEqual({
      kind: "bonusOnAllHeads",
      flips: { kind: "printed", count: 2 },
      bonus: 20,
    });
    // Bisharp: the POSITIVE reading — pinned by value, not by a null (a null goes green the day the
    // whole family stops resolving; `ladder: [20, 60, 120]` does not).
    expect(deriveAttackCoinFlip(bisharp)).toEqual({
      kind: "bonusLadder",
      flips: { kind: "printed", count: 3 },
      ladder: [20, 60, 120],
    });
    expect(
      deriveAttackCoinFlip("Flip 2 coins. This attack does 90 more damage for each heads."),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "printed", count: 2 }, per: 90 });
    expect(
      "Flip 2 coins. If both of them are heads, this attack does 20 more damage.".endsWith(
        "this attack does 20 more damage.",
      ),
    ).toBe(true);
    expect(FIREBREATHING.endsWith("this attack does 10 more damage.")).toBe(true);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. This attack does 30 more damage for each heads.",
      ),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 30 });
  });

  it("refuses the PARALYSIS flip — the slice's ONLY real double-read risk", () => {
    const paralysisFlip = "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.";
    expect(deriveAttackCoinFlip(paralysisFlip)).toBeNull();
    // ASSERTED EXPLICITLY, not implied: the OTHER reader really does own it, so
    // the null above is a hand-off and not a gap.
    expect(deriveAttackEffect(paralysisFlip)).toEqual([
      {
        op: "coinFlipGate",
        ops: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
    // Its prefix is Tarountula's leading sentence verbatim — so this is the
    // consequent refusing it, not the opening.
    expect(paralysisFlip.startsWith("Flip a coin. If heads, ")).toBe(true);
  });
});

describe("constructed near-misses stay LOUD", () => {
  it("refuses the anchor and casing rewrites", () => {
    for (const text of [
      // Lowercase leading "flip" — the skeleton has no /i.
      "flip a coin. If heads, this attack does 10 more damage.",
      "flip a coin. If tails, this attack does nothing.",
      // Lowercase "if" — the same guard one word later.
      "Flip a coin. if heads, this attack does 10 more damage.",
      // No trailing period is not the whole sentence.
      "Flip a coin. If heads, this attack does 10 more damage",
      "Flip a coin. If tails, this attack does nothing",
      // "!" for "." — the same one-character difference from the other side.
      "Flip a coin. If tails, this attack does nothing!",
      "If heads, this attack does 10 more damage.",
      "If tails, this attack does nothing.",
      // Leading text pins `^`.
      "Before doing damage, flip a coin. If heads, this attack does 10 more damage.",
      // A missing space after the flip sentence — invisible in a diff.
      "Flip a coin.If heads, this attack does 10 more damage.",
      // "coins" for "coin" — one letter, and a different mechanism.
      "Flip a coins. If heads, this attack does 10 more damage.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
  });

  it("refuses a printed ZERO — the `per >= 1` guard every arm carries", () => {
    // Nothing in the pool prints it, and the guard is what keeps that a FACT about
    // the pool rather than an assumption: a 0 bonus would spend a flip (and an
    // rngState step, and an event) to add nothing at all.
    expect(
      deriveAttackCoinFlip("Flip a coin. If heads, this attack does 0 more damage."),
    ).toBeNull();
    // …while the smallest REAL value one digit away is read fine.
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does 1 more damage.")).toEqual({
      kind: "bonusOnHeads",
      flips: ONE_FLIP,
      per: 1,
    });
  });

  it("refuses whitespace and apostrophe drift", () => {
    // A TRAILING SPACE survives `trim()` by design (the deriver trims), so this
    // pair states which drift is tolerated and which is not.
    expect(deriveAttackCoinFlip(`${FIREBREATHING} `)).toEqual({
      kind: "bonusOnHeads",
      flips: ONE_FLIP,
      per: 10,
    });
    expect(deriveAttackCoinFlip(` ${SURPRISE_ATTACK}`)).toEqual({ kind: "cancelOnTails" });
    // An INTERIOR double space is not trimmable and is refused.
    expect(
      deriveAttackCoinFlip("Flip a coin.  If heads, this attack does 10 more damage."),
    ).toBeNull();
    // A NON-BREAKING SPACE where an ASCII one is printed — the invisible drift.
    expect(
      deriveAttackCoinFlip(`Flip a coin.${NBSP}If heads, this attack does 10 more damage.`),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin. If heads, your opponent’s Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
  });
});

describe("ZERO registry rows — the cards flip straight off their printed text", () => {
  it("has no program of any kind for either card", () => {
    for (const id of ["sv01-018", "sv03-036"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
    }
  });
});

describe("Litwick — the heads BONUS through a REAL attack, both faces", () => {
  it("deals 20 on heads and 10 on tails, and flips exactly ONCE either way", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const state = litwickActive(board(seed), "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      // EXACTLY ONE flip per attack — the union's mutual exclusivity, observed.
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(1);
      const flip = flips[0];
      if (flip === undefined) throw new Error("Firebreathing did not flip");
      expect(flip.seat).toBe("p1"); // the ATTACKER flips, not the defender
      const damage = findEvent(events, "DAMAGE_DEALT");
      if (flip.result === "heads") {
        sawHeads = true;
        // base 10 + the printed 10, into a body with no Weakness at all.
        expect(damage?.dealt).toBe(20);
        expect(damage?.base).toBe(10);
        // The bonus is REPORTED through `scaled`, the same field the count-scaling
        // clauses use — one pre-W/R "the attack's own extra" channel, not two.
        expect(damage?.scaled).toBe(10);
        expect(activeDamage(done, "p2")).toBe(20);
      } else {
        sawTails = true;
        // Tails on THIS member adds nothing and cancels nothing — the printed base
        // resolves normally, which is the asymmetry with Tarountula.
        expect(damage?.dealt).toBe(10);
        expect(damage?.base).toBe(10);
        // ABSENT, not 0: the field is only present when the extra actually landed.
        expect(damage?.scaled).toBeUndefined();
        expect(activeDamage(done, "p2")).toBe(10);
        // No cancel on this member, ever.
        expect(types(events)).not.toContain("ATTACK_FAILED");
      }
      // The flip is announced BEFORE the damage it modifies, in printed order.
      expect(types(events).indexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
        types(events).indexOf("DAMAGE_DEALT"),
      );
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("Tarountula — the tails CANCEL through a REAL attack, both faces", () => {
  it("deals 30 on heads; on tails does NOTHING and the turn still ends", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const state = tarountulaActive(board(seed), "p1");
      const uid = activeUid(state, "p1");
      const before = activeDamage(state, "p2");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(1);
      const flip = flips[0];
      if (flip === undefined) throw new Error("Surprise Attack did not flip");
      if (flip.result === "heads") {
        sawHeads = true;
        // Heads on THIS member is the plain printed resolution — no bonus.
        expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
        expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
        expect(activeDamage(done, "p2")).toBe(30);
        expect(types(events)).not.toContain("ATTACK_FAILED");
      } else {
        sawTails = true;
        // NOTHING is exactly what happened, stated as a list of absences.
        expect(findEvent(events, "ATTACK_FAILED")).toEqual({
          type: "ATTACK_FAILED",
          seat: "p1",
          uid,
          reason: "coinFlip",
        });
        expect(types(events)).not.toContain("DAMAGE_DEALT");
        expect(types(events)).not.toContain("COUNTERS_PLACED");
        expect(types(events)).not.toContain("KNOCKED_OUT");
        // …and the defender's damage is byte-identical to before, not merely small.
        expect(activeDamage(done, "p2")).toBe(before);
        expect(activeDamage(done, "p2")).toBe(0);
        // The flip is announced BEFORE the failure it caused.
        expect(types(events).indexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
          types(events).indexOf("ATTACK_FAILED"),
        );
        expect(types(events)).toContain("TURN_ENDED");
        expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("the fold order — the heads bonus lands BEFORE Weakness", () => {
  it("deals (10 + 10) × 2 = 40 into a Fire-weak body, not 10 × 2 + 10 = 30", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const opened = weakDefender(board(seed), "p2");
      const state = litwickActive(opened, "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const damage = findEvent(events, "DAMAGE_DEALT");
      expect(damage?.weakness).toEqual({ op: "multiply", amount: 2 });
      if (findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result === "heads") {
        sawHeads = true;
        expect(damage?.dealt).toBe(40);
        expect(damage?.scaled).toBe(10);
        expect(activeDamage(done, "p2")).toBe(40);
        expect(types(events)).not.toContain("KNOCKED_OUT");
      } else {
        sawTails = true;
        // The SAME body with no bonus: 10 × 2 = 20. The pair is what makes the 40
        // above a fold-order claim rather than a number.
        expect(damage?.dealt).toBe(20);
        expect(damage?.scaled).toBeUndefined();
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("rngState — exactly ONE flip's worth is consumed", () => {
  it("threads the flip back into rngState and consumes nothing more", () => {
    for (const field of [litwickActive, tarountulaActive]) {
      const state = field(board(3), "p1");
      const [face, rng1] = flipCoin(state.rngState);
      const { state: after, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      // The face the engine reported IS the face the seed owed.
      expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe(face);
      // …and the state advanced by exactly one step. Nothing else in a plain
      // attack (the §8.5 pipeline, the §8.1 sweep, the §5.3 turn end and its
      // draw) touches the rng, so this is a total account.
      expect(after.rngState).toBe(rng1);
    }
  });

  it("does not double-flip with §8's CONFUSION check — an unconfused attacker flips once", () => {
    const state = tarountulaActive(board(5), "p1");
    expect(state.players.p1.active?.conditions.rotation).toBe("none");
    const [, rng1] = flipCoin(state.rngState);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FLIP_INDEX,
    });
    expect(types(events)).not.toContain("CONFUSION_CHECK");
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
    expect(after.rngState).toBe(rng1);
  });
});

describe("effectSimulated / modifierSimulated — no loud row on EITHER face", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED for either card, heads or tails", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const litwick = mustApply(litwickActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const tarountula = mustApply(tarountulaActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(types(litwick.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(tarountula.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // Both cards flip off the SAME rngState here (same seed, same board), so one
      // face flag covers both — which is also why the two are stepped through
      // together rather than in separate loops.
      if (findEvent(litwick.events, "ATTACK_EFFECT_COIN_FLIP")?.result === "heads") sawHeads = true;
      else sawTails = true;
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("ATTACK_FAILED — the THREE reasons stay distinguishable", () => {
  it("renders a DISTINCT log row for coinFlip, requirement and confusion", () => {
    const state = tarountulaActive(board(0), "p1");
    const uid = activeUid(state, "p1");
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:07" };
    const text = (event: GameEvent): string =>
      logFromEvents([event], ctx)
        .flatMap((entry) => (entry.kind === "turn" ? [] : entry.segments.map((s) => s.text)))
        .join("");
    const rows = (["confusion", "requirement", "coinFlip"] as const).map((reason) =>
      text({ type: "ATTACK_FAILED", seat: "p1", uid, reason }),
    );
    expect(new Set(rows).size).toBe(3);
    const [confusionRow, requirementRow, coinRow] = rows;
    expect(confusionRow).toContain("Confused");
    expect(requirementRow).toContain("its condition was not met");
    expect(coinRow).toContain("did nothing");
    expect(coinRow).toContain("coin flip");
    expect(coinRow).not.toContain("tails");
    expect(coinRow).not.toContain("Confused");
  });

  it("pairs the flip row with the failure row on a REAL cancelled attack", () => {
    // The two rows a player actually sees, in order, off a real board — so the
    // hand-built events above are not three strings in a test file.
    let rendered: string[] | null = null;
    for (let seed = 0; seed < SEEDS && rendered === null; seed++) {
      const state = tarountulaActive(board(seed), "p1");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: FLIP_INDEX });
      if (findEvent(events, "ATTACK_FAILED") === undefined) continue;
      const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:07" };
      rendered = logFromEvents(
        events.filter((e) => e.type === "ATTACK_EFFECT_COIN_FLIP" || e.type === "ATTACK_FAILED"),
        ctx,
      ).flatMap((entry) =>
        entry.kind === "turn" ? [] : [entry.segments.map((s) => s.text).join("")],
      );
    }
    if (rendered === null) throw new Error("no seed in range produced a tails cancel");
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toContain("tails");
    expect(rendered[1]).toContain("did nothing"); // and this one names the consequence
  });
});

describe("purity", () => {
  it("resolves both printed flips on a DEEP-FROZEN board", () => {
    // The gate reads and the fold write both go through fresh objects — a frozen
    // state proves nothing was mutated in place, on BOTH members and on the
    // Weakness board (which is the one that also rewrites the defender).
    for (let seed = 0; seed < SEEDS; seed++) {
      const litwick = deepFreeze(litwickActive(weakDefender(board(seed), "p2"), "p1"));
      mustApply(litwick, { type: "attack", seat: "p1", index: FLIP_INDEX });
      const tarountula = deepFreeze(tarountulaActive(board(seed), "p1"));
      mustApply(tarountula, { type: "attack", seat: "p1", index: FLIP_INDEX });
    }
    // …and the DERIVER is a pure function of its string, frozen board or not.
    expect(deriveAttackCoinFlip(FIREBREATHING)).toEqual({
      kind: "bonusOnHeads",
      flips: ONE_FLIP,
      per: 10,
    });
    expect(deriveAttackCoinFlip(SURPRISE_ATTACK)).toEqual({ kind: "cancelOnTails" });
  });
});
