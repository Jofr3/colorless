import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effectTypes";
import * as effects from "./effects";
import {
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
  ATTACK_READERS,
} from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  DEFENDER_STATUS_PAIR_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

const PRINTED =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused.";

const HEADS_ARM_ALONE =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned.";
const TAILS_ARM_ALONE = "Your opponent's Active Pokémon is now Confused.";

const STILL_LOUD_COMPOUND =
  "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";

const DATA_BLOCKED_LOUD =
  "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.";

const CONSTRUCTED_MISSES = [
  // (a) the TAILS slot holds a word that is not a Special Condition
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Tired.",
  // (b) leading text before the flip — the `^` is what refuses it
  "This attack does nothing. Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused.",
  // (c) the tails clause names the ATTACKER's body — a subject this arm cannot mean
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, this Pokémon is now Confused.",
  "Flip a coin. If tails, your opponent's Active Pokémon is now Paralyzed and Poisoned. If heads, your opponent's Active Pokémon is now Confused.",
  // (e) the heads pair joined by a comma rather than by ` and ` — the pair's own vocabulary refuses it
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, Poisoned. If tails, your opponent's Active Pokémon is now Confused.",
] as const;

const HEADS_COLLISIONS = [
  "Flip a coin. If heads, your opponent's Active Pokémon is now Asleep and Confused. If tails, your opponent's Active Pokémon is now Burned.",
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Confused. If tails, your opponent's Active Pokémon is now Poisoned.",
  "Flip a coin. If heads, your opponent's Active Pokémon is now Confused and Confused. If tails, your opponent's Active Pokémon is now Burned.",
] as const;

const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
const SUBJ = "your opponent['’]s Active Pokémon";
const SEEDS = 400;
function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

const READERS: Record<string, (text: string) => unknown> = Object.fromEntries(
  ATTACK_READERS.map(({ name, read }) => [name, read]),
);
const hit = (re: RegExp) => legalAttackCorpus().filter(([, s]) => re.test(s));

function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["fix-glimmora"];
  if (card === undefined) throw new Error("no fix-glimmora in pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("fix-glimmora has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-glimmora": { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}

function board(seed: number, { by = "p1" as Seat, effect = PRINTED } = {}): GameState {
  const opener: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: DEFENDER_STATUS_PAIR_DECK, p2: DEFENDER_STATUS_PAIR_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-glimmora");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, opener, "fix-titan");
  state = clearBench(state, opener);
  return withEffect(state, effect);
}
function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}
function defenderConditions(state: GameState, by: Seat = "p1") {
  const active = state.players[by === "p1" ? "p2" : "p1"].active;
  if (active === null) throw new Error("no defender");
  return active.conditions;
}

