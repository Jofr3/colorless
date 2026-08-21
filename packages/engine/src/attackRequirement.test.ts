import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
  programFor,
  splitAttackRequirementClause,
} from "./index";
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  ATTACK_REQUIREMENT_DECK,
  FIXTURE_POOL,
  activeUid,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.75.0 → 0.76.0 — the REQUIREMENT skeleton (D125). "If <clause>, this attack
// does nothing." — Palafin sv03-062/-200 "Justice Kick" ({W}{W}, 210) and
// Lycanroc sv03-117 "Finishing Fang" ({F}, 90).
//
//   A NEW CONSEQUENT IS A NEW SKELETON, NOT A NEW VOCABULARY.
//
// Ten slices built "If <clause>, this attack does N more damage." out of one
// skeleton and one growing table of clauses. This is the family's SECOND
// consequent, and the headline is what it did NOT cost: ZERO new `BoardCondition`
// members. Both rows reuse a fact an earlier slice already bought —
// `yourActivePromotedThisTurn` (D124) and `opponentActiveDamaged` (D115) — which
// is why the "same members, two tables" block below is the most load-bearing
// derivation case in this file. It proves the two consequents SHARE A VOCABULARY
// WITHOUT SHARING A TABLE: `deriveAttackDamageBonus` on Revavroom ex's real
// positive sentence and `deriveAttackRequirement` on Palafin's real negative one
// return the SAME cond, reached through two lookups that never touch.
//
// THE POLARITY LIVES IN THE SKELETON. Every "does nothing" clause in the pool is
// a NEGATIVE sentence, because a card prints "does nothing" precisely to state a
// REQUIREMENT and English states a requirement by naming its failure. So the
// table reads the printed negative and hands back the POSITIVE fact required, and
// attack.ts cancels when that fact is ABSENT — no `{ kind: "not", cond }` member,
// no recursion in the vocabulary, no negated phrasing owed by `conditionNote`.
//
// WHERE THE GATE SITS IS THE OTHER HALF OF THE DESIGN, and it is what this suite's
// board cases exist to pin. A cancel cannot be an `EffectOp`: a program runs at
// attack.ts's tail, strictly AFTER the §8.5 pipeline, and no op can retract damage
// already dealt. The gate therefore sits in FRONT of the pipeline, reusing §8's
// confusion-tails ending (`ATTACK_FAILED` → `finishAttack`) minus the self-damage.
// Two consequences the cases below assert directly:
//
//   (1) LYCANROC'S TRAILING QUALIFIER IS FREE. "…has no damage counters on it
//       BEFORE THIS ATTACK DOES DAMAGE" needs no modelling, because the check runs
//       before the damage exists. An undamaged defender cannot bootstrap the
//       clause with the very hit the clause gates.
//
//   (2) THE TURN STILL ENDS. A cancelled attack is an attack that was USED — the
//       same rule the confusion path already carried, and the reason
//       `finishAttack` is reused rather than an early `return next`.
//
// AND THE REST OF THE FAMILY STAYS LOUD. 19 printings in the pool say "this attack
// does nothing"; exactly 3 (these) are whole sentences of the mapped shape. The
// other 16 are refused, and this suite pins WHICH PROPERTY refuses each one — the
// ANCHOR for the multi-sentence and coin-flip prints, the TABLE for a clause that
// reaches it and misses. Both facts matter independently: a regression that
// loosened the anchor would still be caught by the table, and vice versa.

/** Palafin sv03-062/-200 "Justice Kick", verbatim, and pinned char-for-char
    against FIXTURE_POOL below. Palafin carries no authored program (see the
    ZERO-rows block), so the sentence IS the wiring: a drifted character does not
    throw, it drops the card back onto the loud ATTACK_EFFECT_SKIPPED path and
    silently lets a 210 land that should have been cancelled — the most expensive
    silent failure in the family so far.

    Note the two printed traps: an ASCII U+0027 apostrophe in "didn't", and "from
    the Bench" with NO possessive where D124's positive twin says "from your
    Bench". */
const JUSTICE_KICK =
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.";

/** Lycanroc sv03-117 "Finishing Fang", verbatim — a HAPAX, the pool's only
    printing of this clause under any consequent, and the row whose trailing
    "before this attack does damage" is discharged by WHERE the gate runs. */
const FINISHING_FANG =
  "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.";

/** D124's POSITIVE twin — Revavroom ex sv06.5-015 "Accelerator Flash", verbatim.
    The same board fact as Justice Kick, under the OTHER consequent, and the
    zero-new-vocabulary case reads both derivers against it. */
const ACCELERATOR_FLASH =
  "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage.";

/** D115's POSITIVE twin — Meowscarada ex sv02-015 "Blossom Blade" (80+, +180),
    verbatim. Its clause is the positive-sense reading of Finishing Fang's, and
    both resolve to `opponentActiveDamaged`. The printed "already" is the timing
    word Lycanroc's print spells out longhand as "before this attack does damage";
    neither is modelled, because both are true by WHERE the reader is called. */
const BLOSSOM_BLADE =
  "If your opponent's Active Pokémon already has any damage counters on it, this attack does 180 more damage.";

/** Greedent sv01-152 "Enhanced Fang" (80+, +80), verbatim — a third REAL bonus
    sentence on a member neither requirement row uses, so the null it gets from
    `deriveAttackRequirement` is not an artefact of the shared-member pair above. */
const ENHANCED_FANG =
  "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.";

/** UTF-8 byte length, counted off code points. Deliberately NOT
    `new TextEncoder().encode(s).length`: the engine package compiles with
    `lib: ["ES2022"]` and `types: []` (packages/engine/tsconfig.json), so no
    platform global is in scope and `tsc -b` — which CI runs — would reject it.
    Copied rather than shared with promotedClause.test.ts, where it is local for
    the same reason: testFixtures.ts is a fixture module, not a string library. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Justice Kick is Palafin's SECOND attack — "Jet Punch" (30, with its own
    benched-snipe rider) is index 0, which is why the index has to be named and
    why the fixture carries both. */
const KICK_INDEX = 1;

/** Finishing Fang is Lycanroc's FIRST attack; "Slashing Claw" (100, no `effect`
    key at all) is the second. Spelled separately from KICK_INDEX even though the
    two disagree here, so a reprint reordering one card cannot move the other. */
const FANG_INDEX = 0;

/** Slashing Claw — the index-keyed NEGATIVE, and this suite's only honest way to
    put damage on a defender through a REAL attack. */
const CLAW_INDEX = 1;

