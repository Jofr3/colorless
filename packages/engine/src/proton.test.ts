import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, formatElapsed, logFromEvents, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  battler,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  specialEnergy,
  trainerCard,
} from "./testFixtures";

const PROTON_TEXT =
  "If you go first, you may use this card during your first turn.\n\nSearch your deck for up to 3 Basic Team Rocket's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";

const PROTON_IDS = ["sv10-177", "sv10-227"] as const;

/** A Basic in the subgroup — what the search is FOR. */
function subgroupBasic(id: string, name: string): Card {
  return battler(id, { name, hp: 70 });
}

const LOCAL_CARDS: Record<string, Card> = {
  "fix-proton": {
    ...trainerCard("fix-proton", "Supporter", PROTON_TEXT),
    name: "Team Rocket's Proton",
  },
  "fix-tr-meowth": subgroupBasic("fix-tr-meowth", "Team Rocket's Meowth"),
  "fix-tr-mimikyu": subgroupBasic("fix-tr-mimikyu", "Team Rocket's Mimikyu"),
  /** The STAGE negative: in the subgroup, but not Basic. */
  "fix-tr-arbok": battler("fix-tr-arbok", {
    name: "Team Rocket's Arbok",
    hp: 120,
    stage: "Stage1",
    evolveFrom: "Team Rocket's Ekans",
  }),
  /** The CATEGORY negative — sv10-182, the one card in the catalog that carries
      the prefix and is not a Pokémon (`ownerPokemon` requires `category ===
      "Pokemon"` precisely for it). */
  "fix-tr-energy": specialEnergy(
    "fix-tr-energy",
    "Team Rocket's Energy",
    "This card can only be attached to a Team Rocket's Pokémon. If this card is attached to anything other than a Team Rocket's Pokémon, discard this card.\n\nAs long as this card is attached to a Pokémon, it provides 2 in any combination of {P} Energy and {D} Energy.",
  ),
  /** The OWNER negative: a Basic Pokémon in somebody else's subgroup. */
  "fix-cynthia-basic": subgroupBasic("fix-cynthia-basic", "Cynthia's Gible"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const PROTON_DECK = deckOf({
  "fix-proton": 4,
  "sv01-180": 4, // Nemona — the ordinary Supporter, the §4 control
  "fix-tr-meowth": 4,
  "fix-tr-mimikyu": 4,
  "fix-tr-arbok": 4,
  "fix-tr-energy": 4,
  "fix-cynthia-basic": 4,
  "fix-bigbody": 16,
  "fix-energy": 16,
});

const NO_BASIC_DECK = deckOf({
  "fix-proton": 4,
  "sv01-180": 4,
  "fix-tr-arbok": 4,
  "fix-tr-energy": 4,
  "fix-cynthia-basic": 4,
  "fix-bigbody": 20,
  "fix-energy": 20,
});

const OPPONENT_DECK = deckOf({ "fix-bigbody": 30, "fix-basic-1": 4, "fix-energy": 26 });

function localSetup(
  seed: number,
  first: Seat,
  decks: { p1: string[]; p2: string[] } = { p1: PROTON_DECK, p2: OPPONENT_DECK },
): GameState {
  const created = createGame({ seed, decks, cardPool: POOL });
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

/** Turn 1, p1 going first and holding one Proton — the board nearly every case
    below runs on. */
function armed(seed: number, deck: string[] = PROTON_DECK): GameState {
  return handFromDeck(
    localSetup(seed, "p1", { p1: deck, p2: OPPONENT_DECK }),
    "p1",
    "fix-proton",
    1,
  );
}

function playProton(state: GameState, seat: Seat = "p1") {
  return applyAction(state, { type: "playTrainer", seat, uid: handUid(state, seat, "fix-proton") });
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The card ids a chooseCards prompt is offering — what the FILTER admitted,
    named rather than counted. */
function offeredIds(state: GameState): string[] {
  return cardsPrompt(state)
    .candidates.map((uid) => state.cardIdByUid[uid] as string)
    .sort();
}

/** Every uid of `cardId` in the seat's deck, in deck order. */
function inDeck(state: GameState, seat: Seat, cardIds: readonly string[]): string[] {
  const wanted = new Set(cardIds);
  return state.players[seat].deck.filter((uid) => wanted.has(state.cardIdByUid[uid] as string));
}

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });

/** Play Proton and answer its park in one step — the whole card, start to end. */
function playAndTake(state: GameState, take: (parked: GameState) => string[]) {
  const played = mustApply(state, {
    type: "playTrainer",
    seat: "p1",
    uid: handUid(state, "p1", "fix-proton"),
  });
  const answered = resolve(played.state, take(played.state));
  return { parked: played.state, ...answered, events: [...played.events, ...answered.events] };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("D224 — the registry rows", () => {
  it("maps BOTH Standard-legal printings, plus the demonstrator, to ONE object", () => {
    const first = programFor(PROTON_IDS[0]);
    expect(first, "sv10-177 has no program").toBeDefined();
    for (const id of PROTON_IDS) {
      expect(programFor(id), `${id} left Team Rocket's Proton`).toBe(first);
    }
    expect(new Set(PROTON_IDS).size).toBe(2);
    expect(programFor("fix-proton"), "the demonstrator is not Proton").toBe(first);
  });

  it("authors BOTH printed sentences — the flag and the up-to-3 Basic search", () => {
    const program = programFor("sv10-227");
    expect(program?.trainer).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },
        dest: "hand",
        max: 3,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
    expect(program?.trainerFirstTurnExempt).toBe(true);
    // …and nothing else: a `trainerEndsTurn` or a `trainerPlayableIf` here would
    // be a clause this card does not print.
    expect(Object.keys(program ?? {}).sort()).toEqual(["trainer", "trainerFirstTurnExempt"]);
  });

  it("is neither Carmine nor Hop's Bag — the two objects it could have been", () => {
    const proton = programFor("sv10-177");
    expect(proton).not.toBe(programFor("sv06-145"));
    expect(proton).not.toBe(programFor("sv09-147"));
    expect(programFor("sv06-145")?.trainer).toEqual([
      { op: "discardHand" },
      { op: "drawCards", count: 5 },
    ]);
    expect(programFor("sv09-147")?.trainerFirstTurnExempt).toBeUndefined();
    expect(programFor("sv09-147")?.trainer).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "ownerPokemon", owner: "Hop", stage: "basic" },
        dest: "bench",
        max: 2,
      },
      { op: "shuffleDeck" },
    ]);
  });
});

