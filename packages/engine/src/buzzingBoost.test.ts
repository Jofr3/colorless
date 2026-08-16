import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { topUid } from "./cards";
import { conditionHolds, conditionNote } from "./interpreter";
import { redactGame } from "./redact";
import { programFor, registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, deckOf, typedEnergy } from "./testFixtures";
import { makeInPlay } from "./types";

// ── D347 — "BUZZING BOOST": THE HALF OF A SENTENCE THAT WAS ALREADY PAID FOR.
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   Yanmega ex sv10-003 / sv10-206 / sv10-228
//     "Once during your turn, **when this Pokémon moves from your Bench to the
//      Active Spot**, you may search your deck for up to 3 Basic {G} Energy cards
//      and attach them to this Pokémon. Then, shuffle your deck."
//   An ACTIVATED Ability. **3 Standard-legal printings, ONE sentence, ONE object,
//   and a ZERO engine diff** — `registry.ts` is the whole build.
//
// ── HOW THIS ROW WAS CHOSEN ─────────────────────────────────────────────────
// D344's method, run in order for the FOURTH slice running:
//   (1) LARGEST LIVE `ROWS` RESIDUE, read off `censusAtHead.test.ts` at THIS head
//       rather than off a handoff. Row 10 = **5** (4 `abilityIds` + 1 `effectIds`);
//       row 9 = 7 raw but **4 live**, because 3 of its 5 `effectIds` are D346's
//       recorded DEAD DATUM (Reboot Pod `sv05-158`, Glass Trumpet `sv07-135`/
//       `sv08.5-110` — the Future and Tera banners have no supply-side column);
//       row 12 = 4; row 11 = 3; rows 13/0/15 = 0. **Row 10 wins.**
//   (2) CENSUS THE CLAUSE, NOT THE CARD, over ALL THREE text columns (remote D1
//       `luminous`, uuid 735f0fb5-cdc3-494d-8b97-74a8ade0124a, 2026-08-15).
//       `instr(<col>, 'from your Bench to the Active Spot') > 0`:
//
//         effect          0 printings / 0 legal / 0 sentences
//         abilities_json 13 printings / 3 legal / 4 sentences
//         attacks_json    6 printings / 5 legal / 2 sentences
//
//       The 3 legal ABILITY printings are exactly these three ids; the other ten
//       are Weavile ×2, Iron Moth ×2 and Iron Valiant ex ×6, all rotated.
//   (3) IS THE CARD THE CHEAPEST THING THAT SENTENCE BUYS? **YES, and the reason
//       is the other column.** The 5 legal ATTACK printings — Revavroom ex
//       `sv06.5-015`/`-081` (+120) and Keldeo ex `sv10.5w-030`/`-159`/`-167`
//       (+90) — print *"**If** this Pokémon **moved** from your Bench to the
//       Active Spot this turn, this attack does {N} more damage"*: THE SAME BOARD
//       FACT IN THE INDICATIVE, and D124 shipped it. So the fact this Ability
//       needs was bought 223 decisions ago and the Ability half is the unbought
//       remainder of one sentence. Row 10's other `abilityId`, Steven's Metagross
//       ex `sv10-145`, owes the *"or 1 of each"* grammar AND two `targetType`s in
//       one sentence; the `effectIds` entry, Energy Coin `sv10.5b-081`, is ONE
//       printing behind a two-coin AND gate.
//       🆕🆕 **BOTH HALVES ARE SPENT AND ROW 10 IS CLOSED — RECORDED HERE RATHER
//       THAN REWRITTEN, because this paragraph is a DATED RECORD of D347's
//       method-run and not a live claim.** `sv10-145` was built at D354, and the
//       price quoted above was wrong: it named the PAIRING reading, which the
//       card does not print (D354 settled that from the catalog — the `attach
//       them to <NOUN>` template is 31 printings with exactly one set-noun each).
//       `sv10.5b-081` was built at D355 for ONE optional key
//       (`coinFlipGate.coins?: number`), and the "two-coin AND gate" phrase above
//       is the one part of this cell that aged correctly.
//       ⚠️ **STRUCK, NOT EDITED**: rewriting a stale cell to name a different
//       blocker is how a residue note rots invisibly, because the rewrite
//       disagrees with nothing.
//   (4) AND GREP IT. The only hit in the tree for this sentence is
//       `derivedDeckSearchAttach.test.ts`'s `ABILITY_SIDE_NEAR_MISS` — a NEGATIVE
//       fixture pinning that deriver's `^` anchor. **A near-miss is not an
//       implementation**, which is §2's first assertion below.
//
// ── 🛑🛑 WHAT WAS REFUSED, AND IT IS D346's OWN UNPRICED OPENING ────────────
// D346's resume point left one specific instruction: *"the `attacks_json` half of
// the 'in any way you like' clause is 36 legal printings on 36 sentences and
// wholly unpriced — census what the readers already resolve before pricing any of
// it."* Run literally, and it is **two defects deep**:
//
//   • **A UNIT DEFECT (D341's lesson).** `36 sentences` is
//     `COUNT(DISTINCT attacks_json)` — whole JSON BLOBS, one per card printing.
//     It is the PRINTING count wearing a SENTENCE count's name. Re-grouped by the
//     actual attack sentence through `json_each`, the figure is **20 sentences /
//     36 legal printings**.
//   • **RUNG 1 RETURNS ZERO (D263's lesson — the one D346 asked for by name).**
//     The nine exported readers ALREADY resolve **8 of those 20 sentences / 17 of
//     the 36 printings**, every one through `deriveAttackEffect`. The genuinely
//     unpriced residue is **12 sentences / 19 printings**, and it fragments into
//     at least SIX mechanisms: a damage-counter SPREAD (3 sentences / 8
//     printings — Dragapult ex ×4, Flutter Mane ×3, Sinistcha ×1), an
//     energy-move "in any way" (3/3), the Future/Tera subgroup targets (3/4),
//     an OPPONENT's-discard source (1/1), a coin-COUNTED attach (1/1), and a
//     damage-counter MOVE (1/1). The largest coherent block needs a counter
//     DISTRIBUTION park — a new prompt kind — and **every sub-block is smaller
//     than this row's 3.**
//
// ⚠️ **THE TRANSFERABLE PART: A CENSUS FIGURE'S UNIT ROTS FASTER THAN ITS COUNT,
// AND A `COUNT(DISTINCT <json column>)` IS ALWAYS A PRINTING COUNT.** Two of this
// repo's last seven slices have been sent by a number that was right about the
// population and wrong about what it counted.
//
// ── 🛑 THE DESIGN CALL — A NAMED EXCEPTION TO `playableIf`'s OWN RULE ────────
// `registry.ts`'s `playableIf` doc block forbids per-body predicates: *"a
// per-BODY predicate is a different mechanism and must NOT be forced through this
// field: `conditionHolds` takes a seat and no uid, so a self-pronoun has no
// referent in it."* That rule is RIGHT, and this card is the one shape it does
// not cover. **`activeOnly: true` GIVES THE SELF-PRONOUN ITS REFERENT** — it pins
// the Ability's host to the single body `conditionHolds` reads, so
//
//     "your Active moved up this turn"  ∧  "this Pokémon IS the Active"
//   ≡ "this Pokémon moved up this turn"
//
// for every seat, consumer and phase (D124's own totality argument, because
// `promotedTurn` is stamped on the Pokémon). **The exception is the CONJUNCTION,
// not the predicate**, and §5 below drives both halves of it.
//
// ⚠️ **SO D310's STANDING QUESTION IS ANSWERED, AND THE ANSWER IS NO.**
// `remainingHpAtMost`'s doc says *"when the second per-body printing lands, THAT
// is the slice that generalises this"*. This is not that printing: Pidove
// `sv05-133` prints no spot clause and its subject genuinely cannot be resolved
// from a seat, where this one's can. A printing the shared field can already say
// is not evidence for a private one. Recorded in that doc block rather than left
// to be re-asked — D346's rule about spent notes, applied to a spent QUESTION.
//
// ── THE RECORDED LIMITATION, FLAGGED RATHER THAN HIDDEN ─────────────────────
// The print is a MOMENT (*"when this Pokémon moves"*) and this models it as a
// GATE re-checked at use time. They differ on exactly one board: a Yanmega that
// moves up and is switched back DOWN in the same turn loses the use here and
// keeps it on paper. The divergence REFUSES rather than affords (D222's
// direction), it takes two switch effects in one turn to reach, and buying the
// literal reading costs a new `TriggerTiming` plus an optional-trigger confirm —
// a mechanism authored on the evidence of a board no printing rewards. §7 drives
// the divergence so it is a measured decision and not an unknown.

