import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// D320 — "LAVA ZONE": THE OPPONENT-ACTION FAMILY'S THIRD VERB, AND THE ONE
// WHOSE MOMENT IS A BOARD MOVE RATHER THAN A HAND PLAY.
//
// THE SENTENCE, transcribed off the remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-10 rather than copied out
// of a census bullet:
//
//   "Whenever your opponent's Active Pokémon moves to the Bench during their
//    turn, their new Active Pokémon is now Burned."
//        — Magcargo `sv05-029` "Lava Zone", 1 legal printing, Stage 1
//          (evolves from Slugma), 120 HP, {R}, retreat 4.
//
// ── THE FAMILY BOUNDARY, RE-RUN AT SIX WIDTHS AND FROM BOTH SIDES ────────────
//
// The census, remote D1, all 3,786 rows, one row per column (D283's
// compound-SELECT limit), legal count in parentheses:
//
//     predicate                                    attacks  abilities  effect
//     instr(col, "moves to the Bench")                0        1 (1)      0
//     instr(col, "during their turn")                 —        1 (1)      —
//     instr(col, "new Active")                       46 (22)  25 (16)    6 (4)
//     instr(col, "Whenever your opponent")            0        8 (8)      0
//     instr(col, "is now Burned")                     —        3 (2)      —
//     instr(col, "doesn't stack")                     —       10 (8)      —
//
// ⚠️ EVERY CELL ABOVE IS A `COUNT(*)`, AND THE FIRST DRAFT OF THIS TABLE WAS NOT.
// The `'new Active'` row was originally typed as "44 legal / 32 / 10 / 2" from
// the SHAPE of a result set rather than from a count, and re-running it returned
// 42 distinct legal cards over the three columns. **A figure read off a screen is
// not a measurement** (D310, D316) — and this one was twenty minutes old.
//
// 🛑 **THE ANTECEDENT LITERAL AND THE CONSEQUENT LITERAL BOTH RETURN EXACTLY
// THIS ROW, AND THE WIDE ONE RETURNS FORTY-TWO DISTINCT LEGAL CARDS.** Every
// other `'new Active'`
// row is a switch-out attack's parenthetical *"(Your opponent chooses the new
// Active Pokémon.)"* or an ACTIVATED Ability (Pecharunt ex's "Subjugating
// Chains", Florges' "Captivating Invitation") — **not one of them prints
// "Whenever"**, so no census on the consequent side alone could have priced this
// row, and the antecedent side is what closes it. D319's rule from the other
// direction: there the consequent was exact and the antecedent wide.
//
// **So the family is 1 of 1 legal sentence / 1 of 1 legal printing, and it
// CLOSES here.** `attacks_json` and `effect` return ZERO at every width, so no
// text reader can see this sentence and `BUILT.attack` cannot move.
//
// ── THE FIVE WAYS A BUILD OF THIS PASSES A SUITE IT SHOULD FAIL ─────────────
//
// ⚠️ **A SCAN HUNG ON `switchInto` ALONE SHIPS THE SENTENCE'S COMMONEST
// TRIGGER DEAD.** `retreat` (turn.ts) does NOT call that function — it pays the
// retreat cost out of the retreating body's own attachments and emits
// `RETREATED`, not `POKEMON_SWITCHED`. §2 retreats, and it is the case a
// one-site build gets silently wrong. (This suite's author wrote that build
// first; the doc comment on `switchInto` enumerates "three provenances" and
// retreat is not one of them.)
//
// ⚠️ **A BUILD THAT DROPS *"DURING THEIR TURN"* BURNS ON A BOSS'S ORDERS.** A
// gust is `switchInto` on the OTHER seat's board during the GUSTING player's
// turn — the opponent's Active really does move to the Bench, and the clause is
// the only thing that says no. §4 plays it and requires NO burn.
//
// ⚠️ **A DIRECTION-BLIND SCAN BURNS THE WATCHER'S OWN NEW ACTIVE.** Magcargo's
// controller retreats too. §5 does exactly that and requires no burn on either
// side.
//
// ⚠️ **A SCAN THAT FIRES ON THE §8.1 PROMOTION INVENTS A MOVE THE CARD DOES NOT
// PRINT.** A Knocked Out Active goes to the DISCARD; nothing moved to the Bench.
// §6 Knocks the actor's Active out on the watcher's turn and requires no burn —
// and it is a control for the turn clause at the same time.
//
// ⚠️ **A `doesNotStack` READ AS A DEFAULT IS UNOBSERVABLE ON THE BOARD HERE.**
// Burned is idempotent — two firings and one leave the same `conditions` — so
// the only witness is the EVENT COUNT. §7 puts two Magcargo down and requires
// TWO `ABILITY_TRIGGERED` rows, which is the flag read off the PRINT rather than
// off the effect.

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows.
// ─────────────────────────────────────────────────────────────────────────────

