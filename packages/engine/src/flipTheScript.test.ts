import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { abilityUsedKey, applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  must,
  mustApply,
  setActiveFromDeck,
  driveSetup,
} from "./testFixtures";

function abilityBody(id: string, name: string, effect: string, cardName: string): Card {
  return battler(id, {
    name: cardName,
    hp: 140,
    retreat: 1,
    abilities: [{ type: "Ability", name, effect }],
  });
}

const FLIP_THE_SCRIPT_TEXT =
  "Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip the Script Ability each turn.";

const LOCAL_CARDS: Record<string, Card> = {
  "sv06.5-038": abilityBody(
    "sv06.5-038",
    "Flip the Script",
    FLIP_THE_SCRIPT_TEXT,
    "Fezandipiti ex",
  ),
  "sv06.5-084": abilityBody(
    "sv06.5-084",
    "Flip the Script",
    FLIP_THE_SCRIPT_TEXT,
    "Fezandipiti ex",
  ),
  "sv06.5-092": abilityBody(
    "sv06.5-092",
    "Flip the Script",
    FLIP_THE_SCRIPT_TEXT,
    "Fezandipiti ex",
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const FLIP_DECK = deckOf({
  "sv06.5-038": 4,
  "sv06.5-084": 4,
  "sv06.5-092": 4,
  "fix-sniper": 4,
  "fix-victim": 4,
  "fix-basic-1": 8,
  "fix-energy": 32,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: FLIP_DECK, p2: FLIP_DECK }, { pool: POOL, first });
}

function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count } = next.phase;
      const prizeIndices = Array.from({ length: count }, (_, i) => i);
      next = must(applyAction(next, { type: "takePrizes", seat, prizeIndices }));
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

function twoFezandipitiAfterKo(seed: number): GameState {
  let state = localSetup(seed, "p1");
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = setActiveFromDeck(state, "p2", "fix-sniper");
  state = attachFromDeck(state, "p2", "fix-energy", 1); // pays Spread Shot [C]
  state = setActiveFromDeck(state, "p1", "fix-victim");
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "sv06.5-038");
  state = benchFromDeck(state, "p1", "sv06.5-084");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  const after = settle(mustApply(state, { type: "attack", seat: "p2", index: 0 }).state);
  if (after.phase.kind !== "turn:action" || after.phase.seat !== "p1") {
    throw new Error(`expected P1's action phase, got ${after.phase.kind}`);
  }
  return after;
}

const ACTIVE = { spot: "active" } as const;
const BENCH_0 = { spot: "bench", index: 0 } as const;

function useFlip(state: GameState, seat: Seat, target: typeof ACTIVE | typeof BENCH_0) {
  return applyAction(state, {
    type: "useAbility",
    seat,
    target,
    abilityName: "Flip the Script",
  });
}

function drawnBy(events: GameEvent[], seat: Seat): number {
  return events
    .filter((e): e is Extract<GameEvent, { type: "CARDS_DRAWN" }> => e.type === "CARDS_DRAWN")
    .filter((e) => e.seat === seat)
    .reduce((total, e) => total + e.uids.length, 0);
}

function must0<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a registry ability");
  return value;
}

const SEEDS = [5, 17, 33, 52, 71] as const;

// ── 1. The registry rows — the printed sentence, as data ─────────────────────

describe("Fezandipiti ex — the three printings as registry data", () => {
  it("all THREE ids resolve to one program carrying BOTH new scopes and no new ops", () => {
    for (const id of ["sv06.5-038", "sv06.5-084", "sv06.5-092"]) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name).toBe("Flip the Script");
      // The cross-copy lock. `true` here is the per-body default and would be a
      // live bug on any board with a second copy — driven for real in §3.
      expect(ability?.oncePerTurn).toBe("sharedByName");
      expect(ability?.playableIf).toEqual({ kind: "yourPokemonKoedOnOpponentsLastTurn" });
      // "Once during your turn" carries no Active clause, so a benched
      // Fezandipiti ex may use it — which is also what makes the two-copy board
      // in §3 reachable at all.
      expect(ability?.activeOnly).toBe(false);
      // Tinkaton's op, unchanged: the printed "you may" is not modelled for a
      // pure-upside draw, exactly as "Once during your turn, you may draw 3
      // cards" is not.
      expect(ability?.program).toEqual([{ op: "drawCards", count: 3 }]);
    }
  });

  it("the three printings share ONE program object — a reprint is not a second authoring", () => {
    const first = programFor("sv06.5-038");
    expect(programFor("sv06.5-084")).toBe(first);
    expect(programFor("sv06.5-092")).toBe(first);
  });

  it("no `trainerPlayableIf` was authored — this gate is on the ABILITY surface", () => {
    expect(programFor("sv06.5-038")?.trainerPlayableIf).toBeUndefined();
  });
});

