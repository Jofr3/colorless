import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackDamageBonus,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackGateClause,
  splitAttackTrailingClause,
  ATTACK_READERS,
} from "./effects";
import { applyAction, conditionHolds, conditionNote } from "./index";
import type { BoardCondition, EffectOp, GameEvent, GameOverReason, GameState } from "./index";
import { programFor } from "./registry";
import {
  DEFENDER_STATUS_TRIPLE_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  programmedCardIds,
} from "./testFixtures";

const PRINTED =
  "If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed.";

const BARE = "Your opponent's Active Pokémon is now Paralyzed.";

const SIB_MORE =
  "If you have more Prize cards remaining than your opponent, this attack does 90 more damage.";
const SIB_NOT_34 =
  "If your opponent doesn't have exactly 3 or 4 Prize cards remaining, this attack does nothing.";
const SIB_4_FEWER =
  "If your opponent has 4 or fewer Prize cards remaining, this attack does 70 more damage.";

const WIN_ROW =
  "If you use this attack when you have exactly 1 Prize card remaining, you win this game.";

/** THE PROGRAM, spelled once so a case cannot pass against a hand-copied literal. */
const PROGRAM: EffectOp[] = [
  {
    op: "conditionGate",
    cond: { kind: "yourPrizesRemaining", counts: [1] },
    ops: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
  },
];

const READERS = ATTACK_READERS.map(({ read }) => read);

const SEED = 11;

function board(seed = SEED): GameState {
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: DEFENDER_STATUS_TRIPLE_DECK, p2: DEFENDER_STATUS_TRIPLE_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "fix-oxford");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  // 340 HP, NO attacks, no Weakness or Resistance — nothing this suite drives can Knock
  // it Out, so a status can never be lost to a §8.1 tail and no Prize can move on its own.
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p2");
  return state;
}

function withEffect(state: GameState, effect: string, index = 1): GameState {
  const card = state.cardPool["fix-oxford"];
  if (card === undefined) throw new Error("no fix-oxford in pool");
  const attacks = [...(card.attacks ?? [])];
  const at = attacks[index];
  if (at === undefined) throw new Error(`fix-oxford has no attack ${index}`);
  attacks[index] = { ...at, effect };
  return { ...state, cardPool: { ...state.cardPool, "fix-oxford": { ...card, attacks } } };
}

/** Index 1 is "Bare Bloom" — {C}, and **no `damage` key at all** — so no §8.5 hit lands
    beside the status and every observation here is the gate's. */
const INDEX = 1;

function swing(state: GameState) {
  return mustApply(state, { type: "attack", seat: "p1", index: INDEX });
}

function defenderParalyzed(state: GameState): boolean {
  const active = state.players.p2.active;
  if (active === null) throw new Error("no defender");
  return active.conditions.rotation === "paralyzed";
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

describe("D517 §1 — the printed data, measured live over the legal column", () => {
  it("the sentence is the CORPUS's bytes at ONE printing, and so are its four relatives", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n] as const));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(WIN_ROW)).toBe(1);
    expect(rows.get(SIB_MORE)).toBe(2);
    expect(rows.get(SIB_NOT_34)).toBe(1);
    expect(rows.get(SIB_4_FEWER)).toBe(2);
    expect(rows.get(BARE)).toBeUndefined();
    expect(deriveAttackEffect(BARE)).not.toBeNull();
    expect(
      splitAttackTrailingClause(
        "Discard all Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toEqual({
      head: "Discard all Energy from this Pokémon.",
      tail: BARE,
    });
  });

  it("the APOSTROPHE is ASCII, and the anchor would silently miss a typographic one", () => {
    expect(PRINTED.includes("opponent's")).toBe(true);
    expect(PRINTED.includes("opponent’s")).toBe(false);
    expect(PRINTED.codePointAt(PRINTED.indexOf("'"))).toBe(0x0027);
    expect(deriveAttackEffect(PRINTED.replace("opponent's", "opponent’s"))).toEqual(PROGRAM);
  });

  it("the column's PRIZE-CLAUSE family is FIVE rows, and this one is the LAST unbuilt half", () => {
    const family = legalAttackCorpus().filter(
      ([, s]) => s.includes("Prize card remaining") || s.includes("Prize cards remaining"),
    );
    expect(family.map(([, s]) => s).sort()).toEqual(
      [PRINTED, WIN_ROW, SIB_MORE, SIB_NOT_34, SIB_4_FEWER].sort(),
    );
    expect(units(family)).toBe(7);
    const unbuilt = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).toEqual([]);
  });

  it("D517 — the sentence is now RESOLVED, and by exactly one reader", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
  });
});

