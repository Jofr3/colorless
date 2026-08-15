import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import { applyAction, createGame } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import { BENCH_MAX } from "./types";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
} from "./testFixtures";

// ── D350 — *"…YOU PUT **ANY NUMBER OF** BASIC POKÉMON YOU FIND THERE ONTO THEIR
//    BENCH"*: THE THIRD AND LAST PRINTED FORM OF ONE OP'S COUNT. ─────────────
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   Lillie's Ribombee `sv09-067` / `sv09-164` / `svp-183` — "Inviting Wink"
//   (`abilities_json`): "When you play this Pokémon from your hand to evolve 1 of
//   your Pokémon during your turn, you may have your opponent reveal their hand
//   and you put any number of Basic Pokémon you find there onto their Bench."
//   **3 legal printings on ONE byte-identical sentence** — the whole population,
//   remote D1 `luminous` 2026-08-15, `json_each(abilities_json)` keyed on
//   `$.effect` (NOT `$.text` — the false-zero key) and grouped so the unit is a
//   SENTENCE.
//
// ── HOW THE ROW WAS FOUND, AND WHAT IT REFUSED ──────────────────────────────
//   Largest live `ROWS` residue at this head is **row 9 (7 ids)**, re-derived by
//   parsing the table rather than by reading D349's note. Its four blockers are
//   D349's, re-checked: the by-NAME attach (Lycanroc ×2), the uncatalogued
//   Ancient/Future/Tera banner (Reboot Pod ×1, Glass Trumpet ×2) and an
//   end-of-turn Tool trigger point for 2 printings (Powerglass). The Lycanroc
//   clause rests on `onEvolve` — **58 printings / 29 legal / 13 legal sentences**,
//   re-measured to the digit — and SEVEN of those thirteen are built, leaving six.
//
//   🛑 **D349 NAMED THE HEAL-THEN-DISCARD FAMILY AS THE LARGEST COHERENT BLOCK
//   AND LEFT IT EXPLICITLY UNPRICED. THIS SLICE PRICED IT AND REFUSED IT.** The
//   census is D349's exactly — Dachsbun ex ×3 + Whimsicott ×2 + Super Potion ×1 =
//   6 legal printings / 3 sentences / 2 columns, and the whole-catalog
//   `Heal…discard…Energy` query returns nothing else legal. What it costs, read
//   off the source rather than off the prose:
//     • `discardEnergy.from` has three own-board members — a SPOT (`yourActive`),
//       a SIDE (`yours`, which parks over the whole board) and a BODY BY UID
//       (`self` = `ctx.sourceUid`, the host). **None of them is "the body this
//       program just healed."** `yours` would let the controller strip a DIFFERENT
//       Pokémon, which is D236's own recorded argument one op over, verbatim.
//     • `recordGate` IS the engine's spelling of the printed *"in this way"*, but
//       `recordSlotOf`/`recordAs` has no heal producer, so `EffectRecord` has
//       nothing to gate on — and no `discardEnergy.from` reads a record anyway.
//     • The three sentences' heal HALVES are three separate unbought narrowings:
//       `healChosen { amount: 60 }` exists verbatim (Potion), but *"your Active
//       {G} Pokémon"* and *"each of your Evolution Pokémon"* do not.
//   **≈6 new vocabulary items for 6 printings, or ≈3 for its cheapest single
//   printing.** This row is 3 printings for ONE union member on ONE existing
//   optional field, so the method sent the slice here and not there.
//
// ── THE MECHANISM CLOSES ────────────────────────────────────────────────────
//   `reveal…hand` AND (`onto their Bench` OR `onto your opponent's Bench`), all
//   three text columns, remote D1 2026-08-15: **4 sentences / 10 printings / 7
//   legal.** This ×3 (MINE), Lickitung "Tongue Pull" ×2 (ATTACK, built D297),
//   Mandibuzz "Look for Prey" ×2 (Ability, built D294), Erika's Invitation ×3
//   (`effect`, **0 legal**). With this row the bench arm is **3 of 3 legal
//   sentences / 7 of 7 legal printings**. D294's own block priced that population
//   at "4, not 2"; it is 7, and the three it did not name are this card.
//
// ── THE ENGINE DIFF, AND WHY IT IS NOT ZERO ─────────────────────────────────
//   `upTo?: number` → `upTo?: number | "any"`. **Behaviourally `upTo: BENCH_MAX`
//   would have been sufficient** — the park already clamps to the live
//   `benchSpace` and `BENCH_MAX` is 5, so a numeric cap of 5 can never bind. It is
//   refused on the CAPTION and on falsifiability: this op's note is grown one
//   printed form per card and round-trips to the catalog text, so `upTo: 5` would
//   caption the card with a number it does not print and would be
//   indistinguishable from a future card that DOES print *"up to 5"*. §5 drives
//   that difference as a STRING rather than arguing it.
//   ZERO new ops, prompt kinds, choice kinds, events, error codes, `GameState`
//   fields, `CardFilter` members, regexes, deriver arms, `programPlayable` arms,
//   `EffectSlot` members and wire-schema bytes.
//
// ── THE POOL ────────────────────────────────────────────────────────────────
//   All three real ids are driven on a LOCAL `cardPool` (D275's idiom). **A
//   FIXTURE IS A CENSUS POPULATION** (D348), and neither `sv09` nor `svp` is among
//   `catalogManifest`'s six sets anyway. §7 asserts the abstinence by id.

