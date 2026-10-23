import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effectsModule from "./effects";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter, EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const PRINTED =
  "This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The three printed PARTS, each on its own. The first is `IN_PLAY_BODY_MULTIPLY`'s
    shape and IS claimed on its own; the other two are not — which is the whole-compound
    claim made executable rather than asserted in prose. */
const PART_1 = "This attack does 50 damage for each of your Drifloon and Drifblim in play.";
const PART_2 = "This attack also does 30 damage to each of your Drifloon and Drifblim.";
const PART_3 = "(Don't apply Weakness and Resistance for Benched Pokémon.)";

const MISMATCHED = PRINTED.replace(
  "to each of your Drifloon and Drifblim.",
  "to each of your Pokémon ex.",
);

/** The filter the printed noun resolves to — ONE object, and the SAME resolution both
    readers reach through `inPlayBodyFilter`. */
const PAIR_FILTER: CardFilter = {
  kind: "anyOf",
  filters: [
    { kind: "byName", name: "Drifloon" },
    { kind: "byName", name: "Drifblim" },
  ],
};

/** The derived PROGRAM, spelled once. ONE op, and NO `ignoreWR`. */
const PROGRAM: EffectOp[] = [
  {
    op: "damageChosen",
    target: "yourAny",
    amount: 30,
    count: "all",
    source: "attack",
    deals: true,
    filter: PAIR_FILTER,
  },
];

/** The derived × FOLD, spelled once. Byte-identical in shape to the arm one line up in
    `effects.ts` — nothing new is introduced on this interface. */
const FOLD = {
  per: 50,
  count: { kind: "pokemonInPlay", seat: "you", filter: PAIR_FILTER },
};

const BLIMP = "d539-drifblim";
const FRAIL_BLIMP = "d539-drifblim-frail";
const WEAK_BLIMP = "d539-drifblim-weak";
const LOON = "d539-drifloon";
const WEAK_LOON = "d539-drifloon-weak";
const PLAIN = "d539-plain";
const WALL = "d539-wall";
const ENERGY = "fix-energy";

const ATTACKS = [
  { cost: ["Colorless"], name: "Balloon Swarm", effect: PRINTED },
  { cost: ["Colorless"], name: "Plain Tap", damage: 10 },
  // THE MISMATCHED-NOUN near miss, declared so §1 can drive the backreference through a
  // REAL ATTACK rather than through the deriver alone: it must reach the LOUD
  // `ATTACK_EFFECT_SKIPPED` path.
  { cost: ["Colorless"], name: "Mismatched", effect: MISMATCHED },
];

const blimp = (id: string, hp: number): Card =>
  battler(id, { name: "Drifblim", hp, retreat: 1, types: ["Colorless"], attacks: [...ATTACKS] });

