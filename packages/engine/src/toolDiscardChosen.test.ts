import type { Card } from "@colorless/schema";
import { redactedEffectPromptSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effectTypes";
import {
  deriveAttackEffect,
  deriveAttackPreDamage,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameEvent } from "./events";
import { applyAction, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  mustApply,
  setActiveFromDeck,
  types,
  driveSetup,
  roundTrip,
} from "./testFixtures";
import { present } from "./fixtures/values";

const SENTENCE = "Discard up to 2 Pokémon Tools from your opponent's Pokémon.";

/** The program the sentence derives to. ONE op; the ceiling is a CAPTURE. */
const PROGRAM: readonly EffectOp[] = [{ op: "discardTools", count: 2 }];

const STRIP = 0; // {C}, no damage — the sentence
const PLAIN = 1; // {C}, no damage, NO effect — the one-axis control
const HAMMER = 2; // {C}, no damage — the shipped ENERGY discard, the disjointness control

const LOCAL_CARDS: Record<string, Card> = {
  "d543-stripper": battler("d543-stripper", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Tool Strip", effect: SENTENCE },
      { cost: ["Colorless"], name: "Plain Call" },
      {
        cost: ["Colorless"],
        name: "Hammer Time",
        effect: "Discard an Energy from your opponent's Active Pokémon.",
      },
    ],
  }),
  /** The victims. TWO distinct ids, because §4's whole claim is that the strip
      reaches BOTH bodies and a single id could not tell one board from two. */
  "d543-wall": battler("d543-wall", { types: ["Colorless"], hp: 300, retreat: 1 }),
  "d543-bench": battler("d543-bench", { types: ["Colorless"], hp: 300, retreat: 1 }),
  /** TWO distinct Tools, for the same reason: §4 reads the moved uids back
      individually and a pair of identical cards could not tell a strip of one
      from a strip of both. */
  "d543-tool-a": { ...FIXTURE_POOL["fix-tool"], id: "d543-tool-a", name: "d543-tool-a" } as Card,
  "d543-tool-b": { ...FIXTURE_POOL["fix-tool"], id: "d543-tool-b", name: "d543-tool-b" } as Card,
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const TOOL_DECK = deckOf({
  "d543-stripper": 4,
  "d543-wall": 4,
  "d543-bench": 4,
  "d543-tool-a": 4,
  "d543-tool-b": 4,
  "fix-basic-1": 8,
  "fix-energy": 32,
});

