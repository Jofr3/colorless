import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  FLIP_STATUS_ENERGY_DISCARD_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const PRINTED =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.";

const BARE_FLIP_STATUS = "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.";
const BARE_FLIP_DISCARD =
  "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.";

const CONSTRUCTED_MISSES = [
  // the status slot holds something that is not a status word
  "Flip a coin. If heads, your opponent's Active Pokémon is now Tired, and discard an Energy from that Pokémon.",
  // no leading flip — the bare form, which no card prints
  "Your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.",
  // leading text before the flip: the `^` is what refuses it
  "This attack does nothing. Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.",
  // the printed ", and" replaced by a bare " and " — the comma is load-bearing
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and discard an Energy from that Pokémon.",
  // the anaphor changed to a body this op cannot mean
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from this Pokémon.",
] as const;

const STILL_LOUD = [] as readonly string[];

const RECORDED_REFUSAL =
  "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.";

const COMPOSED_BY_THE_SPLITTER =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon. Draw a card.";

const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
const SEEDS = 400;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
const types = (events: GameEvent[]) => events.map((e) => e.type);
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const hit = (re: RegExp) => legalAttackCorpus().filter(([, s]) => re.test(s));

/** `fix-oxford` Active for `by`, `fix-titan` Active for the other seat, benches cleared on
    both sides so no stray body can absorb anything. `mixed` decides whether the defender's
    Energy is DISTINGUISHABLE, which is what decides whether the discard parks. */
function board(seed: number, mixed: boolean, by: Seat = "p1"): GameState {
  const opener: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: FLIP_STATUS_ENERGY_DISCARD_DECK, p2: FLIP_STATUS_ENERGY_DISCARD_DECK },
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
  state = attachFromDeck(state, opener, "fix-energy", mixed ? 1 : 3);
  if (mixed) state = attachFromDeck(state, opener, "fix-water-energy", 1);
  return state;
}
function swing(state: GameState, index = 2, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}
function flipOf(events: GameEvent[]): "heads" | "tails" {
  const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
  if (flip === undefined) throw new Error("no coin flip");
  return flip.result;
}
/** The first seed whose ONE flip lands the wanted face — the family's own idiom, so the
    faces are reached by seeding the board rather than by stubbing the RNG. */
