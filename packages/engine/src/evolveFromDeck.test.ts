import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect, splitAttackGateClause } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// ── D307 — "SEARCH YOUR DECK FOR A CARD THAT EVOLVES FROM THIS POKÉMON AND PUT
//    IT ONTO THIS POKÉMON TO EVOLVE IT." THE FAMILY D277 REFUSED, D305 MIS-PRICED,
//    D306 PRICED, AND THIS SLICE BUILDS — BY REMOVING THE BLOCKER RATHER THAN BY
//    CHANNELLING IT. ──
//
// THE POPULATION, re-queried END TO END against remote Cloudflare D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-09**:
//
//   SELECT id, name, stage, evolve_from, legal_standard, attacks_json
//     FROM cards WHERE instr(attacks_json,'that evolves from this') > 0
//    ORDER BY legal_standard DESC, id;
//
// **SIX `legal_standard = 1` printings on FOUR cards, ONE effect string** —
// Eevee `sv06-135`/`sv06-188` "Ascension" ({C}, no damage, and a SECOND attack
// "Quick Attack" {C}{C}{C} `damage "20+"`), Dwebble `sv10-011` "Ascension" ({C}),
// Team Rocket's Pupitar `sv10-095` "Explosive Ascension" (**Stage 1**,
// `evolve_from` "Team Rocket's Larvitar", `damage: 30`) and Exeggcute
// `sv08-001`/`sv08-192` "Precocious Evolution", whose text is the same sentence
// behind D281's printed licence. Plus FOUR `legal_standard = 0` rows: Glimmet
// `sv02-124`/`sv04.5-179` ({F} "Ascension") and Finizen `sv03-060`/`sv04.5-123`,
// whose "Valiant Evolution" is a COMPOUND — *"Switch this Pokémon with 1 of your
// Benched Pokémon. **If you do**, search your deck for a card that evolves from
// this Pokémon…"* — and is the reason the anchor is `^…$` (§1 drives the refusal).
//
// ── HOW THE REFUSAL WAS PAID ────────────────────────────────────────────────
//
// D306 typed the blocker correctly and it is real: `stepOp` returns a bare
// `GameState` or a prompt, while `turn.ts placeEvolution` ends in one of two
// `ApplyResult`s that SET A PHASE — `resolveMidTurnKnockOuts` (→ `ko:takePrizes`)
// and `runBoardTrigger(…,"onEvolve",…)` (→ `effect:choose`). Both are still there
// and `precociousEvolution.test.ts` §3 still drives both. **What this slice found
// is that the DECK route reaches neither**:
//
//   🛑 **THE TRIGGER TAIL IS UNREACHABLE, AND IT IS A CATALOG FACT.** Every
//      printed on-evolve Ability says *"When you play this Pokémon **from your
//      hand** to evolve…"*. All EIGHT `onEvolve` rows in `registry.ts` do; over
//      the whole legal catalog, `instr(abilities_json,'to evolve') > 0 AND
//      instr(abilities_json,'from your hand to evolve') = 0` returns exactly TWO
//      rows and **neither is a trigger** — Pidove `sv05-133` (this same placement
//      printed as an on-demand Ability, HP-gated and name-filtered, carrying no
//      program) and Team Rocket's Ampharos `sv10-074` (the OPPONENT's evolve). So
//      a card that was never in hand satisfies no printed antecedent, and the
//      price is a SOURCE-ZONE distinction rather than a park inside a park. §4
//      drives BOTH directions on one board.
//   🛑 **THE KO TAIL IS SWEPT BY THE ATTACK EPILOGUE.** §8.1 `finishAttack`
//      (flow.ts) sweeps BOTH boards — the ATTACKER's own Active included — and
//      the only op after the placement is the trailing `shuffleDeck`. §5 drives a
//      board where the evolve is LETHAL *and* the attack continues, which is the
//      doubt D306 flagged against its own claim.
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE new `EffectOp` with **no fields**, ONE anchored regex with **no captures**,
// ONE deriver arm, ONE `chooseCards.dest` member and ONE extraction (`types.ts
// evolveOnto` — `placeEvolution` minus its two tails). **NO new prompt kind, NO
// new choice kind, NO new event, NO new error code, NO new `GameState` field, NO
// new `CardFilter` member and NO REGISTRY ROW** — the raw summand of
// `BUILT.attack` is keyed on the READER over the whole legal corpus
// (`censusAtHead.test.ts`'s D274 block; `programFor` appears nowhere in that
// addition), so an authored row for Eevee, Dwebble or Pupitar would buy zero
// printings. `redact.ts` and `src/` take ZERO; `packages/schema` takes the one
// `dest` word, which is the first non-zero schema diff since D293.

