import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { applyChoice } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, deckOf, itemTrainer, typedEnergy } from "./testFixtures";

// ── D352 — *"SHUFFLE THE OTHER CARDS AND PUT THEM ON THE BOTTOM OF YOUR DECK"*:
//    THE LEFTOVERS DESTINATION THE OP NEXT DOOR HAS HAD SINCE D335. ────────────
//
// ── THE PRINTED SENTENCES ───────────────────────────────────────────────────
//   Metang `svp-090` / `sv05-114` — "Metal Maker" (`abilities_json`): "Once during
//   your turn, you may look at the top 4 cards of your deck and attach any number
//   of Basic {M} Energy cards you find there to your Pokémon in any way you like.
//   Shuffle the other cards and put them on the bottom of your deck."
//   **2 legal printings on ONE byte-identical sentence.**
//
//   Morpeko `sv06-072` — "Snack Seek": "Once during your turn, you may look at the
//   top card of your deck. You may discard that card." **1 legal printing.**
//
//   Both off remote D1 `luminous`, 2026-08-15, `json_each(abilities_json)` keyed on
//   `$.effect` — **NOT `$.text`, the false-zero key** — and grouped so the unit is a
//   SENTENCE. The extractor was verified against these very rows BEFORE any zero in
//   this block was believed.
//
// ── HOW THE ROW WAS FOUND ───────────────────────────────────────────────────
//   (1) LARGEST LIVE `ROWS` RESIDUE, **PARSED OUT OF THE ARRAY** with a brace-depth
//       scan rather than read off any handoff tally: 8 rows, 13 non-attack ids.
//       Row 9 = **7**, row 11 = **3**, row 10 = 2, row 12 = 1, rows 0/13/15/16 = 0.
//   (2) 🛑 **LIVE RESIDUE IS THE ORDERING, NOT RESIDUE.** Row 9 is largest at 7 and
//       has been for four slices, but FIVE of its seven are refused on grounds no
//       engine slice can reach — Reboot Pod ×1 and Glass Trumpet ×2 on the
//       Ancient/Future banner NO CATALOG COLUMN CLASSIFIES (`suffix` over 3,786 rows
//       is NULL 3,157 / `ex` 629 and nothing else), and Powerglass ×2 on a whole new
//       end-of-turn Tool trigger point for 2 printings. Its live residue is **2**.
//       Row 11's **3 are all live**, so row 11 is the largest LIVE residue.
//   (3) CENSUS THE CLAUSE, over all three text columns.
//       `instr(<col>,'and put them on the bottom of your deck')` — 4 sentences /
//       7 printings / 4 legal:
//         • Metang ×2 (`abilities_json`, **2 legal**) — UNBUILT. ← this row
//         • Deduction Kit `sv08-171` (`effect`, 1 legal) — BUILT at D344
//         • the Prize reset `sv09-156` (`effect`, 1 legal) — a different mechanism
//         • Rika ×3 (`effect`, **0 legal**) — BUILT at D335
//       So the clause's whole unbuilt legal residue is this row.
//   (4) THEN CENSUS THE SENTENCE THE CLAUSE RESTS ON.
//       `instr(<col>,'look at the top') AND instr(<col>,'attach')` — 4 sentences /
//       7 printings / **2 legal**, and BOTH legal printings are Metang. The other
//       three sentences are two Bidoof-line `onEvolve` reprints and Hydreigon
//       "Tri Howl" `sv02-140`, every one `legal_standard = 0`.
//       🛑 **SO THE CARD IS NOT MERELY THE CHEAPEST THING THE SENTENCE BUYS — IT IS
//       THE ENTIRE STANDARD-LEGAL POPULATION OF `attachFromTop`.**
//   (5) AND GREP IT. `programFor("svp-090")` was `undefined` at `be6a0b0`; every
//       other hit in the tree was prose.
//
// ── 🛑🛑 THE FINDING: A PRE-PRICE THAT HELD, AND THE ONE THING IT DID NOT NAME ─
// `effects.ts` has carried a WRITTEN PRICE for this widening since D335:
//
//   "`attachFromTop.discardRest` IS DELIBERATELY LEFT A BOOLEAN … it is not one
//    value for long, and the card is measured … the day Metang is authored costs
//    the field and nothing else, because the apply below is shared in shape."
//
// **It was correct to the member and to the line.** The field is
// `restTo?: "discard" | "shuffledBottom"` — exactly the two values named, narrower
// than `lookAtTopN`'s by one because no printing bottoms an UNSHUFFLED attach
// leftover — and `attachFromTopApply` took `revealFromTop`'s `toPile`/`underneath`
// fork verbatim. That paragraph is annotated **SPENT** rather than rewritten,
// because a prediction that came true is the only evidence this method works.
//
// 🛑 **WHAT IT DID NOT NAME IS `MATCH_RECORD_VERSION`.** An `EffectOp` is persisted
// inside `EffectContinuation.pendingOp` and this op PARKS, so a v20 record can hold
// `attachFromTop{…, discardRest: true}` — which under this deploy reads as
// `restTo === undefined` and silently leaves on top of the deck the cards Tri Howl
// printed "Discard the other cards" about. **That is the very consequence D335 paid
// for ITSELF, one op over, and its forward price for the sibling omitted it.**
// **A PRICE THAT NAMES A FIELD HAS NOT THEREBY NAMED WHAT PERSISTS IT.** §7 drives
// the misread on a real board rather than arguing it.
//
// ── THE NO-NEW-VOCABULARY REFUTATION, RUN FROM SOURCE ───────────────────────
// Five zero-diff spellings were tried and refuted before one field was paid for:
//   (a) `attachFromTop{…}` + a trailing `shuffleDeck` — the spelling Electric
//       Generator uses. REFUTED: that shuffles the WHOLE deck, where the print
//       randomizes only the ≤4-card leftover and puts it at the BOTTOM. §3 shows
//       the other 50-odd cards keeping their order, which no whole-deck shuffle can.
//   (b) `attachFromTop{restTo: "discard"}` — REFUTED on the zone: the pile, not the
//       deck. §3 asserts the discard is untouched and no `DECK_TOP_DISCARDED` fires.
//   (c) `lookAtTopN{n: 4, basicEnergy{Metal}, max: "any", restTo: "shuffledBottom"}`
//       alone — REFUTED: that op's `dest` is `hand`/`bench`/`discard` and cannot
//       attach, and *"in any way you like"* is a card→Pokémon MAP (`attachCards`),
//       not a destination. §3 attaches two cards to TWO DIFFERENT bodies.
//   (d) `lookAtTopN{… dest: "hand", restTo: "shuffledBottom"}` then
//       `attachEnergyFrom{source: "hand"}` — REFUTED twice: the transit through the
//       hand is observable, and the second op would happily attach an Energy that
//       was ALREADY in hand, which the print never offers.
//   (e) `attachFromTop` + `reorderTop` — REFUTED: `reorderTop` puts cards back on
//       TOP, and the leftover count `n − k` is not knowable to any later op.
//
// 🛑 **THE FORCED REASON, AND IT IS THE OP'S OWN DOC'S ARGUMENT TRANSFERRED:** only
// `attachFromTopApply` knows which of the window's cards were NOT attached. A
// trailing op would have to name them and cannot. So the minimum is ONE op field.
//
// **ZERO new ops, ZERO new `CardFilter` members, ZERO prompt kinds, ZERO choice
// kinds, ZERO events, ZERO error codes, ZERO `GameState` fields, ZERO wire-schema
// bytes, ZERO regexes, ZERO deriver arms, ZERO `EffectSlot` members, ZERO
// `programPlayable` arms — and NET ZERO new op fields**, since `discardRest` was
// renamed rather than joined. `MATCH_RECORD_VERSION` 20 → **21**.
//
// ── AND MORPEKO COSTS NOTHING AT ALL ────────────────────────────────────────
// `ATTACK_LOOK_TOP_DISCARD` (effects.ts) has read the identical two clauses on
// `attacks_json` since D241 and builds this exact op field for field. An Ability is
// not text-derived, so the printing needs a registry key and nothing else. It rides
// along because it is the OTHER member of row 11's `abilityIds`, and taking it
// **closes that half of the row** rather than leaving a one-id remainder.

