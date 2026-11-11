import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
  ATTACK_READERS,
} from "./effects";
import type { AttackCoinFlip } from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import { flipCoin, type RngState } from "./rng";
import type { CoinFace } from "./rng";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  types,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const LADDER_ROW = legalAttackCorpus().find(([, s]) =>
  s.startsWith("Flip 3 coins. If 1 of them is heads"),
);
if (LADDER_ROW === undefined) throw new Error("corpus FILE LINE 218 is not in legalAttackCorpus()");
const PRINTED: string = LADDER_ROW[1];
const BISHARP = PRINTED.replace("does 50 more damage", "does 60 more damage").replace(
  "does 80 more damage",
  "does 120 more damage",
);
/** The same three tiers at a different printed count — the count is PINNED (the third tier says "all of
    them"), so these must refuse. Constructed. */
const atCount = (n: number): string => PRINTED.replace("Flip 3 coins", `Flip ${n} coins`);
/** A 0 in tier position `i` (1-based). Constructed. */
const zeroTier = (i: 1 | 2 | 3): string => {
  const amounts = ["20", "50", "80"] as const;
  return PRINTED.replace(`does ${amounts[i - 1]} more damage`, "does 0 more damage");
};
const MAGIKARP = "Flip 2 coins. If both of them are heads, this attack does 20 more damage.";
/** `coinThreshold.test.ts`'s `perHeadsThenThreshold` print and `multiCoinFlip.test.ts`'s `perHeads` print —
    the two members whose programs must stay UNEQUAL to the ladder. */
const THRESHOLD =
  "Flip 2 coins. This attack does 90 damage for each heads. If either of them is heads, your opponent's Active Pokémon is now Paralyzed.";
const PER_HEADS = "Flip 2 coins. This attack does 80 damage for each heads.";

/** THE READING, spelled once. */
const reading = (ladder: readonly [number, number, number]): AttackCoinFlip => ({
  kind: "bonusLadder",
  flips: { kind: "printed", count: 3 },
  ladder,
});
const READING = reading([20, 50, 80]);

const READERS = ATTACK_READERS.map(({ read }) => read);
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
const WALL = "d526-wall";

const LADDER_CARDS: Record<string, Card> = {
  "d526-climber": battler("d526-climber", {
    name: "D526 Climber",
    types: ["Colorless"],
    hp: 130,
    retreat: 2,
    attacks: [
      { cost: ["Colorless"], name: "Triple Toss", damage: "30+", effect: PRINTED },
      /** index 1 — the control: no effect, no flip, no bonus. */
      { cost: ["Colorless"], name: "Plain Jab", damage: BASE },
      { cost: ["Colorless"], name: "Unmarked Triple Toss", damage: BASE, effect: PRINTED },
    ],
  }),
  /** The defender — 400 HP, no W/R. */
  [WALL]: battler(WALL, { name: "D526 Wall", types: ["Colorless"], hp: 400 }),
  "d526-weakwall": battler("d526-weakwall", {
    name: "D526 Weak Wall",
    types: ["Colorless"],
    hp: 400,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
};

const LADDER_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LADDER_CARDS };

const LADDER_DECK = deckOf({
  "d526-climber": 12,
  [WALL]: 12,
  "d526-weakwall": 8,
  [PLAIN]: 28,
});

const SEED = 11;

function openTable(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: LADDER_DECK, p2: LADDER_DECK }, { pool: LADDER_POOL, first });
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
const HHT: readonly CoinFace[] = ["heads", "heads", "tails"];
const HTT: readonly CoinFace[] = ["heads", "tails", "tails"];
const TTT: readonly CoinFace[] = ["tails", "tails", "tails"];
/** The same heads COUNT in a different ORDER — the fold reads the tally, not the sequence. */
const THT: readonly CoinFace[] = ["tails", "heads", "tails"];
const THH: readonly CoinFace[] = ["tails", "heads", "heads"];