const YANMEGA = "sv10-003";
const YANMEGA_IR = "sv10-206";
const YANMEGA_SIR = "sv10-228";
const YANMEGA_IDS = [YANMEGA, YANMEGA_IR, YANMEGA_SIR] as const;

const ABILITY = "Buzzing Boost";
const YANMEGA_TEXT =
  "Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may search your deck for up to 3 Basic {G} Energy cards and attach them to this Pokémon. Then, shuffle your deck.";

/** The ATTACK-column printing of the SAME board fact, carried verbatim so the
    two halves of one clause sit in one file. Already read by D124's clause table
    — this constant is a witness, not a target. */
const ATTACK_SIDE_SAME_FACT =
  "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 90 more damage.";

/** A NON-Yanmega body with no Ability: the Active that retreats, and a bench
    body that is never the source. Its presence is what makes "the gate reads the
    ACTIVE" an assertion rather than a tautology on a one-body board. */
const PLAIN = "fix-d347-plain";
const WALL = "fix-d347-wall";

/** Basic {G} — the printed brace code, so `energyType: "Grass"` is driven. */
const ENERGY_G = "fix-d347-energy-grass";
/** Basic {R} — a Basic Energy of the WRONG type. Excluded by `energyType` and by
    nothing else, which is what makes the narrowing an assertion. */
