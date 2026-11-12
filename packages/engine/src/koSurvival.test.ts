import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import { koSurvivalClamp } from "./damageCalc";
import { isLethallyDamaged } from "./flow";
import { logFromEvents, programFor } from "./index";
import type { GameEvent, GameState, LogContext, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  KO_SURVIVAL_DECK,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setConditions,
  setDamage,
  types,
  findEvent,
} from "./testFixtures";

const KO_SURVIVAL_TEXT =
  "If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10.";

const PRINTINGS = [
  "sv08-057", // Pikachu ex — "Resolute Heart"
  "sv08-219",
  "sv08-238",
  "sv08-247",
  "sv08.5-179",
  "sv10.5b-052", // Crustle — "Sturdy" (a DIFFERENT Ability name, the SAME sentence)
  "sv10.5b-130",
] as const;

/** "its remaining HP becomes 10" — the printed constant, spelled here so an
    assertion that expects 110 on a 120 HP body is arithmetic rather than a
    magic number. */
const REMAINING = 10;
const STURDY_HP = 120;
const STURDY_SURVIVES_AT = STURDY_HP - REMAINING; // 110 damage, 10 HP left
/** Vengeful Punch sv03-197 — 4 counters, KO-conditioned. Must be SILENT on a clamp. */
const PUNCH_HP = 40;
/** Rocky Helmet sv01-193 — 20 HP, damage-conditioned. Must STILL FIRE on a clamp. */
const HELMET_HP = 20;

const BLAST = 0; // 120 flat — the EXACTLY lethal main hit
const OVERKILL = 1; // 300 flat — the main hit far past lethal
const SHOCKWAVE = 2; // spreadDamage — 120 to each benched
const PINPOINT = 3; // placeSnipe `deals` arm — 120 to one chosen benched
const ARROW = 4; // opponentAny — snipeActive when the pick is the Active
const STING = 5;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function recoils(events: GameEvent[]) {
  return all(events, "COUNTERS_PLACED").filter((e) => e.source === "counterattack");
}

/** P2 (going first) fields `defender` with the named Tools bolted on and an exact
    bench; the turn then passes to P1, who fields the attacker with one {C}. The
    shape of `vengefulPunch.test.ts`'s `equip`, so the two suites' boards compare. */