const PROMOTED = { kind: "yourActivePromotedThisTurn" } as const;
const DAMAGED = { kind: "opponentActiveDamaged" } as const;

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so the attack step is legal (§4).

    Both Active spots are pinned to a neutral 200 HP fix-bigbody. BOTH attackers
    here are Stage 1 and could never be the dealt starter anyway, so the pin is not
    an optimisation: it is the only way a board starts in a known shape. Pinning
    both sides also keeps every defender's Weakness out of cases that are not about
    Weakness — fix-bigbody has none. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ATTACK_REQUIREMENT_DECK, p2: ATTACK_REQUIREMENT_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** `board`, then two passes — P1's SECOND turn, which is turn 4.

    Needed by the EVOLUTION case for a reason that has nothing to do with this
    clause (§4/§10 ban evolving on your own first turn, and P1 went second here, so
    turn 2 is P1's first) and by the REAL-damage case, which spends turn 2 putting
    the damage there with Slashing Claw. */
function laterBoard(seed: number): GameState {
  const afterP1 = mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
  return mustApply(afterP1, { type: "endTurn", seat: "p2" }).state;
}

/** The 320 HP body in the seat's Active Spot — the only card in the pool that
    survives Justice Kick's 210. fix-bigbody's 200 does not, and a KO would park
    the turn on a PROMOTION, i.e. on the very move Palafin's clause reads. Its ×2
    Lightning Weakness is inert against both attackers here (Water and Fighting).
    The displaced fix-bigbody lands on the Bench, where two cases want it anyway. */
function bigDefender(state: GameState, seat: Seat): GameState {
  return setActiveFromDeck(state, seat, "fix-lightning-weak-big");
}

/** Palafin in the seat's Active Spot with Justice Kick's {W}{W} paid. SURGERY,
    and surgery that CANNOT arm the clause: `setActiveFromDeck` builds the Pokémon
    with `makeInPlay`, which stamps `promotedTurn: null`. So this is the CANCELLED
    board, and every armed board below goes through a real action instead. */
function palafinActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv03-062"), seat, "fix-water-energy", 2);
}

/** Palafin on the END of the seat's Bench with its {W}{W} already attached — the
    pre-state for every ARMED case, since both arming routes need it benched
    first. The new Pokémon's index is the bench length before the call. */
function palafinBenched(state: GameState, seat: Seat): { state: GameState; index: number } {
  const index = state.players[seat].bench.length;
  return {
    state: attachBenchFromDeck(
      benchFromDeck(state, seat, "sv03-062"),
      seat,
      index,
      "fix-water-energy",
      2,
    ),
    index,
  };
}

/** Lycanroc in the seat's Active Spot carrying {F}{C}{C} — enough for Finishing
    Fang's single {F} AND for Slashing Claw's three symbols, so one helper serves
    both indices and no case can pass by having paid for the wrong attack. */
function lycanrocActive(state: GameState, seat: Seat): GameState {
  const placed = setActiveFromDeck(state, seat, "sv03-117");
  return attachFromDeck(
    attachFromDeck(placed, seat, "fix-fighting-energy", 1),
    seat,
    "fix-energy",
    2,
  );
}

/** Arm the promotion the FIRST way it can be armed: a real §11 `retreat`. The
    current Active pays with one plain {C} pulled from the deck (§11 takes any
    Energy, which is why the Colorless line is load-bearing in a deck whose
    attackers cost none), and `promoteBenchIndex` names who comes up. */
function retreatInto(state: GameState, seat: Seat, benchIndex: number): GameState {
  const withEnergy = attachFromDeck(state, seat, "fix-energy", 1);
  const paying = withEnergy.players[seat].active?.energy.at(-1);
  if (paying === undefined) throw new Error(`${seat} has no Energy to pay the retreat with`);
  return mustApply(withEnergy, {
    type: "retreat",
    seat,
    discardEnergy: [paying],
    promoteBenchIndex: benchIndex,
  }).state;
}

/** Play an authored Trainer from the seat's hand by card id, pulling a copy out
    of the deck first. Both Trainers this deck carries resolve WITHOUT parking
    when the target Bench holds exactly one body, which is the shape every caller
    here builds. */
function playTrainer(state: GameState, seat: Seat, cardId: string): GameState {
  const withCard = handFromDeck(state, seat, cardId, 1);
  const played = mustApply(withCard, {
    type: "playTrainer",
    seat,
    uid: handUid(withCard, seat, cardId),
  });
  if (played.state.phase.kind !== "turn:action") {
    throw new Error(`${cardId} parked — this suite's boards are built to force the target`);
  }
  return played.state;
}

/** The card id of a seat's Active — every case locates its Pokémon by ID rather
    than by position, so no assertion can pass against the wrong body. */
function activeCardId(state: GameState, seat: Seat): string | undefined {
  return state.cardIdByUid[activeUid(state, seat)];
}

function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** The seat's Active damage — read by ID-independent path so the "byte-identical
    before and after" pair in the cancel cases is a real comparison. */
