import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  conditionNote,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
  programFor,
} from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  PROMOTED_CLAUSE_DECK,
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
import { makeInPlay } from "./types";

const ACCELERATOR_FLASH =
  "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage.";

const FIRST_IMPRESSION =
  "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 90 more damage.";

const JUSTICE_KICK =
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.";

/** Weavile sv02-134's "Assaulting Hunt", verbatim — the pool's only other card
    that reads this transition at all, and it reads it as a `when` TRIGGER in the
    PRESENT tense ("moves"), not as a per-turn query about the past. */
const ASSAULTING_HUNT =
  "Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may switch in 1 of your opponent's Benched Basic Pokémon to the Active Spot.";

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function promotedClause(per = 60): string {
  return `If this Pokémon moved from your Bench to the Active Spot this turn, this attack does ${per} more damage.`;
}

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: PROMOTED_CLAUSE_DECK, p2: PROMOTED_CLAUSE_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function laterBoard(seed: number): GameState {
  const afterP1 = mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
  return mustApply(afterP1, { type: "endTurn", seat: "p2" }).state;
}

function revavroomActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv06.5-015"), seat, "fix-metal-energy", 1);
}

function revavroomBenched(state: GameState, seat: Seat): GameState {
  const index = state.players[seat].bench.length;
  return attachBenchFromDeck(
    benchFromDeck(state, seat, "sv06.5-015"),
    seat,
    index,
    "fix-metal-energy",
    1,
  );
}

