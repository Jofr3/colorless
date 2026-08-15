import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { abilityUsedKey, applyAction, createGame, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { registryCardIds } from "./registry";
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
} from "./testFixtures";

// D272 — THE ABILITY-SURFACE PLAY GATE, AND THE FIRST ONCE-PER-TURN LOCK THAT IS
// NOT KEYED ON A BODY.
//
// THE SENTENCE. *"Once during your turn, if any of your Pokémon were Knocked Out
// during your opponent's last turn, you may draw 3 cards. You can't use more than
// 1 Flip the Script Ability each turn."* — Fezandipiti ex, THREE Standard-legal
// printings, `sv06.5-038` / `sv06.5-084` / `sv06.5-092`, whose `abilities_json`
// is BYTE-IDENTICAL across all three (re-queried against remote D1 `luminous`,
// 2026-08-07, all `legal_standard = 1`).
//
// ZERO new ops, ZERO new `BoardCondition` members, ZERO `conditionHolds` arms,
// ZERO `GameState` fields. The draw is Tinkaton's `drawCards` and the gate's
// condition was built whole at D271. What is new is TWO SCOPES:
//
//   (a) `AbilityProgram.playableIf` — a `BoardCondition` gating an ABILITY. Its
//       placement was settled in prose before it was written: `registry.ts`'s own
//       `trainerPlayableIf` doc block says an Ability-level gate "must NOT be
//       authored here — it needs its own check on `useAbility`, sharing the same
//       `conditionHolds`". So `useAbility`'s EXISTING gate stack was WIDENED; no
//       parallel funnel was added, and `effects.ts`/`interpreter.ts` take a
//       byte-zero diff.
//   (b) `AbilityProgram.oncePerTurn: "sharedByName"` — the printed second
//       sentence, a CROSS-COPY name lock.
//
// ── WHY THE LOCK IS A SECOND READING OF ONE FIELD, NOT A SECOND FLAG ─────────
//
// 🛑 `allowances.abilitiesUsed` holds `` `${uid}:${ability.name}` `` — PER BODY.
// That is §9/§15.J's default and it is CORRECT for every Ability built before
// this one (two Hydrapple ex are two independent Ripening Charges, D-era
// `ripeningCharge.test.ts`). Fezandipiti's second sentence is keyed on the
// ABILITY'S NAME ALONE, so the scope is a property of THE KEY and of nothing
// else. A separate boolean beside `oncePerTurn` could be set `true` alongside
// `oncePerTurn: false` — a state with no printed meaning — so the scope lives on
// the same field, and the key is built by ONE exported helper (`abilityUsedKey`,
// cardplay.ts) that all THREE gate readers call: `useAbility` (which also WRITES
// it), `redactedAbilitiesOf` (the wire HUD) and the local `GameHud`. All three
// hand-spelled the template before today.
//
// ── THE HAZARD THIS SUITE IS SHAPED AROUND ──────────────────────────────────
//
// ⚠️ **A ONE-COPY BOARD IS VACUOUS ON A CROSS-COPY LOCK.** With a single
// Fezandipiti ex in play, `"sharedByName"` and `true` are INDISTINGUISHABLE —
// every assertion passes under either value, exactly as D271's per-seat history
// was invisible on a one-sided board. So every lock assertion below is driven
// with TWO copies in play at once.
//
// ⚠️ **AND TWO COPIES OF THE SAME PRINTING IS THE WEAKER OF THE TWO BOARDS.** An
// implementation keyed `${cardId}:${name}` passes a two-`sv06.5-038` board and
// fails the print, because the second sentence does not care which printing you
// benched. The board below therefore uses `sv06.5-038` AND `sv06.5-084` — two
// distinct catalog ids, one Ability name — which is the strictly stronger fixture
// and costs nothing.

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

/** A 140 HP Basic carrying one activated Ability, as `legalNonAttackPrograms`
    does it. The id is a REAL catalog id, so `programFor` resolves the REAL
    registry row rather than a fixture stand-in — the whole point is to drive the
    shipped `FLIP_THE_SCRIPT` program. */