// ── 2. `abilityUsedKey` — the sole funnel, at the unit ───────────────────────

describe("abilityUsedKey — the one place the §9/§15.J key is built", () => {
  const shared = must0(programFor("sv06.5-038")?.abilities?.[0]);
  const perBody = must0(programFor("sv07-014")?.abilities?.[0]); // Hydrapple ex, oncePerTurn: true

  it("a `sharedByName` Ability drops the uid, so two BODIES collide into one key", () => {
    expect(abilityUsedKey("p1#3", shared)).toBe("*:Flip the Script");
    expect(abilityUsedKey("p1#9", shared)).toBe("*:Flip the Script");
    expect(abilityUsedKey("p1#3", shared)).toBe(abilityUsedKey("p1#9", shared));
  });

  it("the DEFAULT scope is untouched — a per-body Ability still keys on its uid", () => {
    expect(perBody.oncePerTurn).toBe(true);
    expect(abilityUsedKey("p1#3", perBody)).toBe("p1#3:Ripening Charge");
    expect(abilityUsedKey("p1#9", perBody)).not.toBe(abilityUsedKey("p1#3", perBody));
  });

  it("the two key spaces are DISJOINT — a uid can never be the `*` sentinel", () => {
    // setup.ts mints uids as `${seat}#${index}`. If it ever stopped doing so, a
    // body could collide with the shared key and lock an unrelated Ability out.
    const state = localSetup(5, "p1");
    const uids = Object.keys(state.cardIdByUid);
    expect(uids.length).toBeGreaterThan(100);
    expect(uids.every((u) => /^p[12]#\d+$/.test(u))).toBe(true);
    expect(uids).not.toContain("*");
  });
});

// ── 3. THE CROSS-COPY LOCK, DRIVEN WITH TWO COPIES IN PLAY ───────────────────

describe("the name lock — two Fezandipiti ex in play share ONE use per turn", () => {
  it("the board really does hold TWO copies, of two DIFFERENT printings", () => {
    const state = twoFezandipitiAfterKo(5);
    const activeId = state.cardIdByUid[state.players.p1.active?.stack.at(-1) ?? ""];
    const benchId = state.cardIdByUid[state.players.p1.bench[0]?.stack.at(-1) ?? ""];
    expect(activeId).toBe("sv06.5-038");
    expect(benchId).toBe("sv06.5-084");
    expect(activeId).not.toBe(benchId);
  });

  it("the FIRST use draws 3 and stamps the NAME-keyed entry, not a uid-keyed one", () => {
    const state = twoFezandipitiAfterKo(5);
    const before = state.players.p1.hand.length;
    const { state: after, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: ACTIVE,
      abilityName: "Flip the Script",
    });
    expect(drawnBy(events, "p1")).toBe(3);
    expect(after.players.p1.hand.length).toBe(before + 3);
    expect(after.allowances.abilitiesUsed).toEqual(["*:Flip the Script"]);
  });

  it("the SECOND copy is REFUSED — the printed cross-copy lock, and the slice's point", () => {
    let state = twoFezandipitiAfterKo(5);
    state = must(useFlip(state, "p1", ACTIVE));
    const second = useFlip(state, "p1", BENCH_0);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("the refusal is the LOCK and not an emptied board — the draw would have worked", () => {
    // A refusal proves nothing unless the same call succeeds when the lock is the
    // only thing removed. Same board, same benched body, same turn — but nothing
    // has been used yet, so the bench copy draws 3 on its own.
    const state = twoFezandipitiAfterKo(5);
    const { state: after, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: BENCH_0,
      abilityName: "Flip the Script",
    });
    expect(drawnBy(events, "p1")).toBe(3);
    expect(after.allowances.abilitiesUsed).toEqual(["*:Flip the Script"]);
  });

  it("EITHER ORDER locks the other — bench first refuses the Active second", () => {
    let state = twoFezandipitiAfterKo(17);
    state = must(useFlip(state, "p1", BENCH_0));
    const second = useFlip(state, "p1", ACTIVE);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("the SAME body is refused too — the wider scope did not lose the narrower one", () => {
    // `"sharedByName"` must still forbid the ORIGINAL per-body repeat. A key that
    // widened by ignoring the flag entirely would pass every cross-copy assertion
    // above and re-open this one.
    let state = twoFezandipitiAfterKo(33);
    state = must(useFlip(state, "p1", ACTIVE));
    const again = useFlip(state, "p1", ACTIVE);
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(again.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("the lock RE-ARMS — it is a per-turn allowance, not a permanent stamp", () => {
    // P1 uses it on turn 3, then turns 4 (P2) and 5 (P1) pass. On turn 5 the KO
    // window has CLOSED, so the re-arm has to be read off the allowance bag
    // rather than off a second successful use; §4 below drives the closed window.
    let state = twoFezandipitiAfterKo(52);
    state = must(useFlip(state, "p1", ACTIVE));
    expect(state.allowances.abilitiesUsed).toEqual(["*:Flip the Script"]);
    state = passTurns(state, 2);
    expect(state.turn).toBe(5);
    expect(state.allowances.abilitiesUsed).toEqual([]);
  });
});

// ── 4. THE PLAY GATE — the widened `useAbility` stack ────────────────────────

describe("AbilityProgram.playableIf — the printed board gate on the ABILITY surface", () => {
  it("the gate HOLDS on the turn after the KO, which is why §3's board works at all", () => {
    const state = twoFezandipitiAfterKo(5);
    expect(state.turn).toBe(3);
    expect(state.lastKoTurn).toEqual({ p1: 2, p2: null });
    expect(useFlip(state, "p1", ACTIVE).ok).toBe(true);
  });

  it("the WINDOW CLOSES — two turns later the same board REFUSES the same Ability", () => {
    let state = twoFezandipitiAfterKo(5);
    state = passTurns(state, 2);
    expect(state.turn).toBe(5);
    expect(state.lastKoTurn.p1).toBe(2); // stamped, but no longer `turn - 1`
    const rejected = useFlip(state, "p1", ACTIVE);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.error.code).toBe("ABILITY_CONDITION_NOT_MET");
    // The message quotes the printed clause verbatim, through the shared
    // `conditionNote` — not a paraphrase authored here.
    expect(rejected.error.message).toContain(
      "any of your Pokémon were Knocked Out during your opponent's last turn",
    );
  });

  it("a refused use is FREE — no draw, no allowance spent, nothing committed", () => {
    let state = twoFezandipitiAfterKo(17);
    state = passTurns(state, 2);
    const before = state.players.p1.hand.length;
    expect(useFlip(state, "p1", ACTIVE).ok).toBe(false);
    expect(state.players.p1.hand.length).toBe(before);
    expect(state.allowances.abilitiesUsed).toEqual([]);
  });

  it("the gate is asked of the ACTING SEAT — the seat that SCORED the KO cannot use it", () => {
    let state = twoFezandipitiAfterKo(33);
    state = passTurns(state, 1); // turn 4 — P2's
    expect(state.phase.kind === "turn:action" && state.phase.seat).toBe("p2");
    state = setActiveFromDeck(state, "p2", "sv06.5-092");
    const rejected = useFlip(state, "p2", ACTIVE);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.error.code).toBe("ABILITY_CONDITION_NOT_MET");
    // …and it is the GATE refusing, not the lock or a missing target: P2's own
    // allowance bag is untouched and their board is otherwise identical to the
    // one P1 used the Ability from.
    expect(state.lastKoTurn.p2).toBeNull();
  });

  it("ORDER: an already-used Ability reports the LOCK, not the gate, when BOTH would refuse", () => {
    let state = twoFezandipitiAfterKo(71);
    state = must(useFlip(state, "p1", ACTIVE));
    const both = useFlip(state, "p1", BENCH_0);
    expect(both.ok).toBe(false);
    if (both.ok) throw new Error("unreachable");
    expect(both.error.code).toBe("ABILITY_ALREADY_USED");
    expect(both.error.code).not.toBe("ABILITY_CONDITION_NOT_MET");
  });

  it("EVERY seed agrees — the gate and the lock are board facts, not deal facts", () => {
    for (const seed of SEEDS) {
      const state = twoFezandipitiAfterKo(seed);
      const first = useFlip(state, "p1", ACTIVE);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("unreachable");
      const second = useFlip(first.state, "p1", BENCH_0);
      expect(second.ok).toBe(false);
      if (second.ok) throw new Error("unreachable");
      expect(second.error.code).toBe("ABILITY_ALREADY_USED");
    }
  });
});

describe("redactGame — the wire HUD greys what `useAbility` would refuse", () => {
  function flipRows(state: GameState, seat: Seat) {
    const view = redactGame(state, seat);
    if (view.phase.kind !== "turn:action") throw new Error(`phase ${view.phase.kind}`);
    return view.phase.abilities.filter((a) => a.abilityName === "Flip the Script");
  }

  it("BOTH copies are lit while the window is open and nothing has been used", () => {
    const rows = flipRows(twoFezandipitiAfterKo(5), "p1");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.disabled)).toBe(true);
  });

  it("using ONE copy greys BOTH rows — the mirror reads the SHARED key", () => {
    let state = twoFezandipitiAfterKo(5);
    state = must(useFlip(state, "p1", ACTIVE));
    const rows = flipRows(state, "p1");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.disabled)).toBe(true);
  });

  it("a CLOSED window greys both rows and says WHY, quoting the printed clause", () => {
    let state = twoFezandipitiAfterKo(17);
    state = passTurns(state, 2);
    const rows = flipRows(state, "p1");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.disabled)).toBe(true);
    for (const row of rows) {
      expect(row.reason).toContain(
        "any of your Pokémon were Knocked Out during your opponent's last turn",
      );
    }
  });

  it("the ALREADY-USED greying carries NO reason — that one IS self-evident", () => {
    // Keeps the two disable causes distinguishable in the HUD, and pins that the
    // gate's reason did not swallow the lock's silence.
    let state = twoFezandipitiAfterKo(33);
    state = must(useFlip(state, "p1", ACTIVE));
    for (const row of flipRows(state, "p1")) expect(row.reason).toBeNull();
  });
});

