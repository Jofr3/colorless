/**
 * THE MUTANT CORPUS — declared as DATA, never narrated.
 *
 * Every row here is transcribed from a landed `docs/decisions.md` row that
 * claimed a mutant tally. Until D211 those tallies ("13 mutants, 3 survivors")
 * were PROSE: nothing re-ran them, nothing regressed them, and a slice that
 * reported "12 killed" while the suite would have passed three of them was
 * indistinguishable from an honest one. A row in this file is the same claim
 * made re-runnable by someone who was not in the room — six months from now,
 * with `bun run mutants`.
 *
 * ⚠️ WHAT A ROW IS. A mutant is a single exact-text substitution against ONE
 * source file, plus the smallest set of suites that could plausibly notice.
 * `find` must occur EXACTLY ONCE in the file — the runner errors out on zero
 * matches (the code moved; the row is stale and must be re-transcribed, not
 * skipped) and on two or more (ambiguous; the substitution is not a fact).
 * That uniqueness check is the whole reason these are strings and not line
 * numbers: a line number rots silently, a unique string rots LOUDLY.
 *
 * ⚠️ WHAT `survives` MEANS, AND WHY IT IS NOT AN ALLOWLIST. This session found
 * three real cases where a surviving mutant was correct-and-unreachable rather
 * than a suite gap — D202's leading `^` (every near-miss the catalog prints
 * carries its clause at the START), D196's declaration-snapshot read, and
 * D205's `count <= 1` vs `< 1` (a comparison no authored row can reach, which
 * was then REMOVED rather than tested around). A `survives` row records that
 * finding so a legitimate survivor does not read as a failure every run. It is
 * the opposite of an allowlist in one specific way: if a `survives` mutant is
 * KILLED, the runner reports STALE-SURVIVOR and exits non-zero, because the
 * recorded reason has stopped being true and the decision row that states it is
 * now wrong. Both directions are findings.
 */

/** Why a mutant is expected to survive. Three kinds, all seen for real:
 *   - `equivalent`         — the mutated program computes the same thing on
 *                            every reachable input (D196's snapshot read).
 *   - `unreachable-population` — a real board/card COULD distinguish it, but no
 *                            such card is printed (D202's leading `^`).
 *   - `unreachable-shape`  — the repo's own authoring rules make the difference
 *                            unconstructible (D205's never-spelled `count: 1`). */
export type SurvivalKind = "equivalent" | "unreachable-population" | "unreachable-shape";

export type Mutant = {
  /** Stable, quotable id. Prefix is the decision this was transcribed FROM. */
  id: string;
  /** The `docs/decisions.md` row whose mutant tally this row makes re-runnable. */
  decision: string;
  /** One line: what the mutation breaks, in the vocabulary of the decision row. */
  what: string;
  /** Repo-relative path. The runner refuses anything outside the repo root. */
  file: string;
  /** Exact source text. MUST occur exactly once in `file`. */
  find: string;
  /** What it becomes. */
  replace: string;
  /**
   * The suites that could plausibly kill it — repo-relative test files, passed
   * to `vitest run` as a positional filter. This is the speed budget: the full
   * suite is ~70s and 235 files, a targeted run is ~2s, and at 14 mutants that
   * is the difference between a tool that gets used and one that does not.
   * Under-narrowing is safe (slower); OVER-narrowing is a lie, because a mutant
   * "survives" a suite that was never going to run the code. Keep every file
   * that actually asserts on the mutated site.
   */
  expectKilledBy: string[];
  /** Optional `vitest -t` substring, to narrow further within a large file. */
  nameFilter?: string;
  /** Present ⇒ this mutant is EXPECTED to survive, for the reason given. */
  survives?: { kind: SurvivalKind; reason: string };
};

