import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  COUNTERATTACK_DECK,
  FIXTURE_POOL,
  VENGEFUL_PUNCH_DECK,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
  findEvent,
} from "./testFixtures";

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30, no effect

const RECOIL_CLAUSE = "damage counters on the Attacking Pokémon";

/** Rocky Helmet's own contribution, read off the registry so a data change moves
    every expectation in this file at once. */
const HELMET = (programFor("sv01-193")?.passive?.damageAttacker?.amount ?? 0) as number;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Setup with P2 first, so P2 can field + equip its defender before handing the
    turn to P1. Returns the state mid-P2's-turn. */
function board(seed: number): GameState {
  return driveSetup(seed, { p1: COUNTERATTACK_DECK, p2: COUNTERATTACK_DECK }, { first: "p2" });
}

/** Attach a Tool from P2's deck onto P2's Active. */
function equip(state: GameState, toolId: string): GameState {
  const withCard = handFromDeck(state, "p2", toolId, 1);
  const uid = handUid(withCard, "p2", toolId);
  const done = mustApply(withCard, {
    type: "attachTool",
    seat: "p2",
    uid,
    target: { spot: "active" },
  }).state;
  expect(done.players.p2.active?.tools).toContain(uid);
  return done;
}

/** Hand the turn to P1 and field the plain-damage attacker with its {C}. */
function armAttacker(state: GameState): GameState {
  let next = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  next = setActiveFromDeck(next, "p1", "fix-attacker");
  return attachFromDeck(next, "p1", "fix-energy", 1);
}

/** P2 fields `defenderId` (Active), optionally wearing `toolId`; then P1 Bites it. */
function fight(
  seed: number,
  defenderId: string,
  toolId?: string,
): { state: GameState; events: GameEvent[]; before: GameState } {
  let state = setActiveFromDeck(board(seed), "p2", defenderId);
  if (toolId !== undefined) state = equip(state, toolId);
  state = armAttacker(state);
  deepFreeze(state);
  const { state: done, events } = mustApply(state, bite);
  return { state: done, events, before: state };
}

function koFight(
  seed: number,
  toolId: string,
  holderDamage = 100,
): { state: GameState; events: GameEvent[] } {
  let state = driveSetup(
    seed,
    { p1: VENGEFUL_PUNCH_DECK, p2: VENGEFUL_PUNCH_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-wall"); // 120 HP, no passive of its own
  state = attachToolFromDeck(state, "p2", "active", toolId);
  state = setDamage(state, "p2", holderDamage); // 100 → Bite's 30 makes 130 ≥ 120
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  deepFreeze(state);
  return mustApply(state, bite);
}

describe("the §9 recoil row — the MECHANISM label, whatever card granted it", () => {
  it("a TOOL's recoil (Rocky Helmet) is no longer called an Ability", () => {
    const { state: done, events } = fight(1, "fix-bigbody", "sv01-193");

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(findEvent(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: activeUid(done, "p1"),
      amount: HELMET,
      source: "counterattack",
    });
    expect(done.players.p1.active?.damage).toBe(HELMET);
  });

  it("and a real ABILITY's recoil (Counterattack Quills) gets the SAME label", () => {
    const quills = programFor("sv01-006")?.passive?.damageAttacker?.amount;
    const { state: done, events } = fight(2, "sv01-006");

    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: quills,
      source: "counterattack",
    });
    expect(done.players.p1.active?.damage).toBe(quills);
  });
});

describe("why no PROVENANCE label can be honest — one row, two provenances", () => {
  it("Stunfisk (Ability 50) wearing Rocky Helmet (Tool 20) is ONE row of 70", () => {
    const trap = programFor("sv03-112")?.passive?.damageAttacker?.amount ?? 0;
    expect(programFor("sv03-112")?.passive?.damageAttacker?.requiresTool).toBe(true);

    const { state: done, events } = fight(3, "sv03-112", "sv01-193");

    const placed = all(events, "COUNTERS_PLACED");
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({
      seat: "p1",
      amount: trap + HELMET,
      source: "counterattack",
    });
    // Read from the two authored amounts rather than written as 70, so the
    // arithmetic is asserted rather than the constant.
    expect(trap + HELMET).toBe(70);
    expect(done.players.p1.active?.damage).toBe(70);
  });

  it("and the read site is handed a bare NUMBER — no provenance survives the sum", () => {
    for (const id of ["sv01-005", "sv01-006", "sv03-112", "sv01-193"]) {
      const recoil = programFor(id)?.passive?.damageAttacker;
      expect(recoil, id).toBeDefined();
      expect(Object.keys(recoil ?? {}).sort()).not.toContain("source");
      for (const key of Object.keys(recoil ?? {})) {
        expect(["amount", "requiresTool"], `${id} carries ${key}`).toContain(key);
      }
    }
  });
});