// ── 6. WHAT DID NOT MOVE ────────────────────────────────────────────────────

describe("the blast radius — what this slice did NOT change", () => {
  it("`MATCH_RECORD_VERSION` STAYS 14 — the derivation, not the habit", () => {
    const state = twoFezandipitiAfterKo(5);
    const legacyBag = ["p1#7:Ripening Charge", "p2#3:Adrena-Brain"];
    const revived: GameState = {
      ...state,
      allowances: { ...state.allowances, abilitiesUsed: legacyBag },
    };
    const perBody = must0(programFor("sv07-014")?.abilities?.[0]);
    // The legacy key round-trips through the new funnel unchanged…
    expect(abilityUsedKey("p1#7", perBody)).toBe("p1#7:Ripening Charge");
    expect(revived.allowances.abilitiesUsed).toContain(abilityUsedKey("p1#7", perBody));
    // …and the new Ability is unaffected by the legacy entries, so a mid-match
    // deploy neither loses nor invents a use.
    expect(useFlip(revived, "p1", ACTIVE).ok).toBe(true);
  });

  it("every OTHER registry Ability keeps the per-body scope — the widening is opt-in", () => {
    const shared: string[] = [];
    for (const id of registryCardIds()) {
      for (const ability of programFor(id)?.abilities ?? []) {
        if (ability.oncePerTurn === "sharedByName") shared.push(id);
      }
    }
    expect(shared.sort()).toEqual([
      "me01-074",
      "me01-104",
      "me01-164",
      "me01-182",
      "me02.5-105",
      "me02.5-142",
      "me02.5-171",
      "me02.5-250",
      "me02.5-288",
      "mep-004",
      "mep-025",
      "sv06.5-038",
      "sv06.5-039",
      "sv06.5-084",
      "sv06.5-085",
      "sv06.5-092",
      "sv06.5-093",
      "sv06.5-095",
      "sv07-118",
      "sv08.5-085",
      "sv08.5-163",
    ]);
  });

  it("`playableIf` is authored on exactly ELEVEN ids, and nowhere else ( D591: ELEVEN is the `sv` count; 27 live with the `me` keys; D602: 29 live; D603: 35 live; D610: 37 live; D611: 38 live; D619: 40 live; D628: 41 live)", () => {
    const gated: string[] = [];
    for (const id of registryCardIds()) {
      for (const ability of programFor(id)?.abilities ?? []) {
        if (ability.playableIf !== undefined) gated.push(id);
      }
    }
    expect(gated.sort()).toEqual([
      "30th-011",
      "30th-018",
      "30th-055",
      "30th-130",
      "30th-132",
      "30th-133",
      "me01-074",
      "me01-101",
      "me02-007",
      "me02-018",
      "me02-082",
      "me02-095",
      "me02-110",
      "me02.5-064",
      "me02.5-105",
      "me02.5-142",
      "me02.5-171",
      "me02.5-229",
      "me02.5-250",
      "me02.5-288",
      "me04-038",
      "me04-064",
      "me04-103",
      "me05-070",
      "me05-095",
      "mep-004",
      "mep-024",
      "mep-096",
      "mep-097",
      "mep-098",
      "sv06-015",
      "sv06.5-029",
      "sv06.5-038",
      "sv06.5-084",
      "sv06.5-092",
      "sv07-118",
      "sv08.5-085",
      "sv10-003",
      "sv10-206",
      "sv10-228",
      "svp-115",
    ]);
  });
});
