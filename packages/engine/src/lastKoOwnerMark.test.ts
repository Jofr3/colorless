import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { deriveAttackDamageBonus } from "./effects";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handToDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  trainerCard,
  driveSetup,
} from "./testFixtures";
import { koedDuringOpponentsLastTurn, koedMarksOnOpponentsLastTurn } from "./types";

const LOCAL_CARDS: Record<string, Card> = {
  "fix-rocket-victim": battler("fix-rocket-victim", { hp: 30, name: "Team Rocket's Victim" }),
  "fix-ethan-victim": battler("fix-ethan-victim", { hp: 30, name: "Ethan's Victim" }),
  "fix-plain-victim": battler("fix-plain-victim", { hp: 30, name: "Plain Victim" }),
  "fix-nearmiss-victim": battler("fix-nearmiss-victim", {
    hp: 30,
    name: "Team Rocketeer's Sneasel",
  }),
  "fix-archer": trainerCard(
    "fix-archer",
    "Supporter",
    "You can use this card only if any of your Team Rocket's Pokémon were Knocked Out during your opponent's last turn.\n\nEach player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 3 cards.",
  ),
  "fix-stamp": trainerCard(
    "fix-stamp",
    "Item",
    "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn.\n\nEach player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 2 cards.",
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const OWNER_KO_DECK = deckOf({
  "fix-archer": 4,
  "fix-stamp": 4,
  "fix-sniper": 4,
  "fix-rocket-victim": 4,
  "fix-ethan-victim": 4,
  "fix-plain-victim": 4,
  "fix-nearmiss-victim": 4,
  "fix-basic-1": 4,
  "fix-energy": 28,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: OWNER_KO_DECK, p2: OWNER_KO_DECK }, { pool: POOL, first });
}

function sniperOnP2(seed: number, victim: string, p1Bench: string[] = ["fix-basic-1"]): GameState {
  let state = localSetup(seed, "p1");
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = setActiveFromDeck(state, "p2", "fix-sniper");
  state = attachFromDeck(state, "p2", "fix-energy", 1); // pays Spread Shot [C]
  state = setActiveFromDeck(state, "p1", victim);
  state = clearBench(state, "p1");
  for (const id of p1Bench) state = benchFromDeck(state, "p1", id);
  return state;
}

function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count } = next.phase;
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat,
          prizeIndices: Array.from({ length: count }, (_, i) => i),
        }),
      );
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

/** The whole board arrangement for "P1 lost `victim` to P2's ATTACK on turn 2",
    settled and handed back on P1's turn 3. */
function koedByAttack(seed: number, victim: string): GameState {
  return settle(
    mustApply(sniperOnP2(seed, victim), { type: "attack", seat: "p2", index: 0 }).state,
  );
}

function toHand(state: GameState, seat: Seat, cardId: string): GameState {
  return handFromDeck(handToDeck(state, seat, cardId), seat, cardId, 1);
}

function play(state: GameState, seat: Seat, cardId: string) {
  const next = toHand(state, seat, cardId);
  return applyAction(next, { type: "playTrainer", seat, uid: handUid(next, seat, cardId) });
}

function drawnBy(events: GameEvent[], seat: Seat): number {
  return events
    .filter((e): e is Extract<GameEvent, { type: "CARDS_DRAWN" }> => e.type === "CARDS_DRAWN")
    .filter((e) => e.seat === seat)
    .reduce((total, e) => total + e.uids.length, 0);
}

