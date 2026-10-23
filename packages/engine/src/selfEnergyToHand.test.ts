import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackGateClause,
} from "./effects";
import type { GameState, Seat } from "./index";
import {
  SELF_ENERGY_HAND_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const READERS: readonly ((t: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

const TAKEN = "Put an Energy attached to this Pokémon into your hand.";

const MAY_TWIN =
  "You may put an Energy attached to your opponent's Active Pokémon into their hand.";

const ALL_FOR_DAMAGE =
  "You may put all Energy attached to this Pokémon into your hand to have this attack do 80 more damage.";
const ALL_FOR_DAMAGE_DOES =
  "You may put all Energy attached to this Pokémon into your hand to have this attack does 80 more damage.";

/** The PROGRAM, spelled once so no case can pass against a hand-copied literal that has
    drifted from what this file means by it. */
const PROGRAM = [
  { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, to: "hand" },
];

describe("D405 §1 — the sentence, measured live over the legal column", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("is really in the column, ONCE, at FIVE printings — raw AND split-aware", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === TAKEN);
    expect([rows.length, units(rows)]).toEqual([1, 5]);
    expect(splitAttackGateClause(TAKEN)).toBeNull();
    const split = legalAttackCorpus().filter(([, s]) => {
      const gate = splitAttackGateClause(s);
      return (gate === null ? s : gate.body) === TAKEN;
    });
    expect([split.length, units(split)]).toEqual([1, 5]);
  });

  it("the arm is its ONLY reader — the other ELEVEN refuse it", () => {
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(TAKEN), read.name).toBeNull();
    }
  });

  it("the column prints ONE quantifier on this skeleton, and it is 'an'", () => {
    const family = legalAttackCorpus().filter(([, s]) =>
      /Energy attached to this Pokémon into your hand/.test(s),
    );
    expect(family.map(([, s]) => s).sort()).toEqual([ALL_FOR_DAMAGE, TAKEN].sort());
    expect(units(family)).toBe(6);
    // …so a numeric spelling would resolve a sentence nobody prints (D190b).
    expect(deriveAttackEffect("Put 2 Energy attached to this Pokémon into your hand.")).toBeNull();
  });

  it("the ALL-for-damage compound is a real printing — D524: read by EXACTLY ONE reader (`deriveAttackOptionalCostBoost`), still refused by the other twelve and by THIS arm, with a one-token control that stays refused", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === ALL_FOR_DAMAGE);
    expect([rows.length, units(rows)]).toEqual([1, 1]);
    expect(resolvedByAnyReader(ALL_FOR_DAMAGE), ALL_FOR_DAMAGE).toBe(true);
    for (const read of READERS) {
      if (read === deriveAttackOptionalCostBoost)
        expect(read(ALL_FOR_DAMAGE), read.name).not.toBeNull();
      else expect(read(ALL_FOR_DAMAGE), read.name).toBeNull();
    }
    expect(deriveAttackEffect(ALL_FOR_DAMAGE)).toBeNull();
    expect(legalAttackCorpus().some(([, s]) => s === ALL_FOR_DAMAGE_DOES)).toBe(false);
    expect(resolvedByAnyReader(ALL_FOR_DAMAGE_DOES), ALL_FOR_DAMAGE_DOES).toBe(false);
    for (const read of READERS) expect(read(ALL_FOR_DAMAGE_DOES), read.name).toBeNull();
  });
});