const LOCAL_CARDS: Record<string, Card> = {
  [BLIMP]: blimp(BLIMP, 250),
  /** §5's attacker: 30 HP, so its OWN 30 Knocks it Out mid-attack. */
  [FRAIL_BLIMP]: blimp(FRAIL_BLIMP, 30),
  [WEAK_BLIMP]: battler(WEAK_BLIMP, {
    name: "Drifblim",
    hp: 250,
    types: ["Colorless"],
    retreat: 1,
    weaknesses: [{ type: "Colorless", value: "×2" }],
    attacks: [...ATTACKS],
  }),
  [LOON]: battler(LOON, { name: "Drifloon", hp: 200, types: ["Colorless"], retreat: 1 }),
  /** The same printed NAME carrying a **Weakness ×2** — the single byte that makes the
      no-`ignoreWR` reading observable on a body of the attacker's own. */
  [WEAK_LOON]: battler(WEAK_LOON, {
    name: "Drifloon",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
  [PLAIN]: battler(PLAIN, {
    name: "D539 Plain",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    // It carries the SAME attack list, so §6 can ask the printed sentence from a body
    // the printed noun does NOT name — the empty-candidate-set board.
    attacks: [...ATTACKS],
  }),
  /** The defender. 500 HP and NO Weakness, so every rung reads damage rather than a
      Knock Out and the × fold is not confounded by the §8.5 pipeline. */
  [WALL]: battler(WALL, { name: "D539 Wall", hp: 500, types: ["Colorless"], retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [BLIMP]: 6,
  [FRAIL_BLIMP]: 6,
  [WEAK_BLIMP]: 6,
  [LOON]: 6,
  [WEAK_LOON]: 6,
  [PLAIN]: 6,
  [WALL]: 6,
  [ENERGY]: 18,
});

const SEED = 539;

function openTable(): GameState {
  const created = createGame({ seed: SEED, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(
    applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first: "p2" }),
  );
  while (table.phase.kind === "setup:drawExtra") {
    const drawing = table.phase;
    const owing = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owing === undefined) throw new Error("setup:drawExtra with every seat decided");
    table = must(
      applyAction(table, { type: "setupDrawExtra", seat: owing, count: drawing.owed[owing] }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(
      applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  return table;
}

function table(
  attacker: string,
  ownBench: readonly string[],
  foeBench: readonly string[] = [],
): GameState {
  let state = openTable();
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", attacker);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (const id of ownBench) state = benchFromDeck(state, "p1", id);
  for (const id of foeBench) state = benchFromDeck(state, "p2", id);
  return fuel(state, "p1", 1);
}

/** TEST SURGERY — attach `count` copies of `fix-energy` off `seat`'s deck onto its
    Active, so the printed cost is payable. */
function fuel(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i++) {
    const side = next.players[seat];
    const body = side.active;
    if (body === null) throw new Error(`${seat} has no Active`);
    const uid = side.deck.find((u) => next.cardIdByUid[u] === ENERGY);
    if (uid === undefined) throw new Error(`${seat}'s deck lacks ${ENERGY}`);
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          active: { ...body, energy: [...body.energy, uid] },
          deck: side.deck.filter((u) => u !== uid),
        },
      },
    };
  }
  return next;
}

function swing(state: GameState, index = 0) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** `[active, ...bench]` damage — the whole discrimination of §4. */
function damageVector(state: GameState, seat: Seat): number[] {
  return [
    state.players[seat].active?.damage ?? 0,
    ...state.players[seat].bench.map((pokemon) => pokemon.damage),
  ];
}

const eventTypes = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);
const corpusRows = () => legalAttackCorpus();
const units = (rows: readonly (readonly [number, string])[]) =>
  rows.reduce((n, [count]) => n + count, 0);

const READERS: readonly ((t: string) => unknown)[] = attackReaderSurface().map((name) => {
  const fn = (effectsModule as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`reader ${name} is not a function on effects.ts`);
  return fn as (t: string) => unknown;
});
const claimedByAny = (text: string): boolean => READERS.some((read) => read(text) !== null);

const NEW_ANCHOR =
  /^This attack does (\d+) damage for each of your ((?!opponent)[^.]+) in play\. This attack also does (\d+) damage to each of your \2\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/;
const builtBefore = (text: string) => resolvedByAnyReader(text) && !NEW_ANCHOR.test(text);

describe("D539 §1 — the corpus row and the whole-compound anchor", () => {
  it("the row is READ by index and by units, never retyped (D183/D456)", () => {
    const row = corpusRows()[542];
    expect(row?.[1]).toBe(PRINTED);
    expect(row?.[0]).toBe(2);
    expect(corpusRows().filter(([, s]) => s === PRINTED)).toEqual([[2, PRINTED]]);
  });

  it("the printed BYTES: U+0027 at 150, U+00E9 at 198, length 204", () => {
    const printed = corpusRows()[542]?.[1] ?? "";
    expect(printed).toHaveLength(204);
    expect(printed.charCodeAt(150)).toBe(0x27);
    expect(printed.charCodeAt(198)).toBe(0xe9);
    // ONE apostrophe slot, COUNTED: the sentence spells no possessive at all, only the
    // contraction in "Don't", so a successor cannot quietly add a slot it does not have.
    expect((printed.match(/'/g) ?? []).length).toBe(1);
  });

  it("the sentence is READ by `resolvedByAnyReader` — the census delta's own predicate", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("the SURFACE did not grow: a new ARM is not a new READER (D447)", () => {
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("THE `\\2` BACKREFERENCE, DRIVEN BOTH WAYS — matched nouns match", () => {
    const m = NEW_ANCHOR.exec(PRINTED);
    expect(m?.[1]).toBe("50");
    expect(m?.[2]).toBe("Drifloon and Drifblim");
    expect(m?.[3]).toBe("30");
  });

  it("…and MISMATCHED nouns REFUSE — the falsifier, through both readers", () => {
    expect(MISMATCHED).not.toBe(PRINTED);
    expect(MISMATCHED.replace("Pokémon ex", "Drifloon and Drifblim")).toBe(PRINTED);
    expect(NEW_ANCHOR.test(MISMATCHED)).toBe(false);
    expect(deriveAttackEffect(MISMATCHED)).toBeNull();
    expect(deriveAttackDamageMultiplier(MISMATCHED)).toBeNull();
    expect(resolvedByAnyReader(MISMATCHED)).toBe(false);
  });

  it("…and the CONTROL on the same axis: swapping BOTH nouns together still reads", () => {
    const both = PRINTED.replaceAll("Drifloon and Drifblim", "Pokémon ex");
    expect(both).not.toBe(PRINTED);
    expect(NEW_ANCHOR.test(both)).toBe(true);
    expect(deriveAttackDamageMultiplier(both)).toEqual({
      per: 50,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "suffixPokemon", suffix: "ex" },
      },
    });
  });

  it("the `^` refuses a printed prefix and the `$` refuses a printed continuation", () => {
    expect(deriveAttackEffect(`Discard an Energy from this Pokémon. ${PRINTED}`)).toBeNull();
    expect(
      deriveAttackDamageMultiplier(`Discard an Energy from this Pokémon. ${PRINTED}`),
    ).toBeNull();
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
    expect(
      deriveAttackEffect(`Flip a coin. If heads, ${PRINTED[0]?.toLowerCase()}${PRINTED.slice(1)}`),
    ).toBeNull();
    expect(deriveAttackEffect(`${PRINTED} Then, discard an Energy from this Pokémon.`)).toBeNull();
    // …and the terminator itself: dropping the final `)` is one byte and must refuse.
    expect(deriveAttackEffect(PRINTED.slice(0, -1))).toBeNull();
  });

  it("the `['’]` class on `Don't` — the slot CURLS and derives IDENTICALLY (D136/D137)", () => {
    const curly = PRINTED.replace("Don't", "Don’t");
    expect(curly).not.toBe(PRINTED);
    expect((curly.match(/'/g) ?? []).length).toBe(0);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
    expect(deriveAttackEffect(curly)).toEqual(PROGRAM);
    expect(deriveAttackDamageMultiplier(curly)).toEqual(FOLD);
  });

  it("the LOOKALIKE `Pokemon` is not `Pokémon` — the one occurrence", () => {
    expect(PRINTED.split("Pokémon")).toHaveLength(2);
    expect(deriveAttackEffect(PRINTED.replace("Pokémon", "Pokemon"))).toBeNull();
  });

  it("a NON-BREAKING SPACE anywhere in the sentence is NOT this sentence", () => {
    const nbsp = PRINTED.replace("does 50", "does\u00a050");
    expect(nbsp).not.toBe(PRINTED);
    expect(deriveAttackEffect(nbsp)).toBeNull();
  });

  it("the `(?!opponent)` LOOKAHEAD is kept, and it is driven (D407)", () => {
    const foe = PRINTED.replaceAll("of your Drifloon and Drifblim", "of your opponent's Pokémon");
    expect(NEW_ANCHOR.test(foe)).toBe(false);
    expect(deriveAttackEffect(foe)).toBeNull();
    // …and the CONTROL: the identical string with the owner prefix removed is claimed.
    const mine = PRINTED.replaceAll("of your Drifloon and Drifblim", "of your Pokémon");
    expect(NEW_ANCHOR.test(mine)).toBe(true);
  });

  it("the anchor claims EXACTLY 1 of 640 rows / 2 of 1,732 printings", () => {
    const rows = corpusRows();
    expect(rows).toHaveLength(640);
    expect(units(rows)).toBe(1732);
    const claimed = rows.filter(([, text]) => NEW_ANCHOR.test(text));
    expect(claimed).toEqual([[2, PRINTED]]);
    expect(units(claimed)).toBe(2);
  });

  it("…and from `IN_PLAY_BODY_SCALE`, which additionally demands ` more damage`", () => {
    const more = PART_1.replace("does 50 damage", "does 50 more damage");
    expect(deriveAttackDamageBonus(more)).toEqual(FOLD);
    expect(NEW_ANCHOR.test(more)).toBe(false);
    expect(deriveAttackDamageBonus(PRINTED)).toBeNull();
  });

  it("no corpus row matches this anchor AND any other reader's whole-sentence claim", () => {
    for (const [, text] of corpusRows()) {
      if (!NEW_ANCHOR.test(text)) continue;
      expect(builtBefore(text)).toBe(false);
    }
  });

  it("the COMPOSITION ROUTE IS STILL REFUSED, and all three kept rungs are RE-MEASURED", () => {
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(deriveAttackEffect(PART_3)).toBeNull();
    // …and the reason is the SPLIT SHAPE: THREE parts, so the tail is the parenthetical.
    expect(PRINTED.split(/(?<=\.)\s+(?=[A-Z(])/)).toEqual([PART_1, PART_2, PART_3]);
  });

  it("THE SPLITTER WIDENING WAS RE-PRICED HERE: 0 sentences / 0 printings (D493)", () => {
    const BREAK = /(?<=\.)\s+(?=[A-Z(])/;
    const widened = (text: string): { head: string; tail: string } | null => {
      const trimmed = text.trim();
      if (claimedByAny(trimmed)) return null;
      const parts: string[] = [];
      for (const part of trimmed.split(BREAK)) {
        if (part.startsWith("(") && parts.length > 0) parts[parts.length - 1] += ` ${part}`;
        else parts.push(part);
      }
      if (parts.length < 2) return null;
      const tail = parts[parts.length - 1] ?? "";
      const head = parts.slice(0, -1).join(" ");
      if (deriveAttackEffect(tail) === null) return null;
      if (!claimedByAny(head)) return null;
      return { head, tail };
    };
    let admitted = 0;
    let admittedUnits = 0;
    let changed = 0;
    let splitToday = 0;
    for (const [count, text] of corpusRows()) {
      const shipped = splitAttackTrailingClause(text);
      const wide = widened(text);
      if (shipped !== null) splitToday++;
      if (JSON.stringify(shipped) !== JSON.stringify(wide)) changed++;
      if (shipped === null && wide !== null) {
        admitted++;
        admittedUnits += count;
      }
    }
    expect([admitted, admittedUnits]).toEqual([0, 0]);
    expect(changed).toBe(0);
    expect(splitToday).toBe(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE NINTH EXACT KEY, AND THE VOCABULARY RE-DERIVED AT THE NEW COUNT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §2 — the `IN_PLAY_BODY_NOUNS` row", () => {
  it("the printed noun resolves to the PAIR, as an `anyOf` and not an intersection", () => {
    expect(deriveAttackDamageMultiplier(PART_1)).toEqual(FOLD);
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
  });

  it("…and HALF the key is not the key: neither name alone resolves to the pair", () => {
    for (const half of ["Drifloon", "Drifblim"]) {
      const text = `This attack does 50 damage for each of your ${half} in play.`;
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });

  it("the ninth key RESOLVES and carries no apostrophe — the half of the vocabulary this suite can reach", () => {
    expect(deriveAttackDamageMultiplier(PART_1)).not.toBeNull();
    expect(/['’]s Pokémon$/.test("Drifloon and Drifblim")).toBe(false);
    // …and it does NOT reach the owner branch, which is the disjointness made executable
    // rather than argued: a key with a possessive would resolve down two branches.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 50 damage for each of your Drifloon and Drifblim's Pokémon in play.",
      ),
    ).toEqual({
      per: 50,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "ownerPokemon", owner: "Drifloon and Drifblim" },
      },
    });
  });

  it("the CONSEQUENCE, stated rather than discovered: the other anchors read it too", () => {
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 10 damage for each of your Drifloon and Drifblim in play.",
      ),
    ).toEqual({ ...FOLD, per: 10 });
    // …and the column prints NEITHER of the two sentences that widening makes readable.
    const readable = [
      "for each of your Drifloon and Drifblim in play.",
      "for each Drifloon and Drifblim on your Bench.",
    ];
    for (const fragment of readable) {
      expect(corpusRows().filter(([, t]) => t.includes(fragment) && t !== PRINTED)).toEqual([]);
    }
  });

  it("an UNMAPPED noun leaves the sentence LOUD rather than resolving on a guess (D190b)", () => {
    const ancient = PRINTED.replaceAll("Drifloon and Drifblim", "Future Pokémon");
    expect(NEW_ANCHOR.test(ancient)).toBe(true); // the PATTERN claims it…
    expect(deriveAttackEffect(ancient)).toBeNull(); // …and the VOCABULARY refuses it
    expect(deriveAttackDamageMultiplier(ancient)).toBeNull();
  });

  it("a printed ZERO is not a real card — the `per >= 1` guard, on both arms", () => {
    const zero = PRINTED.replace("does 50 damage for", "does 0 damage for");
    expect(deriveAttackDamageMultiplier(zero)).toBeNull();
    const zeroSpread = PRINTED.replace("also does 30 damage", "also does 0 damage");
    expect(deriveAttackEffect(zeroSpread)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — TWO READERS, ONE STRING, AND THE PROGRAM OF EACH.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §3 — both readers claim the whole compound off ONE `effect` string", () => {
  it("`deriveAttackDamageMultiplier` claims it — the exact fold", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual(FOLD);
  });

  it("`deriveAttackEffect` claims it — the exact program, ONE op", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    expect(deriveAttackEffect(PRINTED)).toHaveLength(1);
  });

  it("the op carries NO `ignoreWR`, and the KEY IS ABSENT rather than false", () => {
    const op = deriveAttackEffect(PRINTED)?.[0];
    expect(op).toBeDefined();
    expect(Object.keys(op ?? {})).toEqual([
      "op",
      "target",
      "amount",
      "count",
      "source",
      "deals",
      "filter",
    ]);
    expect("ignoreWR" in (op ?? {})).toBe(false);
  });

  it("the two readers resolve the SAME noun to the SAME filter (D159)", () => {
    const fold = deriveAttackDamageMultiplier(PRINTED);
    const op = deriveAttackEffect(PRINTED)?.[0];
    if (op === undefined || op.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(JSON.stringify(op.filter)).toBe(
      JSON.stringify((fold?.count as { filter: CardFilter } | undefined)?.filter),
    );
  });

  it("neither PART is claimed as this compound — the whole-string claim, executable", () => {
    expect(deriveAttackEffect(PART_2)).toBeNull();
    expect(deriveAttackDamageMultiplier(PART_2)).toBeNull();
    expect(deriveAttackEffect(PART_3)).toBeNull();
    expect(claimedByAny(PART_2)).toBe(false);
  });
});

describe("D539 §4 — the fold, and the 30 that lands on every named body", () => {
  it("(a) the × fold over ONE named body in play: 50 to the defender", () => {
    // The attacker alone is a Drifblim, and it counts itself — "in play" is the whole
    // board, and the printed noun names the attacker.
    const { state } = swing(table(BLIMP, [PLAIN]));
    expect(damageVector(state, "p2")).toEqual([50]);
  });

  it("(a) TWO named bodies: 100", () => {
    const { state } = swing(table(BLIMP, [LOON, PLAIN]));
    expect(damageVector(state, "p2")).toEqual([100]);
  });

  it("(a) THREE named bodies: 150 — and the step is the PRINTED 50, not a constant", () => {
    const { state } = swing(table(BLIMP, [LOON, LOON, PLAIN]));
    expect(damageVector(state, "p2")).toEqual([150]);
  });

  it("(b) THE ATTACKER ITSELF TAKES 30 — the mechanism `yourAny` introduces", () => {
    const { state } = swing(table(BLIMP, [LOON, PLAIN]));
    expect(damageVector(state, "p1")).toEqual([30, 30, 0]);
  });

  it("(b) …and `placeSnipe` reaches the own ACTIVE even with NO own bench at all", () => {
    const { state, events } = swing(table(BLIMP, []));
    expect(damageVector(state, "p1")).toEqual([30]);
    expect(damageVector(state, "p2")).toEqual([50]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(2);
  });

  it("(c) A NAMED BODY CARRYING A WEAKNESS TAKES EXACTLY 30 — the no-`ignoreWR` reading", () => {
    const { state } = swing(table(BLIMP, [WEAK_LOON, PLAIN]));
    expect(damageVector(state, "p1")).toEqual([30, 30, 0]);
  });

  it("(c) THE DISCRIMINATING BOARD IS THE ATTACKER'S OWN ACTIVE SPOT — still exactly 30", () => {
    const { state } = swing(table(WEAK_BLIMP, [PLAIN]));
    expect(damageVector(state, "p1")).toEqual([30, 0]);
    // …and the fold still COUNTED it: one named body in play is the attacker itself.
    expect(state.players.p2.active?.damage).toBe(50);
  });

  it("(c) …and that hit's DAMAGE_DEALT row reports NO Weakness, rather than a doubled one", () => {
    const { events } = swing(table(WEAK_BLIMP, [PLAIN]));
    const own = events.filter(
      (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> =>
        e.type === "DAMAGE_DEALT" && e.seat === "p1",
    );
    expect(own.map((r) => [r.base, r.weakness, r.dealt])).toEqual([[30, null, 30]]);
  });

  it("(c) …and the WEAKNESS IS LIVE, which is what makes the rung a measurement (D424)", () => {
    // The CONTROL on the same axis: the identical Weakness in the DEFENDING spot doubles
    // the fold, off the same attacker and the same board. Without this, "30" is
    // consistent with a board that has no Weakness on it at all.
    let state = table(BLIMP, [PLAIN]);
    state = setActiveFromDeck(state, "p2", WEAK_LOON);
    // p2's Active is now a Drifloon — which the printed noun NAMES, so the fold counts
    // the attacker only: a seat-confused build would count it and read 100.
    const after = swing(state).state;
    expect(after.players.p2.active?.damage).toBe(100); // 50 × 1, ×2 Weakness
  });

  it("(d) an UNNAMED own body takes NOTHING — the filter, on a board", () => {
    const { state } = swing(table(BLIMP, [LOON, PLAIN, PLAIN]));
    expect(damageVector(state, "p1")).toEqual([30, 30, 0, 0]);
    const { events } = swing(table(BLIMP, [LOON, PLAIN, PLAIN]));
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(3);
  });

  it("(e) THE OPPONENT'S BOARD IS UNTOUCHED BY THE SECOND HALF", () => {
    const { state } = swing(table(BLIMP, [LOON], [LOON, PLAIN]));
    expect(damageVector(state, "p2")).toEqual([100, 0, 0]);
    expect(damageVector(state, "p1")).toEqual([30, 30]);
  });

  it("(e) …even when the OPPONENT fields the very bodies the noun names", () => {
    // The sharpest board for the seat: p2's bench is two Drifloon. A build reading the
    // noun without the seat splashes across the table; the printed *"your"* says it does
    // not, and the fold still counts only p1's.
    const { state } = swing(table(BLIMP, [LOON], [LOON, LOON]));
    expect(damageVector(state, "p2")).toEqual([100, 0, 0]);
    expect(damageVector(state, "p1")).toEqual([30, 30]);
  });

  it('it never PARKS, and that is what `count: "all"` means', () => {
    const { state, events } = swing(table(BLIMP, [LOON, PLAIN]));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(eventTypes(events)).not.toContain("EFFECT_PENDING");
    // …and no `phase.cont` was ever written, which is the fact §7's version argument
    // rests on from the other end.
    expect("cont" in state.phase).toBe(false);
  });

  it("the ATTACK is not skipped and the sentence is SIMULATED", () => {
    const { events } = swing(table(BLIMP, [LOON, PLAIN]));
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(eventTypes(events)).toContain("ATTACK_DECLARED");
  });

  it("the MISMATCHED-NOUN near miss is LOUD through a real attack, not merely null", () => {
    // Driven through the attack rather than through the deriver alone: the sentence is
    // read by nothing, so the engine says so on the loud channel.
    const { events } = swing(table(BLIMP, [LOON, PLAIN]), 2);
    expect(eventTypes(events)).toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the CONTROL attack moves neither board's own side", () => {
    // Same attacker, same cost, no effect text — so every "no own-side damage" verdict
    // above is a claim about the OP rather than about the board.
    const { state } = swing(table(BLIMP, [LOON, PLAIN]), 1);
    expect(damageVector(state, "p1")).toEqual([0, 0, 0]);
    expect(damageVector(state, "p2")).toEqual([10]);
  });

  it("the DAMAGE_DEALT rows name the DAMAGED body's seat and the ATTACKER as dealer", () => {
    const { events } = swing(table(BLIMP, [LOON, PLAIN]));
    const rows = events.filter(
      (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT",
    );
    expect(rows.map((r) => [r.seat, r.by, r.dealt])).toEqual([
      ["p2", "p1", 100],
      ["p1", "p1", 30],
      ["p1", "p1", 30],
    ]);
    // …and the own-side rows carry NO Weakness and NO Resistance, explicitly rather than
    // by omission — the field is present and null, which is what the log renders.
    for (const row of rows.slice(1)) {
      expect(row.weakness).toBeNull();
      expect(row.resistance).toBeNull();
    }
  });

  it("the ACTIVE leg is FIRST, and the order is `ownInPlayRefs`' (Active, then bench)", () => {
    const { events } = swing(table(BLIMP, [LOON]));
    const rows = events.filter(
      (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT",
    );
    expect(rows.map((r) => r.seat)).toEqual(["p2", "p1", "p1"]);
  });

  it("the PLACEMENT arm of the own-side Active leg, driven through a CONSTRUCTED op", () => {
    const state = table(BLIMP, [LOON, PLAIN]);
    const events: GameEvent[] = [];
    const placed = {
      op: "damageChosen",
      target: "yourAny",
      amount: 20,
      count: "all",
      source: "attack",
      filter: PAIR_FILTER,
    } as unknown as EffectOp;
    const run = runProgram(state, [placed], { seat: "p1", invokedBy: "attack" }, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p1")).toEqual([20, 20, 0]);
    expect(eventTypes(events)).toEqual(["COUNTERS_PLACED", "COUNTERS_PLACED"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE OWN-SIDE KO, MID-ATTACK.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §5 — `yourAny` can Knock Out the attacker's own Active", () => {
  it("a 30-HP attacker Knocks ITSELF Out, and the PRIZE goes to the OPPONENT", () => {
    const before = table(FRAIL_BLIMP, [LOON, PLAIN]);
    expect(before.players.p2.prizes).toHaveLength(6);
    const { state, events } = swing(before);
    expect(eventTypes(events)).toContain("KNOCKED_OUT");
    const ko = events.filter(
      (e): e is Extract<GameEvent, { type: "KNOCKED_OUT" }> => e.type === "KNOCKED_OUT",
    );
    // EXACTLY ONE Knock Out: the defender has 500 HP and took 100.
    expect(ko.map((e) => e.seat)).toEqual(["p1"]);
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(state.players.p2.prizes).toHaveLength(6);
    const taken = mustApply(state, {
      type: "takePrizes",
      seat: "p2",
      prizeIndices: [0],
    }).state;
    expect(taken.players.p2.prizes).toHaveLength(5);
    expect(taken.players.p1.prizes).toHaveLength(6);
  });

  it("…and the BENCH half still landed before the sweep read the board", () => {
    // The KO is the epilogue's, not the op's: every named body took its 30 first, and
    // the attacker's own damage is what made it lethal.
    const { state } = swing(table(FRAIL_BLIMP, [LOON, PLAIN]));
    expect(state.players.p1.bench[0]?.damage).toBe(30);
    expect(state.players.p1.bench[1]?.damage).toBe(0);
    expect(state.players.p2.active?.damage).toBe(100);
  });

  it("…and the DEFENDER still took the fold, so the attack was not aborted", () => {
    // A build that swept before the program finished would leave the defender at 0. The
    // fold counts the attacker even though the attacker is about to die: the count is
    // taken at DECLARATION, which is `attack.ts`'s standing rule for this family.
    const { state } = swing(table(FRAIL_BLIMP, [LOON, LOON]));
    expect(state.players.p2.active?.damage).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE EMPTY CANDIDATE SET.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §6 — no named body in play is a SILENT no-op, not a skip", () => {
  it("an attacker the noun does not name, over a bench it does not name: nothing happens", () => {
    const { state, events } = swing(table(PLAIN, [PLAIN, PLAIN]));
    expect(damageVector(state, "p1")).toEqual([0, 0, 0]);
    expect(damageVector(state, "p2")).toEqual([0]);
    expect(eventTypes(events)).not.toContain("DAMAGE_DEALT");
    expect(eventTypes(events)).not.toContain("COUNTERS_PLACED");
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(eventTypes(events)).toContain("ATTACK_DECLARED");
  });

  it("…and the turn still ENDS, which is what makes it a no-op rather than a stall", () => {
    const { state } = swing(table(PLAIN, [PLAIN]));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.turn).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION` 30, OVER THE SERIALIZED BYTES, BOTH DIRECTIONS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §7 — the widening at a persisted address, and the version does not move", () => {
  it('DOOR 1, THE CARRIER: `count: "all"` never parks, so no record can hold the value', () => {
    const { state } = swing(table(BLIMP, [LOON, PLAIN]));
    expect("cont" in state.phase).toBe(false);
    expect(JSON.stringify(state)).not.toContain("yourAny");
  });

  it("DOOR 2, THE ALPHABET: the pre-slice values still mean what they meant", () => {
    // The LOSS direction, driven through JSON because the claim is about BYTES.
    // `ownBenchSnipe.test.ts` §3's shape, at the fourth member.
    const preSlice = [
      '{"op":"damageChosen","target":"opponentBench","amount":30,"count":1,"source":"attack","deals":true}',
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","deals":true}',
      '{"op":"damageChosen","target":"yourBench","amount":40,"count":1,"source":"attack","deals":true}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
  });

  it("…and the NEW value round-trips byte for byte, which is the other direction", () => {
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageChosen","target":"yourAny","amount":30,"count":"all","source":"attack","deals":true,"filter":{"kind":"anyOf","filters":[{"kind":"byName","name":"Drifloon"},{"kind":"byName","name":"Drifblim"}]}}',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
  });

  it("a v30 `yourBench` op over THIS board still means the bench and NOT the Active", () => {
    const state = table(BLIMP, [LOON, PLAIN]);
    const events: GameEvent[] = [];
    const v30 = {
      op: "damageChosen",
      target: "yourBench",
      amount: 30,
      count: "all",
      source: "attack",
      deals: true,
      filter: PAIR_FILTER,
    } as unknown as EffectOp;
    const run = runProgram(state, [v30], { seat: "p1", invokedBy: "attack" }, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p1")).toEqual([0, 30, 0]);
  });

  it("every member of the union is inhabited by a PRINTED sentence, not just by the type", () => {
    const seen = new Set<string>();
    for (const [, text] of corpusRows()) {
      for (const op of (deriveAttackEffect(text) ?? []) as EffectOp[]) {
        if (op.op === "damageChosen") seen.add(op.target);
      }
    }
    expect([...seen].sort()).toEqual(["opponentAny", "opponentBench", "yourAny", "yourBench"]);
  });

  it("the engine version moved and the two spellings agree", () => {
    expect(manifest.version).toBe(engineVersion);
  });
});

describe("D539 §8 — the obligation is traced, and it is empty", () => {
  it("no prompt is built on any board this printing reaches", () => {
    for (const bench of [[], [LOON], [LOON, PLAIN], [LOON, LOON, PLAIN]]) {
      const { state } = swing(table(BLIMP, bench));
      expect(state.phase.kind).not.toBe("effect:choose");
    }
  });
});

describe("D539 §9 — what this slice moved, measured over the legal column", () => {
  it("the step is +1 sentence / +2 printings, DERIVED from the anchor", () => {
    const moved = corpusRows().filter(
      ([, text]) => resolvedByAnyReader(text) && !builtBefore(text),
    );
    expect(moved).toEqual([[2, PRINTED]]);
    expect(units(moved)).toBe(2);
    expect([moved.length, units(moved)]).toEqual([1, 2]);
  });

  it("`/This attack also does /` IS CLOSED — 17 sentences / 41 printings, all read", () => {
    const family = corpusRows().filter(([, t]) => /This attack also does /.test(t));
    expect([family.length, units(family)]).toEqual([17, 41]);
    expect(family.every(([, t]) => resolvedByAnyReader(t))).toBe(true);
  });

  it("`/ damage to each of /` IS CLOSED — 11 sentences / 20 printings, all read", () => {
    const family = corpusRows().filter(([, t]) => / damage to each of /.test(t));
    expect([family.length, units(family)]).toEqual([11, 20]);
    expect(family.every(([, t]) => resolvedByAnyReader(t))).toBe(true);
  });

  it("…and :595 was the LAST unbuilt row of BOTH — what CLOSURE means here", () => {
    for (const pattern of [/This attack also does /, / damage to each of /]) {
      const wasUnbuilt = corpusRows().filter(([, t]) => pattern.test(t) && !builtBefore(t));
      expect(wasUnbuilt).toEqual([[2, PRINTED]]);
    }
  });

  it("the SPLIT and REGISTRY census figures stand still — this row is a RAW claim", () => {
    // A whole-sentence reader claim is not a split, so `SPLIT_ATTACK_UNITS` and
    // `COMPOUND_ATTACK_UNITS` do not move and neither does the trailing-split count,
    // which §1's simulation already pinned at ELEVEN.
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
  });
});
