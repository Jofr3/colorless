import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  ATTACK_DISCARD_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// M5 op-slice: the discardEnergy op's ATTACK ARMS. No new op — two extensions of
// the D41 hammer / D42 self-discard work, both DERIVED from the printed sentence,
// so the slice lands its cards with ZERO registry rows:
//
//   • the hammer family's ATTACK TWINS — "Discard an Energy from your opponent's
//     Active Pokémon", bare (Pincurchin, Gumshoos, Dragonite V) and behind a coin
//     flip (Dedenne, Maschiff, Tympole, Yveltal). The existing `opponentActive`
//     arm, now reached from an attack, so a decision about the OPPONENT's board
//     parks mid-attack for the first time (D42's attackEpilogue carries the tail);
//   • the EXACT-N self-discard — `count` widens from `"all"` to any number
//     ("Discard 2 Energy from this Pokémon" — Corviknight, Slither Wing;
//     "Discard 3" — Koraidon). The prompt's `scope` becomes
//     `{kind:"total",count}`, and the interchangeable-candidate collapse keeps
//     `count` representatives per class instead of one, so every way of splitting
//     the count across distinguishable Energy stays reachable while identical
//     copies beyond the count still never make it into a question.

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

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so attacking is legal (§4). */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ATTACK_DISCARD_DECK, p2: ATTACK_DISCARD_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

/** P1 fields `attackerId` (with `attacker` Energy attached) against P2's
    `defenderId` (with `defender` Energy attached — what an attack twin strips). */
function matchup(
  seed: number,
  attackerId: string,
  defenderId: string,
  attacker: readonly { id: string; count: number }[],
  defender: readonly { id: string; count: number }[] = [],
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", attackerId);
  state = setActiveFromDeck(state, "p2", defenderId);
  for (const { id, count } of attacker) state = attachFromDeck(state, "p1", id, count);
  for (const { id, count } of defender) state = attachFromDeck(state, "p2", id, count);
  return state;
}

/** The parked discardEnergy prompt, or a loud failure. */
function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}