const METANG_IDS = ["svp-090", "sv05-114"] as const;
const METANG = "sv05-114";
const MORPEKO = "sv06-072";
const HYDREIGON = "sv02-140";

const METAL_TEXT =
  "Once during your turn, you may look at the top 4 cards of your deck and attach " +
  "any number of Basic {M} Energy cards you find there to your Pokémon in any way " +
  "you like. Shuffle the other cards and put them on the bottom of your deck.";
const SNACK_TEXT =
  "Once during your turn, you may look at the top card of your deck. You may discard that card.";

const METAL = "d352-metal-energy";
const FIRE = "d352-fire-energy";
const JUNK = "d352-junk-item";
const BUDDY = "d352-buddy";

/** Real ids on a LOCAL `cardPool` (D275's idiom). ⚠️ **A FIXTURE IS A CENSUS
    POPULATION** (D348) — `catalogManifest.test.ts` and `clauseApostrophe.test.ts`
    both sweep `FIXTURE_POOL`, and neither `svp` nor `sv05` nor `sv06` is among
    `catalogManifest`'s six sets. Nothing here goes near it, and §8 asserts that BY
    ID rather than describing it. */
const LOCAL_CARDS: Record<string, Card> = Object.fromEntries(
  METANG_IDS.map((id) => [
    id,
    battler(id, {
      name: "Metang",
      stage: "Stage1",
      evolveFrom: "Beldum",
      hp: 100,
      retreat: 2,
      types: ["Metal"],
      abilities: [{ type: "Ability", name: "Metal Maker", effect: METAL_TEXT }],
    }),
  ]),
);
LOCAL_CARDS[MORPEKO] = battler(MORPEKO, {
  name: "Morpeko",
  hp: 70,
  types: ["Lightning"],
  abilities: [{ type: "Ability", name: "Snack Seek", effect: SNACK_TEXT }],
});
LOCAL_CARDS[BUDDY] = battler(BUDDY, { name: "D352 Buddy", hp: 70 });
LOCAL_CARDS[METAL] = typedEnergy(METAL, "Metal");
LOCAL_CARDS[FIRE] = typedEnergy(FIRE, "Fire");
LOCAL_CARDS[JUNK] = itemTrainer(JUNK);

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [METANG]: 4,
  [METANG_IDS[0]]: 2,
  [MORPEKO]: 4,
  [BUDDY]: 14,
  [METAL]: 14,
  [FIRE]: 12,
  [JUNK]: 10,
});