const SHIELD_DECK = deckOf({
  "d543-stripper": 4,
  "d543-wall": 4,
  "d543-bench": 4,
  "d543-tool-a": 4,
  "d543-tool-b": 4,
  "fix-basic-1": 8,
  "fix-energy": 28,
  "fix-mist-energy": 4,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260923;

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function localSetup(seed: number, first: Seat, deck: string[] = TOOL_DECK): GameState {
  return driveSetup(seed, { p1: deck, p2: deck }, { pool: POOL, first });
}

function ready(
  opts: {
    tools?: readonly [string | null, string | null];
    benched?: boolean;
    attacker?: Seat;
    seed?: number;
    ownTool?: string | null;
    shieldActive?: boolean;
    /** Mist Energy onto the VICTIM's benched body at index 0. */
    shieldBench?: boolean;
  } = {},
): GameState {
  const { tools = ["d543-tool-a", "d543-tool-b"], attacker = "p1", seed = SEED } = opts;
  const benched = opts.benched ?? tools[1] !== null;
  const shielded = opts.shieldActive === true || opts.shieldBench === true;
  const opponent = other(attacker);
  let state = localSetup(seed, attacker, shielded ? SHIELD_DECK : TOOL_DECK);
  state = mustApply(state, { type: "endTurn", seat: attacker }).state;
  state = mustApply(state, { type: "endTurn", seat: opponent }).state;
  state = setActiveFromDeck(state, attacker, "d543-stripper");
  state = attachFromDeck(state, attacker, "fix-energy", 1);
  state = clearBench(state, attacker);
  if (opts.ownTool != null) state = attachToolFromDeck(state, attacker, "active", opts.ownTool);
  state = setActiveFromDeck(state, opponent, "d543-wall");
  state = clearBench(state, opponent);
  if (benched) state = benchFromDeck(state, opponent, "d543-bench");
  if (tools[0] !== null) state = attachToolFromDeck(state, opponent, "active", tools[0]);
  if (tools[1] !== null) state = attachToolFromDeck(state, opponent, 0, tools[1]);
  if (opts.shieldActive === true) state = attachFromDeck(state, opponent, "fix-mist-energy", 1);
  if (opts.shieldBench === true)
    state = attachBenchFromDeck(state, opponent, 0, "fix-mist-energy", 1);
  return state;
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected the park, got ${state.phase.kind}`);
  }
  const prompt = state.phase.prompt;
  if (prompt.kind !== "discardTools") throw new Error(`expected discardTools, got ${prompt.kind}`);
  return prompt;
}

function answerWith(state: GameState, seat: Seat, uids: readonly string[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat,
    choice: { kind: "discardTools", uids: [...uids] },
  } satisfies GameAction);
}

/** Every Tool uid on `seat`'s board, Active first then the Bench — the zone under
    test, read as a whole so "the wrong body lost it" cannot hide. */
function toolsOf(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  return [...(side.active?.tools ?? []), ...side.bench.flatMap((b) => b.tools)];
}

function rowText(state: GameState, events: GameEvent[], needle: string): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes(needle)),
  );
  if (row === undefined || row.kind !== "action") throw new Error(`no row mentioning ${needle}`);
  return row.segments.map((s) => s.text).join("");
}

describe("§1 — the anchor, and the near-misses it refuses", () => {
  it("derives to ONE op whose count is the CAPTURED ceiling", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual(PROGRAM);
  });

  it("THE COUNT IS A CAPTURE AND NOT THE LITERAL 2 — the D231 rung", () => {
    expect(
      deriveAttackEffect("Discard up to 1 Pokémon Tools from your opponent's Pokémon."),
    ).toEqual([{ op: "discardTools", count: 1 }]);
    expect(
      deriveAttackEffect("Discard up to 3 Pokémon Tools from your opponent's Pokémon."),
    ).toEqual([{ op: "discardTools", count: 3 }]);
    expect(
      deriveAttackEffect("Discard up to 12 Pokémon Tools from your opponent's Pokémon."),
    ).toEqual([{ op: "discardTools", count: 12 }]);
    // …and a count the arm refuses rather than parking an empty decision.
    expect(
      deriveAttackEffect("Discard up to 0 Pokémon Tools from your opponent's Pokémon."),
    ).toBeNull();
  });

  it("BOTH TRAILING NEAR-MISSES ARE KEPT — they refuse for two DIFFERENT reasons", () => {
    const glued = `${SENTENCE} Then, draw a card.`;
    const stripped = `${SENTENCE.slice(0, -1)} and shuffle your deck.`;
    expect(deriveAttackEffect(glued)).toBeNull();
    expect(deriveAttackEffect(stripped)).toBeNull();
    const noDollar = /^Discard up to (\d+) Pokémon Tools from your opponent['’]s Pokémon\./;
    expect(noDollar.test(glued)).toBe(true);
    expect(noDollar.test(stripped)).toBe(false);
    expect(glued.startsWith(SENTENCE)).toBe(true);
    expect(stripped.startsWith(SENTENCE)).toBe(false);
  });

  it("the CARET is load-bearing too — a prefix that keeps the capital is refused", () => {
    expect(
      deriveAttackEffect(
        "Flip a coin. Discard up to 2 Pokémon Tools from your opponent's Pokémon.",
      ),
    ).toBeNull();
  });

  it("NO `/i` — the printed capital is load-bearing", () => {
    expect(
      deriveAttackEffect("discard up to 2 Pokémon Tools from your opponent's Pokémon."),
    ).toBeNull();
  });

  it("the NEIGHBOURING TOOL SENTENCES are refused — disjointness, MEASURED", () => {
    const others = legalAttackCorpus()
      .filter(([, s]) => /Pokémon Tool/.test(s) && s !== SENTENCE)
      .map(([, s]) => s);
    expect(others.length).toBe(9);
    for (const s of others) {
      const ops = deriveAttackEffect(s);
      expect(ops?.some((op) => op.op === "discardTools") ?? false, s).toBe(false);
    }
    // …and this sentence is claimed by NO other reader and NO splitter: it is a RAW
    // whole-sentence claim, which is why `SPLIT_ATTACK_UNITS` and
    // `COMPOUND_ATTACK_UNITS` do not move.
    expect(deriveAttackPreDamage(SENTENCE)).toBeNull();
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
  });

  it("the sentence is claimed WHOLE and not through a tail split", () => {
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
  });
});

describe("§2 — the single `['’]` slot, and the control that reads the LIVE row", () => {
  it("the CURLED board derives identically — the class earns its keep", () => {
    const curled = SENTENCE.split("'").join("’");
    expect(curled).not.toBe(SENTENCE);
    expect(deriveAttackEffect(curled)).toEqual(PROGRAM);
  });

  it("THE CONTROL READS THE CODE POINTS OFF THE LIVE CORPUS ROW, NOT OFF THIS SUITE", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === SENTENCE);
    expect(rows).toHaveLength(1);
    const live = rows[0]?.[1] as string;
    // ONE apostrophe slot, at index 48, and it is U+0027 on this checkout.
    const slots = [...live].flatMap((c, i) => (c === "'" || c === "’" ? [i] : []));
    expect(slots).toEqual([48]);
    expect(live.codePointAt(48)).toBe(0x0027);
    // …and `é` is a literal U+00E9 at 19 and 54 — no combining sequence, which the
    // anchor's own literal depends on.
    expect(live.codePointAt(19)).toBe(0x00e9);
    expect(live.codePointAt(54)).toBe(0x00e9);
    expect(live).toHaveLength(59);
  });

  it("a DECOMPOSED `é` is refused — the literal is precomposed", () => {
    const decomposed = SENTENCE.normalize("NFD");
    expect(decomposed).not.toBe(SENTENCE);
    expect(deriveAttackEffect(decomposed)).toBeNull();
  });
});