const BARE =
  "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";
const GATED = `If you go first, you can use this attack during your first turn. ${BARE}`;
/** Finizen `sv03-060`/`sv04.5-123` "Valiant Evolution" — the printed COMPOUND
    that carries this clause as its SECOND half, and the whole reason the anchor
    is `^…$`. Simulating the tail without the head would evolve a body the engine
    never switched. */
const COMPOUND =
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";
/** The legal sentences of the same MECHANISM whose subject is a body OTHER than
    the one running the program — the remainder `censusAtHead.test.ts`'s row 0
    still carries, and which THIS op structurally cannot reach (it resolves its
    subject through `ctx.sourceUid`). Listed so the refusal is asserted rather than
    described.
    🆕 ⚠️ **D308 — THREE SENTENCES BECAME TWO, AND THE ONE THAT LEFT IS THE ONE
    D307 PRICED AS THE HARDEST.** *"For each of your Benched Pokémon…"* (4
    printings) is built by `evolveFromDeckEachBenched` — it asks NOTHING, so it
    needed D216's `schedule` and no second park at all. What remains needs more
    than a subject: Duosion `sv10.5b-038`/`-119` needs a body-CHOICE park AND a
    target (its *"1 of your Pokémon"* admits the Active), and Team Rocket's
    Nidorina `sv10-115` needs a type-filtered MULTI-body choice. **One blocker,
    three surcharges** — see `evolveEachBenched.test.ts`.

    🆕 ⚠️ **D309 — TWO BECAME ONE, AND THE LIST WAS A SINGLETON.** Duosion's
    body-CHOICE sentence is built by `evolveFromDeckChosen`, which pays the
    surcharges D308 priced: the second park, the TARGET (its answer may be the
    Active) and the deck-aware narrowing.

    🆕 🛑 **D315 — ONE BECAME NONE, AND THIS LIST IS NOW EMPTY.** Nidorina's
    MULTI-body sentence is built by `evolveFromDeckEachChosen`, and the surcharge
    D309 named for it — *"`choosePokemon` is single-select at every existing site,
    so 'Choose up to 2' is a prompt SHAPE that does not exist"* — **was not a
    surcharge at all**: `choosePokemonMulti` has existed since D47, `cardplay.ts`
    validates it and both HUDs render it. What the row really cost was the FOURTH
    `continuationOps` member. ⚠️ **THE LIST STAYS, EMPTY, RATHER THAN BEING
    DELETED** — its sweep is what would name a SIXTH spelling of this family the
    day a set rotation prints one, and it has gone red BY NAME three times
    running, which is the whole reason it is a list and not a sentence. */
const OTHER_BODY: readonly string[] = [];
/** 🆕 D315 — the sentence that left the list, transcribed (D306) so the converse
    half of the rung below is about printed bytes rather than about a slice. */
const MULTI_BODY =
  "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";

/** 🆕 D309 — Duosion `sv10.5b-038`/`-119`, the sentence that LEFT the list above.
    Transcribed from the catalog row rather than built by interpolation (D306's
    trap, which D308 walked into anyway), and kept HERE so the departure is
    asserted in the file that used to refuse it. */