const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const BENCH_REF: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
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

/** TEST SURGERY — p1's Active becomes `activeId`, one Buddy sits on the Bench (so
    the attach has TWO candidate targets and *"in any way you like"* is a real
    question), and the top of p1's deck is exactly `top` in that order. Everything
    else goes UNDER it, so no count in this file is a seed fact and the deck's TAIL
    is a fixed sequence a shuffle would visibly disturb. */
function board(activeId: string, top: readonly string[]): GameState {
  const state = localSetup(4);
  const side = state.players.p1;
  const pool = [...side.deck, ...side.hand];
  const rest = [...pool];
  const take = (cardId: string): string => {
    const uid = rest.find((u) => state.cardIdByUid[u] === cardId);
    if (uid === undefined) throw new Error(`p1 has no ${cardId}`);
    rest.splice(rest.indexOf(uid), 1);
    return uid;
  };
  const activeUid = take(activeId);
  const benchUid = take(BUDDY);
  const topUids = top.map(take);
  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        hand: [],
        deck: [...topUids, ...rest, ...side.bench.flatMap((b) => b.stack)],
        active: body(activeUid),
        bench: [body(benchUid)],
      },
    },
  };
}

const useAbility = (state: GameState, abilityName: string) =>
  apply(state, { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName });

/** Every uid the seat holds anywhere, sorted — the card-conservation census. */
function census(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

const metalProgram = (): readonly EffectOp[] => {
  const program = programFor(METANG)?.abilities?.[0]?.program;
  if (program === undefined) throw new Error("Metal Maker has no program");
  return program;
};

describe("D352 §1 — the registry SHAPE, read off `programFor` before any board runs", () => {
  it("Metal Maker is ONE `attachFromTop` and every field is the printed word", () => {
    // 🛑 THE SHAPE ASSERTION IS NOT DECORATION — D335's own Drakloak row records a
    // mutation that NO BOARD can distinguish (a one-card leftover shuffles to
    // itself), and the only thing that kills it is reading the op's fields. The
    // same is true here of `restTo` on a whiffed look.
    expect(metalProgram()).toEqual([
      {
        op: "attachFromTop",
        n: 4,
        filter: { kind: "basicEnergy", energyType: "Metal" },
        max: "any",
        restTo: "shuffledBottom",
      },
    ]);
  });

  it("Snack Seek is ONE `lookAtTopN` and it is the deriver's op field for field", () => {
    // The ABILITY surface of a sentence `deriveAttackEffect` has read since D241.
    // Asserted as a literal rather than compared to the deriver, because the two
    // are allowed to diverge the day one of them is widened — what must not
    // happen is that this row is spelled DIFFERENTLY by accident.
    expect(programFor(MORPEKO)?.abilities?.[0]?.program).toEqual([
      { op: "lookAtTopN", n: 1, filter: { kind: "anyCard" }, max: 1, dest: "discard" },
    ]);
  });

  it("🛑 neither program carries an `attack` key — the `BUILT.attack` summand CANNOT move", () => {
    // Asserted BY KEY SET, not by `.attack === undefined`: the census's registry
    // summand counts ids with an `attack` program, and a key added later would
    // move `BUILT.attack` silently. ⚠️ **AND `BUILT.attack` STANDS STILL FOR TWO
    // DIFFERENT REASONS HERE, WHICH IS THE D351 TRAP AVOIDED RATHER THAN INHERITED.**
    // Metang's "Beam" has `$.effect` NULL on D1 — nothing to read. But Morpeko's
    // "Pick and Stick" DOES print a sentence, and `deriveAttackEffect` ALREADY
    // resolves it (two `attachEnergyFrom{source:"discard"}` ops, driven from source
    // this session), so `sv06-072` was inside the RAW summand BEFORE this slice.
    // "No reader can see it" would have been a FALSE explanation for one of the
    // three ids.
    for (const id of [...METANG_IDS, MORPEKO]) {
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    }
  });

  it("both Metang printings share ONE program object; Morpeko has its own", () => {
    // D199's near-twin rule from both ends: reprints of one card share an object
    // (so `groups.length` steps by the CARD count, not the printing count), and
    // two printed sentences never do.
    expect(programFor(METANG_IDS[0])).toBe(programFor(METANG_IDS[1]));
    expect(programFor(MORPEKO)).not.toBe(programFor(METANG));
  });
});

describe("D352 §2 — the leftovers really go UNDER the deck, shuffled, and announce nothing", () => {
  /** Top 4 = Metal, Fire, Metal, Junk. Two candidates the filter admits, and two
      cards it does not — so the leftovers are never empty and never all-candidates. */
  const TOP = [METAL, FIRE, METAL, JUNK] as const;

  it("two attach to TWO DIFFERENT bodies and the other two land at the BOTTOM", () => {
    const state = board(METANG, TOP);
    const before = census(state, "p1");
    const deckBefore = state.players.p1.deck;
    const [m1, fire, m2, junk] = deckBefore as [string, string, string, string];
    const tailBefore = deckBefore.slice(4);

    const parked = useAbility(state, "Metal Maker");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: m1, to: ACTIVE_REF },
          { uid: m2, to: BENCH_REF },
        ],
      },
    });
    const side = done.state.players.p1;

    // The MAP answer: each card named its own destination. This is refutation (c)
    // driven — no `lookAtTopN` `dest` can put two cards on two different bodies.
    expect(side.active?.energy).toEqual([m1]);
    expect(side.bench[0]?.energy).toEqual([m2]);

    // 🛑 THE LEFTOVERS ARE `window \ attached`, NOT `candidates \ attached` — the
    // Junk Item was never a candidate and is still one of the "other cards".
    expect(side.deck.slice(-2).sort()).toEqual([fire, junk].sort());

    // 🛑 REFUTATION (a), DRIVEN: the rest of the deck kept its exact order, which a
    // trailing whole-deck `shuffleDeck` could not leave true.
    expect(side.deck.slice(0, tailBefore.length)).toEqual(tailBefore);

    // 🛑 REFUTATION (b), DRIVEN: the leftovers never LEFT the deck, so the pile is
    // untouched and the event that means "cards left the deck" does not fire.
    expect(side.discard).toEqual(state.players.p1.discard);
    expect(done.events.filter((e) => e.type === "DECK_TOP_DISCARDED")).toEqual([]);
    // …and no `SHUFFLE` either: that row claims the whole DECK was shuffled, where
    // this randomizes a two-card tail (`revealFromTop`'s recorded call, transferred).
    expect(done.events.filter((e) => e.type === "SHUFFLE")).toEqual([]);

    // Nothing was created or destroyed anywhere on the way.
    expect(census(done.state, "p1")).toEqual(before);
    expect(side.deck).toHaveLength(deckBefore.length - 2);
  });

  it("the two bottomed cards are SHUFFLED — `rngState` is spent and written back", () => {
    // 🛑 `"shuffledBottom"` IS THE ONLY PATH THAT TOUCHES `rngState`, and it must be
    // THREADED: `rngState` is a field of `GameState`, not of the side, so a
    // shuffled leftover that is not written back spends randomness and throws it
    // away — the exact defect `revealFromTop`'s own comment warns about.
    const state = board(METANG, TOP);
    const [m1] = state.players.p1.deck as [string];
    const parked = useAbility(state, "Metal Maker");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: m1, to: ACTIVE_REF }] },
    });
    // Three cards left over here (Fire, Metal, Junk), so Fisher-Yates really runs.
    expect(done.state.players.p1.deck.slice(-3)).toHaveLength(3);
    expect(done.state.rngState).not.toBe(parked.state.rngState);
  });

  it("a ONE-card leftover consumes no randomness — the loop starts at `length - 1`", () => {
    // The other half of the same claim, and the reason a replay of a pre-D352 board
    // is untouched by this branch existing.
    const state = board(METANG, [METAL, METAL, METAL, FIRE]);
    const deck = state.players.p1.deck;
    const [a, b, c] = deck as [string, string, string];
    const parked = useAbility(state, "Metal Maker");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: a, to: ACTIVE_REF },
          { uid: b, to: BENCH_REF },
          { uid: c, to: ACTIVE_REF },
        ],
      },
    });
    expect(done.state.rngState).toBe(parked.state.rngState);
  });
});

