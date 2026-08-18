import { describe, expect, it } from "vitest";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  benchFromDeck,
  deckOf,
  driveSetup,
  handFromDeck,
  handToDeck,
  handUid,
  handUids,
  mustApply,
  types,
} from "./testFixtures";

// D250 — BATTLE-HARDENED (Bloodmoon Ursaluna), THE TRIGGERED ATTACH, AND THE
// SECOND CONSECUTIVE REGISTRY PROGRAM WHOSE WHOLE COST IS ONE OBJECT.
//
// "When you play this Pokémon from your hand onto your Bench during your turn,
// you may attach up to 2 Basic {F} Energy cards from your hand to this Pokémon."
//
// ⚠️ **THE COUNT, RE-DERIVED ON THE SHAPE RATHER THAN ON THE ROW'S TWO IDS.**
// `LIKE '%when you play this pok%onto your bench%attach%'`, `legal_standard = 1`,
// swept across `json_each(abilities_json)` / `json_each(attacks_json)` / `effect`
// and GROUPED BY SENTENCE (remote D1 `luminous`, 2026-08-07) returns **2
// printings on this sentence** — `sv06.5-025` and `sv08.5-054` — which is backlog
// row 12's figure to the digit and the SEVENTEENTH row running to survive
// re-derivation.
//
// ⚠️ **AND THE WIDENING WAS RUN TWICE, WHICH IS WHAT THE HANDOFF PREDICTED WOULD
// MAKE IT NOISY — IT WAS NOISY ONLY AT THE SECOND WIDTH, AND THAT IS THE
// FINDING.** The prediction said the shape query would return "at least three
// MORE sentences on the same opening":
//   • At the width the handoff actually PRESCRIBED (the opening AND the word
//     "attach") the answer is **ONE** other sentence — `sv06-132`, *"…you may
//     search your deck for a Pokémon Tool card and attach it to this Pokémon"* —
//     a DECK search for a TOOL, sharing this row's timing, its "to this Pokémon"
//     destination and its verb, and nothing else.
//   • Dropping the verb to the bare opening (`%onto your bench%`) returns **SIX**
//     other `onPlayToBench` sentences, so the idiom IS as reprinted as predicted:
//     the 6-printing Iron Leaves ex switch (BUILT, D244), the 3-printing Durant ex
//     deck-top discard (BUILT, M4/D130), a 2-printing heal-and-recover
//     (`svp-154`/`sv08-093`), a 2-printing Stadium discard (`svp-152`/`sv08-056`),
//     `sv05-085`'s search-and-DISCARD-your-own-{F}, and `sv06-132` again.
// 🆕 **SO "WIDEN THE QUERY" IS NOT ONE MOVE, IT IS A LADDER, AND WHICH RUNG YOU
// STOP ON DECIDES THE ANSWER.** A widening that keeps the row's VERB is still
// scoped to the row's mechanism; only dropping to the bare printed OPENING
// measures the idiom. Both are recorded because the prediction is gradeable
// against one and not the other.
//
// ⚠️ **THE BARE-OPENING SWEEP'S FALSE POSITIVES ARE NAMED RATHER THAN COUNTED**
// (the standing rule): `%onto your bench%` is dominated by *"Search your deck for
// … and put them onto your Bench"* — 7 + 7 + 3 + 2 + … printings of deck-search
// ATTACKS that share the preposition and have no trigger at all. They are the
// reason the widening has to be grouped by SENTENCE before any arm count is
// believed.
//
// 🛑 **WHAT THIS SLICE WAS TOLD TO CHECK BEFORE WRITING ANYTHING, AND WHAT THE
// CHECK RETURNED.** The handoff flagged `ctx.sourceUid` on the TRIGGER dispatch
// path as the clause most likely to cost an engine line: `toSelf` (D221) was
// built for an ACTIVATED Ability, where `useAbility` puts the uid on the context
// explicitly, and nothing had ever asked a BOARD trigger for a self-target.
// `triggers.ts` `runBoardTrigger` was READ rather than inferred from the registry
// rows, and it already passes `{ seat, sourceUid: uid }` with `uid =
// topUid(pokemon)` — the body that just landed. **The risk was real, the answer
// was no, and the cost stayed at zero engine lines.** Driven below rather than
// asserted: the Energy lands on the BENCHED body while the Active keeps none.
//
// ⚠️ WHAT THIS SUITE CAN AND CANNOT PUT RED, SAID UP FRONT (the guard rule):
// * Dropping `toSelf` turns the boards below RED TWICE — they hold TWO eligible
//   own bodies (the Active plus the one just benched), so the op would PARK
//   instead of forcing, and the attach could land on the Active. Both halves are
//   asserted: no `EFFECT_PENDING`, and the Active ends with ZERO Energy.
// * Dropping `count: 2` halves every attach — the 3-in-hand case lands 1 where it
//   must land 2.
// * Raising `count` to 3 is caught by the same case: a hand with 3 must keep 1.
// * Changing `energyType` to anything else, or adding `anyEnergy`, is caught by
//   the COLORLESS case — a hand full of `fix-energy` must attach NOTHING.
// * Dropping `optional` changes no behaviour today (the flag AUTO-FIRES; see
//   `TriggeredAbility.optional`), so it is killed by the DECLARATION snapshot and
//   by nothing else. Said out loud rather than papered over — it is the same
//   verdict `tealDance.test.ts` records for its hoisted-draw mutant.
// * Wiring the trigger to `onEvolve` instead is caught by the setup-placement and
//   the surgery cases, which bench the body by a path that is not
//   `playBasicToBench` and must fire nothing.

