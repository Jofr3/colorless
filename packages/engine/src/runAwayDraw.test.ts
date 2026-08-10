import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { resolveMidTurnKnockOuts } from "./flow";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── D311 — "ONCE DURING YOUR TURN, YOU MAY DRAW 3 CARDS. IF YOU DREW ANY CARDS IN
//    THIS WAY, SHUFFLE THIS POKÉMON AND ALL ATTACHED CARDS INTO YOUR DECK."
//    THE SELF-REMOVAL FAMILY'S **ABILITY** HALF. ─────────────────────────────
//
// THE POPULATION, queried against remote Cloudflare D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-10**, WHOLE
// COLUMN read (D306's rule — every arm, `damage` and `cost` included):
//
//   SELECT id, name, category, stage, evolve_from, legal_standard,
//          types_json, abilities_json, attacks_json, effect
//     FROM cards
//    WHERE instr(coalesce(abilities_json,''),'this Pokémon and all attached cards') > 0
//       OR instr(coalesce(attacks_json,''),  'this Pokémon and all attached cards') > 0
//       OR instr(coalesce(effect,''),        'this Pokémon and all attached cards') > 0;
//
// **EIGHT LEGAL ROWS**, and two of them are Dudunsparce `sv05-129` /
// `sv08.5-080` — `Stage1` off `Dunsparce`, 140 HP, retreat 3,
// `types_json = ["Colorless"]`, one attack ("Land Crush", `cost` three
// Colorless, `damage: 90`, **no `effect` key**, so this row contributes ZERO
// attack units and cannot move `BUILT.attack` even in principle).
//
// ── 🛑 THE HANDOFF'S CENSUS WAS RIGHT AND STILL SHORT, AND THAT IS THIS
//    SLICE'S FIRST RESULT. ──────────────────────────────────────────────────
//
// The `returnBenched` doc block has carried a refused list since D299 whose
// quoted statement sweeps `attacks_json` ALONE. D310 re-ran it across
// `abilities_json` too, found this card, and handed the corrected count over as
// EIGHT. **Eight is what a wider set of COLUMNS returns for the SAME LITERAL,
// and the literal is the other half of the same mistake:**
//
//   SELECT id, name, legal_standard, abilities_json, attacks_json, effect
//     FROM cards
//    WHERE legal_standard = 1
//      AND (instr(coalesce(abilities_json,''),'it and all attached cards') > 0
//        OR instr(coalesce(attacks_json,''),  'it and all attached cards') > 0
//        OR instr(coalesce(effect,''),        'it and all attached cards') > 0);
//
// returns **Abra `sv06-080`** — *"Once during your turn, if this Pokémon is in
// the Active Spot, you may shuffle **it** and all attached cards into your
// deck."* The same removal, spelled with a PRONOUN, which
// `'this Pokémon and all attached cards'` cannot see at ANY column width. (The
// other two rows the pronoun query returns are Sylveon `svp-172`/`sv06.5-022`,
// where "that Pokémon" is the OPPONENT's chosen body — already built at D299.)
//
// ⚠️ **A CENSUS IS AS NARROW AS *BOTH* THE COLUMNS ITS QUERY NAMES AND THE
// LITERAL IT MATCHES. WIDENING ONE PROVES NOTHING ABOUT THE OTHER.**
//
// ── 🛑 THE BLOCKER, SETTLED AGAINST THE CODE RATHER THAN AGAINST THE PRICE ──
//
// The row arrived priced as *"an ABILITY with no Active-Spot clause, so a
// BENCHED Dudunsparce removing itself owes no promotion at all"*, with the
// Active half deferred. **Both halves of that are answered here, and the answer
// to the second one is what made the slice affordable:**
//
//   • The Active case genuinely DOES owe a promotion. `settleProgram` (flow.ts)
//     ends in `resolveMidTurnKnockOuts`, which swept KNOCK OUTS only, and
//     `returnBenched` hard-refuses a non-bench ref — so nothing in the engine
//     had ever left the Active Spot empty without a Knock Out.
//   • **And the promotion was never a STAGE, it was a QUEUEING SEAM.**
//     `PendingStage {kind:"promote"}` has been total over the three boards it
//     can meet since M4: it POPS on a spot something refilled, AUTO-RESOLVES a
//     Bench of one, and falls into the §14.2 loss on a Bench of none. The whole
//     cost is asking for it. §3 and §4 below drive all three.
//
// That is D307's third question — *does the new caller actually reach the
// stage* — answered for the fourth time in five slices, and this time the honest
// answer is "yes, and the stage was already there".
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE new `EffectOp` (`returnSelf`), ONE optional field on `drawCards`
// (`recordAs`), ONE queueing seam and ONE registry row over TWO ids. **NO new
// `PendingStage` kind, prompt kind, choice kind, event, error code, `GameState`
// field, `AbilityProgram` field, regex or deriver arm** — `POKEMON_RETURNED` and
// `PROMOTION_REQUIRED` are both reused, and there is no ability deriver in this
// engine at all, which is why an ability row is registry-keyed by construction
// and buys exactly its own legal printings. `packages/schema` takes ZERO.

