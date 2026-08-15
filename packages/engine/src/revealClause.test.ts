import { describe, expect, it } from "vitest";
import { cardOfUid } from "./cards";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, programFor } from "./index";
import type { GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  LOOK_AT_TOP_DECK,
  ONKO_DECK,
  TRAINER_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  toDeckTop,
  types,
} from "./testFixtures";

// D225 — THE PRINTED "REVEAL IT/THEM", PAID AS A RIDER ON THE TWO PILE-TO-HAND
// SEARCH OPS AND READ AT THE ONE LOG SITE.
//
// D224 measured a claim four registry doc comments made — that a reveal "needs
// no op, a search that ends in the hand is public by construction (D42)" — and
// found it FALSE: the `chooseCards` prompt is redacted to the ANSWERER alone,
// the hand is withheld from the opponent, and the only thing crossing the wire
// was a COUNT-ONLY `DECK_SEARCHED` row ("put 3 cards in hand"). In paper the
// opponent sees the cards.
//
// ⚠️ THE CLAIM WAS TRUE OF EXACTLY ONE DESTINATION. A `dest: "bench"` search
// really is public by construction — the card enters PLAY, face up, in both
// snapshots a moment later — and no printed bench search carries the word
// anyway. The whole debt lived on `dest: "hand"`, which is why the fix is a
// rider and not a new op.
//
// 🛑 AND WHY IT IS A FIELD RATHER THAN `dest === "hand"`. Standard-legal census,
// remote D1 `luminous`, 2026-08-05, all THREE text columns via `json_each` (the
// D206 rule — D224's figure of 41/4 read `effect` alone and was a floor):
//   • search-deck-into-hand — 100 printings / 55 sentences, of which
//     15 printings / 8 sentences print NO reveal: Cassiopeia ×3, Amulet of Hope,
//     Thwackey ×2, Eldegoss, Scrafty, Greninja ex ×3, Noctowl, Serperior ex ×3.
//   • look-at-the-top-then-into-hand — 18 printings / 8 sentences, of which
//     7 printings / 3 sentences print NO reveal: Explorer's Guidance ×3,
//     Hassel ×2, Drakloak ×2.
// Naming the cards whenever the destination is the hand would make all 22 of
// those lie, and they are precisely the ones where a reveal is a REAL leak.
//
// ⚠️ THE CORRELATION THAT IS NOT THE RULE, WRITTEN DOWN SO NOBODY "SIMPLIFIES"
// THE FIELD AWAY: all 11 no-reveal sentences search for uncategorised
// "card"/"cards", every revealing one names a category. That is the paper rule
// showing through (you reveal so the opponent can verify the find was legal;
// when anything is legal there is nothing to verify) — but it is a fact about
// today's 63 sentences, not about the next one, and deriving `reveal` from "the
// filter is narrow" would infer one printed clause from a different one.
//
// ⚠️ AND `lookAtTopN` WAS NOT SAFE TO HARD-CODE, WHICH ITS EVENT'S NAME HID.
// `DECK_TOP_REVEALED` records the LOOK (the top n was revealed to its OWNER,
// which is what makes the pick legal), not the announcement. Hassel — "look at
// the top 8 … put up to 3 of them into your hand. Shuffle the other cards back"
// — is this op with an unfiltered filter and today's trailing `shuffleDeck`, and
// it prints no reveal at all.
// 🆕🛑 D343 — THIS PARAGRAPH USED TO END "one filter kind away from being
// AUTHORABLE", and Hassel `sv06-151`/`sv06-205` has been an authored registry
// program for many slices. An assertion about what is NOT built has a shelf
// life (D342's rule); this one had expired and nothing could see it, because the
// sweep that would have forced Hassel into a table below could not reach the
// registry. **THE STALE PROSE AND THE BROKEN POPULATION WERE THE SAME DEFECT
// SEEN FROM TWO ENDS** — a census that cannot see the catalog also cannot
// contradict the sentences you write about the catalog. The narrow claim, which
// does not rot: this file's tables now classify Hassel's program explicitly.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function ctx(state: GameState): LogContext {
  return { names: NAMES, state, elapsed: formatElapsed(0) };
}

/** The one action row a batch produced that mentions a deck read, flattened to
    plain text — the exact string an opponent reads in their log. */
function searchRow(state: GameState, events: GameEvent[]): string {
  const rows = logFromEvents(events, ctx(state));
  const row = rows.find(
    (r) =>
      r.kind === "action" &&
      r.segments.some(
        (s) => s.text.includes("searched their deck") || s.text.includes("looked at the top"),
      ),
  );
  return row?.kind === "action" ? row.segments.map((s) => s.text).join("") : "";
}

function nameOf(state: GameState, uid: string): string {
  const name = cardOfUid(state, uid)?.name;
  if (name === undefined) throw new Error(`no card for ${uid}`);
  return name;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — Trainers play
    freely, the shared board shape of cardplay.test.ts. */
function p1Turn2(seed: number, decks: { p1: string[]; p2: string[] }): GameState {
  return must(applyAction(driveSetup(seed, decks, { first: "p2" }), { type: "endTurn", seat: "p2" }));
}

/** Play `cardId` from p1's hand and answer its chooseCards park with the first
    `take` candidates (0 = decline). Returns the post-state and the RESOLVING
    batch's events — the batch the search row is built from. */
function playAndTake(
  start: GameState,
  cardId: string,
  take: number,
): { state: GameState; events: GameEvent[]; picked: string[] } {
  const state = handFromDeck(start, "p1", cardId, 1);
  const uid = handUid(state, "p1", cardId);
  const parked = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
  if (parked.phase.kind !== "effect:choose") throw new Error(`${cardId} did not park`);
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error(`${cardId} did not prompt for cards`);
  const picked = prompt.candidates.slice(0, take);
  const resolved = mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: picked },
  });
  return { state: resolved.state, events: resolved.events, picked: [...picked] };
}

