import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackLocked } from "./continuous";
import * as effectsModule from "./effects";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { applyAction, engineVersion, programFor } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  BARE_ATTACK_LOCK_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.389.0 → 0.390.0 — 🆕🆕 D495: THE DEFENDER ATTACK LOCK BEHIND THE WINNING FACE
// OF A COIN, AND THE RE-DERIVATION OF THE PRICE D408 QUOTED FOR IT.
//
//   "Flip a coin. If heads, during your opponent's next turn, the Defending
//    Pokémon can't attack."   — `censusAttackCorpus.ts` FILE LINE 250, 1 legal
//                               printing. The card id is UNRESOLVABLE in this
//                               checkout (no local D1, D425) and is NOT invented.
//
// 🛑 WHY THIS FILE EXISTS RATHER THAN A SECTION IN `bareAttackLock.test.ts`. That
// suite refused this sentence on its WITNESS and not on its arm, and it was right
// about half of the price it quoted: it is deliberately SEED-FREE and pins that
// with an unchanged `rngState` across a whole install, so a coin-gated BOARD there
// would turn a determinism claim into a coincidence of one shuffle. The board is
// here instead; that file keeps its seed-free rung and gains only a DERIVATION,
// which consumes no rng at all. ⚠️ The other half of the quoted price — "a fourth
// fixture" — was WRONG, and this file is the receipt: every board re-texts a
// SHIPPED fixture on its own `cardPool` clone (D414/D452), so `FIXTURE_POOL` gains
// no id, `opponentResistanceBonus.test.ts`'s eleven-deep `ids.length` ladder takes
// a ZERO term, and `clauseApostrophe.test.ts`'s derivable sweep — which iterates
// `FIXTURE_POOL`, not the corpus — does not move.
//
// ⚠️ ZERO NEW MECHANISM, WHICH IS WHAT MAKES THIS ONE REGEX AND ONE ARM. The op,
// its `target` field, the `+ 1` stamp derived from that field, the §8 gate, the
// four §10 clears, the `ATTACK_LOCKED` event, its `log.ts` arm and both payability
// projections are D148's/D408's; `coinFlipGate` and its `then` are 0.x's. The two
// have ALREADY MET — arm 26 has emitted `coinFlipGate { onTails, then:
// [preventAttack] }` since D144 — so this is NOT the first durated op inside a
// gate, which is a claim about a CLASS and was checked before it was written
// (D443) rather than asserted from the op's category.
//
// 🛑 THE SEEDS ARE SEARCHED, NOT STUBBED, AND NOT TABLED. `flipStatusHeadsTails`'s
// idiom: take a REAL flip at the real site and keep the board whose face is the one
// the case needs. A stubbed `rngState` would answer about the stub, and a pinned
// seed TABLE (`preventBlock.test.ts`'s) rests on an invariant this file does not
// have — that the install is the first coin the board draws AND that the surgeries
// consume no rng — which a re-text plus two attachments is not obviously under.

/** The PRINTED sentence, and the two SHIPPED controls its program must EQUAL
    rather than merely resemble. All three are read back off `legalAttackCorpus()`
    in §1 rather than trusted as typed bytes (D452/D490). */
const PRINTED =
  "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't attack.";
const DEFENDER_BARE = "During your opponent's next turn, the Defending Pokémon can't attack.";
const DEFENDER_PLURAL =
  "During your opponent's next turn, the Defending Pokémon can't use attacks.";
/** D142's gated PREVENT clause — the CONSEQUENT axis's nearest BUILT spelling. */
const GATED_PREVENT =
  "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks.";

/** `fix-deflock` — "Frost Bind" ({C}, 30) at 0 and "Glacier Hold" ({C}{C}, 30) at
    1. Index 0 is the one re-texted; index 1 is left alone so every board carries
    the UNGATED sibling as an in-file control on the same body. */
const INSTALL_INDEX = 0;
const SIBLING_INDEX = 1;
/** `fix-attacker` — the victim. "Bite" ({C}, 30) at 0 and a COSTLESS "Yawn" at 2,
    so a refusal on this body is never an Energy shortfall wearing the lock's face. */
const VICTIM_FREE_INDEX = 2;
const SEEDS = 400;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function refusal(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? "ok" : result.error.code;
}

/** Re-text `fix-deflock`'s attack 0 on a board's OWN `cardPool` copy.
    ⚠️ NOT A FIXTURE EDIT — `FIXTURE_POOL` is shared by every suite in this package
    and D412 reddened three of D409's boards by widening a shared one. This mutates
    a per-board clone, so nothing outside the calling board can see it, and the
    slice adds NO `FIXTURE_POOL` id (D414/D452). */
