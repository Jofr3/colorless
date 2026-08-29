import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, programFor } from "./index";
import { conditionHolds, conditionNote, evolveEarlyLicensed } from "./interpreter";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  setActiveFromDeck,
} from "./testFixtures";

// 0.192.0 → 0.193.0 — D279, THE PARTNER-GATED §4/§10 EVOLVE LICENCE. D278's
// licence under a different ANTECEDENT, and the slice that had to SPLIT that
// field from the zone gate D278 welded into it.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CENSUS — RUNG BY RUNG, RE-QUERIED AND NOT CARRIED.
// ─────────────────────────────────────────────────────────────────────────────
//
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a, 3,786 rows),
// 2026-08-08, over all three text columns (`abilities_json`, `attacks_json`,
// `effect`). Every rung's ACTUAL return is written down, including the ones that
// returned nothing new.
//
//   RUNG 1 — `name IN ('Karrablast','Shelmet')`, ALL printings, no legality
//     filter. **SIX rows**: `sv09-009` and `sv09-012` carry `abilities_json =
//     NULL` (vanilla reprints, correctly absent from this slice), and the FOUR
//     licensed ones are all `legal_standard = 1`, `stage = 'Basic'`,
//     `evolve_from = NULL`.
//     ⚠️ **AND THE FOUR ARE TWO SENTENCES, NOT ONE.** Karrablast `sv10.5b-009`/
//     `-094` read *"If you have **Shelmet** in play…"*; Shelmet `sv10.5w-008`/
//     `-093` read *"If you have **Karrablast** in play…"*. Byte-identical WITHIN
//     each pair, different ACROSS. The handoff quoted only the Shelmet gate and
//     called it "4 printings and a named member"; the member is one, the OBJECTS
//     are two, and a suite that assumed the reprint idiom would have shipped a
//     self-satisfying gate.
//   RUNG 2 — POOL-WIDE `%evolve during your first turn%` / `%can evolve during
//     your first turn%`, all three columns, NO legality filter. **TEN rows** and
//     nothing outside the family: the 4 above + Eevee `sv08-143`/`sv08.5-074`/
//     `svp-173` (3, BUILT at D278) + **Scatterbug `sv01-008` and Spewpa
//     `sv01-009`** ("Adaptive Evolution", the UNGATED licence — `legal_standard
//     = 0`) + **Spearow `sv03.5-021`** ("Evolutionary Advantage", *"If you go
//     second, this Pokémon can evolve during your first turn"* — `legal_standard
//     = 0`, and a GOING-ORDER gate this vocabulary still cannot spell).
//     4 + 3 + 2 + 1 = **10**. ✅ **THE ROTATED THREE CHANGE NOTHING**: two of them
//     would need a licence with NEITHER key (the record already permits it, with
//     zero population) and one needs the going-order predicate the backlog prices
//     separately. Nothing is owed and nothing is refused for want of a mechanism.
//   RUNG 3 — POOL-WIDE `%If you have %in play%`, all three columns, ordered by
//     legality. **TWENTY-SIX rows, of which FIFTEEN are `legal_standard = 1` and
//     only OUR FOUR want this member.** The other 11 legal rows are already
//     served or are a different noun: `yourEnergyInPlayAtLeast` (Absol
//     `sv06.5-030`, Sandy Shocks `sv05-098`), a Tera **CLASS** rather than a name
//     (Glass Trumpet `sv07-135`/`sv08.5-110`, Azumarill `sv08-074`), and Noctowl
//     `sv07-115`/`sv08.5-078`/`svp-141` + Munkidori ex `sv06.5-037`/`-083`/`-091`,
//     whose match is incidental to a longer sentence.
//     🛑 **AND THE NON-LEGAL 11 ARE THE REASON THIS MEMBER IS SINGLE-NAME.**
//     Lunatone `sv03-092` (Solrock), Nidoking `sv03.5-034`/`-174` (Nidoqueen),
//     Minun `sv04-061`/`-194` (Plusle) are the same shape — but Simisage/
//     Simisear/Simipour `sv04-005`/`-021`/`-042` print *"If you have Simisage,
//     Simisear, **and** Simipour in play"*, **THREE names at once**, which
//     `BoardCondition` cannot spell (it has no `allOf` and no `not`). That is
//     NAMED here and NOT built: 0 legal printings want it.
//   RUNG 4 — REACHABILITY, two questions in one statement:
//     `evolve_from IN ('Karrablast','Shelmet')` → **SIX rows, all legal**
//     (Accelgor `sv09-013`/`sv10.5w-009`/`-094`, Escavalier `sv09-102`/
//     `sv10.5b-060`/`-138`), so the licence IS observable on a real Standard
//     chain — unlike D277's, and worth knowing before promising a row.
//     `stage='Stage2' AND evolve_from IN (SELECT name … WHERE evolve_from IN
//     ('Karrablast','Shelmet','Eevee'))` → **EMPTY SET**, D278's measurement
//     RE-DERIVED and holding with two more Basics in the inner list. The Rare
//     Candy refusal therefore stays unobservable in this catalog and stays pinned
//     in `boostedEvolution.test.ts` off a local chain.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 THE TRAP, AND IT IS THE MIRROR OF D278's.
// ─────────────────────────────────────────────────────────────────────────────
//
// D278 wrote the fold line as
//
//     if (passive.evolveEarlyExempt === true && !onBench) …
//
// because its ONE printing said *"As long as this Pokémon is in the Active
// Spot"*. **These four print no such clause** (rung 1's text, read rather than
// assumed), so reusing that line unchanged would give them a restriction the card
// does not print: a BENCHED Karrablast with a Shelmet in play would be REFUSED an
// evolution the rules allow.
//
// ⚠️ **AND IT IS QUIET IN THE OPPOSITE DIRECTION FROM D278's TRAP.** D278's
// one-ban build ALLOWED too little and was green because ban 2 never fires on a
// turn-1 board; this one REFUSES too much, and is green because **every natural
// "the licence works" assertion is written on an ACTIVE body** — an evolve test
// reaches for the Active Spot the way a damage test reaches for the Active Spot.
// `toEqual` over a refusal set stays green when the set is too big, exactly as it
// stays green when a walk returns too few rows.
//
// The board that separates them is §3's "a BENCHED Karrablast is licensed too",
// and the mutant is `D279-zone-gate-reused-on-the-partner-licence`, which re-adds
// `activeOnly` to the registry row. **Both were written before the fold line was
// touched, so the trap is pinned by a board rather than by this comment.**
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT WAS BUILT, AND THE D131 THAT WAS PRICED AND DECLINED.
// ─────────────────────────────────────────────────────────────────────────────
//
//   • **ONE new `BoardCondition` member** — `yourNamedPokemonInPlay { name }`,
//     ACTIVE + BENCH, one `conditionHolds` arm and one `conditionNote` arm.
//   • **ONE WIDENING** — `PassiveEffects.evolveEarlyExempt` from `true` to
//     `{ activeOnly?: true; ifInPlay?: string }`, and the fold's OUTPUT from a
//     boolean to `(BoardCondition | undefined)[]`. A widening and NOT a second
//     boolean beside the first (D131): one printed permission, one read site.
//   • **`evolveEarlyLicensed` MOVED** continuous.ts → interpreter.ts and gained a
//     `seat`. *"If you have Shelmet in play"* is seat-relative and `passivesOf`
//     has no seat, so the fold collects the clause RAW and the read site
//     evaluates it — `cantAttackUnless`/`attackBarredByAbility`'s split verbatim.
//   • **ZERO** new `EffectOp` members, **ZERO** new `GameState` fields,
//     `MATCH_RECORD_VERSION` **14 UNCHANGED**.
//
// 🛑 **`yourBenchHasNamed` WAS NOT WIDENED, AND THE READ SITES ARE THE REASON.**
// D131 says widen before you add, so it was priced that way FIRST. Consumers,
// grepped rather than assumed: **ONE registry printing** (Falinks `sv02-119`
// "Reckless Charge Together", via the effects.ts phrase table), 1 union member,
// 1 `conditionHolds` arm, 1 `conditionNote` arm. That printing's clause is *"If
// **Falinks** is on your Bench, this attack does 90 more damage"* — and its own
// attacker is a Falinks in the ACTIVE SPOT. Widening the member to consult the
// Active Spot would make the clause satisfy itself off the attacker and turn a
// conditional +90 into an unconditional one on every board with no second
// Falinks. §7 drives that board and asserts the member did NOT move.
// ⚠️ **AND THE INHERITED ID WAS WRONG**: D278's note and this repo's own header
// gave that printing as `sv06-160`. It is **`sv02-119`** — verified by grep and
// by the catalog, and corrected at both sites. *A handoff has now named the wrong
// FILE (D278) and the wrong PRINTING (D279) in consecutive slices.*