export const MUTANTS: Mutant[] = [
  // ── D192 · main-hit damage-modifier suppression ────────────────────────────
  // "13 mutants, 3 first-round survivors, all killed by boards the suite lacked."
  {
    id: "D192-weakness",
    decision: "D192",
    what: "attack damage suppression stops nulling Weakness (the ×2 comes back)",
    file: "packages/engine/src/attack.ts",
    find: "damageSuppression?.weakness === true || seatRemovesWeakness(next, defenderSeat)",
    replace: "seatRemovesWeakness(next, defenderSeat)",
    expectKilledBy: ["packages/engine/src/damageSuppression.test.ts"],
  },
  {
    id: "D192-resistance",
    decision: "D192",
    what: "attack damage suppression stops nulling Resistance (the −30 comes back)",
    file: "packages/engine/src/attack.ts",
    find: "damageSuppression?.resistance === true ? null : resistanceOf(attacker, defenderCard)",
    replace: "resistanceOf(attacker, defenderCard)",
    expectKilledBy: ["packages/engine/src/damageSuppression.test.ts"],
  },
  {
    id: "D192-predebuff",
    decision: "D192",
    what: "the FOURTH suppression site the brief did not name — the pre-W/R opposingAttackDebuff survives targetEffects",
    file: "packages/engine/src/attack.ts",
    find: "(suppressTargetEffects ? 0 : opposingAttackDebuff(next, active)) +",
    replace: "opposingAttackDebuff(next, active) +",
    expectKilledBy: ["packages/engine/src/damageSuppression.test.ts"],
  },
  {
    id: "D192-othersOnly",
    decision: "D192 (inheriting D161)",
    what: "under suppression the seat-wide reduction aura drops to zero instead of othersOnly",
    file: "packages/engine/src/attack.ts",
    find: '? seatDamageReduction(next, defender, "othersOnly")',
    replace: '? seatDamageReduction(next, defender, "all")',
    expectKilledBy: ["packages/engine/src/damageSuppression.test.ts"],
  },
  {
    id: "D192-ontarget-trio",
    decision: "D192 (inheriting D159)",
    what: "the ON-TARGET prevention trio stops being suppressed (the split that keeps the OFF-TARGET pair outside)",
    file: "packages/engine/src/attack.ts",
    find: "(!suppressTargetEffects &&",
    replace: "(true &&",
    expectKilledBy: ["packages/engine/src/damageSuppression.test.ts"],
  },

  // ── D196 · energyOnSelf ────────────────────────────────────────────────────
  // "13 mutants, ONE real first-round survivor and it was a real gap:
  //  countEnergyInPlay(state, attackerSeat, …) passed because the mirror board
  //  left the attacker's Bench bare. A SECOND survivor is EQUIVALENT."
  {
    id: "D196-seat-zone",
    decision: "D196",
    what: "energyOnSelf reads the attacker's WHOLE SIDE instead of the attacking body — the real first-round survivor, closed by one {R} on bench[0]",
    file: "packages/engine/src/attack.ts",
    find: "return countAttachedEnergy(state, attacker, bonus.count.energyType) * bonus.per;",
    replace: "return countEnergyInPlay(state, attackerSeat, bonus.count.energyType) * bonus.per;",
    expectKilledBy: ["packages/engine/src/selfEnergyScaling.test.ts"],
  },
  {
    id: "D196-live-active",
    decision: "D196",
    what: "energyOnSelf reads the LIVE Active rather than the declaration snapshot",
    file: "packages/engine/src/attack.ts",
    find: "return countAttachedEnergy(state, attacker, bonus.count.energyType) * bonus.per;",
    replace:
      "return countAttachedEnergy(state, state.players[attackerSeat].active ?? attacker, bonus.count.energyType) * bonus.per;",
    expectKilledBy: ["packages/engine/src/selfEnergyScaling.test.ts"],
    survives: {
      kind: "equivalent",
      reason:
        "D196 recorded this as EQUIVALENT rather than dropping it. The only pre-fold mutation of the attacker is the confusion self-damage, which carries `energy` across untouched and on tails never reaches the fold — so the live Active and the declaration snapshot hold the same Energy on every reachable board.",
    },
  },

  // ── D200 / D204 · the owner-prefix subgroup predicate ──────────────────────
  // D200: "11 mutants, all killed first round."
  // D204: "16 mutants, one real survivor: name.startsWith(owner) without the
  //        possessive, killed by Noctowl, because `N` is a real owner."
  {
    id: "D200-possessive",
    decision: "D204 (vs D200 predicate)",
    what: "ownerPokemon drops the possessive — startsWith(owner), which takes every N-initial Pokémon (Noctowl)",
    file: "packages/engine/src/cards.ts",
    find: "card.name.startsWith(`${filter.owner}'s `) &&",
    replace: "card.name.startsWith(filter.owner) &&",
    expectKilledBy: [
      "packages/engine/src/ownerPrefix.test.ts",
      "packages/engine/src/inPlayTarget.test.ts",
      "packages/engine/src/ownerTargetOps.test.ts",
    ],
  },
  {
    id: "D200-category",
    decision: "D200",
    what: 'ownerPokemon drops the `category === "Pokemon"` conjunct — the one Team Rocket\'s Energy breaks a name-only rule with',
    file: "packages/engine/src/cards.ts",
    find: 'card.category === "Pokemon" &&\n        card.name.startsWith(`${filter.owner}\'s `) &&',
    replace: "card.name.startsWith(`${filter.owner}'s `) &&",
    expectKilledBy: [
      "packages/engine/src/ownerPrefix.test.ts",
      "packages/engine/src/inPlayTarget.test.ts",
    ],
  },
  {
    id: "D200-stage-rider",
    decision: "D200",
    what: "the `stage` rider stops filtering — 'a Basic Hop's Pokémon' accepts any stage",
    file: "packages/engine/src/cards.ts",
    find: '(filter.stage === undefined ||\n          (filter.stage === "basic" ? isBasicPokemon(card) : evolveFromOf(card) !== null))',
    replace: "true",
    expectKilledBy: [
      "packages/engine/src/ownerPrefix.test.ts",
      "packages/engine/src/inPlayTarget.test.ts",
      "packages/engine/src/legalNonAttackPrograms.test.ts",
    ],
  },

  // ── D202 · the "You may …" producer ────────────────────────────────────────
  // "ONE MUTANT SURVIVED THE FIRST ROUND — dropping the leading ^ — and the
  //  cause is a FACT ABOUT THE POPULATION … closed with CONSTRUCTED trailing
  //  witnesses, labelled as constructed."
  {
    id: "D202-caret-drawN",
    decision: "D202",
    what: 'the "You may draw N cards." anchor loses its leading ^ — D202\'s one first-round survivor, closed by CONSTRUCTED trailing witnesses',
    file: "packages/engine/src/effects.ts",
    find: "const ATTACK_MAY_DRAW = /^You may draw (\\d+) cards\\.$/;",
    replace: "const ATTACK_MAY_DRAW = /You may draw (\\d+) cards\\.$/;",
    expectKilledBy: ["packages/engine/src/optionalDraw.test.ts"],
  },
  {
    id: "D202-caret-drawUntil",
    decision: "D202",
    what: 'the "You may draw cards until you have N…" anchor loses its leading ^',
    file: "packages/engine/src/effects.ts",
    find: "const ATTACK_MAY_DRAW_UNTIL = /^You may draw cards until you have (\\d+) cards in your hand\\.$/;",
    replace:
      "const ATTACK_MAY_DRAW_UNTIL = /You may draw cards until you have (\\d+) cards in your hand\\.$/;",
    expectKilledBy: ["packages/engine/src/optionalDraw.test.ts"],
  },
  {
    id: "D202-tail-anchor",
    decision: "D202",
    what: 'the "You may draw N cards." anchor loses its TRAILING $ instead',
    file: "packages/engine/src/effects.ts",
    find: "const ATTACK_MAY_DRAW = /^You may draw (\\d+) cards\\.$/;",
    replace: "const ATTACK_MAY_DRAW = /^You may draw (\\d+) cards\\./;",
    expectKilledBy: ["packages/engine/src/optionalDraw.test.ts"],
  },

  // ── D204 / D205 · the prompt captions ──────────────────────────────────────
  {
    id: "D204-ownerNoun",
    decision: "D204/D205",
    what: 'the attach caption drops the possessive — "your Benched Team Rocket Pokémon", a subgroup no card prints',
    file: "packages/engine/src/interpreter.ts",
    find: 'return owner === undefined ? "" : `${owner}\'s `;',
    replace: 'return owner === undefined ? "" : `${owner} `;',
    expectKilledBy: [
      "packages/engine/src/inPlayTarget.test.ts",
      "packages/engine/src/ownerTargetOps.test.ts",
    ],
  },
  {
    id: "D205-caption-count",
    decision: "D205",
    what: 'the attachEnergyFrom caption stops naming the count — always "the Energy", a singular the print contradicts when count is 2',
    file: "packages/engine/src/interpreter.ts",
    find: 'op.count === undefined ? "the Energy" : `up to ${op.count} Energy`',
    replace: '"the Energy"',
    expectKilledBy: ["packages/engine/src/ownerTargetOps.test.ts"],
  },
  {
    id: "D205-count-le-1",
    decision: "D205",
    what: "the caption branch reinstated as a COMPARISON (`count <= 1`) rather than the field's presence — D205's removed unkillable mutant, re-declared as data",
    file: "packages/engine/src/interpreter.ts",
    find: 'op.count === undefined ? "the Energy" : `up to ${op.count} Energy`',
    replace: 'op.count === undefined || op.count <= 1 ? "the Energy" : `up to ${op.count} Energy`',
    expectKilledBy: ["packages/engine/src/ownerTargetOps.test.ts"],
    survives: {
      kind: "unreachable-shape",
      reason:
        "`count: 1` is never spelled — D104's minimal-shape rule omits a field that means what its absence means — so no authored row can reach the comparison at all. D205 REMOVED the comparison rather than testing around it; this row is what keeps that removal honest: if it is ever KILLED, some row now spells `count: 1` and D104's rule has been broken.",
    },
  },
];
