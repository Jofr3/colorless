### 2026-08-15 — build session #285 (P3-M5 — D345, the printed self-Knock-Out cost, and a gate that had been accidentally right for two hundred decisions)

**Slice D345.** Engine **0.250.0 → 0.251.0**, ONE bump over FIVE sites.
`MATCH_RECORD_VERSION` **STAYS 20**, classified rather than copied: the op never
parks (so no `PendingStage` inhabitant), it has no field (so no persisted union
gains a member), and the Knock Out is rendered through the EXISTING `KNOCKED_OUT`
event.

**THE ROW.** Dusclops `sv06.5-019`/`sv06.5-069`/`sv08.5-036` and Dusknoir
`sv06.5-020`/`sv06.5-070`/`sv08.5-037` "Cursed Blast" — **6 Standard-legal
printings on 2 sentences**: *"Once during your turn, you may put 5 (13) damage
counters on 1 of your opponent's Pokémon. **If you use this Ability, this Pokémon
is Knocked Out.**"*

### ✅ THE ROW WAS CHOSEN BY D344's METHOD, AND THE METHOD'S THIRD STEP PAID

D344 refused to pre-price a successor on the evidence that the last five handoffs
that did were each wrong. It left four steps instead. Run in order:

1. **The largest live `ROWS` residue**, read off `censusAtHead.test.ts` rather
   than off the handoff: the eight rows are **10 · 5 · 4 · 3 · 0 · 0 · 0 · 0**, so
   it is **row 9** (attach from the DISCARD PILE), 5 `abilityIds` + 5 `effectIds`.
2. **Census the SENTENCE, not the card** (D340). Row 9's own note prices its
   biggest ability shape at *"NO op in this engine knocks out its own host"*, so
   the thing to census is that CLAUSE. Over all three text columns on remote D1
   `luminous`, `instr(<col>, 'If you use this Ability, this Pokémon is Knocked
   Out') > 0`:

   | column | printings | legal | sentences |
   |---|---|---|---|
   | `effect` | 0 | 0 | 0 |
   | `abilities_json` | **9** | **9** | **3** |
   | `attacks_json` | 0 | 0 | 0 |
   | **total** | **9** | **9** | **3** |

   ✅ `0 + 9 + 0 = 9`, re-added against its own parts. **Every printing of the
   clause is Standard-legal — the only family this run has censused where
   `printings === legal`.**
3. **Is the card the cheapest thing that sentence buys? NO** — D341's finding at
   its second instance. The three sentences are Dusclops (3), Dusknoir (3) and
   **Magneton "Overvolt Discharge" (3)**, and Magneton is the expensive one: its
   effect half is *"attach up to 3 Basic Energy cards from your discard pile to
   your {L} Pokémon **in any way you like**"*, a DISTRIBUTION across several
   bodies. `attachEnergyFrom.count` (D205) lands the whole batch on ONE picked
   target; `toEach` (D248) is a fold with no pick in it. **The residue named the
   family correctly and the member wrongly.**
4. **Has it shipped?** No. `grep` over the tree at `7f2b0d9` returned **four hits,
   every one PROSE** — `attackLock.test.ts`, `effects.ts` ×2 and
   `counterPut.test.ts`, each a near-miss note about the deriver refusing the
   sentence. No registry row, no program, no id-map entry.

### 🛑 AND ALL FOUR OF THOSE PROSE SITES SAID **FOUR** PRINTINGS WHERE THE CATALOG SAYS **SIX**

`sv08.5-036`/`-037` — the Prismatic Evolutions reprints — appeared **nowhere in
the repo**. Four sites, one stale enumeration, none of them visible to `tsc`, and
stale since before those reprints landed. A fifth site in
`docs/workstreams/simulator.md` said the same thing. **D343's finding reproduced:
a prose count rots exactly like an asserted one, and the only defence is grepping
the doctrine you just falsified.**

### 🛑 THE ROW FOUND A LIVE DEFECT IN A GATE, NOT ONLY A GAP IN A CATALOG

`programPlayable` (cardplay.ts) refused to play an Ability whose first op is a
`damageChosen` whenever the opponent's **BENCH** was empty. That is the
`opponentBench` reading and only that one. It had been **accidentally right for
two hundred decisions**, because every REGISTRY producer of the op was a Bench
snipe (Hawlucha, Meowscarada ex, Radiant Blastoise) and every `opponentAny`
producer was an **ATTACK** — and attacks never consult that function (§8, and
D247 had already written that zero down). Cursed Blast is the first registry
`opponentAny` row, and an opponent holding a bare Active greyed out an Ability
whose own op offers that Active as a candidate.

