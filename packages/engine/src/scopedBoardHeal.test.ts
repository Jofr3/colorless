import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, engineVersion, programFor } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SCOPED_HEAL_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setBenchDamage,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.359.0 → 0.360.0 — 🆕🆕 D461, THE SCOPED BOARD HEAL. "Heal 100 damage from each of
// your {Basic|Benched} Pokémon." — 2 sentences / 4 legal printings,
// `censusAttackCorpus.ts` file lines 273 and 274, claimed WHOLE by
// `deriveAttackEffect` through ONE new anchor, ONE noun map and TWO new optional
// riders on the SHIPPED `healEach` op.
//
// 🛑 WHAT THE BLOCKER CENSUS SAID, AND WHAT IT DID NOT SAY. Both rows were
// `PHRASE-1`: delete ONE token and the remainder derives. That is a statement about
// WHERE the blocker is — the verb, the amount and the destination all ship — and it
// is emphatically NOT a statement that this is a one-line change, because the
// derived value LOSES the token's meaning in both cases:
//
//   • delete "Basic"   → `[{op:"healEach", amount:100}]`, which heals every EVOLVED
//     body on the side as well. A superset.
//   • delete "Benched" → `[{op:"healEach", amount:100}]`, which heals the ATTACKER.
//     Also a superset — and the D447 defect class exactly.
//
// Both mis-readings are QUIET: the log grows rows, never loses them, and every
// assertion a one-body board could make stays green. So the whole slice is WHICH
// BODIES, and every case below is a board where the two sets differ.
//
// 🛑 THE ANSWER TO "FILTER OR SCOPE — ONE AXIS OR TWO" IS TWO, AND IT IS A FACT
// ABOUT `matchesFilter` RATHER THAN A PREFERENCE. Its signature is
// `(card: Card | undefined, filter: CardFilter)` — it is never handed an
// `InPlayPokemon` — so *"Benched"* is not expressible as a `CardFilter` at any
// width, while *"Basic"* is exactly `{kind:"basicPokemon"}`. The union's own rule
// then decides the rest: the PAYLOAD is identical (one printed amount, nothing
// else), so it is ONE member and not two; the two adjectives are two axes, so they
// are two FIELDS and not one enum. `AttachTargetRiders` (D204) is the shipped
// precedent — two card facts and two board facts as flat riders on one op — and the
// two field names here are ITS names verbatim.
//
// 🛑 THE THIRD ROW OF THE PRINTED FAMILY IS REFUSED, AND THE REASON IS DATA.
// *"Heal 100 damage from 1 of your Benched **Ancient** Pokémon."* (file line 272, 1
// legal printing) is the same shape one determiner over, and its blocker is the
// banner: `Ancient` is in NO column of the persisted catalog. §8 drives that
// refusal and states the falsifier, which is an INGEST change and nothing in this
// package.

/** The two printed sentences, verbatim, and the op each derives to. Both are looked
    up in `legalAttackCorpus()` in §1 WITH their printing counts, so a hand-retyped
    near-miss reddens rather than passing. */
const BASIC_TEXT = "Heal 100 damage from each of your Basic Pokémon.";
const BENCH_TEXT = "Heal 100 damage from each of your Benched Pokémon.";
/** The UNNARROWED sentence this family is a narrowing of — D133's, shipped at
    0.84.0. Not this slice's, and carried here because every claim below is a
    DIFFERENCE from it.

    ⚠️ AT 30 AND NOT AT 100, MEASURED RATHER THAN ASSUMED: the column prints the bare
    board heal at 10, 20, 30 and 50 and NEVER at 100, so the two narrowed sentences do
    NOT have an unnarrowed twin at their own amount. A first draft of this file
    asserted that "Heal 100 damage from each of your Pokémon." was a corpus row and it
    is not — the amounts do not line up across the narrowing, which is worth knowing
    before anyone prices this family off a shared number. */
const BARE_TEXT = "Heal 30 damage from each of your Pokémon.";
/** The same bare sentence at the narrowed family's amount — UNPRINTED, and accepted
    by D133's anchor anyway. CHOSEN_HEAL's "deliberately UNFILTERED cross product"
    call (D131): the anchor takes any N because the op expresses any N exactly, and a
    refusal would be a claim about the ingest rather than about the game. */
const BARE_TEXT_UNPRINTED = "Heal 100 damage from each of your Pokémon.";
/** The `Ancient` row: the third member of the printed family and the one refused.
    A corpus row, asserted as such in §8 rather than quoted from a doc block. */
const ANCIENT_TEXT = "Heal 100 damage from 1 of your Benched Ancient Pokémon.";

/** The two attack indices on both `fix-scopedheal` bodies, in printed order. */
const BASIC_SALVE = 0;
const BENCH_SALVE = 1;

