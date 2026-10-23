import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  PRE_DAMAGE_FAMILY_DECK,
  attachFromDeck,
  attachToolFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const LOUD_SENTENCE = "Heal 100 damage from 1 of your Benched Ancient Pokémon.";

/** One seed for the whole suite, `preDamageFamily.test.ts`'s reason verbatim: nothing
    here flips a coin and every Active, Tool and Energy is placed by surgery. */
const SEED = 11;

/** `fix-preseam`'s indices — the same body the family suite drives. */
const IDX = { purge: 0, pry: 1, shed: 2, lock: 3, plain: 4, loud: 5 } as const;

const CHESTPLATE = "sv01-192"; // Tool: −30 after W/R on an {F} holder
const BAND = "sv01-197"; // Tool: the ATTACKER's own +10, before W/R
const MIST = "fix-mist-energy"; // Special Energy: §11 — "prevent all effects of attacks"
const THERAPEUTIC = "sv02-193"; // Special Energy: §12 — the holder can't be Paralyzed
const BASIC = "fix-energy"; // Basic Energy: the card-class control

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

/** `preDamageFamily.test.ts`'s board, verbatim: `fix-preseam` Active for `seat`,
    `fix-seamwall` opposite, two Colorless on the attacker, the turn handed to `seat`. */
function board(seat: Seat = "p1"): GameState {
  const decks = { p1: PRE_DAMAGE_FAMILY_DECK, p2: PRE_DAMAGE_FAMILY_DECK };
  let state = driveSetup(SEED, decks, { first: other(seat) });
  state = setActiveFromDeck(state, seat, "fix-preseam");
  state = setActiveFromDeck(state, other(seat), "fix-seamwall");
  state = attachFromDeck(state, seat, BASIC, 2);
  return mustApply(state, { type: "endTurn", seat: other(seat) }).state;
}

function tooled(seat: Seat = "p1"): GameState {
  return attachToolFromDeck(board(seat), other(seat), "active", CHESTPLATE);
}
function shielded(seat: Seat = "p1"): GameState {
  return attachFromDeck(tooled(seat), other(seat), MIST, 1);
}

