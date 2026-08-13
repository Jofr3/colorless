import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { effectiveMaxHp } from "./continuous";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  setPrizes,
} from "./testFixtures";

// D325 — THE §8.1 SELF-SCALING MAX-HP GRANTS, AND THE SEAM CLOSES.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE THREE CHECKS THE RESUME POINT ORDERED, IN ITS ORDER, WITH WHAT EACH
// RETURNED. All three changed the answer, which is now SIX sessions running.
// ─────────────────────────────────────────────────────────────────────────────
//
// (a) `git grep` ON ALL SIX IDS — D321's rule, and the direction D323 found it
//     also works in. **SIX hits and NOT ONE IS A KEY.** Four are D324's own
//     enumeration COMMENT in `hpAura.test.ts`; one is a COMMENT in
//     `assassinsReturn.test.ts`; and the sixth is an `it(...)` TITLE in
//     `energyClause.test.ts` that REFUSES this very Okidogi sentence as an attack
//     clause — a hit that reads, at a glance, exactly like coverage.
//     🛑 **BRAMBLEGHAST `sv05-021` WAS LISTED AS BUILT BY D323's RESUME POINT**
//     (*"Prize-COUNT reads … built at D208"*) **AND HAD NEVER BEEN BUILT.** That
//     is the THIRD consecutive handoff carrying a phantom-built row — D323's
//     Togekiss (two hits, both comments), D324's Ludicolo (six hits, no key), and
//     now this one. **THE COUNT IS NOT THE TEST; THE HITS ARE.**
//
// (b) THE CENSUS **AND ITS CLOSURE QUERY**, re-run at HEAD rather than copied
//     from D324's published enumeration — which is exactly the artefact D310/
//     D316/D320 say goes stale silently. Remote D1 `luminous`
//     (735f0fb5-cdc3-494d-8b97-74a8ade0124a, 3,786 rows, 2,021 `legal_standard`),
//     2026-08-11:
//
//       instr(abilities_json,'HP') > 0  → **24 legal**
//       instr(effect,'HP')         > 0  → **21 legal**
//       instr(attacks_json,'HP')   > 0  → **5 legal**
//
//     re-deriving D324 exactly. Both the 24 and the 21 were pulled WHOLE and read
//     row by row, and both matched D324's classification with no residue.
//
//     ⚠️ **AND THE INSTRUCTION WAS TO ASSUME MY OWN QUERY WAS BLIND TO SOMETHING
//     AND GO LOOKING**, because D324's `'get +'` could not see `gets +`. The
//     probe for this slice's blindness is the one width the bare HP noun does not
//     cover: a SCALING sentence that never says "HP". `instr(abilities_json,
//     'for each') > 0` is **17 legal**, and the 17 MINUS the 24 is **14 legal
//     rows** — every one of them a cost reduction or a damage-counter placement
//     (Bloodmoon Ursaluna ex ×6, Crabominable ×3, Veluza, Incineroar ex ×2,
//     Orthworm ex ×2), and not one a max-HP grant. `maximum HP` and `more HP`
//     return **0 in all three columns**, so the pool has exactly one noun for
//     this and the bare-noun query is the closure after all.
//
//     **THE DIFFERENCE SET AFTER THIS SLICE IS EMPTY.** §8.1 max HP now stands at
//     **12 legal printings on 5 sentences** — D324's six FLAT ones (Lively
//     Stadium, Gravity Mountain ×2, Hero's Cape, Cynthia's Power Weight, Vibrant
//     Dance) and this slice's six SCALING ones — and every other HP row in all
//     three columns is a KO refusal (Resolute Heart / Sturdy / Survival Brace), a
//     THRESHOLD (`N HP or less`), a printed Fossil body, Tyme's guess, or an
//     `attacks_json` *"until its remaining HP is N"* damage op. **`BUILT.attack`
//     cannot move on this seam at any width** — D306's rule, holding for a sixth
//     slice.
//
// (c) **`effectiveMaxHp` AND `passivesOf` READ BEFORE BELIEVING A FIELD WAS NEW**,
//     and for the fifth consecutive slice it paid — this time by HALVING the row.
//     🛑 **OKIDOGI'S DAMAGE CLAUSE NEEDED ZERO NEW CODE.** *"…and the attacks it
//     uses do 100 more damage to your opponent's Active Pokémon (before applying
//     Weakness and Resistance)"* is `damageBonusBeforeWRIf` — Defiance Band's
//     field, verbatim, parenthetical included — under
//     `BoardCondition.yourActiveHasEnergyAttached`, which effects.ts has carried
//     since D118 and which `energyClause.test.ts` already asserts this card's
//     exact sentence against. The resume point said to grep both before pricing
//     the clause as new; both existed; §2 below is the whole of what it cost.
//
//     And `passivesOf` was the right home for all three rows for a reason that is
//     a fact about the fold rather than a preference: `sources[0]` is the holder's
//     OWN printed passive and is the ONE element that takes the §9 `disabled`
//     drop. All three sentences here are ABILITIES, so an Ability-lock switching
//     them off is free — where D324's Tools and Stadiums correctly survive one.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 WHAT READING THE SEAM SAID ABOUT THE D205 INVARIANT — BEFORE A LINE WAS
//    WRITTEN, WHICH IS THE ORDER THE RESUME POINT DEMANDED.
// ─────────────────────────────────────────────────────────────────────────────
//
// `effectiveMaxHp` carries a `Math.max(MIN_EFFECTIVE_MAX_HP, …)` floor whose
// justification is a branch D205 DELETED in another file: `koSurvivalClamp` has
// no `dealt <= 0` guard because the sum was never non-positive. D324 made that
// explicit when Gravity Mountain became the engine's first subtrahend.
//
// **THIS SLICE CANNOT WEAKEN IT, AND THE REASON IS ARITHMETIC RATHER THAN
// VIGILANCE**: every new term is an ADDEND and every count is zero-able. Okidogi
// adds +100 or +0; Conkeldurr adds 40 × a `.filter().length`; Brambleghast adds
// 50 × `takenPrizes`, which is `PRIZE_COUNT − prizes.length` and therefore in
// [0, 6]. No board makes any of them negative, so Gravity Mountain is still the
// only subtrahend. §7 drives the floor's neighbourhood anyway.
//
// 🛑 **BUT THE INVARIANT THAT DOES MOVE IS A DIFFERENT ONE, AND IT IS NEW.**
// Until now every max-HP term ended only when a CARD MOVED: Bravery Charm's +50
// dies on evolution, Cynthia's Power Weight's +70 dies when the top card stops
// matching, Vibrant Dance's +40 dies when the Ludicolo leaves. **These are the
// first grants that shrink with nothing in the holder's stack moving at all** —
// the last {D} is discarded and 100 max HP goes with it — which is §8.1's mid-turn
// KO window reached by a path `resolveMidTurnKnockOuts`' THREE call sites (turn.ts)
// may not cover. §6 drives the SHRINK and asserts what `effectiveMaxHp` reports;
// it deliberately does NOT assert a Knock Out, because whether a sweep runs on
// that path is the open seam D324 recorded for Gravity Mountain on the play and
// this slice does not close it. **RECORDED, NOT CLAIMED.**
//
// 🆕 🛑 **D328 CLOSED IT, AND THE ANSWER WAS THAT THE SWEEP DID NOT RUN.** The
// refusal above was right to refuse and right about where to look: `retreat`
// (turn.ts) pays its cost by discarding Energy from the very body these grants are
// measured on and then returned `ok` with no sweep, so a Conkeldurr at 200 damage
// under a 260 maximum walked to the Bench at 200 under 140 and stood there until
// the Checkup — healable, evolvable, gustable out of a Knock Out §8.1 had already
// decided. Every OTHER discard-from-play route is an interpreter op and already
// folds through `settleProgram`'s sweep; the retreat was the one that did not.
// §6's last two rows drive it THROUGH THE ACTION, with the non-lethal retreat
// beside it as the control. The surgical row above is kept as what it always was.
//
// `opponentPrizesTaken` is the control that makes the shape visible: it is
// MONOTONE (no rule puts a Prize back), so Brambleghast is the one writer of this
// field that can never Knock Out the body it is written on.

