import type { Card } from "@luminous/schema";
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

// D224 — TEAM ROCKET'S PROTON: the row two earlier slices left ready, landed for
// ZERO new engine code.
//
// "If you go first, you may use this card during your first turn.
//
//  Search your deck for up to 3 Basic Team Rocket's Pokémon, reveal them, and put
//  them into your hand. Then, shuffle your deck."
//
// **2 Standard-legal printings** (`sv10-177`, `sv10-227` — byte-identical, and
// the ONLY two rows in the catalog carrying this sentence; remote D1 `luminous`
// `735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 2026-08-05).
//
// ⚠️ **THE POINT OF THE ROW IS THE TRANSFER.** `ownerPrefix.test.ts` dropped this
// card because its first sentence needed a `CardProgram` flag the engine did not
// have. D223 then built that flag **for a different card** (Carmine, whose first
// sentence is byte-identical) and D200 had already built the filter the second
// sentence needs. Neither slice was aimed here. **An engine piece transfers
// across cards; a registry row does not** — so the piece arrived free and the row
// still had to be written, which is this file.
//
// ⚠️ WHAT THIS SUITE CAN PUT RED, SAID UP FRONT (the guard rule, conventions.md):
// * Dropping `trainerFirstTurnExempt` fails the turn-1 play; adding it to the
//   §7.2 allowance as well fails "still spends the Supporter".
// * Deleting §4's lock outright (rather than exempting one card) fails the Nemona
//   CONTROL, which sits in the same hand on the same board.
// * Dropping `stage: "basic"` offers Team Rocket's Arbok; dropping the owner
//   offers Cynthia's Gible and the plain bodies; widening past `category ===
//   "Pokemon"` offers Team Rocket's Energy **and Proton's own spare copies**,
//   which carry the possessive prefix in their printed names.
// * `max: 3` → Hop's Bag's 2, or `dest: "bench"`, each fails its own assertion.
// * Dropping the trailing `shuffleDeck` fails on the whiff, on the decline AND on
//   the taken path — all three are asserted, because the Nest Ball pattern's
//   whole claim is that the shuffle does not depend on the search.
// * Sharing `CARMINE`'s or `HOPS_BAG`'s program object fails the identity tests.
//
// 🛑 **AND ONE PRINTED CLAUSE IS NOT MODELLED — "reveal them" — WHICH IS PINNED
// AT THE BOTTOM OF THIS FILE RATHER THAN LEFT IN PROSE.** See that block for the
// measurement that both authorises the row and refuses the cheap fix.

/** The printed effect, byte for byte off the D1 (D183's class: an arm written
    from a paraphrase passes a test written against the same paraphrase). */
const PROTON_TEXT =
  "If you go first, you may use this card during your first turn.\n\nSearch your deck for up to 3 Basic Team Rocket's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";

const PROTON_IDS = ["sv10-177", "sv10-227"] as const;

// ── The demonstrator pool. Synthetic `fix-*` bodies declared HERE rather than in
//    `testFixtures.ts`, and for a reason stronger than D190's manifest rule
//    (which applies too — the generated `catalogManifest.ts` measures a 978-row /
//    6-set catalog holding no `sv10` row at all): `ownerPrefix.test.ts` asserts
//    that **no card in `FIXTURE_POOL` matches ANY census owner**, so putting a
//    "Team Rocket's …" body in the shared pool would turn that sweep red. The
//    pool is a PARAMETER of `createGame`, so this one stays local.
//
//    ⚠️ THE `name` IS THE POINT — every other fixture in this repo takes
//    `name: id`, and these cannot, because the predicate reads the NAME. The
//    names are real printed names (D1, 2026-08-05: Team Rocket's Meowth
//    sv10-149, Mimikyu sv10-087, Arbok sv10-113 ← Ekans, Energy sv10-182), and
//    the ids stay `fix-*` so the manifest generator and checker both skip them.

/** A Basic in the subgroup — what the search is FOR. */
function subgroupBasic(id: string, name: string): Card {
  return battler(id, { name, hp: 70 });
}

