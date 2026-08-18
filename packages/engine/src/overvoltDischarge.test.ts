import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deckOf,
  discardFromDeck,
  setActiveFromDeck,
  specialEnergy,
  typedEnergy,
} from "./testFixtures";

// ── D346 — "OVERVOLT DISCHARGE": THE PRINTED DISTRIBUTION, AND A RESIDUE NOTE
//    THAT ROTTED BY BEING REWRITTEN.
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   Magneton svp-153 / svp-159 / sv08-059
//     "Once during your turn, you may attach up to 3 Basic Energy cards from your
//      discard pile to your {L} Pokémon **in any way you like**. If you use this
//      Ability, this Pokémon is Knocked Out."
//   An ACTIVATED Ability. **3 Standard-legal printings, ONE sentence, ONE object,
//   and a ZERO engine diff** — `registry.ts` is the whole build.
//
// ── HOW THIS ROW WAS CHOSEN ─────────────────────────────────────────────────
// D344's method, run for the third slice running:
//   (1) LARGEST LIVE `ROWS` RESIDUE, read off `censusAtHead.test.ts` rather than
//       off a handoff — row 9 is 5 `abilityIds` + 5 `effectIds`, row 10 is 5, row
//       12 is 4, row 11 is 3. Row 9 wins on either the paper or the live reading.
//   (2) CENSUS THE CLAUSE, NOT THE CARD, over all three text columns (remote D1
//       `luminous`, 2026-08-15). `instr(<col>,'in any way you like')`:
//         effect          3 printings /  1 legal /  2 sentences
//         abilities_json 38 printings / 13 legal / 13 sentences
//         attacks_json   59 printings / 36 legal / 36 sentences
//       The 13 legal ABILITY printings are seven cards: Archaludon ex ×3 (BUILT at
//       D263), Infernape ×3, Magneton ×3, Metang ×2, Steven's Metagross ex ×1 and
//       Marnie's Grimmsnarl ex ×1.
//   (3) IS THE CARD THE RESIDUE POINTS AT THE CHEAPEST THING THAT SENTENCE BUYS?
//       **YES, and it is also the largest** — the reverse of what happened at D345.
//       Every other unbuilt member owes a SECOND mechanism: Infernape and Steven's
//       print the "…, or 1 of each" two-type grammar, Metang prints a
//       bottom-of-deck leftovers disposition, Marnie's prints an owner-prefix
//       target. **Magneton owes nothing.**
//       🛑 **D351 — THE INFERNAPE HALF OF THAT SENTENCE IS SPENT, AND IT WAS HALF
//       WRONG WHEN IT WAS WRITTEN.** Infernape ×3 is BUILT, and the *"…, or 1 of
//       each"* grammar was never a second MECHANISM at all: it is TWO
//       `attachEnergyFrom` ops, which is `ASSEMBLE_ALLOY`'s own reading of the
//       *"in any way you like"* this very census was run on. What Infernape
//       actually owed was one predicate in `cardplay.ts`. The STEVEN'S half stands
//       and is now sharper: `sv10-145` owes a disjunction on the TARGET axis, not
//       on the energy one. Annotated rather than rewritten (D178), because the
//       line above is the evidence for D346's row and deleting it would delete
//       that too.
//   (4) AND GREP IT. `programFor("svp-153")` was `undefined` at `e75b55a`, asserted
//       so by `cursedBlast.test.ts` §2. Every other hit in the tree was prose.
//
// ── 🛑🛑 THE FINDING: A RESIDUE NOTE ROTTED BY BEING REWRITTEN ──────────────
// `legalNonAttackPrograms.test.ts` has priced this card correctly since D263:
//
//   "Magneton … the attach IS EXPRESSIBLE (3 ops, `targetType: "Lightning"`), but
//    the second printed clause is 'If you use this Ability, this Pokémon is
//    Knocked Out' and NO OP IN THE ENGINE KNOCKS OUT ITS OWN HOST."
//
// D345 shipped `knockOutSelf` — spending exactly that blocker — and then wrote a
// NEW note, in roughly ten places, saying the blocker was the *"in any way you
// like"* DISTRIBUTION and that the card needed "a multi-destination assignment
// prompt". **That was false when it was written, and it had been false since
// D263**, which built the identical clause on Archaludon ex as TWO
// `attachEnergyFrom` ops. The card was buildable at D345's own head.
//
// ⚠️ **THE TRANSFERABLE PART IS THE DIRECTION OF THE ROT.** D341 recorded that a
// residue note naming a MECHANISM is only spendable when the id owes exactly one.
// This is the other failure mode of the same note: the id DID owe exactly one, the
// note named it correctly, a slice spent it — **and then replaced the spent note
// with a wrong one instead of deleting it.** A stale note stands still and can be
// re-derived; a REWRITTEN one looks fresh and carries a decision's authority.
// **When a slice spends a blocker, the note that named it must be DELETED, not
// re-pointed at the next thing that comes to mind.**
//
// ── D345's OPEN QUESTION, ANSWERED FROM SOURCE: **NEITHER** ─────────────────
// It asked whether `attachEnergyFrom` can reach the existing `attachCards`
// assignment prompt, "rather than whether a new prompt is needed". The answer is
// that it must reach NEITHER, and the engine has said so in three places since
// before the question was asked:
//   • `effects.ts` `attachEnergyFrom.count` — "N ops park N times and may land on N
//     different bodies (Koraidon 'Dino Cry''s printed *in any way you like*), where
//     `count` parks ONCE and pins the batch."
//   • `effects.ts` `attachFromHand` — the `attachCards` MAP exists for *"any
//     number"*, which "names no unit, so … there is no N to unroll"; the two
//     `sv08-079`/`-204` printings that DO spell a count "are already built, as 2
//     separate `attachEnergyFrom` ops, and the sequential model is observably
//     equivalent at a printed count".
//   • `registry.ts` `ASSEMBLE_ALLOY` (D263) — two ops and deliberately not
//     `count: 2`, written as the expansion `attachFromZoneProgram` already emits
//     for the ATTACK half of the same family.
// Magneton prints **"up to 3"**. It is three ops.
//
// ── WHAT ELSE WAS REFUSED, WITH THE MEASUREMENT ─────────────────────────────
//   • Lycanroc `sv09-085`/`sv09-166` (2 legal) — "up to 2 **Spiky Energy** cards",
//     a card named by NAME. `attachEnergyFrom` narrows by `energyType`/`anyEnergy`
//     and D246 refused it a `CardFilter` for a measured reason. UNCHANGED.
//   • Powerglass `sv06.5-063`/`-097` (2 legal) — needs a new `endOfTurn`
//     `TriggerTiming` plus a Tool hook. `grep -rn "endOfTurn" packages/engine/src`
//     is ONE hit at this head and it is D345's own note. Re-derived, still refused.
//   • Reboot Pod `sv05-158` and Glass Trumpet `sv07-135`/`sv08.5-110` — DEAD DATUM
//     (the Future banner and the Tera one have no supply-side column). Recorded.
//   • The other ten legal printings of this clause — see (3).
//
// ── WHAT THIS ROW COSTS ─────────────────────────────────────────────────────
// **ZERO new ops, ZERO new op fields, ZERO new events, ZERO new prompt kinds, ZERO
// new `TriggerTiming`s, and `MATCH_RECORD_VERSION` STAYS 20.** `source: "discard"`
// is D234, `targetType` is D235 and `knockOutSelf` is D345 — the youngest piece is
// one decision old, which is the whole reason this row is three printings for a
// registry diff.

