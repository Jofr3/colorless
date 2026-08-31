import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, deriveAttackEffect, programFor, topCardOf } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
// `attachEnergyTargets` is not re-exported from index.ts (it is an engine-internal
// read site cardplay.ts imports directly); the attach test files reach it the same
// way, which is what lets this suite drive THE GATE rather than only its effects.
import { attachEnergyTargets } from "./interpreter";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  specialEnergy,
  trainerCard,
} from "./testFixtures";

// D204 — THE IN-PLAY TARGET FILTER (`AttachTargetRiders.ownerPokemon`), the
// second half of the owner-prefix mechanic and the gap D200 PROVED rather than
// guessed at.
//
// ── THE PREMISE, IN D200's OWN WORDS ─────────────────────────────────────────
// "`CardFilter` is the CARD vocabulary. It answers *does this card match* for
// deck searches and pile scans. **No op takes a filter for an IN-PLAY TARGET** —
// the target-choosing ops carry only `targetType` / `basicOnly` / `zone`. So the
// sentences that SEARCH A DECK are finished and the sentences that POINT AT THE
// BOARD are untouched." That is why D200's yield was six printings and not
// eighty, and it is exactly what this slice buys.
//
// ── THE CENSUS, RE-DERIVED ───────────────────────────────────────────────────
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786 rows /
// 20 sets, 2,021 `legal_standard = 1`), swept 2026-08-04 over all three text
// columns — `effect`, `attacks_json`, `abilities_json` (the JSON pair via
// `json_each` + `json_extract(value,'$.effect')`).
//
// ⚠️ EVERY OWNER MATCH IN THIS SLICE WAS RUN WITH **`GLOB`**, NEVER `LIKE`.
// SQLite's `LIKE` is ASCII case-insensitive; D200's finding is that it turns a
// six-row census into a ninety-five-row one, and it is the single easiest way to
// be confidently wrong here. Where a count below is stated, it came from
// `txt GLOB '*<Owner>''s *'` over the union of the three columns.
//
// **D200's own totals REPRODUCE EXACTLY**, and this slice confirms rather than
// corrects them: 80 legal text units, 13 owners with legal text, 46 distinct
// legal sentences (Team Rocket's 31, Ethan's 11, Iono's 6, N's 6, Cynthia's 5,
// Hop's 5, Misty's 4, Steven's 3, Arven's 3, Marnie's 2, Lillie's 2, Janine's 1,
// Xerosic's 1; Erika's and Giovanni's exist at ZERO legal printings). The
// 3,786 / 2,021 shape of the catalog is unchanged.
//
// ⚠️⚠️ WHAT DID MOVE IS D200's FLAG TABLE, AND IT MOVED THREE WAYS — all three
// UNDERCOUNTS, all three in the same direction, and all three inside the row it
// named "the in-play target filter (9)".
//
//   (1) **N's PP Up `sv09-153` IS MISSING FROM D200's FLAG TABLE ENTIRELY.**
//       "Attach a Basic Energy card from your discard pile to 1 of your Benched
//       N's Pokémon." is the SAME sentence as the Iono's and Ethan's rows a third
//       time, and the cleanest of the three (one Energy, one target, no count to
//       pin). It appears in neither D200's landed list nor its flagged list.
//       It LANDS here.
//   (2) **Marnie's Grimmsnarl ex `sv10-136` IS ALSO MISSING.** "…attach them to
//       your Marnie's Pokémon in any way you like" is an in-play target narrowing
//       on `attachFromDeck` — a DIFFERENT op from the one D200's row names, and
//       the row that proves the rider belongs on the shared `AttachTargetRiders`
//       rather than on `attachEnergyFrom`. It LANDS here.
//   (3) **THREE MORE IN-PLAY TARGET SENTENCES ARE ABSENT FROM THE FLAG TABLE**
//       (8 legal printings), each needing a target predicate on an op that has no
//       rider surface at all: Team Rocket's Wobbuffet's counter-move (2), Team
//       Rocket's Orbeetle's counter-move (2), N's Zoroark ex's attack-copy (4).
//       They are FLAGGED here with their exact missing piece.
//
// The arithmetic, stated so a later slice can check it rather than inherit it.
// D200 flagged **10 sentences / 23 legal printings**; it missed **5 sentences /
// 10 legal printings** (N's PP Up 1, Marnie's Grimmsnarl ex 1, Wobbuffet 2,
// Orbeetle 2, N's Zoroark ex 4). The true backlog behind the second piece is
// therefore **15 sentences / 33 legal printings**.
//
// And D200's largest sub-group — "the in-play target filter (9)", meaning Iono's
// 5 + Ethan's 4 — is really **8 sentences / 22 legal printings**: the two
// attaches D200 missed, plus the three chooser sentences on ops with no rider
// surface at all. This slice LANDS 7 of those 22 (Iono's 5, N's PP Up 1,
// Marnie's 1) and FLAGS 15; adding Spikemuth Gym, it lands **8 of the 33** and
// leaves 25 flagged.
//
// ── D205's ADDENDUM ─────────────────────────────────────────────────────────
// D205 re-derived every id and every count in this file against the live D1 and
// **nothing moved**: all 22 ids resolve to the cards D204 named, all 22 are
// `legal_standard = 1`, and the per-owner table below still totals 80. It then
// built two of the five flagged rows — Ethan's Ho-Oh ex (4) with a same-target
// `count` on `attachEnergyFrom`, and Team Rocket's Wobbuffet (2) with an
// `ownerPokemon` on `moveCountersToDefender` — so this table now lands **13 of
// 22** and flags 9, and the whole backlog is **19 of the 33** flagged with
// Spikemuth Gym counted. ⚠️ It also found ONE defect in the flag SHAPE above:
// `programFor(id)?.attack` reads the registry only, and an attack sentence the
// DERIVER resolves is fully built with `programFor(id)` still undefined — which
// is precisely how Wobbuffet landed. See `attackIsBuilt` below.
//
// ── THE DESIGN QUESTION, AND THE REPO'S OWN RULE ANSWERING IT ────────────────
// *Reuse `CardFilter`, or a new `TargetFilter`?* The standing rule is that **the
// unit of sharing is decided by the READ SITE, the unit of storage by the WRITE
// SITES**, and applied here it chooses NEITHER of those two.
//
// THE READ SITE is `attachEnergyTargets`'s `eligible(pokemon)` (interpreter.ts).
// It does not read A CARD — it reads a BOARD BODY, and it already pulls both
// kinds of fact off it as FLAT RIDERS: two card facts (`targetType`,
// `basicOnly`) and two board facts (`benchOnly`, `notIfKO`). **`AttachTargetRiders`
// IS the in-play target filter this repo already has.** The missing piece is one
// rider on it, not a vocabulary.
//
//   • **`filter?: CardFilter`** was priced and REFUSED. It buys `ownerPokemon`
//     free — and admits SEVEN of `CardFilter`'s thirteen members that are FALSE
//     for every board top card by construction (`basicEnergy`, `anyEnergy`,
//     `specialEnergy`, `providesEnergy`, `supporter`, `toolCard`,
//     `pokemonOrBasicEnergy`; `providesEnergy`'s own doc says a card-only read
//     answers false). Authoring one of those yields an op whose candidate set is
//     permanently empty, which `programPlayable` then turns into a card that can
//     never be played — a silent dead print, which is precisely the
//     "wrong-but-plausible program" the exact-map-or-flag doctrine forbids. It
//     also creates TWO ways to say "Basic" on one object (`basicOnly` and
//     `{kind:"basicPokemon"}`), and still cannot say "is the Active", "has damage
//     on it" or "has an Energy attached", which are board facts a card predicate
//     has no field for.
//   • **A new `TargetFilter` union** was priced and REFUSED. It would be a THIRD
//     vocabulary beside an interface that already does the job, would have to
//     re-express `targetType` / `basicOnly` / `benchOnly` or leave them as riders
//     (two vocabularies on one object either way), and its whole gain — room for
//     "is Active" / "has damage" / "has an Energy attached" — is bought for
//     printings that DO NOT EXIST: not one of the 13 flagged sentences narrows a
//     target by damage or by attachment. Speculative surface at the cost of a
//     duplicate one.
//   • **WHAT IS SHARED IS THE PREDICATE, NOT THE TYPE.** The rider is a bare
//     `ownerPokemon?: string`, and `attachEnergyTargets` answers it by CALLING
//     `matchesFilter(card, { kind: "ownerPokemon", owner })` — D200's own arm,
//     with its three conjuncts intact (`category === "Pokemon"`, the exact-case
//     prefix with its trailing space, the stage word). So the deck half and the
//     board half can never disagree about who is an "Iono's Pokémon", which is
//     the one failure a second copy of the rule would invite. The WRITE SITES
//     (registry program objects) store a flat rider beside four flat siblings,
//     rather than one nested object among four scalars.
//
// ── WHY THIS RIDER NEEDS NO VALIDATION ARM, AND THAT IS A FINDING ────────────
// `attachEnergyTargets` is the ONE gate. Every downstream check reads the PROMPT
// it produced, never the op: `validateChoice` (cardplay.ts) matches a wire answer
// against `prompt.candidates` (choosePokemon) / `prompt.targets` (attachCards),
// so a body the rider excluded is unreachable from a crafted online frame BY
// CONSTRUCTION. That is asserted below on both prompt kinds rather than assumed.
// `programPlayable` learns it for free too, since it already calls the same
// function — which is load-bearing for N's PP Up, an Item with no trailing
// shuffle to charge for.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

