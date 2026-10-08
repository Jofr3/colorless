import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  deriveAttackDamageMultiplier,
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

/** 🛑 **🆕🆕🆕 D519 — RE-POINTED, AND THE ROW IT LEFT IS ASSERTED LIVE IN §1 (D444/D447).**
    This constant held corpus row **596** (*"This attack does 50 damage for each of your
    Pokémon that has any damage counters on it."*) from D437 to D518, and D519 BUILT it —
    ONE anchor (`IN_PLAY_DAMAGED_BODY_MULTIPLY`) and a `damagedOnly` rider on
    `DamageCountSource.pokemonInPlay`, decided by `hasAnyDamageCounters`: the SAME predicate
    this slice's own rider uses, taken a fourth time. ⚠️ **D507's note two screens down
    predicted it and was right in kind and slightly off in price** — it said the row needs
    *"a new `DamageCountSource` member folded in `attack.ts`"*, and what it actually cost was
    an optional FIELD on a member that already shipped, which is cheaper.

    The demonstrator's index 2 moves with it. The new subject is corpus **FILE LINE 601** —
    *"This attack does 50 damage to each Pokémon that has any damage counters on it (both
    yours and your opponent's), except for this Pokémon. (Don't apply…)"*, 1 legal printing —
    **the LAST unbuilt damage row of this family**, and the one `bothBenchSpread.test.ts` §8
    refuses by name. Kept as a real printed sentence rather than an invented one so the
    `ATTACK_EFFECT_SKIPPED` rung's control is on the SAME body as the claim it controls.

    🛑 **🆕🆕🆕 D520 — RE-POINTED A SECOND TIME, AND THE FAMILY IS CLOSED.** D520 BUILT
    FILE LINE 601 as three shipped ops (`conditionGate{opponentActiveDamaged}` →
    `damageDefender`, then D507's two `damagedOnly` spreads) — D507's refusal was wrong in
    verdict AND carrier. The `that has any damage counters` family is now **5 built / 0
    unbuilt**, so there is no honest sibling of the DAMAGE family left. The constant is
    re-homed onto corpus **FILE LINE 316** — *"If this Pokémon has any damage counters on
    it, this attack can be used for {F}."*, 1 legal printing — a REAL printed sentence of
    the wider `any damage counters` concept that NO reader of the thirteen claims (a COST
    MODIFIER; the blocker is recorded at `damagedBodyScaling.test.ts` §1 and the resume
    point (5)), which is exactly the property the `ATTACK_EFFECT_SKIPPED` control needs.
    ⚠️ It is NOT of the `/that ha[sv]e? any damage counters/` family, and §1 says so.

    🛑 **🆕🆕🆕 D545 — RE-POINTED A THIRD TIME, BECAUSE D545 BUILT FILE LINE 316.** That
    sentence is now the sixth row of `ATTACK_GATE_CLAUSES` (`alternateCostIf`), a WHOLE
    printed clause split with `body: ""` (D395's path), so an attack printing it no longer
    fires `ATTACK_EFFECT_SKIPPED` — and §7's control would have gone green for the wrong
    reason. ~~*"that NO reader of the thirteen claims (a COST MODIFIER; the blocker is
    recorded at `damagedBodyScaling.test.ts` §1…)"*~~ is withdrawn with it. The constant
    is re-homed onto corpus **FILE LINE 78** — *"Choose 1 of your opponent's Active
    Pokémon's attacks and use it as this attack."*, **3 legal printings**, the copy-attack
    family, BLOCKED by standing refusal (`conventions.md`, *"A mechanism that launders the
    census"*) and still RESIDUE: `resolvedByAnyReader`, `splitAttackGateClause` and
    `splitAttackTrailingClause` all answer null on it (probed at D545). So the control keeps
    the property it exists for — a REAL printed sentence, unread, on the same body — and
    this time it is one whose unread status is a POLICY rather than a missing reader.

    🛑 **🆕🆕🆕 D573 — RE-POINTED A FOURTH TIME, BECAUSE D573 BUILT FILE LINE 78** (the
    copy-attack substitution: `deriveAttackCopy` claims it whole and attack.ts re-enters
    itself with the copied attack). ~~*"the copy-attack family, BLOCKED by standing refusal …
    and still RESIDUE"*~~ is withdrawn for row 78 (D539). The constant is re-homed onto corpus
    **FILE LINE 434** — Haughty Order, *"Reveal the top 10 cards of your opponent's deck. You
    may choose an attack from a Pokémon you find there and use it as this attack. Shuffle the
    revealed cards into your opponent's deck."*, **3 legal printings**, the copy-family
    REMAINDER: it reveals BEFORE the choice, so it needs a park in the MIDDLE of the attack,
    and stays BLOCKED. Row 78 is kept LIVE beside it as `BUILT_COPY_ATTACK` (D444/D447).

    🛑 **🆕🆕🆕 D574 — RE-POINTED A FIFTH TIME, BECAUSE D574 BUILDS FILE LINE 434** (the copy made in the
    MIDDLE of the attack — `deriveAttackCopy`'s resolve-time kind on D573's re-entry seam). ~~*"and stays
    BLOCKED"*~~ is withdrawn for row 434 (D539). The constant is re-homed onto corpus **FILE LINE 676** —
    Mr. Mime `sv05-063` "Look-Alike Show", *"Your opponent reveals their hand. You may use the effect of a
    Supporter card you find there as the effect of this attack."*, **1 legal printing**, held by a RECORDED
    REFUSAL (D445) and outside every family the D574 pricing round ranks (D540), so it is not the next row
    a slice builds. Reader, gate and trailing all null (asserted in §1). Moved BEFORE the reader landed.
    (🆕🆕🆕 D580 (D539): ~~held by a RECORDED REFUSAL (D445)~~ — D445's refusal is RETIRED: Mr. Mime `sv05-063` is BUILT at D580 as a REGISTRY row keyed by its id (`MR_MIME_LOOK_ALIKE_SHOW`). No reader or splitter claims the sentence, so on a `fix-*` carrier it is still unread and still takes the loud path — the witness stands.) */
