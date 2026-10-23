import { describe, expect, it } from "vitest";
import { applyDamageModifier } from "./cards";
import { boostedAttackDamage } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  PER_ATTACK_BUFF_DECK,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
  findEvent,
} from "./testFixtures";

const ECHOED_VOICE =
  "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).";
const ECHO_CHORUS =
  "During your next turn, this Pokémon's Echo Chorus attack does 100 more damage (before applying Weakness and Resistance).";

const ECHOED_VOICE_INDEX = 0;
/** fix-echoer's pair: the buff names index 1 and index 0 is a plain 20. */
const ECHO_CHORUS_INDEX = 1;
const ECHO_TAP_INDEX = 0;

const SEED = 21;

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}

/** Run a one-op program from P1's chair as an ATTACK's effect — the shape the
    CONSTRUCTED cases need (`preventBlock.test.ts`'s move). The op never parks, so
    the run is always `done` and the assertion says so rather than assuming it. */
function runOne(state: GameState, program: readonly EffectOp[], events: GameEvent[]): GameState {
  const result = runProgram(state, program, { seat: "p1", invokedBy: "attack" }, events);
  if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
  return result.state;
}

function ready(booster: string, water = 3): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: PER_ATTACK_BUFF_DECK, p2: PER_ATTACK_BUFF_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", booster);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return attachFromDeck(state, "p1", "fix-water-energy", water);
}

function boosted(booster: string, index: number, water?: number) {
  const { state, events } = mustApply(ready(booster, water), {
    type: "attack",
    seat: "p1",
    index,
  });
  const row = findEvent(events, "ATTACK_BOOSTED");
  if (row === undefined) throw new Error(`${booster} idx ${String(index)} boosted nothing`);
  return { state, events, row };
}

/** …and one more turn on, which IS the window (the stamp is `+ 2`). */
function inWindow(state: GameState): GameState {
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

describe("the printed datum — re-queried, not inherited", () => {
  it("carries Seismitoad's NAME, attack INDEX and effect string verbatim", () => {
    const toad = FIXTURE_POOL["sv03-052"];
    expect(toad?.name).toBe("Seismitoad");
    expect(toad?.hp).toBe(170);
    expect(toad?.stage).toBe("Stage2");
    expect(toad?.evolveFrom).toBe("Palpitoad");
    expect(toad?.types).toEqual(["Water"]);
    expect(toad?.retreat).toBe(3);
    expect(toad?.weaknesses).toEqual([{ type: "Lightning", value: "×2" }]);
    expect(toad?.resistances ?? null).toBeNull();
    expect(toad?.abilities?.[0]?.name).toBe("Quaking Zone");
    expect(toad?.abilities?.[0]?.effect).toContain("cost {C} more");
    // ONE attack, which is the fact that forced a constructed witness below.
    expect(toad?.attacks).toHaveLength(1);
    expect(toad?.attacks?.[ECHOED_VOICE_INDEX]).toEqual({
      cost: ["Water", "Water"],
      name: "Echoed Voice",
      damage: 120,
      effect: ECHOED_VOICE,
    });
  });

  it("derives ONE op with BOTH captures — the name and the amount", () => {
    expect(deriveAttackEffect(ECHOED_VOICE)).toEqual([
      { op: "boostAttack", attack: "Echoed Voice", amount: 100 },
    ]);
    expect(deriveAttackEffect(ECHO_CHORUS)).toEqual([
      { op: "boostAttack", attack: "Echo Chorus", amount: 100 },
    ]);
  });

  it("folds the CAPTURE's apostrophes — pinned by a constructed sentence", () => {
    const straight =
      "During your next turn, this Pokémon's Slip 'n' Roll attack does 40 more damage (before applying Weakness and Resistance).";
    const curly = straight.replaceAll("'", "’");
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(straight));
    expect(deriveAttackEffect(curly)).toEqual([
      { op: "boostAttack", attack: "Slip 'n' Roll", amount: 40 },
    ]);
  });

  it("matches a CURLY printed attack name and prints the CARD's spelling", () => {
    const { events } = boosted("fix-curly-booster", 1, 2);
    expect(
      deriveAttackEffect(FIXTURE_POOL["fix-curly-booster"]?.attacks?.[1]?.effect ?? ""),
    ).toEqual([{ op: "boostAttack", attack: "Slip 'n' Roll", amount: 100 }]);
    expect(findEvent(events, "ATTACK_BOOSTED")?.attack).toBe("Slip ’n’ Roll");
  });

  it("the anchor refuses the whole neighbourhood, and each refusal is a warrant", () => {
    for (const text of [
      "During your next turn, this Pokémon's Echoed Voice attack does 0 more damage (before applying Weakness and Resistance).",
      "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage (after applying Weakness and Resistance).",
      // No parenthetical at all — the step unstated, which is a sentence this
      // engine has no place to put.
      "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage.",
      "During your opponent's next turn, the Defending Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).",
      "Flip a coin. If heads, during your next turn, this Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    expect(
      deriveAttackEffect("During your next turn, this Pokémon can't use Echoed Voice."),
    ).toEqual([{ op: "preventAttackUse", attack: "Echoed Voice" }]);
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, the Defending Pokémon's attacks do 20 less damage (before applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "weakenDefenderAttacks", amount: 20 }]);
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "reduceDamage", amount: 30 }]);
  });

  it("D544 — the BASE-SET sibling at the same address is disjoint in both directions", () => {
    expect(deriveAttackEffect(ECHOED_VOICE)).toStrictEqual([
      { op: "boostAttack", attack: "Echoed Voice", amount: 100 },
    ]);
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Echoed Voice attack's base damage is 100.",
      ),
    ).toStrictEqual([{ op: "boostAttack", attack: "Echoed Voice", amount: 100, base: true }]);
    // …and a printed ZERO on the additive sentence, which falls THROUGH arm 24b's
    // guard to the arm beneath it, is still refused there rather than read as a set.
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Echoed Voice attack does 0 more damage (before applying Weakness and Resistance).",
      ),
    ).toBeNull();
  });
});