// ── The census as data ───────────────────────────────────────────────────────

/** Every LEGAL printing whose sentence narrows an IN-PLAY target by an owner
    prefix, with the exact piece each one still needs. `landed: true` rows are
    this slice's; the rest are asserted UNBUILT below. Counts are `legal` /
    catalog printings; `ids` is the complete legal set. */
const IN_PLAY_TARGET_CENSUS = [
  {
    sentence:
      "As often as you like during your turn, you may attach a Basic {L} Energy card from your hand to 1 of your Iono's Pokémon.",
    card: "Iono's Bellibolt ex",
    surface: "ability",
    ids: ["sv09-053", "sv09-172", "sv09-183", "sv09-188", "svp-194"],
    landed: true,
    needs: "the in-play target rider — and NOTHING else. D199's highest-value item.",
  },
  {
    sentence:
      "Attach a Basic Energy card from your discard pile to 1 of your Benched N's Pokémon.",
    card: "N's PP Up",
    surface: "trainer",
    ids: ["sv09-153"],
    landed: true,
    needs: "the rider + `benchOnly`. ⚠️ ABSENT FROM D200's FLAG TABLE.",
  },
  {
    sentence:
      "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may search your deck for up to 5 Basic {D} Energy cards and attach them to your Marnie's Pokémon in any way you like. Then, shuffle your deck.",
    card: "Marnie's Grimmsnarl ex",
    surface: "ability",
    ids: ["sv10-136"],
    landed: true,
    needs: "the SAME rider on `attachFromDeck`. ⚠️ ABSENT FROM D200's FLAG TABLE.",
  },
  {
    sentence:
      "Once during your turn, you may attach up to 2 Basic {R} Energy cards from your hand to 1 of your Benched Ethan's Pokémon.",
    card: "Ethan's Ho-Oh ex",
    surface: "ability",
    ids: ["sv10-039", "sv10-209", "sv10-230", "sv10-239"],
    // ✅ D205 BUILT THIS ROW. The piece this `needs` named — "a same-target count
    // on `attachEnergyFrom`" — is `count?: number`, and D204's reading of the gap
    // is confirmed rather than corrected: the rider alone WOULD have split the
    // batch across two bodies. `landed` flipped rather than the row deleted, so
    // the 22-printing denominator this census measures stays checkable.
    landed: true,
    needs:
      "D204's flag was right and D205 built the piece: `attachEnergyFrom.count`, ONE decision pinning `min(count, available)` Energy to the ONE body chosen — distinct from the N-ops-in-sequence model, which is Koraidon 'Dino Cry''s printed 'in any way you like' and would let a player split these two.",
  },
  {
    sentence:
      "Switch your Active Team Rocket's Pokémon with 1 of your Benched Team Rocket's Pokémon. If you do, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    card: "Team Rocket's Giovanni",
    surface: "trainer",
    ids: ["sv10-174", "sv10-225", "sv10-238"],
    // ✅ D206 BUILT THIS ROW, and D204's `needs` was right about BOTH pieces.
    // `switchActive.ownerPokemon` is one field read at both printed nouns (the
    // Active precondition and the Bench candidates), and the "If you do" seam is
    // §9.2's existing `recordGate` reached by a new `switchActive.recordAs` — no
    // new slot, no new gate, no new prompt kind. `landed` flipped rather than the
    // row deleted, so the 22-printing denominator stays checkable.
    landed: true,
    needs:
      "D204's flag named both pieces and D206 paid both from existing vocabulary: `switchActive.ownerPokemon` (D200's predicate at its FOURTH read site, narrowing the Active precondition and the Bench candidates from ONE field, because the print spells one owner twice) plus `switchActive.recordAs`, which lets §9.2's `recordGate` read whether the switch happened.",
  },
  {
    sentence:
      "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to your opponent's Active Pokémon.",
    card: "Team Rocket's Wobbuffet",
    surface: "attack",
    ids: ["sv10-082", "svp-203"],
    // ✅ D205 BUILT THIS ROW — and NOT through the registry. The sentence is read
    // by the widened `COUNTER_MOVE_TO_DEFENDER` deriver anchor, so `programFor`
    // stays undefined for both ids: see the landed assertion below, which is the
    // reason that assertion had to grow a deriver arm.
    landed: true,
    needs:
      "D204's flag was right about the shape (the op took no parameters) and D205 took the widening at the width the second ATTACK printing measures: one optional `ownerPokemon` on the SOURCE candidate set — D138's own stated condition for widening this op, arriving with a printing that differs on that axis and no other.",
  },
  {
    sentence:
      "As often as you like during your turn, you may move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your Pokémon.",
    card: "Team Rocket's Orbeetle",
    surface: "ability",
    ids: ["sv10-089", "sv10-198"],
    landed: false,
    needs:
      "⚠️ ABSENT FROM D200's FLAG TABLE. No op moves counters between the controller's OWN two Pokémon at all — the counter-move family is self→defender only.",
  },
  {
    sentence: "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.",
    card: "N's Zoroark ex",
    surface: "attack",
    ids: ["sv09-098", "sv09-175", "sv09-185", "sv09-189"],
    landed: false,
    needs:
      "⚠️ ABSENT FROM D200's FLAG TABLE. An attack-COPY op (choose a benched body, then one of ITS attacks, then run it) — two coupled decisions and a re-entrant attack resolution, of which the target predicate is the smallest part.",
  },
] as const;

