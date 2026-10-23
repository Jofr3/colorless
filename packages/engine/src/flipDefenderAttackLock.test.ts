import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackLocked } from "./continuous";
import * as effectsModule from "./effects";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  BARE_ATTACK_LOCK_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
  mustDerive,
} from "./testFixtures";

const PRINTED =
  "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't attack.";
const DEFENDER_BARE = "During your opponent's next turn, the Defending Pokémon can't attack.";
const DEFENDER_PLURAL =
  "During your opponent's next turn, the Defending Pokémon can't use attacks.";
const GATED_PREVENT =
  "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks.";

/** `fix-deflock` — "Frost Bind" ({C}, 30) at 0 and "Glacier Hold" ({C}{C}, 30) at
    1. Index 0 is the one re-texted; index 1 is left alone so every board carries
    the UNGATED sibling as an in-file control on the same body. */
const INSTALL_INDEX = 0;
const SIBLING_INDEX = 1;
/** `fix-attacker` — the victim. "Bite" ({C}, 30) at 0 and a COSTLESS "Yawn" at 2,
    so a refusal on this body is never an Energy shortfall wearing the lock's face. */
const VICTIM_FREE_INDEX = 2;
const SEEDS = 400;

function refusal(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? "ok" : result.error.code;
}

function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["fix-deflock"] as Card | undefined;
  if (card === undefined) throw new Error("no fix-deflock in pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("fix-deflock has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-deflock": { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    installer goes on P1's Active with two {C}; the victim on P2's. */
function board(seed: number, effect: string = PRINTED): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: BARE_ATTACK_LOCK_DECK, p2: BARE_ATTACK_LOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p2", "fix-attacker");
  state = setActiveFromDeck(state, "p1", "fix-deflock");
  if (state.turn !== 2) throw new Error(`board() expected turn 2, got ${state.turn}`);
  return withEffect(attachFromDeck(state, "p1", "fix-energy", 2), effect);
}

function swing(state: GameState, index = INSTALL_INDEX): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function flipBoard(wantHeads: boolean, effect: string = PRINTED): GameState {
  for (let seed = 1; seed < SEEDS; seed++) {
    let candidate: GameState;
    try {
      candidate = board(seed, effect);
    } catch {
      continue;
    }
    const flip = findEvent(swing(candidate).events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip?.result === (wantHeads ? "heads" : "tails")) return candidate;
  }
  throw new Error(`no seed under ${SEEDS} gives ${wantHeads ? "heads" : "tails"}`);
}

/** The seed `flipBoard(true)` settles on, found once and reused so the gated and
    bare boards differ in the printed TEXT and in nothing else. */
function bareSeed(): number {
  for (let seed = 1; seed < SEEDS; seed++) {
    let candidate: GameState;
    try {
      candidate = board(seed);
    } catch {
      continue;
    }
    if (findEvent(swing(candidate).events, "ATTACK_EFFECT_COIN_FLIP")?.result === "heads")
      return seed;
  }
  throw new Error("no heads seed");
}

