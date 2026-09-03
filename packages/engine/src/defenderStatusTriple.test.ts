import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import { applyAction, engineVersion } from "./index";
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
} from "./testFixtures";

// 0.360.0 → 0.361.0 — 🆕🆕 D462, THE THREE-STATUS OXFORD LIST. *"Your opponent's
// Active Pokémon is now Burned, Confused, and Poisoned."* — `censusAttackCorpus.ts`
// FILE LINE 679, **1 sentence / 2 legal printings** — THREE `applyStatus` ops in
// printed order behind ONE new anchor and the pair helper generalised to a LIST.
//
// 🛑 **WHAT THIS SLICE IS ACTUALLY ABOUT IS A REFUSAL THAT NAMED A SENTENCE WHILE
// PRICING A PARAMETER.** D424 measured this row, named it, and left it LOUD with a
// reason: *"the ONLY 3-status row in the column, so a 3-list template would be D121's
// literal over a pool of one"*. D121 prices a NEW parameter. This anchor adds none —
// `STATUS_WORDS` is D424's own vocabulary, warranted there on THREE distinct printed
// pairs with BOTH slots varying, and the third slot is that SAME parameter at one more
// position. The pool of one was the SENTENCE's and never the parameter's, and the
// distance between those two claims is the whole of this slice.
//
// ⚠️ **ZERO NEW MECHANISM, AND THAT IS THE MEASURED CLAIM RATHER THAN A BOAST.** No
// new `EffectOp` member, no new op FIELD, no new op VALUE, no new reader (the surface
// stands still at 13, asserted in §6), no prompt, no event, no registry row, no
// `packages/schema` byte and no `redact.ts` byte. The program is three of an op the
// engine has run since 0.x — which is also the whole `MATCH_RECORD_VERSION` argument
// (§7): the serialized ALPHABET does not move.
//
// ⚠️ **THE CARRIERS ARE UNRESOLVED AND SAID SO (D425).** The row has 2 legal
// printings and this checkout has no D1, so `fix-oxford` is SYNTHETIC. The STRING is
// the corpus row byte for byte (§1); nothing else about the body is transcription.

/** Corpus FILE LINE 679, byte for byte. ⚠️ THE APOSTROPHE IS ASCII U+0027 and the
    `é` is U+00E9 — asserted in §1 off the corpus rather than eyeballed, which is the
    check D424 paid for after a brief asserted U+2019 for a sibling sentence. */
const OXFORD = "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.";

/** Corpus FILE LINE 264 — a REAL legal printing (2) that NO reader claims, and the
    one printed NEAR MISS of the new anchor: it opens exactly like a coin-flipped
    Oxford list and puts an OP where the second status word would go. */
const COMMA_NEAR_MISS =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.";

/** 🛑 THE COLLISION SENTENCES, AND THEY ARE CONSTRUCTED — SAID OUT LOUD, D424's rule
    verbatim. No card prints a three-word list at all except row 679, so the refusal
    can only ever be driven SYNTHETICALLY. Each of these puts TWO `rotation` words in
    one list (or one word twice), which `defenderStatusOps` refuses because both would
    write `SpecialConditions.rotation` and the later op would silently eat the earlier
    — a program that RESOLVES and leaves the board carrying fewer conditions than the
    sentence printed. */
const COLLISIONS = [
  "Your opponent's Active Pokémon is now Asleep, Confused, and Poisoned.",
  "Your opponent's Active Pokémon is now Confused, Paralyzed, and Burned.",
  "Your opponent's Active Pokémon is now Burned, Asleep, and Paralyzed.",
  "Your opponent's Active Pokémon is now Poisoned, Asleep, and Confused.",
  "Your opponent's Active Pokémon is now Burned, Burned, and Poisoned.",
  "Your opponent's Active Pokémon is now Poisoned, Confused, and Poisoned.",
] as const;

/** ⚠️ THE CONTROL WITHOUT WHICH §3 WOULD BE A TAUTOLOGY (D424's rule). Three
    slot-disjoint words in an order NO card prints: it must be ADMITTED, so
    *"refuse every three-word list"* cannot pass this suite. */
const UNPRINTED_BUT_COHERENT = "Your opponent's Active Pokémon is now Poisoned, Confused, and Burned.";

