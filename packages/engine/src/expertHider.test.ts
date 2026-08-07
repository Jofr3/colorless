import { describe, expect, it } from "vitest";
import { coinFlipShieldPrevents, passivesOf } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { type CoinFace, flipCoin } from "./rng";
import {
  COIN_FLIP_SHIELD_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.173.0 → 0.174.0 — the COIN-FLIP DEFENSIVE ABILITY (P3-M5 long tail, D258,
// backlog row 15-C). TWO printed sentences, FIVE Standard-legal ability printings:
//
//   "If this Pokémon has any {D} Energy attached and is damaged by an attack, flip
//    a coin. If heads, prevent that damage."
//        Fezandipiti `sv06-096` / `sv06.5-073` / `sv08.5-045` "Adrena-Pheromone" — 3
//   "If any damage is done to this Pokémon by attacks, flip a coin. If heads,
//    prevent that damage."
//        Kecleon `sv08-150` / `sv08-213` "Expert Hider" — 2
//
// ✅ THE CENSUS, RE-RUN AT THIS COMMIT rather than transcribed from the handoff.
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a), all three text
// columns via `json_each`, `legal_standard = 1`, GROUPED BY SENTENCE, lower-cased.
//
// RUNG 1 — `%prevent that damage%` ∪ `%flip a coin%prevent%`:
//   ability  3 / 1   "…has any {D} Energy attached…"                ◀ THIS SLICE
//   ability  2 / 1   "If any damage is done to this Pokémon…"       ◀ THIS SLICE
//   attack  15 / 1   "Flip a coin. If heads, during your opponent's next turn,
//                     prevent all damage from and effects of attacks…"  BUILT D142
//   attack   4 / 1   "…prevent all damage done to this Pokémon by attacks."  D142
//   attack   2 / 1   "Flip a coin. If tails, this attack does nothing. If heads,
//                     during your opponent's next turn, prevent all damage…"  D142
//   effect   0 / 0
// RUNG 2 — WIDER: `%prevent%` ∧ `%coin%`, same three columns. Returns **the same
//   five rows and nothing else**, so this row has ZERO false positives at any width
//   and the 21 attack printings are the only thing the verb shares — every one of
//   them the DURATED §11 spelling, which is `preventBlock.test.ts`'s and not this
//   file's. (D255 found the identical false-positive class one verb over.)
//
// 🆕 AND NOTE HOW THIS ROW WAS FOUND, BECAUSE IT IS THE METHOD AND NOT THE CARD.
// These five say "prevent THAT damage"; every rung of D255's ladder swept "prevent
// ALL damage", so the family was invisible to a census that had been correctly
// re-run four times, across D255, D256 and D257. **A CENSUS IS BOUNDED BY ITS
// PHRASE, AND THE PHRASE IS A CHOICE.**
//
// ⚠️ THREE MORE PRINTINGS PRINT KECLEON'S SENTENCE VERBATIM AND ARE NOT AUTHORED:
// Skiploom `sv02-002`, Jumpluff `sv02-003` ("Drifting Dodge") and Ambipom
// `swsh10.5-057` ("Primate Dexterity") are all `legal_standard = 0`. MEASURED here,
// not inherited — `coverage-backlog.md` recorded that row as 2 printings and the
// truth is 3 plus Fezandipiti's gated variant. They are ROTATED OUT, not
// unbuildable, which is a different residue from D257's TERA group: the field would
// carry them unchanged the day the format moves.
//
// 🛑 THE SHAPE CALL, WRITTEN DOWN BEFORE THE BUILD. D253's line: a gate naming the
// HOLDER folds into `passivesOf`; a gate naming the ATTACKER pays a predicate call
// per site. Both sentences protect "this Pokémon" AND Fezandipiti's conjunct is
// about the HOLDER's own attachments, so BOTH halves fold — which is why the read
// sites never see the Energy clause at all. ⚠️ D252's `attackerHasSpecialEnergy` is
// the WRONG function by exactly one side; that was settled by reading the signature,
// not by the name. The two auditors agree: `therapeuticEnergy.test.ts`'s fold-key
// list owes a TWENTIETH key and `attackerFilter.test.ts` owes NOTHING.
//
// 🛑 THE PRICE WAS NOT THE GATE, IT WAS THE FLIP — AND IT BOUGHT THIS FAMILY'S
// FIRST FUNNEL. Its seven predecessors are terms in an `||` chain, spelled four
// times. This one CONSUMES RNG and EMITS A ROW, so four spellings would be four
// places that have to agree on when a coin is drawn and how many. `continuous.ts
// coinFlipShieldPrevents` is that one place; every read site is a call and a
// write-back of the advanced state.
//
// ✅ `MATCH_RECORD_VERSION` STAYS 13, AND THE ANSWER WAS READ OUT OF THE CODE
// RATHER THAN GUESSED. The handoff predicted a bump (13 → 14) and FLAGGED it as the
// clause most likely to lose. It loses: `ABILITY_COIN_FLIP` already exists with
// exactly this shape (seat / uid / ability / face — flow.ts has emitted it for
// Glimmora's on-KO flip since D140) and `rngState` has been a persisted `GameState`
// field since M1. Nothing about the RECORD's shape moves, which is D146's no-bump
// case and not D239's retype. **Driven as a REPLAY below, not asserted in prose.**
//
// 🛑 THE FOUR READ SITES, AND THEY ARE ALL LIVE — D257's answer for D257's reason:
//   • attack.ts main hit          — LIVE (the holder Active)
//   • interpreter.ts spread       — LIVE (the holder benched), and the site where
//                                   "once per DAMAGE INSTANCE" is observable
//   • interpreter.ts placeSnipe   — LIVE (bench pick), the `ignoreWR` site
//   • interpreter.ts snipeActive  — LIVE (active pick)
// Neither sentence names a zone, so nothing here is dead by construction.
// `attackEffectRefused` is NOT a read site: "prevent that damage" has no effects
// half (D255's count of four, for D255's reason). Driven.
//
// ⚠️ FIXTURE DIVERGENCE, RECORDED: both demonstrators are 340 HP with no Weakness
// where Kecleon is 70 HP / {F}-weak and Fezandipiti 120 HP. The TAILS arms LAND by
// design — that is what a coin is — and a suite that KOs its own holder halfway
// through stops driving the rest of the file. Nothing this aura reads consults HP,
// type or Weakness.

const crush = { type: "attack", seat: "p1", index: 0 } as const; // 200 flat
const bigSpread = { type: "attack", seat: "p1", index: 3 } as const; // 30 + 200 to each bench
const yawn = { type: "attack", seat: "p1", index: 7 } as const; // Asleep — a pure effect op

const BOULDER_TOSS = 5; // 200 to 1 of your opponent's Pokémon
const SNEAK_BOULDER = 6; // 200 to 1, `ignoreWR` — the Feint Attack clause

const HIDER_TEXT =
  "If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage.";
const PHEROMONE_TEXT =
  "If this Pokémon has any {D} Energy attached and is damaged by an attack, flip a coin. If heads, prevent that damage.";

/** ⚠️ THE RNG IS PINNED BY SEARCHING FOR A STATE, NOT BY A SEED TABLE, AND THAT IS
    A DELIBERATE DEPARTURE FROM `preventBlock.test.ts`. That file's flip is the
    FIRST coin its board draws, so a seed determines it; here the flip is drawn
    mid-attack on a board reached through four surgeries, and a table of seeds would
    silently go vacuous the day the deck list changes by one card. Searching the
    state space for a prefix of faces is drift-proof and states the requirement
    directly: "a board on which the next three coins are heads, tails, heads".

    Derived, never hardcoded — if `flipCoin` changes, this changes with it. */
function stateForFaces(faces: readonly CoinFace[]): number {
  for (let s = 1; s < 100_000; s++) {
    let rng = s;
    let ok = true;
    for (const want of faces) {
      const [face, next] = flipCoin(rng);
      rng = next;
      if (face !== want) {
        ok = false;
        break;
      }
    }
    if (ok) return s;
  }
  throw new Error(`no rngState produces ${faces.join(",")}`);
}

const HEADS = stateForFaces(["heads"]);
const TAILS = stateForFaces(["tails"]);

function withRng(state: GameState, rngState: number): GameState {
  return { ...state, rngState };
}

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function cardIdAt(state: GameState, p: { stack: string[] }): string | undefined {
  return idOf(state, p.stack.at(-1));
}

/** Find a P2 body on the BENCH by card id. Setup auto-benches the dominant
    `fix-bigbody`, so nothing here may assume `bench[0]` (D252's helper, re-keyed
    for the sixth time). */
function onBench(state: GameState, cardId: string) {
  return state.players.p2.bench.find((p) => cardIdAt(state, p) === cardId);
}

function benchIndexOf(state: GameState, cardId: string): number {
  const i = state.players.p2.bench.findIndex((p) => cardIdAt(state, p) === cardId);
  if (i < 0) throw new Error(`no benched ${cardId}`);
  return i;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** THE PRIMARY BOARD: the holder in P2's ACTIVE spot with the no-Ability control
    (`fix-titan`, also 340 HP) benched beside it.

    🛑 THE CONTROL IS THE POINT OF THE SECOND BODY. Every "prevented" assertion here
    has a body one square away that takes the identical number from the identical
    declaration and is never shielded — so a green cannot mean "the attack did
    nothing", which is the failure mode a prevention gate is most prone to. */
function holderActive(holderId: string): GameState {
  let state = driveSetup(
    1,
    { p1: COIN_FLIP_SHIELD_DECK, p2: COIN_FLIP_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", holderId);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-crusher");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** `holderActive`, with `count` copies of `energyId` attached to the HOLDER — the
    board Fezandipiti's printed conjunct is answered on, and the only difference
    between armed and unarmed is which Energy card that is. */
function holderActiveWith(holderId: string, energyId: string, count = 1): GameState {
  let state = driveSetup(
    1,
    { p1: COIN_FLIP_SHIELD_DECK, p2: COIN_FLIP_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", holderId);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = attachFromDeck(state, "p2", energyId, count);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-crusher");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** THE SECOND BOARD: the holder on P2's BENCH under a plain Active, with the
    no-Ability control beside it. The printed sentences carry NO zone clause, so
    this must answer exactly as `holderActive` does. */
function holderBenched(holderId: string): GameState {
  let state = driveSetup(
    1,
    { p1: COIN_FLIP_SHIELD_DECK, p2: COIN_FLIP_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", holderId);
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-crusher");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** Declare a chosen-target attack and resolve the prompt onto the P2 body whose
    card id is `cardId` (or onto the Active). D251's helper, reused for the eighth
    slice running. */
function snipeAt(state: GameState, index: number, spot: "active" | string) {
  const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const wanted =
    spot === "active"
      ? prompt.candidates.find((c) => c.spot.spot === "active")
      : prompt.candidates.find((c) => {
          if (c.spot.spot !== "bench") return false;
          const body = parked.players.p2.bench[c.spot.index];
          return body !== undefined && cardIdAt(parked, body) === spot;
        });
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("the coin-flip shield — the registry data rows", () => {
  it("authors BOTH printed sentences, and the ids are the measured five", () => {
    for (const id of ["sv06-096", "sv06.5-073", "sv08.5-045"]) {
      expect(programFor(id)?.passive?.preventDamageOnCoinFlip, id).toEqual({
        ability: "Adrena-Pheromone",
        requiresEnergyType: "Darkness",
      });
    }
    for (const id of ["sv08-150", "sv08-213"]) {
      expect(programFor(id)?.passive?.preventDamageOnCoinFlip, id).toEqual({
        ability: "Expert Hider",
      });
    }
  });

  // 🛑 THE KEY IS ABSENT, NOT `undefined`-VALUED, AND THAT IS THE WHOLE OF "ONE
  // FIELD, NOT TWO". Kecleon's sentence is Fezandipiti's with its antecedent
  // dropped, so it is the same record with one key missing — D205's optional-key
  // rule. A build that spelled `requiresEnergyType: undefined` would pass the
  // `toEqual` above and would be one refactor away from a gate nobody can drop.
  it("Kecleon's row does NOT carry the conjunct key at all", () => {
    expect(programFor("sv08-150")?.passive?.preventDamageOnCoinFlip).not.toHaveProperty(
      "requiresEnergyType",
    );
  });

  // TWO objects, not one: the two printings carry different Ability names, and a
  // shared object would report the wrong one in half the ABILITY_COIN_FLIP rows.
  // Reprints DO share (`legalNonAttackPrograms.test.ts`'s standing rule).
  it("reprints share an object; the two SENTENCES do not", () => {
    expect(programFor("sv06.5-073")).toBe(programFor("sv06-096"));
    expect(programFor("sv08.5-045")).toBe(programFor("sv06-096"));
    expect(programFor("sv08-213")).toBe(programFor("sv08-150"));
    expect(programFor("sv08-150")).not.toBe(programFor("sv06-096"));
  });

  // A claim about `BUILT.attack`, not a detail: "Energy Feather" (30× per attached
  // Energy) and "Lick Whip" (an `opponentAny` 30) belong to the text readers, and
  // authoring either here would move a column this slice reports UNCHANGED for the
  // thirteenth slice running.
  it("authors NO attack program on any of the five printings", () => {
    for (const id of ["sv06-096", "sv06.5-073", "sv08.5-045", "sv08-150", "sv08-213"]) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  // D145's move: discover the demonstrators from the registry rather than naming
  // them, so a third fixture added without a case fails HERE.
  it("has exactly TWO fixture demonstrators in the pool", () => {
    const holders = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventDamageOnCoinFlip !== undefined,
    );
    expect(holders).toEqual(["fix-experthider", "fix-adrenapheromone"]);
    expect(programFor("fix-experthider")).toBe(programFor("sv08-150"));
    expect(programFor("fix-adrenapheromone")).toBe(programFor("sv06-096"));
  });

  // The printed bytes, so an arm written from a paraphrase cannot pass (D183).
  it("the demonstrators print the sentences verbatim", () => {
    expect(FIXTURE_POOL["fix-experthider"]?.abilities?.[0]?.effect).toBe(HIDER_TEXT);
    expect(FIXTURE_POOL["fix-adrenapheromone"]?.abilities?.[0]?.effect).toBe(PHEROMONE_TEXT);
  });

  // 🛑 THE PREMISE BEHIND THE `unreachable-population` MUTANT ROW. The fold collects
  // because two sources on one body would be two printed "flip a coin" instructions
  // — and no board this catalog can build has two, because every writer of the field
  // is a Pokémon. Asserted rather than remembered: if a TOOL or an ENERGY ever
  // prints the sentence, this fails and `D258-flip-first-only` becomes killable.
  it("every writer of the field is a POKÉMON — no Tool, no Energy", () => {
    const writers = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventDamageOnCoinFlip !== undefined,
    );
    for (const id of writers) {
      expect(FIXTURE_POOL[id]?.category, id).toBe("Pokemon");
    }
  });
});

describe("the fold — `passivesOf.preventDamageOnCoinFlip`", () => {
  // The UNGATED sentence needs nothing: an entry is present on a bare board.
  it("Kecleon's shield is present unconditionally, and names its Ability", () => {
    const state = holderActive("fix-experthider");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no active");
    expect(passivesOf(state, active).preventDamageOnCoinFlip).toEqual([
      { ability: "Expert Hider" },
    ]);
  });

  // 🛑 THE CONJUNCT IS REAL, AND IT IS RESOLVED HERE. Two boards one card apart:
  // a {D} arms Fezandipiti, a Colorless does not. A build that folded the record
  // through unevaluated and asked at the read sites would return an entry on BOTH.
  it("Fezandipiti's shield needs a {D} — a Colorless does NOT arm it", () => {
    const armed = holderActiveWith("fix-adrenapheromone", "fix-dark-energy");
    const bare = holderActiveWith("fix-adrenapheromone", "fix-energy");
    const a = armed.players.p2.active;
    const b = bare.players.p2.active;
    if (a === null || b === null) throw new Error("no active");
    expect(passivesOf(armed, a).preventDamageOnCoinFlip).toEqual([{ ability: "Adrena-Pheromone" }]);
    expect(passivesOf(bare, b).preventDamageOnCoinFlip).toEqual([]);
  });

  // A body with no such Ability folds to the EMPTY list, which is what makes the
  // read sites pay one `.length === 0` over nothing on every ordinary board.
  it("a body with no shield folds to []", () => {
    const state = holderActive("fix-experthider");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("no titan");
    expect(passivesOf(state, titan).preventDamageOnCoinFlip).toEqual([]);
  });
});

describe("the funnel — `coinFlipShieldPrevents`", () => {
  // 🛑 THE PRINTED ANTECEDENT, DRIVEN AT THE FUNNEL. "If ANY DAMAGE IS DONE to this
  // Pokémon" — a body taking nothing is not damaged, so NO coin is drawn and the
  // state is byte-identical. This is not a performance guard: an unnecessary flip
  // desynchronises every later draw in the game.
  it("draws NO coin for zero damage — the state is untouched", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const active = state.players.p2.active;
    if (active === null) throw new Error("no active");
    const events: GameEvent[] = [];
    expect(coinFlipShieldPrevents(state, active, "p2", 0, events)).toEqual([false, HEADS]);
    expect(events).toEqual([]);
  });

  // The same, one step further: a NEGATIVE amount cannot arise from `wouldDeal`
  // (it is floored at 0 at all four sites) and is guarded for totality — the arm
  // this family has written since D253 rather than leaving a hole.
  it("draws no coin for a negative amount either", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const active = state.players.p2.active;
    if (active === null) throw new Error("no active");
    const events: GameEvent[] = [];
    expect(coinFlipShieldPrevents(state, active, "p2", -10, events)).toEqual([false, HEADS]);
    expect(events).toEqual([]);
  });

  // A body with no shield draws nothing, which is the ordinary case on every board
  // in the suite and the reason this funnel costs nothing where it does not apply.
  it("draws no coin for a body with no shield", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("no titan");
    const events: GameEvent[] = [];
    expect(coinFlipShieldPrevents(state, titan, "p2", 200, events)).toEqual([false, HEADS]);
    expect(events).toEqual([]);
  });

  // ⚠️ THE FACE IS ANNOUNCED ON BOTH SIDES, AND THE STATE ADVANCES ON BOTH. A
  // "protected" row with no coin in it is a lie about a tails, and a tails that
  // does not advance `rngState` is a lie about the draw.
  it("heads prevents, tails does not, and BOTH advance the state and emit a row", () => {
    const state = holderActive("fix-experthider");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no active");
    for (const [rng, face, prevented] of [
      [HEADS, "heads", true],
      [TAILS, "tails", false],
    ] as const) {
      const events: GameEvent[] = [];
      const [answer, next] = coinFlipShieldPrevents(withRng(state, rng), active, "p2", 200, events);
      expect(answer).toBe(prevented);
      expect(next).not.toBe(rng);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "ABILITY_COIN_FLIP",
        seat: "p2",
        ability: "Expert Hider",
        result: face,
      });
    }
  });
});

describe("read site 1/4 — attack.ts's main hit", () => {
  it("HEADS prevents the whole 200; the benched control takes it", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { state: done, events } = mustApply(state, crush);
    expect(find(events, "ABILITY_COIN_FLIP")).toMatchObject({
      ability: "Expert Hider",
      result: "heads",
    });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("TAILS lets the whole 200 through", () => {
    const state = withRng(holderActive("fix-experthider"), TAILS);
    const { state: done, events } = mustApply(state, crush);
    expect(find(events, "ABILITY_COIN_FLIP")).toMatchObject({ result: "tails" });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 200, prevented: undefined });
    expect(done.players.p2.active?.damage).toBe(200);
  });

  // 🛑 THE ATTRIBUTION CONTROL, on the SAME declaration and the SAME rngState. A
  // 340 HP body with no Ability takes the 200 and draws no coin, so a green above
  // cannot mean "the attack was refused".
  it("the no-Ability control takes the identical 200 and flips nothing", () => {
    const state = withRng(holderActive("fix-titan"), HEADS);
    const { state: done, events } = mustApply(state, crush);
    expect(findAll(events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(done.players.p2.active?.damage).toBe(200);
    expect(done.rngState).toBe(HEADS);
  });

  // The gated printing, at the site the conjunct is most visible: the same holder,
  // the same seed, one Energy card apart.
  it("Fezandipiti flips only when a {D} is attached", () => {
    const armed = withRng(holderActiveWith("fix-adrenapheromone", "fix-dark-energy"), HEADS);
    const bare = withRng(holderActiveWith("fix-adrenapheromone", "fix-energy"), HEADS);
    const hit = mustApply(armed, crush);
    expect(find(hit.events, "ABILITY_COIN_FLIP")).toMatchObject({
      ability: "Adrena-Pheromone",
      result: "heads",
    });
    expect(hit.state.players.p2.active?.damage).toBe(0);

    const through = mustApply(bare, crush);
    expect(findAll(through.events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(through.state.players.p2.active?.damage).toBe(200);
    // 🛑 AND THE UNARMED BOARD BURNS NO RNG STEP. A build that flipped first and
    // checked the Energy afterwards passes every damage assertion above and
    // desynchronises every later shuffle in the game.
    expect(through.state.rngState).toBe(HEADS);
  });

  // ⚠️ THE ROW LANDS BEFORE THE DAMAGE, which is the order the sentence prints:
  // the flip happens, then the damage does or does not.
  it("announces the flip BEFORE the DAMAGE_DEALT row", () => {
    const { events } = mustApply(withRng(holderActive("fix-experthider"), HEADS), crush);
    const flip = events.findIndex((e) => e.type === "ABILITY_COIN_FLIP");
    const dealt = events.findIndex((e) => e.type === "DAMAGE_DEALT");
    expect(flip).toBeGreaterThanOrEqual(0);
    expect(flip).toBeLessThan(dealt);
  });

  // §9 — the aura rides `passivesOf`, so an Ability lock switches it off. 🛑 AND THE
  // SILENCED HOLDER DRAWS NO COIN, which no earlier prevention slice could show:
  // for every one of the seven siblings a §9 lock only changes an answer, and here
  // it changes how much RNG the game consumes.
  it("§9 — Klefki's lock silences the shield in the FOLD", () => {
    let state = holderActive("fix-experthider");
    state = setActiveFromDeck(state, "p1", "sv01-096");
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(passivesOf(state, active).preventDamageOnCoinFlip).toEqual([]);
  });

  // …and the lock reaches the DAMAGE and the RNG together, which is the pair that
  // makes the §9 claim a behaviour rather than a property read. Klefki's own
  // index-0 "Joust" is 10, not Crush — the attacker changed, so the number does.
  it("…and the damage then LANDS with NO coin drawn", () => {
    let state = holderActive("fix-experthider");
    state = setActiveFromDeck(state, "p1", "sv01-096");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = withRng(state, HEADS);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findAll(events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(done.players.p2.active?.damage).toBe(10);
    expect(done.rngState).toBe(HEADS);
  });
});

describe("read site 2/4 — the spread", () => {
  // The holder benched: no zone clause, so this answers exactly as the Active does.
  it("HEADS shields a benched holder from the splash", () => {
    const state = withRng(holderBenched("fix-experthider"), HEADS);
    const { state: done, events } = mustApply(state, bigSpread);
    expect(findAll(events, "ABILITY_COIN_FLIP")).toHaveLength(1);
    expect(onBench(done, "fix-experthider")?.damage).toBe(0);
    expect(onBench(done, "fix-titan")?.damage).toBe(200);
  });

  // 🛑 THE SITE THAT MAKES "ONCE PER DAMAGE INSTANCE" OBSERVABLE, AND THE SINGLE
  // SHARPEST BOARD IN THIS FILE. Three benched holders take three SEPARATE damage
  // instances, so three coins are drawn — each from the state the last one left. The
  // seed is chosen so the faces are heads, tails, heads, which no build that drew
  // ONE coin and reused it could produce. Both faces land on real bodies in one
  // declaration, so the "protected" and "took it" halves are the same event batch.
  it("a spread into THREE holders draws THREE coins, in order, from advancing state", () => {
    let state = driveSetup(
      1,
      { p1: COIN_FLIP_SHIELD_DECK, p2: COIN_FLIP_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-experthider");
    state = benchFromDeck(state, "p2", "fix-experthider");
    state = benchFromDeck(state, "p2", "fix-experthider");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-crusher");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = withRng(state, stateForFaces(["heads", "tails", "heads"]));

    const { state: done, events } = mustApply(state, bigSpread);
    expect(findAll(events, "ABILITY_COIN_FLIP").map((e) => e.result)).toEqual([
      "heads",
      "tails",
      "heads",
    ]);
    expect(done.players.p2.bench.map((p) => p.damage)).toEqual([0, 200, 0]);
    // …and the three rows name three DIFFERENT bodies, so a build that flipped once
    // and announced it three times cannot pass.
    expect(new Set(findAll(events, "ABILITY_COIN_FLIP").map((e) => e.uid)).size).toBe(3);
  });
});

describe("read sites 3/4 and 4/4 — the two snipe arms", () => {
  it("placeSnipe: HEADS shields the benched pick", () => {
    const state = withRng(holderBenched("fix-experthider"), HEADS);
    const { state: done, events } = snipeAt(state, BOULDER_TOSS, "fix-experthider");
    expect(find(events, "ABILITY_COIN_FLIP")).toMatchObject({ result: "heads" });
    expect(onBench(done, "fix-experthider")?.damage).toBe(0);
  });

  it("placeSnipe: TAILS lets the 200 land on the benched pick", () => {
    const state = withRng(holderBenched("fix-experthider"), TAILS);
    const { state: done, events } = snipeAt(state, BOULDER_TOSS, "fix-experthider");
    expect(find(events, "ABILITY_COIN_FLIP")).toMatchObject({ result: "tails" });
    expect(onBench(done, "fix-experthider")?.damage).toBe(200);
  });

  it("snipeActive: HEADS shields the Active pick", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { state: done, events } = snipeAt(state, BOULDER_TOSS, "active");
    expect(find(events, "ABILITY_COIN_FLIP")).toMatchObject({ result: "heads" });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("snipeActive: TAILS lets the 200 land on the Active pick", () => {
    const state = withRng(holderActive("fix-experthider"), TAILS);
    const { state: done, events } = snipeAt(state, BOULDER_TOSS, "active");
    expect(find(events, "ABILITY_COIN_FLIP")).toMatchObject({ result: "tails" });
    expect(done.players.p2.active?.damage).toBe(200);
  });

  // 🛑 FEINT ATTACK NULLS THE AURA — and it nulls the COIN, not just the answer.
  // "Not affected by any effects on that Pokémon" reaches a catalog aura ON the
  // damaged body exactly as it reaches this gate's seven siblings; a build that drew
  // the coin and then discarded the result would take the same 200 and leave the
  // game on a different `rngState`, which is the defect only this case can see.
  it("`ignoreWR` nulls the shield AND draws no coin — both snipe arms", () => {
    for (const [board, read] of [
      [holderBenched("fix-experthider"), "fix-experthider"],
      [holderActive("fix-experthider"), "active"],
    ] as const) {
      const state = withRng(board, HEADS);
      const { state: done, events } = snipeAt(state, SNEAK_BOULDER, read);
      expect(findAll(events, "ABILITY_COIN_FLIP")).toEqual([]);
      const body = read === "active" ? done.players.p2.active : onBench(done, read);
      expect(body?.damage).toBe(200);
      expect(done.rngState).toBe(HEADS);
    }
  });

  // The put-counter arm of the same op: a placed counter is NOT "damage done by
  // attacks" (this engine's standing `damageActive` reading), so no coin is drawn.
  // The pool's put-counter snipes are elsewhere; the reading is pinned at the
  // funnel instead, which is where the arm's `continue` lives.
  it("a placed COUNTER is not damage, so no shield and no coin", () => {
    const state = withRng(holderBenched("fix-experthider"), HEADS);
    const bench = state.players.p2.bench[benchIndexOf(state, "fix-experthider")];
    if (bench === undefined) throw new Error("no holder");
    const events: GameEvent[] = [];
    // The counter arm never reaches the funnel; asserting the funnel's own contract
    // for "no damage" is the reading, and the `!deals` branch is what carries it.
    expect(coinFlipShieldPrevents(state, bench, "p2", 0, events)).toEqual([false, HEADS]);
    expect(events).toEqual([]);
  });
});

describe("what this field deliberately does NOT reach", () => {
  // 🛑 `attackEffectRefused` IS NOT WIDENED, and it is DRIVEN rather than asserted in
  // a comment. "Prevent that damage" has no effects half, so a shielded Kecleon is
  // still put to Sleep — even on a HEADS seed, where the damage half would fire.
  it("an attack's EFFECT still lands on a holder (no effects half)", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { events } = mustApply(state, yawn);
    // ⚠️ ASSERTED ON THE EVENT, NOT THE END BOARD, AND THE REASON IS THE ENGINE'S
    // OWN CLOCK: attacking ENDS THE TURN, so the between-turns Checkup runs its own
    // Asleep coin before this function returns and may wake the body up again. The
    // claim is that the status LANDED on a shielded holder, which is the event.
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "asleep" });
  });

  // …and the effect-only attack draws NO coin, because it does no damage. The same
  // printed antecedent, read on the other half of the pipeline.
  it("an effect-only attack draws no SHIELD coin at all", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { events } = mustApply(state, yawn);
    // ⚠️ THE ABSENCE OF THE ROW, NOT AN UNCHANGED `rngState`: the Checkup's own
    // Asleep flip runs after the turn ends and advances the state legitimately. A
    // CHECKUP_COIN_FLIP is a different event from a different pipeline, and this
    // case is about THIS one.
    expect(findAll(events, "ABILITY_COIN_FLIP")).toEqual([]);
  });
});

describe("the record stays replayable — MATCH_RECORD_VERSION does NOT move", () => {
  // 🛑 THE CLAUSE THE HANDOFF FLAGGED AS MOST LIKELY TO LOSE, AND IT LOST: the
  // prediction was a bump (13 → 14). The answer is NO BUMP, and it is DRIVEN.
  //
  // What a bump is FOR is a record that can no longer be replayed. This slice adds
  // no key to `GameState` and no member to `GameEvent`: `rngState` has been
  // persisted since M1 and `ABILITY_COIN_FLIP` has existed since Glimmora's on-KO
  // flip. So the two things a replay needs — the same state in, the same state and
  // events out — are asserted directly.
  it("the same board and the same action replay to identical events and state", () => {
    const state = deepFreeze(withRng(holderActive("fix-experthider"), HEADS));
    const a = mustApply(state, crush);
    const b = mustApply(state, crush);
    expect(b.events).toEqual(a.events);
    expect(b.state.rngState).toBe(a.state.rngState);
    expect(b.state.players.p2.active?.damage).toBe(a.state.players.p2.active?.damage);
  });

  // …and the flip really did consume a step, so the case above is not green because
  // nothing happened.
  it("a drawn coin ADVANCES the persisted rngState", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { state: done } = mustApply(state, crush);
    expect(done.rngState).not.toBe(HEADS);
    expect(done.rngState).toBe(flipCoin(HEADS)[1]);
  });

  // The event this slice emits is one an existing producer already emits, which is
  // the whole no-bump argument stated as a fact about the union rather than as
  // prose. `GameState`'s key set is unchanged across the hit for the same reason.
  it("adds no GameState key — the shape is byte-identical", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { state: done } = mustApply(state, crush);
    expect(Object.keys(done).sort()).toEqual(Object.keys(state).sort());
  });
});

describe("the log renders the flip with no new row type", () => {
  // log.ts is UNTOUCHED by this slice: `ABILITY_COIN_FLIP` has had a renderer since
  // Glimmora, and it names the body, the face and the Ability — which is exactly
  // what a defensive flip has to say. Asserted so a future edit that specialises
  // that row for the on-KO case notices this second producer.
  it("names the holder, the face and the Ability", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { state: done, events } = mustApply(state, crush);
    const ctx: LogContext = {
      names: { p1: "Ember", p2: "Tide" },
      state: done,
      elapsed: "+00:07",
    };
    const rows = logFromEvents(events, ctx).map((entry) =>
      entry.kind === "turn" ? "" : entry.segments.map((s) => s.text).join(""),
    );
    expect(rows.some((r) => r.includes("flipped") && r.includes("heads"))).toBe(true);
    expect(rows.some((r) => r.includes("Expert Hider"))).toBe(true);
  });
});
