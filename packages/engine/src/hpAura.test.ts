import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { effectiveMaxHp, seatMaxHpBonus } from "./continuous";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  setPrizes,
  trainerCard,
} from "./testFixtures";

// D324 — THE §8.1 MAX-HP SEAM: THE ORDERED ROW, AND THE FIVE PRINTINGS THE
// CLOSURE QUERY FOUND BESIDE IT.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE THREE CHECKS THE RESUME POINT ORDERED, IN ITS ORDER, WITH WHAT EACH
// RETURNED. All three changed the answer, which is now five sessions running.
// ─────────────────────────────────────────────────────────────────────────────
//
// (a) `git grep sv09-037 -- packages/` — D321's rule, run in the direction D323
//     discovered it also works in. **SIX hits and not one is a key**: three
//     comments (`registry.ts`'s `doesNotStack` doc-block, `censusAtHead.test.ts`,
//     `koPrizeBonus.test.ts`) and D323's own pin, `expect(programFor("sv09-037"))
//     .toBeUndefined()`. **The row was genuinely unbuilt and the price stood** —
//     for the third handoff running, after D320/D321/D322 all recorded the
//     *"doesn't stack"* family as *"five of the six are built or closed"*.
//     🛑 **A HANDOFF CAN BE WRONG IN BOTH DIRECTIONS AT ONCE**, and this page has
//     now demonstrated both on consecutive slices: D323's row was priced at ONE
//     printing and was worth FOUR; this one was recorded as DONE and was worth ONE.
//
// (b) THE CENSUS **AND ITS CLOSURE QUERY**, over the BARE HP NOUN and across ALL
//     THREE COLUMNS. Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a,
//     3,786 rows, 2,021 `legal_standard`), 2026-08-10:
//
//       instr(abilities_json,'oesn''t stack') > 0  → 10 rows / 8 legal / 6 Abilities
//       instr(abilities_json,'get +')        > 0  → 1 row / **1 legal** (Ludicolo)
//
//     which re-derives the handoff's price EXACTLY — and is not a closure proof,
//     for D322's reason and D323's demonstration of it. **THE LITERAL CANNOT SEE
//     `gets +`.** The bare noun can:
//
//       instr(abilities_json,'HP')  > 0  → **24 legal**
//       instr(effect,'HP')          > 0  → **21 legal**
//       instr(attacks_json,'HP')    > 0  → **5 legal**
//
//     and the difference set is NOT empty. Every row in it is named out loud
//     rather than waved past (D323's rule — naming them is what turns a count
//     into a proof), in the two classes it falls into:
//
//     **MAX-HP GRANTS THE LITERAL MISSED, ALL UNBUILT BY `git grep`, ALL SHIPPED
//     HERE**: Lively Stadium `sv08-180` (+30, Basics, BOTH sides), Gravity
//     Mountain `sv08-177`/`sv08-250` (−30, Stage 2s, BOTH sides), Hero's Cape
//     `sv05-152` (+100, no stage clause), Cynthia's Power Weight `sv10-162` (+70,
//     owner-clause). **FIVE printings on TWO sentences, none of which any handoff
//     had ever named.**
//
//     **MAX-HP GRANTS THAT ARE A DIFFERENT MECHANISM AND ARE NOT THIS SLICE** —
//     every one a SELF grant that SCALES on a live board read, where all six rows
//     above are flat: Okidogi "Adrena-Power" `sv06-111`/`sv06.5-074`/`sv08.5-057`
//     (+100 gated on attached {D}, ×3), Conkeldurr "Craftsmanship" `sv10.5b-049`/
//     `sv10.5b-127` (+40 per attached {F}, ×2), Brambleghast "Resilient Soul"
//     `sv05-021` (+50 per Prize the opponent has taken). **Named so the next
//     session does not rediscover them and does not mistake them for closed.**
//
//     **AND THE REST OF THE 24/21/5 IS NOT AN HP GRANT AT ALL**, which is the
//     other half of the proof: `Resolute Heart`/`Sturdy` (7) and Survival Brace
//     read *"full HP"* as a KO REFUSAL (D208, built); Pidove/Ledian/Fan Rotom/
//     Alomomola/Mandibuzz/Bianca's Devotion/Buddy-Buddy Poffin/Rescue Board read
//     *"N HP or less"* as a THRESHOLD (D265/D275, built); Antique Fossils print a
//     60-HP body; Tyme asks the opponent to GUESS one; and all five
//     `attacks_json` hits are *"put damage counters until its remaining HP is
//     N"*, which is a DAMAGE op and not a maximum. **`BUILT.attack` cannot move
//     on this seam at any width** — D306's rule, holding for the fifth slice.
//
// (c) **`effectiveMaxHp` READ BEFORE BELIEVING THE FIELD WAS NEW**, and half the
//     row was already in the function's hands for the third consecutive session.
//     It was `hpOf(top) + passivesOf(state, pokemon).hpBonus`, and that
//     accumulator had EXACTLY ONE contributor — `basicHpBonus`, from EXACTLY ONE
//     printing, Bravery Charm `sv02-173`. So the READ SITE was free (the KO
//     check, the HUD projection, the evolve-below-HP window and `koSurvivalClamp`
//     all already go through it) and only the SOURCES were missing.
//     ⚠️ **AND `seatHpBonus` REALLY DID NOT EXIST** — D323 guessed that name into
//     a census row and `tsc` refused it. It exists now because this slice
//     declared it, which is the opposite of inheriting it from a doc bullet.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 WHAT READING `effectiveMaxHp` ACTUALLY BOUGHT, AND IT WAS NOT THE CHEAP HALF.
// ─────────────────────────────────────────────────────────────────────────────
//
// The function's docblock says it never returns a non-positive number, and D205
// **DELETED A BRANCH** on the strength of it: `koSurvivalClamp` carries no
// `dealt <= 0` guard because reaching its lethality test needs `pokemon.damage
// === 0`, so `0 + dealt >= hp >= 1` can only hold for `dealt >= 1`. That mutant
// was proved UNKILLABLE and the branch removed rather than tested around.
//
// **THAT PROPERTY HELD FOR FREE ONLY WHILE EVERY TERM WAS AN ADDEND.** Gravity
// Mountain is the first subtrahend in the engine, and a build that summed it in
// without noticing would have made a deleted branch reachable in another file
// with nothing anywhere going red. The invariant is now an explicit `Math.max`.
// ⚠️ **AND IT IS DRIVEN RATHER THAN DECLARED** (§8), which the registry doc-block
// did not expect: the LEGAL pool cannot reach it — minimum printed HP over all
// **169** Standard-legal Stage 2 Pokémon is **120**, so −30 bottoms out at 90 —
// but a FIXTURE Stage 2 can, and one is built here for exactly that line.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SIX SENTENCES, transcribed off the remote D1 on 2026-08-10.
// ─────────────────────────────────────────────────────────────────────────────
//
//   Ludicolo sv09-037 "Vibrant Dance"
//     "All of your Pokémon in play get +40 HP. The effect of Vibrant Dance
//      doesn't stack."
//   Lively Stadium sv08-180
//     "Each Basic Pokémon in play (both yours and your opponent's) gets +30 HP."
//   Gravity Mountain sv08-177 / sv08-250
//     "Each Stage 2 Pokémon in play (both yours and your opponent's) gets -30 HP."
//   Hero's Cape sv05-152
//     "The Pokémon this card is attached to gets +100 HP."
//   Cynthia's Power Weight sv10-162
//     "The Cynthia's Pokémon this card is attached to gets +70 HP."
//
// 🛑 **THEY ARE EACH OTHER'S CONTROLS ON EVERY AXIS THE SEAM HAS**, which is what
// makes six printings worth more than six rows: SIGN (Lively +30 / Gravity −30),
// STAGE (Basic-only / Stage-2-only / stage-FREE), SCOPE (self / seat-wide / both
// sides), §9 (Ability suppressible / Stadium and Tool immune), and STACKING
// (capped / uncapped). Every one of those five is driven below on a board where
// the other four are held still.
//
// ⚠️ **`MATCH_RECORD_VERSION` DOES NOT MOVE.** Nothing here is persisted: three
// new registry fields and two new derivations, all re-read off the board at every
// call. No `GameState` shape changed and no event gained a field.

