import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  deriveAttackEffect,
  deriveAttackOptionalCostBoost,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { engineVersion } from "./index";
import {
  FILTERED_BENCH_SNIPE_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  types,
} from "./testFixtures";

// 0.338.0 → 0.339.0 — 🆕🆕 D437: THE FILTERED BENCH SNIPE, and the first time a
// PER-BODY PREDICATE narrows a candidate set on this op.
//
//   "This attack also does 60 damage to 1 of your opponent's Benched Pokémon
//    **that has any damage counters on it**. (Don't apply Weakness and Resistance
//    for Benched Pokémon.)"
//
// **1 sentence / 3 legal printings** — `censusAttackCorpus.ts` row 528, over the
// committed `legal_standard = 1` attack column (640 sentences / 1,732 printings).
// The un-narrowed rider has shipped since 0.38.0; what is new is the clause in the
// middle of the noun phrase, and it lands on the CANDIDATE SET rather than on the
// damage.
//
// 🛑 **THE WHOLE SLICE IS THREE ARITIES, AND THE MIDDLE ONE IS THE TRAP.**
// `stepOp`'s `damageChosen` arm has always had three endings — 0 candidates is a
// silent no-op, `<= count` auto-takes (the M1 no-choice rule), anything more parks —
// and a narrowing MOVES BOARDS BETWEEN THEM:
//
//   • **EMPTY WHERE THE UNFILTERED SET WAS NOT.** Three undamaged benched bodies is
//     three candidates unfiltered and ZERO filtered. §3 drives it against the
//     un-narrowed twin on the SAME board as its one-axis control.
//   • **FORCED WHERE THE UNFILTERED SET WOULD HAVE PARKED.** One damaged body beside
//     two undamaged ones is not a decision. §4, with the same control.
//   • **PARKED, and the offer is exactly the printed set.** §5 — and it is the arm
//     D416 warns is invisible to a suite whose boards all field one candidate.
//
// 🛑 **THE SHIELD IS ASKED AFTER THE NARROWING (D433), AND THAT IS FREE ONLY
// BECAUSE THE NARROWING IS IN THE FUNNEL.** `snipeTargets` is what `programPlayable`
// shares (D345), and `placeSnipe` asks every §11-ish prevention INSIDE its loop over
// the refs it is handed — so a body the clause removed is never asked about. §6
// drives both halves: a shielded UNDAMAGED body files no row at all, and a shielded
// DAMAGED one (a printed candidate) files its refusal. Without the second case the
// first proves nothing, because a build that never asked anybody would pass it.
//
// WHAT SHIPS: **1 widened capture** in the shared fragment `ALSO_BENCHED_SNIPE_BODY`
// (its THIRD, and no caller's group indices move), **1 number-agreement guard**,
// **1 optional op field** (`damageChosen.damagedOnly`), **1 per-body reader**
// (`hasAnyDamageCounters`), **1 narrowing in `snipeTargets`**, **1 prompt-note
// rider**, **1 refusal** in `optionalCostPayoff`, and **1 fixture**. ZERO new ops,
// events, error codes, prompt kinds, choice kinds, exported readers, `BoardCondition`
// members, registry rows, interpreter arms, `redact.ts` bytes or `packages/schema`
// bytes — and `MATCH_RECORD_VERSION` stays **29**, driven both ways in §8.

/** THE PRINTED SENTENCE, byte-for-byte off `censusAttackCorpus.ts` row 528. */
const PRINTED =
  "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The SAME sentence with the narrowing clause deleted and nothing else changed —
    the one-axis control, and a real corpus shape (the flat rider, 15 printings at
    various amounts). */
const UNNARROWED =
  "This attack also does 60 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The printed clause, spelled once. */
const CLAUSE = " that has any damage counters on it";

/** Corpus row 596 — one of the FOUR siblings of the printed predicate this slice
    deliberately does NOT build, carried on the demonstrator at index 2 so the
    `ATTACK_EFFECT_SKIPPED` rung has its control on the SAME body. */
const UNREAD_SIBLING =
  "This attack does 50 damage for each of your Pokémon that has any damage counters on it.";

