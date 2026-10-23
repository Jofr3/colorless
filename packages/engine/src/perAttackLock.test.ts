import { describe, expect, it } from "vitest";
import { hasRuleBox, pokemonSuffixOf, prizeValueOf } from "./cards";
import { lockedAttackIndexes } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  PER_ATTACK_LOCK_DECK,
  RADIANT_LOCK_DECK,
  activeUid,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

const SLASHING_STEEL = "During your next turn, this Pokémon can't use Slashing Steel.";
const DIRTY_HEADBUTT = "During your next turn, this Pokémon can't use Dirty Headbutt.";
const SLIP_N_ROLL = "During your next turn, this Pokémon can't use Slip 'n' Roll.";
const ACCELERATING_STAB = "During your next turn, this Pokémon can't use Accelerating Stab.";
const TORRENTIAL_CANNON = "During your next turn, this Pokémon can't use Torrential Cannon.";
const COMBUSTION_BLAST = "During your next turn, this Pokémon can't use Combustion Blast.";

const SLASHING_STEEL_INDEX = 1;
const PECK_INDEX = 0;
const COMBUSTION_BLAST_INDEX = 0;

const SEED = 13;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** The error code a declaration comes back with, or `null` when it applies. */
function refusal(state: GameState, seat: Seat, index: number): string | null {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? null : result.error.code;
}

function ready(
  barrer: string,
  energy: { id: string; count: number }[] = [
    { id: "fix-metal-energy", count: 2 },
    { id: "fix-energy", count: 1 },
  ],
): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: PER_ATTACK_LOCK_DECK, p2: PER_ATTACK_LOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", barrer);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  for (const { id, count } of energy) state = attachFromDeck(state, "p1", id, count);
  return state;
}

function barred(barrer: string, index: number, energy?: { id: string; count: number }[]) {
  const { state, events } = mustApply(ready(barrer, energy), {
    type: "attack",
    seat: "p1",
    index,
  });
  const row = find(events, "ATTACK_LOCKED");
  if (row === undefined) throw new Error(`${barrer} idx ${String(index)} barred nothing`);
  return { state, events, row };
}

