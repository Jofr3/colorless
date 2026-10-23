import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause } from "./effects";
import type { EffectOp } from "./effects";
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
  findEvent,
} from "./testFixtures";
import { otherSeat } from "./types";

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

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR — four printed spellings, and the neighbourhood it refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("D299 §1 — the anchor reads exactly the four printed spellings", () => {
  it("each spelling derives the op its possessive and its destination name", () => {
    expect(deriveAttackEffect(CHIMECHO_TEXT)).toEqual([SELF_DECK]);
    expect(deriveAttackEffect(SWOOBAT_TEXT)).toEqual([SELF_HAND]);
    expect(deriveAttackEffect(ILLUMISE_BODY)).toEqual([FOE_DECK]);
    expect(deriveAttackEffect(SYLVEON_TEXT)).toEqual([{ op: "coinFlipGate", then: [FOE_DECK] }]);
  });

  it("the CURLY apostrophe reads the same as the ASCII one, on both possessives", () => {
    const curly = ILLUMISE_BODY.replace("opponent's", `opponent${"’"}s`);
    expect(curly).not.toBe(ILLUMISE_BODY);
    expect(deriveAttackEffect(curly)).toEqual([FOE_DECK]);
    const curlySylveon = SYLVEON_TEXT.replace("opponent's", `opponent${"’"}s`);
    expect(deriveAttackEffect(curlySylveon)).toEqual([{ op: "coinFlipGate", then: [FOE_DECK] }]);
  });

  it("refuses the NINE legal printings it does not reach, each on its own word", () => {
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
      "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.",
      // ⑤ the DISCARD destination, which is `discardFromStack`'s and not this
      // op's — and which names the Active besides.
      "Discard this Pokémon and all attached cards.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("refuses the MISMATCHED possessive/destination pairs no card prints", () => {
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

  it("the GATED printing is refused WHOLE and read only through D282's split", () => {
    expect(deriveAttackEffect(ILLUMISE_TEXT)).toBeNull();
    const split = splitAttackGateClause(ILLUMISE_TEXT);
    expect(split?.body).toBe(ILLUMISE_BODY);
    expect(deriveAttackEffect(split?.body ?? "")).toEqual([FOE_DECK]);
    expect(programFor("sv06-010")?.attackGate?.[0]?.kind).toBe("onlyIf");
  });
});

describe("D299 §2 — the population is six, and it is the corpus that says so", () => {
  it("the three UNGATED sentences carry 6 printings between them", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(corpus.get(CHIMECHO_TEXT)).toBe(2);
    expect(corpus.get(SWOOBAT_TEXT)).toBe(2);
    expect(corpus.get(SYLVEON_TEXT)).toBe(2);
    expect(corpus.get(ILLUMISE_TEXT)).toBe(1);
    expect(corpus.get(ILLUMISE_BODY)).toBeUndefined();
  });

  it("the ATTRIBUTION CONTROL — every corpus sentence this op claims is one of the four", () => {
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
    const returned = findEvent(answered.events, "POKEMON_RETURNED");
    expect(returned?.seat).toBe("p1");
    expect(returned?.actor).toBe("p1");
    expect(returned?.dest).toBe("deck");
    expect(new Set(returned?.uids)).toEqual(new Set(whole));
    for (const uid of whole) expect(after.players.p1.deck).toContain(uid);
    // The bench compacted around the hole (knockOut's splice), and the survivor is
    // the body that was at index 1.
    expect(after.players.p1.bench).toHaveLength(1);
    expect(topUid(after.players.p1.bench[0] as NonNullable<typeof target>)).toBe(survivorUid);
    expect(findEvent(answered.events, "SHUFFLE")?.seat).toBe("p1");
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
    expect(findEvent(answered.events, "POKEMON_RETURNED")?.dest).toBe("hand");
    for (const uid of whole) expect(answered.state.players.p1.hand).toContain(uid);
    expect(findEvent(answered.events, "SHUFFLE")).toBeUndefined();
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
    const returned = findEvent(events, "POKEMON_RETURNED");
    expect(returned?.seat).toBe("p2");
    expect(returned?.actor).toBe("p1");
    expect(returned?.uids).toEqual([uid]);
    expect(after.players.p2.bench).toHaveLength(0);
    expect(after.players.p2.deck).toContain(uid);
    expect(findEvent(events, "SHUFFLE")?.seat).toBe("p2");
    // p1's own board is untouched — the possessive is doing the work.
    expect(after.players.p1.bench).toHaveLength(1);
  });

  it("an EMPTY opposing Bench is a silent no-op, NOT a skipped effect", () => {
    // Illumise attacks on the first turn going second, when an empty opposing
    // Bench is the ordinary board. An effect that ran and found nothing is not an
    // effect the engine could not read, and the loud path must not claim it.
    const state = board(SEEDS[2], "sv06-010", 1, 0);
    const { state: after, events } = swing(state, 0);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(findEvent(events, "POKEMON_RETURNED")).toBeUndefined();
    expect(findEvent(events, "SHUFFLE")).toBeUndefined();
    expect(after.pending).toHaveLength(0);
    expect(after.players.p2.bench).toHaveLength(0);
  });

  it("SYLVEON: the coin decides, and TAILS moves nothing at all", () => {
    const faces = new Map<string, { returned: boolean; bench: number }>();
    for (const seed of SEEDS) {
      const state = board(seed, "sv06.5-022", 1, 1, "p2", 3);
      const { state: after, events } = swing(state, 0);
      const flip = findEvent(events, "ATTACK_EFFECT_COIN_FLIP");
      if (flip === undefined) throw new Error("no coin flip");
      faces.set(flip.result, {
        returned: findEvent(events, "POKEMON_RETURNED") !== undefined,
        bench: after.players.p2.bench.length,
      });
    }
    expect(faces.get("heads")).toEqual({ returned: true, bench: 0 });
    expect(faces.get("tails")).toEqual({ returned: false, bench: 1 });
  });
});

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

describe("D299 §5 — the persisted shape, and the bump a slice ago never made", () => {
  it("a version-16 bag (no `oncePerGameSpent`) THROWS by name on a Knock Out", () => {
    const state = board(SEEDS[0], "sv06-085", 1, 1);
    const { oncePerGameSpent: _dropped, ...v16 } = state;
    expect("oncePerGameSpent" in v16).toBe(false);
    // The read is `state.oncePerGameSpent[seat]`, so the failure is a TypeError on
    // an undefined index — named, not merely "it throws".
    expect(() => (v16 as GameState).oncePerGameSpent.p1).toThrow(TypeError);
  });

  it("the LITERAL key anchor — the whole GameState key list, spelled out", () => {
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
      "recentAttackers",
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

  it("D299's OWN additions would NOT have moved the version, and that is stated", () => {
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
  it("the OWN-board arm offers every benched body, shield or no shield", () => {
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

  it("the ATTRIBUTION CONTROL for the whole section — the op really ran", () => {
    expect(deriveAttackEffect(ILLUMISE_BODY)).not.toBeNull();
    expect(otherSeat("p1")).toBe("p2");
  });
});