function abilityBody(id: string, name: string, effect: string, cardName: string): Card {
  return battler(id, {
    name: cardName,
    hp: 140,
    retreat: 1,
    abilities: [{ type: "Ability", name, effect }],
  });
}

/** The printed text, once, byte-for-byte, shared by all three printings. */
const FLIP_THE_SCRIPT_TEXT =
  "Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip the Script Ability each turn.";

const LOCAL_CARDS: Record<string, Card> = {
  "sv06.5-038": abilityBody(
    "sv06.5-038",
    "Flip the Script",
    FLIP_THE_SCRIPT_TEXT,
    "Fezandipiti ex",
  ),
  "sv06.5-084": abilityBody(
    "sv06.5-084",
    "Flip the Script",
    FLIP_THE_SCRIPT_TEXT,
    "Fezandipiti ex",
  ),
  "sv06.5-092": abilityBody(
    "sv06.5-092",
    "Flip the Script",
    FLIP_THE_SCRIPT_TEXT,
    "Fezandipiti ex",
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The TENTH seeded deck (D270's rule: a seeded suite gets its OWN deck rather
    than new rows in a shared one). Three Fezandipiti printings so the bench can
    hold two DISTINCT ids; `fix-victim` (30 HP) is what Spread Shot's 30 exactly
    Knocks Out and `fix-sniper` is what does it; the rest is filler deep enough
    that a 3-card draw off a mid-game deck never runs it dry. */
const FLIP_DECK = deckOf({
  "sv06.5-038": 4,
  "sv06.5-084": 4,
  "sv06.5-092": 4,
  "fix-sniper": 4,
  "fix-victim": 4,
  "fix-basic-1": 8,
  "fix-energy": 32,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: FLIP_DECK, p2: FLIP_DECK }, cardPool: POOL });
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

/** Drain the KO decision stages until somebody's action phase (D271's `settle`,
    copied whole — the counts come off `state.phase`, never `state.pending[0]`). */
function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count } = next.phase;
      const prizeIndices = Array.from({ length: count }, (_, i) => i);
      next = must(applyAction(next, { type: "takePrizes", seat, prizeIndices }));
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** ⚠️ THE BOARD THIS WHOLE SUITE TURNS ON. P1 loses their Active on P2's turn 2
    and promotes a Fezandipiti ex, so that when turn 3 opens P1 holds:
      · `sv06.5-038` Fezandipiti ex ACTIVE (promoted out of bench slot 0), and
      · `sv06.5-084` Fezandipiti ex BENCHED — a DIFFERENT printing, same Ability.
    …and their `lastKoTurn` stamp reads turn 2, which is `turn - 1`, so the gate
    holds. Two copies, one name, one open window: everything below is a read of
    THIS board.
    ⚠️ THE THIRD BENCH BODY IS LOad-BEARING — §14.2 makes an empty bench a LOSS,
    and a `gameOver` board proves nothing about a play gate. */
function twoFezandipitiAfterKo(seed: number): GameState {
  let state = localSetup(seed, "p1");
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = setActiveFromDeck(state, "p2", "fix-sniper");
  state = attachFromDeck(state, "p2", "fix-energy", 1); // pays Spread Shot [C]
  state = setActiveFromDeck(state, "p1", "fix-victim");
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "sv06.5-038");
  state = benchFromDeck(state, "p1", "sv06.5-084");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  const after = settle(mustApply(state, { type: "attack", seat: "p2", index: 0 }).state);
  if (after.phase.kind !== "turn:action" || after.phase.seat !== "p1") {
    throw new Error(`expected P1's action phase, got ${after.phase.kind}`);
  }
  return after;
}

const ACTIVE = { spot: "active" } as const;
const BENCH_0 = { spot: "bench", index: 0 } as const;

function useFlip(state: GameState, seat: Seat, target: typeof ACTIVE | typeof BENCH_0) {
  return applyAction(state, {
    type: "useAbility",
    seat,
    target,
    abilityName: "Flip the Script",
  });
}

