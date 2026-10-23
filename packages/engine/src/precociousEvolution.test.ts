import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction } from "./index";
import type { GameState } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  RARE_CANDY_DECK,
  TRIGGER_DECK,
  benchFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setDamage,
} from "./testFixtures";

const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackCancelRequirement,
];

function rawUnitsAtHead(): number {
  return legalAttackCorpus()
    .filter(([, text]) => resolvedByAnyReader(text))
    .reduce((sum, [units]) => sum + units, 0);
}

function splitUnitsAtHead(): number {
  return legalAttackCorpus()
    .filter(([, text]) => {
      const split = splitAttackGateClause(text);
      return split !== null && !resolvedByAnyReader(text) && resolvedByAnyReader(split.body);
    })
    .reduce((sum, [units]) => sum + units, 0);
}

function compoundUnitsAtHead(): number {
  return legalAttackCorpus()
    .filter(([, text]) => {
      const split = splitAttackTrailingClause(text);
      if (split === null) return false;
      // Belt and braces: the two terms above must not already own it.
      return !resolvedByAnyReader(text) && splitAttackGateClause(text) === null;
    })
    .reduce((sum, [units]) => sum + units, 0);
}

const REGISTRY_ATTACK_UNITS = 16;

const DERIVABLE_CONTROL = "Draw a card.";

/** The BARE family sentence — Eevee ×2, Dwebble, Team Rocket's Pupitar. */
const BARE =
  "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";

/** The GATED family sentence — Exeggcute ×2. Byte-identical to `BARE` after the
    licence clause, which is the whole reason the two live in different summands
    of `BUILT.attack`. */
const GATED = `If you go first, you can use this attack during your first turn. ${BARE}`;

/** The four cards, by the ids D1 returned at `legal_standard = 1`. */
const FAMILY_IDS = [
  "sv06-135",
  "sv06-188",
  "sv08-001",
  "sv08-192",
  "sv10-011",
  "sv10-095",
] as const;

const GATED_IDS = ["sv08-001", "sv08-192"] as const;

function unitsOf(sentence: string): number | undefined {
  return legalAttackCorpus().find(([, text]) => text === sentence)?.[0];
}

describe("D306 §1 — the family in the committed corpus: two sentences, 4 + 2 printings", () => {
  it("both sentences are IN the corpus, and their units are the D1 sweep's 4 and 2", () => {
    expect(unitsOf(BARE)).toBe(4);
    expect(unitsOf(GATED)).toBe(2);
    expect((unitsOf(BARE) ?? 0) + (unitsOf(GATED) ?? 0)).toBe(6);
  });

  it("they are TWO records, not one — the licence is what separates them", () => {
    const records = legalAttackCorpus().filter(([, text]) => text.includes("put it onto this Pok"));
    expect(records.map(([units]) => units).sort()).toEqual([2, 4]);
    expect(records.length).toBe(2);
    const gatedRecord = records.find(([units]) => units === 2)?.[1];
    const bareRecord = records.find(([units]) => units === 4)?.[1];
    expect(bareRecord).toBe(BARE);
    expect(gatedRecord).toBe(GATED);
    expect(gatedRecord?.endsWith(bareRecord ?? "")).toBe(true);
    expect(gatedRecord).not.toBe(bareRecord);
  });

  it("the licence is the SPLIT anchor's clause, and the remainder is the bare sentence", () => {
    // This is the mechanical statement of "the two sentences are the same body":
    // the existing gate-splitter, applied to the gated record, returns exactly
    // the bare record's text. Nothing new is being taught to any reader here.
    const split = splitAttackGateClause(GATED);
    expect(split).not.toBeNull();
    expect(split?.body).toBe(BARE);
    // …and the bare sentence carries no gate of its own.
    expect(splitAttackGateClause(BARE)).toBeNull();
  });
});

