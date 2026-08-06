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
    find: '    { op: "shuffleDeck" },\n  ],\n  trainerFirstTurnExempt: true,\n};\n\n/** card id → program.',
    replace: '    { op: "shuffleDeck" },\n  ],\n};\n\n/** card id → program.',
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
    find: '      { op: "opponentSwitchOut", recordAs: "moved" },\n      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract\'s gated-step list, not a thenable (arrays are not callable).\n      { op: "recordGate", slot: "moved", then: [{ op: "damageNewActive", amount: Number(match[1]) }] },',
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
    find: 'const BENCH_SEARCH_NOUN = "(?:(Basic Pokémon)|([A-Z][a-zé]+))";',
    replace: 'const BENCH_SEARCH_NOUN = "(?:(Basic Pokémon)|([^.]+))";',
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-dest-is-the-hand",
    decision: "D230",
    what: '`dest: "hand"` — the op\'s OTHER printed value, which 41 Standard-legal printings really do spell — so the found Pokémon goes to the hand and the Bench the sentence names never grows',
    file: "packages/engine/src/effects.ts",
    find: '        { op: "searchDeck", filter, dest: "bench", max },\n        { op: "shuffleDeck" },',
    replace:
      '        { op: "searchDeck", filter, dest: "hand", max },\n        { op: "shuffleDeck" },',
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-drops-the-trailing-shuffle",
    decision: "D230",
    what: 'the program is the search ALONE — the printed "Then, shuffle your deck." unread — so a player who just looked through their deck leaves it in an order they now know',
    file: "packages/engine/src/effects.ts",
    find: '      return [\n        { op: "searchDeck", filter, dest: "bench", max },\n        { op: "shuffleDeck" },\n      ];',
    replace: '      return [{ op: "searchDeck", filter, dest: "bench", max }];',
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-plural-name-capture-dropped",
    decision: "D230",
    what: 'the name is read off the SINGULAR half only (`match[2]`, dropping `?? match[5]`) — the off-by-one-group mistake a five-group regex invites — so every plural named printing ("up to 3 Charjabug", "up to 2 Grubbin", "up to 2 Froakie") searches for ANY Basic Pokémon instead',
    file: "packages/engine/src/effects.ts",
    find: "    const name = match[2] ?? match[5];",
    replace: "    const name = match[2];",
    expectKilledBy: ["packages/engine/src/derivedBenchSearch.test.ts"],
  },
  {
    id: "D230-named-filter-is-any-pokemon",
    decision: "D230",
    what: 'the named noun derives to `anyPokemon` — a real sibling member of the same union, and the "close enough" choice — so "up to 3 Charjabug" offers every Pokémon in the deck',
    file: "packages/engine/src/effects.ts",
    find: '        name === undefined ? { kind: "basicPokemon" } : { kind: "byName", name };',
    replace: '        name === undefined ? { kind: "basicPokemon" } : { kind: "anyPokemon" };',
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
    find: "    if (max >= 1) {\n      const filter: CardFilter =",
    replace: "    if (max >= 0) {\n      const filter: CardFilter =",
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
    find: '      one === undefined ? HAND_SEARCH_PLURAL.get(many ?? "") : HAND_SEARCH_SINGULAR.get(one);',
    replace:
      '      one === undefined ? HAND_SEARCH_SINGULAR.get(many ?? "") : HAND_SEARCH_PLURAL.get(one);',
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
    find: "  /^Discard a random card from your opponent['’]s hand\\.$/;",
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
    find: '        op: "attachEnergyFrom",\n        source: "discard",',
    replace: '        op: "attachEnergyFrom",\n        source: "hand",',
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-drops-the-printed-energy-type",
    decision: "D234",
    what: 'the brace code is parsed and then thrown away, so "a Basic {F} Energy card" attaches whatever is first in the pile. The board that kills it holds two {F} and two {W} on purpose — a pile of one type cannot tell the two builds apart, which is why the deck carries three typed lines',
    file: "packages/engine/src/effects.ts",
    // \u26a0\ufe0f WIDENED AT D236, whose hand-side arm spreads the same expression:
    // the find carries the `source` line above it, which differs by the zone.
    find: '        source: "discard",\n        ...(energyType === undefined ? {} : { energyType }),',
    replace: '        source: "discard",\n        ...(energyType === undefined ? {} : {}),',
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
    find: "      // the other, never both (D205).\n      return destination.anyWay\n        ? Array.from({ length: count }, () => ({ ...base }))\n        : [count === 1 ? base : { ...base, count }];",
    replace:
      "      // the other, never both (D205).\n      return [count === 1 ? base : { ...base, count }];",
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
    find: "      // the other, never both (D205).\n      return destination.anyWay\n        ? Array.from({ length: count }, () => ({ ...base }))\n        : [count === 1 ? base : { ...base, count }];",
    replace:
      "      // the other, never both (D205).\n      return Array.from({ length: count }, () => ({ ...base }));",
    expectKilledBy: ["packages/engine/src/derivedDiscardAttach.test.ts"],
  },
  {
    id: "D234-singular-emits-an-explicit-count-1",
    decision: "D234",
    what: "a singular printing emits `count: 1` instead of omitting the field. Behaviourally identical on every board — and WRONG, because these ops are compared BY VALUE against hand-authored registry rows (D205's `absent = 1`), so a derived program would stop equalling the registry program that means the same thing",
    file: "packages/engine/src/effects.ts",
    // ⚠️ WIDENED AT D236 for the row above's reason — the same expression now
    // closes both attach arms.
    find: "      // the other, never both (D205).\n      return destination.anyWay\n        ? Array.from({ length: count }, () => ({ ...base }))\n        : [count === 1 ? base : { ...base, count }];",
    replace:
      "      // the other, never both (D205).\n      return destination.anyWay\n        ? Array.from({ length: count }, () => ({ ...base }))\n        : [{ ...base, count }];",
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
    find: "      `${zonePhrase} to ([^.]+)\\\\.${tail}$`,",
    replace: "      `${zonePhrase} to ([^.]+)\\\\.${tail}`,",
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
    find: "`^Attach (?:a Basic",
    replace: "`Attach (?:a Basic",
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
    find: "      count >= 1 &&\n      count <= MAX_PRINTED_ATTACH_COUNT\n    ) {",
    replace: "      count >= 0 &&\n      count <= MAX_PRINTED_ATTACH_COUNT\n    ) {",
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
    find: '        source: "hand",',
    replace: '        source: "discard",',
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
    find: "    const healed = match[5] !== undefined;",
    replace: "    const healed = match[4] !== undefined;",
    expectKilledBy: ["packages/engine/src/derivedHandAttach.test.ts"],
  },
  {
    id: "D236-heal-tail-never-fires",
    decision: "D236",
    what: "the other direction: the tail group is read inverted, so the ONE sentence that prints the heal derives without it and the six that do not print it derive WITH it. The pair is the point — one optional group, two printed states, and neither direction can hide behind the other",
    file: "packages/engine/src/effects.ts",
    find: "    const healed = match[5] !== undefined;",
    replace: "    const healed = match[5] === undefined;",
    expectKilledBy: ["packages/engine/src/derivedHandAttach.test.ts"],
  },
  {
    id: "D236-heal-rides-a-spread",
    decision: "D236",
    what: "\u201cthat Pokémon\u201d names ONE body, and this guard is the only thing stopping a heal tail from riding a DISTRIBUTION — N independent decisions landing on N bodies, each healing. Raised past the printed count, the guard admits it. Zero printings today, which is exactly why it is a guard: it keeps a future one from deriving a rule nobody printed",
    file: "packages/engine/src/effects.ts",
    find: "      !(healed && destination.anyWay && count > 1)",
    replace: "      !(healed && destination.anyWay && count > 2)",
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
    what: "the field guard is dropped, so `healChosen` runs at \"all\" on EVERY `attachEnergyFrom` — the six registry Abilities that have carried the op since M5, and the six of this row's nine printings that print no heal, all silently clear every damage counter off the body they feed. ⚠️ IT SURVIVED ITS FIRST RUN AND THE SUITE GAINED A CASE RATHER THAN THE ROW GAINING AN EXCUSE: every heal assertion in the slice ran on the ONE sentence that prints the clause, so nothing was watching a DAMAGED board under a tail-less sentence. That control is now the first case in section 3",
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
    find: "            : { kind: \"byName\", name: match[4] };",
    replace: "            : { kind: \"anyCard\" };",
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
    find: "      (dest !== \"bench\" || BENCHABLE_RETRIEVAL_KINDS.has(filter.kind))",
    replace: "      (dest !== \"bench\" || filter.kind !== \"supporterXX\")",
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
    find: "      const retrieveMax =\n        op.dest === \"bench\" ? Math.min(op.max, benchSpace(state, ctx.seat)) : op.max;",
    replace: "      const retrieveMax = op.max;",
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D237-bench-clamp-dropped-at-the-move",
    decision: "D237",
    what: "🛑 THE CARD-DESTRUCTION SHAPE THE M1 REVIEW NAMED. The move stops clamping, so on a full Bench the uids leave the discard pile and land NOWHERE — removed from one zone and appended to a bench the sixth slot of which does not exist. The park's clamp hides it on every board except the one where the Bench filled between the park and the answer",
    file: "packages/engine/src/interpreter.ts",
    find: "    dest === \"bench\" ? inDiscard.slice(0, benchSpace(state, ctx.seat)) : inDiscard;",
    replace: "    inDiscard;",
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
  {
    id: "D237-log-bench-row-falls-through-to-the-deck-row",
    decision: "D237",
    what: "the third arm goes and the Bench put falls into the `else`, which is EXACTLY the live mis-render this slice was added to prevent: three Pokémon entering play announced as “shuffled 3 cards from their discard pile into their deck”. A log row that states the opposite of the board is worse than no row at all",
    file: "packages/engine/src/log.ts",
    find: "          : event.dest === \"bench\"\n            ? [plain(`put ${cards} onto their Bench`)]\n            : [plain(`shuffled ${cards} into their deck`)],",
    replace: "          : [plain(`shuffled ${cards} into their deck`)],",
    expectKilledBy: ["packages/engine/src/derivedDiscardRetrieval.test.ts"],
  },
];