const LAVA_ZONE_TEXT =
  "Whenever your opponent's Active Pokémon moves to the Bench during their turn, their new Active Pokémon is now Burned.";
/** Gnawing Curse, the family's ATTACH verb (D319) — pinned here so §9's claim
    that the two rows differ ONLY in timing is checkable against the print. */
const GNAWING_CURSE_TEXT =
  "Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.";

const MAGCARGO = "sv05-029";
/** Dachsbun "Well-Baked Body" — *"This Pokémon can't be Burned."* plus a {R}
    prevention. The §12 immunity control (§8), and a REAL printing rather than a
    fixture, so the refusal is the catalog's and not this file's. */
const DACHSBUN = "sv01-099";
/** Ting-Lu ex "Cursed Land" — the §9 Ability-lock aura that can reach a Stage 1:
    *"…your opponent's Pokémon in play that have any damage counters on them have
    no Abilities, except for Pokémon ex."* Klefki's lock is Basic-only and
    Magcargo is a Stage 1, so it could not have been the control. */
const TING_LU = "sv02-127";
const SWITCH = "sv01-194"; // Item — "Switch your Active Pokémon with 1 of your Benched Pokémon."
const BOSS = "sv02-172"; // Supporter — the gust
/** Retreat cost ZERO, so §2 pays nothing and a `RETREAT_COST_MISMATCH` can never
    be mistaken for an absent trigger. */
const FREE = "fix-basic-0";
const BASIC = "fix-basic-1";
/** A body with NO Ability at all: every "the trigger fired" line below passes
    just as happily on a build that Burns on every bench move. */
const PLAIN = "fix-lava-plain";