const ENERGY_R = "fix-d347-energy-fire";

/** The three real printings, carried off the remote D1 row (2026-08-15): HP 280,
    Stage 1 out of Yanma, {G}, retreat 1, the Ability text and the
    printed attack at its printed index. Held in a LOCAL pool and never in
    `FIXTURE_POOL` — D275's idiom, and again the only option that costs nothing:
    `catalogManifest.test.ts` classifies real-looking fixture ids against a
    generated manifest of SIX sets (sv01/sv02/sv03/sv06.5/sve/swsh10.5) and `sv10`
    is not one of them, so a shared-pool body would have owed a `fix-*` key on
    `censusAtHead`'s `raw.length` line. **THE KEY IS THE SET, NOT THE SURFACE.** */
const LOCAL_CARDS: Record<string, Card> = Object.fromEntries([
  ...YANMEGA_IDS.map((id) => [
    id,
    battler(id, {
      name: "Yanmega ex",
      stage: "Stage1",
      evolveFrom: "Yanma",
      hp: 280,
      retreat: 1,
      types: ["Grass"],
      abilities: [{ type: "Ability", name: ABILITY, effect: YANMEGA_TEXT }],
      attacks: [
        {
          cost: ["Grass", "Grass", "Grass", "Colorless"],
          name: "Jet Cyclone",
          effect: "Move 3 Energy from this Pokémon to 1 of your Benched Pokémon.",
          damage: 210,
        },
      ],
    }),
  ]),
  [
    PLAIN,
    battler(PLAIN, {
      name: "D347 Plain",
      hp: 120,
      retreat: 1,
      types: ["Grass"],
      attacks: [{ cost: ["Grass"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    WALL,
    battler(WALL, {
      name: "D347 Wall",
      hp: 330,
      retreat: 1,
      types: ["Colorless"],
      attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    }),
  ],
  [ENERGY_G, typedEnergy(ENERGY_G, "Grass")],
  [ENERGY_R, typedEnergy(ENERGY_R, "Fire")],
]) as Record<string, Card>;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [YANMEGA]: 4,
  [YANMEGA_IR]: 4,
  [YANMEGA_SIR]: 4,
  [PLAIN]: 8,
  [WALL]: 8,
  [ENERGY_G]: 20,
  [ENERGY_R]: 12,
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

function reject(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`${action.type} was expected to be rejected`);
  return result.error;
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
    `FIXTURE_POOL`, which is what keeps `censusAtHead`'s `raw.length` and
    `nonAttackRegistryIds()` lines 0 apart for the eighth slice running. */
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

/** Move `cardId` out of the deck and onto the named spot, keeping the rest of the
    zone untouched. The fixture helpers cannot be used here — they key on
    `FIXTURE_POOL` — so this is the local equivalent, and it deliberately does NOT
    stamp `promotedTurn`: every promotion in this file goes through a real action,
    which is the whole point of the suite. */
function seat(state: GameState, s: Seat, cardId: string, spot: "active" | "bench"): GameState {
  const side = state.players[s];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${cardId} not in ${s}'s deck`);
  const body = makeInPlay(uid, state.turn);
  const deck = side.deck.filter((u) => u !== uid);
  return {
    ...state,
    players: {
      ...state.players,
      [s]:
        spot === "active"
          ? { ...side, deck, active: body }
          : { ...side, deck, bench: [...side.bench, body] },
    },
  };
}

/** Attach one Energy from the deck onto the Active — the retreat cost, paid with
    a card that is never Basic {G} so it can never be confused with what the
    Ability attaches. */
function fundRetreat(state: GameState, s: Seat): GameState {
  const side = state.players[s];
  const active = side.active;
  if (active === null) throw new Error("no active to fund");
  const uid = side.deck.find((u) => state.cardIdByUid[u] === ENERGY_R);
  if (uid === undefined) throw new Error("no {R} energy in deck");
  return {
    ...state,
    players: {
      ...state.players,
      [s]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: { ...active, energy: [...active.energy, uid] },
      },
    },
  };
}

/** p1 on turn:action with a PLAIN Active carrying its retreat cost and `bench[0]`
    holding the named Yanmega printing. Nothing has moved yet. */
function ready(printing: string = YANMEGA, seed = 6): GameState {
  let state = localSetup(seed, "p1");
  state = seat(state, "p1", WALL, "active");
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
  state = seat(state, "p1", printing, "bench");
  state = seat(state, "p1", PLAIN, "bench");
  state = seat(state, "p2", WALL, "active");
  state = { ...state, players: { ...state.players, p2: { ...state.players.p2, bench: [] } } };
  state = seat(state, "p2", PLAIN, "bench");
  return fundRetreat(state, "p1");
}

/** Retreat the Active into `bench[index]` — the DELIBERATE half of bench→Active
    (turn.ts stamps `promotedTurn` here). */
function retreatInto(state: GameState, index: number) {
  const active = state.players.p1.active;
  if (active === null) throw new Error("no active to retreat");
  return step(state, {
    type: "retreat",
    seat: "p1",
    discardEnergy: [active.energy[0] as string],
    promoteBenchIndex: index,
  });
}

function useBoost(state: GameState) {
  return step(state, {
    type: "useAbility",
    seat: "p1",
    target: { spot: "active" },
    abilityName: ABILITY,
  });
}

/** The ONLINE HUD's row for this Ability, read through the real redaction rather
    than through an internal helper — `redactedAbilitiesOf` is module-private, and
    a test that reached past `redactGame` would not be exercising the surface a
    remote client actually sees. */
function hudRow(state: GameState) {
  const phase = redactGame(state, "p1").phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.abilities.find((a) => a.abilityName === ABILITY);
}

function grassInDeck(state: GameState, s: Seat): number {
  return state.players[s].deck.filter((u) => state.cardIdByUid[u] === ENERGY_G).length;
}

describe("D347 §1 — the printed sentence, and the row it closes", () => {
  it("all three printings resolve to ONE program object, and it is the ability shape", () => {
    const first = programFor(YANMEGA);
    expect(first).toBeDefined();
    // ONE object, by identity — this is what makes `censusAtHead`'s object
    // decomposition step by 1 where its printing sum steps by 3.
    expect(programFor(YANMEGA_IR)).toBe(first);
    expect(programFor(YANMEGA_SIR)).toBe(first);
    expect(first?.abilities).toHaveLength(1);
    expect(first?.triggered).toBeUndefined();
    expect(first?.trainer).toBeUndefined();
    expect(first?.passive).toBeUndefined();
  });

  it("every printed word maps to a field, and the ABSENT fields are the print too", () => {
    const ability = programFor(YANMEGA)?.abilities?.[0];
    expect(ability?.name).toBe(ABILITY);
    // "Once during your turn" — §9's DEFAULT per-body scope, not `sharedByName`:
    // nothing prints "you can't use more than 1 Buzzing Boost Ability each turn".
    expect(ability?.oncePerTurn).toBe(true);
    // The spot clause is IMPLIED by "moves … to the Active Spot" rather than
    // printed as "if this Pokémon is in the Active Spot" — and it is load-bearing
    // twice over: it enforces the print AND it is what resolves the self-pronoun
    // in `playableIf` (§5).
    expect(ability?.activeOnly).toBe(true);
    expect(ability?.playableIf).toEqual({ kind: "yourActivePromotedThisTurn" });
    // NOT the per-body field — the whole design call, asserted rather than told.
    expect(ability?.remainingHpAtMost).toBeUndefined();
    expect(ability?.endsTurn).toBeUndefined();
    expect(ability?.program).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Grass" },
        max: 3,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 `toSelf` above `max: 1` is NEW, and it is why this row needs no new op field", () => {
    // `attachFromDeck.toSelf` is D171's field, authored for Pawmot's "attach IT to
    // this Pokémon" at `max: 1`. This is its FIRST row above one, and the reason
    // that matters is the gap one family over: `derivedDeckSearchAttach`'s
    // `UNREAD[0]` prices "attach them to 1 of your Pokémon" as blocked on
    // "`attachFromDeck` has no `attachEnergyFrom.count`" — a batch onto ONE CHOSEN
    // body. This card's body is not chosen, it is the SOURCE, so `toSelf` returns a
    // one-element target list and the `attachCards` prompt maps the whole batch
    // onto it with nothing new bought. **THE PRINTED PRONOUN IS THE WHOLE
    // DIFFERENCE**, and a slice that read only the count would have priced this row
    // at the blocked family's price.
    const op = programFor(YANMEGA)?.abilities?.[0]?.program?.[0];
    expect(op).toMatchObject({ op: "attachFromDeck", toSelf: true, max: 3 });
    // …and the riders `toSelf` IGNORES are absent rather than set-and-inert, so no
    // later reader can come to disagree about which of them won.
    expect(op).not.toHaveProperty("targetType");
    expect(op).not.toHaveProperty("benchOnly");
    expect(op).not.toHaveProperty("ownerPokemon");
    expect(op).not.toHaveProperty("maxPerTarget");
  });

  it("the three ids are CONTIGUOUS in registry insertion order — the rung's real claim", () => {
    // `censusAtHead`'s `raw[raw.length - 1]` is keyed on insertion order and has now
    // gone red on an untouched constant SEVEN consecutive times. Pinned here so the
    // rung has a reason beside it in a file that moves it.
    //
    // 🛑 **D349 — THIS ASSERTION USED TO READ `raw.slice(-3)` AND IT WAS SPENT THE
    // MOMENT THE NEXT SLICE INSERTED A ROW.** "The LAST three keys" is a property of
    // the whole registry at one instant, not of this row, so it was guaranteed to
    // redden on a diff that has nothing to do with Yanmega ex — which is the same
    // defect `raw[raw.length - 1]` has, reproduced in the file that was supposed to
    // EXPLAIN it. Re-pointed at the property that is actually this row's:
    // three reprints inserted together stay together. The baton — a live pin on the
    // last key, in the file that moved it — is carried by
    // `remainingHpWindow.test.ts` §6 now, and by whatever moves it next.
    const raw = registryCardIds();
    const at = raw.indexOf(YANMEGA);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(raw.slice(at, at + 3)).toEqual([YANMEGA, YANMEGA_IR, YANMEGA_SIR]);
  });
});

describe("D347 §2 — the census, and the near-miss that was NOT an implementation", () => {
  it("🛑 the sentence's only prior appearance in this tree is a NEGATIVE fixture", () => {
    // `derivedDeckSearchAttach.test.ts` carries this exact string as
    // `ABILITY_SIDE_NEAR_MISS`, to pin that deriver's `^` anchor against an Ability
    // that opens with a §9 trigger clause. That is prose in the sense that matters:
    // it asserts the reader REFUSES the sentence. It stays true after this slice,
    // because an Ability has no text deriver in this engine at all — `programFor` is
    // the only reader — which is why this row is a registry program by construction.
    expect(YANMEGA_TEXT.startsWith("Once during your turn")).toBe(true);
    for (const id of YANMEGA_IDS) expect(programFor(id)).toBeDefined();
  });

  it("🛑 the ATTACK half of this clause was already built — the whole reason this is cheap", () => {
    // D124 bought `InPlayPokemon.promotedTurn` + `BoardCondition.
    // yourActivePromotedThisTurn` for the five legal attack printings that print the
    // same fact in the indicative. This slice re-uses BOTH and buys neither.
    expect(ATTACK_SIDE_SAME_FACT).toContain("moved from your Bench to the Active Spot this turn");
    expect(YANMEGA_TEXT).toContain("moves from your Bench to the Active Spot");
    // The note ROUND-TRIPS to the printed clause, which is how the two halves are
    // shown to be one fact rather than two that happen to agree.
    expect(conditionNote({ kind: "yourActivePromotedThisTurn" })).toBe(
      "your Active Pokémon moved from your Bench to the Active Spot this turn",
    );
  });
});

describe("D347 §3 — the Ability, driven end to end", () => {
  it("a retreat promotes Yanmega and the Ability attaches up to 3 Basic {G} to ITSELF", () => {
    const start = ready();
    const before = grassInDeck(start, "p1");
    const retreated = retreatInto(start, 0);
    const promoted = retreated.state.players.p1.active;
    expect(promoted?.promotedTurn).toBe(retreated.state.turn);

    const used = useBoost(retreated.state);
    const phase = used.state.phase;
    if (phase.kind !== "effect:choose") throw new Error(`expected a park, got ${phase.kind}`);
    expect(phase.prompt.kind).toBe("attachCards");
    if (phase.prompt.kind !== "attachCards") throw new Error("expected attachCards");
    // ONE target — the source itself. This is `toSelf` observed rather than told.
    expect(phase.prompt.targets).toEqual([{ seat: "p1", spot: { spot: "active" } }]);
    expect(phase.prompt.max).toBe(3);

    const picks = phase.prompt.candidates.slice(0, 3);
    expect(picks).toHaveLength(3);
    const done = step(used.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: picks.map((uid) => ({ uid, to: { seat: "p1", spot: { spot: "active" } } })),
      },
    });
    const after = done.state.players.p1.active;
    expect(after?.energy).toHaveLength(3);
    for (const uid of after?.energy ?? []) {
      expect(done.state.cardIdByUid[uid]).toBe(ENERGY_G);
    }
    // "Then, shuffle your deck" — the trailing op really ran.
    expect(find(done.events, "SHUFFLE")).toBeDefined();
    expect(grassInDeck(done.state, "p1")).toBe(before - 3);
    expect(done.state.phase.kind).toBe("turn:action");
  });

  it('the {R} Energy in the same deck is NEVER offered — `energyType: "Grass"` is driven', () => {
    const retreated = retreatInto(ready(), 0);
    const used = useBoost(retreated.state);
    const phase = used.state.phase;
    if (phase.kind !== "effect:choose" || phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    for (const uid of phase.prompt.candidates) {
      expect(used.state.cardIdByUid[uid], uid).toBe(ENERGY_G);
    }
    // …and the {R} really is in the deck, so the exclusion is a filter and not an
    // empty zone. D214's vacuous-guard shape, closed.
    expect(used.state.players.p1.deck.some((u) => used.state.cardIdByUid[u] === ENERGY_R)).toBe(
      true,
    );
  });

  it('taking NONE is a legal answer — the printed "up to", and the deck still shuffles', () => {
    const retreated = retreatInto(ready(), 0);
    const used = useBoost(retreated.state);
    const done = step(used.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [] },
    });
    expect(done.state.players.p1.active?.energy).toHaveLength(0);
    expect(find(done.events, "SHUFFLE")).toBeDefined();
    expect(done.state.phase.kind).toBe("turn:action");
  });

  it("§9 — the use is spent per BODY, so a second use in the same turn is refused", () => {
    const retreated = retreatInto(ready(), 0);
    const used = useBoost(retreated.state);
    const done = step(used.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [] },
    });
    const error = reject(done.state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: ABILITY,
    });
    // ⚠️ ALREADY_USED and not the gate — `useAbility` checks the once-per-turn lock
    // BEFORE `playableIf`, which is that field's own documented order and the reason
    // a spent Ability never reports a board that has gone quiet.
    expect(error.code).toBe("ABILITY_ALREADY_USED");
  });
});