const UNREAD_SIBLING = "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.";
/** 🆕🆕🆕 D545 — the row `UNREAD_SIBLING` vacated at D545 (corpus FILE LINE 316), kept LIVE
    as the counter-example (D444/D447): it builds on the GATE arm now. */
const BUILT_COST_CLAUSE =
  "If this Pokémon has any damage counters on it, this attack can be used for {F}.";

/** 🆕🆕🆕 D520 — the row `UNREAD_SIBLING` vacated at D520, kept LIVE as the counter-example
    (D444/D447) beside D519's. */
const BUILT_FOUR_ZONE =
  "This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The row `UNREAD_SIBLING` just vacated, kept as the LIVE counter-example so *"we re-pointed
    it"* is a measurement rather than a story. */
const BUILT_FORMER_SIBLING =
  "This attack does 50 damage for each of your Pokémon that has any damage counters on it.";

const PICKY = 0; // {C}, 30 damage, corpus row 528 — the NARROWED rider
const BLUNT = 1; // {C}, 30 damage — the same rider UN-narrowed: the one-axis control
const IDLE = 2; // {C}, 30 damage, corpus row 676 (434 until D574, 78 until D573, 316 until D545, 601 until D520, 596 until D519) — deliberately unread

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
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
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
    // 🆕🆕🆕 **D507 — THE SPLIT IS NOW 3 BUILT / 2 REFUSED, AND IT WAS THE FIRST OF THOSE
    // THREE.** *"This attack also does 40 damage to each Benched Pokémon that has any
    // damage counters on it (both yours and your opponent's). (Don't apply…)"* (corpus
    // FILE LINE 526) is claimed by arm **6-ii**, which reuses this rider's NAME a third
    // time — `spreadDamage.damagedOnly`, the same `hasAnyDamageCounters` predicate —
    // over a TWO-OP program rather than a third `spreadDamage.target`. **So the
    // predicate has now paid for THREE consequents on three different ops
    // (`damageChosen`, `counterEachAll`, `spreadDamage`) and has never once been the
    // cost**, which is D437's claim confirmed for the second time.
    // 🛑 **THE TWO THAT REMAIN ARE NOT ALIKE, AND D507 PRICED THE SECOND RATHER THAN
    // LEAVING IT AS A GROUP (D463: N rows under one reason is N refusals until each is
    // priced).** It called the COUNT *"a new `DamageCountSource` member folded in
    // `attack.ts`, where this reader is not in scope (D436's shape)"*. The other is
    // corpus FILE LINE 601, *"…to each Pokémon that has any damage counters on it (both
    // yours and your opponent's), except for this Pokémon."*, and the refusal that names
    // its condition lives in `bothBenchSpread.test.ts` §8.
    // 🆕🆕🆕 **D519 — THE SPLIT IS NOW 4 BUILT / 1 REFUSED, AND IT WAS THE COUNT.** Corpus
    // FILE LINE 596 is claimed by `deriveAttackDamageMultiplier` through ONE anchor and a
    // `damagedOnly` rider on `DamageCountSource.pokemonInPlay`, decided by
    // `hasAnyDamageCounters` — **the FOURTH consequent this one predicate has paid for, on
    // a fourth carrier, and it has still never once been the cost.** D437's claim, confirmed
    // a third time. ⚠️ **D507's own sentence above was right in KIND and off in PRICE**: the
    // fix was an optional FIELD on a member that already shipped, not a new member. The row
    // is asserted BUILT three lines down rather than merely dropped from the list.
    // 🆕🆕🆕 **D520 — THE SPLIT IS NOW 5 BUILT / 0 REFUSED: THE FAMILY IS CLOSED.** Corpus
    // FILE LINE 601 is claimed by `deriveAttackEffect` arm 6-iii as THREE shipped ops —
    // `conditionGate{opponentActiveDamaged}` → `damageDefender` (the one-body predicate in a
    // GATE, not a rider on the op), then D507's two `damagedOnly` spreads. **The FIFTH
    // consequent this one predicate has paid for, and it has still never once been the
    // cost** — this time it was not even a new spelling: the Active half took D115's shipped
    // `BoardCondition`. D507's refusal (two screens down) was wrong in verdict AND carrier.
    // The unbuilt count is rewritten `1 → 0` with this reason rather than deleted (D226): an
    // EMPTY unbuilt set is the claim, and the five built rows are enumerated beside it.
    const built = family.filter(([, s]) => resolvedByAnyReader(s));
    expect(built.map(([, s]) => s).sort()).toEqual(
      [
        PRINTED,
        "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.",
        "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        BUILT_FORMER_SIBLING,
        BUILT_FOUR_ZONE,
      ].sort(),
    );
    expect(units(family.filter(([, s]) => !resolvedByAnyReader(s)))).toBe(0);
    expect(resolvedByAnyReader(BUILT_FOUR_ZONE)).toBe(true);
    // …and the row this suite's demonstrator carried at index 2 until D519, asserted from
    // the other side, so the re-point is a measurement rather than a story.
    expect(resolvedByAnyReader(BUILT_FORMER_SIBLING)).toBe(true);
    expect(deriveAttackDamageMultiplier(BUILT_FORMER_SIBLING)).toEqual({
      per: 50,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "anyPokemon" },
        damagedOnly: true,
      },
    });
    // The unread sibling this suite's demonstrator carries at index 2 WAS one of the
    // five until D520 built the last of them. 🆕🆕🆕 **D520 — RE-POINTED (D444)**: the
    // control at index 2 is now corpus FILE LINE 316, a real printed sentence OUTSIDE this
    // family (a cost modifier, unread by every reader), so the `ATTACK_EFFECT_SKIPPED`
    // control in §7 is still a REAL printed sentence rather than an invented one — and this
    // rung still says which side of the family line it is on.
    // 🆕🆕🆕 **D545 — RE-POINTED A THIRD TIME**: FILE LINE 316 was BUILT (gate arm,
    // `alternateCostIf`), so the control is now corpus FILE LINE 78, the copy-attack row
    // (3 legal printings, BLOCKED), which no arm of the four claims. Its old subject is
    // asserted live beside it (D444/D447).
    // 🆕🆕🆕 **D573 — RE-POINTED A FOURTH TIME**: FILE LINE 78 was BUILT (the copy-attack
    // substitution), so the control is now corpus FILE LINE 434, Haughty Order (3 legal
    // printings, the copy-family remainder, BLOCKED: it reveals before the choice).
    // 🆕🆕🆕 **D574 — RE-POINTED A FIFTH TIME**: FILE LINE 434 is BUILT (the mid-attack copy), so the
    // control is now corpus FILE LINE 676, Mr. Mime "Look-Alike Show" (1 legal printing, D445's
    // recorded refusal) — the printing count below moves 3 → 1 WITH the row, read off the corpus.
    // 🆕🆕🆕 D580 (D539): D445's refusal is RETIRED — Mr. Mime is BUILT as a REGISTRY row; reader, gate and trailing still all null, so the control stands.
    expect(family.map(([, s]) => s)).not.toContain(UNREAD_SIBLING);
    expect(corpus().filter(([, s]) => s === UNREAD_SIBLING)).toHaveLength(1);
    expect(corpus().find(([, s]) => s === UNREAD_SIBLING)?.[0]).toBe(1);
    expect(resolvedByAnyReader(UNREAD_SIBLING)).toBe(false);
    expect(splitAttackGateClause(UNREAD_SIBLING)).toBeNull();
    expect(splitAttackTrailingClause(UNREAD_SIBLING)).toBeNull();
    expect(splitAttackGateClause(BUILT_COST_CLAUSE)).toEqual({ clause: BUILT_COST_CLAUSE, body: "" });
    expect(family.filter(([, s]) => !resolvedByAnyReader(s)).map(([, s]) => s)).toEqual([]);
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
    // 🆕🆕🆕 **D545 — "SEVEN OF THE EIGHT" STILL HOLDS ON THE READER ARM AND IS NOW FALSE
    // AS "BUILT"**: the eighth is built on the GATE arm (`alternateCostIf`, `body: ""`),
    // so on the census predicate ALL EIGHT build. Both are asserted, so neither reading
    // can go stale silently.
    expect(gates.filter(([, s]) => resolvedByAnyReader(s))).toHaveLength(7);
    expect(gates.filter(([, s]) => !resolvedByAnyReader(s)).map(([, s]) => s)).toEqual([
      BUILT_COST_CLAUSE,
    ]);
    expect(
      gates.filter(([, s]) => {
        if (resolvedByAnyReader(s)) return false;
        const g = splitAttackGateClause(s);
        return !(g !== null && (g.body === "" || resolvedByAnyReader(g.body)));
      }),
    ).toEqual([]);
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
    expect(readers).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
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
    expect(engineVersion).toBe("0.483.0");
  });
});
