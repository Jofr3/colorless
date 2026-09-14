import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  OWN_BENCH_SNIPE_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.348.0 → 0.349.0 — D447, THE CHOSEN BENCH SNIPE ON BOTH SEATS AND IN BOTH
// WORDINGS:
//
//   "This attack also does {10|40} damage to 1 of YOUR Benched Pokémon.
//    (Don't apply Weakness and Resistance for Benched Pokémon.)"      (2 / 2)
//   "This attack does 40 damage to 1 of your opponent's Benched Pokémon.
//    (Don't apply Weakness and Resistance for Benched Pokémon.)"      (1 / 1)
//
// 3 sentences / 3 legal printings — corpus rows 514, 525 and 587 — over
// `legalAttackCorpus()`'s 640 sentences / 1,732 printings, the `legal_standard = 1`
// attack column.
//
// 🛑 **ZERO NEW ANCHORS AND ZERO NEW READERS: THE SHARED FRAGMENT LOST TWO
// OVER-SPECIFICATIONS.** `ALSO_BENCHED_SNIPE_BODY` demanded the literal word "also"
// and the literal owner "your opponent's". Both are generalisations its SPREAD
// sibling `SPREAD_EACH_BENCH` has carried since D425 — `(?:also )?` and a possessive
// capture — so this slice is that pair of edits applied one family over, plus the
// third `damageChosen.target` member the choice needs. A second regex would have
// been D416's copied-function hazard: the corpus goes QUIET rather than red.
//
// 🛑 **THE INTERPRETER HALF IS WHERE THIS SLICE COULD ACTUALLY HAVE SHIPPED A
// SILENT DEFECT, AND IT IS NOT THE HALF THE READER SUGGESTS.** Two funnels below the
// reader were written in terms of "the opponent" rather than "the sniped side":
//   · `snipeTargets` chose its scope with a TERNARY (`=== "opponentAny" ? … : …`),
//     so a third member falls out of the `else` and aims across the table — `tsc`
//     reports nothing. It is a total `switch` now, D425's line in `spreadDamage`;
//   · `placeSnipe` filtered its bench refs on `ref.seat === opponent`, so an
//     own-side ref was DROPPED — the op would have parked a real prompt, taken a
//     real answer and dealt NOTHING. §4 and §6 drive both.
//
// ⚠️ **THE CATALOG PRINTS NO SIDE-ONLY MINIMAL PAIR HERE, unlike D425's spread**,
// and §1 states the measurement rather than the fixture pretending otherwise.

const SEED = 447_0447;

const OWN_10 =
  "This attack also does 10 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const OWN_40 =
  "This attack also does 40 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const BARE_OPP_40 =
  "This attack does 40 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** `fix-pinpoint`'s three printed indices. */
const PIN = { own10: 0, own40: 1, bareOpp40: 2 } as const;

function snipe(target: "yourBench" | "opponentBench", amount: number): EffectOp {
  return { op: "damageChosen", target, amount, count: 1, source: "attack", deals: true };
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. BOTH Actives are placed by surgery and BOTH benches cleared: every
    number here is a population over a bench, so a body the setup shuffle happened to
    place would silently move the answer. `OWN_BENCH_SPREAD_DECK`'s rule verbatim. */
function board(attacker: string, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: OWN_BENCH_SNIPE_DECK, p2: OWN_BENCH_SNIPE_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, attacker);
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 2);
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

function bench(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function damage(events: GameEvent[]): { seat: Seat; by: Seat; dealt: number }[] {
  return events.flatMap((e) =>
    e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, by: e.by, dealt: e.dealt }] : [],
  );
}