/** The printed sentence, transcribed off the D1 row rather than assembled
    (D306: transcribe, never interpolate). */
const PRINTED =
  "Once during your turn, you may draw 3 cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck.";

/** Abra `sv06-080` "Teleporter" — the PRONOUN spelling this slice's census
    correction turns on. Transcribed off the D1 row; not built, and asserted
    UNBUILT in §7 so the list and the registry cannot drift apart. */
const ABRA_PRINTED =
  "Once during your turn, if this Pokémon is in the Active Spot, you may shuffle it and all attached cards into your deck.";

const DUDUNSPARCE = "sv05-129";
const REPRINT = "sv08.5-080";
const FILLER = "fix-d311-filler";
const TOOL = "fix-d311-tool";
const ENERGY = "fix-d311-energy";

/** The LOCAL pool (D275's idiom). The two real ids live HERE and not in
    `FIXTURE_POOL`, deliberately: `catalogManifest.test.ts` diffs every `sv*` id
    in that pool against the 978-row / 6-set manifest, which holds
    sv01/sv02/sv03/sv06.5 ONLY — so a real `sv05`/`sv08.5` fixture there would
    fail, and a `fix-*` demonstrator is the price a TRAINER pays for that. A
    Pokémon BODY does not: it is put into play by surgery off a local deck, so
    the real ids are driven directly and NO demonstrator is owed. */
const LOCAL_CARDS: Record<string, Card> = {
  [DUDUNSPARCE]: battler(DUDUNSPARCE, {
    name: "Dudunsparce",
    hp: 140,
    stage: "Stage1",
    evolveFrom: "Dunsparce",
    retreat: 3,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: "Run Away Draw", effect: PRINTED }],
    attacks: [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Land Crush", damage: 90 }],
  }),
  [REPRINT]: battler(REPRINT, {
    name: "Dudunsparce",
    hp: 140,
    stage: "Stage1",
    evolveFrom: "Dunsparce",
    retreat: 3,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: "Run Away Draw", effect: PRINTED }],
    attacks: [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Land Crush", damage: 90 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D311 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [TOOL]: trainerCard(TOOL, "Tool", "Attach to 1 of your Pokémon."),
  [ENERGY]: typedEnergy(ENERGY, "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [DUDUNSPARCE]: 4,
  [REPRINT]: 2,
  [TOOL]: 2,
  [FILLER]: 16,
  [ENERGY]: 36,
});

/** Two seeds — nothing below rests on one shuffle (D270). */
const SEEDS = [3119, 3121] as const;

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

/** p1 on its own turn with a FILLER Active and the Dudunsparce on the bench at
    index 0 — the printed sentence carries no Active-Spot clause, so the BENCH is
    where the cheap half lives and the Active board is built separately in §3. */
function benched(seed: number = SEEDS[0]): GameState {
  let state = localSetup(seed, "p2");
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", FILLER);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", DUDUNSPARCE);
  return state;
}

/** p1 on its own turn with the Dudunsparce ACTIVE and `bench` filler bodies
    behind it — the board that owes the §8.1 promotion. */
function active(bench: number, seed: number = SEEDS[0]): GameState {
  let state = localSetup(seed, "p2");
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", DUDUNSPARCE);
  state = clearBench(state, "p1");
  for (let i = 0; i < bench; i += 1) state = benchFromDeck(state, "p1", FILLER);
  return state;
}

const USE_BENCH = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Run Away Draw",
} as const;

const USE_ACTIVE = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "active" },
  abilityName: "Run Away Draw",
} as const;

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

/** TEST SURGERY — leave exactly `n` cards in p1's deck, the rest to the discard.
    The printed "if you drew any cards in this way" only comes apart from the
    printed "draw 3 cards" on a SHALLOW deck, so the boundary needs one. */