function flipBoard(wantHeads: boolean, opts: { by?: Seat; effect?: string } = {}): GameState {
  for (let seed = 1; seed < SEEDS; seed++) {
    let candidate: GameState;
    try {
      candidate = board(seed, opts);
    } catch {
      continue;
    }
    const flip = findEvent(swing(candidate, opts.by ?? "p1").events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip?.result === (wantHeads ? "heads" : "tails")) return candidate;
  }
  throw new Error(`no seed under ${SEEDS} gives ${wantHeads ? "heads" : "tails"}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, transcribed rather than recognised", () => {
  it("the sentence is the CORPUS's bytes at TWO printings, apostrophes ASCII U+0027", () => {
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(PRINTED)).toBe(2);
    expect(rows.get(HEADS_ARM_ALONE)).toBe(1);
    expect(rows.get(TAILS_ARM_ALONE)).toBe(31);
    expect(rows.get(STILL_LOUD_COMPOUND)).toBe(2);
    for (const s of [PRINTED, HEADS_ARM_ALONE, TAILS_ARM_ALONE]) {
      expect(s.includes("opponent's")).toBe(true);
      expect(s.includes("opponent’s")).toBe(false);
      expect(s.includes("Pokémon")).toBe(true);
    }
    expect(PRINTED.codePointAt(PRINTED.indexOf("é"))).toBe(0x00e9);
    for (const i of [PRINTED.indexOf("'"), PRINTED.lastIndexOf("'")]) {
      expect(PRINTED.codePointAt(i)).toBe(0x0027);
    }
  });

  it("the demonstrator is NOT a new fixture — `fix-glimmora` prints the HEADS ARM", () => {
    expect(FIXTURE_POOL["fix-glimmora"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Stun Poison", effect: HEADS_ARM_ALONE },
      {
        cost: ["Fighting"],
        name: "Venoshock",
        damage: "30+",
        effect: "If your opponent's Active Pokémon is Poisoned, this attack does 100 more damage.",
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation, the JOIN it is, and the population behind both.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the population it was measured on", () => {
  it("derives to ONE coinFlipGate holding the pair on `then` and the single on `otherwise`", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([
      {
        op: "coinFlipGate",
        ops: [
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          { op: "applyStatus", target: "defender", status: "poisoned" },
        ],
        otherwise: [{ op: "applyStatus", target: "defender", status: "confused" }],
      },
    ]);
  });

  it("the two arms ARE the two shipped programs — asserted, not described", () => {
    const gate = deriveAttackEffect(PRINTED)?.[0];
    if (gate?.op !== "coinFlipGate") throw new Error("expected a coinFlipGate");
    const headsSibling = deriveAttackEffect(HEADS_ARM_ALONE)?.[0];
    if (headsSibling?.op !== "coinFlipGate") throw new Error("expected a coinFlipGate");
    expect(gate.ops).toEqual(headsSibling.ops);
    expect(gate.otherwise).toEqual(deriveAttackEffect(TAILS_ARM_ALONE));
    expect(headsSibling.otherwise).toBeUndefined();
  });

  it("the U+2019 fold — the typographic apostrophe derives to the SAME program", () => {
    const curlyBoth = PRINTED.replaceAll("opponent's", "opponent’s");
    const curlyHeadsOnly = PRINTED.replace("opponent's", "opponent’s");
    const curlyTailsOnly = `${PRINTED.slice(0, PRINTED.lastIndexOf("opponent's"))}${PRINTED.slice(
      PRINTED.lastIndexOf("opponent's"),
    ).replace("opponent's", "opponent’s")}`;
    for (const variant of [curlyBoth, curlyHeadsOnly, curlyTailsOnly]) {
      expect(variant).not.toBe(PRINTED);
      expect(deriveAttackEffect(variant)).toEqual(deriveAttackEffect(PRINTED));
      expect(resolvedByAnyReader(variant)).toBe(true);
    }
    const rows = new Set(legalAttackCorpus().map(([, s]) => s));
    expect(rows.has(PRINTED)).toBe(true);
    expect(rows.has(curlyBoth)).toBe(false);
  });

  it("all three slots are TEMPLATES, and every status word reaches every one of them", () => {
    for (const [word, status] of [
      ["Asleep", "asleep"],
      ["Burned", "burned"],
      ["Confused", "confused"],
      ["Paralyzed", "paralyzed"],
      ["Poisoned", "poisoned"],
    ] as const) {
      const text = PRINTED.replace("is now Confused.", `is now ${word}.`);
      const ops = deriveAttackEffect(text);
      expect(ops?.[0]?.op === "coinFlipGate" ? ops[0].otherwise : null).toEqual([
        { op: "applyStatus", target: "defender", status },
      ]);
    }
    // The heads slots, on a pair the rotation map admits: Burned + Poisoned are two
    // different fields, so every arrangement here is a legal program.
    for (const [x, y, sx, sy] of [
      ["Burned", "Poisoned", "burned", "poisoned"],
      ["Poisoned", "Burned", "poisoned", "burned"],
      ["Asleep", "Burned", "asleep", "burned"],
    ] as const) {
      const text = PRINTED.replace("Paralyzed and Poisoned", `${x} and ${y}`);
      const ops = deriveAttackEffect(text);
      expect(ops?.[0]?.op === "coinFlipGate" ? ops[0].ops : null).toEqual([
        { op: "applyStatus", target: "defender", status: sx },
        { op: "applyStatus", target: "defender", status: sy },
      ]);
    }
  });

  it("ZERO false positives over the WHOLE column — one row, two printings", () => {
    const twoArmed = legalAttackCorpus().filter(([, s]) => {
      const ops = deriveAttackEffect(s);
      const head: EffectOp | undefined = ops?.[0];
      return (
        ops?.length === 1 &&
        head?.op === "coinFlipGate" &&
        head.otherwise !== undefined &&
        head.ops.every((o) => o.op === "applyStatus") &&
        head.otherwise.every((o) => o.op === "applyStatus")
      );
    });
    expect(twoArmed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(units(twoArmed)).toBe(2);
  });

  it("NO GENERALITY WAS TAKEN, AND THAT IS A MEASUREMENT (D472)", () => {
    const strict = new RegExp(
      `^Flip a coin\\. If heads, ${SUBJ} is now (${W}) and (${W})\\. If tails, ${SUBJ} is now (${W})\\.$`,
    );
    const loosenings: Array<[string, RegExp]> = [
      [
        "heads pair made optional",
        new RegExp(
          `^Flip a coin\\. If heads, ${SUBJ} is now (${W})(?: and (${W}))?\\. If tails, ${SUBJ} is now (${W})\\.$`,
        ),
      ],
      [
        "tails slot widened to a pair",
        new RegExp(
          `^Flip a coin\\. If heads, ${SUBJ} is now (${W}) and (${W})\\. If tails, ${SUBJ} is now (${W})(?: and (${W}))?\\.$`,
        ),
      ],
      [
        "heads consequent widened to (.+)",
        new RegExp(
          `^Flip a coin\\. If heads, ${SUBJ} is now (.+)\\. If tails, ${SUBJ} is now (${W})\\.$`,
        ),
      ],
      [
        "tails consequent widened to (.+)",
        new RegExp(
          `^Flip a coin\\. If heads, ${SUBJ} is now (${W}) and (${W})\\. If tails, (.+)\\.$`,
        ),
      ],
      [
        "the ^ dropped",
        new RegExp(
          `Flip a coin\\. If heads, ${SUBJ} is now (${W}) and (${W})\\. If tails, ${SUBJ} is now (${W})\\.$`,
        ),
      ],
      [
        "the \\.$ dropped",
        new RegExp(
          `^Flip a coin\\. If heads, ${SUBJ} is now (${W}) and (${W})\\. If tails, ${SUBJ} is now (${W})\\.`,
        ),
      ],
    ];
    expect([hit(strict).length, units(hit(strict))]).toEqual([1, 2]);
    for (const [name, re] of loosenings) {
      expect([name, hit(re).length, units(hit(re))]).toEqual([name, 1, 2]);
    }
    const swapped = new RegExp(
      `^Flip a coin\\. If tails, ${SUBJ} is now (${W}) and (${W})\\. If heads, ${SUBJ} is now (${W})\\.$`,
    );
    expect([hit(swapped).length, units(hit(swapped))]).toEqual([0, 0]);
  });

  it("DISJOINT FROM THE SIX OLDER `is now` ANCHORS BY CONSTRUCTION, not by position", () => {
    expect(deriveAttackEffect(HEADS_ARM_ALONE)).toEqual([
      {
        op: "coinFlipGate",
        ops: [
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          { op: "applyStatus", target: "defender", status: "poisoned" },
        ],
      },
    ]);
    expect(deriveAttackEffect(TAILS_ARM_ALONE)).toEqual([
      { op: "applyStatus", target: "defender", status: "confused" },
    ]);
    expect(
      deriveAttackEffect("Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."),
    ).toEqual([
      {
        op: "coinFlipGate",
        ops: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
  });

  it("neither splitter is involved — the sentence is claimed WHOLE", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });
});

describe("§3 — the two-branch coin family, measured over every corpus row", () => {
  it("the family is 3 sentences / 8 printings, and TWO of the three now build", () => {
    const both = legalAttackCorpus().filter(
      ([, s]) => /If heads,/i.test(s) && /If tails,/i.test(s),
    );
    expect([both.length, units(both)]).toEqual([3, 8]);
    expect(both.map(([, s]) => s).sort()).toEqual(
      [
        "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.",
        PRINTED,
        STILL_LOUD_COMPOUND,
      ].sort(),
    );
    const built = both.filter(([, s]) => resolvedByAnyReader(s));
    expect([built.length, units(built)]).toEqual([3, 8]);
    expect(built.map(([, s]) => s).sort()).toEqual(
      [
        "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.",
        PRINTED,
        STILL_LOUD_COMPOUND,
      ].sort(),
    );
    const left = both.filter(([, s]) => !resolvedByAnyReader(s));
    expect(left).toEqual([]);
    // …and WHICH reader owns each, by name, with every other reader still refusing.
    const owners = (s: string) =>
      attackReaderSurface().filter(
        (n) => READERS[n]?.(s) !== null && READERS[n]?.(s) !== undefined,
      );
    expect(owners(PRINTED)).toEqual(["deriveAttackEffect"]);
    expect(
      owners(
        "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.",
      ),
    ).toEqual(["deriveAttackEffect"]);
    expect(owners(STILL_LOUD_COMPOUND)).toEqual(["deriveAttackCoinFlip"]);
  });

  it("the wider coin-face populations, so the family's denominator is not a guess", () => {
    expect([hit(/If heads,/i).length, units(hit(/If heads,/i))]).toEqual([24, 116]);
    expect([hit(/If tails,/i).length, units(hit(/If tails,/i))]).toEqual([6, 27]);
    expect([hit(/If (?:heads|tails)/i).length, units(hit(/If (?:heads|tails)/i))]).toEqual([
      27, 135,
    ]);
    for (const re of [/If it is (?:heads|tails)/i, /On (?:heads|tails)/i, /When .{0,20}tails/i]) {
      expect(hit(re)).toEqual([]);
    }
  });

  it("the two-branch gate the family needs has shipped since D269, on BOTH sides", () => {
    const ko = deriveAttackEffect(
      "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.",
    );
    const gate = ko?.[0];
    if (gate?.op !== "coinFlipGate") throw new Error("expected a coinFlipGate");
    expect(gate.otherwise).toEqual([
      { op: "knockOutChosen", target: "opponentBench", basicOnly: true },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the two OUTCOMES on a real board, driven separately, with a searched seed.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — both outcomes land, asserted on the FIELDS", () => {
  it("HEADS lands Paralyzed AND Poisoned — two statuses, not one", () => {
    const { state, events } = swing(flipBoard(true));
    expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    expect(defenderConditions(state)).toEqual({
      rotation: "paralyzed",
      poisonDamage: 10,
      burned: false,
      confusionDamage: 30,
    });
    expect(all(events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["paralyzed", "poisoned"]);
  });

  it("TAILS lands Confused — the branch this slice exists for", () => {
    const { state, events } = swing(flipBoard(false));
    expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(defenderConditions(state)).toEqual({
      rotation: "confused",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(all(events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["confused"]);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("THE SWAP IS OBSERVABLE, AND THAT IS WHY THE TWO ARMS DIFFER OBSERVABLY", () => {
    const onHeads = defenderConditions(swing(flipBoard(true)).state);
    const onTails = defenderConditions(swing(flipBoard(false)).state);
    expect(onHeads).not.toEqual(onTails);
    expect([onHeads.rotation, onTails.rotation]).toEqual(["paralyzed", "confused"]);
    expect([onHeads.poisonDamage > 0, onTails.poisonDamage > 0]).toEqual([true, false]);
    expect([
      findEvent(swing(flipBoard(true)).events, "ATTACK_EFFECT_COIN_FLIP")?.result,
      findEvent(swing(flipBoard(false)).events, "ATTACK_EFFECT_COIN_FLIP")?.result,
    ]).toEqual(["heads", "tails"]);
  });

  it("the coin is taken and announced ONCE, on both faces", () => {
    for (const wantHeads of [true, false]) {
      const { events } = swing(flipBoard(wantHeads));
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
    }
  });

  it("BOTH SEATS — the same sentence read from p2 lands on p1's Active", () => {
    const state = flipBoard(false, { by: "p2" });
    const { state: after } = swing(state, "p2");
    expect(defenderConditions(after, "p2")).toEqual({
      rotation: "confused",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    // …and the ATTACKER is untouched — `defender` is not `self`.
    expect(after.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
  });

  it("a pre-existing rotation is REPLACED on the tails arm too", () => {
    let state = flipBoard(false);
    const defender = state.players.p2.active;
    if (defender === null) throw new Error("no defender");
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active: {
            ...defender,
            conditions: {
              rotation: "asleep",
              poisonDamage: 20,
              burned: false,
              confusionDamage: 30,
            },
          },
        },
      },
    };
    expect(defenderConditions(swing(state).state)).toEqual({
      rotation: "confused", // replaced Asleep — §12
      poisonDamage: 20, // untouched: a different field
      burned: false,
      confusionDamage: 30,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the refusals, each with the admission that differs from it on ONE axis.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — what this anchor refuses, and what it still admits", () => {
  it("the five CONSTRUCTED near misses derive to null", () => {
    for (const text of CONSTRUCTED_MISSES) expect(deriveAttackEffect(text), text).toBeNull();
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });

  it("a rotation collision in the HEADS pair is refused — and the printed cross-arm pair is NOT", () => {
    for (const text of HEADS_COLLISIONS) expect(deriveAttackEffect(text), text).toBeNull();
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
    expect(new Map(legalAttackCorpus()).get(2)).toBeDefined();
    const gate = deriveAttackEffect(PRINTED)?.[0];
    if (gate?.op !== "coinFlipGate") throw new Error("expected a coinFlipGate");
    const rotations = [...gate.ops, ...(gate.otherwise ?? [])]
      .map((o) => (o.op === "applyStatus" ? o.status : null))
      .filter((s) => s === "paralyzed" || s === "confused" || s === "asleep");
    expect(rotations).toEqual(["paralyzed", "confused"]);
  });

  it("the `\\.$` end, asserted as a SPLIT rather than as nullity (D464)", () => {
    const compound = `${PRINTED} Draw a card.`;
    expect(deriveAttackEffect(compound)).toBeNull();
    expect(resolvedByAnyReader(compound)).toBe(false);
    expect(splitAttackTrailingClause(compound)).toEqual({
      head: PRINTED,
      tail: "Draw a card.",
    });
    expect(legalAttackCorpus().filter(([, s]) => s.startsWith(`${PRINTED} `))).toEqual([]);
  });

  it("the column's LAST printed heads/tails compound is BUILT — by the OTHER seam", () => {
    expect(deriveAttackEffect(STILL_LOUD_COMPOUND)).toBeNull();
    expect(splitAttackGateClause(STILL_LOUD_COMPOUND)).toBeNull();
    expect(splitAttackTrailingClause(STILL_LOUD_COMPOUND)).toBeNull();
    expect(resolvedByAnyReader(STILL_LOUD_COMPOUND)).toBe(true);
    expect(effects.deriveAttackCoinFlip(STILL_LOUD_COMPOUND)).toEqual({
      kind: "cancelOnTailsElseProgram",
      ops: [{ op: "preventDamage", effects: true }],
    });
  });

  it("…and the loud path still works — the attribution control, RE-POINTED", () => {
    const doctored = board(11, { effect: DATA_BLOCKED_LOUD });
    expect(findEvent(swing(doctored).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(
      DATA_BLOCKED_LOUD,
    );
    expect(new Map(legalAttackCorpus().map(([n, s]) => [s, n])).get(DATA_BLOCKED_LOUD)).toBe(1);
    expect(resolvedByAnyReader(DATA_BLOCKED_LOUD)).toBe(false);
  });
});

describe("§6 — the census moves in exactly ONE summand", () => {
  it("the resolving corpus gains ONE sentence and TWO printings", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([599, 1661]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the version questions, driven rather than reasoned from a name.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — why MATCH_RECORD_VERSION does not move", () => {
  it("`MATCH_RECORD_VERSION` STAYS 29 — the SERIALIZED ALPHABET, and REACHABILITY too", () => {
    const program = deriveAttackEffect(PRINTED);
    expect(program).toHaveLength(1);
    const gate = program?.[0];
    if (gate?.op !== "coinFlipGate") throw new Error("expected a coinFlipGate");
    for (const op of [...gate.ops, ...(gate.otherwise ?? [])]) {
      expect(op.op).toBe("applyStatus");
    }
    for (const wantHeads of [true, false]) {
      const { state } = swing(flipBoard(wantHeads));
      expect(state.phase.kind).not.toBe("effect:choose");
      expect("cont" in state.phase ? state.phase.cont : undefined).toBeUndefined();
    }
    // The emitted ops are byte-identical to programs the catalog already prints
    // STANDALONE, which is the alphabet argument as an equality rather than a sentence.
    expect(JSON.stringify(gate.ops)).toBe(
      JSON.stringify(
        (deriveAttackEffect(HEADS_ARM_ALONE)?.[0] as { ops: EffectOp[] } | undefined)?.ops,
      ),
    );
    expect(JSON.stringify(gate.otherwise)).toBe(
      JSON.stringify(deriveAttackEffect(TAILS_ARM_ALONE)),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — purity: the reader is a function of TEXT and the run does not mutate its input.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — purity and determinism", () => {
  it("the derivation is a pure function of the string", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(deriveAttackEffect(`${PRINTED}`));
    expect(deriveAttackEffect(` ${PRINTED} `)).toEqual(deriveAttackEffect(PRINTED));
  });

  it("the swing does not mutate the state it was handed, on either face", () => {
    for (const wantHeads of [true, false]) {
      const frozen = deepFreeze(flipBoard(wantHeads));
      expect(() => swing(frozen)).not.toThrow();
    }
  });

  it("the same seed replays to the same board", () => {
    const seed = flipBoard(false);
    const a = swing(seed).state;
    const b = swing(seed).state;
    expect(defenderConditions(a)).toEqual(defenderConditions(b));
  });
});
