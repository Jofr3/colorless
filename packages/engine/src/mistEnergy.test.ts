import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  FIXTURE_POOL,
  SPECIAL_ENERGY_SEAM_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.176.0 → 0.177.0 — THE SPECIAL-ENERGY COLUMN'S TWO CHEAPEST REMAINING ROWS
// (P3-M5 long tail, D261):
//
//   sv05-161 Mist Energy
//     "As long as this card is attached to a Pokémon, it provides {C} Energy.
//
//      Prevent all effects of attacks used by your opponent's Pokémon done to the
//      Pokémon this card is attached to. (Existing effects are not removed.
//      Damage is not an effect.)"
//   sv08-191 Enriching Energy
//     "As long as this card is attached to a Pokémon, it provides {C} Energy.
//
//      When you attach this card from your hand to a Pokémon, draw 4 cards."
//
// ── THE CENSUS, RE-DERIVED AT THIS COMMIT AND NOT TRANSCRIBED ─────────────────
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a), 2026-08-07,
// `legal_standard = 1`, GROUPED BY SENTENCE, over ALL THREE text columns via
// `json_each`, case-insensitively — D257's ladder discipline, sixth consecutive row.
//
// RUNG 1 — `%prevent all effects of attacks%` — 3 printings on 3 sentences:
//   ability  1  sv08-031   BUILT at D260 ("Unaware")
//   ability  1  sv10-051   BUILT at D260 ("Repelling Veil")
//   effect   1  sv05-161   ← ROW A. D260's ladder turned this up as its OWN false
//     positive and wrote it down as a WORK ORDER rather than as an exclusion,
//     which is the whole reason this slice exists.
//
// RUNG 2 — `%effects of attacks%` MINUS rung 1 — 26 printings on 6 sentences, and
// every one already accounted for (D260's table, re-run to the digit): the TERA
// group 3 (permanently unbuildable), D253's 3, D252's 2, D254's 1, and 🛑 **17
// ATTACK printings on 2 sentences** which are D142's durated §11 spelling and NOT
// a row — reading them as one would author 17 printings twice.
//
// ── THE COLUMN CENSUS, WHICH IS WHAT MAKES THIS ONE SLICE ────────────────────
// `category='Energy' AND energy_type='Special' AND legal_standard=1 AND effect<>''`
// GROUPED BY `effect` — **7 sentences / 8 printings**, of which 2 (Spiky Energy
// `sv09-159`/`-190`) were already BUILT. This slice takes the two CHEAPEST of the
// remaining six; the four it does NOT take are named here, with the blocker, so the
// residue is a measurement rather than a silence:
//   sv05-162 Neo Upper Energy     — ✅ **BUILT at D262** ("provides every type …
//     but only 2 at a time", GATED on the holder being a Stage 2). The blocker
//     named here — "`continuous.ts unitsOf` takes `(state, uid, specialUids)` and
//     does not know the HOLDER" — was the whole price, and it came to a signature
//     widening because both call sites already held the `InPlayPokemon`. See
//     `neoUpperEnergy.test.ts`. The residue below is therefore THREE.
//   sv06-166 Boomerang Energy     — re-attach from the discard pile after attacking,
//     and only if an attack's own effect discarded it. Nothing records WHY a card
//     left a body.
//   sv06-167 Legacy Energy        — ✅ **BUILT at D298.** The blocker recorded here
//     for five slices — "a PRIZE-COUNT modifier on the holder's KO, once per game.
//     Needs a prize hook AND a per-game latch; §14 has neither" — held its
//     CONCLUSION and was HALF STALE in its reason. The prize hook is §8.1's, not
//     §14's, and D164 built it (`planPrizes` / `koPrizeReduction`) for the
//     byte-similar Munkidori ex antecedent; the attached-card scan is D174's own
//     `passivesOf` fold, which this very file's Row A is about. Only the LATCH was
//     missing, and it is one `GameState` field. See `legacyEnergy.test.ts`.
//     ⚠️ **THE LESSON IS ABOUT THIS LIST, NOT ABOUT THAT CARD: a refusal's
//     CONCLUSION can outlive its REASON by five slices, and nobody re-typed it
//     because the conclusion kept reading true.** The residue below is therefore TWO.
//   sv10-182 Team Rocket's Energy — an ATTACH RESTRICTION plus a continuous
//     self-discard when the restriction stops holding. No seam for either.
//     🆕 D262 SHARPENED THE PROVISION HALF, BY READING `costMet` RATHER THAN BY
//     INHERITING THE CELL: "it provides 2 in any combination of {P} Energy and
//     {D} Energy" needs a **THIRD UNIT KIND** — a wildcard CONSTRAINED to a set of
//     types. `costMet` (attack.ts) has exactly two: a concrete type, and
//     `ANY_ENERGY`, which fills ANY slot. `provides: ["Psychic", "Darkness"]` is
//     NOT this sentence (it refuses a {P}{P} cost the print allows) and
//     `[ANY_ENERGY, ANY_ENERGY]` — D262's own units — is not either (it pays a
//     {R}{W} cost the print refuses). So the row needs a `costMet` change on top
//     of its two other clauses, which is why D262 did NOT take it as a second row.
// ⚠️ `POPULATION.specialEnergyUnits` is **11**, not 8: the census column splits by
// `cards.category`, and 3 of the 11 are BASIC energy carrying effect text.
//
// ── ROW A COSTS *ZERO ENGINE LINES*, AND THAT IS WHY IT IS FIRST ─────────────
// D174 made an attached Energy the THIRD SOURCE CLASS of `passivesOf` — `sources`
// walks `pokemon.energy` and reads `programFor(id)?.energy?.passive` — and D260 put
// `if (passive.preventAttackEffects === true)` inside that very fold loop and wired
// the flag into `interpreter.ts effectRefusedOn`. The printed object, "the Pokémon
// this card is attached to", IS the body the fold is about. So Row A is a REGISTRY
// ROW and nothing else: no `continuous.ts`, no `interpreter.ts`, no `attack.ts`, no
// `cards.ts`, no `effects.ts`, no `types.ts`, no new read site and no new event.
// ⚠️ That was PREDICTED before the first edit and GREPPED (`const sources:`) before
// the row was promised, which is the only reason it counts as evidence.
//
// 🛑 AND ROW A IS THE FIRST BOARD IN THIS ENGINE ON WHICH THE §9 ANSWER SPLITS
// INSIDE ONE FOLD FIELD. `preventAttackEffects` has exactly two writers now: an
// ABILITY (`sv08-031`) and an ENERGY (`sv05-161`). A Klefki lock must silence the
// first and MUST NOT touch the second — same field, same call, opposite verdicts —
// and `lockedBoard` below drives both in one `passivesOf` pair. D174 bought that
// exemption STRUCTURALLY (the Energy slot is appended past the `disabled` term) and
// D172's three wrong claims are exactly why construction alone is not evidence.
//
// ── ROW B IS THE SECOND `EnergyOnAttach` ARM EVER ────────────────────────────
// `switchIfBenched` (Jet Energy) has been the union's only member since M4 slice 5.
// "When you attach this card from your hand to a Pokémon, draw 4 cards" is a second
// arm at the same `turn.ts attachEnergy` site, and it takes a GUARD and not a
// FILTER: the op names ONE seat and ONE body and there is no set to narrow.
// ⚠️ NO new event — `CARDS_DRAWN` with `reason: "effect"` already carries it.
// ⚠️ THE COUNT RIDES THE REGISTRY ROW AS DATA (`count: 4`), by D260's test: a second
// printing of the same mechanism would need a different argument.
// 🛑 AND THE ARM IS UNGATED BY SPOT, which is its sharpest difference from its only
// sibling — Jet's arm fires ONLY on a bench attach, and a build that copied that
// guard would silently drop every Active attach. Driven on BOTH spots below.

