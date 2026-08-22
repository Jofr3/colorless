import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── D312 — "YOU MAY SHUFFLE THIS POKÉMON AND ALL ATTACHED CARDS INTO YOUR
//    DECK." — THE SELF-REMOVAL FAMILY'S **ATTACK** HALF, AND THE §8.1 PROMOTION
//    SEAM AT ITS **SECOND SITE**. ────────────────────────────────────────────
//
// THE POPULATION, queried against remote Cloudflare D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-10**, WHOLE
// COLUMN read (D306's rule — every arm, `damage` and `cost` included):
//
//   SELECT id, name, category, stage, evolve_from, legal_standard,
//          types_json, abilities_json, attacks_json, effect
//     FROM cards
//    WHERE legal_standard = 1
//      AND instr(coalesce(attacks_json,''),
//                'You may shuffle this Pokémon and all attached cards') > 0;
//
// **ONE legal row** — Gholdengo `sv08-131`, `Stage1` off `Gimmighoul`, 130 HP,
// `types_json = ["Metal"]`, TWO attacks:
//
//   idx 0  "Strike It Rich"  cost [Metal]                      damage "30+"
//          "If this Pokémon evolved from Gimmighoul during this turn, this
//           attack does 90 more damage."
//   idx 1  "Surf Back"       cost [Colorless × 3]              damage 100
//          "You may shuffle this Pokémon and all attached cards into your deck."
//
// ⚠️ **INDEX 1 ONLY.** Index 0 MUST NOT inherit this program — the
// index-precision rule `CardProgram.attack` states and D187's inflated
// intermediate result paid for. §1 drives both halves of that.
//
// 🆕🆕 **D393 — THE REASON CHANGED AND THE RULE DID NOT.** This block used to read
// *"index 0's evolved-this-turn conditional is unread by this engine and must stay
// unsimulated"*, and D393 BUILT that sentence: *"If this Pokémon evolved from
// Gimmighoul during this turn…"* now resolves through `CONDITIONAL_DAMAGE_CLAUSES`
// to `yourActiveEvolvedFromThisTurn`. **THE PREMISE DIED WITHOUT A CHARACTER OF THE
// MUTANT'S `find` MOVING** — D384's class — so it is re-transcribed here rather than
// left to read as a fact. Gholdengo is now the engine's FIRST card with a REGISTRY
// attack at one index and a DERIVED one at another, and §1's `toBeUndefined()` is
// what keeps them apart: `programFor(id)` wins over `deriveAttackEffect`, so
// authoring index 0 here would MASK the printed +90 as well as unsimulating
// "Surf Back".
//
// ── 🛑 THE SEAM: MEASURED AT THE SECOND SITE, NOT ASSUMED FROM THE FIRST ────
//
// D311 proved the §8.1 promotion is a QUEUEING SEAM and not a stage, and put one
// in `resolveMidTurnKnockOuts` — which serves `settleProgram`, i.e. Trainers,
// Abilities and board triggers. **`finishAttack` is a different site.** It calls
// `collectKnockOuts` DIRECTLY and never passes through `resolveMidTurnKnockOuts`,
// so until D312 an attack that removed its own actor handed the turn over with an
// empty Active Spot and nothing owed.
//
// **THE SECOND SITE IS NOT MORE EXPENSIVE, AND THAT IS A MEASUREMENT.** The
// filter, the `.map` and the stage kind are byte-for-byte D311's;
// `PendingStage {kind:"promote"}` gained nothing. The ONE thing that differs is
// the TAIL the stages splice in front of, and the difference is what makes each
// site correct:
//
//   resolveMidTurnKnockOuts   [...batch.stages, ...orphaned, resumeTurn]
//   finishAttack              [...batch.stages, ...orphaned, ...turnTail]
//
// An Ability does not end a turn (§9), so the actor RESUMES; an attack does
// (§5.3), so the turn ENDS — and §8.1 owes the promotion BEFORE it does, because
// a player does not hand over a board with an empty Active Spot. §3 drives that
// ORDER, which is the only thing about this site that could have been got wrong.
//
// ── 🛑 AND A DOC CLAIM THIS FAMILY FALSIFIES, CORRECTED RATHER THAN LEFT ────
//
// `finishAttack`'s block justified its `addDamageByUid`-returns-`null` branch
// with a claim about the POOL, quoted here verbatim from HEAD before this slice:
//
//     "`null` (not in play at all) is a no-op: nothing in this pool can discard
//      its own actor mid-attack, and `koRecoilOf`'s 'the lethal set is the
//      sweep's own' rule says a body that is about to be Knocked Out is still
//      HERE."
//
// **"Surf Back" discards its own actor mid-attack.** The second half of that
// sentence still holds; the first does not. ⚠️ **THE CODE WAS ALREADY RIGHT AND
// ONLY THE REASON WAS WRONG** — `addDamageByUid` is total over uids and returns
// `null` on one it cannot find — so what changed is that the branch went from
// UNREACHABLE-BY-ARGUMENT to **REACHED**, and §4 below drives it on a real board
// rather than leaving it to a comment. 🛑 **A `null` GUARD DEFENDED BY A CENSUS
// OF THE POOL EXPIRES THE DAY THE POOL GROWS.**
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE registry ATTACK row over ONE id and ONE index, plus a SIX-LINE queueing
// seam. **NO new `EffectOp`, op field, `PendingStage` kind, prompt kind, choice
// kind, event, error code, `GameState` field or deriver arm**; `packages/schema`
// takes ZERO and `MATCH_RECORD_VERSION` stays at 18 (nothing new is authorable
// or persisted — the seam changes WHEN an existing stage is queued, not what it
// looks like). It moves `BUILT.attack`'s **REGISTRY** summand (4 → 5) and leaves
// the READER-keyed raw summand (1,146 over 303 sentences) untouched.

