import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackPreDamage,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";

const PRINTED =
  "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";

/** The compound's two segments, split at the printed `. ` join. */
const HEAD = "This attack does 30 damage for each {W} Energy attached to this Pokémon.";
const TAIL =
  "Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";

const TYPED_SIBLING =
  "You may attach any number of Basic {W} Energy cards from your hand to your Pokémon in any way you like.";

const BARE_SIBLING =
  "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.";

const TO_SELF =
  "Attach an Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon.";

type Reader = (text: string) => unknown;

function claimants(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, Reader | undefined>)[name];
    if (read === undefined) throw new Error(`reader surface names a missing export: ${name}`);
    return read(text) !== null;
  });
}

const SPLITTERS = {
  splitAttackRequirementClause,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackTrailingClause,
} as const;

function splitVerdicts(text: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(SPLITTERS).map(([name, split]) => [name, split(text)]));
}

describe("§1 the specimens come off the corpus", () => {
  it("the printed compound IS a corpus row, and its printing count is READ not typed", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === PRINTED);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(1);
  });

  it("the two printed siblings §3 and §5 lean on are corpus rows too", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.filter(([, t]) => t === BARE_SIBLING).map(([n]) => n)).toEqual([4]);
    expect(corpus.filter(([, t]) => t === TO_SELF).map(([n]) => n)).toEqual([1]);
  });

  it("TYPED_SIBLING is CONSTRUCTED, and the rung that uses it says so", () => {
    expect(legalAttackCorpus().some(([, t]) => t === TYPED_SIBLING)).toBe(false);
  });

  it("the compound really is HEAD + ' ' + TAIL, byte for byte", () => {
    expect(`${HEAD} ${TAIL}`).toBe(PRINTED);
  });
});

describe("§2 build state, re-derived off the module surface", () => {
  it("the printed compound is refused by ALL FOUR splitters — D552: INVERTED, and claimed by exactly ONE reader of the thirteen", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(claimants(PRINTED)).toEqual(["deriveAttackDiscardScaledBoost"]);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(splitVerdicts(PRINTED)).toEqual({
      splitAttackRequirementClause: null,
      splitAttackCancelClause: null,
      splitAttackGateClause: null,
      splitAttackTrailingClause: null,
    });
  });

  it("the HEAD builds, and exactly ONE reader owns it", () => {
    expect(claimants(HEAD)).toEqual(["deriveAttackDamageMultiplier"]);
    expect(deriveAttackDamageMultiplier(HEAD)).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", energyType: "Water" },
    });
  });

  it("the TAIL alone is refused by all thirteen — the half the engine cannot place", () => {
    expect(claimants(TAIL)).toEqual([]);
  });
});

describe("§3 the axis lattice — the {W} filter is free, the PREFIX and the DESTINATION are not", () => {
  it("the FILTER axis is INERT ON THE VERDICT: the shipped anchor already takes {W}", () => {
    expect(deriveAttackEffect(TYPED_SIBLING)).toEqual([
      { op: "attachFromHand", filter: { kind: "basicEnergy", energyType: "Water" } },
    ]);
    expect(deriveAttackEffect(BARE_SIBLING)).toEqual([
      { op: "attachFromHand", filter: { kind: "basicEnergy" } },
    ]);
  });

  it("the PREFIX axis is a blocker: 'Before doing damage, ' refuses the same act", () => {
    // One axis moved, nothing else. The act, the quantifier, the source and the
    // destination are byte-identical to `TYPED_SIBLING` above, which builds.
    const prefixed =
      "Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to your Pokémon in any way you like.";
    expect(claimants(prefixed)).toEqual([]);
  });

  it("the DESTINATION axis is a blocker: 'to this Pokémon' refuses the same act", () => {
    const narrowed =
      "You may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";
    expect(claimants(narrowed)).toEqual([]);
  });

  it("BUILT-BY-WEIGHT over the whole-sentence 2³: D552 1/1 · 0/3 · 0/3 · 0/1 (was 0/1 · 0/3 · 0/3 · 0/1)", () => {
    const prefixes = ["Before doing damage, you may attach", "You may attach"];
    const dests = ["to this Pokémon.", "to your Pokémon in any way you like."];
    const filters = ["Basic {W} Energy cards", "Basic Energy cards"];
    const points = new Set<string>();
    const builtByWeight = [0, 0, 0, 0];
    const pointsByWeight = [0, 0, 0, 0];
    for (let bits = 0; bits < 8; bits++) {
      const tail = `${prefixes[bits & 1]} any number of ${filters[(bits >> 2) & 1]} from your hand ${dests[(bits >> 1) & 1]}`;
      const point = `${HEAD} ${tail}`;
      if (points.has(point)) continue;
      points.add(point);
      const weight = (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1);
      pointsByWeight[weight] = (pointsByWeight[weight] ?? 0) + 1;
      if (claimants(point).length > 0) builtByWeight[weight] = (builtByWeight[weight] ?? 0) + 1;
    }
    expect(points.size).toBe(8);
    expect(pointsByWeight).toEqual([1, 3, 3, 1]);
    expect(builtByWeight).toEqual([1, 0, 0, 0]);
    const tailBuilt = [0, 0, 0, 0];
    for (let bits = 0; bits < 8; bits++) {
      const tail = `${prefixes[bits & 1]} any number of ${filters[(bits >> 2) & 1]} from your hand ${dests[(bits >> 1) & 1]}`;
      const weight = (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1);
      if (claimants(tail).length > 0) tailBuilt[weight] = (tailBuilt[weight] ?? 0) + 1;
    }
    expect(tailBuilt).toEqual([0, 0, 1, 1]);
  });
});