const BITE = 0;
const YAWN = 4;
const CLUTCH = 5;

const MIST_PRINTED =
  "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nPrevent all effects of attacks used by your opponent's Pokémon done to the Pokémon this card is attached to. (Existing effects are not removed. Damage is not an effect.)";
const ENRICHING_PRINTED =
  "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nWhen you attach this card from your hand to a Pokémon, draw 4 cards.";

function drawEvents(events: GameEvent[]): Extract<GameEvent, { type: "CARDS_DRAWN" }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: "CARDS_DRAWN" }> => {
    return e.type === "CARDS_DRAWN";
  });
}

/** Field P2's Active as `activeId` with one `energyId` on it (or none), wipe the
    bench `setActiveFromDeck` displaces (D253's `clearBench` rule), bench each of
    `bench`, then hand the turn to P1 with `fix-shellcracker` Active and one {C}
    attached. Every attack board in this file is one call to this. */
function board(activeId: string, energyId: string | null, bench: string[] = []): GameState {
  let state = driveSetup(
    1,
    { p1: SPECIAL_ENERGY_SEAM_DECK, p2: SPECIAL_ENERGY_SEAM_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", activeId);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  if (energyId !== null) state = attachFromDeck(state, "p2", energyId, 1);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-shellcracker");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The §9 board, and the one this slice exists to make: Klefki Active on the
    ATTACKING seat, a Mist-bearing `fix-bigbody` Active on the defending seat and a
    `fix-unaware` Skeledirge on its bench. "Mischievous Lock" is Active-gated and
    reaches EACH player's Basic Pokémon in play, so it reaches both — and the two
    must answer OPPOSITELY on the same fold field.

    ⚠️ THE CLAIM IS A PREDICATE READ AND NOT A DRIVEN ATTACK, for
    `repellingVeil.test.ts`'s stated reason: Klefki's own attack is a bare 10 with
    no effect op, so the seat holding the lock cannot also fire `applyStatus`. */
function lockedBoard(): GameState {
  let state = driveSetup(
    1,
    { p1: SPECIAL_ENERGY_SEAM_DECK, p2: SPECIAL_ENERGY_SEAM_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-unaware");
  state = attachFromDeck(state, "p2", "fix-mist-energy", 1);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return setActiveFromDeck(state, "p1", "sv01-096");
}

/** P2 on turn, `fix-bigbody` Active, one `fix-titan` benched, `cardId` in hand —
    the attach boards for Row B. */
function inHand(cardId: string): GameState {
  let state = driveSetup(
    1,
    { p1: SPECIAL_ENERGY_SEAM_DECK, p2: SPECIAL_ENERGY_SEAM_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  return handFromDeck(state, "p2", cardId, 1);
}

describe("Mist / Enriching Energy — the registry data rows", () => {
  // 🛑 THE WHOLE OF ROW A'S ENGINE DIFF IS THIS OBJECT.
  it("authors sv05-161 as an EnergyProgram passive, not a Pokémon passive", () => {
    expect(programFor("sv05-161")?.energy).toEqual({
      provides: ["Colorless"],
      passive: { preventAttackEffects: true },
    });
    // 🛑 AND NOT ON `CardProgram.passive`, which is the Pokémon/Tool surface. An
    // Energy authored there would be read by `passivesOf`'s FIRST source slot
    // (`programFor(top.id)?.passive`) — i.e. only if the card were the TOP CARD of
    // a stack, which an Energy never is — so it would silently do nothing.
    expect(programFor("sv05-161")?.passive).toBeUndefined();
  });

  it("authors sv08-191 as an EnergyProgram onAttach carrying the printed COUNT", () => {
    expect(programFor("sv08-191")?.energy).toEqual({
      provides: ["Colorless"],
      onAttach: { kind: "draw", count: 4 },
    });
  });

  // ⚠️ NEITHER ROW CARRIES THE OTHER'S CLAUSE, and the two sentences sit one
  // paragraph apart in the same column — the exact adjacency a merge would hide.
  it("keeps the two sentences on two fields — neither row carries the other's", () => {
    expect(programFor("sv05-161")?.energy?.onAttach).toBeUndefined();
    expect(programFor("sv08-191")?.energy?.passive).toBeUndefined();
  });

  // 🛑 THE DAMAGE HALF IS ABSENT FROM THE PRINT AND MUST BE ABSENT FROM THE ROW —
  // "(Damage is not an effect.)" is printed on Mist Energy in so many words.
  it("carries NO damage-half field, and no GROUP field, on the Mist row", () => {
    const passive = programFor("sv05-161")?.energy?.passive;
    expect(passive?.preventDamageAndEffectsFromSpecialEnergy).toBeUndefined();
    expect(passive?.preventDamageAndEffectsWhileBenched).toBeUndefined();
    expect(passive?.preventDamageAtOrAbove).toBeUndefined();
    // the printed object is ONE body ("the Pokémon this card is attached to"), so
    // D260's group field would be a mis-reading and not a widening.
    expect(passive?.preventAttackEffectsForGroup).toBeUndefined();
  });

  // ⚠️ THE FIRST PARAGRAPH IS THE GENERIC PROVISION AND IT WAS ALREADY BUILT —
  // `provides: ["Colorless"]` is Jet's and Spiky's line verbatim. Asserted rather
  // than assumed because it is the half that makes both rows RIDERS on shipped
  // machinery instead of new mechanisms.
  it("provisions {C} through the same field Jet and Spiky use", () => {
    for (const id of ["sv05-161", "sv08-191", "sv02-190", "sv09-159"]) {
      expect(programFor(id)?.energy?.provides, id).toEqual(["Colorless"]);
    }
  });

  // ⚠️ AND THE SENTENCES THIS COLUMN STILL OWES — the measured residue, pinned so
  // "unbuilt" cannot rot into "forgotten".
  //
  // 🆕 D262 — **RE-HOMED, NOT DELETED, AND IT IS THE ONE ASSERTION IN 284 FILES
  // THAT WENT RED THIS SLICE.** D261 left FOUR and named each with its blocker;
  // D262 built the cheapest of them (`sv05-162`, the conditional provision), so the
  // list is THREE. The residue moving is the whole point of the guard: it is the
  // only thing in the repo that goes red when this column is worked, and a slice
  // that shipped a fifth Special Energy without touching it would have to say so.
  // `sv05-162` keeps a line here — as BUILT, and pointing at the suite that owns
  // it — so the column's arithmetic stays readable from one place.
  it("authors NOTHING on the TWO remaining Special Energy sentences", () => {
    for (const id of ["sv06-166", "sv10-182"]) {
      expect(programFor(id), `${id} is counted UNBUILT`).toBeUndefined();
    }
    // …and the two that LEFT this list are asserted BUILT in the same test, so the
    // halves of "4 = 2 built + 2 left" cannot drift apart.
    expect(programFor("sv05-162"), "sv05-162 is BUILT at D262").toBeDefined();
    expect(programFor("sv06-167"), "sv06-167 is BUILT at D298").toBeDefined();
  });

  it("carries the printed sentence on both fixture demonstrators", () => {
    expect(FIXTURE_POOL["fix-mist-energy"]?.effect).toBe(MIST_PRINTED);
    expect(FIXTURE_POOL["fix-enriching-energy"]?.effect).toBe(ENRICHING_PRINTED);
  });
});

describe("Mist Energy — the shield rides an ATTACHED ENERGY (a passivesOf fold)", () => {
  // 🛑 THE ROW'S CENTRAL CLAIM, AND IT IS ABOUT WHERE THE SOURCE SITS. The holder
  // is `fix-bigbody`, which prints nothing at all; every bit of the shield comes
  // off the card attached to it.
  it("folds preventAttackEffects off the ENERGY onto its holder and nobody else", () => {
    const state = board("fix-bigbody", "fix-mist-energy", ["fix-titan"]);
    const holder = state.players.p2.active;
    const neighbour = state.players.p2.bench[0];
    if (holder === null || neighbour === undefined) throw new Error("board not set up");

    expect(passivesOf(state, holder).preventAttackEffects).toBe(true);
    expect(passivesOf(state, neighbour).preventAttackEffects).toBe(false);
  });

  // ⚠️ THE NEGATIVE THAT MAKES THE POSITIVE MEAN SOMETHING: the same body with an
  // UNAUTHORED Special Energy on it. `fix-special` provisions {C} through the
  // `energyProvidesOf` fallback and carries no program, so it reaches the fold's
  // Energy slot and contributes nothing.
  it("is not granted by just any attached Special Energy", () => {
    const state = board("fix-bigbody", "fix-special");
    const holder = state.players.p2.active;
    if (holder === null) throw new Error("no active");

    expect(holder.energy).toHaveLength(1);
    expect(passivesOf(state, holder).preventAttackEffects).toBe(false);
  });

  // 🛑 THE FUNNEL, AND THE POINT IS THAT IT IS ONE. Two DIFFERENT effect ops behind
  // one gate, reached from an ENERGY source for the first time.
  it("refuses an attack's applyStatus with ONE announced refusal", () => {
    const state = board("fix-bigbody", "fix-mist-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("refuses an attack's preventRetreat off the SAME gate", () => {
    const state = board("fix-bigbody", "fix-mist-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: CLUTCH });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.retreatBlocked).toBe(false);
  });

  // 🛑 "(DAMAGE IS NOT AN EFFECT.)" — THE PRINTED PARENTHETICAL, DRIVEN. A build
  // that reached the §8.5 pipeline would pass every assertion above and hand the
  // holder total immunity for one attachment.
  it("lets DAMAGE through in full — the printed parenthetical, on a real board", () => {
    const state = board("fix-bigbody", "fix-mist-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BITE });

    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });

  // ⚠️ NO ZONE CLAUSE IS PRINTED — the sentence names the body the card is attached
  // to and says nothing about where it stands.
  it("answers identically from the BENCH — the sentence prints no zone clause", () => {
    let state = board("fix-titan", null, ["fix-bigbody"]);
    state = attachBenchFromDeck(state, "p2", 0, "fix-mist-energy", 1);
    const benched = state.players.p2.bench[0];
    const active = state.players.p2.active;
    if (benched === undefined || active === null) throw new Error("board not set up");

    expect(passivesOf(state, benched).preventAttackEffects).toBe(true);
    // …and the Active, which holds none, is untouched — the fold is PER BODY.
    expect(passivesOf(state, active).preventAttackEffects).toBe(false);
  });

  // 🛑 "(EXISTING EFFECTS ARE NOT REMOVED.)" — the aura is a GATE at application
  // time and never a SWEEP. Driven: the body is put Asleep with no Mist on it, the
  // Energy is then attached, and the Sleep SURVIVES while the shield reads true.
  it("does not remove an effect already installed — driven, not asserted", () => {
    const before = board("fix-bigbody", null);
    const asleep = mustApply(before, { type: "attack", seat: "p1", index: YAWN }).state;
    expect(asleep.players.p2.active?.conditions.rotation).toBe("asleep");

    const shielded = attachFromDeck(asleep, "p2", "fix-mist-energy", 1);
    expect(shielded.players.p2.active?.conditions.rotation).toBe("asleep");

    const holder = shielded.players.p2.active;
    if (holder === null) throw new Error("no active");
    expect(passivesOf(shielded, holder).preventAttackEffects).toBe(true);
  });
});

describe("🛑 §9 — the SAME fold field answers OPPOSITELY for an Ability and an Energy", () => {
  it("silences Skeledirge's Ability and leaves Mist Energy's shield standing", () => {
    const state = lockedBoard();
    const holder = state.players.p2.active;
    const skeledirge = state.players.p2.bench[0];
    if (holder === null || skeledirge === undefined) throw new Error("board not set up");

    // the ABILITY printing of the very same sentence — SILENCED
    expect(passivesOf(state, skeledirge).preventAttackEffects).toBe(false);
    // the ENERGY printing — UNTOUCHED
    expect(passivesOf(state, holder).preventAttackEffects).toBe(true);
  });

  // ⚠️ THE NON-VACUOUS CONTROL: the lock really is live on this board. Without it
  // the assertion above would pass on a board where Klefki did nothing at all,
  // which is the vacuous-guard shape D214 was written about.
  it("proves the lock is LIVE — Skeledirge answers TRUE with Klefki gone", () => {
    const state = board("fix-bigbody", "fix-mist-energy", ["fix-unaware"]);
    const skeledirge = state.players.p2.bench[0];
    if (skeledirge === undefined) throw new Error("no benched Skeledirge");

    expect(passivesOf(state, skeledirge).preventAttackEffects).toBe(true);
  });
});

describe("Enriching Energy — the SECOND EnergyOnAttach arm", () => {
  // 🛑 THE ARM, DRIVEN ON THE ACTIVE SPOT — where its only sibling does NOT fire. A
  // build that copied Jet's `action.target.spot === "bench"` guard would be green on
  // the bench board below and silently dead here.
  it("draws 4 on an ACTIVE attach, and the hand nets +3", () => {
    const state = inHand("fix-enriching-energy");
    const uid = handUid(state, "p2", "fix-enriching-energy");
    const handBefore = state.players.p2.hand.length;
    const deckBefore = state.players.p2.deck.length;
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid,
      target: { spot: "active" },
    });

    const drawn = drawEvents(events);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.uids).toHaveLength(4);
    expect(drawn[0]?.reason).toBe("effect");
    expect(drawn[0]?.seat).toBe("p2");
    // one card LEFT the hand to become the attachment, four arrived.
    expect(done.players.p2.hand).toHaveLength(handBefore - 1 + 4);
    expect(done.players.p2.deck).toHaveLength(deckBefore - 4);
    expect(done.players.p2.active?.energy).toContain(uid);
  });

  it("draws 4 on a BENCH attach too, and switches NOTHING", () => {
    const state = inHand("fix-enriching-energy");
    const uid = handUid(state, "p2", "fix-enriching-energy");
    const activeBefore = state.players.p2.active?.stack.at(-1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid,
      target: { spot: "bench", index: 0 },
    });

    expect(drawEvents(events)[0]?.uids).toHaveLength(4);
    // 🛑 THE ARM DISCRIMINATION: Jet's switch must NOT ride along.
    expect(types(events)).not.toContain("POKEMON_SWITCHED");
    expect(done.players.p2.active?.stack.at(-1)).toBe(activeBefore);
    expect(done.players.p2.bench[0]?.energy).toContain(uid);
  });

  // ⚠️ AND THE MIRROR — Jet Energy still switches and still draws NOTHING. The two
  // arms are two reads of one `onAttach`, so a botched order or a fallthrough is
  // only visible from both sides.
  it("leaves Jet Energy's arm alone — it switches and draws nothing", () => {
    const state = inHand("sv02-190");
    const uid = handUid(state, "p2", "sv02-190");
    deepFreeze(state);

    const { events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid,
      target: { spot: "bench", index: 0 },
    });

    expect(types(events)).toContain("POKEMON_SWITCHED");
    expect(drawEvents(events)).toHaveLength(0);
  });

  // ⚠️ AND AN UNAUTHORED SPECIAL ENERGY FIRES NEITHER ARM — the read is
  // `programFor(card.id)?.energy?.onAttach`, so "no program" must mean "no effect"
  // rather than "the default arm".
  it("fires no arm at all for an unauthored Special Energy", () => {
    const state = inHand("fix-special");
    const uid = handUid(state, "p2", "fix-special");

    const { events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid,
      target: { spot: "bench", index: 0 },
    });

    expect(drawEvents(events)).toHaveLength(0);
    expect(types(events)).not.toContain("POKEMON_SWITCHED");
  });

  // ⚠️ AND IT IS STILL SUBJECT TO §6.2 — one Energy attach per turn. The draw is a
  // RIDER on the attach, so a refused attach draws nothing; the arm inherits that
  // guard rather than having to state it, and the six guards ahead of the arm all
  // belong to the attach term alone (D169's early-return audit, still holding).
  it("draws nothing when the §6.2 allowance is already spent", () => {
    let state = inHand("fix-enriching-energy");
    state = handFromDeck(state, "p2", "fix-energy", 1);
    const first = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "fix-energy"),
      target: { spot: "active" },
    }).state;

    expectErr(
      first,
      {
        type: "attachEnergy",
        seat: "p2",
        uid: handUid(first, "p2", "fix-enriching-energy"),
        target: { spot: "active" },
      },
      "ENERGY_ALREADY_ATTACHED",
    );
  });
});