/** …and one more turn on, which IS the window (the stamp is `+ 2`). */
function inWindow(state: GameState): GameState {
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function setLock(state: GameState, seat: Seat, lock: InPlayPokemon["lockedAttacks"]): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, lockedAttacks: lock } } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The datum: the catalog rows, the fixtures, and the deriver.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed datum — re-queried per printing, not inherited", () => {
  it("carries every barrer's NAME, attack INDEX and effect string verbatim", () => {
    const skarmory = FIXTURE_POOL["sv03-142"];
    expect(skarmory?.name).toBe("Skarmory");
    expect(skarmory?.hp).toBe(120);
    expect(skarmory?.stage).toBe("Basic");
    expect(skarmory?.types).toEqual(["Metal"]);
    expect(skarmory?.retreat).toBe(1);
    expect(skarmory?.weaknesses).toEqual([{ type: "Lightning", value: "×2" }]);
    expect(skarmory?.resistances).toEqual([{ type: "Fighting", value: "-30" }]);
    expect(skarmory?.abilities ?? null).toBeNull();
    expect(skarmory?.evolveFrom ?? null).toBeNull();
    expect(skarmory?.attacks?.[SLASHING_STEEL_INDEX]).toEqual({
      cost: ["Metal", "Metal", "Colorless"],
      name: "Slashing Steel",
      damage: 120,
      effect: SLASHING_STEEL,
    });
    expect(skarmory?.attacks?.[PECK_INDEX]).toEqual({
      cost: ["Colorless"],
      name: "Peck",
      damage: 20,
    });

    const munkidori = FIXTURE_POOL["sv06.5-037"];
    expect(munkidori?.name).toBe("Munkidori ex");
    expect(munkidori?.hp).toBe(210);
    expect(munkidori?.stage).toBe("Basic");
    expect(munkidori?.types).toEqual(["Darkness"]);
    expect(munkidori?.retreat).toBe(1);
    expect(munkidori?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(munkidori?.resistances ?? null).toBeNull();
    expect(munkidori?.abilities?.[0]?.name).toBe("Oh No You Don't");
    expect(munkidori?.attacks).toHaveLength(1);
    expect(munkidori?.attacks?.[0]?.name).toBe("Dirty Headbutt");
    expect(munkidori?.attacks?.[0]?.damage).toBe(190);
    expect(munkidori?.attacks?.[0]?.effect).toBe(DIRTY_HEADBUTT);

    const greedent = FIXTURE_POOL["sv03-179"];
    expect(greedent?.name).toBe("Greedent ex");
    expect(greedent?.hp).toBe(260);
    expect(greedent?.stage).toBe("Stage1");
    expect(greedent?.evolveFrom).toBe("Skwovet");
    expect(greedent?.types).toEqual(["Colorless"]);
    expect(greedent?.retreat).toBe(2);
    expect(greedent?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(greedent?.resistances ?? null).toBeNull();
    expect(greedent?.abilities ?? null).toBeNull();
    expect(greedent?.attacks?.[1]?.name).toBe("Slip 'n' Roll");
    expect(greedent?.attacks?.[1]?.damage).toBe(210);
    expect(greedent?.attacks?.[1]?.effect).toBe(SLIP_N_ROLL);

    const lucario = FIXTURE_POOL["sv01-114"];
    expect(lucario?.name).toBe("Lucario");
    expect(lucario?.hp).toBe(130);
    expect(lucario?.stage).toBe("Stage1");
    expect(lucario?.evolveFrom).toBe("Riolu");
    expect(lucario?.types).toEqual(["Fighting"]);
    expect(lucario?.retreat).toBe(2);
    expect(lucario?.weaknesses).toEqual([{ type: "Psychic", value: "×2" }]);
    expect(lucario?.resistances ?? null).toBeNull();
    expect(lucario?.abilities ?? null).toBeNull();
    expect(lucario?.attacks?.[1]?.name).toBe("Accelerating Stab");
    expect(lucario?.attacks?.[1]?.effect).toBe(ACCELERATING_STAB);
  });

  it("the INDEX is not constant across the family — the trap, on six printings", () => {
    const at = (id: string, name: string) =>
      FIXTURE_POOL[id]?.attacks?.findIndex((a) => a.name === name);
    expect(at("sv06.5-037", "Dirty Headbutt")).toBe(0);
    expect(at("swsh10.5-018", "Torrential Cannon")).toBe(0);
    expect(at("swsh10.5-011", "Combustion Blast")).toBe(0);
    expect(at("sv01-114", "Accelerating Stab")).toBe(1);
    expect(at("sv03-142", "Slashing Steel")).toBe(1);
    expect(at("sv03-179", "Slip 'n' Roll")).toBe(1);
  });

  it("derives ONE op with the printed NAME captured, on all six printings", () => {
    expect(deriveAttackEffect(SLASHING_STEEL)).toEqual([
      { op: "preventAttackUse", attack: "Slashing Steel" },
    ]);
    expect(deriveAttackEffect(DIRTY_HEADBUTT)).toEqual([
      { op: "preventAttackUse", attack: "Dirty Headbutt" },
    ]);
    expect(deriveAttackEffect(ACCELERATING_STAB)).toEqual([
      { op: "preventAttackUse", attack: "Accelerating Stab" },
    ]);
    expect(deriveAttackEffect(TORRENTIAL_CANNON)).toEqual([
      { op: "preventAttackUse", attack: "Torrential Cannon" },
    ]);
    expect(deriveAttackEffect(COMBUSTION_BLAST)).toEqual([
      { op: "preventAttackUse", attack: "Combustion Blast" },
    ]);
    expect(deriveAttackEffect(SLIP_N_ROLL)).toEqual([
      { op: "preventAttackUse", attack: "Slip 'n' Roll" },
    ]);
  });

  it("the anchor refuses the whole neighbourhood, and each refusal is a warrant", () => {
    for (const text of [
      "Once during your turn, you may search your deck for a card and put it into your hand. Then, shuffle your deck. You can't use more than 1 Quick Search Ability each turn.",
      // …a TRAINER play gate wearing the same words (Rare Candy sv01-191).
      "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn.",
      "During your next turn, this Pokémon can't use .",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    expect(deriveAttackEffect("During your next turn, this Pokémon can't attack.")).toEqual([
      { op: "preventAttack" },
    ]);
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "boostAttack", attack: "Echoed Voice", amount: 100 }]);
    expect(
      deriveAttackEffect(
        "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
      ),
    ).toEqual([{ op: "preventChosenAttack" }]);
  });
});