/** The printed heal, and the damage figures every delta is stated in terms of. They
    are all DIFFERENT from each other and from the heal, so a mixed-up body cannot
    land on a number that happens to be right; and `CLAMPED` is below the printed
    heal so the per-body clamp is visible on the same board as the rest. */
const HEAL = 100;
const ACTIVE_HURT = 250;
const BASIC_BENCH_HURT = 200;
const EVO_BENCH_HURT = 180;
/** LESS than the printed heal — the clamped body. */
const CLAMPED = 40;
/** The opponent's damage, on a board that must come back UNCHANGED. */
const OPPONENT_HURT = 70;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** ONE BOARD, NO SWEEP. Neither sentence takes a coin or makes a choice, so there is
    no seed to vary and one deterministic board is the whole account (D133's call,
    one family over — and §7 asserts the determinism rather than assuming it).

    Setup then open P1's turn 2 (P2 went first and passed), so the attack step is
    legal (§4). Both Active spots are pinned to `fix-titan` and BOTH BENCHES ARE
    EMPTIED — not housekeeping, but the difference between a suite that counts the
    bodies a case put on the board and one that counts strangers `setActiveFromDeck`
    displaced there. */
function board(): GameState {
  const state = driveSetup(
    7,
    { p1: SCOPED_HEAL_DECK, p2: SCOPED_HEAL_DECK },
    { first: "p2", active: { p1: "fix-titan", p2: "fix-titan" } },
  );
  const opened = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return clearBench(clearBench(opened, "p1"), "p2");
}

/** `id` in `seat`'s Active Spot with both {C} paid and `damage` HP on it. SURGERY on
    both counts, `boardHeal.test.ts`'s reason: `fix-scopedheal-evo` is a Stage 1 and
    could never be dealt as an opening Active, and the damage arrives by `setDamage`
    rather than by scripting attacks that would place it. */
function attacker(state: GameState, seat: Seat, id: string, damage: number): GameState {
  const fielded = attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, id), seat),
    seat,
    "fix-energy",
    2,
  );
  return setDamage(fielded, seat, damage);
}

/** Bench `bodies.length` cards on `seat`, in order, each with its own damage. */
function benchBodies(state: GameState, seat: Seat, bodies: [string, number][]): GameState {
  let next = state;
  for (const [id, damage] of bodies) {
    next = benchFromDeck(next, seat, id);
    next = setBenchDamage(next, seat, next.players[seat].bench.length - 1, damage);
  }
  return next;
}

/** The board every §3/§4 case shares: a BASIC attacker, a BASIC benched body and an
    EVOLVED benched body, all three damaged by different amounts. The three bodies are
    what make the two printed sets DIFFERENT and NOT NESTED — `Basic` takes the Active
    and bench 0, `Benched` takes bench 0 and bench 1 — which is the only board shape
    on which a build that collapsed the two riders can fail. */
function threeBodies(): GameState {
  return benchBodies(attacker(board(), "p1", "fix-scopedheal", ACTIVE_HURT), "p1", [
    ["fix-titan", BASIC_BENCH_HURT],
    ["fix-scopedheal-evo", EVO_BENCH_HURT],
  ]);
}

