import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, programFor, topCardOf } from "./index";
import type { GameState, PokemonRef, Seat } from "./index";
import { registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  must,
  setActiveFromDeck,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const SUBJUGATING_CHAINS_TEXT =
  "Once during your turn, you may switch 1 of your Benched {D} Pokémon, except any Pecharunt ex, with your Active Pokémon. If you do, the new Active Pokémon is now Poisoned. You can't use more than 1 Subjugating Chains Ability each turn.";

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

const CHAINS_DECK = deckOf({
  "sv06.5-039": 4,
  "sv06.5-085": 4,
  "fix-darkbench": 4,
  "fix-dualdark": 4,
  "fix-firedark": 4,
  "fix-lightbench": 4,
  "fix-basic-1": 4,
  "sv01-194": 2,
  "fix-energy": 30,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: CHAINS_DECK, p2: CHAINS_DECK }, { pool: POOL, first });
}

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
    for (const seed of SEEDS) {
      const state = board(seed, "sv06.5-039", ["fix-lightbench", "fix-darkbench", "fix-dualdark"]);
      const parked = must(useChains(state, ACTIVE));
      const { candidates } = choosePrompt(parked);
      expect(refNames(parked, candidates).sort()).toEqual(["Dark Cadet", "Dusk Ember"]);
    }
  });

  it("a benched Pecharunt ex is NOT offered even though it IS {D} — the exclusion is live", () => {
    for (const seed of SEEDS) {
      const state = board(seed, "sv06.5-039", ["sv06.5-085", "fix-darkbench", "fix-dualdark"]);
      const parked = must(useChains(state, ACTIVE));
      const { candidates } = choosePrompt(parked);
      expect(refNames(parked, candidates).sort()).toEqual(["Dark Cadet", "Dusk Ember"]);
    }
  });

  it("a DUAL-TYPE body is offered in either printed order — membership, not equality", () => {
    for (const seed of SEEDS) {
      const state = board(seed, "sv06.5-039", ["fix-dualdark", "fix-firedark"]);
      const parked = must(useChains(state, ACTIVE));
      const { candidates } = choosePrompt(parked);
      expect(refNames(parked, candidates).sort()).toEqual(["Dusk Ember", "Ember Dusk"].sort());
    }
  });

  it("the ACTIVE is never a candidate, and its type is never asked about", () => {
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
      expect(poisoned(done, "p1")).toBe(true);
      // …and the old Active is on the Bench, unpoisoned. A status written before
      // the switch would show up here instead.
      const benchNames = done.players.p1.bench.map((_, i) => refNames(done, [P1_BENCH(i)])[0]);
      expect(benchNames).toContain("Pecharunt ex");
    }
  });

  it("the poison rides the RECORD, so a switch that never happened poisons nothing", () => {
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

describe("the name lock — two printings, one use", () => {
  it("using it from one copy locks the OTHER copy for the turn", () => {
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

describe("the blast radius", () => {
  it("the UNMARKED switch prompt is byte-identical to what it was, DRIVEN", () => {
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
    const state = board(3, "sv06.5-039", ["fix-lightbench", "fix-darkbench", "fix-dualdark"]);
    const parked = must(useChains(state, ACTIVE));
    const roundTripped = roundTrip(parked);
    // A JSON round trip alone changes nothing — the whole union is JSON-safe.
    expect(choosePrompt(roundTripped).candidates.length).toBe(2);

    const legacy = JSON.parse(
      JSON.stringify(parked)
        .replaceAll('"targetType":"Darkness",', "")
        .replaceAll('"exceptNamed":"Pecharunt ex",', ""),
    ) as GameState;
    const { candidates, note } = choosePrompt(legacy);
    expect(refNames(legacy, candidates).sort()).toEqual(["Dark Cadet", "Dusk Ember"]);
    expect(note).toBe(choosePrompt(parked).note);
    // …and answering it still works, which is what "replays" means.
    expect(must(applyAction(legacy, pick(candidates[0] as PokemonRef))).phase.kind).toBe(
      "turn:action",
    );
  });

  it("Fan Rotom was BUILT at D275 — the two named mechanisms, both landed", () => {
    for (const id of ["sv07-118", "sv08.5-085"]) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name, id).toBe("Fan Call");
      expect(ability?.playableIf, id).toEqual({ kind: "yourFirstTurn" });
      expect(ability?.oncePerTurn, id).toBe("sharedByName");
    }
  });
});
