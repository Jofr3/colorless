import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import { programFor } from "./registry";
import {
  BENCH_SWITCH_DECK,
  FIXTURE_POOL,
  activeUid,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const SWITCH_SENTENCE =
  "When you play this Pokémon from your hand onto your Bench during your turn, you may switch it with your Active Pokémon. If you do, you may move any amount of Energy from your other Pokémon to this Pokémon.";

const SHOWTIME_SENTENCE =
  "Once during your turn, if this Pokémon is on your Bench, you may switch it with your Active Pokémon.";

const RAPID_VERNIER_IDS = [
  "svp-128",
  "sv05-025",
  "sv05-186",
  "sv05-203",
  "sv05-213",
  "sv08.5-176",
] as const;

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** p1 (going first) on BENCH_SWITCH_DECK with a `fix-plain-body` Active on both
    seats. Turn 1, p1 to act. */
function board(seed: number): GameState {
  return driveSetup(
    seed,
    { p1: BENCH_SWITCH_DECK, p2: BENCH_SWITCH_DECK },
    { first: "p1", active: { p1: "fix-plain-body", p2: "fix-plain-body" } },
  );
}

function confirmPrompt(state: GameState): { kind: string; note?: string } {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.prompt;
}

function movePrompt(state: GameState): {
  movable: { uid: string; from: PokemonRef }[];
  destinations: PokemonRef[];
  max: number;
  note?: string;
  anySource?: true;
} {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
  return prompt;
}

/** Put a `fix-rapidvernier` in p1's hand and play it to the Bench, returning the
    state parked on the trigger's own confirm. */
function playTrigger(state: GameState): { state: GameState; events: GameEvent[]; uid: string } {
  const withCard = handFromDeck(state, "p1", "fix-rapidvernier", 1);
  const uid = handUid(withCard, "p1", "fix-rapidvernier");
  const { state: next, events } = mustApply(withCard, {
    type: "playBasicToBench",
    seat: "p1",
    uid,
  });
  return { state: next, events, uid };
}

// ── §1 — the registry rows exist and are the printed bytes ──────────────────

describe("D244 §1 — the two programs and the printings they serve", () => {
  it("all six Iron Leaves ex printings carry the SAME triggered program", () => {
    for (const id of RAPID_VERNIER_IDS) {
      const triggered = programFor(id)?.triggered;
      expect(triggered, `${id} has no triggered ability`).toBeDefined();
      expect(triggered?.[0]?.name).toBe("Rapid Vernier");
      expect(triggered?.[0]?.trigger).toBe("onPlayToBench");
    }
    // One shared object, not six transcriptions that could drift.
    for (const id of RAPID_VERNIER_IDS) {
      expect(programFor(id)).toBe(programFor("svp-128"));
    }
  });

  it("the program is the sentence's three clauses, in the sentence's order", () => {
    const program = programFor("sv05-025")?.triggered?.[0]?.program;
    // Clause 2 and 3 both sit under the printed "you may" — the confirm.
    expect(program?.length).toBe(1);
    const outer = program?.[0];
    if (outer?.op !== "optional") throw new Error("expected the printed 'you may' wrapper");
    const [sw, gate] = outer.then;
    if (sw?.op !== "switchActive") throw new Error("expected switchActive first");
    expect(sw.fromSource).toBe(true);
    expect(sw.recordAs).toBe("moved");
    // "If you do" — the §9.2 record gate on the uid that ACTUALLY became Active.
    if (gate?.op !== "recordGate") throw new Error("expected the 'If you do' gate");
    expect(gate.slot).toBe("moved");
    const move = gate.then[0];
    if (move?.op !== "moveEnergy") throw new Error("expected moveEnergy inside the gate");
    expect(move.route).toBe("othersToSelf");
    expect(move.max).toBe("any"); // "any amount"
    expect(move.anySource).toBe(true); // the printed PLURAL "your other Pokémon"
    expect(move.filter).toEqual({ kind: "anyEnergy" }); // bare "Energy"
  });

  it("Meowscarada sv09-018 is the SAME op field with NO energy tail", () => {
    const ability = programFor("sv09-018")?.abilities?.[0];
    expect(ability?.name).toBe("Showtime");
    expect(ability?.oncePerTurn).toBe(true);
    expect(ability?.activeOnly).toBe(false);
    expect(ability?.program).toEqual([{ op: "switchActive", fromSource: true }]);
  });

  it("the two fixtures carry the PRINTED sentences, byte for byte", () => {
    expect(FIXTURE_POOL["fix-rapidvernier"]?.abilities?.[0]?.effect).toBe(SWITCH_SENTENCE);
    expect(FIXTURE_POOL["fix-showtime"]?.abilities?.[0]?.effect).toBe(SHOWTIME_SENTENCE);
    // …and the fixtures resolve to the SAME program objects the real ids do, so a
    // suite driving `fix-*` is driving what `svp-128` / `sv09-018` will do.
    expect(programFor("fix-rapidvernier")).toBe(programFor("svp-128"));
    expect(programFor("fix-showtime")).toBe(programFor("sv09-018"));
  });
});

// ── §2 — the trigger: the confirm, the switch, and the pronoun ──────────────

describe("D244 §2 — 'you may switch it with your Active Pokémon'", () => {
  it("fires on the bench play and parks on a CONFIRM, not on a bench pick", () => {
    const { state, events } = playTrigger(board(8));
    expect(types(events)).toContain("POKEMON_BENCHED");
    expect(findEvent(events, "ABILITY_TRIGGERED")?.ability).toBe("Rapid Vernier");
    expect(state.phase.kind).toBe("effect:choose");
    const prompt = confirmPrompt(state);
    expect(prompt.kind).toBe("confirm");
    expect(prompt.note).toBe(
      "You may switch this Pokémon with your Active Pokémon. If you do, you may move any amount of Energy from your other Pokémon to this Pokémon.",
    );
  });

  it("YES promotes the body the trigger fired on — not some other benched body", () => {
    let state = benchFromDeck(board(8), "p1", "fix-switch-ally");
    state = benchFromDeck(state, "p1", "fix-plain-body");
    const { state: parked, uid } = playTrigger(state);
    expect(parked.players.p1.bench.length).toBe(3);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    // The just-played Iron Leaves is Active; the old Active went to the Bench.
    expect(activeUid(done, "p1")).toBe(uid);
    expect(findEvent(events, "POKEMON_SWITCHED")?.nowActive).toBe(uid);
    expect(done.players.p1.bench.length).toBe(3);
    expect(done.cardIdByUid[benchTopUid(done, "p1", 2)]).toBe("fix-plain-body");
  });

  it("NO runs nothing at all — no switch, no move, straight back to turn:action", () => {
    const { state: parked } = playTrigger(board(8));
    const activeBefore = activeUid(parked, "p1");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(activeUid(done, "p1")).toBe(activeBefore);
    expect(types(events)).not.toContain("POKEMON_SWITCHED");
    expect(types(events)).not.toContain("ENERGY_MOVED");
  });
});

// ── §3 — the tail: "any amount of Energy from your other Pokémon" ───────────

describe("D244 §3 — 'If you do, you may move any amount of Energy…'", () => {
  /** A board with Energy spread over the Active and one benched ally, an Iron
      Leaves played to the Bench, and the confirm answered YES. */
  function afterSwitch(seed = 8): { state: GameState; leaves: string } {
    let state = benchFromDeck(board(seed), "p1", "fix-switch-ally");
    state = attachFromDeck(state, "p1", "fix-energy", 2); // 2 on the Active
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1);
    state = attachBenchFromDeck(state, "p1", 0, "fix-special", 1); // a SPECIAL, on the ally
    const { state: parked, uid } = playTrigger(state);
    const { state: moving } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    return { state: moving, leaves: uid };
  }

  it("the destination is the body the sentence is printed on, READ AFTER the switch", () => {
    const { state, leaves } = afterSwitch();
    const prompt = movePrompt(state);
    expect(prompt.destinations).toHaveLength(1);
    expect(prompt.destinations[0]).toEqual({ seat: "p1", spot: { spot: "active" } });
    expect(activeUid(state, "p1")).toBe(leaves);
  });

  it("'your OTHER Pokémon' excludes the destination from the OFFER, not just the apply", () => {
    let state = benchFromDeck(board(8), "p1", "fix-switch-ally");
    state = attachFromDeck(state, "p1", "fix-energy", 2); // 2 on the Active
    const { state: parked } = playTrigger(state);
    const leavesIndex = parked.players.p1.bench.length - 1;
    const seeded = attachBenchFromDeck(parked, "p1", leavesIndex, "fix-energy", 2);
    const { state: moving } = mustApply(seeded, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    const prompt = movePrompt(moving);
    // The Iron Leaves is the Active now and holds 2 of the board's 4 Energy —
    // and NONE of them is offered.
    expect(moving.players.p1.active?.energy).toHaveLength(2);
    for (const entry of prompt.movable) {
      expect(entry.from).not.toEqual({ seat: "p1", spot: { spot: "active" } });
    }
    expect(prompt.movable).toHaveLength(2);
    expect(new Set(prompt.movable.map((m) => JSON.stringify(m.from))).size).toBe(1);
  });

  it('`max: "any"` is the WHOLE movable set, and the note prints no number', () => {
    const { state } = afterSwitch();
    const prompt = movePrompt(state);
    expect(prompt.max).toBe(prompt.movable.length);
    expect(prompt.max).toBe(4);
    expect(prompt.note).toBe("Move any amount of Energy from your other Pokémon to this Pokémon.");
    expect(prompt.anySource).toBe(true);
  });

  it("one answer sweeps SEVERAL sources, and files one ENERGY_MOVED per source", () => {
    const { state, leaves } = afterSwitch();
    const prompt = movePrompt(state);
    const all = prompt.movable.map((m) => m.uid);
    const { state: done, events } = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: all.map((uid) => ({ uid, dest: prompt.destinations[0] as PokemonRef })),
      },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.active?.energy).toHaveLength(4);
    expect(activeUid(done, "p1")).toBe(leaves);
    const moved = findAll(events, "ENERGY_MOVED");
    expect(moved).toHaveLength(2);
    expect(moved.flatMap((m) => m.uids).sort()).toEqual([...all].sort());
    // Every source is stripped bare.
    for (const pokemon of done.players.p1.bench) expect(pokemon.energy).toHaveLength(0);
  });

  it("the filter is bare 'Energy' — a SPECIAL Energy moves too", () => {
    const { state } = afterSwitch();
    const prompt = movePrompt(state);
    const special = prompt.movable.filter((m) => state.cardIdByUid[m.uid] === "fix-special");
    expect(special).toHaveLength(1);
    const { state: done } = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [{ uid: special[0]?.uid as string, dest: prompt.destinations[0] as PokemonRef }],
      },
    });
    expect(done.players.p1.active?.energy).toEqual([special[0]?.uid]);
  });

  it("the move is DECLINABLE and the switch still stands — the second 'you may'", () => {
    // The printed "you may move" needs no `optional` wrapper: this family parks
    // with a legal EMPTY answer, so wrapping it would ask the same question twice.
    const { state, leaves } = afterSwitch();
    movePrompt(state);
    const { state: done, events } = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(activeUid(done, "p1")).toBe(leaves);
    expect(done.players.p1.active?.energy).toHaveLength(0);
    expect(types(events)).not.toContain("ENERGY_MOVED");
  });

  it("with no Energy anywhere the tail is a silent no-op, not a park", () => {
    const { state: parked } = playTrigger(benchFromDeck(board(8), "p1", "fix-switch-ally"));
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    // The switch happened; the move had nothing to offer and resolved the program.
    expect(done.phase.kind).toBe("turn:action");
    expect(done.cardIdByUid[activeUid(done, "p1")]).toBe("fix-rapidvernier");
  });
});