const PICKY = 0; // {C}, 30 damage, corpus row 528 — the NARROWED rider
const BLUNT = 1; // {C}, 30 damage — the same rider UN-narrowed: the one-axis control
const IDLE = 2; // {C}, 30 damage, corpus row 596 — deliberately unread

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

// ── boards ─────────────────────────────────────────────────────────────────────

/** A benched body to place: which card, and how much damage it walks in with. */
type Body = { id: string; damage: number };

/** `attacker` holds `fix-filteredsnipe` with one {C} attached, the far seat holds
    `fix-titan` (340 HP, no attacks — it survives the printed 30 and can never move
    a number of its own), BOTH benches are emptied, and the far seat's Bench is then
    rebuilt from `bench` with each body's damage set outright.

    ⚠️ THE TURN IS PASSED SO `attacker` IS THE SEAT TO ACT, which is what makes this
    helper seat-symmetric: every board below is drivable from either side by the same
    call, and §7 runs the whole shape from `p2`. */
function board(seed: number, attacker: Seat, bench: readonly Body[], defender = "fix-titan"): GameState {
  const victim = other(attacker);
  let state = driveSetup(
    seed,
    { p1: FILTERED_BENCH_SNIPE_DECK, p2: FILTERED_BENCH_SNIPE_DECK },
    { first: victim },
  );
  state = setActiveFromDeck(state, attacker, "fix-filteredsnipe");
  state = attachFromDeck(state, attacker, "fix-energy", 1);
  state = setActiveFromDeck(state, victim, defender);
  state = clearBench(clearBench(state, "p1"), "p2");
  state = mustApply(state, { type: "endTurn", seat: victim }).state;
  bench.forEach((body, index) => {
    state = benchFromDeck(state, victim, body.id);
    state = setBenchDamage(state, victim, index, body.damage);
  });
  return state;
}

const benchDamage = (state: GameState, seat: Seat): number[] =>
  state.players[seat].bench.map((p) => p.damage);

// ── §1 ─────────────────────────────────────────────────────────────────────────

