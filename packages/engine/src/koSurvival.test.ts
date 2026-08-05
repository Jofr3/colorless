import { describe, expect, it } from "vitest";
import { koSurvivalClamp, passivesOf } from "./continuous";
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
} from "./testFixtures";

// 0.134.0 → 0.135.0 — the §8.1 KO-SURVIVAL CLAMP (P3-M5, D208):
//
//   "If this Pokémon has full HP and would be Knocked Out by damage from an
//    attack, it is not Knocked Out, and its remaining HP becomes 10."
//
// SEVEN printings, all seven Standard-legal, under TWO Ability names: Pikachu ex
// "Resolute Heart" (sv08-057, sv08-219, sv08-238, sv08-247, sv08.5-179) and
// Crustle "Sturdy" (sv10.5b-052, sv10.5b-130). Census re-derived for this slice
// against the remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786
// rows / 20 sets, 2,021 legal) on 2026-08-04, with `json_each(abilities_json)` and
// an EQUALITY on the effect string — not `LIKE` (case-insensitive in this engine)
// and not a grouped `attacks_json` scan, which is the exact shape that made D206
// and D207 each attribute a sentence to the wrong row.
//
// 🛑 THE PLACEMENT IS THE WHOLE SLICE, AND D199's REMAINDER ROW HAD IT WRONG.
// That row filed this as "a §8.1 KO-SURVIVAL hook on `PassiveEffects`" resolved at
// the KO sweep, beside `onKoPrizeGuard`. It cannot go there. The printed antecedent
// is "has FULL HP" — a fact about the PRE-damage board — and the engine's ONE
// lethality test, `isLethallyDamaged`, reads `pokemon.damage`, which by the time it
// runs ALREADY INCLUDES the hit. Every call site of that predicate (`lethalRefs`,
// `collectKnockOuts`, `koRecoilOf`, turn.ts's post-evolution check) is post-damage,
// and all four of the engine's KO/post-KO detection sites (`onKnockOutTrigger`,
// `triggersOf`, `passivesOf`'s sweep readers, `koToolTriggersOf`) are post-KO. The
// datum the sentence turns on has been destroyed before any of them can ask.
//
// So this is a CLAMP AT THE DAMAGE WRITE, not a fifth detection site: one helper
// (`koSurvivalClamp`) called from the four sites that emit `DAMAGE_DEALT` — attack.ts's
// main hit and interpreter.ts's `spreadDamage`, `placeSnipe`'s `deals` arm and
// `snipeActive` — each of which still holds the pre-hit body. ZERO detection sites
// were added or touched. D171 bought the fourth at a high price; this slice buys none.
//
// ⚠️ THE COLLISIONS ANSWER THEMSELVES BECAUSE OF THAT PLACEMENT, and every one is
// driven below rather than argued: once the clamped total is on the board the
// survivor simply IS NOT lethally damaged, so `lethalRefs` skips it, no
// `KNOCKED_OUT` fires, no Prize is staged, no `ko:` phase is entered, and
// `koRecoilOf`'s `doomed` set — taken from `lethalRefs` itself — excludes it, so
// Vengeful Punch stays silent. Rocky Helmet's `damageAttacker` still fires, because
// its gate is `dealt > 0` and the clamp deliberately never touches `dealt`.

/** The printed sentence, byte-for-byte off the remote D1 row (2026-08-04). All
    seven printings carry it identically — asserted, not assumed. */
const KO_SURVIVAL_TEXT =
  "If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10.";

/** The seven Standard-legal printings, in the order the census returned them. */
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
const STING = 5; // 12 damage COUNTERS — the boundary control, must NOT clamp

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Every recoil row the §9/§8.1 family produced, in site order. */
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

/** The printed Ability text a `FIXTURE_POOL` body carries, for the assertion that
    licenses driving real printings on synthetic bodies. */
function fixtureAbilityText(id: string): string | undefined {
  return FIXTURE_POOL[id]?.abilities?.[0]?.effect;
}