describe("D352 §3 — the clause is a COST: it runs on the whiff and on the decline", () => {
  it("a window with NO Metal still bottoms all four", () => {
    const state = board(METANG, [FIRE, JUNK, FIRE, JUNK]);
    const before = census(state, "p1");
    const window = state.players.p1.deck.slice(0, 4);
    const tailBefore = state.players.p1.deck.slice(4);
    // No candidate, so the op never parks — the empty branch is routed through the
    // one apply rather than returning early, which is what keeps the clause charged.
    const done = useAbility(state, "Metal Maker");
    const side = done.state.players.p1;
    expect(side.deck.slice(-4).sort()).toEqual([...window].sort());
    expect(side.deck.slice(0, tailBefore.length)).toEqual(tailBefore);
    expect(side.active?.energy).toEqual([]);
    expect(census(done.state, "p1")).toEqual(before);
  });

  it("attaching NONE still bottoms all four — the decline is not a no-op", () => {
    const state = board(METANG, [METAL, FIRE, METAL, JUNK]);
    const window = state.players.p1.deck.slice(0, 4);
    const parked = useAbility(state, "Metal Maker");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [] },
    });
    const side = done.state.players.p1;
    expect(side.deck.slice(-4).sort()).toEqual([...window].sort());
    expect(side.active?.energy).toEqual([]);
    expect(side.discard).toEqual(state.players.p1.discard);
  });
});