function magcargo(id: string): Card {
  return battler(id, {
    name: "Magcargo",
    hp: 120,
    retreat: 4,
    types: ["Fire"],
    stage: "Stage1",
    evolveFrom: "Slugma",
    abilities: [{ type: "Ability", name: "Lava Zone", effect: LAVA_ZONE_TEXT }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [MAGCARGO]: magcargo(MAGCARGO),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Watcher",
    hp: 200,
    retreat: 1,
    types: ["Fire"],
    attacks: [{ name: "Nothing At All", cost: ["Fire"], damage: "30" }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** This suite's own seeded deck (D270's rule). */
const LAVA_DECK = deckOf({
  [MAGCARGO]: 4,
  [PLAIN]: 4,
  [DACHSBUN]: 4,
  [TING_LU]: 4,
  [SWITCH]: 4,
  [BOSS]: 4,
  [FREE]: 16,
  [BASIC]: 12,
  "fix-fire-energy": 8,
});

/** Three seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [9041, 9043, 9049] as const;

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
  const created = createGame({ seed, decks: { p1: LAVA_DECK, p2: LAVA_DECK }, cardPool: POOL });
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

/** `watcher` holds `watcherIds` (Active first, then Bench); the ACTOR holds a
    retreat-0 Active and EXACTLY ONE benched body.

    ⚠️ THE ACTOR'S BENCH IS ONE BODY ON PURPOSE, TWICE OVER — §14.2 makes an
    empty Bench a LOSS the moment an Active leaves, and a Switch/Boss's Orders
    over a bench of two or more PARKS on a choice, which would make every
    assertion below a claim about the park rather than about the trigger. */
function board(
  seed: number,
  first: Seat,
  watcher: Seat,
  watcherIds: readonly string[],
  actorBenched: string = BASIC,
): GameState {
  let state = localSetup(seed, first);
  const actor = watcher === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, watcher, watcherIds[0] ?? PLAIN);
  state = clearBench(state, watcher);
  state = benchFromDeck(state, watcher, BASIC);
  for (const id of watcherIds.slice(1)) state = benchFromDeck(state, watcher, id);
  state = setActiveFromDeck(state, actor, FREE);
  state = clearBench(state, actor);
  state = benchFromDeck(state, actor, actorBenched);
  return state;
}

/** Walk the clock so `seat` moves on turn 3 or later — no §4 ban applies to a
    retreat, but a Supporter is barred on the going-first player's first turn and
    the three routes below must be compared on one clock. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

function retreat(state: GameState, seat: Seat): ReturnType<typeof applyAction> {
  return applyAction(deepFreeze(state), {
    type: "retreat",
    seat,
    discardEnergy: [],
    promoteBenchIndex: 0,
  });
}

/** Drain the §8.1 KO interrupt: the KOing seat takes its prizes, the KO'd seat
    promotes (a lone benched body auto-promotes, so only the prize pick parks). */
function drainKo(state: GameState): GameState {
  let next = state;
  for (let i = 0; i < 4; i += 1) {
    const phase = next.phase;
    if (phase.kind === "ko:takePrizes") {
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat: phase.seat,
          prizeIndices: Array.from({ length: phase.count }, (_, k) => k),
        }),
      );
      continue;
    }
    if (phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: phase.seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error(`KO interrupt never drained (${next.phase.kind})`);
}

function playTrainer(
  state: GameState,
  seat: Seat,
  cardId: string,
): ReturnType<typeof applyAction> {
  const withCard = handFromDeck(state, seat, cardId, 1);
  return applyAction(deepFreeze(withCard), {
    type: "playTrainer",
    seat,
    uid: handUid(withCard, seat, cardId),
  });
}

function burned(state: GameState, seat: Seat): boolean {
  return state.players[seat].active?.conditions.burned === true;
}

function activeId(state: GameState, seat: Seat): string | undefined {
  const uid = state.players[seat].active?.stack.at(-1);
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function triggerEvents(result: ReturnType<typeof applyAction>): { seat: Seat; ability: string }[] {
  if (!result.ok) throw new Error("action failed");
  return result.events.flatMap((e) =>
    e.type === "ABILITY_TRIGGERED" ? [{ seat: e.seat, ability: e.ability }] : [],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. The printed row, and the registry program that encodes it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§0 — the printed sentence and its registry row", () => {
  it("the Ability text in this suite's pool is the D1 row, byte for byte", () => {
    expect(POOL[MAGCARGO]?.abilities).toEqual([
      { type: "Ability", name: "Lava Zone", effect: LAVA_ZONE_TEXT },
    ]);
  });

  it("the program is ONE triggered row: the new timing, the watched direction, no stack flag", () => {
    expect(programFor(MAGCARGO)).toEqual({
      triggered: [
        {
          name: "Lava Zone",
          trigger: "onActiveMovedToBench",
          opponentAction: true,
          program: [{ op: "applyStatus", target: "defender", status: "burned" }],
        },
      ],
    });
  });

  it("`doesNotStack` is ABSENT, and the print is the reason — the sentence does not carry the clause", () => {
    const row = programFor(MAGCARGO)?.triggered?.[0];
    expect(row?.doesNotStack).toBeUndefined();
    expect(LAVA_ZONE_TEXT).not.toContain("doesn't stack");
    // Its sibling one verb over prints no clause either; Darkest Impulse does,
    // and that row carries the flag. Two rows, one loop, told apart by the print.
    expect(GNAWING_CURSE_TEXT).not.toContain("doesn't stack");
    expect(programFor("sv05-104")?.triggered?.[0]?.doesNotStack).toBeUndefined();
    expect(programFor("sv10-074")?.triggered?.[0]?.doesNotStack).toBe(true);
  });

  it("the consequent is `defender` and NOT `damageSubject` — the two name different bodies", () => {
    // The antecedent's subject is the body that LEFT the Active Spot; the
    // consequent is about "their NEW Active Pokémon". D319's op resolves the
    // former, so using it here would Burn the wrong Pokémon (and, being a
    // damage op, could not Burn at all).
    const program = programFor(MAGCARGO)?.triggered?.[0]?.program ?? [];
    expect(program.some((op) => op.op === "damageSubject")).toBe(false);
    expect(program).toEqual([{ op: "applyStatus", target: "defender", status: "burned" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1-3. THE THREE ROUTES A BODY TAKES FROM THE ACTIVE SPOT TO THE BENCH.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1-3 — every Active→Bench route on the actor's own turn Burns the new Active", () => {
  for (const seed of SEEDS) {
    it(`RETREAT fires it (seed ${seed}) — and this route never calls \`switchInto\``, () => {
      const start = turnOf(board(seed, "p1", "p1", [MAGCARGO]), "p2");
      expect(burned(start, "p2")).toBe(false);
      const result = retreat(start, "p2");
      expect(result.ok).toBe(true);
      const next = must(result);
      expect(activeId(next, "p2")).toBe(BASIC);
      expect(burned(next, "p2")).toBe(true);
      expect(triggerEvents(result)).toEqual([{ seat: "p1", ability: "Lava Zone" }]);
    });

    it(`a SWITCH played by the actor fires it (seed ${seed})`, () => {
      const start = turnOf(board(seed, "p1", "p1", [MAGCARGO]), "p2");
      const result = playTrainer(start, "p2", SWITCH);
      expect(result.ok).toBe(true);
      const next = must(result);
      expect(next.phase.kind).toBe("turn:action"); // a one-body bench never parks
      expect(activeId(next, "p2")).toBe(BASIC);
      expect(burned(next, "p2")).toBe(true);
    });
  }

  it("the WATCHER's Magcargo may sit on the BENCH — the sentence prints no Active-Spot clause", () => {
    const start = turnOf(board(SEEDS[0], "p1", "p1", [PLAIN, MAGCARGO]), "p2");
    const next = must(retreat(start, "p2"));
    expect(activeId(start, "p1")).toBe(PLAIN);
    expect(burned(next, "p2")).toBe(true);
  });

  it("a board with NO Magcargo Burns nobody — the control every line above needs", () => {
    for (const seed of SEEDS) {
      const start = turnOf(board(seed, "p1", "p1", [PLAIN]), "p2");
      const result = retreat(start, "p2");
      const next = must(result);
      expect(activeId(next, "p2")).toBe(BASIC);
      expect(burned(next, "p2")).toBe(false);
      expect(triggerEvents(result)).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. "DURING THEIR TURN" — the gust, which is the same board move on the wrong
//    clock.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — a Boss's Orders is the same move on the WRONG turn, and Lava Zone stays silent", () => {
  for (const seed of SEEDS) {
    it(`the watcher gusts the actor's Active to the Bench and nothing Burns (seed ${seed})`, () => {
      // p1 holds Magcargo AND plays the Boss's Orders, on p1's own turn. p2's
      // Active really does move to the Bench — the board move is `switchInto`,
      // byte for byte the one a Switch makes — and the printed clause is the
      // ONLY thing that refuses it.
      const start = turnOf(board(seed, "p1", "p1", [MAGCARGO]), "p1");
      const result = playTrainer(start, "p1", BOSS);
      expect(result.ok).toBe(true);
      const next = must(result);
      expect(next.phase.kind).toBe("turn:action");
      // the gust happened…
      expect(activeId(next, "p2")).toBe(BASIC);
      // …and nobody is Burned.
      expect(burned(next, "p2")).toBe(false);
      expect(burned(next, "p1")).toBe(false);
      expect(triggerEvents(result)).toEqual([]);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE DIRECTION — the watcher's own retreat.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the scan direction: Magcargo does not Burn its own side", () => {
  it("the watcher retreats on the watcher's turn and neither seat is Burned", () => {
    for (const seed of SEEDS) {
      // Magcargo sits on p1's BENCH so p1's Active can retreat with it in play.
      // The WATCHER's Active is the retreat-0 body and its Magcargo sits on
      // the Bench, so the watcher can make the very move it is watching for.
      const start = turnOf(board(seed, "p1", "p1", [FREE, MAGCARGO]), "p1");
      const result = retreat(start, "p1");
      const next = must(result);
      expect(activeId(next, "p1")).toBe(BASIC);
      expect(burned(next, "p1")).toBe(false);
      expect(burned(next, "p2")).toBe(false);
      expect(triggerEvents(result)).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE §8.1 PROMOTION IS NOT A BENCH MOVE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a Knocked Out Active goes to the DISCARD, so nothing moved to the Bench", () => {
  it("the actor's Active is KO'd on the WATCHER's turn and the promoted body is not Burned", () => {
    // p1 (the watcher, holding Magcargo on the Bench) attacks p2's Active to
    // zero. p2 promotes. Two clauses refuse this at once — the move is not a
    // bench move, and it is not p2's turn — which is exactly why it is here:
    // a build that fired on the §8.1 promotion would need BOTH to be wrong.
    let state = turnOf(board(SEEDS[0], "p1", "p1", [PLAIN, MAGCARGO]), "p1");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    state = setDamage(state, "p2", 55); // fix-basic-0 has 60 HP; Plain Watcher hits for 30
    const result = applyAction(deepFreeze(state), { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(true);
    // The §8.1 interrupt parks on the KOing player's prize pick; drain it, so
    // the assertion below is about the PROMOTED board and not about the park.
    const next = drainKo(must(result));
    // The KO resolved and p2's lone benched body came up.
    expect(activeId(next, "p2")).toBe(BASIC);
    expect(burned(next, "p2")).toBe(false);
    expect(
      triggerEvents(result).filter((e) => e.ability === "Lava Zone"),
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. `doesNotStack` IS ABSENT, AND BURNED IS IDEMPOTENT — so the witness is the
//    EVENT COUNT.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — two Magcargo are TWO firings, and only the log can see it", () => {
  it("two Magcargo emit two ABILITY_TRIGGERED rows on one retreat", () => {
    const start = turnOf(board(SEEDS[0], "p1", "p1", [MAGCARGO, MAGCARGO]), "p2");
    const result = retreat(start, "p2");
    const next = must(result);
    expect(burned(next, "p2")).toBe(true);
    expect(triggerEvents(result)).toEqual([
      { seat: "p1", ability: "Lava Zone" },
      { seat: "p1", ability: "Lava Zone" },
    ]);
  });

  it("the BOARD cannot tell one firing from two — which is why the flag is read off the print", () => {
    const one = must(retreat(turnOf(board(SEEDS[1], "p1", "p1", [MAGCARGO]), "p2"), "p2"));
    const two = must(
      retreat(turnOf(board(SEEDS[1], "p1", "p1", [MAGCARGO, MAGCARGO]), "p2"), "p2"),
    );
    expect(one.players.p2.active?.conditions).toEqual(two.players.p2.active?.conditions);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. §12 — the printed IMMUNITY refuses it, and the fold is what answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — Dachsbun's “This Pokémon can't be Burned.” refuses the trigger", () => {
  it("a Dachsbun promoted into the Active Spot takes no Burn", () => {
    const start = turnOf(board(SEEDS[0], "p1", "p1", [MAGCARGO], DACHSBUN), "p2");
    const result = retreat(start, "p2");
    const next = must(result);
    expect(activeId(next, "p2")).toBe(DACHSBUN);
    expect(burned(next, "p2")).toBe(false);
    // The Ability still FIRED — the refusal is §12's, at the op, not the scan's.
    expect(triggerEvents(result)).toEqual([{ seat: "p1", ability: "Lava Zone" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. §9 — an Ability-lock aura silences it, because Lava Zone IS an Ability.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — THE ABILITY-LOCK CASE IS REFUSED, AND THE REFUSAL IS THE RESULT", () => {
  // 🛑 NO §9 LOCK IN THIS CATALOG CAN BE LIVE AT THE MOMENT THIS TRIGGER FIRES,
  // AND A FIXTURE THAT FAKED ONE WOULD BE THE NEXT VACUOUS GUARD (D203's
  // refusal, conventions.md). The engine has THREE `disableAbilities` printings
  // and each one is out for its own printed reason:
  //
  //   • Klefki `sv01-096` "Mischievous Lock" — `stage: "Basic"`. Magcargo is a
  //     STAGE 1, so the aura never names it.
  //   • Spiritomb `sv02-089` "Fettered in Misfortune" — `stage: "Basic"` AND
  //     `suffix: "V"`. Narrower still.
  //   • Ting-Lu ex `sv02-127` "Cursed Land" — reaches a damaged Stage 1, but
  //     carries `requiresActive`, and its target set is *"your OPPONENT's
  //     Pokémon"*. So the lock source must be the ACTOR's Active — which is the
  //     very body the trigger's antecedent moves to the Bench. By the time
  //     `runActiveBenchedTriggers` runs, Ting-Lu is benched and the aura is
  //     already off. **That is the engine being right, not a hole**: the printed
  //     "as long as this Pokémon is in the Active Spot" really has stopped
  //     holding.
  //
  // The gate itself is NOT untested — `triggersOf` is the single §9 choke for
  // every timing and both scan directions, and D319's `opponentActionTrigger`
  // suite drives it on the `"opponent"` direction this row also uses. Writing a
  // second one here would need a board no deck can build.
  it("the three lock printings are all narrower than this row, checked against the registry", () => {
    expect(programFor("sv01-096")?.passive?.disableAbilities?.stage).toBe("Basic");
    expect(programFor("sv02-089")?.passive?.disableAbilities?.stage).toBe("Basic");
    expect(programFor("sv02-127")?.passive?.disableAbilities?.requiresActive).toBe(true);
    // …and Magcargo is the Stage 1 the first two cannot name.
    expect(POOL[MAGCARGO]?.stage).toBe("Stage1");
  });
});
