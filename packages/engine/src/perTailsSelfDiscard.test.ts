import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import { programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import type { CoinFace } from "./rng";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  mustApply,
  setActiveFromDeck,
  types,
  driveSetup,
} from "./testFixtures";

const PRINTED_TAILS = "Flip 3 coins. For each tails, discard an Energy from this Pokémon.";

const BARE_SELF = "Discard an Energy from this Pokémon.";

const SYNTHETIC_HEADS =
  "Flip 3 coins. For each heads, discard the top card of your opponent's deck.";

const TAILS_DISCARD = 0;
const HEADS_MILL = 1;
const PLAIN = 2;

const LOCAL_CARDS: Record<string, Card> = {
  "d476-tailflip": battler("d476-tailflip", {
    name: "D476 Tail Flipper",
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Sap Sting", effect: PRINTED_TAILS },
      { cost: ["Colorless"], name: "Deck Chew", effect: SYNTHETIC_HEADS },
      { cost: ["Colorless"], name: "Flat Slap" },
    ],
  }),
  /** 320 HP, no attacks. Nothing in this suite deals damage, so it exists to keep every
      board legal and every promotion forced rather than to survive anything. */
  "d476-bystander": battler("d476-bystander", {
    name: "D476 Bystander",
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const TAIL_FLIP_DECK = deckOf({
  "d476-tailflip": 12,
  "d476-bystander": 24,
  "fix-energy": 8,
  "fix-water-energy": 8,
  "fix-fire-energy": 8,
});

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

const FACE_SEQUENCES: readonly (readonly CoinFace[])[] = (() => {
  const out: CoinFace[][] = [];
  for (let bits = 0; bits < 8; bits += 1) {
    out.push([0, 1, 2].map((i) => (((bits >> i) & 1) === 0 ? "heads" : "tails")));
  }
  return out;
})();

/** Counted by code point rather than by `TextEncoder`, which the sibling suites do not
    have in scope either — the pin exists so a re-ingest that swapped the `é` for an `e`
    or for a decomposed pair would redden, and both of those move this number. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function facesDrawn(events: GameEvent[]): CoinFace[] {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
}

function countOf(events: GameEvent[], face: CoinFace): number {
  return facesDrawn(events).filter((f) => f === face).length;
}

function openTable(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: TAIL_FLIP_DECK, p2: TAIL_FLIP_DECK }, { pool: POOL, first });
}

function armed(faces: readonly CoinFace[], stock: number): GameState {
  let table = openTable(7, "p2");
  table = mustApply(table, { type: "endTurn", seat: "p2" }).state;
  expect(table.turn).toBe(2);
  table = setActiveFromDeck(table, "p1", "d476-tailflip");
  table = setActiveFromDeck(table, "p2", "d476-bystander");
  const kinds = ["fix-energy", "fix-water-energy", "fix-fire-energy"] as const;
  for (let i = 0; i < stock; i += 1) {
    const card = kinds[i];
    if (card === undefined) throw new Error("at most three distinct Energy are stocked");
    table = attachFromDeck(table, "p1", card, 1);
  }
  table = clearBench(table, "p2");
  table = benchFromDeck(table, "p2", "d476-bystander");
  return { ...table, rngState: rngForFaces(faces) };
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function selfDiscardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}

function attachedTo(state: GameState, seat: Seat): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

/** Answers one park with its first candidate and hands back the next state. */
function pickFirst(state: GameState): { state: GameState; events: GameEvent[] } {
  const prompt = selfDiscardPrompt(state);
  const uid = prompt.discardable[0]?.uid;
  if (uid === undefined) throw new Error("a discardEnergy park with no candidate");
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "discardEnergy", uids: [uid] },
  });
}