describe("D405 §2 — the program, and the two producers that must NOT be confused", () => {
  it("derives ONE already-shipped op with ONE already-shipped destination", () => {
    expect(deriveAttackEffect(TAKEN)).toEqual(PROGRAM);
  });

  it("NO `optional` WRAPPER — and the declinable twin still HAS one", () => {
    const mine = deriveAttackEffect(TAKEN) as { op: string }[];
    expect(mine.map((op) => op.op)).toEqual(["discardEnergy"]);
    const twin = deriveAttackEffect(MAY_TWIN) as { op: string; then?: unknown[] }[];
    expect(twin.map((op) => op.op)).toEqual(["optional"]);
    expect(twin[0]?.then).toEqual([
      { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" }, to: "hand" },
    ]);
  });

  it("the absent `count` is the printed article, and it is ABSENT rather than 1", () => {
    const [op] = deriveAttackEffect(TAKEN) as Record<string, unknown>[];
    expect(op).toBeDefined();
    expect(Object.hasOwn(op ?? {}, "count")).toBe(false);
    // …and the bare self-discard, which differs ONLY in the destination.
    expect(deriveAttackEffect("Discard an Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
  });
});

describe("D405 §3 — the refusals, each pinned on ONE printed token this anchor OWNS", () => {
  it("the POSSESSIVE, the ARTICLE, the SUBJECT and the VERB refuse INDEPENDENTLY", () => {
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
    // …the POSSESSIVE alone. "their hand" is the OPPONENT's zone, which is the twin's
    // destination on the twin's `from`; reading it here would put the attacker's own
    // Energy into the other player's hand.
    expect(
      deriveAttackEffect("Put an Energy attached to this Pokémon into their hand."),
    ).toBeNull();
    expect(deriveAttackEffect("Put an Energy attached to this Pokémon into your deck.")).toBeNull();
    // …the SUBJECT alone: "your opponent's Active Pokémon" is a different body and a
    // different `from`, and this arm has no branch that could aim there.
    expect(
      deriveAttackEffect(
        "Put an Energy attached to your opponent's Active Pokémon into your hand.",
      ),
    ).toBeNull();
    // …the VERB alone: "Discard" is arms 7/8/9's sentence and has no `to` at all.
    expect(
      deriveAttackEffect("Discard an Energy attached to this Pokémon into your hand."),
    ).toBeNull();
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing clause is refused", () => {
    for (const text of [
      `Draw a card. ${TAKEN}`,
      `${TAKEN} Then, shuffle your deck.`,
      `${TAKEN} If you do, this attack does 60 more damage.`,
      `You may ${TAKEN[0]?.toLowerCase()}${TAKEN.slice(1)}`,
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      TAKEN.toLowerCase(),
      TAKEN.toUpperCase(),
      // The trailing period is required — the failure mode this repo names first,
      // because a regex written from a paraphrase matches no real card.
      "Put an Energy attached to this Pokémon into your hand",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. One fixture, and the ATTACHED Energy is the instrument.
// ─────────────────────────────────────────────────────────────────────────────

const attack = { type: "attack", seat: "p1", index: 0 } as const;

function activeEnergy(state: GameState, seat: Seat): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

function board(
  seed: number,
  attached: readonly string[],
  attacker = "fix-selfenergyhand",
): GameState {
  const setup = driveSetup(
    seed,
    { p1: SELF_ENERGY_HAND_DECK, p2: SELF_ENERGY_HAND_DECK },
    { first: "p2" },
  );
  let state = mustApply(setup, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attacker);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  for (const id of attached) state = attachFromDeck(state, "p1", id, 1);
  return state;
}

describe("D405 §4 — the FORCED board: one Energy, no prompt, and the card lands in the HAND", () => {
  it("resolves inline and the Energy is in the ATTACKER'S OWN HAND, in neither pile", () => {
    const state = board(11, ["fix-energy"]);
    const [uid] = activeEnergy(state, "p1");
    expect(uid).toBeDefined();
    deepFreeze(state);

    const { state: done, events } = mustApply(state, attack);

    // The op asked NOTHING — one candidate is no decision (the M1 rule), so the whole
    // program resolved inside the attack and the turn is already over.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).toContain("ENERGY_DISCARDED");
    expect(activeEnergy(done, "p1")).toEqual([]);
    expect(done.players.p1.hand).toContain(uid);
    expect(done.players.p1.discard).not.toContain(uid);
    expect(done.players.p2.hand).not.toContain(uid);
    expect(done.players.p2.discard).not.toContain(uid);
  });

  it("the event names the victim, the actor and the DESTINATION", () => {
    const { events } = mustApply(board(12, ["fix-energy"]), attack);
    const row = findEvent(events, "ENERGY_DISCARDED");
    // The victim IS the actor here — `discardVictimSeat` returns the controller for
    // `yourActive`, which is what makes the printed "your hand" need no seat branch.
    expect(row).toMatchObject({ seat: "p1", actor: "p1", from: { spot: "active" }, to: "hand" });
  });

  it("the printed 30 still lands — nothing here is a damage reader", () => {
    // `programDamage` stays FALSE (neither op is a `damageDefender`), so the flat base
    // must survive §8.5 untouched. A base that ever came back 0 would mean a reader had
    // claimed a number this sentence never spends.
    const { state: done, events } = mustApply(board(13, ["fix-energy"]), attack);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 30 });
    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("D405 §5 — the PARK: a real decision, and exactly ONE card comes off", () => {
  it("two DIFFERENT prints park with scope `total 1` — the absent count, read", () => {
    const state = board(14, ["fix-energy", "fix-lightning-energy"]);
    const attached = activeEnergy(state, "p1");
    expect(attached).toHaveLength(2);
    deepFreeze(state);

    const { state: parked } = mustApply(state, attack);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.scope).toEqual({ kind: "total", count: 1 });
    expect(parked.phase.prompt.discardable.map((d) => d.uid).sort()).toEqual([...attached].sort());
    // Nothing has moved yet — the pick is a decision, not a formality.
    expect(activeEnergy(parked, "p1")).toEqual(attached);

    const chosen = attached[1] as string;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });
    // EXACTLY ONE came off, and it is the one that was PICKED — the other stayed put.
    expect(done.players.p1.hand).toContain(chosen);
    expect(activeEnergy(done, "p1")).toEqual([attached[0]]);
    expect(done.players.p1.discard).not.toContain(chosen);
  });

  it("two IDENTICAL prints do NOT park — the interchangeable collapse", () => {
    const state = board(15, ["fix-energy", "fix-energy"]);
    expect(activeEnergy(state, "p1")).toHaveLength(2);
    const { state: done } = mustApply(state, attack);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeEnergy(done, "p1")).toHaveLength(1);
    expect(
      done.players.p1.hand.filter((uid) => done.cardIdByUid[uid] === "fix-energy").length,
    ).toBeGreaterThan(0);
  });

  it("the filter is `anyEnergy` — a SPECIAL Energy on the attacker is OFFERED", () => {
    const state = board(16, ["fix-energy", "fix-special"]);
    const special = activeEnergy(state, "p1").find(
      (uid) => state.cardIdByUid[uid] === "fix-special",
    );
    expect(special).toBeDefined();
    const { state: parked } = mustApply(state, attack);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.discardable.map((d) => d.uid)).toContain(special);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [special as string] },
    });
    expect(done.players.p1.hand).toContain(special);
  });
});

describe("D405 §6 — the ORDER of the tail, and the turn that follows", () => {
  it("the op runs at the attack's TAIL and the epilogue is queued BEHIND the park", () => {
    const state = board(17, ["fix-energy", "fix-lightning-energy"]);
    const { state: parked, events: attackEvents } = mustApply(state, attack);
    // Damage first, then the decision — and the turn has NOT ended.
    expect(types(attackEvents)).toContain("DAMAGE_DEALT");
    expect(types(attackEvents)).not.toContain("ENERGY_DISCARDED");
    expect(types(attackEvents)).not.toContain("TURN_ENDED");
    expect(parked.pending.map((stage) => stage.kind)).toEqual(["attackEpilogue"]);

    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const chosen = parked.phase.prompt.discardable[0]?.uid as string;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });
    // …and only THEN the §5.3 tail ran, in one batch.
    expect(types(events)).toEqual([
      "ENERGY_DISCARDED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });
});

describe("D405 §7 — the CAPTION, which is the falsifier that FIRED", () => {
  it("the prompt is the PRINTED SENTENCE, not the word 'Discard'", () => {
    const state = board(18, ["fix-energy", "fix-lightning-energy"]);
    const { state: parked } = mustApply(state, attack);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.note).toBe(TAKEN);
  });

  it("THE CONTROL: the BARE self-discard's caption is UNMOVED, on the same arm", () => {
    const state = board(19, ["fix-fire-energy", "fix-energy"], "sv01-039");
    const { state: parked } = mustApply(state, attack);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.note).toBe("Discard an Energy from this Pokémon.");
    // …and the Energy really does land in the PILE for that card, not in the hand —
    // the destination and the caption move together or the pair proves nothing.
    const chosen = parked.phase.prompt.discardable[0]?.uid as string;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });
    expect(done.players.p1.discard).toContain(chosen);
    expect(done.players.p1.hand).not.toContain(chosen);
  });
});
