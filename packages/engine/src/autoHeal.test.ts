import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setBenchDamage,
  typedEnergy,
} from "./testFixtures";

// D356 — MAGEARNA `sv09-107` "AUTO HEAL": THE SELF DIRECTION OF `onEnergyAttach`,
// AND THE ONE OP IT NEEDED.
//
// ── THE PRINTED SENTENCE, TRANSCRIBED OFF D1 AND NOT OFF A CENSUS BULLET ────
//   "**As long as this Pokémon is in the Active Spot,** whenever you attach an
//    Energy card from your hand to 1 of your Pokémon, heal 90 damage from that
//    Pokémon."
//        — Magearna `sv09-107`, Basic, {M}, HP 90, retreat 1, mark I, 1 legal
//          printing. Ability index 0.
//
// ⚠️ **EVERY PRIOR QUOTE OF THIS ABILITY IN THIS REPO DROPPED THE OPENING
// CLAUSE.** Three test files and the resume point all began the quote at
// *"whenever you attach"*. The card opens *"As long as this Pokémon is in the
// Active Spot,"* — and **that clause IS `activeOnly`**, a field that has existed
// since M4 slice 6. The dropped words were themselves part of why two slices
// read the price as high. Driven in §5.
//
// ── THE CENSUS, RE-RUN AT THIS HEAD OVER ALL THREE COLUMNS ──────────────────
// Remote D1 `luminous` (`735f0fb5-…`, 3,786 rows / 2,021 `legal_standard`),
// 2026-08-17, keyed on **`$.effect`** in BOTH JSON columns, and **every cut
// controlled against a raw `LIKE` on the same column** — the control agreed on
// every one, so no false zero is hiding here (D355 paid this; it is not skipped
// because it passed last time).
//
//   `instr(<col>,'whenever you attach')`
//         `abilities_json`  3 rows / **1 legal**
//         `attacks_json`    0 rows /   0 legal
//         `effect`          0 rows /   0 legal
//         ──────────────────────────────────────
//         TOTAL             3 printings / **1 legal**, and the 1 is this card.
//
// ── 🛑 STEP 4, THE QUESTION TWO SLICES REFUSED THIS ROW WITHOUT ASKING: WHAT
//        DOES THE TRIGGER POINT REACH BEYOND `sv09-107`? MEASURED. ───────────
//
// D354 and D355 both refused this row as *"a whole new `triggers.ts` trigger
// point for 1 legal printing"*. **THE RATIO WAS RIGHT AND THE PRICE WAS WRONG,
// AND THOSE ARE TWO DIFFERENT CLAIMS** — the population really is one printing,
// and the machinery really was already standing. Both halves are recorded here
// because recording only one of them is how this row got refused twice.
//
// The reach was measured in three separate directions rather than asserted:
//
//   (a) **THE SWEEP, at the moment it is wired to.** The self direction of
//       `onEnergyAttach` is 3 printings. Beyond `sv09-107` it reaches **Minior
//       `sv04-099`/`sv04-201`** — `legal_standard = 0` both, the SAME timing with
//       an optional-switch consequent, and additionally blocked on a *benched*-only
//       gate (*"if this Pokémon is on your Bench"*) that is `activeOnly`'s mirror
//       and does not exist. **2 further printings, 0 further legal.**
//
//   (b) **THE SWEEP, at the two OTHER moments the opponent direction is already
//       wired to.** `runWatchedTriggers` is called at three sites (`onEnergyAttach`,
//       `onEvolve`, `onActiveMovedToBench`); `runSelfWatchedTriggers` at one.
//       Wiring it at the other two would reach **NOTHING**: `'henever you evolve'`
//       returns **0** rows over all three columns, and `'moves to the Bench'`
//       without `'opponent'` returns **0** (the single such row is Magcargo's,
//       which is the opponent direction and is built). **0 further printings.**
//
//   (c) **THE OP.** `'damage from that Pokémon'` is 11 printings / 8 legal — but
//       **`healSubject` reaches almost none of them, and that is a mechanism fact
//       rather than a count.** Hydrapple ex ×4 (`sv07-014`/`-156`/`-167`/
//       `sv08.5-011`, all legal) and Leafeon ×3 (`sv06-011`/`sv08.5-005`/`svp-170`,
//       all legal) print a SELF-PERFORMED attach — the op already holds the ref it
//       just fed, so they are `attachEnergyFrom.healTarget` (D236) and are ALREADY
//       BUILT (the first four in `registry.ts`, the second three by the deriver).
//       Garganacl ×2 is Hydrapple's shape from the discard, rotated. The one
//       printing whose shape is genuinely `healSubject`'s is **Medical Energy
//       `sv04-182`** — *"When you attach this card from your hand to 1 of your
//       Pokémon, **heal 30 damage from that Pokémon**"*, Magearna's consequent
//       byte-for-byte at 30 — and it is `legal_standard = 0`, on the Special-Energy
//       RIDER path (Jet Energy `sv02-190`'s path, which is built).
//       **1 further printing, 0 further legal.**
//
// 🛑 **SO THE ANSWER IS: THE TRIGGER POINT REACHES NOTHING FURTHER THAT IS
// STANDARD-LEGAL. Beyond `sv09-107` it reaches exactly THREE ROTATED PRINTINGS**
// (Minior ×2 through the sweep, Medical Energy ×1 through the op). **THAT IS A
// FINDING AND NOT A FAILURE**, and it is the finding two slices declined to
// measure: the ratio they refused on was *correct*, and it was never the
// question, because what they priced — a trigger point — had been standing since
// D319. `onEnergyAttach` was a `TriggerTiming`, the moment was fired at turn.ts
// §6.2, `triggersOf` had partitioned self/opponent, and `activeOnly` predates all
// of it. **A REFUSAL INHERITED IS NOT A MEASUREMENT, AND A RATIO IS NOT A PRICE.**
//
// ── THE ENGINE DIFF, AND WHY THE SEAT IS A SECOND OP AND NOT A FIELD ────────
// `healSubject` is `damageSubject`'s pronoun twin. **The seat comes off the
// printed POSSESSIVE, not off the scan direction**: Gengar ex prints *"1 of
// **their** Pokémon"* and reads `otherSeat(ctx.seat)`; Magearna prints *"1 of
// **your** Pokémon"* and reads `ctx.seat`. Both are watched triggers where
// `ctx.seat` is the WATCHER, so a shared "heal wherever the uid is" helper would
// have made the two possessives unreadable from the op — and would silently let a
// future *"their"* sentence heal across the table. Driven in §3.
//
// ── ⚠️ THE `mutants.ts` SCAN CAME BACK **FULL** (66 rows), AND THE SCANNER WAS
//        BROKEN WITH THREE CONTROLS GREEN ────────────────────────────────────
// A byte-range overlap of every mutant `find` against every function this slice's
// base commit touched. **The first extractor reported `stepOp` as a 167-byte body
// with ZERO rows.** `stepOp`'s RETURN TYPE is `{ done: … } | { park: … }` —
// braced — so the body scan latched onto the TYPE ANNOTATION. This is **D355's
// bug one position to the right**: D355's closed early on a braced *parameter
// default* (`record: EffectRecord = {}`), and D355's own fix (balance the
// parameter parens first) does **not** cover a braced *return type*. Controls 1–3
// (`ownerNoun`, `switchBenchNarrowing`, `runProgram`) all passed while it was
// broken, because none of those three has one. **A FOURTH CONTROL, CHOSEN
// SPECIFICALLY TO HAVE A BRACED RETURN TYPE, IS WHAT EXPOSED IT** — the real
// `stepOp` body is **85,785 bytes** carrying **58 rows**.
// ⚠️ **"ONE CONTROL IS A COIN FLIP" GENERALISES: A CONTROL ONLY TESTS THE SYNTAX
// IT HAPPENS TO CONTAIN**, so the count of controls matters less than whether
// they SPAN the shapes the extractor must parse.