describe("§1 — the two anchors, the corpus, and the disjointness", () => {
  it("both sentences are CORPUS rows at the printed counts, and both were UNBUILT", () => {
    // D452's rule: a byte pin on an invented string is green by construction. Each
    // sentence is looked up in the committed `legal_standard = 1` attack column WITH
    // its printing count, so a retyped near-miss reddens here first.
    const corpus = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(corpus.get(BASIC_TEXT)).toBe(2);
    expect(corpus.get(BENCH_TEXT)).toBe(2);
    expect(corpus.get(BARE_TEXT)).toBe(3);
    // …and the bare sentence at THIS family's amount is not printed at all, which is
    // why the narrowing has no same-N twin to be compared against on a board.
    expect(corpus.get(BARE_TEXT_UNPRINTED)).toBeUndefined();
    expect(deriveAttackEffect(BARE_TEXT_UNPRINTED)).toEqual([{ op: "healEach", amount: HEAL }]);
    // 2 sentences / 4 printings — the numbers this slice claims and the numbers a
    // re-census has to reproduce.
    expect([BASIC_TEXT, BENCH_TEXT].length).toBe(2);
    expect((corpus.get(BASIC_TEXT) ?? 0) + (corpus.get(BENCH_TEXT) ?? 0)).toBe(4);
  });

  it("THE FAMILY IS CLOSED AT TWO ADJECTIVES, measured over all 640 corpus rows", () => {
    // The loosest plausible shape for "a board heal whose set is narrowed", run over
    // the whole column rather than over the rows this slice expected to find. It
    // returns exactly two, so there is no third adjective and no residual
    // fall-through — worth stating because D439's twin of this anchor reached SEVEN
    // rows and claimed only five.
    const loose = /^Heal (\d+) damage from each of your (.+) Pokémon\.$/;
    const hits = legalAttackCorpus()
      .filter(([, text]) => loose.test(text))
      .map(([units, text]) => [text, units] as const);
    expect(hits).toEqual([
      [BASIC_TEXT, 2],
      [BENCH_TEXT, 2],
    ]);
    // And the LOOSEST shape of all — any printed heal over a named SET of your own
    // bodies — returns nine rows, of which six already built before this slice and
    // three are the printed family. The third is `Ancient` (§8).
    const family = legalAttackCorpus().filter(([, text]) =>
      /[Hh]eal .* from (each|\d+|all|any) of your/.test(text),
    );
    expect(family).toHaveLength(9);
    // Six of the nine built before this slice, two build BECAUSE of it, and exactly
    // ONE is left — the whole ledger of this family in one rung. If a later slice
    // unblocks the banner, this line is what should go red first.
    expect(family.filter(([, text]) => !resolvedByAnyReader(text)).map(([, t]) => t)).toEqual([
      ANCIENT_TEXT,
    ]);
    for (const text of [BASIC_TEXT, BENCH_TEXT]) expect(resolvedByAnyReader(text)).toBe(true);
  });

  it("derives each sentence to ONE `healEach` differing from the bare one by ONE KEY", () => {
    expect(deriveAttackEffect(BASIC_TEXT)).toEqual([
      { op: "healEach", amount: HEAL, basicOnly: true },
    ]);
    expect(deriveAttackEffect(BENCH_TEXT)).toEqual([
      { op: "healEach", amount: HEAL, benchOnly: true },
    ]);
    expect(deriveAttackEffect(BARE_TEXT)).toEqual([{ op: "healEach", amount: 30 }]);
    // THE SHAPE CLAIM, ASSERTED RATHER THAN DESCRIBED. All three are one op of the
    // same kind carrying the same amount; the narrowed pair adds exactly one key
    // each, and it is a DIFFERENT key. A build that reached for one `scope` enum, or
    // for a second union member, fails this rung and not a board.
    const keysOf = (text: string) => Object.keys(deriveAttackEffect(text)?.[0] ?? {}).sort();
    expect(keysOf(BARE_TEXT)).toEqual(["amount", "op"]);
    expect(keysOf(BASIC_TEXT)).toEqual(["amount", "basicOnly", "op"]);
    expect(keysOf(BENCH_TEXT)).toEqual(["amount", "benchOnly", "op"]);
  });

  it("the two anchors are DISJOINT — neither can claim the other's text", () => {
    // The narrowed anchor requires at least one captured character between `your `
    // and ` Pokémon.`, and the bare sentence has nothing there for it to take. So the
    // ORDER of the two arms in the deriver is immaterial — an invariant worth
    // asserting rather than arguing, and asserted in BOTH directions on one N.
    const narrowed = /^Heal (\d+) damage from each of your ((?!opponent)[^.]+) Pokémon\.$/;
    const bare = /^Heal (\d+) damage from each of your Pokémon\.$/;
    expect(narrowed.test(BARE_TEXT)).toBe(false);
    expect(bare.test(BASIC_TEXT)).toBe(false);
    expect(bare.test(BENCH_TEXT)).toBe(false);
    // And the derived values differ, which is the same claim from the value side: a
    // build that collapsed the two anchors would pass every one-Basic board.
    expect(deriveAttackEffect(BASIC_TEXT)).not.toEqual(deriveAttackEffect(BARE_TEXT));
    expect(deriveAttackEffect(BENCH_TEXT)).not.toEqual(deriveAttackEffect(BARE_TEXT));
  });

  it("REFUSES an adjective the map does not know — the map is the vocabulary", () => {
    // The anchor is loose and the MAP is what refuses, `IN_PLAY_BODY_NOUNS`' design
    // verbatim. That direction matters more here than in most families: the
    // unnarrowed reading heals a SUPERSET, so a permissive miss is a quiet wrong
    // answer rather than a loud one.
    for (const text of [
      "Heal 100 damage from each of your Ancient Pokémon.",
      "Heal 100 damage from each of your Tera Pokémon.",
      "Heal 100 damage from each of your Stage 1 Pokémon.",
      "Heal 100 damage from each of your Benched Basic Pokémon.",
      "Heal 100 damage from each of your {L} Pokémon.",
      "Heal 100 damage from each of your Team Rocket's Pokémon.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("REFUSES the opponent's board — the `(?!opponent)` lookahead, both ways", () => {
    // Without the lookahead the capture would take `opponent's` and hand it to the
    // map. Today the map refuses it and the card is merely LOUD; the lookahead is
    // what stops that refusal turning into a WRONG SEAT the day an opponent-side heal
    // noun lands. `boardHeal.test.ts` has pinned this sentence since D133 and it
    // stays pinned — now against two anchors instead of one.
    const narrowed = /^Heal (\d+) damage from each of your ((?!opponent)[^.]+) Pokémon\.$/;
    expect(narrowed.test("Heal 100 damage from each of your opponent's Pokémon.")).toBe(false);
    expect(deriveAttackEffect("Heal 100 damage from each of your opponent's Pokémon.")).toBeNull();
    expect(
      deriveAttackEffect("Heal 100 damage from each of your opponent's Benched Pokémon."),
    ).toBeNull();
  });

  it("REFUSES the anchor, punctuation, case and compound rewrites", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Heal 100 damage from each of your Basic Pokémon",
      // A LOWERCASE first word: half of what keeps a mid-sentence clause off this
      // path, and the reason no /i flag is on either regex.
      "heal 100 damage from each of your Basic Pokémon.",
      // "all" for a number: a real printed amount on the neighbouring `healChosen`
      // sentence that `healEach.amount` cannot carry.
      "Heal all damage from each of your Basic Pokémon.",
      // A LEADING RIDER pins `^` — how a gated or conditional printing arrives.
      "Flip a coin. If heads, heal 100 damage from each of your Basic Pokémon.",
      // A SECOND SENTENCE riding the same action — the shape the `$` exists for, and
      // the shape the `[^.]+` capture cannot span whatever the `$` did.
      "Heal 100 damage from each of your Basic Pokémon. Then, shuffle your deck.",
      "Heal 100 damage from each of your Benched Pokémon. This Pokémon is now Asleep.",
      // …and the same compound the OTHER way round, with the mapped sentence in the
      // TAIL and a CAPITAL `Heal` starting it. This is the row that pins `^` rather
      // than `$`, and it needs the capital: every lowercase mid-sentence form (Saguaro's
      // tail, a coin gate) is refused by the case of the verb before the anchor is
      // consulted at all, so a reader that dropped `^` alone would still refuse them and
      // the guard would be green for the wrong reason.
      "This Pokémon is now Asleep. Heal 100 damage from each of your Basic Pokémon.",
      // The DETERMINER: "1 of your" is `healChosen`'s sentence, a park and a choice.
      "Heal 100 damage from 1 of your Basic Pokémon.",
      // PLURAL DRIFT in the quantifier: "each" is the printed word.
      "Heal 100 damage from all of your Basic Pokémon.",
      // COUNTERS, not HP — a different arithmetic (§12) and off by a factor of ten.
      "Remove 10 damage counters from each of your Basic Pokémon.",
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not.
    expect(deriveAttackEffect("  Heal 100 damage from each of your Benched Pokémon.\n")).toEqual([
      { op: "healEach", amount: HEAL, benchOnly: true },
    ]);
  });

  it("matches FIXTURE_POOL char-for-char on both bodies, at both indices", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned — on BOTH fixtures, because the
    // evolved twin is what drives the attacker-excludes-itself case in §4.
    for (const id of ["fix-scopedheal", "fix-scopedheal-evo"]) {
      const attacks = FIXTURE_POOL[id]?.attacks;
      expect(attacks?.[BASIC_SALVE]).toEqual({
        cost: ["Colorless", "Colorless"],
        name: "Basic Salve",
        effect: BASIC_TEXT,
      });
      expect(attacks?.[BENCH_SALVE]).toEqual({
        cost: ["Colorless", "Colorless"],
        name: "Bench Salve",
        effect: BENCH_TEXT,
      });
      // NO printed `damage` on either, so the heal is the entire visible result.
      expect(attacks?.[BASIC_SALVE]?.damage).toBeUndefined();
      expect(attacks?.[BENCH_SALVE]?.damage).toBeUndefined();
    }
    // The two fixtures differ in STAGE and in nothing else that matters here.
    expect(FIXTURE_POOL["fix-scopedheal"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["fix-scopedheal-evo"]?.stage).toBe("Stage1");
  });
});

describe("§2 — one op, two axes: the shape can say what the catalog does not print", () => {
  it("the CROSSING is expressible by the op and refused by the reader", () => {
    // The test that the shape is the right one. A `scope: "basic" | "bench"` enum
    // could not construct this value at all; two union members could not either
    // without a third. The catalog does not print the crossing today — the reader
    // says so on the line below — and the vocabulary must not be the reason it could
    // never be read.
    const crossing: EffectOp = { op: "healEach", amount: HEAL, basicOnly: true, benchOnly: true };
    expect(crossing).toEqual({ op: "healEach", amount: HEAL, basicOnly: true, benchOnly: true });
    expect(deriveAttackEffect("Heal 100 damage from each of your Benched Basic Pokémon.")).toBeNull();
  });

  it("ABSENT means UNNARROWED on both riders, and not `false`", () => {
    // `basicOnly` absent is not a gate on "not Basic" and `benchOnly` absent is not a
    // gate on "not Benched" — both absent is D133's whole board, which is the value
    // every producer predating this slice emits. The pre-existing Ability producer is
    // the witness: Garganacl's "Blessed Salt" carries neither key and must keep
    // reading exactly as it did.
    const blessedSalt = programFor("sv02-123")?.triggered?.[0]?.program?.[0];
    expect(blessedSalt).toMatchObject({ op: "healEach" });
    expect(Object.keys(blessedSalt ?? {}).sort()).toEqual(["amount", "op"]);
  });
});

describe("§3 — the BENCH scope: the Active is out of the set, whatever it is", () => {
  it("heals every benched body and LEAVES THE ATTACKER DAMAGED", () => {
    // THE D447 DEFECT CLASS, driven. A build that healed the Active under this
    // sentence passes every bench assertion below and fails on this line alone —
    // which is exactly what deleting the printed "Benched" produces.
    const state = threeBodies();
    const attackerUid = activeUid(state, "p1");
    const benchA = benchTopUid(state, "p1", 0);
    const benchB = benchTopUid(state, "p1", 1);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BENCH_SALVE,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT);
    expect(done.players.p1.bench[0]?.damage).toBe(BASIC_BENCH_HURT - HEAL);
    // The EVOLVED bench body heals too — "Benched" says nothing about stage, and a
    // build that shared one rider between the two sentences fails here.
    expect(done.players.p1.bench[1]?.damage).toBe(EVO_BENCH_HURT - HEAL);
    // ONE ROW PER BODY THAT MOVED, in bench index order, and NO row for the attacker.
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: benchA, amount: HEAL },
      { type: "HEALED", seat: "p1", uid: benchB, amount: HEAL },
    ]);
    expect(all(events, "HEALED").map((e) => e.uid)).not.toContain(attackerUid);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the ACTIVE SPOT KEEPS ITS BODY — 'not in the set' is not 'not on the board'", () => {
    // The mistake this rider invites is nulling the Active instead of skipping it,
    // which would read as a body that left play: no Knock Out, no Prize, no
    // promotion, and a seat with an empty Active Spot mid-turn.
    const { state: done } = mustApply(threeBodies(), {
      type: "attack",
      seat: "p1",
      index: BENCH_SALVE,
    });
    expect(done.players.p1.active).not.toBeNull();
    expect(done.players.p1.bench).toHaveLength(2);
    expect(done.players.p1.active?.healedTurn).toBeNull();
    expect(types(done.players.p1.active === null ? [] : [])).toEqual([]);
  });

  it("excludes an EVOLVED attacker for the same reason — the rider reads the SPOT", () => {
    // Same sentence, evolved Active. `benchOnly` never asks what the body is, so this
    // board and the one above must agree about the Active; they disagree only in §4.
    const state = benchBodies(
      attacker(board(), "p1", "fix-scopedheal-evo", ACTIVE_HURT),
      "p1",
      [["fix-titan", BASIC_BENCH_HURT]],
    );
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BENCH_SALVE,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT);
    expect(done.players.p1.bench[0]?.damage).toBe(BASIC_BENCH_HURT - HEAL);
    expect(all(events, "HEALED")).toHaveLength(1);
  });
});

