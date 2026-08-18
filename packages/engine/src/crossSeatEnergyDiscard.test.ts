import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { ENERGY_TYPE_BY_CODE, deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  CROSS_SEAT_DISCARD_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// D361 — THE CROSS-SEAT ENERGY DISCARD: three printed sentences, ONE widened
// anchor plus ONE new one, and ZERO new vocabulary anywhere in the engine.
//
// THE MEASUREMENT THAT CHOSE THIS ROW (re-derived, not inherited). The legal
// attack corpus is 640 sentences / 1,732 printings; the NINE readers together
// resolved 320 / 1,177 at D360's head — and 1,177 is `BUILT.attack`'s own
// committed RAW summand, which is the cross-check that makes the rest
// believable. So the residue was 320 sentences / 555 printings, its largest
// BARE-IMPERATIVE block was `Discard …` at 39 sentences / 71 printings, and
// inside that block the cross-seat Energy discard is FOUR sentences / NINE
// Standard-legal printings:
//
//   ✅ "Discard a Special Energy from your opponent's Active Pokémon."        4
//        Victini `sv05-030` "Singe Off", Farfetch'd `sv06-132` "Mach Cut",
//        Cobalion `sv10.5b-066`/`-144` "Righteous Edge"
//   ✅ "Discard a {R} Energy from your opponent's Active Pokémon."            2
//        Ducklett `sv10.5w-025`/`-109` "Firefighting"
//        (+ Growlithe `sv03.5-058`, "{W}", `legal_standard = 0` — same arm)
//   ✅ "Discard all Special Energy from all of your opponent's Pokémon."      2
//        Ceruledge `sv08-035`/`-197` "Cursed Edge"
//   🛑 "Discard an Energy from your opponent's Active Pokémon **ex**."        1
//        Turtonator `sv08-137` "Fully Singe" — REFUSED, see §6.
//
// 🛑 THE PRODUCER SET WAS CLOSED BEFORE A LINE MOVED, WHICH IS THE STEP D358 AND
// D359 BOTH SKIPPED. `grep 'op: "discardEnergy"'` over non-test source returns
// object literals in exactly TWO files — `effects.ts` (this deriver) and
// `registry.ts` (hand-authored programs). `interpreter.ts`'s five hits are all
// `Extract<EffectOp, …>` TYPE positions, i.e. CONSUMERS. §5 walks both producers.
//
// ⚠️ AND THE WALK IS RECURSIVE, FOR D360's REASON ONE OP OVER: a top-level
// filter over `deriveAttackEffect`'s output reports 8 sentences / 76 printings
// carrying `discardEnergy` and a recursive one reports 12 / 92, the difference
// being the `coinFlipGate`-, `optional`- and `conditionGate`-NESTED instances. A
// FLAT WALK IS THE SAME CLASS OF ERROR AS A ONE-PRODUCER WALK, ONE LEVEL DOWN.

/** Every `discardEnergy` op inside an arbitrarily nested program — the recursive
    flatten §5's biconditional needs, and the reason it cannot be a `.filter`. */
function discardOps(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const n of node) discardOps(n, out);
    return out;
  }
  if (node !== null && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if (rec.op === "discardEnergy") out.push(rec);
    for (const v of Object.values(rec)) discardOps(v, out);
  }
  return out;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so attacking is legal (§4). */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: CROSS_SEAT_DISCARD_DECK, p2: CROSS_SEAT_DISCARD_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields the cross-seat attacker with one Colorless attached (every printed
    cost in this family is a single Energy); P2 fields a 200 HP body that
    survives, so no Knock Out tail interferes with what came off. */
function ready(seed: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-crossseatdiscard");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return clearBench(state, "p2");
}

function energyIds(state: GameState, seat: Seat, benchIndex?: number): string[] {
  const side = state.players[seat];
  const spot = benchIndex === undefined ? side.active : side.bench[benchIndex];
  return (spot?.energy ?? []).map((uid) => state.cardIdByUid[uid] ?? "?");
}