function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["fix-deflock"] as Card | undefined;
  if (card === undefined) throw new Error("no fix-deflock in pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("fix-deflock has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-deflock": { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    installer goes on P1's Active with two {C}; the victim on P2's. */
function board(seed: number, effect: string = PRINTED): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: BARE_ATTACK_LOCK_DECK, p2: BARE_ATTACK_LOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p2", "fix-attacker");
  state = setActiveFromDeck(state, "p1", "fix-deflock");
  if (state.turn !== 2) throw new Error(`board() expected turn 2, got ${state.turn}`);
  return withEffect(attachFromDeck(state, "p1", "fix-energy", 2), effect);
}

function swing(state: GameState, index = INSTALL_INDEX): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** A board seeded so the ONE coin lands the way the case needs. ⚠️ THE SEED IS
    SEARCHED, NOT STUBBED — the RNG is part of what this file claims about a gate,
    and a stub would answer about the stub. A seed whose setup cannot build the
    board is SKIPPED rather than counted. */
function flipBoard(wantHeads: boolean, effect: string = PRINTED): GameState {
  for (let seed = 1; seed < SEEDS; seed++) {
    let candidate: GameState;
    try {
      candidate = board(seed, effect);
    } catch {
      continue;
    }
    const flip = find(swing(candidate).events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip?.result === (wantHeads ? "heads" : "tails")) return candidate;
  }
  throw new Error(`no seed under ${SEEDS} gives ${wantHeads ? "heads" : "tails"}`);
}

/** The seed `flipBoard(true)` settles on, found once and reused so the gated and
    bare boards differ in the printed TEXT and in nothing else. */
function bareSeed(): number {
  for (let seed = 1; seed < SEEDS; seed++) {
    let candidate: GameState;
    try {
      candidate = board(seed);
    } catch {
      continue;
    }
    if (find(swing(candidate).events, "ATTACK_EFFECT_COIN_FLIP")?.result === "heads") return seed;
  }
  throw new Error("no heads seed");
}

