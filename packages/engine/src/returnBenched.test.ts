import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, programFor, topUid } from "./index";
import type { GameState, Seat } from "./index";
import { logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";
import { otherSeat } from "./types";

// 0.209.0 → 0.210.0 — D299: `returnBenched`, THE FIRST OP THAT UNMAKES AN IN-PLAY
// BODY OUTSIDE THE KO PATH — and the end of Illumise `sv06-010`'s five-slice
// refusal.
//
// ── WHAT WAS REFUSED, AND WHAT THE BODIES ACTUALLY SAID ─────────────────────
//
// D294, D295, D296 and D297 all recorded the same blocker: *"MISSING: CODE — an
// op that unmakes an IN-PLAY body … §10 stacks only grow and KO is the one
// teardown."* D298 finally read `knockOut` and RE-TYPED it as **MISSING
// COMPOSITION**, naming three shipped parts — `discardFromStack(side, pokemon,
// "all")` for the teardown, `knockOut`'s bench splice for the removal,
// `shuffleDeck` for the shuffle — and then, to its credit, **flagged that very
// sentence as its most-likely-wrong claim**, named the doubt (*"that function
// appends to `side.discard` INSIDE ITSELF"*) and named the artefact that would
// settle it: `git grep -n "discardFromStack(" -- packages/engine/src`.
//
// 🛑 **THE GREP WAS RUN AND THE FLAG WAS RIGHT TO DOUBT ITSELF.** Its 8 hits are
// THREE overload signatures of one function, TWO mentions inside doc comments
// (flow.ts's `koTrigger` note and index.ts's D283 paragraph) and **THREE real
// call sites**: `knockOut`'s Active branch, `knockOut`'s benched branch, and
// `turn.ts`'s retreat cost. **A GREP COUNT IS NOT A CALL-SITE COUNT** — the
// difference here is 8 against 3, and D298 priced a defaulted parameter against
// the 8.
//
// 🛑 **AND THE ANSWER TO ITS OWN QUESTION CUTS THE OTHER WAY FROM THE WAY IT SAID
// IT WOULD.** The flag reasoned: *"if no caller wants another destination, a
// defaulted parameter is honest and the composition claim holds."* No caller
// wants another destination — and that is an argument **against** the parameter,
// not for it: a field with exactly one user, on a helper whose NAME says
// `discard`, describing a move that discards nothing. What is genuinely reusable
// is ONE LINE — `[...stack, ...energy, ...tools]`, the definition of "and all
// attached cards" — now extracted as `types.ts` `stackUids` and called by
// `discardFromStack` as well. So the honest type is **missing CODE with one of
// its parts already written**, and the bench splice is COPIED from `knockOut`
// rather than shared (§8.1's "no gap, no promotion" is a fact about the BENCH).
//
// ── THE POPULATION, WHICH IS SIX AND NOT ONE ────────────────────────────────
//
// Remote D1 `luminous` (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 2026-08-09,
// `instr(attacks_json, 'and all attached cards into') > 0` over all 3,786 rows:
// **27 rows, 15 of them `legal_standard = 1`**. Six of the fifteen are this op:
//
//   • *"Shuffle 1 of your Benched Pokémon and all attached cards into your
//     deck."* — Chimecho `sv06-085` / `sv06-179` (2). OWN bench, OWN deck.
//   • *"Put 1 of your Benched Pokémon and all attached cards into your hand."* —
//     Swoobat `sv10.5w-037` / `sv10.5w-120` (2). OWN bench, OWN hand.
//   • *"Flip a coin. If heads, choose 1 of your opponent's Benched Pokémon.
//     Shuffle that Pokémon and all attached cards into their deck."* — Sylveon
//     `svp-172` / `sv06.5-022` (2), through the `coinFlipGate` that has existed
//     since D126.
//   • *"You can use this attack only if you go second, and only during your first
//     turn. Shuffle 1 of your opponent's Benched Pokémon and all attached cards
//     into their deck."* — Illumise `sv06-010` (1), whose gate clause D282's
//     `splitAttackGateClause` takes off the front before any reader sees it.
//
// ⚠️ **THE BACKLOG CELL SAID 1 AND FIVE HANDOFFS PRICED IT AT 1.** Querying the
// SENTENCE rather than the CARD is what found the other five, which is D298's own
// census lesson arriving on the row it wrote the lesson for.
//
// 🛑 **AND THE NINE LEGAL PRINTINGS THIS OP DOES NOT REACH ARE REFUSED ON NINE
// DIFFERENT WORDS, NOT ON THIS VOCABULARY** — §1's warrants below name each.
//
// ── WHAT THIS COSTS, AND WHAT IT DOES NOT ───────────────────────────────────
//
// ONE op, ONE `^…$` anchor over four whole sentences, ONE event
// (`POKEMON_RETURNED`), ONE extraction (`stackUids`), ONE log row. **ZERO** diff
// in `packages/schema`, `redact.ts` and `src/`: the op parks a `choosePokemon`,
// which every surface has rendered since M4. NO registry row — Illumise keeps the
// bare `attackGate` D281 gave it — so `raw.length`, the non-attack pool and the
// non-attack decomposition all move by ZERO for +7 printings.
//
// `BUILT.attack` 1144 → **1151** (raw 297 → 300 sentences / 1,130 → 1,136
// printings, +4 registry, **split 10 → 11**). ⚠️ **BOTH NON-REGISTRY SUMMANDS
// MOVE AT ONCE**, which no slice in this run had done, and the split term moves
// for the first time since D283 — on the one printing five handoffs said was the
// only one that could move it.
//
// 🛑 §5 — `MATCH_RECORD_VERSION` 16 → **17**, AND IT IS **D298's DEBT**. See that
// section: the field it gates shipped a slice ago without it.

const CHIMECHO_TEXT = "Shuffle 1 of your Benched Pokémon and all attached cards into your deck.";
const SWOOBAT_TEXT = "Put 1 of your Benched Pokémon and all attached cards into your hand.";
const ILLUMISE_BODY =
  "Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.";
const ILLUMISE_TEXT = `You can use this attack only if you go second, and only during your first turn. ${ILLUMISE_BODY}`;
const SYLVEON_TEXT =
  "Flip a coin. If heads, choose 1 of your opponent's Benched Pokémon. Shuffle that Pokémon and all attached cards into their deck.";

const SELF_DECK: EffectOp = { op: "returnBenched", whose: "self", dest: "deck" };
const SELF_HAND: EffectOp = { op: "returnBenched", whose: "self", dest: "hand" };
const FOE_DECK: EffectOp = { op: "returnBenched", whose: "opponent", dest: "deck" };

/** Chimecho `sv06-085`/`-179` — idx 1 is the printed sentence; idx 0 is a plain
    20 so a board can attack WITHOUT the effect when a control needs one. */
function chimecho(id: string): Card {
  return battler(id, {
    name: "Chimecho",
    hp: 70,
    retreat: 1,
    types: ["Psychic"],
    attacks: [
      { cost: ["Psychic"], name: "Hyper Voice", damage: 20 },
      { cost: ["Colorless", "Colorless"], name: "Homeward Chime", effect: CHIMECHO_TEXT },
    ],
  });
}

/** Swoobat `sv10.5w-037`/`-120` — the HAND destination, at idx 0. */
function swoobat(id: string): Card {
  return battler(id, {
    name: "Swoobat",
    hp: 90,
    retreat: 1,
    types: ["Psychic"],
    attacks: [
      { cost: ["Colorless"], name: "Happy Return", effect: SWOOBAT_TEXT },
      { cost: ["Colorless", "Colorless"], name: "Gust", damage: 50 },
    ],
  });
}

/** Illumise `sv06-010` — the GATED printing, whose registry row (`attackGate`
    idx 0, `onlyIf` youGoSecond ∧ yourFirstTurn) has been shipped since D281 and
    is NOT re-authored here: this suite drives the row that is in the tree. */
const ILLUMISE: Card = battler("sv06-010", {
  name: "Illumise",
  hp: 60,
  retreat: 1,
  types: ["Grass"],
  attacks: [
    { cost: ["Colorless"], name: "Slowing Perfume", effect: ILLUMISE_TEXT },
    { cost: ["Grass", "Colorless"], name: "Glide", damage: 30 },
  ],
});

/** Sylveon `sv06.5-022` — the coin-gated spelling, at idx 0. */
const SYLVEON: Card = battler("sv06.5-022", {
  name: "Sylveon",
  hp: 110,
  retreat: 1,
  types: ["Psychic"],
  // ⚠️ COST {C} RATHER THAN THE PRINTED {P} — the fixture deck stocks one Energy
  // card and this suite drives the EFFECT, not the §6 cost table (which
  // `attackRequirement.test.ts` owns). Stated because a fixture that quietly
  // differs from the print is exactly what D154's sweep exists to catch.
  attacks: [{ cost: ["Colorless"], name: "Mystical Return", effect: SYLVEON_TEXT }],
});

const LOCAL_CARDS: Record<string, Card> = {
  "sv06-085": chimecho("sv06-085"),
  "sv06-179": chimecho("sv06-179"),
  "sv10.5w-037": swoobat("sv10.5w-037"),
  "sv10.5w-120": swoobat("sv10.5w-120"),
  "sv06-010": ILLUMISE,
  "sv06.5-022": SYLVEON,
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The FOURTEENTH seeded deck (D270's rule: a seeded suite gets its OWN deck).
    `fix-tool` is stocked because the printed clause is "and all attached CARDS",
    and a body wearing only Energy would leave the Tool half of `stackUids`
    unwitnessed. */
const RETURN_DECK = deckOf({
  "sv06-085": 4,
  "sv06-179": 2,
  "sv10.5w-037": 4,
  "sv10.5w-120": 2,
  "sv06-010": 4,
  "sv06.5-022": 2,
  "fix-basic-1": 12,
  "fix-victim": 6,
  "fix-tool": 4,
  "fix-energy": 20,
});

const SEEDS = [4_299_001, 4_299_002, 4_299_003, 4_299_004] as const;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: RETURN_DECK, p2: RETURN_DECK }, cardPool: POOL });
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