const RIBOMBEE = "sv09-067";
const RIBOMBEE_IDS = ["sv09-067", "sv09-164", "svp-183"] as const;
const RIBOMBEE_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may have your opponent reveal their hand and you put any number of Basic Pokémon you find there onto their Bench.";

/** The printed caption the park must carry — the card's own words, restated as
    the standalone sentence a dialog has to be. Written out rather than built, so
    a note that drifts fails on the STRING and not on a template. */
const WINK_NOTE =
  "Your opponent reveals their hand, and you put any number of Basic Pokémon you find there onto their Bench.";

const CUTIEFLY = "fix-d350-cutiefly";
/** Two DIFFERENT printed Basics, because `cardIdentity` keys a Pokémon on its
    catalog id: two different ids never collapse in the offer, so they can only
    witness the FILTER, never the cap. §5 needs the same-copies board for that. */
const BASIC_A = "fix-d350-basic-a";
const BASIC_B = "fix-d350-basic-b";
/** A Stage 1 and an Energy in the same hand — the two things the printed noun
    "Basic Pokémon" excludes, one by STAGE and one by CATEGORY. */
const STAGE1 = "fix-d350-stage1";
const ENERGY = "fix-energy";
/** Mandibuzz's id — the unmarked spelling of the same op, read live in §6. */
const MANDIBUZZ = "sv10.5w-064";
const TONGUE_PULL_TEXT =
  "Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your opponent's Bench.";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    RIBOMBEE_IDS.map((id) => [
      id,
      battler(id, {
        name: "Lillie's Ribombee",
        stage: "Stage1",
        evolveFrom: "Lillie's Cutiefly",
        hp: 90,
        retreat: 1,
        types: ["Psychic"],
        abilities: [{ type: "Ability", name: "Inviting Wink", effect: RIBOMBEE_TEXT }],
      }),
    ]),
  ),
  [CUTIEFLY]: battler(CUTIEFLY, { name: "Lillie's Cutiefly", hp: 40, types: ["Psychic"] }),
  [BASIC_A]: battler(BASIC_A, { name: "D350 Basic A", hp: 70 }),
  [BASIC_B]: battler(BASIC_B, { name: "D350 Basic B", hp: 80 }),
  [STAGE1]: battler(STAGE1, {
    name: "D350 Stage 1",
    stage: "Stage1",
    evolveFrom: "D350 Basic A",
    hp: 100,
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [RIBOMBEE]: 4,
  [RIBOMBEE_IDS[1]]: 2,
  [RIBOMBEE_IDS[2]]: 2,
  [CUTIEFLY]: 8,
  [BASIC_A]: 14,
  [BASIC_B]: 10,
  [STAGE1]: 10,
  [ENERGY]: 10,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** Setup driven against a LOCAL `cardPool` (D275's idiom). Nothing is added to
    `FIXTURE_POOL`; §7 asserts that by id rather than describing it. */
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

/** TEST SURGERY — put every card in `seat`'s hand back under their deck, so the
    hand this file builds is the ONLY hand the op can see. Without it the dealt
    hand carries Basics nobody named and every candidate count is a seed fact. */
function emptyHand(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
  };
}

/** TEST SURGERY — `setActiveFromDeck` written locally, because this file needs the
    OLD Active's whole stack returned to the deck rather than left in play. */
function setActive(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck has no ${cardId}`);
  const returned = side.active === null ? [] : side.active.stack;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: [...side.deck.filter((u) => u !== uid), ...returned],
        active: { stack: [uid], damage: 0, energy: [], tools: [], conditions: [] },
      },
    },
  };
}

/** TEST SURGERY — move one copy of `id` out of p1's deck and into their hand. */
function toHand(state: GameState, id: string): { state: GameState; uid: string } {
  const side = state.players.p1;
  const uid = side.deck.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`p1's deck has no ${id}`);
  return {
    state: {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
      },
    },
    uid,
  };
}

/** The board this file evolves on: p1 Active is a Lillie's Cutiefly, p2 holds
    exactly `oppHand` and exactly `oppBench`. Turn 3 because §4/§10 refuse an
    evolution on a seat's FIRST turn. */
function board(
  spec: { oppHand: readonly [string, number][]; oppBench?: readonly string[] },
  seed = 4,
): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  state = setActive(state, "p1", CUTIEFLY);
  state = clearBench(state, "p1");
  state = setActive(state, "p2", BASIC_A);
  state = clearBench(state, "p2");
  for (const id of spec.oppBench ?? []) state = benchFromDeck(state, "p2", id);
  state = emptyHand(state, "p2");
  for (const [id, count] of spec.oppHand) state = handFromDeck(state, "p2", id, count);
  return state;
}

