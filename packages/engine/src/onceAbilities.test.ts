import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  specialEnergy,
  trimDeckTo,
  typedEnergy,
  types,
} from "./testFixtures";

// ── 🆕🆕🆕 D553 — THE SIMPLE ONCE-PER-TURN ABILITIES, PART A: DRAW, HEAL, ENERGY ──
//
// Four of the slice's seven printed texts, 7 of its 12 legal printings (the three
// deck searches are `onceAbilitySearch.test.ts`):
//
//   Rapidash  sv10-030 / sv10-189     "Hurried Gait"    — draw a card
//   Chandelure sv06-038               "Alluring Light"  — each player draws a card
//   Blissey ex sv06-134 / sv06-201    "Happy Switch"    — move a Basic Energy, own → own
//   Swadloon  sv10.5w-002 / -088      "Healing Leaves"  — heal 20 from your Active
//
// ZERO new vocabulary: every op, field and member these rows spell already existed,
// so the whole slice is seven registry objects plus one caption article
// (`retrieveNoun`'s byName arm, part B). Texts, stages and attacks off tcgdex (the
// ingest's own upstream), 2026-09-25.
//
// 🛑 **THE REAL IDS ARE DRIVEN ON A LOCAL `cardPool` (D275's idiom) AND NO `fix-*`
// DEMONSTRATOR IS OWED.** The generated manifest holds none of these sets, so the
// bodies cannot join `FIXTURE_POOL`; a Pokémon body is put into play by SURGERY off a
// local deck, which is all an Ability needs. ⚠️ **SAID OUT LOUD (D243): every body
// below keeps its PRINTED stage (Stage 1 / Stage 2) on the fixture, and is SEATED as
// a Basic would be** — `setActiveFromDeck` / `benchFromDeck` put a one-card stack into
// play with no pre-evolution beneath it. No rung here reads the stack's depth, and the
// printed stage is what keeps these bodies out of the setup's Basic pick.

const HURRIED_GAIT_TEXT = "Once during your turn, you may draw a card.";
const ALLURING_LIGHT_TEXT = "Once during your turn, you may have each player draw a card.";
const HAPPY_SWITCH_TEXT =
  "Once during your turn, you may move a Basic Energy from 1 of your Pokémon to another of your Pokémon.";
const HEALING_LEAVES_TEXT = "Once during your turn, you may heal 20 damage from your Active Pokémon.";

const RAPIDASH = "sv10-030";
const RAPIDASH_2 = "sv10-189";
const CHANDELURE = "sv06-038";
const BLISSEY = "sv06-134";
const BLISSEY_2 = "sv06-201";
const SWADLOON = "sv10.5w-002";
const SWADLOON_2 = "sv10.5w-088";

const FILLER = "d553-filler";
const ENERGY = "d553-grass";
const SPECIAL = "d553-special";

function body(
  id: string,
  name: string,
  stage: string,
  evolveFrom: string,
  ability: string,
  effect: string,
  attack: string,
): Card {
  return battler(id, {
    name,
    hp: 120,
    stage,
    evolveFrom,
    retreat: 2,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: ability, effect }],
    attacks: [{ cost: ["Colorless"], name: attack, damage: 10 }],
  });
}

/** The LOCAL pool. Each printed sentence is carried VERBATIM on every printing
    (D183), so §1 can assert the bytes the registry row was read off. */