describe("D306 §2 — what BUILT.attack would move by, keyed on the READER", () => {
  it("the attribution control resolves, so a `false` below is a refusal and not a broken import", () => {
    expect(resolvedByAnyReader(DERIVABLE_CONTROL)).toBe(true);
  });

  it("the ELEVEN readers ARE the module's whole attack-reader surface — the copy is complete", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("D307 — BOTH sentences now RESOLVE, and they resolve DIFFERENTLY", () => {
    expect(resolvedByAnyReader(BARE)).toBe(true);
    expect(resolvedByAnyReader(GATED)).toBe(false);
    expect(resolvedByAnyReader(splitAttackGateClause(GATED)?.body ?? GATED)).toBe(true);
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "evolveFromDeck" }, { op: "shuffleDeck" }]);
    expect(deriveAttackDamageBonus(BARE)).toBeNull();
    expect(deriveAttackDamageMultiplier(BARE)).toBeNull();
    expect(deriveAttackCoinFlip(BARE)).toBeNull();
    expect(deriveAttackRequirement(BARE)).toBeNull();
  });

  it("THE ANSWER D305 COULD NOT GIVE: the move is SIX, not two", () => {
    const rawDelta = unitsOf(BARE) ?? 0;
    const splitDelta = unitsOf(GATED) ?? 0;
    expect(rawDelta).toBe(4);
    expect(splitDelta).toBe(2);
    expect(rawDelta + splitDelta).toBe(6);

    const rawHead = rawUnitsAtHead();
    const splitHead = splitUnitsAtHead();
    expect(rawHead).toBe(1663);
    expect(splitHead).toBe(16);
    const compoundHead = compoundUnitsAtHead();
    expect(compoundHead).toBe(22);
    const head = rawHead + splitHead + compoundHead + REGISTRY_ATTACK_UNITS;
    expect(head).toBe(1717);
    expect(
      head -
        6 -
        6 -
        9 -
        6 -
        2 -
        2 -
        1 -
        4 -
        2 -
        4 -
        2 -
        2 -
        2 -
        1 -
        3 -
        1 -
        2 -
        3 -
        2 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        2 -
        1 -
        2 -
        3 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        4 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        5 -
        1 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        1 -
        3 -
        3 -
        1 -
        2 -
        2 -
        2 -
        4 -
        4 -
        2 -
        2 -
        3 -
        3 -
        2 -
        5 -
        3 -
        2 -
        3 -
        3 -
        9 -
        6 -
        5 -
        3 -
        2 -
        8 -
        8 -
        rawDelta -
        splitDelta,
    ).toBe(1485);
  });

  it("D307 — the gated record was the last unresolved gate sentence; the term CLOSES", () => {
    const gated = legalAttackCorpus().filter(([, text]) => splitAttackGateClause(text) !== null);
    expect(gated.length).toBe(9);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(19);
    const withBody = gated.filter(([, text]) => splitAttackGateClause(text)?.body !== "");
    expect(withBody.length).toBe(6);
    const unresolved = withBody.filter(
      ([, text]) => !resolvedByAnyReader(splitAttackGateClause(text)?.body ?? text),
    );
    expect(unresolved.map(([, text]) => text)).toEqual([]);
    expect(unresolved.reduce((sum, [units]) => sum + units, 0)).toBe(0);
    expect(withBody.reduce((sum, [units]) => sum + units, 0)).toBe(16);
  });
});