describe("D352 §4 — the RENAME did not move the discard arm: Tri Howl is unchanged", () => {
  it('`restTo: "discard"` still discards, still emits, still credits the looker', () => {
    // 🛑 THE REGRESSION THE RENAME COULD SILENTLY BREAK. `discardRest: true` and
    // `restTo: "discard"` must be the same behaviour byte for byte; the risk of a
    // rename is precisely that the surviving arm quietly changes value.
    const state = board(METANG, [METAL, FIRE, JUNK]);
    const [m1, fire, junk] = state.players.p1.deck as [string, string, string];
    const events: GameEvent[] = [];
    const after = applyChoice(
      state,
      { op: "attachFromTop", n: 3, filter: { kind: "anyEnergy" }, max: "any", restTo: "discard" },
      { kind: "attachCards", assignments: [{ uid: m1, to: ACTIVE_REF }] },
      { seat: "p1" },
      events,
    );
    expect(after.players.p1.active?.energy).toEqual([m1]);
    expect(after.players.p1.discard.slice(-2)).toEqual([fire, junk]);
    const rows = events.filter((e) => e.type === "DECK_TOP_DISCARDED");
    expect(rows).toHaveLength(1);
    // Own deck, own action — the equality that makes the log row read in the ACTIVE
    // voice (D153), and a line a from-the-top op aimed elsewhere would have to edit.
    expect(rows[0]).toMatchObject({ seat: "p1", actor: "p1", uids: [fire, junk] });
    // The bottomed path is NOT taken: the deck lost the window and gained nothing.
    expect(after.players.p1.deck).toHaveLength(state.players.p1.deck.length - 3);
  });

  it("the registry row for Hydreigon carries the RENAMED key and the same value", () => {
    expect(programFor(HYDREIGON)?.abilities?.[0]?.program).toEqual([
      { op: "attachFromTop", n: 3, filter: { kind: "anyEnergy" }, max: "any", restTo: "discard" },
    ]);
  });
});