function activeDamage(state: GameState, seat: Seat): number | undefined {
  return state.players[seat].active?.damage;
}

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Palafin sv03-062", () => {
    const attack = FIXTURE_POOL["sv03-062"]?.attacks?.[KICK_INDEX];
    expect(attack?.effect).toBe(JUSTICE_KICK);
    expect(attack?.name).toBe("Justice Kick");
    // A FLAT 210, not "210+" — this consequent adds nothing, so there is no
    // printed modifier at all, and `modifierSimulated` is never in play. That is
    // the structural difference from every predecessor slice in the family.
    expect(attack?.damage).toBe(210);
    expect(attack?.cost).toEqual(["Water", "Water"]);
    // TWO attacks, so KICK_INDEX cannot be right by accident — and index 0 is
    // carried verbatim, with its own (already authored) benched-snipe rider.
    expect(FIXTURE_POOL["sv03-062"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv03-062"]?.attacks?.[0]).toEqual({
      cost: ["Water"],
      name: "Jet Punch",
      effect:
        "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      damage: 30,
    });
    expect(FIXTURE_POOL["sv03-062"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Lycanroc sv03-117", () => {
    const attack = FIXTURE_POOL["sv03-117"]?.attacks?.[FANG_INDEX];
    expect(attack?.effect).toBe(FINISHING_FANG);
    expect(attack?.name).toBe("Finishing Fang");
    expect(attack?.damage).toBe(90);
    expect(attack?.cost).toEqual(["Fighting"]);
    expect(FIXTURE_POOL["sv03-117"]?.attacks).toHaveLength(2);
    // "Slashing Claw" has NO `effect` key at all on the D1 row — not an empty
    // string — so the fixture omits the field. An `effect: ""` would be a
    // different (and wrong) fact, and `toEqual` here is what pins the absence.
    expect(FIXTURE_POOL["sv03-117"]?.attacks?.[CLAW_INDEX]).toEqual({
      cost: ["Fighting", "Colorless", "Colorless"],
      name: "Slashing Claw",
      damage: 100,
    });
    expect(FIXTURE_POOL["sv03-117"]?.attacks?.[CLAW_INDEX]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv03-117"]?.abilities).toBeNull();
  });

  it("keeps the card facts the cancel is measured against", () => {
    expect(FIXTURE_POOL["sv03-062"]?.name).toBe("Palafin");
    expect(FIXTURE_POOL["sv03-062"]?.stage).toBe("Stage1");
    // The pre-evolution NAME is what §10 matches, and it is the whole reason the
    // pool carries a Finizen (the evolution-survives-it case).
    expect(FIXTURE_POOL["sv03-062"]?.evolveFrom).toBe("Finizen");
    expect(FIXTURE_POOL["sv03-062"]?.types).toEqual(["Water"]);
    expect(FIXTURE_POOL["sv03-062"]?.hp).toBe(150);
    expect(FIXTURE_POOL["sv03-062"]?.retreat).toBe(2);
    expect(FIXTURE_POOL["sv03-062"]?.weaknesses).toEqual([{ type: "Lightning", value: "×2" }]);
    expect(FIXTURE_POOL["sv03-062"]?.resistances).toBeNull();

    expect(FIXTURE_POOL["sv03-117"]?.name).toBe("Lycanroc");
    expect(FIXTURE_POOL["sv03-117"]?.stage).toBe("Stage1");
    expect(FIXTURE_POOL["sv03-117"]?.evolveFrom).toBe("Rockruff");
    expect(FIXTURE_POOL["sv03-117"]?.types).toEqual(["Fighting"]);
    expect(FIXTURE_POOL["sv03-117"]?.hp).toBe(130);
    expect(FIXTURE_POOL["sv03-117"]?.retreat).toBe(2);
    expect(FIXTURE_POOL["sv03-117"]?.weaknesses).toEqual([{ type: "Grass", value: "×2" }]);
    expect(FIXTURE_POOL["sv03-117"]?.resistances).toBeNull();

    // Asked by NAME, not by key: §10 matches `evolveFrom` against the card's NAME
    // and FIXTURE_POOL is keyed by card ID, so a FIXTURE_POOL["Finizen"] lookup
    // would be vacuously undefined and prove nothing. BOTH pre-evolutions are in
    // the pool; only the Finizen line takes deck slots (Rockruff is pool-only, on
    // D124's Wimpod precedent).
    const namesInPool = Object.values(FIXTURE_POOL).map((card) => card.name);
    expect(namesInPool).toContain("Finizen");
    expect(namesInPool).toContain("Rockruff");
    expect(FIXTURE_POOL["sv03-061"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv03-116"]?.stage).toBe("Basic");
    // The 320 HP body is the reason the deck exists in the shape it does: 210 has
    // to LAND without a Knock Out, or the case measures a promotion instead.
    expect(FIXTURE_POOL["fix-lightning-weak-big"]?.hp).toBeGreaterThan(210);
    expect(FIXTURE_POOL["fix-bigbody"]?.hp).toBeLessThan(210);
  });

  it("pins the BYTES and the two printed traps", () => {
    // The family's invariant is `bytes = codePoints + count("Pokémon")`, and both
    // sentences say it exactly once. 98/99 for Justice Kick, 120/121 for
    // Finishing Fang.
    expect(JUSTICE_KICK.length).toBe(98);
    expect(utf8Bytes(JUSTICE_KICK)).toBe(99);
    expect(FINISHING_FANG.length).toBe(120);
    expect(utf8Bytes(FINISHING_FANG)).toBe(121);
    for (const sentence of [JUSTICE_KICK, FINISHING_FANG]) {
      expect(sentence).toContain("Pokémon");
      // The é is the ONLY non-ASCII character in either sentence — asserted over
      // the characters rather than inferred from the totals.
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual(["é"]);
      // TRAP 1: the apostrophe is ASCII U+0027 in both ("didn't", "opponent's").
      // The whole 978-card pool holds ZERO U+2019, so the table never has to
      // choose between the two — but a hand-retyped key would introduce one.
      expect(sentence).toContain("'");
      expect(sentence).not.toContain("’");
      expect(sentence.endsWith(", this attack does nothing.")).toBe(true);
    }
    expect(JUSTICE_KICK).toContain("didn't");
    // TRAP 2: NO POSSESSIVE. Palafin says "the Bench"; D124's positive twin says
    // "your Bench". Both spellings are real in the catalog, and a matcher that
    // normalised them would let one table's key match the other's sentence.
    expect(JUSTICE_KICK).toContain("from the Bench");
    expect(JUSTICE_KICK).not.toContain("from your Bench");
    expect(ACCELERATOR_FLASH).toContain("from your Bench");
    // Lycanroc's qualifier, pinned as printed — it is part of the TABLE KEY, not
    // decoration, which is why the truncated rewrite below has to be refused.
    expect(FINISHING_FANG).toContain("before this attack does damage");
  });
});

describe("deriveAttackRequirement — the clause resolves to a member that already existed", () => {
  it("maps Justice Kick onto yourActivePromotedThisTurn — a BARE TAG", () => {
    const cond = deriveAttackRequirement(JUSTICE_KICK);
    expect(cond).toEqual(PROMOTED);
    // The POSITIVE fact the attack REQUIRES, read off a NEGATIVE sentence — the
    // polarity inversion happens here, in the table, and nowhere else.
    expect(cond?.kind).toBe("yourActivePromotedThisTurn");
    // No parameter to get wrong: the member is one key wide.
    expect(Object.keys(cond ?? {})).toEqual(["kind"]);
  });

  it("maps Finishing Fang onto opponentActiveDamaged — a BARE TAG", () => {
    const cond = deriveAttackRequirement(FINISHING_FANG);
    expect(cond).toEqual(DAMAGED);
    expect(cond?.kind).toBe("opponentActiveDamaged");
    expect(Object.keys(cond ?? {})).toEqual(["kind"]);
  });

  it("derives off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading
    // the derivation straight off the fixture is what proves the two never
    // drifted apart in the same edit.
    expect(
      deriveAttackRequirement(FIXTURE_POOL["sv03-062"]?.attacks?.[KICK_INDEX]?.effect ?? ""),
    ).toEqual(PROMOTED);
    expect(
      deriveAttackRequirement(FIXTURE_POOL["sv03-117"]?.attacks?.[FANG_INDEX]?.effect ?? ""),
    ).toEqual(DAMAGED);
  });

  it("buys ZERO NEW VOCABULARY — both members are reachable from the BONUS table", () => {
    // THE HEADLINE OF THE SLICE, and the only case that can state it mechanically.
    //
    // Two consequents, two tables, no shared lookup — and yet the SAME two
    // `BoardCondition` values come out of both. D124's Revavroom ex sentence and
    // D125's Palafin sentence are the positive and negative readings of one board
    // fact, and they resolve to one member; D115's Meowscarada ex sentence and
    // D125's Lycanroc sentence likewise.
    //
    // If this ever fails, the slice has quietly grown the union — which is the one
    // cost it was designed not to pay.
    const flash = deriveAttackDamageBonus(ACCELERATOR_FLASH);
    if (flash?.count.kind !== "boardCondition") throw new Error("unreachable");
    expect(flash.count.cond).toEqual(deriveAttackRequirement(JUSTICE_KICK));

    const blossom = deriveAttackDamageBonus(BLOSSOM_BLADE);
    if (blossom?.count.kind !== "boardCondition") throw new Error("unreachable");
    expect(blossom.count.cond).toEqual(deriveAttackRequirement(FINISHING_FANG));

    // …and the two members are DIFFERENT from each other, so the pair above is not
    // passing on a single degenerate value.
    expect(flash.count.cond).not.toEqual(blossom.count.cond);
    // Both are answerable by `conditionHolds` on a real board, which is the whole
    // reason no new arm was owed — asserted here rather than assumed.
    const opened = board(11);
    for (const cond of [flash.count.cond, blossom.count.cond] as BoardCondition[]) {
      expect(typeof conditionHolds(opened, "p1", cond)).toBe("boolean");
    }
  });
});

describe("deriver disjointness — two consequents, two vocabularies, no crossover", () => {
  it("keeps BOTH requirement sentences off the three bonus/effect derivers", () => {
    // The consequent is what separates them: "does nothing" is not "does N more
    // damage", is not "for each", and is not an op. Each of the three refuses at
    // its own OUTER anchor, before any clause table is consulted.
    for (const sentence of [JUSTICE_KICK, FINISHING_FANG]) {
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackEffect(sentence)).toBeNull();
    }
  });

  it("keeps the REAL bonus sentences off deriveAttackRequirement — the mirror", () => {
    // The other direction, and the one that would break if somebody merged the
    // two tables "since the members are the same anyway". A sentence meaning "80
    // more damage if X" must never be reachable from the reader that CANCELS.
    for (const sentence of [ACCELERATOR_FLASH, BLOSSOM_BLADE, ENHANCED_FANG]) {
      expect(deriveAttackRequirement(sentence)).toBeNull();
      // …and each of them really is a live bonus, so the null above is a refusal
      // and not a dead string.
      expect(deriveAttackDamageBonus(sentence)).not.toBeNull();
    }
  });
});