type Board = {
  /** The three faces, in flip order. */
  readonly faces: readonly CoinFace[];
  /** The Weak defender instead of the plain wall. */
  readonly weak?: boolean;
};

/** p1 owns TURN 2 with the attacker Active holding ONE Colorless Basic (the {C} cost); P2 went first.
    The rng is surgered so the attack's three flips draw `faces`. */
function table(board: Board): GameState {
  let state = openTable(SEED, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (state.turn !== 2) throw new Error(`expected turn 2, got ${String(state.turn)}`);
  state = setActiveFromDeck(state, "p1", "d526-climber");
  state = setActiveFromDeck(state, "p2", board.weak === true ? "d526-weakwall" : WALL);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", PLAIN, 1);
  return { ...state, rngState: rngForFaces(board.faces) };
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(board: Board, index = 0): Swing {
  const before = table(board);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after, events };
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
function stepped(from: RngState, n: number): RngState {
  let rng = from;
  for (let i = 0; i < n; i += 1) rng = flipCoin(rng)[1];
  return rng;
}
function dealt(events: readonly GameEvent[]): number {
  const rows = dealtRows(events);
  if (rows.length !== 1) throw new Error(`expected one DAMAGE_DEALT row, got ${rows.length}`);
  const [only] = rows;
  if (only === undefined) throw new Error("no DAMAGE_DEALT row");
  return only.dealt;
}

/** The events every board emits, in order: the flips, ONE hit, and the turn ending (no park anywhere). */
const ATTACK_SHAPE = [
  "ATTACK_DECLARED",
  "ATTACK_EFFECT_COIN_FLIP",
  "ATTACK_EFFECT_COIN_FLIP",
  "ATTACK_EFFECT_COIN_FLIP",
  "DAMAGE_DEALT",
  "TURN_ENDED",
  "TURN_STARTED",
  "CARDS_DRAWN",
];

describe("D526 §1 — the printed row derives to EXACTLY the eighth member: printed 3, ladder [20, 50, 80], no `per`", () => {
  it("(a) file line 218 derives to the reading — kind, `flips: printed 3`, `ladder: [20, 50, 80]`, and NOTHING else (`D526-arm-reverses-the-tuple`)", () => {
    expect(deriveAttackCoinFlip(PRINTED)).toEqual(READING);
    const got = deriveAttackCoinFlip(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(Object.keys(got).sort()).toEqual(["flips", "kind", "ladder"]);
    expect(got.kind).toBe("bonusLadder");
    expect(got).not.toHaveProperty("per");
    expect("ops" in got).toBe(false);
    expect("face" in got).toBe(false);
    expect("threshold" in got).toBe(false);
    if (got.kind !== "bonusLadder") throw new Error("not the ladder");
    expect(got.ladder).toEqual([20, 50, 80]);
    expect(got.ladder).toHaveLength(3);
    expect(got.flips).toEqual({ kind: "printed", count: 3 });
  });

  it("(b) the AMOUNTS are captured, not pinned — Bisharp sv03-149's pool print (20/60/120, the OLD refusal witness) derives `[20, 60, 120]` (the D413/D121 warrant: two printings, tokens varying)", () => {
    expect(BISHARP).not.toBe(PRINTED);
    expect(BISHARP).toContain("does 60 more damage");
    expect(BISHARP).toContain("does 120 more damage");
    expect(deriveAttackCoinFlip(BISHARP)).toEqual(reading([20, 60, 120]));
    expect(legalAttackCorpus().some(([, s]) => s === BISHARP)).toBe(false);
    // A third variation, constructed: the capture is a capture.
    const other = PRINTED.replace("does 20 more damage", "does 10 more damage");
    expect(deriveAttackCoinFlip(other)).toEqual(reading([10, 50, 80]));
  });

  it('(c) the COUNT is PINNED at 3 — `Flip 4 coins.` and `Flip 2 coins.` with the same three tiers derive null on EVERY reader (the third tier is spelled "all of them"; `D526-anchor-count-loosened`)', () => {
    for (const n of [4, 2, 1, 5, 10]) {
      const s = atCount(n);
      expect(s, String(n)).not.toBe(PRINTED);
      expect(deriveAttackCoinFlip(s), String(n)).toBeNull();
      for (const reader of READERS) expect(reader(s), `${reader.name} at ${n}`).toBeNull();
      expect(resolvedByAnyReader(s), String(n)).toBe(false);
      expect(
        legalAttackCorpus().some(([, t]) => t === s),
        String(n),
      ).toBe(false);
    }
    // …and the legal count itself is what the member carries, read off the sentence and not off `\d+`.
    expect(atCount(3)).toBe(PRINTED);
  });

  it("(d) a printed 0 tier in ANY position refuses the whole sentence (the family's `per >= 1`, asked tier by tier; `D526-arm-admits-a-zero-tier`)", () => {
    for (const i of [1, 2, 3] as const) {
      const s = zeroTier(i);
      expect(s, `tier ${i}`).not.toBe(PRINTED);
      expect(s, `tier ${i}`).toContain("does 0 more damage");
      expect(deriveAttackCoinFlip(s), `tier ${i}`).toBeNull();
      expect(resolvedByAnyReader(s), `tier ${i}`).toBe(false);
    }
    // The control: every tier at 1 (the boundary) derives.
    const ones = PRINTED.replace("does 20 more", "does 1 more")
      .replace("does 50 more", "does 1 more")
      .replace("does 80 more", "does 1 more");
    expect(deriveAttackCoinFlip(ones)).toEqual(reading([1, 1, 1]));
  });

  it("(e) the anchor is WHOLE-SENTENCE at BOTH ends — a prefixed print and a suffixed print each derive null on every reader (D520 (3); `D526-anchor-loses-the-head` / `-tail`); the trailing splitter composes on the TAIL of the suffixed print by design (D426), and nothing resolves either", () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    const suffixed = `${PRINTED} Draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed || s === suffixed)).toBe(false);
    for (const s of [prefixed, suffixed]) {
      expect(deriveAttackCoinFlip(s)).toBeNull();
      for (const reader of READERS) expect(reader(s), reader.name).toBeNull();
      expect(resolvedByAnyReader(s)).toBe(false);
    }
    // The PREFIXED print reaches no splitter at all.
    for (const splitter of SPLITTERS) expect(splitter(prefixed), splitter.name).toBeNull();
    expect(splitAttackGateClause(suffixed)).toBeNull();
    expect(splitAttackCancelClause(suffixed)).toBeNull();
    expect(splitAttackRequirementClause(suffixed)).toBeNull();
    expect(splitAttackTrailingClause(suffixed)).toEqual({ head: PRINTED, tail: "Draw a card." });
  });

  it("(f) one-token near-misses, all null on EVERY reader — `If 3 of them`, `less damage`, the trailing period dropped, an NBSP, `head` for `heads`, `are heads` in tier 1", () => {
    const controls: Record<string, string> = {
      "`If 3 of them is heads` for `If 1 of them` — the tier's count is a literal": PRINTED.replace(
        "If 1 of them is heads",
        "If 3 of them is heads",
      ),
      "`less damage` for `more damage` in tier 1 — the direction is a literal": PRINTED.replace(
        "does 20 more damage",
        "does 20 less damage",
      ),
      "the trailing period dropped — the `$` needs the printed terminator": PRINTED.slice(0, -1),
      "an NBSP for the space after `Flip 3 coins.` — bytes, not words": PRINTED.replace(
        "Flip 3 coins. If",
        "Flip 3 coins. If",
      ),
      "`head` for `heads` in tier 1 — the noun is a literal": PRINTED.replace(
        "If 1 of them is heads",
        "If 1 of them is head",
      ),
      "`are heads` for `is heads` in tier 1 — the verb agrees with the printed count":
        PRINTED.replace("If 1 of them is heads", "If 1 of them are heads"),
      "`each of them` for `all of them` — the third tier's quantifier is a literal":
        PRINTED.replace("If all of them are heads", "If each of them are heads"),
    };
    expect(Object.keys(controls)).toHaveLength(7);
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      expect(deriveAttackCoinFlip(s), why).toBeNull();
      for (const reader of READERS) expect(reader(s), `${reader.name}: ${why}`).toBeNull();
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(
        legalAttackCorpus().some(([, t]) => t === s),
        why,
      ).toBe(false);
    }
  });

  it("(g) THE CONTROLS stay where they are: Magikarp's two-coin gate is null on every reader ( D634: but the coin reader, which reads it as `bonusOnAllHeads`); the `perHeadsThenThreshold` and `perHeads` prints still derive their OWN members, UNEQUAL to the ladder", () => {
    for (const reader of READERS) {
      if (reader !== deriveAttackCoinFlip) expect(reader(MAGIKARP), reader.name).toBeNull();
    }
    expect(deriveAttackCoinFlip(MAGIKARP)).toEqual({
      kind: "bonusOnAllHeads",
      flips: { kind: "printed", count: 2 },
      bonus: 20,
    });
    expect(resolvedByAnyReader(MAGIKARP)).toBe(true);
    const threshold = deriveAttackCoinFlip(THRESHOLD);
    expect(threshold?.kind).toBe("perHeadsThenThreshold");
    expect(threshold).toHaveProperty("per", 90);
    expect(threshold).not.toHaveProperty("ladder");
    const perHeads = deriveAttackCoinFlip(PER_HEADS);
    expect(perHeads).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 2 }, per: 80 });
    expect(perHeads).not.toHaveProperty("ladder");
    for (const other of [threshold, perHeads]) {
      expect(other).not.toEqual(READING);
      expect(other?.kind).not.toBe("bonusLadder");
    }
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does 30 more damage.")).toEqual(
      {
        kind: "bonusOnHeads",
        flips: { kind: "printed", count: 1 },
        per: 30,
      },
    );
  });

  it("(h) `deriveAttackCoinFlip` is the ONLY claimant — twelve readers and four splitters are null — and the reader surface is still THIRTEEN", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackCoinFlip) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    expect(attackReaderSurface()).toContain("deriveAttackCoinFlip");
  });

  it("(j) the anchor's claimed set over every corpus row is EXACTLY {file line 218} — 1 sentence / 1 printing — and the member appears on exactly that row", () => {
    const [n, u, claimed] = claims(
      /^Flip 3 coins\. If 1 of them is heads, this attack does (\d+) more damage\. If 2 of them are heads, this attack does (\d+) more damage\. If all of them are heads, this attack does (\d+) more damage\.$/,
    );
    expect([n, u]).toEqual([1, 1]);
    expect(claimed).toEqual([PRINTED]);
    const members = legalAttackCorpus().filter(
      ([, s]) => deriveAttackCoinFlip(s)?.kind === "bonusLadder",
    );
    expect(members).toEqual([[1, PRINTED]]);
    const cousins = legalAttackCorpus().filter(
      ([, s]) => /of them (is|are) heads/.test(s) && s !== PRINTED,
    );
    for (const [, s] of cousins) expect(deriveAttackCoinFlip(s)?.kind, s).not.toBe("bonusLadder");
  });
});

describe("D526 §2 — exactly 1 / 2 / 3 heads pay +20 / +50 / +80 on top of the base; 0 heads pay the base alone; nothing parks", () => {
  it("the board is what it says: P1's attacker is Active with one Colorless Basic, P2's wall is Active, both benches empty, turn 2, the three prints DECLARED", () => {
    const before = table({ faces: HHH });
    expect(before.players.p1.active?.energy).toHaveLength(1);
    expect(before.cardIdByUid[activeUid(before, "p1")]).toBe("d526-climber");
    expect(before.cardIdByUid[activeUid(before, "p2")]).toBe(WALL);
    expect(before.players.p1.bench).toHaveLength(0);
    expect(before.players.p2.bench).toHaveLength(0);
    expect(before.turn).toBe(2);
    expect(LADDER_CARDS["d526-climber"]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(LADDER_CARDS["d526-climber"]?.attacks?.[0]?.damage).toBe("30+");
    expect(LADDER_CARDS["d526-climber"]?.attacks?.[1]?.effect).toBeUndefined();
    expect(LADDER_CARDS["d526-climber"]?.attacks?.[1]?.damage).toBe(BASE);
    expect(LADDER_CARDS["d526-climber"]?.attacks?.[2]?.effect).toBe(PRINTED);
    expect(LADDER_CARDS["d526-climber"]?.attacks?.[2]?.damage).toBe(BASE);
  });

  it("(i) TTT → EXACTLY 30 dealt (the base alone, `coinBonus` 0) — NOT 50, the `ladder[heads]` off-by-one that would pay tier 1 on zero heads (`D526-fold-indexes-from-zero-heads`); NOT 0, the dropped base (`D526-scaled-base-drops-the-base`)", () => {
    const { before, after, events } = swing({ faces: TTT });
    expect(flipRows(events).map((e) => e.result)).toEqual(TTT);
    expect(dealt(events)).toBe(BASE);
    expect(dealt(events)).not.toBe(BASE + 20);
    expect(dealt(events)).not.toBe(0);
    expect(dealtRows(events)[0]).toMatchObject({
      seat: "p2",
      by: "p1",
      uid: activeUid(before, "p2"),
      dealt: BASE,
    });
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(types(events)).toEqual(ATTACK_SHAPE);
  });

  it("(ii) HTT → EXACTLY 50 dealt (30 + tier 1) — NOT 110, the reversed tuple (`D526-arm-reverses-the-tuple`); NOT 80, the shifted index", () => {
    const { after, events } = swing({ faces: HTT });
    expect(flipRows(events).map((e) => e.result)).toEqual(HTT);
    expect(dealt(events)).toBe(BASE + 20);
    expect(dealt(events)).not.toBe(BASE + 80);
    expect(dealt(events)).not.toBe(BASE + 50);
    expect(after.players.p2.active?.damage).toBe(BASE + 20);
    expect(types(events)).toEqual(ATTACK_SHAPE);
  });

  it("(iii) HHT → EXACTLY 80 dealt (30 + tier 2) — NOT 70 (2 × 20, the per-heads copy: `D526-fold-copies-the-per-heads-neighbour`); NOT 100 (20 + 50, the cumulative sum); NOT 110 (the shifted index)", () => {
    const { after, events } = swing({ faces: HHT });
    expect(flipRows(events).map((e) => e.result)).toEqual(HHT);
    expect(dealt(events)).toBe(BASE + 50);
    expect(dealt(events)).not.toBe(BASE + 2 * 20);
    expect(dealt(events)).not.toBe(BASE + 20 + 50);
    expect(dealt(events)).not.toBe(BASE + 80);
    expect(after.players.p2.active?.damage).toBe(BASE + 50);
    expect(types(events)).toEqual(ATTACK_SHAPE);
  });

  it("(iv) HHH → EXACTLY 110 dealt (30 + tier 3) — THE EXCLUSIVITY PIN: NOT 180 (30 + 20 + 50 + 80, `D526-fold-sums-the-tiers`); NOT 90 (30 + 3 × 20, the per-heads copy); NOT 80 (the base dropped)", () => {
    const { after, events } = swing({ faces: HHH });
    expect(flipRows(events).map((e) => e.result)).toEqual(HHH);
    expect(dealt(events)).toBe(BASE + 80);
    expect(dealt(events)).not.toBe(BASE + 20 + 50 + 80);
    expect(dealt(events)).not.toBe(BASE + 3 * 20);
    expect(dealt(events)).not.toBe(80);
    expect(after.players.p2.active?.damage).toBe(BASE + 80);
    expect(types(events)).toEqual(ATTACK_SHAPE);
  });

  it("(v) the four outcomes are pairwise DISTINCT and MONOTONE — 30 < 50 < 80 < 110 — and each equals base + the printed tier, read back from the derived member", () => {
    const member = deriveAttackCoinFlip(PRINTED);
    if (member === null || member.kind !== "bonusLadder") throw new Error("not the ladder");
    const paid = [TTT, HTT, HHT, HHH].map((faces) => dealt(swing({ faces }).events));
    expect(paid).toEqual([
      BASE,
      BASE + member.ladder[0],
      BASE + member.ladder[1],
      BASE + member.ladder[2],
    ]);
    expect(paid).toEqual([30, 50, 80, 110]);
    for (let i = 1; i < paid.length; i += 1) {
      const lower = paid[i - 1];
      const upper = paid[i];
      if (lower === undefined || upper === undefined) throw new Error("missing outcome");
      expect(upper).toBeGreaterThan(lower);
    }
  });

  it("(vi) the fold reads the heads TALLY, not the sequence: THT pays what HTT pays, THH what HHT pays", () => {
    expect(dealt(swing({ faces: THT }).events)).toBe(dealt(swing({ faces: HTT }).events));
    expect(dealt(swing({ faces: THH }).events)).toBe(dealt(swing({ faces: HHT }).events));
    expect(flipRows(swing({ faces: THT }).events).map((e) => e.result)).toEqual(THT);
    expect(flipRows(swing({ faces: THH }).events).map((e) => e.result)).toEqual(THH);
  });

  it("(vii) a Weak defender pays 220 on HHH — 2 × (30 + 80): the base is UNSCALED by the member (no `scaledBase` term) and the bonus lands PRE-W/R, so Weakness doubles both together", () => {
    const { after, events } = swing({ faces: HHH, weak: true });
    expect(after.cardIdByUid[activeUid(after, "p2")]).toBe("d526-weakwall");
    expect(dealt(events)).toBe((BASE + 80) * 2);
    expect(dealt(events)).not.toBe(BASE * 2 + 80); // the bonus is not added after W/R
    expect(after.players.p2.active?.damage).toBe(220);
    // …and on TTT the Weak wall pays the doubled base alone.
    expect(dealt(swing({ faces: TTT, weak: true }).events)).toBe(BASE * 2);
  });

  it("(viii) `rngState` advances EXACTLY three `flipCoin` steps and the log carries ONE `ATTACK_EFFECT_COIN_FLIP` row per coin, on every face pattern (`D526-printed-flips-reads-one-flip`)", () => {
    for (const faces of [HHH, HHT, HTT, TTT, THT, THH]) {
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

  it("(ix) replays identically from one `rngState` — the same board and the same events twice", () => {
    const a = swing({ faces: HHT });
    const b = swing({ faces: HHT });
    expect(b.before.rngState).toBe(a.before.rngState);
    expect(b.after).toEqual(a.after);
    expect(b.events).toEqual(a.events);
  });

  it("(x) NO park, EVER: on every face pattern the phase is `turn:action` for P2 after the attack (the attack ends the turn [ D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds], D491), no `EFFECT_PENDING`, `TURN_ENDED` present", () => {
    for (const faces of [HHH, HHT, HTT, TTT]) {
      const { after, events } = swing({ faces });
      expect(after.phase, faces.join("-")).toEqual({ kind: "turn:action", seat: "p2" });
      expect(after.phase.kind, faces.join("-")).not.toBe("effect:choose");
      expect(types(events), faces.join("-")).not.toContain("EFFECT_PENDING");
      expect(types(events), faces.join("-")).toContain("TURN_ENDED");
      expect(after.turn, faces.join("-")).toBe(3);
    }
  });

  it('(xi) the DECLARED "30+" print IS explained by the member: ZERO `ATTACK_EFFECT_SKIPPED` rows on every face pattern — the MIRROR of D525 (xiv)\'s polarity (`D526-modifier-disowned-by-the-member`)', () => {
    for (const faces of [HHH, HHT, HTT, TTT]) {
      const { events } = swing({ faces }, 0);
      expect(skippedRows(events), faces.join("-")).toHaveLength(0);
      expect(types(events), faces.join("-")).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
    // The marker is a `+` on a base of 30 — DECLARED on the print, read here so the rung cannot go
    // quiet by the demonstrator losing its marker.
    expect(LADDER_CARDS["d526-climber"]?.attacks?.[0]?.damage).toBe("30+");
  });

  it("(xii) the same sentence under a flat, UNMARKED 30 (index 2): the fold still pays 110 on HHH and 30 on TTT, and NO skipped row appears either way", () => {
    const marked = swing({ faces: HHH }, 0);
    const unmarked = swing({ faces: HHH }, 2);
    expect(dealt(unmarked.events)).toBe(BASE + 80);
    expect(dealt(unmarked.events)).toBe(dealt(marked.events));
    expect(skippedRows(unmarked.events)).toHaveLength(0);
    expect(dealt(swing({ faces: TTT }, 2).events)).toBe(BASE);
    expect(skippedRows(swing({ faces: TTT }, 2).events)).toHaveLength(0);
    expect(unmarked.after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("(xiii) the index-1 control: no flip, `rngState` UNMOVED, 30 dealt, no skipped row, the turn ends", () => {
    const { before, after, events } = swing({ faces: HHH }, 1);
    expect(flipRows(events)).toHaveLength(0);
    expect(after.rngState).toBe(before.rngState);
    expect(dealt(events)).toBe(BASE);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(skippedRows(events)).toHaveLength(0);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });
});

describe("D526 §3 — the census moved in exactly ONE summand, by 1 sentence / 1 printing", () => {
  it("the reader arm reads 553 sentences / 1,595 printings, and the row is IN it", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([resolved.length - without.length, units(resolved) - units(without)]).toEqual([1, 1]);
  });

  it("the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 87 / 137 — and the row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
  });

  it("the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});

describe("D526 §4 — the version steps, the heading is written, the prose is corrected, and what stands still", () => {
  it("`MATCH_RECORD_VERSION` HOLDS at 30 — DRIVEN: the member is never serialized (it is spent into a NUMBER at the fold), the attack never parks, and the post-attack board is BYTE-EQUAL through a JSON round-trip", () => {
    expect(roundTrip(READING)).toEqual(READING);
    for (const faces of [HHH, HHT, HTT, TTT]) {
      const { after } = swing({ faces });
      expect(after.phase.kind, faces.join("-")).not.toBe("effect:choose");
      const persisted = roundTrip(after);
      expect(persisted, faces.join("-")).toEqual(after);
      expect(JSON.stringify(persisted), faces.join("-")).toBe(JSON.stringify(after));
      // Nothing in the persisted bytes names the member or its table.
      expect(JSON.stringify(after), faces.join("-")).not.toContain("bonusLadder");
      expect(JSON.stringify(after), faces.join("-")).not.toContain("ladder");
    }
  });

  it("the demonstrator is FILE-LOCAL — zero `FIXTURE_POOL` ids, the deck is 60, the Energy is the shared pool's Colorless Basic", () => {
    expect(Object.keys(LADDER_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(LADDER_DECK).toHaveLength(60);
    expect(FIXTURE_POOL[PLAIN]?.name).toBe(PLAIN);
    expect(FIXTURE_POOL["sv03-149"]).toBeUndefined();
  });
});