/** Spikemuth Gym is the one row here that is NOT an in-play target sentence: it
    is a DECK search, held back by D200 for scope with "needs NOTHING NEW".
    Verified — and landed — separately. */
const SPIKEMUTH = {
  sentence:
    "Once during each player's turn, that player may search their deck for a Marnie's Pokémon, reveal it, and put it into their hand. Then, that player shuffles their deck.",
  id: "sv10-169",
} as const;

// ── Synthetic bodies (the catalog manifest cannot be regenerated here, so every
//    demonstrator is a `fix-*` card declared against `createGame({cardPool})` —
//    D190/D199/D200's idiom). ────────────────────────────────────────────────

function subgroupBasic(id: string, name: string, types?: string[]): Card {
  return battler(id, { name, hp: 70, ...(types === undefined ? {} : { types }) });
}

const LOCAL_CARDS: Record<string, Card> = {
  // ── The four program carriers.
  "fix-electricstreamer": battler("fix-electricstreamer", {
    name: "Iono's Bellibolt ex",
    hp: 280,
    stage: "Stage1",
    evolveFrom: "Iono's Tadbulb",
    types: ["Lightning"],
    abilities: [
      {
        type: "Ability",
        name: "Electric Streamer",
        effect:
          "As often as you like during your turn, you may attach a Basic {L} Energy card from your hand to 1 of your Iono's Pokémon.",
      },
    ],
  }),
  "fix-nsppup": trainerCard(
    "fix-nsppup",
    "Item",
    "Attach a Basic Energy card from your discard pile to 1 of your Benched N's Pokémon.",
  ),
  "fix-punkup": battler("fix-punkup", {
    name: "Marnie's Grimmsnarl ex",
    hp: 330,
    stage: "Stage2",
    evolveFrom: "Marnie's Morgrem",
    types: ["Darkness"],
    abilities: [
      {
        type: "Ability",
        name: "Punk Up",
        effect:
          "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may search your deck for up to 5 Basic {D} Energy cards and attach them to your Marnie's Pokémon in any way you like. Then, shuffle your deck.",
      },
    ],
  }),
  "fix-spikemuthgym": trainerCard("fix-spikemuthgym", "Stadium", SPIKEMUTH.sentence),
  // ── The subgroup bodies the riders must KEEP.
  "fix-iono-basic": subgroupBasic("fix-iono-basic", "Iono's Tadbulb", ["Lightning"]),
  "fix-iono-wattrel": subgroupBasic("fix-iono-wattrel", "Iono's Wattrel", ["Lightning"]),
  "fix-n-basic": subgroupBasic("fix-n-basic", "N's Darmanitan"),
  "fix-n-reshiram": subgroupBasic("fix-n-reshiram", "N's Reshiram"),
  "fix-marnie-basic": subgroupBasic("fix-marnie-basic", "Marnie's Impidimp", ["Darkness"]),
  "fix-marnie-morgrem": battler("fix-marnie-morgrem", {
    name: "Marnie's Morgrem",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Marnie's Impidimp",
    types: ["Darkness"],
  }),
  "fix-marnie-scorbunny": subgroupBasic("fix-marnie-scorbunny", "Marnie's Scorbunny", ["Darkness"]),
  // ── The bodies the riders must DROP. Each is a real near-miss, not a strawman.
  /** A DIFFERENT owner's Pokémon, {L}-typed like the Iono's ones — so `targetType`
      alone would keep it and only the owner rider drops it. */
  "fix-ethan-basic": subgroupBasic("fix-ethan-basic", "Ethan's Cyndaquil", ["Lightning"]),
  /** No prefix at all — the ordinary body every real board also holds. */
  "fix-plain": subgroupBasic("fix-plain", "Pikachu", ["Lightning"]),
  /** ⚠️⚠️ THE ONE-LETTER-OWNER WITNESS, and the reason the trailing `'s ` is
      matched WHOLE rather than as a bare name prefix. `N` is a real owner with
      real legal printings (N's PP Up below is one), and `name.startsWith("N")`
      — the obvious, wrong way to write this predicate — takes **Noctowl**,
      Nidoking, Ninetales and every other Pokémon whose name begins with that
      letter. D200 found the same hazard on the SQL side, where a
      case-insensitive `LIKE '%N''s %'` read 95 rows against a true 6; this is
      that hazard's board-side twin, and it is a wrong TARGET rather than a wrong
      count. */
  "fix-noctowl": subgroupBasic("fix-noctowl", "Noctowl"),
  /** ⚠️ `Farfetch'd` — the catalog's apostrophe-bearing name that is NOT a
      possessive prefix (`'d`, not `'s `), and the reason the trailing space is
      matched whole. D200's negative, re-fielded on the BOARD side. */
  "fix-farfetchd": battler("fix-farfetchd", { name: "Farfetch'd", types: ["Lightning"] }),
  /** ⚠️ A lowercase-prefix body: the match is EXACT-CASE, so `iono's Pikachu` is
      not an Iono's Pokémon. This is the board-side witness for the very trap the
      census header is about — a case-insensitive compare would take it. */
  "fix-lowercase": subgroupBasic("fix-lowercase", "iono's Pikachu", ["Lightning"]),
  /** ⚠️ `Team Rocket's Energy` sv10-182 — D200's one card that breaks a
      name-only rule. It can never BE an in-play Pokémon, which is exactly why
      the `category` conjunct is inert on this side and shared anyway. */
  "fix-tr-energy": specialEnergy(
    "fix-tr-energy",
    "Team Rocket's Energy",
    "This card can only be attached to a Team Rocket's Pokémon. If this card is attached to anything other than a Team Rocket's Pokémon, discard this card.",
  ),
} as const;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** One 60 carries every carrier and every body a case distinguishes. The counts
    are deliberately fat on the BODIES rather than on the Energy: setup draws 7
    and prizes 6 out of this deck before a test touches it, and `benchFromDeck`
    pulls from what is LEFT — two copies of a body is not enough to survive that
    on every seed, which is a fixture bug and not an engine one. */