describe("§3 — the empty board asks nothing at all", () => {
  it("the ONE-AXIS CONTROL: the same body, the attack with NO printed effect", () => {
    // Every board below differs from this one by the ATTACK INDEX alone, so a park
    // that showed up here would be coming from the fixture rather than the sentence.
    const start = ready();
    const { state, events } = attack(start, PLAIN);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("TOOLS_DISCARDED");
    expect(toolsOf(state, "p2")).toEqual(toolsOf(start, "p2"));
  });

  it("an opponent wearing NO Tool: no park, no `TOOLS_DISCARDED`, no row", () => {
    const start = ready({ tools: [null, null], benched: true });
    const { state, events } = attack(start, STRIP);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.pending).toEqual([]);
    expect(types(events)).not.toContain("TOOLS_DISCARDED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    // …and nothing crossed a zone boundary but the turn-end draw.
    expect(state.players.p2.discard).toEqual(start.players.p2.discard);
    expect(toolsOf(state, "p2")).toEqual([]);
  });

  it("the ATTACKER's OWN Tool is never offered — one printed zone, and it is theirs", () => {
    // The op has no `from` field because one zone is printed. This is the rung that
    // makes the absence observable: a Tool on the ATTACKER's own Active, and the
    // opponent bare, still asks nothing.
    const start = ready({ tools: [null, null], benched: false, ownTool: "d543-tool-a" });
    expect(start.players.p1.active?.tools).toHaveLength(1);
    const { state, events } = attack(start, STRIP);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("TOOLS_DISCARDED");
    expect(state.players.p1.active?.tools).toHaveLength(1);
  });

  it("THE CHEAP BUILD'S FAILURE, DRIVEN FROM OUTSIDE: the ENERGY discard sees no Tool", () => {
    const start = ready();
    expect(start.players.p2.active?.tools).toHaveLength(1);
    expect(start.players.p2.active?.energy).toEqual([]);
    const hammered = attack(start, HAMMER);
    expect(hammered.state.phase.kind).not.toBe("effect:choose");
    expect(types(hammered.events)).not.toContain("ENERGY_DISCARDED");
    expect(toolsOf(hammered.state, "p2")).toHaveLength(2);
    expect(parkedPrompt(attack(start, STRIP).state).discardable).toHaveLength(2);
  });

  it("ONE offered Tool still ASKS — `parkOrForce`'s ceiling rule (D359)", () => {
    // There is no forced pick when 0 is always legal, so an offer of ONE is a real
    // question and NOT the "a choice with no choice in it" case. This is the rung
    // that separates this op from every mandatory discard beside it.
    const start = ready({ tools: ["d543-tool-a", null], benched: false });
    const { state } = attack(start, STRIP);
    const prompt = parkedPrompt(state);
    expect(prompt.discardable).toHaveLength(1);
    expect(prompt.scope).toEqual({ kind: "upTo", max: 1 });
  });

  it("`max` IS CLAMPED TO THE OFFER, not left at the printed 2", () => {
    const start = ready({ tools: ["d543-tool-a", null], benched: true });
    expect(parkedPrompt(attack(start, STRIP).state).scope).toEqual({ kind: "upTo", max: 1 });
    const both = ready();
    expect(parkedPrompt(attack(both, STRIP).state).scope).toEqual({ kind: "upTo", max: 2 });
  });
});

