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
  /**
   * D215 — the killer is NOT a vitest suite. Some of this repo's guards are
   * scripts (`bun run lint:coverage`), and their decision rows publish mutation
   * tallies exactly like the engine rows do. An argv array, spawned at the repo
   * root with no shell; a non-zero exit is a KILL. When present it replaces
   * `expectKilledBy` entirely (which should then be `[]`) and `--full` is
   * ignored, because there is no wider suite for such a row to widen to.
   */
  killedByCommand?: string[];
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
    find: 'card.name.startsWith(`${filter.owner}\'s `) &&\n        (filter.stage === undefined ||\n          (filter.stage === "basic" ? isBasicPokemon(card) : evolveFromOf(card) !== null))',
    replace: "card.name.startsWith(`${filter.owner}'s `)",
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
    // ⚠️ WIDENED AT D246, WHICH MADE THIS EXPRESSION AMBIGUOUS BY AGREEING WITH
    // IT: `describeBranch`'s new `attachEnergyFrom` arm spells the same words for
    // the same op, deliberately. A `find` can break because of a line added
    // SOMEWHERE ELSE, so this one now carries the park caption's own frame.
    find: '`Attach ${\n          op.count === undefined ? "the Energy" : `up to ${op.count} Energy`\n        } to which of your ${attachTargetNoun(op)}?`,',
    replace: "`Attach the Energy to which of your ${attachTargetNoun(op)}?`,",
    expectKilledBy: ["packages/engine/src/ownerTargetOps.test.ts"],
  },
  {
    id: "D205-count-le-1",
    decision: "D205",
    what: "the caption branch reinstated as a COMPARISON (`count <= 1`) rather than the field's presence — D205's removed unkillable mutant, re-declared as data",
    file: "packages/engine/src/interpreter.ts",
    // ⚠️ WIDENED AT D246 for the row above's reason.
    find: '`Attach ${\n          op.count === undefined ? "the Energy" : `up to ${op.count} Energy`\n        } to which of your ${attachTargetNoun(op)}?`,',
    replace:
      '`Attach ${\n          op.count === undefined || op.count <= 1 ? "the Energy" : `up to ${op.count} Energy`\n        } to which of your ${attachTargetNoun(op)}?`,',
    expectKilledBy: ["packages/engine/src/ownerTargetOps.test.ts"],
    survives: {
      kind: "unreachable-shape",
      reason:
        "`count: 1` is never spelled — D104's minimal-shape rule omits a field that means what its absence means — so no authored row can reach the comparison at all. D205 REMOVED the comparison rather than testing around it; this row is what keeps that removal honest: if it is ever KILLED, some row now spells `count: 1` and D104's rule has been broken.",
    },
  },

  // ══ D215's transcription — the six-plus-one slices that landed after D211 ══
  //
  // ⚠️ EVERY `find` BELOW IS ANCHORED ON TEXT THAT NAMES ITS SITE. D207's
  // first-round "survivor" was an unanchored regex that mutated a BYTE-IDENTICAL
  // arm 1,400 lines away, and that wrong-row failure has now cost three slices.
  // Where a line is genuinely repeated (D207's two `counts` rows, D210's actor
  // gate, D208's four clamp call sites) the `find` carries a NEIGHBOURING line
  // that differs — the runner's uniqueness check then proves the anchoring
  // rather than leaving it to the author's eye.

  // ── D206 · the "Switch … If you do" seam ───────────────────────────────────
  // "34 mutants across three rounds, 33 killed, all four survivors reported."
  {
    id: "D206-active-subgroup",
    decision: "D206",
    what: "switchActiveTargets stops reading the printed sentence's FIRST noun — an Active outside the owner subgroup hands over a free Boss's Orders instead of refusing the play",
    file: "packages/engine/src/interpreter.ts",
    find: "  return activeInSubgroup ? bench : [];",
    replace: "  return bench;",
    expectKilledBy: ["packages/engine/src/switchSeam.test.ts"],
  },
  {
    id: "D206-bench-subgroup",
    decision: "D206",
    what: "the BENCH end of the same printed owner stops narrowing — `ownerPokemon` is D200's predicate at its fourth read site, and this drops one of its two reads",
    file: "packages/engine/src/interpreter.ts",
    // ⚠️ D273 RE-POINTED THIS FIND, IT DID NOT WEAKEN IT. `switchActiveTargets`
    // now wraps the same `subgroupRefs` call in `switchBenchNarrowing`, so the
    // one-line find no longer occurs; the mutant still drops the OWNER read at the
    // bench end and leaves the two new riders alone, which is the D206 claim.
    find: "    subgroupRefs(state, ownBenchRefs(state, seat), op.ownerPokemon),",
    replace: "    ownBenchRefs(state, seat),",
    expectKilledBy: ["packages/engine/src/switchSeam.test.ts"],
  },
  {
    id: "D206-files-every-row",
    decision: "D206",
    what: "the §9.2 filing takes EVERY emitted row rather than the POKEMON_SWITCHED one — D206's second real test gap, invisible until a Poisoned+Burned body switches AND a card parks again, because recordGateHolds asks LENGTH not contents",
    file: "packages/engine/src/interpreter.ts",
    find: '    emitted.flatMap((event) => (event.type === "POKEMON_SWITCHED" ? [event.nowActive] : [])),',
    replace:
      '    emitted.flatMap((event) =>\n      "nowActive" in event ? [event.nowActive] : "uid" in event ? [event.uid] : [],\n    ),',
    expectKilledBy: ["packages/engine/src/switchSeam.test.ts"],
  },

  // ── D207 · the opponent's remaining-Prize gate ─────────────────────────────
  // "11 mutants, 11 killed — after a first-round 'survivor' turned out to be an
  //  unanchored regex that mutated Falkner's byte-identical bonus arm."
  {
    id: "D207-lacey-counts",
    decision: "D207",
    what: 'Lacey\'s "3 or fewer" enumeration loses its top member — [0,1,2] instead of [0,1,2,3], the off-by-one at the boundary the printed word names',
    file: "packages/engine/src/registry.ts",
    find:
      '      cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] },\n' +
      "      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.\n" +
      '      then: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],',
    replace:
      '      cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2] },\n' +
      "      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.\n" +
      '      then: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],',
    expectKilledBy: ["packages/engine/src/opponentPrizeGate.test.ts"],
  },
  {
    id: "D207-hype-counts",
    decision: "D207",
    what: "the SAME off-by-one on Emcee's Hype — the byte-identical `cond` line one card over, which is exactly the row D207's unanchored first draft mutated by mistake",
    file: "packages/engine/src/registry.ts",
    find:
      '      cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] },\n' +
      "      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.\n" +
      '      then: [{ op: "drawCards", count: 2 }],',
    replace:
      '      cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2] },\n' +
      "      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.\n" +
      '      then: [{ op: "drawCards", count: 2 }],',
    expectKilledBy: ["packages/engine/src/opponentPrizeGate.test.ts"],
  },
  {
    id: "D207-seats-crossed",
    decision: "D207",
    what: "the two seats crossed — the gate reads the CONTROLLER's remaining Prizes instead of the opponent's",
    file: "packages/engine/src/interpreter.ts",
    find: "      return cond.counts.includes(state.players[otherSeat(seat)].prizes.length);",
    replace: "      return cond.counts.includes(state.players[seat].prizes.length);",
    expectKilledBy: ["packages/engine/src/opponentPrizeGate.test.ts"],
  },
  {
    id: "D207-remaining-vs-taken",
    decision: "D207",
    what: "REMAINING confused with TAKEN (6 − remaining, `opponentPrizesTaken`'s reading) — the two agree at remaining = 3 and NOWHERE else, so this mutant is only killable on a board at remaining 2 or 4",
    file: "packages/engine/src/interpreter.ts",
    find: "      return cond.counts.includes(state.players[otherSeat(seat)].prizes.length);",
    replace: "      return cond.counts.includes(6 - state.players[otherSeat(seat)].prizes.length);",
    expectKilledBy: ["packages/engine/src/opponentPrizeGate.test.ts"],
  },

  // ── D208 · the §8.1 KO-survival clamp ──────────────────────────────────────
  // "Twelve mutants, ELEVEN killed. The twelfth — a `dealt <= 0` guard — was
  //  PROVABLY DEAD and REMOVED rather than tested around, so it is deliberately
  //  NOT transcribed here: there is no branch left for a `survives` row to be
  //  about, and declaring one would assert the existence of code that is gone."
  {
    id: "D208-drop-passive",
    decision: "D208",
    what: "the clamp stops reading the passive — every full-HP body in the game survives its first KO (D208's loudest mutant: 72 tests red on the full suite)",
    file: "packages/engine/src/continuous.ts",
    find: "  if (!passivesOf(state, pokemon).survivesKoAtFullHp) return null;\n",
    replace: "",
    expectKilledBy: ["packages/engine/src/koSurvival.test.ts"],
  },
  {
    id: "D208-drop-antecedent",
    decision: "D208",
    what: 'the printed antecedent "has FULL HP" is forgotten — a holder with a damage counter on it survives too',
    file: "packages/engine/src/continuous.ts",
    find: "  if (pokemon.damage !== 0) return null;\n",
    replace: "",
    expectKilledBy: ["packages/engine/src/koSurvival.test.ts"],
  },
  {
    id: "D208-lethality-strict",
    decision: "D208",
    what: "the lethality test goes STRICT (`>` for `>=`) — an EXACTLY lethal hit stops being survived, which is the common case and the whole point of the card",
    file: "packages/engine/src/continuous.ts",
    find: "  if (pokemon.damage + dealt < hp) return null;",
    replace: "  if (pokemon.damage + dealt <= hp) return null;",
    expectKilledBy: ["packages/engine/src/koSurvival.test.ts"],
  },
  {
    id: "D208-remaining-hp",
    decision: "D208",
    what: '"its remaining HP becomes 10" becomes 20 — the clamped TOTAL, the one number the printed sentence states outright',
    file: "packages/engine/src/continuous.ts",
    find: "  return Math.max(0, hp - KO_SURVIVAL_REMAINING_HP);",
    replace: "  return Math.max(0, hp - 20);",
    expectKilledBy: ["packages/engine/src/koSurvival.test.ts"],
  },
  {
    id: "D208-printed-hp",
    decision: "D208",
    what: "the clamp reads the PRINTED hp instead of `effectiveMaxHp` — a Bravery Charm on the holder raises both the bar and the HP left standing, and this gets both wrong on one board",
    file: "packages/engine/src/continuous.ts",
    find: "  const hp = effectiveMaxHp(state, pokemon);",
    replace: "  const hp = topCardOf(state, pokemon)?.hp ?? null;",
    expectKilledBy: ["packages/engine/src/koSurvival.test.ts"],
  },
  {
    id: "D208-site-mainhit",
    decision: "D208",
    what: "the clamp is dropped at the FIRST of its four DAMAGE_DEALT emitters — attack.ts's main hit",
    file: "packages/engine/src/attack.ts",
    find: "    const clamped = koSurvivalClamp(next, defender, dealt);",
    replace: "    const clamped = null;",
    expectKilledBy: ["packages/engine/src/koSurvival.test.ts"],
  },
  {
    id: "D208-site-spread",
    decision: "D208",
    what: "the clamp is dropped at `spreadDamage` — the site that reaches the BENCH, where these printings actually live",
    file: "packages/engine/src/interpreter.ts",
    find: "    const clamped = koSurvivalClamp(state, pokemon, dealt);",
    replace: "    const clamped = null;",
    expectKilledBy: ["packages/engine/src/koSurvival.test.ts"],
  },
  {
    id: "D208-site-placeSnipe",
    decision: "D208",
    what: "the clamp is dropped at `placeSnipe`'s `deals` arm — the arm whose sibling one screen up PLACES COUNTERS and must NOT clamp",
    file: "packages/engine/src/interpreter.ts",
    find: "    const clamped = koSurvivalClamp(next, pokemon, dealt);",
    replace: "    const clamped = null;",
    expectKilledBy: ["packages/engine/src/koSurvival.test.ts"],
  },
  {
    id: "D208-site-snipeActive",
    decision: "D208",
    what: "the clamp is dropped at `snipeActive` — the fourth and last emitter",
    file: "packages/engine/src/interpreter.ts",
    find: "  const clamped = koSurvivalClamp(state, target.active, dealt);",
    replace: "  const clamped = null;",
    expectKilledBy: ["packages/engine/src/koSurvival.test.ts"],
  },
  {
    id: "D208-survived-flag",
    decision: "D208",
    what: "DAMAGE_DEALT stops carrying `survived: true` on the main hit — the one persisted shape change of the slice, and the only way a log reader can tell a clamped row from a strange one",
    file: "packages/engine/src/attack.ts",
    find: "      survived: clamped === null ? undefined : true,",
    replace: "      survived: undefined,",
    expectKilledBy: ["packages/engine/src/koSurvival.test.ts"],
  },

  // ── D209 · the derived allowlist ⟺ the wire offer ──────────────────────────
  // D209 asserted the refusal in two links; D210 then flipped the entry to
  // `supported` and kept both biconditionals "verbatim in form, changed only in
  // value". This is the flip back, which must now go RED for the other reason.
  {
    id: "D209-disposition-flip",
    decision: "D209 (as flipped by D210)",
    what: "useStadiumAbility goes back to `withheld` while the wire still carries a `stadiumAbility` key — D209's biconditional, driven from the value D210 left it at",
    file: "apps/api/src/lobby/match.ts",
    find: '  useStadiumAbility: "supported",',
    replace: '  useStadiumAbility: "withheld",',
    expectKilledBy: ["apps/api/src/lobby/match.test.ts"],
  },

  // ── D210 · the shared Stadium's activation on the wire ─────────────────────
  // "Mutants measured, not asserted: drop the actor gate → 5 red; drop
  //  allowances.stadiumAbilityUsed → 3 red; gate on stadium.owner → 3 red."
  {
    id: "D210-actor-gate",
    decision: "D210",
    what: "the redaction drops the actor gate — the affordance leaks to the viewer whose turn it is not (D210: 5 red)",
    file: "packages/engine/src/redact.ts",
    find: "  if (viewerSeat !== turnSeat) return null;\n  const stadium = state.stadium;",
    replace: "  const stadium = state.stadium;",
    expectKilledBy: ["packages/engine/src/redactStadiumAbility.test.ts"],
  },
  {
    id: "D210-owner-gate",
    decision: "D210",
    what: "the discriminant becomes OWNERSHIP instead of the TURN — `stadium.owner`, which is wrong for exactly the board D210's leak test drives (p1's Stadium, p2's turn) (D210: 3 red)",
    file: "packages/engine/src/redact.ts",
    find: "  if (viewerSeat !== turnSeat) return null;\n  const stadium = state.stadium;",
    replace:
      "  const stadium = state.stadium;\n  if (stadium !== null && viewerSeat !== stadium.owner) return null;",
    expectKilledBy: ["packages/engine/src/redactStadiumAbility.test.ts"],
  },
  {
    id: "D210-used-flag",
    decision: "D210",
    what: "the per-turn `allowances.stadiumAbilityUsed` flag is dropped from the wire's `disabled` — a second activation is offered (D210: 3 red)",
    file: "packages/engine/src/redact.ts",
    find: "    disabled: state.allowances.stadiumAbilityUsed || noTarget,",
    replace: "    disabled: noTarget,",
    expectKilledBy: ["packages/engine/src/redactStadiumAbility.test.ts"],
  },
  {
    id: "D210-programPlayable",
    decision: "D210",
    what: "the wire's `!programPlayable` whiff gate is dropped — D210's ONE survivor, PINNED as vacuity rather than shipped as a fifth vacuous guard",
    file: "packages/engine/src/redact.ts",
    // ⚠️ ANCHORED PAST `redactedAbilitiesOf`, which spells a BYTE-IDENTICAL
    // `const noTarget = !programPlayable(state, ability.program, viewerSeat);`
    // 216 lines up at a deeper indent — D207's exact trap, and the reason this
    // `find` carries the three lines that follow it.
    find:
      "  const noTarget = !programPlayable(state, ability.program, viewerSeat);\n" +
      "  return {\n    label: ability.label,\n" +
      "    disabled: state.allowances.stadiumAbilityUsed || noTarget,",
    replace:
      "  const noTarget = false;\n" +
      "  return {\n    label: ability.label,\n" +
      "    disabled: state.allowances.stadiumAbilityUsed || noTarget,",
    expectKilledBy: ["packages/engine/src/redactStadiumAbility.test.ts"],
    survives: {
      kind: "unreachable-population",
      reason:
        '⚠️ THIS ROW IS THE PIN, AND DECLARING IT IS THE POINT. Every implemented Stadium ability searches a deck or retrieves from a discard, and `programPlayable` gates neither — so no printed Stadium ability whiff-gates and `"No legal target"` is unreachable from any authored card. D210 kept the term anyway because the engine gate has it. THE DAY A WHIFF-GATED STADIUM PROGRAM LANDS, this row reports STALE-SURVIVOR and someone re-reads the pin. Omitting it would silently lose that.',
    },
  },

  // ── D212 · the lint-coverage guard ─────────────────────────────────────────
  // "Mutation-tested three ways (drop scripts/** → RED on 7 files, drop
  //  vite.config.ts → RED on 1, drop src/** → RED on 98)." ⚠️ The killer is a
  // SCRIPT, not a suite — see `killedByCommand`. Mutating `biome.json` is also
  // the corpus's first mutant outside a TypeScript source file.
  {
    id: "D212-drop-scripts",
    decision: "D212",
    what: "`scripts/**` falls back out of Biome's include set — the exact hole D212 found, where `biome lint scripts` exits 0 on zero files processed",
    file: "biome.json",
    find: '    "include": ["src/**", "apps/**", "packages/**", "scripts/**", "vite.config.ts"],',
    replace: '    "include": ["src/**", "apps/**", "packages/**", "vite.config.ts"],',
    expectKilledBy: [],
    killedByCommand: ["bun", "scripts/lint-coverage.ts"],
  },
  {
    id: "D212-drop-vite-config",
    decision: "D212",
    what: "the repo-root `vite.config.ts` falls back out — the one-file version of the same hole, which is what makes the guard's arithmetic and not just its existence load-bearing",
    file: "biome.json",
    find: '    "include": ["src/**", "apps/**", "packages/**", "scripts/**", "vite.config.ts"],',
    replace: '    "include": ["src/**", "apps/**", "packages/**", "scripts/**"],',
    expectKilledBy: [],
    killedByCommand: ["bun", "scripts/lint-coverage.ts"],
  },

  // ── D213 · the same activation on the LOCAL hot-seat HUD ───────────────────
  // "7 of 8 mutants die; `!programPlayable` SURVIVES and is PINNED AS VACUITY."
  // ⚠️ Both rows live under `src/**`, which at D215's commit is a live agent's
  // working tree — so they are expected to report SKIPPED-DIRTY until it lands.
  // That is the harness working: a skip is a stated non-answer, not a pass.
  {
    id: "D213-used-flag",
    decision: "D213",
    what: "the local HUD's Stadium row drops the per-turn used flag — `disabled={false}` on a second activation, D210's mutant at the other surface",
    file: "src/features/game/GameHud.tsx",
    find: "    disabled: game.allowances.stadiumAbilityUsed || noTarget,",
    replace: "    disabled: noTarget,",
    expectKilledBy: ["src/features/game/GameHud.stadiumAbility.dom.test.tsx"],
  },
  {
    id: "D213-programPlayable",
    decision: "D213",
    what: "the local fold's `!programPlayable` whiff gate is dropped — D213's ONE survivor, pinned as vacuity on D210's precedent",
    file: "src/features/game/GameHud.tsx",
    // ⚠️ Anchored past `usableAbilities`, which spells the same line at a deeper
    // indent 90 lines up — the same trap as D210-programPlayable, one file over.
    // ⚠️ RE-TRANSCRIBED AT D222, which is the row working as designed: the call
    // gained a fourth argument (`stadium.uid`), the `find` stopped matching, and
    // the harness reported ERROR rather than skipping. *A line number rots
    // silently, a unique string rots loudly* — this is what that sentence buys.
    find:
      "  const noTarget = !programPlayable(game, ability.program, seat, stadium.uid);\n" +
      "  return {\n    label: ability.label,\n" +
      "    disabled: game.allowances.stadiumAbilityUsed || noTarget,",
    replace:
      "  const noTarget = false;\n" +
      "  return {\n    label: ability.label,\n" +
      "    disabled: game.allowances.stadiumAbilityUsed || noTarget,",
    expectKilledBy: ["src/features/game/GameHud.stadiumAbility.dom.test.tsx"],
    survives: {
      kind: "unreachable-population",
      reason:
        '⚠️ THE SECOND PIN, and the same fact as D210-programPlayable one surface over: no printed Stadium ability whiff-gates, so "No legal target" is unreachable from any authored card and D213 asserted all seven printings playable under the most adverse board, beside a `gust` control that IS false there. Kept because the engine gate has it. If this is ever KILLED, a whiff-gated Stadium program has landed and BOTH pins need re-reading.',
    },
  },

  // ── D221 · Teal Dance — the SELF target and the §9.2 slot on attachEnergyFrom ─
  // "5 mutants, 4 killed, 1 DECLARED survivor (the gate, whose false arm no
  //  action path can reach)."
  {
    id: "D221-class-target",
    decision: "D221",
    what: "the attach target falls back to the CLASS riders — the pre-D221 line, and exactly what D190 refused to ship: on a board with two {G} bodies the op parks and offers the wrong one",
    file: "packages/engine/src/interpreter.ts",
    // ⚠️ ANCHORED PAST `attachFromDeckOffer`, which spells a byte-similar line
    // 3,100 lines down (`…: attachEnergyTargets(state, seat, op)` — `seat`, not
    // `ctx.seat`). D207's wrong-row failure is what this anchor exists for.
    find: "        op.toSelf === true ? sourceRef(state, ctx) : attachEnergyTargets(state, ctx.seat, op),",
    replace: "        attachEnergyTargets(state, ctx.seat, op),",
    expectKilledBy: ["packages/engine/src/tealDance.test.ts"],
  },
  {
    id: "D221-no-record",
    decision: "D221",
    what: "the attach files nothing under its §9.2 slot, so the recordGate reads an empty slot and Teal Dance's printed draw silently disappears",
    file: "packages/engine/src/interpreter.ts",
    find: "  recordMoved(record, op.recordAs, energyUids);",
    replace: "",
    expectKilledBy: ["packages/engine/src/tealDance.test.ts"],
  },
  {
    id: "D221-energy-type",
    decision: "D221",
    what: "Teal Dance takes Baxcalibur's {W} — the neighbouring attach-from-hand row's REAL value, copied verbatim onto the new one",
    file: "packages/engine/src/registry.ts",
    find:
      '          op: "attachEnergyFrom",\n          source: "hand",\n          energyType: "Grass",\n' +
      "          toSelf: true,",
    replace:
      '          op: "attachEnergyFrom",\n          source: "hand",\n          energyType: "Water",\n' +
      "          toSelf: true,",
    expectKilledBy: ["packages/engine/src/tealDance.test.ts"],
  },
  {
    id: "D221-repeatable",
    decision: "D221",
    what: 'the printed "Once during your turn" becomes Baxcalibur\'s "As often as you like" — one word apart in the print, one boolean here',
    file: "packages/engine/src/registry.ts",
    find: '      name: "Teal Dance",\n      oncePerTurn: true,',
    replace: '      name: "Teal Dance",\n      oncePerTurn: false,',
    expectKilledBy: ["packages/engine/src/tealDance.test.ts"],
  },
  // ⚠️ THE ONE BELOW WAS WRITTEN AS A DECLARED `equivalent` SURVIVOR AND THE
  //    HARNESS REPORTED **STALE-SURVIVOR** — it is KILLED, and by the one kind of
  //    assertion the survival argument had not accounted for. The argument itself
  //    holds and is still worth reading: the gate's FALSE arm is unreachable from
  //    the action path (the attach can only whiff with no Basic {G} in hand, and
  //    `programPlayable` refuses the activation in exactly that case —
  //    `NO_LEGAL_TARGET`, pinned in `tealDance.test.ts`), so **no BOARD can tell
  //    the gated draw from an unconditional one.** What kills it is the
  //    DECLARATION snapshot — `toEqual` over the authored program — which is
  //    D196's equivalent-mutant finding arriving from the other side: a shape test
  //    kills shape mutants that no behaviour test could. Kept as a killed row and
  //    NOT re-declared, because "survives" would now be false; the useful warning
  //    is that its verdict says nothing about behaviour.
  {
    id: "D221-draw-outside-gate",
    decision: "D221",
    what: 'the printed "If you attached Energy … in this way" is dropped and the draw becomes unconditional — killed by the DECLARATION snapshot only; no reachable board distinguishes it',
    file: "packages/engine/src/registry.ts",
    find:
      '        {\n          op: "recordGate",\n          slot: "moved",\n' +
      "          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.\n" +
      '          then: [{ op: "drawCards", count: 1 }],\n        },',
    replace: '        { op: "drawCards", count: 1 },',
    expectKilledBy: ["packages/engine/src/tealDance.test.ts"],
  },

  // ── D222 · Flashing Draw — the `self` member and the gate's `sourceUid` ──────
  // "7 mutants, 6 killed, 1 DECLARED survivor (the §11 guard's duplicated
  //  own-board test, whose two readings no board can distinguish)."
  {
    id: "D222-your-active",
    decision: "D222",
    what: "the printed 'from THIS Pokémon' becomes `yourActive` — the neighbouring member's REAL value and the EXACT narrowing D190 dropped the row rather than ship: a benched Kilowattrel then pays off whichever body is Active",
    file: "packages/engine/src/registry.ts",
    find: '          op: "discardEnergy",\n          from: "self",',
    replace: '          op: "discardEnergy",\n          from: "yourActive",',
    expectKilledBy: ["packages/engine/src/flashingDraw.test.ts"],
  },
  {
    id: "D222-gate-drops-uid",
    decision: "D222",
    what: "`useAbility`'s playability gate stops passing the Pokémon's uid, so the printed board COST is asked of the Active instead of the host — the one-token omission the whole slice is about",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (!programPlayable(state, ability.program, action.seat, uid)) {",
    replace: "  if (!programPlayable(state, ability.program, action.seat)) {",
    expectKilledBy: ["packages/engine/src/flashingDraw.test.ts"],
  },
  {
    id: "D222-playable-drops-uid",
    decision: "D222",
    what: "the predicate accepts the uid and then drops it on the floor — the failure mode a widened signature invites, and the one a caller cannot see",
    file: "packages/engine/src/interpreter.ts",
    find: "  return discardableEnergies(state, seat, op, sourceUid).length > 0;",
    replace: "  return discardableEnergies(state, seat, op).length > 0;",
    expectKilledBy: ["packages/engine/src/flashingDraw.test.ts"],
  },
  {
    id: "D222-self-is-own-board",
    decision: "D222",
    what: '"this Pokémon" resolved as "your Pokémon, Active first" — `ownInPlayRefs` is the REAL code of the heal ops one screen away, and it silently makes the host\'s cost payable off any body',
    file: "packages/engine/src/interpreter.ts",
    find: "    const [ref] = sourceRef(state, { seat, sourceUid });",
    replace: "    const [ref] = ownInPlayRefs(state, seat);",
    expectKilledBy: ["packages/engine/src/flashingDraw.test.ts"],
  },
  {
    id: "D222-fixed-draw",
    decision: "D222",
    what: 'the printed "draw cards until you have 6" becomes a fixed draw of 6 — Trade\'s REAL shape (`drawCards`) one registry row over, and the difference is invisible on exactly one hand size',
    file: "packages/engine/src/registry.ts",
    find:
      '          filter: { kind: "basicEnergy", energyType: "Lightning" },\n        },\n' +
      '        { op: "drawUntilHandSize", size: 6 },',
    replace:
      '          filter: { kind: "basicEnergy", energyType: "Lightning" },\n        },\n' +
      '        { op: "drawCards", count: 6 },',
    expectKilledBy: ["packages/engine/src/flashingDraw.test.ts"],
  },
  {
    id: "D222-any-energy",
    decision: "D222",
    what: "the printed Basic {L} cost becomes any Energy — Crushing Hammer's REAL filter copied onto the new row, which makes the Ability payable with a {C} the card does not accept",
    file: "packages/engine/src/registry.ts",
    find:
      '          from: "self",\n' +
      '          filter: { kind: "basicEnergy", energyType: "Lightning" },',
    replace: '          from: "self",\n          filter: { kind: "anyEnergy" },',
    expectKilledBy: ["packages/engine/src/flashingDraw.test.ts"],
  },
  // ⚠️ A DECLARED SURVIVOR, AND THE HONEST LABEL FOR A REPAIR THAT FIXES A
  //    CLOSED-WORLD ASSUMPTION RATHER THAN A LIVE BUG. D222 replaced the §11
  //    guard's hand-spelled own-board test with a call to `discardVictimSeat`, the
  //    helper whose doc says it exists so the scan and the apply cannot disagree.
  //    Reverting it does not change any outcome a board can produce, for TWO
  //    independent reasons: `attackEffectRefused` returns false unless
  //    `ctx.invokedBy === "attack"`, and NO printed card puts a `self` discard
  //    inside an attack (§8 already makes an attack's "this Pokémon" the Active,
  //    which is what `yourActive` is for); and even if one did, the arm's own
  //    comment holds — a seat's §11 block can never be live during its own turn.
  //    ⚠️ D221's LESSON APPLIED BEFORE DECLARING: no declaration snapshot covers
  //    interpreter source, so nothing else kills it either. Kept because the
  //    defect class is real — a negated conjunction over union members is a
  //    closed-world assumption with no compiler behind it, and the NEXT own-board
  //    member would have inherited the bug silently.
  {
    id: "D222-duplicated-victim-test",
    decision: "D222",
    what: "the §11 attack-block guard goes back to spelling the own-board members itself instead of asking `discardVictimSeat` — the pre-D222 line, which a third own-board member falls straight out of",
    file: "packages/engine/src/interpreter.ts",
    // 🆕 RE-HOMED AT D259, NOT DELETED. That slice gated this guard on
    // `invokedBy === "attack"` (a Trainer's refusal is a per-candidate FILTER, not
    // a whole-op guard), which moved the line the mutant anchors to. The CLAIM is
    // untouched — the conjunction still falls out of a third own-board member — so
    // the anchor moves with it rather than the row being dropped.
    find: '      if (ctx.invokedBy === "attack" && discardVictimSeat(ctx.seat, op) !== ctx.seat) {',
    replace:
      '      if (ctx.invokedBy === "attack" && op.from !== "yourActive" && op.from !== "yours") {',
    expectKilledBy: ["packages/engine/src/flashingDraw.test.ts"],
    survives: {
      kind: "equivalent",
      reason:
        '⚠️ NO BOARD DISTINGUISHES THE TWO READINGS. `attackEffectRefused` short-circuits unless `ctx.invokedBy === "attack"`, and no printed card puts a `from: "self"` discard inside an attack — an attack\'s "this Pokémon" is already the Active by §8, which is exactly what `yourActive` exists for. Belt and braces: the arm\'s own comment notes a seat\'s §11 block can never be live during its own turn, so even an attack-borne `self` discard would come back false. The repair is against a CLOSED-WORLD ASSUMPTION (a negated conjunction over union members), not against a live defect. If this is ever KILLED, an attack-surface `self` discard has been authored and the §11 story needs re-reading.',
    },
  },
  // ── D223 — Carmine's §4 exemption. SIX rows, and the shape of the corpus is the
  //    finding: THREE of them are read sites, because the whole cost of this slice
  //    was that a one-field flag has three gates and the census row named one.
  {
    id: "D223-gate-ignores-flag",
    decision: "D223",
    what: "the §4 Supporter ban goes back to the pre-D223 line — the card's printed exemption is authored, mapped to all four printings, and simply not read, which is the state D190 refused to ship",
    file: "packages/engine/src/cardplay.ts",
    find: "    if (state.turn === 1 && entry?.trainerFirstTurnExempt !== true) {",
    replace: "    if (state.turn === 1) {",
    expectKilledBy: ["packages/engine/src/carmine.test.ts"],
  },
  {
    id: "D223-exempts-supporter-allowance",
    decision: "D223",
    what: "the exemption spreads to the NEXT `err` down — §7.2's once-per-turn allowance, four lines away in the same branch — so a turn-1 Carmine no longer spends the Supporter. The printed sentence licenses timing, not a second Supporter",
    file: "packages/engine/src/cardplay.ts",
    find: "    if (state.allowances.supporterPlayed) {",
    replace:
      "    if (state.allowances.supporterPlayed && entry?.trainerFirstTurnExempt !== true) {",
    expectKilledBy: ["packages/engine/src/carmine.test.ts"],
  },
  {
    id: "D223-online-hud-ignores-flag",
    decision: "D223",
    what: "the ONLINE row-lighting mirror keeps the pre-D223 §4 term, so the wire greys a row playTrainer accepts — afford-then-reject inverted, and the direction nobody reports because a dead-looking row is never clicked",
    file: "packages/engine/src/redact.ts",
    // ⚠️ RE-ANCHORED AT D288 — the arm this row quotes stopped being an `&&` and
    // became the FIRST BRANCH OF A TERNARY when the Stadium row arrived beside it
    // (`isSupporter ? … : isStadium && …`). The row's SUBJECT is unchanged (the
    // §4 exemption term) and its `replace` still drops exactly the
    // `trainerFirstTurnExempt` conjunct — only the surrounding punctuation moved.
    // It now quotes the SAME SHAPE as its `D223-local-hud-ignores-flag` twin,
    // which has been a ternary since D223, so the two rows are re-converged
    // rather than newly divergent.
    find:
      "          ? (state.turn === 1 && program.trainerFirstTurnExempt !== true) ||\n" +
      "            state.allowances.supporterPlayed",
    replace: "          ? state.turn === 1 || state.allowances.supporterPlayed",
    expectKilledBy: ["packages/engine/src/carmine.test.ts"],
  },
  {
    id: "D223-local-hud-ignores-flag",
    decision: "D223",
    what: "the LOCAL HUD's twin of the same mirror keeps the pre-D223 §4 term — the second of the two read sites the census row did not name, and the one that needs jsdom to see",
    file: "src/features/game/GameHud.tsx",
    find:
      "          ? (game.turn === 1 && program.trainerFirstTurnExempt !== true) ||\n" +
      "            game.allowances.supporterPlayed",
    replace: "          ? game.turn === 1 || game.allowances.supporterPlayed",
    expectKilledBy: ["src/features/game/GameHud.cardplay.dom.test.tsx"],
  },
  {
    id: "D223-professors-draw-count",
    decision: "D223",
    what: "Carmine draws 7 — PROFESSORS_RESEARCH's REAL number copied verbatim off the near-twin sentence one screen up, which is exactly the mistake sharing the object would have made silently",
    file: "packages/engine/src/registry.ts",
    find: '  trainer: [{ op: "discardHand" }, { op: "drawCards", count: 5 }],\n  trainerFirstTurnExempt: true,',
    replace:
      '  trainer: [{ op: "discardHand" }, { op: "drawCards", count: 7 }],\n  trainerFirstTurnExempt: true,',
    expectKilledBy: ["packages/engine/src/carmine.test.ts"],
  },
  {
    id: "D223-flag-leaks-to-professors",
    decision: "D223",
    what: "the exemption lands on Professor's Research as well — the consequence of treating the two near-twins as one program, which hands four ids a §4 licence they never printed",
    file: "packages/engine/src/registry.ts",
    find:
      "const PROFESSORS_RESEARCH: CardProgram = {\n" +
      '  trainer: [{ op: "discardHand" }, { op: "drawCards", count: 7 }],\n' +
      "};",
    replace:
      "const PROFESSORS_RESEARCH: CardProgram = {\n" +
      '  trainer: [{ op: "discardHand" }, { op: "drawCards", count: 7 }],\n' +
      "  trainerFirstTurnExempt: true,\n" +
      "};",
    expectKilledBy: ["packages/engine/src/carmine.test.ts"],
  },

  // ── D224 — Team Rocket's Proton. SEVEN rows over ONE registry object, because
  //    that object IS the whole slice: no engine file moved, so every mistake
  //    this row could carry is a wrong FIELD, and every one of them is a real
  //    value copied off a neighbouring program (Hop's Bag's owner / cap /
  //    destination, Carmine's whole object). The last one is the id map itself.
  {
    id: "D224-drops-stage-narrowing",
    decision: "D224",
    what: "the printed word BASIC falls out of the filter, so Proton offers Team Rocket's Arbok as well — the silent widening a search for 'Basic X's Pokémon' invites, and the exact shape `stage` was added for",
    file: "packages/engine/src/registry.ts",
    find: '      filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },\n      dest: "hand",\n      max: 3,',
    replace:
      '      filter: { kind: "ownerPokemon", owner: "Team Rocket" },\n      dest: "hand",\n      max: 3,',
    expectKilledBy: ["packages/engine/src/proton.test.ts"],
  },
  {
    id: "D224-wrong-owner",
    decision: "D224",
    what: "the owner string is Hop's — the REAL value of the neighbouring search row, and the failure mode D200 designed the bare `string` around: a wrong owner matches the empty set, so the card becomes a loud no-op rather than a wrong grab",
    file: "packages/engine/src/registry.ts",
    find: '      filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },',
    replace: '      filter: { kind: "ownerPokemon", owner: "Hop", stage: "basic" },',
    expectKilledBy: ["packages/engine/src/proton.test.ts"],
  },
  {
    id: "D224-hops-bag-cap",
    decision: "D224",
    what: "the cap is Hop's Bag's real 2 instead of the printed 3 — the near-twin row's own number, which is what sharing the object would have done silently",
    file: "packages/engine/src/registry.ts",
    find: '      filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },\n      dest: "hand",\n      max: 3,',
    replace:
      '      filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },\n      dest: "hand",\n      max: 2,',
    expectKilledBy: ["packages/engine/src/proton.test.ts"],
  },
  {
    id: "D224-searches-to-bench",
    decision: "D224",
    what: "the destination is Hop's Bag's real `bench` — a different card entirely (and one whose cap the interpreter then clamps to bench space), from a sentence that prints 'put them into your hand'",
    file: "packages/engine/src/registry.ts",
    find: '      filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },\n      dest: "hand",',
    replace:
      '      filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },\n      dest: "bench",',
    expectKilledBy: ["packages/engine/src/proton.test.ts"],
  },
  {
    id: "D224-drops-first-turn-flag",
    decision: "D224",
    what: "the second sentence is authored and the first is not — D190's own worked example of a program strictly WORSE than unbuilt, since the card is then refused on the one turn it is printed to be legal on",
    file: "packages/engine/src/registry.ts",
    // ⚠️ RE-TRANSCRIBED AT D242, AND THE PRE-CHECK IS WHY IT WAS CAUGHT BEFORE THE
    // COMMIT RATHER THAN AFTER IT (D241's rule, now scripted —
    // `bun scripts/mutation/precheck.ts`). The row anchored on the `/** card id →
    // program.` comment that happened to FOLLOW this program; D242 inserted two new
    // program constants there and the anchor went to zero occurrences. **A `find`
    // that reaches past its own subject is a dependency on whatever is next in the
    // file** — so it now stops at the closing brace, which is `TEAM_ROCKETS_PROTON`'s
    // own text and moves only when that program does.
    find: '    { op: "shuffleDeck" },\n  ],\n  trainerFirstTurnExempt: true,\n};',
    replace: '    { op: "shuffleDeck" },\n  ],\n};',
    expectKilledBy: ["packages/engine/src/proton.test.ts"],
  },
  {
    id: "D224-drops-trailing-shuffle",
    decision: "D224",
    what: "the printed 'Then, shuffle your deck.' falls off the program — invisible on the taken path if only the hand is asserted, which is why the whiff and the decline assert the SHUFFLE too",
    file: "packages/engine/src/registry.ts",
    // ⚠️ RE-TRANSCRIBED AT D228, AND THE ROW HAD BEEN ROTTEN AT HEAD SINCE D225.
    // That slice added `reveal: true` INSIDE this object, between `max: 3` and its
    // brace, so the `find` stopped occurring and the harness reported ERROR — the
    // exactly-once rule doing precisely what its doc says ("a line number rots
    // silently, a unique string rots loudly"). D228 found it by running the FULL
    // corpus rather than only `--decision`, which is the only way a neighbouring
    // slice's rot ever surfaces.
    find: '      dest: "hand",\n      max: 3,\n      reveal: true,\n    },\n    { op: "shuffleDeck" },\n  ],\n  trainerFirstTurnExempt: true,',
    replace:
      '      dest: "hand",\n      max: 3,\n      reveal: true,\n    },\n  ],\n  trainerFirstTurnExempt: true,',
    expectKilledBy: ["packages/engine/src/proton.test.ts"],
  },
  {
    id: "D224-reprint-maps-to-carmine",
    decision: "D224",
    what: "the sv10-227 reprint is wired to CARMINE — the neighbouring object in the same block, which shares this card's FIRST sentence exactly and none of its second, so the reprint would discard the player's hand instead of searching",
    file: "packages/engine/src/registry.ts",
    find: '  "sv10-227": TEAM_ROCKETS_PROTON,',
    replace: '  "sv10-227": CARMINE,',
    expectKilledBy: ["packages/engine/src/proton.test.ts"],
  },
  // ── D225 — the printed reveal as a rider on the two pile-to-hand search ops ──
  // Six mistakes an author would really make here: naming the cards on the
  // DESTINATION (the cheap fix the census killed), reading the flag on the wrong
  // branch, spreading a possibly-undefined key instead of two whole objects, and
  // losing the rider off a registry row on each of the two ops.
  {
    id: "D225-names-on-destination",
    decision: "D225",
    what: "the DECK_SEARCHED arm names the cards whenever dest is the hand, ignoring the printed clause — the exact 'cheap fix' D224 measured and refused, which leaks Cassiopeia's unfiltered search",
    file: "packages/engine/src/log.ts",
    find: '      if (event.reveal !== true) {\n        return row(event.seat, [\n          plain(`searched their deck — put ${n} card${n === 1 ? "" : "s"} in hand`),\n        ]);\n      }',
    replace:
      '      if (false) {\n        return row(event.seat, [\n          plain(`searched their deck — put ${n} card${n === 1 ? "" : "s"} in hand`),\n        ]);\n      }',
    expectKilledBy: ["packages/engine/src/revealClause.test.ts"],
  },
  {
    id: "D225-search-arm-inverted",
    decision: "D225",
    what: "the DECK_SEARCHED reveal test is inverted — the polarity mistake D137 found twice in the ATTACK_REQUIREMENT_CLAUSES table, and the one that reads as a whole fix until a no-reveal card is driven",
    file: "packages/engine/src/log.ts",
    find: "      if (event.reveal !== true) {\n        return row(event.seat, [\n          plain(`searched their deck",
    replace:
      "      if (event.reveal === true) {\n        return row(event.seat, [\n          plain(`searched their deck",
    expectKilledBy: ["packages/engine/src/revealClause.test.ts"],
  },
  {
    id: "D225-top-arm-hardcodes-reveal",
    decision: "D225",
    what: "DECK_TOP_REVEALED names its cards unconditionally — the reading its own event NAME invites, and the one that ships a leak the day Hassel or Explorer's Guidance is authored",
    file: "packages/engine/src/log.ts",
    find: "      if (event.reveal !== true) {\n        return row(event.seat, [\n          plain(`looked at the top of their deck",
    replace:
      "      if (false) {\n        return row(event.seat, [\n          plain(`looked at the top of their deck",
    expectKilledBy: ["packages/engine/src/revealClause.test.ts"],
  },
  {
    id: "D225-spreads-undefined-key",
    decision: "D225",
    what: "the push site spells `reveal: reveal` on one object instead of building two — passes every `?.reveal` assertion and puts an explicit `reveal: undefined` key on the wire, which D135's absent-not-false rule exists to prevent",
    file: "packages/engine/src/interpreter.ts",
    find: '  events.push(\n    reveal === true\n      ? { type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved], reveal: true }\n      : { type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved] },\n  );',
    replace:
      '  events.push({ type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved], reveal });',
    expectKilledBy: ["packages/engine/src/revealClause.test.ts"],
  },
  {
    id: "D225-proton-loses-reveal",
    decision: "D225",
    what: "Team Rocket's Proton drops the rider — the row D224 shipped without it, i.e. the exact pre-slice state, which is what a merge conflict resolved the wrong way produces",
    file: "packages/engine/src/registry.ts",
    find: '      filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },\n      dest: "hand",\n      max: 3,\n      reveal: true,',
    replace:
      '      filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },\n      dest: "hand",\n      max: 3,',
    expectKilledBy: [
      "packages/engine/src/proton.test.ts",
      "packages/engine/src/revealClause.test.ts",
    ],
  },
  {
    id: "D225-great-ball-loses-reveal",
    decision: "D225",
    what: "Great Ball's lookAtTopN drops the rider — the op whose event name made it look like the flag was redundant there",
    file: "packages/engine/src/registry.ts",
    find: '    { op: "lookAtTopN", n: 7, filter: { kind: "anyPokemon" }, max: 1, reveal: true },',
    replace: '    { op: "lookAtTopN", n: 7, filter: { kind: "anyPokemon" }, max: 1 },',
    expectKilledBy: ["packages/engine/src/revealClause.test.ts"],
  },
  // ── D226 — N's Plan: the single-source coupling relaxed, and its FIVE read
  //    sites. Nine mistakes an author would really make: relaxing the coupling by
  //    DELETING it (the cheap edit, which takes the self-move rule with it),
  //    losing the rider at each of the five places that read it, hard-coding the
  //    article back into the note, and collapsing the per-source events into one.
  {
    id: "D226-validator-deletes-coupling",
    decision: "D226",
    what: "the coupling is DELETED rather than made conditional — the cheapest way to make N's Plan work, and the one that silently legalises a two-source Poppy answer the print forbids",
    file: "packages/engine/src/cardplay.ts",
    find: "        if (prompt.anySource !== true) {\n          if (source === undefined) source = from;",
    replace: "        if (false) {\n          if (source === undefined) source = from;",
    expectKilledBy: ["packages/engine/src/nsPlan.test.ts"],
  },
  {
    id: "D226-validator-drops-self-move",
    decision: "D226",
    what: "the self-move rule goes out with the coupling it used to ride on — the collateral of the mutant above, and the one that lets a Pokémon move its own Energy onto itself",
    file: "packages/engine/src/cardplay.ts",
    find: "        if (refEquals(from, choice.dest)) selfMove = true;\n",
    replace: "",
    expectKilledBy: [
      "packages/engine/src/nsPlan.test.ts",
      "packages/engine/src/moveEnergy.test.ts",
    ],
  },
  {
    id: "D226-prompt-drops-rider",
    decision: "D226",
    what: "the park does not carry the rider onto the prompt — the op knows, and nothing downstream does, which is D222/D223's failure mode in its purest form",
    file: "packages/engine/src/interpreter.ts",
    find: "          ...(op.anySource === undefined ? {} : { anySource: op.anySource }),",
    replace: "",
    expectKilledBy: ["packages/engine/src/nsPlan.test.ts"],
  },
  {
    id: "D226-redact-drops-rider",
    decision: "D226",
    what: "the rider does not cross the wire — the online dialog re-stages by source and the online validator refuses the answer, while the local game is fine",
    file: "packages/engine/src/redact.ts",
    find: "        ...(prompt.anySource === undefined ? {} : { anySource: prompt.anySource }),",
    replace: "",
    expectKilledBy: ["packages/engine/src/nsPlan.test.ts"],
  },
  {
    id: "D226-projection-drops-rider",
    decision: "D226",
    what: "the wire-to-engine rebuild drops the rider — the THIRD client read site, which D190's row did not name, and whose own doc promises the round-trip is exact",
    file: "src/features/game/projection.ts",
    find: "          ...(prompt.anySource === undefined ? {} : { anySource: prompt.anySource }),",
    replace: "",
    expectKilledBy: ["src/features/game/projection.test.ts"],
  },
  {
    id: "D226-note-hardcodes-article",
    decision: "D226",
    what: "the prompt note hard-codes '1 of' back — the pre-slice line verbatim, which makes the heading claim a coupling the card does not print",
    file: "packages/engine/src/interpreter.ts",
    find: '  const one = op.anySource === true ? "" : "1 of ";',
    replace: '  const one = "1 of ";',
    expectKilledBy: ["packages/engine/src/nsPlan.test.ts"],
  },
  {
    id: "D226-one-event-for-every-source",
    decision: "D226",
    what: "every per-source ENERGY_MOVED carries the WHOLE move — the pre-slice line (`uids: [...moved]`) copied into the new loop, so each row claims both cards came off its own body and the log prints a false sentence",
    file: "packages/engine/src/interpreter.ts",
    find: "      uids: [...group.uids],",
    replace: "      uids: [...moved],",
    expectKilledBy: ["packages/engine/src/nsPlan.test.ts"],
  },
  {
    id: "D226-local-hud-keeps-source-stage",
    decision: "D226",
    what: "the LOCAL dialog ignores the rider and keeps staging by source — the card is legal, the engine accepts the wide answer, and no player can build one",
    file: "src/features/game/GameHud.tsx",
    find: "  const anySource = prompt.anySource === true;",
    replace: "  const anySource = false;",
    expectKilledBy: ["src/features/game/GameHud.cardplay.dom.test.tsx"],
  },
  {
    id: "D226-online-hud-keeps-source-stage",
    decision: "D226",
    what: "the ONLINE dialog ignores the rider and keeps staging by source — the same defect on the other HUD, which is why the price was two read sites and not one",
    file: "src/features/online/components/OnlineHud.tsx",
    find: "  const anySource = prompt.anySource === true;",
    replace: "  const anySource = false;",
    expectKilledBy: ["src/features/online/components/OnlineHud.dom.test.tsx"],
  },

  // ── D227 · the opponent-chosen switch-out ──────────────────────────────────
  // Every row here is the NEIGHBOURING ARM'S REAL CODE, because that is the
  // mistake an author actually makes on this op: `gust` and `opponentSwitchOut`
  // are one `decider` apart at the interpreter and one whole-string anchor apart
  // at the deriver, so a copy-paste build is right about the board and wrong
  // about the player. The two `preventBlock` verdicts are both `untouched`, so
  // that table CANNOT kill any of the seat rows — which is why it says so on its
  // own line and why these name `derivedOpponentSwitchOut.test.ts`.
  {
    id: "D227-park-carries-no-decider",
    decision: "D227",
    what: "the park files no decider — `gust`'s call verbatim, so the board is right and the CONTROLLER is asked to choose the opponent's promotion",
    file: "packages/engine/src/interpreter.ts",
    find: '        "Choose your new Active Pokémon.",\n        otherSeat(ctx.seat),\n      );',
    replace: '        "Choose your new Active Pokémon.",\n      );',
    expectKilledBy: ["packages/engine/src/derivedOpponentSwitchOut.test.ts"],
  },
  {
    id: "D227-decider-is-the-controller",
    decision: "D227",
    what: "the decider is the controller rather than the opponent — the off-by-one-seat build, which still parks and still names an answerer, so only WHICH seat can see it",
    file: "packages/engine/src/interpreter.ts",
    find: '        "Choose your new Active Pokémon.",\n        otherSeat(ctx.seat),',
    replace: '        "Choose your new Active Pokémon.",\n        ctx.seat,',
    expectKilledBy: ["packages/engine/src/derivedOpponentSwitchOut.test.ts"],
  },
  {
    id: "D227-parkorforce-swallows-the-decider",
    decision: "D227",
    what: "`parkOrForce` takes the decider and never puts it on the park — the op knows and nothing downstream does, D222/D223's failure mode at the helper instead of at the field",
    file: "packages/engine/src/interpreter.ts",
    find: "    ...(decider === undefined ? {} : { decider }),",
    replace: "",
    expectKilledBy: ["packages/engine/src/derivedOpponentSwitchOut.test.ts"],
  },
  {
    id: "D227-applies-to-the-attackers-side",
    decision: "D227",
    what: "the forced apply calls `switchOwn` — `switchActive`'s real helper one case up, which moves the ATTACKER's Active off a candidate set built from the opponent's Bench",
    file: "packages/engine/src/interpreter.ts",
    // ⚠️ RE-TRANSCRIBED AT D228, which wrapped this call in `switchRecording` (the
    // op grew the `recordAs` its doc deferred). The mutant is UNCHANGED in intent
    // — the forced apply moves the ATTACKER's Active instead of the opponent's —
    // and only the bytes it is spelled against moved.
    find: '        (ref) => switchRecording(op, (into) => gust(state, ref, ctx, into), events, record),\n        "Choose your new Active Pokémon.",',
    replace:
      '        (ref) => switchRecording(op, (into) => switchOwn(state, ref, ctx, into), events, record),\n        "Choose your new Active Pokémon.",',
    expectKilledBy: ["packages/engine/src/derivedOpponentSwitchOut.test.ts"],
  },
  {
    id: "D227-bare-anchor-drops-the-tail",
    decision: "D227",
    what: "the bare anchor loses its `$` — the one mutant that BUILDS the printing this slice deliberately leaves unread (Grimmsnarl `sv07-096`), silently dropping 160 damage",
    file: "packages/engine/src/effects.ts",
    find: "  /^Switch out your opponent['’]s Active Pokémon to the Bench\\. \\(Your opponent chooses the new Active Pokémon\\.\\)$/;",
    replace:
      "  /^Switch out your opponent['’]s Active Pokémon to the Bench\\. \\(Your opponent chooses the new Active Pokémon\\.\\)/;",
    expectKilledBy: ["packages/engine/src/derivedOpponentSwitchOut.test.ts"],
  },
  {
    id: "D227-bare-anchor-drops-the-apostrophe-class",
    decision: "D227",
    what: "the bare anchor commits to the straight apostrophe — EXACTLY the defect the first draft shipped, caught by the fold suite rather than by the slice's own file",
    file: "packages/engine/src/effects.ts",
    // ⚠️ RE-ANCHORED AT D228: the old `find` was the regex's opening bytes, which
    // stopped being unique the moment this slice added an anchor for the SAME
    // sentence with a tail. The harness reported ERROR (`find` occurs 2×) rather
    // than mutating the wrong row — the phantom-survivor failure caught
    // mechanically, which is what the exactly-once rule is for. The row now names
    // its own constant.
    find: "const ATTACK_OPPONENT_SWITCH_OUT =\n  /^Switch out your opponent['’]s Active Pokémon to the Bench\\. \\(Your opponent chooses",
    replace:
      "const ATTACK_OPPONENT_SWITCH_OUT =\n  /^Switch out your opponent's Active Pokémon to the Bench\\. \\(Your opponent chooses",
    expectKilledBy: [
      "packages/engine/src/clauseApostrophe.test.ts",
      "packages/engine/src/derivedOpponentSwitchOut.test.ts",
    ],
  },
  {
    id: "D227-compound-files-nothing",
    decision: "D227",
    what: "the compound's antecedent drops `recordAs` — D189's bare self-switch op copied in, so the §9.2 gate reads an empty slot and Iron Bundle's consequent NEVER runs on any board",
    file: "packages/engine/src/effects.ts",
    find: '      { op: "switchActive", recordAs: "moved" },\n      // biome-ignore lint/suspicious/noThenProperty',
    replace: '      { op: "switchActive" },\n      // biome-ignore lint/suspicious/noThenProperty',
    expectKilledBy: ["packages/engine/src/derivedOpponentSwitchOut.test.ts"],
  },
  {
    id: "D227-consequence-clause-is-the-gusts",
    decision: "D227",
    what: "`describeBranch` announces the gust's words — the neighbouring arm's real string, which tells the attacker they will pick the opponent's promotion when in fact the opponent will",
    file: "packages/engine/src/interpreter.ts",
    find: '        parts.push("switch out your opponent\'s Active Pokémon to the Bench");',
    replace:
      '        parts.push("switch in 1 of your opponent\'s Benched Pokémon to the Active Spot");',
    expectKilledBy: ["packages/engine/src/derivedOpponentSwitchOut.test.ts"],
  },

  // ── D228 · the damage rider on a promoted body ─────────────────────────────
  // The neighbouring-arm rule again, and here the neighbour is unusually close:
  // this slice's op is `damageDefender`'s body with the count taken off the
  // printed sentence, and its two anchors are D181's gust and D227's switch-out
  // with a tail. So every row below is a real line from one of those three,
  // copied verbatim into this one.
  {
    id: "D228-damage-goes-to-the-captured-defender",
    decision: "D228",
    what: "the hit is dealt BEFORE the promotion instead of after — the op reordered ahead of its own gust, which is the whole 'new Active' claim inverted while every number stays right",
    file: "packages/engine/src/effects.ts",
    find: '    return [{ op: "gust" }, { op: "damageNewActive", amount: Number(match[1]) }];',
    replace: '    return [{ op: "damageNewActive", amount: Number(match[1]) }, { op: "gust" }];',
    expectKilledBy: ["packages/engine/src/derivedNewActiveDamage.test.ts"],
  },
  {
    id: "D228-places-counters-instead-of-dealing",
    decision: "D228",
    what: "`damageActive`'s real placement copied in — flat counters instead of §8.5 damage, which is right on a plain body and silently halves every Weakness board (the exact misreading D227's backlog note warned about)",
    file: "packages/engine/src/interpreter.ts",
    find: "      return { done: snipeActive(state, op.amount, false, ctx, events) };",
    replace: '      return { done: damageActive(state, op.amount, "attack", ctx, events) };',
    expectKilledBy: ["packages/engine/src/derivedNewActiveDamage.test.ts"],
  },
  {
    id: "D228-ungated-arm-gains-a-gate",
    decision: "D228",
    what: "the gust arm is wrapped in the GATED arm's `recordGate` — the two printed shapes read as one, which is right on every board with a Bench and drops 30 damage on every empty one",
    file: "packages/engine/src/effects.ts",
    find: '  match = ATTACK_GUST_THEN_DAMAGE_NEW_ACTIVE.exec(effect);\n  if (match !== null) {\n    return [{ op: "gust" }, { op: "damageNewActive", amount: Number(match[1]) }];',
    replace:
      '  match = ATTACK_GUST_THEN_DAMAGE_NEW_ACTIVE.exec(effect);\n  if (match !== null) {\n    return [{ op: "gust", recordAs: "moved" }, { op: "recordGate", slot: "moved", then: [{ op: "damageNewActive", amount: Number(match[1]) }] }];',
    expectKilledBy: ["packages/engine/src/derivedNewActiveDamage.test.ts"],
  },
  {
    id: "D228-gated-arm-loses-its-gate",
    decision: "D228",
    what: "the gated arm drops the `recordGate` and runs the ops in sequence — the ungated arm's real shape, right on every board with a Bench and dealing 160 to a body the card never promoted on an empty one",
    file: "packages/engine/src/effects.ts",
    find: '      { op: "opponentSwitchOut", recordAs: "moved" },\n      {\n        op: "recordGate",\n        slot: "moved",\n        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract\'s gated-step list, not a thenable (arrays are not callable).\n        then: [{ op: "damageNewActive", amount: Number(match[1]) }],\n      },',
    replace:
      '      { op: "opponentSwitchOut" },\n      { op: "damageNewActive", amount: Number(match[1]) },',
    expectKilledBy: ["packages/engine/src/derivedNewActiveDamage.test.ts"],
  },
  {
    id: "D228-resumed-arm-files-nothing",
    decision: "D228",
    what: "the RESUMED switch-out drops its recording — D227's own line, restored — so the §9.2 slot is empty on exactly the boards where the opponent was asked, and the 160 vanishes on every parked board while the forced one stays green",
    file: "packages/engine/src/interpreter.ts",
    // ⚠️ ANCHORED ON THE PRECEDING LINE, NOT ON THE RETURN. D228 made the two
    // resumed arms BYTE-IDENTICAL (`gust`'s and this one), so the return alone
    // occurs twice and the harness reports ERROR — the wrong-row failure the
    // exactly-once rule exists to catch, arriving here as a direct consequence of
    // the slice's own "the three switch ops now file identically" claim.
    find: '      // gate reading an empty slot. Driven on a two-body Bench.\n      return choice.kind === "pokemon"\n        ? switchRecording(op, (into) => gust(state, choice.ref, ctx, into), events, record)\n        : state;',
    replace:
      '      // gate reading an empty slot. Driven on a two-body Bench.\n      return choice.kind === "pokemon" ? gust(state, choice.ref, ctx, events) : state;',
    expectKilledBy: ["packages/engine/src/derivedNewActiveDamage.test.ts"],
  },
  {
    id: "D228-forced-arm-files-nothing",
    decision: "D228",
    what: "the FORCED switch-out drops its recording — the mirror of the row above, killed by the one-candidate board rather than the parked one, which is why both arms are driven separately",
    file: "packages/engine/src/interpreter.ts",
    find: '        (ref) => switchRecording(op, (into) => gust(state, ref, ctx, into), events, record),\n        "Choose your new Active Pokémon.",',
    replace:
      '        (ref) => gust(state, ref, ctx, events),\n        "Choose your new Active Pokémon.",',
    expectKilledBy: ["packages/engine/src/derivedNewActiveDamage.test.ts"],
  },
  {
    id: "D228-gust-anchor-drops-the-tail",
    decision: "D228",
    what: "the gust rider's anchor loses its `$` — D227's own bare-anchor mutant one sentence over, which would make this arm swallow Malamar `sv06.5-034`'s three-sentence compound and silently drop its printed requirement",
    file: "packages/engine/src/effects.ts",
    find: "  /^Switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\\. This attack does (\\d+) damage to the new Active Pokémon\\.$/;",
    replace:
      "  /^Switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\\. This attack does (\\d+) damage to the new Active Pokémon\\./;",
    expectKilledBy: ["packages/engine/src/derivedNewActiveDamage.test.ts"],
  },
  {
    id: "D228-gated-anchor-drops-the-apostrophe-class",
    decision: "D228",
    what: "the gated anchor commits to the straight apostrophe — the defect D227's first draft shipped, on the sentence D227 could not have swept because nothing derived it",
    file: "packages/engine/src/effects.ts",
    find: "  /^Switch out your opponent['’]s Active Pokémon to the Bench\\. \\(Your opponent chooses the new Active Pokémon\\.\\) If you do, this attack does (\\d+) damage to the new Active Pokémon\\.$/;",
    replace:
      "  /^Switch out your opponent's Active Pokémon to the Bench\\. \\(Your opponent chooses the new Active Pokémon\\.\\) If you do, this attack does (\\d+) damage to the new Active Pokémon\\.$/;",
    expectKilledBy: [
      "packages/engine/src/clauseApostrophe.test.ts",
      "packages/engine/src/derivedNewActiveDamage.test.ts",
    ],
  },
  {
    id: "D228-base-damage-is-suppressed",
    decision: "D228",
    what: "the new op joins `programDamage`'s base-suppression list — `damageDefender`'s real rule applied one op over, which drops an attack's printed base whenever it also hits the promoted body",
    file: "packages/engine/src/attack.ts",
    find: '  const programDamage = program?.some((step) => step.op === "damageDefender") ?? false;',
    replace:
      '  const programDamage =\n    program?.some((step) => step.op === "damageDefender" || step.op === "damageNewActive") ?? false;',
    survives: {
      kind: "unreachable-population",
      reason:
        "All 8 legal printings of this sentence print NO `damage` field, so `base` is 0 on every board the catalog can build and both readings agree. The branch is written from the rule (an ADDITIONAL number on a body the main hit never touched must not claim the printed base), and D130's `programPerHeads` note is the standing precedent for recording such a row rather than inventing a fixture that no printing justifies.",
    },
    expectKilledBy: ["packages/engine/src/derivedNewActiveDamage.test.ts"],
  },
  // ── D229 — the attacker's own Energy onto its own Bench (`selfToBench`) ──
  // Nine mistakes an author would really make on a route that is the MIRROR of an
  // existing one. Six of them are a neighbouring route's REAL code copied verbatim
  // (the free route's scope, its destination set, its `needed`, its note phrase;
  // the sibling arm's filter; the mirror route's own name), which is the class
  // conventions.md asks for — a straw mutant proves nothing about a real defect.
  {
    id: "D229-source-scope-is-the-whole-board",
    decision: "D229",
    what: 'the route takes Energy off the WHOLE board — the FREE route\'s real scope, one ternary away — so an attack printed "from this Pokémon" moves Energy between two BENCHED bodies',
    file: "packages/engine/src/interpreter.ts",
    find: '      movable: attachedEnergies(state, seat, op.filter, "active"),\n      destinations: state.players[seat].bench.map((_, index) => ({',
    replace:
      '      movable: attachedEnergies(state, seat, op.filter, "all"),\n      destinations: state.players[seat].bench.map((_, index) => ({',
    expectKilledBy: ["packages/engine/src/derivedSelfEnergyMove.test.ts"],
  },
  {
    id: "D229-destinations-include-the-active",
    decision: "D229",
    what: "the destinations are `ownInPlayRefs` — the FREE route's real code, verbatim — which offers the ATTACKER as a destination for its own Energy and makes the wire's self-move rule the only thing standing between a player and a no-op answer",
    file: "packages/engine/src/interpreter.ts",
    find: '      destinations: state.players[seat].bench.map((_, index) => ({\n        seat,\n        spot: { spot: "bench", index },\n      })),\n      needed: 1,',
    replace: "      destinations: ownInPlayRefs(state, seat),\n      needed: 1,",
    expectKilledBy: ["packages/engine/src/derivedSelfEnergyMove.test.ts"],
  },
  {
    id: "D229-destinations-are-the-other-seat",
    decision: "D229",
    what: "the Bench read is the OPPONENT's — this engine's most-repeated defect (gust and the self-switch are one `otherSeat` apart, and D227's whole op is that difference), which would move your Energy onto their Pokémon",
    file: "packages/engine/src/interpreter.ts",
    find: "      destinations: state.players[seat].bench.map((_, index) => ({\n        seat,",
    replace:
      "      destinations: state.players[otherSeat(seat)].bench.map((_, index) => ({\n        seat,",
    expectKilledBy: ["packages/engine/src/derivedSelfEnergyMove.test.ts"],
  },
  {
    id: "D229-needed-is-two",
    decision: "D229",
    what: "`needed` is 2 — the FREE route's real value, whose reason (the source is also a candidate destination) does not hold here — so a lone benched body silently whiffs and every two-body board stays green",
    file: "packages/engine/src/interpreter.ts",
    find: '        spot: { spot: "bench", index },\n      })),\n      needed: 1,\n    };\n  }\n  if (toToolHolder) {',
    replace:
      '        spot: { spot: "bench", index },\n      })),\n      needed: 2,\n    };\n  }\n  if (toToolHolder) {',
    expectKilledBy: ["packages/engine/src/derivedSelfEnergyMove.test.ts"],
  },
  {
    id: "D229-arm-emits-the-mirror-route",
    decision: "D229",
    what: "the deriver emits `benchToActive` — the crossed build this slice exists to guard against, which moves Energy the RIGHT distance in the WRONG direction and passes every generic `moveEnergy` assertion in the repo",
    file: "packages/engine/src/effects.ts",
    find: '        max: match[1] === undefined ? 1 : Number(match[1]),\n        route: "selfToBench",',
    replace:
      '        max: match[1] === undefined ? 1 : Number(match[1]),\n        route: "benchToActive",',
    expectKilledBy: ["packages/engine/src/derivedSelfEnergyMove.test.ts"],
  },
  {
    id: "D229-basic-arm-loses-its-filter",
    decision: "D229",
    what: 'the Basic-filtered arm carries `anyEnergy` — the neighbouring arm\'s REAL code, three lines up — so Tornadus "Hurricane" moves a Special Energy the card never named',
    file: "packages/engine/src/effects.ts",
    find: '    return [{ op: "moveEnergy", filter: { kind: "basicEnergy" }, max: 1, route: "selfToBench" }];',
    replace:
      '    return [{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "selfToBench" }];',
    expectKilledBy: ["packages/engine/src/derivedSelfEnergyMove.test.ts"],
  },
  {
    id: "D229-anchor-drops-the-article-alternation",
    decision: "D229",
    what: 'the numeric anchor requires a digit, dropping the article branch — the 8-printing majority sentence ("Move an Energy") stops deriving at all, which is the mistake the two-anchor split the backlog row priced would have made permanent',
    file: "packages/engine/src/effects.ts",
    find: "  /^Move (?:(\\d+)|an) Energy from this Pokémon to 1 of your Benched Pokémon\\.$/;",
    replace: "  /^Move (\\d+) Energy from this Pokémon to 1 of your Benched Pokémon\\.$/;",
    expectKilledBy: ["packages/engine/src/derivedSelfEnergyMove.test.ts"],
  },
  {
    id: "D229-anchor-drops-the-tail",
    decision: "D229",
    what: "the numeric anchor loses its `$` — D227's and D228's mutant on a third family, and the one whose witness is CONSTRUCTED rather than printed (no member of this family carries a tail), which is exactly the gap D228 found the hard way",
    file: "packages/engine/src/effects.ts",
    find: "const ATTACK_MOVE_ENERGY_SELF_TO_BENCH =\n  /^Move (?:(\\d+)|an) Energy from this Pokémon to 1 of your Benched Pokémon\\.$/;",
    replace:
      "const ATTACK_MOVE_ENERGY_SELF_TO_BENCH =\n  /^Move (?:(\\d+)|an) Energy from this Pokémon to 1 of your Benched Pokémon\\./;",
    expectKilledBy: ["packages/engine/src/derivedSelfEnergyMove.test.ts"],
  },
  {
    id: "D229-note-names-the-free-route",
    decision: "D229",
    what: "the prompt sentence falls through to the FREE route's phrase — the branch's own fallback, one line down — so the dialog tells the player \"from 1 of your Pokémon to another of your Pokémon\" while the offer is fixed to the attacker",
    file: "packages/engine/src/interpreter.ts",
    find: '            "from this Pokémon to 1 of your Benched Pokémon"',
    replace: "            `from ${one}your Pokémon to another of your Pokémon`",
    expectKilledBy: ["packages/engine/src/derivedSelfEnergyMove.test.ts"],
  },

  // ── D230 — the deck search onto your own Bench (`searchDeck` + `shuffleDeck`) ──
  // Eight mistakes an author would really make on an arm whose whole risk is that
  // the NOUN is a capture. Five of them copy a neighbouring REAL value verbatim
  // (the other printed destination, the sibling filter member, the singular half's
  // capture, the wildcard noun a lazier anchor would have used), which is the class
  // conventions.md asks for.
  {
    id: "D230-noun-is-a-wildcard",
    decision: "D230",
    what: "the NAME capture is a lazy `[^.]+` — the shape a first draft writes — so the four printed sentences with a NARROWER noun (an owner subgroup, a disjunction, a type, an HP bound) all derive to this program and quietly search for something the card never named",
    file: "packages/engine/src/effects.ts",
    // RE-TRANSCRIBED AT D238, which added a THIRD alternative to this
    // constant. The mutant is unchanged in meaning (the NAME class becomes a
    // wildcard); the row is widened to the new bytes rather than the new code
    // narrowed to the old row.
    find: "const BENCH_SEARCH_NOUN = `(?:(Basic Pokémon)|(${BENCH_TYPED_NOUN})|([A-Z][a-zé]+))`;",
    replace: "const BENCH_SEARCH_NOUN = `(?:(Basic Pokémon)|(${BENCH_TYPED_NOUN})|([^.]+))`;",
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-dest-is-the-hand",
    decision: "D230",
    what: '`dest: "hand"` — the op\'s OTHER printed value, which 41 Standard-legal printings really do spell — so the found Pokémon goes to the hand and the Bench the sentence names never grows',
    file: "packages/engine/src/effects.ts",
    find: '{ op: "searchDeck", filter, dest: "bench", max }, { op: "shuffleDeck" }',
    replace:
      '          { op: "searchDeck", filter, dest: "hand", max },\n          { op: "shuffleDeck" },',
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-drops-the-trailing-shuffle",
    decision: "D230",
    what: 'the program is the search ALONE — the printed "Then, shuffle your deck." unread — so a player who just looked through their deck leaves it in an order they now know',
    file: "packages/engine/src/effects.ts",
    find: '        return [{ op: "searchDeck", filter, dest: "bench", max }, { op: "shuffleDeck" }];',
    replace: '        return [{ op: "searchDeck", filter, dest: "bench", max }];',
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-plural-name-capture-dropped",
    decision: "D230",
    what: 'the name is read off the SINGULAR half only (`match[2]`, dropping `?? match[5]`) — the off-by-one-group mistake a five-group regex invites — so every plural named printing ("up to 3 Charjabug", "up to 2 Grubbin", "up to 2 Froakie") searches for ANY Basic Pokémon instead',
    file: "packages/engine/src/effects.ts",
    // RE-TRANSCRIBED AT D238: the bench anchor gained a third alternative, so
    // the name groups moved 2/5 -> 3/7. The mistake is the same one.
    find: "    const name = match[3] ?? match[7];",
    replace: "    const name = match[3];",
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-named-filter-is-any-pokemon",
    decision: "D230",
    what: 'the named noun derives to `anyPokemon` — a real sibling member of the same union, and the "close enough" choice — so "up to 3 Charjabug" offers every Pokémon in the deck',
    file: "packages/engine/src/effects.ts",
    // RE-TRANSCRIBED AT D238: the dispatch is a three-way ternary now.
    find: '            ? { kind: "byName", name }\n            : { kind: "basicPokemon" };',
    replace: '            ? { kind: "anyPokemon" }\n            : { kind: "basicPokemon" };',
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-anchor-drops-the-tail",
    decision: "D230",
    what: "the anchor loses its `$` — D227's, D228's and D229's mutant on a fifth family, and the FIRST whose witness is a REAL PRINTING rather than a construction: Jynx `sv06-046` carries a §9.2 rider after this exact sentence, so a dropped `$` reads a card whose second clause the engine cannot run",
    file: "packages/engine/src/effects.ts",
    find: 'const BENCH_SEARCH_TAIL = " onto your Bench\\\\. Then, shuffle your deck\\\\.$";',
    replace: 'const BENCH_SEARCH_TAIL = " onto your Bench\\\\. Then, shuffle your deck\\\\.";',
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-anchor-drops-the-caret",
    decision: "D230",
    what: "the anchor loses its `^` — and this witness is REAL too: Volbeat `sv06-009` prints the §4 going-first licence in front of this sentence, so a dropped `^` would hand an attack a turn-1 exemption the engine does not implement",
    file: "packages/engine/src/effects.ts",
    find: "  `^Search your deck for (?:a ${BENCH_SEARCH_NOUN} and put it|up to (\\\\d+) ${BENCH_SEARCH_NOUN} and put them)${BENCH_SEARCH_TAIL}`,",
    replace:
      "  `Search your deck for (?:a ${BENCH_SEARCH_NOUN} and put it|up to (\\\\d+) ${BENCH_SEARCH_NOUN} and put them)${BENCH_SEARCH_TAIL}`,",
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-zero-count-guard-dropped",
    decision: "D230",
    what: 'the `max >= 1` guard goes — the guard every arm in this file carries — so a printed "up to 0" would derive to a search the interpreter turns into a silent no-op that still shuffles, an attack reporting an effect that moved nothing',
    file: "packages/engine/src/effects.ts",
    // RE-TRANSCRIBED AT D238: the line after the guard is now a comment.
    find: "    if (max >= 1) {\n      // Still dispatched on WHICH GROUP MATCHED",
    replace: "    if (max >= 0) {\n      // Still dispatched on WHICH GROUP MATCHED",
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },

  // ── D231 — the deck search into your own HAND (`searchDeck` at `dest: "hand"`,
  //    the `reveal` rider, and three new `CardFilter` members) ──
  // Eleven mistakes an author would really make. The two that matter most are the
  // REVEAL pair: `reveal` is the only field here whose wrong value is SILENT on a
  // board (the cards still reach the hand either way) and visible only in the log
  // the OPPONENT reads, which is exactly the shape D224 found four registry rows
  // had been wrong about for months.
  {
    id: "D231-reveal-is-the-destination",
    decision: "D231",
    what: 'the rider is set on EVERY to-hand search — the pre-D225 belief ("a search that ends in the hand is public by construction"), which four registry rows really held — so the seven legal no-reveal printings name their cards in the log and leak a hand the print keeps private',
    file: "packages/engine/src/effects.ts",
    find: '        { op: "searchDeck", filter, dest: "hand", max, ...(revealed ? { reveal: true } : {}) },',
    replace: '        { op: "searchDeck", filter, dest: "hand", max, reveal: true },',
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D231-reveal-never-set",
    decision: "D231",
    what: 'the rider is never set — the OTHER half of the same mistake, and the one a `dest`-only reader ships — so 21 legal printings that print "reveal it/them" report a bare COUNT to the opponent',
    file: "packages/engine/src/effects.ts",
    find: "    const revealed = (match[2] ?? match[5]) !== undefined;",
    replace: "    const revealed = false;",
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D231-reveal-read-off-the-singular-half-only",
    decision: "D231",
    what: 'the reveal group is read off the SINGULAR half alone (dropping `?? match[5]`) — D230\'s own off-by-one-group mistake on a five-group regex, one slice later — so every PLURAL revealing printing ("up to 2 Basic Energy cards, reveal them", 5 legal on one sentence) silently stops naming its cards',
    file: "packages/engine/src/effects.ts",
    find: "    const revealed = (match[2] ?? match[5]) !== undefined;",
    replace: "    const revealed = match[2] !== undefined;",
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D231-dest-is-the-bench",
    decision: "D231",
    what: "the op's OTHER printed value — D230's `dest: \"bench\"`, the neighbouring arm's real code twenty lines up — so every card searched into the hand lands on the Bench instead, and a Trainer or an Energy is offered a spot no rule gives it",
    file: "packages/engine/src/effects.ts",
    find: '        { op: "searchDeck", filter, dest: "hand", max, ...(revealed ? { reveal: true } : {}) },',
    replace:
      '        { op: "searchDeck", filter, dest: "bench", max, ...(revealed ? { reveal: true } : {}) },',
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D231-noun-tables-crossed",
    decision: "D231",
    what: "the singular and plural tables are swapped at the lookup — the mistake two same-shaped Maps invite, and the one a five-group regex makes easy to miss — so every singular printing falls through to the loud path and every plural one does too",
    file: "packages/engine/src/effects.ts",
    // RE-TRANSCRIBED AT D238, which appended a brace-code fallback to each
    // branch. Only the TABLE lookups are crossed here, so the mutant stays
    // about the two same-shaped Maps and not about the new resolver.
    find: '        ? (HAND_SEARCH_PLURAL.get(many ?? "") ?? typedNounFilter(many ?? "", true))\n        : (HAND_SEARCH_SINGULAR.get(one) ?? typedNounFilter(one, false));',
    replace:
      '        ? (HAND_SEARCH_SINGULAR.get(many ?? "") ?? typedNounFilter(many ?? "", true))\n        : (HAND_SEARCH_PLURAL.get(one) ?? typedNounFilter(one, false));',
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D231-unknown-noun-falls-back-to-anyCard",
    decision: "D231",
    what: 'an unresolvable noun phrase becomes `anyCard` — the "close enough" fallback a table invites, and the one that turns fourteen deferred legal printings into a search for ANY card: "up to 3 {D} Pokémon" would offer the whole deck',
    file: "packages/engine/src/effects.ts",
    find: "    if (filter !== undefined && max >= 1) {",
    replace: "    if (max >= 1) {",
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D231-anchor-drops-the-caret",
    decision: "D231",
    what: 'the anchor loses its `^`. ⚠️ THIS ONE SURVIVED ITS FIRST ROUND and the reason is a fact about the POPULATION, not a slip: every printed leading clause in this family LOWERCASES the verb ("If you do, search…", "If heads, search…"), so the capital `S` in the alternation already refuses `sv07-011` with or without the anchor. Closed with a CONSTRUCTED capitalised witness, labelled as constructed — D202\'s repair, one family over',
    file: "packages/engine/src/effects.ts",
    find: '  "^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +',
    replace:
      '  "(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +',
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D231-anchor-drops-the-tail",
    decision: "D231",
    what: 'the anchor loses its `$` — witness also printed: `sv06.5`-era "…Then, shuffle your deck. You may switch this Pokémon with 1 of your Benched Pokémon." carries a second clause the engine would silently drop',
    file: "packages/engine/src/effects.ts",
    find: '    " into your hand\\\\. Then, shuffle your deck\\\\.$",',
    replace: '    " into your hand\\\\. Then, shuffle your deck\\\\.",',
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D231-item-is-any-non-supporter-trainer",
    decision: "D231",
    what: 'the `item` predicate is written as "a Trainer that is not a Supporter" — the XY-era reading, when a Pokémon Tool really WAS a kind of Item — so "Search your deck for an Item card" offers Tools and Stadiums the sentence never names',
    file: "packages/engine/src/cards.ts",
    find: '      return card.category === "Trainer" && card.trainerType === "Item";',
    replace: '      return card.category === "Trainer" && card.trainerType !== "Supporter";',
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D231-anyCard-is-any-pokemon",
    decision: "D231",
    what: '`anyCard` is `anyPokemon`\'s arm copied verbatim from four cases up — the uncategorised noun read as the most common category — so "You may search your deck for a card" (3 legal) offers only Pokémon and no Energy or Trainer the player is entitled to',
    file: "packages/engine/src/cards.ts",
    find: '      // keeps a dangling uid out, so this arm means "any card" and not "any uid".\n      return true;',
    replace:
      '      // keeps a dangling uid out, so this arm means "any card" and not "any uid".\n      return card.category === "Pokemon";',
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D231-item-noun-loses-its-article",
    decision: "D231",
    what: 'the `retrieveNoun` phrase is "a Item card" — the article slip a per-kind table makes easy and nothing but a round trip catches — so the prompt heading reads "Search your deck for a Item card into your hand." where the card prints "an"',
    file: "packages/engine/src/interpreter.ts",
    find: '      return { singular: "an Item card", plural: "Item cards" };',
    replace: '      return { singular: "a Item card", plural: "Item cards" };',
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  // ── D232 · the opponent-hand family (backlog row 7) ────────────────────────
  // "12 mutants, 11 killed, 1 declared survivor." Two new ops, four anchors, the
  // engine's first RNG-driven OUTCOME, and one extraction in rng.ts.
  {
    id: "D232-reveal-reads-the-wrong-seat",
    decision: "D232",
    what: "`revealHand` is called on the CONTROLLER's own seat instead of the opponent's — the one-`otherSeat`-apart slip this helper exists to make unrepeatable, and the one that shows a player their own hand while telling the log it was their opponent's",
    file: "packages/engine/src/interpreter.ts",
    find: "      revealHand(state, otherSeat(ctx.seat), events);\n      return { done: state };",
    replace: "      revealHand(state, ctx.seat, events);\n      return { done: state };",
    expectKilledBy: ["packages/engine/src/opponentHandFamily.test.ts"],
  },
  {
    id: "D232-random-pick-is-index-zero",
    decision: "D232",
    what: "the random pick becomes hand index 0 — the defect every count assertion in this repo passes over, and the reason the board deals SEVEN DISTINCT card ids rather than a deep line of one",
    file: "packages/engine/src/interpreter.ts",
    find: "  const [index, rngState] = randomIndex(side.hand.length, state.rngState);",
    replace: "  const [index, rngState] = [0, state.rngState];",
    expectKilledBy: ["packages/engine/src/opponentHandFamily.test.ts"],
  },
  {
    id: "D232-random-take-drops-the-empty-hand-guard",
    decision: "D232",
    what: "the empty-hand guard is deleted, so an empty hand still announces a take — `side.hand[0]` is `undefined` and the op emits a RANDOM_CARD_TAKEN naming a card that does not exist, which the log then tries to name. ⚠️ THIS ROW REPLACED ONE THAT WAS EQUIVALENT: the first spelling MOVED the guard below the draw to assert the rng was not burned, and `randomIndex`'s own `count <= 0` return made that a no-op — the redundancy was real and the mutant could not fail. The two guards do DIFFERENT jobs, which is the correction that came out of running it: this one stops a bogus EVENT, `randomIndex`'s stops the burn (its own row, killed)",
    file: "packages/engine/src/interpreter.ts",
    find: "  if (side.hand.length === 0) return state;\n  const [index, rngState] = randomIndex(side.hand.length, state.rngState);",
    replace: "  const [index, rngState] = randomIndex(side.hand.length, state.rngState);",
    expectKilledBy: ["packages/engine/src/opponentHandFamily.test.ts"],
  },
  {
    id: "D232-shuffle-back-appends-without-shuffling",
    decision: "D232",
    what: 'the `deck` route appends the card and skips the shuffle — the printed "shuffles it into their deck" half-implemented, leaving a card whose identity AND position both public on top of the deck the owner is about to draw from',
    file: "packages/engine/src/interpreter.ts",
    find: "  const [deck, shuffled] = shuffle([...side.deck, uid], rngState);",
    replace: "  const [deck, shuffled] = [[...side.deck, uid], rngState];",
    expectKilledBy: ["packages/engine/src/opponentHandFamily.test.ts"],
  },
  {
    id: "D232-random-take-lands-in-the-actors-discard",
    decision: "D232",
    what: "the discarded card goes into the ACTOR's discard pile rather than the owner's — `ctx.seat` where `owner` belongs, the seat slip `bottomFromOpponentHandApply` one screen down is written to avoid, and one that silently moves a card between two players' decks over a game",
    file: "packages/engine/src/interpreter.ts",
    find: "      ...withSide(state, owner, { ...side, hand, discard: [...side.discard, uid] }),",
    replace:
      "      ...withSide(state, ctx.seat, { ...side, hand, discard: [...side.discard, uid] }),",
    expectKilledBy: ["packages/engine/src/opponentHandFamily.test.ts"],
  },
  {
    id: "D232-random-index-uses-modulo",
    decision: "D232",
    what: "`randomIndex` scales with `%` instead of dividing by 2³² — the bias a reader reaches for first, invisible on a 60-card shuffle and perfectly visible on the 7-card hand this engine now asks about",
    file: "packages/engine/src/rng.ts",
    find: "  return [Math.floor((value / 4294967296) * count), next];",
    replace: "  return [value % count, next];",
    expectKilledBy: [
      "packages/engine/src/opponentHandFamily.test.ts",
      "packages/engine/src/setup.test.ts",
    ],
  },
  {
    id: "D232-random-index-advances-on-zero",
    decision: "D232",
    what: "`randomIndex(0, s)` takes a step anyway — the guard that keeps an empty-hand whiff from desyncing replay, deleted",
    file: "packages/engine/src/rng.ts",
    find: "  if (count <= 0) return [0, state];",
    replace: "  if (count < 0) return [0, state];",
    expectKilledBy: ["packages/engine/src/opponentHandFamily.test.ts"],
  },
  {
    id: "D232-discard-route-derived-as-deck",
    decision: "D232",
    what: "the random-DISCARD sentence derives to the `deck` route — the neighbouring arm's real code two lines down, and the whole content of the one field these two sentences differ by, so eight legal printings shuffle a card back that the card says to discard",
    file: "packages/engine/src/effects.ts",
    find: '    return [{ op: "randomFromOpponentHand", to: "discard" }];',
    replace: '    return [{ op: "randomFromOpponentHand", to: "deck" }];',
    expectKilledBy: ["packages/engine/src/opponentHandFamily.test.ts"],
  },
  {
    id: "D232-reveal-anchor-drops-the-tail",
    decision: "D232",
    what: 'the bare-reveal anchor loses its `$`. The witness is PRINTED and legal: five sentences in this family open with "Your opponent reveals their hand." and continue ("…Discard a card you find there.", "…This attack does 50 damage for each Trainer card you find there."), so an unanchored pattern would implement the first clause of nine legal printings and silently drop the rest',
    file: "packages/engine/src/effects.ts",
    find: "const ATTACK_REVEAL_OPPONENT_HAND = /^Your opponent reveals their hand\\.$/;",
    replace: "const ATTACK_REVEAL_OPPONENT_HAND = /^Your opponent reveals their hand\\./;",
    expectKilledBy: ["packages/engine/src/opponentHandFamily.test.ts"],
  },
  {
    id: "D232-shuffle-back-anchor-drops-its-second-sentence",
    decision: "D232",
    what: 'the shuffle-back anchor keeps only its FIRST printed sentence — the truncation a two-sentence pattern invites, and the one that would derive a shuffle-back off "Choose a random card from your opponent\'s hand." alone, a clause no card prints on its own',
    file: "packages/engine/src/effects.ts",
    find: "  /^Choose a random card from your opponent['’]s hand\\. Your opponent reveals that card and shuffles it into their deck\\.$/;",
    replace: "  /^Choose a random card from your opponent['’]s hand\\./;",
    expectKilledBy: ["packages/engine/src/opponentHandFamily.test.ts"],
  },
  {
    id: "D232-log-row-drops-the-word-random",
    decision: "D232",
    what: 'the log row says "took X from Tide\'s hand" — dropping the one word that tells this apart from the CHOSEN pick one op over (CARD_TO_BOTTOM_OF_DECK), which is a materially different thing to have happened to you and which the log is the only lasting record of',
    file: "packages/engine/src/log.ts",
    find: "            ? ` at random from ${names[event.seat]}'s hand and discarded it`",
    replace: "            ? ` from ${names[event.seat]}'s hand and discarded it`",
    expectKilledBy: ["packages/engine/src/opponentHandFamily.test.ts"],
  },
  {
    id: "D232-random-discard-anchor-drops-the-apostrophe-class",
    decision: "D232",
    what: "the random-discard anchor spells `opponent's` straight-only, dropping D137's `['’]` class — so a re-ingest that curls the byte silently un-derives eight legal printings. ⚠️ THIS ROW WAS FIRST FILED AS A DECLARED `unreachable-population` SURVIVOR AND THE HARNESS REPORTED **STALE-SURVIVOR**: the declaration reasoned that a catalog with zero curly printings cannot tell the two patterns apart, which is true of the CATALOG and false of the SUITE — `clauseApostrophe.test.ts` and this slice's own reader both drive a CONSTRUCTED curly spelling, exactly as D227 says a parser property should be checked. A measured zero in the catalog is a reason to label the witness constructed, never a reason to declare a mutant unkillable",
    file: "packages/engine/src/effects.ts",
    find: "const ATTACK_RANDOM_DISCARD_FROM_HAND = /^Discard a random card from your opponent['\u2019]s hand\\.$/;",
    replace: "  /^Discard a random card from your opponent's hand\\.$/;",
    expectKilledBy: [
      "packages/engine/src/opponentHandFamily.test.ts",
      "packages/engine/src/clauseApostrophe.test.ts",
    ],
  },
  // ── D234 · attach from the DISCARD PILE (backlog row 9) ────────────────────
  // "12 mutants, 12 killed." ZERO new ops and zero interpreter lines, so every
  // row here is on the TEXT PARSER — the anchor, the destination table and the
  // emission — which is exactly where this slice's risk is. Each one is a
  // neighbour arm's real code copied verbatim, not a straw.
  {
    id: "D234-source-zone-crossed-to-the-hand",
    decision: "D234",
    what: "the derived op reads the HAND instead of the discard pile — backlog row 12 is the same verb one word over on the source side, and a build that crossed them attaches out of the wrong zone while emitting the same ENERGY_ATTACHED, parking on the same prompt and passing every count assertion in the repo",
    file: "packages/engine/src/effects.ts",
    // ⚠️ RE-ANCHORED AT D246, WHICH TURNED THE THREE ARMS' BODIES INTO ONE
    // READER: `source` is now that reader's PARAMETER, so the zone is chosen at the
    // call site and that is where the crossing has to be installed.
    find: '    const program = attachFromZoneProgram(match, "discard");',
    replace: '    const program = attachFromZoneProgram(match, "hand");',
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-drops-the-printed-energy-type",
    decision: "D234",
    what: 'the brace code is parsed and then thrown away, so "a Basic {F} Energy card" attaches whatever is first in the pile. The board that kills it holds two {F} and two {W} on purpose — a pile of one type cannot tell the two builds apart, which is why the deck carries three typed lines',
    file: "packages/engine/src/effects.ts",
    // \u26a0\ufe0f WIDENED AT D236, whose hand-side arm spreads the same expression:
    // the find carries the `source` line above it, which differs by the zone.
    // ⚠️ RE-ANCHORED AT D246: the spread is now written ONCE, in the shared
    // reader, so this row reaches every anchor in the family rather than one.
    find: "    ...(energyType === undefined ? {} : { energyType }),",
    replace: "    ...(energyType === undefined ? {} : {}),",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-toSelf-becomes-an-unnarrowed-target",
    decision: "D234",
    what: 'the printed "to this Pokémon" becomes an UN-NARROWED target set — the exact mistake D221\'s doc was written about (a class rider standing in for a UID question), and on a board with two eligible bodies the attach can land on the wrong one. The witness is that the op stops FORCING and starts parking',
    file: "packages/engine/src/effects.ts",
    find: '  ["this Pokémon", { riders: { toSelf: true }, anyWay: false }],',
    replace: '  ["this Pokémon", { riders: {}, anyWay: false }],',
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-bench-only-rider-dropped",
    decision: "D234",
    what: 'the printed "Benched" is dropped from the destination, so the ATTACKER is offered as a target for an attach the card says goes to the Bench. A neighbouring row in the same table is the un-narrowed one, so this is that row copied one line up',
    file: "packages/engine/src/effects.ts",
    find: '  ["1 of your Benched Pokémon", { riders: { benchOnly: true }, anyWay: false }],',
    replace: '  ["1 of your Benched Pokémon", { riders: {}, anyWay: false }],',
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-spread-collapses-into-one-batch",
    decision: "D234",
    what: 'the printed "in any way you like" emits ONE op carrying `count` instead of N ops — so both Energy land on the one body the player names first and the second decision never happens. ⚠️ THE MUTANT THIS SLICE EXISTS TO KILL: it attaches the same number of cards, emits the same number of ENERGY_ATTACHED rows and is invisible on a Bench of one',
    file: "packages/engine/src/effects.ts",
    // \u26a0\ufe0f WIDENED AT D236 for the same reason as the two rows above — the
    // hand arm ends in the byte-identical return.
    // ⚠️ RE-ANCHORED AT D246, which moved this expression into the shared
    // reader `attachFromZoneProgram` — one copy for three anchors, so the row is
    // unique again for the first time since D236 had to widen it twice.
    find: "  return destination.anyWay\n    ? Array.from({ length: count }, () => ({ ...base }))\n    : [count === 1 ? base : { ...base, count }];",
    replace: "  return [count === 1 ? base : { ...base, count }];",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-batch-explodes-into-a-spread",
    decision: "D234",
    what: 'the SAME crossing in the other direction: "up to 2 … to 1 of your Benched Pokémon" becomes two independent decisions, so a card that pins its whole batch to one body lets the player split it. The pair of mutants is the point — one field, two printed values, and neither direction can hide behind the other',
    file: "packages/engine/src/effects.ts",
    // ⚠️ WIDENED AT D236, whose hand-side arm ends in the byte-identical return:
    // the find carries the discard arm's own closing comment line so it stays
    // unique. Widen the OLDER find; never narrow the new code.
    // ⚠️ RE-ANCHORED AT D246, which moved this expression into the shared
    // reader `attachFromZoneProgram` — one copy for three anchors, so the row is
    // unique again for the first time since D236 had to widen it twice.
    find: "  return destination.anyWay\n    ? Array.from({ length: count }, () => ({ ...base }))\n    : [count === 1 ? base : { ...base, count }];",
    replace: "  return Array.from({ length: count }, () => ({ ...base }));",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-singular-emits-an-explicit-count-1",
    decision: "D234",
    what: "a singular printing emits `count: 1` instead of omitting the field. Behaviourally identical on every board — and WRONG, because these ops are compared BY VALUE against hand-authored registry rows (D205's `absent = 1`), so a derived program would stop equalling the registry program that means the same thing",
    file: "packages/engine/src/effects.ts",
    // ⚠️ WIDENED AT D236 for the row above's reason — the same expression now
    // closes both attach arms.
    // ⚠️ RE-ANCHORED AT D246, which moved this expression into the shared
    // reader `attachFromZoneProgram` — one copy for three anchors, so the row is
    // unique again for the first time since D236 had to widen it twice.
    find: "  return destination.anyWay\n    ? Array.from({ length: count }, () => ({ ...base }))\n    : [count === 1 ? base : { ...base, count }];",
    replace:
      "  return destination.anyWay\n    ? Array.from({ length: count }, () => ({ ...base }))\n    : [{ ...base, count }];",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-anchor-drops-its-trailing-anchor",
    decision: "D234",
    what: "the anchor loses its `$`, so a sentence whose attach is only its FIRST clause derives as if the tail were not there. ⚠️ CONSTRUCTED WITNESS, AND SAID SO: no printed member of this family carries a tail, which is D228's finding — a dropped `$` survives a harness fed only real rows. \u26a0\ufe0f AND IT SURVIVED ITS FIRST RUN, WHICH CHANGED THE CODE RATHER THAN THE ROW: with a greedy `(.+)` the capture backtracks past the trailing clause to the LAST period, so an unresolvable phrase refused the sentence by ACCIDENT and the `$` was doing nothing observable. The class is `[^.]` now, and the mutant dies",
    file: "packages/engine/src/effects.ts",
    // ⚠️ RE-TRANSCRIBED AT D236, which turned the two attach anchors into ONE
    // FACTORY: the `$` is now a single byte serving both source zones, so this row
    // is the only mutant that can reach it and BOTH suites can kill it.
    // ⚠️ RE-ANCHORED AT D246, which split the clause from the anchor so a
    // LEADING clause could wear it: the `$` now lives on `attachFromZoneAnchor`'s
    // one-line wrapper, still ONE byte serving both bare source zones.
    find: "  return new RegExp(`^Attach ${attachFromZoneClause(zonePhrase, tail)}$`);",
    replace: "  return new RegExp(`^Attach ${attachFromZoneClause(zonePhrase, tail)}`);",
    expectKilledBy: [
      "packages/engine/src/derivedDiscardAttach.test.ts",
      "packages/engine/src/derivedHandAttach.test.ts",
    ],
  },
  {
    id: "D234-anchor-drops-its-leading-anchor",
    decision: "D234",
    what: 'the anchor loses its `^`, and this one has a REAL printed witness on both sides: "Flip 3 coins. Attach a number of…" (1 legal) and "Choose up to 2 of your Benched Pokémon and attach…" (rotated) both become derivable, each losing the clause that is the whole point of the card',
    file: "packages/engine/src/effects.ts",
    // ⚠️ RE-ANCHORED AT D246 for the row above's reason.
    find: "  return new RegExp(`^Attach ${attachFromZoneClause(zonePhrase, tail)}$`);",
    replace: "  return new RegExp(`Attach ${attachFromZoneClause(zonePhrase, tail)}$`);",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-dragon-code-resolves-to-the-wrong-type",
    decision: "D234",
    what: "the `{N}` code resolves to Colorless — the neighbouring row in the same map, and the one type word that is on 100 catalog rows where Dragon is on 64, so a Druddigon attach would offer half the board. It is also the reason the map is pinned TOTAL against POKEMON_TYPES rather than spot-checked",
    file: "packages/engine/src/effects.ts",
    find: '  N: "Dragon",',
    replace: '  N: "Colorless",',
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-count-admits-a-printed-zero",
    decision: "D234",
    what: 'the `count >= 1` floor becomes `>= 0`, so a malformed "up to 0" row derives a program that moves nothing and says nothing — the silent no-op every numeric arm in this file guards against',
    file: "packages/engine/src/effects.ts",
    // ⚠️ WIDENED AT D235, which added a SECOND arm sharing this ceiling: the
    // two-line form is no longer unique, so the find carries the closing paren
    // that only the discard-pile arm has.
    // ⚠️ RE-ANCHORED AT D246: the two-arm conjunction became one early return
    // in the shared reader, and the floor is unique again.
    find: "  if (count < 1 || count > MAX_PRINTED_ATTACH_COUNT) return null;",
    replace: "  if (count < 0 || count > MAX_PRINTED_ATTACH_COUNT) return null;",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-ingested-text-ceiling-lifted",
    decision: "D234",
    what: "the printed-count ceiling is raised past anything a card prints, which matters on the `anyWay` branch specifically: that branch grows the PROGRAM one op per unit, so an unbounded `\\d+` lets one malformed third-party row build an arbitrarily long program. `MAX_PRINTED_FLIPS` is the same guard one reader over",
    file: "packages/engine/src/effects.ts",
    find: "const MAX_PRINTED_ATTACH_COUNT = 10;",
    replace: "const MAX_PRINTED_ATTACH_COUNT = 1000;",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  // ── D235 — the deck search that ATTACHES (backlog row 10). Eleven mutants over
  //    the two things this arm can get wrong that no generic attach assertion
  //    would notice: the `batch` rule (a "1 of" sentence deriving to a splittable
  //    program) and the §9.2 tail (a poison that fires on the wrong printings). ──
  {
    id: "D235-batch-rule-dropped",
    decision: "D235",
    what: '🛑 THE MUTANT THIS SLICE EXISTS TO KILL. The `destination.batch || count === 1` guard is removed, so "…attach THEM to 1 OF your Pokémon" derives to `max: 2` with no target coupling — two Energy free to land on two different bodies off a card that prints "1 of". It attaches the right number of cards, emits the right number of ENERGY_ATTACHED rows, and is invisible on a Bench of one. Three legal printings are wrong and nothing else moves',
    file: "packages/engine/src/effects.ts",
    find: "      (destination.batch || count === 1)",
    replace: "      (destination.batch || count >= 1)",
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  {
    id: "D235-one-of-row-claims-it-can-batch",
    decision: "D235",
    what: 'the SAME crossing from the table side rather than the arm side: the un-narrowed "1 of your Pokémon" row claims `batch: true`. The neighbouring row in the same table is the "in any way you like" one, so this is that row\'s flag copied two lines up — the shape a hand-maintained table drifts into',
    file: "packages/engine/src/effects.ts",
    find: '  ["1 of your Pokémon", { riders: {}, batch: false }],',
    replace: '  ["1 of your Pokémon", { riders: {}, batch: true }],',
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  {
    id: "D235-generated-spread-row-refuses-a-batch",
    decision: "D235",
    what: 'the GENERATED brace-coded spread row ("your {X} Pokémon in any way you like") loses its `batch: true`, so every typed spread is refused at the plural. Zero legal printings today and read anyway — an arm transfers across sets — so this is the mutant that proves the generated half of the table is DRIVEN rather than merely constructed',
    file: "packages/engine/src/effects.ts",
    find: "          { riders: { targetType: type }, batch: true },",
    replace: "          { riders: { targetType: type }, batch: false },",
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  {
    id: "D235-poison-tail-fires-on-every-printing",
    decision: "D235",
    what: "the §9.2 gate is emitted whether or not the printed tail matched, so eleven sentences that print no second clause start poisoning their own attacker. The `recordGate` still gates on the attach, so it is silent on a whiff — which is exactly why only a board where the attach SUCCEEDS can catch it",
    file: "packages/engine/src/effects.ts",
    find: '      return match[5] === undefined\n        ? [attach, { op: "shuffleDeck" }]',
    replace: '      return false\n        ? [attach, { op: "shuffleDeck" }]',
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  {
    id: "D235-poison-tail-silently-dropped",
    decision: "D235",
    what: "the other direction: the tail is matched by the anchor and then IGNORED, so Skuntank's printed second sentence vanishes and the card under-performs. ⚠️ THE QUIET ONE — the attack still attaches, still shuffles and still passes every count assertion; only the card's second sentence is gone",
    file: "packages/engine/src/effects.ts",
    find: '      return match[5] === undefined\n        ? [attach, { op: "shuffleDeck" }]',
    replace: '      return true\n        ? [attach, { op: "shuffleDeck" }]',
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  {
    id: "D235-recordAs-filed-by-every-printing",
    decision: "D235",
    what: '`recordAs: "moved"` is set on every arm rather than only where a gate reads it. Behaviourally inert on every board — and WRONG, because these ops are compared BY VALUE against Janine\'s hand-authored registry row (D135: an absent field means what the sentence means), so a derived program would stop equalling the authored one that means the same thing',
    file: "packages/engine/src/effects.ts",
    find: '        ...(match[5] === undefined ? {} : { recordAs: "moved" as const }),',
    replace: '        ...{ recordAs: "moved" as const },',
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  {
    id: "D235-anchor-drops-its-trailing-anchor",
    decision: "D235",
    what: "the anchor loses its `$`. ⚠️ AND HERE THE `$` IS LOAD-BEARING FOR A REASON D234's WAS NOT: with an OPTIONAL tail group after the shuffle clause, a sentence carrying an UNRECOGNISED trailing clause matches with the group simply unmatched — so the clause is silently thrown away rather than refused. D234's dropped-`$` mutant survived because a greedy capture refused tails by accident; this one cannot, because the capture is bounded on both sides",
    file: "packages/engine/src/effects.ts",
    find: "    ` to ([^.]+)\\\\. Then, shuffle your deck\\\\.(?: (${DECK_SEARCH_POISON_TAIL}))?$`,",
    replace:
      "    ` to ([^.]+)\\\\. Then, shuffle your deck\\\\.(?: (${DECK_SEARCH_POISON_TAIL}))?`,",
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  {
    id: "D235-anchor-drops-its-leading-anchor",
    decision: "D235",
    what: 'the anchor loses its `^`, and this one has a REAL printed witness: the ABILITY-column spelling of this very family ("Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may search your deck for…", 3 legal printings on `sv10-003`/`-206`/`-228`) becomes derivable, losing the §9 trigger and the once-per-turn clause that are the whole card',
    file: "packages/engine/src/effects.ts",
    find: '  `^Search your deck for (?:a Basic (?:\\\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\\\} )?Energy card and attach it` +',
    replace:
      '  `Search your deck for (?:a Basic (?:\\\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\\\} )?Energy card and attach it` +',
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  {
    id: "D235-self-destination-loses-its-toSelf",
    decision: "D235",
    what: 'the printed "this Pokémon" becomes the un-narrowed set, so an attach the card aims at its own body offers every Pokémon the controller has. On a board with two Benched bodies the prompt goes from one target to three, and every count assertion still passes',
    file: "packages/engine/src/effects.ts",
    find: '  ["this Pokémon", { riders: { toSelf: true }, batch: true }],',
    replace: '  ["this Pokémon", { riders: {}, batch: true }],',
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  {
    id: "D235-bench-spread-loses-its-benchOnly",
    decision: "D235",
    what: 'the printed "Benched" is dropped from the spread destination, so the ATTACKER is offered as a target for an attach the card says goes to the Bench. A neighbouring row in the same table is the un-narrowed one, so this is that row copied one line up',
    file: "packages/engine/src/effects.ts",
    find: '  ["your Benched Pokémon in any way you like", { riders: { benchOnly: true }, batch: true }],',
    replace: '  ["your Benched Pokémon in any way you like", { riders: {}, batch: true }],',
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  {
    id: "D235-printed-shuffle-dropped",
    decision: "D235",
    what: 'the trailing `shuffleDeck` is dropped from the tail-less branch, so a card that prints "Then, shuffle your deck" leaves the deck in the order the player just read. ⚠️ INVISIBLE ON EVERY BOARD ASSERTION IN THIS SUITE — the Energy still attaches — and caught only by the by-value program comparison, which is why that comparison is the first case in the file',
    file: "packages/engine/src/effects.ts",
    find: '        ? [attach, { op: "shuffleDeck" }]',
    replace: "        ? [attach]",
    expectKilledBy: ["packages/engine/src/derivedDeckSearchAttach.test.ts"],
  },
  // ── D236 — attach from the HAND (backlog row 12). Seven mutants over the two
  //    things THIS arm can get wrong that no generic attach assertion would
  //    notice: the SOURCE ZONE (one word, two piles, and the shared factory means
  //    a crossing is one byte) and the HEAL TAIL (a heal that fires on the wrong
  //    printings, on the wrong body, or on a whiff). The shared `$` is covered by
  //    `D234-anchor-drops-its-trailing-anchor`, re-transcribed onto the factory. ──
  {
    id: "D236-hand-arm-attaches-out-of-the-discard-pile",
    decision: "D236",
    what: '🛑 THE MUTANT THIS SLICE EXISTS TO KILL. The hand arm emits `source: "discard"`, so a card that says "from your hand" takes the Energy out of the discard pile instead. It attaches the right number of cards of the right type onto the right body, emits the right ENERGY_ATTACHED rows, and is invisible to every count assertion in the repo — only the two ZONE assertions can see it',
    file: "packages/engine/src/effects.ts",
    // ⚠️ RE-ANCHORED AT D246 to the HAND arm's call site, for the reason
    // D234's zone row carries: the zone is a parameter now.
    find: '    const program = attachFromZoneProgram(\n      match,\n      "hand",',
    replace: '    const program = attachFromZoneProgram(\n      match,\n      "discard",',
    expectKilledBy: ["packages/engine/src/derivedHandAttach.test.ts"],
  },
  {
    id: "D236-source-phrase-collapses-onto-the-discard-side",
    decision: "D236",
    what: "the same crossing from the TEXT side rather than the op side: the hand anchor is built with the discard phrase, so the two factory calls become identical and every hand printing falls through to the loud ATTACK_EFFECT_SKIPPED path. This is the row that makes 'the two zones are one word apart' a fact rather than a comment",
    file: "packages/engine/src/effects.ts",
    find: 'const HAND_SOURCE_ZONE_PHRASE = " from your hand";',
    replace: 'const HAND_SOURCE_ZONE_PHRASE = " from your discard pile";',
    expectKilledBy: ["packages/engine/src/derivedHandAttach.test.ts"],
  },
  {
    id: "D236-heal-tail-fires-on-every-printing",
    decision: "D236",
    what: "`healed` reads the DESTINATION group instead of the tail group, so it is true on every match and all four sentences heal. Three legal printings print the clause and six do not — a build that healed on all nine would clear damage off cards that print no heal at all, and no ENERGY_ATTACHED assertion would notice",
    file: "packages/engine/src/effects.ts",
    // ⚠️ RE-ANCHORED AT D246, which gave the tail TWO capture groups of its
    // own and renumbered the clause: the tail's PRESENCE is group 6, its number 7
    // and its pronoun 8. Reading the DESTINATION group instead is group 5.
    find: "      match[6] === undefined",
    replace: "      match[5] === undefined",
    expectKilledBy: ["packages/engine/src/derivedHandAttach.test.ts"],
  },
  {
    id: "D236-heal-tail-never-fires",
    decision: "D236",
    what: "the other direction: the tail group is read inverted, so the ONE sentence that prints the heal derives without it and the six that do not print it derive WITH it. The pair is the point — one optional group, two printed states, and neither direction can hide behind the other",
    file: "packages/engine/src/effects.ts",
    // ⚠️ RE-ANCHORED AT D246 for the row above's reason — the inversion is now
    // on the presence test's own operator.
    find: "      match[6] === undefined\n        ? undefined",
    replace: "      match[6] !== undefined\n        ? undefined",
    expectKilledBy: ["packages/engine/src/derivedHandAttach.test.ts"],
  },
  {
    id: "D236-heal-rides-a-spread",
    decision: "D236",
    what: "\u201cthat Pokémon\u201d names ONE body, and this guard is the only thing stopping a heal tail from riding a DISTRIBUTION — N independent decisions landing on N bodies, each healing. Raised past the printed count, the guard admits it. Zero printings today, which is exactly why it is a guard: it keeps a future one from deriving a rule nobody printed",
    file: "packages/engine/src/effects.ts",
    // ⚠️ RE-ANCHORED AT D246, which moved the guard into the shared reader and
    // turned it from a conjunct into an early return.
    find: "  if (heal !== undefined && destination.anyWay && count > 1) return null;",
    replace: "  if (heal !== undefined && destination.anyWay && count > 2) return null;",
    expectKilledBy: ["packages/engine/src/derivedHandAttach.test.ts"],
  },
  {
    id: "D236-heal-lands-before-the-attach",
    decision: "D236",
    what: "the heal is applied to the state BEFORE the attach was written, so the Energy silently un-attaches while the damage still clears. ⚠️ THE ASSERTION THAT CATCHES IT IS THE ENERGY COUNT ON THE HEALED BODY, not the HEALED row — a suite that only checked that the damage went would pass",
    file: "packages/engine/src/interpreter.ts",
    find: "  return op.healTarget === undefined ? next : healChosen(next, ref, op.healTarget, ctx, events);",
    replace:
      "  return op.healTarget === undefined ? next : healChosen(state, ref, op.healTarget, ctx, events);",
    expectKilledBy: ["packages/engine/src/derivedHandAttach.test.ts"],
  },
  {
    id: "D236-heal-is-unconditional",
    decision: "D236",
    what: 'the field guard is dropped, so `healChosen` runs at "all" on EVERY `attachEnergyFrom` — the six registry Abilities that have carried the op since M5, and the six of this row\'s nine printings that print no heal, all silently clear every damage counter off the body they feed. ⚠️ IT SURVIVED ITS FIRST RUN AND THE SUITE GAINED A CASE RATHER THAN THE ROW GAINING AN EXCUSE: every heal assertion in the slice ran on the ONE sentence that prints the clause, so nothing was watching a DAMAGED board under a tail-less sentence. That control is now the first case in section 3',
    file: "packages/engine/src/interpreter.ts",
    find: "  return op.healTarget === undefined ? next : healChosen(next, ref, op.healTarget, ctx, events);",
    replace: '  return healChosen(next, ref, op.healTarget ?? "all", ctx, events);',
    expectKilledBy: [
      "packages/engine/src/derivedHandAttach.test.ts",
      "packages/engine/src/attachEnergyFrom.test.ts",
      "packages/engine/src/tealDance.test.ts",
    ],
  },
  // ── D237 — the discard pile into the HAND or onto the BENCH (backlog row 13).
  //    Nine mutants over the three things THIS slice can get wrong that no
  //    generic retrieval assertion would notice: the FILTER (a category that
  //    collapses to a subtype, a name that widens to any card), the DESTINATION
  //    (a Bench put that lands in the hand, or a noun the Bench cannot hold) and
  //    the BENCH-SPACE clamp (which exists twice, at the park and at the move,
  //    and is a card-destruction bug if either goes). ──
  {
    id: "D237-trainer-filter-collapses-onto-one-subtype",
    decision: "D237",
    what: '🛑 THE MUTANT THIS FILTER EXISTS TO KILL. `trainerCard` reads `trainerType` as well as `category`, so the printed "a Trainer card" silently becomes "an Item card". On a pile holding one of each subtype it offers ONE card where the sentence names four, and every count-shaped assertion in the repo still passes — only the four-subtype board can see it',
    file: "packages/engine/src/cards.ts",
    find: '    case "trainerCard":',
    replace: '    case "trainerCard":\n      if (card.trainerType !== "Item") return false;',
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D237-named-noun-widens-to-any-card",
    decision: "D237",
    what: 'the NAME group falls back to `anyCard`, so "Put up to 3 Duskull onto your Bench" offers every card in the pile and benches three arbitrary ones. It parks, it moves three cards, it emits the right event — and the only thing that can see it is the assertion that names WHICH cards were offered',
    file: "packages/engine/src/effects.ts",
    find: '            : { kind: "byName", name: match[4] };',
    replace: '            : { kind: "anyCard" };',
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D237-bench-destination-lands-in-the-hand",
    decision: "D237",
    what: 'the destination table maps "onto your Bench" to the HAND, so three Duskull come back as CARDS instead of as Pokémon in play. The pile empties by the right amount and the log even says something plausible — the board is the only witness',
    file: "packages/engine/src/effects.ts",
    find: '  ["onto your Bench", "bench" as const],',
    replace: '  ["onto your Bench", "hand" as const],',
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D237-bench-guard-admits-a-non-pokemon-noun",
    decision: "D237",
    what: "the Bench guard is dropped, so a sentence naming a Supporter and the Bench derives to a program that puts a Supporter into play. ZERO printings spell it — which is exactly why it is a guard rather than a branch, and why the near-miss that drives it is constructed rather than printed",
    file: "packages/engine/src/effects.ts",
    find: '      (dest !== "bench" || BENCHABLE_RETRIEVAL_KINDS.has(filter.kind))',
    replace: '      (dest !== "bench" || filter.kind !== "supporterXX")',
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D237-anchor-drops-its-trailing-anchor",
    decision: "D237",
    what: "the terminal `$` goes, so a sentence with a TRAILING CLAUSE derives as if the clause were not there. ⚠️ THIS IS THE MUTANT THAT PROVES THE `[^.]` DESTINATION CLASS: a greedy `(.+)` would backtrack to the LAST period and refuse the trailing clause BY ACCIDENT, which is D234's finding re-inherited — with the narrow class, only the `$` refuses it",
    file: "packages/engine/src/effects.ts",
    find: "    `${SOURCE_ZONE_PHRASE} ([^.]+)\\\\.$`,",
    replace: "    `${SOURCE_ZONE_PHRASE} ([^.]+)\\\\.`,",
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D237-singular-branch-emits-the-plural-max",
    decision: "D237",
    what: 'the absent count reads as 2 rather than 1, so "Put a Pokémon from your discard pile into your hand" offers a pick of two. `max` is REQUIRED on this op, so there is no absent-means-one to hide behind — the article and the count are the two printed branches and both are legal',
    file: "packages/engine/src/effects.ts",
    find: "    const max = match[2] === undefined ? 1 : Number(match[2]);",
    replace: "    const max = match[2] === undefined ? 2 : Number(match[2]);",
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D237-bench-clamp-dropped-at-the-park",
    decision: "D237",
    what: "the park offers the PRINTED max instead of the bench space, so a Bench with one slot free is asked to take three. The move clamps behind it, which is what makes this a SILENT loss rather than a crash: the player picks three cards, one lands, and two are simply gone from the offer with no row explaining it",
    file: "packages/engine/src/interpreter.ts",
    find: '      const retrieveMax =\n        op.dest === "bench" ? Math.min(op.max, benchSpace(state, ctx.seat)) : op.max;',
    replace: "      const retrieveMax = op.max;",
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D237-bench-clamp-dropped-at-the-move",
    decision: "D237",
    what: "🛑 THE CARD-DESTRUCTION SHAPE THE M1 REVIEW NAMED. The move stops clamping, so on a full Bench the uids leave the discard pile and land NOWHERE — removed from one zone and appended to a bench the sixth slot of which does not exist. The park's clamp hides it on every board except the one where the Bench filled between the park and the answer",
    file: "packages/engine/src/interpreter.ts",
    find: '  const moved = dest === "bench" ? inDiscard.slice(0, benchSpace(state, ctx.seat)) : inDiscard;',
    replace: "    inDiscard;",
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D237-log-bench-row-falls-through-to-the-deck-row",
    decision: "D237",
    what: "the third arm goes and the Bench put falls into the `else`, which is EXACTLY the live mis-render this slice was added to prevent: three Pokémon entering play announced as “shuffled 3 cards from their discard pile into their deck”. A log row that states the opposite of the board is worse than no row at all",
    file: "packages/engine/src/log.ts",
    find: '          : event.dest === "bench"\n            ? [plain(`put ${cards} onto their Bench`)]\n            : [plain(`shuffled ${cards} into their deck`)],',
    replace: "          : [plain(`shuffled ${cards} into their deck`)],",
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  // ── D238 — the printed BRACE CODE (one mechanism, three anchors).
  //    Eight mutants over the three layers this design has and no earlier noun
  //    did: the PATTERN (what shape of phrase is admitted), the two closed CODE
  //    MAPS (which letters resolve, and to WHICH vocabulary), and the PREDICATE
  //    (`types` is an ARRAY, and the stage rider narrows it). Each is a
  //    neighbouring arm's real code copied verbatim, per D190b's rule. ──
  {
    id: "D238-typed-predicate-reads-the-first-type-only",
    decision: "D238",
    what: "🛑 THE MUTANT THIS PREDICATE EXISTS TO KILL. `types.includes(t)` becomes `types[0] === t` — the obvious wrong read of a column that is an ARRAY, and one the real catalog punishes because dual-type Pokémon are printed. A `{W}` search silently drops every body whose Water is its SECOND type; `fix-dual-basic` is the only card in the pool that can see it",
    file: "packages/engine/src/cards.ts",
    find: "        (card.types ?? []).includes(filter.pokemonType) &&",
    replace: "        (card.types ?? [])[0] === filter.pokemonType &&",
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D238-typed-predicate-ignores-the-stage-rider",
    decision: "D238",
    what: 'the `stage` rider stops narrowing, so "Search your deck for a Basic {G} Pokémon" offers the Stage 1 of the same type as well. The rider has ONE printed witness in the whole catalog and 0 legal printings, which is exactly the shape of field that rots unnoticed',
    file: "packages/engine/src/cards.ts",
    find: '        (card.types ?? []).includes(filter.pokemonType) &&\n        (filter.stage === undefined ||\n          (filter.stage === "basic" ? isBasicPokemon(card) : evolveFromOf(card) !== null))',
    replace: "        (card.types ?? []).includes(filter.pokemonType)",
    expectKilledBy: [
      "packages/engine/src/derivedBenchSearch.test.ts",
      "packages/engine/src/derivedDiscardRetrieval.test.ts",
    ],
  },
  {
    id: "D238-typed-noun-loses-its-benchable-kind",
    decision: "D238",
    what: '🛑 THE SILENT-LOSS SHAPE, and the reason that one line is commented. `typedPokemon` drops out of `BENCHABLE_RETRIEVAL_KINDS`, so "Put up to 3 {W} Pokémon … onto your Bench." — the family\'s LARGEST single sentence, 3 legal printings — matches the anchor, resolves its filter, and is then refused at the guard. It lands on the skipped path looking exactly like an unread sentence: every derive test that only checks OTHER sentences stays green',
    file: "packages/engine/src/effects.ts",
    find: '  "typedPokemon",\n  "byName",\n]);',
    replace: '  "byName",\n]);',
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D238-energy-noun-resolved-through-the-pokemon-map",
    decision: "D238",
    what: 'the Energy branch reads `POKEMON_TYPE_BY_CODE` — the map one line up, the neighbour-copy mistake — so `{N}` and `{C}` resolve. "Basic {N} Energy cards" becomes a search for a Basic DRAGON Energy card, which does not exist in the game: an empty candidate set that whiffs and shuffles, indistinguishable from an unlucky deck. The two maps differ by exactly those two letters and that difference IS the rule',
    file: "packages/engine/src/effects.ts",
    find: "  const energyType = ENERGY_TYPE_BY_CODE[code];",
    replace: "  const energyType = POKEMON_TYPE_BY_CODE[code] as BasicEnergyType | undefined;",
    expectKilledBy: [
      "packages/engine/src/derivedHandSearch.test.ts",
      "packages/engine/src/derivedDiscardRetrieval.test.ts",
    ],
  },
  {
    id: "D238-energy-noun-drops-the-printed-basic",
    decision: "D238",
    what: 'the `basic` conjunct goes, so the printed "{R} Energy card" — which is a PROVISION phrase, a while-attached property `matchesFilter` answers FALSE for in every pile — becomes a `basicEnergy` search. A build that searched a deck for something nothing in it can be, on a word the card really does print',
    file: "packages/engine/src/effects.ts",
    find: '  if (!basic || match[3] !== (plural ? "Energy cards" : "Energy card")) return undefined;',
    replace: '  if (match[3] !== (plural ? "Energy cards" : "Energy card")) return undefined;',
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D238-energy-noun-unwelds-the-grammatical-number",
    decision: "D238",
    what: 'the number weld goes, so "up to 3 Basic {G} Energy CARD" and "a Basic {G} Energy CARDS" both derive — crossed forms no card prints. ⚠️ ONLY `ATTACK_HAND_SEARCH` CAN SEE THIS: its noun capture is a lazy `[^,.]+?`, so the regex admits both and the resolver is the only thing that refuses; the two sibling anchors spell their nouns as alternations and would refuse them at the pattern',
    file: "packages/engine/src/effects.ts",
    find: '  if (!basic || match[3] !== (plural ? "Energy cards" : "Energy card")) return undefined;',
    replace: "  if (!basic) return undefined;",
    expectKilledBy: ["packages/engine/src/derivedHandSearch.test.ts"],
  },
  {
    id: "D238-typed-noun-caption-falls-back-to-the-neighbour",
    decision: "D238",
    what: "🛑 THE DECISION THIS SLICE OWED, INVERTED. `retrieveNoun`'s new arm is replaced by `anyPokemon`'s REAL code one case up, so the dialog captions \"Put up to 3 Pokémon…\" for a sentence that names a type. The program is right, the board is right, the offered cards are right — the player is simply told the wrong thing, which is the half a filter test can never see and the half the printed-phrase-≠-caption-phrase finding is about",
    file: "packages/engine/src/interpreter.ts",
    find: "      return { singular: `a ${noun}`, plural: noun };",
    replace: '      return { singular: "a Pokémon", plural: "Pokémon" };',
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D238-bench-anchor-reads-the-old-count-group",
    decision: "D238",
    what: 'the bench anchor gained a third alternative, so every group after the noun shifted by one — and this is the mistake an author makes when adding one: the count is read from `match[3]` (now the singular NAME group) instead of `match[4]`. "up to 2 Basic Pokémon" derives at `max: 1`, and the typed sentence derives with a name-shaped count. A regroup that compiles and lies',
    file: "packages/engine/src/effects.ts",
    find: "    const max = match[4] === undefined ? 1 : Number(match[4]);\n    const typed = match[2] ?? match[6];",
    replace:
      "    const max = match[3] === undefined ? 1 : Number(match[3]);\n    const typed = match[2] ?? match[6];",
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D239-exclusion-dropped-when-the-code-is-unreadable",
    decision: "D239",
    what: '🛑 THE INVERTED-DEFAULT MUTANT, AND THE ONE THIS ARM EXISTS FOR. An unresolvable brace code falls back to the un-excluded class instead of falling through to the LOUD path. Everywhere else in this family a conservative default protects LESS; a dropped exclusion protects MORE than the card prints — Terapagos ex would start refusing the Colorless Basics its own sentence lets through. The mistake an author makes reaching for `?? { stage: "basic" }` because every other optional key in this file is safe to omit',
    file: "packages/engine/src/effects.ts",
    find: "    const excludingType = POKEMON_TYPE_BY_CODE[code];\n    if (excludingType !== undefined) {",
    replace: "    const excludingType = POKEMON_TYPE_BY_CODE[code];\n    if (true) {",
    expectKilledBy: ["packages/engine/src/typedClassBlock.test.ts"],
  },
  {
    id: "D239-exclusion-stores-the-printed-code",
    decision: "D239",
    what: 'the resolved `PokemonType` is replaced by the raw captured LETTER, so the record carries `excludingType: "C"`. Nothing on the board changes shape and the derive still returns one op — but the predicate compares "C" against a `types` column that spells "Colorless", so the exclusion silently never fires, and the log row quotes a brace code at a player. D238\'s caption rule and the predicate, broken by one substitution',
    file: "packages/engine/src/effects.ts",
    find: '      return [{ op: "preventDamage", fromClass: { stage: "basic", excludingType } }];',
    replace:
      '      return [{ op: "preventDamage", fromClass: { stage: "basic", excludingType: code as PokemonType } }];',
    expectKilledBy: ["packages/engine/src/typedClassBlock.test.ts"],
  },
  {
    id: "D239-class-anchor-loses-its-end-anchor",
    decision: "D239",
    what: 'the widened anchor drops its `$`, so "…from Basic non-{C} Pokémon. Draw a card." derives as the bare block and the second printed sentence is silently thrown away. The classic anchor defect, re-checked on the one anchor in this family that now has an optional group in it — a group is exactly the edit during which an author retypes the tail',
    file: "packages/engine/src/effects.ts",
    find: "  /^During your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks from Basic (?:non-\\{([A-Z])\\} )?Pokémon\\.$/;",
    replace:
      "  /^During your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks from Basic (?:non-\\{([A-Z])\\} )?Pokémon\\./;",
    expectKilledBy: ["packages/engine/src/typedClassBlock.test.ts"],
  },
  {
    id: "D239-class-anchor-captures-greedily",
    decision: "D239",
    what: '🛑 the single-character class becomes a greedy `(.+)`, and this one SURVIVED its first run — the three swallowed-clause cases all still resolve to a key the map misses, so the greedy read is EQUIVALENT on printed text. What kills it is the PROTOTYPE: `POKEMON_TYPE_BY_CODE` is an object literal, so `map["constructor"]` answers `[class Object]` and the arm\'s `!== undefined` guard passes. "non-{constructor}" then derives a block whose `excludingType` is a FUNCTION. The character class is the prototype guard, and that is why the mutant is worth keeping',
    file: "packages/engine/src/effects.ts",
    find: "(?:non-\\{([A-Z])\\} )?Pokémon\\.$/;",
    replace: "(?:non-\\{(.+)\\} )?Pokémon\\.$/;",
    expectKilledBy: ["packages/engine/src/typedClassBlock.test.ts"],
  },
  {
    id: "D239-predicate-reads-types-by-position",
    decision: "D239",
    what: "🛑 THE NEIGHBOUR-COPY MUTANT, and the one D238 already paid for one file over. `types.includes(t)` becomes `types[0] === t` — the obvious wrong read of a column that is an ARRAY. No Standard-legal Pokémon is dual-typed today, so NOTHING in the real pool can see it; `fix-dual-colorless` is a declared probe that exists precisely to make this difference observable, and it is Fire FIRST so an equality read admits it to the block",
    file: "packages/engine/src/continuous.ts",
    find: "  return cls.excludingType === undefined || !(attacker.types ?? []).includes(cls.excludingType);",
    replace:
      "  return cls.excludingType === undefined || (attacker.types ?? [])[0] !== cls.excludingType;",
    expectKilledBy: ["packages/engine/src/typedClassBlock.test.ts"],
  },
  {
    id: "D239-predicate-drops-the-stage-conjunct",
    decision: "D239",
    what: 'the stage half stops narrowing, so a Fire STAGE 1 is refused by a block that says "Basic non-{C}". Every other case in the new suite drives a BASIC, so a predicate that had quietly become "not Colorless" passes all of them — which is exactly why `fix-stage1-brawler` (type ✓, stage ✗) is in the deck',
    file: "packages/engine/src/continuous.ts",
    find: "  if (!attackerMatchesStage(attacker, cls.stage)) return false;",
    replace: "  if (false) return false;",
    expectKilledBy: [
      "packages/engine/src/typedClassBlock.test.ts",
      "packages/engine/src/classBlock.test.ts",
    ],
  },
  {
    id: "D239-merge-compares-records-by-reference",
    decision: "D239",
    what: '🛑 THE DEFECT THE RETYPE INTRODUCED, restored. `sameAttackerClass` becomes the `===` it replaced — exact while the field was a string literal, REFERENCE equality against two records. Two installs of the SAME printed class then "disagree" and collapse to an UNFILTERED block: strictly MORE protection than either printing says, the one direction this family\'s merge rule forbids, and invisible to every test that installs only once',
    file: "packages/engine/src/interpreter.ts",
    find: "    ? sameAttackerClass(existing.fromClass, fromClass)",
    replace: "    ? (existing.fromClass as unknown) === (fromClass as unknown)",
    expectKilledBy: ["packages/engine/src/typedClassBlock.test.ts"],
  },
  {
    id: "D239-log-row-quotes-the-stored-token",
    decision: "D239",
    what: "the rendered phrase drops the stage WORD and emits the stored token, so the row reads \"basic non-Colorless Pokémon's attacks\" in lower case. A pure caption defect — the board, the block and the damage are all correct — and the class this repo's log rows keep producing: the renderer is the only place the internal spelling and the printed spelling are allowed to differ",
    file: "packages/engine/src/log.ts",
    find: '    case "basic":\n      return "Basic";',
    replace: '    case "basic":\n      return "basic";',
    expectKilledBy: ["packages/engine/src/typedClassBlock.test.ts"],
  },
  {
    id: "D240-cap-anchor-loses-its-end-anchor",
    decision: "D240",
    what: 'the cap anchor drops its `$`, so "…if that damage is 40 or less. Draw a card." derives as the bare capped block and the second printed sentence is silently thrown away. The standing anchor defect, re-checked on a NEW anchor whose tail is a capture group followed by two literal words — exactly the shape an author retypes',
    file: "packages/engine/src/effects.ts",
    find: "  /^During your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks if that damage is (\\d+) or (less|more)\\.$/;",
    replace:
      "  /^During your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks if that damage is (\\d+) or (less|more)\\./;",
    expectKilledBy: ["packages/engine/src/damageCapBlock.test.ts"],
  },
  {
    id: "D240-cap-anchor-captures-greedily",
    decision: "D240",
    what: '🛑 THE DIGIT CLASS BECOMES A GREEDY `(.+)`, AND THIS ONE SURVIVED ITS FIRST RUN FOR THE SECOND SLICE RUNNING — the row\'s original kill argument was WRONG and is kept here as the finding. `Number("forty")` is `NaN` and `NaN >= 1` is FALSE, so every obvious probe (a word, a doubled clause) is EQUIVALENT under the greedy read: the `>= 1` guard quietly does the character class\'s job. What actually separates them is that `Number` is a far wider parser than `\\d+` — it reads EXPONENTS, HEX and DECIMALS — so a greedy anchor installs a 40-cap off "4e1", a 40-cap off "0x28" and a FRACTIONAL cap off "4.5". D239 found the same shape one anchor over and the guarded input class was the PROTOTYPE; here it is the NUMBER GRAMMAR. Before declaring a survivor equivalent, look for the input class the argument assumes away',
    file: "packages/engine/src/effects.ts",
    find: "attacks if that damage is (\\d+) or (less|more)\\.$/;",
    replace: "attacks if that damage is (.+) or (less|more)\\.$/;",
    expectKilledBy: ["packages/engine/src/damageCapBlock.test.ts"],
  },
  {
    id: "D240-comparator-guard-dropped",
    decision: "D240",
    what: '🛑 THE POLARITY MUTANT, AND THE ONE THIS ARM EXISTS FOR. The captured comparator stops being checked, so "…if that damage is 200 or MORE" installs a 200-CAP — the card inverted end to end, protecting against everything small and nothing large. The pool prints that exact sentence (Munkidori sv07-044), so this is not a hypothetical; and an author who spelled `or less` into the anchor\'s literal text would be correct today and wrong the day the two are folded together',
    file: "packages/engine/src/effects.ts",
    find: '  if (match !== null && match[2] === "less") {',
    replace: "  if (match !== null) {",
    expectKilledBy: ["packages/engine/src/damageCapBlock.test.ts"],
  },
  {
    id: "D240-cap-compared-before-the-reduction",
    decision: "D240",
    what: "🛑 THE RULES MUTANT — the OTHER defensible reading of §8.5, installed. `attackBlockOf` is handed the post-W/R total instead of the post-reduction one at the main hit, so a 70-damage attack into a −30 Ability and a 40-cap lands 40 where D240 says it lands 0. It is deliberately the reading this slice ARGUED AGAINST rather than a nonsense one: if a future ruling settles the question the other way, this mutant is the fix and `damageCapBlock.test.ts`'s flagged case is the one line that moves",
    file: "packages/engine/src/attack.ts",
    find: "          attackBlockOf(next, defender, attacker, wouldDeal) !== null)) ||",
    replace: "          attackBlockOf(next, defender, attacker, afterWR) !== null)) ||",
    expectKilledBy: ["packages/engine/src/damageCapBlock.test.ts"],
  },
  {
    id: "D240-cap-boundary-becomes-exclusive",
    decision: "D240",
    what: '`damage <= block.maxDamage` becomes `<`, so an attack landing EXACTLY on the printed cap is no longer prevented. The printed words are "or less" and both real amounts (40, 60) are round numbers every deck can hit exactly, so this is the off-by-one that costs a real game — and it passes every case in the suite that is not sitting on the boundary',
    file: "packages/engine/src/continuous.ts",
    find: "  if (block.maxDamage !== undefined && !(damage !== undefined && damage <= block.maxDamage)) {",
    replace:
      "  if (block.maxDamage !== undefined && !(damage !== undefined && damage < block.maxDamage)) {",
    expectKilledBy: ["packages/engine/src/damageCapBlock.test.ts"],
  },
  {
    id: "D240-unknown-damage-passes-a-capped-block",
    decision: "D240",
    what: "an UNREADABLE damage amount stops failing a capped block, so `attackEffectRefused` — the one site that passes `undefined` on purpose — would let a capped block refuse an EFFECT it says nothing about. The conservative direction inverted: this arm is the cap's twin of D146's unresolvable-ATTACKER arm, and both must protect LESS rather than more",
    file: "packages/engine/src/continuous.ts",
    find: "!(damage !== undefined && damage <= block.maxDamage)",
    replace: "!(damage === undefined || damage <= block.maxDamage)",
    expectKilledBy: ["packages/engine/src/damageCapBlock.test.ts"],
  },
  {
    id: "D240-merge-keeps-a-disagreeing-cap",
    decision: "D240",
    what: "two installs that disagree on the cap keep the INCOMING one instead of collapsing to uncapped, so a 60-cap already on the board plus a 40-cap install leaves the holder with LESS protection than one of the two printings gave — the one direction this family's merge rule forbids, stated once for `effects`, once for `fromClass` and now once for `maxDamage`. Unreachable off any printing and guarded by surgery, D144's rule",
    file: "packages/engine/src/interpreter.ts",
    find: "  const mergedMax = stacking\n    ? existing.maxDamage === maxDamage\n      ? maxDamage\n      : undefined\n    : maxDamage;",
    replace: "  const mergedMax = maxDamage;",
    expectKilledBy: ["packages/engine/src/damageCapBlock.test.ts"],
  },
  {
    id: "D240-log-row-drops-the-amount",
    decision: "D240",
    what: 'the trailing clause is dropped, so a capped block renders as the unrestricted one and a player reading "is protected from damage from attacks" watches a 90-damage attack land in full next turn. A pure caption defect — the board and the arithmetic are correct — and the sharper version of the gap `fromClass` already had a row for',
    file: "packages/engine/src/log.ts",
    find: '            (event.maxDamage === undefined ? "" : `, if that damage is ${event.maxDamage} or less`),',
    replace: '            "",',
    expectKilledBy: ["packages/engine/src/damageCapBlock.test.ts"],
  },
  // 🛑🛑 D241 — SIX ROWS ABOVE THIS LINE WERE RE-TRANSCRIBED, AND THE CAUSE IS A
  // RULE THIS FILE NOW OWNS. D241 ran `biome format --write` over `effects.ts`,
  // `interpreter.ts` and `log.ts`, which re-wrapped code SIX PRE-EXISTING ROWS
  // pointed at (`D228-gated-arm-loses-its-gate`, both D230 rows,
  // `D232-random-discard-anchor-drops-the-apostrophe-class`,
  // `D237-bench-clamp-dropped-at-the-move`, `D240-merge-keeps-a-disagreeing-cap`).
  // Every one reported ERROR — *"`find` no longer occurs … the code moved"* — and
  // NONE of them showed up in `bun run check`, in `git diff`, or in a
  // `--decision D241` run. **A `find` string is a dependency on SOURCE FORMATTING,
  // so any formatter pass over a target file is a `mutants.ts` migration.**
  //
  // ⚠️ THE PROCEDURE, since the failure is silent by construction: after ANY
  // format/refactor touching a target file, run the FULL corpus (D228's rule,
  // which is exactly what caught this) — `--decision` cannot see a sibling row it
  // does not run. The cheap pre-check is that every `find` must occur EXACTLY
  // ONCE in its file; zero is a moved row and two is an ambiguous one.
  //
  // ── D241 — LOOK AT THE TOP N (backlog row 11), and the `DECK_TOP_REVEALED`
  // fidelity debt settled. Eight rows: the two REGEX-width mutants D240's
  // survivor bought, the destination routing, the bench clamp, the two halves of
  // the empty-look announcement, its mirror, and the log's destination render.
  {
    id: "D241-look-window-capture-goes-greedy",
    decision: "D241",
    what: '🛑 D240\'s SURVIVING MUTANT, RE-INSTALLED ON THE NEW CAPTURE. The deck-top window stops being `\\d+`, so `Number` reads a grammar no card prints — "the top 0x14 cards" sizes a 20-card window and "the top 4.5 cards" makes `deck.slice(0, 4.5)` a silent truncation. Any capture that feeds `Number` owes a `\\d+` and a case that proves it; this is that case',
    file: "packages/engine/src/effects.ts",
    find: "  /^Look at the top (\\d+) cards of your deck\\. You may put any number of Pok\u00e9mon you find there onto your Bench\\. Shuffle the other cards back into your deck\\.$/;",
    replace:
      "  /^Look at the top (.+) cards of your deck\\. You may put any number of Pok\u00e9mon you find there onto your Bench\\. Shuffle the other cards back into your deck\\.$/;",
    expectKilledBy: ["packages/engine/src/derivedLookAtTop.test.ts"],
  },
  {
    id: "D241-attach-window-drops-the-terminal-anchor",
    decision: "D241",
    what: "D234's dropped-`$` mutant on the attach anchor. The sentence is literal to its last byte, so nothing but the terminal anchor refuses a TRAILING printed clause — a build without it derives a program for a sentence whose second half it never read, which is the silent half-execution this whole family's near-miss cases exist for",
    file: "packages/engine/src/effects.ts",
    find: "  /^Look at the top (\\d+) cards of your deck and attach any number of Energy cards you find there to your Pok\u00e9mon in any way you like\\. Shuffle the other cards back into your deck\\.$/;",
    replace:
      "  /^Look at the top (\\d+) cards of your deck and attach any number of Energy cards you find there to your Pok\u00e9mon in any way you like\\. Shuffle the other cards back into your deck\\./;",
    expectKilledBy: ["packages/engine/src/derivedLookAtTop.test.ts"],
  },
  {
    id: "D241-look-destination-ignored-at-the-move",
    decision: "D241",
    what: "🛑 THE OP FIELD GOES UNREAD AT THE MOVER. `revealFromTop` routes everything to the HAND again, so Reuniclus's four printings put Pok\u00e9mon in hand instead of into play and Rockruff's three draw the card they were supposed to discard. The park's caption and the log row would still say the right thing, which is exactly why the assertion has to be about the ZONE",
    file: "packages/engine/src/interpreter.ts",
    find: '    op.dest === "bench"\n      ? {\n          ...side,\n          deck,\n          bench: [...side.bench, ...moved.map((uid) => makeInPlay(uid, state.turn))],\n        }\n      : op.dest === "discard"\n        ? { ...side, deck, discard: [...side.discard, ...moved] }\n        : { ...side, deck, hand: [...side.hand, ...moved] };',
    replace: "    { ...side, deck, hand: [...side.hand, ...moved] };",
    expectKilledBy: ["packages/engine/src/derivedLookAtTop.test.ts"],
  },
  {
    id: "D241-bench-clamp-dropped",
    decision: "D241",
    what: "the bench-space clamp goes, so four eligible Pok\u00e9mon into one free slot removes four cards from the deck and lands one \u2014 three destroyed outright. `searchMove`'s stated rule (the set removed must equal the set that lands) inverted, on the op that reaches the Bench from a NEW source zone",
    file: "packages/engine/src/interpreter.ts",
    find: '  const moved = op.dest === "bench" ? inDeck.slice(0, benchSpace(state, ctx.seat)) : inDeck;',
    replace: "  const moved = inDeck;",
    expectKilledBy: ["packages/engine/src/derivedLookAtTop.test.ts"],
  },
  {
    id: "D241-the-other-reading-only-announce-a-move",
    decision: "D241",
    what: "🛑🛑 THE RULES MUTANT \u2014 the OTHER reading of the visibility question, installed. `DECK_TOP_REVEALED` fires only when cards actually moved, which is exactly what shipped before this slice: the DECLINE goes silent again and a player who looks at their top card and keeps it leaves no trace the opponent can read. Deliberately the reading D241 argued AGAINST rather than a nonsense one \u2014 if a ruling settles it the other way, this mutant is the fix and two named cases are the lines that move",
    file: "packages/engine/src/interpreter.ts",
    find: "  pushDeckTopLook(op, moved, ctx, events);\n  if (moved.length === 0) return state;",
    replace: "  if (moved.length === 0) return state;\n  pushDeckTopLook(op, moved, ctx, events);",
    expectKilledBy: [
      "packages/engine/src/derivedLookAtTop.test.ts",
      "packages/engine/src/lookAtTopN.test.ts",
    ],
  },
  {
    id: "D241-whiff-look-goes-unannounced",
    decision: "D241",
    what: "the SAME reading at the other of its two sites: a window with no match returns silently, so Great Ball into a top 7 of pure Energy tells the opponent nothing at all. Two sites, one claim \u2014 and a build that fixed only one of them is the partial revert this pair exists to catch",
    file: "packages/engine/src/interpreter.ts",
    find: "        if (top.length > 0) pushDeckTopLook(op, [], ctx, events);",
    replace: "        void top;",
    expectKilledBy: ["packages/engine/src/lookAtTopN.test.ts"],
  },
  {
    id: "D241-empty-deck-announces-a-look-nobody-took",
    decision: "D241",
    what: "the MIRROR defect, and the reason the guard reads `top.length` rather than `op.n`: an empty deck now emits a row saying its owner looked at a top that does not exist. A log that invents an event is worse than one that omits it, so the fidelity fix owes a case in BOTH directions",
    file: "packages/engine/src/interpreter.ts",
    find: "        if (top.length > 0) pushDeckTopLook(op, [], ctx, events);",
    replace: "        pushDeckTopLook(op, [], ctx, events);",
    expectKilledBy: ["packages/engine/src/lookAtTopN.test.ts"],
  },
  {
    id: "D241-log-row-hardcodes-in-hand",
    decision: "D241",
    what: 'D237\'s `DISCARD_RETRIEVED` defect one op over, installed here: the row asserts "in hand" whatever the destination, so three Pok\u00e9mon entering play read as three cards put in hand while the board shows them on the Bench. A pure caption defect \u2014 the zones are correct \u2014 and the reason the destination had to ride the event at all',
    file: "packages/engine/src/log.ts",
    find: '        event.dest === "bench"\n          ? "onto their Bench"\n          : event.dest === "discard"\n            ? "in the discard pile"\n            : "in hand";',
    replace: '        "in hand";',
    expectKilledBy: ["packages/engine/src/derivedLookAtTop.test.ts"],
  },
  // ── D242 — BACKLOG ROW 14: the always-on ATTACK GATE and the reprint groups.
  // Six rows: the `unless` polarity, the FLOOR, the Active spot, the §9 channel,
  // and the two payability mirrors. ⚠️ NOTE THE SHAPE OF THIS SET — five of the six
  // are about a READING rather than an arithmetic slip, because the field's whole
  // risk is that every wrong version of it still greys SOMETHING.
  {
    id: "D242-unless-polarity-inverted",
    decision: "D242",
    what: "🛑🛑 THE ONE-CHARACTER MUTANT THIS FIELD'S NAME EXISTS TO PREVENT. `cantAttackUnless` stores the PERMISSION and the reader negates it; drop the `!` and the card reads \"this Pokémon can't attack WHILE you have 4 or more Team Rocket's Pokémon in play\" — the exact opposite card, and a build that still greys rows on every board a careless test would look at",
    file: "packages/engine/src/interpreter.ts",
    find: "  return passivesOf(state, pokemon).cantAttackUnless.find(\n    (cond) => !conditionHolds(state, seat, cond),\n  );",
    replace:
      "  return passivesOf(state, pokemon).cantAttackUnless.find((cond) =>\n    conditionHolds(state, seat, cond),\n  );",
    expectKilledBy: ["packages/engine/src/abilityAttackGate.test.ts"],
  },
  {
    id: "D242-floor-becomes-an-exact-count",
    decision: "D242",
    what: 'the printed "4 OR MORE" becomes exactly 4, which is `opponentPrizesRemaining`\'s reading ("exactly 1 or 2 Prize cards") installed on a member that is a THRESHOLD. Passes every case at the boundary and silently re-bars the player the moment they bench a FIFTH Team Rocket\'s Pokémon — i.e. the reward for building the deck the card is printed for',
    file: "packages/engine/src/interpreter.ts",
    find: "      return countOwnerPokemonInPlay(state, seat, cond.owner) >= cond.count;",
    replace: "      return countOwnerPokemonInPlay(state, seat, cond.owner) === cond.count;",
    expectKilledBy: ["packages/engine/src/abilityAttackGate.test.ts"],
  },
  {
    id: "D242-count-skips-the-active-spot",
    decision: "D242",
    what: '"in play" narrows to the Bench, so the gate holder stops counting ITSELF and the printed floor of 4 silently becomes 5. The subtlest of the six: every near miss in the prefix table still answers correctly, the condition still evaluates, and the card is simply one Bench slot harder to switch on than it prints',
    file: "packages/engine/src/interpreter.ts",
    find: "  return [side.active, ...side.bench].filter((body) => {",
    replace: "  return [...side.bench].filter((body) => {",
    expectKilledBy: ["packages/engine/src/abilityAttackGate.test.ts"],
  },
  {
    id: "D242-gate-read-off-the-catalog-past-the-ability-lock",
    decision: "D242",
    what: '🛑🛑 THE CHANNEL MUTANT, AND THE ONE THE WHOLE `passivesOf` ARGUMENT IS FOR. The reader goes straight to `programFor(top.id)` instead of the §9-SUPPRESSED fold, so Klefki `sv01-096` "Mischievous Lock" no longer silences Power Saver and a Team Rocket\'s Mewtwo under an Ability lock stays barred by an Ability that is not running. Shorter, obvious, and wrong — exactly the build a slice that had priced the TOKEN rather than the CHANNEL would have shipped',
    file: "packages/engine/src/interpreter.ts",
    find: "  return passivesOf(state, pokemon).cantAttackUnless.find(\n    (cond) => !conditionHolds(state, seat, cond),\n  );",
    replace:
      '  const printed = programFor(topCardOf(state, pokemon)?.id ?? "")?.passive?.cantAttackUnless;\n  return printed !== undefined && !conditionHolds(state, seat, printed) ? printed : undefined;',
    expectKilledBy: ["packages/engine/src/abilityAttackGate.test.ts"],
  },
  {
    id: "D242-wire-projection-offers-the-barred-button",
    decision: "D242",
    what: "the ONLINE payability mirror drops the gate, so `redactedAttacksOf` ships `playable: true` on rows the §8 gate refuses with ATTACK_PREVENTED. D157's live soft-lock shape exactly: nothing throws, the client renders a button, the server says no, and the only surface that could have told the player why is this one",
    file: "packages/engine/src/redact.ts",
    find: "    attackLocked(state, active) ||\n    attackBarredByAbility(state, viewerSeat, active) !== undefined;",
    replace: "    attackLocked(state, active);",
    expectKilledBy: ["packages/engine/src/abilityAttackGate.test.ts"],
  },
  {
    id: "D242-hot-seat-panel-offers-the-barred-button",
    decision: "D242",
    what: "the SAME defect on the HOT-SEAT surface, which is the whole of P3 play and has no wire between it and the state. Two mirrors, one claim — and a build that fixed only one of them is the partial revert this pair exists to catch (D241's two-site rule)",
    file: "src/features/game/GameHud.tsx",
    find: "              attackLockedNow ||\n              abilityGateUnmet ||",
    replace: "              attackLockedNow ||",
    expectKilledBy: ["src/features/game/GameHud.abilityGate.dom.test.tsx"],
  },
  // ── D243 — ROW 14-B(b): the SEAT-WIDE PRE-W/R DAMAGE AURA. Six rows, and the
  // shape of the set is the point: FIVE of the six leave a live, plausible aura
  // standing and change only WHOSE body it reads or HOW MUCH it pays — which is
  // this mechanism's whole risk, because every wrong version of it still adds
  // damage to something. Each is a neighbouring scan's REAL code copied verbatim.
  {
    id: "D243-aura-reads-the-active-spot-only",
    decision: "D243",
    what: "\ud83d\udea9 THE DEFECT THE FIELD EXISTS TO PREVENT, arriving from the source side instead of the beneficiary side. The scan narrows to the Active Spot, so a Serperior ex sitting on the Bench — which is the ONLY place a Stage 2 support body ever sits — stops granting its aura, and the card pays out on exactly the board it is never played for. Every self-inclusive case still passes",
    file: "packages/engine/src/continuous.ts",
    find: "  const holders = side.active === null ? side.bench : [side.active, ...side.bench];\n  let total = 0;\n  // The `noStack` ledger: printed Ability name \u2192 the largest single contribution",
    replace:
      "  const holders = side.active === null ? [] : [side.active];\n  let total = 0;\n  // The `noStack` ledger: printed Ability name \u2192 the largest single contribution",
    expectKilledBy: ["packages/engine/src/seatDamageAura.test.ts"],
  },
  {
    id: "D243-aura-survives-the-ability-lock",
    decision: "D243",
    what: "\ud83d\udea9\ud83d\udea9 THE CHANNEL MUTANT, D242's `gate-read-off-the-catalog-past-the-ability-lock` installed one field over and on the other sign. All seven printings are printed Pokémon ABILITIES, so a §9 lock must silence them; drop the `disabledAbilityUids` line and Klefki `sv01-096` leaves the aura running — the shorter, obvious build a slice that priced the TOKEN rather than the CHANNEL would have shipped",
    file: "packages/engine/src/continuous.ts",
    find: "    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9\n    // The BENEFICIARY clause, on the attacker and on nothing else.",
    replace:
      "    void sourceUid;\n    // The BENEFICIARY clause, on the attacker and on nothing else.",
    expectKilledBy: ["packages/engine/src/seatDamageAura.test.ts"],
  },
  {
    id: "D243-beneficiary-filters-the-source-not-the-attacker",
    decision: "D243",
    what: "\ud83d\udea9 THE READING MUTANT, AND THE ONE NO LEGAL BOARD SEPARATES BY ITSELF. \"Attacks used by your Cynthia's Pokémon\" narrows WHOSE ATTACKS get the bonus; this applies the filter to the body PRINTING the Ability instead. On all four owner-prefixed printings the source IS in the subgroup, so every single-source board agrees — the separating case is a BARE aura standing beside a prefixed one, where this build drops the Serperior's 20 because a Serperior is not a Cynthia's Pokémon",
    file: "packages/engine/src/continuous.ts",
    find: "    if (aura.beneficiary !== undefined && !matchesFilter(attackerCard, aura.beneficiary)) continue;",
    replace:
      "    if (aura.beneficiary !== undefined && !matchesFilter(top, aura.beneficiary)) continue;",
    expectKilledBy: ["packages/engine/src/seatDamageAura.test.ts"],
  },
  {
    id: "D243-nostack-clause-ignored",
    decision: "D243",
    what: "the printed \"The effect of Extra Helpings doesn't stack.\" is dropped and the capped sources join the summing majority — the neighbouring branch's REAL code, three lines up, copied verbatim. Two Hop's Snorlax then pay 60 where the card prints 30, and every board with ONE source of each aura is byte-identical",
    file: "packages/engine/src/continuous.ts",
    // 🆕 RE-ANCHORED AT D321, AND IT IS D319's LESSON ARRIVING FROM THE OTHER
    // SIDE: this row's `find` was a bare one-liner and stayed unique only until
    // somebody wrote the same statement. `seatDamageReduction` gained a `capped`
    // ledger copied from this very function, one indentation level deeper — so
    // the 4-space anchor matched the 6-space line as a SUBSTRING and `precheck`
    // reported 2×. NARROWED (never widened) with the closing brace above it,
    // which the deeper copy cannot match.
    find: "    }\n    capped.set(aura.noStack, Math.max(capped.get(aura.noStack) ?? 0, aura.amount));",
    replace: "    }\n    total += aura.amount;",
    expectKilledBy: ["packages/engine/src/seatDamageAura.test.ts"],
  },
  {
    id: "D243-read-site-passes-the-defender",
    decision: "D243",
    what: "\ud83d\udea9 THE CALL-SITE MUTANT AN AUTHOR WOULD ACTUALLY MAKE, because `defenderCard` is the OTHER card already in scope at this line and `damageBonusBeforeWRIfTarget` two lines up legitimately reads it. The beneficiary filter then asks whether the body being HIT is a Cynthia's Pokémon — a coherent-sounding sentence that no printing says — while every bare aura keeps paying, so the whole Serperior half of the suite stays green",
    file: "packages/engine/src/interpreter.ts",
    find: "  return bonus + seatPreWRDamageBonus(state, seat, topCardOf(state, pokemon), defenderCard);",
    replace: "  return bonus + seatPreWRDamageBonus(state, seat, defenderCard, defenderCard);",
    expectKilledBy: ["packages/engine/src/seatDamageAura.test.ts"],
  },
  {
    id: "D243-scan-summed-at-one-site-only",
    decision: "D243",
    what: "the aura is dropped from the shared pre-W/R fold entirely — the state of the tree the instant before the read site was wired, and the one mutant here that is arithmetic rather than a reading. It is included because the ENTIRE observable behaviour of this slice depends on one `+` in one function: `attack.ts`'s main hit and `snipeActive` both take a ZERO diff, so nothing else in the engine would have gone red",
    file: "packages/engine/src/interpreter.ts",
    find: "  return bonus + seatPreWRDamageBonus(state, seat, topCardOf(state, pokemon), defenderCard);",
    replace: "  return bonus;",
    expectKilledBy: ["packages/engine/src/seatDamageAura.test.ts"],
  },
  // ── D244 — ROW 14-R: the ON-BENCH SWITCH (`switchActive.fromSource` +
  // `moveEnergy.othersToSelf`). Seven rows, and the shape of the set is the point:
  // FIVE of the seven leave a live, plausible switch-and-move standing and change
  // only WHICH BODY it names or HOW MUCH it may take — which is this mechanism's
  // whole risk, because every wrong version of it still switches something and
  // still moves Energy somewhere. Each is a neighbouring route's REAL code.
  {
    id: "D244-switch-parks-on-any-benched-body",
    decision: "D244",
    what: '\ud83d\udea9 THE DEFECT `fromSource` EXISTS TO PREVENT, and the exact build the row\'s own `needs` string said was missing. The printed PRONOUN ("switch **it** with your Active Pok\u00e9mon") becomes a free pick over the whole Bench \u2014 the pre-D244 behaviour of this op, copied verbatim from the arm four lines down. Iron Leaves then offers a prompt where the card offers no choice, and on a board with one other benched body it promotes the WRONG Pok\u00e9mon',
    file: "packages/engine/src/interpreter.ts",
    find: '    return sourceRef(state, { seat, sourceUid }).filter((ref) => ref.spot.spot === "bench");',
    replace: "    return ownBenchRefs(state, seat);",
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-fromSource-admits-the-active-spot",
    decision: "D244",
    what: "the BENCH narrowing goes and `sourceRef`'s answer is taken whole. Every Iron Leaves case stays green (its trigger only ever fires on a benched body), and Meowscarada `sv09-018`'s printed \"if this Pok\u00e9mon is on your Bench\" silently stops being enforced \u2014 an ACTIVE Meowscarada is offered a switch with ITSELF, which `switchInto` then resolves as a no-op that burns the once-per-turn stamp",
    file: "packages/engine/src/interpreter.ts",
    find: '    return sourceRef(state, { seat, sourceUid }).filter((ref) => ref.spot.spot === "bench");',
    replace: "    return sourceRef(state, { seat, sourceUid });",
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-switch-gate-cannot-see-the-source",
    decision: "D244",
    what: "\ud83d\udea9 D222's AFFORD-THEN-REJECT AT A SECOND OP. `programPlayable` stops threading the uid, so the switch gate answers about the whole Bench instead of about THIS body \u2014 the state of this line the instant before D244. The TRIGGER cannot catch it (a trigger never passes through this gate), so only Meowscarada's activated surface goes red, which is the entire reason that seventh printing is in this slice",
    file: "packages/engine/src/cardplay.ts",
    find: '    if (op.op === "switchActive" && switchActiveTargets(state, seat, op, sourceUid).length === 0) {',
    replace:
      '    if (op.op === "switchActive" && switchActiveTargets(state, seat, op).length === 0) {',
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-move-gate-cannot-see-the-source",
    decision: "D244",
    what: "the same drop on the OTHER gate the slice threaded. `moveEnergyPlayable` loses the uid, so `othersToSelf` resolves no destination and the gate answers `false` on every board \u2014 a card that is never playable rather than one that whiffs. It is the SAFE direction of the failure, which is exactly why it needs a mutant: nothing about the board looks wrong, the row simply never lights",
    file: "packages/engine/src/cardplay.ts",
    find: '    if (op.op === "moveEnergy" && !moveEnergyPlayable(state, seat, op, sourceUid)) {',
    replace: '    if (op.op === "moveEnergy" && !moveEnergyPlayable(state, seat, op)) {',
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-othersToSelf-is-benchToActive",
    decision: "D244",
    what: "\ud83d\udea9\ud83d\udea9 THE OTHER READING OF THE FLAGGED EQUIVALENCE, INSTALLED. On all SIX printed boards this is byte-identical to the real build \u2014 the tail runs behind the `recordGate`, so the source is always the Active by then and `benchToActive`'s endpoints coincide exactly. It can only be killed by the CONSTRUCTED board (`fix-othersmove`, a bare `othersToSelf` used from the Bench), which is the whole reason that fixture exists",
    file: "packages/engine/src/interpreter.ts",
    find: '      movable: attachedEnergies(state, seat, op.filter, "all").filter(\n        (entry) => refKeyOf(entry.from) !== refKeyOf(dest),\n      ),\n      destinations: [dest],',
    replace:
      '      movable: attachedEnergies(state, seat, op.filter, "bench"),\n      destinations: active === null ? [] : [{ seat, spot: { spot: "active" } }],',
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-any-amount-clamps-to-one",
    decision: "D244",
    what: 'the printed "any amount" becomes the family\'s default single Energy. The prompt still appears, the note still says "any amount", the card still works \u2014 it simply moves one Energy where the print moves the board, which is the quietest possible way to get this sentence wrong and the one no structural assertion would notice',
    file: "packages/engine/src/interpreter.ts",
    find: '  return op.max === "any" ? movable : op.max;',
    replace: '  return op.max === "any" ? 1 : op.max;',
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-ability-lock-misses-the-trigger",
    decision: "D244",
    what: "\ud83d\udea9 THE \u00a79 CHANNEL MUTANT FOR A **TRIGGER**, which D243's aura mutant covers only for a PASSIVE. Drop the one choke and Klefki `sv01-096` stops silencing every `onPlayToBench` / `onEvolve` / `betweenTurns` / `onDamagedByAttack` Ability in the pool \u2014 an Iron Leaves played under a full Ability lock still switches and still sweeps the board's Energy",
    file: "packages/engine/src/triggers.ts",
    find: "  if (uid !== undefined && disabledAbilityUids(state).has(uid)) return [];",
    replace: "  void uid;",
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  // ── D245 — ROW 14-B(b)-R: the aura family's three DEFERRED singles, plus the
  // fourth sentence the `stage` widening unlocks. NINE rows, and the shape of the
  // set is the point: every one of them leaves a live, plausible aura standing and
  // changes only WHO it pays or WHO it is paid for. A narrowing that is silently
  // too WIDE is this family's whole risk — the card still works, the number is
  // still printed on the log, and only a board carrying the excluded body can see
  // it. Six of the nine are that shape.
  {
    id: "D245-anyOf-is-an-intersection",
    decision: "D245",
    what: '\ud83d\udea9\ud83d\udea9 THE OTHER READING OF THE PRINTED CONJUNCTION, INSTALLED. "your {G} Pok\u00e9mon **and** {R} Pok\u00e9mon" read as an intersection rather than a union. It is the reading the English words invite, it compiles, and on the whole Standard-legal pool it makes Sunny Day pay NOBODY (no dual Grass/Fire body is printed) \u2014 a card that is silently inert rather than loud. Only a board with a {G}-only attacker beside the source can tell the two apart',
    file: "packages/engine/src/cards.ts",
    find: "      return filter.filters.some((inner) => matchesFilter(card, inner));",
    replace: "      return filter.filters.every((inner) => matchesFilter(card, inner));",
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  {
    id: "D245-anyOf-admits-everything",
    decision: "D245",
    what: "the combinator degenerates to `anyCard`: every arm is ignored and the filter admits any body. Sunny Day then pays a Colorless attacker the sentence never names, and every POSITIVE case in the suite stays green \u2014 which is why the Colorless control is asserted beside them",
    file: "packages/engine/src/cards.ts",
    find: "      return filter.filters.some((inner) => matchesFilter(card, inner));",
    replace: "      return filter.filters.length >= 0;",
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  {
    id: "D245-typed-stage-still-means-basic",
    decision: "D245",
    what: '\ud83d\udea9 THE STATE OF THIS LINE THE INSTANT BEFORE D245, AND THE DEFECT THE WIDENING EXISTS TO FIX. `typedPokemon.stage` goes back to answering "is it Basic?" for every value it holds, so `stage: "evolution"` becomes its own COMPLEMENT: Victory Cheer pays Basic {R} bodies and refuses Evolution ones, and Genesect\'s deck search offers Basic {M} Pok\u00e9mon for a sentence that says Evolution. Nothing throws, nothing logs, and the D238 suite \u2014 whose only stage witness is `"basic"` \u2014 stays entirely green',
    file: "packages/engine/src/cards.ts",
    // ⚠️ RE-TRANSCRIBED AT D275, NOT SKIPPED: that slice added the `maxHp` conjunct
    // and a block scope to this arm, so the old `find` stopped matching and
    // `precheck.ts` said so LOUDLY. The mutation is unchanged — the stage ternary
    // collapses back to `isBasicPokemon` — and the new conjunct rides along
    // untouched, which is what keeps this row about D245 and not about D275.
    find: '        (card.types ?? []).includes(filter.pokemonType) &&\n        (filter.stage === undefined ||\n          (filter.stage === "basic" ? isBasicPokemon(card) : evolveFromOf(card) !== null)) &&\n        (filter.maxHp === undefined || (typedHp !== null && typedHp <= filter.maxHp))\n      );\n    }\n    case "anyOf":',
    replace:
      '        (card.types ?? []).includes(filter.pokemonType) &&\n        (filter.stage === undefined || isBasicPokemon(card)) &&\n        (filter.maxHp === undefined || (typedHp !== null && typedHp <= filter.maxHp))\n      );\n    }\n    case "anyOf":',
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  {
    id: "D245-target-rider-never-narrows",
    decision: "D245",
    what: "the TARGET clause is dropped from the seat scan. Primal Knowledge's printed \"to your opponent's Active **Evolution** Pok\u00e9mon\" becomes \"to your opponent's Active Pok\u00e9mon\" \u2014 i.e. Serperior's sentence at 30 damage, a real card's text applied to the wrong card. Every `beneficiary` case in both aura suites stays green",
    file: "packages/engine/src/continuous.ts",
    find: "    if (aura.target !== undefined && !matchesFilter(defenderCard, aura.target)) continue;",
    replace: "    void aura.target;",
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  {
    id: "D245-target-rider-reads-the-attacker",
    decision: "D245",
    what: "\ud83d\udea9 THE CROSS-WIRE, and the mistake the two riders sitting on adjacent lines make available. `target` is matched against the ATTACKER's card instead of the defender's, so Primal Knowledge pays only when YOUR body is an Evolution \u2014 a coherent-sounding sentence no printing says. It is exactly `beneficiary`'s code with the wrong card in it",
    file: "packages/engine/src/continuous.ts",
    find: "    if (aura.target !== undefined && !matchesFilter(defenderCard, aura.target)) continue;",
    replace:
      "    if (aura.target !== undefined && !matchesFilter(attackerCard, aura.target)) continue;",
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  {
    id: "D245-read-site-withholds-the-defender",
    decision: "D245",
    what: "the call site stops threading the defender, so the new parameter defaults to `undefined` and the `target` rider fails CLOSED on every board. Primal Knowledge becomes a card that never fires \u2014 the SAFE direction, which is why it needs a mutant: no board looks wrong, the 30 simply never appears. `attackerPreWRBonus`'s signature does not change, so nothing else in the tree goes red",
    file: "packages/engine/src/interpreter.ts",
    find: "  return bonus + seatPreWRDamageBonus(state, seat, topCardOf(state, pokemon), defenderCard);",
    replace: "  return bonus + seatPreWRDamageBonus(state, seat, topCardOf(state, pokemon));",
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  {
    id: "D245-evolution-noun-reads-basic",
    decision: "D245",
    what: 'the DESCRIBER regresses: an "Evolution {M} Pok\u00e9mon" search captions itself "up to 2 Basic Metal Pok\u00e9mon", naming the exact COMPLEMENT of the set the prompt then offers. The engine resolves correctly and lies about it in the dialog heading \u2014 the read site the resume point said nobody prices, and the second slice running on which it owed something',
    file: "packages/engine/src/interpreter.ts",
    // ⚠️ RE-TRANSCRIBED AT D275 (the threshold suffix landed on this template).
    find: '      const noun = `${filter.stage === undefined ? "" : filter.stage === "basic" ? "Basic " : "Evolution "}${filter.pokemonType} Pok\u00e9mon${filter.maxHp === undefined ? "" : ` with ${filter.maxHp} HP or less`}`;',
    replace:
      '      const noun = `${filter.stage === undefined ? "" : "Basic "}${filter.pokemonType} Pok\u00e9mon${filter.maxHp === undefined ? "" : ` with ${filter.maxHp} HP or less`}`;',
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  {
    id: "D245-sunny-day-loses-an-arm",
    decision: "D245",
    what: 'the REGISTRY row keeps the combinator and drops one alternative, so Sunny Day pays {G} bodies and silently stops paying {R} ones. It is the transcription slip a two-arm disjunction invites, it needs no engine change to happen, and every structural assertion about `kind: "anyOf"` still passes',
    file: "packages/engine/src/registry.ts",
    find: '          { kind: "typedPokemon", pokemonType: "Grass" },\n          { kind: "typedPokemon", pokemonType: "Fire" },',
    replace: '          { kind: "typedPokemon", pokemonType: "Grass" },',
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  {
    id: "D245-metallic-signal-searches-basics",
    decision: "D245",
    what: "Genesect ex's deck search drops the stage word, so \"up to 2 **Evolution** {M} Pok\u00e9mon\" offers every {M} Pok\u00e9mon in the deck \u2014 strictly WIDER than the print, which is the direction a search filter is never allowed to be wrong in. It is the registry-side twin of the predicate mutant above, and it is the row that proves these three printings are driven by their own assertion rather than by the field's",
    file: "packages/engine/src/registry.ts",
    find: '          filter: { kind: "typedPokemon", pokemonType: "Metal", stage: "evolution" },',
    replace: '          filter: { kind: "typedPokemon", pokemonType: "Metal" },',
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  // ── D246 · the GATED attach and the BARE noun ──────────────────────────────
  // "10 mutants, 10 killed." ZERO new ops. The risk is in three places and every
  // row below sits on one of them: the §9.2 GATE (the clause neither backlog cell
  // priced), the BARE NOUN's one new op field, and the heal tail's two new axes.
  {
    id: "D246-gated-arm-drops-the-record-gate",
    decision: "D246",
    what: "🛑 THE MUTANT THIS SLICE EXISTS TO KILL. The gated arm splices the attach in beside the switch instead of behind the §9.2 gate, so an attacker with an EMPTY BENCH switches nothing and accelerates anyway — the printed 'If you do' becomes decoration. It attaches the right cards of the right type onto the right body on every board where the switch works, which is every board the two backlog cells imagined",
    file: "packages/engine/src/effects.ts",
    find: '      return [\n        { op: "switchActive", recordAs: "moved" },\n        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract\'s gated-step list, not a thenable (arrays are not callable).\n        { op: "recordGate", slot: "moved", then: program },\n      ];',
    replace: '      return [{ op: "switchActive", recordAs: "moved" }, ...program];',
    expectKilledBy: ["packages/engine/src/derivedGatedAttach.test.ts"],
  },
  {
    id: "D246-gated-arm-drops-the-recordAs",
    decision: "D246",
    what: "the other direction: the antecedent stops FILING, so `recordGateHolds` reads an empty slot on every board and the attach never runs at all. The card switches and gives nothing, ever — and the whole-program equality in `switchSeam.test.ts` is the only other place that can see it",
    file: "packages/engine/src/effects.ts",
    find: '        { op: "switchActive", recordAs: "moved" },\n        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract\'s gated-step list, not a thenable (arrays are not callable).\n        { op: "recordGate", slot: "moved", then: program },',
    replace:
      '        { op: "switchActive" },\n        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract\'s gated-step list, not a thenable (arrays are not callable).\n        { op: "recordGate", slot: "moved", then: program },',
    expectKilledBy: [
      "packages/engine/src/derivedGatedAttach.test.ts",
      "packages/engine/src/switchSeam.test.ts",
    ],
  },
  {
    id: "D246-bare-noun-never-reaches-the-op",
    decision: "D246",
    what: "the printed bare noun is PARSED and then thrown away, so 'an Energy card' derives the same program as 'a Basic Energy card' and a Special Energy stays out of reach. The board that kills it holds ONE card in the zone and it is the Special — on any hand with a Basic in it the two builds are identical",
    file: "packages/engine/src/effects.ts",
    find: "    ...(anyEnergy ? { anyEnergy: true as const } : {}),",
    replace: "    ...(anyEnergy ? {} : {}),",
    expectKilledBy: [
      "packages/engine/src/derivedGatedAttach.test.ts",
      "packages/engine/src/derivedHandAttach.test.ts",
      "packages/engine/src/derivedDiscardAttach.test.ts",
    ],
  },
  {
    id: "D246-bare-noun-fires-on-every-printing",
    decision: "D246",
    what: "the crossing in the other direction: every printing in the family gets `anyEnergy`, so 'a **Basic** Energy card' attaches a Special. Strictly WIDER than the print, which is the direction an attach filter is never allowed to be wrong in — and invisible on any board whose zone holds only Basics",
    file: "packages/engine/src/effects.ts",
    find: "  const anyEnergy = match[1] !== undefined;",
    replace: "  const anyEnergy = true;",
    expectKilledBy: [
      "packages/engine/src/derivedGatedAttach.test.ts",
      "packages/engine/src/derivedHandAttach.test.ts",
      "packages/engine/src/derivedDiscardAttach.test.ts",
    ],
  },
  {
    id: "D246-attachable-energies-ignores-the-bare-noun",
    decision: "D246",
    what: "the op carries the field and the HELPER ignores it, so every read site agrees with itself and none of them can see a Special Energy. This is the one-line version of 'the field exists and does nothing' — the program comparison assertions all pass and no card behaves differently from before the slice",
    file: "packages/engine/src/interpreter.ts",
    find: '      (anyEnergy || card.energyType === "Normal") &&',
    replace: '      card.energyType === "Normal" &&',
    expectKilledBy: ["packages/engine/src/derivedGatedAttach.test.ts"],
  },
  {
    id: "D246-attachable-energies-drops-the-basic-test",
    decision: "D246",
    what: "the widening becomes unconditional at the helper, so EVERY attach in the engine — six registry Abilities included — starts reaching Special Energy. The lift is meant to be per-op and printed; this makes it a rule of the game",
    file: "packages/engine/src/interpreter.ts",
    find: '      (anyEnergy || card.energyType === "Normal") &&',
    replace: "      (anyEnergy || true) &&",
    expectKilledBy: [
      "packages/engine/src/derivedGatedAttach.test.ts",
      "packages/engine/src/attachEnergyFrom.test.ts",
    ],
  },
  {
    id: "D246-play-gate-ignores-the-bare-noun",
    decision: "D246",
    what: "`programPlayable` asks the pre-D246 question, so a card whose printed 'an Energy card' is sitting in the hand as a Special is refused as unplayable — the gate and the apply disagree about the same board, which is D222's afford-then-reject wearing the other face",
    file: "packages/engine/src/cardplay.ts",
    find: "      (firstAttachableEnergy(state, seat, op.source, op.energyType, op.anyEnergy) === undefined ||",
    replace: "      (firstAttachableEnergy(state, seat, op.source, op.energyType) === undefined ||",
    expectKilledBy: ["packages/engine/src/derivedGatedAttach.test.ts"],
  },
  {
    id: "D246-heal-pronoun-goes-unchecked",
    decision: "D246",
    what: "🛑 the printed 'this Pokémon' and 'that Pokémon' become synonyms, so a heal tail on a BENCHED destination heals the body the player just chose while the card says the ATTACKER. Zero printings spell the crossed form today, which is exactly why it is a guard — and a build without it passes every 'was something healed' assertion in the repo",
    file: "packages/engine/src/effects.ts",
    find: '  if (heal !== undefined && heal.pronoun === "this" && destination.riders.toSelf !== true) {\n    return null;\n  }',
    replace: "  if (false) {\n    return null;\n  }",
    expectKilledBy: ["packages/engine/src/derivedHandAttach.test.ts"],
  },
  {
    id: "D246-heal-amount-collapses-to-all",
    decision: "D246",
    what: "the printed NUMBER is parsed and discarded, so Snorlax's 'heal 60 damage' clears the body outright. `healChosen` clamps either way, so nothing throws and nothing warns — the only observable is the damage left on a body carrying more than 60",
    file: "packages/engine/src/effects.ts",
    find: '        : { amount: match[7] === undefined ? "all" : Number(match[7]), pronoun: match[8] ?? "" },',
    replace: '        : { amount: "all", pronoun: match[8] ?? "" },',
    expectKilledBy: [
      "packages/engine/src/derivedGatedAttach.test.ts",
      "packages/engine/src/derivedHandAttach.test.ts",
    ],
  },
  {
    id: "D246-describer-drops-the-attach-clause",
    decision: "D246",
    what: "the new `describeBranch` arm refuses everything, so the switch's park announces the move and stays SILENT about the two Energy answering it buys — the engine resolves correctly and the dialog omits the entire reason to use the attack. The read site the resume point said nobody prices, and the third slice running on which it owed something",
    file: "packages/engine/src/interpreter.ts",
    find: "        if (op.toSelf !== true) return null;\n        parts.push(",
    replace: "        if (true) return null;\n        parts.push(",
    expectKilledBy: ["packages/engine/src/derivedGatedAttach.test.ts"],
  },
  {
    id: "D247-any-number-rehomes-the-printed-count",
    decision: "D247",
    what: "🛑 THE FLAGGED ASSUMPTION, INSTALLED AS ITS OWN COUNTER-READING: the arm's `You may ` opener becomes optional and its `any number of` becomes an alternation with `up to N`, so the two legal printings that spell a COUNT with 'in any way you like' (`sv08-079`/`-204`) are RE-HOMED onto the compound park instead of staying on D205's sequential N-ops model. Both readings resolve the cards; they differ in whether the player answers ONE compound question or N sequential ones, which no count assertion can see",
    file: "packages/engine/src/effects.ts",
    find: '  `^You may attach any number of Basic (?:\\\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\\\} )?Energy cards${HAND_SOURCE_ZONE_PHRASE} to ([^.]+)\\\\.$`,',
    replace:
      '  `^(?:You may )?attach (?:any number of|up to \\\\d+) Basic (?:\\\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\\\} )?Energy cards${HAND_SOURCE_ZONE_PHRASE} to ([^.]+)\\\\.$`,',
    expectKilledBy: [
      "packages/engine/src/derivedAnyNumberAttach.test.ts",
      "packages/engine/src/derivedHandAttach.test.ts",
    ],
  },
  {
    id: "D247-any-number-anchor-drops-the-terminal",
    decision: "D247",
    what: "the `$` goes and the destination class `[^.]` keeps the capture inside the sentence, so a printing carrying a TRAILING clause matches on its prefix and the clause is silently dropped. D234's dropped-`$` mutant, third inheritance — and it only dies because the class is narrow: a greedy `(.+)` would fail the destination lookup and hide the difference",
    file: "packages/engine/src/effects.ts",
    find: "Energy cards${HAND_SOURCE_ZONE_PHRASE} to ([^.]+)\\\\.$`,",
    replace: "Energy cards${HAND_SOURCE_ZONE_PHRASE} to ([^.]+)\\\\.`,",
    expectKilledBy: ["packages/engine/src/derivedAnyNumberAttach.test.ts"],
  },
  {
    id: "D247-any-number-reads-the-single-body-destinations",
    decision: "D247",
    what: "🛑 the `anyWay` test goes, so 'to this Pokémon' and 'to 1 of your Benched Pokémon' derive too — an UNBOUNDED batch pinned to ONE body, a shape no card prints and the compound park cannot ask about. The whole reason the shared destination table is safe to reuse on an op that builds a different program",
    file: "packages/engine/src/effects.ts",
    find: "    if (destination?.anyWay === true && Object.keys(destination.riders).length === 0) {",
    replace: "    if (destination !== undefined && Object.keys(destination.riders).length === 0) {",
    expectKilledBy: ["packages/engine/src/derivedAnyNumberAttach.test.ts"],
  },
  {
    id: "D247-any-number-swallows-a-rider-it-cannot-express",
    decision: "D247",
    what: "🛑 the rider guard goes, so 'your **Benched** Pokémon in any way you like' derives to an op with no `benchOnly` — the attach silently offers the ACTIVE. Strictly WIDER than the print, invisible to every 'how many landed' assertion, and the exact defect a build that only read `anyWay` would ship",
    file: "packages/engine/src/effects.ts",
    find: " && Object.keys(destination.riders).length === 0) {",
    replace: ") {",
    expectKilledBy: ["packages/engine/src/derivedAnyNumberAttach.test.ts"],
  },
  {
    id: "D247-any-number-drops-the-printed-basic",
    decision: "D247",
    what: "the printed adjective is discarded and the filter widens to `anyEnergy`, so a SPECIAL Energy in the hand becomes attachable. Invisible on every hand that holds only Basic Energy, which is every hand in the repo's other attach suites",
    file: "packages/engine/src/effects.ts",
    find: '                ? { kind: "basicEnergy" }\n                : { kind: "basicEnergy", energyType },',
    replace:
      '                ? { kind: "anyEnergy" }\n                : { kind: "basicEnergy", energyType },',
    expectKilledBy: ["packages/engine/src/derivedAnyNumberAttach.test.ts"],
  },
  {
    id: "D247-hand-offer-caps-at-one",
    decision: "D247",
    what: "🛑 the cap stops being the candidate set and becomes 1, so 'any number' attaches at most one card. The park still appears, the answer still validates, and every board with a one-card hand behaves identically — which is why the deck stocks THREE",
    file: "packages/engine/src/interpreter.ts",
    find: "  return { candidates, targets: attachEnergyTargets(state, seat, {}), max: candidates.length };",
    replace: "  return { candidates, targets: attachEnergyTargets(state, seat, {}), max: 1 };",
    expectKilledBy: ["packages/engine/src/derivedAnyNumberAttach.test.ts"],
  },
  {
    id: "D247-hand-offer-reads-the-deck",
    decision: "D247",
    what: "🛑 the ZONE of the offer flips from the hand to the deck, so the op accelerates off the top of the library and the printed 'from your hand' is a lie. The prompt still fills, the count still matches, and the only witness is WHICH physical cards were offered",
    file: "packages/engine/src/interpreter.ts",
    find: "  const candidates = state.players[seat].hand.filter((uid) =>\n    matchesFilter(cardOf(state, uid), op.filter),\n  );",
    replace:
      "  const candidates = state.players[seat].deck.filter((uid) =>\n    matchesFilter(cardOf(state, uid), op.filter),\n  );",
    expectKilledBy: ["packages/engine/src/derivedAnyNumberAttach.test.ts"],
  },
  {
    id: "D247-hand-apply-removes-from-the-wrong-zone",
    decision: "D247",
    what: "🛑 the widened mover's `zone` is ignored on the REMOVAL side, so the cards land on the board and stay in the hand as well — a card is DUPLICATED. This is the drift a second hand-written copy of `attachFromDeckApply` would have invited, and the reason the zone is a parameter",
    file: "packages/engine/src/interpreter.ts",
    find: "      [zone]: side[zone].filter((uid) => !attached.has(uid)),",
    replace: "      [zone]: side[zone],",
    expectKilledBy: [
      "packages/engine/src/derivedAnyNumberAttach.test.ts",
      "packages/engine/src/attachFromDeck.test.ts",
    ],
  },
  {
    id: "D247-hand-attach-parks-on-an-empty-board",
    decision: "D247",
    what: "the dead-end guard drops its TARGET half, so an op with candidates and nowhere to put them parks on a prompt with an empty `targets` list — a dialog the player cannot answer. Unreachable in a real match today (the controller always has an Active), which is exactly why it is a guard rather than a branch",
    file: "packages/engine/src/interpreter.ts",
    find: "      if (candidates.length === 0 || targets.length === 0 || max <= 0) return { done: state };",
    replace: "      if (candidates.length === 0) return { done: state };",
    expectKilledBy: ["packages/engine/src/derivedAnyNumberAttach.test.ts"],
  },
  {
    id: "D248-toEach-implies-bench",
    decision: "D248",
    what: "🛑 THE FLAGGED DESIGN CALL, INSTALLED AS ITS OWN COUNTER-READING: `toEach` forces `benchOnly` in the apply, i.e. the welded `toEachBench` field the handoff predicted instead of the two orthogonal fields that shipped. **Observationally IDENTICAL on every printing in the catalog**, because every sentence that prints this distribution also prints the word 'Benched' — so it can only die on the un-narrowed destination row, which is read for D180/D187's transfers-across-sets reason and driven through `runProgram` directly",
    file: "packages/engine/src/interpreter.ts",
    find: "          done: attachEnergyTargets(state, ctx.seat, op).reduce(",
    replace:
      "          done: attachEnergyTargets(state, ctx.seat, { ...op, benchOnly: true }).reduce(",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D248-spread-resolves-its-energy-once",
    decision: "D248",
    what: "🛑 the fold stops threading the EVOLVING state and re-enters the apply against the ORIGINAL one, so every body is fed off the same pile snapshot — the same Energy uid written onto N bodies. Attaches the right NUMBER of times, emits the right number of `ENERGY_ATTACHED` rows, and duplicates a card. The reason the suite asserts the fed uids are DISTINCT rather than just counting them",
    file: "packages/engine/src/interpreter.ts",
    find: "            (soFar, ref) => attachEnergyFrom(soFar, op, ref, ctx, events, record),",
    replace: "            (_soFar, ref) => attachEnergyFrom(state, op, ref, ctx, events, record),",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D248-spread-feeds-only-the-first-body",
    decision: "D248",
    what: "the fold takes the FIRST eligible target and stops, which is what a `toEach` implemented as a flag on `parkOrForce`'s forced path would silently do — 'each of' collapsing to 'the first of'. Passes every 'was something attached' assertion and every whiff case",
    file: "packages/engine/src/interpreter.ts",
    find: "          done: attachEnergyTargets(state, ctx.seat, op).reduce(",
    replace: "          done: attachEnergyTargets(state, ctx.seat, op).slice(0, 1).reduce(",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D248-spread-still-parks",
    decision: "D248",
    what: "the `toEach` fold goes entirely and the op falls through to `parkOrForce`, so the printed spread becomes a QUESTION — one body chosen out of the Bench. This is the pre-D248 behaviour wearing the new field, and it is the failure the resume point predicted as most likely: it attaches Energy, emits a row and asks something the card never asks",
    file: "packages/engine/src/interpreter.ts",
    find: "      if (op.toEach === true) {",
    replace: "      if (false as boolean) {",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D248-spread-destination-drops-the-bench-word",
    decision: "D248",
    what: "🛑 the printed 'each of your **Benched** Pokémon' loses its `benchOnly`, so the spread reaches the ACTIVE too — the ATTACKER feeds itself off a card that says it may not. Strictly WIDER than the print, and invisible to any assertion that only counts attachments",
    file: "packages/engine/src/effects.ts",
    find: '  ["each of your Benched Pokémon", { riders: { benchOnly: true }, anyWay: false, toEach: true }],',
    replace: '  ["each of your Benched Pokémon", { riders: {}, anyWay: false, toEach: true }],',
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D248-spread-destination-becomes-a-distribution",
    decision: "D248",
    what: "🛑 the spread row is re-homed onto `anyWay`, which is the OTHER member of the same axis and the reading a slice that never priced the park would ship: N separate ops, N parks, the player distributing the cards. At `count: 1` that is ONE op and ONE park — so it moves exactly the same Energy onto exactly one body and asks a question the card does not",
    file: "packages/engine/src/effects.ts",
    find: '  ["each of your Benched Pokémon", { riders: { benchOnly: true }, anyWay: false, toEach: true }],',
    replace: '  ["each of your Benched Pokémon", { riders: { benchOnly: true }, anyWay: true }],',
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D248-spread-admits-the-printed-count",
    decision: "D248",
    what: "the `count > 1` refusal goes, so 'attach up to N … to each of them' derives to N-per-body — one of the two readings that phrase can carry, picked silently. No card prints it, which is exactly why the deriver must pick NEITHER; the field stays readable at the op level for a registry program that means it",
    file: "packages/engine/src/effects.ts",
    find: "  if (destination.toEach === true && count > 1) return null;",
    replace: "  if (false as boolean) return null;",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D248-spread-admits-a-heal-tail",
    decision: "D248",
    what: "🛑 the heal refusal goes, so 'attach … to each of your Benched Pokémon. If you do, heal all damage from that Pokémon.' derives — and 'that Pokémon' has N referents, so the heal lands on whichever body the fold happened to finish on. `anyWay`'s own refusal one distribution over, and it needs no `count` clause because a spread does not degenerate at count 1",
    file: "packages/engine/src/effects.ts",
    find: "  if (destination.toEach === true && heal !== undefined) return null;",
    replace: "  if (false as boolean) return null;",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  // ── D249 · Ripening Charge — the parked heal-on-attach Ability ──────────────
  // "4 mutants, 4 killed." A registry-only slice, so every mutant lives in
  // `registry.ts` and each one is a value an author could plausibly have written:
  // the near-twin's field (`toSelf`), the field's OTHER authored value ("all"),
  // the neighbouring row's boolean (`oncePerTurn: false`) and the tail dropped
  // altogether. D221's pattern one row over, on the row D221's sentence pairs with.
  {
    id: "D249-self-target",
    decision: "D249",
    what: "🛑 the printed 'to 1 of your Pokémon' gains Teal Dance's `toSelf: true` — the NEAR-TWIN's real value, one row up in the same file and one clause apart in the print. The park disappears and Hydrapple ex can only ever feed itself, which is a strictly different card and passes every 'was Energy attached' assertion",
    file: "packages/engine/src/registry.ts",
    find:
      '          op: "attachEnergyFrom",\n          source: "hand",\n          energyType: "Grass",\n' +
      "          healTarget: 30,",
    replace:
      '          op: "attachEnergyFrom",\n          source: "hand",\n          energyType: "Grass",\n' +
      "          toSelf: true,\n          healTarget: 30,",
    expectKilledBy: ["packages/engine/src/ripeningCharge.test.ts"],
  },
  {
    id: "D249-heal-all",
    decision: "D249",
    what: "the printed 30 becomes `\"all\"` — the field's OTHER authored value, live on three attack printings, so this is a copy from a real row rather than an invented one. A body on 50 damage lands on 0 instead of 20, and every 'something was healed' assertion still passes",
    file: "packages/engine/src/registry.ts",
    find: "          healTarget: 30,",
    replace: '          healTarget: "all",',
    expectKilledBy: ["packages/engine/src/ripeningCharge.test.ts"],
  },
  {
    id: "D249-no-heal",
    decision: "D249",
    what: "the heal tail goes entirely, so the card does the attach and not the consequent — the exact half-built shape D190 refused to ship for Teal Dance, and the one a slice that priced this as 'just an attach' would produce",
    file: "packages/engine/src/registry.ts",
    find: "          healTarget: 30,\n",
    replace: "",
    expectKilledBy: ["packages/engine/src/ripeningCharge.test.ts"],
  },
  {
    id: "D249-repeatable",
    decision: "D249",
    what: "the printed 'Once during your turn' becomes Baxcalibur's 'As often as you like' — one word apart in the print, one boolean here, and the same mutant D221 wrote for the sentence this one pairs with",
    file: "packages/engine/src/registry.ts",
    find: '      name: "Ripening Charge",\n      oncePerTurn: true,',
    replace: '      name: "Ripening Charge",\n      oncePerTurn: false,',
    expectKilledBy: ["packages/engine/src/ripeningCharge.test.ts"],
  },
  // ── D250 · Battle-Hardened — the onPlayToBench triggered attach ─────────────
  // "5 mutants, 5 killed." A second registry-only slice running, so every mutant
  // lives in `registry.ts` and each one is a value an author could plausibly have
  // written: the destination dropped (the pre-D221 shape), the count dropped and
  // the count raised (the two ways to misread "up to 2"), the energy noun widened
  // to D246's boolean, and the timing swapped for the neighbouring member of the
  // same `TriggerTiming` union.
  //
  // ⚠️ THE `optional: true` FLAG HAS NO MUTANT AND THAT IS DELIBERATE — it
  // AUTO-FIRES (`TriggeredAbility.optional`'s own doc), so flipping it changes no
  // behaviour any board can see. A mutant with no observable is an unkillable
  // row, and the rule since D221 is that such a claim is carried by the
  // DECLARATION snapshot instead. `battleHardened.test.ts` says so in its own
  // guard list rather than leaving the absence to be rediscovered.
  {
    id: "D250-no-self-target",
    decision: "D250",
    what: "🛑 the printed 'to THIS Pokémon' loses `toSelf`, so the op falls back to `attachEnergyTargets` — every own body — and PARKS. It is the pre-D221 shape and the exact mistake `tealDance.test.ts` names as the one an author actually makes; on a board holding an Active plus the body just benched, the Energy can land on the wrong one",
    file: "packages/engine/src/registry.ts",
    find: '          energyType: "Fighting",\n          count: 2,\n          toSelf: true,',
    replace: '          energyType: "Fighting",\n          count: 2,',
    expectKilledBy: ["packages/engine/src/battleHardened.test.ts"],
  },
  {
    id: "D250-single-attach",
    decision: "D250",
    what: "the printed 'up to 2' loses `count`, so the op attaches ONE — the value every pre-D205 program meant, and a field whose absence D104's minimal-authoring rule makes invisible in a diff. Half the card, and every 'Energy was attached' assertion still passes",
    file: "packages/engine/src/registry.ts",
    find: '          energyType: "Fighting",\n          count: 2,\n          toSelf: true,',
    replace: '          energyType: "Fighting",\n          toSelf: true,',
    expectKilledBy: ["packages/engine/src/battleHardened.test.ts"],
  },
  {
    id: "D250-count-three",
    decision: "D250",
    what: "the printed 2 becomes 3 — the off-by-one an author writing from memory produces, and one the whiff and the min(count, available) cases cannot see (a hand holding 2 behaves identically). Only a hand holding THREE separates them",
    file: "packages/engine/src/registry.ts",
    find: '          energyType: "Fighting",\n          count: 2,',
    replace: '          energyType: "Fighting",\n          count: 3,',
    expectKilledBy: ["packages/engine/src/battleHardened.test.ts"],
  },
  {
    id: "D250-any-energy",
    decision: "D250",
    what: "the printed 'Basic {F} Energy' gains D246's `anyEnergy` boolean — a real field on this op, authored on two live printings, and the reading a slice that skimmed the noun would take. Colorless and Special Energy become attachable",
    file: "packages/engine/src/registry.ts",
    find: '          energyType: "Fighting",\n          count: 2,\n          toSelf: true,',
    replace:
      '          energyType: "Fighting",\n          anyEnergy: true,\n          count: 2,\n          toSelf: true,',
    expectKilledBy: ["packages/engine/src/battleHardened.test.ts"],
  },
  {
    id: "D250-on-evolve",
    decision: "D250",
    what: "the printed 'play this Pokémon … onto your Bench' becomes `onEvolve` — the neighbouring member of the same `TriggerTiming` union, authored two rows down in this very file (Hop's Dubwool 'Defiant Horn'). The card stops firing on the only event it names",
    file: "packages/engine/src/registry.ts",
    find: '      name: "Battle-Hardened",\n      trigger: "onPlayToBench",',
    replace: '      name: "Battle-Hardened",\n      trigger: "onEvolve",',
    expectKilledBy: ["packages/engine/src/battleHardened.test.ts"],
  },

  // ── D251 — the ATTACKER-HAS-AN-ABILITY PREVENT. "5 mutants, 5 killed." The
  // zero-engine-line streak ENDS here, so these are NOT all registry rows: one sits
  // on the `cards.ts` predicate, two on `attack.ts`'s gate, one on the read site
  // `interpreter.ts` owns, and one on the data row.
  //
  // ⚠️ THE SHARPEST TWO ARE THE SIDE MUTANT AND THE UNWIRED SITE.
  // `D251-defender-ability` reads the DEFENDER's abilities instead of the
  // attacker's — and the holder HAS an Ability, so on every board where the holder
  // is the only card that matters it looks correct and the card then prevents
  // damage from EVERYTHING. `D251-spread-site-unwired` wires ONE read site instead
  // of four, which is exactly the price the session handoff predicted (it said one
  // disjunct; the row's own `needs` string said four) — so it is the defect the
  // slice was most likely to actually ship.
  {
    id: "D251-defender-ability",
    decision: "D251",
    what: "🛑 the gate reads the DEFENDER's card instead of the ATTACKER's. The holder prints an Ability itself, so every board where only the attacker varies still passes — and the card then prevents damage from every attacker alive",
    file: "packages/engine/src/attack.ts",
    find: "(defenderPassives.preventDamageFromHasAbility && hasPrintedAbility(attacker))",
    replace:
      "(defenderPassives.preventDamageFromHasAbility && hasPrintedAbility(topCardOf(next, defender)))",
    expectKilledBy: ["packages/engine/src/cornerstoneStance.test.ts"],
  },
  {
    id: "D251-any-attacker",
    decision: "D251",
    what: "the ATTACKER PREDICATE is dropped, so the aura prevents all attack damage unconditionally — the shape an author who read only the first half of the sentence writes. Every POSITIVE case in the suite still passes; only the ex-with-no-Ability negative catches it",
    file: "packages/engine/src/attack.ts",
    find: "(defenderPassives.preventDamageFromHasAbility && hasPrintedAbility(attacker))",
    replace: "defenderPassives.preventDamageFromHasAbility",
    expectKilledBy: ["packages/engine/src/cornerstoneStance.test.ts"],
  },
  {
    id: "D251-predicate-off-by-one",
    decision: "D251",
    what: "`hasPrintedAbility` demands MORE THAN ONE printed Ability — the off-by-one a `length > 0` check invites, and one no type can catch. Every real printing of the gate's positive side carries exactly one Ability, so the whole prevention silently stops firing",
    file: "packages/engine/src/cards.ts",
    find: "  return (card?.abilities ?? []).length > 0;",
    replace: "  return (card?.abilities ?? []).length > 1;",
    expectKilledBy: ["packages/engine/src/cornerstoneStance.test.ts"],
  },
  {
    id: "D251-spread-site-unwired",
    decision: "D251",
    what: "🛑 the SPREAD read site is left unwired — ONE gate wired instead of four, which is the price the session handoff predicted and the row's own `needs` string refuted. The Active is protected and the same holder on the Bench is not, and every main-hit assertion in the suite still passes",
    file: "packages/engine/src/interpreter.ts",
    find: "      (passives.preventDamageFromHasAbility && hasPrintedAbility(attackerCard)) ||\n",
    replace: "",
    expectKilledBy: ["packages/engine/src/cornerstoneStance.test.ts"],
  },
  {
    id: "D251-is-exv-instead",
    decision: "D251",
    what: "the data row authors `preventDamageFromExV` — the NEIGHBOURING field, and the one a slice that widened instead of adding a third member would land on. The card then prevents damage from an ex with no Ability and lets a plain Ability-haver through: both halves of the separation inverted at once",
    file: "packages/engine/src/registry.ts",
    find: "const CORNERSTONE_STANCE: CardProgram = { passive: { preventDamageFromHasAbility: true } };",
    replace: "const CORNERSTONE_STANCE: CardProgram = { passive: { preventDamageFromExV: true } };",
    expectKilledBy: ["packages/engine/src/cornerstoneStance.test.ts"],
  },

  // ── D252 — "Mighty Shell", the ATTACKER-HAS-A-SPECIAL-ENERGY prevent on damage
  // AND EFFECTS (Carracosta sv10.5b-023/-107). FIVE mutants, one per NEW claim:
  // the board-vs-card side of the predicate, the attacker-vs-holder side, the
  // EFFECTS half's existence, the effects half's §9 answer, and the data row.
  //
  // ⚠️ THE SHARPEST TWO ARE THE EFFECTS-HALF PAIR. `D252-effects-unwired` deletes
  // the whole aura channel from `attackEffectRefused`, which leaves the card as
  // D251's NARROW spelling — every damage assertion in the suite still passes and
  // the printed sentence has quietly lost the clause it is longer for.
  // `D252-effects-off-top-card` reads the holder's catalog row instead of the fold,
  // which is correct on every board except one under a §9 lock — the exact shortcut
  // `passivesOf`'s doc has warned about for four slices and no earlier mutant has
  // ever driven on the EFFECT side.
  {
    id: "D252-holder-energy",
    decision: "D252",
    what: "🛑 the gate reads the HOLDER's attached Energy instead of the ATTACKER's. Carracosta is a Water Pokémon that will usually be carrying Energy of its own, so a board that only varies the attacker still passes and the card prevents damage from everything the moment it is powered up",
    file: "packages/engine/src/attack.ts",
    find: "(defenderPassives.preventDamageAndEffectsFromSpecialEnergy &&\n            attackerHasSpecialEnergy(next, active))",
    replace:
      "(defenderPassives.preventDamageAndEffectsFromSpecialEnergy &&\n            attackerHasSpecialEnergy(next, defender))",
    expectKilledBy: ["packages/engine/src/mightyShell.test.ts"],
  },
  {
    id: "D252-any-attacker",
    decision: "D252",
    what: "the ATTACKER PREDICATE is dropped, so the aura prevents all attack damage unconditionally — the shape an author who read only the first half of the sentence writes. Every POSITIVE case in the suite still passes; only the Basic-Energy negative catches it",
    file: "packages/engine/src/attack.ts",
    find: "(defenderPassives.preventDamageAndEffectsFromSpecialEnergy &&\n            attackerHasSpecialEnergy(next, active))",
    replace: "defenderPassives.preventDamageAndEffectsFromSpecialEnergy",
    expectKilledBy: ["packages/engine/src/mightyShell.test.ts"],
  },
  {
    id: "D252-effects-unwired",
    decision: "D252",
    what: "🛑 the EFFECTS half is deleted from `attackEffectRefused`, leaving the aura as D251's NARROW spelling. Every damage assertion in the suite still passes and the card silently stops refusing statuses, retreat locks and discards — the half the printed sentence is longer for",
    file: "packages/engine/src/interpreter.ts",
    // ⚠️ RE-ANCHORED AT D260 (and at D254 and D253 before it) — the FOURTH and
    // FIFTH channels joined the same expression, so the row's `find` has to grow
    // with it or the mutant silently stops applying. That is the whole reason
    // `precheck.ts` exists, and it is now the fourth consecutive slice on which it
    // has named this exact row in three seconds. RE-HOMED, NEVER DELETED: the CLAIM
    // is unchanged — deleting the aura channel leaves D251's narrow spelling.
    find: "  const auraRefuses =\n    (passivesOf(state, target).preventDamageAndEffectsFromSpecialEnergy &&\n      attackerHasSpecialEnergy(state, attackerTop?.active)) ||\n    passivesOf(state, target).preventDamageAndEffectsWhileBenched ||\n    passivesOf(state, target).preventAttackEffects ||\n    benchShieldedFromEffects(state, target) ||\n    groupShieldedFromAttackEffects(state, target);",
    replace: "  const auraRefuses = false;",
    expectKilledBy: ["packages/engine/src/mightyShell.test.ts"],
  },
  {
    id: "D252-effects-off-top-card",
    decision: "D252",
    what: "🛑 the EFFECTS half reads the holder's CATALOG ROW instead of the `passivesOf` fold. Correct on every board except one under a §9 Ability lock, where the damage half correctly stops and the effects half keeps refusing — one printed sentence answering two ways about the same lock",
    file: "packages/engine/src/interpreter.ts",
    find: "    (passivesOf(state, target).preventDamageAndEffectsFromSpecialEnergy &&",
    replace:
      '    (programFor(topUid(target) === undefined ? "" : (state.cardIdByUid[topUid(target) ?? ""] ?? ""))?.passive?.preventDamageAndEffectsFromSpecialEnergy === true &&',
    expectKilledBy: ["packages/engine/src/mightyShell.test.ts"],
  },
  {
    id: "D252-has-ability-instead",
    decision: "D252",
    what: "the data row authors `preventDamageFromHasAbility` — D251's NEIGHBOURING field, and the one a slice that widened instead of adding a fourth member would land on. The card then gates on the wrong attacker property AND loses the effects half in one edit, which is precisely the merge the field's doc argues against",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { preventDamageAndEffectsFromSpecialEnergy: true },",
    replace: "  passive: { preventDamageFromHasAbility: true },",
    expectKilledBy: ["packages/engine/src/mightyShell.test.ts"],
  },

  // ── D253 — "Curious Tea Party", the BENCH-GATED wide prevent (Poltchageist
  // sv06-020/-171, Sinistcha sv10-048). SIX mutants, one per NEW claim: the ZONE
  // GATE's existence, its DIRECTION, the predicate's IDENTITY rule, the two LIVE
  // read sites, and the data row.
  //
  // ⚠️ NO MUTANT IS AUTHORED AT THE THREE DEAD READ SITES (attack.ts's main hit,
  // `snipeActive`, `attackEffectRefused`). §8 aims an attack at an ACTIVE, so the
  // folded flag is FALSE at all three on every board this engine can reach — a
  // mutant there could not be killed, and an unkillable mutant is a corpus defect
  // rather than coverage. The disjuncts are written at those sites anyway, for
  // TOTALITY; the corpus is where that distinction gets paid for honestly.
  //
  // 🛑 THE SHARPEST IS `D253-no-zone-gate`. Deleting `&& onBench` from the fold
  // leaves a card that prevents ALL damage and ALL effects unconditionally — not a
  // subtle mis-reading, an unbeatable printing — and EVERY bench assertion in the
  // suite still passes. Only the ACTIVE twins catch it, which is why each bench
  // assertion in `curiousTeaParty.test.ts` was written with one.
  {
    id: "D253-no-zone-gate",
    decision: "D253",
    what: "\ud83d\uded1 the ZONE GATE is dropped from the fold, so the aura prevents all damage AND all effects wherever the holder stands — an unbeatable card. Every BENCH assertion in the suite still passes; only the ACTIVE twins catch it",
    file: "packages/engine/src/continuous.ts",
    find: "    if (passive.preventDamageAndEffectsWhileBenched === true && onBench)",
    replace: "    if (passive.preventDamageAndEffectsWhileBenched === true)",
    expectKilledBy: ["packages/engine/src/curiousTeaParty.test.ts"],
  },
  {
    id: "D253-zone-inverted",
    decision: "D253",
    what: "`isOnBench` scans the ACTIVE spot instead of the bench, so the printed antecedent is answered backwards: the holder is protected exactly where the sentence says it is not, and exposed exactly where it says it is",
    file: "packages/engine/src/continuous.ts",
    find: "  return SEATS.some((seat) => state.players[seat].bench.some((benched) => topUid(benched) === uid));",
    replace:
      "  return SEATS.some((seat) => topUid(state.players[seat].active ?? pokemon) === uid);",
    expectKilledBy: ["packages/engine/src/curiousTeaParty.test.ts"],
  },
  {
    id: "D253-identity-by-reference",
    decision: "D253",
    what: "\ud83d\uded1 `isOnBench` matches by REFERENCE instead of by top uid. `InPlayPokemon` is rebuilt by value on every damage step, so the predicate answers FALSE for the very body the caller just handed it one line after a hit — the prevention switches itself off mid-attack and a fresh board never shows it",
    file: "packages/engine/src/continuous.ts",
    find: "  return SEATS.some((seat) => state.players[seat].bench.some((benched) => topUid(benched) === uid));",
    replace:
      "  return SEATS.some((seat) => state.players[seat].bench.some((benched) => benched === pokemon));",
    expectKilledBy: ["packages/engine/src/curiousTeaParty.test.ts"],
  },
  {
    id: "D253-spread-unwired",
    decision: "D253",
    what: "the disjunct is deleted from the SPREAD arm — one of only TWO read sites this field can ever fire at. A spread is the commonest way anything reaches a bench at all, so this is the half of the printing that matters most in play",
    file: "packages/engine/src/interpreter.ts",
    // ⚠️ RE-ANCHORED AT D257, which inserted a disjunct between this line and the
    // `attackDamageBlocked` call the anchor used to reach for. The anchor now ends
    // on the FOLLOWING COMMENT rather than on the next call, which is stable under
    // exactly the edit that broke it (a new disjunct always arrives with its own
    // comment block). D255's rule: an anchor in a file with sibling scans must carry
    // enough of the surrounding text to be unique, and `precheck.ts` is what caught
    // this one before any run.
    find: "      passives.preventDamageAndEffectsWhileBenched ||\n      // D257 — the SEVENTH prevent, at the SECOND of its four read sites.",
    replace: "      // D257 — the SEVENTH prevent, at the SECOND of its four read sites.",
    expectKilledBy: ["packages/engine/src/curiousTeaParty.test.ts"],
  },
  {
    id: "D253-snipe-unwired",
    decision: "D253",
    what: "the disjunct is deleted from `placeSnipe`'s `deals` arm — the OTHER of the two live sites. The spread assertions all still pass, so a suite that drove only one bench path would go green with half the printing missing",
    file: "packages/engine/src/interpreter.ts",
    // ⚠️ RE-ANCHORED AT D257 for the row above's reason verbatim.
    find: "          targetPassives.preventDamageAndEffectsWhileBenched ||\n          // D257 — the THIRD of the seventh prevent's four read sites",
    replace: "          // D257 — the THIRD of the seventh prevent's four read sites",
    expectKilledBy: ["packages/engine/src/curiousTeaParty.test.ts"],
  },
  {
    id: "D253-data-row-merged",
    decision: "D253",
    what: "the data row authors D252's `preventDamageAndEffectsFromSpecialEnergy` — exactly the merge the field's doc argues against. The card then gains an attacker predicate its text does not print and LOSES the zone gate its text is built around, both in one edit",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { preventDamageAndEffectsWhileBenched: true },",
    replace: "  passive: { preventDamageAndEffectsFromSpecialEnergy: true },",
    expectKilledBy: ["packages/engine/src/curiousTeaParty.test.ts"],
  },

  // ── D254 — "Spherical Shield", the SEAT-WIDE wide prevent (Rabsca sv05-024).
  // SIX mutants, one per NEW claim: the removed SOURCE clause, the `scope` split
  // in both directions, the per-SOURCE §9 gate, the effects-half field split, and
  // the data row.
  //
  // ⚠️ NO MUTANT AT THE THREE DEAD READ SITES, D253's rule a second time — and
  // note they are the SAME three, dead for a different reason: D253's flag was
  // false there because `passivesOf` had folded a HOLDER gate, this scan is false
  // there because the TARGET clause both its sentences share reads "your BENCHED
  // Pokémon" and all three sites aim at an ACTIVE. Unkillable either way.
  //
  // 🛑 THE SHARPEST IS `D254-source-clause-restored`. Putting Thundurus's Active
  // Spot back in front of Rabsca's field is precisely the merge the two-field
  // split refuses, and EVERY Active-holder assertion in the suite still passes —
  // only the benched-holder boards catch it. That is why `holderBenched` exists
  // and why the Active-holder tests are documented as insufficient alone.
  {
    id: "D254-source-clause-restored",
    decision: "D254",
    what: "🛑 Rabsca's absent SOURCE clause is restored to Thundurus's: only an ACTIVE holder shields the Bench, so a benched Rabsca protects nothing and the two printings collapse into one. Every ACTIVE-holder assertion still passes; only the benched-holder boards catch it",
    file: "packages/engine/src/continuous.ts",
    // ⚠️ THE ANCHOR CARRIES THE LOOP BODY, not just the `holders` line: an
    // identical `holders` binding lives in `seatDamageReduction` one screen down
    // and the bare line matches BOTH. `precheck.ts` caught it at 2×.
    find: '    for (const holder of holders) {\n      if (benchShieldGranted(state, holder, "preventBenchDamageAndEffects", uid, scope))\n        return true;',
    replace:
      '    for (const holder of side.active === null ? [] : [side.active]) {\n      if (benchShieldGranted(state, holder, "preventBenchDamageAndEffects", uid, scope))\n        return true;',
    expectKilledBy: ["packages/engine/src/sphericalShield.test.ts"],
  },
  {
    id: "D254-scope-ignored",
    decision: "D254",
    what: "the `othersOnly` self-skip is deleted, so a sniped holder keeps the shield it is granting ITSELF and Feint Attack stops nulling it. D151's clause is silently un-read for the one aura in this family whose source set contains its target set",
    file: "packages/engine/src/continuous.ts",
    find: '  if (scope === "othersOnly" && sourceUid === targetUid) return false;',
    replace: '  if (false && scope === "othersOnly" && sourceUid === targetUid) return false;',
    expectKilledBy: ["packages/engine/src/sphericalShield.test.ts"],
  },
  {
    id: "D254-scope-over-applied",
    decision: "D254",
    what: "🛑 the self-skip drops EVERY source under `othersOnly` rather than the damaged body's own, so Feint Attack nulls a teammate's shield too. The mirror of the row above: the holder assertion still passes and only the TEAMMATE one catches it, which is the pair the scope argument exists to separate",
    file: "packages/engine/src/continuous.ts",
    find: '  if (scope === "othersOnly" && sourceUid === targetUid) return false;',
    replace: '  if (scope === "othersOnly") return false;',
    expectKilledBy: ["packages/engine/src/sphericalShield.test.ts"],
  },
  {
    id: "D254-lock-gate-dropped",
    decision: "D254",
    what: "the §9 gate is deleted from the per-SOURCE helper, so a Klefki 'Mischievous Lock' no longer silences either bench-shield field. The scan reads a printed Ability that the board has switched off",
    file: "packages/engine/src/continuous.ts",
    find: "  if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) return false; // §9\n  return true;\n}\n\n/** Whether the damaged body's OWN contribution",
    replace: "  return true;\n}\n\n/** Whether the damaged body's OWN contribution",
    expectKilledBy: ["packages/engine/src/sphericalShield.test.ts"],
  },
  {
    id: "D254-effects-half-merged",
    decision: "D254",
    what: '🛑 the `half === "damage"` guard is dropped, so Thundurus\'s DAMAGE-only field also refuses attack EFFECTS. One legal printing gains a status immunity its sentence does not print — the exact direction the two-field split exists to refuse, and invisible on every Rabsca board',
    file: "packages/engine/src/continuous.ts",
    find: '      half === "damage" &&\n      side.active !== null &&',
    replace: "      side.active !== null &&",
    expectKilledBy: ["packages/engine/src/sphericalShield.test.ts"],
  },
  {
    id: "D254-data-row-merged",
    decision: "D254",
    what: "the data row authors `preventBenchDamageWhileActive` — exactly the reuse three comment blocks predicted and the printed string refuses. Rabsca gains an Active-Spot source clause it does not print and loses the effects half it does",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { preventBenchDamageAndEffects: true },",
    replace: "  passive: { preventBenchDamageWhileActive: true },",
    expectKilledBy: ["packages/engine/src/sphericalShield.test.ts"],
  },

  // ── D255 — the ATTACKER'S PRINTED RULE-BOX CLASS (Sylveon sv08.5-040 / Crustle
  // sv10-012/-186 and Farigiraf ex sv05-108/-194). SIX mutants, one per NEW claim:
  // the ex/V reuse, the stage conjunct in BOTH directions, the list-vs-scalar fold,
  // the absent-key rule, and the data row's second object.
  //
  // ⚠️ NO DEAD READ SITE THIS TIME, which is the first slice in three where that is
  // true: the antecedent names the ATTACKER, so all four damage arms can fire and
  // all four are covered by the suite. The mutants are authored at the FOLD and the
  // PREDICATE rather than at the arms, because a single arm's disjunct is killed by
  // the same board four times over and would say nothing the predicate does not.
  //
  // 🛑 THE SHARPEST IS `D255-ex-or-v-reuse`. It is one identifier, it is the build
  // any reader of `preventDamageFromExV` would reach for first, and it passes every
  // assertion in the suite except the Pokémon-V boards — which is exactly why the
  // suite has them.
  {
    id: "D255-ex-or-v-reuse",
    decision: "D255",
    what: "🛑 the suffix EQUALITY becomes `isExOrV`, so all five printings silently gain a protection against every Pokémon V the catalog holds. One identifier, and the only boards that catch it are the Pokémon-V ones",
    file: "packages/engine/src/cards.ts",
    // ⚠️ THE ANCHOR CARRIES THE `.some` BODY, not the bare suffix line: an equality
    // on `pokemonSuffixOf` is a common shape in this file and the short form would
    // be ambiguous.
    find: "    (cls) =>\n      cls.suffix === suffix && (cls.stage === undefined || matchesStage(attacker, cls.stage)),",
    replace:
      "    (cls) =>\n      isExOrV(attacker) && (cls.stage === undefined || matchesStage(attacker, cls.stage)),",
    expectKilledBy: ["packages/engine/src/preventedAttackerClass.test.ts"],
  },
  {
    id: "D255-stage-conjunct-dropped",
    decision: "D255",
    what: "the printed STAGE conjunct stops being read, so Farigiraf ex's two printings widen from \"Basic Pokémon ex\" to any ex. The record's second key becomes decorative and every board except the Stage-1-ex one still passes",
    file: "packages/engine/src/cards.ts",
    find: "    (cls) =>\n      cls.suffix === suffix && (cls.stage === undefined || matchesStage(attacker, cls.stage)),",
    replace: "    (cls) => cls.suffix === suffix,",
    expectKilledBy: ["packages/engine/src/preventedAttackerClass.test.ts"],
  },
  {
    id: "D255-stage-required",
    decision: "D255",
    what: '🛑 the ABSENT `stage` key stops meaning "any stage" and starts meaning "never matches", the mirror of the row above: Sylveon\'s three printings narrow to nothing at all. D135\'s absent-key rule read in the direction that NARROWS, which is the one this family\'s conservative defaults do not protect against',
    file: "packages/engine/src/cards.ts",
    find: "    (cls) =>\n      cls.suffix === suffix && (cls.stage === undefined || matchesStage(attacker, cls.stage)),",
    replace:
      "    (cls) =>\n      cls.suffix === suffix && cls.stage !== undefined && matchesStage(attacker, cls.stage),",
    expectKilledBy: ["packages/engine/src/preventedAttackerClass.test.ts"],
  },
  // 🛑 THE ONE THAT SURVIVED, AND IT FALSIFIED A CLAIM THIS SLICE'S OWN DOC BLOCK
  // MADE. The `PassiveEffects` field was documented as a LIST because "the pool
  // prints BOTH classes today, so one Farigiraf ex and one Sylveon on the same
  // Bench is a legal deck" — which is TRUE and IRRELEVANT: `passivesOf` folds
  // PER BODY, so two holders are two folds of one element each. Two entries on ONE
  // body needs two SOURCES on one body, and `sources` is the holder's own passive
  // plus its Tools plus its Energies — none of which writes this field. So the
  // list-vs-scalar difference is unobservable on every board the catalog can build,
  // exactly as `preventDamageFromTypes` has documented about ITSELF since D159.
  // 🆕 **A SHAPE CLAIM ABOUT A FOLD IS A CLAIM ABOUT ITS SOURCE SET, NEVER ABOUT
  // THE POOL'S PRINTINGS** — and the harness is what caught the substitution. The
  // field stays a LIST for D159's reason verbatim (a scalar could only be last-wins
  // the day a Tool prints the sentence, and that must be the aggregation's SHAPE
  // rather than a fact someone remembers); the doc block is corrected to say so.
  {
    id: "D255-fold-last-wins",
    decision: "D255",
    what: "the fold stops COLLECTING and becomes last-wins (the push is replaced by a single-element assignment), which is precisely the shape the LIST exists to refuse",
    file: "packages/engine/src/continuous.ts",
    find: "    if (passive.preventDamageFromAttackerClass !== undefined)\n      preventDamageFromAttackerClasses.push(passive.preventDamageFromAttackerClass);",
    replace:
      "    if (passive.preventDamageFromAttackerClass !== undefined)\n      preventDamageFromAttackerClasses.splice(\n        0,\n        preventDamageFromAttackerClasses.length,\n        passive.preventDamageFromAttackerClass,\n      );",
    survives: {
      kind: "unreachable-population",
      reason:
        "`passivesOf` folds PER BODY over `sources` = the holder's own passive + its Tools + its Energies, and NO Tool or Energy in the registry writes `preventDamageFromAttackerClass` — so no board the catalog can build gives this collector two entries, and push and last-wins agree everywhere. `preventDamageFromTypes` (D159) is the standing precedent and documents the identical hole about itself: the unit of storage is decided by the WRITE SITES, so a valued gate must COLLECT as the aggregation's shape rather than because a board today can observe it. If this is ever KILLED, a Tool or Energy printing a rule-box-class prevention has been authored and the field's doc block needs re-reading.",
    },
    expectKilledBy: ["packages/engine/src/preventedAttackerClass.test.ts"],
  },
  {
    id: "D255-lock-gate-bypassed",
    decision: "D255",
    what: "the collector is moved off `passive` and reads the holder's catalog row directly, so a Klefki 'Mischievous Lock' no longer silences the aura. All five printings ARE Abilities, so this is the §9 answer the fold exists to make once",
    file: "packages/engine/src/continuous.ts",
    // ⚠️ THE ANCHOR IS THE LOOP'S CLOSING BRACE AND NOT THE COLLECTOR LINE, AND
    // THAT IS THE WHOLE POINT OF THE MUTANT. A bypass written INSIDE the loop is
    // unreachable under a lock — `sources[0]` is already `undefined`, so with no
    // Tool attached the body never runs and the field reads `[]` either way. The
    // real careless build reads the catalog row ONCE, after the fold, which is what
    // this replaces. (The first authoring made exactly that mistake and survived.)
    // ⚠️ RE-ANCHORED AT D277: the anchor is the LAST statement in the fold loop,
    // and D277 appended `attackFirstTurnExempt` after `cantAttackUnless`, so the
    // old two-line anchor stopped occurring. `precheck.ts` caught it on the first
    // run of the slice — which is the reason it is run before the corpus, not
    // after. The mutant's MEANING is unchanged: still "bypass the fold, read the
    // catalog row once, after the loop".
    // ⚠️⚠️ RE-ANCHORED AGAIN AT D278, FOR THE IDENTICAL REASON ONE SLICE LATER,
    // AND THEN **RE-ANCHORED ON A DIFFERENT KIND OF THING AT D279 SO IT STOPS
    // HAPPENING**. D277 appended after `cantAttackUnless`; D278 appended after
    // `attackFirstTurnExempt`; D279 rewrote `evolveEarlyExempt`'s line into five.
    // 🛑 **THREE CONSECUTIVE SLICES BROKE THIS ROW, AND ALL THREE BROKE IT THE
    // SAME WAY: BY EDITING THE LAST STATEMENT OF A LOOP THAT KEEPS GROWING.**
    // Re-anchoring on the new last statement a fourth time would only schedule a
    // fourth break — so the anchor is no longer a STATEMENT at all.
    //
    // ✅ **IT NOW ANCHORS ON THE LOOP'S CLOSING BRACE PLUS THE RETURN'S FIRST
    // FIELD** (`damageReductionAfterWR`, the fold's oldest and least-moved line),
    // which is the shortest string that still means "after the loop, before the
    // return" AND is invariant under every edit that has broken it: appending a
    // term, rewriting a term, or adding an accumulator all leave it untouched.
    // The only thing that moves it is reordering the returned object's first key,
    // which is not an edit any licence slice makes. **The general rule this row
    // now records: anchor a mutant on a STRUCTURAL boundary that a growing region
    // pushes around, never on the growing region's current last line.**
    find: "  }\n  return {\n    damageReductionAfterWR,",
    replace:
      "  }\n  {\n    const raw = top === undefined ? undefined : programFor(top.id)?.passive;\n    if (raw?.preventDamageFromAttackerClass !== undefined)\n      preventDamageFromAttackerClasses.length = 0,\n        preventDamageFromAttackerClasses.push(raw.preventDamageFromAttackerClass);\n  }\n  return {\n    damageReductionAfterWR,",
    expectKilledBy: ["packages/engine/src/preventedAttackerClass.test.ts"],
  },
  {
    id: "D255-two-sentences-merged",
    decision: "D255",
    what: "🛑 the STAGE-gated data row is authored as the ex-only one, i.e. the two printed sentences collapse into a single object. Farigiraf ex's two printings gain protection from a Stage 1 ex their text does not mention — the merge the record's second key exists to refuse",
    file: "packages/engine/src/registry.ts",
    find: '  passive: { preventDamageFromAttackerClass: { suffix: "ex", stage: "basic" } },',
    replace: '  passive: { preventDamageFromAttackerClass: { suffix: "ex" } },',
    expectKilledBy: ["packages/engine/src/preventedAttackerClass.test.ts"],
  },

  // ── D256 — the BENCH-WIDE Rule-Box prevention (Shaymin sv10-010/-185 "Flower
  // Curtain"). FOUR mutants, one per NEW claim: the target conjunct's PRESENCE, its
  // DIRECTION, its SUBJECT (target vs source), and the damage-only HALF.
  //
  // ⚠️ NO ARM MUTANTS AND NO §9 MUTANT, both for reasons this slice can state
  // exactly rather than assume: it adds ZERO read-site disjuncts (the four damage
  // arms already call `benchShieldedFromDamage`, unchanged), and the §9 gate is
  // `benchShieldGranted`'s existing line, which D254's `D254-*` rows already cover
  // for every field on this scan. A mutant at either place would be a re-run of
  // someone else's coverage rather than of this slice's claims.
  //
  // 🛑 EACH ONE IS ANCHORED OUTSIDE THE GUARD IT DEFEATS — D255's lesson, applied
  // deliberately. All four sit in the `holders` loop that runs for EVERY body on
  // the damaged side's board, which `flowerCurtain.test.ts` drives with the holder
  // benched AND active, so none of them can hide behind a branch that never runs.
  {
    id: "D256-target-conjunct-dropped",
    decision: "D256",
    what: "🛑 the printed \"that don't have a Rule Box\" conjunct stops being read, so Shaymin's two printings widen from the plain half of the Bench to ALL of it — every benched Pokémon ex, V, VMAX and Radiant gains a shield the sentence exists to deny them. This is the merge into `preventBenchDamageAndEffects` written as one deletion",
    file: "packages/engine/src/continuous.ts",
    find: '      if (\n        half === "damage" &&\n        !targetHasRuleBox &&\n        benchShieldGranted(state, holder, "preventBenchDamageNoRuleBox", uid, scope)\n      ) {',
    replace:
      '      if (\n        half === "damage" &&\n        benchShieldGranted(state, holder, "preventBenchDamageNoRuleBox", uid, scope)\n      ) {',
    expectKilledBy: ["packages/engine/src/flowerCurtain.test.ts"],
  },
  {
    id: "D256-target-conjunct-inverted",
    decision: "D256",
    what: 'the conjunct\'s NEGATION is dropped, so the shield lands on exactly the bodies the print excludes and on none of the ones it names. The mirror of the row above, and the one a reader of the parenthetical ("Pokémon ex, Pokémon V, etc. HAVE Rule Boxes") could plausibly write',
    file: "packages/engine/src/continuous.ts",
    find: '        !targetHasRuleBox &&\n        benchShieldGranted(state, holder, "preventBenchDamageNoRuleBox", uid, scope)',
    replace:
      '        targetHasRuleBox &&\n        benchShieldGranted(state, holder, "preventBenchDamageNoRuleBox", uid, scope)',
    expectKilledBy: ["packages/engine/src/flowerCurtain.test.ts"],
  },
  {
    id: "D256-rulebox-read-on-source",
    decision: "D256",
    what: "🛑 the Rule-Box read moves from the body being DAMAGED to the body GRANTING, which is the sentence read off the wrong end. Shaymin has no Rule Box, so this shields the WHOLE Bench on every board a holder is on — the same wrong answer as dropping the conjunct, arrived at by a substitution rather than a deletion, and invisible to any test that only checks the holder is a plain Pokémon",
    file: "packages/engine/src/continuous.ts",
    find: '        !targetHasRuleBox &&\n        benchShieldGranted(state, holder, "preventBenchDamageNoRuleBox", uid, scope)',
    replace:
      '        !((h) => h === undefined || hasRuleBox(h))(topCardOf(state, holder)) &&\n        benchShieldGranted(state, holder, "preventBenchDamageNoRuleBox", uid, scope)',
    expectKilledBy: ["packages/engine/src/flowerCurtain.test.ts"],
  },
  {
    id: "D256-effects-half-granted",
    decision: "D256",
    what: "the damage-only gate is dropped, so \"Prevent all damage done to…\" starts refusing attack EFFECTS as well — Shaymin's two printings gain a bench-wide status immunity nobody prints, which is the OTHER half of the merge into Rabsca's field. Killed at `benchShieldedFromEffects`, which is the only place the two halves can disagree on one board",
    file: "packages/engine/src/continuous.ts",
    find: '        half === "damage" &&\n        !targetHasRuleBox &&',
    replace: "        !targetHasRuleBox &&",
    expectKilledBy: ["packages/engine/src/flowerCurtain.test.ts"],
  },

  // ── D257 — the DAMAGE-THRESHOLD prevention (Drednaw sv07-044 "Impervious
  // Shell"). FOUR mutants, one per NEW claim: the comparator's DIRECTION, its
  // INCLUSIVITY, WHICH NUMBER it is read against, and the FOLD's direction.
  //
  // ⚠️ NO PER-ARM MUTANTS, and the reason is stated rather than assumed: the four
  // read sites call ONE function (`preventedByDamageThreshold`), so a mutant in that
  // function is a mutant at all four at once — which is the whole point of the
  // function existing. The wiring of each individual arm IS covered, by
  // `imperviousShell.test.ts` driving all four on real boards; what a per-arm mutant
  // would add is a re-run of that.
  //
  // 🛑 THE FOURTH ROW IS DECLARED UNREACHABLE UP FRONT RATHER THAN AFTER THE FACT,
  // which is D255's lesson applied before the harness had to teach it again: no
  // board this catalog can build gives one body two writers of the field, so `min`
  // and `max` agree everywhere and the row exists to go RED the day that changes.
  {
    id: "D257-threshold-inverted",
    decision: "D257",
    what: '🛑 the printed comparator flips from "200 or more" to "200 or less", which is `AttackBlock.maxDamage`\'s polarity read onto the wrong card — so the holder is shielded from every SMALL hit and takes every big one, the exact inversion D240 wrote its `(less|more)` capture to make impossible on the attack side',
    file: "packages/engine/src/continuous.ts",
    find: "  return threshold !== undefined && damage >= threshold;",
    replace: "  return threshold !== undefined && damage <= threshold;",
    expectKilledBy: ["packages/engine/src/imperviousShell.test.ts"],
  },
  {
    id: "D257-threshold-exclusive",
    decision: "D257",
    what: 'the comparator loses its INCLUSIVITY — `>=` becomes `>` — so a hit of exactly 200 lands on a card that prints "200 or more". One character, one board, and the only case that can see it is the boundary itself',
    file: "packages/engine/src/continuous.ts",
    find: "  return threshold !== undefined && damage >= threshold;",
    replace: "  return threshold !== undefined && damage > threshold;",
    expectKilledBy: ["packages/engine/src/imperviousShell.test.ts"],
  },
  {
    id: "D257-threshold-vs-printed-damage",
    decision: "D257",
    what: "🛑 the threshold stops being read against `wouldDeal` at the main hit and is read against `preWR` — the attack's PRE-Weakness number — instead — D240's ruling undone at one site. Killed only by the ×2-Weakness board, where a printed 110 is a placed 220: every single-modifier board in the file agrees with both readings",
    file: "packages/engine/src/attack.ts",
    find: "          preventedByDamageThreshold(defenderPassives.preventDamageAtOrAbove, wouldDeal) ||",
    replace:
      "          preventedByDamageThreshold(defenderPassives.preventDamageAtOrAbove, preWR) ||",
    expectKilledBy: ["packages/engine/src/imperviousShell.test.ts"],
  },
  {
    id: "D257-threshold-fold-max",
    decision: "D257",
    what: "the fold keeps the HIGHER of two printed thresholds instead of the lower, so two sources on one body would shield strictly less than either alone promises",
    file: "packages/engine/src/continuous.ts",
    find: "          : Math.min(preventDamageAtOrAbove, passive.preventDamageAtOrAbove);",
    replace: "          : Math.max(preventDamageAtOrAbove, passive.preventDamageAtOrAbove);",
    expectKilledBy: ["packages/engine/src/imperviousShell.test.ts"],
    survives: {
      kind: "unreachable-population",
      reason:
        "`passivesOf` folds PER BODY over `sources` = the holder's own passive + its Tools + its Energies, and NO Tool or Energy in the registry writes `preventDamageAtOrAbove` — the one legal printing is a Pokémon Ability. So no board the catalog can build gives this accumulator two entries, and `min`, `max` and last-wins agree everywhere. The direction is argued from the WRITE SITES (a lower threshold shields strictly more, so keeping it is the only fold under which both sources' printed sentences stay true), which is `preventDamageFromType`'s standing precedent and D130's rule about recording such a row rather than inventing a fixture no printing justifies. `imperviousShell.test.ts` pins the premise directly — it asserts every writer in the pool is a Pokémon. If this is ever KILLED, a Tool or Energy printing a damage-threshold prevention has been authored and the fold's doc block needs re-reading.",
    },
  },

  // ── D258 — the COIN-FLIP defensive Ability (Fezandipiti "Adrena-Pheromone",
  // Kecleon "Expert Hider"). FOUR mutants, one per NEW claim, and every one of them
  // is about the RNG rather than about the damage — which is the whole difference
  // between this row and its seven predecessors.
  //
  // ⚠️ NO PER-ARM MUTANTS, and this time the reason is structural rather than
  // economic: the four read sites call ONE function (`coinFlipShieldPrevents`), so a
  // mutant inside it is a mutant at all four at once. That funnel is the slice.
  //
  // 🛑 THE THIRD ROW IS DECLARED UNREACHABLE UP FRONT — D255's and D257's lesson
  // applied before the harness has to teach it again.
  {
    id: "D258-flip-ignores-antecedent",
    decision: "D258",
    what: "🛑 the printed antecedent is dropped — the funnel flips even when the damage that would land is ZERO. A body already shielded by a sibling aura, by a Stadium, by Feint Attack's `ignoreWR` or by an unarmed {D} gate would draw a coin anyway, and every DAMAGE assertion in the suite would stay green while the game consumed a different number of RNG steps. Killed by the cases that pin `rngState` UNCHANGED across a hit",
    file: "packages/engine/src/continuous.ts",
    find: "  if (damage <= 0) return [false, state.rngState];",
    replace: "  if (damage < 0) return [false, state.rngState];",
    expectKilledBy: ["packages/engine/src/expertHider.test.ts"],
  },
  {
    id: "D258-flip-face-inverted",
    decision: "D258",
    what: 'the printed face is inverted — TAILS prevents where the card says "If heads". The row still announces the true face, so a suite that only read the event would pass; only a board that pairs the face with the damage can see it',
    file: "packages/engine/src/continuous.ts",
    find: '    if (face === "heads") prevented = true;',
    replace: '    if (face === "tails") prevented = true;',
    expectKilledBy: ["packages/engine/src/expertHider.test.ts"],
  },
  {
    id: "D258-energy-gate-dropped",
    decision: "D258",
    what: "🛑 Fezandipiti's printed \"has any {D} Energy attached\" conjunct is dropped in the FOLD, so an unarmed holder is shielded — and, worse, draws a coin it should never draw. This is the one mutant that separates the two printed sentences: Kecleon's row is byte-identical without the conjunct, so a build that ignores it passes every Kecleon board in the file",
    file: "packages/engine/src/continuous.ts",
    find: "      (passive.preventDamageOnCoinFlip.requiresEnergyType === undefined ||\n        hasAttachedEnergy(state, pokemon, passive.preventDamageOnCoinFlip.requiresEnergyType))",
    replace: "      true",
    expectKilledBy: ["packages/engine/src/expertHider.test.ts"],
  },
  {
    id: "D258-flip-first-only",
    decision: "D258",
    what: "the funnel stops after the FIRST entry instead of flipping once per shield, so a body carrying two coin-flip Abilities would draw ONE coin where the printed rules draw two — the same answer on a heads and a different `rngState` on every board",
    file: "packages/engine/src/continuous.ts",
    find: '    if (face === "heads") prevented = true;\n  }',
    replace: '    if (face === "heads") prevented = true;\n    break;\n  }',
    expectKilledBy: ["packages/engine/src/expertHider.test.ts"],
    survives: {
      kind: "unreachable-population",
      reason:
        "`passivesOf` folds PER BODY over `sources` = the holder's own passive + its Tools + its Energies, and NO Tool or Energy in the registry writes `preventDamageOnCoinFlip` — all five legal printings are Pokémon Abilities, and no Pokémon prints the sentence twice. So no board the catalog can build gives this accumulator two entries, and `break`-after-one is indistinguishable from the full loop. ⚠️ THE SPREAD CASE IS NOT A COUNTER-EXAMPLE: three benched Kecleons are THREE FOLDS of one element each, not one fold of three — `passivesOf` takes a BODY, which is D255's own correction to itself and the reason that case cannot kill this row. The direction is argued from the WRITE SITES: two sources are two printed \"flip a coin\" instructions, so drawing one coin would be wrong even though the ANSWER would match on a heads. `expertHider.test.ts` pins the premise directly — it asserts every writer in the pool is a Pokémon. If this is ever KILLED, a Tool or Energy printing a coin-flip prevention has been authored and the fold's doc block needs re-reading.",
    },
  },

  // ── D259 — the TRAINER-BORNE effect shield (Fraxure "Unnerve" / Cetitan ex
  // "Snow Camouflage", Rhyperior "Wide Wall"). FOUR mutants, one per NEW claim,
  // and every one of them is about a CLAUSE the two printed sentences disagree on
  // rather than about the prevention itself — which is the whole shape of a row
  // whose two members differ on their trigger AND their target.
  //
  // ⚠️ NO PER-READ-SITE MUTANTS, for D258's structural reason verbatim: the two
  // new read sites and the eight old ones call ONE function (`effectRefused`), so
  // a mutant inside it is a mutant at all ten at once. That funnel is the slice.
  //
  // ⚠️ AND NO MUTANT AGAINST THE `target` DEFAULT, because one could not be
  // killed usefully: dropping the parameter reverts the funnel to reading the
  // Active, which the filter-vs-guard mutant below already covers from the side
  // where the difference is observable.
  {
    id: "D259-trainer-channel-ignores-owner",
    decision: "D259",
    what: "🛑 the printed words \"your opponent\" are dropped — a Supporter you play on your OWN board is refused by your own shield. Every board where the shield is the DEFENDER's stays green, so only a case that plays a Trainer on the shield's own side can see it",
    file: "packages/engine/src/interpreter.ts",
    find: "    if (seat === ctx.seat) return false;",
    replace: "    if (seat === ctx.seat && false) return false;",
    expectKilledBy: ["packages/engine/src/trainerShield.test.ts"],
    survives: {
      kind: "unreachable-population",
      reason:
        'NO BOARD REACHES THIS LINE WITH `seat === ctx.seat`, AND THE CORPUS IS WHAT ESTABLISHED THAT RATHER THAN THE AUTHOR — it was authored as a drivable row, SURVIVED, and the grep that followed is the measurement. The trainer channel is only consulted from ops that aim at the OPPONENT: every `trainer` program in the registry reaching `effectRefused` or `unshieldedRefs` is `discardEnergy from: "opponentChosen" | "opponentEach"` (Crushing Hammer, Giacomo, fix-hammer), `gust` (Boss\u2019s Orders, Pok\u00e9mon Catcher) or `applyStatus target: "defender"` (Dangerous Laser), grepped at this commit. The one own-board Trainer op in the pool, `healChosen` (Potion and its four siblings), is NOT on this funnel at all. So `seat` is always the opponent here and the conjunct cannot be observed. KEPT FOR TOTALITY rather than deleted, and THIS SLICE is the argument for keeping it: D253\u2019s and D254\u2019s effects arms were recorded structurally dead on exactly this kind of reasoning, and D259 made both LIVE by adding an op that aims where no op aimed before. If this is ever KILLED, a Trainer that discards, statuses or moves counters on its OWN board through this funnel has been authored and this reason needs re-reading.',
    },
  },
  {
    id: "D259-wide-wall-stops-items",
    decision: "D259",
    what: "🛑 Rhyperior's printed \"a Supporter card\" is widened to any Trainer, so a Wide Wall board refuses a Crushing Hammer it must let through. This is the one mutant that separates the two printed sentences — Fraxure's row is byte-identical without the narrowing, so a build that ignores it passes every Unnerve board in the file",
    file: "packages/engine/src/interpreter.ts",
    find: '    return ctx.invokedBy === "supporter" && seatShieldedFromSupporterEffects(state, seat);',
    replace: "    return seatShieldedFromSupporterEffects(state, seat);",
    expectKilledBy: ["packages/engine/src/trainerShield.test.ts"],
  },
  {
    id: "D259-wide-wall-source-zone-dropped",
    decision: "D259",
    what: 'Rhyperior\'s printed "As long as this Pokémon is in the Active Spot" is widened to the whole board, so a BENCHED Wide Wall shields the seat. Every board with the wall Active stays green; only the benched-source case can see it',
    file: "packages/engine/src/continuous.ts",
    find: "  const active = state.players[seat].active;\n  if (active === null) return false;",
    replace:
      '  const active =\n    [state.players[seat].active, ...state.players[seat].bench].find(\n      (b) =>\n        b !== null &&\n        programFor(topCardOf(state, b)?.id ?? "")?.passive?.preventSupporterEffectsWhileActive ===\n          true,\n    ) ?? state.players[seat].active;\n  if (active === null) return false;',
    expectKilledBy: ["packages/engine/src/trainerShield.test.ts"],
  },
  {
    id: "D259-filter-becomes-guard",
    decision: "D259",
    what: '🛑 the per-candidate FILTER at the gust site becomes a whole-op guard: one shielded body anywhere on the Bench refuses the entire Boss\'s Orders, so a single Fraxure protects four unshielded teammates with a sentence that says "this Pokémon". A board with exactly one benched body cannot tell the two apart, which is why the cases carry three',
    file: "packages/engine/src/interpreter.ts",
    find: '        unshieldedRefs(state, oppBenchRefs(state, ctx.seat), ctx, events),\n        (ref) => switchRecording(op, (into) => gust(state, ref, ctx, into), events, record),\n        "Gust up which of the opponent\'s Benched Pokémon?",',
    replace:
      '        unshieldedRefs(state, oppBenchRefs(state, ctx.seat), ctx, events).length ===\n        oppBenchRefs(state, ctx.seat).length\n          ? oppBenchRefs(state, ctx.seat)\n          : [],\n        (ref) => switchRecording(op, (into) => gust(state, ref, ctx, into), events, record),\n        "Gust up which of the opponent\'s Benched Pokémon?",',
    expectKilledBy: ["packages/engine/src/trainerShield.test.ts"],
  },

  // ── D260 — BACKLOG ROW 15-E, the ATTACK-BORNE EFFECTS-ONLY shield (Skeledirge
  // sv08-031 "Unaware", Team Rocket's Articuno sv10-051 "Repelling Veil"). THREE
  // mutants, one per NEW claim the row makes and no more:
  //   • the HOLDER half's existence at the funnel (the fold disjunct),
  //   • the GROUP half's STAGE conjunct — the printed word with 35 legal bodies
  //     sitting on the wrong side of it,
  //   • the GROUP half's OWN-SIDE line — the printed "your".
  //
  // ⚠️ NO MUTANT IS AUTHORED AGAINST THE DAMAGE HALF, because there is no damage
  // half to break: nothing in the §8.5 pipeline reads either field, so a mutant
  // there would be editing code this row never wrote. The "(Damage is not an
  // effect.)" claim is carried by the BITE boards in the suite instead, which is
  // the right instrument — an assertion that a pipeline was NOT joined cannot be
  // expressed as an edit to it.
  //
  // ⚠️ AND NO MUTANT AGAINST THE PREFIX ARM, which is D242's and is already killed
  // by `ownerPrefix.test.ts`. Re-authoring it here would be a second corpus row for
  // one claim — the `matchesFilter` reuse is exactly the saving this row banked.
  {
    id: "D260-holder-shield-unwired",
    decision: "D260",
    what: "🛑 the HOLDER half is deleted from the funnel, so Skeledirge's printed sentence does nothing at all. Every damage assertion in the file still passes — the row's whole point is that it touches no damage site — and only the two effect ops behind the funnel can see it",
    file: "packages/engine/src/interpreter.ts",
    find: "    passivesOf(state, target).preventAttackEffects ||\n",
    replace: "",
    expectKilledBy: ["packages/engine/src/repellingVeil.test.ts"],
  },
  {
    id: "D260-group-stage-dropped",
    decision: "D260",
    what: '🛑 the printed STAGE word is dropped from the group filter, so "your Basic Team Rocket\'s Pokémon" becomes "your Team Rocket\'s Pokémon" — 35 legal non-Basic printings gain a shield the sentence does not grant them. Every positive board in the file still passes; only the Stage 1 negative can see it, and no body in the fixture pool could play that part before this slice',
    file: "packages/engine/src/registry.ts",
    find: '    preventAttackEffectsForGroup: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },',
    replace: '    preventAttackEffectsForGroup: { kind: "ownerPokemon", owner: "Team Rocket" },',
    expectKilledBy: ["packages/engine/src/repellingVeil.test.ts"],
  },
  {
    id: "D260-group-scan-crosses-the-table",
    decision: "D260",
    what: 'the OWN-SIDE rule is dropped, so an aura on EITHER seat reaches a group member on the other one \u2014 the printed word is "YOUR". Every board where only one player fields the holder stays green, which is every behaviour board in the file; only the explicit across-the-table read catches it. \u26a0\ufe0f IT TAKES BOTH LINES, AND THAT IS THE FINDING: the `continue` guard and the trailing `return false` enforce the rule JOINTLY, so a mutant that deletes either one alone is a NO-OP on every board (the first survived exactly that way and was re-authored rather than declared equivalent \u2014 D259\u2019s worked failure mode, repeated and caught)',
    file: "packages/engine/src/continuous.ts",
    find: "    if (!bodies.some((body) => topUid(body) === uid)) continue;\n    for (const holder of bodies) {\n      const top = topCardOf(state, holder);\n      if (top === undefined) continue;\n      const filter = programFor(top.id)?.passive?.preventAttackEffectsForGroup;\n      if (filter === undefined) continue;\n      const sourceUid = topUid(holder);\n      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // \u00a79\n      if (matchesFilter(targetTop, filter)) return true;\n    }\n    return false; // this is the Pok\u00e9mon's own side \u2014 no other side can shield it",
    replace:
      "    for (const holder of bodies) {\n      const top = topCardOf(state, holder);\n      if (top === undefined) continue;\n      const filter = programFor(top.id)?.passive?.preventAttackEffectsForGroup;\n      if (filter === undefined) continue;\n      const sourceUid = topUid(holder);\n      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // \u00a79\n      if (matchesFilter(targetTop, filter)) return true;\n    }",
    expectKilledBy: ["packages/engine/src/repellingVeil.test.ts"],
  },

  // ── D261 — THE SPECIAL ENERGY COLUMN's two cheapest remaining rows (Mist Energy
  // sv05-161, Enriching Energy sv08-191). FOUR mutants, one per NEW claim and no
  // more:
  //   • Row A's whole existence — the registry row is the entire engine diff, so
  //     the only edit that can break it is the row itself;
  //   • Row A's §9 EXEMPTION — the one thing about it that is not obvious, and the
  //     first fold field in the engine with writers on both sides of a lock;
  //   • Row B's arm, deleted;
  //   • Row B's SPOT guard — the exact mistake a copy of Jet's arm would make.
  //
  // ⚠️ NO MUTANT AGAINST `interpreter.ts effectRefusedOn`'s disjunct, and that is
  // the point of Row A rather than an omission: D260 already owns that line
  // (`D260-holder-shield-unwired`) and this row adds nothing to it. Re-authoring it
  // here would be a second corpus row for one claim.
  // ⚠️ AND NO MUTANT AGAINST THE `provides: ["Colorless"]` HALF, which is Jet's and
  // Spiky's shipped line — breaking it would be editing M4 slice 5's code.
  {
    id: "D261-mist-shield-unauthored",
    decision: "D261",
    what: "🛑 Mist Energy's registry row loses its `passive`, so the printed shield does nothing at all while the card still provisions {C}. This is the WHOLE of Row A's engine diff, which is why one mutant covers it: there is no other line to break. Every damage assertion in the file still passes — the row touches no damage site — and only the two effect ops behind the funnel can see it",
    file: "packages/engine/src/registry.ts",
    find: '  energy: { provides: ["Colorless"], passive: { preventAttackEffects: true } },',
    replace: '  energy: { provides: ["Colorless"] },',
    expectKilledBy: ["packages/engine/src/mistEnergy.test.ts"],
  },
  {
    id: "D261-energy-source-loses-its-exemption",
    decision: "D261",
    what: "🛑 the ENERGY source class is dropped under a §9 lock exactly as the top card is, so an Ability lock silences an attached Energy's continuous surface. THE FIRST MUTANT IN THE CORPUS THAT CAN ONLY BE SEEN THROUGH AN ENERGY: D174 bought this exemption STRUCTURALLY (the Energy slot is appended past the `disabled` term) and, until this row, no field had writers on both sides of a lock, so the exemption had exactly one witness in §12. It now has one on the attack channel too — and both must go red, which is why `expectKilledBy` names two suites",
    file: "packages/engine/src/continuous.ts",
    find: "    ...pokemon.energy.map((uid) => {\n      const id = state.cardIdByUid[uid];\n      return id === undefined ? undefined : programFor(id)?.energy?.passive;\n    }),",
    replace:
      "    ...pokemon.energy.map((uid) => {\n      const id = state.cardIdByUid[uid];\n      return disabled || id === undefined ? undefined : programFor(id)?.energy?.passive;\n    }),",
    expectKilledBy: [
      "packages/engine/src/mistEnergy.test.ts",
      "packages/engine/src/therapeuticEnergy.test.ts",
    ],
  },
  {
    id: "D261-draw-arm-unwired",
    decision: "D261",
    what: "🛑 the second `EnergyOnAttach` arm is deleted from `turn.ts`, so Enriching Energy attaches and draws nothing. The attach itself still succeeds and every §6.2 assertion in the repo stays green — the draw is a RIDER on it, so only a board that counts the hand can see this",
    file: "packages/engine/src/turn.ts",
    find: '  if (onAttach?.kind === "draw") {\n    next = drawToHand(next, action.seat, onAttach.count, "effect", events);\n  }\n',
    replace: "",
    expectKilledBy: ["packages/engine/src/mistEnergy.test.ts"],
  },
  {
    id: "D261-draw-arm-inherits-jets-spot-guard",
    decision: "D261",
    what: '🛑 the draw arm gains the `spot === "bench"` conjunct its SIBLING arm carries, so "When you attach this card from your hand to a Pokémon" silently becomes "…to 1 of your Benched Pokémon". This is the exact defect a copy-paste of Jet\'s arm produces, it is invisible on every bench board, and it is why the suite drives BOTH spots rather than the convenient one',
    file: "packages/engine/src/turn.ts",
    find: '  if (onAttach?.kind === "draw") {',
    replace: '  if (onAttach?.kind === "draw" && action.target.spot === "bench") {',
    expectKilledBy: ["packages/engine/src/mistEnergy.test.ts"],
  },

  // ── D262 — THE SPECIAL ENERGY COLUMN's CONDITIONAL PROVISION (Neo Upper Energy
  // sv05-162). FOUR mutants, one per NEW claim and no more:
  //   • the provision rule EXISTS at all — the registry field, deleted;
  //   • it is exactly STAGE 2 and not "any Evolution" — the mistake a reuse of
  //     `matchesFilter`'s `stage` vocabulary makes;
  //   • it is TWO units and not one — "only 2 Energy at a time" is a COUNT;
  //   • it is LIVE-READ and not stamped at attach time.
  //
  // ⚠️ NO MUTANT AGAINST `provides: ["Colorless"]`, which is Jet's, Spiky's and
  // Mist's shipped line — breaking it would be editing M4 slice 5's code.
  // ⚠️ AND NO MUTANT AGAINST `demoteWithOtherSpecial`'s arm, which D-era Luminous
  // already owns: the two conditionals share a funnel but not a claim.
  {
    id: "D262-stage2-provision-unwired",
    decision: "D262",
    what: "🛑 Neo Upper Energy's registry row loses `promoteOnHolderStage`, so the second printed paragraph does nothing at all and the card is a plain {C} provider on every body. This is the row's EXISTENCE claim; the {C} half still works, so every board that only pays Colorless stays green",
    file: "packages/engine/src/registry.ts",
    find:
      '    provides: ["Colorless"],\n    promoteOnHolderStage: { stage: "Stage2", units: [ANY_ENERGY, ANY_ENERGY] },',
    replace: '    provides: ["Colorless"],',
    expectKilledBy: ["packages/engine/src/neoUpperEnergy.test.ts"],
  },
  {
    id: "D262-stage-gate-widens-to-any-evolution",
    decision: "D262",
    what: '\u{1F6D1} the stage gate becomes "is not a Basic" — which is exactly what `matchesFilter`\'s `stage` vocabulary (D245) can express and all it can express, since its non-basic arm is `evolveFromOf(card) !== null`. A build that REUSED that vocabulary instead of adding `isStage2Pokemon` ships this defect, and it is invisible on every board that holds a Stage 2 or a Basic: only the STAGE 1 holder can see it',
    file: "packages/engine/src/continuous.ts",
    // ⚠️ RE-POINTED AT D302: the single-line `if` became a multi-term
    // conjunction when the riders landed, so the anchor is now the STAGE TERM
    // alone — a structural boundary the growing condition pushes around rather
    // than a line the edit replaces (D255's rule).
    // 🆕 ⚠️ **AND THE KILLER SET WIDENED FROM ONE SUITE TO TWO, MEASURED ROW BY
    // ROW RATHER THAN ARGUED.** The `what` above says only a STAGE 1 holder can
    // see this, which was true when one carrier existed. Probed individually at
    // D302: `prismEnergy.test.ts` kills it ALONE (Prism gates on Basic, and
    // `!isBasicPokemon` is false on every Basic, so Prism stops promoting
    // entirely) and `neoUpperEnergy.test.ts` kills it ALONE. 🛑 **THE FIRST DRAFT
    // OF THIS COMMENT CLAIMED A THIRD DIRECTION AND THE PROBE REFUTED IT**:
    // `reversalEnergy.test.ts` SURVIVES this mutant, because Reversal's own gate
    // IS `isEvolutionPokemon` and `!isBasicPokemon` agrees with it on every
    // Pokémon body. A row's killer set is a measurement, not a story about which
    // cards the mutation is 'about' — D300 wrote that lesson one row down and
    // this slice paid it again in the opposite direction.
    find: "      matches(top) &&",
    replace: "      !isBasicPokemon(top) &&",
    expectKilledBy: [
      "packages/engine/src/neoUpperEnergy.test.ts",
      "packages/engine/src/prismEnergy.test.ts",
    ],
  },
  {
    id: "D262-two-at-a-time-becomes-one",
    decision: "D262",
    what: '🛑 the promoted units drop to a SINGLE wildcard, so "provides every type of Energy but provides only 2 Energy at a time" silently becomes Luminous\'s "only 1 at a time". `costMet` consumes a FLAT LIST, so this pays every one-symbol cost and fails only a two-symbol one — a suite that drove a {P} attack and stopped there would never see it, which is why the row drives {P}{W} off the single card',
    file: "packages/engine/src/registry.ts",
    find: '{ stage: "Stage2", units: [ANY_ENERGY, ANY_ENERGY] },',
    replace: '{ stage: "Stage2", units: [ANY_ENERGY] },',
    expectKilledBy: ["packages/engine/src/neoUpperEnergy.test.ts"],
  },
  {
    id: "D262-stage-read-is-stamped-not-live",
    decision: "D262",
    what: "🛑 the stage is read off the BOTTOM of the holder's stack instead of the top, which is the STAMPED reading — the identity the body had when the Energy was attached rather than the one it has now. Every static board in the suite still passes (a fresh body's bottom card IS its top card); only the board that EVOLVES a Stage 1 into a Stage 2 with the card already attached can tell the two apart, and that is the sharpest thing the row asserts",
    file: "packages/engine/src/continuous.ts",
    find: "    const top = topCardOf(state, pokemon);",
    replace: '    const top = cardOfUid(state, pokemon.stack[0] ?? "");',
    expectKilledBy: [
      "packages/engine/src/neoUpperEnergy.test.ts",
      "packages/engine/src/prismEnergy.test.ts",
    ],
  },

  // ── 🆕 D300 — PRISM ENERGY `sv10.5b-086`, THE SECOND CARRIER OF THE STAGE-GATED
  // PROVISION AND THE ROW THAT TURNED D262's FIELD NAME INTO A FIELD VALUE.
  // FOUR mutants. Two of them exist only because there are now TWO carriers: a
  // dispatch that ignores `promote.stage` was UNTESTABLE while one printing
  // carried the field, and is the exact defect the rename was made to expose.
  //
  // ⚠️ NO MUTANT AGAINST `provides: ["Colorless"]` — Jet's, Spiky's and Mist's
  // shipped line, and Neo Upper's mutant block says the same thing above.
  // ⚠️ AND NO SECOND "stamped, not live" ROW: the D262 mutant directly above now
  // anchors on `topCardOf` ALONE and both suites kill it, which is strictly
  // better than a per-decision copy of one line.
  {
    id: "D300-prism-provision-unwired",
    decision: "D300",
    what: "\u{1F6D1} Prism Energy's registry row loses `promoteOnHolderStage`, so its second printed paragraph does nothing at all and the card is a plain {C} provider on every body. This is the row's EXISTENCE claim; the {C} half still works, so every board that only pays Colorless stays green — and Neo Upper is untouched, so `neoUpperEnergy.test.ts` cannot save it",
    file: "packages/engine/src/registry.ts",
    find:
      '    provides: ["Colorless"],\n    promoteOnHolderStage: { stage: "Basic", units: [ANY_ENERGY] },',
    replace: '    provides: ["Colorless"],',
    expectKilledBy: ["packages/engine/src/prismEnergy.test.ts"],
  },
  {
    id: "D300-stage-dispatch-inverted",
    decision: "D300",
    what: "\u{1F6D1} the two stage predicates are SWAPPED, so Prism promotes on a Stage 2 and Neo Upper on a Basic — each card firing on the other's board. This is the failure the `{ stage, units }` shape exists to make impossible, and it was NOT EXPRESSIBLE before this slice: with one carrier the value had nothing to disagree with. It kills in BOTH suites, in opposite directions",
    file: "packages/engine/src/continuous.ts",
    // ⚠️ RE-POINTED AT D302: the ternary grew a third arm ("Evolution"), so
    // the anchor is the whole dispatch. The swap is still Basic↔Stage2 and the
    // Evolution arm is deliberately LEFT ALONE, which keeps the row about the two
    // values that can be confused for each other.
    find:
      '      promote.stage === "Basic"\n        ? isBasicPokemon\n        : promote.stage === "Stage2"\n          ? isStage2Pokemon\n          : isEvolutionPokemon;',
    replace:
      '      promote.stage === "Basic"\n        ? isStage2Pokemon\n        : promote.stage === "Stage2"\n          ? isBasicPokemon\n          : isEvolutionPokemon;',
    expectKilledBy: [
      "packages/engine/src/prismEnergy.test.ts",
      "packages/engine/src/neoUpperEnergy.test.ts",
    ],
  },
  {
    id: "D300-stage-value-ignored",
    decision: "D300",
    what: "\u{1F6D1} the dispatch stops reading `promote.stage` at all and every carrier gates on BASIC — the defect a sibling boolean field would have made unreachable, because with two fields there is no dispatch to get wrong. ⚠️ **MEASURED, NOT ASSUMED, AND THE FIRST DRAFT OF THIS SENTENCE WAS WRONG**: it claimed Prism stays entirely correct so ONLY Neo Upper could tell. Both suites kill it — neoUpperEnergy by 9 assertions (its Stage 2 promotes no more) and prismEnergy by 1 (§2's cross-board test drives NEO UPPER on a Basic and would see it promote). A row's killer set is a measurement, not a story about which card the mutation is 'about'",
    file: "packages/engine/src/continuous.ts",
    // ⚠️ RE-POINTED AT D302 for the same reason as the row above.
    find:
      '      promote.stage === "Basic"\n        ? isBasicPokemon\n        : promote.stage === "Stage2"\n          ? isStage2Pokemon\n          : isEvolutionPokemon;',
    replace: "      isBasicPokemon;",
    expectKilledBy: [
      "packages/engine/src/neoUpperEnergy.test.ts",
      "packages/engine/src/prismEnergy.test.ts",
    ],
  },
  {
    id: "D300-one-at-a-time-becomes-two",
    decision: "D300",
    what: '\u{1F6D1} Prism\'s promoted units grow to TWO wildcards, so "provides every type of Energy but provides only **1** Energy at a time" silently becomes Neo Upper\'s two. `costMet` consumes a FLAT LIST, so this pays a two-symbol cost the card must NOT pay — invisible on every one-symbol attack, which is why the suite drives {P}{W} off the single attached card. The exact MIRROR of `D262-two-at-a-time-becomes-one`',
    file: "packages/engine/src/registry.ts",
    find: '{ stage: "Basic", units: [ANY_ENERGY] },',
    replace: '{ stage: "Basic", units: [ANY_ENERGY, ANY_ENERGY] },',
    expectKilledBy: ["packages/engine/src/prismEnergy.test.ts"],
  },

  // ── 🆕 D302 — REVERSAL ENERGY `sv04-266`, THE THREE-TERM ANTECEDENT. FOUR
  // mutants, one per NEW claim and no more. The three terms are INDEPENDENT
  // conjuncts, so each earns a row: dropping any one of them leaves the other two
  // green on every board in every neighbouring suite, which is exactly the shape
  // that hides in a conjunction.
  //
  // ⚠️ NO MUTANT AGAINST `stage: "Evolution"` ITSELF. The value is already covered
  // from BOTH sides by rows that predate this slice: `D300-stage-value-ignored`
  // forces every carrier to Basic and `D262-stage-gate-widens-to-any-evolution`
  // forces every carrier to "not a Basic" — and the second of those is now
  // measurably a THREE-direction defect rather than the one-direction one its
  // `what` described when it was written. A fifth row spelling "Evolution reads as
  // Stage 2" would move the same assertions those two already move.
  {
    id: "D302-prize-comparison-inverted",
    decision: "D302",
    what: "\u{1F6D1} the prize comparison FLIPS, so Reversal promotes while its holder's side is AHEAD on Prizes remaining instead of behind — the card fires when you are WINNING. ⚠️ THE POLARITY IS THE ONE THING IN THIS ROW THAT CANNOT BE SEEN ON A NATURAL BOARD: a fresh game is 6–6 and the comparison is STRICT, so the level board answers {C} under BOTH readings, and a suite that drove only 'it promotes' plus 'it does not promote at 6–6' is green on this mutant. Only a board where the seat is strictly AHEAD tells them apart, and `reversalEnergy.test.ts` §2 writes exactly that board",
    file: "packages/engine/src/continuous.ts",
    find: "    return side.prizes.length > state.players[otherSeat(seat)].prizes.length;",
    replace: "    return side.prizes.length < state.players[otherSeat(seat)].prizes.length;",
    expectKilledBy: ["packages/engine/src/reversalEnergy.test.ts"],
  },
  {
    id: "D302-rule-box-rider-dropped",
    decision: "D302",
    what: "\u{1F6D1} the `noRuleBox` term is dropped from the conjunction, so a Charizard-ex-shaped Evolution promotes exactly as a Rule-Box-less one does. ⚠️ THE RIDER IS OPTIONAL, WHICH IS WHY THIS IS INVISIBLE TO EVERY OTHER SUITE: Neo Upper and Prism set it to `undefined`, so the term they take is `true` either way and neither of their files can see this change at all. The killer is `fix-reversal-ex`, which is `fix-reversal-stage1` in every field except the NAME `hasRuleBox` parses",
    file: "packages/engine/src/continuous.ts",
    find: "      (promote.noRuleBox !== true || !hasRuleBox(top)) &&",
    replace: "      (promote.noRuleBox !== true || true) &&",
    expectKilledBy: ["packages/engine/src/reversalEnergy.test.ts"],
  },
  {
    id: "D302-prize-rider-dropped",
    decision: "D302",
    what: "\u{1F6D1} the `whileMorePrizesRemaining` term is dropped, so Reversal promotes on ANY prize row — including the 6–6 board every game opens on. The sibling of the row above and the mate of `D302-prize-comparison-inverted`: that one keeps the term and inverts it, this one deletes it. ⚠️ Both are needed, because a build could ship EITHER defect and the boards that catch them are disjoint — an inverted comparison is green at 6–6 and a missing term is RED there",
    file: "packages/engine/src/continuous.ts",
    find:
      "      (promote.whileMorePrizesRemaining !== true || holderSideLeadsOnPrizesRemaining(state, pokemon))",
    replace: "      (promote.whileMorePrizesRemaining !== true || true)",
    expectKilledBy: ["packages/engine/src/reversalEnergy.test.ts"],
  },
  {
    id: "D302-three-at-a-time-becomes-two",
    decision: "D302",
    what: "\u{1F6D1} Reversal's promoted units drop to TWO wildcards, so \"provides every type of Energy but provides only **3** Energy at a time\" silently becomes Neo Upper's two. The family's THIRD instance of this row (`D262-two-at-a-time-becomes-one`, `D300-one-at-a-time-becomes-two`), and it earns its place because the three carriers now hold three DISTINCT counts: `costMet` consumes a FLAT LIST, so this still pays every two-symbol cost and fails only the THREE-different-type one `reversalEnergy.test.ts` §4 drives off the single attached card",
    file: "packages/engine/src/registry.ts",
    find: "      units: [ANY_ENERGY, ANY_ENERGY, ANY_ENERGY],",
    replace: "      units: [ANY_ENERGY, ANY_ENERGY],",
    expectKilledBy: ["packages/engine/src/reversalEnergy.test.ts"],
  },

  // ── D303 — THE ACE SPEC **DRAG** POPULATION. Both rows measured by hand
  //    against a green 6,213 before they were recorded, by substituting, running
  //    the FULL suite and undoing by INVERSE SUBSTITUTION with `git diff` empty.
  //    🛑 **AND A THIRD CANDIDATE IS UNWRITABLE, WHICH IS D293's KIND AND ITS
  //    SECOND INSTANCE.** §6.1/§6.2 assert the partition itself — 20 / 2 / 8 / 3,
  //    summing to 33, with `11` the no-row set and `13` the drag-reachable one.
  //    **No expression at any source site carries any of those numbers**: the ids
  //    come from a D1 transcription and the two subsets are built in the test.
  //    There is nothing to perturb, so the row is not unkillable for want of a
  //    test — it is UNWRITABLE for want of a site, exactly as D293's barred-drop
  //    row was. The census assertion's guard is a REDERIVATION, not a mutant.
  {
    id: "D303-stadium-drag-never-offered",
    decision: "D303",
    what: "\u{1F6D1} THE STADIUM DROP GATE STOPS OFFERING THE SHARED SLOT: `target.owner === \"global\"` becomes `!==`, so no Stadium can be dragged at all. **THIS IS THE LINE THE WHOLE D303 FINDING TURNS ON** — it is the fourth `sourceType` arm in `placement.ts`, three lines below the Tool's, and its existence is why the ACE SPEC DRAG population is **13** and not the **11** ten handoffs quoted. \u26a0\ufe0f **MEASURED BY PERFORMING IT: 5 of 6,213 repo-wide across TWO files \u2014 3 in `GameHud.aceSpecBar.dom.test.tsx` \u00a76 (the barred drag, its plain-Stadium control and its unarmed-board control) and 2 in `placement.test.ts` (the lockstep sweep and the \u00a77.3 routing `it`), ZERO elsewhere.** \ud83c\udd95 **AND THE 2 ARE THE FINDING AS MUCH AS THE 3**: the line was ALREADY pinned, by a suite that never mentions ACE SPEC \u2014 so the drag surface was always driven and only its INTERACTION with the bar was not. **THE CORPUS HELD NO `placement.ts` ROW AT ALL BEFORE THIS ONE**, which is why a file the client's whole drag story rests on had no mutant of its own",
    file: "src/features/game/placement.ts",
    find: '      return target.zone === "stadium" && target.owner === "global";',
    replace: '      return target.zone === "stadium" && target.owner !== "global";',
    expectKilledBy: [
      "src/features/game/GameHud.aceSpecBar.dom.test.tsx",
      "src/features/game/placement.test.ts",
    ],
  },
  {
    id: "D303-tool-surface-drops-the-rarity-arm",
    decision: "D303",
    what: "\u{1F6D1} THE `attachTool` SURFACE STOPS ASKING ABOUT THE CARD: `handPlayBarred(state, action.seat, \"Tool\", card)` becomes `\u2026, undefined)`, so `isAceSpec` answers `false` and an ACE SPEC Tool attaches on a fully barred board. \u26a0\ufe0f **MEASURED: 2 of 6,213 repo-wide, ZERO elsewhere \u2014 `aceSpecBar.test.ts` \u00a74's `attachTool` gate and `GameHud.aceSpecBar.dom.test.tsx` \u00a76.6's end-to-end drag.** \ud83c\udd95 **THE CLIENT KILL IS NEW AND IT IS THE POINT OF THE ROW.** \u00a72 of that file asserts the ACE SPEC Tool has NO ROW in the Trainers list and every slice since read that as settling the Tool; it settles the BUTTON surface only. \u00a76.6 drives the DRAG \u2014 offered, translated to a real `attachTool`, refused `HAND_PLAY_BLOCKED` \u2014 so this row now crosses the package boundary the way `D292-energy-gate-never-fires` did, and for the same reason: **an absence asserted on one surface is not a measurement on another**",
    file: "packages/engine/src/cardplay.ts",
    find: '  if (handPlayBarred(state, action.seat, "Tool", card)) {',
    replace: '  if (handPlayBarred(state, action.seat, "Tool", undefined)) {',
    expectKilledBy: [
      "packages/engine/src/aceSpecBar.test.ts",
      "src/features/game/GameHud.aceSpecBar.dom.test.tsx",
    ],
  },

  // ── D263 — THE ABILITY HALF OF BACKLOG ROW 9 (attach from the DISCARD PILE).
  // FIVE mutants, one per NEW claim and no more. Every one lands in
  // `registry.ts`, because the whole engine diff is `registry.ts` — three
  // hand-authored programs over ops that already existed.
  //
  // ⚠️ NO MUTANT AGAINST `source: "discard"`, which is `SEETHING_SPIRIT`'s
  // shipped line and D234's claim — breaking it would be re-testing an older
  // row. ⚠️ AND NO MUTANT AGAINST `optional: true` on the trigger:
  // `TriggeredAbility.optional` AUTO-FIRES, so the flag changes no behaviour
  // today and is killed by the DECLARATION snapshot alone. Said out loud rather
  // than papered over — the same verdict D250 recorded for its own.
  {
    id: "D263-charging-up-loses-toself",
    decision: "D263",
    what: "🛑 Charging Up drops `toSelf` and becomes Seething Spirit — 'to this Pokémon' silently widens to 'to 1 of your Pokémon'. The attach STILL SUCCEEDS on any board with one own body, so every hand-count and pile-count assertion stays green; only a board with a SECOND eligible body can tell, because the op stops forcing and PARKS",
    file: "packages/engine/src/registry.ts",
    find: '      program: [{ op: "attachEnergyFrom", source: "discard", toSelf: true }],',
    replace: '      program: [{ op: "attachEnergyFrom", source: "discard" }],',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D263-dynamotor-loses-benchonly",
    decision: "D263",
    what: "🛑 Dynamotor drops `benchOnly`, so 'to 1 of your Benched Pokémon' becomes 'to 1 of your Pokémon' — and the HOLDER is the Active on every board this Ability is used from, so `attachEnergyTargets` offers it FIRST. A suite that only asserted 'the Bench gained an Energy' would never see this",
    file: "packages/engine/src/registry.ts",
    find: '        { op: "attachEnergyFrom", source: "discard", energyType: "Lightning", benchOnly: true },',
    replace: '        { op: "attachEnergyFrom", source: "discard", energyType: "Lightning" },',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D263-dynamotor-loses-energy-type",
    decision: "D263",
    what: "🛑 Dynamotor drops `energyType`, so 'a Basic {L} Energy card' becomes any Basic Energy. Invisible on every board whose pile holds only Lightning — which is the board an author naturally writes — and caught only by the Colorless-pile case, where the Ability must be REFUSED outright rather than attach the wrong card",
    file: "packages/engine/src/registry.ts",
    find: '        { op: "attachEnergyFrom", source: "discard", energyType: "Lightning", benchOnly: true },',
    replace: '        { op: "attachEnergyFrom", source: "discard", benchOnly: true },',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D263-assemble-alloy-welds-into-one-count",
    decision: "D263",
    what: "🛑 Assemble Alloy's TWO ops collapse into ONE carrying `count: 2` — the exact defect a reader who priced 'up to 2' and skipped 'in any way you like' ships (D205's distinction). Both readings move TWO Energy out of the pile and both ask a question, so every count-the-pile assertion agrees; they differ only in WHERE the second one lands, because `count` pins the batch to the ONE chosen body",
    file: "packages/engine/src/registry.ts",
    find: '        { op: "attachEnergyFrom", source: "discard", energyType: "Metal", targetType: "Metal" },\n        { op: "attachEnergyFrom", source: "discard", energyType: "Metal", targetType: "Metal" },',
    replace:
      '        { op: "attachEnergyFrom", source: "discard", energyType: "Metal", targetType: "Metal", count: 2 },',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D263-assemble-alloy-loses-target-type",
    decision: "D263",
    what: "🛑 Assemble Alloy's FIRST op drops `targetType`, so 'to your {M} Pokémon' widens to every own body — the brace code narrows the CARD out of the pile but no longer narrows who may receive it. The attach still lands, still moves a Basic {M}, and still parks; the only observable is the CANDIDATE SET, which is why the suite asserts its length and its members rather than the outcome",
    file: "packages/engine/src/registry.ts",
    find: '        { op: "attachEnergyFrom", source: "discard", energyType: "Metal", targetType: "Metal" },\n        { op: "attachEnergyFrom", source: "discard", energyType: "Metal", targetType: "Metal" },',
    replace:
      '        { op: "attachEnergyFrom", source: "discard", energyType: "Metal" },\n        { op: "attachEnergyFrom", source: "discard", energyType: "Metal", targetType: "Metal" },',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },

  // ── D264 — BACKLOG ROW 13's ABILITY AND TRAINER HALVES (the discard pile into
  // the HAND). SEVEN mutants: five in `registry.ts` (the two hand-authored
  // programs) and two in the engine, one per NEW rider read site.
  //
  // ⚠️ NO MUTANT AGAINST `anyOf`'s `.some` — D245 already owns that claim twice
  // over (`D245-anyOf-is-an-intersection`, `D245-anyOf-admits-everything`), and
  // this slice's contribution there is a WITNESS rather than a claim: those two
  // rows were previously killed by an aura's fold, and Lana's Aid now makes them
  // killable through a PROMPT as well. Adding a third row would be re-testing an
  // older decision with a newer board. ⚠️ AND NO MUTANT AGAINST `optional: true`
  // on Greedy Order's trigger, for D250's and D263's reason: the flag auto-fires,
  // so it changes no behaviour today and the declaration snapshot alone kills it.
  {
    id: "D264-lanas-aid-loses-norulebox",
    decision: "D264",
    what: "🛑 Lana's Aid drops `noRuleBox`, so \"Pokémon that don't have a Rule Box\" silently widens to Max Rod's bare \"Pokémon\" and the printed parenthetical becomes a sentence the engine does not read. The Supporter still parks, still offers Pokémon, still moves them to the hand — every count-and-destination assertion stays green. The ONLY observable is that a Pokémon ex sitting in the same pile becomes a legal pick",
    file: "packages/engine/src/registry.ts",
    find: '        filters: [{ kind: "anyPokemon", noRuleBox: true }, { kind: "basicEnergy" }],',
    replace: '        filters: [{ kind: "anyPokemon" }, { kind: "basicEnergy" }],',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D264-lanas-aid-narrows-to-basic-only",
    decision: "D264",
    what: "🛑 Lana's Aid reaches for the member that ALREADY spelled the word — `basicPokemon.noRuleBox`, Artazon's filter — instead of the stage-free one this slice built. It compiles, it captions almost right (\"Basic Pokémon that don't have a Rule Box\"), it excludes the ex correctly, and it silently refuses every Stage 1 / Stage 2 in the pile. This is the exact defect the rider exists to prevent, and `fix-plainstage1` is the only card on any board that can see it",
    file: "packages/engine/src/registry.ts",
    find: '        filters: [{ kind: "anyPokemon", noRuleBox: true }, { kind: "basicEnergy" }],',
    replace: '        filters: [{ kind: "basicPokemon", noRuleBox: true }, { kind: "basicEnergy" }],',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D264-lanas-aid-takes-max-rods-count",
    decision: "D264",
    what: "🛑 Lana's Aid takes `max: 5` — the value of Max Rod, the program it was modelled on and whose sentence differs from it by exactly two clauses. A pile holding three eligible cards offers all three under either number, so only the PROMPT's own `max` can tell them apart",
    file: "packages/engine/src/registry.ts",
    find: '      dest: "hand",\n      max: 3,\n    },\n  ],\n};',
    replace: '      dest: "hand",\n      max: 5,\n    },\n  ],\n};',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D264-matches-filter-ignores-norulebox",
    decision: "D264",
    what: "🛑 the ENGINE side of the same claim: `matchesFilter`'s `anyPokemon` arm drops the `noRuleBox` conjunct and answers the old question for the new filter. Every registry row that spells the rider still COMPILES and still reads as narrowed — the predicate simply stops narrowing, which is the quiet direction and the one a registry-only mutant cannot reach",
    file: "packages/engine/src/cards.ts",
    find: '      return card.category === "Pokemon" && (filter.noRuleBox !== true || !hasRuleBox(card));',
    replace: '      return card.category === "Pokemon";',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D264-retrieve-noun-drops-norulebox-phrase",
    decision: "D264",
    what: "🛑 `retrieveNoun`'s `anyPokemon` arm always returns the BARE phrase, so the dialog reads \"Put up to 3 Pokémon or Basic Energy cards…\" over a candidate set that has already excluded the ex. The engine does the right thing and TELLS THE PLAYER something else — the caption contradicting its own validator, which is the defect `attachFromDeckNote` names one function over. No behavioural assertion can see it; only a note assertion can",
    file: "packages/engine/src/interpreter.ts",
    find: '            plural: "Pokémon that don\'t have a Rule Box",',
    replace: '            plural: "Pokémon",',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D264-greedy-order-byname-becomes-item",
    decision: "D264",
    what: "🛑 Greedy Order's `byName` becomes `item` — the CATEGORY of the card it names rather than the card. \"up to 2 Arven's Sandwich cards\" turns into \"up to 2 Item cards\", which is a strictly wider offer that still parks, still moves two cards to the hand, and still empties the right zone. The only board that can see it is one whose pile holds a SECOND Item that is not the named card",
    file: "packages/engine/src/registry.ts",
    find: "          filter: { kind: \"byName\", name: \"Arven's Sandwich\", cardNoun: true },",
    replace: '          filter: { kind: "item" },',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D264-greedy-order-loses-card-noun",
    decision: "D264",
    what: "🛑 Greedy Order drops `cardNoun`, so the prompt reads \"Put up to 2 Arven's Sandwich from your discard pile into your hand.\" — `byName`'s bare arm, which exists for Flamigo, whose printed noun really is invariant. NOTHING about which cards match changes, so every candidate, destination and count assertion is green; this is a caption-only claim and is asserted as one",
    file: "packages/engine/src/registry.ts",
    find: "          filter: { kind: \"byName\", name: \"Arven's Sandwich\", cardNoun: true },",
    replace: "          filter: { kind: \"byName\", name: \"Arven's Sandwich\" },",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  // ── D265 — THE HP-THRESHOLD `CardFilter` RIDER (`basicPokemon.maxHp`). ONE
  //    optional rider read by TWO ops, so the mutants come in matched pairs: a
  //    REGISTRY mutant (this row spelled the filter wrong) and an ENGINE mutant
  //    (the rider stopped narrowing / stopped captioning) for each read site.
  //    ⚠️ The rider is BOTH a predicate rider and a caption rider, which is why the
  //    `retrieveNoun` mutants below cannot be killed by any board assertion — only
  //    by a note assertion — and the `matchesFilter` one cannot be killed by any
  //    note. Neither would be caught by testing the other. ──
  {
    id: "D265-matches-filter-ignores-maxhp",
    decision: "D265",
    what: "🛑 `matchesFilter`'s `basicPokemon` arm drops the `maxHp` conjunct entirely. Every registry row that spells the threshold still COMPILES and still reads as narrowed; the predicate simply stops narrowing, so Buddy-Buddy Poffin benches 200 HP bodies and Gentle Fin offers them. The quiet direction, and the one no registry-only mutant can reach",
    file: "packages/engine/src/cards.ts",
    find: "        (filter.maxHp === undefined || (hp !== null && hp <= filter.maxHp))",
    replace: "        (filter.maxHp === undefined || true)",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D265-matches-filter-admits-null-hp",
    decision: "D265",
    what: "🛑 the NULL arm alone: `hp !== null &&` is dropped, so the comparison decides. `null <= 70` is TRUE in JavaScript, which means every card whose printed hp is missing or non-positive passes the threshold. `isBasicPokemon` hides it on the two shipped boards (a Trainer is refused one conjunct earlier), so the only thing that can see it is a predicate-level assertion on a gap row — which is why this slice writes two",
    file: "packages/engine/src/cards.ts",
    find: "        (filter.maxHp === undefined || (hp !== null && hp <= filter.maxHp))",
    replace: "        (filter.maxHp === undefined || (hp as number) <= filter.maxHp)",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D265-matches-filter-threshold-is-exclusive",
    decision: "D265",
    what: "🛑 `<=` becomes `<`, so the printed \"70 HP or less\" refuses a body at exactly 70. No fixture in the demonstrator pool sits on the line and no legal Basic in the catalog is printed at 70 either, so every board is green — the boundary is only visible to an assertion on the predicate itself, driven on a card labelled CONSTRUCTED",
    file: "packages/engine/src/cards.ts",
    find: "        (filter.maxHp === undefined || (hp !== null && hp <= filter.maxHp))",
    replace: "        (filter.maxHp === undefined || (hp !== null && hp < filter.maxHp))",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D265-retrieve-noun-drops-maxhp-phrase",
    decision: "D265",
    what: "🛑 `retrieveNoun`'s new branch never fires, so both prompts read \"a Basic Pokémon\" / \"Basic Pokémon\" over a candidate set that has already dropped everything above the line. The engine does the right thing and TELLS THE PLAYER something wider — the caption contradicting its own validator. Behaviourally invisible: only a note assertion kills it, and there is one per op",
    file: "packages/engine/src/interpreter.ts",
    find: "      if (filter.maxHp !== undefined && filter.noRuleBox !== true)",
    replace: "      if (false)",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D265-retrieve-noun-hardcodes-seventy",
    decision: "D265",
    what: "🛑 the threshold is interpolated out of the filter and hard-coded to 70 instead. BOTH shipped sentences print 70, so every assertion in this repo is green today and the line only lies when a slice authors Fan Rotom (100) or Clavell (120) — the caption would then name a narrower set than the rows under it. Kept as a mutant precisely because it is the one that survives the CURRENT pool: it is killed by the tie between the note and the op's own number, not by a board",
    file: "packages/engine/src/interpreter.ts",
    find: "          singular: `a Basic Pokémon with ${filter.maxHp} HP or less`,\n          plural: `Basic Pokémon with ${filter.maxHp} HP or less`,",
    replace: '          singular: "a Basic Pokémon with 60 HP or less",\n          plural: "Basic Pokémon with 60 HP or less",',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D265-poffin-loses-the-threshold",
    decision: "D265",
    what: "🛑 Buddy-Buddy Poffin becomes NEST BALL's filter — the bare `basicPokemon` it was modelled on. The card still searches, still benches two, still shuffles; it just offers every Basic in the deck, which on a deck that is mostly 200 HP filler is the difference between the printed card and a strictly better one",
    file: "packages/engine/src/registry.ts",
    find: '    { op: "searchDeck", filter: { kind: "basicPokemon", maxHp: 70 }, dest: "bench", max: 2 },',
    replace: '    { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 2 },',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D265-poffin-drops-the-shuffle",
    decision: "D265",
    what: "🛑 the trailing `shuffleDeck` op goes. The printed \"Then, shuffle your deck.\" is its own sentence and its own op, and dropping it leaves a player who searched the deck knowing its order — a real information leak that no candidate-set or destination assertion can see",
    file: "packages/engine/src/registry.ts",
    find: '    { op: "searchDeck", filter: { kind: "basicPokemon", maxHp: 70 }, dest: "bench", max: 2 },\n    { op: "shuffleDeck" },',
    replace: '    { op: "searchDeck", filter: { kind: "basicPokemon", maxHp: 70 }, dest: "bench", max: 2 },',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D265-gentle-fin-works-from-the-bench",
    decision: "D265",
    what: "🛑 `activeOnly: false` on Gentle Fin. The printed \"if this Pokémon is in the Active Spot\" is a clause, not flavour, and this is the card it matters most on: Alomomola's whole job is filling the Bench, so a build that works FROM the Bench turns one use per turn into a body that never has to be exposed. Every candidate, caption and destination assertion is green",
    file: "packages/engine/src/registry.ts",
    find: '      name: "Gentle Fin",\n      oncePerTurn: true,\n      activeOnly: true,',
    replace: '      name: "Gentle Fin",\n      oncePerTurn: true,\n      activeOnly: false,',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D265-gentle-fin-retrieves-to-the-hand",
    decision: "D265",
    what: "🛑 Gentle Fin's `dest` becomes `\"hand\"` — Lana's Aid's destination on the SAME op, and the value every other `discardPileRetrieval` row in the registry but one carries. The card would return a body to the hand instead of putting it into play, which is a different card; and the prompt's own caption changes with it, so this one dies twice over",
    file: "packages/engine/src/registry.ts",
    find: '          filter: { kind: "basicPokemon", maxHp: 70 },\n          dest: "bench",\n          max: 1,',
    replace: '          filter: { kind: "basicPokemon", maxHp: 70 },\n          dest: "hand",\n          max: 1,',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  // ── D266 — THE TYPE GATE ON `healEach` (`pokemonType`). ONE optional op field
  //    read at ONE site, so the mutants split the usual way: FOUR ENGINE mutants
  //    (the gate stopped narrowing / narrowed the wrong way / narrowed the wrong
  //    SENTENCE) and TWO REGISTRY ones (this row spelled the gate wrong).
  //    ⚠️ It is a PREDICATE rider and NOT a caption rider — `healEach` never
  //    parks and prints no prompt — so every one of these is killed by a BOARD
  //    assertion and none of them by a note. That is the whole difference from
  //    D265's matched pairs, and it is why there is no `retrieveNoun` half. ──
  {
    id: "D266-heal-each-drops-the-type-gate",
    decision: "D266",
    what: "🛑 the `pokemonType` conjunct inside `healEach`'s loop stops narrowing. Every registry row that spells the gate still COMPILES and still reads as gated; Clemont's Quick Wit simply becomes Fennel with a bigger number, healing the COLORLESS bench body too. The quiet direction, and the one no registry-only mutant can reach",
    file: "packages/engine/src/interpreter.ts",
    find: "      if (!(card?.types ?? []).includes(pokemonType)) return pokemon;",
    replace: "      if (false) return pokemon;",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D266-heal-each-gate-is-equality-not-includes",
    decision: "D266",
    what: "🛑 `types` is compared at index 0 instead of by `includes`, so a body printed {M}{L} stops being a \"{L} Pokémon\". Every single-type assertion in this repo is green under it — the ONLY witness is `fix-dualtypebody`, a fixture this slice invented for exactly this mutant. A list read as a scalar is the defect a one-type pool cannot see",
    file: "packages/engine/src/interpreter.ts",
    find: "      if (!(card?.types ?? []).includes(pokemonType)) return pokemon;",
    replace: "      if ((card?.types ?? [])[0] !== pokemonType) return pokemon;",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D266-heal-each-absent-gate-means-colorless",
    decision: "D266",
    what: "🛑 an ABSENT `pokemonType` is defaulted to `Colorless` instead of meaning UNGATED. Clemont's Quick Wit is untouched and every assertion this slice wrote stays green; what breaks is FENNEL — the printed \"each of your Pokémon\" would stop healing a {L} body. The attribution control is the only thing that can see it, which is why the suite drives the ungated sentence on the same board",
    file: "packages/engine/src/interpreter.ts",
    find: "    if (pokemonType !== undefined) {\n      const card = topCardOf(state, pokemon);\n      if (!(card?.types ?? []).includes(pokemonType)) return pokemon;\n    }",
    replace: "    {\n      const card = topCardOf(state, pokemon);\n      if (!(card?.types ?? []).includes(pokemonType ?? \"Colorless\")) return pokemon;\n    }",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D266-heal-each-gate-is-inverted",
    decision: "D266",
    what: "🛑 the gate keeps exactly the bodies it should skip: the Colorless bench body heals and both {L} ones do not. Killed by the damage assertions AND by the uid assertion on the HEALED rows, which is the point of asserting both — a build that healed the wrong SET would otherwise be told apart only by which numbers moved",
    file: "packages/engine/src/interpreter.ts",
    find: "      if (!(card?.types ?? []).includes(pokemonType)) return pokemon;",
    replace: "      if ((card?.types ?? []).includes(pokemonType)) return pokemon;",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D266-quick-wit-loses-the-gate",
    decision: "D266",
    what: "🛑 Clemont's Quick Wit drops `pokemonType` and becomes FENNEL's program at 60 — the card it was modelled on, and the mis-authoring an author actually makes when the neighbouring row is one field shorter. It still heals, still clamps, still stays on its own side of the table; it just heals bodies the print does not name",
    file: "packages/engine/src/registry.ts",
    find: "  trainer: [{ op: \"healEach\", amount: 60, pokemonType: \"Lightning\" }],",
    replace: "  trainer: [{ op: \"healEach\", amount: 60 }],",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D266-quick-wit-gates-on-colorless",
    decision: "D266",
    what: "🛑 the printed brace code `{L}` is read as `Colorless` rather than `Lightning` — the field is a `PokemonType` and BOTH are members, so the TYPE cannot refuse it and only a board can. It is the live mis-reading on this axis: `Colorless` is the pool's default type, so a gate on it looks like no gate at all on most fixtures and heals precisely the bodies the print excludes",
    file: "packages/engine/src/registry.ts",
    find: "  trainer: [{ op: \"healEach\", amount: 60, pokemonType: \"Lightning\" }],",
    replace: "  trainer: [{ op: \"healEach\", amount: 60, pokemonType: \"Colorless\" }],",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },

  // ── D267 — THE STAGE GATE ON `noRetreatCostAura` (`stage: "Basic"`). Latias ex
  //    "Skyliner", `sv08-076`/`-220`/`-239`. Six rows, and the split is the same
  //    one D266 used: THREE on the engine conjunct (`continuous.ts`) and THREE on
  //    the registry data. What is different is that this scan holds TWO bodies at
  //    the moment the clause is evaluated — the HOLDER's card (`top`) and the
  //    TARGET (`pokemon`) — so the interesting mutants are not "drop it" but
  //    "point it at the other one" and "apply it when it is ABSENT". Latias ex is
  //    itself a Basic, which is exactly why a holder-side read is invisible to
  //    every positive assertion and needs the Stage-1 target to see it. ──
  {
    id: "D267-stage-gate-dropped",
    decision: "D267",
    what: "🛑 the `stage` conjunct stops narrowing. The registry row still spells `stage: \"Basic\"` and still reads as gated; Skyliner simply becomes Lunar Zone without the energy clause, freeing every body on its controller's side including Evolutions. The loud direction, and the one a registry-only mutant cannot reach",
    file: "packages/engine/src/continuous.ts",
    find: '      if (aura.stage === "Basic" && (targetTop === undefined || !isBasicPokemon(targetTop)))\n        continue;',
    replace: "      if (false) continue;",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D267-stage-read-off-the-holder",
    decision: "D267",
    what: "🛑 THE MISTAKE THIS LOOP INVITES: the stage is read off `top` — the HOLDER's card, in scope one line up — instead of the TARGET's. Latias ex is a Basic, so the gate is satisfied by its own source on every board and the aura frees an EVOLUTION. Every positive assertion in the suite stays green; the ONLY witness is the Stage-1 target, which is why the deck carries a stage pair that is also a retreat pair",
    file: "packages/engine/src/continuous.ts",
    find: '      if (aura.stage === "Basic" && (targetTop === undefined || !isBasicPokemon(targetTop)))\n        continue;',
    replace: '      if (aura.stage === "Basic" && !isBasicPokemon(top)) continue;',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D267-absent-stage-means-basic",
    decision: "D267",
    what: "🛑 an ABSENT `stage` is defaulted to `\"Basic\"` instead of meaning UNGATED. Skyliner is untouched and every assertion this slice wrote about it stays green; what breaks is LUNAR ZONE — Clefable ex's printed \"All of your Pokémon that have {P} Energy attached\" would stop freeing an EVOLUTION carrying {P}. D266's `Colorless` trap, one axis over, and only the attribution control on the same board can see it",
    file: "packages/engine/src/continuous.ts",
    find: '      if (aura.stage === "Basic" && (targetTop === undefined || !isBasicPokemon(targetTop)))\n        continue;',
    replace: "      if (targetTop === undefined || !isBasicPokemon(targetTop)) continue;",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D267-basic-read-as-not-stage-2",
    decision: "D267",
    what: "🛑 \"Basic\" is read as \"not a Stage 2\" — the near-miss available in this very file (`isStage2Pokemon` is imported two lines from `isBasicPokemon`, and `unitsOf` right above calls it). A STAGE 1 would still be freed. It is the same class of defect D262 recorded on `matchesFilter`'s stage vocabulary: the axis is named correctly and the VALUE is wrong, and only an Evolution that is not a Stage 2 tells the two readings apart",
    file: "packages/engine/src/continuous.ts",
    find: '      if (aura.stage === "Basic" && (targetTop === undefined || !isBasicPokemon(targetTop)))\n        continue;',
    replace: '      if (aura.stage === "Basic" && (targetTop === undefined || isStage2Pokemon(targetTop)))\n        continue;',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D267-skyliner-gains-an-energy-clause",
    decision: "D267",
    what: "🛑 Skyliner is authored as `LUNAR_ZONE`'s record with a stage rider bolted on — the mis-authoring an author actually makes when both neighbours on the field spell `requiresEnergyType` and this print does not. It still frees Basics, just not the bare ones the printed sentence names, and no TYPE can refuse it because {P} is a real member",
    file: "packages/engine/src/registry.ts",
    find: 'const SKYLINER: CardProgram = { passive: { noRetreatCostAura: { stage: "Basic" } } };',
    replace:
      'const SKYLINER: CardProgram = {\n  passive: { noRetreatCostAura: { stage: "Basic", requiresEnergyType: "Psychic" } },\n};',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D267-skyliner-shares-lunar-zone",
    decision: "D267",
    what: "🛑 the reprint idiom applied one card too far: `sv08-220` is pointed at `LUNAR_ZONE` because the two sentences are about the same mechanism. They are not BYTE-IDENTICAL, so sharing would make a later edit to Clefable ex silently move a card that never printed its words — the exact defect `registryOnlyPrograms.test.ts`'s not-shared pairs exist for, asserted here on a THIRD table",
    file: "packages/engine/src/registry.ts",
    find: '  "sv08-220": SKYLINER, // Latias ex (special illustration rare) — same sentence',
    replace: '  "sv08-220": LUNAR_ZONE, // Latias ex (special illustration rare) — same sentence',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  // ── D268 — `handRefresh.who: "opponent"` (Gothitelle "Distorted Future"). The
  //    op's SOLE seat funnel is ONE expression and it now has THREE answers, so
  //    the interesting mutants are the two NEIGHBOURING arms — `[ctx.seat]` and
  //    `[ctx.seat, otherSeat(ctx.seat)]` — rather than "delete it". Each is green
  //    on a suite that reads ONE hand and red only on one that reads BOTH in the
  //    same breath, which is why every assertion in this row's suite does. ──
  {
    id: "D268-opponent-falls-through-to-you",
    decision: "D268",
    what: "🛑 THE FALLTHROUGH. `who: \"opponent\"` drops out of the funnel into the `\"you\"` arm, so the CONTROLLER shuffles their own hand away and draws 3 while the opponent is untouched — the card played backwards. A suite that only asserted \"p2 ends with 3 cards\" would go red here, but one that only asserted \"p1's hand is unchanged\" would NOT: this is the arm the second half of the two-seat assertion exists for",
    file: "packages/engine/src/interpreter.ts",
    find: "      : op.who === \"opponent\"\n        ? [otherSeat(ctx.seat)]\n        : [ctx.seat];",
    replace: "      : [ctx.seat];",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D268-opponent-widens-to-both",
    decision: "D268",
    what: "🛑 THE COPY-PASTE. `who: \"opponent\"` is served by Judge's arm, so BOTH hands go back and both players draw 3 — the controller pays for their own disruption. Every assertion about the OPPONENT's hand, deck and events stays green; the only witness is that p1's hand is byte-identical afterwards, which is the whole content of the member and the reason this suite reads two seats",
    file: "packages/engine/src/interpreter.ts",
    find: "      : op.who === \"opponent\"\n        ? [otherSeat(ctx.seat)]\n        : [ctx.seat];",
    replace: "      : op.who === \"opponent\"\n        ? [ctx.seat, otherSeat(ctx.seat)]\n        : [ctx.seat];",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D268-both-narrows-to-opponent",
    decision: "D268",
    what: "🛑 THE WIDENING RUNS THE OTHER WAY: the new member swallows the OLD one, so Judge and Iono stop touching the controller's hand. Nothing this slice wrote can see it — the whole D268 suite is green — and the killer is `handRefresh.test.ts`, the op's own M5 suite, which is the reason a one-member widening still has to re-run the arm it did not change",
    file: "packages/engine/src/interpreter.ts",
    find: "    op.who === \"both\"\n      ? [ctx.seat, otherSeat(ctx.seat)]",
    replace: "    op.who === \"both\"\n      ? [otherSeat(ctx.seat)]",
    expectKilledBy: ["packages/engine/src/handRefresh.test.ts"],
  },
  {
    id: "D268-distorted-future-draws-judges-four",
    decision: "D268",
    what: "🛑 the draw count comes off the neighbour instead of the print: 4 (Judge's value on the same op) rather than the printed 3. The seat is right, the zones are right, the events are right — only the number is wrong, which is the cheapest possible mis-transcription of a sentence whose other clauses are all flags",
    file: "packages/engine/src/registry.ts",
    find: '      program: [{ op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 3 } }],',
    replace: '      program: [{ op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 4 } }],',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D268-distorted-future-gains-ionos-tobottom",
    decision: "D268",
    what: "🛑 Iono's rider bolted on: the opponent's hand goes UNDER their deck instead of being shuffled INTO it, so their deck's order — and therefore their next draws — survive, and the card stops being disruption. The printed verb is \"shuffle their hand into their deck\"; the event type is the witness, and a suite asserting only hand SIZES cannot see it",
    file: "packages/engine/src/registry.ts",
    find: '      program: [{ op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 3 } }],',
    replace: '      program: [\n        { op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 3 }, toBottom: true },\n      ],',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D268-distorted-future-gains-onlyifanymoved",
    decision: "D268",
    what: "🛑 Iono's OTHER rider: the draw is skipped when the opponent moved nothing, so an opponent already holding no cards draws 0 instead of the printed 3 — which is the state the card is most often used to reach. This sentence has no \"if they do\" clause. Only the EMPTY-HAND case can see it, and it is green on every other board in the file",
    file: "packages/engine/src/registry.ts",
    find: '      program: [{ op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 3 } }],',
    replace: '      program: [\n        {\n          op: "handRefresh",\n          who: "opponent",\n          draw: { kind: "fixed", count: 3 },\n          onlyIfAnyMoved: true,\n        },\n      ],',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D268-distorted-future-works-from-the-bench",
    decision: "D268",
    what: "🛑 `activeOnly: false` — Skwovet's value, the OTHER Ability on this op, which really does work from the Bench. \"If this Pokémon is in the Active Spot\" is a printed clause, and a Gothitelle sitting benched behind a wall while it strips the opponent's hand every turn is a materially different card",
    file: "packages/engine/src/registry.ts",
    find: '      name: "Distorted Future",\n      oncePerTurn: true,\n      activeOnly: true,',
    replace: '      name: "Distorted Future",\n      oncePerTurn: true,\n      activeOnly: false,',
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  // ── D269 — `coinFlipGate.otherwise` (Picnicker svp-114, Drasna sv08-173/-231).
  //    The field's whole content is what the LOSING face does, so the mutants that
  //    matter all live at the ONE splice line: drop the arm (the pre-D269 meaning),
  //    swap the arms, or run BOTH. Each is green on a heads-only board, which is
  //    why the suite sweeps seeds and reads the face off the emitted coin row. ──
  {
    id: "D269-otherwise-is-never-spliced",
    decision: "D269",
    what: "🛑 THE PRE-D269 MEANING RESTORED: the losing face splices NOTHING, so Picnicker draws 4 or draws nothing and Drasna shuffles her hand away and draws 8 or draws NOTHING at all. This is the exact defect an `otherwise` that silently never runs has, and it is GREEN on every heads board in the file — only the tails rows of a swept suite can see it",
    file: "packages/engine/src/interpreter.ts",
    find: "        ...(face === (op.onTails === true ? \"tails\" : \"heads\") ? op.then : (op.otherwise ?? [])),",
    replace: "        ...(face === (op.onTails === true ? \"tails\" : \"heads\") ? op.then : []),",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D269-arms-are-swapped",
    decision: "D269",
    what: "🛑 THE ARMS SWAPPED — heads runs `otherwise` and tails runs `then`, which is `onTails` smuggled in through the wrong field. Every count assertion is still SATISFIABLE (2 and 4 both appear across a seed sweep); the only witness is that the count matches the face read off the SAME log line, which is why every assertion here is stated against `faceOf(events)` rather than against a chosen seed",
    file: "packages/engine/src/interpreter.ts",
    find: "        ...(face === (op.onTails === true ? \"tails\" : \"heads\") ? op.then : (op.otherwise ?? [])),",
    replace: "        ...(face === (op.onTails === true ? \"tails\" : \"heads\") ? (op.otherwise ?? []) : op.then),",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D269-both-arms-run",
    decision: "D269",
    what: "🛑 BOTH ARMS SPLICED — the gate stops being a gate. Picnicker draws 6 on every face and Drasna refreshes TWICE, which is the mistake a second `unshift` beside the first makes rather than a ternary. Killed by the CARDS_DRAWN row count as much as by the hand size: exactly one arm runs, so exactly one draw row is filed",
    file: "packages/engine/src/interpreter.ts",
    find: "        ...(face === (op.onTails === true ? \"tails\" : \"heads\") ? op.then : (op.otherwise ?? [])),",
    replace: "        ...op.then,\n        ...(op.otherwise ?? []),",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D269-picnicker-tails-draws-the-heads-count",
    decision: "D269",
    what: "🛑 the two arms carry the SAME count, so the coin decides nothing and the card is a plain `drawCards 4`. The gate still runs, the coin is still flipped and still announced, and the log is otherwise identical — the only witness is the draw count on the tails rows of the sweep",
    file: "packages/engine/src/registry.ts",
    find: "      then: [{ op: \"drawCards\", count: 4 }],\n      otherwise: [{ op: \"drawCards\", count: 2 }],",
    replace: "      then: [{ op: \"drawCards\", count: 4 }],\n      otherwise: [{ op: \"drawCards\", count: 4 }],",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D269-picnicker-gains-ontails",
    decision: "D269",
    what: "🛑 THE OTHER OPTIONAL FIELD, AND THE POINT OF THE `toEqual`: `onTails: true` swaps which face runs which arm, so Picnicker draws 2 on heads. `toMatchObject` on the authored row could not see the extra key and neither could a suite that only checked \"4 or 2 came out\" — the two fields are different axes and this mutant is where that is pinned",
    file: "packages/engine/src/registry.ts",
    find: "      then: [{ op: \"drawCards\", count: 4 }],\n      otherwise: [{ op: \"drawCards\", count: 2 }],",
    replace: "      onTails: true,\n      then: [{ op: \"drawCards\", count: 4 }],\n      otherwise: [{ op: \"drawCards\", count: 2 }],",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D269-drasna-tails-arm-drops-the-shuffle",
    decision: "D269",
    what: "🛑 LACEY'S SHAPE UNDONE ON ONE ARM: the tails arm draws 3 without shuffling, so the hand the card was played to fix survives on half the boards. The DRAW count is right on both faces and only the HAND SIZE and the HAND_SHUFFLED_INTO_DECK row differ — the reason the Drasna assertions are stated as absolute hand sizes rather than deltas",
    file: "packages/engine/src/registry.ts",
    find: "      otherwise: [{ op: \"handRefresh\", who: \"you\", draw: { kind: \"fixed\", count: 3 } }],",
    replace: "      otherwise: [{ op: \"drawCards\", count: 3 }],",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D269-drasna-refreshes-both-seats",
    decision: "D269",
    what: "🛑 `who: \"both\"` on the tails arm — Judge's value, one member over on the same op and the mistake a copy-paste from `handRefresh`'s other authors makes. The controller's own hand and draw are IDENTICAL, so every Drasna count stays green; only the untouched-opponent assertions can see it, and only on the tails rows",
    file: "packages/engine/src/registry.ts",
    find: "      otherwise: [{ op: \"handRefresh\", who: \"you\", draw: { kind: \"fixed\", count: 3 } }],",
    replace: "      otherwise: [{ op: \"handRefresh\", who: \"both\", draw: { kind: \"fixed\", count: 3 } }],",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D269-playable-refuses-on-then-alone",
    decision: "D269",
    what: "🛑 THE READER THE PREDICTION FORGOT. `programPlayable` goes back to descending into `then` alone, so a two-armed gate whose HEADS arm could only whiff is refused even though its tails arm acts — a card the rules say is playable, rejected before it leaves the hand. No printed row can reach it (both arms of both D269 cards are draws), so the killer is the CONSTRUCTED program in this row's suite",
    file: "packages/engine/src/cardplay.ts",
    find: "      if (\n        !programPlayable(state, op.then, seat, sourceUid) &&\n        (op.otherwise === undefined || !programPlayable(state, op.otherwise, seat, sourceUid))\n      ) {\n        return false;\n      }",
    replace: "      if (!programPlayable(state, op.then, seat, sourceUid)) return false;",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  // ── D270 — `HandRefreshDraw.perSeat` (Harlequin sv10.5w-083/-163). The member's
  //    whole content is a PAIR and which seat reads which half of it, and the pair
  //    is SWAPPED between the coin gate's two arms — so {5, 3} is dealt to somebody
  //    on every board under every one of these mutants. None of them is killed by a
  //    total, a conservation sum or a single hand; each needs BOTH hands read in the
  //    same breath, on a face read off the emitted coin row. ──
  {
    id: "D270-perseat-deals-you-to-every-seat",
    decision: "D270",
    what: "🛑 THE `seat === controller` TEST DROPPED: every affected seat draws the controller's number, so Harlequin deals 5/5 on heads and 3/3 on tails. GREEN on the controller's hand on both faces, green on every CARDS_DRAWN row count, and green on any suite that reads one seat — the opponent's hand is the only witness, which is why every assertion in this row holds two seats at once",
    file: "packages/engine/src/interpreter.ts",
    find: "    case \"perSeat\":\n      return seat === controller ? draw.you : draw.opponent;",
    replace: "    case \"perSeat\":\n      return draw.you;",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D270-perseat-pair-read-backwards",
    decision: "D270",
    what: "🛑 THE PAIR READ BACKWARDS — the controller takes `opponent` and the opponent takes `you`, so the card that is supposed to favour the player who played it hands them the smaller half on heads. Every TOTAL is unchanged (8 cards leave the two decks either way), every conservation sum still balances and both 5 and 3 still appear on every board; only WHICH hand holds which separates it",
    file: "packages/engine/src/interpreter.ts",
    find: "    case \"perSeat\":\n      return seat === controller ? draw.you : draw.opponent;",
    replace: "    case \"perSeat\":\n      return seat === controller ? draw.opponent : draw.you;",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D270-perseat-hardcodes-p1-as-you",
    decision: "D270",
    what: "🛑 THE SEAT LITERAL: \"you\" means `p1` rather than \"whoever played the card\". Harlequin is authored ONCE and both seats play the same object, so this is green on EVERY board in this file where P1 is the controller — which is all of them but one. The only killer is the row that passes the turn to P2 and plays the same program from the other seat, and this mutant is the whole reason that row exists",
    file: "packages/engine/src/interpreter.ts",
    find: "    case \"perSeat\":\n      return seat === controller ? draw.you : draw.opponent;",
    replace: "    case \"perSeat\":\n      return seat === \"p1\" ? draw.you : draw.opponent;",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D270-controller-collapses-to-the-dealt-seat",
    decision: "D270",
    what: "🛑 THE CALL SITE, NOT THE HELPER: `ctx.seat` replaced by the loop variable, so every seat is its own controller and everybody draws `you`. Observationally the first mutant's twin, and it is corpused separately because it is a DIFFERENT mistake in a different line — the argument this slice threaded through is easy to lose at the call and impossible to lose in the switch",
    file: "packages/engine/src/interpreter.ts",
    find: "    const count = handRefreshDrawCount(next, seat, ctx.seat, op.draw, handCount);",
    replace: "    const count = handRefreshDrawCount(next, seat, seat, op.draw, handCount);",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D270-harlequin-arms-carry-the-same-pair",
    decision: "D270",
    what: "🛑 THE COIN DECIDES NOTHING: the heads arm gets the tails pair, so Harlequin is a plain 3/5 whatever the flip says. The gate still runs, the coin is still taken and still announced, both shuffles still happen and both draw rows are still filed — the only witness is the pair matching the face read off the SAME log, on the heads rows of the sweep",
    file: "packages/engine/src/registry.ts",
    find: "      then: [{ op: \"handRefresh\", who: \"both\", draw: { kind: \"perSeat\", you: 5, opponent: 3 } }],",
    replace: "      then: [{ op: \"handRefresh\", who: \"both\", draw: { kind: \"perSeat\", you: 3, opponent: 5 } }],",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  {
    id: "D270-harlequin-tails-arm-refreshes-one-seat",
    decision: "D270",
    what: "🛑 THE SEAT SET UNDONE ON ONE ARM: the tails arm goes back to `who: \"you\"`, so on half the boards the opponent's hand is never shuffled and never redrawn — the disruption half of the card silently disappears on the losing face. The CONTROLLER's count is correct on both faces (a `perSeat` draw on a one-seat refresh still reads `you`), so a controller-side suite sees nothing at all",
    file: "packages/engine/src/registry.ts",
    find: "        { op: \"handRefresh\", who: \"both\", draw: { kind: \"perSeat\", you: 3, opponent: 5 } },",
    replace: "        { op: \"handRefresh\", who: \"you\", draw: { kind: \"perSeat\", you: 3, opponent: 5 } },",
    expectKilledBy: ["packages/engine/src/legalNonAttackPrograms.test.ts"],
  },
  // ── D271 — the last-turn-KO play gate. TWO mechanisms, so the mutants split in
  //    two: five on the STAMP (`GameState.lastKoTurn`, written by `knockOut`) and
  //    three on the READ (the `BoardCondition` member and the two registry rows).
  //    ⚠️ THE FAMILY'S SHARED PROPERTY: a history field is invisible on any board
  //    that plays the card immediately after the Knock Out. Every stamp mutant
  //    below is GREEN on that board and needs either the OTHER seat read in the
  //    same breath or the window driven two turns forward. ──
  {
    id: "D271-stamp-keys-the-seat-that-scored-the-ko",
    decision: "D271",
    what: "🛑 THE POSSESSIVE INVERTED: `knockOut` stamps the seat that TOOK the prize instead of the seat that LOST the Pokémon, so Unfair Stamp becomes playable by the player who just knocked something out. The stamp still exists, still carries the right TURN NUMBER, and the gate still opens and closes on schedule — on a board where only one seat is ever hit, every count and every timing assertion is unchanged. Only reading BOTH seats of `lastKoTurn` in the same breath, or asking the condition of both seats on one state, can see it",
    file: "packages/engine/src/flow.ts",
    find: "    lastKoTurn: { ...state.lastKoTurn, [koedSeat]: state.turn },",
    replace: "    lastKoTurn: { ...state.lastKoTurn, [prizeSeat]: state.turn },",
    expectKilledBy: ["packages/engine/src/lastTurnKo.test.ts"],
  },
  {
    id: "D271-stamp-records-the-next-turn",
    decision: "D271",
    what: "🛑 THE OFF-BY-ONE THE CHECKUP EXISTS TO CATCH: the stamp records `turn + 1`, i.e. the turn the KO'd player is ABOUT to take rather than the one the KO happened on. The gate then opens ONE TURN LATE — which is invisible to any suite that only ever asks the question on the turn straight after a Knock Out, because that board is simply false instead of true and 'the card was refused' looks like a working gate until you show it should have been allowed",
    file: "packages/engine/src/flow.ts",
    find: "    lastKoTurn: { ...state.lastKoTurn, [koedSeat]: state.turn },",
    replace: "    lastKoTurn: { ...state.lastKoTurn, [koedSeat]: state.turn + 1 },",
    expectKilledBy: ["packages/engine/src/lastTurnKo.test.ts"],
  },
  {
    id: "D271-bench-branch-never-stamps",
    decision: "D271",
    what: "🛑 THE FUNNEL'S SECOND BRANCH SILENTLY DROPPED: a BENCHED Knock Out no longer stamps anything, so a player whose bench was swept — but whose Active survived — cannot play the card the rules say they may. `knockOut`'s Active branch is untouched, so every attack that kills a Defending Pokémon is green, and so is every double-KO board where the Active died too. Only a KO that lands on the BENCH ALONE is a witness",
    file: "packages/engine/src/flow.ts",
    find: "      state: withSide(stamped, koedSeat, { ...cleanup.side, bench }),",
    replace: "      state: withSide(state, koedSeat, { ...cleanup.side, bench }),",
    expectKilledBy: ["packages/engine/src/lastTurnKo.test.ts"],
  },
  {
    id: "D271-window-never-expires",
    decision: "D271",
    what: "🛑 THE ROLLING WINDOW BECOMES A CUMULATIVE FLAG: `=== state.turn - 1` becomes 'has ever happened', so once a player loses a single Pokémon they may play Unfair Stamp for the rest of the game. GREEN on every board that plays the card on the turn straight after the Knock Out — which is every natural way to drive this row — and green on the initial-state read too, because `null` still fails the first clause. The only killer is driving the turn counter forward and re-asking",
    file: "packages/engine/src/types.ts",
    find: "  return stamped !== null && stamped === state.turn - 1;",
    replace: "  return stamped !== null;",
    expectKilledBy: ["packages/engine/src/lastTurnKo.test.ts"],
  },
  {
    id: "D271-sentinel-compares-as-zero",
    decision: "D271",
    what: "🛑 THE `null` GUARD DROPPED, WHICH IS EXACTLY WHY THE SENTINEL IS NOT `0`. With a loose compare an unstamped seat reads `null == turn - 1`, false everywhere except where `turn - 1` is 0 — so on TURN 1 both players may play a card that requires a Knock Out that has not happened. Every mid-game board in every other suite is green; the witness is the freshly-dealt state, which is the one board a card-driven suite has no reason to ask",
    file: "packages/engine/src/types.ts",
    find: "  return stamped !== null && stamped === state.turn - 1;",
    replace: "  return (stamped ?? 0) === state.turn - 1;",
    expectKilledBy: ["packages/engine/src/lastTurnKo.test.ts"],
  },
  {
    id: "D271-condition-reads-the-opponents-history",
    decision: "D271",
    what: "🛑 THE MEMBER'S SUBJECT SWAPPED AT THE READ rather than at the write: `conditionHolds` asks whether the OPPONENT lost a Pokémon last turn. Observationally the stamp-side inversion's twin and corpused separately because it is a different line and a different mistake — a seat argument is easy to invert in a one-line predicate and impossible to notice without a two-seat read",
    file: "packages/engine/src/interpreter.ts",
    find: "      return koedDuringOpponentsLastTurn(state, seat);",
    replace: "      return koedDuringOpponentsLastTurn(state, otherSeat(seat));",
    expectKilledBy: ["packages/engine/src/lastTurnKo.test.ts"],
  },
  {
    id: "D271-unfair-stamp-loses-its-gate",
    decision: "D271",
    what: "🛑 THE PLAY GATE DELETED FROM THE CARD, leaving the refresh: Unfair Stamp becomes an unconditional 5/2 Judge. The DRAW is byte-identical on every board where the card was legal anyway, so every count assertion in the row stays green — the witness is the board where NO Knock Out happened and the play must be REFUSED with PLAY_CONDITION_NOT_MET",
    file: "packages/engine/src/registry.ts",
    find: "const UNFAIR_STAMP: CardProgram = {\n  trainerPlayableIf: { kind: \"yourPokemonKoedOnOpponentsLastTurn\" },",
    replace: "const UNFAIR_STAMP: CardProgram = {",
    expectKilledBy: ["packages/engine/src/lastTurnKo.test.ts"],
  },
  {
    id: "D271-unfair-stamp-takes-archers-pair",
    decision: "D271",
    what: "🛑 THE SIBLING'S NUMBERS: 5/2 becomes 5/3, which is Team Rocket's Archer's printed pair behind the SAME sentence. The controller's hand is 5 either way, the gate is untouched, both hands still move and the total is off by exactly one card in the opponent's — so only reading the OPPONENT's hand size, in the same breath as the controller's, separates the two cards",
    file: "packages/engine/src/registry.ts",
    find: "  trainer: [{ op: \"handRefresh\", who: \"both\", draw: { kind: \"perSeat\", you: 5, opponent: 2 } }],",
    replace: "  trainer: [{ op: \"handRefresh\", who: \"both\", draw: { kind: \"perSeat\", you: 5, opponent: 3 } }],",
    expectKilledBy: ["packages/engine/src/lastTurnKo.test.ts"],
  },
  // ── D272 — the ability-surface play gate and the cross-copy name lock ──────
  {
    id: "D272-name-lock-becomes-per-body",
    decision: "D272",
    what: "🛑 THE CROSS-COPY LOCK REVERTS TO THE ENGINE DEFAULT: `oncePerTurn` goes back to `true`, so the key keeps its uid and TWO Fezandipiti ex on one board each draw 3 — six cards off a sentence that prints one use. Every one-copy board is GREEN (with a single body the two scopes are literally indistinguishable), the first use is byte-identical, the gate is untouched, and the HUD lights exactly the rows the engine accepts. The only witness is a board holding TWO copies at once",
    file: "packages/engine/src/registry.ts",
    find: "      oncePerTurn: \"sharedByName\",\n      activeOnly: false,\n      playableIf: { kind: \"yourPokemonKoedOnOpponentsLastTurn\" },",
    replace: "      oncePerTurn: true,\n      activeOnly: false,\n      playableIf: { kind: \"yourPokemonKoedOnOpponentsLastTurn\" },",
    expectKilledBy: ["packages/engine/src/flipTheScript.test.ts"],
  },
  {
    id: "D272-shared-key-swallows-every-ability",
    decision: "D272",
    what: "🛑 THE WIDENING APPLIED TO THE WHOLE POOL: `abilityUsedKey` drops the uid unconditionally, so EVERY once-per-turn Ability in the registry becomes cross-copy — two Hydrapple ex are one Ripening Charge, two Munkidori one Adrena-Brain. Every Fezandipiti assertion in the slice's own suite stays green, because Fezandipiti WANTS the shared key; the regression lands on thirty-odd cards this suite never names, and the witness is the per-body control asserting the DEFAULT scope is untouched",
    file: "packages/engine/src/cardplay.ts",
    find: "  const keyUid = ability.oncePerTurn === \"sharedByName\" ? SHARED_ABILITY_UID : uid;",
    replace: "  const keyUid = SHARED_ABILITY_UID;",
    expectKilledBy: ["packages/engine/src/flipTheScript.test.ts"],
  },
  {
    id: "D272-shared-key-collides-across-abilities",
    decision: "D272",
    what: "🛑 THE NAME DROPPED FROM THE SHARED KEY, leaving a bare `*:`. Fezandipiti's own lock still works perfectly — one use per turn, both copies refused — so every assertion about THIS card passes. What breaks is the day a SECOND `sharedByName` Ability exists: the two would share one allowance. Caught here because the key's exact string is asserted rather than only its effect, which is why the suite reads the whole `abilitiesUsed` bag",
    file: "packages/engine/src/cardplay.ts",
    find: "  return `${keyUid}:${ability.name}`;",
    replace: "  return `${keyUid}:`;",
    expectKilledBy: ["packages/engine/src/flipTheScript.test.ts"],
  },
  {
    id: "D272-ability-gate-deleted",
    decision: "D272",
    what: "🛑 THE PLAY GATE DELETED FROM `useAbility`, leaving the draw: Flip the Script becomes an unconditional once-per-turn 3-card draw on any board. The draw is byte-identical wherever the card was legal anyway and the name lock is untouched, so every use-and-refuse assertion stays green — the witness is the CLOSED WINDOW, two turns after the Knock Out, where the use must be refused with ABILITY_CONDITION_NOT_MET",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (ability.playableIf !== undefined && !conditionHolds(state, action.seat, ability.playableIf)) {",
    replace: "  if (false && ability.playableIf !== undefined && !conditionHolds(state, action.seat, ability.playableIf)) {",
    expectKilledBy: ["packages/engine/src/flipTheScript.test.ts"],
  },
  {
    id: "D272-ability-gate-reads-the-opponents-seat",
    decision: "D272",
    what: "🛑 THE GATE ASKS THE WRONG SEAT: `conditionHolds` is handed the opponent's seat, so the Ability reads as 'somebody lost a Pokémon last turn'. The controller who ACTUALLY lost the Pokémon is now REFUSED and the seat that SCORED the Knock Out may draw — a clean inversion that a one-seat suite cannot see at all, since on the natural board exactly one of the two is ever asked",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (ability.playableIf !== undefined && !conditionHolds(state, action.seat, ability.playableIf)) {",
    replace: "  if (ability.playableIf !== undefined && !conditionHolds(state, otherSeat(action.seat), ability.playableIf)) {",
    expectKilledBy: ["packages/engine/src/flipTheScript.test.ts"],
  },
  {
    id: "D272-once-per-turn-check-deleted",
    decision: "D272",
    what: "🛑 THE LOCK'S READ SIDE DELETED WHILE ITS WRITE SIDE REMAINS: the allowance is still stamped, nothing ever consults it, so Flip the Script becomes REPEATABLE — the same body draws 3 again and again on one turn. Distinct from the scope mutant above, which keeps the check and only narrows the key: this one re-opens the SAME-BODY repeat that `oncePerTurn` has forbidden since §9 was first built, and the witness is the same-body second use rather than the cross-copy one",
    file: "packages/engine/src/cardplay.ts",
    find: "  const usedKey = abilityUsedKey(uid, ability);\n  if (ability.oncePerTurn && state.allowances.abilitiesUsed.includes(usedKey)) {\n    return err(\"ABILITY_ALREADY_USED\", `${ability.name} was already used this turn (§9)`);\n  }",
    replace: "  const usedKey = abilityUsedKey(uid, ability);",
    expectKilledBy: ["packages/engine/src/flipTheScript.test.ts"],
  },
  {
    id: "D272-hud-mirror-keeps-the-hand-spelled-key",
    decision: "D272",
    what: "🛑 THE WIRE HUD STOPS AGREEING WITH THE ENGINE: `redactedAbilitiesOf` rebuilds `${uid}:${ability.name}` instead of calling the shared funnel, so after one copy is used the OTHER copy's row stays LIT — and in fact so does the used one, since neither uid is in the bag. A live afford-then-reject: the client offers the button, the DO answers ABILITY_ALREADY_USED. The engine is entirely correct, so every non-HUD assertion in the slice is green",
    file: "packages/engine/src/redact.ts",
    find: "        (ability.oncePerTurn && state.allowances.abilitiesUsed.includes(abilityUsedKey(uid, ability))) ||",
    replace: "        (ability.oncePerTurn && state.allowances.abilitiesUsed.includes(`${uid}:${ability.name}`)) ||",
    expectKilledBy: ["packages/engine/src/flipTheScript.test.ts"],
  },
  {
    id: "D272-hud-mirror-ignores-the-board-gate",
    decision: "D272",
    what: "🛑 THE HUD'S OTHER HALF: the wire mirror stops folding the printed board gate in, so on a closed-window board both Fezandipiti rows render ENABLED and the player is invited to make a play the engine refuses with ABILITY_CONDITION_NOT_MET. The lock half of the mirror is untouched, so the used/unused greying is all still right — only the gate's rows lie",
    file: "packages/engine/src/redact.ts",
    find: "        gateUnmet ||\n        costUnmet !== null ||\n        noTarget;",
    replace: "        costUnmet !== null ||\n        noTarget;",
    expectKilledBy: ["packages/engine/src/flipTheScript.test.ts"],
  },
  // ── D273 — Pecharunt ex's {D}-narrowed, name-excluding bench switch ─────────
  {
    id: "D273-switch-type-narrowing-dropped",
    decision: "D273",
    what: "🛑 THE PRINTED {D} STOPS NARROWING: every benched body becomes a candidate, so 'switch 1 of your Benched {D} Pokémon' offers the Lightning body the sentence never names. The exclusion is untouched, which is what makes this a separate mutant from the one below — a suite that only ever benched Darkness bodies would be green",
    file: "packages/engine/src/interpreter.ts",
    find: "    return (\n      op.targetType === undefined ||\n      matchesFilter(card, { kind: \"typedPokemon\", pokemonType: op.targetType })\n    );",
    replace: "    return true;",
    expectKilledBy: ["packages/engine/src/subjugatingChains.test.ts"],
  },
  {
    id: "D273-switch-type-reads-the-first-type-only",
    decision: "D273",
    what: "🛑 THE ARRAY READ BECOMES AN EQUALITY: a dual-type body whose SECOND printed type is Darkness is silently dropped, so the card refuses a switch it offers. Every mono-{D} board in the suite stays green — this is the exact quiet-wrong-answer shape `matchesFilter`'s own `typedPokemon` doc names, reproduced one level up",
    file: "packages/engine/src/interpreter.ts",
    find: "      matchesFilter(card, { kind: \"typedPokemon\", pokemonType: op.targetType })",
    replace: "      (card.types ?? [])[0] === op.targetType",
    expectKilledBy: ["packages/engine/src/subjugatingChains.test.ts"],
  },
  {
    id: "D273-switch-name-exclusion-dropped",
    decision: "D273",
    what: "🛑 'EXCEPT ANY PECHARUNT ex' STOPS EXCLUDING: a benched Pecharunt ex becomes a legal destination, and on a bench of nothing but Pecharunt ex the Ability that should be REFUSED fires and chains one copy in for the other. It is a {D} Pokémon, so the type narrowing above cannot see this at all",
    file: "packages/engine/src/interpreter.ts",
    find: "    if (op.exceptNamed !== undefined && card.name === op.exceptNamed) return false;",
    replace: "",
    expectKilledBy: ["packages/engine/src/subjugatingChains.test.ts"],
  },
  {
    id: "D273-switch-exclusion-only-when-untyped",
    decision: "D273",
    what: "🛑 THE INTERSECTION BECOMES A PREFERENCE: the exclusion is honoured only on a printing that names no type, so on Pecharunt's own sentence — which names both — the name half silently stops running. Kills the conjunction without deleting either half, which is the reading a 'the type already covers it' shortcut would produce",
    file: "packages/engine/src/interpreter.ts",
    find: "    if (op.exceptNamed !== undefined && card.name === op.exceptNamed) return false;",
    replace: "    if (op.targetType === undefined && op.exceptNamed !== undefined && card.name === op.exceptNamed) return false;",
    expectKilledBy: ["packages/engine/src/subjugatingChains.test.ts"],
  },
  {
    id: "D273-switch-narrowing-read-at-both-ends",
    decision: "D273",
    what: "🛑 THE BENCH NARROWING IS READ AT THE ACTIVE END TOO — Giovanni's `ownerPokemon` rule applied to a rider that is NOT it. Every board whose Active is not {D} now empties the candidate set and `programPlayable` refuses a switch the card plainly offers; the printed sentence qualifies only the destination",
    file: "packages/engine/src/interpreter.ts",
    find: "  if (op.ownerPokemon === undefined) return bench;",
    replace: "  if (switchBenchNarrowing(state, [{ seat, spot: { spot: \"active\" } }], op).length === 0) return [];\n  if (op.ownerPokemon === undefined) return bench;",
    expectKilledBy: ["packages/engine/src/subjugatingChains.test.ts"],
  },
  {
    id: "D273-switch-caption-drops-the-riders",
    decision: "D273",
    what: "🛑 THE DIALOG CONTRADICTS ITS OWN VALIDATOR: the caption reads 'Switch to which Benched Pokémon?' over rows that hold only the {D} non-Pecharunt bodies, so the player is told a wider set than the one they are shown. Nothing about the BOARD changes, which is why a candidate-set assertion cannot see it",
    file: "packages/engine/src/interpreter.ts",
    find: "  return `Benched ${type}${ownerNoun(op.ownerPokemon)}Pokémon${except}`;",
    replace: "  return `Benched ${ownerNoun(op.ownerPokemon)}Pokémon`;",
    expectKilledBy: ["packages/engine/src/subjugatingChains.test.ts"],
  },
  {
    id: "D273-switch-caption-spells-the-riders-unconditionally",
    decision: "D273",
    what: "🛑 THE OTHER DIRECTION, AND IT HITS EVERY OTHER CARD: the two riders are spelled even when absent, so plain Switch `sv01-194` starts asking 'Switch to which Benched undefined Pokémon, except any undefined?'. Pecharunt's own prompt is UNCHANGED, so the whole new suite is green except the one assertion that plays the rider-free printing",
    file: "packages/engine/src/interpreter.ts",
    find: "  const type = op.targetType === undefined ? \"\" : `${op.targetType} `;\n  const except = op.exceptNamed === undefined ? \"\" : `, except any ${op.exceptNamed}`;",
    replace: "  const type = `${op.targetType} `;\n  const except = `, except any ${op.exceptNamed}`;",
    expectKilledBy: ["packages/engine/src/subjugatingChains.test.ts"],
  },
  {
    id: "D273-chains-lock-is-per-body",
    decision: "D273",
    what: "🛑 THE PRINTED SECOND SENTENCE REVERTS TO THE §9 DEFAULT: two Pecharunt ex chain TWICE in one turn, which is two forced switches and two Poisons the card forbids. D272's field is the mechanism; this is the second card to lean on it, and the mutant proves the registry VALUE is load-bearing rather than decorative",
    file: "packages/engine/src/registry.ts",
    find: "      name: \"Subjugating Chains\",\n      oncePerTurn: \"sharedByName\",",
    replace: "      name: \"Subjugating Chains\",\n      oncePerTurn: true,",
    expectKilledBy: ["packages/engine/src/subjugatingChains.test.ts"],
  },
  {
    id: "D273-chains-poison-loses-its-record-gate",
    decision: "D273",
    what: "🛑 'IF YOU DO' STOPS GATING: the poison is applied unconditionally, so a use whose switch never happened still Poisons whatever is sitting in the Active Spot — Pecharunt itself. The §9.2 seam is the whole difference between the printed consequent and a second independent clause",
    file: "packages/engine/src/registry.ts",
    find: "          op: \"recordGate\",\n          slot: \"moved\",\n          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).\n          then: [{ op: \"applyStatus\", target: \"self\", status: \"poisoned\" }],",
    replace: "          op: \"applyStatus\",\n          target: \"self\",\n          status: \"poisoned\",",
    expectKilledBy: ["packages/engine/src/subjugatingChains.test.ts"],
  },
  {
    id: "D274-corpus-sentence-mistyped",
    decision: "D274",
    what: "🛑 THE POPULATION ROTS UNDER THE READERS — one homoglyph (é -> e) in the corpus's biggest resolving sentence, 58 legal printings. This is the catalog-side failure the guard exists for, and it is LENGTH-PRESERVING: the 60,467-character checksum stays GREEN and only the live reader run notices, which is exactly why the sum is computed rather than recorded",
    file: "packages/engine/src/censusAttackCorpus.ts",
    find: "58 During your next turn, this Pok\u00e9mon can't attack.",
    replace: "58 During your next turn, this Pokemon can't attack.",
    expectKilledBy: ["packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D274-reader-narrowed-under-the-constant",
    decision: "D274",
    what: "🛑 THE DEFECT THE OLD CONSTANT WAS BLIND TO FOR TWENTY-EIGHT SLICES: a real reader arm is NARROWED (the status vocabulary loses `Poisoned`) and 14 legal printings stop deriving. Before D274 `BUILT.attack` would have sat at 1115 being green through this; now the live sum reddens at 1101. A neighbour-plausible edit, not a straw one — it is one word out of a five-word alternation",
    file: "packages/engine/src/effects.ts",
    find: "const STATUS_WORDS = \"Asleep|Burned|Confused|Paralyzed|Poisoned\";",
    replace: "const STATUS_WORDS = \"Asleep|Burned|Confused|Paralyzed\";",
    expectKilledBy: ["packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D274-corpus-parser-splits-at-the-wrong-space",
    decision: "D274",
    what: "🛑 THE PARSER IS THE CORPUS'S ONLY READER, SO A SILENT MIS-SPLIT WOULD FALSIFY EVERY NUMBER ABOVE IT: splitting at the LAST space instead of the first makes every `units` a NaN and every `sentence` a single trailing word. The guard's own malformed-record throw is what catches it, which is the reason that throw exists rather than a lenient parse",
    file: "packages/engine/src/censusAttackCorpus.ts",
    find: "      const cut = line.indexOf(\" \");",
    replace: "      const cut = line.lastIndexOf(\" \");",
    expectKilledBy: ["packages/engine/src/censusAtHead.test.ts"],
  },
  // ── D275 — Fan Rotom "Fan Call": the per-seat turn ORDINAL (a DERIVED read),
  //    D265's `maxHp` rider on `typedPokemon`, and the version tie. ──
  {
    id: "D275-first-turn-ignores-the-seat",
    decision: "D275",
    what: "🛑 THE DEFECT THE WHOLE SLICE EXISTS TO AVOID: `isFirstTurnOf` reads the TURN NUMBER alone, so \"your first turn\" means turn 1 for everybody. The going-SECOND seat can never use Fan Call on turn 2 — the only turn it is printed for — and §4's evolve ban moves onto the wrong seat's turn with it. Every board where the going-FIRST player acts stays green, which is exactly why the suite drives both seats",
    file: "packages/engine/src/types.ts",
    find: "  return state.turn === (seat === state.firstPlayer ? 1 : 2);",
    replace: "  return state.turn === 1;",
    expectKilledBy: [
      "packages/engine/src/fanCall.test.ts",
      "packages/engine/src/evolution.test.ts",
      "packages/engine/src/rareCandy.test.ts",
    ],
  },
  {
    id: "D275-first-turn-swaps-the-seats",
    decision: "D275",
    what: "the ordinal is INVERTED rather than dropped: the going-first seat's first turn reads as 2 and the going-second seat's as 1. A one-token edit that keeps the shape of the expression and answers the printed question backwards for both seats at once",
    file: "packages/engine/src/types.ts",
    find: "  return state.turn === (seat === state.firstPlayer ? 1 : 2);",
    replace: "  return state.turn === (seat === state.firstPlayer ? 2 : 1);",
    expectKilledBy: [
      "packages/engine/src/fanCall.test.ts",
      "packages/engine/src/evolution.test.ts",
    ],
  },
  {
    id: "D275-first-turn-gate-always-holds",
    decision: "D275",
    what: "the `yourFirstTurn` arm of `conditionHolds` returns `true` unconditionally — Fan Call becomes a late-game tutor and the printed word \"first\" enforces nothing. The arm is the ONE place the condition is answered, so this is the whole member",
    file: "packages/engine/src/interpreter.ts",
    find: "      return isFirstTurnOf(state, seat);",
    replace: "      return true;",
    expectKilledBy: ["packages/engine/src/fanCall.test.ts"],
  },
  {
    id: "D275-typed-maxhp-never-narrows",
    decision: "D275",
    what: "the HP threshold on `typedPokemon` stops narrowing (the comparison degrades to a non-null test): \"up to 3 {C} Pokémon with 100 HP or less\" offers every Colorless body in the deck, including the 120 HP and 200 HP ones. The CAPTION still says \"with 100 HP or less\", so the dialog and the offer disagree — the D245 defect one member over",
    file: "packages/engine/src/cards.ts",
    find: "        (filter.maxHp === undefined || (typedHp !== null && typedHp <= filter.maxHp))",
    replace: "        (filter.maxHp === undefined || typedHp !== null)",
    expectKilledBy: ["packages/engine/src/fanCall.test.ts"],
  },
  {
    id: "D275-typed-maxhp-admits-a-null-hp",
    decision: "D275",
    what: "🛑 D265's JAVASCRIPT TRAP, one member over: the null HP is coerced instead of refused, so a data-gap row (`hpOf` returns null for a non-positive printed value) satisfies \"100 HP or less\" and is offered to a sentence that names a printed HP. Narrower than the row above — the threshold still works for every card that HAS one — which is why it takes its own row",
    file: "packages/engine/src/cards.ts",
    find: "        (filter.maxHp === undefined || (typedHp !== null && typedHp <= filter.maxHp))",
    replace: "        (filter.maxHp === undefined || (typedHp ?? 0) <= filter.maxHp)",
    expectKilledBy: ["packages/engine/src/fanCall.test.ts"],
  },
  {
    id: "D275-typed-noun-drops-the-threshold",
    decision: "D275",
    what: "the DESCRIBER regresses: a \"{C} Pokémon with 100 HP or less\" search captions itself \"up to 3 Colorless Pokémon\", naming a WIDER set than the prompt then offers. The engine resolves correctly and lies about it in the dialog heading — D245's own surviving mutant, on the rider rather than the stage word",
    file: "packages/engine/src/interpreter.ts",
    find: "${filter.pokemonType} Pokémon${filter.maxHp === undefined ? \"\" : ` with ${filter.maxHp} HP or less`}`;",
    replace: "${filter.pokemonType} Pokémon`;",
    expectKilledBy: ["packages/engine/src/fanCall.test.ts"],
  },
  {
    id: "D275-fan-call-lock-is-per-body",
    decision: "D275",
    what: "Fan Call's cross-copy name lock degrades to the per-body default, so two Fan Rotom on one board search TWICE on the opening turn — the printed \"You can't use more than 1 Fan Call Ability during your turn\" enforcing nothing. Invisible on any one-copy board, which is why the suite benches two DISTINCT printings",
    file: "packages/engine/src/registry.ts",
    find: "      name: \"Fan Call\",\n      oncePerTurn: \"sharedByName\",",
    replace: "      name: \"Fan Call\",\n      oncePerTurn: true,",
    expectKilledBy: [
      "packages/engine/src/fanCall.test.ts",
      "packages/engine/src/flipTheScript.test.ts",
    ],
  },
  {
    id: "D275-engine-version-drifts-again",
    decision: "D275",
    what: "🛑 THE DEBT THIS SLICE PAID FOR THE FIFTH TIME, RE-INSTALLED: `engineVersion` falls a minor behind `packages/engine/package.json`, which is EXACTLY the state the tree was in at the head of D275 (0.187.0 against 0.189.0) and had been for two slices with nothing comparing them. The tie is the guard; this row is the proof it is one",
    file: "packages/engine/src/index.ts",
    // ⚠️ RE-POINTED AT D328 (0.233.0 → 0.234.0) — the TWENTY-FIFTH payment, and the
    // FIRST one a REVIEW-FIX session made rather than a build slice. `precheck`
    // named this row and ONLY this row again, off a diff that touched one engine
    // file and added one suite: the row is stale on EVERY bump by construction, and
    // a session that ships no printing bumps the version exactly as often as one
    // that does.
    // ⚠️ RE-POINTED AT D314 (0.219.0 → 0.220.0) — the TWENTY-FOURTH payment, and
    // `precheck` named this row and ONLY this row, for the second slice in three.
    // ⚠️ **AND D314 IS THE CASE THAT SHOWS WHY THE *EARLY* RUN IS NOT OPTIONAL
    // EITHER.** D313's lesson was that an anchor is only unique until somebody
    // EDITS the pattern it quotes; D314 edited FOUR existing suites' list literals
    // (`runAwayDraw` §7, `teleporter` §5, `assassinsReturn` §7, `censusAtHead`'s
    // constants) and broke NOT ONE corpus row, because every edit was an APPEND to
    // a list or a change to a NUMBER rather than to a quoted line. **The
    // difference between D313's breakage and D314's silence is not care, it is
    // whether the slice changed a line an earlier row had QUOTED — which is a fact
    // about the corpus and not about the diff, and `precheck` is the only thing
    // that knows it.**
    // ⚠️ RE-POINTED AT D313 (0.218.0 → 0.219.0) — the TWENTY-THIRD payment.
    // ⚠️ RE-POINTED AT D312 (0.217.0 → 0.218.0) — the TWENTY-SECOND payment, and
    // `precheck` named it AGAIN for the second slice running, exactly as the resume
    // point forecast both times. It is not the only broken row this slice produced,
    // which is the D310 shape rather than the D311 one.
    // ⚠️ RE-POINTED AT D311 (0.216.0 → 0.217.0) — the TWENTY-FIRST payment, and
    // `precheck` named this row and ONLY this row, which is what the resume point
    // said it would: this `find` quotes the version literal and is stale on EVERY
    // BUMP BY CONSTRUCTION, so it is unreachable by the "grep the line you are
    // about to edit" rule and reachable in two seconds by running `precheck`.
    // ⚠️ RE-POINTED AT D299 (0.209.0 → 0.210.0) — the NINETEENTH payment, and the
    // FIRST time this row's stale `find` sat beside a version debt of a DIFFERENT
    // kind: `MATCH_RECORD_VERSION` was 16 at the head of D299 while D298's handoff
    // recorded it bumped to 17. **`precheck` cannot see that one** — it guards the
    // literal in `index.ts` against `package.json`, and nothing in the tree ties
    // the RECORD version to the `GameState` shape it gates. The engine-version tie
    // is a tie because someone WROTE one; the record version has no such guard, and
    // that asymmetry is what let a driven-and-recorded bump never land.
    // ⚠️ RE-POINTED AT D298 (0.208.0 → 0.209.0) — and `precheck` named this row and
    // ONLY this row, for the SIXTEENTH consecutive slice, after a build that
    // EXTRACTED a type, made a required field optional, added a `GameState` key and
    // replaced four `entries.push` sites in `planPrizes` with a closure. Two
    // precheck runs (clean at 524 before the first edit, one broken row after the
    // bump) is the discipline, and this is the strongest evidence yet that
    // "signatures only" is false in the other direction too: three structural
    // changes broke nothing, and a one-line literal broke the only row it could.
    // ⚠️ RE-POINTED AT D283 (0.196.0 → 0.197.0) — the ELEVENTH payment, and D282's
    // finding is now CONFIRMED as structural rather than incidental: D283 ran
    // precheck EARLY (clean at 459) and AGAIN after the bump, and the second run
    // named this row and ONLY this row. Two runs is the discipline.
    // ⚠️ RE-POINTED AT D282 (0.195.0 → 0.196.0) — the TENTH payment of this debt,
    // and ⚠️ **PRECHECK DID NOT NAME IT THIS TIME, WHICH IS THE FINDING.** D282 ran
    // precheck BEFORE bumping and it was clean at 453; the row only goes stale
    // once the bump lands, so "run precheck early" and "precheck catches the
    // version row" are in tension — the early run is the useful one for every
    // OTHER row and is structurally blind to this one. Run it a SECOND time after
    // the bump.
    // ⚠️ RE-POINTED AT D279 (0.192.0 → 0.193.0). This row's `find` is a VERSION
    // LITERAL, so it goes stale on every bump BY CONSTRUCTION and `precheck.ts`
    // is the thing that says so — the EIGHTH time this debt has been paid, and
    // the third consecutive slice for which precheck named it on the first run.
    // ✅ **UNLIKE `D255-lock-gate-bypassed` ABOVE, THIS ONE IS NOT WORTH
    // RE-ANCHORING**: the literal IS the thing under test, so there is no more
    // stable string to move to. The two rows look alike in `precheck` output and
    // are opposite cases — one anchor is fragile, the other is the assertion.
    // 🆕 ⚠️ RE-POINTED AT D297 (0.207.0 → 0.208.0) — the TWENTY-FIFTH time, and
    // an EIGHTEENTH independent confirmation of the same shape. D297 ran
    // `precheck` ONCE, after the whole build and the bump, and it printed
    // `1 BROKEN ROW(S)` naming THIS row and nothing else — even though the slice
    // added an optional field to an `EffectOp` member, a new deriver anchor, a
    // `cap` inside an existing helper and a whole new suite. ⚠️ **THE ONE RUN IS
    // JUSTIFIED THE SAME WAY D296 JUSTIFIED ITS OWN**: no existing function's
    // SIGNATURE moved (the offer takes its cap off the op it already had), nothing
    // was extracted, and the new arm was inserted at the END of a
    // `deriveAttackEffect` block rather than between two quoted lines — the three
    // causes D278/D292/D293 name. A slice that does any of those still owes the
    // early run.
    // ⚠️ RE-POINTED AT D296 (0.206.0 → 0.207.0) — the TWENTY-FOURTH time, and
    // a SEVENTEENTH independent confirmation that the row is structurally blind
    // until the bump lands. D296 ran `precheck` ONCE, after the whole build and
    // the bump, and it printed `1 BROKEN ROW(S)` naming THIS row and nothing
    // else — even though the slice added a `BoardCondition` member (a union
    // ARITY change), a new deriver arm, a new `EffectOp` local and a whole new
    // suite. ⚠️ **THE ONE RUN IS A DEPARTURE FROM D288's THREE AND IT COST
    // NOTHING HERE, BUT SAY WHY**: this slice moved no existing function's
    // signature, extracted nothing, and inserted its arm at the END of a
    // `deriveAttackEffect` block rather than between two quoted lines — the
    // three causes D278/D292/D293 name. A slice that does any of those still
    // owes the early run.
    // ⚠️ RE-POINTED AT D288 (0.201.0 → 0.202.0) — the SIXTEENTH time, and the
    // FIFTH consecutive slice to drive it in D285's NATURAL order. D288 ran
    // `precheck` THREE times: clean at 491 BEFORE any code (the early run the
    // handoff demanded), `1 BROKEN ROW(S)` after the redact.ts edit naming
    // `D223-online-hud-ignores-flag` and nothing else, clean at 496 after the
    // corpus edit, and after the bump `1 BROKEN ROW(S)` naming THIS row and
    // nothing else. **THE "STRUCTURALLY BLIND UNTIL THE BUMP LANDS" CLAIM NOW HAS
    // FIVE INDEPENDENT CONFIRMATIONS.**
    // 🆕 🛑 **AND D288's OWN NEIGHBOUR WARNING PAID OFF, WHERE D287's DID NOT.**
    // The handoff said to grep `mutants.ts` for `redactedTrainersOf` and for the
    // `continue;` line before touching them. Neither was quoted by any row — but
    // the edit broke a row NEITHER name would have found: `D223-online-hud-
    // ignores-flag`, which quotes the §4 SUPPORTER arm three lines below, because
    // the Stadium arm turned that `&&` into a ternary. **GREP FOR THE FUNCTION
    // AND FOR THE LINES YOU TOUCH, AND EXPECT TO BREAK A ROW YOU DID NOT TOUCH:**
    // a row is anchored on TEXT, and text moves when its neighbour grows.
    // ⚠️ RE-POINTED AT D287 (0.200.0 → 0.201.0) — the FIFTEENTH time, and the
    // FOURTH consecutive slice to drive it in D285's NATURAL order (bump the two
    // literals first, on their own, then run `precheck` against that tree and read
    // which rows it names). D287 ran precheck THREE times — clean at 486 before any
    // code, clean at 491 after the corpus edit, and after the bump it printed
    // `1 BROKEN ROW(S)` naming this row and nothing else. The "structurally blind
    // until the bump lands" claim now has FOUR independent confirmations.
    // 🆕 🛑 **AND D287 CHECKED A NAMED NEIGHBOUR THAT TURNED OUT NOT TO BE ONE.**
    // Its handoff warned that this slice edits `stampedBarFor`'s BODY (types.ts)
    // and that `D285-evolve-bar-reaches-the-bench` quotes it. **IT DOES NOT** — that
    // row quotes `stampedActBarFor`, a different function on a different surface.
    // The rows that DO name `stampedBarFor` (D284's two `funnel-forgets-*`) quote
    // its CALL SITE inside `handPlayBarred` (continuous.ts), which this slice did
    // not touch, so all three stayed green. **A NEIGHBOUR WARNING IS WORTH ACTING
    // ON AND IS NOT WORTH BELIEVING**: the grep costs nothing and the claim was
    // wrong.
    // ⚠️ RE-POINTED AT D286 (0.199.0 → 0.200.0) — the FOURTEENTH time, and the
    // THIRD consecutive slice to drive it in D285's NATURAL order (bump the
    // literal first, on its own, then run `precheck` against that tree and read
    // which rows it names). D286 ran precheck THREE times — clean at 482 before
    // any code, clean at 486 after the corpus edit, and after the bump it named
    // exactly one row, this one — so the "structurally blind until the bump
    // lands" claim now has three independent confirmations rather than two.
    // 🆕 ⚠️ AND D286 IS THE FIRST SLICE TO CROSS A ZERO IN THIS LITERAL
    // (0.199.0 → 0.200.0). Nothing here parses the version, so the carry is not
    // special — but the `find` is a WHOLE-LINE literal, which is exactly why:
    // a row anchored on the MINOR digits alone would have silently gone stale
    // on the rollover instead of loudly, and that is the property this row is
    // for. Recorded because the next rollover is 250 slices away and the reason
    // will not be obvious then.
    // ⚠️ RE-POINTED AT D285 (0.198.0 → 0.199.0) — the THIRTEENTH time, and this
    // slice DROVE the claim in the natural order rather than by reverting: the
    // literal in `index.ts` was bumped FIRST, on its own, and `precheck` was run
    // against that tree. It named exactly one row, this one. That is a stronger
    // drive than D283's and D284's revert-and-restore, because no inverse
    // substitution had to be trusted afterwards.
    // ⚠️ RE-POINTED AT D294 (0.204.0 → 0.205.0) — the SIXTEENTH payment, and the
    // TENTH consecutive slice to drive it in D285's NATURAL order (bump the two
    // literals first, run `precheck` against that tree, read which rows it names).
    // D294 ran `precheck` TWICE: clean at 509 before the bump, and after it
    // `1 BROKEN ROW(S)` naming THIS row and nothing else — even though the slice
    // also changed an ARITY (`bottomFromOpponentHandApply` gained a `dest`
    // parameter) and edited three of the files this file quotes. **THE "BLIND
    // UNTIL THE BUMP LANDS" CLAIM NOW HAS SIX INDEPENDENT CONFIRMATIONS, AND D293's
    // correction holds: an arity change that does not move QUOTED TEXT is free.**
    // ⚠️ RE-POINTED AT D295 (0.205.0 → 0.206.0) — the SEVENTEENTH payment, and the
    // ELEVENTH consecutive slice to drive it in D285's NATURAL order. D295 ran
    // `precheck` FOUR times and this row was named on the second run.
    // 🆕 ⚠️ RE-POINTED AT D302 (0.211.0 → 0.212.0) — the TWENTY-SEVENTH time.
    // D302 ran `precheck` TWICE (clean at 542 before the first edit; FOUR broken
    // rows after the build) and this time it was NOT alone: the ternary in
    // `unitsOf` grew a third arm, which broke three D262/D300 rows whose anchors
    // QUOTED that line. ⚠️ **THAT IS THE EARLY RUN EARNING ITS KEEP IN THE
    // DIRECTION THE COMMENTS ABOVE KEEP DISCOUNTING**: D296/D297 justified a
    // single late run because nothing was extracted and no quoted line moved.
    // D302 extracted a helper AND rewrote a quoted line, so it owed both runs and
    // the second one named four rows instead of one.
    // 🆕 RE-POINTED AT D307 (0.212.0 -> 0.213.0) - the TWENTY-EIGHTH time.
    // D307 ran `precheck` TWICE: clean at 555 before the first edit, and after the
    // build + the bump `1 BROKEN ROW(S)` naming THIS row and nothing else - even
    // though the slice EXTRACTED a function out of `turn.ts` into `types.ts`
    // (`evolveOnto`), which is exactly the shape D302's note says owes both runs.
    // ⚠️ **AND THE TWO D306 ROWS THAT QUOTE `placeEvolution` SURVIVED THE
    // EXTRACTION INTACT, WHICH IS ITSELF THE CLAIM**: both anchor on the two TAILS,
    // and the whole point of the split is that the tails stayed where they were.
    // 🆕 RE-POINTED AT D308 (0.213.0 -> 0.214.0) - the TWENTY-NINTH time.
    // 🆕 RE-POINTED AT D309 (0.214.0 -> 0.215.0) - the THIRTIETH time. D309 ran
    // `precheck` TWICE for D302's reason and it paid: the slice RENAMED a field
    // (`ontoBench` -> `onto`) across two source files, which is the same class of
    // edit as an extraction - it moves quoted lines without changing behaviour.
    // 🆕 RE-POINTED AT D315 (0.220.0 -> 0.221.0) - the TWENTY-FIFTH payment, and
    // 🛑 **THE FIRST SLICE ON THIS PAGE TO FORECAST THE OTHER BROKEN ROWS BY
    // NAME.** D314's rule says a slice that re-spells a line an earlier row QUOTED
    // must budget the re-anchoring; D315 FACTORED D309's candidate walk into a
    // shared builder, predicted in writing that `precheck` would name this row
    // plus exactly `D309-candidates-skip-the-narrowing` and
    // `D309-candidates-stay-bench-only`, and all three were re-anchored in the
    // same commit. **The rule is predictive, not just diagnostic.**
    // 🆕 RE-POINTED AT D318 (0.223.0 -> 0.224.0) - the TWENTY-EIGHTH payment.
    // 🆕 RE-POINTED AT D317 (0.222.0 -> 0.223.0) - the TWENTY-SEVENTH payment.
    // 🆕 RE-POINTED AT D316 (0.221.0 -> 0.222.0) - the TWENTY-SIXTH payment, and
    // the FORECAST held a second time: this slice only ADDS lines (a reader, two
    // optional fields, three terms in three boolean sums), so `precheck` was
    // predicted in writing to name THIS ROW AND NOTHING ELSE.
    // 🆕 RE-POINTED AT D319 (0.224.0 -> 0.225.0) - the TWENTY-NINTH payment.
    // 🆕 RE-POINTED AT D320 (0.225.0 -> 0.226.0) - the THIRTIETH payment.
    // 🆕 RE-POINTED AT D321 (0.226.0 -> 0.227.0) - the THIRTY-FIRST payment.
    // 🆕 RE-POINTED AT D322 (0.227.0 -> 0.228.0) - the THIRTY-SECOND payment.
    // 🆕 RE-POINTED AT D323 (0.228.0 -> 0.229.0) - the THIRTY-THIRD payment.
    // 🆕 RE-POINTED AT D324 (0.229.0 -> 0.230.0) - the THIRTY-FOURTH payment.
    // 🆕 RE-POINTED AT D325 (0.230.0 -> 0.231.0) - the THIRTY-FIFTH payment.
    // 🆕 RE-POINTED AT D326 (0.231.0 -> 0.232.0) - the THIRTY-SIXTH payment.
    // 🆕 RE-POINTED AT D327 (0.232.0 -> 0.233.0) - the THIRTY-SEVENTH payment.
    find: "export const engineVersion = \"0.234.0\";",
    replace: "export const engineVersion = \"0.193.0\";",
    expectKilledBy: ["packages/engine/src/fanCall.test.ts"],
  },
  // ── D316 - "You may do {N} more damage. If you do, ..." - the EIGHTH attack-text
  //    reader, `optional.otherwise` and `damageDefender`'s flat arm. Every row
  //    below is a way of ending up with the WRONG NUMBER on a hit that still
  //    happens, which is this slice's whole failure surface: the sentence prints
  //    two outcomes and both of them deal damage.
  {
    id: "D316-decline-buys-nothing",
    decision: "D316",
    what: "the `optional` decline splices the empty list again - D186's shape, and with the base suppressed it deals ZERO on a sentence whose printed no still hits for its base",
    file: "packages/engine/src/interpreter.ts",
    find: '    return choice.kind === "confirm" && choice.yes ? [...op.then] : [...(op.otherwise ?? [])];',
    replace: '    return choice.kind === "confirm" && choice.yes ? [...op.then] : [];',
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-base-not-dropped",
    decision: "D316",
    what: "the reader stops claiming the printed base, so it lands pre-program AND again inside the gate - the double hit effects.ts refuses",
    file: "packages/engine/src/attack.ts",
    // 🆕 RE-POINTED AT D317, AND THE REASON IS WORTH A LINE: this row's `find`
    // spanned TWO lines of a boolean sum and D317 inserted its own term BETWEEN
    // them. The quoted line was never edited — a `git grep` for it still finds it —
    // and the row broke anyway. **A MULTI-LINE `find` IS A CLAIM ABOUT ADJACENCY,
    // AND AN ADDITION CAN FALSIFY IT WITHOUT TOUCHING A CHARACTER.**
    find: "    optionalBoost !== null ||\n    bonusConsequent !== null ||\n    coinFlip?.kind === \"perHeads\"",
    replace: "    bonusConsequent !== null ||\n    coinFlip?.kind === \"perHeads\"",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-yes-arm-loses-the-bonus",
    decision: "D316",
    what: "the accepted arm deals the bare printed base - the printed \"more damage\" bought nothing. 🆕 RE-POINTED AT D318 into the SHARED `boostedArms`, so this row and its D317 twin are now the SAME mutation with two different killers - which is the point rather than a duplicate: the arm is shared, so it owes a kill from each sentence",
    file: "packages/engine/src/effects.ts",
    find: "    [{ op: \"damageDefender\", amount: base + bonus }, ...ops],",
    replace: "    [{ op: \"damageDefender\", amount: base }, ...ops],",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-no-arm-takes-the-boost",
    decision: "D316",
    what: "the DECLINE deals base + bonus - the two arms copied from each other, which is the mistake the field's shape invites. 🆕 RE-POINTED AT D318 into the SHARED `boostedArms`",
    file: "packages/engine/src/effects.ts",
    find: "    [{ op: \"damageDefender\", amount: base }],",
    replace: "    [{ op: \"damageDefender\", amount: base + bonus }],",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-consequent-dropped",
    decision: "D316",
    what: "the accepted arm deals the boosted damage and runs NO consequent - an attack whose printed drawback silently vanished. 🆕 RE-POINTED AT D318 into the SHARED `boostedArms`, and it stopped being a MULTI-LINE find in the process: the arm is one line there, so the adjacency claim D317 lost three rows to is gone with it",
    file: "packages/engine/src/effects.ts",
    find: "    [{ op: \"damageDefender\", amount: base + bonus }, ...ops],",
    replace: "    [{ op: \"damageDefender\", amount: base + bonus }],",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-modifier-unclaimed",
    decision: "D316",
    what: "the printed \"+\" is left unexplained, so all five printings keep a loud ATTACK_EFFECT_SKIPPED for a modifier the engine has just spent (D126's term, one reader over)",
    file: "packages/engine/src/attack.ts",
    // 🆕 RE-POINTED AT D317 for the reason the `scaledBase` row above records.
    find: "    optionalBoost !== null ||\n    bonusConsequent !== null ||\n    coinExplainsModifier;",
    replace: "    bonusConsequent !== null ||\n    coinExplainsModifier;",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-effect-unclaimed",
    decision: "D316",
    what: "the sentence is left unexplained, so the whole printed effect is loudly skipped although it was read completely",
    file: "packages/engine/src/attack.ts",
    // 🆕 RE-POINTED AT D317 for the reason the `scaledBase` row above records.
    find: "    coinFlip !== null ||\n    optionalBoost !== null ||\n    bonusConsequent !== null ||\n    damageSuppression !== null;",
    replace: "    coinFlip !== null ||\n    bonusConsequent !== null ||\n    damageSuppression !== null;",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-note-paraphrased",
    decision: "D316",
    what: "the confirm prompt captions itself instead of quoting the printed sentence - D306's rule, and the player would be agreeing to the damage without seeing the drawback",
    file: "packages/engine/src/attack.ts",
    // 🆕 RE-POINTED AT D318: the whole `optional` literal left this file for
    // `effects.ts`, so the printed sentence now crosses the gap as the assembler's
    // third ARGUMENT and the call site is the one line below.
    find: "    program = [...(program ?? []), ...optionalBoostProgram(optionalBoost, base, effect ?? \"\")];",
    replace: "    program = [...(program ?? []), ...optionalBoostProgram(optionalBoost, base, \"You may do more damage.\")];",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-flat-hit-skips-weakness",
    decision: "D316",
    what: "the flat arm passes `ignoreWR` - Umbreon's real flag on `damageChosen`, copied one op over, and it makes the gate's hit stop being genuine attack damage",
    file: "packages/engine/src/interpreter.ts",
    find: "      const amount = op.amount ?? recorded(record, op.count).length * op.per;\n      if (amount <= 0) return { done: state };\n      return { done: snipeActive(state, amount, false, ctx, events) };",
    replace: "      const amount = op.amount ?? recorded(record, op.count).length * op.per;\n      if (amount <= 0) return { done: state };\n      return { done: snipeActive(state, amount, true, ctx, events) };",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-consequent-verb-capitalised",
    decision: "D316",
    what: "the recoil consequent's anchor spells the BARE sentence's capital - D246's rule inverted, and no printed consequent would ever match",
    file: "packages/engine/src/effects.ts",
    find: "const BOOST_SELF_DAMAGE = /^this Pokémon also does (\\d+) damage to itself\\.$/;",
    replace: "const BOOST_SELF_DAMAGE = /^This Pokémon also does (\\d+) damage to itself\\.$/;",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-consequent-drops-the-apostrophe-class",
    decision: "D316",
    what: "the lock consequent spells `can't` straight-only - D136/D137's exposure, at the one apostrophe slot this reader has",
    file: "packages/engine/src/effects.ts",
    find: "const BOOST_CANT_ATTACK = /^during your next turn, this Pokémon can['’]t attack\\.$/;",
    replace: "const BOOST_CANT_ATTACK = /^during your next turn, this Pokémon can't attack\\.$/;",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-recoil-amount-pinned",
    decision: "D316",
    what: "the recoil consequent pins Gurdurr's printed 30 instead of capturing - green on one card and wrong on Dondozo ex's 50, the literal FLIP_TAILS_SELF_DAMAGE refused for the same reason",
    file: "packages/engine/src/effects.ts",
    find: "    return amount >= 1 ? { bonus, ops: [{ op: \"damageSelf\", amount }] } : null;",
    replace: "    return amount >= 1 ? { bonus, ops: [{ op: \"damageSelf\", amount: 30 }] } : null;",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-return-destination-copied",
    decision: "D316",
    what: "the self-removal consequent returns to the HAND - D313's real sibling destination, copied onto a sentence that prints \"into your deck\"",
    file: "packages/engine/src/effects.ts",
    find: "    return { bonus, ops: [{ op: \"returnSelf\", dest: \"deck\" }] };",
    replace: "    return { bonus, ops: [{ op: \"returnSelf\", dest: \"hand\" }] };",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-zero-bonus-admitted",
    decision: "D316",
    what: "a printed 0 bonus derives to a decision with no stake - the `>= 1` guard SELF_DAMAGE and the exact-N discards carry, dropped at the new capture",
    file: "packages/engine/src/effects.ts",
    // 🆕 RE-POINTED AT D317, AND THIS IS THE *OTHER* WAY AN ADDITION BREAKS A ROW.
    // D317's reader carries `if (bonus < 1) return null;` TWICE (once per decider
    // anchor) with the same guard and the same words, so this row's one-line `find`
    // went from 1 occurrence to THREE — the 4-space copy matching as a SUBSTRING of
    // its own indentation. Nothing was edited; a NAMESAKE was added elsewhere in the
    // file. 🛑 **A ONE-LINE `find` IS ONLY UNIQUE UNTIL SOMEBODY WRITES THE SAME
    // LINE**, so it is widened here with the line above it, which names this
    // reader's own local and cannot be written by another.
    find: "  const consequent = match[2] ?? \"\";\n  if (bonus < 1) return null;\n",
    replace: "  const consequent = match[2] ?? \"\";\n",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  {
    id: "D316-unknown-consequent-claimed",
    decision: "D316",
    what: "an unrecognised consequent derives the BOOST with no drawback at all - the prefix match the family's safety property forbids, and strictly worse than not reading the sentence",
    file: "packages/engine/src/effects.ts",
    find: "  if (BOOST_CANT_ATTACK.test(consequent)) return { bonus, ops: [{ op: \"preventAttack\" }] };\n  return null;",
    replace: "  if (BOOST_CANT_ATTACK.test(consequent)) return { bonus, ops: [{ op: \"preventAttack\" }] };\n  return { bonus, ops: [] };",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
  },
  // ── D276 — the SHARED structural program walker (testFixtures.ts `walkProgram`),
  // which five auditor suites now run on. Every row below is a way of sweeping
  // LESS while every downstream `toEqual` stays GREEN — the silent, flattering
  // failure this slice exists to make impossible.
  {
    id: "D276-walk-stops-at-the-top-level",
    decision: "D276",
    what: "the shared walker stops recursing: every nested branch is invisible, so `preventBlock`'s TOTAL op-kind table, `vengefulPunch`'s attack-op set, `attackDebuff`'s producer list and `tailsGatedOp`'s gate sweep all silently shrink to the top level. This is the whole abstraction failing OPEN — nothing throws, the sets just get smaller",
    file: "packages/engine/src/testFixtures.ts",
    find: "      for (const nested of subPrograms(op)) visit(nested);",
    replace: "      void subPrograms(op);",
    expectKilledBy: ["packages/engine/src/programWalk.test.ts"],
  },
  {
    id: "D276-walk-descends-then-only",
    decision: "D276",
    what: "🛑 THE PRE-D276 BLIND SPOT, RE-INSTALLED EXACTLY: the negative predicate degrades to the key name `then`, so `conditionGate.otherwise` (4 live ops in the pool) goes unswept and a future `coinFlipGate.otherwise` would too. This is the shape four of the five hand-rolled walkers actually had, and it went unnoticed for seven slices",
    file: "packages/engine/src/testFixtures.ts",
    find: "  for (const value of Object.values(op as unknown as Record<string, unknown>)) {",
    replace: "  for (const value of [(op as unknown as Record<string, unknown>).then]) {",
    expectKilledBy: ["packages/engine/src/programWalk.test.ts"],
  },
  {
    id: "D276-walk-admits-an-empty-branch",
    decision: "D276",
    what: "the `every()`-on-empty trap: an empty array is vacuously \"all ops\", so an op whose `otherwise` is present-but-empty is reported by `programBranchCarriers` as EXERCISING that branch. The carrier pin is the engine's only statement about which branches the pool actually reaches, and this makes it claim one it does not",
    file: "packages/engine/src/testFixtures.ts",
    find: "    if (!Array.isArray(value) || value.length === 0) continue;",
    replace: "    if (!Array.isArray(value)) continue;",
    expectKilledBy: ["packages/engine/src/programWalk.test.ts"],
  },
  {
    id: "D276-walk-descends-any-object-array",
    decision: "D276",
    what: "the predicate stops requiring a string `op` on the elements, so ANY array of objects on an op is descended as if it were a program — an `attachCards`-shaped target list becomes phantom ops in every downstream sweep. The false-positive direction, which is the one a bare `expect(found.length).toBeGreaterThan(n)` cannot see",
    file: "packages/engine/src/testFixtures.ts",
    find: "        entry !== null && typeof entry === \"object\" && typeof (entry as { op?: unknown }).op === \"string\",",
    replace: "        entry !== null && typeof entry === \"object\",",
    expectKilledBy: ["packages/engine/src/programWalk.test.ts"],
  },
  {
    id: "D276-walk-yields-post-order",
    decision: "D276",
    what: "the op is yielded AFTER its branches instead of before. Every set-valued consumer is unaffected — which is precisely why this needs its own row: the one suite that reports WHERE a gate was found, and any future consumer that pairs a gate with the ops beneath it, reads a reversed program",
    file: "packages/engine/src/testFixtures.ts",
    find: "      out.push(op);\n      for (const nested of subPrograms(op)) visit(nested);",
    replace: "      for (const nested of subPrograms(op)) visit(nested);\n      out.push(op);",
    expectKilledBy: ["packages/engine/src/programWalk.test.ts"],
  },
  // ── D277 — the §4 ATTACK LICENCE (`PassiveEffects.attackFirstTurnExempt`,
  // Meloetta ex "Debut Performance") and the predicate three payability sites now
  // share. Rows 4 and 5 are the DRIFT this slice's extraction exists to prevent:
  // each re-installs the literal `state.turn === 1` at one of the three sites,
  // which is exactly the state the tree was in before the licence landed and is
  // invisible to `tsc`.
  {
    id: "D277-licence-not-authored",
    decision: "D277",
    what: "the registry row keeps its `passive` key and loses the licence, so all three Meloetta ex printings are ordinary bodies again and the §4 ban refuses a turn-1 \"Echoed Voice\" the card explicitly permits. ⚠️ `censusAtHead`'s attribution control still passes — the program is still non-attack and still defined — so only the driven suite can see this",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { attackFirstTurnExempt: true },",
    replace: "  passive: {},",
    expectKilledBy: ["packages/engine/src/debutPerformance.test.ts"],
  },
  {
    id: "D277-fold-drops-the-licence",
    decision: "D277",
    what: "`passivesOf` reads the field and throws it away, so the fold reports `false` for a licensed body. The registry row is intact and the read sites are intact; the wire between them is cut, which is the failure mode a shape assertion on either end cannot see",
    file: "packages/engine/src/continuous.ts",
    find: "    if (passive.attackFirstTurnExempt === true) attackFirstTurnExempt = true;",
    replace: "    void passive.attackFirstTurnExempt;",
    expectKilledBy: ["packages/engine/src/debutPerformance.test.ts"],
  },
  {
    id: "D277-ban-conflated-with-isFirstTurnOf",
    decision: "D277",
    what: "🛑 THE ONE WRONG READING THE WHOLE SLICE ARGUES AGAINST: the §4 attack ban is widened from `state.turn === 1` to \"either seat's first turn\", i.e. `isFirstTurnOf`. Turn 2 is the going-SECOND seat's first turn and is UNRESTRICTED, so this invents a ban nobody printed — on the seat already going second. Every licensed board still behaves correctly, which is why the killing case is an UNLICENSED body on turn 2",
    file: "packages/engine/src/continuous.ts",
    find: "  if (state.turn !== 1) return false;",
    replace: "  if (state.turn > 2) return false;",
    expectKilledBy: ["packages/engine/src/debutPerformance.test.ts"],
  },
  {
    id: "D277-attack-site-regresses-to-the-literal",
    decision: "D277",
    what: "`attack`'s §8 gate goes back to spelling `state.turn === 1` itself, so the ENGINE refuses a turn-1 attack that `redactedAttacksOf` and the HUD both offer as playable. The drift direction that burns a player's click; the extraction is what makes it impossible and this row is the proof",
    file: "packages/engine/src/attack.ts",
    find: "  if (firstTurnAttackBanned(state, active, action.index)) {",
    replace: "  if (state.turn === 1) {",
    expectKilledBy: ["packages/engine/src/debutPerformance.test.ts"],
  },
  {
    id: "D277-redact-site-regresses-to-the-literal",
    decision: "D277",
    what: "the WIRE projection goes back to the literal, so a licensed Meloetta's attack row is greyed on every client while `attack` would happily accept it. The mirror of the row above and the reason §5 of the suite drives the two answers against each other per seed instead of asserting each alone",
    file: "packages/engine/src/redact.ts",
    find: "        !firstTurnAttackBanned(state, active, index) &&",
    replace: "        state.turn !== 1 &&",
    expectKilledBy: ["packages/engine/src/debutPerformance.test.ts"],
  },
  // ── D281 — the PER-ATTACK-INDEX TIMING GATE (`CardProgram.attackGate`). Six
  //    rows: the two polarities collapsed into one, the per-index licence widened
  //    to the body, the §9 rule inverted, and each of the two mirrors dropped.
  //    ⚠️ EVERY `find` BELOW IS ANCHORED ON A STRUCTURAL BOUNDARY (a return, a
  //    conditional's whole line, a `&&` term with its own comment above it) rather
  //    than on a line inside a growing region — `D255-lock-gate-bypassed` broke in
  //    three consecutive slices by anchoring on the last statement of a loop.
  {
    id: "D281-polarity-collapses-to-one-sign",
    decision: "D281",
    what: "🛑 THE DEFECT THE WHOLE FIELD SHAPE EXISTS TO REFUSE: `attackTimingBlocked` stops reading the polarity TOKEN and treats every gate as an `onlyIf`, so Terapagos ex's 7 printings get their `barredIf` read backwards — \"Unified Beatdown\" becomes usable on exactly the one turn the card forbids it and dead on every other. ⚠️ A BUILD WITH TWO PARALLEL INDEX MAPS IS THIS MUTANT: the discriminator moves into a field name and one reader still has to know which map means which sign",
    file: "packages/engine/src/interpreter.ts",
    find: '  return (gate.kind === "onlyIf") === holds ? undefined : gate;',
    replace: "  return holds ? undefined : gate;",
    expectKilledBy: ["packages/engine/src/attackIndexGate.test.ts"],
  },
  {
    id: "D281-licence-widens-from-index-to-body",
    decision: "D281",
    what: "🛑 THE TOO-WIDE PERMISSION, AND THE ONE A CARELESS BUILD ACTUALLY SHIPS: the per-INDEX licence is read as a per-BODY flag, so Volbeat `sv06-009`'s idx 1 \"Coordinated Strike\" is licensed on turn 1 along with the \"Quick Sign\" the card actually names. ⚠️ EVERY \"the licence works\" ASSERTION ANYONE WOULD NATURALLY WRITE STAYS GREEN — they are all about idx 0 — which is why §2 of the suite asserts the DENIED row before the permitted one",
    file: "packages/engine/src/continuous.ts",
    find: '  return attackGateOf(state, pokemon, index)?.kind !== "firstTurnExempt";',
    replace: '  return programFor(topCardOf(state, pokemon)?.id ?? "")?.attackGate === undefined;',
    expectKilledBy: ["packages/engine/src/attackIndexGate.test.ts"],
  },
  {
    id: "D281-gate-read-through-the-ability-fold",
    decision: "D281",
    what: "the printed ATTACK clause is read through the §9 SUPPRESSION the passive fold applies, so a Klefki `sv01-096` Ability-lock silences it — Terapagos ex may suddenly use the attack its own text bars and Volbeat suddenly may not use the one its own text licenses, in the same call. 🛑 THE INVERSE OF `attackFirstTurnExempt`'s RULE, and the easiest thing in this slice to get wrong by copying the field one line over. ⚠️ SPELLED AS THE `disabled` DROP `passivesOf` ITSELF MAKES (`disabledAbilityUids`) AND NOT AS AN `attackFirstTurnExempt` READ — the first draft of this row did the latter, precheck passed it, and it SURVIVED because not one of the 13 bodies carries that flag: the mutant changed nothing. A `find` that occurs is not a mutant that mutates",
    file: "packages/engine/src/continuous.ts",
    find: "  return programFor(top.id)?.attackGate?.[index];",
    replace: "  const holder = topUid(pokemon);\n  if (holder !== undefined && disabledAbilityUids(state).has(holder)) return undefined;\n  return programFor(top.id)?.attackGate?.[index];",
    expectKilledBy: ["packages/engine/src/attackIndexGate.test.ts"],
  },
  {
    id: "D281-engine-gate-dropped-entirely",
    decision: "D281",
    what: "`attack`'s §8 seam stops consulting the printed timing clause, so the ENGINE accepts a declaration both payability projections grey out — the drift direction that makes a greyed button the only thing standing between a player and an illegal attack. The mirror of the two rows below",
    file: "packages/engine/src/attack.ts",
    find: "  const timingGate = attackTimingBlocked(state, action.seat, active, index);",
    replace: "  const timingGate = undefined as ReturnType<typeof attackTimingBlocked>;",
    expectKilledBy: ["packages/engine/src/attackIndexGate.test.ts"],
  },
  {
    id: "D281-wire-projection-forgets-the-clause",
    decision: "D281",
    what: "the WIRE projection drops the per-index timing term, so Terapagos ex's barred \"Unified Beatdown\" is offered as playable on every client while `attack` rejects it with ATTACK_PREVENTED. ⚠️ THE PREDICTED FAILURE THIS SLICE WAS TOLD TO EXPECT — D223's `needs` string named a field and not its two mirrors — and the reason §5 sweeps 256 (seed × assignment × body × row) pairs for AGREEMENT rather than asserting either side alone",
    file: "packages/engine/src/redact.ts",
    find: "        attackTimingBlocked(state, viewerSeat, active, index) === undefined &&",
    replace: "        true &&",
    expectKilledBy: ["packages/engine/src/attackIndexGate.test.ts"],
  },
  {
    id: "D281-wire-hoists-the-first-turn-ban-back-out",
    decision: "D281",
    what: "the §4 ban goes back to being computed ONCE for the whole body in `redactedAttacksOf` — D277's shape, correct until this slice and wrong the moment a licence is printed on ONE attack. Volbeat's licensed \"Quick Sign\" is greyed on every client alongside the \"Coordinated Strike\" that really is banned, and the server would have accepted it. ⚠️ THE QUIET DIRECTION: a greyed row is never clicked, so nobody reports it",
    file: "packages/engine/src/redact.ts",
    find: "        !firstTurnAttackBanned(state, active, index) &&",
    replace: "        !firstTurnAttackBanned(state, active, 1) &&",
    expectKilledBy: ["packages/engine/src/attackIndexGate.test.ts"],
  },
  // ── D278 — the §4/§10 EVOLVE licence (Eevee "Boosted Evolution"). The rows
  //    below are the six ways to build this card WRONG, and the first two are
  //    the two halves of ONE printed sentence: a licence that lifts one ban and
  //    not the other is the defect the whole slice exists to refuse.
  {
    id: "D278-licence-lifts-only-the-first-turn-ban",
    decision: "D278",
    what: "🛑 THE DEFECT THE WHOLE SLICE EXISTS TO REFUSE, AND THE ONE A CARELESS BUILD ACTUALLY SHIPS: the licence is consulted at §4's first-turn ban and NOT at §10's `turnPlayed >= state.turn`, so \"or the turn you play it\" is silently dropped. ⚠️ EVERY TURN-1 BOARD IN THE REPO STAYS GREEN — a setup Pokémon carries `turnPlayed = 0` and `0 >= 1` is false, so ban 2 never fires there. Only a LATER turn with a body played THAT turn can see it, which is exactly the case §5 of the suite exists for",
    file: "packages/engine/src/turn.ts",
    find: "  if (!licensed && target.turnPlayed >= state.turn) {",
    replace: "  if (target.turnPlayed >= state.turn) {",
    expectKilledBy: ["packages/engine/src/boostedEvolution.test.ts"],
  },
  {
    id: "D278-licence-lifts-only-the-too-soon-ban",
    decision: "D278",
    what: "the MIRROR of the row above — the licence reaches §10's summoning sickness and not §4's first-turn ban, so a licensed Eevee still cannot evolve on turn 1, the printing's headline use. Cheaper to notice than its twin (every turn-1 case reddens), which is precisely why the twin is the dangerous one and both are declared",
    file: "packages/engine/src/turn.ts",
    find: "  if (!licensed && isFirstTurnOf(state, action.seat)) {",
    replace: "  if (isFirstTurnOf(state, action.seat)) {",
    expectKilledBy: ["packages/engine/src/boostedEvolution.test.ts"],
  },
  {
    id: "D278-registry-row-loses-the-licence",
    decision: "D278",
    what: "the registry row keeps its `passive` key and loses the licence, so all three Eevee printings are ordinary Basics again and both bans refuse an evolve the card explicitly permits. ⚠️ `censusAtHead`'s attribution control still passes — the program is still non-attack and still defined — so only the driven suite can see this (D277's twin row, verbatim in shape)",
    file: "packages/engine/src/registry.ts",
    // ⚠️ RE-ANCHORED AT D279, which widened this value from `true` to a RECORD.
    find: "  passive: { evolveEarlyExempt: { activeOnly: true } },",
    replace: "  passive: {},",
    expectKilledBy: ["packages/engine/src/boostedEvolution.test.ts"],
  },
  {
    id: "D278-fold-drops-the-active-spot-clause",
    decision: "D278",
    what: "🛑 THE PRINTED CLAUSE A READ-SITE BUILD NEVER LEARNS ABOUT: `&& !onBench` is dropped from the fold, so \"As long as this Pokémon is in the Active Spot\" stops being enforced and a BENCHED Eevee licenses itself. Nothing at any read site can catch it — the whole point of resolving the zone in the fold is that the five ban lines do not know the clause exists — so the killing cases are the fold's bench probe and the benched-body evolve",
    file: "packages/engine/src/continuous.ts",
    // ⚠️ RE-ANCHORED AT D279 onto the fold's new push, whose `activeOnly` guard
    // replaced this line. The MEANING is unchanged — Eevee's printed zone clause
    // stops being enforced and a BENCHED Eevee licenses itself — and the mutant
    // is now the exact INVERSE of `D279-zone-gate-reused-on-the-partner-licence`
    // below: that one applies the zone gate to a printing that does not print it,
    // this one drops it from the printing that does. **The pair is the point.**
    find: "    if (licence !== undefined && (licence.activeOnly !== true || !onBench)) {",
    replace: "    if (licence !== undefined) {",
    expectKilledBy: ["packages/engine/src/boostedEvolution.test.ts"],
  },
  {
    id: "D278-predicate-bypasses-the-ability-lock",
    decision: "D278",
    what: "the predicate reads the catalog row straight off the target's top card instead of through `passivesOf`, so a Klefki `sv01-096` Ability-lock no longer silences \"Boosted Evolution\". The licence IS a printed Ability on a BASIC — exactly what that lock reaches — and this is the shorter build that gets §9 wrong SILENTLY, which is why the field rides the fold at all",
    // ⚠️ RE-ANCHORED AT D279: the predicate MOVED continuous.ts → interpreter.ts
    // (it needs `conditionHolds` for the partner gate) and its body became a fold
    // over a list. The mutant's meaning is unchanged — read the catalog row
    // straight off the top card and the §9 lock stops reaching the licence — and
    // it now kills in BOTH suites, since both licences ride `passivesOf`.
    file: "packages/engine/src/interpreter.ts",
    find: "  return passivesOf(state, pokemon).evolveEarlyExempt.some(",
    replace:
      "  const top = topCardOf(state, pokemon);\n  const direct = top === undefined ? undefined : programFor(top.id)?.passive?.evolveEarlyExempt;\n  return (direct === undefined ? [] : [direct.ifInPlay === undefined ? undefined : ({ kind: \"yourNamedPokemonInPlay\", name: direct.ifInPlay } as const)]).some(",
    expectKilledBy: [
      "packages/engine/src/boostedEvolution.test.ts",
      "packages/engine/src/stimulatedEvolution.test.ts",
    ],
  },
  {
    id: "D278-licence-leaks-into-rare-candy",
    decision: "D278",
    what: "🛑 THE READING THIS SLICE DECIDED AGAINST, INSTALLED: the licence is wired into `rareCandy`'s first-turn ban, so an Ability printed on the TARGET lifts a restriction printed on the Rare Candy CARD (\"You can\'t use this card during your first turn…\"). ⚠️ NO BOARD IN THE REAL CATALOG CAN SEE THIS — zero Standard Stage 2 chain from Eevee, measured — so the suite drives it off a LOCAL Stage-1/Stage-2 chain. An unreachable decision that no test pins is a decision nobody can ever find",
    file: "packages/engine/src/cardplay.ts",
    // ⚠️ RE-SPELLED AT D279, AND THE OLD SPELLING WAS A LATENT DEFECT `precheck`
    // CANNOT SEE. It called `evolveEarlyLicensed(state, target)` — an identifier
    // cardplay.ts never imports, and (since D279) at the wrong arity — so the
    // mutant would have died of a ReferenceError rather than of the behaviour it
    // names, which is a FALSE KILL: the row would report "the suite catches this"
    // when the suite merely caught a crash. **A `find` that occurs is not a
    // mutant that compiles**, and precheck only checks the first. Now spelled
    // with `programFor` and `targetCard`, both already in scope at this site —
    // which is also what a naive leak would actually look like.
    find: "  if (isFirstTurnOf(state, action.seat)) {\n    return err(\"FIRST_TURN_EVOLVE\", \"cannot use Rare Candy on your first turn (§4/§7.1)\");",
    replace:
      "  if (programFor(targetCard.id)?.passive?.evolveEarlyExempt === undefined && isFirstTurnOf(state, action.seat)) {\n    return err(\"FIRST_TURN_EVOLVE\", \"cannot use Rare Candy on your first turn (§4/§7.1)\");",
    expectKilledBy: ["packages/engine/src/boostedEvolution.test.ts"],
  },
  {
    id: "D279-zone-gate-reused-on-the-partner-licence",
    decision: "D279",
    what: "🛑 **THE MIRROR OF D278's TRAP, INSTALLED**: D278's unconditional `&& !onBench` is restored to the fold, so the Active-Spot clause is applied to Karrablast/Shelmet — four printings that DO NOT PRINT IT — and a BENCHED licensed body is refused an evolution the card allows. ⚠️ IT FAILS BY BEING **TOO STRICT**, which is the direction no `ok`-side assertion can see: measured on the real tree, this reddens EXACTLY TWO tests (the fold's bench probe and the benched-body evolve) while 40 assertions written on ACTIVE bodies stay green",
    file: "packages/engine/src/continuous.ts",
    find: "    if (licence !== undefined && (licence.activeOnly !== true || !onBench)) {",
    replace: "    if (licence !== undefined && !onBench) {",
    expectKilledBy: ["packages/engine/src/stimulatedEvolution.test.ts"],
  },
  {
    id: "D279-registry-row-gains-the-zone-clause",
    decision: "D279",
    what: "the same trap arriving from the DATA side rather than the code side: the Karrablast row copies `activeOnly` from the Eevee row three lines up in registry.ts — the single most likely edit a future author makes — and the licence silently stops working on the Bench. Declared beside the fold mutant because the two are different mistakes with one symptom, and a corpus that only pins the code path would let the copy-paste through",
    file: "packages/engine/src/registry.ts",
    find: '  passive: { evolveEarlyExempt: { ifInPlay: "Shelmet" } },',
    replace: '  passive: { evolveEarlyExempt: { activeOnly: true, ifInPlay: "Shelmet" } },',
    expectKilledBy: ["packages/engine/src/stimulatedEvolution.test.ts"],
  },
  {
    id: "D279-partner-gate-is-self-satisfying",
    decision: "D279",
    what: "🛑 THE REPRINT IDIOM APPLIED ONE PRINTING TOO FAR: Karrablast's gate names KARRABLAST instead of Shelmet, which is what sharing ONE `CardProgram` across all four printings would produce. The gate then reads TRUE off the holder itself, so the licence is unconditional and a lone Karrablast evolves on turn 1 with no partner anywhere. ⚠️ The catalog is the only reason to know better — the two pairs' `abilities_json` are byte-identical WITHIN each pair and different ACROSS",
    file: "packages/engine/src/registry.ts",
    find: '  passive: { evolveEarlyExempt: { ifInPlay: "Shelmet" } },',
    replace: '  passive: { evolveEarlyExempt: { ifInPlay: "Karrablast" } },',
    expectKilledBy: ["packages/engine/src/stimulatedEvolution.test.ts"],
  },
  {
    id: "D279-in-play-collapses-to-bench-only",
    decision: "D279",
    what: "🛑 THE NEW VOCABULARY MEMBER BECOMES ITS NEIGHBOUR: `yourNamedPokemonInPlay` stops consulting the Active Spot, so it answers exactly what `yourBenchHasNamed` answers and the printed word \"in play\" quietly means \"on your Bench\". A Karrablast whose Shelmet is ACTIVE loses its licence. This is the mutant for the D131 that was priced and DECLINED — if the two members really were one, this row would be unkillable",
    file: "packages/engine/src/interpreter.ts",
    find: "      const side = state.players[seat];\n      return [side.active, ...side.bench].some(\n        (p) => p !== null && topCardOf(state, p)?.name === cond.name,\n      );",
    replace: "      return state.players[seat].bench.some(\n        (p) => p !== null && topCardOf(state, p)?.name === cond.name,\n      );",
    expectKilledBy: ["packages/engine/src/stimulatedEvolution.test.ts"],
  },
  {
    id: "D279-bench-member-widened-instead-of-added",
    decision: "D279",
    what: "🛑 THE D131 THIS SLICE DECLINED, TAKEN: `yourBenchHasNamed` is widened to consult the Active Spot instead of a second member being added. Falinks `sv02-119` \"Reckless Charge Together\" — whose clause names its OWN card and whose attacker is an ACTIVE Falinks — then satisfies itself, turning a conditional +90 into an unconditional one on every board with a single Falinks. ⚠️ THE DAMAGE SUITE IS WHERE THE REAL COST LANDS, which is why this row expects TWO killers: a vocabulary change is not local to the vocabulary",
    file: "packages/engine/src/interpreter.ts",
    find: "      return state.players[seat].bench.some(\n        (p) => p !== null && topCardOf(state, p)?.name === cond.name,\n      );\n    case \"yourNamedPokemonInPlay\": {",
    replace: "      return [state.players[seat].active, ...state.players[seat].bench].some(\n        (p) => p !== null && topCardOf(state, p)?.name === cond.name,\n      );\n    case \"yourNamedPokemonInPlay\": {",
    expectKilledBy: [
      "packages/engine/src/typeNameClause.test.ts",
      "packages/engine/src/stimulatedEvolution.test.ts",
    ],
  },
  {
    id: "D279-read-site-drops-the-partner-gate",
    decision: "D279",
    what: "the predicate treats every collected licence as unconditional — `.some(cond => cond === undefined || conditionHolds(...))` becomes a bare non-empty test — so the seat-relative half is never evaluated and a Karrablast is licensed with no Shelmet in play, and with the OPPONENT's Shelmet. ⚠️ THIS IS WHAT A FOLD-RESOLVED BUILD WOULD HAVE HAD TO DO: `passivesOf` has no seat, so the only way to answer the gate inside the fold is not to answer it. The row exists to pin why the predicate moved to interpreter.ts and gained a seat",
    file: "packages/engine/src/interpreter.ts",
    find: "  return passivesOf(state, pokemon).evolveEarlyExempt.some(\n    (cond) => cond === undefined || conditionHolds(state, seat, cond),\n  );",
    replace: "  return passivesOf(state, pokemon).evolveEarlyExempt.length > 0;",
    expectKilledBy: ["packages/engine/src/stimulatedEvolution.test.ts"],
  },
  {
    id: "D280-going-order-read-as-a-turn-number",
    decision: "D280",
    what: "🛑 THE TRAP THE HANDOFF NAMED, INSTALLED: `youGoSecond` answers `state.turn === 2` instead of reading `state.firstPlayer` against the seat. It is a SEAT-ASSIGNMENT question answered with a TURN question, so it is RIGHT on the one board Call Bell is played on and wrong on every other turn of the game — the direction that stays green on every natural \"the card works\" assertion. ⚠️ MEASURED ON THE REAL TREE: this reddens EXACTLY 4 assertions and leaves 4,534 green",
    file: "packages/engine/src/interpreter.ts",
    find: "      return state.firstPlayer !== null && state.firstPlayer !== seat;\n    case \"allOf\":",
    replace: "      return state.turn === 2;\n    case \"allOf\":",
    expectKilledBy: ["packages/engine/src/callBell.test.ts"],
  },
  {
    id: "D280-nullable-first-player-guard-dropped",
    decision: "D280",
    what: "the `firstPlayer !== null` guard goes, leaving `state.firstPlayer !== seat`. Before the flip that reads TRUE for BOTH seats (`null !== \"p1\"` and `null !== \"p2\"` are both true), so during setup everybody \"goes second\". ⚠️ QUIET BY CONSTRUCTION — no printed card is playable during setup, so the only thing that can see this is a direct `conditionHolds` probe, which is exactly why the suite writes one",
    file: "packages/engine/src/interpreter.ts",
    find: "      return state.firstPlayer !== null && state.firstPlayer !== seat;",
    replace: "      return state.firstPlayer !== seat;",
    expectKilledBy: ["packages/engine/src/callBell.test.ts"],
  },
  {
    id: "D280-allOf-folds-with-some",
    decision: "D280",
    what: "🛑 THE COMBINATOR BECOMES A DISJUNCTION: `.every` → `.some`, so `allOf` means `anyOf` and Call Bell is playable on the going-FIRST seat's turn 1 (one conjunct true) and on the going-second seat's every later turn (the other conjunct true). ⚠️ IT FAILS BY BEING TOO LOOSE while the one board the card is printed for stays GREEN, which is why the suite drives the two boards where exactly ONE conjunct holds",
    file: "packages/engine/src/interpreter.ts",
    find: "      return cond.conditions.every((inner) => conditionHolds(state, seat, inner));",
    replace: "      return cond.conditions.some((inner) => conditionHolds(state, seat, inner));",
    expectKilledBy: ["packages/engine/src/callBell.test.ts"],
  },
  {
    id: "D280-registry-row-drops-the-conjunction",
    decision: "D280",
    what: "the same defect from the DATA side rather than the code side, and the edit a future author actually makes: the registry gate collapses to the bare `yourFirstTurn` member, dropping the going-order conjunct the printed sentence spells first. Call Bell becomes playable on the going-FIRST seat's turn 1. ⚠️ MEASURED: 4 assertions red, 4,534 green — the SAME count as the code-side mutant above, on a different edit, which is why a corpus that pinned only the fold would let this through",
    file: "packages/engine/src/registry.ts",
    // 🆕 ⚠️ **RE-ANCHORED AT D295, AND THE CAUSE IS A THIRD KIND.** D291's hazard was
    // a `replace` that collided with an unrelated line; D292's was an EXTRACTION
    // moving the quoted text's context. **THIS ONE BROKE BECAUSE A SECOND CARD
    // AUTHORED THE SAME SHAPE**: `CHILL_TEASER_TOY` (D295) spells the identical
    // four-line `allOf`, so the old `find` matched **2×** and `precheck` refused
    // the row. **A SHARED VOCABULARY'S SECOND CONSUMER DUPLICATES EVERY BYTE THE
    // FIRST ONE'S MUTANT QUOTED** — nothing renamed, nothing moved, no signature
    // changed, and the row still stopped being runnable. Re-anchored on the
    // declaration's OWN NAME (a structural boundary the family cannot duplicate),
    // which is the "prefer a boundary the edit moves over a line the edit
    // replaces" rule applied to a DUPLICATION rather than to a growing region.
    find: "const CALL_BELL: CardProgram = {\n  trainerPlayableIf: {\n    kind: \"allOf\",\n    conditions: [{ kind: \"youGoSecond\" }, { kind: \"yourFirstTurn\" }],\n  },",
    replace: "const CALL_BELL: CardProgram = {\n  trainerPlayableIf: { kind: \"yourFirstTurn\" },",
    expectKilledBy: ["packages/engine/src/callBell.test.ts"],
  },
  {
    id: "D280-condition-note-joins-with-the-wrong-word",
    decision: "D280",
    what: "`conditionNote`'s `allOf` arm joins with \", \" instead of \" and \", so the reject a player reads is \"Call Bell can only be used if you go second, it is your first turn\" — a comma splice where the printed sentence has a conjunction. ⚠️ THIS IS THE ARM THE FORECAST CALLED THE HARD PART, and it is unkillable by any test that asserts the two halves separately: only an assertion on the JOINED string can see it",
    file: "packages/engine/src/interpreter.ts",
    find: "      return cond.conditions.map(conditionNote).join(\" and \");",
    replace: "      return cond.conditions.map(conditionNote).join(\", \");",
    expectKilledBy: ["packages/engine/src/callBell.test.ts"],
  },
  {
    id: "D280-call-bell-loses-its-reveal",
    decision: "D280",
    what: "the printed \"reveal it\" is dropped from Call Bell's `searchDeck`, so the fetched Supporter is named to nobody and the opponent's log reads \"put 1 card in hand\". D225's rider at a new row, and the mutant exists because `revealClause.test.ts`'s FIXTURE sweep classifies this program object — a row that is tabled but never DRIVEN would leave the classification honest and the behaviour free",
    file: "packages/engine/src/registry.ts",
    find: "    { op: \"searchDeck\", filter: { kind: \"supporter\" }, dest: \"hand\", max: 1, reveal: true },\n    { op: \"shuffleDeck\" },\n  ],\n};",
    replace: "    { op: \"searchDeck\", filter: { kind: \"supporter\" }, dest: \"hand\", max: 1 },\n    { op: \"shuffleDeck\" },\n  ],\n};",
    expectKilledBy: ["packages/engine/src/callBell.test.ts"],
  },
  {
    id: "D282-your-bench-reads-the-DEFENDER",
    decision: "D282",
    what: "🛑 THE SEAT SWAP, AND IT IS THE WHOLE MEMBER: `yourBenchCount` returns the DEFENDER's Bench population, which is `opponentBenchCount`'s answer one `case` up. Every symmetric board stays green — the suite's 3-mine/1-theirs board is the only place the two numbers differ (90 vs 30)",
    file: "packages/engine/src/attack.ts",
    find: "      return benchBodies(state, attackerSeat) * bonus.per;\n    case \"bothSidesBenchCount\":",
    replace: "      return benchBodies(state, defenderSeat) * bonus.per;\n    case \"bothSidesBenchCount\":",
    expectKilledBy: ["packages/engine/src/benchBodySelfScaling.test.ts"],
  },
  {
    id: "D282-your-bench-spans-the-table",
    decision: "D282",
    what: "`yourBenchCount` collapses into `bothSidesBenchCount` — the OTHER neighbour, and the other direction the same board tells apart (120 vs 90). Two mutants rather than one because a build that answered its left-hand neighbour and one that answered its right-hand neighbour are different defects and only a board where all three disagree kills both",
    file: "packages/engine/src/attack.ts",
    find: "      return benchBodies(state, attackerSeat) * bonus.per;\n    case \"bothSidesBenchCount\":",
    replace: "      return (benchBodies(state, attackerSeat) + benchBodies(state, defenderSeat)) * bonus.per;\n    case \"bothSidesBenchCount\":",
    expectKilledBy: ["packages/engine/src/benchBodySelfScaling.test.ts"],
  },
  {
    id: "D282-split-fires-without-a-gate",
    decision: "D282",
    what: "🛑 THE TOO-LOOSE BUILD, RE-INSTALLED: the split stops asking whether the clause is REPRESENTED and fires on text alone, so any printing of the gate sentence silently loses its restriction while its damage resolves. ⚠️ THIS IS GREEN ON EVERY DAMAGE ASSERTION IN THE SUITE — only §4's un-gated twin, written before the board where the split works, can see it",
    file: "packages/engine/src/attack.ts",
    find: "    printedEffect === null || attackGateOf(state, active, index) === undefined",
    replace: "    printedEffect === null",
    expectKilledBy: ["packages/engine/src/benchBodySelfScaling.test.ts"],
  },
  {
    id: "D282-split-clause-floats",
    decision: "D282",
    what: "the split's `^` anchor degrades to a substring search, so a gate clause printed anywhere in a compound is taken as its leading clause and the body is sliced from the wrong offset. The failure a search-style pattern always makes in this file, at the one place that is not a regex",
    file: "packages/engine/src/effects.ts",
    find: "    if (!trimmed.startsWith(`${clause} `)) continue;",
    replace: "    if (!trimmed.includes(`${clause} `)) continue;",
    expectKilledBy: ["packages/engine/src/benchBodySelfScaling.test.ts"],
  },
  {
    id: "D282-multiply-arm-answers-the-wrong-side",
    decision: "D282",
    what: "the `×` fold's new arm returns `opponentBenchCount`, so the READER (not the evaluator) is what mislabels the seat. Distinct from the two evaluator rows above: this one leaves `BUILT.attack` at 1129 because the sentence still RESOLVES, which is exactly the shape a census-only guard cannot see",
    file: "packages/engine/src/effects.ts",
    find: "    if (per >= 1) return { per, count: { kind: \"yourBenchCount\" } };\n  }\n  // D193 — the opponent's attached Energy, BOTH ZONES on this fold.",
    replace: "    if (per >= 1) return { per, count: { kind: \"opponentBenchCount\" } };\n  }\n  // D193 — the opponent's attached Energy, BOTH ZONES on this fold.",
    expectKilledBy: ["packages/engine/src/benchBodySelfScaling.test.ts"],
  },
  {
    id: "D282-additive-arm-goes-missing",
    decision: "D282",
    what: "the ADDITIVE arm of `yourBenchCount` is dropped, so the three un-gated \"20 more\" printings fall back to the loud path. ⚠️ THE POINT OF THIS ROW IS THE SECOND KILLER: D274's live corpus sweep sees the reader narrow and `BUILT.attack` falls 1129 → 1126, which is the guard that exists precisely so a reader edit cannot pass unmeasured",
    file: "packages/engine/src/effects.ts",
    find: "  const yourBench = YOUR_BENCH_SCALE.exec(effect);",
    replace: "  const yourBench = null as RegExpExecArray | null;",
    expectKilledBy: [
      "packages/engine/src/benchBodySelfScaling.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  // ── D283 — the TURN-SCOPED IMPOSED HAND-PLAY LOCK. Every row below is a way of
  // barring the WRONG thing, the WRONG seat, the WRONG turn or the wrong NUMBER
  // of turns — the four axes a single "locked" boolean could not have told apart.
  {
    id: "D283-bar-lands-on-the-attacker",
    decision: "D283",
    what: "🛑 THE SEAT SWAP: `preventHandPlay` stamps its OWN controller instead of the opponent, so the card bars the player who used it. ⚠️ EVERY SYMMETRIC ASSERTION STAYS GREEN — the stamp is written, the event fires, the key is present, and only a board that asks WHICH seat is barred can see it",
    file: "packages/engine/src/interpreter.ts",
    find: "  const seat = otherSeat(ctx.seat);\n  events.push({ type: \"HAND_PLAY_BLOCKED\", seat, bars });",
    replace: "  const seat = ctx.seat;\n  events.push({ type: \"HAND_PLAY_BLOCKED\", seat, bars });",
    expectKilledBy: ["packages/engine/src/screamTail.test.ts"],
  },
  {
    id: "D283-bar-is-one-round-wide",
    decision: "D283",
    what: "the stamp becomes `state.turn + 2` — `attackLockedTurn`'s SELF-ARM number, which is the right answer for a sentence saying \"your next turn\" and the wrong one for every printing of this sentence, all of which say \"their\". The bar then misses the turn it is printed for and lands a round later, so the barred seat plays freely and an INNOCENT turn is barred instead",
    file: "packages/engine/src/interpreter.ts",
    find: "      [seat]: { ...state.handPlayLockedTurn[seat], [bars]: state.turn + 1 },",
    replace: "      [seat]: { ...state.handPlayLockedTurn[seat], [bars]: state.turn + 2 },",
    expectKilledBy: ["packages/engine/src/screamTail.test.ts"],
  },
  {
    id: "D283-bar-never-expires",
    decision: "D283",
    what: "🛑 THE TOO-STRICT BUILD, WHICH IS THE HARDER DIRECTION TO SEE (D279): `handPlayBarred` compares `>=` instead of `===`, so the bar is live for the rest of the game. Every \"the bar bites\" assertion in the suite passes; only §2's AFTER edge and §3's restored-permission board go red",
    file: "packages/engine/src/types.ts",
    find: "  return state.handPlayLockedTurn[seat][key] === state.turn;",
    replace: "  return (state.handPlayLockedTurn[seat][key] ?? Number.POSITIVE_INFINITY) <= state.turn;",
    expectKilledBy: ["packages/engine/src/screamTail.test.ts"],
  },
  {
    id: "D283-bar-ignores-the-class",
    decision: "D283",
    what: "🛑 THE COLLAPSE TO A SINGLE FLAG: `handPlayBarred` answers TRUE when EITHER class is stamped, which is exactly the build a one-boolean field would have produced. Budew then bars Supporters it never mentions and Scream Tail bars Items — invisible to any suite that drives one class per board, which is why §3 asserts the untouched class in the same breath as the barred one",
    file: "packages/engine/src/types.ts",
    find: "  return state.handPlayLockedTurn[seat][key] === state.turn;",
    replace: "  return Object.values(state.handPlayLockedTurn[seat]).some((t) => t === state.turn);",
    expectKilledBy: ["packages/engine/src/screamTail.test.ts"],
  },
  {
    id: "D283-wire-mirror-forgets-the-bar",
    decision: "D283",
    what: "🛑 D223's FINDING RE-INSTALLED, QUIET SIDE UP: the ENGINE honours the bar and the online mirror does not, so a barred row stays lit and can only ever be clicked and refused. The engine suite is fully green — only the mirror's own biconditional (§4, read off `redactGame` and checked against `applyAction`) can see it",
    file: "packages/engine/src/redact.ts",
    find: "      noTarget ||\n      barred ||",
    replace: "      noTarget ||",
    expectKilledBy: ["packages/engine/src/screamTail.test.ts"],
  },
  {
    id: "D283-anchor-swallows-the-cost",
    decision: "D283",
    what: "the COMPOUND anchor is dropped, so Galvantula ex's \"Discard all Energy from this Pokémon. \" + the lock falls through to the loud path and its three printings stop resolving. ⚠️ THE POINT OF THIS ROW IS THE SECOND KILLER: D274's live corpus sweep sees the reader narrow and `BUILT.attack` falls 1137 → 1134, which is the guard that exists precisely so a reader edit cannot pass unmeasured",
    file: "packages/engine/src/effects.ts",
    find: "  match = SELF_DISCARD_ALL_THEN_HAND_LOCK.exec(effect);",
    replace: "  match = null;",
    expectKilledBy: [
      "packages/engine/src/screamTail.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D283-class-capture-collapses",
    decision: "D283",
    what: "`handPlayClassOf` always answers \"Supporter\", so the six ITEM printings install a Supporter bar off an Item sentence. The op fires, the event fires, the stamp is written and `BUILT.attack` does not move — the census is structurally blind to a reader that resolves the RIGHT sentence to the WRONG value, which is D282's own lesson about what a guard can see",
    file: "packages/engine/src/effects.ts",
    find: "  return word === \"Supporter\" ? \"Supporter\" : \"Item\";",
    replace: "  return word === \"Supporter\" ? \"Supporter\" : \"Supporter\";",
    expectKilledBy: ["packages/engine/src/screamTail.test.ts"],
  },
  // ── D284 — the CONTINUOUS SEAT-WIDE BAR ON THE PLAY. The axes here are not
  // D283's: there is no turn arithmetic to get wrong at all. What CAN go wrong is
  // WHOSE Active is read, WHICH classes the list is believed to name, WHICH of
  // the two SOURCES the widened funnel still consults, whether the FOURTH read
  // site exists, and — the one that would have cost a version bump — whether the
  // widened class union leaked into the PERSISTED record.
  {
    id: "D284-bar-reads-its-own-active",
    decision: "D284",
    what: "🛑 THE PERSPECTIVE FLIP INVERTED: the scan reads the ASKING seat's Active instead of the opponent's, so \"your opponent can't play\" becomes \"you can't play\" and the card locks its own controller's hand. ⚠️ EVERY BOARD WITH THE BODY ON ONE SIDE STILL PRODUCES A REFUSAL — only a board that asks WHICH seat is barred can see it, which is why §5 drives both seats under both first-player assignments",
    file: "packages/engine/src/continuous.ts",
    // ⚠️ RE-ANCHORED AT D285 ON THE FUNCTION'S SIGNATURE, NOT ON THE LINE. D285's
    // `pokemonPlayBarredByOpponentActive` opens with the SAME `otherSeat` read one
    // surface over, so the bare line stopped being unique the moment the second
    // reader landed and `precheck` reported it as 2×. A signature is a structural
    // boundary the sibling cannot collide with — D279's "prefer a boundary the
    // edit moves over a line the edit replaces", applied to a DUPLICATE rather
    // than to a drift.
    find: "  klass: HandPlayClass,\n): boolean {\n  const barrier = state.players[otherSeat(seat)].active;",
    replace: "  klass: HandPlayClass,\n): boolean {\n  const barrier = state.players[seat].active;",
    expectKilledBy: ["packages/engine/src/activeHandLock.test.ts"],
  },
  {
    id: "D284-class-list-ignored",
    decision: "D284",
    what: "the printed CLASS LIST is dropped and any body carrying the field bars EVERY class — the collapse an `?: true` flag would have shipped by construction. Tyranitar then bars Supporters and Tools its sentence never names, and Jellicent bars Supporters. Invisible to any suite that only ever plays the class the card DOES bar, which is why §2 asserts the untouched class in the same breath as the barred one",
    file: "packages/engine/src/continuous.ts",
    find: "  if (classes === undefined || !classes.includes(klass)) return false;",
    replace: "  if (classes === undefined) return false;",
    expectKilledBy: ["packages/engine/src/activeHandLock.test.ts"],
  },
  {
    id: "D284-tool-site-asks-the-wrong-class",
    decision: "D284",
    what: "🛑 THE FOURTH READ SITE ASKS FOR \"Supporter\", so `attachTool` consults the funnel and always hears \"no\". Jellicent ex's printed sentence is then honoured at exactly HALF — its Items refused and its Tools landing — and the site LOOKS wired: the import is used, the gate is present, and every Item assertion in the file stays green",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (handPlayBarred(state, action.seat, \"Tool\", card)) {",
    replace: "  if (handPlayBarred(state, action.seat, \"Supporter\", card)) {",
    expectKilledBy: ["packages/engine/src/activeHandLock.test.ts"],
  },
  {
    id: "D284-bar-survives-klefki",
    decision: "D284",
    what: "the §9 conjunct is dropped, so a SILENCED Ability keeps barring. `disabledAbilityUids` is still called and the line still reads as a §9 check — it just always answers TRUE on a real board, which is the shape a §9 gate degrades into rather than the shape it disappears in",
    file: "packages/engine/src/continuous.ts",
    find: "  const sourceUid = topUid(barrier);\n  return sourceUid === undefined || !disabledAbilityUids(state).has(sourceUid); // \u00a79\n}\n\n/** Is this card an ACE SPEC? (D291)",
    replace: "  const sourceUid = topUid(barrier);\n  return sourceUid !== undefined || !disabledAbilityUids(state).has(sourceUid); // \u00a79\n}\n\n/** Is this card an ACE SPEC? (D291)",
    expectKilledBy: ["packages/engine/src/activeHandLock.test.ts"],
  },
  {
    id: "D284-funnel-forgets-the-stamp",
    decision: "D284",
    what: "🛑 THE WIDENING DONE WRONG IN THE DIRECTION A REPLACEMENT TAKES: the widened reader keeps only the NEW source and silently drops D283's stamp, so every attack-borne bar in the catalog stops working. ⚠️ THE POINT OF THIS ROW IS THAT THE KILLER IS A SUITE THIS SLICE DID NOT WRITE — a funnel that two decisions share is only safe if BOTH decisions' suites run over it",
    file: "packages/engine/src/continuous.ts",
    find: "    stampedBarFor(state, seat, klass) ||\n    handPlayBarredByOpponentActive(state, seat, klass) ||",
    replace: "    handPlayBarredByOpponentActive(state, seat, klass) ||",
    expectKilledBy: [
      "packages/engine/src/screamTail.test.ts",
      "packages/engine/src/activeHandLock.test.ts",
    ],
  },
  {
    id: "D284-funnel-forgets-the-passive",
    decision: "D284",
    what: "the same widening done wrong in the OTHER direction — the reader is moved and re-exported but never actually gains its second disjunct. ⚠️ THE FILE DIFF STILL LOOKS COMPLETE: the scan exists, is documented, is covered by its own unit reads, and is called by nothing",
    file: "packages/engine/src/continuous.ts",
    find: "    stampedBarFor(state, seat, klass) ||\n    handPlayBarredByOpponentActive(state, seat, klass) ||",
    replace: "    stampedBarFor(state, seat, klass) ||",
    expectKilledBy: ["packages/engine/src/activeHandLock.test.ts"],
  },
  {
    id: "D284-tool-key-leaks-into-the-record",
    decision: "D284",
    what: "🛑 THE VERSION BUMP THIS SLICE DID NOT HAVE TO TAKE, INSTALLED BY ACCIDENT: `freshHandPlayLocks` grows a `Tool` key, so every persisted board carries a third class key NO WRITER CAN EVER SET and every v15 record is missing it. ⚠️ NO BEHAVIOUR CHANGES AT ALL — the bar still bites, the mirrors still grey, the reader still answers — and the ONLY thing that can see it is a literal key-list anchor, which is exactly the guard D280-D282 installed and D283 watched all three of theirs fire",
    file: "packages/engine/src/types.ts",
    find: "    p1: { Item: null, Supporter: null, evolve: null },",
    replace: "    p1: { Item: null, Supporter: null, evolve: null, Tool: null },",
    expectKilledBy: [
      "packages/engine/src/activeHandLock.test.ts",
      "packages/engine/src/screamTail.test.ts",
    ],
  },
  {
    id: "D284-oceanic-curse-loses-its-tool",
    decision: "D284",
    what: "Jellicent ex's class list becomes Tyranitar's, so the three printings that made `HandPlayClass` wider than `StampedHandPlayClass` stop reaching the Tool surface. The registry row still exists, the census still counts four printings and `BUILT.ability` does not move — the DATA is wrong rather than the code, which no reader-shaped guard can see",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { preventOpponentHandPlay: [\"Item\", \"Tool\"] },",
    replace: "  passive: { preventOpponentHandPlay: [\"Item\"] },",
    expectKilledBy: [
      "packages/engine/src/activeHandLock.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  // ── D285 — the POKÉMON-SURFACE PLAY-FROM-HAND GATE. Every row below is a way of
  // being wrong that leaves the OBVIOUS board green: the two acts collapsed into
  // one, the printed narrowing dropped, the printed exception dropped, the wrong
  // card filtered, the wrong seat barred, and the funnel losing one of its two
  // sources.
  {
    id: "D285-evolve-bar-reaches-the-bench",
    decision: "D285",
    what: "🛑 THE ACT SPLIT COLLAPSED: the STAMPED reader stops turning `\"bench\"` away, so Bronzong's *\"to evolve their Pokémon\"* bars a Basic placement its sentence never mentions. ⚠️ EVERY EVOLVE ASSERTION IN THE SUITE STAYS GREEN — the bar still bites where it is supposed to, and only a board that plays a Basic on a stamped turn can see it, which is why §4 requires the bench drop to LAND",
    file: "packages/engine/src/types.ts",
    find: "  return act === \"bench\" ? false : stampedPlayLockBarred(state, seat, act);",
    replace: "  return stampedPlayLockBarred(state, seat, act === \"bench\" ? \"evolve\" : act);",
    expectKilledBy: ["packages/engine/src/pokemonPlayLock.test.ts"],
  },
  {
    id: "D285-noun-narrowing-dropped",
    decision: "D285",
    what: "🛑 THE PRINTED NARROWING IGNORED: Arbok's `only` filter is skipped, so *\"any Pokémon that has an Ability\"* becomes *\"any Pokémon\"* and every Pokémon in the barred hand is refused. ⚠️ THE FAILURE IS TOO STRICT (D279's harder direction) AND EVERY NATURAL ASSERTION PASSES — the fixture a suite reaches for HAS an Ability, so only a board that plays an Ability-LESS Pokémon and requires it to land can see it",
    file: "packages/engine/src/continuous.ts",
    find: "  if (bar.only !== undefined && !matchesFilter(card, bar.only)) return false;",
    replace: "  void bar.only;",
    expectKilledBy: ["packages/engine/src/pokemonPlayLock.test.ts"],
  },
  {
    id: "D285-printed-exception-dropped",
    decision: "D285",
    what: "the *\"except for Team Rocket's Pokémon\"* clause is dropped, so the one body the sentence exempts is barred with everything else. ⚠️ THIS IS WHAT AN `&&` OF THE TWO CLAUSES SHIPS BY CONSTRUCTION — a Team Rocket's Pokémon with an Ability satisfies both, so a build that CONJOINED them instead of SUBTRACTING is byte-identical in behaviour to this mutant",
    file: "packages/engine/src/continuous.ts",
    find: "  if (bar.except !== undefined && matchesFilter(card, bar.except)) return false;",
    replace: "  void bar.except;",
    expectKilledBy: ["packages/engine/src/pokemonPlayLock.test.ts"],
  },
  {
    id: "D285-pokemon-funnel-forgets-the-stamp",
    decision: "D285",
    what: "the Pokémon-surface funnel keeps only the CONTINUOUS source and silently drops the stamp, so Bronzong's whole printing stops working while Arbok's keeps working. ⚠️ D284's `funnel-forgets-*` PAIR ONE SURFACE OVER, and the point is the same: a funnel two decisions share is only safe if BOTH decisions' boards run over it",
    file: "packages/engine/src/continuous.ts",
    find: "    stampedActBarFor(state, seat, act) ||",
    replace: "    false ||",
    expectKilledBy: ["packages/engine/src/pokemonPlayLock.test.ts"],
  },
  {
    id: "D285-pokemon-bar-reads-its-own-active",
    decision: "D285",
    what: "🛑 THE PERSPECTIVE FLIP INVERTED on the new surface: the scan reads the ASKING seat's Active, so *\"your opponent can't play\"* becomes *\"you can't play\"* and Arbok locks its own controller's hand. ⚠️ EVERY ONE-SEAT BOARD STILL PRODUCES A REFUSAL — only a suite that asks WHICH seat is barred can see it, which is why §5 drives both seats under both first-player assignments",
    file: "packages/engine/src/continuous.ts",
    find: "  act: PokemonPlayAct,\n  card: Card | undefined,\n): boolean {\n  const barrier = state.players[otherSeat(seat)].active;",
    replace: "  act: PokemonPlayAct,\n  card: Card | undefined,\n): boolean {\n  const barrier = state.players[seat].active;",
    expectKilledBy: ["packages/engine/src/pokemonPlayLock.test.ts"],
  },
  {
    id: "D285-evolve-gate-filters-the-target",
    decision: "D285",
    what: "🛑 THE WRONG CARD FILTERED: turn.ts's evolve gate asks about the BODY BEING EVOLVED instead of the EVOLUTION CARD LEAVING HAND. ⚠️ INVISIBLE ON EVERY BOARD WHERE BOTH CARRY AN ABILITY OR NEITHER DOES, which is most of them — the fixtures evolve a plain `fix-basic-1`, so under this mutant Arbok's bar refuses NOTHING at all and only §5's crossed board can see it",
    file: "packages/engine/src/turn.ts",
    find: "  if (pokemonPlayBarred(state, action.seat, \"evolve\", card)) {",
    replace: "  if (pokemonPlayBarred(state, action.seat, \"evolve\", targetTopCard)) {",
    expectKilledBy: ["packages/engine/src/pokemonPlayLock.test.ts"],
  },
  {
    id: "D285-jammer-stamps-a-class",
    decision: "D285",
    what: "the deriver reads Bronzong's sentence as an ITEM bar — the arm a `(Item|Supporter)` alternation widened with a wildcard would have produced. ⚠️ THE ATTACK STILL RESOLVES, THE EVENT STILL FIRES AND THE RECORD STILL GROWS A STAMP: only a board that asks which KEY was written, or that tries the evolve the sentence actually names, can see it",
    file: "packages/engine/src/effects.ts",
    find: "    return [{ op: \"preventHandPlay\", bars: \"evolve\" }];",
    replace: "    return [{ op: \"preventHandPlay\", bars: \"Item\" }];",
    expectKilledBy: ["packages/engine/src/pokemonPlayLock.test.ts"],
  },
  {
    id: "D285-potent-glare-loses-an-act",
    decision: "D285",
    what: "Arbok's `acts` list becomes Bronzong's, so the printing that bars the PLAY stops reaching §7.5 bench placement and honours its sentence at exactly half. ⚠️ THE DATA IS WRONG RATHER THAN THE CODE — the registry row still exists, the census still counts one printing and `BUILT.ability` does not move, which no reader-shaped guard can see (D284's `oceanic-curse-loses-its-tool` one surface over)",
    file: "packages/engine/src/registry.ts",
    find: "      acts: [\"evolve\", \"bench\"],",
    replace: "      acts: [\"evolve\"],",
    expectKilledBy: ["packages/engine/src/pokemonPlayLock.test.ts"],
  },

  // ── D286 — RARE CANDY IS AN ITEM PLAYED FROM HAND. Every row below is a way of
  // being wrong that leaves D283/D284/D285's boards green, because none of those
  // suites ever put a Rare Candy in a barred hand. ⚠️ THE FIRST ROW IS THE BUG
  // ITSELF, MADE RE-RUNNABLE: it is what HEAD did for three slices, and what no
  // assertion in a 5,844-test suite could see.
  {
    id: "D286-rare-candy-escapes-the-item-bar",
    decision: "D286",
    what: "🛑 THE ORIGINAL DEFECT, TRANSCRIBED: `rareCandy`'s gate asks about `\"Tool\"` instead of the card's own class, so no Item bar reaches the action and Rare Candy walks through Galvantula ex, Budew, Tyranitar and Jellicent ex alike. ⚠️ THIS IS EXACTLY WHAT SHIPPED FROM D283 TO D285 AND THE WHOLE SUITE WAS GREEN — the class list, the funnel, both mirrors and every Trainer board are untouched; only a board that plays a RARE CANDY into a barred hand can see it",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (handPlayBarred(state, action.seat, \"Item\", card)) {\n    return err(\n      \"HAND_PLAY_BLOCKED\",\n      \"your opponent prevents you from playing Item cards from your hand\",\n    );\n  }",
    replace: "  if (handPlayBarred(state, action.seat, \"Tool\", card)) {\n    return err(\n      \"HAND_PLAY_BLOCKED\",\n      \"your opponent prevents you from playing Item cards from your hand\",\n    );\n  }",
    expectKilledBy: ["packages/engine/src/rareCandyBar.test.ts"],
  },
  {
    id: "D286-rare-candy-gate-bars-the-barring-seat",
    decision: "D286",
    what: "🛑 THE PERSPECTIVE FLIP, at the ONE site D283/D284's suites cannot reach: the gate asks whether the OPPONENT is barred, so the seat that PRINTED the bar loses its own Rare Candy and the barred seat keeps it. ⚠️ EVERY ONE-SEAT BOARD STILL PRODUCES A REFUSAL SOMEWHERE — only a suite that asks WHICH seat is refused can see it, which is why §2 drives both seats under both first-player assignments and requires the barring seat's own candy to LAND",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (handPlayBarred(state, action.seat, \"Item\", card)) {\n    return err(",
    replace: "  if (handPlayBarred(state, otherSeat(action.seat), \"Item\", card)) {\n    return err(",
    expectKilledBy: ["packages/engine/src/rareCandyBar.test.ts"],
  },
  {
    id: "D286-candy-options-keep-offering",
    decision: "D286",
    what: "🛑 THE MIRROR HALF DROPPED: `rareCandyOptions` stops folding the bar, so the ENGINE still refuses the action while the WIRE still offers the targets — afford-then-reject, and worse than a lit row because the dialog opens. ⚠️ EVERY ENGINE ASSERTION IN §2–§4 STAYS GREEN (the handler's own gate is untouched) and so does every ROW-greying assertion, because `redactedTrainersOf` has no term of its own for this card — only §5, which compares the option list and the wire dialog against `applyAction`'s own answer, can see it",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (handPlayBarred(state, seat, \"Item\", undefined)) return [];",
    replace: "  void handPlayBarred(state, seat, \"Item\", undefined);",
    expectKilledBy: ["packages/engine/src/rareCandyBar.test.ts"],
  },
  {
    id: "D286-candy-options-bar-every-class",
    decision: "D286",
    what: "the options fold asks `\"Supporter\"` instead of `\"Item\"`, so a Scream Tail ex board silently empties the Rare Candy dialog while an Item bar leaves it full — the CLASS COLLAPSE, on the projection rather than the handler. ⚠️ THE HANDLER STILL ANSWERS CORRECTLY IN BOTH DIRECTIONS, so every `applyAction` assertion is green and the divergence is visible ONLY where §5 compares the two",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (handPlayBarred(state, seat, \"Item\", undefined)) return [];",
    replace: "  if (handPlayBarred(state, seat, \"Supporter\", undefined)) return [];",
    expectKilledBy: ["packages/engine/src/rareCandyBar.test.ts"],
  },

  // ── D287 — THE STADIUM HALF OF THE IMPOSED HAND-PLAY LOCK. Every row below is a
  // way of being wrong that leaves D283/D284/D285/D286's boards green, because no
  // suite before this one ever put a STADIUM in a barred hand. ⚠️ THE FIRST ROW IS
  // THE ABSENCE ITSELF, MADE RE-RUNNABLE: it is what HEAD did from D284 to D286,
  // and it is what D284's refusal note named by line.
  // 🛑 **ONE ROW IS DELIBERATELY NOT HERE.** `stampedBarFor`'s `|| klass ===
  // "Stadium"` looks like the obvious fifth mutant and it is UNKILLABLE at
  // RUNTIME: drop the disjunct and `stampedPlayLockBarred` reads
  // `handPlayLockedTurn[seat]["Stadium"]`, which is `undefined`, which is never
  // `state.turn` — so the behaviour is byte-identical and the mutant would die of
  // a TYPE error rather than of the behaviour it names (D278's false-kill defect).
  // **THAT SEAM IS ENFORCED BY THE COMPILER, NOT BY THE SUITE**, and a `survives`
  // row claiming otherwise would be a lie about which guard is holding it up.
  {
    id: "D287-stadium-play-escapes-the-bar",
    decision: "D287",
    what: "🛑 THE ORIGINAL ABSENCE, TRANSCRIBED: `playStadium` stops asking `handPlayBarred`, so Copperajah's printed sentence stops working entirely and a barred seat plays Stadiums freely. ⚠️ THIS IS EXACTLY WHAT SHIPPED FROM D284 TO D286 AND THE WHOLE 5,858-TEST SUITE WAS GREEN — the class list, the funnel, the registry row and every Item/Supporter/Tool board are untouched; only a board that plays a STADIUM into a barred hand can see it",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (handPlayBarred(state, action.seat, \"Stadium\", card)) {\n    return err(\n      \"HAND_PLAY_BLOCKED\",\n      \"your opponent prevents you from playing Stadium cards from your hand\",\n    );\n  }",
    replace: "  void handPlayBarred(state, action.seat, \"Stadium\", card);",
    expectKilledBy: ["packages/engine/src/stadiumBar.test.ts"],
  },
  {
    id: "D287-stadium-gate-bars-the-barring-seat",
    decision: "D287",
    what: "🛑 THE PERSPECTIVE FLIP at the FIFTH read site: the gate asks whether the OPPONENT is barred, so the seat whose Copperajah PRINTED the sentence loses its own Stadium play and the barred seat keeps it. ⚠️ EVERY ONE-SEAT BOARD STILL PRODUCES A REFUSAL SOMEWHERE — only a suite that asks WHICH seat is refused can see it, which is why §2 drives both seats under both first-player assignments and requires the barring seat's own Stadium to LAND",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (handPlayBarred(state, action.seat, \"Stadium\", card)) {",
    replace: "  if (handPlayBarred(state, otherSeat(action.seat), \"Stadium\", card)) {",
    expectKilledBy: ["packages/engine/src/stadiumBar.test.ts"],
  },
  {
    id: "D287-stadium-gate-asks-the-wrong-class",
    decision: "D287",
    what: "the new gate asks `\"Item\"` instead of `\"Stadium\"` — the CLASS COLLAPSE, at the one site where the two sentences swap places: Tyranitar (an ITEM bar) starts refusing Stadiums and Copperajah stops. ⚠️ A SUITE THAT ONLY EVER PUTS ONE BARRIER ON THE BOARD CANNOT SEE THIS, because on a Copperajah board every class answers the same way once the list is ignored — §3 needs the INVERTED board to catch it",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (handPlayBarred(state, action.seat, \"Stadium\", card)) {\n    return err(",
    replace: "  if (handPlayBarred(state, action.seat, \"Item\", card)) {\n    return err(",
    expectKilledBy: ["packages/engine/src/stadiumBar.test.ts"],
  },
  {
    id: "D287-stadium-bar-ordered-below-the-coverage-gate",
    decision: "D287",
    what: "🛑 THE GATE'S PLACEMENT UNDONE: the bar is made conditional on the Stadium being AUTHORED, which is the same observable as writing it one line lower — a barred seat holding an unsimulated Stadium is told `TRAINER_NOT_SIMULATED`, a fact about this simulator's coverage, instead of the rule it is actually under. ⚠️ EVERY ASSERTION IN §2, §3, §5, §6 AND §7 STAYS GREEN, because the two orderings agree on every AUTHORED card — only §4's unbuilt-Stadium board can see it. **MEASURED: moving the real gate below §7.3's same-name rule reddens exactly the three §4 tests and nothing else**",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (handPlayBarred(state, action.seat, \"Stadium\", card)) {\n    return err(\n      \"HAND_PLAY_BLOCKED\",",
    replace: "  if (programFor(card.id)?.stadium !== undefined && handPlayBarred(state, action.seat, \"Stadium\", card)) {\n    return err(\n      \"HAND_PLAY_BLOCKED\",",
    expectKilledBy: ["packages/engine/src/stadiumBar.test.ts"],
  },
  {
    id: "D287-massive-body-bars-items-instead",
    decision: "D287",
    what: "Copperajah's class list becomes Tyranitar's, so the printing that made `HandPlayClass` exactly `Card.trainerType` bars the wrong class. ⚠️ THE DATA IS WRONG RATHER THAN THE CODE — the registry row still exists, the census still counts one printing and `BUILT.ability` does not move, which no reader-shaped guard can see (D284's `oceanic-curse-loses-its-tool` and D285's `potent-glare-loses-an-act`, a third time). ⚠️ AND IT IS *NOT* THE SAME MUTANT AS `stadium-gate-asks-the-wrong-class`: that one breaks the READER for every printing, this one breaks ONE ROW and leaves Tyranitar and Jellicent ex correct",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { preventOpponentHandPlay: [\"Stadium\"] },",
    replace: "  passive: { preventOpponentHandPlay: [\"Item\"] },",
    expectKilledBy: [
      "packages/engine/src/stadiumBar.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  // ── D288 — THE STADIUM PAYABILITY MIRROR ON THE WIRE ──────────────────────
  //
  // 🛑 **THREE ROWS THAT WERE CONSIDERED AND DELIBERATELY NOT WRITTEN, BECAUSE
  // THEY ARE UNKILLABLE AT RUNTIME AND MEASURED TO BE.** `redactedTrainersOf`
  // scopes its three Item/Supporter gates OFF Stadiums (`gated`, `costUnmet`,
  // `noTarget`). Dropping the `isStadium` conjunct from ANY of the three — or
  // from all three at once — leaves the whole suite GREEN at 5,889: a Stadium's
  // `program.trainer` is `undefined`, so `handCostUnmet`/`programPlayable` run
  // over `[]` and answer vacuously (`programPlayable` returns true on an empty
  // op list), and `trainerPlayableIf` is absent from every `{stadium: …}`
  // program. **THE SCOPING IS A DECISION, NOT A BEHAVIOUR** — it is written so a
  // future Stadium program carrying either key cannot silently acquire an
  // Item-path gate, and a `survives` row would have reported "the suite misses
  // this" about a line the suite CANNOT miss. D287 declined exactly one such row
  // on `stampedBarFor`; this is the same call, measured rather than argued.
  {
    id: "D288-wire-emits-no-stadium-row",
    decision: "D288",
    what: "🛑 THE WHOLE SLICE UNDONE, AND BY THE ROUTE D287 THOUGHT WOULD DO IT: the play-path discriminant loses its Stadium arm, so every Stadium falls back to `program.trainer === undefined` and the projection emits no Stadium row at all — the pre-D288 wire exactly. ⚠️ THIS IS THE ROW THAT PROVES THE DELETED `if (card.trainerType === \"Stadium\") continue;` WAS NEVER THE GUARD: restoring that line is a NO-OP (measured — the suite stays green), and THIS is the line that actually held the absence. A census cannot see it (no printing stops resolving, `BUILT.ability` does not move); only the wire assertions can",
    file: "packages/engine/src/redact.ts",
    find:
      "    if (!isRareCandy && (isStadium ? program.stadium === undefined : program.trainer === undefined)) {",
    replace: "    if (!isRareCandy && program.trainer === undefined) {",
    expectKilledBy: [
      "packages/engine/src/stadiumWireMirror.test.ts",
      "packages/engine/src/stadiumBar.test.ts",
    ],
  },
  {
    id: "D288-wire-stadium-row-lit-under-the-bar",
    decision: "D288",
    what: "🛑 THE AFFORD-THEN-REJECT DEFECT ITSELF, AND THE REASON THE ROW AND ITS BAR HAD TO SHIP ON ONE EDIT: the `barred` term loses its `\"Stadium\"` arm, so the projection emits a Stadium row and leaves it LIT for a seat Copperajah has barred. The player clicks a button the engine refuses — strictly WORSE than the gap D288 closed, because before it there was no row to click. ⚠️ IT IS KILLABLE AT RUNTIME AND NOT ONLY BY `tsc`: `klass` narrows to `\"Item\" | \"Supporter\"`, which `handPlayBarred` still accepts, so the mutant COMPILES and dies of the behaviour it names rather than of a type error (D287's `stampedBarFor` row failed exactly that test and was not written)",
    file: "packages/engine/src/redact.ts",
    find: "      (klass === \"Item\" || klass === \"Supporter\" || klass === \"Stadium\") &&\n      // ⚠️ **THE CARD IS PASSED AND THE ACE SPEC ARM ARRIVES FREE ON THE WIRE**",
    replace: "      (klass === \"Item\" || klass === \"Supporter\") &&\n      // ⚠️ **THE CARD IS PASSED AND THE ACE SPEC ARM ARRIVES FREE ON THE WIRE**",
    expectKilledBy: [
      "packages/engine/src/stadiumWireMirror.test.ts",
      "packages/engine/src/stadiumBar.test.ts",
    ],
  },
  {
    id: "D288-wire-stadium-asks-the-pre-d288-ternary",
    decision: "D288",
    what: "the `barred` term keeps the LOOKUP D288 retired — `klass === \"Item\" ? \"Item\" : \"Supporter\"`, the literal line this file carried before the Stadium row existed — so a Stadium row asks the SUPPORTER bar. ⚠️ NEIGHBOUR-PLAUSIBLE RATHER THAN STRAW: it is the shipped predecessor of this line, and it is exactly what a widening that forgot to retire its translation table would leave behind. A barred Stadium row comes back LIT (the Supporter bar is not set) while a Scream Tail board would darken it for the wrong reason — which is why the class controls in §3 are two-sided",
    file: "packages/engine/src/redact.ts",
    find: "      handPlayBarred(state, viewerSeat, klass, card);",
    replace: "      handPlayBarred(state, viewerSeat, klass === \"Item\" ? \"Item\" : \"Supporter\", card);",
    expectKilledBy: ["packages/engine/src/stadiumWireMirror.test.ts"],
  },
  {
    id: "D288-wire-stadium-ignores-the-same-name-rule",
    decision: "D288",
    what: "§7.3's same-name rule is dropped from the Stadium row's `disabled`, keeping only the once-per-turn allowance — so on the turn AFTER an opponent puts Beach Court in the shared zone, the wire lights a Beach Court row the engine refuses with `STADIUM_SAME_NAME`. ⚠️ THE TERM THIS BREAKS IS THE ONE THAT DECIDED THE SLICE'S PRICE: it needs the shared zone's occupant NAME, and the fact that the projection already had it is why D288 cost no new `RedactedTrainer` field and no `packages/schema` type change. ⚠️ ANCHORED ON THE ARM'S CLOSING PARENTHESES rather than on a growing comment block above it",
    file: "packages/engine/src/redact.ts",
    find: "            isStadium && (state.allowances.stadiumPlayed || card.name === inPlayStadium));",
    replace: "            isStadium && state.allowances.stadiumPlayed);",
    expectKilledBy: ["packages/engine/src/stadiumWireMirror.test.ts"],
  },
  {
    id: "D288-wire-stadium-ignores-the-turn-allowance",
    decision: "D288",
    what: "the OTHER half of the same arm: §7.3's once-per-turn allowance is dropped and only the same-name rule survives, so after playing Beach Court the wire still lights a DIFFERENT-named Stadium the engine refuses with `STADIUM_ALREADY_PLAYED`. ⚠️ WRITTEN AS ITS OWN ROW BECAUSE THE TWO TERMS AGREE ON MOST BOARDS — with one Stadium in hand each covers for the other, and only §5's two-DIFFERENT-names board can tell them apart, which is why that fixture holds `sv01-167` AND `sv02-175`",
    file: "packages/engine/src/redact.ts",
    find: "            isStadium && (state.allowances.stadiumPlayed || card.name === inPlayStadium));",
    replace: "            isStadium && card.name === inPlayStadium);",
    expectKilledBy: ["packages/engine/src/stadiumWireMirror.test.ts"],
  },
  {
    id: "D289-local-hud-ignores-hand-play-bar",
    decision: "D289",
    what: "🛑 THE WHOLE `barred` TERM LEAVES `playableTrainers`'s `disabled` CHAIN, so the LOCAL HUD lights every Item / Supporter / Stadium row for a seat the engine has barred — the afford-then-reject defect on the surface that could never report it. ⚠️ **THIS IS THE ROW THAT JUSTIFIES D289's WHOLE SLICE, AND THE NUMBER IS MEASURED RATHER THAN ARGUED: with the term deleted, ALL 5,889 PRE-D289 TESTS STAY GREEN.** The term shipped in D283, was measured in D286, widened in D287 and mirrored onto the wire in D288, and through all five slices deleting it reddened NOTHING. It moves 8 of this file's 18 `it`s. ⚠️ ANCHORED ON THE CHAIN'S TWO NEIGHBOURS — `noTarget ||` above and the `(isRareCandy` ternary's OPENING below — a structural boundary a growing chain pushes around, rather than on the comment block above it, which has grown in four consecutive slices",
    file: "src/features/game/GameHud.tsx",
    find: "      noTarget ||\n      barred ||\n      (isRareCandy",
    replace: "      noTarget ||\n      (isRareCandy",
    expectKilledBy: ["src/features/game/GameHud.handPlayBar.dom.test.tsx"],
  },
  {
    id: "D289-local-hud-stadium-row-lit-under-the-bar",
    decision: "D289",
    what: "🆕 THE LOCAL TWIN OF `D288-wire-stadium-row-lit-under-the-bar`, one surface over: the `barred` term loses its `\"Stadium\"` arm — the exclusion D287 REMOVED — so a Copperajah-barred seat's Stadium row stays LIT, is clicked, and `playStadium` refuses it. ⚠️ IT IS KILLABLE AT RUNTIME AND NOT ONLY BY `tsc`: `klass` narrows to `\"Item\" | \"Supporter\"`, which `handPlayBarred` still accepts, so the mutant COMPILES and dies of the behaviour it names. Moves 2 `it`s (§4.1 and §6.1) — the smallest of D289's three rows, and deliberately kept beside the wider one because a lost ARM and a hard-wired CLASS are different defects that a single row would conflate",
    file: "src/features/game/GameHud.tsx",
    find: "      (klass === \"Item\" || klass === \"Supporter\" || klass === \"Stadium\") &&\n      // ⚠️ **THE CARD IS PASSED, AND WITH IT D291",
    replace: "      (klass === \"Item\" || klass === \"Supporter\") &&\n      // ⚠️ **THE CARD IS PASSED, AND WITH IT D291",
    expectKilledBy: ["src/features/game/GameHud.handPlayBar.dom.test.tsx"],
  },
  {
    id: "D289-local-hud-hardwires-the-item-class",
    decision: "D289",
    what: "the card's OWN field stops riding through: `handPlayBarred` is asked about `\"Item\"` whatever the row's class is, which is what a HUD written when Items were the only barred class would look like (D283 shipped exactly one class). ⚠️ **IT IS NOT A SUBSET OF THE ROW ABOVE AND THE MEASUREMENT SAYS SO**: both move 8 `it`s and the two SETS DIFFER — this one takes §4.4 (a Tyranitar board must leave the STADIUM row lit) and leaves §2.2 standing; `D289-local-hud-ignores-hand-play-bar` does the reverse. A single row would have reported one number for two defects. ⚠️ The bar becomes both too STRICT (a Supporter row greys under an Item bar) and too LOOSE (a Stadium row lights under a Stadium bar), which is why §3.3 and §4 are each two-sided",
    file: "src/features/game/GameHud.tsx",
    find: "      handPlayBarred(game, seat, klass, card);",
    replace: "      handPlayBarred(game, seat, \"Item\", card);",
    expectKilledBy: ["src/features/game/GameHud.handPlayBar.dom.test.tsx"],
  },
  {
    id: "D290-registry-folds-the-fourth-rare-candy",
    decision: "D290",
    what: "🛑 THE FOLD D289 SENT THE SLICE TO SHIP, MADE RE-RUNNABLE AS THE THING THAT MUST NOT HAPPEN SILENTLY. `\"sv04.5-089\": RARE_CANDY` joins the map, so the FOURTH Rare Candy printing starts resolving — a correct-looking one-liner whose measured Standard-legal payoff is ZERO (81 of 81 census printings are `legal_standard = 0`, regulation mark G) and which D190's rule refuses: a registry row's price is its LEGAL count, not its catalog count. ⚠️ IT IS A REAL BEHAVIOUR CHANGE, not a decision-only edit — `programFor(\"sv04.5-089\")` goes from `undefined` to the shared `RARE_CANDY` marker and a deck holding that printing starts evolving. MEASURED: it moves **4** `it`s — 2 in `reprintAliasLegal.test.ts` (the 81-id refusal and the Rare Candy relation; the disjointness one stays GREEN, which is right) and 2 in `censusAtHead.test.ts` (`raw.length` 569 and the partition, which names the id). ⚠️ **AND THE TWO SAY DIFFERENT THINGS**: `censusAtHead` reddens on ANY new registry id and is fixed by classifying it, so it makes the fold NOISY; only this file says the fold is REFUSED, and why. ⚠️ ANCHORED ON THE LAST LINE OF THE RARE CANDY FAMILY rather than on the first, so a fifth printing appended above it does not move the anchor",
    file: "packages/engine/src/registry.ts",
    find: "  \"swsh10.5-069\": RARE_CANDY,",
    replace: "  \"swsh10.5-069\": RARE_CANDY,\n  \"sv04.5-089\": RARE_CANDY,",
    expectKilledBy: [
      "packages/engine/src/reprintAliasLegal.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D290-registry-folds-a-printing-D190-never-sampled",
    decision: "D290",
    what: "🛑 THE ROW THAT PROVES THE WIDENING IS NOT REDUNDANT WITH D190. `\"sv04.5-091\": ULTRA_BALL` joins the map — Ultra Ball's Paldean Fates reprint, one of the **65** census printings `SKIPPED_ZERO_LEGAL` never recorded, so BEFORE D290 nothing in the tree would have gone red. It is the same mark-G, zero-legal shape as the Rare Candy row above; kept as its own row because that row is covered by BOTH tables and this one is covered only by the new census, and a single row would have reported one number for two different guarantees. MEASURED: it moves **3** `it`s — 1 in `reprintAliasLegal.test.ts` (the 81-id refusal) and 2 in `censusAtHead.test.ts`. ⚠️ ANCHORED ON THE FULL LINE INCLUDING ITS TRAILING COMMENT, which is what makes the string unique in a map of 569 near-identical entries",
    file: "packages/engine/src/registry.ts",
    find: "  \"sv01-196\": ULTRA_BALL, // Ultra Ball — discard 2 other cards, search a Pokémon → hand",
    replace: "  \"sv01-196\": ULTRA_BALL, // Ultra Ball — discard 2 other cards, search a Pokémon → hand\n  \"sv04.5-091\": ULTRA_BALL,",
    expectKilledBy: [
      "packages/engine/src/reprintAliasLegal.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  // ── D291 — THE ACE SPEC BAR (the RARITY axis of the seat-wide hand-play bar) ──
  //
  // 🛑 **ONE ROW WAS CONSIDERED, MEASURED UNKILLABLE AND DELIBERATELY NOT
  // WRITTEN.** `handPlayBarred` ORs three sources; REORDERING them (the rarity
  // arm hoisted above the two class arms) leaves the whole suite GREEN at 5,937
  // — **0 assertions, 0 files**, measured on the perturbation rather than argued.
  // A disjunction of three total, pure predicates is order-independent by
  // construction, so the row would have reported "the suite misses this" about a
  // line it cannot miss. **THAT IS A DECISION, NOT A BEHAVIOUR** (D288's finding,
  // a fifth time) — and it is worth writing down because the ORDER of those three
  // arms IS load-bearing for cost (the card-keyed arm is the only one that can
  // touch `programFor`), just not for the answer.
  {
    id: "D291-ace-spec-term-dropped",
    decision: "D291",
    what: "🛑 THE CLASSIFIER IS DROPPED FROM THE CONJUNCT, so an armed Genesect bars EVERY card of every class instead of only the ACE SPECs — the LOOSENED reader, and the exact failure the whole slice's design is arranged against. ⚠️ EVERY \"the bar bites\" ASSERTION IN THE SUITE STAYS GREEN; only the class-matched CONTROLS (a plain Potion, a plain Beach Court, a plain Vitality Band, from the same hand on the same board) can see it. **MEASURED: 8 of `aceSpecBar.test.ts`'s 24 `it`s** at D291, and zero elsewhere — which is itself the finding, since no other suite in the repo puts an ACE SPEC on a board. \u26a0\ufe0f **RE-POINTED AT D292 AND THE ROW GOT STRICTLY STRONGER**: the conjunct was EXTRACTED into `aceSpecPlayBarred`, so the anchor moved from the disjunction's third arm to the extracted function's whole `return`. NO SIGNATURE CHANGED and `precheck` still named it \u2014 D278's rule fires on a MOVE, not only on an arity change. **RE-MEASURED AT D292: 11 of 30** (8 \u2192 11 without a line of the reader changing), the three extra all on the ENERGY surface \u2014 the payoff of ONE copy of the term instead of two",
    file: "packages/engine/src/continuous.ts",
    find: "  return isAceSpec(card) && aceSpecPlayBarredByOpponentBody(state, seat);",
    replace: "  return aceSpecPlayBarredByOpponentBody(state, seat);",
    expectKilledBy: ["packages/engine/src/aceSpecBar.test.ts"],
  },
  {
    id: "D291-ace-spec-scan-is-active-only",
    decision: "D291",
    what: "🛑 THE HOLDER LOOP COLLAPSES TO ONE READ — `handPlayBarredByOpponentActive`'s scan copied onto this reader, which is the single most likely way to build this row wrong, because it is what its four sibling printings correctly do. Genesect's printed window is *\"If this Pokémon has a Pokémon Tool attached\"* with NO zone in it, so a BENCHED holder bars; every Active-Spot sibling collapses the loop legitimately. ⚠️ **THE NARROWEST ROW IN THIS SET AND DELIBERATELY SO — 2 `it`s**, both in §3, because every other section of the file puts the barrier in the Active Spot where the two readers agree. A suite that only ever benched nothing would report this build as correct",
    file: "packages/engine/src/continuous.ts",
    find: "  const holders = foes.active === null ? foes.bench : [foes.active, ...foes.bench];\n  const silenced = disabledAbilityUids(state);",
    replace: "  const holders = foes.active === null ? [] : [foes.active];\n  const silenced = disabledAbilityUids(state);",
    expectKilledBy: ["packages/engine/src/aceSpecBar.test.ts"],
  },
  {
    id: "D291-ace-spec-window-ignores-the-tool",
    decision: "D291",
    what: "THE PRINTED WINDOW IS DELETED: the `tools.length` test is made unsatisfiable-in-the-other-direction, so a Genesect with NO Tool bars anyway and the Ability is continuous-unconditional. ⚠️ IT IS THE COMPLEMENT OF THE ROW ABOVE — that one narrows WHERE the holder may stand, this one drops WHAT the holder must be wearing, and a build could get either right while getting the other wrong. **MEASURED: 3 `it`s**. ⚠️ WRITTEN AS `< 0` RATHER THAN AS A DELETED LINE so the mutant is a PREDICATE change the type-checker still accepts, not a syntax edit that could fail for the wrong reason",
    file: "packages/engine/src/continuous.ts",
    find: "    if (holder.tools.length === 0) continue; // the printed window",
    replace: "    if (holder.tools.length < 0) continue; // the printed window",
    expectKilledBy: ["packages/engine/src/aceSpecBar.test.ts"],
  },
  {
    id: "D291-ace-nullifier-becomes-a-class-bar",
    decision: "D291",
    what: "🛑 THE BUILD THIS SLICE REFUSED TO MAKE, MADE RE-RUNNABLE. Genesect's row is re-authored on the CLASS field (`preventOpponentHandPlay: [\"Item\"]`) instead of the rarity one — i.e. ACE SPEC reached by widening `HandPlayClass` rather than by crossing a second predicate with it. THE DATA IS WRONG RATHER THAN THE CODE: the registry row still exists, the census still counts one printing and `BUILT.ability` does not move (D284/D285/D287's shape, a fourth time). **MEASURED: 14 `it`s over FOUR files** — `aceSpecBar.test.ts`, `activeHandLock.test.ts`, `pokemonPlayLock.test.ts` and `censusAtHead.test.ts`'s attribution control — the widest row in this set, and right that it is: this is the only mutant here that a reader-shaped guard alone would miss. ⚠️ **CORPUS HAZARD, RECORDED (D287's, a second time): the `replace` is NOT unique** — `passive: { preventOpponentHandPlay: [\"Item\"] },` is byte-identical to `DAUNTING_GAZE`'s own line. Harmless for the runner, which restores from its saved original, but a naive replace-back orphans the perturbation. The `find` therefore carries the whole THREE-LINE declaration, and the undo was done by inverse substitution against that same anchor. **`precheck` CHECKS THE `find`; NOTHING CHECKS THE `replace`**",
    file: "packages/engine/src/registry.ts",
    find: "const ACE_NULLIFIER: CardProgram = {\n  passive: { preventOpponentAceSpecPlayWhileToolAttached: true },\n};",
    replace: "const ACE_NULLIFIER: CardProgram = {\n  passive: { preventOpponentHandPlay: [\"Item\"] },\n};",
    expectKilledBy: [
      "packages/engine/src/aceSpecBar.test.ts",
      "packages/engine/src/activeHandLock.test.ts",
      "packages/engine/src/pokemonPlayLock.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  // \u2014 \ud83c\udd95 D292 \u2014 the ENERGY surface's gate. TWO rows, and between them they
  // separate the two things that can go wrong with a gate placed inside an
  // existing guard chain: whether it FIRES at all, and WHERE it sits.
  //
  // \ud83d\uded1 **AND ONE CANDIDATE MEASURED UNKILLABLE AND DELIBERATELY NOT WRITTEN \u2014 THE
  // MOST INFORMATIVE MEASUREMENT OF THE SLICE.** Replacing `aceSpecPlayBarred(state,
  // action.seat, card)` with `handPlayBarred(state, action.seat, "Item", card)` \u2014
  // the LIE this slice refused to tell, an Energy given a Trainer class it does not
  // have \u2014 leaves **4,747 of 4,747 engine tests GREEN, 0 assertions moved**,
  // performed and measured rather than argued. Both class-keyed sources answer
  // `false` for an Energy on every board this catalog can build, so **NO TEST CAN
  // TELL THE HONEST READER FROM THE LIE** and a row would have claimed the suite
  // misses a line it cannot miss. **A DECISION, NOT A BEHAVIOUR** (D288's finding,
  // a sixth time; SEVENTH consecutive slice to find one) \u2014 and it is the reason
  // the design argument is written into `attachEnergy`'s doc block rather than into
  // a mutant: the day a stamp or an Active bar names `"Item"` the lie becomes
  // observable, and by then nothing would have recorded that it was a lie.
  {
    id: "D292-energy-gate-never-fires",
    decision: "D292",
    what: "\ud83d\uded1 THE ENERGY SURFACE'S GATE IS DEAD: the played card is replaced by `undefined`, so `isAceSpec` answers `false` for every attach and an ACE SPEC Special Energy lands on a fully armed board \u2014 i.e. the tree exactly as D291 shipped it, made re-runnable. \u26a0\ufe0f WRITTEN AS AN ARGUMENT CHANGE AND NOT AS A DELETED BLOCK so the mutant stays a PREDICATE edit the type-checker accepts, rather than a syntax edit that could die for the wrong reason (D276's rule). **MEASURED: 3 of `aceSpecBar.test.ts`'s 30 `it`s**, and ZERO elsewhere \u2014 the refusal itself, the costs-nothing pin and the window/\u00a79 reach. The two `it`s that read `aceSpecPlayBarred` DIRECTLY stay green, which is the point of driving a gate through the ACTION and not through the reader. \ud83c\udd95 **RE-MEASURED AT D293 AND THE ROW CROSSED A PACKAGE BOUNDARY WITHOUT A LINE OF THE GATE CHANGING: 3 of 30 \u2192 5 of 45**, and TWO of the five kills are now in `src/` (`GameHud.aceSpecBar.dom.test.tsx` \u00a73's end-to-end drag drive and its costs-nothing pin). \u26a0\ufe0f **THAT IS THE FIRST TIME AN ENGINE GATE IN THIS FAMILY HAS BEEN KILLED FROM THE CLIENT**, and it is what makes the \"the engine gate is authoritative on both transports\" clause a measurement rather than an assertion",
    file: "packages/engine/src/turn.ts",
    find: "  if (aceSpecPlayBarred(state, action.seat, card)) {",
    replace: "  if (aceSpecPlayBarred(state, action.seat, undefined)) {",
    expectKilledBy: ["packages/engine/src/aceSpecBar.test.ts"],
  },
  {
    id: "D292-energy-bar-outranks-the-allowance",
    decision: "D292",
    what: "\ud83d\uded1 THE ORDERING IS INVERTED: \u00a76.2's once-per-turn allowance yields to the opponent's bar, so a seat that has ALREADY attached this turn is told `HAND_PLAY_BLOCKED` about its ACE SPEC Energy instead of `ENERGY_ALREADY_ATTACHED`. `playTrainer`'s rule is that the player's OWN limits name themselves first and a barred seat learns the bar only once its own play was otherwise legal \u2014 and ONLY an ERROR CODE can see the difference, because both orders refuse. **MEASURED: 1 of 30**, deliberately, and it is the only assertion in the repo that pins where this gate sits. \u26a0\ufe0f A NON-ACE Energy is unaffected on every board (the added conjunct is `false` for it), so a suite that spent the allowance with the barred card itself would be green here",
    file: "packages/engine/src/turn.ts",
    find: "  if (state.allowances.energyAttached) {\n    return err(\"ENERGY_ALREADY_ATTACHED\", \"only one energy attachment per turn (\u00a76.2)\");\n  }",
    replace: "  if (\n    state.allowances.energyAttached &&\n    !aceSpecPlayBarred(state, action.seat, cardOfUid(state, action.uid))\n  ) {\n    return err(\"ENERGY_ALREADY_ATTACHED\", \"only one energy attachment per turn (\u00a76.2)\");\n  }",
    expectKilledBy: [
      "packages/engine/src/aceSpecBar.test.ts",
      "src/features/game/GameHud.aceSpecBar.dom.test.tsx",
    ],
  },
  // — 🆕 D293 — the CLIENT half of the same bar. TWO rows, and they are the
  // first two mutants in this corpus to be anchored in `src/features/game/` for
  // an ACE SPEC fact at all.
  //
  // 🛑 **THE FIRST ROW IS THE ONE THE WHOLE SLICE EXISTS FOR.** D291 and D292
  // both recorded a ZERO diff in `src/` and called it by-design. It is by-design
  // AND the zero is load-bearing: `playableTrainers` hands the WHOLE `card` to
  // `handPlayBarred`, so the rarity arm reaches the local Trainers list with no
  // term of its own — the kind of reach nothing observes until it breaks.
  //
  // ⚠️ **AND ONE CANDIDATE MEASURED UNKILLABLE AND DELIBERATELY NOT WRITTEN,
  // AN EIGHTH CONSECUTIVE SLICE.** Making `placement.ts`'s `turn:action` energy
  // branch refuse a barred ACE SPEC drop cannot be spelled as a mutant at all:
  // `PlacementContext` carries a phase kind, a turn bit and a ready bit and NO
  // card identity, so there is no expression at that site whose value can differ
  // between a barred and a free board. **THE ROW IS NOT UNKILLABLE FOR WANT OF A
  // TEST — IT IS UNWRITABLE FOR WANT OF AN ARGUMENT**, which is exactly the
  // refusal D293 records, and it is a different finding from D288's.
  {
    id: "D293-local-hud-drops-the-rarity-arm",
    decision: "D293",
    what: "🛑 THE LOCAL TRAINERS LIST STOPS ASKING ABOUT THE CARD: `handPlayBarred(game, seat, klass, card)` becomes `…, undefined)`, so `isAceSpec` answers `false` for every row and an ACE SPEC Item or Stadium stays LIT, is clicked, and is refused by the engine — the afford-then-reject defect D287 closed for Stadiums, re-opened one axis over. ⚠️ **EVERY CLASS BAR KEEPS WORKING**, which is the whole point: the stamped and Active-keyed disjuncts are untouched, so `GameHud.handPlayBar.dom.test.tsx` — the nearest suite, whose every board is a CLASS bar — stays GREEN on all 18 of its `it`s. **MEASURED BY PERFORMING IT: 4 of 5,958 repo-wide, all 4 in `GameHud.aceSpecBar.dom.test.tsx` (4 of its 15), ZERO anywhere else.** ⚠️ The wire twin (`redact.ts:742`) is a SEPARATE line with the same shape, already pinned by `aceSpecBar.test.ts` §7 — which is why this row had to be anchored in `src/` and could not ride the engine's",
    file: "src/features/game/GameHud.tsx",
    find: "      handPlayBarred(game, seat, klass, card);",
    replace: "      handPlayBarred(game, seat, klass, undefined);",
    expectKilledBy: ["src/features/game/GameHud.aceSpecBar.dom.test.tsx"],
  },
  {
    id: "D293-energy-hint-inverted",
    decision: "D293",
    what: "⚠️ THE §6.2 ALLOWANCE READOUT IS INVERTED: the HUD says *\"drag an energy to attach\"* exactly when the seat has ALREADY attached and *\"energy attached ✓\"* when it has not. **MEASURED: 2 of 5,958 repo-wide, both in `GameHud.aceSpecBar.dom.test.tsx`, ZERO elsewhere — and the zero is itself the finding**: a 2,600-line HUD had this string and no assertion about it in any suite until D293 went looking for a WRONG STRING on a barred board. 🛑 **IT IS NOT AN ACE SPEC ROW AND THAT IS WHY IT IS HERE.** D292's handoff suspected this string of being wrong *because* of the bar; driven, it reads `game.allowances.energyAttached` and nothing else, renders identically on a barred and a free board, and would render on a hand holding no Energy at all. Pinning it is what let the ACE SPEC question be answered separately from it",
    file: "src/features/game/GameHud.tsx",
    find: "          {game.allowances.energyAttached ? \"energy attached ✓\" : \"drag an energy to attach\"}",
    replace: "          {game.allowances.energyAttached ? \"drag an energy to attach\" : \"energy attached ✓\"}",
    expectKilledBy: ["src/features/game/GameHud.aceSpecBar.dom.test.tsx"],
  },
  // ── D294 — THE CROSS-SEAT DESTINATION (`bottomFromOpponentHand.dest`). D294
  //    shipped its code and its suite and authored NO corpus row; these three are
  //    written by D295 against the untouched build, each MEASURED against a green
  //    6,038 before it was recorded.
  {
    id: "D294-dest-dropped-at-the-resolve",
    decision: "D294",
    what: "🛑 THE CROSS-SEAT DESTINATION IS SILENTLY LOST ON THE RESOLVE PATH: the parked `chooseCards` answer is applied with `undefined` instead of `op.dest`, so Mandibuzz's chosen Basic goes to the BOTTOM OF THE OPPONENT'S DECK instead of onto their Bench — the op's own pre-D294 behaviour, arriving as a regression that type-checks (the parameter is optional). ⚠️ **THE OFFER IS UNTOUCHED**, so the affordance still lights, the prompt still says `bench`, the reveal still happens and the hand still shrinks: every count-shaped assertion stays green and only an assertion about WHERE the card landed can see it. **MEASURED: 8 of 6,038 repo-wide, all 8 in `lookForPrey.test.ts`**",
    file: "packages/engine/src/interpreter.ts",
    find: "      const moved = bottomFromOpponentHandApply(state, choice.uids, ctx, events, op.dest);",
    replace: "      const moved = bottomFromOpponentHandApply(state, choice.uids, ctx, events, undefined);",
    expectKilledBy: ["packages/engine/src/lookForPrey.test.ts"],
  },
  {
    id: "D294-benched-row-loses-the-actor",
    decision: "D294",
    what: "⚠️ `POKEMON_BENCHED` drops its optional `actor`, so the log row reads as the OWNER benching a Basic of their own — indistinguishable from the §5.2 play, when in fact their opponent reached into their hand and did it to them. **DELIBERATELY THE NARROWEST ROW IN THE PAIR: 1 of 6,038**, and that 1 is the only assertion in the repo that pins the ENERGY_DISCARDED / CARD_TO_BOTTOM_OF_DECK actor convention on this event. The board is IDENTICAL either way — this is a pure information defect, which is exactly the class a count-based suite cannot reach",
    file: "packages/engine/src/interpreter.ts",
    find: "      events.push({ type: \"POKEMON_BENCHED\", seat: owner, uid, actor: ctx.seat });",
    replace: "      events.push({ type: \"POKEMON_BENCHED\", seat: owner, uid });",
    expectKilledBy: ["packages/engine/src/lookForPrey.test.ts"],
  },
  {
    id: "D294-prompt-lies-about-the-destination",
    decision: "D294",
    what: "⚠️ THE PARK'S `dest` IS HARD-WIRED TO `\"deckBottom\"` WHILE THE APPLY STILL BENCHES: the dialog tells the player their pick is going to the bottom of a deck and the engine puts it on the opponent's Bench. **MEASURED: 1 of 6,038** — the prompt and the apply read the SAME field today, and this row is what stops them drifting apart later. 🛑 The pair with `D294-dest-dropped-at-the-resolve` is the point: that row breaks the APPLY and leaves the prompt honest, this one breaks the PROMPT and leaves the apply honest, and no single assertion catches both",
    file: "packages/engine/src/interpreter.ts",
    find: "          dest: op.dest ?? \"deckBottom\",",
    replace: "          dest: \"deckBottom\",",
    expectKilledBy: ["packages/engine/src/lookForPrey.test.ts"],
  },
  // ── D295 — THE VICTIM-ZONE DESTINATION (`discardEnergy.to`). Chill Teaser Toy
  //    `sv08-166`, ONE legal printing.
  {
    id: "D295-destination-falls-back-to-the-pile",
    decision: "D295",
    what: "🛑 `discardEnergy`'s destination branch collapses to the DISCARD PILE, so Chill Teaser Toy discards the opponent's Energy instead of handing it back — a strictly BETTER card than the one printed, and the failure mode the whole slice is about. ⚠️ **EVERY \"the Energy left the Pokémon\" ASSERTION STAYS GREEN**, which is why `chillTeaserToy.test.ts` §3 keeps `fix-hammer` on the same board as an ATTRIBUTION CONTROL: without a paired discard board the pile-versus-hand question is not asked anywhere. **MEASURED: 7 of 6,038 repo-wide, all 7 in `chillTeaserToy.test.ts`, and ZERO in `discardEnergy.test.ts` — the zero is the finding**, because the hammer family's own suite cannot see this at all",
    file: "packages/engine/src/interpreter.ts",
    find: "      ...(toHand\n        ? { hand: [...side.hand, ...discarded] }\n        : { discard: [...side.discard, ...discarded] }),",
    replace: "      discard: [...side.discard, ...discarded],",
    expectKilledBy: ["packages/engine/src/chillTeaserToy.test.ts"],
  },
  {
    id: "D295-caption-still-says-discard",
    decision: "D295",
    what: "⚠️ THE PARK'S CAPTION REVERTS TO \"Discard an Energy from 1 of your opponent's Pokémon.\" while the apply still puts the card in the hand — so the one screen that tells a player what their pick is about to do says the opposite of what happens. **MEASURED: 2 of 6,038**, and it is deliberately narrow: the BOARD is identical under this mutant, so only an assertion on the prompt's own string can reach it (D280's `conditionNote` row, one vocabulary over). The paired control assertion — that `fix-hammer`'s caption is UNCHANGED — is what stops a fix that simply captions everything the new way",
    file: "packages/engine/src/interpreter.ts",
    find: "  const putBack = op.to === \"hand\";",
    replace: "  const putBack = false;",
    expectKilledBy: ["packages/engine/src/chillTeaserToy.test.ts"],
  },
  {
    id: "D295-event-loses-the-destination",
    decision: "D295",
    what: "⚠️ `ENERGY_DISCARDED` stops carrying `to`, so the LOG says the Energy was \"discarded\" on a board where it went back to its owner's hand — a wrong sentence about a public fact both players watched, and the one place a player can reconstruct the turn afterwards. **MEASURED: 2 of 6,038.** The STATE is untouched, so this is an information defect in D294's `POKEMON_BENCHED` class; it is filed as its own row rather than folded into the pile row above because the two fail in opposite directions — that one moves the cards and lies to nobody, this one moves nothing and lies to everybody",
    file: "packages/engine/src/interpreter.ts",
    find: "      ...(toHand ? { to: \"hand\" as const } : {}),",
    replace: "      ...({} as { to?: \"hand\" }),",
    expectKilledBy: ["packages/engine/src/chillTeaserToy.test.ts"],
  },
  {
    id: "D295-chill-teaser-gate-drops-the-going-order-conjunct",
    decision: "D295",
    what: "🛑 THE SECOND CONSUMER'S GATE COLLAPSES to the bare `yourFirstTurn` member, dropping the going-order conjunct the printed sentence spells FIRST — Chill Teaser Toy becomes playable on the going-first seat's turn 1. **THE SAME DEFECT `D280-registry-row-drops-the-conjunction` PINS ON CALL BELL, ON THE OTHER CARD**, and it needs its own row for the reason that row's own re-anchoring exposed: the two declarations are byte-identical, so one mutant cannot cover both and a naive `find` covers NEITHER. ⚠️ **MEASURED: 7 of 6,038 across THREE files** (`chillTeaserToy.test.ts`, `callBell.test.ts`, `lookForPrey.test.ts`) — the widest D295 row, and the cross-file kills are the two suites that assert the two gates are EQUAL, which is a claim only a shared-vocabulary slice can make",
    file: "packages/engine/src/registry.ts",
    find: "const CHILL_TEASER_TOY: CardProgram = {\n  trainerPlayableIf: {\n    kind: \"allOf\",\n    conditions: [{ kind: \"youGoSecond\" }, { kind: \"yourFirstTurn\" }],\n  },",
    replace: "const CHILL_TEASER_TOY: CardProgram = {\n  trainerPlayableIf: { kind: \"yourFirstTurn\" },",
    expectKilledBy: ["packages/engine/src/chillTeaserToy.test.ts"],
  },
  {
    id: "D296-the-may-becomes-a-must",
    decision: "D296",
    what: "🛑 THE `optional` WRAPPER IS DROPPED and the deriver returns the bare `discardEnergy`, so all four printings become MANDATORY: \"You may put an Energy … into their hand\" silently becomes \"Put an Energy …\" — which is EXACTLY the sentence Omanyte `sv03.5-138`/`-180` prints and which is `legal_standard = 0`. **THE MUTANT MAKES THE ENGINE PLAY THE ILLEGAL PRINTING.** ⚠️ **EVERY \"the Energy ended up in the opponent's hand\" ASSERTION STAYS GREEN**, because the accept branch is what the mutant always takes; only an assertion on the PARK ITSELF, or on the DECLINE, can reach it. That is why §2 asserts the confirm prompt whole and §3 pairs every accept with a decline twin. **MEASURED: 19 of 6,067 repo-wide, all 19 in `aquaWash.test.ts` — the widest D296 row**",
    file: "packages/engine/src/effects.ts",
    find: "      const ask: EffectOp = { op: \"optional\", note: effect, then: [put] };",
    replace: "      const ask: EffectOp = put;",
    expectKilledBy: ["packages/engine/src/aquaWash.test.ts"],
  },
  {
    id: "D296-the-count-becomes-an-up-to",
    decision: "D296",
    what: "🛑 THE BUILD D295's TYPED BLOCKER WOULD HAVE PRODUCED, INSTALLED AS A MUTANT. `count: 2` becomes `{count: \"any\", cap: 2}` — the op's own declinable mode — so the park's scope goes from `{kind:\"total\", count:2}` to `{kind:\"upTo\", max:2}` and a player may legally put back **ONE** Energy where the card prints \"you may put 2\". ⚠️ **THE CHOICE SET IS IDENTICAL FOR OCTILLERY** (0..1 either way), so the one-Energy printing cannot see this at all, and every \"two came off\" assertion stays green because two is still a legal answer. It is reachable ONLY from an assertion on the SCOPE or from a driven ILLEGAL pick, which is why §4 carries both. It also silently switches OFF the interchangeable collapse, which §4's three-identical-Energy row is the witness for. **MEASURED: 10 of 6,067, all in `aquaWash.test.ts`**",
    file: "packages/engine/src/effects.ts",
    find: "        ...(count === undefined ? {} : { count }),",
    replace: "        ...(count === undefined ? {} : { count: \"any\" as const, cap: count }),",
    expectKilledBy: ["packages/engine/src/aquaWash.test.ts"],
  },
  {
    id: "D296-the-derived-destination-falls-back-to-the-pile",
    decision: "D296",
    what: "⚠️ THE DERIVER STOPS SETTING `to: \"hand\"`, so all four printings DISCARD the opponent's Energy instead of handing it back — a strictly better card than the one printed, and the same failure `D295-destination-falls-back-to-the-pile` pins on the OTHER side of the same field. **IT NEEDS ITS OWN ROW BECAUSE THE TWO SITES ARE DISJOINT**: that one mutates the APPLY (interpreter.ts) and is reached by a Trainer; this one mutates the DERIVATION (effects.ts) and is reached by four attacks, so each is green under the other's kill. D295's own uniqueness lesson, read one axis over — a second PRODUCER of a field owes a second row exactly as a second CONSUMER of a shape does. **MEASURED: 13 of 6,067, all in `aquaWash.test.ts`, and ZERO in `chillTeaserToy.test.ts` — the zero is the proof the two rows are disjoint**",
    file: "packages/engine/src/effects.ts",
    find: "        filter: { kind: \"anyEnergy\" },\n        to: \"hand\",",
    replace: "        filter: { kind: \"anyEnergy\" },",
    expectKilledBy: ["packages/engine/src/aquaWash.test.ts"],
  },
  {
    id: "D296-stage-two-becomes-any-evolution",
    decision: "D296",
    what: "🛑 `opponentActiveIsStage2` READS `evolveFromOf(card) !== null` INSTEAD OF THE PRINTED STAGE WORD — i.e. it becomes `opponentActiveIsEvolution`, the sibling one line up. Paldean Tauros then strips a **Stage 1** defender, which its printed adjective excludes. **THIS IS THE ONE MISTAKE D262's DOC BLOCK SAYS THE SENTENCE INVITES**, written down there three slices before any BoardCondition needed it, and the row exists to prove the warning is now a test rather than a paragraph. ⚠️ Every Stage-2 board stays GREEN under it (an evolution is an evolution), so only the DENIED board reaches it — D279's rule verbatim: when you build a permission, write the board where it is denied. ⚠️ **MEASURED: 1 of 6,067**, the NARROWEST row this run has written and deliberately so: there is exactly one board in the catalog on which the two readings differ, and it takes one assertion to state it. 🛑 **AND THE REPLACE IS BYTE-IDENTICAL TO THE LINE ONE ARM UP** (`opponentActiveIsEvolution`'s return), so applying this mutant makes the string occur TWICE in the file — harmless for a `replace`, but it is why the `find` anchors on `isStage2Pokemon` and could never anchor on the shared shape",
    file: "packages/engine/src/interpreter.ts",
    find: "      return spot !== null && isStage2Pokemon(spot.card);",
    replace: "      return spot !== null && evolveFromOf(spot.card) !== null;",
    expectKilledBy: ["packages/engine/src/aquaWash.test.ts"],
  },
  // ── D297 — LICKITUNG "TONGUE PULL" (`bottomFromOpponentHand.upTo`). Four rows,
  //    each MEASURED against a green 6,099 before it was recorded, by performing
  //    the substitution, running the engine suite and undoing by INVERSE
  //    SUBSTITUTION with `git diff` empty each time. ⚠️ **ALL FOUR KILL IN
  //    `tonguePull.test.ts` AND NOWHERE ELSE, AND THAT IS A FACT ABOUT THE FIELD
  //    RATHER THAN ABOUT THE SUITE**: `upTo` is absent on every other producer in
  //    the repo, so every one of these mutants is BY CONSTRUCTION invisible to the
  //    five existing consumers of this op. A row that reddened elsewhere would mean
  //    the conditional had been written on the wrong thing.
  {
    id: "D297-offer-collapses-to-one-representative",
    decision: "D297",
    what: "🛑 THE OFFER'S CAP GOES BACK TO A HARD 1, so a hand holding TWO COPIES OF ONE PRINTED BASIC offers ONE candidate and the second copy can never reach the Bench — *\"up to 2\"* silently becomes *\"up to 1\"* on exactly the boards where the two differ. ⚠️ **THIS IS THE MUTANT THE HANDOFF'S FLAGGED DOUBT SAID WOULD BE UNKILLABLE**, on the argument that `cardIdentity` keys a Pokémon on its catalog `id` so two DIFFERENT Basics never collapsed. The argument is TRUE and the conclusion is FALSE: two different Basics are the board where the cap is invisible, and `tonguePull.test.ts` §3 carries BOTH so the pair is what makes the row legible. **MEASURED: 6 of 6,099, all in `tonguePull.test.ts`** — and the paired two-different-Basics control stays GREEN under it, which is the whole point of writing it",
    file: "packages/engine/src/interpreter.ts",
    find: "  const cap = op.upTo ?? 1;",
    replace: "  const cap = 1;",
    expectKilledBy: ["packages/engine/src/tonguePull.test.ts"],
  },
  {
    id: "D297-lone-candidate-resolves-without-asking",
    decision: "D297",
    what: "🛑 THE ONE-CANDIDATE AUTO-RESOLVE DROPS ITS `upTo` GUARD AND FIRES ON A DECLINABLE PICK: a single Basic in the revealed hand is put onto the opponent's Bench with nobody asked, so the printed *\"up to\"* has no way to mean *\"none\"*. **THE SHARPEST LINE IN THE SLICE, PINNED.** ⚠️ The M1 no-choice rule retires a prompt whose ANSWERS ARE THE SAME STATE; here they are \"a card moves\" and \"nothing moves\", so the shortcut is not merely impolite, it is a rule misapplied. **MEASURED: 3 of 6,099** — narrower than the cap row above and DELIBERATELY SO, because every multi-candidate board stays green under it: only a board with EXACTLY ONE offer reaches it, which is the fixture a natural \"the effect works\" suite never writes (D279's rule)",
    file: "packages/engine/src/interpreter.ts",
    find: "      if (op.upTo === undefined && candidates.length === 1) {",
    replace: "      if (candidates.length === 1) {",
    expectKilledBy: ["packages/engine/src/tonguePull.test.ts"],
  },
  {
    id: "D297-decline-refused-at-the-park",
    decision: "D297",
    what: "⚠️ THE PARK'S `min` IS HARD-WIRED TO 1, so the offer's SIZE is right and the DECLINE is gone: the controller may take one or two cards and may not take none, which is a strictly better card than the one printed. 🛑 **THE PAIR WITH `D297-lone-candidate-resolves-without-asking` IS THE POINT**: that row removes the QUESTION, this one removes an ANSWER, and the boards they need are different — a two-candidate board is green under the first and red under this. Both fail by being TOO STRICT about what the opponent's controller may do, which is D278/D279's harder-to-see direction. **MEASURED: 5 of 6,099**",
    file: "packages/engine/src/interpreter.ts",
    find: "          min: op.upTo === undefined ? 1 : 0,",
    replace: "          min: 1,",
    expectKilledBy: ["packages/engine/src/tonguePull.test.ts"],
  },
  {
    id: "D297-park-asks-for-more-bodies-than-the-bench-holds",
    decision: "D297",
    what: "⚠️ THE PARK STOPS CLAMPING `upTo` TO THE LIVE `benchSpace`, so an opponent with ONE Bench slot free is asked to name TWO cards — and the apply then silently drops the second, which is the *\"a card removed from a hand with nowhere to land\"* shape the M1 review named, arriving as a question rather than as a lost card. **DELIBERATELY THE NARROWEST ROW OF THE FOUR: 1 of 6,099.** The board is IDENTICAL under it whenever the Bench has room for both, and the apply's own clamp keeps the RESULT honest even when it does not — so only an assertion on the PROMPT's `max`, on a nearly-full Bench, can reach it. `searchDeck` and `discardPileRetrieval` both take this clamp at the same place and neither has a row that pins it",
    file: "packages/engine/src/interpreter.ts",
    find: "            ? Math.min(op.upTo, benchSpace(state, otherSeat(ctx.seat)))",
    replace: "            ? op.upTo",
    expectKilledBy: ["packages/engine/src/tonguePull.test.ts"],
  },
  // ── 🆕 D298 — THE ATTACHED §8.1 PRIZE REDUCTION (Legacy Energy `sv06-167`,
  //    Lillie's Pearl `sv09-151`). FIVE rows, each MEASURED against a green 6,131
  //    before it was recorded, by performing the substitution, running the ENGINE
  //    package (199 files / 4,920 tests — the only package whose suites can reach
  //    `flow.ts` at all) and undoing by INVERSE SUBSTITUTION with `git diff` EMPTY
  //    after every single one. ⚠️ **FOUR OF THE FIVE MOVE EXACTLY ONE ASSERTION,
  //    AND THAT IS A PROPERTY OF THE RIDERS RATHER THAN A THIN SUITE**: each rider
  //    (`requiresHolderOwner`, `oncePerGame`, the possessive, the `count === 0`
  //    break) is invisible on every board except the ONE that was written for it,
  //    which is D279's rule restated — a permission's denial board is never the
  //    board you would write to show the permission working.
  {
    id: "D298-possessive-lets-the-attacker-reduce",
    decision: "D298",
    what: "🛑 THE PRINTED POSSESSIVE IS DROPPED FROM THE ATTACHED READ — *\"Knocked Out by damage from an attack from your **opponent's** Pokémon\"* becomes *\"…from an attack\"*, so a Legacy Energy on the ATTACKER's OWN body reduces the Prize its opponent takes for it. Reachable because `finishAttack` sweeps BOTH boards and passes BOTH seats — D164's clause, and the half of it that is load-bearing rather than decorative. ⚠️ **THE BOARD IS A RETALIATION AND NOTHING ELSE REACHES IT**: P2's Active wears a Rocky Helmet `sv01-193`, so Bite puts 20 HP back on P1's attacker, which is one hit from death with the Energy attached and dies in the SAME sweep. **MEASURED: 1 of 4,920 in the engine package** — every other board in this file has the attachment on the DEFENDER, where the mutant is invisible",
    file: "packages/engine/src/flow.ts",
    find: "  if (attackerSeat === undefined || attackerSeat === ref.seat) return unchanged;",
    replace: "  if (attackerSeat === undefined) return unchanged;",
    expectKilledBy: ["packages/engine/src/legacyEnergy.test.ts"],
  },
  {
    id: "D298-latch-never-written",
    decision: "D298",
    what: "🛑 `GameState.oncePerGameSpent` IS READ AND NEVER WRITTEN, so *\"This effect of your Legacy Energy can't be applied more than once per game\"* becomes *\"…every time\"*. **THE WHOLE OF WHAT THIS ROW ACTUALLY COST** — the prize hook (D164) and the attached-card fold (D174) were both already built, and the LATCH is the only thing that was missing, so this mutant is the one that undoes the slice rather than a rider on it. **MEASURED: 5 of 4,920, the broadest of the five** — and the five it moves are worth naming because they are five different questions about one field: the key's SPELLING (the printed effect's name, not a card id), the SECOND Knock Out, the PER-SEAT split, the composition with Munkidori ex, and the JSON round-trip that proves the latch rides the RECORD",
    file: "packages/engine/src/flow.ts",
    find: "        oncePerGameSpent: { ...next.oncePerGameSpent, [ref.seat]: [...spent, entry.oncePerGame] },",
    replace: "        oncePerGameSpent: { ...next.oncePerGameSpent, [ref.seat]: spent },",
    expectKilledBy: ["packages/engine/src/legacyEnergy.test.ts"],
  },
  {
    id: "D298-owner-gate-dropped",
    decision: "D298",
    what: "⚠️ LILLIE'S PEARL LOSES ITS OWNER PREFIX — *\"If the **Lillie's** Pokémon this card is attached to…\"* becomes *\"If the Pokémon this card is attached to…\"*, i.e. the Tool becomes the ENERGY, which is exactly the failure D279 warns about: **reusing a mechanism copies the sentence it was written for.** The two printings share a consequent and disagree on every rider, and a build that took only Legacy Energy would have shipped this mutant as its implementation. **MEASURED: 1 of 4,920**, and the board that catches it is `fix-pearl-nobody` — \"Clefairy\" to `fix-lillie-body`'s \"Lillie's Clefairy\", identical in HP, attack and Prize value, differing ONLY in the name",
    file: "packages/engine/src/flow.ts",
    find: `    if (
      entry.requiresHolderOwner !== undefined &&
      !(holderName ?? "").startsWith(\`\${entry.requiresHolderOwner}'s \`)
    )
      continue;`,
    replace: '    if (entry.requiresHolderOwner !== undefined && holderName === undefined) continue;',
    expectKilledBy: ["packages/engine/src/legacyEnergy.test.ts"],
  },
  {
    id: "D298-zero-prize-still-spends-the-cap",
    decision: "D298",
    what: "🛑 THE `count === 0` BREAK IS GONE, so a Knock Out whose Prize is ALREADY ZERO still runs the reduction arithmetic — clamping harmlessly to 0, emitting nothing observable in the count, and **BURNING THE ONCE-PER-GAME CAP ON A KNOCK OUT THAT REDUCED NOTHING**. ⚠️ **THE SHARPEST ROW OF THE FIVE AND THE ONE MOST LIKELY TO HAVE SHIPPED**, because the mutant's board looks IDENTICAL on the turn it happens: the Prize count, the phase, the events and the log are all unchanged, and the only thing that differs is a field nobody reads until a LATER Knock Out. The board that reaches it is a 1-Prize `Lillie's ` holder wearing BOTH printings — the Pearl takes 1 → 0 first and the Energy finds nothing left. **MEASURED: 1 of 4,920**",
    file: "packages/engine/src/flow.ts",
    find: "    if (count === 0) break;",
    replace: "    if (count < 0) break;",
    expectKilledBy: ["packages/engine/src/legacyEnergy.test.ts"],
  },
  {
    id: "D298-ability-arm-skips-the-attachment",
    decision: "D298",
    what: "⚠️ `planPrizes`' ON-KO-ABILITY ARM GOES BACK TO A DIRECT `entries.push`, so a body carrying BOTH an on-KO Ability and an attached reduction pays only the Ability's — Munkidori ex wearing a Legacy Energy reduces 2 → 1 instead of 2 → 1 → 0. 🛑 **THIS IS THE MUTANT THE PRE-SLICE CODE ACTUALLY WAS**: the ability arm `continue`d, so the attached read had to become a CLOSURE every push in the loop goes through rather than a line appended after one of them. **MEASURED: 1 of 4,920** — and the row exists because the composition is invisible on every single-carrier board, which is every other board in the file",
    file: "packages/engine/src/flow.ts",
    find: `        push(count, [
          { type: "ABILITY_TRIGGERED", seat: ref.seat, uid: ref.uid, ability: ability.name },
          {
            type: "PRIZE_REDUCED",
            seat: ref.seat,
            uid: ref.uid,
            by: baseCount - count,
            count,
          },
        ]);`,
    replace: `        entries.push({
          ref,
          count,
          hasProgram,
          guardEvents: [
            { type: "ABILITY_TRIGGERED", seat: ref.seat, uid: ref.uid, ability: ability.name },
            {
              type: "PRIZE_REDUCED",
              seat: ref.seat,
              uid: ref.uid,
              by: baseCount - count,
              count,
            },
          ],
        });`,
    expectKilledBy: ["packages/engine/src/legacyEnergy.test.ts"],
  },
  // 🛑 **AND ONE CANDIDATE MEASURED AND DELIBERATELY NOT WRITTEN, FOR A REASON
  //    THAT IS NEW TO THIS LIST: IT IS TOO BLUNT, NOT TOO WEAK.** Making
  //    `passivesOf`'s collector push for the bodies that DON'T carry a reduction
  //    (`{ by: 0 }` for every other source) kills in THREE files — including
  //    `vengefulPunch.test.ts`, whose event-order assertion grows a spurious
  //    `PRIZE_REDUCED` row. A mutant that reddens an unrelated family is telling
  //    you about the FOLD's reachability, which the five rows above already pin
  //    from the side that matters, and its name would claim a precision it does
  //    not have. **A ROW HAS TO NAME WHAT IT BREAKS.**
  // ── D299 — `returnBenched`, the first op that unmakes an in-play body outside
  // the KO path. Every row below is a way of moving the RIGHT cards to the WRONG
  // place (or the wrong cards to the right one) while the board still looks
  // plausible — which is the failure mode a zone-transfer op actually has.
  // ⚠️ EACH WAS DRIVEN BEFORE IT WAS WRITTEN, by one script that substituted, ran,
  // INVERSE-SUBSTITUTED and recorded `git diff --stat` into the row's own log:
  // seven candidates, seven kills, seven CLEAN diffs, and the assertion counts
  // below are measured rather than expected.
  {
    id: "D299-stackUids-drops-the-tools",
    decision: "D299",
    what: "🛑 THE EXTRACTION FAILING QUIETLY: `stackUids` — the definition of the printed 'and all attached cards', shared by `returnBenched` and `discardFromStack` — forgets the Tools. A body shuffled into the deck leaves its Tool on a Bench slot that no longer exists, and a Knock Out discards everything but the Tool. This is the exact shape D298's handoff predicted a mutant for ('the attached cards are left behind'), and it is the ONE row that reaches both callers of the extracted line. Moves 1 test",
    file: "packages/engine/src/types.ts",
    find: "  return [...pokemon.stack, ...pokemon.energy, ...pokemon.tools];",
    replace: "  return [...pokemon.stack, ...pokemon.energy];",
    expectKilledBy: ["packages/engine/src/returnBenched.test.ts"],
  },
  {
    id: "D299-returned-body-lands-in-the-actors-deck",
    decision: "D299",
    what: "the cross-seat claim inverted: the pile is shuffled into the ACTOR's deck instead of the OWNER's, so Illumise's opponent loses a Pokémon and the Illumise player gains the cards. `withSide(state, owner, …)` against `ctx.seat` is the ONE line that makes this one op rather than two, and nothing else in the function would change if it were wrong. Moves 2 tests",
    file: "packages/engine/src/interpreter.ts",
    find: "  return { ...withSide(state, owner, { ...side, bench, deck }), rngState };",
    replace: "  return { ...withSide(state, ctx.seat, { ...side, bench, deck }), rngState };",
    expectKilledBy: ["packages/engine/src/returnBenched.test.ts"],
  },
  {
    id: "D299-the-bench-splice-keeps-the-body",
    decision: "D299",
    what: "the splice copied from `knockOut`'s benched branch loses its `+ 1`, so the returned Pokémon is shuffled into the deck AND left standing on the Bench — the same uid in two zones, which every downstream reader will happily believe. §8.1's 'no gap, no promotion' is a fact about the BENCH and this is the second thing in the engine to implement it; a copied line is exactly the kind that rots without a row. Moves 3 tests",
    file: "packages/engine/src/interpreter.ts",
    find: "  const bench = [...side.bench.slice(0, index), ...side.bench.slice(index + 1)];\n  events.push({ type: \"POKEMON_RETURNED\"",
    replace: "  const bench = [...side.bench.slice(0, index), ...side.bench.slice(index)];\n  events.push({ type: \"POKEMON_RETURNED\"",
    expectKilledBy: ["packages/engine/src/returnBenched.test.ts"],
  },
  {
    id: "D299-the-event-swaps-seat-and-actor",
    decision: "D299",
    what: "`POKEMON_RETURNED` files the OWNER as the actor and the ACTOR as the owner. The board is untouched and only the story is wrong — the log row moves to the wrong player and reads as something the victim chose to do to themselves, which is the CARD_TO_BOTTOM_OF_DECK convention failing in the one direction it exists to prevent. Moves 2 tests, one of them the log row itself",
    file: "packages/engine/src/interpreter.ts",
    find: "  events.push({ type: \"POKEMON_RETURNED\", seat: owner, uid, actor: ctx.seat, dest: op.dest, uids });",
    replace: "  events.push({ type: \"POKEMON_RETURNED\", seat: ctx.seat, uid, actor: owner, dest: op.dest, uids });",
    expectKilledBy: ["packages/engine/src/returnBenched.test.ts"],
  },
  {
    id: "D299-the-printed-possessive-is-ignored",
    decision: "D299",
    what: "🛑 THE FIELD THAT CARRIES THE PRINTED POSSESSIVE STOPS BEING READ: every printing shuffles the CONTROLLER's own Bench away, so Illumise and Sylveon become self-mill and Chimecho is unchanged. It also deletes the `unshieldedRefs` wrap in the same stroke, which is why the row is named for the dispatch rather than for the shield. Moves 5 tests — the widest row of the seven, and the one whose `what` is a single `?:`",
    file: "packages/engine/src/interpreter.ts",
    find: "        op.whose === \"opponent\"\n          ? unshieldedRefs(state, oppBenchRefs(state, ctx.seat), ctx, events)\n          : ownBenchRefs(state, ctx.seat),",
    replace: "        ownBenchRefs(state, ctx.seat),",
    expectKilledBy: ["packages/engine/src/returnBenched.test.ts"],
  },
  {
    id: "D299-the-deck-arm-forgets-the-shuffle-row",
    decision: "D299",
    what: "the cards are shuffled into the deck and the SHUFFLE event is not emitted. The STATE is right and the LOG lies by omission: an opponent watching the wire sees a body leave the Bench with no reason to believe their deck order changed. `randomFromOpponentHand`'s deck arm sets the precedent (one event per thing that happened) and this is the row that keeps this op on it. Moves 2 tests",
    file: "packages/engine/src/interpreter.ts",
    find: "  const [deck, rngState] = shuffle([...side.deck, ...uids], state.rngState);\n  events.push({ type: \"SHUFFLE\", seat: owner });",
    replace: "  const [deck, rngState] = shuffle([...side.deck, ...uids], state.rngState);",
    expectKilledBy: ["packages/engine/src/returnBenched.test.ts"],
  },
  {
    id: "D299-the-hand-spelling-derives-the-deck-op",
    decision: "D299",
    what: "Swoobat's printed 'Put … into your hand' derives the DECK op, so the body is shuffled away instead of picked back up — a strictly worse card, silently. The four-way alternation's whole point is that the destination is read off the spelling and not guessed from the verb, and this is that reading breaking on the one arm where the two words disagree with the others. Moves 3 tests across TWO files, including the log row's singular/plural arm",
    file: "packages/engine/src/effects.ts",
    find: "    if (match[3] !== undefined) return [{ op: \"returnBenched\", whose: \"self\", dest: \"hand\" }];",
    replace: "    if (match[3] !== undefined) return [{ op: \"returnBenched\", whose: \"self\", dest: \"deck\" }];",
    expectKilledBy: ["packages/engine/src/returnBenched.test.ts"],
  },
  // 🛑 **ONE CANDIDATE MEASURED UNKILLABLE AND NOT WRITTEN — A NINTH CONSECUTIVE
  //    SLICE, AND IT IS D288's KIND AFTER ALL.** Deleting `to?: never` from
  //    `discardEnergy`'s `opponentEach` arm (effects.ts) leaves **6,038 of 6,038
  //    GREEN, 0 assertions moved**: the field is never SET on that arm, so no
  //    board this catalog can build takes a different value under it. It is a
  //    TYPE-LEVEL guard against a future author, not a behaviour — "a decision,
  //    not a behaviour" (D288), a seventh time. ⚠️ D294's handoff warned *"do not
  //    assume the next one is unkillable-in-D288's-sense either"* after D293's
  //    UNWRITABLE row; this one is, so the warning was right to be made and wrong
  //    on the guess.

  // ── D301 · the opponent-energy scaling family, pinned as RESOLVED ───────────
  // 🛑 THESE TWO ROWS EXIST BECAUSE THE FAMILY HAD NONE. D193 shipped both
  // patterns and D196 shipped the mirror; the corpus carried a row for the
  // additive arm's DISPATCH (`D193-scale-arm-swap`, one fold over) and not one
  // for either regex's own SHAPE. A census that pins a family as "already read"
  // is only as good as the readers staying able to read it, so the two mutations
  // that would quietly UN-read part of it are transcribed here.
  {
    id: "D301-board-zone-alternative-dropped",
    decision: "D301",
    what: "🛑 THE `×` FOLD'S BOARD ZONE STOPS BEING PRINTED-READABLE: the whole-noun-phrase alternation loses its 'all of your opponent's Pokémon' arm, so the FOUR board sentences (6 legal printings, and the only place a type filter is legal-printed on this side) fall through to null and re-enter the unbuilt remainder. This is exactly the shape D301's census correction claims cannot happen — a reader narrowing while a doc block goes on enumerating 17. Moves 11 assertions across TWO files — 2 of them D301's own census rungs, which is the row's whole point",
    file: "packages/engine/src/effects.ts",
    find:
      "const OPPONENT_ENERGY_MULTIPLY =\n" +
      "  /^This attack does (\\d+) damage for each (?:(.+) )?Energy attached to (your opponent['’]s Active Pokémon|all of your opponent['’]s Pokémon)\\.$/;",
    replace:
      "const OPPONENT_ENERGY_MULTIPLY =\n" +
      "  /^This attack does (\\d+) damage for each (?:(.+) )?Energy attached to (your opponent['’]s Active Pokémon)\\.$/;",
    expectKilledBy: [
      "packages/engine/src/censusAtHead.test.ts",
      "packages/engine/src/benchBodyScaling.test.ts",
    ],
  },
  {
    id: "D301-the-zone-prefix-reads-backwards",
    decision: "D301",
    what: "the printed noun phrase still MATCHES and the zone it selects is INVERTED: 'your opponent's Active Pokémon' counts the whole board and 'all of your opponent's Pokémon' counts the Active alone. Nothing falls out of the census's printing counts — every sentence still resolves — so a partition asserted as a BOOLEAN would stay green; only the per-sentence `{per, zone, energyType}` catches it. `active` is a strict SUBSET of `board` (§6.3), so the damage is wrong in both directions on any board whose defender has a Bench. Moves 8 assertions across TWO files — and MEASURED: the closure rung, which is a boolean partition, stays GREEN under it while the per-sentence rung dies, so the two rungs are not the same assertion twice",
    file: "packages/engine/src/effects.ts",
    find:
      "    const zone: OpponentEnergyZone =\n" +
      "      opponentEnergy[3]?.startsWith(\"all of \") === true ? \"board\" : \"active\";",
    replace:
      "    const zone: OpponentEnergyZone =\n" +
      "      opponentEnergy[3]?.startsWith(\"all of \") === true ? \"active\" : \"board\";",
    expectKilledBy: [
      "packages/engine/src/censusAtHead.test.ts",
      "packages/engine/src/benchBodyScaling.test.ts",
    ],
  },
  {
    id: "D304-cheren-points-at-another-cards-program",
    decision: "D304",
    what: "🛑 THE `trainer` DECOMPOSITION'S COLLISION IS BROKEN AT ITS SOURCE: `Cheren` `sv10.5w-081` stops sharing `Friends in Paldea`'s `NEMONA` object and is bound to `PICNICKER` instead, so the card draws on a coin flip (4, else 2) where it prints \"Draw 3 cards.\". The 42-card / 41-object arithmetic still closes — `byObject.size` is 41 either way — and ONLY the collision asserted BY NAME sees it, which is the whole reason D304 records the pair rather than the count. MEASURED: moves 3 assertions across TWO files (D304's collision rung, and D190's two reprint-alias object rungs)",
    file: "packages/engine/src/registry.ts",
    find: '  "sv10.5w-081": NEMONA, // Cheren (Supporter, mark I)',
    replace: '  "sv10.5w-081": PICNICKER, // Cheren (Supporter, mark I)',
    expectKilledBy: [
      "packages/engine/src/censusAtHead.test.ts",
      "packages/engine/src/reprintAliasLegal.test.ts",
    ],
  },
  {
    id: "D304-a-reprint-drifts-from-its-original",
    decision: "D304",
    what: "a TERM stops being a CARD: `Friends in Paldea`'s reprint `sv08.5-137` is bound to `MAX_ROD` while its original `sv08.5-109` keeps `NEMONA`, so one printing of one card retrieves 5 from the discard pile and the other draws 3. Every count in the census is untouched — the id is still in the pool, still in `CENSUS_TRAINER_LEGAL`, still in its term — so the SUM, the PARTITION and the subtype tally all stay GREEN; only the LIVE per-term object-identity rung dies. That rung is what makes `BUILT.trainer`'s terms cards rather than bags of ids. MEASURED: moves 2 assertions across TWO files, and a DIFFERENT D304 rung from the row above",
    file: "packages/engine/src/registry.ts",
    find: '  "sv08.5-137": NEMONA, // Friends in Paldea (reprint)',
    replace: '  "sv08.5-137": MAX_ROD, // Friends in Paldea (reprint)',
    expectKilledBy: [
      "packages/engine/src/censusAtHead.test.ts",
      "packages/engine/src/reprintAliasLegal.test.ts",
    ],
  },
  {
    id: "D305-copperajah-group-loses-a-card",
    decision: "D305",
    what: "Tangrowth `sv06-002` is re-bound from the FIVE-card `COPPERAJAH_EX` object to `STONJOURNER` (−30 becomes −20) — the largest name/body collision in the `ability` column shrinks from 5 cards to 4 and `STONJOURNER` grows from 2 to 3, so the collision table moves in BOTH directions at once",
    file: "packages/engine/src/registry.ts",
    find: '"sv06-002": COPPERAJAH_EX,',
    replace: '"sv06-002": STONJOURNER,',
    // PROBED INDIVIDUALLY against the full suite: 4 assertions move across 2
    // files. D305's collision rung is the census killer; `reprintAliasLegal`
    // catches the shape change independently, which is why both are listed.
    expectKilledBy: [
      "packages/engine/src/censusAtHead.test.ts",
      "packages/engine/src/reprintAliasLegal.test.ts",
    ],
  },
  {
    id: "D305-carracosta-stops-splitting",
    decision: "D305",
    what: "Carracosta `sv07-038` is re-bound from `PRIMAL_KNOWLEDGE` to `MIGHTY_SHELL`, the program its two OTHER printings use — the CONVERSE failure (one NAME over two objects) disappears, 82 objects become 81 and the 94-card JOIN becomes 93",
    file: "packages/engine/src/registry.ts",
    find: '"sv07-038": PRIMAL_KNOWLEDGE,',
    replace: '"sv07-038": MIGHTY_SHELL,',
    // PROBED INDIVIDUALLY: 6 assertions move across 2 files, and it kills THREE
    // D305 rungs the row above does NOT touch — the live 82, the CONVERSE, and
    // the 94-card JOIN. ⚠️ A DECLARED killer set would have merged these two rows;
    // they are different findings and were measured separately (D304's rule).
    expectKilledBy: [
      "packages/engine/src/censusAtHead.test.ts",
      "packages/engine/src/auraNarrowing.test.ts",
    ],
  },
  // 🛑 **D305 — ONE CANDIDATE MEASURED *UNWRITABLE*, D293's KIND, FOURTH INSTANCE
  //    (D303 the second, D304 the third), AND IT IS NOT THE UNKILLABLE KIND.**
  //    D305's first rung is the 92-term PARTITION of `ABILITY_NAME_TERMS` against
  //    `CENSUS_POKEMON_LEGAL`, both directions. **There is no source site to anchor
  //    a mutant on**: both sides are recorded constants in the same test file, so a
  //    mutation would have to edit the assertion, which is not a mutation. The same
  //    is true of the three D1 constants in the three-column-key rung (202 / 215 /
  //    0) — a catalog fact this suite cannot re-query. ⚠️ **AND THAT IS A STATEMENT
  //    ABOUT WHAT THE RUNG GUARDS RATHER THAN A GAP**: it catches a HUMAN bumping
  //    `BUILT.ability` without naming the card, which is exactly the failure the
  //    column's history keeps producing, and no source edit can produce it. The
  //    rungs a source edit CAN reach are the four LIVE ones — the 82 objects, the
  //    8 collisions, the 2 splits and the 94-card JOIN — and the two rows above
  //    reach them between them, on DISJOINT killer sets.
  // 🛑 **ONE CANDIDATE MEASURED *UNWRITABLE* AND NOT WRITTEN — D293's KIND, THIRD
  //    INSTANCE (D303 recorded the second), AND IT IS NOT THE UNKILLABLE KIND.**
  //    D304's strongest rung is the PARTITION: every id in `TRAINER_TERMS` is in
  //    `CENSUS_TRAINER_LEGAL` and vice versa, in both directions. **There is no
  //    source site to anchor a mutant on**, because BOTH sides are recorded
  //    constants in the same test file — a mutation would have to edit the
  //    assertion, which is not a mutation. ⚠️ **AND THAT IS A STATEMENT ABOUT WHAT
  //    THE RUNG GUARDS, NOT A GAP**: it catches a HUMAN bumping `BUILT.trainer`
  //    without naming the card, which is the failure D269→D303 actually kept
  //    hitting, and no source edit can produce it. The rungs a source edit CAN
  //    reach are the two rows above, and both are written.
  // 🛑 **ONE CANDIDATE MEASURED UNKILLABLE AND NOT WRITTEN — A TENTH CONSECUTIVE
  //    SLICE, AND IT IS D202's KIND (`unreachable-population`) RATHER THAN
  //    D288's.** Deleting the OPTIONAL type-token group from
  //    `OPPONENT_ENERGY_SCALE` — `for each (?:(.+) )?Energy attached to your
  //    opponent's Active Pokémon` → `for each Energy attached to …` — leaves
  //    **6,181 of 6,181 GREEN, 0 assertions moved**. ⚠️ AND THE REASON IS A
  //    MEASUREMENT OVER THE WHOLE CATALOG, NOT OVER THE LEGAL POOL: the D1 sweep
  //    in `censusAtHead.test.ts`'s D301 block returns **20 raw printings of the
  //    additive/opponent fold across ALL legality (`10 more` … `90 more`) and not
  //    one of them prints a type filter**. The optional group is reachable on the
  //    `×` fold (`{R}`, `Special`) and UNPRINTED on the `+` fold, which is exactly
  //    what `OPPONENT_ENERGY_SCALE`'s own doc block says and the first time it has
  //    been driven. **A "keep both patterns symmetrical" decision, not a
  //    behaviour** — and the honest form of it is this note plus the raw census,
  //    not a `survives` row asserting an absence the catalog could rotate into.

  // ── D306 — the evolve-from-deck family (6 legal printings on 4 cards), and the
  //    two tails of `placeEvolution` that make its refusal a COMPOSITION one. ──
  {
    id: "D306-corpus-understates-the-bare-ascension",
    decision: "D306",
    what: "🛑 THE EXACT SILENT FAILURE THAT WOULD HAVE MADE D305's PREDICTION LOOK RIGHT: the bare \"Search your deck for a card that evolves from this Pokémon…\" record loses 2 of its 4 legal printings (Eevee `sv06-135`/`-188`, Dwebble `sv10-011`, Team Rocket's Pupitar `sv10-095`), so the family reads 2 + 2 and the move an anchor would buy reads FOUR instead of SIX. A count, not a spelling — and the edit is LENGTH-PRESERVING, so the 60,467-character checksum stands still and cannot catch it; what moves is the 1,732 units total beside it (→ 1,730) and the population D306 exists to state",
    file: "packages/engine/src/censusAttackCorpus.ts",
    find: "4 Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
    replace: "2 Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
    // PROBED INDIVIDUALLY against the full suite: 6 assertions move across 2
    // files (3 + 3). `censusAtHead` catches it as a corpus-integrity failure;
    // `precociousEvolution` catches it as a WRONG POPULATION, which is a
    // different finding — hence both, measured rather than declared.
    expectKilledBy: [
      "packages/engine/src/censusAtHead.test.ts",
      "packages/engine/src/precociousEvolution.test.ts",
    ],
  },
  {
    id: "D306-evolve-ko-reads-the-pre-evolution-body",
    decision: "D306",
    what: "🛑 `placeEvolution`'s §8.1 KO tail asks whether the OLD body is lethally damaged instead of the NEW one, so a charmed Basic that drops under its Stage 2's HP survives the placement and the mid-turn KO never happens. This is the tail D306 drives to type the refusal: the branch it deletes is the one that returns `resolveMidTurnKnockOuts`, i.e. an ApplyResult carrying PENDING STAGES — the shape no `EffectOp` result can express",
    file: "packages/engine/src/turn.ts",
    find: "  if (isLethallyDamaged(next, evolved)) {",
    replace: "  if (isLethallyDamaged(next, from)) {",
    // PROBED INDIVIDUALLY: 4 assertions move across 3 files. Disjoint from the
    // row above (no census file in the set) and from the row below (which kills
    // the OTHER tail and leaves this branch alone).
    // 🆕 🛑 D319 ADDED A FOURTH FILE, AND IT HAD TO: THIS ROW SURVIVED THE FULL
    // SWEEP BECAUSE OF AN ADDITION THAT NEVER TOUCHED IT. D319 put a SECOND §8.1 KO
    // sweep after the opponent-action scan a few lines below, and it catches the
    // same lethally-damaged body from the other side of the scan - so deleting the
    // FIRST check stopped being observable as a Knock Out and the three files below
    // all went green on the mutant. **An addition breaking a row it never touched**
    // (D317's finding, arriving from a third direction: not an anchor this time but
    // a BEHAVIOUR that a later line now also produces.)
    // ⚠️ THE REPAIR IS A DRIVER FOR WHAT THE TWO CHECKS STILL SEPARATE, NOT A
    // RELAXATION. A Pokémon Knocked Out ON PLACEMENT has left play, so the
    // opponent's trigger has nothing to put counters on and must not fire at all -
    // which is what the ORDER means and what no KO-outcome assertion can see.
    // `opponentActionTrigger.test.ts` §5b drives exactly that board.
    expectKilledBy: [
      "packages/engine/src/precociousEvolution.test.ts",
      "packages/engine/src/rareCandy.test.ts",
      "packages/engine/src/stadiumTool.test.ts",
      "packages/engine/src/opponentActionTrigger.test.ts",
    ],
  },
  {
    id: "D306-evolve-drops-the-on-evolve-trigger",
    decision: "D306",
    what: "🛑 THE OTHER TAIL: `placeEvolution` returns `ok(next, events)` instead of `runBoardTrigger(…, \"onEvolve\", …)`, so every on-evolve Ability in the registry stops firing — including the one that PARKS (Arboliva `sv01-023`). The park is the half of the composition blocker that has no cheap answer: an on-evolve program parking inside an attack-effect program is a park inside a park, and `EffectContinuation` holds exactly one `pendingOp`",
    file: "packages/engine/src/turn.ts",
    // 🆕 D319 RE-POINTED, AND NARROWED RATHER THAN WIDENED. The old anchor was a
    // three-line ADJACENCY claim over the §8.1 KO check and this return; D319 put the
    // opponent-action scan BETWEEN them, so the claim broke while `git grep` still
    // found both halves — D317's finding, arriving for the third time. The row is
    // re-aimed at the single line it was always about, which is unique in this file
    // (the `onPlayToBench` call site names a different timing and a different state).
    find: "  return runBoardTrigger(watched, seat, target, \"onEvolve\", events);",
    replace: "  return ok(watched, events);",
    // PROBED INDIVIDUALLY: 22 assertions move across 5 files — the widest of the
    // three, and worth saying so: this row measures the ALREADY-EXISTING trigger
    // coverage far more than it measures D306's, which contributes 1 of the 22.
    // Written anyway because the tail is HALF of the refusal D306 types, and a
    // slice that later wires an evolving op must break BOTH tails to be wrong.
    expectKilledBy: [
      "packages/engine/src/attachFromDeck.test.ts",
      "packages/engine/src/inPlayTarget.test.ts",
      "packages/engine/src/legalNonAttackPrograms.test.ts",
      "packages/engine/src/precociousEvolution.test.ts",
      "packages/engine/src/triggered.test.ts",
    ],
  },
  // 🛑 **D306 — ONE CANDIDATE MEASURED *UNWRITABLE*, D293's KIND, FIFTH INSTANCE
  //    (D303 second, D304 third, D305 fourth).** D306's sharpest rung is §4's
  //    *"the four NON-gated printings are not in the registry at all — the family
  //    is 2 of 6"*. **There is no source site to anchor a mutant on**: the
  //    failure it guards is a slice ADDING four registry rows and reporting a
  //    closed family (D295's exact failure), and an ADDITION is not a
  //    substitution. Re-BINDING one of the two gated ids is a different mutant
  //    that D305's rows already reach. ⚠️ Recorded, not written.
  // -- D307 -- the evolve-from-deck family BUILT: one anchor, one op, and the
  //    source-zone distinction that removed the blocker rather than channelling
  //    it. The two D306 rows above are UNCHANGED and still point at
  //    `placeEvolution`, which is the whole claim of the extraction: the HAND
  //    route kept both tails. --
  {
    id: "D307-anchor-admits-the-printed-compound",
    decision: "D307",
    what: "🛑 THE ANCHOR LOSES ITS `^` AND SWALLOWS A COMPOUND THE CATALOG REALLY PRINTS. Finizen `sv03-060`/`sv04.5-123` \"Valiant Evolution\" is *\"Switch this Pokémon with 1 of your Benched Pokémon. **If you do**, search your deck for a card that evolves from this Pokémon…\"* -- so an unanchored pattern derives the TAIL of a sentence whose HEAD is a switch the engine never performed, evolving a body that was supposed to have moved first. The neighbouring arms in this file are all `^...$` for exactly this reason, and the mistake is the one an author makes when a sentence \"obviously\" has no prefix",
    file: "packages/engine/src/effects.ts",
    find: "const ATTACK_EVOLVE_FROM_DECK =\n  /^Search your deck for a card that evolves from this Pok",
    replace: "const ATTACK_EVOLVE_FROM_DECK =\n  /Search your deck for a card that evolves from this Pok",
    // PROBED INDIVIDUALLY against the FULL suite: KILLED, 7 assertions move,
    // ALL in `evolveFromDeck.test.ts` - the compound refusal, the three
    // other-body refusals and the gated printing's whole-string refusal, which
    // is the set an unanchored pattern swallows in one go.
    expectKilledBy: ["packages/engine/src/evolveFromDeck.test.ts"],
  },
  {
    id: "D307-candidate-filter-reads-the-id-not-the-name",
    decision: "D307",
    what: "🛑 THE DECK FILTER COMPARES `evolveFrom` AGAINST THE CATALOG **id** RATHER THAN THE **name**, which is the exact confusion `turn.ts`'s own §10 check exists to settle (`targetTopCard.name !== evolvesFrom`). Every real card fails the comparison, so the search finds nothing on every board and the attack becomes a silent no-op that still shuffles -- the quiet direction, since nothing errors and the trailing op still files its event",
    file: "packages/engine/src/interpreter.ts",
    find: "      return evolveFromOf(card) === top.name;",
    replace: "      return evolveFromOf(card) === top.id;",
    // 🆕 D310 RE-POINTED. The line was
    // `return card !== undefined && evolveFromOf(card) === top.name;` until the
    // `names` branch split the undefined guard onto its own line. The MUTANT is
    // unchanged in meaning -- id-for-name on the chain comparison -- and the
    // anchor now quotes the tail alone. ⚠️ Found by `git grep` BEFORE the
    // prediction was written, which is D309's earned rule doing its job: one grep
    // of the line about to move named the one row that would otherwise have
    // reported `skipped(broken)` forty minutes into the sweep.
    // PROBED INDIVIDUALLY against the FULL suite: KILLED, 11 assertions move -
    // the WIDEST of the five board rows, because an empty candidate set takes
    // out every rung that reaches the park (§2, §4's deck route, §5's lethal
    // board and §6's persisted shape). Wide and INFORMATIVE, unlike the row
    // below it: every one of the 11 is this slice's own.
    expectKilledBy: ["packages/engine/src/evolveFromDeck.test.ts"],
  },
  {
    id: "D307-park-names-a-zone-instead-of-the-body",
    decision: "D307",
    what: "🛑 THE PROMPT TELLS THE CLIENT THE CARD IS GOING TO THE **BENCH**. The card goes onto the attacking body; a dialog told `\"bench\"` names the wrong place in its own words, and `\"bench\"` is the member an author reaches for because it is the only other Pokémon-shaped destination. Nothing about the RESOLUTION changes, so this is a pure lie on the wire -- the class of defect `dest` exists to prevent (the `deck`/`deckBottom` split above it)",
    file: "packages/engine/src/interpreter.ts",
    find: "          dest: \"evolve\",",
    replace: "          dest: \"bench\",",
    // PROBED INDIVIDUALLY against the FULL suite: KILLED, 2 assertions move -
    // the NARROWEST row in the set, and correctly so: the lie is on the WIRE
    // and changes no board, so only the two rungs that read the prompt's own
    // `dest` can see it. A row nothing else catches is the row worth having.
    expectKilledBy: ["packages/engine/src/evolveFromDeck.test.ts"],
  },
  {
    id: "D307-park-is-mandatory-so-the-decline-is-gone",
    decision: "D307",
    what: "🛑 THE PRINTED \"up to\" LOSES ITS DECLINE: `min: 1` makes the pick mandatory, so a player who would rather not evolve (the Basic is doing a job, the Stage 1 in the deck is worse into this matchup) is forced to. `searchDeck` and `discardPileRetrieval` both carry `min: 0` on the same prompt kind, so a copied-from-the-neighbour arm gets this right and a hand-written one is exactly where it goes wrong",
    file: "packages/engine/src/interpreter.ts",
    find: "          candidates: offer.candidates,\n          min: 0,\n          max: 1,",
    replace: "          candidates: offer.candidates,\n          min: 1,\n          max: 1,",
    // PROBED INDIVIDUALLY against the FULL suite: KILLED, 3 assertions move.
    expectKilledBy: ["packages/engine/src/evolveFromDeck.test.ts"],
  },
  {
    id: "D307-evolution-is-copied-out-of-the-deck",
    decision: "D307",
    what: "🛑 THE CARD LANDS ON THE STACK **AND STAYS IN THE DECK** -- one uid in two zones, which is the card-DUPLICATION mirror of the card-destruction shape `searchMove`'s own doc names (its clamp exists so the set removed from the deck is exactly the set that lands). It is invisible on the board and shows up as a deck that never shrinks and a second copy findable by the next search",
    file: "packages/engine/src/interpreter.ts",
    find: "    deck: side.deck.filter((inDeck) => inDeck !== uid),",
    replace: "    deck: side.deck,",
    // PROBED INDIVIDUALLY against the FULL suite: KILLED, 2 assertions move.
    // DISJOINT from the `dest` row above (that one moves the prompt rungs, this
    // one the two board rungs that count the deck), so neither subsumes the
    // other even though both are 2.
    expectKilledBy: ["packages/engine/src/evolveFromDeck.test.ts"],
  },
  {
    id: "D307-extraction-drops-the-write-back",
    decision: "D307",
    what: "🛑 THE EXTRACTION RETURNS THE **PRE-PLACEMENT** STATE: `evolveOnto` builds the evolved body, pushes `POKEMON_EVOLVED`, and hands back the board it was given. This is the mistake the split invites -- a function that now returns a pair is one whose first element is easy to fill from the wrong local -- and it is loud in the RIGHT way (the events say the evolution happened and the board says it did not), which is why it belongs to the SHARED helper and reaches the hand route as well as the deck one",
    file: "packages/engine/src/types.ts",
    find: "  return { state: withSide(state, seat, updated), evolved };",
    replace: "  return { state, evolved };",
    // PROBED INDIVIDUALLY against the FULL suite: KILLED, and it moves **79**
    // assertions across the whole engine - by far the widest row this corpus
    // has, and worth saying WHY it is the LEAST informative of the six: it
    // measures the pre-existing evolution/Rare-Candy coverage far more than it
    // measures D307's, which contributes a handful. `expectKilledBy` is kept
    // NARROW (one suite, ~3 s) on purpose - the fast run only has to prove the
    // line is guarded, and this note records the width the full probe measured.
    expectKilledBy: ["packages/engine/src/evolution.test.ts"],
  },
  // 🛑 **D307 -- ONE CANDIDATE MEASURED *UNWRITABLE*, D293's KIND, SIXTH
  //    INSTANCE (D303 second, D304 third, D305 fourth, D306 fifth).** The sharpest
  //    claim this slice makes is the CATALOG one: *"every printed on-evolve
  //    Ability says 'from your hand', so a deck-sourced placement fires none"*.
  //    **No source expression carries it.** The code that acts on it is an
  //    ABSENCE -- `evolveFromDeckMove` calls `evolveOnto` and simply does not call
  //    `runBoardTrigger` -- and a mutant that ADDS the call is not a substitution
  //    on any anchor. The claim is guarded instead by the pair of rungs in
  //    `evolveFromDeck.test.ts` §4 (the deck route files no `ABILITY_TRIGGERED`,
  //    the hand route on the same board files one), which is a real attribution
  //    control rather than a mutant. ⚠️ Recorded, not written.

  // ── D308 · THE ITERATED EVOLVE-FROM-DECK SENTENCE — the scheduler, the
  //    redirected offer, and the two places the bench slot has to survive.
  //    Every row is a NEIGHBOUR COPY: the neighbour is D307's own op, one file
  //    over and one field short, which is exactly the mistake this shape invites.
  {
    id: "D308-scheduler-drops-the-slot",
    decision: "D308",
    what: "🛑 THE SCHEDULER PUSHES D307's OP VERBATIM — no `ontoBench` — so all N scheduled copies ask about the ATTACKER instead of about each Benched body. The literal neighbour copy: the line one field short of the line that is there, and on a board where the attacker HAS a deck evolution it would park N times on the wrong body rather than fail loudly",
    file: "packages/engine/src/interpreter.ts",
    // 🆕 RE-POINTED AT D309: the field is `onto: PokemonTarget`, not `ontoBench`.
    find: '        schedule.push({ op: "evolveFromDeck", onto: { spot: "bench", index } });',
    replace: '        schedule.push({ op: "evolveFromDeck" });',
    expectKilledBy: ["packages/engine/src/evolveEachBenched.test.ts"],
  },
  {
    id: "D308-scheduler-shuffles-per-body",
    decision: "D308",
    what: "the scheduler pushes its own `shuffleDeck` after each body, so the printed single *\"Then, shuffle your deck.\"* becomes N shuffles. The mistake an author makes reading the sentence as a loop over the WHOLE clause rather than over the search — and it is invisible on a one-body Bench, which is why §3 reads the parked `cont.rest` instead",
    file: "packages/engine/src/interpreter.ts",
    // 🆕 RE-POINTED AT D309, same rename.
    find: '        schedule.push({ op: "evolveFromDeck", onto: { spot: "bench", index } });',
    replace:
      '        schedule.push({ op: "evolveFromDeck", onto: { spot: "bench", index } }, { op: "shuffleDeck" });',
    expectKilledBy: ["packages/engine/src/evolveEachBenched.test.ts"],
  },
  {
    id: "D308-offer-still-reads-the-source",
    decision: "D308",
    what: "🛑 THE OFFER IGNORES `ontoBench` AND GOES BACK TO `sourceRef` — D307's body verbatim. The park is then about the attacker on every scheduled copy, which is the half of the redirection that lives in the OFFER rather than in the scheduler; two places have to agree and this row proves the first one is guarded",
    file: "packages/engine/src/interpreter.ts",
    // 🆕 RE-POINTED AT D309: the widening collapsed the four-line ternary to one
    // line, which is itself the shape the rename bought — a bench index needed a
    // constructed ref, a target IS the ref's spot.
    find:
      "  const [ref] = onto === undefined ? sourceRef(state, ctx) : [{ seat: ctx.seat, spot: onto }];",
    replace: "  const [ref] = sourceRef(state, ctx);",
    expectKilledBy: ["packages/engine/src/evolveEachBenched.test.ts"],
  },
  {
    id: "D308-resolution-drops-the-slot",
    decision: "D308",
    what: "🛑 THE *RESOLUTION* DROPS `ontoBench` WHILE THE PARK KEEPS IT — the other half, and the nastier one: the prompt names the right Benched body and the card lands on the ATTACKER. A park and its resolution re-deriving the same offer from different inputs is precisely the drift `evolveFromDeckMove`'s doc says the re-derivation exists to prevent",
    file: "packages/engine/src/interpreter.ts",
    // 🆕 RE-POINTED AT D309, same rename.
    // 🆕 RE-POINTED AT D310: the call gained `op.names`, so the row now drops the
    // slot ALONE (passing `undefined` for `onto` and keeping the names), which is
    // the same defect it has always described rather than a new one.
    find: "        ? evolveFromDeckMove(state, choice.uids, ctx, events, op.onto, op.names)",
    replace: "        ? evolveFromDeckMove(state, choice.uids, ctx, events, undefined, op.names)",
    expectKilledBy: ["packages/engine/src/evolveEachBenched.test.ts"],
  },
  {
    id: "D308-arm-drops-the-shuffle",
    decision: "D308",
    what: "the deriver arm returns the scheduler alone, so the printed *\"Then, shuffle your deck.\"* never fires. D230's two-op shape half-copied — the same omission the pronoun arm one line up would suffer, and the reason both arms are asserted as WHOLE arrays",
    file: "packages/engine/src/effects.ts",
    find: '    return [{ op: "evolveFromDeckEachBenched" }, { op: "shuffleDeck" }];',
    replace: '    return [{ op: "evolveFromDeckEachBenched" }];',
    expectKilledBy: ["packages/engine/src/evolveEachBenched.test.ts"],
  },
  {
    id: "D308-anchor-loses-its-head",
    decision: "D308",
    what: "the iterated anchor's leading `^` is removed, so any sentence ENDING in this clause would be read as the whole-Bench iteration",
    file: "packages/engine/src/effects.ts",
    find:
      "const ATTACK_EVOLVE_FROM_DECK_EACH_BENCHED =\n" +
      "  /^For each of your Benched Pokémon, search your deck",
    replace:
      "const ATTACK_EVOLVE_FROM_DECK_EACH_BENCHED =\n" +
      "  /For each of your Benched Pokémon, search your deck",
    expectKilledBy: ["packages/engine/src/evolveEachBenched.test.ts"],
    survives: {
      kind: "unreachable-population",
      reason:
        "⚠️ DECLARED RATHER THAN QUIETLY OMITTED, AND IT IS D202's KIND EXACTLY — the leading anchor has NO near-miss in the printed catalog. The one legal sentence that carries this mechanism behind a PREFIX is Team Rocket's Nidorina `sv10-115`, and it does not spell the head the same way: *\"Choose up to 2 of your {D} Pokémon. For each of THOSE Pokémon, …\"*. So no corpus row contains this pattern as a proper suffix and dropping `^` changes nothing today. 🛑 THE TRAILING `$` IS A DIFFERENT MATTER AND IS NOT DECLARED — it is what refuses a compound whose SECOND half is this clause (Finizen's shape one sentence over), and it has a live near-miss in the `legal_standard = 0` pool. THE DAY A PRINTING PREFIXES THIS EXACT HEAD, this row reports STALE-SURVIVOR and someone re-reads the anchor. 🆕 **D315 BUILT THE NIDORINA SENTENCE ON ITS OWN ARM AND THIS DECLARATION IS UNCHANGED** — it is the SPELLING of the head, not the sentence's buildability, that the reason turns on, and *\"For each of THOSE Pokémon\"* is still not *\"For each of your Benched Pokémon\"*. Re-read at D315 and re-affirmed rather than carried.",
    },
  },
  // ── D309 · THE BODY-CHOICE EVOLVE-FROM-DECK SENTENCE — the SECOND PARK, the
  //    deck-aware narrowing, and the channel between the two questions. ⚠️ **THE
  //    NEIGHBOUR HERE IS D308's OWN SLICE, ONE FIELD WIDER**: every row below is
  //    the shape this arm would have if the widening had been half-done, which is
  //    the mistake a rename invites more than a new field does.
  {
    id: "D309-anchor-reads-the-pronoun-sentence",
    decision: "D309",
    what: "🛑 THE ANCHOR'S MIDDLE BECOMES D307's — *\"this Pokémon\"* where the print says *\"1 of your Pokémon\"* — so the arm refuses its own sentence and claims a sibling's. THE WRONG-ROW FAILURE (D207) AT ITS SHARPEST: the two sentences share BOTH ends and differ by eleven bytes in the middle, so this is a one-word edit that swaps which printings the arm reads",
    file: "packages/engine/src/effects.ts",
    find:
      "const ATTACK_EVOLVE_FROM_DECK_BODY_CHOICE =\n" +
      "  /^Search your deck for a card that evolves from 1 of your Pokémon",
    replace:
      "const ATTACK_EVOLVE_FROM_DECK_BODY_CHOICE =\n" +
      "  /^Search your deck for a card that evolves from this Pokémon",
    expectKilledBy: ["packages/engine/src/evolveBodyChoice.test.ts"],
  },
  {
    id: "D309-arm-drops-the-shuffle",
    decision: "D309",
    what: "the deriver arm returns the asker alone, so the printed *\"Then, shuffle your deck.\"* never fires. D230's two-op shape half-copied — and it matters MORE here than on the two sibling arms, because this sentence has three endings (whiff, decline, placement) and the shuffle sits behind all of them",
    file: "packages/engine/src/effects.ts",
    find: '    return [{ op: "evolveFromDeckChosen" }, { op: "shuffleDeck" }];',
    replace: '    return [{ op: "evolveFromDeckChosen" }];',
    expectKilledBy: ["packages/engine/src/evolveBodyChoice.test.ts"],
  },
  {
    id: "D309-candidates-skip-the-narrowing",
    decision: "D309",
    what: "🛑 THE OFFER IS THE WHOLE OWN BOARD — the deck-aware filter is dropped, so a body with no matching card in the deck is offered and the only decision the sentence has can be spent on a guaranteed whiff. THIS IS THE SLICE'S REAL WORK, and the mutant is the version of the op an author writes before asking what the deck holds",
    file: "packages/engine/src/interpreter.ts",
    // 🆕 RE-ANCHORED AT D315: the walk moved into `evolvableOwnRefs`, shared with
    // the MULTI-body op. The mutant is the SAME defect at the shared site, so it
    // now kills BOTH suites and the row says so — which is the honest reading of a
    // factored rule: one line, two printed sentences.
    find:
      "    return (evolveFromDeckOffer(state, ctx, ref.spot)?.candidates.length ?? 0) > 0;",
    replace: "    return true;",
    expectKilledBy: [
      "packages/engine/src/evolveBodyChoice.test.ts",
      "packages/engine/src/evolveEachChosen.test.ts",
    ],
  },
  {
    id: "D309-candidates-stay-bench-only",
    decision: "D309",
    what: "🛑 D308's WORLD SURVIVING INTO D309: the candidate walk is narrowed back to the BENCH, so *\"1 of your Pokémon\"* is read as *\"1 of your Benched Pokémon\"* and the ACTIVE can never be chosen. The single mutant that undoes the whole case for the `ontoBench` → `onto` widening, and it fails SILENTLY — the sentence still resolves, just never onto the attacker",
    file: "packages/engine/src/interpreter.ts",
    // 🆕 RE-ANCHORED AT D315 for the same reason as the row above — the walk is now
    // `evolvableOwnRefs`' first line, and narrowing it to the Bench there breaks
    // BOTH printed sentences' access to the Active.
    find: "  return ownInPlayRefs(state, ctx.seat).filter((ref) => {",
    replace:
      '  return ownInPlayRefs(state, ctx.seat)\n    .filter((ref) => ref.spot.spot === "bench")\n    .filter((ref) => {',
    expectKilledBy: [
      "packages/engine/src/evolveBodyChoice.test.ts",
      "packages/engine/src/evolveEachChosen.test.ts",
    ],
  },
  {
    id: "D309-answer-loses-the-body",
    decision: "D309",
    what: "🛑 THE ANSWER IS DISCARDED: the op the first question buys carries no `onto`, so the second park asks about the ATTACKER whatever the player picked. The exact failure the rename exists to prevent, written as the one-field-short neighbour — and the SAME shape D308's `D308-scheduler-drops-the-slot` has one op over, which is why both are in this corpus",
    file: "packages/engine/src/interpreter.ts",
    find: '  return [{ op: "evolveFromDeck", onto: ref.spot }];',
    replace: '  return [{ op: "evolveFromDeck" }];',
    expectKilledBy: ["packages/engine/src/evolveBodyChoice.test.ts"],
  },
  {
    id: "D309-single-body-is-prompted",
    decision: "D309",
    what: "the forcing is removed, so a board with exactly ONE eligible body raises a choice with one candidate in it. M1's no-choice doctrine broken at its second site — and the mutant is invisible to any test that only ever runs the many-candidate board, which is why §4 builds the one-body board by deck surgery",
    file: "packages/engine/src/interpreter.ts",
    find: "      const forced = eligible.length === 1 ? eligible[0] : undefined;\n      if (forced !== undefined) return { done: state, schedule: evolveBodyAnswered(forced) };",
    replace: "      const forced = undefined;\n      if (forced !== undefined) return { done: state };",
    expectKilledBy: ["packages/engine/src/evolveBodyChoice.test.ts"],
  },
  {
    id: "D309-continuation-loses-its-third-member",
    decision: "D309",
    what: "🛑 `continuationOps` no longer recognises the asker, so the body answer buys NOTHING: the park resolves, `applyChoice` returns the state untouched (correctly — it moves nothing by design), the program falls through to the shuffle and the printed evolution never happens. THE CHANNEL BETWEEN THE TWO QUESTIONS, cut — and the reason `applyChoice`'s do-nothing arm is not on its own a defect",
    file: "packages/engine/src/interpreter.ts",
    find: '  if (op.op === "evolveFromDeckChosen") {\n    return choice.kind === "pokemon" ? evolveBodyAnswered(choice.ref) : [];\n  }',
    replace: '  if (op.op === "evolveFromDeckChosen") {\n    return [];\n  }',
    expectKilledBy: ["packages/engine/src/evolveBodyChoice.test.ts"],
  },
  // ── D315 · THE MULTI-BODY EVOLVE-FROM-DECK SENTENCE — the FOURTH
  //    `continuationOps` member (the first to answer a `pokemonMulti` and the
  //    first whose answer buys N ops), the family's FIRST anchor with captures,
  //    and the refusal of D309's forcing. ⚠️ **THE TWO CAPTURE ROWS ARE THE ONES
  //    THAT MATTER MOST**: the catalog prints exactly ONE sentence this arm reads,
  //    so an arm that ignored its own capture groups would pass every board-level
  //    assertion in the suite. They are killed by SYNTHETIC strings, which is the
  //    only thing that can distinguish a parameterised anchor from a literal one.
  {
    id: "D315-arm-hardcodes-the-count",
    decision: "D315",
    what: "🛑 THE COUNT CAPTURE IS IGNORED AND THE PRINTED `2` IS WRITTEN IN. The arm reads exactly one legal sentence today, so this mutant is INVISIBLE to every board in the suite and to every census rung — it is the version of a parameterised anchor an author writes when the pool has one member, and it is wrong the day a reprint says `up to 3`",
    file: "packages/engine/src/effects.ts",
    find: "    const max = Number(eachChosen[1]);",
    replace: "    const max = 2;",
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-arm-hardcodes-the-type",
    decision: "D315",
    what: "the TYPE capture is ignored and `Darkness` is written in — the count mutant's twin, and the same blindness: every printed board in this suite is a {D} board, so only a synthetic {P} sentence can tell the two arms apart",
    file: "packages/engine/src/effects.ts",
    find: '    const pokemonType = POKEMON_TYPE_BY_CODE[eachChosen[2] ?? ""];',
    replace: '    const pokemonType = "Darkness" as const;',
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-unknown-code-gets-a-default",
    decision: "D315",
    what: "🛑 AN UNRECOGNISED BRACE CODE FALLS TO A DEFAULT TYPE INSTEAD OF TO THE LOUD PATH. `?? \"Colorless\"` is the shape an author reaches for to make a `| undefined` go away, and it derives a program whose candidate set is a type the sentence never named — the silent wrong-card failure, where the loud path would have been a null nobody could miss",
    file: "packages/engine/src/effects.ts",
    find: "    if (pokemonType !== undefined && max >= 1) {",
    replace: "    if (max >= 1) {",
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-arm-drops-the-shuffle",
    decision: "D315",
    what: "the deriver arm returns the asker alone, so the printed *\"Then, shuffle your deck.\"* never fires. D230's two-op shape half-copied, at this family's FOURTH site — and it matters most here, because this sentence has FOUR endings (no eligible body, the decline, one placement, two) and the shuffle sits behind all of them",
    file: "packages/engine/src/effects.ts",
    find:
      '      return [{ op: "evolveFromDeckEachChosen", max, pokemonType }, { op: "shuffleDeck" }];',
    replace: '      return [{ op: "evolveFromDeckEachChosen", max, pokemonType }];',
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-candidates-skip-the-type",
    decision: "D315",
    what: "🛑 THE TYPE IS NOT PASSED TO THE SHARED BUILDER, so *\"your {D} Pokémon\"* is read as *\"your Pokémon\"* and a {R} body with an evolution in the deck is offered. The one-argument call is D309's own call site verbatim — a neighbour copy in the strictest sense — and it fails SILENTLY: the sentence still resolves, just onto bodies its noun excludes",
    file: "packages/engine/src/interpreter.ts",
    find: "      const eligible = evolvableOwnRefs(state, ctx, op.pokemonType);",
    replace: "      const eligible = evolvableOwnRefs(state, ctx);",
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-type-test-is-equality",
    decision: "D315",
    what: "🛑 THE MEMBERSHIP TEST BECOMES AN EQUALITY ON THE FIRST PRINTED TYPE, so a DUAL-TYPE body the printed `{D}` noun must admit falls out. The catalog column is an array and dual types are printed; this is the mutant `switchBenchNarrowing`'s doc block warns about in prose, written down at the site that inherited the rule",
    file: "packages/engine/src/interpreter.ts",
    find: '      if (!matchesFilter(card, { kind: "typedPokemon", pokemonType })) return false;',
    replace: "      if ((card.types ?? [])[0] !== pokemonType) return false;",
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-single-body-is-forced",
    decision: "D315",
    what: "🛑 D309's FORCING COPIED ONE OP OVER, WHICH IS THE MISTAKE THIS SLICE'S HEADLINE REFUSES. A board with ONE eligible body auto-resolves instead of parking — and the printed *\"Choose UP TO 2\"* means the decline is a legal answer on every board, so this silently deletes it. The forcing is licensed by the MANDATORY article, not by the candidate count",
    file: "packages/engine/src/interpreter.ts",
    find: "      const max = Math.min(op.max, eligible.length);",
    replace:
      "      const forced = eligible.length === 1 ? eligible[0] : undefined;\n      if (forced !== undefined) return { done: state, schedule: evolveBodyAnswered(forced) };\n      const max = Math.min(op.max, eligible.length);",
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-max-is-not-clamped",
    decision: "D315",
    what: "§8.6 dropped: the printed `2` is offered whole on a board holding ONE eligible body, so the prompt advertises a pick the board cannot supply and its caption says `up to 2` about a list of one",
    file: "packages/engine/src/interpreter.ts",
    find: "      const max = Math.min(op.max, eligible.length);",
    replace: "      const max = op.max;",
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-park-loses-the-decline",
    decision: "D315",
    what: "🛑 `min` BECOMES THE MAX, so *\"Choose up to 2\"* is read as *\"Choose 2\"* and the printed decline stops being an answer. The floor is the one field that separates an \"up to\" prompt from an exact one (`validateChoice`'s own note), and the mutant is the neighbour arm's spelling — `damageChosen`'s snipe really does print an exact number",
    file: "packages/engine/src/interpreter.ts",
    find: "          candidates: eligible,\n          min: 0,\n          max,\n          declinable: false,",
    replace: "          candidates: eligible,\n          min: max,\n          max,\n          declinable: false,",
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-continuation-loses-its-fourth-member",
    decision: "D315",
    what: "🛑 `continuationOps` no longer recognises the MULTI asker, so the body answer buys NOTHING: the park resolves, `applyChoice` returns the state untouched (correctly — it moves nothing by design), the program falls through to the shuffle and no Pokémon evolves. THE CHANNEL BETWEEN THE TWO QUESTIONS, cut — D309's row one op over, and the reason `applyChoice`'s do-nothing arm is not on its own a defect",
    file: "packages/engine/src/interpreter.ts",
    find:
      '  if (op.op === "evolveFromDeckEachChosen") {\n    return choice.kind === "pokemonMulti" ? choice.refs.flatMap(evolveBodyAnswered) : [];\n  }',
    replace: '  if (op.op === "evolveFromDeckEachChosen") {\n    return [];\n  }',
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-answer-buys-only-the-first-op",
    decision: "D315",
    what: "🛑 THE MEMBER THAT MAKES THIS THE FIRST ANSWER TO BUY *N* OPS, HALVED: only the first picked body's `evolveFromDeck` is scheduled, so *\"for each of THOSE Pokémon\"* evolves one of the two. The exact shape an author copying D309's single-ref member writes, and it is invisible to any test that only ever picks one body — which is why §3 picks two and asserts the SECOND park by its own body's name",
    file: "packages/engine/src/interpreter.ts",
    find: "    return choice.kind === \"pokemonMulti\" ? choice.refs.flatMap(evolveBodyAnswered) : [];",
    replace:
      "    const first = choice.kind === \"pokemonMulti\" ? choice.refs[0] : undefined;\n    return first === undefined ? [] : evolveBodyAnswered(first);",
    expectKilledBy: ["packages/engine/src/evolveEachChosen.test.ts"],
  },
  {
    id: "D315-census-row-zero-keeps-its-sentence",
    decision: "D315",
    what: "the closed census row is re-populated with the sentence this slice built, so `censusAtHead`'s ROW-0 printing count and the derived-census sweep disagree. The row is now an EMPTY list kept in place precisely so a sixth spelling reddens by name; this mutant is what proves the empty list is still load-bearing rather than decoration",
    file: "packages/engine/src/censusAtHead.test.ts",
    find: "    attack: [],\n    abilityIds: [],\n    effectIds: [],\n  },\n  {\n    row: 15,",
    replace:
      '    attack: [[1, "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck."]],\n    abilityIds: [],\n    effectIds: [],\n  },\n  {\n    row: 15,',
    expectKilledBy: ["packages/engine/src/censusAtHead.test.ts"],
  },
  // 🛑 **D308 -- ONE CANDIDATE MEASURED *UNWRITABLE*, D293's KIND, SEVENTH
  //    INSTANCE (D303 second, D304 third, D305 fourth, D306 fifth, D307 sixth).**
  //    The `specialEnergy` decomposition's sharpest claim is a PARTITION -- *"7
  //    named terms sum to 8, no printing counted twice, nothing in the column is
  //    unlisted and nothing listed is outside it"* -- and **no source expression
  //    carries it**. The terms are DATA in the suite and the grouping they are
  //    checked against is `programFor` object identity, which is a map read every
  //    other column already mutates. A mutant that broke the partition would have
  //    to edit the test's own table, which is the assertion rather than the code.
  //    ⚠️ Recorded, not written. The rung is guarded instead by being TWO-SIDED
  //    and by the three LIVE halves beside it (the object grouping, the reprint
  //    identity `toBe`, and the three unbuilt candidates asserted `undefined`).
  //
  // ⚠️ **AND A MEASUREMENT WORTH KEEPING ABOUT THE FIVE D308 ROWS ABOVE.** Each
  //    was probed INDIVIDUALLY against the FULL suite: all five KILLED, moving
  //    **6 / 2 / 5 / 2 / 3** assertions and every one of them in exactly ONE file
  //    (`evolveEachBenched.test.ts`). 🛑 **THAT IS THE OPPOSITE SHAPE FROM D307**,
  //    whose widest row moved 79 assertions across the engine and was the least
  //    informative of its six. A scheduler that only ever writes a field its own
  //    op reads has no blast radius, so a narrow probe here is a fact about the
  //    op rather than about the coverage -- and it is why `expectKilledBy` naming
  //    one suite is honest for all five rather than a convenience.
  // ── D310 — the evolve-from-deck family's ABILITY printing: Pidove `sv05-133`
  //    "Emergency Evolution". NINE rows on the two questions this slice answers
  //    (what the candidate set IS, and when the body may ask) plus the three
  //    surfaces that must agree about the second one.
  {
    id: "D310-names-is-conjoined-instead-of-replacing",
    decision: "D310",
    what: "🛑 THE SLICE'S WHOLE FINDING, AS THE MISTAKE AN AUTHOR WOULD ACTUALLY MAKE -- and it is the one the HANDOFF told them to make. The printed name set is ANDed onto §10's chain match instead of replacing it, which is what the word \"filter\" means everywhere else in this file. The named card (Unfezant) evolves from Tranquill and the body is a Pidove, so the intersection is EMPTY ON EVERY BOARD FOREVER: the Ability resolves silently, nothing is ever offered, and every refusal assertion in the suite passes against an offer that does not exist. The quiet direction, and the D207 defect reached from the side where both halves are individually correct",
    file: "packages/engine/src/interpreter.ts",
    find: "      if (names !== undefined) return names.includes(card.name);",
    replace:
      "      if (names !== undefined)\n        return names.includes(card.name) && evolveFromOf(card) === top.name;",
    expectKilledBy: ["packages/engine/src/emergencyEvolution.test.ts"],
  },
  {
    id: "D310-names-is-ignored-entirely",
    decision: "D310",
    what: "the `names` branch is dropped and every printing takes the chain predicate. The LOUD direction of the row above: a Pidove board now offers the four Tranquill sitting in the deck, so the card does something -- just not what it prints, and it puts the wrong Pokémon on the board. This is what a build that threaded the field and forgot to READ it looks like",
    file: "packages/engine/src/interpreter.ts",
    find: "      if (names !== undefined) return names.includes(card.name);\n      return evolveFromOf(card) === top.name;",
    replace: "      return evolveFromOf(card) === top.name;",
    expectKilledBy: ["packages/engine/src/emergencyEvolution.test.ts"],
  },
  {
    id: "D310-resolution-drops-the-names",
    decision: "D310",
    what: "the RESOLUTION re-derives its offer WITHOUT the printed names while the PARK still uses them, so the two disagree: the prompt offers an Unfezant, the player picks it, and `evolveFromDeckMove` re-derives the chain set, does not find the uid in it, and returns the state untouched. A pick that is accepted and does nothing -- the exact failure the re-derivation exists to prevent, arriving through the parameter it forgot",
    file: "packages/engine/src/interpreter.ts",
    find: "        ? evolveFromDeckMove(state, choice.uids, ctx, events, op.onto, op.names)",
    replace: "        ? evolveFromDeckMove(state, choice.uids, ctx, events, op.onto)",
    expectKilledBy: ["packages/engine/src/emergencyEvolution.test.ts"],
  },
  {
    id: "D310-park-note-describes-the-chain",
    decision: "D310",
    what: "the dialog tells the player \"a card that evolves from Pidove\" while offering cards that do not evolve from Pidove. Nothing about the RESOLUTION changes, so this is a pure lie on the wire -- D307's `dest` mutant one field over, and the shape an author reaches for because the chain phrasing is the one already written on the line above",
    file: "packages/engine/src/interpreter.ts",
    find: "            op.names === undefined\n              ? `Search your deck for a card that evolves from ${offer.name} and put it onto ${offer.name} to evolve it.`\n              : `Search your deck for ${op.names.join(\" or \")} and put it onto ${offer.name} to evolve it.`,",
    replace:
      "            `Search your deck for a card that evolves from ${offer.name} and put it onto ${offer.name} to evolve it.`,",
    expectKilledBy: ["packages/engine/src/emergencyEvolution.test.ts"],
  },
  {
    id: "D310-registry-drops-the-second-printed-name",
    decision: "D310",
    what: "the registry row authors only \"Unfezant\" and drops \"Unfezant ex\". ⚠️ THE MOST PLAUSIBLE ROW IN THIS SET, because `Unfezant ex` has ZERO printings in the whole 3,786-row catalog -- an author who checked the catalog before authoring would conclude the second name is dead weight and remove it. It is not dead: a registry row is an EXACT MAP of the print (D190b) and the day the catalog gains the card the row is already right",
    file: "packages/engine/src/registry.ts",
    find: "        { op: \"evolveFromDeck\", names: [\"Unfezant\", \"Unfezant ex\"] },",
    replace: "        { op: \"evolveFromDeck\", names: [\"Unfezant\"] },",
    expectKilledBy: ["packages/engine/src/emergencyEvolution.test.ts"],
  },
  {
    id: "D310-hp-gate-is-strictly-less-than",
    decision: "D310",
    what: "the printed \"30 or less\" becomes \"less than 30\", so a body at exactly 30 remaining -- the only number the card is ever played at on purpose -- cannot use its Ability. Off by one damage counter, invisible on every board except the boundary, and the reason the holder fixture is 70 HP rather than the `battler` default 60",
    file: "packages/engine/src/cardplay.ts",
    find: "  return max - pokemon.damage <= ability.remainingHpAtMost;",
    replace: "  return max - pokemon.damage < ability.remainingHpAtMost;",
    expectKilledBy: ["packages/engine/src/emergencyEvolution.test.ts"],
  },
  {
    id: "D310-hp-gate-reads-the-damage-not-the-remainder",
    decision: "D310",
    what: "\"remaining HP is 30 or less\" is read as \"has 30 or less damage\" -- the misreading the printed sentence invites, since damage counters are what the board actually shows. It INVERTS the card: a healthy Pidove qualifies and a nearly-dead one does not",
    file: "packages/engine/src/cardplay.ts",
    find: "  return max - pokemon.damage <= ability.remainingHpAtMost;",
    replace: "  return pokemon.damage <= ability.remainingHpAtMost;",
    expectKilledBy: ["packages/engine/src/emergencyEvolution.test.ts"],
  },
  {
    id: "D310-hp-gate-is-not-checked-by-useability",
    decision: "D310",
    what: "the §9 reject is dropped and the printed gate is enforced only by the HUD. A player at full health can use the Ability through the wire -- and the two HUD mirrors go on greying the row, so the board and the client disagree about a printed rule. The half of an afford-then-reject nobody looks for: the ENGINE side missing while the greying is right",
    file: "packages/engine/src/cardplay.ts",
    find: "  if (!abilityBodyGateMet(state, ability, resolved.pokemon)) {",
    replace: "  if (false && !abilityBodyGateMet(state, ability, resolved.pokemon)) {",
    expectKilledBy: ["packages/engine/src/emergencyEvolution.test.ts"],
  },
  {
    id: "D310-online-hud-drops-the-body-gate",
    decision: "D310",
    what: "the ONLINE redactor stops folding the per-body gate into `disabled`, so `redactedAbilitiesOf` lights a row `useAbility` refuses -- D222's afford-then-reject, on the surface that has no local engine to check against. The `reason` string is left in place, which is what makes it plausible: the author who adds the message and forgets the disjunct produces exactly this",
    file: "packages/engine/src/redact.ts",
    find: "        (ability.activeOnly && target.spot !== \"active\") ||\n        bodyGateUnmet ||",
    replace: "        (ability.activeOnly && target.spot !== \"active\") ||",
    expectKilledBy: ["packages/engine/src/emergencyEvolution.test.ts"],
  },

  // ── D311 — the SELF-removal family's ABILITY half: Dudunsparce `sv05-129`/
  //    `sv08.5-080` "Run Away Draw". TEN rows on the three pieces this slice
  //    adds — the op that unmakes its own body, the §8.1 promotion seam that
  //    catches the Active case, and the recorded draw behind the printed
  //    "in this way" — plus the registry row that maps the print.
  {
    id: "D311-empty-active-never-promotes",
    decision: "D311",
    what: "🛑 THE SLICE'S WHOLE SEAM, DELETED. `resolveMidTurnKnockOuts` goes back to sweeping KNOCK OUTS only, so an Active Dudunsparce shuffles itself away and the Active Spot stays EMPTY -- the turn resumes on a board with no Active, the §14.2 loss never fires, and the very next attack resolves against nothing. This is the tree as it stood before this slice, which is exactly why the row exists: the op was buildable without it and the suite would have been green on the BENCH half alone",
    file: "packages/engine/src/flow.ts",
    find: "  if (batch.stages.length === 0 && orphaned.length === 0) return ok(batch.state, events);",
    replace: "  if (batch.stages.length === 0) return ok(batch.state, events);",
    expectKilledBy: ["packages/engine/src/runAwayDraw.test.ts"],
  },
  {
    id: "D311-ko-seat-gets-a-second-promotion",
    decision: "D311",
    what: "the dedup drops out of the seam, so a seat the KO batch ALREADY queued a promotion for takes a SECOND one. Harmless by luck -- the stage handler pops on an occupied spot -- and wrong all the same: a board with two promotions owed for one dead Pokémon is a queue nobody can read, and the second stage would become load-bearing the moment anything re-empties the spot between them. The QUIET direction of the row above",
    file: "packages/engine/src/flow.ts",
    // ⚠️ RE-POINTED AT D312, AND THE RE-POINT IS THE SLICE'S OWN FINDING. D312 put
    // the SAME filter at a second site (`finishAttack`), so this `find` — which was
    // unique when it was written — now occurs TWICE and `precheck` said so in two
    // seconds. The anchor gains the `resumeTurn` tail that only D311's site has,
    // which is exactly the term that distinguishes the two copies (see the doc block
    // above `resolveMidTurnKnockOuts`: two sites, two tails, one seam).
    find: "        batch.state.players[seat].active === null &&\n        !batch.stages.some((stage) => stage.kind === \"promote\" && stage.seat === seat),\n    )\n    .map((seat) => ({ kind: \"promote\", seat }));\n  // Nothing KO'd and no spot left empty.",
    replace: "        batch.state.players[seat].active === null,\n    )\n    .map((seat) => ({ kind: \"promote\", seat }));\n  // Nothing KO'd and no spot left empty.",
    expectKilledBy: ["packages/engine/src/runAwayDraw.test.ts"],
  },
  {
    id: "D311-self-removal-leaves-the-body-in-the-active-spot",
    decision: "D311",
    what: "the ACTIVE arm stops NULLING the spot, so the body is shuffled into the deck AND left standing on the board. The same uid in two zones at once -- the invariant every zone helper in this engine is written to preserve -- and the promotion is then never owed, because the seam looks at a spot that is still occupied. The mistake an author makes by copying the BENCH arm's splice and forgetting that the Active is not an array",
    file: "packages/engine/src/interpreter.ts",
    find: "      ? { ...side, active: null }",
    replace: "      ? { ...side }",
    expectKilledBy: ["packages/engine/src/runAwayDraw.test.ts"],
  },
  {
    id: "D311-self-removal-drops-the-attached-cards",
    decision: "D311",
    what: "only the TOP CARD goes back and every attached card is silently deleted: the printed \"and ALL ATTACHED CARDS\" becomes \"and this Pokémon\", so an Energy and a Tool on the body vanish from the game entirely -- not to the discard, not to the deck, nowhere. Invisible on a bare body, which is why the §2 board hangs an Energy and a Tool on it before asking",
    file: "packages/engine/src/interpreter.ts",
    find: "  const uids = stackUids(body);\n  const emptied =",
    replace: "  const uids = [uid];\n  const emptied =",
    expectKilledBy: ["packages/engine/src/runAwayDraw.test.ts"],
  },
  {
    id: "D311-self-removal-refuses-the-active",
    decision: "D311",
    what: "`returnBenched`'s ref guard is copied onto this op, so an ACTIVE Dudunsparce draws its three cards and stays put. ⚠️ THE MOST PLAUSIBLE ROW IN THIS SET: it is the sibling op's own first line, it is what the family's doc block said the engine could do until this slice, and it is what \"build the Bench case\" would have shipped. The draw still happens, so the card LOOKS like it worked",
    file: "packages/engine/src/interpreter.ts",
    find: "  const [ref] = sourceRef(state, ctx);\n  if (ref === undefined) return state;\n  const seat = ctx.seat;",
    replace:
      "  const [ref] = sourceRef(state, ctx);\n  if (ref === undefined) return state;\n  if (ref.spot.spot !== \"bench\") return state;\n  const seat = ctx.seat;",
    expectKilledBy: ["packages/engine/src/runAwayDraw.test.ts"],
  },
  {
    id: "D311-draw-record-is-read-after-the-draw",
    decision: "D311",
    what: "the drawn uids are read off the deck AFTER `drawToHand` has taken them, so the record holds the NEXT three cards instead of the three that moved. Identical on every deep deck -- the gate fires either way -- and wrong exactly at the boundary the printed clause is about: a one-card deck draws its last card and then files NOTHING, so the body does not run away on the one board where \"if you drew ANY cards\" is doing work",
    file: "packages/engine/src/interpreter.ts",
    find: "      const drawn = state.players[ctx.seat].deck.slice(0, Math.max(op.count, 0));\n      const done = drawToHand(state, ctx.seat, op.count, \"effect\", events);",
    replace:
      "      const done = drawToHand(state, ctx.seat, op.count, \"effect\", events);\n      const drawn = done.players[ctx.seat].deck.slice(0, Math.max(op.count, 0));",
    expectKilledBy: ["packages/engine/src/runAwayDraw.test.ts"],
  },
  {
    id: "D311-draw-records-nothing",
    decision: "D311",
    what: "the draw stops filing anything, so §9.2's slot is always empty and the `recordGate` behind it NEVER fires -- Dudunsparce draws three cards every turn and never leaves the board, which is a strictly better card than the one printed. The LOUD direction of the row above, and the shape of a build that threaded the field and forgot to write it",
    file: "packages/engine/src/interpreter.ts",
    find: "      recordMoved(record, op.recordAs, drawn);\n      return { done };",
    replace: "      return { done };",
    expectKilledBy: ["packages/engine/src/runAwayDraw.test.ts"],
  },
  {
    id: "D311-registry-invents-abras-active-clause",
    decision: "D311",
    what: "the row authors `activeOnly: true`. ⚠️ THE FIDELITY ROW, and the tempting one: Abra `sv06-080` prints EXACTLY this removal WITH the Active-Spot clause, so an author who read the family rather than the card would add it -- and it makes the whole promotion seam unnecessary, which is precisely the argument that would justify it. Dudunsparce prints no such clause, and a benched one may run away",
    file: "packages/engine/src/registry.ts",
    find: "      name: \"Run Away Draw\",\n      oncePerTurn: true,\n      activeOnly: false,",
    replace: "      name: \"Run Away Draw\",\n      oncePerTurn: true,\n      activeOnly: true,",
    expectKilledBy: ["packages/engine/src/runAwayDraw.test.ts"],
  },
  {
    id: "D311-registry-drops-the-in-this-way-gate",
    decision: "D311",
    what: "the `recordGate` is unwrapped and the self-removal runs unconditionally. The card is right on every board with a deck and wrong on the one board the printed conditional exists for: an EMPTY deck draws nothing and the Dudunsparce shuffles itself away anyway -- often into a §14.2 loss it should never have taken. The clause reads like decoration and is not",
    file: "packages/engine/src/registry.ts",
    find: "        { op: \"recordGate\", slot: \"moved\", then: [{ op: \"returnSelf\", dest: \"deck\" }] },",
    replace: "        { op: \"returnSelf\", dest: \"deck\" },",
    expectKilledBy: ["packages/engine/src/runAwayDraw.test.ts"],
  },
  {
    id: "D311-registry-shares-the-once-per-turn-by-name",
    decision: "D311",
    what: "`oncePerTurn` becomes `\"sharedByName\"`, so a second Dudunsparce on the same Bench cannot use its own Ability that turn. The printed limiter is the bare \"Once during your turn\" with NO \"you can't use more than 1 Run Away Draw Ability each turn\" rider -- the scope is the BODY, and this is the widening D272 wrote the second reading of that field for",
    file: "packages/engine/src/registry.ts",
    find: "      name: \"Run Away Draw\",\n      oncePerTurn: true,",
    replace: "      name: \"Run Away Draw\",\n      oncePerTurn: \"sharedByName\",",
    expectKilledBy: ["packages/engine/src/runAwayDraw.test.ts"],
  },

  // ── D312 — the SELF-removal family's ABILITY half CLOSED (Abra `sv06-080`
  //    "Teleporter") and its ATTACK half OPENED (Gholdengo `sv08-131` idx 1
  //    "Surf Back"), behind the §8.1 promotion seam at its SECOND site. TEN rows
  //    on the three pieces: the seam in `finishAttack`, the two registry rows,
  //    and the ORDER that makes the seam §8.1 rather than merely present.
  {
    id: "D312-attack-empties-the-spot-and-nothing-promotes",
    decision: "D312",
    what: "🛑 THE SLICE'S WHOLE SEAM AT THE SECOND SITE, DELETED. `finishAttack` goes back to splicing only the KO batch's stages, so a Gholdengo that shuffles itself away ends the turn with its own Active Spot EMPTY and hands the opponent a board with nothing standing on it. This is the tree as it stood after D311 -- which is the point: D311's seam is in `resolveMidTurnKnockOuts` and the attack path never goes through it, so the ability suite stays green while every attack printing of the same sentence is broken",
    file: "packages/engine/src/flow.ts",
    find: "    ...batch.stages,\n    ...orphaned,\n    ...turnTail(attackerSeat),",
    replace: "    ...batch.stages,\n    ...turnTail(attackerSeat),",
    expectKilledBy: ["packages/engine/src/surfBack.test.ts"],
  },
  {
    id: "D312-promotion-is-queued-behind-the-turn-tail",
    decision: "D312",
    what: "⚠️ THE ROW THAT IS THE WHOLE DIFFERENCE BETWEEN THE TWO SITES. The promotion stages are spliced BEHIND `turnTail` instead of in front of it, so the turn ends, the Checkup runs and the opponent's turn STARTS -- all against an empty Active Spot -- and only then is the promotion asked for. Every other assertion about the seam still passes: the stage is queued, the spot is refilled, the game does not hang. Only the ORDER is wrong, and §8.1 is entirely about the order",
    file: "packages/engine/src/flow.ts",
    find: "    ...batch.stages,\n    ...orphaned,\n    ...turnTail(attackerSeat),",
    replace: "    ...batch.stages,\n    ...turnTail(attackerSeat),\n    ...orphaned,",
    expectKilledBy: ["packages/engine/src/surfBack.test.ts"],
  },
  {
    id: "D312-attack-seam-drops-the-ko-dedup",
    decision: "D312",
    what: "the dedup drops out of the SECOND site's filter, so a seat the KO batch already queued a promotion for takes a second one. ⚠️ THIS SITE IS WHERE THAT ACTUALLY BITES, unlike D311's: an attack routinely empties BOTH Active Spots at once -- the defender by Knock Out and the attacker by `returnSelf` -- so the double-queue is not a rare board here, it is the board Gholdengo is printed to make",
    file: "packages/engine/src/flow.ts",
    find: "        batch.state.players[seat].active === null &&\n        !batch.stages.some((stage) => stage.kind === \"promote\" && stage.seat === seat),\n    )\n    .map((seat) => ({ kind: \"promote\", seat }));\n  // §5.3 — attacking ends the turn",
    replace: "        batch.state.players[seat].active === null,\n    )\n    .map((seat) => ({ kind: \"promote\", seat }));\n  // §5.3 — attacking ends the turn",
    expectKilledBy: ["packages/engine/src/surfBack.test.ts"],
  },
  {
    id: "D312-attack-seam-scans-only-the-attacker",
    decision: "D312",
    what: "the second site's seat list narrows from `[defender, attacker]` to the attacker alone. Green on every board this slice drives EXCEPT the one where both spots empty -- and it is the narrowing an author makes on the true observation that only `returnSelf` can empty a spot without a KO and only the attacker can run one. The KO'd defender's own promotion comes from `collectKnockOuts`, so the bug is invisible until something else empties that side",
    file: "packages/engine/src/flow.ts",
    find: "  const orphaned: PendingStage[] = [otherSeat(attackerSeat), attackerSeat]",
    replace: "  const orphaned: PendingStage[] = [attackerSeat]",
    expectKilledBy: ["packages/engine/src/surfBack.test.ts"],
    survives: {
      kind: "unreachable-population",
      reason:
        "🛑 **DECLARED AFTER IT SURVIVED, AND THE ROW'S OWN `what` STRING PREDICTED IT IN ADVANCE** — *\"the bug is invisible until something else empties that side\"*. It was authored as a drivable row, SURVIVED the sweep, and the GREP that followed is the measurement rather than the author's opinion, which is D259's shape exactly. ⚠️ **EXACTLY TWO SITES IN THE WHOLE ENGINE CAN EMPTY AN IN-PLAY ACTIVE SPOT**, `grep -rn \"active: null\" packages/engine/src` at this commit, `setup.ts`'s game construction aside: (1) `knockOut` (flow.ts), which queues its OWN `{kind:\"promote\"}` stage in the same return — so a KO'd seat is ALWAYS named by `batch.stages` and the skip-term removes it from `orphaned` before the seat list is ever consulted; and (2) `returnSelf` (interpreter.ts), whose ref is `ctx.sourceRef` — the program's own body, which inside `finishAttack` is by definition on the ATTACKER's board. **So `otherSeat(attackerSeat)` cannot be in `orphaned` on any board that exists today, and narrowing the list is behaviour-identical.** KEPT FOR TOTALITY rather than deleted, for D259's reason verbatim: the superset is what makes a future op correct by construction instead of by a comment. 🛑 **THE DAY AN OP CAN EMPTY THE OPPONENT'S ACTIVE SPOT WITHOUT A KNOCK OUT** — a bounce-the-defender attack, or a `returnBenched` widened past its ref guard — **this row reports STALE-SURVIVOR and the seat list is already right.** ⚠️ AND NOTE WHICH HALF IS *NOT* DECLARED: the SKIP-TERM row (`D312-attack-seam-drops-the-ko-dedup`) is KILLED, because the both-spots-empty board it guards is reachable today — the defender by Knock Out and the attacker by `returnSelf`, which is exactly the board Gholdengo is printed to make.",
    },
  },
  {
    id: "D312-teleporter-drops-its-active-clause",
    decision: "D312",
    what: "⚠️ THE FIDELITY ROW, AND THE EXACT INVERSE OF D311's. Abra's row authors `activeOnly: false`, so a BENCHED Abra teleports -- which the printed \"if this Pokémon is in the Active Spot\" forbids. The two cards in this family are each other's control: Dudunsparce prints no clause and Abra prints one, so an author who copied the sibling row rather than reading the card produces exactly this, and the whole §8.1 promotion becomes optional rather than guaranteed",
    file: "packages/engine/src/registry.ts",
    find: "      name: \"Teleporter\",\n      oncePerTurn: true,\n      activeOnly: true,",
    replace: "      name: \"Teleporter\",\n      oncePerTurn: true,\n      activeOnly: false,",
    expectKilledBy: ["packages/engine/src/teleporter.test.ts"],
  },
  {
    id: "D312-teleporter-shares-the-once-per-turn-by-name",
    decision: "D312",
    what: "`oncePerTurn` becomes `\"sharedByName\"`, so a second Abra promoted into the spot cannot teleport on the same turn. The printed limiter is the bare \"Once during your turn\" with NO per-name rider -- the scope is the BODY -- and this card is where the widening is most tempting, because two Abra teleporting in one turn is two promotions and looks like a loop",
    file: "packages/engine/src/registry.ts",
    find: "      name: \"Teleporter\",\n      oncePerTurn: true,",
    replace: "      name: \"Teleporter\",\n      oncePerTurn: \"sharedByName\",",
    expectKilledBy: ["packages/engine/src/teleporter.test.ts"],
  },
  {
    id: "D312-teleporter-wraps-itself-in-an-optional",
    decision: "D312",
    what: "Abra's row gains the `optional` wrapper Gholdengo's row carries, so using the Ability asks the player to confirm the thing they just chose to do. ⚠️ THE PLAUSIBLE ONE: both cards print \"you may\", the two rows sit ten lines apart, and copying the wrapper across is the obvious tidy-up. It is wrong because §9 already makes declining an Ability free and §8 does not make declining an attack's rider free -- the asymmetry is the reason the field differs",
    file: "packages/engine/src/registry.ts",
    find: "      activeOnly: true,\n      program: [{ op: \"returnSelf\", dest: \"deck\" }],",
    replace: "      activeOnly: true,\n      program: [{ op: \"optional\", note: \"You may shuffle it and all attached cards into your deck.\", then: [{ op: \"returnSelf\", dest: \"deck\" }] }],",
    expectKilledBy: ["packages/engine/src/teleporter.test.ts"],
  },
  {
    id: "D312-surf-back-loses-its-optional",
    decision: "D312",
    what: "Gholdengo's row is unwrapped to a bare `returnSelf`, so \"You MAY shuffle this Pokémon\" becomes a mandatory self-removal. The attack still does its 100 and still Knocks the defender out, so it LOOKS right -- and it takes the attacker off the board against its controller's will, which on a Bench of none is an immediate §14.2 loss the card never licensed. The exact inverse of the row above, and the reason both exist",
    file: "packages/engine/src/registry.ts",
    find: "        op: \"optional\",\n        note: \"You may shuffle this Pokémon and all attached cards into your deck.\",",
    replace: "        op: \"switchActive\",\n        note: \"You may shuffle this Pokémon and all attached cards into your deck.\",",
    expectKilledBy: ["packages/engine/src/surfBack.test.ts"],
  },
  {
    id: "D312-surf-back-authors-the-wrong-attack-index",
    decision: "D312",
    what: "🛑 THE INDEX-PRECISION ROW. Gholdengo's program moves from index 1 to index 0, so \"Strike It Rich\" (an evolved-this-turn damage conditional this engine does not read) inherits the self-removal and \"Surf Back\" falls back to unsimulated. D187 lost a whole intermediate result to exactly this mistake, and it is the FIRST registry attack in the table that is not at index 0 -- so the census rung that used to assume index 0 was rewritten by this slice to catch it",
    file: "packages/engine/src/registry.ts",
    find: "const SURF_BACK: CardProgram = {\n  attack: {\n    1: [",
    replace: "const SURF_BACK: CardProgram = {\n  attack: {\n    0: [",
    expectKilledBy: [
      "packages/engine/src/surfBack.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D312-surf-back-note-is-paraphrased",
    decision: "D312",
    what: "the prompt note is reworded to a plausible paraphrase (\"Shuffle this Pokémon into your deck?\"), which is what a prompt-writer produces when they write the question instead of transcribing the card. The `payFromHandNote` rule is that the op IS the whole clause so the note IS the whole clause -- and this paraphrase quietly drops \"and all attached cards\", which is the half of the sentence a player needs to see before answering",
    file: "packages/engine/src/registry.ts",
    find: "        note: \"You may shuffle this Pokémon and all attached cards into your deck.\",",
    replace: "        note: \"Shuffle this Pokémon into your deck?\",",
    expectKilledBy: ["packages/engine/src/surfBack.test.ts"],
  },

// ── D313 — the DESTINATION axis of `returnSelf`, authored over all four printed
  //    spellings at once (Team Rocket's Crobat ex ×4 SPLIT, Lillie's Comfey hand,
  //    Revavroom ex ×2 discard). THIRTEEN rows: the op's own partition and its
  //    v18 default, the two new fields at each registry site, the wrapper
  //    asymmetry, the index precision, and the two log branches.
  {
    id: "D313-split-discards-the-evolution-stack-too",
    decision: "D313",
    what: "🛑 THE ROW THE WHOLE SPLIT IS ABOUT. `attached` becomes the WHOLE pile (`stack` + `energy` + `tools`) instead of just what is attached, so \"(Discard all cards attached to this Pokémon.)\" discards the Golbat and the Zubat underneath the Crobat ex as well -- while the body pile still goes to the hand, so the same uids land in BOTH zones. ⚠️ IT IS INVISIBLE ON A BASIC: only a body with more than one card in its `stack` can tell the two readings apart, which is why §2 builds a three-card stack rather than attacking with the card as printed on a bench",
    file: "packages/engine/src/interpreter.ts",
    find: "  const attached = [...body.energy, ...body.tools];",
    replace: "  const attached = [...body.stack, ...body.energy, ...body.tools];",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-split-sends-the-body-nowhere",
    decision: "D313",
    what: "the SPLIT arm's body pile becomes empty, so the Crobat ex's own cards leave play and reach no zone at all -- the attachments are discarded correctly and the body simply vanishes. A plausible slip while extracting the two piles, and the one that makes a card disappear from the game rather than merely land in the wrong place",
    file: "packages/engine/src/interpreter.ts",
    find: "  const bodyPile = split ? [...body.stack] : uids;",
    replace: "  const bodyPile = split ? [] : uids;",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-bare-return-self-defaults-to-the-hand",
    decision: "D313",
    what: "🛑 THE v18 WIRE ROW, AND IT IS THE REASON `dest` IS OPTIONAL AT ALL. The absent-`dest` default flips from the deck to the hand, so a MATCH RECORD written by a version-18 deploy -- which can hold a bare `{op:\"returnSelf\"}` inside a parked `optional`, because Gholdengo's row is exactly that shape -- resumes by putting the body in its controller's HAND instead of shuffling it away. Every registry row spells its `dest`, so nothing this build authors can see it: the ONLY thing that can is the resumed record §6 reconstructs. **A silent misread of an older record is the condition `MATCH_RECORD_VERSION` exists for, and this row is the proof the skip is earned rather than assumed**",
    file: "packages/engine/src/interpreter.ts",
    find: "  const dest = op.dest ?? \"deck\";",
    replace: "  const dest = op.dest ?? \"hand\";",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-deck-arm-shuffles-even-with-nothing-to-shuffle",
    decision: "D313",
    what: "the empty-deck-pile guard goes, so a hand or discard destination still runs `shuffle` over the untouched deck and emits a SHUFFLE row. The board is byte-identical afterwards apart from the RNG state -- which is the point: it burns a draw off `rngState` and files a log row for a thing that did not happen, and the event contract's own rule is one event per thing that happened",
    file: "packages/engine/src/interpreter.ts",
    find: "  if (zones.deck.length === 0) return withSide(state, seat, placed);",
    replace: "  if (zones.deck.length === -1) return withSide(state, seat, placed);",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-crobat-loses-its-split",
    decision: "D313",
    what: "⚠️ THE FIDELITY ROW FOR THE FIELD THIS SLICE EXISTS TO AUTHOR. `attachmentsTo` drops off Crobat ex's row, so the attachments follow the body into the HAND -- which is Lillie's Comfey's printing, on a card that prints a parenthetical saying the opposite. It is the shape an author produces by writing the first clause and treating the bracket as a reminder rather than as a rule",
    file: "packages/engine/src/registry.ts",
    find: "        then: [{ op: \"returnSelf\", dest: \"hand\", attachmentsTo: \"discard\" }],",
    replace: "        then: [{ op: \"returnSelf\", dest: \"hand\" }],",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-crobat-discards-itself-as-well",
    decision: "D313",
    what: "Crobat ex's `dest` flips from the hand to the discard, so the printed \"You may put this Pokémon into your hand\" throws the card away instead of returning it. The attachments still go to the discard, so the log row and the event both still mention a discard and it reads plausible -- and the card is a 310 HP Stage 2 whose whole point is coming back",
    file: "packages/engine/src/registry.ts",
    find: "        then: [{ op: \"returnSelf\", dest: \"hand\", attachmentsTo: \"discard\" }],",
    replace: "        then: [{ op: \"returnSelf\", dest: \"discard\", attachmentsTo: \"discard\" }],",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-comfey-gains-the-split",
    decision: "D313",
    what: "🛑 THE INVERSE OF THE TWO ABOVE, AND THE HALF THAT MAKES THEM MEAN SOMETHING. Comfey's row gains `attachmentsTo: \"discard\"`, so \"Put this Pokémon **and all attached cards** into your hand\" discards the Energy it should return. Without this row a suite could assert \"the attachments went somewhere\" and pass on either reading of the field; with it, the field has to be read the same way twice on two cards that print it differently",
    file: "packages/engine/src/registry.ts",
    find: "    1: [{ op: \"returnSelf\", dest: \"hand\" }],",
    replace: "    1: [{ op: \"returnSelf\", dest: \"hand\", attachmentsTo: \"discard\" }],",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-revavroom-shuffles-instead-of-discarding",
    decision: "D313",
    what: "Revavroom ex's `dest` becomes the deck, so \"Discard this Pokémon and all attached cards\" shuffles a 250-damage attacker back into its own deck to be drawn again. THE THIRD ZONE is the whole reason this row exists in the family, and the deck is the value every other member of the enum carried before this slice -- so it is the value an author reaches for when copying a neighbouring row",
    file: "packages/engine/src/registry.ts",
    find: "    1: [{ op: \"returnSelf\", dest: \"discard\" }],",
    replace: "    1: [{ op: \"returnSelf\", dest: \"deck\" }],",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-revavroom-authors-the-wrong-attack-index",
    decision: "D313",
    what: "🛑 THE INDEX-PRECISION ROW, D187's inflated intermediate result in miniature. Revavroom ex's program moves to index 0, so \"Accelerator Flash\" -- a moved-from-the-Bench-this-turn conditional this engine cannot read -- inherits the self-discard and \"Shattering Speed\" falls back to unsimulated. Two of this slice's three rows sit at index 1 and one at index 0, so an author has no house habit to fall back on and must read each card",
    file: "packages/engine/src/registry.ts",
    find: "const SHATTERING_SPEED: CardProgram = {\n  attack: {\n    1: [",
    replace: "const SHATTERING_SPEED: CardProgram = {\n  attack: {\n    0: [",
    expectKilledBy: [
      "packages/engine/src/assassinsReturn.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D313-crobat-loses-its-optional",
    decision: "D313",
    what: "the `optional` wrapper comes off Crobat ex's row, so the printed \"You MAY put this Pokémon into your hand\" becomes compulsory -- the card deals its 120 and then bounces itself whether its controller wants it to or not, which on a Bench of none is an immediate §14.2 loss the card never licensed. ⚠️ THE PLAUSIBLE VERSION: the two rows beside it (Comfey, Revavroom ex) are BARE, so the wrapper looks like the odd one out until the three printed sentences are read side by side",
    file: "packages/engine/src/registry.ts",
    find: "        op: \"optional\",\n        note: \"You may put this Pokémon into your hand.",
    replace: "        op: \"switchActive\",\n        note: \"You may put this Pokémon into your hand.",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-comfey-gains-an-optional",
    decision: "D313",
    what: "the exact inverse: Comfey's compulsory bounce gains Crobat ex's wrapper, so a card that prints no \"you may\" asks its controller to confirm. The board it produces is legal and the prompt reads fine -- which is why the row exists: the ONLY thing wrong with it is that the sentence does not say it, and a suite that never checks for the ABSENCE of a park cannot tell",
    file: "packages/engine/src/registry.ts",
    find: "    1: [{ op: \"returnSelf\", dest: \"hand\" }],",
    replace: "    1: [{ op: \"optional\", note: \"Put this Pokémon and all attached cards into your hand.\", then: [{ op: \"returnSelf\", dest: \"hand\" }] }],",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-crobat-note-drops-the-parenthetical",
    decision: "D313",
    what: "the prompt note keeps the first sentence and loses \"(Discard all cards attached to this Pokémon.)\" -- which is the half a player needs before answering, because it is the half that costs them their Energy. The `payFromHandNote` rule is that the op IS the whole clause so the note IS the whole clause, and a bracket is the easiest thing in a printed sentence to read as decoration",
    file: "packages/engine/src/registry.ts",
    find: "        note: \"You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)\",",
    replace: "        note: \"You may put this Pokémon into your hand.\",",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-teleporter-stops-spelling-its-dest",
    decision: "D313",
    what: "🛑 THE CONVERSE GUARD'S OWN ROW. Abra's registry row drops `dest: \"deck\"` and falls back on the wire default. It is BEHAVIOUR-IDENTICAL -- the default is the deck and the deck is what the card prints -- so nothing about the board changes, and that is exactly the point: `dest` is optional in the TYPE for one reason (a v18 record can arrive without it) and this row is what stops that reason from becoming an authoring habit. §6 asserts no registry `returnSelf` is spelled bare",
    file: "packages/engine/src/registry.ts",
    find: "      program: [{ op: \"returnSelf\", dest: \"deck\" }],",
    replace: "      program: [{ op: \"returnSelf\" }],",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-split-log-row-counts-the-whole-pile",
    decision: "D313",
    what: "the SPLIT log row counts `uids.length - 1` -- every other card that left play -- instead of the attachments actually discarded, so a Crobat ex with two cards under it and three attachments reads \"discarded 5 attached cards\" when three were discarded and two went to the hand. The two branches of this row count DIFFERENT things and the wrong one is the one already written three lines below",
    file: "packages/engine/src/log.ts",
    find: "        const n = split.uids.length;",
    replace: "        const n = event.uids.length - 1;",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },
  {
    id: "D313-log-reads-the-discard-zone-as-a-field-value",
    decision: "D313",
    what: "the log names the third zone \"discard\" instead of \"discard pile\", so the row reads \"put X into P1's discard\" -- the field value read out loud rather than the zone's name in §2. The smallest row in this slice and the one most likely to be dismissed as copy: it is the difference between a log written for a player and a log written for the reducer",
    file: "packages/engine/src/log.ts",
    find: "      const zone = event.dest === \"discard\" ? \"discard pile\" : event.dest;",
    replace: "      const zone = event.dest;",
    expectKilledBy: ["packages/engine/src/assassinsReturn.test.ts"],
  },

  // ── D314 — Eldegoss `sv07-011` "Breezy Gift", a registry row of THREE EXISTING
  //    OPS. NINE rows: the field the handoff priced and this row refuses, the two
  //    orderings the three ops can be got wrong in, and the five fidelity rows on
  //    the search itself.
  {
    id: "D314-breezy-gift-spends-the-recordgate-the-handoff-priced",
    decision: "D314",
    what: "🛑 THE HEADLINE ROW, AND IT IS A REFUSAL MADE LOAD-BEARING. The program is rewritten the way THREE handoffs priced it -- `returnSelf` gains a `recordAs` and the tail moves inside a `recordGate` on that slot, the printed \"If you do\" read as §9.2 -- and the card then does NOTHING but shuffle itself away: `returnSelf` files nothing under any slot (it has no `recordAs` and never calls `recordMoved`), `recorded()` answers `[]` for a missing key and `recordGateHolds` asks the LENGTH, so the gate is FALSE on every board and the search never runs. ⚠️ **THIS IS THE ROW THAT MAKES \"NO FIELD IS OWED\" A MEASUREMENT INSTEAD OF AN OPINION**: the field the handoff wanted is not merely unnecessary, it is the one edit that silently deletes half the printed sentence -- and it type-checks nowhere and runs everywhere, which is exactly the class `tsc` cannot catch in a registry literal",
    file: "packages/engine/src/registry.ts",
    find: "      { op: \"returnSelf\", dest: \"deck\" },\n      { op: \"searchDeck\", filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3 },\n      { op: \"shuffleDeck\" },",
    replace: "      { op: \"returnSelf\", dest: \"deck\", recordAs: \"moved\" },\n      { op: \"recordGate\", slot: \"moved\", then: [{ op: \"searchDeck\", filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3 }, { op: \"shuffleDeck\" }] },",
    expectKilledBy: ["packages/engine/src/breezyGift.test.ts"],
  },
  {
    id: "D314-breezy-gift-searches-before-it-returns",
    decision: "D314",
    what: "🛑 THE ORDER OF THE TWO CLAUSES, AND THE ONE THING THE OP ORDER BUYS. The search moves in FRONT of the removal, so the deck it scans is the deck BEFORE this Pokémon and its attachments were put into it -- the printed sentence reversed. On an ordinary board it looks almost right (three cards still reach the hand); on the board this suite drives it is fatal, because a deck that was EMPTY at declaration has no candidates at all and `searchDeck` takes its silent zero-candidate ending instead of parking. **The op order is what makes that ending unreachable, and reachability is not a property a shape assertion can see**",
    file: "packages/engine/src/registry.ts",
    find: "      { op: \"returnSelf\", dest: \"deck\" },\n      { op: \"searchDeck\", filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3 },",
    replace: "      { op: \"searchDeck\", filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3 },\n      { op: \"returnSelf\", dest: \"deck\" },",
    expectKilledBy: ["packages/engine/src/breezyGift.test.ts"],
  },
  {
    id: "D314-breezy-gift-shuffles-before-it-searches",
    decision: "D314",
    what: "the printed \"Then, shuffle your deck.\" moves in FRONT of the search, so the deck is randomised and THEN read -- which leaves the player holding the order of every card they just looked through. ⚠️ THE BOARD IS IDENTICAL AFTERWARDS AND ONLY THE INFORMATION DIFFERS, which is the whole reason this sentence prints a trailing shuffle at all: a search that is not followed by one is a permanent read of the deck's order",
    file: "packages/engine/src/registry.ts",
    find: "      { op: \"searchDeck\", filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3 },\n      { op: \"shuffleDeck\" },",
    replace: "      { op: \"shuffleDeck\" },\n      { op: \"searchDeck\", filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3 },",
    expectKilledBy: ["packages/engine/src/breezyGift.test.ts"],
  },
  {
    id: "D314-breezy-gift-drops-its-trailing-shuffle",
    decision: "D314",
    what: "the trailing `shuffleDeck` goes entirely, on the reasonable-sounding ground that `returnSelf`'s deck arm ALREADY shuffled one op earlier -- which is true, and which is exactly the trap. That shuffle happened BEFORE the player read the deck; the printed one happens after. ⚠️ **THE TWO SHUFFLES THIS PROGRAM EMITS ARE NOT REDUNDANT AND THIS ROW IS THE PROOF**, which is why the suite pins the count on BOTH sides of the park rather than in total",
    file: "packages/engine/src/registry.ts",
    find: "      { op: \"searchDeck\", filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3 },\n      { op: \"shuffleDeck\" },\n    ],",
    replace: "      { op: \"searchDeck\", filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3 },\n    ],",
    expectKilledBy: ["packages/engine/src/breezyGift.test.ts"],
  },
  {
    id: "D314-breezy-gift-returns-to-the-hand-instead-of-the-deck",
    decision: "D314",
    what: "the `dest` flips to the hand, so \"Put this Pokémon and all attached cards into your DECK\" returns the card to its controller instead -- Lillie's Comfey's printing on a card that prints the other zone. The second clause still reads plausibly (a search into the hand follows either way), and the DESTINATION axis has four printed spellings, so a neighbouring row is the obvious thing to copy",
    file: "packages/engine/src/registry.ts",
    find: "      { op: \"returnSelf\", dest: \"deck\" },\n      { op: \"searchDeck\",",
    replace: "      { op: \"returnSelf\", dest: \"hand\" },\n      { op: \"searchDeck\",",
    expectKilledBy: ["packages/engine/src/breezyGift.test.ts"],
  },
  {
    id: "D314-breezy-gift-searches-for-a-pokemon",
    decision: "D314",
    what: "the filter narrows from `anyCard` to `anyPokemon`, so \"search your deck for up to 3 CARDS\" refuses Energy and Trainers. ⚠️ IT IS ALSO THE MEMBER THE `reveal` RIDER RIDES ON: `anyCard` is the only no-reveal group in the whole to-hand search family, so a build that reached for the Pokémon filter here would be one step from captioning DECK_SEARCHED with cards this sentence never shows",
    file: "packages/engine/src/registry.ts",
    find: "      { op: \"searchDeck\", filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3 },",
    replace: "      { op: \"searchDeck\", filter: { kind: \"anyPokemon\" }, dest: \"hand\", max: 3 },",
    expectKilledBy: ["packages/engine/src/breezyGift.test.ts"],
  },
  {
    id: "D314-breezy-gift-takes-only-one-card",
    decision: "D314",
    what: "the printed \"up to 3\" becomes \"up to 1\", the number every other no-reveal printing of this family happens to carry. `min` is 0 either way so nothing is refused at the prompt and the decline still works -- the only observable difference is the ceiling, which is the entire value of the attack",
    file: "packages/engine/src/registry.ts",
    find: "dest: \"hand\", max: 3 },\n      { op: \"shuffleDeck\" },",
    replace: "dest: \"hand\", max: 1 },\n      { op: \"shuffleDeck\" },",
    expectKilledBy: ["packages/engine/src/breezyGift.test.ts"],
  },
  {
    id: "D314-breezy-gift-reveals-what-it-finds",
    decision: "D314",
    what: "the row gains `reveal: true`, so a sentence that prints NO reveal clause names all three cards in the log to an opponent who is not entitled to see them. ⚠️ D225's measurement is what makes this a rule rather than a preference -- every no-reveal printing in the catalog searches for uncategorised \"cards\", and this is one of them -- and D135's ABSENT-is-never-`false` rule is what makes the mutation an ADDITION rather than a flip",
    file: "packages/engine/src/registry.ts",
    find: "filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3 },",
    replace: "filter: { kind: \"anyCard\" }, dest: \"hand\", max: 3, reveal: true },",
    expectKilledBy: ["packages/engine/src/breezyGift.test.ts"],
  },
  {
    id: "D314-breezy-gift-authors-the-wrong-attack-index",
    decision: "D314",
    what: "🛑 THE INDEX-PRECISION ROW, D187's inflated intermediate result at its fourth site. The program moves to index 1, so \"Leafage\" -- `damage: 50` with NO `effect` key at all -- inherits the whole compound and \"Breezy Gift\" falls back to unsimulated. ⚠️ IT ALSO MOVES A CENSUS NUMBER WITHOUT MOVING A PRINTING: the card still carries a registry attack at SOME index, so the \"some index\" lookup D312 installed stays green and only the per-card pins can tell",
    file: "packages/engine/src/registry.ts",
    find: "  attack: {\n    0: [\n      { op: \"returnSelf\", dest: \"deck\" },",
    replace: "  attack: {\n    1: [\n      { op: \"returnSelf\", dest: \"deck\" },",
    expectKilledBy: ["packages/engine/src/breezyGift.test.ts"],
  },

  // ── 🆕 D317 - "...this attack does {N} more damage, and {consequent}" - the NINTH
  //    attack-text reader and `coinFlipGate.otherwise`'s first producer. Every row
  //    below is either A WRONG NUMBER ON A HIT THAT STILL HAPPENS (this family's
  //    whole failure surface, inherited from D316: the sentence prints two outcomes
  //    and BOTH of them deal damage) or A SILENT REFUSAL of a sentence that used to
  //    resolve - and the second kind is the one a green suite hides best.
  {
    id: "D317-yes-arm-loses-the-bonus",
    decision: "D317",
    what: "the accepted arm deals the bare printed base - the printed \"more damage\" bought nothing, on BOTH deciders at once because the assembler is shared",
    file: "packages/engine/src/effects.ts",
    // 🆕 RE-POINTED AT D318 into the SHARED `boostedArms` - see that helper's doc
    // block for why the sharing happened and what `precheck` said about it.
    find: "    [{ op: \"damageDefender\", amount: base + bonus }, ...ops],",
    replace: "    [{ op: \"damageDefender\", amount: base }, ...ops],",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-decline-arm-takes-the-bonus",
    decision: "D317",
    what: "the DECLINE arm deals base + bonus - the two arms copied from each other, which is the mistake this shape invites and the one D316's twin row also names",
    file: "packages/engine/src/effects.ts",
    // 🆕 RE-POINTED AT D318 into the SHARED `boostedArms`.
    find: "    [{ op: \"damageDefender\", amount: base }],",
    replace: "    [{ op: \"damageDefender\", amount: base + bonus }],",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-decline-arm-deals-nothing",
    decision: "D317",
    what: "🛑 THE ROW THIS SLICE EXISTS FOR: the losing arm splices NOTHING, which with the base suppressed by `scaledBase` deals ZERO on an un-evolved Active and ZERO on tails - two printings whose printed no still hits for 140 and 30",
    file: "packages/engine/src/effects.ts",
    // 🆕 RE-POINTED AT D318 into the SHARED `boostedArms`.
    find: "    [{ op: \"damageDefender\", amount: base }],",
    replace: "    [],",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-consequent-dropped",
    decision: "D317",
    what: "the accepted arm deals the boosted damage and runs NO consequent - an attack whose printed cost silently vanished (Ogerpon keeps its Energy, Floragato heals nothing)",
    file: "packages/engine/src/effects.ts",
    // 🆕 RE-POINTED AT D318 into the SHARED `boostedArms`, and it stopped being a
    // MULTI-LINE find in the process - the adjacency claim that cost D317 three
    // rows is gone because the arm is one line there.
    find: "    [{ op: \"damageDefender\", amount: base + bonus }, ...ops],",
    replace: "    [{ op: \"damageDefender\", amount: base + bonus }],",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-coin-gate-reads-the-losing-face",
    decision: "D317",
    what: "the coin gate gains `onTails: true`, so the bonus AND the heal both ride the wrong face - D144's real field, copied onto a sentence that prints \"If heads\"",
    file: "packages/engine/src/effects.ts",
    find: "        { op: \"coinFlipGate\", then, otherwise },",
    replace: "        { op: \"coinFlipGate\", then, otherwise, onTails: true },",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-decider-collapsed-to-the-condition",
    decision: "D317",
    what: "the assembler ignores the decider and always builds a `conditionGate` - Floragato's coin becomes a board read, which is route 2's failure mode reached from the other end",
    file: "packages/engine/src/effects.ts",
    find: "  return reading.decider.kind === \"coinFlip\"",
    replace: "  return false",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-base-not-dropped",
    decision: "D317",
    what: "the reader stops claiming the printed base, so it lands pre-program AND again inside the gate - the double hit effects.ts refuses, on both arms",
    file: "packages/engine/src/attack.ts",
    find: "    bonusConsequent !== null ||\n    coinFlip?.kind === \"perHeads\"",
    replace: "    coinFlip?.kind === \"perHeads\"",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-modifier-unclaimed",
    decision: "D317",
    what: "the printed \"+\" is left unexplained, so all six printings keep a loud ATTACK_EFFECT_SKIPPED for a modifier the engine has just spent (D126's term, one reader further on)",
    file: "packages/engine/src/attack.ts",
    find: "    bonusConsequent !== null ||\n    coinExplainsModifier;",
    replace: "    coinExplainsModifier;",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-effect-unclaimed",
    decision: "D317",
    what: "the sentence is left unexplained, so the whole printed effect is loudly skipped although it was read completely",
    file: "packages/engine/src/attack.ts",
    find: "    bonusConsequent !== null ||\n    damageSuppression !== null;",
    replace: "    damageSuppression !== null;",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-program-assigned-not-appended",
    decision: "D317",
    what: "the gate REPLACES the attack's program instead of being appended to it - D130's rule dropped, and an authored row on the same attack would be silently discarded",
    file: "packages/engine/src/attack.ts",
    find: "    program = [...(program ?? []), ...bonusConsequentProgram(bonusConsequent, base)];",
    replace: "    program = bonusConsequentProgram(bonusConsequent, base);",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
    survives: {
      kind: "unreachable-population",
      reason:
        "🛑 FOUND BY THE `--decision D317` PROBE IN 43 SECONDS, NOT BY THE 33-MINUTE SWEEP. The APPEND rule (D130) is real and correct, and it is UNREACHABLE ON TODAY'S CATALOG: for all six printings `program` is always null at this line, because the derivers are whole-sentence anchored (so a sentence this reader claims is one `deriveAttackEffect` refused) and `programFor` is undefined for all six ids. Assignment and append are therefore behaviour-identical on every board a printing can build, and no test can tell them apart. ⚠️ DECLARED RATHER THAN DELETED, WHICH IS WHERE THIS DIVERGES FROM D316: that slice hit the identical mutant on its own append rule and chose not to author the row at all, reading conventions.md's 'an unreachable survivor is REMOVED, not tested around'. But that clause is about a DEAD GUARD, and the clause below it provides `survives` for exactly the correct-and-unreachable case — which this is. The declaration is also a live tripwire the deletion would not be: the day a registry row names Ogerpon or Floragato, or a reader starts producing a program beside this one, this mutant becomes KILLABLE and the run reports STALE-SURVIVOR by name. **D316's twin row is arguably owed the same treatment, and that is a named backlog item rather than a silent divergence.**",
    },
  },
  {
    id: "D317-heal-amount-pinned",
    decision: "D317",
    what: "the heal consequent pins Floragato's printed 30 instead of capturing - green on the one legal printing and wrong on any reprint, the literal FLIP_TAILS_SELF_DAMAGE refused for the same reason",
    file: "packages/engine/src/effects.ts",
    find: "    return amount >= 1 ? [{ op: \"heal\", target: \"self\", amount }] : null;",
    replace: "    return amount >= 1 ? [{ op: \"heal\", target: \"self\", amount: 30 }] : null;",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-zero-heal-admitted",
    decision: "D317",
    what: "a printed 0 heal derives to a silent no-op inside a gate that still deals the bonus - the `>= 1` guard every captured amount in this family carries, dropped at the new capture",
    file: "packages/engine/src/effects.ts",
    find: "    return amount >= 1 ? [{ op: \"heal\", target: \"self\", amount }] : null;",
    replace: "    return [{ op: \"heal\", target: \"self\", amount }];",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-zero-bonus-admitted-on-the-coin-arm",
    decision: "D317",
    what: "a printed 0 bonus derives to a coin flip with no stake - the same guard as D316's row, at the arm that carries it TWICE, and this row drives the copy the condition arm's row cannot reach",
    file: "packages/engine/src/effects.ts",
    find: "    const bonus = Number(coin[1]);\n    // A printed 0 adds nothing",
    replace: "    const bonus = Number(coin[1]) + 1;\n    // A printed 0 adds nothing",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-discard-count-dropped",
    decision: "D317",
    what: "the printed \"discard ALL Energy\" becomes a single-Energy discard - `discardEnergy`'s own default, and a board with three Fire attached is what tells them apart",
    file: "packages/engine/src/effects.ts",
    find: "    return [{ op: \"discardEnergy\", from: \"yourActive\", filter: { kind: \"anyEnergy\" }, count: \"all\" }];",
    replace: "    return [{ op: \"discardEnergy\", from: \"yourActive\", filter: { kind: \"anyEnergy\" } }];",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-consequent-verb-capitalised",
    decision: "D317",
    what: "the heal consequent's anchor spells the BARE sentence's capital - D246's rule inverted, and no printed consequent would ever match",
    file: "packages/engine/src/effects.ts",
    find: "const CONSEQUENT_HEAL_SELF = /^heal (\\d+) damage from this Pokémon\\.$/;",
    replace: "const CONSEQUENT_HEAL_SELF = /^Heal (\\d+) damage from this Pokémon\\.$/;",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-unknown-consequent-claimed",
    decision: "D317",
    what: "an unrecognised consequent derives the BONUS with no consequent at all - the prefix match the family's safety property forbids, and strictly worse than not reading the sentence",
    file: "packages/engine/src/effects.ts",
    find: "  const heal = CONSEQUENT_HEAL_SELF.exec(consequent);\n  if (heal !== null) {",
    replace: "  if (!CONSEQUENT_HEAL_SELF.test(consequent)) return [];\n  const heal = CONSEQUENT_HEAL_SELF.exec(consequent);\n  if (heal !== null) {",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },
  {
    id: "D317-condition-anchor-tried-first",
    decision: "D317",
    what: "🛑 THE ORDERING ROW. The condition anchor is consulted BEFORE the coin one, so `^If (.+)` claims \"heads\" out of Floragato's second clause, hands it to `boardConditionForClause`, gets null and REFUSES the whole sentence. A SILENT LOSS rather than a wrong answer, which is the failure mode the order exists to prevent",
    file: "packages/engine/src/effects.ts",
    find: "  const coin = BONUS_CONSEQUENT_COIN.exec(effect);",
    replace: "  const coin = BONUS_CONSEQUENT_CONDITION.exec(effect);",
    expectKilledBy: ["packages/engine/src/bonusConsequent.test.ts"],
  },

  // ── D318 - THE PROSE GUARD OVER `docs/progress.md`, AND THE FIRST MUTANTS IN
  //    THIS CORPUS WHOSE TARGET IS NOT SOURCE CODE.
  //
  //    🛑 WHY THEY BELONG HERE. `progress.md` is the most-trusted text in the repo
  //    and until D318 nothing executable read it: D316 shipped a commit claiming a
  //    session-log entry it never wrote, #219 and #220 went missing for 38
  //    sessions, and D317's docs commit range-deleted 2,014 lines of archived
  //    resume points - `bun run check` was GREEN through all three. A guard over
  //    prose is exactly the class conventions.md says must be able to go RED, and
  //    the only way to establish that is to break the page on purpose.
  //
  //    ⚠️ EVERY ANCHOR BELOW IS A STRUCTURAL LANDMARK THAT DOES NOT MOVE FROM
  //    SESSION TO SESSION - the `## Session log` heading, the `**Last updated:**`
  //    prefix, the `| simulator | P3 |` cell, the `## NEXT (resume point)` heading,
  //    the #221 gap declaration and the OLDEST log entry. Anchoring on this
  //    session's own numbers would have bought seven rows that need re-pointing
  //    every slice, which is a maintenance tax the engine-version row already
  //    charges once and should not charge eight times.
  {
    id: "D318-newest-log-entry-demoted",
    decision: "D318",
    what: "🛑 D316's ACTUAL FAILURE, REPRODUCED: the newest session-log entry stops being a `###` heading, so the page's newest entry is the one BEFORE it and the header stamp names a session the log does not hold. This is the mutation the whole guard exists for, and the anchor is the `## Session log` heading rather than this slice's own entry",
    file: "docs/progress.md",
    find: "## Session log\n\n### ",
    replace: "## Session log\n\n#### ",
    expectKilledBy: ["packages/engine/src/progressLog.test.ts"],
  },
  {
    id: "D318-header-stamp-superseded",
    decision: "D318",
    what: "the live header stamp is spelled like an ARCHIVED one (`**Last updated (was):**`), so no stamp is found at all - the direction in which the equality would otherwise pass vacuously",
    file: "docs/progress.md",
    // ⚠️ ANCHORED ON THE INTRO BLOCKQUOTE ABOVE IT, because `**Last updated:**`
    // ALONE OCCURS FOUR TIMES: three stamps from #195/#196/#200 were never
    // converted to the `(was)` spelling when they were superseded, which
    // `precheck` reported as `4×` the moment this row was written. The guard reads
    // the FIRST occurrence and now asserts it sits in the page's first ten lines.
    find: "the next concrete action.\n\n**Last updated:** ",
    replace: "the next concrete action.\n\n**Last updated (was):** ",
    expectKilledBy: ["packages/engine/src/progressLog.test.ts"],
  },
  {
    id: "D318-gap-declaration-deleted",
    decision: "D318",
    what: "🛑 THE EXEMPTION ROW. The page's own declaration of the #219/#220 hole stops being findable, and the two entries it covers become undeclared gaps. This is what makes the exemption live in the PAGE rather than in the test: deleting the prose is what fails, and no edit to the test can pay for it",
    file: "docs/progress.md",
    find: "**THE LOG BELOW SKIPS #219 AND #220.**",
    replace: "**THE LOG BELOW OMITS #219 AND #220 ON PURPOSE.**",
    expectKilledBy: ["packages/engine/src/progressLog.test.ts"],
  },
  {
    id: "D318-declared-gap-is-not-a-gap",
    decision: "D318",
    what: "the declaration names a THIRD session that is NOT missing - the other direction, and the one an allowlist never checks. A declaration that has stopped being true must fail as loudly as an undeclared hole (D150's totality rule, applied to prose)",
    file: "docs/progress.md",
    find: "**THE LOG BELOW SKIPS #219 AND #220.**",
    replace: "**THE LOG BELOW SKIPS #219, #220 AND #221.**",
    expectKilledBy: ["packages/engine/src/progressLog.test.ts"],
  },
  {
    id: "D318-log-numbering-duplicated",
    decision: "D318",
    what: "the OLDEST log entry takes its neighbour's number, so the log holds a duplicate - the defect a strictly-descending scan catches and a bare `newest === stamp` equality never would",
    file: "docs/progress.md",
    find: "### 2026-08-07 — build session #213 (",
    replace: "### 2026-08-07 — build session #214 (",
    expectKilledBy: ["packages/engine/src/progressLog.test.ts"],
  },
  {
    id: "D318-status-row-renamed",
    decision: "D318",
    what: "the live simulator status row stops being findable, so nothing checks that the status table names the session the log just recorded. D284 and D287 EACH shipped without moving this row and the page records both episodes in strikethrough; neither was caught by anything",
    file: "docs/progress.md",
    find: "| simulator | P3 | ",
    replace: "| simulator | P3-M5 | ",
    expectKilledBy: ["packages/engine/src/progressLog.test.ts"],
  },
  {
    id: "D318-archive-heading-demoted",
    decision: "D318",
    what: "🛑 D317's THIRD FAILURE IN MINIATURE: one archived resume point stops being a `### Prior resume point (` heading, taking the count 38 -> 37. The real event deleted all 38 at once (2,014 lines) and `check` was green on both sides of it",
    file: "docs/progress.md",
    find: "### Prior resume point (P5-3 — deck cover art, kept for continuity)",
    replace: "#### Prior resume point (P5-3 — deck cover art, kept for continuity)",
    expectKilledBy: ["packages/engine/src/progressLog.test.ts"],
  },
  {
    id: "D318-resume-point-heading-renamed",
    decision: "D318",
    what: "the `## NEXT (resume point)` heading is renamed, so the span the offending script sliced cannot be located at all - the anti-vacuity half of the archive case, which would otherwise pass on a page whose landmarks have moved",
    file: "docs/progress.md",
    find: "\n## NEXT (resume point)",
    replace: "\n## NEXT (the resume point)",
    expectKilledBy: ["packages/engine/src/progressLog.test.ts"],
  },
  // ── D318 - THE `optional` ASSEMBLER'S MOVE. The two ARMS are covered six times
  //    over by the D316/D317 rows re-pointed into `boostedArms` above; what is new
  //    here is the CALL SITE and the pool reachability that made the move worth
  //    anything.
  {
    id: "D318-boost-program-not-appended",
    decision: "D318",
    what: "the assembled `optional` REPLACES the program instead of appending to it - D130's rule, and the same edit D317's twin row makes one reader over",
    file: "packages/engine/src/attack.ts",
    find: "    program = [...(program ?? []), ...optionalBoostProgram(optionalBoost, base, effect ?? \"\")];",
    replace: "    program = optionalBoostProgram(optionalBoost, base, effect ?? \"\");",
    expectKilledBy: ["packages/engine/src/optionalDamageBoost.test.ts"],
    survives: {
      kind: "unreachable-population",
      reason:
        "For all five printings `program` is null at this line: the derivers are whole-sentence anchored, so a sentence this reader claims is one `deriveAttackEffect` refused, and `programFor` is undefined for sv06-043, sv06-104, sv06.5-042, sv10-066 and sv10-211. The APPEND is correct and today unobservable - DECLARED rather than deleted, exactly as D317 declared the identical mutant on `bonusConsequentProgram`, and self-invalidating: the day a registry row names any of the five this reports STALE-SURVIVOR.",
    },
  },
  {
    id: "D318-pool-demonstrator-unread",
    decision: "D318",
    what: "🛑 THE ROW THE WHOLE STRUCTURAL HALF TURNS ON. `fix-optionalboost`'s printed sentence is paraphrased, so `deriveAttackOptionalBoost` refuses it, the pool produces no `optional` at all and `programWalk.test.ts`'s carrier pin silently falls back to `[\"then\"]` - which is EXACTLY the green-and-dead state D316 shipped and D318 is here to end",
    file: "packages/engine/src/testFixtures.ts",
    find: "        effect: \"You may do 30 more damage. If you do, this Pokémon also does 30 damage to itself.\",",
    replace: "        effect: \"You may deal 30 more damage. If you do, this Pokémon also does 30 damage to itself.\",",
    expectKilledBy: ["packages/engine/src/programWalk.test.ts"],
  },
  {
    id: "D318-assembler-hand-rolled-again",
    decision: "D318",
    what: "🛑 THE SWEEP'S FEED STOPS CALLING THE EXPORTED ASSEMBLER AND HAND-ROLLS THE GATE INSTEAD - D276's documented five-copies defect reappearing in the one file written to retire it, and the copy is missing the arm the whole slice is about. The carrier pin falls straight back to `[\"optional\", [\"then\"]]`, which is the exact green-and-dead state D316 shipped",
    file: "packages/engine/src/programWalk.test.ts",
    // ⚠️ THE FIRST DRAFT OF THIS ROW MUTATED THE *BASE* (`…, 0, …`) AND SURVIVED
    // THE `--decision` PROBE IN 22 SECONDS - correctly, and it was the row that was
    // wrong rather than the suite. `programWalk.test.ts`'s whole subject is
    // STRUCTURE: it pins op names and property names and never looks at an amount,
    // so a wrong base is invisible to it BY DESIGN and a row expecting otherwise
    // was asserting a claim about a different file. Re-aimed at the structural
    // difference the suite exists to see.
    find: "          ops: optionalBoostProgram(\n            boost,\n            parseAttackDamage(attack.damage).base,\n            attack.effect ?? \"\",\n          ),",
    replace: "          ops: [\n            {\n              op: \"optional\",\n              note: attack.effect ?? \"\",\n              then: [{ op: \"damageDefender\", amount: 80 }],\n            },\n          ] as EffectOp[],",
    expectKilledBy: ["packages/engine/src/programWalk.test.ts"],
  },

  // ── D319 - THE OPPONENT-ACTION TRIGGER: A SCAN DIRECTION, NOT A SEVENTH TIMING.
  //    Every row below is a way of putting the counters IN THE WRONG PLACE, ON THE
  //    WRONG BOARD, OR THE WRONG NUMBER OF TIMES while an evolve or an attach still
  //    resolves - which is this family's whole failure surface, because nothing the
  //    slice adds can refuse a board action.
  {
    id: "D319-direction-term-dropped",
    decision: "D319",
    what: "\u{1F6D1} THE PARTITION IS GONE FROM THE ONE CHOKE: `triggersOf` stops splitting self-watching from opponent-watching rows, so BOTH scans see BOTH populations. The live consequence is the bug the field exists to prevent - Ampharos is a Stage 2 carrying an `onEvolve` row, so its own controller evolving Flaaffy into it puts 4 counters on the Ampharos",
    file: "packages/engine/src/triggers.ts",
    find: "      (t.opponentAction === true) === (watch === \"opponent\"),",
    replace: "      true,",
    expectKilledBy: ["packages/engine/src/opponentActionTrigger.test.ts"],
  },
  {
    id: "D319-direction-inverted",
    decision: "D319",
    what: "the SAME term, inverted rather than dropped - the opponent scan now yields the self-watching rows and vice versa. A build that got the sense of the comparison backwards is green on a board with no watcher and silent on every board with one",
    file: "packages/engine/src/triggers.ts",
    find: "      (t.opponentAction === true) === (watch === \"opponent\"),",
    replace: "      (t.opponentAction === true) !== (watch === \"opponent\"),",
    expectKilledBy: ["packages/engine/src/opponentActionTrigger.test.ts"],
  },
  {
    id: "D319-stack-flag-inverted",
    decision: "D319",
    what: "`doesNotStack` is read backwards, so the two printed sentences SWAP behaviours: two Ampharos put 8 counters down (the clause it prints) and two Gengar ex put 2 (the clause it does not). The two rows are each other's control and this row breaks both at once",
    file: "packages/engine/src/triggers.ts",
    find: "      if (ability.doesNotStack === true) stacked.add(ability.name);",
    replace: "      if (ability.doesNotStack !== true) stacked.add(ability.name);",
    expectKilledBy: ["packages/engine/src/opponentActionTrigger.test.ts"],
  },
  {
    id: "D319-stack-guard-never-fires",
    decision: "D319",
    what: "the remembered-name guard itself goes dead while `doesNotStack` is still recorded - the shape a build takes when the flag is stored and never consulted, which no assertion about the FIELD can see",
    file: "packages/engine/src/triggers.ts",
    find: "      if (stacked.has(ability.name)) continue;",
    replace: "      if (stacked.size < 0) continue;",
    expectKilledBy: ["packages/engine/src/opponentActionTrigger.test.ts"],
  },
  {
    id: "D319-evolve-scan-site-dropped",
    decision: "D319",
    what: "the evolve half's scan is removed from `placeEvolution`'s tail, so Darkest Impulse never fires - and note the KO check below it still reads the post-scan board, which is why this row is about the SITE and not about the op",
    file: "packages/engine/src/turn.ts",
    find: "  const watched = runWatchedTriggers(next, seat, evolutionUid, \"onEvolve\", events);",
    replace: "  const watched = next;",
    expectKilledBy: ["packages/engine/src/opponentActionTrigger.test.ts"],
  },
  {
    id: "D319-attach-scan-site-dropped",
    decision: "D319",
    what: "the attach half's scan is removed from `attachEnergy`'s tail, so Gnawing Curse never fires. The evolve half is untouched, which is the point: two sentences, two sites, and a build that wired only the one the handoff named would be green on everything else in the suite",
    file: "packages/engine/src/turn.ts",
    find: "    const watched = runWatchedTriggers(next, action.seat, attachedTo, \"onEnergyAttach\", events);",
    replace: "    const watched = next;",
    expectKilledBy: ["packages/engine/src/opponentActionTrigger.test.ts"],
  },
  {
    id: "D319-attach-subject-is-the-first-body",
    decision: "D319",
    what: "\u{1F6D1} THE SUBJECT STOPS BEING KEYED ON THE ENERGY. `bodyHoldingEnergy` returns the first body on the board instead of the one carrying the card just attached, so the counters land on the Active whenever the attach was to the Bench. This is the shape a build takes when it reads `action.target` - which is ALSO wrong, in the other direction, the moment Jet Energy switches the body",
    file: "packages/engine/src/turn.ts",
    find: "    if (body.energy.includes(energyUid)) return topUid(body);",
    replace: "    return topUid(body);",
    expectKilledBy: ["packages/engine/src/opponentActionTrigger.test.ts"],
  },
  {
    id: "D319-evolve-ko-reads-the-pre-counter-board",
    decision: "D319",
    what: "\u{1F6D1} THE KO SWEEP AFTER THE EVOLVE SCAN RE-READS THE BODY OFF THE PRE-COUNTER BOARD, so a Pokemon the trigger just Knocked Out stays in play at or past its HP. The §8.1 evolve-below-HP check one line above is untouched and still passes, which is exactly how this stays invisible to it",
    file: "packages/engine/src/turn.ts",
    // ⚠️ THE FIRST DRAFT OF THIS ROW MUTATED THE *STATE ARGUMENT* OF
    // `isLethallyDamaged` (`watched` -> `next`) AND SURVIVED THE `--decision` PROBE IN
    // 34 SECONDS - correctly, and the ROW was wrong rather than the suite, which is
    // D318's finding arriving one slice later. That predicate takes its DAMAGE from
    // the Pokemon object it is handed and uses `state` only to resolve effective max
    // HP, so swapping the state while still passing the post-scan body changes
    // nothing on any board this catalog can build. Re-aimed at the read that actually
    // carries the counters: the BODY, not the state beside it.
    find: "    target.spot === \"active\" ? watched.players[seat].active : watched.players[seat].bench[benchIndex];",
    replace: "    target.spot === \"active\" ? next.players[seat].active : next.players[seat].bench[benchIndex];",
    expectKilledBy: ["packages/engine/src/opponentActionTrigger.test.ts"],
  },
  {
    id: "D319-subject-never-searches-the-bench",
    decision: "D319",
    what: "`damageSubject` resolves the printed pronoun against the opponent's ACTIVE only, so an evolve or an attach onto a BENCHED body places nothing. This is the whole reason the op is not `damageActive`, stated as a mutation",
    file: "packages/engine/src/interpreter.ts",
    find: "  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === uid);",
    replace: "  const index = -1;",
    expectKilledBy: ["packages/engine/src/opponentActionTrigger.test.ts"],
  },
  {
    id: "D319-impulse-amount-halved",
    decision: "D319",
    what: "Darkest Impulse places 2 damage counters instead of the printed 4 - the counters-to-HP conversion got the wrong number, on the one row where the two sentences differ by exactly that",
    file: "packages/engine/src/registry.ts",
    find: "      program: [{ op: \"damageSubject\", amount: 40 }],",
    replace: "      program: [{ op: \"damageSubject\", amount: 20 }],",
    expectKilledBy: [
      "packages/engine/src/opponentActionTrigger.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D319-curse-loses-its-direction",
    decision: "D319",
    what: "Gnawing Curse's registry row drops `opponentAction`, so it becomes a trigger on a MOMENT that no card watches from its own side - it fires for nobody, and the evolve half is untouched. The census attribution control reads the field for exactly this reason",
    file: "packages/engine/src/registry.ts",
    find: "      trigger: \"onEnergyAttach\",\n      opponentAction: true,",
    replace: "      trigger: \"onEnergyAttach\",",
    expectKilledBy: [
      "packages/engine/src/opponentActionTrigger.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D319-both-verbs-collapse-to-one-timing",
    decision: "D319",
    what: "Gnawing Curse is re-tagged `onEvolve`, which is the collapse a single merged census term would have hidden: the SIZE of the family stays 3 and every printing is still counted built, while the attach verb has silently stopped existing and an evolve now fires it",
    file: "packages/engine/src/registry.ts",
    find: "      name: \"Gnawing Curse\",\n      trigger: \"onEnergyAttach\",",
    replace: "      name: \"Gnawing Curse\",\n      trigger: \"onEvolve\",",
    expectKilledBy: [
      "packages/engine/src/opponentActionTrigger.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },

  // ── D320 - THE OPPONENT-ACTION FAMILY'S THIRD VERB (Magcargo `sv05-029` "Lava
  //    Zone"), AND THE FAILURE SURFACE IS A DIFFERENT SHAPE FROM D319's. Nothing
  //    here can refuse a board move either, so every row below is a way of Burning
  //    THE WRONG BODY, ON THE WRONG TURN, OR NOT AT ALL while the retreat / switch /
  //    gust still resolves. TWO of them are about the SECOND SCAN SITE, which is the
  //    thing a `switchInto`-only reading of the engine gets silently wrong.
  {
    id: "D320-retreat-site-dropped",
    decision: "D320",
    what: "\u{1F6D1} THE RETREAT SCAN SITE IS REMOVED, so Lava Zone never fires on a retreat while every other route still works. THIS IS THE BUILD THE SLICE ALMOST SHIPPED: `switchInto`'s own doc comment enumerates three provenances and retreat is not one of them, so a one-site build passes every Switch-driven assertion and kills the sentence's commonest real-game trigger",
    file: "packages/engine/src/turn.ts",
    // \u{26A0} RE-TRANSCRIBED AT D328, and this is the row's own rule working as
    // designed rather than a nuisance: D328 added a §8.1 sweep BEHIND this call, so
    // the retreat tail stopped being one expression and the `find` went 0\u{00D7}
    // LOUDLY. The mutation is unchanged in substance — the scan site is still
    // removed and Lava Zone still never fires on a retreat — it is only re-anchored
    // on the line that now holds it.
    find: "  const moved = runActiveBenchedTriggers(next, action.seat, activeTopUid, events);",
    replace: "  const moved = next;",
    expectKilledBy: ["packages/engine/src/lavaZone.test.ts"],
  },
  {
    id: "D320-switch-site-dropped",
    decision: "D320",
    what: "the OTHER site: `switchInto`'s tail stops running the scan, so a Switch/Escape Rope (and Jet Energy's on-attach promotion) Burns nobody while a retreat still does. The retreat row above is its exact mirror - two sites, and each one green without the other",
    file: "packages/engine/src/interpreter.ts",
    find: "  return runActiveBenchedTriggers(moved, seat, wasActive, events);",
    replace: "  return moved;",
    expectKilledBy: ["packages/engine/src/lavaZone.test.ts"],
  },
  {
    id: "D320-during-their-turn-dropped",
    decision: "D320",
    what: "\u{1F6D1} THE PRINTED \"DURING THEIR TURN\" CLAUSE GOES AWAY. A Boss's Orders is `switchInto` on the OTHER seat's board, byte for byte the move a Switch makes, so without the clause a gust Burns the body it just dragged up - on the gusting player's own turn, which is exactly what the sentence refuses",
    file: "packages/engine/src/triggers.ts",
    find: "  if (phaseViewOf(state, seat).activeSeat !== seat) return state;",
    replace: "  if (false) return state;",
    expectKilledBy: ["packages/engine/src/lavaZone.test.ts"],
  },
  {
    id: "D320-turn-clause-inverted",
    decision: "D320",
    what: "the same clause with the sense flipped rather than dropped: the trigger now fires ONLY on the turn the sentence excludes. A build that read \"during their turn\" as the gusting player's turn is green on nothing and wrong quietly - it Burns on the Boss's Orders and stays silent on every retreat",
    file: "packages/engine/src/triggers.ts",
    find: "  if (phaseViewOf(state, seat).activeSeat !== seat) return state;",
    replace: "  if (phaseViewOf(state, seat).activeSeat === seat) return state;",
    expectKilledBy: ["packages/engine/src/lavaZone.test.ts"],
  },
  {
    id: "D320-lava-zone-loses-its-direction",
    decision: "D320",
    what: "the registry row drops `opponentAction`, so the trigger moves to the SELF scan - which never runs for this timing, so it fires for nobody. The census attribution control reads the field for exactly this reason, and the suite's direction case (the watcher's own retreat) is its other half",
    file: "packages/engine/src/registry.ts",
    find: "      trigger: \"onActiveMovedToBench\",\n      opponentAction: true,",
    replace: "      trigger: \"onActiveMovedToBench\",",
    expectKilledBy: [
      "packages/engine/src/lavaZone.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D320-consequent-hits-the-watcher",
    decision: "D320",
    what: "\u{1F6D1} THE CONSEQUENT'S TARGET FLIPS SEATS. `applyStatus target:\"self\"` in a watched trigger resolves to `ctx.seat`, the WATCHER - so Magcargo's controller Burns their OWN Active instead of the body their opponent just promoted. This is the shape a build takes when it reasons about \"self/defender\" from an ATTACK program's point of view, where `self` is the actor",
    file: "packages/engine/src/registry.ts",
    find: "      opponentAction: true,\n      program: [{ op: \"applyStatus\", target: \"defender\", status: \"burned\" }],",
    replace: "      opponentAction: true,\n      program: [{ op: \"applyStatus\", target: \"self\", status: \"burned\" }],",
    expectKilledBy: [
      "packages/engine/src/lavaZone.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D320-burn-becomes-poison",
    decision: "D320",
    what: "the printed Special Condition is transcribed as Poisoned rather than Burned - the D183 defect (an arm written from a paraphrase) on the one token of this sentence that a paraphrase would change, and the only op field the census control can also see",
    file: "packages/engine/src/registry.ts",
    find: "      opponentAction: true,\n      program: [{ op: \"applyStatus\", target: \"defender\", status: \"burned\" }],\n    },",
    replace: "      opponentAction: true,\n      program: [{ op: \"applyStatus\", target: \"defender\", status: \"poisoned\" }],\n    },",
    expectKilledBy: [
      "packages/engine/src/lavaZone.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D320-subject-is-the-promoted-body",
    decision: "D320",
    what: "the `subjectUid` handed to the sweep becomes the body coming UP rather than the body going DOWN. No op in today's one program reads it, so the BOARD is byte-identical and only the next sentence at this site would ever notice - the row is here to be a declared SURVIVOR rather than a claim about the suite",
    file: "packages/engine/src/interpreter.ts",
    find: "  return runActiveBenchedTriggers(moved, seat, wasActive, events);",
    replace: "  return runActiveBenchedTriggers(moved, seat, nowActive, events);",
    survives: {
      kind: "unreachable-shape",
      reason:
        "`subjectUid` is threaded into `EffectContext` and read by exactly one op (`damageSubject`, D319), which this slice's program does not use - the printed consequent reaches its target through `applyStatus target:\"defender\"` instead. So no board this catalog can build separates the two uids at this site. Kept rather than deleted because the value is a CLAIM about which body the antecedent names, and the day a second sentence at this timing places counters on the body that left, this row stops surviving and says so.",
    },
    expectKilledBy: ["packages/engine/src/lavaZone.test.ts"],
  },
  {
    id: "D320-timing-collapses-onto-the-evolve-verb",
    decision: "D320",
    what: "Lava Zone is re-tagged `onEvolve`, the collapse a single merged census term would have hidden: the family SIZE stays 3, every printing is still counted built, and the bench-move verb has silently stopped existing while an opponent's evolve now Burns their Active",
    file: "packages/engine/src/registry.ts",
    find: "      name: \"Lava Zone\",\n      trigger: \"onActiveMovedToBench\",",
    replace: "      name: \"Lava Zone\",\n      trigger: \"onEvolve\",",
    expectKilledBy: [
      "packages/engine/src/lavaZone.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D320-stack-flag-invented",
    decision: "D320",
    what: "`doesNotStack: true` is added to a row whose sentence does not print the clause, so two Magcargo become one firing. ⚠️ BURNED IS IDEMPOTENT, so the BOARD is identical either way - the only witness is the `ABILITY_TRIGGERED` count, which is why §7 of the suite asserts the log and not the conditions",
    file: "packages/engine/src/registry.ts",
    find: "      name: \"Lava Zone\",\n      trigger: \"onActiveMovedToBench\",\n      opponentAction: true,",
    replace: "      name: \"Lava Zone\",\n      trigger: \"onActiveMovedToBench\",\n      opponentAction: true,\n      doesNotStack: true,",
    expectKilledBy: ["packages/engine/src/lavaZone.test.ts"],
  },
  // ── D321 - THE AFTER-W/R SEAT AURA'S SECOND AND THIRD SENTENCES (Steven's
  //    Carbink `sv10-086` "Stone Palace", Bouffalant `sv07-119`/`svp-136` "Curly
  //    Wall"). `seatDamageReductionAfterWR` stopped being a bare `number`, and
  //    every row below is a way of paying the WRONG SET or the WRONG AMOUNT on a
  //    reduction that still happens - which is the whole failure surface of a
  //    field whose two new printings narrow it in three places and cap it in a
  //    fourth. The riders are each other's controls, so most rows here are killed
  //    by ONE board and green on every other board in the suite.
  {
    id: "D321-beneficiary-dropped",
    decision: "D321",
    what: "the printed narrowing on WHO TAKES LESS is not read at all, so Stone Palace shields every body its controller owns and Curly Wall shields Evolutions and non-{C} Basics. Green on every board where the defender IS in the set, which is every board a real game builds",
    file: "packages/engine/src/continuous.ts",
    find: "      if (aura.beneficiary !== undefined && !matchesFilter(damagedCard, aura.beneficiary)) continue;",
    replace: "      if (false && aura.beneficiary !== undefined) continue;",
    expectKilledBy: ["packages/engine/src/seatReductionAura.test.ts"],
  },
  {
    id: "D321-beneficiary-asked-of-the-source",
    decision: "D321",
    what: "\u{1F6D1} THE FILTER IS APPLIED TO THE SOURCE INSTEAD OF THE DAMAGED BODY - the mirror image of the trap `seatDamageBonusBeforeWR` documents, and it is GREEN ON EVERY PRINTED BOARD because on both cards the source is itself inside the set it pays (a Steven's Carbink is a Steven's Pokemon; a Bouffalant is a Basic {C} Pokemon). Only a defender OUTSIDE the set separates them",
    file: "packages/engine/src/continuous.ts",
    find: "      if (aura.beneficiary !== undefined && !matchesFilter(damagedCard, aura.beneficiary)) continue;",
    replace: "      if (aura.beneficiary !== undefined && !matchesFilter(top, aura.beneficiary)) continue;",
    expectKilledBy: ["packages/engine/src/seatReductionAura.test.ts"],
  },
  {
    id: "D321-source-zone-gate-dropped",
    decision: "D321",
    what: "the printed \"As long as this Pokemon is on your Bench\" stops being read, so a PROMOTED Carbink keeps shielding its team. Every board in the suite that leaves the source on the Bench is green over it - the gate is only observable from the spot the card is never left in",
    file: "packages/engine/src/continuous.ts",
    find: "      if (aura.sourceOnBench === true && !isOnBench(state, holder)) continue;",
    replace: "      if (false && aura.sourceOnBench === true) continue;",
    expectKilledBy: ["packages/engine/src/seatReductionAura.test.ts"],
  },
  {
    id: "D321-source-zone-gate-inverted",
    decision: "D321",
    what: "the zone clause with its sense flipped rather than dropped: only an ACTIVE Carbink pays, which is `activeOnly`'s sentence on a card that prints its exact inverse. Both directions are needed - a dropped gate and a reversed one are green on disjoint halves of the same pair of boards",
    file: "packages/engine/src/continuous.ts",
    find: "      if (aura.sourceOnBench === true && !isOnBench(state, holder)) continue;",
    replace: "      if (aura.sourceOnBench === true && isOnBench(state, holder)) continue;",
    expectKilledBy: ["packages/engine/src/seatReductionAura.test.ts"],
  },
  {
    id: "D321-partner-clause-dropped",
    decision: "D321",
    what: "\"at least 1 other Bouffalant in play\" is not read, so a LONE Bouffalant pays 60. The board a real game reaches most often, and the one the printed antecedent exists to refuse",
    file: "packages/engine/src/continuous.ts",
    find: "        !holders.some(\n          (other) =>\n            topUid(other) !== sourceUid &&",
    replace: "        !holders.some(\n          (other) =>\n            true &&",
    expectKilledBy: ["packages/engine/src/seatReductionAura.test.ts"],
  },
  {
    id: "D321-partner-clause-not-read",
    decision: "D321",
    what: "the partner clause is skipped entirely rather than merely losing its exclusion - the shape a build takes when the rider is authored on the registry row and never wired into the scan. A lone Bouffalant pays 60 here too, by a different route, which is why both rows are kept",
    file: "packages/engine/src/continuous.ts",
    find: "      const otherNamed = aura.otherNamedInPlay;\n      if (\n        otherNamed !== undefined &&",
    replace: "      const otherNamed = aura.otherNamedInPlay;\n      if (\n        false &&",
    expectKilledBy: ["packages/engine/src/seatReductionAura.test.ts"],
  },
  {
    id: "D321-cap-becomes-a-sum",
    decision: "D321",
    what: "the `noStack` ledger adds instead of taking the largest, so \"The effect of Curly Wall doesn't stack.\" buys nothing: two Bouffalant pay 120 and two Carbink pay 60. ⚠️ AND THE TWO-BOUFFALANT BOARD IS THE ONLY ONE A REAL GAME EVER BUILDS, because the partner clause needs the second copy to be live at all",
    file: "packages/engine/src/continuous.ts",
    find: "      capped.set(aura.noStack, Math.max(capped.get(aura.noStack) ?? 0, aura.amount));",
    replace: "      capped.set(aura.noStack, (capped.get(aura.noStack) ?? 0) + aura.amount);",
    expectKilledBy: ["packages/engine/src/seatReductionAura.test.ts"],
  },
  {
    id: "D321-cap-keyed-by-a-boolean",
    decision: "D321",
    what: "\u{1F6D1} EVERY NON-STACKING AURA SHARES ONE LEDGER KEY - the boolean spelling the field's doc block refuses. Two copies of ONE Ability still cap correctly, so every board in the suite with a single named aura is green; only a board carrying Stone Palace AND Curly Wall at once separates the two spellings, and that board pays 60 instead of 90",
    file: "packages/engine/src/continuous.ts",
    find: "      capped.set(aura.noStack, Math.max(capped.get(aura.noStack) ?? 0, aura.amount));",
    replace: "      capped.set(\"\", Math.max(capped.get(\"\") ?? 0, aura.amount));",
    expectKilledBy: ["packages/engine/src/seatReductionAura.test.ts"],
  },
  {
    id: "D321-capped-amounts-never-paid",
    decision: "D321",
    what: "the ledger is built and never summed in, so every aura that prints the stacking clause reduces NOTHING. The loudest row in the set and the cheapest to get wrong: a `capped` map that is written but not read is what a copy of `seatPreWRDamageBonus` looks like with its last two lines missing",
    file: "packages/engine/src/continuous.ts",
    find: "    for (const amount of capped.values()) taken += amount;\n    return taken; // this is the Pokémon's own side",
    replace: "    return taken; // this is the Pokémon's own side",
    expectKilledBy: ["packages/engine/src/seatReductionAura.test.ts"],
  },
  {
    id: "D321-stone-palace-loses-its-zone-gate",
    decision: "D321",
    what: "the REGISTRY row drops `sourceOnBench`, so the printed antecedent is simply not authored. The scan is untouched, which is the point: a rider can be wired correctly and still be missing from the one row that prints it, and the census attribution control reads it for exactly this reason",
    file: "packages/engine/src/registry.ts",
    find: "      beneficiary: { kind: \"ownerPokemon\", owner: \"Steven\" },\n      sourceOnBench: true,",
    replace: "      beneficiary: { kind: \"ownerPokemon\", owner: \"Steven\" },",
    expectKilledBy: [
      "packages/engine/src/seatReductionAura.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D321-stone-palace-owner-misread",
    decision: "D321",
    what: "the owner prefix is transcribed as a different trainer's, so the aura pays a subgroup that is not on the board - D183's defect (a row written from a paraphrase) on the one token of this sentence a paraphrase would change",
    file: "packages/engine/src/registry.ts",
    find: "      beneficiary: { kind: \"ownerPokemon\", owner: \"Steven\" },\n      sourceOnBench: true,",
    replace: "      beneficiary: { kind: \"ownerPokemon\", owner: \"Misty\" },\n      sourceOnBench: true,",
    expectKilledBy: [
      "packages/engine/src/seatReductionAura.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D321-curly-wall-loses-its-stage-conjunct",
    decision: "D321",
    what: "the printed \"Basic {C} Pokemon\" becomes \"{C} Pokemon\": the stage word is dropped from the filter and every {C} EVOLUTION on the board is shielded too. `typedPokemon`'s two conjuncts are separately observable and both are driven",
    file: "packages/engine/src/registry.ts",
    find: "      beneficiary: { kind: \"typedPokemon\", pokemonType: \"Colorless\", stage: \"basic\" },",
    replace: "      beneficiary: { kind: \"typedPokemon\", pokemonType: \"Colorless\" },",
    expectKilledBy: [
      "packages/engine/src/seatReductionAura.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D321-curly-wall-partner-misnamed",
    decision: "D321",
    what: "the partner clause names a Pokemon that is not the one printing it, so Curly Wall never fires on any board this catalog can build. ⚠️ A row that is DEAD rather than wrong, and the suite's positive pair is the only thing that can see the difference - D310/D314/D318's \"a gate may be green and dead\", authored as a mutant",
    file: "packages/engine/src/registry.ts",
    find: "      otherNamedInPlay: \"Bouffalant\",",
    replace: "      otherNamedInPlay: \"Tauros\",",
    expectKilledBy: [
      "packages/engine/src/seatReductionAura.test.ts",
      "packages/engine/src/censusAtHead.test.ts",
    ],
  },
  {
    id: "D321-hariyama-gains-a-cap",
    decision: "D321",
    what: "the UNMARKED print is given the stacking clause it does not print. Hariyama is `legal_standard = 0` and no census row can see it, so the only witness is the registry control that asserts the bare row has none of the four riders - which is what that control is for",
    file: "packages/engine/src/registry.ts",
    find: "const HARIYAMA: CardProgram = { passive: { seatDamageReductionAfterWR: { amount: 10 } } };",
    replace: "const HARIYAMA: CardProgram = {\n  passive: { seatDamageReductionAfterWR: { amount: 10, noStack: \"Arm Thrust Practice\" } },\n};",
    expectKilledBy: ["packages/engine/src/seatReductionAura.test.ts"],
  },
  // -- D322 - THE RETREAT-COST DELTA'S THREE UNBUILT SENTENCES (Toedscruel
  //    `sv09-089` "Secret Forest Path", Ariados `sv06-005` "Big Net", Ethan's
  //    Magcargo `sv10-036` "Melt Away"). Three sentences on ONE funnel and THREE
  //    different fields, so the rows below split three ways: a NEW own-side scan
  //    (direction, zone gate, sum, floor), a WIDENED cross-board rider (which end
  //    the filter is asked of), and a NEW holder-side gate on an existing scan.
  //    ⚠️ The recurring shape is that the printed narrowing is satisfied by the
  //    SOURCE as well as by the target on every board the card is actually played
  //    on, so a mutant that swaps the two ends is green everywhere except on the
  //    one board the suite builds for it.
  {
    id: "D322-allied-discount-not-subtracted",
    decision: "D322",
    what: "the fourth term is dropped from the fold, so Toedscruel's Ability is authored, scanned and then thrown away. The whole slice is DEAD and every other row about it stays green - D310/D314/D318's \"a gate may be green and dead\", here as a whole scan",
    file: "packages/engine/src/continuous.ts",
    find: "      opposingRetreatSurcharge(state, pokemon) -\n      alliedRetreatDiscount(state, pokemon),",
    replace: "      opposingRetreatSurcharge(state, pokemon) -\n      0 * alliedRetreatDiscount(state, pokemon),",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-allied-discount-sign-flipped",
    decision: "D322",
    what: "the discount is ADDED rather than subtracted - the sign error a mirror-image scan invites, and the one that is invisible on any board where the cost floors at zero anyway. Only a printed cost STRICTLY GREATER than the discount separates them, which is why the suite's body is printed at {C}{C}{C}",
    file: "packages/engine/src/continuous.ts",
    find: "      opposingRetreatSurcharge(state, pokemon) -\n      alliedRetreatDiscount(state, pokemon),",
    replace: "      opposingRetreatSurcharge(state, pokemon) +\n      alliedRetreatDiscount(state, pokemon),",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-allied-discount-floored-per-term",
    decision: "D322",
    what: "\u{1F6D1} THE FLOOR MOVES OFF THE SUM AND ONTO THE TERM. `Math.max(0, printed - discount)` is then charged the surcharge on top, so a board where the discount overshoots pays the opposing surcharge out of a negative that no longer exists. Green on every board with only ONE kind of source in play, which is most of them",
    file: "packages/engine/src/continuous.ts",
    find: "  return Math.max(\n    0,\n    printed +\n      stadiumRetreatDelta(state, top) +\n      opposingRetreatSurcharge(state, pokemon) -\n      alliedRetreatDiscount(state, pokemon),\n  );",
    replace: "  return (\n    Math.max(0, printed + stadiumRetreatDelta(state, top) - alliedRetreatDiscount(state, pokemon)) +\n    opposingRetreatSurcharge(state, pokemon)\n  );",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-allied-discount-set-to-zero",
    decision: "D322",
    what: "the DELTA becomes a TIER: any live source frees the Active outright, which is `noRetreatCostAura`'s consequent on a card that prints \"{C}{C} less\". Green on every Active printed at {C}{C} or below - i.e. on most of the catalog - and the reason the suite's body is printed at {C}{C}{C}",
    file: "packages/engine/src/continuous.ts",
    find: "      discount += aura.amount;",
    replace: "      discount += 99;",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-allied-discount-does-not-sum",
    decision: "D322",
    what: "two benched Toedscruel pay once - `Math.max` over the sources instead of a sum, the shape a build takes when it reads the field as a tier. Only a board with TWO sources can see it",
    file: "packages/engine/src/continuous.ts",
    find: "      discount += aura.amount;",
    replace: "      discount = Math.max(discount, aura.amount);",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-allied-discount-reads-the-other-seat",
    decision: "D322",
    what: "\u{1F6D1} THE OWN-SIDE MIRROR READS ACROSS THE TABLE - the copy-paste defect the whole function exists to avoid, since it is `opposingRetreatSurcharge` with one word changed. An OPPOSING Toedscruel would discount your Active and your own would not",
    file: "packages/engine/src/continuous.ts",
    find: "    if (side.active === null || topUid(side.active) !== uid) continue;\n    const sources = [side.active, ...side.bench];\n    let discount = 0;",
    replace: "    if (side.active === null || topUid(side.active) !== uid) continue;\n    const other = state.players[otherSeat(seat)];\n    const sources = other.active === null ? other.bench : [other.active, ...other.bench];\n    let discount = 0;",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-allied-source-zone-gate-dropped",
    decision: "D322",
    what: "the printed \"As long as this Pokemon is on your Bench\" stops being read, so a PROMOTED Toedscruel keeps discounting - and since the source and the beneficiary are on DISJOINT zones here, the mutant makes a Toedscruel its own beneficiary, which the print can never do",
    file: "packages/engine/src/continuous.ts",
    find: "      if (aura.sourceOnBench === true && !isOnBench(state, source)) continue;",
    replace: "      if (false && aura.sourceOnBench === true) continue;",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-allied-source-zone-gate-inverted",
    decision: "D322",
    what: "the zone clause with its sense flipped rather than dropped: only an ACTIVE Toedscruel pays, which on this printing means the discount can only ever reach the source itself. Both directions are needed - a dropped gate and a reversed one are green on disjoint halves of the same pair of boards (D321's finding on the same rider, one field over)",
    file: "packages/engine/src/continuous.ts",
    find: "      if (aura.sourceOnBench === true && !isOnBench(state, source)) continue;",
    replace: "      if (aura.sourceOnBench === true && isOnBench(state, source)) continue;",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-allied-discount-ignores-the-ability-lock",
    decision: "D322",
    what: "the new scan skips its §9 gate, so a silenced Toedscruel keeps paying. Every aura scan in this file carries the same conjunct and a new one is exactly where it gets forgotten",
    file: "packages/engine/src/continuous.ts",
    find: "      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue;\n      if (aura.sourceOnBench === true && !isOnBench(state, source)) continue;",
    replace: "      if (false && sourceUid !== undefined) continue;\n      if (aura.sourceOnBench === true && !isOnBench(state, source)) continue;",
    expectKilledBy: ["packages/engine/src/registryOnlyPrograms.test.ts", "packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-surcharge-target-filter-dropped",
    decision: "D322",
    what: "Big Net's printed \"Evolution\" is not read, so Ariados surcharges a BASIC Active too - i.e. it silently becomes Trap Territory. Green on every board where the opposing Active happens to be an Evolution, which is most of them",
    file: "packages/engine/src/continuous.ts",
    find: "      if (aura.target !== undefined && !matchesFilter(targetTop, aura.target)) continue;",
    replace: "      if (false && aura.target !== undefined) continue;",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-surcharge-target-filter-asked-of-the-source",
    decision: "D322",
    what: "\u{1F6D1} THE FILTER IS APPLIED TO THE SOURCE INSTEAD OF THE SURCHARGED BODY - D320's failure mode as a mutant, and it is GREEN ON EVERY PRINTED BOARD because Ariados is itself a Stage 1 and so satisfies its own adjective. Only a BASIC target separates the two readings, and no printing in the pool is a Basic carrying this sentence",
    file: "packages/engine/src/continuous.ts",
    find: "      if (aura.target !== undefined && !matchesFilter(targetTop, aura.target)) continue;",
    replace: "      if (aura.target !== undefined && !matchesFilter(top, aura.target)) continue;",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-surcharge-target-filter-inverted",
    decision: "D322",
    what: "the adjective is read with its sense flipped: Big Net surcharges BASIC Actives and spares Evolutions, which is the printed sentence's exact complement. A dropped filter and an inverted one are green on disjoint boards, so both are kept",
    file: "packages/engine/src/continuous.ts",
    find: "      if (aura.target !== undefined && !matchesFilter(targetTop, aura.target)) continue;",
    replace: "      if (aura.target !== undefined && matchesFilter(targetTop, aura.target)) continue;",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-melt-away-gate-dropped",
    decision: "D322",
    what: "\"If this Pokemon has no Energy attached\" stops being read, so Ethan's Magcargo retreats free with a full board of Energy on it - Punk Out's unconditional shape on a card that prints an antecedent. Green on every board that never attaches to the holder",
    file: "packages/engine/src/continuous.ts",
    find: "  if (self.requiresNoEnergyAttached === true && pokemon.energy.length > 0) return false;",
    replace: "  if (false && self.requiresNoEnergyAttached === true) return false;",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-melt-away-gate-inverted",
    decision: "D322",
    what: "the antecedent read backwards: the Magcargo is free ONLY while it HAS Energy attached, which is the printed sentence's complement and the reading a hurried build lands on. The bare board and the one-Energy board separate them, and both are in the suite",
    file: "packages/engine/src/continuous.ts",
    find: "  if (self.requiresNoEnergyAttached === true && pokemon.energy.length > 0) return false;",
    replace: "  if (self.requiresNoEnergyAttached === true && pokemon.energy.length === 0) return false;",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-melt-away-counts-provided-units",
    decision: "D322",
    what: "the gate counts PROVIDED ENERGY UNITS rather than ATTACHED CARDS. The print says \"no Energy attached\", and the two readings agree on every board except one holding an Energy that provides zero units - a distinction this suite pins on the boundary rather than leaving to a future Energy card to discover",
    file: "packages/engine/src/continuous.ts",
    find: "  if (self.requiresNoEnergyAttached === true && pokemon.energy.length > 0) return false;",
    replace: "  if (self.requiresNoEnergyAttached === true && providedEnergy(state, pokemon).length > 0) return false;",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
    survives: {
      kind: "equivalent",
      reason:
        "D322 recorded this as EQUIVALENT rather than dropping it, and the `--decision D322` probe is what forced the reading. `providedEnergy` is `pokemon.energy.flatMap(unitsOf)`, and EVERY arm of `unitsOf` returns a NON-EMPTY array - the unresolved-uid arm returns [\"Colorless\"], the unauthored arm returns one printed type, and each authored arm returns a non-empty `provides`/`demote`/`promote` list. So `providedEnergy(...).length > 0` and `pokemon.energy.length > 0` are the SAME predicate on every board this engine can build, and no fixture or catalog Energy can separate them. \u26a0\ufe0f THE ROW IS KEPT rather than deleted because it stops being equivalent the day an Energy provides ZERO units - at which point this reason is false and the mutant starts dying, which is exactly the warning a `survives` row is for. The distinction the row was written to defend (ATTACHED CARDS vs PROVIDED UNITS) is real for a COUNT and vacuous for an EXISTENCE check, and that is the finding.",
    },
  },
  {
    id: "D322-big-net-loses-its-adjective",
    decision: "D322",
    what: "the REGISTRY row drops the target filter, so Big Net is authored as Trap Territory with a different id. The scan is untouched and correct; the data is what is wrong, which is why the registry control asserts the whole passive object rather than only the amount",
    file: "packages/engine/src/registry.ts",
    find: "    opponentActiveRetreatSurcharge: { amount: 1, target: { kind: \"evolutionPokemon\" } },",
    replace: "    opponentActiveRetreatSurcharge: { amount: 1 },",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-trap-territory-gains-an-adjective",
    decision: "D322",
    what: "the UNMARKED print is given the narrowing it does not print - the converse of the row above, and the one that says the widened field left its three rotated rows alone. Spidops ex is `legal_standard = 0`, so no census row can see it and the registry control is the only witness",
    file: "packages/engine/src/registry.ts",
    find: "const TRAP_TERRITORY: CardProgram = { passive: { opponentActiveRetreatSurcharge: { amount: 1 } } };",
    replace: "const TRAP_TERRITORY: CardProgram = {\n  passive: { opponentActiveRetreatSurcharge: { amount: 1, target: { kind: \"evolutionPokemon\" } } },\n};",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts", "packages/engine/src/trapTerritory.test.ts"],
  },
  {
    id: "D322-secret-forest-path-loses-its-zone-gate",
    decision: "D322",
    what: "the REGISTRY row drops `sourceOnBench`, so the printed \"As long as this Pokemon is on your Bench\" is never authored at all. The scan's own gate row above mutates the READER; this one mutates the DATA, and a build can be wrong in either place independently",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { ownActiveRetreatDiscount: { amount: 2, sourceOnBench: true } },",
    replace: "  passive: { ownActiveRetreatDiscount: { amount: 2 } },",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts"],
  },
  {
    id: "D322-secret-forest-path-amount-halved",
    decision: "D322",
    what: "\"{C}{C} less\" authored as \"{C} less\" - the sentence is counted in ENERGY SYMBOLS and a build that reads it as one symbol per clause halves it. Every assertion in the suite that reads a number rather than a boolean sees it",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { ownActiveRetreatDiscount: { amount: 2, sourceOnBench: true } },",
    replace: "  passive: { ownActiveRetreatDiscount: { amount: 1, sourceOnBench: true } },",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D322-melt-away-authored-as-an-aura",
    decision: "D322",
    what: "Melt Away authored on `noRetreatCostAura` instead of `noRetreatCostSelf`, so it frees the whole team rather than its holder. ⚠️ The board this card is actually played on is one where the Magcargo IS the Active, and there the two readings agree exactly - only a benched holder with a different Active separates them",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { noRetreatCostSelf: { requiresNoEnergyAttached: true } },",
    replace: "  passive: { noRetreatCostAura: {} },",
    expectKilledBy: ["packages/engine/src/retreatDelta.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  // ── D323 - the §8.1 SEAT-WIDE PRIZE BONUS (`PassiveEffects.koPrizeBonus`), the
  //    aura-scan family's ELEVENTH member and the FIRST prize modifier that is not
  //    read off the DYING body. Every row below is a way of paying the wrong
  //    number of Prize cards for a Knock Out that still happens - which is this
  //    slice's whole failure surface, because the KO itself is untouched and no
  //    existing row in this corpus can see a prize count move.
  //    ⚠️ THE TWO CARDS ARE EACH OTHER'S CONTROL, so a mutant that breaks one
  //    sentence must leave the other's rows GREEN; a row killed by "everything"
  //    would mean the two had been collapsed into one path.
  {
    id: "D323-kospot-clause-dropped",
    decision: "D323",
    what: "\u{1F6D1} \"your opponent's ACTIVE Pokemon\" stops being read, so Wonder Kiss pays for a BENCH Knock Out too. The optional is compared against `undefined` rather than against its value - the misread that looks like a null guard and is a clause deletion. Green on every board where the only KO is the Active, which is most of them",
    file: "packages/engine/src/continuous.ts",
    find: "    if (bonus.koSpot === \"active\" && !koWasActive) continue;",
    replace: "    if (bonus.koSpot === undefined && !koWasActive) continue;",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-kospot-clause-inverted",
    decision: "D323",
    what: "the spot clause is read BACKWARDS - Wonder Kiss pays for Bench Knock Outs and refuses Active ones, which is the exact complement of the print and is invisible to any test that only ever KOs one of the two",
    file: "packages/engine/src/continuous.ts",
    find: "    if (bonus.koSpot === \"active\" && !koWasActive) continue;",
    replace: "    if (bonus.koSpot === \"active\" && koWasActive) continue;",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-kotarget-matched-against-the-holder",
    decision: "D323",
    what: "\u{1F6D1} THE GREEN-AND-DEAD SHAPE (D310/D314/D318): \"your opponent's BASIC Pokemon\" is matched against the SOURCE instead of the corpse. Hydreigon ex is a Stage 2, so the filter never holds and Greedy Eater never pays - a card that looks authored, scanned and wired, and does nothing on any board",
    file: "packages/engine/src/continuous.ts",
    find: "    if (bonus.koTarget !== undefined && !matchesFilter(koCard, bonus.koTarget)) continue;",
    replace: "    if (bonus.koTarget !== undefined && !matchesFilter(top, bonus.koTarget)) continue;",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-kotarget-clause-dropped",
    decision: "D323",
    what: "the Basic-only narrowing stops being read, so Greedy Eater pays for an EVOLUTION corpse. Wonder Kiss carries no `koTarget` at all, so its rows must stay green - the pair is what makes this a clause deletion rather than a scan deletion",
    file: "packages/engine/src/continuous.ts",
    find: "    if (bonus.koTarget !== undefined && !matchesFilter(koCard, bonus.koTarget)) continue;\n",
    replace: "",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-attacker-clause-conflated-with-the-seat",
    decision: "D323",
    what: "\u{1F6D1} D164's CLAUSE SUBSTITUTED FOR THIS ONE - \"an attack used by THIS Pokemon\" read as \"by an attack\", which is what `attackerSeat` answers and what this row exists to distinguish. A BENCHED Hydreigon ex then pays for a kill somebody else made, and only a board with the holder off the Active Spot separates the two",
    file: "packages/engine/src/continuous.ts",
    find: "    if (bonus.byThisPokemonsAttack === true && sourceUid !== attackerUid) continue;",
    replace: "    if (bonus.byThisPokemonsAttack === true && attackerUid === undefined) continue;",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-attacker-clause-inverted",
    decision: "D323",
    what: "the attacker comparison is flipped, so Greedy Eater pays for every kill EXCEPT the ones its holder made. Complementary to the row above and killed by the same positive board - which is the point: an inversion and a widening are different defects with the same anchor",
    file: "packages/engine/src/continuous.ts",
    find: "    if (bonus.byThisPokemonsAttack === true && sourceUid !== attackerUid) continue;",
    replace: "    if (bonus.byThisPokemonsAttack === true && sourceUid === attackerUid) continue;",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-section9-gate-dropped",
    decision: "D323",
    what: "\u{1F6D1} THE §9 ABILITY LOCK STOPS REACHING THIS AURA, and D322's lesson is why the row exists: a new scan's §9 gate ships UNOBSERVED by default, because no board in a fresh suite has a lock in play unless one is put there. Ting-Lu ex's \"Cursed Land\" reaches a damaged Stage 2 where Klefki's Basic-only lock cannot",
    file: "packages/engine/src/continuous.ts",
    find: "    if (disabledAbilityUids(state).has(sourceUid)) continue; // §9\n    if (bonus.koSpot === \"active\" && !koWasActive) continue;",
    replace: "    if (bonus.koSpot === \"active\" && !koWasActive) continue;",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-nostack-ledger-never-refuses",
    decision: "D323",
    what: "the cap is WRITTEN and never READ - \"The effect of Wonder Kiss doesn't stack\" becomes decoration, so two Togekiss flip TWICE and pay TWICE. The ledger's presence is not its effect, and only a board with two copies of ONE Ability can tell them apart",
    file: "packages/engine/src/continuous.ts",
    find: "    if (bonus.noStack === true) {\n      if (capped.has(bonus.ability)) continue;\n      capped.add(bonus.ability);\n    }",
    replace: "    if (bonus.noStack === true) {\n      capped.add(bonus.ability);\n    }",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-nostack-keyed-on-the-body",
    decision: "D323",
    what: "the ledger keys on the SOURCE UID instead of the printed Ability NAME, so it can never collide and the cap is dead while looking alive. This is the sibling fields' own reason for keying on the name, restated on a set instead of a map",
    file: "packages/engine/src/continuous.ts",
    find: "      if (capped.has(bonus.ability)) continue;\n      capped.add(bonus.ability);",
    replace: "      if (capped.has(sourceUid)) continue;\n      capped.add(sourceUid);",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-scan-reads-the-other-board",
    decision: "D323",
    what: "\u{1F6D1} THE SEAT IS FLIPPED: the scan looks for the aura on the side that LOST the Pokemon rather than on the side taking the Prize. Both sentences are printed in the second person about the opponent's corpse, and a mirror-image scan is the copy-paste defect this whole family is written to avoid",
    file: "packages/engine/src/continuous.ts",
    find: "  const side = state.players[seat];\n  const holders = side.active === null ? side.bench : [side.active, ...side.bench];\n  const entries: { uid: string; bonus: NonNullable<PassiveEffects[\"koPrizeBonus\"]> }[] = [];",
    replace: "  const side = state.players[otherSeat(seat)];\n  const holders = side.active === null ? side.bench : [side.active, ...side.bench];\n  const entries: { uid: string; bonus: NonNullable<PassiveEffects[\"koPrizeBonus\"]> }[] = [];",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-scan-reads-the-active-only",
    decision: "D323",
    what: "the source set shrinks to the Active Spot, so a BENCHED Togekiss or Hydreigon ex is invisible. Both cards are support bodies that sit on the Bench, so this is green on exactly the board neither one is ever played on",
    file: "packages/engine/src/continuous.ts",
    find: "  const side = state.players[seat];\n  const holders = side.active === null ? side.bench : [side.active, ...side.bench];\n  const entries: { uid: string; bonus: NonNullable<PassiveEffects[\"koPrizeBonus\"]> }[] = [];",
    replace: "  const side = state.players[seat];\n  const holders = side.active === null ? [] : [side.active];\n  const entries: { uid: string; bonus: NonNullable<PassiveEffects[\"koPrizeBonus\"]> }[] = [];",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-taker-seat-is-the-dying-seat",
    decision: "D323",
    what: "the read site's half of the seat error: `otherSeat` is dropped at the CALL rather than inside the scan, so the same wrong board is scanned by a different route. Two anchors for one defect because a repair at either end must be driven at both",
    file: "packages/engine/src/flow.ts",
    find: "  const takerSeat = otherSeat(ref.seat);",
    replace: "  const takerSeat = ref.seat;",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-every-ko-looks-active",
    decision: "D323",
    what: "the pre-KO Active test degenerates to \"this seat has an Active at all\", which is TRUE on every board a Bench Knock Out happens on - so the spot clause is answered correctly by the scan and lied to by its caller. The clause survives and its input does not",
    file: "packages/engine/src/flow.ts",
    find: "  const koWasActive = side.active !== null && topUid(side.active) === ref.uid;",
    replace: "  const koWasActive = side.active !== null;",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-bonus-replaces-the-count",
    decision: "D323",
    what: "`count += amount` becomes `count = amount`, so a 2-Prize body Knocked Out under a heads Wonder Kiss yields ONE Prize instead of THREE. Green on every 1-Prize corpse - i.e. on the whole plain-Pokemon cast - and separable only by a Rule Box body",
    file: "packages/engine/src/flow.ts",
    find: "    count += entry.bonus.amount;",
    replace: "    count = entry.bonus.amount;",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-tails-pays-and-heads-does-not",
    decision: "D323",
    what: "the coin is read on the wrong face. The rng advances identically, the log still shows a flip, and every board still pays SOMETIMES - which is why a suite that asserted \"a bonus happens\" rather than \"heads pays and tails does not\" would be green",
    file: "packages/engine/src/flow.ts",
    find: "      if (face !== \"heads\") continue;",
    replace: "      if (face === \"heads\") continue;",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-coin-clause-dropped",
    decision: "D323",
    what: "\"flip a coin. If heads\" stops gating the consequent: Wonder Kiss pays every time. The rng STILL advances, so this is not a missing flip - it is a flip whose result is discarded, which no seed-count check can see",
    file: "packages/engine/src/flow.ts",
    find: "      if (face !== \"heads\") continue;\n",
    replace: "",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-denied-prize-still-takes-the-bonus",
    decision: "D323",
    what: "\u{1F6D1} A PROHIBITION TREATED AS A CLAMPED REDUCTION. Glimmora's \"your opponent can't take any Prize cards for it\" is overturned by a later permission, and the denied Knock Out also draws a Wonder Kiss coin it must never draw - so the defect moves the rng as well as the prize pile",
    file: "packages/engine/src/flow.ts",
    find: "      const bonus = denied\n        ? { state: next, count: attached.count, events: [] as GameEvent[] }\n        : koPrizeBonus(next, ref, attached.count, attackerUid);",
    replace: "      const bonus = koPrizeBonus(next, ref, attached.count, attackerUid);",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-bonus-computed-and-discarded",
    decision: "D323",
    what: "\u{1F6D1} GREEN AND DEAD AT THE LAST LINE: the flip happens, the events fire, the log says a Prize was added - and the plan records the PRE-bonus count. The most convincing failure in this slice, because every observable except the prize itself still moves",
    file: "packages/engine/src/flow.ts",
    find: "      entries.push({\n        ref,\n        count: bonus.count,",
    replace: "      entries.push({\n        ref,\n        count: attached.count,",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-attacker-uid-not-threaded",
    decision: "D323",
    what: "`collectKnockOuts` stops passing the attacking body to the plan, so Greedy Eater's clause is refused on the ATTACK route as well as on the Checkup one and the card never pays. Wonder Kiss is untouched, which is exactly how a threading defect looks from outside",
    file: "packages/engine/src/flow.ts",
    find: "  const plan = planPrizes(state, refs, attackerSeat, attackerUid);",
    replace: "  const plan = planPrizes(state, refs, attackerSeat);",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts"],
  },
  {
    id: "D323-wonder-kiss-not-capped",
    decision: "D323",
    what: "the registry half of the stacking clause: the printed \"doesn't stack\" is simply not authored, so the scan's ledger is correct and unreachable. The SIXTH of the six Abilities that print the clause, and the only one whose cap lives on a set rather than on a largest-wins map",
    file: "packages/engine/src/registry.ts",
    find: "      koSpot: \"active\",\n      coinFlip: true,\n      noStack: true,",
    replace: "      koSpot: \"active\",\n      coinFlip: true,",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D323-wonder-kiss-authored-without-the-spot",
    decision: "D323",
    what: "\"your opponent's ACTIVE Pokemon\" dropped at the registry rather than at the scan - the same behaviour as the clause deletion above, reached from the other end, and it must redden the census attribution control as well as the driver",
    file: "packages/engine/src/registry.ts",
    find: "      koSpot: \"active\",\n      coinFlip: true,\n      noStack: true,",
    replace: "      coinFlip: true,\n      noStack: true,",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D323-wonder-kiss-authored-without-the-coin",
    decision: "D323",
    what: "\"flip a coin. If heads\" dropped at the registry: the card becomes an unconditional +1 and the rng never moves for it. Distinct from the read-site coin rows because NO flip happens at all - the log loses a row rather than reading one wrong",
    file: "packages/engine/src/registry.ts",
    find: "      koSpot: \"active\",\n      coinFlip: true,\n      noStack: true,",
    replace: "      koSpot: \"active\",\n      noStack: true,",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D323-wonder-kiss-pays-two",
    decision: "D323",
    what: "\"take 1 more Prize card\" authored as two. The arithmetic every seed sees, and the cheapest possible transcription error on a field whose only number is a 1",
    file: "packages/engine/src/registry.ts",
    find: "      ability: \"Wonder Kiss\",\n      amount: 1,",
    replace: "      ability: \"Wonder Kiss\",\n      amount: 2,",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D323-greedy-eater-targets-evolutions",
    decision: "D323",
    what: "\"your opponent's BASIC Pokemon\" authored as its complement. `evolutionPokemon` and `basicPokemon` partition the Pokemon cast, so this is the one substitution that is wrong on EVERY board rather than on some of them - and it is still invisible without a corpse of each stage",
    file: "packages/engine/src/registry.ts",
    find: "      koTarget: { kind: \"basicPokemon\" },\n      byThisPokemonsAttack: true,",
    replace: "      koTarget: { kind: \"evolutionPokemon\" },\n      byThisPokemonsAttack: true,",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D323-greedy-eater-authored-without-the-attacker",
    decision: "D323",
    what: "\"by damage from an attack used by this Pokemon\" dropped at the registry, so a benched Hydreigon ex pays for anybody's kill - and, because the clause is what makes the card a singleton, TWO of them would then both pay for one Knock Out",
    file: "packages/engine/src/registry.ts",
    find: "      koTarget: { kind: \"basicPokemon\" },\n      byThisPokemonsAttack: true,",
    replace: "      koTarget: { kind: \"basicPokemon\" },",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D323-greedy-eater-authored-on-the-wrong-field",
    decision: "D323",
    what: "\u{1F6D1} THE PARTITION D164/D155 DREW, CROSSED: Greedy Eater keyed as a `triggered` on-KO row instead of a passive aura. `onKnockOutTrigger` reads the DYING body, so the Ability would only ever fire when the Hydreigon ex ITSELF was Knocked Out - authored, reachable, and pointed at the one board the card is never played for",
    file: "packages/engine/src/registry.ts",
    find: "const GREEDY_EATER: CardProgram = {\n  passive: {\n    koPrizeBonus: {\n      ability: \"Greedy Eater\",\n      amount: 1,\n      koTarget: { kind: \"basicPokemon\" },\n      byThisPokemonsAttack: true,\n    },\n  },\n};",
    replace: "const GREEDY_EATER: CardProgram = {\n  triggered: [{ name: \"Greedy Eater\", trigger: \"onKnockOut\", program: [] }],\n};",
    expectKilledBy: ["packages/engine/src/koPrizeBonus.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  // ── D324 — THE §8.1 MAX-HP SEAM ────────────────────────────────────────────
  // Twenty-five rows over THREE new fields, TWO new scans and ONE read site. The
  // seam's shape is what makes the batch worth its size: every printed clause on
  // it has a NEIGHBOURING clause that differs by one word (a sign, a stage, a
  // scope, a lock), so most of these mutants substitute one real reading for
  // another real reading rather than breaking the code.
  {
    id: "D324-seat-hp-scope-others-only",
    decision: "D324",
    what: "\u{1F6D1} \"ALL of your Pokemon in play\" narrowed to Feint Attack's \"all your OTHER Pokemon\" - the source stops paying itself. A lone Ludicolo then reads 140 instead of 180, and every teammate assertion in the file stays green, which is exactly why the holder's own total is asserted first",
    file: "packages/engine/src/continuous.ts",
    find: "      const aura = top === undefined ? undefined : programFor(top.id)?.passive?.seatHpBonus;\n      if (aura === undefined) continue;\n      const sourceUid = topUid(holder);",
    replace: "      const aura = top === undefined ? undefined : programFor(top.id)?.passive?.seatHpBonus;\n      if (aura === undefined) continue;\n      const sourceUid = topUid(holder);\n      if (sourceUid === uid) continue;",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-seat-hp-active-only",
    decision: "D324",
    what: "the aura pays only the seat's ACTIVE - the sentence read as \"your Active Pokemon gets +40 HP\", which is a real printed idiom on other cards. Invisible on any board whose only beneficiary is the Active",
    file: "packages/engine/src/continuous.ts",
    find: "    if (!holders.some((holder) => topUid(holder) === uid)) continue;\n    let bonus = 0;",
    replace: "    if (side.active === null || topUid(side.active) !== uid) continue;\n    let bonus = 0;",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-seat-hp-source-must-be-active",
    decision: "D324",
    what: "a SOURCE-SPOT clause the print does not carry - \"As long as this Pokemon is in the Active Spot\", which its sibling `seatDamageReductionAfterWR` really does print (Steven's Carbink). A benched Ludicolo then pays nothing, and the whole rest of the suite is green",
    file: "packages/engine/src/continuous.ts",
    find: "      const sourceUid = topUid(holder);\n      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9\n      if (aura.noStack !== true) {",
    replace: "      const sourceUid = topUid(holder);\n      if (holder !== side.active) continue;\n      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9\n      if (aura.noStack !== true) {",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-seat-hp-crosses-the-table",
    decision: "D324",
    what: "\u{1F6D1} \"YOUR Pokemon\" read as \"each Pokemon in play\" - the membership test dropped, so the FIRST seat scanned pays everybody and a body on the other side is credited with its opponent's aura. `SEATS` is ordered, so this is silently correct for p1 and wrong for p2 - the asymmetry a one-sided board cannot see",
    file: "packages/engine/src/continuous.ts",
    find: "    if (!holders.some((holder) => topUid(holder) === uid)) continue;\n    let bonus = 0;\n    const capped",
    replace: "    let bonus = 0;\n    const capped",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-seat-hp-no-stack-dropped",
    decision: "D324",
    what: "\"The effect of Vibrant Dance doesn't stack.\" deleted at the SCAN - two Ludicolo sum to +80. The whole sentence, and it is invisible on every board with one copy, which is every board except §3's",
    file: "packages/engine/src/continuous.ts",
    find: "      if (aura.noStack !== true) {\n        bonus += aura.amount;\n        continue;\n      }",
    replace: "      bonus += aura.amount;\n      if (aura.noStack !== true) {\n        continue;\n      }",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-seat-hp-no-stack-ledger-sums",
    decision: "D324",
    what: "the cap becomes a SUM inside its own ledger - `Math.max` replaced by addition, which is the mutation that looks like a fix. Two Ludicolo pay 80 again, and every single-copy board stays green",
    file: "packages/engine/src/continuous.ts",
    find: "      capped.set(aura.ability, Math.max(capped.get(aura.ability) ?? 0, aura.amount));",
    replace: "      capped.set(aura.ability, (capped.get(aura.ability) ?? 0) + aura.amount);",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-seat-hp-no-stack-keyed-on-the-uid",
    decision: "D324",
    what: "\u{1F6D1} THE LEDGER KEYED ON THE HOLDER INSTEAD OF ON THE PRINTED ABILITY NAME. Every Ludicolo has its own uid, so every one gets its own ledger entry and the cap does nothing at all - a `noStack` that is authored, read, and inert",
    file: "packages/engine/src/continuous.ts",
    find: "      capped.set(aura.ability, Math.max(capped.get(aura.ability) ?? 0, aura.amount));",
    replace: "      capped.set(sourceUid ?? aura.ability, Math.max(capped.get(sourceUid ?? aura.ability) ?? 0, aura.amount));",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-seat-hp-ledger-never-summed-in",
    decision: "D324",
    what: "the capped entries are collected and then never added - the ledger loop deleted. A SINGLE Ludicolo then pays nothing, which is the loudest possible break and is here because the two rows above it are the quiet ones",
    file: "packages/engine/src/continuous.ts",
    find: "    for (const amount of capped.values()) bonus += amount;\n    return bonus;",
    replace: "    return bonus;",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-seat-hp-lock-not-consulted",
    decision: "D324",
    what: "§9 dropped from the aura - a Klefki or a Cursed Land no longer switches Vibrant Dance off. D322's lesson keyed as a row: the excuse \"no lock in the pool reaches this source\" is a claim about the LOCK POPULATION, and Ting-Lu ex carries no stage clause at all",
    file: "packages/engine/src/continuous.ts",
    find: "      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9\n      if (aura.noStack !== true) {",
    replace: "      if (sourceUid === undefined) continue; // §9\n      if (aura.noStack !== true) {",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-seat-hp-lock-read-on-the-beneficiary",
    decision: "D324",
    what: "\u{1F6D1} §9 gated on the BENEFICIARY's uid rather than on the SOURCE's - a locked body stops RECEIVING the aura instead of a locked source stopping GIVING it. Both readings switch something off on a damaged Active, and only §4's undamaged-source board separates them",
    file: "packages/engine/src/continuous.ts",
    find: "      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9\n      if (aura.noStack !== true) {\n        bonus += aura.amount;",
    replace: "      if (disabledAbilityUids(state).has(uid)) continue; // §9\n      if (aura.noStack !== true) {\n        bonus += aura.amount;",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-max-hp-drops-the-seat-aura",
    decision: "D324",
    what: "the scan is written, exported and never read - `effectiveMaxHp` stops summing it. THE GREEN-AND-DEAD SHAPE (D310/D314/D318) in its purest form: §1's registry rows all pass, the function is reachable, and no board in the game changes",
    file: "packages/engine/src/continuous.ts",
    find: "    hp + hpBonus + seatMaxHpBonus(state, pokemon) + stadiumHpDelta(state, top),",
    replace: "    hp + hpBonus + stadiumHpDelta(state, top),",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-max-hp-drops-the-stadium",
    decision: "D324",
    what: "the Stadium term dropped at the read site - the same green-and-dead shape one term over, and it takes BOTH Stadium printings out at once while leaving the aura and both Tools working",
    file: "packages/engine/src/continuous.ts",
    find: "    hp + hpBonus + seatMaxHpBonus(state, pokemon) + stadiumHpDelta(state, top),",
    replace: "    hp + hpBonus + seatMaxHpBonus(state, pokemon),",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-max-hp-floor-removed",
    decision: "D324",
    what: "\u{1F6D1} THE INVARIANT A DELETED BRANCH DEPENDS ON. D205 proved `koSurvivalClamp`'s `dealt <= 0` guard UNKILLABLE and REMOVED it, because `effectiveMaxHp` never returns a non-positive number. That held for free while every term was an addend; Gravity Mountain is the first subtrahend. Drop the floor and a 20-HP Stage 2 reads -10",
    file: "packages/engine/src/continuous.ts",
    find: "  return Math.max(\n    MIN_EFFECTIVE_MAX_HP,\n    hp + hpBonus + seatMaxHpBonus(state, pokemon) + stadiumHpDelta(state, top),\n  );",
    replace: "  return hp + hpBonus + seatMaxHpBonus(state, pokemon) + stadiumHpDelta(state, top);",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-max-hp-floor-becomes-the-answer",
    decision: "D324",
    what: "`Math.max` read as `Math.min` - the floor becomes a CEILING and every Pokemon in the game has 10 HP. Loud, and it is the control that stops the row above being satisfiable by a constant",
    file: "packages/engine/src/continuous.ts",
    find: "  return Math.max(\n    MIN_EFFECTIVE_MAX_HP,",
    replace: "  return Math.min(\n    MIN_EFFECTIVE_MAX_HP,",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-max-hp-data-gap-floored",
    decision: "D324",
    what: "\u{1F6D1} THE NULL DATA GAP TURNED INTO A 10-HP BODY - the early return deleted so an unreadable card falls through to the clamp. `hpOf` returns null for a non-Pokemon and for a missing printing, and this is the mutation that makes every one of them Knock-Outable",
    file: "packages/engine/src/continuous.ts",
    find: "  const hp = hpOf(top);\n  if (hp === null) return null;",
    replace: "  const hp = hpOf(top) ?? 0;",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts", "packages/engine/src/koSurvival.test.ts"],
  },
  {
    id: "D324-stadium-hp-stage-clause-dropped",
    decision: "D324",
    what: "the Stadium's stage clause stops being read - Lively Stadium's +30 lands on Stage 1s and Stage 2s, Gravity Mountain's -30 lands on Basics. One line, and it is wrong for both printings in opposite directions at once",
    file: "packages/engine/src/continuous.ts",
    find: "  const matches = delta.stage === \"basic\" ? isBasicPokemon : isStage2Pokemon;\n  return matches(top) ? delta.amount : 0;",
    replace: "  return delta.amount;",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-stadium-hp-stage-arm-swapped",
    decision: "D324",
    what: "\u{1F6D1} THE STAGE ARM SELECTED BACKWARDS - the row says \"basic\" and the reader tests Stage 2. Both printings keep working on exactly the bodies the other one names, which is a substitution of one real card for the other rather than a break",
    file: "packages/engine/src/continuous.ts",
    find: "  const matches = delta.stage === \"basic\" ? isBasicPokemon : isStage2Pokemon;",
    replace: "  const matches = delta.stage === \"basic\" ? isStage2Pokemon : isBasicPokemon;",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-stadium-hp-sign-flipped",
    decision: "D324",
    what: "the Stadium delta SUBTRACTED at the read site - Lively Stadium takes 30 off every Basic and Gravity Mountain HEALS every Stage 2's maximum. The sign lives on the ROW, so this row is what proves the reader does not carry one of its own",
    file: "packages/engine/src/continuous.ts",
    find: "  return matches(top) ? delta.amount : 0;",
    replace: "  return matches(top) ? -delta.amount : 0;",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-tool-hp-gains-a-stage-clause",
    decision: "D324",
    what: "\u{1F6D1} `hpBonus` COLLAPSED BACK INTO `basicHpBonus` - the stage-free field gated on `isBasic`, which is the exact widening `passivesOf`'s own D174 audit says must not happen. Hero's Cape then dies on evolution like a Bravery Charm, and every board made only of Basics stays green",
    file: "packages/engine/src/continuous.ts",
    find: "    const stageFree = passive.hpBonus;\n    if (\n      stageFree !== undefined &&",
    replace: "    const stageFree = passive.hpBonus;\n    if (\n      isBasic &&\n      stageFree !== undefined &&",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-tool-hp-beneficiary-dropped",
    decision: "D324",
    what: "\"The CYNTHIA'S Pokemon this card is attached to\" stops being read - Cynthia's Power Weight pays +70 to anything holding it. The clause is the only difference between the two Tool printings, so dropping it makes them the same card with different numbers",
    file: "packages/engine/src/continuous.ts",
    find: "      (stageFree.beneficiary === undefined || matchesFilter(top, stageFree.beneficiary))",
    replace: "      (stageFree.beneficiary === undefined || stageFree.beneficiary !== undefined)",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-vibrant-dance-authored-without-the-cap",
    decision: "D324",
    what: "\"The effect of Vibrant Dance doesn't stack.\" dropped at the REGISTRY rather than at the scan - the row is what the sentence says, so this is the version of the deletion that no reader change can catch",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { seatHpBonus: { ability: \"Vibrant Dance\", amount: 40, noStack: true } },",
    replace: "  passive: { seatHpBonus: { ability: \"Vibrant Dance\", amount: 40 } },",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-vibrant-dance-authored-as-a-self-bonus",
    decision: "D324",
    what: "\u{1F6D1} THE ORDERED ROW AUTHORED ON THE WRONG FIELD: \"All of your Pokemon in play get +40 HP\" keyed as the stage-free `hpBonus`, which is a fact about the HOLDER. Ludicolo then gets its own +40 and nobody else does - authored, reachable, folded, and a different card",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { seatHpBonus: { ability: \"Vibrant Dance\", amount: 40, noStack: true } },",
    replace: "  passive: { hpBonus: { amount: 40 } },",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D324-gravity-mountain-authored-positive",
    decision: "D324",
    what: "Gravity Mountain's -30 authored as +30 - it becomes a second Lively Stadium aimed at the other stage, and the engine's only subtrahend disappears along with the reason `effectiveMaxHp` floors at all",
    file: "packages/engine/src/registry.ts",
    find: "const GRAVITY_MOUNTAIN: CardProgram = { stadium: { hpDelta: { amount: -30, stage: \"stage2\" } } };",
    replace: "const GRAVITY_MOUNTAIN: CardProgram = { stadium: { hpDelta: { amount: 30, stage: \"stage2\" } } };",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D324-heros-cape-authored-as-a-bravery-charm",
    decision: "D324",
    what: "Hero's Cape given the stage clause its sentence does not print, at the REGISTRY this time - `basicHpBonus: 100`. The number is right, the field is wrong, and the only board that can tell is one that evolves a body wearing it",
    file: "packages/engine/src/registry.ts",
    find: "const HEROS_CAPE: CardProgram = { passive: { hpBonus: { amount: 100 } } };",
    replace: "const HEROS_CAPE: CardProgram = { passive: { basicHpBonus: 100 } };",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D324-power-weight-owner-carries-the-possessive",
    decision: "D324",
    what: "\u{1F6D1} `owner: \"Cynthia's\"` instead of `\"Cynthia\"` - `matchesFilter`'s `ownerPokemon` arm appends the possessive and the space itself, so this looks for \"Cynthia's's \" and matches nothing. A filter that is authored, read, and refuses every card in the game",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { hpBonus: { amount: 70, beneficiary: { kind: \"ownerPokemon\", owner: \"Cynthia\" } } },",
    replace: "  passive: { hpBonus: { amount: 70, beneficiary: { kind: \"ownerPokemon\", owner: \"Cynthia's\" } } },",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    // 🛑 D325 - THE ROW THE SWEEP CORRECTED, AND IT WAS THIS SLICE'S OWN.
    // The first spelling swapped `hasAttachedEnergy(...)` for
    // `countAttachedEnergy(...) > 0` at the FOLD and claimed the four-{D} board
    // separated them. IT SURVIVED THE SWEEP, and it survived because the claim is
    // FALSE: `hasAttachedEnergy` is `.some(providesEnergyType)` and
    // `countAttachedEnergy` is `.filter(providesEnergyType).length`, so
    // `count > 0` collapses straight back to `.some` - a TAUTOLOGICAL equivalent
    // on every board that can ever exist. `countAttachedEnergy`'s own docblock
    // says so out loud ("it must give the same answer on the same board").
    // It is NOT declared `survives`: a declaration is a TRIPWIRE that fails the
    // run when its reason stops being true, and a tautology can never go stale,
    // so declaring it would be the vacuous guard conventions.md forbids ("an
    // unreachable survivor is REMOVED, not tested around"). NARROWED instead - to
    // the one place where "any" and "for each" really are two different programs,
    // which is the ROW rather than the reader.
    id: "D325-okidogi-authored-as-a-per-energy-scale",
    decision: "D325",
    what: "🛑 THE ROW'S SHARPEST CONFUSION, AUTHORED WHERE IT IS REAL: Okidogi's \"if this Pokemon has ANY {D} attached, +100 HP\" keyed as Conkeldurr's PER-ENERGY scale. Identical on every board holding exactly one {D}, which is most of them - only the FOUR-{D} board separates them, and it reads 130+400",
    file: "packages/engine/src/registry.ts",
    find: "    hpBonus: { amount: 100, requiresEnergyType: \"Darkness\" },",
    replace: "    hpBonusPer: { amount: 100, scale: { kind: \"attachedEnergy\", energyType: \"Darkness\" } },",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-energy-gate-dropped",
    decision: "D325",
    what: "the \"If this Pokemon has any {D} Energy attached\" clause deleted at the FOLD - Okidogi is at 230 max HP from the moment it is played, with nothing attached. The gate is the whole of what separates this printing from Hero's Cape",
    file: "packages/engine/src/continuous.ts",
    find: "      (stageFree.requiresEnergyType === undefined ||\n        hasAttachedEnergy(state, pokemon, stageFree.requiresEnergyType))",
    replace: "      (stageFree.requiresEnergyType === undefined ||\n        stageFree.requiresEnergyType !== undefined)",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-energy-gate-reads-the-holders-type",
    decision: "D325",
    what: "🛑 the gate answered off the HOLDER's printed types instead of its ATTACHED Energy - the misreading Okidogi's own print exists to catch, because it is a {F} Pokemon whose Ability names {D}. Green on any card whose two agreed",
    file: "packages/engine/src/continuous.ts",
    find: "      (stageFree.requiresEnergyType === undefined ||\n        hasAttachedEnergy(state, pokemon, stageFree.requiresEnergyType))",
    replace: "      (stageFree.requiresEnergyType === undefined ||\n        holderTypes.includes(stageFree.requiresEnergyType))",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-scaled-hp-not-folded",
    decision: "D325",
    what: "`hpBonusPer` collected and never added - Conkeldurr and Brambleghast are authored, reachable and worth nothing. The GREEN AND DEAD failure mode, on the field this slice exists for",
    file: "packages/engine/src/continuous.ts",
    find: "    if (scaled !== undefined) hpBonus += scaled.amount * maxHpScaleCount(state, pokemon, scaled.scale);",
    replace: "    if (scaled !== undefined) hpBonus += 0;",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-scaled-hp-paid-flat",
    decision: "D325",
    what: "the multiplier dropped: `amount` paid ONCE however many the board holds, which is Okidogi's \"any\" reading applied to a \"for each\" sentence. Identical on every board with exactly one of the counted thing",
    file: "packages/engine/src/continuous.ts",
    find: "    if (scaled !== undefined) hpBonus += scaled.amount * maxHpScaleCount(state, pokemon, scaled.scale);",
    replace: "    if (scaled !== undefined && maxHpScaleCount(state, pokemon, scaled.scale) > 0) hpBonus += scaled.amount;",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-scaled-hp-empty-count-pays-once",
    decision: "D325",
    what: "an empty count treated as one - a Conkeldurr with no Energy at 180 and a Brambleghast at 150 on turn one. The `amount x 0` case, which every board that attaches something first hides",
    file: "packages/engine/src/continuous.ts",
    find: "    if (scaled !== undefined) hpBonus += scaled.amount * maxHpScaleCount(state, pokemon, scaled.scale);",
    replace: "    if (scaled !== undefined)\n      hpBonus += scaled.amount * Math.max(1, maxHpScaleCount(state, pokemon, scaled.scale));",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-energy-scale-loses-its-type",
    decision: "D325",
    what: "🛑 \"for each {F} Energy attached\" widened to every attached Energy - the type dropped from the count. A Conkeldurr under three Water is then at 260, and every board that attaches only the right type stays green",
    file: "packages/engine/src/continuous.ts",
    find: "      return countAttachedEnergy(state, pokemon, scale.energyType);",
    replace: "      return countAttachedEnergy(state, pokemon, null);",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-prizes-taken-becomes-prizes-remaining",
    decision: "D325",
    what: "🛑 \"each Prize card your opponent has TAKEN\" read as the pile still face down - the inversion `takenPrizes` exists to prevent, and it is GREEN on the one board where both sides hold three",
    file: "packages/engine/src/continuous.ts",
    find: "      return seat === undefined ? 0 : takenPrizes(state, otherSeat(seat));",
    replace: "      return seat === undefined ? 0 : state.players[otherSeat(seat)].prizes.length;",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-prizes-read-off-the-holders-own-side",
    decision: "D325",
    what: "\"YOUR OPPONENT has taken\" read as the holder's own pile - `otherSeat` dropped. Two Brambleghast facing each other then swap answers, and a one-sided board cannot see it",
    file: "packages/engine/src/continuous.ts",
    find: "      return seat === undefined ? 0 : takenPrizes(state, otherSeat(seat));",
    replace: "      return seat === undefined ? 0 : takenPrizes(state, seat);",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-seat-lookup-is-active-only",
    decision: "D325",
    what: "`seatOfPokemon` narrowed to the Active Spot - a BENCHED Brambleghast resolves to no seat and its grant silently becomes 0. `isOnBench`'s scan with the wrong half kept",
    file: "packages/engine/src/continuous.ts",
    find: "    const holders = side.active === null ? side.bench : [side.active, ...side.bench];\n    return holders.some((holder) => topUid(holder) === uid);\n  });",
    replace: "    return side.active !== null && topUid(side.active) === uid;\n  });",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-okidogi-authored-without-the-gate",
    decision: "D325",
    what: "the ordered row authored as a plain Hero's Cape: `requiresEnergyType` dropped at the REGISTRY, so the +100 is unconditional. The version of the deletion no reader change can catch",
    file: "packages/engine/src/registry.ts",
    find: "    hpBonus: { amount: 100, requiresEnergyType: \"Darkness\" },",
    replace: "    hpBonus: { amount: 100 },",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-okidogi-gated-on-its-own-printed-type",
    decision: "D325",
    what: "🛑 `requiresEnergyType: \"Fighting\"` - the Ability gated on the type Okidogi PRINTS rather than the one it names. One word of catalog data, authored plausibly, and the card then wants the Energy it already pays its attacks with",
    file: "packages/engine/src/registry.ts",
    find: "    hpBonus: { amount: 100, requiresEnergyType: \"Darkness\" },",
    replace: "    hpBonus: { amount: 100, requiresEnergyType: \"Fighting\" },",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-okidogi-damage-half-dropped",
    decision: "D325",
    what: "the SECOND clause on Okidogi's one condition un-gated - the pre-W/R +100 stops asking about {D} and applies always. The half that cost nothing to build is the half a max-HP suite would never look at",
    file: "packages/engine/src/registry.ts",
    find: "    damageBonusBeforeWRIf: {\n      amount: 100,\n      cond: { kind: \"yourActiveHasEnergyAttached\", energy: \"Darkness\" },\n    },",
    replace: "    damageBonusBeforeWR: 100,",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D325-conkeldurr-authored-as-a-flat-bonus",
    decision: "D325",
    what: "Craftsmanship authored on `hpBonus` instead of `hpBonusPer` - \"+40 HP for each {F}\" becomes a flat +40. Authored, reachable, folded, and a different card",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { hpBonusPer: { amount: 40, scale: { kind: \"attachedEnergy\", energyType: \"Fighting\" } } },",
    replace: "  passive: { hpBonus: { amount: 40 } },",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts", "packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D325-brambleghast-authored-on-the-energy-scale",
    decision: "D325",
    what: "🛑 Resilient Soul authored with Conkeldurr's scale - \"for each Prize card your opponent has taken\" keyed as \"for each {F} Energy attached\". The two sentences share a field and the scale is the only thing separating them, so the mutant is a legal-looking row on the right card",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { hpBonusPer: { amount: 50, scale: { kind: \"opponentPrizesTaken\" } } },",
    replace: "  passive: { hpBonusPer: { amount: 50, scale: { kind: \"attachedEnergy\", energyType: \"Grass\" } } },",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  // -- D326 - the per-body KO record (`lastKoMarks`) and the two narrowings on
  //    D271's gate. Every row below is a way of answering "which Pokemon was
  //    Knocked Out, and how" WRONGLY while the WINDOW question stays right, which
  //    is this slice's whole failure surface: D271's bare gate is untouched and
  //    still green on every one of them.
  {
    id: "D326-owner-dropped-from-archer",
    decision: "D326",
    what: "🛑 THE CHEAPEST WRONG BUILD, AND THE ONE THE ROW EXISTS FOR: Archer keyed on D271's BARE gate. Identical on every board where the body that died happened to be a Team Rocket's Pokemon - which is every board a suite builds unless it builds the other one on purpose - and it lets Archer be played off ANY Knock Out",
    file: "packages/engine/src/registry.ts",
    find: "  trainerPlayableIf: { kind: \"yourPokemonKoedOnOpponentsLastTurn\", owner: \"Team Rocket\" },",
    replace: "  trainerPlayableIf: { kind: \"yourPokemonKoedOnOpponentsLastTurn\" },",
    expectKilledBy: ["packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D326-archer-draws-the-siblings-number",
    decision: "D326",
    what: "🛑 THE SIBLING'S NUMBERS AGAIN, FROM THE OTHER SIDE: Archer's 5/3 becomes Unfair Stamp's 5/2 behind the SAME second half. The controller's hand is 5 either way and the gate is untouched, so ONLY the opponent's hand size separates the two cards - which is why the suite reads both hands in one breath",
    file: "packages/engine/src/registry.ts",
    find: "  trainer: [{ op: \"handRefresh\", who: \"both\", draw: { kind: \"perSeat\", you: 5, opponent: 3 } }],",
    replace: "  trainer: [{ op: \"handRefresh\", who: \"both\", draw: { kind: \"perSeat\", you: 5, opponent: 2 } }],",
    expectKilledBy: ["packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D326-every-ko-counts-as-an-attack",
    decision: "D326",
    what: "🛑 THE CAUSE NARROWING MADE VACUOUS: every Knock Out is marked `byAttack`. GREEN on every board where the KO came from an attack, so the only thing that can catch it is a Pokemon that died in the CHECKUP - and a revenge attack then scores +60 to +100 off a poison",
    file: "packages/engine/src/flow.ts",
    find: "  const byAttack = attackerSeat !== undefined;",
    replace: "  const byAttack = true;",
    expectKilledBy: ["packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D326-no-ko-counts-as-an-attack",
    decision: "D326",
    what: "the cause narrowing inverted into a constant FALSE - the six revenge attacks never get their bonus at all. The mirror of the row above, and the pair is the point: a constant in either direction passes exactly the boards the other one fails",
    file: "packages/engine/src/flow.ts",
    find: "  const byAttack = attackerSeat !== undefined;",
    replace: "  const byAttack = attackerSeat === undefined;",
    expectKilledBy: ["packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D326-owner-prefix-loses-its-possessive",
    decision: "D326",
    what: "🛑 THE TRAILING BYTES: `${owner}'s ` becomes a bare `owner` prefix test. Every real Team Rocket's card still matches, so the pool cannot tell the difference - only a NEAR MISS can, and \"Team Rocketeer's Sneasel\" is the fixture that exists to be one. `CardFilter.ownerPokemon` spells the possessive for exactly this reason",
    file: "packages/engine/src/interpreter.ts",
    find: "          (cond.owner === undefined || mark.name.startsWith(`${cond.owner}'s `)) &&",
    replace: "          (cond.owner === undefined || mark.name.startsWith(cond.owner)) &&",
    expectKilledBy: ["packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D326-marks-read-without-the-window",
    decision: "D326",
    what: "🛑 THE READER STOPS ASKING THE WINDOW QUESTION and filters `lastKoMarks` directly. Nothing clears that list - that is the design - so a Team Rocket's body lost on turn 2 keeps Archer playable on turn 6, 8 and forever. The bare D271 gate stays correct throughout, which is what makes this survivable without the subset rung",
    file: "packages/engine/src/types.ts",
    find: "  return koedDuringOpponentsLastTurn(state, seat) ? state.lastKoMarks[seat] : [];",
    replace: "  return state.lastKoMarks[seat];",
    expectKilledBy: ["packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D326-marks-accumulate-across-turns",
    decision: "D326",
    what: "🛑 THE CO-STAMP BROKEN AT THE WRITE SITE: the list is never restarted, so it accumulates every body a seat has ever lost. Archer then reads TRUE on a turn when a PLAIN Pokemon died, because a Team Rocket's one died six turns ago - a false positive that only a board losing two DIFFERENT bodies on two different turns can see",
    file: "packages/engine/src/flow.ts",
    find: "    const carried = state.lastKoTurn[koedSeat] === state.turn ? state.lastKoMarks[koedSeat] : [];",
    replace: "    const carried = state.lastKoMarks[koedSeat];",
    expectKilledBy: ["packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D326-mark-loses-the-name",
    decision: "D326",
    what: "the body's printed NAME is never recorded, so every mark is anonymous and no owner prefix can ever match. The window, the cause and D271's three printings are all untouched - only the owner half falls",
    file: "packages/engine/src/flow.ts",
    find: "    const mark: KnockOutMark = { uid: koedUid, name: card?.name ?? \"\", byAttack };",
    replace: "    const mark: KnockOutMark = { uid: koedUid, name: \"\", byAttack };",
    expectKilledBy: ["packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D326-note-drops-the-owner",
    decision: "D326",
    what: "the rendered clause loses its owner prefix, so Archer's reject message reads as Unfair Stamp's. A player told the wrong reason is told a reason that is true of a DIFFERENT card - D116's round-trip, on the fragment a person actually reads",
    file: "packages/engine/src/interpreter.ts",
    find: "      return `any of your ${cond.owner === undefined ? \"\" : `${cond.owner}'s `}Pokémon were Knocked Out ${cond.byAttack === undefined ? \"\" : \"by damage from an attack \"}during your opponent's last turn`;",
    replace: "      return `any of your Pokémon were Knocked Out ${cond.byAttack === undefined ? \"\" : \"by damage from an attack \"}during your opponent's last turn`;",
    expectKilledBy: ["packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D326-ethan-clause-struck-from-the-table",
    decision: "D326",
    what: "Ethan's Pinsir's row leaves `CONDITIONAL_DAMAGE_CLAUSES`, so the one printing that carries BOTH narrowings stops resolving. The five plain revenge printings still do, which is what makes this a quiet -1 on the corpus sentence count rather than a visible break",
    file: "packages/engine/src/effects.ts",
    find: "    \"any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn\",\n    { kind: \"yourPokemonKoedOnOpponentsLastTurn\", owner: \"Ethan\", byAttack: true },",
    replace: "    \"any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's LAST turn\",\n    { kind: \"yourPokemonKoedOnOpponentsLastTurn\", owner: \"Ethan\", byAttack: true },",
    expectKilledBy: ["packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D326-revenge-clause-loses-its-cause",
    decision: "D326",
    what: "🛑 THE FIVE PLAIN REVENGE PRINTINGS KEYED ON D271's BARE GATE, AND THIS ROW SURVIVED THE FIRST `--decision D326` PROBE. The clause text still matches so the census does not move at all - the sentence count, the printing count and `BUILT.attack` are byte-identical - and the suite drove the CONDITION (§3) and the CARD (§7) without ever connecting the printed SENTENCE to the condition it resolves to. REACHING IS NOT DRIVING: the sweep reached this row, which is what moved BUILT.attack by six, and it was still free to map to the wrong condition. Repaired with a DRIVER (§9), never by relaxing this row",
    file: "packages/engine/src/effects.ts",
    find: "    \"any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn\",\n    { kind: \"yourPokemonKoedOnOpponentsLastTurn\", byAttack: true },",
    replace: "    \"any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn\",\n    { kind: \"yourPokemonKoedOnOpponentsLastTurn\" },",
    expectKilledBy: ["packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D326-record-version-not-bumped",
    decision: "D326",
    what: "the version stays 18 with a new REQUIRED `GameState` key in the shape. A v18 record then resumes under this deploy and THROWS the moment somebody reaches for Archer, instead of being retired - D271's finding one field over, and the reason the bump is driven by a replay rather than argued",
    file: "apps/api/src/lobby/match.ts",
    find: "export const MATCH_RECORD_VERSION = 19;",
    replace: "export const MATCH_RECORD_VERSION = 18;",
    expectKilledBy: ["apps/api/src/lobby/match.test.ts"],
  },
  // == D327 - THE COST SEAM'S SECOND AND THIRD COUNT SOURCES. Every row below is a
  //    way of returning the WRONG NUMBER OF {C} from one scan that now folds three
  //    summands, or of mapping a printed sentence to the wrong count source. The
  //    seam has no floor by construction (the cost is an ARRAY of symbols), so the
  //    failure surface is entirely "the count is off" and never "the cost went
  //    negative" - which is why every row here strikes a COUNT and not a clamp.
  {
    id: "D327-named-discard-summand-dropped",
    decision: "D327",
    what: "the discard-pile summand never lands, so Food Prep is a printed Ability that does nothing at all. Four legal printings go quietly inert while the other two summands keep working, which is the shape a scan with three optional fields fails in",
    file: "packages/engine/src/continuous.ts",
    find: "    if (perNamed !== undefined) discount += perNamed.amount * namedInDiscard(state, seat, perNamed.name);",
    replace: "    if (perNamed !== undefined) discount += 0;",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D327-bench-summand-dropped",
    decision: "D327",
    what: "the opposing-bench summand never lands - the same inertness, on Hustle Play's two printings. Kept as its own row because a single early return would take BOTH and only two rows can tell one dead summand from two",
    file: "packages/engine/src/continuous.ts",
    find: "    if (perBenched !== undefined) discount += perBenched * state.players[otherSeat(seat)].bench.length;",
    replace: "    if (perBenched !== undefined) discount += 0;",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D327-discard-pile-read-from-the-wrong-seat",
    decision: "D327",
    what: "🛑 THE PRINTED WORD IS `your`. The count moves to the OPPONENT's discard, so a Kofu you discarded does nothing and one THEY discarded shortens YOUR attack. Invisible on any board where only one side has ever discarded a Kofu, which is most of them - the sibling summand one line up genuinely does look across the table, so the two readings sit one character apart",
    file: "packages/engine/src/continuous.ts",
    find: "    if (perNamed !== undefined) discount += perNamed.amount * namedInDiscard(state, seat, perNamed.name);",
    replace: "    if (perNamed !== undefined)\n      discount += perNamed.amount * namedInDiscard(state, otherSeat(seat), perNamed.name);",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D327-bench-count-read-from-the-wrong-seat",
    decision: "D327",
    what: "the converse: Hustle Play counts YOUR OWN bench instead of your opponent's. A card that gets cheaper the more you bench is a different card, and a one-sided board where both benches are equal cannot see it",
    file: "packages/engine/src/continuous.ts",
    find: "    if (perBenched !== undefined) discount += perBenched * state.players[otherSeat(seat)].bench.length;",
    replace: "    if (perBenched !== undefined) discount += perBenched * state.players[seat].bench.length;",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D327-bench-count-includes-the-active",
    decision: "D327",
    what: "the count becomes `bench.length + 1` - the printed `Benched Pokemon` silently read as `Pokemon in play`. Off by exactly one on every board with an Active, which is every board, so the discount is always one {C} too generous and no empty-bench case exposes it either",
    file: "packages/engine/src/continuous.ts",
    find: "    if (perBenched !== undefined) discount += perBenched * state.players[otherSeat(seat)].bench.length;",
    replace: "    if (perBenched !== undefined) discount += perBenched * (state.players[otherSeat(seat)].bench.length + 1);",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D327-discard-count-matches-by-substring",
    decision: "D327",
    what: "🛑 THE NAME TEST BECOMES A SUBSTRING TEST, so `Kofu's Wailord` counts as a Kofu. The printed sentence says `each Kofu card` and means the card named Kofu - and a catalog full of owner-prefixed names (`Iono's`, `Ethan's`, `Team Rocket's`) makes this the failure mode a name-keyed count actually has",
    file: "packages/engine/src/continuous.ts",
    find: "    if (cardOfUid(state, uid)?.name === name) count += 1;",
    replace: "    if (cardOfUid(state, uid)?.name.includes(name) === true) count += 1;",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D327-discard-count-collapses-to-a-boolean",
    decision: "D327",
    what: "the per-unit rate becomes a presence test: one Kofu and four Kofu both take exactly one {C} off. The printed `for each` is the whole arithmetic of the row, and a board with a single copy in the pile agrees with the print under both readings",
    file: "packages/engine/src/continuous.ts",
    find: "  let count = 0;\n  for (const uid of state.players[seat].discard) {\n    if (cardOfUid(state, uid)?.name === name) count += 1;\n  }\n  return count;",
    replace: "  for (const uid of state.players[seat].discard) {\n    if (cardOfUid(state, uid)?.name === name) return 1;\n  }\n  return 0;",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D327-the-ninth-scan-loses-its-section-9-gate",
    decision: "D327",
    what: "the §9 suppression check goes, so an Active Klefki no longer silences a BASIC holder's Food Prep. D113's rule says reachability follows the SOURCE's stage, and this slice is the first on this seam that can show the rule failing in the direction it holds AND the direction it does not",
    file: "packages/engine/src/continuous.ts",
    find: "  if (perPrize === undefined && perNamed === undefined && perBenched === undefined) return 0;\n  if (disabledAbilityUids(state).has(uid)) return 0; // §9",
    replace: "  if (perPrize === undefined && perNamed === undefined && perBenched === undefined) return 0;",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D327-food-prep-keyed-to-the-wrong-count-source",
    decision: "D327",
    what: "🛑 THE MAPPING ITSELF (D326's lesson). Food Prep's registry row swaps to the OPPOSING-BENCH count. The key still resolves, the printing count is byte-identical, `BUILT.ability` is byte-identical and every census in this repo still counts four - because a census proves only that a key matched, never WHICH count source the sentence resolved to",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { attackCostDiscountPerNamedInDiscard: { name: \"Kofu\", amount: 1 } },",
    replace: "  passive: { attackCostDiscountPerOpponentBenched: 1 },",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D327-food-prep-counts-the-wrong-card-name",
    decision: "D327",
    what: "the counted name becomes `Kofu's Wailord`, a real catalog name one word longer. The field is still a discard count, still per-unit, still keyed on a name - only the name is wrong, and nothing outside a board that actually discards a Kofu can tell",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { attackCostDiscountPerNamedInDiscard: { name: \"Kofu\", amount: 1 } },",
    replace: "  passive: { attackCostDiscountPerNamedInDiscard: { name: \"Kofu's Wailord\", amount: 1 } },",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D327-veluza-loses-its-key",
    decision: "D327",
    what: "🛑 THE ID A NAME-KEYED READER WOULD HAVE MISSED. `sv07-045` falls out of the map, so three Crabominable printings keep Food Prep and the VELUZA that prints the byte-identical sentence does not. The group is four printings on TWO card names, and this is the exact shape of the mistake the row was built to avoid",
    file: "packages/engine/src/registry.ts",
    find: "  \"sv07-045\": FOOD_PREP, // Veluza — the SAME sentence on a different card",
    replace: "  \"sv07-045\": undefined as unknown as CardProgram, // Veluza — the SAME sentence on a different card",
    expectKilledBy: ["packages/engine/src/censusAtHead.test.ts"],
  },
  {
    id: "D327-hustle-play-rate-doubled",
    decision: "D327",
    what: "the per-unit rate becomes 2, so a full opposing bench takes TEN {C} off instead of five. The self-flooring array hides it on any cost with four or fewer Colorless - Blaze Blast has exactly four, so only a bench of three or fewer separates the two rates",
    file: "packages/engine/src/registry.ts",
    find: "  passive: { attackCostDiscountPerOpponentBenched: 1 },",
    replace: "  passive: { attackCostDiscountPerOpponentBenched: 2 },",
    expectKilledBy: ["packages/engine/src/foodPrep.test.ts"],
  },
  {
    id: "D328-rehomed-hit-loses-both-section-9-reactions",
    decision: "D328",
    what: "\u{1F6D1} THE REGRESSION ITSELF, RESTORED. The interpreter's §8.5 funnel deals the re-homed main hit and reacts to nothing, which is exactly what D316 and D317 shipped: every one of the 11 printings walks past Rocky Helmet's recoil and Armarouge's Burn on BOTH gate arms, and the whole rest of the pipeline — the arithmetic, the log row, the KO — is byte-identical, which is why no suite saw it",
    file: "packages/engine/src/interpreter.ts",
    find: "  return dealt > 0 && ctx.invokedBy === \"attack\"\n    ? reactToAttackDamage(hit, opponent, target.uid, ctx.seat, target.active, events)\n    : hit;",
    replace: "  return hit;",
    expectKilledBy: ["packages/engine/src/rehomedMainHit.test.ts"],
  },
  {
    id: "D328-rehomed-trigger-appended-behind-the-epilogue",
    decision: "D328",
    what: "the damagedTrigger stage is APPENDED to `pending` instead of spliced in front of the epilogue tail — the mistake anyone queuing a stage from inside a program makes, since every other producer appends. The reaction then runs AFTER finishAttack's §8.1 sweep, so `even if this Pokémon is Knocked Out` quietly stops holding and only a LETHAL board can tell",
    file: "packages/engine/src/interpreter.ts",
    find: "    pending:\n      ahead === -1\n        ? [...next.pending, stage]\n        : [...next.pending.slice(0, ahead), stage, ...next.pending.slice(ahead)],",
    replace: "    pending: [...next.pending, stage],",
    expectKilledBy: ["packages/engine/src/rehomedMainHit.test.ts"],
  },
  {
    id: "D328-rehomed-recoil-lands-on-the-damaged-body",
    decision: "D328",
    what: "the recoil is written onto the DAMAGED seat rather than the attacker's — `damagedSeat` is the seat this function is mostly about, and both are in scope. Rocky Helmet then punishes its own holder, and a board that only checks `a COUNTERS_PLACED row exists` is green",
    file: "packages/engine/src/interpreter.ts",
    find: "    next = withActive(next, attackerSeat, {\n      ...attacker.active,\n      damage: attacker.active.damage + recoil,\n    });",
    replace: "    next = withActive(next, damagedSeat, {\n      ...attacker.active,\n      damage: attacker.active.damage + recoil,\n    });",
    expectKilledBy: ["packages/engine/src/rehomedMainHit.test.ts"],
  },
  {
    id: "D328-rehomed-trigger-scanned-on-the-attackers-board",
    decision: "D328",
    what: "the `onDamagedByAttack` scan is pointed at the ATTACKER's seat. The reaction belongs to the body that was damaged, and the attacker is the seat every other line of the surrounding op is about — so the Ability is looked for on the wrong board and Scorching Armor simply never announces",
    file: "packages/engine/src/interpreter.ts",
    find: "  if (damagedByAttackAbility(next, damagedSeat, damagedUid) === undefined) return next;",
    replace: "  if (damagedByAttackAbility(next, attackerSeat, damagedUid) === undefined) return next;",
    expectKilledBy: ["packages/engine/src/rehomedMainHit.test.ts"],
  },
  {
    id: "D328-stadium-play-skips-the-ko-sweep",
    decision: "D328",
    what: "\u{1F6D1} THE GAP D324 PINNED AS INTENDED, RESTORED: `playStadium` returns `ok` and sweeps nothing. Gravity Mountain takes 30 off every Stage 2 in play and a Stage 2 already past its reduced maximum simply stays standing until the Checkup - able to attack, retreat, or be healed or evolved out of a Knock Out §8.1 had already decided",
    file: "packages/engine/src/cardplay.ts",
    find: "  return resolveMidTurnKnockOuts(next, action.seat, SEATS, events);",
    replace: "  return ok(next, events);",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D328-stadium-sweep-narrowed-to-the-actor",
    decision: "D328",
    what: "the Stadium sweep passes `[action.seat]` - turn.ts's THREE call sites' argument, copied to a site whose printed clause is different. All three legal `hpDelta` printings say `both yours and your opponent's`, so this reads as consistency and silently exempts the opponent's board from a card the actor played",
    file: "packages/engine/src/cardplay.ts",
    find: "  return resolveMidTurnKnockOuts(next, action.seat, SEATS, events);",
    replace: "  return resolveMidTurnKnockOuts(next, action.seat, [action.seat], events);",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D328-retreat-skips-the-ko-sweep",
    decision: "D328",
    what: "\u{1F6D1} THE SEAM D325 RECORDED AND DECLINED TO CLAIM, RESTORED: `retreat` pays its cost and returns with no sweep. D325's two energy-counted max-HP grants shrink with nothing in the holder's stack moving, so a Conkeldurr at 200 damage under a 260 maximum walks to the Bench at 200 under 140 and stands there",
    file: "packages/engine/src/turn.ts",
    find: "  return resolveMidTurnKnockOuts(moved, action.seat, [action.seat], events);",
    replace: "  return ok(moved, events);",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D328-retreat-sweep-runs-before-the-trigger",
    decision: "D328",
    what: "\u{1F6D1} STALE-SURVIVOR, KILLED AT D329. The retreat sweep is moved AHEAD of `runActiveBenchedTriggers`, so the retreater is Knocked Out - and the game parked on the opponent's Prize decision - before the Ability whose antecedent is this very move has fired. D328 declared this unreachable on a premise about a card that does not exist (Lava Zone places NO counters: `applyStatus defender burned`, a different body, no damage, and Burn is dealt at the Checkup). The COST is the only lethality here, and it is enough to separate the two orderings",
    file: "packages/engine/src/turn.ts",
    find: "  const moved = runActiveBenchedTriggers(next, action.seat, activeTopUid, events);",
    replace: "  const swept = resolveMidTurnKnockOuts(next, action.seat, [action.seat], events);\n  const moved = runActiveBenchedTriggers(swept.ok ? swept.state : next, action.seat, activeTopUid, events);",
    expectKilledBy: ["packages/engine/src/selfScalingHp.test.ts"],
  },
  {
    id: "D328-ko-batch-is-a-snapshot-again",
    decision: "D328",
    what: "\u{1F6D1} THE ONE-PASS BATCH RESTORED: `collectKnockOuts` runs a single pass, so `lethalRefs` is a snapshot taken before any body has left play. D324's `seatHpBonus` makes the dying body the SOURCE of its teammates' maximum, and a teammate the aura was keeping alive is simply not looked at again",
    file: "packages/engine/src/flow.ts",
    find: "    if (batch.stages.length === 0) return { done: null, state: batch.state, stages };\n    next = batch.state;\n    stages.push(...batch.stages);",
    replace: "    stages.push(...batch.stages);\n    return { done: null, state: batch.state, stages };",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts"],
  },
  {
    id: "D328-ko-cascade-inherits-the-attack-cause",
    decision: "D328",
    what: "\u{1F6D1} STALE-SURVIVOR, KILLED AT D329. Every pass is handed `attackerSeat`/`attackerUid`, so a CASCADE Knock Out reads as `Knocked Out by damage from an attack`. The counters on that teammate were placed some other turn and the maximum is what moved - so D164's Munkidori ex reduction, D323's Hydreigon ex bonus and D326's marks would all fire for a Knock Out no attack dealt. The board D328 said no suite builds is `fix-sniper` finishing a Ludicolo whose +40 was holding a benched Basic up: two Knock Outs, one action, two different causes",
    file: "packages/engine/src/flow.ts",
    find: "      pass === 0 ? attackerSeat : undefined,\n      pass === 0 ? attackerUid : undefined,",
    replace: "      attackerSeat,\n      attackerUid,",
    expectKilledBy: ["packages/engine/src/hpAura.test.ts", "packages/engine/src/lastKoOwnerMark.test.ts"],
  },
  {
    id: "D328-evolve-park-inherits-the-take-verb",
    decision: "D328",
    what: "\u{1F6D1} THE COSMETIC DEFECT RESTORED, AS A CELL RATHER THAN AS A TERNARY: `evolve` renders `Take`. That is what the dialog did from D307 until this session — a Confirm reading `Take 1` over a heading that says `put it onto Pidove to evolve it` — and it is the exact value a fallback arm would have given it",
    file: "src/features/game/GameHud.tsx",
    find: "  evolve: { mandatory: \"Evolve\", upTo: \"Evolve\" },",
    replace: "  evolve: { mandatory: \"Take\", upTo: \"Take\" },",
    expectKilledBy: ["src/features/game/GameHud.chooseCardsVerb.dom.test.tsx"],
  },
  {
    id: "D328-confirm-verb-back-to-a-ternary",
    decision: "D328",
    what: "the total record is bypassed and the `up to` branch goes back to `dest === 'deck' ? 'Shuffle' : 'Take'` — the CLOSED-WORLD read D222 names, restored on the exact line it was found on. Every dest but `deck` inherits `Take`, which is green on the search, retrieval and look-at-top boards and wrong on the two members added after the line was written",
    file: "src/features/game/GameHud.tsx",
    find: "              `${CHOOSE_CARDS_VERB[prompt.dest].upTo} ${picked.length === 0 ? \"none\" : picked.length}`}",
    replace: "              `${prompt.dest === \"deck\" ? \"Shuffle\" : \"Take\"} ${picked.length === 0 ? \"none\" : picked.length}`}",
    expectKilledBy: ["src/features/game/GameHud.chooseCardsVerb.dom.test.tsx"],
  },
];