describe("§4 — the exemption D223 bought for another card, spent here", () => {
  it("plays on TURN 1, where both halves of 'if you go first' are real", () => {
    const state = deepFreeze(armed(3));
    expect(state.turn).toBe(1);
    expect(state.firstPlayer).toBe("p1");
    expect(playProton(state).ok, "Proton was refused on the turn it is printed for").toBe(true);
  });

  it("…while the CONTROL Supporter on the SAME board is still refused", () => {
    const state = handFromDeck(armed(3), "p1", "sv01-180", 1);
    const refused = applyAction(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-180"),
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("FIRST_TURN_SUPPORTER");
    // …and Proton is playable on that very board, so the two answers are a
    // DISCRIMINATION rather than a state.
    expect(playProton(state).ok).toBe(true);
  });

  it("still SPENDS the Supporter for the turn — §7.2 is not exempted", () => {
    const state = handFromDeck(armed(3), "p1", "fix-proton", 1);
    const done = playAndTake(state, (parked) => [cardsPrompt(parked).candidates[0] as string]);
    expect(done.state.allowances.supporterPlayed).toBe(true);
    const again = playProton(done.state);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("SUPPORTER_ALREADY_PLAYED");
  });

  it("follows the going-first SEAT, not p1, and cannot become a going-second licence", () => {
    const mirrored = localSetup(4, "p2", { p1: OPPONENT_DECK, p2: PROTON_DECK });
    expect(mirrored.turn).toBe(1);
    expect(mirrored.firstPlayer).toBe("p2");
    expect(playProton(handFromDeck(mirrored, "p2", "fix-proton", 1), "p2").ok).toBe(true);

    // …and the same seed with the decks the other way round: p1 HOLDS a Proton on
    // turn 1 and is refused before the Supporter branch is reached at all,
    // because turn 1 was never p1's to act on.
    const goingSecond = handFromDeck(
      localSetup(4, "p2", { p1: PROTON_DECK, p2: OPPONENT_DECK }),
      "p1",
      "fix-proton",
      1,
    );
    const wrongSeat = playProton(goingSecond, "p1");
    expect(wrongSeat.ok).toBe(false);
    if (!wrongSeat.ok) expect(wrongSeat.error.code).toBe("WRONG_SEAT");
  });
});

describe("the search — D200's filter at its stage narrowing", () => {
  it("parks on chooseCards with the printed noun phrase, min 0 and max 3", () => {
    const state = armed(3);
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-proton"),
    }).state;
    const prompt = cardsPrompt(parked);
    // The printed noun phrase, whole — `retrieveNoun`'s ownerPokemon arm with the
    // stage word INSIDE it. Without `stage` this reads "up to 3 Team Rocket's
    // Pokémon", which is a different card.
    expect(prompt.note).toBe(
      "Search your deck for up to 3 Basic Team Rocket's Pokémon into your hand.",
    );
    expect(prompt.max).toBe(3);
    expect(prompt.min).toBe(0);
    expect(prompt.dest).toBe("hand");
  });

  it("offers EXACTLY the deck's Basic Team Rocket's Pokémon, in deck order", () => {
    const state = armed(3);
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-proton"),
    }).state;
    // Computed from the board rather than pinned to a seed: the offer IS the
    // deck's matching cards, so a filter that widened by one card goes red here
    // whatever the shuffle did.
    expect(cardsPrompt(parked).candidates).toEqual(
      inDeck(parked, "p1", ["fix-tr-meowth", "fix-tr-mimikyu"]),
    );
    expect(new Set(offeredIds(parked))).toEqual(new Set(["fix-tr-meowth", "fix-tr-mimikyu"]));
  });

  it("refuses each negative BY NAME — and each one is in the deck at the time", () => {
    const state = armed(5);
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-proton"),
    }).state;
    const negatives = ["fix-tr-arbok", "fix-tr-energy", "fix-cynthia-basic", "fix-proton"];
    for (const id of negatives) {
      expect(
        inDeck(parked, "p1", [id]).length,
        `${id} is not in the deck to be refused`,
      ).toBeGreaterThan(0);
      expect(offeredIds(parked), `${id} was offered`).not.toContain(id);
    }
    // The prefixed TRAINER negative is the card itself: three spare copies of
    // "Team Rocket's Proton" sit in that deck under the possessive prefix.
    expect(POOL["fix-proton"]?.name.startsWith("Team Rocket's ")).toBe(true);
  });

  it("takes up to 3 into the HAND, out of the deck, and shuffles after", () => {
    const state = armed(3);
    const handBefore = state.players.p1.hand.length;
    const deckBefore = state.players.p1.deck.length;
    const { state: done, events } = playAndTake(state, (parked) =>
      cardsPrompt(parked).candidates.slice(0, 3),
    );
    const searched = events.find(
      (e): e is Extract<GameEvent, { type: "DECK_SEARCHED" }> => e.type === "DECK_SEARCHED",
    );
    expect(searched?.uids).toHaveLength(3);
    expect(searched?.dest).toBe("hand");
    for (const uid of searched?.uids ?? []) {
      expect(done.players.p1.hand).toContain(uid);
      expect(done.players.p1.deck).not.toContain(uid);
    }
    // Proton itself left the hand for the discard before its program ran, so the
    // hand is (before − the card played + 3) and the deck is 3 lighter.
    expect(done.players.p1.hand).toHaveLength(handBefore - 1 + 3);
    expect(done.players.p1.deck).toHaveLength(deckBefore - 3);
    expect(events.filter((e) => e.type === "SHUFFLE")).toHaveLength(1);
  });

  it("'UP TO 3' means the player may take NONE — and the deck still shuffles", () => {
    const state = armed(3);
    const deckBefore = state.players.p1.deck.length;
    const { state: done, events } = playAndTake(state, () => []);
    expect(done.players.p1.deck).toHaveLength(deckBefore);
    expect(events.some((e) => e.type === "DECK_SEARCHED")).toBe(false);
    expect(events.filter((e) => e.type === "SHUFFLE")).toHaveLength(1);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("…and may take FEWER than the cap", () => {
    const state = armed(7);
    const { state: done, events } = playAndTake(state, (parked) =>
      cardsPrompt(parked).candidates.slice(0, 2),
    );
    const searched = events.find(
      (e): e is Extract<GameEvent, { type: "DECK_SEARCHED" }> => e.type === "DECK_SEARCHED",
    );
    expect(searched?.uids).toHaveLength(2);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("a WHIFF never parks at all — and the trailing shuffle still runs", () => {
    // The deck holds Team Rocket's Arbok and Team Rocket's Energy and no Basic
    // Team Rocket's Pokémon, so this is the `stage`/`category` narrowing and the
    // whiff path in ONE board.
    const state = armed(3, NO_BASIC_DECK);
    expect(inDeck(state, "p1", ["fix-tr-arbok", "fix-tr-energy"]).length).toBeGreaterThan(0);
    const played = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-proton"),
    });
    expect(played.state.phase.kind).toBe("turn:action");
    expect(played.events.some((e) => e.type === "DECK_SEARCHED")).toBe(false);
    expect(played.events.filter((e) => e.type === "SHUFFLE")).toHaveLength(1);
    // It was still a legal PLAY — a search Supporter has no would-whiff gate.
    expect(played.state.allowances.supporterPlayed).toBe(true);
  });

  it("cannot reach a card the offer did not name (wire safety)", () => {
    const state = armed(5);
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-proton"),
    }).state;
    const arbok = inDeck(parked, "p1", ["fix-tr-arbok"])[0] as string;
    const reached = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [arbok] },
    });
    expect(reached.ok).toBe(false);
  });
});