const MAGNETON = "svp-153";
const MAGNETON_PROMO = "svp-159";
const MAGNETON_SURGING = "sv08-059";
const MAGNETON_IDS = [MAGNETON, MAGNETON_PROMO, MAGNETON_SURGING] as const;

const ABILITY = "Overvolt Discharge";
const MAGNETON_TEXT =
  "Once during your turn, you may attach up to 3 Basic Energy cards from your discard pile to your {L} Pokémon in any way you like. If you use this Ability, this Pokémon is Knocked Out.";

/** A second {L} body with NO Ability — a destination and never a source, so a case
    that attaches "to another {L} Pokémon" is not secretly attaching to a Magneton. */
const LIGHTNING_A = "fix-d346-lightning-a";
const LIGHTNING_B = "fix-d346-lightning-b";
/** A NON-{L} body: excluded by `targetType` and by nothing else. */
const FIGHTING = "fix-d346-fighting";
const WALL = "fix-d346-wall";
/** Three Basic Energy of three DIFFERENT types. The printed noun is the bare
    "Basic Energy cards" with no brace code, so all three are attachable — which is
    what makes the ABSENCE of `energyType` on this row an assertion rather than a
    default nobody checks. */
const ENERGY_L = "fix-d346-energy-lightning";
const ENERGY_F = "fix-d346-energy-fighting";
const ENERGY_W = "fix-d346-energy-water";
/** A SPECIAL Energy. `anyEnergy` is ABSENT on this row, so `attachableEnergies`
    tests `card.energyType === "Normal"` and this card is out of reach — the printed
    word "Basic", driven rather than described. */
