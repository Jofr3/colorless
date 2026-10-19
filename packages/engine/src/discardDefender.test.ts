import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  specialEnergy,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕🆕 D536 — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT.
//
// `censusAttackCorpus.ts` **FILE LINE 100** — *"Discard a Team Rocket's Energy from
// this Pokémon. If you do, discard your opponent's Active Pokémon and all attached
// cards."* — **1 sentence / 3 legal printings** (`legalAttackCorpus()` index 47,
// leading count column `3`; Moltres ex `sv10-031` / `sv10-208` / `sv10-229`).
//
// ⚠️ **THE CARD IDS ARE RESOLVED ON THIS CHECKOUT AND ARE USED AS IDS** — recorded at
// `ownerPrefix.test.ts` (the DROPPED row this slice retires) and in `effects.ts`'s
// `returnBenched` block — but the printed BASE DAMAGE is NOT, so the number is driven
// on a FILE-LOCAL DECLARED demonstrator, `d536-moltres`, in D534's `d534-inkay` and
// D535's `d535-sniper` shape (D425: state unresolved, never invent).
//
// engine 0.420.0 → 0.421.0. ONE new anchor, ONE new arm (44c), ONE new FIELD-FREE
// `EffectOp` member (`discardDefender`) and ONE new interpreter writer. `MATCH_RECORD_
// VERSION` HELD at **30**, and it is held by ONE condition, not three: a new op MEMBER
// is D125's WIDENING (no v30 deploy could write the byte `{"op":"discardDefender"}`,
// and every byte a v30 deploy DID write still means what it meant).
// 🛑 **THE OTHER TWO CONDITIONS THIS SUITE ONCE LISTED ARE CORRECTED, NOT DELETED
// (D466 step 3).** *"The op never parks, so nothing it produces can reach
// `phase.cont`"* is FALSE of the printed program: the COST parks on the reprint board
// (§9), so the consequent rides `EffectContinuation.rest` into the persisted record —
// D450's SECOND DOOR, measured in §10 rather than argued. And *"FIELD-FREE, so no
// persisted union gains a member"* was wrong in its own terms — `EffectOp` IS a
// persisted union and it just gained `discardDefender`, which is condition (1). What
// FIELD-FREE buys is narrower and is stated that way: none of the op's OWN fields is a
// persisted union that could gain a member, and there is no field name to rename.
//
// 🛑 **THE ORDERING CALL THIS SUITE OWES A RUNG (§6).** A defender left lethally
// damaged by this attack's own printed base is DISCARDED, not Knocked Out — no Prize,
// no `KNOCKED_OUT`, no `koRecoilOf`, no `byAttackFor` mark — and NOT ONE LINE OF CODE
// BUYS IT (§8 checks Knock Outs LAST; `collectKnockOuts` → `planPrizes` is
// `finishAttack`'s EPILOGUE, so a body removed DURING the program is never in the
// batch; D435 shipped and drove the same verdict for its delayed-discard payload).
// FREE IN CODE IS NOT FREE IN TESTS: a reading disclosed only in prose survives its
// own deletion in silence, which is exactly the debt D535 carried forward. §6 is the
// rung, and `D536-op-knocks-out-instead-of-discarding` is the mutant that proves the
// decision was MADE rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────

const PRINTED =
  "Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards.";

/** The catalog's byte for the cost card. ⚠️ NOT the anchor's `['’]` class: the
    filter's `name` is compared against `Card.name` by `matchesFilter`'s `byName` arm,
    so what matters here is the CARD's apostrophe and not the PRINT's. */
const TR_ENERGY_NAME = "Team Rocket's Energy";

const PROGRAM: EffectOp[] = [
  {
    op: "discardEnergy",
    from: "yourActive",
    filter: { kind: "byName", name: TR_ENERGY_NAME },
    recordAs: "discarded",
  },
  // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
  { op: "recordGate", slot: "discarded", then: [{ op: "discardDefender" }] },
];

const MOLTRES = "d536-moltres";
/** 330 HP — survives the printed base, so §7's board claims are about the DISCARD
    and can never be read as a Knock Out. */
const WALL = "d536-wall";
/** 60 HP — LETHALLY damaged by the demonstrator's declared 100 base. §6's board. */
const TINY = "d536-tiny";
const BENCHY = "d536-benchy";
const FILLER = "d536-filler";
/** The evolution the §7 stack rung puts UNDER `TINY`. */
const STAGE1 = "d536-stage1";

const TR_ENERGY = "fix-tr-energy";
/** *"Rival of Team Rocket's Energy"* — CONTAINS the name and is not EQUAL to it. */
const NOT_TR_ENERGY = "fix-not-tr-energy";
const PLAIN_ENERGY = "fix-energy";
const UNAWARE = "fix-unaware";
const VENGEFUL = "sv03-197";

/** THE REPRINT, DECLARED FILE-LOCAL: a SECOND catalog id carrying the SAME printed
    name. `index.ts` records that `Team Rocket's Energy` `sv10-182` is REPRINTED as
    `me2pt5-217`, so this is not a hypothetical. */
const TR_ENERGY_REPRINT = "d536-tr-energy-reprint";