function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed datum, the anchor, and the widening that buys nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the datum and the anchor", () => {
  it("the specimen IS a row of the committed corpus, at its committed count", () => {
    // 🛑 D452/D490: a byte pin measures an invention exactly as faithfully as it
    // measures the truth, so the string is checked against `legalAttackCorpus()`
    // rather than against this file's own constant. The two SHIPPED controls are
    // checked the same way, because the arm's whole claim is an EQUALITY with them.
    expect(legalAttackCorpus().filter(([, s]) => s === PRINTED)).toEqual([[1, PRINTED]]);
    expect(legalAttackCorpus().filter(([, s]) => s === DEFENDER_BARE)).toEqual([[3, DEFENDER_BARE]]);
    expect(legalAttackCorpus().filter(([, s]) => s === GATED_PREVENT)).toEqual([[4, GATED_PREVENT]]);
    // Both apostrophe slots measured with `codePointAt`, never by eye (D421/D440).
    expect([PRINTED.codePointAt(43), PRINTED.codePointAt(82)]).toEqual([0x27, 0x27]);
    expect([PRINTED[43], PRINTED[82]]).toEqual(["'", "'"]);
    // No authored row behind the body: the printed text IS the program.
    expect(programFor("fix-deflock")).toBeUndefined();
  });

  it("survives a U+2019 re-ingest — BOTH apostrophe slots are classed (D136/D137)", () => {
    // ⚠️ THIS RUNG EXISTS BECAUSE `clauseApostrophe.test.ts` CANNOT SEE THIS
    // SENTENCE. That suite's derivable sweep iterates `FIXTURE_POOL`, and this
    // slice's demonstrator is a per-board `cardPool` clone — which is the whole
    // point of the clone, and it means the file-wide re-ingest guard has no subject
    // here. Without this rung a `['’]` → `'` mutation on either slot would be
    // UNKILLABLE-AS-WRITTEN (D479) and would have shipped as a silent survivor.
    const curly = PRINTED.replaceAll("'", "\u2019");
    expect(curly).not.toBe(PRINTED);
    expect(curly.codePointAt(43)).toBe(0x2019);
    expect(curly.codePointAt(82)).toBe(0x2019);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
    // …and slot by slot, so a class kept on ONE of the two still reddens (D427's
    // one-axis rule: a near miss that differs on two axes tests neither).
    const possessiveOnly = PRINTED.replace("opponent's", "opponent\u2019s");
    const contractionOnly = PRINTED.replace("can't", "can\u2019t");
    expect(deriveAttackEffect(possessiveOnly)).toEqual(deriveAttackEffect(PRINTED));
    expect(deriveAttackEffect(contractionOnly)).toEqual(deriveAttackEffect(PRINTED));
  });

  it("derives ONE `coinFlipGate` whose `then` is the BARE anchor's whole program", () => {
    // 🛑 THE FAMILY'S CHECKABLE CLAIM SINCE D134, asserted as an EQUALITY rather
    // than as a resemblance: there is ONE action here, printed four ways, and the
    // coin is procedure in front of it.
    expect(deriveAttackEffect(PRINTED)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "preventAttack", target: "defender" }],
      },
    ]);
    const gate = (deriveAttackEffect(PRINTED) as EffectOp[])[0] as {
      op: string;
      then: EffectOp[];
    };
    expect(gate.then).toEqual(deriveAttackEffect(DEFENDER_BARE));
    // …and it is the ONE-op program: nothing is appended, so nothing rides behind
    // the gate into a continuation (§8's reachability half).
    expect((deriveAttackEffect(PRINTED) as EffectOp[]).length).toBe(1);
    // NO `onTails`: the field is ABSENT on every heads sibling and `true` only on
    // D144's, so a heads-gated program stays `toEqual`-identical to the registry
    // rows it is compared against (D135's absent-field rule).
    expect(Object.keys(gate).sort()).toEqual(["op", "then"]);
  });

  it("D472 — the VERB-WIDENED anchor claims exactly the same rows, so the tight one ships", () => {
    // 🛑 THE MEASUREMENT, KEPT AS A RUNG RATHER THAN AS PROSE (D464/D477). The BARE
    // anchor carries `can't (?:attack|use attacks)` because the pool prints both
    // spellings ungated. Under the GATE it prints only one — measured over all 640
    // corpus rows, the alternation claims the same 1 sentence / 1 printing as the
    // literal verb. A widening that claims no additional row is PURE RISK (D472),
    // so the shipped anchor spells the verb and this rung is why.
    const tight =
      /^Flip a coin\. If heads, during your opponent['’]s next turn, the Defending Pokémon can['’]t attack\.$/;
    const wide =
      /^Flip a coin\. If heads, during your opponent['’]s next turn, the Defending Pokémon can['’]t (?:attack|use attacks)\.$/;
    const rows = legalAttackCorpus();
    const claimed = (re: RegExp): [number, number] => {
      const hit = rows.filter(([, s]) => re.test(s));
      return [hit.length, hit.reduce((sum, [n]) => sum + n, 0)];
    };
    expect(claimed(tight)).toEqual([1, 1]);
    expect(claimed(wide)).toEqual([1, 1]);
    // …and the gated PLURAL is therefore genuinely unread, which is what makes the
    // narrowness a decision rather than an omission.
    expect(
      deriveAttackEffect(
        "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't use attacks.",
      ),
    ).toBeNull();
    // The UNGATED plural still reads, so the refusal above is the GATE's and not
    // the verb's — one axis, one difference (D427).
    expect(deriveAttackEffect(DEFENDER_PLURAL)).toEqual([
      { op: "preventAttack", target: "defender" },
    ]);
  });

  it("disjointness is STRUCTURAL, so the arm's position is legibility (D467/D468)", () => {
    // Both neighbours are `^…$` and disagree with this anchor on a MANDATORY run of
    // bytes at the same position — `During` vs `Flip a coin.` at 0 for the bare
    // arm, and `If heads,`/`If tails,` plus `your opponent's`/`your` for D144's. No
    // string can match two of them, so there is no guard here and correctly none:
    // one would be unkillable by construction, which is a vacuous guard (D205/D208).
    expect(deriveAttackEffect("Flip a coin. If tails, during your next turn, this Pokémon can't attack.")).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      { op: "coinFlipGate", onTails: true, then: [{ op: "preventAttack" }] },
    ]);
    // A prefix, a suffix and a truncation are all refused — the `^`, the `$` and the
    // terminator each doing their own job.
    expect(deriveAttackEffect(`Then, ${PRINTED}`)).toBeNull();
    expect(deriveAttackEffect(PRINTED.slice(0, -1))).toBeNull();
    // The TAILS face on THIS consequent is unprinted and refused.
    expect(
      deriveAttackEffect(
        "Flip a coin. If tails, during your opponent's next turn, the Defending Pokémon can't attack.",
      ),
    ).toBeNull();
  });

  it("ONE reader owns it and the other TWELVE still refuse (D438)", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    for (const name of attackReaderSurface()) {
      if (name === "deriveAttackEffect") continue;
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      expect(read?.(PRINTED) ?? null, name).toBeNull();
    }
    // The surface COUNT beside the loop, because a loop over a shrinking surface
    // stays green (D417: pin the diff AND the count).
    expect(attackReaderSurface()).toHaveLength(13);
    // …and NO splitter serves it either, so the RAW summand moves ALONE.
    expect(effectsModule.splitAttackGateClause(PRINTED)).toBeNull();
    expect(effectsModule.splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(effectsModule.splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(effectsModule.splitAttackCancelClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the axis-substitution lattice, executable rather than narrated.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the 2² lattice, and why it warrants a whole-sentence anchor", () => {
  it("🛑 BOTH weight-1 points build and the weight-2 point does NOT", () => {
    // 🛑 THE OPPOSITE SHAPE FROM D489/D490/D494, whose lattices had exactly ONE
    // built point at FULL weight ("no proper subset builds"). Here every SEGMENT of
    // the print is already claimed and only the COMBINATION has no reader — which
    // is the whole warrant: there is no prerequisite half to build first and no
    // proper superset to compose from.
    //
    // The two axes, each substituted onto its nearest BUILT spelling that DIFFERS
    // from the print (D489/D491 — an axis whose nearest built spelling IS the print
    // is degenerate, and by that strict test BOTH of this sentence's segments are
    // degenerate, which is exactly the finding above stated the other way round).
    const GATE = ["Flip a coin. If heads, ", ""] as const;
    const CONS = [
      "the Defending Pokémon can't attack",
      "prevent all damage done to this Pokémon by attacks",
    ] as const;
    const point = (g: number, c: number): string =>
      `${GATE[g]}${GATE[g] === "" ? "During" : "during"} your opponent's next turn, ${CONS[c]}.`;
    // ⚠️ THE PRE-SLICE VERDICT IS DERIVED FROM THE CURRENT ONE, NOT QUOTED (D491):
    // `before = now && point !== PRINTED`, sound because §1 measures over all 640
    // corpus rows that the new anchor claims exactly one string.
    const now = (g: number, c: number): boolean => deriveAttackEffect(point(g, c)) !== null;
    // ⚠️ NOT named `before` — Biome's `noDuplicateTestHooks` reads a local of that name
    // inside a `describe` as vitest's hook and fails the lint step (D455: a new file is
    // held to the repo's lint rules from the moment it lands).
    const preSlice = (g: number, c: number): boolean => now(g, c) && point(g, c) !== PRINTED;
    expect([preSlice(0, 0), preSlice(0, 1), preSlice(1, 0), preSlice(1, 1)]).toEqual([
      false, // w=0 — the print
      true, //  w=1 — CONSEQUENT substituted: corpus line 248, D142's gated prevent
      true, //  w=1 — GATE absent: corpus line 187, D408's bare lock
      false, // w=2 — both: CONSTRUCTED, not printed (D440), and refused
    ]);
    // …and AFTER the slice exactly ONE point moved, and it is the print.
    expect([now(0, 0), now(0, 1), now(1, 0), now(1, 1)]).toEqual([true, true, true, false]);
    expect(point(0, 0)).toBe(PRINTED);
    // The w=2 point is a construction the pool does not print, and saying so is
    // what keeps this a claim about the READER rather than about the pool (D440).
    expect(legalAttackCorpus().some(([, s]) => s === point(1, 1))).toBe(false);
  });

  it("FACE is a VALUE in the GATE slot, not a third axis (D494)", () => {
    // The slot has THREE inhabitants — absent, `If heads,`, `If tails,` — and the
    // richness lives INSIDE an axis already counted. Swapping heads for tails
    // refuses on BOTH consequents, so a 2³ table would be the 2² table twice.
    for (const cons of [
      "the Defending Pokémon can't attack",
      "prevent all damage done to this Pokémon by attacks",
    ]) {
      expect(
        deriveAttackEffect(`Flip a coin. If tails, during your opponent's next turn, ${cons}.`),
        cons,
      ).toBeNull();
    }
  });

  it("SEAT and VERB are INERT on the verdict (D491)", () => {
    // All six GATE-present points refuse; all six GATE-absent points build. So the
    // 2 × 2 × 3 sub-lattice's verdict depends on the GATE alone, and listing SEAT or
    // VERB as axes would carry dimensions that cannot move it.
    const SEAT = [
      { dur: "your opponent's", subj: "the Defending Pokémon" },
      { dur: "your", subj: "this Pokémon" },
    ] as const;
    const VERB = ["attack", "use attacks", "retreat"] as const;
    const gated: boolean[] = [];
    const bare: boolean[] = [];
    for (const seat of SEAT) {
      for (const verb of VERB) {
        const tail = `${seat.dur} next turn, ${seat.subj} can't ${verb}.`;
        const point = `Flip a coin. If heads, during ${tail}`;
        // ⚠️ THE PRE-SLICE VERDICT, DERIVED FROM THE CURRENT ONE (D491) — the print
        // itself is now BUILT, so quoting today's answer would report the slice
        // rather than the lattice.
        gated.push(deriveAttackEffect(point) !== null && point !== PRINTED);
        bare.push(deriveAttackEffect(`During ${tail}`) !== null);
      }
    }
    expect(gated).toEqual([false, false, false, false, false, false]);
    expect(bare).toEqual([true, true, true, true, true, true]);
    // ⚠️ VERB is degenerate in the derived VALUE as well, for two of its three
    // spellings: D408 reads `attack` and `use attacks` under ONE anchor into ONE
    // program, so a lattice keyed on the verb would report a dimension the reader
    // does not have.
    expect(deriveAttackEffect(DEFENDER_BARE)).toEqual(deriveAttackEffect(DEFENDER_PLURAL));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — HEADS on a real board.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the winning face installs the lock", () => {
  it("files the coin row and the lock row, in printed order, on the DEFENDER", () => {
    const { state, events } = swing(flipBoard(true));
    const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
    expect(flip?.result).toBe("heads");
    expect(flip?.seat).toBe("p1");
    const lock = find(events, "ATTACK_LOCKED");
    // The lock is filed against the VICTIM's seat and the victim's body — the
    // event's `seat`/`uid` are the LOCKED body's, not the actor's.
    expect(lock?.seat).toBe("p2");
    expect(lock?.uid).toBe(state.players.p2.active?.stack.at(-1));
    // Order: the coin decides before the consequent runs.
    expect(events.findIndex((e) => e.type === "ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
      events.findIndex((e) => e.type === "ATTACK_LOCKED"),
    );
    // 🛑 A TAILS WOULD BE A RESOLVED ATTACK, SO A HEADS IS NOT A SKIPPED EFFECT
    // EITHER — the loud channel must be silent on both faces (D134's reading).
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("the stamp is `state.turn + 1`, and it is the DEFENDER's next turn", () => {
    const before = flipBoard(true);
    const { state } = swing(before);
    expect(state.players.p2.active?.attackLockedTurn).toBe(before.turn + 1);
    // …and the installer's own body is untouched: `target: "defender"` decides both
    // the seat and the arithmetic, from ONE field (the op's own doc block's claim).
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
    // The window is OPEN right now — this is P2's turn 3.
    expect(state.turn).toBe(3);
    expect(attackLocked(state, state.players.p2.active as InPlayPokemon)).toBe(true);
  });

  it("the §8 declaration gate refuses the victim's attack, on a COSTLESS index", () => {
    // The refusal is the lock's and not an Energy shortfall wearing its face:
    // `fix-attacker` index 2 is free, so nothing else can be the reason.
    const { state } = swing(flipBoard(true));
    expect(refusal(state, "p2", VICTIM_FREE_INDEX)).toBe("ATTACK_PREVENTED");
    // …and the DAMAGE still landed, so the attack that locked resolved normally.
    expect(state.players.p2.active?.damage).toBe(30);
  });

  it("`log.ts` RENDERS both rows, and the wording is read rather than reasoned about (D456)", () => {
    // 🛑 RENDER THE ROW RATHER THAN REASONING ABOUT IT. The two arms are shipped and
    // take no diff; what this rung establishes is that they SAY something true on
    // this program's events, which is the check no census and no mutant can make.
    const { state, events } = swing(flipBoard(true));
    const rows = rendered(state, events);
    expect(rows).toContainEqual({ who: "p1", text: "flipped heads for the effect" });
    expect(rows.map((r) => r.text)).toContainEqual(
      expect.stringMatching(/can't attack next turn$/),
    );
    // ⚠️ THE HONEST LIMIT, RECORDED AT THE RUNG (D421/D456): the `ATTACK_LOCKED` arm
    // says "next turn" with NO mention of the coin, so a reader who missed the flip
    // row cannot tell a gated install from an unconditional one. That is not false —
    // the lock really does last one turn, and the coin row sits directly above it —
    // and it is the reason no `log.ts` byte is owed here. The row would only become
    // FALSE if the gate could install a bar with a different clock, which it cannot.
    const flipAt = rows.findIndex((r) => r.text === "flipped heads for the effect");
    const lockAt = rows.findIndex((r) => r.text.endsWith("can't attack next turn"));
    expect(flipAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBe(flipAt + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — TAILS on a real board: the control that makes §3 mean anything.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the losing face installs nothing, and is not a skipped effect", () => {
  it("no lock, no `ATTACK_LOCKED`, and the victim attacks freely", () => {
    const { state, events } = swing(flipBoard(false));
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(find(events, "ATTACK_LOCKED")).toBeUndefined();
    expect(state.players.p2.active?.attackLockedTurn).toBeNull();
    expect(attackLocked(state, state.players.p2.active as InPlayPokemon)).toBe(false);
    expect(refusal(state, "p2", VICTIM_FREE_INDEX)).toBe("ok");
  });

  it("🛑 a TAILS is a RESOLVED attack, not a skipped effect (D134's reading)", () => {
    // The sentence was READ, the coin decided, and a loud `ATTACK_EFFECT_SKIPPED`
    // row would be a lie about a card that worked. This is the rung that separates
    // "the gate ran and lost" from "the engine could not read the sentence" — two
    // states with identical boards and opposite meanings.
    const { state, events } = swing(flipBoard(false));
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(state.turn).toBe(3);
    // The coin row still renders, so a player can see WHY nothing happened.
    expect(rendered(state, events)).toContainEqual({
      who: "p1",
      text: "flipped tails for the effect",
    });
  });

  it("the UNGATED sibling on the same body still locks unconditionally", () => {
    // ⚠️ THE CONTROL FOR THE GATE ITSELF. `fix-deflock` index 1 is untouched by the
    // re-text and prints D408's bare plural, so on the SAME board and the SAME seed
    // that produced a tails above, the sibling installs regardless. Without this a
    // suite asserting "tails installs nothing" is green on a build where NOTHING
    // installs.
    const tailsBoard = flipBoard(false);
    const { state, events } = swing(tailsBoard, SIBLING_INDEX);
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")).toBeUndefined();
    expect(find(events, "ATTACK_LOCKED")?.seat).toBe("p2");
    expect(state.players.p2.active?.attackLockedTurn).toBe(tailsBoard.turn + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the DURATION: expiry, and the body leaving play inside the window.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — a durated op inside a gate has a lifetime, and it is D148's", () => {
  it("EXPIRES by arithmetic: the bar is gone on the victim's FOLLOWING turn", () => {
    // 🛑 THERE IS NO SWEEP AND NO SCHEDULED EXPIRY — `attackLocked` is
    // `attackLockedTurn === state.turn`, so a spent stamp simply stops matching.
    // The rung has to drive PAST the boundary and assert the victim attacks, not
    // merely read the field back (D434's clear-rung rule).
    let held = swing(flipBoard(true)).state;
    expect(refusal(held, "p2", VICTIM_FREE_INDEX)).toBe("ATTACK_PREVENTED");
    held = must(applyAction(held, { type: "endTurn", seat: "p2" }));
    held = must(applyAction(held, { type: "endTurn", seat: "p1" }));
    expect(held.turn).toBe(5);
    // The STAMP is still sitting on the body — nothing cleared it — and it no
    // longer matches, which is the whole of D124's arithmetic expiry.
    expect(held.players.p2.active?.attackLockedTurn).toBe(3);
    expect(attackLocked(held, held.players.p2.active as InPlayPokemon)).toBe(false);
    expect(refusal(held, "p2", VICTIM_FREE_INDEX)).toBe("ok");
  });

  it("RETREATING inside the window clears it, and the body comes off the Active Spot free", () => {
    // §10: `clearOnLeavingActive` nulls the stamp. The victim's own turn IS the
    // window, so this is live counterplay rather than a corner (D434's inversion).
    let held = swing(flipBoard(true)).state;
    const locked = held.players.p2.active?.stack.at(-1);
    held = attachFromDeck(held, "p2", "fix-energy", 1);
    held = must(
      applyAction(held, {
        type: "retreat",
        seat: "p2",
        discardEnergy: (held.players.p2.active?.energy ?? []).slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    const benched = held.players.p2.bench.find((p) => p.stack.includes(locked as string));
    expect(benched?.attackLockedTurn).toBeNull();
    // …and the promoted body was never locked, so the bar did not travel.
    expect(held.players.p2.active?.attackLockedTurn).toBeNull();
  });

  it("a KNOCKED OUT victim takes the lock out of play with the stack", () => {
    // No §10 clear is written or needed here: `knockOut` discards the stack and the
    // promoted body is a DIFFERENT `InPlayPokemon`. The lock cannot travel.
    let held = swing(flipBoard(true)).state;
    const victim = held.players.p2.active as InPlayPokemon;
    expect(victim.attackLockedTurn).toBe(3);
    // Damage it to lethal by hand rather than by a second attack, so the board this
    // rung is about is the KO and not another install.
    held = {
      ...held,
      players: {
        ...held.players,
        p2: { ...held.players.p2, active: { ...victim, damage: 10_000 } },
      },
    };
    held = must(applyAction(held, { type: "endTurn", seat: "p2" }));
    let next = held;
    if (next.phase.kind === "ko:takePrizes") {
      next = must(applyAction(next, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    }
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p2", benchIndex: 0 }));
    }
    // ⚠️ NOT WRAPPED IN AN `if` — a conditional assertion here would pass on a board
    // where the KO never happened, which is the vacuity this file's §6 is about.
    const promoted = next.players.p2.active as InPlayPokemon;
    expect(promoted).not.toBeNull();
    expect(promoted.stack).not.toContain(victim.stack.at(-1));
    expect(promoted.attackLockedTurn).toBeNull();
    expect(attackLocked(next, promoted)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the §11 shield: DECLINED here, with the reason and the falsifier.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the §11 interaction is INHERITED, and this deck cannot drive it", () => {
  it("🛑 DECLINED rather than shipped vacuous, and the falsifier is executable", () => {
    // 🛑 A GUARD MUST BE ABLE TO GO RED (D200/D203). `preventAttack` asks §11 through
    // `effectRefused(state, seat, ctx, events)`, and the only things that can make
    // that answer `true` on the ATTACK channel are PASSIVES — `passivesOf(state,
    // target)`, which reads `programFor(cardId)?.passive`, a REGISTRY lookup keyed
    // by card id. A per-board `cardPool` clone cannot inject one, and this file must
    // not add a source to `BARE_ATTACK_LOCK_DECK`: D412 reddened three of D409's
    // boards by widening a shared deck, and every seeded board in this family deals
    // off its own shuffle. So the rung this section wanted is unavailable, and a
    // draft that set a made-up field on the victim PASSED WHILE ASSERTING NOTHING —
    // which is the failure this note exists instead of.
    //
    // WHAT CARRIES THE CLAIM INSTEAD is §7's equality: the gated arm reaches the
    // SAME `preventAttack` op, with the same `target`, through the same interpreter
    // function as D408's bare anchor — so its §11 behaviour is not "similar", it is
    // the same lines, already driven for the bare install in `defenderLock.test.ts`.
    // A gate is procedure in FRONT of the action; it does not reach past it.
    //
    // ⚠️ THE FALSIFIER, EXECUTABLE (D428): every id in this deck is registry-free
    // today, so no body on either board can carry a shielding passive. The day one
    // of them gains a registry row, this rung goes RED and names the id — which is
    // exactly the day the board becomes available and the decline expires.
    for (const id of ["fix-lockplural", "fix-deflock", "fix-attacker", "fix-energy", "fix-titan"]) {
      expect(programFor(id), id).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the describer trace, and `MATCH_RECORD_VERSION` at the HARD address.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — what this slice does NOT owe, traced rather than argued", () => {
  it("🛑 `withConsequence` is UNREACHABLE for this program — the CALL PATH, not the category", () => {
    // D478/D489, third and fourth slice running: "it is a gate, so describers apply"
    // is a CATEGORY argument and category arguments do not survive contact with a
    // single-call-site helper. `withConsequence` has ONE caller — `runProgram`'s
    // `if ("park" in stepped)` branch — and `describeBranch`/`describeCondition` are
    // reached only from inside it, only when the PARKING op has a `recordSlotOf` and
    // the queue holds a matching `recordGate`. This program has NO parking op at
    // all, so the branch is never entered.
    const { state } = swing(flipBoard(true));
    expect(state.phase.kind).not.toBe("effect:choose");
    // …and on the LOSING face too, because a whiff is not a park and the two are
    // easy to confuse in a `stepOp` arm (D465).
    expect(swing(flipBoard(false)).state.phase.kind).not.toBe("effect:choose");
    // `conditionNote` is likewise untouched: it takes a `BoardCondition`, and this
    // program carries none. (The nearest sibling arm, `DEFENDER_BASIC_CANT_ATTACK`,
    // does — which is why the category argument looks plausible from one arm away.)
    expect(deriveAttackEffect(PRINTED)).not.toContainEqual(
      expect.objectContaining({ op: "conditionGate" }),
    );
  });

  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — the SERIALIZED ALPHABET, at the durated address", () => {
    // 🛑 THIS IS THE FAMILY WHERE A BUMP CAN ACTUALLY BE FORCED (D487: only a repair
    // that RESHAPES a durated record forces one), so the ADDRESS is named first
    // rather than a carrier being reasoned from (D427/D443/D456).
    //
    // THE DURATED RECORD IS `InPlayPokemon.attackLockedTurn` — a REQUIRED field
    // persisted directly inside `MatchRecord.state`, every save, park or no park.
    // D456's precondition therefore applies: the reachability argument is about
    // `EffectOp`s and says nothing about a `GameState` field.
    //
    // IT IS UNRESHAPED. This arm writes the SAME field, of the SAME type, at the
    // SAME `state.turn + 1` stamp, through the SAME writer that D148's compound and
    // D408's bare anchor already use — asserted here as an EQUALITY of the two
    // boards rather than as a claim about the code.
    const gated = swing(flipBoard(true)).state.players.p2.active?.attackLockedTurn;
    // ⚠️ NOT `flipBoard` — the BARE sentence flips no coin at all, so a face search
    // over it would spin to its budget and throw. Any seed serves; this one is the
    // seed the heads search returned, so the two boards differ ONLY in the text.
    const bareBoard = board(bareSeed(), DEFENDER_BARE);
    const bare = swing(bareBoard).state.players.p2.active?.attackLockedTurn;
    expect(gated).toBe(bare);
    // AND THE OP ALPHABET GAINS NOTHING (D462/D463's shape): every byte of the
    // derived program is one a v29 deploy already writes — `coinFlipGate` and its
    // `then` from D142's arms, `preventAttack` with `target: "defender"` from
    // D408's. `JSON.stringify` of the new program's parts against the shipped ones:
    const shippedGate = deriveAttackEffect(GATED_PREVENT) as EffectOp[];
    const shippedLock = deriveAttackEffect(DEFENDER_BARE) as EffectOp[];
    const built = deriveAttackEffect(PRINTED) as EffectOp[];
    expect((built[0] as { op: string }).op).toBe((shippedGate[0] as { op: string }).op);
    expect(Object.keys(built[0] as object).sort()).toEqual(
      Object.keys(shippedGate[0] as object).sort(),
    );
    expect(JSON.stringify((built[0] as { then: EffectOp[] }).then)).toBe(
      JSON.stringify(shippedLock),
    );
    // ⚠️ REACHABILITY IS THE WEAKER HALF AND IS STATED SECOND (D452: state both).
    // The program is length ONE and neither op parks, so nothing this slice
    // produces can reach `phase.cont.pendingOp` or its `rest` at all — driven on
    // BOTH faces, because a whiff is not a park.
    expect(built).toHaveLength(1);
    expect(swing(flipBoard(true)).state.phase.kind).not.toBe("effect:choose");
    expect(swing(flipBoard(false)).state.phase.kind).not.toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the census this row moves, and the engine version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the census moves in exactly ONE summand", () => {
  it("the resolving corpus gains ONE sentence and ONE printing", () => {
    // ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, measured at this
    // head rather than carried from the previous slice (D451/D461/D464).
    const rows = legalAttackCorpus();
    const units = (rs: readonly (readonly [number, string])[]): number =>
      rs.reduce((sum, [n]) => sum + n, 0);
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([540, 1578]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 +1 sentence / +2 printings — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`IN_PLAY_BOTH_SIDES_NAME_MULTIPLY`), ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay` — the FIRST both-sides count in that union to carry a `CardFilter`; `bothSidesBenchCount` and `bothActivesEnergyCount` are both BARE, because their printed nouns carry no adjective and this one's is NARROWED in print). 🛑 **THE SHIPPED ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the OPPOSITE answer to D510's one row up, and the reason this row genuinely owed a pattern: every in-play anchor requires the literal `for each of your ` and this sentence's head is SEATLESS, with the side named by a trailing parenthetical. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2**, measured at this head rather than carried (D451/D461). RAW summand ALONE: no registry row, no gate split and no trailing split — re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21.) (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD, THE MISSING CELL OF A SHIPPED 2×2** — `censusAttackCorpus.ts` **FILE LINE 517**, *"This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 3 legal printings**, claimed by `deriveAttackEffect` arm **6-i** over ONE new anchor (`SPREAD_EACH_BENCH_TAKEN_PRIZES`) and ONE OPTIONAL BOOLEAN RIDER on the SHIPPED `spreadDamage` (`perTakenPrize` — D448's own name spelled on a second op, so `snipeAmount`'s structural parameter folds it UNCHANGED). **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), prompts, choice kinds, parks, events, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 3**, so a `.length` site takes +1 where a `units(…)` site takes +3 — the largest single printing step left in the residue's spread family, and the reason this row was worth taking before smaller ones (D451, re-paid again).) (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) 
    // …and the step is ATTRIBUTABLE: remove THIS sentence and both figures fall by
    // exactly one, so nothing else moved under the slice.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([539, 1577]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group captured `Basic Energy cards of different types` WHOLE from the day it was written, and the refusal was one step later in `HAND_SEARCH_PLURAL.get` (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members, and no widening of that union could ever reach this row** — it rides D332's shipped `chooseCards.caps`, one cap of ONE per `energyProvidesOf` cell, so ZERO new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). **+1 sentence / +2 printings**, which this BEFORE-figure inherits because it is the live sum minus this slice's own row.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE `CardFilter` member and ONE parameterised noun, **ZERO new anchors**. ⚠️ The SENTENCE step and the PRINTING step DISAGREE at 1 and 2.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured per site rather than copied between the two kinds of site (D451/D461).) 🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD (corpus FILE LINE 517).** This pair is the resolving set MINUS this file's own sentence, so it steps by exactly what the line above it steps by — which is the point of measuring both: a slice that moved only one of the two would be visible here (D451/D465). (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) 
    // RAW SUMMAND ALONE — no registry row, no gate split, no trailing split.
    expect(programFor("fix-deflock")).toBeUndefined();
  });

  it("engineVersion is 0.400.0", () => {
    expect(engineVersion).toBe("0.400.0");
  });

  it("the demonstrator costs ZERO `FIXTURE_POOL` ids (D414/D452)", () => {
    // Every board in this file re-texts a SHIPPED fixture on its own `cardPool`
    // clone, so the pool is byte-unchanged and every `ids.length` ladder in the
    // package takes a ZERO term. The shared fixture still prints what it always
    // printed — checked here, so a future "simplification" into a FIXTURE_POOL edit
    // reddens rather than quietly taxing eleven chains.
    expect(FIXTURE_POOL["fix-deflock"]?.attacks?.[INSTALL_INDEX]?.effect).toBe(DEFENDER_BARE);
    expect(FIXTURE_POOL["fix-deflock"]?.attacks?.[SIBLING_INDEX]?.effect).toBe(DEFENDER_PLURAL);
    expect(FIXTURE_POOL[PRINTED]).toBeUndefined();
  });
});