/** The p2 body carrying `id`, found by card id rather than by bench slot. */
function benched(state: GameState, id: string) {
  return state.players.p2.bench.find((p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === id);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The printed datum — re-queried for this slice, never inherited.
// ─────────────────────────────────────────────────────────────────────────────

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
    // The behaviour below is driven on fixtures because all seven real ids are
    // outside the local 6-set catalog manifest, which cannot be regenerated
    // (SQLITE_CANTOPEN). This is what licenses that substitution: same program,
    // same printed sentence. RED if a fixture's text drifts from the D1 row — which
    // is the failure mode that would make every board below prove nothing.
    for (const id of ["fix-sturdy", "fix-sturdytiny"]) {
      expect(programFor(id)?.passive, id).toEqual({ survivesKoAtFullHp: true });
      expect(fixtureAbilityText(id), id).toBe(KO_SURVIVAL_TEXT);
    }
  });

  it("⚠️ REFUSES the two neighbours the census surfaced — neither is this sentence", () => {
    // Machamp sv03.5-068 "Guts" prints the same CONSEQUENT with no "full HP"
    // antecedent and a COIN FLIP in front of it, and is `legal_standard = 0`
    // (mark G). Survival Brace sv06-164 is the TOOL twin — 1 Standard-legal — and
    // adds "Then, discard this card.", which this flag cannot express: a passive
    // fold has no way to consume its own source. Both are UNAUTHORED, deliberately.
    // RED the moment someone folds either into `KO_SURVIVAL` for the printing count.
    expect(programFor("sv03.5-068")).toBeUndefined();
    expect(programFor("sv06-164")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE PLACEMENT CLAIM — driven, not asserted in a comment.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ the placement — why this is a WRITE-SITE clamp and not a KO-sweep hook", () => {
  it("isLethallyDamaged CANNOT see the antecedent: it reads a total that already includes the hit", () => {
    // The structural fact D199's row missed, driven directly. Two bodies that a KO
    // sweep cannot tell apart: one that HAD full HP and one that did not, both
    // sitting at the same post-hit total. `isLethallyDamaged` answers TRUE for both
    // — identically — so no predicate downstream of the write can implement "has
    // full HP". RED if `isLethallyDamaged` ever starts carrying pre-hit state.
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
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, STURDY_HP)).toBe(STURDY_SURVIVES_AT);
    expect(koSurvivalClamp(state, { ...pokemon, damage: 10 }, STURDY_HP - 10)).toBeNull();
  });

  it("the clamp's lethality test AGREES with isLethallyDamaged, boundary for boundary", () => {
    // The two predicates cannot share code — flow.ts imports continuous.ts, so the
    // arrow cannot reverse — so the agreement is asserted instead. This is the
    // guard that kills the `>` mutant: at EXACTLY lethal the engine's own KO test
    // says "dead", so the clamp must fire. RED if either side flips to `>`.
    const state = board(2);
    const pokemon = state.players.p2.active;
    if (pokemon === undefined || pokemon === null) throw new Error("no active");

    for (const dealt of [STURDY_HP - 10, STURDY_HP - 1, STURDY_HP, STURDY_HP + 1, 300]) {
      const wouldDie = isLethallyDamaged(state, { ...pokemon, damage: dealt });
      const clamped = koSurvivalClamp(state, { ...pokemon, damage: 0 }, dealt);
      expect(clamped !== null, `dealt ${dealt}`).toBe(wouldDie);
    }
    // …and the boundary really is where it is claimed to be, spelled out so the
    // loop above cannot pass vacuously on an all-false or all-true run.
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, STURDY_HP - 1)).toBeNull();
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, STURDY_HP)).toBe(STURDY_SURVIVES_AT);
  });

  it("refuses a ZERO or PREVENTED hit — there is no Knock Out to refuse", () => {
    // ⚠️ AND IT DOES SO WITH NO DEDICATED GUARD, WHICH IS A REPORTED MUTATION
    // FINDING. A `dealt <= 0` early return was written and proved UNKILLABLE: to
    // reach the lethality test the body must already be at `damage === 0`, and
    // `effectiveMaxHp` never returns a non-positive number, so `0 + dealt >= hp`
    // needs `dealt >= 1`. The comparison below already refuses this case on the
    // right ground. The branch was REMOVED (D205's precedent) and the BEHAVIOUR
    // kept here — so this test still goes RED if the lethality comparison is ever
    // loosened to something a 0 or negative `dealt` could satisfy.
    const state = board(3);
    const pokemon = state.players.p2.active;
    if (pokemon === undefined || pokemon === null) throw new Error("no active");
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, 0)).toBeNull();
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, -10)).toBeNull();
  });

  it("a body WITHOUT the passive is never clamped, at any damage", () => {
    // The control for every board below. RED if the passive read is dropped and the
    // clamp becomes unconditional — the "forget the antecedent" mutant's other half.
    const state = board(4, { defender: "fix-bigbody" });
    const pokemon = state.players.p2.active;
    if (pokemon === undefined || pokemon === null) throw new Error("no active");
    expect(passivesOf(state, pokemon).survivesKoAtFullHp).toBe(false);
    expect(koSurvivalClamp(state, { ...pokemon, damage: 0 }, 999)).toBeNull();
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
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
    expect(done.players.p1.prizes).toHaveLength(6); // no Prize taken
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" }); // no ko: park
  });

  it("a 300 OVERKILL lands on the SAME 10 HP — the clamp is a floor on the RESULT", () => {
    // The printed sentence names an outcome ("its remaining HP becomes 10"), not a
    // subtraction, so the excess is irrelevant. RED if the clamp is ever written as
    // "cap the damage at maxHp − 10" applied to `dealt` — that arithmetic happens to
    // agree at exactly-lethal and diverges here.
    const state = board(11);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: OVERKILL,
    });

    expect(done.players.p2.active?.damage).toBe(STURDY_SURVIVES_AT); // still 110
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
    // …and `dealt` is NOT clamped: the attack really did deal 300.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 300, damage: STURDY_SURVIVES_AT });
  });

  it("ONE damage counter and the same body dies normally — the printed antecedent", () => {
    // "has FULL HP". RED if the `pokemon.damage !== 0` guard is dropped (the
    // "survives always" mutant), which is the single most likely authoring mistake.
    const state = board(12, { defenderDamage: 10 });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BLAST });

    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(done.phase.kind).toBe("ko:takePrizes");
  });

  it("a body with NO Ability at the same HP dies to the same hit", () => {
    // The Ability is doing the work, not the arithmetic. RED if the clamp stops
    // reading `passivesOf` and fires on every full-HP body in the game.
    const state = board(13, { defender: "fix-bigbody" });
    deepFreeze(state);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: OVERKILL });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
  });

  it("the DAMAGE_DEALT row carries `survived` and keeps `dealt` honest", () => {
    // The event widening. `dealt` stays the pipeline's real output and `damage` the
    // clamped total, so the row reconstructs in printed order; the flag is what
    // stops that looking like an arithmetic bug. RED if `survived` is emitted on an
    // ordinary hit, or omitted on a clamped one.
    const clamped = mustApply(board(14), { type: "attack", seat: "p1", index: BLAST });
    expect(find(clamped.events, "DAMAGE_DEALT")).toMatchObject({
      dealt: STURDY_HP,
      damage: STURDY_SURVIVES_AT,
      survived: true,
    });
    const ordinary = mustApply(board(15, { defender: "fix-bigbody" }), {
      type: "attack",
      seat: "p1",
      index: BLAST,
    });
    expect(find(ordinary.events, "DAMAGE_DEALT")?.survived).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE THREE-WAY ORDER WITNESS — one board, both recoil siblings, both answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ the order witness — survival, death, and the two recoils, on ONE board", () => {
  /** The survivor wearing BOTH recoil Tools, so one attack declaration answers
      both collisions at once. Two Tools on one body is a surgical board (the §
      one-Tool cap lives at the attach gate, and Revavroom ex raises it to 4), and
      it is what makes the two answers comparable rather than two experiments. */
  function witness(seed: number, damage: number): GameState {
    return board(seed, { tools: ["sv01-193", "sv03-197"], defenderDamage: damage });
  }

  it("FULL HP: survives at 10, no KO, no Prize — and Vengeful Punch is SILENT while Rocky Helmet FIRES", () => {
    // The whole slice in one assertion. The KO-conditioned recoil owes nothing
    // because NO KNOCK OUT OCCURRED — and that falls out of the placement for free:
    // `koRecoilOf` takes its `doomed` set from `lethalRefs`, which reads the already
    // clamped board. The damage-conditioned recoil still fires because its gate is
    // `dealt > 0` and the clamp never touches `dealt`.
    //
    // RED in four independent ways: if the clamp does not fire (KNOCKED_OUT + a
    // Prize + a 60 recoil), if it fires but `koRecoilOf` re-derives lethality from
    // something other than the board (a 40 appears), if `dealt` is clamped to 0 by a
    // well-meaning author (Rocky Helmet's 20 vanishes), or if the survivor lands
    // anywhere but 110.
    const state = witness(20, 0);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BLAST });

    expect(done.players.p2.active?.damage).toBe(STURDY_SURVIVES_AT);
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
    expect(done.players.p1.prizes).toHaveLength(6);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // EXACTLY ONE recoil row, and it is the damage-conditioned one.
    expect(recoils(events).map((r) => r.amount)).toEqual([HELMET_HP]);
    expect(done.players.p1.active?.damage).toBe(HELMET_HP);
  });

  it("ONE damage counter on the SAME body: dies, Prize owed, and BOTH recoils pay", () => {
    // The discriminating half, and the only thing that changed is the defender's
    // starting damage. RED if the clamp fires on a damaged body — the survivor would
    // reappear and Vengeful Punch's 40 would vanish with the KO.
    const state = witness(21, 10);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BLAST });

    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(recoils(events).map((r) => r.amount)).toEqual([HELMET_HP, PUNCH_HP]);
    expect(done.players.p1.active?.damage).toBe(HELMET_HP + PUNCH_HP); // 60
    expect(done.phase.kind).toBe("ko:takePrizes");
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
    // ONE spread, TWO holders, opposite answers — the cleanest form of the
    // antecedent, since both bodies take the identical 120 from the identical
    // attack. Neither printing carries an "Active Spot" clause, so the Bench is
    // where these cards actually live. RED if `spreadDamage` writes
    // `pokemon.damage + dealt` unclamped, or if the clamp is hoisted out of the
    // per-target loop and answers once for the whole bench.
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
    // Attack damage to a chosen benched body (Wo-Chien "Covetous Ivy"'s arm). RED if
    // the clamp is added to `placeSnipe` but on the wrong branch — which is the
    // mistake the next test exists to catch from the other side.
    // TWO benched bodies, because a count-1 pick over a ONE-body bench is forced
    // and resolves without parking — the choice has to be real for this to exercise
    // the chosen-target path at all.
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
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      dealt: STURDY_HP,
      damage: STURDY_SURVIVES_AT,
      survived: true,
    });
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
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
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      damage: STURDY_SURVIVES_AT,
      survived: true,
    });
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(STURDY_SURVIVES_AT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE BOUNDARY — "damage from an attack", asserted rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ the boundary — a PLACED COUNTER is not damage from an attack", () => {
  it("a 12-COUNTER snipe kills the full-HP holder that an identical 120 of DAMAGE would spare", () => {
    // THE boundary assertion, and it is a driven difference rather than a claim
    // about two functions: `Sting` and `Pinpoint` are the same op (`damageChosen`,
    // count 1, the opponent's Bench) reaching the SAME `placeSnipe` with the same
    // 120 HP, and they differ only on `deals`. The counter arm places, which "is not
    // damage from an attack" (D138/D139/D142) — the same line that already denies it
    // Weakness, Resistance and every reduction passive. So the holder dies.
    //
    // RED if the clamp is added to `placeSnipe` above the `deals` branch instead of
    // inside it — the single most plausible mis-placement in this file, and one that
    // no amount of testing the `deals` arm would catch.
    // The same two-body bench as the `deals` test above, for the same reason and so
    // the two boards differ ONLY in which attack is declared.
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
    // Counters, not damage: the resume emits a COUNTERS_PLACED and NOT ONE
    // DAMAGE_DEALT row — which is the boundary stated in the event stream itself,
    // and is why the clamp (which lives on the DAMAGE_DEALT writes) cannot reach
    // here even in principle. The holder dies with full HP and its Ability intact.
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: 120 });
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(doomedUid);
  });

  it("CHECKUP BURN Knocks Out a FULL-HP holder — §13 is not an attack", () => {
    // The Checkup half of the same boundary, on the 20 HP twin because that is the
    // only HP at which a §13 tick is lethal at all. A full-HP body, the identical
    // antecedent, and it dies — because burn places counters (flow.ts
    // COUNTERS_PLACED source "burn") and never touches the clamp.
    //
    // RED if the clamp is ever hoisted into a shared "add damage" helper that the
    // Checkup also calls — the survivor would appear on 10 and §13 would stop
    // killing anything at full HP.
    let state = board(41, { defender: "fix-sturdytiny", bench: [{ id: "fix-bigbody" }] });
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    expect(state.players.p2.active?.damage).toBe(0); // full HP going in
    state = setConditions(state, "p2", { burned: true });
    const holderUid = activeUid(state, "p2");

    const { events } = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: 20, source: "burn" });
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined(); // no attack happened
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(holderUid);
  });

  it("CHECKUP POISON Knocks Out a FULL-HP holder too", () => {
    // Poison's twin of the above, and it is a separate case rather than a duplicate:
    // burn and poison are two loops at two §13 steps, and a clamp leaking into one
    // would not necessarily leak into the other. The counter is raised to 20 so the
    // tick is exactly lethal on the 20 HP body — `poisonDamage` is a field for
    // precisely this reason.
    let state = board(42, { defender: "fix-sturdytiny", bench: [{ id: "fix-bigbody" }] });
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = setConditions(state, "p2", { poisonDamage: 20 });
    const holderUid = activeUid(state, "p2");

    const { events } = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: 20, source: "poison" });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(holderUid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. effectiveMaxHp — the Bravery Charm board, in BOTH directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ effectiveMaxHp and NOT the printed hp — the Bravery Charm board", () => {
  it("+50 HP moves the BAR: a 120 that used to be lethal no longer is, so nothing clamps", () => {
    // Direction one. Under Bravery Charm the 120 HP Basic has 170 effective HP, so
    // the exactly-lethal Blast is merely damage — the clamp must NOT fire and the
    // body must sit on a plain 120. RED if the clamp reads the printed `hp`: it
    // would see 120 >= 120, fire, and park the body on 110 — LESS damage than it
    // actually took, from a hit that was never lethal.
    const state = board(50, { tools: ["sv02-173"] });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BLAST });

    expect(done.players.p2.active?.damage).toBe(120); // plain damage, not 110
    expect(find(events, "DAMAGE_DEALT")?.survived).toBeUndefined();
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("+50 HP also moves the SURVIVOR: a 300 leaves it on 10 of SEVENTEEN, i.e. 160 damage", () => {
    // Direction two, and the one that pins which number the "becomes 10" is read
    // against. RED if the clamp computes `printedHp − 10` (110) rather than
    // `effectiveMaxHp − 10` (160) — a mutant the previous test cannot see, because
    // there the clamp correctly does not fire at all.
    const state = board(51, { tools: ["sv02-173"] });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: OVERKILL,
    });

    expect(done.players.p2.active?.damage).toBe(170 - REMAINING); // 160
    expect(find(events, "DAMAGE_DEALT")?.survived).toBe(true);
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. §9 — both printings are ABILITIES, so a lock switches the survival off.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ §9 — an Ability-lock switches the survival OFF", () => {
  /** Klefki "Mischievous Lock" is Active-only and locks BASIC Pokémon on BOTH
      sides, so it sits in P2's Active spot and the holder is Benched, reached by
      the spread. `locked: false` swaps in a bodied control with no Ability at all,
      so the only difference between the two boards is the lock itself. */
  function lockBoard(seed: number, locked: boolean): GameState {
    return board(seed, {
      defender: locked ? "sv01-096" : "fix-bigbody",
      bench: [{ id: "fix-sturdy" }],
    });
  }

  it("under Klefki the holder DIES to a hit it would otherwise survive", () => {
    // The §9 answer, driven. This is what the `disabled` drop on `sources[0]` buys,
    // and it is the reason the flag rides `passivesOf` rather than being read
    // straight off the catalog row at the four write sites — a build that did the
    // latter would be shorter and would get this silently wrong.
    const locked = lockBoard(60, true);
    const holderUid = benchTopUid(locked, "p2", 0);
    const { events } = mustApply(locked, { type: "attack", seat: "p1", index: SHOCKWAVE });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(holderUid);
    expect(all(events, "DAMAGE_DEALT").some((e) => e.survived === true)).toBe(false);
  });

  it("…and WITHOUT the lock, the same board, the same attack, it survives", () => {
    // The control that makes the previous test a measurement. RED if the lock stops
    // reaching the fold — both tests would then report "survives" and the pair would
    // agree vacuously.
    const open = lockBoard(61, false);
    const { events } = mustApply(open, { type: "attack", seat: "p1", index: SHOCKWAVE });
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
    expect(all(events, "DAMAGE_DEALT").some((e) => e.survived === true)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Voice — the flag D208 emitted at four sites and nothing rendered (D219).
// ─────────────────────────────────────────────────────────────────────────────

describe("the log — rendered under BOTH seats and READ, not copied", () => {
  /** Render every non-turn row as "<who>: <text>". `attackerFilter.test.ts`'s
      helper verbatim, so the two crumbs' voice tests compare line for line. */
  function render(state: GameState, events: GameEvent[]): string {
    const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
    return logFromEvents(events, ctx)
      .flatMap((entry) =>
        entry.kind === "turn" ? [] : [`${entry.who}: ${entry.segments.map((s) => s.text).join("")}`],
      )
      .join("\n");
  }

  it("⚠️ THE FLAG WAS EMITTED AT FOUR SITES AND NOTHING RENDERED IT — it does now", () => {
    // D159's finding one field down, and one slice old rather than seventy-six.
    // Before this crumb the row read "dealt 300 damage to fix-sturdy", NO
    // KNOCKED_OUT row followed it, and the board sat at 10 HP with nothing saying
    // why. RED if the crumb is dropped, or if it stops naming the damaged body.
    const { state, events } = mustApply(board(70), { type: "attack", seat: "p1", index: OVERKILL });
    expect(find(events, "DAMAGE_DEALT")?.survived).toBe(true);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(render(state, events)).toContain(
      "p1: dealt 300 damage to Sturdymon · survived the Knock Out",
    );
  });

  it("the row is filed under the ATTACKER's seat, and the wording is true there", () => {
    // The voice question, asked rather than inherited. `DAMAGE_DEALT.seat` owns the
    // DAMAGED Pokémon; the ROW is `otherSeat(seat)`. So a crumb naming an owner or
    // a SOURCE would be spoken from the wrong chair — and the source is unknowable
    // here anyway: TWO printed Ability names set this one flag and the event
    // carries no member telling them apart.
    const { state, events } = mustApply(board(71), { type: "attack", seat: "p1", index: BLAST });
    expect(find(events, "DAMAGE_DEALT")?.seat).toBe("p2"); // the victim's seat…
    expect(render(state, events)).toContain("p1: "); // …and P1's row.
  });

  it("a hit that did NOT clamp carries no crumb", () => {
    // Loudness is owed to a rule that FIRED, not to one that declined (D140). RED
    // if the crumb starts rendering off `dealt` or off the absence of a KO.
    const { state, events } = mustApply(board(72, { defender: "fix-bigbody" }), {
      type: "attack",
      seat: "p1",
      index: BLAST,
    });
    expect(find(events, "DAMAGE_DEALT")?.survived).toBeUndefined();
    expect(render(state, events)).not.toContain("· survived");
  });

  it("the crumb sits LAST, after every §8.5 breadcrumb it follows", () => {
    // The clamp runs on the pipeline's FINISHED `dealt`, so its crumb is the last
    // thing in the row — the same placement rule "· prevented" got, and for the
    // same reason. Bravery Charm moves the maximum, which is also the board that
    // licenses the crumb carrying no HP number: "10 HP left" here means 160 damage
    // on a 170 HP body, not the 110 a printed-HP reading would quote.
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
    // The other three write sites emit the same flag, and a spread files the row
    // under the same attacker while naming a body that was never the Active. RED if
    // the crumb is wired into the main-hit arm only.
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