// ── 1. The read site, arm by arm ─────────────────────────────────────────────
//
// These build the event directly, which is the honest shape for a LOG test: the
// formatter's whole input is a batch plus a post-state, and the four endings of
// the two arms are what this slice added. Every one of them goes red on the
// obvious mistakes — reading the flag on the wrong branch, dropping the names,
// or naming unconditionally.

describe("D225 — log.ts's DECK_SEARCHED arm reads the printed clause, not the destination", () => {
  // A board whose p1 deck is full of nameable fixture cards; the uids are real,
  // so `cardName` resolves through the same pool the engine plays on.
  const board = p1Turn2(1, { p1: TRAINER_DECK, p2: TRAINER_DECK });
  const deck = board.players.p1.deck;
  const one = deck[0] as string;
  const two = deck[1] as string;

  it("names the cards when the sentence prints a reveal", () => {
    const events: GameEvent[] = [
      { type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [one], reveal: true },
    ];
    expect(searchRow(board, events)).toBe(
      `searched their deck — revealed ${nameOf(board, one)} and put it in hand`,
    );
  });

  it("stays a COUNT when it does not — the Cassiopeia ending, and it is deliberate", () => {
    const events: GameEvent[] = [
      { type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [one, two] },
    ];
    const text = searchRow(board, events);
    expect(text).toBe("searched their deck — put 2 cards in hand");
    // The identities are ABSENT, not merely unemphasised: an unfiltered search
    // that prints no reveal must not leak the hand it just built.
    expect(text).not.toContain(nameOf(board, one));
    expect(text).not.toContain(nameOf(board, two));
  });

  it("agrees its verb and pronoun with the count on BOTH endings", () => {
    expect(
      searchRow(board, [{ type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [one, two], reveal: true }]),
    ).toContain(" and put them in hand");
    expect(
      searchRow(board, [{ type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [one] }]),
    ).toContain("put 1 card in hand");
  });

  it("folds duplicate names to ×N — a search for up to 3 of one name is the common case", () => {
    const events: GameEvent[] = [
      { type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [one, one, two], reveal: true },
    ];
    // `one` and `two` may or may not share a name in this deck; assert the fold
    // on the pair that certainly does.
    expect(searchRow(board, events)).toContain(`${nameOf(board, one)} ×2`);
  });

  it("ignores the flag entirely on a BENCH search — that destination was never the debt", () => {
    const counted = "searched their deck — benched 1 Pokémon";
    expect(searchRow(board, [{ type: "DECK_SEARCHED", seat: "p1", dest: "bench", uids: [one] }])).toBe(
      counted,
    );
    // Even if some future row spelled it, a benched card is public by the move
    // itself and the row must not grow a second voice for it.
    expect(
      searchRow(board, [{ type: "DECK_SEARCHED", seat: "p1", dest: "bench", uids: [one], reveal: true }]),
    ).toBe(counted);
  });
});

describe("D225 — log.ts's DECK_TOP_REVEALED arm carries the same rider", () => {
  const board = p1Turn2(1, { p1: LOOK_AT_TOP_DECK, p2: LOOK_AT_TOP_DECK });
  const top = board.players.p1.deck[0] as string;

  it("names the taken card when the sentence prints 'you may reveal a …'", () => {
    expect(
      searchRow(board, [{ type: "DECK_TOP_REVEALED", seat: "p1", uids: [top], reveal: true }]),
    ).toBe(`looked at the top of their deck — revealed ${nameOf(board, top)} and put it in hand`);
  });

  it("stays a COUNT without it — the Hassel / Explorer's Guidance ending", () => {
    const text = searchRow(board, [{ type: "DECK_TOP_REVEALED", seat: "p1", uids: [top] }]);
    expect(text).toBe("looked at the top of their deck — put 1 card in hand");
    expect(text).not.toContain(nameOf(board, top));
  });
});

// ── 2. Driven end to end — the same op, one printed clause apart ─────────────

describe("D225 — driven through real programs, the clause is the only difference", () => {
  it("Energy Search NAMES the Basic Energy it found (printed 'reveal it')", () => {
    const start = p1Turn2(1, { p1: TRAINER_DECK, p2: TRAINER_DECK });
    const { state, events, picked } = playAndTake(start, "sv01-172", 1);
    const searched = find(events, "DECK_SEARCHED");
    expect(searched?.dest).toBe("hand");
    expect(searched?.reveal).toBe(true);
    expect(searchRow(state, events)).toBe(
      `searched their deck — revealed ${nameOf(state, picked[0] as string)} and put it in hand`,
    );
    expect(types(events)).toContain("SHUFFLE");
  });

  it("Nest Ball stays a count — same op, `dest: \"bench\"`, no printed reveal", () => {
    const start = p1Turn2(1, { p1: TRAINER_DECK, p2: TRAINER_DECK });
    const { state, events, picked } = playAndTake(start, "sv01-181", 1);
    const searched = find(events, "DECK_SEARCHED");
    expect(searched?.dest).toBe("bench");
    expect(searched).not.toHaveProperty("reveal");
    expect(searchRow(state, events)).toBe("searched their deck — benched 1 Pokémon");
    // Not a leak either way — the benched card is in both snapshots — but the
    // row must not start naming cards because a sibling arm learned to.
    expect(searchRow(state, events)).not.toContain(nameOf(state, picked[0] as string));
  });

  it("Great Ball NAMES its taken Pokémon (printed 'You may reveal a Pokémon')", () => {
    let start = p1Turn2(1, { p1: LOOK_AT_TOP_DECK, p2: LOOK_AT_TOP_DECK });
    start = toDeckTop(start, "p1", "fix-basic-1", 2);
    const { state, events, picked } = playAndTake(start, "sv02-183", 1);
    const revealed = find(events, "DECK_TOP_REVEALED");
    expect(revealed?.reveal).toBe(true);
    expect(searchRow(state, events)).toBe(
      `looked at the top of their deck — revealed ${nameOf(state, picked[0] as string)} and put it in hand`,
    );
  });
});

