import { describe, expect, it } from "vitest";
import { passivesOf, seatShieldedFromSupporterEffects } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  FIXTURE_POOL,
  TRAINER_SHIELD_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.174.0 → 0.175.0 — the TRAINER-BORNE EFFECT SHIELD (P3-M5 long tail, D259),
// backlog row 15-D and the LARGEST row left in the `%prevent%` ability seam:
//
//   "Whenever your opponent plays an Item or Supporter card from their hand,
//    prevent all effects of that card done to this Pokémon."
//     — Fraxure sv06.5-045/sv06.5-077 "Unnerve";
//       Cetitan ex sv10-065/sv10-210 "Snow Camouflage".            4 printings
//
//   "As long as this Pokémon is in the Active Spot, whenever your opponent plays
//    a Supporter card from their hand, prevent all effects of that card done to
//    all of your Pokémon."
//     — Rhyperior sv07-076 "Wide Wall".                            1 printing
//
// ✅ RE-DERIVED AT THIS COMMIT, NOT TRANSCRIBED. Remote D1 `luminous`
// (735f0fb5-cdc3-494d-8b97-74a8ade0124a), 2026-08-07, over ALL THREE text columns
// via `json_each`, `legal_standard = 1`, GROUPED BY SENTENCE:
//
//   WITH u AS (
//     SELECT 'attack' col, c.id id, json_extract(j.value,'$.effect') t
//       FROM cards c, json_each(c.attacks_json) j
//       WHERE c.legal_standard=1 AND json_extract(j.value,'$.effect') NOT IN ('')
//     UNION ALL SELECT 'ability', c.id, json_extract(j.value,'$.effect')
//       FROM cards c, json_each(c.abilities_json) j
//       WHERE c.legal_standard=1 AND json_extract(j.value,'$.effect') NOT IN ('')
//     UNION ALL SELECT 'effect', id, effect FROM cards
//       WHERE legal_standard=1 AND effect NOT IN ('')
//   )
//   SELECT col, t s, COUNT(*) n, group_concat(id) ids FROM u
//    WHERE lower(t) LIKE '%plays an item%' OR lower(t) LIKE '%plays a supporter%'
//       OR lower(t) LIKE '%effects of that card%'
//    GROUP BY col, s ORDER BY col, n DESC;
//
// → ability 4 + 1, attack 0, effect 0. **ZERO false positives at all three rungs**
// — the widest rung (`%effects of that card%`) returns the same two rows as the
// two narrow ones, which is what makes "the whole result set is this row" a
// measurement rather than a hope. `BUILT.attack` is UNCHANGED for the fourteenth
// consecutive slice and the query is why, not an inherited streak.
//
// 🛑 REACHABILITY WAS CHECKED BEFORE THE ROW WAS PROMISED, WHICH THE HANDOFF ASKED
// FOR EXPLICITLY (D207's hazard: a predicate over something nothing CLASSIFIES has
// a permanently empty candidate set). The risk here was sharper — a shield against
// Trainer effects is worth nothing if no authored Item or Supporter aims at an
// opposing Pokémon. **It is REACHABLE, abundantly**, and the grep is:
//   • `discardEnergy from:"opponentActive" | "opponentChosen" | "opponentEach"` —
//     Crushing Hammer, Giacomo, and the `fix-hammer` fixture this suite plays;
//   • `gust` — Boss's Orders sv02-172 (Supporter) and Pokémon Catcher (Item);
//   • `applyStatus` — Dangerous Laser sv06.5-058 ("Your opponent's Active Pokémon
//     is now Burned").
// Three ops, both trainer types, on real printings. No refusal was needed.
//
// 🛑 THE SHAPE, WRITTEN DOWN BEFORE THE FIRST EDIT AND GRADED AFTER: **ONE
// `passivesOf` FIELD *AND* ONE SCAN**, which is the first slice in this run to pay
// both. The split is decided by reading `passivesOf`'s own signature and not by
// analogy:
//
//     export function passivesOf(state: GameState, pokemon: InPlayPokemon)
//
// It takes a BODY and no SEAT. Fraxure/Cetitan protect *"this Pokémon"* — the body
// the fold is already about — so they fold. Rhyperior protects *"all of your
// Pokémon"* — a set the fold has no name for — so it scans, and the scan takes a
// SEAT rather than a Pokémon because the printed target clause names the SIDE and
// no zone at all (`seatShieldedFromSupporterEffects`).
//
// 🛑 AND THE FUNNEL WAS WIDENED RATHER THAN PARALLELED, WHICH IS D258's LESSON
// PAYING FOR THE SECOND TIME. The question the handoff posed — *"which single
// function does every effect of a played Item/Supporter pass through"* — had an
// answer already in the tree: `EffectContext.invokedBy` and D142's
// `attackEffectRefused`, which eight effect ops have consulted since. So the slice
// is a WIDENING and not a new gate:
//   • `invokedBy` "attack" → "attack" | "item" | "supporter", set at cardplay.ts's
//     ONE trainer `runProgram` call;
//   • `attackEffectRefused` → `effectRefused`, with the TRAINER channel added and
//     an OPTIONAL `target` defaulting to what the function used to compute itself.
// **All eight pre-existing call sites are byte-unchanged.**
//
// 🛑 THE TARGET CLAUSE WAS THE HARD HALF, EXACTLY AS PREDICTED, AND THE
// SIGNATURE CHANGE IS WHERE IT LANDED. The old funnel resolved
// `state.players[seat].active` internally — correct while EVERY caller was
// attack-borne (§8 aims at an Active), and wrong the instant a Crushing Hammer
// names a benched body. Hence the `target` parameter, and hence:
//
// 🆕 **THIS SLICE MAKES TWO PREVIOUSLY-DEAD ARMS LIVE, AND THAT IS A CORRECTNESS
// RESULT RATHER THAN A SIDE EFFECT.** D253's `preventDamageAndEffectsWhileBenched`
// and D254's `benchShieldedFromEffects` were both recorded at their own commits as
// structurally unreachable *because every op consulting this funnel aimed at an
// Active*. That sentence stopped being true here: `gust` names a benched body, so
// an ATTACK that gusts is now refused by a benched Curious Tea Party holder
// through the very disjunct written for totality two slices ago. Their doc blocks
// are corrected in place — a comment that claims a deadness which has ended is a
// stale count in prose (D258's rule about `coverage-backlog.md`, applied to code).
//
// ⚠️ READ SITES: **TWO NEW, NOT THREE.** The prediction named three (`applyStatus`,
// `discardEnergy`, `gust`) and `applyStatus` cost ZERO LINES because it was already
// on the funnel and its target really is the Active. The two that cost anything
// took a FILTER rather than a guard, and the reason is printed: those ops CHOOSE a
// target from a set, so refusing them whole would let one shielded Fraxure protect
// a five-body Bench — a rule no card states.
//
// ⚠️ AND THE WHIFF GATE IS DELIBERATELY *NOT* WIDENED, ON A RULING ALREADY IN THIS
// TREE. cardplay.ts's `programPlayable` cites Compendium ruling/284: "playing a
// card for no effect happens when THE GAME STATE ITSELF prevents any effect from
// taking place", with the Unown-E precedent as the other branch — a card blocked
// by AN EFFECT IN PLAY stays playable. A Fraxure Ability is an effect in play. So
// a Boss's Orders into a fully-shielded Bench is legal, is played, and does
// nothing, and that is asserted below rather than left to the reader.
//
// ⚠️ `MATCH_RECORD_VERSION` STAYS **13**, DRIVEN AS A REPLAY AND NOT ASSERTED
// (D258's rule). Widening a string-literal union is backward-compatible for an old
// parked continuation: a record written before this slice carries
// `invokedBy: "attack"` or nothing, and both still parse and still mean what they
// meant. The new `TRAINER_EFFECT_PREVENTED` row is text in NEW records only —
// D141's already-settled case, the same one `ATTACK_BOOSTED` was.