function discardIds(state: GameState, seat: Seat): string[] {
  return state.players[seat].discard.map((uid) => state.cardIdByUid[uid] ?? "?").sort();
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const SPECIAL_ACTIVE = "Discard a Special Energy from your opponent's Active Pokémon.";
const TYPED_ACTIVE = "Discard a {R} Energy from your opponent's Active Pokémon.";
const SWEEP_ALL = "Discard all Special Energy from all of your opponent's Pokémon.";
/** Giacomo `sv02-182`, a REGISTRY Supporter row. The sharpest near-miss any
    anchor in `effects.ts` has: the engine already BUILDS this sentence from the
    other producer, at a different count. */
const GIACOMO_PRINTED = "Discard a Special Energy from each of your opponent's Pokémon.";

describe("D361 §1 — the deriver: three printed sentences, one WIDENED anchor and one NEW one", () => {
  it("all three derive, and the FILTER is read off the printed NOUN PHRASE", () => {
    // 🛑 THE CLAIM THIS SECTION EXISTS FOR. The three sentences share a
    // byte-identical tail; the ONLY thing that varies is what is taken. A build
    // that collapsed the noun phrase to `anyEnergy` would strip a Basic Energy
    // off a defender on every one of these eight printings — the wrong card
    // coming off a real board, which §2 and §3 then drive.
    expect(deriveAttackEffect(SPECIAL_ACTIVE)).toEqual([
      { op: "discardEnergy", from: "opponentActive", filter: { kind: "specialEnergy" } },
    ]);
    expect(deriveAttackEffect(TYPED_ACTIVE)).toEqual([
      {
        op: "discardEnergy",
        from: "opponentActive",
        filter: { kind: "providesEnergy", energyType: "Fire" },
      },
    ]);
    expect(deriveAttackEffect(SWEEP_ALL)).toEqual([
      {
        op: "discardEnergy",
        from: "opponentEach",
        filter: { kind: "specialEnergy" },
        count: "all",
      },
    ]);
  });

  it("🛑 THE BARE FORM'S PROGRAM IS BYTE-IDENTICAL — that is what makes this a WIDENING", () => {
    // A widening is free only if the sentences that already derived derive the
    // SAME THING. Both capture groups are `undefined` on the printed article, so
    // the spread emits the two-key object it has emitted since D41 — no `count`,
    // no third key, and `anyEnergy` rather than a narrowed filter.
    const bare = deriveAttackEffect("Discard an Energy from your opponent's Active Pokémon.");
    expect(bare).toEqual([
      { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
    ]);
    // Key-for-key, not just deep-equal: a stray `count: undefined` would pass
    // `toEqual` and change the persisted byte string (an `EffectOp` IS stored in
    // `EffectContinuation.pendingOp`).
    expect(Object.keys((bare as EffectOp[])[0] as object).sort()).toEqual([
      "filter",
      "from",
      "op",
    ]);
    // And the coin-gated twin is untouched by the widening — it reads its own
    // anchor, which §4's refusal list proves was NOT widened alongside.
    expect(
      deriveAttackEffect(
        "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.",
      ),
    ).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ]);
  });

  it("the TYPE is a PARAMETER — every code in the map resolves, and its own name resolves identically", () => {
    // 🛑 THE OTHER HALF OF THE FILTER CLAIM, and the one a hardcoded
    // `energyType: "Fire"` passes §1's first case on. The repo's settled
    // convention (asserted for the SELF form in `providesEnergy.test.ts`) is that
    // the alternation is built FROM `ENERGY_TYPE_BY_CODE`, never from the printed
    // subset — so `{L}` derives here even though no card prints it on this shape,
    // and a tenth energy type costs zero lines.
    for (const [code, type] of Object.entries(ENERGY_TYPE_BY_CODE)) {
      const expected = [
        {
          op: "discardEnergy",
          from: "opponentActive",
          filter: { kind: "providesEnergy", energyType: type },
        },
      ];
      expect(
        deriveAttackEffect(`Discard a {${code}} Energy from your opponent's Active Pokémon.`),
        code,
      ).toEqual(expected);
      expect(
        deriveAttackEffect(`Discard a ${type} Energy from your opponent's Active Pokémon.`),
        type,
      ).toEqual(expected);
    }
    // Non-vacuity: the loop above must have driven more than one type, or a
    // hardcoded map of size 1 would satisfy it.
    expect(Object.keys(ENERGY_TYPE_BY_CODE).length).toBe(9);
    // Colorless is deliberately not in the map (§6.1) — it is the conservative
    // provision FALLBACK, so a `{C}` filter would quietly match every unauthored
    // Special. It must stay on the LOUD skipped path here as it does on the self
    // form.
    expect(deriveAttackEffect("Discard a {C} Energy from your opponent's Active Pokémon.")).toBeNull();
    expect(
      deriveAttackEffect("Discard a Colorless Energy from your opponent's Active Pokémon."),
    ).toBeNull();
  });

  it("the apostrophe hardening covers all three, so a punctuation-only re-ingest cannot un-derive them", () => {
    // D136/D137's rule, which every sibling on this noun phrase carries. The
    // sweep's `opponent's` is in its own anchor and needs its own class.
    expect(deriveAttackEffect(SPECIAL_ACTIVE.replace("'", "’"))).toEqual(
      deriveAttackEffect(SPECIAL_ACTIVE),
    );
    expect(deriveAttackEffect(TYPED_ACTIVE.replace("'", "’"))).toEqual(
      deriveAttackEffect(TYPED_ACTIVE),
    );
    expect(deriveAttackEffect(SWEEP_ALL.replace("'", "’"))).toEqual(
      deriveAttackEffect(SWEEP_ALL),
    );
    // The control that stops the three above passing on a broken import: a
    // sentence with no apostrophe at all still derives to something.
    expect(deriveAttackEffect("Discard an Energy from this Pokémon.")).not.toBeNull();
  });

  it("all EIGHT printings are in the corpus at the counts this slice claims", () => {
    // The population claim, driven rather than written in the header. The corpus
    // is `legal_standard = 1` only, which is why Growlithe's rotated `{W}`
    // printing is NOT here and is named in §6 instead.
    const corpus = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(corpus.get(SPECIAL_ACTIVE)).toBe(4);
    expect(corpus.get(TYPED_ACTIVE)).toBe(2);
    expect(corpus.get(SWEEP_ALL)).toBe(2);
    expect(corpus.get("Discard an Energy from your opponent's Active Pokémon ex.")).toBe(1);
    // 4 + 2 + 2 = 8 bought, 1 refused, 9 in the block.
    expect(
      [SPECIAL_ACTIVE, TYPED_ACTIVE, SWEEP_ALL].reduce((sum, s) => sum + (corpus.get(s) ?? 0), 0),
    ).toBe(8);
  });
});

