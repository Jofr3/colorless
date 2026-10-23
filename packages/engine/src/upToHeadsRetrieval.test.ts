import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
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
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { AttackCoinFlip } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { logFromEvents } from "./log";
import { redactGame } from "./redact";
import { flipCoin } from "./rng";
import type { CoinFace } from "./rng";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  discardFromDeck,
  mustApply,
  setActiveFromDeck,
  types,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const PRINTED =
  "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand.";
/** The same skeleton at a different printed count — the digit is CAPTURED, not pinned. Constructed. */
const at = (n: number): string => PRINTED.replace("Flip 3 coins", `Flip ${n} coins`);
const ATTACH_TWIN =
  "Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like.";
const REPEAT = "Flip 3 coins. For each heads, put a card from your discard pile into your hand.";

/** THE READING, spelled once. */
const reading = (count: number): AttackCoinFlip => ({
  kind: "retrievalUpToHeads",
  flips: { kind: "printed", count },
  filter: { kind: "anyCard" },
  dest: "hand",
});
const READING = reading(3);

const READERS = [
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackRequirement,
];
const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const claims = (re: RegExp): readonly [number, number, readonly string[]] => {
  const rows = legalAttackCorpus().filter(([, s]) => re.test(s));
  return [rows.length, units(rows), rows.map(([, s]) => s)];
};

const BASE = 30;
const PLAIN = "fix-energy";
const WALL = "d525-wall";

const RETRIEVAL_CARDS: Record<string, Card> = {
  "d525-forager": battler("d525-forager", {
    name: "D525 Forager",
    types: ["Colorless"],
    hp: 130,
    retreat: 2,
    attacks: [
      /** index 0 — FILE LINE 219 verbatim, with a DECLARED base and cost. */
      { cost: ["Colorless"], name: "Salvage Toss", damage: BASE, effect: PRINTED },
      /** index 1 — the control: no effect, no flip, no program. */
      { cost: ["Colorless"], name: "Plain Jab", damage: BASE },
      { cost: ["Colorless"], name: "Marked Salvage Toss", damage: "30+", effect: PRINTED },
    ],
  }),
  /** The defender — 400 HP, no W/R. */
  [WALL]: battler(WALL, { name: "D525 Wall", types: ["Colorless"], hp: 400 }),
  "d525-weakwall": battler("d525-weakwall", {
    name: "D525 Weak Wall",
    types: ["Colorless"],
    hp: 400,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
};

const RETRIEVAL_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...RETRIEVAL_CARDS };

const RETRIEVAL_DECK = deckOf({
  "d525-forager": 12,
  [WALL]: 12,
  "d525-weakwall": 8,
  [PLAIN]: 28,
});

const SEED = 11;

function openTable(seed: number, first: Seat): GameState {
  return driveSetup(
    seed,
    { p1: RETRIEVAL_DECK, p2: RETRIEVAL_DECK },
    { pool: RETRIEVAL_POOL, first },
  );
}

/** `perTailsSelfDiscard.test.ts`'s idiom: the smallest `rngState` whose next `faces.length` draws are
    exactly `faces`, in order. Derived from `flipCoin`, never hardcoded. */
function rngForFaces(faces: readonly CoinFace[]): number {
  for (let candidate = 1; candidate < 200_000; candidate += 1) {
    let rng = candidate;
    let agrees = true;
    for (const wanted of faces) {
      const [drawn, next] = flipCoin(rng);
      rng = next;
      if (drawn !== wanted) {
        agrees = false;
        break;
      }
    }
    if (agrees) return candidate;
  }
  throw new Error(`no rngState draws ${faces.join(",")}`);
}

const HHH: readonly CoinFace[] = ["heads", "heads", "heads"];
const HTT: readonly CoinFace[] = ["heads", "tails", "tails"];
const HHT: readonly CoinFace[] = ["heads", "heads", "tails"];
const TTT: readonly CoinFace[] = ["tails", "tails", "tails"];

const DEFAULT_PILE: Record<string, number> = { [PLAIN]: 2, [WALL]: 2 };

type Board = {
  /** The three faces, in flip order. */
  readonly faces: readonly CoinFace[];
  /** P1's discard pile, seeded from the deck (`opRecord.test.ts`'s `withDiscard` idiom over
      `discardFromDeck`). Default 2 + 2; `{}` is the empty pile. */
  readonly pile?: Record<string, number>;
  /** The Weak defender instead of the plain wall. */
  readonly weak?: boolean;
};

/** p1 owns TURN 2 with the attacker Active holding ONE Colorless Basic (the {C} cost); P2 went first.
    P1's discard is `pile`; the rng is surgered so the attack's three flips draw `faces`. */
function table(board: Board): GameState {
  let state = openTable(SEED, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (state.turn !== 2) throw new Error(`expected turn 2, got ${String(state.turn)}`);
  state = setActiveFromDeck(state, "p1", "d525-forager");
  state = setActiveFromDeck(state, "p2", board.weak === true ? "d525-weakwall" : WALL);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  if (state.players.p1.discard.length !== 0) {
    throw new Error(`P1's discard is not empty before seeding: ${state.players.p1.discard.length}`);
  }
  for (const [id, count] of Object.entries(board.pile ?? DEFAULT_PILE)) {
    state = discardFromDeck(state, "p1", id, count);
  }
  state = attachFromDeck(state, "p1", PLAIN, 1);
  return { ...state, rngState: rngForFaces(board.faces) };
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(board: Board, index = 0): Swing {
  const before = table(board);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after, events };
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** `opRecord.test.ts`'s idiom: answer the parked chooseCards. */
const pick = (state: GameState, uids: readonly string[]) =>
  mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  });

const NAMES = { p1: "P1", p2: "P2" } as const;
const rows = (events: readonly GameEvent[], state: GameState): string[] =>
  logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" }).map((entry) =>
    entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join(""),
  );

function retrievedRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "DISCARD_RETRIEVED" }> => e.type === "DISCARD_RETRIEVED",
  );
}
function dealtRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT",
  );
}
function flipRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "ATTACK_EFFECT_COIN_FLIP" }> =>
      e.type === "ATTACK_EFFECT_COIN_FLIP",
  );
}
function skippedRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "ATTACK_EFFECT_SKIPPED" }> =>
      e.type === "ATTACK_EFFECT_SKIPPED",
  );
}
/** `rngState` after exactly `n` `flipCoin` steps from `from`. */
function stepped(from: number, n: number): number {
  let rng = from;
  for (let i = 0; i < n; i += 1) rng = flipCoin(rng)[1];
  return rng;
}

describe("D525 §1 — the printed row derives to EXACTLY the seventh member: printed 3, anyCard, hand", () => {
  it("file line 219 derives to the reading — kind, `flips: printed 3`, `filter: anyCard`, `dest: hand`, and NOTHING else (`D525-arm-filter-copies-the-neighbour` / `-arm-dest-copies-d523`)", () => {
    expect(deriveAttackCoinFlip(PRINTED)).toEqual(READING);
    const got = deriveAttackCoinFlip(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(Object.keys(got).sort()).toEqual(["dest", "filter", "flips", "kind"]);
    expect(got.kind).toBe("retrievalUpToHeads");
    // No `ops`, no `max`, no `per`, no `face`: the member carries the op's payload MINUS the count.
    expect("ops" in got).toBe(false);
    expect("max" in got).toBe(false);
    expect("per" in got).toBe(false);
  });

  it("the count is CAPTURED, not pinned — 2, 4 and 10 derive at 2, 4 and 10; `Flip 1 coins.` and `Flip 11 coins.` derive null (`D525-anchor-guard-admits-one-flip` / `-anchor-guard-loses-the-ceiling`)", () => {
    expect(deriveAttackCoinFlip(at(2))).toEqual(reading(2));
    expect(deriveAttackCoinFlip(at(4))).toEqual(reading(4));
    expect(deriveAttackCoinFlip(at(10))).toEqual(reading(10));
    // The family's guards: "coins" is plural (the one-flip form is "Flip a coin."), and the digits are
    // third-party text bounded by MAX_PRINTED_FLIPS = 10.
    expect(deriveAttackCoinFlip(at(1))).toBeNull();
    expect(deriveAttackCoinFlip(at(0))).toBeNull();
    expect(deriveAttackCoinFlip(at(11))).toBeNull();
    for (const s of [at(1), at(0), at(11)]) expect(resolvedByAnyReader(s), s).toBe(false);
    for (const s of [at(2), at(4), at(10), at(1), at(0), at(11)]) {
      expect(
        legalAttackCorpus().some(([, t]) => t === s),
        s,
      ).toBe(false);
    }
  });

  it("the anchor is WHOLE-SENTENCE at BOTH ends — a prefixed print and a suffixed print each derive null on every reader (D520 (3); `D525-anchor-loses-the-head` / `-tail`)", () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    const suffixed = `${PRINTED} Draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed || s === suffixed)).toBe(false);
    expect(deriveAttackCoinFlip(prefixed)).toBeNull();
    expect(deriveAttackCoinFlip(suffixed)).toBeNull();
    expect(resolvedByAnyReader(prefixed)).toBe(false);
    expect(resolvedByAnyReader(suffixed)).toBe(false);
  });

  it("one-token near-misses, all null on EVERY reader — the repeat spelling, the deck, `Attach`, `coin`, `Energy cards`, the opponent's pile", () => {
    const controls: Record<string, string> = {
      "`For each heads,` — the REPEAT reading this slice rejected (a `programPerHeads` over a parking op)":
        REPEAT,
      "`into your deck` for `into your hand` — the destination is a literal (D523's twin shuffles a printed count)":
        "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your deck.",
      "`Attach` for `Put` — the verb is a literal (the attach twin is a different op)":
        "Flip 3 coins. Attach a number of cards up to the number of heads from your discard pile into your hand.",
      "`coin` for `coins` — the plural is the family's own guard":
        "Flip 3 coin. Put a number of cards up to the number of heads from your discard pile into your hand.",
      "`Energy cards` for `cards` — the noun is FIXED in the anchor, not captured":
        "Flip 3 coins. Put a number of Energy cards up to the number of heads from your discard pile into your hand.",
      "`your opponent's discard pile` for `your discard pile` — the zone's owner is a literal":
        "Flip 3 coins. Put a number of cards up to the number of heads from your opponent's discard pile into your hand.",
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      expect(deriveAttackCoinFlip(s), why).toBeNull();
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(
        legalAttackCorpus().some(([, t]) => t === s),
        why,
      ).toBe(false);
    }
  });

  it("THE CONTROL, INVERTED AT D528: the attach twin (corpus FILE LINE 215, 1 printing, `attachEnergyFrom`) now DERIVES on this reader — as `programPerHeads` over ONE copy of D358's op, NOT as `retrievalUpToHeads` — twelve readers and four splitters still null on it, and BOTH ceilings derive", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === ATTACH_TWIN)).toEqual([[1, ATTACH_TWIN]]);
    for (const reader of READERS) {
      if (reader === deriveAttackCoinFlip) continue;
      expect(reader(ATTACH_TWIN), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(ATTACH_TWIN), splitter.name).toBeNull();
    const twin = deriveAttackCoinFlip(ATTACH_TWIN);
    expect(twin).not.toBeNull();
    expect(twin?.kind).toBe("programPerHeads");
    expect(twin?.kind).not.toBe("retrievalUpToHeads");
    if (twin?.kind !== "programPerHeads") throw new Error("the twin is not programPerHeads");
    expect(twin.flips).toEqual({ kind: "printed", count: 3 });
    expect(twin.face).toBe("heads");
    expect(twin.ops).toEqual([
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Lightning",
        benchOnly: true,
        declinable: true,
      },
    ]);
    expect(resolvedByAnyReader(ATTACH_TWIN)).toBe(true);
    // …and the two "up to the number of heads" ceilings in the column are exactly these two rows,
    // BOTH of which now derive on this reader — on DIFFERENT members (`perHeadsConsequent.test.ts`'s
    // ceilings rung, read from this side).
    const ceilings = legalAttackCorpus().filter(([, s]) => s.includes("up to the number of heads"));
    expect(ceilings.map(([, s]) => s).sort()).toEqual([ATTACH_TWIN, PRINTED].sort());
    expect(
      ceilings
        .filter(([, s]) => deriveAttackCoinFlip(s) !== null)
        .map(([, s]) => s)
        .sort(),
    ).toEqual([ATTACH_TWIN, PRINTED].sort());
    expect(ceilings.map(([, s]) => deriveAttackCoinFlip(s)?.kind).sort()).toEqual([
      "programPerHeads",
      "retrievalUpToHeads",
    ]);
    expect(
      legalAttackCorpus().filter(([, s]) => deriveAttackCoinFlip(s)?.kind === "retrievalUpToHeads"),
    ).toEqual([[2, PRINTED]]);
  });

  it("`deriveAttackCoinFlip` is the ONLY claimant — twelve readers and four splitters are null — and the reader surface is still THIRTEEN", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackCoinFlip) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    expect(attackReaderSurface()).toHaveLength(14);
    expect(attackReaderSurface()).toContain("deriveAttackCoinFlip");
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
  });

  it("the anchor's claimed set over all 640 rows is EXACTLY {file line 219} — 1 sentence / 2 printings — and the member appears on exactly that row", () => {
    const [n, u, claimed] = claims(
      /^Flip (\d+) coins\. Put a number of cards up to the number of heads from your discard pile into your hand\.$/,
    );
    expect([n, u]).toEqual([1, 2]);
    expect(claimed).toEqual([PRINTED]);
    expect(legalAttackCorpus()).toHaveLength(640);
    const members = legalAttackCorpus().filter(
      ([, s]) => deriveAttackCoinFlip(s)?.kind === "retrievalUpToHeads",
    );
    expect(members).toEqual([[2, PRINTED]]);
  });
});

