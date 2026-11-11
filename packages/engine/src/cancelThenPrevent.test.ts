import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackEffect,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
  ATTACK_READERS,
} from "./effects";
import { applyAction, programFor } from "./index";
import { registryCardIds } from "./registry";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  PREVENT_BLOCK_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

const PRINTED =
  "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";

const BARE_CANCEL = "Flip a coin. If tails, this attack does nothing.";
const BARE_PREVENT =
  "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";

/** The derived value, written once. */
const DERIVED = {
  kind: "cancelOnTailsElseProgram",
  ops: [{ op: "preventDamage", effects: true }],
} as const;

const HEADS_SEEDS = [2, 3, 6, 7, 16, 18, 20, 22, 23, 27, 28, 30, 34, 35, 38] as const;
const TAILS_SEEDS = [1, 4, 5, 8, 9, 10, 11, 12, 13, 14] as const;

const READERS: Record<string, (text: string) => unknown> = Object.fromEntries(
  ATTACK_READERS.map(({ name, read }) => [name, read]),
);
const owners = (s: string) => attackReaderSurface().filter((n) => READERS[n]?.(s) !== null);
const count = (events: readonly GameEvent[], type: GameEvent["type"]) =>
  events.filter((e) => e.type === type).length;
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["sv03-004"];
  if (card === undefined) throw new Error("no sv03-004 in the pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("sv03-004 has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "sv03-004": { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}

function board(seed: number, effect: string = PRINTED): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: PREVENT_BLOCK_DECK, p2: PREVENT_BLOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "sv03-004");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p2");
  return withEffect(state, effect);
}
const swing = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index: 0 });

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, off the corpus", () => {
  it("all three sentences ARE corpus rows, at the printing counts this slice quotes", () => {
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(PRINTED)).toBe(2);
    expect(rows.get(BARE_CANCEL)).toBe(16);
    expect(rows.get(BARE_PREVENT)).toBe(15);
    expect(rows.get(BARE_CANCEL)).not.toBe(11);
    expect(rows.get(PRINTED)).not.toBe(1);
  });

  it("the print is the two siblings SPLICED, and the apostrophe byte is U+0027", () => {
    // One axis, spelled structurally: the compound is the cancel's whole sentence
    // followed by the prevent's whole sentence with its opening flip removed.
    expect(PRINTED).toBe(`${BARE_CANCEL} ${BARE_PREVENT.slice("Flip a coin. ".length)}`);
    expect(PRINTED.includes("opponent's")).toBe(true);
    expect(PRINTED.includes("opponent’s")).toBe(false);
    expect(PRINTED.codePointAt(PRINTED.indexOf("opponent's") + 8)).toBe(0x27);
    expect(PRINTED.includes("Pokémon")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the READER: one owner, and the ops are the sibling arm's byte for byte.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — one reader owns the sentence, and the ops are the sibling's", () => {
  it("derives to `cancelOnTailsElseProgram` carrying the shipped prevent op", () => {
    expect(deriveAttackCoinFlip(PRINTED)).toEqual(DERIVED);
  });

  it("the `ops` ARE `FLIP_PREVENT_DAMAGE_AND_EFFECTS`'s gate body, both directions", () => {
    const sibling = deriveAttackEffect(BARE_PREVENT);
    expect(sibling).toEqual([
      {
        op: "coinFlipGate",
        ops: [{ op: "preventDamage", effects: true }],
      },
    ]);
    const gate = sibling?.[0];
    if (gate === undefined || gate.op !== "coinFlipGate") throw new Error("unreachable");
    expect(deriveAttackCoinFlip(PRINTED)?.kind).toBe("cancelOnTailsElseProgram");
    const mine = deriveAttackCoinFlip(PRINTED);
    if (mine === null || mine.kind !== "cancelOnTailsElseProgram") throw new Error("unreachable");
    expect(mine.ops).toEqual(gate.ops);
    // …and the other direction: the sibling's `then` is exactly what this member carries,
    // so neither can gain a field without the other being re-read.
    expect(gate.ops).toEqual(mine.ops);
  });

  it("EXACTLY ONE of the thirteen readers claims it — named, with the twelve refusals kept", () => {
    expect(owners(PRINTED)).toEqual(["deriveAttackCoinFlip"]);
    for (const name of attackReaderSurface()) {
      if (name === "deriveAttackCoinFlip") continue;
      expect(READERS[name]?.(PRINTED), name).toBeNull();
    }
    expect(deriveAttackEffect(PRINTED)).toBeNull();
  });

  it("no splitter serves it — all FOUR answer null, so the RAW summand is the only one that moved", () => {
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    for (const id of registryCardIds()) {
      const program = programFor(id);
      if (program?.attack === undefined) continue;
      expect(JSON.stringify(program.attack).includes("cancelOnTails")).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the ANCHOR, end to end, and what it refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the anchor is anchored, and every probe runs against IT", () => {
  it("the `^` end: leading text stays on the loud path", () => {
    const lead = `This attack does 30 damage. ${PRINTED}`;
    expect(deriveAttackCoinFlip(lead)).toBeNull();
    expect(resolvedByAnyReader(lead)).toBe(false);
  });

  it("the `$` end: a trailing clause is refused HERE, and the SPLIT is what says so", () => {
    const trailing = `${PRINTED} Draw a card.`;
    expect(deriveAttackCoinFlip(trailing)).toBeNull();
    expect(splitAttackTrailingClause(trailing)).toEqual({ head: PRINTED, tail: "Draw a card." });
    expect(legalAttackCorpus().filter(([, s]) => s.startsWith(`${PRINTED} `))).toEqual([]);
  });

  it("the U+2019 re-ingest derives IDENTICALLY — the apostrophe class is live", () => {
    const curly = PRINTED.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(PRINTED);
    expect(deriveAttackCoinFlip(curly)).toEqual(DERIVED);
  });

  it("the printed MIDDLE is load-bearing: a different heads consequent is refused", () => {
    for (const consequent of [
      "during your opponent's next turn, prevent all damage done to this Pokémon by attacks",
      "your opponent's Active Pokémon is now Paralyzed",
      "discard an Energy from your opponent's Active Pokémon",
    ]) {
      const near = `${BARE_CANCEL} If heads, ${consequent}.`;
      expect(deriveAttackCoinFlip(near), near).toBeNull();
    }
    expect(deriveAttackCoinFlip(PRINTED)).toEqual(DERIVED);
  });

  it("the BARE cancel's `^` — the hole a probe found, unguarded for 373 decisions", () => {
    const lead = `This attack does 30 damage. ${BARE_CANCEL}`;
    expect(deriveAttackCoinFlip(lead)).toBeNull();
    expect(resolvedByAnyReader(lead)).toBe(false);
    expect(splitAttackTrailingClause(lead)).toBeNull();
    expect(deriveAttackCoinFlip(BARE_CANCEL)).toEqual({ kind: "cancelOnTails" });
    // …and the string really would be claimed by the loosened anchor, so the rung is
    // pointed at the mutation rather than at a prefix nothing could ever match.
    expect(/Flip a coin\. If tails, this attack does nothing\.$/.test(lead)).toBe(true);
  });

  it("the bare cancel is read FIRST, and that ORDER is what keeps its `$` killable", () => {
    expect(deriveAttackCoinFlip(BARE_CANCEL)).toEqual({ kind: "cancelOnTails" });
    expect(deriveAttackCoinFlip(PRINTED)).not.toEqual({ kind: "cancelOnTails" });
    expect(PRINTED.startsWith(BARE_CANCEL)).toBe(true);
  });
});

describe("§4 — what this anchor claims, measured over every corpus row", () => {
  it("every single-axis LOOSENING claims exactly the same 1 sentence / 2 printings", () => {
    const LIT =
      /^Flip a coin\. If tails, this attack does nothing\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/;
    const LOOSE = [
      // the `^` dropped
      /Flip a coin\. If tails, this attack does nothing\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/,
      // the `\.$` dropped
      /^Flip a coin\. If tails, this attack does nothing\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\./,
      // the consequent CAPTURED instead of spelled
      /^Flip a coin\. If tails, this attack does nothing\. If heads, (.+)\.$/,
      // the whole tail captured
      /^Flip a coin\. If tails, this attack does nothing\. (.+)$/,
    ];
    const claimed = (re: RegExp) => legalAttackCorpus().filter(([, s]) => re.test(s));
    expect([claimed(LIT).length, units(claimed(LIT))]).toEqual([1, 2]);
    for (const re of LOOSE) {
      expect([claimed(re).length, units(claimed(re))], String(re)).toEqual([1, 2]);
    }
  });

  it("the 2³ axis-substitution lattice, and the built-by-weight vector it produced", () => {
    const NEW =
      /^Flip a coin\. If tails, this attack does nothing\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/;
    const HEADS_ARM =
      "If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";
    const point = (aAbsent: boolean, bBuilt: boolean, cHeadsFirst: boolean) => {
      if (aAbsent) return `Flip a coin. ${HEADS_ARM}`;
      const tails = `If tails, ${bBuilt ? "your opponent's Active Pokémon is now Confused" : "this attack does nothing"}.`;
      return cHeadsFirst
        ? `Flip a coin. ${HEADS_ARM} ${tails}`
        : `Flip a coin. ${tails} ${HEADS_ARM}`;
    };
    const seen = new Set<string>();
    const byWeight = new Map<number, [built: number, total: number]>();
    const movedByThisSlice: string[] = [];
    for (const a of [false, true])
      for (const b of [false, true])
        for (const c of [false, true]) {
          const s = point(a, b, c);
          if (seen.has(s)) continue; // a COLLAPSED point, counted once
          seen.add(s);
          const w = Number(a) + Number(b) + Number(c);
          const nowBuilt = resolvedByAnyReader(s);
          const beforeBuilt = nowBuilt && !NEW.test(s);
          if (nowBuilt && !beforeBuilt) movedByThisSlice.push(s);
          const [built, total] = byWeight.get(w) ?? [0, 0];
          byWeight.set(w, [built + (beforeBuilt ? 1 : 0), total + 1]);
        }
    expect(seen.size).toBe(5);
    expect([...byWeight.entries()].sort(([x], [y]) => x - y)).toEqual([
      [0, [0, 1]],
      [1, [1, 3]],
      [2, [0, 1]],
    ]);
    expect(movedByThisSlice).toEqual([PRINTED]);
    expect([...seen].filter((s) => NEW.test(s))).toEqual([PRINTED]);
  });

  it("the DIRECTION-2 lattice: the cancel arm HELD, the heads consequent varied", () => {
    const CONSEQUENTS = [
      "during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon",
      "during your opponent's next turn, prevent all damage done to this Pokémon by attacks",
      "during your opponent's next turn, the Defending Pokémon can't attack",
      "discard an Energy from your opponent's Active Pokémon",
      "your opponent's Active Pokémon is now Paralyzed",
      "this attack does 20 more damage",
    ];
    const built: string[] = [];
    for (const consequent of CONSEQUENTS) {
      const bare = `Flip a coin. If heads, ${consequent}.`;
      expect(resolvedByAnyReader(bare), bare).toBe(true); // every one builds ALONE
      const withCancel = `${BARE_CANCEL} If heads, ${consequent}.`;
      if (resolvedByAnyReader(withCancel)) built.push(consequent);
    }
    expect(built).toEqual([CONSEQUENTS[0]]);
    // …and the mirror ORDER is refused for all six, so nothing is claimed by accident
    // on the strength of the arm order alone.
    for (const consequent of CONSEQUENTS) {
      const mirrored = `Flip a coin. If heads, ${consequent}. If tails, this attack does nothing.`;
      expect(resolvedByAnyReader(mirrored), mirrored).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the BOARD: both faces, driven.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — both faces on a real board", () => {
  it("TAILS — no damage, ATTACK_FAILED, and no block installed", () => {
    const { state, events } = swing(board(TAILS_SEEDS[0]));
    expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(findEvent(events, "ATTACK_FAILED")?.reason).toBe("coinFlip");
    expect(findEvent(events, "ATTACK_BLOCK_APPLIED")).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p1.active?.attackBlock).toBeNull();
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined(); // the text was READ
  });

  it("HEADS — the printed 10 lands AND the durated block is installed", () => {
    const { state, events } = swing(board(HEADS_SEEDS[0]));
    expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(state.players.p2.active?.damage).toBe(10);
    expect(findEvent(events, "ATTACK_FAILED")).toBeUndefined();
    const applied = findEvent(events, "ATTACK_BLOCK_APPLIED");
    expect(applied?.effects).toBe(true);
    expect(applied?.fromClass).toBeUndefined();
    expect(applied?.maxDamage).toBeUndefined();
    expect(state.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    const sibling = swing(board(HEADS_SEEDS[0], BARE_PREVENT));
    expect(sibling.state.players.p1.active?.attackBlock).toEqual(
      state.players.p1.active?.attackBlock,
    );
  });

  it("the installed block really PREVENTS on the opponent's turn, and expires after it", () => {
    // The cross-turn case. Without it, "a block was installed" is a claim about a
    // field rather than about the game.
    const after = swing(board(HEADS_SEEDS[0])).state;
    expect(after.turn).toBe(3);
    // P2 promotes an attacker and swings back into the block.
    let p2turn = setActiveFromDeck(after, "p2", "fix-attacker");
    p2turn = attachFromDeck(p2turn, "p2", "fix-energy", 1);
    const back = swing(p2turn, "p2");
    expect(back.state.players.p1.active?.damage).toBe(0);
    expect(findEvent(back.events, "DAMAGE_DEALT")?.prevented).toBe(true);
    expect(findEvent(back.events, "DAMAGE_DEALT")?.dealt).toBe(0);
  });

  it("both seed lists are REAL — every seed lands the face it is filed under", () => {
    for (const seed of HEADS_SEEDS) {
      expect(
        findEvent(swing(board(seed)).events, "ATTACK_EFFECT_COIN_FLIP")?.result,
        `seed ${seed}`,
      ).toBe("heads");
    }
    for (const seed of TAILS_SEEDS) {
      expect(
        findEvent(swing(board(seed)).events, "ATTACK_EFFECT_COIN_FLIP")?.result,
        `seed ${seed}`,
      ).toBe("tails");
    }
  });

  it("never mutates the board it is handed", () => {
    const frozen = deepFreeze(board(HEADS_SEEDS[0]));
    const snapshot = JSON.stringify(frozen);
    expect(swing(frozen).state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — ONE FLIP. The whole argument for the member.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the coin is drawn ONCE, and the rngState proves it", () => {
  it("exactly ONE `ATTACK_EFFECT_COIN_FLIP` row, on each face", () => {
    for (const seed of [HEADS_SEEDS[0], TAILS_SEEDS[0]]) {
      expect(count(swing(board(seed)).events, "ATTACK_EFFECT_COIN_FLIP"), `seed ${seed}`).toBe(1);
    }
  });

  it("the rngState after the swing is the BARE CANCEL's, byte for byte, on both faces", () => {
    for (const seed of [HEADS_SEEDS[0], TAILS_SEEDS[0]]) {
      const bare = swing(board(seed, BARE_CANCEL));
      const compound = swing(board(seed));
      expect(compound.state.rngState, `seed ${seed}`).toEqual(bare.state.rngState);
      expect(compound.state.rngState).not.toEqual(board(seed).rngState);
    }
  });

  it("…and the two faces agree with the bare cancel's, seed for seed", () => {
    // The stronger form: not just the same rngState but the same FACE, which is what
    // makes "one flip, two consequences" a statement about the draw rather than about
    // the count of rows.
    for (const seed of [...HEADS_SEEDS, ...TAILS_SEEDS]) {
      const bare = findEvent(swing(board(seed, BARE_CANCEL)).events, "ATTACK_EFFECT_COIN_FLIP");
      const compound = findEvent(swing(board(seed)).events, "ATTACK_EFFECT_COIN_FLIP");
      expect(compound?.result, `seed ${seed}`).toBe(bare?.result);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the LOG, RENDERED rather than reasoned about.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the log rows, rendered", () => {
  function render(state: GameState, events: readonly GameEvent[]): string {
    const ctx: LogContext = {
      names: { p1: "Ash", p2: "Gary" },
      state,
      elapsed: "+00:11",
    };
    return logFromEvents(events, ctx)
      .flatMap((e) =>
        e.kind === "turn" ? [] : [`${e.who}: ${e.segments.map((s) => s.text).join("")}`],
      )
      .join("\n");
  }

  it("the TAILS row names the CONSEQUENCE and does not repeat the face", () => {
    const { state, events } = swing(board(TAILS_SEEDS[0]));
    const text = render(state, events);
    expect(text).toContain("flipped tails");
    expect(text).toContain("'s attack did nothing — the coin flip missed");
    // …and it does NOT claim a protection that was never installed.
    expect(text).not.toContain("is protected from damage");
  });

  it("the HEADS rows announce the flip, the damage and the DURATION", () => {
    const { state, events } = swing(board(HEADS_SEEDS[0]));
    const text = render(state, events);
    expect(text).toContain("flipped heads");
    expect(text).toContain(
      "is protected from damage and effects of attacks during your opponent's next turn",
    );
    expect(text).not.toContain("did nothing");
    expect(text.indexOf("flipped heads")).toBeLessThan(text.indexOf("is protected from damage"));
  });
});

describe("§8 — the census moves in exactly ONE summand", () => {
  it("the resolving corpus gains ONE sentence and TWO printings", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([resolved.length - without.length, units(resolved) - units(without)]).toEqual([1, 2]);
  });

  it("the CENSUS is blind to whether the claim is CORRECT — stated, not assumed", () => {
    const mine = deriveAttackCoinFlip(PRINTED);
    if (mine === null || mine.kind !== "cancelOnTailsElseProgram") throw new Error("unreachable");
    expect(mine.ops).not.toEqual([{ op: "preventDamage" }]); // the narrow sibling
    expect(mine.ops).toEqual([{ op: "preventDamage", effects: true }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — `MATCH_RECORD_VERSION`, at the address that persists.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the version question, asked at the durated address", () => {
  it("the ADDRESS is `InPlayPokemon.attackBlock`, and the SERIALIZED ALPHABET is unchanged", () => {
    const mine = swing(board(HEADS_SEEDS[0])).state.players.p1.active?.attackBlock;
    const sibling = swing(board(HEADS_SEEDS[0], BARE_PREVENT)).state.players.p1.active?.attackBlock;
    expect(JSON.stringify(mine)).toBe(JSON.stringify(sibling));
    expect(Object.keys(mine ?? {}).sort()).toEqual(["effects", "fromClass", "maxDamage", "turn"]);
    expect(JSON.stringify(mine)).toBe('{"turn":3,"effects":true}');
  });

  it("REACHABILITY, stated second as the weaker half", () => {
    for (const seed of [HEADS_SEEDS[0], TAILS_SEEDS[0]]) {
      const after = swing(board(seed)).state;
      expect(after.phase.kind, `seed ${seed}`).not.toBe("effect:choose");
      expect(JSON.stringify(after).includes("cancelOnTails"), `seed ${seed}`).toBe(false);
    }
    const mine = deriveAttackCoinFlip(PRINTED);
    if (mine === null || mine.kind !== "cancelOnTailsElseProgram") throw new Error("unreachable");
    expect(mine.ops).toHaveLength(1);
  });

  it("the LOSS direction, and why the member is REQUIRED rather than an optional rider", () => {
    expect(deriveAttackCoinFlip(BARE_CANCEL)).toEqual({ kind: "cancelOnTails" });
    expect(Object.keys(deriveAttackCoinFlip(BARE_CANCEL) ?? {})).toEqual(["kind"]);
    expect(Object.keys(deriveAttackCoinFlip(PRINTED) ?? {}).sort()).toEqual(["kind", "ops"]);
  });

  it("the fixture pool is UNTOUCHED — the board surgery is file-local", () => {
    expect(FIXTURE_POOL["sv03-004"]?.attacks?.[0]?.effect).toBe(BARE_PREVENT);
    expect(board(HEADS_SEEDS[0]).cardPool["sv03-004"]?.attacks?.[0]?.effect).toBe(PRINTED);
  });
});