// ── THE FIXTURE ─────────────────────────────────────────────────────────────

/** ⚠️ **REAL IDS ON A LOCAL `cardPool` (D275's idiom), AND `FIXTURE_POOL` IS NOT
    TOUCHED** — for the sixteenth slice running. **A FIXTURE IS A CENSUS
    POPULATION** (D348): §7 asserts BY ID that nothing here reached `FIXTURE_POOL`,
    and that every synthetic body is absent from `registryCardIds()` too — the
    guard covers every id the SUITE names, not the one it is ABOUT (D354's
    defect (D)).

    ⚠️ **TWO of the ids here are REAL and both are load-bearing.** `sv09-107` is
    the card under test; `sv05-104` is Gengar ex, and it must be the REAL id
    because §4's whole point is that the OPPONENT-direction program resolves out
    of the registry at the same moment — a synthetic id would make `programFor`
    return undefined and §4 would pass by measuring nothing.

    ⚠️ **A CARRIED ID ROTS, INCLUDING FROM MEMORY** (D353 wrote `sv09-160` for
    Mist Energy; D1 says that id is Maractus). Both real ids below were read out of
    the remote D1 in the session that wrote this file, with their `hp`, `stage`,
    `types_json`, `retreat` and `regulation_mark`. Magearna is HP **90** / Basic /
    {M} / retreat 1 / mark I; Gengar ex is HP **310** / Stage2 / **{D}** / retreat 2
    / mark H, evolving from Haunter. */
