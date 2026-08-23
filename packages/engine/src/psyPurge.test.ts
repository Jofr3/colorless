import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  PSY_PURGE_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.47.0 → 0.48.0 — Mewtwo VSTAR swsh10.5-031 "Psy Purge": the CAPPED Hail Blade
// shape. "Discard up to 3 Psychic Energy from your Pokémon. This attack does 90
// damage for each card you discarded in this way."
//
// The same three-part machinery Chien-Pao ex built (a `from: "yours"` whole-board
// discard, `count: "any"` declinable, `recordAs: "discarded"` feeding
// `damageDefender`), plus ONE new field:
//   • `cap: 3` — bounds the `count: "any"` up-to BELOW the whole board, the
//     printed "up to N". The park's `upTo` max becomes min(cap, offered), and the
//     wire validator rejects a pick above it.
// And the first authored attack on a MULTI-attack card: index-1 "Star Raid" must
// fall through to unsimulated, which is WHY the `programFor(id)?.attack` seam is
// keyed by attack INDEX (D97) — a card authors only the attacks it needs.

/** The VERBATIM swsh10.5-031 print (tcgdex-confirmed). 🆕🆕 **D402 RE-POINTED THIS
    COMMENT'S CLAIM, EXACTLY AS IT DID HAIL BLADE'S** (D178: kept, not deleted). It
    read *"Like Hail Blade's, the deriver refuses this sentence"* — true from D97 to
    D401 and false now, on purpose. *"The registry program is authoritative"* is
    unchanged: `attack.ts` reads the row first, so this card's board did not move.
    ⚠️ AND IT IS THE SPELLED-OUT `Psychic` THAT MAKES THIS SENTENCE WORTH ASSERTING
    SEPARATELY FROM HAIL BLADE'S BRACE-CODED `{W}` — the anchor's notation
    alternations are built from `ENERGY_TYPE_BY_NAME` and `ENERGY_TYPE_BY_CODE`, and
    these two printings are the only place both are pinned against a hand-authored
    program that was written years before either alternation existed. */
const PSY_PURGE_TEXT =
  "Discard up to 3 Psychic Energy from your Pokémon. This attack does 90 damage for each card you discarded in this way.";

const attack = { type: "attack", seat: "p1", index: 0 } as const;
const starRaid = { type: "attack", seat: "p1", index: 1 } as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1 goes second, so
    their first turn carries no §4 attack restriction. */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: PSY_PURGE_DECK, p2: PSY_PURGE_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields Mewtwo VSTAR with `energy` Basic {P} attached — two pay Psy Purge's
    {P}{C}, and ALL of them are discard fuel (a cost is not spent) — against a P2
    Active of `defender` (default: another Mewtwo VSTAR, whose 280 HP survives the
    capped max of 90 × 3 = 270). setActiveFromDeck displaces each setup Active to
    the bench, so a KO always has a Pokémon to promote into. */
function psyPurge(seed: number, opts: { energy: number; defender?: string }): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "swsh10.5-031");
  state = attachFromDeck(state, "p1", "fix-psychic-energy", opts.energy);
  return setActiveFromDeck(state, "p2", opts.defender ?? "swsh10.5-031");
}

/** The parked discardEnergy prompt, or a loud failure. */
function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}

function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

describe("Mewtwo VSTAR 'Psy Purge' — the REGISTRY-authored attack, keyed by index", () => {
  it("is authored at INDEX 0 with cap 3, and the deriver now AGREES with it", () => {
    const AUTHORED = [
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Psychic" },
        count: "any",
        cap: 3,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 90, count: "discarded" },
    ];
    expect(programFor("swsh10.5-031")?.attack?.[0]).toEqual(AUTHORED);
    // The index-keying, from the other side: "Star Raid" (index 1) is NOT authored,
    // so it cannot inherit Psy Purge's program.
    expect(programFor("swsh10.5-031")?.attack?.[1]).toBeUndefined();
    // 🆕🆕 **D402 — WAS `toBeNull()` FROM D97 TO D401.** The CAP is what this rung
    // now pins on both producers at once: the derived program must carry `cap: 3`
    // and not a bare `count: "any"`, so an anchor that captured the "up to N" and
    // then dropped it — an uncapped Psy Purge offering the whole board — reddens
    // here as well as in D402's own suite.
    expect(deriveAttackEffect(PSY_PURGE_TEXT)).toEqual(AUTHORED);
  });

  it("every printed swsh10.5 id carries it — the reprints are the same card", () => {
    for (const id of ["swsh10.5-031", "swsh10.5-079", "swsh10.5-086"]) {
      expect(programFor(id)?.attack?.[0]).toBeDefined();
    }
  });
});

describe("Psy Purge — the CAP: 'up to 3', not the whole board", () => {
  it("caps the upTo park at 3 even with more {P} attached", () => {
    // Five {P} on the Active, but "up to 3": the ceiling is the CAP, not the offer.
    // Every {P} still shows as a candidate row — you choose WHICH three — but the
    // scope forbids a fourth, and the printed caption says so.
    const state = psyPurge(1, { energy: 5 });
    const offered = activeEnergy(state, "p1");
    deepFreeze(state);

    const { state: parked, events } = mustApply(state, attack);

    expect(parked.phase.kind).toBe("effect:choose");
    const prompt = discardPrompt(parked);
    expect(prompt.scope).toEqual({ kind: "upTo", max: 3 }); // CAPPED — not 5
    expect(prompt.note).toBe("Discard up to 3 Psychic Energy from your Pokémon.");
    expect(prompt.discardable.map((d) => d.uid)).toEqual(offered); // all five are candidates
    expect(prompt.discardable).toHaveLength(5);
    // Nothing dealt yet: the printed "90×" base is suppressed behind the choice.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("TURN_ENDED");
  });

  it("rejects a pick ABOVE the cap — 'discard at most 3 Energy'", () => {
    // The cap is a wire rule, not just a caption: four picks off a five-{P} board
    // is a bad choice, the same as any over-count.
    const { state: parked } = mustApply(psyPurge(2, { energy: 5 }), attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);

    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks.slice(0, 4) },
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
      expect(rejected.error.message).toBe("discard at most 3 Energy");
    }
  });
});

