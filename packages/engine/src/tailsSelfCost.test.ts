import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  TAILS_SELF_COST_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
  findEvent,
  mustDerive,
} from "./testFixtures";

const DISCARD_TEXT = "Flip a coin. If tails, discard all Energy from this Pokémon.";
const RECOIL_TEXT = "Flip a coin. If tails, this Pokémon also does 60 damage to itself.";
const BARE_DISCARD = "Discard all Energy from this Pokémon.";
const BARE_RECOIL = "This Pokémon also does 60 damage to itself.";

const TAILS_SEEDS = [
  1, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 21, 24, 25, 26, 27, 29, 31, 32, 33, 36, 37, 39, 40,
] as const;
/** …and the complement — the face on which NOTHING is paid, which on these two
    sentences is the half a board delta cannot distinguish from a bug. */
const HEADS_SEEDS = [2, 3, 6, 7, 16, 18, 20, 22, 23, 28, 30, 34, 35, 38] as const;

const DISCARDERS = [
  { id: "sv02-063", index: 1, damage: 220, attack: "Dynamic Bolt", typed: "fix-lightning-energy" },
  { id: "sv03-054", index: 1, damage: 170, attack: "Frost Purge", typed: "fix-water-energy" },
] as const;
const RECOILER = { id: "sv03-183", index: 1, damage: 160, attack: "High-Impact Kick" } as const;

function armed(
  seed: number,
  installer: string,
  opts: { defender?: string; surplus?: number } = {},
): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: TAILS_SELF_COST_DECK, p2: TAILS_SELF_COST_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p2", opts.defender ?? "fix-titan");
  state = setActiveFromDeck(state, "p1", installer);
  if (state.players.p1.bench.length === 0) throw new Error("armed() left P1 with no bench");
  if (state.turn !== 2) throw new Error(`armed() expected turn 2, got ${String(state.turn)}`);
  const surplus = opts.surplus ?? 0;
  if (installer === "sv02-063") {
    // {L}{L}{C} — a MIXED pile, so "all" is a claim about the anyEnergy filter.
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 2 + surplus);
    return attachFromDeck(state, "p1", "fix-energy", 1);
  }
  if (installer === "sv03-054") {
    state = attachFromDeck(state, "p1", "fix-water-energy", 2 + surplus);
    return attachFromDeck(state, "p1", "fix-energy", 1);
  }
  // sv03-183 Oinkologne — {C}{C}{C}, one line, no typed symbol at all.
  return attachFromDeck(state, "p1", "fix-energy", 3 + surplus);
}

/** The face this declaration's ONE coin came up. Throws when there was no flip —
    a gate that stopped flipping would otherwise read as a permanent heads. */
function faceOf(events: GameEvent[]): "heads" | "tails" {
  const flip = findEvent(events, "ATTACK_EFFECT_COIN_FLIP");
  if (flip === undefined) throw new Error("no ATTACK_EFFECT_COIN_FLIP row");
  return flip.result;
}

/** The engine's rejection code for an attack, or `"ok"`. */
function refusal(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? "ok" : result.error.code;
}

/** Hand the turn back to P1 — the turn after the one that paid the cost. */
function nextOwnTurn(state: GameState): GameState {
  const next = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (next.turn !== 4) throw new Error(`expected the holder's turn 4, got ${String(next.turn)}`);
  return next;
}

function lines(events: GameEvent[], state: GameState): string[] {
  return rendered(events, state).map(({ text }) => text);
}

function rendered(
  events: GameEvent[],
  state: GameState,
): { who: "p1" | "p2" | "system"; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:07" };
  const out: { who: "p1" | "p2" | "system"; text: string }[] = [];
  for (const entry of logFromEvents(events, ctx)) {
    if (entry.kind === "turn") out.push({ who: "system", text: "" });
    else out.push({ who: entry.who, text: entry.segments.map((s) => s.text).join("") });
  }
  return out;
}