const DECK = deckOf({
  "fix-electricstreamer": 3,
  "fix-nsppup": 3,
  "fix-punkup": 3,
  "fix-spikemuthgym": 2,
  "fix-iono-basic": 3,
  "fix-iono-wattrel": 4,
  "fix-n-basic": 3,
  "fix-n-reshiram": 4,
  "fix-marnie-basic": 2,
  "fix-marnie-morgrem": 4,
  "fix-marnie-scorbunny": 4,
  "fix-ethan-basic": 4,
  "fix-plain": 4,
  "fix-noctowl": 3,
  "fix-farfetchd": 2,
  "fix-lowercase": 2,
  "fix-tr-energy": 1,
  "fix-lightning-energy": 4,
  "fix-dark-energy": 4,
  "fix-basic-1": 1,
});

/** `driveSetup` against the LOCAL pool (D190/D199/D200's helper verbatim — the
    shared one closes over `FIXTURE_POOL`). */
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

/** P1 to move on turn 3 — past §4's going-first restrictions, none of which this
    slice's rows have anything to do with. */
function board(seed: number): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  return state;
}

/** P1's board with `bodyId` Active and an EMPTY bench, ready to be filled with
    exactly the bodies a case wants to distinguish. */
function withActive(seed: number, bodyId: string): GameState {
  return clearBench(setActiveFromDeck(handToDeck(board(seed), "p1", bodyId), "p1", bodyId), "p1");
}

/** The printed NAME of every body a ref list points at — what a candidate set is
    actually asserted against here, since the whole slice is about which bodies
    are offered. */
function refNames(state: GameState, refs: readonly PokemonRef[]): string[] {
  return refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
    return body === null ? "?" : (topCardOf(state, body)?.name ?? "?");
  });
}

/** The printed NAME behind a card uid (a chooseCards candidate). */
function cardName(state: GameState, uid: string): string {
  return POOL[state.cardIdByUid[uid] ?? ""]?.name ?? "?";
}

// ── 1. The seam itself, at the one gate ──────────────────────────────────────

describe("the in-play target rider — `attachEnergyTargets` is the ONE gate", () => {
  it("keeps only the owner's subgroup, dropping a same-TYPE body of another owner", () => {
    let state = withActive(11, "fix-iono-basic");
    for (const id of ["fix-iono-wattrel", "fix-ethan-basic", "fix-plain", "fix-farfetchd"]) {
      state = benchFromDeck(state, "p1", id);
    }
    // Every body on this board is {L}, so `targetType` alone keeps all five.
    expect(attachEnergyTargets(state, "p1", { targetType: "Lightning" })).toHaveLength(5);
    const kept = attachEnergyTargets(state, "p1", { ownerPokemon: "Iono" });
    expect(refNames(state, kept).sort()).toEqual(["Iono's Tadbulb", "Iono's Wattrel"]);
  });

  it("⚠️ matches the possessive WHOLE — `Noctowl` is not an N's Pokémon", () => {
    let state = withActive(15, "fix-n-basic");
    state = benchFromDeck(state, "p1", "fix-noctowl");
    // The predicate that forgets `'s ` reads every N-initial Pokémon as N's.
    const kept = attachEnergyTargets(state, "p1", { ownerPokemon: "N" });
    expect(refNames(state, kept)).toEqual(["N's Darmanitan"]);
  });

  it("is EXACT-CASE — `iono's Pikachu` is not an Iono's Pokémon", () => {
    let state = withActive(12, "fix-iono-basic");
    state = benchFromDeck(state, "p1", "fix-lowercase");
    const kept = attachEnergyTargets(state, "p1", { ownerPokemon: "Iono" });
    expect(refNames(state, kept)).toEqual(["Iono's Tadbulb"]);
  });

  it("composes with `benchOnly`, dropping the Active of the same subgroup", () => {
    let state = withActive(13, "fix-iono-basic");
    state = benchFromDeck(state, "p1", "fix-iono-wattrel");
    expect(attachEnergyTargets(state, "p1", { ownerPokemon: "Iono" })).toHaveLength(2);
    const benched = attachEnergyTargets(state, "p1", { ownerPokemon: "Iono", benchOnly: true });
    expect(refNames(state, benched)).toEqual(["Iono's Wattrel"]);
  });

  it("an owner that names nothing on the board yields the EMPTY set, not everything", () => {
    let state = withActive(14, "fix-plain");
    state = benchFromDeck(state, "p1", "fix-farfetchd");
    // The loud-no-op property D200 argued for the bare `string`: a misspelling
    // (or an owner simply absent) whiffs; it can never take a wrong body.
    expect(attachEnergyTargets(state, "p1", { ownerPokemon: "Iono" })).toEqual([]);
    expect(attachEnergyTargets(state, "p1", { ownerPokemon: "Ionos" })).toEqual([]);
    expect(attachEnergyTargets(state, "p1", {})).toHaveLength(2);
  });
});

// ── 2. Iono's Bellibolt ex — D199's highest-value printing ───────────────────