// ── §3b — the FLAGGED EQUIVALENCE, pinned by a constructed board ────────────

describe("D244 §3b — `othersToSelf` vs `benchToActive`, on the board that separates them", () => {
  it("used from the BENCH, the sources INCLUDE the Active and the target is the source", () => {
    let state = benchFromDeck(board(8), "p1", "fix-othersmove");
    state = attachFromDeck(state, "p1", "fix-energy", 2); // on the ACTIVE
    const benched = benchTopUid(state, "p1", 0);
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Gather Inward",
    });
    const prompt = movePrompt(parked);
    // The DESTINATION is the benched source — `benchToActive` says the Active.
    expect(prompt.destinations).toEqual([{ seat: "p1", spot: { spot: "bench", index: 0 } }]);
    // The SOURCES include the Active — `benchToActive` excludes it by construction.
    expect(prompt.movable).toHaveLength(2);
    for (const entry of prompt.movable) {
      expect(entry.from).toEqual({ seat: "p1", spot: { spot: "active" } });
    }
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: prompt.movable.map((m) => ({
          uid: m.uid,
          dest: prompt.destinations[0] as PokemonRef,
        })),
      },
    });
    expect(done.players.p1.active?.energy).toHaveLength(0);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(benchTopUid(done, "p1", 0)).toBe(benched);
  });

  it("and the gate refuses it when the only Energy is already on the source", () => {
    let state = benchFromDeck(board(8), "p1", "fix-othersmove");
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 2); // on the SOURCE itself
    const use = {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Gather Inward",
    } as const;
    const refused = applyAction(state, use);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected a refusal");
    expect(refused.error.code).toBe("NO_LEGAL_TARGET");
    // One Energy on somebody ELSE and the same call is accepted.
    expect(applyAction(attachFromDeck(state, "p1", "fix-energy", 1), use).ok).toBe(true);
  });
});