// ── 3. The driven NEGATIVE control, which is the guard the slice turns on ────
//
// 🛑 fix-onko's "Last Wish" is a FIXTURE `searchDeck {dest:"hand"}` with no
// printed sentence and therefore no reveal — structurally identical to
// Cassiopeia's "Search your deck for up to 2 cards and put them into your hand".
// It is the only thing in this repo that can prove the new arm DISCRIMINATES
// rather than fires: a build that names cards whenever the destination is the
// hand passes every test above this one and fails here.

describe("D225 — a to-hand search with NO printed reveal, driven, still says nothing", () => {
  const SEED = 4;

  it("fix-onko's Last Wish puts a Basic in hand and the opponent reads only a number", () => {
    let state = driveSetup(SEED, { p1: ONKO_DECK, p2: ONKO_DECK }, { first: "p2" });
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "fix-onko");
    const afterAttack = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    const parked = mustApply(afterAttack, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("Last Wish did not park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const pick = prompt.candidates.slice(0, 1);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: pick },
    });

    const searched = find(events, "DECK_SEARCHED");
    expect(searched?.dest).toBe("hand");
    // ⚠️ ABSENT, not `false` (D135) — these ops are compared by value against
    // hand-authored rows, and `reveal: undefined` is not the same wire object as
    // no key at all. A `reveal: op.reveal` spelling at the push site passes the
    // `?.reveal` check above and fails this one.
    expect(searched).not.toHaveProperty("reveal");
    expect(Object.keys(searched ?? {}).sort()).toEqual(["dest", "seat", "type", "uids"]);

    const text = searchRow(done, events);
    expect(text).toBe("searched their deck — put 1 card in hand");
    expect(text).not.toContain(nameOf(done, pick[0] as string));
    expect(done.players.p2.hand).toContain(pick[0]);
  });
});

// ── 4. Which registry rows print the word ────────────────────────────────────
//
// ⚠️ WHAT THESE CAN AND CANNOT CHECK. The printed sentence lives in the catalog,
// which is not in this repo, so no test here can derive "does this card print
// the word 'reveal'" — that was done once, against the remote D1, and the census
// is at the top of this file. What these pin is the OTHER half: that the
// decision made per row is still the one that was made, and that the flag has
// not been sprayed across the family. A row that loses the rider, or a bench row
// that gains one, goes red here.

/** Every `searchDeck` / `lookAtTopN` op anywhere in a card's program, whatever
    SURFACE it sits on (Trainer list, Ability, Stadium ability, triggered
    Ability, any attack index) and however deep a gate nests it — Mesagoza and
    Poké Ball hide theirs inside a `coinFlipGate.then`. Written as a walk rather
    than as a per-surface lookup because the surface is not the sentence: the
    same clause is printed on an Item, a Stadium, an Ability and an attack in
    this family, and a per-surface reader would quietly miss the fifth. */
function searchOps(id: string): EffectOp[] {
  const program = programFor(id);
  if (program === undefined) throw new Error(`no program for ${id}`);
  const found: EffectOp[] = [];
  const walk = (ops: readonly EffectOp[] | undefined): void => {
    for (const op of ops ?? []) {
      if (op.op === "searchDeck" || op.op === "lookAtTopN") found.push(op);
      if ("then" in op) walk(op.then);
    }
  };
  walk(program.trainer);
  walk(program.stadium?.ability?.program);
  for (const ability of program.abilities ?? []) walk(ability.program);
  for (const trigger of program.triggered ?? []) walk(trigger.program);
  for (const ops of Object.values(program.attack ?? {})) walk(ops);
  return found;
}

/** The printed-reveal rows, one id per distinct SENTENCE (reprints ride the same
    object and are pinned elsewhere), with the clause each was authored from. */