/** Evolve p1's Active Cutiefly into Lillie's Ribombee and return what that made. */
function evolveIntoRibombee(state: GameState, id: string = RIBOMBEE): ReturnType<typeof apply> {
  const withCard = toHand(state, id);
  return apply(withCard.state, {
    type: "evolve",
    seat: "p1",
    uid: withCard.uid,
    target: { spot: "active" },
  });
}

function cardsPrompt(state: GameState): {
  candidates: readonly string[];
  min: number;
  max: number;
  dest?: string;
  note: string;
} {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
  return prompt;
}

function offeredIds(state: GameState): string[] {
  return cardsPrompt(state)
    .candidates.map((uid) => state.cardIdByUid[uid] ?? "")
    .sort();
}

function benchIds(state: GameState, seat: Seat): string[] {
  return state.players[seat].bench.map((b) => state.cardIdByUid[b.stack.at(-1) ?? ""] ?? "");
}

/** The op the registry row carries, read LIVE rather than transcribed. */
function winkOp(): Extract<EffectOp, { op: "bottomFromOpponentHand" }> {
  const program = programFor(RIBOMBEE);
  const op = program?.triggered?.[0]?.program?.[0];
  if (op === undefined || op.op !== "bottomFromOpponentHand") {
    throw new Error("Inviting Wink is not one bottomFromOpponentHand");
  }
  return op;
}