describe("§4 the trailing splitter already composes this shape — the cheap road is the trap", () => {
  it("`splitAttackTrailingClause` COMPOSES a multiplier head with an effect tail", () => {
    expect(splitAttackTrailingClause(`${HEAD} ${TYPED_SIBLING}`)).toEqual({
      head: HEAD,
      tail: TYPED_SIBLING,
    });
  });

  it("THE TRIPWIRE: `deriveAttackEffect` must NOT claim the printed tail", () => {
    expect(deriveAttackEffect(TAIL)).toBeNull();
    expect(deriveAttackEffect(BARE_SIBLING)).not.toBeNull();
  });

  it("and no OTHER reader claims the tail either, so the refusal is thirteen-way", () => {
    expect(claimants(TAIL)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE SEAM AND THE PINCER, pinned on the POPULATION rather than on a specimen.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 the seam: no printed sentence needs a pre-damage reader AND a scaling reader", () => {
  it("`deriveAttackPreDamage` claims exactly 4 sentences / 8 printings, and NONE scales", () => {
    const corpus = legalAttackCorpus();
    const pre = corpus.filter(([, text]) => deriveAttackPreDamage(text) !== null);
    expect(pre).toHaveLength(4);
    expect(pre.reduce((sum, [n]) => sum + n, 0)).toBe(8);
    const scaling = [
      "deriveAttackDamageBonus",
      "deriveAttackDamageMultiplier",
      "deriveAttackDamagePenalty",
    ];
    const dual = pre.filter(([, text]) => scaling.some((name) => claimants(text).includes(name)));
    expect(dual).toEqual([]);
  });

  it("exactly ONE corpus sentence would need both, and it is this one", () => {
    const both = legalAttackCorpus().filter(
      ([, text]) => /[Bb]efore doing damage/.test(text) && /for each/i.test(text),
    );
    expect(both.map(([, text]) => text)).toEqual([PRINTED]);
  });
});

describe("§5b the destination pincer: two attach ops, neither with both halves of the print", () => {
  it("`attachFromHand` takes the unbounded count and carries NO destination", () => {
    const program = deriveAttackEffect(BARE_SIBLING);
    expect(program).toEqual([{ op: "attachFromHand", filter: { kind: "basicEnergy" } }]);
    expect(Object.keys(program?.[0] ?? {}).sort()).toEqual(["filter", "op"]);
  });

  it("`attachEnergyFrom` carries `toSelf` and a count that is a NUMBER", () => {
    const program = deriveAttackEffect(TO_SELF);
    expect(program).toEqual([
      { op: "attachEnergyFrom", source: "hand", anyEnergy: true, toSelf: true, healTarget: 60 },
    ]);
    expect(program?.[0]).toHaveProperty("toSelf", true);
  });
});

describe("§6 every branch frees the SAME single row, so the fork was never a fork", () => {
  it(" D552: all three branches have a SOLO payoff of ZERO now — the row left the residue by a fourth route (was: 1 sentence / 1 printing each, this one)", () => {
    const residue = legalAttackCorpus()
      .filter(([, text]) => !resolvedByAnyReader(text))
      .filter(([, text]) => {
        const gate = splitAttackGateClause(text);
        if (gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))) return false;
        return splitAttackTrailingClause(text) === null;
      });

    // (A) a PARKABLE pre-damage seam.
    const branchA = residue.filter(([, t]) => /[Bb]efore doing damage/.test(t));
    // (B) a destination narrowing on the unbounded hand attach.
    const branchB = residue.filter(([, t]) => /attach[^.]*from your hand/i.test(t));
    // (C) the scaling fold recomputed after the pre-damage hook.
    const branchC = residue.filter(
      ([, t]) => /[Bb]efore doing damage/.test(t) && /for each/i.test(t),
    );

    for (const [label, branch] of [
      ["A", branchA],
      ["B", branchB],
      ["C", branchC],
    ] as const) {
      expect(
        branch.map(([, t]) => t),
        `branch ${label}`,
      ).toEqual([]);
      expect(
        branch.reduce((sum, [n]) => sum + n, 0),
        `branch ${label}`,
      ).toBe(0);
    }
    expect(residue.some(([, t]) => t === PRINTED)).toBe(false);
  });

  it("and branch C moves ZERO shipped printings, which is what bounds its risk", () => {
    const preDamageRows = legalAttackCorpus().filter(
      ([, text]) => deriveAttackPreDamage(text) !== null,
    );
    for (const [, text] of preDamageRows) {
      expect(claimants(text), text).toEqual(["deriveAttackPreDamage"]);
    }
  });
});