/** p1 has `activeId` Active with two Energy on it and `ownBench` bodies benched;
    p2 has `foeBench` benched. `first`/`passes` let the gated printing reach its
    one legal board (p1 going SECOND, attacking on turn 2).
    ⚠️ p1 ALWAYS keeps at least one benched body of its own where the sentence
    does not consume it — §14.2 makes an empty Bench a LOSS the moment the Active
    leaves, and a `gameOver` board proves nothing about a zone transfer. */
function board(
  seed: number,
  activeId: string,
  ownBench: number,
  foeBench: number,
  first: Seat = "p2",
  passes = 1,
): GameState {
  let state = localSetup(seed, first);
  for (let i = 0; i < passes; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  if (state.phase.kind !== "turn:action" || state.phase.seat !== "p1") {
    throw new Error(`expected p1 on turn, got ${JSON.stringify(state.phase)}`);
  }
  state = setActiveFromDeck(state, "p1", activeId);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (let i = 0; i < ownBench; i += 1) state = benchFromDeck(state, "p1", "fix-basic-1");
  for (let i = 0; i < foeBench; i += 1) state = benchFromDeck(state, "p2", "fix-victim");
  return attachFromDeck(state, "p1", "fix-energy", 2);
}

function swing(state: GameState, index: number) {
  const result = applyAction(state, { type: "attack", seat: "p1", index });
  if (!result.ok) throw new Error(`attack refused: ${result.error.code}`);
  return result;
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR — four printed spellings, and the neighbourhood it refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("D299 §1 — the anchor reads exactly the four printed spellings", () => {
  it("each spelling derives the op its possessive and its destination name", () => {
    expect(deriveAttackEffect(CHIMECHO_TEXT)).toEqual([SELF_DECK]);
    expect(deriveAttackEffect(SWOOBAT_TEXT)).toEqual([SELF_HAND]);
    expect(deriveAttackEffect(ILLUMISE_BODY)).toEqual([FOE_DECK]);
    // The coin-gated spelling is the SAME op behind D126's gate, not a fifth
    // member — the printed "choose … that Pokémon" is what every other spelling
    // leaves to the park.
    expect(deriveAttackEffect(SYLVEON_TEXT)).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      { op: "coinFlipGate", then: [FOE_DECK] },
    ]);
  });

  it("🛑 the CURLY apostrophe reads the same as the ASCII one, on both possessives", () => {
    // D136/D137's class, and the pool holds ZERO U+2019 — so a re-ingest is the
    // only way one arrives, and this is the assertion that would survive it.
    const curly = ILLUMISE_BODY.replace("opponent's", `opponent${"’"}s`);
    expect(curly).not.toBe(ILLUMISE_BODY);
    expect(deriveAttackEffect(curly)).toEqual([FOE_DECK]);
    const curlySylveon = SYLVEON_TEXT.replace("opponent's", `opponent${"’"}s`);
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
    expect(deriveAttackEffect(curlySylveon)).toEqual([{ op: "coinFlipGate", then: [FOE_DECK] }]);
  });

  it("🛑 refuses the NINE legal printings it does not reach, each on its own word", () => {
    for (const text of [
      // ① "this Pokémon" — the ATTACKER, which is Active. Taking the Active off
      // the board owes a §8.1-style PROMOTION stage, and only `knockOut` returns
      // `PendingStage`s; no `EffectOp` can queue one. Lillie's Comfey `sv09-068`.
      "Put this Pokémon and all attached cards into your hand.",
      // ② …the deck spelling of the same refusal, with a search behind an "If you
      // do". Eldegoss `sv07-011`.
      "Put this Pokémon and all attached cards into your deck. If you do, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
      // ③ …and the two that hang it off a damage decision. Poliwrath `sv06-043`,
      // Gholdengo `sv08-131`.
      "You may do 120 more damage. If you do, shuffle this Pokémon and all attached cards into your deck.",
      "You may shuffle this Pokémon and all attached cards into your deck.",
      // ④ TWO of them at once, plus a per-attack-name history rider. Sylveon ex
      // `sv08-086`/`sv08.5-041`/`-156` (3 printings) — a COUNT this op does not
      // carry and D277's stamp, on one card. 🆕🆕 **D396 BUILT THE RIDER AND THIS
      // LINE STILL HOLDS**: the history clause is now a registry `attackGate` on
      // all three ids, enforced at the §8 declaration seam, and no split is
      // authored for it — so the WHOLE printed string is still what reaches this
      // reader, and the COUNT is still what refuses it.
      "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.",
      // ⑤ the DISCARD destination, which is `discardFromStack`'s and not this
      // op's — and which names the Active besides.
      "Discard this Pokémon and all attached cards.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("🛑 refuses the MISMATCHED possessive/destination pairs no card prints", () => {
    // The alternation is four WHOLE sentences rather than two captures crossed,
    // and this is what that buys: a sentence that shuffles the opponent's body
    // into YOUR deck is not printed anywhere, and a two-capture reader would have
    // happily built it.
    for (const text of [
      "Shuffle 1 of your opponent's Benched Pokémon and all attached cards into your deck.",
      "Shuffle 1 of your Benched Pokémon and all attached cards into their deck.",
      // …and the verb/destination swap: nothing is "put" into a deck or
      // "shuffled" into a hand in this family.
      "Put 1 of your Benched Pokémon and all attached cards into your deck.",
      "Shuffle 1 of your Benched Pokémon and all attached cards into your hand.",
      // …the ACTIVE noun in place of the Benched one (Spidops `sv02-018`'s shape,
      // and `legal_standard = 0` besides).
      "Shuffle 1 of your opponent's Active Pokémon and all attached cards into their deck.",
      // …and leading/trailing text, the standing `^…$` guard.
      `${ILLUMISE_BODY} Then, draw a card.`,
      `Draw a card. ${ILLUMISE_BODY}`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("🛑 the GATED printing is refused WHOLE and read only through D282's split", () => {
    // The split's safety argument, restated on the printing that finally uses it:
    // the compound is refused, the body is read, and the two facts together are
    // what make `censusAtHead`'s split term 11 rather than a double count.
    expect(deriveAttackEffect(ILLUMISE_TEXT)).toBeNull();
    const split = splitAttackGateClause(ILLUMISE_TEXT);
    expect(split?.body).toBe(ILLUMISE_BODY);
    expect(deriveAttackEffect(split?.body ?? "")).toEqual([FOE_DECK]);
    // …and the registry row that licenses the split is the one D281 authored —
    // this suite asserts it rather than re-authoring it.
    expect(programFor("sv06-010")?.attackGate?.[0]?.kind).toBe("onlyIf");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE POPULATION — six printings, counted off the committed corpus.
// ─────────────────────────────────────────────────────────────────────────────

describe("D299 §2 — the population is six, and it is the corpus that says so", () => {
  it("the three UNGATED sentences carry 6 printings between them", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(corpus.get(CHIMECHO_TEXT)).toBe(2);
    expect(corpus.get(SWOOBAT_TEXT)).toBe(2);
    expect(corpus.get(SYLVEON_TEXT)).toBe(2);
    // …and the GATED one is a seventh printing that the raw sweep cannot see.
    expect(corpus.get(ILLUMISE_TEXT)).toBe(1);
    expect(corpus.get(ILLUMISE_BODY)).toBeUndefined();
  });

  it("🛑 the ATTRIBUTION CONTROL — every corpus sentence this op claims is one of the four", () => {
    // D214's control, pointed at the new anchor. Without it a loosened alternation
    // could claim a neighbour and every count above would still be green.
    const claimed = legalAttackCorpus()
      .filter(([, text]) => {
        const ops = deriveAttackEffect(splitAttackGateClause(text)?.body ?? text);
        return ops?.some((op) => op.op === "returnBenched" || op.op === "coinFlipGate") === true;
      })
      .map(([, text]) => text);
    const mine = claimed.filter((text) => {
      const ops = deriveAttackEffect(splitAttackGateClause(text)?.body ?? text) ?? [];
      const flat = ops.flatMap((op) => (op.op === "coinFlipGate" ? op.then : [op]));
      return flat.some((op) => op.op === "returnBenched");
    });
    expect(new Set(mine)).toEqual(
      new Set([CHIMECHO_TEXT, SWOOBAT_TEXT, SYLVEON_TEXT, ILLUMISE_TEXT]),
    );
    expect(mine.length).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE MOVE — driven off the printed attacks, on all three destinations.
// ─────────────────────────────────────────────────────────────────────────────

describe("D299 §3 — the body and everything on it leave the board together", () => {
  it("CHIMECHO: the OWN bench body, with its Energy and its Tool, into the OWN deck", () => {
    // Two of p1's own benched bodies, so the pick is a real decision; the FIRST
    // one wears an Energy and a Tool, which is the "and all attached cards" half.
    let state = board(SEEDS[0], "sv06-085", 2, 0);
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1);
    state = attachToolFromDeck(state, "p1", 0, "fix-tool");
    const target = state.players.p1.bench[0];
    if (target === undefined) throw new Error("no benched body");
    const whole = [...target.stack, ...target.energy, ...target.tools];
    expect(whole).toHaveLength(3);
    const survivorUid = topUid(state.players.p1.bench[1] as NonNullable<typeof target>);

    const { state: parked } = swing(state, 1);
    // A two-body Bench is a DECISION, so this parks rather than forcing.
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "choosePokemon") {
      throw new Error(`expected a choosePokemon park, got ${parked.phase.kind}`);
    }
    expect(parked.phase.prompt.candidates).toHaveLength(2);
    expect(parked.phase.prompt.note).toBe("Shuffle which of your Benched Pokémon into your deck?");

    const answered = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    const after = answered.state;
    const returned = find(answered.events, "POKEMON_RETURNED");
    expect(returned?.seat).toBe("p1");
    expect(returned?.actor).toBe("p1");
    expect(returned?.dest).toBe("deck");
    // 🛑 ALL THREE CARDS, not just the Pokémon. This is the assertion the printed
    // sentence is actually about, and the one a "shuffle the top card back" build
    // would fail while every board-shape assertion below stayed green.
    expect(new Set(returned?.uids)).toEqual(new Set(whole));
    for (const uid of whole) expect(after.players.p1.deck).toContain(uid);
    // The bench compacted around the hole (knockOut's splice), and the survivor is
    // the body that was at index 1.
    expect(after.players.p1.bench).toHaveLength(1);
    expect(topUid(after.players.p1.bench[0] as NonNullable<typeof target>)).toBe(survivorUid);
    // …and the deck was really shuffled, with the SHUFFLE row naming the owner.
    expect(find(answered.events, "SHUFFLE")?.seat).toBe("p1");
  });

  it("SWOOBAT: the same body into the OWN HAND, and NO shuffle", () => {
    let state = board(SEEDS[1], "sv10.5w-037", 2, 0);
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1);
    const target = state.players.p1.bench[0];
    if (target === undefined) throw new Error("no benched body");
    const whole = [...target.stack, ...target.energy, ...target.tools];
    expect(whole).toHaveLength(2);

    const { state: parked } = swing(state, 0);
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "choosePokemon") {
      throw new Error(`expected a choosePokemon park, got ${parked.phase.kind}`);
    }
    expect(parked.phase.prompt.note).toBe("Put which of your Benched Pokémon into your hand?");
    const answered = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    expect(find(answered.events, "POKEMON_RETURNED")?.dest).toBe("hand");
    for (const uid of whole) expect(answered.state.players.p1.hand).toContain(uid);
    // 🛑 NO SHUFFLE — a hand has no order to hide, and the printed verb is "Put".
    // This is the whole behavioural content of the `dest` field.
    expect(find(answered.events, "SHUFFLE")).toBeUndefined();
    // …and the deck did not receive it either, which is the other half of the same
    // claim (a build that shuffled into the deck AND appended to the hand would
    // satisfy the line above).
    for (const uid of whole) expect(answered.state.players.p1.deck).not.toContain(uid);
  });

  it("ILLUMISE: the OPPONENT's benched body into the OPPONENT's deck, forced on a lone Bench", () => {
    // p1 goes SECOND and attacks on turn 2 — the only board the `onlyIf` gate
    // admits. ONE body on p2's Bench, so `parkOrForce` forces it.
    const state = board(SEEDS[2], "sv06-010", 1, 1);
    const victim = state.players.p2.bench[0];
    if (victim === undefined) throw new Error("no benched victim");
    const uid = topUid(victim) as string;
    const { state: after, events } = swing(state, 0);
    expect(after.pending).toHaveLength(0);
    const returned = find(events, "POKEMON_RETURNED");
    // 🛑 THE OWNER IS THE REF'S SEAT AND THE ACTOR IS THE CONTROLLER — the whole
    // reason this is one op rather than a cross-seat special case.
    expect(returned?.seat).toBe("p2");
    expect(returned?.actor).toBe("p1");
    expect(returned?.uids).toEqual([uid]);
    expect(after.players.p2.bench).toHaveLength(0);
    expect(after.players.p2.deck).toContain(uid);
    expect(find(events, "SHUFFLE")?.seat).toBe("p2");
    // p1's own board is untouched — the possessive is doing the work.
    expect(after.players.p1.bench).toHaveLength(1);
  });

  it("🛑 an EMPTY opposing Bench is a silent no-op, NOT a skipped effect", () => {
    // Illumise attacks on the first turn going second, when an empty opposing
    // Bench is the ordinary board. An effect that ran and found nothing is not an
    // effect the engine could not read, and the loud path must not claim it.
    const state = board(SEEDS[2], "sv06-010", 1, 0);
    const { state: after, events } = swing(state, 0);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(find(events, "POKEMON_RETURNED")).toBeUndefined();
    expect(find(events, "SHUFFLE")).toBeUndefined();
    expect(after.pending).toHaveLength(0);
    expect(after.players.p2.bench).toHaveLength(0);
  });

  it("SYLVEON: the coin decides, and TAILS moves nothing at all", () => {
    // The same op behind D126's gate. Both faces are driven off seeded boards
    // rather than argued, and the two are asserted as a PAIR: a gate that ran its
    // branch on both faces would satisfy either one alone.
    const faces = new Map<string, { returned: boolean; bench: number }>();
    for (const seed of SEEDS) {
      const state = board(seed, "sv06.5-022", 1, 1, "p2", 3);
      const { state: after, events } = swing(state, 0);
      const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
      if (flip === undefined) throw new Error("no coin flip");
      faces.set(flip.result, {
        returned: find(events, "POKEMON_RETURNED") !== undefined,
        bench: after.players.p2.bench.length,
      });
    }
    expect(faces.get("heads")).toEqual({ returned: true, bench: 0 });
    expect(faces.get("tails")).toEqual({ returned: false, bench: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE LOG ROW — attributed to the ACTOR, and it counts what went along.
// ─────────────────────────────────────────────────────────────────────────────

describe("D299 §4 — the log names the body and counts the rest", () => {
  it("the row is filed under the ACTOR even when the Pokémon is the opponent's", () => {
    const state = board(SEEDS[2], "sv06-010", 1, 1);
    const withEnergy = attachBenchFromDeck(state, "p2", 0, "fix-energy", 2);
    const { state: after, events } = swing(withEnergy, 0);
    const entries = logFromEvents(events, {
      names: { p1: "Ana", p2: "Ben" },
      state: after,
      elapsed: "+00:10",
    });
    const line = entries.find((entry) =>
      entry.kind === "action"
        ? entry.segments.some((seg) => seg.text.includes("into Ben's deck"))
        : false,
    );
    if (line === undefined || line.kind !== "action") throw new Error("no POKEMON_RETURNED row");
    // 🛑 THE ACTOR, not the owner. A row filed under p2 would read as something
    // Ben chose to do to his own board.
    expect(line.who).toBe("p1");
    const text = line.segments.map((s) => s.text).join("");
    expect(text).toContain("shuffled ");
    expect(text).toContain("and 2 attached cards");
    expect(text).toContain("into Ben's deck");
  });

  it("a bare body says nothing about attachments, and the HAND row says 'put'", () => {
    let state = board(SEEDS[1], "sv10.5w-037", 1, 0);
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1);
    const { state: after, events } = swing(state, 0);
    const text = logFromEvents(events, {
      names: { p1: "Ana", p2: "Ben" },
      state: after,
      elapsed: "+00:10",
    })
      .flatMap((entry) => (entry.kind === "action" ? entry.segments.map((seg) => seg.text) : []))
      .join("");
    expect(text).toContain("put ");
    // ONE attachment — the singular, which is the arm a `${n} cards` template
    // would get wrong on every board with exactly one Energy.
    expect(text).toContain("and 1 attached card into Ana's hand");
    expect(text).not.toContain("1 attached cards");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 🛑 MATCH_RECORD_VERSION 16 → 17 — D298's DEBT, DRIVEN BOTH DIRECTIONS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D299 §5 — the persisted shape, and the bump a slice ago never made", () => {
  it("🛑 a version-16 bag (no `oncePerGameSpent`) THROWS by name on a Knock Out", () => {
    // 🛑 **THIS IS NOT THIS SLICE'S FIELD.** `GameState.oncePerGameSpent` landed at
    // D298 (commit `794f7c5`) and `MATCH_RECORD_VERSION` did not move with it —
    // D298's own handoff records the bump as DONE and driven, and `git log -S`
    // finds no commit that ever wrote 17. The replay was run; the edit never
    // landed. D299 paid it, and this is the drive re-run against the tree.
    //
    // The shape is D283's, not D285's: `onKoPrize` (flow.ts) reads
    // `next.oncePerGameSpent[ref.seat]` and INDEXES TWICE, before the latch is
    // even consulted, so the throw is unconditional on any rider being present.
    const state = board(SEEDS[0], "sv06-085", 1, 1);
    const { oncePerGameSpent: _dropped, ...v16 } = state;
    expect("oncePerGameSpent" in v16).toBe(false);
    // The read is `state.oncePerGameSpent[seat]`, so the failure is a TypeError on
    // an undefined index — named, not merely "it throws".
    expect(() => (v16 as GameState).oncePerGameSpent.p1).toThrow(TypeError);
  });

  it("🛑 the LITERAL key anchor — the whole GameState key list, spelled out", () => {
    // D279's rule: a diff between two boards from one build is a half-guard,
    // blind to "every board grew a key". So the diff is PAIRED with a literal.
    // ⚠️ THIS LIST INCLUDES `oncePerGameSpent` — the tenth suite to carry the
    // anchor since D298, and the first written after the bump it forced.
    const state = board(SEEDS[0], "sv06-085", 1, 1);
    expect(Object.keys(state).sort()).toEqual([
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

  it("the SAME board round-trips through JSON with the key intact", () => {
    const state = board(SEEDS[0], "sv06-085", 1, 1);
    const round = JSON.parse(JSON.stringify(state)) as GameState;
    expect(round.oncePerGameSpent).toEqual({ p1: [], p2: [] });
    expect(round).toEqual(state);
  });

  it("🛑 D299's OWN additions would NOT have moved the version, and that is stated", () => {
    // A union widening (D125) and a new event (D141) — no `GameState` key, no
    // `InPlayPokemon` key, no `PlayerSide` key. The op moves cards between zones
    // that already exist and stamps nothing, so a v16 record carrying no
    // `POKEMON_RETURNED` row and no `returnBenched` continuation renders and
    // resumes exactly as it did. The BOARD is the witness: the returned body's
    // departure is visible entirely in `bench` / `deck` / `hand`.
    const state = board(SEEDS[2], "sv06-010", 1, 1);
    const before = Object.keys(state.players.p2).sort();
    const { state: after } = swing(state, 0);
    expect(Object.keys(after.players.p2).sort()).toEqual(before);
    const victim = state.players.p2.bench[0];
    if (victim === undefined) throw new Error("no benched victim");
    expect(Object.keys(victim).length).toBeGreaterThan(0);
    // …and the seat that lost the body gained NO new key to record it with.
    expect(before).not.toContain("returned");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE SHIELD — the opponent arm asks, the own arm does not.
// ─────────────────────────────────────────────────────────────────────────────

describe("D299 §6 — a shielded opposing body is not offered", () => {
  it("🛑 the OWN-board arm offers every benched body, shield or no shield", () => {
    // The asymmetry is `gust`'s and it is deliberate: no printed shield in this
    // pool guards its controller against its controller. The witness is the
    // candidate COUNT on a board where the own-arm and the opponent-arm see the
    // same number of bodies.
    const state = board(SEEDS[0], "sv06-085", 2, 2);
    const { state: parked } = swing(state, 1);
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "choosePokemon") {
      throw new Error(`expected a choosePokemon park, got ${parked.phase.kind}`);
    }
    for (const ref of parked.phase.prompt.candidates) expect(ref.seat).toBe("p1");
    expect(parked.phase.prompt.candidates).toHaveLength(2);
  });

  it("the OPPONENT arm's candidates are all on the opponent's Bench", () => {
    const state = board(SEEDS[2], "sv06-010", 1, 2);
    const { state: parked } = swing(state, 0);
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "choosePokemon") {
      throw new Error(`expected a choosePokemon park, got ${parked.phase.kind}`);
    }
    expect(parked.phase.prompt.candidates).toHaveLength(2);
    for (const ref of parked.phase.prompt.candidates) {
      expect(ref.seat).toBe("p2");
      expect(ref.spot.spot).toBe("bench");
    }
    expect(parked.phase.prompt.note).toBe(
      "Shuffle which of your opponent's Benched Pokémon into their deck?",
    );
    // …and the answerer is the CONTROLLER: this is p1's pick off p2's board, the
    // `gust` convention rather than `opponentSwitchOut`'s.
    expect(parked.phase.seat).toBe("p1");
  });

  it("🛑 the ATTRIBUTION CONTROL for the whole section — the op really ran", () => {
    // D214: without a positive control every "nothing happened" above passes on a
    // build where the deriver returns null and no program runs at all.
    expect(deriveAttackEffect(ILLUMISE_BODY)).not.toBeNull();
    expect(otherSeat("p1")).toBe("p2");
  });
});