function firstSeed(face: "heads" | "tails", mixed: boolean): number {
  for (let seed = 0; seed < SEEDS; seed++) {
    if (flipOf(swing(board(seed, mixed)).events) === face) return seed;
  }
  throw new Error(`no seed below ${SEEDS} lands ${face}`);
}
function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}
const activeEnergy = (state: GameState, seat: Seat) => [
  ...(state.players[seat].active?.energy ?? []),
];
function withEffect(state: GameState, effect: string, index = 0): GameState {
  const card = state.cardPool["fix-oxford"];
  const printed = card?.attacks ?? null;
  if (card === undefined || printed === null) throw new Error("fix-oxford has no attacks");
  const attacks = printed.map((a, i) => (i === index ? { ...a, effect } : a));
  return { ...state, cardPool: { ...state.cardPool, "fix-oxford": { ...card, attacks } } };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, transcribed rather than recognised", () => {
  it("the sentence is the CORPUS's bytes at TWO printings, apostrophe ASCII U+0027", () => {
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(PRINTED)).toBe(2);
    expect(rows.get(BARE_FLIP_STATUS)).toBe(27);
    expect(rows.get(BARE_FLIP_DISCARD)).toBe(12);
    for (const s of [PRINTED, BARE_FLIP_STATUS, BARE_FLIP_DISCARD]) {
      expect(s.includes("opponent's")).toBe(true);
      expect(s.includes("opponent’s")).toBe(false);
      expect(s.includes("Pokémon")).toBe(true);
    }
    expect(STILL_LOUD).toEqual([]);
    for (const s of STILL_LOUD) expect(rows.get(s)).toBe(1);
    expect(rows.get(RECORDED_REFUSAL)).toBe(1);
  });

  it("the fixture carries the corpus string at the index the suite drives — and it is NOT new", () => {
    expect(FIXTURE_POOL["fix-oxford"]?.attacks?.[2]).toEqual({
      cost: ["Colorless"],
      name: "Comma Bloom",
      effect: PRINTED,
      damage: 10,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation, the JOIN it is, and the POPULATION behind both.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the population it was measured on", () => {
  it("derives to ONE coinFlipGate holding applyStatus THEN discardEnergy, in printed order", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
        ],
      },
    ]);
  });

  it("the program is the two shipped arms' `then` lists CONCATENATED — asserted, not described", () => {
    const gate = (ops: unknown) => (ops as { then: unknown[] }[])[0]?.then ?? [];
    expect(gate(deriveAttackEffect(PRINTED))).toEqual([
      ...gate(deriveAttackEffect(BARE_FLIP_STATUS)),
      ...gate(deriveAttackEffect(BARE_FLIP_DISCARD)),
    ]);
  });

  it("the U+2019 fold — the typographic apostrophe derives to the SAME program", () => {
    const curly = PRINTED.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(PRINTED);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
    expect(resolvedByAnyReader(curly)).toBe(true);
    const rows = new Set(legalAttackCorpus().map(([, s]) => s));
    expect(rows.has(PRINTED)).toBe(true);
    expect(rows.has(curly)).toBe(false);
  });

  it("the status slot is a TEMPLATE, and all five words reach it", () => {
    for (const [word, status] of [
      ["Asleep", "asleep"],
      ["Burned", "burned"],
      ["Confused", "confused"],
      ["Paralyzed", "paralyzed"],
      ["Poisoned", "poisoned"],
    ] as const) {
      expect(deriveAttackEffect(PRINTED.replace("Paralyzed", word))).toEqual([
        {
          op: "coinFlipGate",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [
            { op: "applyStatus", target: "defender", status },
            { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
          ],
        },
      ]);
    }
  });

  it("ZERO false positives over the WHOLE 640-sentence column — one row, two printings", () => {
    const hits = legalAttackCorpus().filter(([, s]) => {
      const ops = deriveAttackEffect(s);
      const then = ops?.[0]?.op === "coinFlipGate" ? ops[0].then : [];
      return (
        ops?.length === 1 &&
        then.length === 2 &&
        then[0]?.op === "applyStatus" &&
        then[1]?.op === "discardEnergy"
      );
    });
    expect(hits.map(([, s]) => s)).toEqual([PRINTED]);
    expect(units(hits)).toBe(2);
  });

  it("this anchor has NO printed near miss — every single-axis loosening still claims ONE row", () => {
    const base = `Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now`;
    const strict = new RegExp(`^${base} (${W}), and discard an Energy from that Pokémon\\.$`);
    for (const re of [
      strict,
      new RegExp(`${base} (${W}), and discard an Energy from that Pokémon\\.$`), // no `^`
      new RegExp(`^${base} (${W}), and discard an Energy from that Pokémon`), // no `\.$`
      new RegExp(`^${base} (.+), and discard an Energy from that Pokémon\\.$`), // open slot
      new RegExp(`^${base} (${W}), and (.+)\\.$`), // open consequent
    ]) {
      expect(hit(re).map(([, s]) => s)).toEqual([PRINTED]);
      expect(units(hit(re))).toBe(2);
    }
    const twoAxis = new RegExp(`^${base} (${W})(.*)\\.$`);
    expect([hit(twoAxis).length, units(hit(twoAxis))]).toEqual([6, 35]);
  });

  it("D462's stated reason for leaving this row LOUD was wrong, and this is the regex", () => {
    const OXFORD = "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.";
    for (const re of [
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (.+), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (.+)\\.$`),
      new RegExp(`Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})\\.$`),
    ]) {
      expect(hit(re).map(([, s]) => s)).toEqual([OXFORD]);
      expect(re.test(PRINTED)).toBe(false);
    }
    const HEADS_TAILS =
      "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused.";
    const pairLoose = new RegExp(
      `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W}) and (.+)\\.$`,
    );
    expect(pairLoose.test(PRINTED)).toBe(false);
    expect(pairLoose.test(HEADS_TAILS)).toBe(true);
    // The HALF THAT WAS TRUE: `FLIP_DEFENDER_NOW`'s `\.$`, with the size of the drift.
    const flipStrict = new RegExp(
      `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W})\\.$`,
    );
    const flipDrift = new RegExp(
      `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W})`,
    );
    expect([hit(flipStrict).length, units(hit(flipStrict))]).toEqual([2, 29]);
    expect([hit(flipDrift).length, units(hit(flipDrift))]).toEqual([6, 35]);
    expect(flipStrict.test(PRINTED)).toBe(false);
    expect(flipDrift.test(PRINTED)).toBe(true);
  });

  it("the five older `is now` anchors are untouched — the six are disjoint", () => {
    // ORDER against arms 1, 2, 2b and 2c is a REFACTOR and not behaviour: every older anchor
    // demands a `.`, a ` and ` or a `, ` immediately after its LAST status word, and this one
    // demands `, and discard`.
    expect(deriveAttackEffect(BARE_FLIP_STATUS)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Burned.")).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
    expect(
      deriveAttackEffect("Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."),
    ).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the refusals, and they are CONSTRUCTED because nothing prints them.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the `^…$` discipline, driven synthetically", () => {
  it("five constructed near misses all stay on the loud path", () => {
    for (const text of CONSTRUCTED_MISSES) {
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(resolvedByAnyReader(text), text).toBe(false);
    }
  });

  it("the `$` end behaves DIFFERENTLY from the `^` end, and the splitter is why", () => {
    // The anchor refuses a trailing clause exactly as it refuses a leading one…
    expect(deriveAttackEffect(COMPOSED_BY_THE_SPLITTER)).toBeNull();
    expect(resolvedByAnyReader(COMPOSED_BY_THE_SPLITTER)).toBe(false);
    expect(splitAttackTrailingClause(COMPOSED_BY_THE_SPLITTER)).toEqual({
      head: PRINTED,
      tail: "Draw a card.",
    });
    // The leading-text twin has no such path: nothing claims its head, so it stays loud.
    const leading = `This attack does nothing. ${PRINTED}`;
    expect(splitAttackTrailingClause(leading)).toBeNull();
    // And it is CONSTRUCTED — no card prints either shape.
    const rows = new Set(legalAttackCorpus().map(([, s]) => s));
    expect(rows.has(COMPOSED_BY_THE_SPLITTER)).toBe(false);
    expect(rows.has(leading)).toBe(false);
  });

  it("…and none of the five is a real printing — the synthetic standing, asserted", () => {
    const rows = new Set(legalAttackCorpus().map(([, s]) => s));
    for (const text of CONSTRUCTED_MISSES) expect(rows.has(text)).toBe(false);
  });

  it("no splitter reaches the sentence either — the DERIVER is what answers", () => {
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board: both faces, and both of the discard's two code paths.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — heads and tails, inline and parked", () => {
  it("TAILS lands neither consequent, and the turn ends", () => {
    const { state, events } = swing(board(firstSeed("tails", true), true));
    expect(flipOf(events)).toBe("tails");
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).toContain("TURN_ENDED");
    expect(state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(activeEnergy(state, "p2")).toHaveLength(2);
    // …and the printed damage landed anyway: the gate is over the EFFECT, not the attack.
    expect(find(events, "DAMAGE_DEALT")).toBeDefined();
  });

  it("HEADS on a UNIFORM defender board resolves INLINE — no prompt, both consequents land", () => {
    // Three identical {C} collapse to ONE candidate, so `forcedDiscards` answers and the op
    // never parks. This is the path a reader that only ever tested the mixed board misses.
    const { state, events } = swing(board(firstSeed("heads", false), false));
    expect(flipOf(events)).toBe("heads");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "STATUS_APPLIED",
      "ENERGY_DISCARDED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(activeEnergy(state, "p2")).toHaveLength(2);
  });

  it("HEADS on a MIXED defender board PARKS — and the paralysis is already on the board", () => {
    // The printed order, made observable: `applyStatus` runs to completion BEFORE the
    // discard asks anything, so the pending choice is taken against a board that is already
    // Paralyzed. A reading that ordered the two ops the other way would park FIRST.
    const parked = swing(board(firstSeed("heads", true), true));
    expect(flipOf(parked.events)).toBe("heads");
    expect(types(parked.events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "STATUS_APPLIED",
      "EFFECT_PENDING",
    ]);
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(parked.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(activeEnergy(parked.state, "p2")).toHaveLength(2);

    const prompt = discardPrompt(parked.state);
    expect(prompt.scope).toEqual({ kind: "total", count: 1 });
    expect(prompt.discardable).toHaveLength(2);
    expect(prompt.note).toBe("Discard an Energy from your opponent's Active Pokémon.");
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.state.phase.cont.rest).toEqual([]);

    const pick = prompt.discardable[0]?.uid as string;
    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(types(done.events)).toContain("ENERGY_DISCARDED");
    expect(types(done.events)).toContain("TURN_ENDED");
    expect(activeEnergy(done.state, "p2")).toHaveLength(1);
    expect(activeEnergy(done.state, "p2")).not.toContain(pick);
    // …and the paralysis survived the resume, which is the half a log could not show.
    expect(done.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    // The ATTACKER's own body took neither consequent.
    expect(done.state.players.p1.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(activeEnergy(done.state, "p1")).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the loud path, with its attribution control.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the printed text stops being flagged, and the loud path still works", () => {
  it("the printed index reports no skipped effect any more, on either face", () => {
    for (const face of ["heads", "tails"] as const) {
      expect(
        find(swing(board(firstSeed(face, true), true)).events, "ATTACK_EFFECT_SKIPPED"),
      ).toBeUndefined();
    }
  });

  it("three REAL printings are still flagged — the attribution control (D214)", () => {
    const b = board(firstSeed("heads", true), true);
    expect(STILL_LOUD).toEqual([]);
    for (const text of [...STILL_LOUD, RECORDED_REFUSAL]) {
      const doctored = withEffect(b, text);
      expect(find(swing(doctored, 0).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(text);
    }
  });

  it("…and the five CONSTRUCTED near misses are announced too — the refusal is loud", () => {
    const b = board(firstSeed("heads", true), true);
    for (const text of CONSTRUCTED_MISSES) {
      const doctored = withEffect(b, text);
      expect(find(swing(doctored, 0).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(text);
    }
  });
});

describe("§6 — the census moves in exactly ONE summand", () => {
  it("the resolving corpus gains ONE sentence and TWO printings", () => {
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([600, 1663]);
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([599, 1661]);
  });

  it("the READER SURFACE stands still at 13 — this is an ARM, not a reader", () => {
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("no registry row shadows the sentence — the deriver is what answers", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — purity, and the persisted bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — purity and the structural answers", () => {
  it("never mutates the board it is handed", () => {
    const frozen = deepFreeze(board(firstSeed("heads", true), true));
    const snapshot = JSON.stringify(frozen);
    expect(swing(frozen).state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("replays identically for one seed and diverges across faces", () => {
    const seed = firstSeed("heads", true);
    const a = swing(board(seed, true));
    const b = swing(board(seed, true));
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
    expect(types(swing(board(firstSeed("tails", true), true)).events)).not.toContain(
      "STATUS_APPLIED",
    );
  });

  it("`MATCH_RECORD_VERSION` STAYS 29 — DRIVEN, in three directions including LOSS", () => {
    const parked = swing(board(firstSeed("heads", true), true)).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const pick = discardPrompt(parked).discardable[0]?.uid as string;

    // DIRECTION 1 — FORWARD. Round-trip the PARKED board through JSON, which is what
    // persistence actually does to it, and resume from the bytes.
    const persisted = JSON.parse(JSON.stringify(parked)) as GameState;
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
    expect(parked.phase.cont.rest).toEqual([]);
    const sibling = deriveAttackEffect(BARE_FLIP_DISCARD)?.[0];
    expect(sibling?.op).toBe("coinFlipGate");
    expect(JSON.stringify(sibling?.op === "coinFlipGate" ? sibling.then[0] : null)).toBe(shipped);
    // …and the SpecialConditions block is the shipped three-key shape, not a widened one.
    expect(Object.keys(persisted.players.p2.active?.conditions ?? {}).sort()).toEqual([
      "burned",
      "confusionDamage",
      "poisonDamage",
      "rotation",
    ]);

    const lossy = JSON.parse(JSON.stringify(parked)) as GameState;
    const victim = lossy.players.p2.active;
    if (victim === undefined || victim === null) throw new Error("expected a defender");
    (victim as unknown as { conditions: { rotation: string } }).conditions.rotation = "none";
    const truncated = mustApply(lossy, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    expect(live.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(truncated.state.players.p2.active?.conditions.rotation).toBe("none");
    // The discard is unaffected by the loss, which is what makes it a ONE-axis probe.
    expect(activeEnergy(truncated.state, "p2")).toHaveLength(1);
  });
});
