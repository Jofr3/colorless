import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import type { EffectOp } from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  OWN_BENCH_SNIPE_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  types,
  roundTrip,
} from "./testFixtures";

const SEED = 5;

const PRINTED =
  "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const CHOSEN_ONE =
  "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const BENCH_ONLY =
  "This attack does 30 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const BENCH_ONLY_PRINTED =
  "This attack does 50 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The "also" wording this anchor REFUSES, and the whole of §3's headline: admitting it
    would hand `programDamage` a base to drop that the printed card meant to deal. */
const ALSO_FORM =
  "This attack also does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const OWN_SIDE =
  "This attack does 30 damage to each of your Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const EX_FILTERED =
  "This attack does 60 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.";
const EX_V_FILTERED =
  "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance.";

const COMPOUND_NEAR_MISS =
  "This attack does 10 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) Switch this Pokémon with 1 of your Benched Pokémon.";

const READERS: readonly ((t: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const program = (amount: number): EffectOp[] => [
  { op: "damageDefender", amount },
  { op: "spreadDamage", target: "opponentBench", amount },
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

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

const PRINTED_BASE = 90;

function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["fix-pinpoint"];
  if (card === undefined) throw new Error("no fix-pinpoint in pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("fix-pinpoint has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-pinpoint": {
        ...card,
        attacks: [{ ...first, effect, damage: PRINTED_BASE }, ...attacks.slice(1)],
      },
    },
  };
}

function bench(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}

function damage(events: GameEvent[]): { seat: Seat; by: Seat; dealt: number }[] {
  return events.flatMap((e) =>
    e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, by: e.by, dealt: e.dealt }] : [],
  );
}