describe("D350 §1 — the registry row, read off the LIVE registry", () => {
  it("the THREE printings resolve to ONE program object, by identity", () => {
    const first = programFor(RIBOMBEE);
    expect(first).toBeDefined();
    // Identity and not deep equality: three separate-but-equal objects would pass
    // a `toEqual` and would be THREE rows in `censusAtHead`'s object
    // decomposition, which this slice asserts steps by exactly ONE.
    for (const id of RIBOMBEE_IDS) expect(programFor(id), id).toBe(first);
  });

  it("it is an `onEvolve` TRIGGER carrying ONE op, and NO attack/abilities key", () => {
    const program = programFor(RIBOMBEE);
    // ⚠️ THE KEY SET, not a field-by-field read. `BUILT.attack` and the registry
    // summand of it stand still on this row, and the only thing that can make that
    // false is an `attack` key appearing here — which a `toMatchObject` cannot see.
    expect(Object.keys(program ?? {}).sort()).toEqual(["triggered"]);
    const triggered = program?.triggered?.[0];
    expect(triggered?.name).toBe("Inviting Wink");
    expect(triggered?.trigger).toBe("onEvolve");
    // The printed "you MAY" lives on the trigger's own decline (GREEDY_ORDER's
    // reading), not on an `optional` OP — a wrapper would be a second question.
    expect(triggered?.optional).toBe(true);
    expect(triggered?.program).toHaveLength(1);
  });

  it("the op is Mandibuzz's, with `upTo: \"any\"` and NO `maxHp` rider", () => {
    const op = winkOp();
    expect(op.dest).toBe("bench");
    expect(op.upTo).toBe("any");
    expect(op.filter).toEqual({ kind: "basicPokemon" });
    // D135 — an ABSENT field means what the sentence means. Mandibuzz's 70 is that
    // card's word; this sentence does not carry it, and `not.toHaveProperty` is the
    // only spelling that tells `maxHp: undefined` apart from no key at all.
    expect(op.filter).not.toHaveProperty("maxHp");
    expect(op).not.toHaveProperty("recordAs");
    expect(Object.keys(op).sort()).toEqual(["dest", "filter", "op", "upTo"]);
  });
});

describe("D350 §2 — the trigger benches ANY NUMBER of the opponent's own Basics", () => {
  it("offers exactly the Basics, parks 0..3, and the CAPTION is the card's words", () => {
    // The hand carries three Basics (two of one printing, one of another), a
    // Stage 1 and an Energy: the filter has to drop the last two by STAGE and by
    // CATEGORY, and the offer has to keep BOTH copies of the repeated printing.
    const start = board({
      oppHand: [
        [BASIC_A, 2],
        [BASIC_B, 1],
        [STAGE1, 1],
        [ENERGY, 1],
      ],
    });
    const { state: parked, events } = evolveIntoRibombee(start);
    // The reveal rides the action that PARKED, once, before anything is asked.
    expect(events.filter((e) => e.type === "HAND_REVEALED")).toHaveLength(1);
    const prompt = cardsPrompt(parked);
    expect(offeredIds(parked)).toEqual([BASIC_A, BASIC_A, BASIC_B]);
    // 🛑 `min: 0` IS THE PRINTED "any number" — none is a legal answer — and `max`
    // is the OFFER's own size, because a sentence with no number has no other
    // ceiling. Under `upTo: 2` this board would read [0, 2].
    expect([prompt.min, prompt.max]).toEqual([0, 3]);
    expect(prompt.dest).toBe("bench");
    expect(prompt.note).toBe(WINK_NOTE);
  });

  it("puts every chosen Basic onto the OPPONENT's Bench, with `actor` = the chooser", () => {
    const start = board({
      oppHand: [
        [BASIC_A, 2],
        [BASIC_B, 1],
      ],
    });
    const { state: parked } = evolveIntoRibombee(start);
    const picked = [...cardsPrompt(parked).candidates];
    const { state: done, events } = apply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: picked },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(benchIds(done, "p2").sort()).toEqual([BASIC_A, BASIC_A, BASIC_B]);
    expect(benchIds(done, "p1")).toEqual([]);
    expect(done.players.p2.hand).toEqual([]);
    const benched = events.filter((e) => e.type === "POKEMON_BENCHED");
    expect(benched).toHaveLength(3);
    // The zone that changed is p2's and the hand that chose is p1's — the
    // ENERGY_DISCARDED convention, and the one distinction a player could not
    // recover afterwards from anything else.
    for (const row of benched) {
      expect(row.type === "POKEMON_BENCHED" ? row.seat : null).toBe("p2");
      expect(row.type === "POKEMON_BENCHED" ? row.actor : null).toBe("p1");
    }
    // The evolution itself landed either way.
    expect(done.players.p1.active?.stack.at(-1)).toBeDefined();
    expect(done.cardIdByUid[done.players.p1.active?.stack.at(-1) ?? ""]).toBe(RIBOMBEE);
  });

  it("🛑 taking NONE is a legal answer, and it is what \"any number\" buys", () => {
    // The decline is the half of this field a `max`-only spelling would lose, and
    // it is the half a natural "the effect works" suite never writes (D279).
    const start = board({ oppHand: [[BASIC_A, 2]] });
    const { state: parked } = evolveIntoRibombee(start);
    const before = [...parked.players.p2.hand];
    const { state: done, events } = apply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p2.bench).toEqual([]);
    expect(done.players.p2.hand).toEqual(before);
    expect(events.map((e) => e.type)).not.toContain("POKEMON_BENCHED");
  });

  it("a LONE candidate is still ASKED — the auto-resolve stays off under a decline", () => {
    // The M1 no-choice rule retires a prompt whose ANSWERS ARE THE SAME STATE;
    // here they are "a body lands on their Bench" and "nothing moves". A build that
    // took the shortcut would hand the opponent a Prize-worth body with nobody
    // asked, which is the printed decline having no way to mean "none".
    const start = board({
      oppHand: [
        [BASIC_A, 1],
        [ENERGY, 3],
      ],
    });
    const { state: parked } = evolveIntoRibombee(start);
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toHaveLength(1);
    expect([prompt.min, prompt.max]).toEqual([0, 1]);
  });
});

