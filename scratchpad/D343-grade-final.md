# D343 — PREDICTION GRADE, completed at `e9dfd05` by the continuation run

The original run wrote a self-grade into `D343-prediction.md` ("written after the
build, before the sweep finished"). That grade is **verified and extended** here.
Every figure below was re-derived from source at `e9dfd05`, not inherited.

## The original grade's clauses, re-checked

All 51 claimed hits re-verified as stated, with two corrections of scope:

* Claim 12's list re-measured pin-by-pin at `e9dfd05` — `BUILT.attack` 1198
  (1169 raw / 16 registry / 13 split), `.ability` 252, `.trainer` 108,
  `.specialEnergy` 8, `built` 1566, residue 817, `unbuiltAttack` 534,
  `raw.length` 675, `nonAttackRegistryIds` 531, `units` 2383,
  `TRAINER_TERMS` 57. **All UNMOVED and MEASURED so** — `censusAtHead.test.ts`
  and `precociousEvolution.test.ts` carry ZERO diff between `5827be3` and
  `e9dfd05`. The claim is a hit for the reason it gave.
* Claim 28's "exactly 4 biome re-wraps" is consistent with the diff to
  `legalNonAttackPrograms.test.ts` (four `matchesFilter` statements re-wrapped).

## MISS 6 — CLAIM 14, AND THE SELF-GRADE NEVER SCORED IT

🛑 **The original grade lists claim 14 in NEITHER its hits nor its misses.** An
incomplete enumeration is a miss, and this one is a miss twice over, because the
claim is also false:

> **14. U** `classified.size` **39**, `swept.size` **27** (`revealClause`) —
> `reorderTop` is not a search op.

Measured at `e9dfd05`: **`classified.size` 39 → 44** and **`swept.size` 27 →
103**. Both moved, and D343 moved them itself.

The reasoning inside claim 14 is sound in isolation — `reorderTop` really is not
a search op, so *the build* moves neither figure. What the claim missed is that
**§6 of the same prediction promised to move exactly these two numbers**: "the
right population is the registry …, `swept.size` rises well above 27". §5b and §6
of one document contradict each other, and the self-grade scored §6 ✅ without
noticing that scoring it ✅ falsifies §5b claim 14.

**This is the same defect the prediction diagnosed in its own closing paragraph,
one level up: a fact that lives in the AGREEMENT BETWEEN ARTEFACTS rather than in
any one of them — here, the agreement between two sections of one file.** D342
lost six on "not a count". D343 lost five on "not in one place" — and lost a
sixth on "not consistent with itself".

## CLAIM 18 — ungraded, and a HIT

Also absent from both lists. Claim 18 predicted `EffectOp`'s `reorderTop` member
field set moves `{n, side?}` → `{n, side?, from?}` and that **no auditor
enumerates that member's keys**. Verified: the key-set auditors in this repo
(`derivedHandAttach`, `derivedDeckSearchAttach`, `derivedDiscardAttach`,
`tailsGatedOp`, `derivedSelfEnergyMove`, `attackLock`) enumerate keys for
DERIVED ops only; every `reorderTop` assertion in the suite
(`derivedSearchTopOrder.test.ts:354`, `derivedReorderTop.test.ts:423`) is keyed
on the op NAME sequence. The field set moved and nothing audited it. **Hit,
mechanism and all.**

## REVISED SCORE

**52 hits, 6 misses.** (+1 hit for claim 18, +1 miss for claim 14, both of which
the mid-flight self-grade left unscored.)

## THE NON-COUNT RUNG THE SLICE MOVED AND DID NOT REPAIR — found by this run

Claim 21/22/23 named three "refusals with a shelf life" and repaired them. It
missed a fourth family, and it is the biggest one in the slice:

**Eight prose sites across six files state that staying out of `FIXTURE_POOL` is
what keeps `revealClause`'s `swept.size` still — and name the figure 27.** After
D343 repointed the sweep at `registryCardIds()` ∪ the pool, that doctrine is
false in the NUMBER *and* in the MECHANISM: a registry-keyed program is swept
whether or not its suite seats a shared body. Five consecutive slices (D338–D342)
copied the reasoning forward. Nothing reddens, because a number in a comment is
not a rung — which is exactly the category the standing lesson names.

Sites corrected by this run: `registry.ts` ×2, `derivedReorderTop.test.ts`,
`freezingShroud.test.ts` ×2, `familialMarch.test.ts`,
`legalNonAttackPrograms.test.ts`, `lickingCatch.test.ts`.
`preventBlock.test.ts:800` is left alone — it DIAGNOSES the defect and its
statement is still true history.

⚠️ **AND ONE OF THOSE SITES WAS ALREADY ROTTEN BEFORE D343 EXISTED**:
`derivedReorderTop.test.ts:843` also carried `raw.length` (672). It has been
**675** since D342, and no check has ever cared.