function board(
  seed: number,
  opts: {
    defender?: string;
    tools?: string[];
    defenderDamage?: number;
    bench?: { id: string; tool?: string; damage?: number }[];
    attacker?: string;
  } = {},
): GameState {
  let state = driveSetup(seed, { p1: KO_SURVIVAL_DECK, p2: KO_SURVIVAL_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", opts.defender ?? "fix-sturdy");
  state = clearBench(state, "p2");
  for (const tool of opts.tools ?? []) state = attachToolFromDeck(state, "p2", "active", tool);
  for (const [i, entry] of (opts.bench ?? []).entries()) {
    state = benchFromDeck(state, "p2", entry.id);
    if (entry.tool !== undefined) state = attachToolFromDeck(state, "p2", i, entry.tool);
    if (entry.damage !== undefined) state = setBenchDamage(state, "p2", i, entry.damage);
  }
  if (opts.defenderDamage !== undefined) state = setDamage(state, "p2", opts.defenderDamage);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", opts.attacker ?? "fix-koblast");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function fixtureAbilityText(id: string): string | undefined {
  return FIXTURE_POOL[id]?.abilities?.[0]?.effect;
}

/** The p2 body carrying `id`, found by card id rather than by bench slot. */
function benched(state: GameState, id: string) {
  return state.players.p2.bench.find((p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === id);
}

describe("the printed datum — the registry rows", () => {
  it("authors all SEVEN printings as the bare survivesKoAtFullHp passive", () => {
    // Two Ability names, ONE program: the rows are byte-identical through the full
    // stop, so a single `CardProgram` is the honest shape. RED if any id is dropped
    // from the registry table, or if the program gains a second field.
    for (const id of PRINTINGS) {
      expect(programFor(id)?.passive, id).toEqual({ survivesKoAtFullHp: true });
    }
    expect(PRINTINGS).toHaveLength(7);
  });

  it("the two synthetic demonstrators carry the IDENTICAL program and the IDENTICAL text", () => {
    for (const id of ["fix-sturdy", "fix-sturdytiny"]) {
      expect(programFor(id)?.passive, id).toEqual({ survivesKoAtFullHp: true });
      expect(fixtureAbilityText(id), id).toBe(KO_SURVIVAL_TEXT);
    }
  });

  it("REFUSES the two neighbours the census surfaced — neither is this sentence", () => {
    expect(programFor("sv03.5-068")).toBeUndefined();
    expect(programFor("sv06-164")?.passive).toEqual({
      survivesKoAtFullHpFromOpponentThenDiscard: true,
    });
    expect(programFor("sv06-164")?.passive?.survivesKoAtFullHp).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE PLACEMENT CLAIM — driven, not asserted in a comment.
// ─────────────────────────────────────────────────────────────────────────────

describe("the placement — why this is a WRITE-SITE clamp and not a KO-sweep hook", () => {
  it("isLethallyDamaged CANNOT see the antecedent: it reads a total that already includes the hit", () => {
    const state = board(1);
    const pokemon = state.players.p2.active;
    if (pokemon === undefined || pokemon === null) throw new Error("no active");

    const wasFull = { ...pokemon, damage: 0 + STURDY_HP }; // 0 → took 120
    const wasHurt = { ...pokemon, damage: 10 + (STURDY_HP - 10) }; // 10 → took 110
    expect(wasFull.damage).toBe(wasHurt.damage); // the same board position…
    expect(isLethallyDamaged(state, wasFull)).toBe(true);
    expect(isLethallyDamaged(state, wasHurt)).toBe(true); // …and the same answer.

    // The clamp, given the PRE-damage body, tells them apart — which is the whole
    // argument for its placement.
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, STURDY_HP, "p1")?.damage).toBe(
      STURDY_SURVIVES_AT,
    );
    expect(koSurvivalClamp(state, { ...pokemon, damage: 10 }, STURDY_HP - 10, "p1")).toBeNull();
  });

  it("the clamp's lethality test AGREES with isLethallyDamaged, boundary for boundary", () => {
    const state = board(2);
    const pokemon = state.players.p2.active;
    if (pokemon === undefined || pokemon === null) throw new Error("no active");

    for (const dealt of [STURDY_HP - 10, STURDY_HP - 1, STURDY_HP, STURDY_HP + 1, 300]) {
      const wouldDie = isLethallyDamaged(state, { ...pokemon, damage: dealt });
      const clamped = koSurvivalClamp(state, { ...pokemon, damage: 0 }, dealt, "p1");
      expect(clamped !== null, `dealt ${dealt}`).toBe(wouldDie);
    }
    // …and the boundary really is where it is claimed to be, spelled out so the
    // loop above cannot pass vacuously on an all-false or all-true run.
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, STURDY_HP - 1, "p1")).toBeNull();
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, STURDY_HP, "p1")?.damage).toBe(
      STURDY_SURVIVES_AT,
    );
  });

  it("refuses a ZERO or PREVENTED hit — there is no Knock Out to refuse", () => {
    const state = board(3);
    const pokemon = state.players.p2.active;
    if (pokemon === undefined || pokemon === null) throw new Error("no active");
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, 0, "p1")).toBeNull();
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, -10, "p1")).toBeNull();
  });

  it("a body WITHOUT the passive is never clamped, at any damage", () => {
    const state = board(4, { defender: "fix-bigbody" });
    const pokemon = state.players.p2.active;
    if (pokemon === undefined || pokemon === null) throw new Error("no active");
    expect(passivesOf(state, pokemon).survivesKoAtFullHp).toBe(false);
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, 999, "p1")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WRITE SITE 1 — attack.ts's main hit.
// ─────────────────────────────────────────────────────────────────────────────

describe("write site 1 — attack.ts's main hit", () => {
  it("an EXACTLY lethal 120 on a full-HP 120 HP body leaves it standing on 10", () => {
    // The card's own case. RED if the clamp is placed at `>` instead of `>=` (the
    // hit would land unclamped and KO), if the remaining HP is clamped to 0 instead
    // of 10 (damage would read 120), or if the antecedent is dropped.
    const state = board(10);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BLAST });

    expect(done.players.p2.active?.damage).toBe(STURDY_SURVIVES_AT); // 110 — 10 HP left
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    expect(done.players.p1.prizes).toHaveLength(6); // no Prize taken
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" }); // no ko: park
  });

  it("a 300 OVERKILL lands on the SAME 10 HP — the clamp is a floor on the RESULT", () => {
    const state = board(11);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: OVERKILL,
    });

    expect(done.players.p2.active?.damage).toBe(STURDY_SURVIVES_AT); // still 110
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    // …and `dealt` is NOT clamped: the attack really did deal 300.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      dealt: 300,
      damage: STURDY_SURVIVES_AT,
    });
  });

  it("ONE damage counter and the same body dies normally — the printed antecedent", () => {
    const state = board(12, { defenderDamage: 10 });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BLAST });

    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
    // The defender's Bench is empty, so the Knock Out ends the game at once.
    expect(done.phase).toMatchObject({ kind: "gameOver", outcome: { winner: "p1" } });
  });

  it("a body with NO Ability at the same HP dies to the same hit", () => {
    // The Ability is doing the work, not the arithmetic. RED if the clamp stops
    // reading `passivesOf` and fires on every full-HP body in the game.
    const state = board(13, { defender: "fix-bigbody" });
    deepFreeze(state);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: OVERKILL });
    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
  });

  it("the DAMAGE_DEALT row carries `survived` and keeps `dealt` honest", () => {
    const clamped = mustApply(board(14), { type: "attack", seat: "p1", index: BLAST });
    expect(findEvent(clamped.events, "DAMAGE_DEALT")).toMatchObject({
      dealt: STURDY_HP,
      damage: STURDY_SURVIVES_AT,
      survived: true,
    });
    const ordinary = mustApply(board(15, { defender: "fix-bigbody" }), {
      type: "attack",
      seat: "p1",
      index: BLAST,
    });
    expect(findEvent(ordinary.events, "DAMAGE_DEALT")?.survived).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE THREE-WAY ORDER WITNESS — one board, both recoil siblings, both answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("the order witness — survival, death, and the two recoils, on ONE board", () => {
  function witness(seed: number, damage: number): GameState {
    return board(seed, { tools: ["sv01-193", "sv03-197"], defenderDamage: damage });
  }

  it("FULL HP: survives at 10, no KO, no Prize — and Vengeful Punch is SILENT while Rocky Helmet FIRES", () => {
    const state = witness(20, 0);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BLAST });

    expect(done.players.p2.active?.damage).toBe(STURDY_SURVIVES_AT);
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    expect(done.players.p1.prizes).toHaveLength(6);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(recoils(events).map((r) => r.amount)).toEqual([HELMET_HP]);
    expect(done.players.p1.active?.damage).toBe(HELMET_HP);
  });

  it("ONE damage counter on the SAME body: dies, the game is won, and BOTH recoils pay", () => {
    // The discriminating half, and the only thing that changed is the defender's
    // starting damage. RED if the clamp fires on a damaged body — the survivor would
    // reappear and Vengeful Punch's 40 would vanish with the KO.
    const state = witness(21, 10);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BLAST });

    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
    expect(recoils(events).map((r) => r.amount)).toEqual([HELMET_HP, PUNCH_HP]);
    expect(done.players.p1.active?.damage).toBe(HELMET_HP + PUNCH_HP); // 60
    expect(done.phase).toMatchObject({ kind: "gameOver", outcome: { winner: "p1" } });
  });

  it("the two boards differ in the EVENT STREAM, not just in the numbers", () => {
    // The shapes, side by side: the survivor's stream carries no KNOCKED_OUT at all,
    // and the casualty's does. Pins that the difference is structural rather than a
    // damage total that happens to read differently.
    const survived = mustApply(witness(22, 0), { type: "attack", seat: "p1", index: BLAST });
    const died = mustApply(witness(23, 10), { type: "attack", seat: "p1", index: BLAST });

    expect(types(survived.events)).not.toContain("KNOCKED_OUT");
    expect(types(died.events)).toContain("KNOCKED_OUT");
    expect(recoils(survived.events)).toHaveLength(1);
    expect(recoils(died.events)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. WRITE SITES 2–4 — the interpreter's three attack-damage writes.
// ─────────────────────────────────────────────────────────────────────────────

describe("write sites 2-4 — spreadDamage, placeSnipe's `deals` arm, snipeActive", () => {
  it("spreadDamage clamps a BENCHED full-HP holder and KOs the damaged one beside it", () => {
    const state = board(30, {
      defender: "fix-bigbody",
      bench: [
        { id: "fix-sturdy" }, // full HP → survives
        { id: "fix-sturdy", damage: 10 }, // one counter → dies
        { id: "fix-titan" }, // 340 HP filler: a 120 spread cannot KO it
      ],
    });
    const doomedUid = benchTopUid(state, "p2", 1);
    deepFreeze(state);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SHOCKWAVE,
    });

    expect(all(events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([doomedUid]);
    const rows = all(events, "DAMAGE_DEALT").filter((e) => e.survived === true);
    expect(rows).toHaveLength(1); // exactly ONE body was clamped
    expect(rows[0]?.damage).toBe(STURDY_SURVIVES_AT);
    // The survivor is still on the bench, on 110; the casualty is gone.
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(benched(done, "fix-sturdy")?.damage).toBe(STURDY_SURVIVES_AT);
    expect(
      done.players.p2.bench.filter((p) => done.cardIdByUid[p.stack.at(-1) ?? ""] === "fix-sturdy"),
    ).toHaveLength(1);
  });

  it("placeSnipe's `deals` arm clamps a chosen BENCHED holder", () => {
    const state = board(31, {
      defender: "fix-bigbody",
      bench: [{ id: "fix-sturdy" }, { id: "fix-titan" }],
    });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: PINPOINT });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      dealt: STURDY_HP,
      damage: STURDY_SURVIVES_AT,
      survived: true,
    });
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    expect(benched(done, "fix-sturdy")?.damage).toBe(STURDY_SURVIVES_AT);
  });

  it("snipeActive clamps an ACTIVE holder picked by an opponentAny snipe", () => {
    // The fourth write site — the one arm that runs the full §8.5 pipeline from
    // inside the interpreter. RED if `snipeActive` keeps its own
    // `target.active.damage + dealt` write after the clamp was added to the event.
    const state = board(32, { bench: [{ id: "fix-titan" }] });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: ARROW });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      damage: STURDY_SURVIVES_AT,
      survived: true,
    });
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(STURDY_SURVIVES_AT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE BOUNDARY — "damage from an attack", asserted rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the boundary — a PLACED COUNTER is not damage from an attack", () => {
  it("a 12-COUNTER snipe kills the full-HP holder that an identical 120 of DAMAGE would spare", () => {
    const state = board(40, {
      defender: "fix-bigbody",
      bench: [{ id: "fix-sturdy" }, { id: "fix-titan" }],
    });
    const doomedUid = benchTopUid(state, "p2", 0);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: STING });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");

    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({ amount: 120 });
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(findEvent(events, "KNOCKED_OUT")?.uid).toBe(doomedUid);
  });

  it("CHECKUP BURN Knocks Out a FULL-HP holder — §13 is not an attack", () => {
    let state = board(41, { defender: "fix-sturdytiny", bench: [{ id: "fix-bigbody" }] });
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    expect(state.players.p2.active?.damage).toBe(0); // full HP going in
    state = setConditions(state, "p2", { burned: true });
    const holderUid = activeUid(state, "p2");

    const { events } = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({ amount: 20, source: "burn" });
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined(); // no attack happened
    expect(findEvent(events, "KNOCKED_OUT")?.uid).toBe(holderUid);
  });

  it("CHECKUP POISON Knocks Out a FULL-HP holder too", () => {
    let state = board(42, { defender: "fix-sturdytiny", bench: [{ id: "fix-bigbody" }] });
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = setConditions(state, "p2", { poisonDamage: 20 });
    const holderUid = activeUid(state, "p2");

    const { events } = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({ amount: 20, source: "poison" });
    expect(findEvent(events, "KNOCKED_OUT")?.uid).toBe(holderUid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. effectiveMaxHp — the Bravery Charm board, in BOTH directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("effectiveMaxHp and NOT the printed hp — the Bravery Charm board", () => {
  it("+50 HP moves the BAR: a 120 that used to be lethal no longer is, so nothing clamps", () => {
    const state = board(50, { tools: ["sv02-173"] });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BLAST });

    expect(done.players.p2.active?.damage).toBe(120); // plain damage, not 110
    expect(findEvent(events, "DAMAGE_DEALT")?.survived).toBeUndefined();
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("+50 HP also moves the SURVIVOR: a 300 leaves it on 10 of SEVENTEEN, i.e. 160 damage", () => {
    const state = board(51, { tools: ["sv02-173"] });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: OVERKILL,
    });

    expect(done.players.p2.active?.damage).toBe(170 - REMAINING); // 160
    expect(findEvent(events, "DAMAGE_DEALT")?.survived).toBe(true);
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
  });
});

describe("§9 — an Ability-lock switches the survival OFF", () => {
  function lockBoard(seed: number, locked: boolean): GameState {
    return board(seed, {
      defender: locked ? "sv01-096" : "fix-bigbody",
      bench: [{ id: "fix-sturdy" }],
    });
  }

  it("under Klefki the holder DIES to a hit it would otherwise survive", () => {
    const locked = lockBoard(60, true);
    const holderUid = benchTopUid(locked, "p2", 0);
    const { events } = mustApply(locked, { type: "attack", seat: "p1", index: SHOCKWAVE });
    expect(findEvent(events, "KNOCKED_OUT")?.uid).toBe(holderUid);
    expect(all(events, "DAMAGE_DEALT").some((e) => e.survived === true)).toBe(false);
  });

  it("…and WITHOUT the lock, the same board, the same attack, it survives", () => {
    // The control that makes the previous test a measurement. RED if the lock stops
    // reaching the fold — both tests would then report "survives" and the pair would
    // agree vacuously.
    const open = lockBoard(61, false);
    const { events } = mustApply(open, { type: "attack", seat: "p1", index: SHOCKWAVE });
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    expect(all(events, "DAMAGE_DEALT").some((e) => e.survived === true)).toBe(true);
  });
});

describe("the log — rendered under BOTH seats and READ, not copied", () => {
  function render(state: GameState, events: GameEvent[]): string {
    const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
    return logFromEvents(events, ctx)
      .flatMap((entry) =>
        entry.kind === "turn"
          ? []
          : [`${entry.who}: ${entry.segments.map((s) => s.text).join("")}`],
      )
      .join("\n");
  }

  it("THE FLAG WAS EMITTED AT FOUR SITES AND NOTHING RENDERED IT — it does now", () => {
    const { state, events } = mustApply(board(70), { type: "attack", seat: "p1", index: OVERKILL });
    expect(findEvent(events, "DAMAGE_DEALT")?.survived).toBe(true);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(render(state, events)).toContain(
      "p1: dealt 300 damage to Sturdymon · survived the Knock Out",
    );
  });

  it("the row is filed under the ATTACKER's seat, and the wording is true there", () => {
    const { state, events } = mustApply(board(71), { type: "attack", seat: "p1", index: BLAST });
    expect(findEvent(events, "DAMAGE_DEALT")?.seat).toBe("p2"); // the victim's seat…
    expect(render(state, events)).toContain("p1: ");
  });

  it("a hit that did NOT clamp carries no crumb", () => {
    const { state, events } = mustApply(board(72, { defender: "fix-bigbody" }), {
      type: "attack",
      seat: "p1",
      index: BLAST,
    });
    expect(findEvent(events, "DAMAGE_DEALT")?.survived).toBeUndefined();
    expect(render(state, events)).not.toContain("· survived");
  });

  it("the crumb sits LAST, after every §8.5 breadcrumb it follows", () => {
    const { state, events } = mustApply(board(73, { tools: ["sv02-173"] }), {
      type: "attack",
      seat: "p1",
      index: OVERKILL,
    });
    const line = render(state, events)
      .split("\n")
      .find((r) => r.includes("· survived"));
    expect(line?.endsWith("· survived the Knock Out")).toBe(true);
  });

  it("…and it reads identically on a BENCHED body reached by a spread", () => {
    const state = board(74, { defender: "fix-bigbody", bench: [{ id: "fix-sturdy" }] });
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SHOCKWAVE,
    });
    expect(render(done, events)).toContain(
      "p1: dealt 120 damage to Sturdymon · survived the Knock Out",
    );
  });
});