describe("D350 §3 — the whiffs: the trigger never strands the turn", () => {
  it("an opponent hand with NO Basic reveals honestly and asks nothing", () => {
    const start = board({
      oppHand: [
        [STAGE1, 2],
        [ENERGY, 3],
      ],
    });
    const { state: done, events } = evolveIntoRibombee(start);
    expect(done.phase.kind).toBe("turn:action");
    const revealed = events.find((e) => e.type === "HAND_REVEALED");
    expect(revealed?.type === "HAND_REVEALED" ? revealed.uids : []).toHaveLength(5);
    expect(events.map((e) => e.type)).not.toContain("POKEMON_BENCHED");
    expect(done.players.p2.bench).toEqual([]);
  });

  it("an EMPTY opponent hand reveals as zero uids and the evolution still lands", () => {
    const start = board({ oppHand: [] });
    const { state: done, events } = evolveIntoRibombee(start);
    expect(done.phase.kind).toBe("turn:action");
    const revealed = events.find((e) => e.type === "HAND_REVEALED");
    expect(revealed?.type === "HAND_REVEALED" ? revealed.uids : ["x"]).toEqual([]);
    expect(done.cardIdByUid[done.players.p1.active?.stack.at(-1) ?? ""]).toBe(RIBOMBEE);
  });

  it("a FULL opponent Bench offers nothing at all — the guard is the OFFER's", () => {
    // `bottomFromOpponentHandOffer` returns EMPTY on a full opponent Bench, so
    // there is no park and no question. `programPlayable` carries the same fact for
    // the ACTIVATED surface — and costs this row ZERO, structurally, because a
    // board trigger never passes through that gate at all.
    const start = board({
      oppHand: [[BASIC_A, 3]],
      oppBench: [BASIC_B, BASIC_B, BASIC_B, BASIC_B, BASIC_B],
    });
    expect(start.players.p2.bench).toHaveLength(BENCH_MAX);
    const { state: done, events } = evolveIntoRibombee(start);
    expect(done.phase.kind).toBe("turn:action");
    expect(events.map((e) => e.type)).not.toContain("POKEMON_BENCHED");
    expect(done.players.p2.hand).toHaveLength(3);
  });
});

