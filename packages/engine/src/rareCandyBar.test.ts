import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  handPlayBarred,
  programFor,
  rareCandyOptions,
  redactGame,
} from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  typedEnergy,
} from "./testFixtures";

// D286 — RARE CANDY IS AN ITEM PLAYED FROM HAND, AND THE `"Item"` BAR REACHES IT.
//
// ── THE BUG, AND WHY IT SURVIVED THREE SLICES ───────────────────────────────
//
// D283 built the imposed hand-play lock and scoped it OFF the `rareCandy` action
// and off both payability mirrors, with this stated reason:
//
//     "it is not played through `playTrainer`'s Item branch at all — the
//      `rareCandy` action evolves instead"
//
// 🛑 **THAT SENTENCE IS TRUE ABOUT THIS ENGINE AND IRRELEVANT TO THE RULE.** It
// describes a DISPATCH TABLE, not a card. Rare Candy `sv01-191`/`sv01-256`/
// `swsh10.5-069` is an **Item card** (`trainer_type = "Item"`) that a player
// **plays from their hand**, so every printing of the `"Item"` bar stops it:
// Galvantula ex `sv07-051`/`-159`/`-168`, Budew `sv08.5-004`/`sv10.5w-044`/`-126`
// (the STAMPED source) and Tyranitar `sv09-095`, Jellicent ex `sv10.5w-045`/
// `-160`/`-168` (the CONTINUOUS one). Until this slice **none of them did**, and
// ⚠️ **NO TEST ASSERTED IT EITHER WAY** — the behaviour change moved ZERO
// assertions on a 5,844-test suite, which is D284's *"a refusal note is the one
// place a wrong sentence can sit forever"* collecting.
//
// ── THE PUT-vs-PLAY TENSION, RESOLVED ON THE PRINTED TEXT ───────────────────
//
// 🛑 **D285 REFUSED RARE CANDY FROM THE *POKÉMON-SURFACE* BAR AND THIS SLICE
// ADDS IT TO THE *ITEM* BAR. BOTH ARE RIGHT, AND THE REASON IS THAT THE TWO
// READINGS HAVE DIFFERENT OBJECTS.** One Rare Candy play moves TWO cards out of
// one hand, and the printed text names them differently:
//
//     "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your
//      hand that evolves from that Pokémon, PUT that card onto the Basic Pokémon
//      to evolve it, skipping the Stage 1. You can't use this card during your
//      first turn or on a Basic Pokémon that was put into play this turn."
//                                                    — Rare Candy, printed
//
//   • **RARE CANDY ITSELF is PLAYED.** It is the Item the player takes out of
//     hand and puts on the table; nothing in the sentence above is what moves it.
//     The `"Item"` bar's object is *"any **Item cards** from their hand"*, and
//     this card is one. **THIS READING GOVERNS THE TRAINER SURFACE**, and it is
//     what `cardplay.ts rareCandy` and `rareCandyOptions` now honour.
//   • **THE STAGE 2 is PUT.** *"**put** that card onto the Basic Pokémon"* — the
//     ITEM'S EFFECT moves it, not the player. Bronzong `sv05-069` bars *"any
//     Pokémon from their hand **to evolve** their Pokémon"* and Team Rocket's
//     Arbok `sv10-113` bars *"any Pokémon that has an Ability from their hand"*;
//     both name a PLAY, and a card an effect PUTS is not one. **THIS READING
//     GOVERNS THE POKÉMON SURFACE**, and it is why `pokemonPlayBarred` is
//     deliberately not asked by either site.
//
// ⚠️ **THE TWO DO NOT CONFLICT — WHAT CONFLICTED WAS D283's STATED REASON, NOT
// EITHER CONCLUSION.** D283 reached the right answer for the Pokémon surface
// (which did not exist yet) by an argument that also, wrongly, disposed of the
// Trainer one. The observable consequence is an ASYMMETRY, and §4 drives it in
// one breath: **a seat barred by Bronzong may still Rare Candy; a seat barred by
// Budew may not.** A suite that asserted only one direction would be green on a
// build that had collapsed the two surfaces into one.
//
// ⚠️ **AND IT IS THE RULES READING RATHER THAN THE SMALL ONE.** The reading that
// makes the diff smallest is "Rare Candy is special, leave it alone" — D283's.
// The reading the rules support costs a fourth read site, and that is what is
// built here.
//
// ── THE HAZARDS THIS SUITE IS SHAPED AROUND ────────────────────────────────
//
// ⚠️ **A ONE-SOURCE SUITE IS VACUOUS.** `handPlayBarred` funnels a STAMPED half
// and a CONTINUOUS half, and a fix wired to only one is green on every board
// driven from the other. §2 drives BOTH through the same action.
//
// ⚠️ **AN `"Item"`-ONLY SUITE CANNOT SEE A COLLAPSED CLASS LIST.** A build that
// barred Rare Candy under ANY hand-play lock is green on every Item assertion
// here. §3 drives Scream Tail ex `sv06-094` (a **Supporter** bar) and requires
// the Rare Candy to LAND — the assertion that separates the classes.
//
// ⚠️ **AND THE TWO MIRRORS DIVERGE FROM THE ENGINE IN OPPOSITE DIRECTIONS.**
// A lit row that the engine refuses is afford-then-reject; a greyed row the
// engine accepts is the same defect inverted and QUIETER, because a dead row is
// never clicked and so never reports itself. §5 pins the wire's `disabled` flag
// AND its Rare Candy option list against the engine's own answer on every board.

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows (shared with D283/D284/D285).
// ─────────────────────────────────────────────────────────────────────────────