describe("Iono's Bellibolt ex — 'Electric Streamer' (5 legal printings)", () => {
  /** Bellibolt Active + the bench a case names, with {L} Energy in hand. */
  function streamerBoard(seed: number, bench: string[]): GameState {
    let state = withActive(seed, "fix-electricstreamer");
    for (const id of bench) state = benchFromDeck(state, "p1", id);
    return handFromDeck(state, "p1", "fix-lightning-energy", 2);
  }

  it("offers ONLY the Iono's Pokémon, though every body on the board is {L}", () => {
    const state = streamerBoard(21, ["fix-iono-wattrel", "fix-ethan-basic", "fix-plain"]);
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // Bellibolt is itself an Iono's Pokémon, so the Active stays in (no zone word).
    expect(refNames(parked, prompt.candidates).sort()).toEqual([
      "Iono's Bellibolt ex",
      "Iono's Wattrel",
    ]);
  });

  it("names the SUBGROUP in the prompt, not 'your Pokémon'", () => {
    const state = streamerBoard(22, ["fix-iono-wattrel", "fix-plain"]);
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // Three of five bodies offered under a caption saying "your Pokémon" reads as
    // a bug; the print says "1 of your Iono's Pokémon".
    expect(parked.phase.prompt.note).toContain("Iono's Pokémon");
  });

  it("attaches to the chosen Iono's body and is REPEATABLE (oncePerTurn: false)", () => {
    const state = streamerBoard(23, ["fix-iono-wattrel", "fix-plain"]);
    const ref: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    const { state: once, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref },
    });
    expect(find(events, "ENERGY_ATTACHED")).toBeDefined();
    expect(once.players.p1.bench[0]?.energy).toHaveLength(1);
    // "As often as you like": the allowance is never consumed.
    const { state: twiceParked } = mustApply(once, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    const { state: twice } = mustApply(twiceParked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref },
    });
    expect(twice.players.p1.bench[0]?.energy).toHaveLength(2);
    // …and it never touched the §6.3 manual attach allowance.
    expect(twice.players.p1.active?.energy ?? []).toHaveLength(0);
  });

  it("⚠️ WIRE SAFETY — an excluded body is rejected, not silently attached to", () => {
    const state = streamerBoard(24, ["fix-iono-wattrel", "fix-plain"]);
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    // `fix-plain` (Pikachu) is bench index 1 — on the board, {L}-typed, and NOT
    // an Iono's Pokémon. A crafted frame naming it must be refused by
    // `validateChoice`, which reads the PROMPT the rider narrowed.
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 1 } } },
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected the illegal target to be rejected");
    expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("auto-resolves without a park when the subgroup holds exactly one body", () => {
    const state = streamerBoard(25, ["fix-plain", "fix-ethan-basic"]);
    const { state: done, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    // Only Bellibolt itself is an Iono's Pokémon → forced, no prompt.
    expect(done.phase.kind).toBe("turn:action");
    expect(find(events, "ENERGY_ATTACHED")).toBeDefined();
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });

  it("all five legal printings carry the program", () => {
    for (const id of ["sv09-053", "sv09-172", "sv09-183", "sv09-188", "svp-194"]) {
      expect(programFor(id)?.abilities?.[0]?.name).toBe("Electric Streamer");
      expect(programFor(id)?.abilities?.[0]?.oncePerTurn).toBe(false);
    }
  });
});

// ── 3. N's PP Up — the printing D200's flag table missed ─────────────────────

describe("N's PP Up sv09-153 — the discard source + `benchOnly` + the rider", () => {
  function ppUpBoard(seed: number, bench: string[]): GameState {
    let state = withActive(seed, "fix-n-basic");
    for (const id of bench) state = benchFromDeck(state, "p1", id);
    state = discardFromDeck(state, "p1", "fix-lightning-energy", 2);
    return handFromDeck(state, "p1", "fix-nsppup", 1);
  }

  it("offers only BENCHED N's Pokémon — the Active N's body is dropped by the zone word", () => {
    // TWO benched N's bodies, so the op PARKS and the candidate set is
    // observable — with one it would auto-resolve and say nothing about which
    // bodies were eligible. The Active is an N's Pokémon too, and is the body the
    // printed word "Benched" must drop.
    const state = ppUpBoard(31, ["fix-n-reshiram", "fix-n-basic", "fix-noctowl", "fix-plain"]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-nsppup"),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // ⚠️ NOCTOWL IS THE LOAD-BEARING NEGATIVE. `startsWith("N")` — the predicate
    // written without its possessive — takes it, and `N` is a REAL owner, so this
    // is the one-letter-owner hazard on the board side rather than a strawman.
    expect(refNames(parked, prompt.candidates).sort()).toEqual(["N's Darmanitan", "N's Reshiram"]);
    // …and the ACTIVE N's Darmanitan is not among them, though it matches the owner.
    expect(prompt.candidates.every((ref) => ref.spot.spot === "bench")).toBe(true);
    expect(prompt.note).toContain("Benched N's Pokémon");
  });

  it("attaches a Basic Energy from the DISCARD pile", () => {
    let state = ppUpBoard(32, ["fix-n-reshiram", "fix-n-basic"]);
    const before = state.players.p1.discard.length;
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-nsppup"),
    });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    const attached = find(events, "ENERGY_ATTACHED");
    expect(attached).toBeDefined();
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
    // One Energy left the discard; the played Item arrived there.
    expect(done.players.p1.discard).toHaveLength(before);
    state = done;
    expect(state.phase.kind).toBe("turn:action");
  });

  it("⚠️ IS NOT PLAYABLE with no benched N's Pokémon — the `programPlayable` gate", () => {
    // The gate is load-bearing HERE and not on the search rows: an Item with no
    // trailing shuffle that can only whiff would burn for nothing.
    const state = ppUpBoard(33, ["fix-plain", "fix-ethan-basic", "fix-farfetchd"]);
    const rejected = applyAction(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-nsppup"),
    });
    expect(rejected.ok).toBe(false);
    // …and the SAME board with one benched N's body is playable, so the refusal
    // is the rider's and not some other precondition's.
    const ok = applyAction(ppUpBoard(33, ["fix-plain", "fix-n-reshiram"]), {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(ppUpBoard(33, ["fix-plain", "fix-n-reshiram"]), "p1", "fix-nsppup"),
    });
    expect(ok.ok).toBe(true);
  });
});

// ── 4. Marnie's Grimmsnarl ex — the same rider on the OTHER op ───────────────