describe("D350 §4 — the ceiling is the BOARD, not the card", () => {
  it("clamps `max` to the live `benchSpace` when the hand holds more", () => {
    // Four Basics in hand, TWO free Bench slots: the park must ask for two. A
    // build that asked for four would take a card out of a hand with nowhere to
    // land, arriving as a question rather than as a lost card.
    const start = board({
      oppHand: [
        [BASIC_A, 2],
        [BASIC_B, 2],
      ],
      oppBench: [BASIC_B, BASIC_B, BASIC_B],
    });
    const { state: parked } = evolveIntoRibombee(start);
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toHaveLength(4);
    expect([prompt.min, prompt.max]).toEqual([0, BENCH_MAX - 3]);
  });

  it("🛑 and `BENCH_MAX` is why `upTo: 5` would have been behaviourally equal", () => {
    // The refutation, DRIVEN: with the whole Bench free the ceiling is the offer,
    // and the offer can never exceed what a hand of five Basics could land anyway.
    // The member is bought for the CAPTION (§5), and this is the assertion that
    // says so honestly rather than letting a reader assume it bought behaviour.
    const start = board({ oppHand: [[BASIC_A, 5]] });
    const prompt = cardsPrompt(evolveIntoRibombee(start).state);
    expect(prompt.max).toBe(BENCH_MAX);
    expect(prompt.max).toBe(Math.min(5, BENCH_MAX));
  });
});

describe("D350 §5 — the offer keeps EVERY copy, and the note is the card's", () => {
  it("FIVE copies of ONE printed Basic are five candidates, not one", () => {
    // `cardIdentity` keys a Pokémon on its catalog id, so identical copies COLLAPSE
    // in the offer to `cap` representatives. Under the pre-D350 `cap = op.upTo ?? 1`
    // an `"any"` op would have kept ONE, and four of the five copies could never
    // reach the Bench — the printed "any number" silently meaning "one".
    const start = board({ oppHand: [[BASIC_A, 5]] });
    const { state: parked } = evolveIntoRibombee(start);
    expect(offeredIds(parked)).toEqual([BASIC_A, BASIC_A, BASIC_A, BASIC_A, BASIC_A]);
    const { state: done } = apply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...cardsPrompt(parked).candidates] },
    });
    expect(benchIds(done, "p2")).toHaveLength(BENCH_MAX);
    expect(done.players.p2.hand).toEqual([]);
  });

  it("the caption is a THIRD sentence, not a rewording of the other two", () => {
    // 🛑 THE REFUTATION'S OTHER HALF. `upTo: BENCH_MAX` would caption this card
    // "Put up to 5 Basic Pokémon …" — a number it does not print — and would be
    // indistinguishable from a future card that DOES print "up to 5". The strings
    // are compared here so the difference the member buys is a MEASUREMENT.
    const wouldHaveRead =
      "Your opponent reveals their hand. Put up to 5 Basic Pokémon you find there onto your opponent's Bench.";
    expect(WINK_NOTE).not.toBe(wouldHaveRead);
    expect(WINK_NOTE).not.toContain("up to");
    expect(WINK_NOTE).toContain("any number of");
    // …and it round-trips into the card's own sentence: everything after the
    // printed "you may have your opponent reveal their hand and" is verbatim.
    expect(RIBOMBEE_TEXT).toContain(
      "you put any number of Basic Pokémon you find there onto their Bench.",
    );
    const start = board({ oppHand: [[BASIC_A, 1]] });
    expect(cardsPrompt(evolveIntoRibombee(start).state).note).toBe(WINK_NOTE);
  });
});