const BODY_CHOICE =
  "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";

/** Eevee `sv06-135`/`sv06-188`, BOTH attacks — the D306 lesson written into a
    fixture. A file that transcribed only the matching arm would build a one-attack
    Eevee and quietly make every per-index claim about it vacuous. */
function eevee(id: string): Card {
  return battler(id, {
    name: "Eevee",
    hp: 50,
    retreat: 1,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Ascension", effect: BARE },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Quick Attack",
        damage: "20+",
        effect: "Flip a coin. If heads, this attack does 20 more damage.",
      },
    ],
  });
}

/** Exeggcute `sv08-001` — the LICENSED printing, whose registry row carries the
    `firstTurnExempt` gate and NO attack body (D281/D282). The body it lacks is
    exactly what this slice's arm supplies, through the split. */
function exeggcute(id: string): Card {
  return battler(id, {
    name: "Exeggcute",
    hp: 30,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Precocious Evolution", effect: GATED }],
  });
}

function stage1From(id: string, from: string, hp: number): Card {
  return { ...battler(id, { hp, retreat: 1, types: ["Colorless"] }), stage: "Stage1", evolveFrom: from };
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv06-135": eevee("sv06-135"),
  "sv06-188": eevee("sv06-188"),
  "sv08-001": exeggcute("sv08-001"),
  "asc-vaporeon": stage1From("asc-vaporeon", "Eevee", 110),
  /** A frail Stage 1 off Eevee — 60 HP, so a Bravery Charm'd Eevee carrying 100
      damage survives as a Basic (50 + 50 = 110) and is Knocked Out the instant it
      evolves. `placeEvolution`'s own doc names exactly this reachability story. */
  "asc-frail": stage1From("asc-frail", "Eevee", 60),
  "asc-exeggutor": stage1From("asc-exeggutor", "Exeggcute", 120),
  /** Arboliva `sv01-023` "Enriching Oil" — the registry's on-evolve TRIGGER,
      re-pointed at Eevee so one board can play it BOTH ways. The program is the
      registry's (keyed by id); only the chain datum is local. */
  "sv01-023": { ...FIXTURE_POOL["sv01-023"], evolveFrom: "Eevee" } as Card,
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The FOURTEENTH seeded deck (D270's rule: a seeded suite gets its OWN deck).
    Two DIFFERENT evolutions off Eevee so the park has a real choice, plus the
    Bravery Charm the lethal board needs. */
const ASCENSION_DECK = deckOf({
  "sv06-135": 4,
  "sv08-001": 4,
  "asc-vaporeon": 4,
  "asc-frail": 4,
  "asc-exeggutor": 4,
  "sv01-023": 4,
  "sv02-173": 4,
  "fix-basic-1": 8,
  "fix-energy": 24,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: ASCENSION_DECK, p2: ASCENSION_DECK }, cardPool: POOL });
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

/** TEST SURGERY — every copy of `cardId` leaves the seat's deck (to the bottom of
    the DISCARD, so the deck count is still honest about what is searchable). Used
    to build the WHIFF board and the single-candidate board. */
function stripDeck(state: GameState, seat: Seat, cardIds: readonly string[]): GameState {
  const side = state.players[seat];
  const drop = new Set(cardIds);
  const removed = side.deck.filter((uid) => drop.has(state.cardIdByUid[uid] ?? ""));
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !drop.has(state.cardIdByUid[uid] ?? "")),
        discard: [...side.discard, ...removed],
      },
    },
  };
}

/** TEST SURGERY — all but ONE copy of `cardId` leaves the seat's deck, so the
    single-candidate park can be built without depending on how the shuffle
    distributed the four copies between deck, hand and prizes. */
function keepOneInDeck(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const copies = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId);
  const drop = new Set(copies.slice(1));
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !drop.has(uid)),
        discard: [...side.discard, ...copies.slice(1)],
      },
    },
  };
}

