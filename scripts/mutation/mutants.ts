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
    replace: '`Attach the Energy to which of your ${attachTargetNoun(op)}?`,',
    expectKilledBy: ["packages/engine/src/ownerTargetOps.test.ts"],
  },
  {
    id: "D205-count-le-1",
    decision: "D205",
    what: "the caption branch reinstated as a COMPARISON (`count <= 1`) rather than the field's presence — D205's removed unkillable mutant, re-declared as data",
    file: "packages/engine/src/interpreter.ts",
    // ⚠️ WIDENED AT D246 for the row above's reason.
    find: '`Attach ${\n          op.count === undefined ? "the Energy" : `up to ${op.count} Energy`\n        } to which of your ${attachTargetNoun(op)}?`,',
    replace: '`Attach ${\n          op.count === undefined || op.count <= 1 ? "the Energy" : `up to ${op.count} Energy`\n        } to which of your ${attachTargetNoun(op)}?`,',
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
    find: "  const bench = subgroupRefs(state, ownBenchRefs(state, seat), op.ownerPokemon);",
    replace: "  const bench = ownBenchRefs(state, seat);",
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
    find: "      if (discardVictimSeat(ctx.seat, op) !== ctx.seat) {",
    replace: '      if (op.from !== "yourActive" && op.from !== "yours") {',
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
    find:
      "        : isSupporter &&\n" +
      "          ((state.turn === 1 && program.trainerFirstTurnExempt !== true) ||\n" +
      "            state.allowances.supporterPlayed));",
    replace: "        : isSupporter && (state.turn === 1 || state.allowances.supporterPlayed));",
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
    find: '    ...(energyType === undefined ? {} : { energyType }),',
    replace: '    ...(energyType === undefined ? {} : {}),',
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
    replace:
      "  return [count === 1 ? base : { ...base, count }];",
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
    replace:
      "  return Array.from({ length: count }, () => ({ ...base }));",
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
    find: "        (card.types ?? []).includes(filter.pokemonType) &&\n        (filter.stage === undefined ||\n          (filter.stage === \"basic\" ? isBasicPokemon(card) : evolveFromOf(card) !== null))",
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
    replace: "  return passivesOf(state, pokemon).cantAttackUnless.find((cond) =>\n    conditionHolds(state, seat, cond),\n  );",
    expectKilledBy: ["packages/engine/src/abilityAttackGate.test.ts"],
  },
  {
    id: "D242-floor-becomes-an-exact-count",
    decision: "D242",
    what: "the printed \"4 OR MORE\" becomes exactly 4, which is `opponentPrizesRemaining`'s reading (\"exactly 1 or 2 Prize cards\") installed on a member that is a THRESHOLD. Passes every case at the boundary and silently re-bars the player the moment they bench a FIFTH Team Rocket's Pokémon — i.e. the reward for building the deck the card is printed for",
    file: "packages/engine/src/interpreter.ts",
    find: "      return countOwnerPokemonInPlay(state, seat, cond.owner) >= cond.count;",
    replace: "      return countOwnerPokemonInPlay(state, seat, cond.owner) === cond.count;",
    expectKilledBy: ["packages/engine/src/abilityAttackGate.test.ts"],
  },
  {
    id: "D242-count-skips-the-active-spot",
    decision: "D242",
    what: "\"in play\" narrows to the Bench, so the gate holder stops counting ITSELF and the printed floor of 4 silently becomes 5. The subtlest of the six: every near miss in the prefix table still answers correctly, the condition still evaluates, and the card is simply one Bench slot harder to switch on than it prints",
    file: "packages/engine/src/interpreter.ts",
    find: "  return [side.active, ...side.bench].filter((body) => {",
    replace: "  return [...side.bench].filter((body) => {",
    expectKilledBy: ["packages/engine/src/abilityAttackGate.test.ts"],
  },
  {
    id: "D242-gate-read-off-the-catalog-past-the-ability-lock",
    decision: "D242",
    what: "🛑🛑 THE CHANNEL MUTANT, AND THE ONE THE WHOLE `passivesOf` ARGUMENT IS FOR. The reader goes straight to `programFor(top.id)` instead of the §9-SUPPRESSED fold, so Klefki `sv01-096` \"Mischievous Lock\" no longer silences Power Saver and a Team Rocket's Mewtwo under an Ability lock stays barred by an Ability that is not running. Shorter, obvious, and wrong — exactly the build a slice that had priced the TOKEN rather than the CHANNEL would have shipped",
    file: "packages/engine/src/interpreter.ts",
    find: "  return passivesOf(state, pokemon).cantAttackUnless.find(\n    (cond) => !conditionHolds(state, seat, cond),\n  );",
    replace: "  const printed = programFor(topCardOf(state, pokemon)?.id ?? \"\")?.passive?.cantAttackUnless;\n  return printed !== undefined && !conditionHolds(state, seat, printed) ? printed : undefined;",
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
    replace: "  const holders = side.active === null ? [] : [side.active];\n  let total = 0;\n  // The `noStack` ledger: printed Ability name \u2192 the largest single contribution",
    expectKilledBy: ["packages/engine/src/seatDamageAura.test.ts"],
  },
  {
    id: "D243-aura-survives-the-ability-lock",
    decision: "D243",
    what: "\ud83d\udea9\ud83d\udea9 THE CHANNEL MUTANT, D242's `gate-read-off-the-catalog-past-the-ability-lock` installed one field over and on the other sign. All seven printings are printed Pokémon ABILITIES, so a §9 lock must silence them; drop the `disabledAbilityUids` line and Klefki `sv01-096` leaves the aura running — the shorter, obvious build a slice that priced the TOKEN rather than the CHANNEL would have shipped",
    file: "packages/engine/src/continuous.ts",
    find: "    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9\n    // The BENEFICIARY clause, on the attacker and on nothing else.",
    replace: "    void sourceUid;\n    // The BENEFICIARY clause, on the attacker and on nothing else.",
    expectKilledBy: ["packages/engine/src/seatDamageAura.test.ts"],
  },
  {
    id: "D243-beneficiary-filters-the-source-not-the-attacker",
    decision: "D243",
    what: "\ud83d\udea9 THE READING MUTANT, AND THE ONE NO LEGAL BOARD SEPARATES BY ITSELF. \"Attacks used by your Cynthia's Pokémon\" narrows WHOSE ATTACKS get the bonus; this applies the filter to the body PRINTING the Ability instead. On all four owner-prefixed printings the source IS in the subgroup, so every single-source board agrees — the separating case is a BARE aura standing beside a prefixed one, where this build drops the Serperior's 20 because a Serperior is not a Cynthia's Pokémon",
    file: "packages/engine/src/continuous.ts",
    find: "    if (aura.beneficiary !== undefined && !matchesFilter(attackerCard, aura.beneficiary)) continue;",
    replace: "    if (aura.beneficiary !== undefined && !matchesFilter(top, aura.beneficiary)) continue;",
    expectKilledBy: ["packages/engine/src/seatDamageAura.test.ts"],
  },
  {
    id: "D243-nostack-clause-ignored",
    decision: "D243",
    what: "the printed \"The effect of Extra Helpings doesn't stack.\" is dropped and the capped sources join the summing majority — the neighbouring branch's REAL code, three lines up, copied verbatim. Two Hop's Snorlax then pay 60 where the card prints 30, and every board with ONE source of each aura is byte-identical",
    file: "packages/engine/src/continuous.ts",
    find: "    capped.set(aura.noStack, Math.max(capped.get(aura.noStack) ?? 0, aura.amount));",
    replace: "    total += aura.amount;",
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
    what: "\ud83d\udea9 THE DEFECT `fromSource` EXISTS TO PREVENT, and the exact build the row's own `needs` string said was missing. The printed PRONOUN (\"switch **it** with your Active Pok\u00e9mon\") becomes a free pick over the whole Bench \u2014 the pre-D244 behaviour of this op, copied verbatim from the arm four lines down. Iron Leaves then offers a prompt where the card offers no choice, and on a board with one other benched body it promotes the WRONG Pok\u00e9mon",
    file: "packages/engine/src/interpreter.ts",
    find: "    return sourceRef(state, { seat, sourceUid }).filter((ref) => ref.spot.spot === \"bench\");",
    replace: "    return ownBenchRefs(state, seat);",
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-fromSource-admits-the-active-spot",
    decision: "D244",
    what: "the BENCH narrowing goes and `sourceRef`'s answer is taken whole. Every Iron Leaves case stays green (its trigger only ever fires on a benched body), and Meowscarada `sv09-018`'s printed \"if this Pok\u00e9mon is on your Bench\" silently stops being enforced \u2014 an ACTIVE Meowscarada is offered a switch with ITSELF, which `switchInto` then resolves as a no-op that burns the once-per-turn stamp",
    file: "packages/engine/src/interpreter.ts",
    find: "    return sourceRef(state, { seat, sourceUid }).filter((ref) => ref.spot.spot === \"bench\");",
    replace: "    return sourceRef(state, { seat, sourceUid });",
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-switch-gate-cannot-see-the-source",
    decision: "D244",
    what: "\ud83d\udea9 D222's AFFORD-THEN-REJECT AT A SECOND OP. `programPlayable` stops threading the uid, so the switch gate answers about the whole Bench instead of about THIS body \u2014 the state of this line the instant before D244. The TRIGGER cannot catch it (a trigger never passes through this gate), so only Meowscarada's activated surface goes red, which is the entire reason that seventh printing is in this slice",
    file: "packages/engine/src/cardplay.ts",
    find: "    if (op.op === \"switchActive\" && switchActiveTargets(state, seat, op, sourceUid).length === 0) {",
    replace: "    if (op.op === \"switchActive\" && switchActiveTargets(state, seat, op).length === 0) {",
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-move-gate-cannot-see-the-source",
    decision: "D244",
    what: "the same drop on the OTHER gate the slice threaded. `moveEnergyPlayable` loses the uid, so `othersToSelf` resolves no destination and the gate answers `false` on every board \u2014 a card that is never playable rather than one that whiffs. It is the SAFE direction of the failure, which is exactly why it needs a mutant: nothing about the board looks wrong, the row simply never lights",
    file: "packages/engine/src/cardplay.ts",
    find: "    if (op.op === \"moveEnergy\" && !moveEnergyPlayable(state, seat, op, sourceUid)) {",
    replace: "    if (op.op === \"moveEnergy\" && !moveEnergyPlayable(state, seat, op)) {",
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-othersToSelf-is-benchToActive",
    decision: "D244",
    what: "\ud83d\udea9\ud83d\udea9 THE OTHER READING OF THE FLAGGED EQUIVALENCE, INSTALLED. On all SIX printed boards this is byte-identical to the real build \u2014 the tail runs behind the `recordGate`, so the source is always the Active by then and `benchToActive`'s endpoints coincide exactly. It can only be killed by the CONSTRUCTED board (`fix-othersmove`, a bare `othersToSelf` used from the Bench), which is the whole reason that fixture exists",
    file: "packages/engine/src/interpreter.ts",
    find: "      movable: attachedEnergies(state, seat, op.filter, \"all\").filter(\n        (entry) => refKeyOf(entry.from) !== refKeyOf(dest),\n      ),\n      destinations: [dest],",
    replace: "      movable: attachedEnergies(state, seat, op.filter, \"bench\"),\n      destinations: active === null ? [] : [{ seat, spot: { spot: \"active\" } }],",
    expectKilledBy: ["packages/engine/src/benchSwitchTrigger.test.ts"],
  },
  {
    id: "D244-any-amount-clamps-to-one",
    decision: "D244",
    what: "the printed \"any amount\" becomes the family's default single Energy. The prompt still appears, the note still says \"any amount\", the card still works \u2014 it simply moves one Energy where the print moves the board, which is the quietest possible way to get this sentence wrong and the one no structural assertion would notice",
    file: "packages/engine/src/interpreter.ts",
    find: "  return op.max === \"any\" ? movable : op.max;",
    replace: "  return op.max === \"any\" ? 1 : op.max;",
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
    what: "\ud83d\udea9\ud83d\udea9 THE OTHER READING OF THE PRINTED CONJUNCTION, INSTALLED. \"your {G} Pok\u00e9mon **and** {R} Pok\u00e9mon\" read as an intersection rather than a union. It is the reading the English words invite, it compiles, and on the whole Standard-legal pool it makes Sunny Day pay NOBODY (no dual Grass/Fire body is printed) \u2014 a card that is silently inert rather than loud. Only a board with a {G}-only attacker beside the source can tell the two apart",
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
    what: "\ud83d\udea9 THE STATE OF THIS LINE THE INSTANT BEFORE D245, AND THE DEFECT THE WIDENING EXISTS TO FIX. `typedPokemon.stage` goes back to answering \"is it Basic?\" for every value it holds, so `stage: \"evolution\"` becomes its own COMPLEMENT: Victory Cheer pays Basic {R} bodies and refuses Evolution ones, and Genesect's deck search offers Basic {M} Pok\u00e9mon for a sentence that says Evolution. Nothing throws, nothing logs, and the D238 suite \u2014 whose only stage witness is `\"basic\"` \u2014 stays entirely green",
    file: "packages/engine/src/cards.ts",
    find: "        (card.types ?? []).includes(filter.pokemonType) &&\n        (filter.stage === undefined ||\n          (filter.stage === \"basic\" ? isBasicPokemon(card) : evolveFromOf(card) !== null))\n      );\n    case \"anyOf\":",
    replace: "        (card.types ?? []).includes(filter.pokemonType) &&\n        (filter.stage === undefined || isBasicPokemon(card))\n      );\n    case \"anyOf\":",
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
    replace: "    if (aura.target !== undefined && !matchesFilter(attackerCard, aura.target)) continue;",
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
    what: "the DESCRIBER regresses: an \"Evolution {M} Pok\u00e9mon\" search captions itself \"up to 2 Basic Metal Pok\u00e9mon\", naming the exact COMPLEMENT of the set the prompt then offers. The engine resolves correctly and lies about it in the dialog heading \u2014 the read site the resume point said nobody prices, and the second slice running on which it owed something",
    file: "packages/engine/src/interpreter.ts",
    find: "      const noun = `${filter.stage === undefined ? \"\" : filter.stage === \"basic\" ? \"Basic \" : \"Evolution \"}${filter.pokemonType} Pok\u00e9mon`;",
    replace: "      const noun = `${filter.stage === undefined ? \"\" : \"Basic \"}${filter.pokemonType} Pok\u00e9mon`;",
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  {
    id: "D245-sunny-day-loses-an-arm",
    decision: "D245",
    what: "the REGISTRY row keeps the combinator and drops one alternative, so Sunny Day pays {G} bodies and silently stops paying {R} ones. It is the transcription slip a two-arm disjunction invites, it needs no engine change to happen, and every structural assertion about `kind: \"anyOf\"` still passes",
    file: "packages/engine/src/registry.ts",
    find: "          { kind: \"typedPokemon\", pokemonType: \"Grass\" },\n          { kind: \"typedPokemon\", pokemonType: \"Fire\" },",
    replace: "          { kind: \"typedPokemon\", pokemonType: \"Grass\" },",
    expectKilledBy: ["packages/engine/src/auraNarrowing.test.ts"],
  },
  {
    id: "D245-metallic-signal-searches-basics",
    decision: "D245",
    what: "Genesect ex's deck search drops the stage word, so \"up to 2 **Evolution** {M} Pok\u00e9mon\" offers every {M} Pok\u00e9mon in the deck \u2014 strictly WIDER than the print, which is the direction a search filter is never allowed to be wrong in. It is the registry-side twin of the predicate mutant above, and it is the row that proves these three printings are driven by their own assertion rather than by the field's",
    file: "packages/engine/src/registry.ts",
    find: "          filter: { kind: \"typedPokemon\", pokemonType: \"Metal\", stage: \"evolution\" },",
    replace: "          filter: { kind: \"typedPokemon\", pokemonType: \"Metal\" },",
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
    find: "      return [\n        { op: \"switchActive\", recordAs: \"moved\" },\n        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).\n        { op: \"recordGate\", slot: \"moved\", then: program },\n      ];",
    replace: "      return [{ op: \"switchActive\", recordAs: \"moved\" }, ...program];",
    expectKilledBy: ["packages/engine/src/derivedGatedAttach.test.ts"],
  },
  {
    id: "D246-gated-arm-drops-the-recordAs",
    decision: "D246",
    what: "the other direction: the antecedent stops FILING, so `recordGateHolds` reads an empty slot on every board and the attach never runs at all. The card switches and gives nothing, ever — and the whole-program equality in `switchSeam.test.ts` is the only other place that can see it",
    file: "packages/engine/src/effects.ts",
    find: "        { op: \"switchActive\", recordAs: \"moved\" },\n        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).\n        { op: \"recordGate\", slot: \"moved\", then: program },",
    replace: "        { op: \"switchActive\" },\n        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).\n        { op: \"recordGate\", slot: \"moved\", then: program },",
    expectKilledBy: ["packages/engine/src/derivedGatedAttach.test.ts", "packages/engine/src/switchSeam.test.ts"],
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
    find: "      (anyEnergy || card.energyType === \"Normal\") &&",
    replace: "      card.energyType === \"Normal\" &&",
    expectKilledBy: ["packages/engine/src/derivedGatedAttach.test.ts"],
  },
  {
    id: "D246-attachable-energies-drops-the-basic-test",
    decision: "D246",
    what: "the widening becomes unconditional at the helper, so EVERY attach in the engine — six registry Abilities included — starts reaching Special Energy. The lift is meant to be per-op and printed; this makes it a rule of the game",
    file: "packages/engine/src/interpreter.ts",
    find: "      (anyEnergy || card.energyType === \"Normal\") &&",
    replace: "      (anyEnergy || true) &&",
    expectKilledBy: ["packages/engine/src/derivedGatedAttach.test.ts", "packages/engine/src/attachEnergyFrom.test.ts"],
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
    find: "  if (heal !== undefined && heal.pronoun === \"this\" && destination.riders.toSelf !== true) {\n    return null;\n  }",
    replace: "  if (false) {\n    return null;\n  }",
    expectKilledBy: ["packages/engine/src/derivedHandAttach.test.ts"],
  },
  {
    id: "D246-heal-amount-collapses-to-all",
    decision: "D246",
    what: "the printed NUMBER is parsed and discarded, so Snorlax's 'heal 60 damage' clears the body outright. `healChosen` clamps either way, so nothing throws and nothing warns — the only observable is the damage left on a body carrying more than 60",
    file: "packages/engine/src/effects.ts",
    find: "        : { amount: match[7] === undefined ? \"all\" : Number(match[7]), pronoun: match[8] ?? \"\" },",
    replace: "        : { amount: \"all\", pronoun: match[8] ?? \"\" },",
    expectKilledBy: ["packages/engine/src/derivedGatedAttach.test.ts", "packages/engine/src/derivedHandAttach.test.ts"],
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
    find: "  `^You may attach any number of Basic (?:\\\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join(\"\")}])\\\\} )?Energy cards${HAND_SOURCE_ZONE_PHRASE} to ([^.]+)\\\\.$`,",
    replace: "  `^(?:You may )?attach (?:any number of|up to \\\\d+) Basic (?:\\\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join(\"\")}])\\\\} )?Energy cards${HAND_SOURCE_ZONE_PHRASE} to ([^.]+)\\\\.$`,",
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
    find: "                ? { kind: \"basicEnergy\" }\n                : { kind: \"basicEnergy\", energyType },",
    replace: "                ? { kind: \"anyEnergy\" }\n                : { kind: \"basicEnergy\", energyType },",
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
    replace: "  const candidates = state.players[seat].deck.filter((uid) =>\n    matchesFilter(cardOf(state, uid), op.filter),\n  );",
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
    replace: "          done: attachEnergyTargets(state, ctx.seat, { ...op, benchOnly: true }).reduce(",
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
    find: "  const auraRefuses =\n    passivesOf(state, target).preventDamageAndEffectsFromSpecialEnergy &&\n    attackerHasSpecialEnergy(state, attackerTop?.active);",
    replace: "  const auraRefuses = false;",
    expectKilledBy: ["packages/engine/src/mightyShell.test.ts"],
  },
  {
    id: "D252-effects-off-top-card",
    decision: "D252",
    what: "🛑 the EFFECTS half reads the holder's CATALOG ROW instead of the `passivesOf` fold. Correct on every board except one under a §9 Ability lock, where the damage half correctly stops and the effects half keeps refusing — one printed sentence answering two ways about the same lock",
    file: "packages/engine/src/interpreter.ts",
    find: "    passivesOf(state, target).preventDamageAndEffectsFromSpecialEnergy &&",
    replace:
      "    programFor(topUid(target) === undefined ? \"\" : (state.cardIdByUid[topUid(target) ?? \"\"] ?? \"\"))?.passive?.preventDamageAndEffectsFromSpecialEnergy === true &&",
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
];