describe("D350 §6 — three printed forms of ONE field, and the other two are unmoved", () => {
  it("Mandibuzz keeps `upTo` ABSENT — not `undefined`, absent", () => {
    const program = programFor(MANDIBUZZ);
    const op = program?.abilities?.[0]?.program?.[0];
    if (op === undefined || op.op !== "bottomFromOpponentHand") {
      throw new Error("Look for Prey is not one bottomFromOpponentHand");
    }
    expect(op).not.toHaveProperty("upTo");
    // …and its filter DOES carry the rider this card's does not, which is what
    // makes the pair a measurement of D135 rather than a restatement of it.
    expect(op.filter).toEqual({ kind: "basicPokemon", maxHp: 70 });
  });

  it("Lickitung's deriver arm still emits a NUMBER", () => {
    expect(deriveAttackEffect(TONGUE_PULL_TEXT)).toEqual([
      { op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench", upTo: 2 },
    ]);
  });

  it("the deriver does NOT reach this card's sentence — it is an ABILITY", () => {
    // The row is hand-authored on purpose: `deriveAttackEffect` reads the attack
    // column, this sentence is printed in `abilities_json`, and the three-column
    // census returns ZERO for it on `attacks_json` and ZERO on `effect`.
    expect(deriveAttackEffect(RIBOMBEE_TEXT)).toBeNull();
  });
});

describe("D350 §7 — the pool and the registry, asserted by id", () => {
  it("NOTHING this slice defines reached `FIXTURE_POOL`", () => {
    // ⚠️ **A FIXTURE IS A CENSUS POPULATION** (D348): a body here would move
    // `catalogManifest`'s real-fixture population and `clauseApostrophe`'s
    // derivable sweep, neither of which any grep of this slice's vocabulary
    // reaches. The abstinence is asserted rather than described.
    for (const id of [...RIBOMBEE_IDS, CUTIEFLY, BASIC_A, BASIC_B, STAGE1]) {
      expect(Object.hasOwn(FIXTURE_POOL, id), `${id} leaked into FIXTURE_POOL`).toBe(false);
    }
  });

  it("the THREE ids are CONTIGUOUS and in order — a property of the ROW, permanent", () => {
    // 🛑 `censusAtHead`'s `raw[raw.length - 1]` is keyed on INSERTION ORDER and has
    // gone red on a constant nobody touched EIGHT consecutive times (D338, D340,
    // D342, D345, D346, D347, D349 and this slice). No grep of any census FIGURE
    // NAME reaches it. D349 carried this baton in `remainingHpWindow.test.ts` §6
    // and it is picked up here, in the file that moved the constant.
    // ⚠️ And this claim is SPENT the moment the next registry row lands — which is
    // exactly what it is for. D347's version was written as a PERMANENT assertion
    // and had to be re-pointed at contiguity; this one is written as what it is,
    // and the next slice should re-point it the same way rather than delete it.
    //
    // 🛑 **D351 — SPENT, EXACTLY ON SCHEDULE, AND RE-POINTED RATHER THAN DELETED.**
    // The expiring `raw.slice(-3)` claim now lives in `pyroDance.test.ts` §7, in
    // the file that moved the constant — the fourth hand-off of this baton (D347 →
    // D349 → D350 → D351). What is left here is the CONTIGUITY claim, which is a
    // property of the ROW rather than of the tail and therefore permanent: three
    // ids inserted together stay adjacent and in order however many rows land after
    // them. The two are DIFFERENT assertions and neither substitutes for the other.
    const raw = registryCardIds();
    const at = raw.indexOf(RIBOMBEE_IDS[0] as string);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(raw.slice(at, at + 3)).toEqual([...RIBOMBEE_IDS]);
  });

  it("all THREE real ids are registry keys, and none of the four demonstrators is", () => {
    const keys = new Set(registryCardIds());
    for (const id of RIBOMBEE_IDS) expect(keys.has(id), id).toBe(true);
    // The synthetic bodies are scenery — a registry key for one would be a program
    // no printing resolves to, and would inflate `raw.length` against
    // `nonAttackRegistryIds()`, whose two lines this slice keeps 0 apart.
    for (const id of [CUTIEFLY, BASIC_A, BASIC_B, STAGE1]) expect(keys.has(id), id).toBe(false);
  });
});