const LUDICOLO = "sv09-037";
const LIVELY = "sv08-180";
const GRAVITY = "sv08-177";
const GRAVITY_R = "sv08-250";
const CAPE = "sv05-152";
const WEIGHT = "sv10-162";
/** Bravery Charm — the Basic-ONLY +50, and the control that makes Hero's Cape's
    missing stage clause observable rather than merely declared. */
const CHARM = "sv02-173";
/** Ting-Lu ex `sv02-127` "Cursed Land" — *"your opponent's **damaged** Pokémon
    have no Abilities, except for Pokémon ex"*, Active-source, and the §9 lock this
    file uses for D322's reason: Klefki "Mischievous Lock" narrows to BASICS and
    Ludicolo is a Stage 2, so *"no lock in the pool reaches this source"* would
    have been a claim about the LOCK POPULATION rather than about the code.
    Cursed Land carries no stage clause at all. ⚠️ Its own riders (`requiresDamage`,
    `requiresActive`) are what make §4's board an ACTIVE, DAMAGED Ludicolo. */
const TING_LU = "sv02-127";

/** A plain 60-HP Basic with no Ability — every "the aura reaches a teammate"
    assertion is about THIS body, so a bonus that leaked from its own card would
    be invisible. */
const TEAMMATE = "fix-basic-1";
/** A 90-HP Stage 1 evolving from `fix-basic-1` — the STAGE control that
    separates Bravery Charm from Hero's Cape across one evolution, and the body
    that proves Lively Stadium's Basic clause is read. */
const STAGE1 = "fix-stage1";
/** A FIXTURE Stage 2 at 20 printed HP. **THE ONLY BODY IN THE REPO THAT CAN
    REACH `effectiveMaxHp`'s FLOOR**, and it exists for that one line: the legal
    pool's smallest Stage 2 is 120 HP, so −30 can never bottom out on a real
    printing and the clamp would otherwise be a declared bound with no driver. */
const TINY_STAGE2 = "fix-tiny-stage2";
/** A Cynthia's Pokémon — the `ownerPokemon` filter's POSITIVE case. A fixture
    rather than a printing because what is under test is the FILTER, and the
    filter reads `card.name.startsWith("Cynthia's ")` off whatever body holds the
    Tool. `fix-basic-1` is its negative control on the same board. */
const CYNTHIAS = "fix-cynthias-basic";

/** ⚠️ **THE SIX REAL IDS ARE DECLARED HERE AND NOT IN `FIXTURE_POOL`, AND WHAT
    DIVERGES FROM THE PRINT IS STATED RATHER THAN SILENT** (D321's rule, D323's
    practice). `sv09-037`, `sv08-177`/`-180`/`-250`, `sv05-152` and `sv10-162` are
    in sets the LOCAL D1 does not hold — `catalogManifest.ts` covers sv01/sv02/
    sv03/sv06.5/sve/swsh10.5 only — so `catalogManifest.test.ts` cannot diff them
    and a quiet divergence would have no guard behind it.

      • **Ludicolo is the print, whole**: 140 HP, Stage 2 from Lombre, {W},
        retreat 2, and "Hydro Splash" {W}{W}{C} 130 at index 0. Transcribed off
        the remote D1 with the row's own `length()`s checked (`abilities_json`
        137, `attacks_json` 75, `effect` empty) so `censusAtHead.test.ts`'s
        three-column key can be re-derived from the same reading.
      • **The three Trainers are their printed `effect` verbatim**, with
        `trainer_type` — `Stadium`, `Stadium`, `Stadium`, `Tool`, `Tool` — taken
        off the same rows. Nothing is abridged; these sentences are one line each.
      • **`fix-tiny-stage2` is DELIBERATELY UNPRINTABLE.** No Stage 2 in Standard
        has 20 HP and none ever will; the body exists to drive a clamp the real
        pool cannot reach, and saying so here is what stops a later reader
        "correcting" it to a legal number and silently deleting the only driver. */
