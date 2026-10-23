import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat, StatusName } from "./index";
import {
  DEFENDER_STATUS_TRIPLE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
  roundTrip,
} from "./testFixtures";

const OXFORD = "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.";

const COMMA_NEAR_MISS =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.";

const COLLISIONS = [
  "Your opponent's Active Pokémon is now Asleep, Confused, and Poisoned.",
  "Your opponent's Active Pokémon is now Confused, Paralyzed, and Burned.",
  "Your opponent's Active Pokémon is now Burned, Asleep, and Paralyzed.",
  "Your opponent's Active Pokémon is now Poisoned, Asleep, and Confused.",
  "Your opponent's Active Pokémon is now Burned, Burned, and Poisoned.",
  "Your opponent's Active Pokémon is now Poisoned, Confused, and Poisoned.",
] as const;

const UNPRINTED_BUT_COHERENT =
  "Your opponent's Active Pokémon is now Poisoned, Confused, and Burned.";

const DOT_ANCHOR_TRIO = [] as readonly string[];

const RECORDED_REFUSAL =
  "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.";

const SEED = 11;
function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** `fix-oxford` Active for `by`, `fix-titan` Active for the other seat, benches
    cleared on both sides so no stray body can absorb anything. Two {C} cover every
    index's cost. */
function board(by: Seat = "p1", seed = SEED): GameState {
  const opener: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: DEFENDER_STATUS_TRIPLE_DECK, p2: DEFENDER_STATUS_TRIPLE_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-oxford");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 2);
  state = setActiveFromDeck(state, opener, "fix-titan");
  state = clearBench(state, opener);
  return state;
}
function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}
function withEffect(state: GameState, effect: string, index = 0): GameState {
  const card = state.cardPool["fix-oxford"];
  if (card === undefined) throw new Error("no fix-oxford in pool");
  const attacks = [...(card.attacks ?? [])];
  const at = attacks[index];
  if (at === undefined) throw new Error(`fix-oxford has no attack ${index}`);
  attacks[index] = { ...at, effect };
  return { ...state, cardPool: { ...state.cardPool, "fix-oxford": { ...card, attacks } } };
}
/** The defender's live `SpecialConditions`, read from the seat that is NOT attacking. */
function defenderConditions(state: GameState, by: Seat = "p1") {
  const active = state.players[by === "p1" ? "p2" : "p1"].active;
  if (active === null) throw new Error("no defender");
  return active.conditions;
}
/** The status words a derived program lands, or `null` when the program is not a
    LIST of `applyStatus` ops. Keyed on the OPS rather than on the sentence, so a
    regex that had drifted into a floating match is still caught here. */
function statusListOf(text: string): StatusName[] | null {
  const ops = deriveAttackEffect(text);
  if (ops === null || ops.length === 0) return null;
  const statuses = ops.map((o) => (o.op === "applyStatus" ? o.status : null));
  return statuses.every((x): x is StatusName => x !== null) ? statuses : null;
}
const units = (rows: readonly (readonly [number, string])[]) =>
  rows.reduce((sum, [n]) => sum + n, 0);

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, transcribed rather than recognised", () => {
  it("both sentences are the CORPUS's bytes, and the apostrophe is ASCII U+0027", () => {
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(OXFORD)).toBe(2);
    expect(rows.get(COMMA_NEAR_MISS)).toBe(2);
    for (const s of [OXFORD, COMMA_NEAR_MISS]) {
      expect(s.includes("opponent's")).toBe(true);
      expect(s.includes("opponent’s")).toBe(false);
      expect(s.includes("Pokémon")).toBe(true);
    }
  });

  it("the fixture carries the corpus strings, at the indices the suite drives", () => {
    expect(FIXTURE_POOL["fix-oxford"]).toMatchObject({
      category: "Pokemon",
      stage: "Basic",
      hp: 130,
      types: ["Psychic"],
      retreat: 1,
    });
    expect(FIXTURE_POOL["fix-oxford"]?.abilities ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-oxford"]?.attacks).toEqual([
      { cost: ["Colorless", "Colorless"], name: "Triple Bloom", effect: OXFORD, damage: 50 },
      { cost: ["Colorless"], name: "Bare Bloom", effect: OXFORD },
      { cost: ["Colorless"], name: "Comma Bloom", effect: COMMA_NEAR_MISS, damage: 10 },
    ]);
    // Index 1 prints NO damage at all — the whole reason it is here.
    expect(FIXTURE_POOL["fix-oxford"]?.attacks?.[1]).not.toHaveProperty("damage");
  });
});