describe("D361 §2 — the SPECIAL arm on a board: their ACTIVE, one Energy, and only a Special", () => {
  it("parks on a real pick, strips exactly one SPECIAL, and leaves every Basic where it is", () => {
    // Two DISTINCT Special prints on their Active makes WHICH a real question;
    // the two Basics beside them are what a collapse to `anyEnergy` would offer.
    let state = ready(1);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-water-energy", 1);
    deepFreeze(state);

    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    // 🛑 THE ASSERTION THAT KILLS A WIDENED FILTER: exactly the two Specials are
    // offered. Under `anyEnergy` this list is four long and the player can strip
    // a Basic the card does not name.
    expect(
      parked.phase.prompt.discardable
        .map((d) => parked.cardIdByUid[d.uid] ?? "?")
        .sort(),
    ).toEqual(["fix-special", "fix-special-2"]);
    expect(parked.phase.seat).toBe("p1"); // the ATTACKER decides, about a board they do not own
    // The caption is the printed sentence, byte for byte.
    expect(parked.phase.prompt.note).toBe(SPECIAL_ACTIVE);
    expect(parked.phase.prompt.scope).toEqual({ kind: "total", count: 1 });

    const pick = parked.phase.prompt.discardable[0]?.uid as string;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    // ONE came off, and it is a Special. Both Basics survive.
    expect(energyIds(done, "p2").sort()).toEqual(["fix-energy", "fix-special-2", "fix-water-energy"]);
    // It landed in the VICTIM's pile, not the actor's — `discardVictimSeat`.
    expect(discardIds(done, "p2")).toContain("fix-special");
    expect(discardIds(done, "p1")).not.toContain("fix-special");
  });

  it("the ACTIVE only — a Special on their BENCH is never in reach", () => {
    // The `opponentActive` / `opponentEach` discriminator, driven on a board
    // where the wrong member has something to take. §4 runs the same board
    // through the sweep and reaches the benched one.
    let state = ready(2);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special-2", 1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // One Special on the Active is a FORCED pick, so it resolves without a prompt
    // (the M1 no-choice rule) — and the benched Special is untouched.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(findAll(events, "ENERGY_DISCARDED")).toHaveLength(1);
    expect(energyIds(done, "p2")).toEqual([]);
    expect(energyIds(done, "p2", 0)).toEqual(["fix-special-2"]);
  });

  it("no Special anywhere on their Active is a silent no-op, not a whiffed attack", () => {
    let state = ready(3);
    state = attachFromDeck(state, "p2", "fix-energy", 2);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findAll(events, "ENERGY_DISCARDED")).toHaveLength(0);
    expect(energyIds(done, "p2")).toEqual(["fix-energy", "fix-energy"]);
    expect(types(events)).toContain("ATTACK_DECLARED");
  });
});