describe("§4 — the BASIC filter: the Active is IN the set when it is a Basic", () => {
  it("heals the BASIC Active and the BASIC bench body, and SKIPS the evolved one", () => {
    // The same three bodies as §3, the other sentence, and the sets are NOT NESTED:
    // this one takes the Active and bench 0, that one took bench 0 and bench 1. No
    // single rider and no one enum can produce both readings.
    const state = threeBodies();
    const attackerUid = activeUid(state, "p1");
    const benchA = benchTopUid(state, "p1", 0);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BASIC_SALVE,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT - HEAL);
    expect(done.players.p1.bench[0]?.damage).toBe(BASIC_BENCH_HURT - HEAL);
    // THE EVOLVED BODY IS SKIPPED — as silently as an undamaged one, and WITHOUT
    // truncating the walk, which is why it sits after a body that does heal.
    expect(done.players.p1.bench[1]?.damage).toBe(EVO_BENCH_HURT);
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: attackerUid, amount: HEAL },
      { type: "HEALED", seat: "p1", uid: benchA, amount: HEAL },
    ]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("an EVOLVED attacker EXCLUDES ITSELF — the card's own printed noun refuses it", () => {
    // The case a Basic-attacker-only suite cannot see. `fix-scopedheal-evo` prints
    // the same sentence at the same index and is not a Basic, so the heal skips the
    // body that used the attack.
    const state = benchBodies(
      attacker(board(), "p1", "fix-scopedheal-evo", ACTIVE_HURT),
      "p1",
      [
        ["fix-titan", BASIC_BENCH_HURT],
        ["fix-scopedheal-evo", EVO_BENCH_HURT],
      ],
    );
    const benchA = benchTopUid(state, "p1", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BASIC_SALVE,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT);
    expect(done.players.p1.bench[0]?.damage).toBe(BASIC_BENCH_HURT - HEAL);
    expect(done.players.p1.bench[1]?.damage).toBe(EVO_BENCH_HURT);
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: benchA, amount: HEAL },
    ]);
  });

  it("the STAGE is read off the TOP CARD, not off the stack's bottom", () => {
    // An evolved body's identity is its top card (§1.2). The fixture's Stage 1 sits
    // on the bench as one body here; the claim is that `matchesFilter` was handed the
    // TOP card, which is what `topCardOf` returns — a build reading the printed stage
    // off anything else would call an evolved body Basic and heal it.
    const state = benchBodies(attacker(board(), "p1", "fix-scopedheal", ACTIVE_HURT), "p1", [
      ["fix-scopedheal-evo", EVO_BENCH_HURT],
    ]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BASIC_SALVE,
    });
    expect(done.players.p1.bench[0]?.damage).toBe(EVO_BENCH_HURT);
    expect(all(events, "HEALED")).toHaveLength(1);
    expect(all(events, "HEALED")[0]?.uid).toBe(activeUid(state, "p1"));
  });
});