const MAGEARNA = "sv09-107";
const GENGAR = "sv05-104";

const AUTO_HEAL_TEXT =
  "As long as this Pokémon is in the Active Spot, whenever you attach an Energy " +
  "card from your hand to 1 of your Pokémon, heal 90 damage from that Pokémon.";
const GNAWING_CURSE_TEXT =
  "Whenever your opponent attaches an Energy card from their hand to 1 of their " +
  "Pokémon, put 2 damage counters on that Pokémon.";

/** A TANK rather than a second Magearna, and the reason is arithmetic: Magearna
    is HP 90, so a body that can carry more than 90 damage is the only place a
    90-point heal is distinguishable from "healed to zero by any amount". */
const TANK = "d356-tank";
const SMALL = "d356-small"; // HP 60 — the CLAMP's demonstrator
const PLAIN = "d356-plain"; // no ability at all — §2b's control body
const METAL = "d356-metal-energy";

const LOCAL_CARDS: Record<string, Card> = {
  [MAGEARNA]: battler(MAGEARNA, {
    name: "Magearna",
    hp: 90,
    retreat: 1,
    types: ["Metal"],
    abilities: [{ type: "Ability", name: "Auto Heal", effect: AUTO_HEAL_TEXT }],
    attacks: [{ name: "Spike Draw", cost: ["Colorless"], damage: "20", effect: "Draw 2 cards." }],
  }),
  [GENGAR]: battler(GENGAR, {
    name: "Gengar ex",
    hp: 310,
    retreat: 2,
    types: ["Darkness"],
    stage: "Stage2",
    evolveFrom: "Haunter",
    abilities: [{ type: "Ability", name: "Gnawing Curse", effect: GNAWING_CURSE_TEXT }],
  }),
  [TANK]: battler(TANK, { name: "D356 Tank", hp: 300, retreat: 1, types: ["Metal"] }),
  [SMALL]: battler(SMALL, { name: "D356 Small", hp: 60, retreat: 1, types: ["Metal"] }),
  [PLAIN]: battler(PLAIN, { name: "D356 Plain", hp: 200, retreat: 1, types: ["Colorless"] }),
  [METAL]: typedEnergy(METAL, "Metal"),
};

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

/** This suite's own seeded deck (D270's rule). */
const DECK = deckOf({
  [MAGEARNA]: 4,
  [GENGAR]: 4,
  [TANK]: 8,
  [SMALL]: 8,
  [PLAIN]: 12,
  [METAL]: 24,
});

/** Three seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [9107, 9109, 9127] as const;

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

/** `actor` gets `activeId` in the Active Spot and `benchIds` on the Bench, plus
    one {M} Energy in hand; the other seat gets `foeActiveId` Active and a plain
    body benched.

    ⚠️ THE OTHER SEAT'S BENCH BODY IS LOAD-BEARING: §14.2 makes an empty Bench a
    LOSS the moment an Active leaves, and nothing below should ever be reading a
    game that ended for a reason the slice did not cause. */
function board(
  seed: number,
  actor: Seat,
  activeId: string,
  benchIds: readonly string[],
  foeActiveId: string = PLAIN,
): GameState {
  let state = localSetup(seed, actor);
  const foe = actor === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, actor, activeId);
  state = clearBench(state, actor);
  for (const id of benchIds) state = benchFromDeck(state, actor, id);
  state = setActiveFromDeck(state, foe, foeActiveId);
  state = clearBench(state, foe);
  state = benchFromDeck(state, foe, PLAIN);
  state = handFromDeck(state, actor, METAL, 1);
  return state;
}

