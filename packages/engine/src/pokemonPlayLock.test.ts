import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  deriveAttackEffect,
  handPlayBarred,
  pokemonPlayBarred,
  programFor,
} from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// D285 — THE POKÉMON-SURFACE PLAY-FROM-HAND GATE, AND THE TWO PRINTINGS D283 AND
// D284 EACH REFUSED FOR THE SAME MISSING MECHANISM.
//
// THE SENTENCES. Two of them, one per source, and they are the WHOLE Standard
// population of a bar on a Pokémon play:
//
//   "During your opponent's next turn, they can't play any Pokémon from their
//    hand to evolve their Pokémon."
//        — Bronzong `sv05-069` "Evolution Jammer", 1 legal printing. D283's
//          turn-scoped STAMP at a NEW ACT; text-derived, no registry row.
//   "As long as this Pokémon is in the Active Spot, your opponent can't play any
//    Pokémon that has an Ability from their hand, except for Team Rocket's
//    Pokémon."
//        — Team Rocket's Arbok `sv10-113` "Potent Glare", 1 legal printing.
//          D284's CONTINUOUS passive at the same new act.
//
// ── THE CENSUS, AND IT WAS RUN ON THE *ACT* RATHER THAN ON THE CLASS ─────────
//
// 🛑 **THE HANDOFF PRICED THIS AT 2 AND SAID TO ASK WHAT ELSE BARS AN EVOLVE OR
// A BENCH PLACEMENT, BECAUSE A GATE SURFACE PRICED AT 2 IS A BAD TRADE AND ONE
// PRICED AT 6 IS THE BEST ROW ON THE PAGE.** Asked. Remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 2026-08-08, `legal_standard = 1`,
// one row of `SUM(instr(col,…)>0)` per column (D283's compound-SELECT limit):
//
//     predicate                                  attack  ability  effect
//     instr(col, "play any Pokémon")                 1        1       0
//     instr(col, "can't play any Pokémon")           1        1       0
//     instr(col, "play Pokémon")                     0        0       0
//     instr(col, "can't put")                        0        0       0
//     instr(col, "can't play any Basic")             0        0       0
//     instr(col, "from their hand to evolve")        1        1       —
//
// ⚠️ **THE ANSWER IS 2 AND THE WIDENING DID NOT MOVE IT** — which is D284's
// finding one slice later and in the direction that PRICES THE ROW DOWN rather
// than up. The one extra row the last rung turns up is Team Rocket's Ampharos
// `sv10-074` "Darkest Impulse" (*"**Whenever** your opponent plays a Pokémon from
// their hand to evolve 1 of their Pokémon, put 4 damage counters…"*): the same
// ACT, read as a TRIGGER rather than as a BAR, and refused here by name — the
// missing mechanism is an ON-OPPONENT-EVOLVE trigger, which no `triggered` hook
// in this engine fires on the other seat's play.
//
// 🛑 **SO THE ROW IS PRICED HONESTLY AT 2 PRINTINGS FOR A WHOLE NEW GATE
// SURFACE, AND IT IS TAKEN ANYWAY FOR A REASON THAT IS NOT THE PRINTING COUNT**:
// it is the ONLY row on the backlog that closes TWO standing refusals at once,
// it is the first hand-play row in the family to ship EXHAUSTIVE (D283 shipped 8
// of 9, D284 shipped 4 of 7, this ships 2 of 2), and both sources fall out of
// funnels that already exist. **If the next slice wants a cheaper trade it should
// not look here — this family is now closed except Copperajah and Genesect.**
//
// ── THE FOUR WAYS A BUILD OF THIS PASSES A SUITE IT SHOULD FAIL ──────────────
//
// ⚠️ **A ONE-ACT SUITE IS VACUOUS ON THE SPLIT.** Bronzong bars *"to evolve"* and
// Arbok bars the PLAY, so a build with one `"pokemon"` act is green on every
// evolve assertion and wrong on a Bench drop the turn after an Evolution Jammer.
// §4 requires a BENCH placement to LAND on a Bronzong-stamped board.
//
// ⚠️ **A FILTER-FREE BUILD IS GREEN ON EVERY ARBOK EVOLVE THAT USES AN
// ABILITY-BEARING CARD**, which is the natural fixture to reach for. §5 plays an
// Ability-LESS Pokémon into an Arbok board and requires it to LAND.
//
// ⚠️ **AN `&&` OF THE TWO CLAUSES REFUSES THE ONE BODY THE SENTENCE EXEMPTS.**
// "that has an Ability" and "except for Team Rocket's Pokémon" both hold of Team
// Rocket's Mimikyu; the printed sentence lets it through and a conjunction bars
// it. §5 drives exactly that body.
//
// ⚠️ **AND THE NARROWED NOUN IS THE CARD BEING PLAYED, NOT THE BODY IT LANDS
// ON.** A build that filtered the TARGET is green on every board where both
// carry an Ability or neither does. §5 drives both crossed boards.

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows.
// ─────────────────────────────────────────────────────────────────────────────