describe("§1 — the price and the family, re-derived off the corpus rather than quoted", () => {
  it("🛑 the reader surface is the MODULE's, and it did not grow", () => {
    // D418's rule: the figures below come off `resolvedByAnyReader`, which walks
    // whatever `effects.ts` exports today. This slice adds an ARM inside
    // `deriveAttackEffect`, not a fourteenth reader, so the surface stands still —
    // and the count is pinned separately from any list, because a list is the thing
    // that rots.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the printed sentence is real, is worth THREE printings, and is now CLAIMED", () => {
    const row = corpus().filter(([, s]) => s === PRINTED);
    expect(row).toHaveLength(1);
    expect(units(row)).toBe(3);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    // The control sentence is the printed one minus exactly the clause, asserted by
    // reconstruction rather than by eye — the whole suite's one-axis claim.
    expect(PRINTED.replace(CLAUSE, "")).toBe(UNNARROWED);
  });

  it("🛑 THE FAMILY: five sentences share the predicate, and this slice builds ONE", () => {
    // 🛑 **THE PATTERN IS STATED SO ITS EDGES ARE VISIBLE** (D424/D425). The predicate
    // is grepped as `/that ha[sv]e? any damage counters/i` — loose enough to admit the
    // plural *"that have … on them"* spelling nothing prints today — and EVERY hit is
    // read, not the first N (D428). The concept is also grepped the OTHER way, one
    // rung down, as the bare noun phrase.
    const family = corpus().filter(([, s]) => /that ha[sv]e? any damage counters/i.test(s));
    expect(family).toHaveLength(5);
    expect(units(family)).toBe(7);
    // 🆕🆕🆕 **D450 — THE SPLIT IS 2 BUILT / 3 REFUSED, AND THE ROW THAT MOVED IS THE ONE
    // THIS FILE'S OWN NOTE PREDICTED.** D437 wrote that the four unbuilt members each
    // need a different CONSEQUENT and that `hasAnyDamageCounters` was "now there for
    // three of the four"; the first of those three — *"Put 2 damage counters on each of
    // your opponent's Pokémon that has any damage counters on it."*, corpus line 414 —
    // is built by arm 23f, which reuses THIS SLICE'S rider verbatim on `counterEachAll`
    // instead of on `damageChosen`. **The predicate really was the reusable half and the
    // consequent really was the cost**, which is the claim D437 made and could not check.
    // The THREE that remain each still need their own consequent: a both-sides benched
    // spread, a COUNT/scaler, and a both-sides spread with a self-exclusion.
    const built = family.filter(([, s]) => resolvedByAnyReader(s));
    expect(built.map(([, s]) => s).sort()).toEqual(
      [
        PRINTED,
        "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.",
      ].sort(),
    );
    expect(units(family.filter(([, s]) => !resolvedByAnyReader(s)))).toBe(3);
    // The unread sibling this suite's demonstrator carries at index 2 is one of the
    // four, so the `ATTACK_EFFECT_SKIPPED` control in §2 is a REAL printed sentence
    // rather than an invented one — and this rung is its tripwire.
    expect(family.map(([, s]) => s)).toContain(UNREAD_SIBLING);
    expect(resolvedByAnyReader(UNREAD_SIBLING)).toBe(false);
  });

  it("🛑 the concept grepped the OTHER way: 13 sentences say 'any damage counters'", () => {
    // The shortest unambiguous phrase, which admits the `If …, ` BOARD-CONDITION
    // spellings the predicate pattern above cannot see (D433: grep the concept two
    // ways). Eight of the thirteen are those gates and every one is already built;
    // the other five are the per-body family. **The two sets partition the thirteen**,
    // which is what makes "the family is five" a measurement rather than a filter.
    const wide = corpus().filter(([, s]) => /any damage counters/i.test(s));
    expect(wide).toHaveLength(13);
    expect(units(wide)).toBe(17);
    const perBody = wide.filter(([, s]) => /that ha[sv]e? any damage counters/i.test(s));
    const gates = wide.filter(([, s]) => !/that ha[sv]e? any damage counters/i.test(s));
    expect(perBody).toHaveLength(5);
    expect(gates).toHaveLength(8);
    // ⚠️ SEVEN of the eight, not all eight: *"If this Pokémon has any damage counters
    // on it, this attack can be used for {F}."* is a COST substitution, a shape no
    // reader in this engine claims. Named rather than swept under "the gates are
    // built", because a rung that says "all eight" would be false.
    expect(gates.filter(([, s]) => resolvedByAnyReader(s))).toHaveLength(7);
    expect(gates.filter(([, s]) => !resolvedByAnyReader(s)).map(([, s]) => s)).toEqual([
      "If this Pokémon has any damage counters on it, this attack can be used for {F}.",
    ]);
  });
});