describe("D482 §1 — the printed data, measured live over the legal column", () => {
  it("the sentence is the CORPUS's bytes at ONE printing, and so are its four neighbours", () => {
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(CHOSEN_ONE)).toBe(2);
    expect(rows.get(BENCH_ONLY_PRINTED)).toBe(3);
    expect(rows.get(BENCH_ONLY)).toBeUndefined();
    expect(rows.get(EX_FILTERED)).toBe(2);
    expect(rows.get(EX_V_FILTERED)).toBe(2);
    expect([1, units(legalAttackCorpus().filter(([, s]) => s === PRINTED))]).toEqual([1, 1]);
    expect(PRINTED.includes("opponent's")).toBe(true);
    expect(PRINTED.includes("opponent’s")).toBe(false);
    expect(PRINTED.codePointAt(PRINTED.indexOf("'"))).toBe(0x0027);
    expect(PRINTED.codePointAt(PRINTED.lastIndexOf("'"))).toBe(0x0027);
    // …and the é is the real U+00E9 in every slot, which is what the anchor spells.
    expect(PRINTED.codePointAt(PRINTED.indexOf("é"))).toBe(0x00e9);
  });

  it("ALL FOUR ANCHOR VARIANTS CLAIM THE SAME 1 SENTENCE / 1 PRINTING — D472, executable", () => {
    const VARIANTS: readonly (readonly [string, RegExp])[] = [
      [
        "narrow (as shipped)",
        new RegExp(
          `^This attack does (\\d+) damage to each of your opponent['’]s Pokémon\\.` +
            `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
        ),
      ],
      [
        "wide: the possessive captured, `SPREAD_EACH_BENCH`'s shape",
        new RegExp(
          `^This attack does (\\d+) damage to each of (your opponent['’]s|your) Pokémon\\.` +
            `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
        ),
      ],
      [
        "wide: `(?:also )?` admitted",
        new RegExp(
          `^This attack (?:also )?does (\\d+) damage to each of your opponent['’]s Pokémon\\.` +
            `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
        ),
      ],
      [
        "narrower still: the W/R clarifier REQUIRED",
        new RegExp(
          `^This attack does (\\d+) damage to each of your opponent['’]s Pokémon\\. ` +
            `\\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\)$`,
        ),
      ],
    ];
    for (const [label, re] of VARIANTS) {
      const hits = legalAttackCorpus().filter(([, s]) => re.test(s));
      expect([label, hits.length, units(hits)]).toEqual([label, 1, 1]);
      expect([label, hits[0]?.[1]]).toEqual([label, PRINTED]);
    }
  });

  it("D482 — the sentence is now RESOLVED, and by exactly one reader", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).toEqual(program(30));
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    for (const text of [
      "This attack does 30 damage to each of your opponent's Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "This attack does 30 damage to each of your opponent's Pokémon ex and Pokémon V. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect(resolvedByAnyReader(text), text).toBe(false);
      for (const read of READERS) expect(read(text), `${read.name} / ${text}`).toBeNull();
    }
    for (const text of [EX_FILTERED, EX_V_FILTERED]) {
      expect(deriveAttackEffect(text), text).not.toBeNull();
      for (const read of READERS) {
        if (read === deriveAttackEffect) continue;
        expect(read(text), `${read.name} / ${text}`).toBeNull();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reading, and both halves read against their SHIPPED producers.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §2 — a two-op program of ops that already ship", () => {
  it("the BENCH half is byte-identical to `SPREAD_EACH_BENCH`'s own output", () => {
    const bare = deriveAttackEffect(BENCH_ONLY);
    expect(bare).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 30 }]);
    expect(deriveAttackEffect(PRINTED)?.slice(1)).toEqual(bare);
  });

  it("the ACTIVE half is `damageDefender`'s FLAT arm — the §8.5 pipeline, not a counter", () => {
    expect(deriveAttackEffect(PRINTED)?.[0]).toEqual({ op: "damageDefender", amount: 30 });
    // …and it is the FLAT arm: the union refuses `per`/`count` beside `amount`
    // (`discardEnergy`'s idiom, effects.ts), so an op carrying both cannot be spelled.
    const head = deriveAttackEffect(PRINTED)?.[0];
    expect(head !== undefined && "amount" in head).toBe(true);
    expect(Object.keys(head ?? {}).sort()).toEqual(["amount", "op"]);
  });

  it("the AMOUNT is a printed capture and BOTH halves take it", () => {
    for (const n of [10, 30, 120]) {
      const text = PRINTED.replace("30 damage", `${n} damage`);
      expect(deriveAttackEffect(text), text).toEqual(program(n));
    }
    expect(deriveAttackEffect(PRINTED.replace("30 damage", "0 damage"))).toEqual(program(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the refusals, each pinned on ONE printed byte.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §3 — the refusals, and the sharpest one is a `not.toEqual`", () => {
  it("the QUANTIFIER refuses BOTH WAYS — `each of` and `1 of` are different OPS", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(program(30));
    expect(deriveAttackEffect(CHOSEN_ONE)).not.toEqual(program(30));
    expect(deriveAttackEffect(CHOSEN_ONE)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 30,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("`also` IS REFUSED, and it is the one narrowing that is not merely unpaid risk", () => {
    expect(deriveAttackEffect(ALSO_FORM)).toBeNull();
    for (const read of READERS) expect(read(ALSO_FORM), read.name).toBeNull();
    // …while the sibling's own "also" wording still builds, which is what makes the line
    // above a claim about THIS anchor and not about the word.
    expect(
      deriveAttackEffect(
        `This attack also does 30 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`,
      ),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 30 }]);
  });

  it("the POSSESSIVE is spelled, not captured — the own-side wording is refused", () => {
    expect(deriveAttackEffect(OWN_SIDE)).toBeNull();
    for (const read of READERS) expect(read(OWN_SIDE), read.name).toBeNull();
    // …and the sibling's own-side wording still builds, at `target: "yourBench"`.
    expect(
      deriveAttackEffect(
        "This attack also does 30 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "spreadDamage", target: "yourBench", amount: 30 }]);
  });

  it("the ZONE NOUN is load-bearing — `Benched Pokémon` is a different program", () => {
    // One word, two programs. Without this pair, a build that dropped the whole
    // `damageDefender` half would still look correct on every bench assertion in §4.
    expect(deriveAttackEffect(BENCH_ONLY)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 30 },
    ]);
    expect(deriveAttackEffect(BENCH_ONLY)).not.toEqual(program(30));
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing clause is refused", () => {
    for (const text of [
      `Draw a card. ${PRINTED}`,
      `${PRINTED} Your turn ends.`,
      `${PRINTED} This attack's damage isn't affected by Weakness or Resistance.`,
      COMPOUND_NEAR_MISS,
      "This attack does 30 damage to each of your opponent's Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "This attack does 30 damage to each of your opponent's Pokémon ex and Pokémon V. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      PRINTED.toLowerCase(),
      PRINTED.toUpperCase(),
      // The trailing period is required — the failure mode this repo names first,
      // because a regex written from a paraphrase matches no real card.
      "This attack does 30 damage to each of your opponent's Pokémon",
      // A non-numeric amount, and a missing one.
      "This attack does X damage to each of your opponent's Pokémon.",
      "This attack does damage to each of your opponent's Pokémon.",
      // The clarifier mangled — an optional group is not a wildcard tail.
      `${PRINTED.replace("Benched Pokémon.)", "Benched Pokémon.")}`,
      "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness for Benched Pokémon.)",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

function loaded(effect: string = PRINTED): GameState {
  let state = board("fix-pinpoint", "fix-fighting-weak");
  state = bench(state, "p2", ["fix-fighting-weak", "fix-onko", "fix-titan"]);
  return withEffect(state, effect);
}

describe("D482 §4 — hit-everything, hit-active-only and hit-bench-only are three answers", () => {
  it("EVERY body on the opponent's side takes the hit, and the Active takes it FIRST", () => {
    const state = loaded();
    deepFreeze(state);
    const { state: done, events } = swing(state);

    expect(damage(events)).toEqual([
      { seat: "p2", by: "p1", dealt: 60 },
      { seat: "p2", by: "p1", dealt: 30 },
      { seat: "p2", by: "p1", dealt: 30 },
      { seat: "p2", by: "p1", dealt: 30 },
    ]);
    // …and the BOARD agrees with the wire. `fix-onko` is Knocked Out, so the bench it
    // leaves behind is two bodies deep and the survivors carry 30 each.
    expect(done.players.p2.active?.damage).toBe(60);
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    // The attacker's OWN board is untouched — the printed possessive is the opponent's.
    expect(done.players.p1.active?.damage).toBe(0);
    expect(done.players.p1.bench).toHaveLength(0);
  });

  it("…and the bench-only program answers 180 on the Active, not 60 — a DIFFERENT board", () => {
    const { state: done, events } = swing(loaded(BENCH_ONLY));
    expect(damage(events).map((d) => d.dealt)).toEqual([180, 30, 30, 30]);
    expect(done.players.p2.active?.damage).toBe(180);
  });

  it("…and the CHOSEN-single program parks instead of resolving inline", () => {
    const { state: parked } = swing(loaded(CHOSEN_ONE));
    expect(parked.phase.kind).toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the printed parenthetical, driven on ONE card in TWO spots.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §5 — Weakness applies on the Active and NOT on the Bench", () => {
  it("the SAME ×2 Fighting body DOUBLES in the Active Spot and stays FLAT on the Bench", () => {
    const { state: done, events } = swing(loaded());
    const rows = damage(events);
    expect(rows[0]?.dealt).toBe(60); // ×2 Fighting on the ACTIVE — doubled
    expect(rows[1]?.dealt).toBe(30); // the SAME CARD on a BENCH — flat
    expect(done.players.p2.active?.damage).toBe(60);
    expect(done.players.p2.bench[0]?.damage).toBe(30);
    // …and the two bodies really are the same printed card, resolved through
    // `cardIdByUid` off the stack top, so the pair above is a statement about the ZONE
    // and not about two different fixtures.
    expect(done.cardIdByUid[activeUid(done, "p2")]).toBe("fix-fighting-weak");
    expect(done.cardIdByUid[benchTopUid(done, "p2", 0)]).toBe("fix-fighting-weak");
  });

  it("…and a NEUTRAL Active takes the flat 30, which is the control on the doubling", () => {
    // Without this, "60" above is consistent with an arm that simply doubles the Active.
    let state = board("fix-pinpoint", "fix-titan");
    state = bench(state, "p2", ["fix-titan"]);
    const { events } = swing(withEffect(state, PRINTED));
    expect(damage(events).map((d) => d.dealt)).toEqual([30, 30]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the KO among them, and whose Prize it is.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §6 — a spread that Knocks Out a benched body mid-board", () => {
  it("the 30 HP body dies, the 340 HP body does not, and the ATTACKER takes the Prize", () => {
    const { state: after, events } = swing(loaded());
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p1");
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p2.prizes).toHaveLength(6);
    // The KO'd body left the Bench and the two SURVIVORS kept their damage — the fold
    // walked past a body it killed rather than stopping at it.
    expect(done.players.p2.bench).toHaveLength(2);
    expect(done.players.p2.bench.map((p) => p.damage)).toEqual([30, 30]);
    // …and the ACTIVE, which took 60, is nowhere near its 200.
    expect(done.players.p2.active?.damage).toBe(60);
  });

  it("…a body ALREADY damaged is Knocked Out by the same 30, and an undamaged twin is not", () => {
    // The lethality is arithmetic, not a property of `fix-onko`: two `fix-titan`s, one
    // pre-damaged to 320. Same op, same amount, opposite fates on one board.
    let state = board("fix-pinpoint", "fix-titan");
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    state = setBenchDamage(state, "p2", 0, 320);
    const { state: after, events } = swing(withEffect(state, PRINTED));
    expect(damage(events).map((d) => d.dealt)).toEqual([30, 30, 30]);
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.players.p2.bench).toHaveLength(1);
    expect(done.players.p2.bench[0]?.damage).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the ZERO-MATCH board, with its controls.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §7 — an EMPTY opponent Bench, and the two builds that agree there", () => {
  it("a lone Active takes its W/R-applied hit and the spread half is silently a no-op", () => {
    const state = board("fix-pinpoint", "fix-fighting-weak");
    expect(state.players.p2.bench).toHaveLength(0);
    const { state: done, events } = swing(withEffect(state, PRINTED));
    expect(damage(events)).toEqual([{ seat: "p2", by: "p1", dealt: 60 }]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(done.players.p2.active?.damage).toBe(60);
    expect(done.players.p2.bench).toHaveLength(0);
  });

  it("…and the CONTROL: the same empty bench under the bench-only sibling files the BASE", () => {
    const state = board("fix-pinpoint", "fix-fighting-weak");
    const { state: done, events } = swing(withEffect(state, BENCH_ONLY));
    expect(damage(events)).toEqual([{ seat: "p2", by: "p1", dealt: 180 }]);
    expect(done.players.p2.active?.damage).toBe(180);
  });

  it("…and a printed ZERO places nothing FROM EITHER OP, on a board that is otherwise §4's", () => {
    const { state: done, events } = swing(loaded(PRINTED.replace("30 damage", "0 damage")));
    expect(damage(events)).toEqual([]);
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.players.p2.bench.map((p) => p.damage)).toEqual([0, 0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the printed base, and the reason `also` is refused.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §8 — the printed base is DROPPED, and that is `programDamage`'s doing", () => {
  it("the demonstrator prints `damage: 90` and the Active takes 60 — the OP's number", () => {
    const state = loaded();
    expect(state.cardPool["fix-pinpoint"]?.attacks?.[0]?.damage).toBe(PRINTED_BASE);
    const { state: done, events } = swing(state);
    expect(damage(events).map((d) => d.dealt)).toEqual([60, 30, 30, 30]);
    expect(damage(events).some((d) => d.dealt === 180)).toBe(false);
    expect(done.players.p2.active?.damage).toBe(60);
  });

  it("…and the sibling KEEPS its base on the identical board, which is the control", () => {
    const { state: done, events } = swing(loaded(BENCH_ONLY));
    expect(damage(events).map((d) => d.dealt)).toEqual([180, 30, 30, 30]);
    expect(done.players.p2.active?.damage).toBe(180);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the pins: the reader surface, the version, and the record constant.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §9 — the surface, the version and what does NOT move", () => {
  it("the hand-kept READERS list is the MODULE's, not a copy that has gone short", () => {
    expect(READERS.map((r) => r.name).sort()).toEqual([...attackReaderSurface()].sort());
    expect(READERS).toHaveLength(14);
  });

  it("`MATCH_RECORD_VERSION` does NOT move, and the argument is BOTH of D463's tests", () => {
    const ops = deriveAttackEffect(PRINTED) ?? [];
    expect(ops.map((o) => o.op)).toEqual(["damageDefender", "spreadDamage"]);
    expect(roundTrip(ops)).toEqual(program(30));
    const { state: after } = swing(loaded());
    expect(after.phase.kind).not.toBe("effect:choose");
  });
});