const JAMMER_TEXT =
  "During your opponent's next turn, they can't play any Pokémon from their hand to evolve their Pokémon.";
const POTENT_GLARE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Pokémon that has an Ability from their hand, except for Team Rocket's Pokémon.";
/** The REFUSED trigger sentence, pinned so its refusal stays checkable — D284's
    rule that a refusal note is the one place a wrong sentence can sit forever. */
const DARKEST_IMPULSE_TEXT =
  "Whenever your opponent plays a Pokémon from their hand to evolve 1 of their Pokémon, put 4 damage counters on that Pokémon. The effect of Darkest Impulse doesn't stack.";

const BRONZONG = "sv05-069";
const ARBOK = "sv10-113";
const AMPHAROS = "sv10-074";
/** The two rows of D284's 7-printing census that are still refused. */
const COPPERAJAH = "sv06.5-042";
const GENESECT = "sv06.5-040";

/** The CONTROL barrier: same board, no Ability, no attack effect. Every "the bar
    bites" line below passes just as happily on a build that refused every play. */
const PLAIN = "fix-plain-jammer";
/** The evolution CONTROL — a Stage 1 with NO Ability, so Arbok's `only` filter is
    what must let it through and not the absence of a bar. */
const EVO_PLAIN = "fix-stage1";
/** A Stage 1 that HAS an Ability — the card Arbok's noun actually names. */
const EVO_ABILITY = "fix-evo-ability";
/** A Stage 1 that has an Ability AND the owner prefix — the body the printed
    EXCEPTION exempts, and the one an `&&` reading refuses. */
const EVO_ROCKET = "fix-evo-rocket";
/** A Basic with an Ability — the §7.5 half, which only the CONTINUOUS source
    reaches. Named `fix-basic-1`-compatibly so it can be benched from the deck. */
const BASIC_ABILITY = "fix-basic-ability";
/** The Basic CONTROL, straight out of the shared pool. */
const BASIC_PLAIN = "fix-basic-1";

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

/** Bronzong `sv05-069`, carrying the catalog's own HP/type/stage and BOTH printed
    attacks at their printed indices. ⚠️ THE SECOND ATTACK IS LOAD-BEARING: the
    card prints two, so nothing on the board after the swing records WHICH was
    used — which is the whole reason the bar has to be a persisted STAMP and not
    a derived read (types.ts `handPlayLockedTurn`, D283's Part B argument
    re-derived on this printing rather than cited from that one). */
function bronzong(id: string): Card {
  return battler(id, {
    name: "Bronzong",
    hp: 120,
    retreat: 3,
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Bronzor",
    attacks: [
      { name: "Evolution Jammer", cost: ["Psychic"], damage: "30", effect: JAMMER_TEXT },
      { name: "Super Psy Bolt", cost: ["Psychic", "Colorless", "Colorless"], damage: "100" },
    ],
  });
}

/** Team Rocket's Arbok `sv10-113` — the CONTINUOUS half. ⚠️ NO ATTACK EFFECT:
    this body never swings in this suite, and an attack rider would give every
    refusal below a second possible explanation. */
function arbok(id: string): Card {
  return battler(id, {
    name: "Team Rocket's Arbok",
    hp: 120,
    retreat: 2,
    types: ["Darkness"],
    stage: "Stage1",
    evolveFrom: "Team Rocket's Ekans",
    abilities: [{ type: "Ability", name: "Potent Glare", effect: POTENT_GLARE_TEXT }],
  });
}

/** A Stage 1 off the fixture evolution line (`fix-basic-1` → here), with `name`
    and `abilities` as the only things that vary — so the three evolution cards
    below differ in EXACTLY the two fields the printed sentence reads. */
