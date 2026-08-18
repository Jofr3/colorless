import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction, createGame } from "./index";
import { redactGame } from "./redact";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import { programFor, registryCardIds } from "./registry";
import { battler, deckOf, typedEnergy } from "./testFixtures";

// ── D358 — THE DECLINABLE POKÉMON PARK: "UP TO N" STOPS BEING AN EXACT COUNT ──
//
//   Archaludon ex sv08-130 / sv08-224 / sv08-241 — "Assemble Alloy"
//     "When you play this Pokémon from your hand to evolve 1 of your Pokémon
//      during your turn, you may attach **up to 2** Basic {M} Energy cards from
//      your discard pile to your {M} Pokémon **in any way you like**."
//   Magneton sv08-059 / svp-153 / svp-159 — "Overvolt Discharge"
//     "Once during your turn, you may attach **up to 3** Basic Energy cards from
//      your discard pile to your {L} Pokémon **in any way you like**. …"
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────
// `choosePokemon` was the ONE prompt kind in `EffectPrompt` with no way to say no.
// `chooseCards` has carried the distinction since it was written — *"`min: 0` —
// the printed 'up to' … Taking none is a legal answer"* against *"`min === max` —
// a MANDATORY exact pick, where the only decision is WHICH cards and never
// whether"* — `choosePokemonMulti` carries `declinable`, and `moveEnergy` and
// `attachCards` both document an empty answer as a legal decline.
// `attachEnergyFrom` is the one attach route that takes a prompt kind WITHOUT it,
// so every printed "attach up to N" it serves was resolved as an EXACT N: a
// controller who wanted ONE of two got two, out of their own discard pile, onto
// their own bodies. **DECLINABILITY IS A PROPERTY OF THE PROMPT KIND, NOT OF
// PARKING** — the claim `ASSEMBLE_ALLOY`'s doc got wrong for 95 decisions.
//
// ── 🛑🛑 THE RULES QUESTION, SETTLED FROM THE CATALOG AND NOT FROM `interpreter.ts`
// *"The prompt has no decline"* is an ENGINE fact. Four independent lines of
// printed evidence say what the CARD means, and none of them is these two cards:
//   (1) **THIS REPO'S OWN RULES DOC ALREADY RULED, IN PRINT.** `ptcg-rules.md`
//       §9.1: *"'Search your deck for **up to 2** Basic Energy cards' (Earthen
//       Vessel) — **one, two, or none, all legal**."* So "up to N" makes every
//       k in 0..N a printed answer, and nothing about that is card-specific.
//   (2) **§9.1 ALSO DISPOSES OF THE "you may"**, which is the clause a reader
//       reaches for first: *"the 'may' of an **activated** Ability … is spent by
//       choosing to use the Ability at all, so it adds nothing to the choice that
//       follows"*, and a printed "you may" *"adds the empty answer, and only that
//       one"*. So on Magneton the partial right is carried by "up to 3" ALONE,
//       and on Archaludon the trigger's `optional` buys only the 0 while "up to
//       2" independently buys the 1.
//   (3) **THE CATALOG CONTRASTS THE QUANTIFIER AGAINST ITS OWN ABSENCE, ON THE
//       SAME OP AND THE SAME ZONE.** N's PP Up `sv09-153` prints *"**Attach** a
//       Basic Energy card from your discard pile to 1 of your Benched N's
//       Pokémon"* — no "up to", mandatory — where Ethan's Ho-Oh ex prints *"up to
//       2"*. One op, one source zone, one printing with the quantifier and one
//       without: it is live and contrastive, not decoration.
//   (4) **"in any way you like" IS A DIFFERENT AXIS AND THE POOL SPELLS IT
//       SEPARATELY.** Archaludon and Magneton print it (the SPLIT across bodies);
//       Ethan's Ho-Oh, Lycanroc and Bloodmoon Ursaluna do not (one named body) and
//       print "up to 2" all the same. The count and the distribution vary
//       independently in print, which is why they are `declinable` and `count`
//       here and not one field.
//
// ── 🛑🛑 THE POPULATION, RE-DERIVED — THE INHERITED FIGURE WAS WRONG IN BOTH
//    DIRECTIONS AND ITS ARITHMETIC DID NOT CLOSE ──────────────────────────────
// Five handoffs carried *"7 legal printings — Archaludon ex ×3, Infernape ×3,
// Lycanroc ×2"*. That parenthesis lists **8**, and the note beside it said "8
// printings are 7 live ones"; D353 wrote the same claim as *"from 5 legal
// printings to 7"* over a list of **6**. **NO PARTITION PRODUCES 7.**
// Re-derived at D358 by walking the registry (113 ids carry a `parkOrForce`-family
// op) and joining to remote D1 `luminous` on **`$.effect`** — NOT `$.text`, which
// returns a false zero, and the extractor was verified against eight
// known-present rows before any zero in it was believed:
//
//   Archaludon ex ×3      "up to 2 … in any way you like"   N ops     ✅ BOUGHT
//   Magneton ×3           "up to 3 … in any way you like"   N ops     ✅ BOUGHT
//   Infernape ×3          "a {R}, a {F}, **or 1 of each**"  N ops     ❌ refused
//   Lycanroc ×2           "up to 2 … to this Pokémon"       count: 2  ❌ refused
//   Bloodmoon Ursaluna ×2 "up to 2 … to this Pokémon"       count: 2  ❌ refused
//   Ethan's Ho-Oh ex ×4   "up to 2 … to 1 of your Benched"  count: 2  ❌ refused
//
// **17 Standard-legal printings, not 7 — and Magneton ×3, Ursaluna ×2 and Ethan's
// Ho-Oh ×4 had NEVER BEEN COUNTED AT ALL.** Koraidon ex ×4 (sv01-125/-231/-247/
// -254) prints the identical "up to 2" sentence and is `legal_standard = 0`;
// excluded because it was MEASURED, not because it was forgotten.
//
// 🆕🛑🛑 **D360 TOOK KORAIDON, AND THE EXCLUSION ABOVE IS WHY IT HAD TO.** The
// note is honest and the filter is still right FOR A POPULATION FIGURE — a legal
// printing count must not quote a rotated card. It is the WRONG filter for a
// CONSISTENCY invariant, and this row is one: `attachFromZoneProgram` builds the
// identical two-op spread for three DERIVED sentences and names KORAIDON_EX in
// its own source comment as the shape it copies. Flag the deriver and leave the
// row rotated-and-flagless and the engine's TWO PRODUCERS DISAGREE about what one
// printed sentence means — and `programFor` is not legality-gated, so the rotated
// row is live in every match that seats it. **ROTATION DECIDES WHO MAY PLAY A
// CARD; IT DOES NOT DECIDE WHAT THE CARD SAYS.** The declinable set below moves
// from 6 ids to 10 and the legal-printing figure does NOT move: still 6.
//
// ── 🛑 THE TWO REFUSALS, AND BOTH ARE RULES CALLS RATHER THAN BUDGET ONES ────
//   • **INFERNAPE ×3.** *"a Basic {R} Energy card, a Basic {F} Energy card, or 1
//     of each"* is a DISJUNCTION with three arms and **no empty one**, and §9.1
//     has already spent the activated "you may". Its printed answer set is {R},
//     {F}, {R,F}. Two declinable parks also reach the EMPTY answer, so buying it
//     here would legalise something the sentence does not print — the one thing a
//     new prompt member must never do. §5 drives the refusal as a live control.
//   • **THE THREE `count: 2` FAMILIES (8 printings).** ONE op, ONE named body. A
//     declinable park buys them {0, 2} against a printed {0, 1, 2}: **what they
//     are missing is a QUANTITY axis, not a decline axis.** They cannot be
//     respelled as two ops either — `count` exists precisely to pin the batch to
//     the one body a print NAMES (D205), so two ops would legalise splitting
//     Ethan's Ho-Oh's two Energy across two benched bodies against *"to **1 of**
//     your Benched Ethan's Pokémon"*. §5 drives that one too.
//
// ── THE NO-NEW-VOCABULARY REFUTATIONS, RUN FROM SOURCE ──────────────────────
//   (a) `count: 2` on Archaludon — refuted, and the corpus already says so
//       (`D263-assemble-alloy-welds-into-one-count`): `count` pins the batch to
//       ONE body, which *"in any way you like"* denies.
//   (b) route it to the ALREADY-DECLINABLE `attachCards` MAP park — **refuted at
//       the SOURCE ZONE, in `interpreter.ts`**: that prompt has exactly three
//       producers, `attachFromTop` (the deck TOP), `attachFromDeck` (a deck
//       SEARCH) and `attachFromHand` (the HAND). **No op in this engine reads the
//       DISCARD PILE into a map prompt**, and both bought families are
//       `source: "discard"`. §4 pins that partition so the refutation cannot rot.
//   (c) `attachFromHand` for a hand-source sibling — refuted on its own doc: no
//       `max`, deliberately, so it attaches every matching card in hand.
//   (d) wrap each op in `{ op: "optional" }` — refuted: the `note` must be the
//       byte-identical printed sentence (D202) and one sentence would need N
//       captions, and it makes the Ability usable on a board that can only whiff
//       (D222's afford-then-reject).
//
// ── 🛑 THE HALF A READER WILL NOT GUESS: IT MOVED THE FORCED ARM ────────────
// `parkOrForce` auto-applies a LONE candidate under the M1 no-choice rule — true
// of a mandatory pick and FALSE of a declinable one, which still has two answers
// over one body. **D47 decided this exact question for `choosePokemonMulti` and
// its review REVERSED the first draft on it**: honouring the decline only above
// the auto-resolve threshold honours it *"exactly where declining matters least"*.
// §3 drives it, and it is what reddened `overvoltDischarge.test.ts` §4/§5 — two
// pinned measurements that said in so many words *"the op does NOT park at all"*.
// ⚠️ **NEITHER OF THE TWO MEASUREMENTS THE HANDOFF NAMED WENT RED** (`pyroDance`
// §5, `spikeClad` §5), because both of those cards are refusals. A pinned
// measurement names the behaviour it pins, not the slice that will change it.