describe("Psy Purge — 90 damage for each card discarded in this way", () => {
  it("discards 3 (the cap) and deals 90 × 3 = 270 to the DEFENDER", () => {
    const state = psyPurge(3, { energy: 5 });
    deepFreeze(state);
    const { state: parked } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid).slice(0, 3);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks },
    });

    // A SELF discard: victim and actor the same seat (contrast the hammer family).
    const discarded = find(events, "ENERGY_DISCARDED");
    expect(discarded).toMatchObject({ seat: "p1", actor: "p1", uids: picks });
    for (const uid of picks) expect(done.players.p1.discard).toContain(uid);
    expect(activeEnergy(done, "p1")).toHaveLength(2); // 5 attached − 3 discarded

    // …then the damage the count feeds: 90 × 3, through snipeActive.
    const damage = find(events, "DAMAGE_DEALT");
    expect(damage).toMatchObject({ seat: "p2", base: 270, dealt: 270, damage: 270 });
    expect(damage?.weakness).toBeNull(); // a VSTAR is neutral to {P} (weak to {D})
    expect(done.players.p2.active?.damage).toBe(270); // 280 HP — survives, no KO
    expect(types(events)).toEqual([
      "ENERGY_DISCARDED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("discarding ONE deals 90 — the count scales, not the board", () => {
    const state = psyPurge(4, { energy: 4 });
    const { state: parked } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [picks[0] as string] },
    });

    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(done.players.p2.active?.damage).toBe(90);
    expect(activeEnergy(done, "p1")).toHaveLength(3); // the other three stay attached
  });

  it("NEVER flags ATTACK_EFFECT_SKIPPED — the '90×' modifier IS simulated", () => {
    const state = psyPurge(5, { energy: 2 });
    const { state: parked, events: declared } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks },
    });
    expect(types(declared)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("Psy Purge — the decline, and the suppressed printed base", () => {
  it("declining (an empty pick) discards nothing and deals ZERO", () => {
    // "up to 3" includes 0: still a real decline, so a declined Psy Purge does
    // nothing at all — 90 × 0, the printed "90×" base never landing on its own.
    const state = psyPurge(6, { energy: 2 });
    const before = activeEnergy(state, "p1");
    const { state: parked, events: declared } = mustApply(state, attack);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [] },
    });

    expect(types(declared)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(activeEnergy(done, "p1")).toEqual(before); // every {P} still attached
    expect(done.players.p1.discard).toEqual([]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

describe("Psy Purge — the multi-attack card: index 1 is a DIFFERENT attack", () => {
  it("Star Raid (index 1) does NOT inherit the program — it stays unsimulated", () => {
    // The whole reason the seam is index-keyed (D97). If it were bound to the card
    // id alone, declaring Star Raid would park on Psy Purge's discard. Instead
    // index 1 finds no authored program, the deriver refuses its VSTAR-Power text,
    // and it is loudly flagged — no discard prompt, no damage.
    const state = psyPurge(7, { energy: 2 });
    const { state: done, events } = mustApply(state, starRaid);

    expect(done.phase.kind).not.toBe("effect:choose"); // Psy Purge's park did NOT bind
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    const skipped = find(events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.attack).toBe("Star Raid");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

describe("Psy Purge — genuine attack damage, not flat counters (§8.5)", () => {
  it("DOUBLES off the defender's Psychic Weakness — 90 × 1 × 2 = 180", () => {
    // Routing damageDefender through snipeActive is what makes Weakness apply:
    // Mewtwo is a {P} attacker, so a ×2 Psychic body takes double. A flat
    // put-counters model would have dealt 90 here.
    const state = psyPurge(8, { energy: 2, defender: "fix-psychic-weak" });
    const { state: parked } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [picks[0] as string] },
    });

    const damage = find(events, "DAMAGE_DEALT");
    expect(damage).toMatchObject({ seat: "p2", base: 90, dealt: 180 });
    expect(damage?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(done.players.p2.active?.damage).toBe(180); // 200 HP — survives, no KO
  });

  it("the KO it causes owes a VSTAR's 2 Prizes (D93)", () => {
    // Mewtwo VSTAR vs Mewtwo VSTAR: 280 HP pre-damaged to 20, so 90 × 3 = 270 is
    // lethal. "VSTAR" is a 2-Prize rule box (§8.1) — the first VSTAR the engine's
    // authored pool KOs, and a witness that D93's prizeValueOf reads the name.
    let state = psyPurge(9, { energy: 5, defender: "swsh10.5-031" });
    state = setDamage(state, "p2", 20);
    const koed = state.players.p2.active?.stack.at(-1) ?? "";
    const { state: parked } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid).slice(0, 3);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks },
    });

    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(270);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: koed });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 2 });
  });
});