/** Pass whole turns until `turn`, leaving the actor in `turn:action`. */
function passTo(state: GameState, turn: number): GameState {
  let next = state;
  while (next.turn < turn) {
    if (next.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${next.phase.kind} while passing to turn ${turn}`);
    }
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** p1 with `activeId` Active, ONE bench body (§14.2 — an empty Bench makes the
    Active's Knock Out a LOSS, and a `gameOver` board proves nothing) and one {C}
    attached. p2 goes FIRST and ends their turn, so p1 attacks on turn 2. */
function board(seed: number, activeId = "sv06-135"): GameState {
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", activeId);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** Declare the printed attack at `index` and hand back whatever it left behind. */
function declare(state: GameState, index = 0): GameState {
  return mustApply(state, { type: "attack", seat: "p1", index }).state;
}

function cardsPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${phase.kind}`);
  }
  return phase.prompt;
}

function resolve(state: GameState, uids: readonly string[]): GameState {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  }).state;
}

function topId(state: GameState, seat: Seat): string {
  const active = state.players[seat].active;
  if (active === undefined || active === null) throw new Error(`${seat} has no Active`);
  const uid = active.stack[active.stack.length - 1];
  return state.cardIdByUid[uid ?? ""] ?? "";
}

function candidateIds(state: GameState, uids: readonly string[]): string[] {
  return uids.map((uid) => state.cardIdByUid[uid] ?? "").sort();
}

describe("D307 §1 — the reader: ONE anchor, TWO summands, and three deliberate refusals", () => {
  it("the bare sentence derives to the two-op program, and NOTHING else is in it", () => {
    // The D230 shape: the op plus the printed "Then, shuffle your deck." as a real
    // op, because the shuffle must fire on the WHIFF and on the DECLINE too.
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "evolveFromDeck" }, { op: "shuffleDeck" }]);
  });

  it("the LICENSED printing is refused WHOLE and derives once the gate clause is split", () => {
    // 🛑 THE TWO SUMMANDS, IN ONE TEST. A gate clause is a PRECONDITION (D281) and
    // no reader may swallow it, or the raw and split terms of `BUILT.attack` would
    // double-count the same printing. `attack.ts` rebinds `effect` to the split
    // body only when the attacking body's program CARRIES a gate at that index.
    expect(deriveAttackEffect(GATED)).toBeNull();
    const split = splitAttackGateClause(GATED);
    expect(split?.body).toBe(BARE);
    expect(deriveAttackEffect(split?.body ?? "")).toEqual([
      { op: "evolveFromDeck" },
      { op: "shuffleDeck" },
    ]);
    // …and the gate really is on the registry row that licenses it.
    expect(programFor("sv08-001")?.attackGate?.[0]).toEqual({ kind: "firstTurnExempt" });
  });

  it("🛑 the printed COMPOUND is refused — the anchor's `^…$` is load-bearing", () => {
    // Finizen `sv03-060`/`sv04.5-123`. Both are `legal_standard = 0` today, which
    // makes this the unusual case where an anchor's refusal is checkable against
    // real printed bytes rather than against a hypothetical: deriving the tail
    // would evolve a body the engine never switched.
    expect(deriveAttackEffect(COMPOUND)).toBeNull();
    // The CONTROL that stops this being vacuous: the compound really does carry
    // the anchored sentence's whole body, so it is the ANCHORING and not the
    // wording that refuses it. ⚠️ Note it is not a suffix — the catalog lowercases
    // the verb after *"If you do,"* — which is itself worth pinning: an anchor
    // written as `\bSearch…` rather than `^Search…` would still have missed this,
    // and one written case-insensitively would not.
    expect(COMPOUND.includes(BARE.slice(1))).toBe(true);
    expect(COMPOUND.endsWith(BARE)).toBe(false);
  });

  it("the ONE remaining OTHER-BODY sentence is refused — this op names a pronoun", () => {
    // `censusAtHead.test.ts`'s row 0 keeps this, at **1** legal printing (7 at
    // D307, 3 at D308). It is one MECHANISM short rather than one anchor short: it
    // names bodies that are not the one running the program, and this op resolves
    // its subject through `ctx.sourceUid`. Asserted here so "1 printing behind one
    // blocker" is a measurement in the suite rather than a sentence in a comment.
    // 🆕 D308/D309/D315 — the list SHRANK THREE TIMES and is now EMPTY, which is
    // this rung doing its job: it went red by name each time a sibling arm
    // resolved one of its members.
    for (const text of OTHER_BODY) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // ⚠️ THE CONVERSE, so the shrinking is not just a deletion: every sentence
    // that LEFT is refused by THIS anchor and built by ANOTHER, which is the
    // difference between "the family closed" and "the list got shorter".
    expect(deriveAttackEffect(BODY_CHOICE)).toEqual([
      { op: "evolveFromDeckChosen" },
      { op: "shuffleDeck" },
    ]);
    // 🆕 D315 — the last one out, and the SAME two-sided claim. It is built, and
    // it is NOT built by THIS op: a pronoun op resolves its subject through
    // `ctx.sourceUid` and can never name another body, so "refused here, built
    // elsewhere" is the assertion and a bare non-null would not be it.
    expect(deriveAttackEffect(MULTI_BODY)).toEqual([
      { op: "evolveFromDeckEachChosen", max: 2, pokemonType: "Darkness" },
      { op: "shuffleDeck" },
    ]);
  });
});