describe("D352 §5 — Morpeko: look at one card, and the second 'you may' is the decline", () => {
  it("discarding the top card is the whole effect — no shuffle, no leftovers", () => {
    const state = board(MORPEKO, [JUNK, FIRE]);
    const [top, second] = state.players.p1.deck as [string, string];
    const before = census(state, "p1");
    const parked = useAbility(state, "Snack Seek");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [top] },
    });
    const side = done.state.players.p1;
    expect(side.discard.slice(-1)).toEqual([top]);
    // 🛑 NO TRAILING `shuffleDeck`, AND THE ABSENCE IS PRINTED — a one-card window
    // has no leftovers, and the card beneath is exactly where it was.
    expect(side.deck[0]).toBe(second);
    expect(done.state.rngState).toBe(parked.state.rngState);
    expect(census(done.state, "p1")).toEqual(before);
  });

  it("declining keeps the card on top — and that is the printed second 'you may'", () => {
    // The park's own decline, not a second op: the player is shown one card and
    // answers with it or with nothing. On the decline a shuffle would scramble a
    // top the player deliberately kept, which is the opposite of what the card offers.
    const state = board(MORPEKO, [JUNK, FIRE]);
    const [top] = state.players.p1.deck as [string];
    const parked = useAbility(state, "Snack Seek");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(done.state.players.p1.deck[0]).toBe(top);
    expect(done.state.players.p1.discard).toEqual(state.players.p1.discard);
  });

  it("🛑 it is the ONE id in this slice that `revealClause`'s sweep can see", () => {
    // ⚠️ **A POPULATION HAS A FILTER, AND THE FILTER IS PART OF THE UNIT** — D351's
    // second defect, avoided here rather than repeated. `searchOps` counts
    // `searchDeck` and `lookAtTopN` and NOT `attachFromTop`, so this slice moves
    // `swept.size` by exactly ONE even though it authors THREE printings, and the
    // two Metang ids are in the POPULATION without being in the SET.
    const opsOf = (id: string) =>
      (programFor(id)?.abilities?.[0]?.program ?? []).map((op) => op.op);
    expect(opsOf(MORPEKO)).toEqual(["lookAtTopN"]);
    for (const id of METANG_IDS) expect(opsOf(id), id).toEqual(["attachFromTop"]);
  });
});

describe("D352 §6 — the ability is once per turn and works from the Bench", () => {
  it("a second use in the same turn is refused", () => {
    const state = board(METANG, [METAL, FIRE, JUNK, FIRE]);
    const [m1] = state.players.p1.deck as [string];
    const parked = useAbility(state, "Metal Maker");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: m1, to: ACTIVE_REF }] },
    });
    const again = applyAction(done.state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Metal Maker",
    });
    expect(again.ok).toBe(false);
  });

  it("`activeOnly` is absent on both rows — §9's default, and the print never says it", () => {
    for (const id of [...METANG_IDS, MORPEKO]) {
      expect(programFor(id)?.abilities?.[0]?.activeOnly, id).toBe(false);
      expect(programFor(id)?.abilities?.[0]?.oncePerTurn, id).toBe(true);
    }
  });
});