describe("the tails-gated self-costs — derived, not authored", () => {
  it("derives both sentences to a coinFlipGate carrying `onTails`", () => {
    expect(deriveAttackEffect(DISCARD_TEXT)).toEqual([
      {
        op: "coinFlipGate",
        onTails: true,
        then: [
          { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
        ],
      },
    ]);
    expect(deriveAttackEffect(RECOIL_TEXT)).toEqual([
      {
        op: "coinFlipGate",
        onTails: true,
        then: [{ op: "damageSelf", amount: 60 }],
      },
    ]);
    for (const text of [DISCARD_TEXT, RECOIL_TEXT]) {
      const op = mustDerive(deriveAttackEffect, text)[0] as object;
      expect(Object.keys(op).sort(), text).toEqual(["onTails", "op", "then"]);
    }
  });

  it("wraps each BARE program byte for byte — one action, printed two ways", () => {
    for (const [gatedText, bareText] of [
      [DISCARD_TEXT, BARE_DISCARD],
      [RECOIL_TEXT, BARE_RECOIL],
    ] as const) {
      const gated = mustDerive(deriveAttackEffect, gatedText);
      expect(gated, gatedText).toHaveLength(1);
      expect(gated[0], gatedText).toMatchObject({ then: deriveAttackEffect(bareText) });
      // …and the two anchors are NOT the same reading. A build where either
      // claimed the other's string would return the inner op UNWRAPPED (or wrap a
      // sentence with no coin in it), which is what this pair catches.
      expect(deriveAttackEffect(gatedText), gatedText).not.toEqual(deriveAttackEffect(bareText));
    }
    // Spelled out, because these are the ops the gates must wrap and nothing else:
    expect(deriveAttackEffect(BARE_DISCARD)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ]);
    expect(deriveAttackEffect(BARE_RECOIL)).toEqual([{ op: "damageSelf", amount: 60 }]);
  });

  it("CAPTURES the recoil amount rather than hardcoding the printed 60", () => {
    expect(
      deriveAttackEffect("Flip a coin. If tails, this Pokémon also does 10 damage to itself."),
    ).toEqual([
      {
        op: "coinFlipGate",
        onTails: true,
        then: [{ op: "damageSelf", amount: 10 }],
      },
    ]);
    // A printed 0 is not a real card and would derive to a silent no-op — the
    // bare arm's guard, carried through the gate rather than lost behind it.
    expect(
      deriveAttackEffect("Flip a coin. If tails, this Pokémon also does 0 damage to itself."),
    ).toBeNull();
  });

  it("is anchored end to end, on both sentences", () => {
    for (const text of [DISCARD_TEXT, RECOIL_TEXT]) {
      for (const variant of [
        `Then, ${text}`,
        `${text} Draw a card.`,
        text.slice(0, -1),
        text.toLowerCase(),
        // The two sentences joined without the printed space.
        text.replace(". If", ".If"),
        text.replace("If tails", "If heads"),
      ]) {
        expect(deriveAttackEffect(variant), variant).toBeNull();
      }
      // Outer whitespace SURVIVES by design (the deriver trims), which states
      // which drift is tolerated and which is not.
      expect(deriveAttackEffect(`\t  ${text}\n`), text).toEqual(deriveAttackEffect(text));
    }
  });

  it("is mutually exclusive with its own BARE anchor, in BOTH directions", () => {
    expect(deriveAttackEffect(BARE_DISCARD)).not.toEqual(deriveAttackEffect(DISCARD_TEXT));
    expect(deriveAttackEffect(BARE_RECOIL)).not.toEqual(deriveAttackEffect(RECOIL_TEXT));
    // The bare readings are UNWRAPPED — a single op, not a gate.
    for (const bare of [BARE_DISCARD, BARE_RECOIL]) {
      const ops = mustDerive(deriveAttackEffect, bare);
      expect(ops, bare).toHaveLength(1);
      expect(ops[0]?.op, bare).not.toBe("coinFlipGate");
    }
    // …and the gated readings are gates, with the field set.
    for (const gated of [DISCARD_TEXT, RECOIL_TEXT]) {
      const ops = mustDerive(deriveAttackEffect, gated);
      expect(ops[0]?.op, gated).toBe("coinFlipGate");
    }
  });

  it("keeps the CONSEQUENT censuses' refusals LOUD — the four compound discards", () => {
    for (const text of [
      // Weavile sv06.5-014 "Hail Claw" — the discard plus a Paralyze.
      "Discard all Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    const moveAll = deriveAttackEffect(
      "Move all Energy from this Pokémon to 1 of your Benched Pokémon.",
    );
    expect(moveAll).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: "all", route: "selfToBench" },
    ]);
    expect(moveAll?.some((op) => op.op === "discardEnergy")).toBe(false);
    const moveSpread = deriveAttackEffect(
      "Move all Energy from this Pokémon to your Benched Pokémon in any way you like.",
    );
    expect(moveSpread).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: "all",
        route: "selfToBench",
        anyDest: true,
      },
    ]);
    expect(moveSpread?.some((op) => op.op === "discardEnergy")).toBe(false);
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 110,
        count: 3,
        source: "attack",
        deals: true,
      },
    ]);
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "reduceDamage", amount: 100 },
    ]);
    for (const amount of [10, 30, 90]) {
      expect(
        deriveAttackEffect(`This Pokémon also does ${String(amount)} damage to itself.`),
      ).toEqual([{ op: "damageSelf", amount }]);
    }
  });

  it("costs zero registry rows — all three printings simulate off their printed text", () => {
    for (const { id } of [...DISCARDERS, RECOILER]) expect(programFor(id), id).toBeUndefined();
  });

  it("keeps the fixtures' printed text verbatim — and the family's ONE index", () => {
    expect(FIXTURE_POOL["sv02-063"]?.attacks?.[1]).toEqual({
      cost: ["Lightning", "Lightning", "Colorless"],
      name: "Dynamic Bolt",
      damage: 220,
      effect: DISCARD_TEXT,
    });
    expect(FIXTURE_POOL["sv03-054"]?.attacks?.[1]).toEqual({
      cost: ["Water", "Water", "Colorless"],
      name: "Frost Purge",
      damage: 170,
      effect: DISCARD_TEXT,
    });
    expect(FIXTURE_POOL["sv03-183"]?.attacks?.[1]).toEqual({
      cost: ["Colorless", "Colorless", "Colorless"],
      name: "High-Impact Kick",
      damage: 160,
      effect: RECOIL_TEXT,
    });
    // Each card's index-0 attack is its control, and Oinkologne's is the sharpest
    // of the three: it carries effect text read by a DIFFERENT arm of the SAME
    // deriver, so the two indices of one card must produce two different programs.
    expect(FIXTURE_POOL["sv02-063"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv03-054"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(deriveAttackEffect(FIXTURE_POOL["sv03-183"]?.attacks?.[0]?.effect ?? "")).toEqual([
      { op: "applyStatus", status: "confused", target: "defender" },
    ]);
    for (const { id, index, damage } of [...DISCARDERS, RECOILER]) {
      expect(FIXTURE_POOL[id]?.attacks?.[index]?.damage, id).toBe(damage);
    }
    for (const text of [DISCARD_TEXT, RECOIL_TEXT]) {
      expect(text, text).not.toContain("'");
      expect(text, text).not.toContain("’");
    }
  });
});