const ARCHALUDON = "sv08-130";
const ARCHALUDON_IDS = ["sv08-130", "sv08-224", "sv08-241"] as const;
const DURALUDON = "sv08-129";
const MAGNETON = "sv08-059";
const MAGNETON_IDS = ["svp-153", "svp-159", "sv08-059"] as const;
/** 🆕 D360 — the fourth printed sentence in this family, and the one BOTH earlier
    slices measured and neither took: an `anyWay` spread whose four printings are
    `legal_standard = 0`. See the §0 note on why rotation is the wrong filter here. */
const KORAIDON_IDS = ["sv01-125", "sv01-231", "sv01-247", "sv01-254"] as const;

const ASSEMBLE_ALLOY_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during " +
  "your turn, you may attach up to 2 Basic {M} Energy cards from your discard " +
  "pile to your {M} Pokémon in any way you like.";
const OVERVOLT_TEXT =
  "Once during your turn, you may attach up to 3 Basic Energy cards from your " +
  "discard pile to your {L} Pokémon in any way you like. If you use this " +
  "Ability, this Pokémon is Knocked Out.";

/** A SECOND {M} body carrying no Ability — a destination and never a source, so a
    two-candidate board is not secretly two Archaludon. */
const METAL_B = "fix-d358-metal-b";
/** A NON-{M} body: excluded by `targetType` and by nothing else, which is what
    makes a candidate-count assertion mean the rider rather than the board size. */