function deckOfSize(state: GameState, n: number): GameState {
  const side = state.players.p1;
  return {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, deck: side.deck.slice(0, n), discard: [...side.discard, ...side.deck.slice(n)] },
    },
  };
}

/** TEST SURGERY — hang an Energy and a Tool on p1's bench-0 body, so "all
    ATTACHED cards" has something to be about. Both come off the deck, so every
    uid stays in exactly one zone. */
function loadBench0(state: GameState): GameState {
  const side = state.players.p1;
  const body = side.bench[0];
  if (body === undefined) throw new Error("p1 bench 0 is empty");
  const energy = side.deck.find((u) => state.cardIdByUid[u] === ENERGY);
  const tool = side.deck.find((u) => state.cardIdByUid[u] === TOOL);
  if (energy === undefined || tool === undefined) throw new Error("deck lacks an energy/tool");
  const bench = [...side.bench];
  bench[0] = { ...body, energy: [...body.energy, energy], tools: [...body.tools, tool] };
  return {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, bench, deck: side.deck.filter((u) => u !== energy && u !== tool) },
    },
  };
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

// ────────────────────────────────────────────────────────────────────────────
describe("D311 §1 — the print, the population, and the registry row that maps it", () => {
  it("the fixture carries the printed sentence VERBATIM, on BOTH printings", () => {
    // D183's rule: author and assert against the printed bytes, not a paraphrase.
    for (const id of [DUDUNSPARCE, REPRINT]) {
      expect(POOL[id]?.abilities?.[0]?.effect).toBe(PRINTED);
      expect(POOL[id]?.abilities?.[0]?.name).toBe("Run Away Draw");
    }
    // The clause that is NOT printed is the whole reason `activeOnly` is false.
    expect(PRINTED).not.toContain("Active Spot");
    // …and Abra's, which IS, is the control that the absence is a fact about
    // this card rather than about the family.
    expect(ABRA_PRINTED).toContain("in the Active Spot");
  });

  it("BOTH legal printings map to the SAME registry object", () => {
    const first = programFor(DUDUNSPARCE);
    expect(first).toBeDefined();
    expect(programFor(REPRINT)).toBe(first); // identity, not equality
    expect(first?.abilities).toHaveLength(1);
  });

  it("the row is a bare `Once during your turn` — no gate, no shared scope, no Active clause", () => {
    const ability = programFor(DUDUNSPARCE)?.abilities?.[0];
    expect(ability?.oncePerTurn).toBe(true); // not "sharedByName" — no such rider is printed
    expect(ability?.activeOnly).toBe(false);
    expect(ability?.playableIf).toBeUndefined();
    expect(ability?.remainingHpAtMost).toBeUndefined();
    expect(ability?.endsTurn).toBeUndefined();
  });

  it("the program is the printed sentence in order: a RECORDED draw, then a gated self-removal", () => {
    const program = programFor(DUDUNSPARCE)?.abilities?.[0]?.program ?? [];
    expect(program).toEqual([
      { op: "drawCards", count: 3, recordAs: "moved" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "moved", then: [{ op: "returnSelf", dest: "deck" }] },
    ]);
    // The gate has NO `otherwise`: the printed sentence says what happens if you
    // drew, and nothing at all about the other branch.
    const gate = program[1];
    expect(gate?.op === "recordGate" && gate.otherwise).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D311 §2 — the BENCH case: the body and everything on it go into the deck", () => {
  for (const seed of SEEDS) {
    it(`draws 3 and shuffles the whole stack away (seed ${seed})`, () => {
      const before = loadBench0(benched(seed));
      const hand = before.players.p1.hand.length;
      const deck = before.players.p1.deck.length;
      const body = before.players.p1.bench[0];
      if (body === undefined) throw new Error("p1 bench 0 is empty");
      const carried = [...body.stack, ...body.energy, ...body.tools];
      expect(carried).toHaveLength(3); // the Dudunsparce, an Energy and a Tool

      const { state: after, events } = apply(before, USE_BENCH);

      // The draw happened…
      expect(after.players.p1.hand.length).toBe(hand + 3);
      // …and the whole pile went back: −3 drawn, +3 returned.
      expect(after.players.p1.deck.length).toBe(deck - 3 + carried.length);
      expect(after.players.p1.bench).toHaveLength(0);
      // Every carried uid is in the deck and nowhere else.
      for (const uid of carried) {
        expect(after.players.p1.deck).toContain(uid);
        expect(after.players.p1.hand).not.toContain(uid);
        expect(after.players.p1.discard).not.toContain(uid);
      }

      const returned = find(events, "POKEMON_RETURNED");
      expect(returned?.seat).toBe("p1");
      expect(returned?.actor).toBe("p1");
      expect(returned?.dest).toBe("deck");
      expect(returned?.uid).toBe(body.stack[body.stack.length - 1]);
      expect([...(returned?.uids ?? [])].sort()).toEqual([...carried].sort());
      // A deck destination is shuffled, and the shuffle is its own row (D299).
      expect(find(events, "SHUFFLE")?.seat).toBe("p1");
    });
  }

  it("the ACTIVE spot is untouched and NO promotion is queued", () => {
    const before = benched();
    const activeUid = before.players.p1.active?.stack[0];
    const { state: after, events } = apply(before, USE_BENCH);
    expect(after.players.p1.active?.stack[0]).toBe(activeUid);
    expect(after.pending).toEqual([]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(find(events, "PROMOTION_REQUIRED")).toBeUndefined();
  });

  it("the BENCH COMPACTS — the body behind it slides down, §8.1's no-gap rule", () => {
    let before = benched();
    before = benchFromDeck(before, "p1", FILLER);
    const survivor = before.players.p1.bench[1]?.stack[0];
    expect(before.players.p1.bench).toHaveLength(2);
    const after = apply(before, USE_BENCH).state;
    expect(after.players.p1.bench).toHaveLength(1);
    expect(after.players.p1.bench[0]?.stack[0]).toBe(survivor);
  });

  it("it never PARKS — the printed subject is a pronoun, so there is nothing to choose", () => {
    // Two bodies that could each be a candidate if this op had one. The
    // `returnBenched` sibling would park here; this one cannot.
    let before = benched();
    before = benchFromDeck(before, "p1", REPRINT);
    const after = apply(before, USE_BENCH).state;
    expect(after.phase.kind).toBe("turn:action");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D311 §3 — the ACTIVE case: the §8.1 promotion the family was priced behind", () => {
  it("a Bench of TWO raises `ko:promote` and the seat picks", () => {
    const before = active(2);
    const { state: after, events } = apply(before, USE_ACTIVE);
    expect(after.players.p1.active).toBeNull();
    expect(after.phase).toEqual({ kind: "ko:promote", seat: "p1" });
    expect(find(events, "PROMOTION_REQUIRED")?.seat).toBe("p1");
    // EXACTLY ONE promotion is owed — the seam must not stack a second stage.
    // The stage stays at the queue head while the phase asks for the pick; the
    // `resumeTurn` behind it is what hands p1's turn back afterwards.
    expect(after.pending.filter((stage) => stage.kind === "promote")).toHaveLength(1);
    expect(after.pending.map((stage) => stage.kind)).toEqual(["promote", "resumeTurn"]);

    const chosen = after.players.p1.bench[1]?.stack[0];
    const done = apply(after, { type: "promote", seat: "p1", benchIndex: 1 }).state;
    expect(done.players.p1.active?.stack[0]).toBe(chosen);
    expect(done.players.p1.bench).toHaveLength(1);
    // …and p1's TURN RESUMES rather than ending: this is a mid-turn interrupt.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(done.pending).toEqual([]);
  });

  it("a Bench of ONE is FORCED — the M1 no-choice doctrine, inherited not written", () => {
    const before = active(1);
    const only = before.players.p1.bench[0]?.stack[0];
    const { state: after, events } = apply(before, USE_ACTIVE);
    expect(after.players.p1.active?.stack[0]).toBe(only);
    expect(after.players.p1.bench).toHaveLength(0);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(find(events, "PROMOTION_REQUIRED")).toBeUndefined();
  });

  it("🛑 a Bench of NONE is the §14.2 LOSS, and it costs no code at all", () => {
    const before = active(0);
    expect(before.players.p1.bench).toHaveLength(0);
    const after = apply(before, USE_ACTIVE).state;
    // The controller shuffled away their last Pokémon in play and lost for it.
    expect(after.phase.kind).toBe("gameOver");
    const outcome = after.phase.kind === "gameOver" ? after.phase.outcome : null;
    expect(outcome?.result).toBe("win");
    expect(outcome?.result === "win" && outcome.winner).toBe("p2");
  });

  it("the draw still happens on the way out — the two clauses are ONE resolution", () => {
    const before = active(2);
    const hand = before.players.p1.hand.length;
    const after = apply(before, USE_ACTIVE).state;
    expect(after.players.p1.hand.length).toBe(hand + 3);
  });

  it("🛑 a KO'd seat is NOT given a SECOND promotion — the seam skips what the batch named", () => {
    // The dedup case, reached through the function itself: a lethal Active is
    // KO'd by `collectKnockOuts`, which empties the spot AND queues the
    // promotion. Without the skip, the empty-spot sweep would queue another.
    const board = setDamage(benched(), "p1", 200); // FILLER is a 200 HP body
    const events: GameEvent[] = [];
    const result = resolveMidTurnKnockOuts(board, "p1", ["p1", "p2"], events);
    if (!result.ok) throw new Error(`sweep failed: ${result.error.code}`);
    const promotes = [
      ...result.state.pending.filter((stage) => stage.kind === "promote"),
      ...(result.state.phase.kind === "ko:promote" ? [result.state.phase] : []),
    ];
    expect(promotes).toHaveLength(1);
    expect(find(events, "KNOCKED_OUT")?.seat).toBe("p1");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D311 §4 — the printed 'in this way', which is not decoration", () => {
  it("an EMPTY deck draws nothing, and the body STAYS", () => {
    const before = deckOfSize(benched(), 0);
    const body = before.players.p1.bench[0]?.stack[0];
    const { state: after, events } = apply(before, USE_BENCH);
    expect(after.players.p1.bench).toHaveLength(1);
    expect(after.players.p1.bench[0]?.stack[0]).toBe(body);
    expect(find(events, "POKEMON_RETURNED")).toBeUndefined();
    expect(find(events, "CARDS_DRAWN")).toBeUndefined();
  });

  it("a ONE-card deck SHORT-DRAWS and the body still goes — 'any cards', not 'three cards'", () => {
    const before = deckOfSize(benched(), 1);
    const hand = before.players.p1.hand.length;
    const { state: after, events } = apply(before, USE_BENCH);
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(1);
    expect(after.players.p1.hand.length).toBe(hand + 1);
    expect(after.players.p1.bench).toHaveLength(0);
    // The one card drawn left, the one-card body came back: net +1 in the deck.
    expect(after.players.p1.deck).toHaveLength(1);
  });

  it("🛑 an EMPTY deck on the ACTIVE owes NO promotion either — the gate is upstream of the seam", () => {
    const before = deckOfSize(active(2), 0);
    const { state: after, events } = apply(before, USE_ACTIVE);
    expect(after.players.p1.active).not.toBeNull();
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(find(events, "PROMOTION_REQUIRED")).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D311 §5 — §9's once-per-turn, and the scope it is NOT", () => {
  it("a SECOND Dudunsparce runs away on the same turn — the scope is the BODY", () => {
    // `oncePerTurn: true` keys on the uid; `"sharedByName"` would key on the
    // name and lock the second copy out. No such rider is printed.
    let before = benched();
    before = benchFromDeck(before, "p1", REPRINT);
    const first = apply(before, USE_BENCH).state;
    expect(first.players.p1.bench).toHaveLength(1);
    const second = apply(first, USE_BENCH).state;
    expect(second.players.p1.bench).toHaveLength(0);
  });

  it("the ability is usable from the ACTIVE SPOT — `activeOnly` is false and the print says so", () => {
    const result = applyAction(active(2), USE_ACTIVE);
    expect(result.ok).toBe(true);
    // …and the reject that WOULD fire if the row carried Abra's clause.
    expect(result.ok === false && result.error.code).not.toBe("ABILITY_ACTIVE_ONLY");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D311 §6 — the record slot, and why `MATCH_RECORD_VERSION` does not move", () => {
  it("a `drawCards` WITHOUT `recordAs` files nothing — the v18 shape, read forward", () => {
    // A version-18 deploy cannot author `recordAs`, so a v18 record's draw files
    // NOTHING and a gate behind it takes its `otherwise` (here: nothing). That is
    // exactly what a v18 record meant, which is why this is a SKIP and not a bump.
    const program = programFor(DUDUNSPARCE)?.abilities?.[0]?.program ?? [];
    const draw = program[0];
    expect(draw?.op === "drawCards" && draw.recordAs).toBe("moved");
    // The widening is OPTIONAL at the type level, which is the whole claim: the
    // op is well-formed without it, and every op authored before this slice is
    // unchanged.
    const v18Shaped = { op: "drawCards", count: 3 } as const;
    expect(Object.hasOwn(v18Shaped, "recordAs")).toBe(false);
  });

  it("the slot is `moved` and the gate reads the SAME one — a typo would be a silent no-op", () => {
    const program = programFor(DUDUNSPARCE)?.abilities?.[0]?.program ?? [];
    const draw = program[0];
    const gate = program[1];
    const drawSlot = draw?.op === "drawCards" ? draw.recordAs : undefined;
    const gateSlot = gate?.op === "recordGate" ? gate.slot : undefined;
    expect(drawSlot).toBe(gateSlot);
    expect(drawSlot).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D311 §7 — the CORRECTED census, and what each remaining printing owes", () => {
  /** The self-removal family, re-derived 2026-08-10 over `attacks_json` +
      `abilities_json` + `effect` at `legal_standard = 1`.
      🆕 **RE-POINTED AT D312 FROM NINE TO THIRTEEN**, and the four it gains are
      the whole lesson: D311's union of `'this Pokémon and all attached cards'`
      and `'it and all attached cards'` fixed the COLUMNS and then the LITERAL,
      and both fixes are blind to a sentence that prints the noun and the
      participle the other way round. `'cards attached'` returns **Team Rocket's
      Crobat ex ×4**, which no literal containing the substring `attached cards`
      can match at ANY column width. The `owes` string is the mechanism the engine
      still lacks, and the built rows carry `null`. */
  const FAMILY: readonly (readonly [string, string, string | null])[] = [
    ["sv05-129", "Dudunsparce — Run Away Draw (Ability)", null],
    ["sv08.5-080", "Dudunsparce — Run Away Draw (Ability, reprint)", null],
    ["sv06-080", "Abra — Teleporter (Ability, activeOnly)", null], // 🆕 BUILT at D312
    ["sv08-131", "Gholdengo — Surf Back (attack idx 1)", null], // 🆕 BUILT at D312
    ["sv06-043", "Poliwrath — Jumping Uppercut (attack)", "a conditional damage BOOST behind the decision"],
    // 🆕 D314 — BUILT, and the `owes` string it carried for three sessions was
    // WRONG about the field. There is no `recordAs`: the printed *"If you do"*
    // has no separating board on this card (see `breezyGift.test.ts` §2), so the
    // row is `returnSelf` + `searchDeck` + `shuffleDeck`, three existing ops.
    ["sv07-011", "Eldegoss — Breezy Gift (attack idx 0)", null], // 🆕 BUILT at D314
    // 🆕 D313 — the DESTINATION axis, all three remaining zones at once. `dest`
    // could not be authored honestly over one spelling (D311 and D312 both refused
    // it and said so), so these seven landed together.
    ["sv09-068", "Lillie's Comfey — Fade Out (attack idx 1)", null], // 🆕 BUILT at D313
    ["sv06.5-015", "Revavroom ex — Shattering Speed (attack idx 1)", null], // 🆕 BUILT at D313
    ["sv06.5-081", "Revavroom ex — Shattering Speed (idx 1, reprint)", null], // 🆕 BUILT at D313
    // 🆕 D312's WORD-ORDER FIND, BUILT AT D313 — the body to the HAND and the
    // attachments to the DISCARD, a SPLIT destination neither Comfey nor Revavroom
    // has, and the reason `dest` is one zone plus an override rather than two.
    ["sv10-122", "Team Rocket's Crobat ex — Assassin's Return", null], // 🆕 BUILT at D313
    ["sv10-217", "Team Rocket's Crobat ex — Assassin's Return (reprint)", null], // 🆕 BUILT at D313
    ["sv10-234", "Team Rocket's Crobat ex — Assassin's Return (reprint)", null], // 🆕 BUILT at D313
    ["sv10-242", "Team Rocket's Crobat ex — Assassin's Return (reprint)", null], // 🆕 BUILT at D313
  ];

  it("🆕 the family is THIRTEEN — re-pointed at D312 — and TWELVE are built at D314", () => {
    // ⚠️ THIS RUNG WAS WRITTEN AT D311 SAYING NINE, AND IT WAS WRONG THEN. Kept as
    // the record of how a census that had already been corrected twice was still
    // short: the fix is not a wider column set and not a shorter literal, it is
    // reading the printed sentence for a spelling the query cannot imagine.
    expect(FAMILY).toHaveLength(13);
    const built = FAMILY.filter(([, , owes]) => owes === null).map(([id]) => id);
    // 🆕 D314 — 11 → 12, and the ONE left is refused on a piece no registry row
    // can supply. D313 wrote that the two remaining COMPOUNDS were each behind
    // "one named piece"; Eldegoss's named piece turned out not to exist (no
    // `recordAs` is owed), and Poliwrath's is a change to the DAMAGE FOLD rather
    // than a field — *"You may do 120 more damage"* puts a player decision in
    // FRONT of §8.5, which `attack.ts` folds before the program runs. `effects.ts`
    // already refuses the identical shape one family over (Copperajah
    // `sv06.5-042`). **So the family cannot be closed by another registry row.**
    expect(built).toEqual([
      DUDUNSPARCE, REPRINT, "sv06-080", "sv08-131",
      "sv07-011",
      "sv09-068", "sv06.5-015", "sv06.5-081",
      "sv10-122", "sv10-217", "sv10-234", "sv10-242",
    ]);
    const owed = FAMILY.filter(([, , owes]) => owes !== null).map(([id]) => id);
    expect(owed).toEqual(["sv06-043"]);
  });

  it("🛑 every REFUSED printing is refused LIVE — no registry row hides behind the list", () => {
    // The converse guard D304 taught: a list of "not built" that nobody asks the
    // registry about is a list that rots the moment a row lands.
    //
    // ⚠️ THE QUESTION IS ABOUT THE SENTENCE AND NOT ABOUT THE CARD, which this
    // rung learned the hard way: Lillie's Comfey `sv09-068` DOES carry a registry
    // program — for its OTHER attack, "Inviting Flowers" — and a bare
    // `programFor(id) === undefined` would have called the card built and gone red
    // on a row that has nothing to do with this family. The live question is
    // whether any authored op on that id is a `returnSelf`.
    //
    // 🆕 **D312 WIDENED THAT LESSON AND THIS RUNG WITH IT.** The old shape also
    // asserted `programFor(id)?.abilities` on every BUILT row, which was true only
    // while every built row happened to be an Ability. Gholdengo `sv08-131` is a
    // registry ATTACK, so "built" is now the `returnSelf` and nothing else — and
    // the refusal half gained TWO more cards that carry a program for an unrelated
    // printed sentence (Crobat ex ×4, "Biting Spree"), which is Comfey's own shape
    // arriving four more times.
    for (const [id, , owes] of FAMILY) {
      const authored = JSON.stringify(programFor(id) ?? null);
      if (owes === null) {
        expect(authored, id).toContain('"returnSelf"');
      } else {
        expect(authored, id).not.toContain('"returnSelf"');
      }
    }
    // 🆕 **D313 — THE WITNESS LIST IS NOW EMPTY, AND THAT IS THE OPPOSITE OF THIS
    // RUNG GOING VACUOUS.** D311 and D312 kept a list of refused printings that
    // nonetheless carried a program for an unrelated sentence (Comfey, Crobat ex
    // ×4) precisely because a bare `toBeUndefined()` would have called them built.
    // This slice BUILDS all five, so the list empties — and the discrimination it
    // was making is now carried by the loop above, which asks about the OP and not
    // about the card, on eleven built rows instead of four. ⚠️ The two refusals
    // that remain are cards with NO registry program at all, so the assertion
    // below can only stay green while that is true: build Poliwrath's other attack
    // and this reddens, which is exactly the rot it was written to catch.
    const refusedButProgrammed = FAMILY.filter(
      ([id, , owes]) => owes !== null && programFor(id) !== undefined,
    ).map(([id]) => id);
    expect(refusedButProgrammed).toEqual([]);
  });

  it("Abra's PRONOUN spelling is what the eight-row census could not see", () => {
    // The finding in one assertion: the corrected-COLUMNS literal does not match
    // Abra's sentence, and the pronoun literal does. Neither statement is about
    // which columns were swept.
    expect(ABRA_PRINTED).not.toContain("this Pokémon and all attached cards");
    expect(ABRA_PRINTED).toContain("it and all attached cards");
    // …and the built sentence is the other way round, which is why one query
    // returned eight rows and the other returned three.
    expect(PRINTED).toContain("this Pokémon and all attached cards");
    expect(PRINTED).not.toContain("it and all attached cards");
  });
});