describe("the rest of the 'does nothing' family stays LOUD", () => {
  it("refuses the COIN-FLIP printings — at the ANCHOR (12 prints in the pool)", () => {
    // The pool's largest "does nothing" group by far: 12 printings, of which Zorua
    // sv01-018's "Surprise Attack" is the canonical one. A different MECHANISM
    // (§8's effect coin flip, which the engine already owns elsewhere), and the
    // flip sentence in front denies the text `^If` — so it never reaches the
    // table at all.
    const surpriseAttack = "Flip a coin. If tails, this attack does nothing.";
    expect(deriveAttackRequirement(surpriseAttack)).toBeNull();
    expect(surpriseAttack.startsWith("If ")).toBe(false);
  });

  it("refuses a BARE 'If tails' — at the TABLE, which is the OTHER guard", () => {
    // CONSTRUCTED on purpose, and the reason is that the two guards must be pinned
    // separately. Strip the flip sentence off and what is left IS the mapped shape:
    // it clears the anchor, reaches the table, and misses there because "tails" is
    // not a board fact anything in `BoardCondition` can answer. A regression that
    // loosened the anchor would still be caught here; one that added a stray table
    // row would still be caught above.
    const bareTails = "If tails, this attack does nothing.";
    expect(bareTails.startsWith("If ")).toBe(true);
    expect(bareTails.endsWith(", this attack does nothing.")).toBe(true);
    expect(deriveAttackRequirement(bareTails)).toBeNull();
  });

  it("refuses the ANAPHORIC 'If you can't' printings — at the ANCHOR", () => {
    // Three printings, all multi-sentence, and all refused twice over: the cost
    // sentence in front denies them `^If`, and their "can't" points BACK at that
    // sentence — a referent this reader, which sees one string and no board, could
    // not resolve even if it matched.
    for (const text of [
      // Honchkrow sv02-132 "Dirty Throw" — an untyped hand discard.
      "Discard a card from your hand. If you can't, this attack does nothing.",
      // sv06.5-005 "Power Shot" — the same anaphor over a TYPED, Basic-only cost.
      "Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing.",
      // sv02-009 "Order a Raid" — the anaphor spelled out longhand ("If you can't
      // shuffle a Combee into your deck"), which still starts with a cost sentence.
      "Choose 1 of your Benched Combee and shuffle that Pokémon and all attached cards into your deck. If you can't shuffle a Combee into your deck, this attack does nothing.",
    ]) {
      expect(text.startsWith("If ")).toBe(false);
      expect(text).toContain("this attack does nothing.");
      expect(deriveAttackRequirement(text)).toBeNull();
    }
  });

  it("refuses Malamar sv06.5-034's 'Colluding Tentacles' — at the ANCHOR, twice over", () => {
    // The family's hardest near-miss: its LAST sentence is exactly the mapped
    // shape, clause and all. It is refused because the anchor is WHOLE-STRING —
    // two sentences precede it, so `^If` fails — and it would be refused again at
    // the table, because "you didn't play Xerosic's Machinations from your hand
    // during this turn" names a SPECIFIC CARD and no member tracks that.
    const colludingTentacles =
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 120 damage to the new Active Pokémon. If you didn't play Xerosic's Machinations from your hand during this turn, this attack does nothing.";
    expect(colludingTentacles.startsWith("If ")).toBe(false);
    expect(colludingTentacles.endsWith(", this attack does nothing.")).toBe(true);
    expect(deriveAttackRequirement(colludingTentacles)).toBeNull();
    // Its trailing sentence ALONE clears the anchor and misses at the table — the
    // same two-guard split as the "If tails" pair above, on a real string.
    const tail =
      "If you didn't play Xerosic's Machinations from your hand during this turn, this attack does nothing.";
    expect(tail.startsWith("If ")).toBe(true);
    expect(deriveAttackRequirement(tail)).toBeNull();
    // …and it stays off the other three derivers too, so nothing else claims it.
    expect(deriveAttackDamageBonus(colludingTentacles)).toBeNull();
    expect(deriveAttackDamageMultiplier(colludingTentacles)).toBeNull();
    expect(deriveAttackEffect(colludingTentacles)).toBeNull();
  });
});

