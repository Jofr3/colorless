import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { resolveMidTurnKnockOuts } from "./flow";
import { applyAction } from "./index";
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
  must,
  findEvent,
  driveSetup,
} from "./testFixtures";

const PRINTED =
  "Once during your turn, you may draw 3 cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck.";

const ABRA_PRINTED =
  "Once during your turn, if this Pokémon is in the Active Spot, you may shuffle it and all attached cards into your deck.";

const DUDUNSPARCE = "sv05-129";
const REPRINT = "sv08.5-080";
const FILLER = "fix-d311-filler";
const TOOL = "fix-d311-tool";
const ENERGY = "fix-d311-energy";

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

const SEEDS = [3119, 3121] as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
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
      p1: {
        ...side,
        deck: side.deck.slice(0, n),
        discard: [...side.discard, ...side.deck.slice(n)],
      },
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

// ────────────────────────────────────────────────────────────────────────────
describe("D311 §1 — the print, the population, and the registry row that maps it", () => {
  it("the fixture carries the printed sentence VERBATIM, on BOTH printings", () => {
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

      const returned = findEvent(events, "POKEMON_RETURNED");
      expect(returned?.seat).toBe("p1");
      expect(returned?.actor).toBe("p1");
      expect(returned?.dest).toBe("deck");
      expect(returned?.uid).toBe(body.stack[body.stack.length - 1]);
      expect([...(returned?.uids ?? [])].sort()).toEqual([...carried].sort());
      expect(findEvent(events, "SHUFFLE")?.seat).toBe("p1");
    });
  }

  it("the ACTIVE spot is untouched and NO promotion is queued", () => {
    const before = benched();
    const activeUid = before.players.p1.active?.stack[0];
    const { state: after, events } = apply(before, USE_BENCH);
    expect(after.players.p1.active?.stack[0]).toBe(activeUid);
    expect(after.pending).toEqual([]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(findEvent(events, "PROMOTION_REQUIRED")).toBeUndefined();
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
    expect(findEvent(events, "PROMOTION_REQUIRED")?.seat).toBe("p1");
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
    expect(findEvent(events, "PROMOTION_REQUIRED")).toBeUndefined();
  });

  it("a Bench of NONE is the §14.2 LOSS, and it costs no code at all", () => {
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

  it("a KO'd seat is NOT given a SECOND promotion — the seam skips what the batch named", () => {
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
    expect(findEvent(events, "KNOCKED_OUT")?.seat).toBe("p1");
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
    expect(findEvent(events, "POKEMON_RETURNED")).toBeUndefined();
    expect(findEvent(events, "CARDS_DRAWN")).toBeUndefined();
  });

  it("a ONE-card deck SHORT-DRAWS and the body still goes — 'any cards', not 'three cards'", () => {
    const before = deckOfSize(benched(), 1);
    const hand = before.players.p1.hand.length;
    const { state: after, events } = apply(before, USE_BENCH);
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(1);
    expect(after.players.p1.hand.length).toBe(hand + 1);
    expect(after.players.p1.bench).toHaveLength(0);
    // The one card drawn left, the one-card body came back: net +1 in the deck.
    expect(after.players.p1.deck).toHaveLength(1);
  });

  it("an EMPTY deck on the ACTIVE owes NO promotion either — the gate is upstream of the seam", () => {
    const before = deckOfSize(active(2), 0);
    const { state: after, events } = apply(before, USE_ACTIVE);
    expect(after.players.p1.active).not.toBeNull();
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(findEvent(events, "PROMOTION_REQUIRED")).toBeUndefined();
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
  const FAMILY: readonly (readonly [string, string, string | null])[] = [
    ["sv05-129", "Dudunsparce — Run Away Draw (Ability)", null],
    ["sv08.5-080", "Dudunsparce — Run Away Draw (Ability, reprint)", null],
    ["sv06-080", "Abra — Teleporter (Ability, activeOnly)", null],
    ["sv08-131", "Gholdengo — Surf Back (attack idx 1)", null],
    [
      "sv06-043",
      "Poliwrath — Jumping Uppercut (attack)",
      "a conditional damage BOOST behind the decision",
    ],
    ["sv07-011", "Eldegoss — Breezy Gift (attack idx 0)", null],
    ["sv09-068", "Lillie's Comfey — Fade Out (attack idx 1)", null],
    ["sv06.5-015", "Revavroom ex — Shattering Speed (attack idx 1)", null],
    ["sv06.5-081", "Revavroom ex — Shattering Speed (idx 1, reprint)", null],
    ["sv10-122", "Team Rocket's Crobat ex — Assassin's Return", null],
    ["sv10-217", "Team Rocket's Crobat ex — Assassin's Return (reprint)", null],
    ["sv10-234", "Team Rocket's Crobat ex — Assassin's Return (reprint)", null],
    ["sv10-242", "Team Rocket's Crobat ex — Assassin's Return (reprint)", null],
  ];

  it("the family is THIRTEEN — re-pointed at D312 — and TWELVE are built at D314", () => {
    expect(FAMILY).toHaveLength(13);
    const built = FAMILY.filter(([, , owes]) => owes === null).map(([id]) => id);
    expect(built).toEqual([
      DUDUNSPARCE,
      REPRINT,
      "sv06-080",
      "sv08-131",
      "sv07-011",
      "sv09-068",
      "sv06.5-015",
      "sv06.5-081",
      "sv10-122",
      "sv10-217",
      "sv10-234",
      "sv10-242",
    ]);
    const owed = FAMILY.filter(([, , owes]) => owes !== null).map(([id]) => id);
    expect(owed).toEqual(["sv06-043"]);
  });

  it("every REFUSED printing is refused LIVE — no registry row hides behind the list", () => {
    for (const [id, , owes] of FAMILY) {
      const authored = JSON.stringify(programFor(id) ?? null);
      if (owes === null) {
        expect(authored, id).toContain('"returnSelf"');
      } else {
        expect(authored, id).not.toContain('"returnSelf"');
      }
    }
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