// ── §2 ─────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the number agreement that keeps D399's rung true", () => {
  const NARROWED_OP: EffectOp = {
    op: "damageChosen",
    target: "opponentBench",
    amount: 60,
    count: 1,
    source: "attack",
    deals: true,
    damagedOnly: true,
  };

  it("🛑 the printed sentence derives the snipe PLUS `damagedOnly`, and nothing else", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([NARROWED_OP]);
    // The optional W/R clarifier is the fragment's own group and does not change the
    // op — the same sentence without it reads identically.
    expect(deriveAttackEffect(PRINTED.replace(" (Don't apply Weakness and Resistance for Benched Pokémon.)", ""))).toEqual([
      NARROWED_OP,
    ]);
  });

  it("🛑 the ONE-AXIS control: delete the clause and the SAME op comes back without the key", () => {
    // ⚠️ ABSENT, not `false`. `damageChosen` is compared by value on the wire and this
    // op PARKS, so the un-narrowed literal has to be byte-identical to the one that
    // shipped at D399 — `{ damagedOnly: undefined }` would not be.
    const plain = deriveAttackEffect(UNNARROWED);
    expect(plain).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 60, count: 1, source: "attack", deals: true },
    ]);
    expect("damagedOnly" in (plain?.[0] as object)).toBe(false);
  });

  it("🛑 THE NUMBER MUST AGREE — a singular clause at count 2 is REFUSED, count 2 bare is READ", () => {
    // D400's `agrees` rule, one anchor over. *"that has … on it"* is singular, so it
    // can only be printed against *"1 of"*; a 2-count printing would spell *"that
    // have … on them"*, which this fragment does not match at all. The disagreeing
    // spelling falls to the loud `ATTACK_EFFECT_SKIPPED` path rather than resolving on
    // a guess.
    const two = "This attack also does 60 damage to 2 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(deriveAttackEffect(two)).toBeNull();
    expect(resolvedByAnyReader(two)).toBe(false);
    // …and the ADMISSION on the same axis (D424): the same string minus the clause IS
    // read, at count 2, so what refuses it is the number agreement and not the arity.
    expect(deriveAttackEffect(two.replace(CLAUSE, ""))).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 60, count: 2, source: "attack", deals: true },
    ]);
    // The plural spelling no card prints is refused too, and by a different mechanism
    // — the fragment simply does not contain it.
    expect(
      deriveAttackEffect(two.replace(CLAUSE, " that have any damage counters on them")),
    ).toBeNull();
  });

  it("🛑 EXACTLY ONE reader claims the sentence, and the other twelve are driven", () => {
    // 🛑 OFF THE MODULE, NOT OFF A LIST (D418). The readers are walked by the same
    // `deriveAttack` name prefix `censusAttackCorpus.ts` uses, so a fourteenth reader
    // is covered here the day it lands rather than the day someone updates a literal.
    // ⚠️ AND THE CLAIM IS `=== 1`, NOT `deriveAttackEffect !== null`: a rung asserting
    // only that this reader answers is TRUE under a build that widened a second one
    // too, which is exactly the discrimination D418 found being dropped.
    const readers = Object.entries(effects).filter(
      ([name, value]) => name.startsWith("deriveAttack") && typeof value === "function",
    ) as [string, (text: string) => unknown][];
    expect(readers).toHaveLength(13);
    const claiming = readers.filter(([, read]) => read(PRINTED) !== null).map(([name]) => name);
    expect(claiming).toEqual(["deriveAttackEffect"]);
    // The two SPLITTERS are not on that surface and are asked by name: the sentence
    // arrives whole, through the anchor, and composition never sees it.
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("🛑 the THIRD caller of the shared fragment REFUSES the narrowing rather than dropping it", () => {
    // `optionalCostPayoff`'s `benchSnipe` record is `{amount, count}` — it has no slot
    // for a candidate-set narrowing. Honouring the clause would mean widening that
    // record for a composition **no card prints**; dropping it silently would ship a
    // snipe that hits an UNDAMAGED body the card never offered, which is the
    // wrong-but-plausible program D190b ranks below an unbuilt sentence. So: null.
    const cost = "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, ";
    const narrowed = `${cost}this attack also does 120 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
    expect(deriveAttackOptionalCostBoost(narrowed)).toBeNull();
    expect(resolvedByAnyReader(narrowed)).toBe(false);
    // …and the ADMISSION one axis away: the same sentence without the clause is the
    // shipped printing and still reads, so the refusal is the clause's and not the
    // cost's or the anchor's.
    const plain = deriveAttackOptionalCostBoost(narrowed.replace(CLAUSE, ""));
    expect(plain?.payoff).toEqual({ kind: "benchSnipe", amount: 120, count: 1 });
    // ⚠️ AND THE COMPOSITION IS ABSENT FROM THE CATALOG, asserted rather than
    // assumed — this is the measurement the refusal rests on, and it is executable, so
    // the day the catalog prints one this rung goes RED and the refusal is revisited
    // (D428: a refusal's falsifier should be executable).
    expect(corpus().filter(([, s]) => /You may .*Benched Pokémon that has any damage counters/.test(s))).toEqual([]);
  });

  it("🛑 the GATED caller reads it too — one fragment, one reading, three callers", () => {
    // D383 made the body shared so ONE printed clause keeps ONE reading. No card
    // prints the gated + narrowed composition today, and that is exactly why the
    // reading has to be stated rather than left to whichever caller happens to be
    // widened next.
    const gated =
      "If your opponent's Active Pokémon already has any damage counters on it, this attack also does 30 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it.";
    expect(deriveAttackEffect(gated)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveDamaged" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "damageChosen", target: "opponentBench", amount: 30, count: 1, source: "attack", deals: true, damagedOnly: true },
        ],
      },
    ]);
    expect(corpus().filter(([, s]) => s === gated)).toEqual([]);
  });
});

// ── §3 ─────────────────────────────────────────────────────────────────────────

describe("§3 — THE EMPTY FILTERED SET, against the board that would have parked", () => {
  const UNDAMAGED: Body[] = [
    { id: "fix-titan", damage: 0 },
    { id: "fix-titan", damage: 0 },
    { id: "fix-titan", damage: 0 },
  ];

  it("🛑 three UNDAMAGED benched bodies: the rider resolves and moves NOTHING", () => {
    const state = board(1, "p1", UNDAMAGED);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    // The main hit landed (§8 printed order, before the program).
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 30, dealt: 30 });
    expect(done.players.p2.active?.damage).toBe(30);
    // 🛑 THE SILENT AFTERMATH, ASSERTED RATHER THAN IMPLIED (D434): no prompt, no
    // second damage row, no counters, and the turn simply passes.
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(benchDamage(done, "p2")).toEqual([0, 0, 0]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // ⚠️ AND IT IS NOT AN `ATTACK_EFFECT_SKIPPED`. The sentence was READ; the printed
    // candidate set is simply empty on this board, which is the same silent ending an
    // empty Bench has always taken. A build that reported a skip here would be telling
    // the player the engine could not understand the card.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 THE ONE-AXIS CONTROL: the same board, the clause deleted, PARKS with three", () => {
    // The identical fixture, the identical Bench, the identical cost and amount — the
    // only difference between this rung and the one above is the printed clause. That
    // is what makes "zero candidates" attributable to the narrowing rather than to the
    // board (D214's attribution control).
    const state = board(1, "p1", UNDAMAGED);
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: BLUNT });
    expect(types(events)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates).toHaveLength(3);
  });

  it("🛑 an EMPTY Bench and an all-undamaged Bench take the same ending", () => {
    // The narrowing does not invent a new arm — it moves boards INTO the one that was
    // already there. Driven so a build that special-cased the filter's empty set would
    // have to say why.
    const state = board(2, "p1", []);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

// ── §4 ─────────────────────────────────────────────────────────────────────────

describe("§4 — FORCED AT ONE, where the unfiltered board would have parked", () => {
  const ONE_DAMAGED: Body[] = [
    { id: "fix-titan", damage: 0 },
    { id: "fix-titan", damage: 10 },
    { id: "fix-titan", damage: 0 },
  ];

  it("🛑 one damaged body among three: no prompt, and the 60 lands on IT alone", () => {
    // This is the case a build that filtered AFTER the arity decision gets wrong: it
    // would see three candidates, park, and ask a question the card does not pose.
    const state = board(3, "p1", ONE_DAMAGED);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // Two rows in one action: the main 30 on the Active, the rider's 60 on the Bench.
    const dealt = findAll(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    expect(dealt[1]).toMatchObject({ seat: "p2", base: 60, weakness: null, resistance: null, dealt: 60 });
    // ⚠️ **THE DAMAGE LANDS ON THE CHOSEN BODY ONLY**, and the two undamaged
    // neighbours are asserted at zero rather than left unmentioned.
    expect(benchDamage(done, "p2")).toEqual([0, 70, 0]);
    expect(done.players.p2.active?.damage).toBe(30);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 THE ONE-AXIS CONTROL: the same board, the clause deleted, PARKS", () => {
    const state = board(3, "p1", ONE_DAMAGED);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: BLUNT });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates).toHaveLength(3);
  });

  it("🛑 the predicate is PRESENCE, not a counter COUNT — a 5-damage body is a candidate", () => {
    // 🛑 THE SPELLING DECISION, PINNED. `hasAnyDamageCounters` is `damage > 0`, the
    // spelling all FIVE shipped `conditionHolds` arms use for this exact printed
    // phrase — not `damageCountersOn(p) >= 1`, which is the spelling `knockOutChosen`
    // uses for *"exactly N damage counters"*, where the comparand is a NUMBER and the
    // unit must therefore be counters (D436: the comparand fixes the unit).
    //
    // ⚠️ The two spellings agree on every board the engine can REACH — every writer of
    // `damage` in `interpreter.ts` moves a printed amount or a catalog HP figure, all
    // multiples of ten — so this board is constructible only as a fixture. It is driven
    // anyway, because a decision that is not pinned is indistinguishable from an
    // oversight (D421), and because it is what makes a `damageCountersOn` build a
    // KILLED mutant rather than an equivalent one.
    const state = board(4, "p1", [
      { id: "fix-titan", damage: 5 },
      { id: "fix-titan", damage: 0 },
    ]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(benchDamage(done, "p2")).toEqual([65, 0]);
  });
});

// ── §5 ─────────────────────────────────────────────────────────────────────────

describe("§5 — TWO OR MORE PARKS, and the offer is exactly the printed set", () => {
  const TWO_DAMAGED: Body[] = [
    { id: "fix-titan", damage: 20 },
    { id: "fix-titan", damage: 0 },
    { id: "fix-titan", damage: 30 },
  ];

  it("🛑 two damaged bodies among three: the prompt offers those TWO and names the clause", () => {
    // D416's rule: an op that can park needs a board that actually offers two, or the
    // parked arm is untested however many cases the file has.
    const state = board(5, "p1", TWO_DAMAGED);
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
    // THE OFFER IS THE PRINTED SET — indices 0 and 2, and NOT index 1.
    expect(prompt.candidates).toEqual([
      { seat: "p2", spot: { spot: "bench", index: 0 } },
      { seat: "p2", spot: { spot: "bench", index: 2 } },
    ]);
    // …and the CAPTION names the same set the validator will enforce, or the dialog
    // contradicts itself (`gustTargetNoun`'s stated rule).
    expect(prompt.note).toBe(
      "Choose 1 of your opponent's Benched Pokémon that has any damage counters on it (60 damage each).",
    );

    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(types(e2)).not.toContain("COUNTERS_PLACED");
    expect(findAll(e2, "DAMAGE_DEALT")).toHaveLength(1);
    expect(benchDamage(done, "p2")).toEqual([20, 0, 90]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 THE UN-NARROWED CAPTION IS BYTE-IDENTICAL TO THE ONE THAT SHIPPED", () => {
    // The note rider is opt-in. Every snipe printing that came before this slice must
    // read exactly as it did, or the widening leaked into fifteen shipped printings.
    const state = board(5, "p1", TWO_DAMAGED);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: BLUNT });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.note).toBe("Choose 1 of your opponent's Benched Pokémon (60 damage each).");
    expect(prompt.candidates).toHaveLength(3);
  });

  it("🛑 an UNDAMAGED body is not on the offer, and the WIRE cannot reach it either", () => {
    // `validateChoice` matches the answer against the PROMPT, never against the op
    // (D204's structural finding), so a narrowed-away body is unreachable from a
    // CRAFTED FRAME rather than merely unlisted. Driven, because "unreachable" is a
    // claim about a validator and not about a list.
    const state = board(6, "p1", TWO_DAMAGED);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const undamaged: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 1 } };
    expect(parked.phase.prompt.kind).toBe("choosePokemonMulti");
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [undamaged] } },
      "BAD_EFFECT_CHOICE",
    );
    // …and the ADMISSION on the same axis: a body that IS on the offer is accepted, so
    // the refusal above is about which body and not about the frame.
    const damaged: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 0 } };
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [damaged] },
    });
    expect(benchDamage(done, "p2")).toEqual([80, 0, 30]);
  });
});

// ── §6 ─────────────────────────────────────────────────────────────────────────

describe("§6 — THE SHIELD IS ASKED AFTER THE NARROWING (D433)", () => {
  it("🛑 a SHIELDED UNDAMAGED body files NO row at all — it was never a candidate", () => {
    // `fix-teaparty` refuses damage while Benched (§11). Undamaged, it is not one of
    // the printed candidates, so `placeSnipe` never sees it and no
    // `DAMAGE_DEALT{prevented}` row is written about it. **The board is identical
    // under a build that asked first and filtered after — the only casualty is a log
    // row claiming a refusal that never happened**, which is exactly why that build
    // survives review (D433).
    const state = board(7, "p1", [
      { id: "fix-teaparty", damage: 0 },
      { id: "fix-titan", damage: 10 },
    ]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const shieldUid = done.players.p2.bench[0]?.stack[0];
    expect(shieldUid).toBeDefined();
    // 🛑 THE LOG-SHAPED CLAIM, and it is the only thing that separates the two builds.
    expect(findAll(events, "DAMAGE_DEALT").map((e) => e.uid)).not.toContain(shieldUid);
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(2);
    expect(benchDamage(done, "p2")).toEqual([0, 70]);
  });

  it("🛑 THE ADMISSION: a SHIELDED DAMAGED body IS a candidate, and its refusal IS filed", () => {
    // Without this rung the one above passes on a build that asks nobody. The same
    // body, one axis moved (10 damage instead of 0), is a printed candidate — so the
    // shield is asked, the row is written, and the damage is zero.
    const state = board(8, "p1", [
      { id: "fix-teaparty", damage: 10 },
      { id: "fix-titan", damage: 0 },
    ]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const shieldUid = done.players.p2.bench[0]?.stack[0];
    const rows = findAll(events, "DAMAGE_DEALT").filter((e) => e.uid === shieldUid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ base: 60, dealt: 0, prevented: true });
    expect(benchDamage(done, "p2")).toEqual([10, 0]);
  });

  it("🛑 a shielded body still COUNTS toward the arity — it is refused, not removed", () => {
    // The shield is a §11 answer about damage, not a narrowing of the printed noun, so
    // a shielded damaged body beside an unshielded damaged one is TWO candidates and
    // the op parks. That is the distinction the two funnels keep: `snipeTargets`
    // answers *"which bodies does the CARD name"*, `placeSnipe` answers *"what happens
    // to each of them"*.
    const state = board(9, "p1", [
      { id: "fix-teaparty", damage: 10 },
      { id: "fix-titan", damage: 10 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates).toHaveLength(2);
  });
});

// ── §7 ─────────────────────────────────────────────────────────────────────────

describe("§7 — Weakness is genuinely not applied, the far seat, and the loud path", () => {
  it("🛑 THE PARENTHETICAL IS THE RULE: a ×2-Weak benched body takes a flat 60", () => {
    // `fix-drainwall` (300 HP, no printed Weakness) and `fix-drainweak` (300 HP, ×2
    // Fire) are identical but for one printed row, and the attacker is {R}. Both take
    // 60 on the Bench, and the DAMAGE_DEALT rows say `weakness: null` rather than
    // merely arriving at the same number.
    const state = board(10, "p1", [
      { id: "fix-drainweak", damage: 10 },
      { id: "fix-drainwall", damage: 10 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: weak, events: weakEvents } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(find(weakEvents, "DAMAGE_DEALT")).toMatchObject({ base: 60, weakness: null, resistance: null, dealt: 60 });
    expect(benchDamage(weak, "p2")).toEqual([70, 10]);
  });

  it("🛑 THE ATTRIBUTION CONTROL: the SAME ×2 body in the ACTIVE spot takes DOUBLE", () => {
    // Without this, "no Weakness on the Bench" is indistinguishable from "this body's
    // Weakness row is not live at all" (D214). The same attacker, the same printed 30,
    // the same card — in the Active Spot, where §8.5 does apply.
    const state = board(11, "p1", [], "fix-drainweak");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 30,
      weakness: { op: "multiply", amount: 2 },
      dealt: 60,
    });
    expect(done.players.p2.active?.damage).toBe(60);
  });

  it("🛑 THE FAR SEAT drives the identical shape — nothing here is p1-shaped", () => {
    const state = board(12, "p2", [
      { id: "fix-titan", damage: 0 },
      { id: "fix-titan", damage: 20 },
    ]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const dealt = findAll(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    // Both rows name the DAMAGED body's owner as `seat` and the ATTACKER as `by`
    // (D425), which on this board is the mirror of every rung above.
    expect(dealt[1]).toMatchObject({ seat: "p1", by: "p2", base: 60, dealt: 60 });
    expect(benchDamage(done, "p1")).toEqual([0, 80]);
    expect(done.players.p1.active?.damage).toBe(30);
  });

  it("🛑 THE LOUD PATH IS STILL THERE, on the SAME body — index 2 is unread", () => {
    // The `ATTACK_EFFECT_SKIPPED` control (D427's shape): a deliberately-unread real
    // corpus sentence at index 2 of the demonstrator, so the claim *"the narrowed
    // attack never skips"* has something on the same card that does.
    const state = board(13, "p1", [{ id: "fix-titan", damage: 10 }]);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: IDLE });
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
    const { events: picky } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(picky)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 the frozen board is not mutated — both endings, purity pair", () => {
    // The whole board is frozen and both arms are driven off it: the empty-filtered-set
    // ending (which returns the state it was handed) and the forced one (which does
    // not). A build that mutated in place would throw here rather than quietly
    // corrupting the caller's board.
    const empty = deepFreeze(board(14, "p1", [{ id: "fix-titan", damage: 0 }]));
    expect(() => mustApply(empty, { type: "attack", seat: "p1", index: PICKY })).not.toThrow();
    const forced = deepFreeze(board(15, "p1", [{ id: "fix-titan", damage: 10 }]));
    const { state: done } = mustApply(forced, { type: "attack", seat: "p1", index: PICKY });
    expect(benchDamage(forced, "p2")).toEqual([10]);
    expect(benchDamage(done, "p2")).toEqual([70]);
  });
});

// ── §8 ─────────────────────────────────────────────────────────────────────────

describe("§8 — the persisted question: `MATCH_RECORD_VERSION` STAYS 29", () => {
  // ⚠️ The constant lives in `apps/api/src/lobby/match.ts`, where `match.test.ts`
  // pins the literal and drives ±1 to null. What is driven HERE is the engine-side
  // fact it is about: whether a record this deploy writes means anything different
  // to a deploy that does not know the key.
  function parked(): GameState {
    const state = board(16, "p1", [
      { id: "fix-titan", damage: 10 },
      { id: "fix-titan", damage: 20 },
    ]);
    const { state: p } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    if (p.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return JSON.parse(JSON.stringify(p)) as GameState;
  }

  it("🛑 DIRECTION 1 — the op DOES ride `phase.cont.pendingOp`, so the question is real", () => {
    // `damageChosen` parks, and a parking op is persisted. The field is asserted to be
    // ON the wire rather than assumed absent, because "it isn't stored" is the claim a
    // careless no-bump argument rests on.
    const record = parked();
    if (record.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(record.phase.cont.pendingOp).toMatchObject({ op: "damageChosen", damagedOnly: true });
    // …and a v29 record round-trips and still resolves onto the chosen body.
    const prompt = record.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: done } = mustApply(record, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(benchDamage(done, "p2")).toEqual([70, 20]);
  });

  it("🛑 DIRECTION 2 — DELETING the key from a parked record changes NOTHING", () => {
    // 🛑 **THIS IS THE REASON THE CONSTANT DOES NOT MOVE, AND IT IS STRONGER THAN
    // "the key is optional".** `applyChoice`'s `damageChosen` arm hands `choice.refs`
    // straight to `placeSnipe` and never re-derives a candidate set; `validateChoice`
    // matches the answer against the PARKED PROMPT rather than against the op. So the
    // narrowing has ALREADY happened by the time the record exists, and the resumed
    // pick reads this field at no site at all. Measured, not classified from the
    // record's shape (D435).
    const record = parked();
    if (record.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const op = record.phase.cont.pendingOp as Record<string, unknown>;
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT — that is what a deploy which never knew it writes, and `= undefined` leaves it PRESENT.
    delete op.damagedOnly;
    expect("damagedOnly" in op).toBe(false);
    const prompt = record.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: done } = mustApply(record, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    // Byte-identical to DIRECTION 1's outcome.
    expect(benchDamage(done, "p2")).toEqual([70, 20]);
    // ⚠️ **THE FALSIFIER, EXECUTABLE**: the bump becomes owed the day the resume path
    // re-derives the candidate set from the op instead of trusting the prompt. This
    // rung asserts the prompt is what the answer is checked against — an undamaged
    // body is not in the persisted candidate list, so no deploy can answer with one
    // however it reads the op.
    expect(prompt.candidates).toHaveLength(2);
  });

  it("🛑 the engine version moved with `package.json`", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});