/** Walk the clock so `seat` is on turn 3 or later — early-turn bans are not what
    any line below is measuring. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

/** Attach the seat's {M} Energy from hand onto `spot`. */
function attach(
  state: GameState,
  seat: Seat,
  spot: { spot: "active" } | { spot: "bench"; index: number },
): ReturnType<typeof applyAction> {
  return applyAction(deepFreeze(state), {
    type: "attachEnergy",
    seat,
    uid: handUid(state, seat, METAL),
    target: spot,
  });
}

function benchDamage(state: GameState, seat: Seat, index: number): number {
  return state.players[seat].bench[index]?.damage ?? -1;
}

function activeDamage(state: GameState, seat: Seat): number {
  return state.players[seat].active?.damage ?? -1;
}

function healedRows(events: readonly GameEvent[]): { uid: string; amount: number }[] {
  return events
    .filter((e): e is Extract<GameEvent, { type: "HEALED" }> => e.type === "HEALED")
    .map((e) => ({ uid: e.uid, amount: e.amount }));
}

function triggeredNames(events: readonly GameEvent[]): string[] {
  return events
    .filter((e): e is Extract<GameEvent, { type: "ABILITY_TRIGGERED" }> => {
      return e.type === "ABILITY_TRIGGERED";
    })
    .map((e) => e.ability);
}

// ── 1. THE PROGRAM IS THE SENTENCE, FIELD BY FIELD ───────────────────────────

describe("D356 §1 — the registry row carries the sentence's clauses in named fields", () => {
  it("🛑 the row is a TRIGGERED ability on `onEnergyAttach`, `activeOnly`, self-direction", () => {
    const program = programFor(MAGEARNA);
    expect(program).toBeDefined();
    expect(program?.triggered).toHaveLength(1);
    const triggered = program?.triggered?.[0];
    expect(triggered?.name).toBe("Auto Heal");
    expect(triggered?.trigger).toBe("onEnergyAttach");
    // *"As long as this Pokémon is in the Active Spot,"* — THE CLAUSE EVERY PRIOR
    // QUOTE IN THIS REPO DROPPED. It is not decoration: §5 drives it.
    expect(triggered?.activeOnly).toBe(true);
    // *"whenever **you** attach"* — the self direction is the DEFAULT, and the
    // whole spelling of it is the ABSENCE of `opponentAction`. Asserted as absent
    // rather than as `false`, because absent is what the row actually says.
    expect(triggered?.opponentAction).toBeUndefined();
    // `doesNotStack` is NOT printed — and cannot matter here anyway, since
    // `activeOnly` means at most one Magearna is ever a bearer.
    expect(triggered?.doesNotStack).toBeUndefined();
  });

  it("the program is ONE op, and its amount is the printed 90", () => {
    expect(programFor(MAGEARNA)?.triggered?.[0]?.program).toEqual([
      { op: "healSubject", amount: 90 },
    ]);
  });

  it("🛑 the row authors NO `attack` key — so `BUILT.attack`'s registry summand cannot move", () => {
    // Measured, not assumed. `censusAtHead`'s `BUILT.attack` stands still at this
    // head, and this is one of the three summands it could have moved through.
    expect(Object.keys(programFor(MAGEARNA) ?? {})).toEqual(["triggered"]);
  });
});

// ── 2. THE HEAL FIRES ON THE CONTROLLER'S OWN ATTACH ─────────────────────────