/** The printed Rare Candy sentence — the whole put-vs-play argument in one row. */
const RARE_CANDY_TEXT =
  "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves " +
  "from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. " +
  "You can't use this card during your first turn or on a Basic Pokémon that was put into play " +
  "this turn.";
const ITEM_LOCK_TEXT =
  "During your opponent's next turn, they can't play any Item cards from their hand.";
const GALVANTULA_TEXT = `Discard all Energy from this Pokémon. ${ITEM_LOCK_TEXT}`;
const SCREAM_TEXT =
  "You can use this attack only if you go second, and only during your first turn. " +
  "Your opponent can't play any Supporter cards from their hand during their next turn.";
const BRONZONG_TEXT =
  "During your opponent's next turn, they can't play any Pokémon from their hand to evolve their Pokémon.";
const DAUNTING_GAZE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.";

/** The three legal Rare Candy printings — ⚠️ ALL THREE, because the fix is keyed
    on `Card.trainerType` and a reprint that lost the class would escape it. */
const RARE_CANDY = "sv01-191";
const RARE_CANDY_2 = "sv01-256";
const RARE_CANDY_3 = "swsh10.5-069";

/** The STAMPED `"Item"` source (an attack rider). */
const GALVANTULA = "sv07-051";
const BUDEW = "sv08.5-004";
/** The CONTINUOUS `"Item"` source (an Ability). */
const TYRANITAR = "sv09-095";
/** The STAMPED `"Supporter"` source — the CLASS control (§3). */
const SCREAM_TAIL = "sv06-094";
/** The STAMPED `"evolve"` source — the SURFACE control, and the put-vs-play
    asymmetry's other half (§4). */
const BRONZONG = "sv05-069";

/** Potion — a plain Item, so §2 can show the bar reaching the ORDINARY Item path
    on the very same board that refuses the Rare Candy. */
const ITEM = "sv01-188";
/** Professor's Research — the Supporter that must survive an `"Item"` bar. */
const SUPPORTER = "sv01-189";

/** The CONTROL body: same board, same hands, no rider and no Ability. Every
    "the bar bites" line below passes just as happily on a build that refused
    every Rare Candy, and this is the only thing that can tell them apart. */