describe("D525 §2 — H heads park ONE `chooseCards{min 0, max H, dest hand}` over the public pile; zero heads and an empty pile park nothing", () => {
  it("the board is what it says: P1's attacker is Active with one Colorless Basic, P2's wall is Active, both benches empty, P1's pile is 2 + 2, turn 2", () => {
    const before = table({ faces: HHH });
    expect(before.players.p1.active?.energy).toHaveLength(1);
    expect(before.cardIdByUid[activeUid(before, "p1")]).toBe("d525-forager");
    expect(before.cardIdByUid[activeUid(before, "p2")]).toBe(WALL);
    expect(before.players.p1.bench).toHaveLength(0);
    expect(before.players.p2.bench).toHaveLength(0);
    expect(before.players.p1.discard).toHaveLength(4);
    expect(before.players.p1.discard.map((uid) => before.cardIdByUid[uid]).sort()).toEqual(
      [PLAIN, PLAIN, WALL, WALL].sort(),
    );
    expect(before.turn).toBe(2);
    expect(RETRIEVAL_CARDS["d525-forager"]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(RETRIEVAL_CARDS["d525-forager"]?.attacks?.[0]?.damage).toBe(BASE);
    expect(RETRIEVAL_CARDS["d525-forager"]?.attacks?.[1]?.effect).toBeUndefined();
  });

  it('(i) 3 heads → ONE park: `effect:choose` / `chooseCards { min 0, max 3, dest "hand" }`, the candidates are the WHOLE public pile in pile order, the note MEASURED, the base 30 ALREADY dealt (`DAMAGE_DEALT` precedes `EFFECT_PENDING`), the turn NOT ended (`D525-fold-max-is-the-flip-count` sees 3 here and 1 in (iv))', () => {
    const { before, after, events } = swing({ faces: HHH });
    expect(after.phase.kind).toBe("effect:choose");
    expect(after.phase.kind === "effect:choose" && after.phase.seat).toBe("p1");
    const prompt = cardsPrompt(after);
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(3);
    expect(prompt.dest).toBe("hand");
    expect(prompt.candidates).toEqual(before.players.p1.discard);
    expect(prompt.candidates).toHaveLength(4);
    expect(prompt.note).toBe("Put up to 3 cards from your discard pile into your hand.");
    expect(flipRows(events).map((e) => e.result)).toEqual(HHH);
    // The base is dealt in FULL beside the park — the member keeps the printed base (`scaledBase`
    // has no term for it): DAMAGE_DEALT lands BEFORE the park opens.
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({
      seat: "p2",
      by: "p1",
      uid: activeUid(before, "p2"),
      dealt: BASE,
    });
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(types(events).indexOf("DAMAGE_DEALT")).toBeLessThan(
      types(events).indexOf("EFFECT_PENDING"),
    );
    expect(types(events)).not.toContain("TURN_ENDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(retrievedRows(events)).toHaveLength(0);
    // Nothing moved at the park.
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
    // The continuation holds the SHIPPED op with `max: 3` — the one place H lives.
    if (after.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(after.phase.cont.pendingOp).toEqual({
      op: "discardPileRetrieval",
      filter: { kind: "anyCard" },
      dest: "hand",
      max: 3,
    });
    expect(after.phase.cont.rest).toEqual([]);
  });

  it('(ii) pick 2 of the 3 → both uids to P1\'s HAND, the pile −2, `DISCARD_RETRIEVED { dest: "hand" }` with exactly those uids, the log row MEASURED, the turn ends (D491)', () => {
    const { after: parked } = swing({ faces: HHH });
    const offered = cardsPrompt(parked).candidates;
    const chosen = [offered[0], offered[2]].filter((u): u is string => u !== undefined);
    expect(chosen).toHaveLength(2);
    const { state, events } = pick(parked, chosen);
    expect(state.players.p1.hand).toHaveLength(parked.players.p1.hand.length + 2);
    for (const uid of chosen) expect(state.players.p1.hand).toContain(uid);
    expect(state.players.p1.discard).toHaveLength(2);
    for (const uid of chosen) expect(state.players.p1.discard).not.toContain(uid);
    const retrieved = retrievedRows(events);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]).toMatchObject({ seat: "p1", dest: "hand" });
    expect([...(retrieved[0]?.uids ?? [])].sort()).toEqual([...chosen].sort());
    expect(dealtRows(events)).toHaveLength(0); // the base was dealt BEFORE the park, not again
    expect(state.players.p2.active?.damage).toBe(BASE);
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.turn).toBe(3);
    const lines = rows(events, state);
    expect(lines).toContain("took 2 cards from their discard pile");
    expect(lines).toContain("ended their turn");
  });

  it("(iii) pick all 3 → the hand +3, one card left in the pile; the pick names a wall and an Energy alike (`anyCard`, not `anyEnergy` — `D525-arm-filter-copies-the-neighbour`)", () => {
    const { after: parked } = swing({ faces: HHH });
    const offered = cardsPrompt(parked).candidates;
    const walls = offered.filter((uid) => parked.cardIdByUid[uid] === WALL);
    const energies = offered.filter((uid) => parked.cardIdByUid[uid] === PLAIN);
    expect(walls).toHaveLength(2);
    expect(energies).toHaveLength(2);
    const chosen = [...walls, ...energies.slice(0, 1)];
    const { state, events } = pick(parked, chosen);
    expect(state.players.p1.hand).toHaveLength(parked.players.p1.hand.length + 3);
    expect(state.players.p1.discard).toHaveLength(1);
    expect(retrievedRows(events)[0]?.uids).toHaveLength(3);
    expect(rows(events, state)).toContain("took 3 cards from their discard pile");
  });

  it('(iv) 1 head → `max 1`, the SINGULAR caption MEASURED, the pick moves ONE card and the row reads "took 1 card"', () => {
    const { after, events } = swing({ faces: HTT });
    expect(flipRows(events).map((e) => e.result)).toEqual(HTT);
    const prompt = cardsPrompt(after);
    expect(prompt.max).toBe(1);
    expect(prompt.min).toBe(0);
    expect(prompt.candidates).toHaveLength(4);
    expect(prompt.note).toBe("Put a card from your discard pile into your hand.");
    const [only] = prompt.candidates;
    if (only === undefined) throw new Error("no candidate");
    const { state, events: resumed } = pick(after, [only]);
    expect(state.players.p1.hand).toHaveLength(after.players.p1.hand.length + 1);
    expect(state.players.p1.hand).toContain(only);
    expect(retrievedRows(resumed).map((e) => e.uids)).toEqual([[only]]);
    expect(rows(resumed, state)).toContain("took 1 card from their discard pile");
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it('(v) 2 heads → `max 2`; picking ONE (under the ceiling) is legal — `min 0` is the printed "up to"', () => {
    const { after } = swing({ faces: HHT });
    const prompt = cardsPrompt(after);
    expect(prompt.max).toBe(2);
    expect(prompt.note).toBe("Put up to 2 cards from your discard pile into your hand.");
    const [only] = prompt.candidates;
    if (only === undefined) throw new Error("no candidate");
    const { state } = pick(after, [only]);
    expect(state.players.p1.hand).toHaveLength(after.players.p1.hand.length + 1);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("(vi) 0 heads → NO park: three tails rows, the base 30 dealt, the hand and pile UNCHANGED, the turn ends, no `ATTACK_EFFECT_SKIPPED` (`D525-fold-appends-a-zero-max-op` asks whether this ending is observable)", () => {
    const { before, after, events } = swing({ faces: TTT });
    expect(flipRows(events).map((e) => e.result)).toEqual(TTT);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(retrievedRows(events)).toHaveLength(0);
    expect(dealtRows(events)).toHaveLength(1);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "ATTACK_EFFECT_COIN_FLIP",
      "ATTACK_EFFECT_COIN_FLIP",
      "ATTACK_EFFECT_COIN_FLIP",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });

  it("(vii) 2 heads over an EMPTY pile → NO park (the interpreter's whiff is `done`), the base dealt, the turn ends", () => {
    const { before, after, events } = swing({ faces: HHT, pile: {} });
    expect(before.players.p1.discard).toHaveLength(0);
    expect(flipRows(events).map((e) => e.result)).toEqual(HHT);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(retrievedRows(events)).toHaveLength(0);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("(viii) DECLINE (choose []) → nothing moves, no `DISCARD_RETRIEVED`, the base stands at 30, the turn ends", () => {
    const { after: parked } = swing({ faces: HHH });
    const { state, events } = pick(parked, []);
    expect(state.players.p1.hand).toEqual(parked.players.p1.hand);
    expect(state.players.p1.discard).toEqual(parked.players.p1.discard);
    expect(retrievedRows(events)).toHaveLength(0);
    expect(dealtRows(events)).toHaveLength(0);
    expect(state.players.p2.active?.damage).toBe(BASE);
    expect(types(events)).toContain("TURN_ENDED");
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("(ix) `rngState` advances EXACTLY three `flipCoin` steps and the log carries ONE `ATTACK_EFFECT_COIN_FLIP` row per coin, on every face pattern (`D525-printed-flips-reads-one-flip`)", () => {
    for (const faces of [HHH, HTT, HHT, TTT]) {
      const { before, after, events } = swing({ faces });
      expect(after.rngState, faces.join("-")).toBe(stepped(before.rngState, 3));
      expect(after.rngState, faces.join("-")).not.toBe(stepped(before.rngState, 1));
      expect(after.rngState, faces.join("-")).not.toBe(before.rngState);
      expect(flipRows(events), faces.join("-")).toHaveLength(3);
      expect(
        flipRows(events).map((e) => e.result),
        faces.join("-"),
      ).toEqual(faces);
      for (const row of flipRows(events)) expect(row.seat).toBe("p1");
    }
  });

  it("(x) replays identically from one `rngState` — the same parked board and the same events twice", () => {
    const a = swing({ faces: HHT });
    const b = swing({ faces: HHT });
    expect(b.before.rngState).toBe(a.before.rngState);
    expect(b.after).toEqual(a.after);
    expect(b.events).toEqual(a.events);
  });

  it("(xi) the OPPONENT's redacted view: the prompt is NOT theirs (`prompt: null`) but `board.opponent.discard` names every candidate — the pile is public; P1's own view carries the prompt with the four names", () => {
    const { after: parked } = swing({ faces: HHH });
    const theirs = redactGame(parked, "p2");
    expect(theirs.phase).toEqual({ kind: "effect:choose", prompt: null });
    expect(theirs.board.opponent.discard.map((c) => c.name).sort()).toEqual(
      [PLAIN, PLAIN, "D525 Wall", "D525 Wall"].sort(),
    );
    const mine = redactGame(parked, "p1");
    if (mine.phase.kind !== "effect:choose" || mine.phase.prompt?.kind !== "chooseCards") {
      throw new Error("P1's view does not carry the chooseCards prompt");
    }
    expect(mine.phase.prompt.candidates.map((c) => c.name).sort()).toEqual(
      [PLAIN, PLAIN, "D525 Wall", "D525 Wall"].sort(),
    );
    expect(mine.phase.prompt.max).toBe(3);
    expect(mine.board.you.discard).toHaveLength(4);
  });

  it("(xii) the index-1 control: no flip, no park, no `DISCARD_RETRIEVED`, 30 dealt, `rngState` UNMOVED, the turn ends", () => {
    const { before, after, events } = swing({ faces: HHH }, 1);
    expect(flipRows(events)).toHaveLength(0);
    expect(after.rngState).toBe(before.rngState);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(retrievedRows(events)).toHaveLength(0);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
  });

  it("(xiii) a Weak defender pays 60 — the base is UNSCALED by the member (no `scaledBase` term: the printed 30 is dealt, then W/R) — and the park still opens at `max 3`", () => {
    const { after, events } = swing({ faces: HHH, weak: true });
    expect(after.cardIdByUid[activeUid(after, "p2")]).toBe("d525-weakwall");
    expect(dealtRows(events)[0]?.dealt).toBe(BASE * 2);
    expect(after.players.p2.active?.damage).toBe(BASE * 2);
    expect(cardsPrompt(after).max).toBe(3);
  });

  it('(xiv) the DECLARED "30+" print at index 2: the member explains NO printed marker, so the loud `ATTACK_EFFECT_SKIPPED { damageModifier: "+" }` row SURVIVES the member while the effect text itself is simulated (`effect: null`) — and the park still opens (`D525-modifier-claimed-by-the-member`)', () => {
    const { after, events } = swing({ faces: HHH }, 2);
    const skipped = skippedRows(events);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      seat: "p1",
      attack: "Marked Salvage Toss",
      damageModifier: "+",
      effect: null,
    });
    expect(cardsPrompt(after).max).toBe(3);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(skippedRows(swing({ faces: HHH }, 0).events)).toHaveLength(0);
  });

  it("the park is the program's ONLY park on every board — after the pick the phase is `turn:action` for P2, never `effect:choose` again", () => {
    for (const faces of [HHH, HTT, HHT]) {
      const { after } = swing({ faces });
      const [only] = cardsPrompt(after).candidates;
      if (only === undefined) throw new Error("no candidate");
      const { state } = pick(after, [only]);
      expect(state.phase, faces.join("-")).toEqual({ kind: "turn:action", seat: "p2" });
    }
  });
});

describe("D525 §3 — the census moved in exactly ONE summand, by 1 sentence / 2 printings", () => {
  it("the reader arm reads 552 sentences / 1,594 printings, and the row is IN it", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([600, 1663]);
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([599, 1661]);
  });

  it("the RAW reader-only residue fell by exactly 1 sentence / 2 printings — 88 / 138 — and the row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([40, 69]);
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    expect(unbuilt.map(([, s]) => s)).not.toContain(ATTACH_TWIN);
    // The parts add up to the whole quoted in the same case.
    const all = legalAttackCorpus();
    expect(unbuilt.length + 600).toBe(all.length);
    expect(units(unbuilt) + 1663).toBe(units(all));
    expect([all.length, units(all)]).toEqual([640, 1732]);
  });

  it("the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});

describe("D525 §4 — the version steps, the heading is written, the prose is corrected, and what stands still", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    expect(manifest.version).toBe(engineVersion);
  });

  it("`MATCH_RECORD_VERSION` HOLDS at 30 — DRIVEN in three directions: the parked board round-trips and resumes from its bytes; the continuation's alphabet is the SHIPPED op with a `number` max; a record whose `max` is LOST refuses the pick a live one accepts", () => {
    expect(roundTrip(READING)).toEqual(READING);
    const { after: parked } = swing({ faces: HHH });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const offered = cardsPrompt(parked).candidates;
    const chosen = [offered[1], offered[3]].filter((u): u is string => u !== undefined);
    expect(chosen).toHaveLength(2);

    // DIRECTION 1 — FORWARD. Round-trip the PARKED board through JSON and resume from the bytes.
    const persisted = roundTrip(parked);
    expect(persisted).toEqual(parked);
    const live = pick(parked, chosen);
    const replayed = pick(persisted, chosen);
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);

    expect(Object.keys(parked.phase.cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    const shipped =
      '{"op":"discardPileRetrieval","filter":{"kind":"anyCard"},"dest":"hand","max":3}';
    expect(JSON.stringify(parked.phase.cont.pendingOp)).toBe(shipped);
    expect(parked.phase.cont.rest).toEqual([]);
    expect(
      JSON.stringify(
        deriveAttackEffect("Put up to 3 cards from your discard pile into your hand.")?.[0],
      ),
    ).toBe(shipped);

    // DIRECTION 3 — LOSS. H lives ONLY in the record's `max`: a persisted board whose prompt and
    // pending op lost two of the three heads refuses the two-card pick the live board accepts.
    const lossy = roundTrip(parked);
    if (lossy.phase.kind !== "effect:choose" || lossy.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected a chooseCards park");
    }
    (lossy.phase.prompt as { max: number }).max = 1;
    (lossy.phase.cont.pendingOp as { max: number }).max = 1;
    const truncated = applyAction(lossy, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: chosen },
    });
    expect(truncated.ok).toBe(false);
    if (truncated.ok) throw new Error("the truncated record accepted a pick above its ceiling");
    expect(truncated.error.code).toBe("BAD_EFFECT_CHOICE");
    expect(live.state.players.p1.hand).toHaveLength(parked.players.p1.hand.length + 2);
  });

  it("the demonstrator is FILE-LOCAL — zero `FIXTURE_POOL` ids, the deck is 60, the Energy is the shared pool's Colorless Basic", () => {
    expect(Object.keys(RETRIEVAL_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(RETRIEVAL_DECK).toHaveLength(60);
    expect(FIXTURE_POOL[PLAIN]?.name).toBe(PLAIN);
    expect(FIXTURE_POOL["sv03-184"]).toBeUndefined();
  });
});