describe("constructed near-misses stay LOUD", () => {
  it("refuses CLAUSE rewrites — the Map key is char-for-char", () => {
    // Each of these clears the outer anchor and dies at the table. One difference
    // apiece, named on the line.
    for (const clause of [
      // THE POSSESSIVE ADDED: Palafin prints "the Bench", its D124 twin "your
      // Bench" — the exact spelling that would let one table's key match the
      // other's sentence.
      "this Pokémon didn't move from your Bench to the Active Spot this turn",
      // "did not" EXPANDED — the contraction is printed, and English offers a
      // second spelling of the same words that no card uses.
      "this Pokémon did not move from the Bench to the Active Spot this turn",
      // DE-ACCENTED "Pokemon" — the é is a real U+00E9 in the catalog.
      "this Pokemon didn't move from the Bench to the Active Spot this turn",
      // The POSITIVE verb under this consequent: "moved" is D124's clause, and it
      // must not resolve here, or a positive sentence would CANCEL an attack.
      "this Pokémon moved from the Bench to the Active Spot this turn",
      // Lycanroc's clause TRUNCATED before its trailing qualifier — the shape a
      // reader who thought "before this attack does damage" was decoration would
      // write. It is part of the key.
      "your opponent's Active Pokémon has no damage counters on it",
      // POLARITY FLIPPED on Lycanroc's clause: "has any" is the D115 BONUS
      // reading, and the two tables must not share it.
      "your opponent's Active Pokémon has any damage counters on it before this attack does damage",
      // The SEAT swapped — if the pool ever prints it, it is a different member
      // reading the attacker's own body, not this row.
      "your Active Pokémon has no damage counters on it before this attack does damage",
      // The pronoun already RESOLVED — `conditionNote`'s output shape fed back in.
      "your Active Pokémon didn't move from the Bench to the Active Spot this turn",
    ]) {
      expect(deriveAttackRequirement(`If ${clause}, this attack does nothing.`)).toBeNull();
    }
  });

  it("keeps the OUTER ANCHOR guards on both sentences — the `^` half, and the punctuation", () => {
    // 🆕🆕 D363 — ONE ROW LEFT THIS LIST AND IT IS THE ROW THIS SLICE BOUGHT.
    // The list carried *"A real trailing clause pins `$`"* — Palafin plus "Then,
    // discard an Energy from this Pokémon." — which was a guard keyed on a
    // predecessor's REFUSAL, and paying the refusal inverts it. It moves to the
    // case below rather than being deleted, because the guarantee it stood for is
    // still owed: a trailing clause no reader resolves must still be REPORTED.
    for (const text of [
      // Lowercase leading "if" — the skeleton has no /i.
      "if this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
      // No trailing period is not the whole sentence.
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing",
      // "!" for "." — the same one-character difference from the other side.
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing!",
      // The CONSEQUENT ALONE, with no leading "If" and no clause — the degenerate
      // string a substring matcher would happily claim.
      "this attack does nothing.",
      // Leading text pins `^` — the coin-flip family's shape, on this clause.
      "Flip a coin. If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
      // The same six guards would be owed by Lycanroc's sentence; two suffice to
      // show the anchor is the sentence's and not the clause's.
      "if your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.",
      "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing",
    ]) {
      expect(deriveAttackRequirement(text)).toBeNull();
    }
  });

  it("🆕 D363 — a trailing clause no longer pins `$`, and what pins it INSTEAD is the SPLIT", () => {
    // The guarantee the deleted row stood for, re-made where it now lives. The
    // reader resolves the leading sentence…
    const compound = `${JUSTICE_KICK} Then, discard an Energy from this Pokémon.`;
    expect(deriveAttackRequirement(compound)).toEqual({ kind: "yourActivePromotedThisTurn" });
    // …and the SPLIT hands the companion back rather than eating it, which is the
    // only reason the widening is safe: the site rebinds every other reader onto
    // that body, so an unread companion is still named on the loud path. Driven
    // on a board in `sawkRequirementSplit.test.ts` §5.
    expect(splitAttackRequirementClause(compound)).toEqual({
      clause: JUSTICE_KICK,
      body: "Then, discard an Energy from this Pokémon.",
    });
    // 🛑 AND THE SPLIT REFUSES A CLAUSE THE TABLE DOES NOT CARRY, which is what
    // stops the widened anchor from stripping a requirement nothing answered.
    //
    // ⚠️ 🆕🆕 **D366 — THIS CONTROL WAS RE-POINTED, AND THE RE-POINTING IS THE
    // WHOLE HAZARD OF WRITING A GUARD ON A REFUSAL.** It used to name Victini's
    // *"If you have 4 or fewer Benched Pokémon…"*, which D366 BOUGHT — so the
    // assertion INVERTED: the split started firing on it and the case went red
    // naming a sentence the engine had just learned to read. The guard is correct
    // and its SUBJECT rotted, exactly as `sawkRequirementSplit`'s Lycanroc id did.
    // Re-aimed at Fan Rotom's clause, which is still unmapped at this head (and
    // whose refusal `benchCountRequirement.test.ts` §1 prices at 2 printings). A
    // guard keyed on something NOT being built has to be re-read every time
    // something is.
    // 🆕🆕 D378 — **AND IT ROTTED AGAIN, EXACTLY AS THE PARAGRAPH ABOVE PREDICTED
    // IT WOULD.** D378 bought Fan Rotom's clause (`stadiumInPlay`), so the split
    // started firing on it too. Re-aimed at the exact hand-size read, which is the
    // LAST unmapped sentence behind this skeleton — so the NEXT slice to take it
    // must replace this subject with a CONSTRUCTED near-miss and say so. **THREE
    // SUBJECTS IN THREE SLICES IS NOT BAD LUCK; IT IS WHAT A GUARD KEYED ON A
    // REFUSAL COSTS, AND THE COST IS NOW NAMED WITH ITS END DATE.**
    // 🛑 🆕🆕 **D379 — THE END DATE ARRIVED, AND THIS IS THE FOURTH SUBJECT IN FOUR
    // SLICES.** D379 bought the hand-size read (`yourHandExactly`), and with it the
    // does-nothing skeleton SATURATED: there is no printed sentence left that this
    // table refuses, so the subject cannot be a printed one any more. It is now
    // CONSTRUCTED — the printed clause with its PARAMETER moved by one — and that is
    // strictly sharper than what it replaced: the row is keyed on a LITERAL, so this
    // string is exactly what a table "simplified" into a `\d+` pattern would wrongly
    // claim. **THE GUARD IS UNCHANGED; ITS SUBJECT STOPPED BEING SOMETHING THE POOL
    // COULD SUPPLY.** No further re-aiming is owed — a constructed near-miss has no
    // expiry date, which is the one thing a printed refusal could never offer.
    expect(
      splitAttackRequirementClause(
        "If you don't have exactly 4 cards in your hand, this attack does nothing. Then, discard an Energy from this Pokémon.",
      ),
    ).toBeNull();
    // …and the printed sentence one value over IS stripped, which is what keeps the
    // line above from passing because the splitter is broken.
    expect(
      splitAttackRequirementClause(
        "If you don't have exactly 3 cards in your hand, this attack does nothing. Then, discard an Energy from this Pokémon.",
      ),
    ).toEqual({
      clause: "If you don't have exactly 3 cards in your hand, this attack does nothing.",
      body: "Then, discard an Energy from this Pokémon.",
    });
  });

  it("🆕 D363 — the clause group is LAZY, so TWO does-nothing sentences spend the FIRST", () => {
    // 🛑 THE ONLY CASE THAT TELLS `(.+?)` FROM `(.+)` APART, and it is a
    // DIFFERENT loss from the `$` itself: with a trailing group behind it a
    // GREEDY clause runs to the LAST `", this attack does nothing."` in the
    // string, capturing "…this turn, this attack does nothing. If your
    // opponent's Active Pokémon has no damage counters…" as one clause — which
    // no table row carries, so BOTH readers go null and the printing falls back
    // into the residue with its first requirement unspent.
    //
    // ⚠️ CONSTRUCTED, AND SAID SO. No catalog printing spells two does-nothing
    // sentences (measured pool-wide: 2 rows carry a leading one with ANY trailing
    // text and both are Sawk). That is exactly why the guard lives in the PATTERN
    // and needs a constructed case to prove it — a survivor here would mean the
    // laziness is untested, not that it is unneeded.
    const two = `${JUSTICE_KICK} ${FINISHING_FANG}`;
    expect(deriveAttackRequirement(two)).toEqual({ kind: "yourActivePromotedThisTurn" });
    expect(splitAttackRequirementClause(two)).toEqual({
      clause: JUSTICE_KICK,
      body: FINISHING_FANG,
    });
    // …and the SECOND clause is the one that would have been read under a greedy
    // group, so the two answers are a whole board fact apart rather than a
    // formatting difference.
    expect(deriveAttackRequirement(FINISHING_FANG)).toEqual({ kind: "opponentActiveDamaged" });
  });
});