const PLAIN = "fix-plain-candy";
/** The victim's Active — 340 HP, so Galvantula ex's 180 cannot Knock it Out and
    park the board on `ko:takePrizes`, where every refusal below would be green
    at the PHASE gate instead of at the rule under test. */
const WALL = "fix-candy-wall";

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

function galvantula(id: string): Card {
  return battler(id, {
    name: "Galvantula ex",
    hp: 260,
    retreat: 1,
    types: ["Lightning"],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Fulgurite", damage: 180, effect: GALVANTULA_TEXT },
    ],
  });
}

function budew(id: string): Card {
  return battler(id, {
    name: "Budew",
    hp: 30,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Itchy Pollen", damage: 10, effect: ITEM_LOCK_TEXT }],
  });
}

function screamTail(id: string): Card {
  return battler(id, {
    name: "Scream Tail ex",
    hp: 190,
    retreat: 1,
    types: ["Psychic"],
    attacks: [{ cost: ["Colorless"], name: "Scream", effect: SCREAM_TEXT }],
  });
}

function bronzong(id: string): Card {
  return battler(id, {
    name: "Bronzong",
    hp: 120,
    retreat: 2,
    types: ["Metal"],
    stage: "Stage1",
    attacks: [
      { cost: ["Colorless"], name: "Evolution Jammer", damage: 30, effect: BRONZONG_TEXT },
    ],
  });
}

/** ⚠️ NO ATTACK — the continuous source never swings in this suite, and an
    attack would give every refusal a second possible explanation. */
function tyranitar(id: string): Card {
  return battler(id, {
    name: "Tyranitar",
    hp: 180,
    retreat: 3,
    types: ["Darkness"],
    stage: "Stage2",
    abilities: [{ type: "Ability", name: "Daunting Gaze", effect: DAUNTING_GAZE_TEXT }],
  });
}

/** The two Rare Candy REPRINTS. `FIXTURE_POOL` ships only `sv01-191`, and a
    suite that drove one printing could not tell whether the fix keyed on the
    CLASS or on that id — so the other two are built here on the REAL ids
    (screamTail.test.ts's reprint idiom), which is what makes `programFor`
    resolve the shipped `RARE_CANDY` marker rather than a stand-in. */
function rareCandyCard(id: string): Card {
  const printed = FIXTURE_POOL[RARE_CANDY];
  if (printed === undefined) throw new Error("FIXTURE_POOL lost sv01-191");
  return { ...printed, id };
}

const LOCAL_CARDS: Record<string, Card> = {
  [RARE_CANDY_2]: rareCandyCard(RARE_CANDY_2),
  [RARE_CANDY_3]: rareCandyCard(RARE_CANDY_3),
  [GALVANTULA]: galvantula(GALVANTULA),
  [BUDEW]: budew(BUDEW),
  [SCREAM_TAIL]: screamTail(SCREAM_TAIL),
  [BRONZONG]: bronzong(BRONZONG),
  [TYRANITAR]: tyranitar(TYRANITAR),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Candy Barrier",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tackle", damage: 10 }],
  }),
  [WALL]: battler(WALL, {
    name: "Candy Wall",
    hp: 340,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Nudge", damage: 10 }],
  }),
  /** {C}-payable Energy, local to this suite so `FIXTURE_POOL` stays untouched
      and `catalogManifest.test.ts` stays green. */
  "fix-candy-energy": typedEnergy("fix-candy-energy", "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The SIXTEENTH seeded deck (D270's rule: a seeded suite gets its own deck).
    ⚠️ ALL THREE RARE CANDY PRINTINGS ARE IN IT, not only the one the boards drive
    most often — a reprint named only in §1's catalog check would otherwise be
    untestable on a board. */
const CANDY_DECK = deckOf({
  [GALVANTULA]: 3,
  [BUDEW]: 3,
  [SCREAM_TAIL]: 3,
  [BRONZONG]: 3,
  [TYRANITAR]: 4,
  [PLAIN]: 5,
  [WALL]: 4,
  [RARE_CANDY]: 6,
  [RARE_CANDY_2]: 3,
  [RARE_CANDY_3]: 3,
  [ITEM]: 4,
  [SUPPORTER]: 4,
  "fix-basic-1": 4,
  "fix-stage2": 5,
  // ⚠️ THE BRIDGE, AND IT IS IN THE **DECK** RATHER THAN ONLY THE POOL.
  // `stage2EvolvesFromBasic` scans `state.cardPool`, which `createGame` PRUNES to
  // the cards the decks actually name — so a fix-stage1 present only in
  // `FIXTURE_POOL` is invisible to the chain check and every Rare Candy here
  // would fail `RARE_CANDY_NO_STAGE2` for a reason that is not the rule.
  "fix-stage1": 2,
  "fix-candy-energy": 4,
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [8311, 8317, 8329, 8353] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** D275's `localSetup` with the FIRST PLAYER as a PARAMETER — a one-seat board is
    vacuous on a per-seat fact, and "whose hand is barred" is exactly one. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: CANDY_DECK, p2: CANDY_DECK }, cardPool: POOL });
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