/** Okidogi — "Adrena-Power". THREE legal printings sharing one program object.
    `sv06-111` is the one driven; the other two are asserted identical in §1. */
const OKIDOGI = "sv06-111";
const OKIDOGI_R1 = "sv06.5-074";
const OKIDOGI_R2 = "sv08.5-057";
/** Conkeldurr — "Craftsmanship". TWO legal printings, one program object. */
const CONKELDURR = "sv10.5b-049";
const CONKELDURR_R = "sv10.5b-127";
/** Brambleghast — "Resilient Soul". ONE legal printing, and the row this page
    called BUILT for three handoffs. */
const BRAMBLE = "sv05-021";
/** 🆕 D329 — Magcargo `sv05-029` "Lava Zone", the OTHER thing a retreat sets
    off, and the reason turn.ts's sweep sits BEHIND `runActiveBenchedTriggers`
    rather than in front of it. Transcribed off the remote D1 row (2026-08-13):
    120 HP, Stage 1 from Slugma, {R}, retreat 4, "Heat Blast" {R}{C}{C} 100. */
const MAGCARGO = "sv05-029";

/** A plain 60-HP Basic with no Ability — the "nothing leaked" control on every
    board here, and the body `board()` defaults every unnamed spot to. */
const PLAIN = "fix-basic-1";
const DARK = "fix-dark-energy";
const DARK_ALT = "fix-dark-energy-alt";
const FIGHT = "fix-fighting-energy";
const FIGHT_ALT = "fix-fighting-energy-alt";
/** The WRONG type on each axis — a Conkeldurr that counted every attached card
    rather than its {F}, or an Okidogi gated on "any Energy", passes every board
    in this file without these. */
const WATER = "fix-water-energy";

/** ⚠️ **THE SIX REAL IDS ARE DECLARED HERE AND NOT IN `FIXTURE_POOL`, AND WHAT
    DIVERGES FROM THE PRINT IS STATED RATHER THAN SILENT** (D321's rule, D324's
    practice). `FIXTURE_POOL` was swept FIRST as a separate population (D250's
    rule) and holds **none** of the three Ability names, **none** of the six ids
    and **none** of the three printed sentences.

    All six live in sets `catalogManifest.ts` does not cover (sv05, sv06, sv08.5,
    sv10.5b), so `catalogManifest.test.ts` cannot diff them and a quiet divergence
    would have nothing behind it. Each body is therefore the print WHOLE,
    transcribed off the remote D1 row with that row's own `length()`s checked:

      • **Okidogi** `sv06-111` — 130 HP, Basic, {F}, retreat 2, "Good Punch"
        {F}{F} 70. `abilities_json` 235 / `attacks_json` 66 / `effect` empty.
      • **Conkeldurr** `sv10.5b-049` — 140 HP, Stage 2 from Gurdurr, {F}, retreat
        3, "Swing Around" {F}{C}{C}{C} "100+". `abilities_json` 115 /
        `attacks_json` 170 / `effect` empty.
      • **Brambleghast** `sv05-021` — 100 HP, Stage 1 from Bramblin, {G}, retreat
        3, "Powerful Needles" {G}{C}{C} "80×". `abilities_json` 125 /
        `attacks_json` 193 / `effect` empty.

    ⚠️ **OKIDOGI IS A {F} POKÉMON WHOSE ABILITY GATES ON {D}, AND THAT IS THE
    PRINT.** It is not a transcription slip and it is load-bearing here: a build
    that gated on the HOLDER's printed type instead of on its ATTACHED Energy
    would be green on a card whose two types agreed, and this one's do not.

    ⚠️ **AND ALL THREE REPRINTS CARRY THE SAME ABILITY TEXT**, so §1's
    object-identity assertions are about the REGISTRY sharing one program and not
    about two rows that happen to agree. */