const BARE = { kind: "yourPokemonKoedOnOpponentsLastTurn" } as const;
const ROCKET = { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Team Rocket" } as const;
const BY_ATTACK = { kind: "yourPokemonKoedOnOpponentsLastTurn", byAttack: true } as const;
const ETHAN_BY_ATTACK = {
  kind: "yourPokemonKoedOnOpponentsLastTurn",
  owner: "Ethan",
  byAttack: true,
} as const;

const SEEDS = [3, 11, 29, 47, 61] as const;

// ── 1. The field itself, before any card reads it ────────────────────────────

describe("GameState.lastKoMarks — the co-stamped record", () => {
  it("starts EMPTY on both seats, and empty is not null", () => {
    const state = localSetup(3, "p1");
    expect(state.lastKoMarks).toEqual({ p1: [], p2: [] });
    expect(koedMarksOnOpponentsLastTurn(state, "p1")).toEqual([]);
    expect(koedMarksOnOpponentsLastTurn(state, "p2")).toEqual([]);
  });

  it("records the NAME and the CAUSE of the body that left play, on the LOSING seat only", () => {
    const koed = koedByAttack(3, "fix-rocket-victim");
    expect(koed.lastKoMarks.p1).toHaveLength(1);
    const mark = koed.lastKoMarks.p1[0];
    if (mark === undefined) throw new Error("unreachable");
    expect(mark.name).toBe("Team Rocket's Victim");
    expect(mark.byAttack).toBe(true);
    expect(mark.uid).toEqual(expect.any(String));
    // The seat that SCORED the KO records nothing. This is the assertion that
    // fails on the natural slip (stamping `attackerSeat`), and it is worthless
    // unless the seat above is checked in the same test.
    expect(koed.lastKoMarks.p2).toEqual([]);
  });

  it("is co-stamped with lastKoTurn — the two fields agree about the window on every seed", () => {
    for (const seed of SEEDS) {
      const koed = koedByAttack(seed, "fix-rocket-victim");
      expect(koed.lastKoTurn.p1).toBe(2);
      expect(koed.turn).toBe(3);
      // The reader returns a NON-empty list exactly when the bare gate is true,
      // on both seats. Not a coincidence — it asks that question first — but a
      // build that gave the marks their own turn field would break here.
      expect(koedDuringOpponentsLastTurn(koed, "p1")).toBe(true);
      expect(koedMarksOnOpponentsLastTurn(koed, "p1")).toHaveLength(1);
      expect(koedDuringOpponentsLastTurn(koed, "p2")).toBe(false);
      expect(koedMarksOnOpponentsLastTurn(koed, "p2")).toEqual([]);
    }
  });

  it("APPENDS a second body lost on the SAME turn — the Active and the Bench together", () => {
    const koed = koedByAttack(3, "fix-rocket-victim");
    const marks = koed.lastKoMarks.p1;
    expect(Array.isArray(marks)).toBe(true);
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks.every((m) => typeof m.name === "string" && typeof m.byAttack === "boolean")).toBe(
      true,
    );
  });

  it("RESTARTS on a later turn rather than accumulating — and nothing clears it in between", () => {
    // P1 loses a Team Rocket's body on turn 2 …
    const first = koedByAttack(3, "fix-rocket-victim");
    expect(first.lastKoMarks.p1.map((m) => m.name)).toEqual(["Team Rocket's Victim"]);
    let later = must(applyAction(first, { type: "endTurn", seat: "p1" })); // P2's turn 4
    later = setActiveFromDeck(later, "p2", "fix-sniper");
    later = attachFromDeck(later, "p2", "fix-energy", 1);
    later = setActiveFromDeck(later, "p1", "fix-plain-victim");
    later = clearBench(later, "p1");
    later = benchFromDeck(later, "p1", "fix-basic-1");
    const second = settle(mustApply(later, { type: "attack", seat: "p2", index: 0 }).state);
    expect(second.lastKoTurn.p1).toBe(4);
    expect(second.lastKoMarks.p1.map((m) => m.name)).toEqual(["Plain Victim"]);
    // And the bare gate is still TRUE — the window reopened, so this is a test of
    // the CONTENTS and not of the window.
    expect(koedDuringOpponentsLastTurn(second, "p1")).toBe(true);
    expect(conditionHolds(second, "p1", ROCKET)).toBe(false);
  });
});

// ── 2. The OWNER narrowing ───────────────────────────────────────────────────