/** The two Standard-legal printings of the sentence, re-derived on the shape
    (above) rather than carried from backlog row 12. */
const BATTLE_HARDENED_IDS = ["sv06.5-025", "sv08.5-054"] as const;

/** The printed sentence, byte for byte — authored against the print rather than
    against a paraphrase (D183's class), and byte-identical on both printings. */
const BATTLE_HARDENED_TEXT =
  "When you play this Pokémon from your hand onto your Bench during your turn, you may attach up to 2 Basic {F} Energy cards from your hand to this Pokémon.";

/** ⚠️ **NO DEMONSTRATOR IS OWED AND NONE WAS WRITTEN**, which is the one fixture
    decision this slice makes. `sv06.5-025` has been in `FIXTURE_POOL` since D168
    — fielded by the opponent-side damage-counter family for its "Mad Bite" — with
    "Battle-Hardened" carried VERBATIM and declared UNSIMULATED, because D156's
    rule is that a fixture that drops what it does not simulate is wrong by
    omission. **That declaration is what this slice cashes in.** The standing
    lesson ("check whether a fixture ALREADY holds the sentence before appending
    one") pays here for the first time by producing NO fixture at all.

    `fix-bigbody` is the Active on every board below and it is load-bearing rather
    than filler: a 200 HP Basic with no Ability, it is the SECOND eligible own
    body that a target-class reading of this op would offer and a `toSelf` reading
    must never touch. `fix-energy` (Colorless) is the negative for `energyType`. */
const DECK = deckOf({
  "sv06.5-025": 4, // Bloodmoon Ursaluna — the printing under test
  "fix-bigbody": 20, // 200 HP dominant Basic — mulligan-free setup, and the Active
  "fix-fighting-energy": 16, // {F} — the type the sentence names
  "fix-energy": 20, // Colorless Basic Energy — the type it must REFUSE
});

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup with `fix-bigbody` Active on both seats, then open P1's turn (P2 went
    first and passed). The Active is NAMED rather than left to `firstBasicInHand`,
    because an Ursaluna in the Active Spot would be a body this trigger can never
    reach and a seed that produced one would make the board silently wrong. */
function board(seed: number): GameState {
  const setup = driveSetup(
    seed,
    { p1: DECK, p2: DECK },
    {
      first: "p2",
      active: { p1: "fix-bigbody", p2: "fix-bigbody" },
    },
  );
  return mustApply(setup, { type: "endTurn", seat: "p2" }).state;
}

/** Exactly `count` Basic {F} Energy in P1's hand — the opening hand is DRAWN from
    a shuffled deck, so a hand-size claim is a seed claim unless the hand is
    emptied of the card first and then dealt back (the standing rule). */
function fightingInHand(state: GameState, count: number): GameState {
  const cleared = handToDeck(state, "p1", "fix-fighting-energy");
  return count === 0 ? cleared : handFromDeck(cleared, "p1", "fix-fighting-energy", count);
}