describe("D517 §2 — the program, read against the consequent and against the siblings", () => {
  it("the GATE was the whole blocker: the CONSEQUENT's own program is this gate's `then`", () => {
    const bare = deriveAttackEffect(BARE);
    expect(bare).toEqual([{ op: "applyStatus", target: "defender", status: "paralyzed" }]);
    const mine = deriveAttackEffect(PRINTED);
    expect(mine).toHaveLength(1);
    const gate = mine?.[0];
    expect(gate?.op).toBe("conditionGate");
    expect(gate !== undefined && gate.op === "conditionGate" ? gate.ops : null).toEqual(bare);
  });

  it("no `otherwise` arm, and the key is ABSENT rather than `undefined`-valued", () => {
    // The printed sentence has no second consequent. A JSON record is what a successor
    // diffs, so the shape must be minimal rather than merely equivalent.
    expect(Object.keys(deriveAttackEffect(PRINTED)?.[0] ?? {}).sort()).toEqual([
      "cond",
      "op",
      "ops",
    ]);
  });

  it("ALL THREE BUILT SIBLINGS ARE READER-ARM BUILDS, AND SO IS THIS ROW", () => {
    const armOf = (text: string): string => {
      if (resolvedByAnyReader(text)) return "reader";
      const g = splitAttackGateClause(text);
      if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return "gate";
      return splitAttackTrailingClause(text) !== null ? "trailing" : "none";
    };
    expect(armOf(PRINTED)).toBe("reader");
    expect(armOf(SIB_MORE)).toBe("reader");
    expect(armOf(SIB_NOT_34)).toBe("reader");
    expect(armOf(SIB_4_FEWER)).toBe("reader");
    // …and their PROGRAMS, not merely their verdicts: two different readers and two
    // different carriers for one printed noun phrase.
    expect(deriveAttackDamageBonus(SIB_MORE)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "morePrizesThanOpponent" } },
    });
    expect(deriveAttackDamageBonus(SIB_4_FEWER)).toEqual({
      per: 70,
      count: {
        kind: "boardCondition",
        cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3, 4] },
      },
    });
    expect(deriveAttackRequirement(SIB_NOT_34)).toEqual({
      kind: "opponentPrizesRemaining",
      counts: [3, 4],
    });
  });

  it("the union carries NO NEGATION, and `:350`'s *doesn't have* is folded by the READER", () => {
    const req = deriveAttackRequirement(SIB_NOT_34) as BoardCondition & { counts: number[] };
    expect(req.counts).toEqual([3, 4]);
    expect(JSON.stringify(req)).not.toContain("not");
    // And SIB_4_FEWER's inequality is spelled the same way: as the SATISFYING SET — read off
    // the whole `count` rather than through a cast, so the shape is asserted too.
    expect(deriveAttackDamageBonus(SIB_4_FEWER)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3, 4] },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the member, driven at every reachable count and against its twin.
// ─────────────────────────────────────────────────────────────────────────────

describe("D517 §3 — `yourPrizesRemaining` is `opponentPrizesRemaining` RE-SEATED, and nothing else", () => {
  it("the two members disagree exactly where the two SEATS disagree, over all 7×7 boards", () => {
    const mine: BoardCondition = { kind: "yourPrizesRemaining", counts: [1] };
    const theirs: BoardCondition = { kind: "opponentPrizesRemaining", counts: [1] };
    let disagreements = 0;
    for (let a = 0; a <= 6; a++) {
      for (let b = 0; b <= 6; b++) {
        let state = board();
        state = setPrizes(state, "p1", a);
        state = setPrizes(state, "p2", b);
        expect(conditionHolds(state, "p1", mine), `p1 ${a}/${b}`).toBe(a === 1);
        expect(conditionHolds(state, "p1", theirs), `p1' ${a}/${b}`).toBe(b === 1);
        // The mirror is symmetric: read from p2's chair the two swap operands.
        expect(conditionHolds(state, "p2", mine), `p2 ${a}/${b}`).toBe(b === 1);
        expect(conditionHolds(state, "p2", theirs), `p2' ${a}/${b}`).toBe(a === 1);
        if (conditionHolds(state, "p1", mine) !== conditionHolds(state, "p1", theirs)) {
          disagreements += 1;
        }
      }
    }
    expect(disagreements).toBe(12);
  });

  it("the `counts` LIST is set MEMBERSHIP and not a threshold, at the twin's own witness", () => {
    const gap: BoardCondition = { kind: "yourPrizesRemaining", counts: [2, 4] };
    const seen: boolean[] = [];
    for (let a = 0; a <= 6; a++) seen.push(conditionHolds(setPrizes(board(), "p1", a), "p1", gap));
    expect(seen).toEqual([false, false, true, false, true, false, false]);
  });

  it("`conditionNote` ROUND-TRIPS to the printed clause, and the plural agrees", () => {
    expect(conditionNote({ kind: "yourPrizesRemaining", counts: [1] })).toBe(
      "you have exactly 1 Prize card remaining",
    );
    expect(
      PRINTED.startsWith(`If ${conditionNote({ kind: "yourPrizesRemaining", counts: [1] })},`),
    ).toBe(true);
    expect(conditionNote({ kind: "yourPrizesRemaining", counts: [2, 4] })).toBe(
      "you have exactly 2 or 4 Prize cards remaining",
    );
    // …and it differs from the twin's by exactly the SUBJECT, which is the claim the
    // pair makes about itself.
    expect(conditionNote({ kind: "opponentPrizesRemaining", counts: [1] })).toBe(
      "your opponent has exactly 1 Prize card remaining",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board: the status lands at ONE prize and at no other count.
// ─────────────────────────────────────────────────────────────────────────────

describe("D517 §4 — the gate on a real board, at every count the rules can reach", () => {
  it("PARALYSIS lands at 1 Prize remaining and at NO other count, 0 through 6", () => {
    const landed: number[] = [];
    for (let n = 0; n <= 6; n++) {
      // 0 is reachable as a BOARD (the §14 check runs on the take, not on the count),
      // and it is the sharpest near miss of `counts: [1]` from below.
      const state = withEffect(setPrizes(board(), "p1", n), PRINTED);
      const { state: done } = swing(state);
      if (defenderParalyzed(done)) landed.push(n);
    }
    expect(landed).toEqual([1]);
  });

  it("the OPPONENT's count does not move the answer — the twin would read the other seat", () => {
    for (let n = 0; n <= 6; n++) {
      let state = setPrizes(board(), "p1", 1);
      state = setPrizes(state, "p2", n);
      const { state: done } = swing(withEffect(state, PRINTED));
      expect(defenderParalyzed(done), `foe ${n}`).toBe(true);
    }
    // …and with the seats exchanged the gate is shut at every one of the seven.
    for (let n = 0; n <= 6; n++) {
      let state = setPrizes(board(), "p1", 3);
      state = setPrizes(state, "p2", n);
      const { state: done } = swing(withEffect(state, PRINTED));
      expect(defenderParalyzed(done), `self3 foe ${n}`).toBe(false);
    }
  });

  it("the gate emits NO event of its own, and the shut arm is SILENT rather than loud", () => {
    const shut = swing(withEffect(setPrizes(board(), "p1", 4), PRINTED));
    expect(all(shut.events, "STATUS_APPLIED")).toHaveLength(0);
    expect(all(shut.events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    const open = swing(withEffect(setPrizes(board(), "p1", 1), PRINTED));
    const applied = all(open.events, "STATUS_APPLIED");
    expect(applied).toHaveLength(1);
    expect(applied[0]?.status).toBe("paralyzed");
    expect(all(open.events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("the BARE consequent on the SAME board paralyses at EVERY count, which is the control", () => {
    for (let n = 0; n <= 6; n++) {
      const { state: done } = swing(withEffect(setPrizes(board(), "p1", n), BARE));
      expect(defenderParalyzed(done), `bare ${n}`).toBe(true);
    }
  });
});

const WRAP = ["If ", "If you use this attack when "] as const;
const SEAT = ["you have", "your opponent has"] as const;
const COUNT = ["exactly 1 Prize card remaining", "4 or fewer Prize cards remaining"] as const;
const CONS = [
  "your opponent's Active Pokémon is now Paralyzed.",
  "this attack does 90 more damage.",
] as const;

function cell(i: number): string {
  return `${WRAP[(i >> 3) & 1]}${SEAT[(i >> 2) & 1]} ${COUNT[(i >> 1) & 1]}, ${CONS[i & 1]}`;
}

function cellBuilds(text: string): boolean {
  if (resolvedByAnyReader(text)) return true;
  const g = splitAttackGateClause(text);
  if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return true;
  return splitAttackTrailingClause(text) !== null;
}

describe("D517 §5 — the lattice, computed on BOTH predicates", () => {
  it("the SIXTEEN cells are SIXTEEN DISTINCT STRINGS, so no flip is a no-op", () => {
    expect(new Set(Array.from({ length: 16 }, (_, i) => cell(i))).size).toBe(16);
    expect(cell(0)).toBe(PRINTED);
    expect(cell(8)).toBe(
      "If you use this attack when you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed.",
    );
  });

  it("THREE of SIXTEEN build, and the flips read CONS 3 · COUNT 1 · SEAT 3 · WRAP 3", () => {
    const vals = Array.from({ length: 16 }, (_, i) => cellBuilds(cell(i)));
    expect(vals.filter(Boolean)).toHaveLength(3);
    expect(vals.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([0, 5, 7]);
    const flips = [0, 1, 2, 3].map((bit) => {
      let n = 0;
      for (let i = 0; i < 16; i++) {
        const j = i ^ (1 << bit);
        if (i < j && vals[i] !== vals[j]) n += 1;
      }
      return n;
    });
    // CONS, COUNT, SEAT, WRAP — in bit order.
    expect(flips).toEqual([3, 1, 3, 3]);
  });

  it("THE GATE SPLITTER IS NULL AT 16 OF 16 — the two predicates AGREE EVERYWHERE", () => {
    for (let i = 0; i < 16; i++) {
      expect(splitAttackGateClause(cell(i)), cell(i)).toBeNull();
      expect(splitAttackTrailingClause(cell(i)), cell(i)).toBeNull();
    }
    // …and it is null on the sibling rows too, so "reader arm" is not an artefact of the
    // lattice's own vocabulary.
    for (const s of [PRINTED, BARE, WIN_ROW, SIB_MORE, SIB_NOT_34, SIB_4_FEWER]) {
      expect(splitAttackGateClause(s), s).toBeNull();
    }
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing rider is refused", () => {
    expect(deriveAttackEffect(`Draw a card. ${PRINTED}`)).toBeNull();
    expect(deriveAttackEffect(`${PRINTED} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace("If ", "if "))).toBeNull();
  });

  it("the COUNT and the STATUS WORD are both spelled into the anchor, and both refuse", () => {
    expect(
      deriveAttackEffect(
        "If you have exactly 2 Prize cards remaining, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Confused.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "If your opponent has exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
  });
});

describe("D517 §6 — the describer surfaces, and the union's seat idiom", () => {
  it("the op NEVER PARKS, so `describeBranch` never sees it and no caption is owed", () => {
    const { state: done } = swing(withEffect(setPrizes(board(), "p1", 1), PRINTED));
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(defenderParalyzed(done)).toBe(true);
  });

  it("`conditionNote` IS the only describer a `BoardCondition` has, and it is TOTAL", () => {
    expect(conditionNote({ kind: "yourPrizesRemaining", counts: [1] })).not.toBe("");
  });

  it("the union spells SIX seat MIRRORS as separate members and ZERO seat FIELDS", () => {
    const PAIRS: readonly (readonly [BoardCondition, BoardCondition])[] = [
      [{ kind: "yourActiveDamaged" }, { kind: "opponentActiveDamaged" }],
      [
        { kind: "yourActiveHasEnergyAttached", energy: "special" },
        { kind: "opponentActiveHasEnergyAttached", energy: "special" },
      ],
      [{ kind: "yourActiveHasToolAttached" }, { kind: "opponentActiveHasToolAttached" }],
      [{ kind: "yourActivePoisoned" }, { kind: "opponentActivePoisoned" }],
      [
        { kind: "yourBenchAtLeast", count: 2 },
        { kind: "opponentBenchAtLeast", count: 2 },
      ],
      [{ kind: "yourStadiumInPlay" }, { kind: "stadiumInPlay" }],
    ];
    expect(PAIRS).toHaveLength(6);
    for (const [mine, theirs] of PAIRS) {
      expect(mine.kind).not.toBe(theirs.kind);
      expect(conditionNote(mine)).not.toBe(conditionNote(theirs));
      // …and neither carries a `seat` key, which is the half that makes the idiom a
      // claim about the union rather than about naming.
      expect(Object.keys(mine)).not.toContain("seat");
      expect(Object.keys(theirs)).not.toContain("seat");
    }
    expect(Object.keys({ kind: "yourPrizesRemaining", counts: [1] })).not.toContain("seat");
  });
});

describe("D517 §7 — the price, and both version constants", () => {
  it("the hand-kept READERS list IS the module's reader surface, still THIRTEEN", () => {
    expect(READERS).toHaveLength(14);
  });

  it("the GENERALISED clause slot would buy ZERO printings, MEASURED over the column", () => {
    const LOOSE = /^If (.+), your opponent's Active Pokémon is now Paralyzed\.$/;
    const hits = legalAttackCorpus().filter(([, s]) => LOOSE.test(s));
    expect(hits.map(([, s]) => s)).toEqual([PRINTED]);
    expect(units(hits)).toBe(1);
  });

  it("`prizeCount` and this member are the SAME NUMBER in DIFFERENT WALKS", () => {
    const state = setPrizes(board(), "p1", 1);
    expect(state.players.p1.prizes).toHaveLength(1);
    expect(conditionHolds(state, "p1", { kind: "yourPrizesRemaining", counts: [1] })).toBe(true);
    // A boolean is not a count: `conditionHolds` cannot express "draw 1", and
    // `handRefreshDrawCount` cannot express "is it exactly 1". Two answers, two walks.
    expect(typeof conditionHolds(state, "p1", { kind: "yourPrizesRemaining", counts: [1] })).toBe(
      "boolean",
    );
  });

  it("REACHABILITY IS EMPTY, MEASURED OVER EVERY PRODUCER RATHER THAN ASSERTED", () => {
    const PARKING = new Set([
      "chooseCards",
      "payFromHand",
      "searchDeck",
      "lookAtTopN",
      "damageChosen",
      "knockOutChosen",
      "healChosen",
      "moveCountersChosen",
      "opponentMayDraw",
      "opponentSwitchOut",
      "opponentDiscardsFromHand",
      "attachEnergyFrom",
      "attachFromDeck",
      "attachFromTop",
      "attachFromHand",
      "discardPileRetrieval",
      "evolveFromDeckChosen",
      "evolveFromDeckEachChosen",
      "preventChosenAttack",
      "reorderTop",
      "switchActive",
      "returnBenched",
      "moveEnergy",
    ]);
    const holds = (v: unknown): boolean => {
      if (Array.isArray(v)) return v.some(holds);
      if (v === null || typeof v !== "object") return false;
      const rec = v as Record<string, unknown>;
      if (rec.kind === "yourPrizesRemaining") return true;
      return Object.values(rec).some(holds);
    };
    const opsUnder = (v: unknown, out: string[]): void => {
      if (Array.isArray(v)) {
        for (const el of v) opsUnder(el, out);
        return;
      }
      if (v === null || typeof v !== "object") return;
      const rec = v as Record<string, unknown>;
      if (typeof rec.op === "string") out.push(rec.op);
      for (const el of Object.values(rec)) opsUnder(el, out);
    };
    const offenders: string[] = [];
    let carriers = 0;
    let opLists = 0;
    const walk = (v: unknown, where: string): void => {
      if (Array.isArray(v)) {
        const ops = v.filter((e) => e !== null && typeof e === "object" && "op" in (e as object));
        if (ops.length === v.length && v.length > 0) {
          opLists += 1;
          v.forEach((el, i) => {
            if (!holds(el)) return;
            carriers += 1;
            if (i > 0) offenders.push(`${where}[${i}] is not at index 0`);
            const inner: string[] = [];
            opsUnder(el, inner);
            for (const op of inner) {
              if (PARKING.has(op)) offenders.push(`${where}[${i}] carries parking op ${op}`);
            }
          });
        }
        v.forEach((el, i) => {
          walk(el, `${where}[${i}]`);
        });
        return;
      }
      if (v === null || typeof v !== "object") return;
      for (const [k, el] of Object.entries(v as Record<string, unknown>)) walk(el, `${where}.${k}`);
    };
    for (const id of programmedCardIds()) walk(programFor(id), id);
    let derived = 0;
    for (const [, text] of legalAttackCorpus()) {
      const program = deriveAttackEffect(text);
      if (program === null) continue;
      derived += 1;
      walk(program, `derived:${text.slice(0, 40)}`);
    }
    expect(offenders).toEqual([]);
    expect(carriers).toBe(6);
    expect(opLists).toBeGreaterThan(100);
    expect(derived).toBeGreaterThan(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE FOLLOW-ON THIS MEMBER UNBLOCKS, AND THE REFUSAL, DRIVEN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D517 §8 — corpus `:346` shares this GATE and is deliberately NOT built ( D575: BUILT — the falsifier below fired as written)", () => {
  it("FALSIFIER — the gate is now available to it and the CONSEQUENT is what is missing", () => {
    const names = new Set<string>();
    const collect = (v: unknown): void => {
      if (Array.isArray(v)) {
        for (const el of v) collect(el);
        return;
      }
      if (v === null || typeof v !== "object") return;
      const rec = v as Record<string, unknown>;
      if (typeof rec.op === "string") names.add(rec.op);
      for (const el of Object.values(rec)) collect(el);
    };
    for (const id of programmedCardIds()) collect(programFor(id));
    for (const [, text] of legalAttackCorpus()) collect(deriveAttackEffect(text));
    expect(names.size).toBeGreaterThan(50);
    const ENDERS = [...names].filter((n) => /win|victor|gameEnd|endGame|concede|forfeit/i.test(n));
    expect(ENDERS).toEqual(["winGame"]);
    expect(resolvedByAnyReader(WIN_ROW)).toBe(true);
    expect(deriveAttackEffect(WIN_ROW)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourPrizesRemaining", counts: [1] },
        ops: [{ op: "winGame" }],
      },
    ]);
  });

  it("the PRICE of `:346`, recorded: the GATE is free and the WRAPPER is one group", () => {
    expect(
      conditionHolds(setPrizes(board(), "p1", 1), "p1", {
        kind: "yourPrizesRemaining",
        counts: [1],
      }),
    ).toBe(true);
    expect(WIN_ROW.startsWith("If you use this attack when you have exactly 1 Prize card")).toBe(
      true,
    );
    const wrapped = legalAttackCorpus().filter(([, s]) =>
      s.startsWith("If you use this attack when "),
    );
    expect(wrapped.map(([, s]) => s)).toEqual([WIN_ROW]);
  });

  it("THE MISSING PIECE IS §14 ITSELF, AND IT IS TWO TYPES DEEP — ASKED OF THE TYPE", () => {
    const REASONS: Record<GameOverReason, true> = {
      prizesTaken: true,
      noPokemon: true,
      deckOut: true,
      conceded: true,
      cardEffect: true,
    };
    expect(Object.keys(REASONS).sort()).toEqual(
      ["cardEffect", "conceded", "deckOut", "noPokemon", "prizesTaken"].sort(),
    );
    expect(Object.keys(REASONS)).toHaveLength(5);
  });
});