describe("owner — the KO set narrowed to an owner-prefixed subgroup", () => {
  it("is TRUE when a Team Rocket's Pokémon died and FALSE when a plain one did — same board otherwise", () => {
    for (const seed of SEEDS) {
      const rocket = koedByAttack(seed, "fix-rocket-victim");
      const plain = koedByAttack(seed, "fix-plain-victim");
      expect(koedDuringOpponentsLastTurn(rocket, "p1")).toBe(true);
      expect(koedDuringOpponentsLastTurn(plain, "p1")).toBe(true);
      expect(conditionHolds(rocket, "p1", ROCKET)).toBe(true);
      expect(conditionHolds(plain, "p1", ROCKET)).toBe(false);
      // Both seats, both boards: the seat that scored the KO reads FALSE either way.
      expect(conditionHolds(rocket, "p2", ROCKET)).toBe(false);
      expect(conditionHolds(plain, "p2", ROCKET)).toBe(false);
    }
  });

  it("refuses a NEAR-MISS name — the possessive and its trailing space are load-bearing", () => {
    // "Team Rocketeer's Sneasel" starts with "Team Rocket". A prefix test written
    // without the `'s ` — the obvious simplification, and the one a reader
    // skimming `ownerPokemon` would make — answers TRUE here.
    const nearMiss = koedByAttack(11, "fix-nearmiss-victim");
    expect(nearMiss.lastKoMarks.p1[0]?.name).toBe("Team Rocketeer's Sneasel");
    expect(koedDuringOpponentsLastTurn(nearMiss, "p1")).toBe(true);
    expect(conditionHolds(nearMiss, "p1", ROCKET)).toBe(false);
  });

  it("is FALSE once the window closes, even though the marks still name a Team Rocket's body", () => {
    const koed = koedByAttack(3, "fix-rocket-victim");
    expect(conditionHolds(koed, "p1", ROCKET)).toBe(true);
    const later = must(applyAction(koed, { type: "endTurn", seat: "p1" })); // P2's turn 4
    expect(later.turn).toBe(4);
    expect(later.lastKoMarks.p1.map((m) => m.name)).toEqual(["Team Rocket's Victim"]); // still there …
    expect(koedDuringOpponentsLastTurn(later, "p1")).toBe(false); // … but the window shut
    expect(conditionHolds(later, "p1", ROCKET)).toBe(false);
    expect(koedMarksOnOpponentsLastTurn(later, "p1")).toEqual([]);
  });
});

// ── 3. The CAUSE narrowing — the section that catches the dead build ─────────

describe("byAttack — 'by damage from an attack', told apart from a Checkup Knock Out", () => {
  /** P1's Active is Poisoned and left to die in the Pokémon Checkup at the end of
      P2's turn. No attack is used against it at all, so this is the one board on
      which the bare gate and the narrowed gate MUST disagree. */
  function koedByPoison(seed: number, victim: string): GameState {
    let state = localSetup(seed, "p1");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" })); // P2 on turn 2
    state = setActiveFromDeck(state, "p1", victim);
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-basic-1");
    // 30 HP and Poisoned: the Checkup's 10 will not do it in one pass, so the
    // body is brought to 20 damage first and the Checkup finishes it — a KO that
    // happens with `attackerSeat` UNDEFINED, which is the discriminant under test.
    state = setConditions(state, "p1", { poisonDamage: 10 });
    state = setDamage(state, "p1", 20);
    return settle(must(applyAction(state, { type: "endTurn", seat: "p2" })));
  }

  it("the bare gate is TRUE and the narrowed gate is FALSE on a CHECKUP Knock Out — same state, same breath", () => {
    const poisoned = koedByPoison(3, "fix-plain-victim");
    // The body really did leave play during P2's turn …
    expect(poisoned.lastKoTurn.p1).toBe(2);
    expect(poisoned.lastKoMarks.p1[0]?.name).toBe("Plain Victim");
    expect(poisoned.lastKoMarks.p1[0]?.byAttack).toBe(false);
    expect(koedDuringOpponentsLastTurn(poisoned, "p1")).toBe(true);
    expect(conditionHolds(poisoned, "p1", BARE)).toBe(true);
    expect(conditionHolds(poisoned, "p1", BY_ATTACK)).toBe(false);
  });

  it("is TRUE on an ATTACK Knock Out, on every seed, and FALSE for the attacking seat", () => {
    for (const seed of SEEDS) {
      const koed = koedByAttack(seed, "fix-plain-victim");
      expect(koed.lastKoMarks.p1[0]?.byAttack).toBe(true);
      expect(conditionHolds(koed, "p1", BY_ATTACK)).toBe(true);
      expect(conditionHolds(koed, "p2", BY_ATTACK)).toBe(false);
    }
  });
});

// ── 4. The CONJUNCTION — the card that prints both ───────────────────────────