/** The printed sentence, transcribed off the D1 row rather than assembled
    (D306: transcribe, never interpolate). */
const PRINTED = "You may shuffle this Pokémon and all attached cards into your deck.";

/** Index 0's, kept as the control for the index-precision claim. */
const IDX0_PRINTED =
  "If this Pokémon evolved from Gimmighoul during this turn, this attack does 90 more damage.";

const GHOLDENGO = "sv08-131";
const WALL = "fix-d312sb-wall";
const FILLER = "fix-d312sb-filler";
const ENERGY = "fix-d312sb-energy";
const TOOL = "fix-d312sb-tool";

/** Vengeful Punch — the real `sv03-197`, already in `FIXTURE_POOL` and already
    programmed, so §4's board is built out of shipped pieces. */
const VENGEFUL_PUNCH = "sv03-197";

/** The LOCAL pool (D275's idiom) — the real `sv08-131` lives HERE and not in
    `FIXTURE_POOL`, so no `fix-*` demonstrator and no manifest row is owed. */
const LOCAL_CARDS: Record<string, Card> = {
  [GHOLDENGO]: battler(GHOLDENGO, {
    name: "Gholdengo",
    hp: 130,
    stage: "Stage1",
    evolveFrom: "Gimmighoul",
    retreat: 2,
    types: ["Metal"],
    attacks: [
      { cost: ["Metal"], name: "Strike It Rich", damage: "30+", effect: IDX0_PRINTED },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Surf Back",
        damage: 100,
        effect: PRINTED,
      },
    ],
  }),
  // 90 HP — dies to "Surf Back"'s 100 in one hit, which is the board §3 needs.
  [WALL]: battler(WALL, {
    name: "D312 Wall",
    hp: 90,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D312 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [TOOL]: trainerCard(TOOL, "Tool", "Attach to 1 of your Pokémon."),
  [ENERGY]: typedEnergy(ENERGY, "Metal"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [GHOLDENGO]: 4,
  [WALL]: 8,
  [FILLER]: 8,
  [TOOL]: 2,
  [VENGEFUL_PUNCH]: 2,
  [ENERGY]: 36,
});

/** Two seeds — nothing below rests on one shuffle (D270). */
const SEEDS = [3129, 3137] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
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

/** TEST SURGERY — three Metal Energy onto p1's Active, enough for "Surf Back". */
function fuel(state: GameState): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === ENERGY).slice(0, 3);
  if (energy.length < 3) throw new Error("deck lacks three energy");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, ...energy] },
        deck: side.deck.filter((u) => !energy.includes(u)),
      },
    },
  };
}