const LOCAL_CARDS: Record<string, Card> = {
  [TR_ENERGY_REPRINT]: specialEnergy(TR_ENERGY_REPRINT, TR_ENERGY_NAME),
  [MOLTRES]: battler(MOLTRES, {
    name: "D536 Moltres",
    hp: 260,
    retreat: 1,
    types: ["Fire"],
    attacks: [
      // ⚠️ 100 IS THIS FILE'S DECLARATION AND NOT A PRINTING'S — the base damage of
      // the real Moltres ex is unresolved here (D425). Everything §6 asserts is
      // about the ORDER of the discard and the KO check, not about the number.
      { cost: ["Colorless", "Colorless"], name: "Rocket Blaze", damage: 100, effect: PRINTED },
      // THE CONTROL, one index over: the SAME attacker, the SAME cost, the SAME
      // declared 100 and NO effect text — so §6's verdict is a claim about the op
      // rather than about the board.
      { cost: ["Colorless", "Colorless"], name: "Plain Blaze", damage: 100 },
    ],
  }),
  [WALL]: battler(WALL, {
    name: "D536 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [TINY]: battler(TINY, {
    name: "D536 Tiny",
    hp: 60,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [STAGE1]: battler(STAGE1, {
    name: "D536 Stage 1",
    hp: 130,
    retreat: 1,
    stage: "Stage 1",
    evolveFrom: "D536 Tiny",
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [BENCHY]: battler(BENCHY, {
    name: "D536 Benchy",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D536 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 4 + 12 + 4 + 4 + 4 + 4 + 4 + 2 + 2 + 4 + 2 + 14 = 60.
const DECK = deckOf({
  [MOLTRES]: 4,
  [PLAIN_ENERGY]: 12,
  [TR_ENERGY]: 4,
  [NOT_TR_ENERGY]: 4,
  [WALL]: 4,
  [TINY]: 4,
  [BENCHY]: 4,
  [STAGE1]: 2,
  [TR_ENERGY_REPRINT]: 2,
  [UNAWARE]: 4,
  [VENGEFUL]: 2,
  [FILLER]: 14,
});

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["./{censusAttackCorpus,index,effects,interpreter}.ts", "../../../apps/api/src/lobby/match.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const raw = (suffix: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(suffix))?.[1] ?? "";

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** TEST SURGERY — attach `count` copies of `cardId` off `seat`'s deck onto its Active
    as ENERGY, in the order given. */
function fuel(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) {
    const side = next.players[seat];
    const body = side.active;
    if (body === null) throw new Error(`${seat} has no Active`);
    const uid = side.deck.find((u) => next.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat}'s deck lacks ${id}`);
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

/** TEST SURGERY — attach one `cardId` off `seat`'s deck onto its Active as a TOOL. */
function tool(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const body = side.active;
  if (body === null) throw new Error(`${seat} has no Active`);
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck lacks ${cardId}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: { ...body, tools: [...body.tools, uid] },
        deck: side.deck.filter((u) => u !== uid),
      },
    },
  };
}

/** TEST SURGERY — push one `cardId` UNDER the seat's Active as the bottom of its
    evolution stack, which is what §2's pile order puts FIRST in the discard. */
function underStack(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const body = side.active;
  if (body === null) throw new Error(`${seat} has no Active`);
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck lacks ${cardId}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: { ...body, stack: [uid, ...body.stack] },
        deck: side.deck.filter((u) => u !== uid),
      },
    },
  };
}

/** p1's turn; `d536-moltres` Active and fuelled with `energies`; p2's Active is
    `oppActive` and its Bench is exactly `bench`. */
function board(
  seed: number,
  opts: {
    oppActive?: string;
    bench?: readonly string[];
    energies?: readonly string[];
  } = {},
): GameState {
  const { oppActive = WALL, bench = [BENCHY, FILLER], energies = [TR_ENERGY, PLAIN_ENERGY] } = opts;
  let state = localSetup(seed);
  state = setActiveFromDeck(state, "p2", oppActive);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", MOLTRES);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLER);
  return fuel(state, "p1", energies);
}

function attack(
  state: GameState,
  index = 0,
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, { type: "attack", seat: "p1", index });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

const SEED = 91;
const cardIdsIn = (state: GameState, uids: readonly string[]): string[] =>
  uids.map((u) => state.cardIdByUid[u] ?? "?");

// ─────────────────────────────────────────────────────────────────────────────
describe("D536 §1 — the CENSUS: the population this slice claims, measured", () => {
  it("🛑 the row is raw FILE LINE 100, 3 printings, and `legalAttackCorpus()` holds it exactly once", () => {
    const lines = raw("/censusAttackCorpus.ts").split("\n");
    expect(lines[99] ?? "").toBe(`3 ${PRINTED}`);
    expect(legalAttackCorpus().filter(([, s]) => s === PRINTED)).toEqual([[3, PRINTED]]);
    expect(legalAttackCorpus()).toHaveLength(640);
    // 🛑 THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree HARDER
    // than D535's 1-vs-2, and a census pass that copied one number into the other
    // kind of site would be wrong in half of them.
    expect(legalAttackCorpus().filter(([, s]) => s === PRINTED)[0]?.[0]).toBe(3);
  });

  it("🛑 `legalAttackCorpus()` INDEX 47 is this row — the ordinal the brief names, read rather than retyped", () => {
    expect(legalAttackCorpus()[47]).toEqual([3, PRINTED]);
  });

  it("🛑 the whole-corpus `discard your opponent's Active` family is THIS ROW AND ONLY THIS ROW", () => {
    // The population MEASURED, not impressioned: if a set ever prints a second
    // member of this family, this rung reddens before the anchor silently misses it.
    const family = legalAttackCorpus().filter(([, s]) => /discard your opponent['’]s Active/i.test(s));
    expect(family).toEqual([[3, PRINTED]]);
  });

  it("🛑 the `Team Rocket's Energy` NOUN appears in the legal attack column twice, and the OTHER one is the bonus clause `trEnergyBonus` already reads", () => {
    const mentions = legalAttackCorpus().filter(([, s]) => s.includes(TR_ENERGY_NAME));
    expect(mentions).toHaveLength(2);
    expect(mentions.filter(([, s]) => s === PRINTED)).toEqual([[3, PRINTED]]);
    // The neighbour is BUILT and stays built; naming it here is what keeps this
    // rung a statement about the population rather than about this arm.
    const other = mentions.find(([, s]) => s !== PRINTED)?.[1] ?? "";
    expect(other).toBe(
      "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.",
    );
    expect(deriveAttackEffect(other)).toBeNull();
  });

  it("🛑 the row is now RESOLVED BY A READER — the census's own predicate, which is what retires the `ownerPrefix` DROPPED row", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D536 §2 — the ANCHOR: head, tail, both apostrophe slots, case", () => {
  it("🛑 claims the printed sentence and derives a program", () => {
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });

  it("🛑 BOTH apostrophe slots take the TYPOGRAPHIC form, driven with EQUALITY against the straight one", () => {
    const rocket = PRINTED.replace("Rocket's", "Rocket’s");
    const opponent = PRINTED.replace("opponent's", "opponent’s");
    const both = rocket.replace("opponent's", "opponent’s");
    expect(rocket).not.toBe(PRINTED);
    expect(opponent).not.toBe(PRINTED);
    // EQUALITY, not "not null": a class on one slot only is an anchor that reads half
    // a typographic printing, and two `not.toBeNull()`s could not tell them apart.
    expect(deriveAttackEffect(rocket)).toEqual(PROGRAM);
    expect(deriveAttackEffect(opponent)).toEqual(PROGRAM);
    expect(deriveAttackEffect(both)).toEqual(PROGRAM);
  });

  it("🛑 anchored at BOTH ends — a head or a tail is refused", () => {
    expect(deriveAttackEffect(`This attack does 100 damage. ${PRINTED}`)).toBeNull();
    expect(deriveAttackEffect(`${PRINTED} Then, draw a card.`)).toBeNull();
    // …and the leading/trailing whitespace `deriveAttackEffect` trims is NOT a head.
    expect(deriveAttackEffect(`  ${PRINTED}  `)).toEqual(PROGRAM);
  });

  it("🛑 NO `/i` — the printed capitalisation is the sentence", () => {
    expect(deriveAttackEffect(PRINTED.toLowerCase())).toBeNull();
    expect(deriveAttackEffect(PRINTED.toUpperCase())).toBeNull();
  });

  it("🛑 near misses, ONE axis each (D427)", () => {
    const misses = [
      // the NOUN
      PRINTED.replace("Team Rocket's Energy", "Special Energy"),
      // the COST's zone
      PRINTED.replace("from this Pokémon", "from your opponent's Active Pokémon"),
      // the GATE
      PRINTED.replace("If you do,", "Then,"),
      // the CONSEQUENT's seat
      PRINTED.replace("discard your opponent's Active", "discard your Active"),
      // the ATTACHMENTS
      PRINTED.replace(" and all attached cards", ""),
      // the é
      PRINTED.replace(/Pokémon/g, "Pokemon"),
      // the full stop
      PRINTED.slice(0, -1),
    ];
    for (const miss of misses) {
      expect(miss, "a near miss that is not actually a miss").not.toBe(PRINTED);
      expect(deriveAttackEffect(miss), `claimed: ${miss}`).toBeNull();
    }
  });

  it("🛑 it does not claim the neighbouring `Discard a card from your hand.` rows (corpus lines 101/102/103)", () => {
    const lines = raw("/censusAttackCorpus.ts").split("\n");
    for (const n of [100, 101, 102]) {
      const sentence = (lines[n] ?? "").replace(/^\d+ /, "");
      expect(sentence.startsWith("Discard a card from your hand.")).toBe(true);
      // Each of these IS built, by arms 44a/44b — so the claim is that THIS arm is
      // not the one that claims them, asserted on the program rather than on null.
      expect(deriveAttackEffect(sentence)).not.toEqual(PROGRAM);
    }
  });

  it("🛑 ONE all-640 predicate LOOSER than the anchor (D425): every row opening `Discard a` that this arm claims is this row", () => {
    const loose = legalAttackCorpus().filter(([, s]) => s.startsWith("Discard a"));
    expect(loose.length).toBeGreaterThan(1);
    // ⚠️ THE OP IS NOT TOP-LEVEL: it is the gate's `then`, so a `some` over the
    // program's own members finds nothing. The predicate reads the WHOLE derived
    // program, which is also what makes it looser than the anchor.
    const mine = loose.filter(([, s]) =>
      JSON.stringify(deriveAttackEffect(s) ?? []).includes('"discardDefender"'),
    );
    expect(mine).toEqual([[3, PRINTED]]);
  });

  it("🛑 and NO row in the whole 640 derives `discardDefender` except this one", () => {
    const all = legalAttackCorpus().filter(([, s]) =>
      (deriveAttackEffect(s) ?? []).some(
        (op) => op.op === "discardDefender" || JSON.stringify(op).includes('"discardDefender"'),
      ),
    );
    expect(all).toEqual([[3, PRINTED]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D536 §3 — the PROGRAM: two ops, printed order, gated on `discarded`", () => {
  it("🛑 EXACTLY the two-op program, byte for byte", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    expect(deriveAttackEffect(PRINTED)).toHaveLength(2);
  });

  it("🛑 the COST carries NO `count` — absent is the printed article `a`, not a default (D426)", () => {
    const cost = (deriveAttackEffect(PRINTED) ?? [])[0] as Record<string, unknown>;
    expect(Object.keys(cost).sort()).toEqual(["filter", "from", "op", "recordAs"]);
    expect("count" in cost).toBe(false);
    // …and the shipped precedent spells the same article the same way.
    expect(deriveAttackEffect("Discard a {G} Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "providesEnergy", energyType: "Grass" } },
    ]);
  });

  it("🛑 the GATE reads `discarded`, which is the FIRST shipped `recordGate` on that slot", () => {
    const gate = (deriveAttackEffect(PRINTED) ?? [])[1] as Record<string, unknown>;
    expect(gate.op).toBe("recordGate");
    expect(gate.slot).toBe("discarded");
    expect(gate.then).toEqual([{ op: "discardDefender" }]);
    expect("otherwise" in gate).toBe(false);
    // ⚠️ A STRUCTURAL CLAIM ABOUT A POPULATION, so it is MEASURED and will go stale
    // like a count (D535's own unforecast finding): every OTHER `recordGate` this
    // file authors reads `paid` or `moved`.
    const slots = legalAttackCorpus()
      .flatMap(([, s]) => deriveAttackEffect(s) ?? [])
      .filter((op): op is Extract<EffectOp, { op: "recordGate" }> => op.op === "recordGate")
      .map((op) => op.slot);
    expect(new Set(slots)).toEqual(new Set(["paid", "moved", "discarded"]));
    expect(slots.filter((s) => s === "discarded")).toHaveLength(1);
  });

  it("🛑 the FILTER is `byName` at the CATALOG's straight apostrophe, and the fixture's name agrees LIVE", () => {
    const cost = (deriveAttackEffect(PRINTED) ?? [])[0] as { filter: { kind: string; name: string } };
    expect(cost.filter).toEqual({ kind: "byName", name: TR_ENERGY_NAME });
    expect(cost.filter.name).toContain("'");
    expect(cost.filter.name).not.toContain("’");
    // The byte that decides the match is the CARD's, read off the pool rather than
    // retyped: `matchesFilter`'s `byName` arm compares against `card.name`.
    expect(FIXTURE_POOL[TR_ENERGY]?.name).toBe(TR_ENERGY_NAME);
    expect(FIXTURE_POOL[TR_ENERGY]?.category).toBe("Energy");
    expect(FIXTURE_POOL[NOT_TR_ENERGY]?.name).not.toBe(TR_ENERGY_NAME);
    expect(FIXTURE_POOL[NOT_TR_ENERGY]?.name).toContain(TR_ENERGY_NAME);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D536 §4 — the COST: one Team Rocket's Energy, and nothing else", () => {
  it("🛑 the TR Energy comes off the attacker and the PLAIN Energy SURVIVES", () => {
    const start = board(SEED, { energies: [TR_ENERGY, PLAIN_ENERGY] });
    const { state } = attack(start);
    const active = state.players.p1.active;
    expect(active).not.toBeNull();
    expect(cardIdsIn(state, active?.energy ?? [])).toEqual([PLAIN_ENERGY]);
    expect(cardIdsIn(state, state.players.p1.discard)).toEqual([TR_ENERGY]);
  });

  it("🛑 a card whose name CONTAINS the noun is NOT the cost — the `byName` equality, on a board", () => {
    const start = board(SEED, { energies: [NOT_TR_ENERGY, PLAIN_ENERGY] });
    const { state } = attack(start);
    // No Team Rocket's Energy attached ⇒ empty slot ⇒ nothing discarded at all.
    expect(cardIdsIn(state, state.players.p1.active?.energy ?? []).sort()).toEqual(
      [NOT_TR_ENERGY, PLAIN_ENERGY].sort(),
    );
    expect(state.players.p1.discard).toHaveLength(0);
    expect(state.players.p2.active).not.toBeNull();
  });

  it("🛑 exactly ONE comes off a board carrying TWO — the printed article, driven", () => {
    const start = board(SEED, { energies: [TR_ENERGY, TR_ENERGY] });
    const { state } = attack(start);
    expect(cardIdsIn(state, state.players.p1.active?.energy ?? [])).toEqual([TR_ENERGY]);
    expect(cardIdsIn(state, state.players.p1.discard)).toEqual([TR_ENERGY]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D536 §5 — the WHIFF: no Team Rocket's Energy ⇒ the §9.2 gate does not hold", () => {
  it("🛑 the defender is STILL ON THE BOARD and the printed damage still landed", () => {
    const start = board(SEED, { energies: [PLAIN_ENERGY, PLAIN_ENERGY] });
    const { state, events } = attack(start);
    expect(state.players.p2.active).not.toBeNull();
    expect(state.players.p2.active?.damage).toBe(100);
    expect(state.players.p2.discard).toHaveLength(0);
    expect(events.filter((e) => e.type === "POKEMON_RETURNED")).toHaveLength(0);
    // The cost op ran and found nothing — an empty slot, not a refusal.
    expect(state.players.p1.discard).toHaveLength(0);
  });

  it("🛑 …and the SAME board WITH the Energy discards it, which is what makes the whiff a claim about the gate", () => {
    const start = board(SEED, { energies: [TR_ENERGY, PLAIN_ENERGY] });
    const { state } = attack(start);
    expect(state.players.p2.active).toBeNull();
  });

  it("🛑 the whiff is symmetric — p2 attacking p1 whiffs the same way", () => {
    // The op reads `otherSeat(ctx.seat)`, so the seat is not baked in. Driven from the
    // other side of the table rather than argued.
    // ⚠️ p2 GOES FIRST in `localSetup`, and §5.2 bars the first player's FIRST-turn
    // attack — so the mirror runs on p2's SECOND turn, two `endTurn`s in.
    const mirror = (energies: readonly string[]): GameState => {
      let state = localSetup(SEED);
      state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
      state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
      state = setActiveFromDeck(state, "p2", MOLTRES);
      state = clearBench(state, "p2");
      state = benchFromDeck(state, "p2", FILLER);
      state = setActiveFromDeck(state, "p1", WALL);
      state = clearBench(state, "p1");
      // TWO benched bodies, so the §8.1 promotion PARKS rather than auto-resolving
      // and the empty spot is observable (a Bench of one refills it immediately).
      state = benchFromDeck(state, "p1", BENCHY);
      state = benchFromDeck(state, "p1", FILLER);
      return fuel(state, "p2", energies);
    };
    const whiff = applyAction(mirror([PLAIN_ENERGY, PLAIN_ENERGY]), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    if (!whiff.ok) throw new Error(`mirror whiff refused: ${whiff.error.code}`);
    expect(whiff.state.players.p1.active).not.toBeNull();

    const hit = applyAction(mirror([TR_ENERGY, PLAIN_ENERGY]), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    if (!hit.ok) throw new Error(`mirror hit refused: ${hit.error.code}`);
    expect(hit.state.players.p1.active).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D536 §6 — 🛑 THE ORDERING: a lethally damaged defender is DISCARDED, not Knocked Out", () => {
  /** `TINY` has 60 HP and the demonstrator's declared base is 100, so the defender
      is LETHALLY DAMAGED before the program's second op runs. */
  const lethalBoard = (energies: readonly string[]) =>
    board(SEED, { oppActive: TINY, bench: [BENCHY, FILLER], energies });

  it("🛑 NO Prize is taken — the attacker's prizes are UNCHANGED", () => {
    const start = lethalBoard([TR_ENERGY, PLAIN_ENERGY]);
    const before = start.players.p1.prizes.length;
    const { state } = attack(start);
    expect(before).toBe(6);
    expect(state.players.p1.prizes).toHaveLength(6);
  });

  it("🛑 NO `KNOCKED_OUT` and NO `PRIZES_OWED` event — a `POKEMON_RETURNED{dest:'discard'}` instead", () => {
    const { events } = attack(lethalBoard([TR_ENERGY, PLAIN_ENERGY]));
    expect(events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(0);
    expect(events.filter((e) => e.type === "PRIZES_OWED")).toHaveLength(0);
    const returned = events.filter((e) => e.type === "POKEMON_RETURNED");
    expect(returned).toHaveLength(1);
    expect(returned[0]).toMatchObject({ seat: "p2", actor: "p1", dest: "discard" });
  });

  it("🛑 THE CONTROL, one attack index over: the SAME 100 on the SAME board with NO effect text DOES pay the Prize", () => {
    const { state, events } = attack(lethalBoard([TR_ENERGY, PLAIN_ENERGY]), 1);
    expect(events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(1);
    // …and the TR Energy is still attached, because attack 1 has no effect at all.
    expect(cardIdsIn(state, state.players.p1.active?.energy ?? []).sort()).toEqual(
      [PLAIN_ENERGY, TR_ENERGY].sort(),
    );
  });

  it("🛑 a Vengeful Punch `sv03-197` on the DISCARDED defender pays NO `koRecoilOf` — the half a prose-only reading would have lost", () => {
    let start = lethalBoard([TR_ENERGY, PLAIN_ENERGY]);
    start = tool(start, "p2", VENGEFUL);
    const { state } = attack(start);
    expect(state.players.p2.active).toBeNull();
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("🛑 THE CONTROL for the recoil: the SAME Tool, the SAME board, the ordinary damage Knock Out one index over PAYS 40", () => {
    let start = lethalBoard([TR_ENERGY, PLAIN_ENERGY]);
    start = tool(start, "p2", VENGEFUL);
    const { state } = attack(start, 1);
    expect(state.players.p1.active?.damage).toBe(40);
  });

  it("🛑 no `koByEffect` marker is stamped anywhere — the body left play, it was never made lethal BY AN EFFECT", () => {
    const { state } = attack(lethalBoard([TR_ENERGY, PLAIN_ENERGY]));
    const markers = [
      ...(state.players.p2.active === null ? [] : state.players.p2.active.markers),
      ...state.players.p2.bench.flatMap((b) => b.markers),
    ];
    expect(markers.filter((m) => m.startsWith("koByEffect"))).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D536 §7 — the BOARD: the spot, the pile, the stack and the promotion", () => {
  it("🛑 the opponent's Active spot is EMPTY and every attached card is in the OPPONENT'S OWN pile, in §2 order", () => {
    let start = board(SEED, { oppActive: WALL, bench: [BENCHY, FILLER] });
    start = underStack(start, "p2", STAGE1);
    start = fuel(start, "p2", [PLAIN_ENERGY]);
    start = tool(start, "p2", VENGEFUL);
    const body = start.players.p2.active;
    const expected = [...(body?.stack ?? []), ...(body?.energy ?? []), ...(body?.tools ?? [])];
    expect(cardIdsIn(start, expected)).toEqual([STAGE1, WALL, PLAIN_ENERGY, VENGEFUL]);

    const { state, events } = attack(start);
    expect(state.players.p2.active).toBeNull();
    // THE OPPONENT'S pile, not the actor's: the actor's holds only the Energy cost.
    expect(state.players.p2.discard).toEqual(expected);
    expect(cardIdsIn(state, state.players.p1.discard)).toEqual([TR_ENERGY]);
    const returned = events.find((e) => e.type === "POKEMON_RETURNED");
    expect(returned).toMatchObject({ uid: body?.stack.at(-1), uids: expected });
  });

  it("🛑 a `promote` stage is queued for p2 IN FRONT OF the turn tail", () => {
    const { state } = attack(board(SEED, { oppActive: WALL, bench: [BENCHY, FILLER] }));
    const kinds = state.pending.map((s) => s.kind);
    expect(kinds).toContain("promote");
    expect(state.pending.find((s) => s.kind === "promote")).toMatchObject({ seat: "p2" });
    const promote = kinds.indexOf("promote");
    const tail = kinds.findIndex((k) => k === "endTurn" || k === "checkup");
    expect(promote).toBeGreaterThanOrEqual(0);
    expect(tail).toBeGreaterThan(promote);
  });

  it("🛑 a Bench of ONE auto-resolves — the promotion is total, and it is §8.1's and not this op's", () => {
    const { state } = attack(board(SEED, { oppActive: WALL, bench: [BENCHY] }));
    expect(state.players.p2.active).not.toBeNull();
    expect(state.cardIdByUid[state.players.p2.active?.stack.at(-1) ?? ""]).toBe(BENCHY);
    expect(state.players.p2.bench).toHaveLength(0);
  });

  it("🛑 §14.2 — an opponent with an EMPTY Bench LOSES", () => {
    const { state } = attack(board(SEED, { oppActive: WALL, bench: [] }));
    expect(state.phase.kind).toBe("gameOver");
    if (state.phase.kind !== "gameOver") return;
    expect(state.phase.outcome).toEqual({ result: "win", winner: "p1", reason: "noPokemon" });
  });

  it("🛑 a SILENT NO-OP on an empty Active spot is unreachable here, so the guard is asserted on the op's own contract instead", () => {
    // The printed program cannot empty the spot before its own second op, so the
    // `active === null` guard has no printed board. It is asserted where it CAN be
    // asserted — the source — rather than left to a comment (D465: an instrument that
    // produces a committed figure needs a killer).
    const src = raw("/interpreter.ts");
    const fn = src.slice(src.indexOf("function discardDefender("));
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toContain("if (active === null) return state;");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D536 §8 — §11: the op is refused WHOLE, and the printed cost stays paid", () => {
  it("🛑 a `prevent all effects of attacks` defender keeps its body, and the refusal is ANNOUNCED", () => {
    const start = board(SEED, { oppActive: UNAWARE, bench: [BENCHY, FILLER] });
    const { state, events } = attack(start);
    expect(state.players.p2.active).not.toBeNull();
    expect(state.players.p2.discard).toHaveLength(0);
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(events.filter((e) => e.type === "POKEMON_RETURNED")).toHaveLength(0);
  });

  it("🛑 …and the Energy cost is STILL PAID — the printed cost does not un-pay because the consequent was refused", () => {
    const start = board(SEED, { oppActive: UNAWARE, bench: [BENCHY, FILLER] });
    const { state } = attack(start);
    expect(cardIdsIn(state, state.players.p1.discard)).toEqual([TR_ENERGY]);
    expect(cardIdsIn(state, state.players.p1.active?.energy ?? [])).toEqual([PLAIN_ENERGY]);
  });

  it("🛑 §11 is a GUARD and not a filter — the SAME shield on the SAME board takes the DAMAGE (damage is not an effect)", () => {
    const start = board(SEED, { oppActive: UNAWARE, bench: [BENCHY, FILLER] });
    const { state } = attack(start);
    expect(state.players.p2.active?.damage).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D536 §9 — the MEASUREMENT that turned a PRICED CONTINGENCY into an OWED one", () => {
  it("🛑 TWO COPIES OF THE SAME PRINT do not park — one interchangeability class, forced", () => {
    const start = board(SEED, { energies: [TR_ENERGY, TR_ENERGY, PLAIN_ENERGY] });
    const { state } = attack(start);
    // ⚠️ THIS RUNG HOLDS ON THE *IDS*, NOT ON THE NAME, and the difference is the
    // whole finding of §9 (corrected in place, D466 step 3; the price's own words
    // are kept at `effects.ts`'s doc block as history). Both copies here are the
    // SAME printed id, so `interchangeableCandidates` — which keys on
    // `card:${id}` — sees ONE class, cap 1, and `forcedDiscards`' `"total"` arm
    // auto-resolves at `discardable.length <= count`: no prompt at all.
    // 🛑 THE SLICE'S PRICE GENERALISED THAT TO THE NAME — "`Team Rocket's Energy`
    // has ONE printed id, so it can never park" — and the catalog says otherwise:
    // `sv10-182` is REPRINTED as `me2pt5-217`. The rung TWO below PARKS on that
    // board, which is why the ≈10-line describer contingency is not a contingency
    // at all but OWED and SHIPPED — one `describeBranch` case and, measured,
    // ZERO `describeCondition` bytes (pinned at the end of this section).
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.active).toBeNull();
  });

  it("🛑 …and a board carrying TWO DIFFERENT prints of Energy still does not park, because only one of them matches", () => {
    const start = board(SEED, { energies: [TR_ENERGY, NOT_TR_ENERGY, PLAIN_ENERGY] });
    const { state } = attack(start);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(cardIdsIn(state, state.players.p1.discard)).toEqual([TR_ENERGY]);
  });

  it("🛑 THE MEASUREMENT THE PRICE GOT WRONG: a SECOND PRINTED ID under the SAME NAME MAKES IT PARK — and the catalog HAS one", () => {
    // 🛑 THE SLICE'S OWN PRICE ARGUED THIS COULD NOT HAPPEN, on the premise that
    // `Team Rocket's Energy` has ONE printed id. `index.ts` records the opposite in
    // its own words — `sv10-182`, **reprinted `me2pt5-217`** — so the premise was
    // false when it was written, and the ≈10-line describer contingency it priced
    // as a contingency is OWED. This rung is what turned the argument into a
    // measurement (D446: a predicted SHAPE is not the measurement that predicted it).
    const start = board(SEED, { energies: [TR_ENERGY, TR_ENERGY_REPRINT, PLAIN_ENERGY] });
    const { state } = attack(start);
    expect(POOL[TR_ENERGY_REPRINT]?.name).toBe(TR_ENERGY_NAME);
    expect(TR_ENERGY_REPRINT).not.toBe(TR_ENERGY);
    // TWO interchangeability classes — `cardIdentity` is `card:${id}` — so the cost
    // is a genuine CHOICE and the op parks.
    expect(state.phase.kind).toBe("effect:choose");
    // …and the defender is STILL THERE while the question is open, which is exactly
    // what makes a degraded caption dangerous rather than untidy.
    expect(state.players.p2.active).not.toBeNull();
  });

  it("🛑 the PARKED CAPTION carries the printed consequent — D515's defect, driven byte for byte", () => {
    const start = board(SEED, { energies: [TR_ENERGY, TR_ENERGY_REPRINT, PLAIN_ENERGY] });
    const { state } = attack(start);
    if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
    const note = state.phase.prompt.note;
    // The whole point: WITHOUT `describeBranch`'s `discardDefender` case the note is
    // byte-identical to an UNGATED Energy discard, and the player answering it cannot
    // tell that their choice decides whether the opponent's Active leaves play.
    expect(note).toContain("If you do, discard your opponent's Active Pokémon and all attached cards.");
  });

  it("🛑 …and the answer RESOLVES the gate: picking the matching Energy discards the defender", () => {
    const start = board(SEED, { energies: [TR_ENERGY, TR_ENERGY_REPRINT, PLAIN_ENERGY] });
    const parked = attack(start).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "discardEnergy") throw new Error(`wrong prompt: ${prompt.kind}`);
    // TWO offers — one per printed id — which IS the park, and the reason the
    // caption above has to say what the pick buys.
    expect(prompt.discardable).toHaveLength(2);
    expect(
      prompt.discardable.map((d) => parked.cardIdByUid[d.uid] ?? "?").sort(),
    ).toEqual([TR_ENERGY, TR_ENERGY_REPRINT].sort());
    const pick = prompt.discardable[0]?.uid;
    if (pick === undefined) throw new Error("no candidate");
    const done = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    if (!done.ok) throw new Error(`answer refused: ${done.error.code} ${done.error.message}`);
    expect(done.state.players.p2.active).toBeNull();
  });

  it("🛑 the describer case lives in `describeBranch` and NOWHERE ELSE — the CONDITION half needs no code", () => {
    const src = raw("/interpreter.ts");
    // 🛑 THIS RUNG SAID THE OPPOSITE UNTIL THE REPRINT WAS MEASURED, and it is
    // corrected rather than deleted (D418/D466): the price argued the op could not
    // park, so a describer case would be D465's unkillable line. `index.ts` records
    // `Team Rocket's Energy` `sv10-182` as REPRINTED under `me2pt5-217`, the two rungs
    // above PARK on that board, and the case is therefore OWED and DRIVEN.
    //
    // TWO `case "discardDefender":` labels now — `stepOp`'s exhaustive switch and
    // `describeBranch`'s. COUNTED rather than merely present, because a THIRD would
    // mean somebody answered this question in two places.
    expect(src.split('case "discardDefender":')).toHaveLength(3);
    const branch = src.indexOf("function describeBranch");
    expect(branch).toBeGreaterThan(0);
    expect(src.slice(branch, src.indexOf("\n}\n", branch))).toContain("discardDefender");
    // …and `describeCondition` gets NOTHING: its plain arm already returns "If you
    // do" for a gate with no `contains`, which is the wording this card prints. The
    // absence is asserted so a successor cannot quietly add a second phrase for one
    // question.
    const cond = src.indexOf("function describeCondition");
    expect(cond).toBeGreaterThan(0);
    expect(src.slice(cond, src.indexOf("\n}\n", cond))).not.toContain("discardDefender");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D536 §10 — the PERSISTED bytes, both directions", () => {
  it("🛑 the op is FIELD-FREE — `Object.keys` as a LITERAL key set", () => {
    const gate = (deriveAttackEffect(PRINTED) ?? [])[1] as { then: EffectOp[] };
    const op = gate.then[0] as Record<string, unknown>;
    expect(Object.keys(op)).toEqual(["op"]);
    expect(op).toEqual({ op: "discardDefender" });
  });

  it("🛑 `MATCH_RECORD_VERSION` is 49 (🆕🆕🆕 D646 stepped it 48 → 49; D643 stepped it 47 → 48; D640 stepped it 46 → 47; D637 stepped it 45 → 46; D636 stepped it 44 → 45; D630 stepped it 43 → 44; D621 stepped it 42 → 43; D583 stepped it 41 → 42; D579 stepped it 40 → 41; D577 stepped it 39 → 40; D576 stepped it 38 → 39; D575 stepped it 37 → 38; D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; D547 stepped it 30 → 31; this slice held it) — read off the raw source, not retyped", () => {
    // 🆕🆕🆕 D547 — the constant this slice held is now 31: D547 added two REQUIRED `InPlayPokemon` fields (apps/api match.ts).
    expect(raw("/match.ts")).toContain("export const MATCH_RECORD_VERSION = 49;");
  });

  it("🛑 the engine version stepped to 0.544.0 in BOTH places", () => {
    expect(engineVersion).toBe("0.544.0");
    expect(manifest.version).toBe("0.544.0");
  });

  it("🛑 the op ITSELF never parks — no new `PendingStage` inhabitant, no new `EffectPrompt` value, and on a NON-PARKING board nothing new reaches `phase.cont`", () => {
    // ⚠️ **THE SCOPE IS THE CLAIM** (D423). This rung was titled *"the op NEVER PARKS,
    // so nothing new can reach `phase.cont` — asserted on the whole printed run"* and
    // that title was FALSE of the printed run: `board()`'s default fuel is ONE
    // interchangeability class of Team Rocket's Energy, so the COST is forced and this
    // particular run never parks. What is measured here is exactly that — the op adds
    // no `PendingStage` inhabitant and no `EffectPrompt` value of its own, and on a
    // NON-PARKING board no continuation is written at all. The printed program on the
    // REPRINT board says something different, and the rung below measures it.
    const { state } = attack(board(SEED, { oppActive: WALL, bench: [BENCHY, FILLER] }));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(JSON.stringify(state)).not.toContain("discardDefender");
  });

  it("🛑 …and D450's SECOND DOOR IS OPEN: the PARKED run writes `discardDefender` into `phase.cont.rest` — and 30 still holds, on condition (1) ALONE", () => {
    // 🛑 **THE CORRECTION, RECORDED RATHER THAN QUIETLY MADE (D466 step 3)** — and it
    // is §9's finding arriving a SECOND time: the cost parks, so the consequent is
    // PERSISTED. `docs/conventions.md` (D450): *"`rest` is the second door and it is
    // the one that gets forgotten … an op that never parks is still persisted if any
    // shipped program places it behind one. So 'does this op park?' is not the
    // question. The question is 'can any producer put this op into a written
    // continuation?'"* — and THIS program is that producer. The serialized alphabet
    // DOES grow: `{"op":"discardDefender"}` reaches
    // `MatchRecord.state.phase.cont.rest` on the very board §9 drives.
    //
    // ✅ **AND `MATCH_RECORD_VERSION` 30 STILL HOLDS — on condition (1) ALONE, D125's
    // WIDENING**, which is `discardStadium`'s recorded precedent (`effects.ts`) and
    // `scheduleDiscard`'s: no v30 deploy could WRITE that byte, because no v30 deploy
    // had the member; and every byte string a v30 deploy DID write still means exactly
    // what it meant. `recordGate.then` is typed `EffectOp[]` and could already hold
    // this member the day v30 was written. The version answer never depended on the
    // reachability half — which is why the half that was wrong is corrected here
    // instead of being paid for with a bump.
    const start = board(SEED, { energies: [TR_ENERGY, TR_ENERGY_REPRINT, PLAIN_ENERGY] });
    const { state } = attack(start);
    const phase = state.phase;
    if (phase.kind !== "effect:choose") throw new Error(`expected a park: ${phase.kind}`);
    expect(JSON.parse(JSON.stringify(phase.cont.rest))).toEqual([PROGRAM[1]]);
    expect(JSON.stringify(state)).toContain('{"op":"discardDefender"}');
  });
});
