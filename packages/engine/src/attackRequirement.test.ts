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
  findEvent,
} from "./testFixtures";

const JUSTICE_KICK =
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.";

const FINISHING_FANG =
  "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.";

const ACCELERATOR_FLASH =
  "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage.";

const BLOSSOM_BLADE =
  "If your opponent's Active Pokémon already has any damage counters on it, this attack does 180 more damage.";

const ENHANCED_FANG =
  "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.";

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
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

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ATTACK_REQUIREMENT_DECK, p2: ATTACK_REQUIREMENT_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function laterBoard(seed: number): GameState {
  const afterP1 = mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
  return mustApply(afterP1, { type: "endTurn", seat: "p2" }).state;
}

function bigDefender(state: GameState, seat: Seat): GameState {
  return setActiveFromDeck(state, seat, "fix-lightning-weak-big");
}

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
    const surpriseAttack = "Flip a coin. If tails, this attack does nothing.";
    expect(deriveAttackRequirement(surpriseAttack)).toBeNull();
    expect(surpriseAttack.startsWith("If ")).toBe(false);
  });

  it("refuses a BARE 'If tails' — at the TABLE, which is the OTHER guard", () => {
    const bareTails = "If tails, this attack does nothing.";
    expect(bareTails.startsWith("If ")).toBe(true);
    expect(bareTails.endsWith(", this attack does nothing.")).toBe(true);
    expect(deriveAttackRequirement(bareTails)).toBeNull();
  });

  it("refuses the ANAPHORIC 'If you can't' printings — at the ANCHOR", () => {
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
      "this Pokémon didn't move from your Bench to the Active Spot this turn",
      // "did not" EXPANDED — the contraction is printed, and English offers a
      // second spelling of the same words that no card uses.
      "this Pokémon did not move from the Bench to the Active Spot this turn",
      // DE-ACCENTED "Pokemon" — the é is a real U+00E9 in the catalog.
      "this Pokemon didn't move from the Bench to the Active Spot this turn",
      "this Pokémon moved from the Bench to the Active Spot this turn",
      // Lycanroc's clause TRUNCATED before its trailing qualifier — the shape a
      // reader who thought "before this attack does damage" was decoration would
      // write. It is part of the key.
      "your opponent's Active Pokémon has no damage counters on it",
      "your opponent's Active Pokémon has any damage counters on it before this attack does damage",
      "your Active Pokémon has no damage counters on it before this attack does damage",
      // The pronoun already RESOLVED — `conditionNote`'s output shape fed back in.
      "your Active Pokémon didn't move from the Bench to the Active Spot this turn",
    ]) {
      expect(deriveAttackRequirement(`If ${clause}, this attack does nothing.`)).toBeNull();
    }
  });

  it("keeps the OUTER ANCHOR guards on both sentences — the `^` half, and the punctuation", () => {
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

  it("D363 — a trailing clause no longer pins `$`, and what pins it INSTEAD is the SPLIT", () => {
    const compound = `${JUSTICE_KICK} Then, discard an Energy from this Pokémon.`;
    expect(deriveAttackRequirement(compound)).toEqual({ kind: "yourActivePromotedThisTurn" });
    expect(splitAttackRequirementClause(compound)).toEqual({
      clause: JUSTICE_KICK,
      body: "Then, discard an Energy from this Pokémon.",
    });
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

  it("D363 — the clause group is LAZY, so TWO does-nothing sentences spend the FIRST", () => {
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
    expect(findEvent(events, "ATTACK_FAILED")).toEqual({
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
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(210);
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
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(210);
    expect(types(events)).not.toContain("ATTACK_FAILED");
  });

  it("is TURN-SCOPED — a retreat LAST turn cancels it this turn", () => {
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
    expect(findEvent(events, "ATTACK_FAILED")?.reason).toBe("requirement");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
  });

  it("§8.1 — a KO promotion carries the ATTACKER's turn, so your own Kick still fails", () => {
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
    expect(findEvent(koEvents, "DAMAGE_DEALT")?.dealt).toBe(100);
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
    expect(findEvent(events, "ATTACK_FAILED")?.reason).toBe("requirement");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(activeDamage(after, "p1")).toBe(0);
  });

  it("SURVIVES EVOLUTION — retreat a Finizen, evolve Palafin on top, 210 still lands", () => {
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
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(210);
    expect(types(events)).not.toContain("ATTACK_FAILED");
  });

  it("reads the ATTACKER's seat — an OPPONENT's promotion arms nothing, both ways", () => {
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
      expect(findEvent(events, "ATTACK_FAILED")?.reason).toBe("requirement");
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(activeDamage(done, defender)).toBe(0);
    }
  });
});

describe("Lycanroc — the damage requirement, read BEFORE the damage", () => {
  it("CANCELS into an UNDAMAGED Active — and does NOT bootstrap itself", () => {
    const opened = bigDefender(board(11), "p2");
    const state = lycanrocActive(opened, "p1");
    expect(activeDamage(state, "p2")).toBe(0);
    expect(conditionHolds(state, "p1", DAMAGED)).toBe(false);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FANG_INDEX,
    });
    expect(findEvent(events, "ATTACK_FAILED")?.reason).toBe("requirement");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // NO BOOTSTRAP: still zero, so the clause is as false after the attack as
    // before it.
    expect(activeDamage(done, "p2")).toBe(0);
    expect(conditionHolds(done, "p1", DAMAGED)).toBe(false);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("lands 90 into an Active a REAL Slashing Claw damaged two turns earlier", () => {
    const opened = bigDefender(board(11), "p2");
    const armedBoard = lycanrocActive(opened, "p1");
    const { state: afterClaw, events: clawEvents } = mustApply(armedBoard, {
      type: "attack",
      seat: "p1",
      index: CLAW_INDEX,
    });
    expect(findEvent(clawEvents, "DAMAGE_DEALT")?.dealt).toBe(100);
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
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(activeDamage(done, "p2")).toBe(190);
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });

  it("reads the OPPONENT's Active, not your own — the member's one cross-board arm", () => {
    const opened = bigDefender(board(11), "p2");
    const state = setDamage(lycanrocActive(opened, "p1"), "p1", 60);
    expect(activeDamage(state, "p1")).toBe(60);
    expect(activeDamage(state, "p2")).toBe(0);
    expect(conditionHolds(state, "p1", DAMAGED)).toBe(false); // p1 asks about p2
    expect(conditionHolds(state, "p2", DAMAGED)).toBe(true); // p2 asks about p1
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: FANG_INDEX });
    expect(findEvent(events, "ATTACK_FAILED")?.reason).toBe("requirement");
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
        findEvent(
          mustApply(bare, { type: "attack", seat: attacker, index: FANG_INDEX }).events,
          "ATTACK_FAILED",
        )?.reason,
      ).toBe("requirement");
      // The same board with the defender damaged — surgery, because the real route
      // (an attack) would hand the turn to the other seat mid-case.
      const armed = setDamage(bare, defender, 30);
      const { events } = mustApply(armed, { type: "attack", seat: attacker, index: FANG_INDEX });
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    }
  });

  it("resolves Slashing Claw as a plain 100 — the INDEX-KEYED negative", () => {
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
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(100);
    expect(activeDamage(done, "p2")).toBe(100);
  });
});

describe("effectSimulated — a requirement makes the sentence SIMULATED, either way", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED on either card, in EITHER outcome", () => {
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
    const state = palafinActive(bigDefender(board(11), "p2"), "p1");
    const uid = activeUid(state, "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: KICK_INDEX });
    const failed = findEvent(events, "ATTACK_FAILED");
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
    expect(findEvent(events, "ATTACK_FAILED")?.reason).toBe("requirement");
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