describe("the HUD mirror — the read site D223 had to discover", () => {
  it("lights Proton's wire row on turn 1 while greying the control in the SAME call", () => {
    const state = handFromDeck(armed(3), "p1", "sv01-180", 1);
    expect(state.turn).toBe(1);
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    // Found by UID, not by name: this fixture's `name` is the PRINTED name, so a
    // name lookup would silently be a different question here than in
    // `carmine.test.ts` (where every fixture's name is its id).
    const row = (cardId: string) => {
      const uid = handUid(state, "p1", cardId);
      return phase.trainers.find((t) => t.uid === uid);
    };
    expect(row("fix-proton")).toEqual({
      uid: handUid(state, "p1", "fix-proton"),
      name: "Team Rocket's Proton",
      disabled: false,
      reason: null,
      rareCandy: false,
    });
    expect(row("sv01-180")?.disabled, "the control lit up too").toBe(true);
  });
});

describe("the printed 'reveal them' — the clause D224 pinned as a gap, PAID at D225", () => {
  function searchedRow(state: GameState, events: GameEvent[]) {
    const rows = logFromEvents(events, {
      names: { p1: "P1", p2: "P2" },
      state,
      elapsed: formatElapsed(0),
    });
    return rows.find(
      (r) => r.kind === "action" && r.segments.some((s) => s.text.includes("searched their deck")),
    );
  }

  it("the ACTOR is handed the identities — the engine knows exactly what was found", () => {
    const state = armed(3);
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-proton"),
    }).state;
    const phase = redactGame(parked, "p1").phase;
    if (phase.kind !== "effect:choose")
      throw new Error(`expected effect:choose, got ${phase.kind}`);
    const prompt = phase.prompt;
    if (prompt === null || prompt.kind !== "chooseCards")
      throw new Error("expected a chooseCards prompt");
    for (const candidate of prompt.candidates) {
      expect(candidate.name.startsWith("Team Rocket's ")).toBe(true);
    }
    // …and the OPPONENT is handed no prompt at all, which is correct: the deck is
    // the actor's private zone until something reveals from it.
    const oppPhase = redactGame(parked, "p2").phase;
    expect(oppPhase.kind).toBe("effect:choose");
    expect(oppPhase.kind === "effect:choose" ? oppPhase.prompt : "no prompt field").toBe(null);
  });

  it("and the OPPONENT now reads the CARDS — the printed reveal, at last", () => {
    const state = armed(3);
    const { state: done, events } = playAndTake(state, (parked) =>
      cardsPrompt(parked).candidates.slice(0, 3),
    );
    const row = searchedRow(done, events);
    const text = (row?.kind === "action" ? row.segments : []).map((s) => s.text).join("");
    expect(text.startsWith("searched their deck — revealed ")).toBe(true);
    expect(text.endsWith(" and put them in hand")).toBe(true);
    // Every taken card is NAMED — this is the whole clause, and the assertion
    // that used to be `not.toContain` for each of these names.
    const searched = events.find((e) => e.type === "DECK_SEARCHED");
    if (searched?.type !== "DECK_SEARCHED") throw new Error("expected DECK_SEARCHED");
    expect(searched.reveal).toBe(true);
    expect(searched.uids).toHaveLength(3);
    for (const uid of searched.uids) {
      const name = POOL[done.cardIdByUid[uid] as string]?.name as string;
      expect(text, `${name} was searched but not revealed`).toContain(name);
    }
    const snapshot = JSON.stringify(redactGame(done, "p2"));
    for (const id of ["fix-tr-meowth", "fix-tr-mimikyu"]) {
      expect(snapshot, `${id} leaked into the opponent's snapshot`).not.toContain(id);
    }
    expect(redactGame(done, "p2").board.opponent.hand).toHaveLength(done.players.p1.hand.length);
  });
});

describe("the printed bytes", () => {
  it("pins the sentences the flag and the program were authored from", () => {
    const [first, second] = PROTON_TEXT.split("\n\n");
    expect(first).toBe("If you go first, you may use this card during your first turn.");
    expect(second).toBe(
      "Search your deck for up to 3 Basic Team Rocket's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    );
    expect(PROTON_TEXT.split("\n\n")).toHaveLength(2);
    expect(POOL["fix-proton"]?.effect).toBe(PROTON_TEXT);
    // The demonstrator's NAME carries the possessive prefix — the thing every
    // other fixture in this repo does not do, and the reason it can be its own
    // in-deck negative.
    expect(POOL["fix-proton"]?.name).toBe("Team Rocket's Proton");
  });
});
