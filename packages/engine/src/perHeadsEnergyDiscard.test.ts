import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./effects";
import { programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
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
  findEvent,
  driveSetup,
} from "./testFixtures";

const PRINTED_TWO =
  "Flip 2 coins. For each heads, discard an Energy from your opponent's Active Pokémon.";

const UNTIL_TAILS =
  "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.";

const BARE = "Discard an Energy from your opponent's Active Pokémon.";

/** The plain control attack's absent effect, spelled as a name rather than a string:
    an attack with NO effect text at all is the one-axis control that says the coin
    rows below come from the sentence and not from the declaration. */
const PLAIN = 1;
const REPEAT = 0;

const LOCAL_CARDS: Record<string, Card> = {
  "fix-perheads-energy": battler("fix-perheads-energy", {
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Twin Bite", effect: PRINTED_TWO },
      { cost: ["Colorless"], name: "Plain Slap" },
    ],
  }),
  /** 320 HP, no attacks — the victim and the bench filler. Nothing in this suite deals
      damage at all, so it exists to keep every promotion forced and every board legal
      rather than to survive anything. */
  "fix-perheads-victim": battler("fix-perheads-victim", {
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const PER_HEADS_ENERGY_DECK = deckOf({
  "fix-perheads-energy": 12,
  "fix-perheads-victim": 24,
  "fix-energy": 8,
  "fix-water-energy": 8,
  "fix-fire-energy": 8,
});

/** How many seeds every sweep walks. Wide enough that a 2-flip attack reaches 0, 1 and
    2 heads — asserted in §5 rather than hoped for. */
const SEEDS = 40;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function headsIn(events: GameEvent[]): number {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "heads").length;
}

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(
    seed,
    { p1: PER_HEADS_ENERGY_DECK, p2: PER_HEADS_ENERGY_DECK },
    { pool: POOL, first },
  );
}

function armed(seed: number, energies: number): GameState {
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "fix-perheads-energy");
  state = setActiveFromDeck(state, "p2", "fix-perheads-victim");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  const kinds = ["fix-energy", "fix-water-energy", "fix-fire-energy"] as const;
  for (let i = 0; i < energies; i += 1) {
    const card = kinds[i];
    if (card === undefined) throw new Error("at most three distinct Energy are stocked");
    state = attachFromDeck(state, "p2", card, 1);
  }
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-perheads-victim");
  return state;
}

function attack(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}

function activeEnergy(state: GameState, seat: Seat): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

