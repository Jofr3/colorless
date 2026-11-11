import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackEffect,
  deriveAttackPreDamage,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  PRE_DAMAGE_FAMILY_DECK,
  attachFromDeck,
  attachToolFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  findEvent,
  roundTrip,
} from "./testFixtures";

const LOUD_SENTENCE = "Heal 100 damage from 1 of your Benched Ancient Pokémon.";

const SEED = 11;

const CORPUS = legalAttackCorpus();
const ROW71 =
  "Before doing damage, discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon.";
const ROW72 =
  "Before doing damage, discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing.";
const ROW73 = "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.";
const ROW74 =
  "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon. If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.";

/** The literal head the whole family shares — what a prefix stripper would take off. */
const HEAD = "Before doing damage, ";

const IDX = { purge: 0, pry: 1, shed: 2, lock: 3, plain: 4, loud: 5 } as const;

const CHESTPLATE = "sv01-192"; // Tool: −30 after W/R on an {F} holder
const BAND = "sv01-197"; // Tool: the ATTACKER's +10 before W/R
const HELMET = "sv01-193"; // Tool: 20 counters back on the ATTACKER when its holder is hit
const THERAPEUTIC = "sv02-193"; // Special Energy: §12 — the holder can't be Paralyzed
const BASIC = "fix-energy"; // Basic Energy: the card-class control

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

/** A board with `fix-preseam` Active for `seat` and `fix-seamwall` Active opposite,
    two Colorless attached to the attacker. The turn is handed to `seat` by ending the
    OTHER seat's first turn, so §4's going-first ban is never in the way. */
function board(seat: Seat = "p1", defender = "fix-seamwall"): GameState {
  const decks = { p1: PRE_DAMAGE_FAMILY_DECK, p2: PRE_DAMAGE_FAMILY_DECK };
  let state = driveSetup(SEED, decks, { first: other(seat) });
  state = setActiveFromDeck(state, seat, "fix-preseam");
  state = setActiveFromDeck(state, other(seat), defender);
  state = attachFromDeck(state, seat, BASIC, 2);
  return mustApply(state, { type: "endTurn", seat: other(seat) }).state;
}

function armedDefender(seat: Seat = "p1"): GameState {
  let state = board(seat);
  state = attachToolFromDeck(state, other(seat), "active", CHESTPLATE);
  state = attachFromDeck(state, other(seat), THERAPEUTIC, 1);
  state = attachFromDeck(state, other(seat), BASIC, 1);
  return state;
}

function swing(
  state: GameState,
  index: number,
  seat: Seat = "p1",
): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat, index });
}

function dealt(events: GameEvent[]): number | undefined {
  return findEvent(events, "DAMAGE_DEALT")?.dealt;
}

/** The §9 counterattack total this swing put back on the attacker. Non-zero only when
    the DEFENDER wears Rocky Helmet, which is the board §4 uses to make the recoil site —
    the one that would resurrect a stale attacker binding — actually run. */