describe("D361 §3 — the TYPED arm: PROVISION, not print, and on THEIR side", () => {
  it("takes a {R}-PROVIDING Energy and leaves {W} and {C} alone — including the WILDCARD", () => {
    // 🛑 THE CASE THAT MAKES `providesEnergy` THE RIGHT FILTER RATHER THAN
    // `basicEnergy`: Luminous is a SPECIAL Energy and it IS a {R} Energy while it
    // sits alone, so it must be offered. A print-based reading misses it.
    let state = ready(4);
    state = attachFromDeck(state, "p2", "fix-fire-energy", 1);
    state = attachFromDeck(state, "p2", "sv02-191", 1); // Luminous — provides every type
    state = attachFromDeck(state, "p2", "fix-water-energy", 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    deepFreeze(state);

    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(
      parked.phase.prompt.discardable.map((d) => parked.cardIdByUid[d.uid] ?? "?").sort(),
    ).toEqual(["fix-fire-energy", "sv02-191"]);

    const luminous = parked.phase.prompt.discardable.find(
      (d) => parked.cardIdByUid[d.uid] === "sv02-191",
    )?.uid as string;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [luminous] },
    });
    expect(energyIds(done, "p2").sort()).toEqual([
      "fix-energy",
      "fix-fire-energy",
      "fix-water-energy",
    ]);
  });

  it("🛑 PROVISION IS HOST-DEPENDENT — a DEMOTED Luminous is no longer a {R} Energy", () => {
    // The same card on the same spot, one attachment different. Luminous provides
    // every type ALONE and only {C} beside another Special, so the second Special
    // takes it back out of the offer. This is the case a card-only reading of the
    // filter cannot produce, and it is why `matchesAttached` evaluates per Energy
    // ON ITS HOST.
    let state = ready(5);
    state = attachFromDeck(state, "p2", "sv02-191", 1);
    state = attachFromDeck(state, "p2", "fix-special", 1); // demotes Luminous to {C}
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // Nothing on their Active provides {R} any more, so the arm whiffs — and the
    // Special that caused the demotion is NOT taken either (this is the {R} arm,
    // not the Special one).
    expect(findAll(events, "ENERGY_DISCARDED")).toHaveLength(0);
    expect(energyIds(done, "p2").sort()).toEqual(["fix-special", "sv02-191"]);
  });

  it("the CONTROL for the two above — the SAME board, the SPECIAL arm, and a different Energy moves", () => {
    // Without this, §3's whiff could be an attack that does nothing at all rather
    // than a filter that correctly matched nothing.
    let state = ready(5);
    state = attachFromDeck(state, "p2", "sv02-191", 1);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // Two Specials now (Luminous is one), so this PARKS where the {R} arm whiffed.
    expect(done.phase.kind).toBe("effect:choose");
    expect(findAll(events, "ENERGY_DISCARDED")).toHaveLength(0); // not yet — it parked
  });
});

