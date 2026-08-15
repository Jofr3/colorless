import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  trainerCard,
} from "./testFixtures";

// ── D349 — *"…THAT HAS {N} HP OR LESS REMAINING"* AS A CANDIDATE NARROWING, ON
//    THE TWO OPS THAT PRINT IT AND THROUGH ONE PREDICATE. ─────────────────────
//
// ── THE TWO PRINTED SENTENCES ───────────────────────────────────────────────
//   • Ledian `svp-133`/`sv07-003`/`sv07-144` — "Glittering Star Pattern"
//     (`abilities_json`): "When you play this Pokémon from your hand to evolve 1
//     of your Pokémon during your turn, you may switch in 1 of your opponent's
//     Benched Pokémon **that has 90 HP or less remaining** to the Active Spot."
//   • Bianca's Devotion `sv05-142`/`sv05-197`/`sv05-209` — Supporter (`effect`):
//     "Heal all damage from 1 of your Pokémon **that has 30 HP or less
//     remaining**."
//   **6 Standard-legal printings on 2 sentences over 2 text columns.**
//
// ── THE CENSUS, RE-DERIVED AT THIS HEAD RATHER THAN QUOTED ──────────────────
// Remote D1 `luminous` (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 2026-08-15, all
// THREE text columns unioned and grouped through `json_each` so the unit is a
// SENTENCE and not a printing (a `COUNT(DISTINCT <json column>)` is always a
// printing count — D347's unit defect, avoided by construction). The ability key
// is `$.effect` and NOT `$.text` — D348 nearly recorded a false zero off the
// wrong key, and a zero from a wrong key is indistinguishable from a real one, so
// the extractor was verified against a known-present row (`sv09-085`'s
// "Spike-Clad") before any zero here was believed.
//
//   `t LIKE '%HP or less remaining%'`
//     ability : Ledian ×3      (3 legal, 1 sentence)   ← BUILT HERE
//     effect  : Bianca's ×3    (3 legal, 1 sentence)   ← BUILT HERE
//     ability : Vanilluxe ×1   (0 legal, 1 sentence)   ← refused, see below
//     attack  : —              (ZERO rows)
//
// **THE WHOLE LEGAL POPULATION OF THE CLAUSE IS THESE SIX PRINTINGS**, and the
// one printing left out is left out for TWO reasons that agree: Vanilluxe
// `sv06-039` (*"Your opponent's Pokémon that have 40 HP or less remaining can't
// attack."*) is not Standard-legal, and it is an always-on AURA rather than a
// candidate narrowing — a different mechanism wearing the same relative clause.
//
// ── 🛑 THE FIGURE IS THE ENGINE'S OWN, AND IT HAD BEEN SITTING THERE SINCE D181
// `index.ts`'s 0.180.0 → 0.181.0 block measured *"HP or less"* over the legal pool
// at **15 printings / 6 sentences, splitting 9 / 4 CARD read and 6 / 2 BOARD
// read"*, built the CARD half (`basicPokemon.maxHp`) and named the BOARD half as
// out of reach: *"Bianca's Devotion and Ledian print 'HP or less **remaining**',
// current HP against a body in play, which `matchesFilter` cannot reach at any
// width because it is never handed an `InPlayPokemon`."* **That is exactly the
// 6 / 2 this slice re-derived independently, 168 decisions later, and it is the
// half D181 could not buy.** The premise is still true — this slice did not widen
// `CardFilter` and could not have — so the predicate lives where the board does.
//
// ── HOW THE ROW WAS FOUND (the five-step method, not a handoff price) ────────
//   1. Largest live `ROWS` residue in `censusAtHead.test.ts`: **row 9, 7 ids**.
//   2. Those 7 are FOUR blockers, not one. Three are refused: Reboot Pod
//      (`Future` Pokémon) and Glass Trumpet (`Tera` Pokémon) both rest on a
//      banner NO CATALOG COLUMN CLASSIFIES (`SELECT suffix, COUNT(*)` returns
//      NULL 3,157 / `ex` 629 and nothing else — D243/D340's finding, re-run), and
//      Powerglass wants an end-of-turn TOOL trigger point for 2 printings.
//   3. **CENSUS THE SENTENCE THE SENTENCE RESTS ON.** The fourth — Lycanroc's
//      "Spike-Clad" — rests on the `onEvolve` trigger, which is **58 printings /
//      29 legal / 13 legal sentences**, of which SIX legal sentences are unbuilt.
//   4. **THE CHEAPEST THING THAT FAMILY BUYS IS NOT THE CARD THAT SENT ME**:
//      Ledian's sentence is `DEFIANT_HORN` (D250's trigger + Boss's Orders' op,
//      both already paid for) plus ONE relative clause — and that clause turns
//      out to be printed on a SECOND op in a SECOND column, doubling the row.
//   5. Grepped: `Ledian`, `Bianca's Devotion` and `Glittering Star` occur in this
//      tree only as PROSE (index.ts, cards.ts, effects.ts, hpAura.test.ts,
//      legalNonAttackPrograms.test.ts). **Prose is not an implementation.**
//
// ── THE VOCABULARY, AND THE PROOF IT WAS NEEDED ─────────────────────────────
// The standing rule is to try to build with NO new vocabulary FIRST, because two
// consecutive slices found a "needs new vocabulary" price was wrong. Run here it
// fails, and the refutation is from source rather than from argument:
//   • `gust` is `{ op; recordAs?; basicOnly? }` — one narrowing, a CARD read.
//   • `healChosen` is `{ op; amount; zone?; upTo? }` — one narrowing, the printed
//     zone word.
//   • `matchesFilter` takes a `Card`; current HP is not on a `Card`.
//   • `conditionHolds` takes a SEAT and no uid, so no `BoardCondition` member is
//     per-body (its own doc says so, and D310 acted on it).
//   • `AbilityProgram.remainingHpAtMost` (D310) exists and is the same PREDICATE
//     — but its SUBJECT is the ability's HOST, gated at `abilityBodyGateMet`.
// So the minimum is ONE optional number on each of two ops, and the shared thing
// is the predicate: `remainingHpWithin` (continuous.ts), which `abilityBodyGateMet`
// is now refactored onto so the phrase has ONE spelling for all THREE subjects.
// **ZERO new ops, ZERO new prompt kinds, ZERO choice kinds, ZERO events, ZERO
// error codes, ZERO `GameState` fields, ZERO `CardFilter` members, ZERO regexes,
// ZERO deriver arms, and `MATCH_RECORD_VERSION` STAYS 20** — both fields are
// optional WIDENINGS (D125/D309): a v20 record cannot hold one and reads
// identically without it.
//
// ── 🛑 THE COST NOBODY WOULD HAVE PREDICTED: `healChosen` HAD NO PLAYABILITY
//    GATE AT ALL, AND WAS RIGHT NOT TO ─────────────────────────────────────────
// `programPlayable` has never had a heal branch — `SAGUARO`'s doc block says so in
// writing and calls it a wart. It was not a wart; it was correct. Unnarrowed, this
// op's candidates are every own in-play Pokémon, a set §1.1 makes non-empty at
// every legal board, so "could only whiff" was UNREACHABLE. The first rider makes
// it reachable on its first printing — and that printing is a **SUPPORTER**, so
// affording it would spend the turn's one Supporter (§7.2) on an empty prompt.
// **A MISSING GATE IS NOT A DEFECT UNTIL A RIDER ARRIVES; IT BECOMES ONE IN THE
// SAME COMMIT AS THE RIDER.** That is D331's Lisia's Appeal defect (a rider added
// to a scan while a LENGTH test guarded the play) arriving from the other
// direction — there the gate was wrong, here it was absent — and §5 drives it.
//
// ── NOTHING ENTERS `FIXTURE_POOL` ───────────────────────────────────────────
// All six real ids are driven on a LOCAL `cardPool` (D275's idiom). `sv05`, `sv07`
// and `svp` are none of them among `catalogManifest`'s six sets, so a real-card
// fixture is forbidden outright; a synthetic one was available and refused,
// because **A FIXTURE IS A CENSUS POPULATION** (D348 reddened `catalogManifest`
// and `clauseApostrophe` with two bodies no grep of its own vocabulary reached).
// §6 asserts the abstinence by id rather than claiming it in prose.

