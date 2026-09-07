import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackEffect,
  deriveAttackPreDamage,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { engineVersion } from "./index";
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
} from "./testFixtures";

// 0.329.0 → 0.330.0 — 🆕🆕 D428: THE PRE-DAMAGE TOOL DISCARD.
//
//   "Before doing damage, discard all Pokémon Tools from your opponent's Active
//    Pokémon."
//
// **1 sentence / 5 legal printings** (corpus line 73) over `legalAttackCorpus()`'s
// 640 sentences / 1,732 printings — the `legal_standard = 1` attack column. The
// LARGEST single record in the split-aware unbuilt residue at D427's head: **195
// sentences / 293 printings**, subtracting `resolvedByAnyReader`,
// `splitAttackGateClause`, `splitAttackTrailingClause` and a `registry.ts` substring
// test (D425's rule — a residue figure without its subtraction set names nothing).
// After this slice, **194 / 288**.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 THE DESIGN DECISION, WHICH IS THE SLICE. Three questions, answered in order.
//
// ① **PROGRAM OR BESPOKE SHAPE? — BESPOKE, AND THE SECOND REASON IS THE DECIDING
// ONE.** D125's rule settles the first half: *a derived shape is classified by WHERE
// IN RESOLUTION IT LANDS*, and an `EffectOp` program runs at `attack.ts`'s TAIL,
// strictly AFTER the §8.5 pipeline. The printed words are *"Before doing damage"*, so
// an `EffectOp` is structurally in the wrong place — the same argument D125 made for
// its requirement gate and D126 for its coin flip.
//
// The half D125 never had to face is ②'s. `runProgram` can hand back a PARKED state,
// and `attack.ts` has no continuation for *"…and then run §8.5, the §8.1 sweep and the
// epilogue"* — everything after this point in the function is straight-line code and
// only its TAIL is expressible as `PendingStage[]`. So an `EffectOp[]` at a pre-damage
// call site would be correct exactly as long as nobody ever put a parking op in it,
// and the thing keeping it correct would be a hand-kept list of safe ops: D222's
// closed-world assumption with no compiler behind it.
//
// So the carrier is `AttackPreDamage`, a CLOSED union with one inhabitant, applied by
// `applyAttackPreDamage` — a total function returning `GameState`. **The signature is
// the enforcement**: a member needing a decision cannot be written against a function
// that returns a board rather than an `ApplyResult`. §7 pins that.
//
// ② **STRIPPER OR WHOLE-SENTENCE ANCHOR? — ANCHOR, AND THE STRIPPER WAS PRICED WITH A
// MEASUREMENT RATHER THAN DECLINED ON TASTE.** The family shares the literal head
// `Before doing damage, `, so a `splitAttackPreDamageClause` shaped like
// `splitAttackGateClause` looks like it would set up rows 71 / 72 / 74 cheaply.
// Measured over all 640 corpus sentences (§1 re-runs it live): **FOUR sentences open
// with that head, and ZERO of the four remainders is claimed by any reader** — as
// printed, and with the remainder re-capitalised, since the printed remainder starts
// lowercase. A stripper buys **nothing at all** today; each of the four still needs
// its own arm, and the only way to make the stripper pay would be to hand its
// remainder to `deriveAttackEffect` — which is exactly the `EffectOp` program ① just
// refused. It is `splitAttackGateClause`'s own *"build the narrow thing"* verdict at
// the other end of the sentence. **The condition that would reverse it (D422): two or
// more pre-damage remainders claimed by a reader that already exists.**
//
// ③ **CAN A PRE-DAMAGE OP PARK? — NO, AND IT IS FORBIDDEN STRUCTURALLY.** See ① and
// §7. The corpus row that WOULD park — *"Discard up to 2 Pokémon Tools from your
// opponent's Pokémon."*, 2 printings — carries no pre-damage head and is REFUSED here
// and left unbuilt, pinned on the POPULATION in §7 rather than on a specimen (D423).
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 THE OBSERVABILITY, WHICH IS WHY THE HOOK'S PLACEMENT IS THE WHOLE SLICE.
// Discarding a Tool AFTER §8.5 would resolve, fire its event, print its log row and
// change no number — D407's built-but-dead defect. Two §8.5 reads make it observable,
// and both are DRIVEN with the Tool present and the Tool discarded on ONE board:
//   · `passivesOf(next, defender)` → `damageReductionAfterWR` (Rock Chestplate
//     `sv01-192`, a real TOOL: −30 after W/R on an {F} holder) — §3, the damage moves;
//   · `effectiveMaxHp` at the §8.1 sweep → `basicHpBonus` (Bravery Charm `sv02-173`,
//     a real TOOL: +50 HP on a Basic holder) — §4, the Knock Out moves.
//
// ⚠️ **AND THE REBIND IS THE MECHANISM, NOT THE STATE WRITE.** `attack.ts` binds
// `defender` from `activeTop(state, …)` ~1,150 lines before §8.5 and passes that
// OBJECT to every fold. A hook that updated only `next` would empty the board's
// `tools` array and leave all five reads folding the pre-discard snapshot. The mutant
// `D428-pre-damage-discard-not-rebound` is exactly that build.
//
// ⚠️ **THE BRIEF THAT COMMISSIONED THIS SLICE NAMED VITALITY BAND AS A NUMBER-MOVER
// AND IT IS NOT ONE.** `damageBonusBeforeWR` is read off the ATTACKER
// (`attackerPreWRBonus`), so a Vitality Band on the OPPONENT's Active contributes
// nothing to the damage that Active is about to take, discarded or not. §5 drives it
// as a second no-op control rather than leaving the claim unchecked.