describe("D356 §2 — the self direction fires, and it heals the body just fed", () => {
  it.each(SEEDS)("seed %i — a damaged BENCHED body attached to is healed 90", (seed) => {
    let state = board(seed, "p1", MAGEARNA, [TANK]);
    state = setBenchDamage(state, "p1", 0, 200);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(110);
    expect(triggeredNames(result.events)).toEqual(["Auto Heal"]);
    expect(healedRows(result.events)).toHaveLength(1);
    expect(healedRows(result.events)[0]?.amount).toBe(90);
  });

  it.each(SEEDS)("seed %i — the ACTIVE can be the subject too (Magearna feeding itself)", (seed) => {
    // Magearna is HP 90, so it cannot carry 90 damage; 80 is the most it can hold
    // and still be standing, and the heal clamps to it. The point of the line is
    // the SPOT, not the number: `healSubject` searches the Active BEFORE the Bench.
    let state = board(seed, "p1", MAGEARNA, [TANK]);
    state = turnOf(state, "p1");
    state = { ...state, players: { ...state.players } };
    const active = state.players.p1.active;
    if (active === null) throw new Error("no active");
    state = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: { ...active, damage: 80 } } },
    };
    const result = attach(state, "p1", { spot: "active" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(activeDamage(result.state, "p1")).toBe(0);
    expect(healedRows(result.events)).toHaveLength(1);
    expect(healedRows(result.events)[0]?.amount).toBe(80);
    // The HEALED row names the body that was fed, and here that body is the
    // Active — asserted against the state rather than against the row itself, so
    // the line cannot pass by comparing an event to a copy of itself.
    const activeStack = result.state.players.p1.active?.stack ?? [];
    expect(healedRows(result.events)[0]?.uid).toBe(activeStack[activeStack.length - 1]);
  });

  it.each(SEEDS)("seed %i — §2b THE CONTROL: no Magearna, no heal, same board", (seed) => {
    // The line every §2 assertion needs. Without it, a build that healed on EVERY
    // attach would pass every line above.
    let state = board(seed, "p1", PLAIN, [TANK]);
    state = setBenchDamage(state, "p1", 0, 200);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(200);
    expect(healedRows(result.events)).toEqual([]);
    expect(triggeredNames(result.events)).toEqual([]);
  });
});

// ── 3. THE SEAT IS THE PRINTED POSSESSIVE, NOT THE SCAN DIRECTION ────────────

describe("D356 §3 — *'1 of **your** Pokémon'*: the heal never crosses the table", () => {
  it.each(SEEDS)("seed %i — the OPPONENT attaching does not fire a Magearna", (seed) => {
    // The direction test, and the one `runWatchedTriggers` would pass by accident
    // if `runSelfWatchedTriggers` swept `otherSeat(actorSeat)`. p1 holds Magearna;
    // p2 attaches on p2's own damaged body. Nothing of p2's is healed and Magearna
    // never triggers — *"whenever **YOU** attach"*.
    let state = board(seed, "p2", PLAIN, [TANK]);
    state = setActiveFromDeck(state, "p1", MAGEARNA);
    state = setBenchDamage(state, "p2", 0, 200);
    state = turnOf(state, "p2");
    const result = attach(state, "p2", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p2", 0)).toBe(200);
    expect(healedRows(result.events)).toEqual([]);
    expect(triggeredNames(result.events)).toEqual([]);
  });

  it.each(SEEDS)("seed %i — a damaged body ACROSS THE TABLE is untouched by the fire", (seed) => {
    // p1 attaches with Magearna Active; p2's benched body carries the same damage
    // as p1's. Exactly one of the two moves, and it is p1's.
    let state = board(seed, "p1", MAGEARNA, [TANK]);
    state = setBenchDamage(state, "p1", 0, 200);
    state = setBenchDamage(state, "p2", 0, 150);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(110);
    expect(benchDamage(result.state, "p2", 0)).toBe(150);
  });
});

// ── 4. THE ORDER, AND IT IS OBSERVABLE — turn.ts's CITED SECTION ─────────────

describe("D356 §4 — the self sweep runs BEFORE the opponent sweep", () => {
  it.each(SEEDS)("seed %i — Magearna vs Gengar ex on ONE attach: heal, THEN counters", (seed) => {
    // 🛑 THE ONE BOARD ON WHICH THE ORDER IS A NUMBER RATHER THAN A PREFERENCE.
    // p1 attaches onto a benched body carrying 50 damage while p1's Magearna is
    // Active and p2's Gengar ex is out. BOTH watched programs answer the one
    // moment, and the heal is CLAMPED to the damage present:
    //   self first  — heal min(90,50) = 50 → 0, then +20 counters  ⇒ **20**
    //   opponent first — +20 ⇒ 70, then heal min(90,70) = 70 → 0   ⇒ **0**
    // The turn player's own effects resolve first, and the attaching player is
    // the turn player. turn.ts §6.2 cites THIS section by name.
    let state = board(seed, "p1", MAGEARNA, [TANK], GENGAR);
    state = setBenchDamage(state, "p1", 0, 50);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(20);
    // Both fired, and the ORDER of the two announcements is the order of the two
    // sweeps — the events are the second reading of the same fact.
    expect(triggeredNames(result.events)).toEqual(["Auto Heal", "Gnawing Curse"]);
  });

  it.each(SEEDS)("seed %i — the CONTROL: Gengar ex alone puts its 2 counters on", (seed) => {
    // Without this, §4's `20` could be a heal that never happened plus counters
    // that never happened either.
    let state = board(seed, "p1", PLAIN, [TANK], GENGAR);
    state = setBenchDamage(state, "p1", 0, 50);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(70);
    expect(triggeredNames(result.events)).toEqual(["Gnawing Curse"]);
  });
});

// ── 5. THE CLAUSE EVERY PRIOR QUOTE DROPPED ─────────────────────────────────

describe("D356 §5 — *'As long as this Pokémon is in the Active Spot'*", () => {
  it.each(SEEDS)("seed %i — a BENCHED Magearna heals nothing at all", (seed) => {
    // `activeOnly: true`, driven. This is the field two slices priced as missing
    // machinery; it has existed since M4 slice 6, and the words that name it were
    // dropped from every quote of this card in this repo before D356.
    let state = board(seed, "p1", PLAIN, [MAGEARNA, TANK]);
    state = setBenchDamage(state, "p1", 1, 200);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 1)).toBe(200);
    expect(healedRows(result.events)).toEqual([]);
    expect(triggeredNames(result.events)).toEqual([]);
  });

  it.each(SEEDS)("seed %i — the same board with Magearna ACTIVE does heal — the pair", (seed) => {
    // D231's falsifiability shape: the gate is only a gate if the other side of it
    // is driven on an otherwise identical board.
    let state = board(seed, "p1", MAGEARNA, [PLAIN, TANK]);
    state = setBenchDamage(state, "p1", 1, 200);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 1)).toBe(110);
  });
});