describe("D306 §3 — the blocker, DRIVEN: placeEvolution's two tails are phases", () => {
  it("TAIL A — the on-evolve trigger PARKS: placeEvolution returns effect:choose", () => {
    // Arboliva `sv01-023` "Enriching Oil" (onEvolve, optional, healChosen "all").
    // Two heal candidates ⇒ a real prompt, i.e. a phase an op cannot produce.
    let state = triggerBoard(3);
    state = setDamage(state, "p1", 40);
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = handFromDeck(state, "p1", "sv01-023", 1);
    const uid = handUid(state, "p1", "sv01-023");
    const { state: parked } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    // The phase is the trigger's, not the caller's — `evolve` returned what
    // `placeEvolution` handed it, unchanged.
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("TAIL B — the evolve-below-HP KO seeds PENDING STAGES: ko:takePrizes", () => {
    const state = charmedLethalBoard();
    const { state: next } = mustApply(state.board, state.action);
    expect(next.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    // …and the resume stage really is queued behind it, which is the shape no
    // `EffectOp` result can carry.
    expect(next.pending.length).toBeGreaterThan(0);
  });

  it("D307 — `searchDeck.dest` is STILL bench|hand: the evolve dest is its own op", () => {
    const dests = new Set<string>();
    let seen = 0;
    for (const id of registryCardIds()) {
      walk(programFor(id), (node) => {
        if (node.op !== "searchDeck") return;
        seen++;
        if (typeof node.dest === "string") dests.add(node.dest);
      });
    }
    // The control: a zero-op walk would make the assertion below vacuously
    // green on an empty set.
    expect(seen).toBeGreaterThan(0);
    expect([...dests].sort()).toEqual(["attachToSelf", "bench", "deckTop", "discard", "hand"]);
  });
});

describe("D306 §4 — the gate half stands; the body half is absent on all four cards", () => {
  it("the two GATED ids carry the licence and NOTHING else", () => {
    for (const id of GATED_IDS) {
      const program = programFor(id);
      expect(program, id).toBeDefined();
      expect(program?.attackGate?.[0]).toEqual({ kind: "firstTurnExempt" });
      expect(program?.attack, id).toBeUndefined();
    }
    expect(programFor("sv08-001")).toBe(programFor("sv08-192"));
  });

  it("the four NON-gated printings are not in the registry at all — the family is 2 of 6", () => {
    for (const id of FAMILY_IDS) {
      const inRegistry = programFor(id) !== undefined;
      expect(inRegistry, id).toBe((GATED_IDS as readonly string[]).includes(id));
    }
  });
});

// ── fixtures ────────────────────────────────────────────────────────────────

/** p1 going first on TRIGGER_DECK, passed to `turn` (evolve-legal at 3). */
function triggerBoard(turn: number): GameState {
  let state = driveSetup(
    3,
    { p1: TRIGGER_DECK, p2: TRIGGER_DECK },
    { first: "p1", active: { p1: "fix-basic-1", p2: "fix-basic-1" } },
  );
  while (state.turn < turn) {
    if (state.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${state.phase.kind} while passing to turn ${turn}`);
    }
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return state;
}

/** Walk every nested object of a registry program, calling `visit` on each one
    that carries an `op` discriminant — gate branches (`then` / `otherwise`)
    included, which a shallow scan of the top-level arrays would miss. */
function walk(node: unknown, visit: (op: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (typeof record.op === "string") visit(record);
  for (const value of Object.values(record)) walk(value, visit);
}

/** The charmed-Basic board whose Rare Candy skip is instantly lethal, plus the
    action that lands it. Built here rather than imported so this file drives the
    tail itself. */
function charmedLethalBoard(): {
  board: GameState;
  action: Parameters<typeof applyAction>[1];
} {
  let state = driveSetup(
    4,
    { p1: RARE_CANDY_DECK, p2: RARE_CANDY_DECK },
    {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
      bench: { p1: ["fix-basic-1"] },
    },
  );
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${state.phase.kind} while passing to turn 3`);
    }
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  state = handFromDeck(state, "p1", "sv02-173", 1);
  const charmUid = handUid(state, "p1", "sv02-173");
  state = mustApply(state, {
    type: "attachTool",
    seat: "p1",
    uid: charmUid,
    target: { spot: "active" },
  }).state;
  state = setDamage(state, "p1", 100);
  state = handFromDeck(state, "p1", "sv01-191", 1);
  const rareUid = handUid(state, "p1", "sv01-191");
  state = handFromDeck(state, "p1", "fix-stage2-frail", 1);
  const frailUid = handUid(state, "p1", "fix-stage2-frail");
  return {
    board: state,
    action: {
      type: "rareCandy",
      seat: "p1",
      uid: rareUid,
      target: { spot: "active" },
      evolutionUid: frailUid,
    },
  };
}