describe("owner AND byAttack together — Ethan's Pinsir's clause", () => {
  it("needs BOTH, and each of the three failing boards fails for its own reason", () => {
    const both = koedByAttack(3, "fix-ethan-victim");
    expect(conditionHolds(both, "p1", ETHAN_BY_ATTACK)).toBe(true);
    // ✗ wrong owner, right cause.
    const wrongOwner = koedByAttack(3, "fix-rocket-victim");
    expect(conditionHolds(wrongOwner, "p1", BY_ATTACK)).toBe(true); // the cause half holds …
    expect(conditionHolds(wrongOwner, "p1", ETHAN_BY_ATTACK)).toBe(false); // … the owner half does not
    // ✗ right owner, wrong cause — and this one needs the Checkup board, which is
    // why the conjunction cannot be tested off attack KOs alone.
    let poisoned = localSetup(3, "p1");
    poisoned = must(applyAction(poisoned, { type: "endTurn", seat: "p1" }));
    poisoned = setActiveFromDeck(poisoned, "p1", "fix-ethan-victim");
    poisoned = clearBench(poisoned, "p1");
    poisoned = benchFromDeck(poisoned, "p1", "fix-basic-1");
    poisoned = setConditions(poisoned, "p1", { poisonDamage: 10 });
    poisoned = setDamage(poisoned, "p1", 20);
    const settled = settle(must(applyAction(poisoned, { type: "endTurn", seat: "p2" })));
    expect(settled.lastKoMarks.p1[0]?.name).toBe("Ethan's Victim");
    expect(
      conditionHolds(settled, "p1", { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Ethan" }),
    ).toBe(true); // the owner half holds …
    expect(conditionHolds(settled, "p1", ETHAN_BY_ATTACK)).toBe(false); // … the cause half does not
  });
});

// ── 5. The SUBSET property, asserted rather than assumed ────────────────────

describe("a narrowed gate is TRUE on a strict subset of the bare gate's boards", () => {
  it("holds on every board this file builds, for both seats", () => {
    const boards: GameState[] = [
      localSetup(3, "p1"),
      koedByAttack(3, "fix-rocket-victim"),
      koedByAttack(11, "fix-plain-victim"),
      koedByAttack(29, "fix-ethan-victim"),
      koedByAttack(47, "fix-nearmiss-victim"),
    ];
    for (const board of boards) {
      for (const seat of ["p1", "p2"] as const) {
        const bare = conditionHolds(board, seat, BARE);
        for (const narrowed of [ROCKET, BY_ATTACK, ETHAN_BY_ATTACK]) {
          // Implication, not equality: the narrowed gate may be false where the
          // bare one is true, but NEVER the other way round. A build whose
          // narrowed reader forgot the window question breaks this and only this.
          if (conditionHolds(board, seat, narrowed)) expect(bare).toBe(true);
        }
      }
    }
  });
});

// ── 6. The printed clauses, round-tripped ───────────────────────────────────

describe("conditionNote — all four shapes render the words their cards print", () => {
  it("round-trips the bare clause unchanged — D271's three printings are untouched", () => {
    expect(conditionNote(BARE)).toBe(
      "any of your Pokémon were Knocked Out during your opponent's last turn",
    );
  });

  it("round-trips the owner clause — Team Rocket's Archer's own sentence", () => {
    expect(conditionNote(ROCKET)).toBe(
      "any of your Team Rocket's Pokémon were Knocked Out during your opponent's last turn",
    );
  });

  it("round-trips the cause clause — the five plain revenge attacks", () => {
    expect(conditionNote(BY_ATTACK)).toBe(
      "any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn",
    );
  });

  it("round-trips BOTH at once, in PRINTED order — Ethan's Pinsir", () => {
    // Assembled in printed order rather than appended, so this is one sentence
    // and not two fragments joined: the owner sits inside the noun phrase and the
    // cause sits between the verb and the window.
    expect(conditionNote(ETHAN_BY_ATTACK)).toBe(
      "any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn",
    );
  });
});

// ── 7. The card ─────────────────────────────────────────────────────────────

describe("Team Rocket's Archer sv10-170/-223 — the gate plus the printed 5/3", () => {
  it("is registered on BOTH real ids with the owner-gated condition and the 5/3 pair", () => {
    expect(programFor("sv10-170")).toEqual({
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Team Rocket" },
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
    });
    expect(programFor("sv10-223")).toEqual(programFor("sv10-170"));
  });

  it("is REFUSED when a PLAIN Pokémon died and ACCEPTED when a Team Rocket's one did", () => {
    const plain = koedByAttack(3, "fix-plain-victim");
    const refused = play(plain, "p1", "fix-archer");
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected the play to be refused");
    expect(refused.error.code).toBe("PLAY_CONDITION_NOT_MET");
    expect(refused.error.message).toContain(
      "any of your Team Rocket's Pokémon were Knocked Out during your opponent's last turn",
    );

    const rocket = koedByAttack(3, "fix-rocket-victim");
    expect(play(rocket, "p1", "fix-archer").ok).toBe(true);
  });

  it("draws 5 to the controller and THREE to the opponent — the one number that separates it from Unfair Stamp", () => {
    for (const seed of SEEDS) {
      const rocket = koedByAttack(seed, "fix-rocket-victim");
      const before = { p1: rocket.players.p1.hand.length, p2: rocket.players.p2.hand.length };
      expect(before.p1).toBeGreaterThan(0);
      expect(before.p2).toBeGreaterThan(0);

      const archer = play(rocket, "p1", "fix-archer");
      expect(archer.ok).toBe(true);
      if (!archer.ok) throw new Error("unreachable");
      expect(drawnBy(archer.events, "p1")).toBe(5);
      expect(drawnBy(archer.events, "p2")).toBe(3);

      // And the sibling on the SAME board still draws 2 — the two cards read off
      // their own D1 rows and not off each other.
      const stamp = play(rocket, "p1", "fix-stamp");
      expect(stamp.ok).toBe(true);
      if (!stamp.ok) throw new Error("unreachable");
      expect(drawnBy(stamp.events, "p1")).toBe(5);
      expect(drawnBy(stamp.events, "p2")).toBe(2);
    }
  });
});

// ── 8. The record — driven, not asserted ────────────────────────────────────

describe("MATCH_RECORD_VERSION — the derivation, driven by a replay", () => {
  it("a version-18 state cannot replay this gate — the soft landing is not on offer", () => {
    const koed = koedByAttack(3, "fix-rocket-victim");
    expect(play(koed, "p1", "fix-archer").ok).toBe(true);

    // The version-18 shape: the same board, minus the key that deploy never wrote.
    const legacy: Partial<GameState> = { ...koed };
    // biome-ignore lint/performance/noDelete: reproducing a persisted shape requires the key to be ABSENT, not undefined.
    delete legacy.lastKoMarks;
    expect("lastKoMarks" in legacy).toBe(false);
    expect("lastKoTurn" in legacy).toBe(true);

    // AND IT DOES NOT LAND SOFTLY. The reader INDEXES the record before it
    // compares, so the gate does not read "nothing happened" — it throws.
    const resumed = legacy as GameState;
    expect(() => koedMarksOnOpponentsLastTurn(resumed, "p1")).toThrow();
    // The BARE gate still answers, which is the sharp edge: a build that shipped
    // without the bump would look healthy on Unfair Stamp and Hassel and fall
    // over only when somebody reached for Archer.
    expect(koedDuringOpponentsLastTurn(resumed, "p1")).toBe(true);
  });
});

describe("CONDITIONAL_DAMAGE_CLAUSES — the revenge clause maps to the NARROWED condition", () => {
  const PLAIN =
    "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 90 more damage.";
  const ETHAN =
    "If any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage.";

  it("the five plain printings resolve to the CAUSE-narrowed condition, not D271's bare one", () => {
    // Alolan Marowak sv09-057 "Retaliate" (30+, +90); Revavroom sv06-125 "Rally
    // Back" prints the identical clause at the identical amount, and Iron Leaves
    // and the two Terrakion differ only in the OUTER amount the skeleton captures.
    expect(deriveAttackDamageBonus(PLAIN)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: BY_ATTACK },
    });
    expect(deriveAttackDamageBonus(PLAIN)?.count).not.toEqual({
      kind: "boardCondition",
      cond: BARE,
    });
  });

  it("Ethan's Pinsir resolves to BOTH narrowings — the conjunction survives the table", () => {
    expect(deriveAttackDamageBonus(ETHAN)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: ETHAN_BY_ATTACK },
    });
  });

  it("the OWNER-LESS and CAUSE-LESS spellings resolve to NOTHING — the anchor is the whole sentence", () => {
    expect(
      deriveAttackDamageBonus(
        "If any of your Pokémon were Knocked Out during your opponent's last turn, this attack does 90 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If any of your Ethan's Pokémon were Knocked Out during your opponent's last turn, this attack does 100 more damage.",
      ),
    ).toBeNull();
  });
});
