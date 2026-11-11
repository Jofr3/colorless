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
  PRE_DAMAGE_TOOL_DECK,
  attachFromDeck,
  attachToolFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  findEvent,
  roundTrip,
} from "./testFixtures";

const LOUD_SENTENCE = "Heal 100 damage from 1 of your Benched Ancient Pokémon.";

const SEED = 11;

const SENTENCE =
  "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.";

/** The literal head the whole *"Before doing damage,"* family shares — the string a
    prefix stripper would take off. Named so §1 can measure what it would buy. */
const HEAD = "Before doing damage, ";

const IDX = { pry100: 0, plain100: 1, pry120: 2, plain120: 3, loud: 4 } as const;

/** Real Tool ids, reused rather than invented. */
const CHESTPLATE = "sv01-192"; // −30 after W/R, gated on the holder's {F}
const CHARM = "sv02-173"; // +50 HP, gated on the holder being a Basic
const BAND = "sv01-197"; // Vitality Band — an ATTACKER-side bonus, the null control

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

function board(
  defender: string,
  tool: string | null,
  seat: Seat = "p1",
  attacker = "fix-toolstrip",
): GameState {
  const decks = { p1: PRE_DAMAGE_TOOL_DECK, p2: PRE_DAMAGE_TOOL_DECK };
  let state = driveSetup(SEED, decks, { first: other(seat) });
  state = setActiveFromDeck(state, seat, attacker);
  state = setActiveFromDeck(state, other(seat), defender);
  state = attachFromDeck(state, seat, "fix-energy", 2);
  if (tool !== null) state = attachToolFromDeck(state, other(seat), "active", tool);
  return mustApply(state, { type: "endTurn", seat: other(seat) }).state;
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

/** The rendered log, flattened to `{ who, text }`. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the sentence, the population, and the two prices the design turned on.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the sentence, measured live over the legal column", () => {
  it("is 5 legal printings on ONE sentence, and it is the corpus's own bytes", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === SENTENCE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(5);
    expect(SENTENCE).toContain("opponent's");
    expect(SENTENCE.includes("’")).toBe(false);
    expect(legalAttackCorpus().some(([, text]) => text.includes("’"))).toBe(false);
  });

  it("the FAMILY, enumerated with the LOOSEST pattern and every hit read (D424)", () => {
    const family = legalAttackCorpus().filter(([, s]) => /[Bb]efore doing damage/.test(s));
    expect(family).toHaveLength(5);
    expect(family.filter(([, s]) => s.startsWith(HEAD))).toHaveLength(4);
    expect(family.filter(([, s]) => !s.startsWith(HEAD) && s.includes(HEAD))).toHaveLength(1);
    const otherSpelling = legalAttackCorpus().filter(([, s]) =>
      /before this attack does damage/i.test(s),
    );
    expect(otherSpelling).toHaveLength(1);
    expect(otherSpelling[0]?.[0]).toBe(2);
    expect(otherSpelling[0]?.[1]).toBe(
      "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.",
    );
    expect(resolvedByAnyReader(otherSpelling[0]?.[1] ?? "")).toBe(true);
    expect(deriveAttackPreDamage(otherSpelling[0]?.[1] ?? "")).toBeNull();
    expect(legalAttackCorpus().filter(([, s]) => /Pokémon Tool/.test(s))).toHaveLength(10);
  });

  it("THE PREFIX STRIPPER, PRICED: it would buy ZERO printings today", () => {
    // The measurement that decided design question ②. For each sentence opening with
    // the shared head, strip it and ask whether ANY live reader claims the remainder —
    // as printed, and re-capitalised, since the printed remainder starts lowercase.
    const openers = legalAttackCorpus().filter(([, s]) => s.startsWith(HEAD));
    expect(openers).toHaveLength(4);
    const bought = openers.filter(([, s]) => {
      const rest = s.slice(HEAD.length);
      const capped = rest.charAt(0).toUpperCase() + rest.slice(1);
      return resolvedByAnyReader(rest) || resolvedByAnyReader(capped);
    });
    expect(bought).toEqual([]);
    expect(resolvedByAnyReader("Your opponent's Active Pokémon is now Asleep.")).toBe(true);
  });

  it("the reader surface grew by ONE, and the sentence leaves BOTH residues together", () => {
    expect(attackReaderSurface()).toContain("deriveAttackPreDamage");
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
  });
});

describe("§2 — the derivation, and the boundaries the anchor holds", () => {
  it("derives the one closed shape, and its key set is exactly `kind`", () => {
    expect(deriveAttackPreDamage(SENTENCE)).toEqual({ kind: "discardOpponentActiveTools" });
    expect(Object.keys(deriveAttackPreDamage(SENTENCE) ?? {})).toEqual(["kind"]);
  });

  it("the U+2019 re-ingest derives IDENTICALLY, not merely non-null", () => {
    const curly = SENTENCE.replaceAll("'", "’");
    expect(curly).not.toBe(SENTENCE);
    expect(deriveAttackPreDamage(curly)).toEqual(deriveAttackPreDamage(SENTENCE));
  });

  it("the THREE SIBLINGS are now CLAIMED — and each still derives to its OWN member", () => {
    const siblings = legalAttackCorpus()
      .filter(([, s]) => s.startsWith(HEAD) && s !== SENTENCE)
      .map(([, s]) => s);
    expect(siblings).toHaveLength(3);
    expect(
      deriveAttackPreDamage(
        "Before doing damage, discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon.",
      ),
    ).toEqual({ kind: "discardOpponentActiveToolsAndSpecialEnergy" });
    // ② …the VICTIM changes and a cancel clause rides behind…
    expect(
      deriveAttackPreDamage(
        "Before doing damage, discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing.",
      ),
    ).toEqual({ kind: "discardOwnToolsElseCancel" });
    // ③ …and the CONSEQUENT grows a second sentence.
    expect(
      deriveAttackPreDamage(
        "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon. If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toEqual({ kind: "discardOpponentActiveToolsThenParalyze" });
    expect(deriveAttackPreDamage(SENTENCE)).toEqual({ kind: "discardOpponentActiveTools" });
    const kinds = [SENTENCE, ...siblings].map((s) => deriveAttackPreDamage(s)?.kind);
    expect(new Set(kinds).size).toBe(4);
    expect(deriveAttackPreDamage(`${HEAD}discard all Pokémon Tools from your Bench.`)).toBeNull();
  });

  it(" does not COMPOSE for free either — measured after the reader landed", () => {
    const compound = legalAttackCorpus().find(
      ([, s]) => s.startsWith(SENTENCE) && s !== SENTENCE,
    )?.[1];
    expect(compound).toBeDefined();
    expect(deriveAttackPreDamage(compound ?? "")).toEqual({
      kind: "discardOpponentActiveToolsThenParalyze",
    });
    expect(splitAttackTrailingClause(compound ?? "")).toBeNull();
    expect(
      deriveAttackEffect(
        "If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
    expect(resolvedByAnyReader(compound ?? "")).toBe(true);
  });

  it("THE REAL PRINTING: Klefki `sv01-096` has printed this sentence since D100", () => {
    expect(FIXTURE_POOL["sv01-096"]?.attacks?.[0]?.effect).toBe(SENTENCE);
    expect(FIXTURE_POOL["sv01-096"]?.attacks?.[0]?.damage).toBe(10);
    expect(FIXTURE_POOL["fix-toolstrip"]?.attacks?.[IDX.pry100]?.effect).toBe(SENTENCE);
    expect(FIXTURE_POOL["fix-toolstrip"]?.attacks?.[IDX.pry120]?.effect).toBe(SENTENCE);
    // The same-damage twins print NO effect at all — that is what makes §3's pair a
    // one-axis comparison.
    expect(FIXTURE_POOL["fix-toolstrip"]?.attacks?.[IDX.plain100]?.effect ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-toolstrip"]?.attacks?.[IDX.plain100]?.damage).toBe(100);
    expect(FIXTURE_POOL["fix-toolstrip"]?.attacks?.[IDX.plain120]?.effect ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-toolstrip"]?.attacks?.[IDX.plain120]?.damage).toBe(120);
  });
});

describe("§3 — the number MOVES, which is the whole claim", () => {
  it("Rock Chestplate: 100 → 70 with the Tool, 100 again once it is discarded", () => {
    // ONE board, ONE defender, TWO indices that differ ONLY in the printed sentence.
    // The control proves the Tool is really subtracting; the subject proves the
    // discard really precedes the subtraction.
    const withTool = board("fix-chestwall", CHESTPLATE);
    expect(dealt(swing(withTool, IDX.plain100).events)).toBe(70);
    expect(dealt(swing(withTool, IDX.pry100).events)).toBe(100);
  });

  it("…and a hook placed AFTER §8.5 would give 70 for BOTH — the delta is 30", () => {
    const withTool = board("fix-chestwall", CHESTPLATE);
    const control = dealt(swing(withTool, IDX.plain100).events) ?? 0;
    const subject = dealt(swing(withTool, IDX.pry100).events) ?? 0;
    expect(subject - control).toBe(30);
  });

  it("the Tool really leaves play, into its OWNER's discard pile", () => {
    const withTool = board("fix-chestwall", CHESTPLATE);
    const toolUid = withTool.players.p2.active?.tools[0];
    expect(toolUid).toBeDefined();
    const { state, events } = swing(withTool, IDX.pry100);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(state.players.p2.discard).toContain(toolUid);
    expect(state.players.p1.discard).not.toContain(toolUid);
    const row = findEvent(events, "TOOLS_DISCARDED");
    expect(row?.seat).toBe("p2");
    expect(row?.actor).toBe("p1");
    expect(row?.uids).toEqual([toolUid]);
    expect(row?.host).toBe(withTool.players.p2.active?.stack.at(-1));
  });

  it("the EVENT ORDER is the printed order: the discard row precedes DAMAGE_DEALT", () => {
    const { events } = swing(board("fix-chestwall", CHESTPLATE), IDX.pry100);
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("TOOLS_DISCARDED")).toBeGreaterThan(-1);
    expect(kinds.indexOf("TOOLS_DISCARDED")).toBeLessThan(kinds.indexOf("DAMAGE_DEALT"));
  });

  it("the log row says what this path makes true, and is filed under the ACTOR", () => {
    const withTool = board("fix-chestwall", CHESTPLATE);
    const { state, events } = swing(withTool, IDX.pry100);
    const rows = rendered(state, events);
    const row = rows.find((r) => r.text.includes(CHESTPLATE));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("discarded sv01-192 from Wren's fix-chestwall before doing damage");
    const at = (needle: string) => rows.findIndex((r) => r.text.includes(needle));
    expect(at(CHESTPLATE)).toBeLessThan(at("dealt 100 damage"));
    expect(at(CHESTPLATE)).toBeGreaterThan(at("used Pry Off"));
  });

  it("BOTH SEATS — the sentence names *your opponent's* Active, not p2's", () => {
    const mirrored = board("fix-chestwall", CHESTPLATE, "p2");
    expect(dealt(swing(mirrored, IDX.plain100, "p2").events)).toBe(70);
    const { state, events } = swing(mirrored, IDX.pry100, "p2");
    expect(dealt(events)).toBe(100);
    expect(state.players.p1.active?.tools).toEqual([]);
    expect(findEvent(events, "TOOLS_DISCARDED")?.seat).toBe("p1");
    expect(findEvent(events, "TOOLS_DISCARDED")?.actor).toBe("p2");
    // …and the ATTACKER's own Tools are untouched, which is the other half of "your
    // opponent's": give p2's attacker a Tool and it survives its own attack.
    const armed = attachToolFromDeck(mirrored, "p2", "active", CHESTPLATE);
    const after = swing(armed, IDX.pry100, "p2").state;
    expect(after.players.p2.active?.tools).toHaveLength(1);
  });
});

describe("§4 — discarding a Bravery Charm decides the Knock Out", () => {
  it("120 into a 100 HP Basic: the Charm SAVES it, and the discard takes it", () => {
    // 100 + 50 = 150, and the printed 120 falls BETWEEN the two maxima — so the only
    // difference between surviving and being Knocked Out is whether the Tool is still
    // attached when the §8.1 sweep reads `effectiveMaxHp`.
    const charmed = board("fix-charmwall", CHARM);
    const control = swing(charmed, IDX.plain120);
    expect(dealt(control.events)).toBe(120);
    expect(findEvent(control.events, "KNOCKED_OUT")).toBeUndefined();
    expect(control.state.players.p2.active?.damage).toBe(120);

    const subject = swing(charmed, IDX.pry120);
    expect(dealt(subject.events)).toBe(120);
    expect(findEvent(subject.events, "KNOCKED_OUT")).toBeDefined();
    // …and the dying stack takes the discarded Tool's uid with it exactly ONCE: the
    // pre-damage discard already moved it, so the KO's `discarded` list must not name
    // it again (a Tool cannot be in the pile twice).
    const toolUid = charmed.players.p2.active?.tools[0] ?? "";
    expect(findEvent(subject.events, "KNOCKED_OUT")?.discarded).not.toContain(toolUid);
    expect(subject.state.players.p2.discard.filter((u) => u === toolUid)).toHaveLength(1);
  });

  it("the same 120 into the same body with NO Tool is the same Knock Out — the control", () => {
    // Without this the rung above proves only "120 KOs a 100 HP body", which was
    // already true and says nothing about the discard.
    const bare = board("fix-charmwall", null);
    expect(findEvent(swing(bare, IDX.plain120).events, "KNOCKED_OUT")).toBeDefined();
    expect(findEvent(swing(bare, IDX.pry120).events, "KNOCKED_OUT")).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the no-Tool control, and the Tool whose discard changes nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — a silent no-op is silent, and an irrelevant Tool is still discarded", () => {
  it("a defender with NO Tool: no event, no row, and the damage is UNCHANGED", () => {
    const bare = board("fix-chestwall", null);
    const control = swing(bare, IDX.plain100);
    const subject = swing(bare, IDX.pry100);
    expect(dealt(control.events)).toBe(100);
    expect(dealt(subject.events)).toBe(100);
    expect(findEvent(subject.events, "TOOLS_DISCARDED")).toBeUndefined();
    expect(subject.events.filter((e) => e.type === "TOOLS_DISCARDED")).toEqual([]);
    // …and the state is `===`-identical through the pre-damage seam: the no-op does
    // not rebuild the side.
    expect(subject.state.players.p2.active?.tools).toEqual([]);
  });

  it("Vitality Band on the DEFENDER: discarded, and the damage does not move", () => {
    const banded = board("fix-chestwall", BAND);
    expect(dealt(swing(banded, IDX.plain100).events)).toBe(100);
    const { state, events } = swing(banded, IDX.pry100);
    expect(dealt(events)).toBe(100);
    expect(findEvent(events, "TOOLS_DISCARDED")).toBeDefined();
    expect(state.players.p2.active?.tools).toEqual([]);
  });

  it("TWO Tools on one body go together, in one row", () => {
    let two = board("fix-chestwall", CHESTPLATE);
    two = attachToolFromDeck(two, "p2", "active", CHARM);
    expect(two.players.p2.active?.tools).toHaveLength(2);
    const { state, events } = swing(two, IDX.pry100);
    expect(findEvent(events, "TOOLS_DISCARDED")?.uids).toHaveLength(2);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(state.players.p2.discard).toHaveLength(2);
    expect(events.filter((e) => e.type === "TOOLS_DISCARDED")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the loud path: nothing is skipped, in EITHER direction.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — ATTACK_EFFECT_SKIPPED, both directions", () => {
  it("the pre-damage indices are NOT reported as skipped", () => {
    const withTool = board("fix-chestwall", CHESTPLATE);
    expect(findEvent(swing(withTool, IDX.pry100).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(findEvent(swing(withTool, IDX.pry120).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    // …and on a board with nothing to discard either, so "simulated" is a property of
    // the SENTENCE and not of whether the act did anything.
    const bare = board("fix-chestwall", null);
    expect(findEvent(swing(bare, IDX.pry100).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("the ATTRIBUTION CONTROL — index 4's unread sentence IS still reported", () => {
    const bare = board("fix-chestwall", null);
    const skipped = findEvent(swing(bare, IDX.loud).events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe(LOUD_SENTENCE);
    expect(resolvedByAnyReader(LOUD_SENTENCE)).toBe(false);
    expect(legalAttackCorpus().filter(([, text]) => text === LOUD_SENTENCE)).toEqual([
      [1, LOUD_SENTENCE],
    ]);
  });

  it("Klefki's REAL printing is off the loud path too, and its 10 still lands", () => {
    const withTool = board("fix-chestwall", CHESTPLATE, "p1", "sv01-096");
    const { state, events } = swing(withTool, 0);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(findEvent(events, "TOOLS_DISCARDED")).toBeDefined();
    expect(dealt(events)).toBe(10);
    expect(state.players.p2.active?.tools).toEqual([]);
  });
});

describe("§7 — a pre-damage act cannot park, and the row that would is refused", () => {
  it("the pre-damage seam NEVER parks: the board is playable the instant it returns", () => {
    // The observable form of "the signature forbids it". If a pre-damage act could
    // park, the phase after the swing would be `effect:choose` and `pending` would be
    // non-empty — and the §8.5 pipeline would have had to survive it.
    for (const tool of [CHESTPLATE, CHARM, null]) {
      const { state } = swing(board("fix-chestwall", tool), IDX.pry100);
      expect(state.phase.kind, String(tool)).not.toBe("effect:choose");
      expect(state.pending, String(tool)).toEqual([]);
    }
  });

  it("the PARKING sibling is REFUSED, and the refusal is pinned on the POPULATION", () => {
    const parkers = legalAttackCorpus().filter(([, s]) => /Pokémon Tools? from/.test(s));
    expect(parkers.length).toBeGreaterThan(0);
    const claimed = legalAttackCorpus().filter(([, s]) => deriveAttackPreDamage(s) !== null);
    expect(claimed).toHaveLength(4);
    expect(claimed.map(([, s]) => s)).toContain(SENTENCE);
    for (const [, s] of claimed) {
      expect(/up to|you may|choose/i.test(s), s).toBe(false);
      expect(s.startsWith(HEAD), s).toBe(true);
    }
    const UP_TO_2 = "Discard up to 2 Pokémon Tools from your opponent's Pokémon.";
    expect(legalAttackCorpus().filter(([, s]) => s === UP_TO_2)).toHaveLength(1);
    expect(deriveAttackPreDamage(UP_TO_2)).toBeNull();
    expect(UP_TO_2.startsWith(HEAD)).toBe(false);
    expect(resolvedByAnyReader(UP_TO_2)).toBe(true);
    expect(deriveAttackEffect(UP_TO_2)).toEqual([{ op: "discardTools", count: 2 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — persistence: `MATCH_RECORD_VERSION` stays 26, driven both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — nothing persisted moves, and it is DRIVEN rather than argued", () => {
  it("`MATCH_RECORD_VERSION` STAYS 26 — no new field, no new op, no continuation", () => {
    const withTool = board("fix-chestwall", CHESTPLATE);
    const { state: after } = swing(withTool, IDX.pry100);
    expect(after.phase.kind).toBe("turn:action");
    expect(after.pending).toEqual([]);
    expect("cont" in after.phase).toBe(false);
    // The stripped body's key set, as a LITERAL rather than a diff, so "every body
    // grew a key" cannot hide inside a same-tree comparison (aquaWash's rule).
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
  });

  it("a v26 record round-trips BOTH DIRECTIONS through the swing", () => {
    const withTool = board("fix-chestwall", CHESTPLATE);
    const rehydrated = roundTrip(withTool);
    const live = swing(withTool, IDX.pry100);
    const replayed = swing(rehydrated, IDX.pry100);
    expect(JSON.stringify(replayed.events)).toBe(JSON.stringify(live.events));
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(live.state));
    const after = roundTrip(live.state);
    expect(JSON.stringify(after)).toBe(JSON.stringify(live.state));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — purity, and the version pin.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — purity and the version", () => {
  it("the swing mutates NOTHING it was given — a deep-frozen board resolves", () => {
    // Strict mode makes any write to a frozen object throw, so this is the whole
    // no-mutation claim rather than a sample of it. Driven on the board that DOES
    // discard, since that is the path that rebuilds a side.
    const frozen = deepFreeze(board("fix-chestwall", CHESTPLATE));
    const { state, events } = swing(frozen, IDX.pry100);
    expect(frozen.players.p2.active?.tools).toHaveLength(1);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(findEvent(events, "TOOLS_DISCARDED")).toBeDefined();
    // The reader is pure too — same input, equal output, and it does not memoise a
    // mutable object across calls.
    const first = deriveAttackPreDamage(SENTENCE);
    const second = deriveAttackPreDamage(SENTENCE);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
