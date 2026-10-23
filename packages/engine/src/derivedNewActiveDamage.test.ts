import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState } from "./index";
import { applyAction, phaseViewOf } from "./index";
import {
  FIXTURE_POOL,
  NEW_ACTIVE_DAMAGE_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  roundTrip,
} from "./testFixtures";

const CLAUSES = [
  {
    // `sv05-112` Mawile "Invite and Strike", `sv10-091` Primeape "Drag Off"
    // (`sv01-147` Zangoose and `sv03-037` Lampent print it rotated).
    text: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.",
    program: [{ op: "gust" }, { op: "damageNewActive", amount: 30 }] as EffectOp[],
    printings: 4,
    legalPrintings: 2,
  },
  {
    // `sv10.5b-027`/`-111` Cryogonal "Drag Off".
    text: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 20 damage to the new Active Pokémon.",
    program: [{ op: "gust" }, { op: "damageNewActive", amount: 20 }] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    // `sv08-153`/`-214` Braviary "Drag Off".
    text: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 40 damage to the new Active Pokémon.",
    program: [{ op: "gust" }, { op: "damageNewActive", amount: 40 }] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    // `sv06-127` Dipplin "Syrup Catcher".
    text: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 70 damage to the new Active Pokémon.",
    program: [{ op: "gust" }, { op: "damageNewActive", amount: 70 }] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    // `sv07-096` Grimmsnarl "Goad 'n' Grab" — the GATED one, and the family's only
    // printed "If you do".
    text: "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 160 damage to the new Active Pokémon.",
    program: [
      { op: "opponentSwitchOut", recordAs: "moved" },
      { op: "recordGate", slot: "moved", then: [{ op: "damageNewActive", amount: 160 }] },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
] as const;

const GUST_30 = 0;
const GUST_20 = 1;
const GUST_40 = 2;
const GUST_70 = 3;
const GATED = 4;

/** U+2019, spelled as an escape: this pair of characters renders nearly
    identically, so the curly one is always written where a reader can see it. */
const RSQUO = "’";

const GOAD_N_GRAB = 12;
const DRAG_OFF = 13;
const TAUNT = 2;
const KICK_AWAY = 9;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: NEW_ACTIVE_DAMAGE_DECK, p2: NEW_ACTIVE_DAMAGE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`; p2 holds a `fix-bigbody` Active and a Bench
    built from `benched` — the ids are explicit because WHICH body comes up is the
    whole subject of the damage clause. */
function ready(seed: number, benched: readonly string[]): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  for (const id of benched) state = benchFromDeck(state, "p2", id);
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The opponent's bench-index-0 answer, which both parks in this file offer. */
const PICK_FIRST = {
  kind: "pokemon",
  ref: { seat: "p2", spot: { spot: "bench", index: 0 } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

describe("the two anchors — one new op, and the promotion each sentence prints", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 8 legal printings across 5 sentences, from 2 anchors", () => {
    expect(CLAUSES).toHaveLength(5);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(8);
    expect(CLAUSES.reduce((sum, c) => sum + c.printings, 0)).toBe(10);
  });

  it("the AMOUNT is captured, not alternated over the four printed numbers", () => {
    const invented = deriveAttackEffect(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 55 damage to the new Active Pokémon.",
    );
    expect(invented).toEqual([{ op: "gust" }, { op: "damageNewActive", amount: 55 }]);
    // …and on the gated anchor too, so the capture is not a property of one regex.
    expect(
      deriveAttackEffect(
        "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 55 damage to the new Active Pokémon.",
      )?.[1],
    ).toEqual({
      op: "recordGate",
      slot: "moved",
      then: [{ op: "damageNewActive", amount: 55 }],
    });
  });

  it("each arm's ANTECEDENT is the bare sentence's whole program, plus at most a slot", () => {
    // This family's checkable claim, the same one the draw and switch families
    // carry: a "X. Then Y." must be exactly X followed by Y, or the arm is
    // quietly building a different card.
    const [gustHead] = deriveAttackEffect(CLAUSES[GUST_30].text) ?? [];
    expect(gustHead).toEqual({ op: "gust" });
    expect(
      deriveAttackEffect("Switch in 1 of your opponent's Benched Pokémon to the Active Spot."),
    ).toEqual([gustHead]);
    const [gatedHead] = deriveAttackEffect(CLAUSES[GATED].text) ?? [];
    expect(gatedHead).toEqual({ op: "opponentSwitchOut", recordAs: "moved" });
    expect(
      deriveAttackEffect(
        "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
      ),
    ).toEqual([{ op: "opponentSwitchOut" }]);
  });

  it("the CONDITIONAL is read only where it is printed — the two shapes are two programs", () => {
    const kinds = (ops: readonly EffectOp[] | null): string[] => (ops ?? []).map((o) => o.op);
    for (const clause of [CLAUSES[GUST_30], CLAUSES[GUST_20], CLAUSES[GUST_40], CLAUSES[GUST_70]]) {
      expect(kinds(deriveAttackEffect(clause.text)), clause.text).toEqual([
        "gust",
        "damageNewActive",
      ]);
    }
    expect(kinds(deriveAttackEffect(CLAUSES[GATED].text))).toEqual([
      "opponentSwitchOut",
      "recordGate",
    ]);
  });

  it("accepts BOTH apostrophes on both anchors", () => {
    for (const { text, program } of CLAUSES) {
      const curled = text.replaceAll("'", RSQUO);
      expect(curled).not.toBe(text);
      expect(deriveAttackEffect(curled), curled).toEqual(program);
    }
  });

  it("REFUSES the near misses, including the one legal printing the DERIVER leaves unread (BUILT at D574 as a registry row)", () => {
    const residual =
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 120 damage to the new Active Pokémon. If you didn't play Xerosic's Machinations from your hand during this turn, this attack does nothing.";
    expect(deriveAttackEffect(residual)).toBeNull();
    for (const text of [
      // The rotated flip-and-Paralyze compound (`sv03-069` Eelektross), 0 legal.
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 60 damage to the new Active Pokémon, and then flip a coin. If heads, that Pokémon is now Paralyzed.",
      // The two "is now Asleep" riders, 0 legal between them — same first clause,
      // a STATUS consequent rather than a damage one.
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. The new Active Pokémon is now Asleep.",
      "Your opponent chooses 1 of their Benched Pokémon and switches it with their Active Pokémon. The new Active Pokémon is now Asleep.",
      // A gust rider whose amount is not a number, and one with a leading clause —
      // both anchored out, so neither is half-read.
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does some damage to the new Active Pokémon.",
      "If your opponent's Active Pokémon is a Pokémon ex, switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.",
      // …and the ungated sentence with the gated one's promotion op, which is a
      // sentence no card prints and which must not fall through either anchor.
      "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) This attack does 160 damage to the new Active Pokémon.",
      `${CLAUSES[GUST_30].text} Draw a card.`,
      `${CLAUSES[GATED].text} Draw a card.`,
      // …and the `^` on the gated anchor, whose leading-clause witness is likewise
      // constructed (the gust anchor's is real, two rows up).
      `Draw a card. ${CLAUSES[GATED].text}`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

describe("PROVENANCE — both printed shapes on one body, and NEITHER prints base damage", () => {
  it("fields the pair at indices 12-13, appended and not inserted", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks).toHaveLength(73);
    expect(attacks[GOAD_N_GRAB]?.effect).toBe(CLAUSES[GATED].text);
    expect(attacks[DRAG_OFF]?.effect).toBe(CLAUSES[GUST_30].text);
    // The indices this file and its two siblings address by constant did not move.
    expect(attacks[TAUNT]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks[KICK_AWAY]?.effect).toBe(
      "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    );
  });

  it("NO PRINTED BASE DAMAGE on either — the field D227 invented is gone", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks[GOAD_N_GRAB]?.damage).toBeUndefined();
    expect(attacks[DRAG_OFF]?.damage).toBeUndefined();
    // …and the neighbouring index that DOES print a number still does, so this is
    // an assertion about these two rows and not about the fixture being damageless.
    expect(attacks[3]?.damage).toBe(60);
  });
});

describe("end to end — genuine §8.5 damage, on the promoted body", () => {
  it("deals the printed N to the body the CONTROLLER gusted up", () => {
    const state = ready(11, ["fix-basic-1", "fix-basic-1"]);
    const wasActive = activeUid(state, "p2");
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    // Two benched bodies → the gust parks on the CONTROLLER's own pick.
    const parked = mustApply(state, { type: "attack", seat: "p1", index: DRAG_OFF });
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(phaseViewOf(parked.state, "p1").waitingSeat).toBe("p1");
    // Nothing is dealt before the promotion — the clause has no subject yet.
    expect(all(parked.events, "DAMAGE_DEALT")).toHaveLength(0);
    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: PICK_FIRST,
    });
    expect(activeUid(done.state, "p2")).toBe(target);
    const dealt = all(done.events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(target);
    expect(dealt[0]?.uid).not.toBe(wasActive);
    expect(dealt[0]?.dealt).toBe(30);
    expect(done.state.players.p2.active?.damage).toBe(30);
    // …and the displaced body took nothing at all.
    expect(done.state.players.p2.bench[1]?.damage ?? 0).toBe(0);
  });

  it("forces at one candidate and deals in the same action", () => {
    // The M1 no-choice ending, which is also the simplest board this op has.
    const state = ready(12, ["fix-basic-1"]);
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAG_OFF,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeUid(done, "p2")).toBe(target);
    expect(all(events, "DAMAGE_DEALT")[0]?.uid).toBe(target);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("runs the WHOLE §8.5 pipeline on the promoted body — Weakness DOUBLES it", () => {
    const state = ready(13, ["fix-colorless-weak"]);
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAG_OFF,
    });
    expect(activeUid(done, "p2")).toBe(target);
    const dealt = all(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.base).toBe(30);
    expect(dealt[0]?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(dealt[0]?.dealt).toBe(60);
    expect(done.players.p2.active?.damage).toBe(60);
    expect(all(events, "COUNTERS_PLACED")).toHaveLength(0);
  });

  it("the CONTROL: the same promotion with no damage clause deals nothing", () => {
    const state = ready(13, ["fix-colorless-weak"]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TAUNT,
    });
    expect(activeUid(done, "p2")).toBe(state.players.p2.bench[0]?.stack[0]);
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("a lethal rider Knocks Out the promoted body, swept by the attack epilogue", () => {
    const state = ready(14, ["fix-basic-1", "fix-basic-1"]);
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GOAD_N_GRAB });
    const { events } = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: PICK_FIRST,
    });
    expect(all(events, "DAMAGE_DEALT")[0]?.dealt).toBe(160);
    const kos = all(events, "KNOCKED_OUT");
    expect(kos).toHaveLength(1);
    expect(kos[0]?.uid).toBe(target);
    expect(types(events)).toContain("PRIZES_OWED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE WHIFF — where the two printed shapes stop agreeing
// ─────────────────────────────────────────────────────────────────────────────

describe("the EMPTY opponent Bench — the printed 'If you do' is the whole difference", () => {
  it("the UNGATED sentence still deals, to the Active that never moved", () => {
    const state = ready(21, []);
    const wasActive = activeUid(state, "p2");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAG_OFF,
    });
    expect(activeUid(done, "p2")).toBe(wasActive);
    expect(done.phase.kind).not.toBe("effect:choose");
    const dealt = all(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(wasActive);
    expect(dealt[0]?.dealt).toBe(30);
    // The sentence WAS read — the silence is the board's, not the deriver's.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("the GATED sentence deals NOTHING at all", () => {
    const state = ready(21, []);
    const wasActive = activeUid(state, "p2");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: GOAD_N_GRAB,
    });
    expect(activeUid(done, "p2")).toBe(wasActive);
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(done.players.p2.active?.damage).toBe(0);
    // …and it is still not a SKIPPED effect: the engine read the whole sentence
    // and the board had no answer for it.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("…and on a board where the promotion SUCCEEDS the two agree again", () => {
    const state = ready(22, ["fix-bigbody"]);
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GOAD_N_GRAB });
    // One candidate → forced, no question to ask, so this is one action.
    expect(parked.state.phase.kind).not.toBe("effect:choose");
    expect(activeUid(parked.state, "p2")).toBe(target);
    const dealt = all(parked.events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(target);
    expect(dealt[0]?.dealt).toBe(160);
  });

  it("the recording is filed on the PARKED arm too, not only the forced one", () => {
    const state = ready(23, ["fix-colorless-weak", "fix-basic-1"]);
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GOAD_N_GRAB });
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(phaseViewOf(parked.state, "p2").waitingSeat).toBe("p2");
    const { events } = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: PICK_FIRST,
    });
    const dealt = all(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(target);
    // ×2 Colorless on the promoted body, so the number also proves the pipeline
    // ran on the RESUMED path and not only on the forced one — and 320 into 200 HP
    // is lethal, which is why the body is read off the event rather than the board.
    expect(dealt[0]?.dealt).toBe(320);
    expect(all(events, "KNOCKED_OUT")[0]?.uid).toBe(target);
  });

  it("the CONTROL: D227's bare switch-out on the same empty Bench", () => {
    const state = ready(21, []);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(done.phase.kind).not.toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. §11 — the block, on the one board where it can still bite
// ─────────────────────────────────────────────────────────────────────────────

describe("a live §11 block, and the body it can still protect", () => {
  it("does NOT protect the promoted body — it protects the one that left", () => {
    let state = ready(31, ["fix-basic-1"]);
    const shielded = activeUid(state, "p2");
    const target = state.players.p2.bench[0]?.stack[0];
    const p2 = state.players.p2;
    // A wide block on p2's Active, stamped for the turn this attack lands in —
    // the same shape `preventBlock.test.ts` builds its probe board from.
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...p2,
          active:
            p2.active === null
              ? null
              : { ...p2.active, attackBlock: { turn: state.turn, effects: true } },
        },
      },
    };
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAG_OFF,
    });
    // The shielded body moved (the promotion is `untouched` by §11) …
    expect(activeUid(done, "p2")).toBe(target);
    expect(done.players.p2.bench[0]?.stack[0]).toBe(shielded);
    // … and the damage landed on the body that came up, unreduced.
    const dealt = all(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(target);
    expect(dealt[0]?.dealt).toBe(30);
    expect(dealt[0]?.prevented).toBeUndefined();
  });

  it("…and DOES protect it when the promotion whiffed", () => {
    // The one composed board where the block bites: an empty opponent Bench leaves
    // the shielded Active in place, so the ungated clause hits the body the block
    // is about and is nulled to 0 with the flag set.
    let state = ready(32, []);
    const shielded = activeUid(state, "p2");
    const p2 = state.players.p2;
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...p2,
          active:
            p2.active === null
              ? null
              : { ...p2.active, attackBlock: { turn: state.turn, effects: true } },
        },
      },
    };
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAG_OFF,
    });
    expect(activeUid(done, "p2")).toBe(shielded);
    const dealt = all(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(shielded);
    expect(dealt[0]?.dealt).toBe(0);
    expect(dealt[0]?.prevented).toBe(true);
    expect(done.players.p2.active?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE WIRE — the op crosses a park, so it crosses a record
// ─────────────────────────────────────────────────────────────────────────────

describe("the parked program survives a JSON round trip", () => {
  it("replays the gated printing through a serialised continuation", () => {
    const state = ready(41, ["fix-bigbody", "fix-basic-1"]);
    const target = state.players.p2.bench[0]?.stack[0];
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GOAD_N_GRAB });
    const rehydrated = roundTrip(parked.state);
    expect(rehydrated.phase.kind).toBe("effect:choose");
    const resumed = applyAction(rehydrated, {
      type: "resolveEffect",
      seat: "p2",
      choice: PICK_FIRST,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error("expected the resumed action to apply");
    expect(activeUid(resumed.state, "p2")).toBe(target);
    expect(all(resumed.events, "DAMAGE_DEALT")[0]?.dealt).toBe(160);
  });
});