/** A board with the Gholdengo Active for p1 on p1's turn, `bench` filler bodies
    behind it, and `defenderHp`-worth of Wall standing opposite. */
function board(opts: {
  bench: number;
  seed?: number;
  defender?: string;
  defenderDamage?: number;
  defenderTool?: string;
  p2Bench?: number;
}): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0], "p2");
  state = setActiveFromDeck(state, "p2", opts.defender ?? WALL);
  state = clearBench(state, "p2");
  for (let i = 0; i < (opts.p2Bench ?? 1); i += 1) state = benchFromDeck(state, "p2", FILLER);
  if (opts.defenderTool !== undefined) {
    state = attachToolFromDeck(state, "p2", "active", opts.defenderTool);
  }
  if (opts.defenderDamage !== undefined) state = setDamage(state, "p2", opts.defenderDamage);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", GHOLDENGO);
  state = clearBench(state, "p1");
  for (let i = 0; i < opts.bench; i += 1) state = benchFromDeck(state, "p1", FILLER);
  return fuel(state);
}

const SURF_BACK = { type: "attack", seat: "p1", index: 1 } as const;
const YES = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } } as const;
const NO = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } } as const;

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §1 — the print, the index-precision, and the `optional` that IS printed", () => {
  it("the fixture carries both printed sentences VERBATIM", () => {
    expect(POOL[GHOLDENGO]?.attacks?.[1]?.effect).toBe(PRINTED);
    expect(POOL[GHOLDENGO]?.attacks?.[1]?.name).toBe("Surf Back");
    expect(POOL[GHOLDENGO]?.attacks?.[1]?.damage).toBe(100);
    expect(POOL[GHOLDENGO]?.attacks?.[0]?.effect).toBe(IDX0_PRINTED);
  });

  it("🛑 the registry authors index 1 and index 0 STAYS UNSIMULATED", () => {
    const program = programFor(GHOLDENGO);
    expect(program?.attack?.[1]).toBeDefined();
    // The index-precision rule. Index 0 is D393's DERIVED evolved-this-turn bonus
    // and must NOT inherit "Surf Back"'s program — the registry beats the deriver,
    // so an index slip here would silently swallow the printed +90 as well as
    // leaving "Surf Back" unsimulated. Two failures, one assertion (D393).
    expect(program?.attack?.[0]).toBeUndefined();
    // …and the row is attack-ONLY: no Ability, no passive, no trigger.
    expect(Object.keys(program ?? {})).toEqual(["attack"]);
  });

  it("the program is an `optional` over the existing op — nothing new was authored", () => {
    expect(programFor(GHOLDENGO)?.attack?.[1]).toEqual([
      {
        op: "optional",
        note: PRINTED,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "returnSelf", dest: "deck" }],
      },
    ]);
  });

  it("🛑 the prompt note IS the printed sentence, byte for byte", () => {
    // The `payFromHandNote` rule: the op is the whole clause, so the note is the
    // whole clause — never a paraphrase and never an interpolation (D306).
    const program = programFor(GHOLDENGO)?.attack?.[1] ?? [];
    const head = program[0];
    expect(head?.op === "optional" && head.note).toBe(PRINTED);
  });

  it("⚠️ the ABILITY printing of the same mechanism takes NO wrapper — the pair is the argument", () => {
    // §9 makes declining an Ability free, so Abra's row is a bare `returnSelf`. An
    // ATTACK has already been declared — the Energy is committed and the turn is
    // ending — so its printed "you may" names a decision that exists nowhere else.
    // The two rows differ on this field for a reason about §8 vs §9.
    expect(programFor("sv06-080")?.abilities?.[0]?.program).toEqual([{ op: "returnSelf", dest: "deck" }]);
    expect(JSON.stringify(programFor("sv06-080"))).not.toContain("optional");
    expect(JSON.stringify(programFor(GHOLDENGO))).toContain("optional");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §2 — the decision: the attack lands FIRST, then the printed 'you may'", () => {
  for (const seed of SEEDS) {
    it(`damage is dealt BEFORE the prompt, and a DECLINE keeps the body (seed ${seed})`, () => {
      const before = board({ bench: 2, seed, defender: FILLER });
      const { state: parked, events } = apply(before, SURF_BACK);

      // §8.5 put the 100 down before step 4 ran the program — the order is §8's
      // and not this row's choice, and it is why a Gholdengo that shuffles itself
      // away has already Knocked its target out on the board §3 builds.
      expect(parked.players.p2.active?.damage).toBe(100);
      expect(parked.phase.kind).toBe("effect:choose");
      expect(find(events, "EFFECT_PENDING")).toMatchObject({ seat: "p1", note: PRINTED });

      const { state: done } = apply(parked, NO);
      // Declined: the attacker is standing, with everything still attached.
      expect(done.cardIdByUid[done.players.p1.active?.stack.at(-1) ?? ""]).toBe(GHOLDENGO);
      expect(done.players.p1.active?.energy).toHaveLength(3);
      // …and the turn ended anyway (§5.3) — the decline is about the removal only.
      expect(done.phase).toMatchObject({ seat: "p2" });
    });
  }

  it("an ACCEPT shuffles the body and every attached card into the deck", () => {
    let state = board({ bench: 2, defender: FILLER });
    state = attachToolFromDeck(state, "p1", "active", TOOL);
    const body = state.players.p1.active;
    if (body === null) throw new Error("no Active");
    const stack = [...body.stack, ...body.energy, ...body.tools];
    expect(stack).toHaveLength(5); // the Gholdengo card, three Energy, one Tool
    const deckBefore = state.players.p1.deck.length;

    const { state: done, events } = apply(must(applyAction(state, SURF_BACK)), YES);

    const deck = new Set(done.players.p1.deck);
    for (const uid of stack) expect(deck.has(uid), uid).toBe(true);
    expect(done.players.p1.deck.length).toBeGreaterThanOrEqual(deckBefore + 5);
    const returned = find(events, "POKEMON_RETURNED");
    expect(returned).toMatchObject({ seat: "p1", actor: "p1", dest: "deck" });
    expect(new Set(returned?.uids ?? [])).toEqual(new Set(stack));
  });

  it("the OPPONENT cannot answer the attacker's printed 'you may'", () => {
    const parked = must(applyAction(board({ bench: 2, defender: FILLER }), SURF_BACK));
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "confirm", yes: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("WRONG_SEAT");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §3 — 🛑 THE SEAM AT ITS SECOND SITE, and the ORDER that makes it §8.1", () => {
  it("the attacker's empty spot is promoted BEFORE the turn ends — the whole point", () => {
    // ⚠️ THE ONE THING ABOUT THIS SITE THAT COULD HAVE BEEN GOT WRONG. D311's
    // stages splice in front of `resumeTurn`; these splice in front of `turnTail`.
    // Put them BEHIND the tail instead and this board hands p2 a turn against an
    // empty Active Spot, which is precisely what §8.1 forbids.
    const { state: done, events } = apply(
      must(applyAction(board({ bench: 2, defender: FILLER }), SURF_BACK)),
      YES,
    );
    expect(done.phase).toEqual({ kind: "ko:promote", seat: "p1" });
    expect(find(events, "PROMOTION_REQUIRED")).toMatchObject({ seat: "p1" });
    // ⚠️ AND THE TURN HAS NOT ENDED YET. The tail is still queued behind the
    // promotion, so TURN_ENDED must not have fired.
    expect(events.map((e) => e.type)).not.toContain("TURN_ENDED");
    expect(done.pending.some((s) => s.kind === "endTurn")).toBe(true);

    // Answering it drains the tail and hands over a board with a real Active.
    const after = must(applyAction(done, { type: "promote", seat: "p1", benchIndex: 0 }));
    expect(after.players.p1.active).not.toBeNull();
    expect(after.phase).toMatchObject({ seat: "p2" });
  });

  it("a Bench of ONE auto-resolves and the turn ends in ONE action", () => {
    const { state: done, events } = apply(
      must(applyAction(board({ bench: 1, defender: FILLER }), SURF_BACK)),
      YES,
    );
    // The M1 no-choice doctrine: no prompt, and the tail drained straight through.
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
    expect(events.map((e) => e.type)).toContain("TURN_ENDED");
    expect(done.players.p1.active).not.toBeNull();
    expect(done.players.p1.bench).toHaveLength(0);
    expect(done.phase).toMatchObject({ seat: "p2" });
  });

  it("🛑 a Bench of NONE is the §14.2 loss — the attacker attacks itself out of the game", () => {
    const { state: done, events } = apply(
      must(applyAction(board({ bench: 0, defender: FILLER }), SURF_BACK)),
      YES,
    );
    expect(done.phase.kind).toBe("gameOver");
    expect(find(events, "GAME_OVER")?.outcome).toMatchObject({ result: "win", winner: "p2" });
  });

  it("🛑 THE BOTH-SEATS BOARD: the defender is KO'd and the attacker removes ITSELF", () => {
    // ⚠️ THE BOARD THE SKIP-TERM EXISTS FOR, and the one D311's site cannot reach:
    // an attack can empty BOTH Active Spots in one resolution — one by Knock Out
    // (which queues its own promotion) and one by `returnSelf` (which does not).
    // A naive predicate gives the KO'd seat TWO promotions and the attacker NONE.
    const { state: done, events } = apply(
      must(applyAction(board({ bench: 2, defender: WALL, p2Bench: 2 }), SURF_BACK)),
      YES,
    );
    // The Wall (90 HP) died to the 100.
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    // EXACTLY ONE promotion per seat, and both are present.
    const promotes = done.pending.filter((s) => s.kind === "promote");
    expect(promotes.filter((s) => s.seat === "p1")).toHaveLength(1);
    expect(promotes.filter((s) => s.seat === "p2")).toHaveLength(1);
    expect(promotes).toHaveLength(2);
    // …and the PRIZE stage is in front of both (`collectKnockOuts` groups
    // prizes-first), which is the ordering the splice must not disturb.
    const kinds = done.pending.map((s) => s.kind);
    expect(kinds.indexOf("takePrizes")).toBeLessThan(kinds.indexOf("promote"));
    // …and the turn tail is behind ALL of them.
    expect(kinds.indexOf("promote")).toBeLessThan(kinds.indexOf("endTurn"));
  });

  it("a DECLINE owes NO promotion — the seam fires on the board and not on the op", () => {
    const { state: done, events } = apply(
      must(applyAction(board({ bench: 2, defender: FILLER }), SURF_BACK)),
      NO,
    );
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
    expect(done.pending.filter((s) => s.kind === "promote")).toEqual([]);
    expect(done.players.p1.active).not.toBeNull();
  });

  it("an ORDINARY attack is untouched — the superset costs nothing", () => {
    // ⚠️ THE CONTROL. The seam scans BOTH seats on every attack; on the vast
    // majority neither spot is empty and nothing is queued. Without this, a seam
    // that queued a promotion unconditionally would still pass every case above.
    const { state: done, events } = apply(board({ bench: 2, defender: FILLER }), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
    expect(done.pending.filter((s) => s.kind === "promote")).toEqual([]);
    expect(events.map((e) => e.type)).toContain("TURN_ENDED");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §4 — 🛑 THE FALSIFIED DOC CLAIM, DRIVEN", () => {
  it("an attack CAN now discard its own actor mid-attack — the claim's premise is RETIRED", () => {
    // ⚠️ THIS IS THE SENTENCE `finishAttack` USED TO CARRY, and it is false as of
    // this slice: "nothing in this pool can discard its own actor mid-attack".
    // Driven as a fact about the board rather than as a fact about the comment.
    const parked = must(applyAction(board({ bench: 2, defender: FILLER }), SURF_BACK));
    const attacker = parked.players.p1.active?.stack.at(-1) ?? "";
    expect(attacker).not.toBe("");
    const { state: done } = apply(parked, YES);
    // The uid `finishAttack` was handed as "the Attacking Pokémon" is in the DECK.
    expect(done.players.p1.deck).toContain(attacker);
    expect(done.players.p1.active?.stack.at(-1)).not.toBe(attacker);
    expect(done.players.p1.bench.some((b) => b.stack.includes(attacker))).toBe(false);
  });

  it("🛑 THE DEFECT BOARD: a Vengeful Punch is owed 4 counters and the attacker is GONE", () => {
    // ⚠️ THE BRANCH THAT WENT FROM UNREACHABLE-BY-ARGUMENT TO REACHED. p2's Wall
    // holds Vengeful Punch (`sv03-197`, shipped since D158): "If the Pokémon this
    // card is attached to is Knocked Out by damage from an attack from your
    // opponent's Pokémon, put 4 damage counters on the Attacking Pokémon."
    // Gholdengo Knocks it Out with the same attack that shuffles Gholdengo away,
    // so the counters are owed to a body sitting in its controller's deck.
    // `addDamageByUid` returns `null`, `recoiled` stays `null`, and NOTHING is
    // placed — the code was always right and only its stated reason was wrong.
    const state = board({ bench: 2, defender: WALL, defenderTool: VENGEFUL_PUNCH, p2Bench: 2 });
    const parked = must(applyAction(state, SURF_BACK));
    const attacker = parked.players.p1.active?.stack.at(-1) ?? "";
    const { state: done, events } = apply(parked, YES);

    // The antecedent HELD — the holder really was Knocked Out by this attack.
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    // …and no counterattack row was written, because there was nobody to write it
    // on. NOT "no row because the Tool did not fire" — §5 below is the control.
    const recoils = events.filter(
      (e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack",
    );
    expect(recoils).toEqual([]);
    // The attacker is in the deck with no damage anywhere on it.
    expect(done.players.p1.deck).toContain(attacker);
  });

  it("…and the CONTROL: DECLINE the removal and the SAME 4 counters LAND", () => {
    // 🛑 THE INTERSECTION PROOF (D310's lesson: prove the branch discriminates, or
    // the case above is green and dead). The identical board, the identical Tool,
    // the identical Knock Out — and answering NO instead of YES leaves the
    // attacker standing, so the recoil it is owed is placed on it.
    const state = board({ bench: 2, defender: WALL, defenderTool: VENGEFUL_PUNCH, p2Bench: 2 });
    const parked = must(applyAction(state, SURF_BACK));
    const { state: done, events } = apply(parked, NO);

    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    const recoils = events.filter(
      (e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack",
    );
    expect(recoils).toHaveLength(1);
    expect(recoils[0]).toMatchObject({ seat: "p1", amount: 40 });
    expect(done.players.p1.active?.damage).toBe(40);
  });
});