describe("the tails-gated self-costs — the seed table, pinned", () => {
  it("lands the face the table claims, on all THREE installers, for every seed", () => {
    for (const id of [...DISCARDERS.map((d) => d.id), RECOILER.id]) {
      for (const seed of TAILS_SEEDS) {
        expect(
          faceOf(mustApply(armed(seed, id), { type: "attack", seat: "p1", index: 1 }).events),
          `${id}/${String(seed)}`,
        ).toBe("tails");
      }
      for (const seed of HEADS_SEEDS) {
        expect(
          faceOf(mustApply(armed(seed, id), { type: "attack", seat: "p1", index: 1 }).events),
          `${id}/${String(seed)}`,
        ).toBe("heads");
      }
    }
    expect([...TAILS_SEEDS, ...HEADS_SEEDS].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, i) => i + 1),
    );
  });

  it("takes the coin on BOTH faces — `rngState` advances either way", () => {
    for (const id of [...DISCARDERS.map((d) => d.id), RECOILER.id]) {
      for (const seed of [TAILS_SEEDS[0], HEADS_SEEDS[0]]) {
        const before = armed(seed, id);
        const { state: done } = mustApply(before, { type: "attack", seat: "p1", index: 1 });
        expect(done.rngState, `${id}/${String(seed)}`).not.toBe(before.rngState);
      }
    }
    // …and each card's index-0 control takes NO coin at all on the same deck,
    // which is what makes "the flip belongs to the gate" a claim rather than a
    // coincidence of this deck's shuffle.
    for (const id of [...DISCARDERS.map((d) => d.id), RECOILER.id]) {
      const bare = armed(TAILS_SEEDS[0], id);
      const { state: done, events } = mustApply(bare, { type: "attack", seat: "p1", index: 0 });
      expect(done.rngState, id).toBe(bare.rngState);
      expect(types(events), id).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    }
  });
});