describe("the guard, ASSERTED over the POOL rather than at one hand-picked site", () => {
  const producers = Object.entries(FIXTURE_POOL)
    .filter(([, card]) =>
      [card.effect ?? "", ...(card.abilities ?? []).map((a) => a.effect ?? "")].some((text) =>
        text.includes(RECOIL_CLAUSE),
      ),
    )
    .map(([id, card]) => ({ id, category: card.category, trainerType: card.trainerType }));

  it("discovers the §9 recoil family from the printed text, and it spans BOTH kinds", () => {
    expect(producers.map((p) => p.id).sort()).toEqual([
      "sv01-005", // Cacnea — Counterattack Quills (Ability)
      "sv01-006", // Cacturne — Counterattack Quills (Ability)
      "sv01-193", // Rocky Helmet (Pokémon TOOL) — on DAMAGE
      "sv03-112", // Stunfisk — Custom Trap (Ability, requiresTool)
      "sv03-197",
    ]);
    expect(new Set(producers.map((p) => p.category))).toEqual(new Set(["Pokemon", "Trainer"]));
    expect(producers.find((p) => p.id === "sv01-193")?.trainerType).toBe("Tool");
  });

  const onDamage = producers.filter((p) => programFor(p.id)?.passive?.damageAttacker !== undefined);
  const onKo = producers.filter((p) => programFor(p.id)?.passive?.damageAttackerOnKo !== undefined);

  it("every discovered producer is AUTHORED — text census = program census", () => {
    expect([...onDamage, ...onKo]).toHaveLength(producers.length);
    expect(onDamage.filter((p) => onKo.includes(p))).toEqual([]);
    expect(onDamage.length).toBeGreaterThan(1);
    expect(onKo.length).toBeGreaterThan(0);
  });

  it("and DRIVES every one of them — not one emits a row that says 'ability'", () => {
    let seed = 10;
    for (const producer of onDamage) {
      const own = programFor(producer.id)?.passive?.damageAttacker?.amount ?? 0;
      const { events } =
        producer.category === "Pokemon"
          ? fight(seed++, producer.id, "sv01-193")
          : fight(seed++, "fix-bigbody", producer.id);
      const placed = all(events, "COUNTERS_PLACED");
      expect(placed, producer.id).toHaveLength(1);
      expect(placed[0]?.source, `${producer.id} labelled its recoil`).toBe("counterattack");
      // The amount is this producer's own plus the Helmet's, except for the
      // Helmet itself (which is not doubled up).
      expect(placed[0]?.amount, producer.id).toBe(producer.id === "sv01-193" ? own : own + HELMET);
      expect(placed[0]?.seat, producer.id).toBe("p1");
    }
  });

  it("…and DRIVES the KO-conditioned half too, on the board ITS condition needs", () => {
    let seed = 40;
    for (const producer of onKo) {
      const own = programFor(producer.id)?.passive?.damageAttackerOnKo?.amount ?? 0;
      const { events } = koFight(seed++, producer.id);
      const placed = all(events, "COUNTERS_PLACED");
      expect(placed, producer.id).toHaveLength(1);
      expect(placed[0]?.source, `${producer.id} labelled its recoil`).toBe("counterattack");
      expect(placed[0]?.amount, producer.id).toBe(own);
      expect(placed[0]?.seat, producer.id).toBe("p1");
      // …and the KO really happened, so this is not passing vacuously on a board
      // where the condition was never met.
      expect(types(events), producer.id).toContain("KNOCKED_OUT");
    }
  });

  it("the KO half pays NOTHING on a hit its holder survives — the partition, driven", () => {
    let seed = 60;
    for (const producer of onKo) {
      const { events } = koFight(seed++, producer.id, 0); // an UNDAMAGED holder
      expect(types(events), producer.id).toContain("DAMAGE_DEALT"); // it WAS hit…
      expect(types(events), producer.id).not.toContain("KNOCKED_OUT"); // …and lived
      expect(all(events, "COUNTERS_PLACED"), producer.id).toEqual([]);
    }
  });
});