// ── 6. THE CLAMP, AND THE SILENT WHIFF ──────────────────────────────────────

describe("D356 §6 — clamped to the damage present, and silent when there is none", () => {
  it.each(SEEDS)("seed %i — 30 damage heals 30, not 90", (seed) => {
    // `healSelf`'s rule verbatim: never drives damage below 0, never heals past
    // what is there. The HEALED row carries what was ACTUALLY healed.
    let state = board(seed, "p1", MAGEARNA, [SMALL]);
    state = setBenchDamage(state, "p1", 0, 30);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(0);
    expect(healedRows(result.events)[0]?.amount).toBe(30);
  });

  it.each(SEEDS)("seed %i — an UNDAMAGED body emits NO `HEALED` row", (seed) => {
    // 🛑 A WHIFF IS SILENT, not a row saying nothing happened. The Ability still
    // ANNOUNCES (the bearer is Active and the moment fired) — the two facts are
    // separate, and conflating them is how a build reports heals it never did.
    let state = board(seed, "p1", MAGEARNA, [TANK]);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(0);
    expect(healedRows(result.events)).toEqual([]);
    expect(triggeredNames(result.events)).toEqual(["Auto Heal"]);
  });
});

// ── 7. THE FIXTURE IS A CENSUS POPULATION, AND THE BATON ─────────────────────