describe("D307 §2 — the printed attack on a real board", () => {
  it("Ascension PARKS on the deck's evolutions, and only on them", () => {
    const parked = declare(board(11));
    const prompt = cardsPrompt(parked);
    expect(prompt.dest).toBe("evolve");
    // "Up to" — the printed decline, and the printed article: ONE card.
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(1);
    expect(prompt.note).toContain("evolves from Eevee");
    // Exactly the deck cards whose `evolveFrom` is this body's top card NAME —
    // `asc-exeggutor` (off Exeggcute) is in the same deck and is NOT offered,
    // which is what makes the filter a measurement rather than "everything".
    expect(new Set(candidateIds(parked, prompt.candidates))).toEqual(
      new Set(["asc-vaporeon", "asc-frail", "sv01-023"]),
    );
  });

  it("resolving it EVOLVES the attacker, and the stack keeps its history", () => {
    const parked = declare(board(11));
    const pick = cardsPrompt(parked).candidates.find(
      (uid) => parked.cardIdByUid[uid] === "asc-vaporeon",
    );
    expect(pick).toBeDefined();
    const done = resolve(parked, [pick ?? ""]);
    expect(topId(done, "p1")).toBe("asc-vaporeon");
    expect(done.players.p1.active?.stack.length).toBe(2);
    // …and the card really left the deck rather than being copied out of it.
    expect(done.players.p1.deck).not.toContain(pick);
  });

  it("§10's carry-over comes with it — this is `placeEvolution`'s own body", () => {
    // The extraction (`types.ts evolveOnto`) is the SAME code the hand route runs,
    // so the deck route cannot drift by forgetting a clear. Energy and damage stay
    // on the stack; `turnPlayed` resets.
    let state = board(12);
    state = setDamage(state, "p1", 20);
    const parked = declare(state);
    const placedOn = parked.turn;
    const pick = cardsPrompt(parked).candidates.find(
      (uid) => parked.cardIdByUid[uid] === "asc-vaporeon",
    );
    const done = resolve(parked, [pick ?? ""]);
    const active = done.players.p1.active;
    expect(active?.damage).toBe(20);
    expect(active?.energy.length).toBe(1);
    // The turn the placement LANDED on, not `done.turn` — resolving the pick ends
    // the attacker's turn (§5.3), so the board has already moved on by the time
    // this is read. The stamp is what stops the new body evolving again.
    expect(active?.turnPlayed).toBe(placedOn);
    expect(active?.conditions).toEqual({ rotation: "none", poisonDamage: 0, burned: false });
  });

  it("a POKEMON_EVOLVED event is filed, and no DECK_SEARCHED is", () => {
    // The placement announces itself with the event `placeEvolution` has always
    // pushed; there is no second row for the search, because the card is public
    // the moment it lands and a `DECK_SEARCHED` would need a `dest` word this
    // event union does not have.
    const parked = declare(board(13));
    const pick = cardsPrompt(parked).candidates[0];
    const applied = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick ?? ""] },
    });
    const types = applied.events.map((event: GameEvent) => event.type);
    expect(types).toContain("POKEMON_EVOLVED");
    expect(types).not.toContain("DECK_SEARCHED");
  });

  it("the DECLINE and the WHIFF are both silent no-ops, and both still shuffle", () => {
    // `min: 0` is the printed "up to", and the trailing `shuffleDeck` is an OP
    // rather than a rider precisely so it fires on both endings (D230's rule).
    const declined = resolve(declare(board(14)), []);
    expect(topId(declined, "p1")).toBe("sv06-135");

    // The WHIFF: no card in the deck evolves from Eevee, so there is no park at
    // all — the op returns the state untouched and the attack runs on.
    let barren = board(15);
    barren = stripDeck(barren, "p1", ["asc-vaporeon", "asc-frail", "sv01-023"]);
    const after = declare(barren);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(topId(after, "p1")).toBe("sv06-135");
  });

  it("a SINGLE candidate still PARKS — the printed decline is not a no-choice", () => {
    // `searchDeck`'s doctrine, inherited deliberately: the M1 "a choice with no
    // choice in it is not a choice" rule does not reach an "up to", because
    // taking the card and taking nothing are two different states.
    let single = board(16);
    single = stripDeck(single, "p1", ["asc-frail", "sv01-023"]);
    single = keepOneInDeck(single, "p1", "asc-vaporeon");
    const parked = declare(single);
    expect(cardsPrompt(parked).candidates.length).toBe(1);
    expect(cardsPrompt(parked).min).toBe(0);
  });

  it("Exeggcute's LICENSED printing runs the same program through the split", () => {
    // 🛑 THE SECOND SUMMAND ON A BOARD. `sv08-001` carries only a gate in the
    // registry; the body comes from the deriver, applied to the SPLIT string.
    let state = board(17, "sv08-001");
    state = stripDeck(state, "p1", ["asc-vaporeon", "asc-frail", "sv01-023"]);
    const parked = declare(state);
    const prompt = cardsPrompt(parked);
    // Compared as a SET: how many copies are still in the deck depends on the
    // opening hand and the prizes, and the claim here is about WHICH card the
    // filter admits, not about how many of it the shuffle left behind.
    expect(new Set(candidateIds(parked, prompt.candidates))).toEqual(new Set(["asc-exeggutor"]));
    expect(prompt.candidates.length).toBeGreaterThan(0);
    const done = resolve(parked, [prompt.candidates[0] ?? ""]);
    expect(topId(done, "p1")).toBe("asc-exeggutor");
  });
});