function golisopodBenched(state: GameState, seat: Seat): GameState {
  const index = state.players[seat].bench.length;
  return attachBenchFromDeck(
    benchFromDeck(state, seat, "swsh10.5-026"),
    seat,
    index,
    "fix-water-energy",
    1,
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

/** The seat's opposite — the member is read for BOTH seats off one board in the
    no-seat-guard case, so the pair has to be spelled somewhere. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** Accelerator Flash is Revavroom ex's FIRST attack; Shattering Speed (250, and
    unsimulated) is the second, which is why the index has to be named. */
const FLASH_INDEX = 0;

const IMPRESSION_INDEX = 0;

const COND = { kind: "yourActivePromotedThisTurn" } as const;

describe("the printed sentence — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char for Revavroom ex sv06.5-015", () => {
    const attack = FIXTURE_POOL["sv06.5-015"]?.attacks?.[FLASH_INDEX];
    expect(attack?.effect).toBe(ACCELERATOR_FLASH);
    // The printed "+" marker — what tells the pipeline a scaling clause is
    // expected at all — and the base the fold starts from.
    expect(attack?.damage).toBe("20+");
    expect(attack?.name).toBe("Accelerator Flash");
    expect(attack?.cost).toEqual(["Metal"]);
    expect(FIXTURE_POOL["sv06.5-015"]?.types).toEqual(["Lightning"]);
    // TWO attacks, so FLASH_INDEX cannot be right by accident — and the second
    // one is carried verbatim too, unsimulated.
    expect(FIXTURE_POOL["sv06.5-015"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv06.5-015"]?.attacks?.[1]).toEqual({
      cost: ["Metal", "Metal", "Metal"],
      name: "Shattering Speed",
      effect: "Discard this Pokémon and all attached cards.",
      damage: 250,
    });
    expect(FIXTURE_POOL["sv06.5-015"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Golisopod swsh10.5-026", () => {
    const attack = FIXTURE_POOL["swsh10.5-026"]?.attacks?.[FLASH_INDEX];
    expect(attack?.effect).toBe(FIRST_IMPRESSION);
    expect(attack?.damage).toBe("20+");
    expect(attack?.name).toBe("First Impression");
    expect(attack?.cost).toEqual(["Water"]);
    expect(FIXTURE_POOL["swsh10.5-026"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["swsh10.5-026"]?.attacks?.[1]).toEqual({
      cost: ["Water", "Colorless", "Colorless"],
      name: "Slash",
      damage: 100,
    });
    expect(FIXTURE_POOL["swsh10.5-026"]?.abilities).toBeNull();
  });

  it("keeps the card facts the damage arithmetic is measured against", () => {
    expect(FIXTURE_POOL["sv06.5-015"]?.name).toBe("Revavroom ex");
    expect(FIXTURE_POOL["sv06.5-015"]?.stage).toBe("Stage1");
    // The pre-evolution NAME is what §10 matches, and it is the whole reason the
    // pool carries a Varoom at all (the evolution-survival case).
    expect(FIXTURE_POOL["sv06.5-015"]?.evolveFrom).toBe("Varoom");
    expect(FIXTURE_POOL["sv06.5-043"]?.name).toBe("Varoom");
    expect(FIXTURE_POOL["sv06.5-043"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv06.5-015"]?.hp).toBe(280);
    expect(FIXTURE_POOL["sv06.5-015"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv06.5-015"]?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(FIXTURE_POOL["sv06.5-015"]?.resistances).toBeNull();

    expect(FIXTURE_POOL["swsh10.5-026"]?.name).toBe("Golisopod");
    expect(FIXTURE_POOL["swsh10.5-026"]?.stage).toBe("Stage1");
    expect(FIXTURE_POOL["swsh10.5-026"]?.evolveFrom).toBe("Wimpod");
    expect(FIXTURE_POOL["swsh10.5-026"]?.types).toEqual(["Water"]);
    expect(FIXTURE_POOL["swsh10.5-026"]?.hp).toBe(130);
    expect(FIXTURE_POOL["swsh10.5-026"]?.retreat).toBe(2);
    expect(FIXTURE_POOL["swsh10.5-026"]?.weaknesses).toEqual([{ type: "Lightning", value: "×2" }]);
    expect(FIXTURE_POOL["swsh10.5-026"]?.resistances).toBeNull();
    const namesInPool = Object.values(FIXTURE_POOL).map((card) => card.name);
    expect(namesInPool).toContain("Varoom");
    expect(namesInPool).toContain("Wimpod");
  });

  it("pins the BYTES — one é apiece, so bytes = code points + 1", () => {
    expect(ACCELERATOR_FLASH.length).toBe(101);
    expect(utf8Bytes(ACCELERATOR_FLASH)).toBe(102);
    expect(FIRST_IMPRESSION.length).toBe(100);
    expect(utf8Bytes(FIRST_IMPRESSION)).toBe(101);
    expect(ACCELERATOR_FLASH.length - FIRST_IMPRESSION.length).toBe(1);
    // The é is the ONLY non-ASCII character in either sentence — asserted over
    // the characters rather than inferred from the totals.
    for (const sentence of [ACCELERATOR_FLASH, FIRST_IMPRESSION]) {
      expect(sentence).toContain("Pokémon");
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual(["é"]);
      // No apostrophe of EITHER kind in the POSITIVE clause…
      expect(sentence).not.toContain("'"); // U+0027
      expect(sentence).not.toContain("’"); // U+2019
    }
    // …while the NEGATIVE twin carries the ASCII one, in "didn't". The pool holds
    // ZERO U+2019 anywhere, so the anchor never has to choose between the two.
    expect(JUSTICE_KICK).toContain("didn't");
    expect(JUSTICE_KICK).not.toContain("’");
    expect(utf8Bytes(JUSTICE_KICK)).toBe(JUSTICE_KICK.length + 1);
  });

  it("is BYTE-IDENTICAL inside the clause across both printings", () => {
    const clause = "If this Pokémon moved from your Bench to the Active Spot this turn, ";
    expect(ACCELERATOR_FLASH.startsWith(clause)).toBe(true);
    expect(FIRST_IMPRESSION.startsWith(clause)).toBe(true);
    expect(ACCELERATOR_FLASH.slice(clause.length)).toBe("this attack does 120 more damage.");
    expect(FIRST_IMPRESSION.slice(clause.length)).toBe("this attack does 90 more damage.");
  });
});

describe("deriveAttackDamageBonus — the clause resolves to the new member", () => {
  it("maps BOTH real printings onto the SAME cond at DIFFERENT amounts", () => {
    expect(deriveAttackDamageBonus(ACCELERATOR_FLASH)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "yourActivePromotedThisTurn" } },
    });
    expect(deriveAttackDamageBonus(FIRST_IMPRESSION)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "yourActivePromotedThisTurn" } },
    });
    const flash = deriveAttackDamageBonus(ACCELERATOR_FLASH);
    const impression = deriveAttackDamageBonus(FIRST_IMPRESSION);
    if (flash?.count.kind !== "boardCondition" || impression?.count.kind !== "boardCondition") {
      throw new Error("unreachable");
    }
    expect(flash.count.cond).toEqual(impression.count.cond);
    expect(flash.per).not.toBe(impression.per);
  });

  it("derives the SAME bonus off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading
    // the derivation straight off the fixture is what proves the two never
    // drifted apart in the same edit.
    expect(deriveAttackDamageBonus(FIXTURE_POOL["sv06.5-015"]?.attacks?.[0]?.effect ?? "")).toEqual(
      { per: 120, count: { kind: "boardCondition", cond: COND } },
    );
    expect(
      deriveAttackDamageBonus(FIXTURE_POOL["swsh10.5-026"]?.attacks?.[0]?.effect ?? ""),
    ).toEqual({ per: 90, count: { kind: "boardCondition", cond: COND } });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 60, 250]) {
      expect(deriveAttackDamageBonus(promotedClause(per))).toEqual({
        per,
        count: { kind: "boardCondition", cond: { kind: "yourActivePromotedThisTurn" } },
      });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so
    // it stays LOUD rather than deriving a no-op bonus.
    expect(deriveAttackDamageBonus(promotedClause(0))).toBeNull();
  });

  it("is a BARE TAG — the member carries no parameter to get wrong", () => {
    const bonus = deriveAttackDamageBonus(ACCELERATOR_FLASH);
    expect(bonus?.count.kind).toBe("boardCondition");
    if (bonus?.count.kind !== "boardCondition") throw new Error("unreachable");
    expect(Object.keys(bonus.count.cond)).toEqual(["kind"]);
  });
});