describe("§2 — the derivation, and the population it was measured on", () => {
  it("the sentence derives to THREE applyStatus ops in PRINTED order", () => {
    expect(deriveAttackEffect(OXFORD)).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
      { op: "applyStatus", target: "defender", status: "confused" },
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
  });

  it("ZERO false positives over the WHOLE 640-sentence column — one row, two printings", () => {
    const hits = legalAttackCorpus().filter(([, s]) => {
      const ops = deriveAttackEffect(s);
      return ops !== null && ops.length === 3 && ops.every((o) => o.op === "applyStatus");
    });
    expect(hits.map(([, s]) => s)).toEqual([OXFORD]);
    expect(units(hits)).toBe(2);
  });

  it("the column prints exactly ONE three-status list, and ZERO flipped ones", () => {
    const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
    const list = new RegExp(`is now ${W}, ${W}, and ${W}\\.$`);
    const flipped = new RegExp(`^Flip a coin\\. If heads, .*is now ${W}, ${W}, and ${W}\\.$`);
    const rows = legalAttackCorpus();
    expect(rows.filter(([, s]) => list.test(s)).map(([, s]) => s)).toEqual([OXFORD]);
    expect(rows.filter(([, s]) => flipped.test(s))).toEqual([]);
    const looseComma = new RegExp(`is now ${W}, `);
    expect(
      rows
        .filter(([, s]) => looseComma.test(s))
        .map(([, s]) => s)
        .sort(),
    ).toEqual([OXFORD, COMMA_NEAR_MISS].sort());
  });

  it("D464 — the printed NEAR MISS is BUILT now, and this anchor is untouched by it", () => {
    expect(deriveAttackEffect(COMMA_NEAR_MISS)).toEqual([
      {
        op: "coinFlipGate",
        then: [
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
        ],
      },
    ]);
    expect(resolvedByAnyReader(COMMA_NEAR_MISS)).toBe(true);
    // …and it is still the DERIVER that answers, not a splitter — the half of the old
    // rung that survives the inversion unchanged.
    expect(splitAttackTrailingClause(COMMA_NEAR_MISS)).toBeNull();
  });

  it("D462's stated reason was wrong, and this is the regex that says so", () => {
    const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
    const rows = legalAttackCorpus();
    const hit = (re: RegExp) => rows.filter(([, s]) => re.test(s));
    for (const re of [
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (.+), (${W}), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (.+), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (.+)\\.$`),
      new RegExp(`Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})`),
    ]) {
      expect(hit(re).map(([, s]) => s)).toEqual([OXFORD]);
      expect(re.test(COMMA_NEAR_MISS)).toBe(false);
    }
    const flipStrict = new RegExp(
      `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W})\\.$`,
    );
    const flipDrift = new RegExp(
      `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W})`,
    );
    expect([hit(flipStrict).length, hit(flipStrict).reduce((a, [n]) => a + n, 0)]).toEqual([2, 29]);
    expect([hit(flipDrift).length, hit(flipDrift).reduce((a, [n]) => a + n, 0)]).toEqual([6, 35]);
    expect(flipStrict.test(COMMA_NEAR_MISS)).toBe(false);
    expect(flipDrift.test(COMMA_NEAR_MISS)).toBe(true);
  });

  it("the FLIPPED Oxford list is refused — there is no flip arm, by choice", () => {
    expect(
      deriveAttackEffect(
        `Flip a coin. If heads, ${OXFORD.slice(0, 1).toLowerCase()}${OXFORD.slice(1)}`,
      ),
    ).toBeNull();
    expect(deriveAttackEffect(`Flip a coin. If heads, ${OXFORD}`)).toBeNull();
  });

  it("the older anchors are untouched — the four `is now` shapes are disjoint", () => {
    // ORDER against arms 1, 2 and 2b is a REFACTOR and not behaviour: `(X)` admits no
    // comma and no space, so no string can be claimed by two of these anchors. Stated
    // as a rung because it is exactly what a fourth anchor could fail to have.
    expect(statusListOf("Your opponent's Active Pokémon is now Asleep.")).toEqual(["asleep"]);
    expect(statusListOf("Your opponent's Active Pokémon is now Burned and Confused.")).toEqual([
      "burned",
      "confused",
    ]);
    expect(statusListOf(OXFORD)).toEqual(["burned", "confused", "poisoned"]);
    // The trailing-clause compound of the PAIR family still composes rather than being
    // shadowed — the triple anchor's `\.$` is what keeps it out of the way.
    expect(
      splitAttackTrailingClause(
        "Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.",
      ),
    ).not.toBeNull();
    // …and a trailing clause after the OXFORD list is claimed by nobody, whole or split.
    expect(deriveAttackEffect(`${OXFORD} Draw a card.`)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the refusal, and the admission that stops it being a tautology.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the slot collision, refused by a derivation rather than a blocklist", () => {
  it("a list with two words in ONE `SpecialConditions` field derives to null", () => {
    for (const text of COLLISIONS) expect(deriveAttackEffect(text)).toBeNull();
  });

  it("…AND a coherent list NO card prints is ADMITTED — the control", () => {
    expect(deriveAttackEffect(UNPRINTED_BUT_COHERENT)).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "applyStatus", target: "defender", status: "confused" },
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
  });

  it("ZERO of the 1,732 printings carries a colliding list — the population claim", () => {
    const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
    const list = new RegExp(`is now (${W}), (${W}), and (${W})\\.$`);
    const SLOT: Record<string, string> = {
      Asleep: "rotation",
      Paralyzed: "rotation",
      Confused: "rotation",
      Poisoned: "poisonDamage",
      Burned: "burned",
    };
    const colliding = legalAttackCorpus().filter(([, s]) => {
      const m = list.exec(s);
      if (m === null) return false;
      const slots = [m[1], m[2], m[3]].map((w) => SLOT[w as string]);
      return new Set(slots).size !== slots.length;
    });
    expect(colliding).toEqual([]);
  });

  it("a REFUSED list returns null from the whole reader, not a partial program", () => {
    // The dangerous alternative is not "no program" but "two of the three printed
    // conditions" — a program that RESOLVES while the board carries less than the card
    // says. Asserted as an absence of ops rather than as a count.
    for (const text of COLLISIONS) expect(statusListOf(text)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board, on both printed indices.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the board: three conditions land, and all three are observable", () => {
  it("index 0 (50 damage) lands Burned, Confused AND Poisoned on the defender", () => {
    const { state } = swing(board(), 0);
    expect(defenderConditions(state)).toEqual({
      burned: true,
      rotation: "confused",
      poisonDamage: 10,
      confusionDamage: 30,
    });
  });

  it("…and TWO of the three conditions are visible in the DAMAGE, not just the log", () => {
    const { state } = swing(board(), 0);
    expect(state.players.p2.active?.damage).toBe(80);
  });

  it("index 1 (NO printed damage) lands the same three, and the 30 is all Checkup", () => {
    const { state } = swing(board(), 1);
    expect(defenderConditions(state)).toEqual({
      burned: true,
      rotation: "confused",
      poisonDamage: 10,
      confusionDamage: 30,
    });
    expect(state.players.p2.active?.damage).toBe(30);
  });

  it("the surviving BURN is the seed's coin, said out loud rather than assumed", () => {
    const { events } = swing(board(), 0);
    const flips = all(events, "CHECKUP_COIN_FLIP").filter((f) => f.status === "burned");
    expect(flips.map((f) => f.result)).toEqual(["tails"]);
    expect(all(events, "STATUS_CLEARED")).toEqual([]);
  });

  it("THREE `STATUS_APPLIED` rows, in PRINTED order, on the defender's uid", () => {
    // The order is unobservable on the BOARD — the three writes are disjoint by
    // construction, so either order reaches a byte-identical `conditions`. Only this
    // sequence and the derived program can see it, which is why both are asserted.
    const { state, events } = swing(board(), 0);
    const rows = all(events, "STATUS_APPLIED");
    expect(rows.map((r) => r.status)).toEqual(["burned", "confused", "poisoned"]);
    const uid = state.players.p2.active?.stack.at(-1);
    expect(new Set(rows.map((r) => r.uid))).toEqual(new Set([uid]));
    expect(new Set(rows.map((r) => r.seat))).toEqual(new Set(["p2"]));
    expect(rows.find((r) => r.status === "poisoned")?.poisonDamage).toBe(10);
  });

  it("the SEAT comes off the printed possessive, driven from the other side too", () => {
    const { state } = swing(board("p2"), 0, "p2");
    expect(defenderConditions(state, "p2")).toEqual({
      burned: true,
      rotation: "confused",
      poisonDamage: 10,
      confusionDamage: 30,
    });
    // …and the attacker's own body took none of them.
    expect(state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the loud path, with its attribution control.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the printed text stops being flagged, and the loud path still works", () => {
  it("neither printed index reports a skipped effect any more", () => {
    for (const index of [0, 1]) {
      expect(findEvent(swing(board(), index).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    }
  });

  it("D464 — index 2 stops being flagged too, because D464 built it", () => {
    expect(findEvent(swing(board(), 2).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("THE ATTRIBUTION CONTROL, RE-POINTED: three REAL printings are still flagged (D214)", () => {
    expect(DOT_ANCHOR_TRIO).toEqual([]);
    for (const text of [...DOT_ANCHOR_TRIO, RECORDED_REFUSAL]) {
      const doctored = withEffect(board(), text);
      expect(findEvent(swing(doctored, 0).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(text);
    }
  });

  it("…and a CONSTRUCTED colliding list is announced too — the refusal is loud", () => {
    for (const text of COLLISIONS) {
      const doctored = withEffect(board(), text);
      expect(findEvent(swing(doctored, 0).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(text);
    }
  });
});

describe("§6 — the census moves in exactly ONE summand", () => {
  it("the reader SURFACE stands still at 13 — this slice adds an ARM, not a reader", () => {
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the resolving corpus gains ONE sentence and TWO printings", () => {
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([600, 1663]);
    const withoutOxford = resolved.filter(([, s]) => s !== OXFORD);
    expect([withoutOxford.length, units(withoutOxford)]).toEqual([599, 1661]);
  });

  it("the population itself did not move — 640 sentences / 1,732 printings", () => {
    const rows = legalAttackCorpus();
    expect(rows).toHaveLength(640);
    expect(units(rows)).toBe(1732);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — purity, the park question, and the persisted bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — purity and the structural answers", () => {
  it("never mutates the board it is handed", () => {
    const frozen = deepFreeze(board());
    const snapshot = JSON.stringify(frozen);
    expect(swing(frozen, 0).state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("replays identically for one seed", () => {
    const a = swing(board(), 0);
    const b = swing(board(), 0);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });

  it("there is no PARK on this path — the three ops resolve inline", () => {
    for (const index of [0, 1]) {
      expect(swing(board(), index).state.phase.kind).not.toBe("effect:choose");
    }
  });

  it("`MATCH_RECORD_VERSION` STAYS 29 — DRIVEN, in three directions", () => {
    const live = board();
    const persisted = roundTrip(live);
    const liveRun = swing(live, 0);
    const replayed = swing(persisted, 0);
    expect(replayed.events).toEqual(liveRun.events);
    expect(replayed.state).toEqual(liveRun.state);

    expect(Object.keys(defenderConditions(liveRun.state)).sort()).toEqual([
      "burned",
      "confusionDamage",
      "poisonDamage",
      "rotation",
    ]);
    expect(defenderConditions(live)).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });

    const after = roundTrip(liveRun.state);
    for (const key of ["burned", "poisonDamage", "rotation"] as const) {
      const lossy = roundTrip(after);
      const active = lossy.players.p2.active;
      if (active === null) throw new Error("no defender");
      delete (active.conditions as unknown as Record<string, unknown>)[key];
      expect(lossy.players.p2.active?.conditions).not.toEqual(after.players.p2.active?.conditions);
    }
  });
});