const REVEALING: readonly [id: string, printed: string][] = [
  ["sv01-172", "Energy Search — 'reveal it, and put it into your hand'"],
  ["sv01-175", "Jacq — 'reveal them'"],
  ["sv02-061", "Chien-Pao ex 'Shivery Chill' (Ability) — 'reveal them'"],
  ["sv01-178", "Mesagoza (Stadium, inside a coinFlipGate) — 'reveals it'"],
  ["sv03-196", "Town Store (Stadium) — 'reveal it'"],
  ["sv02-170", "Flamigo 'Insta-Flock' (onPlayToBench trigger) — 'reveal them'"],
  ["sv01-196", "Ultra Ball — 'reveal it'"],
  ["sv06.5-096", "Earthen Vessel — 'reveal them'"],
  ["sv01-185", "Poké Ball (inside a coinFlipGate) — 'reveal it'"],
  ["sv05-153", "Master Ball — 'reveal it'"],
  ["sv08.5-131", "Treasure Tracker — 'reveal them'"],
  ["sv10-103", "Cynthia's Gabite 'Champion's Call' (Ability) — 'reveal it'"],
  ["sv10-050", "Misty's Lapras 'Swim Together' (attack 0) — 'reveal them'"],
  ["sv10-169", "Spikemuth Gym (Stadium, EITHER player) — 'reveal it'"],
  ["sv10-177", "Team Rocket's Proton — 'reveal them' (D224's unpaid clause)"],
  // 🆕 D330 — Team Rocket's Petrel, `trainerCard`'s first printed consumer. The
  // REAL printing is tabled rather than its `fix-trainersearch` demonstrator,
  // because the two share one program object and the real id is the one that
  // names the printed sentence — `fix-metallicsignal`'s rule read the other way
  // round, since that fixture's own printings are all outside `FIXTURE_POOL`.
  ["sv10-176", "Team Rocket's Petrel — 'reveal it, and put it into your hand'"],
  ["sv02-183", "Great Ball (lookAtTopN) — 'You may reveal a Pokémon you find there'"],
  ["sv01-186", "Pokégear 3.0 (lookAtTopN) — 'You may reveal a Supporter card …'"],
  ["svp-118", "Tatsugiri 'Attract Customers' (Ability, lookAtTopN) — 'reveal a Supporter card'"],
  // ⚠️ D245 — the FIXTURE demonstrator for Genesect ex "Metallic Signal"
  // (`sv10.5b-067`/`-161`/`-169`), which prints "reveal them". It is here rather
  // than in `NOT_REVEALING` below because it carries a REAL printed sentence: the
  // fixture maps to the same `METALLIC_SIGNAL` program object as its three
  // printings, so classifying it as synthetic would let the real card's rider be
  // dropped with this sweep still green.
  [
    "fix-metallicsignal",
    "Genesect ex 'Metallic Signal' (Ability, FIXTURE of sv10.5b-067) — 'reveal them'",
  ],
  // 🆕 D280 — Call Bell's FIXTURE demonstrator, tabled for `fix-metallicsignal`'s
  // reason verbatim: it maps to the same `CALL_BELL` program object as the real
  // `sv08-165`, so a classification as "synthetic, no printed sentence" would let
  // the real card's `reveal` rider be dropped with this sweep still green. The
  // printed clause is "Search your deck for a Supporter card, **reveal it**, and
  // put it into your hand."
  //
  // ⚠️ IT IS THE `fix-*` ID AND NOT `sv08-165` THAT THIS SWEEP CAN SEE — the
  // sweep walks `FIXTURE_POOL`, and the 978-row / 6-set catalog holds no `sv08`
  // row. That is exactly why the demonstrator must be tabled rather than skipped.
  ["fix-callbell", "Call Bell (Item, FIXTURE of sv08-165) — 'reveal it'"],
  // 🆕 D332 — Drayton (Supporter, FIXTURE of `sv08-174`/`-232`/`-244`/`sv08.5-172`):
  // *"You may **reveal** a Pokémon and a Trainer card you find there and put them
  // into your hand."* The rider is per-SENTENCE and this sentence prints the word,
  // exactly as Great Ball and Pokégear do — the `also` half changes WHAT may be
  // taken, never whether the taking is announced. ⚠️ AND THIS ROW ARRIVED BY BEING
  // SWEPT: the discovered census below found `fix-drayton` unclassified the first
  // time the full `check` ran, which is the whole reason that sweep exists.
  ["fix-drayton", "Drayton (Supporter, FIXTURE of sv08-174) — 'You may reveal a … and a …'"],
  // 🆕 D333 — the two `lookAtTopN` rows this slice built. Both print the word, and
  // both are tabled at their REAL catalog id rather than at their `fix-*`
  // demonstrator: D330's rule (*"the real id is the one that names the printed
  // sentence"*) applies to both, because unlike `fix-metallicsignal` and
  // `fix-callbell` these ids DO resolve a program — `programFor` keys on the id and
  // the registry carries all three. The demonstrators still ride the same objects,
  // so the sweep below classifies them either way; what the id choice buys is that
  // the table names the printing whose bytes the clause was read off.
  //
  // ⚠️ THE RIDER IS PER-SENTENCE AND NEITHER SENTENCE'S NEW MACHINERY TOUCHES IT:
  // `max: "any"` changes HOW MANY may be taken and `anyOf` changes WHICH, and the
  // printed "reveal" is about whether the taking is ANNOUNCED. Great Ball and
  // Pokégear have made exactly that separation since D225.
  ["sv08.5-127", "Roto-Stick (lookAtTopN) — 'You may reveal any number of Supporter cards'"],
  [
    "sv06-143",
    "Bug Catching Set (lookAtTopN) — 'You may reveal up to 2 in any combination of …'",
  ],
  // 🆕 D336 — the two MULTI-NOUN `searchDeck` rows. Both print the word, and both
  // are tabled at their REAL catalog id on D333's reading of D330's rule: these
  // ids DO resolve a program (the registry carries all three), so the table names
  // the printing whose bytes the clause was read off, and the `fix-*`
  // demonstrators ride the same objects so the sweep classifies them either way.
  //
  // ⚠️ THE RIDER IS PER-SENTENCE AND `also` DOES NOT TOUCH IT — the list changes
  // WHICH cards and HOW MANY OF EACH may be taken; the printed "reveal them" is
  // about whether the taking is ANNOUNCED. That separation has held since D225 and
  // survived `max: "any"`, `anyOf`, `exact` and now a per-noun cap list.
  // ⚠️ AND BOTH PRINT THE PLURAL — "reveal **them**" — which is the first time this
  // table's clause is plural because the sentence names several DIFFERENT nouns
  // rather than several copies of one.
  [
    "sv08.5-115",
    "Larry's Skill (searchDeck, 3 nouns) — 'reveal them, and put them into your hand'",
  ],
  ["sv06-163", "Secret Box (searchDeck, 4 nouns) — 'reveal them, and put them into your hand'"],
  // 🆕 D337 — the FLAT-cap-over-a-union `searchDeck`, tabled at its REAL catalog id
  // on the same reading of D330's rule: `sv10-165` resolves a program, so the table
  // names the printing whose bytes the clause was read off, and `fix-ethansadventure`
  // rides the same object so the sweep classifies it either way.
  //
  // ⚠️ THE RIDER IS PER-SENTENCE AND `anyOf` DOES NOT TOUCH IT — the union changes
  // WHICH cards may be taken and the flat `max` HOW MANY; the printed "reveal them"
  // is about whether the taking is ANNOUNCED. That separation has now survived
  // `max: "any"`, `anyOf`, `exact`, a per-noun cap LIST and a flat cap over a union.
  // ⚠️ AND ITS PLURAL IS THE OTHER KIND. D336's two are plural because the sentence
  // names several DIFFERENT nouns; this one is plural because ONE noun phrase may be
  // taken up to THREE times — *"up to 3 … reveal them"*. Same printed word, a
  // different reason for its number, and the rider cannot tell them apart, which is
  // the point of reading it per sentence.
  [
    "sv10-165",
    "Ethan's Adventure (searchDeck, flat cap over a union) — 'reveal them, and put them into your hand'",
  ],
  // 🆕 D338 — Heatmor "Licking Catch", the row one line up with EXACTLY ONE NOUN
  // CHANGED and 🛑 **THE FIRST ROW IN THIS TABLE ON THE ATTACK SURFACE CARRYING A
  // FLAT CAP OVER A UNION.** `searchOps` walks `program.attack` as well as the four
  // non-attack surfaces, so the rider is read off the same field wherever it is
  // printed — which is the claim this table exists to make, and it had never been
  // driven on an attack with this shape before.
  // ⚠️ ONE ROW FOR TWO PRINTINGS, because both ids resolve to ONE program object:
  // this table is keyed on the OBJECT, and `classified.size` below counts objects.
  // A second row here would double-count a reprint.
  [
    "sv10.5w-019",
    "Heatmor 'Licking Catch' (searchDeck on an ATTACK, flat cap over a TYPED union) — 'reveal them, and put them into your hand'",
  ],
  // 🆕🛑 D343 — SURFACED BY THE POPULATION REPAIR BELOW, not by a new build. This
  // program has been in the registry for many slices and no table row named it,
  // because the sweep that was supposed to catch exactly that could not see it.
  // Two printings, one object. The printed clause is verbatim and unambiguous.
  [
    "sv07-118",
    "Fan Rotom 'Fan Call' (searchDeck on an ABILITY, typed + HP-capped filter) — 'search your deck for up to 3 {C} Pokémon with 100 HP or less, REVEAL THEM, and put them into your hand'",
  ],
];