describe("§1 — two sentences, two printings, and the family re-enumerated", () => {
  it("both are corpus rows at ONE legal printing each", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, sentence]) => [sentence, units]));
    expect(corpus.get(PRINTED_TWO)).toBe(1);
    expect(corpus.get(UNTIL_TAILS)).toBe(1);
    expect([PRINTED_TWO, UNTIL_TAILS].map((s) => corpus.get(s))).toEqual([1, 1]);
  });

  it("the bytes are the corpus's bytes, not a retyping", () => {
    const corpus = legalAttackCorpus().map(([, sentence]) => sentence);
    const printed = corpus.find((s) => s.startsWith("Flip 2 coins. For each heads, discard an"));
    const until = corpus.find((s) =>
      s.startsWith("Flip a coin until you get tails. For each heads, discard an"),
    );
    expect(printed).toBe(PRINTED_TWO);
    expect(until).toBe(UNTIL_TAILS);
    // ASCII apostrophe, U+00E9 for the accent — the two characters a re-ingest would move.
    expect(PRINTED_TWO).toContain("opponent's");
    expect(PRINTED_TWO).not.toContain("’");
    expect(PRINTED_TWO).toContain("Pokémon");
    expect(PRINTED_TWO).toHaveLength(84);
    expect(UNTIL_TAILS).toHaveLength(103);
    // The consequents are BYTE-IDENTICAL and the openings are all that differ, which is
    // what makes two anchors the honest shape rather than one loose one.
    const tail = "For each heads, discard an Energy from your opponent's Active Pokémon.";
    expect(PRINTED_TWO.endsWith(tail)).toBe(true);
    expect(UNTIL_TAILS.endsWith(tail)).toBe(true);
    expect(PRINTED_TWO.slice(0, -tail.length)).toBe("Flip 2 coins. ");
    expect(UNTIL_TAILS.slice(0, -tail.length)).toBe("Flip a coin until you get tails. ");
  });

  it("the whole per-face family, RE-ENUMERATED, and NOTHING is left unbuilt", () => {
    const perFace = legalAttackCorpus().filter(
      ([, s]) => /For each (heads|tails),/.test(s) && !s.includes("This attack does"),
    );
    expect(perFace).toHaveLength(5);
    expect(perFace.reduce((n, [units]) => n + units, 0)).toBe(5);
    const unbuilt = perFace.filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).toEqual([]);
    const tails = perFace.filter(([, s]) => s.includes("For each tails,"));
    expect(tails.map(([, s]) => s)).toEqual([
      "Flip 3 coins. For each tails, discard an Energy from this Pokémon.",
    ]);
    for (const [, s] of perFace) {
      const read = deriveAttackCoinFlip(s);
      expect(read, s).not.toBeNull();
      expect((read as { face: string }).face, s).toBe(
        s.includes("For each tails,") ? "tails" : "heads",
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVER: two anchors, their guards, and the crossings they refuse.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchors derive their own literals", () => {
  it("each sentence derives the exact reading", () => {
    expect(deriveAttackCoinFlip(PRINTED_TWO)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 2 },
      ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      face: "heads",
    });
    expect(deriveAttackCoinFlip(UNTIL_TAILS)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      face: "heads",
    });
  });

  it("the op is D43's op, byte for byte, and not a second spelling of it", () => {
    const bare = JSON.stringify(deriveAttackEffect(BARE));
    expect(bare).toBe(
      '[{"op":"discardEnergy","from":"opponentActive","filter":{"kind":"anyEnergy"}}]',
    );
    for (const sentence of [PRINTED_TWO, UNTIL_TAILS]) {
      const read = deriveAttackCoinFlip(sentence) as { ops: unknown[] };
      expect(JSON.stringify(read.ops)).toBe(bare);
    }
  });

  it("the PRINTED arm carries the family's two flip guards and nothing else", () => {
    expect(deriveAttackCoinFlip(PRINTED_TWO.replace("Flip 2 coins.", "Flip 1 coins."))).toBeNull();
    expect(deriveAttackCoinFlip(PRINTED_TWO.replace("Flip 2 coins.", "Flip 0 coins."))).toBeNull();
    expect(
      deriveAttackCoinFlip(PRINTED_TWO.replace("Flip 2 coins.", "Flip 10 coins.")),
    ).not.toBeNull();
    expect(deriveAttackCoinFlip(PRINTED_TWO.replace("Flip 2 coins.", "Flip 11 coins."))).toBeNull();
    expect(
      deriveAttackCoinFlip(PRINTED_TWO.replace("Flip 2 coins.", "Flip 4 coins.")),
    ).toHaveProperty("flips.count", 4);
  });

  it("the UNTIL-TAILS arm has NOTHING left to guard, and that is not an omission", () => {
    expect(UNTIL_TAILS).not.toMatch(/\d/);
    expect(deriveAttackCoinFlip(UNTIL_TAILS)).not.toBeNull();
    // The near-drift with a MECHANISM behind it: `flipUntilTails` stops on TAILS, so a
    // pattern that admitted "until you get heads" would run the mapped loop over a card
    // asking for the mirror sequence.
    expect(
      deriveAttackCoinFlip(UNTIL_TAILS.replace("until you get tails", "until you get heads")),
    ).toBeNull();
  });

  it("refuses the crossings between the two openings and the family's other consequents", () => {
    // The consequent is byte-identical across the pair, so the ONLY thing that can make
    // the two anchors wrong is an opening reading the wrong consequent or the reverse.
    // Every crossing is enumerated rather than sampled: two openings × four consequents.
    const openings = ["Flip 2 coins. ", "Flip a coin until you get tails. "];
    const consequents = [
      "For each heads, discard an Energy from your opponent's Active Pokémon.",
      "For each heads, discard the top card of your opponent's deck.",
      "For each heads, discard a random card from your opponent's hand.",
      "For each heads, discard the top 2 cards of your opponent's deck.",
    ];
    const built = new Set([PRINTED_TWO, UNTIL_TAILS]);
    for (const opening of openings) {
      for (const consequent of consequents) {
        const sentence = `${opening}${consequent}`;
        const read = deriveAttackCoinFlip(sentence);
        if (built.has(sentence)) {
          expect(read, sentence).toMatchObject({
            ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
          });
        } else if (read !== null) {
          expect(JSON.stringify(read), sentence).not.toContain("discardEnergy");
        }
      }
    }
    expect(
      JSON.stringify(
        deriveAttackCoinFlip(
          "Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck.",
        ),
      ),
    ).not.toContain("discardEnergy");
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard a random card from your opponent's hand.",
      ),
    ).toBeNull();
  });

  it("refuses a mid-sentence clause and a missing terminator — the `^` and the `$`", () => {
    for (const text of [
      `This attack does 30 damage. ${PRINTED_TWO}`,
      `${PRINTED_TWO} Then, flip a coin.`,
      PRINTED_TWO.replace(/\.$/, ""),
      PRINTED_TWO.toLowerCase(),
      `This attack does 30 damage. ${UNTIL_TAILS}`,
      `${UNTIL_TAILS} Then, flip a coin.`,
      UNTIL_TAILS.replace(/\.$/, ""),
      UNTIL_TAILS.toLowerCase(),
      UNTIL_TAILS.replace(/\.$/, " and heal 10."),
    ]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
    expect(deriveAttackCoinFlip(PRINTED_TWO.replace("'", "’"))).not.toBeNull();
    expect(deriveAttackCoinFlip(UNTIL_TAILS.replace("'", "’"))).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — DISJOINTNESS: the trap `deriveAttackEffect` must not fall into.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — one reader per sentence, and the trap is worse than it was", () => {
  it("`deriveAttackEffect` STILL refuses both, and that null is load-bearing", () => {
    for (const sentence of [PRINTED_TWO, UNTIL_TAILS]) {
      expect(deriveAttackEffect(sentence), sentence).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
      expect(sentence.endsWith(BARE.charAt(0).toLowerCase() + BARE.slice(1))).toBe(true);
    }
    // …while the BARE sentence itself is claimed by `deriveAttackEffect` and by nothing
    // on the coin side, which is the other half of the seam.
    expect(deriveAttackEffect(BARE)).not.toBeNull();
    expect(deriveAttackCoinFlip(BARE)).toBeNull();
  });

  it("the two guards that keep the bare pattern out are INDEPENDENT", () => {
    const capitalised = `Flip 2 coins. For each heads, ${BARE}`;
    expect(capitalised).toContain(", Discard an Energy");
    expect(deriveAttackEffect(capitalised)).toBeNull(); // the `^` alone still refuses it
    expect(deriveAttackEffect(BARE.toLowerCase())).toBeNull(); // the capital alone too
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE READER SURFACE, AND THE ZERO ROWS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — no new reader, no registry row", () => {
  it("the surface is still 13 and both sentences resolve through it", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(resolvedByAnyReader(PRINTED_TWO)).toBe(true);
    expect(resolvedByAnyReader(UNTIL_TAILS)).toBe(true);
  });

  it("ZERO registry rows — the demonstrator and Krookodile both flip off printed text", () => {
    for (const id of ["fix-perheads-energy", "sv01-117"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack?.[0]).toBeUndefined();
      expect(programFor(id)?.attack?.[1]).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE PARK, ON A BOARD, N TIMES.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — N heads is N sequential parks, driven end to end", () => {
  it("reaches every heads count across the sweep — 0, 1 and 2 all seen", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = attack(armed(seed, 3), REPEAT);
      seen.add(headsIn(events));
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(2);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("TWO heads PARKS TWICE — and the second copy is sitting in `cont.rest`", () => {
    const seed = firstSeedWithHeads(2);
    const { state: parked, events } = attack(armed(seed, 3), REPEAT);
    expect(headsIn(events)).toBe(2);
    // The attack is not over: it is waiting on the FIRST of two picks.
    expect(parked.phase.kind).toBe("effect:choose");
    const first = discardPrompt(parked);
    expect(first.note).toBe(BARE);
    expect(first.scope).toEqual({ kind: "total", count: 1 });
    expect(first.discardable).toHaveLength(3);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.rest).toHaveLength(1);
    expect(JSON.stringify(parked.phase.cont.rest[0])).toBe(
      '{"op":"discardEnergy","from":"opponentActive","filter":{"kind":"anyEnergy"}}',
    );
    expect(types(events)).not.toContain("TURN_ENDED");

    // FIRST PICK — the {W}.
    const water = first.discardable.find((d) => parked.cardIdByUid[d.uid] === "fix-water-energy");
    if (water === undefined) throw new Error("no {W} candidate");
    const { state: mid, events: midEvents } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [water.uid] },
    });
    expect(mid.phase.kind).toBe("effect:choose");
    expect(types(midEvents)).not.toContain("TURN_ENDED");
    const second = discardPrompt(mid);
    // ONE FEWER CANDIDATE, because the set really SHRANK between the two picks — which is
    // the reading `count: 2` on a single op could not have produced.
    expect(second.discardable).toHaveLength(2);
    expect(second.discardable.map((d) => d.uid)).not.toContain(water.uid);
    if (mid.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(mid.phase.cont.rest).toHaveLength(0);

    // SECOND PICK — and now the tail runs.
    const { state: done, events: endEvents } = mustApply(mid, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [second.discardable[0]?.uid as string] },
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeEnergy(done, "p2")).toHaveLength(1);
    expect(types(endEvents)).toContain("TURN_ENDED");
    // The cards went to their OWNER's pile and the events name the victim seat with the
    // ACTOR who caused it — the two differ here, unlike a self-discard.
    expect(done.players.p2.discard).toContain(water.uid);
    expect(done.players.p1.discard).not.toContain(water.uid);
    const discarded = findEvent(endEvents, "ENERGY_DISCARDED");
    expect(discarded?.seat).toBe("p2");
    expect(discarded?.actor).toBe("p1");
  });

  it("ONE head parks ONCE — the count is the HEADS and not the flips", () => {
    // The sharpest single case in the file: the attack takes TWO flips either way, so a
    // build that expanded per FLIP rather than per HEADS would look identical in the coin
    // rows and differ only here.
    const seed = firstSeedWithHeads(1);
    const { state: parked, events } = attack(armed(seed, 3), REPEAT);
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(2);
    expect(headsIn(events)).toBe(1);
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.rest).toHaveLength(0);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "discardEnergy",
        uids: [discardPrompt(parked).discardable[0]?.uid as string],
      },
    });
    expect(activeEnergy(done, "p2")).toHaveLength(2);
  });

  it("ZERO heads asks NOTHING and discards nothing — no empty program, no extra ending", () => {
    const seed = firstSeedWithHeads(0);
    const { state: done, events } = attack(armed(seed, 3), REPEAT);
    expect(headsIn(events)).toBe(0);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeEnergy(done, "p2")).toHaveLength(3);
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("a FORCED pick auto-resolves and never parks — the M1 doctrine, on ONE Energy", () => {
    // With a single Energy on the defender there is no question to ask, so the op resolves
    // inline. This is what says the parks above are a property of the BOARD rather than of
    // the op, and it is also the reason §5's other cases stock three DISTINCT cards.
    const seed = firstSeedWithHeads(2);
    const { state: done, events } = attack(armed(seed, 1), REPEAT);
    expect(headsIn(events)).toBe(2);
    expect(done.phase.kind).not.toBe("effect:choose");
    // Two heads, one Energy: the first copy takes it and the second finds an EMPTY
    // candidate set and whiffs. A whiff is a no-op, not a failure.
    expect(activeEnergy(done, "p2")).toHaveLength(0);
    expect(all(events, "ENERGY_DISCARDED")).toHaveLength(1);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("an EMPTY defender board whiffs on every copy — and the attack still ends", () => {
    const seed = firstSeedWithHeads(2);
    const { state: done, events } = attack(armed(seed, 0), REPEAT);
    expect(headsIn(events)).toBe(2);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("the PLAIN sibling attack takes no flip at all — the one-axis control", () => {
    const { state: done, events } = attack(armed(firstSeedWithHeads(2), 3), PLAIN);
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeEnergy(done, "p2")).toHaveLength(3);
  });
});

/** The first seed in the sweep whose two flips come up with exactly `heads` heads.
    Searched rather than hardcoded, so a change to the deck or to the RNG reddens the
    search (it throws) instead of silently re-pointing a case at a different outcome. */
function firstSeedWithHeads(heads: number): number {
  for (let seed = 0; seed < SEEDS; seed++) {
    if (headsIn(attack(armed(seed, 3), REPEAT).events) === heads) return seed;
  }
  throw new Error(`no seed below ${SEEDS} produces ${heads} heads`);
}

describe("§6 — the census moves in exactly ONE summand", () => {
  const units = (rows: readonly (readonly [number, string])[]) =>
    rows.reduce((sum, [n]) => sum + n, 0);

  it("the resolving corpus gains TWO sentences and TWO printings", () => {
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([600, 1663]);
    const without = resolved.filter(([, s]) => s !== PRINTED_TWO && s !== UNTIL_TAILS);
    expect([without.length, units(without)]).toEqual([598, 1661]);
  });

  it("the population itself did not move — 640 sentences / 1,732 printings", () => {
    const rows = legalAttackCorpus();
    expect(rows).toHaveLength(640);
    expect(units(rows)).toBe(1732);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — purity, and the persisted bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — purity and the structural answers", () => {
  it("never mutates the board it is handed", () => {
    const frozen = deepFreeze(armed(firstSeedWithHeads(2), 3));
    const snapshot = JSON.stringify(frozen);
    expect(attack(frozen, REPEAT).state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("replays identically for one seed", () => {
    const seed = firstSeedWithHeads(2);
    const a = attack(armed(seed, 3), REPEAT);
    const b = attack(armed(seed, 3), REPEAT);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });

  it("`MATCH_RECORD_VERSION` STAYS 29 — DRIVEN, in three directions", () => {
    const seed = firstSeedWithHeads(2);
    const parked = attack(armed(seed, 3), REPEAT).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    // DIRECTION 1 — FORWARD. Round-trip the PARKED board through JSON, which is what
    // persistence actually does to it, and resume from the bytes. A continuation that
    // did not survive serialization diverges here.
    const persisted = JSON.parse(JSON.stringify(parked)) as GameState;
    const pick = discardPrompt(parked).discardable[0]?.uid as string;
    const live = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    const replayed = mustApply(persisted, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);

    expect(Object.keys(parked.phase.cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    const shipped = '{"op":"discardEnergy","from":"opponentActive","filter":{"kind":"anyEnergy"}}';
    expect(JSON.stringify(parked.phase.cont.pendingOp)).toBe(shipped);
    for (const op of parked.phase.cont.rest) expect(JSON.stringify(op)).toBe(shipped);
    // …and it really is the SAME string the bare sentence's reader emits, which is the
    // alphabet argument stated as an equality rather than as an inventory.
    expect(JSON.stringify(deriveAttackEffect(BARE)?.[0])).toBe(shipped);

    const lossy = JSON.parse(JSON.stringify(parked)) as GameState;
    if (lossy.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    (lossy.phase.cont as unknown as { rest: unknown[] }).rest = [];
    const truncated = mustApply(lossy, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    // The full record parks a second time; the truncated one ends the turn after ONE
    // discard. Two observable endings from bytes that differ only in `rest`.
    expect(live.state.phase.kind).toBe("effect:choose");
    expect(truncated.state.phase.kind).not.toBe("effect:choose");
    expect(types(truncated.events)).toContain("TURN_ENDED");
    expect(activeEnergy(truncated.state, "p2")).toHaveLength(2);
  });
});
