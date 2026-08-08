import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor, topCardOf } from "./index";
import type { GameState, PokemonRef, Seat } from "./index";
import { registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  must,
  setActiveFromDeck,
} from "./testFixtures";

// D273 — PECHARUNT ex's "SUBJUGATING CHAINS": THE {D}-NARROWED, NAME-EXCLUDING
// BENCH SWITCH, AND THE BIGGEST SINGLE-SENTENCE ABILITY GROUP LEFT ON THE
// NAME-LOCK SWEEP.
//
// THE SENTENCE. *"Once during your turn, you may switch 1 of your Benched {D}
// Pokémon, except any Pecharunt ex, with your Active Pokémon. If you do, the new
// Active Pokémon is now Poisoned. You can't use more than 1 Subjugating Chains
// Ability each turn."* — FIVE Standard-legal printings, `sv06.5-039` /
// `sv06.5-085` / `sv06.5-093` / `sv06.5-095` / `sv08.5-163`, whose
// `abilities_json` is BYTE-IDENTICAL across all five.
//
// ── THE CENSUS, TRANSCRIBED SO IT CAN BE RE-RUN ──────────────────────────────
// Remote D1 `luminous` (uuid 735f0fb5-cdc3-494d-8b97-74a8ade0124a), 2026-08-07:
//
//   SELECT lower(j.value ->> 'effect') AS eff, count(*) n, group_concat(c.id) ids
//   FROM cards c, json_each(c.abilities_json) j
//   WHERE c.legal_standard = 1
//     AND j.value ->> 'effect' LIKE '%You can''t use more than 1%'
//   GROUP BY eff ORDER BY n DESC;
//   → THREE rows, TEN printings, and the ladder is unchanged from D272's:
//     · n = 5 — Subjugating Chains: sv06.5-039, sv06.5-085, sv06.5-093,
//       sv06.5-095, sv08.5-163  ← THIS SLICE
//     · n = 3 — Flip the Script: sv06.5-038/-084/-092 (BUILT at D272)
//     · n = 2 — Fan Call: sv07-118, sv08.5-085 (STILL REFUSED, below)
//
//   SELECT id,name,category,legal_standard,types_json,hp FROM cards
//   WHERE id IN (<the five>);
//   → all five: Pokemon / legal_standard 1 / types_json ["Darkness"] /
//     name "Pecharunt ex" / hp 190. **THE RIDER VALUES ARE READ OFF THAT ROW**:
//     a `targetType` naming a type the catalog does not print, or an
//     `exceptNamed` spelling a name it does not carry, would be an arm no board
//     can reach.
//
// ── WHAT THIS SLICE ADDS, AND WHAT IT DID NOT HAVE TO ───────────────────────
//
// 🛑 **D272's HANDOFF PRICED THIS ROW AT ONE MISSING MECHANISM AND THERE WERE
// TWO.** Its note (kept verbatim in `flipTheScript.test.ts`) said the only gap
// was the *"except any Pecharunt ex"* exclusion. The printed noun is an
// INTERSECTION — *"1 of your Benched **{D}** Pokémon, except any Pecharunt ex"* —
// and `switchActive` carried NO type narrowing either. Its own doc block had
// named that gap three slices earlier (*"A SECOND NARROWING AXIS EXISTS AND THIS
// FIELD IS NOT IT … an ENERGY-TYPE subgroup, which `ownerPokemon` must refuse
// rather than approximate"*), which is the lesson: **an inherited price is an
// inherited structural claim, and this repo re-counts those.**
//
// ✅ **AND THE THIRD CLAUSE COST NOTHING, WHICH IS A MEASUREMENT RATHER THAN A
// BOAST.** *"If you do, the new Active Pokémon is now Poisoned"* is `recordGate`
// on the `moved` slot plus `applyStatus target: "self"` — both shipped since
// Janine's Secret Art, and their subjects coincide BY CONSTRUCTION rather than by
// ordering luck: `recordAs` files the uid that ACTUALLY became Active (and `[]`
// when the switch did not happen), and `"self"` inside an Ability program is
// `state.players[ctx.seat].active`, which after the switch IS that body.
//
// ── THE HAZARDS THIS SUITE IS SHAPED AROUND ─────────────────────────────────
//
// ⚠️ **A BENCH OF ONE ELIGIBLE BODY IS VACUOUS ON A CANDIDATE NARROWING.** With a
// single benched Pokémon the op FORCES it (`parkOrForce`), so "the {D} narrowing
// works" and "there was only ever one answer" are the same board. Every narrowing
// assertion below is driven on a bench holding a body the card ADMITS and a body
// it REFUSES at the same time.
//
// ⚠️ **A SINGLE-TYPE BODY CANNOT SEE THE MEMBERSHIP BUG.** `types` is an ARRAY and
// dual-type Pokémon are printed, so an `=== type` read passes every mono-{D}
// board and silently drops a `["Darkness","Fire"]` body. `fix-dualdark` is that
// board.
//
// ⚠️ **A ONE-COPY BOARD IS VACUOUS ON A CROSS-COPY LOCK** (D272's rule, inherited
// and re-applied): the name lock is driven with `sv06.5-039` AND `sv06.5-085` —
// two DISTINCT catalog ids, one Ability name.
//
// ⚠️ **AND EVERY REFUSAL BELOW IS PAIRED WITH ITS POSITIVE TWIN ON THE SAME
// BOARD** (D272's rule again): "the Ability was refused" must never be "the board
// was empty".

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