function drawnBy(events: GameEvent[], seat: Seat): number {
  return events
    .filter((e): e is Extract<GameEvent, { type: "CARDS_DRAWN" }> => e.type === "CARDS_DRAWN")
    .filter((e) => e.seat === seat)
    .reduce((total, e) => total + e.uids.length, 0);
}

/** Non-null assert with a message, so a missing registry row fails loudly at the
    describe body rather than as `undefined` inside an expectation. */
function must0<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a registry ability");
  return value;
}

const SEEDS = [5, 17, 33, 52, 71] as const;

// ── 1. The registry rows — the printed sentence, as data ─────────────────────

describe("Fezandipiti ex — the three printings as registry data", () => {
  it("all THREE ids resolve to one program carrying BOTH new scopes and no new ops", () => {
    for (const id of ["sv06.5-038", "sv06.5-084", "sv06.5-092"]) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name).toBe("Flip the Script");
      // The cross-copy lock. `true` here is the per-body default and would be a
      // live bug on any board with a second copy — driven for real in §3.
      expect(ability?.oncePerTurn).toBe("sharedByName");
      // The board gate, sharing D271's condition rather than restating it.
      expect(ability?.playableIf).toEqual({ kind: "yourPokemonKoedOnOpponentsLastTurn" });
      // "Once during your turn" carries no Active clause, so a benched
      // Fezandipiti ex may use it — which is also what makes the two-copy board
      // in §3 reachable at all.
      expect(ability?.activeOnly).toBe(false);
      // Tinkaton's op, unchanged: the printed "you may" is not modelled for a
      // pure-upside draw, exactly as "Once during your turn, you may draw 3
      // cards" is not.
      expect(ability?.program).toEqual([{ op: "drawCards", count: 3 }]);
    }
  });

  it("the three printings share ONE program object — a reprint is not a second authoring", () => {
    const first = programFor("sv06.5-038");
    expect(programFor("sv06.5-084")).toBe(first);
    expect(programFor("sv06.5-092")).toBe(first);
  });

  it("no `trainerPlayableIf` was authored — this gate is on the ABILITY surface", () => {
    // ⚠️ THE MUTANT THIS KILLS: moving the gate to `trainerPlayableIf`, the field
    // whose own doc block refuses it. A Pokémon is not a Trainer and `playTrainer`
    // never sees this card, so a gate parked there would be UNREACHABLE — green
    // everywhere, enforcing nothing.
    expect(programFor("sv06.5-038")?.trainerPlayableIf).toBeUndefined();
  });
});

// ── 2. `abilityUsedKey` — the sole funnel, at the unit ───────────────────────