const STIMULATED_TEXT_KARRABLAST =
  "If you have Shelmet in play, this Pokémon can evolve during your first turn or the turn you play it.";
const STIMULATED_TEXT_SHELMET =
  "If you have Karrablast in play, this Pokémon can evolve during your first turn or the turn you play it.";

const KARRABLAST_IDS = ["sv10.5b-009", "sv10.5b-094"] as const;
const SHELMET_IDS = ["sv10.5w-008", "sv10.5w-093"] as const;
const ALL_IDS = [...KARRABLAST_IDS, ...SHELMET_IDS] as const;

function licensed(id: string, name: "Karrablast" | "Shelmet"): Card {
  return battler(id, {
    name,
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    abilities: [
      {
        type: "Ability",
        name: "Stimulated Evolution",
        effect: name === "Karrablast" ? STIMULATED_TEXT_KARRABLAST : STIMULATED_TEXT_SHELMET,
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Horn Attack", damage: 10 }],
  });
}

/** The CONTROL bodies: the same cards with the Ability removed and NOTHING else
    changed — the NAME included, deliberately, so one evolution fixture serves
    both arms and any two boards differ in exactly one thing.
    🛑 **THE SUITE IS VACUOUS WITHOUT THEM.** Every "the licence works" assertion
    below passes just as happily on a build that deleted the §4/§10 evolve bans
    outright, and these bodies are the only things that can tell those apart.
    ⚠️ AND `PLAIN_SHELMET` IS LOAD-BEARING IN ITS OWN RIGHT: it is a Shelmet that
    SATISFIES a Karrablast's gate while carrying no licence of its own, which is
    how §4 proves the gate reads the BOARD and not the holder. */
const PLAIN_KARRABLAST = "fix-plain-karrablast";
const PLAIN_SHELMET = "fix-plain-shelmet";
/** A third name that is neither partner — the negative control for the gate's
    NAME, without which "the gate holds" cannot be told from "the gate is true
    whenever anything is benched". */
const BYSTANDER = "fix-bystander-basic";

/** The Stage 1s the licence actually reaches. Real chains exist in Standard
    (census rung 4: Escavalier ×3, Accelgor ×3), so these are named after them. */
const ESCAVALIER = "fix-escavalier";
const ACCELGOR = "fix-accelgor";

const LOCAL_CARDS: Record<string, Card> = {
  "sv10.5b-009": licensed("sv10.5b-009", "Karrablast"),
  "sv10.5b-094": licensed("sv10.5b-094", "Karrablast"),
  "sv10.5w-008": licensed("sv10.5w-008", "Shelmet"),
  "sv10.5w-093": licensed("sv10.5w-093", "Shelmet"),
  [PLAIN_KARRABLAST]: battler(PLAIN_KARRABLAST, {
    name: "Karrablast",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Horn Attack", damage: 10 }],
  }),
  [PLAIN_SHELMET]: battler(PLAIN_SHELMET, {
    name: "Shelmet",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Headbutt Bounce", damage: 10 }],
  }),
  [BYSTANDER]: battler(BYSTANDER, {
    name: "Bystander",
    hp: 60,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Tackle", damage: 10 }],
  }),
  // D278's printing, reproduced HERE as a local fixture (it lives in that
  // suite's own `LOCAL_CARDS`, not in `FIXTURE_POOL`) — §3 needs it as the
  // CONTRAST that makes the zone gate a per-printing fact rather than a field
  // that lost its gate. Its real registry row supplies the `activeOnly`.
  "sv08-143": battler("sv08-143", {
    name: "Eevee",
    hp: 70,
    retreat: 1,
    types: ["Colorless"],
    abilities: [
      {
        type: "Ability",
        name: "Boosted Evolution",
        effect:
          "As long as this Pokémon is in the Active Spot, it can evolve during your first turn or the turn you play it.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Tackle", damage: 10 }],
  }),
  [ESCAVALIER]: battler(ESCAVALIER, {
    name: "Escavalier",
    stage: "Stage1",
    evolveFrom: "Karrablast",
    hp: 130,
    types: ["Metal"],
  }),
  [ACCELGOR]: battler(ACCELGOR, {
    name: "Accelgor",
    stage: "Stage1",
    evolveFrom: "Shelmet",
    hp: 110,
    types: ["Grass"],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The FOURTEENTH seeded deck (D270's rule: a seeded suite gets its own deck).
    ⚠️ `fix-basic-1` is load-bearing — §14.2 makes an empty Bench a LOSS the
    moment the Active leaves, and a `gameOver` board proves nothing about a gate. */
const BUG_DECK = deckOf({
  "sv10.5b-009": 4,
  "sv10.5b-094": 2,
  "sv10.5w-008": 4,
  "sv10.5w-093": 2,
  [PLAIN_KARRABLAST]: 4,
  [PLAIN_SHELMET]: 4,
  [BYSTANDER]: 4,
  [ESCAVALIER]: 6,
  [ACCELGOR]: 6,
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "sv08-143": 2, // Eevee — the ZONE-GATED contrast (§3), D278's printing
  "sv02-119": 2, // Falinks — the `yourBenchHasNamed` control (§7)
  "fix-basic-1": 4,
  "fix-energy": 14,
});

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

/** D275/D277/D278's `localSetup` verbatim in shape: the FIRST PLAYER is a
    PARAMETER, so every assertion below can be made from BOTH seats under BOTH
    assignments. ⚠️ A ONE-SEAT BOARD IS VACUOUS ON A PER-SEAT FACT, and *"if
    **you** have Shelmet in play"* is exactly such a fact — §4 drives the seat
    that the whole `evolveEarlyLicensed` signature change exists for. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: BUG_DECK, p2: BUG_DECK }, cardPool: POOL });
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

/** A board with `seat`'s Active set to `activeId`, `bench` filled in order, and
    `stage1` copies of the evolution in hand. `setActiveFromDeck`/`benchFromDeck`
    stamp `turnPlayed = 0` — the SETUP stamp, which is exactly what makes ban 2
    quiet on turn 1 (D278's header). ⚠️ **BOTH benches are cleared and `seat`'s is
    rebuilt** (D133's trap), and every board keeps at least one body behind the
    Active so §14.2 can never end the game mid-assertion. */
function board(
  seed: number,
  first: Seat,
  seat: Seat,
  activeId: string,
  bench: readonly string[],
  stage1: string = ESCAVALIER,
  stage1Count = 1,
): GameState {
  const foe: Seat = seat === "p1" ? "p2" : "p1";
  let state = localSetup(seed, first);
  // 🛑 THE OPPONENT'S SIDE IS NORMALISED FIRST, AND A SEED SWEEP IS WHAT FOUND
  // OUT WHY. `setupPlaceActive` takes the first Basic in a SHUFFLED hand, and
  // this deck runs Klefki `sv01-096` for §4's Ability-lock control — so on seed
  // 53 as p2 the OPPONENT opened with Klefki, "Mischievous Lock" darkened every
  // Basic's Ability on BOTH boards, and the licence was silently absent on a
  // board that looked identical to the four that passed. Leaving it to the seed
  // would have made this suite flaky in the one direction that reads as a real
  // failure. (The lock is asserted deliberately in §4; here it is excluded.)
  state = setActiveFromDeck(state, foe, BYSTANDER);
  state = clearBench(state, foe);
  state = benchFromDeck(state, foe, "fix-basic-1");
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  for (const id of bench) state = benchFromDeck(state, seat, id);
  return handFromDeck(state, seat, stage1, stage1Count);
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

function benchAt(state: GameState, seat: Seat, index: number): InPlayPokemon {
  const pokemon = state.players[seat].bench[index];
  if (pokemon === undefined) throw new Error(`${seat} has no bench[${String(index)}]`);
  return pokemon;
}

function handUidOf(state: GameState, seat: Seat, cardId: string): string {
  const uid = state.players[seat].hand.find((h) => state.cardIdByUid[h] === cardId);
  if (uid === undefined) throw new Error(`${seat} has no ${cardId} in hand`);
  return uid;
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** TEST SURGERY (D278's `stampPlayedThisTurn`, generalised to a BENCH slot):
    stamp a body as having come into play on the turn now being played — "the turn
    you play it", the half of the sentence a turn-1 board cannot show. Written as
    a stamp rather than a scripted play because the resulting board is exactly the
    one a real `playBasicToBench` produces, and the point under test is the TIMING
    read rather than the play path. */
function stampPlayedThisTurn(state: GameState, seat: Seat, index: number | "active"): GameState {
  const side = state.players[seat];
  if (index === "active") {
    if (side.active === null) throw new Error(`${seat} has no Active`);
    return {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...side, active: { ...side.active, turnPlayed: state.turn } },
      },
    };
  }
  const body = side.bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${String(index)}]`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: side.bench.map((b, i) => (i === index ? { ...body, turnPlayed: state.turn } : b)),
      },
    },
  };
}

function evolveAt(seat: Seat, uid: string, index: number | "active") {
  return {
    type: "evolve",
    seat,
    uid,
    target: index === "active" ? { spot: "active" as const } : { spot: "bench" as const, index },
  } as const;
}

const SEEDS = [11, 29, 53, 71, 97] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The registry rows — TWO sentences, TWO objects, and NO zone key.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — 'Stimulated Evolution' as registry data", () => {
  it("all FOUR ids resolve to a licence and to nothing else", () => {
    for (const id of ALL_IDS) {
      // `toEqual` on the WHOLE program, not on the one field: a row that also
      // grew an `abilities` entry or an `attack` program would pass a field probe
      // and would be a different card.
      expect(programFor(id), id).toEqual({
        passive: {
          evolveEarlyExempt: {
            ifInPlay: KARRABLAST_IDS.includes(id as (typeof KARRABLAST_IDS)[number])
              ? "Shelmet"
              : "Karrablast",
          },
        },
      });
      // ⚠️ A `passive`, NOT an `abilities` entry — the printed sentence has no
      // "Once during your turn", nothing to activate and no cost.
      expect(programFor(id)?.abilities, id).toBeUndefined();
      expect(programFor(id)?.attack, id).toBeUndefined();
      // …and NOT either of the two neighbouring first-turn flags.
      expect(programFor(id)?.passive?.attackFirstTurnExempt, id).toBeUndefined();
      expect(programFor(id)?.trainerFirstTurnExempt, id).toBeUndefined();
    }
  });

  it("🛑 carries NO `activeOnly` — the clause the printed text does NOT have", () => {
    // THE MIRROR TRAP, PINNED AS DATA BEFORE IT IS PINNED AS A BOARD. Eevee's
    // three DO carry it; these four must not, and a copy-paste from the row above
    // in registry.ts is the single edit that would break it.
    for (const id of ALL_IDS) {
      expect(programFor(id)?.passive?.evolveEarlyExempt?.activeOnly, id).toBeUndefined();
    }
    // …and the control from the other side: the printing that DOES print the
    // clause still carries the key, so this is a difference between cards rather
    // than a field nobody sets.
    expect(programFor("sv08-143")?.passive?.evolveEarlyExempt?.activeOnly).toBe(true);
    expect(programFor("sv08-143")?.passive?.evolveEarlyExempt?.ifInPlay).toBeUndefined();
  });

  it("🛑 TWO objects, not one — the reprint idiom applies WITHIN each pair only", () => {
    // The census fact, driven. Sharing one object across all four would hand each
    // body its OWN name as its gate, which reads TRUE off the holder and makes the
    // licence unconditional — the reprint idiom applied one printing too far.
    expect(programFor("sv10.5b-094")).toBe(programFor("sv10.5b-009"));
    expect(programFor("sv10.5w-093")).toBe(programFor("sv10.5w-008"));
    expect(programFor("sv10.5w-008")).not.toBe(programFor("sv10.5b-009"));
    // …and the gates really are each other's, not each body's own.
    expect(programFor("sv10.5b-009")?.passive?.evolveEarlyExempt?.ifInPlay).toBe("Shelmet");
    expect(programFor("sv10.5w-008")?.passive?.evolveEarlyExempt?.ifInPlay).toBe("Karrablast");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The vocabulary member — `yourNamedPokemonInPlay`, ACTIVE + BENCH.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — `yourNamedPokemonInPlay`", () => {
  const SHELMET_IN_PLAY = { kind: "yourNamedPokemonInPlay", name: "Shelmet" } as const;

  it("holds for a BENCHED partner and for an ACTIVE one — both zones, one member", () => {
    for (const seat of ["p1", "p2"] as const) {
      const benched = board(SEEDS[0], "p1", seat, PLAIN_KARRABLAST, [PLAIN_SHELMET, BYSTANDER]);
      expect(conditionHolds(benched, seat, SHELMET_IN_PLAY), `bench/${seat}`).toBe(true);
      // 🛑 THE ACTIVE SPOT IS THE HALF `yourBenchHasNamed` REFUSES, and it is the
      // whole reason this is a second member. Same board, partner promoted.
      const active = board(SEEDS[0], "p1", seat, PLAIN_SHELMET, [BYSTANDER, "fix-basic-1"]);
      expect(conditionHolds(active, seat, SHELMET_IN_PLAY), `active/${seat}`).toBe(true);
      expect(
        conditionHolds(active, seat, { kind: "yourBenchHasNamed", name: "Shelmet" }),
        `bench-only-control/${seat}`,
      ).toBe(false);
    }
  });

  it("is FALSE with no partner, and FALSE for a name nobody carries", () => {
    for (const seat of ["p1", "p2"] as const) {
      const none = board(SEEDS[1], "p2", seat, PLAIN_KARRABLAST, [BYSTANDER, "fix-basic-1"]);
      expect(conditionHolds(none, seat, SHELMET_IN_PLAY), `none/${seat}`).toBe(false);
      // The NAME control: without it "the gate holds" cannot be told from "the
      // gate is true whenever anything is in play".
      const partnered = board(SEEDS[1], "p2", seat, PLAIN_KARRABLAST, [PLAIN_SHELMET]);
      expect(
        conditionHolds(partnered, seat, { kind: "yourNamedPokemonInPlay", name: "Accelgor" }),
        `wrong-name/${seat}`,
      ).toBe(false);
    }
  });

  it("🛑 is SEAT-RELATIVE — the opponent's Shelmet does NOT satisfy YOUR clause", () => {
    // "If **you** have Shelmet in play." This is the fact that forced the seat
    // parameter onto `evolveEarlyLicensed`, and a fold-resolved build could not
    // have made it at all: `passivesOf` has no seat.
    for (const seat of ["p1", "p2"] as const) {
      const foe = seat === "p1" ? "p2" : "p1";
      let state = board(SEEDS[2], "p1", seat, PLAIN_KARRABLAST, [BYSTANDER, "fix-basic-1"]);
      state = clearBench(state, foe);
      state = benchFromDeck(state, foe, PLAIN_SHELMET);
      state = benchFromDeck(state, foe, "fix-basic-1");
      expect(conditionHolds(state, seat, SHELMET_IN_PLAY), `mine/${seat}`).toBe(false);
      // …and the control from the other side: the SAME board answers TRUE for the
      // seat that actually owns the Shelmet, so this is a seat split rather than a
      // board with no Shelmet on it.
      expect(conditionHolds(state, foe, SHELMET_IN_PLAY), `theirs/${seat}`).toBe(true);
    }
  });

  it("reads the STACK TOP — an evolved Shelmet stops being a Shelmet (§1.2)", () => {
    const first: Seat = "p1";
    let state = board(SEEDS[3], first, first, PLAIN_KARRABLAST, [PLAIN_SHELMET, BYSTANDER]);
    state = handFromDeck(state, first, ACCELGOR, 1);
    state = passTurns(state, 2); // clear the first-turn ban so the evolve is legal
    expect(conditionHolds(state, first, SHELMET_IN_PLAY), "before").toBe(true);
    const evolved = must(
      applyAction(state, evolveAt(first, handUidOf(state, first, ACCELGOR), 0)),
    );
    // 🛑 NOT JUST THE PREDICATE — the Stage 1 really landed, or this would pass on
    // an evolve that did nothing to a board that never had a Shelmet.
    const body = benchAt(evolved, first, 0);
    expect(evolved.cardIdByUid[body.stack[body.stack.length - 1] ?? ""]).toBe(ACCELGOR);
    expect(conditionHolds(evolved, first, SHELMET_IN_PLAY), "after").toBe(false);
  });

  it("`conditionNote` round-trips to the printed clause", () => {
    expect(conditionNote({ kind: "yourNamedPokemonInPlay", name: "Shelmet" })).toBe(
      "you have Shelmet in play",
    );
    // …and it is NOT the Bench member's note, which is the confusion this whole
    // slice exists to keep out of the vocabulary.
    expect(conditionNote({ kind: "yourBenchHasNamed", name: "Shelmet" })).toBe(
      "Shelmet is on your Bench",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 🛑 THE MIRROR TRAP — the fold, and the BENCHED licensed body.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — the zone gate is PER-PRINTING, not a property of the field", () => {
  it("carries the partner CONDITION unresolved — the fold does not answer it", () => {
    const state = board(SEEDS[0], "p1", "p1", "sv10.5b-009", [PLAIN_SHELMET, BYSTANDER]);
    // `toEqual` on the WHOLE list: a probe like `.length > 0` stays green on a
    // fold that pushed `undefined` (which would license unconditionally).
    expect(passivesOf(state, activeOf(state, "p1")).evolveEarlyExempt).toEqual([
      { kind: "yourNamedPokemonInPlay", name: "Shelmet" },
    ]);
    // The attribution control: the plain body pushes nothing at all.
    const plain = board(SEEDS[0], "p1", "p1", PLAIN_KARRABLAST, [PLAIN_SHELMET, BYSTANDER]);
    expect(passivesOf(plain, activeOf(plain, "p1")).evolveEarlyExempt).toEqual([]);
  });

  it("🛑 a BENCHED Karrablast STILL carries the licence — D278's zone gate REUSED would refuse it", () => {
    // **THE BOARD THE WHOLE SLICE TURNS ON.** The printed sentence has no
    // Active-Spot clause, so the licence holds on the Bench — and a build that
    // reused D278's unconditional `&& !onBench` would return `[]` here while every
    // Active-body assertion in this file stayed green.
    for (const seat of ["p1", "p2"] as const) {
      let state = board(SEEDS[1], "p1", seat, PLAIN_SHELMET, [BYSTANDER]);
      state = benchFromDeck(state, seat, "sv10.5b-009");
      const benched = benchAt(state, seat, state.players[seat].bench.length - 1);
      expect(passivesOf(state, benched).evolveEarlyExempt, `${seat}`).toEqual([
        { kind: "yourNamedPokemonInPlay", name: "Shelmet" },
      ]);
      // …and the CONTRAST that makes it a per-printing fact rather than a field
      // that lost its gate: Eevee, one zone over, still answers EMPTY.
      let eevee = board(SEEDS[1], "p1", seat, PLAIN_SHELMET, [BYSTANDER]);
      eevee = benchFromDeck(eevee, seat, "sv08-143");
      expect(
        passivesOf(eevee, benchAt(eevee, seat, eevee.players[seat].bench.length - 1))
          .evolveEarlyExempt,
        `eevee/${seat}`,
      ).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The predicate — `evolveEarlyLicensed`, now with a SEAT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — `evolveEarlyLicensed` and the partner gate", () => {
  it("licenses with the partner and refuses without — BOTH seats, BOTH going orders", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const withPartner = board(SEEDS[0], first, seat, "sv10.5b-009", [PLAIN_SHELMET, BYSTANDER]);
        expect(
          evolveEarlyLicensed(withPartner, seat, activeOf(withPartner, seat)),
          `with/${first}/${seat}`,
        ).toBe(true);
        // 🛑 THE GATE IS NOT SELF-SATISFYING: a lone licensed Karrablast checks for
        // a SHELMET, never for another Karrablast, so this board is UNLICENSED.
        const alone = board(SEEDS[0], first, seat, "sv10.5b-009", [BYSTANDER, "fix-basic-1"]);
        expect(
          evolveEarlyLicensed(alone, seat, activeOf(alone, seat)),
          `alone/${first}/${seat}`,
        ).toBe(false);
      }
    }
  });

  it("🛑 the OPPONENT's Shelmet does not license YOUR Karrablast", () => {
    // The seat parameter, driven through the predicate rather than only through
    // `conditionHolds`. A build that passed the BODY's own side would be green on
    // every board where both seats happen to run the partner.
    for (const seat of ["p1", "p2"] as const) {
      const foe = seat === "p1" ? "p2" : "p1";
      let state = board(SEEDS[2], "p1", seat, "sv10.5b-009", [BYSTANDER, "fix-basic-1"]);
      state = clearBench(state, foe);
      state = benchFromDeck(state, foe, PLAIN_SHELMET);
      state = benchFromDeck(state, foe, "fix-basic-1");
      expect(evolveEarlyLicensed(state, seat, activeOf(state, seat)), `${seat}`).toBe(false);
    }
  });

  it("🛑 a §9 ABILITY-LOCK SILENCES THE LICENCE AND HANDS BOTH BANS BACK", () => {
    // THE REASON THE LICENCE RIDES `passivesOf` RATHER THAN THE CATALOG ROW.
    // Klefki `sv01-096` "Mischievous Lock" darkens every Basic's Ability on both
    // boards while Active — and "Stimulated Evolution" is a printed Ability on a
    // BASIC. ⚠️ NOTE THE PARTNER IS UNAFFECTED: the gate reads a NAME off the
    // board, which no Ability-lock touches, so this proves the LICENCE was
    // silenced and not the condition.
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = board(SEEDS[1], first, first, "sv10.5w-008", [PLAIN_KARRABLAST, BYSTANDER], ACCELGOR);
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `control/${first}`).toBe(
        true,
      );
      state = setActiveFromDeck(state, second, "sv01-096");
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `locked/${first}`).toBe(
        false,
      );
      expect(
        conditionHolds(state, first, { kind: "yourNamedPokemonInPlay", name: "Karrablast" }),
        `partner-unaffected/${first}`,
      ).toBe(true);
      // …and the ban is really handed back at the handler, not only at the read.
      const result = applyAction(state, evolveAt(first, handUidOf(state, first, ACCELGOR), "active"));
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("FIRST_TURN_EVOLVE");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The handler — BOTH bans, on BOTH zones.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — `evolve` under the partner licence", () => {
  it("ALLOWS the licensed FIRST-TURN evolve, and the Stage 1 really lands", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const state = board(seed, first, first, "sv10.5b-009", [PLAIN_SHELMET, BYSTANDER]);
        const uid = handUidOf(state, first, ESCAVALIER);
        const result = applyAction(state, evolveAt(first, uid, "active"));
        expect(result.ok, `${seed}/${first}`).toBe(true);
        if (!result.ok) throw new Error(result.error.code);
        // 🛑 NOT JUST `ok` — an `ok` that placed nothing would pass a gate test.
        const active = activeOf(result.state, first);
        expect(active.stack[active.stack.length - 1], `${seed}/${first}`).toBe(uid);
      }
    }
  });

  it("REFUSES the same first-turn evolve with no partner — FIRST_TURN_EVOLVE", () => {
    // The attribution control for every `ok` above: without it they all pass on a
    // build that deleted §4/§10 outright.
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const state = board(seed, first, first, "sv10.5b-009", [BYSTANDER, "fix-basic-1"]);
        const result = applyAction(state, evolveAt(first, handUidOf(state, first, ESCAVALIER), "active"));
        expect(result.ok, `${seed}/${first}`).toBe(false);
        if (result.ok) throw new Error("expected a refusal");
        expect(result.error.code, `${seed}/${first}`).toBe("FIRST_TURN_EVOLVE");
      }
    }
  });

  it("🛑 ALLOWS a BENCHED licensed body to evolve on turn 1 — the trap, at the HANDLER", () => {
    // §3's fold assertion carried all the way to the action. A build that reused
    // D278's zone gate refuses this with FIRST_TURN_EVOLVE, and NOTHING else in
    // this file or in `boostedEvolution.test.ts` would notice.
    for (const first of ["p1", "p2"] as const) {
      let state = board(first === "p1" ? SEEDS[3] : SEEDS[4], first, first, PLAIN_SHELMET, [
        BYSTANDER,
      ]);
      state = benchFromDeck(state, first, "sv10.5b-009");
      const index = state.players[first].bench.length - 1;
      const uid = handUidOf(state, first, ESCAVALIER);
      const result = applyAction(state, evolveAt(first, uid, index));
      expect(result.ok, `${first}`).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      const body = benchAt(result.state, first, index);
      expect(body.stack[body.stack.length - 1], `${first}`).toBe(uid);
    }
  });

  it("🛑 LIFTS BAN 2 TOO — a body played THIS turn, on a LATER turn", () => {
    // **THE CASE THAT SEPARATES A CORRECT BUILD FROM THE QUIET ONE** (D278's
    // finding, re-driven under the partner gate). On turn 1 a SETUP body carries
    // `turnPlayed = 0` and `0 >= 1` is false, so ban 2 never fires there; only a
    // LATER turn with a body stamped THIS turn can see it.
    for (const first of ["p1", "p2"] as const) {
      let state = board(SEEDS[2], first, first, "sv10.5w-008", [PLAIN_KARRABLAST, BYSTANDER], ACCELGOR);
      state = passTurns(state, 2);
      state = stampPlayedThisTurn(state, first, "active");
      const uid = handUidOf(state, first, ACCELGOR);
      const result = applyAction(state, evolveAt(first, uid, "active"));
      expect(result.ok, `${first}`).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      const active = activeOf(result.state, first);
      expect(active.stack[active.stack.length - 1], `${first}`).toBe(uid);
    }
  });

  it("REFUSES ban 2 without the partner — EVOLVE_TOO_SOON, the code that proves it was ban 2", () => {
    // ⚠️ AND THE CODE MATTERS: a build that lifted only ban 1 would be green on
    // every board above and would refuse HERE too — with the same code — so this
    // arm is the control for the PREVIOUS `it` rather than for §4's.
    for (const first of ["p1", "p2"] as const) {
      let state = board(SEEDS[2], first, first, "sv10.5w-008", [BYSTANDER, "fix-basic-1"], ACCELGOR);
      state = passTurns(state, 2);
      state = stampPlayedThisTurn(state, first, "active");
      const result = applyAction(state, evolveAt(first, handUidOf(state, first, ACCELGOR), "active"));
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("EVOLVE_TOO_SOON");
    }
  });

  it("the licence is LIVE — evolving the PARTNER away ends it mid-turn", () => {
    // The gate reads the stack TOP, so a Shelmet that became an Accelgor stops
    // licensing its Karrablast — and this is the board that proves the read is
    // recomputed rather than latched at setup.
    for (const first of ["p1", "p2"] as const) {
      let state = board(SEEDS[0], first, first, "sv10.5b-009", [PLAIN_SHELMET, BYSTANDER]);
      state = handFromDeck(state, first, ACCELGOR, 1);
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `before/${first}`).toBe(
        true,
      );
      // ⚠️ THE PARTNER'S OWN EVOLVE IS ITSELF FIRST-TURN-BANNED — the plain Shelmet
      // carries no licence — so the clock is walked first. That also makes the
      // assertion below a same-turn one, which is the point.
      state = passTurns(state, 2);
      state = must(applyAction(state, evolveAt(first, handUidOf(state, first, ACCELGOR), 0)));
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `after/${first}`).toBe(
        false,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. `MATCH_RECORD_VERSION` — the DERIVATION, and the direction that IS drivable.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — MATCH_RECORD_VERSION stays 14, and the claim is MEASURED", () => {
  it("a LICENSED evolve writes exactly the keys an ordinary one writes — a DIFF, not a claim", () => {
    // 🛑 THE TEST THAT CONSTANT ACTUALLY POSES IS *"CAN THE PREVIOUS DEPLOY'S
    // RECORD HOLD THE NEW TYPE"*, and for this slice there is **NO KEY TO
    // DELETE** — which is not a reason to skip the measurement but the thing to
    // measure. D271 could drive its bump by stripping `lastKoTurn` off a real
    // post-KO state; here the honest drive is the mirror: take the board this
    // slice makes newly legal, run it to completion, and DIFF the persisted
    // shape against the same evolve made the ordinary way (a later turn, no
    // licence). Identical key sets means an old record's `GameState` is still a
    // state this deploy writes, in both directions.
    const first: Seat = "p1";
    // (a) the licensed first-turn evolve — only possible since D279.
    const licensedBoard = board(SEEDS[0], first, first, "sv10.5b-009", [PLAIN_SHELMET, BYSTANDER]);
    const viaLicence = must(
      applyAction(licensedBoard, evolveAt(first, handUidOf(licensedBoard, first, ESCAVALIER), "active")),
    );
    // (b) the SAME evolve with no licence anywhere, on a turn where it is legal
    //     for everyone — the pre-D279 path, byte for byte.
    let plainBoard = board(SEEDS[0], first, first, PLAIN_KARRABLAST, [BYSTANDER, "fix-basic-1"]);
    plainBoard = passTurns(plainBoard, 2);
    const viaRules = must(
      applyAction(plainBoard, evolveAt(first, handUidOf(plainBoard, first, ESCAVALIER), "active")),
    );
    // The PERSISTED per-body shape: `InPlayPokemon` is what a record embeds, and
    // a new key on it is the commonest reason this constant moves.
    //
    // ⚠️ **THE TWO-BOARD DIFF ALONE WOULD BE A HALF-GUARD, AND SAYING SO IS THE
    // POINT.** Both states come from the SAME build, so a key added to EVERY body
    // appears on both sides and the comparison stays green — it catches only "the
    // LICENCE path writes something the ordinary path does not", which is this
    // slice's actual risk. The other half needs an ANCHOR, so the key set is also
    // asserted against a literal list: that one reddens the day any
    // `InPlayPokemon` key is added, by anybody, for any reason.
    const PERSISTED_BODY_KEYS = [
      "attackBlock",
      "attackDamageDebuff",
      "attackLockedTurn",
      "boostedAttack",
      "conditions",
      "damage",
      "damageReduction",
      "energy",
      // 🆕🆕 D386 — `healedTurn` JOINS THE LIST (a second per-turn stamp on this
      // structure, and `MATCH_RECORD_VERSION` 22 → 23 with it). THIS slice still wrote
      // nothing: the pin is on the HEAD's key set, so it moves whenever anybody adds a
      // key, and what it asserts is that none of them was added HERE.
      "evolvedTurn",
      "healedTurn",
      "installedRecoil",
      "lockedAttacks",
      "markers",
      // 🆕🆕 D432 — the attack-installed §8.5 NO-WEAKNESS bar's stamp (MATCH_RECORD_VERSION 26 -> 27).
      "noWeaknessTurn",
      "promotedTurn",
      "retreatBlocked",
      // 🆕🆕 D412 — the SELF-installed §11 retreat lock's stamp (MATCH_RECORD_VERSION 25 → 26).
      "retreatLockedTurn",
      "scheduledEffect",
      "stack",
      "tools",
      "turnPlayed",
      // 🆕🆕 D394 — `usedAttack` JOINS THE LIST (a FOURTH per-turn stamp on this
      // structure, and `MATCH_RECORD_VERSION` 24 → 25 with it). THIS slice still
      // wrote nothing; the pin is on the HEAD's key set.
      "usedAttack",
    ];
    expect(Object.keys(activeOf(viaLicence, first)).sort()).toEqual(PERSISTED_BODY_KEYS);
    expect(Object.keys(activeOf(viaLicence, first)).sort()).toEqual(
      Object.keys(activeOf(viaRules, first)).sort(),
    );
    // …and the top-level `GameState` keys, since a licence that had needed a
    // board-level field would show up here and nowhere else.
    expect(Object.keys(viaLicence).sort()).toEqual(Object.keys(viaRules).sort());
    // 🛑 AND NOTHING PARKED. `EffectContinuation.pendingOp` is the other persisted
    // surface, and a licence that parked would put a `BoardCondition` — including
    // this slice's brand-new member — into a stored record, which is the one
    // shape that WOULD force a bump. It does not: the licence is read at a play
    // gate and resolves synchronously.
    expect(viaLicence.phase.kind).toBe("turn:action");
    expect(viaLicence.phase).not.toHaveProperty("cont");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. 🛑 THE MEMBER THAT WAS *NOT* WIDENED — the Falinks control.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — `yourBenchHasNamed` is UNCHANGED, and Falinks sv02-119 is why", () => {
  it("still refuses the Active Spot — the printing that depends on it being narrow", () => {
    // D131 priced and DECLINED. If `yourBenchHasNamed` had been widened instead of
    // a second member added, THIS assertion is the one that would have flipped —
    // and with it Falinks' conditional +90 on every board with a single Falinks.
    for (const seat of ["p1", "p2"] as const) {
      const state = board(SEEDS[4], "p1", seat, "sv02-119", [BYSTANDER, "fix-basic-1"]);
      expect(
        conditionHolds(state, seat, { kind: "yourBenchHasNamed", name: "Falinks" }),
        `active-only/${seat}`,
      ).toBe(false);
      // 🛑 AND THE NEW MEMBER ANSWERS THE OPPOSITE ON THE SAME BOARD, which is the
      // whole content of "these are two members": one board, one name, two answers.
      expect(
        conditionHolds(state, seat, { kind: "yourNamedPokemonInPlay", name: "Falinks" }),
        `in-play/${seat}`,
      ).toBe(true);
    }
  });

  it("still holds for a BENCHED Falinks — the member did not lose anything either", () => {
    // ⚠️ A GUARD THAT ONLY CHECKS THE REFUSAL SIDE CANNOT SEE A MEMBER THAT WAS
    // NARROWED TO NOTHING. Both directions, on one board.
    for (const seat of ["p1", "p2"] as const) {
      const state = board(SEEDS[4], "p1", seat, PLAIN_KARRABLAST, ["sv02-119", BYSTANDER]);
      expect(
        conditionHolds(state, seat, { kind: "yourBenchHasNamed", name: "Falinks" }),
        `${seat}`,
      ).toBe(true);
    }
  });
});