Fixed by sharing the op's own funnel — `snipeTargets`, exported for exactly the
reason `gustTargets` is, so the refusal and the offer read one predicate.
**A PREDICATE RE-IMPLEMENTED BESIDE ITS OP IS RIGHT UNTIL THE OP GROWS AN ARM** —
which is the insertion-order rung's lesson wearing a different hat, and this slice
paid both in one afternoon.

### THE ENGINE DIFF, AND WHY THE OP HAS NO FIELDS

`knockOutSelf` is **field-free**: the clause is byte-identical across all three
sentences that print it, so there is nothing for a field to vary over (D104's
minimal-shape rule). It **marks rather than kills** — §8.1's sweep is
`lethalRefs → planPrizes → knockOut` and is already owed to every settled program
by `resolveMidTurnKnockOuts`, so the op writes the one thing the sweep reads
(`damage >= effectiveMaxHp`) and stops. `returnSelf` has ridden that seam since
D311; this is its second consumer and the first that pays a Prize.

The KO is **not damage**: no Weakness/Resistance, no reduction passive, no
prevention, and no event of its own — a `COUNTERS_PLACED` row would say the host
took counters, which is exactly what the printed clause is not.

### ⚠️ ONE TEST WAS VACUOUS UNTIL THE ATTRIBUTION QUESTION WAS ASKED OF IT

The HP-aura case ("the maximum is read AT THE MOMENT THE OP RUNS") was first
written against an invented `fix-*` body carrying Ability TEXT and **no program**
— which raises nobody's maximum. The Dusclops would have died of its printed 90
with the assertion looking satisfied. It is now the REAL Ludicolo `sv09-037`
(D324's `seatHpBonus`, +40 seat-wide), with `programFor` asserted DEFINED first
and the Knock Out asserted BY UID. **A fixture that carries the words is not a
fixture that carries the mechanism** — the same defect this repo has now caught
nine times, found here in this slice's own new file.

### CENSUS — EVERY SPLIT RE-ADDED AGAINST ITS OWN TOTAL

`BUILT.ability` 252 → **258**; `built` 1567 → **1573** (1198 + 258 = 1456, + 109 =
1565, + 8 = **1573**); residue 816 → **810** (2383 − 1573); the three-column sum
369 → **375**; `raw.length` 676 → **682** and `nonAttackRegistryIds()` 532 →
**538**, **0 wide** for the sixth slice running; the four-list closure **538**;
`ABILITY_D1_SHAPE` 252/115 → **258/117**; `ABILITY_D1_COLUMNS` 239/252 →
**245/258**, and `258 − 245 = 13` closes the attack-gate identity again; program
objects 104 → **106**; the (name, object) JOIN 117 → **119**; `LANDED` 51/101 →
**53/107**. The `BUILT.ability` decomposition gained **TWO** terms — the first
multi-term addition since D263.

**Measured unmoved, not assumed:** `BUILT.attack` **1198** on all three summands
(1169 raw / 16 registry / 13 split), `BUILT.trainer` **109**, `BUILT.specialEnergy`
**8**, `units` **2383**, `classified.size` **44**, `swept.size` **103**,
`REVEALING` **29** / `NOT_REVEALING` **15** / `DROPPED` **2**. All six new ids
carry `effect IS NULL` AND `category = 'Pokemon'` on the remote D1 (2026-08-15),
so no Trainer reader and no Energy reader can see them, and neither registry entry
carries an `attack` key.

**A ROW CAN BE HALF-ADMISSIBLE TO THE SHARED POOL.** `sv06.5` IS among
`catalogManifest`'s six sets and `sv08.5` is not, so four of the six ids could have
gone in `FIXTURE_POOL` and two could not. The suite drives all six off a LOCAL
`cardPool` (D275's idiom) and owes no `fix-*` key at all — **the rule is per CARD,
not per printing.**

### THE ORDER THE FAILURES CAME IN, OBSERVED RATHER THAN ASSUMED

On the tree carrying the registry rows and nothing else, `censusAtHead.test.ts`
went red in exactly **TWO tests** — `raw[raw.length - 1]` (the INSERTION-ORDER
rung, red on an untouched constant for the FOURTH time) and the partition, which
named exactly the six ids. Every FIGURE stayed green until it was bumped by hand,
because each is asserted THROUGH a constant no registry row can move.
**2 red, 11 constants wrong** — D278's "N red ≠ N wrong" at the widest ratio this
run has recorded.