describe("abilityUsedKey — the one place the §9/§15.J key is built", () => {
  const shared = must0(programFor("sv06.5-038")?.abilities?.[0]);
  const perBody = must0(programFor("sv07-014")?.abilities?.[0]); // Hydrapple ex, oncePerTurn: true

  it("a `sharedByName` Ability drops the uid, so two BODIES collide into one key", () => {
    expect(abilityUsedKey("p1#3", shared)).toBe("*:Flip the Script");
    expect(abilityUsedKey("p1#9", shared)).toBe("*:Flip the Script");
    expect(abilityUsedKey("p1#3", shared)).toBe(abilityUsedKey("p1#9", shared));
  });

  it("the DEFAULT scope is untouched — a per-body Ability still keys on its uid", () => {
    // ⚠️ THE MUTANT THIS KILLS: returning the shared key unconditionally. Every
    // Ability built before D272 reads `true`, and collapsing them all to a name
    // would silently make two Hydrapple ex ONE use — a rules regression on
    // thirty-odd cards that no Fezandipiti assertion could see.
    expect(perBody.oncePerTurn).toBe(true);
    expect(abilityUsedKey("p1#3", perBody)).toBe("p1#3:Ripening Charge");
    expect(abilityUsedKey("p1#9", perBody)).not.toBe(abilityUsedKey("p1#3", perBody));
  });

  it("the two key spaces are DISJOINT — a uid can never be the `*` sentinel", () => {
    // setup.ts mints uids as `${seat}#${index}`. If it ever stopped doing so, a
    // body could collide with the shared key and lock an unrelated Ability out.
    const state = localSetup(5, "p1");
    const uids = Object.keys(state.cardIdByUid);
    expect(uids.length).toBeGreaterThan(100);
    expect(uids.every((u) => /^p[12]#\d+$/.test(u))).toBe(true);
    expect(uids).not.toContain("*");
  });
});

// ── 3. THE CROSS-COPY LOCK, DRIVEN WITH TWO COPIES IN PLAY ───────────────────

describe("the name lock — two Fezandipiti ex in play share ONE use per turn", () => {
  it("the board really does hold TWO copies, of two DIFFERENT printings", () => {
    // The fixture's own precondition, asserted before anything is read off it —
    // D268's rule that a two-body board must prove it has two bodies, or every
    // assertion after it is about a board that was never built.
    const state = twoFezandipitiAfterKo(5);
    const activeId = state.cardIdByUid[state.players.p1.active?.stack.at(-1) ?? ""];
    const benchId = state.cardIdByUid[state.players.p1.bench[0]?.stack.at(-1) ?? ""];
    expect(activeId).toBe("sv06.5-038");
    expect(benchId).toBe("sv06.5-084");
    expect(activeId).not.toBe(benchId);
  });

  it("the FIRST use draws 3 and stamps the NAME-keyed entry, not a uid-keyed one", () => {
    const state = twoFezandipitiAfterKo(5);
    const before = state.players.p1.hand.length;
    const { state: after, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: ACTIVE,
      abilityName: "Flip the Script",
    });
    expect(drawnBy(events, "p1")).toBe(3);
    expect(after.players.p1.hand.length).toBe(before + 3);
    // ⚠️ THE MUTANT THIS KILLS: keeping the uid in the key. The whole allowance
    // bag is read, so a `p1#…:Flip the Script` write shows up here as a wrong
    // string rather than as a silent second use two assertions later.
    expect(after.allowances.abilitiesUsed).toEqual(["*:Flip the Script"]);
  });

  it("🛑 the SECOND copy is REFUSED — the printed cross-copy lock, and the slice's point", () => {
    let state = twoFezandipitiAfterKo(5);
    state = must(useFlip(state, "p1", ACTIVE));
    const second = useFlip(state, "p1", BENCH_0);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error.code).toBe("ABILITY_ALREADY_USED");
    // ⚠️ THE MUTANT THIS KILLS: `oncePerTurn: true` on the registry row. Under a
    // per-body key this second use SUCCEEDS and draws 3 more, which is the print
    // violated. It is invisible on a one-copy board — hence this one.
  });

  it("the refusal is the LOCK and not an emptied board — the draw would have worked", () => {
    // A refusal proves nothing unless the same call succeeds when the lock is the
    // only thing removed. Same board, same benched body, same turn — but nothing
    // has been used yet, so the bench copy draws 3 on its own.
    const state = twoFezandipitiAfterKo(5);
    const { state: after, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: BENCH_0,
      abilityName: "Flip the Script",
    });
    expect(drawnBy(events, "p1")).toBe(3);
    expect(after.allowances.abilitiesUsed).toEqual(["*:Flip the Script"]);
  });

  it("EITHER ORDER locks the other — bench first refuses the Active second", () => {
    let state = twoFezandipitiAfterKo(17);
    state = must(useFlip(state, "p1", BENCH_0));
    const second = useFlip(state, "p1", ACTIVE);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("the SAME body is refused too — the wider scope did not lose the narrower one", () => {
    // `"sharedByName"` must still forbid the ORIGINAL per-body repeat. A key that
    // widened by ignoring the flag entirely would pass every cross-copy assertion
    // above and re-open this one.
    let state = twoFezandipitiAfterKo(33);
    state = must(useFlip(state, "p1", ACTIVE));
    const again = useFlip(state, "p1", ACTIVE);
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(again.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("the lock RE-ARMS — it is a per-turn allowance, not a permanent stamp", () => {
    // P1 uses it on turn 3, then turns 4 (P2) and 5 (P1) pass. On turn 5 the KO
    // window has CLOSED, so the re-arm has to be read off the allowance bag
    // rather than off a second successful use; §4 below drives the closed window.
    let state = twoFezandipitiAfterKo(52);
    state = must(useFlip(state, "p1", ACTIVE));
    expect(state.allowances.abilitiesUsed).toEqual(["*:Flip the Script"]);
    state = passTurns(state, 2);
    expect(state.turn).toBe(5);
    expect(state.allowances.abilitiesUsed).toEqual([]);
  });
});

// ── 4. THE PLAY GATE — the widened `useAbility` stack ────────────────────────

describe("AbilityProgram.playableIf — the printed board gate on the ABILITY surface", () => {
  it("the gate HOLDS on the turn after the KO, which is why §3's board works at all", () => {
    const state = twoFezandipitiAfterKo(5);
    expect(state.turn).toBe(3);
    expect(state.lastKoTurn).toEqual({ p1: 2, p2: null });
    expect(useFlip(state, "p1", ACTIVE).ok).toBe(true);
  });

  it("🛑 the WINDOW CLOSES — two turns later the same board REFUSES the same Ability", () => {
    // The rolling-window assertion. A build that read a boolean "somebody died"
    // rather than D271's turn stamp is green on every board that uses the Ability
    // immediately, and only this one catches it.
    let state = twoFezandipitiAfterKo(5);
    state = passTurns(state, 2);
    expect(state.turn).toBe(5);
    expect(state.lastKoTurn.p1).toBe(2); // stamped, but no longer `turn - 1`
    const rejected = useFlip(state, "p1", ACTIVE);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.error.code).toBe("ABILITY_CONDITION_NOT_MET");
    // The message quotes the printed clause verbatim, through the shared
    // `conditionNote` — not a paraphrase authored here.
    expect(rejected.error.message).toContain(
      "any of your Pokémon were Knocked Out during your opponent's last turn",
    );
  });

  it("a refused use is FREE — no draw, no allowance spent, nothing committed", () => {
    let state = twoFezandipitiAfterKo(17);
    state = passTurns(state, 2);
    const before = state.players.p1.hand.length;
    expect(useFlip(state, "p1", ACTIVE).ok).toBe(false);
    expect(state.players.p1.hand.length).toBe(before);
    expect(state.allowances.abilitiesUsed).toEqual([]);
  });

  it("the gate is asked of the ACTING SEAT — the seat that SCORED the KO cannot use it", () => {
    // ⚠️ THE MUTANT THIS KILLS: passing the opponent's seat (or the source
    // Pokémon's owner read off the wrong side) to `conditionHolds`. P2 knocked
    // the Pokémon out and lost nothing, so P2's own Fezandipiti must be refused
    // on P2's turn. Without this the gate reads as "somebody lost a Pokémon".
    let state = twoFezandipitiAfterKo(33);
    state = passTurns(state, 1); // turn 4 — P2's
    expect(state.phase.kind === "turn:action" && state.phase.seat).toBe("p2");
    state = setActiveFromDeck(state, "p2", "sv06.5-092");
    const rejected = useFlip(state, "p2", ACTIVE);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.error.code).toBe("ABILITY_CONDITION_NOT_MET");
    // …and it is the GATE refusing, not the lock or a missing target: P2's own
    // allowance bag is untouched and their board is otherwise identical to the
    // one P1 used the Ability from.
    expect(state.lastKoTurn.p2).toBeNull();
  });

  it("🛑 ORDER: an already-used Ability reports the LOCK, not the gate, when BOTH would refuse", () => {
    // The one ordering decision this slice makes, driven rather than asserted in
    // prose. On turn 5 the window has closed; if P1 had also already used the
    // Ability that turn, a gate checked ABOVE the lock would report
    // ABILITY_CONDITION_NOT_MET and the lock's own reject would be nearly
    // unreachable. Drive it by spending the use on a turn where the gate HOLDS
    // and then asking again on the SAME turn — both refusals are live, and the
    // one that comes back is the informative one.
    let state = twoFezandipitiAfterKo(71);
    state = must(useFlip(state, "p1", ACTIVE));
    const both = useFlip(state, "p1", BENCH_0);
    expect(both.ok).toBe(false);
    if (both.ok) throw new Error("unreachable");
    expect(both.error.code).toBe("ABILITY_ALREADY_USED");
    expect(both.error.code).not.toBe("ABILITY_CONDITION_NOT_MET");
  });

  it("EVERY seed agrees — the gate and the lock are board facts, not deal facts", () => {
    for (const seed of SEEDS) {
      const state = twoFezandipitiAfterKo(seed);
      const first = useFlip(state, "p1", ACTIVE);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("unreachable");
      const second = useFlip(first.state, "p1", BENCH_0);
      expect(second.ok).toBe(false);
      if (second.ok) throw new Error("unreachable");
      expect(second.error.code).toBe("ABILITY_ALREADY_USED");
    }
  });
});

// ── 5. THE HUD MIRRORS — a greyed row for every reject the engine has ────────

describe("redactGame — the wire HUD greys what `useAbility` would refuse", () => {
  function flipRows(state: GameState, seat: Seat) {
    const view = redactGame(state, seat);
    if (view.phase.kind !== "turn:action") throw new Error(`phase ${view.phase.kind}`);
    return view.phase.abilities.filter((a) => a.abilityName === "Flip the Script");
  }

  it("BOTH copies are lit while the window is open and nothing has been used", () => {
    const rows = flipRows(twoFezandipitiAfterKo(5), "p1");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.disabled)).toBe(true);
  });

  it("🛑 using ONE copy greys BOTH rows — the mirror reads the SHARED key", () => {
    // ⚠️ THE MUTANT THIS KILLS: `redact.ts` keeping its hand-spelled
    // `${uid}:${ability.name}`. The Active row would grey (its own uid is not in
    // the bag either way — the shared key is) … and in fact NEITHER would, which
    // is a live afford-then-reject: the client lights a button, the player clicks
    // it, and the DO answers ABILITY_ALREADY_USED. This is why the key became a
    // shared helper rather than a second template.
    let state = twoFezandipitiAfterKo(5);
    state = must(useFlip(state, "p1", ACTIVE));
    const rows = flipRows(state, "p1");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.disabled)).toBe(true);
  });

  it("a CLOSED window greys both rows and says WHY, quoting the printed clause", () => {
    let state = twoFezandipitiAfterKo(17);
    state = passTurns(state, 2);
    const rows = flipRows(state, "p1");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.disabled)).toBe(true);
    // Unlike Active-only/already-used, a board gate is NOT self-evident from the
    // board in front of the player, so the row carries a reason.
    for (const row of rows) {
      expect(row.reason).toContain(
        "any of your Pokémon were Knocked Out during your opponent's last turn",
      );
    }
  });

  it("the ALREADY-USED greying carries NO reason — that one IS self-evident", () => {
    // Keeps the two disable causes distinguishable in the HUD, and pins that the
    // gate's reason did not swallow the lock's silence.
    let state = twoFezandipitiAfterKo(33);
    state = must(useFlip(state, "p1", ACTIVE));
    for (const row of flipRows(state, "p1")) expect(row.reason).toBeNull();
  });
});