// ── §4 — the ACTIVATED sibling and the gate it makes drivable ───────────────

describe("D244 §4 — Meowscarada's 'Showtime' and the programPlayable gate", () => {
  const use = (index: number) =>
    ({
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index },
      abilityName: "Showtime",
    }) as const;

  it("a BENCHED Meowscarada switches itself in, with no prompt at all", () => {
    const state = benchFromDeck(board(12), "p1", "fix-showtime");
    const benched = benchTopUid(state, "p1", 0);
    const { state: done, events } = mustApply(state, use(0));
    expect(done.phase.kind).toBe("turn:action");
    expect(activeUid(done, "p1")).toBe(benched);
    expect(findEvent(events, "POKEMON_SWITCHED")?.nowActive).toBe(benched);
  });

  it("an ACTIVE Meowscarada is REFUSED — the printed 'if this Pokémon is on your Bench'", () => {
    let state = setActiveFromDeck(board(12), "p1", "fix-showtime");
    state = benchFromDeck(state, "p1", "fix-plain-body"); // a bench that IS non-empty
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Showtime",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("…and it is refused for THAT reason, not because the Bench is empty", () => {
    const state = benchFromDeck(board(12), "p1", "fix-showtime");
    expect(state.players.p1.bench).toHaveLength(1);
    expect(applyAction(state, use(0)).ok).toBe(true);
  });

  it("'Once during your turn' — the second use is refused", () => {
    const state = benchFromDeck(board(12), "p1", "fix-showtime");
    const { state: after } = mustApply(state, use(0));
    // It is the ACTIVE now, so the once-per-turn stamp is what a second call
    // would have to get past — and the bench-only rule sits in front of it.
    const again = applyAction(after, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Showtime",
    });
    expect(again.ok).toBe(false);
  });
});