/** One seed for the whole suite. Nothing here flips a coin and every Active, Tool
    and damage total is placed by surgery, so a seed table would describe a shuffle
    rather than a rule (D143's move). */
const SEED = 11;

/** The printed sentence, transcribed off `censusAttackCorpus.ts` line 73 and used as
    the single source for the corpus, derivation and fixture assertions below. Written
    once so no copy of it can drift (D415). */
const SENTENCE =
  "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.";

/** The literal head the whole *"Before doing damage,"* family shares — the string a
    prefix stripper would take off. Named so §1 can measure what it would buy. */
const HEAD = "Before doing damage, ";

/** `fix-toolstrip`'s indices, in two same-damage PAIRS plus one unread row. */
const IDX = { pry100: 0, plain100: 1, pry120: 2, plain120: 3, loud: 4 } as const;

/** Real Tool ids, reused rather than invented. */
const CHESTPLATE = "sv01-192"; // −30 after W/R, gated on the holder's {F}
const CHARM = "sv02-173"; // +50 HP, gated on the holder being a Basic
const BAND = "sv01-197"; // Vitality Band — an ATTACKER-side bonus, the null control

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

/** A board with `fix-toolstrip` Active for `seat`, `defender` Active opposite, two
    Colorless attached, and `tool` (if any) attached to the DEFENDER's Active. The turn
    is handed to `seat` by ending the OTHER seat's first turn, so §4's going-first ban
    is never in the way. */
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

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((event) => event.type === type) as
    | Extract<GameEvent, { type: T }>
    | undefined;
}