describe("D347 §4 — the gate REFUSES when the body did not move up", () => {
  it("an Active that has been there all along cannot use it", () => {
    // Yanmega seated as the Active with `promotedTurn: null` — the exact board the
    // print excludes, and the one a bare `activeOnly` would have afforded.
    let state = localSetup(6, "p1");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = seat(state, "p1", YANMEGA, "active");
    expect(state.players.p1.active?.promotedTurn).toBeNull();
    const error = reject(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: ABILITY,
    });
    expect(error.code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(error.message).toContain("moved from your Bench to the Active Spot this turn");
  });

  it("a BENCHED Yanmega cannot use it even while the Active DID move up", () => {
    // The half of the conjunction `playableIf` alone cannot see: the board fact is
    // TRUE (`conditionHolds` says so), and the Ability is still refused because its
    // host is not the body the fact is about. **This is the assertion that makes
    // `activeOnly` load-bearing rather than decorative.**
    const start = ready();
    const withBenchYanmega = seat(start, "p1", YANMEGA_IR, "bench");
    // Retreat into the PLAIN body, so the Active that moved up is not a Yanmega.
    const retreated = retreatInto(withBenchYanmega, 1);
    expect(conditionHolds(retreated.state, "p1", { kind: "yourActivePromotedThisTurn" })).toBe(
      true,
    );
    const benchIndex = retreated.state.players.p1.bench.findIndex(
      (b) => retreated.state.cardIdByUid[topUid(b) ?? ""] === YANMEGA_IR,
    );
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    const error = reject(retreated.state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: benchIndex },
      abilityName: ABILITY,
    });
    expect(error.code).toBe("ABILITY_ACTIVE_ONLY");
  });

  it("the stamp EXPIRES by arithmetic — the next turn refuses with nothing cleared", () => {
    // D124's turn-stamp decision, observed from this row: `promotedTurn ===
    // state.turn` goes false on its own, so no turn-boundary walk exists to forget.
    const retreated = retreatInto(ready(), 0);
    let state = step(retreated.state, { type: "endTurn", seat: "p1" }).state;
    state = step(state, { type: "endTurn", seat: "p2" }).state;
    const active = state.players.p1.active;
    expect(active?.promotedTurn).not.toBeNull();
    expect(active?.promotedTurn).not.toBe(state.turn);
    const error = reject(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: ABILITY,
    });
    expect(error.code).toBe("ABILITY_CONDITION_NOT_MET");
  });
});