function recoil(events: GameEvent[]): number {
  return events
    .filter((e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack")
    .reduce((sum, e) => sum + (e.type === "COUNTERS_PLACED" ? e.amount : 0), 0);
}

/** The rendered log, flattened to `{ who, text }`. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** The uid of `cardId` as it sits ATTACHED to `seat`'s Active — read off the board
    rather than off `cardIdByUid`, because a deck holds four copies and the surgery
    helpers take whichever one is first in the deck, not first in the id map. */
function attachedUid(state: GameState, seat: Seat, cardId: string): string | undefined {
  const active = state.players[seat].active;
  return [...(active?.tools ?? []), ...(active?.energy ?? [])].find(
    (uid) => state.cardIdByUid[uid] === cardId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the three sentences, the population, and the claim that justifies the ratio.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the sentences, measured live over the legal column", () => {
  it("is THREE sentences at ONE legal printing each, and they are the corpus's bytes", () => {
    for (const sentence of [ROW71, ROW72, ROW74]) {
      const rows = CORPUS.filter(([, text]) => text === sentence);
      expect(rows, sentence).toHaveLength(1);
      expect(rows[0]?.[0], sentence).toBe(1);
    }
    expect(ROW71).toContain("opponent's");
    expect(ROW72).toContain("can't");
    expect(ROW74).toContain("opponent's");
    for (const sentence of [ROW71, ROW72, ROW74]) expect(sentence.includes("’")).toBe(false);
    expect(CORPUS.some(([, text]) => text.includes("’"))).toBe(false);
  });

  it("the FAMILY is now CLOSED: all four openers are claimed, and the fifth row is not one", () => {
    const family = CORPUS.filter(([, s]) => /[Bb]efore doing damage/.test(s));
    expect(family).toHaveLength(5);
    const openers = family.filter(([, s]) => s.startsWith(HEAD));
    expect(openers).toHaveLength(4);
    for (const [, s] of openers) expect(deriveAttackPreDamage(s), s).not.toBeNull();
    expect(openers.map(([, s]) => s).sort()).toEqual([ROW71, ROW72, ROW73, ROW74].sort());
    const mid = family.filter(([, s]) => !s.startsWith(HEAD));
    expect(mid).toHaveLength(1);
    expect(deriveAttackPreDamage(mid[0]?.[1] ?? "")).toBeNull();
    expect(mid[0]?.[1]).toContain("Before doing damage, you may attach");
  });

  it("THE PREFIX STRIPPER, RE-PRICED AFTER THE FAMILY WAS CLAIMED: still ZERO", () => {
    const openers = CORPUS.filter(([, s]) => s.startsWith(HEAD));
    expect(openers).toHaveLength(4);
    const bought = openers.filter(([, s]) => {
      const rest = s.slice(HEAD.length);
      const capped = rest.charAt(0).toUpperCase() + rest.slice(1);
      return resolvedByAnyReader(rest) || resolvedByAnyReader(capped);
    });
    expect(bought).toEqual([]);
    expect(resolvedByAnyReader("Your opponent's Active Pokémon is now Asleep.")).toBe(true);
    const unclaimed = openers.filter(([, s]) => !resolvedByAnyReader(s));
    expect(unclaimed).toEqual([]);
  });

  it("the reader SURFACE stands still at 13 — three sentences, no new instrument", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(attackReaderSurface()).toContain("deriveAttackPreDamage");
    for (const sentence of [ROW71, ROW72, ROW74]) {
      expect(splitAttackGateClause(sentence), sentence).toBeNull();
      expect(splitAttackTrailingClause(sentence), sentence).toBeNull();
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
  });

  it("the `/Pokémon Tool/` sweep is TEN rows, this slice claims FOUR, and ALL TEN are now claimed by SOME reader", () => {
    const tools = CORPUS.filter(([, s]) => /Pokémon Tool/.test(s));
    expect(tools).toHaveLength(10);
    expect(tools.filter(([, s]) => deriveAttackPreDamage(s) !== null)).toHaveLength(4);
    // THE FAMILY IS CLOSED: every one of the ten is claimed by some reader.
    expect(tools.filter(([, s]) => !resolvedByAnyReader(s))).toEqual([]);
    // …and the tenth is named, present, and claimed by `deriveAttackEffect` — NOT by
    // this file's pre-damage reader, which still refuses it (no pre-damage head).
    const UP_TO_2 = "Discard up to 2 Pokémon Tools from your opponent's Pokémon.";
    expect(tools.filter(([, s]) => s === UP_TO_2)).toHaveLength(1);
    expect(deriveAttackEffect(UP_TO_2)).toEqual([{ op: "discardTools", count: 2 }]);
    expect(deriveAttackPreDamage(UP_TO_2)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation: four members, one reader, and the boundaries it holds.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the boundaries the four anchors hold", () => {
  it("derives four DISTINCT closed shapes, each with `kind` as its only key", () => {
    expect(deriveAttackPreDamage(ROW71)).toEqual({
      kind: "discardOpponentActiveToolsAndSpecialEnergy",
    });
    expect(deriveAttackPreDamage(ROW72)).toEqual({ kind: "discardOwnToolsElseCancel" });
    expect(deriveAttackPreDamage(ROW73)).toEqual({ kind: "discardOpponentActiveTools" });
    expect(deriveAttackPreDamage(ROW74)).toEqual({
      kind: "discardOpponentActiveToolsThenParalyze",
    });
    const kinds = [ROW71, ROW72, ROW73, ROW74].map((s) => deriveAttackPreDamage(s)?.kind);
    expect(new Set(kinds).size).toBe(4);
    for (const sentence of [ROW71, ROW72, ROW73, ROW74]) {
      expect(Object.keys(deriveAttackPreDamage(sentence) ?? {}), sentence).toEqual(["kind"]);
    }
  });

  it("the U+2019 re-ingest derives IDENTICALLY for all four, not merely non-null", () => {
    for (const sentence of [ROW71, ROW72, ROW73, ROW74]) {
      const curly = sentence.replaceAll("'", "’");
      expect(curly, sentence).not.toBe(sentence);
      expect(deriveAttackPreDamage(curly), sentence).toEqual(deriveAttackPreDamage(sentence));
    }
  });

  it("ROW 73 IS THE ONE-AXIS NEIGHBOUR OF BOTH 71 AND 74, and all three stay distinct", () => {
    expect(ROW74.startsWith(ROW73)).toBe(true);
    expect(ROW71.replace(" and Special Energy", "")).toBe(ROW73);
    expect(deriveAttackPreDamage(ROW73)?.kind).toBe("discardOpponentActiveTools");
    expect(deriveAttackPreDamage(ROW74)?.kind).toBe("discardOpponentActiveToolsThenParalyze");
    expect(deriveAttackPreDamage(ROW71)?.kind).toBe("discardOpponentActiveToolsAndSpecialEnergy");
  });

  it("THE NEAR-MISSES ARE REFUSED, AND EACH DIFFERS ON EXACTLY ONE AXIS (D427)", () => {
    expect(deriveAttackPreDamage(ROW74.replace("Paralyzed", "Asleep"))).toBeNull();
    expect(
      deriveAttackPreDamage(ROW72.replace("from this Pokémon", "from your opponent's Pokémon")),
    ).toBeNull();
    expect(deriveAttackPreDamage(ROW71.replace("Special Energy", "Energy"))).toBeNull();
    expect(deriveAttackPreDamage(ROW73.slice(HEAD.length))).toBeNull();
    for (const sentence of [ROW71, ROW72, ROW73, ROW74]) {
      expect(deriveAttackPreDamage(sentence), sentence).not.toBeNull();
    }
  });

  it("the OTHER pre-damage-adjacent row stays with its OWN reader", () => {
    const otherSpelling = CORPUS.filter(([, s]) => /before this attack does damage/i.test(s));
    expect(otherSpelling).toHaveLength(1);
    expect(otherSpelling[0]?.[0]).toBe(2);
    expect(deriveAttackPreDamage(otherSpelling[0]?.[1] ?? "")).toBeNull();
    expect(resolvedByAnyReader(otherSpelling[0]?.[1] ?? "")).toBe(true);
  });

  it("row 74 does NOT compose through the trailing splitter — measured, not assumed", () => {
    expect(splitAttackTrailingClause(ROW74)).toBeNull();
    expect(
      deriveAttackEffect(
        "If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
    expect(splitAttackTrailingClause(ROW72)).toBeNull();
    expect(deriveAttackEffect("If you can't discard any, this attack does nothing.")).toBeNull();
  });

  it("the demonstrator body carries the identical bytes at every index", () => {
    const attacks = FIXTURE_POOL["fix-preseam"]?.attacks ?? [];
    expect(attacks).toHaveLength(6);
    expect(attacks[IDX.purge]?.effect).toBe(ROW71);
    expect(attacks[IDX.pry]?.effect).toBe(ROW73);
    expect(attacks[IDX.shed]?.effect).toBe(ROW72);
    expect(attacks[IDX.lock]?.effect).toBe(ROW74);
    // The null control prints the SAME 100 damage and NO effect, which is what makes
    // every comparison below a one-axis one.
    expect(attacks[IDX.plain]?.effect ?? null).toBeNull();
    for (const i of [IDX.purge, IDX.pry, IDX.shed, IDX.lock, IDX.plain]) {
      expect(attacks[i]?.damage, String(i)).toBe(100);
    }
  });
});

describe("§3 — row 71 takes the Tool AND the Special Energy, and leaves the Basic", () => {
  it("ONE board, THREE indices: the TOOL half moves the damage, and it is pre-damage", () => {
    const armed = armedDefender();
    expect(dealt(swing(armed, IDX.plain).events)).toBe(70); // no sentence at all
    expect(dealt(swing(armed, IDX.pry).events)).toBe(100);
    expect(dealt(swing(armed, IDX.purge).events)).toBe(100);
    expect(
      (dealt(swing(armed, IDX.purge).events) ?? 0) - (dealt(swing(armed, IDX.plain).events) ?? 0),
    ).toBe(30);
  });

  it("THE SECOND ZONE MOVES NO NUMBER, AND THAT IS MEASURED RATHER THAN ASSUMED", () => {
    const armed = armedDefender();
    expect(dealt(swing(armed, IDX.pry).events)).toBe(dealt(swing(armed, IDX.purge).events));
  });

  it("the SECOND ZONE is a CARD CLASS: the Basic Energy on the same body survives", () => {
    // The one distinction an "all Energy" mis-build erases. `isSpecialEnergy` is a card
    // read, not a type read, so the Basic stays exactly where it was.
    const armed = armedDefender();
    const before = armed.players.p2.active?.energy ?? [];
    expect(before).toHaveLength(2);
    const { state } = swing(armed, IDX.purge);
    const after = state.players.p2.active?.energy ?? [];
    expect(after).toHaveLength(1);
    expect(state.cardIdByUid[after[0] ?? ""]).toBe(BASIC);
    // …and the Special Energy really left play, into its OWNER's pile.
    const specialUid = attachedUid(armed, "p2", THERAPEUTIC);
    expect(state.players.p2.discard).toContain(specialUid);
    expect(state.players.p1.discard).not.toContain(specialUid);
    const pried = swing(armed, IDX.pry).state;
    expect(pried.players.p2.active?.energy).toEqual(before);
    expect(pried.players.p2.discard).not.toContain(specialUid);
  });

  it("TWO EVENTS AND NOT ONE: the Tool row and the Energy row, in printed noun order", () => {
    const { state, events } = swing(armedDefender(), IDX.purge);
    const tools = findEvent(events, "TOOLS_DISCARDED");
    const energy = findEvent(events, "ENERGY_DISCARDED");
    expect(tools?.seat).toBe("p2");
    expect(tools?.actor).toBe("p1");
    expect(energy?.seat).toBe("p2");
    expect(energy?.actor).toBe("p1");
    expect(energy?.from).toEqual({ spot: "active" });
    // Both name the same host, and it is the TOP-CARD uid rather than the spot.
    expect(tools?.host).toBe(state.players.p2.active?.stack.at(-1));
    expect(energy?.host).toBe(tools?.host);
    // The printed noun order — Tools, then Special Energy — in the batch and in the pile.
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("TOOLS_DISCARDED")).toBeLessThan(kinds.indexOf("ENERGY_DISCARDED"));
    expect(kinds.indexOf("ENERGY_DISCARDED")).toBeLessThan(kinds.indexOf("DAMAGE_DEALT"));
    const pile = state.players.p2.discard;
    expect(pile.indexOf(tools?.uids[0] ?? "")).toBeLessThan(pile.indexOf(energy?.uids[0] ?? ""));
  });

  it("a body with ONLY a Special Energy still files the Energy row and NO Tool row", () => {
    let onlyEnergy = board();
    onlyEnergy = attachFromDeck(onlyEnergy, "p2", THERAPEUTIC, 1);
    const { state, events } = swing(onlyEnergy, IDX.purge);
    expect(findEvent(events, "TOOLS_DISCARDED")).toBeUndefined();
    expect(findEvent(events, "ENERGY_DISCARDED")?.uids).toHaveLength(1);
    expect(state.players.p2.active?.energy).toEqual([]);
  });

  it("a body with NEITHER is a silent no-op — no rows, identical damage", () => {
    const bare = board();
    expect(dealt(swing(bare, IDX.plain).events)).toBe(100);
    const { events } = swing(bare, IDX.purge);
    expect(dealt(events)).toBe(100);
    expect(events.filter((e) => e.type === "TOOLS_DISCARDED")).toEqual([]);
    expect(events.filter((e) => e.type === "ENERGY_DISCARDED")).toEqual([]);
  });
});

describe("§4 — row 72 strips *this Pokémon*, and cancels when it cannot", () => {
  /** The attacker wears a Vitality Band; the defender wears a Spiky Energy so the §9
      counterattack site — the one that RESURRECTS a stale attacker binding — actually
      runs. */
  function banded(seat: Seat = "p1"): GameState {
    let state = board(seat);
    state = attachToolFromDeck(state, seat, "active", BAND);
    state = attachToolFromDeck(state, other(seat), "active", HELMET);
    return state;
  }

  it("THE NUMBER MOVES: 110 with the Band, 100 once the attack discards its own", () => {
    // `attackerPreWRBonus` folds the ATTACKER's attached Tools, so the Band's +10 is
    // the figure the pre-damage strip removes. The two indices print the same cost and
    // the same 100 damage and differ only in the sentence.
    const armed = banded();
    expect(dealt(swing(armed, IDX.plain).events)).toBe(110);
    expect(dealt(swing(armed, IDX.shed).events)).toBe(100);
  });

  it("…and the delta is 10, which is the DEFECT a missing rebind ships", () => {
    const armed = banded();
    expect(
      (dealt(swing(armed, IDX.plain).events) ?? 0) - (dealt(swing(armed, IDX.shed).events) ?? 0),
    ).toBe(10);
  });

  it("THE RESURRECTION: the §9 counterattack must not put the Tool back", () => {
    const armed = banded();
    const bandUid = attachedUid(armed, "p1", BAND);
    expect(armed.players.p1.active?.tools).toEqual([bandUid]);
    const { state, events } = swing(armed, IDX.shed);
    expect(recoil(events)).toBe(20); // the write really happened
    expect(state.players.p1.active?.damage).toBe(20);
    expect(state.players.p1.active?.tools).toEqual([]); // …and it did not restore
    expect(state.players.p1.discard.filter((u) => u === bandUid)).toHaveLength(1);
  });

  it("the Tool goes to the ATTACKER's own pile, and the event names one seat twice", () => {
    const armed = banded();
    const bandUid = attachedUid(armed, "p1", BAND);
    const { state, events } = swing(armed, IDX.shed);
    const row = findEvent(events, "TOOLS_DISCARDED");
    expect(row?.seat).toBe("p1");
    expect(row?.actor).toBe("p1");
    expect(row?.uids).toEqual([bandUid]);
    expect(row?.host).toBe(armed.players.p1.active?.stack.at(-1));
    expect(state.players.p1.discard).toContain(bandUid);
    expect(state.players.p2.discard).not.toContain(bandUid);
  });

  it("THE CANCEL: no Tool on this Pokémon and the attack does NOTHING", () => {
    const bare = board();
    const { state, events } = swing(bare, IDX.shed);
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(0);
    expect(findEvent(events, "ATTACK_FAILED")?.reason).toBe("preDamage");
    expect(findEvent(events, "TOOLS_DISCARDED")).toBeUndefined();
  });

  it("…and the TURN STILL ENDS, because a cancelled attack is an attack that was USED", () => {
    const bare = board();
    const { state, events } = swing(bare, IDX.shed);
    expect(findEvent(events, "TURN_ENDED")).toBeDefined();
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.turn).toBe(3);
    expect(state.players.p1.active?.usedAttack).toEqual({ name: "Shed Gear", turn: 2 });
  });

  it("…and §8.1 STILL SWEEPS on the cancelled path, with the control that says so", () => {
    const lethal = setDamage(board(), "p2", 300);
    const cancelled = swing(lethal, IDX.shed);
    expect(findEvent(cancelled.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(findEvent(cancelled.events, "KNOCKED_OUT")).toBeDefined();
    // THE CONTROL: on a board that is NOT lethal the same cancelled swing files no KO,
    // so the rung above is about the sweep and not about "this path always emits one".
    expect(findEvent(swing(board(), IDX.shed).events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("the log row names the ACT, not a condition that was never printed", () => {
    const bare = board();
    const { state, events } = swing(bare, IDX.shed);
    const rows = rendered(state, events);
    expect(rows.map((r) => r.text)).toContain(
      "Fixseam's attack did nothing — it had no Pokémon Tool to discard",
    );
    for (const row of rows) expect(row.text).not.toContain("its condition was not met");
  });

  it("row 72 does NOT touch the opponent's Tools — the other half of *this Pokémon*", () => {
    // A build that read the wrong seat passes every rung above on a bare-attacker board.
    let both = board();
    both = attachToolFromDeck(both, "p1", "active", BAND);
    both = attachToolFromDeck(both, "p2", "active", CHESTPLATE);
    const { state, events } = swing(both, IDX.shed);
    expect(state.players.p1.active?.tools).toEqual([]);
    expect(state.players.p2.active?.tools).toHaveLength(1);
    expect(findEvent(events, "TOOLS_DISCARDED")?.seat).toBe("p1");
    // …and the defender's Chestplate is therefore STILL subtracting: 110 − 10 − 30.
    expect(dealt(events)).toBe(70);
  });
});

describe("§5 — row 74 Paralyzes only when a Tool was actually discarded", () => {
  it("a Tool WAS discarded: the opponent's Active is now Paralyzed, before the damage", () => {
    let tooled = board();
    tooled = attachToolFromDeck(tooled, "p2", "active", CHESTPLATE);
    const { state, events } = swing(tooled, IDX.lock);
    expect(findEvent(events, "TOOLS_DISCARDED")).toBeDefined();
    expect(findEvent(events, "STATUS_APPLIED")?.status).toBe("paralyzed");
    expect(state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(dealt(events)).toBe(100);
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("TOOLS_DISCARDED")).toBeLessThan(kinds.indexOf("STATUS_APPLIED"));
    expect(kinds.indexOf("STATUS_APPLIED")).toBeLessThan(kinds.indexOf("DAMAGE_DEALT"));
  });

  it("THE CONTROL: no Tool to discard and there is NO Paralysis at all", () => {
    const bare = board();
    const { state, events } = swing(bare, IDX.lock);
    expect(findEvent(events, "TOOLS_DISCARDED")).toBeUndefined();
    expect(findEvent(events, "STATUS_APPLIED")).toBeUndefined();
    expect(findEvent(events, "STATUS_PREVENTED")).toBeUndefined();
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    // …and the damage is identical either way, so the difference really is the status.
    expect(dealt(events)).toBe(100);
  });

  it("a SPECIAL ENERGY on the body does NOT satisfy the printed *Pokémon Tool*", () => {
    let energyOnly = board();
    energyOnly = attachFromDeck(energyOnly, "p2", THERAPEUTIC, 1);
    const { state, events } = swing(energyOnly, IDX.lock);
    expect(findEvent(events, "ENERGY_DISCARDED")).toBeUndefined();
    expect(findEvent(events, "STATUS_APPLIED")).toBeUndefined();
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("§12's IMMUNITY refuses the Paralysis and the Tool is discarded ANYWAY", () => {
    let immune = board();
    immune = attachToolFromDeck(immune, "p2", "active", CHESTPLATE);
    immune = attachFromDeck(immune, "p2", THERAPEUTIC, 1);
    const { state, events } = swing(immune, IDX.lock);
    expect(findEvent(events, "TOOLS_DISCARDED")).toBeDefined();
    expect(findEvent(events, "STATUS_PREVENTED")?.status).toBe("paralyzed");
    expect(findEvent(events, "STATUS_APPLIED")).toBeUndefined();
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    // …and the damage still moved, so the refusal is about the CONDITION and not about
    // the act: the Chestplate is gone either way.
    expect(dealt(events)).toBe(100);
  });

  it("row 73 on the SAME tooled board Paralyzes NOTHING — the sentence-level control", () => {
    let tooled = board();
    tooled = attachToolFromDeck(tooled, "p2", "active", CHESTPLATE);
    const { state, events } = swing(tooled, IDX.pry);
    expect(findEvent(events, "TOOLS_DISCARDED")).toBeDefined();
    expect(findEvent(events, "STATUS_APPLIED")).toBeUndefined();
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — BOTH SEATS, for all three sentences.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — both seats: *your opponent's* and *this Pokémon* are relative", () => {
  it("p2 attacking: row 71 strips p1's Active, row 74 Paralyzes p1's Active", () => {
    const mirrored = armedDefender("p2");
    const purge = swing(mirrored, IDX.purge, "p2");
    expect(findEvent(purge.events, "TOOLS_DISCARDED")?.seat).toBe("p1");
    expect(findEvent(purge.events, "TOOLS_DISCARDED")?.actor).toBe("p2");
    expect(findEvent(purge.events, "ENERGY_DISCARDED")?.seat).toBe("p1");
    expect(purge.state.players.p1.active?.tools).toEqual([]);
    expect(purge.state.players.p1.active?.energy).toHaveLength(1); // the BASIC survived
    expect(dealt(purge.events)).toBe(100);

    let tooled = board("p2");
    tooled = attachToolFromDeck(tooled, "p1", "active", CHESTPLATE);
    const lock = swing(tooled, IDX.lock, "p2");
    expect(lock.state.players.p1.active?.conditions.rotation).toBe("paralyzed");
    expect(lock.state.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("p2 attacking: row 72 strips p2's OWN Active, and cancels on p2's own bare body", () => {
    let armed = board("p2");
    armed = attachToolFromDeck(armed, "p2", "active", BAND);
    armed = attachToolFromDeck(armed, "p1", "active", BAND);
    const shed = swing(armed, IDX.shed, "p2");
    expect(shed.state.players.p2.active?.tools).toEqual([]);
    expect(shed.state.players.p1.active?.tools).toHaveLength(1);
    expect(findEvent(shed.events, "TOOLS_DISCARDED")?.seat).toBe("p2");
    expect(findEvent(shed.events, "TOOLS_DISCARDED")?.actor).toBe("p2");

    // …and the cancel is seat-relative too: p1's Tool is no help to p2's sentence.
    let onlyOpponent = board("p2");
    onlyOpponent = attachToolFromDeck(onlyOpponent, "p1", "active", BAND);
    const cancelled = swing(onlyOpponent, IDX.shed, "p2");
    expect(findEvent(cancelled.events, "ATTACK_FAILED")?.reason).toBe("preDamage");
    expect(findEvent(cancelled.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(cancelled.state.players.p1.active?.tools).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the loud path: nothing is skipped, in EITHER direction.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — ATTACK_EFFECT_SKIPPED, both directions", () => {
  it("none of the three new indices is reported as skipped, on ANY of their boards", () => {
    const armed = armedDefender();
    const bare = board();
    for (const index of [IDX.purge, IDX.shed, IDX.lock]) {
      expect(
        findEvent(swing(armed, index).events, "ATTACK_EFFECT_SKIPPED"),
        String(index),
      ).toBeUndefined();
      // …including the boards where the act did NOTHING, so "simulated" is a property
      // of the SENTENCE and not of whether anything happened — the cancelled swing too.
      expect(
        findEvent(swing(bare, index).events, "ATTACK_EFFECT_SKIPPED"),
        String(index),
      ).toBeUndefined();
    }
  });

  it("THE ATTRIBUTION CONTROL — index 5's unread sentence IS still reported", () => {
    const skipped = findEvent(swing(board(), IDX.loud).events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe(LOUD_SENTENCE);
    expect(resolvedByAnyReader(LOUD_SENTENCE)).toBe(false);
    expect(legalAttackCorpus().filter(([, text]) => text === LOUD_SENTENCE)).toEqual([
      [1, LOUD_SENTENCE],
    ]);
  });
});

describe("§8 — the result channel, and the property it did not cost", () => {
  it("`tools` DRIVEN BOTH WAYS through row 74's consequent", () => {
    // The channel is not directly observable — it is a module-private return type — so
    // it is driven through the two decisions it feeds. `tools > 0` and `tools === 0` on
    // ONE board pair, differing only in whether a Tool is attached.
    let tooled = board();
    tooled = attachToolFromDeck(tooled, "p2", "active", CHESTPLATE);
    expect(swing(tooled, IDX.lock).state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(swing(board(), IDX.lock).state.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("`cancelled` DRIVEN BOTH WAYS through row 72's branch", () => {
    let armed = board();
    armed = attachToolFromDeck(armed, "p1", "active", BAND);
    expect(findEvent(swing(armed, IDX.shed).events, "ATTACK_FAILED")).toBeUndefined();
    expect(dealt(swing(armed, IDX.shed).events)).toBe(100);
    expect(findEvent(swing(board(), IDX.shed).events, "ATTACK_FAILED")?.reason).toBe("preDamage");
    expect(dealt(swing(board(), IDX.shed).events)).toBeUndefined();
  });

  it("the seam STILL NEVER PARKS — the board is playable the instant it returns", () => {
    // The observable form of "the widened return cannot carry a decision". If any
    // pre-damage member could park, the phase after the swing would be `effect:choose`
    // and `pending` would be non-empty — and §8.5 would have had to survive it.
    const boards: [string, GameState][] = [
      ["armed", armedDefender()],
      ["bare", board()],
      ["banded", attachToolFromDeck(board(), "p1", "active", BAND)],
      ["tooled", attachToolFromDeck(board(), "p2", "active", CHESTPLATE)],
    ];
    for (const [label, start] of boards) {
      for (const index of [IDX.purge, IDX.shed, IDX.lock]) {
        const { state } = swing(start, index);
        expect(state.phase.kind, `${label}/${index}`).not.toBe("effect:choose");
        expect(state.pending, `${label}/${index}`).toEqual([]);
      }
    }
  });

  it("the PARKING sibling is still REFUSED *HERE*, pinned on the POPULATION (D423)", () => {
    const claimed = CORPUS.filter(([, s]) => deriveAttackPreDamage(s) !== null).map(([, s]) => s);
    expect(claimed.sort()).toEqual([ROW71, ROW72, ROW73, ROW74].sort());
    for (const s of claimed) expect(/up to|you may|choose/i.test(s), s).toBe(false);
    const UP_TO_2 = "Discard up to 2 Pokémon Tools from your opponent's Pokémon.";
    expect(CORPUS.filter(([, s]) => s === UP_TO_2)).toHaveLength(1);
    // The pre-damage refusal — UNCHANGED, and the reason is the missing head.
    expect(deriveAttackPreDamage(UP_TO_2)).toBeNull();
    expect(UP_TO_2.startsWith("Before doing damage,")).toBe(false);
    expect(resolvedByAnyReader(UP_TO_2)).toBe(true);
    expect(deriveAttackEffect(UP_TO_2)).toEqual([{ op: "discardTools", count: 2 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — persistence: `MATCH_RECORD_VERSION` stays 26, driven both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — nothing persisted moves, and it is DRIVEN rather than argued", () => {
  it("`MATCH_RECORD_VERSION` STAYS 26 — no field, no op, no continuation key", () => {
    const armed = armedDefender();
    const { state: after } = swing(armed, IDX.purge);
    expect(after.phase.kind).toBe("turn:action");
    expect(after.pending).toEqual([]);
    expect("cont" in after.phase).toBe(false);
    // The stripped body's key set, as a LITERAL rather than a diff, so "every body grew
    // a key" cannot hide inside a same-tree comparison (aquaWash's rule).
    expect(Object.keys(after.players.p2.active ?? {}).sort()).toEqual([
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
    // …and the Paralysis lands in the `rotation` slot that already holds it, not in a
    // new one.
    let tooled = board();
    tooled = attachToolFromDeck(tooled, "p2", "active", CHESTPLATE);
    const paralyzed = swing(tooled, IDX.lock).state.players.p2.active?.conditions;
    expect(Object.keys(paralyzed ?? {}).sort()).toEqual([
      "burned",
      "confusionDamage",
      "poisonDamage",
      "rotation",
    ]);
  });

  it("a v26 record round-trips BOTH DIRECTIONS through every new sentence", () => {
    for (const [label, start, index] of [
      ["row71", armedDefender(), IDX.purge],
      ["row72", attachToolFromDeck(board(), "p1", "active", BAND), IDX.shed],
      ["row72-cancelled", board(), IDX.shed],
      ["row74", attachToolFromDeck(board(), "p2", "active", CHESTPLATE), IDX.lock],
    ] as [string, GameState, number][]) {
      const rehydrated = roundTrip(start);
      const live = swing(start, index);
      const replayed = swing(rehydrated, index);
      expect(JSON.stringify(replayed.events), label).toBe(JSON.stringify(live.events));
      expect(JSON.stringify(replayed.state), label).toBe(JSON.stringify(live.state));
      const after = roundTrip(live.state);
      expect(JSON.stringify(after), label).toBe(JSON.stringify(live.state));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — purity, and the version pin.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — purity and the version", () => {
  it("the swing mutates NOTHING it was given — deep-frozen boards resolve", () => {
    const frozenArmed = deepFreeze(armedDefender());
    const purge = swing(frozenArmed, IDX.purge);
    expect(frozenArmed.players.p2.active?.tools).toHaveLength(1);
    expect(frozenArmed.players.p2.active?.energy).toHaveLength(2);
    expect(purge.state.players.p2.active?.tools).toEqual([]);
    expect(purge.state.players.p2.active?.energy).toHaveLength(1);

    const frozenBanded = deepFreeze(attachToolFromDeck(board(), "p1", "active", BAND));
    const shed = swing(frozenBanded, IDX.shed);
    expect(frozenBanded.players.p1.active?.tools).toHaveLength(1);
    expect(shed.state.players.p1.active?.tools).toEqual([]);

    // The reader is pure too — same input, equal output, and it does not memoise a
    // mutable object across calls.
    for (const sentence of [ROW71, ROW72, ROW74]) {
      const first = deriveAttackPreDamage(sentence);
      const second = deriveAttackPreDamage(sentence);
      expect(first, sentence).toEqual(second);
      expect(first, sentence).not.toBe(second);
    }
  });
});