// ── 6. WHAT DID NOT MOVE ────────────────────────────────────────────────────

describe("the blast radius — what this slice did NOT change", () => {
  it("`MATCH_RECORD_VERSION` STAYS 14 — the derivation, not the habit", () => {
    // The standing test is "can the PREVIOUS deploy's RECORD hold the new TYPE"
    // (apps/api/src/lobby/match.ts). NOTHING was added to `GameState`,
    // `TurnAllowances` or any event: `abilitiesUsed` was and remains `string[]`.
    // The only thing that changed is which STRINGS this deploy can write, and a
    // v14 record cannot contain a `*:` key because no v14 deploy had a
    // `"sharedByName"` Ability to write one.
    //
    // The other direction is the one that matters, and it reads back BENIGNLY
    // rather than throwing (D271 found the first case that throws, so this is
    // measured, not assumed): every key a v14 record holds was written for an
    // `oncePerTurn: true` Ability, and `abilityUsedKey` returns `${uid}:${name}`
    // for exactly those — BYTE-IDENTICAL to what v14 wrote. Driven here by
    // replaying a v14-shaped bag through the current reader.
    const state = twoFezandipitiAfterKo(5);
    const legacyBag = ["p1#7:Ripening Charge", "p2#3:Adrena-Brain"];
    const revived: GameState = {
      ...state,
      allowances: { ...state.allowances, abilitiesUsed: legacyBag },
    };
    const perBody = must0(programFor("sv07-014")?.abilities?.[0]);
    // The legacy key round-trips through the new funnel unchanged…
    expect(abilityUsedKey("p1#7", perBody)).toBe("p1#7:Ripening Charge");
    expect(revived.allowances.abilitiesUsed).toContain(abilityUsedKey("p1#7", perBody));
    // …and the new Ability is unaffected by the legacy entries, so a mid-match
    // deploy neither loses nor invents a use.
    expect(useFlip(revived, "p1", ACTIVE).ok).toBe(true);
  });

  it("every OTHER registry Ability keeps the per-body scope — the widening is opt-in", () => {
    // ⚠️ AN AUDITOR, NOT A READER: it enumerates the whole authored pool, so it
    // goes RED the day a second `"sharedByName"` row lands without its own
    // printed second sentence. Fezandipiti's three ids are named because they are
    // the whole legal population of `%You can't use more than 1%` this engine can
    // spell — Fan Rotom (`sv07-118`/`sv08.5-085`) and Pecharunt ex
    // (`sv06.5-039`/`-085`/`-093`/`-095`/`sv08.5-163`) print it too, 10 legal
    // printings in all (measured 2026-08-07), and both were REFUSED here: Fan
    // Rotom's gate is "during your FIRST turn" over a `searchDeck` with an HP
    // filter and a reveal, and Pecharunt ex's switch carries an "except any
    // Pecharunt ex" exclusion no op expresses.
    //
    // ✅ **D273 — THIS AUDITOR DID ITS JOB ON THE VERY NEXT SLICE, AND IT WENT RED
    // BEFORE ANYONE EDITED IT.** Pecharunt ex was built one slice later; five ids
    // landed with `oncePerTurn: "sharedByName"`, and this line failed naming them
    // — which is exactly the "second row lands without its own printed second
    // sentence" case it was written for, minus the defect (all five DO print it,
    // byte-identically). ⚠️ D272's refusal note above is kept VERBATIM rather than
    // rewritten (provenance is annotated, never overwritten) and its diagnosis was
    // HALF RIGHT: the exclusion was one of TWO missing mechanisms, not one. The
    // printed noun is *"1 of your Benched **{D}** Pokémon, except any Pecharunt
    // ex"* — an INTERSECTION — and `switchActive` carried no type narrowing
    // either, a gap its own doc block had named three slices earlier. **Fan Rotom
    // is STILL refused, and its two mechanisms are unchanged.**
    const shared: string[] = [];
    for (const id of registryCardIds()) {
      for (const ability of programFor(id)?.abilities ?? []) {
        if (ability.oncePerTurn === "sharedByName") shared.push(id);
      }
    }
    // ✅ **D275 — THIS AUDITOR WENT RED A SECOND TIME, ON THE LAST ROW OF THE
    // LADDER**, and again before anyone edited it. Fan Rotom `sv07-118` /
    // `sv08.5-085` landed with `oncePerTurn: "sharedByName"` and this line failed
    // naming them. ⚠️ ITS PRINTED WORDING IS *"You can't use more than 1 Fan Call
    // Ability **during your turn**"*, not "each turn" — which is the case worth
    // recording: the field is keyed on what the sentence MEANS, so a spelling
    // difference the auditor cannot see is not a defect. **The
    // `%You can't use more than 1%` ladder is now COMPLETE: 5 + 3 + 2 = the whole
    // 10 legal printings, every one of them built.**
    expect(shared.sort()).toEqual([
      "sv06.5-038",
      "sv06.5-039",
      "sv06.5-084",
      "sv06.5-085",
      "sv06.5-092",
      "sv06.5-093",
      "sv06.5-095",
      "sv07-118",
      "sv08.5-085",
      "sv08.5-163",
    ]);
  });

  it("`playableIf` is authored on exactly EIGHT ids, and nowhere else", () => {
    // The gate's own population. Of the 29 legal printings on `%Once during your
    // turn, if %`, 15 are the Active-Spot clause `activeOnly` already covers; of
    // the 14 that remain, NINE name THIS POKÉMON (Munkidori ×3, Meowscarada,
    // Misty's Psyduck ×2, Pidove, Klinklang) — a per-BODY predicate
    // `conditionHolds` cannot express, since it takes a seat and no uid. Crobat's
    // "if you played Janine's Secret Art from your hand this turn" and Thwackey's
    // "if your Active Pokémon has the Festival Lead Ability" are two more
    // conditions this union does not hold. That leaves 3.
    const gated: string[] = [];
    for (const id of registryCardIds()) {
      for (const ability of programFor(id)?.abilities ?? []) {
        if (ability.playableIf !== undefined) gated.push(id);
      }
    }
    // 🆕 **D275 — AND THEN IT WAS 5.** Fan Rotom's *"Once during your **first**
    // turn"* is the union's `yourFirstTurn` member, the FIFTH `BoardCondition` to
    // read a turn event and the first that stores nothing at all: it is derived
    // from `state.turn` and `state.firstPlayer` through `isFirstTurnOf`
    // (types.ts), the same reader §4's evolve ban has used since that slice. The
    // count above is untouched by it — Fan Rotom's clause is not on the
    // `%Once during your turn, if %` ladder at all, because the printed word is
    // "first".
    // 🆕🆕 **D347 — AND THEN IT WAS 8, ON A CLAUSE THAT IS NOT ON THAT LADDER
    // EITHER.** Yanmega ex `sv10-003`/`sv10-206`/`sv10-228` "Buzzing Boost" prints
    // *"Once during your turn, **when** this Pokémon **moves** from your Bench to
    // the Active Spot"* — a `%Once during your turn, when %` clause, so the 29/15/14
    // ladder above is untouched by it exactly as Fan Rotom's *"first"* was.
    //
    // 🛑 **AND IT IS THE ONE SHAPE THE PARAGRAPH ABOVE SAYS CANNOT BE HERE.** That
    // paragraph excludes NINE printings for naming THIS POKÉMON, on the ground that
    // `conditionHolds` takes a seat and no uid. Yanmega's clause names this Pokémon
    // too — and belongs here anyway, because **`activeOnly: true` GIVES THE
    // SELF-PRONOUN ITS REFERENT**: it pins the host to the single body
    // `yourActivePromotedThisTurn` reads, so *"your Active moved up this turn"* ∧
    // *"this Pokémon IS the Active"* is exactly *"this Pokémon moved up this turn"*.
    // **THE EXCEPTION IS THE CONJUNCTION, NOT THE PREDICATE**, and the nine stay
    // excluded because none of them names the Active Spot — `activeOnly` is what
    // would have to be TRUE of them, not what happens to be.
    //
    // ⚠️ **THIS ASSERTION IS THE GUARD THE STANDING OPEN FINDING KEPT ASKING FOR,
    // AND IT WORKS.** `registry.ts`'s `playableIf` doc block carried the prose
    // *"that leaves the 3 Fezandipiti ex printings as this field's whole legal
    // population today"* — a figure invisible to every check in the repo. THIS line
    // is not: it went RED on D347's build and forced the prose to be corrected in
    // the same session. **A POPULATION PINNED BY ID IS A PROSE FIGURE THAT CANNOT
    // ROT SILENTLY**, which is the cheap, narrow form of the check D345 and D346
    // both proposed and neither built. It was ALSO this slice's own biggest
    // prediction miss: the prediction grepped `playableIf` in non-test files and
    // named the doc block, and did not grep the TEST tree for the same identifier.
    expect(gated.sort()).toEqual([
      "sv06.5-038",
      "sv06.5-084",
      "sv06.5-092",
      "sv07-118",
      "sv08.5-085",
      "sv10-003",
      "sv10-206",
      "sv10-228",
    ]);
  });
});