describe("D361 §4 — the SWEEP: `count: \"all\"` is EVERY match on EVERY body, not one each", () => {
  it("🛑 strips ALL Special Energy from ALL of their Pokémon, INLINE, and asks nothing", () => {
    // 🛑 THE CLAIM `count: "all"` BUYS, AND THE ONE GIACOMO'S SHAPE CANNOT MAKE.
    // Their Active holds TWO Specials and their Bench holds one. Giacomo's
    // one-per-body sweep takes 2 (and PARKS, because two Specials on one body is
    // a real pick); this sentence takes all 3 and asks nothing.
    let state = ready(6);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-water-energy", 1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 2 });
    // INLINE: the `count === "all"` branch fires before the scope split, so this
    // never parks, never prompts and never crosses the wire.
    expect(done.phase.kind).not.toBe("effect:choose");
    // ⚠️ `ENERGY_DISCARDED` IS ONE ROW PER BODY CARRYING A `uids[]`, not one row
    // per Energy — so TWO rows for THREE Energy is the shape that proves both
    // halves at once: the sweep reached two distinct bodies AND took everything
    // matching on each. A per-Energy count could not tell "3 off the Active" from
    // "2 + 1 across the board", which is the exact distinction this arm exists for.
    const rows = findAll(events, "ENERGY_DISCARDED");
    expect(rows).toHaveLength(2);
    expect(rows.flatMap((r) => r.uids)).toHaveLength(3);
    expect(new Set(rows.map((r) => r.host)).size).toBe(2);
    expect(rows.every((r) => r.seat === "p2" && r.actor === "p1")).toBe(true);
    // Every Special gone, from BOTH bodies; every Basic still exactly where it was.
    expect(energyIds(done, "p2")).toEqual(["fix-energy"]);
    expect(energyIds(done, "p2", 0)).toEqual(["fix-water-energy"]);
    expect(discardIds(done, "p2").filter((id) => id.startsWith("fix-special"))).toEqual([
      "fix-special",
      "fix-special",
      "fix-special-2",
    ]);
    // The victim's own pile, again — the sweep does not cross the seat either.
    expect(discardIds(done, "p1").some((id) => id.startsWith("fix-special"))).toBe(false);
  });

  it("it is THEIR whole board and not YOURS — the actor's own Specials are untouched", () => {
    let state = ready(7);
    state = attachFromDeck(state, "p1", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    deepFreeze(state);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 2 });
    expect(energyIds(done, "p1").sort()).toEqual(["fix-energy", "fix-special"]);
    expect(energyIds(done, "p2")).toEqual([]);
  });

  it("an opponent board with no Special anywhere is a silent no-op", () => {
    let state = ready(8);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-water-energy", 1);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 2 });
    expect(findAll(events, "ENERGY_DISCARDED")).toHaveLength(0);
    expect(energyIds(done, "p2")).toEqual(["fix-energy"]);
    expect(energyIds(done, "p2", 0)).toEqual(["fix-water-energy"]);
  });
});

describe("D361 §5 — the SHAPE RULE over BOTH producers, stated so neither can drift", () => {
  it("🛑 EVERY `opponentEach` discard carries EITHER no count OR `\"all\"` — never a number", () => {
    // The biconditional the type widening makes checkable, walked over BOTH
    // producers with a RECURSIVE flatten. A number on this arm would be silently
    // ignored by the interpreter (the scope is `{kind:"each"}` regardless), which
    // is exactly what `count?: never` was written to prevent — and `"all"` is the
    // one value that is NOT ignored, because it takes a different branch.
    const ops: Record<string, unknown>[] = [];
    for (const id of registryCardIds()) discardOps(programFor(id), ops);
    for (const [, text] of legalAttackCorpus()) discardOps(deriveAttackEffect(text), ops);

    const sweeps = ops.filter((o) => o.from === "opponentEach");
    for (const op of sweeps) {
      expect(typeof op.count === "number", JSON.stringify(op)).toBe(false);
      expect(op.count === undefined || op.count === "all", JSON.stringify(op)).toBe(true);
    }
    // 🛑 BOTH ARMS NON-EMPTY, WHICH IS WHAT STOPS THE LOOP ABOVE BEING VACUOUS —
    // and each arm's population names its own printed reason:
    //   • `undefined` = "a Special Energy from EACH" (Giacomo, the REGISTRY),
    //   • `"all"`     = "ALL Special Energy from ALL of" (Ceruledge, the DERIVER).
    // A partition, not a tautology: every sweep is in exactly one arm.
    const oneEach = sweeps.filter((o) => o.count === undefined);
    const allOfIt = sweeps.filter((o) => o.count === "all");
    expect(oneEach.length).toBeGreaterThan(0);
    expect(allOfIt.length).toBeGreaterThan(0);
    expect(oneEach.length + allOfIt.length).toBe(sweeps.length);
  });

  it("the two producers AGREE on the one sentence they both express — Mawile's op IS the derived one", () => {
    // 🛑 D360's LESSON, ONE OP OVER. `Discard a Special Energy from your
    // opponent's Active Pokémon.` is printed on Mawile's ABILITY (registry,
    // `sv03-143`) and on four ATTACKS (derived). Before this slice the two
    // producers could not disagree because only one of them expressed it; now
    // both do, so the agreement is asserted rather than assumed.
    const fromRegistry = programFor("sv03-143")?.triggered?.[0]?.program?.[0];
    const fromDeriver = (deriveAttackEffect(SPECIAL_ACTIVE) as EffectOp[])[0];
    expect(fromRegistry).toMatchObject({
      op: "discardEnergy",
      from: "opponentActive",
      filter: { kind: "specialEnergy" },
    });
    expect(fromDeriver).toEqual(fromRegistry);
  });

  it("no `to` and no `recordAs` leaked onto either new shape", () => {
    // `to: "hand"` is unrepresentable on the sweep and meaningless on these three
    // (nothing printed here returns Energy to a hand), and `recordAs` files a
    // §9.2 slot no downstream op in these programs reads.
    for (const text of [SPECIAL_ACTIVE, TYPED_ACTIVE, SWEEP_ALL]) {
      for (const op of discardOps(deriveAttackEffect(text))) {
        expect(op.to, text).toBeUndefined();
        expect(op.recordAs, text).toBeUndefined();
        expect(op.cap, text).toBeUndefined();
      }
    }
  });
});