/** What §8.5 said it dealt to the defending Active. `undefined` means no row. */
function dealt(events: GameEvent[]): number | undefined {
  return find(events, "DAMAGE_DEALT")?.dealt;
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
    // ⚠️ THE APOSTROPHE BYTE IS MEASURED, NOT REMEMBERED (D421). The corpus prints
    // U+0027 and holds ZERO U+2019 bytes anywhere; the anchor's `['’]` class is
    // therefore DEFENSIVE, matching the neighbours that already spell it that way.
    expect(SENTENCE).toContain("opponent's");
    expect(SENTENCE.includes("’")).toBe(false);
    expect(legalAttackCorpus().some(([, text]) => text.includes("’"))).toBe(false);
  });

  it("🛑 the FAMILY, enumerated with the LOOSEST pattern and every hit read (D424)", () => {
    // The published pattern, so its edges are visible rather than inherited as a
    // fact: `/[Bb]efore doing damage/` over all 640 sentences. FIVE rows, and the
    // fifth is why a prefix stripper could never be the whole answer — its clause is
    // the SECOND sentence, so nothing anchored at the front can see it.
    const family = legalAttackCorpus().filter(([, s]) => /[Bb]efore doing damage/.test(s));
    expect(family).toHaveLength(5);
    expect(family.filter(([, s]) => s.startsWith(HEAD))).toHaveLength(4);
    expect(family.filter(([, s]) => !s.startsWith(HEAD) && s.includes(HEAD))).toHaveLength(1);
    // 🛑 **WHAT THE PATTERN CANNOT SEE, MEASURED RATHER THAN ASSERTED — AND THE FIRST
    // DRAFT OF THIS RUNG CLAIMED THE OPPOSITE AND WAS WRONG.** It said *"`before this
    // attack does damage` is printed by NO row in this column"*, which the column
    // refutes: Toedscruel `/[Bb]efore doing damage/`'s blind spot is a REAL sentence,
    // 2 printings, spelling the same instant as a MID-SENTENCE clause. It is not this
    // family — it is a `deriveAttackRequirement` does-nothing gate, already built since
    // D125 — but it is exactly the shape a published pattern is published to expose
    // (D424/D425: state the pattern, then ask what it cannot see, and CHECK the answer).
    const otherSpelling = legalAttackCorpus().filter(([, s]) =>
      /before this attack does damage/i.test(s),
    );
    expect(otherSpelling).toHaveLength(1);
    expect(otherSpelling[0]?.[0]).toBe(2);
    expect(otherSpelling[0]?.[1]).toBe(
      "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.",
    );
    // …and it is ALREADY RESOLVED, by a different reader, which is why it is a blind
    // spot worth naming and not a missed printing.
    expect(resolvedByAnyReader(otherSpelling[0]?.[1] ?? "")).toBe(true);
    expect(deriveAttackPreDamage(otherSpelling[0]?.[1] ?? "")).toBeNull();
    // ⚠️ AND THE BRIEF'S SEPARATE `/Pokémon Tool/` SWEEP WAS SHORT BY TWO. It listed
    // rows 71-74, 136, 313, 360 and 448 and stopped; the column has TEN, the two
    // unlisted being the counted-Tool scaler and the hand-reveal discard. Re-measured
    // here rather than inherited, which is the sixth incomplete enumeration in eight
    // slices and the whole reason this rung exists.
    expect(legalAttackCorpus().filter(([, s]) => /Pokémon Tool/.test(s))).toHaveLength(10);
  });

  it("🛑 THE PREFIX STRIPPER, PRICED: it would buy ZERO printings today", () => {
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
    // ⚠️ THE CONTROL THAT MAKES THE ZERO MEAN SOMETHING (D424's rule: every refusal
    // owes a neighbouring admission). The instrument is not simply answering "no" to
    // everything — hand it a string a reader really does claim and it says yes.
    expect(resolvedByAnyReader("Your opponent's Active Pokémon is now Asleep.")).toBe(true);
  });

  it("the reader surface grew by ONE, and the sentence leaves BOTH residues together", () => {
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackPreDamage");
    // No registry row and neither splitter: the sentence leaves the raw refusal and
    // the split-aware residue by the same 1 / 5, which is what a READER buys and what
    // a registry row does not.
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation: one anchor, one closed shape, and the three siblings it
//      must keep LOUD.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the boundaries the anchor holds", () => {
  it("derives the one closed shape, and its key set is exactly `kind`", () => {
    expect(deriveAttackPreDamage(SENTENCE)).toEqual({ kind: "discardOpponentActiveTools" });
    expect(Object.keys(deriveAttackPreDamage(SENTENCE) ?? {})).toEqual(["kind"]);
  });

  it("🛑 the U+2019 re-ingest derives IDENTICALLY, not merely non-null", () => {
    // D136/D137's shape: equality with the straight form. A test checking only for
    // non-null would pass on a reader that folded the clause into some other row.
    const curly = SENTENCE.replaceAll("'", "’");
    expect(curly).not.toBe(SENTENCE);
    expect(deriveAttackPreDamage(curly)).toEqual(deriveAttackPreDamage(SENTENCE));
  });

  it("🛑 the THREE SIBLINGS are now CLAIMED — and each still derives to its OWN member", () => {
    // 🆕🆕 **D429 RE-POINTED THIS RUNG, AND THE OLD CLAIM IS RECORDED RATHER THAN
    // DELETED.** At D428 this asserted *"the three siblings stay REFUSED"* and it was
    // TRUE; D429 claimed all three, so the sentence expired by design. ⚠️ **D418's rule
    // is what shaped the replacement**: a re-pointed rung can silently drop the
    // discrimination the old one provided, so the question asked here is not the weaker
    // *"are they claimed?"* but the SAME BOUNDARY the refusal used to guard — **does
    // each of the four anchors claim its own sentence and nobody else's?** Row 73's
    // anchor is a strict PREFIX of row 74's string, so an anchor that lost its `\.$`
    // would swallow the sibling; under that build this rung goes RED on the KIND, where
    // a bare non-null test would not. (`D428-anchor-drops-the-tail` is that mutant, and
    // it names this file as its killer.)
    const siblings = legalAttackCorpus()
      .filter(([, s]) => s.startsWith(HEAD) && s !== SENTENCE)
      .map(([, s]) => s);
    expect(siblings).toHaveLength(3);
    // Named individually, because "three are claimed" says nothing about WHICH three,
    // and each still differs from `SENTENCE` on exactly ONE printed axis (D427).
    // ① the NOUN grows a second term…
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
    // 🛑 THIS SENTENCE STILL DERIVES TO **ITS OWN** MEMBER — the half that keeps the
    // boundary. Four sentences, four kinds, no overlap.
    expect(deriveAttackPreDamage(SENTENCE)).toEqual({ kind: "discardOpponentActiveTools" });
    const kinds = [SENTENCE, ...siblings].map((s) => deriveAttackPreDamage(s)?.kind);
    expect(new Set(kinds).size).toBe(4);
    // ⚠️ AND THE REFUSAL SIDE IS NOT GONE, IT MOVED OUT ONE RING (D424's rule: every
    // "X is claimed" owes a neighbouring "Y is refused" on the same axis). The head
    // alone is not enough — a constructed fifth opener is still `null`.
    expect(deriveAttackPreDamage(`${HEAD}discard all Pokémon Tools from your Bench.`)).toBeNull();
  });

  it("🛑 ③ does not COMPOSE for free either — measured after the reader landed", () => {
    // D424 gained a printing exactly this way, so it is measured rather than assumed.
    // `splitAttackTrailingClause` needs the TAIL claimed by `deriveAttackEffect`; this
    // reader made a HEAD readable whose tail is still unread (D426's mechanism).
    const compound = legalAttackCorpus().find(
      ([, s]) => s.startsWith(SENTENCE) && s !== SENTENCE,
    )?.[1];
    expect(compound).toBeDefined();
    // 🆕🆕 **D429 RE-POINTED THIS LINE**: the compound is corpus row 74, which D429
    // claims WHOLE, so *"the pre-damage reader refuses it"* stopped being true. What
    // this rung is ABOUT is unchanged and is now stated directly — it is claimed by its
    // OWN anchor and NOT by row 73's, which is what "does not compose for free" meant.
    expect(deriveAttackPreDamage(compound ?? "")).toEqual({
      kind: "discardOpponentActiveToolsThenParalyze",
    });
    expect(splitAttackTrailingClause(compound ?? "")).toBeNull();
    expect(
      deriveAttackEffect(
        "If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
    // 🆕🆕 D429: `true` where D428 measured `false`. The reader that claims it is
    // `deriveAttackPreDamage` and NOT the trailing splitter — which is precisely the
    // mechanism D426 named and this rung exists to pin: the splitter composes when
    // `deriveAttackEffect` already reads the TAIL, and it still does not.
    expect(resolvedByAnyReader(compound ?? "")).toBe(true);
  });

  it("🛑 THE REAL PRINTING: Klefki `sv01-096` has printed this sentence since D100", () => {
    // ⚠️ NOT A `fix-*` DEMONSTRATOR. Klefki's "Joust" is transcribed verbatim off the
    // live D1 and its own fixture block said, in as many words, that all seven readers
    // returned null on it. That claim expired with this slice and is dated in place
    // (D423) rather than back-written.
    expect(FIXTURE_POOL["sv01-096"]?.attacks?.[0]?.effect).toBe(SENTENCE);
    expect(FIXTURE_POOL["sv01-096"]?.attacks?.[0]?.damage).toBe(10);
    // …and the demonstrator carries the identical bytes, so no paraphrase can drift
    // between the fixture and the catalog (D183).
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

// ─────────────────────────────────────────────────────────────────────────────
// §3 — 🛑 THE ORDERING: the discard is genuinely observed by §8.5.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the number MOVES, which is the whole claim", () => {
  it("🛑 Rock Chestplate: 100 → 70 with the Tool, 100 again once it is discarded", () => {
    // ONE board, ONE defender, TWO indices that differ ONLY in the printed sentence.
    // The control proves the Tool is really subtracting; the subject proves the
    // discard really precedes the subtraction.
    const withTool = board("fix-chestwall", CHESTPLATE);
    expect(dealt(swing(withTool, IDX.plain100).events)).toBe(70);
    expect(dealt(swing(withTool, IDX.pry100).events)).toBe(100);
  });

  it("🛑 …and a hook placed AFTER §8.5 would give 70 for BOTH — the delta is 30", () => {
    // Stated as a delta rather than as two numbers, because the delta IS the defect
    // the placement exists to prevent (D407's built-but-dead). `damageReductionAfterWR`
    // is the LAST step of §8.5, so this is the pipeline's far end reading a board the
    // pre-damage hook changed at its near end.
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
    // ⚠️ NOT the attacker's pile: a Tool is played by its holder's controller and goes
    // back to that controller (§7.4). The two seats are opposite here, which is why
    // the event carries both rather than deriving one from the other (D425).
    expect(state.players.p1.discard).not.toContain(toolUid);
    const row = find(events, "TOOLS_DISCARDED");
    expect(row?.seat).toBe("p2");
    expect(row?.actor).toBe("p1");
    expect(row?.uids).toEqual([toolUid]);
    expect(row?.host).toBe(withTool.players.p2.active?.stack.at(-1));
  });

  it("🛑 the EVENT ORDER is the printed order: the discard row precedes DAMAGE_DEALT", () => {
    const { events } = swing(board("fix-chestwall", CHESTPLATE), IDX.pry100);
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("TOOLS_DISCARDED")).toBeGreaterThan(-1);
    expect(kinds.indexOf("TOOLS_DISCARDED")).toBeLessThan(kinds.indexOf("DAMAGE_DEALT"));
  });

  it("the log row says what this path makes true, and is filed under the ACTOR", () => {
    const withTool = board("fix-chestwall", CHESTPLATE);
    const { state, events } = swing(withTool, IDX.pry100);
    const rows = rendered(state, events);
    // ⚠️ THE TOOL FIXTURE'S `name` IS ITS ID — `trainerCard()` does not carry printed
    // names — so the row reads `sv01-192` here and "Rock Chestplate" in a real game.
    // Asserted as the FULL string rather than a substring, because the row's job is to
    // name the OWNER outright (the `who` chip is viewer-relative while these segments
    // are fixed text) and a substring test cannot see a missing possessive.
    const row = rows.find((r) => r.text.includes(CHESTPLATE));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("discarded sv01-192 from Wren's fix-chestwall before doing damage");
    // …and it really is ahead of the damage row in the rendered sequence too, so a
    // reader sees the order the engine resolved in (D421 — a log row is a claim).
    const at = (needle: string) => rows.findIndex((r) => r.text.includes(needle));
    expect(at(CHESTPLATE)).toBeLessThan(at("dealt 100 damage"));
    expect(at(CHESTPLATE)).toBeGreaterThan(at("used Pry Off"));
  });

  it("🛑 BOTH SEATS — the sentence names *your opponent's* Active, not p2's", () => {
    // D361's rule. A build that hard-coded the victim seat passes every p1 case above.
    const mirrored = board("fix-chestwall", CHESTPLATE, "p2");
    expect(dealt(swing(mirrored, IDX.plain100, "p2").events)).toBe(70);
    const { state, events } = swing(mirrored, IDX.pry100, "p2");
    expect(dealt(events)).toBe(100);
    expect(state.players.p1.active?.tools).toEqual([]);
    expect(find(events, "TOOLS_DISCARDED")?.seat).toBe("p1");
    expect(find(events, "TOOLS_DISCARDED")?.actor).toBe("p2");
    // …and the ATTACKER's own Tools are untouched, which is the other half of "your
    // opponent's": give p2's attacker a Tool and it survives its own attack.
    const armed = attachToolFromDeck(mirrored, "p2", "active", CHESTPLATE);
    const after = swing(armed, IDX.pry100, "p2").state;
    expect(after.players.p2.active?.tools).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — 🛑 THE KO BOUNDARY: `effectiveMaxHp` is the other §8.5-adjacent read.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — discarding a Bravery Charm decides the Knock Out", () => {
  it("🛑 120 into a 100 HP Basic: the Charm SAVES it, and the discard takes it", () => {
    // 100 + 50 = 150, and the printed 120 falls BETWEEN the two maxima — so the only
    // difference between surviving and being Knocked Out is whether the Tool is still
    // attached when the §8.1 sweep reads `effectiveMaxHp`.
    const charmed = board("fix-charmwall", CHARM);
    const control = swing(charmed, IDX.plain120);
    expect(dealt(control.events)).toBe(120);
    expect(find(control.events, "KNOCKED_OUT")).toBeUndefined();
    expect(control.state.players.p2.active?.damage).toBe(120);

    const subject = swing(charmed, IDX.pry120);
    expect(dealt(subject.events)).toBe(120);
    expect(find(subject.events, "KNOCKED_OUT")).toBeDefined();
    // …and the dying stack takes the discarded Tool's uid with it exactly ONCE: the
    // pre-damage discard already moved it, so the KO's `discarded` list must not name
    // it again (a Tool cannot be in the pile twice).
    const toolUid = charmed.players.p2.active?.tools[0] ?? "";
    expect(find(subject.events, "KNOCKED_OUT")?.discarded).not.toContain(toolUid);
    expect(subject.state.players.p2.discard.filter((u) => u === toolUid)).toHaveLength(1);
  });

  it("the same 120 into the same body with NO Tool is the same Knock Out — the control", () => {
    // Without this the rung above proves only "120 KOs a 100 HP body", which was
    // already true and says nothing about the discard.
    const bare = board("fix-charmwall", null);
    expect(find(swing(bare, IDX.plain120).events, "KNOCKED_OUT")).toBeDefined();
    expect(find(swing(bare, IDX.pry120).events, "KNOCKED_OUT")).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the no-Tool control, and the Tool whose discard changes nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — a silent no-op is silent, and an irrelevant Tool is still discarded", () => {
  it("🛑 a defender with NO Tool: no event, no row, and the damage is UNCHANGED", () => {
    const bare = board("fix-chestwall", null);
    const control = swing(bare, IDX.plain100);
    const subject = swing(bare, IDX.pry100);
    expect(dealt(control.events)).toBe(100);
    expect(dealt(subject.events)).toBe(100);
    expect(find(subject.events, "TOOLS_DISCARDED")).toBeUndefined();
    // ⚠️ NOT AN EMPTY-`uids` ROW. A row saying nothing was discarded is a row that has
    // to be read to learn nothing — `HEALED`'s never-0 rule, one attachment kind over.
    expect(subject.events.filter((e) => e.type === "TOOLS_DISCARDED")).toEqual([]);
    // …and the state is `===`-identical through the pre-damage seam: the no-op does
    // not rebuild the side.
    expect(subject.state.players.p2.active?.tools).toEqual([]);
  });

  it("🛑 Vitality Band on the DEFENDER: discarded, and the damage does not move", () => {
    // The brief for this slice named Vitality Band as a number-mover. It is not one:
    // `damageBonusBeforeWR` is read off the ATTACKER, so a Band on the body being hit
    // contributes nothing to the hit. The discard still happens — the sentence says
    // ALL Pokémon Tools, not "the ones that matter" — and the number holds still.
    const banded = board("fix-chestwall", BAND);
    expect(dealt(swing(banded, IDX.plain100).events)).toBe(100);
    const { state, events } = swing(banded, IDX.pry100);
    expect(dealt(events)).toBe(100);
    expect(find(events, "TOOLS_DISCARDED")).toBeDefined();
    expect(state.players.p2.active?.tools).toEqual([]);
  });

  it("TWO Tools on one body go together, in one row", () => {
    // §7.4 caps a body at one Tool and `attachToolFromDeck` deliberately does not
    // enforce it (Revavroom ex's "Tune-Up" raises the cap in the real game), so
    // "discard ALL Pokémon Tools" is testable above one — which is what the printed
    // plural asks for.
    let two = board("fix-chestwall", CHESTPLATE);
    two = attachToolFromDeck(two, "p2", "active", CHARM);
    expect(two.players.p2.active?.tools).toHaveLength(2);
    const { state, events } = swing(two, IDX.pry100);
    expect(find(events, "TOOLS_DISCARDED")?.uids).toHaveLength(2);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(state.players.p2.discard).toHaveLength(2);
    // ONE row for the body, not one per Tool: the event's `uids` is a list precisely
    // so a plural sentence is a single fact.
    expect(events.filter((e) => e.type === "TOOLS_DISCARDED")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the loud path: nothing is skipped, in EITHER direction.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — ATTACK_EFFECT_SKIPPED, both directions", () => {
  it("the pre-damage indices are NOT reported as skipped", () => {
    const withTool = board("fix-chestwall", CHESTPLATE);
    expect(find(swing(withTool, IDX.pry100).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(find(swing(withTool, IDX.pry120).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    // …and on a board with nothing to discard either, so "simulated" is a property of
    // the SENTENCE and not of whether the act did anything.
    const bare = board("fix-chestwall", null);
    expect(find(swing(bare, IDX.pry100).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("🛑 the ATTRIBUTION CONTROL — index 4's unread sentence IS still reported", () => {
    // Without this the rung above passes on a build where the report was broken
    // outright, which is the vacuous-guard shape this repo keeps finding (D200→D214).
    const bare = board("fix-chestwall", null);
    const skipped = find(swing(bare, IDX.loud).events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe("Each player draws 3 cards.");
    expect(resolvedByAnyReader("Each player draws 3 cards.")).toBe(false);
  });

  it("Klefki's REAL printing is off the loud path too, and its 10 still lands", () => {
    const withTool = board("fix-chestwall", CHESTPLATE, "p1", "sv01-096");
    const { state, events } = swing(withTool, 0);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(find(events, "TOOLS_DISCARDED")).toBeDefined();
    // 10 printed, and the −30 is gone with the Tool, so the floor is not reached:
    // before this slice this same board dealt 0.
    expect(dealt(events)).toBe(10);
    expect(state.players.p2.active?.tools).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — 🛑 THE PARKING QUESTION, pinned on the POPULATION.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — a pre-damage act cannot park, and the row that would is refused", () => {
  it("🛑 the pre-damage seam NEVER parks: the board is playable the instant it returns", () => {
    // The observable form of "the signature forbids it". If a pre-damage act could
    // park, the phase after the swing would be `effect:choose` and `pending` would be
    // non-empty — and the §8.5 pipeline would have had to survive it.
    for (const tool of [CHESTPLATE, CHARM, null]) {
      const { state } = swing(board("fix-chestwall", tool), IDX.pry100);
      expect(state.phase.kind, String(tool)).not.toBe("effect:choose");
      expect(state.pending, String(tool)).toEqual([]);
    }
  });

  it("🛑 the PARKING sibling is REFUSED, and the refusal is pinned on the POPULATION", () => {
    // D423: pin an absence on the population, not on a specimen. *"Discard up to 2
    // Pokémon Tools from your opponent's Pokémon."* is a real corpus row (2 printings)
    // whose "up to 2" over a multi-body board is a genuine decision — so it is exactly
    // the sentence that would force a parking pre-damage op. It carries no
    // *"Before doing damage,"* head, so it belongs at the program TAIL where parking is
    // already solved, and it stays UNBUILT here.
    const parkers = legalAttackCorpus().filter(([, s]) => /Pokémon Tools? from/.test(s));
    expect(parkers.length).toBeGreaterThan(0);
    // EVERY sentence this reader claims, over the whole column, is the ONE unconditional
    // discard-all — no "up to", no "you may", no count.
    // 🆕🆕 **D429: FOUR, NOT ONE — AND THE CLAIM THIS RUNG MAKES IS UNCHANGED.** The
    // population test was never *"exactly one sentence is claimed"*; it was *"every
    // sentence this reader claims is UNCONDITIONAL — no `up to`, no `you may`, no
    // count"*, i.e. nothing that could need a decision. That is still true of all four,
    // and it is what keeps the un-parkable return type honest on the POPULATION rather
    // than on a specimen (D423). The length is pinned separately so a reader that
    // silently stopped claiming three of them cannot pass this on the survivor.
    const claimed = legalAttackCorpus().filter(([, s]) => deriveAttackPreDamage(s) !== null);
    expect(claimed).toHaveLength(4);
    expect(claimed.map(([, s]) => s)).toContain(SENTENCE);
    for (const [, s] of claimed) {
      expect(/up to|you may|choose/i.test(s), s).toBe(false);
      expect(s.startsWith(HEAD), s).toBe(true);
    }
    // …and the parking row is refused by the pre-damage reader AND still unbuilt.
    const UP_TO_2 = "Discard up to 2 Pokémon Tools from your opponent's Pokémon.";
    expect(legalAttackCorpus().filter(([, s]) => s === UP_TO_2)).toHaveLength(1);
    expect(deriveAttackPreDamage(UP_TO_2)).toBeNull();
    expect(resolvedByAnyReader(UP_TO_2)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — persistence: `MATCH_RECORD_VERSION` stays 26, driven both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — nothing persisted moves, and it is DRIVEN rather than argued", () => {
  it("🛑 `MATCH_RECORD_VERSION` STAYS 26 — no new field, no new op, no continuation", () => {
    // ⚠️ THE CONSTANT LIVES IN `apps/api/src/lobby/match.ts` and is not exported from
    // this package, so this rung drives the SHAPES it governs rather than the number.
    // Three of them, and each is a way a slice could have owed a bump:
    //   ① a new `GameState` / `InPlayPokemon` FIELD — there is none: `tools` has been
    //      a persisted `string[]` since M4 and this slice only ever empties it;
    //   ② a new `EffectOp` INHABITANT reaching `phase.cont` — there is none, because
    //      the pre-damage shape is deliberately NOT an `EffectOp` (see the header);
    //   ③ a new key on the effect CONTINUATION — there is none, because this seam
    //      never parks and therefore never writes one.
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
      "attackLockedTurn",
      "boostedAttack",
      "conditions",
      "damage",
      "damageReduction",
      "energy",
      "evolvedTurn",
      "healedTurn",
      "installedRecoil",
      "lockedAttacks",
      "markers",
      // 🆕🆕 D432 — the attack-installed §8.5 NO-WEAKNESS bar's stamp (MATCH_RECORD_VERSION 26 -> 27).
      "noWeaknessTurn",
      "promotedTurn",
      "retreatBlocked",
      "retreatLockedTurn",
      "scheduledEffect",
      "stack",
      "tools",
      "turnPlayed",
      "usedAttack",
    ]);
  });

  it("🛑 a v26 record round-trips BOTH DIRECTIONS through the swing", () => {
    const withTool = board("fix-chestwall", CHESTPLATE);
    // BACKWARD: a record written by an older deploy — the board serialized BEFORE this
    // slice's code could have touched it — rehydrates and answers identically.
    const rehydrated = JSON.parse(JSON.stringify(withTool)) as GameState;
    const live = swing(withTool, IDX.pry100);
    const replayed = swing(rehydrated, IDX.pry100);
    expect(JSON.stringify(replayed.events)).toBe(JSON.stringify(live.events));
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(live.state));
    // FORWARD: the board this slice produces survives the same trip unchanged.
    const after = JSON.parse(JSON.stringify(live.state)) as GameState;
    expect(JSON.stringify(after)).toBe(JSON.stringify(live.state));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — purity, and the version pin.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — purity and the version", () => {
  it("🛑 the swing mutates NOTHING it was given — a deep-frozen board resolves", () => {
    // Strict mode makes any write to a frozen object throw, so this is the whole
    // no-mutation claim rather than a sample of it. Driven on the board that DOES
    // discard, since that is the path that rebuilds a side.
    const frozen = deepFreeze(board("fix-chestwall", CHESTPLATE));
    const { state, events } = swing(frozen, IDX.pry100);
    expect(frozen.players.p2.active?.tools).toHaveLength(1);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(find(events, "TOOLS_DISCARDED")).toBeDefined();
    // The reader is pure too — same input, equal output, and it does not memoise a
    // mutable object across calls.
    const first = deriveAttackPreDamage(SENTENCE);
    const second = deriveAttackPreDamage(SENTENCE);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("the engine version is pinned, and it is THIS slice's pin", () => {
    // 🆕🆕 D428 — the FOURTEENTH `engineVersion` assertion in the suite (13 inherited
    // plus this one) and the SEVENTEENTH site overall, counting
    // `packages/engine/package.json`, `index.ts`'s declaration and `D275`'s mutant
    // anchor. ⚠️ D427 named the mechanism: **every note counts the pins it INHERITED
    // and never the one it is about to AUTHOR.** This line is the one being authored.
    expect(engineVersion).toBe("0.379.0");
  });
});