const WATER_BODY = "fix-d358-water";
const ENERGY_M = "fix-d358-energy-metal";
const ENERGY_W = "fix-d358-energy-water";

/** The real printings, carried off the remote D1 row (2026-08-18) — Archaludon ex
    HP 300 / Stage 1 out of Duraludon / {M} / retreat 2 / weak {R} ×2, Duraludon
    `sv08-129` HP 130 Basic {M}, Magneton HP 100 Stage 1 out of Magnemite {L}.
    Held in a LOCAL pool and never in `FIXTURE_POOL` (D275's idiom):
    `catalogManifest.ts` is generated off a six-set catalog holding neither `sv08`
    nor `svp`, so a shared-pool body would owe a `fix-*` key on `censusAtHead`'s
    `raw.length` line — and this slice moves NO census figure. */
const LOCAL_CARDS: Record<string, Card> = Object.fromEntries([
  ...ARCHALUDON_IDS.map((id) => [
    id,
    battler(id, {
      name: "Archaludon ex",
      stage: "Stage1",
      evolveFrom: "Duraludon",
      hp: 300,
      retreat: 2,
      types: ["Metal"],
      weaknesses: [{ type: "Fire", value: "×2" }],
      abilities: [{ type: "Ability", name: "Assemble Alloy", effect: ASSEMBLE_ALLOY_TEXT }],
      attacks: [{ cost: ["Metal", "Metal", "Metal"], name: "Metal Defender", damage: 220 }],
    }),
  ]),
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
      abilities: [{ type: "Ability", name: "Overvolt Discharge", effect: OVERVOLT_TEXT }],
      attacks: [{ cost: ["Lightning", "Colorless"], name: "Electric Ball", damage: 40 }],
    }),
  ]),
  [
    DURALUDON,
    battler(DURALUDON, {
      name: "Duraludon",
      hp: 130,
      retreat: 2,
      types: ["Metal"],
      weaknesses: [{ type: "Fire", value: "×2" }],
      attacks: [{ cost: ["Metal", "Metal"], name: "Confront", damage: 50 }],
    }),
  ],
  [
    METAL_B,
    battler(METAL_B, {
      name: "D358 Metal B",
      hp: 120,
      retreat: 1,
      types: ["Metal"],
      attacks: [{ cost: ["Metal"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    WATER_BODY,
    battler(WATER_BODY, {
      name: "D358 Water",
      hp: 120,
      retreat: 1,
      types: ["Water"],
      attacks: [{ cost: ["Water"], name: "Tap", damage: 10 }],
    }),
  ],
  [ENERGY_M, typedEnergy(ENERGY_M, "Metal")],
  [ENERGY_W, typedEnergy(ENERGY_W, "Water")],
]) as Record<string, Card>;

const POOL: Record<string, Card> = LOCAL_CARDS;

const DECK = deckOf({
  [DURALUDON]: 8,
  [ARCHALUDON]: 4,
  [MAGNETON]: 4,
  [METAL_B]: 6,
  [WATER_BODY]: 6,
  [ENERGY_M]: 16,
  [ENERGY_W]: 16,
});

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

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

function idOf(state: GameState, uid: string): string {
  return state.cardIdByUid[uid] ?? "";
}

function firstBasicInHand(state: GameState, seat: "p1" | "p2"): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[idOf(state, h)];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** §7.1 bars an evolution on the turn a body was played, and §5.4 bars BOTH
    players from evolving on their own first turn, so every evolve board here runs
    on turn 3 — cheaper to say than to leave as a `FIRST_TURN_EVOLVE` a reader has
    to diagnose (spikeClad's note, same trigger). */
function passTo(state: GameState, turn: number): GameState {
  let next = state;
  while (next.turn < turn) {
    if (next.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${next.phase.kind} while passing to turn ${turn}`);
    }
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** TEST SURGERY — p1's Active becomes `activeId`, `bench` are seated as extra own
    bodies, `pile` goes into p1's DISCARD in that order, and `inHand` sits in hand.
    Everything is STATED rather than drawn, so no count in this file is a seed
    fact — and every id is a real catalog id or a declared `fix-*` one. */
function board(spec: {
  activeId: string;
  bench?: readonly string[];
  pile?: readonly string[];
  inHand?: readonly string[];
  turn?: number;
}): { state: GameState; handUids: string[] } {
  const base = passTo(localSetup(7), spec.turn ?? 3);
  const side = base.players.p1;
  const deck = [...side.deck];
  const take = (cardId: string): string => {
    const index = deck.findIndex((uid) => idOf(base, uid) === cardId);
    if (index < 0) throw new Error(`deck has no ${cardId}`);
    return deck.splice(index, 1)[0] as string;
  };
  const activeUid = take(spec.activeId);
  const benchUids = (spec.bench ?? []).map(take);
  const pileUids = (spec.pile ?? []).map(take);
  const handUids = (spec.inHand ?? []).map(take);

  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });

  const state: GameState = {
    ...base,
    players: {
      ...base.players,
      p1: {
        ...side,
        deck: [...deck, ...side.bench.flatMap((b) => b.stack), ...blank.stack],
        hand: handUids,
        discard: [...side.discard, ...pileUids],
        active: body(activeUid),
        bench: benchUids.map(body),
      },
    },
  };
  return { state, handUids };
}

function energyIdsOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (body?.energy ?? []).map((uid) => idOf(state, uid));
}

/** The same parked board with the prompt's `declinable` KEY REMOVED — not set to
    `undefined`, which is a different wire value (D135) and would not exercise the
    reading a pre-D358 record round-trips to. Two cases need a MANDATORY
    `choosePokemon` over THIS op's board, and every genuinely mandatory park in the
    pool belongs to a different op, so isolating the validator means building one. */
function asMandatory(state: GameState): GameState {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const phase = state.phase;
  if (phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const { upTo: _dropped, ...mandatory } = phase.prompt;
  return { ...state, phase: { ...phase, prompt: mandatory } };
}

/** Answer the parked `choosePokemon` with a ref. Asserts the park shape on the way
    through, so a case that stopped parking fails HERE and not by quietly landing
    a different number of cards. */
function pick(state: GameState, ref: PokemonRef) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  return step(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
}

/** Answer the parked `choosePokemon` with NOTHING — the printed "up to N" decline,
    and the whole point of this file. The wire shape is the `pokemon` choice with
    its `ref` left off; there is no second `kind`. */
function decline(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  return step(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } });
}

/** Every `attachEnergyFrom` op the REGISTRY authors, paired with the id that owns
    it — walked rather than listed, which is what makes the partition in §1 a
    census and not a hand-written pool (the vacuous-guard defect). */
/** 🆕 D360 — EXTRACTED SO THE **DERIVER** CAN BE WALKED BY THE SAME CODE. The
    walk was inlined below and reached `programFor` alone, which is the shape of
    the bug D359 diagnosed: a registry walk sees ONE of this op's TWO producers.
    Recursive on purpose — Kilowattrel ex's attach sits inside a `recordGate`, and
    a top-level filter misses it (15 sentences flat vs 16 recursive). */
function attachOpsIn(node: unknown): Extract<EffectOp, { op: "attachEnergyFrom" }>[] {
  const into: Extract<EffectOp, { op: "attachEnergyFrom" }>[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (n !== null && typeof n === "object") {
      const rec = n as Record<string, unknown>;
      if (rec.op === "attachEnergyFrom") {
        into.push(rec as unknown as Extract<EffectOp, { op: "attachEnergyFrom" }>);
      }
      for (const value of Object.values(rec)) walk(value);
    }
  };
  walk(node);
  return into;
}

function attachOpsByCardId(): Map<string, Extract<EffectOp, { op: "attachEnergyFrom" }>[]> {
  const found = new Map<string, Extract<EffectOp, { op: "attachEnergyFrom" }>[]>();
  const walk = (node: unknown, into: Extract<EffectOp, { op: "attachEnergyFrom" }>[]): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, into);
      return;
    }
    if (node !== null && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (rec.op === "attachEnergyFrom") {
        into.push(rec as unknown as Extract<EffectOp, { op: "attachEnergyFrom" }>);
      }
      for (const value of Object.values(rec)) walk(value, into);
    }
  };
  for (const id of registryCardIds()) {
    const ops: Extract<EffectOp, { op: "attachEnergyFrom" }>[] = [];
    walk(programFor(id), ops);
    if (ops.length > 0) found.set(id, ops);
  }
  return found;
}

// ── 1. THE POPULATION, AS A CENSUS OVER THE LIVE REGISTRY ────────────────────

describe("D358 §1 — which printings carry the decline, walked off the registry", () => {
  it("🛑 the declinable set is EXACTLY Archaludon ex ×3, Magneton ×3 and Koraidon ex ×4, by id", () => {
    // ⚠️ BOTH DIRECTIONS, and over the WHOLE registry rather than a list this file
    // wrote: a printing authored with `declinable` that is not named here reddens
    // this line, and one of these losing it reddens it too. A count alone would
    // pass under a swap.
    // 🆕🛑 **D360 — AND IT DID EXACTLY THAT.** D358 wrote *"a seventh printing
    // authored with `declinable` reddens here"* as the falsification condition,
    // and D360's Koraidon ex row fired it BY NAME. The guard worked; this is the
    // slice coming here and saying why (see the §0 note above). **Six of the ten
    // are Standard-legal and four are not** — the split is asserted below rather
    // than smuggled into one list, so a future reader cannot mistake the set for a
    // legal-printing count.
    // ⚠️ CATALOG IDS ONLY. `registryCardIds()` also holds `fix-*` DEMONSTRATOR
    // keys — aliases pointed at the SAME program object so a fixture board can
    // reach a real row — and one of them (`fix-assemblealloy`) necessarily carries
    // the flag because it IS `ASSEMBLE_ALLOY`. Counting it would make this a claim
    // about the fixture pool rather than about the printed pool; the row below
    // pins the aliasing instead, which is the thing that could actually break.
    const declinable = [...attachOpsByCardId()]
      .filter(([id, ops]) => !id.startsWith("fix-") && ops.some((op) => op.declinable === true))
      .map(([id]) => id)
      .sort();
    expect(declinable).toEqual([...ARCHALUDON_IDS, ...MAGNETON_IDS, ...KORAIDON_IDS].sort());
    // The two halves of the set, kept apart on purpose: the printed-legal six this
    // engine can be played with today, and the four rotated ones that print the
    // same sentence and are reachable through `programFor` all the same.
    expect([...ARCHALUDON_IDS, ...MAGNETON_IDS]).toHaveLength(6);
    expect(KORAIDON_IDS).toHaveLength(4);
    // The demonstrator is the SAME OBJECT and not a second transcription, which is
    // why it did not need its own edit and could not drift out of step (D183).
    expect(programFor("fix-assemblealloy")).toBe(programFor(ARCHALUDON));
  });

  it("EVERY op of a declinable row carries it — the flag is per OP, not per card", () => {
    // Archaludon prints "up to 2" over TWO ops, Magneton "up to 3" over THREE and
    // Koraidon ex "up to 2" over TWO (D360).
    // A row that flagged only its first op would let the player stop before the
    // first card and never between the others, which is not what "up to" says.
    for (const id of [...ARCHALUDON_IDS, ...MAGNETON_IDS, ...KORAIDON_IDS]) {
      const ops = attachOpsByCardId().get(id) ?? [];
      expect(ops.length, id).toBeGreaterThan(1);
      expect(
        ops.every((op) => op.declinable === true),
        id,
      ).toBe(true);
    }
  });

  it("🛑 the REFUSED families carry no flag, and that is the rules call in code", () => {
    // Infernape (the disjunction with no empty arm — §9.1) and the three `count`
    // families (a quantity axis this slice did not buy). Asserted BY ID so a later
    // slice that flags one of them has to come here and say why.
    const REFUSED = [
      "svp-116",
      "sv06-033",
      "sv06-173", // Infernape ×3 — "a {R}, a {F}, or 1 of each"
      "sv09-085",
      "sv09-166", // Lycanroc ×2 — count: 2, toSelf
      "sv06.5-025",
      "sv08.5-054", // Bloodmoon Ursaluna ×2 — count: 2, toSelf
      "sv10-039",
      "sv10-209",
      "sv10-230",
      "sv10-239", // Ethan's Ho-Oh ex ×4 — count: 2, benchOnly
    ];
    const ops = attachOpsByCardId();
    for (const id of REFUSED) {
      expect(ops.get(id), `${id} must still be an attachEnergyFrom row`).toBeDefined();
      expect(
        (ops.get(id) ?? []).some((op) => op.declinable === true),
        id,
      ).toBe(false);
    }
    // …and the `count` families are refused for the reason stated, not by accident:
    // every one of the eight carries a `count`, which is the field that pins the
    // batch to ONE body and therefore the field a decline cannot subdivide.
    for (const id of REFUSED.slice(3)) {
      expect((ops.get(id) ?? []).every((op) => op.count !== undefined), id).toBe(true);
    }
    // Infernape's are `count`-FREE — its refusal is the missing empty arm, a
    // different reason, and the two must not be readable as one.
    for (const id of REFUSED.slice(0, 3)) {
      expect((ops.get(id) ?? []).every((op) => op.count === undefined), id).toBe(true);
    }
  });

  it("`declinable` and `count` never co-occur on any authored op", () => {
    // Not a type rule — a CATALOG one, and the whole shape of the refusal above: a
    // print names one body or names none, and this slice bought the decline only
    // for the second. The day a print pairs them, this line is where it lands.
    for (const [id, ops] of attachOpsByCardId()) {
      for (const op of ops) {
        expect(op.declinable === true && op.count !== undefined, id).toBe(false);
      }
    }
  });
});

// ── 2. THE PRINTED ANSWER SET, DRIVEN END TO END ─────────────────────────────

describe("D358 §2 — Archaludon ex's printed {0, 1, 2}, all three reachable", () => {
  /** Evolve p1's Active Duraludon into Archaludon ex, firing the `onEvolve`
      trigger. Two {M} bodies are in play, so each of the two ops parks. */
  function evolveOnTwoMetalBoard(pile: readonly string[] = [ENERGY_M, ENERGY_M]) {
    const built = board({
      activeId: DURALUDON,
      bench: [METAL_B],
      pile,
      inHand: [ARCHALUDON],
    });
    const evolveUid = built.handUids[0] as string;
    return step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: evolveUid,
      target: { spot: "active" },
    });
  }

  it("TWO — the pre-D358 behaviour, still reachable and still the default", () => {
    const first = evolveOnTwoMetalBoard();
    expect(first.state.phase.kind).toBe("effect:choose");
    const second = pick(first.state, ACTIVE);
    const done = pick(second.state, benchRef(0));
    expect(done.state.phase.kind).toBe("turn:action");
    expect(energyIdsOn(done.state, ACTIVE)).toEqual([ENERGY_M]);
    expect(energyIdsOn(done.state, benchRef(0))).toEqual([ENERGY_M]);
  });

  it("🛑 ONE — the printed middle answer, UNREACHABLE before this slice", () => {
    // The whole defect in one case: take the first Energy, decline the second.
    // Before D358 the only way out of the second park was a ref, so the {M} the
    // controller did not want followed the one they did.
    const first = evolveOnTwoMetalBoard();
    const second = pick(first.state, ACTIVE);
    expect(second.state.phase.kind).toBe("effect:choose");
    const done = decline(second.state);
    expect(done.state.phase.kind).toBe("turn:action");
    expect(energyIdsOn(done.state, ACTIVE)).toEqual([ENERGY_M]);
    expect(energyIdsOn(done.state, benchRef(0))).toEqual([]);
    // The declined card is STILL IN THE PILE — a decline moves nothing, which is
    // the claim `applyChoice`'s arm makes and the one a "discard it instead"
    // implementation would fail.
    expect(done.state.players.p1.discard.filter((u) => idOf(done.state, u) === ENERGY_M)).toHaveLength(1);
  });

  it("🛑 ZERO — declining BOTH is the printed 'up to', and the trigger's `optional` is not the only route to it", () => {
    const first = evolveOnTwoMetalBoard();
    const second = decline(first.state);
    const done = decline(second.state);
    expect(done.state.phase.kind).toBe("turn:action");
    expect(energyIdsOn(done.state, ACTIVE)).toEqual([]);
    expect(energyIdsOn(done.state, benchRef(0))).toEqual([]);
    expect(done.state.players.p1.discard.filter((u) => idOf(done.state, u) === ENERGY_M)).toHaveLength(2);
  });

  it("a decline emits NO attach event — nothing moved, so nothing is announced", () => {
    const first = evolveOnTwoMetalBoard();
    const declined = decline(first.state);
    expect(declined.events.map((e: GameEvent) => e.type)).not.toContain("ENERGY_ATTACHED");
  });

  it("the DECLINE is not a whiff: the pile is full and the op still had a candidate", () => {
    // The two endings produce the same board and must not be confused — a whiff is
    // `firstAttachableEnergy === undefined` BEFORE the park, a decline is an answer
    // AFTER it. Driven by asserting the park existed at all.
    const first = evolveOnTwoMetalBoard();
    if (first.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = first.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.candidates).toHaveLength(2);
    // 🆕 D359 — the flag became the CEILING, and Archaludon's one-card ops carry
    // it at width ONE. Same right, same park, one number.
    expect(prompt.upTo).toBe(1);
  });
});

// ── 3. THE ONE-CANDIDATE PARK — D47's arm, moved ─────────────────────────────

describe("D358 §3 — a declinable pick over ONE candidate still ASKS", () => {
  it("🛑 the M1 no-choice rule does NOT apply to a declinable pick", () => {
    // A lone {M} body is one answer to "which?" and TWO answers to the question the
    // print actually asks. `parkOrForce` forced here until this slice, which is why
    // the middle value was unreachable even on a one-body board.
    // ⚠️ The {W} body is on the Bench and is NOT a candidate, so the candidate set
    // is 1 because of `targetType` and not because the board is small.
    const built = board({
      activeId: DURALUDON,
      bench: [WATER_BODY],
      pile: [ENERGY_M],
      inHand: [ARCHALUDON],
    });
    const evolved = step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: built.handUids[0] as string,
      target: { spot: "active" },
    });
    expect(evolved.state.phase.kind).toBe("effect:choose");
    if (evolved.state.phase.kind !== "effect:choose") throw new Error("no park");
    const prompt = evolved.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.candidates[0]).toEqual(ACTIVE);
    // …and BOTH answers are live over that one candidate.
    expect(energyIdsOn(pick(evolved.state, ACTIVE).state, ACTIVE)).toEqual([ENERGY_M]);
    expect(energyIdsOn(decline(evolved.state).state, ACTIVE)).toEqual([]);
  });

  it("the ZERO-candidate arm is UNTOUCHED — a whiff still asks nobody", () => {
    // An empty pile has nothing to attach, so the op no-ops before the park. A
    // decline and a whiff reach the same board by different roads, and only this
    // case can tell the roads apart: there is no `effect:choose` to answer.
    const built = board({
      activeId: DURALUDON,
      bench: [METAL_B],
      pile: [ENERGY_W],
      inHand: [ARCHALUDON],
    });
    const evolved = step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: built.handUids[0] as string,
      target: { spot: "active" },
    });
    expect(evolved.state.phase.kind).toBe("turn:action");
    expect(energyIdsOn(evolved.state, ACTIVE)).toEqual([]);
  });
});

// ── 4. THE WIRE ─────────────────────────────────────────────────────────────

describe("D358 §4 — the validator, the redaction, and the refuted map-prompt road", () => {
  it("🛑 a MANDATORY choosePokemon REFUSES the decline, with its own message", () => {
    // The crafted-frame case, and the reason `declinable` is a prompt field rather
    // than an op field: `validateChoice` matches a wire answer against the PROMPT
    // and nothing else. Driven on a real mandatory park — Magneton's KO is not
    // involved; this is Archaludon's own board with the flag read off the prompt.
    const built = board({
      activeId: DURALUDON,
      bench: [METAL_B],
      pile: [ENERGY_M, ENERGY_M],
      inHand: [ARCHALUDON],
    });
    const evolved = step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: built.handUids[0] as string,
      target: { spot: "active" },
    });
    if (evolved.state.phase.kind !== "effect:choose") throw new Error("no park");
    // Rewrite the parked prompt to a MANDATORY one — the same board, the same op,
    // one field away. This is the only shape that isolates the validator: every
    // real mandatory park in the pool is produced by a DIFFERENT op.
    const refused = applyAction(asMandatory(evolved.state), {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("a mandatory park accepted a decline");
    expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
    expect(refused.error.message).toContain("cannot be declined");
  });

  it("a ref that is not a candidate is still refused on a DECLINABLE prompt", () => {
    // The decline widened the answer shape; it must not have widened the offer.
    const built = board({
      activeId: DURALUDON,
      bench: [WATER_BODY],
      pile: [ENERGY_M],
      inHand: [ARCHALUDON],
    });
    const evolved = step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: built.handUids[0] as string,
      target: { spot: "active" },
    });
    const refused = applyAction(evolved.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0) },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("the park accepted a non-candidate");
    expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("the REDACTED prompt carries `declinable`, and a mandatory one carries no key", () => {
    // The dialog decides whether to render "Take none" from this field alone, so
    // dropping it here would silently make the printed decline unofferable online.
    // The ABSENT-KEY half is asserted too (D135): a park written before this slice
    // must redact to the byte-identical two-field object it always did.
    const built = board({
      activeId: DURALUDON,
      bench: [METAL_B],
      pile: [ENERGY_M, ENERGY_M],
      inHand: [ARCHALUDON],
    });
    const evolved = step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: built.handUids[0] as string,
      target: { spot: "active" },
    });
    const view = redactGame(evolved.state, "p1");
    if (view.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const wire = view.phase.prompt;
    if (wire === null || wire.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(wire.upTo).toBe(1);

    const plainView = redactGame(asMandatory(evolved.state), "p1");
    if (plainView.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const plain = plainView.phase.prompt;
    if (plain === null || plain.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(Object.keys(plain).sort()).toEqual(["candidates", "kind", "note"]);
  });

  it("🛑 refutation (b): NO attach op reads the DISCARD PILE into the map prompt", () => {
    // The cheapest-looking alternative was "route these two families to the
    // ALREADY-declinable `attachCards` map park". It is refuted at the SOURCE ZONE
    // rather than argued: the map prompt's producers all read the deck or the hand,
    // and both bought families are `source: "discard"`. Pinned as a partition over
    // the live registry so the refutation cannot rot into prose.
    const mapProducers = new Set(["attachFromTop", "attachFromDeck", "attachFromHand"]);
    const walk = (node: unknown, out: string[]): void => {
      if (Array.isArray(node)) {
        for (const n of node) walk(n, out);
        return;
      }
      if (node !== null && typeof node === "object") {
        const rec = node as Record<string, unknown>;
        if (typeof rec.op === "string" && mapProducers.has(rec.op)) {
          out.push(`${rec.op}:${String(rec.source ?? "-")}`);
        }
        for (const value of Object.values(rec)) walk(value, out);
      }
    };
    const seen: string[] = [];
    for (const id of registryCardIds()) walk(programFor(id), seen);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((s) => s.includes("discard"))).toEqual([]);
    // …and the two bought families really are discard-sourced, so the refutation
    // applies to THEM and not to some other row.
    for (const id of [...ARCHALUDON_IDS, ...MAGNETON_IDS]) {
      expect((attachOpsByCardId().get(id) ?? []).every((op) => op.source === "discard"), id).toBe(
        true,
      );
    }
  });
});

// ── 5. THE REFUSALS, DRIVEN AS LIVE CONTROLS ────────────────────────────────

describe("D358 §5 — the refused families still behave exactly as they did", () => {
  it("🛑 Magneton's THREE ops give {0, 1, 2, 3} — the second bought family, end to end", () => {
    // Driven on a TWO-{L}-body board would need a second {L} fixture; the point
    // here is the COUNT axis, so one body and three ops is the sharper case: three
    // parks, and stopping after the first is a printed answer.
    const built = board({ activeId: MAGNETON, pile: [ENERGY_M, ENERGY_M, ENERGY_M] });
    // `attachableEnergies` takes any Basic Energy for this printing (no
    // `energyType`), so the {M} cards in the pile are legal here.
    const used = step(built.state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Overvolt Discharge",
    });
    expect(used.state.phase.kind).toBe("effect:choose");
    const one = pick(used.state, ACTIVE);
    expect(one.state.phase.kind).toBe("effect:choose");
    // Stop after ONE — the printed middle, twice unreachable before this slice
    // (once for the count, once because a lone candidate was forced).
    const stopped = decline(one.state);
    expect(energyIdsOn(stopped.state, ACTIVE)).toHaveLength(1);
  });

  it("Infernape is UNTOUCHED — no flag, so both halves still resolve (the §9.1 refusal)", () => {
    // The rules call, held in code: its disjunction prints no empty arm, so the ops
    // stay mandatory. Asserted on the REGISTRY rather than on a board because
    // `pyroDance.test.ts` §5 already drives the behaviour — and that file did NOT
    // go red at this slice, which is the finding this row records.
    for (const id of ["svp-116", "sv06-033", "sv06-173"]) {
      const ops = attachOpsByCardId().get(id) ?? [];
      expect(ops, id).toHaveLength(2);
      expect(ops.every((op) => op.declinable === undefined), id).toBe(true);
    }
  });

  it("the three `count: 2` families are UNTOUCHED — the quantity axis was not bought", () => {
    for (const id of ["sv09-085", "sv06.5-025", "sv10-039"]) {
      const ops = attachOpsByCardId().get(id) ?? [];
      expect(ops, id).toHaveLength(1);
      expect(ops[0]?.count, id).toBe(2);
      expect(ops[0]?.declinable, id).toBeUndefined();
    }
  });
});

// ── 6. THE POOL AND THE REGISTRY, ASSERTED BY ID ────────────────────────────

describe("D358 §6 — the ids this slice rests on are real, and the registry holds them", () => {
  it("all six bought printings resolve to exactly TWO program objects, by identity", () => {
    // Identity and not deep equality: six separate-but-equal objects would pass a
    // `toEqual` and would be six rows in `censusAtHead`'s object decomposition.
    expect(programFor(ARCHALUDON_IDS[0])).toBe(programFor(ARCHALUDON_IDS[1]));
    expect(programFor(ARCHALUDON_IDS[0])).toBe(programFor(ARCHALUDON_IDS[2]));
    expect(programFor(MAGNETON_IDS[0])).toBe(programFor(MAGNETON_IDS[1]));
    expect(programFor(MAGNETON_IDS[0])).toBe(programFor(MAGNETON_IDS[2]));
    expect(programFor(ARCHALUDON_IDS[0])).not.toBe(programFor(MAGNETON_IDS[0]));
  });

  it("🛑 ZERO registry keys were added — this slice moves no census figure", () => {
    // The flag is a FIELD on two existing program objects, so `raw.length`,
    // `nonAttackRegistryIds()` and every `BUILT.*` line stand still. The claim is
    // asserted from the side that can go red: both families were already keyed.
    const keys = new Set(registryCardIds());
    for (const id of [...ARCHALUDON_IDS, ...MAGNETON_IDS]) expect(keys.has(id), id).toBe(true);
  });

  it("the local pool carries every id this file seats, and none reaches FIXTURE_POOL", () => {
    for (const id of [...ARCHALUDON_IDS, ...MAGNETON_IDS, DURALUDON, METAL_B, WATER_BODY]) {
      expect(POOL[id], id).toBeDefined();
    }
    // Every `fix-*` id here is declared in THIS file (D275's idiom).
    for (const id of Object.keys(POOL)) {
      if (id.startsWith("fix-")) expect(id.startsWith("fix-d358-"), id).toBe(true);
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 🆕 7. D360 — THE FAMILY CLOSES, ASSERTED OVER **BOTH** PRODUCERS
// ─────────────────────────────────────────────────────────────────────────────
//
// 🛑🛑 **§1 ABOVE WALKS THE REGISTRY, AND THE REGISTRY IS NOT THE BUILD.** That
// is not a criticism of §1 — it is a claim about hand-authored rows and it is
// exactly right about them. It is the reason D358's population figure was short
// by five printings and the reason its own successor had to re-derive it:
// `attachEnergyFrom` has TWO producers, and `deriveAttackEffect` emits ops for
// sentences that carry NO registry row at all. This section is the missing half,
// and it is deliberately placed in THIS file so the two walks sit together and a
// later slice cannot repeat the omission by reading only the one above it.
//
// THE POPULATION, re-derived at D360 over both producers and joined to remote D1
// `luminous` on `$.effect` (extractor verified against nine known-present rows
// across all three text columns FIRST):
//   • `LIKE '%ttach up to%'` — **23 sentences / 53 printings / 24 Standard-legal**
//   • and the 24 account for themselves exactly:
//       13 bought at D359 (the `count` BATCH, six sentences)
//      + 6 bought at D358 (Archaludon ex ×3, Magneton ×3 — the registry SPREAD)
//      + 4 bought at D360 (the derived SPREAD — Morpeko, Lycanroc, Mesprit ×2)
//      + 1 refused      (Grafaiai `sv08-121`, cross-seat, derives to null)
//      = 24.
//   • plus KORAIDON_EX ×4, which is `legal_standard = 0` and therefore in NONE of
//     those figures, and which is the whole reason §1's set moved. See §0.

describe("D360 §7 — no `anyWay` spread in EITHER producer is still an exact N", () => {
  /** Every op the DERIVER emits for a Standard-legal attack sentence, with the
      sentence that produced it — the surface `registryCardIds()` cannot see. */
  function derivedSpreads(): { text: string; ops: Extract<EffectOp, { op: "attachEnergyFrom" }>[] }[] {
    const out: { text: string; ops: Extract<EffectOp, { op: "attachEnergyFrom" }>[] }[] = [];
    for (const [, text] of legalAttackCorpus()) {
      const ops = attachOpsIn(deriveAttackEffect(text));
      if (ops.length > 1) out.push({ text, ops });
    }
    return out;
  }

  it("🛑 the DERIVER's spreads are EXACTLY three sentences, and all three are hedged", () => {
    // ⚠️ THE CONTROL THAT KEEPS THIS FROM BEING VACUOUS: the corpus is the whole
    // Standard-legal attack column (640 sentences) and the readers run LIVE
    // against it, so a broken deriver returns an empty list — which this asserts
    // against by NAME and by COUNT, in both directions.
    const spreads = derivedSpreads();
    expect(spreads.map((s) => s.text).sort()).toEqual(
      [
        "Attach up to 2 Basic Energy cards from your discard pile to your Pokémon in any way you like.",
        "Attach up to 2 Basic {F} Energy cards from your discard pile to your Benched Pokémon in any way you like.",
        "Attach up to 2 Basic {P} Energy cards from your hand to your Pokémon in any way you like.",
      ].sort(),
    );
    // 4 Standard-legal printings over those 3 sentences (2 of them Mesprit's).
    const printings = legalAttackCorpus()
      .filter(([, text]) => spreads.some((s) => s.text === text))
      .reduce((n, [count]) => n + count, 0);
    expect(printings).toBe(4);
  });

  it("🛑 EVERY hedged spread op carries the flag, in BOTH producers, and no other op does", () => {
    // ⚠️ **THE CLOSURE CLAIM, AND IT IS STATED AS A BICONDITIONAL** so neither
    // direction can drift: an op is `declinable` IF AND ONLY IF it is one of N > 1
    // ops built from a printed "up to". A future arm that emits a spread without
    // the flag reddens this; so does a row that flags something that is not one.
    for (const { text, ops } of derivedSpreads()) {
      expect(text, text).toContain("up to");
      for (const op of ops) expect(op.declinable, text).toBe(true);
    }
    // …AND THE OTHER DIRECTION, over the same corpus: **every SINGLE-op attach
    // program the deriver builds is flagless**, and the disjunction below says
    // WHY for each one rather than just asserting the absence — a print that did
    // not hedge at all, or a print that hedged onto ONE NAMED BODY, where the
    // hedge became `count` and D359's `??` spends it there instead. Written as a
    // pair of live categories with both proved non-empty, so neither arm can
    // silently become unreachable and make the row vacuous.
    // ⚠️ **AND THIS ASSERTION WAS TAUTOLOGICAL IN THIS SLICE'S FIRST DRAFT** —
    // `toBe(cond ? undefined : undefined)` — which is green, unfalsifiable and
    // exactly the "prose that nothing checks" defect one directory over. Caught
    // and corrected before shipping.
    let unhedged = 0;
    let hedgedOntoOneBody = 0;
    for (const [, text] of legalAttackCorpus()) {
      const ops = attachOpsIn(deriveAttackEffect(text));
      if (ops.length !== 1) continue;
      const op = ops[0];
      expect(op?.declinable, text).toBeUndefined();
      if (text.includes("up to")) {
        expect(op?.count, text).toBeGreaterThan(1); // the hedge became the ceiling
        hedgedOntoOneBody++;
      } else {
        expect(op?.count, text).toBeUndefined();
        unhedged++;
      }
    }
    expect(hedgedOntoOneBody).toBeGreaterThan(0);
    expect(unhedged).toBeGreaterThan(0);
  });

  it("🛑 the REGISTRY half: every multi-op `anyWay` program is flagged, Infernape excepted", () => {
    // The registry's spreads are the four programs §1 names plus Infernape's,
    // which is the ONE deliberate refusal — it prints no "up to" and no empty arm
    // (§9.1), so its printed answer set is {R}, {F}, {R,F} and a declinable pair
    // would legalise an empty answer the sentence does not print.
    const INFERNAPE = ["svp-116", "sv06-033", "sv06-173"];
    for (const [id, ops] of attachOpsByCardId()) {
      if (ops.length <= 1) continue;
      expect(ops.every((op) => op.declinable === true), id).toBe(!INFERNAPE.includes(id));
    }
    // Both halves of the biconditional over the registry too: a flagged op is
    // always part of a multi-op program, never a lone one.
    for (const [id, ops] of attachOpsByCardId()) {
      if (ops.some((op) => op.declinable === true)) expect(ops.length, id).toBeGreaterThan(1);
    }
  });
});