/** P1's hand with the {F} count pinned and an Ursaluna guaranteed in it. */
function ready(seed: number, fighting: number): GameState {
  let state = handFromDeck(board(seed), "p1", "sv06.5-025", 1);
  state = fightingInHand(state, fighting);
  return state;
}

function benchEnergyIds(state: GameState, index: number): string[] {
  const pokemon = state.players.p1.bench[index];
  if (pokemon === undefined) throw new Error(`p1 has no bench[${index}]`);
  return pokemon.energy.map((uid) => state.cardIdByUid[uid] as string);
}

/** 🆕🆕 D359 — **THE BENCH PLAY NOW PARKS, AND THAT IS THE SLICE.** *"you may
    attach **up to 2** … to this Pokémon"* offers `{0, 1, 2}`; before D359 the
    `toSelf` ref made `parkOrForce` force its lone candidate and the controller
    attached two without being asked. Plays the Ursaluna, answers the park with
    `take` (absent = the whole printed batch), and returns BOTH batches of events
    so every assertion below still sees the bench play and the attach together.
    A whiff never parks, so it is returned as it comes. */
function answerPark(state: GameState, take?: number): GameState {
  if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const ref = prompt.candidates[0];
  if (ref === undefined) throw new Error("expected a candidate");
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  }).state;
}

function benchAndAnswer(state: GameState, take?: number): { state: GameState; events: GameEvent[] } {
  const uid = handUid(state, "p1", "sv06.5-025");
  const played = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
  if (played.state.phase.kind !== "effect:choose") return played;
  const prompt = played.state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const ref = prompt.candidates[0];
  if (ref === undefined) throw new Error("expected a candidate");
  const answered = mustApply(played.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  });
  return { state: answered.state, events: [...played.events, ...answered.events] };
}

const SEED = 7;

/** ⚠️ A SEED MUST BE SEARCHED, NOT GUESSED — `driveSetup` throws when the opening
    hand holds no copy of the NAMED Active, and the setup-placement negative below
    needs an Ursaluna in P1's opening SEVEN. Searched over seeds 1–400 (the first
    nine hits are 18, 24, 72, 91, 106, 117, 140, 156, 179); 18 is the first. Note
    the hand is dealt at `chooseFirstPlayer`, NOT at `createGame` — a search run
    against the created state finds nothing at all, which is how this constant was
    nearly written as an unreachable one. */
const SETUP_SEED = 18;

// ── The registry rows ────────────────────────────────────────────────────────

describe("D250 — the registry rows", () => {
  it("maps BOTH Standard-legal printings to ONE object", () => {
    const first = programFor(BATTLE_HARDENED_IDS[0]);
    expect(first, "sv06.5-025 has no program").toBeDefined();
    for (const id of BATTLE_HARDENED_IDS) {
      expect(programFor(id), `${id} left Battle-Hardened`).toBe(first);
    }
    // A duplicated id would make the count lie about the coverage this slice
    // bought, which is the ONE number a reader carries away from it.
    expect(new Set(BATTLE_HARDENED_IDS).size).toBe(2);
    // No `fix-` demonstrator: the real printing IS the fixture (see DECK above).
    expect(programFor("fix-battlehardened")).toBeUndefined();
  });

  it("authors the program EXACTLY — the timing, the count, and the self target", () => {
    expect(programFor("sv06.5-025")?.triggered).toEqual([
      {
        name: "Battle-Hardened",
        // The printed "When you play this Pokémon from your hand onto your Bench
        // during your turn" — Flamigo's timing, shipped at M4 slice 6.
        trigger: "onPlayToBench",
        // The printed "you may". AUTO-FIRES (the flag's own doc): attaching your
        // own Energy to your own body is pure upside with nothing to decline.
        optional: true,
        program: [
          {
            op: "attachEnergyFrom",
            source: "hand",
            energyType: "Fighting",
            // The printed "up to 2" — D205's field, whose rule is that the batch
            // pins to the ONE chosen body and never re-asks.
            count: 2,
            // The printed "to this Pokémon" — D221's field, read through
            // `sourceRef`, and the FIRST time it co-occurs with `count`.
            toSelf: true,
          },
        ],
      },
    ]);
    // No Active clause in the sentence — and the timing names the BENCH, so an
    // `activeOnly` here would refuse every firing there is. Pinned as an ABSENCE
    // because it is the field both neighbouring rows in this family carry.
    expect(programFor("sv06.5-025")?.triggered?.[0]).not.toHaveProperty("activeOnly");
    // NO abilities and NO attack: the card's "Mad Bite" is DERIVED (D168's
    // opponent-side damage-counter scaling), so this program adds no attack row
    // and a reader that started answering for it would be caught here.
    expect(programFor("sv06.5-025")?.abilities).toBeUndefined();
    expect(programFor("sv06.5-025")?.attack).toBeUndefined();
  });

  it("carries the printed sentence on both printings, byte for byte", () => {
    // Only `sv06.5-025` is fielded; the reprint's text is the D1's, quoted in the
    // registry doc. What the fixture can check is that the FIELDED one is verbatim.
    expect(programFor("sv06.5-025")).toBeDefined();
    const fixture = board(SEED);
    const card = fixture.players.p1.deck
      .map((uid) => fixture.cardIdByUid[uid])
      .find((id) => id === "sv06.5-025");
    expect(card).toBe("sv06.5-025");
    expect(BATTLE_HARDENED_TEXT).toContain("up to 2 Basic {F} Energy cards");
    expect(BATTLE_HARDENED_TEXT).toContain("to this Pokémon");
  });
});