const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    [OKIDOGI, OKIDOGI_R1, OKIDOGI_R2].map((id) => [
      id,
      battler(id, {
        name: "Okidogi",
        hp: 130,
        retreat: 2,
        types: ["Fighting"],
        stage: "Basic",
        attacks: [{ cost: ["Fighting", "Fighting"], name: "Good Punch", damage: 70 }],
        abilities: [
          {
            type: "Ability",
            name: "Adrena-Power",
            effect:
              "If this Pokémon has any {D} Energy attached, it gets +100 HP, and the attacks it uses do 100 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
          },
        ],
      }),
    ]),
  ),
  ...Object.fromEntries(
    [CONKELDURR, CONKELDURR_R].map((id) => [
      id,
      battler(id, {
        name: "Conkeldurr",
        hp: 140,
        retreat: 3,
        types: ["Fighting"],
        stage: "Stage2",
        evolveFrom: "Gurdurr",
        attacks: [
          {
            cost: ["Fighting", "Colorless", "Colorless", "Colorless"],
            name: "Swing Around",
            damage: "100+",
            effect: "Flip 2 coins. This attack does 50 more damage for each heads.",
          },
        ],
        abilities: [
          {
            type: "Ability",
            name: "Craftsmanship",
            effect: "This Pokémon gets +40 HP for each {F} Energy attached to it.",
          },
        ],
      }),
    ]),
  ),
  [BRAMBLE]: battler(BRAMBLE, {
    name: "Brambleghast",
    hp: 100,
    retreat: 3,
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "Bramblin",
    attacks: [
      {
        cost: ["Grass", "Colorless", "Colorless"],
        name: "Powerful Needles",
        damage: "80×",
        effect:
          "Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads.",
      },
    ],
    abilities: [
      {
        type: "Ability",
        name: "Resilient Soul",
        effect: "This Pokémon gets +50 HP for each Prize card your opponent has taken.",
      },
    ],
  }),
  [MAGCARGO]: battler(MAGCARGO, {
    name: "Magcargo",
    hp: 120,
    retreat: 4,
    types: ["Fire"],
    stage: "Stage1",
    evolveFrom: "Slugma",
    attacks: [{ cost: ["Fire", "Colorless", "Colorless"], name: "Heat Blast", damage: 100 }],
    abilities: [
      {
        type: "Ability",
        name: "Lava Zone",
        effect:
          "Whenever your opponent's Active Pokémon moves to the Bench during their turn, their new Active Pokémon is now Burned.",
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const SCALE_DECK = deckOf({
  [OKIDOGI]: 4,
  [OKIDOGI_R1]: 2,
  [OKIDOGI_R2]: 2,
  [CONKELDURR]: 4,
  [CONKELDURR_R]: 2,
  [BRAMBLE]: 4,
  [MAGCARGO]: 4,
  [DARK]: 6,
  [DARK_ALT]: 4,
  [FIGHT]: 6,
  [FIGHT_ALT]: 4,
  [WATER]: 4,
  [PLAIN]: 8,
  "fix-energy": 6,
});

/** THREE SEEDS (D270's rule). Nothing on this seam flips a coin — every sentence
    is flat arithmetic over a counted board — so three is the family default,
    matching D324's neighbouring file rather than D323's five. */
const SEEDS = [8201, 8207, 8219] as const;

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
  const created = createGame({ seed, decks: { p1: SCALE_DECK, p2: SCALE_DECK }, cardPool: POOL });
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

/** P1 is the seat under test on every board here. The walk to turn 3 leaves P1
    to act, which is what lets §3 attach an Energy through the REAL action rather
    than only through surgery. */
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
  state = clearBench(setActiveFromDeck(state, "p1", opts.p1Active ?? PLAIN), "p1");
  for (const id of opts.p1Bench ?? [PLAIN]) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", opts.p2Active ?? PLAIN), "p2");
  for (const id of opts.p2Bench ?? [PLAIN]) state = benchFromDeck(state, "p2", id);
  for (let i = 0; i < 12; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    if (state.phase.seat === "p1" && state.turn >= 3) break;
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return state;
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

/** Detach `count` Energy cards from `seat`'s Active to the discard — the SHRINK
    §6 needs, and the one move no test helper already offered. Kept legal-shaped
    (every uid lands in exactly one zone), which is what lets `effectiveMaxHp`
    re-derive off it rather than off a hand-built body. */
function discardEnergyFromActive(state: GameState, seat: Seat, count: number): GameState {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`${seat} has no Active`);
  const dropped = side.active.energy.slice(0, count);
  if (dropped.length < count) throw new Error(`${seat}'s Active has ${dropped.length} Energy`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: { ...side.active, energy: side.active.energy.slice(count) },
        discard: [...side.discard, ...dropped],
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE THREE REGISTRY ROWS — and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §1 — the three registry rows", () => {
  it("Adrena-Power authors TWO clauses on ONE condition, and the damage half is an OLD field", () => {
    expect(programFor(OKIDOGI)?.passive).toEqual({
      hpBonus: { amount: 100, requiresEnergyType: "Darkness" },
      damageBonusBeforeWRIf: {
        amount: 100,
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Darkness" },
      },
    });
    // 🛑 THE HALF THAT COST NOTHING. `damageBonusBeforeWRIf` is Defiance Band's
    // field and `yourActiveHasEnergyAttached` is D118's condition — this row
    // AUTHORS them, it does not introduce them. Pricing the clause as new would
    // have doubled the slice.
    expect(programFor(OKIDOGI)?.passive?.damageBonusBeforeWRIf?.cond).toEqual({
      kind: "yourActiveHasEnergyAttached",
      energy: "Darkness",
    });
    // NOT a `basicHpBonus`, even though Okidogi IS a Basic: the sentence prints no
    // stage word, so a build that reused Bravery Charm's field would be green on
    // this card forever and wrong on the first Stage 1 printing of the idiom.
    expect(programFor(OKIDOGI)?.passive?.basicHpBonus).toBeUndefined();
    // NOT a `hpBonusPer`: "any" is a gate, not a multiplier. §4 drives it.
    expect(programFor(OKIDOGI)?.passive?.hpBonusPer).toBeUndefined();
    // NOT a `seatHpBonus`: "it gets" is the holder, not the side.
    expect(programFor(OKIDOGI)?.passive?.seatHpBonus).toBeUndefined();
  });

  it("Craftsmanship and Resilient Soul are ONE field over TWO scales", () => {
    expect(programFor(CONKELDURR)?.passive).toEqual({
      hpBonusPer: { amount: 40, scale: { kind: "attachedEnergy", energyType: "Fighting" } },
    });
    expect(programFor(BRAMBLE)?.passive).toEqual({
      hpBonusPer: { amount: 50, scale: { kind: "opponentPrizesTaken" } },
    });
    // 🛑 THE ROW THIS PAGE CALLED BUILT FOR THREE HANDOFFS. D323's resume point
    // listed Brambleghast among "Prize-COUNT reads … built at D208"; the grep at
    // D325's HEAD returned ONE hit and it was D324's enumeration COMMENT. This
    // assertion is the one that could not have been written before today.
    expect(programFor(BRAMBLE)?.passive?.hpBonusPer?.amount).toBe(50);
    // The type is ON the scale and is not inferred from the holder: Conkeldurr is
    // a {F} Pokémon counting {F} Energy, which is precisely the coincidence that
    // would hide a build reading `top.types`. Okidogi is the control — a {F}
    // Pokémon gating on {D} — and §4 drives it.
    expect(programFor(CONKELDURR)?.passive?.hpBonusPer?.scale).toEqual({
      kind: "attachedEnergy",
      energyType: "Fighting",
    });
    // NEITHER is a flat `hpBonus`, and neither carries a `requiresEnergyType`:
    // "for each" and "any" are different multipliers on the same board fact.
    expect(programFor(CONKELDURR)?.passive?.hpBonus).toBeUndefined();
    expect(programFor(BRAMBLE)?.passive?.hpBonus).toBeUndefined();
  });

  it("all six printings resolve, and the reprints SHARE one program object", () => {
    // Object identity, not deep equality: a reprint that had been re-authored
    // rather than aliased would pass `toEqual` and drift on the next edit.
    expect(programFor(OKIDOGI_R1)).toBe(programFor(OKIDOGI));
    expect(programFor(OKIDOGI_R2)).toBe(programFor(OKIDOGI));
    expect(programFor(CONKELDURR_R)).toBe(programFor(CONKELDURR));
    // Six printings, three objects — the two counts this slice moves, and they
    // are keyed on different things (printings vs sentences).
    const printings = [OKIDOGI, OKIDOGI_R1, OKIDOGI_R2, CONKELDURR, CONKELDURR_R, BRAMBLE];
    expect(printings.every((id) => programFor(id)?.passive !== undefined)).toBe(true);
    expect(new Set(printings.map((id) => programFor(id))).size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. OKIDOGI'S GATE — "ANY", not a count, and not the holder's printed type.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §2 — Adrena-Power's +100 is GATED, not scaled", () => {
  it.each(SEEDS)("no {D} attached is +0, one {D} is the whole +100 (seed %i)", (seed) => {
    let state = board(seed, { p1Active: OKIDOGI });
    // The printed body, with nothing attached.
    expect(activeMaxHp(state, "p1")).toBe(130);
    // A {F} Energy on a {F} Pokémon changes NOTHING — the gate reads the ATTACHED
    // type and not the holder's. This is the assertion Okidogi's own type
    // mismatch exists to make.
    state = attachFromDeck(state, "p1", FIGHT, 2);
    expect(activeMaxHp(state, "p1")).toBe(130);
    state = attachFromDeck(state, "p1", WATER, 1);
    expect(activeMaxHp(state, "p1")).toBe(130);
    // One {D} and the whole grant lands.
    state = attachFromDeck(state, "p1", DARK, 1);
    expect(activeMaxHp(state, "p1")).toBe(230);
  });

  it.each(SEEDS)("FOUR {D} pay exactly the same +100 as one (seed %i)", (seed) => {
    // 🛑 THE ASSERTION THAT SEPARATES THIS FIELD FROM THE ONE BELOW IT. The
    // printed word is "any". A build that reached for `countAttachedEnergy` —
    // which sits four lines from `hasAttachedEnergy` in continuous.ts and is what
    // Conkeldurr uses — would read 130 + 400 here and be green on every
    // single-Energy board in this file.
    let state = board(seed, { p1Active: OKIDOGI });
    state = attachFromDeck(state, "p1", DARK, 2);
    state = attachFromDeck(state, "p1", DARK_ALT, 2);
    expect(state.players.p1.active?.energy.length).toBe(4);
    expect(activeMaxHp(state, "p1")).toBe(230);
  });

  it.each(SEEDS)("the gate is per BODY — a benched Okidogi is on its own (seed %i)", (seed) => {
    let state = board(seed, { p1Active: OKIDOGI, p1Bench: [OKIDOGI_R1, PLAIN] });
    state = attachFromDeck(state, "p1", DARK, 1);
    expect(activeMaxHp(state, "p1")).toBe(230);
    // The reprint on the bench shares the PROGRAM and not the board fact.
    expect(benchMaxHp(state, "p1", 0)).toBe(130);
    // And nothing leaked onto the plain teammate — `hpBonus` is folded out of the
    // body's OWN sources, so an aura-shaped bug would show here first.
    expect(benchMaxHp(state, "p1", 1)).toBe(60);
    state = attachBenchFromDeck(state, "p1", 0, DARK_ALT, 1);
    expect(benchMaxHp(state, "p1", 0)).toBe(230);
    expect(benchMaxHp(state, "p1", 1)).toBe(60);
  });

  it.each(SEEDS)("the REAL attachEnergy action turns the grant on (seed %i)", (seed) => {
    // ⚠️ REACHING IS NOT ENOUGH (D318), AND A READ SITE FED ONLY BY SURGERY CAN BE
    // GREEN AND DEAD (D310/D314/D318). Every other board here attaches through
    // `attachFromDeck`; this one goes through the rules' own §6 path, so what is
    // asserted is that the zone the ATTACH ACTION fills is the zone
    // `hasAttachedEnergy` reads.
    let state = board(seed, { p1Active: OKIDOGI });
    expect(activeMaxHp(state, "p1")).toBe(130);
    state = handFromDeck(state, "p1", DARK, 1);
    state = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: handUid(state, "p1", DARK),
        target: { spot: "active" },
      }),
    );
    expect(activeMaxHp(state, "p1")).toBe(230);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CONKELDURR'S MULTIPLIER — "for each", and it counts by PROVISION.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §3 — Craftsmanship pays PER {F}", () => {
  it.each(SEEDS)("0/1/2/3 attached {F} give +0/+40/+80/+120 (seed %i)", (seed) => {
    let state = board(seed, { p1Active: CONKELDURR });
    expect(activeMaxHp(state, "p1")).toBe(140);
    state = attachFromDeck(state, "p1", FIGHT, 1);
    expect(activeMaxHp(state, "p1")).toBe(180);
    state = attachFromDeck(state, "p1", FIGHT, 1);
    expect(activeMaxHp(state, "p1")).toBe(220);
    state = attachFromDeck(state, "p1", FIGHT_ALT, 1);
    expect(activeMaxHp(state, "p1")).toBe(260);
  });

  it.each(SEEDS)("the WRONG type counts for nothing (seed %i)", (seed) => {
    // The control Okidogi cannot provide: a build that dropped `energyType` and
    // counted `pokemon.energy.length` would read 140 + 160 here.
    let state = board(seed, { p1Active: CONKELDURR });
    state = attachFromDeck(state, "p1", WATER, 2);
    state = attachFromDeck(state, "p1", DARK, 2);
    expect(state.players.p1.active?.energy.length).toBe(4);
    expect(activeMaxHp(state, "p1")).toBe(140);
    // And a single right one is still paid, on the same crowded body.
    state = attachFromDeck(state, "p1", FIGHT, 1);
    expect(activeMaxHp(state, "p1")).toBe(180);
  });

  it.each(SEEDS)("a plain Colorless-provider is NOT an {F} (seed %i)", (seed) => {
    // `countAttachedEnergy` counts by PROVISION (§6.3), so the discrimination
    // this makes is the same one `hasAttachedEnergy` makes and not a second
    // reading of the printed noun.
    let state = board(seed, { p1Active: CONKELDURR });
    state = attachFromDeck(state, "p1", "fix-energy", 3);
    expect(activeMaxHp(state, "p1")).toBe(140);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE TWO MULTIPLIERS AGAINST EACH OTHER — "any" vs "for each" on one board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §4 — 'any' and 'for each' on the same board", () => {
  it.each(SEEDS)("four Energy: Okidogi +100, Conkeldurr +160 (seed %i)", (seed) => {
    // 🛑 ONE BOARD, TWO PRINTED MULTIPLIERS, AND THE ONLY DIFFERENCE IS THE
    // SENTENCE. Each is the other's control: a build that shared one field would
    // have to give both the same answer, and no board makes 230 equal 300.
    let state = board(seed, { p1Active: OKIDOGI, p1Bench: [CONKELDURR] });
    state = attachFromDeck(state, "p1", DARK, 2);
    state = attachFromDeck(state, "p1", DARK_ALT, 2);
    state = attachBenchFromDeck(state, "p1", 0, FIGHT, 2);
    state = attachBenchFromDeck(state, "p1", 0, FIGHT_ALT, 2);
    expect(activeMaxHp(state, "p1")).toBe(230);
    expect(benchMaxHp(state, "p1", 0)).toBe(300);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. BRAMBLEGHAST'S PRIZE SCALE — TAKEN, not remaining, and it reads the OTHER
//    side's pile.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §5 — Resilient Soul counts the OPPONENT's TAKEN Prizes", () => {
  it.each(SEEDS)("+0 at six remaining, +100 at four, +250 at one (seed %i)", (seed) => {
    let state = board(seed, { p1Active: BRAMBLE });
    // 🛑 TAKEN, NOT REMAINING, AND THE NUMBERS ARE CHOSEN SO THE TWO CANNOT
    // AGREE. A build reading `prizes.length` directly would report 100 + 300 on
    // the untouched board below and 100 + 200 on the next line — every value here
    // is the inverse of the one the bug produces.
    expect(state.players.p2.prizes.length).toBe(6);
    expect(activeMaxHp(state, "p1")).toBe(100);
    state = setPrizes(state, "p2", 4);
    expect(activeMaxHp(state, "p1")).toBe(200);
    state = setPrizes(state, "p2", 1);
    expect(activeMaxHp(state, "p1")).toBe(350);
  });

  it.each(SEEDS)("it is the HOLDER's opponent, not a fixed seat (seed %i)", (seed) => {
    // The same printed sentence on both sides, resolved through `seatOfPokemon`.
    // A build that read `state.players.p2` (or the active seat) would give the two
    // Brambleghast the SAME answer; these two differ by 150.
    let state = board(seed, { p1Active: BRAMBLE, p2Active: BRAMBLE });
    state = setPrizes(state, "p1", 5);
    state = setPrizes(state, "p2", 2);
    // P1's Brambleghast reads P2's pile: 6 − 2 = 4 taken ⇒ +200.
    expect(activeMaxHp(state, "p1")).toBe(300);
    // P2's reads P1's: 6 − 5 = 1 taken ⇒ +50.
    expect(activeMaxHp(state, "p2")).toBe(150);
  });

  it.each(SEEDS)("a benched Brambleghast is paid the same (seed %i)", (seed) => {
    // `seatOfPokemon` is `isOnBench`'s scan with the answer KEPT, so a body in
    // either spot must resolve. A bench-blind seat lookup would return 0 here.
    let state = board(seed, { p1Active: PLAIN, p1Bench: [BRAMBLE, PLAIN] });
    state = setPrizes(state, "p2", 3);
    expect(benchMaxHp(state, "p1", 0)).toBe(250);
    expect(benchMaxHp(state, "p1", 1)).toBe(60);
    expect(activeMaxHp(state, "p1")).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE SHRINK — the first max-HP terms that fall with NO card in the holder's
//    stack moving, and the MONOTONE control beside them.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §6 — these grants can SHRINK, and one of them cannot", () => {
  it.each(SEEDS)("Okidogi's +100 is all-or-nothing on the LAST {D} (seed %i)", (seed) => {
    let state = board(seed, { p1Active: OKIDOGI });
    state = attachFromDeck(state, "p1", DARK, 2);
    expect(activeMaxHp(state, "p1")).toBe(230);
    // One of two {D} leaves: still "any", so still the whole +100.
    state = discardEnergyFromActive(state, "p1", 1);
    expect(activeMaxHp(state, "p1")).toBe(230);
    // The last one leaves and 100 max HP goes with it, with the same card on top
    // of the same stack — the shape no §8.1 term had before this slice.
    state = discardEnergyFromActive(state, "p1", 1);
    expect(activeMaxHp(state, "p1")).toBe(130);
  });

  it.each(SEEDS)("Conkeldurr falls FORTY AT A TIME (seed %i)", (seed) => {
    let state = board(seed, { p1Active: CONKELDURR });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    expect(activeMaxHp(state, "p1")).toBe(260);
    state = discardEnergyFromActive(state, "p1", 1);
    expect(activeMaxHp(state, "p1")).toBe(220);
    state = discardEnergyFromActive(state, "p1", 2);
    expect(activeMaxHp(state, "p1")).toBe(140);
  });

  it.each(SEEDS)("the shrink can put damage AT OR ABOVE max HP (seed %i)", (seed) => {
    // ⚠️ **THIS ROW IS TEST SURGERY AND STAYS THAT WAY** — what it asserts is what
    // `effectiveMaxHp` REPORTS, on a state built by hand. The row below is the
    // same shrink reached by a REAL action, which is what D325 could not claim.
    let state = board(seed, { p1Active: CONKELDURR });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 200);
    // 200 damage against 260 max HP — alive, and comfortably so.
    expect(activeMaxHp(state, "p1")).toBe(260);
    expect(state.players.p1.active?.damage).toBe(200);
    state = discardEnergyFromActive(state, "p1", 2);
    // Same body, same card, same damage — and now the damage is at or above the
    // maximum it is measured against.
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(state.players.p1.active?.damage).toBe(200);
  });

  it.each(SEEDS)("🛑 a RETREAT pays the cost and Knocks the retreater Out (seed %i)", (seed) => {
    // 🛑 **D325 RECORDED THIS AS AN OPEN SEAM AND IT WAS A REAL GAP.** That slice
    // wrote *"whether a sweep runs on that path is the open seam D324 recorded for
    // Gravity Mountain on the play, and this slice does not close it"* — correctly
    // refusing to assert an unverified premise. The premise was FALSE:
    // `resolveMidTurnKnockOuts` had three call sites and `retreat` was none of
    // them, so the body walked to the Bench lethally damaged and stayed there
    // until the Checkup — able to be healed, evolved or gusted back out of a Knock
    // Out §8.1 had already decided.
    //
    // ⚠️ **AND IT IS DRIVEN BY THE ACTION, NOT BY SURGERY.** Conkeldurr's printed
    // retreat cost is 3, its three attached {F} are worth +120, and paying them is
    // the whole of what makes 200 damage lethal: 260 → 140, with nothing in the
    // stack moving and no attack anywhere near the board.
    let state = board(seed, { p1Active: CONKELDURR, p1Bench: [PLAIN] });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 200);
    expect(activeMaxHp(state, "p1")).toBe(260);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const result = applyAction(state, {
      type: "retreat",
      seat: "p1",
      promoteBenchIndex: 0,
      discardEnergy: active.energy.slice(0, 3),
    });
    if (!result.ok) throw new Error(`retreat failed: ${result.error.code}`);
    expect(result.events.some((e) => e.type === "RETREATED")).toBe(true);
    expect(result.events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p1")).toBe(true);
    // The opponent takes the prize; the actor keeps their turn once the KO's
    // decisions settle (`resumeTurn`, the mid-turn sweep's tail).
    expect(result.state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2" });
  });

  it.each(SEEDS)("…and a retreat that stays under the maximum sweeps nothing (seed %i)", (seed) => {
    // The control on the same card and the same action: 100 damage against the
    // post-payment maximum of 140 is a body that survives, so the retreat lands in
    // `turn:action` with the retreater standing on the Bench. Without this row a
    // build that Knocked Out every retreater would be green above.
    let state = board(seed, { p1Active: CONKELDURR, p1Bench: [PLAIN] });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 100);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const result = applyAction(state, {
      type: "retreat",
      seat: "p1",
      promoteBenchIndex: 0,
      discardEnergy: active.energy.slice(0, 3),
    });
    if (!result.ok) throw new Error(`retreat failed: ${result.error.code}`);
    expect(result.events.some((e) => e.type === "KNOCKED_OUT")).toBe(false);
    expect(result.state.phase.kind).toBe("turn:action");
    expect(benchMaxHp(result.state, "p1", result.state.players.p1.bench.length - 1)).toBe(140);
  });

  it.each(SEEDS)("Brambleghast's scale is MONOTONE and cannot do that (seed %i)", (seed) => {
    // The control that makes the shape above visible rather than incidental:
    // `takenPrizes` is PRIZE_COUNT − prizes.length and no rule puts a Prize back,
    // so this grant only ever grows. It is the one writer of `hpBonusPer` that
    // can never Knock Out the body it is written on.
    let state = board(seed, { p1Active: BRAMBLE });
    let previous = activeMaxHp(state, "p1") ?? 0;
    for (const remaining of [5, 4, 3, 2, 1, 0]) {
      state = setPrizes(state, "p2", remaining);
      const now = activeMaxHp(state, "p1") ?? 0;
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
    // Six taken is the ceiling the rules allow: 100 + 6 × 50.
    expect(previous).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE SUM, THE FLOOR AND THE DATA GAP — what this slice does NOT move.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §7 — the invariants this slice was warned about", () => {
  it.each(SEEDS)("every new term is an ADDEND — the sum never falls below the print (seed %i)", (
    seed,
  ) => {
    // 🛑 D205's INVARIANT, ASSERTED RATHER THAN ASSUMED. `koSurvivalClamp` has no
    // `dealt <= 0` guard because this sum is never non-positive; D324 made that a
    // `Math.max` when Gravity Mountain became the first subtrahend. These three
    // rows cannot weaken it because none of them can be negative — and the
    // strongest form of that is to sweep every board this file can build.
    for (const id of [OKIDOGI, CONKELDURR, BRAMBLE]) {
      const printed = POOL[id]?.hp ?? 0;
      let state = board(seed, { p1Active: id });
      expect(activeMaxHp(state, "p1")).toBe(printed);
      state = attachFromDeck(state, "p1", WATER, 2);
      expect(activeMaxHp(state, "p1") ?? 0).toBeGreaterThanOrEqual(printed);
      state = attachFromDeck(state, "p1", DARK, 1);
      state = attachFromDeck(state, "p1", FIGHT, 1);
      expect(activeMaxHp(state, "p1") ?? 0).toBeGreaterThanOrEqual(printed);
      state = setPrizes(state, "p2", 0);
      expect(activeMaxHp(state, "p1") ?? 0).toBeGreaterThanOrEqual(printed);
    }
  });

  it.each(SEEDS)("an EMPTY count adds exactly zero, never a floor (seed %i)", (seed) => {
    // The `amount × 0` case, stated separately from "no field at all": a build
    // that treated a zero count as "no grant" and one that treated it as
    // `amount` are both wrong, and only the first is green above.
    const state = board(seed, { p1Active: CONKELDURR, p1Bench: [BRAMBLE] });
    expect(activeMaxHp(state, "p1")).toBe(140);
    expect(benchMaxHp(state, "p1", 0)).toBe(100);
  });

  it.each(SEEDS)("a data-gap HP stays null under every scale (seed %i)", (seed) => {
    // `effectiveMaxHp` has TWO early returns (D324's gap: a function with two
    // early returns needs two drivers) and this slice runs INSIDE the second's
    // shadow — `passivesOf` is called only after `hp === null` has been refused.
    // A grant that resurrected an unknown HP into a number would be a KO check
    // against a body nothing can read.
    let state = board(seed, { p1Active: OKIDOGI });
    state = attachFromDeck(state, "p1", DARK, 1);
    // THE PREMISE, ASSERTED (D324's rule): the grant really is live on this board,
    // so the `null` below is the data gap refusing it and not a broken fixture.
    expect(activeMaxHp(state, "p1")).toBe(230);
    const gapPool: Record<string, Card> = {
      ...POOL,
      [OKIDOGI]: battler(OKIDOGI, { ...POOL[OKIDOGI], hp: null } as Partial<Card>),
    };
    const gapped: GameState = { ...state, cardPool: gapPool };
    expect(activeMaxHp(gapped, "p1")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. THE RETREAT'S *OTHER* CONSEQUENCE, AND THE ORDER IT IS OWED (D329).
// ─────────────────────────────────────────────────────────────────────────────

describe("D329 §8 — the retreat sweep runs BEHIND the Active→Bench trigger", () => {
  // 🛑 **D328 DECLARED THIS ORDERING UNTESTABLE AND WAS WRONG ABOUT THE CARD.**
  // Its corpus row `D328-retreat-sweep-runs-before-the-trigger` was recorded
  // `unreachable-population` with the reason *"separating them needs a board where
  // `onActiveMovedToBench` counters ALONE are lethal — Magcargo `sv05-029` `Lava
  // Zone` on the opponent's side, against a retreater already within its counters
  // of dying"*, and turn.ts said the same thing at the call
  // (*"`runActiveBenchedTriggers` above lands its counters on the body that
  // MOVED … and puts them there"*, *"the counters that trigger places are a second
  // way this same move can turn lethal"*).
  //
  // ⚠️ **LAVA ZONE PLACES NO COUNTERS.** The printed consequent is *"their **new
  // Active Pokémon** is now Burned"* and the program is one op —
  // `{ op: "applyStatus", target: "defender", status: "burned" }` — so it touches
  // a DIFFERENT BODY from the one that moved, applies a §12 condition rather than
  // damage, and cannot make anything lethal at all here (Burn is dealt at the
  // Checkup). The board D328 asked for is genuinely unbuildable, and so is every
  // board on which this trigger contributes lethality. **THE DECLARED REASON WAS
  // NOT A WEAKER FORM OF THE TRUE ONE; IT WAS ABOUT A CARD THAT DOES NOT EXIST.**
  //
  // 🛑 **THE ORDER IS STILL OBSERVABLE, THROUGH THE LETHALITY THAT IS REALLY
  // THERE.** The retreat COST is the one that kills (§6's rows), and a sweep moved
  // in FRONT of the trigger Knocks the retreater Out — and parks the game on the
  // opponent's Prize decision — before the Ability has fired. So the two orderings
  // are told apart by WHICH ROW COMES FIRST, which is what "one interrupt after
  // both, never two" means in events.
  it.each(SEEDS)("the Ability fires BEFORE the Knock Out it does not cause (seed %i)", (seed) => {
    let state = board(seed, {
      p1Active: CONKELDURR,
      p1Bench: [PLAIN],
      p2Bench: [MAGCARGO], // the watcher, benched — the print carries no Active-Spot clause
    });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 200);
    expect(activeMaxHp(state, "p1")).toBe(260);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const result = applyAction(state, {
      type: "retreat",
      seat: "p1",
      promoteBenchIndex: 0,
      discardEnergy: active.energy.slice(0, 3),
    });
    if (!result.ok) throw new Error(`retreat failed: ${result.error.code}`);
    const kinds = result.events.map((e) => e.type);
    const triggered = result.events.findIndex(
      (e) => e.type === "ABILITY_TRIGGERED" && e.ability === "Lava Zone",
    );
    const koed = kinds.indexOf("KNOCKED_OUT");
    // THE PREMISE, ASSERTED (D324's rule): both things really happen on this one
    // action, so the ordering below is between two live rows and not between a row
    // and an absence.
    expect(triggered).toBeGreaterThanOrEqual(0);
    expect(koed).toBeGreaterThanOrEqual(0);
    expect(triggered).toBeLessThan(koed);
  });

  it.each(SEEDS)("…and the trigger's consequent is a BURN on the NEW Active (seed %i)", (seed) => {
    // The other half of the correction, on the same board: what the trigger does
    // is Burn the body that came UP, leaving the retreater's damage untouched at
    // the 200 it walked to the Bench with. A build in which Lava Zone placed
    // counters on the retreater — the card D328 wrote down — would move that
    // number, and every counters-based reading of this ordering dies here.
    let state = board(seed, {
      p1Active: CONKELDURR,
      p1Bench: [PLAIN],
      p2Bench: [MAGCARGO],
    });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 200);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const result = applyAction(state, {
      type: "retreat",
      seat: "p1",
      promoteBenchIndex: 0,
      discardEnergy: active.energy.slice(0, 3),
    });
    if (!result.ok) throw new Error(`retreat failed: ${result.error.code}`);
    const burned = result.events.filter(
      (e): e is Extract<GameEvent, { type: "STATUS_APPLIED" }> => e.type === "STATUS_APPLIED",
    );
    expect(burned.map((e) => ({ seat: e.seat, status: e.status }))).toEqual([
      { seat: "p1", status: "burned" },
    ]);
    // The burn lands on the PROMOTED body, never on the one that left.
    const knockedOut = result.events.find(
      (e): e is Extract<GameEvent, { type: "KNOCKED_OUT" }> => e.type === "KNOCKED_OUT",
    );
    expect(knockedOut).toBeDefined();
    expect(burned[0]?.uid).not.toBe(knockedOut?.uid);
    // And no damage was placed by anything: the Knock Out is the COST's, whole.
    expect(result.events.some((e) => e.type === "COUNTERS_PLACED")).toBe(false);
  });

  it.each(SEEDS)("the control: no Magcargo, no trigger, same Knock Out (seed %i)", (seed) => {
    // Without this row a build that never fired the Ability at all would be green
    // above on the ordering assertion's `toBeGreaterThanOrEqual(0)` alone.
    let state = board(seed, { p1Active: CONKELDURR, p1Bench: [PLAIN], p2Bench: [PLAIN] });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 200);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const result = applyAction(state, {
      type: "retreat",
      seat: "p1",
      promoteBenchIndex: 0,
      discardEnergy: active.energy.slice(0, 3),
    });
    if (!result.ok) throw new Error(`retreat failed: ${result.error.code}`);
    expect(result.events.some((e) => e.type === "ABILITY_TRIGGERED")).toBe(false);
    expect(result.events.some((e) => e.type === "STATUS_APPLIED")).toBe(false);
    expect(result.events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p1")).toBe(true);
  });
});