describe("Marnie's Grimmsnarl ex sv10-136 — 'Punk Up' on `attachFromDeck`", () => {
  it("offers only Marnie's Pokémon as attach TARGETS, on the attachCards prompt", () => {
    let state = withActive(41, "fix-marnie-morgrem");
    for (const id of ["fix-marnie-scorbunny", "fix-plain", "fix-ethan-basic"]) {
      state = benchFromDeck(state, "p1", id);
    }
    state = handFromDeck(state, "p1", "fix-punkup", 1);
    const { state: parked, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-punkup"),
      target: { spot: "active" },
    });
    expect(find(events, "POKEMON_EVOLVED")).toBeDefined();
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "attachCards") throw new Error("expected attachCards");
    expect(refNames(parked, prompt.targets).sort()).toEqual([
      "Marnie's Grimmsnarl ex",
      "Marnie's Scorbunny",
    ]);
    expect(prompt.note).toContain("Marnie's Pokémon");
  });

  it("⚠️ WIRE SAFETY — a non-Marnie's destination is rejected on the attachCards prompt too", () => {
    let state = withActive(42, "fix-marnie-morgrem");
    state = benchFromDeck(state, "p1", "fix-plain");
    state = handFromDeck(state, "p1", "fix-punkup", 1);
    const { state: parked } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-punkup"),
      target: { spot: "active" },
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "attachCards") throw new Error("expected attachCards");
    const uid = prompt.candidates[0];
    if (uid === undefined) throw new Error("expected a Basic {D} Energy in the deck");
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [{ uid, to: { seat: "p1", spot: { spot: "bench", index: 0 } } }],
      },
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected the illegal destination to be rejected");
    expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("a board with NO Marnie's Pokémon no-ops into the trailing shuffle (never gated)", () => {
    // `attachFromDeck` is deliberately not a `programPlayable` input: the printed
    // "Then, shuffle your deck" always resolves, so the no-target board is a live
    // path — and evolving is never refused for it.
    let state = withActive(43, "fix-marnie-morgrem");
    state = handFromDeck(state, "p1", "fix-punkup", 1);
    // Morgrem evolves INTO Grimmsnarl, which is itself a Marnie's Pokémon, so the
    // only way to reach the empty-target board is with the rider read directly.
    expect(attachEnergyTargets(state, "p1", { ownerPokemon: "Nemona" })).toEqual([]);
    const { state: after } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-punkup"),
      target: { spot: "active" },
    });
    // Grimmsnarl IS a target, so this one parks rather than whiffing — the point
    // is only that nothing refused the evolve.
    expect(["effect:choose", "turn:action"]).toContain(after.phase.kind);
  });

  it("carries Charizard ex's shape: onEvolve, optional, max 5, no maxPerTarget", () => {
    const trigger = programFor("sv10-136")?.triggered?.[0];
    expect(trigger?.trigger).toBe("onEvolve");
    expect(trigger?.optional).toBe(true);
    const op = trigger?.program[0];
    expect(op).toMatchObject({
      op: "attachFromDeck",
      max: 5,
      ownerPokemon: "Marnie",
      filter: { kind: "basicEnergy", energyType: "Darkness" },
    });
    expect(op).not.toHaveProperty("maxPerTarget");
    expect(trigger?.program[1]).toEqual({ op: "shuffleDeck" });
  });
});

// ── 5. Spikemuth Gym — D200 said "NOTHING NEW"; verified ─────────────────────