describe("§4 — the answer strips BOTH bodies and fills the OWNER's discard pile", () => {
  it("two hosts, two Tools, one answer — both `tools` arrays empty, both cards in the pile", () => {
    const start = ready();
    const activeTool = start.players.p2.active?.tools[0] as string;
    const benchTool = start.players.p2.bench[0]?.tools[0] as string;
    expect(activeTool).not.toBe(benchTool);
    const parked = attack(start, STRIP);
    const prompt = parkedPrompt(parked.state);
    expect(prompt.discardable.map((d) => d.uid)).toEqual([activeTool, benchTool]);
    // Board order: Active first, then the Bench by index.
    expect(prompt.discardable[0]?.from).toEqual({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.discardable[1]?.from).toEqual({ seat: "p2", spot: { spot: "bench", index: 0 } });

    const { state, events } = answerWith(parked.state, "p1", [activeTool, benchTool]);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(state.players.p2.bench[0]?.tools).toEqual([]);
    expect(state.players.p2.discard).toContain(activeTool);
    expect(state.players.p2.discard).toContain(benchTool);
    // §7.4 — a Tool goes to its OWN controller's pile, never the attacker's.
    expect(state.players.p1.discard).not.toContain(activeTool);
    expect(state.players.p1.discard).not.toContain(benchTool);
    const rows = all(events, "TOOLS_DISCARDED");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.uids)).toEqual([[activeTool], [benchTool]]);
    expect(rows.map((r) => r.seat)).toEqual(["p2", "p2"]);
    expect(rows.map((r) => r.actor)).toEqual(["p1", "p1"]);
    expect(rows.map((r) => r.when)).toEqual(["effect", "effect"]);
  });

  it("A PARTIAL ANSWER TAKES EXACTLY WHAT IT NAMED — the other host keeps its Tool", () => {
    const start = ready();
    const activeTool = start.players.p2.active?.tools[0] as string;
    const benchTool = start.players.p2.bench[0]?.tools[0] as string;
    const parked = attack(start, STRIP);
    const { state, events } = answerWith(parked.state, "p1", [benchTool]);
    expect(state.players.p2.active?.tools).toEqual([activeTool]);
    expect(state.players.p2.bench[0]?.tools).toEqual([]);
    expect(state.players.p2.discard).toContain(benchTool);
    expect(state.players.p2.discard).not.toContain(activeTool);
    expect(all(events, "TOOLS_DISCARDED")).toHaveLength(1);
  });

  it("TWO TOOLS ON ONE BODY collapse to ONE event row, because `host` is one uid", () => {
    let start = ready({ tools: ["d543-tool-a", null], benched: false });
    start = attachToolFromDeck(start, "p2", "active", "d543-tool-b");
    const [t1, t2] = present(start.players.p2.active).tools as [string, string];
    const parked = attack(start, STRIP);
    expect(parkedPrompt(parked.state).scope).toEqual({ kind: "upTo", max: 2 });
    const { state, events } = answerWith(parked.state, "p1", [t1, t2]);
    const rows = all(events, "TOOLS_DISCARDED");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.uids).toEqual([t1, t2]);
    expect(state.players.p2.active?.tools).toEqual([]);
  });

  it("the ANSWERER is the ATTACKER — the pick is the attacking player's", () => {
    // The printed subject is "you": the controller chooses which of the opponent's
    // Tools go. So the prompt is controller-answered and the OPPONENT cannot reply.
    const parked = attack(ready(), STRIP);
    const uid = parkedPrompt(parked.state).discardable[0]?.uid as string;
    const wrongSeat = applyAction(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "discardTools", uids: [uid] },
    });
    expect(wrongSeat.ok).toBe(false);
  });

  it("a uid that was NOT offered is refused, and so is the same uid twice", () => {
    const start = ready();
    const activeTool = start.players.p2.active?.tools[0] as string;
    const parked = attack(start, STRIP).state;
    for (const uids of [["not-a-uid"], [activeTool, activeTool]]) {
      const res = applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardTools", uids },
      });
      expect(res.ok, uids.join(",")).toBe(false);
    }
  });

  it("AN ANSWER LONGER THAN `max` IS REFUSED, WITH EVERY UID OFFERED", () => {
    let start = ready({ tools: ["d543-tool-a", "d543-tool-b"] });
    start = attachToolFromDeck(start, "p2", "active", "d543-tool-b");
    const parked = attack(start, STRIP).state;
    const prompt = parkedPrompt(parked);
    expect(prompt.discardable).toHaveLength(3);
    expect(prompt.scope).toEqual({ kind: "upTo", max: 2 });
    const offered = prompt.discardable.map((d) => d.uid);
    const tooMany = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardTools", uids: offered },
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error.code).toBe("BAD_EFFECT_CHOICE");
    // …and exactly `max` of the same offered uids IS accepted, so the refusal above
    // is the ceiling rather than anything about the uids themselves.
    const atCap = answerWith(parked, "p1", offered.slice(0, 2));
    expect(toolsOf(atCap.state, "p2")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE DECLINE. An empty answer is LEGAL and files nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the decline, which is an answer and not a whiff", () => {
  it("the EMPTY answer is accepted and files NO `TOOLS_DISCARDED`", () => {
    const start = ready();
    const parked = attack(start, STRIP);
    const { state, events } = answerWith(parked.state, "p1", []);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("TOOLS_DISCARDED");
    // Both Tools stayed exactly where they were, and no pile grew.
    expect(toolsOf(state, "p2")).toEqual(toolsOf(start, "p2"));
    expect(state.players.p2.discard).toEqual(start.players.p2.discard);
    expect(state.players.p1.discard).toEqual(parked.state.players.p1.discard);
  });

  it("the decline leaves NO log row for this event at all", () => {
    const parked = attack(ready(), STRIP);
    const { state, events } = answerWith(parked.state, "p1", []);
    const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
    const rows = logFromEvents(events, ctx);
    for (const row of rows) {
      if (row.kind !== "action") continue;
      expect(row.segments.map((s) => s.text).join("")).not.toContain("discarded ");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE WIRE. redact → safeParse → field-for-field, INCLUDING the `upTo` scope.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the wire carries the prompt, scope included", () => {
  it("the ANSWERER's wire prompt is the engine prompt, field for field", () => {
    const parked = attack(ready(), STRIP).state;
    const engine = parkedPrompt(parked);
    const wire = redactGame(parked, "p1");
    if (wire.phase.kind !== "effect:choose" || wire.phase.prompt === null) {
      throw new Error("expected a wire prompt");
    }
    const sent = wire.phase.prompt;
    const parsed = redactedEffectPromptSchema.safeParse(sent);
    expect(parsed.success).toBe(true);
    expect(sent).toEqual(engine);
    if (sent.kind !== "discardTools") throw new Error("expected discardTools on the wire");
    expect(sent.scope).toEqual({ kind: "upTo", max: 2 });
  });

  it("the NO-ALIAS purity contract holds for the new member", () => {
    const parked = attack(ready(), STRIP).state;
    const engine = parkedPrompt(parked);
    const wire = redactGame(parked, "p1");
    if (wire.phase.kind !== "effect:choose" || wire.phase.prompt === null) {
      throw new Error("expected a wire prompt");
    }
    const sent = wire.phase.prompt;
    if (sent.kind !== "discardTools") throw new Error("expected discardTools on the wire");
    expect(sent.scope).not.toBe(engine.scope);
    expect(sent.discardable).not.toBe(engine.discardable);
    expect(sent.discardable[0]).not.toBe(engine.discardable[0]);
    expect(sent.discardable[0]?.from).not.toBe(engine.discardable[0]?.from);
  });

  it("the NON-answerer is told nothing — controller-answered, like its sibling", () => {
    const parked = attack(ready(), STRIP).state;
    const theirs = redactGame(parked, "p2");
    if (theirs.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(theirs.phase.prompt).toBeNull();
  });

  it("the wire prompt union now has ELEVEN members and `discardTools` is one ( D548: TWELVE — `choosePrize` joined; D577: THIRTEEN — `guessHp` joined; re-read off `.options`, not counted)", () => {
    const kinds = redactedEffectPromptSchema.options.map((o) => o.shape.kind.value);
    expect(kinds).toHaveLength(13);
    expect(kinds).toContain("discardTools");
  });
});

describe("§7 — `MATCH_RECORD_VERSION` HOLDS AT 30 ( held at THIS slice; 31 since D547; 32 since D548; 33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570; 38 since D575; 39 since D576; 40 since D577; 41 since D579; 42 since D583; 43 since D621; 44 since D630; 45 since D636; 46 since D637; 47 since D640; 48 since D643; 49 since D646), driven rather than argued", () => {
  it('`"cont" in phase` IS TRUE — a record really holds the new inhabitant', () => {
    const parked = attack(ready(), STRIP).state;
    expect("cont" in parked.phase).toBe(true);
    expect(JSON.stringify(parked)).toContain('"op":"discardTools","count":2');
  });

  it("DIRECTION 1 — the parked program survives a JSON round trip and resolves", () => {
    const parked = attack(ready(), STRIP).state;
    const revived = roundTrip(parked);
    const uids = parkedPrompt(revived).discardable.map((d) => d.uid);
    const { state, events } = answerWith(revived, "p1", uids);
    expect(all(events, "TOOLS_DISCARDED")).toHaveLength(2);
    for (const uid of uids) expect(state.players.p2.discard).toContain(uid);
  });

  it("DIRECTION 2 — every byte this slice writes is a NEW INHABITANT, never a rename", () => {
    const parked = attack(ready(), STRIP).state;
    const bytes = JSON.stringify(parked);
    expect(bytes).toContain('"discardTools"');
    const hammer = attack(ready({ tools: [null, null], benched: false }), HAMMER).state;
    expect(JSON.stringify(hammer)).not.toContain("discardTools");
    // …and the non-parking board writes nothing at all.
    const quiet = attack(ready({ tools: [null, null], benched: true }), STRIP).state;
    expect("cont" in quiet.phase).toBe(false);
    expect(JSON.stringify(quiet)).not.toContain("discardTools");
  });

  it("the op is PURE — the parked board is not mutated by resolving it", () => {
    const parked = deepFreeze(attack(ready(), STRIP).state);
    const snapshot = JSON.stringify(parked);
    answerWith(
      parked,
      "p1",
      parkedPrompt(parked).discardable.map((d) => d.uid),
    );
    expect(JSON.stringify(parked)).toBe(snapshot);
  });
});

describe("§8 — the population, the log row, and the version", () => {
  it("THE POPULATION: this op is authored by EXACTLY ONE corpus sentence", () => {
    const claimed = legalAttackCorpus().filter(([, s]) =>
      (deriveAttackEffect(s) ?? []).some((op) => op.op === "discardTools"),
    );
    expect(claimed.map(([, s]) => s)).toEqual([SENTENCE]);
  });

  it('THE LOG ROW DOES *NOT* SAY “before doing damage” — `when: "effect"`', () => {
    const start = ready();
    const parked = attack(start, STRIP);
    const { state, events } = answerWith(parked.state, "p1", [
      start.players.p2.active?.tools[0] as string,
    ]);
    const text = rowText(state, events, "discarded ");
    expect(text).toContain("discarded ");
    expect(text).toContain("Tide's");
    expect(text).not.toContain("before doing damage");
  });
});

describe("§9 — a Mist Energy holder is not OFFERED, and the rest still strip", () => {
  it("the shielded BENCHED body is dropped from `discardable` and the Active stays pickable", () => {
    const start = ready({ shieldBench: true });
    const activeTool = start.players.p2.active?.tools[0] as string;
    const benchTool = start.players.p2.bench[0]?.tools[0] as string;
    const parked = attack(start, STRIP);
    // A FILTER, not a guard: the op still asks, on the body that was not shielded.
    const prompt = parkedPrompt(parked.state);
    expect(prompt.discardable.map((d) => d.uid)).toEqual([activeTool]);
    expect(prompt.scope).toEqual({ kind: "upTo", max: 1 });
    expect(all(parked.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(all(parked.events, "ATTACK_EFFECT_PREVENTED")[0]?.seat).toBe("p2");
    // …and the answer reaches the unshielded host while the shielded one KEEPS its Tool.
    const { state } = answerWith(parked.state, "p1", [activeTool]);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(state.players.p2.bench[0]?.tools).toEqual([benchTool]);
    expect(state.players.p2.discard).not.toContain(benchTool);
  });

  it("the shielded ACTIVE body is dropped, and the BENCH is still stripped", () => {
    const start = ready({ shieldActive: true });
    const activeTool = start.players.p2.active?.tools[0] as string;
    const benchTool = start.players.p2.bench[0]?.tools[0] as string;
    const parked = attack(start, STRIP);
    const prompt = parkedPrompt(parked.state);
    expect(prompt.discardable.map((d) => d.uid)).toEqual([benchTool]);
    expect(all(parked.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    const { state } = answerWith(parked.state, "p1", [benchTool]);
    expect(state.players.p2.bench[0]?.tools).toEqual([]);
    expect(state.players.p2.active?.tools).toEqual([activeTool]);
  });

  it("BOTH shielded — a SILENT no-op with TWO refusals, no park and no `TOOLS_DISCARDED`", () => {
    const { state, events } = attack(ready({ shieldActive: true, shieldBench: true }), STRIP);
    expect(all(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(2);
    expect(types(events)).not.toContain("TOOLS_DISCARDED");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(toolsOf(state, "p2")).toHaveLength(2);
  });

  it("A SHIELDED BODY WEARING NO TOOL FILES NO REFUSAL AT ALL — the ORDER rung", () => {
    const { events } = attack(ready({ tools: [null, "d543-tool-b"], shieldActive: true }), STRIP);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(all(events, "TOOLS_DISCARDED")).toHaveLength(0); // it parked, it did not fire
  });

  it("THE ADMISSION CONTROL — the SAME board unshielded offers BOTH hosts", () => {
    const start = ready({ shieldBench: true });
    const control = ready();
    expect(toolsOf(start, "p2")).toHaveLength(2);
    expect(toolsOf(start, "p2")).toEqual(toolsOf(control, "p2"));
    const prompt = parkedPrompt(attack(control, STRIP).state);
    expect(prompt.discardable).toHaveLength(2);
    expect(prompt.scope).toEqual({ kind: "upTo", max: 2 });
    expect(types(attack(control, STRIP).events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});