describe("the VOICE — `seat` owns the DAMAGED Pokémon, which here is the ATTACKER", () => {
  it("files the row under the attacker's seat and uid, though the CAUSER is the defender", () => {
    const { state: done, events } = fight(4, "fix-bigbody", "sv01-193");
    const placed = findEvent(events, "COUNTERS_PLACED");
    expect(placed?.seat).toBe("p1"); // the attacking player
    expect(placed?.uid).toBe(activeUid(done, "p1")); // …and their own Active
    expect(done.players.p2.active?.damage).toBe(30); // the holder took only the Bite
  });

  it("lands immediately behind the hit it reacts to, before any turn end", () => {
    const { events } = fight(5, "fix-bigbody", "sv01-193");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });
});

describe("the log — the row a player actually reads", () => {
  function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
    return logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );
  }

  it("renders a SYSTEM row that never says Ability — the Tool case", () => {
    const { state: done, events } = fight(6, "fix-bigbody", "sv01-193");
    const rows = render(events, done);

    const row = rows.find((r) => r.text.startsWith("Counterattack:"));
    expect(row).toBeDefined();
    expect(row?.who).toBe("system");
    expect(row?.text).toBe(`Counterattack: ${HELMET} damage to fix-attacker`);
    expect(row?.text).not.toContain("Ability");
    expect(rows.filter((r) => r.text.includes("damage to fix-attacker"))).toHaveLength(1);
  });

  it("renders the Ability + Tool SUM as ONE row, and cannot say which card did it", () => {
    const { state: done, events } = fight(7, "sv03-112", "sv01-193");
    const rows = render(events, done).filter((r) => r.text.startsWith("Counterattack:"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe("Counterattack: 70 damage to fix-attacker");
    // Neither card's name appears, and neither could: the number is their sum.
    expect(rows[0]?.text).not.toContain("Stunfisk");
    expect(rows[0]?.text).not.toContain("Rocky Helmet");
  });

  it("still renders a genuine ABILITY placement as an Ability row — both values reach the log", () => {
    const authored = programFor("sv03-012")?.triggered?.[0]?.program?.[0] as { source: string };
    expect(authored.source).toBe("ability");
    const { state: done } = fight(8, "fix-bigbody", "sv01-193");
    const rows = render(
      [
        {
          type: "COUNTERS_PLACED",
          seat: "p1",
          uid: activeUid(done, "p1") ?? "",
          amount: 10,
          source: "ability",
        },
      ],
      done,
    );
    expect(rows[0]).toEqual({ who: "system", text: "Ability: 10 damage to fix-attacker" });
  });

  it("does NOT read like the attacker's own self-recoil — the word 'Recoil' stays free", () => {
    const { state: done } = fight(9, "fix-bigbody", "sv01-193");
    const uid = activeUid(done, "p1") ?? "";
    const [counter] = render(
      [{ type: "COUNTERS_PLACED", seat: "p1", uid, amount: 20, source: "counterattack" }],
      done,
    );
    const [self] = render(
      [{ type: "COUNTERS_PLACED", seat: "p1", uid, amount: 20, source: "self" }],
      done,
    );
    expect(counter?.who).toBe("system");
    expect(self?.who).toBe("p1"); // the attacker's own voice
    expect(counter?.text).not.toBe(self?.text);
    expect(self?.text).toContain("to itself");
    expect(counter?.text).not.toContain("itself");
  });
});

describe("the family this label must still cover — three printings, none an Ability", () => {
  it("Vengeful Punch sv03-197 — the SECOND recoil TOOL, LANDED at D158, and it joins THIS label", () => {
    expect(programFor("sv03-197")?.passive).toEqual({ damageAttackerOnKo: { amount: 40 } });
    // …and it is a SIBLING field, not this one: the two consumers refuse each
    // other's condition, so nothing here changed shape.
    expect(programFor("sv03-197")?.passive?.damageAttacker).toBeUndefined();
  });

  it("Lycanroc ex sv02-117/-241 'Scary Fangs' — LANDED at D152, and it joins THIS label", () => {
    expect(programFor("sv02-117")).toBeUndefined();
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put 10 damage counters on the Attacking Pokémon.",
      ),
    ).toEqual([{ op: "installRecoil", amount: 100 }]);
  });

  it("the SCALED twin — LANDED at D456, and it joins THIS label too", () => {
    expect(programFor("sv02-143")).toBeUndefined();
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
      ),
    ).toEqual([{ op: "installRecoil", amount: "damageTaken" }]);
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
      ),
    ).toEqual([{ op: "installRecoil", amount: "damageTaken" }]);
  });
});