/** The rows that DO NOT carry it, and why — **FIVE** printed bench moves (public by
    the move itself; none prints the word), the two synthetic to-hand fixtures (no
    printed sentence at all) and 🆕 D334's Explorer's Guidance.

    ⚠️ **D334 CORRECTED "three printed bench searches" TO FIVE.** The prose said
    three while the array below listed five, an inherited miscount nothing could go
    red on — the ASSERTION reads `NOT_REVEALING.length` and is blind to the reason
    column. The same defect this file's own D333 note names one table over: a count
    written as English is invisible to `tsc`.

    🆕 **AND EXPLORER'S GUIDANCE IS THE FIRST ROW HERE THAT IS NOT A BENCH MOVE AND
    NOT SYNTHETIC.** It goes to the HAND, off a REAL printed sentence, and prints no
    reveal — *"Look at the top 6 cards of your deck and put 2 of them into your
    hand."* That is the whole reason this table is a per-SENTENCE reading and never
    derived from `dest`: every other to-hand printing on this op prints *"you may
    reveal"*, and this one does not print it because there is no *"you may"* in the
    sentence at all. Nothing is offered, so nothing is announced. */
const NOT_REVEALING: readonly [id: string, why: string][] = [
  ["sv01-181", "Nest Ball — 'put it onto your Bench', no reveal printed"],
  ["sv02-171", "Artazon (Stadium) — onto the Bench"],
  ["sv09-147", "Hop's Bag — onto the Bench"],
  ["sv10-083", "Steven's Baltoy 'Summoning Sign' (attack 0) — onto the Bench"],
  ["sv09-068", "Lillie's Comfey 'Inviting Flowers' (attack 0) — onto the Bench"],
  ["fix-onko", "FIXTURE 'Last Wish' — synthetic, no printed sentence (the driven control)"],
  ["fix-pilescan", "FIXTURE — synthetic filter demonstrator, no printed sentence"],
  [
    "sv05-147",
    "Explorer's Guidance (lookAtTopN) — 'put 2 of them into your hand', a MANDATORY take and no reveal printed",
  ],
  // 🆕🆕 D335 — THE TWO LEFTOVERS-DESTINATION ROWS, AND THEY EXTEND D334's FINDING
  // RATHER THAN REPEAT IT. Both are real printed sentences that go to the HAND and
  // print no reveal, and both are mandatory takes with no "you may" to announce.
  // ⚠️ D225's recorded CORRELATION holds on both and is still not the rule: each
  // takes uncategorised *"them"*, and when anything is legal there is nothing for an
  // opponent to verify. Authored per row from the bytes, never derived.
  [
    "sv06-129",
    "Drakloak 'Recon Directive' (lookAtTopN, ABILITY) — 'put 1 of them into your hand', mandatory, no reveal printed",
  ],
  [
    "sv04-172",
    "Rika (lookAtTopN) — 'put 2 of them into your hand', mandatory, no reveal printed",
  ],
  // 🆕 D339 — MAUSHOLD, AND **THIS TABLE MOVES FOR THE FIRST TIME IN THIS RUN OF
  // SLICES**. D333, D334, D336, D337 and D338 all landed in `REVEALING`; this
  // sentence benches its cards and prints no reveal clause, so it lands HERE and
  // `REVEALING` stands still at 28. **PREDICTING THE RIGHT TABLE IS THE CLAIM** —
  // the two are not interchangeable and nothing but the printed bytes decides it.
  // ⚠️ It is the FOURTH bench row here (Nest Ball, Artazon, Hop's Bag, Summoning
  // Sign and Inviting Flowers being the others), which is this table's stated rule
  // holding rather than a new one: a bench move is PUBLIC BY THE MOVE ITSELF, so
  // there is nothing a reveal clause would add for an opponent to verify.
  // 🛑 AND THE ABSENCE IS DRIVEN, NOT FILED: `familialMarch.test.ts` asserts the op
  // carries no `reveal` key AT ALL (`not.toHaveProperty`, so a `reveal: false`
  // would fail it), which is what makes this row a measurement instead of a
  // filing decision.
  [
    "sv08-158",
    "Maushold 'Familial March' (attack 0) — 'put them onto your Bench', no reveal printed",
  ],
  // 🆕 D352 — MORPEKO, AND IT IS **THE ONLY ID OF ITS SLICE THIS SWEEP CAN SEE**.
  // ⚠️ **A POPULATION HAS A FILTER, AND THE FILTER IS PART OF THE UNIT** (D351's
  // second defect, predicted here rather than repeated): D352 authors THREE
  // printings, and `swept.size` steps by exactly ONE — `searchOps` counts
  // `searchDeck` and `lookAtTopN` and NOT `attachFromTop`, so Metang `svp-090`/
  // `sv05-114` are in the POPULATION without ever being in the SET.
  // 🛑 AND THE DESTINATION IS THE **DISCARD**, WHICH IS A FIRST FOR THIS TABLE:
  // every other row here goes to the hand or to the Bench. It lands here anyway
  // and the rule is the same one stated above — a card put in the open pile is
  // PUBLIC BY THE MOVE ITSELF, so a reveal clause would add nothing an opponent
  // could verify. The sentence prints none, and that is what decides it.
  [
    "sv06-072",
    "Morpeko 'Snack Seek' (lookAtTopN, ABILITY) — 'You may discard that card', a declinable one-card look into the OPEN pile, no reveal printed",
  ],
  // 🆕🛑 D343 — THE FOUR ROWS THE BROKEN SWEEP WAS HIDING. None of these is a new
  // build; all four programs were already in the registry, three of them for many
  // slices, and one of them was authored by the IMMEDIATELY PRECEDING slice. Each
  // decided the only way this table permits — by reading the printed bytes off
  // remote D1 at this head — and every one of them prints no reveal clause.
  [
    "sv06-151",
    "Hassel (lookAtTopN 8, up to 3 to hand) — 'Look at the top 8 cards of your deck and put up to 3 of them into your hand.' A LOOK is private by construction; no reveal printed",
  ],
  [
    "sv05-144",
    "Buddy-Buddy Poffin (searchDeck to BENCH, basicPokemon maxHp 70, max 2) — 'put them onto your Bench', no reveal printed. The table's bench rule again: the move is public by itself",
  ],
  [
    "sv07-011",
    "Eldegoss 'Breezy Gift' (searchDeck on an ATTACK, anyCard to hand, max 3) — 'search your deck for up to 3 cards and put them into your hand', no reveal printed",
  ],
  // ⚠️ AND THIS ONE IS THE SHARPEST ARGUMENT FOR THE REPAIR: D342 BUILT IT AND
  // THE SWEEP STAYED GREEN. Its own registry doc even states the fact this row
  // records — "no `reveal` rider appears here: this sentence prints none, and
  // D135 says absent rather than `false`" — so the decision was MADE, correctly,
  // and simply never reached the table that exists to collect it. A discovered
  // census that cannot see the catalog does not fail; it agrees with you.
  [
    "sv05-145",
    "Ciphermaniac's Codebreaking (searchDeck anyCard, exact, dest deckTop) — 'Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order.' No reveal printed, and the cards go to a FACE-DOWN zone",
  ],
];