describe("D356 §7 — the pool, the registry keys, and the expiring insertion-order pin", () => {
  it("🛑 THE BATON, CARRIED RATHER THAN READ. NINTH HAND-OFF", () => {
    // (D347 → D349 → D350 → D351 → D352 → D353 → D354 → D355 → this file.)
    // `censusAtHead`'s `raw[raw.length - 1]` is keyed on INSERTION ORDER and has
    // gone red on a constant nobody touched FOURTEEN consecutive times. **No grep
    // of any census FIGURE NAME reaches it** — only a grep of `registry.ts`'s
    // id-map tail does.
    // ⚠️ **THE WIDTH IS `slice(-1)`.** The width is the number of ids the LAST
    // slice added, and D356 added exactly ONE. Copying a previous width is how a
    // pin silently starts asserting a neighbour's row.
    // ⚠️ It is SPENT the moment the next registry row lands. **Re-point it; do not
    // delete it** — the CONTIGUITY claims in `remainingHpWindow.test.ts` §6,
    // `invitingWink.test.ts` §7, `pyroDance.test.ts` §7, `metalMaker.test.ts` §8,
    // `spikeClad.test.ts` §8 and `xBoot.test.ts` §6 are a DIFFERENT assertion and
    // do not substitute. `energyCoin.test.ts` §6 becomes the seventh of them.
    const raw = registryCardIds();
    expect(raw.slice(-1)).toEqual([MAGEARNA]);
  });

  it("🛑 the +1 on `raw.length` is EXACTLY this one id", () => {
    const keys = new Set(registryCardIds());
    expect(keys.has(MAGEARNA)).toBe(true);
    expect(registryCardIds().filter((id) => id === MAGEARNA).length).toBe(1);
    // ⚠️ D353's defect (D): the guard must cover every id the SUITE names, not the
    // one it is ABOUT. `sv05-104` is a real registry key too and is asserted as
    // one rather than swept in with the synthetics — the sharp case, because it is
    // exactly the id a careless loop would have called a violation.
    expect(keys.has(GENGAR)).toBe(true);
    for (const id of Object.keys(LOCAL_CARDS)) {
      if (id === MAGEARNA || id === GENGAR) continue;
      expect(keys.has(id)).toBe(false);
    }
  });

  it("nothing this suite defines reached `FIXTURE_POOL` — asserted by ID", () => {
    // **A FIXTURE IS A CENSUS POPULATION** (D348). `catalogManifest.test.ts` and
    // `clauseApostrophe.test.ts` sweep `FIXTURE_POOL`, and neither `sv09` nor
    // `sv05` is among `catalogManifest`'s six local sets, so a shared-pool body
    // would have owed a `fix-*` key AND a manifest classification. The local pool
    // owes neither — including for the two REAL ids, which are registry keys but
    // not fixture members.
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(FIXTURE_POOL[id]).toBeUndefined();
    }
  });
});

// ── 8. THE CENSUS, PINNED AS THE NEGATIVES IT ACTUALLY IS ────────────────────

describe("D356 §8 — what row 12's closure leaves behind", () => {
  it("🛑 ROW 12's ABILITY HALF IS CLOSED, AND WITH IT THE `ROWS` TABLE'S LAST LIVE RESIDUE", () => {
    expect(programFor(MAGEARNA)).toBeDefined();
    // `censusAtHead`'s `ROWS` non-attack total falls 6 → 5 and the LIVE residue
    // falls 1 → 0. What is left is row 9's five ids, every one refused on grounds
    // no engine slice can reach.
  });

  it("🛑 the sweep reaches TWO further printings and NEITHER is legal — Minior", () => {
    // Measured, not asserted: `sv04-099`/`sv04-201` are the only other printings of
    // *"whenever you attach"* in the catalog, both `legal_standard = 0`, both the
    // same timing with an optional-switch consequent, and both additionally blocked
    // on a BENCHED-only gate that is `activeOnly`'s mirror and does not exist.
    // Pinned as UNBUILT so that buying either reddens by name.
    expect(programFor("sv04-099")).toBeUndefined();
    expect(programFor("sv04-201")).toBeUndefined();
  });

  it("🛑 the OP's one further printing is Medical Energy, and it is rotated", () => {
    // `sv04-182` — *"When you attach this card from your hand to 1 of your Pokémon,
    // heal 30 damage from that Pokémon"*, Magearna's consequent byte-for-byte at
    // 30, on the SPECIAL-ENERGY RIDER path rather than the trigger path.
    // `legal_standard = 0`. Its switch twin on that same path, Jet Energy
    // `sv02-190`, IS built — which is what makes the rider path a real road and
    // this printing a real, if rotated, second consumer.
    expect(programFor("sv04-182")).toBeUndefined();
    expect(programFor("sv02-190")).toBeDefined();
  });

  it("🛑 the CONSEQUENT grammar's 7 OTHER legal printings are NOT this op's — all built", () => {
    // *"heal N damage from that Pokémon"* is 11 printings / 8 legal, and a count
    // read off that alone would have priced this op at 8. It is 1. The other seven
    // legal printings perform the attach THEMSELVES, so the op already holds the
    // ref and they are `attachEnergyFrom.healTarget` (D236) — Hydrapple ex ×4 in
    // the registry, Leafeon ×3 through the deriver. **A SHARED CONSEQUENT IS NOT A
    // SHARED MECHANISM**, and this is the line that says so by id.
    for (const id of ["sv07-014", "sv07-156", "sv07-167", "sv08.5-011"]) {
      expect(programFor(id)).toBeDefined();
    }
  });
});