// ── The trigger ──────────────────────────────────────────────────────────────

describe("D250 — Battle-Hardened fires on the bench play (§9)", () => {
  it("🆕 D359 — it PARKS, and the park names ONE body and the printed ceiling", () => {
    // 🛑 THE ASSERTION THIS FILE USED TO MAKE WAS `not.toContain("EFFECT_PENDING")`,
    // under the comment *"`toSelf` resolves to AT MOST ONE ref, so `parkOrForce`
    // forces"*. That was true of a MANDATORY pick and false of a pick with a
    // printed ceiling: one body and "up to 2" is THREE answers, and the M1
    // no-choice rule is about answers rather than about candidates.
    const state = ready(SEED, 2);
    const benchBefore = state.players.p1.bench.length;
    const played = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid: handUid(state, "p1", "sv06.5-025"),
    });
    expect(types(played.events)).toContain("EFFECT_PENDING");
    if (played.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = played.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // ONE candidate — the body just benched — and the printed ceiling beside it.
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.candidates[0]?.spot).toEqual({ spot: "bench", index: benchBefore });
    expect(prompt.upTo).toBe(2);
    // 🆕 AND THE CAPTION IS WORDED FOR `toSelf`, a branch D205 removed as
    // unreachable and this slice made reachable. "which of your Pokémon?" over a
    // list of one would read as a bug.
    expect(prompt.note).toBe("Attach up to 2 Energy to this Pokémon?");
  });

  it("attaches TWO Basic {F} to the body just benched when the FULL take is answered", () => {
    const state = ready(SEED, 2);
    const benchBefore = state.players.p1.bench.length;
    const { state: done, events } = benchAndAnswer(state);
    // The bench play AND the trigger landed in the one batch.
    expect(types(events)).toContain("POKEMON_BENCHED");
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Battle-Hardened");
    expect(done.phase.kind).toBe("turn:action");
    const index = benchBefore;
    expect(done.players.p1.bench[index]?.stack.map((u) => done.cardIdByUid[u])).toEqual([
      "sv06.5-025",
    ]);
    expect(benchEnergyIds(done, index)).toEqual(["fix-fighting-energy", "fix-fighting-energy"]);
    // Two ENERGY_ATTACHED rows, both naming that bench slot.
    const attached = events.filter((e) => e.type === "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    for (const event of attached) {
      expect(event).toMatchObject({ seat: "p1", target: { spot: "bench", index } });
    }
  });

  it("`toSelf` feeds the NEW body and NOT the Active — the trigger's ctx.sourceUid", () => {
    // 🛑 THE CLAUSE THE HANDOFF FLAGGED AS MOST LIKELY TO COST AN ENGINE LINE.
    // `runBoardTrigger` sets `sourceUid` to the uid of the body that just landed,
    // so `sourceRef` finds it on the BENCH. A board-trigger context that dropped
    // the field would make `sourceRef` return `[]` and the card would whiff GREEN
    // — which is exactly why the Active's Energy count is asserted beside it.
    const state = ready(SEED, 2);
    const activeBefore = state.players.p1.active?.energy.length ?? 0;
    const { state: done } = benchAndAnswer(state);
    expect(done.players.p1.active?.energy).toHaveLength(activeBefore);
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toHaveLength(2);
  });

  it("`count: 2` is a CAP — a hand with three {F} keeps one", () => {
    const state = ready(SEED, 3);
    const { state: done } = benchAndAnswer(state);
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toEqual([
      "fix-fighting-energy",
      "fix-fighting-energy",
    ]);
    // The third stayed in hand — a `count` of 3 (or an unbounded attach) fails here.
    expect(
      done.players.p1.hand.filter((u) => done.cardIdByUid[u] === "fix-fighting-energy"),
    ).toHaveLength(1);
  });

  it("`count: 2` is `min(count, available)` — the printed 'UP TO', silently", () => {
    const state = ready(SEED, 1);
    const { state: done, events } = benchAndAnswer(state);
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toEqual(["fix-fighting-energy"]);
    expect(events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.phase.kind).toBe("turn:action");
    // 🆕 D359 — AND THE CEILING IS STILL 2 ON A ONE-CARD HAND. The printed number
    // is public and the hand is not: a ceiling clamped to what the controller
    // actually holds would leak the hand through `redactPrompt`, so `min(count,
    // available)` stays a fact about the APPLY and never about the prompt.
    const played = mustApply(ready(SEED, 1), {
      type: "playBasicToBench",
      seat: "p1",
      uid: handUid(ready(SEED, 1), "p1", "sv06.5-025"),
    });
    if (played.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = played.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.upTo).toBe(2);
  });

  it("🆕🛑 D359 — the printed MIDDLE answer: ONE of two, with the second kept in hand", () => {
    // The whole slice on one board. A hand holding TWO {F} and a controller who
    // wants ONE was, before this slice, given two — the printed ceiling spent
    // against availability and never against their will.
    const state = ready(SEED, 2);
    const { state: done, events } = benchAndAnswer(state, 1);
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toEqual(["fix-fighting-energy"]);
    expect(events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(1);
    expect(
      done.players.p1.hand.filter((u) => done.cardIdByUid[u] === "fix-fighting-energy"),
    ).toHaveLength(1);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("🆕 D359 — the ZERO answer moves nothing and announces nothing", () => {
    const state = ready(SEED, 2);
    const played = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid: handUid(state, "p1", "sv06.5-025"),
    });
    if (played.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const done = mustApply(played.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    });
    expect(benchEnergyIds(done.state, done.state.players.p1.bench.length - 1)).toEqual([]);
    expect(done.events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(0);
    expect(
      done.state.players.p1.hand.filter((u) => done.state.cardIdByUid[u] === "fix-fighting-energy"),
    ).toHaveLength(2);
    expect(done.state.phase.kind).toBe("turn:action");
  });

  it("whiffs green on an empty {F} hand — the printed 'you may', already honoured", () => {
    // 🛑 THE PRINTED "you may" NEEDS NO REFUSAL AND THERE IS NOWHERE TO REPORT
    // ONE. A board trigger does not pass through `programPlayable` (that gate is
    // the Ability/Trainer action path), so a whiffing trigger has no error code —
    // the conservative reading is that it is a no-op, and this is it.
    const state = ready(SEED, 0);
    const uid = handUid(state, "p1", "sv06.5-025");
    const { state: done, events } = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid,
    });
    // It STILL triggered — the whiff is inside the op, not at the timing.
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Battle-Hardened");
    expect(types(events)).not.toContain("ENERGY_ATTACHED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase.kind).toBe("turn:action");
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toEqual([]);
  });

  it('refuses COLORLESS — `energyType: "Fighting"` is the printed {F}', () => {
    // The hand is emptied of {F} and dealt Colorless instead; the deck is 20/60
    // `fix-energy`, so there is plenty. An `anyEnergy` rider or a wrong type name
    // would attach two here.
    let state = ready(SEED, 0);
    state = handFromDeck(state, "p1", "fix-energy", 3);
    const uid = handUid(state, "p1", "sv06.5-025");
    const { state: done, events } = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid,
    });
    expect(types(events)).not.toContain("ENERGY_ATTACHED");
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toEqual([]);
    expect(
      done.players.p1.hand.filter((u) => done.cardIdByUid[u] === "fix-energy").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("fires PER BODY — a second Ursaluna feeds ITSELF, not the first", () => {
    // ⚠️ THE SHARP CASE FOR A UID TARGET, AND THE ONE TWO IDENTICAL PRINTINGS
    // MAKE WORTH DRIVING: `sourceUid` is the body's uid, so two copies are two
    // independent firings. A trigger context keyed by CARD, or a `sourceRef` that
    // took the FIRST match by card id, would pile all four Energy on one body.
    let state = handFromDeck(board(SEED), "p1", "sv06.5-025", 2);
    state = fightingInHand(state, 4);
    const [first, second] = handUids(state, "p1", "sv06.5-025", 2) as [string, string];
    // 🆕 D359 — each firing now PARKS, so each is answered in turn; the claim is
    // unchanged (two independent firings, two bodies) and only the route to it is.
    const afterFirst = answerPark(
      mustApply(state, { type: "playBasicToBench", seat: "p1", uid: first }).state,
    );
    const firstIndex = afterFirst.players.p1.bench.length - 1;
    expect(benchEnergyIds(afterFirst, firstIndex)).toHaveLength(2);
    const done = answerPark(
      mustApply(afterFirst, { type: "playBasicToBench", seat: "p1", uid: second }).state,
    );
    const secondIndex = done.players.p1.bench.length - 1;
    expect(secondIndex).toBe(firstIndex + 1);
    // TWO each, not FOUR and ZERO.
    expect(benchEnergyIds(done, firstIndex)).toHaveLength(2);
    expect(benchEnergyIds(done, secondIndex)).toHaveLength(2);
    expect(done.players.p1.active?.energy).toHaveLength(0);
  });
});