const LOCAL_CARDS: Record<string, Card> = {
  [LUDICOLO]: battler(LUDICOLO, {
    name: "Ludicolo",
    hp: 140,
    retreat: 2,
    types: ["Water"],
    stage: "Stage2",
    evolveFrom: "Lombre",
    attacks: [{ cost: ["Water", "Water", "Colorless"], name: "Hydro Splash", damage: 130 }],
    abilities: [
      {
        type: "Ability",
        name: "Vibrant Dance",
        effect:
          "All of your Pokémon in play get +40 HP. The effect of Vibrant Dance doesn't stack.",
      },
    ],
  }),
  [LIVELY]: trainerCard(
    LIVELY,
    "Stadium",
    "Each Basic Pokémon in play (both yours and your opponent's) gets +30 HP.",
  ),
  [GRAVITY]: trainerCard(
    GRAVITY,
    "Stadium",
    "Each Stage 2 Pokémon in play (both yours and your opponent's) gets -30 HP.",
  ),
  [GRAVITY_R]: trainerCard(
    GRAVITY_R,
    "Stadium",
    "Each Stage 2 Pokémon in play (both yours and your opponent's) gets -30 HP.",
  ),
  [CAPE]: trainerCard(CAPE, "Tool", "The Pokémon this card is attached to gets +100 HP."),
  [WEIGHT]: trainerCard(
    WEIGHT,
    "Tool",
    "The Cynthia's Pokémon this card is attached to gets +70 HP.",
  ),
  [TINY_STAGE2]: battler(TINY_STAGE2, {
    name: "Tiny Stage 2",
    hp: 20,
    stage: "Stage2",
    evolveFrom: "Nothing",
  }),
  [CYNTHIAS]: battler(CYNTHIAS, { name: "Cynthia's Tester", hp: 60 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const HP_DECK = deckOf({
  [LUDICOLO]: 4,
  [LIVELY]: 3,
  [GRAVITY]: 3,
  [GRAVITY_R]: 2,
  [CAPE]: 4,
  [WEIGHT]: 6,
  [CHARM]: 4,
  [TING_LU]: 3,
  [TINY_STAGE2]: 3,
  [CYNTHIAS]: 3,
  [TEAMMATE]: 8,
  [STAGE1]: 6,
  "fix-sniper": 4,
  "fix-energy": 7,
});

/** THREE SEEDS (D270's rule). No coin is flipped anywhere on this seam — every
    sentence here is a flat arithmetic term — so three is the family's default
    rather than D323's five. */
const SEEDS = [8101, 8111, 8117] as const;

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

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: HP_DECK, p2: HP_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
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

/** P1 is the seat under test on every board in this file. `p1Active` / `p1Bench`
    and `p2Active` / `p2Bench` are placed straight from the deck, and the walk to
    turn 3 leaves P1 to act — which is what lets a board PLAY a Stadium or attach
    a Tool rather than only assert on a constructed state. */
function board(
  seed: number,
  opts: {
    p1Active?: string;
    p1Bench?: readonly string[];
    p2Active?: string;
    p2Bench?: readonly string[];
  } = {},
): GameState {
  let state = localSetup(seed);
  state = clearBench(setActiveFromDeck(state, "p1", opts.p1Active ?? TEAMMATE), "p1");
  for (const id of opts.p1Bench ?? [TEAMMATE]) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", opts.p2Active ?? TEAMMATE), "p2");
  for (const id of opts.p2Bench ?? [TEAMMATE]) state = benchFromDeck(state, "p2", id);
  for (let i = 0; i < 12; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    if (state.phase.seat === "p1" && state.turn >= 3) break;
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return state;
}

/** Put `stadiumId` into play the way a player does — from `seat`'s hand, through
    `playTrainer`. ⚠️ **A CONSTRUCTED `state.stadium` WOULD HAVE BEEN GREEN AND
    DEAD** (D310/D314/D318's rule): what is asserted below is that the Stadium the
    RULES put in the zone is the one `effectiveMaxHp` reads, and only a real
    action proves the two are the same object. */
function playStadium(state: GameState, seat: Seat, stadiumId: string): GameState {
  const next = handFromDeck(state, seat, stadiumId, 1);
  return must(applyAction(next, { type: "playTrainer", seat, uid: handUid(next, seat, stadiumId) }));
}

/** `playStadium` with the EVENTS kept — §7's Knock-Out rows are the whole
    observation there, and the state-only helper above throws them away. */
function playStadiumWith(
  state: GameState,
  seat: Seat,
  stadiumId: string,
): { state: GameState; events: readonly GameEvent[] } {
  const next = handFromDeck(state, seat, stadiumId, 1);
  const result = applyAction(next, {
    type: "playTrainer",
    seat,
    uid: handUid(next, seat, stadiumId),
  });
  if (!result.ok) throw new Error(`playTrainer failed: ${result.error.code}`);
  return { state: result.state, events: result.events };
}

/** Attach `toolId` from `seat`'s hand to a spot — the same argument as
    `playStadium` one function up, on the other persistent zone. */
function attachTool(
  state: GameState,
  seat: Seat,
  toolId: string,
  target: { spot: "active" } | { spot: "bench"; index: number },
): GameState {
  const next = handFromDeck(state, seat, toolId, 1);
  return must(
    applyAction(next, { type: "attachTool", seat, uid: handUid(next, seat, toolId), target }),
  );
}

function activeMaxHp(state: GameState, seat: Seat): number | null {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return effectiveMaxHp(state, active);
}

function benchMaxHp(state: GameState, seat: Seat, index: number): number | null {
  const body = state.players[seat].bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${index}]`);
  return effectiveMaxHp(state, body);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE SIX REGISTRY ROWS — and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §1 — the six registry rows", () => {
  it("Vibrant Dance authors THREE clauses and deliberately not a fourth", () => {
    expect(programFor(LUDICOLO)?.passive).toEqual({
      seatHpBonus: { ability: "Vibrant Dance", amount: 40, noStack: true },
    });
    // 🛑 THE ROW D320/D321/D322 ALL RECORDED AS BUILT. This assertion is the one
    // that could not have been written for three sessions, and D323's
    // `expect(programFor("sv09-037")).toBeUndefined()` is its exact negative.
    expect(programFor(LUDICOLO)?.passive?.seatHpBonus?.amount).toBe(40);
    // NOT a `hpBonus`: that field is folded out of the body's OWN sources, and
    // "all of your Pokémon in play" is a fact about a DIFFERENT body.
    expect(programFor(LUDICOLO)?.passive?.hpBonus).toBeUndefined();
    // NOT a `basicHpBonus`: the sentence prints no stage word at all, so a build
    // that reused Bravery Charm's field would have paid nothing to a Stage 1 or 2
    // teammate and been green on any board made only of Basics.
    expect(programFor(LUDICOLO)?.passive?.basicHpBonus).toBeUndefined();
    // NOT a `triggered` row and NOT a `stadium` — it is a continuous Ability.
    expect(programFor(LUDICOLO)?.triggered).toBeUndefined();
    expect(programFor(LUDICOLO)?.stadium).toBeUndefined();
  });

  it("the two Stadiums are ONE signed field, and the reprint SHARES the object", () => {
    expect(programFor(LIVELY)?.stadium).toEqual({ hpDelta: { amount: 30, stage: "basic" } });
    expect(programFor(GRAVITY)?.stadium).toEqual({ hpDelta: { amount: -30, stage: "stage2" } });
    // 🛑 THE SIGN IS ON THE ROW, NOT IN THE READER. A `hpDiscount`/`hpSurcharge`
    // pair — which is what the RETREAT seam two screens over uses — would be two
    // fields whose only distinction is which way the number leans, and the read
    // site would have to re-add them (D131's two-channels-for-one-reading defect).
    // The retreat pair is split because its surcharge carries `excludesType` and
    // its discount does not; these two carry no rider either lacks.
    expect(programFor(GRAVITY)?.stadium?.hpDelta?.amount).toBeLessThan(0);
    expect(programFor(LIVELY)?.stadium?.hpDelta?.amount).toBeGreaterThan(0);
    expect(programFor(LIVELY)?.stadium?.hpDelta?.stage).not.toBe(
      programFor(GRAVITY)?.stadium?.hpDelta?.stage,
    );
    // A card's reprints are ONE object — `censusAtHead.test.ts`'s term rule, and
    // the reason Gravity Mountain is 2 printings but only 1 program object.
    expect(programFor(GRAVITY_R)).toBe(programFor(GRAVITY));
    // Neither is an Ability or a passive: no §9 gate can reach them (§6).
    expect(programFor(LIVELY)?.passive).toBeUndefined();
    expect(programFor(GRAVITY)?.passive).toBeUndefined();
  });

  it("the two Tools are STAGE-FREE, which is the whole of what separates them from Bravery Charm", () => {
    expect(programFor(CAPE)?.passive).toEqual({ hpBonus: { amount: 100 } });
    expect(programFor(WEIGHT)?.passive).toEqual({
      hpBonus: { amount: 70, beneficiary: { kind: "ownerPokemon", owner: "Cynthia" } },
    });
    // 🛑 THE FIELD `passivesOf`'s OWN AUDIT ORDERED. Its D174 source enumeration
    // says of `basicHpBonus`: "a printing that said only 'this Pokémon' must use a
    // stage-free field, not this one". These are those printings, and the audit
    // was right — widening `basicHpBonus` would have given Bravery Charm a bonus
    // that survives evolution, the one behaviour its doc-block calls load-bearing.
    expect(programFor(CAPE)?.passive?.basicHpBonus).toBeUndefined();
    expect(programFor(CHARM)?.passive).toEqual({ basicHpBonus: 50 });
    expect(programFor(CHARM)?.passive?.hpBonus).toBeUndefined();
    // Hero's Cape carries NO beneficiary — the sentence names no owner, and a
    // filter here would silently narrow a clause that narrows nothing.
    expect(programFor(CAPE)?.passive?.hpBonus?.beneficiary).toBeUndefined();
    // The owner is "Cynthia" and NOT "Cynthia's" — `matchesFilter`'s
    // `ownerPokemon` arm appends the possessive and the space itself.
    expect(programFor(WEIGHT)?.passive?.hpBonus?.beneficiary).toEqual({
      kind: "ownerPokemon",
      owner: "Cynthia",
    });
  });

  it("no OTHER card in the registry carries the three new fields — the closure claim", () => {
    // Made against the REGISTRY rather than against the catalog, D323's shape: if
    // a later session adds a seventh printing without widening the census, this
    // row is where it shows up.
    const seatHolders: string[] = [];
    const toolHolders: string[] = [];
    const stadiumHolders: string[] = [];
    for (const id of Object.keys(POOL)) {
      const program = programFor(id);
      if (program?.passive?.seatHpBonus !== undefined) seatHolders.push(id);
      if (program?.passive?.hpBonus !== undefined) toolHolders.push(id);
      if (program?.stadium?.hpDelta !== undefined) stadiumHolders.push(id);
    }
    expect(seatHolders).toEqual([LUDICOLO]);
    expect(toolHolders.sort()).toEqual([CAPE, WEIGHT].sort());
    expect(stadiumHolders.sort()).toEqual([GRAVITY, LIVELY, GRAVITY_R].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE ORDERED ROW — the seat-wide aura, on a real board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §2 — Vibrant Dance: +40 to ALL of your Pokémon in play", () => {
  it.each(SEEDS)("raises the holder AND every teammate, and nothing opposite (seed %i)", (seed) => {
    const state = board(seed, {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, STAGE1],
      p2Active: TEAMMATE,
      p2Bench: [TEAMMATE],
    });
    // 🛑 THE SOURCE IS INSIDE THE SET IT PAYS. "All of your Pokémon in play"
    // includes the Ludicolo saying it, so a lone Ludicolo is at 140 + 40. A build
    // that copied Feint Attack's `othersOnly` exclusion would read 140 here and be
    // green on every other assertion in this file.
    expect(activeMaxHp(state, "p1")).toBe(180);
    // …and it is genuinely SEAT-WIDE rather than Active-only: the bench pays too,
    // at BOTH stages, which is what refuses a `basicHpBonus`-shaped build.
    expect(benchMaxHp(state, "p1", 0)).toBe(100); // fix-basic-1: 60 + 40
    expect(benchMaxHp(state, "p1", 1)).toBe(130); // fix-stage1: 90 + 40 — NOT Basic
    // The opponent is untouched — "YOUR Pokémon", and the scan returns on the
    // first side holding the uid.
    expect(activeMaxHp(state, "p2")).toBe(60);
    expect(benchMaxHp(state, "p2", 0)).toBe(60);
    // …and the scan itself says ZERO on that side, so the 60 above is a real
    // absence rather than a printed HP that happens to match.
    const p2Active = state.players.p2.active;
    if (p2Active === null) throw new Error("unreachable");
    expect(seatMaxHpBonus(state, p2Active)).toBe(0);
  });

  it("a BENCHED Ludicolo pays the whole side — the source's own spot is not a clause", () => {
    // The printed sentence carries no "As long as this Pokémon is in the Active
    // Spot", so the scan has no `sourceOnBench`/`sourceActive` rider. Its sibling
    // `seatDamageReductionAfterWR` DOES carry one (Steven's Carbink), which is why
    // the absence is asserted rather than assumed.
    const state = board(SEEDS[0], {
      p1Active: TEAMMATE,
      p1Bench: [LUDICOLO, STAGE1],
      p2Active: TEAMMATE,
    });
    expect(activeMaxHp(state, "p1")).toBe(100);
    expect(benchMaxHp(state, "p1", 0)).toBe(180); // the Ludicolo itself
    expect(benchMaxHp(state, "p1", 1)).toBe(130);
    expect(activeMaxHp(state, "p2")).toBe(60);
  });

  it("no Ludicolo in play is ZERO and not a default — the scan's negative control", () => {
    const state = board(SEEDS[0], { p1Active: STAGE1, p1Bench: [TEAMMATE] });
    const active = state.players.p1.active;
    if (active === null) throw new Error("unreachable");
    expect(seatMaxHpBonus(state, active)).toBe(0);
    expect(activeMaxHp(state, "p1")).toBe(90); // printed only
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. "THE EFFECT OF VIBRANT DANCE DOESN'T STACK" — the sixth of six.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §3 — the cap, and it is a LEDGER rather than a flag", () => {
  it.each(SEEDS)("TWO Ludicolo give +40 and not +80 (seed %i)", (seed) => {
    const state = board(seed, {
      p1Active: LUDICOLO,
      p1Bench: [LUDICOLO, TEAMMATE],
      p2Active: TEAMMATE,
    });
    // 🛑 THE SHARPEST BOARD THE SENTENCE HAS. Both Ludicolo satisfy every clause
    // at once — each is "your Pokémon in play" for the other — so a summing build
    // reads 220 on the Active and 140 on the teammate, and a capping one reads
    // 180 and 100. Nothing short of a second copy can tell them apart.
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(benchMaxHp(state, "p1", 0)).toBe(180);
    expect(benchMaxHp(state, "p1", 1)).toBe(100);
  });

  it("THREE Ludicolo is still +40 — the ledger is keyed, not decremented", () => {
    const state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [LUDICOLO, LUDICOLO, TEAMMATE],
    });
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(benchMaxHp(state, "p1", 2)).toBe(100);
  });

  it("the cap is keyed on the printed ABILITY NAME — the claim, stated as arithmetic", () => {
    // The ledger stores `Math.max` per key, so two DIFFERENT non-stacking auras
    // would still stack with each other while two of the SAME name do not. There
    // is only one printing of this field in the pool, so the claim is made where
    // it is made: on the shape of the row rather than on a board that cannot exist.
    // ⚠️ This is `seatDamageReduction`'s ledger and DELIBERATELY NOT
    // `seatKoPrizeBonuses`' entry Set — an HP bonus is arithmetic, so "largest
    // single contribution wins" IS the meaning of "doesn't stack"; a coin flip is
    // not an amount, which is why that one had to cap the ENTRY instead.
    expect(programFor(LUDICOLO)?.passive?.seatHpBonus?.ability).toBe("Vibrant Dance");
    expect(programFor(LUDICOLO)?.passive?.seatHpBonus?.noStack).toBe(true);
  });

  it("🛑 the *doesn't stack* row is CLOSED at SIX OF SIX", () => {
    // The family `registry.ts`'s `doesNotStack` doc-block has tracked since D243,
    // and which THREE handoffs recorded as five-of-six before the sixth existed.
    // Every one is asserted on the FIELD it actually authors, so a row that lost
    // its clause in a later refactor reddens here rather than in a doc bullet.
    expect(programFor("sv07-119")?.passive?.seatDamageReductionAfterWR?.noStack).toBe("Curly Wall");
    expect(programFor("svp-136")?.passive?.seatDamageReductionAfterWR?.noStack).toBe("Curly Wall");
    expect(programFor("sv10-086")?.passive?.seatDamageReductionAfterWR?.noStack).toBe(
      "Stone Palace",
    );
    expect(programFor("sv09-117")?.passive?.seatDamageBonusBeforeWR?.noStack).toBe("Extra Helpings");
    expect(programFor("svp-184")?.passive?.seatDamageBonusBeforeWR?.noStack).toBe("Extra Helpings");
    expect(programFor("sv10-074")?.triggered?.[0]?.doesNotStack).toBe(true);
    expect(programFor("sv08-072")?.passive?.koPrizeBonus?.noStack).toBe(true);
    // …and the SIXTH Ability, which is this slice.
    expect(programFor(LUDICOLO)?.passive?.seatHpBonus?.noStack).toBe(true);
    // 🛑 FIVE DIFFERENT SEAMS CARRY THE SAME PRINTED CLAUSE, AND NOT ONE OF THEM
    // SHARES A FIELD WITH ANOTHER: after-W/R reduction, pre-W/R bonus, a triggered
    // ability, a prize bonus, and now a max-HP aura. That is the finding the row
    // was worth — the clause is a SENTENCE PATTERN and never a mechanism, so no
    // generic `doesNotStack` handler could ever have been written for it.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. §9 — an Ability-lock takes the aura off the WHOLE SIDE at once.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §4 — the lock, and it reaches bodies the lock's own clause cannot", () => {
  it("Cursed Land over a DAMAGED ACTIVE Ludicolo removes +40 from the bench too", () => {
    let state = board(SEEDS[0], {
      p1Active: TING_LU,
      p2Active: LUDICOLO,
      p2Bench: [TEAMMATE, STAGE1],
    });
    // Undamaged: Cursed Land's `requiresDamage` rider refuses, so the aura stands.
    expect(activeMaxHp(state, "p2")).toBe(180);
    expect(benchMaxHp(state, "p2", 0)).toBe(100);
    state = setDamage(state, "p2", 10);
    // 🛑 THE OBSERVABLE THAT NO OTHER FIELD IN THIS FAMILY HAS. The lock reaches
    // ONE body — the opponent's damaged ACTIVE — and the effect it silences is
    // SEAT-WIDE, so a bench that Cursed Land can never touch loses 40 HP because
    // of a clause evaluated on a different Pokémon.
    expect(activeMaxHp(state, "p2")).toBe(140); // printed only
    expect(benchMaxHp(state, "p2", 0)).toBe(60);
    expect(benchMaxHp(state, "p2", 1)).toBe(90);
    // P1's own side is unaffected in both directions — the lock is one-way.
    expect(activeMaxHp(state, "p1")).toBe(POOL[TING_LU]?.hp ?? 0);
  });

  it("🛑 the gate is on the SOURCE's uid and not on the BENEFICIARY's", () => {
    // ⚠️ **AND `requiresActive` GATES THE SOURCE, NOT THE TARGET — WHICH IS A READ
    // OF `disabledAbilityUids` AND NOT AN INFERENCE FROM THE FIELD NAME.** The
    // line is `if (aura.requiresActive === true && holder !== side.active)
    // continue`, evaluated while COLLECTING the auras, so Cursed Land silences
    // every damaged body on the opposite side at any spot. A test written from
    // the name would have put an undamaged Ludicolo on the bench and called it a
    // control; the real control is the one below.
    //
    // Here the DAMAGED body is the beneficiary and the UNDAMAGED one is the
    // source: Cursed Land silences the Active's own Abilities (it has none) and
    // cannot touch the benched Ludicolo, so the Active keeps its +40 while being
    // itself locked. A build that had gated on the BENEFICIARY's uid rather than
    // the SOURCE's reads 60 here and is green on every other row in this file.
    let state = board(SEEDS[0], {
      p1Active: TING_LU,
      p2Active: TEAMMATE,
      p2Bench: [LUDICOLO],
    });
    state = setDamage(state, "p2", 10);
    expect(activeMaxHp(state, "p2")).toBe(100);
    expect(benchMaxHp(state, "p2", 0)).toBe(180);
    // …and damaging the SOURCE is what actually switches it off, at the same spot.
    state = setBenchDamage(state, "p2", 0, 10);
    expect(activeMaxHp(state, "p2")).toBe(60);
    expect(benchMaxHp(state, "p2", 0)).toBe(140);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE STADIUM — both sides, one stage, and the SIGN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §5 — Lively Stadium and Gravity Mountain are each other's control", () => {
  it.each(SEEDS)("Lively Stadium gives +30 to EVERY Basic, both sides (seed %i)", (seed) => {
    let state = board(seed, {
      p1Active: TEAMMATE,
      p1Bench: [STAGE1],
      p2Active: TEAMMATE,
      p2Bench: [STAGE1],
    });
    expect(activeMaxHp(state, "p1")).toBe(60);
    state = playStadium(state, "p1", LIVELY);
    // 🛑 IT PAYS THE OPPONENT TOO, WHICH IS THE PRINTED "(both yours and your
    // opponent's)" AND THE THING THAT SEPARATES A STADIUM FROM EVERY AURA ABOVE.
    // P1 played it; P2's Basic gets the same +30.
    expect(activeMaxHp(state, "p1")).toBe(90);
    expect(activeMaxHp(state, "p2")).toBe(90);
    // …and the STAGE clause is read: a Stage 1 gets nothing from a Basic-only
    // sentence, on either side.
    expect(benchMaxHp(state, "p1", 0)).toBe(90); // fix-stage1's printed 90, unchanged
    expect(benchMaxHp(state, "p2", 0)).toBe(90);
  });

  it.each(SEEDS)("Gravity Mountain takes 30 off every STAGE 2, both sides (seed %i)", (seed) => {
    let state = board(seed, {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE],
      p2Active: LUDICOLO,
      p2Bench: [STAGE1],
    });
    // Both Ludicolo pay their OWN side, so the two Actives start level and the
    // Stadium's effect is the DELTA rather than the difference between them.
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(activeMaxHp(state, "p2")).toBe(180);
    state = playStadium(state, "p1", GRAVITY);
    // 🛑 P1 PLAYED IT AND P1 PAYS IT — "(both yours and your opponent's)", and a
    // seat-derived build would have taken 30 off exactly one of these two.
    expect(activeMaxHp(state, "p1")).toBe(150); // 140 + 40 aura − 30 stadium
    expect(activeMaxHp(state, "p2")).toBe(150);
    // A Basic and a Stage 1 are untouched by a Stage-2-only sentence — the STAGE
    // control that the sign alone could not provide.
    expect(benchMaxHp(state, "p1", 0)).toBe(100); // 60 + 40 aura, no stadium term
    expect(benchMaxHp(state, "p2", 0)).toBe(130); // 90 + 40 aura, no stadium term
  });

  it("the reprint behaves identically — 2 printings, 1 sentence, 1 object", () => {
    let state = board(SEEDS[0], { p1Active: LUDICOLO, p2Active: LUDICOLO });
    state = playStadium(state, "p1", GRAVITY_R);
    expect(activeMaxHp(state, "p1")).toBe(150);
    expect(activeMaxHp(state, "p2")).toBe(150);
  });

  it("replacing the Stadium replaces the term — nothing is stamped", () => {
    // Only one Stadium is ever in play (§7.3), so the two deltas never meet; what
    // this drives is that the number is LIVE-READ off the zone rather than applied
    // once at play time. A build that stamped an HP bonus onto the body would be
    // green on every board above and red here.
    let state = board(SEEDS[0], { p1Active: TEAMMATE, p2Active: TEAMMATE });
    state = playStadium(state, "p1", LIVELY);
    expect(activeMaxHp(state, "p1")).toBe(90);
    // ⚠️ ONE STADIUM PLAY PER TURN (§7.3, `STADIUM_ALREADY_PLAYED`), so the
    // replacement needs a turn — which is itself the point: nothing about the
    // first Stadium survived into the second.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = playStadium(state, "p1", GRAVITY);
    expect(activeMaxHp(state, "p1")).toBe(60); // Basic: the Stage-2 sentence says nothing
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE §9 ASYMMETRY — one board, two sources, opposite answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §6 — a Stadium is not an Ability, and the lock proves it", () => {
  it("Cursed Land silences Vibrant Dance and leaves Gravity Mountain running", () => {
    let state = board(SEEDS[0], {
      p1Active: TING_LU,
      p2Active: LUDICOLO,
      p2Bench: [TEAMMATE],
    });
    state = playStadium(state, "p1", GRAVITY);
    expect(activeMaxHp(state, "p2")).toBe(150); // 140 + 40 − 30
    state = setDamage(state, "p2", 10);
    // 🛑 THE SLICE'S SHARPEST BOARD. Two continuous sources sum into ONE number at
    // ONE read site, and a single Ability-lock removes exactly one of them. If the
    // Stadium had been given a §9 gate by analogy with the aura beside it, this
    // reads 140; if the aura had been left ungated, it reads 150.
    expect(activeMaxHp(state, "p2")).toBe(110); // 140 + 0 − 30
    expect(benchMaxHp(state, "p2", 0)).toBe(60); // the aura is gone from the bench too
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE TOOLS — and the evolution that separates them.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §7 — Hero's Cape vs Bravery Charm across ONE evolution", () => {
  it("both pay a Basic; only Hero's Cape survives the evolution", () => {
    let state = board(SEEDS[0], { p1Active: TEAMMATE, p1Bench: [TEAMMATE] });
    state = attachTool(state, "p1", CHARM, { spot: "active" });
    state = attachTool(state, "p1", CAPE, { spot: "bench", index: 0 });
    expect(activeMaxHp(state, "p1")).toBe(110); // 60 + 50, Basic-only
    expect(benchMaxHp(state, "p1", 0)).toBe(160); // 60 + 100, stage-free
    // Evolve BOTH, carrying both Tools (§10).
    state = handFromDeck(state, "p1", STAGE1, 2);
    const [first, second] = state.players.p1.hand.filter(
      (uid) => state.cardIdByUid[uid] === STAGE1,
    );
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: first as string,
        target: { spot: "active" },
      }),
    );
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: second as string,
        target: { spot: "bench", index: 0 },
      }),
    );
    // 🛑 ONE BOARD, TWO TOOLS, OPPOSITE ANSWERS — and this is the whole reason
    // `hpBonus` is a second field rather than `basicHpBonus` with its gate
    // removed. The Charm's +50 ENDS (its sentence names a Basic); the Cape's +100
    // does not (its sentence names a Pokémon).
    expect(state.players.p1.active?.tools.length).toBe(1);
    expect(activeMaxHp(state, "p1")).toBe(90); // fix-stage1 printed, Charm inert
    expect(benchMaxHp(state, "p1", 0)).toBe(190); // 90 + 100, Cape still paying
  });

  it("Cynthia's Power Weight reads the HOLDER's name — both directions", () => {
    let state = board(SEEDS[0], { p1Active: CYNTHIAS, p1Bench: [TEAMMATE] });
    state = attachTool(state, "p1", WEIGHT, { spot: "active" });
    state = attachTool(state, "p1", WEIGHT, { spot: "bench", index: 0 });
    // The POSITIVE case and its control differ in the NAME and in nothing else —
    // both 60-HP Basics, both holding the same Tool.
    expect(activeMaxHp(state, "p1")).toBe(130); // "Cynthia's Tester": 60 + 70
    expect(benchMaxHp(state, "p1", 0)).toBe(60); // "fix-basic-1": filtered out
  });

  it("a NON-lethal drop leaves the turn exactly where it was", () => {
    // 🛑 **THIS ROW IS THE SURVIVING HALF OF D324's ORIGINAL PIN, AND THE PIN'S
    // OTHER HALF WAS WRONG.** D324 recorded *"the Stadium does NOT sweep on the
    // play, and that is a call-site fact"* — a true statement about the code
    // (`resolveMidTurnKnockOuts` had three call sites and `playStadium` was none
    // of them) offered as a statement about the RULES. §8.1's Knock Out is a
    // state check on `damage ≥ maximum`, not an event of whatever moved the
    // number, so a Stage 2 already past its reduced maximum is Knocked Out when
    // Gravity Mountain lands — exactly as a charmed Basic dies when it evolves out
    // of Bravery Charm's clause, which is the case D324 called the analogy for and
    // then decided against. ⚠️ **AND THE BOARD IT PINNED ON WAS NEVER LETHAL**:
    // 130 damage against a NEW maximum of 150 is a body that survives under both
    // readings, so the pin could not have gone red for the reason it claimed. It
    // is kept, unchanged, as the CONTROL it always really was.
    let state = board(SEEDS[0], { p1Active: LUDICOLO, p2Active: TEAMMATE });
    state = setDamage(state, "p1", 130); // 140 printed + 40 aura = 180: alive
    expect(activeMaxHp(state, "p1")).toBe(180);
    state = playStadium(state, "p1", GRAVITY);
    // 150 effective against 130 damage — still alive, so nothing is swept and the
    // actor is still in turn:action with the Stadium down.
    expect(activeMaxHp(state, "p1")).toBe(150);
    expect(state.players.p1.active?.damage).toBe(130);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("🛑 a LETHAL drop Knocks the body Out ON THE PLAY, not at the next Checkup", () => {
    // The same board, twenty damage further along: 160 against 180 is alive, and
    // against Gravity Mountain's 150 it is not. The only difference between this
    // row and the control above is the number.
    let state = board(SEEDS[0], { p1Active: LUDICOLO, p2Active: TEAMMATE });
    state = setDamage(state, "p1", 160);
    expect(activeMaxHp(state, "p1")).toBe(180);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p1")).toBe(true);
    // The KO's decisions interrupt the actor's own turn: the OPPONENT takes the
    // prize, and `resumeTurn` hands P1 back their turn:action afterwards.
    expect(played.state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2" });
  });

  it("🛑 the sweep covers BOTH boards — a Stadium's clause names both seats", () => {
    // ⚠️ THIS IS WHERE THE STADIUM SITE DIFFERS FROM turn.ts's THREE, which all
    // pass `[actorSeat]`. All three legal `hpDelta` printings say "(both yours and
    // your opponent's)", so the actor can Knock Out the OPPONENT's Pokémon by
    // playing a card — and the prize goes to the actor.
    let state = board(SEEDS[0], { p1Active: TEAMMATE, p2Active: LUDICOLO, p2Bench: [TEAMMATE] });
    state = setDamage(state, "p2", 160); // 140 printed + its OWN 40 aura = 180: alive
    expect(activeMaxHp(state, "p2")).toBe(180);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p2")).toBe(true);
    expect(played.state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1" });
  });

  it("🛑 the KO CASCADES — killing the aura's SOURCE can kill its teammates", () => {
    // 🛑 **THE BATCH IS A FIXED POINT, NOT A SNAPSHOT.** `collectKnockOuts` took
    // `lethalRefs` ONCE per batch, which was sound only while a Knock Out could
    // not change any OTHER body's lethality — an accident of the catalog rather
    // than a rule, and `seatHpBonus` ended it: the dying body is the SOURCE of its
    // whole side's maximum, so every teammate loses 40 max HP in the same instant.
    //
    // ONE ACTION, TWO KNOCK OUTS, AND THE SECOND ONE IS CAUSED BY THE FIRST:
    //   • Ludicolo — 140 printed + 40 its own aura − 30 Gravity Mountain = 150,
    //     carrying 160. Lethal on the play (the fix above).
    //   • the benched Basic — 60 printed + 40 aura = 100, carrying 70. ALIVE at
    //     100 and lethal at 60, and the only thing that takes the 40 away is
    //     Ludicolo leaving play.
    // A third, undamaged body keeps P1's board non-empty so what is under test is
    // the cascade rather than §14.2.
    let state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, TEAMMATE],
      p2Active: TEAMMATE,
    });
    state = setDamage(state, "p1", 160);
    state = setBenchDamage(state, "p1", 0, 70);
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(benchMaxHp(state, "p1", 0)).toBe(100); // alive while the aura pays
    const played = playStadiumWith(state, "p1", GRAVITY);
    const koed = played.events.filter((e) => e.type === "KNOCKED_OUT");
    expect(koed).toHaveLength(2);
    // Both Knock Outs are in the SAME batch, so P2 is owed TWO prize stages (one
    // per body, §8.1 grouping prizes-first) and parks on the first of them —
    // rather than one KO landing and a lethal body being left standing.
    expect(played.state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(played.state.players.p1.bench).toHaveLength(1);
    expect(benchMaxHp(played.state, "p1", 0)).toBe(60); // the aura is gone
  });

  it("…and a teammate that stays under its REDUCED maximum does not cascade", () => {
    // The control on the same board: 50 damage is under 60, so losing the aura
    // costs the teammate 40 max HP and nothing else. Without this row a build that
    // Knocked Out every teammate of a dying aura source would be green above.
    let state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, TEAMMATE],
      p2Active: TEAMMATE,
    });
    state = setDamage(state, "p1", 160);
    state = setBenchDamage(state, "p1", 0, 50);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(1);
    expect(played.state.players.p1.bench).toHaveLength(2);
  });

  it("🛑 a REPLACEMENT sweeps too — the delta that leaves is a drop as well", () => {
    // Lively Stadium's +30 on Basics is paying for a body that is 20 damage past
    // its printed HP; replacing it with Gravity Mountain (a different NAME, §7.3)
    // takes the +30 away and the Basic dies on the replacement, with the incoming
    // Stadium's own −30 having nothing to say about a Basic at all. The sweep is
    // owed on the PLAY, never on the sign of what was played.
    let state = board(SEEDS[0], { p1Active: TEAMMATE, p2Active: TEAMMATE });
    state = playStadium(state, "p1", LIVELY);
    expect(activeMaxHp(state, "p1")).toBe(90); // 60 printed + 30
    state = setDamage(state, "p1", 80);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.some((e) => e.type === "STADIUM_DISCARDED")).toBe(true);
    expect(played.events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p1")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. THE FLOOR — the invariant a DELETED branch depends on.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §8 — effectiveMaxHp never returns a non-positive number", () => {
  it("a 20-HP Stage 2 under Gravity Mountain clamps to 10 rather than going negative", () => {
    let state = board(SEEDS[0], { p1Active: TINY_STAGE2, p2Active: TEAMMATE });
    expect(activeMaxHp(state, "p1")).toBe(20);
    state = playStadium(state, "p1", GRAVITY);
    // 🛑 20 − 30 = −10, AND THE ANSWER IS 10. D205 proved a `dealt <= 0` guard in
    // `koSurvivalClamp` UNKILLABLE and DELETED it, on the ground that
    // `effectiveMaxHp` never returns a non-positive number — which was true for
    // free while every term was an addend. Gravity Mountain is the first
    // subtrahend in the engine, so the property is now maintained by a `Math.max`
    // and driven here rather than assumed anywhere.
    expect(activeMaxHp(state, "p1")).toBe(10);
  });

  it("the aura lifts the same body back off the floor — the clamp is not a constant", () => {
    // Without this, a mutant that replaced the whole expression with `10` would
    // survive the test above.
    let state = board(SEEDS[0], { p1Active: TINY_STAGE2, p1Bench: [LUDICOLO] });
    state = playStadium(state, "p1", GRAVITY);
    expect(activeMaxHp(state, "p1")).toBe(30); // 20 + 40 − 30, above the floor
  });

  it("⚠️ the floor is UNREACHABLE on a legal printing, and the fixture says so", () => {
    // The minimum printed HP over all 169 Standard-legal Stage 2 Pokémon is 120
    // (remote D1, 2026-08-10), and only a Stage 2 can be subtracted from — so the
    // one negative sentence bottoms out at 90 and no real card can clamp.
    // `fix-tiny-stage2` is deliberately unprintable and exists for the two rows
    // above; this row records WHY, so a later reader does not "correct" it to a
    // legal HP and silently delete the only driver the clamp has.
    expect(POOL[TINY_STAGE2]?.hp).toBe(20);
    expect(POOL[TINY_STAGE2]?.stage).toBe("Stage2");
    expect(POOL[LUDICOLO]?.hp).toBe(140); // the smallest Stage 2 this file holds
  });

  it("🛑 BOTH data gaps stay null — and they are TWO early returns, not one", () => {
    // ⚠️ **THE PROBE FOUND THIS ONE, AND IT WAS A REAL SUITE GAP RATHER THAN A
    // ROW AIMED WRONG.** `D324-max-hp-data-gap-floored` replaces
    // `const hp = hpOf(top); if (hp === null) return null;` with
    // `const hp = hpOf(top) ?? 0`, and it SURVIVED — because the only gap this
    // file drove was an UNRESOLVABLE uid, which `topCardOf` refuses one line
    // EARLIER at `if (top === undefined) return null`. The two returns answer two
    // different questions and a test that drives one says nothing about the other.
    const state = board(SEEDS[0], { p1Active: TEAMMATE });
    const active = state.players.p1.active;
    if (active === null) throw new Error("unreachable");
    const top = active.stack[active.stack.length - 1] as string;
    // GAP ONE — the uid resolves to no card at all. `topCardOf` returns undefined.
    const unresolvable: GameState = {
      ...state,
      cardIdByUid: { ...state.cardIdByUid, [top]: "fix-no-such-card" },
    };
    expect(effectiveMaxHp(unresolvable, active)).toBeNull();
    // GAP TWO — the card RESOLVES and prints no HP. `hpOf` returns null for a
    // non-Pokémon and for a non-positive printed value, so a Tool in the stack is
    // the cheapest body that reaches the second return with the first satisfied.
    // Without this line a build that floored the data gap to 10 would make every
    // unreadable body Knock-Outable and nothing in the repo would go red.
    const nullHp: GameState = {
      ...state,
      cardIdByUid: { ...state.cardIdByUid, [top]: CAPE },
    };
    expect(POOL[CAPE]?.hp ?? null).toBeNull(); // the premise, asserted not assumed
    expect(effectiveMaxHp(nullHp, active)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. THE READ SITE — every term sums at ONE place, and the KO check sees it.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §9 — the four sources sum, and a real KO reads the total", () => {
  it("aura + stadium + tool + printed, all on one Basic", () => {
    let state = board(SEEDS[0], { p1Active: TEAMMATE, p1Bench: [LUDICOLO] });
    expect(activeMaxHp(state, "p1")).toBe(100); // 60 + 40 aura
    state = playStadium(state, "p1", LIVELY);
    expect(activeMaxHp(state, "p1")).toBe(130); // + 30 stadium (Basic)
    state = attachTool(state, "p1", CAPE, { spot: "active" });
    // 🛑 THREE CONTINUOUS SOURCES OF THREE DIFFERENT CLASSES ON ONE BODY — an
    // Ability on ANOTHER Pokémon, the shared Stadium zone, and a Tool on this one
    // — arriving at ONE number through ONE function. That is what makes the seam
    // worth a field rather than four read sites: the KO check, the HUD
    // projection, the evolve-below-HP window and `koSurvivalClamp` all inherit
    // every one of them without a line of their own.
    expect(activeMaxHp(state, "p1")).toBe(230); // + 100 tool (stage-free)
    // ⚠️ **AND A FOURTH SOURCE IS NOT AVAILABLE, BECAUSE §7.4 SAYS SO.** A second
    // Tool on the same body is `TOOL_ALREADY_ATTACHED` — one Tool per Pokémon —
    // so Bravery Charm and Hero's Cape can never sum on one Pokémon and the fold
    // that adds `basicHpBonus` to `hpBonus` is, on today's pool, an addition with
    // at most one non-zero term. Recorded because it is exactly the kind of
    // arithmetic a later reader would assume was driven and is not.
    const second = handFromDeck(state, "p1", CHARM, 1);
    const refused = applyAction(second, {
      type: "attachTool",
      seat: "p1",
      uid: handUid(second, "p1", CHARM),
      target: { spot: "active" },
    });
    expect(refused.ok).toBe(false);
  });

  it("the §8.1 KO check reads the RAISED maximum — a real attack, not a direct call", () => {
    // ⚠️ REACHING IS NECESSARY BUT NOT SUFFICIENT (D318): every assertion above is
    // a direct call on `effectiveMaxHp`, and this one drives a real declaration
    // through `attack` so the number is proved to be the one the RULES use.
    // `fix-flat-hitter`-shaped boards are not needed — `fix-sniper`'s Spread Shot
    // hits the BENCH, which is where the aura's seat-wide half is observable.
    let state = board(SEEDS[0], {
      p1Active: TEAMMATE,
      p2Active: TEAMMATE,
      p2Bench: [TEAMMATE, LUDICOLO],
    });
    // P2's bench Basic sits on a side fielding a Ludicolo: 100 effective, not 60.
    expect(benchMaxHp(state, "p2", 0)).toBe(100);
    state = setBenchDamage(state, "p2", 0, 70);
    // 70 damage on a 100 maximum: ALIVE. On the printed 60 it would already be
    // Knocked Out, and the §8.1 sweep is what says which reading the engine uses.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.players.p2.bench[0]?.damage).toBe(70);
    expect(benchMaxHp(state, "p2", 0)).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. THE CASCADE'S **CAUSE** — what a second-pass Knock Out is "by" (D329).
// ─────────────────────────────────────────────────────────────────────────────

describe("D329 §10 — a cascade Knock Out is not 'by damage from an attack'", () => {
  /** The marks `knockOut` co-stamps for `seat` (D326), as {name, byAttack}. */
  function marks(state: GameState, seat: Seat): { name: string; byAttack: boolean }[] {
    return state.lastKoMarks[seat].map((m) => ({ name: m.name, byAttack: m.byAttack }));
  }

  it("🛑 the ATTACK's victim is marked `byAttack`, and the body its aura was holding up is NOT", () => {
    // 🛑 **D328 DECLARED THIS BOARD UNBUILDABLE.** Its corpus row
    // `D328-ko-cascade-inherits-the-attack-cause` was recorded
    // `unreachable-population` because *"the only cascade any suite builds is the
    // Stadium one — a MID-TURN sweep, which passes no `attackerSeat` on ANY pass,
    // so both readings agree there"*, and separating them *"needs an ATTACK whose
    // epilogue Knocks Out an aura source AND a teammate the aura was keeping
    // alive, with a card that reads the cause on the teammate"*. That board needs
    // no card this suite did not already have — `fix-sniper`'s Spread Shot and a
    // Ludicolo — and the reader is D326's own marks, which is one of the three
    // candidates the declaration itself named.
    //
    // ONE ATTACK, TWO KNOCK OUTS, TWO DIFFERENT CAUSES:
    //   • Ludicolo — 140 printed + 40 its own aura = 180, carrying 150, and Spread
    //     Shot's 30 to the Active finishes it. **By damage from an attack.**
    //   • the benched Basic — 60 printed + 40 aura = 100, carrying 55 + Spread
    //     Shot's 20 to each Benched = 75. ALIVE at 100 and lethal at 60, and the
    //     only thing that takes the 40 away is Ludicolo leaving play. **Knocked
    //     Out by the maximum MOVING**, on a turn whose attack never touched it
    //     lethally — the counters on it were placed before the attack was
    //     declared.
    // A third, barely-damaged body keeps P2's board non-empty so §14.2 is not
    // what is under test.
    let state = board(SEEDS[0], {
      p1Active: "fix-sniper",
      p2Active: LUDICOLO,
      p2Bench: [TEAMMATE, TEAMMATE],
    });
    state = attachFromDeck(state, "p1", "fix-energy", 1); // pays Spread Shot {C}
    state = setDamage(state, "p2", 150);
    state = setBenchDamage(state, "p2", 0, 55);
    expect(activeMaxHp(state, "p2")).toBe(180);
    expect(benchMaxHp(state, "p2", 0)).toBe(100);
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    if (!result.ok) throw new Error(`attack failed: ${result.error.code}`);
    // THE PREMISE, ASSERTED: the cascade really happened, in ONE batch.
    expect(result.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(2);
    // 🛑 AND THE TWO MARKS DISAGREE ON THE CAUSE, WHICH IS THE WHOLE ROW.
    expect(marks(result.state, "p2")).toEqual([
      { name: "Ludicolo", byAttack: true },
      { name: "fix-basic-1", byAttack: false },
    ]);
  });

  it("…and a MID-TURN cascade marks BOTH halves not-by-attack — the case that agrees", () => {
    // The control D328's declaration correctly identified: the Stadium cascade
    // passes no `attackerSeat` on any pass, so a build that handed every pass the
    // attack cause is indistinguishable from the right one HERE. Kept because it
    // is what makes the row above the separating board rather than the only board.
    let state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, TEAMMATE],
      p2Active: TEAMMATE,
    });
    state = setDamage(state, "p1", 160);
    state = setBenchDamage(state, "p1", 0, 70);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(2);
    expect(marks(played.state, "p1")).toEqual([
      { name: "Ludicolo", byAttack: false },
      { name: "fix-basic-1", byAttack: false },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. THE §14 TIE THAT EXISTS ONLY ACROSS PASSES (D329).
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve every KO decision the way `checkup.test.ts` does, so what is asserted
    below is the outcome the RULES reach and not the first park on the way. */
function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count } = next.phase;
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat,
          prizeIndices: Array.from({ length: count }, (_, i) => i),
        }),
      );
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

describe("D329 §11 — the tie guard sees the WHOLE fixed point, not one pass", () => {
  it("🛑 both seats take their last Prize in ONE batch, and the second one is a CASCADE", () => {
    // 🛑 **D328 LEFT THIS AS "A WIDENING WITH A KNOWN EDGE, NOT A CLOSED
    // QUESTION"**: `collectKnockOuts` iterates to a fixed point, but each pass
    // speculated over its OWN refs, so a tie spanning two passes fell through to
    // the stage-by-stage §14 checks. **THOSE CHECKS CANNOT REPORT A TIE.**
    // `resolvePrizesAndResume` evaluates §14 after EACH prize stage, so whichever
    // seat's stage is queued first reaches zero first and wins outright — the
    // sequential resolution is exactly what the speculation exists to pre-empt.
    //
    // ONE Stadium, THREE Knock Outs, TWO passes, and every seat's last Prize:
    //   • P1's Ludicolo — 140 + 40 its own aura − 30 Gravity Mountain = 150,
    //     carrying 150. Pass 0. P2 takes their 2nd-to-last Prize for it.
    //   • P2's 20-HP Stage 2 — clamped to 10 by the same card, carrying 10.
    //     Pass 0, the OTHER board, which is what makes pass 0 speculate at all —
    //     and the speculation sees a ONE-SIDED win (P1 empties their row, P2 does
    //     not) and correctly falls through.
    //   • P1's benched Basic — 60 + 40 aura = 100, carrying 70. Pass 1, because
    //     the only thing that takes the 40 away is the Ludicolo leaving play. Its
    //     Prize is P2's LAST.
    // Both rows empty in the same instant, so §14 says TIE. Resolved stage by
    // stage it is a P1 win, because P1's single Prize is queued second and
    // P2's third stage never runs.
    let state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, TEAMMATE],
      p2Active: TINY_STAGE2,
      p2Bench: [TEAMMATE],
    });
    state = setDamage(state, "p1", 150);
    state = setDamage(state, "p2", 10);
    state = setBenchDamage(state, "p1", 0, 70);
    state = setPrizes(setPrizes(state, "p1", 1), "p2", 2);
    // THE PREMISES, ASSERTED (D324's rule): every one of the three bodies is
    // alive right now, and each dies for its own stated reason.
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(activeMaxHp(state, "p2")).toBe(20);
    expect(benchMaxHp(state, "p1", 0)).toBe(100);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(3);
    const done = settle(played.state);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "tie", reasons: { p1: "prizesTaken", p2: "prizesTaken" } },
    });
  });

  it("…and a batch that empties only ONE row is still a win, on the same board", () => {
    // The control: give P2 one more Prize and the third Knock Out no longer
    // finishes their row, so the cascade is unchanged and only P1 empties. A
    // build that answered "tie" whenever a batch touched both boards is green
    // above and red here.
    let state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, TEAMMATE],
      p2Active: TINY_STAGE2,
      p2Bench: [TEAMMATE],
    });
    state = setDamage(state, "p1", 150);
    state = setDamage(state, "p2", 10);
    state = setBenchDamage(state, "p1", 0, 70);
    state = setPrizes(setPrizes(state, "p1", 1), "p2", 3);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(3);
    const done = settle(played.state);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
  });
});