describe("D361 §6 — what the anchors REFUSE, and every refusal is a real catalog row or a measured absence", () => {
  it("🛑 the SWEEP anchor refuses GIACOMO's printed wording — a REGISTRY row must stay off the derived path", () => {
    // The sharpest near-miss in the file: the engine already BUILDS this sentence
    // from the other producer, at a DIFFERENT COUNT. A loose `(all|each)` here
    // would not merely over-derive — it would put one printed sentence on two
    // producers that disagree about how many Energy come off.
    expect(deriveAttackEffect(GIACOMO_PRINTED)).toBeNull();
    // And the registry really does build it, so the clash is live rather than
    // hypothetical. (This also proves the string above is the printed one.)
    expect(programFor("sv02-182")?.trainer?.[0]).toMatchObject({
      op: "discardEnergy",
      from: "opponentEach",
      filter: { kind: "specialEnergy" },
    });
    expect((programFor("sv02-182")?.trainer?.[0] as { count?: unknown }).count).toBeUndefined();
  });

  it("refuses every near-miss — each one a real catalog row, or an absence that was MEASURED", () => {
    for (const text of [
      // ── UNPRINTED CROSS-PRODUCTS. `a` pairs with `Active` and `all` pairs with
      //    `all of your opponent's Pokémon`; neither crossing returns a single row
      //    on any of the three columns, so a `(a|all) × (Active|all of)` matrix
      //    would have derived two sentences nobody prints.
      "Discard all Special Energy from your opponent's Active Pokémon.",
      "Discard a Special Energy from all of your opponent's Pokémon.",
      // 🆕🛑 **THE STRING THE SWEEP ANCHOR'S *SECOND* WORD DEFENDS, AND ITS
      //     ABSENCE HERE WAS A REAL GAP THE `--decision D361` PROBE FOUND.**
      //     `D361-sweep-anchor-swallows-giacomos-wording` loosens `all of` to
      //     `(all|each) of` and SURVIVED the first probe — because Giacomo prints
      //     *"Discard **a** Special Energy from each of…"* and the mutated anchor
      //     still requires *"all"*, so it never reached the sentence the row's
      //     `what` names. **THE ANCHOR IS DEFENDED BY TWO INDEPENDENT PRINTED
      //     WORDS**, and only a string that loosens the SECOND one can prove the
      //     second one is load-bearing. This sentence is printed by nobody — the
      //     catalog has `a … each of` (Giacomo, Trainer) and `all … all of`
      //     (Ceruledge, attack) and NEITHER crossing — so refusing it is refusing
      //     to author a card, and asserting it kills the mutant honestly.
      //     ⚠️ A ROW COUNT IS NOT A COVERAGE MAP: the row existed, the claim was
      //     true, and nothing checked the half of it the mutation actually moved.
      "Discard all Special Energy from each of your opponent's Pokémon.",
      // ── THE FLIP TWINS, AND THEIR ABSENCE IS THE EVIDENCE. The catalog prints
      //    the flipped form for `an Energy` (23 printings / 12 legal) and prints
      //    ZERO flipped Special or typed variants. Widening
      //    `FLIP_OPPONENT_ACTIVE_DISCARD` alongside would author a card.
      "Flip a coin. If heads, discard a Special Energy from your opponent's Active Pokémon.",
      "Flip a coin. If heads, discard a {R} Energy from your opponent's Active Pokémon.",
      // ── Krookodile `sv01-117`: a repeat count this engine cannot express, and it
      //    ENDS in the bare pattern's exact words. Refused by the leading `^` AND
      //    by the lowercase mid-sentence "discard".
      "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
      // ── A compound the widening now sits next to: Tool AND Special Energy, plus
      //    a `Before doing damage` ordering. One legal printing, deliberately LOUD.
      "Before doing damage, discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon.",
      // ── The opponent's BOARD (Crushing Hammer / Tool Scrapper wording) is the
      //    TRAINER arm — `opponentChosen`, not `opponentActive`, and no attack
      //    prints it.
      "Discard a Special Energy from 1 of your opponent's Pokémon.",
      "Discard a {R} Energy from 1 of your opponent's Pokémon.",
      // ── ANCHORS, pinned directly. Each keeps the pattern's own CAPITALISED first
      //    word, so it is the `^`/`$` and nothing else that refuses it. Drop either
      //    and these derive to a program implementing HALF a card.
      "This attack does 30 damage. Discard a Special Energy from your opponent's Active Pokémon.",
      "Discard a Special Energy from your opponent's Active Pokémon. Then, flip a coin.",
      "This attack does 30 damage. Discard all Special Energy from all of your opponent's Pokémon.",
      "Discard all Special Energy from all of your opponent's Pokémon. Then, flip a coin.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("🆕 TURTONATOR `sv08-137` — D361's REFUSAL WAS PAID AT D362, AND THE ADJECTIVE STILL DOES ALL THE WORK", () => {
    // 🛑 THIS CASE WAS A REFUSAL AND IS NOW A PURCHASE, WHICH IS WHY IT IS
    // REWRITTEN RATHER THAN DELETED. D361 asserted this sentence derived to
    // `null` and priced the reason: *"Discard an Energy from your opponent's
    // Active Pokémon **ex**."* needs an ex-ONLY board narrowing, and the nearest
    // existing condition `{ kind: "opponentActiveIsExOrV" }` is strictly WIDER
    // (ex **or V**), so reusing it would strip a Pokémon V the card does not
    // print. That reasoning was right and the ratio was wrong: D361 called it
    // "ONE new union member for ONE printing", then measured the predicate at
    // **8 sentences / 13 printings** against the wider member's **4 / 6** and
    // inverted its own recommendation. D362 bought `opponentActiveIsEx`.
    //
    // ⚠️ AND A GUARD KEYED ON A PREDECESSOR'S REFUSAL IS EXACTLY WHAT A
    // RED-SURFACE PREDICTION BUILT FROM CENSUS FIGURES AND POOL-KEYED COUNTS DOES
    // NOT REACH. This file went red unpredicted at D362; running the PLANNED
    // ANCHOR over every string literal in `packages/engine/src` would have found
    // it, and that step was skipped. Recorded here so the next slice runs it.
    expect(
      deriveAttackEffect("Discard an Energy from your opponent's Active Pokémon ex."),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsEx" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ]);
    // The bare sentence one word shorter STILL derives, and now the claim is
    // sharper than "it is not null": it derives to a DIFFERENT program — no gate
    // at all — so the printed adjective is the whole behavioural difference,
    // exactly as it was the whole refusal before.
    expect(
      deriveAttackEffect("Discard an Energy from your opponent's Active Pokémon."),
    ).toEqual([{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }]);
  });

  it("the ROTATED typed printing derives anyway — rotation decides who may PLAY a card, not what it SAYS", () => {
    // Growlithe `sv03.5-058` "Vaporize" prints the identical typed shape with
    // `{W}` and is `legal_standard = 0`. It is NOT in this slice's 8-printing
    // figure (the corpus is legal-only) and the arm covers it regardless — D358's
    // lesson applied prospectively rather than discovered afterwards.
    expect(deriveAttackEffect("Discard a {W} Energy from your opponent's Active Pokémon.")).toEqual([
      {
        op: "discardEnergy",
        from: "opponentActive",
        filter: { kind: "providesEnergy", energyType: "Water" },
      },
    ]);
    // And it is genuinely absent from the legal corpus, which is what makes the
    // sentence above a claim rather than a slogan.
    expect(
      legalAttackCorpus().some(
        ([, s]) => s === "Discard a {W} Energy from your opponent's Active Pokémon.",
      ),
    ).toBe(false);
  });
});