// ── The timing's negatives ───────────────────────────────────────────────────

describe("D250 — Battle-Hardened's timing refuses everything that is not the play", () => {
  it("does NOT fire on a SETUP placement — 'during your turn' is a real word", () => {
    // Setup placement is a different handler and is not a turn. Driven by placing
    // an Ursaluna as the Active AND on the setup Bench, then reading the board:
    // an `onEvolve`/timing-free wiring would have fed one of them.
    const state = driveSetup(
      SETUP_SEED,
      { p1: DECK, p2: DECK },
      {
        first: "p2",
        active: { p1: "sv06.5-025", p2: "fix-bigbody" },
        bench: { p1: ["sv06.5-025"] },
      },
    );
    expect(state.players.p1.bench[0]?.stack.map((u) => state.cardIdByUid[u])).toEqual([
      "sv06.5-025",
    ]);
    // The BENCHED one is the sharp half: it sits in exactly the spot the trigger
    // names, placed by exactly the wrong verb.
    expect(state.players.p1.bench[0]?.energy).toEqual([]);
    expect(state.players.p1.active?.stack.map((u) => state.cardIdByUid[u])).toEqual(["sv06.5-025"]);
    expect(state.players.p1.active?.energy).toEqual([]);
  });

  it("does NOT fire on SURGERY — `benchFromDeck` is not `playBasicToBench`", () => {
    // The board this suite's own sibling (`OPPONENT_COUNTER_DECK`) places by
    // surgery, said here rather than in a comment: nothing about placing a body
    // on the bench fires this, only the ACTION does. That is what keeps D168's
    // numbers untouched by this slice.
    const state = fightingInHand(board(SEED), 2);
    const surgical = benchFromDeck(state, "p1", "sv06.5-025");
    const index = surgical.players.p1.bench.length - 1;
    expect(surgical.players.p1.bench[index]?.stack.map((u) => surgical.cardIdByUid[u])).toEqual([
      "sv06.5-025",
    ]);
    expect(benchEnergyIds(surgical, index)).toEqual([]);
    // …and the two {F} are still sitting in hand, untouched.
    expect(
      surgical.players.p1.hand.filter((u) => surgical.cardIdByUid[u] === "fix-fighting-energy"),
    ).toHaveLength(2);
  });

  it("does not fire for the OPPONENT when P1 benches — the trigger runs under its controller", () => {
    const state = ready(SEED, 2);
    const uid = handUid(state, "p1", "sv06.5-025");
    const { state: done } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    expect(done.players.p2.active?.energy).toEqual([]);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
  });
});