const LOCAL_CARDS: Record<string, Card> = {
  /** The card itself. ⚠️ Its printed NAME carries the possessive prefix too, so
      the spare copies sitting in the deck are the sharpest in-deck negative this
      search has: a filter that read the name without the `category` conjunct
      would offer the player their own Supporters. */
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

/** The acting deck: four Proton, the Nemona control (`sv01-180`, "Draw 3
    cards.") beside them on every board, both search targets, and one of each
    negative — so every exclusion below is observed against a card that is
    actually in the deck at the moment of the offer, never against an absence.
    Deep on `fix-bigbody` (200 HP dominant Basic) so setup never mulligans at an
    arbitrary seed.

    ⚠️ FOUR OF EACH NEGATIVE, NOT TWO, AND THE REASON IS A FAILURE THIS FILE
    ALREADY HAD: at two copies the "…and each one is in the deck at the time"
    guard went RED at one seed, because both Arboks had been dealt into the
    opening hand and the Prizes. A guard that depends on the shuffle is a flaky
    guard; the deck is what makes it a fact. */
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

/** The WHIFF board: the same Protons, and every Team Rocket's card in it is one
    the filter must refuse (the Stage 1 and the Energy). A search that finds
    nothing must be a no-op that still shuffles — and this deck is what makes the
    `stage: "basic"` narrowing and the whiff path the SAME assertion. */
const NO_BASIC_DECK = deckOf({
  "fix-proton": 4,
  "sv01-180": 4,
  "fix-tr-arbok": 4,
  "fix-tr-energy": 4,
  "fix-cynthia-basic": 4,
  "fix-bigbody": 20,
  "fix-energy": 20,
});

/** ⚠️ THE OPPONENT PLAYS A DECK WITH NO TEAM ROCKET CARD IN IT, and that is
    load-bearing for the reveal block at the bottom: "p2's snapshot never names
    the searched cards" is only a claim about the SEARCH if p2's own visible
    zones cannot hold a copy of one. */
const OPPONENT_DECK = deckOf({ "fix-bigbody": 30, "fix-basic-1": 4, "fix-energy": 26 });

/** `driveSetup` against the LOCAL pool (D190/D199/D200's helper verbatim — the
    shared one closes over `FIXTURE_POOL`). Returns the state on TURN 1. */
function localSetup(
  seed: number,
  first: Seat,
  decks: { p1: string[]; p2: string[] } = { p1: PROTON_DECK, p2: OPPONENT_DECK },
): GameState {
  const created = createGame({ seed, decks, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** Turn 1, p1 going first and holding one Proton — the board nearly every case
    below runs on. */
function armed(seed: number, deck: string[] = PROTON_DECK): GameState {
  return handFromDeck(localSetup(seed, "p1", { p1: deck, p2: OPPONENT_DECK }), "p1", "fix-proton", 1);
}

function playProton(state: GameState, seat: Seat = "p1") {
  return applyAction(state, { type: "playTrainer", seat, uid: handUid(state, seat, "fix-proton") });
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
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
        // D225 — the printed "reveal them", authored at last. D224 shipped this
        // row WITHOUT it and said so; the block at the bottom of this file was
        // written to go red on the day it landed, and did.
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
    // ⚠️ THE TWO CHEAP MISTAKES. Carmine (sv06-145) prints the SAME first
    // sentence, so sharing its object would have been one keystroke — and would
    // have given Proton "discard your hand and draw 5". Hop's Bag (sv09-147) is
    // the same op with the owner changed, and sharing THAT would have handed an
    // Item a §4 exemption it never printed.
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
    // ⚠️ THE ASSERTION THAT STOPS "DELETE THE §4 GATE" FROM PASSING.
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
    // ⚠️ THE HALF cardplay.ts LEAVES IMPLICIT, DRIVEN RATHER THAN ARGUED (D223's
    // finding): turn 1 belongs to `state.firstPlayer` by construction, so the
    // going-SECOND seat's turn-1 attempt dies at the seat gate before the
    // Supporter branch is reached at all.
    // p2 goes first, holding the Proton deck: the licence follows the SEAT.
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
    expect(prompt.note).toBe("Search your deck for up to 3 Basic Team Rocket's Pokémon into your hand.");
    expect(prompt.max).toBe(3);
    expect(prompt.min).toBe(0); // ⚠️ the printed "up to" — declining is legal
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
    // ⚠️ THE EXCLUSIONS ARE OBSERVED, NOT ASSUMED: a "not offered" assertion
    // against a card that is not in the deck cannot go red.
    const state = armed(5);
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-proton"),
    }).state;
    const negatives = ["fix-tr-arbok", "fix-tr-energy", "fix-cynthia-basic", "fix-proton"];
    for (const id of negatives) {
      expect(inDeck(parked, "p1", [id]).length, `${id} is not in the deck to be refused`)
        .toBeGreaterThan(0);
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
    const searched = events.find((e): e is Extract<GameEvent, { type: "DECK_SEARCHED" }> => e.type === "DECK_SEARCHED");
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
    // ⚠️ THE PRINTED WORD, DRIVEN. The park's `min: 0` is what makes an empty
    // answer legal; a search authored as an exact-N pick would reject it.
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
    const searched = events.find((e): e is Extract<GameEvent, { type: "DECK_SEARCHED" }> => e.type === "DECK_SEARCHED");
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
    // ⚠️ ONE `redactGame` CALL, TWO ROWS, OPPOSITE ANSWERS — so the test cannot
    // pass by the whole trainer list having been enabled.
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
      // The §4 timing is self-evident and carries no tooltip either way; an
      // ENABLED row must carry none at all.
      reason: null,
      rareCandy: false,
    });
    expect(row("sv01-180")?.disabled, "the control lit up too").toBe(true);
  });
});