describe("D347 §5 — the CONJUNCTION, which is the design call", () => {
  it("🛑 `activeOnly` is what resolves the self-pronoun — both halves, on one board", () => {
    // "your Active moved up this turn" ∧ "this Pokémon IS the Active"
    //   ≡ "this Pokémon moved up this turn".
    // Driven as an equivalence rather than asserted as a claim: the SAME board
    // answers TRUE for the seat-relative predicate and identifies the host as the
    // very body the predicate read.
    const retreated = retreatInto(ready(), 0);
    const state = retreated.state;
    expect(conditionHolds(state, "p1", { kind: "yourActivePromotedThisTurn" })).toBe(true);
    const active = state.players.p1.active;
    expect(state.cardIdByUid[topUid(active as never) ?? ""]).toBe(YANMEGA);
    expect(active?.promotedTurn).toBe(state.turn);
    // …and the opponent, whose Active has not moved, reads FALSE from the same
    // predicate — so the field really is seat-relative and the pronoun really did
    // need the second half.
    expect(conditionHolds(state, "p2", { kind: "yourActivePromotedThisTurn" })).toBe(false);
  });

  it("the gate is visible to the HUD, not only to the engine — D190/D222", () => {
    // `playableIf` is read by three surfaces; the online one is `redactedAbilitiesOf`
    // and it must SAY why rather than offer a use that will be rejected.
    let state = localSetup(6, "p1");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = seat(state, "p1", YANMEGA, "active");
    const shownBefore = hudRow(state);
    expect(shownBefore).toBeDefined();
    expect(shownBefore?.disabled).toBe(true);
    expect(shownBefore?.reason).toBe(
      "Only if your Active Pokémon moved from your Bench to the Active Spot this turn",
    );

    const retreated = retreatInto(ready(), 0);
    const shownAfter = hudRow(retreated.state);
    expect(shownAfter?.disabled).toBe(false);
    expect(shownAfter?.reason).toBeNull();
  });
});

