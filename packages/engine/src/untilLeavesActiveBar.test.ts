import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { lockedAttackIndexes } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  UNTIL_LEAVES_ACTIVE_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const BLAZE_BLITZ_BAR = "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot.";

/** The two indices of the barrer, and the whole point of the pair: the bar names
    1 and 0 must stay legal for the rest of the game. */
const BLAZE_BLITZ = 1;
const HEAT_BLAST = 0;

/** ONE seed for the whole suite; the board it produces is asserted by `ready`
    rather than assumed. */
const SEED = 21;

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}

function render(
  events: GameEvent[],
  state: GameState,
  names: Record<Seat, string> = { p1: "Ember", p2: "Tide" },
): { who: string; text: string }[] {
  const ctx: LogContext = { names, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** The error code a declaration comes back with, or `null` when it applies. */
function refusal(state: GameState, seat: Seat, index: number): string | null {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? null : result.error.code;
}

function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

function ready(seat: Seat = "p1"): GameState {
  const opener = other(seat);
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: UNTIL_LEAVES_ACTIVE_DECK, p2: UNTIL_LEAVES_ACTIVE_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, seat, "fix-gougingfire");
  state = setActiveFromDeck(state, opener, "fix-titan");
  state = attachFromDeck(state, seat, "fix-fire-energy", 2);
  state = attachFromDeck(state, seat, "fix-energy", 1);
  if (state.turn !== 2) throw new Error(`ready() expected turn 2, got ${String(state.turn)}`);
  return state;
}

/** `ready`, then "Blaze Blitz" DECLARED — asserting the bar actually landed, so
    no case below can assert "nothing was refused" against a board that barred
    nothing. Returns the OTHER seat's turn 3. */
function barred(seat: Seat = "p1"): { state: GameState; events: GameEvent[]; row: GameEvent } {
  const { state, events } = mustApply(ready(seat), { type: "attack", seat, index: BLAZE_BLITZ });
  const row = findEvent(events, "ATTACK_LOCKED");
  if (row === undefined) throw new Error(`${seat} barred nothing`);
  return { state, events, row };
}

/** Pass both seats until it is `seat`'s turn again, `count` times. */
function laterTurns(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i++) {
    if (next.phase.kind !== "turn:action")
      throw new Error(`expected turn:action, got ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
    if (next.phase.kind !== "turn:action")
      throw new Error(`expected turn:action, got ${next.phase.kind}`);
    if (next.phase.seat !== seat)
      next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

function setLocks(state: GameState, seat: Seat, locks: InPlayPokemon["lockedAttacks"]): GameState {
  const side = state.players[seat];
  const active = must0(side.active);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, lockedAttacks: locks } } },
  };
}

describe("§1 — the printed sentence, and the two claims the corpus row makes", () => {
  it("is on the corpus EXACTLY ONCE, at 5 printings — so all five are byte-identical", () => {
    const rows = legalAttackCorpus().filter(([, sentence]) => sentence === BLAZE_BLITZ_BAR);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(5);
  });

  it("is STANDALONE — the words appear in no other corpus sentence, so it is never a tail", () => {
    const carrying = legalAttackCorpus().filter(([, sentence]) =>
      sentence.includes("until it leaves the Active Spot"),
    );
    expect(carrying.map(([, sentence]) => sentence)).toEqual([BLAZE_BLITZ_BAR]);
    expect(carrying[0]?.[1].startsWith("This Pokémon")).toBe(true);
    expect(carrying[0]?.[1].endsWith("Active Spot.")).toBe(true);
  });

  it("THE BYTE GUARD: the apostrophe is U+0027, NOT the curly U+2019", () => {
    const codePoints = [...BLAZE_BLITZ_BAR].map((c) => c.codePointAt(0) ?? 0);
    expect(BLAZE_BLITZ_BAR).toContain("can't");
    expect(BLAZE_BLITZ_BAR).not.toContain("’");
    expect(codePoints).not.toContain(0x2019);
    // The ONLY non-ASCII code point in the sentence is the é of "Pokémon" — every
    // other byte is plain ASCII, stated as an enumeration so a smart-quote or a
    // non-breaking space introduced by an editor cannot pass unnoticed.
    expect([...new Set(codePoints.filter((cp) => cp > 0x7f))]).toEqual([0x00e9]);
  });

  it("the fixture carries the row — every field, including the ones it does not have", () => {
    const card = FIXTURE_POOL["fix-gougingfire"];
    expect(card?.name).toBe("fix-gougingfire ex");
    expect(card?.hp).toBe(230);
    expect(card?.stage).toBe("Basic");
    expect(card?.types).toEqual(["Fire"]);
    expect(card?.retreat).toBe(2);
    expect(card?.weaknesses).toEqual([{ type: "Water", value: "×2" }]);
    expect(card?.resistances ?? null).toBeNull();
    expect(card?.abilities ?? null).toBeNull();
    expect(card?.evolveFrom ?? null).toBeNull();
    expect(card?.attacks).toHaveLength(2);
    expect(card?.attacks?.[HEAT_BLAST]).toEqual({
      cost: ["Fire", "Colorless"],
      name: "Heat Blast",
      damage: 60,
    });
    expect(card?.attacks?.[BLAZE_BLITZ]).toEqual({
      cost: ["Fire", "Fire", "Colorless"],
      name: "Blaze Blitz",
      damage: 260,
      effect: BLAZE_BLITZ_BAR,
    });
    expect(programFor("fix-gougingfire")).toBeUndefined();
  });
});

describe("§2 — one arm, one op, and the row is LITERAL", () => {
  it("derives `preventAttackUse` with the SPELLED noun and the `until` rider", () => {
    expect(deriveAttackEffect(BLAZE_BLITZ_BAR)).toEqual([
      { op: "preventAttackUse", attack: "Blaze Blitz", until: "leavesActive" },
    ]);
  });

  it("THE LITERAL-ROW PROOF: every near-miss rewrite is REFUSED", () => {
    for (const text of [
      "This Pokémon can't use Heat Blast again until it leaves the Active Spot.",
      // …the name of the sibling family's attack, which IS printed in this pool —
      // one word of the sentence away from a real reading, and still refused.
      "This Pokémon can't use Slashing Steel again until it leaves the Active Spot.",
      // …"again" dropped: a different English sentence, and not one the column
      // prints.
      "This Pokémon can't use Blaze Blitz until it leaves the Active Spot.",
      // …the trailing period dropped, which is what an anchor without `$` admits.
      "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot",
      "Discard an Energy from this Pokémon. This Pokémon can't use Blaze Blitz again until it leaves the Active Spot.",
      "That Pokémon can't use Blaze Blitz again until it leaves the Active Spot.",
      // …lowercased "Active Spot", the drift a paraphrase produces. No /i, so the
      // capital is load-bearing.
      "This Pokémon can't use Blaze Blitz again until it leaves the Active spot.",
      // …the empty name, which no card prints and which a capture would have to
      // guard against with a quantifier it does not need here at all.
      "This Pokémon can't use  again until it leaves the Active Spot.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("…and the CURLY spelling is admitted, which is the standing insurance", () => {
    expect(deriveAttackEffect(BLAZE_BLITZ_BAR.replace("can't", "can’t"))).toEqual(
      deriveAttackEffect(BLAZE_BLITZ_BAR),
    );
  });

  it("the four neighbouring anchors keep their own sentences, and none takes this one", () => {
    expect(
      deriveAttackEffect("During your next turn, this Pokémon can't use Blaze Blitz."),
    ).toEqual([{ op: "preventAttackUse", attack: "Blaze Blitz" }]);
    expect(deriveAttackEffect("During your next turn, this Pokémon can't use attacks.")).toEqual([
      { op: "preventAttack" },
    ]);
    expect(deriveAttackEffect("During your next turn, this Pokémon can't attack.")).toEqual([
      { op: "preventAttack" },
    ]);
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Blaze Blitz attack does 100 more damage (before applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "boostAttack", attack: "Blaze Blitz", amount: 100 }]);
    const next = deriveAttackEffect("During your next turn, this Pokémon can't use Blaze Blitz.");
    const bar = deriveAttackEffect(BLAZE_BLITZ_BAR);
    expect(bar?.[0]).not.toEqual(next?.[0]);
    expect({ ...(bar?.[0] as Record<string, unknown>), until: undefined }).toEqual({
      ...(next?.[0] as Record<string, unknown>),
      until: undefined,
    });
  });
});

describe("§3 — the install writes an entry with NO window", () => {
  it("stamps the INSTALL turn, the resolved index and the rider, and names the attack", () => {
    const before = ready();
    const uid = activeUid(before, "p1");
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BLAZE_BLITZ,
    });
    expect(findEvent(events, "ATTACK_LOCKED")).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid,
      attack: "Blaze Blitz",
      until: "leavesActive",
    });
    expect(before.turn).toBe(2);
    expect(state.players.p1.active?.lockedAttacks).toEqual([
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    // …and NOT the whole-Pokémon lock, which is the field a widening of the wrong
    // op would have written and the one thing no board can tell apart.
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
    // The printed 260 landed and the 340 HP victim survived it, so every window
    // below opens on a live board rather than on a Knock Out.
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(260);
  });

  it("the ROW ORDER is the printed order — the damage, then the drawback", () => {
    const { events } = barred();
    const order = types(events);
    expect(order.indexOf("ATTACK_LOCKED")).toBeGreaterThan(order.indexOf("DAMAGE_DEALT"));
  });

  it("no ATTACK_EFFECT_SKIPPED — in either direction", () => {
    const { events } = barred();
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const sibling = mustApply(ready(), { type: "attack", seat: "p1", index: HEAT_BLAST });
    expect(types(sibling.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(sibling.events, "DAMAGE_DEALT")?.dealt).toBe(60);
  });

  it("never PARKS and consumes no rng — the seed-free claim, made directly", () => {
    const before = ready();
    const { state } = mustApply(before, { type: "attack", seat: "p1", index: BLAZE_BLITZ });
    expect(state.rngState).toBe(before.rngState);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // …no continuation at all, so there is no `pendingOp` to persist (§9).
    expect("cont" in state.phase).toBe(false);
  });

  it("installs NOTHING when the printed name matches no attack on the holder", () => {
    const before = ready();
    const program = deriveAttackEffect(BLAZE_BLITZ_BAR);
    expect(program).not.toBeNull();
    const events: GameEvent[] = [];
    const result = runProgram(before, program ?? [], { seat: "p2", invokedBy: "attack" }, events);
    if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
    // P2's Active is fix-titan, which prints no attacks at all.
    expect(result.state.players.p2.active?.lockedAttacks ?? []).toEqual([]);
    expect(events).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE HEADLINE: the bar survives every turn, and the sibling never does.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — there is no window, and that is driven across real turn boundaries", () => {
  it("bites on the OPPONENT's turn, on the holder's next, and four turns later", () => {
    const { state } = barred();
    // Turn 3 is the opponent's — and the reader answers anyway, because the entry
    // carries no window. A turn-stamped entry would say nothing here.
    expect(state.turn).toBe(3);
    expect(lockedAttackIndexes(state, must0(state.players.p1.active))).toEqual([BLAZE_BLITZ]);
    for (const rounds of [1, 2, 3]) {
      const later = laterTurns(state, "p1", rounds);
      expect(later.phase).toEqual({ kind: "turn:action", seat: "p1" });
      expect(lockedAttackIndexes(later, must0(later.players.p1.active)), `+${rounds}`).toEqual([
        BLAZE_BLITZ,
      ]);
      expect(refusal(later, "p1", BLAZE_BLITZ), `+${rounds}`).toBe("ATTACK_PREVENTED");
    }
  });

  it("…and the sibling stays legal the whole time — the CONTROL that keeps it honest", () => {
    // Without this the refusals above could be passing because the board could not
    // attack at all. The Energy is still attached, the §4 first-turn ban is long
    // past, and index 0 APPLIES rather than merely not being ATTACK_PREVENTED.
    const window = laterTurns(barred().state, "p1", 1);
    expect(refusal(window, "p1", HEAT_BLAST)).toBeNull();
    const { events } = mustApply(window, { type: "attack", seat: "p1", index: HEAT_BLAST });
    expect(types(events)).toContain("DAMAGE_DEALT");
    // …and using the sibling does not re-write, extend or disturb the bar.
    expect(types(events)).not.toContain("ATTACK_LOCKED");
  });

  it("the refusal NAMES the barred attack, and a bad index still reports the INDEX", () => {
    const window = laterTurns(barred().state, "p1", 1);
    const result = applyAction(window, { type: "attack", seat: "p1", index: BLAZE_BLITZ });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("Blaze Blitz");
    // The gate order is unchanged by the rider: a bogus index on a barred body
    // must report the index, not the bar.
    expect(refusal(window, "p1", 7)).toBe("BAD_ATTACK_INDEX");
  });

  it("BOTH SEATS — P2 installs it on its own body and is refused on its own turn", () => {
    const { state, row } = barred("p2");
    expect(row).toMatchObject({ seat: "p2", attack: "Blaze Blitz", until: "leavesActive" });
    expect(state.players.p2.active?.lockedAttacks).toEqual([
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    // …and P1's own body carries nothing at all, so the install did not leak.
    expect(state.players.p1.active?.lockedAttacks ?? []).toEqual([]);
    const window = laterTurns(state, "p2", 1);
    expect(refusal(window, "p2", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
    expect(refusal(window, "p2", HEAT_BLAST)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §10: ALL THREE CLEARS, each through the REAL action.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the bar is lifted by leaving the Active Spot, and by nothing else", () => {
  it("RETREATING lifts it — the holder's own route, and the printed one", () => {
    const window = laterTurns(barred().state, "p1", 1);
    const active = must0(window.players.p1.active);
    expect(lockedAttackIndexes(window, active)).toEqual([BLAZE_BLITZ]);
    const { state: retreated } = mustApply(window, {
      type: "retreat",
      seat: "p1",
      // The printed retreat is 2, so exactly two attached Energy pay it.
      discardEnergy: active.energy.slice(0, 2),
      promoteBenchIndex: 0,
    });
    const wasActive = retreated.players.p1.bench[0];
    expect(wasActive?.lockedAttacks ?? []).toEqual([]);
  });

  it("…and a body brought BACK is free to use it again — the whole printed reading", () => {
    const window = laterTurns(barred().state, "p1", 1);
    const active = must0(window.players.p1.active);
    let state = mustApply(window, {
      type: "retreat",
      seat: "p1",
      discardEnergy: active.energy.slice(0, 2),
      promoteBenchIndex: 0,
    }).state;
    state = laterTurns(state, "p1", 1);
    // Switch the barred body back into the Active Spot and re-arm it. The Energy
    // went to the discard with the retreat, so it is re-attached by surgery —
    // which is a statement about the COST and not about the bar.
    state = handFromDeck(state, "p1", "sv01-194", 1);
    const switched = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-194"),
    }).state;
    const back = must0(switched.players.p1.active);
    expect(back.lockedAttacks).toEqual([]);
    const armed = attachFromDeck(
      attachFromDeck(switched, "p1", "fix-fire-energy", 2),
      "p1",
      "fix-energy",
      1,
    );
    expect(refusal(armed, "p1", BLAZE_BLITZ)).toBeNull();
    // …and declaring it installs the bar AGAIN, on the new turn, which is what
    // "again" means in the printed sentence.
    const { state: re, events } = mustApply(armed, {
      type: "attack",
      seat: "p1",
      index: BLAZE_BLITZ,
    });
    expect(types(events)).toContain("ATTACK_LOCKED");
    // The barred body is still Active (declaring does not move it) and carries a
    // FRESH entry stamped with the turn it was installed on — the same body, a
    // second bar, and no trace of the first, which §10 shed at the retreat.
    expect(armed.turn).toBe(6);
    expect(must0(re.players.p1.active).lockedAttacks).toEqual([
      { turn: 6, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
  });

  it("a real SWITCH lifts it — `switchInto` on the holder's OWN board", () => {
    // sv01-194 Switch (Item, `switchActive`), played as the action rather than
    // called as a function: this is the second of the three §10 literals and the
    // one that lives in `interpreter.ts` rather than in `turn.ts`.
    const window = laterTurns(barred().state, "p1", 1);
    const barredUid = activeUid(window, "p1");
    const held = handFromDeck(window, "p1", "sv01-194", 1);
    const { state: switched, events } = mustApply(held, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(held, "p1", "sv01-194"),
    });
    expect(types(events)).toContain("POKEMON_SWITCHED");
    const benched = switched.players.p1.bench.find((p) => p.stack.includes(barredUid));
    expect(benched).toBeDefined();
    expect(benched?.lockedAttacks ?? []).toEqual([]);
  });

  it("EVOLVING lifts it too — the DISCREPANCY, DECIDED and pinned rather than met", () => {
    const window = laterTurns(barred().state, "p1", 1);
    expect(must0(window.players.p1.active).lockedAttacks).toHaveLength(1);
    const held = handFromDeck(window, "p1", "fix-gouging-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-gouging-stage1"),
      target: { spot: "active" },
    });
    expect(must0(evolved.players.p1.active).lockedAttacks).toEqual([]);
    expect(lockedAttackIndexes(evolved, must0(evolved.players.p1.active))).toEqual([]);
    // …and the evolved body attacks on the same turn, which is §10's rule and not
    // a leniency.
    const { events } = mustApply(evolved, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("the clear-set is the SAME set every durated field is on — swept, not listed", () => {
    const window = laterTurns(barred().state, "p1", 1);
    const held = handFromDeck(window, "p1", "fix-gouging-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-gouging-stage1"),
      target: { spot: "active" },
    });
    const body = must0(evolved.players.p1.active);
    expect({
      attackBlock: body.attackBlock,
      attackLockedTurn: body.attackLockedTurn,
      damageReduction: body.damageReduction,
      noWeaknessTurn: body.noWeaknessTurn,
      scheduledEffect: body.scheduledEffect,
      attackDamageDebuff: body.attackDamageDebuff,
      installedRecoil: body.installedRecoil,
      lockedAttacks: body.lockedAttacks,
      retreatBlocked: body.retreatBlocked,
      retreatLockedTurn: body.retreatLockedTurn,
      boostedAttack: body.boostedAttack,
    }).toEqual({
      attackBlock: null,
      attackLockedTurn: null,
      damageReduction: null,
      noWeaknessTurn: null,
      scheduledEffect: null,
      attackDamageDebuff: null,
      installedRecoil: null,
      lockedAttacks: [],
      retreatBlocked: false,
      retreatLockedTurn: null,
      boostedAttack: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE MERGE RULE: both of `addLockedAttack`'s predicates had to branch.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — `addLockedAttack` keeps an unbounded bar, and adds it only once", () => {
  it("IDEMPOTENT on the index alone — a re-install on a LATER turn adds nothing", () => {
    const state = setLocks(ready(), "p1", [
      { turn: 1, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [{ op: "preventAttackUse", attack: "Blaze Blitz", until: "leavesActive" }],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
    expect(must0(result.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 1, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    expect(events).toEqual([]);
    // …and a DIFFERENT index is still APPENDED, so the key is the index and not
    // "any bar at all".
    const second: GameEvent[] = [];
    const added = runProgram(
      state,
      [{ op: "preventAttackUse", attack: "Heat Blast", until: "leavesActive" }],
      { seat: "p1", invokedBy: "attack" },
      second,
    );
    if (added.kind !== "done") throw new Error(`expected done, got ${added.kind}`);
    expect(must0(added.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 1, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
      { turn: 2, attackIndex: HEAT_BLAST, until: "leavesActive" },
    ]);
    expect(types(second)).toEqual(["ATTACK_LOCKED"]);
  });

  it("THE PRUNE DOES NOT COLLECT IT — a later write leaves the unbounded bar alone", () => {
    const window = laterTurns(barred().state, "p1", 1);
    expect(window.turn).toBe(4);
    // A stale turn-stamped entry beside the bar, so the prune is proved to be
    // RUNNING rather than merely harmless: the stale one must go and the bar stay.
    const mixed = setLocks(window, "p1", [
      { turn: 2, attackIndex: HEAT_BLAST },
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    const events: GameEvent[] = [];
    const result = runProgram(
      mixed,
      [{ op: "preventAttackUse", attack: "Heat Blast" }],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
    expect(must0(result.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
      { turn: 6, attackIndex: HEAT_BLAST },
    ]);
    expect(lockedAttackIndexes(result.state, must0(result.state.players.p1.active))).toEqual([
      BLAZE_BLITZ,
    ]);
  });

  it("a turn-stamped entry beside it still EXPIRES by arithmetic — the two rules coexist", () => {
    // The reader's two clauses on one body: the bar answers on every turn and the
    // stamp answers on exactly one, so a build that dropped either clause reports
    // a different set here.
    const state = setLocks(laterTurns(barred().state, "p1", 1), "p1", [
      { turn: 4, attackIndex: HEAT_BLAST },
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    expect(state.turn).toBe(4);
    expect(lockedAttackIndexes(state, must0(state.players.p1.active))).toEqual([
      HEAT_BLAST,
      BLAZE_BLITZ,
    ]);
    const later = laterTurns(state, "p1", 1);
    expect(later.turn).toBe(6);
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([BLAZE_BLITZ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE LOG: a third phrasing, because the second one would be FALSE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the row says how long, and it says it under either seat", () => {
  it("prints the PRINTED duration, not 'next turn'", () => {
    const { state, row } = barred();
    expect(render([row], state)).toEqual([
      {
        who: "p1",
        text: "fix-gougingfire ex can't use Blaze Blitz again until it leaves the Active Spot",
      },
    ]);
  });

  it("…and the two OLDER phrasings are unmoved — the discriminator, in three cells", () => {
    const { state, row } = barred();
    const uid = activeUid(state, "p1");
    expect(render([{ type: "ATTACK_LOCKED", seat: "p1", uid }], state)).toEqual([
      { who: "p1", text: "fix-gougingfire ex can't attack next turn" },
    ]);
    expect(
      render([{ type: "ATTACK_LOCKED", seat: "p1", uid, attack: "Blaze Blitz" }], state),
    ).toEqual([{ who: "p1", text: "fix-gougingfire ex can't use Blaze Blitz next turn" }]);
    // …and the new one, which must differ from BOTH.
    const wide = render([row], state)[0]?.text ?? "";
    expect(wide).not.toBe("fix-gougingfire ex can't use Blaze Blitz next turn");
    expect(wide).toContain("until it leaves the Active Spot");
  });

  it("reads identically with the seat NAMES swapped — the seat rule is untouched", () => {
    const { state, row } = barred();
    expect(render([row], state, { p1: "Tide", p2: "Ember" })).toEqual(render([row], state));
    const mirror = barred("p2");
    expect(render([mirror.row], mirror.state)[0]?.who).toBe("p2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PROJECTION, and the purity pair.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the panel greys exactly the barred row, on every turn", () => {
  it("greys index 1 and OFFERS index 0 — and agrees with the §8 gate on both", () => {
    const window = laterTurns(barred().state, "p1", 2);
    const view = redactGame(window, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[BLAZE_BLITZ]?.name).toBe("Blaze Blitz");
    expect(view.attacks[BLAZE_BLITZ]?.playable).toBe(false);
    expect(view.attacks[HEAT_BLAST]?.name).toBe("Heat Blast");
    expect(view.attacks[HEAT_BLAST]?.playable).toBe(true);
    expect(refusal(window, "p1", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
    expect(refusal(window, "p1", HEAT_BLAST)).toBeNull();
    // …and the CONTROL: the same board with the list emptied offers BOTH rows, so
    // "false" cannot be passing because the panel was unpayable anyway.
    const free = redactGame(setLocks(window, "p1", []), "p1").phase;
    if (free.kind !== "turn:action") throw new Error("expected turn:action");
    for (const attack of free.attacks) expect(attack.playable, attack.name).toBe(true);
  });

  it("the OPPONENT's view carries nothing — the bar leaks nothing across the wire", () => {
    const window = laterTurns(barred().state, "p1", 1);
    const view = redactGame(window, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toEqual([]);
  });

  it("never mutates the state it was given — the purity PAIR, install and refusal", () => {
    // Both directions off one frozen board: the write (an install that appends an
    // entry) and the read (a declaration the bar refuses). A reducer that mutated
    // either would throw under `deepFreeze` rather than return a wrong answer.
    const before = ready();
    deepFreeze(before);
    expect(() =>
      applyAction(before, { type: "attack", seat: "p1", index: BLAZE_BLITZ }),
    ).not.toThrow();
    const window = laterTurns(barred().state, "p1", 1);
    deepFreeze(window);
    expect(() =>
      applyAction(window, { type: "attack", seat: "p1", index: BLAZE_BLITZ }),
    ).not.toThrow();
    expect(refusal(window, "p1", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE PERSISTED QUESTION: `MATCH_RECORD_VERSION` stays 26, driven BOTH ways.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — a v26 record still means what it meant, and this one is readable too", () => {
  it("A v26 ENTRY WITH THE KEY ABSENT REPLAYS AS AN ORDINARY NEXT-TURN LOCK", () => {
    const window = laterTurns(barred().state, "p1", 1);
    expect(window.turn).toBe(4);
    const legacy = JSON.parse(
      JSON.stringify(setLocks(window, "p1", [{ turn: 4, attackIndex: BLAZE_BLITZ }])),
    ) as GameState;
    const entry = must0(legacy.players.p1.active).lockedAttacks[0];
    expect(entry).toBeDefined();
    expect("until" in (entry ?? {})).toBe(false);
    expect(lockedAttackIndexes(legacy, must0(legacy.players.p1.active))).toEqual([BLAZE_BLITZ]);
    expect(refusal(legacy, "p1", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
    // …and DEAD two turns on, with nothing having cleared it, which is the half a
    // build that treated absence as "unbounded" would fail.
    const later = laterTurns(legacy, "p1", 1);
    expect(later.turn).toBe(6);
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([]);
    expect(refusal(later, "p1", BLAZE_BLITZ)).toBeNull();
    const live = must0(laterTurns(barred().state, "p1", 1).players.p1.active);
    expect(Object.keys(must0(legacy.players.p1.active)).sort()).toEqual(Object.keys(live).sort());
  });

  it("…and an entry WITH the key survives the same round trip — the other direction", () => {
    // The control the case above needs: if the replay path silently dropped
    // unknown keys, the first case would pass for the wrong reason.
    const window = laterTurns(barred().state, "p1", 1);
    const saved = JSON.parse(JSON.stringify(window)) as GameState;
    expect(must0(saved.players.p1.active).lockedAttacks).toEqual([
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    expect(refusal(saved, "p1", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
    const later = laterTurns(saved, "p1", 2);
    expect(refusal(later, "p1", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
    expect(refusal(later, "p1", HEAT_BLAST)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — the fixtures ARE the deck, and the deck is 60.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — the cast", () => {
  it("the deck is 60 cards and the pool holds every id in it", () => {
    expect(UNTIL_LEAVES_ACTIVE_DECK).toHaveLength(60);
    for (const id of new Set(UNTIL_LEAVES_ACTIVE_DECK)) expect(FIXTURE_POOL[id], id).toBeDefined();
  });

  it("the evolve route's Stage 1 names the barrer and prints ONE attack", () => {
    const stage1 = FIXTURE_POOL["fix-gouging-stage1"];
    expect(stage1?.stage).toBe("Stage1");
    expect(stage1?.evolveFrom).toBe("fix-gougingfire ex");
    expect(stage1?.evolveFrom).toBe(FIXTURE_POOL["fix-gougingfire"]?.name);
    // ONE attack, which is what makes a surviving index 1 point at nothing.
    expect(stage1?.attacks).toHaveLength(1);
  });
});