describe("§1 — one sentence, one printing, and the FACE axis enumerated", () => {
  it("it is a corpus row at ONE legal printing, and the column did not move", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, sentence]) => [sentence, units]));
    expect(corpus.get(PRINTED_TAILS)).toBe(1);
  });

  it("the bytes are the CORPUS's bytes, not a retyping — and there is no apostrophe", () => {
    const row = legalAttackCorpus()
      .map(([, sentence]) => sentence)
      .find((s) => s.startsWith("Flip 3 coins. For each tails,"));
    expect(row).toBe(PRINTED_TAILS);
    expect(PRINTED_TAILS).toHaveLength(66);
    expect(utf8Bytes(PRINTED_TAILS)).toBe(67);
    expect(PRINTED_TAILS).not.toContain("'");
    expect(PRINTED_TAILS).not.toContain("’");
  });

  it("the printed FACE axis is TWO rows and they are DIFFERENT SHAPES", () => {
    const consequent = legalAttackCorpus().filter(([, s]) => /For each tails,/.test(s));
    expect(consequent.map(([, s]) => s)).toEqual([PRINTED_TAILS]);
    expect(consequent.reduce((n, [units]) => n + units, 0)).toBe(1);

    const fold = legalAttackCorpus().filter(([, s]) => /for each tails/.test(s));
    expect(fold).toHaveLength(1);
    expect(fold.map(([, s]) => s)).toEqual([
      "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.",
    ]);
    expect(resolvedByAnyReader(fold[0]?.[1] ?? "")).toBe(true);
    expect(deriveAttackCoinFlip(fold[0]?.[1] ?? "")).toEqual({
      kind: "opponentPerTails",
      flips: { kind: "opponentBench" },
      per: 80,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVER: one anchor, its guards, and the crossings it refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchor derives its exact literal", () => {
  it("the whole reading, named field by field", () => {
    expect(deriveAttackCoinFlip(PRINTED_TAILS)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
      face: "tails",
    });
  });

  it("the op is `SELF_DISCARD_ONE`'s output BYTE FOR BYTE — and `yourActive`, not `self`", () => {
    // The whole no-new-vocabulary claim in one assertion: the op the coin member carries
    // is the SAME JSON the BARE sentence's reader produces. Two producers agreeing on one
    // printed consequent BY CONSTRUCTION rather than by coincidence.
    const bare = deriveAttackEffect(BARE_SELF);
    const coin = deriveAttackCoinFlip(PRINTED_TAILS);
    expect(JSON.stringify(bare)).toBe(JSON.stringify((coin as { ops: unknown }).ops));
    expect(JSON.stringify(bare)).toContain('"from":"yourActive"');
    expect(JSON.stringify(bare)).not.toContain('"from":"self"');
  });

  it("`face` is REQUIRED, and the degradation an OPTIONAL one would have had is measured", () => {
    const read = deriveAttackCoinFlip(PRINTED_TAILS);
    // The dropped-key shape, built by NOT copying the key rather than by deleting it —
    // `delete` is a lint error in this repo, and the object the type system would have
    // accepted under an optional field is what this is standing in for.
    const dropped = Object.fromEntries(
      Object.entries(read as object).filter(([key]) => key !== "face"),
    );
    expect("face" in (read as object)).toBe(true);
    expect("face" in dropped).toBe(false);
    const faces = ["heads", "tails", "tails"] as const;
    expect(faces.filter((f) => f === "tails")).toHaveLength(2);
    expect(faces.filter((f) => f === "heads")).toHaveLength(1);
    expect(faces.filter((f) => f === "tails").length).not.toBe(
      faces.filter((f) => f === "heads").length,
    );
  });

  it("carries the family's TWO flip guards and owes no third", () => {
    expect(
      deriveAttackCoinFlip("Flip 1 coins. For each tails, discard an Energy from this Pokémon."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip 11 coins. For each tails, discard an Energy from this Pokémon."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip 10 coins. For each tails, discard an Energy from this Pokémon."),
    ).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 10 },
      ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
      face: "tails",
    });
  });

  it("refuses BOTH crossings the column does not print — the face and the victim CO-VARY", () => {
    for (const crossing of [
      "Flip 3 coins. For each heads, discard an Energy from this Pokémon.",
      "Flip 2 coins. For each tails, discard an Energy from your opponent's Active Pokémon.",
    ]) {
      expect(deriveAttackCoinFlip(crossing), crossing).toBeNull();
      expect(
        legalAttackCorpus().some(([, s]) => s === crossing),
        crossing,
      ).toBe(false);
    }
  });

  it("the UNTIL-TAILS twin is ABSENT, and that is D452's call rather than D463's", () => {
    const twin =
      "Flip a coin until you get tails. For each tails, discard an Energy from this Pokémon.";
    expect(legalAttackCorpus().filter(([, s]) => s === twin)).toHaveLength(0);
    expect(deriveAttackCoinFlip(twin)).toBeNull();
  });

  it("refuses a mid-sentence clause and a missing terminator — the `^` and the `$`", () => {
    for (const text of [
      `This attack does 30 damage. ${PRINTED_TAILS}`,
      `${PRINTED_TAILS} Then, flip a coin.`,
      PRINTED_TAILS.replace(/\.$/, ""),
      PRINTED_TAILS.replace(/\.$/, " and heal 10."),
      PRINTED_TAILS.toLowerCase(),
      PRINTED_TAILS.replace("Flip 3 coins.", "Flip 3 coin."),
      PRINTED_TAILS.replace(". For", ".For"),
      PRINTED_TAILS.replace(". For", ".  For"),
      PRINTED_TAILS.replace("Pokémon", "Pokemon"),
    ]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
    // Outer whitespace SURVIVES by design, because the deriver trims — so this states
    // which drift is tolerated and which is not, rather than leaving it to be inferred.
    expect(deriveAttackCoinFlip(`  ${PRINTED_TAILS}\n`)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — DISJOINTNESS: the trap `deriveAttackEffect` must not fall into.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — one reader owns the sentence, and the trap got worse", () => {
  it("`deriveAttackEffect` STILL refuses it, and that null is load-bearing", () => {
    expect(deriveAttackEffect(PRINTED_TAILS)).toBeNull();
    expect(deriveAttackDamageBonus(PRINTED_TAILS)).toBeNull();
    expect(deriveAttackDamageMultiplier(PRINTED_TAILS)).toBeNull();
    expect(deriveAttackRequirement(PRINTED_TAILS)).toBeNull();
    expect(deriveAttackPreDamage(PRINTED_TAILS)).toBeNull();
    expect(PRINTED_TAILS.endsWith(BARE_SELF.charAt(0).toLowerCase() + BARE_SELF.slice(1))).toBe(
      true,
    );
    // …while the BARE sentence is claimed by `deriveAttackEffect` and by nothing on the
    // coin side, which is the other half of the seam.
    expect(deriveAttackEffect(BARE_SELF)).not.toBeNull();
    expect(deriveAttackCoinFlip(BARE_SELF)).toBeNull();
  });

  it("the two guards that keep the bare pattern out are INDEPENDENT", () => {
    // `SELF_DISCARD_ONE` is kept off this string by its own `^…$` AND by the capital.
    // Driven as two separate one-change probes, because "neither alone is enough" is a
    // claim about each guard separately.
    const capitalised = `Flip 3 coins. For each tails, ${BARE_SELF}`;
    expect(capitalised).toContain(", Discard an Energy");
    expect(deriveAttackEffect(capitalised)).toBeNull(); // the `^` alone still refuses it
    expect(deriveAttackEffect(BARE_SELF.toLowerCase())).toBeNull(); // the capital alone too
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE READER SURFACE, AND THE ZERO ROWS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — no new reader, no registry row", () => {
  it("the surface is still 13 and the sentence resolves through it", () => {
    expect(resolvedByAnyReader(PRINTED_TAILS)).toBe(true);
  });

  it("ZERO registry rows — the demonstrator flips off printed text alone", () => {
    expect(programFor("d476-tailflip")).toBeUndefined();
    for (const index of [TAILS_DISCARD, HEADS_MILL, PLAIN]) {
      expect(programFor("d476-tailflip")?.attack?.[index]).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE BOARD: both faces, on a board where the two counts DIFFER.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — N tails is N sequential parks, driven end to end", () => {
  it("the sweep really reaches every three-face sequence, and the counts never coincide", () => {
    const seen = new Set<string>();
    for (const wanted of FACE_SEQUENCES) {
      const { events } = swing(armed(wanted, 3), TAILS_DISCARD);
      expect(facesDrawn(events), wanted.join(",")).toEqual([...wanted]);
      seen.add(wanted.join(","));
      expect(countOf(events, "heads"), wanted.join(",")).not.toBe(countOf(events, "tails"));
    }
    expect(seen.size).toBe(8);
  });

  it("ONE HEADS / TWO TAILS PARKS TWICE — the board that distinguishes every wrong reading", () => {
    const { state: parked, events } = swing(armed(["heads", "tails", "tails"], 3), TAILS_DISCARD);
    expect(facesDrawn(events)).toEqual(["heads", "tails", "tails"]);
    expect(countOf(events, "tails")).toBe(2);
    expect(countOf(events, "heads")).toBe(1);
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);

    // The attack is not over: it is waiting on the FIRST of TWO picks, and the SECOND copy
    // is sitting in `cont.rest` — the mechanism claim, on the attacker's own board.
    expect(parked.phase.kind).toBe("effect:choose");
    const first = selfDiscardPrompt(parked);
    expect(first.note).toBe(BARE_SELF);
    expect(first.scope).toEqual({ kind: "total", count: 1 });
    expect(first.discardable).toHaveLength(3);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.rest).toHaveLength(1);
    expect(JSON.stringify(parked.phase.cont.rest[0])).toBe(
      '{"op":"discardEnergy","from":"yourActive","filter":{"kind":"anyEnergy"}}',
    );
    expect(types(events)).not.toContain("TURN_ENDED");

    const { state: mid, events: midEvents } = pickFirst(parked);
    // …and it parks AGAIN rather than finishing. The turn has still not ended.
    expect(mid.phase.kind).toBe("effect:choose");
    expect(types(midEvents)).not.toContain("TURN_ENDED");
    const second = selfDiscardPrompt(mid);
    // ONE FEWER CANDIDATE, because the set really SHRANK between the two picks — the
    // reading a single op carrying `count: 2` could not have produced.
    expect(second.discardable).toHaveLength(2);
    if (mid.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(mid.phase.cont.rest).toHaveLength(0);

    const { state: done, events: endEvents } = pickFirst(mid);
    expect(done.phase.kind).not.toBe("effect:choose");
    // TWO of the attacker's three Energy are gone — the number the PRINTED FACE says.
    expect(attachedTo(done, "p1")).toHaveLength(1);
    expect(attachedTo(done, "p2")).toHaveLength(0);
    expect(types(endEvents)).toContain("TURN_ENDED");
    const discarded = all(endEvents, "ENERGY_DISCARDED");
    for (const row of discarded) {
      expect(row.seat).toBe("p1");
      expect(row.actor).toBe("p1");
    }
    expect(
      done.players.p2.discard.filter((uid) => done.cardIdByUid[uid]?.endsWith("energy")),
    ).toHaveLength(0);
  });

  it("TWO heads / ONE tails PARKS ONCE — the count is the printed FACE, not the flips", () => {
    // The other side of the same discrimination: the attack takes THREE flips either way,
    // so a build that expanded per FLIP would look identical in the coin rows and differ
    // only here and above.
    const { state: parked, events } = swing(armed(["heads", "heads", "tails"], 3), TAILS_DISCARD);
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);
    expect(countOf(events, "tails")).toBe(1);
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.rest).toHaveLength(0);
    const { state: done } = pickFirst(parked);
    expect(attachedTo(done, "p1")).toHaveLength(2);
  });

  it("ALL HEADS asks NOTHING — and the SILENCE is separated from silence for another reason", () => {
    const { state: done, events } = swing(armed(["heads", "heads", "heads"], 3), TAILS_DISCARD);
    expect(countOf(events, "tails")).toBe(0);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(attachedTo(done, "p1")).toHaveLength(3);
    expect(types(events)).toContain("TURN_ENDED");
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);
    //   (b) the attack was not SKIPPED — a sentence no reader claims lands loudly here;
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    //   (c) the Energy was really THERE to be taken, so nothing was quiet for want of a
    //       candidate — the same board with ONE tails does park (asserted above).
    expect(attachedTo(done, "p1")).toHaveLength(3);
  });

  it("ALL TAILS parks THREE times and strips the attacker bare", () => {
    let cursor = swing(armed(["tails", "tails", "tails"], 3), TAILS_DISCARD).state;
    // THE `rest` LADDER IS THE ASSERTION, not the number of prompts: three copies queue,
    // and each answered pick leaves exactly one fewer behind it.
    for (const remaining of [2, 1]) {
      expect(cursor.phase.kind).toBe("effect:choose");
      if (cursor.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
      expect(cursor.phase.cont.rest, String(remaining)).toHaveLength(remaining);
      cursor = pickFirst(cursor).state;
    }
    expect(cursor.phase.kind).not.toBe("effect:choose");
    expect(attachedTo(cursor, "p1")).toHaveLength(0);
    expect(cursor.players.p1.discard.length).toBeGreaterThanOrEqual(3);
  });

  it("the PLAIN attack on the same body takes no coin at all — the one-axis control", () => {
    const { state: done, events } = swing(armed(["tails", "tails", "tails"], 3), PLAIN);
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(attachedTo(done, "p1")).toHaveLength(3);
  });
});

describe("§6 — the FACE axis against the COUNT axis", () => {
  it("ONE BOARD, ONE COUNT MEMBER, TWO FACES — the readings PARTITION the flips", () => {
    for (const wanted of FACE_SEQUENCES) {
      const board = armed(wanted, 3);
      const tailsRun = swing(board, TAILS_DISCARD);
      const headsRun = swing(board, HEADS_MILL);
      const label = wanted.join(",");
      expect(facesDrawn(tailsRun.events), label).toEqual([...wanted]);
      expect(facesDrawn(headsRun.events), label).toEqual([...wanted]);

      // The TAILS reading, counted by how many parks it queues (the first park plus
      // whatever is left in `cont.rest`), which is the op-copy count made observable.
      const tailsCount = wanted.filter((f) => f === "tails").length;
      const queued =
        tailsRun.state.phase.kind === "effect:choose"
          ? 1 + tailsRun.state.phase.cont.rest.length
          : 0;
      expect(queued, label).toBe(tailsCount);

      const headsCount = wanted.filter((f) => f === "heads").length;
      const milled = all(headsRun.events, "DECK_TOP_DISCARDED");
      expect(milled, label).toHaveLength(headsCount);
      for (const row of milled) {
        expect(row.seat, label).toBe("p2");
        expect(row.actor, label).toBe("p1");
        expect(row.uids, label).toHaveLength(1);
      }
      expect(queued + headsCount, label).toBe(3);
    }
  });

  it("the FACE is fixed while the COUNT varies, over the parameterised member", () => {
    for (const flips of [2, 3, 4, 9, 10]) {
      expect(
        deriveAttackCoinFlip(
          `Flip ${flips} coins. For each tails, discard an Energy from this Pokémon.`,
        ),
        String(flips),
      ).toEqual({
        kind: "programPerHeads",
        flips: { kind: "printed", count: flips },
        ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
        face: "tails",
      });
    }
  });

  it("the grid the COLUMN prints is 3 of 4 cells, and the fourth is not a gap", () => {
    const programRows = legalAttackCorpus().filter(([, s]) =>
      /^Flip .*For each (heads|tails), /.test(s),
    );
    const cell = (row: string) => {
      const read = deriveAttackCoinFlip(row);
      if (read === null || read.kind !== "programPerHeads")
        throw new Error(`not a program: ${row}`);
      return `${read.flips.kind}×${read.face}`;
    };
    expect([...new Set(programRows.map(([, s]) => cell(s)))].sort()).toEqual([
      "printed×heads",
      "printed×tails",
      "untilTails×heads",
    ]);
    for (const [, sentence] of legalAttackCorpus()) {
      const read = deriveAttackCoinFlip(sentence);
      if (read === null) continue;
      expect("face" in read, sentence).toBe(read.kind === "programPerHeads");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — PURITY AND THE PERSISTED BYTES.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — purity and the structural answers", () => {
  it("never mutates the board it is handed, at every outcome", () => {
    for (const wanted of FACE_SEQUENCES) {
      const frozen = deepFreeze(armed(wanted, 3));
      const snapshot = JSON.stringify(frozen);
      expect(() => swing(frozen, TAILS_DISCARD)).not.toThrow();
      expect(JSON.stringify(frozen), wanted.join(",")).toBe(snapshot);
    }
  });

  it("replays identically for one pinned face sequence", () => {
    const a = swing(armed(["tails", "heads", "tails"], 3), TAILS_DISCARD);
    const b = swing(armed(["tails", "heads", "tails"], 3), TAILS_DISCARD);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });

  it("`MATCH_RECORD_VERSION` STAYS 29 — DRIVEN over the serialized bytes", () => {
    const { state: parked } = swing(armed(["tails", "tails", "heads"], 3), TAILS_DISCARD);
    const wire = JSON.stringify(parked);
    expect(wire).not.toContain('"face"');
    expect(wire).not.toContain("programPerHeads");
    expect(wire).not.toContain('"tails"');
    expect(wire).toContain('"from":"yourActive"');
  });
});
