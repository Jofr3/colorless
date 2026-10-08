import type { Card } from "@luminous/schema";
import { redactedEffectPromptSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import {
  deriveAttackEffect,
  deriveAttackPreDamage,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
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
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕🆕 D543 — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL.
//
//   "Discard up to 2 Pokémon Tools from your opponent's Pokémon."
//
// **1 sentence / 2 legal printings** — `censusAttackCorpus.ts` **file line 136**,
// leading count column **2**. The last unresolved row of the `/Pokémon Tool/`
// sweep, named as UNBUILT in five in-tree places since D406 and closed here.
//
// 🛑 **WHAT THIS ROW COSTS, SAID AT THE TOP.** ONE new `EffectOp` member
// (`discardTools`), ONE new `EffectPrompt` kind, ONE new `EffectChoice` member,
// ONE new wire prompt member (the ELEVENTH), TWO new dialogs — and, as a hard
// PREREQUISITE rather than a rider, the `upTo` `DiscardScope` member the wire
// never had. ZERO new readers (`attackReaderSurface()` stays 13), ZERO registry
// rows, ZERO `GameState`/`InPlayPokemon` fields, ZERO `MATCH_RECORD_VERSION`
// bytes.
//
// 🛑 **THE CHEAP BUILD TYPECHECKS AND IS A SILENT NO-OP, WHICH IS WHY THE PRICE IS
// WRITTEN DOWN IN CODE AND NOT ONLY IN PROSE.**
// `discardEnergy { filter: { kind: "toolCard" } }` compiles and returns ZERO
// candidates on every board that can exist, because `attachedEnergies` walks
// `pokemon.energy` and a Tool lives in `pokemon.tools`. §3 drives that fact from
// the outside: a board with Tools and no matching Energy offers nothing.
//
// 🛑 **THE ONE SITE NO EXHAUSTIVENESS CHECK CAN SEE IS WHAT §4 EXISTS FOR.**
// `applyChoice`'s `switch` ends `default: return state;` — *"Synchronous ops never
// park, so never reach the choice path"* — so DELETING `case "discardTools"` there
// silently discards the player's answer: the op parks, the prompt is answered, the
// board comes back unchanged, and no event, no log row and no census figure moves.
// ⚠️ **THE UNQUALIFIED *"typechecks GREEN"* SPELLING OF THAT SENTENCE IS WITHDRAWN**
// (it stood three lines above its own withdrawal until the landing review found it):
// on today's bytes `tsc` does NOT exit 0 — see the measurement below. What is true is
// that NO EXHAUSTIVENESS CHECK NAMES THE MISSING ARM, and the one diagnostic that
// does fire is incidental and would vanish the moment the op had a second consumer.
//
// 🛑 **MEASURED RATHER THAN ARGUED (D429) — AND THE MEASUREMENT HAS BEEN WRONG
// TWICE, SO BOTH SPELLINGS ARE STRUCK HERE RATHER THAN OVERWRITTEN.**
// ~~*"deleting that arm and running `bunx tsc -b --force` prints NOTHING"*~~ (the
// brief's prediction), then ~~*"it prints exactly ONE line,
// `interpreter.ts(14393,10)`"*~~ (this slice's own first correction, wrong in BOTH
// halves). Re-run on the shipped bytes — delete the whole `case "discardTools":`
// block in `applyChoice`, `bunx tsc -b --force`, **exit 2** — it prints **FOUR
// IDENTICAL LINES, one per project that compiles the file**:
//   `packages/engine/src/interpreter.ts(14404,10): error TS6133: 'toolDiscardApply' is declared but its value is never read.`
// ⚠️ `14393` could not have matched ANY spelling of that arm: the reported line is
// `function toolDiscardApply`'s own line MINUS the arm's length, and the two move
// together when the arm's comment grows, so the figure is invariant to the prose.
// ⚠️ **THAT IS NOT AN EXHAUSTIVENESS ERROR AND IT CANNOT SEE THE MISSING ARM** — it is
// `noUnusedLocals` noticing that the arm is the only caller of the apply helper, an
// accident of the op having ONE consumer today which a second caller would erase.
// The surviving claim is the CONTRAST, and it is the one that matters: deleting
// `stepOp`'s own `case "discardTools":` block prints, ×4 for the same four projects,
//   `packages/engine/src/interpreter.ts(1843,4): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.`
// — a real exhaustiveness failure AT THE FUNCTION (beside two more incidental TS6133
// orphans, `toolDiscardNote` and `discardableTools`) — while nothing at all reports a
// parking op whose ANSWER is silently dropped. A FORCED-path rung cannot kill it —
// this op has no forced path at all — so §4 drives the PARKED ≥2-offer path
// through `resolveEffect` and asserts BOTH victims' `tools` arrays and the
// victim's discard pile, never the op's shape (D421).
//
// ⚠️ **NO CARD ID RESOLVES FOR THIS SENTENCE ON THIS CHECKOUT AND THAT WAS
// MEASURED** — **NO CATALOG ROW**, and `registry.ts` has no entry. So this suite
// rides file-local DECLARED demonstrators `d543-*` (D425) in their OWN 60-card
// decks (D270).
// ⚠️ **THE SWEEP SURFACE WAS RE-MEASURED RATHER THAN INHERITED, AND THE BRIEF'S
// FIGURE WAS WRONG IN BOTH DIRECTIONS.** At the BASE HEAD `git grep -nF` over the
// printed bytes returns **SEVEN** non-`docs/` sites, not eight:
// `censusAttackCorpus.ts:136`, `effects.ts:35036`, `index.ts:17863`,
// `preDamageFamily.test.ts:328`/`:869`/`:877` and
// `preDamageToolDiscard.test.ts:644`. 🛑 **THE EIGHTH — `effects.ts:17632`'s
// near-miss list — IS REAL AND THE GREP CANNOT SEE IT**, because the sentence is
// WRAPPED across a `//` line break there: a claim inside a wrapped comment is
// findable only by a key SHORTER than the wrap (D542). So the sweep also ran on
// `stays UNBUILT`, `still REFUSED`, `up to 2`, `stillLoud` and the neighbours of
// every anchor. ⚠️ **AND THAT COUNT DOES NOT SURVIVE THIS SLICE**: the version
// tax's annotation comments quote the sentence, so the same grep at THIS head
// returns 152 — which is why the number is stated with the head it was measured
// at instead of being carried forward as a standing fact.

const SENTENCE = "Discard up to 2 Pokémon Tools from your opponent's Pokémon.";

/** The program the sentence derives to. ONE op; the ceiling is a CAPTURE. */
const PROGRAM: readonly EffectOp[] = [{ op: "discardTools", count: 2 }];

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(
  ["./{censusAttackCorpus,interpreter}.ts", "../../../apps/api/src/lobby/match.ts"],
  { query: "?raw", import: "default", eager: true },
);
const raw = (suffix: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(suffix))?.[1] ?? "";

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

/** Its OWN deck (D270): counted by the helper rather than in prose, because 60 is
    a `createGame` precondition and a miscount is a mulligan storm, not a red rung. */
const TOOL_DECK = deckOf({
  "d543-stripper": 4,
  "d543-wall": 4,
  "d543-bench": 4,
  "d543-tool-a": 4,
  "d543-tool-b": 4,
  "fix-basic-1": 8,
  "fix-energy": 32,
});

/** 🛑 **§11's deck, and it is A SEPARATE DECK RATHER THAN AN EDIT OF THE ONE
    ABOVE** — `testFixtures.ts`' standing rule, the one D412 paid for: `deckOf` order
    feeds the shuffle, so swapping one line in a seed-pinned deck reshuffles every
    board in this file and would move rungs that have nothing to do with the shield.
    Four `fix-energy` become four `fix-mist-energy`; the total is still 60 (D270).

    ⚠️ **`fix-mist-energy` IS THE §11 DISCRIMINATOR AND IT IS AN ENERGY, NOT A
    SHIELDED POKÉMON** — `OPPONENT_ENERGY_MOVE_DECK`'s reason verbatim: it prints
    *"Prevent all effects of attacks used by your opponent's Pokémon done to the
    Pokémon this card is attached to"*, so one card raises the shield on a CHOSEN
    opponent body without changing the board's shape between the shielded and
    unshielded runs. That is what makes the admission control at the foot of §9 a
    real control (D424): the same board, one attachment apart. */
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
  const created = createGame({ seed, decks: { p1: deck, p2: deck }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** `attacker` fields `d543-stripper` with an empty Bench; the opponent fields
    `d543-wall` Active plus, when `benched` is true, one `d543-bench` behind it.
    `tools` names which of the two bodies wears which Tool — `[activeTool,
    benchTool]`, either entry `null` for "no Tool there". The attacker moves FIRST
    so the opponent's own first turn is behind us and the attack is legal. */
function ready(
  opts: {
    tools?: readonly [string | null, string | null];
    benched?: boolean;
    attacker?: Seat;
    seed?: number;
    ownTool?: string | null;
    /** Mist Energy onto the VICTIM's Active (§11, the shield half of D259's split). */
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
  if (opts.shieldBench === true) state = attachBenchFromDeck(state, opponent, 0, "fix-mist-energy", 1);
  return state;
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

/** The parked prompt, narrowed. Throws rather than returning null, so a board that
    RESOLVED INLINE instead of parking names itself at the call site (D424). */
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

/** The flattened text of the one action row a batch produced that mentions
    `needle` — the string a player actually reads. */
function rowText(state: GameState, events: GameEvent[], needle: string): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes(needle)),
  );
  if (row === undefined || row.kind !== "action") throw new Error(`no row mentioning ${needle}`);
  return row.segments.map((s) => s.text).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE ANCHOR. Whole-sentence, one capture, one apostrophe class, a required
//      terminator — with BOTH trailing near-misses kept (D540(1a)).
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the anchor, and the near-misses it refuses", () => {
  it("🛑 derives to ONE op whose count is the CAPTURED ceiling", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual(PROGRAM);
  });

  it("🛑 THE COUNT IS A CAPTURE AND NOT THE LITERAL 2 — the D231 rung", () => {
    // A field with one reachable value is the unkillable mutant. The printed column
    // spells only `2` today, so the capture is what MAKES the field falsifiable:
    // `D543-count-literalised` and `D543-count-off-by-one` both die here and could
    // not exist against a literal. Driven on SYNTHETIC numbers, said out loud: these
    // three strings are not printed by any card, and the rung is about the ANCHOR's
    // shape rather than about the column.
    expect(deriveAttackEffect("Discard up to 1 Pokémon Tools from your opponent's Pokémon.")).toEqual(
      [{ op: "discardTools", count: 1 }],
    );
    expect(deriveAttackEffect("Discard up to 3 Pokémon Tools from your opponent's Pokémon.")).toEqual(
      [{ op: "discardTools", count: 3 }],
    );
    expect(
      deriveAttackEffect("Discard up to 12 Pokémon Tools from your opponent's Pokémon."),
    ).toEqual([{ op: "discardTools", count: 12 }]);
    // …and a count the arm refuses rather than parking an empty decision.
    expect(deriveAttackEffect("Discard up to 0 Pokémon Tools from your opponent's Pokémon.")).toBeNull();
  });

  it("🛑 BOTH TRAILING NEAR-MISSES ARE KEPT — they refuse for two DIFFERENT reasons", () => {
    // D540(1a)'s lesson, at the `$` end of the pattern, and the reason the pair is
    // not one rung: only ONE of them is about the terminator.
    //
    //   (a) KEEPS the period and glues a clause on. A `$`-less anchor matches the
    //       PREFIX and authors a program for a card whose trailing clause it
    //       silently dropped — this is the string `D543-anchor-loses-terminator`
    //       dies on, and it is the killer.
    //   (b) STRIPS the period. That refuses even a `$`-less pattern (the text no
    //       longer ends where the anchor's last literal does), so it can never see
    //       the terminator mutant at all — it pins the LITERAL tail instead.
    const glued = `${SENTENCE} Then, draw a card.`;
    const stripped = `${SENTENCE.slice(0, -1)} and shuffle your deck.`;
    expect(deriveAttackEffect(glued)).toBeNull();
    expect(deriveAttackEffect(stripped)).toBeNull();
    // 🛑 **AND THE PAIR REALLY IS TWO REASONS, DEMONSTRATED RATHER THAN
    // ASSERTED.** A local clone of the anchor WITHOUT its `$` — which is exactly
    // what `D543-anchor-loses-terminator` writes — MATCHES (a) and still refuses
    // (b). So (a) is the only one of the two that can see that mutant, and (b) pins
    // the literal tail instead. Keeping just one of them would leave a live hole.
    const noDollar = /^Discard up to (\d+) Pokémon Tools from your opponent['’]s Pokémon\./;
    expect(noDollar.test(glued)).toBe(true);
    expect(noDollar.test(stripped)).toBe(false);
    expect(glued.startsWith(SENTENCE)).toBe(true);
    expect(stripped.startsWith(SENTENCE)).toBe(false);
  });

  it("🛑 the CARET is load-bearing too — a prefix that keeps the capital is refused", () => {
    expect(
      deriveAttackEffect("Flip a coin. Discard up to 2 Pokémon Tools from your opponent's Pokémon."),
    ).toBeNull();
  });

  it("NO `/i` — the printed capital is load-bearing", () => {
    expect(
      deriveAttackEffect("discard up to 2 Pokémon Tools from your opponent's Pokémon."),
    ).toBeNull();
  });

  it("🛑 the NEIGHBOURING TOOL SENTENCES are refused — disjointness, MEASURED", () => {
    // Arm order in `deriveAttackEffect` is free only if the anchors are disjoint on
    // the printed column, and "disjoint" is a MEASUREMENT (D540). Driven as a matrix
    // through the one public funnel that reads every anchor: each of the other
    // `/Pokémon Tool/` rows lands on its OWN reading, and none of them lands on this
    // op.
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
    // 🛑 A TAIL-ONLY ARM WOULD LEAVE THE FOUR PRE-DAMAGE REFUSAL SUITES GREEN while
    // their subject changed underneath them, because `resolvedByAnyReader` would go
    // true without the sentence ever leaving the raw residue. Pinned here as the
    // POSITIVE claim: the whole string resolves, and the splitter refuses it.
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE APOSTROPHE. One slot, measured at index 48 on the LIVE corpus row.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the single `['’]` slot, and the control that reads the LIVE row", () => {
  it("🛑 the CURLED board derives identically — the class earns its keep", () => {
    const curled = SENTENCE.split("'").join("’");
    expect(curled).not.toBe(SENTENCE);
    expect(deriveAttackEffect(curled)).toEqual(PROGRAM);
  });

  it("🛑 THE CONTROL READS THE CODE POINTS OFF THE LIVE CORPUS ROW, NOT OFF THIS SUITE", () => {
    // D540(1b)(1c): the corpus prints U+0027 today, so collapsing the class to the
    // straight quote leaves every board green and every census figure still. A rule
    // nothing can see is not a rule — so the class gets its own curled board above,
    // and the MEASUREMENT that justifies exactly one slot is taken here off
    // `legalAttackCorpus()` rather than off `SENTENCE`. A re-ingest that curls the
    // corpus reddens at this control FIRST, which is the whole point of reading the
    // live row.
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

// ─────────────────────────────────────────────────────────────────────────────
// §3 — ZERO OFFERS IS A SILENT NO-OP: no park, no event, no log row.
// ─────────────────────────────────────────────────────────────────────────────

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

  it("🛑 an opponent wearing NO Tool: no park, no `TOOLS_DISCARDED`, no row", () => {
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

  it("🛑 the ATTACKER's OWN Tool is never offered — one printed zone, and it is theirs", () => {
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

  it("🛑 THE CHEAP BUILD'S FAILURE, DRIVEN FROM OUTSIDE: the ENERGY discard sees no Tool", () => {
    // `discardEnergy { filter: { kind: "toolCard" } }` typechecks and offers nothing,
    // because `attachedEnergies` walks `energy` and a Tool lives in `tools`. Driven
    // here on the shipped hammer attack over a board whose ONLY attached cards are
    // Tools: the Energy discard is a whiff while the Tool discard parks on two.
    const start = ready();
    expect(start.players.p2.active?.tools).toHaveLength(1);
    expect(start.players.p2.active?.energy).toEqual([]);
    const hammered = attack(start, HAMMER);
    expect(hammered.state.phase.kind).not.toBe("effect:choose");
    expect(types(hammered.events)).not.toContain("ENERGY_DISCARDED");
    expect(toolsOf(hammered.state, "p2")).toHaveLength(2);
    // …the same board, this slice's op: a real question.
    expect(parkedPrompt(attack(start, STRIP).state).discardable).toHaveLength(2);
  });

  it("ONE offered Tool still ASKS — `parkOrForce`'s ceiling rule (D359)", () => {
    // There is no forced pick when 0 is always legal, so an offer of ONE is a real
    // question and NOT the M1 "a choice with no choice in it" case. This is the rung
    // that separates this op from every mandatory discard beside it.
    const start = ready({ tools: ["d543-tool-a", null], benched: false });
    const { state } = attack(start, STRIP);
    const prompt = parkedPrompt(state);
    expect(prompt.discardable).toHaveLength(1);
    expect(prompt.scope).toEqual({ kind: "upTo", max: 1 });
  });

  it("🛑 `max` IS CLAMPED TO THE OFFER, not left at the printed 2", () => {
    const start = ready({ tools: ["d543-tool-a", null], benched: true });
    expect(parkedPrompt(attack(start, STRIP).state).scope).toEqual({ kind: "upTo", max: 1 });
    const both = ready();
    expect(parkedPrompt(attack(both, STRIP).state).scope).toEqual({ kind: "upTo", max: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🛑 §4 — THE PARKED ≥2-OFFER PATH, THROUGH `resolveEffect`. The ONLY rung that
//         can see `D543-apply-choice-arm-deleted`, and it asserts BOARDS (D421).
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 §4 — the answer strips BOTH bodies and fills the OWNER's discard pile", () => {
  it("🛑 two hosts, two Tools, one answer — both `tools` arrays empty, both cards in the pile", () => {
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
    // 🛑 THE BOARD, NOT THE OP'S SHAPE. Delete `applyChoice`'s arm and every one of
    // these five lines fails while `tsc` stays silent.
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(state.players.p2.bench[0]?.tools).toEqual([]);
    expect(state.players.p2.discard).toContain(activeTool);
    expect(state.players.p2.discard).toContain(benchTool);
    // §7.4 — a Tool goes to its OWN controller's pile, never the attacker's.
    expect(state.players.p1.discard).not.toContain(activeTool);
    expect(state.players.p1.discard).not.toContain(benchTool);
    // …and the events say so, ONE ROW PER HOST, in board order.
    const rows = all(events, "TOOLS_DISCARDED");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.uids)).toEqual([[activeTool], [benchTool]]);
    expect(rows.map((r) => r.seat)).toEqual(["p2", "p2"]);
    expect(rows.map((r) => r.actor)).toEqual(["p1", "p1"]);
    expect(rows.map((r) => r.when)).toEqual(["effect", "effect"]);
  });

  it("🛑 A PARTIAL ANSWER TAKES EXACTLY WHAT IT NAMED — the other host keeps its Tool", () => {
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
    // `TOOLS_DISCARDED.host` is a SINGLE top-card uid, which is why a multi-host
    // answer emits several rows — and why a single-host answer must emit exactly
    // one carrying both uids. `D543-per-host-emission-collapsed-to-one-row` is the
    // declared row for the other direction.
    let start = ready({ tools: ["d543-tool-a", null], benched: false });
    start = attachToolFromDeck(start, "p2", "active", "d543-tool-b");
    const [t1, t2] = start.players.p2.active?.tools as [string, string];
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

  it("🛑 AN ANSWER LONGER THAN `max` IS REFUSED, WITH EVERY UID OFFERED", () => {
    // 🛑 **THE BOARD HAS TO OFFER MORE THAN THE CEILING, OR THE RUNG TESTS THE
    // WRONG RULE.** The first version of this rung padded a legal answer with a uid
    // from a DIFFERENT board, so the *"was it offered"* check refused it and the CAP
    // was never exercised at all — `D543-validate-cap-dropped` SURVIVED the probe and
    // said so (D525(3): probe undeclared first). Three Tools on a two-Tool print is
    // the only shape that separates the two rules: `max` clamps to `min(2, 3) = 2`
    // while the offer holds three, so an answer naming ALL THREE is refused by the
    // CEILING and by nothing else.
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
  it("🛑 the EMPTY answer is accepted and files NO `TOOLS_DISCARDED`", () => {
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
  it("🛑 the ANSWERER's wire prompt is the engine prompt, field for field", () => {
    const parked = attack(ready(), STRIP).state;
    const engine = parkedPrompt(parked);
    const wire = redactGame(parked, "p1");
    if (wire.phase.kind !== "effect:choose" || wire.phase.prompt === null) {
      throw new Error("expected a wire prompt");
    }
    const sent = wire.phase.prompt;
    // The schema ACCEPTS it — the half no engine assertion can see, and the half
    // that could not have passed before D543 taught the wire the `upTo` member.
    const parsed = redactedEffectPromptSchema.safeParse(sent);
    expect(parsed.success).toBe(true);
    expect(sent).toEqual(engine);
    if (sent.kind !== "discardTools") throw new Error("expected discardTools on the wire");
    expect(sent.scope).toEqual({ kind: "upTo", max: 2 });
  });

  it("🛑 the NO-ALIAS purity contract holds for the new member", () => {
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

  it("the wire prompt union now has ELEVEN members and `discardTools` is one (🆕🆕🆕 D548: TWELVE — `choosePrize` joined; 🆕🆕🆕 D577: THIRTEEN — `guessHp` joined; re-read off `.options`, not counted)", () => {
    const kinds = redactedEffectPromptSchema.options.map((o) => o.shape.kind.value);
    expect(kinds).toHaveLength(13); // 🆕🆕🆕 D577 — 12 → 13, MEASURED: `redactedEffectPromptSchema.options.length` at D577 (Tyme's `guessHp`). 🆕🆕🆕 D548 — 11 → 12, MEASURED: `redactedEffectPromptSchema.options.length` at D548's head.
    expect(kinds).toContain("discardTools");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — PERSISTENCE, over the SERIALIZED bytes, both D450 directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 §7 — `MATCH_RECORD_VERSION` HOLDS AT 30 (🆕🆕🆕 held at THIS slice; 31 since D547; 32 since D548; 33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570; 38 since D575; 39 since D576; 40 since D577; 41 since D579; 42 since D583), driven rather than argued", () => {
  it("🛑 `\"cont\" in phase` IS TRUE — a record really holds the new inhabitant", () => {
    const parked = attack(ready(), STRIP).state;
    expect("cont" in parked.phase).toBe(true);
    expect(JSON.stringify(parked)).toContain('"op":"discardTools","count":2');
  });

  it("🛑 DIRECTION 1 — the parked program survives a JSON round trip and resolves", () => {
    const parked = attack(ready(), STRIP).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    const uids = parkedPrompt(revived).discardable.map((d) => d.uid);
    const { state, events } = answerWith(revived, "p1", uids);
    expect(all(events, "TOOLS_DISCARDED")).toHaveLength(2);
    for (const uid of uids) expect(state.players.p2.discard).toContain(uid);
  });

  it("🛑 DIRECTION 2 — every byte this slice writes is a NEW INHABITANT, never a rename", () => {
    // D450's second direction: the question is whether a byte string a v30 deploy
    // COULD have written now means something else. It cannot — `discardTools` is a
    // literal no earlier deploy ever emitted, and `upTo` is a `DiscardScope` member
    // that has existed in the ENGINE since D359 (only the WIRE lacked it, and the
    // wire is not persisted). So a pre-D543 record holds no `discardTools`, no
    // `discardEnergy` op changed shape, and nothing already in the alphabet moved.
    const parked = attack(ready(), STRIP).state;
    const bytes = JSON.stringify(parked);
    expect(bytes).toContain('"discardTools"');
    // The shipped ENERGY discard's serialized shape is untouched by this slice:
    // drive it on the same deck, on the attack beside it.
    const hammer = attack(ready({ tools: [null, null], benched: false }), HAMMER).state;
    expect(JSON.stringify(hammer)).not.toContain("discardTools");
    // …and the non-parking board writes nothing at all.
    const quiet = attack(ready({ tools: [null, null], benched: true }), STRIP).state;
    expect("cont" in quiet.phase).toBe(false);
    expect(JSON.stringify(quiet)).not.toContain("discardTools");
  });

  it("🛑 `MATCH_RECORD_VERSION` is 42 (🆕🆕🆕 D583 stepped it 41 → 42; D579 stepped it 40 → 41; D577 stepped it 39 → 40; D576 stepped it 38 → 39; D575 stepped it 37 → 38; D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; D547 stepped it 30 → 31; this slice held it) — read off the RAW source, not retyped", () => {
    // 🆕🆕🆕 D547 — the constant this slice held is now 31: D547 added two REQUIRED `InPlayPokemon` fields (apps/api match.ts).
    expect(raw("/match.ts")).toContain("export const MATCH_RECORD_VERSION = 42;");
  });

  it("the op is PURE — the parked board is not mutated by resolving it", () => {
    const parked = deepFreeze(attack(ready(), STRIP).state);
    const snapshot = JSON.stringify(parked);
    answerWith(parked, "p1", parkedPrompt(parked).discardable.map((d) => d.uid));
    expect(JSON.stringify(parked)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE POPULATION PIN (D423), the log row, and the version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the population, the log row, and the version", () => {
  it("🛑 the corpus row is present ONCE, at file line 136, with count column 2", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === SENTENCE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(2);
    // …and the FILE line, read off the raw corpus rather than asserted from memory.
    const lines = raw("/censusAttackCorpus.ts").split("\n");
    expect(lines[135]).toBe(`2 ${SENTENCE}`);
  });

  it("🛑 THE POPULATION: this op is authored by EXACTLY ONE corpus sentence", () => {
    // D423 — pin the claim on the population, not on the specimen. If a future
    // anchor started emitting `discardTools` for a second printed sentence, the
    // `from`-less, filter-less shape would silently under-specify it.
    const claimed = legalAttackCorpus().filter(([, s]) =>
      (deriveAttackEffect(s) ?? []).some((op) => op.op === "discardTools"),
    );
    expect(claimed.map(([, s]) => s)).toEqual([SENTENCE]);
  });

  it("🛑 THE LOG ROW DOES *NOT* SAY “before doing damage” — `when: \"effect\"`", () => {
    // D421 — a log row is a claim with the same standing as a predicate, and this
    // one happens at the program TAIL, after §8.5. `D543-event-when-flipped` moves
    // no board at all: it is a row that lies, and this is the only rung that sees it.
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

  it("engineVersion", () => {
    expect(engineVersion).toBe("0.483.0");
  });

  it("the interpreter keeps the op OUT of `recordSlotOf`, and says so", () => {
    // D206's silent omission, written down in the tree and pinned here so the note
    // cannot rot into a lie: no `recordAs` field, no enrolment, no consequent.
    expect(raw("/interpreter.ts")).toContain("`discardTools` IS DELIBERATELY *NOT* IN THE LIST");
    expect(JSON.stringify(PROGRAM)).not.toContain("recordAs");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🛑 §9 — §11 REMOVES A BODY FROM THE OFFER AND LEAVES THE REST PICKABLE.
//      The arm's own §11 block makes a real, contestable rules decision —
//      D259's split, taken on the SET side because this sentence names a set — and
//      a decision with no falsifier is prose. Owed and paid here: a board with a
//      shielded body AMONG the offered hosts, plus `D543-offer-drops-the-shield`
//      and `D543-shield-asked-before-the-filter` in the corpus.
//
//      ⚠️ **THE HOLE THIS SECTION CLOSES WAS MEASURED, NOT SUSPECTED.** With
//      `unshieldedRefs` deleted from the arm — the offer handed the raw funnel —
//      every suite this slice ships stayed GREEN, because no board in the slice
//      had a shielded body: a rung green only because of its board default, with
//      *every* board as the default. A Mist-Energy'd body would have been OFFERED,
//      picked, and stripped anyway, with no `ATTACK_EFFECT_PREVENTED` row at all.
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 §9 — a Mist Energy holder is not OFFERED, and the rest still strip", () => {
  it("🛑 the shielded BENCHED body is dropped from `discardable` and the Active stays pickable", () => {
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

  it("🛑 the shielded ACTIVE body is dropped, and the BENCH is still stripped", () => {
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

  it("🛑 BOTH shielded — a SILENT no-op with TWO refusals, no park and no `TOOLS_DISCARDED`", () => {
    // The whole-op refusal this arm deliberately does NOT write is reached from the
    // other side: every body filtered out leaves an EMPTY offer, which §3's zero-offer
    // rule already turns into a no-op. One protected body cannot cancel the op; TWO
    // protected bodies leave nothing to ask about, which is a different sentence.
    const { state, events } = attack(ready({ shieldActive: true, shieldBench: true }), STRIP);
    expect(all(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(2);
    expect(types(events)).not.toContain("TOOLS_DISCARDED");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(toolsOf(state, "p2")).toHaveLength(2);
  });

  it("🛑 A SHIELDED BODY WEARING NO TOOL FILES NO REFUSAL AT ALL — the ORDER rung", () => {
    // The set is narrowed to TOOL HOSTS *before* §11 is asked, so a Mist-Energy'd body
    // this op was never going to touch does not get an `ATTACK_EFFECT_PREVENTED`
    // announcing an effect that does not exist (D430 — a log row is a claim with the
    // same standing as a predicate). Asking the shield over the whole opponent board
    // first would file one here, move no card, and look entirely plausible in the log:
    // `D543-shield-asked-before-the-filter` is the declared row and this is its killer.
    const { events } = attack(ready({ tools: [null, "d543-tool-b"], shieldActive: true }), STRIP);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(all(events, "TOOLS_DISCARDED")).toHaveLength(0); // it parked, it did not fire
  });

  it("🛑 THE ADMISSION CONTROL — the SAME board unshielded offers BOTH hosts", () => {
    // D424: the refusal cases above all pass on a build that offers nobody. One
    // attachment apart, on the same deck, the same seed and the same board shape.
    const start = ready({ shieldBench: true });
    const control = ready();
    // The TWO decks differ only in four Energy lines, and `deckOf` order is what feeds
    // the shuffle — so the two boards wear the SAME two Tool uids on the same two
    // bodies, MEASURED here rather than assumed. The length is pinned too, so a future
    // board that stopped attaching anything could not satisfy this as an empty match.
    expect(toolsOf(start, "p2")).toHaveLength(2);
    expect(toolsOf(start, "p2")).toEqual(toolsOf(control, "p2"));
    const prompt = parkedPrompt(attack(control, STRIP).state);
    expect(prompt.discardable).toHaveLength(2);
    expect(prompt.scope).toEqual({ kind: "upTo", max: 2 });
    expect(types(attack(control, STRIP).events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});