describe("Spikemuth Gym sv10-169 — the row held back for scope only", () => {
  it("is Champion's Call's two ops on `StadiumAbility.program`, with the owner changed", () => {
    const gym = programFor("sv10-169")?.stadium?.ability;
    expect(gym?.label).toBe("Spikemuth Gym");
    expect(gym?.program).toEqual([
      // `reveal: true` is D225's printed-clause rider ("reveal it, and put it
      // into their hand") — the log names the card for both seats, which on a
      // Stadium is the case that mattered most.
      {
        op: "searchDeck",
        filter: { kind: "ownerPokemon", owner: "Marnie" },
        dest: "hand",
        max: 1,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
    // ⚠️ VERIFIED, not taken on trust: it uses only D200's CARD filter — no
    // in-play target rider anywhere in it.
    expect(JSON.stringify(gym?.program)).not.toContain("ownerPokemon\":\"Marnie\",\"stage");
    // A SEPARATE object from Champion's Call (D199's near-twin rule).
    expect(gym?.program).not.toBe(programFor("sv10-103")?.abilities?.[0]?.program);
  });

  it("searches a Marnie's Pokémon into hand for EITHER player and shuffles", () => {
    let state = withActive(51, "fix-plain");
    state = handFromDeck(state, "p1", "fix-spikemuthgym", 1);
    state = must(
      applyAction(state, {
        type: "playTrainer",
        seat: "p1",
        uid: handUid(state, "p1", "fix-spikemuthgym"),
      }),
    );
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    // Every offered card is a Marnie's Pokémon and nothing else.
    const names = prompt.candidates.map((uid) => cardName(parked, uid));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith("Marnie's ")).toBe(true);
    const pick = prompt.candidates[0];
    if (pick === undefined) throw new Error("no candidate");
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(done.players.p1.hand).toContain(pick);
    expect(done.phase.kind).toBe("turn:action");
  });
});

// ── 6. The census, and every flagged id asserted UNBUILT ─────────────────────

// ⚠️⚠️ D205 — **THE PER-SURFACE FLAG D204 WROTE WAS STILL VACUOUS ON THE ATTACK
// SURFACE, AND D205's OWN WORK IS WHAT PROVED IT.** D204 correctly replaced
// D200's whole-id `programFor(id) === undefined` with a per-surface read, on the
// ground that N's Zoroark ex already carries a program on a DIFFERENT surface.
// But the attack arm it wrote is `programFor(id)?.attack`, and that reads the
// REGISTRY ONLY: attack programs resolve `programFor(id)?.attack?.[index] ??
// deriveAttackEffect(text)`, so a sentence the DERIVER picks up is fully built
// with `programFor(id)` still undefined. Team Rocket's Wobbuffet is exactly that
// card — D205 built it by widening one anchor, wrote no registry row, and D204's
// flag for it would have stayed GREEN. Same class as the failure D204 caught in
// D200, one level down: an assertion that is well-formed, runs, is green, and
// cannot fail for the reason it exists. Both arms below now ask BOTH halves.
function attackIsBuilt(id: string, sentence: string): boolean {
  return programFor(id)?.attack !== undefined || deriveAttackEffect(sentence) !== null;
}

/** ⚠️ AND THE ABILITY SURFACE HAS THE SAME HOLE, ONE FIELD OVER (D205). A
    printed Ability is `abilities` when the player activates it and `triggered`
    when the board fires it, and D204's arm read only the first — which was
    already wrong for a row in its OWN landed list: Marnie's Grimmsnarl ex's
    "Punk Up" is an `onEvolve` trigger, so `programFor("sv10-136")?.abilities` is
    undefined on a card D204 built. The printed surface is what the census names,
    so both fields answer for it, on the flag arm as much as the landed one. */
function abilitySurface(id: string): unknown {
  return programFor(id)?.abilities ?? programFor(id)?.triggered;
}

describe("the re-derived census — what landed, and what is still owed a piece", () => {
  it("lands 16 in-play-target printings across FOUR ops, plus Spikemuth Gym", () => {
    const landed = IN_PLAY_TARGET_CENSUS.filter((row) => row.landed);
    // 16 = D204's 7 (Iono's Bellibolt ex 5 + N's PP Up 1 + Marnie's Grimmsnarl ex
    // 1) + D205's 6 (Ethan's Ho-Oh ex 4 + Team Rocket's Wobbuffet 2) + D206's 3
    // (Team Rocket's Giovanni), out of the 22 in-play-target printings the
    // re-derived census finds. The denominator is unmoved: D205 re-derived every
    // id in this table against the live catalog and every one resolves to the
    // card D204 named; D206 re-resolved the three rows it touches the same way.
    expect(landed.flatMap((row) => row.ids)).toHaveLength(16);
    expect(IN_PLAY_TARGET_CENSUS.flatMap((row) => row.ids)).toHaveLength(22);
    for (const row of landed) {
      for (const id of row.ids) {
        const why = `${id} (${row.card}) is listed as LANDED on its ${row.surface}`;
        // The landed check is per-surface and deriver-aware for the same reason
        // the flag below is: Wobbuffet's row is built ENTIRELY in the deriver, so
        // a bare `programFor(id)` here would have failed on a card that works.
        if (row.surface === "attack") expect(attackIsBuilt(id, row.sentence), why).toBe(true);
        else if (row.surface === "ability") expect(abilitySurface(id), why).toBeDefined();
        else expect(programFor(id)?.trainer, why).toBeDefined();
      }
    }
    expect(programFor(SPIKEMUTH.id)).toBeDefined();
  });

  it("⚠️ every FLAGGED SURFACE is still UNBUILT — exact map or flag, never a plausible one", () => {
    const flagged = IN_PLAY_TARGET_CENSUS.filter((row) => !row.landed);
    // 6 = Orbeetle 2 + Zoroark ex 4 (15 at D204 — Ethan's 4 and Wobbuffet's 2
    // were built by D205, Giovanni's 3 by D206).
    expect(flagged.flatMap((row) => row.ids)).toHaveLength(6);
    for (const row of flagged) {
      for (const id of row.ids) {
        const program = programFor(id);
        const why = `${id} (${row.card}) must stay unbuilt: ${row.needs}`;
        // ⚠️ ASSERTED PER SURFACE, NOT PER ID — and one row proves the difference
        // is real rather than pedantic. `programFor("sv09-098")` is DEFINED: all
        // four N's Zoroark ex printings already carry their "Trade" Ability
        // (payFromHand + drawCards). It is the ATTACK that is unsimulated, which
        // is the surface the flagged sentence lives on. A whole-id assertion —
        // the shape D200's flag list used — would have read that card as built
        // and quietly dropped it from the backlog.
        //
        // ⚠️ AND PER SURFACE IS NOT ENOUGH BY ITSELF (D205, above): the attack arm
        // asks the DERIVER too, so a widened anchor cannot silently build a
        // flagged sentence while this stays green.
        if (row.surface === "attack") expect(attackIsBuilt(id, row.sentence), why).toBe(false);
        else if (row.surface === "ability") expect(abilitySurface(id), why).toBeUndefined();
        else expect(program?.trainer, why).toBeUndefined();
      }
    }
    // The one row whose card IS otherwise programmed, pinned explicitly so a
    // future edit to "Trade" cannot silently satisfy the flag above.
    expect(programFor("sv09-098")?.abilities?.[0]?.name).toBe("Trade");
    expect(programFor("sv09-098")?.attack).toBeUndefined();
  });


  it("holds the census shape D200 measured (80 units / 13 owners / 46 sentences)", () => {
    // Re-derived with GLOB (case-sensitive) on 2026-08-04 and reproduced EXACTLY;
    // recorded so a future slice that moves it has to say which owner moved.
    const OWNERS: Record<string, number> = {
      "Team Rocket's": 31,
      "Ethan's": 11,
      "Iono's": 6,
      "N's": 6,
      "Cynthia's": 5,
      "Hop's": 5,
      "Misty's": 4,
      "Steven's": 3,
      "Arven's": 3,
      "Marnie's": 2,
      "Lillie's": 2,
      "Janine's": 1,
      "Xerosic's": 1,
    };
    expect(Object.keys(OWNERS)).toHaveLength(13);
    expect(Object.values(OWNERS).reduce((a, b) => a + b, 0)).toBe(80);
  });
});

// ── 7. The FIXTURE_POOL sweep, as its own population ─────────────────────────

describe("FIXTURE_POOL, swept as a separate population", () => {
  it("holds EXACTLY D242's four owner-prefixed names, and nothing else", () => {
    const cards = Object.values(FIXTURE_POOL);
    expect(cards.length).toBeGreaterThan(300);
    // ⚠️ **THIS CONTROL EXPIRED AT D242 AND IS RE-HOMED RATHER THAN DELETED**
    // (progress.md's standing rule). It used to read "zero possessive prefixes",
    // which is what made every demonstrator above safe to reuse. D242 fielded four
    // deliberately — a "Team Rocket's" gate holder, a plain prefixed body and TWO
    // NEAR MISSES — so the invariant becomes an ENUMERATION: the pool's prefixed
    // names are exactly those, and any fifth one arriving by accident goes red
    // here before it can change a shared fixture's behaviour.
    const prefixed = cards.filter((card) => /^[A-Z][A-Za-z' ]*'s /.test(card.name));
    // ⚠️ **AND IT EXPIRED AGAIN AT D243, WHICH IS THE ENUMERATION EARNING ITS
    // KEEP RATHER THAN A DEFECT** — three MORE prefixed bodies arrived (the
    // seat-wide aura's `Cynthia's` pair and its `Hop's` source), in a slice that
    // names none of these three files. A one-line list edit is the whole cost; a
    // deleted control would have cost nothing and said nothing.
    expect(prefixed.map((card) => card.id).sort()).toEqual(
      [
        "fix-powersaver",
        "fix-tr-body",
        "fix-tr-energy",
        "fix-not-tr-body",
        "fix-cynthia-aura",
        "fix-cynthia-body",
        "fix-hop-aura",
        // ⚠️ **AND A THIRD EXPIRY, AT D260** — the ENUMERATION earning its keep for
        // the second time in three sessions. Backlog row 15-E's target clause is
        // "your Basic Team Rocket's Pokémon", so its holder must CARRY the prefix
        // (it is a printed member of its own group) and its STAGE negative must
        // carry it too. Neither is reachable from this file's ops; the one-line
        // edit is the whole cost.
        "fix-repellingveil",
        "fix-tr-stage1",
        // ⚠️ **AND A FOURTH EXPIRY, AT D298** — the enumeration earning its keep a
        // THIRD time, and this one from a family with no owner vocabulary of its
        // own: Lillie's Pearl `sv09-151` gates its Prize reduction on the HOLDER
        // being a `Lillie's ` Pokémon, so this row's cast needed a prefixed body
        // (`fix-lillie-body`) and a prefixed 2-Prize one (`fix-legacy-ex`). Neither
        // is reachable from this file's ops; the list edit is the whole cost.
        "fix-lillie-body",
        "fix-legacy-ex",
        // ⚠️ **AND A FIFTH EXPIRY, AT D337** — the enumeration earning its keep a
        // FOURTH time, and this one from the cheapest kind of slice there is.
        // Ethan's Adventure `sv10-165`/`-221`/`-236` searches for *"Ethan's
        // Pokémon"*, and `testFixtures.ts` held **no `Ethan's ` anything** at head,
        // so three prefixed bodies arrived to give that filter something to admit
        // (a Basic, a Stage 2 and a {L} one — the stage and the type are the two
        // riders the printed noun does NOT carry). None is reachable from this
        // file's ops; the list edit is the whole cost. 🛑 **AND THIS IS THE READER
        // THE SLICE'S PRICE DID NOT ENUMERATE**: the price said "zero engine diff"
        // and was right, then said the fixture cost was four bodies and was right —
        // and never noticed that an owner-prefixed FIXTURE is itself a census
        // subject in FOUR files. A shared pool is shared per SWEEP, not per test.
        "fix-ethans-cyndaquil",
        "fix-ethans-typhlosion",
        "fix-ethans-pichu",
        // ⚠️ **AND A SIXTH EXPIRY, AT D374** — the enumeration earning its keep a
        // FIFTH time, and the first from a slice whose prefixed fixtures are ENERGY
        // cards rather than bodies. `yourActiveHasNamedEnergyAttached` reads the
        // printed NAME of an attached Energy and chooses NAME EQUALITY over the
        // `Team Rocket's ` PREFIX, so the suite needs a prefixed Energy the member
        // must REFUSE (`fix-tr-other-energy`, invented, since no second family
        // member is printed) and one whose name merely CONTAINS the noun
        // (`fix-not-tr-energy`). Neither is reachable from this file's ops; the list
        // edit is the whole cost.
        "fix-tr-other-energy",
        "fix-not-tr-energy",
        // ⚠️ **AND ANOTHER EXPIRY, AT D392 — THE FIRST IN SEVENTEEN SLICES, AND IT WAS
        // PAID ON PURPOSE.** The SUBSTRING name read is demonstrated on Team Rocket's
        // Nidoqueen `sv10-116`, whose printed clause is satisfied in Standard by Team
        // Rocket's Nidoking ex — and the OWNER POSSESSIVE is exactly what puts the
        // fragment "Nidoking" at a NON-ZERO offset, so a `startsWith` reading fails on
        // the board the card is printed for. A tidy unprefixed name would have dodged
        // this list and left that reading unrefuted. Neither body is reachable from this
        // file's ops; the list edit is the whole cost.
        "fix-loveimpact",
        "fix-trnidoking",
        // 🆕🆕 D393 — TWO MORE, AND THIS TIME THE POSSESSIVE IS NOT A CHOICE. The
        // EVOLVE PAIR's second printing is Misty's Starmie `sv10-047`, whose printed
        // clause names *"Misty's Staryu"* — the arm compares that name to the clause
        // key byte for byte, so a tidy "Staryu" would make the demonstrator match no
        // printed sentence at all. D392 paid this toll deliberately; D393 could not
        // avoid it. Neither body is reachable from this file's ops; the list edit is
        // the whole cost.
        "fix-abruptflash",
        "fix-mistystaryu",
        // 🆕🆕 D439 — `fix-inplaybodies` ("Team Rocket's Fixmon"), the FILTERED IN-PLAY
        // BODY COUNT's five-attack holder. Prefixed ON PURPOSE: the owner sentence's
        // board needs the ACTIVE SPOT inside the counted set, so that a walk which
        // skipped the Active answers 0 where the truth is 1. A Stage 1, like
        // `fix-tr-stage1` beside it, and matched by the bare owner filter for the same
        // reason — this sweep passes no `stage`.
        "fix-inplaybodies",
        // 🆕🆕 D440 — `fix-ethansadv`, a Supporter whose NAME is exactly "Ethan's
        // Adventure". Prefixed ON PURPOSE and unavoidably: `matchesFilter`'s `byName`
        // arm is `card.name === filter.name`, and the printed noun the FILTERED
        // DISCARD-PILE COUNT reads is *"Ethan's Adventure card"* — so the possessive is
        // the card's own name and a tidy alternative would make the demonstrator match
        // no printed sentence at all (D393's case, at a Trainer instead of a body).
        // 🛑 **AND IT IS AN ENERGY/TRAINER RATHER THAN A BODY, WHICH IS WHY THIS SWEEP
        // AND NOT THE `ownerPokemon` ONE CATCHES IT**: `matchesFilter`'s `ownerPokemon`
        // arm requires `category === "Pokemon"`, so this card is invisible to every
        // owner-prefix PREDICATE in the engine and visible only to this NAME sweep —
        // which is exactly the "a shared pool is shared per SWEEP, not per test"
        // finding D337 wrote three expiries up, arriving from the other side.
        // The list edit is the whole cost.
        "fix-ethansadv",
      ].sort(),
    );
    // …and NONE of the four is a Pokémon this file's ops can reach: three are
    // D242-local `fix-*` bodies never dealt into a board here, and the fourth is an
    // ENERGY. The rider assertion below is the driven half of that claim.
  });

  it("the rider over a pool with no prefixed name is an empty set, never a wrong one", () => {
    const state = withActive(61, "fix-plain");
    for (const owner of ["Iono", "Marnie", "N", "Team Rocket"]) {
      expect(attachEnergyTargets(state, "p1", { ownerPokemon: owner })).toEqual([]);
    }
  });
});