describe("M5 op-slice — the discardEnergy attack arms", () => {
  // ── The deriver: the printed sentences, and the near-misses it must refuse ──

  it("derives the opponent-side twins, bare and coin-gated", () => {
    // Pincurchin (sv02-072) / Gumshoos (sv03-177) / Dragonite V (swsh10.5-049,
    // -076) — the same op Mawile's Ability runs, one filter wider: an attack
    // takes ANY Energy where Mawile takes a Special one.
    expect(deriveAttackEffect("Discard an Energy from your opponent's Active Pokémon.")).toEqual([
      { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
    ]);
    // Dedenne (sv01-094) / Maschiff (sv01-136) / Tympole (sv03-050) / Yveltal
    // (sv06.5-035) — the coin gate the deriver already had, over the new op.
    expect(
      deriveAttackEffect(
        "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.",
      ),
    ).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ]);
    // The catalog's straight apostrophe and the typographic one both parse, so a
    // re-ingest changing only punctuation cannot silently un-derive the family.
    expect(deriveAttackEffect("Discard an Energy from your opponent’s Active Pokémon.")).toEqual(
      [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
    );
  });

  it("derives the exact-N self-discard at every printed count", () => {
    // Corviknight (sv02-148) / Slither Wing (sv06.5-026), then Koraidon (sv01-124).
    expect(deriveAttackEffect("Discard 2 Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
    ]);
    expect(deriveAttackEffect("Discard 3 Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 3 },
    ]);
    // The article stays the one-Energy op (no `count` at all), so D42's shape is
    // untouched — the two spellings are not two ways to say the same thing here.
    expect(deriveAttackEffect("Discard an Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
  });

  it("refuses the sentences it still cannot express", () => {
    for (const text of [
      // Krookodile (sv01-117): a REPEAT count off a flip-until-tails loop. It ends
      // in the twin's exact words, so only the anchor keeps it off a single silent
      // discard — the loudest failure this slice could have.
      "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
      // Sandaconda (sv01-120): the count is fine, the rider after it is not.
      "Discard 2 Energy from this Pokémon. If you discarded any Energy in this way, your opponent shuffles their Active Pokémon and all attached cards into their deck.",
      // (The TYPED sentences this list used to hold — Arcanine ex, Kilowattrel,
      // the Pokémon GO wording — derive now, through the `providesEnergy` filter
      // that reads what an Energy PROVIDES on its host. See providesEnergy.test.ts.)
      // Not a printed card, and a silent no-op is the worst possible derivation.
      "Discard 0 Energy from this Pokémon.",
      // The opponent's BOARD (Crushing Hammer's wording) is the Trainer arm, which
      // no attack prints — it would need `opponentChosen`, not `opponentActive`.
      "Discard an Energy from 1 of your opponent's Pokémon.",
      // ANCHORS, pinned directly. Krookodile above does NOT pin them: it is
      // refused by the leading `^` AND by its lowercase mid-sentence "discard",
      // so either guard alone still refuses it. Each string below keeps the
      // pattern's own CAPITALISED first word, so it is the anchor and nothing
      // else that refuses it — drop a `^` or a `$` and every one of these derives
      // to a program that silently implements HALF a card, which is the whole
      // safety argument for a whole-sentence deriver.
      "This attack does 30 damage. Discard 2 Energy from this Pokémon.",
      "Discard 2 Energy from this Pokémon. Then, flip a coin.",
      "This attack does 20 damage to each of your opponent's Benched Pokémon. Discard an Energy from your opponent's Active Pokémon.",
      "Discard an Energy from your opponent's Active Pokémon. Then, flip a coin.",
      "This attack does 30 damage. Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.",
      "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon. Repeat.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  // ── The opponent-side twin on a board (Pincurchin, "Needle Crush") ──

  it("Pincurchin parks the ATTACKER on the DEFENDER's Energy, then the epilogue runs", () => {
    // Two distinguishable Energy on the defender makes WHICH a real question —
    // and it is the attacker who answers, about a board they do not own.
    const state = matchup(
      1,
      "sv02-072",
      "fix-bigbody",
      [{ id: "fix-lightning-energy", count: 3 }],
      [
        { id: "fix-energy", count: 1 },
        { id: "fix-special", count: 1 },
      ],
    );
    deepFreeze(state);
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p1"); // the ATTACKER decides, not the victim
    expect(parked.phase.resumeTail).toBe(true);
    const prompt = discardPrompt(parked);
    expect(prompt.note).toBe("Discard an Energy from your opponent's Active Pokémon.");
    expect(prompt.scope).toEqual({ kind: "total", count: 1 });
    // Every candidate sits on P2's Active — the arm is Active-only, so nothing
    // benched is ever offered.
    expect(prompt.discardable.map((d) => d.from)).toEqual([
      { seat: "p2", spot: { spot: "active" } },
      { seat: "p2", spot: { spot: "active" } },
    ]);
    expect(types(events)).not.toContain("TURN_ENDED");

    const pick = prompt.discardable[1]?.uid as string;
    const { state: done, events: resolved } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    // The card goes to its OWNER's pile (P2's), and the event names the victim
    // seat with the ACTOR who caused it — the two differ here, unlike a
    // self-discard.
    expect(activeEnergy(done, "p2")).toHaveLength(1);
    expect(done.players.p2.discard).toContain(pick);
    expect(done.players.p1.discard).not.toContain(pick);
    const discarded = find(resolved, "ENERGY_DISCARDED");
    expect(discarded?.seat).toBe("p2");
    expect(discarded?.actor).toBe("p1");
    // …and only then the §5.3 tail the epilogue was holding.
    expect(types(resolved)).toEqual([
      "ENERGY_DISCARDED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("a lone Energy on the defender is forced, and a bare defender is a no-op", () => {
    const forced = matchup(
      2,
      "sv02-072",
      "fix-bigbody",
      [{ id: "fix-lightning-energy", count: 3 }],
      [{ id: "fix-special", count: 1 }],
    );
    const { state: after, events } = mustApply(forced, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(activeEnergy(after, "p2")).toEqual([]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });

    // Nothing attached: the attack still happens (it was legally declared — an
    // attack never consults programPlayable), it just discards nothing.
    const bare = matchup(3, "sv02-072", "fix-bigbody", [{ id: "fix-lightning-energy", count: 3 }]);
    const { state: whiffed, events: bareEvents } = mustApply(bare, {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(find(bareEvents, "DAMAGE_DEALT")?.dealt).toBe(70);
    expect(types(bareEvents)).not.toContain("ENERGY_DISCARDED");
    expect(types(bareEvents)).toContain("TURN_ENDED");
    expect(whiffed.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("two identical Energy on the defender ask nothing — the collapse reaches the opponent too", () => {
    // The D42 collapse keys on (host, what a Basic PROVIDES), so two prints of
    // the same Basic type are one candidate wherever they sit.
    const state = matchup(
      4,
      "sv02-072",
      "fix-bigbody",
      [{ id: "fix-lightning-energy", count: 3 }],
      [
        { id: "fix-fighting-energy", count: 1 },
        { id: "fix-fighting-energy-alt", count: 1 },
      ],
    );
    const before = activeEnergy(state, "p2");
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(activeEnergy(after, "p2")).toEqual([before[1]]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("still strips a defender the same attack Knocked Out — the sweep runs after the answer", () => {
    // fix-victim has 30 HP, so Needle Crush's 70 is lethal. §8 resolves the whole
    // attack before the §8.1 Knock Out check, so the defender is still on the
    // board holding its Energy when the effect asks — the question is legal, if
    // academic (the rest of the stack follows it into the pile a moment later).
    const state = matchup(
      5,
      "sv02-072",
      "fix-victim",
      [{ id: "fix-lightning-energy", count: 3 }],
      [
        { id: "fix-energy", count: 1 },
        { id: "fix-special", count: 1 },
      ],
    );
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(parked.players.p2.active).not.toBeNull();

    const pick = discardPrompt(parked).discardable[0]?.uid as string;
    const { state: after, events: resolved } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    expect(types(resolved).slice(0, 2)).toEqual(["ENERGY_DISCARDED", "KNOCKED_OUT"]);
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  // ── The coin-gated twin (Tympole, "Screw Tail") ──

  it("Tympole discards on heads and nothing on tails — and a heads flip can still park", () => {
    // One Energy out there: heads takes it, tails leaves it. Seeds cover both.
    const faces = new Map<string, { discarded: number; energyLeft: number }>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = matchup(
        seed,
        "sv03-050",
        "fix-bigbody",
        [{ id: "fix-water-energy", count: 1 }],
        [{ id: "fix-special", count: 1 }],
      );
      const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
      const face = find(events, "ATTACK_EFFECT_COIN_FLIP")?.result as string;
      faces.set(face, {
        discarded: findAll(events, "ENERGY_DISCARDED").length,
        energyLeft: activeEnergy(after, "p2").length,
      });
    }
    expect(faces.get("heads")).toEqual({ discarded: 1, energyLeft: 0 });
    expect(faces.get("tails")).toEqual({ discarded: 0, energyLeft: 1 });

    // The gate splices its branch into the work queue, so an op INSIDE it parks
    // exactly like a top-level one: on heads, with a real choice, the attack
    // stops mid-flight and the epilogue waits behind it.
    let parkedSomewhere = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = matchup(
        seed,
        "sv03-050",
        "fix-bigbody",
        [{ id: "fix-water-energy", count: 1 }],
        [
          { id: "fix-energy", count: 1 },
          { id: "fix-special", count: 1 },
        ],
      );
      const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
      if (find(events, "ATTACK_EFFECT_COIN_FLIP")?.result !== "heads") continue;
      parkedSomewhere = true;
      expect(after.phase.kind).toBe("effect:choose");
      // D189 — the stage names the ATTACKER by uid (the ATTACK_DECLARED row's).
      expect(after.pending).toEqual([
        {
        kind: "attackEpilogue",
        seat: "p1",
        uid: find(events, "ATTACK_DECLARED")?.uid,
        // 🆕 D394 — the stage also names the ATTACK, off the same row, for the same
        // reason: `finishAttack` stamps `usedAttack` and cannot re-derive the name.
        attack: find(events, "ATTACK_DECLARED")?.attack,
      },
      ]);
    }
    expect(parkedSomewhere).toBe(true);
  });

  // ── The exact-N self-discard (Slither Wing 2, Koraidon 3) ──

  it("Slither Wing asks for exactly 2 — and both come off the SAME Pokémon in one event", () => {
    // Smashing Wing costs {F}{F}{C}: two Fighting + a colourless filler is three
    // distinguishable Energy, so choosing 2 of the 3 is a real question.
    const state = matchup(6, "sv06.5-026", "fix-bigbody", [
      { id: "fix-fighting-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    // ⚠️ INDEX 1 — Smashing Wing's PRINTED number, behind "Iron Smasher" (D173).
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const prompt = discardPrompt(parked);
    expect(prompt.note).toBe("Discard 2 Energy from this Pokémon.");
    expect(prompt.scope).toEqual({ kind: "total", count: 2 });
    // Two Fighting copies are interchangeable, but the pick wants up to 2 of a
    // class, so BOTH survive the collapse — otherwise "discard both Fighting"
    // would be unanswerable.
    expect(prompt.discardable).toHaveLength(3);
    expect(prompt.discardable.every((d) => d.from.seat === "p1")).toBe(true);

    const picks = [prompt.discardable[0]?.uid as string, prompt.discardable[2]?.uid as string];
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks },
    });
    // ONE event per affected Pokémon, so two cards off one host is one row.
    const discarded = findAll(events, "ENERGY_DISCARDED");
    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.uids).toEqual(picks);
    expect(discarded[0]?.from).toEqual({ spot: "active" });
    expect(activeEnergy(done, "p1")).toHaveLength(1);
    expect(done.players.p1.discard).toEqual(picks);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("Koraidon's discard 3 keeps 3 representatives per class, and forces when they run out", () => {
    // Rampaging Fang costs {F}{F}{F}{C}. Three interchangeable Fighting + one
    // filler is a REAL choice (all three Fighting, or two plus the filler), so
    // the collapse must keep three of them.
    const choice = matchup(7, "sv01-124", "fix-bigbody", [
      { id: "fix-fighting-energy", count: 3 },
      { id: "fix-energy", count: 1 },
    ]);
    // ⚠️ INDEX 1 — Rampaging Fang's PRINTED number, behind "Claw Slash" (D173).
    const { state: parked } = mustApply(choice, { type: "attack", seat: "p1", index: 1 });
    const prompt = discardPrompt(parked);
    expect(prompt.note).toBe("Discard 3 Energy from this Pokémon.");
    expect(prompt.scope).toEqual({ kind: "total", count: 3 });
    expect(prompt.discardable).toHaveLength(4);

    // FOUR interchangeable Fighting is not a question at all: the fourth copy is
    // beyond anything the pick could want, so the collapse drops it and the
    // remaining three are exactly the count.
    const forced = matchup(8, "sv01-124", "fix-bigbody", [
      { id: "fix-fighting-energy", count: 4 },
    ]);
    const before = activeEnergy(forced, "p1");
    const { state: after, events } = mustApply(forced, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(find(events, "ENERGY_DISCARDED")?.uids).toEqual(before.slice(0, 3));
    expect(activeEnergy(after, "p1")).toEqual([before[3]]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("a board holding fewer than N gives up all of it and asks nothing", () => {
    // "Do as much as you can": the fixture discards 4 for a [C] cost, so it can
    // attack holding 2. No printed card reaches this, which is exactly why the
    // rule needs a fixture rather than a real one.
    const state = matchup(9, "fix-discard4", "fix-bigbody", [
      { id: "fix-fighting-energy", count: 1 },
      { id: "fix-special", count: 1 },
    ]);
    const before = activeEnergy(state, "p1");
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(find(events, "ENERGY_DISCARDED")?.uids).toEqual(before);
    expect(activeEnergy(after, "p1")).toEqual([]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  // ── The wire rules a multi-pick answer has to satisfy ──

  it("rejects a pick of the wrong size, a repeat, and an Energy never offered", () => {
    const state = matchup(10, "sv06.5-026", "fix-bigbody", [
      { id: "fix-fighting-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    // ⚠️ INDEX 1 — Smashing Wing's PRINTED number (D173).
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const offered = discardPrompt(parked).discardable.map((d) => d.uid);
    const [first, second, third] = offered as [string, string, string];
    deepFreeze(parked);

    const reject = (uids: unknown[]) =>
      expectErr(
        parked,
        { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids } as never },
        "BAD_EFFECT_CHOICE",
      );
    // MANDATORY and EXACT: too few is not a partial discard, and an empty pick is
    // not a decline. Too many is not "do more".
    reject([]);
    reject([first]);
    reject([first, second, third]);
    // The same card cannot pay for two of the two.
    reject([first, first]);
    // Nothing outside the offer — including Energy on the OPPONENT's board, which
    // this arm never offered.
    reject([first, "no-such-uid"]);
    reject([first, activeEnergy(parked, "p2")[0] ?? "none"]);

    // Two off the same Pokémon IS the answer here — the one-per-Pokémon rule
    // belongs to the "each" scope (Giacomo) and must not leak into this one.
    expect(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: [first, second] },
      }).ok,
    ).toBe(true);
  });
});