describe("the install — the address is resolved once, by the helper D154 wrote", () => {
  it("stamps { turn: +2, attackIndex, amount } and names the attack on the row", () => {
    const before = ready("sv03-052");
    expect(before.turn).toBe(2);
    const uid = activeUid(before, "p1");
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: ECHOED_VOICE_INDEX,
    });
    expect(findEvent(events, "ATTACK_BOOSTED")).toEqual({
      type: "ATTACK_BOOSTED",
      seat: "p1",
      uid,
      attack: "Echoed Voice",
      amount: 100,
    });
    expect(state.players.p1.active?.boostedAttack).toEqual({
      turn: 2 + 2,
      attackIndex: ECHOED_VOICE_INDEX,
      amount: 100,
    });
    // …and NOT the per-attack BAR, which is the field a shared record would have
    // written and the one thing no board can tell apart from this one by shape.
    expect(state.players.p1.active?.lockedAttacks).toEqual([]);
  });

  it("the ROW ORDER is the printed order — the damage, then the rider", () => {
    const { events } = boosted("sv03-052", ECHOED_VOICE_INDEX);
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ATTACK_BOOSTED"));
  });

  it("installs NOTHING when the printed name matches no attack on the holder", () => {
    const state = ready("sv03-052");
    const events: GameEvent[] = [];
    const after = runOne(state, [{ op: "boostAttack", attack: "Surf", amount: 100 }], events);
    expect(after.players.p1.active?.boostedAttack ?? null).toBeNull();
    expect(types(events)).toEqual([]);
  });

  it("never PARKS and consumes no rng", () => {
    const before = ready("sv03-052");
    const { state } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: ECHOED_VOICE_INDEX,
    });
    // Nothing is asked, so the turn ends inline (§5.3) rather than stopping on a
    // prompt — and the rng cursor is untouched, which is what makes the whole
    // suite seed-insensitive beyond the shuffle.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.rngState).toBe(before.rngState);
  });

  it("a re-install that says the SAME thing is silent; a larger amount wins", () => {
    const state = ready("sv03-052");
    const first: GameEvent[] = [];
    const once = runOne(state, [{ op: "boostAttack", attack: "Echoed Voice", amount: 100 }], first);
    expect(types(first)).toEqual(["ATTACK_BOOSTED"]);

    const same: GameEvent[] = [];
    const twice = runOne(once, [{ op: "boostAttack", attack: "Echoed Voice", amount: 100 }], same);
    expect(types(same)).toEqual([]);
    expect(twice.players.p1.active?.boostedAttack).toEqual(once.players.p1.active?.boostedAttack);

    const bigger: GameEvent[] = [];
    const merged = runOne(
      once,
      [{ op: "boostAttack", attack: "Echoed Voice", amount: 150 }],
      bigger,
    );
    expect(findEvent(bigger, "ATTACK_BOOSTED")?.amount).toBe(150);
    expect(merged.players.p1.active?.boostedAttack?.amount).toBe(150);
    // …and a SMALLER one changes nothing and says nothing, which is the half of
    // `Math.max` a `?:` would get wrong in the direction nobody looks at.
    const smaller: GameEvent[] = [];
    const kept = runOne(
      merged,
      [{ op: "boostAttack", attack: "Echoed Voice", amount: 20 }],
      smaller,
    );
    expect(types(smaller)).toEqual([]);
    expect(kept.players.p1.active?.boostedAttack?.amount).toBe(150);
  });

  it("a re-install naming a DIFFERENT attack replaces the record outright", () => {
    const state = ready("fix-echoer", 4);
    const events: GameEvent[] = [];
    let after = runOne(state, [{ op: "boostAttack", attack: "Echo Chorus", amount: 150 }], events);
    after = runOne(after, [{ op: "boostAttack", attack: "Echo Tap", amount: 30 }], events);
    expect(after.players.p1.active?.boostedAttack).toEqual({
      turn: 4,
      attackIndex: ECHO_TAP_INDEX,
      amount: 30,
    });
    const window = inWindow(must(applyAction(after, { type: "endTurn", seat: "p1" })));
    const body = must0(window.players.p1.active);
    expect(boostedAttackDamage(window, body, ECHO_CHORUS_INDEX)).toBe(0);
    expect(boostedAttackDamage(window, body, ECHO_TAP_INDEX)).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The window — the holder's own next turn, driven across real turn boundaries.
// ─────────────────────────────────────────────────────────────────────────────

describe("the window is the HOLDER's own next turn — driven, not asserted", () => {
  it("is not live in between, is live on the holder's next turn, and expires", () => {
    const { state: installed } = boosted("sv03-052", ECHOED_VOICE_INDEX);
    const body = () => must0(installed.players.p1.active);
    // Installed on turn 2, stamped 4. Turn 3 is the OPPONENT's.
    expect(installed.turn).toBe(3);
    expect(boostedAttackDamage(installed, body(), ECHOED_VOICE_INDEX)).toBe(0);

    const window = inWindow(installed);
    expect(window.turn).toBe(4);
    expect(boostedAttackDamage(window, must0(window.players.p1.active), ECHOED_VOICE_INDEX)).toBe(
      100,
    );

    let later = must(applyAction(window, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.turn).toBe(6);
    expect(later.players.p1.active?.boostedAttack).toEqual({
      turn: 4,
      attackIndex: ECHOED_VOICE_INDEX,
      amount: 100,
    });
    expect(boostedAttackDamage(later, must0(later.players.p1.active), ECHOED_VOICE_INDEX)).toBe(0);
  });

  it("a `+ 1` stamp would be a bonus that never arrives — D143's failure inverted", () => {
    const { state } = boosted("sv03-052", ECHOED_VOICE_INDEX);
    const stamp = must0(state.players.p1.active).boostedAttack?.turn;
    expect(stamp).toBe(4);
    expect(state.turn).toBe(3);
    const refused = applyAction(state, { type: "attack", seat: "p1", index: ECHOED_VOICE_INDEX });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("WRONG_SEAT");
  });
});

describe("the bonus is addressed to ONE index", () => {
  it("pays the named attack and NOT its sibling, on one body on one turn", () => {
    const window = inWindow(boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state);
    const boostedHit = mustApply(window, {
      type: "attack",
      seat: "p1",
      index: ECHO_CHORUS_INDEX,
    });
    const paid = findEvent(boostedHit.events, "DAMAGE_DEALT");
    expect(paid?.base).toBe(100);
    expect(paid?.bonus).toBe(100);
    expect(paid?.dealt).toBe(200);

    // …the SIBLING, on the same body inside the same window, from a board that is
    // byte-identical up to the declaration.
    const plainHit = mustApply(window, { type: "attack", seat: "p1", index: ECHO_TAP_INDEX });
    const unpaid = findEvent(plainHit.events, "DAMAGE_DEALT");
    expect(unpaid?.base).toBe(20);
    expect(unpaid?.bonus).toBeUndefined();
    expect(unpaid?.dealt).toBe(20);
  });

  it("one body carries the BAR and the BUFF at once — why the record is not shared", () => {
    const state = ready("fix-echoer", 4);
    const events: GameEvent[] = [];
    let armed = runOne(state, [{ op: "boostAttack", attack: "Echo Chorus", amount: 100 }], events);
    armed = runOne(armed, [{ op: "preventAttackUse", attack: "Echo Tap" }], events);
    expect(must0(armed.players.p1.active).boostedAttack).toEqual({
      turn: 4,
      attackIndex: ECHO_CHORUS_INDEX,
      amount: 100,
    });
    expect(must0(armed.players.p1.active).lockedAttacks).toEqual([
      { turn: 4, attackIndex: ECHO_TAP_INDEX },
    ]);

    const window = inWindow(must(applyAction(armed, { type: "endTurn", seat: "p1" })));
    expect(window.turn).toBe(4);
    // The BARRED index is refused…
    const refused = applyAction(window, { type: "attack", seat: "p1", index: ECHO_TAP_INDEX });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("ATTACK_PREVENTED");
    // …and the BOOSTED one resolves, at +100. A single shared field could produce
    // at most one of these two lines.
    const paid = mustApply(window, { type: "attack", seat: "p1", index: ECHO_CHORUS_INDEX });
    expect(findEvent(paid.events, "DAMAGE_DEALT")?.dealt).toBe(200);
  });
});

describe("it lands BEFORE Weakness and Resistance — driven both ways", () => {
  it("Skeledirge ex takes 240 unboosted and 440 boosted, and the order is the difference", () => {
    let state = ready("sv03-052", 4);
    state = setActiveFromDeck(state, "p2", "sv02-037");
    const unboosted = mustApply(state, { type: "attack", seat: "p1", index: ECHOED_VOICE_INDEX });
    const first = findEvent(unboosted.events, "DAMAGE_DEALT");
    expect(first?.bonus).toBeUndefined();
    expect(first?.dealt).toBe(240);
    // …and it SURVIVES, which is what makes the boosted swing below a change of
    // outcome and not only of arithmetic.
    expect(unboosted.state.players.p2.active?.damage).toBe(240);

    const window = inWindow(unboosted.state);
    let armed = setActiveFromDeck(window, "p2", "sv02-037");
    armed = attachFromDeck(armed, "p1", "fix-water-energy", 0);
    const hit = mustApply(armed, { type: "attack", seat: "p1", index: ECHOED_VOICE_INDEX });
    const row = findEvent(hit.events, "DAMAGE_DEALT");
    expect(row?.base).toBe(120);
    expect(row?.bonus).toBe(100);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.dealt).toBe(440);

    // The oracle: the same reported fields, both placements, asserted to DIFFER —
    // so the parenthetical is load-bearing rather than decorative on this board.
    const base = row?.base ?? 0;
    const bonus = row?.bonus ?? 0;
    const printed = applyDamageModifier(base + bonus, row?.weakness ?? null);
    const reversed = applyDamageModifier(base, row?.weakness ?? null) + bonus;
    expect(printed).toBe(440);
    expect(reversed).toBe(340);
    expect(row?.dealt).toBe(printed);
  });

  it("commutes with RESISTANCE, which is why only Weakness makes the order visible", () => {
    const resistance = { op: "subtract", amount: 30 } as const;
    expect(applyDamageModifier(120 + 100, resistance)).toBe(
      applyDamageModifier(120, resistance) + 100,
    );
  });

  it("the KO boundary is two printed declarations — 120, then a boosted 220", () => {
    const { state: installed } = boosted("sv03-052", ECHOED_VOICE_INDEX, 4);
    expect(installed.players.p2.active?.damage).toBe(120);
    const window = inWindow(installed);
    const { state: after, events } = mustApply(window, {
      type: "attack",
      seat: "p1",
      index: ECHOED_VOICE_INDEX,
    });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(220);
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(after.players.p2.active?.damage ?? 340).toBe(340);
  });

  it("SUMS with the catalog half into ONE `bonus` field — the row's standing shape", () => {
    let state = ready("sv03-052", 4);
    state = attachToolFromDeck(state, "p1", "active", "sv01-197"); // Vitality Band: +10 pre-W/R
    const installed = mustApply(state, { type: "attack", seat: "p1", index: ECHOED_VOICE_INDEX });
    // The install turn: the Tool alone.
    expect(findEvent(installed.events, "DAMAGE_DEALT")?.bonus).toBe(10);

    const window = inWindow(installed.state);
    const { events } = mustApply(window, { type: "attack", seat: "p1", index: ECHOED_VOICE_INDEX });
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.bonus).toBe(110);
    expect(row?.dealt).toBe(230);
    // …and the log prints the SUM in one crumb, which is the reader-facing half of
    // the same decision.
    const line = render(events, window).find((r) => r.text.includes("boosted"));
    expect(line?.text).toContain("· boosted +110");
  });

  it("SURVIVES a §9 Ability lock that switches the catalog half OFF", () => {
    let state = ready("fix-booster-ability", 3);
    state = setActiveFromDeck(state, "p2", "sv02-127");
    const events: GameEvent[] = [];
    const armed = runOne(state, [{ op: "boostAttack", attack: "Hum", amount: 100 }], events);
    const window = inWindow(must(applyAction(armed, { type: "endTurn", seat: "p1" })));

    const free = mustApply(window, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(free.events, "DAMAGE_DEALT")?.bonus).toBe(130);

    // DAMAGED: Cursed Land's `requiresDamage` gate is met, the printed Ability is
    // suppressed, and the INSTALLED half is untouched. A fold would have lost both.
    const locked = mustApply(setDamage(window, "p1", 10), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(findEvent(locked.events, "DAMAGE_DEALT")?.bonus).toBe(100);
  });
});

describe("the row renders under the seat that owns the boosted Pokémon", () => {
  it("names the attack and the number, read back under BOTH seats", () => {
    const { state, events } = boosted("sv03-052", ECHOED_VOICE_INDEX);
    const rows = render(events, state);
    expect(rows.find((r) => r.text.includes("more damage next turn"))).toEqual({
      who: "p1",
      text: "Seismitoad's Echoed Voice does 100 more damage next turn",
    });

    const installed = findEvent(events, "ATTACK_BOOSTED");
    expect(installed).toBeDefined();
    expect(render(installed === undefined ? [] : [{ ...installed, seat: "p2" }], state)).toEqual([
      { who: "p2", text: "Seismitoad's Echoed Voice does 100 more damage next turn" },
    ]);
  });

  it("naming the attack is REQUIRED, not decoration — the bare row would be false", () => {
    const { state, events } = boosted("fix-echoer", ECHO_CHORUS_INDEX, 4);
    const text =
      render(events, state).find((r) => r.text.includes("more damage next turn"))?.text ?? "";
    expect(text).toContain("Echo Chorus");
    expect(text).not.toContain("Echo Tap");
    expect(FIXTURE_POOL["fix-echoer"]?.attacks).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 sheds it — the three clears, and the sweep that keeps them together.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 sheds it — and here that is a LOSS rather than an escape", () => {
  it("EVOLVING inside the window throws the bonus away — a played line", () => {
    const window = inWindow(boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state);
    expect(window.players.p1.active?.boostedAttack).toEqual({
      turn: 4,
      attackIndex: ECHO_CHORUS_INDEX,
      amount: 100,
    });
    const held = handFromDeck(window, "p1", "fix-echoer-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-echoer-stage1"),
      target: { spot: "active" },
    });
    expect(evolved.players.p1.active?.boostedAttack).toBeNull();
    // …and the evolved body's only attack pays nothing extra, which is the half a
    // surviving record would have got wrong invisibly.
    const { events } = mustApply(evolved, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")?.bonus).toBeUndefined();
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(40);
  });

  it("RETREATING inside the window sheds it — the holder's own route", () => {
    const window = inWindow(boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state);
    expect(window.players.p1.bench.length).toBeGreaterThan(0);
    const { state: retreated } = mustApply(window, {
      type: "retreat",
      seat: "p1",
      // fix-echoer's printed retreat is 1, so exactly one attached energy pays it.
      discardEnergy: must0(window.players.p1.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    const wasActive = retreated.players.p1.bench[0];
    expect(wasActive?.boostedAttack ?? null).toBeNull();
  });

  it("a FORCED switch sheds it too — the opponent's route into the same clear", () => {
    // Boss's Orders played by the OPPONENT on the turn before the window: the body
    // leaves the Active Spot and the record goes with it. The same four literals
    // every durated field is on, which is why the set is SWEPT below.
    const state = handFromDeck(
      boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state,
      "p2",
      "sv02-172",
      1,
    );
    const boostedUid = activeUid(state, "p1");
    let gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    }).state;
    if (gusted.phase.kind === "effect:choose") {
      gusted = must(
        applyAction(gusted, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = gusted.players.p1.bench.find((p) => p.stack.includes(boostedUid));
    expect(benched).toBeDefined();
    expect(benched?.boostedAttack ?? null).toBeNull();
  });

  it("the clear-set is the SAME set every durated field is on — swept, not listed", () => {
    const window = inWindow(boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state);
    const held = handFromDeck(window, "p1", "fix-echoer-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-echoer-stage1"),
      target: { spot: "active" },
    });
    const body = must0(evolved.players.p1.active);
    expect({
      attackBlock: body.attackBlock,
      attackLockedTurn: body.attackLockedTurn,
      retreatLockedTurn: body.retreatLockedTurn,
      damageReduction: body.damageReduction,
      noWeaknessTurn: body.noWeaknessTurn,
      scheduledEffect: body.scheduledEffect,
      attackDamageDebuff: body.attackDamageDebuff,
      installedRecoil: body.installedRecoil,
      lockedAttacks: body.lockedAttacks,
      boostedAttack: body.boostedAttack,
      retreatBlocked: body.retreatBlocked,
    }).toEqual({
      attackBlock: null,
      attackLockedTurn: null,
      retreatLockedTurn: null,
      damageReduction: null,
      noWeaknessTurn: null,
      scheduledEffect: null,
      attackDamageDebuff: null,
      installedRecoil: null,
      lockedAttacks: [],
      boostedAttack: null,
      retreatBlocked: false,
    });
  });

  it("a KO'd holder takes it out of play, and the promoted body carries nothing", () => {
    let state = boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state;
    state = benchFromDeck(state, "p1", "fix-attacker");
    state = setDamage(state, "p1", 140); // fix-echoer is 150 HP; Bite is 30
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    let killed = mustApply(state, { type: "attack", seat: "p2", index: 0 }).state;
    expect(killed.phase.kind === "ko:promote" || killed.phase.kind === "ko:takePrizes").toBe(true);
    if (killed.phase.kind === "ko:takePrizes") {
      killed = must(applyAction(killed, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    }
    if (killed.phase.kind === "ko:promote") {
      killed = must(applyAction(killed, { type: "promote", seat: "p1", benchIndex: 0 }));
    }
    expect(killed.players.p1.active?.boostedAttack ?? null).toBeNull();
  });
});

describe("it gates no ACTION, so it owes no payability projection", () => {
  it("leaves every attack row playable and the PRINTED damage unchanged", () => {
    const window = inWindow(boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state);
    const view = redactGame(window, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    for (const attack of view.attacks) expect(attack.playable, attack.name).toBe(true);
    expect(view.attacks[ECHO_CHORUS_INDEX]?.damage).toBe("100");
    expect(view.attacks[ECHO_TAP_INDEX]?.damage).toBe("20");
    // …and the engine agrees with the panel on both rows, which is the property
    // that matters: neither offers a button the server refuses.
    for (const index of [ECHO_TAP_INDEX, ECHO_CHORUS_INDEX]) {
      expect(applyAction(window, { type: "attack", seat: "p1", index }).ok).toBe(true);
    }
  });

  it("the OPPONENT's view is unchanged — the record leaks nothing across the wire", () => {
    const window = inWindow(boosted("sv03-052", ECHOED_VOICE_INDEX).state);
    const view = redactGame(window, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toEqual([]);
  });
});