/** `barrier` holds `barrierId` Active with two {C} attached; the VICTIM holds a
    340 HP Wall Active and a **fix-basic-1 on the bench** — the Rare Candy target,
    placed with `turnPlayed: 0` so §7.1's came-into-play-this-turn ban is never
    what refuses. Both seats hold a Rare Candy, a fix-stage2, a Potion and a
    Professor's Research, and both are damaged so Potion always has a legal
    target and a refusal at its row can only ever be the rule under test. */
function board(seed: number, first: Seat, barrier: Seat, barrierId: string): GameState {
  let state = localSetup(seed, first);
  const victim = barrier === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, barrier, barrierId);
  state = clearBench(state, barrier);
  state = benchFromDeck(state, barrier, "fix-basic-1");
  state = setActiveFromDeck(state, victim, WALL);
  state = clearBench(state, victim);
  state = benchFromDeck(state, victim, "fix-basic-1");
  state = attachFromDeck(state, barrier, "fix-candy-energy", 2);
  for (const seat of ["p1", "p2"] as const) {
    state = handFromDeck(state, seat, RARE_CANDY, 1);
    state = handFromDeck(state, seat, "fix-stage2", 1);
    state = handFromDeck(state, seat, ITEM, 1);
    state = handFromDeck(state, seat, SUPPORTER, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Walk to `seat`'s turn, at turn 3 or later so §4's first-turn bans are spent. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

function swing(state: GameState, seat: Seat, index = 0): GameState {
  return must(applyAction(state, { type: "attack", seat, index }));
}

/** Try the Rare Candy from `seat`'s hand onto its BENCHED Basic and report the
    error code, or "OK". ⚠️ EVERY §2–§4 ASSERTION GOES THROUGH THIS, so a green
    "the bar refuses" line can never be a refusal for the WRONG reason. */
function candy(state: GameState, seat: Seat, candyId = RARE_CANDY): string {
  const uid = handUid(state, seat, candyId);
  const evolutionUid = handUid(state, seat, "fix-stage2");
  const result = applyAction(deepFreeze(state), {
    type: "rareCandy",
    seat,
    uid,
    target: { spot: "bench", index: 0 },
    evolutionUid,
  });
  return result.ok ? "OK" : result.error.code;
}

/** Play an ordinary Trainer and report the code — the class controls. */
function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

/** The wire projection's own answer for a Trainer row. */
function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.uid === handUid(state, seat, cardId))?.disabled;
}

/** The wire's Rare Candy DIALOG — the second thing `rareCandyOptions` feeds, and
    the one greying a row alone would never have closed. */