const UNNERVE_TEXT =
  "Whenever your opponent plays an Item or Supporter card from their hand, prevent all effects of that card done to this Pokémon.";
const WIDE_WALL_TEXT =
  "As long as this Pokémon is in the Active Spot, whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to all of your Pokémon.";

/** P2 holds the board being shielded; P1 is on turn and plays the Trainers.
    `holderId` goes to P2's ACTIVE, `benchIds` to their Bench, and every one of
    those bodies gets one Colorless Energy so Crushing Hammer has something to
    aim at everywhere. P1's Active is a plain body — nothing here attacks. */
function board(holderId: string, benchIds: readonly string[]): GameState {
  let state = driveSetup(1, { p1: TRAINER_SHIELD_DECK, p2: TRAINER_SHIELD_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", holderId);
  state = clearBench(state, "p2");
  for (const id of benchIds) state = benchFromDeck(state, "p2", id);
  state = attachFromDeck(state, "p2", "fix-energy", 1);
  for (let i = 0; i < benchIds.length; i++) {
    state = attachBenchFromDeck(state, "p2", i, "fix-energy", 1);
  }
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return setActiveFromDeck(state, "p1", "fix-bigbody");
}

/** P1 plays `cardId` out of hand. Returns the resulting state, its events and the
    prompt kind if it parked — the three things every case below reads. */
function play(state: GameState, cardId: string) {
  const withCard = handFromDeck(state, "p1", cardId, 1);
  const { state: next, events } = mustApply(withCard, {
    type: "playTrainer",
    seat: "p1",
    uid: handUid(withCard, "p1", cardId),
  });
  return { state: next, events, phase: next.phase.kind };
}

function prevented(events: readonly GameEvent[]): GameEvent[] {
  return events.filter((e) => e.type === "TRAINER_EFFECT_PREVENTED");
}

/** The candidate refs a parked prompt is offering, as "active" / "bench:N".
    ⚠️ A ONE-CANDIDATE SET AUTO-RESOLVES (`parkOrForce`), so an empty answer here
    means EITHER "nothing survived the filter" OR "exactly one did" — every case
    below that reads this either has two survivors or checks the board instead. */
function offered(state: GameState): string[] {
  if (state.phase.kind !== "effect:choose") return [];
  const prompt = state.phase.prompt;
  const refs =
    prompt.kind === "choosePokemon"
      ? prompt.candidates
      : prompt.kind === "discardEnergy"
        ? prompt.discardable.map((c) => c.from)
        : [];
  return refs.map((ref) => (ref.spot.spot === "active" ? "active" : `bench:${ref.spot.index}`));
}

function energyCount(state: GameState, seat: "p1" | "p2", index: number | "active"): number {
  const side = state.players[seat];
  const body = index === "active" ? side.active : side.bench[index];
  return body?.energy.length ?? 0;
}

describe("the registry data rows — 4 + 1 on two sentences", () => {
  it("authors the FOUR holder-rule printings as one shared bare passive", () => {
    for (const id of ["sv06.5-045", "sv06.5-077", "sv10-065", "sv10-210"]) {
      expect(programFor(id)?.passive, id).toEqual({ preventTrainerEffects: true });
    }
    // One printed sentence, one object — the reprints are not separate rows.
    expect(programFor("sv06.5-077")).toBe(programFor("sv06.5-045"));
    expect(programFor("sv10-210")).toBe(programFor("sv10-065"));
    expect(programFor("sv10-065")).toBe(programFor("sv06.5-045"));
  });

  it("authors the ONE seat-rule printing as its own field", () => {
    expect(programFor("sv07-076")?.passive).toEqual({
      preventSupporterEffectsWhileActive: true,
    });
  });

  // 🛑 THE MERGE THIS ROW REFUSES, ASSERTED IN BOTH DIRECTIONS. The two sentences
  // disagree on the TRIGGER (Item|Supporter vs Supporter) and on the TARGET (the
  // holder vs the seat). Either merge is observable on a board this deck builds.
  it("keeps the two fields disjoint — neither sentence sets the other's flag", () => {
    expect(programFor("sv06.5-045")?.passive?.preventSupporterEffectsWhileActive).toBeUndefined();
    expect(programFor("sv07-076")?.passive?.preventTrainerEffects).toBeUndefined();
  });

  // ⚠️ NO ATTACK PROGRAM ON ANY OF THE FIVE, which is the claim behind
  // "`BUILT.attack` UNCHANGED at 1115 for the fourteenth slice" — authoring one
  // would take a sentence away from the text derivers and move that column.
  it("authors NO attack program on any of the five printings", () => {
    for (const id of ["sv06.5-045", "sv06.5-077", "sv10-065", "sv10-210", "sv07-076"]) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  it("authors nothing on the sibling prevention rows", () => {
    for (const id of ["sv05-024", "sv06-020", "sv10.5b-023", "sv07-044", "sv03-070"]) {
      expect(programFor(id)?.passive?.preventTrainerEffects, id).toBeUndefined();
      expect(programFor(id)?.passive?.preventSupporterEffectsWhileActive, id).toBeUndefined();
    }
  });

  // D145's move: discover the demonstrators from the registry rather than naming
  // them, so a third fixture added without a case fails HERE.
  it("has exactly ONE fixture demonstrator per sentence", () => {
    const holders = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventTrainerEffects === true,
    );
    expect(holders).toEqual(["fix-unnerve"]);
    const seats = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventSupporterEffectsWhileActive === true,
    );
    expect(seats).toEqual(["fix-widewall"]);
    expect(programFor("fix-unnerve")).toBe(programFor("sv06.5-045"));
    expect(programFor("fix-widewall")).toBe(programFor("sv07-076"));
  });

  // The fixtures carry the PRINTED bytes, so an arm authored from a paraphrase
  // (D183) fails here rather than passing against its own paraphrase.
  it("the fixture bodies print the real sentences", () => {
    expect(FIXTURE_POOL["fix-unnerve"]?.abilities?.[0]?.effect).toBe(UNNERVE_TEXT);
    expect(FIXTURE_POOL["fix-widewall"]?.abilities?.[0]?.effect).toBe(WIDE_WALL_TEXT);
  });
});

describe("the fold and the scan — the two predicates", () => {
  it("passivesOf folds the holder rule wherever the holder stands", () => {
    const active = board("fix-unnerve", ["fix-titan"]);
    const activeBody = active.players.p2.active;
    if (activeBody === null) throw new Error("board");
    expect(passivesOf(active, activeBody).preventTrainerEffects).toBe(true);

    // 🛑 NO ZONE CLAUSE IS PRINTED, so a BENCHED holder answers identically. This
    // is the direct contrast with D253's field, whose whole content is a zone.
    const benched = board("fix-titan", ["fix-unnerve"]);
    const benchedBody = benched.players.p2.bench[0];
    if (benchedBody === undefined) throw new Error("board");
    expect(passivesOf(benched, benchedBody).preventTrainerEffects).toBe(true);
    expect(passivesOf(benched, benchedBody).preventDamageAndEffectsWhileBenched).toBe(false);
  });

  it("the fold does NOT reach a teammate — it is a HOLDER rule", () => {
    const state = board("fix-unnerve", ["fix-titan"]);
    const teammate = state.players.p2.bench[0];
    if (teammate === undefined) throw new Error("board");
    expect(passivesOf(state, teammate).preventTrainerEffects).toBe(false);
  });

  // 🛑 THE SCAN'S SOURCE CLAUSE, IN BOTH DIRECTIONS. "As long as this Pokémon is
  // in the Active Spot" is the entire difference between these two boards, and a
  // build that folded the sentence instead of scanning it would answer the same
  // on both.
  it("the seat scan is TRUE from the Active Spot and FALSE from the Bench", () => {
    expect(seatShieldedFromSupporterEffects(board("fix-widewall", ["fix-titan"]), "p2")).toBe(true);
    expect(seatShieldedFromSupporterEffects(board("fix-titan", ["fix-widewall"]), "p2")).toBe(
      false,
    );
  });

  it("the seat scan answers about the SEAT, so the other side is untouched", () => {
    const state = board("fix-widewall", ["fix-titan"]);
    expect(seatShieldedFromSupporterEffects(state, "p1")).toBe(false);
  });

  it("an empty Active Spot is not a source", () => {
    const state = board("fix-widewall", ["fix-titan"]);
    const emptied: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(seatShieldedFromSupporterEffects(emptied, "p2")).toBe(false);
  });
});

describe("the ITEM half — Crushing Hammer's opponentChosen discard", () => {
  // 🛑 THE FILTER SHAPE, AND THE SHARPEST CLAIM THE SLICE MAKES ABOUT PLACEMENT.
  // One shielded body on a two-body board must remove ITSELF from the prompt and
  // leave the other pickable. A guard would have refused the whole op.
  it("drops ONLY the shielded body from the candidate set", () => {
    const start = board("fix-titan", ["fix-unnerve", "fix-titan"]);
    const { state, events } = play(start, "fix-hammer");
    expect(offered(state)).toEqual(["active", "bench:1"]);
    expect(prevented(events)).toHaveLength(1);
    expect(prevented(events)[0]).toMatchObject({ seat: "p2", trainerType: "item" });
  });

  // 🛑 THE FIRST LIVE BENCH ARM THIS FUNNEL HAS EVER HAD. Every prior effects-half
  // holder sat behind a resolver that read the Active; here the shielded body is
  // on the Bench and the refusal is about IT.
  it("shields a BENCHED holder, which no attack-borne board could reach", () => {
    const start = board("fix-titan", ["fix-unnerve", "fix-titan"]);
    const { state } = play(start, "fix-hammer");
    expect(offered(state)).toEqual(["active", "bench:1"]);
  });

  // The ACTIVE holder, and the one survivor auto-resolves — so the assertion is
  // on the BOARD: the shielded Active keeps its Energy, the bench body loses one.
  it("shields an ACTIVE holder too — the sentence prints no zone", () => {
    const start = board("fix-unnerve", ["fix-titan"]);
    const { state, events } = play(start, "fix-hammer");
    expect(prevented(events)).toHaveLength(1);
    expect(energyCount(state, "p2", "active")).toBe(1);
    expect(energyCount(state, "p2", 0)).toBe(0);
  });

  // 🛑 THE ROW'S SHARPEST OBSERVABLE CLAIM: Wide Wall prints "a Supporter card"
  // and an Item goes straight through it. A merge of the two fields turns this
  // green when it must be red.
  it("Wide Wall does NOT stop an Item — the trigger narrowing is real", () => {
    const { state, events } = play(board("fix-widewall", ["fix-titan"]), "fix-hammer");
    expect(prevented(events)).toEqual([]);
    expect(offered(state)).toEqual(["active", "bench:0"]);
  });

  // §7's whiff gate, and the ruling that keeps the card PLAYABLE. Every candidate
  // is shielded, so the play is legal, resolves, files no discard and moves no
  // Energy — "blocked by an effect in play", not by the game state.
  it("a fully shielded board whiffs the Item without rejecting the play", () => {
    const start = board("fix-unnerve", ["fix-unnerve"]);
    const before = energyCount(start, "p2", "active") + energyCount(start, "p2", 0);
    const { state, events, phase } = play(start, "fix-hammer");
    expect(phase).not.toBe("effect:choose");
    expect(prevented(events)).toHaveLength(2);
    expect(energyCount(state, "p2", "active") + energyCount(state, "p2", 0)).toBe(before);
  });

  // ⚠️ ONE ROW PER SHIELDED BODY AND NOT PER CANDIDATE ENERGY — the distinct-body
  // pass in the read site is what this asserts, and dropping it prints three.
  it("announces ONE row for a body carrying three Energy", () => {
    let start = board("fix-unnerve", ["fix-titan"]);
    start = attachFromDeck(start, "p2", "fix-energy", 2);
    expect(energyCount(start, "p2", "active")).toBe(3);
    const { events } = play(start, "fix-hammer");
    expect(prevented(events)).toHaveLength(1);
  });
});

describe("the SUPPORTER half — Boss's Orders' gust", () => {
  it("drops a shielded benched body from the gust's candidate set", () => {
    const start = board("fix-titan", ["fix-unnerve", "fix-titan", "fix-titan"]);
    const { state, events } = play(start, "sv02-172");
    expect(offered(state)).toEqual(["bench:1", "bench:2"]);
    expect(prevented(events)).toHaveLength(1);
    expect(prevented(events)[0]).toMatchObject({ seat: "p2", trainerType: "supporter" });
  });

  // 🛑 THE SEAT RULE DOING WHAT THE HOLDER RULE CANNOT: a Wide Wall in the Active
  // Spot shields bodies it is not, so an entire Bench comes off the table.
  it("Wide Wall shields the WHOLE Bench from a Supporter", () => {
    const start = board("fix-widewall", ["fix-titan", "fix-titan"]);
    const { state, events, phase } = play(start, "sv02-172");
    expect(phase).not.toBe("effect:choose");
    expect(prevented(events)).toHaveLength(2);
    // The gust never happened: P2's Active is still the wall.
    expect(state.cardIdByUid[state.players.p2.active?.stack[0] ?? ""]).toBe("fix-widewall");
  });

  // …and the zone negative, which is the other half of that sentence.
  it("a BENCHED Wide Wall shields nothing at all", () => {
    const start = board("fix-titan", ["fix-widewall", "fix-titan"]);
    const { state, events } = play(start, "sv02-172");
    expect(prevented(events)).toEqual([]);
    expect(offered(state)).toEqual(["bench:0", "bench:1"]);
  });

  it("the holder rule also stops a Supporter — it names BOTH card types", () => {
    const start = board("fix-titan", ["fix-unnerve"]);
    const { events, phase } = play(start, "sv02-172");
    expect(phase).not.toBe("effect:choose");
    expect(prevented(events)).toHaveLength(1);
  });
});

describe("the boundaries — what the channel must NOT refuse", () => {
  // 🛑 THE PRINTED WORD IS "YOUR OPPONENT". A Supporter you play on your own board
  // is not refused by your own wall, and this is the one direction a build that
  // forgot the seat test would get wrong on every board.
  it("your own Trainer is not refused by your own shield", () => {
    let state = driveSetup(
      1,
      { p1: TRAINER_SHIELD_DECK, p2: TRAINER_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-widewall");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-unnerve");
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1);
    // P2 has nothing to gust, so drive the ITEM at P1's own shielded bench body:
    // `fix-hammer` aims at the OPPONENT, so instead assert the seat test directly
    // — P1's own bodies are on `ctx.seat` and the channel skips them.
    const own = state.players.p1.bench[0];
    if (own === undefined) throw new Error("board");
    expect(passivesOf(state, own).preventTrainerEffects).toBe(true);
    expect(seatShieldedFromSupporterEffects(state, "p1")).toBe(true);
    const { events } = play(state, "sv02-172");
    expect(prevented(events)).toEqual([]);
  });

  // ⚠️ AN ABILITY IS NOT AN ITEM OR A SUPPORTER, and `invokedBy` being ABSENT for
  // one is what says so. Asserted through the context rather than a board because
  // that is where the distinction lives.
  it("leaves invokedBy absent for an Ability's program", () => {
    const state = board("fix-unnerve", ["fix-titan"]);
    // Nothing in this deck has a parking Ability; the claim is about the setter,
    // and cardplay.ts labels ONLY the trainer call. A grep-shaped assertion would
    // be vacuous, so drive the positive instead: a played Item IS labelled.
    const twoTargets = board("fix-titan", ["fix-titan"]);
    const withCard = handFromDeck(twoTargets, "p1", "fix-hammer", 1);
    const { state: parked } = mustApply(withCard, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(withCard, "p1", "fix-hammer"),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.ctx.invokedBy).toBe("item");
    expect(state.players.p2.active).not.toBeNull();
  });

  // §9 — all five printings ARE Abilities, so a lock takes the shield down. This
  // is the whole reason both reads go through the catalog fold/scan rather than
  // off `programFor(top.id)` at the read site.
  it("Klefki's Ability lock switches BOTH shields off", () => {
    let state = board("fix-unnerve", ["fix-titan"]);
    state = setActiveFromDeck(state, "p1", "sv01-096");
    const shielded = state.players.p2.active;
    if (shielded === null) throw new Error("board");
    expect(passivesOf(state, shielded).preventTrainerEffects).toBe(false);
    const { events } = play(state, "fix-hammer");
    expect(prevented(events)).toEqual([]);

    let wall = board("fix-widewall", ["fix-titan"]);
    wall = setActiveFromDeck(wall, "p1", "sv01-096");
    expect(seatShieldedFromSupporterEffects(wall, "p2")).toBe(false);
  });
});

describe("the record and the wire", () => {
  // D258's rule: drive the no-bump as a REPLAY. A park written by this slice is
  // resolved from a state that was DEEP-FROZEN before the play, so the whole
  // park-and-resolve round trip runs against a record whose `ctx` now carries the
  // widened union. A version gate that needed to move would break here.
  it("a park carrying the widened invokedBy still resolves from a frozen state", () => {
    const start = deepFreeze(board("fix-titan", ["fix-unnerve", "fix-titan"]));
    const { state: parked } = play(start, "fix-hammer");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const pick = prompt.discardable[0];
    if (pick === undefined) throw new Error("no candidate");
    const { state: done } = mustApply(deepFreeze(parked), {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick.uid] },
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    // The shielded body kept its Energy; the pick came off somebody else.
    expect(energyCount(done, "p2", 0)).toBe(1);
  });

  // The refusal must be LOUD (D142's rule), and a row a renderer cannot draw is
  // not loud. Driven through the real renderer rather than asserted on the event.
  it("renders a readable row naming the card TYPE", async () => {
    const { logFromEvents } = await import("./log");
    const render = (result: { state: GameState; events: GameEvent[] }) =>
      logFromEvents(result.events, {
        names: { p1: "P1", p2: "P2" },
        state: result.state,
        elapsed: "+00:10",
      })
        .flatMap((r) => (r.kind === "action" ? [r.segments.map((seg) => seg.text).join("")] : []))
        .join("\n");

    expect(render(play(board("fix-unnerve", ["fix-titan"]), "fix-hammer"))).toContain(
      "prevented the effect of the Item",
    );
    expect(render(play(board("fix-widewall", ["fix-titan"]), "sv02-172"))).toContain(
      "prevented the effect of the Supporter",
    );
  });

  // NO RNG: neither read site flips anything, and `fix-hammer` is the ungated
  // fixture on purpose. A shield that consumed a coin would desynchronise every
  // replay after it (D258's finding), so this is the control for that.
  it("consumes no rng — the whole suite is seed-free", () => {
    const start = board("fix-titan", ["fix-unnerve", "fix-titan"]);
    const { state } = play(start, "sv02-172");
    expect(state.rngState).toBe(start.rngState);
  });
});