function swing(
  state: GameState,
  index: number,
  seat: Seat = "p1",
): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat, index });
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((event) => event.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function count(events: GameEvent[], type: GameEvent["type"]): number {
  return events.filter((event) => event.type === type).length;
}

/** What §8.5 said it dealt to the defending Active. */
function dealt(events: GameEvent[]): number | undefined {
  return find(events, "DAMAGE_DEALT")?.dealt;
}

describe("§1 — every §11 printing names the OPPONENT as the attack's source", () => {
  const SHIELD = /effects of attacks/;
  const shieldSentences: { id: string; where: string; text: string }[] = [];
  for (const [id, card] of Object.entries(FIXTURE_POOL)) {
    const carriers: [string, string | null | undefined][] = [
      ["effect", card.effect],
      ...(card.abilities ?? []).map((ability, i): [string, string | null | undefined] => [
        `abilities[${i}]`,
        ability.effect,
      ]),
      ...(card.attacks ?? []).map((attack, i): [string, string | null | undefined] => [
        `attacks[${i}]`,
        attack.effect,
      ]),
    ];
    for (const [where, text] of carriers) {
      if (typeof text === "string" && SHIELD.test(text)) shieldSentences.push({ id, where, text });
    }
  }

  const SOURCE = /(?:used by|from|by) your opponent's Pokémon/;
  const CLOCK = /your opponent's next turn/;

  it("the sweep is NON-EMPTY and both disjuncts have witnesses", () => {
    expect(shieldSentences.length).toBeGreaterThanOrEqual(8);
    expect(shieldSentences.filter(({ text }) => SOURCE.test(text)).length).toBeGreaterThanOrEqual(
      6,
    );
    expect(shieldSentences.filter(({ text }) => CLOCK.test(text)).length).toBeGreaterThanOrEqual(2);
    expect(
      shieldSentences.filter(({ text }) => CLOCK.test(text) && !SOURCE.test(text)).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("EVERY ONE of them is confined to the opponent — the FALSIFIER for the rule", () => {
    for (const { id, where, text } of shieldSentences) {
      expect(SOURCE.test(text) || CLOCK.test(text), `${id} ${where}`).toBe(true);
    }
  });

  it("the CLOCK-only printings are exactly the INSTALLED ones, in the ATTACK column", () => {
    for (const { id, where, text } of shieldSentences) {
      if (where.startsWith("attacks")) expect(CLOCK.test(text), `${id} ${where}`).toBe(true);
      else expect(SOURCE.test(text), `${id} ${where}`).toBe(true);
    }
  });

  it("ZERO NEW PRINTINGS — the reader surface and all four family sentences stand still", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    for (const sentence of [
      "Before doing damage, discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon.",
      "Before doing damage, discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing.",
      "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.",
      "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon. If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.",
    ]) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
  });

  it("the demonstrator carries Mist Energy's printed bytes, source clause included", () => {
    expect(FIXTURE_POOL[MIST]?.effect).toContain(
      "Prevent all effects of attacks used by your opponent's Pokémon done to the Pokémon this card is attached to.",
    );
    expect(FIXTURE_POOL[MIST]?.effect).toContain("Damage is not an effect.");
  });
});

describe("§2 — the shielded body keeps its Tool, and the identical board loses it", () => {
  it("ROW 73 — THE DEFECT. The Tool STAYS, and the unshielded twin loses it", () => {
    const refused = swing(shielded(), IDX.pry);
    expect(refused.state.players.p2.active?.tools).toHaveLength(1);
    expect(refused.state.players.p2.discard).toEqual([]);
    expect(find(refused.events, "TOOLS_DISCARDED")).toBeUndefined();
    expect(find(refused.events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");

    const admitted = swing(tooled(), IDX.pry);
    expect(admitted.state.players.p2.active?.tools).toEqual([]);
    expect(find(admitted.events, "TOOLS_DISCARDED")?.uids).toHaveLength(1);
    expect(find(admitted.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
  });

  it("THE NUMBER MOVES WITH IT: 70 refused, 100 admitted, on the same pair", () => {
    // The Chestplate's −30 is what makes the refusal observable as arithmetic and not
    // only as a card in a zone — a refusal that left the board right and the damage
    // wrong would pass every assertion above. 100 − 30 = 70 when the Tool survives.
    expect(dealt(swing(shielded(), IDX.pry).events)).toBe(70);
    expect(dealt(swing(tooled(), IDX.pry).events)).toBe(100);
  });

  it("*(Damage is not an effect.)* — the printed parenthetical, on this seam", () => {
    // The shield refuses the STRIP and lets the hit through in full. A build that
    // routed the refusal into §8.5 instead would hand the holder total immunity, which
    // is the one mis-read the printed reminder exists to stop.
    const refused = swing(shielded(), IDX.pry);
    expect(dealt(refused.events)).toBe(70);
    expect(refused.state.players.p2.active?.damage).toBe(70);
    // …and the attack still resolved: the turn ended and the attacker is spent.
    expect(find(refused.events, "ATTACK_FAILED")).toBeUndefined();
  });

  it("ROW 71 — BOTH ZONES are refused together, including the shield's own card", () => {
    let state = shielded();
    state = attachFromDeck(state, "p2", BASIC, 1);
    const refused = swing(state, IDX.purge);
    expect(refused.state.players.p2.active?.tools).toHaveLength(1);
    expect(refused.state.players.p2.active?.energy).toHaveLength(2); // Mist + Basic
    expect(find(refused.events, "TOOLS_DISCARDED")).toBeUndefined();
    expect(find(refused.events, "ENERGY_DISCARDED")).toBeUndefined();
    expect(count(refused.events, "ATTACK_EFFECT_PREVENTED")).toBe(1);

    let unshielded = tooled();
    unshielded = attachFromDeck(unshielded, "p2", THERAPEUTIC, 1);
    unshielded = attachFromDeck(unshielded, "p2", BASIC, 1);
    const admitted = swing(unshielded, IDX.purge);
    expect(admitted.state.players.p2.active?.tools).toEqual([]);
    expect(admitted.state.players.p2.active?.energy).toHaveLength(1); // the Basic survived
  });

  it("a REFUSED strip files no row claiming a discard, and is not silent either", () => {
    const { events } = swing(shielded(), IDX.pry);
    const prevented = find(events, "ATTACK_EFFECT_PREVENTED");
    expect(prevented).toBeDefined();
    expect(prevented?.uid).toBe(shielded().players.p2.active?.stack.at(-1));
    expect(count(events, "TOOLS_DISCARDED")).toBe(0);
    expect(count(events, "ENERGY_DISCARDED")).toBe(0);
    // …and it is the SAME event every other refused attack effect files, not a new one.
    expect(events.map((e) => e.type)).toContain("ATTACK_EFFECT_PREVENTED");
  });

  it("the refusal is about the BODY, not the seat: a shielded ATTACKER is no shield", () => {
    // A build that read the wrong side's passives would refuse here. The Mist Energy
    // goes on the ATTACKER while the DEFENDER wears the Tool; the strip must land.
    let state = attachFromDeck(tooled(), "p1", MIST, 1);
    const admitted = swing(state, IDX.pry);
    expect(admitted.state.players.p2.active?.tools).toEqual([]);
    expect(find(admitted.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    // …and the same board with the shield moved one body over refuses (one axis).
    state = attachFromDeck(tooled(), "p2", MIST, 1);
    expect(swing(state, IDX.pry).state.players.p2.active?.tools).toHaveLength(1);
  });
});

describe("§3 — row 72 strips *this Pokémon* and no shield can stop it", () => {
  function banded(seat: Seat = "p1"): GameState {
    return attachToolFromDeck(board(seat), seat, "active", BAND);
  }

  it("THE ATTACKER'S OWN MIST ENERGY DOES NOT SAVE THE ATTACKER'S OWN TOOL", () => {
    const state = attachFromDeck(banded(), "p1", MIST, 1);
    const { state: after, events } = swing(state, IDX.shed);
    expect(after.players.p1.active?.tools).toEqual([]);
    expect(find(events, "TOOLS_DISCARDED")?.seat).toBe("p1");
    expect(find(events, "TOOLS_DISCARDED")?.actor).toBe("p1");
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    // …and the number moved with it: 110 with the Band, 100 once it is discarded.
    expect(dealt(events)).toBe(100);
    expect(dealt(swing(banded(), IDX.plain).events)).toBe(110);
  });

  it("…and the OPPONENT's Mist Energy does not either — it is not on the target", () => {
    const state = attachFromDeck(banded(), "p2", MIST, 1);
    const { state: after, events } = swing(state, IDX.shed);
    expect(after.players.p1.active?.tools).toEqual([]);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(dealt(events)).toBe(100);
  });

  it("…while the SAME shield on the SAME body refuses an opponent-side sentence", () => {
    let state = attachToolFromDeck(banded(), "p2", "active", CHESTPLATE);
    state = attachFromDeck(state, "p2", MIST, 1);
    expect(swing(state, IDX.shed).state.players.p1.active?.tools).toEqual([]);
    expect(swing(state, IDX.pry).state.players.p2.active?.tools).toHaveLength(1);
  });

  it("the printed CANCEL still fires on a bare own body, shield or no shield", () => {
    for (const [label, state] of [
      ["bare", board()],
      ["bare + shield", attachFromDeck(board(), "p1", MIST, 1)],
    ] as [string, GameState][]) {
      const { events } = swing(state, IDX.shed);
      expect(find(events, "ATTACK_FAILED")?.reason, label).toBe("preDamage");
      expect(find(events, "DAMAGE_DEALT"), label).toBeUndefined();
      expect(find(events, "ATTACK_EFFECT_PREVENTED"), label).toBeUndefined();
    }
  });
});

describe("§4 — row 74's strip and status are refused by ONE gate, announced ONCE", () => {
  it("the Tool STAYS, nothing is Paralyzed, and there is EXACTLY ONE row", () => {
    const { state, events } = swing(shielded(), IDX.lock);
    expect(state.players.p2.active?.tools).toHaveLength(1);
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    expect(count(events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(count(events, "TOOLS_DISCARDED")).toBe(0);
    expect(count(events, "STATUS_APPLIED")).toBe(0);
    expect(count(events, "STATUS_PREVENTED")).toBe(0);
    // The Chestplate survived, so the damage is the reduced figure.
    expect(dealt(events)).toBe(70);
  });

  it("the ADMISSION: the same board without the shield discards AND Paralyzes", () => {
    const { state, events } = swing(tooled(), IDX.lock);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(count(events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(count(events, "STATUS_APPLIED")).toBe(1);
    expect(dealt(events)).toBe(100);
  });

  it("§12's immunity is a DIFFERENT refusal and still behaves as it did", () => {
    const state = attachFromDeck(tooled(), "p2", THERAPEUTIC, 1);
    const { state: after, events } = swing(state, IDX.lock);
    expect(after.players.p2.active?.tools).toEqual([]);
    expect(count(events, "TOOLS_DISCARDED")).toBe(1);
    expect(count(events, "STATUS_PREVENTED")).toBe(1);
    expect(count(events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(after.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("BOTH Energies at once: §11 wins, because it refuses the act that gates §12", () => {
    let state = attachFromDeck(shielded(), "p2", THERAPEUTIC, 1);
    state = attachFromDeck(state, "p2", BASIC, 1);
    const { state: after, events } = swing(state, IDX.lock);
    expect(after.players.p2.active?.tools).toHaveLength(1);
    expect(count(events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(count(events, "STATUS_PREVENTED")).toBe(0);
    expect(count(events, "STATUS_APPLIED")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — BOTH SEATS, and the loud path in both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — both seats, and nothing is reported as skipped", () => {
  it("p2 attacking: the shield on p1's Active refuses p2's strip", () => {
    const refused = swing(shielded("p2"), IDX.pry, "p2");
    expect(refused.state.players.p1.active?.tools).toHaveLength(1);
    expect(find(refused.events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p1");
    expect(dealt(refused.events)).toBe(70);

    const admitted = swing(tooled("p2"), IDX.pry, "p2");
    expect(admitted.state.players.p1.active?.tools).toEqual([]);
    expect(find(admitted.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(dealt(admitted.events)).toBe(100);
  });

  it("p2 attacking: row 72 still strips p2's OWN Tool through its OWN shield", () => {
    let state = attachToolFromDeck(board("p2"), "p2", "active", BAND);
    state = attachFromDeck(state, "p2", MIST, 1);
    const { state: after, events } = swing(state, IDX.shed, "p2");
    expect(after.players.p2.active?.tools).toEqual([]);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
  });

  it("a REFUSED sentence is still SIMULATED — no ATTACK_EFFECT_SKIPPED, either way", () => {
    for (const index of [IDX.purge, IDX.pry, IDX.shed, IDX.lock]) {
      expect(
        find(swing(shielded(), index).events, "ATTACK_EFFECT_SKIPPED"),
        String(index),
      ).toBeUndefined();
      expect(
        find(swing(tooled(), index).events, "ATTACK_EFFECT_SKIPPED"),
        String(index),
      ).toBeUndefined();
    }
  });

  it("THE ATTRIBUTION CONTROL — index 5's unread sentence IS still reported", () => {
    const skipped = find(swing(shielded(), IDX.loud).events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe(LOUD_SENTENCE);
    expect(resolvedByAnyReader(LOUD_SENTENCE)).toBe(false);
    expect(legalAttackCorpus().filter(([, text]) => text === LOUD_SENTENCE)).toEqual([
      [1, LOUD_SENTENCE],
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — nothing persisted moves, and the seam is still pure and un-parkable.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — persistence, purity, and the property the export did not cost", () => {
  it("`MATCH_RECORD_VERSION` STAYS 26 — a boolean gate adds no persisted shape", () => {
    const refused = swing(shielded(), IDX.pry);
    expect(refused.state.phase.kind).toBe("turn:action");
    expect(refused.state.pending).toEqual([]);
    expect("cont" in refused.state.phase).toBe(false);
    // The shielded body's key set as a LITERAL, so "every body grew a key" cannot hide
    // inside a same-tree comparison (aquaWash's rule).
    expect(Object.keys(refused.state.players.p2.active ?? {}).sort()).toEqual([
      "attackBlock",
      "attackDamageDebuff",
      "attackDamageTaken",
      "attackFlipLockTurn",
      "attackLockedTurn",
      "attackTwoFlipLockTurn",
      "benchedTurn",
      "boostedAttack",
      "conditions",
      "costTaxTurn",
      "damage",
      "damageReduction",
      "damageVulnerability",
      "energy",
      "evolvedTurn",
      "handAttachMark",
      "healedTurn",
      "installedRecoil",
      "koBounty",
      "lockedAttacks",
      "markers",
      "noWeaknessTurn",
      "promotedTurn",
      "retreatBlocked",
      "retreatLockedTurn",
      "scheduledEffect",
      "stack",
      "tools",
      "turnPlayed",
      "usedAttack",
      "weaknessRetype",
    ]);
    // …and the refusal event's own key set, for the same reason.
    const prevented = find(refused.events, "ATTACK_EFFECT_PREVENTED");
    expect(Object.keys(prevented ?? {}).sort()).toEqual(["seat", "type", "uid"]);
  });

  it("a v26 record round-trips BOTH DIRECTIONS through every refused sentence", () => {
    for (const [label, start, index] of [
      ["row71-refused", attachFromDeck(shielded(), "p2", BASIC, 1), IDX.purge],
      ["row73-refused", shielded(), IDX.pry],
      ["row74-refused", shielded(), IDX.lock],
      [
        "row72-unrefusable",
        attachFromDeck(attachToolFromDeck(board(), "p1", "active", BAND), "p1", MIST, 1),
        IDX.shed,
      ],
    ] as [string, GameState, number][]) {
      const rehydrated = JSON.parse(JSON.stringify(start)) as GameState;
      const live = swing(start, index);
      const replayed = swing(rehydrated, index);
      expect(JSON.stringify(replayed.events), label).toBe(JSON.stringify(live.events));
      expect(JSON.stringify(replayed.state), label).toBe(JSON.stringify(live.state));
      const after = JSON.parse(JSON.stringify(live.state)) as GameState;
      expect(JSON.stringify(after), label).toBe(JSON.stringify(live.state));
    }
  });

  it("the swing mutates NOTHING it was given — deep-frozen boards resolve", () => {
    const frozenRefused = deepFreeze(shielded());
    const refused = swing(frozenRefused, IDX.pry);
    expect(frozenRefused.players.p2.active?.tools).toHaveLength(1);
    expect(refused.state.players.p2.active?.tools).toHaveLength(1);
    expect(refused.state.players.p2.active?.tools).toBe(frozenRefused.players.p2.active?.tools);

    const frozenAdmitted = deepFreeze(tooled());
    const admitted = swing(frozenAdmitted, IDX.pry);
    expect(frozenAdmitted.players.p2.active?.tools).toHaveLength(1);
    expect(admitted.state.players.p2.active?.tools).toEqual([]);
  });
});