function wireCandyOptions(state: GameState, seat: Seat): number {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.rareCandy.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE CLASS CLAIM — the whole slice rests on ONE catalog field.
// ─────────────────────────────────────────────────────────────────────────────

describe("D286 §1 — Rare Candy's CLASS, which is the entire argument", () => {
  it("🛑 ALL THREE PRINTINGS ARE `trainerType: \"Item\"` — the fix is keyed on this and nothing else", () => {
    // ⚠️ THE ONE FACT THE SLICE CANNOT SURVIVE BEING WRONG ABOUT. Every read site
    // asks `handPlayBarred(state, seat, "Item", undefined)` because the CARD says Item; if a
    // printing's catalog row said otherwise the bar would miss it, and this is the
    // only place that can go red for that reason.
    for (const id of [RARE_CANDY, RARE_CANDY_2, RARE_CANDY_3]) {
      const card = POOL[id];
      expect(card, `${id} must resolve on this board's pool`).toBeDefined();
      expect(card?.category, id).toBe("Trainer");
      expect(card?.trainerType, `${id} must be an Item — the whole fix hangs on it`).toBe("Item");
      // …and the REGISTRY agrees it is Rare Candy, so `rareCandy`'s own
      // `TRAINER_NOT_SIMULATED` gate can never be what refuses a printing below.
      expect(programFor(id)?.rareCandy, `${id} must carry the Rare Candy marker`).toBe(true);
    }
    // ⚠️ THE ATTRIBUTION CONTROL: Potion is an Item too and is NOT Rare Candy, so
    // the pair above is a conjunction rather than "every Item looks like this".
    expect(POOL[ITEM]?.trainerType).toBe("Item");
    expect(programFor(ITEM)?.rareCandy).toBeUndefined();
  });

  it("the printed sentence says PUT for the Stage 2 and never says PLAY for it", () => {
    // The put-vs-play resolution, pinned as text rather than left in prose. The
    // card names its own act ("use this card") and names the Stage 2's act
    // separately ("put that card onto"), and those two words are the reason the
    // Item bar reaches this action while the Pokémon-surface bar does not.
    expect(RARE_CANDY_TEXT).toContain("put that card onto the Basic Pokémon to evolve it");
    expect(RARE_CANDY_TEXT).toContain("You can't use this card during your first turn");
    // ⚠️ THE NEGATIVE HALF, and it is the load-bearing one: the printed effect
    // never calls the Stage 2's movement a PLAY, which is what Bronzong and Arbok
    // both bar. A reading that let "put" mean "play" would bar this action twice.
    expect(RARE_CANDY_TEXT).not.toContain("play that card");
    // ⚠️ THE WORD "play" DOES OCCUR — twice, and BOTH times as a ZONE ("*in
    // play*", "*put into play*") rather than as the verb. Strip the two zone
    // phrases and the printed effect contains no PLAY at all, which is the exact
    // claim: this card's own text never asks anyone to play the Stage 2.
    expect(RARE_CANDY_TEXT).toContain("Basic Pokémon in play");
    expect(RARE_CANDY_TEXT).toContain("put into play this turn");
    expect(RARE_CANDY_TEXT.replaceAll("in play", "").replaceAll("into play", "")).not.toContain(
      "play",
    );
    // …while both Pokémon-surface sentences DO name a play, so the distinction is
    // real on the printed side and not an artefact of this engine's vocabulary.
    expect(BRONZONG_TEXT).toContain("can't play any Pokémon from their hand to evolve");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE BAR BITES — through BOTH sources, on EVERY seed and BOTH assignments.
// ─────────────────────────────────────────────────────────────────────────────

describe("D286 §2 — the `\"Item\"` bar refuses the rareCandy action", () => {
  it("🛑 THE STAMPED SOURCE — Galvantula ex's rider stops the victim's Rare Candy", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        for (const barrier of ["p1", "p2"] as const) {
          const victim = barrier === "p1" ? "p2" : "p1";
          const stamped = swing(turnOf(board(seed, first, barrier, GALVANTULA), barrier), barrier);
          const open = turnOf(stamped, victim);
          expect(handPlayBarred(open, victim, "Item", undefined)).toBe(true);
          expect(candy(open, victim)).toBe("HAND_PLAY_BLOCKED");
          // The ORDINARY Item path is refused on the SAME board, which is what
          // makes this one line about Rare Candy rather than about the bar.
          expect(play(open, victim, ITEM)).toBe("HAND_PLAY_BLOCKED");
          // ⚠️ AND THE BARRING SEAT'S OWN HAND IS FREE. The sentence reads "your
          // opponent can't play", and a build that dropped the seat flip is green
          // on every line above and red here.
          const back = turnOf(open, barrier);
          expect(candy(back, barrier)).toBe("OK");
        }
      }
    }
  });

  it("🛑 THE CONTINUOUS SOURCE — Tyranitar's Ability stops it with no attack in the game", () => {
    // A fix wired to `stampedBarFor` alone is green on every §2a line and red
    // here; a fix wired to the passive alone is the reverse. Both halves funnel
    // through `handPlayBarred`, and this is what says so.
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        for (const barrier of ["p1", "p2"] as const) {
          const victim = barrier === "p1" ? "p2" : "p1";
          const open = turnOf(board(seed, first, barrier, TYRANITAR), victim);
          expect(handPlayBarred(open, victim, "Item", undefined)).toBe(true);
          expect(candy(open, victim)).toBe("HAND_PLAY_BLOCKED");
          expect(candy(turnOf(open, barrier), barrier)).toBe("OK");
        }
      }
    }
  });

  it("🛑 THE CONTROL — the SAME boards with a body that bars nothing accept it", () => {
    // Without this the whole suite is green on a build that refused every Rare
    // Candy for any reason at all.
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        for (const barrier of ["p1", "p2"] as const) {
          const victim = barrier === "p1" ? "p2" : "p1";
          const open = turnOf(board(seed, first, barrier, PLAIN), victim);
          expect(handPlayBarred(open, victim, "Item", undefined)).toBe(false);
          expect(candy(open, victim)).toBe("OK");
        }
      }
    }
  });

  it("every printing, not just the one the boards drive", () => {
    // The fix reads `Card.trainerType`, so all three reprints must behave alike —
    // and a fixture that only ever drove `sv01-191` could not tell.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    const free = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    for (const id of [RARE_CANDY, RARE_CANDY_2, RARE_CANDY_3]) {
      let withCandy = handFromDeck(barred, "p2", id, 1);
      expect(candy(withCandy, "p2", id), id).toBe("HAND_PLAY_BLOCKED");
      withCandy = handFromDeck(free, "p2", id, 1);
      expect(candy(withCandy, "p2", id), id).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE CLASS CONTROL — a `"Supporter"` bar must leave Rare Candy alone.
// ─────────────────────────────────────────────────────────────────────────────

describe("D286 §3 — the bar is the `\"Item\"` one and ONLY the `\"Item\"` one", () => {
  it("🛑 SCREAM TAIL ex BARS SUPPORTERS AND THE RARE CANDY LANDS", () => {
    // ⚠️ THE ASSERTION THAT SEPARATES THE CLASSES. A build that asked "is this
    // seat barred at all" instead of "is it barred for Items" is green on every
    // line in §2 and red on exactly this one.
    // Scream Tail's own gate demands the going-SECOND seat's FIRST turn, so the
    // barrier must be going second and swings on turn 2.
    for (const seed of SEEDS) {
      const barrier = "p2" as const;
      let open = board(seed, "p1", barrier, SCREAM_TAIL);
      open = must(applyAction(open, { type: "endTurn", seat: "p1" }));
      open = turnOf(swing(open, barrier), "p1");
      expect(handPlayBarred(open, "p1", "Supporter", undefined)).toBe(true);
      expect(handPlayBarred(open, "p1", "Item", undefined)).toBe(false);
      expect(play(open, "p1", SUPPORTER)).toBe("HAND_PLAY_BLOCKED");
      // …and the Item half of the same hand is untouched, Rare Candy included.
      expect(play(open, "p1", ITEM)).toBe("OK");
      expect(candy(open, "p1")).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE PUT-vs-PLAY ASYMMETRY, DRIVEN IN ONE BREATH.
// ─────────────────────────────────────────────────────────────────────────────

describe("D286 §4 — barred by Bronzong you may still Rare Candy; barred by Budew you may not", () => {
  it("🛑 THE POKÉMON-SURFACE BAR MISSES IT — *put* is not *play*, and the engine agrees", () => {
    // D285's reading, now load-bearing in the opposite direction. Bronzong bars
    // *"any Pokémon from their hand **to evolve** their Pokémon"*; the Stage 2 a
    // Rare Candy puts is not played, so the action survives — and it survives
    // THROUGH `applyAction`, not only through the reader.
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const stamped = swing(turnOf(board(seed, first, "p1", BRONZONG), "p1"), "p1");
        const open = turnOf(stamped, "p2");
        // The evolve surface really is barred on this board — the attribution
        // control, so the OK below cannot be "the stamp never landed".
        expect(handPlayBarred(open, "p2", "Item", undefined)).toBe(false);
        expect(open.handPlayLockedTurn.p2.evolve).toBe(open.turn);
        // …and the Rare Candy goes through anyway.
        expect(candy(open, "p2")).toBe("OK");
      }
    }
  });

  it("🛑 AND THE ITEM BAR HITS IT — the same board shape, the other sentence", () => {
    // The other half of the asymmetry, on the same seeds and the same seats, so
    // the pair is a CONTRAST rather than two unrelated facts. Budew stamps the
    // same `"Item"` key Galvantula does off a 10-damage attack.
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const stamped = swing(turnOf(board(seed, first, "p1", BUDEW), "p1"), "p1");
        const open = turnOf(stamped, "p2");
        expect(open.handPlayLockedTurn.p2.Item).toBe(open.turn);
        expect(open.handPlayLockedTurn.p2.evolve).toBeNull();
        expect(candy(open, "p2")).toBe("HAND_PLAY_BLOCKED");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE TWO MIRRORS — the row AND the dialog, against the engine's own answer.
// ─────────────────────────────────────────────────────────────────────────────

describe("D286 §5 — `rareCandyOptions` and the wire agree with `rareCandy`", () => {
  it("🛑 `rareCandyOptions` GOES EMPTY UNDER THE BAR — its docstring promises exactly this", () => {
    // *"Mirrors the handler's … checks, so an option here always resolves to a
    // legal `rareCandy` action"*. The moment the handler gained the bar that
    // promise was false for a barred seat; this is the assertion that keeps it
    // true. ⚠️ THE ENGINE'S OWN ANSWER IS THE ORACLE — the option list is
    // compared against what `applyAction` does, not against a hard-coded number.
    for (const seed of SEEDS) {
      for (const barrierId of [TYRANITAR, PLAIN]) {
        const open = turnOf(board(seed, "p1", "p1", barrierId), "p2");
        const accepted = candy(open, "p2") === "OK";
        expect(rareCandyOptions(open, "p2").length > 0, `${barrierId}`).toBe(accepted);
        expect(wireCandyOptions(open, "p2") > 0, `${barrierId} on the wire`).toBe(accepted);
      }
    }
  });

  it("🛑 THE WIRE ROW IS GREYED EXACTLY WHEN THE ENGINE REFUSES — both directions", () => {
    // Afford-then-reject in one direction, a dead row in the other. Both are
    // caught by comparing the flag against the action rather than against a
    // literal, on a barred board AND a free one.
    for (const seed of SEEDS) {
      for (const barrierId of [TYRANITAR, PLAIN]) {
        const open = turnOf(board(seed, "p1", "p1", barrierId), "p2");
        const refused = candy(open, "p2") !== "OK";
        expect(wireDisabled(open, "p2", RARE_CANDY), `${barrierId}`).toBe(refused);
        // The ordinary Item row moves with it, and the Supporter row does not.
        expect(wireDisabled(open, "p2", ITEM), `${barrierId} item`).toBe(refused);
        expect(wireDisabled(open, "p2", SUPPORTER), `${barrierId} supporter`).toBe(false);
      }
    }
  });

  it("the STAMPED source greys the same two rows — one mirror, both sources", () => {
    for (const seed of SEEDS) {
      const stamped = swing(turnOf(board(seed, "p1", "p1", GALVANTULA), "p1"), "p1");
      const open = turnOf(stamped, "p2");
      expect(wireDisabled(open, "p2", RARE_CANDY)).toBe(true);
      expect(wireDisabled(open, "p2", ITEM)).toBe(true);
      expect(wireDisabled(open, "p2", SUPPORTER)).toBe(false);
      expect(wireCandyOptions(open, "p2")).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. MATCH_RECORD_VERSION — 16, UNCHANGED, AND DRIVEN RATHER THAN ARGUED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D286 §6 — the version does NOT move, and the claim is driven", () => {
  it("🛑 A REAL JSON ROUND TRIP CARRIES THE WHOLE ANSWER — the gate is a DERIVED READ", () => {
    // ⚠️ THE TEST IS THE STANDING ONE (match.ts): *can the PREVIOUS deploy's
    // RECORD hold the new TYPE*. This slice adds no `GameState` field, no key on
    // an existing one, no `EffectOp`, no event and no rename — it adds a READ of
    // data a v16 record already carries. So a v16 record resumed under this
    // deploy answers the new question correctly WITHOUT migration, which is what
    // "no bump" has to mean rather than what it is asserted to mean.
    for (const seed of SEEDS) {
      // The STAMPED half, whose answer is written down in the record…
      const stamped = swing(turnOf(board(seed, "p1", "p1", BUDEW), "p1"), "p1");
      const open = turnOf(stamped, "p2");
      const reloaded = JSON.parse(JSON.stringify(open)) as GameState;
      expect(handPlayBarred(reloaded, "p2", "Item", undefined)).toBe(true);
      expect(candy(reloaded, "p2")).toBe("HAND_PLAY_BLOCKED");
      // …and the CONTINUOUS half, whose answer is RECOMPUTED from the board.
      const passive = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      const passiveReloaded = JSON.parse(JSON.stringify(passive)) as GameState;
      expect(passiveReloaded.handPlayLockedTurn.p2.Item).toBeNull();
      expect(candy(passiveReloaded, "p2")).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("🛑 AND NOTHING PERSISTED MOVED — the diff, PAIRED with a literal anchor", () => {
    // D279's half-guard rule: a DIFF between two boards from ONE build is blind
    // to "every board grew a key", so the literal key lists sit beside it. These
    // are the SAME lists D285 installed, unchanged — which is the whole claim.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    const free = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    expect(Object.keys(barred).sort()).toEqual(Object.keys(free).sort());
    expect(Object.keys(barred).sort()).toEqual(
      [
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
      ].sort(),
    );
    for (const seat of ["p1", "p2"] as const) {
      expect(Object.keys(barred.handPlayLockedTurn[seat]).sort()).toEqual(
        ["Item", "Supporter", "evolve"].sort(),
      );
    }
    expect(Object.keys(barred.allowances).sort()).toEqual(Object.keys(free.allowances).sort());
    const bodyKeys = (s: GameState): string[] => Object.keys(s.players.p2.active ?? {}).sort();
    expect(bodyKeys(barred)).toEqual(bodyKeys(free));
  });
});
