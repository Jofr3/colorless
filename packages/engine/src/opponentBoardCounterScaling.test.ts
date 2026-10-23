import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countDamageCountersInPlay } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
} from "./effects";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The printed bytes
// ─────────────────────────────────────────────────────────────────────────────

const BOARD_COUNTERS =
  "This attack does 10 more damage for each damage counter on all of your opponent's Pokémon.";

const ACTIVE_COUNTERS =
  "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.";

/** The shipped SELF-side sibling (M2) — the same resource off the attacking body.
    It is what makes §4's zero-match board distinguishable from a dead reader: on
    the very board where `BOARD_COUNTERS` adds nothing, this one adds 40. */
const SELF_COUNTERS = "This attack does 10 more damage for each damage counter on this Pokémon.";

const BOARD_COUNTERS_MULTIPLY =
  "This attack does 10 damage for each damage counter on all of your opponent's Pokémon.";

/** U+2019, spelled as an escape — the two apostrophes render nearly identically,
    so the curly one is always written where a reader can see it. */
const RSQUO = "’";

const BOARD_COUNTERS_FILE_LINE = 534;

// ─────────────────────────────────────────────────────────────────────────────
// The board
// ─────────────────────────────────────────────────────────────────────────────

const ATTACKER: Card = battler("fix-boardcounter", {
  name: "Fixadraft",
  hp: 200,
  types: ["Colorless"],
  attacks: [
    { cost: ["Colorless"], name: "Board Bite", damage: 10, effect: BOARD_COUNTERS },
    { cost: ["Colorless"], name: "Active Bite", damage: 10, effect: ACTIVE_COUNTERS },
    { cost: ["Colorless"], name: "Self Bite", damage: 10, effect: SELF_COUNTERS },
    { cost: ["Colorless"], name: "Plain Bite", damage: 10 },
  ],
});

const LOCAL_CARDS: Record<string, Card> = { "fix-boardcounter": ATTACKER };
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-boardcounter": 2,
  "fix-titan": 4,
  "fix-basic-1": 8,
  "fix-lightning-1": 6,
  "fix-energy": 40,
});

/** Attack indices on `fix-boardcounter`, named rather than remembered (§1 pins
    each against the fixture's own `attacks` array). */
const BOARD = 0;
const ACTIVE = 1;
const SELF = 2;
const PLAIN = 3;

const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
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

function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(localSetup(SEED, by === "p1" ? "p2" : "p1"), { type: "endTurn", seat: foe }),
  );
  state = setActiveFromDeck(state, by, "fix-boardcounter");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  state = clearBench(state, foe);
  // Three benched bodies on the FOE and one on the attacker — the populations every
  // board below sets damage into. `fix-basic-1` is 60 HP (never KO'd by the numbers
  // used here) and `fix-titan` is 340.
  state = benchFromDeck(state, foe, "fix-basic-1");
  state = benchFromDeck(state, foe, "fix-basic-1");
  state = benchFromDeck(state, foe, "fix-basic-1");
  return benchFromDeck(state, by, "fix-titan");
}

function mixed(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = setDamage(bare(by), by, 40);
  state = setBenchDamage(state, by, 0, 70);
  state = setDamage(state, foe, 50);
  state = setBenchDamage(state, foe, 0, 20);
  state = setBenchDamage(state, foe, 1, 15);
  return setBenchDamage(state, foe, 2, 15);
}