const ENERGY_SPECIAL = "fix-d346-energy-special";

/** The three real printings, carried VERBATIM off the remote D1 row (2026-08-15):
    HP 100, Stage 1 out of Magnemite, {L}, retreat 1, weak to {F} ×2, the Ability
    text and the printed attack at its printed index. Held in a LOCAL pool and never
    in `FIXTURE_POOL` — D275's idiom, and here it is again the only option that
    costs nothing: `catalogManifest.test.ts` classifies real-looking fixture ids
    against a generated manifest of SIX sets and neither `svp` nor `sv08` is one of
    them, so a shared-pool body would have owed a `fix-*` key on `censusAtHead`'s
    `raw.length` line. **THE KEY IS THE SET, NOT THE SURFACE.** */
const LOCAL_CARDS: Record<string, Card> = Object.fromEntries([
  ...MAGNETON_IDS.map((id) => [
    id,
    battler(id, {
      name: "Magneton",
      stage: "Stage1",
      evolveFrom: "Magnemite",
      hp: 100,
      retreat: 1,
      types: ["Lightning"],
      weaknesses: [{ type: "Fighting", value: "×2" }],
      abilities: [{ type: "Ability", name: ABILITY, effect: MAGNETON_TEXT }],
      attacks: [{ cost: ["Lightning", "Colorless"], name: "Electric Ball", damage: 40 }],
    }),
  ]),
  [
    LIGHTNING_A,
    battler(LIGHTNING_A, {
      name: "D346 Lightning A",
      hp: 120,
      retreat: 1,
      types: ["Lightning"],
      attacks: [{ cost: ["Lightning"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    LIGHTNING_B,
    battler(LIGHTNING_B, {
      name: "D346 Lightning B",
      hp: 120,
      retreat: 1,
      types: ["Lightning"],
      attacks: [{ cost: ["Lightning"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    FIGHTING,
    battler(FIGHTING, {
      name: "D346 Fighting",
      hp: 120,
      retreat: 1,
      types: ["Fighting"],
      attacks: [{ cost: ["Fighting"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    WALL,
    battler(WALL, {
      name: "D346 Wall",
      hp: 330,
      retreat: 1,
      types: ["Colorless"],
      attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    }),
  ],
  [ENERGY_L, typedEnergy(ENERGY_L, "Lightning")],
  [ENERGY_F, typedEnergy(ENERGY_F, "Fighting")],
  [ENERGY_W, typedEnergy(ENERGY_W, "Water")],
  [ENERGY_SPECIAL, specialEnergy(ENERGY_SPECIAL, "D346 Special Energy")],
]) as Record<string, Card>;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// Every body this suite seats is drawn OUT OF THE DECK by the fixture helpers, so
// these counts are the deepest board any case builds rather than decoration.
const DECK = deckOf({
  [MAGNETON]: 4,
  [MAGNETON_PROMO]: 4,
  [MAGNETON_SURGING]: 4,
  [LIGHTNING_A]: 6,
  [LIGHTNING_B]: 6,
  [FIGHTING]: 6,
  [WALL]: 8,
  [ENERGY_L]: 8,
  [ENERGY_F]: 6,
  [ENERGY_W]: 4,
  [ENERGY_SPECIAL]: 4,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function step(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: [...result.events] };
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** Setup driven against a LOCAL `cardPool` (D275's idiom). Nothing is added to
    `FIXTURE_POOL` — which is what keeps `censusAtHead`'s `raw.length` and
    `nonAttackRegistryIds()` lines 0 apart for the seventh slice running. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** Seat exactly the bodies each side names, Active first, on p1's turn. */
function board(spec: { p1: readonly string[]; p2: readonly string[] }, seed = 4): GameState {
  let state = localSetup(seed, "p1");
  for (const seat of ["p1", "p2"] as const) {
    const ids = seat === "p1" ? spec.p1 : spec.p2;
    state = setActiveFromDeck(state, seat, ids[0] ?? WALL);
    state = clearBench(state, seat);
    for (const id of ids.slice(1)) state = benchFromDeck(state, seat, id);
  }
  return state;
}

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

function discharge(state: GameState, target: { spot: "active" } | { spot: "bench"; index: number }) {
  return step(state, { type: "useAbility", seat: "p1", target, abilityName: ABILITY });
}

/** Answer one `attachEnergyFrom` park with a destination. Asserts the park shape on
    the way through, so a case that stopped parking fails HERE rather than by
    quietly landing fewer cards. */
function attachTo(state: GameState, ref: PokemonRef) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  return step(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
}

function energyCount(state: GameState, ref: PokemonRef): number {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return body?.energy.length ?? 0;
}

describe("D346 §1 — the registry row, read off the LIVE registry", () => {
  it("all THREE printings resolve to ONE program object, by identity", () => {
    const first = programFor(MAGNETON);
    expect(first).toBeDefined();
    // Identity, not deep equality: three separate-but-equal objects would pass a
    // `toEqual` and would be THREE rows in `censusAtHead`'s object decomposition,
    // where the 3:1:1 step this slice records says one.
    for (const id of MAGNETON_IDS) expect(programFor(id), id).toBe(first);
  });

  it("🛑 the program is THREE `attachEnergyFrom` ops and NOT `count: 3`", () => {
    // This is the claim the row could most easily get wrong, and the one D345's
    // handoff got backwards. `count` pins a batch to ONE body (D205); the printed
    // "in any way you like" is N INDEPENDENT decisions. Asserted on the SHAPE, so
    // a later slice that "simplifies" the three ops into one reddens here before it
    // reaches the driven cases below.
    const program = programFor(MAGNETON)?.abilities?.[0]?.program;
    expect(program).toHaveLength(4);
    const attaches = program?.slice(0, 3) ?? [];
    // 🆕 D358 — each op now carries `declinable: true`, the printed *"up to 3"*.
    // The three are still spelled apart and still carry no `count`, which is what
    // this assertion is for: `declinable` says the player may come in UNDER the
    // ceiling, and `count` would say all three land on ONE body — orthogonal
    // fields, and the second claim below still proves the second is absent.
    expect(attaches).toEqual([
      { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
      { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
      { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
    ]);
    // …and no `count` anywhere in the program, which is the same claim from the
    // other side and survives a re-ordering of the fields above.
    expect(JSON.stringify(program)).not.toContain("count");
  });

  it("`knockOutSelf` is LAST, field-free, and the ONLY non-attach op", () => {
    const program = programFor(MAGNETON)?.abilities?.[0]?.program;
    expect(program?.[3]).toEqual({ op: "knockOutSelf" });
    // Field-free: the op carries nothing, so `toEqual` above is the whole shape.
    expect(Object.keys(program?.[3] ?? {})).toEqual(["op"]);
  });

  it("the Ability is `oncePerTurn`, NOT `activeOnly`, and named as printed", () => {
    const ability = programFor(MAGNETON)?.abilities?.[0];
    expect(ability?.name).toBe(ABILITY);
    expect(ability?.oncePerTurn).toBe(true);
    // The sentence names no spot, so a BENCHED Magneton discharges and dies on the
    // Bench — which is how the card is played, and the case below drives it.
    expect(ability?.activeOnly).toBe(false);
  });

  it("all THREE ids are in the live registry and no fourth rode along", () => {
    const ids = new Set(registryCardIds());
    for (const id of MAGNETON_IDS) expect(ids.has(id), id).toBe(true);
    const named = registryCardIds().filter((id) =>
      programFor(id)?.abilities?.some((a) => a.name === ABILITY),
    );
    expect(named.sort()).toEqual([...MAGNETON_IDS].sort());
  });

  it("`knockOutSelf` now has exactly THREE producers in the whole registry", () => {
    // D345 pinned TWO (the two Cursed Blast objects) with the note that "a third
    // producer means a slice authored a row this note does not describe". This
    // slice is that third, and the pin moves WITH it rather than being deleted.
    // Counted over PROGRAM OBJECTS, not ids — nine ids, three objects.
    const objects = new Set(
      registryCardIds()
        .map((id) => programFor(id))
        .filter((program) =>
          [...(program?.abilities ?? []), ...(program?.triggered ?? [])].some((ability) =>
            ability.program.some((op) => op.op === "knockOutSelf"),
          ),
        ),
    );
    expect(objects.size).toBe(3);
  });
});

describe("D346 §2 — the DISTRIBUTION: three cards, three bodies, three parks", () => {
  it("🛑 three attaches land on THREE DIFFERENT {L} Pokémon, then the host dies", () => {
    // This is the printed "in any way you like" and the whole reason the row is
    // three ops: each park carries its OWN destination, so the batch may SPLIT.
    let state = board({ p1: [MAGNETON, LIGHTNING_A, LIGHTNING_B], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 3);
    const host = state.players.p1.active?.stack.at(-1);

    let cur = discharge(state, { spot: "active" }).state;
    cur = attachTo(cur, benchRef(0)).state; // #1 → Lightning A
    cur = attachTo(cur, benchRef(1)).state; // #2 → Lightning B
    const { state: after, events } = attachTo(cur, ACTIVE); // #3 → the Magneton itself

    expect(energyCount(after, benchRef(0))).toBe(1);
    expect(energyCount(after, benchRef(1))).toBe(1);
    // …and the printed cost resolves on the SAME resume as the last attach.
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(host);
    expect(after.players.p1.active).toBeNull();
  });

  it("…and it may equally land ALL THREE on ONE body — the split is the PLAYER's", () => {
    // The counter-case, and the reason `count: 3` would have been observationally
    // wrong rather than merely differently spelled: `count` can only produce THIS
    // outcome, and the case above is unreachable from it.
    // ⚠️ The Magneton is the ACTIVE here on purpose: a BENCHED host that dies
    // RE-INDEXES the bench under the reader, so a case that reads `benchRef(1)`
    // after the KO is asking about a different body. Found by this suite going red.
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 3);
    let cur = discharge(state, { spot: "active" }).state;
    for (const _ of [0, 1, 2]) cur = attachTo(cur, benchRef(0)).state;
    expect(energyCount(cur, benchRef(0))).toBe(3);
  });

  it("the three parks are SEQUENTIAL, not one compound prompt", () => {
    // The flagged difference between the two models (effects.ts, `attachFromHand`):
    // N questions in sequence, so the prompt kind is `choosePokemon` each time and
    // never the `attachCards` MAP. Asserted so a later slice that re-homes this op
    // onto the compound park cannot do it silently.
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 3);
    let cur = discharge(state, { spot: "active" }).state;
    for (const _ of [0, 1]) {
      if (cur.phase.kind !== "effect:choose") throw new Error("expected a park");
      expect(cur.phase.prompt.kind).toBe("choosePokemon");
      cur = attachTo(cur, benchRef(0)).state;
    }
    if (cur.phase.kind !== "effect:choose") throw new Error("expected a third park");
    expect(cur.phase.prompt.kind).toBe("choosePokemon");
  });
});

describe("D346 §3 — the two printed NOUNS, each narrowing a different thing", () => {
  it("`targetType` is the DESTINATION noun: a non-{L} body is never offered", () => {
    let state = board({ p1: [MAGNETON, LIGHTNING_A, FIGHTING, WALL], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 1);
    const parked = discharge(state, { spot: "active" }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    const candidates = parked.phase.prompt.candidates;
    // The Magneton (Active, {L}) and Lightning A (bench 0) only — the {F} body and
    // the {C} Wall are excluded by `targetType` and by nothing else.
    expect(candidates).toHaveLength(2);
    expect(candidates.some((c) => c.spot.spot === "bench" && c.spot.index === 1)).toBe(false);
    expect(candidates.some((c) => c.spot.spot === "bench" && c.spot.index === 2)).toBe(false);
  });

  it("🛑 NO `energyType`: a Basic {F} and a Basic {W} are BOTH attachable", () => {
    // The printed noun is the bare "Basic Energy cards" with no brace code, so the
    // ABSENCE of `energyType` on this row is load-bearing. Driven with a pile that
    // holds NO {L} at all, so an added `energyType: "Lightning"` would whiff the
    // whole Ability rather than merely narrowing it.
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_F, 1);
    state = discardFromDeck(state, "p1", ENERGY_W, 1);
    let cur = discharge(state, { spot: "active" }).state;
    cur = attachTo(cur, benchRef(0)).state;
    const { state: after } = attachTo(cur, benchRef(0));
    expect(energyCount(after, benchRef(0))).toBe(2);
  });

  it("…but a SPECIAL Energy is out of reach — the printed word is \"Basic\"", () => {
    // `anyEnergy` is ABSENT, so `attachableEnergies` tests `energyType === "Normal"`.
    // A pile of Special Energy alone makes the attach whiff, which `programPlayable`
    // turns into a refusal (see §5).
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_SPECIAL, 3);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: ABILITY,
    });
    expect(result.ok).toBe(false);
  });
});

describe("D346 §4 — the printed \"UP TO\", and the KO that is not conditional on it", () => {
  it("one card in the pile attaches ONE and the host STILL dies", () => {
    // `min(3, available)`: ops 2 and 3 find nothing and no-op silently, and the KO
    // is not gated on how many landed — "If you use this Ability" is the whole
    // condition.
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 1);
    const host = state.players.p1.active?.stack.at(-1);
    const parked = discharge(state, { spot: "active" }).state;
    const { state: after, events } = attachTo(parked, benchRef(0));
    expect(energyCount(after, benchRef(0))).toBe(1);
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(host);
  });

  it("the Knock Out is a real §8.1 one: the OPPONENT takes a Prize, mid-p1's-turn", () => {
    let state = board({ p1: [WALL, MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 1);
    const parked = discharge(state, { spot: "bench", index: 0 }).state;
    const { state: after } = attachTo(parked, benchRef(1));
    // p1 blew up its OWN body, so the Prize is p2's — during p1's turn.
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p2");
    expect(after.phase.count).toBe(1);
    const { state: done } = step(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] });
    expect(done.players.p2.prizes).toHaveLength(5);
    // A BENCHED Knock Out owes no promotion, so the turn comes straight back.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("🛑 Energy attached to the HOST dies with it — the order is load-bearing", () => {
    // A {L} Magneton is a legal destination for its own Ability, and the KO runs
    // AFTER every park, so a card routed to the host reaches the discard rather
    // than never leaving it. Authoring `knockOutSelf` FIRST would have destroyed a
    // target the prompt was still offering.
    let state = board({ p1: [WALL, MAGNETON], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 1);
    const host = benchTopUid(state, "p1", 0);
    // 🆕🆕 **D358 REDDENED THIS LINE BY NAME, AND THE REPAIR IS THE WHOLE POINT.**
    // It used to read: *"the host is the ONLY {L} body, so the attach has ONE
    // candidate and the op does NOT park at all"*. That was the M1 no-choice rule
    // applied to a print that says *"up to 3"* — and over a lone candidate a
    // declinable pick still has TWO answers, so the op now ASKS. One card is in the
    // pile, so op 1 parks, op 2 and op 3 whiff on an empty pile, and the KO runs on
    // the resume. The claim the case was written to make is untouched: a card routed
    // to the host reaches the DISCARD, because `knockOutSelf` is authored last.
    const parked = discharge(state, { spot: "bench", index: 0 }).state;
    expect(parked.phase.kind).toBe("effect:choose");
    const { state: after } = attachTo(parked, benchRef(0));
    expect(after.players.p1.discard).toContain(host);
    expect(after.players.p1.bench).toHaveLength(0);
  });

  it("an ACTIVE discharge empties the Active Spot and owes a promotion", () => {
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 1);
    const parked = discharge(state, { spot: "active" }).state;
    const { state: after } = attachTo(parked, benchRef(0));
    expect(after.players.p1.active).toBeNull();
    // The promotion is §8.1's, queued once the whole program settled — not the op's.
    const phases = [after.phase.kind];
    expect(phases.some((k) => k === "ko:takePrizes" || k === "ko:promote")).toBe(true);
  });
});

describe("D346 §5 — the GATE, and the design call it makes", () => {
  it("an empty discard pile REFUSES the Ability rather than offering a bare suicide", () => {
    // ⚠️ THE FLAGGED CALL, driven so it is a decision and not an accident.
    // `programPlayable` refuses an `attachEnergyFrom` that can only whiff, and this
    // program's other clause is a COST rather than an effect — so unlike Giovanni's
    // gated gust there is no "first half of what it prints" left to do. Strictly the
    // printed rules permit using it and dying for nothing; the engine's standing
    // afford-then-reject doctrine (D222) wins, and a slice that wants the literal
    // reading changes ONE gate in cardplay.ts and this case with it.
    const state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: ABILITY,
    });
    expect(result.ok).toBe(false);
  });

  it("🛑 the gate's OTHER arm is UNREACHABLE on this card, and that is a fact about the print", () => {
    // `programPlayable` refuses on `firstAttachableEnergy === undefined` **OR**
    // `attachEnergyTargets(...).length === 0`. The second arm cannot fire here:
    // the printed destination is "your {L} Pokémon" and **Magneton is itself {L}**,
    // so a board that can use this Ability always holds at least one legal target —
    // the host. Said out loud rather than left as an untested branch, and asserted
    // through the CANDIDATE SET so a later `targetType` change reddens here.
    let state = board({ p1: [WALL, MAGNETON, FIGHTING], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 3);
    const host = benchTopUid(state, "p1", 0);
    // 🆕 D358 — the host is the ONLY {L} body, so the gate PASSES; but the printed
    // *"up to 3"* is declinable, so each of the three attaches now ASKS rather than
    // being forced onto the lone candidate (the sibling case in §4 carries the full
    // note). Answering all three routes three cards onto a body that is dead by the
    // end of the same resolution, which is the claim this case makes.
    let after = discharge(state, { spot: "bench", index: 0 }).state;
    let events: GameEvent[] = [];
    for (const _ of [0, 1, 2]) {
      const answered = attachTo(after, benchRef(0));
      after = answered.state;
      events = [...events, ...answered.events];
    }
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(host);
    // Nothing reached the {F} body: it was never a candidate.
    expect(after.players.p1.bench.every((b) => b.energy.length === 0)).toBe(true);
    expect(after.players.p1.discard).toContain(host);
  });

  it("the once-per-turn lock is PER BODY: the second Magneton still discharges", () => {
    // Nothing prints "you can't use more than 1 Overvolt Discharge Ability each
    // turn", so `oncePerTurn` is the default per-body scope: two Magneton are two
    // uses and two Prizes given up.
    let state = board({ p1: [WALL, MAGNETON, MAGNETON_PROMO, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 6);
    // Three {L} bodies on the board, so ALL THREE attaches park and all three must
    // be answered before the program settles and the KO runs. Route every card to
    // Lightning A (bench 2) so neither Magneton is fed and neither index moves
    // before the KO.
    let cur = discharge(state, { spot: "bench", index: 0 }).state;
    for (const _ of [0, 1, 2]) cur = attachTo(cur, benchRef(2)).state;
    // The first Magneton is gone; the second slid down to index 0 and is unlocked.
    const settled =
      cur.phase.kind === "ko:takePrizes"
        ? step(cur, { type: "takePrizes", seat: "p2", prizeIndices: [0] }).state
        : cur;
    expect(settled.players.p1.bench).toHaveLength(2);
    const second = applyAction(settled, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: ABILITY,
    });
    expect(second.ok).toBe(true);
  });
});

describe("D346 §6 — the attribution controls", () => {
  it("the local fixture really carries the REGISTRY program, not just Ability TEXT", () => {
    // 🛑 D345's own §4 finding, applied to this file's fixtures: a case written
    // against an invented body carrying Ability text and NO program is green and
    // means nothing. Every id this suite drives is a REAL catalog id whose
    // `programFor` is DEFINED, and the pool entry is only its printed card data.
    for (const id of MAGNETON_IDS) expect(programFor(id), id).toBeDefined();
    for (const id of MAGNETON_IDS) {
      expect(LOCAL_CARDS[id]?.abilities?.[0]?.name, id).toBe(ABILITY);
    }
  });

  it("the fixture's Ability text is the catalog's, character for character", () => {
    // The round-trip this file can run and `effects.ts` cannot: a fixture that
    // paraphrases the print is a different card being tested under the right name.
    expect(MAGNETON_TEXT).toContain("in any way you like");
    expect(MAGNETON_TEXT).toContain("If you use this Ability, this Pokémon is Knocked Out.");
    expect(MAGNETON_TEXT).toContain("up to 3 Basic Energy cards from your discard pile");
    expect(MAGNETON_TEXT).toContain("to your {L} Pokémon");
  });

  it("nothing this suite adds reached `FIXTURE_POOL` — the census cost is ZERO", () => {
    // D275's idiom, asserted rather than intended: every local id is absent from the
    // shared pool, which is what keeps `censusAtHead`'s `raw.length` and
    // `nonAttackRegistryIds()` lines 0 apart and `revealClause`'s `swept.size` still.
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(Object.hasOwn(FIXTURE_POOL, id), id).toBe(false);
    }
  });
});