describe("the near-misses stay LOUD", () => {
  it("refuses Palafin's REAL printed Justice Kick — at the OUTER anchor", () => {
    expect(JUSTICE_KICK).toContain("Active Spot this turn");
    expect(JUSTICE_KICK).toContain("this attack does nothing.");
    expect(JUSTICE_KICK).toContain("from the Bench"); // no possessive
    expect(JUSTICE_KICK).not.toContain("from your Bench");
    expect(deriveAttackDamageBonus(JUSTICE_KICK)).toBeNull();
    expect(deriveAttackDamageMultiplier(JUSTICE_KICK)).toBeNull();
    expect(deriveAttackEffect(JUSTICE_KICK)).toBeNull();
    expect(deriveAttackRequirement(JUSTICE_KICK)).not.toBeNull();
    expect(deriveAttackRequirement(JUSTICE_KICK)).toEqual(COND);
  });

  it("refuses Weavile's REAL Assaulting Hunt — same transition, wrong mechanism", () => {
    expect(ASSAULTING_HUNT).toContain("moves from your Bench to the Active Spot");
    expect(ASSAULTING_HUNT).not.toContain("moved from");
    expect(ASSAULTING_HUNT.startsWith("Once during your turn,")).toBe(true);
    expect(deriveAttackDamageBonus(ASSAULTING_HUNT)).toBeNull();
    expect(deriveAttackDamageMultiplier(ASSAULTING_HUNT)).toBeNull();
    expect(deriveAttackEffect(ASSAULTING_HUNT)).toBeNull();
  });

  it("refuses CONSTRUCTED rewrites of the clause — the Map key is char-for-char", () => {
    for (const clause of [
      "this Pokémon didn't move from your Bench to the Active Spot this turn",
      // …and the same negation with Palafin's own un-possessed "the Bench".
      "this Pokémon didn't move from the Bench to the Active Spot this turn",
      "this Pokémon moved from the Bench to the Active Spot this turn",
      // Weavile's present tense under a damage consequent.
      "this Pokémon moves from your Bench to the Active Spot this turn",
      "your opponent's Active Pokémon moved from their Bench to the Active Spot this turn",
      // The pronoun already resolved — `conditionNote`'s output fed back in. The
      // note is for a HUMAN reading a board, and it must not round-trip into the
      // table by accident.
      "your Active Pokémon moved from your Bench to the Active Spot this turn",
      // The DESTINATION dropped: "moved from your Bench" alone would also be
      // true of a Pokémon that went to the discard.
      "this Pokémon moved from your Bench this turn",
      // The TIMING dropped — without "this turn" the clause is a fact about all
      // of history, which is not what any print asks.
      "this Pokémon moved from your Bench to the Active Spot",
      // "was moved" — the passive voice, which is how a forced switch reads in
      // English and is exactly the near-miss a hand-written matcher invites.
      "this Pokémon was moved from your Bench to the Active Spot this turn",
      // "retreated" — the ROUTE named instead of the MOVE. Three routes stamp
      // `promotedTurn`, so this would be a strictly narrower question.
      "this Pokémon retreated from your Bench to the Active Spot this turn",
      // Lowercase "active spot" — the printed noun is capitalised.
      "this Pokémon moved from your Bench to the active Spot this turn",
    ]) {
      expect(deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage.`)).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      "if this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage.",
      // No trailing period is not the whole sentence.
      "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage",
      // A real trailing clause pins `$`.
      "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage. Then, discard an Energy from this Pokémon.",
      // Leading text pins `^`.
      "Flip a coin. If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage.",
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns — no
      // "more", so this is a SET rather than a bonus.
      "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 damage.",
    ]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
  });
});

describe("deriver disjointness", () => {
  it("keeps both real printings off the other two derivers", () => {
    for (const sentence of [ACCELERATOR_FLASH, FIRST_IMPRESSION]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
    }
  });
});

describe("ZERO registry rows — the cards derive straight off their printed text", () => {
  it("has no program AT THE PRINTED INDEX for either card, or for the reprint", () => {
    for (const id of ["sv06.5-015", "sv06.5-081"]) {
      expect(programFor(id)?.attack?.[0], id).toBeUndefined();
      expect(programFor(id)?.passive, id).toBeUndefined();
      expect(programFor(id)?.abilities, id).toBeUndefined();
      expect(programFor(id)?.attack?.[1], id).toBeDefined();
    }
    for (const id of ["swsh10.5-026"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
    }
    // Varoom is a body to be evolved, never one to act — unauthored too.
    expect(programFor("sv06.5-043")).toBeUndefined();
  });

  it("keeps the two SWITCH ROUTES authored, which is what makes those cases real", () => {
    // The clause itself is unauthored; the Trainers that arm it through
    // `switchInto` are not, and they have to be — `playTrainer` refuses an
    // unauthored Trainer outright (TRAINER_NOT_SIMULATED).
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
    expect(programFor("sv02-172")?.trainer).toEqual([{ op: "gust" }]);
    expect(FIXTURE_POOL["sv01-194"]?.trainerType).toBe("Item");
    expect(FIXTURE_POOL["sv02-172"]?.trainerType).toBe("Supporter");
  });
});

describe("promotedTurn — the state itself", () => {
  it("stamps NULL on every Pokémon that never came from the Bench", () => {
    expect(makeInPlay("uid#0", 0).promotedTurn).toBeNull();
    expect(makeInPlay("uid#1", 7).promotedTurn).toBeNull();
    const state = revavroomBenched(board(11), "p1");
    // The setup-placed Active…
    expect(activeCardId(state, "p1")).toBe("fix-bigbody");
    expect(state.players.p1.active?.promotedTurn).toBeNull();
    // …and a Pokémon that reached the Bench without ever being Active.
    expect(state.cardIdByUid[state.players.p1.bench[0]?.stack.at(-1) ?? ""]).toBe("sv06.5-015");
    expect(state.players.p1.bench[0]?.promotedTurn).toBeNull();
    // The condition reads FALSE off that board for both seats — no Pokémon in
    // play has ever moved.
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(conditionHolds(state, "p2", COND)).toBe(false);
  });

  it("ROUTE 1 — `retreat` stamps state.turn on the Pokémon that comes up", () => {
    const benched = revavroomBenched(board(11), "p1");
    expect(benched.turn).toBe(2);
    const retreated = retreatInto(benched, "p1", 0);
    expect(activeCardId(retreated, "p1")).toBe("sv06.5-015");
    expect(retreated.players.p1.active?.promotedTurn).toBe(2);
    expect(retreated.players.p1.active?.promotedTurn).toBe(retreated.turn);
    // The RETREATER went the other way and was never promoted — the stamp is
    // per-Pokémon, so the body that left the spot keeps its null.
    expect(retreated.players.p1.bench[0]?.promotedTurn).toBeNull();
    expect(conditionHolds(retreated, "p1", COND)).toBe(true);
  });

  it("ROUTE 2a — `switchInto` via Switch stamps YOUR OWN board", () => {
    // Driven inline rather than through the `playTrainer` helper so the real
    // §15.G event can be pinned: the stamp is written by `switchInto`, and
    // POKEMON_SWITCHED is that function's own announcement.
    const benched = revavroomBenched(board(11), "p1");
    const withCard = handFromDeck(benched, "p1", "sv01-194", 1);
    const wasActive = activeUid(withCard, "p1");
    const { state: switched, events } = mustApply(withCard, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(withCard, "p1", "sv01-194"),
    });
    expect(types(events)).toContain("TRAINER_PLAYED");
    expect(findEvent(events, "POKEMON_SWITCHED")?.seat).toBe("p1");
    expect(findEvent(events, "POKEMON_SWITCHED")?.wasActive).toBe(wasActive);
    expect(activeCardId(switched, "p1")).toBe("sv06.5-015");
    expect(switched.players.p1.active?.promotedTurn).toBe(switched.turn);
    expect(conditionHolds(switched, "p1", COND)).toBe(true);
    // The displaced Pokémon is on the Bench, unstamped.
    expect(switched.players.p1.bench.at(-1)?.promotedTurn).toBeNull();
  });

  it("ROUTE 2b — `switchInto` via Boss's Orders stamps the OPPONENT's board", () => {
    const benched = revavroomBenched(board(11), "p2");
    expect(benched.phase).toEqual({ kind: "turn:action", seat: "p1" });
    const gusted = playTrainer(benched, "p1", "sv02-172");
    expect(activeCardId(gusted, "p2")).toBe("sv06.5-015");
    expect(gusted.players.p2.active?.promotedTurn).toBe(2);
    expect(gusted.turn).toBe(2);
    // Read DURING P1's turn: TRUE for p2, whose Pokémon moved, and FALSE for p1,
    // whose Active has not budged. The predicate answers per-POKÉMON.
    expect(conditionHolds(gusted, "p2", COND)).toBe(true);
    expect(conditionHolds(gusted, "p1", COND)).toBe(false);
    // Hand it to P2 and the stamp goes stale by arithmetic — no clear ran.
    const p2Turn = mustApply(gusted, { type: "endTurn", seat: "p1" }).state;
    expect(p2Turn.turn).toBe(3);
    expect(p2Turn.players.p2.active?.promotedTurn).toBe(2);
    expect(conditionHolds(p2Turn, "p2", COND)).toBe(false);
    // …and it is really the CLAUSE that goes cold, not just the predicate: the
    // gusted-out Revavroom attacks on its own turn for the printed base alone.
    const { events } = mustApply(p2Turn, { type: "attack", seat: "p2", index: FLASH_INDEX });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(20);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("ROUTE 3 — a KO promotion stamps the ATTACKER's turn (§8.1)", () => {
    let state = revavroomActive(board(11), "p1"); // P1 attacks with a NEVER-moved Revavroom
    state = revavroomBenched(state, "p2"); // P2 bench[0] — the Pokémon that will come up
    state = benchFromDeck(state, "p2", "fix-bigbody"); // bench[1] — so the promotion is a real CHOICE
    state = setDamage(state, "p2", 190); // 200 HP body one hit from a KO
    expect(state.turn).toBe(2);
    // The control half, asserted in passing: P1's Revavroom was placed by surgery
    // and never moved, so its own clause is cold and the hit is the printed 20.
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    const { state: parked, events: koEvents } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FLASH_INDEX,
    });
    expect(findEvent(koEvents, "DAMAGE_DEALT")?.dealt).toBe(20);
    expect(types(koEvents)).toContain("KNOCKED_OUT");
    const onPrizes = mustApply(parked, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    }).state;
    expect(onPrizes.phase).toEqual({ kind: "ko:promote", seat: "p2" });
    // Still P1's turn number here — the park sits BETWEEN turns and the counter
    // has not advanced.
    expect(onPrizes.turn).toBe(2);
    const { state: done, events } = mustApply(onPrizes, {
      type: "promote",
      seat: "p2",
      benchIndex: 0,
    });
    expect(findEvent(events, "POKEMON_PROMOTED")?.benchIndex).toBe(0);
    expect(activeCardId(done, "p2")).toBe("sv06.5-015");
    // Stamped with the ATTACKER's turn, and the very same apply rolled the turn
    // over — so the fact is stale the instant its owner can act on it.
    expect(done.players.p2.active?.promotedTurn).toBe(2);
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(conditionHolds(done, "p2", COND)).toBe(false);
    // END TO END: P2's freshly promoted Revavroom attacks and scores the printed
    // base, NOT the bonus. Without §8.1 falling out of the arithmetic, every KO
    // in the game would hand the defender a free +120.
    const { events: p2Events } = mustApply(done, {
      type: "attack",
      seat: "p2",
      index: FLASH_INDEX,
    });
    expect(findEvent(p2Events, "DAMAGE_DEALT")?.dealt).toBe(20);
    expect(types(p2Events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("SURVIVES EVOLUTION — `placeEvolution` spreads the stamp through", () => {
    let state = laterBoard(11);
    expect(state.turn).toBe(4);
    state = benchFromDeck(state, "p1", "sv06.5-043"); // Varoom, turnPlayed 0
    state = attachBenchFromDeck(state, "p1", 0, "fix-metal-energy", 1);
    const retreated = retreatInto(state, "p1", 0);
    expect(activeCardId(retreated, "p1")).toBe("sv06.5-043");
    expect(retreated.players.p1.active?.promotedTurn).toBe(4);
    // Evolve the SAME turn it came up, which is the only turn the stamp is live.
    const withCard = handFromDeck(retreated, "p1", "sv06.5-015", 1);
    const { state: evolved, events } = mustApply(withCard, {
      type: "evolve",
      seat: "p1",
      uid: handUid(withCard, "p1", "sv06.5-015"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(activeCardId(evolved, "p1")).toBe("sv06.5-015");
    // The stamp is UNCHANGED — not re-stamped, not cleared.
    expect(evolved.players.p1.active?.promotedTurn).toBe(4);
    expect(evolved.turn).toBe(4);
    // …and `turnPlayed` DID move, which is the contrast that makes the previous
    // line mean something: evolving resets one and leaves the other alone.
    expect(evolved.players.p1.active?.turnPlayed).toBe(4);
    expect(conditionHolds(evolved, "p1", COND)).toBe(true);
    // The Energy rode up the stack with it (§10), so the clause pays through a
    // REAL attack on the evolution: 20 + 120.
    const { events: attackEvents } = mustApply(evolved, {
      type: "attack",
      seat: "p1",
      index: FLASH_INDEX,
    });
    expect(findEvent(attackEvents, "DAMAGE_DEALT")?.dealt).toBe(140);
  });
});

describe("the board — the clause through a REAL attack", () => {
  it("scores the printed 20 on a Revavroom that never moved (the control)", () => {
    const state = revavroomActive(board(11), "p1");
    expect(state.players.p1.active?.promotedTurn).toBeNull();
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: FLASH_INDEX });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(20);
    // The clause RESOLVED — a false condition is not a skipped effect.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("scores 140 once a REAL retreat has brought it up", () => {
    const retreated = retreatInto(revavroomBenched(board(11), "p1"), "p1", 0);
    expect(retreated.allowances.retreated).toBe(true);
    const { events } = mustApply(retreated, { type: "attack", seat: "p1", index: FLASH_INDEX });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(140);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("scores 140 once a REAL Switch has brought it up", () => {
    // The same number down the OTHER route (`switchInto` rather than `retreat`),
    // because the printed verb is "moved" and says nothing about how.
    const switched = playTrainer(revavroomBenched(board(11), "p1"), "p1", "sv01-194");
    const { events } = mustApply(switched, { type: "attack", seat: "p1", index: FLASH_INDEX });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(140);
  });

  it("pays the OTHER printed amount off the SAME row — Golisopod's 20 + 90 = 110", () => {
    const opened = board(11);
    const control = attachFromDeck(
      setActiveFromDeck(opened, "p1", "swsh10.5-026"),
      "p1",
      "fix-water-energy",
      1,
    );
    expect(activeCardId(control, "p1")).toBe("swsh10.5-026");
    expect(control.players.p1.active?.promotedTurn).toBeNull();
    expect(
      findEvent(
        mustApply(control, { type: "attack", seat: "p1", index: IMPRESSION_INDEX }).events,
        "DAMAGE_DEALT",
      )?.dealt,
    ).toBe(20);
    const armed = retreatInto(golisopodBenched(opened, "p1"), "p1", 0);
    expect(activeCardId(armed, "p1")).toBe("swsh10.5-026");
    expect(armed.players.p1.active?.promotedTurn).toBe(armed.turn);
    const { events } = mustApply(armed, {
      type: "attack",
      seat: "p1",
      index: IMPRESSION_INDEX,
    });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(110);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("is TURN-SCOPED — a retreat LAST turn arms nothing this turn", () => {
    const retreated = retreatInto(revavroomBenched(board(11), "p1"), "p1", 0);
    expect(retreated.turn).toBe(2);
    const backAround = mustApply(mustApply(retreated, { type: "endTurn", seat: "p1" }).state, {
      type: "endTurn",
      seat: "p2",
    }).state;
    expect(backAround.turn).toBe(4);
    // The stamp is STILL 2 — it went stale without anyone rewriting it.
    expect(backAround.players.p1.active?.promotedTurn).toBe(2);
    expect(activeCardId(backAround, "p1")).toBe("sv06.5-015");
    expect(backAround.players.p1.active?.energy).toHaveLength(1); // the body survived the round trip
    const { events } = mustApply(backAround, { type: "attack", seat: "p1", index: FLASH_INDEX });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("arms from EITHER seat — the member is seat-relative, not p1-relative", () => {
    for (const seat of ["p1", "p2"] as const) {
      // P2 acts on turn 3, P1 on turn 2 — one pass apart.
      const opened =
        seat === "p1" ? board(11) : mustApply(board(11), { type: "endTurn", seat: "p1" }).state;
      const bare = revavroomActive(opened, seat);
      expect(
        findEvent(
          mustApply(bare, { type: "attack", seat, index: FLASH_INDEX }).events,
          "DAMAGE_DEALT",
        )?.dealt,
      ).toBe(20);
      const armed = retreatInto(revavroomBenched(opened, seat), seat, 0);
      expect(
        findEvent(
          mustApply(armed, { type: "attack", seat, index: FLASH_INDEX }).events,
          "DAMAGE_DEALT",
        )?.dealt,
      ).toBe(140);
    }
  });

  it("folds BEFORE Weakness (§8.5) — (20 + 120) × 2 = 280", () => {
    const opened = setActiveFromDeck(board(11), "p2", "fix-lightning-weak-big");
    expect(activeCardId(opened, "p2")).toBe("fix-lightning-weak-big");
    const control = revavroomActive(opened, "p1");
    expect(
      findEvent(
        mustApply(control, { type: "attack", seat: "p1", index: FLASH_INDEX }).events,
        "DAMAGE_DEALT",
      )?.dealt,
    ).toBe(40);
    const armed = retreatInto(revavroomBenched(opened, "p1"), "p1", 0);
    const { state: after, events } = mustApply(armed, {
      type: "attack",
      seat: "p1",
      index: FLASH_INDEX,
    });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(280);
    // 280 < 320, so nothing was Knocked Out and the damage is on the board where
    // the arithmetic can be read off it a second time.
    expect(after.players.p2.active?.damage).toBe(280);
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });
});

describe("conditionHolds / conditionNote — the member read directly", () => {
  it("is false with an EMPTY Active Spot", () => {
    // The `active !== null` half of the arm. Reachable in production between a
    // Knock Out and its promotion, so the predicate must answer rather than
    // throw on a `.promotedTurn` read.
    const state = board(11);
    const empty: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(empty.players.p1.active).toBeNull();
    expect(conditionHolds(empty, "p1", COND)).toBe(false);
    expect(conditionHolds(empty, "p2", COND)).toBe(false);
  });

  it("NEEDS NO SEAT GUARD — one board, two seats, per-POKÉMON answers", () => {
    const gusted = playTrainer(revavroomBenched(board(11), "p2"), "p1", "sv02-172");
    expect(gusted.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(conditionHolds(gusted, "p2", COND)).toBe(true); // NOT the turn owner
    expect(conditionHolds(gusted, "p1", COND)).toBe(false); // IS the turn owner
    // …and the mirror board, so neither answer is a constant: P1 retreats into a
    // Revavroom on P1's own turn and the truth values swap sides.
    const retreated = retreatInto(revavroomBenched(board(11), "p1"), "p1", 0);
    expect(conditionHolds(retreated, "p1", COND)).toBe(true);
    expect(conditionHolds(retreated, "p2", COND)).toBe(false);
    // Both boards under one rule, so the pair reads as the single claim it is:
    // on either board, exactly the seat whose Pokémon MOVED answers true.
    for (const [state, movedSeat] of [
      [retreated, "p1"],
      [gusted, "p2"],
    ] as const) {
      expect(conditionHolds(state, movedSeat, COND)).toBe(true);
      expect(conditionHolds(state, other(movedSeat), COND)).toBe(false);
    }
  });

  it("is PHASE-BLIND — a ko:* park does not change either answer", () => {
    const gusted = playTrainer(revavroomBenched(board(11), "p2"), "p1", "sv02-172");
    for (const phase of [
      { kind: "ko:takePrizes", seat: "p1", count: 1 },
      { kind: "ko:promote", seat: "p2" },
      { kind: "setup:place", stage: "opening", ready: { p1: false, p2: false } },
      { kind: "gameOver", outcome: { result: "win", winner: "p1", reason: "prizesTaken" } },
    ] as const) {
      const parked: GameState = { ...gusted, phase };
      expect(conditionHolds(parked, "p2", COND)).toBe(true);
      expect(conditionHolds(parked, "p1", COND)).toBe(false);
    }
    // The ONLY thing that turns it off is the turn counter moving — asserted
    // here by hand so the board case above is not the only witness.
    expect(conditionHolds({ ...gusted, turn: gusted.turn + 1 }, "p2", COND)).toBe(false);
  });

  it("prints the clause with the PRONOUN RESOLVED (D116)", () => {
    expect(conditionNote(COND)).toBe(
      "your Active Pokémon moved from your Bench to the Active Spot this turn",
    );
    expect(ACCELERATOR_FLASH).not.toContain(conditionNote(COND));
    // …but its tail does, byte for byte.
    expect(ACCELERATOR_FLASH).toContain("moved from your Bench to the Active Spot this turn");
    expect(conditionNote(COND).endsWith("moved from your Bench to the Active Spot this turn")).toBe(
      true,
    );
  });
});

describe("purity", () => {
  it("mutates nothing when the condition is read on a frozen board", () => {
    const bare = deepFreeze(revavroomActive(board(11), "p1"));
    expect(conditionHolds(bare, "p1", COND)).toBe(false);
    expect(conditionHolds(bare, "p2", COND)).toBe(false);
    const armed = deepFreeze(retreatInto(revavroomBenched(board(11), "p1"), "p1", 0));
    expect(conditionHolds(armed, "p1", COND)).toBe(true);
    expect(conditionHolds(armed, "p2", COND)).toBe(false);
    // The opponent-board stamp too, since that is the one a seat guard would
    // have had to reach for.
    const gusted = deepFreeze(playTrainer(revavroomBenched(board(11), "p2"), "p1", "sv02-172"));
    expect(conditionHolds(gusted, "p2", COND)).toBe(true);
    expect(conditionHolds(gusted, "p1", COND)).toBe(false);
  });
});