describe("D307 §3 — the second attack, which a fragment-keyed census would not see", () => {
  it("Eevee's index 1 is Quick Attack and is NOT this program", () => {
    // D306's lesson as an assertion. `sv06-135` prints TWO attacks; a slice that
    // read only the matching arm would have carried "one attack" into a per-index
    // claim, which is the exact error D277 made on this family.
    const parked = declare(attachFromDeck(board(18), "p1", "fix-energy", 2), 1);
    // The coin-flip attack resolves synchronously — no park, no evolution.
    expect(parked.phase.kind).not.toBe("effect:choose");
    expect(topId(parked, "p1")).toBe("sv06-135");
  });
});

describe("D307 §4 — the on-evolve TRIGGER: it must not fire from the deck, and DOES from hand", () => {
  it("🛑 the DECK route fires NO on-evolve trigger", () => {
    // Arboliva `sv01-023` "Enriching Oil" prints *"When you play this Pokémon FROM
    // YOUR HAND to evolve 1 of your Pokémon during your turn, you may heal all
    // damage from 1 of your Pokémon."* The card came out of the DECK, so the
    // printed antecedent is false and the Ability must stay silent.
    let state = board(19);
    state = stripDeck(state, "p1", ["asc-vaporeon", "asc-frail"]);
    state = setDamage(state, "p1", 20);
    const parked = declare(state);
    const prompt = cardsPrompt(parked);
    expect(candidateIds(parked, prompt.candidates).every((id) => id === "sv01-023")).toBe(true);
    const applied = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [prompt.candidates[0] ?? ""] },
    });
    expect(topId(applied.state, "p1")).toBe("sv01-023");
    expect(applied.events.map((event: GameEvent) => event.type)).not.toContain("ABILITY_TRIGGERED");
    // …and no second park: the whole program finished inside the attack.
    expect(applied.state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 THE ATTRIBUTION CONTROL — the SAME card from HAND on the SAME board DOES fire", () => {
    // Without this, "no ABILITY_TRIGGERED" passes just as happily on a fixture
    // whose trigger was never wired up. Same seat, same body, same evolution card;
    // only the SOURCE ZONE differs, which is the entire mechanism this slice added.
    // ⚠️ A LATER TURN THAN THE DECK ROUTE'S, AND THAT ASYMMETRY IS THE §4 BAN
    // ITSELF: playing a Pokémon from hand to evolve is barred on a player's first
    // turn, while the ATTACK above is not (it never touches the hand). The control
    // therefore has to be run on a turn the hand route is legal on — which is one
    // more piece of evidence that these are two different acts.
    let state = passTo(board(19), 4);
    state = setDamage(state, "p1", 20);
    state = handFromDeck(state, "p1", "sv01-023", 1);
    const uid = handUid(state, "p1", "sv01-023");
    const applied = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    expect(topId(applied.state, "p1")).toBe("sv01-023");
    expect(applied.events.map((event: GameEvent) => event.type)).toContain("ABILITY_TRIGGERED");
  });
});