describe("the DISCARD — `Flip a coin. If tails, discard all Energy from this Pokémon.`", () => {
  it("TAILS strips EVERY attached Energy — mixed types, and beyond the printed cost", () => {
    for (const [i, { id, index, damage }] of DISCARDERS.entries()) {
      // FOUR attached against a three-symbol cost: "all" is only a claim when
      // there is a surplus to leave behind, and only a claim about `anyEnergy`
      // when the pile is MIXED (two typed + one Colorless + one more typed).
      const state = armed(TAILS_SEEDS[i] as number, id, { surplus: 1 });
      const attacker = activeUid(state, "p1");
      expect(state.players.p1.active?.energy).toHaveLength(4);
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });

      expect(faceOf(events), id).toBe("tails");
      expect(done.players.p1.active?.energy, id).toEqual([]);
      const discarded = findEvent(events, "ENERGY_DISCARDED");
      expect(discarded?.uids, id).toHaveLength(4);
      expect(discarded, id).toMatchObject({ seat: "p1", actor: "p1", host: attacker });
      // All four cards really reached the discard pile, not just the attachment.
      for (const uid of discarded?.uids ?? []) expect(done.players.p1.discard, id).toContain(uid);
      // THE PRINTED DAMAGE LANDS ANYWAY — the coin gates the drawback and nothing
      // else, which is exactly why the defender's side of the board cannot tell
      // the two faces apart.
      expect(findEvent(events, "DAMAGE_DEALT")?.dealt, id).toBe(damage);
      expect(types(events), id).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("HEADS strips NOTHING — the same declaration, the same damage, no row", () => {
    for (const [i, { id, index, damage }] of DISCARDERS.entries()) {
      const state = armed(HEADS_SEEDS[i] as number, id, { surplus: 1 });
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(faceOf(events), id).toBe("heads");
      expect(types(events), id).not.toContain("ENERGY_DISCARDED");
      expect(done.players.p1.active?.energy, id).toHaveLength(4);
      expect(findEvent(events, "DAMAGE_DEALT")?.dealt, id).toBe(damage);
      expect(types(events), id).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("lands the rows in §8 printed order — damage, then the coin, then the discard", () => {
    const { events } = mustApply(armed(TAILS_SEEDS[2] as number, "sv02-063"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(types(events).slice(0, 4)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "ENERGY_DISCARDED",
    ]);
  });

  it("PAYS THE COST EVEN WHEN THE MAIN HIT DEALT ZERO — the §11 prevention board", () => {
    const state = armed(TAILS_SEEDS[3] as number, "sv02-063", { defender: "sv02-097" });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt?.prevented).toBe(true);
    expect(dealt?.dealt).toBe(0);
    // Mimikyu is 70 HP and the printed 220 would have swept it off the board, so
    // the prevention is visible rather than asserted.
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(faceOf(events)).toBe("tails");
    expect(findEvent(events, "ENERGY_DISCARDED")?.uids).toHaveLength(3);
    expect(done.players.p1.active?.energy).toEqual([]);
  });

  it("leaves the attacker unable to pay ANY attack on its next turn", () => {
    const paid = mustApply(armed(TAILS_SEEDS[4] as number, "sv02-063"), {
      type: "attack",
      seat: "p1",
      index: 1,
    }).state;
    expect(paid.players.p1.active?.energy).toEqual([]);
    const own = nextOwnTurn(paid);
    expect(refusal(own, "p1", 1)).toBe("ATTACK_COST_UNMET");
    expect(refusal(own, "p1", 0)).toBe("ATTACK_COST_UNMET");
    const view = redactGame(own, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    for (const attack of view.attacks) {
      expect(attack.playable, `attack ${String(attack.index)} offered with no Energy`).toBe(false);
    }
    // The HEADS board on the SAME turn offers both — so the assertion above is
    // about the discard and not about a §4 ban or a stale projection.
    const kept = nextOwnTurn(
      mustApply(armed(HEADS_SEEDS[2] as number, "sv02-063"), {
        type: "attack",
        seat: "p1",
        index: 1,
      }).state,
    );
    expect(refusal(kept, "p1", 0)).toBe("ok");
    const free = redactGame(kept, "p1").phase;
    if (free.kind !== "turn:action") throw new Error(`expected turn:action, got ${free.kind}`);
    expect(free.attacks.every((a) => a.playable)).toBe(true);
  });

  it("does not inherit down the attack index — Pika Punch flips nothing", () => {
    // "Pika Punch" carries no effect text at all, so the declaration takes no
    // coin and strips nothing. The control that proves a program does not leak
    // across indices on a card where one attack has one.
    const state = armed(TAILS_SEEDS[5] as number, "sv02-063", { surplus: 1 });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(done.players.p1.active?.energy).toHaveLength(4);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("reads correctly in the LOG — the coin row, then the cost row, in the payer's voice", () => {
    const { state: done, events } = mustApply(armed(TAILS_SEEDS[0], "sv02-063"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const text = lines(events, done);
    expect(text).toContain("Pikachu ex used Dynamic Bolt");
    expect(text).toContain("flipped tails for the effect");
    expect(
      text.some((l) => l.startsWith("discarded ") && l.includes("from Ember's Pikachu ex")),
    ).toBe(true);
    const at = (needle: string) => text.findIndex((line) => line.includes(needle));
    expect(at("used Dynamic Bolt")).toBeLessThan(at("flipped tails"));
    expect(at("flipped tails")).toBeLessThan(at("discarded "));
    const heads = mustApply(armed(HEADS_SEEDS[0], "sv02-063"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const headsText = lines(heads.events, heads.state);
    expect(headsText).toContain("flipped heads for the effect");
    expect(headsText.some((l) => l.startsWith("discarded "))).toBe(false);
  });
});

describe("the RECOIL — `Flip a coin. If tails, this Pokémon also does 60 damage to itself.`", () => {
  it("TAILS places 60 on the ATTACKER as COUNTERS_PLACED source 'self', after the main hit", () => {
    const state = armed(TAILS_SEEDS[0], RECOILER.id);
    const attacker = activeUid(state, "p1");
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });

    expect(faceOf(events)).toBe("tails");
    expect(findEvent(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: attacker,
      amount: 60,
      source: "self",
    });
    expect(done.players.p1.active?.damage).toBe(60);
    // THE PRINTED "ALSO", read as an ORDER: the main hit lands first (§8.5), the
    // coin is taken at the tail, the recoil follows it. 120 HP against a 60
    // recoil means a FRESH body survives — the KO case below arms it on purpose.
    expect(types(events).slice(0, 4)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "COUNTERS_PLACED",
    ]);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(RECOILER.damage);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("HEADS places NOTHING — the same declaration, the same 160, an untouched body", () => {
    // The tombstone for this sentence. A board delta on the DEFENDER cannot tell
    // the faces apart; the attacker's own damage is the entire witness.
    const { state: done, events } = mustApply(armed(HEADS_SEEDS[0], RECOILER.id), {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });
    expect(faceOf(events)).toBe("heads");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(done.players.p1.active?.damage).toBe(0);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(RECOILER.damage);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("is FLAT — the defender's ×2 doubles the main hit and leaves the recoil at 60", () => {
    const neutral = mustApply(armed(TAILS_SEEDS[6] as number, RECOILER.id), {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });
    expect(findEvent(neutral.events, "DAMAGE_DEALT")?.dealt).toBe(160);
    expect(findEvent(neutral.events, "COUNTERS_PLACED")?.amount).toBe(60);
    const doubled = mustApply(
      armed(TAILS_SEEDS[6] as number, RECOILER.id, { defender: "fix-colorless-weak-big" }),
      { type: "attack", seat: "p1", index: RECOILER.index },
    );
    // fix-colorless-weak-big is ×2 Colorless against a Colorless attacker: 320.
    expect(findEvent(doubled.events, "DAMAGE_DEALT")?.dealt).toBe(320);
    expect(findEvent(doubled.events, "COUNTERS_PLACED")?.amount).toBe(60);
  });

  it("SELF-KNOCKS-OUT a primed body, prizes it to the DEFENDER, and does not end the turn early", () => {
    const state = setDamage(armed(TAILS_SEEDS[7] as number, RECOILER.id), "p1", 60);
    const attacker = activeUid(state, "p1");
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });

    expect(faceOf(events)).toBe("tails");
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p1", uid: attacker });
    expect(after.players.p1.discard).toContain(attacker);
    // Oinkologne carries no rule box, so it is worth exactly ONE Prize — and the
    // turn does NOT end here: the KO interrupts with its own queue behind it.
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(after.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
    expect(types(events)).not.toContain("TURN_ENDED");
    // The defender never took a lethal hit — fix-titan carries the 160 — so this
    // is a PURE self-KO, the shape a single-seat sweep would have dropped.
    expect(after.players.p2.active?.damage).toBe(160);
    // Drive it out: p2 takes its prize, p1 force-promotes its lone bench body,
    // and only THEN does the turn pass.
    const next = must(applyAction(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    expect(next.players.p2.prizes).toHaveLength(5);
    expect(next.players.p1.active).not.toBeNull();
    expect(next.players.p1.active?.stack).not.toContain(attacker);
    expect(next.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("HEADS on the SAME primed board survives — the coin is the whole difference", () => {
    // The other half of the KO tombstone, and the one that matters most in play:
    // a build ignoring the field would sweep this body off the board on a face
    // that earned nothing.
    const state = setDamage(armed(HEADS_SEEDS[1] as number, RECOILER.id), "p1", 60);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });
    expect(faceOf(events)).toBe("heads");
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(after.players.p1.active?.damage).toBe(60);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("does not inherit down the attack index — Confounding Cologne is a DIFFERENT arm", () => {
    const { state: done, events } = mustApply(armed(TAILS_SEEDS[8] as number, RECOILER.id), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(done.players.p1.active?.damage).toBe(0);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(done.players.p2.active?.conditions.rotation).toBe("confused");
  });

  it("reads correctly in the LOG — the recoil is the ATTACKER's own voice", () => {
    const state = setDamage(armed(TAILS_SEEDS[9] as number, RECOILER.id), "p1", 60);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RECOILER.index,
    });
    const text = lines(events, done);
    expect(text).toContain("Oinkologne used High-Impact Kick");
    expect(text).toContain("flipped tails for the effect");
    expect(text).toContain("Oinkologne did 60 damage to itself");
    expect(text).toContain("Oinkologne was Knocked Out");
    const at = (needle: string) => text.findIndex((line) => line.includes(needle));
    expect(at("flipped tails")).toBeLessThan(at("did 60 damage to itself"));
    expect(at("did 60 damage to itself")).toBeLessThan(at("was Knocked Out"));
    const rows = rendered(events, done);
    const whoSaid = (needle: string) => rows.find((r) => r.text.includes(needle))?.who;
    for (const needle of ["used High-Impact Kick", "flipped tails", "did 60 damage to itself"]) {
      expect(whoSaid(needle), needle).toBe("p1");
    }
    expect(whoSaid("prize")).toBe("p2");
  });
});

describe("the tails-gated self-costs — the whiff, and purity", () => {
  it("discards SILENTLY on an empty attachment set — not loud, not skipped", () => {
    const state = armed(HEADS_SEEDS[3] as number, "sv02-063");
    const active = state.players.p1.active;
    if (active === null) throw new Error("no active");
    const stripped: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: { ...active, energy: [] } } },
    };
    const events: GameEvent[] = [];
    const bare = mustDerive(deriveAttackEffect, BARE_DISCARD);
    const out = runProgram(
      stripped,
      bare,
      { seat: "p1", sourceUid: activeUid(stripped, "p1") },
      events,
    );
    expect("state" in out).toBe(true);
    expect(events).toEqual([]);
    // …and the same op through the GATE spends the coin and still says nothing,
    // which is the combination a reader has to see once.
    const gatedEvents: GameEvent[] = [];
    const gated = mustDerive(deriveAttackEffect, DISCARD_TEXT);
    runProgram(stripped, gated, { seat: "p1", sourceUid: activeUid(stripped, "p1") }, gatedEvents);
    expect(types(gatedEvents)).toEqual(["ATTACK_EFFECT_COIN_FLIP"]);
  });

  it("never mutates the state it was given (purity), on either sentence", () => {
    for (const id of ["sv02-063", RECOILER.id]) {
      const state = deepFreeze(armed(TAILS_SEEDS[10] as number, id));
      expect(() => applyAction(state, { type: "attack", seat: "p1", index: 1 })).not.toThrow();
    }
  });
});

describe("the tails-gated self-costs — the family, CLOSED", () => {
  it("reads all THREE bare tails-gated sentences and refuses the other FIVE", () => {
    for (const text of [
      "Flip a coin. If tails, during your next turn, this Pokémon can't attack.",
      DISCARD_TEXT,
      RECOIL_TEXT,
    ]) {
      const ops = deriveAttackEffect(text) as EffectOp[] | null;
      expect(ops, text).not.toBeNull();
      expect(ops?.[0], text).toMatchObject({ op: "coinFlipGate", onTails: true });
    }
    for (const text of [
      "Flip a coin. If tails, this attack does nothing.",
      "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.",
      "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.",
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck. If tails, discard a card from your hand.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("pins the shape at 8 printings across 3 sentences, and this slice's 3 by id", () => {
    const SHAPE = [
      {
        sentence: "can't attack",
        ids: ["sv01-157", "sv01-158", "sv01-234", "sv02-130", "sv02-244"],
      },
      { sentence: "discard all Energy", ids: ["sv02-063", "sv03-054"] },
      { sentence: "60 damage to itself", ids: ["sv03-183"] },
    ] as const;
    expect(SHAPE).toHaveLength(3);
    expect(SHAPE.flatMap((s) => s.ids)).toHaveLength(8);
    for (const { id, index } of [...DISCARDERS, RECOILER]) {
      expect(FIXTURE_POOL[id]?.attacks?.[index]?.effect, id).toBe(
        id === RECOILER.id ? RECOIL_TEXT : DISCARD_TEXT,
      );
      expect(index, id).toBe(1);
    }
    expect(FIXTURE_POOL["sv03-183"]?.name).toBe(FIXTURE_POOL["sv01-157"]?.name);
    expect(FIXTURE_POOL["sv03-183"]?.hp).toBe(FIXTURE_POOL["sv01-157"]?.hp);
    const names = (id: string) => (FIXTURE_POOL[id]?.attacks ?? []).map((a) => a.name);
    expect(names("sv03-183")).toEqual(["Confounding Cologne", "High-Impact Kick"]);
    expect(names("sv01-157")).toEqual(["Ram", "Leg Stomp"]);
  });
});