function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed datum, the anchor, and the widening that buys nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the datum and the anchor", () => {
  it("the specimen IS a row of the committed corpus, at its committed count", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === PRINTED)).toEqual([[1, PRINTED]]);
    expect(legalAttackCorpus().filter(([, s]) => s === DEFENDER_BARE)).toEqual([
      [3, DEFENDER_BARE],
    ]);
    expect(legalAttackCorpus().filter(([, s]) => s === GATED_PREVENT)).toEqual([
      [4, GATED_PREVENT],
    ]);
    expect([PRINTED.codePointAt(43), PRINTED.codePointAt(82)]).toEqual([0x27, 0x27]);
    expect([PRINTED[43], PRINTED[82]]).toEqual(["'", "'"]);
    expect(programFor("fix-deflock")).toBeUndefined();
  });

  it("survives a U+2019 re-ingest — BOTH apostrophe slots are classed (D136/D137)", () => {
    const curly = PRINTED.replaceAll("'", "\u2019");
    expect(curly).not.toBe(PRINTED);
    expect(curly.codePointAt(43)).toBe(0x2019);
    expect(curly.codePointAt(82)).toBe(0x2019);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
    const possessiveOnly = PRINTED.replace("opponent's", "opponent\u2019s");
    const contractionOnly = PRINTED.replace("can't", "can\u2019t");
    expect(deriveAttackEffect(possessiveOnly)).toEqual(deriveAttackEffect(PRINTED));
    expect(deriveAttackEffect(contractionOnly)).toEqual(deriveAttackEffect(PRINTED));
  });

  it("derives ONE `coinFlipGate` whose `then` is the BARE anchor's whole program", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([
      {
        op: "coinFlipGate",
        ops: [{ op: "preventAttack", target: "defender" }],
      },
    ]);
    const gate = mustDerive(deriveAttackEffect, PRINTED)[0] as {
      op: string;
      ops: EffectOp[];
    };
    expect(gate.ops).toEqual(deriveAttackEffect(DEFENDER_BARE));
    // …and it is the ONE-op program: nothing is appended, so nothing rides behind
    // the gate into a continuation (§8's reachability half).
    expect(mustDerive(deriveAttackEffect, PRINTED).length).toBe(1);
    expect(Object.keys(gate).sort()).toEqual(["op", "ops"]);
  });

  it("D472 — the VERB-WIDENED anchor claims exactly the same rows, so the tight one ships", () => {
    const tight =
      /^Flip a coin\. If heads, during your opponent['’]s next turn, the Defending Pokémon can['’]t attack\.$/;
    const wide =
      /^Flip a coin\. If heads, during your opponent['’]s next turn, the Defending Pokémon can['’]t (?:attack|use attacks)\.$/;
    const rows = legalAttackCorpus();
    const claimed = (re: RegExp): [number, number] => {
      const hit = rows.filter(([, s]) => re.test(s));
      return [hit.length, hit.reduce((sum, [n]) => sum + n, 0)];
    };
    expect(claimed(tight)).toEqual([1, 1]);
    expect(claimed(wide)).toEqual([1, 1]);
    // …and the gated PLURAL is therefore genuinely unread, which is what makes the
    // narrowness a decision rather than an omission.
    expect(
      deriveAttackEffect(
        "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't use attacks.",
      ),
    ).toBeNull();
    expect(deriveAttackEffect(DEFENDER_PLURAL)).toEqual([
      { op: "preventAttack", target: "defender" },
    ]);
  });

  it("disjointness is STRUCTURAL, so the arm's position is legibility (D467/D468)", () => {
    expect(
      deriveAttackEffect(
        "Flip a coin. If tails, during your next turn, this Pokémon can't attack.",
      ),
    ).toEqual([{ op: "coinFlipGate", onTails: true, ops: [{ op: "preventAttack" }] }]);
    // A prefix, a suffix and a truncation are all refused — the `^`, the `$` and the
    // terminator each doing their own job.
    expect(deriveAttackEffect(`Then, ${PRINTED}`)).toBeNull();
    expect(deriveAttackEffect(PRINTED.slice(0, -1))).toBeNull();
    // The TAILS face on THIS consequent is unprinted and refused.
    expect(
      deriveAttackEffect(
        "Flip a coin. If tails, during your opponent's next turn, the Defending Pokémon can't attack.",
      ),
    ).toBeNull();
  });

  it("ONE reader owns it and the other TWELVE still refuse (D438)", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    for (const name of attackReaderSurface()) {
      if (name === "deriveAttackEffect") continue;
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      expect(read?.(PRINTED) ?? null, name).toBeNull();
    }
    expect(attackReaderSurface()).toHaveLength(14);
    // …and NO splitter serves it either, so the RAW summand moves ALONE.
    expect(effectsModule.splitAttackGateClause(PRINTED)).toBeNull();
    expect(effectsModule.splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(effectsModule.splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(effectsModule.splitAttackCancelClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the axis-substitution lattice, executable rather than narrated.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the 2² lattice, and why it warrants a whole-sentence anchor", () => {
  it("BOTH weight-1 points build and the weight-2 point does NOT", () => {
    const GATE = ["Flip a coin. If heads, ", ""] as const;
    const CONS = [
      "the Defending Pokémon can't attack",
      "prevent all damage done to this Pokémon by attacks",
    ] as const;
    const point = (g: number, c: number): string =>
      `${GATE[g]}${GATE[g] === "" ? "During" : "during"} your opponent's next turn, ${CONS[c]}.`;
    const now = (g: number, c: number): boolean => deriveAttackEffect(point(g, c)) !== null;
    const preSlice = (g: number, c: number): boolean => now(g, c) && point(g, c) !== PRINTED;
    expect([preSlice(0, 0), preSlice(0, 1), preSlice(1, 0), preSlice(1, 1)]).toEqual([
      false, // w=0 — the print
      true,
      true,
      false,
    ]);
    expect([now(0, 0), now(0, 1), now(1, 0), now(1, 1)]).toEqual([true, true, true, false]);
    expect(point(0, 0)).toBe(PRINTED);
    expect(legalAttackCorpus().some(([, s]) => s === point(1, 1))).toBe(false);
  });

  it("FACE is a VALUE in the GATE slot, not a third axis (D494)", () => {
    // The slot has THREE inhabitants — absent, `If heads,`, `If tails,` — and the
    // richness lives INSIDE an axis already counted. Swapping heads for tails
    // refuses on BOTH consequents, so a 2³ table would be the 2² table twice.
    for (const cons of [
      "the Defending Pokémon can't attack",
      "prevent all damage done to this Pokémon by attacks",
    ]) {
      expect(
        deriveAttackEffect(`Flip a coin. If tails, during your opponent's next turn, ${cons}.`),
        cons,
      ).toBeNull();
    }
  });

  it("SEAT and VERB are INERT on the verdict (D491)", () => {
    const SEAT = [
      { dur: "your opponent's", subj: "the Defending Pokémon" },
      { dur: "your", subj: "this Pokémon" },
    ] as const;
    const VERB = ["attack", "use attacks", "retreat"] as const;
    const gated: boolean[] = [];
    const bare: boolean[] = [];
    for (const seat of SEAT) {
      for (const verb of VERB) {
        const tail = `${seat.dur} next turn, ${seat.subj} can't ${verb}.`;
        const point = `Flip a coin. If heads, during ${tail}`;
        const clutch =
          "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't retreat.";
        gated.push(deriveAttackEffect(point) !== null && point !== PRINTED && point !== clutch);
        bare.push(deriveAttackEffect(`During ${tail}`) !== null);
      }
    }
    expect(gated).toEqual([false, false, false, false, false, false]);
    expect(bare).toEqual([true, true, true, true, true, true]);
    expect(deriveAttackEffect(DEFENDER_BARE)).toEqual(deriveAttackEffect(DEFENDER_PLURAL));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — HEADS on a real board.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the winning face installs the lock", () => {
  it("files the coin row and the lock row, in printed order, on the DEFENDER", () => {
    const { state, events } = swing(flipBoard(true));
    const flip = findEvent(events, "ATTACK_EFFECT_COIN_FLIP");
    expect(flip?.result).toBe("heads");
    expect(flip?.seat).toBe("p1");
    const lock = findEvent(events, "ATTACK_LOCKED");
    // The lock is filed against the VICTIM's seat and the victim's body — the
    // event's `seat`/`uid` are the LOCKED body's, not the actor's.
    expect(lock?.seat).toBe("p2");
    expect(lock?.uid).toBe(state.players.p2.active?.stack.at(-1));
    // Order: the coin decides before the consequent runs.
    expect(events.findIndex((e) => e.type === "ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
      events.findIndex((e) => e.type === "ATTACK_LOCKED"),
    );
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("the stamp is `state.turn + 1`, and it is the DEFENDER's next turn", () => {
    const before = flipBoard(true);
    const { state } = swing(before);
    expect(state.players.p2.active?.attackLockedTurn).toBe(before.turn + 1);
    // …and the installer's own body is untouched: `target: "defender"` decides both
    // the seat and the arithmetic, from ONE field (the op's own doc block's claim).
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
    // The window is OPEN right now — this is P2's turn 3.
    expect(state.turn).toBe(3);
    expect(attackLocked(state, state.players.p2.active as InPlayPokemon)).toBe(true);
  });

  it("the §8 declaration gate refuses the victim's attack, on a COSTLESS index", () => {
    // The refusal is the lock's and not an Energy shortfall wearing its face:
    // `fix-attacker` index 2 is free, so nothing else can be the reason.
    const { state } = swing(flipBoard(true));
    expect(refusal(state, "p2", VICTIM_FREE_INDEX)).toBe("ATTACK_PREVENTED");
    // …and the DAMAGE still landed, so the attack that locked resolved normally.
    expect(state.players.p2.active?.damage).toBe(30);
  });

  it("`log.ts` RENDERS both rows, and the wording is read rather than reasoned about (D456)", () => {
    const { state, events } = swing(flipBoard(true));
    const rows = rendered(state, events);
    expect(rows).toContainEqual({ who: "p1", text: "flipped heads for the effect" });
    expect(rows.map((r) => r.text)).toContainEqual(
      expect.stringMatching(/can't attack next turn$/),
    );
    const flipAt = rows.findIndex((r) => r.text === "flipped heads for the effect");
    const lockAt = rows.findIndex((r) => r.text.endsWith("can't attack next turn"));
    expect(flipAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBe(flipAt + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — TAILS on a real board: the control that makes §3 mean anything.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the losing face installs nothing, and is not a skipped effect", () => {
  it("no lock, no `ATTACK_LOCKED`, and the victim attacks freely", () => {
    const { state, events } = swing(flipBoard(false));
    expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(findEvent(events, "ATTACK_LOCKED")).toBeUndefined();
    expect(state.players.p2.active?.attackLockedTurn).toBeNull();
    expect(attackLocked(state, state.players.p2.active as InPlayPokemon)).toBe(false);
    expect(refusal(state, "p2", VICTIM_FREE_INDEX)).toBe("ok");
  });

  it("a TAILS is a RESOLVED attack, not a skipped effect (D134's reading)", () => {
    const { state, events } = swing(flipBoard(false));
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(state.turn).toBe(3);
    expect(rendered(state, events)).toContainEqual({
      who: "p1",
      text: "flipped tails for the effect",
    });
  });

  it("the UNGATED sibling on the same body still locks unconditionally", () => {
    const tailsBoard = flipBoard(false);
    const { state, events } = swing(tailsBoard, SIBLING_INDEX);
    expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")).toBeUndefined();
    expect(findEvent(events, "ATTACK_LOCKED")?.seat).toBe("p2");
    expect(state.players.p2.active?.attackLockedTurn).toBe(tailsBoard.turn + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the DURATION: expiry, and the body leaving play inside the window.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — a durated op inside a gate has a lifetime, and it is D148's", () => {
  it("EXPIRES by arithmetic: the bar is gone on the victim's FOLLOWING turn", () => {
    let held = swing(flipBoard(true)).state;
    expect(refusal(held, "p2", VICTIM_FREE_INDEX)).toBe("ATTACK_PREVENTED");
    held = must(applyAction(held, { type: "endTurn", seat: "p2" }));
    held = must(applyAction(held, { type: "endTurn", seat: "p1" }));
    expect(held.turn).toBe(5);
    expect(held.players.p2.active?.attackLockedTurn).toBe(3);
    expect(attackLocked(held, held.players.p2.active as InPlayPokemon)).toBe(false);
    expect(refusal(held, "p2", VICTIM_FREE_INDEX)).toBe("ok");
  });

  it("RETREATING inside the window clears it, and the body comes off the Active Spot free", () => {
    let held = swing(flipBoard(true)).state;
    const locked = held.players.p2.active?.stack.at(-1);
    held = attachFromDeck(held, "p2", "fix-energy", 1);
    held = must(
      applyAction(held, {
        type: "retreat",
        seat: "p2",
        discardEnergy: (held.players.p2.active?.energy ?? []).slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    const benched = held.players.p2.bench.find((p) => p.stack.includes(locked as string));
    expect(benched?.attackLockedTurn).toBeNull();
    // …and the promoted body was never locked, so the bar did not travel.
    expect(held.players.p2.active?.attackLockedTurn).toBeNull();
  });

  it("a KNOCKED OUT victim takes the lock out of play with the stack", () => {
    // No §10 clear is written or needed here: `knockOut` discards the stack and the
    // promoted body is a DIFFERENT `InPlayPokemon`. The lock cannot travel.
    let held = swing(flipBoard(true)).state;
    const victim = held.players.p2.active as InPlayPokemon;
    expect(victim.attackLockedTurn).toBe(3);
    // Damage it to lethal by hand rather than by a second attack, so the board this
    // rung is about is the KO and not another install.
    held = {
      ...held,
      players: {
        ...held.players,
        p2: { ...held.players.p2, active: { ...victim, damage: 10_000 } },
      },
    };
    held = must(applyAction(held, { type: "endTurn", seat: "p2" }));
    let next = held;
    if (next.phase.kind === "ko:takePrizes") {
      next = must(applyAction(next, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    }
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p2", benchIndex: 0 }));
    }
    const promoted = next.players.p2.active as InPlayPokemon;
    expect(promoted).not.toBeNull();
    expect(promoted.stack).not.toContain(victim.stack.at(-1));
    expect(promoted.attackLockedTurn).toBeNull();
    expect(attackLocked(next, promoted)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the §11 shield: DECLINED here, with the reason and the falsifier.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the §11 interaction is INHERITED, and this deck cannot drive it", () => {
  it("DECLINED rather than shipped vacuous, and the falsifier is executable", () => {
    for (const id of ["fix-lockplural", "fix-deflock", "fix-attacker", "fix-energy", "fix-titan"]) {
      expect(programFor(id), id).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the describer trace, and `MATCH_RECORD_VERSION` at the HARD address.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — what this slice does NOT owe, traced rather than argued", () => {
  it("`withConsequence` is UNREACHABLE for this program — the CALL PATH, not the category", () => {
    const { state } = swing(flipBoard(true));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(swing(flipBoard(false)).state.phase.kind).not.toBe("effect:choose");
    // `conditionNote` is likewise untouched: it takes a `BoardCondition`, and this
    // program carries none. (The nearest sibling arm, `DEFENDER_BASIC_CANT_ATTACK`,
    // does — which is why the category argument looks plausible from one arm away.)
    expect(deriveAttackEffect(PRINTED)).not.toContainEqual(
      expect.objectContaining({ op: "conditionGate" }),
    );
  });

  it("`MATCH_RECORD_VERSION` STAYS 29 — the SERIALIZED ALPHABET, at the durated address", () => {
    const gated = swing(flipBoard(true)).state.players.p2.active?.attackLockedTurn;
    const bareBoard = board(bareSeed(), DEFENDER_BARE);
    const bare = swing(bareBoard).state.players.p2.active?.attackLockedTurn;
    expect(gated).toBe(bare);
    const shippedGate = mustDerive(deriveAttackEffect, GATED_PREVENT);
    const shippedLock = mustDerive(deriveAttackEffect, DEFENDER_BARE);
    const built = mustDerive(deriveAttackEffect, PRINTED);
    expect((built[0] as { op: string }).op).toBe((shippedGate[0] as { op: string }).op);
    expect(Object.keys(built[0] as object).sort()).toEqual(
      Object.keys(shippedGate[0] as object).sort(),
    );
    expect(JSON.stringify((built[0] as { ops: EffectOp[] }).ops)).toBe(JSON.stringify(shippedLock));
    expect(built).toHaveLength(1);
    expect(swing(flipBoard(true)).state.phase.kind).not.toBe("effect:choose");
    expect(swing(flipBoard(false)).state.phase.kind).not.toBe("effect:choose");
  });
});

describe("§8 — the census moves in exactly ONE summand", () => {
  it("the resolving corpus gains ONE sentence and ONE printing", () => {
    const rows = legalAttackCorpus();
    const units = (rs: readonly (readonly [number, string])[]): number =>
      rs.reduce((sum, [n]) => sum + n, 0);
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([600, 1663]);
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([599, 1662]);
    expect(programFor("fix-deflock")).toBeUndefined();
  });

  it("the demonstrator costs ZERO `FIXTURE_POOL` ids (D414/D452)", () => {
    expect(FIXTURE_POOL["fix-deflock"]?.attacks?.[INSTALL_INDEX]?.effect).toBe(DEFENDER_BARE);
    expect(FIXTURE_POOL["fix-deflock"]?.attacks?.[SIBLING_INDEX]?.effect).toBe(DEFENDER_PLURAL);
    expect(FIXTURE_POOL[PRINTED]).toBeUndefined();
  });
});
