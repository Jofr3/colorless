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
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
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
    // All six GATE-present points refuse; all six GATE-absent points build. (🆕🆕🆕 D595: the
    // heads × opponent × retreat point now builds — excluded below as the printed one is.) So the
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
        // 🆕🆕🆕 D595 — the retreat point is Murkrow `30th-093`'s print, BUILT by arm 46b's coin gate;
        // it is excluded for the same reason (the D491 lattice is the pre-D495 verdict).
        const clutch = "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't retreat.";
        gated.push(deriveAttackEffect(point) !== null && point !== PRINTED && point !== clutch);
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
    expect([resolved.length, units(resolved)]).toEqual([600, 1663]);  // (🆕🆕🆕 **D579 +1 sentence / +1 printing — THE CENSUS CLOSE-OUT** — Koraidon `sv08-116` "Unrelenting Onslaught", claimed WHOLE by `deriveAttackDamageBonus` through one `CONDITIONAL_DAMAGE_CLAUSES` literal; Walking Wake `sv06-063` is a REGISTRY row and moves no reader figure.) (🆕🆕🆕 **D575 +6 sentences / +6 printings — THE MRV-38 ATTACK SLICE** — `deriveAttackEffect`'s six new whole-sentence anchors claim `censusAttackCorpus.ts` file lines 177 (Hypno "Daydream"), 181 (Miraidon "C.O.D.E.: Protect"), 182 (Iron Moth "Anachronism Repulsor"), 346 (N's Sigilyph "Victory Symbol"), 394 (Team Rocket's Blipbug "Searching Eyes") and 690 (Glimmora "Corrosive Shards", the compound claimed WHOLE) — one printing each, so the sentence and printing steps AGREE. A READER move.) (🆕🆕🆕 **D574 +3 sentences / +5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** — `deriveAttackCopy`'s two RESOLVE-TIME anchors claim `censusAttackCorpus.ts` file lines 434 and 131 WHOLE (Haughty Order ×3, Seek Inspiration) and `deriveAttackEffect`'s new anchor claims file line 649 (Sableye "Damage Collection"). Alakazam (686) composes through the TRAILING seam and Malamar (489) is a REGISTRY row — neither is a reader move. A READER move; the sentence step (3) and the printing step (5) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D573 +4 sentences / +9 printings — THE COPY-ATTACK SUBSTITUTION** — `deriveAttackCopy`, the FOURTEENTH reader, claims `censusAttackCorpus.ts` file lines 77, 78, 80 and 245 WHOLE: Night Joker ×4, Foul Play ×2 + Metronome, Gemstone Mimicry, Try to Imitate. A READER move; the sentence step (4) and the printing step (9) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** — Koraidon `sv05-119`/`svp-091` "Primordial Beatdown" (`IN_PLAY_BODY_NOUNS` "Ancient Pokémon"), Roaring Moon `sv05-109`/`sv08.5-065` "Vengeance Fletching" (`DISCARD_PILE_NOUNS` "Ancient card"), Iron Valiant `sv05-080` "Majestic Sword" and Slither Wing `sv06.5-026` "Iron Smasher" (two literal `CONDITIONAL_DAMAGE_CLAUSES` rows), all over `banners.ts`' widened table (582/1636 → 586/1642)) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES, NOW THAT THE BANNER HAS A WRITER** — Ho-Oh `sv08-019` "Shining Blaze" (*"If you have any Tera Pokémon on your Bench, this attack does 100 more damage."*) and Regigigas `sv08.5-086` "Jewel Breaker" (*"If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage."*), one legal printing each, two literal `CONDITIONAL_DAMAGE_CLAUSES` rows over `banners.ts` (580/1634 → 582/1636)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: reader arm 578/1632 → 580/1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: reader arm 577/1631 → 578/1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: reader arm 573/1627 → 577/1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: reader arm 572/1625 → 573/1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: reader arm 570/1621 → 572/1625.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: reader arm 568/1619 → 570/1621.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 567/1617 → 568/1619.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 566/1615 → 567/1617.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 563/1611 → 564/1613.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 562/1608 → 563/1611.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 561/1606 → 562/1608.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1603 → 561/1606.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence / +1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 sentence / +1 printing — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D530 +1 sentence / +1 printing — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.) (🆕🆕🆕 **D528 +1 sentence / +1 printing — THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER** — `censusAttackCorpus.ts` **FILE LINE 215**, *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_ATTACH_UP_TO_HEADS`, beside D525's, disjoint by VERB) as the SHIPPED member `programPerHeads` over ONE copy of D358's discard-spread op `attachEnergyFrom { source: "discard", energyType: "Lightning", benchOnly: true, declinable: true }` — H independent DECLINABLE parks over the Bench at `attack.ts`'s EXISTING fold (the distribution reading D358/D360 give "up to N … in any way you like", with N = heads); ZERO new op/filter/prompt/event/member vocabulary, NO fold or interpreter bytes, `MATCH_RECORD_VERSION` HELD at 30 (what parks is D358's op bytes). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1 (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE.) (🆕🆕🆕 **D527 +1 sentence / +1 printing — THE DYNAMIC-max HAND SEARCH — `searchDeck.max` GAINS THE LITERAL `"yourBenchCount"`, A SECOND WIDENING AT D514's PERSISTED ADDRESS** — `censusAttackCorpus.ts` **FILE LINE 454**, *"Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (svp-188 — no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`ATTACK_HAND_SEARCH_BENCH_COUNT`, a SEPARATE literal beside `ATTACK_HAND_SEARCH`, zero captures) as EXACTLY the sibling's two-op shape with the literal in `max` — `[{op:"searchDeck", filter:{kind:"anyCard"}, dest:"hand", max:"yourBenchCount"}, {op:"shuffleDeck"}]` — resolved at the park's `sized` map (`interpreter.ts`, where D514's `"any"` resolves) against the ATTACKER's Bench length at STEP time, captioned with the PRINTED phrase; ZERO new op/filter/prompt/event vocabulary, ONE persisted-field WIDENING with `MATCH_RECORD_VERSION` HELD at 30 (driven over a reconstructed v30 numeric op). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in both units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 553/1595 → 554/1596.) (🆕🆕🆕 **D526 +1 sentence / +1 printing — THE THREE-TIER HEADS LADDER — ZERO VOCABULARY, AN EIGHTH `AttackCoinFlip` MEMBER** — `censusAttackCorpus.ts` **FILE LINE 218**, *"Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 50 more damage. If all of them are heads, this attack does 80 more damage."*, **1 sentence / 1 legal printing** (no id on this checkout — D425), claimed by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_BONUS_LADDER`, beside D525's) as the EIGHTH member `bonusLadder {flips: printed 3, ladder: [20, 50, 80]}`, spent at `attack.ts`'s EXISTING damage fold as ONE table lookup (exclusive tiers: 1 head → +20, 2 → +50, 3 → +80, 0 → nothing — NOT cumulative, NOT per-heads), ZERO new op/filter/prompt/event vocabulary. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 (measured off the corpus row at THIS head, D451/D461) — the first single-unit sweep since D521, so every chain moves by ONE in both units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 552/1594 → 553/1595. `MATCH_RECORD_VERSION` HELD at 30: the member is never serialized.) (🆕🆕🆕 **D525 +1 sentence / +2 printings — THE HEADS COUNT READ AS AN "UP TO" CEILING BY ONE OP — ZERO VOCABULARY, A SEVENTH `AttackCoinFlip` MEMBER** — `censusAttackCorpus.ts` **FILE LINE 219**, *"Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand."*, **1 sentence / 2 legal printings** (Oinkologne; neither printing's id is on this checkout — D425), claimed by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_RETRIEVAL_UP_TO_HEADS`, beside D476's) as the SEVENTH member `retrievalUpToHeads {flips: printed 3, filter: anyCard, dest: hand}`, spent at `attack.ts`'s fold as ONE shipped `discardPileRetrieval {anyCard, hand, max: heads}` appended to the program when heads > 0 — the interpreter's own "up to" park (`chooseCards {min 0, max H}`), ZERO new op/filter/prompt/event vocabulary. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2** (measured off the corpus row at THIS head, D451/D461), so every SENTENCE chain moves by ONE and every PRINTING chain by TWO — a pass that copied one number into the other kind of site would be wrong in half of them (D431/D419). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 551/1592 → 552/1594. `MATCH_RECORD_VERSION` HELD at 30: the member is never serialized.) (🆕🆕🆕 **D524 +1 sentence / +1 printing — THE PURPOSE-CONNECTIVE OPTIONAL-COST BOOST WITH THE ALL-SELF-ENERGY-TO-HAND COST — ZERO VOCABULARY** — `censusAttackCorpus.ts` **FILE LINE 652**, *"You may put all Energy attached to this Pokémon into your hand to have this attack do 80 more damage."*, **1 sentence / 1 legal printing** (the printing's card is unresolvable on this checkout — D425), claimed by `deriveAttackOptionalCostBoost` through a SECOND SKELETON (`OPTIONAL_COST_PURPOSE_BOOST`, the purpose connective *"to have this attack do N more damage"* beside D381's `. If you do, `) over ONE new cost-table row (`OPTIONAL_COST_PUT_ALL_SELF_ENERGY_TO_HAND` → gate `yourActiveEnergyAtLeast 1`, op `discardEnergy yourActive anyEnergy all → hand`), assembled by the UNCHANGED `optionalCostBoostProgram`: D405's op at `all`, D383's gate at 1, D381's payoff and ZERO new vocabulary. ✅ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 and 1** (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in BOTH units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 550/1591 → 551/1592. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D523 +1 sentence / +1 printing — THE DECK-DESTINATION DISCARD-PILE RETRIEVAL ("Shuffle … from your discard pile into your deck") — ZERO VOCABULARY, AND A REFUSAL WHOSE PREMISE WAS FALSE OF THE LEGAL ATTACK COLUMN** — `censusAttackCorpus.ts` **FILE LINE 485**, *"Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck."*, **1 sentence / 1 legal printing** (the printing's card is unresolvable on this checkout — D425), claimed by `deriveAttackEffect` through the new `ATTACK_DISCARD_SHUFFLE_BACK` anchor (directly under D237's `ATTACK_DISCARD_RETRIEVAL`) and the arm directly after the D237 arm, deriving `[{op:"discardPileRetrieval",filter:{kind:"basicEnergy",energyType:"Water"},dest:"deck",max:3},{op:"shuffleDeck"}]` — PAL PAD's registry shape with the hand twin's own filter: TWO shipped ops and ZERO new vocabulary; the refusal that kept the row unbuilt (*"no attack sentence in the catalog spells"* the deck destination) was FALSE of the legal attack column, while its rule (a different verb is a different family) was right and is honoured by a separate anchor. ✅ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 and 1** (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in BOTH units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 549/1590 → 550/1591. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D522 +1 sentence / +1 printing — THE STADIUM-GATED BENCH SPREAD WITH THE STADIUM DISCARD — ZERO VOCABULARY, AND A REFUSAL RIGHT ABOUT THE OP AND WRONG ABOUT THE READER** — `censusAttackCorpus.ts` **FILE LINE 293**, *"If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (Ting-Lu `sv06-110`, whose base and cost are unresolvable on this checkout — D425), claimed by `deriveAttackEffect` through the new `STADIUM_GATED_BENCH_SPREAD` anchor (directly under D380's `MAY_DISCARD_STADIUM`) and arm 43-bis, deriving `[{op:"conditionGate",cond:{kind:"stadiumInPlay"},then:[{op:"spreadDamage",target:"opponentBench",amount:30},{op:"discardStadium"}]}]` — arm 43's exact shape minus the `optional`: THREE shipped ops and ZERO new vocabulary; the refusal that kept the row unbuilt was right about the OP (`discardStadium`, D380) and wrong about the READER (the middle clause is a SECOND HIT — the shipped body-set `spreadDamage` — never a bonus, so no `AttackBonusConsequent` join could read it; D521 (2)'s premise rule). ✅ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 and 1** (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in BOTH units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 548/1589 → 549/1590. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D521 +1 sentence / +2 printings — THE TWO-COIN BOTH-TAILS RECOIL — ZERO VOCABULARY, AND A REFUSAL WRONG IN ITS CARRIER** — `censusAttackCorpus.ts` **FILE LINE 202**, *"Flip 2 coins. If both of them are tails, this Pokémon also does 90 damage to itself."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackEffect` through the new `FLIP_TWO_BOTH_TAILS_SELF_DAMAGE` anchor (beside D145's one-coin `FLIP_TAILS_SELF_DAMAGE`) and the arm directly after D145's, deriving `[{op:"coinFlipGate",coins:2,onTails:true,then:[{op:"damageSelf",amount:90}]}]` — ONE shipped op behind D355's shipped `coins` field and ZERO new vocabulary; the refusal that kept the row unbuilt named the wrong carrier (`AttackFlipCount` is `deriveAttackCoinFlip`'s damage-count type; a one-body recoil behind a coin is a GATE, not a count — D520 (2)'s premise rule). ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one sentence, two legal printings (measured off the corpus row at THIS head, D451/D461) — so a pass that copied one number into the other kind of site would be wrong in half of them. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 547/1587 → 548/1589. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D520 +1 sentence / +1 printing — THE FOUR-ZONE DAMAGED-BODY SPREAD, AND D507's REFUSAL OVERTURNED IN VERDICT AND CARRIER** — `censusAttackCorpus.ts` **FILE LINE 601**, *"This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through the new `SPREAD_EACH_DAMAGED_FOUR_ZONE` anchor and arm 6-iii, deriving `[{op:"conditionGate",cond:{kind:"opponentActiveDamaged"},then:[{op:"damageDefender",amount:50}]},{op:"spreadDamage",target:"yourBench",amount:50,damagedOnly:true},{op:"spreadDamage",target:"opponentBench",amount:50,damagedOnly:true}]` — THREE shipped ops and ZERO new vocabulary: the Active predicate is the shipped ONE-BODY `BoardCondition` `opponentActiveDamaged` inside the shipped `conditionGate`, NOT a per-body rider on `damageDefender`'s flat arm (D507 priced it on that rider; the verdict AND the carrier were wrong — D479's third mode), the Benches are D507's two `damagedOnly` spreads, and *"except for this Pokémon"* is STRUCTURAL. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — measured off the corpus row at THIS head rather than assumed (D451/D461). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 546/1586 → 547/1587. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D519 +1 sentence / +1 printing — THE BODIES IN PLAY THAT ARE ALREADY HURT, A COUNT NARROWED BY A BOARD FACT** — `censusAttackCorpus.ts` **FILE LINE 596**, *"This attack does 50 damage for each of your Pokémon that has any damage counters on it."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through the new `IN_PLAY_DAMAGED_BODY_MULTIPLY` anchor and a `damagedOnly` rider on `DamageCountSource.pokemonInPlay`, deriving `{per:50,count:{kind:"pokemonInPlay",seat:"you",filter:{kind:"anyPokemon"},damagedOnly:true}}`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1 HERE** — measured off the corpus row at THIS head rather than carried from D518, whose two steps were 1 vs 2 (D451/D461). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 545/1585 → 546/1586. 🛑 **ZERO NEW UNION MEMBERS**: `DamageCountSource` stands still at 20, and the price is ONE anchor, ONE reader arm, ONE optional boolean and ONE argument. The count takes `hasAnyDamageCounters` — the SAME call behind the three shipped op riders — so predicate ⟺ count ≥ 1 holds by construction.**) (🆕🆕🆕 **D518 +1 sentence / +2 printings — THE §12 SPECIAL-CONDITION TALLY ON THE DEFENDING ACTIVE** — `censusAttackCorpus.ts` **FILE LINE 537**, *"This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new anchor (`OPPONENT_CONDITION_COUNT_MULTIPLY`) and ONE new `DamageCountSource` member (`specialConditionsOnOpponentActive`, the **20th**), whose walk is `presentStatuses` — the SAME projection the shipped `opponentActiveHasSpecialCondition` predicate folds, so *predicate ⟺ count ≥ 1* holds BY CONSTRUCTION rather than by two readers agreeing. 🛑 **THE SHIPPED PREDICATE COULD NOT PAY THIS ROW**: `DamageCountSource.boardCondition` is the 0-or-1 INDICATOR (D115), whose ceiling is `per` at every `per`, while this sentence pays `per` per CONDITION and a body can carry THREE. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2**, so a `.length` site takes +1 where a `units(…)` site takes +2 — measured off the corpus row rather than copied between the two kinds of site (D451/D461). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader surface stands still at **13**.) (🆕🆕🆕 **D517 +1 sentence / +1 printing — THE PRIZE-GATED PARALYSIS** — `censusAttackCorpus.ts` **FILE LINE 342**, *"If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-iii through ONE new anchor (`SELF_PRIZE_GATE_PARALYZE`) and ONE new `BoardCondition` member (`yourPrizesRemaining`, the **61st**) — the seat mirror of `opponentPrizesRemaining`, whose `counts` shape it copies byte for byte. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured off the corpus row at this head rather than assumed from the row being singular (D451/D461). 🛑 **THE CONSEQUENT WAS ALREADY BUILT AND THE GATE WAS THE WHOLE BLOCKER** — the bare *"Your opponent's Active Pokémon is now Paralyzed."* resolved through this very reader to this very `applyStatus` op before the slice. RAW summand ALONE — no registry row, no gate split, no trailing split (registry 10/16, gate 5/13, trailing 11/21 all re-measured unmoved) — and the reader surface stands still at **13**.) (🆕🆕🆕 **D516 +1 sentence / +1 printing — THE DRAW COUNT THAT READS THE OPPONENT'S HAND** — `censusAttackCorpus.ts` **FILE LINE 487**, *"Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through the new `SHUFFLE_HAND_DRAW_PER_OPPONENT_HAND` anchor and arm 44c, deriving `[{op:"handRefresh",who:"you",draw:{kind:"opponentHandSize"}}]`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — measured off the corpus row, not assumed (D451/D461/D466). ONE anchor, ONE arm, ONE `HandRefreshDraw` member (the FIFTH) and ONE evaluator arm in `handRefreshDrawCount`, which is the SOLE consumer that switches on the draw kind — established by DELETING the arm and reading `tsc` (D512's census-by-compile-error), not by grep. 🛑 **THE REFUSAL THAT ORDERED THIS WAS 37 DECISIONS OLD AND RIGHT IN EVERY CLAUSE**: `SHUFFLE_HAND_DRAW`'s block (D479) said this row *"needs a fifth member"* and drove the refusal as its own falsifier — D515's rule that a refusal naming WHAT IS MISSING ages well, paid at a second address one slice later. ⚠️ **THE COUNT IS A MEMBER OF `HandRefreshDraw` AND NOT A `DamageCountSource`** even though `cardsInOpponentHand` spells the identical printed phrase at corpus file line 564: that union's only evaluator is `attack.ts`'s `scaledAttackDamage`, FOUR of whose six parameters are attack-declaration facts that do not exist on the Trainer and Ability paths authoring every other `handRefresh`. [🆕🆕🆕 D599 (D539): "only evaluator" is WITHDRAWN, kept as written — interpreter.ts `stepOp`'s `drawCards.per` arm, a Trainer path, evaluates `cardsInOpponentHand` for Emma `me04-077`/`-107` through the same `countCardsInHand` walk; union-wide the claim was already stale since the D557/D569 `opponentBenchCount`/`pokemonInPlay` Extracts.] `AttackFlipCount` (*"Deliberately not a `DamageCountSource` arm"*) and `MaxHpScale` already made the same call in writing — four count vocabularies, zero embeddings. ✅ **ZERO new ops, op fields, op VALUES on shipped fields, prompts, choice kinds, events, error codes, `CardFilter`/`BoardCondition` members, registry rows, `FIXTURE_POOL` ids, `redact.ts` bytes or `packages/schema` bytes**; RAW summand ALONE — no registry row, no gate split, no trailing split — and the reader surface stands still at **13**. **`MATCH_RECORD_VERSION` STAYS 30, ARGUED AT THE HARD ADDRESS**: the serialized alphabet DOES grow (a fifth `draw.kind` no v30 deploy can write), so D452's *"this byte already ships"* out does NOT apply and the claim rests on REACHABILITY alone (D450) — re-measured over ALL TEN `handRefresh` producers, every one of which places the op, or the gate holding it, as the SOLE top-level op, so no `phase.cont.pendingOp` or `rest` can ever hold it. Driven in the LOSS direction in `handRefreshOpponentHand.test.ts` §8.)  // (🆕🆕🆕 **D515 +1 sentence / +1 printing — THE THIRD MEMBER OF D473’s PRINTED *“Discard a card from your hand. If you do, …”* FAMILY, AND THE BLOCKER WAS THE DESCRIBER RATHER THAN THE ANCHOR** — `censusAttackCorpus.ts` **FILE LINE 103**, *"Discard a card from your hand. If you do, your opponent discards a card from their hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect`. 🛑 **D473 MEASURED THIS ROW AND NAMED ITS BLOCKER IN WRITING, AND THE NAMED ONE WAS THE RIGHT ONE.** `HAND_COST_THEN_DRAW`’s block records D472’s whole-corpus measurement — widening that anchor’s consequent to `(.+)` claims this row and NO OTHER — and refuses it because `interpreter.ts`’s `describeBranch` had no phrase for `opponentDiscardsFromHand`: with none, `withConsequence` returns the prompt unchanged and the parking payment’s caption degrades to the bare *"Discard a card from your hand."*, **BYTE-IDENTICAL to an UNGATED payment’s**, while a census would record the row built. DRIVEN on both sides of the new case in `handCostOpponentDiscard.test.ts` §5 rather than quoted. The whole price is ONE anchor, ONE arm and ONE `describeBranch` case. ✅ **ZERO new ops, op fields, op values, prompts, prompt fields, choice kinds, events, error codes, `CardFilter`/`BoardCondition` members, registry rows, `FIXTURE_POOL` ids or `packages/schema` bytes** — `payFromHand` + `recordGate` + `opponentDiscardsFromHand` is three shipped ops in the shipped order. 🆕 **THE LATTICE CHANGES SHAPE IN BOTH DIRECTIONS AT ONCE** (D513/D514): OPENER × GATE × CONSEQUENT × COUNT reads **6 of 16 → 7 of 16** over the residue predicate with flips `6·6·2·0` → `7·7·1·1`, so CONSEQ moves ONTO zero as the widening retires a cell while COUNT moves OFF it as the narrowing creates one — and the owed *"printed zero times"* measurement (the 640-sentence column prints NO gated plural) is paid in that suite’s §1. `MATCH_RECORD_VERSION` **HELD at 30** on the SERIALIZED-ALPHABET argument (D452/D462/D463); reachability is FALSE here because the payment parks, and the loss direction is driven.) (🆕🆕🆕 **D514 +1 sentence / +2 printings — THE PRINTED *“any number of”* AND A PROPER NAME AS THE DECK-SEARCH NOUN** — `censusAttackCorpus.ts` **FILE LINE 657**, *"You may search your deck for any number of Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackEffect`. 🛑 **TWO BLOCKERS AND THEY ARE A CONJUNCTION, MEASURED**: the 2⁴ lattice reads `0/1 · 0/4 · 1/6 · 2/4 · 1/1` (**4 of 16**) with COUNT and NOUN each flipping the verdict at **4 of 8** cells and OPENER and REVEAL at **0 of 8** — D507's eighth shape — and **16 of 16 with every axis at 0 of 8 after**. **The `You may` wrapper the standing pricing named as a THIRD mechanism was already FREE and had been since D231.** ✅ **ZERO new `CardFilter` members**: `byName { cardNoun }` has spelled *"⟨Name⟩ cards"* since D264 and `ATTACK_BENCH_SEARCH` has captured a proper name into `byName` since D230 — the NAMED deck search shipped as a reader arm 284 decisions before this row, one destination over. ONE op-field WIDENING (`searchDeck.max: number | "any"`, `lookAtTopN.max`'s D333 member at a third op) and ONE new resolver (`namedCardNounFilter`, ordered LAST behind the closed noun table and REFUSING the three printed BANNERS, which is the one axis D440 refused `^(.+) card$` on). ✅ ZERO new ops, prompt kinds, choice kinds, events, error codes, registry rows or `packages/schema` bytes. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 +1 sentence / +2 printings — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`IN_PLAY_BOTH_SIDES_NAME_MULTIPLY`), ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay` — the FIRST both-sides count in that union to carry a `CardFilter`; `bothSidesBenchCount` and `bothActivesEnergyCount` are both BARE, because their printed nouns carry no adjective and this one's is NARROWED in print). 🛑 **THE SHIPPED ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the OPPOSITE answer to D510's one row up, and the reason this row genuinely owed a pattern: every in-play anchor requires the literal `for each of your ` and this sentence's head is SEATLESS, with the side named by a trailing parenthetical. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2**, measured at this head rather than carried (D451/D461). RAW summand ALONE: no registry row, no gate split and no trailing split — re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21.) (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD, THE MISSING CELL OF A SHIPPED 2×2** — `censusAttackCorpus.ts` **FILE LINE 517**, *"This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 3 legal printings**, claimed by `deriveAttackEffect` arm **6-i** over ONE new anchor (`SPREAD_EACH_BENCH_TAKEN_PRIZES`) and ONE OPTIONAL BOOLEAN RIDER on the SHIPPED `spreadDamage` (`perTakenPrize` — D448's own name spelled on a second op, so `snipeAmount`'s structural parameter folds it UNCHANGED). **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), prompts, choice kinds, parks, events, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 3**, so a `.length` site takes +1 where a `units(…)` site takes +3 — the largest single printing step left in the residue's spread family, and the reason this row was worth taking before smaller ones (D451, re-paid again).) (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) 
    // …and the step is ATTRIBUTABLE: remove THIS sentence and both figures fall by
    // exactly one, so nothing else moved under the slice.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([599, 1662]);  // (🆕🆕🆕 **D579 +1 sentence / +1 printing — THE CENSUS CLOSE-OUT** — Koraidon `sv08-116` "Unrelenting Onslaught", claimed WHOLE by `deriveAttackDamageBonus` through one `CONDITIONAL_DAMAGE_CLAUSES` literal; Walking Wake `sv06-063` is a REGISTRY row and moves no reader figure.) (🆕🆕🆕 **D575 +6 sentences / +6 printings — THE MRV-38 ATTACK SLICE** — `deriveAttackEffect`'s six new whole-sentence anchors claim `censusAttackCorpus.ts` file lines 177 (Hypno "Daydream"), 181 (Miraidon "C.O.D.E.: Protect"), 182 (Iron Moth "Anachronism Repulsor"), 346 (N's Sigilyph "Victory Symbol"), 394 (Team Rocket's Blipbug "Searching Eyes") and 690 (Glimmora "Corrosive Shards", the compound claimed WHOLE) — one printing each, so the sentence and printing steps AGREE. A READER move.) (🆕🆕🆕 **D574 +3 sentences / +5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** — `deriveAttackCopy`'s two RESOLVE-TIME anchors claim `censusAttackCorpus.ts` file lines 434 and 131 WHOLE (Haughty Order ×3, Seek Inspiration) and `deriveAttackEffect`'s new anchor claims file line 649 (Sableye "Damage Collection"). Alakazam (686) composes through the TRAILING seam and Malamar (489) is a REGISTRY row — neither is a reader move. A READER move; the sentence step (3) and the printing step (5) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D573 +4 sentences / +9 printings — THE COPY-ATTACK SUBSTITUTION** — `deriveAttackCopy`, the FOURTEENTH reader, claims `censusAttackCorpus.ts` file lines 77, 78, 80 and 245 WHOLE: Night Joker ×4, Foul Play ×2 + Metronome, Gemstone Mimicry, Try to Imitate. A READER move; the sentence step (4) and the printing step (9) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** (Koraidon ×2 "Primordial Beatdown", Roaring Moon ×2 "Vengeance Fletching", Iron Valiant "Majestic Sword", Slither Wing "Iron Smasher" — two noun rows and two literal clause rows over `banners.ts`); this suite's own row is unmoved.) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES** (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`), two literal rows over `banners.ts`; this suite's own row is unmoved.) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 577/1631 → 579/1633.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 576/1630 → 577/1631.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 572/1626 → 576/1630.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the `without` pair (resolved MINUS this suite's own row) 571/1624 → 572/1626.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 569/1620 → 571/1624.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 567/1618 → 569/1620.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 566/1616 → 567/1618, RE-DERIVED BY HAND rather than copied (D525(5)).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 565/1614 → 566/1616, RE-DERIVED BY HAND rather than copied (D525(5)).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: 562/1610 → 563/1612.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ THE OWN-ROW `without` PAIR, RE-DERIVED BY HAND as resolved − this suite's OWN row (D525 (5)) and never copied from the resolved pair — 561/1607 → 562/1610.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1605 → 561/1607.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 559/1602 → 560/1605.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D530 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.) (🆕🆕🆕 **D528 +1 sentence / +1 printing — THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER** — `censusAttackCorpus.ts` **FILE LINE 215**, *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_ATTACH_UP_TO_HEADS`, beside D525's, disjoint by VERB) as the SHIPPED member `programPerHeads` over ONE copy of D358's discard-spread op `attachEnergyFrom { source: "discard", energyType: "Lightning", benchOnly: true, declinable: true }` — H independent DECLINABLE parks over the Bench at `attack.ts`'s EXISTING fold (the distribution reading D358/D360 give "up to N … in any way you like", with N = heads); ZERO new op/filter/prompt/event/member vocabulary, NO fold or interpreter bytes, `MATCH_RECORD_VERSION` HELD at 30 (what parks is D358's op bytes). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1 (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE.) (🆕🆕🆕 **D527 +1 sentence / +1 printing — THE DYNAMIC-max HAND SEARCH — `searchDeck.max` GAINS THE LITERAL `"yourBenchCount"`, A SECOND WIDENING AT D514's PERSISTED ADDRESS** — `censusAttackCorpus.ts` **FILE LINE 454**, *"Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (svp-188 — no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`ATTACK_HAND_SEARCH_BENCH_COUNT`, a SEPARATE literal beside `ATTACK_HAND_SEARCH`, zero captures) as EXACTLY the sibling's two-op shape with the literal in `max` — `[{op:"searchDeck", filter:{kind:"anyCard"}, dest:"hand", max:"yourBenchCount"}, {op:"shuffleDeck"}]` — resolved at the park's `sized` map (`interpreter.ts`, where D514's `"any"` resolves) against the ATTACKER's Bench length at STEP time, captioned with the PRINTED phrase; ZERO new op/filter/prompt/event vocabulary, ONE persisted-field WIDENING with `MATCH_RECORD_VERSION` HELD at 30 (driven over a reconstructed v30 numeric op). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in both units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 553/1595 → 554/1596.) (🆕🆕🆕 **D526 +1 sentence / +1 printing — ⚠️ THE OWN-ROW `without` PAIR, RE-DERIVED BY HAND (D525 (5)): resolved 553/1595 minus THIS suite's own row — this slice both units step by ONE so the pair steps +1/+1 like a plain reader pair, but it is NOT a plain reader pair and the next sweep whose two units differ must re-derive it by hand rather than by value — THE THREE-TIER HEADS LADDER — ZERO VOCABULARY, AN EIGHTH `AttackCoinFlip` MEMBER** — `censusAttackCorpus.ts` **FILE LINE 218**, *"Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 50 more damage. If all of them are heads, this attack does 80 more damage."*, **1 sentence / 1 legal printing** (no id on this checkout — D425), claimed by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_BONUS_LADDER`, beside D525's) as the EIGHTH member `bonusLadder {flips: printed 3, ladder: [20, 50, 80]}`, spent at `attack.ts`'s EXISTING damage fold as ONE table lookup (exclusive tiers: 1 head → +20, 2 → +50, 3 → +80, 0 → nothing — NOT cumulative, NOT per-heads), ZERO new op/filter/prompt/event vocabulary. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 (measured off the corpus row at THIS head, D451/D461) — the first single-unit sweep since D521, so every chain moves by ONE in both units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 552/1594 → 553/1595. `MATCH_RECORD_VERSION` HELD at 30: the member is never serialized.) (🆕🆕🆕 **D525 +1 sentence / +2 printings — ⚠️ THE OWN-ROW `without` PAIR: resolved 552/1594 minus THIS suite's ONE-printing row is 551/1593, not 551/1592 (a whitelist pass that maps the literal by value gets this one wrong; reddened by the full `check`, then corrected) — THE HEADS COUNT READ AS AN "UP TO" CEILING BY ONE OP — ZERO VOCABULARY, A SEVENTH `AttackCoinFlip` MEMBER** — `censusAttackCorpus.ts` **FILE LINE 219**, *"Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand."*, **1 sentence / 2 legal printings** (Oinkologne; neither printing's id is on this checkout — D425), claimed by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_RETRIEVAL_UP_TO_HEADS`, beside D476's) as the SEVENTH member `retrievalUpToHeads {flips: printed 3, filter: anyCard, dest: hand}`, spent at `attack.ts`'s fold as ONE shipped `discardPileRetrieval {anyCard, hand, max: heads}` appended to the program when heads > 0 — the interpreter's own "up to" park (`chooseCards {min 0, max H}`), ZERO new op/filter/prompt/event vocabulary. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2** (measured off the corpus row at THIS head, D451/D461), so every SENTENCE chain moves by ONE and every PRINTING chain by TWO — a pass that copied one number into the other kind of site would be wrong in half of them (D431/D419). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 551/1592 → 552/1594. `MATCH_RECORD_VERSION` HELD at 30: the member is never serialized.) (🆕🆕🆕 **D524 +1 sentence / +1 printing — THE PURPOSE-CONNECTIVE OPTIONAL-COST BOOST WITH THE ALL-SELF-ENERGY-TO-HAND COST — ZERO VOCABULARY** — `censusAttackCorpus.ts` **FILE LINE 652**, *"You may put all Energy attached to this Pokémon into your hand to have this attack do 80 more damage."*, **1 sentence / 1 legal printing** (the printing's card is unresolvable on this checkout — D425), claimed by `deriveAttackOptionalCostBoost` through a SECOND SKELETON (`OPTIONAL_COST_PURPOSE_BOOST`, the purpose connective *"to have this attack do N more damage"* beside D381's `. If you do, `) over ONE new cost-table row (`OPTIONAL_COST_PUT_ALL_SELF_ENERGY_TO_HAND` → gate `yourActiveEnergyAtLeast 1`, op `discardEnergy yourActive anyEnergy all → hand`), assembled by the UNCHANGED `optionalCostBoostProgram`: D405's op at `all`, D383's gate at 1, D381's payoff and ZERO new vocabulary. ✅ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 and 1** (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in BOTH units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 550/1591 → 551/1592. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D523 +1 sentence / +1 printing — THE DECK-DESTINATION DISCARD-PILE RETRIEVAL ("Shuffle … from your discard pile into your deck") — ZERO VOCABULARY, AND A REFUSAL WHOSE PREMISE WAS FALSE OF THE LEGAL ATTACK COLUMN** — `censusAttackCorpus.ts` **FILE LINE 485**, *"Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck."*, **1 sentence / 1 legal printing** (the printing's card is unresolvable on this checkout — D425), claimed by `deriveAttackEffect` through the new `ATTACK_DISCARD_SHUFFLE_BACK` anchor (directly under D237's `ATTACK_DISCARD_RETRIEVAL`) and the arm directly after the D237 arm, deriving `[{op:"discardPileRetrieval",filter:{kind:"basicEnergy",energyType:"Water"},dest:"deck",max:3},{op:"shuffleDeck"}]` — PAL PAD's registry shape with the hand twin's own filter: TWO shipped ops and ZERO new vocabulary; the refusal that kept the row unbuilt (*"no attack sentence in the catalog spells"* the deck destination) was FALSE of the legal attack column, while its rule (a different verb is a different family) was right and is honoured by a separate anchor. ✅ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 and 1** (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in BOTH units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 549/1590 → 550/1591. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D522 +1 sentence / +1 printing — THE STADIUM-GATED BENCH SPREAD WITH THE STADIUM DISCARD — ZERO VOCABULARY, AND A REFUSAL RIGHT ABOUT THE OP AND WRONG ABOUT THE READER** — `censusAttackCorpus.ts` **FILE LINE 293**, *"If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (Ting-Lu `sv06-110`, whose base and cost are unresolvable on this checkout — D425), claimed by `deriveAttackEffect` through the new `STADIUM_GATED_BENCH_SPREAD` anchor (directly under D380's `MAY_DISCARD_STADIUM`) and arm 43-bis, deriving `[{op:"conditionGate",cond:{kind:"stadiumInPlay"},then:[{op:"spreadDamage",target:"opponentBench",amount:30},{op:"discardStadium"}]}]` — arm 43's exact shape minus the `optional`: THREE shipped ops and ZERO new vocabulary; the refusal that kept the row unbuilt was right about the OP (`discardStadium`, D380) and wrong about the READER (the middle clause is a SECOND HIT — the shipped body-set `spreadDamage` — never a bonus, so no `AttackBonusConsequent` join could read it; D521 (2)'s premise rule). ✅ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 and 1** (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in BOTH units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 548/1589 → 549/1590. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D521 +1 sentence / +2 printings — THE TWO-COIN BOTH-TAILS RECOIL — ZERO VOCABULARY, AND A REFUSAL WRONG IN ITS CARRIER** — `censusAttackCorpus.ts` **FILE LINE 202**, *"Flip 2 coins. If both of them are tails, this Pokémon also does 90 damage to itself."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackEffect` through the new `FLIP_TWO_BOTH_TAILS_SELF_DAMAGE` anchor (beside D145's one-coin `FLIP_TAILS_SELF_DAMAGE`) and the arm directly after D145's, deriving `[{op:"coinFlipGate",coins:2,onTails:true,then:[{op:"damageSelf",amount:90}]}]` — ONE shipped op behind D355's shipped `coins` field and ZERO new vocabulary; the refusal that kept the row unbuilt named the wrong carrier (`AttackFlipCount` is `deriveAttackCoinFlip`'s damage-count type; a one-body recoil behind a coin is a GATE, not a count — D520 (2)'s premise rule). ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one sentence, two legal printings (measured off the corpus row at THIS head, D451/D461) — so a pass that copied one number into the other kind of site would be wrong in half of them. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 547/1587 → 548/1589. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D520 +1 sentence / +1 printing — THE FOUR-ZONE DAMAGED-BODY SPREAD, AND D507's REFUSAL OVERTURNED IN VERDICT AND CARRIER** — `censusAttackCorpus.ts` **FILE LINE 601**, *"This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through the new `SPREAD_EACH_DAMAGED_FOUR_ZONE` anchor and arm 6-iii, deriving `[{op:"conditionGate",cond:{kind:"opponentActiveDamaged"},then:[{op:"damageDefender",amount:50}]},{op:"spreadDamage",target:"yourBench",amount:50,damagedOnly:true},{op:"spreadDamage",target:"opponentBench",amount:50,damagedOnly:true}]` — THREE shipped ops and ZERO new vocabulary: the Active predicate is the shipped ONE-BODY `BoardCondition` `opponentActiveDamaged` inside the shipped `conditionGate`, NOT a per-body rider on `damageDefender`'s flat arm (D507 priced it on that rider; the verdict AND the carrier were wrong — D479's third mode), the Benches are D507's two `damagedOnly` spreads, and *"except for this Pokémon"* is STRUCTURAL. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — measured off the corpus row at THIS head rather than assumed (D451/D461). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 546/1586 → 547/1587. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D519 +1 sentence / +1 printing — THE BODIES IN PLAY THAT ARE ALREADY HURT, A COUNT NARROWED BY A BOARD FACT** — `censusAttackCorpus.ts` **FILE LINE 596**, *"This attack does 50 damage for each of your Pokémon that has any damage counters on it."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through the new `IN_PLAY_DAMAGED_BODY_MULTIPLY` anchor and a `damagedOnly` rider on `DamageCountSource.pokemonInPlay`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1 HERE** — measured off the corpus row at THIS head rather than carried from D518, whose two steps were 1 vs 2 (D451/D461). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved. 🛑 **ZERO NEW UNION MEMBERS**: `DamageCountSource` stands still at 20 and the price is ONE anchor, ONE reader arm, ONE optional boolean and ONE argument.**) (🆕🆕🆕 **D518 +1 sentence / +2 printings — THE §12 SPECIAL-CONDITION TALLY ON THE DEFENDING ACTIVE** — `censusAttackCorpus.ts` **FILE LINE 537**, *"This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new anchor (`OPPONENT_CONDITION_COUNT_MULTIPLY`) and ONE new `DamageCountSource` member (`specialConditionsOnOpponentActive`, the **20th**), whose walk is `presentStatuses` — the SAME projection the shipped `opponentActiveHasSpecialCondition` predicate folds, so *predicate ⟺ count ≥ 1* holds BY CONSTRUCTION rather than by two readers agreeing. 🛑 **THE SHIPPED PREDICATE COULD NOT PAY THIS ROW**: `DamageCountSource.boardCondition` is the 0-or-1 INDICATOR (D115), whose ceiling is `per` at every `per`, while this sentence pays `per` per CONDITION and a body can carry THREE. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2**, so a `.length` site takes +1 where a `units(…)` site takes +2 — measured off the corpus row rather than copied between the two kinds of site (D451/D461). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader surface stands still at **13**.) (🆕🆕🆕 **D517 +1 sentence / +1 printing — THE PRIZE-GATED PARALYSIS** — `censusAttackCorpus.ts` **FILE LINE 342**, *"If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-iii through ONE new anchor (`SELF_PRIZE_GATE_PARALYZE`) and ONE new `BoardCondition` member (`yourPrizesRemaining`, the **61st**). ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured at this head. RAW summand ALONE — registry 10/16, gate 5/13, trailing 11/21 all re-measured unmoved — and the reader surface stands still at **13**.) (🆕🆕🆕 **D516 +1 sentence / +1 printing — THE DRAW COUNT THAT READS THE OPPONENT'S HAND** — `censusAttackCorpus.ts` **FILE LINE 487**, *"Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through the new `SHUFFLE_HAND_DRAW_PER_OPPONENT_HAND` anchor and arm 44c, deriving `[{op:"handRefresh",who:"you",draw:{kind:"opponentHandSize"}}]`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — measured off the corpus row, not assumed (D451/D461/D466). ONE anchor, ONE arm, ONE `HandRefreshDraw` member (the FIFTH) and ONE evaluator arm in `handRefreshDrawCount`, which is the SOLE consumer that switches on the draw kind — established by DELETING the arm and reading `tsc` (D512's census-by-compile-error), not by grep. 🛑 **THE REFUSAL THAT ORDERED THIS WAS 37 DECISIONS OLD AND RIGHT IN EVERY CLAUSE**: `SHUFFLE_HAND_DRAW`'s block (D479) said this row *"needs a fifth member"* and drove the refusal as its own falsifier — D515's rule that a refusal naming WHAT IS MISSING ages well, paid at a second address one slice later. ⚠️ **THE COUNT IS A MEMBER OF `HandRefreshDraw` AND NOT A `DamageCountSource`** even though `cardsInOpponentHand` spells the identical printed phrase at corpus file line 564: that union's only evaluator is `attack.ts`'s `scaledAttackDamage`, FOUR of whose six parameters are attack-declaration facts that do not exist on the Trainer and Ability paths authoring every other `handRefresh`. [🆕🆕🆕 D599 (D539): "only evaluator" is WITHDRAWN, kept as written — interpreter.ts `stepOp`'s `drawCards.per` arm, a Trainer path, evaluates `cardsInOpponentHand` for Emma `me04-077`/`-107` through the same `countCardsInHand` walk; union-wide the claim was already stale since the D557/D569 `opponentBenchCount`/`pokemonInPlay` Extracts.] `AttackFlipCount` (*"Deliberately not a `DamageCountSource` arm"*) and `MaxHpScale` already made the same call in writing — four count vocabularies, zero embeddings. ✅ **ZERO new ops, op fields, op VALUES on shipped fields, prompts, choice kinds, events, error codes, `CardFilter`/`BoardCondition` members, registry rows, `FIXTURE_POOL` ids, `redact.ts` bytes or `packages/schema` bytes**; RAW summand ALONE — no registry row, no gate split, no trailing split — and the reader surface stands still at **13**. **`MATCH_RECORD_VERSION` STAYS 30, ARGUED AT THE HARD ADDRESS**: the serialized alphabet DOES grow (a fifth `draw.kind` no v30 deploy can write), so D452's *"this byte already ships"* out does NOT apply and the claim rests on REACHABILITY alone (D450) — re-measured over ALL TEN `handRefresh` producers, every one of which places the op, or the gate holding it, as the SOLE top-level op, so no `phase.cont.pendingOp` or `rest` can ever hold it. Driven in the LOSS direction in `handRefreshOpponentHand.test.ts` §8.)  // (🆕🆕🆕 **D515 +1 sentence / +1 printing — THE THIRD MEMBER OF D473’s PRINTED *“Discard a card from your hand. If you do, …”* FAMILY, AND THE BLOCKER WAS THE DESCRIBER RATHER THAN THE ANCHOR** — `censusAttackCorpus.ts` **FILE LINE 103**, *"Discard a card from your hand. If you do, your opponent discards a card from their hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect`. 🛑 **D473 MEASURED THIS ROW AND NAMED ITS BLOCKER IN WRITING, AND THE NAMED ONE WAS THE RIGHT ONE.** `HAND_COST_THEN_DRAW`’s block records D472’s whole-corpus measurement — widening that anchor’s consequent to `(.+)` claims this row and NO OTHER — and refuses it because `interpreter.ts`’s `describeBranch` had no phrase for `opponentDiscardsFromHand`: with none, `withConsequence` returns the prompt unchanged and the parking payment’s caption degrades to the bare *"Discard a card from your hand."*, **BYTE-IDENTICAL to an UNGATED payment’s**, while a census would record the row built. DRIVEN on both sides of the new case in `handCostOpponentDiscard.test.ts` §5 rather than quoted. The whole price is ONE anchor, ONE arm and ONE `describeBranch` case. ✅ **ZERO new ops, op fields, op values, prompts, prompt fields, choice kinds, events, error codes, `CardFilter`/`BoardCondition` members, registry rows, `FIXTURE_POOL` ids or `packages/schema` bytes** — `payFromHand` + `recordGate` + `opponentDiscardsFromHand` is three shipped ops in the shipped order. 🆕 **THE LATTICE CHANGES SHAPE IN BOTH DIRECTIONS AT ONCE** (D513/D514): OPENER × GATE × CONSEQUENT × COUNT reads **6 of 16 → 7 of 16** over the residue predicate with flips `6·6·2·0` → `7·7·1·1`, so CONSEQ moves ONTO zero as the widening retires a cell while COUNT moves OFF it as the narrowing creates one — and the owed *"printed zero times"* measurement (the 640-sentence column prints NO gated plural) is paid in that suite’s §1. `MATCH_RECORD_VERSION` **HELD at 30** on the SERIALIZED-ALPHABET argument (D452/D462/D463); reachability is FALSE here because the payment parks, and the loss direction is driven.) (🆕🆕🆕 **D514 +1 sentence / +2 printings — THE PRINTED *“any number of”* AND A PROPER NAME AS THE DECK-SEARCH NOUN** — `censusAttackCorpus.ts` **FILE LINE 657**, *"You may search your deck for any number of Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackEffect`. 🛑 **TWO BLOCKERS AND THEY ARE A CONJUNCTION, MEASURED**: the 2⁴ lattice reads `0/1 · 0/4 · 1/6 · 2/4 · 1/1` (**4 of 16**) with COUNT and NOUN each flipping the verdict at **4 of 8** cells and OPENER and REVEAL at **0 of 8** — D507's eighth shape — and **16 of 16 with every axis at 0 of 8 after**. **The `You may` wrapper the standing pricing named as a THIRD mechanism was already FREE and had been since D231.** ✅ **ZERO new `CardFilter` members**: `byName { cardNoun }` has spelled *"⟨Name⟩ cards"* since D264 and `ATTACK_BENCH_SEARCH` has captured a proper name into `byName` since D230 — the NAMED deck search shipped as a reader arm 284 decisions before this row, one destination over. ONE op-field WIDENING (`searchDeck.max: number | "any"`, `lookAtTopN.max`'s D333 member at a third op) and ONE new resolver (`namedCardNounFilter`, ordered LAST behind the closed noun table and REFUSING the three printed BANNERS, which is the one axis D440 refused `^(.+) card$` on). ✅ ZERO new ops, prompt kinds, choice kinds, events, error codes, registry rows or `packages/schema` bytes. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group captured `Basic Energy cards of different types` WHOLE from the day it was written, and the refusal was one step later in `HAND_SEARCH_PLURAL.get` (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members, and no widening of that union could ever reach this row** — it rides D332's shipped `chooseCards.caps`, one cap of ONE per `energyProvidesOf` cell, so ZERO new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). **+1 sentence / +2 printings**, which this BEFORE-figure inherits because it is the live sum minus this slice's own row.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE `CardFilter` member and ONE parameterised noun, **ZERO new anchors**. ⚠️ The SENTENCE step and the PRINTING step DISAGREE at 1 and 2.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured per site rather than copied between the two kinds of site (D451/D461).) 🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD (corpus FILE LINE 517).** This pair is the resolving set MINUS this file's own sentence, so it steps by exactly what the line above it steps by — which is the point of measuring both: a slice that moved only one of the two would be visible here (D451/D465). (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) 
    // RAW SUMMAND ALONE — no registry row, no gate split, no trailing split.
    expect(programFor("fix-deflock")).toBeUndefined();
  });

  it("engineVersion is 0.494.0", () => {
    expect(engineVersion).toBe("0.494.0");
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