const SEED = 11;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
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
/** Re-text ONE attack on a board's OWN `cardPool` copy. ⚠️ NOT a fixture edit —
    `FIXTURE_POOL` is shared by every suite in this package and D412 reddened three
    boards by widening a shared fixture. It exists for the constructed sentences of
    §3, which have no printing and can have no fixture. */
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
  it("🛑 both sentences are the CORPUS's bytes, and the apostrophe is ASCII U+0027", () => {
    // D183's rule: author and assert against the printed bytes, never a paraphrase.
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
    // ⚠️ SYNTHETIC BY NECESSITY AND SAID SO (D425): 2 legal printings, no D1 in this
    // checkout, so the carriers are UNRESOLVED. Only the STRING is transcription.
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

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation, and the POPULATION it was measured on.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the population it was measured on", () => {
  it("the sentence derives to THREE applyStatus ops in PRINTED order", () => {
    expect(deriveAttackEffect(OXFORD)).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
      { op: "applyStatus", target: "defender", status: "confused" },
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
  });

  it("🛑 ZERO false positives over the WHOLE 640-sentence column — one row, two printings", () => {
    // ⚠️ THE SWEEP IS OVER THE POPULATION, not over the rows this slice went looking
    // for (D423). An anchor that had drifted into a floating match shows up here and
    // nowhere else.
    const hits = legalAttackCorpus().filter(([, s]) => {
      const ops = deriveAttackEffect(s);
      return ops !== null && ops.length === 3 && ops.every((o) => o.op === "applyStatus");
    });
    expect(hits.map(([, s]) => s)).toEqual([OXFORD]);
    expect(units(hits)).toBe(2);
  });

  it("🛑 the column prints exactly ONE three-status list, and ZERO flipped ones", () => {
    // The refusal in `DEFENDER_STATUS_TRIPLE`'s doc block, asserted rather than
    // remembered. D424 took the pair's coin-flipped twin because the column PRINTS it;
    // there is no flipped Oxford list to take, so no flip arm was written. **AN EMPTY
    // RESULT IS A FINDING** — this is the site that keeps it a measured one.
    const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
    const list = new RegExp(`is now ${W}, ${W}, and ${W}\\.$`);
    const flipped = new RegExp(`^Flip a coin\\. If heads, .*is now ${W}, ${W}, and ${W}\\.$`);
    const rows = legalAttackCorpus();
    expect(rows.filter(([, s]) => list.test(s)).map(([, s]) => s)).toEqual([OXFORD]);
    expect(rows.filter(([, s]) => flipped.test(s))).toEqual([]);
    // ⚠️ AND THE LOOSER SHAPE FINDS THE NEAR MISS, which is why the vocabulary in the
    // second capture group is load-bearing rather than decorative: `is now (X),` has
    // TWO rows in this column and only one of them is a list.
    const looseComma = new RegExp(`is now ${W}, `);
    expect(rows.filter(([, s]) => looseComma.test(s)).map(([, s]) => s).sort()).toEqual(
      [OXFORD, COMMA_NEAR_MISS].sort(),
    );
  });

  it("🛑 the printed NEAR MISS stays on the loud path, and the vocabulary is why", () => {
    // Corpus line 264 is a REAL printing, not a constructed string. It must derive to
    // `null` through every one of the four `is now` anchors.
    expect(deriveAttackEffect(COMMA_NEAR_MISS)).toBeNull();
    expect(resolvedByAnyReader(COMMA_NEAR_MISS)).toBe(false);
    // …and no splitter reaches it either, so "unread" is the whole answer.
    expect(splitAttackTrailingClause(COMMA_NEAR_MISS)).toBeNull();
  });

  it("🛑 the FLIPPED Oxford list is refused — there is no flip arm, by choice", () => {
    // The refusal `DEFENDER_STATUS_TRIPLE`'s doc block records, made LIVE rather than
    // left as prose. D424 took the pair's coin-flipped twin because the column prints
    // it; this list has no flipped printing (the rung above measures ZERO), so no flip
    // arm was written — and the anchor's `^` is what keeps a floating match from
    // claiming the flipped sentence and landing three conditions with **no coin at
    // all**, on TAILS as well as heads.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${OXFORD.slice(0, 1).toLowerCase()}${OXFORD.slice(1)}`)).toBeNull();
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
  it("🛑 a list with two words in ONE `SpecialConditions` field derives to null", () => {
    for (const text of COLLISIONS) expect(deriveAttackEffect(text)).toBeNull();
  });

  it("⚠️ …AND a coherent list NO card prints is ADMITTED — the control", () => {
    // Without this, "refuse every three-word list" passes the rung above (D424's rule:
    // every "X is refused" owes a neighbouring "Y is admitted").
    expect(deriveAttackEffect(UNPRINTED_BUT_COHERENT)).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "applyStatus", target: "defender", status: "confused" },
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
  });

  it("🛑 ZERO of the 1,732 printings carries a colliding list — the population claim", () => {
    // The refusal is UNREACHABLE from the catalog, which is why it is driven
    // synthetically above. Asserted on the POPULATION, not on a specimen (D423).
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
    });
  });

  it("…and TWO of the three conditions are visible in the DAMAGE, not just the log", () => {
    // 🛑 THE ARITHMETIC IS THE POINT AND IT IS DETERMINISTIC. An attack ENDS the turn
    // (§5.3), so the Checkup runs before this state is handed back: the printed 50,
    // plus BURN's 20, plus POISON's default 10 = **80**. Confused places nothing, which
    // is why §4's first rung reads the model and this one reads the total — between
    // them all three printed words have a consequence a board can see.
    //
    // ⚠️ THE THREE TICKS ARE UNCONDITIONAL EVEN THOUGH BURN TAKES A COIN: the counters
    // are placed first and the flip only decides whether the condition SURVIVES, so
    // this number does not depend on the seed. The `burned: true` in the rungs either
    // side of it DOES — see the coin rung below.
    const { state } = swing(board(), 0);
    expect(state.players.p2.active?.damage).toBe(80);
  });

  it("index 1 (NO printed damage) lands the same three, and the 30 is all Checkup", () => {
    // A reader keyed on the presence of a `damage` key satisfies index 0 and fails
    // here — the substitute for D424's second BODY, which this slice cannot resolve.
    // 50 → 0 on the printed hit, and the same 30 of Checkup tick: the difference
    // between the two indices is exactly the printed number and nothing else.
    const { state } = swing(board(), 1);
    expect(defenderConditions(state)).toEqual({
      burned: true,
      rotation: "confused",
      poisonDamage: 10,
    });
    expect(state.players.p2.active?.damage).toBe(30);
  });

  it("⚠️ the surviving BURN is the seed's coin, said out loud rather than assumed", () => {
    // 🛑 THE DECK IS NOT SEED-FREE AND THE SUITE MUST NOT PRETEND IT IS. Burn's §12
    // recovery is a coin flip; at SEED 11 it comes up tails on this board, which is why
    // `burned: true` survives into the rungs above. The dependency is named HERE, with
    // the flip asserted, so a future seed change reddens THIS rung with an explanation
    // rather than reddening two board assertions with none.
    const { events } = swing(board(), 0);
    const flips = all(events, "CHECKUP_COIN_FLIP").filter((f) => f.status === "burned");
    expect(flips.map((f) => f.result)).toEqual(["tails"]);
    // …and no STATUS_CLEARED row followed it, which is the other half of the same fact.
    expect(all(events, "STATUS_CLEARED")).toEqual([]);
  });

  it("🛑 THREE `STATUS_APPLIED` rows, in PRINTED order, on the defender's uid", () => {
    // The order is unobservable on the BOARD — the three writes are disjoint by
    // construction, so either order reaches a byte-identical `conditions`. Only this
    // sequence and the derived program can see it, which is why both are asserted.
    const { state, events } = swing(board(), 0);
    const rows = all(events, "STATUS_APPLIED");
    expect(rows.map((r) => r.status)).toEqual(["burned", "confused", "poisoned"]);
    const uid = state.players.p2.active?.stack.at(-1);
    expect(new Set(rows.map((r) => r.uid))).toEqual(new Set([uid]));
    expect(new Set(rows.map((r) => r.seat))).toEqual(new Set(["p2"]));
    // Poison's row carries the DEFAULT damage — the field is read, not defaulted at
    // the board.
    expect(rows.find((r) => r.status === "poisoned")?.poisonDamage).toBe(10);
  });

  it("the SEAT comes off the printed possessive, driven from the other side too", () => {
    const { state } = swing(board("p2"), 0, "p2");
    expect(defenderConditions(state, "p2")).toEqual({
      burned: true,
      rotation: "confused",
      poisonDamage: 10,
    });
    // …and the attacker's own body took none of them.
    expect(state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the loud path, with its attribution control.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the printed text stops being flagged, and the loud path still works", () => {
  it("neither printed index reports a skipped effect any more", () => {
    for (const index of [0, 1]) {
      expect(find(swing(board(), index).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    }
  });

  it("🛑 index 2's REAL printing is still flagged — the attribution control (D214)", () => {
    // Without this, "no skip marker" could be true because the marker stopped being
    // emitted at all. Corpus line 264 is a real legal printing this slice deliberately
    // did not claim, on the SAME body, and it must still be announced.
    const skipped = find(swing(board(), 2).events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe(COMMA_NEAR_MISS);
  });

  it("…and a CONSTRUCTED colliding list is announced too — the refusal is loud", () => {
    for (const text of COLLISIONS) {
      const doctored = withEffect(board(), text);
      expect(find(swing(doctored, 0).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(text);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the census moves in exactly ONE summand, and the step is 1 and 2.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the census moves in exactly ONE summand", () => {
  it("the reader SURFACE stands still at 13 — this slice adds an ARM, not a reader", () => {
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the resolving corpus gains ONE sentence and TWO printings", () => {
    // ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — the one file line
    // carries 2 legal printings, so a pass that copied one number into the other kind
    // of site would be wrong at EVERY site (D451/D461's finding, paid here).
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([491, 1512]);
    // …and the step is attributable: remove THIS sentence from the resolved set and
    // the pair is the pre-slice one, re-derived rather than remembered.
    const withoutOxford = resolved.filter(([, s]) => s !== OXFORD);
    expect([withoutOxford.length, units(withoutOxford)]).toEqual([490, 1510]);
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

  it("🛑 there is no PARK on this path — the three ops resolve inline", () => {
    // This is what makes the version prediction true rather than hopeful: an op that
    // never parks can never reach `phase.cont.rest`, so no continuation this slice can
    // author is ever persisted. Driven, not asserted.
    for (const index of [0, 1]) {
      expect(swing(board(), index).state.phase.kind).not.toBe("effect:choose");
    }
  });

  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — DRIVEN, in three directions", () => {
    // ⚠️ `MATCH_RECORD_VERSION` is not exported from this package (it lives in
    // `apps/api/src/lobby/match.ts`), so the claim is DRIVEN the way D421–D424 drove
    // theirs. The bump trigger is a PERSISTED structure gaining, renaming or losing a
    // required field. This slice adds no op, no field and no VALUE: the serialized
    // ALPHABET is unmoved, and a program of three `applyStatus` ops was already
    // authorable before it (arm 2b authors two).
    //
    // DIRECTION 1 — FORWARD. Round-trip the board through JSON, which is what
    // persistence actually does to it, and replay. Any new persisted shape shows up as
    // a divergence.
    const live = board();
    const persisted = JSON.parse(JSON.stringify(live)) as GameState;
    const liveRun = swing(live, 0);
    const replayed = swing(persisted, 0);
    expect(replayed.events).toEqual(liveRun.events);
    expect(replayed.state).toEqual(liveRun.state);

    // DIRECTION 2 — WIDENING / ABSENT. The `conditions` record's key set is asserted
    // as a LITERAL rather than as a diff between two boards of ONE build: a diff is
    // blind to a key that grew on both (D279). This slice writes all three and adds
    // none, and an ABSENT `conditions` still reads as "no condition".
    expect(Object.keys(defenderConditions(liveRun.state)).sort()).toEqual([
      "burned",
      "poisonDamage",
      "rotation",
    ]);
    expect(defenderConditions(live)).toEqual({ rotation: "none", poisonDamage: 0, burned: false });

    // DIRECTION 3 — LOSS. Drop each written key from the PERSISTED bytes in turn and
    // confirm a v29 reader can SEE the loss. That is the direction a version argument
    // usually skips, and it is the one that proves the three conditions are really in
    // the record rather than merely in the events: if any key were unpersisted, its
    // removal would be invisible here and the "three conditions landed" claim would be
    // a statement about a log rather than about a board.
    const after = JSON.parse(JSON.stringify(liveRun.state)) as GameState;
    for (const key of ["burned", "poisonDamage", "rotation"] as const) {
      const lossy = JSON.parse(JSON.stringify(after)) as GameState;
      const active = lossy.players.p2.active;
      if (active === null) throw new Error("no defender");
      delete (active.conditions as unknown as Record<string, unknown>)[key];
      expect(lossy.players.p2.active?.conditions).not.toEqual(
        after.players.p2.active?.conditions,
      );
    }
  });

  it("engineVersion is 0.361.0 and the bump is owed for BEHAVIOUR", () => {
    // 🆕🆕 D462 — 0.360.0 → **0.361.0**. One printed sentence that derived to `null`
    // now derives to a program: an OBSERVABLE change to what the engine does with a
    // real catalog row, which is the bump's whole trigger.
    expect(engineVersion).toBe("0.361.0");
  });
});