// ── §5 — §9, the Ability lock, on BOTH surfaces ────────────────────────────

describe("D244 §5 — what an Ability-lock does to a TRIGGER and to an ACTIVATION", () => {
  /** Klefki `sv01-096` in p2's Active Spot: "Basic Pokémon in play (both yours
      and your opponent's) have no Abilities", Active-only, itself exempt. */
  function locked(seed: number): GameState {
    return setActiveFromDeck(board(seed), "p2", "sv01-096");
  }

  it("a trigger that has NOT fired is SILENCED — no ABILITY_TRIGGERED, no park", () => {
    const { state, events } = playTrigger(locked(8));
    expect(types(events)).toContain("POKEMON_BENCHED");
    expect(types(events)).not.toContain("ABILITY_TRIGGERED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p1.bench).toHaveLength(1);
  });

  it("a trigger that HAS fired is NOT unwound by a lock arriving later", () => {
    const { state: parked } = playTrigger(board(8));
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    const promoted = activeUid(done, "p1");
    const afterLock = setActiveFromDeck(done, "p2", "sv01-096");
    expect(activeUid(afterLock, "p1")).toBe(promoted);
    expect(afterLock.cardIdByUid[promoted]).toBe("fix-rapidvernier");
  });

  it("the ACTIVATED sibling reports the LOCK, not the bench rule", () => {
    // Order matters: §9's lock is checked BEFORE `programPlayable`, so a locked
    // benched Meowscarada is told the truth about why it cannot act.
    const state = benchFromDeck(locked(12), "p1", "fix-showtime");
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Showtime",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("ABILITY_DISABLED");
  });

  it("the lock is what does it — the same board without Klefki accepts", () => {
    const state = benchFromDeck(board(12), "p1", "fix-showtime");
    expect(
      must(
        applyAction(state, {
          type: "useAbility",
          seat: "p1",
          target: { spot: "bench", index: 0 },
          abilityName: "Showtime",
        }),
      ).phase.kind,
    ).toBe("turn:action");
  });
});