function zeroMatch(by: Seat = "p1"): GameState {
  const state = setDamage(bare(by), by, 40);
  return setBenchDamage(state, by, 0, 70);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

describe("§1 — the sentence, its corpus row, and the fixture that prints it", () => {
  it("is corpus FILE LINE 534, ONE sentence and ONE Standard-legal printing", () => {
    const corpus = legalAttackCorpus();
    const row = corpus.find(([, s]) => s === BOARD_COUNTERS);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(1);
    expect(corpus.indexOf(row as (typeof corpus)[number]) + 53).toBe(BOARD_COUNTERS_FILE_LINE);
  });

  it("the possessive is ASCII U+0027 and the é is U+00E9 — on the BYTES", () => {
    expect(BOARD_COUNTERS).toContain("opponent's");
    expect(BOARD_COUNTERS).not.toContain(RSQUO);
    expect(BOARD_COUNTERS).toContain("Pokémon");
    expect(BOARD_COUNTERS.charCodeAt(BOARD_COUNTERS.indexOf("opponent") + 8)).toBe(0x27);
  });

  it("the corpus row was UNREAD before this slice and is READ after it", () => {
    expect(resolvedByAnyReader(BOARD_COUNTERS)).toBe(true);
  });

  it("the fixture prints all four sentences at the indices this file names", () => {
    const attacks = ATTACKER.attacks ?? [];
    expect(attacks[BOARD]?.effect).toBe(BOARD_COUNTERS);
    expect(attacks[ACTIVE]?.effect).toBe(ACTIVE_COUNTERS);
    expect(attacks[SELF]?.effect).toBe(SELF_COUNTERS);
    expect(attacks[PLAIN]?.effect).toBeUndefined();
    // …and all four print the SAME base, so §3's differences are the clause's.
    expect(attacks.map((a) => a.damage)).toEqual([10, 10, 10, 10]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE READER
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — `deriveAttackDamageBonus` reads it as `damageCountersOnOpponentBoard`", () => {
  it("reads the anchored sentence for any N", () => {
    expect(deriveAttackDamageBonus(BOARD_COUNTERS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnOpponentBoard" },
    });
    // Not hard-coded to 10 — the per-counter amount is captured.
    for (const per of [20, 30, 100]) {
      expect(
        deriveAttackDamageBonus(
          `This attack does ${per} more damage for each damage counter on all of your opponent's Pokémon.`,
        ),
      ).toEqual({ per, count: { kind: "damageCountersOnOpponentBoard" } });
    }
  });

  it("the `['’]` possessive class is load-bearing — the curly form reads the same", () => {
    expect(deriveAttackDamageBonus(BOARD_COUNTERS.replace("'", RSQUO))).toEqual({
      per: 10,
      count: { kind: "damageCountersOnOpponentBoard" },
    });
  });

  it("the two SHIPPED siblings still land on their OWN members", () => {
    // The sharpest thing that can go wrong with a third reading of one printed noun
    // is one arm absorbing another's sentences. Both directions, on one page.
    expect(deriveAttackDamageBonus(ACTIVE_COUNTERS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnOpponentActive" },
    });
    expect(deriveAttackDamageBonus(SELF_COUNTERS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("the DISJOINTNESS is STRUCTURAL — no string matches both anchors", () => {
    for (const [, sentence] of legalAttackCorpus()) {
      const bonus = deriveAttackDamageBonus(sentence);
      if (bonus === null) continue;
      const board = bonus.count.kind === "damageCountersOnOpponentBoard";
      const active = bonus.count.kind === "damageCountersOnOpponentActive";
      expect(board && active, sentence).toBe(false);
    }
    // …and on the two specimens the ONE differing run of bytes is named, so a
    // successor that widens either anchor sees which byte the claim rests on.
    expect(BOARD_COUNTERS.replace("all of your opponent's", "your opponent's Active")).toBe(
      ACTIVE_COUNTERS,
    );
  });

  it("refuses the near-misses — the anchors and the capital are load-bearing", () => {
    for (const text of [
      // A lowercase leading "this" is refused independently of the anchors — the
      // family's Krookodile convention, no /i.
      BOARD_COUNTERS.replace("This", "this"),
      // A missing trailing period is not the whole sentence.
      BOARD_COUNTERS.slice(0, -1),
      // Leading text: a mid-sentence clause must not reach this path. This is the
      // case the `^` anchor owns, and it is the only one that can see it.
      `Discard an Energy from this Pokémon. ${BOARD_COUNTERS}`,
      `${BOARD_COUNTERS} This attack's damage isn't affected by Weakness.`,
      // The `×` fold — no "more", so this reader must refuse it.
      BOARD_COUNTERS_MULTIPLY,
      // A printed 0 adds nothing and stays on the loud skipped path.
      BOARD_COUNTERS.replace("does 10", "does 0"),
      BOARD_COUNTERS.replace("all of your opponent's", "all of your"),
      // The Bench-scoped spelling belongs to `damageCountersOnYourBench`'s family.
      BOARD_COUNTERS.replace("all of your opponent's", "all of your Benched"),
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });

  it("the OTHER TWO readers of the same text refuse it", () => {
    expect(deriveAttackDamageMultiplier(BOARD_COUNTERS)).toBeNull();
    expect(deriveAttackDamagePenalty(BOARD_COUNTERS)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE FOLD ON A REAL BOARD
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the additive fold on real boards: base KEPT, `per × counters` added", () => {
  it("the MIXED board deals 100 — base 10 + 9 counters × 10", () => {
    const { state, events } = swing(mixed(), BOARD);
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 10, scaled: 90, dealt: 100 });
    // …and the damage really landed: the defender was on 50 and is now on 150.
    expect(state.players.p2.active?.damage).toBe(150);
  });

  it("every plausible misread answers a DIFFERENT number on that ONE board", () => {
    // The whole point of the two 15s and the 40/70 on the attacker's own side. Each
    // line is what `dealt` would have been under one wrong implementation; the
    // assertion is that the shipped one is none of them.
    const dealt = find(swing(mixed(), BOARD).events, "DAMAGE_DEALT")?.dealt;
    expect(dealt).toBe(100); //          9 counters — the defender's whole board
    expect(dealt).not.toBe(50); //       4 — the defender's BENCH alone
    expect(dealt).not.toBe(60); //       5 — the defender's ACTIVE alone
    expect(dealt).not.toBe(120); //     11 — the ATTACKER's board (seat inverted)
    expect(dealt).not.toBe(80); //       7 — the ATTACKER's bench alone
    expect(dealt).not.toBe(110); //     10 — summed first, floored once
  });

  it("the ACTIVE is INSIDE the walk — the two half-boards agree, and neither sibling does", () => {
    const activeOnly = setDamage(bare(), "p2", 30);
    let benchOnly = setBenchDamage(bare(), "p2", 0, 20);
    benchOnly = setBenchDamage(benchOnly, "p2", 1, 10);

    expect(find(swing(activeOnly, BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(40);
    expect(find(swing(benchOnly, BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(40);
    // …and the SHIPPED Active-only member tells them apart, which is the proof that
    // the two boards are genuinely different and not the same board twice.
    expect(find(swing(activeOnly, ACTIVE).events, "DAMAGE_DEALT")?.dealt).toBe(40);
    expect(find(swing(benchOnly, ACTIVE).events, "DAMAGE_DEALT")?.dealt).toBe(10);
  });

  it("FLOORED PER BODY, then summed — not summed and then floored", () => {
    let board = setBenchDamage(bare(), "p2", 0, 15);
    board = setBenchDamage(board, "p2", 1, 15);
    expect(find(swing(board, BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("the printed base is KEPT — this is the `+` fold and not the `×` one", () => {
    // A `+`/`×` mix-up is invisible on a board with counters and screams on one
    // without: the multiply fold DROPS the printed base. §4's pristine board is the
    // other half of this pair.
    const row = find(swing(mixed(), BOARD).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(10);
    expect((row?.base ?? 0) + (row?.scaled ?? 0)).toBe(row?.dealt);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE ZERO-MATCH BOARD AND ITS CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the ZERO-MATCH board, and three controls that make the 0 mean something", () => {
  it("a PRISTINE opponent board adds nothing and the base lands whole", () => {
    const { state, events } = swing(zeroMatch(), BOARD);
    const row = find(events, "DAMAGE_DEALT");
    // `scaled` is ABSENT, not 0 — the field's presence guard is `scaledTotal > 0`.
    expect(row).toMatchObject({ base: 10, dealt: 10 });
    expect(row?.scaled).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(10);
  });

  it("CONTROL 1 — the SAME board with one counter added is not silent", () => {
    // Without this the 0 above is indistinguishable from a reader that never fired.
    expect(find(swing(setDamage(zeroMatch(), "p2", 10), BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(
      20,
    );
    // …and one counter on the opponent's BENCH moves it too, so the 0 is not
    // "the Active was pristine" wearing a board's clothes.
    expect(
      find(swing(setBenchDamage(zeroMatch(), "p2", 2, 10), BOARD).events, "DAMAGE_DEALT")?.dealt,
    ).toBe(20);
  });

  it("CONTROL 2 — a SIBLING clause on that very board adds 40, so the board is not inert", () => {
    // The zero-match board carries 40 damage on the attacker and 70 on its Bench.
    // `damageCountersOnSelf` reads the first and answers 4; if the board itself were
    // somehow silent — a broken swing, a mis-set fixture — this would be 10 too.
    expect(find(swing(zeroMatch(), SELF).events, "DAMAGE_DEALT")?.dealt).toBe(50);
  });

  it("CONTROL 3 — the CLAUSELESS attack is base-only on the MIXED board", () => {
    // The converse control: on the board where `BOARD_COUNTERS` adds 90, an attack
    // with no effect text at all adds nothing. So the 90 is the CLAUSE and not the
    // board, and the 0 above is the BOARD and not the clause.
    const row = find(swing(mixed(), PLAIN).events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 10, dealt: 10 });
    expect(row?.scaled).toBeUndefined();
  });

  it("an EMPTY opponent Bench is silent for a DIFFERENT reason than a pristine one", () => {
    const swept = setDamage(clearBench(bare(), "p2"), "p2", 30);
    expect(swept.players.p2.bench).toHaveLength(0);
    expect(find(swing(swept, BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE SEAT
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the seat: `defenderSeat`, driven from both ends of the table", () => {
  it("the ATTACKER's own counters contribute NOTHING", () => {
    // The zero-match board is 11 counters of the attacker's own — 4 on the body and
    // 7 on its Bench — and this clause reads none of them. A `attackerSeat`
    // substitution turns the 10 below into 120.
    expect(find(swing(zeroMatch(), BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(10);
  });

  it("is CONTROLLER-RELATIVE — p2 swinging reads p1's board, not p1 always", () => {
    const { events } = swing(mixed("p2"), BOARD, "p2");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 90, dealt: 100 });
  });

  it("the shipped neighbour's seat is UNMOVED by the new arm", () => {
    expect(find(swing(mixed(), ACTIVE).events, "DAMAGE_DEALT")?.dealt).toBe(60);
  });
});

describe("§6 — the cells this slice leaves EMPTY are measurements, not omissions", () => {
  it("the `×` spelling of this sentence is printed ZERO times", () => {
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /^This attack does \d+ damage for each damage counter on all of your opponent['’]s Pokémon\.$/.test(
          s,
        ),
      ),
    ).toEqual([]);
    expect(deriveAttackDamageMultiplier(BOARD_COUNTERS_MULTIPLY)).toBeNull();
    expect(deriveAttackDamageBonus(BOARD_COUNTERS_MULTIPLY)).toBeNull();
  });

  it("the `less` spelling is printed ZERO times too", () => {
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /less damage for each damage counter on all of your opponent/.test(s),
      ),
    ).toEqual([]);
  });

  it("the ATTACKER-side board spelling is printed ZERO times", () => {
    expect(
      legalAttackCorpus().filter(([, s]) => /damage counter on all of your Pokémon\./.test(s)),
    ).toEqual([]);
  });

  it("the whole of `damage counter on all of` is FOUR rows, and three were already read", () => {
    const rows = legalAttackCorpus()
      .filter(([, s]) => s.includes("damage counter on all of"))
      .map(([, s]) => s);
    expect(rows).toHaveLength(3);
    expect(rows).toContain(BOARD_COUNTERS);
    expect(rows.filter((s) => resolvedByAnyReader(s))).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE SHARED BOARD COUNTER
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — `countDamageCountersInPlay`, driven directly", () => {
  it("counts Active + Bench, floored per body", () => {
    const state = mixed();
    expect(countDamageCountersInPlay(state, "p2")).toBe(9);
    expect(countDamageCountersInPlay(state, "p1")).toBe(11);
  });

  it("a pristine board is 0 and an empty one is 0 — the same number, two facts", () => {
    expect(countDamageCountersInPlay(bare(), "p2")).toBe(0);
    const swept = clearBench(bare(), "p2");
    expect(countDamageCountersInPlay(swept, "p2")).toBe(0);
    expect(countDamageCountersInPlay(setDamage(swept, "p2", 30), "p2")).toBe(3);
  });

  it("a MISSING Active is handled inside the walk", () => {
    // The live attack gate guarantees a Defending Pokémon, so no board reachable
    // through `attack` presents this — but the helper is shared and its two
    // neighbours both answer for it, so this one does too.
    const headless: GameState = {
      ...mixed(),
      players: {
        ...mixed().players,
        p2: { ...mixed().players.p2, active: null },
      },
    };
    expect(countDamageCountersInPlay(headless, "p2")).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED QUESTION AND THE VERSION
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — `MATCH_RECORD_VERSION` STAYS 29, driven over the bytes", () => {
  it("DIRECTION 1 — there is NO CARRIER AT ALL", () => {
    const before = mixed();
    const after = swing(before, BOARD).state;
    for (const [label, state] of [
      ["before", before],
      ["after", after],
    ] as const) {
      const wire = JSON.stringify(state);
      expect(wire, label).not.toContain("damageCountersOnOpponentBoard");
      expect(wire, label).not.toContain("damageCountersOnOpponentActive");
    }
    // …and the attack RESOLVED IN ONE ACTION — no park, nothing for a later deploy
    // to resume.
    expect(after.pending).toEqual([]);
  });

  it("DIRECTION 2 — a v29 record round-trips and the NEXT swing reads the same", () => {
    const first = swing(mixed(), BOARD);
    expect(find(first.events, "DAMAGE_DEALT")?.dealt).toBe(100);
    const saved = JSON.parse(JSON.stringify(first.state)) as GameState;
    expect(saved).toEqual(first.state);
    // …and the parsed record is a LIVE board: hand the turn back and swing the same
    // clause off the bytes that came out of `JSON.parse`. The defender is now on 150,
    // i.e. 15 counters, so the SAME clause reads a bigger board and says so.
    const returned = mustApply(saved, { type: "endTurn", seat: "p2" }).state;
    const second = swing(returned, BOARD);
    expect(find(second.events, "DAMAGE_DEALT")?.dealt).toBe(10 + 10 * (15 + 2 + 1 + 1));
  });
});

describe("§9 — no new `FIXTURE_POOL` id", () => {
  it("the local ids are LOCAL", () => {
    for (const id of Object.keys(LOCAL_CARDS)) expect(FIXTURE_POOL[id], id).toBeUndefined();
  });

  it("no POOLED card prints this sentence, so the pool sweeps are unmoved", () => {
    const carriers = Object.keys(FIXTURE_POOL).filter((id) =>
      (FIXTURE_POOL[id]?.attacks ?? []).some((attack) => attack.effect === BOARD_COUNTERS),
    );
    expect(carriers).toEqual([]);
    // …and the new member has exactly ZERO producers in the pool, which is what
    // keeps `opponentCounterScaling.test.ts`'s two producer sweeps byte-identical.
    const produced: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        if (
          deriveAttackDamageBonus(attack.effect ?? "")?.count.kind ===
          "damageCountersOnOpponentBoard"
        ) {
          produced.push(`${id}[${index}]`);
        }
      }
    }
    expect(produced).toEqual([]);
  });
});