/** The printed text, once, byte-for-byte, shared by all five printings — copied
    from the remote `abilities_json`, brace code and apostrophe included. */
const SUBJUGATING_CHAINS_TEXT =
  "Once during your turn, you may switch 1 of your Benched {D} Pokémon, except any Pecharunt ex, with your Active Pokémon. If you do, the new Active Pokémon is now Poisoned. You can't use more than 1 Subjugating Chains Ability each turn.";

/** A Pecharunt ex printing. The id is a REAL catalog id, so `programFor` resolves
    the SHIPPED registry row rather than a fixture stand-in; the stats are the
    catalog's (Basic Darkness, 190 HP, retreat 1). */
function pecharunt(id: string): Card {
  return battler(id, {
    name: "Pecharunt ex",
    hp: 190,
    types: ["Darkness"],
    retreat: 1,
    abilities: [{ type: "Ability", name: "Subjugating Chains", effect: SUBJUGATING_CHAINS_TEXT }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv06.5-039": pecharunt("sv06.5-039"),
  "sv06.5-085": pecharunt("sv06.5-085"),
  /** The ADMITTED bench body: a mono-{D} Basic with no Ability at all, so nothing
      about the switch can be coming from the target's own program. */
  "fix-darkbench": battler("fix-darkbench", { name: "Dark Cadet", hp: 70, types: ["Darkness"] }),
  /** The DUAL-TYPE witness. `["Darkness", "Fire"]` with Darkness SECOND would also
      pass a `types[0] === …` read; it is FIRST here and `fix-firedark` below is
      the other order, because the two mutants are different. */
  "fix-dualdark": battler("fix-dualdark", {
    name: "Dusk Ember",
    hp: 80,
    types: ["Darkness", "Fire"],
  }),
  "fix-firedark": battler("fix-firedark", {
    name: "Ember Dusk",
    hp: 80,
    types: ["Fire", "Darkness"],
  }),
  /** The REFUSED bench body — a printed type the sentence does not name. */
  "fix-lightbench": battler("fix-lightbench", {
    name: "Volt Cadet",
    hp: 70,
    types: ["Lightning"],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The ELEVENTH seeded deck (D270's rule: a seeded suite gets its OWN deck rather
    than new rows in a shared one). Two Pecharunt printings so the bench can hold
    two DISTINCT ids, and four bench shapes so a single board can offer an
    admitted body and a refused one at once. */
const CHAINS_DECK = deckOf({
  "sv06.5-039": 4,
  "sv06.5-085": 4,
  "fix-darkbench": 4,
  "fix-dualdark": 4,
  "fix-firedark": 4,
  "fix-lightbench": 4,
  "fix-basic-1": 4,
  "sv01-194": 2, // Switch — the RIDER-FREE printing of the same op, driven in §6
  "fix-energy": 30,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: CHAINS_DECK, p2: CHAINS_DECK }, cardPool: POOL });
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

/** P1 opens their action phase with `activeId` Active and `bench` behind it, and
    NOTHING else on their bench.

    ⚠️ **THE BENCH IS CLEARED BEFORE IT IS FILLED**, D133's trap: setup leaves
    whatever the opening hand had there, and a stray Basic would silently widen or
    narrow every candidate list in this file. ⚠️ **AND P2 GETS A BENCH TOO** —
    §14.2 makes an empty bench a LOSS on the first Knock Out, and nothing here
    should be read off a `gameOver` board. */
function board(seed: number, activeId: string, bench: readonly string[]): GameState {
  let state = clearBench(setActiveFromDeck(localSetup(seed, "p1"), "p1", activeId), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", "fix-basic-1"), "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  if (state.phase.kind !== "turn:action" || state.phase.seat !== "p1") {
    throw new Error(`expected P1's action phase, got ${state.phase.kind}`);
  }
  return state;
}

const ACTIVE = { spot: "active" } as const;
const BENCH = (index: number) => ({ spot: "bench", index }) as const;

function useChains(state: GameState, target: typeof ACTIVE | ReturnType<typeof BENCH>) {
  return applyAction(state, {
    type: "useAbility",
    seat: "p1",
    target,
    abilityName: "Subjugating Chains",
  });
}

/** The parked `choosePokemon` prompt, narrowed — candidates AND caption, because
    a candidate list the caption disagrees with is the dialog contradicting its
    own validator. */
function choosePrompt(state: GameState): { candidates: readonly PokemonRef[]; note: string } {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

/** The printed NAME of every body a ref list points at — the readable form of a
    candidate set, so a failure says "Volt Cadet" instead of "bench index 1". */
function refNames(state: GameState, refs: readonly PokemonRef[]): string[] {
  return refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
    if (body === null || body === undefined) return "?";
    return topCardOf(state, body)?.name ?? "?";
  });
}

function activeName(state: GameState, seat: Seat): string {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return topCardOf(state, active)?.name ?? "?";
}

function poisoned(state: GameState, seat: Seat): boolean {
  // §12 — "Poisoned" IS `poisonDamage > 0`; the field doubles as the flag and as
  // the per-Checkup amount, so a boolean read of a sibling would find nothing.
  return (state.players[seat].active?.conditions.poisonDamage ?? 0) > 0;
}

function pick(ref: PokemonRef) {
  return { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } } as const;
}

const P1_BENCH = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

const SEEDS = [3, 19, 40, 58, 77] as const;

// ── 1. The registry rows — the printed sentence, as data ─────────────────────

describe("Pecharunt ex — the five printings as registry data", () => {
  const IDS = ["sv06.5-039", "sv06.5-085", "sv06.5-093", "sv06.5-095", "sv08.5-163"] as const;

  it("all FIVE ids resolve to one program carrying both riders and no new ops", () => {
    for (const id of IDS) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name, id).toBe("Subjugating Chains");
      // The cross-copy lock, D272's field verbatim. `true` here is the per-body
      // default and would be a live bug on any board with a second copy.
      expect(ability?.oncePerTurn, id).toBe("sharedByName");
      // "Once during your turn" carries no Active clause, so a BENCHED Pecharunt
      // ex may chain — which is also what makes the two-copy board below reachable.
      expect(ability?.activeOnly, id).toBe(false);
      // No board gate: the printed sentence puts no condition on Pecharunt itself.
      // The only gate is the candidate set, enforced by `programPlayable`.
      expect(ability?.playableIf, id).toBeUndefined();
      expect(ability?.program, id).toEqual([
        {
          op: "switchActive",
          targetType: "Darkness",
          exceptNamed: "Pecharunt ex",
          recordAs: "moved",
        },
        {
          op: "recordGate",
          slot: "moved",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
        },
      ]);
    }
  });

  it("the five printings share ONE program object — a reprint is not a second authoring", () => {
    const first = programFor("sv06.5-039");
    for (const id of IDS.slice(1)) expect(programFor(id), id).toBe(first);
  });

  it("the exclusion is spelled with the printed NAME, and it is the catalog's", () => {
    // ⚠️ THE MUTANT THIS KILLS: `exceptNamed: "Pecharunt"`. The catalog row's
    // `name` is "Pecharunt ex" — the ` ex` suffix is part of the printed name, not
    // a rule-box marker the engine strips — so a prefix-shaped value would match
    // NOTHING and the exclusion would silently do nothing on every board.
    const op = programFor("sv06.5-039")?.abilities?.[0]?.program?.[0];
    if (op?.op !== "switchActive") throw new Error("expected switchActive first");
    expect(op.exceptNamed).toBe("Pecharunt ex");
    expect(LOCAL_CARDS["sv06.5-039"]?.name).toBe(op.exceptNamed);
    // …and the type is a PokemonType spelled in full, not a brace code. The
    // printed sentence says "{D}"; `matchesFilter` asks about `types`, whose
    // values are "Darkness".
    expect(op.targetType).toBe("Darkness");
    expect(LOCAL_CARDS["sv06.5-039"]?.types).toContain(op.targetType);
  });

  it("no OTHER registry program carries either new rider — the widening is opt-in", () => {
    // ⚠️ AN AUDITOR, NOT A READER: it enumerates the whole authored pool through
    // `registryCardIds()`, so it goes RED the day a second row takes a rider
    // without its own printed noun. A hand-written id list could not.
    const typed: string[] = [];
    const excluded: string[] = [];
    for (const id of registryCardIds()) {
      const program = programFor(id);
      const ops = [
        ...(program?.abilities ?? []).flatMap((a) => a.program),
        ...(program?.triggered ?? []).flatMap((a) => a.program),
        ...(program?.trainer ?? []),
      ];
      for (const op of ops) {
        if (op.op !== "switchActive") continue;
        if (op.targetType !== undefined) typed.push(id);
        if (op.exceptNamed !== undefined) excluded.push(id);
      }
    }
    expect(typed.sort()).toEqual([...IDS].sort());
    expect(excluded.sort()).toEqual([...IDS].sort());
  });
});

// ── 2. The candidate set — the two narrowings, driven ───────────────────────

describe("the candidate set — {D} and NOT Pecharunt ex", () => {
  it("a non-{D} benched body is NOT offered, and an admitted one on the SAME bench is", () => {
    // ⚠️ BOTH BODIES ON ONE BENCH: a board holding only the refused body would
    // pass an implementation that offers nothing at all.
    for (const seed of SEEDS) {
      // ⚠️ TWO ADMITTED BODIES, NOT ONE: with a single candidate `parkOrForce`
      // FORCES the switch and there is no prompt to read a candidate list off.
      const state = board(seed, "sv06.5-039", ["fix-lightbench", "fix-darkbench", "fix-dualdark"]);
      const parked = must(useChains(state, ACTIVE));
      const { candidates } = choosePrompt(parked);
      expect(refNames(parked, candidates).sort()).toEqual(["Dark Cadet", "Dusk Ember"]);
    }
  });

  it("a benched Pecharunt ex is NOT offered even though it IS {D} — the exclusion is live", () => {
    // ⚠️ THE SEPARATING BOARD FOR THE TYPE RIDER ALONE: a `{D}`-only reading
    // offers BOTH bodies here, because a Pecharunt ex is a Darkness Pokémon. The
    // printed "except any Pecharunt ex" is the only thing that drops it.
    for (const seed of SEEDS) {
      const state = board(seed, "sv06.5-039", ["sv06.5-085", "fix-darkbench", "fix-dualdark"]);
      const parked = must(useChains(state, ACTIVE));
      const { candidates } = choosePrompt(parked);
      expect(refNames(parked, candidates).sort()).toEqual(["Dark Cadet", "Dusk Ember"]);
    }
  });

  it("a DUAL-TYPE body is offered in either printed order — membership, not equality", () => {
    // ⚠️ THE MUTANT THIS KILLS: `types[0] === "Darkness"`. `fix-firedark` prints
    // `["Fire", "Darkness"]`, so a first-element read drops it while every
    // mono-{D} board in this file stays green.
    for (const seed of SEEDS) {
      const state = board(seed, "sv06.5-039", ["fix-dualdark", "fix-firedark"]);
      const parked = must(useChains(state, ACTIVE));
      const { candidates } = choosePrompt(parked);
      expect(refNames(parked, candidates).sort()).toEqual(["Dusk Ember", "Ember Dusk"].sort());
    }
  });

  it("the ACTIVE is never a candidate, and its type is never asked about", () => {
    // The printed sentence qualifies the DESTINATION only — "switch 1 of your
    // Benched {D} Pokémon with your Active Pokémon" — where Giovanni's owner
    // narrowing qualifies BOTH ends. ⚠️ THE MUTANT THIS KILLS: sharing
    // `ownerPokemon`'s "is the Active in the subgroup?" early return, which would
    // empty the set on every board whose Active is not {D} and refuse a switch the
    // card offers. `fix-basic-1` is Colorless.
    for (const seed of SEEDS) {
      const state = board(seed, "fix-basic-1", ["sv06.5-039", "fix-darkbench", "fix-dualdark"]);
      // The Ability is used from the BENCH here (activeOnly: false).
      const parked = must(useChains(state, BENCH(0)));
      const { candidates } = choosePrompt(parked);
      expect(refNames(parked, candidates).sort()).toEqual(["Dark Cadet", "Dusk Ember"]);
      expect(candidates.every((ref) => ref.spot.spot === "bench")).toBe(true);
    }
  });

  it("the prompt CAPTION names exactly the set the rows show", () => {
    const state = board(3, "sv06.5-039", ["fix-lightbench", "fix-darkbench", "fix-dualdark"]);
    const { note } = choosePrompt(must(useChains(state, ACTIVE)));
    // The card's own word order and its own words: zone, type, then the exclusion.
    // ✅ **AND THE §9.2 TAIL IS ALREADY IN THE CAPTION, AT ZERO COST.**
    // `describeBranch` has carried an `applyStatus target: "self"` arm since D235
    // ("it is now Poisoned"), and `switchActive`'s own arm refuses to describe a
    // NARROWED switch — so the antecedent comes from the prompt and the consequent
    // from the gate, and the player is told what answering buys them without this
    // slice adding a describer line. That refusal is load-bearing: without it the
    // sentence would open "switch your Active Pokémon with 1 of your Benched
    // Pokémon", naming a set three bodies wider than the rows below it.
    expect(note).toBe(
      "Switch to which Benched Darkness Pokémon, except any Pecharunt ex? If you do, it is now Poisoned.",
    );
  });
});

// ── 3. The switch and its §9.2 tail ─────────────────────────────────────────

describe("the switch, and the poison that rides its record", () => {
  it("the chosen body becomes Active, the old Active benches, and the NEW Active is Poisoned", () => {
    for (const seed of SEEDS) {
      const state = board(seed, "sv06.5-039", ["fix-lightbench", "fix-darkbench", "fix-dualdark"]);
      expect(poisoned(state, "p1")).toBe(false);
      const parked = must(useChains(state, ACTIVE));
      const { candidates } = choosePrompt(parked);
      const chosen = candidates.find((ref) => refNames(parked, [ref])[0] === "Dark Cadet");
      if (chosen === undefined) throw new Error("Dark Cadet was not offered");
      const done = must(applyAction(parked, pick(chosen)));
      expect(activeName(done, "p1")).toBe("Dark Cadet");
      // ⚠️ THE POISON IS ON THE PROMOTED BODY, NOT ON PECHARUNT. `applyStatus`
      // `"self"` resolves to the seat's Active AT THE MOMENT IT RUNS, which is
      // after the switch — the printed "the NEW Active Pokémon".
      expect(poisoned(done, "p1")).toBe(true);
      // …and the old Active is on the Bench, unpoisoned. A status written before
      // the switch would show up here instead.
      const benchNames = done.players.p1.bench.map((_, i) => refNames(done, [P1_BENCH(i)])[0]);
      expect(benchNames).toContain("Pecharunt ex");
    }
  });

  it("the poison rides the RECORD, so a switch that never happened poisons nothing", () => {
    // ⚠️ THE SEPARATING BOARD FOR `recordGate`. With no admissible bench body the
    // op files `[]` and the gate does not open — but the WHOLE Ability must also
    // be refused, so the poison can only be observed through the refusal. The
    // positive twin is the very next assertion: the same board with ONE admitted
    // body added succeeds and poisons.
    const barren = board(3, "sv06.5-039", ["sv06.5-085", "fix-lightbench"]);
    const refused = useChains(barren, ACTIVE);
    expect(refused.ok).toBe(false);
    expect(poisoned(barren, "p1")).toBe(false);

    const fertile = board(3, "sv06.5-039", [
      "sv06.5-085",
      "fix-lightbench",
      "fix-darkbench",
      "fix-dualdark",
    ]);
    const parked = must(useChains(fertile, ACTIVE));
    const { candidates } = choosePrompt(parked);
    expect(refNames(parked, candidates).sort()).toEqual(["Dark Cadet", "Dusk Ember"]);
    const done = must(applyAction(parked, pick(candidates[0] as PokemonRef)));
    expect(poisoned(done, "p1")).toBe(true);
  });

  it("a bench of exactly ONE admitted body is FORCED — no prompt, and it still poisons", () => {
    // `parkOrForce`'s other ending. The narrowings are what make this board
    // reachable at all: three bodies are benched and two are refused.
    for (const seed of SEEDS) {
      const state = board(seed, "sv06.5-039", ["sv06.5-085", "fix-lightbench", "fix-darkbench"]);
      const done = must(useChains(state, ACTIVE));
      expect(done.phase.kind).toBe("turn:action");
      expect(activeName(done, "p1")).toBe("Dark Cadet");
      expect(poisoned(done, "p1")).toBe(true);
    }
  });
});

// ── 4. The refusal — and its positive twin on the same board ────────────────

describe("the refusal when no benched body is admissible", () => {
  it("a bench of {D} Pecharunt ex and a non-{D} body refuses; adding ONE {D} body succeeds", () => {
    for (const seed of SEEDS) {
      const barren = board(seed, "sv06.5-039", ["sv06.5-085", "fix-lightbench"]);
      const refused = useChains(barren, ACTIVE);
      expect(refused.ok).toBe(false);
      // The board was NOT empty — two bodies are benched and both are refused for
      // their own printed reason. That is what makes this a narrowing rather than
      // an absence.
      expect(barren.players.p1.bench.length).toBe(2);

      const fertile = benchFromDeck(barren, "p1", "fix-darkbench");
      expect(must(useChains(fertile, ACTIVE)).phase.kind).toBe("turn:action");
    }
  });

  it("an EMPTY-of-{D} bench refuses even when Pecharunt ex is the only other body", () => {
    // The degenerate case the exclusion creates and no other card can: a board
    // whose whole bench is the card's own name. Without "except any Pecharunt ex"
    // this switch would be legal and would swap two Pecharunt ex.
    const state = board(19, "sv06.5-039", ["sv06.5-085"]);
    expect(useChains(state, ACTIVE).ok).toBe(false);
    expect(refNames(state, [P1_BENCH(0)])).toEqual(["Pecharunt ex"]);
  });
});

// ── 5. The cross-copy name lock, on two DISTINCT printings ──────────────────

describe("the name lock — two printings, one use", () => {
  it("using it from one copy locks the OTHER copy for the turn", () => {
    // ⚠️ TWO DISTINCT IDS, D272's rule: two `sv06.5-039` would pass an
    // implementation keyed `${cardId}:${name}`.
    for (const seed of SEEDS) {
      const state = board(seed, "sv06.5-039", ["sv06.5-085", "fix-darkbench", "fix-dualdark"]);
      const parked = must(useChains(state, ACTIVE));
      const { candidates } = choosePrompt(parked);
      const done = must(applyAction(parked, pick(candidates[0] as PokemonRef)));
      // The second copy is now on the bench somewhere; every bench index is tried
      // and none of them may fire, which is stronger than naming one.
      for (let i = 0; i < done.players.p1.bench.length; i += 1) {
        expect(useChains(done, BENCH(i)).ok, `bench ${i}`).toBe(false);
      }
    }
  });

  it("the lock is per TURN — the same board a turn later fires again", () => {
    // The positive twin of the lock: without it, "refused" could be "the board
    // stopped admitting anything".
    let state = board(3, "sv06.5-039", ["sv06.5-085", "fix-darkbench", "fix-dualdark"]);
    const parked = must(useChains(state, ACTIVE));
    const { candidates } = choosePrompt(parked);
    state = must(applyAction(parked, pick(candidates[0] as PokemonRef)));
    expect(useChains(state, ACTIVE).ok).toBe(false);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    // A fresh turn: some Pecharunt ex on the board can chain again.
    const anyFires = [ACTIVE, BENCH(0), BENCH(1), BENCH(2)].some(
      (target) => useChains(state, target).ok,
    );
    expect(anyFires).toBe(true);
  });
});

// ── 6. The blast radius — what this slice did NOT change ────────────────────

describe("the blast radius", () => {
  it("the UNMARKED switch prompt is byte-identical to what it was, DRIVEN", () => {
    // ⚠️ **THE MUTANT THIS KILLS: SPELLING THE TWO RIDERS UNCONDITIONALLY** in
    // `switchTargetNoun`, which would rewrite the caption of every switch printing
    // in the game. Asserting it off the helper would prove nothing about what a
    // player sees, so Switch `sv01-194` — `[{ op: "switchActive" }]`, no riders at
    // all — is PLAYED on a bench of two, where the same helper builds its prompt.
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
    let state = board(3, "fix-basic-1", ["fix-darkbench", "fix-lightbench"]);
    state = handFromDeck(state, "p1", "sv01-194", 1);
    const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === "sv01-194");
    if (uid === undefined) throw new Error("Switch is not in hand");
    const parked = must(applyAction(state, { type: "playTrainer", seat: "p1", uid }));
    const { candidates, note } = choosePrompt(parked);
    // The type-refused body is offered here, which is the whole claim: a bare
    // switch takes ANY benched body, and the riders are opt-in.
    expect(refNames(parked, candidates).sort()).toEqual(["Dark Cadet", "Volt Cadet"]);
    expect(note).toBe("Switch to which Benched Pokémon?");
  });

  it("every other registry `switchActive` is rider-free — measured over the live pool", () => {
    const riderless: string[] = [];
    for (const id of registryCardIds()) {
      const program = programFor(id);
      const ops = [
        ...(program?.abilities ?? []).flatMap((a) => a.program),
        ...(program?.triggered ?? []).flatMap((a) => a.program),
        ...(program?.trainer ?? []),
      ];
      for (const op of ops) {
        if (op.op !== "switchActive") continue;
        if (op.targetType === undefined && op.exceptNamed === undefined) riderless.push(id);
      }
    }
    // Anti-vacuity: the pool really does hold other `switchActive` rows.
    expect(riderless.length).toBeGreaterThan(0);
    expect(riderless).not.toContain("sv06.5-039");
  });

  it("`MATCH_RECORD_VERSION` STAYS 14 — DRIVEN by replaying a v14-shaped park", () => {
    // The standing test is "can the PREVIOUS deploy's RECORD hold the new TYPE"
    // (apps/api/src/lobby/match.ts). Nothing was added to `GameState`, to any
    // event or to any allowance — but a PARKED program SERIALIZES INTO THE PHASE,
    // so the two new op fields DO cross the record boundary and the question is
    // real rather than rhetorical.
    //
    // The direction that matters is a v14 record read by THIS deploy: it holds a
    // `switchActive` with NO riders, because no v14 deploy had a registry row
    // that could write one. That must read back BENIGNLY rather than throw. Driven
    // by stripping the riders off a live parked continuation and resuming it.
    const state = board(3, "sv06.5-039", ["fix-lightbench", "fix-darkbench", "fix-dualdark"]);
    const parked = must(useChains(state, ACTIVE));
    const roundTripped = JSON.parse(JSON.stringify(parked)) as GameState;
    // A JSON round trip alone changes nothing — the whole union is JSON-safe.
    expect(choosePrompt(roundTripped).candidates.length).toBe(2);

    const legacy = JSON.parse(
      JSON.stringify(parked).replaceAll('"targetType":"Darkness",', "").replaceAll('"exceptNamed":"Pecharunt ex",', ""),
    ) as GameState;
    // 🆕 **AND THE DRIVE ANSWERS A QUESTION THE ARGUMENT WOULD HAVE GOT WRONG.**
    // The riders are NOT re-read on resume: `parkOrForce` files the CANDIDATE LIST
    // and the CAPTION into the phase, so the record carries the narrowing's RESULT
    // rather than its inputs. Stripping the two fields therefore changes nothing
    // at all — the park resumes with the same two rows and the same caption, and
    // `switchActiveTargets` is never called again. That is BENIGN in the strongest
    // available sense, and it is the reason a v14 record cannot be misread: a
    // pre-D273 park holds a pre-D273 candidate list, computed by the deploy that
    // wrote it.
    const { candidates, note } = choosePrompt(legacy);
    expect(refNames(legacy, candidates).sort()).toEqual(["Dark Cadet", "Dusk Ember"]);
    expect(note).toBe(choosePrompt(parked).note);
    // …and answering it still works, which is what "replays" means.
    expect(must(applyAction(legacy, pick(candidates[0] as PokemonRef))).phase.kind).toBe(
      "turn:action",
    );
  });

  it("Fan Rotom was BUILT at D275 — the two named mechanisms, both landed", () => {
    // ⚠️ **THIS ASSERTION WAS INVERTED BY THE NEXT SLICE, WHICH IS THE OUTCOME A
    // REFUSAL ROW IS FOR.** D272 and D273 both wrote it as *"STILL refused"* and
    // named the two missing mechanisms: (a) *"Once during your **first** turn"* is
    // a per-seat turn ORDINAL — `state.turn` alone cannot answer it, since the
    // second player's first turn is turn 2; (b) *"up to 3 {C} Pokémon with 100 HP
    // or less"* wants `typedPokemon` to grow D265's `maxHp` rider, plus a REVEAL.
    //
    // ✅ **BOTH DIAGNOSES WERE RIGHT, AND THE THIRD CLAUSE WAS A MISCOUNT.** D275
    // built (a) as `BoardCondition.yourFirstTurn` over a DERIVED read
    // (`isFirstTurnOf`, types.ts — no `GameState` field) and (b) as one optional
    // property on an existing member. The "plus a REVEAL" was already there:
    // `searchDeck.reveal` has shipped since Metallic Signal, so the note
    // over-priced the row by a mechanism. **A refusal note ages in both
    // directions — its gaps close and its inventory rots.**
    //
    // Kept HERE rather than moved (provenance is annotated, never overwritten):
    // this file is where the ladder was last measured, and the row it refused is
    // the row that completes it.
    for (const id of ["sv07-118", "sv08.5-085"]) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name, id).toBe("Fan Call");
      expect(ability?.playableIf, id).toEqual({ kind: "yourFirstTurn" });
      expect(ability?.oncePerTurn, id).toBe("sharedByName");
    }
  });
});