const LOCAL_CARDS: Record<string, Card> = {
  [RAPIDASH]: body(RAPIDASH, "Rapidash", "Stage1", "Ponyta", "Hurried Gait", HURRIED_GAIT_TEXT, "Fire Mane"),
  [RAPIDASH_2]: body(RAPIDASH_2, "Rapidash", "Stage1", "Ponyta", "Hurried Gait", HURRIED_GAIT_TEXT, "Fire Mane"),
  [CHANDELURE]: body(CHANDELURE, "Chandelure", "Stage2", "Lampent", "Alluring Light", ALLURING_LIGHT_TEXT, "Mind Ruler"),
  [BLISSEY]: body(BLISSEY, "Blissey ex", "Stage1", "Chansey", "Happy Switch", HAPPY_SWITCH_TEXT, "Return"),
  [BLISSEY_2]: body(BLISSEY_2, "Blissey ex", "Stage1", "Chansey", "Happy Switch", HAPPY_SWITCH_TEXT, "Return"),
  [SWADLOON]: body(SWADLOON, "Swadloon", "Stage1", "Sewaddle", "Healing Leaves", HEALING_LEAVES_TEXT, "Bug Buzz"),
  [SWADLOON_2]: body(SWADLOON_2, "Swadloon", "Stage1", "Sewaddle", "Healing Leaves", HEALING_LEAVES_TEXT, "Bug Buzz"),
  [FILLER]: battler(FILLER, {
    name: "D553 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: typedEnergy(ENERGY, "Grass"),
  [SPECIAL]: specialEnergy(SPECIAL, "D553 Special Energy"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Three copies of every body, so a seeded opening hand or Prize row never holds
    the only copy a board wants. */
const DECK = deckOf({
  [RAPIDASH]: 3,
  [RAPIDASH_2]: 3,
  [CHANDELURE]: 3,
  [BLISSEY]: 3,
  [BLISSEY_2]: 3,
  [SWADLOON]: 3,
  [SWADLOON_2]: 3,
  [FILLER]: 17,
  [ENERGY]: 18,
  [SPECIAL]: 4,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with `first` going first, then that seat ends its turn — so the OTHER seat
    is on its own (unrestricted) turn. */
function turnOf(seat: Seat, seed = 553): GameState {
  const first: Seat = seat === "p1" ? "p2" : "p1";
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === FILLER);
    if (uid === undefined) throw new Error(`no filler Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: first }));
}

/** `seat` on its own turn, a FILLER Active, and `ids` benched in order. */
function benched(seat: Seat, ids: readonly string[], seed = 553): GameState {
  let state = turnOf(seat, seed);
  state = setActiveFromDeck(state, seat, FILLER);
  state = clearBench(state, seat);
  for (const id of ids) state = benchFromDeck(state, seat, id);
  return state;
}

/** `seat` on its own turn with `id` ACTIVE and `bench` fillers behind it. */
function active(seat: Seat, id: string, bench = 0, seed = 553): GameState {
  let state = turnOf(seat, seed);
  state = setActiveFromDeck(state, seat, id);
  state = clearBench(state, seat);
  for (let i = 0; i < bench; i += 1) state = benchFromDeck(state, seat, FILLER);
  return state;
}

function use(seat: Seat, abilityName: string, index: number | "active" = 0): GameAction {
  return {
    type: "useAbility",
    seat,
    target: index === "active" ? { spot: "active" } : { spot: "bench", index },
    abilityName,
  };
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

// ────────────────────────────────────────────────────────────────────────────
describe("D553 A §1 — the print, and the registry rows that map it", () => {
  const ROWS: readonly [ids: readonly string[], name: string, text: string, program: unknown][] = [
    [[RAPIDASH, RAPIDASH_2], "Hurried Gait", HURRIED_GAIT_TEXT, [{ op: "drawCards", count: 1 }]],
    [[CHANDELURE], "Alluring Light", ALLURING_LIGHT_TEXT, [{ op: "drawCards", count: 1, who: "eachPlayer" }]],
    [
      [BLISSEY, BLISSEY_2],
      "Happy Switch",
      HAPPY_SWITCH_TEXT,
      [{ op: "moveEnergy", filter: { kind: "basicEnergy" }, max: 1 }],
    ],
    [[SWADLOON, SWADLOON_2], "Healing Leaves", HEALING_LEAVES_TEXT, [{ op: "heal", target: "self", amount: 20 }]],
  ];

  for (const [ids, name, text, program] of ROWS) {
    it(`${name}: every printing carries the printed sentence verbatim, and none prints an Active-Spot clause`, () => {
      for (const id of ids) {
        expect(POOL[id]?.abilities?.[0]?.name).toBe(name);
        expect(POOL[id]?.abilities?.[0]?.effect).toBe(text);
      }
      expect(text.startsWith("Once during your turn, you may ")).toBe(true);
      expect(text).not.toContain("Active Spot");
    });

    it(`${name}: the program is pinned by toEqual — ONE ability, once per turn, usable from the Bench, no \`attack\` key`, () => {
      const first = programFor(ids[0] as string);
      expect(first).toEqual({
        abilities: [{ name, oncePerTurn: true, activeOnly: false, program }],
      });
      // The card's attack still reaches the deriver: the row authors NO attack key.
      expect(Object.keys(first ?? {})).toEqual(["abilities"]);
      for (const id of ids) expect(programFor(id)).toBe(first); // identity: reprints share ONE object
    });
  }

  it("the four texts are four DISTINCT objects (D199's near-twin rule)", () => {
    const objects = new Set([RAPIDASH, CHANDELURE, BLISSEY, SWADLOON].map((id) => programFor(id)));
    expect(objects.size).toBe(4);
  });

  it("Happy Switch is Energy Switch's body on its OWN object — equal program, different surface", () => {
    const item = programFor("sv01-173");
    expect(programFor(BLISSEY)?.abilities?.[0]?.program).toEqual(item?.trainer);
    expect(programFor(BLISSEY)).not.toBe(item);
    expect(programFor(BLISSEY)?.trainer).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D553 A §2 — once per turn, per BODY, and usable from the Bench", () => {
  it("a second use of the same body in the same turn is refused ABILITY_ALREADY_USED", () => {
    const once = mustApply(benched("p1", [RAPIDASH]), use("p1", "Hurried Gait")).state;
    expectErr(once, use("p1", "Hurried Gait"), "ABILITY_ALREADY_USED");
  });

  it("the lock is PER BODY: two Rapidash (both printings) each draw once", () => {
    let state = benched("p1", [RAPIDASH, RAPIDASH_2]);
    const hand = state.players.p1.hand.length;
    state = mustApply(state, use("p1", "Hurried Gait", 0)).state;
    state = mustApply(state, use("p1", "Hurried Gait", 1)).state;
    expect(state.players.p1.hand.length).toBe(hand + 2);
    expectErr(state, use("p1", "Hurried Gait", 0), "ABILITY_ALREADY_USED");
    expectErr(state, use("p1", "Hurried Gait", 1), "ABILITY_ALREADY_USED");
  });

  it("the lock is per TURN: the same body is usable again on its owner's next turn", () => {
    let state = mustApply(benched("p1", [RAPIDASH]), use("p1", "Hurried Gait")).state;
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const hand = state.players.p1.hand.length;
    state = mustApply(state, use("p1", "Hurried Gait")).state;
    expect(state.players.p1.hand.length).toBe(hand + 1);
  });

  it("every one of the four is usable from the BENCH (no `activeOnly`) and from the Active", () => {
    // Bench: each body at bench 0 behind a filler, with a board each program can act on.
    let hg = benched("p1", [RAPIDASH]);
    expect(mustApply(hg, use("p1", "Hurried Gait")).state.phase.kind).toBe("turn:action");
    hg = active("p1", RAPIDASH);
    expect(mustApply(hg, use("p1", "Hurried Gait", "active")).state.phase.kind).toBe("turn:action");
    expect(mustApply(benched("p1", [CHANDELURE]), use("p1", "Alluring Light")).state.phase.kind).toBe(
      "turn:action",
    );
    const hs = attachFromDeck(benched("p1", [BLISSEY]), "p1", ENERGY, 1);
    expect(mustApply(hs, use("p1", "Happy Switch")).state.phase.kind).toBe("effect:choose");
    const hl = setDamage(benched("p1", [SWADLOON]), "p1", 30);
    expect(mustApply(hl, use("p1", "Healing Leaves")).state.players.p1.active?.damage).toBe(10);
  });

  it("the opponent cannot use it on your turn (the turn gate), and a wrong ability name is refused", () => {
    const state = benched("p1", [RAPIDASH]);
    const p2 = applyAction(state, use("p2", "Hurried Gait"));
    expect(p2.ok).toBe(false);
    expectErr(state, use("p1", "Alluring Light"), "NO_SUCH_ABILITY");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D553 A §3 — Hurried Gait: draw a card", () => {
  it("draws exactly the deck's top card, filed as ONE CARDS_DRAWN for the controller", () => {
    const before = benched("p1", [RAPIDASH]);
    const top = before.players.p1.deck[0];
    const { state: after, events } = mustApply(before, use("p1", "Hurried Gait"));
    expect(after.players.p1.hand).toContain(top);
    expect(after.players.p1.hand.length).toBe(before.players.p1.hand.length + 1);
    expect(after.players.p1.deck.length).toBe(before.players.p1.deck.length - 1);
    const drawn = all(events, "CARDS_DRAWN");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.seat).toBe("p1");
    expect(drawn[0]?.uids).toEqual([top]);
    expect(types(events)[0]).toBe("ABILITY_USED");
    // The opponent's hand is untouched — the key that separates this row from Alluring Light.
    expect(after.players.p2.hand).toEqual(before.players.p2.hand);
  });

  it("🛑 UNRULED (D553 R1): on an EMPTY deck it is still USABLE and draws nothing, silently", () => {
    // Shipped doctrine, not a choice this slice makes: `programPlayable` treats a draw
    // as always "playable enough" (cardplay.ts), and §14.3's deck-out is a turn-START
    // rule. Reverses on an official ruling that an Ability which would do nothing
    // cannot be used.
    const before = trimDeckTo(benched("p1", [RAPIDASH]), "p1", 0);
    expect(before.players.p1.deck).toEqual([]);
    const { state: after, events } = mustApply(before, use("p1", "Hurried Gait"));
    expect(types(events)).toEqual(["ABILITY_USED"]);
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
    // …and the use is SPENT: the whiff is a use, not a refusal.
    expectErr(after, use("p1", "Hurried Gait"), "ABILITY_ALREADY_USED");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D553 A §4 — Alluring Light: each player draws a card, controller first", () => {
  it("files ONE CARDS_DRAWN per seat, controller (p1) first, each the seat's own top card", () => {
    const before = benched("p1", [CHANDELURE]);
    const top1 = before.players.p1.deck[0];
    const top2 = before.players.p2.deck[0];
    const { state: after, events } = mustApply(before, use("p1", "Alluring Light"));
    const drawn = all(events, "CARDS_DRAWN");
    expect(drawn.map((e) => e.seat)).toEqual(["p1", "p2"]);
    expect(drawn.map((e) => e.uids)).toEqual([[top1], [top2]]);
    expect(after.players.p1.hand.length).toBe(before.players.p1.hand.length + 1);
    expect(after.players.p2.hand.length).toBe(before.players.p2.hand.length + 1);
    // MANDATORY for the opponent — "you may have" is the ABILITY's optionality, not
    // `opponentMayDraw`: nothing parks and nobody else is asked.
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("🛑 UNRULED (D553 R2): controller-first is the CONTROLLER, not the absolute seat — from p2's chair, p2 draws first", () => {
    const before = benched("p2", [CHANDELURE]);
    const { events } = mustApply(before, use("p2", "Alluring Light"));
    expect(all(events, "CARDS_DRAWN").map((e) => e.seat)).toEqual(["p2", "p1"]);
  });

  it("an empty OPPONENT deck short-draws that seat alone — one row, the controller's", () => {
    const before = trimDeckTo(benched("p1", [CHANDELURE]), "p2", 0);
    const { state: after, events } = mustApply(before, use("p1", "Alluring Light"));
    expect(all(events, "CARDS_DRAWN").map((e) => e.seat)).toEqual(["p1"]);
    expect(after.players.p2.hand).toEqual(before.players.p2.hand);
    expect(after.players.p1.hand.length).toBe(before.players.p1.hand.length + 1);
    // §14.3 is a turn-START rule: nothing ends here.
    expect(after.phase.kind).toBe("turn:action");
  });

  it("an empty CONTROLLER deck short-draws the controller alone — the opponent still draws", () => {
    const before = trimDeckTo(benched("p1", [CHANDELURE]), "p1", 0);
    const { state: after, events } = mustApply(before, use("p1", "Alluring Light"));
    expect(all(events, "CARDS_DRAWN").map((e) => e.seat)).toEqual(["p2"]);
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(after.players.p2.hand.length).toBe(before.players.p2.hand.length + 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const P1_BENCH0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };

describe("D553 A §5 — Happy Switch: move a Basic Energy, own → own", () => {
  it("parks on the compound moveEnergy prompt, then moves the Basic Energy Active → Bench", () => {
    const before = attachFromDeck(benched("p1", [BLISSEY]), "p1", ENERGY, 1);
    const energy = before.players.p1.active?.energy[0] as string;
    const parked = mustApply(before, use("p1", "Happy Switch")).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "moveEnergy") throw new Error("expected a moveEnergy prompt");
    expect(prompt.max).toBe(1);
    expect(prompt.note).toBe("Move a Basic Energy from 1 of your Pokémon to another of your Pokémon.");
    expect(prompt.movable.map((m) => m.uid)).toEqual([energy]);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: energy, dest: P1_BENCH0 }] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.active?.energy).not.toContain(energy);
    expect(done.players.p1.bench[0]?.energy).toContain(energy);
    expect(all(events, "ENERGY_MOVED")[0]).toMatchObject({ seat: "p1", uids: [energy] });
  });

  it("moves OFF the Blissey itself too — the user is an ordinary source", () => {
    const before = attachBenchFromDeck(benched("p1", [BLISSEY]), "p1", 0, ENERGY, 1);
    const energy = before.players.p1.bench[0]?.energy[0] as string;
    const parked = mustApply(before, use("p1", "Happy Switch")).state;
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: energy, dest: P1_ACTIVE }] },
    }).state;
    expect(done.players.p1.active?.energy).toContain(energy);
  });

  it("🛑 MEASURED AND PINNED, NOT CHANGED: a DECLINE is legal, moves nothing — and SPENDS the once-per-turn", () => {
    // `useAbility` writes the lock BEFORE the program runs (cardplay.ts), so the park
    // is already a use. This pins the shipped behaviour; it is not a ruling.
    const before = attachFromDeck(benched("p1", [BLISSEY]), "p1", ENERGY, 1);
    const energy = before.players.p1.active?.energy[0] as string;
    const parked = mustApply(before, use("p1", "Happy Switch")).state;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(types(events)).not.toContain("ENERGY_MOVED");
    expect(done.players.p1.active?.energy).toContain(energy);
    expectErr(done, use("p1", "Happy Switch"), "ABILITY_ALREADY_USED");
  });

  it("refused NO_LEGAL_TARGET with only ONE Pokémon in play (no distinct destination)", () => {
    const state = attachFromDeck(active("p1", BLISSEY, 0), "p1", ENERGY, 1);
    expect(state.players.p1.bench).toHaveLength(0);
    expectErr(state, use("p1", "Happy Switch", "active"), "NO_LEGAL_TARGET");
  });

  it("refused NO_LEGAL_TARGET with no Basic Energy in play — none at all, or only a Special", () => {
    const bare = benched("p1", [BLISSEY]);
    expectErr(bare, use("p1", "Happy Switch"), "NO_LEGAL_TARGET");
    const specialOnly = attachFromDeck(bare, "p1", SPECIAL, 1);
    expectErr(specialOnly, use("p1", "Happy Switch"), "NO_LEGAL_TARGET");
    // …and a refused use is NOT a use: once a Basic arrives, it works.
    const fed = attachFromDeck(specialOnly, "p1", ENERGY, 1);
    expect(mustApply(fed, use("p1", "Happy Switch")).state.phase.kind).toBe("effect:choose");
  });

  it("a Special Energy is never offered, and naming it is refused BAD_EFFECT_CHOICE", () => {
    let before = attachFromDeck(benched("p1", [BLISSEY]), "p1", ENERGY, 1);
    before = attachFromDeck(before, "p1", SPECIAL, 1);
    const [basic, special] = before.players.p1.active?.energy ?? [];
    const parked = mustApply(before, use("p1", "Happy Switch")).state;
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy park");
    }
    expect(parked.phase.prompt.movable.map((m) => m.uid)).toEqual([basic]);
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: special as string, dest: P1_BENCH0 }] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("max 1: moving two Basic Energy in one answer is refused", () => {
    const before = attachFromDeck(benched("p1", [BLISSEY]), "p1", ENERGY, 2);
    const [e1, e2] = before.players.p1.active?.energy ?? [];
    const parked = mustApply(before, use("p1", "Happy Switch")).state;
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: e1 as string, dest: P1_BENCH0 },
            { uid: e2 as string, dest: P1_BENCH0 },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D553 A §6 — Healing Leaves: heal 20 from YOUR ACTIVE Pokémon", () => {
  it("used from the Bench, it heals the ACTIVE — and NOT the damaged Benched Swadloon", () => {
    let before = benched("p1", [SWADLOON]);
    before = setDamage(before, "p1", 50);
    before = setBenchDamage(before, "p1", 0, 30);
    const activeUid = before.players.p1.active?.stack[0];
    const { state: after, events } = mustApply(before, use("p1", "Healing Leaves"));
    expect(after.players.p1.active?.damage).toBe(30);
    expect(after.players.p1.bench[0]?.damage).toBe(30);
    const healed = all(events, "HEALED");
    expect(healed).toHaveLength(1);
    expect(healed[0]).toEqual({ type: "HEALED", seat: "p1", uid: activeUid, amount: 20 });
  });

  it("used from the Active, the Swadloon IS the Active and heals itself", () => {
    const before = setDamage(active("p1", SWADLOON, 1), "p1", 40);
    const after = mustApply(before, use("p1", "Healing Leaves", "active")).state;
    expect(after.players.p1.active?.damage).toBe(20);
  });

  it("CLAMPS to the damage present: 20 on 10 damage heals 10, and files amount 10", () => {
    const before = setDamage(benched("p1", [SWADLOON]), "p1", 10);
    const { state: after, events } = mustApply(before, use("p1", "Healing Leaves"));
    expect(after.players.p1.active?.damage).toBe(0);
    expect(all(events, "HEALED").map((e) => e.amount)).toEqual([10]);
  });

  it("🛑 UNRULED (D553 R1): on an UNDAMAGED Active it is USABLE, files no HEALED row, and is spent", () => {
    // A design call recorded as UNRULED, not a fact: `programPlayable` treats heal as
    // always "playable enough". Reversal condition: an official ruling that an Ability
    // which would do nothing cannot be used.
    const before = setBenchDamage(benched("p1", [SWADLOON]), "p1", 0, 30);
    expect(before.players.p1.active?.damage).toBe(0);
    const { state: after, events } = mustApply(before, use("p1", "Healing Leaves"));
    expect(types(events)).toEqual(["ABILITY_USED"]);
    expect(after.players.p1.bench[0]?.damage).toBe(30); // still not the Bench
    expectErr(after, use("p1", "Healing Leaves"), "ABILITY_ALREADY_USED");
  });

  it("heals only the CONTROLLER's Active — the opponent's damaged Active is untouched", () => {
    let before = benched("p1", [SWADLOON]);
    before = setDamage(before, "p2", 60);
    before = setDamage(before, "p1", 20);
    const after = mustApply(before, use("p1", "Healing Leaves")).state;
    expect(after.players.p2.active?.damage).toBe(60);
    expect(after.players.p1.active?.damage).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D553 A §7 — the reprints drive end to end, and the use is announced", () => {
  it("Rapidash sv10-189 draws exactly as sv10-030 does", () => {
    const before = benched("p1", [RAPIDASH_2]);
    const after = mustApply(before, use("p1", "Hurried Gait")).state;
    expect(after.players.p1.hand.length).toBe(before.players.p1.hand.length + 1);
  });

  it("Blissey ex sv06-201 parks on the same prompt sv06-134 does", () => {
    const before = attachFromDeck(benched("p1", [BLISSEY_2]), "p1", ENERGY, 1);
    const parked = mustApply(before, use("p1", "Happy Switch")).state;
    expect(parked.phase.kind === "effect:choose" && parked.phase.prompt.kind).toBe("moveEnergy");
  });

  it("Swadloon sv10.5w-088 heals the Active exactly as sv10.5w-002 does", () => {
    const before = setDamage(benched("p1", [SWADLOON_2]), "p1", 40);
    expect(mustApply(before, use("p1", "Healing Leaves")).state.players.p1.active?.damage).toBe(20);
  });

  it("every use opens with ONE ABILITY_USED naming the using body and the printed name", () => {
    const cases: readonly [GameState, string][] = [
      [benched("p1", [RAPIDASH]), "Hurried Gait"],
      [benched("p1", [CHANDELURE]), "Alluring Light"],
      [attachFromDeck(benched("p1", [BLISSEY]), "p1", ENERGY, 1), "Happy Switch"],
      [setDamage(benched("p1", [SWADLOON]), "p1", 20), "Healing Leaves"],
    ];
    for (const [before, name] of cases) {
      const { events } = mustApply(before, use("p1", name));
      expect(events[0]).toEqual({
        type: "ABILITY_USED",
        seat: "p1",
        uid: before.players.p1.bench[0]?.stack[0],
        ability: name,
      });
      expect(all(events, "ABILITY_USED")).toHaveLength(1);
    }
  });

  it("a REFUSED second use changes nothing — Alluring Light twice draws each seat ONE card", () => {
    const before = benched("p1", [CHANDELURE]);
    const once = mustApply(before, use("p1", "Alluring Light")).state;
    const again = applyAction(once, use("p1", "Alluring Light"));
    expect(again.ok).toBe(false);
    expect(once.players.p1.hand.length).toBe(before.players.p1.hand.length + 1);
    expect(once.players.p2.hand.length).toBe(before.players.p2.hand.length + 1);
  });

  it("the locks are per ABILITY BODY, not per seat: Hurried Gait used does not lock Healing Leaves", () => {
    let state = setDamage(benched("p1", [RAPIDASH, SWADLOON]), "p1", 20);
    state = mustApply(state, use("p1", "Hurried Gait", 0)).state;
    state = mustApply(state, use("p1", "Healing Leaves", 1)).state;
    expect(state.players.p1.active?.damage).toBe(0);
  });
});