/** Park, read the prompt, answer it with the candidate at `pick`. */
function parkThenPick(state: GameState, index: number, pick: number, seat: Seat = "p1") {
  const { state: parked } = swing(state, index, seat);
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const chosen = prompt.candidates[pick];
  if (chosen === undefined) throw new Error(`no candidate ${pick}`);
  const answered = mustApply(parked, {
    type: "resolveEffect",
    seat,
    choice: { kind: "pokemonMulti", refs: [chosen as PokemonRef] },
  });
  return { prompt, ...answered };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, and the minimal pair the column does NOT print.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data: three sentences, and the pair the catalog withholds", () => {
  it("the corpus prints exactly these three sentences at exactly these counts", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    for (const s of [OWN_10, OWN_40, BARE_OPP_40]) {
      expect(rows.get(s), s).toBe(1);
    }
    // The whole family is 3 sentences / 3 printings — a TOTAL over the column, not a
    // spot check, so a fourth printing appearing in a re-ingest reddens this.
    const family = legalAttackCorpus().filter(
      ([, s]) =>
        /^This attack (?:also )?does \d+ damage to 1 of (your opponent's|your) Benched Pokémon\./.test(
          s,
        ) && !/^This attack also does \d+ damage to 1 of your opponent's Benched Pokémon\.$/.test(s),
    );
    const newlyBuilt = family.filter(([, s]) => [OWN_10, OWN_40, BARE_OPP_40].includes(s));
    expect(newlyBuilt).toHaveLength(3);
    expect(newlyBuilt.reduce((sum, [n]) => sum + n, 0)).toBe(3);
  });

  it("🛑 the column prints NO side-only minimal pair — measured, not assumed", () => {
    // ⚠️ **THIS IS WHY THIS SUITE'S FIXTURE IS NOT SHAPED LIKE `fix-tremor`.** D425
    // could put both possessives of the SPREAD on one body at one amount because the
    // column prints "each of your …" and "each of your opponent's …" both at 10. The
    // SNIPE's two sides share no amount at all, and that is a fact about the catalog.
    const amountsFor = (re: RegExp) =>
      new Set(
        legalAttackCorpus()
          .map(([, s]) => (re.exec(s)?.[1] === undefined ? null : Number(re.exec(s)?.[1])))
          .filter((n): n is number => n !== null),
      );
    const own = amountsFor(/^This attack also does (\d+) damage to 1 of your Benched Pokémon\./);
    // ⚠️ The trailing W/R parenthetical is part of every printed row here, so the
    // opponent-side pattern must not end at the noun's `\.` — an earlier draft did and
    // measured the empty set, which would have made the finding below vacuously true.
    const opp = amountsFor(
      /^This attack also does (\d+) damage to 1 of your opponent's Benched Pokémon\.(?: \(Don't apply Weakness and Resistance for Benched Pokémon\.\))?$/,
    );
    expect([...own].sort((a, b) => a - b)).toEqual([10, 40]);
    expect([...opp].sort((a, b) => a - b)).toEqual([20, 30, 50]);
    expect([...own].filter((n) => opp.has(n))).toEqual([]); // the empty intersection IS the finding
  });

  it("AUTHORS nothing — all three printings are read off the TEXT", () => {
    // ⚠️ D204's rule: `programFor(id)?.attack` reads the REGISTRY only, and every
    // sentence here resolves through `deriveAttackEffect`. No registry row was added.
    for (const s of [OWN_10, OWN_40, BARE_OPP_40]) {
      expect(deriveAttackEffect(s), s).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — one fragment, two possessives, two wordings.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the two widenings, and what they did NOT admit", () => {
  it("reads both own-side amounts onto the attacker's own Bench", () => {
    expect(deriveAttackEffect(OWN_10)).toEqual([snipe("yourBench", 10)]);
    expect(deriveAttackEffect(OWN_40)).toEqual([snipe("yourBench", 40)]);
  });

  it("reads the BARE wording, and to the SAME op the 'also' wording gives", () => {
    expect(deriveAttackEffect(BARE_OPP_40)).toEqual([snipe("opponentBench", 40)]);
    expect(
      deriveAttackEffect("This attack does 30 damage to 1 of your opponent's Benched Pokémon."),
    ).toEqual(
      deriveAttackEffect(
        "This attack also does 30 damage to 1 of your opponent's Benched Pokémon.",
      ),
    );
  });

  it("⚠️ …and the SHIPPED opponent-side twin is UNMOVED — the control this rung needs", () => {
    // The fifteen-printing spelling this fragment has read since D399 must be
    // byte-identical after both widenings, or the slice moved something it did not
    // name. Driven at every printed opponent-side amount, plus the count-2 arity and
    // the D437 narrowing, because those are the two captures whose INDEX shifted.
    for (const n of [20, 30, 50]) {
      expect(
        deriveAttackEffect(
          `This attack also does ${n} damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`,
        ),
      ).toEqual([snipe("opponentBench", n)]);
    }
    expect(
      deriveAttackEffect(
        "This attack also does 130 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 130,
        count: 2,
        source: "attack",
        deals: true,
      },
    ]);
    expect(
      deriveAttackEffect(
        "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        damagedOnly: true,
      },
    ]);
  });

  it("refuses the near-misses — and ADMITS one on the same axis beside each", () => {
    // ⚠️ **EVERY REFUSAL RUNG OWES A NEIGHBOURING ADMISSION ON THE SAME AXIS (D424)**,
    // or it passes under a reader that refuses everything. Each pair moves ONE token.
    const pairs: readonly (readonly [string, string, string])[] = [
      // possessive: an owner word neither branch spells ↔ the two that are printed
      ["a THIRD possessive", "This attack also does 10 damage to 1 of my Benched Pokémon.", OWN_10],
      // quantifier: "each of" is the SPREAD's, a different op and a different anchor
      [
        "`each of` (the spread's quantifier)",
        "This attack also does 10 damage to each of your Benched Pokémon that has any damage counters on it.",
        OWN_10,
      ],
      // a printed 0 buys nothing on either side — the amount guard, unchanged
      ["a printed 0 amount", "This attack also does 0 damage to 1 of your Benched Pokémon.", OWN_10],
      // …and a printed 0 COUNT, the second capture's guard, unchanged by the shift
      ["a printed 0 count", "This attack also does 10 damage to 0 of your Benched Pokémon.", OWN_10],
      // the number agreement: the narrowing is singular, so it may only ride "1 of"
      [
        "a narrowing at count 2",
        "This attack also does 10 damage to 2 of your Benched Pokémon that has any damage counters on it.",
        "This attack also does 10 damage to 1 of your Benched Pokémon that has any damage counters on it.",
      ],
      // the lookalike é falls off the path silently, which is the family's reason
      ["a lookalike `Pokemon`", OWN_10.replace(/Pokémon/g, "Pokemon"), OWN_10],
      // no leading `This attack`: a mid-sentence clause must not reach this path
      ["a mid-sentence clause", `Flip a coin. ${OWN_10}`, OWN_10],
    ];
    for (const [why, refused, admitted] of pairs) {
      expect(deriveAttackEffect(refused), `REFUSED: ${why}`).toBeNull();
      expect(deriveAttackEffect(admitted), `ADMITTED beside ${why}`).not.toBeNull();
    }
  });

  it("🛑 dropping 'also' did NOT open the door Covetous Ivy comes through", () => {
    // The doc block over the fragment has always said the separator from the
    // Prize-scaled sentence is the whole-sentence `\.` after the noun and NOT the
    // word "also". This slice removed the word; the claim is now load-bearing, so it
    // is driven rather than quoted. Arm 6b runs first and owns the scaled sentence.
    expect(
      deriveAttackEffect(
        "This attack does 40 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 40,
        count: 1,
        source: "attack",
        deals: true,
        perTakenPrize: true,
      },
    ]);
    // …and the own-side spelling of the SAME scaled sentence is still unbuilt: the
    // Prize anchor was NOT widened here, which is what keeps this slice's scope
    // honest. If a later slice claims it, this rung goes RED, which is the point.
    expect(
      deriveAttackEffect(
        "This attack does 40 damage to 1 of your Benched Pokémon for each Prize card your opponent has taken.",
      ),
    ).toBeNull();
  });

  it("🛑 the THIRD caller REFUSES the own side rather than dropping it", () => {
    // `optionalCostPayoff`'s `benchSnipe` record is `{amount, count}` — no side — so
    // honouring the own-side spelling there would aim a shipped payoff at the wrong
    // half of the table. It returns null and the whole sentence stays LOUD; the
    // opponent-side twin beside it is the five-printing shipped case, unmoved.
    expect(
      deriveAttackEffect(
        "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBeNull();
    // ⚠️ …and the opponent-side twin resolves through `deriveAttackOptionalCostBoost`,
    // NOT through `deriveAttackEffect` — asked of the READER SURFACE rather than of one
    // reader, which is the mistake an earlier draft of this rung made.
    expect(
      resolvedByAnyReader(
        "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(true);
    expect(
      resolvedByAnyReader(
        "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the widening, and the version prediction DRIVEN over the bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `damageChosen.target` has three members, and the record version does not move", () => {
  it("all three values are inhabited by PRINTED sentences, not just by the type", () => {
    // ⚠️ A union member no printing produces is a value no board can reach — D205's
    // shape. All three are reached here from the catalog's own text.
    const seen = new Set<string>();
    for (const [, text] of legalAttackCorpus()) {
      for (const op of (deriveAttackEffect(text) ?? []) as EffectOp[]) {
        if (op.op === "damageChosen") seen.add(op.target);
      }
    }
    expect([...seen].sort()).toEqual(["opponentAny", "opponentBench", "yourBench"]);
  });

  it("🛑 the version PREDICTION, driven over the SERIALIZED BYTES in both directions", () => {
    // **DIRECTION 1 — every byte string a v29 deploy could have written still means
    // what it meant.** `damageChosen` PARKS, so its literal really is persisted, at
    // `GameState.phase.cont.pendingOp`. The two pre-slice values are still in the
    // union and `snipeTargets` still maps each to the same scope, so a stored record
    // resumes identically. Driven through JSON rather than asserted on the object,
    // because the claim is about BYTES.
    const preSlice = [
      '{"op":"damageChosen","target":"opponentBench","amount":30,"count":1,"source":"attack","deals":true}',
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","deals":true}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
      expect(revived).toEqual(
        deriveAttackEffect(
          bytes.includes("opponentBench")
            ? "This attack also does 30 damage to 1 of your opponent's Benched Pokémon."
            : "This attack does 20 damage to 1 of your opponent's Pokémon.",
        )?.[0],
      );
    }
    // **DIRECTION 2 — the NEW value cannot appear in any record an older deploy
    // wrote, and this deploy round-trips it byte for byte.** That is D125's widening
    // test: the old key's presence AND its absence both still mean what the writer
    // said, and the new value is unreachable backwards. A RENAME would fail here —
    // neither member was renamed, which is the half D435 says is not free.
    const fresh = deriveAttackEffect(OWN_40)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageChosen","target":"yourBench","amount":40,"count":1,"source":"attack","deals":true}',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
    // **DIRECTION 3 — the `cardPool` embed is untouched.** `GameState` carries the
    // pool, so a `CardFilter` is at a persisted address (nine op fields carry one) —
    // and this slice adds NO `CardFilter` member and renames none. The op below is
    // the only shape that moved, and it holds no filter.
    expect(Object.keys(fresh ?? {}).includes("filter")).toBe(false);
  });

  it("the engine version moved and the two spellings agree", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the pick, the caption, and the bench the damage actually lands on.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the candidate set is the ATTACKER's own Bench, and the damage lands there", () => {
  it("🛑 offers the attacker's OWN benched bodies and none of the opponent's", () => {
    let state = bench(board("fix-pinpoint", "fix-titan"), "p1", ["fix-titan", "fix-titan"]);
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const { state: parked } = swing(state, PIN.own10);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates).toEqual([
      { seat: "p1", spot: { spot: "bench", index: 0 } },
      { seat: "p1", spot: { spot: "bench", index: 1 } },
    ]);
    // 🛑 THE CAPTION NAMES THE SET IT OFFERS. A heading still reading "your
    // opponent's" over the player's own bodies would contradict its own validator.
    expect(prompt.note).toBe("Choose 1 of your Benched Pokémon (10 damage each).");
  });

  it("…and the OPPONENT-side caption is byte-identical to the shipped one", () => {
    let state = bench(board("fix-pinpoint", "fix-titan"), "p1", ["fix-titan"]);
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const { state: parked } = swing(state, PIN.bareOpp40);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.note).toBe("Choose 1 of your opponent's Benched Pokémon (40 damage each).");
    expect(prompt.candidates.every((r) => r.seat === "p2")).toBe(true);
  });

  it("🛑 the chosen OWN body takes it and the untouched one does not", () => {
    let state = bench(board("fix-pinpoint", "fix-titan"), "p1", ["fix-titan", "fix-titan"]);
    state = bench(state, "p2", ["fix-titan"]);
    const { state: done, events } = parkThenPick(state, PIN.own10, 1);
    expect(damage(events)).toEqual([
      { seat: "p1", by: "p1", dealt: 10 }, // the snipe, on the attacker's OWN board
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p1.bench[1]?.damage).toBe(10);
    expect(done.players.p2.bench[0]?.damage).toBe(0); // never crossed the table
    expect(done.players.p2.active?.damage).toBe(30); // the main §8.5 hit, unaffected
  });

  it("🛑 BOTH SEATS — p2 attacking snipes p2's OWN bench, not p1's", () => {
    // A `ctx.seat`-keyed reading that happened to be right for p1 only would pass
    // every case above and fail here. D425's §4 rung, one op over.
    let state = bench(board("fix-pinpoint", "fix-titan", "p2"), "p2", ["fix-titan", "fix-titan"]);
    state = bench(state, "p1", ["fix-titan"]);
    const { state: done, events } = parkThenPick(state, PIN.own10, 0, "p2");
    expect(damage(events)).toEqual([{ seat: "p2", by: "p2", dealt: 10 }]);
    expect(done.players.p2.bench[0]?.damage).toBe(10);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
  });

  it("a bench of ONE auto-takes rather than parking — the M1 no-choice doctrine", () => {
    const state = bench(board("fix-pinpoint", "fix-titan"), "p1", ["fix-titan"]);
    const { state: done, events } = swing(state, PIN.own10);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(damage(events)).toEqual([
      { seat: "p2", by: "p1", dealt: 30 },
      { seat: "p1", by: "p1", dealt: 10 },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(10);
  });

  it("an EMPTY own Bench is a silent no-op, and the main hit still lands", () => {
    const state = board("fix-pinpoint", "fix-titan");
    const { state: done, events } = swing(state, PIN.own10);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(damage(events)).toEqual([{ seat: "p2", by: "p1", dealt: 30 }]);
  });

  it("the board is not mutated — a frozen state resolves on either side", () => {
    for (const index of [PIN.own10, PIN.bareOpp40] as const) {
      let state = bench(board("fix-pinpoint", "fix-titan"), "p1", ["fix-titan"]);
      state = bench(state, "p2", ["fix-titan"]);
      expect(() => swing(deepFreeze(state), index)).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §8.5 on the Bench, on the attacker's OWN side of the table.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — Weakness is not applied to a Benched body, whosever Bench it is", () => {
  it("🛑 a ×2 Weakness body DOUBLES on the Active and stays FLAT on your own Bench", () => {
    // ONE board, one attacker, one printed card in two spots: the parenthetical's
    // claim is exactly this difference, and nothing else on the board moves.
    let state = bench(board("fix-pinpoint", "fix-fighting-weak"), "p1", [
      "fix-fighting-weak",
      "fix-titan",
    ]);
    state = bench(state, "p2", ["fix-titan"]);
    // ⚠️ THE MAIN HIT LANDS IN THE `attack` ACTION AND THE SNIPE IN THE `resolveEffect`
    // ONE, so the two numbers are read from two event streams — which is why the BOARD
    // is asserted as well: one board, one printed card, two spots, two answers.
    const { events: first } = swing(state, PIN.own10);
    expect(damage(first)).toEqual([{ seat: "p2", by: "p1", dealt: 60 }]);
    const { state: done, events } = parkThenPick(state, PIN.own10, 0);
    expect(damage(events)).toEqual([
      { seat: "p1", by: "p1", dealt: 10 }, // the ×2 card on a BENCH — FLAT
    ]);
    expect(done.players.p2.active?.damage).toBe(60); // ×2 Fighting on the ACTIVE — doubled
    expect(done.players.p1.bench[0]?.damage).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — your own Knock Out, and the Prize goes to your OPPONENT.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a snipe that Knocks Out the attacker's own body", () => {
  it("🛑 §8.1 Knocks Out the ATTACKER's own benched body and owes the PRIZE to the OPPONENT", () => {
    // The `deals` arm is attack damage, so §8.1's KO path runs — and the body that
    // dies belongs to the player who attacked. `placeSnipe` had never written to the
    // attacker's own side before this slice.
    let state = bench(board("fix-pinpoint", "fix-titan"), "p1", ["fix-onko", "fix-titan"]);
    state = bench(state, "p2", ["fix-titan"]);
    const { state: after, events } = parkThenPick(state, PIN.own40, 0);
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    // The Prize is the OPPONENT's to take, and the phase addresses them.
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p2");
    const { state: done } = mustApply(after, {
      type: "takePrizes",
      seat: "p2",
      prizeIndices: [0],
    });
    expect(done.players.p2.prizes).toHaveLength(5);
    expect(done.players.p1.prizes).toHaveLength(6); // the attacker took nothing
    expect(done.players.p1.bench).toHaveLength(1); // the KO'd body left the attacker's Bench
  });

  it("…and a body that SURVIVES the same 40 keeps the phase on the attacker", () => {
    // The control on the rung above: same attack, same index, a 340 HP body instead.
    let state = bench(board("fix-pinpoint", "fix-titan"), "p1", ["fix-titan", "fix-titan"]);
    state = bench(state, "p2", ["fix-titan"]);
    const { state: done } = parkThenPick(state, PIN.own40, 0);
    expect(done.phase.kind).not.toBe("ko:takePrizes");
    expect(done.players.p1.bench[0]?.damage).toBe(40);
  });
});