describe("§5 — what ZERO means, and it is the SHIPPED guard rather than a fourth one", () => {
  it("REFUSES a printed zero at the producer — the guard every arm here carries", () => {
    // A "Heal 0 damage" printing is not a real card and would derive to a set's worth
    // of silent no-ops: an attack reporting a simulated effect that moved nothing.
    // Loud path, on BOTH new sentences.
    expect(deriveAttackEffect("Heal 0 damage from each of your Basic Pokémon.")).toBeNull();
    expect(deriveAttackEffect("Heal 0 damage from each of your Benched Pokémon.")).toBeNull();
    // No CEILING, by contrast, and deliberately so: the interpreter clamps PER BODY
    // to the damage present, so a malformed large amount heals the set to full and
    // stops. A legal board state, not a runaway.
    expect(deriveAttackEffect("Heal 999 damage from each of your Benched Pokémon.")).toEqual([
      { op: "healEach", amount: 999, benchOnly: true },
    ]);
  });

  it("CLAMPS PER BODY — the shipped `healed <= 0` skip, and no new guard beside it", () => {
    // D451's finding, applied rather than re-derived: this project has three
    // zero-shapes and the right one depends on whether the amount is a producer's
    // constant or varies per body. A heal clamps to each body's OWN damage, so it
    // varies, and the per-body skip is the shipped answer. Both riders SHRINK the set
    // the skip runs over; neither changes what zero means.
    const state = benchBodies(attacker(board(), "p1", "fix-scopedheal", ACTIVE_HURT), "p1", [
      ["fix-titan", CLAMPED],
      ["fix-titan", BASIC_BENCH_HURT],
    ]);
    const benchA = benchTopUid(state, "p1", 0);
    const benchB = benchTopUid(state, "p1", 1);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BENCH_SALVE,
    });
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p1.bench[1]?.damage).toBe(BASIC_BENCH_HURT - HEAL);
    // The clamped body reports what MOVED (40), not what was printed (100). A shared
    // clamp, or one read once off the first body, passes a one-body board and fails
    // exactly here.
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: benchA, amount: CLAMPED },
      { type: "HEALED", seat: "p1", uid: benchB, amount: HEAL },
    ]);
  });

  it("WHIFFS SILENTLY per body, and the skip does not truncate the walk", () => {
    // An undamaged body BETWEEN two damaged ones emits no row and the two either side
    // still do. The count of HEALED rows is the count of bodies that MOVED, never the
    // size of the set.
    const state = benchBodies(attacker(board(), "p1", "fix-scopedheal", ACTIVE_HURT), "p1", [
      ["fix-titan", BASIC_BENCH_HURT],
      ["fix-titan", 0],
      ["fix-titan", CLAMPED],
    ]);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: BENCH_SALVE });
    expect(all(events, "HEALED").map((e) => e.amount)).toEqual([HEAL, CLAMPED]);
  });

  it("AN EMPTY SET is the all-whiffed board, not a new case — both riders", () => {
    // The two ways the printed set can be empty on a legal board, and neither is a
    // park, a skip or an error. The attack is SIMULATED and moves nothing.
    //
    // (a) `benchOnly` with an EMPTY BENCH — the mirror of D133's "the Active alone IS
    //     each" case, and its exact complement: here the Active is the only body and
    //     it is the one body the sentence excludes.
    const emptyBench = attacker(board(), "p1", "fix-scopedheal", ACTIVE_HURT);
    const benchRun = mustApply(emptyBench, { type: "attack", seat: "p1", index: BENCH_SALVE });
    expect(benchRun.state.players.p1.active?.damage).toBe(ACTIVE_HURT);
    expect(all(benchRun.events, "HEALED")).toEqual([]);
    expect(types(benchRun.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(benchRun.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // (b) `basicOnly` on an ALL-EVOLVED side — the filter matches nothing at all.
    const allEvolved = benchBodies(
      attacker(board(), "p1", "fix-scopedheal-evo", ACTIVE_HURT),
      "p1",
      [["fix-scopedheal-evo", EVO_BENCH_HURT]],
    );
    const basicRun = mustApply(allEvolved, { type: "attack", seat: "p1", index: BASIC_SALVE });
    expect(basicRun.state.players.p1.active?.damage).toBe(ACTIVE_HURT);
    expect(basicRun.state.players.p1.bench[0]?.damage).toBe(EVO_BENCH_HURT);
    expect(all(basicRun.events, "HEALED")).toEqual([]);
    expect(types(basicRun.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(basicRun.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("an UNDAMAGED set heals nothing and still reports as simulated", () => {
    // Zero damage rather than zero bodies: the third way to reach "nothing moved",
    // and the one that must not be told apart from the other two at the log.
    const state = benchBodies(attacker(board(), "p1", "fix-scopedheal", 0), "p1", [
      ["fix-titan", 0],
    ]);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: BASIC_SALVE });
    expect(all(events, "HEALED")).toEqual([]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("§6 — the SEAT boundary, and what the narrowing costs the rest of the engine", () => {
  it("leaves the OPPONENT's damaged board untouched — the healEachAll boundary", () => {
    // `healEach` is seat-scoped through `ctx.seat`; `healEachAll` (Picnic Basket) is
    // not. The distinction is invisible on an undamaged opponent, so the opponent is
    // DAMAGED here — Active and Bench, on BOTH stages — and must come back unchanged
    // under both riders.
    for (const index of [BASIC_SALVE, BENCH_SALVE]) {
      let state = threeBodies();
      state = setDamage(state, "p2", OPPONENT_HURT);
      state = benchBodies(state, "p2", [
        ["fix-titan", OPPONENT_HURT],
        ["fix-scopedheal-evo", OPPONENT_HURT],
      ]);
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(done.players.p2.active?.damage).toBe(OPPONENT_HURT);
      expect(done.players.p2.bench[0]?.damage).toBe(OPPONENT_HURT);
      expect(done.players.p2.bench[1]?.damage).toBe(OPPONENT_HURT);
      for (const healed of all(events, "HEALED")) expect(healed.seat).toBe("p1");
    }
  });

  it("runs on the OTHER seat too — the op resolves against `ctx.seat`", () => {
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = benchBodies(attacker(state, "p2", "fix-scopedheal", ACTIVE_HURT), "p2", [
      ["fix-titan", BASIC_BENCH_HURT],
    ]);
    const benched = benchTopUid(state, "p2", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p2",
      index: BENCH_SALVE,
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p2", uid: benched, amount: HEAL },
    ]);
    expect(done.players.p2.active?.damage).toBe(ACTIVE_HURT);
  });

  it("consumes NO rng and never PARKS — which is why one board is the whole account", () => {
    for (const index of [BASIC_SALVE, BENCH_SALVE]) {
      const state = threeBodies();
      const { state: done } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(done.rngState).toBe(state.rngState);
      expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    }
  });

  it("costs ZERO registry rows — both bodies simulate off their printed text", () => {
    // If either grew a row the registry would win (`programFor(id)?.attack?.[index]
    // ?? derive`) and every assertion above would keep passing while testing nothing
    // about the text.
    for (const id of ["fix-scopedheal", "fix-scopedheal-evo"]) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});

describe("§7 — the record-shape derivation, made rather than inherited", () => {
  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — the reachability argument, driven", () => {
    // D450's rule for a non-parking change is REACHABILITY: can the thing this slice
    // touched ever appear inside a saved record? An `EffectOp` IS persisted — it
    // reaches `GameState.phase.cont.pendingOp` and `phase.cont.rest` — so the
    // question has a real subject, and it is answered twice.
    //
    //   (1) `healEach` NEVER PARKS. It names its bodies outright, so `stepOp` returns
    //       `{ done }` and no `EffectContinuation` is ever written. §6 drives that.
    //   (2) IT CANNOT RIDE IN SOMEONE ELSE'S `rest` EITHER. The only producer of
    //       either new field is the arm added here, and that arm returns a program of
    //       length ONE — asserted on the line below — so there is no op in front of
    //       it that could park and leave it queued.
    //
    // And the fields are OPTIONAL, which is D125/D383's WIDENING: every v29 byte
    // string that spells `{"op":"healEach","amount":N}` still parses and still means
    // exactly what it meant, because ABSENT is the unnarrowed reading (§2).
    for (const text of [BASIC_TEXT, BENCH_TEXT]) {
      expect(deriveAttackEffect(text)).toHaveLength(1);
    }
  });

  it("🛑 driven over the SERIALIZED BYTES, in three directions", () => {
    const state = threeBodies();
    // The turn the heal RUNS on — read before the attack, because the attack ends the
    // turn and `done.turn` is already the next one. A stamp compared against the wrong
    // turn is green on a board where nothing healed at all.
    const healTurn = state.turn;
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: BASIC_SALVE });
    const bytes = JSON.stringify(done);
    // (a) FORWARD — the CONSEQUENCE is in the bytes, so this is not a vacuous grep
    //     over a state that records nothing at all. `healedBody` stamps the turn.
    expect(bytes).toContain("healedTurn");
    expect(bytes).toContain(`"damage":${ACTIVE_HURT - HEAL}`);
    // (b) ABSENCE — neither the op nor either new field reaches them. An op that had
    //     parked would put the literal `"healEach"` into `phase.cont`.
    expect(bytes).not.toContain("healEach");
    expect(bytes).not.toContain("basicOnly");
    expect(bytes).not.toContain("benchOnly");
    // (c) LOSS — a v29 reader that dropped everything this slice knows about still
    //     reads every field of this record with its old meaning: `damage` is a plain
    //     number and `healedTurn` is the turn stamp `healedBody` has written since
    //     0.x. Round-tripping through JSON is the check that nothing in the board
    //     depends on a shape only this engine can name.
    const roundTripped = JSON.parse(bytes) as GameState;
    expect(roundTripped.players.p1.active?.damage).toBe(ACTIVE_HURT - HEAL);
    expect(roundTripped.players.p1.active?.healedTurn).toBe(healTurn);
    expect(roundTripped.players.p1.bench[1]?.damage).toBe(EVO_BENCH_HURT);
    expect(roundTripped.players.p1.bench[1]?.healedTurn).toBeNull();
  });

  it("engineVersion is 0.400.0 and the bump is owed for BEHAVIOUR", () => {
    // 🆕🆕 D461 — 0.359.0 → **0.360.0**. Two printed sentences that derived to `null`
    // and fell to the loud ATTACK_EFFECT_SKIPPED path now heal a NARROWED set, and
    // the narrowing is visible on the board rather than only in the type: the same
    // board under the two sentences heals two DIFFERENT, NON-NESTED sets of bodies
    // (§3 and §4 share one board and disagree about two of its three).
    expect(engineVersion).toBe("0.400.0");
  });
});

describe("§8 — the REFUSAL, with its own reason and its own falsifier", () => {
  it("the `Ancient` row is a CORPUS row, is UNBUILT, and stays unbuilt", () => {
    // The third member of the printed family, refused for a reason that is not this
    // package's to fix.
    const corpus = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(corpus.get(ANCIENT_TEXT)).toBe(1);
    expect(deriveAttackEffect(ANCIENT_TEXT)).toBeNull();
    expect(resolvedByAnyReader(ANCIENT_TEXT)).toBe(false);
    // Deleting the banner reaches a BUILT string, which is the census's own evidence
    // that the banner is the whole blocker: the determiner, the zone and the amount
    // all ship on `healChosen`.
    expect(deriveAttackEffect("Heal 100 damage from 1 of your Benched Pokémon.")).toEqual([
      { op: "healChosen", amount: HEAL, zone: "bench" },
    ]);
  });

  it("THE BANNER'S PRICE IS 7 SENTENCES / 10 PRINTINGS, and the falsifier is INGEST", () => {
    // 🛑 THE REFUSAL IS ABOUT A COLUMN, NOT ABOUT A SENTENCE. `Ancient` is a
    // per-PRINTING banner that is in NO field of the persisted `Card` and in no field
    // of tcgdex's card model — `PREVENT_DAMAGE_FROM_CLASS` and D439/D440 have said so
    // since D204 and it is re-read here rather than inherited. So the fix is an
    // INGEST change (a new catalog column, populated per printing) and nothing in
    // `packages/engine` can be it.
    //
    // WHAT IT COSTS, measured over the whole attack column rather than over this
    // family: seven sentences carry the word and every one of them is unbuilt.
    const ancient = legalAttackCorpus().filter(([, text]) => /Ancient/.test(text));
    expect(ancient).toHaveLength(7);
    expect(ancient.reduce((sum, [units]) => sum + units, 0)).toBe(10);
    for (const [, text] of ancient) expect(resolvedByAnyReader(text)).toBe(false);
    // The falsifier, stated so it can be checked rather than remembered: when the
    // catalog grows a banner column, this rung is what should go red first.
    const CARD_FIELDS_TODAY = Object.keys(FIXTURE_POOL["fix-titan"] ?? {});
    expect(CARD_FIELDS_TODAY).not.toContain("banner");
    expect(CARD_FIELDS_TODAY).not.toContain("subtypes");
  });
});