const LEDIAN = "svp-133";
const LEDIAN_IDS = ["svp-133", "sv07-003", "sv07-144"] as const;
const LEDIAN_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may switch in 1 of your opponent's Benched Pokémon that has 90 HP or less remaining to the Active Spot.";

const BIANCA = "sv05-142";
const BIANCA_IDS = ["sv05-142", "sv05-197", "sv05-209"] as const;
const BIANCA_TEXT = "Heal all damage from 1 of your Pokémon that has 30 HP or less remaining.";

const LEDYBA = "fix-d349-ledyba";
/** 90 HP — the BOUNDARY body: undamaged, it sits exactly ON Ledian's window. */
const AT_90 = "fix-d349-at90";
/** 130 HP — outside both windows until it is damaged into one. */
const AT_130 = "fix-d349-at130";
/** 30 HP — the boundary body for Bianca's window, and the witness that an
    UNDAMAGED Pokémon is a candidate (it heals 0 and emits nothing). */
const AT_30 = "fix-d349-at30";
const ENERGY = "fix-energy";
/** Potion `sv01-188` — the UNNARROWED heal, and the control for §5. It is a real
    `FIXTURE_POOL` card already, so it enters this file through the pool rather
    than through `LOCAL_CARDS`: nothing is defined for it here. */