describe("D347 §6 — the OTHER promotion routes, and §8.1's free correctness", () => {
  it("a LATER turn's promotion re-arms the use — the gate is per-move, not once-per-game", () => {
    // ⚠️ NAMED FOR WHAT IT DRIVES. `promotedTurn` is a STAMP that is OVERWRITTEN by
    // the next promotion, not a flag that is set once, so a Yanmega that goes down
    // and comes back up on a later turn is usable again. The §9 lock is per turn and
    // the gate is per move, and they agree here by construction rather than by
    // coincidence — which is the thing worth pinning, because a design that cleared
    // the stamp at the turn boundary (D124's rejected alternative) would still pass
    // the §4 expiry case and fail this one.
    const start = ready();
    let state = step(start, { type: "endTurn", seat: "p1" }).state;
    state = step(state, { type: "endTurn", seat: "p2" }).state;
    // The Active never moved, so the fact is FALSE at the top of the new turn…
    expect(conditionHolds(state, "p1", { kind: "yourActivePromotedThisTurn" })).toBe(false);
    // …and TRUE again the moment Yanmega comes up, on a turn that is not the first.
    const retreated = retreatInto(fundRetreat(state, "p1"), 0);
    expect(retreated.state.players.p1.active?.promotedTurn).toBe(retreated.state.turn);
    expect(retreated.state.turn).toBeGreaterThan(start.turn);
    const used = useBoost(retreated.state);
    expect(used.state.phase.kind).toBe("effect:choose");
  });

  it("🛑 the RECORDED LIMITATION — a body switched back DOWN loses the use", () => {
    // The print is a MOMENT; this is a GATE re-checked at use time. The two differ
    // on exactly this board. It REFUSES rather than affords, which is the direction
    // D222 asks for, and it is driven here so the divergence is a measured decision
    // rather than an unknown.
    const retreated = retreatInto(ready(), 0);
    // Retreat again, sending the promoted Yanmega back to the Bench in the same
    // turn. The retreat allowance is per-turn, so the board is reached by paying the
    // cost on a state whose allowance is reset — modelled directly.
    const state: GameState = {
      ...retreated.state,
      allowances: { ...retreated.state.allowances, retreated: false },
    };
    const funded = fundRetreat(state, "p1");
    const back = retreatInto(funded, 0);
    expect(back.state.cardIdByUid[topUid(back.state.players.p1.active as never) ?? ""]).not.toBe(
      YANMEGA,
    );
    const benchIndex = back.state.players.p1.bench.findIndex(
      (b) => back.state.cardIdByUid[topUid(b) ?? ""] === YANMEGA,
    );
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    const error = reject(back.state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: benchIndex },
      abilityName: ABILITY,
    });
    expect(error.code).toBe("ABILITY_ACTIVE_ONLY");
  });
});