describe("D307 §5 — the LETHAL evolve: §8.1 sweeps it, and the attack still finishes", () => {
  it("🛑 an evolution that drops max HP below the carried damage is Knocked Out", () => {
    // D306 flagged *"the KO tail is nearly free in an attack context"* as its own
    // most-likely-wrong claim and asked for this board by name: the evolve is
    // LETHAL and the attack continues past it. Eevee (50 HP) + Bravery Charm
    // `sv02-173` (+50 for a BASIC) survives 100 damage; `asc-frail` is a 60-HP
    // Stage 1, so the charm falls off and the body is lethal the instant it lands.
    let state = board(20);
    state = handFromDeck(state, "p1", "sv02-173", 1);
    const charm = handUid(state, "p1", "sv02-173");
    state = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: charm,
      target: { spot: "active" },
    }).state;
    state = setDamage(state, "p1", 100);
    state = stripDeck(state, "p1", ["asc-vaporeon", "sv01-023"]);
    // The charmed Basic is ALIVE before the attack — the control that makes the
    // Knock Out below attributable to the EVOLUTION and not to the damage.
    expect(state.players.p1.active?.damage).toBe(100);
    const parked = declare(state);
    const prompt = cardsPrompt(parked);
    const done = resolve(parked, [prompt.candidates[0] ?? ""]);
    // A self-KO prizes to the DEFENDER, exactly as the confusion self-hit's does.
    expect(done.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2" });
  });

  it("…and the trailing shuffleDeck still ran — the program was not abandoned", () => {
    // The other half of the doubt: a KO that happens MID-program must not stop the
    // ops behind it. The deck is shuffled after the pick, so the op AFTER the
    // lethal placement ran on a board holding a dead body and did not throw.
    let state = board(21);
    state = handFromDeck(state, "p1", "sv02-173", 1);
    const charm = handUid(state, "p1", "sv02-173");
    state = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: charm,
      target: { spot: "active" },
    }).state;
    state = setDamage(state, "p1", 100);
    state = stripDeck(state, "p1", ["asc-vaporeon", "sv01-023"]);
    const parked = declare(state);
    const before = [...parked.players.p1.deck];
    const applied = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [cardsPrompt(parked).candidates[0] ?? ""] },
    });
    expect(applied.events.map((event: GameEvent) => event.type)).toContain("SHUFFLE");
    // The deck is the same MULTISET minus the taken card, in a different order.
    expect(applied.state.players.p1.deck.length).toBe(before.length - 1);
  });
});