const POTION = "sv01-188";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    LEDIAN_IDS.map((id) => [
      id,
      battler(id, {
        name: "Ledian",
        stage: "Stage1",
        evolveFrom: "Ledyba",
        hp: 90,
        retreat: 0,
        types: ["Grass"],
        abilities: [{ type: "Ability", name: "Glittering Star Pattern", effect: LEDIAN_TEXT }],
      }),
    ]),
  ),
  ...Object.fromEntries(BIANCA_IDS.map((id) => [id, trainerCard(id, "Supporter", BIANCA_TEXT)])),
  [LEDYBA]: battler(LEDYBA, { name: "Ledyba", hp: 60, types: ["Grass"] }),
  [AT_90]: battler(AT_90, { name: "D349 90HP", hp: 90, retreat: 1 }),
  [AT_130]: battler(AT_130, { name: "D349 130HP", hp: 130, retreat: 1 }),
  [AT_30]: battler(AT_30, { name: "D349 30HP", hp: 30, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [LEDIAN]: 4,
  [LEDIAN_IDS[1]]: 4,
  [LEDIAN_IDS[2]]: 4,
  [BIANCA]: 4,
  [BIANCA_IDS[1]]: 4,
  [BIANCA_IDS[2]]: 4,
  [LEDYBA]: 8,
  [AT_90]: 8,
  [AT_130]: 8,
  [AT_30]: 8,
  [POTION]: 2,
  [ENERGY]: 2,
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
    `FIXTURE_POOL` — which is what keeps this slice out of `catalogManifest`'s and
    `clauseApostrophe`'s populations, and §6 asserts it rather than assuming it. */
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

/** TEST SURGERY — seat exactly the bodies each side names, Active first, on p1's
    turn (p2 went first and passed, so p1's turn is unrestricted). */
function board(spec: { p1: readonly string[]; p2: readonly string[] }, seed = 4): GameState {
  // Turn 3, not turn 1: §4/§10 refuse an evolution on a seat's FIRST turn, and
  // this file evolves. The turns are passed BEFORE the surgery so the bodies the
  // spec names are seated on the turn they are used.
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  for (const seat of ["p1", "p2"] as const) {
    const ids = seat === "p1" ? spec.p1 : spec.p2;
    state = setActive(state, seat, ids[0] ?? AT_130);
    state = clearBench(state, seat);
    for (const id of ids.slice(1)) state = benchFromDeck(state, seat, id);
  }
  return state;
}

/** TEST SURGERY — `setActiveFromDeck`'s job, written locally because the shared
    one is not re-exported under a name that also clears the previous Active's
    damage; this file needs the damage it sets to be the only damage on the board. */
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

/** TEST SURGERY — put `damage` HP of damage on one body. Index 0 is the Active. */
function damage(state: GameState, seat: Seat, index: number, amount: number): GameState {
  const side = state.players[seat];
  if (index === 0) {
    if (side.active === null) throw new Error(`${seat} has no Active`);
    return {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...side, active: { ...side.active, damage: amount } },
      },
    };
  }
  const body = side.bench[index - 1];
  if (body === undefined) throw new Error(`${seat} has no bench[${index - 1}]`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: side.bench.map((b, i) => (i === index - 1 ? { ...b, damage: amount } : b)),
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

function cardIdAt(state: GameState, seat: Seat, index: number): string {
  const side = state.players[seat];
  const body = index === 0 ? side.active : side.bench[index - 1];
  if (body === undefined || body === null) throw new Error(`no body at ${seat}[${index}]`);
  return state.cardIdByUid[body.stack.at(-1) ?? ""] ?? "";
}

describe("D349 §1 — the two registry rows, read off the LIVE registry", () => {
  it("Ledian's THREE printings resolve to ONE program object, by identity", () => {
    const first = programFor(LEDIAN);
    expect(first).toBeDefined();
    // Identity and not deep equality: three separate-but-equal objects would pass
    // a `toEqual` and would be three rows in `censusAtHead`'s object
    // decomposition, which this slice asserts steps by exactly ONE.
    for (const id of LEDIAN_IDS) expect(programFor(id), id).toBe(first);
  });

  it("Bianca's Devotion's THREE printings resolve to ONE program object", () => {
    const first = programFor(BIANCA);
    expect(first).toBeDefined();
    for (const id of BIANCA_IDS) expect(programFor(id), id).toBe(first);
  });

  it("🛑 the two rows do NOT share an object — one CLAUSE is not one sentence", () => {
    // The near-twin rule (D199) is about printed SENTENCES, and these two share a
    // relative clause and nothing else: different columns, different ops,
    // different numbers. Sharing would make an edit to one card silently move a
    // card that never printed its words.
    expect(programFor(LEDIAN)).not.toBe(programFor(BIANCA));
    // …and neither shares with the row each was modelled on.
    expect(programFor(LEDIAN)).not.toBe(programFor("sv09-136")); // Defiant Horn
    expect(programFor(BIANCA)).not.toBe(programFor("sv01-183")); // Potion
  });

  it("Ledian is an onEvolve TRIGGER carrying a single gust, and NO attack key", () => {
    const program = programFor(LEDIAN);
    // ⚠️ The KEY SET is asserted, not just the trigger: an `attack` key here would
    // move `BUILT.attack`'s registry summand, which this slice claims stands still.
    expect(Object.keys(program ?? {})).toEqual(["triggered"]);
    const ability = program?.triggered?.[0];
    expect(program?.triggered).toHaveLength(1);
    expect(ability?.name).toBe("Glittering Star Pattern");
    expect(ability?.trigger).toBe("onEvolve");
    // The printed "you may" — on the TRIGGER, because `gust` has no decline of
    // its own and the sentence offers the whole switch or nothing.
    expect(ability?.optional).toBe(true);
    expect(ability?.program).toEqual([{ op: "gust", remainingHpAtMost: 90 }]);
  });

  it("Bianca's Devotion is ONE healChosen — no zone, no upTo, amount `all`", () => {
    const program = programFor(BIANCA);
    expect(Object.keys(program ?? {})).toEqual(["trainer"]);
    // ⚠️ THE MUTANTS THIS KILLS, and all three are one printed word away:
    // `zone: "bench"` (the card says "1 of your Pokémon" and §1.1 makes the Active
    // one of them), `upTo` (the count is an exact one), and `amount: 30` (the card
    // says "all damage", and 30 is both Potion's number AND this card's threshold
    // — the one place a copy-paste would look right).
    expect(program?.trainer).toEqual([{ op: "healChosen", amount: "all", remainingHpAtMost: 30 }]);
  });
});

describe("D349 §2 — Ledian: the window narrows the GUST candidates", () => {
  /** Evolve p1's Active Ledyba into Ledian and return whatever that produced. */
  function evolveIntoLedian(state: GameState): ReturnType<typeof apply> {
    const withCard = toHand(state, LEDIAN);
    return apply(withCard.state, {
      type: "evolve",
      seat: "p1",
      uid: withCard.uid,
      target: { spot: "active" },
    });
  }

  it("takes the 90-HP body and REFUSES the 130-HP one — the boundary is INCLUSIVE", () => {
    // p2's Bench holds one 90 and one 130. ⚠️ TWO mutants die on this one board:
    //   • `<` for `<=` — the print says "90 HP **or less**", and Ledian's own
    //     printed HP is also 90, which is the coincidence a strict comparison
    //     would hide behind for exactly this body. Under `<` the window is EMPTY
    //     and nothing switches at all.
    //   • the rider dropped entirely — with two candidates `parkOrForce` PARKS,
    //     so an unfiltered gust never reaches `turn:action` here.
    const start = board({ p1: [LEDYBA], p2: [AT_130, AT_90, AT_130] });
    const { state: done, events } = evolveIntoLedian(start);
    expect(done.phase.kind).toBe("turn:action");
    expect(events.map((e) => e.type)).toContain("POKEMON_SWITCHED");
    expect(cardIdAt(done, "p2", 0)).toBe(AT_90);
  });

  it("🛑 it is a BOARD read: 50 damage brings a 130-HP body INTO the window", () => {
    // The same shape as above with one number changed. A CARD read of printed HP
    // (D181's `basicPokemon.maxHp`, the half that DID ship) cannot see this move
    // at all, which is the whole reason this rider is not a `CardFilter`.
    const start = damage(board({ p1: [LEDYBA], p2: [AT_130, AT_130, AT_130] }), "p2", 1, 50);
    const { state: done } = evolveIntoLedian(start);
    expect(done.phase.kind).toBe("turn:action");
    expect(cardIdAt(done, "p2", 0)).toBe(AT_130);
    // …and it is the DAMAGED one that came up: the body that was on bench[0] is
    // now Active carrying its 50, and the two full-HP 130s stayed put.
    expect(done.players.p2.active?.damage).toBe(50);
  });

  it("PARKS on two in-window bodies, and the CAPTION names the window", () => {
    const start = board({ p1: [LEDYBA], p2: [AT_130, AT_90, AT_90, AT_130] });
    const { state: parked } = evolveIntoLedian(start);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(parked.phase.prompt.candidates).toHaveLength(2);
    // A caption that named a set the validator does not offer is the dialog
    // contradicting itself — `gustTargetNoun`'s stated reason for existing.
    expect(parked.phase.prompt.note).toBe(
      "Gust up which of the opponent's Benched Pokémon that has 90 HP or less remaining?",
    );
    const pick = parked.phase.prompt.candidates[1];
    if (pick === undefined) throw new Error("no second candidate");
    const { state: done, events } = apply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: pick },
    });
    expect(events.map((e) => e.type)).toContain("POKEMON_SWITCHED");
    expect(cardIdAt(done, "p2", 0)).toBe(AT_90);
  });

  it("an EMPTY window parks nothing and costs nothing — the evolution still lands", () => {
    // Every opposing Benched body above the window: `parkOrForce` has no
    // candidates, so the whole trigger is a silent no-op. The point is that a
    // TRIGGER with an empty narrowed set does not strand the turn.
    const start = board({ p1: [LEDYBA], p2: [AT_130, AT_130, AT_130] });
    const { state: done, events } = evolveIntoLedian(start);
    expect(done.phase.kind).toBe("turn:action");
    expect(events.map((e) => e.type)).not.toContain("POKEMON_SWITCHED");
    expect(cardIdAt(done, "p1", 0)).toBe(LEDIAN);
    expect(cardIdAt(done, "p2", 0)).toBe(AT_130);
  });
});