describe("D347 §7 — the attribution controls (D345's own, applied forward)", () => {
  it("nothing this file defines reached `FIXTURE_POOL` — the shared-pool control", () => {
    // D275's idiom. If any of these leaked, `censusAtHead`'s `raw.length` and
    // `nonAttackRegistryIds()` lines would stop being 0 apart and the leak would be
    // invisible from here.
    for (const id of [...YANMEGA_IDS, PLAIN, WALL, ENERGY_G, ENERGY_R]) {
      expect(Object.hasOwn(FIXTURE_POOL, id), id).toBe(false);
    }
    for (const id of YANMEGA_IDS) expect(Object.hasOwn(LOCAL_CARDS, id), id).toBe(true);
  });

  it("the local pool entry carries the PRINTED Ability name and text on all three", () => {
    // D345's fourth auditor-population finding was a fixture carrying Ability TEXT
    // that nothing read. This asserts the inverse in both directions: the fixture's
    // printed name is the one the registry program answers to, id by id.
    for (const id of YANMEGA_IDS) {
      const card = LOCAL_CARDS[id];
      expect(card?.abilities?.[0]?.name, id).toBe(ABILITY);
      expect(card?.abilities?.[0]?.effect, id).toBe(YANMEGA_TEXT);
      expect(programFor(id)?.abilities?.[0]?.name, id).toBe(ABILITY);
    }
  });

  it("the printed ATTACK is untouched — this row buys no attack program", () => {
    // Yanmega's "Jet Cyclone" is TEXT-DERIVED and stays that way: the registry entry
    // has no `attackGate` and no attack half, which is what keeps `BUILT.attack` and
    // the 13-row gate cohort standing still in `censusAtHead`.
    for (const id of YANMEGA_IDS) {
      const program = programFor(id) as object;
      expect(Object.hasOwn(program, "attackGate"), id).toBe(false);
      expect(Object.hasOwn(program, "attacks"), id).toBe(false);
    }
  });
});