describe("D307 §6 — the persisted shape: the op and the dest reach the phase", () => {
  it("the parked continuation stores the new op, and the prompt the new dest", () => {
    // 🛑 THIS IS THE `MATCH_RECORD_VERSION` ARGUMENT, DRIVEN — AND IT COMES OUT A
    // RECORDED **SKIP**, WHICH IS THE OPPOSITE OF WHAT THIS SLICE PREDICTED.
    // A saved match holds `phase.cont.pendingOp` and `phase.prompt`, and both
    // gain a value here that they could not hold before. That is the direction
    // the version does NOT protect: `readMatchRecord` gates a record written by an
    // OLDER deploy, and no version-17 deploy could author `evolveFromDeck` or
    // `dest: "evolve"` — which is D125's condition, and word for word the argument
    // `match.ts` already records about `returnBenched` at D299. Nothing else
    // persisted moved (the `GameState` key list below is the anchor for that), so
    // the constant stays 17 and this rung is what says why.
    const parked = declare(board(22));
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error(`expected a park, got ${phase.kind}`);
    expect(phase.cont.pendingOp).toEqual({ op: "evolveFromDeck" });
    expect(phase.cont.rest).toEqual([{ op: "shuffleDeck" }]);
    if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(phase.prompt.dest).toBe("evolve");
    // …and the whole phase is JSON, which is what makes the record replayable.
    expect(JSON.parse(JSON.stringify(phase)).cont.pendingOp.op).toBe("evolveFromDeck");
  });

  it("no `GameState` key moved — the literal anchor behind the recorded SKIP", () => {
    // D279's half-guard rule: a "nothing else persisted moved" claim is only worth
    // anything if the key list is spelled out, so that ADDING a key here reddens
    // by name instead of the sentence above quietly going stale. Read off a real
    // PARKED board, so the phase's own shape is inside the snapshot being anchored.
    const parked = declare(board(24));
    expect(Object.keys(parked).sort()).toEqual([
      "allowances",
      "cardIdByUid",
      "cardPool",
      "firstPlayer",
      "handPlayLockedTurn",
      "lastKoMarks",
      "lastKoTurn",
      "oncePerGameSpent",
      "pending",
      "phase",
      "players",
      "rngState",
      "stadium",
      "turn",
    ]);
  });

  it("the wire REFUSES a card that is not on the offer", () => {
    // `validateChoice` reads the PROMPT, never the op — so a crafted frame naming
    // a deck card that does not evolve from this body is rejected before the
    // placement is reached.
    const parked = declare(board(23));
    const stranger = parked.players.p1.deck.find(
      (uid) => parked.cardIdByUid[uid] === "asc-exeggutor",
    );
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [stranger ?? ""] },
    });
    expect(rejected.ok).toBe(false);
  });
});