function evolution(id: string, name: string, hasAbility: boolean): Card {
  return battler(id, {
    name,
    hp: 90,
    retreat: 2,
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    abilities: hasAbility
      ? [{ type: "Ability", name: "Fixture Sense", effect: "Does nothing." }]
      : null,
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [BRONZONG]: bronzong(BRONZONG),
  [ARBOK]: arbok(ARBOK),
  [EVO_ABILITY]: evolution(EVO_ABILITY, EVO_ABILITY, true),
  [EVO_ROCKET]: evolution(EVO_ROCKET, "Team Rocket's Fixture", true),
  [BASIC_ABILITY]: battler(BASIC_ABILITY, {
    name: BASIC_ABILITY,
    hp: 70,
    retreat: 1,
    abilities: [{ type: "Ability", name: "Fixture Sense", effect: "Does nothing." }],
  }),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Jammer",
    hp: 200,
    retreat: 1,
    types: ["Psychic"],
    stage: "Stage1",
    attacks: [{ name: "Nothing At All", cost: ["Psychic"], damage: "30" }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The SIXTEENTH seeded deck (D270's rule: a seeded suite gets its own deck). */
const LOCK_DECK = deckOf({
  [BRONZONG]: 4,
  [ARBOK]: 4,
  [PLAIN]: 4,
  [EVO_PLAIN]: 4,
  [EVO_ABILITY]: 4,
  [EVO_ROCKET]: 4,
  [BASIC_ABILITY]: 4,
  [BASIC_PLAIN]: 8,
  "fix-psychic-energy": 24,
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [7201, 7213, 7219, 7229] as const;

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

/** D275's `localSetup`, with the FIRST PLAYER as a parameter — a one-seat board
    is vacuous on a per-seat fact, and "whose hand is barred" is exactly one. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: LOCK_DECK, p2: LOCK_DECK }, cardPool: POOL });
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

/** `barrier` holds `barrierId` Active with an Energy on it (so `swing` below can
    pay {P}); BOTH seats hold all three evolution cards plus both Basics, and both
    have a `fix-basic-1` on the bench for those evolutions to land on.

    ⚠️ THE BENCH BODY IS LOAD-BEARING TWICE OVER — §14.2 makes an empty Bench a
    LOSS the moment an Active leaves, and `benchFromDeck` stamps `turnPlayed: 0`,
    which is what keeps §10's "came into play this turn" ban off every evolve
    below. A refusal here must be the rule under test. */
function board(seed: number, first: Seat, barrier: Seat, barrierId: string): GameState {
  let state = localSetup(seed, first);
  const victim = barrier === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, barrier, barrierId);
  state = clearBench(state, barrier);
  state = benchFromDeck(state, barrier, BASIC_PLAIN);
  state = setActiveFromDeck(state, victim, PLAIN);
  state = clearBench(state, victim);
  state = benchFromDeck(state, victim, BASIC_PLAIN);
  for (const seat of ["p1", "p2"] as const) {
    state = handFromDeck(state, seat, EVO_PLAIN, 1);
    state = handFromDeck(state, seat, EVO_ABILITY, 1);
    state = handFromDeck(state, seat, EVO_ROCKET, 1);
    state = handFromDeck(state, seat, BASIC_ABILITY, 1);
    state = handFromDeck(state, seat, BASIC_PLAIN, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Walk the clock so `seat` is the one to move on turn 3 or later. ⚠️ THE
    MINIMUM IS LOAD-BEARING AND NOT A ROUND NUMBER: §4 bans an evolve on a seat's
    OWN first turn and §4 bans the going-first seat's turn-1 attack, so a suite
    that stopped at the first matching turn would read `FIRST_TURN_EVOLVE` /
    `FIRST_TURN_ATTACK` everywhere and call it a bar. Both seats are past their
    first turn from turn 3 on. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

/** Attach one Energy from hand and swing attack `index` — the only route by
    which the STAMP is written in this file. Attacking ends the turn (§5.3), so
    the returned board is the BARRED seat's. */
function swing(state: GameState, seat: Seat, index: number): GameState {
  let next = state;
  const energy = next.players[seat].hand.find(
    (h) => next.cardIdByUid[h] === "fix-psychic-energy",
  );
  if (energy === undefined) throw new Error(`${seat} has no energy in hand`);
  next = must(
    applyAction(next, { type: "attachEnergy", seat, uid: energy, target: { spot: "active" } }),
  );
  return must(applyAction(next, { type: "attack", seat, index }));
}

/** Evolve `seat`'s BENCHED `fix-basic-1` using `cardId` from hand, and report the
    error code or "OK". Every assertion goes through this so a green "the bar
    refuses" line can never be a refusal for the WRONG reason. */
function evolve(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), {
    type: "evolve",
    seat,
    uid,
    target: { spot: "bench", index: 0 },
  });
  return result.ok ? "OK" : result.error.code;
}

/** The §7.5 twin — the read site Bronzong's sentence deliberately cannot reach. */
function bench(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playBasicToBench", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE POPULATION, AND WHAT THIS VOCABULARY REACHES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §1 — the census, and the two printings it reaches", () => {
  it("the fixtures carry the PRINTED sentences byte for byte", () => {
    // D284's rule: a claim that lives only in a comment cannot go red. Both
    // printed strings are pinned here, so a fixture that drifted from the catalog
    // would be testing a card nobody printed.
    expect(POOL[BRONZONG]?.attacks?.[0]?.effect).toBe(JAMMER_TEXT);
    expect(POOL[ARBOK]?.abilities?.[0]?.effect).toBe(POTENT_GLARE_TEXT);
    // The two windows are DIFFERENT and that is the whole reason there are two
    // sources: one is turn-scoped, one is a standing board fact.
    expect(JAMMER_TEXT.startsWith("During your opponent's next turn,")).toBe(true);
    expect(POTENT_GLARE_TEXT.startsWith("As long as this Pokémon is in the Active Spot,")).toBe(
      true,
    );
  });

  it("🛑 BOTH PRINTINGS ARE BUILT — the family's first EXHAUSTIVE row", () => {
    // Bronzong is TEXT-DERIVED and carries no registry row at all; Arbok is a
    // registry row and derives nothing. One mechanism, two columns, and the
    // census cannot see it as one — which is why `BUILT.attack` AND
    // `BUILT.ability` both move by exactly 1 (censusAtHead.test.ts).
    expect(programFor(BRONZONG)).toBeUndefined();
    expect(deriveAttackEffect(JAMMER_TEXT)).toEqual([{ op: "preventHandPlay", bars: "evolve" }]);
    expect(programFor(ARBOK)?.passive?.preventOpponentPokemonPlay).toEqual({
      acts: ["evolve", "bench"],
      only: { kind: "abilityPokemon" },
      except: { kind: "ownerPokemon", owner: "Team Rocket" },
    });
  });

  it("🛑 THE ROWS STILL REFUSED, AND THE NEW ONE THE ACT CENSUS TURNED UP", () => {
    // D284's two remaining refusals were asserted here rather than left implicit,
    // so an accidental build reddens HERE. **BOTH HAVE NOW BEEN BUILT ON PURPOSE
    // AND THIS LINE MOVED WITH EACH** — D287 gave Copperajah `sv06.5-042` a
    // registry row, D291 gave Genesect `sv06.5-040` one, so the loop is split
    // rather than loosened:
    // 🆕 **D291 — GENESECT IS BUILT AND IT IS STILL NOT THIS SUITE'S FIELD.** The
    // whole content of the old assertion survives as a NEGATIVE: what Genesect
    // gained is a TRAINER-surface rarity bar
    // (`preventOpponentAceSpecPlayWhileToolAttached`), and the POKÉMON-surface
    // field this suite owns is still absent on it. A build that had reached for
    // `preventOpponentPokemonPlay` — the way any "your opponent can't play…"
    // sentence tempts you to — would be green on a bare `toBeDefined()` and RED
    // here, which is exactly what the original line was defending.
    expect(programFor(GENESECT)?.passive?.preventOpponentAceSpecPlayWhileToolAttached).toBe(true);
    expect(programFor(GENESECT)?.passive?.preventOpponentPokemonPlay).toBeUndefined();
    // 🛑 **AND THE SPLIT IS THE CLAIM, NOT THE PROGRAM'S MERE EXISTENCE.** What
    // Copperajah gained is a bar on the TRAINER surface (`preventOpponentHandPlay`,
    // `["Stadium"]`); THIS suite's field is the POKÉMON one, and it is still absent.
    // A build that reached for `preventOpponentPokemonPlay` because both sentences
    // start *"As long as this Pokémon is in the Active Spot, your opponent can't
    // play any…"* would be green on a bare `toBeDefined()` and RED here.
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentHandPlay).toEqual(["Stadium"]);
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentPokemonPlay).toBeUndefined();
    // 🆕 AND THE ONE THIS SLICE'S OWN CENSUS FOUND. Team Rocket's Ampharos
    // `sv10-074` names the SAME ACT and is not a bar at all: the mechanism it
    // needed was an ON-OPPONENT-EVOLVE trigger, which no `triggered` hook could
    // express because every one of them fired on its own controller's play.
    //
    // 🆕 **D319 BUILT IT, AND THE ASSERTION IS RE-POINTED RATHER THAN RELAXED —
    // THE GENESECT/COPPERAJAH SHAPE FOR THE THIRD TIME.** What Ampharos gained is
    // a triggered Ability with a SCAN DIRECTION (`opponentAction`); the
    // POKÉMON-surface BAR field this suite owns is still absent on it, and must
    // stay absent. A build that had reached for `preventOpponentPokemonPlay`
    // because the sentence names the same act would be green on a bare
    // `toBeDefined()` and RED here, which is exactly what the old line defended.
    expect(programFor(AMPHAROS)?.triggered?.[0]?.opponentAction).toBe(true);
    expect(programFor(AMPHAROS)?.triggered?.[0]?.trigger).toBe("onEvolve");
    expect(programFor(AMPHAROS)?.passive?.preventOpponentPokemonPlay).toBeUndefined();
    expect(programFor(AMPHAROS)?.passive?.preventOpponentHandPlay).toBeUndefined();
    expect(DARKEST_IMPULSE_TEXT.startsWith("Whenever your opponent plays a Pokémon")).toBe(true);
    expect(DARKEST_IMPULSE_TEXT).toContain("from their hand to evolve");
    // ⚠️ THE ATTRIBUTION CONTROL: `programFor` really is resolving, so the three
    // `toBeUndefined()`s above are refusals and not a broken import.
    expect(programFor(ARBOK)).toBeDefined();
  });

  it("the near-miss strings a looser anchor would have swallowed", () => {
    // Each differs from Bronzong's printing in ONE place. All must stay loud.
    for (const text of [
      // the same act, the CONTINUOUS window — Arbok's family, not this one
      POTENT_GLARE_TEXT,
      // the same act read as a TRIGGER (Ampharos)
      DARKEST_IMPULSE_TEXT,
      // the rider dropped — a bar on EVERY Pokémon play, which nothing prints
      "During your opponent's next turn, they can't play any Pokémon from their hand.",
      // the act swapped for a class the STAMP can already spell
      "During your opponent's next turn, they can't play any Pokémon cards from their hand.",
      // a trailing rider on a sentence the readers do not own
      `This attack does 30 damage. ${JAMMER_TEXT}`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // ⚠️ THE ATTRIBUTION CONTROL: the reader really is running.
    expect(deriveAttackEffect(JAMMER_TEXT)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE STAMP — Bronzong writes ONE key and it is an ACT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §2 — GameState.handPlayLockedTurn gains an ACT key", () => {
  it("a fresh game has no lock on either seat, for any of the three keys", () => {
    const created = createGame({ seed: SEEDS[0], decks: { p1: LOCK_DECK, p2: LOCK_DECK }, cardPool: POOL });
    if (!created.ok) throw new Error("createGame failed");
    expect(created.state.handPlayLockedTurn).toEqual({
      p1: { Item: null, Supporter: null, evolve: null },
      p2: { Item: null, Supporter: null, evolve: null },
    });
  });

  for (const first of ["p1", "p2"] as const) {
    it(`Evolution Jammer stamps the OPPONENT's next turn and NOTHING else (first: ${first})`, () => {
      const attacker = first;
      const victim = first === "p1" ? "p2" : "p1";
      const state = swing(turnOf(board(SEEDS[0], first, attacker, BRONZONG), attacker), attacker, 0);
      // The stamp names the turn the bar APPLIES to, so the reader is one `===`.
      expect(state.handPlayLockedTurn[victim].evolve).toBe(state.turn);
      // 🛑 AND ONLY THE ACT KEY — a build that reached for a class would have had
      // to widen `HandPlayClass` past `Card.trainerType`, and this is the line
      // that says it did not.
      expect(state.handPlayLockedTurn[victim].Item).toBeNull();
      expect(state.handPlayLockedTurn[victim].Supporter).toBeNull();
      // The ATTACKER's own record is untouched — "their next turn", not "yours".
      expect(state.handPlayLockedTurn[attacker]).toEqual({
        Item: null,
        Supporter: null,
        evolve: null,
      });
    });
  }

  it("the CONTROL body stamps nothing at all", () => {
    // Same board, same swing, an attack with no effect text. Without this every
    // assertion above is green on a build that stamped on every attack.
    const state = swing(turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p1"), "p1", 0);
    for (const seat of ["p1", "p2"] as const) {
      expect(state.handPlayLockedTurn[seat]).toEqual({
        Item: null,
        Supporter: null,
        evolve: null,
      });
    }
  });

  it("the stamp expires by ARITHMETIC — one turn later it is dead with nobody clearing it", () => {
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(pokemonPlayBarred(stamped, "p2", "evolve", POOL[EVO_PLAIN])).toBe(true);
    // Two turns on, the SAME stored number is in the past and reads as no lock.
    const later = turnOf(must(applyAction(stamped, { type: "endTurn", seat: "p2" })), "p2");
    expect(later.handPlayLockedTurn.p2.evolve).toBe(stamped.turn);
    expect(pokemonPlayBarred(later, "p2", "evolve", POOL[EVO_PLAIN])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE EVOLVE GATE — the read site both sources reach.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §3 — turn.ts's evolve gate", () => {
  it("a Bronzong-stamped seat cannot evolve, and the code is HAND_PLAY_BLOCKED", () => {
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(evolve(stamped, "p2", EVO_PLAIN)).toBe("HAND_PLAY_BLOCKED");
    // 🛑 THE STAMP CARRIES NO NOUN — Bronzong's sentence bars "any Pokémon", so
    // the Ability filter that narrows ARBOK's bar must not narrow this one.
    expect(evolve(stamped, "p2", EVO_ABILITY)).toBe("HAND_PLAY_BLOCKED");
    expect(evolve(stamped, "p2", EVO_ROCKET)).toBe("HAND_PLAY_BLOCKED");
  });

  it("the CONTROL board evolves fine — the refusal above is the rule and not the board", () => {
    const plain = swing(turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p1"), "p1", 0);
    for (const card of [EVO_PLAIN, EVO_ABILITY, EVO_ROCKET]) {
      expect(evolve(plain, "p2", card), card).toBe("OK");
    }
  });

  it("🛑 THE BARRING SEAT'S OWN HAND IS FREE — the perspective, from both sides", () => {
    for (const first of ["p1", "p2"] as const) {
      const attacker = first;
      const victim = first === "p1" ? "p2" : "p1";
      const stamped = swing(turnOf(board(SEEDS[1], first, attacker, BRONZONG), attacker), attacker, 0);
      expect(evolve(stamped, victim, EVO_PLAIN)).toBe("HAND_PLAY_BLOCKED");
      // Walk to the attacker's own turn: its record was never stamped, so it
      // evolves. A build that stamped the wrong seat is green on the line above.
      const back = turnOf(must(applyAction(stamped, { type: "endTurn", seat: victim })), attacker);
      expect(evolve(back, attacker, EVO_PLAIN)).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE ACT SPLIT — Bronzong does NOT reach a bench placement.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §4 — two acts, and the stamp names exactly one", () => {
  it("🛑 A BENCH PLACEMENT LANDS ON A BRONZONG-STAMPED BOARD", () => {
    // THE ASSERTION THAT SEPARATES ONE ACT FROM TWO. Bronzong prints "to evolve
    // their Pokémon"; a build with a single `"pokemon"` member bars a Basic the
    // sentence does not mention, and every evolve assertion above stays green.
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(evolve(stamped, "p2", EVO_PLAIN)).toBe("HAND_PLAY_BLOCKED");
    expect(bench(stamped, "p2", BASIC_PLAIN)).toBe("OK");
    expect(bench(stamped, "p2", BASIC_ABILITY)).toBe("OK");
  });

  it("`\"bench\"` IS NOT A STAMPABLE KEY — the reader turns it away by the type", () => {
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(pokemonPlayBarred(stamped, "p2", "evolve", POOL[EVO_PLAIN])).toBe(true);
    expect(pokemonPlayBarred(stamped, "p2", "bench", POOL[BASIC_PLAIN])).toBe(false);
    // …and the record itself never grew the key. `"Tool"` (D284) is absent for
    // the same measured reason: no printed writer can set either.
    const keys = Object.keys(stamped.handPlayLockedTurn.p2);
    expect(keys.sort()).toEqual(["Item", "Supporter", "evolve"].sort());
  });

  it("the TRAINER surface is untouched by an act stamp, and vice versa", () => {
    // The two vocabularies share a record and must not share an answer.
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(handPlayBarred(stamped, "p2", "Item", undefined)).toBe(false);
    expect(handPlayBarred(stamped, "p2", "Supporter", undefined)).toBe(false);
    expect(handPlayBarred(stamped, "p2", "Tool", undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ARBOK — the continuous source, its filter and its exception.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §5 — the continuous bar, narrowed and then re-widened", () => {
  it("🛑 THE NOUN IS NARROWED — an Ability-LESS evolution lands under Potent Glare", () => {
    // The assertion a filter-free build fails. Every other Arbok line in this
    // file uses a card that HAS an Ability, which is the natural fixture.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARBOK), "p2");
    expect(evolve(state, "p2", EVO_ABILITY)).toBe("HAND_PLAY_BLOCKED");
    expect(evolve(state, "p2", EVO_PLAIN)).toBe("OK");
  });

  it("🛑 THE EXCEPTION IS SUBTRACTED AND NOT CONJOINED — Team Rocket's Pokémon land", () => {
    // `EVO_ROCKET` satisfies BOTH printed clauses. An `&&` reading bars it; the
    // printed sentence exempts it.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARBOK), "p2");
    expect(evolve(state, "p2", EVO_ROCKET)).toBe("OK");
    // …and the exemption is the OWNER PREFIX rather than "it is the barring
    // player's kind of card": the same body is barred by BRONZONG's stamp, which
    // carries no exception (§3), so the two sources cannot be one predicate.
  });

  it("BOTH ACTS, because this sentence bars the PLAY and not one act of it", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARBOK), "p2");
    expect(bench(state, "p2", BASIC_ABILITY)).toBe("HAND_PLAY_BLOCKED");
    expect(bench(state, "p2", BASIC_PLAIN)).toBe("OK");
  });

  it("🛑 THE FILTERED NOUN IS THE CARD PLAYED, NOT THE BODY IT LANDS ON", () => {
    // Both crossed boards. The target is always a plain `fix-basic-1`, so a build
    // that filtered the TARGET refuses nothing at all — and one that filtered
    // BOTH is green on the first line and red on nothing.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARBOK), "p2");
    expect(POOL[BASIC_PLAIN]?.abilities ?? null).toBeNull();
    expect(evolve(state, "p2", EVO_ABILITY)).toBe("HAND_PLAY_BLOCKED");
    expect(evolve(state, "p2", EVO_PLAIN)).toBe("OK");
  });

  it("a BENCHED Arbok bars nothing — the Active-Spot window collapses the scan", () => {
    let state = board(SEEDS[0], "p1", "p1", ARBOK);
    state = setActiveFromDeck(state, "p1", PLAIN);
    state = turnOf(state, "p2");
    expect(evolve(state, "p2", EVO_ABILITY)).toBe("OK");
    expect(bench(state, "p2", BASIC_ABILITY)).toBe("OK");
  });

  for (const first of ["p1", "p2"] as const) {
    it(`the perspective flip, from both seats (first: ${first})`, () => {
      for (const barrier of ["p1", "p2"] as const) {
        const victim = barrier === "p1" ? "p2" : "p1";
        const state = board(SEEDS[2], first, barrier, ARBOK);
        expect(pokemonPlayBarred(state, victim, "evolve", POOL[EVO_ABILITY]), victim).toBe(true);
        // The BARRING seat's own hand is free — "your opponent can't play".
        expect(pokemonPlayBarred(state, barrier, "evolve", POOL[EVO_ABILITY]), barrier).toBe(false);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE VERSION BUMP, DRIVEN — AND ITS DIAGNOSIS IS THE *WEAK* ONE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §6 — MATCH_RECORD_VERSION 15 → 16, driven both directions", () => {
  it("🛑 A v15 BAG DOES NOT THROW — IT SILENTLY ANSWERS \"no lock\", WHICH IS THE POINT", () => {
    // 🛑 THE DIAGNOSIS IS THE OPPOSITE OF D283's AND THE CONCLUSION IS THE SAME,
    // SO IT IS RE-DERIVED RATHER THAN CITED. D283 added a whole FIELD, so
    // `handPlayBarred` indexed twice and a version-14 bag threw a `TypeError` on
    // the first Item either player reached for — "a retired match beats a crashed
    // Durable Object". This slice adds a KEY to a field that already exists, so
    // `state.handPlayLockedTurn[seat]` still resolves and only the second index
    // comes back `undefined`: `undefined === state.turn` is FALSE, i.e. "nothing
    // happened here". **THAT IS D124/D142/D143's SHAPE — the plausible default —
    // AND THOSE THREE WERE BUMPED ANYWAY**, because a silently defaulted
    // rules-relevant field is the misreading the constant exists to catch. The
    // test never moved: *can the PREVIOUS deploy's RECORD hold the new TYPE*, and
    // a v15 record cannot: it is missing a required key.
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(pokemonPlayBarred(stamped, "p2", "evolve", POOL[EVO_PLAIN])).toBe(true);
    const { evolve: _dropped, ...v15 } = stamped.handPlayLockedTurn.p2;
    const old = {
      ...stamped,
      handPlayLockedTurn: {
        ...stamped.handPlayLockedTurn,
        p2: v15 as (typeof stamped)["handPlayLockedTurn"]["p2"],
      },
    };
    // No throw — and the bar is GONE, which is the whole reason the version moves.
    expect(() => pokemonPlayBarred(old, "p2", "evolve", POOL[EVO_PLAIN])).not.toThrow();
    expect(pokemonPlayBarred(old, "p2", "evolve", POOL[EVO_PLAIN])).toBe(false);
    // …and it is observable through `applyAction`, not only through the reader:
    // the same board that refused the evolve now accepts it.
    expect(evolve(stamped, "p2", EVO_PLAIN)).toBe("HAND_PLAY_BLOCKED");
    expect(evolve(old, "p2", EVO_PLAIN)).toBe("OK");
  });

  it("🛑 AND THE OTHER DIRECTION — the key IS present on every board this build writes", () => {
    // D279's half-guard rule: a DIFF between two boards from ONE build is blind to
    // "every board grew a key", so it is PAIRED with a literal key-list anchor.
    for (const seed of SEEDS) {
      const stamped = swing(turnOf(board(seed, "p1", "p1", BRONZONG), "p1"), "p1", 0);
      const plain = swing(turnOf(board(seed, "p1", "p1", PLAIN), "p1"), "p1", 0);
      for (const seat of ["p1", "p2"] as const) {
        expect(Object.keys(stamped.handPlayLockedTurn[seat]).sort()).toEqual(
          Object.keys(plain.handPlayLockedTurn[seat]).sort(),
        );
        expect(Object.keys(stamped.handPlayLockedTurn[seat]).sort()).toEqual(
          ["Item", "Supporter", "evolve"].sort(),
        );
      }
    }
  });

  it("NOTHING ELSE PERSISTED MOVED — no top-level key, no body key, no allowance key", () => {
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    const plain = swing(turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p1"), "p1", 0);
    expect(Object.keys(stamped).sort()).toEqual(Object.keys(plain).sort());
    // The literal anchor beside the diff, for D279's stated reason.
    expect(Object.keys(stamped).sort()).toEqual(
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
    const bodyKeys = (s: GameState): string[] => Object.keys(s.players.p2.active ?? {}).sort();
    expect(bodyKeys(stamped)).toEqual(bodyKeys(plain));
    expect(Object.keys(stamped.allowances).sort()).toEqual(Object.keys(plain.allowances).sort());
  });

  it("a REAL JSON round trip preserves the stamp — the record carries it, not a derivation", () => {
    // Arbok's bar survives a round trip because it is RECOMPUTED; Bronzong's
    // survives only because the number is written down. Both directions asserted
    // on one board, which is what makes the two sources' costs comparable.
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    const reloaded = JSON.parse(JSON.stringify(stamped)) as GameState;
    expect(pokemonPlayBarred(reloaded, "p2", "evolve", POOL[EVO_PLAIN])).toBe(true);
    const arbok = turnOf(board(SEEDS[0], "p1", "p1", ARBOK), "p2");
    const arbokReloaded = JSON.parse(JSON.stringify(arbok)) as GameState;
    expect(arbokReloaded.handPlayLockedTurn.p2.evolve).toBeNull();
    expect(pokemonPlayBarred(arbokReloaded, "p2", "evolve", POOL[EVO_ABILITY])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. RARE CANDY IS NOT AN ACT OF THIS SURFACE, AND THAT IS A RULES CALL.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §7 — the act that is deliberately NOT reached", () => {
  it("🛑 THE READER HAS EXACTLY TWO ACTS AND RARE CANDY IS NEITHER", () => {
    // The handoff named `cardplay.ts`'s `rareCandy` (and `rareCandyOptions`) as a
    // read site this slice would need. It is not one, and the reason is printed:
    // Rare Candy says *"**put** that card onto the Basic Pokémon to evolve it"*,
    // so the Stage 2 is a card the ITEM's effect PUTS and not one the player
    // PLAYS from hand — the same distinction that keeps Buddy-Buddy Poffin out of
    // a bar on playing Basics. A bar on the PLAY therefore misses it.
    //
    // ⚠️ THE BAR THAT *DOES* REACH RARE CANDY IS THE `"Item"` ONE, on the card
    // itself — and D283 scoped that OFF the `rareCandy` action for an ENGINE-SHAPE
    // reason ("it is not played through playTrainer's Item branch"). That is a
    // separate finding and a separate slice; it is recorded in D285's row and NOT
    // silently folded in here.
    //
    // Asserted rather than left in prose, so the claim can go red: the act union
    // has two members and the `evolve` one is reachable only through turn.ts.
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(pokemonPlayBarred(stamped, "p2", "evolve", POOL[EVO_PLAIN])).toBe(true);
    expect(pokemonPlayBarred(stamped, "p2", "bench", POOL[BASIC_PLAIN])).toBe(false);
    expect(handPlayBarred(stamped, "p2", "Item", undefined)).toBe(false);
  });
});