describe("✅ the printed 'reveal them' — the clause D224 pinned as a gap, PAID at D225", () => {
  // ⚠️ THIS BLOCK WAS A PINNED GAP AND IS NOW A PINNED FEATURE — kept and
  // rewritten rather than deleted, because the record of what it used to assert
  // is the reason the next author can trust what it asserts now (D178).
  //
  // What D224 wrote here: three registry rows in this family asserted that a
  // reveal "needs no op — a search that ends in the hand is public by
  // construction", and measured, that was FALSE. The chooseCards prompt is
  // redacted to the ANSWERER alone (redact.ts's hidden-candidate family), the
  // hand is withheld from the opponent, and the only thing that crossed was a
  // count-only `DECK_SEARCHED` log row. The opponent learned a number; in paper
  // they see the cards. D224 shipped the row anyway (the clause moves no card,
  // changes no zone, gates no legality and files no §9.2 record) and predicted
  // that "THIS TEST GOES RED THE DAY SOMEBODY BUILDS IT".
  //
  // ✅ IT DID, AND THIS IS THAT DAY. D225 added an optional `reveal?: true` to
  // `searchDeck` and `lookAtTopN`, spelled on the rows whose print carries the
  // word, read in `log.ts`'s two arms. The second test below used to assert the
  // bare count and now asserts the names.
  //
  // 🛑 WHAT DID **NOT** CHANGE, AND IT IS THE HALF THAT MATTERS: the reveal is a
  // property of the printed SENTENCE, not of the destination. The Standard-legal
  // census that killed the cheap fix (name the cards whenever `dest === "hand"`)
  // still holds and got bigger on re-measurement — 15 printings / 8 sentences
  // search a deck into hand with NO reveal printed, every one of them searching
  // for uncategorised "cards", where naming would be a real leak. The
  // discriminating guard lives in `revealClause.test.ts`, which drives a
  // to-hand search with no printed reveal and asserts the row stays a count.

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
    if (phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${phase.kind}`);
    const prompt = phase.prompt;
    if (prompt === null || prompt.kind !== "chooseCards") throw new Error("expected a chooseCards prompt");
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
    // 🛑 THE REVEAL IS THE LOG ROW, NOT THE SNAPSHOT — and that separation is the
    // reason this row could be paid at all. The cards are in p1's HAND, which
    // stays withheld: a §15.E reveal shows the cards once, it does not turn the
    // hand face up for the rest of the game. `OPPONENT_DECK` holds no Team Rocket
    // card, so a hit here could only have come from p1's zones.
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