describe("D225 — which registry rows carry the rider", () => {
  it("every printed row in the table spells `reveal: true`, on all five surfaces", () => {
    for (const [id, printed] of REVEALING) {
      const ops = searchOps(id);
      expect(ops, `${id} (${printed}) has no search op`).toHaveLength(1);
      expect(ops[0], `${id} (${printed}) lost its printed reveal`).toMatchObject({ reveal: true });
    }
    expect(REVEALING).toHaveLength(29);// 🆕🛑 D343 +1 (Fan Rotom `sv07-118`/`sv08.5-085`) — NOT a new build. This program has been in the registry for many slices and no row named it, because the sweep below sweeps `FIXTURE_POOL` and could not see it. THE ONLY TABLE ROW IN THIS FILE'S HISTORY ADDED BY A POPULATION REPAIR RATHER THAN BY AN AUTHOR. Its Ability prints "reveal them" verbatim and the program already carried `reveal: true` — the DECISION was right and the FILING never happened. // 🆕 D338 adds Heatmor "Licking Catch" — ONE row for TWO printings, because the table is keyed on the program OBJECT and a reprint shares one. The FIRST row here on the ATTACK surface with a flat cap over a union, and the first whose plural is BOTH kinds at once: *"up to 3 in any combination of"* lets one noun phrase be taken three times AND two different nouns be mixed, where D337's was only the former and D336's only the latter. 🆕 D337 adds Ethan's Adventure — ONE sentence and ONE object, where D336's and D333's steps were two each; the FLAT cap over a union, and the first row here whose plural counts COPIES OF ONE NOUN PHRASE rather than several different nouns. 🆕 D336 adds Larry's Skill and Secret Box — the THREE- and FOUR-NOUN `searchDeck`, TWO sentences and two objects, and the SECOND time this table has grown by two in one slice. 🆕 D333 adds Roto-Stick and Bug Catching Set — TWO sentences, two objects, and the FIRST time this table has grown by two in one slice. 19 at D279 — D280 adds fix-callbell; D330 adds Team Rocket's Petrel; D332 adds fix-drayton
  });

  it("no bench search and no fixture carries it — absent, not `false` (D135)", () => {
    for (const [id, why] of NOT_REVEALING) {
      const ops = searchOps(id);
      expect(ops, `${id} (${why}) has no search op`).toHaveLength(1);
      // ⚠️ `not.toHaveProperty` rather than `reveal !== true`: an explicit
      // `reveal: false` would make two spellings of the same program unequal
      // under `toEqual`, which is how every registry pin in this repo is
      // written, and would pass a `!== true` check.
      expect(ops[0], `${id} (${why}) grew a reveal it does not print`).not.toHaveProperty("reveal");
    }
    expect(NOT_REVEALING).toHaveLength(16);// 🆕 D352 +1 — Morpeko `sv06-072` "Snack Seek", and the FIRST row in this table whose destination is the DISCARD rather than the hand or the Bench. The table's stated rule decides it unchanged: a card put in the open pile is public by the move itself, so a reveal clause would add nothing to verify — and the sentence prints none. ⚠️ **PREDICTING THE RIGHT TABLE IS THE CLAIM** (D339): `REVEALING` stands still at 29. // 🆕🛑 D343 +4 (Hassel, Buddy-Buddy Poffin, Eldegoss 'Breezy Gift', Ciphermaniac's Codebreaking) — none of them a new build, and the last of them authored by the IMMEDIATELY PRECEDING SLICE with this sweep staying green throughout. Four rows in one slice is the biggest this table has ever moved, and every one of them is a debt the broken population was hiding rather than a decision this slice made. // 🆕 D339 — Maushold `sv08-158` "Familial March", and the FIRST row to land in THIS table in six slices (D333/D334/D336/D337/D338 all landed in `REVEALING`, which stands still at 28). A bench move is public by the move itself, so no reveal clause is printed and none is authored. 🆕 D335 — Drakloak and Rika, and the FIRST row here on the ABILITY surface as well as the first pair in one slice. 🆕 D334 — Explorer's Guidance, the first row here that is neither a bench move nor a synthetic fixture
  });

  it("SWEEPS THE REGISTRY for search ops nobody classified — a DISCOVERED census", () => {
    // ⚠️ THE DEVICE THAT MAKES THE TWO TABLES ABOVE NON-VACUOUS, and the shape
    // worth copying (clauseApostrophe.test.ts's, D137): the population is
    // DISCOVERED rather than transcribed. Every id is asked for its program,
    // every `searchDeck` / `lookAtTopN` in it is collected, and each distinct
    // PROGRAM OBJECT must be classified by one of the tables above. A row added
    // by a later slice is swept the day it lands, and its author has to read the
    // printed sentence and decide — which is the entire reason the rider is
    // per-sentence rather than derived from `dest`. Reprints ride the same object
    // and so cost nothing.
    //
    // 🆕🛑🛑 **D343 — THE POPULATION WAS `FIXTURE_POOL` AND THAT WAS THE THIRD
    // INSTANCE OF ONE DEFECT IN THREE SLICES.** D341 repaired `preventBlock` §11
    // (swept the pool, not the deriver); D342 repaired `programWalk` (swept the
    // registry INTERSECTED WITH the pool, hiding 32 real programs); this is the
    // same bug in the auditor whose entire job is to be TOTAL.
    //
    // **THE QUESTION THAT DECIDES IT — DOES THIS LOOP NEED PRINTED CARD TEXT?**
    // It does not. The body calls `programFor(id)` and `searchOps(id)`, both
    // keyed on an ID, and never touches a fixture BODY. So the pool was never the
    // population; it was a SAMPLE, and a sample that happened to be lying around.
    //
    // **THE MEASUREMENT, at this head:** the pool sweep reached **27** ids on
    // **27** distinct programs. The registry reaches **103** ids on **44**. The
    // gap is not a rounding error and it is not fixtures — **FIVE distinct
    // programs spanning THIRTEEN real catalog ids** were unclassified, and the
    // sweep had been green over every one of them:
    //   • Fan Rotom `sv07-118`/`sv08.5-085` (an Ability that PRINTS "reveal them")
    //   • Hassel `sv06-151`/`sv06-205`
    //   • Buddy-Buddy Poffin `sv05-144`/`sv06-223`/`sv08.5-101`
    //   • Eldegoss `sv07-011` "Breezy Gift"
    //   • Ciphermaniac's Codebreaking `sv05-145`/`sv05-198`/`sv08.5-104`
    // ⚠️ **THE LAST ONE WAS BUILT BY THE SLICE IMMEDIATELY BEFORE THIS ONE** and
    // this sweep stayed green through it. That is the whole cost of the defect
    // stated in one fact: **A DISCOVERED CENSUS THAT CANNOT SEE THE CATALOG DOES
    // NOT FAIL — IT AGREES WITH YOU.**
    //
    // ⚠️ **THE UNION, NOT THE REGISTRY ALONE.** `registryCardIds()` is the real
    // population, but `FIXTURE_POOL` holds demonstrators (`fix-onko`,
    // `fix-pilescan`, `fix-metallicsignal`) that are NOT registry ids and that
    // earlier slices deliberately put in the sweep's reach. Dropping them to
    // "fix the population" would be this same defect wearing the opposite sign,
    // so the sweep is the UNION and the pool keeps paying for itself.
    const population = [...new Set([...registryCardIds(), ...Object.keys(FIXTURE_POOL)])];
    const classified = new Set([...REVEALING, ...NOT_REVEALING].map(([id]) => programFor(id)));
    const unclassified = new Set<string>();
    const swept = new Set<string>();
    for (const id of population) {
      const program = programFor(id);
      if (program === undefined || searchOps(id).length === 0) continue;
      swept.add(id);
      if (!classified.has(program)) unclassified.add(id);
    }
    expect([...unclassified].sort(), "a deck search nobody decided the reveal for").toEqual([]);
    // …and the sweep really did FIND things, so an empty result above is an
    // answer rather than an empty population — the attribution control the
    // conventions demand of any check whose subject is a shared artifact.
    // 🆕 D334 CORRECTED THE TWO NUMBERS THAT USED TO SIT HERE — "26 tabled ids on 26
    // distinct program objects" and "bodies for 16 of them", while the two assertions
    // below read 31 and 21. Two slices stale, and invisible to `tsc` because it is
    // prose. Stated now as what they actually are: the tabled ids sit on
    // `classified.size` distinct program objects (D199's near-twin rule: no two
    // printed sentences share one), and the shared pool holds bodies for `swept.size`
    // of them — the rest are reached by suites carrying their own local pool
    // (proton.test.ts's fix-proton is the deliberate example, kept out of
    // FIXTURE_POOL because ownerPrefix.test.ts sweeps it for owner prefixes).
    expect(classified.size).toBe(45);// 🆕 D352 +1 — `SNACK_SEEK`, a distinct object: `EXPLORERS_GUIDANCE`'s op with the window down to 1, the cap down to 1, and `exact`/`restTo` both absent, so D199's near-twin rule holds again (two printed sentences, two objects). ⚠️ AND 45 IS THE UNION RE-ADDED AGAINST ITS OWN PARTS, which D339's note demands: `REVEALING` 29 + `NOT_REVEALING` 16 = 45 ✅. // 🆕 D343 +5 — `REVEALING` 29 + `NOT_REVEALING` 15 = 44 ✅, the union re-added against its own parts exactly as D339's note demands. Every one of the five is a program that ALREADY EXISTED and was never tabled. // 🆕 D339 +1 (FAMILIAL_MARCH, a distinct object — the closest program yet built to `LICKING_CATCH`, and distinct from it in THREE independent fields: `dest` "bench" vs "hand", `max` 2 vs 3, and `reveal` ABSENT vs true, so D199's near-twin rule holds over-determined rather than narrowly: two printed sentences, two objects). ⚠️ **AND 39 IS THE UNION RE-ADDED AGAINST ITS OWN PARTS**: `REVEALING` 28 + `NOT_REVEALING` 11 = 39 ✅. The D338 handoff priced this line as "28 → 29", which is `REVEALING.length` mistaken for the union — a 28-row table unioned with an 11-row one cannot be 29, and the arithmetic is the thing that says so. 🆕 D338 +1 (LICKING_CATCH, a distinct object — Ethan's Adventure's program with the union's Pokémon member narrowed by TYPE instead of by OWNER, so D199's near-twin rule holds again: two printed sentences, two objects). 🆕 D337 +1 (ETHANS_ADVENTURE, a distinct object — Energy Search's two ops with the filter widened to a union and the cap raised to 3, so D199's near-twin rule holds again: two printed sentences, two objects). 🆕 D336 +2 (LARRYS_SKILL and SECRET_BOX, two distinct objects — Ultra Ball's program with a wider middle, twice, so D199's near-twin rule holds twice over: two printed sentences, two objects). 🆕 D335 +2 (DRAKLOAK and RIKA, two distinct objects — Explorer's Guidance's op with the leftovers DESTINATION moved, twice, so D199's near-twin rule holds twice over). 🆕 D334 +1 (EXPLORERS_GUIDANCE, a distinct object — Great Ball's op with all four fields moved, so D199's near-twin rule holds again: two printed sentences, two objects). 🆕 D333 +2 (ROTO_STICK and BUG_CATCHING_SET, two distinct objects — Pokégear's program with the cap taken off, and Great Ball's window under a narrowed union, so D199's near-twin rule holds twice over: two printed sentences, two objects). 🆕 D332 +1 (DRAYTON, a distinct object — Great Ball's program plus `also`, so D199's near-twin rule holds: two printed sentences, two objects). 26 at D279 — D280's CALL_BELL object; D330's TRAINER_SEARCH
    expect(swept.size).toBe(104);// 🆕 D352 +1 AND **ONLY** +1 FOR A THREE-PRINTING SLICE — `sv06-072` spells a `lookAtTopN` and enters the set; `svp-090`/`sv05-114` spell an `attachFromTop`, which `searchOps` does not count, so they are in the POPULATION and not in the SET. 🛑 **THIS IS D351's SECOND DEFECT PREDICTED INSTEAD OF PAID**: that slice predicted this figure would move off the union it sweeps and it did not, because a population has a FILTER. Read the filter, then the population. // 🆕🛑🛑 D343 — **27 → 103, AND THE JUMP IS THE BUG, NOT THE BUILD.** The sweep's population was `FIXTURE_POOL`; it is now `registryCardIds()` ∪ the pool. Nothing was authored to move this number. Every count below this line documents which DEMONSTRATOR entered the shared pool in which slice — an accurate history of the wrong number, kept because it records how a sample grew while pretending to be a population. THE PREVIOUS FIGURE COUNTED FIXTURES; THIS ONE COUNTS THE CATALOG. // 🆕 D337 +1 — `fix-ethansadventure` is in the SHARED pool, since `ethansAdventure.test.ts` plays the Supporter off `FIXTURE_POOL`; the generated manifest holds no `sv10` row, so ONE demonstrator is owed for ONE card. 🆕 D336 +2 — BOTH `fix-larrysskill` and `fix-secretbox` are in the SHARED pool, since `larrysSkill.test.ts` plays both Trainers off `FIXTURE_POOL`; neither `sv08.5` nor `sv06` is among the manifest's six sets. 🆕 D335 +2 — BOTH `fix-drakloak` and `fix-rika` are in the SHARED pool. ⚠️ AND `fix-drakloak` IS A **POKÉMON**, the first demonstrator on this line that is not a Trainer played off `FIXTURE_POOL`: it is keyed `fix-*` because `catalogManifest.test.ts` classifies real-looking fixture ids against a generated manifest of six sets and `sv06` is not one of them. 🆕 D334 +1 — `fix-explorersguidance` is in the SHARED pool, since its suite plays the Supporter off `FIXTURE_POOL`. 🆕 D333 +2 — BOTH `fix-rotostick` and `fix-bugcatchingset` are in the SHARED pool, since each new suite plays its Item off `FIXTURE_POOL`. 🆕 D332 +1 — `fix-drayton` is in the SHARED pool (`draytonWindow.test.ts` plays it off `FIXTURE_POOL`), so the sweep reaches it. 16 at D279 — `fix-callbell` is in FIXTURE_POOL; D330 — `fix-trainersearch` is too
  });
});
