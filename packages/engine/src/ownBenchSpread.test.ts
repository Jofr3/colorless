import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  OWN_BENCH_SPREAD_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setPrizes,
  types,
} from "./testFixtures";

const SEED = 5;

const AMOUNTS = [10, 20, 30] as const;
const own = (n: number) =>
  `This attack also does ${n} damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
const opp = (n: number) =>
  `This attack also does ${n} damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`;

const TREMOR = { home: 0, away: 1 } as const;
const QUAKE = { krookodile: 1, tyranitar: 1 } as const;

const ENERGY: Record<string, { id: string; count: number }[]> = {
  "fix-tremor": [{ id: "fix-energy", count: 2 }],
  "sv01-117": [{ id: "fix-fighting-energy", count: 2 }],
  "swsh10.5-043": [
    { id: "fix-darkness-energy", count: 2 },
    { id: "fix-energy", count: 2 },
  ],
};

function board(attacker: string, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: OWN_BENCH_SPREAD_DECK, p2: OWN_BENCH_SPREAD_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, attacker);
  state = clearBench(state, by);
  for (const { id, count } of ENERGY[attacker] ?? []) {
    state = attachFromDeck(state, by, id, count);
  }
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

function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

describe("§1 — the printed data: three amounts, two real cards, one constructed pair", () => {
  it("the corpus prints exactly these three sentences at exactly these counts", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(own(10))).toBe(3);
    expect(rows.get(own(20))).toBe(1);
    expect(rows.get(own(30))).toBe(1);
    const family = legalAttackCorpus().filter(
      ([, s]) => /damage to each of your Benched Pokémon/.test(s) && !/opponent/.test(s),
    );
    expect(family.map(([, s]) => s).sort()).toEqual([own(10), own(20), own(30)].sort());
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(5);
  });

  it("the apostrophe byte is U+0027 and there is exactly ONE slot", () => {
    const sentence = own(10);
    expect(sentence).toContain("Don't");
    expect(sentence).not.toContain("’");
    expect(sentence).toContain("Pokémon");
    expect(sentence.split(/['’]/).length - 1).toBe(1);
    expect(opp(10).split(/['’]/).length - 1).toBe(2);
  });

  it("the two REAL carriers print it at their printed index, and were carried UNSIMULATED", () => {
    expect(FIXTURE_POOL["sv01-117"]?.attacks?.[QUAKE.krookodile]).toMatchObject({
      name: "Earthquake",
      cost: ["Fighting", "Fighting"],
      effect: own(30),
      damage: 180,
    });
    expect(FIXTURE_POOL["swsh10.5-043"]?.attacks?.[QUAKE.tyranitar]).toMatchObject({
      name: "Earthquake",
      cost: ["Darkness", "Darkness", "Colorless", "Colorless"],
      effect: own(20),
      damage: 180,
    });
  });

  it("`fix-tremor` carries BOTH possessives of ONE shape, and the SIDE is the only difference", () => {
    expect(FIXTURE_POOL["fix-tremor"]?.attacks).toEqual([
      {
        cost: ["Colorless", "Colorless"],
        name: "Home Tremor",
        effect: own(10),
        damage: 30,
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Away Tremor",
        effect: opp(10),
        damage: 30,
      },
    ]);
    expect(FIXTURE_POOL["fix-tremor"]?.types).toEqual(["Fighting"]);
    expect(FIXTURE_POOL["fix-tremor"]?.hp).toBe(140);
  });

  it("AUTHORS nothing — all three printings are read off the TEXT", () => {
    // A registry-authored program would win over the reader (D8), so this is the
    // claim that says the text path is the one being driven below.
    for (const id of ["fix-tremor", "sv01-117", "swsh10.5-043"]) {
      expect(programFor(id)?.attack ?? undefined).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader: the amount is a capture, and so is the SIDE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — one anchor, two possessives, three amounts", () => {
  it("reads all THREE printed amounts onto the attacker's own Bench", () => {
    for (const n of AMOUNTS) {
      expect(deriveAttackEffect(own(n))).toEqual([
        { op: "spreadDamage", target: "yourBench", amount: n },
      ]);
    }
  });

  it("…and the SHIPPED opponent-side twin is UNMOVED — the control this rung needs", () => {
    for (const n of AMOUNTS) {
      expect(deriveAttackEffect(opp(n))).toEqual([
        { op: "spreadDamage", target: "opponentBench", amount: n },
      ]);
    }
    // The bare (no "also") opponent-side form, and its own-side mirror — the
    // optional rider is shared by construction now, which is the whole argument for
    // one anchor rather than two.
    expect(
      deriveAttackEffect(
        `This attack does 50 damage to each of your opponent's ${"Benched"} Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`,
      ),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 50 }]);
    expect(
      deriveAttackEffect(
        "This attack does 50 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "spreadDamage", target: "yourBench", amount: 50 }]);
  });

  it("the W/R parenthetical is optional on BOTH wordings, and nothing else changed", () => {
    expect(
      deriveAttackEffect("This attack also does 10 damage to each of your Benched Pokémon."),
    ).toEqual([{ op: "spreadDamage", target: "yourBench", amount: 10 }]);
    expect(
      deriveAttackEffect(
        "This attack also does 10 damage to each of your opponent's Benched Pokémon.",
      ),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 10 }]);
    expect(deriveAttackEffect(own(10).replace("Don't", "Don’t"))).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 10 },
    ]);
  });

  it("refuses the near-misses — and ADMITS one on the same axis beside each", () => {
    const pairs: readonly (readonly [string, string, string])[] = [
      // possessive: an owner word this sentence never prints ↔ the two it does
      [
        "a THIRD possessive",
        "This attack also does 10 damage to each of my Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        own(10),
      ],
      [
        "`all of` (a quantifier neither anchor spells)",
        "This attack also does 10 damage to all of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        own(10),
      ],
      [
        "`each Benched Pokémon` with no owner and no seat scope",
        "This attack also does 10 damage to each Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        own(10),
      ],
      [
        "a SCALED tail, own side — refused by BOTH anchors",
        "This attack also does 10 damage to each of your Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        own(10),
      ],
      // the lookalike é falls off the path silently, which is the family's reason
      ["a lookalike `Pokemon`", own(10).replace(/Pokémon/g, "Pokemon"), own(10)],
      // no leading `This attack`: a mid-sentence clause must not reach this path
      ["a mid-sentence clause", `Flip a coin. ${own(10)}`, own(10)],
    ];
    for (const [why, refused, admitted] of pairs) {
      expect(deriveAttackEffect(refused), `REFUSED: ${why}`).toBeNull();
      expect(deriveAttackEffect(admitted), `ADMITTED beside ${why}`).not.toBeNull();
    }
  });

  it("the OTHER unbuilt own-side shapes are STILL unbuilt — priced, not swept in", () => {
    const stillUnbuilt: readonly string[] = [];
    const composed: readonly (readonly [string, readonly EffectOp[]])[] = [
      [
        "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        [
          { op: "damageDefender", amount: 30 },
          { op: "spreadDamage", target: "opponentBench", amount: 30 },
        ],
      ],
      [
        "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        [
          { op: "spreadDamage", target: "yourBench", amount: 40, damagedOnly: true },
          { op: "spreadDamage", target: "opponentBench", amount: 40, damagedOnly: true },
        ],
      ],
      [
        "This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        [
          {
            op: "conditionGate",
            cond: { kind: "opponentActiveDamaged" },
            // biome-ignore lint/suspicious/noThenProperty: gated-step list, not a thenable.
            then: [{ op: "damageDefender", amount: 50 }],
          },
          { op: "spreadDamage", target: "yourBench", amount: 50, damagedOnly: true },
          { op: "spreadDamage", target: "opponentBench", amount: 50, damagedOnly: true },
        ],
      ],
    ];
    const targets = new Set<string>();
    for (const [text, ops] of composed) {
      expect(resolvedByAnyReader(text), `composed: ${text}`).toBe(true);
      expect(deriveAttackEffect(text), text).toEqual(ops);
      for (const op of ops) if (op.op === "spreadDamage") targets.add(op.target);
    }
    // `spreadDamage.target` is STILL `"opponentBench" | "yourBench"` — every composition
    // above reaches an Active through `damageDefender`, never through a third member.
    expect([...targets].sort()).toEqual(["opponentBench", "yourBench"]);
    for (const [text, amount, rider] of [
      [
        "This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        10,
        {},
      ],
      [
        "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        40,
        { damagedOnly: true },
      ],
    ] as const) {
      expect(resolvedByAnyReader(text), `claimed at D507: ${text}`).toBe(true);
      expect(deriveAttackEffect(text), text).toEqual([
        { op: "spreadDamage", target: "yourBench", amount, ...rider },
        { op: "spreadDamage", target: "opponentBench", amount, ...rider },
      ]);
    }
    for (const s of [
      "This attack also does 10 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "This attack also does 40 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect(resolvedByAnyReader(s), `claimed at D447: ${s}`).toBe(true);
      expect(deriveAttackEffect(s), s).toEqual([
        {
          op: "damageChosen",
          target: "yourBench",
          amount: Number(/does (\d+) damage/.exec(s)?.[1]),
          count: 1,
          source: "attack",
          deals: true,
        },
      ]);
    }
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    for (const s of stillUnbuilt) {
      expect(rows.get(s), `is a real corpus row: ${s}`).toBeGreaterThanOrEqual(1);
      expect(resolvedByAnyReader(s), `still unbuilt: ${s}`).toBe(false);
    }
    for (const n of AMOUNTS) expect(resolvedByAnyReader(own(n))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the widening, and the version prediction DRIVEN in both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `target` is a union now, and the record version does not move", () => {
  it("both values are inhabited by PRINTED sentences, not just by the type", () => {
    const seen = new Set<string>();
    for (const [, text] of legalAttackCorpus()) {
      for (const op of (deriveAttackEffect(text) ?? []) as EffectOp[]) {
        if (op.op === "spreadDamage") seen.add(op.target);
      }
    }
    expect([...seen].sort()).toEqual(["opponentBench", "yourBench"]);
  });

  it("the version PREDICTION, driven both directions: this is a WIDENING", () => {
    const old: EffectOp = { op: "spreadDamage", target: "opponentBench", amount: 20 };
    expect(deriveAttackEffect(opp(20))).toEqual([old]);
    for (const [id, index] of [
      ["fix-tremor", TREMOR.home],
      ["sv01-117", QUAKE.krookodile],
      ["swsh10.5-043", QUAKE.tyranitar],
    ] as const) {
      const state = bench(board(id, "fix-titan"), "p1", ["fix-titan", "fix-titan"]);
      const { state: done } = swing(state, index);
      // The whole attack resolved to the turn tail in ONE action: no
      // `effect:choose`, so no `EffectContinuation`, so no `pendingOp` — which is
      // the only address in `MatchRecord.state` an `EffectOp` is ever written to.
      expect(done.phase.kind, id).not.toBe("effect:choose");
      expect(
        done.pending.map((stage) => stage.kind),
        id,
      ).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the damage lands, on the right bench, from both seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — every own benched body, and NOT the opponent's", () => {
  it("hits EVERY body on the attacker's own Bench and none on the opponent's", () => {
    // Three own bodies, two across the table: a fold that stopped at the first, or
    // that walked the wrong side, or that walked BOTH, all differ here.
    let state = bench(board("sv01-117", "fix-titan"), "p1", [
      "fix-titan",
      "fix-titan",
      "fix-titan",
    ]);
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const { state: done, events } = swing(state, QUAKE.krookodile);
    expect(damage(events)).toEqual([
      { seat: "p2", by: "p1", dealt: 180 }, // the main §8.5 hit on the Defender
      { seat: "p1", by: "p1", dealt: 30 },
      { seat: "p1", by: "p1", dealt: 30 },
      { seat: "p1", by: "p1", dealt: 30 },
    ]);
    expect(done.players.p1.bench.map((b) => b.damage)).toEqual([30, 30, 30]);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([0, 0]);
  });

  it("ONE card, ONE amount, ONE board, TWO indices — the side is the ONLY difference", () => {
    const start = bench(
      bench(board("fix-tremor", "fix-titan"), "p1", ["fix-titan", "fix-titan"]),
      "p2",
      ["fix-titan", "fix-titan", "fix-titan"],
    );
    const home = swing(start, TREMOR.home);
    const away = swing(start, TREMOR.away);
    expect(home.state.players.p1.bench.map((b) => b.damage)).toEqual([10, 10]);
    expect(home.state.players.p2.bench.map((b) => b.damage)).toEqual([0, 0, 0]);
    expect(away.state.players.p1.bench.map((b) => b.damage)).toEqual([0, 0]);
    expect(away.state.players.p2.bench.map((b) => b.damage)).toEqual([10, 10, 10]);
    // …and the main hit is identical on both, so nothing else about the two
    // declarations can be what the assertion above is measuring.
    expect(damage(home.events)[0]).toEqual({ seat: "p2", by: "p1", dealt: 30 });
    expect(damage(away.events)[0]).toEqual({ seat: "p2", by: "p1", dealt: 30 });
  });

  it("BOTH SEATS — p2 attacking splashes p2's Bench, not p1's", () => {
    // `ctx.seat` is the attacker's seat, so a build that hard-coded `p1` anywhere in
    // the new branch is invisible until the other seat swings.
    let state = bench(board("fix-tremor", "fix-titan", "p2"), "p2", ["fix-titan", "fix-titan"]);
    state = bench(state, "p1", ["fix-titan"]);
    const { state: done, events } = swing(state, TREMOR.home, "p2");
    expect(damage(events)).toEqual([
      { seat: "p1", by: "p2", dealt: 30 },
      { seat: "p2", by: "p2", dealt: 10 },
      { seat: "p2", by: "p2", dealt: 10 },
    ]);
    expect(done.players.p1.bench.map((b) => b.damage)).toEqual([0]);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([10, 10]);
  });

  it("an EMPTY own Bench is a silent no-op, and so is an empty opponent Bench", () => {
    // Both directions off the same card. `spreadDamage` returns the state untouched
    // on a bench of none — no rows, no throw, and the main hit still lands.
    for (const index of [TREMOR.home, TREMOR.away]) {
      const { state: done, events } = swing(board("fix-tremor", "fix-titan"), index);
      expect(damage(events)).toEqual([{ seat: "p2", by: "p1", dealt: 30 }]);
      expect(done.players.p1.bench).toEqual([]);
      expect(done.players.p2.bench).toEqual([]);
    }
  });

  it("no ATTACK_EFFECT_SKIPPED in EITHER direction — the sentence is not loud any more", () => {
    for (const populated of [true, false]) {
      for (const index of [TREMOR.home, TREMOR.away]) {
        const start = populated
          ? bench(bench(board("fix-tremor", "fix-titan"), "p1", ["fix-titan"]), "p2", ["fix-titan"])
          : board("fix-tremor", "fix-titan");
        expect(types(swing(start, index).events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      }
    }
    // …and the two REAL carriers likewise, at their printed indices.
    for (const [id, index] of [
      ["sv01-117", QUAKE.krookodile],
      ["swsh10.5-043", QUAKE.tyranitar],
    ] as const) {
      const start = bench(board(id, "fix-titan"), "p1", ["fix-titan"]);
      expect(types(swing(start, index).events), id).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("the board is not mutated — a frozen state resolves either direction", () => {
    // The purity pair. Every op in this program writes through spreads; a build that
    // mutated `side.bench` in place to save an allocation throws here rather than
    // corrupting a caller's state.
    for (const index of [TREMOR.home, TREMOR.away]) {
      const state = bench(
        bench(board("fix-tremor", "fix-titan"), "p1", ["fix-titan", "fix-titan"]),
        "p2",
        ["fix-titan"],
      );
      deepFreeze(state);
      expect(() => applyAction(state, { type: "attack", seat: "p1", index })).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the parenthetical is the RULE, and it needs its own control.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — Weakness is genuinely not applied on the Bench", () => {
  it("a ×2 Weakness body DOUBLES on the Active and stays FLAT on the Bench — one board", () => {
    const state = bench(board("fix-tremor", "fix-fighting-weak"), "p1", ["fix-fighting-weak"]);
    const { events } = swing(state, TREMOR.home);
    const rows = events.flatMap((e) => (e.type === "DAMAGE_DEALT" ? [e] : []));
    expect(rows[0]).toMatchObject({ seat: "p2", base: 30, dealt: 60 });
    expect(rows[0]?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(rows[1]).toMatchObject({ seat: "p1", base: 10, dealt: 10 });
    expect(rows[1]?.weakness).toBeNull();
    expect(rows[1]?.resistance).toBeNull();
  });

  it("…and the OPPONENT-side splash is flat on a ×2 body too — the shipped half is unmoved", () => {
    const state = bench(board("fix-tremor", "fix-titan"), "p2", ["fix-fighting-weak"]);
    const { events } = swing(state, TREMOR.away);
    const rows = events.flatMap((e) => (e.type === "DAMAGE_DEALT" ? [e] : []));
    expect(rows[1]).toMatchObject({ seat: "p2", base: 10, dealt: 10, weakness: null });
  });
});

describe("§6 — your own Knock Out, and the Prize goes to your OPPONENT", () => {
  /** The attacker's own benched `fix-fighting-weak` at 190 of 200, so Tyranitar's
      printed 20 splash is exactly lethal on it and on nothing else. */
  function selfLethal(): GameState {
    let state = bench(board("swsh10.5-043", "fix-titan"), "p1", ["fix-fighting-weak", "fix-titan"]);
    state = setBenchDamage(state, "p1", 0, 190);
    return state;
  }

  it("§8.1 Knocks Out the ATTACKER's own benched body and owes the PRIZE to the OPPONENT", () => {
    const { state, events } = swing(selfLethal(), QUAKE.tyranitar);
    expect(events.flatMap((e) => (e.type === "KNOCKED_OUT" ? [e.seat] : []))).toEqual(["p1"]);
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(state.players.p1.prizes).toHaveLength(6);
    expect(state.players.p2.prizes).toHaveLength(6);
    const { state: taken } = mustApply(state, {
      type: "takePrizes",
      seat: "p2",
      prizeIndices: [0],
    });
    expect(taken.players.p1.prizes).toHaveLength(6);
    expect(taken.players.p2.prizes).toHaveLength(5);
    // The turn tail was queued BEHIND the prize and resumes once it is paid.
    expect(taken.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("a BENCHED Knock Out owes NO promotion — verified, not assumed", () => {
    const { state } = swing(selfLethal(), QUAKE.tyranitar);
    expect(state.pending.filter((s) => s.kind === "promote")).toEqual([]);
    expect(state.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
    // The attacker's Active is untouched and its bench is one body shorter.
    expect(state.players.p1.active?.damage).toBe(0);
    expect(state.players.p1.bench).toHaveLength(1);
  });

  it("BOTH boards in ONE batch, and §8.1's Prize ORDER holds", () => {
    let state = bench(board("sv01-117", "fix-fighting-weak"), "p1", ["fix-fighting-weak"]);
    state = setBenchDamage(state, "p1", 0, 190);
    const { state: done, events } = swing(state, QUAKE.krookodile);
    expect(events.flatMap((e) => (e.type === "KNOCKED_OUT" ? [e.seat] : []))).toEqual(["p2", "p1"]);
    expect(done.pending.map((s) => [s.kind, s.seat])).toEqual([
      ["takePrizes", "p1"], // for the DEFENDER's Knocked Out Active — attacker first
      ["takePrizes", "p2"], // for the ATTACKER's own Knocked Out benched body
      ["promote", "p2"], // …and only the emptied ACTIVE Spot owes one
      ["endTurn", "p1"],
      ["checkup", "p1"],
      ["startTurn", "p2"],
    ]);
  });

  it("D189 — the attack changed its OWN board and the epilogue still addresses the attacker", () => {
    const { state } = swing(selfLethal(), QUAKE.tyranitar);
    expect(state.players.p1.active?.usedAttack).toMatchObject({ name: "Earthquake" });
    expect(state.players.p1.bench).toHaveLength(1);
    // …and the attacker took no damage from its own spread: the Active is not on
    // the Bench, which is the one-sentence statement of why this is safe.
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("a full-HP own benched body SURVIVES a splash that would otherwise be lethal", () => {
    const state = bench(board("swsh10.5-043", "fix-titan"), "p1", ["fix-titan"]);
    const { state: done, events } = swing(state, QUAKE.tyranitar);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(done.players.p1.bench.map((b) => b.damage)).toEqual([20]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — and it can END the game, in the attacker's disfavour.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the game ends on a Prize the attacker handed over", () => {
  it("the OPPONENT wins outright when their last Prize comes off the attacker's own KO", () => {
    let state = bench(board("swsh10.5-043", "fix-titan"), "p1", ["fix-fighting-weak", "fix-titan"]);
    state = setBenchDamage(state, "p1", 0, 190);
    state = setPrizes(state, "p2", 1);
    const { state: done, events } = swing(state, QUAKE.tyranitar);
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT", // the main hit on the Defender
      "DAMAGE_DEALT", // the splash on the attacker's own benched body…
      "DAMAGE_DEALT", // …and on its teammate
      "KNOCKED_OUT",
      "PRIZES_TAKEN",
      "GAME_OVER",
    ]);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p2", reason: "prizesTaken" },
    });
  });

  it("…and with TWO Prizes left it parks instead, which is the control on the rung above", () => {
    let state = bench(board("swsh10.5-043", "fix-titan"), "p1", ["fix-fighting-weak", "fix-titan"]);
    state = setBenchDamage(state, "p1", 0, 190);
    state = setPrizes(state, "p2", 2);
    const { state: done } = swing(state, QUAKE.tyranitar);
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    const { state: taken } = mustApply(done, {
      type: "takePrizes",
      seat: "p2",
      prizeIndices: [0],
    });
    expect(taken.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(taken.players.p2.prizes).toHaveLength(1);
  });
});

describe("§8 — `DAMAGE_DEALT.by`, and the row it stopped getting wrong", () => {
  it("the own-side splash is voiced by the ATTACKER, not by the defender", () => {
    const state = bench(board("sv01-117", "fix-titan"), "p1", ["fix-fighting-weak"]);
    const { state: done, events } = swing(state, QUAKE.krookodile);
    expect(rendered(done, events)).toEqual([
      { who: "p1", text: "Krookodile used Earthquake" },
      { who: "p1", text: "dealt 180 damage to fix-titan" },
      { who: "p1", text: "dealt 30 damage to fix-fighting-weak" },
      { who: "p1", text: "ended their turn" },
      { who: "p2", text: "drew a card" },
    ]);
  });

  it("…and every PRE-D425 row still renders under the opposite seat — the control", () => {
    const state = bench(board("fix-tremor", "fix-titan"), "p2", ["fix-titan"]);
    const { state: done, events } = swing(state, TREMOR.away);
    expect(rendered(done, events).slice(0, 3)).toEqual([
      { who: "p1", text: "fix-tremor used Away Tremor" },
      { who: "p1", text: "dealt 30 damage to fix-titan" },
      { who: "p1", text: "dealt 10 damage to fix-titan" },
    ]);
    // The event's own fields are what separates the two: the damaged body's owner
    // is p2 here and p1 above, while the DEALER is p1 on both.
    expect(damage(events)).toEqual([
      { seat: "p2", by: "p1", dealt: 30 },
      { seat: "p2", by: "p1", dealt: 10 },
    ]);
  });

  it("`by` equals `otherSeat(seat)` on every board that is not an own-side spread", () => {
    const opponentSide = swing(
      bench(board("fix-tremor", "fix-titan"), "p2", ["fix-titan"]),
      TREMOR.away,
    );
    for (const row of damage(opponentSide.events)) {
      expect(row.by).not.toBe(row.seat);
    }
    const ownSide = swing(
      bench(board("fix-tremor", "fix-titan"), "p1", ["fix-titan"]),
      TREMOR.home,
    );
    const [main, splash] = damage(ownSide.events);
    expect(main).toEqual({ seat: "p2", by: "p1", dealt: 30 });
    expect(splash).toEqual({ seat: "p1", by: "p1", dealt: 10 }); // …and here it does NOT
  });
});