describe("D352 §7 — the v20 MISREAD, DRIVEN: why `MATCH_RECORD_VERSION` had to move", () => {
  it("🛑 a parked op carrying the OLD `discardRest` key leaves the cards on the deck", () => {
    // 🛑 **THE ARGUMENT FOR THE BUMP, RUN RATHER THAN WRITTEN.** A v20 record can
    // hold `attachFromTop{…, discardRest: true}` inside `EffectContinuation.pendingOp`
    // — Tri Howl's printed "Discard the other cards". Read under THIS deploy, the
    // key is unknown, `restTo` is `undefined`, and the leftovers stay on top of the
    // deck: the card resolves, the attach works, and the cost is silently not paid.
    // **A SILENT MISREAD IS THE CONDITION** (D309), and this is it on a real board.
    const state = board(METANG, [METAL, FIRE, JUNK]);
    const [m1, fire, junk] = state.players.p1.deck as [string, string, string];
    const legacyOp = {
      op: "attachFromTop",
      n: 3,
      filter: { kind: "anyEnergy" },
      max: "any",
      discardRest: true,
    } as unknown as EffectOp;
    const events: GameEvent[] = [];
    const after = applyChoice(
      state,
      legacyOp,
      { kind: "attachCards", assignments: [{ uid: m1, to: ACTIVE_REF }] },
      { seat: "p1" },
      events,
    );
    // The attach still happens — which is exactly what makes it silent.
    expect(after.players.p1.active?.energy).toEqual([m1]);
    // …and the two cards the record said to DISCARD are still sitting on top.
    expect(after.players.p1.deck.slice(0, 2)).toEqual([fire, junk]);
    expect(after.players.p1.discard).toEqual(state.players.p1.discard);
    expect(events.filter((e) => e.type === "DECK_TOP_DISCARDED")).toEqual([]);
    // The other direction — the SAME op under this deploy's key does pay the cost.
    const fixed: EffectOp = {
      op: "attachFromTop",
      n: 3,
      filter: { kind: "anyEnergy" },
      max: "any",
      restTo: "discard",
    };
    const good = applyChoice(
      state,
      fixed,
      { kind: "attachCards", assignments: [{ uid: m1, to: ACTIVE_REF }] },
      { seat: "p1" },
      [],
    );
    expect(good.players.p1.discard.slice(-2)).toEqual([fire, junk]);
  });
});

describe("D352 §8 — the census rungs this row is answerable to", () => {
  it("nothing this file defines reached `FIXTURE_POOL` — asserted BY ID", () => {
    // **A FIXTURE IS A CENSUS POPULATION** (D348). Adding bodies to `FIXTURE_POOL`
    // reddens `catalogManifest` and `clauseApostrophe`, reachable by no grep — so
    // the abstinence is asserted rather than described. Fourth slice running.
    for (const id of [...METANG_IDS, MORPEKO, BUDDY, METAL, FIRE, JUNK]) {
      expect(Object.hasOwn(FIXTURE_POOL, id), `${id} leaked into FIXTURE_POOL`).toBe(false);
    }
  });

  it("the THREE ids are CONTIGUOUS in registry order — the permanent rung", () => {
    // 🛑 **THE BATON LEFT THIS FILE AT D353** and now lives in `spikeClad.test.ts`
    // §8; what stays here is a CONTIGUITY claim, a permanent property of THIS row
    // (two printings of Metang plus Morpeko entered the map together, in that
    // order, and nothing may be interleaved between them). It went red on the
    // handoff, at the predicted line, for the SIXTH consecutive hand-off.
    // ⚠️ The two are DIFFERENT assertions and neither substitutes for the other:
    // `remainingHpWindow.test.ts` §6, `invitingWink.test.ts` §7 and
    // `pyroDance.test.ts` §7 are the same repair one, two and three slices earlier,
    // and all four now stand still forever.
    // ⚠️ AND THE SHAPE IS THIS ROW'S OWN: D352 shipped TWO card names over TWO
    // program objects, so the contiguous block spans a program boundary — which is
    // exactly the interleaving a future insertion would break and a `slice(-3)`
    // could never have seen once it expired.
    const raw = registryCardIds();
    const first = raw.indexOf(METANG_IDS[0]);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(raw.slice(first, first + 3)).toEqual([...METANG_IDS, MORPEKO]);
  });

  it("all THREE real ids are registry keys, and the synthetic bodies are not", () => {
    const keys = new Set(registryCardIds());
    for (const id of [...METANG_IDS, MORPEKO]) expect(keys.has(id), id).toBe(true);
    for (const id of [BUDDY, METAL, FIRE, JUNK]) expect(keys.has(id), id).toBe(false);
  });

  it("the printed sentences are on the fixture bodies, so a census can SEE them", () => {
    // D172's rule: a printed clause a census must be able to see has to be a STRING
    // on the fixture, because a comment cannot go red.
    for (const id of METANG_IDS) {
      expect(LOCAL_CARDS[id]?.abilities?.[0]?.effect).toBe(METAL_TEXT);
    }
    expect(LOCAL_CARDS[MORPEKO]?.abilities?.[0]?.effect).toBe(SNACK_TEXT);
  });
});