describe("D349 §3 — Bianca's Devotion: the window narrows the HEAL candidates", () => {
  function playBianca(state: GameState): ReturnType<typeof apply> {
    const withCard = toHand(state, BIANCA);
    return apply(withCard.state, { type: "playTrainer", seat: "p1", uid: withCard.uid });
  }

  it("heals ALL damage from the one body inside the window, and refuses the rest", () => {
    // p1 holds a 130-HP Active damaged to 20 remaining and two full-HP 130s.
    // ⚠️ THREE mutants die here: `amount: 30` (Potion's number AND this card's own
    // threshold — the one place a copy-paste looks right), the rider dropped (three
    // candidates would PARK rather than force), and `zone: "bench"` (which would
    // drop the Active and leave the window empty).
    const start = damage(board({ p1: [AT_130, AT_130, AT_130], p2: [AT_130] }), "p1", 0, 110);
    const { state: done, events } = playBianca(start);
    expect(done.phase.kind).toBe("turn:action");
    expect(events.filter((e) => e.type === "HEALED")).toHaveLength(1);
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("🛑 an UNDAMAGED body inside the window IS a candidate — it heals 0", () => {
    // The printed clause narrows by REMAINING HP and says nothing about damage;
    // `healChosen`'s own doc already refuses to invent a damaged restriction, and
    // the single-arm rule makes the zero-heal silent. ⚠️ THE MUTANT THIS KILLS: a
    // `damage > 0` conjunct in the funnel, which would read like a kindness and
    // would play a rule the card does not print — under it this play would be
    // REFUSED outright by §5's gate rather than merely quiet.
    const start = board({ p1: [AT_130, AT_30], p2: [AT_130] });
    const { state: done, events } = playBianca(start);
    expect(done.phase.kind).toBe("turn:action");
    expect(events.filter((e) => e.type === "HEALED")).toHaveLength(0);
    expect(events.map((e) => e.type)).toContain("TRAINER_PLAYED");
  });

  it("PARKS on two in-window bodies, and the CAPTION names the window", () => {
    const start = board({ p1: [AT_130, AT_30, AT_30], p2: [AT_130] });
    const { state: parked } = playBianca(start);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // The 130-HP ACTIVE is out and both 30-HP Benched bodies are in — the zone
    // word is ABSENT on this card, so the Active is excluded by the WINDOW alone.
    expect(parked.phase.prompt.candidates).toHaveLength(2);
    for (const c of parked.phase.prompt.candidates) expect(c.spot.spot).toBe("bench");
    expect(parked.phase.prompt.note).toBe(
      "Heal which of your Pokémon that has 30 HP or less remaining?",
    );
  });
});

describe("D349 §4 — the shared predicate, asserted as shared", () => {
  it("ONE board answers BOTH windows the same way — the arithmetic is not copied", () => {
    // A 130-HP body damaged to 20 remaining is inside BOTH windows (20 ≤ 30 and
    // 20 ≤ 90); every other body on this board is outside both. Two independent
    // copies of `effectiveMaxHp − damage` could disagree here and nothing else in
    // this suite would notice, which is why `remainingHpWithin` is ONE function
    // and why `abilityBodyGateMet` was refactored onto it in the same commit.
    const seeded = board({ p1: [LEDYBA, AT_130], p2: [AT_130, AT_130, AT_130] });
    const both = damage(damage(seeded, "p1", 1, 110), "p2", 1, 110);

    // (a) the HEAL side: p1's Ledyba has 60 remaining (out) and the benched 130
    // has 20 (in), so the play forces onto the one body rather than parking.
    const withHeal = toHand(both, BIANCA);
    const healed = apply(withHeal.state, {
      type: "playTrainer",
      seat: "p1",
      uid: withHeal.uid,
    });
    expect(healed.state.phase.kind).toBe("turn:action");
    expect(healed.state.players.p1.bench[0]?.damage).toBe(0);

    // (b) the GUST side, off the SAME board: p2's bench[0] has 20 remaining and
    // bench[1] has 130, so the trigger forces onto the damaged one.
    const withLedian = toHand(both, LEDIAN);
    const gusted = apply(withLedian.state, {
      type: "evolve",
      seat: "p1",
      uid: withLedian.uid,
      target: { spot: "active" },
    });
    expect(gusted.state.phase.kind).toBe("turn:action");
    expect(gusted.events.map((e) => e.type)).toContain("POKEMON_SWITCHED");
    expect(gusted.state.players.p2.active?.damage).toBe(110);
  });

  it("the gust window is measured against the OPPONENT's body, not the actor's", () => {
    // p1's own Active is a 60-HP Ledyba — comfortably inside the 90 window — and
    // p2's Bench is entirely outside it. ⚠️ THE MUTANT THIS KILLS:
    // `state.players[seat]` for `otherSeat(seat)` in the funnel, which would offer
    // the actor their own bodies (or, here, find one and switch something).
    const start = board({ p1: [LEDYBA, LEDYBA], p2: [AT_130, AT_130] });
    const withCard = toHand(start, LEDIAN);
    const { state: done, events } = apply(withCard.state, {
      type: "evolve",
      seat: "p1",
      uid: withCard.uid,
      target: { spot: "active" },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(events.map((e) => e.type)).not.toContain("POKEMON_SWITCHED");
  });
});

describe("D349 §5 — `programPlayable`: the offer and the refusal cannot disagree", () => {
  it("🛑 the SUPPORTER is REFUSED when nothing is inside the window", () => {
    // D331's defect, arriving on a second op. Before this slice `programPlayable`
    // had no `healChosen` branch at all, so this play would have been afforded,
    // parked an empty prompt and spent the turn's one Supporter (§7.2) on nothing.
    const start = board({ p1: [AT_130, AT_130], p2: [AT_130] });
    const withCard = toHand(start, BIANCA);
    const result = applyAction(withCard.state, {
      type: "playTrainer",
      seat: "p1",
      uid: withCard.uid,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the play to be refused");
    expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("…and the refused play costs the turn NOTHING — the Supporter is still there", () => {
    const start = board({ p1: [AT_130, AT_130], p2: [AT_130] });
    const withCard = toHand(start, BIANCA);
    const refused = applyAction(withCard.state, {
      type: "playTrainer",
      seat: "p1",
      uid: withCard.uid,
    });
    expect(refused.ok).toBe(false);
    // The SAME state now given a body inside the window plays the card, which is
    // what proves the refusal above was about the window and not about the turn.
    const rescued = damage(withCard.state, "p1", 0, 110);
    const played = applyAction(rescued, { type: "playTrainer", seat: "p1", uid: withCard.uid });
    expect(played.ok).toBe(true);
  });

  it("🛑 BEHAVIOUR-PRESERVING: an UNNARROWED heal is still playable on a full-HP board", () => {
    // Potion `sv01-183` carries no rider, so `healChosenTargets` returns every own
    // in-play Pokémon and the new gate can never fire on it. `SAGUARO`'s doc calls
    // the un-gated heal a wart; this asserts the wart is UNCHANGED, because
    // changing it would be a rule this slice's cards do not print.
    const start = board({ p1: [AT_130, AT_130], p2: [AT_130] });
    const withCard = toHand(start, POTION);
    const played = applyAction(withCard.state, {
      type: "playTrainer",
      seat: "p1",
      uid: withCard.uid,
    });
    expect(played.ok).toBe(true);
  });
});

describe("D349 §6 — the pool and the registry, asserted by id", () => {
  it("NOTHING this slice defines reached `FIXTURE_POOL`", () => {
    // ⚠️ **A FIXTURE IS A CENSUS POPULATION** (D348): adding a body here would move
    // `catalogManifest`'s real-fixture population and `clauseApostrophe`'s
    // derivable sweep, neither of which any grep of this slice's vocabulary
    // reaches. The abstinence is asserted rather than described.
    for (const id of [...LEDIAN_IDS, ...BIANCA_IDS, LEDYBA, AT_90, AT_130, AT_30]) {
      expect(Object.hasOwn(FIXTURE_POOL, id), `${id} leaked into FIXTURE_POOL`).toBe(false);
    }
  });

  it("the SIX ids are CONTIGUOUS registry keys, in order — the permanent half", () => {
    // 🛑 `censusAtHead`'s `raw[raw.length - 1]` is keyed on INSERTION ORDER and has
    // gone red on a constant nobody touched SEVEN consecutive times (D338, D340,
    // D342, D345, D346, D347, and this slice). No grep of any census FIGURE NAME
    // reaches it. The baton D347 carried in `buzzingBoost.test.ts` is picked up
    // here: a live pin, in the file that moved the constant, so the next slice
    // finds a reason beside the rung rather than a bare integer.
    // ⚠️ And this claim is SPENT the moment the next registry row lands — which is
    // exactly what it is for. D347's version of it was written as a permanent
    // assertion and had to be re-pointed at contiguity; this one is written as what
    // it is, and the next slice should re-point it the same way.
    //
    // 🆕🛑 **D350 SPENT IT, ON THE VERY NEXT SLICE, AND RE-POINTED RATHER THAN
    // DELETED — WHICH IS WHAT THE PARAGRAPH ABOVE ASKED FOR.** The live "last N
    // keys" baton now sits in `invitingWink.test.ts` §7 (`raw.slice(-3)`), and what
    // is left here is the PERMANENT half: these six ids are CONTIGUOUS and in the
    // order this file names them. That is a property of the row rather than of the
    // whole registry at one instant, so it cannot rot on the next insert — which is
    // the exact defect D347 reproduced in `buzzingBoost.test.ts` and D349 repaired
    // there. The expiring claim and the permanent one are DIFFERENT ASSERTIONS and
    // neither substitutes for the other.
    const raw = registryCardIds();
    const at = raw.indexOf(LEDIAN_IDS[0]);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(raw.slice(at, at + 6)).toEqual([...LEDIAN_IDS, ...BIANCA_IDS]);
  });

  it("all SIX real ids are registry keys, and none of the four demonstrators is", () => {
    const keys = new Set(registryCardIds());
    for (const id of [...LEDIAN_IDS, ...BIANCA_IDS]) expect(keys.has(id), id).toBe(true);
    // The synthetic bodies are scenery — a registry key for one would be a program
    // no printing resolves to, and would inflate `raw.length` against
    // `nonAttackRegistryIds()`, whose two lines this slice keeps 0 apart.
    for (const id of [LEDYBA, AT_90, AT_130, AT_30]) expect(keys.has(id), id).toBe(false);
  });
});