describe("the install — the address is resolved once, at the site that owns the noun", () => {
  it("stamps { turn: +2, attackIndex } and names the attack on the row", () => {
    const before = ready("sv03-142");
    expect(before.turn).toBe(2);
    const uid = activeUid(before, "p1");
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: SLASHING_STEEL_INDEX,
    });
    expect(find(events, "ATTACK_LOCKED")).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid,
      attack: "Slashing Steel",
    });
    expect(state.players.p1.active?.lockedAttacks).toEqual([
      {
        turn: 2 + 2,
        attackIndex: SLASHING_STEEL_INDEX,
      },
    ]);
    // …and NOT the whole-Pokémon lock, which is the field a widening would have
    // written and the one thing no board can tell apart from the record.
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
  });

  it("the ROW ORDER is the printed order — the damage, then the drawback", () => {
    const { events } = barred("sv03-142", SLASHING_STEEL_INDEX);
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeGreaterThan(-1);
    expect(order.indexOf("ATTACK_LOCKED")).toBeGreaterThan(order.indexOf("DAMAGE_DEALT"));
  });

  it("resolves the index PER CARD, never a constant", () => {
    const skarmory = barred("sv03-142", SLASHING_STEEL_INDEX).state;
    expect(skarmory.players.p1.active?.lockedAttacks.at(-1)?.attackIndex).toBe(1);
    const munkidori = barred("sv06.5-037", 0, [
      { id: "fix-dark-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]).state;
    expect(munkidori.players.p1.active?.lockedAttacks.at(-1)?.attackIndex).toBe(0);
    const greedent = barred("sv03-179", 1, [{ id: "fix-energy", count: 3 }]).state;
    expect(greedent.players.p1.active?.lockedAttacks.at(-1)?.attackIndex).toBe(1);
    const lucario = barred("sv01-114", 1, [
      { id: "fix-fighting-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ]).state;
    expect(lucario.players.p1.active?.lockedAttacks.at(-1)?.attackIndex).toBe(1);
  });

  it("carries the APOSTROPHE name end to end, from the sentence to the log row", () => {
    const { state, row } = barred("sv03-179", 1, [{ id: "fix-energy", count: 3 }]);
    expect(row.attack).toBe("Slip 'n' Roll");
    expect(render([row], state)).toEqual([
      { who: "p1", text: "Greedent ex can't use Slip 'n' Roll next turn" },
    ]);
  });

  it("matches a CURLY printed attack name — the re-ingest, driven on a card", () => {
    const { state, row } = barred("fix-curly-barrer", 1, [{ id: "fix-energy", count: 2 }]);
    expect(state.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 1 }]);
    expect(row.attack).toBe("Slip ’n’ Roll");
    const window = inWindow(state);
    expect(refusal(window, "p1", 1)).toBe("ATTACK_PREVENTED");
    expect(refusal(window, "p1", 0)).toBeNull();
  });

  it("installs NOTHING when the printed name matches no attack on the holder", () => {
    const before = ready("sv03-142");
    const { state } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: SLASHING_STEEL_INDEX,
    });
    expect(state.players.p1.active?.lockedAttacks).not.toEqual([]);
    // …now the same op with a name Skarmory does not print, fed through the same
    // deriver so the op is the real shape and only the noun is constructed.
    const bogus = deriveAttackEffect("During your next turn, this Pokémon can't use Hydro Pump.");
    expect(bogus).toEqual([{ op: "preventAttackUse", attack: "Hydro Pump" }]);
    const events2: GameEvent[] = [];
    const after = runOne(before, bogus ?? [], events2);
    expect(after.players.p1.active?.lockedAttacks ?? []).toEqual([]);
    expect(events2).toEqual([]);
  });

  it("never PARKS and consumes no rng", () => {
    const before = ready("sv03-142");
    const { state } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: SLASHING_STEEL_INDEX,
    });
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.rngState).toBe(before.rngState);
  });

  it("a re-install that says the SAME thing is silent, a different index is ADDED", () => {
    const state = setLock(ready("sv03-142"), "p1", [{ turn: 4, attackIndex: 1 }]);
    const same: GameEvent[] = [];
    const unchanged = runOne(state, [{ op: "preventAttackUse", attack: "Slashing Steel" }], same);
    expect(same).toEqual([]);
    expect(unchanged.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 1 }]);
    const moved: GameEvent[] = [];
    const rewritten = runOne(state, [{ op: "preventAttackUse", attack: "Peck" }], moved);
    expect(types(moved)).toEqual(["ATTACK_LOCKED"]);
    expect(rewritten.players.p1.active?.lockedAttacks).toEqual([
      { turn: 4, attackIndex: 1 },
      { turn: 4, attackIndex: 0 },
    ]);
    // …and BOTH are live in the window, which is what "added" means where
    // "replaced" would have quietly meant "one of them was thrown away".
    let window = must(applyAction(rewritten, { type: "endTurn", seat: "p1" }));
    window = must(applyAction(window, { type: "endTurn", seat: "p2" }));
    expect(window.turn).toBe(4);
    expect(lockedAttackIndexes(window, must0(window.players.p1.active))).toEqual([1, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The window: `+ 2`, driven across real turn boundaries.
// ─────────────────────────────────────────────────────────────────────────────

describe("the window is the HOLDER's own next turn — driven, not asserted", () => {
  it("is not live on the turn in between, is live on the holder's next, and expires", () => {
    const { state } = barred("sv03-142", SLASHING_STEEL_INDEX);
    // Turn 3 belongs to the OPPONENT: the stamp is 4, so the reader says nothing.
    expect(state.turn).toBe(3);
    expect(lockedAttackIndexes(state, must0(state.players.p1.active))).toEqual([]);
    // Turn 4 is the holder's own next turn — the window.
    const window = inWindow(state);
    expect(window.turn).toBe(4);
    expect(lockedAttackIndexes(window, must0(window.players.p1.active))).toEqual([
      SLASHING_STEEL_INDEX,
    ]);
    // …and it expires by arithmetic, with nothing having cleared it: the record is
    // STILL THERE two turns later and simply stops answering.
    let later = must(applyAction(window, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.turn).toBe(6);
    expect(later.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 1 }]);
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([]);
  });

  it("a `+ 1` stamp would be a drawback that never bites — the failure D143 named", () => {
    // Stated as a board rather than as arithmetic: turn 3 is the opponent's, so a
    // window stamped there is a window its holder could not have acted in anyway.
    const { state } = barred("sv03-142", SLASHING_STEEL_INDEX);
    const wrong = setLock(state, "p1", [{ turn: state.turn, attackIndex: 1 }]);
    const window = inWindow(wrong);
    expect(lockedAttackIndexes(window, must0(window.players.p1.active))).toEqual([]);
    expect(refusal(window, "p1", SLASHING_STEEL_INDEX)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE HEADLINE: the bar is on the ATTACK, and the card's other attack is legal.
// ─────────────────────────────────────────────────────────────────────────────

describe("the bar is on the ATTACK — the claim D143's field could not make", () => {
  it("refuses the named attack and ALLOWS the sibling, on one board", () => {
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    expect(refusal(window, "p1", SLASHING_STEEL_INDEX)).toBe("ATTACK_PREVENTED");
    const { events } = mustApply(window, { type: "attack", seat: "p1", index: PECK_INDEX });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("the refusal NAMES the barred attack, which the whole-Pokémon one cannot", () => {
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    const result = applyAction(window, {
      type: "attack",
      seat: "p1",
      index: SLASHING_STEEL_INDEX,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ATTACK_PREVENTED");
      expect(result.error.message).toContain("Slashing Steel");
    }
  });

  it("a BAD index still reports the index — the gate order, stated as a board", () => {
    // The bar is asked AFTER the index check on purpose: a bogus index on a barred
    // Pokémon must report the index, not the bar. Swap the two gates and this is
    // the only case that moves.
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    expect(refusal(window, "p1", 7)).toBe("BAD_ATTACK_INDEX");
  });

  it("is TOTAL over the family — every printing bars its own name and no other", () => {
    const cases: {
      id: string;
      index: number;
      other: number | null;
      energy: { id: string; count: number }[];
    }[] = [
      {
        id: "sv03-142",
        index: 1,
        other: 0,
        energy: [
          { id: "fix-metal-energy", count: 2 },
          { id: "fix-energy", count: 1 },
        ],
      },
      {
        id: "sv06.5-037",
        index: 0,
        other: null,
        energy: [
          { id: "fix-dark-energy", count: 2 },
          { id: "fix-energy", count: 1 },
        ],
      },
      { id: "sv03-179", index: 1, other: 0, energy: [{ id: "fix-energy", count: 3 }] },
      {
        id: "sv01-114",
        index: 1,
        other: 0,
        energy: [
          { id: "fix-fighting-energy", count: 1 },
          { id: "fix-energy", count: 2 },
        ],
      },
      {
        id: "swsh10.5-018",
        index: 0,
        other: null,
        energy: [
          { id: "fix-water-energy", count: 2 },
          { id: "fix-energy", count: 1 },
        ],
      },
    ];
    for (const { id, index, other, energy } of cases) {
      const window = inWindow(barred(id, index, energy).state);
      expect(lockedAttackIndexes(window, must0(window.players.p1.active)), id).toEqual([index]);
      expect(refusal(window, "p1", index), id).toBe("ATTACK_PREVENTED");
      if (other !== null) {
        // The sibling is legal — and it is asserted as APPLYING rather than as
        // "not ATTACK_PREVENTED", because an unpayable cost would satisfy the
        // weaker claim while hiding the same bug.
        expect(refusal(window, "p1", other), id).toBeNull();
      }
    }
  });

  it("leaves the sibling's own reader alone — Lucario's index-0 clause still reads", () => {
    const window = inWindow(
      barred("sv01-114", 1, [
        { id: "fix-fighting-energy", count: 1 },
        { id: "fix-energy", count: 2 },
      ]).state,
    );
    const { events } = mustApply(window, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Coexistence: the reachability argument for TWO fields, driven.
// ─────────────────────────────────────────────────────────────────────────────

describe("one body carries BOTH locks on ONE turn — why the record is not shared", () => {
  it("a self-barred Greedent ex locked WHOLE by Eiscue ex keeps both facts", () => {
    const state = barred("sv03-179", 1, [{ id: "fix-energy", count: 3 }]).state;
    expect(state.turn).toBe(3);
    let p2 = setActiveFromDeck(state, "p2", "sv03-042");
    p2 = attachFromDeck(p2, "p2", "fix-water-energy", 3);
    const { state: locked, events } = mustApply(p2, { type: "attack", seat: "p2", index: 0 });
    // The whole-Pokémon lock landed on P1's Greedent ex, and the per-attack record
    // it was already carrying is untouched beside it.
    expect(find(events, "ATTACK_LOCKED")?.seat).toBe("p1");
    expect(locked.players.p1.active?.attackLockedTurn).toBe(4);
    expect(locked.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 1 }]);
    expect(locked.turn).toBe(4);
    expect(refusal(locked, "p1", 0)).toBe("ATTACK_PREVENTED");
    expect(lockedAttackIndexes(locked, must0(locked.players.p1.active))).toEqual([1]);
  });

  it("…and the two rows read differently in the log, under the SAME seat", () => {
    const state = barred("sv03-179", 1, [{ id: "fix-energy", count: 3 }]);
    let p2 = setActiveFromDeck(state.state, "p2", "sv03-042");
    p2 = attachFromDeck(p2, "p2", "fix-water-energy", 3);
    const { state: locked, events } = mustApply(p2, { type: "attack", seat: "p2", index: 0 });
    expect(render([state.row], state.state)).toEqual([
      { who: "p1", text: "Greedent ex can't use Slip 'n' Roll next turn" },
    ]);
    const whole = find(events, "ATTACK_LOCKED");
    expect(whole).toBeDefined();
    expect(render(whole === undefined ? [] : [whole], locked)).toEqual([
      { who: "p1", text: "Greedent ex can't attack next turn" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — the three early clears, SWEPT rather than listed.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 sheds it — the three clears, and the sweep that keeps them together", () => {
  it("EVOLVING inside the window frees the barred attack — a played line", () => {
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    expect(window.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 1 }]);
    const held = handFromDeck(window, "p1", "fix-skarm-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-skarm-stage1"),
      target: { spot: "active" },
    });
    expect(evolved.players.p1.active?.lockedAttacks).toEqual([]);
    // …and the evolved body attacks the same turn, which is the printed line
    // rather than a leniency: §10 sheds the effects of ATTACKS, and this is one.
    const { events } = mustApply(evolved, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("RETREATING inside the window sheds it — the holder's own route", () => {
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    const bench = window.players.p1.bench;
    expect(bench.length).toBeGreaterThan(0);
    const { state: retreated } = mustApply(window, {
      type: "retreat",
      seat: "p1",
      // Skarmory's printed retreat is 1, so exactly one attached energy pays it.
      discardEnergy: must0(window.players.p1.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    // The barred body is on the Bench now, carrying nothing.
    const wasActive = retreated.players.p1.bench[0];
    expect(wasActive?.lockedAttacks ?? []).toEqual([]);
  });

  it("a FORCED switch sheds it too — the opponent's route into the same clear", () => {
    const state = handFromDeck(barred("sv03-142", SLASHING_STEEL_INDEX).state, "p2", "sv02-172", 1);
    const barredUid = activeUid(state, "p1");
    let gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    }).state;
    if (gusted.phase.kind === "effect:choose") {
      gusted = must(
        applyAction(gusted, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = gusted.players.p1.bench.find((p) => p.stack.includes(barredUid));
    expect(benched).toBeDefined();
    expect(benched?.lockedAttacks ?? []).toEqual([]);
  });

  it("the clear-set is the SAME set every durated field is on — swept, not listed", () => {
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    const held = handFromDeck(window, "p1", "fix-skarm-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-skarm-stage1"),
      target: { spot: "active" },
    });
    const body = must0(evolved.players.p1.active);
    expect({
      attackBlock: body.attackBlock,
      attackLockedTurn: body.attackLockedTurn,
      retreatLockedTurn: body.retreatLockedTurn,
      damageReduction: body.damageReduction,
      noWeaknessTurn: body.noWeaknessTurn,
      scheduledEffect: body.scheduledEffect,
      attackDamageDebuff: body.attackDamageDebuff,
      installedRecoil: body.installedRecoil,
      lockedAttacks: body.lockedAttacks,
      boostedAttack: body.boostedAttack,
      retreatBlocked: body.retreatBlocked,
    }).toEqual({
      attackBlock: null,
      attackLockedTurn: null,
      retreatLockedTurn: null,
      damageReduction: null,
      noWeaknessTurn: null,
      scheduledEffect: null,
      attackDamageDebuff: null,
      installedRecoil: null,
      lockedAttacks: [],
      boostedAttack: null,
      retreatBlocked: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The projections — the first durated field that gates an ACTION.
// ─────────────────────────────────────────────────────────────────────────────

describe("both payability projections agree with the §8 gate, per INDEX", () => {
  it("greys the barred row and OFFERS the sibling", () => {
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    const view = redactGame(window, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    const barredRow = view.attacks[SLASHING_STEEL_INDEX];
    const sibling = view.attacks[PECK_INDEX];
    expect(barredRow?.name).toBe("Slashing Steel");
    expect(barredRow?.playable).toBe(false);
    expect(sibling?.name).toBe("Peck");
    expect(sibling?.playable).toBe(true);
    // …and the projection AGREES with the gate on both rows, which is the property
    // that matters: neither offers a button the server refuses, and neither hides
    // one it would accept.
    expect(refusal(window, "p1", SLASHING_STEEL_INDEX)).toBe("ATTACK_PREVENTED");
    expect(refusal(window, "p1", PECK_INDEX)).toBeNull();
  });

  it("offers BOTH rows again once the window has passed", () => {
    // So the assertion above is about the BAR rather than about an unpayable cost.
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    let later = must(applyAction(window, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    const view = redactGame(later, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    for (const attack of view.attacks) expect(attack.playable, attack.name).toBe(true);
  });

  it("the OPPONENT's view is unchanged — the bar leaks nothing across the wire", () => {
    // `redactedAttacksOf` returns [] for anyone but the turn owner, so the record
    // reaches no projection of the other seat. Asserted because this is the first
    // durated field that reaches a projection AT ALL.
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    const view = redactGame(window, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toEqual([]);
  });
});

function readyRadiant(): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: RADIANT_LOCK_DECK, p2: RADIANT_LOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "swsh10.5-011");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = attachFromDeck(state, "p1", "fix-energy", 4);
  return state;
}

/** `readyRadiant`, then Combustion Blast declared — asserting the bar landed, so
    no case below can assert "nothing was refused" against nothing. */
function radiantBarred(): { state: GameState; events: GameEvent[]; row: GameEvent } {
  const { state, events } = mustApply(readyRadiant(), {
    type: "attack",
    seat: "p1",
    index: COMBUSTION_BLAST_INDEX,
  });
  const row = find(events, "ATTACK_LOCKED");
  if (row === undefined) throw new Error("Radiant Charizard barred nothing");
  return { state, events, row };
}

describe("the EIGHTH printing — Radiant Charizard swsh10.5-011, unread until the re-ingest", () => {
  it("carries the row verbatim — every field, including the two it does not have", () => {
    const charizard = FIXTURE_POOL["swsh10.5-011"];
    expect(charizard?.name).toBe("Radiant Charizard");
    expect(charizard?.hp).toBe(160);
    expect(charizard?.stage).toBe("Basic");
    expect(charizard?.types).toEqual(["Fire"]);
    expect(charizard?.retreat).toBe(3);
    expect(charizard?.weaknesses).toEqual([{ type: "Water", value: "×2" }]);
    expect(charizard?.resistances ?? null).toBeNull();
    expect(charizard?.evolveFrom ?? null).toBeNull();
    // ONE attack, at index 0 — the datum the install resolves the printed noun to.
    expect(charizard?.attacks).toHaveLength(1);
    expect(charizard?.attacks?.[COMBUSTION_BLAST_INDEX]).toEqual({
      cost: ["Fire", "Colorless", "Colorless", "Colorless", "Colorless"],
      name: "Combustion Blast",
      damage: 250,
      effect: COMBUSTION_BLAST,
    });
    expect(charizard?.abilities?.[0]?.name).toBe("Excited Heart");
    expect(charizard?.abilities?.[0]?.effect).toContain("cost Colorless less");
    expect(programFor("swsh10.5-011")).toEqual({
      passive: { attackCostDiscountPerOpponentPrize: 1 },
    });
    expect(programFor("swsh10.5-011")?.attack).toBeUndefined();
  });

  it("has a RULE BOX by NAME PREFIX and is worth ONE Prize — the family's only such body", () => {
    const charizard = FIXTURE_POOL["swsh10.5-011"];
    if (charizard === undefined) throw new Error("swsh10.5-011 is not in the pool");
    expect(hasRuleBox(charizard)).toBe(true);
    expect(pokemonSuffixOf(charizard)).toBeNull();
    expect(prizeValueOf(charizard)).toBe(1);
    // The three cells the rest of the family occupies, so the claim is a TABLE and
    // not one card: a suffix rule box is worth 2, and no rule box is worth 1.
    const cell = (id: string) => {
      const card = FIXTURE_POOL[id];
      if (card === undefined) throw new Error(`${id} is not in the pool`);
      return { ruleBox: hasRuleBox(card), prizes: prizeValueOf(card) };
    };
    expect(cell("sv06.5-037")).toEqual({ ruleBox: true, prizes: 2 }); // Munkidori ex
    expect(cell("sv03-179")).toEqual({ ruleBox: true, prizes: 2 }); // Greedent ex
    expect(cell("sv03-142")).toEqual({ ruleBox: false, prizes: 1 }); // Skarmory
    expect(cell("sv01-114")).toEqual({ ruleBox: false, prizes: 1 }); // Lucario
    expect(cell("swsh10.5-011")).toEqual({ ruleBox: true, prizes: 1 }); // the new cell
  });

  it("the family's SIX names are all fielded now — the census closes", () => {
    const printed = new Map<string, string[]>();
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const op = deriveAttackEffect(attack.effect ?? "");
        if (op?.[0]?.op !== "preventAttackUse") continue;
        const existing = printed.get(attack.name);
        if (existing === undefined) printed.set(attack.name, [id]);
        else existing.push(id);
      }
    }
    expect([...printed.keys()].sort()).toEqual([
      "Accelerating Stab",
      "Blaze Blitz",
      "Combustion Blast",
      "Dirty Headbutt",
      "Slashing Steel",
      "Slip 'n' Roll",
      "Slip ’n’ Roll",
      "Torrential Cannon",
    ]);
    expect(printed.get("Combustion Blast")).toEqual(["swsh10.5-011"]);
  });

  it("bars its own index 0 across a real turn boundary, and the §8 gate refuses it", () => {
    const before = readyRadiant();
    expect(before.turn).toBe(2);
    const uid = activeUid(before, "p1");
    const { state, events, row } = radiantBarred();
    expect(row).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid,
      attack: "Combustion Blast",
    });
    expect(state.players.p1.active?.lockedAttacks).toEqual([
      {
        turn: 2 + 2,
        attackIndex: COMBUSTION_BLAST_INDEX,
      },
    ]);
    // …and NOT the whole-Pokémon lock, which on a ONE-ATTACK card is the drift no
    // board can see. This is the assertion doing the work in this whole section.
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
    // The printed 250 landed and fix-titan's 340 survived it, so the window opens
    // on a live board rather than on a KO.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(250);
    const window = inWindow(state);
    expect(window.turn).toBe(4);
    expect(lockedAttackIndexes(window, must0(window.players.p1.active))).toEqual([
      COMBUSTION_BLAST_INDEX,
    ]);
    expect(refusal(window, "p1", COMBUSTION_BLAST_INDEX)).toBe("ATTACK_PREVENTED");
  });

  it("the window CLOSES — the same index is legal again one turn on", () => {
    // So the refusal above is about the BAR and not about a cost this board could
    // never pay. The energy is still attached; only the stamp has expired.
    let later = must(applyAction(inWindow(radiantBarred().state), { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([]);
    expect(refusal(later, "p1", COMBUSTION_BLAST_INDEX)).toBeNull();
  });

  it("the projection greys the ONLY row it renders — D143's picture, a different record", () => {
    const window = inWindow(radiantBarred().state);
    const view = redactGame(window, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(1);
    expect(view.attacks[COMBUSTION_BLAST_INDEX]?.name).toBe("Combustion Blast");
    expect(view.attacks[COMBUSTION_BLAST_INDEX]?.playable).toBe(false);
    expect(refusal(window, "p1", COMBUSTION_BLAST_INDEX)).toBe("ATTACK_PREVENTED");
    expect(window.players.p1.active?.attackLockedTurn).toBeNull();
    expect(window.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 0 }]);
  });

  it("the log row NAMES the attack — and here the bare wording would have been TRUE", () => {
    const { state, row } = radiantBarred();
    expect(render([row], state)).toEqual([
      { who: "p1", text: "Radiant Charizard can't use Combustion Blast next turn" },
    ]);
    const swapped: LogContext = {
      names: { p1: "Tide", p2: "Ember" },
      state,
      elapsed: "+00:14",
    };
    expect(
      logFromEvents([row], swapped).flatMap((entry) =>
        entry.kind === "turn"
          ? []
          : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
      ),
    ).toEqual([{ who: "p1", text: "Radiant Charizard can't use Combustion Blast next turn" }]);
  });

  it("the OPPONENT's view is unchanged — the bar leaks nothing across the wire", () => {
    const window = inWindow(radiantBarred().state);
    const view = redactGame(window, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers used above that need the engine's own entry points.
// ─────────────────────────────────────────────────────────────────────────────

/** Run a one-op program from P1's chair as an ATTACK's effect — the shape the
    CONSTRUCTED cases need (`preventBlock.test.ts`'s move). The op never parks, so
    the run is always `done` and the assertion says so rather than assuming it. */
function runOne(state: GameState, program: readonly EffectOp[], events: GameEvent[]): GameState {
  const result = runProgram(state, program, { seat: "p1", invokedBy: "attack" }, events);
  if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
  return result.state;
}

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}