describe("ZERO registry rows — the cards cancel straight off their printed text", () => {
  it("has no program of any kind for either card, the reprint, or the pre-evolutions", () => {
    // sv03-200 is byte-identical to sv03-062 apart from `local_id`/rarity and is
    // deliberately NOT a fixture, so this is the ONE place the reprint is named:
    // it must be as unauthored as the print it copies, or the two would resolve
    // differently. Three ways per id, on promotedClause.test.ts's pattern.
    for (const id of ["sv03-062", "sv03-200", "sv03-117"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
    }
    // The pre-evolutions are bodies to be evolved, never ones to act.
    expect(programFor("sv03-061")).toBeUndefined();
    expect(programFor("sv03-116")).toBeUndefined();
  });

  it("keeps the two arming ROUTES authored, which is what makes those cases real", () => {
    // The clause itself is unauthored; the Trainers that arm it through
    // `switchInto` are not, and they have to be — `playTrainer` refuses an
    // unauthored Trainer outright (TRAINER_NOT_SIMULATED).
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
    expect(programFor("sv02-172")?.trainer).toEqual([{ op: "gust" }]);
    expect(FIXTURE_POOL["sv01-194"]?.trainerType).toBe("Item");
    expect(FIXTURE_POOL["sv02-172"]?.trainerType).toBe("Supporter");
  });
});

describe("Palafin — the promotion requirement through a REAL attack", () => {
  it("CANCELS on a Palafin that never moved — and the turn still ends", () => {
    // THE CONTROL, and the case that states what "does nothing" means as a list of
    // absences rather than as one number.
    const opened = bigDefender(board(11), "p2");
    const state = palafinActive(opened, "p1");
    expect(activeCardId(state, "p1")).toBe("sv03-062");
    expect(state.players.p1.active?.promotedTurn).toBeNull();
    expect(conditionHolds(state, "p1", PROMOTED)).toBe(false);
    const before = activeDamage(state, "p2");
    const uid = activeUid(state, "p1");

    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: KICK_INDEX,
    });
    // The event is the confusion path's, with the OTHER reason.
    expect(find(events, "ATTACK_FAILED")).toEqual({
      type: "ATTACK_FAILED",
      seat: "p1",
      uid,
      reason: "requirement",
    });
    // NOTHING is exactly what happened: no damage event, no counters, no KO.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(types(events)).not.toContain("KNOCKED_OUT");
    // …and the defender's damage is byte-identical to before, not merely small.
    expect(activeDamage(done, "p2")).toBe(before);
    expect(activeDamage(done, "p2")).toBe(0);
    // The sentence was SIMULATED — a cancelled attack is not a skipped effect.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // THE TURN STILL ENDS. A cancelled attack is an attack that was USED, which is
    // why the gate returns through `finishAttack` and not with a bare `next`.
    expect(types(events)).toContain("TURN_ENDED");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("lands 210 once a REAL retreat has brought it up", () => {
    const opened = bigDefender(board(11), "p2");
    const benched = palafinBenched(opened, "p1");
    const armed = retreatInto(benched.state, "p1", benched.index);
    expect(activeCardId(armed, "p1")).toBe("sv03-062");
    expect(armed.players.p1.active?.promotedTurn).toBe(armed.turn);
    expect(conditionHolds(armed, "p1", PROMOTED)).toBe(true);
    const { state: done, events } = mustApply(armed, {
      type: "attack",
      seat: "p1",
      index: KICK_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(210);
    // 210 < 320, so nothing was Knocked Out and the number can be read off the
    // board a second time — which is the whole reason the deck carries this body.
    expect(activeDamage(done, "p2")).toBe(210);
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });

  it("lands 210 once a REAL Switch has brought it up — the printed verb is 'move'", () => {
    // The same number down the OTHER route (`switchInto` rather than `retreat`).
    // A gate that only lifted on a §11 retreat would read a strictly narrower
    // question than the one printed.
    const opened = bigDefender(board(11), "p2");
    const benched = palafinBenched(opened, "p1");
    const switched = playTrainer(benched.state, "p1", "sv01-194");
    expect(activeCardId(switched, "p1")).toBe("sv03-062");
    const { events } = mustApply(switched, { type: "attack", seat: "p1", index: KICK_INDEX });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(210);
    expect(types(events)).not.toContain("ATTACK_FAILED");
  });

  it("is TURN-SCOPED — a retreat LAST turn cancels it this turn", () => {
    // D124 proved the stamp goes stale by arithmetic from the BONUS side (the
    // number drops back to the printed base). From the CANCEL side the same
    // staleness is the difference between a 210 and no attack at all.
    const opened = bigDefender(board(11), "p2");
    const benched = palafinBenched(opened, "p1");
    const armed = retreatInto(benched.state, "p1", benched.index);
    expect(armed.turn).toBe(2);
    const backAround = mustApply(mustApply(armed, { type: "endTurn", seat: "p1" }).state, {
      type: "endTurn",
      seat: "p2",
    }).state;
    expect(backAround.turn).toBe(4);
    // The stamp is STILL 2 — it went stale without anyone rewriting it.
    expect(backAround.players.p1.active?.promotedTurn).toBe(2);
    expect(activeCardId(backAround, "p1")).toBe("sv03-062");
    expect(backAround.players.p1.active?.energy).toHaveLength(2); // the {W}{W} survived
    const { events } = mustApply(backAround, { type: "attack", seat: "p1", index: KICK_INDEX });
    expect(find(events, "ATTACK_FAILED")?.reason).toBe("requirement");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
  });

  it("§8.1 — a KO promotion carries the ATTACKER's turn, so your own Kick still fails", () => {
    // THE MOST IMPORTANT BOARD CASE IN THE FILE, and D124's §8.1 argument re-proved
    // from the cancel side. The replacement comes up during the OPPONENT's turn and
    // is stamped with THEIR turn number; nothing clears it, and it simply cannot
    // equal `state.turn` once the controller's own turn has begun. Without that
    // falling out of the arithmetic, every Knock Out would hand the defender a free
    // armed 210 on the turn that follows.
    let state = lycanrocActive(board(11), "p1"); // P1's KO tool: Slashing Claw, a flat 100
    const benched = palafinBenched(state, "p2"); // P2 bench[0] — the Pokémon that will come up
    state = benchFromDeck(benched.state, "p2", "fix-bigbody"); // bench[1] — so the promotion is a real CHOICE
    state = setDamage(state, "p2", 150); // 200 HP body one Slashing Claw from a KO
    expect(state.turn).toBe(2);

    const { state: parked, events: koEvents } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: CLAW_INDEX,
    });
    expect(find(koEvents, "DAMAGE_DEALT")?.dealt).toBe(100);
    expect(types(koEvents)).toContain("KNOCKED_OUT");
    const onPrizes = mustApply(parked, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
    expect(onPrizes.phase).toEqual({ kind: "ko:promote", seat: "p2" });
    expect(onPrizes.turn).toBe(2); // the park sits BETWEEN turns

    const { state: done } = mustApply(onPrizes, {
      type: "promote",
      seat: "p2",
      benchIndex: benched.index,
    });
    expect(activeCardId(done, "p2")).toBe("sv03-062");
    // Stamped with the ATTACKER's turn, and the very same apply rolled the turn
    // over — so the fact is stale the instant its owner can act on it.
    expect(done.players.p2.active?.promotedTurn).toBe(2);
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(conditionHolds(done, "p2", PROMOTED)).toBe(false);
    // END TO END: P2's freshly promoted Palafin declares Justice Kick and gets
    // nothing at all.
    const { state: after, events } = mustApply(done, {
      type: "attack",
      seat: "p2",
      index: KICK_INDEX,
    });
    expect(find(events, "ATTACK_FAILED")?.reason).toBe("requirement");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(activeDamage(after, "p1")).toBe(0);
  });

  it("SURVIVES EVOLUTION — retreat a Finizen, evolve Palafin on top, 210 still lands", () => {
    // §10 sheds Special Conditions, the retreat block and temporary markers. It
    // does NOT shed the promotion stamp, because having moved is a fact about the
    // TURN and not an effect sitting on the card — and mechanically because
    // `placeEvolution` spreads `{ ...from }`.
    //
    // Turn 4 rather than turn 2: §4/§10 ban evolving on your own first turn, and P1
    // went second here.
    let state = bigDefender(laterBoard(11), "p2");
    expect(state.turn).toBe(4);
    state = benchFromDeck(state, "p1", "sv03-061"); // Finizen, turnPlayed 0
    const finizenIndex = state.players.p1.bench.length - 1;
    state = attachBenchFromDeck(state, "p1", finizenIndex, "fix-water-energy", 2);
    const retreated = retreatInto(state, "p1", finizenIndex);
    expect(activeCardId(retreated, "p1")).toBe("sv03-061");
    expect(retreated.players.p1.active?.promotedTurn).toBe(4);

    const withCard = handFromDeck(retreated, "p1", "sv03-062", 1);
    const { state: evolved, events: evolveEvents } = mustApply(withCard, {
      type: "evolve",
      seat: "p1",
      uid: handUid(withCard, "p1", "sv03-062"),
      target: { spot: "active" },
    });
    expect(types(evolveEvents)).toContain("POKEMON_EVOLVED");
    expect(activeCardId(evolved, "p1")).toBe("sv03-062");
    // The stamp is UNCHANGED — not re-stamped, not cleared — while `turnPlayed`
    // DID move, which is the contrast that makes the previous line mean something.
    expect(evolved.players.p1.active?.promotedTurn).toBe(4);
    expect(evolved.players.p1.active?.turnPlayed).toBe(4);
    expect(conditionHolds(evolved, "p1", PROMOTED)).toBe(true);
    // The {W}{W} rode up the stack with it (§10), so the requirement pays through
    // a REAL attack on the evolution.
    const { events } = mustApply(evolved, { type: "attack", seat: "p1", index: KICK_INDEX });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(210);
    expect(types(events)).not.toContain("ATTACK_FAILED");
  });

  it("reads the ATTACKER's seat — an OPPONENT's promotion arms nothing, both ways", () => {
    // SEAT ASYMMETRY, on the one board that can state it. Boss's Orders promotes a
    // Pokémon on the OTHER side of the table DURING YOUR OWN TURN, so
    // `yourActivePromotedThisTurn` is genuinely TRUE — for the seat that is not
    // attacking. A gate that asked "did any Active move this turn" would score a
    // 210 here; the printed clause is about the attacker's own body.
    //
    // Unreachable any other way: a KO promotion ends the turn in the same apply,
    // and a retreat only ever moves your own Pokémon.
    for (const attacker of ["p1", "p2"] as const) {
      const defender = other(attacker);
      // P1 acts on turn 2, P2 on turn 3 — one pass apart.
      const opened =
        attacker === "p1" ? board(11) : mustApply(board(11), { type: "endTurn", seat: "p1" }).state;
      // The defending seat's Bench holds exactly one body (the one displaced by
      // the 320 HP pin), so the gust auto-resolves without parking.
      const withDefender = bigDefender(opened, defender);
      expect(withDefender.players[defender].bench).toHaveLength(1);
      const state = palafinActive(withDefender, attacker);
      const gusted = playTrainer(state, attacker, "sv02-172");
      // The board fact is TRUE — for the seat that is not attacking.
      expect(activeCardId(gusted, defender)).toBe("fix-bigbody");
      expect(gusted.players[defender].active?.promotedTurn).toBe(gusted.turn);
      expect(conditionHolds(gusted, defender, PROMOTED)).toBe(true);
      expect(conditionHolds(gusted, attacker, PROMOTED)).toBe(false);
      // …and the attack is cancelled all the same.
      const { state: done, events } = mustApply(gusted, {
        type: "attack",
        seat: attacker,
        index: KICK_INDEX,
      });
      expect(find(events, "ATTACK_FAILED")?.reason).toBe("requirement");
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(activeDamage(done, defender)).toBe(0);
    }
  });
});

describe("Lycanroc — the damage requirement, read BEFORE the damage", () => {
  it("CANCELS into an UNDAMAGED Active — and does NOT bootstrap itself", () => {
    // THE CASE THAT DISCHARGES THE PRINTED QUALIFIER. "…has no damage counters on
    // it BEFORE THIS ATTACK DOES DAMAGE" is modelled by nothing at all: the gate
    // sits in front of the §8.5 pipeline, so the only board it can read is the one
    // where this attack has not landed. If the check ran anywhere later, Finishing
    // Fang would satisfy its own requirement with its own hit and could never be
    // cancelled at all.
    const opened = bigDefender(board(11), "p2");
    const state = lycanrocActive(opened, "p1");
    expect(activeDamage(state, "p2")).toBe(0);
    expect(conditionHolds(state, "p1", DAMAGED)).toBe(false);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FANG_INDEX,
    });
    expect(find(events, "ATTACK_FAILED")?.reason).toBe("requirement");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // NO BOOTSTRAP: still zero, so the clause is as false after the attack as
    // before it.
    expect(activeDamage(done, "p2")).toBe(0);
    expect(conditionHolds(done, "p1", DAMAGED)).toBe(false);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("lands 90 into an Active a REAL Slashing Claw damaged two turns earlier", () => {
    // The damage is put there by an ACTION, not by surgery — and by Lycanroc's OWN
    // index 1, which is the only attack in this deck that can place it (Finishing
    // Fang cannot, by the case above). Turn 2: 100. Turn 4: the clause is true, so
    // 90 lands on top. 190 total, comfortably inside the 320 HP body.
    const opened = bigDefender(board(11), "p2");
    const armedBoard = lycanrocActive(opened, "p1");
    const { state: afterClaw, events: clawEvents } = mustApply(armedBoard, {
      type: "attack",
      seat: "p1",
      index: CLAW_INDEX,
    });
    expect(find(clawEvents, "DAMAGE_DEALT")?.dealt).toBe(100);
    expect(afterClaw.players.p2.active?.damage).toBe(100);
    const backAround = mustApply(afterClaw, { type: "endTurn", seat: "p2" }).state;
    expect(backAround.turn).toBe(4);
    expect(activeCardId(backAround, "p1")).toBe("sv03-117");
    expect(conditionHolds(backAround, "p1", DAMAGED)).toBe(true);
    const { state: done, events } = mustApply(backAround, {
      type: "attack",
      seat: "p1",
      index: FANG_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(activeDamage(done, "p2")).toBe(190);
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });

  it("reads the OPPONENT's Active, not your own — the member's one cross-board arm", () => {
    // Seat asymmetry for the second row. Damage on the ATTACKER's own body is the
    // wrong board: `opponentActiveDamaged` is the only cross-board member in the
    // vocabulary, and a gate that lost the seat would arm on any damage anywhere.
    //
    // SURGERY here, deliberately: the only real action that damages the attacker's
    // OWN Active is an attack from the other seat, which would also advance the
    // turn past the one the assertion is about. The previous case is the real-
    // action witness for the arm that matters.
    const opened = bigDefender(board(11), "p2");
    const state = setDamage(lycanrocActive(opened, "p1"), "p1", 60);
    expect(activeDamage(state, "p1")).toBe(60);
    expect(activeDamage(state, "p2")).toBe(0);
    expect(conditionHolds(state, "p1", DAMAGED)).toBe(false); // p1 asks about p2
    expect(conditionHolds(state, "p2", DAMAGED)).toBe(true); // p2 asks about p1
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: FANG_INDEX });
    expect(find(events, "ATTACK_FAILED")?.reason).toBe("requirement");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
  });

  it("arms from EITHER seat — the requirement is seat-relative, not p1-relative", () => {
    for (const attacker of ["p1", "p2"] as const) {
      const defender = other(attacker);
      const opened =
        attacker === "p1" ? board(11) : mustApply(board(11), { type: "endTurn", seat: "p1" }).state;
      const withDefender = bigDefender(opened, defender);
      const bare = lycanrocActive(withDefender, attacker);
      expect(
        find(
          mustApply(bare, { type: "attack", seat: attacker, index: FANG_INDEX }).events,
          "ATTACK_FAILED",
        )?.reason,
      ).toBe("requirement");
      // The same board with the defender damaged — surgery, because the real route
      // (an attack) would hand the turn to the other seat mid-case.
      const armed = setDamage(bare, defender, 30);
      const { events } = mustApply(armed, { type: "attack", seat: attacker, index: FANG_INDEX });
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    }
  });

  it("resolves Slashing Claw as a plain 100 — the INDEX-KEYED negative", () => {
    // The card's OTHER attack carries no `effect` key at all, so there is nothing
    // for any deriver to read: no requirement, no bonus, no program, and no skipped
    // row (a null effect is not an unsimulated one). This is what makes FANG_INDEX
    // mean something — the requirement must not leak across the index seam.
    expect(
      deriveAttackRequirement(FIXTURE_POOL["sv03-117"]?.attacks?.[CLAW_INDEX]?.effect ?? ""),
    ).toBeNull();
    const opened = bigDefender(board(11), "p2");
    const state = lycanrocActive(opened, "p1");
    // Undamaged defender — the board on which index 0 CANCELS, so a leak would be
    // visible as a cancelled Slashing Claw rather than as a wrong number.
    expect(conditionHolds(state, "p1", DAMAGED)).toBe(false);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: CLAW_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(100);
    expect(activeDamage(done, "p2")).toBe(100);
  });
});

describe("effectSimulated — a requirement makes the sentence SIMULATED, either way", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED on either card, in EITHER outcome", () => {
    // FOUR boards, one claim: `requirement !== null` is a term in
    // `effectSimulated`, so the printed sentence counts as handled whether the
    // clause held or not. Before D125 all four of these produced a loud skipped
    // row; a regression that dropped the term would bring it back on all four, and
    // one that reported it only on the cancel would bring it back on two.
    const opened = bigDefender(board(11), "p2");

    // Palafin, CANCELLED (never moved).
    const kickBare = palafinActive(opened, "p1");
    const bareEvents = mustApply(kickBare, {
      type: "attack",
      seat: "p1",
      index: KICK_INDEX,
    }).events;
    expect(types(bareEvents)).toContain("ATTACK_FAILED");
    expect(types(bareEvents)).not.toContain("ATTACK_EFFECT_SKIPPED");

    // Palafin, ARMED (a real retreat).
    const benched = palafinBenched(opened, "p1");
    const kickArmed = retreatInto(benched.state, "p1", benched.index);
    const armedEvents = mustApply(kickArmed, {
      type: "attack",
      seat: "p1",
      index: KICK_INDEX,
    }).events;
    expect(types(armedEvents)).toContain("DAMAGE_DEALT");
    expect(types(armedEvents)).not.toContain("ATTACK_EFFECT_SKIPPED");

    // Lycanroc, CANCELLED (undamaged defender).
    const fangBare = lycanrocActive(opened, "p1");
    const fangBareEvents = mustApply(fangBare, {
      type: "attack",
      seat: "p1",
      index: FANG_INDEX,
    }).events;
    expect(types(fangBareEvents)).toContain("ATTACK_FAILED");
    expect(types(fangBareEvents)).not.toContain("ATTACK_EFFECT_SKIPPED");

    // Lycanroc, ARMED (damaged defender).
    const fangArmed = setDamage(fangBare, "p2", 30);
    const fangArmedEvents = mustApply(fangArmed, {
      type: "attack",
      seat: "p1",
      index: FANG_INDEX,
    }).events;
    expect(types(fangArmedEvents)).toContain("DAMAGE_DEALT");
    expect(types(fangArmedEvents)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("ATTACK_FAILED — the two reasons stay distinguishable", () => {
  it("renders a DIFFERENT log row for 'requirement' than for 'confusion'", () => {
    // The enum widening's user-visible half. "confusion" is followed by its own
    // COUNTERS_PLACED row, so its line can afford to be terse; "requirement" is
    // followed by NOTHING, so its line has to say on its own that the attack
    // happened and did nothing — otherwise a cancelled attack reads as a silent
    // no-op in the log.
    const state = palafinActive(bigDefender(board(11), "p2"), "p1");
    const uid = activeUid(state, "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: KICK_INDEX });
    const failed = find(events, "ATTACK_FAILED");
    if (failed === undefined) throw new Error("expected the attack to be cancelled");
    const ctx: LogContext = {
      names: { p1: "Ember", p2: "Tide" },
      state,
      elapsed: "+00:07",
    };
    const text = (event: GameEvent): string =>
      logFromEvents([event], ctx)
        .flatMap((entry) => (entry.kind === "turn" ? [] : entry.segments.map((s) => s.text)))
        .join("");
    const requirementRow = text(failed);
    const confusionRow = text({ type: "ATTACK_FAILED", seat: "p1", uid, reason: "confusion" });
    expect(requirementRow).not.toBe(confusionRow);
    expect(requirementRow).toContain("did nothing");
    expect(requirementRow).toContain("its condition was not met");
    expect(confusionRow).toContain("Confused");
    expect(confusionRow).not.toContain("did nothing");
  });

  it("leaves the CONFUSION path alone — same event, other reason, other mechanism", () => {
    // Deliberately light: checkup.test.ts already owns §12's tails path end to end
    // (the flip, the 30 self-damage, the turn ending). All that is wanted here is
    // that the two reasons are two, and that the requirement gate — which sits
    // AFTER the confusion check in attack.ts — did not swallow the older one.
    const reasons: GameEvent[] = [
      { type: "ATTACK_FAILED", seat: "p1", uid: "u#1", reason: "confusion" },
      { type: "ATTACK_FAILED", seat: "p1", uid: "u#1", reason: "requirement" },
    ];
    const [confused, required] = reasons;
    if (confused?.type !== "ATTACK_FAILED" || required?.type !== "ATTACK_FAILED") {
      throw new Error("unreachable");
    }
    expect(confused.reason).not.toBe(required.reason);
    // …and the cancel path really does emit the NEW one on a real board, so the
    // pair above is not two strings in a test file.
    const state = palafinActive(bigDefender(board(11), "p2"), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: KICK_INDEX });
    expect(find(events, "ATTACK_FAILED")?.reason).toBe("requirement");
    // No confusion check ran at all — the attacker is not Confused, so §12's step
    // never fires and the only failure on this board is D125's.
    expect(types(events)).not.toContain("CONFUSION_CHECK");
    expect(state.players.p1.active?.conditions.rotation).toBe("none");
  });
});

describe("purity", () => {
  it("mutates nothing when either requirement is read on a frozen board", () => {
    const opened = bigDefender(board(11), "p2");
    const cancelled = deepFreeze(palafinActive(opened, "p1"));
    expect(conditionHolds(cancelled, "p1", PROMOTED)).toBe(false);
    expect(conditionHolds(cancelled, "p2", PROMOTED)).toBe(false);
    const benched = palafinBenched(opened, "p1");
    const armed = deepFreeze(retreatInto(benched.state, "p1", benched.index));
    expect(conditionHolds(armed, "p1", PROMOTED)).toBe(true);
    expect(conditionHolds(armed, "p2", PROMOTED)).toBe(false);
    // The cross-board member too, since that is the one that reaches for the other
    // seat's player object.
    const damaged = deepFreeze(setDamage(lycanrocActive(opened, "p1"), "p2", 30));
    expect(conditionHolds(damaged, "p1", DAMAGED)).toBe(true);
    expect(conditionHolds(damaged, "p2", DAMAGED)).toBe(false);
    // …and the DERIVERS are pure functions of their string, frozen board or not.
    expect(deriveAttackRequirement(JUSTICE_KICK)).toEqual(PROMOTED);
    expect(deriveAttackRequirement(FINISHING_FANG)).toEqual(DAMAGED);
  });
});
