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
    find:
      "  const noTarget = !programPlayable(game, ability.program, seat);\n" +
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
];
