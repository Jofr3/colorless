# Progress — living status

> Update this at the **end of every session**: bump the status table, append a
> session-log entry, and rewrite the **Resume point** to the next concrete action.

**Last updated:** 2026-07-21 — build session #29 (**P3-M5: the `providesEnergy`
CardFilter — "an Energy that PROVIDES {X}"**). The energy-removal family's last
missing piece, and the **first filter a CARD alone cannot answer**. Two claims:
**PROVISION, NOT PRINT** — "{L} Energy" is not "a Basic Lightning card"; a Special
providing {L} IS one, and a WILDCARD (Luminous) is an Energy of EVERY type; and
**HOST, NOT CARD** — provision is a while-ATTACHED property that Luminous's own
clause makes depend on the holder's other attachments, so the identical card is a
{L} Energy on one board and not on another. `attachedEnergies` answers it per
Energy ON ITS HOST; the card-only pile scanner `matchesFilter` answers **false**
(a card in a pile is attached to nothing), making a mis-authored pile scan a LOUD
NO-OP rather than a wrong card. `continuous.ts` was **split, not copied**, so the
filter and §8.2's cost matcher share one `unitsOf` — **what can PAY a {L} cost is
exactly what a "{L} Energy" effect can take**. **TWO consumers, one vocabulary**
(the D40 shape, and the whole reason this is a filter rather than a field): the
**typed self-discard**, DERIVED in both printed notations — the modern `{R}` and
the swsh-era spelled-out `Fire` — landing **5 catalog rows with ZERO registry
rows** (Kilowattrel, Arcanine ex ×2, Charmeleon, Charizard); and **`moveEnergy`'s
new `benchToActive` route**, authoring **Armarouge ×2** ("Fire Off"). Written into
`ptcg-rules.md` as **§6.5**. engineVersion 0.23.0 → **0.24.0**; 1268 → **1301**
tests, `bun run check` + `vite build` green. **Review (2 adversarial agents,
engine+rules with 49 mutants / web+integration): NO HIGH from either.** The engine
agent ran the deriver over **all 1108 text surfaces of all 978 catalog rows**
(exactly 5 matches, zero false positives, zero misses), threw **36 hostile
`resolveEffect` inputs** at both new prompts (zero throws, zero mutation), and
verified all five new fixtures byte-for-byte. Fixes applied: **`ENERGY_MOVED.to`
no longer spreads the client's object** (a hostile `dest` smuggled arbitrary keys
into an event the animator/log/P4-broadcast consume); `energyType` tightened to
**`BasicEnergyType`** so the one forbidden value (Colorless — the fallback every
unauthored Special provides) is unrepresentable; the route's "an Active exists"
guard **collapsed from three untested copies to one**; a **`fix-blend`** fixture
for a Special providing two distinct types (the predicate's `.includes` was
indistinguishable from "first unit only"); plus `moveNote`'s article, an orphaned
JSDoc, the web `promptKey`, a `<output>` live region, and **two DOM tests the web
agent proved missing by mutations that passed all 1297 tests** (the
multi-destination pick, and `reset()` on source change). See D44.

---
### Prior header (P3-M5 the discardEnergy ATTACK arms, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #28 (**P3-M5: the `discardEnergy`
ATTACK arms — the opponent-side twins + the exact-N `count`**). No new op: two
extensions of D41/D42's `discardEnergy`, both **DERIVED from printed text**, so
**11 catalog rows land with ZERO registry rows**. (1) The hammer family's **attack
TWINS** — "Discard an Energy from your opponent's Active Pokémon.", bare and behind
a flip — run the EXISTING `opponentActive` arm with an `anyEnergy` filter
(**Pincurchin, Gumshoos, Dragonite V ×2; Dedenne, Maschiff, Tympole, Yveltal**).
They are the first ops to park a decision about the **OPPONENT's** board mid-attack,
and needed NO new machinery: D42's `attackEpilogue` carries the tail and
`coinFlipGate` already splices its branch into the queue. (2) The **exact-N
self-discard** — `count` widens from `"all"` to any number (**Corviknight**,
**Slither Wing** 2; **Koraidon** 3). The prompt's `scope` becomes
**`{kind:"total",count} | {kind:"each"}`**, and the D42 collapse is **CAPPED at
`count` per class rather than flattened to 1** — that is the design insight of the
slice: flattening would erase a distinguishable answer ("discard both Fighting"),
while the cap still drops every copy that could ONLY duplicate, so four identical
{F} with count 3 stays forced. **`forcedDiscards` then folds the SHORT board into
the same comparison** — "auto-resolve when the offer is ≤ count" IS both the M1
no-choice rule and §8.6 "do as much as you can" (added to `ptcg-rules.md` this
session, corroborated on-card by Sandaconda). **Anchoring is load-bearing beyond
any earlier deriver slice:** Krookodile prints "Flip a coin **until** you get
tails. For each heads, discard an Energy…" — it ENDS in the twin's exact words.
engineVersion 0.22.0 → **0.23.0**; 1250 → **1268** tests, `bun run check` +
`vite build` green. **Review (adversarial engine+rules with 48 mutants /
web+integration): NO HIGH in the slice's own logic from either.** The engine agent
checked all five regexes against all 978 catalog rows (11 matches, zero false
positives/misses) and brute-forced the collapse math over 7770 configurations. The
web agent found **one HIGH beside the slice**: `ENERGY_DISCARDED` named its host by
SPOT, and an attack twin strips a defender its own damage Knocked Out in the SAME
batch — so the log re-read an empty slot and printed "from Tide's the Active spot".
The event now carries **`host`** (the top-card uid — the KNOCKED_OUT precedent).
Of 10 surviving mutants 1 was a real hole (the **`each`-scope cap of 1** was
entirely unpinned), 4 were unpinned regex anchors, 1 pre-existing outside the slice
(`moveEnergy`'s duplicate-uid check), 4 equivalent; all now dead. See D43.

---
### Prior header (P3-M5 attack programs can PARK, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #27 (**P3-M5: ATTACK EFFECT PROGRAMS
CAN PARK — the `attackEpilogue` stage, and the §8 self-discard attack cost**). The
top backlog row and the biggest remaining structural unlock, diagnosed by D41 and
built as one STAGE, not one op. `attack.ts` ran an attack's effect program as
`runProgram(...).state`, silently DROPPING a parked prompt and every op behind it.
The fix **inverts the order — queue the tail first, then run the program**: new
`PendingStage` **`{kind:"attackEpilogue", seat, koedSeat}`** carrying the §8.1 KO
sweep + the §5.3 turn end, **`finishAttack` moved from attack.ts into flow.ts**
(exported, so `advance` can reach it), and the fold goes through
**`settleProgram(..., {resumeTail:true})`**. A DONE program drains straight into
the stage (identical to the old inline call, one hop later); a PARKED one leaves it
in `pending` until `resolveEffect` finishes the program — across any number of
re-parks — and drains it then. **`resumeTail` is deliberately REDEFINED** from "this
program is mid-KO-sweep" to "this program is mid-TAIL, the stages that finish the
job are already queued behind it"; the only consumer that must tell the two apart is
the projection (`koParkActiveSeat` gained `attackEpilogue` as an in-turn marker).
**The family that proves it is DERIVED, not authored:** `discardEnergy` gained a
**`yourActive`** arm and a **`count:"all"`** rider, and two anchored whole-sentence
deriver rules land **12 catalog rows with ZERO registry rows** — Houndoom ×2,
Charcadet, Staraptor, Paldean Tauros, Dedenne ex ×2, Bombirdier ("Discard an Energy
from this Pokémon.") and Pawmot ×2, Raichu ×2 ("Discard all Energy…"). Third idea:
**interchangeable candidates COLLAPSE** — one representative per (host, energy
identity), so a Houndoom attacking with three {R} asks nothing. `ENERGY_DISCARDED`
gained **`actor`** (victim and actor are the same seat for a self-discard).
engineVersion 0.21.0 → **0.22.0**; 1227 → **1250** tests, `bun run check` +
`vite build` green. **Review (adversarial engine+rules + web+integration): NO HIGH
from either**; 56 mutants between them, **9 survivors, all now dead**. The sharpest
catch: the collapse keyed on catalog **id**, but the real catalog prints Basic Fire
Energy under three ids (sve-002/010/018) — an id key would have parked a real deck
on a non-choice and broken the slice's own headline claim, so a Basic now keys on
what it **provides**. See D42.

---
### Prior header (P3-M5 discardEnergy, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #26 (**P3-M5: `discardEnergy` — the
energy-removal "hammer" family, and the coin-gate playability bug it exposed**). One
new op takes Energy off the **OPPONENT's** in-play Pokémon; **`from` names both the
eligible Pokémon and how many are hit** — `opponentActive` (Mawile), `opponentChosen`
(Crushing Hammer), `opponentEach` (Giacomo) — and all three arms land with a REAL
printed card. Exactly one Energy per affected Pokémon (no `count`: every "discard 2 /
discard all" variant is an ATTACK, which cannot park). **The engine's first MANDATORY
park** — every prior parking op was "up to" or exactly-one; here the only question is
WHICH Energy, so an empty pick is an ERROR, not a decline. `opponentChosen` is a
ONE-step decision (picking the Energy IS picking the Pokémon), so unlike `moveEnergy`
there is no coupling to validate. New `specialEnergy` CardFilter; one
`ENERGY_DISCARDED` event **per affected Pokémon**; the card goes to its **OWNER's**
pile. Lands **3 COMPLETE real cards**: **Crushing Hammer** (sv01-168), **Giacomo**
(sv02-182/252/267), **Mawile** (sv03-143, an onPlayToBench trigger). engineVersion
0.20.0 → **0.21.0**; 1196 → **1227** tests, `bun run check` + `vite build` green.
**Review (adversarial engine+rules + web+integration): no HIGH in the slice's own
logic from either — but the engine review REVERSED a documented decision of mine, and
that is the session's most important outcome.** I had shipped Crushing Hammer as
playable into an Energy-less board ("the flip happens either way"); §7 / Compendium
[ruling/906](https://compendium.pokegym.net/ruling/906/) (reconfirmed by the TPCi
Rules Team **2025-06-26**) says otherwise, because **a coin flip is PROCEDURE, not
effect**. `programPlayable` now DESCENDS into `coinFlipGate.then` — which also fixes a
**pre-existing** bug: Pokémon Catcher was likewise playable into an empty opponent
Bench. Poké Ball is deliberately untouched (a deck is not public knowledge). The
engine agent's 45-mutant run left 5 real survivors, all test-adequacy, all now dead;
the web agent's 3 MEDs are all fixed. See D41.

---
### Prior header (P3-M5 board conditions, kept for continuity)
**Last updated (was):** 2026-07-21 — build session #25 (**P3-M5: board conditions — one
`BoardCondition` vocabulary with TWO consumers**). The `conditionalPlay` backlog
family, built as a primitive rather than a per-card flag. **`BoardCondition`** is a
predicate union evaluated for one seat — `morePrizesThanOpponent` (strict `>`),
`yourStadiumInPlay`, `noEnergyOnYourPokemon` — behind one evaluator `conditionHolds`
+ a describer `conditionNote`. **Its invariant is the design:** every member reads only
PUBLIC state, so **a gate emits NO event** (unlike `coinFlipGate`, whose flip IS new
information — a board condition is a fact both players already see). Consumer A is the
printed **PLAY GATE** `CardProgram.trainerPlayableIf`, checked BEFORE the card leaves
hand (new `ErrorCode` `PLAY_CONDITION_NOT_MET`) — a rule PRINTED on the card, unlike
`programPlayable`'s would-only-whiff heuristics. Consumer B is the mid-program
**`conditionGate`** op `{cond, then, otherwise?}`, spliced into runProgram's queue
exactly like `coinFlipGate` (so an op inside a branch can still park); `otherwise` is
the printed "…**instead**", a genuine if/ELSE. Plus one tiny automatic op
**`drawUntilHandSize`** — it DRAWS to a floor and never TRIMS a bigger hand, and
no-ops with NO event at a count ≤ 0. Lands **3 COMPLETE real cards**: **Fighting Au
Lait** (sv02-181), **Falkner** (sv02-180/251), **Grusha** (sv02-184/253/268).
**Web: zero new events, prompts, dialogs or projection fields** — the only change is
the HUD greying a gated Trainer out with the engine's own predicate, carrying
`conditionNote` as the row tooltip (disabling the button REMOVES the reject pill that
used to explain the printed rule). engineVersion 0.19.0 → **0.20.0**; 1164 → **1196**
tests, `bun run check` + `vite build` green. **Review (adversarial engine+rules +
web+integration): NO HIGH from either.** The engine agent verified the riskiest claim
— `yourStadiumInPlay` is **OWNERSHIP, not presence** — against the Japanese printing
of ハヤト (「場に**自分の**スタジアムが出ているなら」); an opponent's Stadium must not
grant Falkner's +2. Its 24-mutant run left 5 survivors (1 equivalent), all
test-adequacy, all now fixed and re-verified dead via two new fixtures
(**fix-gateorder**, **fix-gatedsup**). The web agent's 4 MEDs are all addressed
(engineVersion bump, log-row tests, a self-defeating P4 claim in a doc comment, and
the HUD's opponent-`prizes` read → recorded as a P4 item). See D40.

---
### Prior header (P3-M5 Iono, kept for continuity)
**2026-07-21** — build session #24 (**P3-M5: Iono — the `handRefresh`
riders that CLOSE the hand-refresh family**). The format's highest-play-rate Supporter
needed **no new op**: three composable riders on the D38 op — **`toBottom`** (shuffle
the **hand alone** and put it UNDER the deck, so the deck's order — and the next draws
— SURVIVE; the whole strategic difference from Judge, pinned by a test asserting the
drawn cards are exactly the pre-play deck top, in order), **`draw:{kind:"prizeCount"}`**
(each player draws their OWN remaining Prizes — the player behind draws more; a public
count, so no leak), and **`onlyIfAnyMoved`** (the draw fires only if ≥1 affected player
moved a card — an all-or-nothing gate ACROSS seats, "if EITHER player…"). That
cross-seat gate forced one structural change: `handRefresh` now runs **two passes**
(all placements, then all draws) instead of interleaving per seat — **behaviour-
preserving** for Youngster/Judge/Brassius/Katy (per-seat-disjoint zones + `drawToHand`
consumes no rng ⇒ byte-identical states and rng, verified by reconstructing the old
loop), the only change being Judge's event interleaving. One new count-only event
**`HAND_TO_BOTTOM_OF_DECK`**; one log row; no dialog (the op still never parks); no
projection change. engineVersion 0.18.0 → **0.19.0**; 1156 → **1164** tests, `bun run
check` + `vite build` green. **Review (adversarial engine+rules + web+integration): no
HIGH; 2 MED, both FIXED.** The engine MED came from **mutation testing** — deleting the
hand shuffle left all 379 engine tests green (order-insensitive assertions, nothing
asserted `rngState`) → added the two assertions that kill it. The web MED (raised
independently by BOTH agents) was the log copy implying Iono does NOT shuffle → now
says both verbs. LOWs applied: an Iono degenerate-deck test, a describe rename, and a
real end-to-end log test pinning the grouped 5-row batch. **Deliberate deviation
(recorded, not accidental):** Iono into two empty hands is a total no-op yet stays
LEGAL — no `programPlayable` gate, because a gate would have to reach into "playTrainer
discards the played card up front". **The family is CLOSED** (no Marnie in sv01–03).
See D39.

**2026-07-20** — build session #23 (**P3-M5 op-slice:
`handRefresh`** — shuffle your hand into your deck, then draw; the Iono/Judge/Marnie
hand-refresh Supporter family). New op `{who:"you"|"both", draw}` — the FIRST op in a
new class: **fully AUTOMATIC** (no decision → it NEVER parks, like drawCards/
discardHand/shuffleDeck) AND it can affect the **opponent** (`who:"both"`, Judge — the
first op to reach the OPPONENT's hand/deck). Per affected seat (controller first, then
— for `both` — the opponent) it captures the PRE-shuffle hand size, moves the whole
hand into the deck, shuffles the combined pile (one rng advance), then draws per
**`HandRefreshDraw`**: `{fixed count}` (Youngster 5, Judge 4, Katy 8) or `{handPlus
delta}` (Brassius hand+1). **Card conservation** is a pure multiset move
(`[...deck, ...hand]` → shuffle → draw back), invariant under every degenerate zone
state; `rngState` is threaded fresh each iteration (the two-shuffle Judge has no stale
reuse). Always playable (no gate); never damages/KOs. **Katy "your turn ends"** lands
the `endsTurn` fold on the TRAINER path — a new CardProgram flag **`trainerEndsTurn`**
that `playTrainer` passes to `settleProgram`, folded byte-for-byte like Koraidon's
`AbilityProgram.endsTurn` (D34); non-Katy trainers pass `endsTurn:false` → byte-
identical, no regression. One new count-only event **`HAND_SHUFFLED_INTO_DECK {seat,
count}`** (the deck reorder is intrinsic — no separate `SHUFFLE`). Lands **4 COMPLETE
real Supporters** (verified vs local D1): **Youngster** (sv01-198), **Judge**
(sv01-176), **Brassius** (sv03-187), **Katy** (sv01-177/237). **Web: one log row, no
dialog** — handRefresh never parks, so no new `EffectPrompt`/dialog (GameHud
untouched); one count-only `HAND_SHUFFLED_INTO_DECK` row, the draw riding the existing
count-only `CARDS_DRAWN`. **Hidden info (Judge — the first op to touch the opponent's
hand): leaks NOTHING new** — the opponent's `CARDS_DRAWN` uids are the standard
`drawToHand` contract; the log arms are count-only and the projection already redacts
the opponent's hand to uid-less backs. **Adversarial review (engine+rules + web+
integration): BOTH CLEAN, no HIGH/MED, NO code fixes** (card conservation over all
four degenerate zone states, two-shuffle rng threading, handPlus timing, the Katy
endsTurn fold with no regression across the full 374-test engine suite, purity, all
four texts byte-matching the catalog, Judge hidden-info safe on both log + projection).
engineVersion 0.17.0 → **0.18.0**; 1146 → **1156** tests, `bun run check` + `vite
build` green. INFO (not bugs): an empty hand emits `count:0` (honest, non-leaky — the
`HAND_DISCARDED "(0 cards)"` precedent); no-separate-`SHUFFLE`-event is cosmetic with
no consumer. Closes the `shuffleHandIntoDeck` + `endTurn` backlog rows. See D38.

## Resume point
**The `providesEnergy` filter is live (P3-M5, D44) — engine 0.24.0.** "An Energy
that PROVIDES {X}", read by TWO ops: the DERIVED typed self-discard (5 catalog
rows, zero registry rows) and `moveEnergy`'s new `benchToActive` route (Armarouge).
Provision is read **on the host**, through the same `unitsOf` §8.2's cost matcher
reads, so what can pay a {L} cost is exactly what a "{L} Energy" effect can take;
`matchesFilter` answers false for pile scans. **The energy-removal family is now
FILTER-COMPLETE** — every card still unauthored in it is blocked by sentence
STRUCTURE, not by a missing predicate.
**Next concrete actions:**
1. **The from-the-top attach variant** (Electric Generator / Hydreigon — also 2 of
   the remaining `attachEnergyFrom` cards): `lookAtTopN` finds the Energy, and the
   new variant ATTACHES it rather than putting it in hand.
2. **`discardFromHandCost`** (Ultra Ball / Superior Energy Retrieval / Earthen
   Vessel / Revavroom / Tinkaton). Shares the printed "You can use this card only
   if…" wording but is NOT a `BoardCondition` — a COST with a card CHOICE, so it
   must PARK before the effect runs.
3. **Sentence STRUCTURE, the energy-removal family's remaining shape** — an
   optional discard that BUYS an effect (Bellibolt ex), a variable count with
   damage scaling off it (Chien-Pao ex, Mewtwo VSTAR), a rider clause (Sandaconda,
   Eiscue ex, Weavile), a repeat count (Krookodile).
4. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer; `passivesOf` takes no seat today) and **Dendra**
   (a choose-from-hand → BOTTOM park, mandatory-exactly-one).
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat` (the
   searchDeck deck-uid leak), D40's `stadium.owner` + `prizesRemaining` projection
   additions, and the **engine-exported preview predicates** the HUD needs (which
   would also close the Ability-button gap below).
**Recorded, NOT fixed (this slice):** the typed candidate set is SNAPSHOTTED, so
discarding one Special cannot un-demote a survivor — unreachable today (a wildcard
is only a candidate when it is the SOLE Special), and it activates with the first
typed Special Energy authored. **Charizard's "Burn Brightly"** ("Each basic Fire
Energy attached to your Pokémon provides {R}{R}") is itself a PROVISION modifier
and `unitsOf` has no hook for a Pokémon Ability that changes provision — provision
is print + `EnergyProgram` only, so authoring it widens the model BOTH this filter
and the cost matcher read. **`usableAbilities` is the only HUD button family with
no playability gate** (no `programPlayable`), so an as-often-as-you-like Ability's
button never greys and the invited repeat click yields an error pill once the bench
runs dry — pre-existing (Baxcalibur, Gardevoir ex), made routine by Armarouge.
**Carried forward (pre-existing, NOT this slice):** every authored Supporter still
has `legal_standard=0` in the local ingest; **`GameLog` announces only a batch's
LAST row** to screen readers; `GamePage`'s `passDisabled` phase check is untested;
Fighting Au Lait is still playable with nothing damaged anywhere; `validateChoice`
does not pin a multi-count pick to a single host; and from D42 the attack epilogue
sweeps ONE seat, so a KO an attack inflicts on the ATTACKER's own board is missed —
**do that before landing any self-damaging attack text** (sv01-038 Skeledirge is
one deriver sentence away).

---
### Prior resume point (P3-M5 the discardEnergy ATTACK arms, kept for continuity)
**The `discardEnergy` ATTACK arms are live (P3-M5, D43) — engine 0.23.0.** Two
extensions of one op, both derived, **11 catalog rows / zero registry rows**: the
opponent-side **twins** (bare + coin-gated, on the existing `opponentActive` arm)
and the **exact-N** self-discard (`count` widens from `"all"` to a number). The
prompt's `scope` is now `{kind:"total",count} | {kind:"each"}`; the interchangeable
collapse keeps **`count`** representatives per class rather than 1, and
`forcedDiscards` auto-resolves whenever the collapsed offer is ≤ count — one
comparison serving both the M1 no-choice rule and the new §8.6 "do as much as you
can". `validateChoice`'s one-per-Pokémon rule is now `"each"`-only; `opponentEach`
+ a numeric count is unrepresentable (`count?: never`). `ENERGY_DISCARDED` gained
**`host`** (the top-card uid): the log had been naming the host by SPOT, which an
attack twin breaks by stripping a defender its own damage Knocked Out in the same
batch.
**Next concrete actions:**
1. **The `providesEnergy` CardFilter — the ONE primitive that closes this family.**
   "An Energy that PROVIDES {X}", which is **NOT** `basicEnergy` + type: a Special
   Energy providing {L} counts and one providing {C} does not, so it must read
   `continuous.ts providedEnergy`'s model (an authored EnergyProgram's `provides`,
   the `ANY_ENERGY` wildcard, and `demoteWithOtherSpecial`, which is BOARD-dependent
   — the first filter whose answer depends on more than the card). Lands
   **Kilowattrel** ("a {L} Energy"), **Arcanine ex ×2** ("2 {R}" — typed AND
   exact-N, so it composes with this slice), **Charmeleon** / **Charizard** (the
   older spelled-out "a Fire Energy" / "all Fire Energy"), and its natural second
   consumer is `moveEnergy` for **Armarouge**'s benched→Active {R} — the D40
   two-consumers shape again.
2. **`discardFromHandCost`** (Ultra Ball / Superior Energy Retrieval / Earthen
   Vessel / Revavroom / Tinkaton). Shares the printed "You can use this card only
   if…" wording but is NOT a `BoardCondition` — a COST with a card CHOICE, so it
   must PARK before the effect runs.
3. **The from-the-top attach variant** (Electric Generator / Hydreigon — also 2 of
   the remaining `attachEnergyFrom` cards).
4. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer; `passivesOf` takes no seat today) and **Dendra**
   (a choose-from-hand → BOTTOM park, mandatory-exactly-one).
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat` (the
   searchDeck deck-uid leak), and D40's `stadium.owner` + `prizesRemaining`
   projection additions.
**Carried forward (pre-existing, NOT this slice):** every authored Supporter still
has `legal_standard=0` in the local ingest; **`GameLog` announces only a batch's
LAST row** to screen readers — this slice sharpens the ranking of what gets
silenced (the swallowed row is now the one describing resource loss on the OTHER
player's board: an opponent-side discard is followed by TURN_ENDED or
KNOCKED_OUT/PRIZES_OWED, so it is never spoken); `GamePage`'s `passDisabled` phase
check is untested; and Fighting Au Lait is still playable with nothing damaged
anywhere. **Recorded, NOT fixed:** `validateChoice` does not pin a multi-count pick
to a single host, so a future "discard 2 Energy from 1 of your opponent's Pokémon"
(`opponentChosen` + count) would accept one Energy off each of two Pokémon —
unreachable today because the deriver is the sole author of a numeric count
(loudly commented in cardplay.ts). Also still open from D42: the attack epilogue
sweeps ONE seat, so a KO an attack inflicts on the ATTACKER's own board is missed
— **do that before landing any self-damaging attack text** (sv01-038 Skeledirge is
one deriver sentence away, and widening to `SEATS` makes the §14 double-KO tie
guard reachable from the attack path for the first time).

---
### Prior resume point (P3-M5 attack programs can PARK, kept for continuity)
**Attack effect programs can PARK (P3-M5, D42) — the `attackEpilogue` stage.** The
top backlog row is done, and it is a MECHANISM, not a card family: every future
attack effect may now hold a decision. `attack.ts` used to run an attack's effect
program as `runProgram(...).state`, so a parked result dropped the prompt AND the
remaining ops. Now the tail is **queued before the program runs** — a new
`PendingStage` **`{kind:"attackEpilogue", seat, koedSeat}`** carrying the §8.1 KO
sweep + the §5.3 turn end — and the fold goes through `settleProgram`'s
**`resumeTail`**. `finishAttack` moved into flow.ts (exported) because `advance` must
reach it and attack.ts already imports flow.
**`resumeTail` now means "mid-TAIL", not "mid-KO-sweep"** — the stages that finish
the job are queued behind the park, so DONE means keep draining. Its two producers
differ only for the projection: an on-KO park's `phase.seat` is NOT the turn owner,
an attack park's IS, and `koParkActiveSeat` resolves both off the pending queue
(`attackEpilogue` joined `endTurn`/`checkup`/`resumeTurn` as an in-turn marker).
**The first family is DERIVED, so it costs no registry rows:** `discardEnergy`
gained **`from: "yourActive"`** (the controller's own Active — for an attack, the
printed "this Pokémon", §8) and **`count: "all"`**, and two anchored whole-sentence
deriver rules cover **12 catalog rows**: Houndoom (sv01-034, sv03-133), Charcadet,
Staraptor, Paldean Tauros, Dedenne ex (×2), Bombirdier; Pawmot (×2), Raichu (×2).
**Interchangeable candidates COLLAPSE** to one representative per (host, energy
identity) — a Houndoom attacking with three {R} asks nothing (the M1 no-choice
doctrine applied to card identity, via `attachEnergyFrom`'s fungibility precedent).
A **Basic** Energy's identity is what it PROVIDES, not its catalog id: the real
catalog prints Basic Fire Energy under sve-002/010/018, and an id key would park a
real deck on a non-choice. This also CHANGED D41's hammer arms (two copies of one
print on one Pokémon now auto-resolve — the improvement; three D41 tests moved to
two DISTINCT prints to keep testing a park). `ENERGY_DISCARDED` gained **`actor`**,
since victim and actor are the same seat for a self-discard and the log's old
`otherSeat` inference would have credited Houndoom's own cost to its opponent.
engineVersion 0.21.0 → **0.22.0**.
**Review (adversarial engine+rules + web+integration): NO HIGH from either.** 56
mutants, 9 survivors, ALL now dead. Fixes applied: the provision-vs-id key above; a
**`PHASE_DESYNC` guard** on `resolveEffect` for a `resumeTail` park with an EMPTY
queue (that fold writes no phase of its own, so it would loop forever);
`finishAttack` now **COMPOSES** with the queue instead of overwriting it, which makes
the epilogue's `popStage` load-bearing rather than redundant; the log row names the
host's **OWNER** (a mirror match printed an identical row for both boards, and a
pronoun cannot fix it — the `who` chip is viewer-relative while the segments are
fixed text); the dialog legend carries the `opponent` marker its sibling already
uses; `count:"all"` rows fold repeats into "×N"; and the effect:choose dialog is
keyed on the PROMPT so two parks in one turn cannot inherit a stale pick.
**Recorded, NOT fixed (loudly commented in flow.ts):** the epilogue sweeps ONE
seat, so a KO an attack inflicts on the ATTACKER's own board is missed. Unreachable
today, but **sv01-038 Skeledirge** ("This Pokémon also does 30 damage to itself.")
is one deriver sentence away — and widening it to `SEATS` makes the §14 double-KO
tie guard reachable from the attack path for the FIRST time, so it wants its own
slice with its own tests. **Do that before landing any self-damaging attack text.**
**Next concrete actions:**
1. **The opponent-side attack twins, now unblocked** — **Pincurchin**, **Gumshoos**
   ("Discard an Energy from your opponent's Active Pokémon") and **Dedenne /
   Maschiff / Tympole** (the same behind a coin flip). One deriver sentence each on
   the EXISTING `opponentActive` arm; the park machinery is already there. Cheapest
   remaining work in the whole family.
2. **The self-discard prints that need op vocabulary, not park work:** an
   **exact-N** discard (Corviknight "discard 2", Koraidon "discard 3", Arcanine ex,
   Sandaconda, Slither Wing — a mandatory park with an exact count > 1, which
   `validateChoice` already almost expresses) and an **energy-of-type** filter
   (Kilowattrel's "a {L} Energy" — careful: "{L}" means an Energy that PROVIDES {L},
   so Special Energy counts; it is not `basicEnergy` + type).
3. **`discardFromHandCost`** (Ultra Ball / Superior Energy Retrieval / Earthen
   Vessel / Revavroom / Tinkaton). Shares the printed wording "You can use this card
   only if…" but is NOT a `BoardCondition` — a COST with a card CHOICE, so it must
   PARK before the effect runs.
4. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer; `passivesOf` takes no seat today) and **Dendra** (a
   choose-from-hand → BOTTOM park, mandatory-exactly-one).
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games. Named jobs: gate `projection.ts`'s `pendingDecision` on `phase.seat` (the
   searchDeck deck-uid leak), and D40's `stadium.owner` + `prizesRemaining`
   projection additions.
**Carried forward (pre-existing, NOT this slice):** every authored Supporter still
has `legal_standard=0` in the local ingest; `GameLog` announces only a batch's LAST
row to screen readers, which this slice sharpens (a parked self-discard's row is
always followed by TURN_ENDED/TURN_STARTED/CARDS_DRAWN, so the discard is never
spoken); `GamePage`'s `passDisabled` phase check is untested; and Fighting Au Lait
is still playable with nothing damaged anywhere. **New INFO worth a decision later:**
during an attack park the KO sweep has not run, so a lethally-damaged defender is
briefly renderable — the damage chip shows "120/30". Transient and arguably
informative, but before this slice no such state was ever renderable.

---
### Prior resume point (P3-M5 discardEnergy, kept for continuity)
**`discardEnergy` is live (P3-M5, D41) — the energy-removal "hammer" family.** ONE op
takes Energy off the **OPPONENT's** in-play Pokémon, and **`from` names both the
eligible Pokémon and how many are hit**, spelled the way the cards are:
**`opponentActive`** (Mawile), **`opponentChosen`** (Crushing Hammer — "from 1 of your
opponent's Pokémon"), **`opponentEach`** (Giacomo — "from each of…", skipping any
Pokémon with no match, the "do as much as you can" rule). All three arms land with a
REAL printed card, so nothing in the vocabulary is speculative.
**Exactly one Energy per affected Pokémon — no `count` field**, because every printed
"discard 2 / discard all" variant is an ATTACK, and attacks cannot park (see below).
**`opponentChosen` is a ONE-step decision, not two:** since exactly one Energy comes
off, picking the Energy IS picking the Pokémon — so the prompt is a flat candidate list
with none of the source/destination coupling that made `moveEnergy` (D37) compound.
**The engine's FIRST mandatory park:** every prior parking op was "up to" (searchDeck /
discardPileRetrieval / lookAtTopN / moveEnergy) or exactly-one (choosePokemon); here the
only question is WHICH Energy, never whether, so `validateChoice` enforces an EXACT
count and an empty pick is an ERROR, not a decline. The two scopes fall out of two rules
plus a count (every uid offered and distinct, no Pokémon gives up two, total = 1 or the
number of distinct sources — "one each, none skipped" then follows by pigeonhole). New
**`specialEnergy`** CardFilter; one **`ENERGY_DISCARDED`** event per affected Pokémon
(`seat` names the VICTIM, the DAMAGE_DEALT convention); the card goes to its **OWNER's**
discard pile. Never damages, so it never KOs. engineVersion 0.20.0 → **0.21.0**.
**Web: one dialog, one log row, NO projection change** — every candidate is Energy
sitting face up on the table. `DiscardEnergyDialog` groups candidates by host, has no
decline button (mandatory), **pre-answers forced groups** (a single-candidate group is
not a question), and carries the SPOT in the group legend ("· Bench 1") because two
copies of one Basic would otherwise give identical legends over identical rows.
**Review (adversarial engine+rules + web+integration): no HIGH in the slice's own logic
from either — but the engine review REVERSED a documented decision of mine.** I had
shipped Crushing Hammer as playable into an Energy-LESS board, reasoning that
`programPlayable` scans top-level ops only and "the flip happens either way". That is
**wrong**: §7 "you cannot play a card if it has no valid target" (Compendium
[ruling/906](https://compendium.pokegym.net/ruling/906/), reconfirmed by the TPCi Rules
Team **2025-06-26**) covers it, because **a coin flip is PROCEDURE, not effect**. The
apparent counter-precedent (Unown-E's Hidden Power forcing all flips tails, yet flip
Trainers staying playable) is the OTHER branch of
[ruling/284](https://compendium.pokegym.net/ruling/284/): blocked by an EFFECT in play →
playable; blocked by the **game state** → not. So **`programPlayable` now DESCENDS into
`coinFlipGate.then`**, which also fixes a **PRE-EXISTING** bug the slice merely
inherited — **Pokémon Catcher** was likewise playable into an empty opponent Bench.
**Poké Ball is deliberately untouched** (a deck is not public knowledge, so "this search
will find nothing" is never a fact the state establishes — the ruling's own limit), and
the check is **not** extended to `conditionGate` (no printed card needs it, and doing it
properly means evaluating the condition and scanning only the arm that runs).
The engine agent's **45-mutant** run left 5 real survivors, ALL test-adequacy, all now
dead — notably `refKeyOf` dropping the bench index (two benched holders would FUSE into
one group and park instead of auto-resolving) and `!==` → `<` on the required count (in
scope "one" that would accept two Energy off two DIFFERENT Pokémon; only the exact count
catches it). The web agent's 3 MEDs are all fixed (log-row tone, `fieldset`/`legend`
grouping, six missing tests).
**Recorded, NOT fixed:** Mawile is the first "you **may**" trigger that cannot be
declined, because `discardEnergy` is the first MANDATORY parking op — every earlier
auto-fired optional trigger escaped through its own declinable op. Left as-is and
pinned: the auto-fire doctrine's justification is that such triggers are PURE UPSIDE,
and this one is (no sv01–03 Special Energy's loss helps its owner), so it costs a click;
the real fix is the trigger-level yes/no confirm the doctrine already contemplates.
**P4 item surfaced (pre-existing):** `projection.ts` returns `pendingDecision` for BOTH
viewers ungated on `phase.seat` — harmless here, but the sibling `chooseCards` prompt
built by `searchDeck` carries the controller's DECK uids.
**Next concrete actions:**
1. **Make attack effect programs able to PARK** — now the top backlog row, and the
   biggest remaining structural unlock (**~13 cards** in this very family). `attack.ts`
   runs an attack's program as `runProgram(...).state`, so a parked result silently
   drops the prompt AND the remaining ops. Blocks every "Discard an Energy from this
   Pokémon" attack (Houndoom ×2, Charcadet, Staraptor, Paldean Tauros, Dedenne ex,
   Bombirdier, Corviknight 2, Koraidon 3) and the opponent-side attack twins of Crushing
   Hammer (Pincurchin, Gumshoos + Dedenne / Maschiff / Tympole behind a flip). Known fix
   shape: seed `pending` with a new `attackEpilogue` stage and fold the park through
   `settleProgram`'s existing `resumeTail` path. Touches the §14 tie guard and the turn
   tail, so it wants its own careful slice. **Note the `attack?: EffectOp[]` registry
   seam is still UNUSED and is card-level, not per-attack — it needs keying by attack
   before a multi-attack Pokémon can use it.**
2. **Cheap and independent of that:** a **`count: "all"`** rider on `discardEnergy` +
   a `yourActive` `from` member lands **Pawmot** (sv01-076) and **Raichu** (sv02-064)
   ("Discard all Energy from this Pokémon") WITHOUT the park work — "all" has no
   decision, so those two attack programs never park.
3. **`discardFromHandCost`** (Ultra Ball / Superior Energy Retrieval / Earthen Vessel /
   Revavroom / Tinkaton). Careful: it shares the printed wording "You can use this card
   only if…" but is NOT a `BoardCondition` — it is a COST with a card CHOICE, so it must
   PARK before the effect runs. A genuinely different shape from D40's gate.
4. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer; note `passivesOf` takes no seat today) and **Dendra**
   (a choose-from-hand → BOTTOM park, mandatory-exactly-one — which `discardEnergy` has
   now set the precedent for).
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real games.
   Two concrete named jobs stand: gate `projection.ts`'s `pendingDecision` on
   `phase.seat` (the searchDeck deck-uid leak above), and D40's `stadium.owner` +
   `prizesRemaining` projection additions.
**Carried forward (pre-existing, NOT this slice):** every authored Supporter still has
`legal_standard=0` in the local ingest (in fact all 78 registry ids do, so Mawile being
out of Standard is not slice-specific); `GameLog` announces only a batch's LAST row to
screen readers, which a Giacomo sweep (several `ENERGY_DISCARDED` rows) makes sharper;
and Fighting Au Lait is still playable with nothing damaged anywhere.

---
### Prior resume point (P3-M5 board conditions, kept for continuity)
**Board conditions are live (P3-M5, D40) — one `BoardCondition` vocabulary, TWO
consumers.** The `conditionalPlay` family, built as a primitive instead of a per-card
flag. **`BoardCondition`** (effects.ts) is a predicate union evaluated for ONE seat —
**`morePrizesThanOpponent`** (strict `>`: you are BEHIND on Prizes taken),
**`yourStadiumInPlay`**, **`noEnergyOnYourPokemon`** (Active AND Bench, Basic or
Special) — behind a single evaluator **`conditionHolds`** and a printed-text describer
**`conditionNote`**. **The invariant IS the design: every member reads only PUBLIC
state**, which is exactly why **a gate emits no event** — contrast `coinFlipGate`,
whose flip is genuinely new information; a board condition is a fact both players can
read off the table, and the branch's own ops emit whatever happened.
**Consumer A — the printed PLAY GATE:** `CardProgram.trainerPlayableIf`, checked by
`playTrainer` BEFORE the card leaves hand (new `ErrorCode` `PLAY_CONDITION_NOT_MET`),
so a failed gate costs nothing. Categorically different from `programPlayable`'s
would-only-whiff heuristics: this is a rule PRINTED on the card. Named `trainer…`
because it is honoured on EXACTLY one path — `playStadium`/`rareCandy`/`attachTool`/
`useAbility` all return before it and would ignore it SILENTLY (the `trainerEndsTurn`
precedent; it is also why Luxray's Ability gate must NOT be authored here).
**Consumer B — the mid-program branch:** the **`conditionGate`** op
`{cond, then, otherwise?}`, spliced into runProgram's work queue exactly like
`coinFlipGate` (an op inside a branch can still park, and a branch may hold further
gates), evaluated against the board AS OF the gate. One-armed is the common shape
(Falkner); `otherwise` is the printed "…**instead**", a real if/ELSE (Grusha).
**One tiny new automatic op — `drawUntilHandSize`:** it DRAWS to a floor and never
TRIMS a bigger hand, and at a count ≤ 0 it no-ops with NO event (no misleading "drew 0
cards" row). Lands **3 COMPLETE real cards** (verified vs local D1): **Fighting Au
Lait** (sv02-181 — the gate + heal 60), **Falkner** (sv02-180/251 — two draw ops, not
one computed count, so the log shows both printed instructions), **Grusha**
(sv02-184/253/268 — the `otherwise` arm; its hand count is measured AFTER the Supporter
is discarded up front, the paper ruling for the hand-size family).
**Web: zero new events, prompts, dialogs or projection fields.** The one change is the
HUD greying a gated Trainer out with the engine's own `conditionHolds`, carrying
`conditionNote` as the row's `title` + an `sr-only` line — load-bearing copy, because
disabling the button REMOVES the reject pill that used to explain the printed rule.
engineVersion 0.19.0 → **0.20.0**.
**Review (adversarial engine+rules + web+integration): NO HIGH from either.** The
engine agent verified the slice's riskiest claim — **`yourStadiumInPlay` is OWNERSHIP,
not presence** — against the Japanese printing of ハヤト
(「場に**自分の**スタジアムが出ているなら」) and Bulbapedia; an opponent's Stadium must
not grant Falkner's +2. Its 24-mutant run left 5 survivors (1 equivalent), ALL
test-adequacy, all now fixed and re-verified dead with two new fixtures:
**fix-gateorder** (an attach BEFORE the gate that flips the condition, a two-op arm,
and an op AFTER the gate — one ordered `CARDS_DRAWN` assertion kills the
evaluate-against-entry-state, push-not-unshift and dropped-tail mutants at once) and
**fix-gatedsup** (the only gated SUPPORTER, pinning that a rejected gate does not burn
the §7.2 allowance). The web agent's 4 MEDs are all addressed: the missing
`engineVersion` bump; unpinned log rows (3 tests, incl. Falkner's PAIR of draw rows and
Grusha's zero-row case); a **self-defeating** doc claim that "a P4 client may evaluate
one locally"; and the HUD's opponent-`prizes` read.
**Recorded deviation (deliberate):** the HUD greys out a printed `trainerPlayableIf`
gate while `programPlayable`'s whiff gates (Boss's Orders into an empty Bench) stay
live and explain themselves via the reject pill — a rule printed on the card is
knowable before clicking, an engine whiff-judgement is not; the tooltip is what makes
the mixed standard coherent rather than a silent grey row.
**P4 item recorded (NOT fixed):** `conditionHolds` takes a `GameState`, so only a
raw-state host can run it — the projection does not carry `stadium.owner` and redacts
the prize arrays to counts. The sharp edge: **a redacted prize array still has a
`.length`**, so `morePrizesThanOpponent` would fail SILENTLY (not loudly) if shipped
online unchanged. See "M5 op-slice: board conditions as built" + D40.
**Next concrete actions:**
1. **`discardOpponentEnergy`** (Crushing Hammer / Giacomo / Klawf ex / Mawile, 4) or
   the **from-the-top attach** variant (Electric Generator / Hydreigon — which also
   closes 2 of the remaining `attachEnergyFrom` cards). Both are clean op slices.
2. **`discardFromHandCost`** (Ultra Ball / Superior Energy Retrieval / Earthen Vessel,
   4). Careful: it shares the printed wording "You can use this card only if…" but is
   NOT a `BoardCondition` — it is a COST with a card CHOICE, so it must PARK. A
   genuinely different shape from D40's gate, despite reading the same on the card.
3. **Cheapest next readers of the D40 vocabulary:** **Defiance Band** (a conditional
   PASSIVE — the third consumer, gating `damageBonusBeforeWR` on
   `morePrizesThanOpponent`; note `passivesOf` takes no seat today, so it needs one) and
   **Dendra** (a choose-a-card-from-hand → BOTTOM park, mandatory-exactly-one — which
   means a `min` on the chooseCards prompt + hiding the dialog's decline button).
4. Or pivot to **P4 (online matches)** — the engine is broad enough to play real games.
   D40 hands P4 two concrete, named jobs: add `stadium.owner` (or `mine`) to the
   projection and route the prize comparison through `prizesRemaining`, plus the
   standing deck-candidate INFO (searchDeck/lookAtTopN `pendingDecision.prompt`).
**Carried forward (pre-existing, NOT this slice):** Fighting Au Lait is playable with
nothing damaged anywhere (the Potion shape — `programPlayable` treats heal as "playable
enough"), which this slice makes conspicuous by enforcing the card's printed legality
line; `GameLog` announces only the batch's LAST row to screen readers, and a Falkner
drawing 4 sharpens it (it announces "drew 2 cards", understating the play — and an
unchanged live region announces nothing, so a second Falkner is silent); and every
authored Supporter still has `legal_standard=0` in the local ingest.

---
### Prior resume point (P3-M5 Iono, kept for continuity)
**Iono is live (P3-M5, D39) — the hand-refresh Supporter family is CLOSED.** The
format's highest-play-rate Supporter needed **no new op**: three composable riders on
the D38 `handRefresh` op. **`toBottom?: true`** — the PLACEMENT: shuffle the **hand
alone** and append it UNDER the deck (`[...deck, ...shuffle(hand)]`) instead of
shuffling it into the deck, so the deck's existing order — and therefore the very next
draws — SURVIVE (the whole strategic point of Iono over Judge; pinned by a test
asserting the drawn cards are EXACTLY the pre-play deck top, in order).
**`draw:{kind:"prizeCount"}`** — each affected player draws their OWN remaining Prize
count (the player behind draws more); a Prize count is public, so the draw size leaks
nothing. **`onlyIfAnyMoved?: true`** — the draw clause fires only if ≥1 affected player
actually moved ≥1 card: an **all-or-nothing gate ACROSS the seats** ("if EITHER
player…"), not per-seat. That gate forced the op's one structural change: **two passes**
over the affected seats (all placements, then all draws) instead of D38's interleaved
move-then-draw — **behaviour-preserving** for Youngster/Judge/Brassius/Katy (per-seat
disjoint zones + `drawToHand` consumes NO rng ⇒ byte-identical states and rng threading,
verified by reconstructing the old loop and diffing at 3 seeds each); the only change is
Judge's event INTERLEAVING (SHUFFLED p1, SHUFFLED p2, DRAWN p1, DRAWN p2 — which also
reads truer to the printed sentence). `shuffle` consumes nothing for a length ≤ 1 input,
so an Iono into two empty hands advances the rng ZERO times. One new count-only event
**`HAND_TO_BOTTOM_OF_DECK {seat, count}`** — distinct from its sibling because the public
fact differs (the deck's order is untouched, which both players must be able to read off
the log). **Web: one log row, no dialog** (never parks, no projection change) — "shuffled
their hand (N cards) and put it on the bottom of their deck": it must say BOTH verbs,
since the hand IS randomized on its way under an unshuffled deck. Lands **Iono**
(sv02-185/254/269, verified vs local D1). engine 0.18.0 → **0.19.0**.
**Review (adversarial engine+rules + web+integration): no HIGH; 2 MED, both FIXED.** The
engine MED was found by **mutation testing** — deleting the hand shuffle left all 379
engine tests green (every bottom assertion was order-insensitive; nothing asserted
`rngState`) → added `.not.toEqual(handOrder)` + `rngState` assertions on both the
shuffled and the zero-randomness paths; the mutant now dies. The web MED (raised
independently by BOTH agents) was the log copy implying Iono does NOT shuffle → fixed.
LOWs applied: an Iono degenerate-deck test (deck shallower than the Prize count
short-draws, no deck-out), a describe rename, and a real end-to-end log test pinning the
grouped 5-row batch. **Deliberate deviation (recorded in D39, not accidental):** Iono
with EVERY affected hand empty is a total no-op yet stays LEGAL (no `programPlayable`
gate, unlike gust/switch/attach/moveEnergy) — the digital clients allow it, it cannot
soft-lock, and a gate would have to reach into "playTrainer discards the played card up
front" (the D35 leaky coupling). **The family is CLOSED** — no Marnie in the sv01–03
catalog. See "M5 op-slice: handRefresh riders as built" + D39.
**Next concrete actions (keep building the backlog):**
1. **The `conditionalPlay` / board-condition gate family** (5 backlog cards) — and the
   same primitive also unlocks **Falkner** ("if you have a Stadium in play, draw 2
   more") and, with a `drawUntilHandSize` op, **Grusha**. The biggest remaining cluster.
2. **The remaining `moveEnergy` cards** each layer a rider: **Armarouge** "Fire Off" (a
   {R} Energy benched→Active — fixed-endpoint + provided-type filter, an Ability),
   **Mismagius** "Magical Flick" (the OPPONENT's Energy on evolve — opponent-side +
   onEvolve trigger), **Exp. Share** (an on-KO Tool trigger).
3. **The from-the-top attach variant** (Electric Generator / Hydreigon) — also closes 2
   of the remaining `attachEnergyFrom` cards — or **`discardOpponentEnergy`** (Crushing
   Hammer / Giacomo, 4). See `docs/reference/coverage-backlog.md`.
4. **Miriam** is the near-miss worth naming: its "if you shuffled any cards in this way,
   draw 3" is `onlyIfAnyMoved`'s idea but BETWEEN ops and across a park — it needs an
   op-result threaded through the interpreter's continuation, not a flag. Deferred.
5. Or pivot to **P4 (online matches)** — the engine is broad enough to play real games;
   the projection is already P4's per-viewer filter, and the standing deck-candidate
   INFO (searchDeck/lookAtTopN `pendingDecision.prompt`) is exactly what its server-side
   redaction must cover. Iono, like the rest of handRefresh, needs none of it.
**Two pre-existing items the review surfaced (NOT this slice):** every authored
Supporter has `legal_standard=0` in the local ingest, so none surface in the builder's
default standard-legal search; and `GameLog` announces only the last entry to screen
readers, so a 5-row batch is mostly silent (P5 polish).

---
### Prior resume point (P3-M5 handRefresh, kept for continuity)
**`handRefresh` is live (P3-M5, D38) — shuffle your hand into your deck, then draw.**
The Iono/Judge/Marnie hand-refresh Supporter family. New op `{who:"you"|"both", draw}`
— the FIRST op in a new class: **fully AUTOMATIC** (no decision → it NEVER parks, like
drawCards/discardHand/shuffleDeck) AND it can affect the **opponent** (`who:"both"`,
Judge — the first op to reach the OPPONENT's hand/deck). Per affected seat (controller
first, then — for `both` — the opponent) it captures the PRE-shuffle hand size, moves
the whole hand into the deck, shuffles the combined pile (`shuffle([...deck, ...hand])`
— one rng advance, threaded fresh each iteration so the two-shuffle Judge has no stale
reuse), then draws per **`HandRefreshDraw`**: `{fixed count}` (Youngster 5, Judge 4,
Katy 8) or `{handPlus delta}` (Brassius "draw that many cards plus 1"). **Card
conservation** is a pure multiset move (`[...deck, ...hand]` → shuffle → draw back),
invariant under empty-hand / empty-deck / hand==whole-deck / both-empty; the Supporter
is discarded UP FRONT, so never shuffled back. **Always playable** (no `programPlayable`
gate); never damages/KOs. **Katy "your turn ends"** lands the `endsTurn` fold on the
TRAINER path — a new CardProgram flag **`trainerEndsTurn`** that `playTrainer` passes
to `settleProgram`, folded byte-for-byte like Koraidon's `AbilityProgram.endsTurn`
(D34); every non-Katy trainer passes `endsTurn:false` (byte-identical, no regression).
One new count-only event **`HAND_SHUFFLED_INTO_DECK {seat, count}`** (the deck reorder
is intrinsic — no separate `SHUFFLE`). Lands **4 COMPLETE real Supporters** (verified
vs local D1): **Youngster** (sv01-198, draw 5), **Judge** (sv01-176, both draw 4),
**Brassius** (sv03-187, draw hand+1), **Katy** (sv01-177/237, draw 8 + turn ends).
**Web: one log row, no dialog** — handRefresh never parks, so no new `EffectPrompt`/
dialog (GameHud untouched); one count-only `HAND_SHUFFLED_INTO_DECK` row, the draw
riding the existing count-only `CARDS_DRAWN`. **Hidden info (Judge — the first op to
touch the opponent's hand): leaks NOTHING new** — the opponent's `CARDS_DRAWN` uids are
the standard `drawToHand` contract; the log arms are count-only and the projection
already redacts the opponent's hand to uid-less backs. engine 0.17.0 → **0.18.0**.
**Adversarial review (engine+rules + web+integration): BOTH CLEAN — no HIGH/MED, NO
code fixes** (card conservation over all four degenerate zone states, two-shuffle rng
threading, handPlus timing, the Katy endsTurn fold with no regression across the full
374-test engine suite, purity against a recursive freeze, all four texts byte-matching
the catalog / no missed reprint, Judge hidden-info safe on both log + projection). INFO
(both, not bugs): an empty hand emits `count:0` (honest, non-leaky — the `HAND_DISCARDED
"(0 cards)"` precedent); the no-separate-`SHUFFLE`-event choice is cosmetic with no
consumer. Closes the `shuffleHandIntoDeck` + `endTurn` backlog rows. See "M5 op-slice:
handRefresh as built" + D38.
**Next concrete actions (keep building the backlog):**
1. **Iono / Marnie** layer on this primitive: they put the hand on the BOTTOM of the
   deck (not shuffle) and draw by Prize count (Iono) / an asymmetric split (Marnie —
   you 5, opponent 4) — a bottom-of-deck move + a `prizeCount`/split `HandRefreshDraw`.
   High play rate; small additions on `handRefresh`.
2. **The remaining `moveEnergy` cards** each layer a rider: **Armarouge** "Fire Off" (a
   {R} Energy benched→Active — fixed-endpoint + provided-type filter, an Ability),
   **Mismagius** "Magical Flick" (the OPPONENT's Energy on evolve — opponent-side +
   onEvolve trigger), **Exp. Share** (an on-KO Tool trigger).
3. **The next backlog op by unlock count** — the **`conditionalPlay`** family (5, a
   "you can use this only if <board condition>" gate — but each card still needs its
   effect op too), a **from-the-top attach** variant (Electric Generator / Hydreigon,
   also 2 `attachEnergyFrom` cards), or **`discardOpponentEnergy`** (Crushing Hammer /
   Giacomo, 4). See `docs/reference/coverage-backlog.md`.
4. Or pivot to **P4 (online matches)** — the engine is broad enough to play real games;
   the projection is already P4's per-viewer filter, and the deck-candidate INFO
   (searchDeck/lookAtTopN) is exactly what its server-side redaction must cover
   (`pendingDecision.prompt`) — `handRefresh`'s all-count-only events need none.

---
### Prior resume point (P3-M5 moveEnergy, kept for continuity)
**`moveEnergy` is live (P3-M5, D37) — move Energy between your own Pokémon.** A new
op `{filter, max}` moves up to `max` Energy from ONE of the controller's own in-play
Pokémon to ANOTHER — the interpreter's **first op with two COUPLED decisions** (which
Energy AND where). Unlike every prior op (which reused one existing prompt), it adds a
**new compound prompt** `moveEnergy` (`movable`: each takeable Energy uid tagged with
its source `PokemonRef`; `destinations`: all own in-play refs) and a **new choice**
`{uids, dest}` answering both at once, applied **ATOMICALLY** by `moveEnergyApply`
(strip the picks off their source, append to the dest in one `withSide` — a floating
detached-Energy state never exists, which is why it is one compound park not two).
"Up to"/declinable; always parks when playable. **`validateChoice`** enforces the
couplings (each uid an offered `movable`, distinct, ALL sharing ONE source, dest
offered, **dest ≠ source**), so no illegal wire move applies; `moveEnergyApply`
conserves cards and is pure. New **`programPlayable` gate** (`moveEnergyPlayable`: ≥1
matching Energy AND ≥2 of your Pokémon in play) = the exact complement of stepOp's
no-op (no wasted card, no soft-lock). One new `CardFilter` **`anyEnergy`** (Basic OR
Special) + one new event `ENERGY_MOVED {seat, uids, from, to}`. Lands **Energy
Switch** (sv01-173) and **Poppy** (sv03-193/220/227) — 2 of the op's 5 backlog cards.
**Web:** `MoveEnergyDialog` (a staged pick, or **Move none**) + one `ENERGY_MOVED` log
row; the prompt leaks NOTHING (own face-up in-play Energy/Pokémon). engine 0.16.0 →
**0.17.0**. Review (adversarial engine+rules + web + an independent Opus pass): CLEAN —
no HIGH/MED; one action (a two-source Poppy DOM test). See "M5 op-slice: moveEnergy as
built" + D37.

---
### Prior resume point (P3-M5 lookAtTopN, kept for continuity)
**`lookAtTopN` is live (P3-M5, D36) — the deck-top look family.** The top-of-deck
twin of `searchDeck`: a new op `{n, filter, max}` looks at the top `n` cards of the
controller's deck and puts up to `max` matching `filter` into their HAND, "up to"/
declinable, reusing the `chooseCards` park (no new prompt/dialog/wire shape). The
candidates are ONLY the `filter` matches among the **top `n`** (never a deeper
card — `validateChoice`'s "picks ⊆ candidates" guards the window); "Shuffle the
other cards back" is the trailing `shuffleDeck` op (the Nest Ball pattern, so a
whiff or a decline still shuffles). New mover `revealFromTop` + one new event
`DECK_TOP_REVEALED` (count-only log). **No new `CardFilter`** (Great Ball reuses
`anyPokemon`, Pokégear reuses `supporter` from D35); **no `programPlayable` gate**.
Lands **Great Ball** (sv02-183 — top 7 → a Pokémon) and **Pokégear 3.0** (sv01-186
— top 7 → a Supporter) — 2 of the op's 5 backlog cards. **Web (small):** one
`DECK_TOP_REVEALED` log row; the shared origin-agnostic `ChooseCardsDialog` (D35)
renders the accurate `prompt.note` and the projection is unchanged. engine 0.15.0 →
**0.16.0**. **Review (2 Opus agents): BOTH CLEAN — no HIGH/MED, NO code fixes**
(card conservation, window boundary, wire-safety, shuffle-always-fires, no flow-tail
interaction, purity, log honesty all proven). INFO (both, pre-existing P4 deferral):
the parked prompt carries the top-`n` candidate uids unredacted per-viewer — same as
`searchDeck`, unobservable in hot-seat, the P4 filter's job. See "M5 op-slice:
lookAtTopN as built" + D36.

---
### Prior resume point (P3-M5 discardPileRetrieval, kept for continuity)
**`discardPileRetrieval` is live (P3-M5, D35) — the recovery-Item family.** The
discard-pile mirror of `searchDeck`: a new op `{filter, dest:"hand"|"deck", max}`
retrieves up to `max` matching cards from the controller's discard pile, "up to"/
declinable, reusing the `chooseCards` park (no new prompt/dialog/wire shape). Two
new `CardFilter` kinds (`supporter`, `pokemonOrBasicEnergy`); `dest:"deck"` +
trailing `shuffleDeck` is the "shuffle into your deck" idiom (whiff still shuffles,
per the searchDeck convention); new event `DISCARD_RETRIEVED` (count-only log).
Lands **Energy Retrieval** (sv01-171), **Pal Pad** (sv01-182), **Super Rod**
(sv02-188/276) — 3 of the op's 6 backlog cards. **Web touched (small):** dialog
label "Search your deck" → "Choose cards" (shared by both origins now; note carries
the specifics), `chooseCards` prompt `dest` += "deck", one log row. engine 0.14.0 →
**0.15.0**. **Review (2 Opus agents): BOTH CLEAN** — no HIGH/MED bugs; MED
test-adequacy fix (purity test now hits `retrieveMove`) + LOW coverage/comment
fixes applied. INFO: a FUTURE self-matching card (a Supporter authored on this op
with `filter:supporter`) would offer itself as a candidate since `playTrainer`
discards up front — flagged in the op's authoring note; the 3 Items are safe. See
"M5 op-slice: discardPileRetrieval as built" + D35.
**Next concrete actions (keep building the backlog):**
1. **The next backlog op by unlock count** — **`lookAtTopN`** (5 — Great Ball,
   Pokégear 3.0, Electric Generator, Hydreigon, Malamar; also unblocks 2 of the
   remaining `attachEnergyFrom` cards), **`moveEnergy`** (5 — Energy Switch, Exp.
   Share, Poppy…), the **`conditionalPlay`** family (5), or the **hand-refresh
   Supporter family** (Iono/Judge/Marnie — `shuffleHandIntoDeck` + draw). See
   `docs/reference/coverage-backlog.md`.
2. Or the remaining `attachEnergyFrom` cards via a **deck-search-attach** source op
   (Forretress/Charizard/Geeta/Pawmot — each also needs a per-card rider: self-KO,
   onEvolve, can't-attack, attach-to-self).
3. Or the remaining 3 `discardPileRetrieval` cards — Superior Energy Retrieval
   (`discardFromHandCost`), Miriam (conditional "if you shuffled any, draw 3"),
   Pelipper (an Ability).
4. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games; the projection is already P4's per-viewer filter.

---
### Prior resume point (P3-M5 attachEnergyFrom multi + endsTurn, kept for continuity)
**Koraidon ex "Dino Cry" is live (P3-M5, D34) — attachEnergyFrom MULTI-attach +
endsTurn.** Three ideas: **multi-attach** ("attach up to N in any way") needs NO
new op — it is **N `attachEnergyFrom` ops** in one program (the interpreter parks
on each op's target in turn; a later op with no matching Energy no-ops → attaches
min(N, available), auto-maxed); a **`basicOnly`** target-filter rider (target must
be `isBasicPokemon`, with `targetType` → "your Basic {F} Pokémon"); and
**`AbilityProgram.endsTurn`** — a flag that ENDS the controller's turn on program
completion, folded by **`settleProgram`** (flow.ts: DONE seeds `turnTail(controller)`
+ advance — the normal `endTurn` shape — instead of turn:action), threaded across
re-parks by a new `endsTurn?: true` on the effect:choose Phase (parallel to
`resumeTail`, mutually exclusive). engine 0.13.0 → **0.14.0**. **Review (2 Opus
agents): BOTH CLEAN.** See "M5 op-slice: attachEnergyFrom multi + endsTurn as
built" + D34.

---
### Prior resume point (P3-M5 attachEnergyFrom riders, kept for continuity)
**Gardevoir ex "Psychic Embrace" is live (D33) — the attachEnergyFrom RIDERS.**
The D32 attach op grew three composable riders on `attachEnergyFrom`:
**`targetType`** (eligible targets = the controller's own Pokémon whose top card
is that type — {P}), **`bonusCounters`** (put N HP of counters on the just-
attached Pokémon — 2 = 20, as COUNTERS_PLACED "ability"), **`notIfKO`** (exclude
any target the counters would Knock Out — `damage + bonusCounters ≥ effectiveMaxHp`,
so the counters are ALWAYS non-lethal → the op still never KOs). The filtered
candidates live in a new exported **`attachEnergyTargets`** (interpreter.ts),
shared by the park AND `programPlayable` (now also rejecting when no eligible
target remains). Gardevoir ex (sv01-086/228/245): `{attachEnergyFrom,
source:"discard", energyType:"Psychic", targetType:"Psychic", bonusCounters:20,
notIfKO:true}`, `oncePerTurn:false` (repeatable). **Web UNCHANGED** (reuses
choosePokemon + ENERGY_ATTACHED + the COUNTERS_PLACED "ability" row + the damage
chip). engine 0.12.0 → **0.13.0**. **Review (2 Opus agents): BOTH CLEAN** — the
notIfKO non-lethal guarantee proven airtight (a basic-energy attach can't shift
damage/effectiveMaxHp between park and apply; settleProgram's sweep is a safety
net anyway), no base-op regression, wire-safety, purity; reuse verified through
the real HUD; one LOW (a stale log comment) fixed. Suite 1095 → **1101**; check +
build green. See "M5 op-slice: attachEnergyFrom riders as built" + D33.
**Next concrete actions (keep building the backlog):**
1. **The remaining `attachEnergyFrom` cards (8 of 11)** — each needs a MORE than
   the single-attach+riders: **multi-attach** ("up to N in any way" — Koraidon,
   Forretress, Charizard, Geeta, Electric Generator, Hydreigon), a **deck-search
   source** (Forretress, Charizard, Geeta, Pawmot), **`lookAtTopN`** (Electric
   Generator, Hydreigon), plus per-card riders ("your turn ends" Koraidon, self-KO
   Forretress, `onEvolve` Charizard ex, "can't attack this turn" Geeta,
   attach-to-self Pawmot [needs the source uid in EffectContext], special-energy-
   by-name Wigglytuff). Pick one op (multi-attach is the biggest shared one).
2. Or the next backlog op by unlock count — **`discardPileRetrieval`** (6),
   **`lookAtTopN`** (5), **`moveEnergy`** (5), the **`conditionalPlay`** family (5),
   or the **hand-refresh Supporter family** (Iono/Judge/Marnie). See
   `docs/reference/coverage-backlog.md`.
3. Or pivot to **P4 (online matches)** — the engine is broad enough to play real
   games; the projection is already P4's per-viewer filter.

---
### Prior resume point (P3-M5 op-slice `attachEnergyFrom`, kept for continuity)
**`attachEnergyFrom` is live (D32) — the first backlog op.** A new interpreter op
attaches ONE Basic Energy from the controller's hand or discard pile onto a CHOSEN
own Pokémon (§6), reusing the choosePokemon park + ENERGY_ATTACHED. Same-type
Basic Energy is fungible → the only decision is the TARGET. Representatives
Quaquaval (any Basic from hand, once/turn) + Baxcalibur ({W} from hand, repeatable)
+ a fixture for the discard branch. Web unchanged. engine 0.11.0 → 0.12.0; both
Opus reviews clean. One INFO: `programPlayable` runs before an ability cost is
paid (unreachable today). See D32.

---
### Prior resume point (P3-M5 coverage pass #1, kept for continuity)
**M5 coverage pass #1 is done — the ranked new-op backlog is the roadmap.** A
classify→verify **Workflow fan-out** (10 agents, 0 errors) classified the 140
un-authored sv01–03 Trainers/Energy/Abilities against the current op vocabulary:
**5 authorable now** (landed), **113 needs-op**, 22 already-authored. Coverage is
**op-bound, not authoring-bound** (~4% expressible today), so the deliverable is
BOTH the 5 landed registry rows AND the **new-op backlog**
(`docs/reference/coverage-backlog.md`) ranked by cards-unlocked. **Landed:** Poké
Ball (sv01-185, `coinFlipGate → [searchDeck anyPokemon→hand, shuffleDeck]`),
Pokémon Catcher (sv01-187, `coinFlipGate → [gust]`), Nemona (sv01-180,
`drawCards 3`), Copperajah ex (sv02-150, passive −30 after W/R), Stonjourner
(sv01-121, passive −20). The fan-out mis-placed Poké Ball's shuffle outside the
coin gate (tails would reorder the deck) — hand-fixed + test-pinned (the reason
authorable programs are hand-verified before landing). First Trainers to use
`coinFlipGate`, so the `ATTACK_EFFECT_COIN_FLIP` log copy was neutralized. No
engine mechanism changed (additive data); engineVersion stays 0.11.0. Suite 1080
→ **1087**; no 2-agent slice review (fan-out classify+verify + hand-verify +
tests). See "M5 coverage pass #1 as built".
**Next concrete actions (build the backlog, highest-unlock first):**
1. **`attachEnergyFrom`** — the single biggest unlock (11 cards, and the engine
   of most evolving-deck Abilities): an op that attaches Energy from a source
   (deck/discard/hand) matching a filter to a chosen Pokémon. A normal engine
   slice (new op + interpreter case + registry rows + tests + 2-agent review).
2. Then **`discardPileRetrieval`** + extra **`CardFilter`** kinds (Item/Tool/
   Evolution/no-rule-box), **`lookAtTopN`**, **`moveEnergy`**, the
   **`conditionalPlay`/`conditionalGate`** family, and the **hand-refresh
   Supporter family** (Iono/Judge/Marnie) — each turns dozens of "needs-op" rows
   into data rows. Full sequencing in `docs/reference/coverage-backlog.md`.
3. Or pivot to **P4 (online matches)** — the P3 engine is now broad enough to
   play real games; the projection is already the per-viewer filter P4 applies.
   (A further coverage pass can run in parallel or later.)

---
### Prior resume point (P3-M4 slice 9, kept for continuity)
**on-KO triggered Abilities are live (P3-M4 slice 9, D30) — M4 IS COMPLETE.** A
"when this Pokémon is Knocked Out" Ability (§8.1) fires mid-KO-sweep DURING the
opponent's turn — the inverse of the slice-8 snipe (the KO fires the trigger).
`TriggerTiming` += **`"onKnockOut"`**; detection is triggers.ts
**`onKnockOutTrigger`** (via `cardIdByUid → programFor`, valid after the KO
discarded the card), but flow.ts's KO sweep DRIVES it. Two forms on
`TriggeredAbility`: (1) a coin-flip **Prize GUARD** (`onKoPrizeGuard:
"coinFlipPrevent"` — Glimmora: heads → the opponent takes no Prize for it),
resolved INLINE by a new **`planPrizes`** (flow.ts) run UP FRONT — before the §14
tie-guard speculation — threading rng ONCE so the speculation and the real KO
share the post-flip count (§14 stays exact), the guard's events firing after the
`KNOCKED_OUT`; and (2) a general parking **PROGRAM** run as a new **`koTrigger`
PendingStage** (`advance` → **`runKoTrigger`** → **`settleProgram` with a new
`resumeTail`** flag): it PARKS on `effect:choose` (where `phase.seat` is the KO'd,
NON-turn player) and, on `resolveEffect`, the sweep RESUMES draining the queued
prize/promotion tail instead of folding back to a turn. Batch order:
PRIZES-first, then koTriggers, then promotions; a §14 game-ending prize skips the
program, while the guard (resolved earlier) can DENY a winning prize.
Behaviour-neutral for every card with no on-KO Ability. Representatives Glimmora
(sv02-126, real) + fix-onko (FIXTURE — no real SV on-KO Ability parks). **Web:**
the projection's `effect:choose` case reads the turn owner via `koParkActiveSeat`
when `resumeTail` (activeSeat ≠ waitingSeat — the KO'd player owes it
mid-opponent-turn); the parked decision reuses the `chooseCards` dialog; two new
log rows (`ABILITY_COIN_FLIP`, `PRIZE_PREVENTED`). engineVersion 0.10.0 → 0.11.0.
See "M4 slice 9 as built" + D30.
**Review (2 Opus agents — engine+rules / web+integration): BOTH CLEAN, no
HIGH/MED/LOW correctness bugs.** The engine agent enumerated the §14 tie guard ×
prize denial over ALL FOUR coin-flip combos × 60 seeds and proved every
win/tie/continue outcome exact (post-flip counts, one rng advance), proved the
no-ability path byte-equivalent, and probed the resume-the-tail across all three
KO callers (attack / checkup / mid-turn). The web agent proved `koParkActiveSeat`
names the right owner in each origin, the viewer-follow flips to the KO'd player
and back, the dialog dispatches `resolveEffect` for the KO'd seat, and NO
demo/`/play` regression (a non-`resumeTail` park is byte-identical). One engine
LOW (a seed-fragile / misframed §14 test of mine) FIXED — it now pins both guard
branches (heads denies the win) + a deterministic fix-onko §14-skips-the-program
test; one web INFO is the pre-existing P4 hidden-info gap (not slice-9).
**Verification:** `bun run check` green (**1080 tests** — 1066 → 1080: 11 engine
`onKnockOut.test.ts` + 1 projection + 1 log + 1 DOM), production `vite build`
green. No live /play smoke this session (representatives not demo-reachable; NO
demo deck / projection path for existing cards changed — the demo boot is
byte-identical to slice 8's; the slice-6/8 precedent).
Next concrete actions:
1. **P3 M4 is COMPLETE — the next milestone is M5, the coverage-expansion
   Workflow fan-out** across the SV-era pool (track % simulated). Every mechanic
   now lives as DATA in `registry.ts` (op programs, EnergyProgram, StadiumEffects,
   PassiveEffects, TriggeredAbility incl. `onKoPrizeGuard`, AbilityProgram incl.
   activation `cost`), and the KO flow reaches the whole board (attacks, Checkup,
   the mid-turn snipe, and now an on-KO trigger that can pause the sweep), so a
   new card in a known family is a few registry rows, not code. **Ask the user
   before launching a fan-out** (large multi-agent run).
2. Or begin **P4 (online matches)** — run the P3 engine authoritatively inside
   the lobby DO. The projection is already the per-viewer filter P4 will apply;
   the logged P4 blockers (the HUD reading raw GameState for payability; the
   `effect:choose` prompt carrying the actor's search candidates unredacted; the
   opponent-hand/setup opaque-alias re-key) are collected across the M2–M4 notes.
3. **Slice-6 follow-up (still open):** the slice-6 (triggered Abilities) review
   was cut short by the usage limit — a `/code-review` re-run over commit
   `a634b30` is logged (user opted to defer it while building later slices).

Unchanged user-side blockers: web prod build/deploy story unset
(`VITE_API_ORIGIN` at build time; CSP derives from it); deployed Worker's
`APP_ORIGIN` still `http://localhost:5173`; OAuth 503 until the
Discord/Google apps + four secrets exist (see 2026-07-13 entry for details).
A `?full` batch param on `GET /cards` is a logged follow-up to bundle with
the next api deploy (D18).

## Status by workstream
| Workstream | Phase | Status |
|---|---|---|
| backend-data | P1 | ✅ M1–M9 + P2-M1 + task-17 api deployed (Worker `9b1ec1d1`, 2026-07-16); OAuth secrets pending (user) |
| deck-builder | P2 | ✅ ALL 19 tasks closed (task 17 landed + e2e-verified locally); only follow-ups left |
| simulator | P3 | 🚧 **M1–M3 + M4 done; M5 in progress** (M4: D22–D30, evolution→on-KO triggers; **M5**: pass #1 = a classify→verify Workflow fan-out landed 5 existing-op cards + the ranked new-op backlog in `docs/reference/coverage-backlog.md`; **op-slice D32 = `attachEnergyFrom`** (engine 0.12.0) + **D33 = its riders** (Gardevoir ex, 0.13.0) + **D34 = multi-attach + endsTurn** (Koraidon ex, 0.14.0), 4 of its 11 cards; **D35 = `discardPileRetrieval`** (the searchDeck mirror — Energy Retrieval / Pal Pad / Super Rod, engine 0.15.0, 3 of 6 cards) + **D36 = `lookAtTopN`** (the searchDeck deck-top twin — Great Ball / Pokégear 3.0, engine 0.16.0, 2 of 5 cards) + **D37 = `moveEnergy`** (move Energy own→own — the first compound-park op; Energy Switch / Poppy, engine 0.17.0, 2 of 5 cards) + **D38 = `handRefresh`** (shuffle your hand into your deck, then draw — the first fully-automatic op that can affect the OPPONENT; Youngster / Judge / Brassius / Katy, engine 0.18.0 — closes the `shuffleHandIntoDeck` + `endTurn` backlog rows) + **D39 = its Iono riders** (`toBottom` so the deck's ORDER survives + a `prizeCount` draw + the cross-seat `onlyIfAnyMoved` gate; engine 0.19.0 — **CLOSES the hand-refresh family**, no Marnie in sv01–03) + **D40 = board conditions** (one `BoardCondition` vocabulary with TWO consumers — the `trainerPlayableIf` PLAY gate and the `conditionGate` branch op — plus `drawUntilHandSize`; Fighting Au Lait / Falkner / Grusha, engine 0.20.0 — the `conditionalPlay` PRIMITIVE is done, though each remaining gated card needs a second missing piece) + **D41 = `discardEnergy`** (the energy-removal "hammer" family — ONE op whose `from` names both the eligible Pokémon and how many are hit: `opponentActive`/`opponentChosen`/`opponentEach`, all three landing with a real card — Crushing Hammer / Giacomo / Mawile, engine 0.21.0, 3 of the row's 4; the engine's FIRST mandatory park, plus the coin-gate playability fix: `programPlayable` now descends into `coinFlipGate.then`, which also fixed PRE-EXISTING Pokémon Catcher) + **D42 = attack effect programs can PARK** (the `attackEpilogue` PendingStage carries the §8.1 KO sweep + §5.3 turn end, seeded BEFORE the effect program and folded through `settleProgram`'s `resumeTail` — a MECHANISM, not a card family; its first readers are the §8 self-discard cost via `discardEnergy`'s `yourActive` arm + `count:"all"`, 12 catalog rows all DERIVED, engine 0.22.0) + **D43 = the `discardEnergy` ATTACK arms** (the opponent-side twins on the existing `opponentActive` arm, bare + coin-gated — Pincurchin / Gumshoos / Dragonite V ×2 / Dedenne / Maschiff / Tympole / Yveltal — and the exact-N `count` — Corviknight / Slither Wing / Koraidon: 11 more rows, again ZERO registry rows; the collapse is now CAPPED at `count` per class, and `forcedDiscards` folds the short board into the same comparison as the no-choice rule, i.e. the new §8.6 "do as much as you can"; engine 0.23.0)) — next: the **`providesEnergy` filter** (the ONE primitive left in the energy-discard family — Kilowattrel / Arcanine ex ×2 / Charmeleon / Charizard, and it also unblocks Armarouge on `moveEnergy`), `discardFromHandCost` (a COST that parks, NOT a BoardCondition), the from-the-top attach variant (Electric Generator / Hydreigon), the cheap D40 readers (Defiance Band / Dendra), or P4 |
| online | P4 | 📋 Specced — blocked on P3 |
| polish | P5 | 📝 Backlog |

Legend: 📝 backlog · 📋 specced · 🔎 research · 🚧 in progress · ✅ done

## Session log
- **2026-07-21** (build #29) — **P3-M5: the `providesEnergy` CardFilter — "an
  Energy that PROVIDES {X}"** (D44; built solo, then the usual 2-agent adversarial
  review). The resume point's #1, and the ONE primitive the previous slice
  diagnosed as all that stood between the engine and the rest of the
  energy-removal family. It turned out to be more interesting than a parameter:
  reading **provision instead of print** forces the predicate to be answered on
  the **HOST** rather than on the card, because Luminous Energy provides every
  type alone and only {C} beside another Special — the same physical card is a {L}
  Energy on one board and not on another. That is what made it worth sharing with
  a second op instead of bolting a field onto the first. `continuous.ts` was split
  so the filter and §8.2's cost matcher read one `unitsOf`, giving the invariant
  that **what can PAY a {L} cost is exactly what a "{L} Energy" effect can take**;
  `matchesFilter` deliberately answers **false** for deck/hand/discard scans, so
  the one authoring mistake this filter invites is a loud no-op. Two consumers, one
  vocabulary (D40's shape): the typed self-discard DERIVED in both printed
  notations (5 catalog rows, **zero registry rows**) and `moveEnergy`'s new
  `benchToActive` route (Armarouge). Also **committed the previous session's D43
  slice**, which was complete but uncommitted. 1268 → **1301** tests. **Both review
  agents: NO HIGH.** Their value was in the net rather than the code — the engine
  agent's 49 mutants found the route's Active guard asserted three times and tested
  zero times, and the wildcard predicate's `.includes` indistinguishable from
  "first unit only" (both unreachable today, both one authored card away); the web
  agent proved two behaviours unpinned with mutations that passed all 1297 tests.
  Everything actionable was fixed, including a genuine wire-hygiene hole beside the
  slice (`ENERGY_MOVED.to` spreading the client's own object into an event). The
  energy-removal family is now **filter-complete**: what remains is sentence
  structure, not predicates.
- **2026-07-21** (build #28) — **P3-M5: the `discardEnergy` ATTACK arms — the
  opponent-side twins + the exact-N `count`** (D43; built solo, then the usual
  2-agent adversarial review). The resume point's #1, widened to also take its #2's
  cheaper half so the slice is a coherent idea rather than two regexes. **No new op
  and no registry rows** — 11 catalog rows from two deriver sentences and one
  widened field. The twins run the EXISTING `opponentActive` arm and are the first
  ops to park a decision about the OPPONENT's board mid-attack; D42's machinery
  carried them with zero changes, which is the best evidence that slice was built
  at the right seam. The exact-N half is where the thinking was: **capping the
  interchangeable collapse at `count` instead of flattening to 1** keeps every
  distinguishable answer reachable while still dropping copies that could only
  duplicate — and it makes `forcedDiscards` a single comparison that is
  simultaneously the M1 no-choice rule and §8.6 "do as much as you can" (added to
  `ptcg-rules.md` this session; Sandaconda's "If you discarded any Energy in this
  way" is the on-card corroboration). engineVersion 0.23.0; 1250 → **1268** tests.
  **Review: NO HIGH in the slice's own logic from either agent** — the engine agent
  ran all five regexes over all 978 catalog rows (11 matches, zero false positives
  or misses) and brute-forced the collapse math over 7770 configurations. The web
  agent found **one HIGH beside the slice**, and it is the lesson worth keeping:
  `ENERGY_DISCARDED` named its host by SPOT, an invariant its own doc asserted was
  safe — but an attack twin strips a defender its own damage Knocked Out in the
  SAME batch, so the log re-read an empty slot and printed "from Tide's the Active
  spot". The event now carries `host` (the top-card uid, the KNOCKED_OUT
  precedent). **Mutation testing again earned its keep**: of 10 survivors, the
  `each`-scope collapse cap of 1 was entirely unpinned (a `cap = 2` mutant changed
  shipped Giacomo behaviour with all 1266 tests green), four regex anchors were
  unpinned (my own anchor comment had the reason WRONG — Krookodile is refused by
  capitalisation as much as by `^`, so it never pinned the anchor), and two of my
  own new web tests were proven toothless. All now dead. Also fixed: three of four
  new fixtures carried wrong HP/retreat under a header claiming catalog
  verification, and `opponentEach` + a numeric count is now unrepresentable rather
  than silently ignored.
- **2026-07-21** (build #27) — **P3-M5: attack effect programs can PARK — the
  `attackEpilogue` stage, and the §8 self-discard attack cost** (D42; log entry
  written retroactively in #28 — the ritual was skipped that session). The top
  backlog row and the biggest remaining structural unlock: `attack.ts` ran an
  attack's effect program as `runProgram(...).state`, silently dropping a parked
  prompt and every op behind it. The fix inverts the order — queue the tail first,
  then run the program — via a new `attackEpilogue` PendingStage folded through
  `settleProgram`'s `resumeTail` (deliberately REDEFINED from "mid-KO-sweep" to
  "mid-TAIL"). Its first family is DERIVED, not authored: `discardEnergy` gained
  `yourActive` + `count:"all"`, landing 12 catalog rows with zero registry rows,
  and interchangeable candidates began collapsing (a Basic keys on what it
  PROVIDES, not its id — the real catalog prints Basic Fire under three ids).
  engineVersion 0.22.0; 1227 → 1250 tests. Review: no HIGH from either agent; 9 of
  56 mutants survived, all fixed.
- **2026-07-21** (build #26) — **P3-M5: `discardEnergy` — the energy-removal "hammer"
  family, and the coin-gate playability bug it exposed** (D41; built solo — full context
  — then an adversarial engine+rules + web+integration review: **no HIGH in the slice's
  own logic from either**, but the engine review reversed a documented decision of mine).
  Chosen as the resume point's #1. ONE op takes Energy off the **OPPONENT's** in-play
  Pokémon, with **`from` naming both the eligible Pokémon and how many are hit** —
  `opponentActive` (Mawile), `opponentChosen` (Crushing Hammer), `opponentEach` (Giacomo)
  — and **all three arms land with a real printed card**, so no vocabulary is
  speculative. Exactly one Energy per affected Pokémon; **no `count` field**, because
  every printed "discard 2 / discard all" variant is an ATTACK. `opponentChosen` is a
  ONE-step decision (picking the Energy IS picking the Pokémon), so unlike `moveEnergy`
  there is no coupling to validate. **The engine's first MANDATORY park** — an empty pick
  is an ERROR, not a decline. New `specialEnergy` filter; one `ENERGY_DISCARDED` per
  affected Pokémon; the card goes to its OWNER's pile. Lands **Crushing Hammer**
  (sv01-168), **Giacomo** (sv02-182/252/267), **Mawile** (sv03-143). Web: one dialog
  (grouped by host, no decline, forced groups pre-answered, the spot in the legend), one
  log row, **no projection change**. engineVersion 0.20.0 → **0.21.0**; 1196 → **1227**
  tests, `bun run check` + `vite build` green.
  **The session's most important outcome was the review reversing me.** I shipped
  Crushing Hammer as playable into an Energy-LESS board, reasoning `programPlayable`
  scans top-level ops only and "the flip happens either way". Wrong: §7 / Compendium
  ruling/906 (reconfirmed by the TPCi Rules Team 2025-06-26) covers it, because **a coin
  flip is PROCEDURE, not effect**; the apparent counter-precedent (Unown-E's Hidden Power
  forcing all flips tails) is ruling/284's OTHER branch — blocked by an EFFECT → playable,
  blocked by the **game state** → not. `programPlayable` now descends into
  `coinFlipGate.then`, which also fixed a **pre-existing** bug (Pokémon Catcher into an
  empty opponent Bench). Poké Ball deliberately untouched — a deck is not public
  knowledge, the ruling's own limit — and `conditionGate` deliberately not extended.
  **Mutation testing (engine agent): 45 mutants, 41 killed, 4 equivalent**; the 5 real
  survivors were all test-adequacy and are now dead — the sharpest being `refKeyOf`
  dropping the bench index (two benched holders would FUSE into one group and park
  instead of auto-resolving) and `!==` → `<` on the required count (in scope "one" that
  admits two Energy off two DIFFERENT Pokémon — only the exact count catches it). The web
  agent found no soft-lock, no dispatchable-but-rejected choice and no leak; its 3 MEDs
  are fixed (log-row tone, `fieldset`/`legend` grouping, six missing tests), and I took
  two further UI calls off its report (pre-answer forced groups; put the spot in the
  legend). **Recorded, not fixed:** Mawile is the first "you may" trigger that cannot be
  declined, since this is the first mandatory parking op — left as-is because the op is
  pure upside, pinned by a test, with the trigger-level yes/no confirm as the real fix.
  **The bigger find is diagnostic:** scoping the family turned up **~13 more sv01–03
  cards** on the same idea blocked NOT by the op but by `attack.ts` running an attack's
  program as `runProgram(...).state` — so a parked result silently drops the prompt and
  the remaining ops. **No attack program may hold a decision.** That is now the top
  backlog row, with the fix's shape recorded (an `attackEpilogue` pending stage folded
  through `settleProgram`'s existing `resumeTail`).
- **2026-07-21** (build #25) — **P3-M5: board conditions — one `BoardCondition`
  vocabulary with TWO consumers** (D40; built solo — full context — then an adversarial
  engine+rules + web+integration review: **no HIGH from either**; 4 engine
  test-adequacy survivors + 4 web MEDs, all addressed). Chosen as the resume point's
  #1: the `conditionalPlay` family was the biggest remaining cluster. Built as **one
  primitive rather than a per-card flag**, which is the whole point of the slice.
  **`BoardCondition`** (effects.ts) is a predicate union evaluated for ONE seat —
  **`morePrizesThanOpponent`** (strict `>`: you are BEHIND on Prizes taken),
  **`yourStadiumInPlay`**, **`noEnergyOnYourPokemon`** (Active AND Bench, Basic or
  Special) — behind a single evaluator **`conditionHolds`** and a printed-text
  describer **`conditionNote`**. **The invariant IS the design: every member reads only
  PUBLIC state**, which is exactly why **a gate emits NO event** — contrast
  `coinFlipGate`, whose flip is genuinely new information; a board condition is a fact
  both players can read off the table, and the branch's own ops emit what happened.
  **Consumer A — the printed PLAY GATE:** `CardProgram.trainerPlayableIf`, checked by
  `playTrainer` BEFORE the card leaves hand (new `ErrorCode` `PLAY_CONDITION_NOT_MET`),
  so a failed gate costs nothing. Categorically distinct from `programPlayable`'s
  would-only-whiff heuristics: this is a rule PRINTED on the card, not the engine's
  judgement about ops that would do nothing. Named `trainer…` because it is honoured on
  EXACTLY one path — `playStadium`, `rareCandy`, `attachTool` and `useAbility` all
  return before it and would ignore it SILENTLY (the `trainerEndsTurn` precedent; also
  why Luxray's Ability-level gate must NOT be authored on this field).
  **Consumer B — the mid-program branch:** the **`conditionGate`** op
  `{cond, then, otherwise?}`, spliced into runProgram's work queue exactly like
  `coinFlipGate` — so an op inside a branch can still park, and a branch may hold
  further gates — evaluated against the board AS OF the gate. One-armed is the common
  shape (Falkner); **`otherwise`** exists for the printed "…**instead**", a genuine
  if/ELSE (Grusha). **One tiny new automatic op — `drawUntilHandSize`:** it DRAWS to a
  floor and never TRIMS a bigger hand, and at a count ≤ 0 it no-ops with NO event (no
  misleading "drew 0 cards" row). **Lands 3 COMPLETE real cards** (verified vs the
  local D1 catalog): **Fighting Au Lait** (sv02-181, Item — the gate + heal 60),
  **Falkner** (sv02-180/251, Supporter — authored as TWO draw ops, not one computed
  count, so the log shows both printed instructions), **Grusha** (sv02-184/253/268,
  Supporter — the `otherwise` arm; its hand count is measured AFTER the Supporter is
  discarded up front, which is the paper ruling for the hand-size family).
  **Web: zero new events, prompts, dialogs or projection fields.** The one change is
  the HUD greying a gated Trainer out with the engine's own `conditionHolds`, carrying
  `conditionNote` as the row's `title` + an `sr-only` line — load-bearing copy, because
  disabling the button REMOVES the reject pill that used to explain the printed rule,
  and that rule is text the HUD never shows. engineVersion 0.19.0 → **0.20.0**.
  **Review: NO HIGH from either agent.** The engine agent verified the slice's riskiest
  claim — **`yourStadiumInPlay` is OWNERSHIP, not presence** — against the Japanese
  printing of ハヤト (「場に**自分の**スタジアムが出ているなら」, "if **your** Stadium
  is out on the field") and Bulbapedia's Stadium article; an opponent's Beach Court
  must NOT grant Falkner's +2. Its **24-mutant** run left 5 survivors (1 equivalent),
  ALL test-adequacy — the gate read against the program's ENTRY state, the arm pushed
  to the BACK of the queue, the splice DROPPING the queue tail, a hand ABOVE the target
  being trimmed, and `conditionNote` returning wrong text. All are now fixed and
  **re-verified dead**, via two new fixtures: **fix-gateorder** (an attach BEFORE the
  gate that flips the condition, a two-op arm, and an op AFTER the gate — one ordered
  `CARDS_DRAWN` assertion kills three mutants at once) and **fix-gatedsup** (the only
  gated SUPPORTER, pinning that a rejected gate does not burn the §7.2 allowance, since
  every real gated card is an Item), plus a never-trims test and the first assertions
  on `conditionNote`'s player-facing wording. The web agent's 4 MEDs, all addressed:
  the missing `engineVersion` bump; unpinned log rows (3 tests added, incl. Falkner's
  PAIR of identical draw rows and Grusha's zero-row case); a **self-defeating** doc
  claim that "a P4 client may evaluate one locally"; and the HUD's opponent-`prizes`
  read. It also confirmed the ternary restructure is behaviour-preserving for every
  pre-existing card class, that no drag path bypasses the gate, that nothing outside
  the engine switches over `EffectOp` (`apps/api` does not depend on the engine at
  all), and that the error code is never rendered raw. **Recorded deviation
  (deliberate):** the HUD greys out a printed `trainerPlayableIf` gate while
  `programPlayable`'s whiff gates (Boss's Orders into an empty Bench) stay live and
  explain themselves via the reject pill — a rule printed on the card is knowable
  before clicking, an engine whiff-judgement is not; the tooltip is what makes the
  mixed standard coherent rather than a silent grey row. **P4 item recorded (NOT
  fixed):** `conditionHolds` takes a `GameState`, so only a raw-state host can run it —
  the projection does not carry `stadium.owner` and redacts the prize arrays to counts.
  The sharp edge: **a redacted prize array still has a `.length`**, so
  `morePrizesThanOpponent` would fail SILENTLY rather than loudly if shipped online
  unchanged. **Carried forward (pre-existing):** Fighting Au Lait is playable with
  nothing damaged anywhere (the Potion shape), which this slice makes conspicuous by
  enforcing the card's printed legality line; and `GameLog` announces only the batch's
  LAST row to screen readers, which a Falkner drawing 4 sharpens (it announces "drew 2
  cards", understating the play — and an unchanged live region announces nothing, so a
  second Falkner is silent). **Not demo-reachable:** none of the three cards is in the
  demo decks, so none of this is visible at `/play` without a deck change. `bun run
  check` green (tsc + biome + **1196 tests**, 1164 → 1196: 26 engine
  `boardCondition.test.ts` + 3 `logFromEvents.test.ts` + 3 HUD DOM), `vite build`
  green. Files: effects.ts, interpreter.ts, registry.ts, cardplay.ts, actions.ts,
  index.ts, testFixtures.ts, boardCondition.test.ts (new); web: GameHud.tsx + its DOM
  test, logFromEvents.test.ts. See "M5 op-slice: board conditions as built" + D40.
- **2026-07-21** (build #24) — **P3-M5: Iono — the `handRefresh` riders that CLOSE the
  hand-refresh family** (D39; built solo — full context — then an adversarial
  engine+rules + web+integration review: no HIGH, 2 MED, both fixed). Chosen as the
  resume point's #1: the format's **highest-play-rate Supporter**, and the last row of a
  family already built and vetted, so it lands as small riders on a reviewed op rather
  than a new mechanism. Verified against the local D1 catalog that **Marnie does not
  exist in sv01–03**, so Iono closes the row outright. **No new op** — three composable
  riders on D38's `handRefresh`: **`toBottom?: true`** (the PLACEMENT — shuffle the
  **hand alone** and append it UNDER the deck, `[...deck, ...shuffle(hand)]`, instead of
  shuffling it into the deck, so the deck's existing order and therefore the very next
  draws SURVIVE — the whole strategic difference from Judge, pinned by a test asserting
  the drawn cards are EXACTLY the pre-play deck top, in order); **`draw:{kind:
  "prizeCount"}`** (each affected player draws their OWN remaining Prize count — the
  player behind draws more; a Prize count is public, so the draw size leaks nothing);
  **`onlyIfAnyMoved?: true`** (the draw clause fires only if ≥1 affected player actually
  moved ≥1 card — an **all-or-nothing gate ACROSS the seats**, "if EITHER player…", not
  per-seat). **The one structural change:** that cross-seat gate needs every placement
  to happen before any draw, so `handRefresh` now runs **two passes** over the affected
  seats instead of D38's interleaved move-then-draw. **Behaviour-preserving** for
  Youngster/Judge/Brassius/Katy — per-seat zones are disjoint and `drawToHand` consumes
  NO rng, so final states and rng threading are byte-identical (the engine reviewer
  reconstructed the old loop and diffed hands/decks/`rngState` at 3 seeds each: identical;
  Katy identical modulo the one turn-start draw its `trainerEndsTurn` fold causes). The
  only change is Judge's event INTERLEAVING (SHUFFLED p1, SHUFFLED p2, DRAWN p1, DRAWN
  p2), which also reads truer to "each player shuffles … and draws". `shuffle` consumes
  nothing for a length ≤ 1 input, so **an Iono into two empty hands advances the rng ZERO
  times** and reorders nothing. One new event **`HAND_TO_BOTTOM_OF_DECK {seat, count}`**
  — count-only like its sibling, but **distinct** because the public fact differs (the
  deck's order is untouched, which both players must be able to read off the log).
  **Web: one log row, no dialog** (the op still never parks → no `EffectPrompt`, GameHud
  and the projection untouched) — "shuffled their hand (N cards) and put it on the bottom
  of their deck", which must say **both** verbs since the hand IS randomized on its way
  under an unshuffled deck. engineVersion 0.18.0 → **0.19.0**. **Review: no HIGH; 2 MED,
  both FIXED.** (1) Engine MED, found by **MUTATION testing** — deleting the hand shuffle
  left all 379 engine tests green, because every bottom-of-deck assertion was
  order-insensitive and **nothing in the repo asserted `rngState`**; fixed with two
  assertions (the bottomed cards are NOT in hand order — measured stable across 12 seeds;
  the both-empty play leaves `rngState` untouched) and the mutant re-run now fails. (2)
  Web MED, raised **independently by both agents** — the log row said only "put their
  hand … on the bottom", which against its sibling row reads as "Iono does not shuffle",
  so a player who had seen that hand would think the deck's tail was known; copy fixed.
  **LOWs applied:** an Iono degenerate-deck test (deck shallower than the Prize count
  short-draws and does NOT deck out — §14.3 is a turn-START rule), the describe-title
  rename, and a real end-to-end log test pinning the grouped 5-row batch (the two-pass
  restructure was otherwise unpinned on the web side). Also tidied: the stale dispatch
  comment, and the pass-2 lookup rebuilt as an ordered pair list so a captured hand size
  can never silently default. **Verified clean:** card conservation over every degenerate
  zone combination on both sides, exact rng advance counts (`(h1−1)+(h2−1)`), "Iono itself
  is never bottomed" (playTrainer discards up front), gate semantics (the `every`,
  per-seat, and opponent-prizes mutants each die to exactly one test), the projection
  serializing ZERO opponent uids, no exhaustive-switch fall-through (`apps/api` doesn't
  depend on the engine at all), HUD playability (enabled turn 2, §4-blocked turn 1, no
  prompt path reachable), and no demo regression. **Deliberate deviation (recorded in
  D39, at the reviewers' request):** Iono with EVERY affected hand empty is a total no-op
  yet stays **legal** — no `programPlayable` gate, unlike every other could-only-whiff op
  — because the digital clients allow it, it is self-inflicted and cannot soft-lock, and
  a gate would have to reach into "playTrainer discards the played card up front" (the
  D35 leaky coupling). **Two pre-existing items the review surfaced (NOT this slice):**
  every authored Supporter (Iono, Judge, Katy, Youngster, Professor's Research) carries
  `legal_standard=0` in the local ingest, so none surface in the deck builder's default
  standard-legal search; and `GameLog` announces only the LAST entry to screen readers,
  so a 5-row batch (Iono, Judge, any KO sweep) is mostly silent — a P5 polish item.
  `bun run check` green (tsc + biome + **1164 tests**, 1156 → 1164: 6 engine
  `handRefresh.test.ts` + 2 `logFromEvents.test.ts`), `vite build` green. Files:
  effects.ts, interpreter.ts, events.ts, registry.ts, index.ts, testFixtures.ts,
  handRefresh.test.ts; web: logFromEvents.ts + its test. See "M5 op-slice: handRefresh
  riders as built" + D39.
- **2026-07-20** (build #23) — **P3-M5 op-slice: `handRefresh`** (D38; built solo —
  full context — then an adversarial engine+rules + web+integration review, BOTH
  CLEAN, no code fixes). The Iono/Judge/Marnie **hand-refresh Supporter family** —
  shuffle your hand into your deck, then draw — and the **highest-value clean unlock
  left** (high-play-rate staples that land COMPLETE as a fully-automatic op).
  Chosen over the from-the-top-attach compound (higher risk) and the `conditionalPlay`
  family (each card still needs a second effect op). New op **`handRefresh`**
  (`{op, who:"you"|"both", draw:HandRefreshDraw}`, effects.ts/interpreter.ts) — the
  FIRST op in a new class: **fully AUTOMATIC** (no decision → it NEVER parks, like
  drawCards/discardHand/shuffleDeck) AND it can affect the **opponent** (`who:"both"`,
  Judge — the first op to reach the OPPONENT's hand/deck). Per affected seat (a fixed
  order — controller first, then, for `both`, the opponent) it captures the PRE-shuffle
  hand size, moves the whole hand into the deck, shuffles the combined pile
  (`shuffle([...deck, ...hand])` — one rng advance; append-then-shuffle = "shuffle
  into"), then draws per **`HandRefreshDraw`**: `{kind:"fixed", count}` (Youngster 5,
  Judge 4, Katy 8) or `{kind:"handPlus", delta}` (Brassius "draw that many cards plus
  1" = the pre-shuffle hand size + 1). **Card conservation** is a pure multiset move
  (`combined = [...deck, ...hand]`, then `drawToHand` slices top `drawCount` → hand,
  rest → deck — invariant under empty-hand / empty-deck / hand==whole-deck / both-empty,
  all guarded); the played Supporter is discarded UP FRONT by `playTrainer`, so it is
  never shuffled back. `rngState` is read fresh each iteration and written back into
  `next`, so the two-shuffle Judge threads controller-then-opponent with no stale reuse
  / no dropped advance (reuses rng.ts's single vetted Fisher–Yates). **Always playable**
  (no `programPlayable` gate — you may always shuffle-and-draw, even from an empty
  hand); never damages/KOs. **Katy "your turn ends"** lands the `endsTurn` fold on the
  TRAINER path: a new CardProgram flag **`trainerEndsTurn?: true`** (parallel to
  `rareCandy`) that `playTrainer` reads and passes to `settleProgram`, folded
  **byte-for-byte like `AbilityProgram.endsTurn`** (the D34 Koraidon precedent — on
  DONE it seeds `turnTail(controller)`); every non-Katy trainer passes `endsTurn:false`
  and stays byte-identical to the old no-opts call — **no regression**. One new event
  **`HAND_SHUFFLED_INTO_DECK {seat, count}`** — count-only (a shuffled hand card is
  hidden); the deck reorder is intrinsic (no separate `SHUFFLE` event — none has an
  engine-state consumer). Representatives (verified vs the local D1 catalog, all
  Supporters): **Youngster** (sv01-198, draw 5), **Judge** (sv01-176, both draw 4),
  **Brassius** (sv03-187, draw hand+1), **Katy** (sv01-177/237, draw 8 + turn ends).
  **Web: one log row, no dialog** — handRefresh never parks, so NO new `EffectPrompt`/
  dialog (GameHud untouched); `logFromEvents` gains one count-only
  `HAND_SHUFFLED_INTO_DECK` row, the draw riding the existing count-only `CARDS_DRAWN`.
  **Hidden info (Judge — the first op to touch the opponent's hand): leaks NOTHING
  new** — the opponent's `CARDS_DRAWN` uids are the standard `drawToHand` contract every
  draw uses; the log's CARDS_DRAWN + HAND_SHUFFLED_INTO_DECK arms are both count-only,
  and the per-viewer projection already redacts the opponent's hand to uid-less
  `hiddenHand` backs. Katy's turn-end needs no web change (rides the existing phase→seat
  viewer-follow). engineVersion 0.17.0 → **0.18.0**. **Review (adversarial engine+rules
  + web+integration): BOTH CLEAN, no HIGH/MED, NO code fixes.** Engine agent proved card
  conservation over all four degenerate zone states, correct two-shuffle rng threading,
  the handPlus timing (no off-by-one), the Katy endsTurn fold consistent with Koraidon
  (full 374-test engine suite passes — no regression), purity against a recursive
  freeze, and all four texts byte-matching the catalog (no missed reprint — Katy's
  sv01-237 IS mapped; Iono/Marnie correctly deferred). Web agent proved the Judge
  hidden-info safe on BOTH the log and projection paths, that no exhaustive web switch
  breaks on the new event (the one `satisfies never` is over the Phase union, and Katy
  adds no phase), and that Katy's turn-end needs no web handling. **INFO (both, not
  bugs):** an empty hand emits `count:0` ("shuffled their hand (0 cards)…" — honest,
  non-leaky, the `HAND_DISCARDED "(0 cards)"` precedent); the no-separate-`SHUFFLE`-event
  choice is cosmetic with no downstream consumer. **Scope:** authors 4 COMPLETE
  Supporters — the whole `shuffleHandIntoDeck` backlog row (Youngster / Brassius / Katy)
  **plus Judge**, and closes the `endTurn` row (Katy joins Koraidon); Iono/Marnie layer
  later (a bottom-of-deck move + a `prizeCount`/split draw spec). `bun run check` green
  (tsc + biome + **1156 tests**, 1146 → 1156: 9 engine `handRefresh.test.ts` + 1
  `logFromEvents.test.ts`), `vite build` green. Files: effects.ts, interpreter.ts,
  events.ts, registry.ts, cardplay.ts, index.ts, testFixtures.ts, handRefresh.test.ts
  (new); web: logFromEvents.ts + its test. See "M5 op-slice: handRefresh as built" + D38.
- **2026-07-20** (build #22) — **P3-M5 op-slice: `moveEnergy`** (D37; built solo —
  full context — then an adversarial engine+rules + web review plus an independent
  Opus pass, CLEAN). The next backlog op by unlock count (5), and the interpreter's
  **first op with two COUPLED decisions** (which Energy AND where). New op
  **`moveEnergy`** `{filter, max}` moves up to `max` Energy from ONE of the
  controller's own in-play Pokémon to ANOTHER. Every op before this reused one
  existing prompt; a two-endpoint move can't, so it adds a **new compound prompt**
  `moveEnergy` (`movable`: each takeable Energy uid tagged with its source
  `PokemonRef`; `destinations`: all own in-play refs) and a **new choice**
  `{uids, dest}` answering both at once — applied **ATOMICALLY** by `moveEnergyApply`
  (strip the picks off their source, append to the dest in one `withSide`; a floating
  detached-Energy state never exists, which is why it is one compound park not two
  sequential ones with a leaked intermediate). "Up to"/declinable; ALWAYS parks when
  playable (never auto-resolves), the searchDeck/lookAtTopN family. **`validateChoice`
  (cardplay.ts)** enforces every coupling the compound decision needs: each uid an
  offered `movable` (distinct, non-string rejected), ALL picks share ONE source
  Pokémon (the printed "from 1 of your Pokémon"), dest an offered ref, and **dest ≠
  source** (no moving a Pokémon's Energy onto itself) — so a crafted P4 payload can't
  apply an illegal move. **`moveEnergyApply` conserves cards** (each picked uid removed
  from exactly one non-destination Pokémon, appended once to the dest; the dest is
  never stripped → no self-move/dup; stale/dest-resident uids skipped) and is pure
  like `searchMove` (the freeze test reaches the move). New **`programPlayable` gate**
  (`moveEnergyPlayable`: ≥1 Energy the filter admits AND ≥2 of your Pokémon in play) =
  the EXACT complement of `stepOp`'s no-op condition, so a gated card is never wasted
  and a playable card always parks (no silent no-op, no soft-lock — ≥2 Pokémon
  guarantees a legal source≠dest pair). One new `CardFilter` kind **`anyEnergy`**
  (Basic OR Special — Poppy moves either; Energy Switch stays `basicEnergy`) + one new
  event **`ENERGY_MOVED {seat, uids, from, to}`** (`from`/`to` are `PokemonTarget`
  copies; no bench compaction, so both resolve post-state). Representatives (verified
  vs the local D1 catalog): **Energy Switch** (sv01-173, Item — a Basic Energy, max 1),
  **Poppy** (sv03-193/220/227, Supporter — up to 2 any Energy, max 2). **Web: a new
  dialog + a log row** — `MoveEnergyDialog` is a staged pick like Rare Candy (source
  → its Energy + a distinct destination → Confirm, or **Move none** to decline), which
  can only ever dispatch a `validateChoice`-accepted choice (dest drawn from
  destinations-minus-source; picks capped at `max`, all from the one selected source);
  new `ENERGY_MOVED` log row ("moved N energy from X to Y"). **This prompt leaks
  NOTHING** — its `movable`/`destinations` are entirely the controller's OWN face-up
  in-play Energy/Pokémon (public table facts), so — uniquely among the parking ops so
  far — no P4 redaction is even needed for it (contrast searchDeck/lookAtTopN, whose
  deck-order candidate uids are the standing P4-deferral INFO). engineVersion 0.16.0 →
  **0.17.0**. **Review: CLEAN, no HIGH/MED** — card conservation under dest==source /
  dest-resident pick / stale uid / two-source pick / bench-index shift; every illegal
  wire payload rejected; the gate ⇔ no-op equivalence; purity; rules accuracy (Poppy
  moves Special too, Energy Switch basic-only, same-source enforced, no §6.3 attach
  allowance touched); and the dialog can't dispatch a rejected choice. **One action:**
  the auto-selected single-source path was tested but the **multi-source source-picker
  stage** (and its Back/reset) was not — added a two-source Poppy DOM test. **INFO
  (not a bug):** Energy Switch's text is not "you may", so allowing a decline is a
  minor documented deviation (harmless — the player just wouldn't play the card),
  consistent with the "up to"/declinable search family. **Scope:** authors 2 of the
  op's 5 backlog cards (own→own); the other 3 layer riders — Armarouge "Fire Off" (a
  {R} Energy benched→Active, an Ability), Mismagius "Magical Flick" (the OPPONENT's
  Energy on evolve, an onEvolve trigger), Exp. Share (an on-KO Tool trigger). `bun run
  check` green (tsc + biome + **1146 tests**, 1126 → 1146: 16 engine + 1 log + 3 DOM),
  `vite build` green. See "M5 op-slice: moveEnergy as built" + D37.
- **2026-07-20** (build #21) — **P3-M5 op-slice: `lookAtTopN`** (D36; built solo —
  full context — then a 2-agent Opus review, BOTH CLEAN). The next backlog op by
  unlock count, and the **top-of-deck twin of the vetted `searchDeck` op** — look
  at the top `n` cards, put up to `max` matching a filter into HAND, then shuffle.
  New op **`lookAtTopN`** `{n, filter, max}` looks at `deck.slice(0, n)` (index 0 =
  the top, per `drawToHand`) and PARKS on the **same `chooseCards` prompt** (no new
  dialog/prompt/wire shape) — but the candidates are ONLY the `filter` matches among
  the **top `n`**, in deck order, never a deeper card. "Up to"/declinable → parks on
  ≥1 candidate; an empty top-`n` match is a no-op. **Wire-safety is free:**
  `resolveEffect`/`validateChoice` already rejects any pick not in the candidate set
  (`BAD_EFFECT_CHOICE`), so a client cannot reach past the window; the new mover
  **`revealFromTop`** (mirrors `searchMove`/`retrieveMove`) keeps the `deck.includes`
  secondary guard. "Shuffle the other cards back into your deck" is the trailing
  **`shuffleDeck`** op (the Nest Ball search-then-shuffle pattern), so a whiff OR a
  decline still shuffles. **No new `CardFilter`** (Great Ball reuses `anyPokemon`,
  Pokégear reuses the `supporter` filter added with Pal Pad in D35); **no
  `programPlayable` gate** (a look-at-top is always playable — you look and shuffle
  even on a guaranteed whiff, so it never soft-locks). One new event
  **`DECK_TOP_REVEALED {seat, uids}`** (count-only in the log — honest "looked at the
  top of their deck" rather than DECK_SEARCHED's "searched"; the taken cards are
  revealed/public per the printed "reveal", and the non-taken looked-at cards never
  enter any event). Representatives (verified vs the local D1 catalog, both Items):
  **Great Ball** (sv02-183 — top 7, reveal a Pokémon → hand), **Pokégear 3.0**
  (sv01-186 — top 7, reveal a Supporter → hand). **Web: one log row, nothing else** —
  the shared origin-agnostic `ChooseCardsDialog` (relabeled "Choose cards" in D35)
  renders the accurate `prompt.note` ("Look at the top 7 cards of your deck and put a
  Pokémon into your hand." / "…a Supporter card into your hand."), and the projection
  forwards the `chooseCards`/`dest:"hand"` prompt with no change (nothing switches on
  `dest`). engineVersion 0.15.0 → **0.16.0**. **Review (2 Opus agents — engine+rules /
  web+integration): BOTH CLEAN, no HIGH/MED correctness bugs, NO code fixes.** The
  engine agent (8-test suite + a 22-assertion probe) proved card conservation
  (symmetric deck→hand move + the shuffle permutation), candidate correctness =
  **exactly the top-`n` matches** (the window boundary PINNED — a match at index 6 IS
  a candidate, one at index 7 is NOT; a shallow deck with `n` > length and `n ≤ 0`
  both handled by `slice`/`Math.max(0,n)` with no over-read), wire-safety (a deeper /
  duplicate / over-max / non-string pick all rejected), shuffle-always-fires (the
  trailing op lives in the continuation `rest`), no flow-tail/KO interaction, purity
  (the freeze reaches `revealFromTop`), and program-vs-text. The web agent proved log
  honesty + count-only + correct hot-seat seat attribution, the projection "unchanged"
  claim (no `dest` switch; the event handled in the one web event switch), the dialog
  serves the note, and no demo regression. **INFO (both agents, PRE-EXISTING P4
  deferral — not this slice):** the parked `chooseCards` prompt carries the top-`n`
  candidate uids unredacted per-viewer — identical to `searchDeck`/`discardPileRetrieval`,
  unobservable in the local hot-seat (the dialog renders only for the acting viewer),
  and exactly what P4's server filter must redact for the non-acting viewer; a second
  INFO notes `revealFromTop` does not dedup its input before the hand-append
  (unreachable — validateChoice rejects duplicates first — and the identical contract
  as the vetted movers, kept consistent rather than singled out). **Scope:** authors
  2 of the op's 5 backlog cards; the other 3 need a from-the-top **attach** variant
  (Electric Generator sv01-170 / Hydreigon sv02-140 — which ALSO unblocks 2 of the
  remaining attachEnergyFrom cards) or an opponent-deck peek (Malamar sv03-138).
  **1117 → 1126 tests**, `bun run check` + `vite build` green. Files: effects.ts,
  interpreter.ts, events.ts, registry.ts, index.ts, testFixtures.ts (2 Item fixtures
  + `LOOK_AT_TOP_DECK` + the `toDeckTop` surgery), lookAtTopN.test.ts (new); web:
  logFromEvents.ts, logFromEvents.test.ts.
- **2026-07-20** (build #20) — **P3-M5 op-slice: `discardPileRetrieval`** (D35;
  built solo — full context — then a 2-agent Opus review, BOTH CLEAN). The
  next-biggest backlog unlock after `attachEnergyFrom` (6 cards), and a near-exact
  **mirror of the vetted `searchDeck` op** — source = the DISCARD pile, dest = hand
  or deck. New op **`discardPileRetrieval`** `{filter, dest:"hand"|"deck", max}`
  retrieves up to `max` matching cards, "up to"/declinable, PARKS on the **same
  `chooseCards` prompt** (no new dialog/prompt/wire shape), no-op on empty match, no
  bench-space clamp (hand/deck uncapped). `dest:"deck"` appends to the deck end, so
  "Shuffle … into your deck" is authored `[discardPileRetrieval(dest:deck),
  shuffleDeck]` (the Nest Ball search-then-shuffle pattern; a whiffed play still
  shuffles — self-affecting only, never illegal). `retrieveMove` mirrors
  `searchMove` (dedup Set, only in-discard uids move, wire-checked by the existing
  `validateChoice`). Two new `CardFilter` kinds — **`supporter`** (Trainer +
  "Supporter") and **`pokemonOrBasicEnergy`** (Pokémon OR a `Normal` basic Energy —
  Special excluded) — and one new event **`DISCARD_RETRIEVED`** (count-only log; the
  discard pile is public). Representatives (verified vs local D1, all Items):
  **Energy Retrieval** (sv01-171 — 2 Basic Energy → hand), **Pal Pad** (sv01-182 — 2
  Supporters → deck), **Super Rod** (sv02-188/276 — 3 Pokémon/Basic Energy → deck).
  **Web (small honest touch, not "unchanged"):** the shared `ChooseCardsDialog`'s
  accessible label changed **"Search your deck" → "Choose cards"** (it now serves a
  deck search AND a discard retrieval; the accurate description rides `prompt.note`,
  which reproduces the printed card text), the `chooseCards` prompt `dest` union
  widened to include `"deck"` (inert at every consumer — the dialog never reads
  `dest`), and `logFromEvents` gained one `DISCARD_RETRIEVED` row (2 dom assertions
  updated). engineVersion 0.14.0 → **0.15.0**. **Review (2 Opus agents — engine+rules
  / web+integration): BOTH CLEAN, no HIGH/MED correctness bugs.** Engine agent proved
  card conservation (symmetric remove/append, no clamp needed), filter semantics
  (Special Energy + Trainers excluded), park/resume with **no deck-order leak** (park
  is before the move; the trailing `shuffleDeck` runs synchronously in the resume
  batch, never dropped), self-reference + flow-tail safety. Web agent proved no
  hidden-info leak (count-only log, both discard piles public in the projection) and
  an inert `dest` widening. **Fixes applied:** one MED — the purity test froze the
  PRE-park state and never reached `retrieveMove` (the mutation runs during the later
  `resolveEffect`), strengthened to freeze the parked state and drive the resolve;
  LOWs — pinned the `retrieveNote` strings, added the Super Rod degenerate-ends
  (only-Pokémon / only-Energy) + a take-none-with-trailing-shuffle case. **INFO
  (forward-looking, not triggered):** `playTrainer` discards the played card up
  front, so a FUTURE self-matching card (a Supporter on this op with
  `filter:supporter`) would offer itself as a candidate — flagged in the op's
  authoring note; the 3 Items are all safe (no filter matches an Item). **Scope:**
  authors 3 of the op's 6 backlog cards; the other 3 need `discardFromHandCost`
  (Superior Energy Retrieval), a conditional draw (Miriam), or an Ability (Pelipper).
  Chosen over the resume point's #1 (deck-search-attach) because that op leaves every
  one of its 4 cards still blocked on a SECOND op, while this lands complete cards.
  **1106 → 1117 tests**, `bun run check` + `vite build` green. Files: effects.ts,
  interpreter.ts, events.ts, registry.ts, index.ts, testFixtures.ts,
  discardRetrieval.test.ts (new); web: GameHud.tsx, logFromEvents.ts,
  GameHud.cardplay.dom.test.tsx.
- **2026-07-19** (build #19) — **P3-M5 op-slice: attachEnergyFrom MULTI-attach +
  endsTurn** (D34; built solo — full context — then a 2-agent Opus review, BOTH
  CLEAN). Authoring **Koraidon ex "Dino Cry"** (sv01-125/231/247/254 — attach up to
  2 Basic {F} from discard to your Basic {F} Pokémon in any way, then your turn
  ends). Three ideas: **(1) MULTI-attach needs NO new op** — "attach up to N in any
  way you like" is just **N `attachEnergyFrom` ops** in one program (the interpreter
  parks on each op's target in turn — independent target per energy — and a later op
  that finds no matching Energy no-ops, so the program attaches min(N, available);
  the "may attach fewer" is auto-maxed, the pure-upside doctrine); **(2)**
  **`basicOnly`** — a target-filter rider (the target must be `isBasicPokemon`, with
  `targetType:"Fighting"` → "your Basic {F} Pokémon"), added to
  `attachEnergyTargets`; **(3)** **`AbilityProgram.endsTurn`** — a flag that ENDS
  the controller's turn once the program completes, folded by **`settleProgram`**
  (flow.ts: on DONE, seed `turnTail(controller)` + advance — byte-for-byte the
  normal `endTurn` action — instead of returning to turn:action), threaded across
  re-parks by a new **`endsTurn?: true`** on the `effect:choose` Phase (parallel to
  `resumeTail`, mutually exclusive). The DONE+endsTurn branch skips the mid-turn KO
  sweep (Koraidon does not damage; the folded Checkup catches any KO regardless).
  **Web: UNCHANGED** — the two sequential parks + the turn-end transition ride the
  existing effect:choose/choosePokemon path + the viewer-follow (the device flips to
  the opponent when the turn ends), exactly like the on-KO `resumeTail` re-park.
  engineVersion 0.13.0 → **0.14.0**. **Review (2 Opus agents — engine+rules / web):
  BOTH CLEAN, no HIGH/MED/LOW bugs.** Engine agent: the endsTurn fold consistent
  with the normal turn end (same `advance(turnTail)` shape → no stale-phase leak;
  the flag survives both re-parks, fires only on the final DONE), multi-attach no
  double-attach / no over-reject (op #2 re-finds energy on the post-op-#1 state),
  basicOnly total (no throw on `types:null`), and — bonus — poison-KOs during the
  folded Checkup resolve correctly. Web agent (real web-layer probe): the endsTurn
  Phase field doesn't break the exhaustive switch, both parks report the controller
  active/waiting, the turn-end flips the viewer to the opponent, the two parks
  re-render cleanly (stable dialog key), no demo regression. INFO only: a *damaging*
  endsTurn ability (none in scope) would resolve KOs via the Checkup sweep with a
  timing difference; no button cue that Dino Cry ends the turn (by design). **Scope:**
  authors Koraidon ex — **4 of the 11** attachEnergyFrom cards; the other 7 need a
  deck-search source / `lookAtTopN` / self-KO / onEvolve / can't-attack /
  attach-to-self / special-energy-by-name. **1101 → 1106 tests**, `bun run check` +
  `vite build` green. Files: effects.ts, interpreter.ts, registry.ts, types.ts,
  flow.ts, cardplay.ts, index.ts, testFixtures.ts, dinoCry.test.ts (new) + docs
  (D34, coverage-backlog.md, simulator.md, progress.md).
- **2026-07-19** (build #18) — **P3-M5 op-slice: `attachEnergyFrom` RIDERS**
  (D33; built solo — full context — then a 2-agent Opus review, BOTH CLEAN). The
  D32 attach op grew three composable RIDERS authoring the marquee **Gardevoir ex
  "Psychic Embrace"** (sv01-086/228/245): **`targetType`** (eligible targets = the
  controller's own Pokémon whose TOP card is that type — {P}), **`bonusCounters`**
  (put N HP of damage counters on the Pokémon just attached to — 2 = 20, as
  `COUNTERS_PLACED` source "ability"), **`notIfKO`** (exclude any target the
  bonusCounters would Knock Out — `damage + bonusCounters ≥ effectiveMaxHp`, the
  exact complement of the KO test, so the counters are ALWAYS non-lethal and the
  op still never KOs). The filtered candidate set is a new exported
  **`attachEnergyTargets`** (interpreter.ts), shared by the park AND
  `programPlayable` (which now also rejects when NO eligible target remains — a
  play that does nothing can't be made). Gardevoir's program: `{attachEnergyFrom,
  source:"discard", energyType:"Psychic", targetType:"Psychic", bonusCounters:20,
  notIfKO:true}`, `oncePerTurn:false` (repeatable — "as often as you like").
  **Web: UNCHANGED** — reuses the choosePokemon dialog + ENERGY_ATTACHED + the
  COUNTERS_PLACED "ability" log row + the damage chip (the 2 self-counters render
  as damage). engineVersion 0.12.0 → **0.13.0**. **Review (2 Opus agents —
  engine+rules / web): BOTH CLEAN, no HIGH/MED bugs.** Engine agent proved the
  notIfKO non-lethal guarantee AIRTIGHT (a basic-energy attach cannot shift
  `damage`/`effectiveMaxHp` between park and apply — those read only the top card +
  tools, never energy; the `≥` boundary matches the KO test; and settleProgram's
  DONE sweep is a safety net regardless — empirically Gardevoir stops at exactly
  15 uses / 300 damage, never KO'd), plus targetType/bonusCounters correctness, no
  base-op regression, wire-safety, purity. Web agent verified the reuse claim
  through the real HUD (133 tests + probe): the repeatable button never greys, the
  choosePokemon dialog dispatches a legal controller-seat choice, the self-counters
  render, the log reads sensibly, no soft-lock (a no-eligible-target Gardevoir
  rejects `NO_LEGAL_TARGET` before parking an empty dialog), no demo regression.
  One LOW (a stale COUNTERS_PLACED "ability" log COMMENT — the render was correct)
  fixed. **Scope:** authors Gardevoir ex — **3 of the 11** attachEnergyFrom cards;
  the other 8 need multi-attach / deck-search source / `lookAtTopN` / "turn ends" /
  self-KO / onEvolve / special-energy-by-name. **1095 → 1101 tests**, `bun run
  check` + `vite build` green. Files: effects.ts, interpreter.ts
  (`attachEnergyTargets` + bonusCounters), cardplay.ts (programPlayable),
  registry.ts, index.ts, testFixtures.ts, psychicEmbrace.test.ts (new),
  logFromEvents.ts (comment fix) + docs (D33, coverage-backlog.md, simulator.md,
  progress.md).
- **2026-07-19** (build #17) — **P3-M5 op-slice: `attachEnergyFrom`** (D32; built
  solo — full context — then a 2-agent Opus review, BOTH CLEAN). The first new op
  built off the D31 coverage backlog (its top unlock, 11 cards). **`attachEnergyFrom`**
  (`{op, source:"hand"|"discard", energyType?}`, effects.ts/interpreter.ts)
  attaches ONE Basic Energy from the controller's hand or discard pile onto a
  CHOSEN own in-play Pokémon (§6 acceleration). Key simplification: same-type
  Basic Energy is FUNGIBLE, so there is no "which energy" choice — the op picks
  the first match and the only decision is the TARGET, reusing the existing
  `parkOrForce` → `choosePokemon` prompt; it re-finds the first matching energy at
  APPLY time (deterministic — while parked on effect:choose only the controller's
  `resolveEffect` is legal, so the source is frozen). A source with no matching
  energy is a no-op, and **`programPlayable`** (cardplay.ts) blocks activating an
  Ability whose attach could only whiff (the gust/snipe precedent — the shared
  `firstAttachableEnergy`, exported). NOT the §6.3 one-per-turn manual attach — no
  allowance touched; reuses `ENERGY_ATTACHED` (host by uid). Representatives:
  **Quaquaval "Energy Carnival"** (sv01-054, any Basic from hand, oncePerTurn:true)
  + **Baxcalibur "Super Cold"** (sv02-060/210, {W} from hand, **REPEATABLE**
  oncePerTurn:false → the HUD button never locks out) + a FIXTURE **fix-attacher**
  for the discard branch (the clean real discard cards carry riders needing later
  ops). New test surgery `discardFromDeck`. **Web: UNCHANGED** — no new
  EffectPrompt (choosePokemon), no new event (ENERGY_ATTACHED), no new phase; the
  slice-2 Ability button + choosePokemon dialog + log row serve it as-is.
  engineVersion 0.11.0 → **0.12.0**. **Review (2 Opus agents — engine+rules /
  web+integration): BOTH CLEAN, no HIGH/MED/LOW correctness bugs.** Engine agent
  (6 probes): no energy dup/loss (found-in / removed-from zones provably
  identical), fungibility re-pick safe, wire-safety (hostile ref rejected, no
  throw), ENERGY_ATTACHED contract (copied target, no allowance, emit-only),
  discard order preserved, purity. Web agent (7 real-HUD probes): the reuse claim
  holds (no `src/` change), the repeatable button never greys, the choosePokemon
  dialog dispatches a legal controller-seat choice, the log row is source-agnostic,
  the projection keeps the viewer on the controller, no demo/`/play` regression.
  One INFO (unreachable today): `programPlayable` runs BEFORE an ability cost is
  paid, so a future cost+hand-attach ability whose only match is the cost card
  could pass the gate then no-op (wasted, never corrupt) — revisit with the
  discard-with-rider variants. **Scope:** single-attach only — authors **2 of the
  11** attachEnergyFrom backlog cards; the other 9 layer riders (multi/+counters/
  ends-turn/self-KO/deck-search/`lookAtTopN`/attach-to-self/special-energy-by-name).
  **1087 → 1095 tests**, `bun run check` + `vite build` green. Files: effects.ts,
  interpreter.ts, cardplay.ts, registry.ts, index.ts, testFixtures.ts,
  attachEnergyFrom.test.ts (new) + docs (D32, coverage-backlog.md, simulator.md,
  progress.md).
- **2026-07-19** (build #16) — **P3-M5 coverage pass #1** (the coverage-expansion
  fan-out). A classify→verify **Workflow fan-out** (10 agents: 5 batches ×
  classify + adversarial verify, 0 errors, ~359k agent tokens) classified the
  **140 un-authored sv01–03** Trainers (61) / Special Energies (4) / Pokémon
  Abilities (75) against the current op vocabulary with the deriver doctrine
  (exact map or flag). Result: **5 authorable now**, 113 needs-op, 22
  already-authored — coverage is **op-bound, not authoring-bound** (~4%
  expressible today). Deliverable is BOTH the 5 landed cards AND the ranked
  **new-op backlog** (`docs/reference/coverage-backlog.md`): `attachEnergyFrom`
  unlocks 11, `discardPileRetrieval` 6, `lookAtTopN`/`moveEnergy`/`conditionalPlay`
  5 each, then a long tail that collapses into a few parameterized ops.
  **Landed** (registry rows over existing ops, id-verified vs the local catalog,
  each test-pinned): Poké Ball (sv01-185, coin-gated Pokémon search → hand),
  Pokémon Catcher (sv01-187, coin-gated gust), Nemona (sv01-180, draw 3),
  Copperajah ex (sv02-150, passive Bronze Body −30 after W/R), Stonjourner
  (sv01-121, passive Exoskeleton −20). Hand-verification caught a fan-out bug —
  Poké Ball's `shuffleDeck` was placed OUTSIDE the coin gate (a tails play would
  reorder the deck); fixed to inside the gate + pinned by a "tails → NO shuffle"
  test. Poké Ball / Catcher are the first Trainers to use `coinFlipGate`, so the
  `ATTACK_EFFECT_COIN_FLIP` log copy was neutralized ("flipped X for the effect").
  **No engine mechanism changed** (additive registry rows + fixtures + one
  `coverage.test.ts` + the backlog doc), so no 2-agent slice review — the fan-out's
  classify+verify already double-checked each program and each landed card is
  hand-verified + tested. engineVersion unchanged (0.11.0). **1080 → 1087 tests**,
  `bun run check` + `vite build` green. Files: registry.ts, testFixtures.ts,
  coverage.test.ts (new), logFromEvents.ts/.test.ts + docs/reference/coverage-backlog.md
  (new), simulator.md, progress.md, decisions.md.
- **2026-07-19** (build #15) — **P3-M4 slice 9: on-KO triggered Abilities**
  (§8.1, D30; built solo — full context loaded — then a 2-agent Opus review,
  BOTH CLEAN — **this CLOSES M4**). A "when this Pokémon is Knocked Out" Ability
  fires mid-KO-sweep DURING the opponent's turn — the inverse of the slice-8
  snipe (the KO fires the trigger, not the trigger firing the KO), and the last
  deferred mid-turn-KO timing. `TriggerTiming` += **`"onKnockOut"`**; detection
  is triggers.ts **`onKnockOutTrigger`** (via `cardIdByUid → programFor`, valid
  AFTER the KO discarded the card), driven by flow.ts's KO sweep. Two forms on
  `TriggeredAbility`: **(1)** a coin-flip **Prize GUARD** (`onKoPrizeGuard:
  "coinFlipPrevent"` — Glimmora "Shattering Crystal": heads → the opponent takes
  no Prize for it), resolved INLINE by a new **`planPrizes`** run UP FRONT —
  before the §14 tie-guard speculation — threading rng ONCE so the speculation
  and the real KO share the post-flip count (§14 stays exact), the guard's events
  (`ABILITY_TRIGGERED`/`ABILITY_COIN_FLIP`/`PRIZE_PREVENTED`) firing after the
  `KNOCKED_OUT`; **(2)** a general parking **PROGRAM** run as a new **`koTrigger`
  PendingStage** — `advance`'s `koTrigger` case → **`runKoTrigger`** →
  **`settleProgram` with a new `resumeTail` flag**: the program PARKS on
  `effect:choose` (where `phase.seat` is the KO'd, NON-turn player) and, on
  `resolveEffect`, the DONE branch keeps DRAINING the queued prize/promotion tail
  (`advance`) instead of folding back to a turn — the resume-the-tail
  continuation the slice-6/8 deferral named. `collectKnockOuts` groups the batch
  PRIZES-first, then koTriggers, then promotions; a §14 game-ending prize
  (finishGame clears `pending`) skips the koTrigger program, while the guard
  (resolved earlier) can DENY a game-winning prize. Fires from all three KO
  callers (attack epilogue, Checkup, mid-turn `resolveMidTurnKnockOuts`) — they
  share `collectKnockOuts`. Behaviour-neutral for every card with no on-KO
  Ability (planPrizes plans its face-value Prize, no flip, no koTrigger — the
  whole prior suite passes unchanged). Representatives: **Glimmora** (sv02-126,
  real — verified vs the local catalog) for the guard, **fix-onko** (a FIXTURE —
  "Last Wish" searches a Basic → hand, parking) for the resume-the-tail path (no
  real SV-era on-KO Ability requires a decision; the fix-sniper precedent);
  neither in the demo decks. New events `ABILITY_COIN_FLIP` / `PRIZE_PREVENTED`;
  new `PendingStage` `koTrigger`; `Phase.effect:choose` += `resumeTail?: true`.
  **Web:** the projection's `effect:choose` case reads the turn owner via
  **`koParkActiveSeat`** when `resumeTail` (activeSeat ≠ waitingSeat — the KO'd
  non-turn player owes it mid-opponent-turn, like the ko:* parks); the parked
  decision reuses the existing `chooseCards` dialog (no new dialog); two
  `logFromEvents` rows. engineVersion 0.10.0 → **0.11.0**. **Review (2 Opus
  agents — engine+rules / web+integration): BOTH CLEAN, no HIGH/MED/LOW
  correctness bugs.** The engine agent enumerated the §14 tie guard × prize
  denial over ALL FOUR coin-flip combos × 60 seeds (every win/tie/continue exact,
  one rng advance), proved the no-ability path byte-equivalent, and probed the
  resume-the-tail across all three KO callers. The web agent proved
  `koParkActiveSeat` correct per origin, the viewer-follow flip to the KO'd
  player, the dialog dispatch for the KO'd seat, and NO demo/`/play` regression.
  One engine LOW (a seed-fragile / misframed §14 test of mine) FIXED (both guard
  branches pinned + a deterministic fix-onko §14-skips-the-program test); one web
  INFO is the pre-existing P4 hidden-info gap. **1066 → 1080 tests**, `bun run
  check` + `vite build` green. Files: flow.ts, registry.ts, triggers.ts,
  types.ts, events.ts, cardplay.ts, index.ts, testFixtures.ts, onKnockOut.test.ts
  (new) + projection.ts, logFromEvents.ts and their tests +
  GameHud.cardplay.dom.test.tsx.
- **2026-07-19** (build #14) — **P3-M4 slice 8: the mid-turn-damage snipe** (§9,
  D29; built solo — full context loaded — then a 2-agent Opus review, BOTH
  CLEAN). A damaging Ability that puts damage counters on CHOSEN opponent Benched
  Pokémon and can Knock one Out **mid-turn** (the actor keeps their turn) — the
  last deferred mid-turn-KO reach from slices 4/6. New op **`damageChosen`**
  (`{op, target:"opponentBench", amount, count}`, effects.ts/interpreter.ts):
  place `amount` HP of counters on `count` chosen opponent Benched Pokémon —
  **flat** (no Weakness/Resistance, no reduction passive; a counter placed by an
  Ability is not "damage from attacks" — the `damageActive`/poison-tick rule,
  distinct from `spreadDamage` which IS attack damage). PARKS on a NEW
  multi-Pokémon prompt **`choosePokemonMulti {candidates, max}`** / choice
  `pokemonMulti {refs}` (the first multi-select Pokémon decision; "you may" +
  "up to" → 0..max) when the opponent has >count Benched, is forced (hits all) at
  ≤count, no-op at 0. **The KO reaches flow.ts via a unified `settleProgram`**
  (flow.ts): the two IDENTICAL local settle helpers (triggers.ts `settleTrigger`,
  cardplay.ts `settleRun`) collapse into ONE that, on a completed program,
  returns the controller to turn:action then runs the shared
  **`resolveMidTurnKnockOuts`** (slice-4 machinery) over both boards — so a snipe
  that drops an opponent's Benched Pokémon resolves as a mid-turn KO handing the
  turn back to the actor (the opponent's Pokémon prizes to the actor; a
  game-winning KO ends the game). Behaviour-preserving for every non-damaging
  program (the sweep is a no-op → straight back to turn:action). Meowscarada ex
  "Bouquet Magic" adds the engine's FIRST **ability activation cost**
  (`AbilityProgram.cost = {kind:"discardBasicEnergy", energyType}`): `useAbility`
  gates on the shared **`programPlayable`** (renamed from `trainerPlayable`,
  extended so the snipe needs an opponent Bench — a play that does nothing can't
  be made, so the cost is never spent for no effect) then pays the cost (discard
  a Basic {G} Energy from hand, `ABILITY_COST_PAID`) before running — an
  unpayable cost rejects `ABILITY_COST_UNMET`, and the cost is paid ONCE before
  parking, so a parked snipe resolving via `resolveEffect` never re-charges. New
  error `ABILITY_COST_UNMET`; new event `ABILITY_COST_PAID`. Representatives
  (verified vs the live api): **Hawlucha** (sv01-118, triggered onPlayToBench,
  2×1 counter) and **Meowscarada ex** (sv02-015/256, activated, once/turn, not
  Active-only, 1×3 counters); NOT added to the demo decks (auto-fire/contrived
  preconditions — the slice-4/5/6/7 precedent). **Web:** projection UNCHANGED
  (choosePokemonMulti rides the existing effect:choose; the mid-turn KO park is
  `resumeTurn` = in-turn per koParkActiveSeat since slice 4); GameHud adds one
  **`ChoosePokemonMultiDialog`** (multi-select up to max, Confirm/Take-none →
  `resolveEffect` `{kind:"pokemonMulti", refs}`); Meowscarada's button uses the
  D19 afford-then-reject (no special gate); `logFromEvents` adds one
  `ABILITY_COST_PAID` row (the snipe's damage/KO/trigger rows already existed).
  engineVersion 0.9.0 → **0.10.0** (additive). **Review (2 Opus agents —
  rules+engine / web+integration): BOTH CLEAN, no HIGH/MED correctness bugs.**
  The rules agent CONFIRMED (via probes) the settle unification behaviour-
  preserving (no pre-slice-8 settle program placed damage), the SEATS sweep safe
  (§14 tie guard can't spuriously fire — `effectiveMaxHp` is position-independent),
  the mid-turn KO prize+resume + §14-win correct, the ability cost
  paid-once-across-park, the `programPlayable` gate non-regressive (Chien-Pao's
  search never blocked), the flat-counter rule, wire-safety double-guarded
  (validateChoice AND placeSnipeCounters), the flow↔triggers cycle
  evaluation-safe, and purity. The web agent CONFIRMED the dialog keys/toggle/
  reset, the dialog↔engine lockstep (an enabled Confirm can only produce a legal
  dispatch), the projection + hot-seat viewer-follow through the mid-turn KO, the
  afford-then-reject button, the log rows, and NO demo/`/play` regression. **The
  one shared LOW** — the forced (≤count) branch auto-takes rather than offering
  the "you may" decline (only the parked branch does) — is HARMLESS (pure upside)
  and the documented auto-fire doctrine; made a conscious choice in an
  interpreter.ts comment (a decline confirm rides with the deferred
  downside-trigger confirm). No code fixes needed. **Deferred:** on-KO triggers
  (fire during the OPPONENT's turn mid-KO-sweep — the last M4 tail). **Verification:**
  `bun run check` green (1045 → **1066**: 17 engine `snipe.test.ts` + 2 DOM + 1
  projection + 1 log), production `vite build` green. No live /play smoke (the
  representatives aren't demo-reachable and NO demo deck / projection path
  changed — the demo boot is byte-identical to slice 7's, the slice-6 precedent).
  Files: effects.ts, interpreter.ts, flow.ts, triggers.ts, cardplay.ts,
  registry.ts, actions.ts, events.ts, index.ts, testFixtures.ts, snipe.test.ts
  (new) + GameHud.tsx, logFromEvents.ts/.test.ts, GameHud.cardplay.dom.test.tsx,
  projection.test.ts.
- **2026-07-18** (build #13) — **P3-M4 slice 7: Rare Candy** (§7.1, D28; built
  solo — full context loaded — then a 2-agent Opus review, BOTH CLEAN). Rare
  Candy evolves a Basic straight to a **Stage 2** from hand, skipping the Stage 1
  ("counts as evolving"). Because it evolves — and flow.ts owns every Knock Out
  (the interpreter never KOs) — it is a dedicated **`rareCandy` action**
  (cardplay.ts) `{seat, uid (the Rare Candy Item), target (the Basic),
  evolutionUid (the Stage 2)}`, NOT an interpreter program. The `evolve` tail was
  extracted into a shared **`placeEvolution`** (turn.ts) that both `evolve` and
  `rareCandy` call, so Rare Candy inherits §10 carry-over (damage/energy/tools
  stay, conditions/markers clear, turnPlayed resets), the **on-evolve triggered
  Ability**, and the **evolve-below-HP mid-turn KO** (a Bravery Charm's Basic-only
  +50 falling off) with zero new flow code. Timing mirrors `evolve` exactly (§4
  first-turn ban + `turnPlayed >= turn` → FIRST_TURN_EVOLVE / EVOLVE_TOO_SOON);
  the target must be a Basic (NOT_A_BASIC_POKEMON). **The Basic→Stage 2 link is
  resolved by BRIDGING**: the catalog stores only each card's immediate
  `evolveFrom` (a Stage 2 names its Stage 1, never the Basic), so
  `stage2EvolvesFromBasic` checks the pool for a **Stage 1** named
  `stage2.evolveFrom` whose own `evolveFrom` is the target Basic. **Documented
  gap:** a deck running Rare Candy + a Stage 2 but ZERO copies of the Stage 1
  can't resolve it (ingest-debt, like prizeValueOf=1); the demo Ember deck runs
  Crocalor so it resolves (verified vs the live api: Skeledirge → Crocalor →
  Fuecoco). A registry **marker** `CardProgram.rareCandy?: true` identifies it
  (sv01-191/256); `playTrainer` on a Rare Candy uid rejects
  TRAINER_TYPE_UNSUPPORTED (the Tool-routing precedent). New error code
  RARE_CANDY_NO_STAGE2; no new event (TRAINER_PLAYED then POKEMON_EVOLVED). **Web:**
  an engine helper **`rareCandyOptions(state, seat)`** (the authority) lists the
  legal `{Basic, matching Stage 2s}` pairings; Rare Candy shows in the Trainers
  list but its button opens a bespoke **`RareCandyDialog`** (pick a Basic → pick a
  Stage 2, with Cancel/Back) rather than `playTrainer`. The **projection needs NO
  change** — `placeEvolution` resolves to turn:action (done), a mid-turn KO park
  (resumeTurn, already in-turn) or an on-evolve trigger park (effect:choose,
  origin-agnostic), all already handled. Demo: Rare Candy ×2 in Ember (Fire energy
  14→12; non-Basic for non-Basic keeps the Basic count / mulligan rate).
  engineVersion 0.9.0 (unchanged — additive). **Review (2 Opus agents —
  rules+engine / web+integration): BOTH CLEAN, no correctness bugs.** The rules
  agent PROVED the `placeEvolution` refactor byte-for-byte equivalent to the old
  `evolve` (state shape, event order, hand-removal timing, the from/target split),
  the bridge sound (the intermediate is forced to be a Stage 1 — no realistic
  false positive), wire-safety airtight, purity. The web agent confirmed the
  projection "no change" across all three outcomes, the dialog↔options lockstep
  (an enabled button can only ever produce a legal dispatch or a clean reject),
  the demo deck (exactly 60, disjoint-except-shared-trainers intact, bridge
  present), and the log rows. **Fixes applied** from the LOW findings: a **Cancel**
  button on the dialog (Rare Candy is optional), `rareCandyOptions` made **lazy**
  in playableTrainers (its cardPool scan only runs when a Rare Candy is in hand),
  and 3 coverage tests (benched mid-turn KO, Tool carry-over, an Energy as the
  evolution card). Documented (not defects): the bridge gap + the un-exercised
  sv01-256 reprint. **Deferred:** the mid-turn-damage snipe (Hawlucha/Meowscarada)
  + on-KO triggers remain the P3-M4 tail. **Verification:** `bun run check` green
  (1019 → **1045**: 24 rareCandy.test.ts + 2 DOM), production `vite build` green.
  **Live /play boot smoke** (agent-browser, seed 6, ZERO console errors): boots
  with the re-balanced Ember deck — Pixi canvas renders, all 75 cardPool fetches
  200 (incl. sv01-191 Rare Candy), the coin toss advances into a clean 7-card deal
  (no mulligan storm). Files: actions.ts, registry.ts, turn.ts (placeEvolution),
  cardplay.ts (rareCandy + bridge + rareCandyOptions), index.ts, testFixtures.ts,
  rareCandy.test.ts (new) + GameHud.tsx, demoDecks.ts/.test.ts,
  GameHud.cardplay.dom.test.tsx.
- **2026-07-18** (build #12) — **P3-M4 slice 6: triggered Abilities** (§9, D27;
  built solo — full context loaded — then a 2-agent Opus review that the shared
  usage limit CUT SHORT). §9 Abilities that FIRE on a game event get a
  **`TriggeredAbility`** entry (`CardProgram.triggered`: `{name, trigger, program,
  optional?, activeOnly?}`) run through the shared interpreter by a new
  **`triggers.ts`**, wired at THREE scan points: **`onPlayToBench`** (turn.ts
  playBasicToBench — a turn play, not a setup placement), **`onEvolve`** (turn.ts
  evolve, after the evolve-below-HP KO check), **`betweenTurns`** (flow.ts
  runCheckup, after the §13 ticks, before the KO sweep). **Board triggers PARK on
  the existing `effect:choose`** (settleTrigger ≡ cardplay settleRun) and resume
  to turn:action via `resolveEffect` — so a Flamigo benched by a DRAG parks
  identically to a Trainer button and the **web needs no new dialog**
  (EffectChooseDialog is now origin-agnostic; only 2 logFromEvents rows added).
  **`betweenTurns` triggers are NON-PARKING** (heal-each / a fixed counter) and
  run synchronously in the one Checkup reduction; Trevenant's counter that goes
  lethal is KO'd by the shared `collectKnockOuts` sweep (a double KO rides its
  §14 tie guard). **Optional triggers AUTO-FIRE** (pure-upside set; "up to"
  searches still take none). New ops: **`healEach`**, **`damageActive`** (PUTS
  counters — NOT attack damage, so no W/R AND **no Bouffer-style reduction**);
  `healChosen.amount` → `number|"all"`; a `byName` search filter. New event
  `ABILITY_TRIGGERED`; `COUNTERS_PLACED` source `"ability"`. Representative set
  (real, verified vs local D1): Flamigo (sv02-170 Insta-Flock, onPlayToBench),
  Arboliva (sv01-023 Enriching Oil, onEvolve), Garganacl (sv02-123 Blessed Salt,
  betweenTurns), Trevenant (sv03-012 Forest Miasma, betweenTurns Active-only) —
  NOT in the demo decks (auto-fire would perturb the seed-tuned hands;
  test-covered, slice-4/5 precedent). engineVersion 0.8.0 → 0.9.0. **Review (2
  Opus agents — rules+flow / wire+web) CUT SHORT by the shared usage limit
  (reset pending):** partial. Before dying the rules agent CONFIRMED 1 bug —
  `damageActive` applied the defender's `damageReductionAfterWR`, so Trevenant's
  counter on a Bouffalant (Bouffer −20) placed 0 → **fixed** (a PUT counter is
  not attack damage, so it lands flat — the poison/burn-tick rule) +
  regression-pinned (sv03-174 in TRIGGER_DECK). Remaining areas SELF-verified:
  the turn-gate makes settleTrigger's done→turn:action always correct; the §14
  double-KO path is the unchanged shared sweep; the web viewer-follow +
  origin-agnostic dialog (read useLocalGame/GameHud). **A `/code-review` re-run
  after the limit resets is the logged follow-up.** **Deferred:** on-KO triggers
  (fire during the OPPONENT's turn mid-KO-sweep), parking mid-Checkup, the
  multi-target snipe (Hawlucha/Meowscarada) + `settleRun`→`resolveMidTurnKnockOuts`.
  **Verification:** `bun run check` green (1002 → **1019**: triggered.test.ts 16
  + 1 log row). No live /play smoke (representatives not demo-reachable; the
  review's browser pass was cut). Files: effects.ts, events.ts, registry.ts,
  interpreter.ts, triggers.ts (new), turn.ts, flow.ts, index.ts, testFixtures.ts,
  triggered.test.ts (new) + logFromEvents.ts/.test.ts, GameHud.tsx (comment).
- **2026-07-18** (build #11) — **P3-M4 slice 5: Special Energy** (D26; built solo
  — full context loaded — then a 2-agent Opus review). Special energies
  provisioned a name-derived 1 Colorless; slice 5 models their rules text as
  data. **`EnergyProgram`** (`CardProgram.energy`: `{provides,
  demoteWithOtherSpecial?, onAttach?}`); **`providedEnergy(state, pokemon)`**
  (continuous.ts) is the ONE provision read site — basic → its type, authored
  special → its units (a concrete type, the `ANY_ENERGY` **wildcard**, or
  several; Luminous demotes to {C} with another special attached), unauthored
  special → the Colorless fallback. **`costMet`** (attack.ts) upgraded for the
  wildcard (allocate to typed needs first, then Colorless — brute-force-verified
  optimal). BOTH the engine cost check AND the HUD payability now call
  `providedEnergy` → **the D18 duplicated payability is gone**. **Jet Energy's
  on-attach switch** (attachEnergy → the newly-exported `switchInto`) moves a
  benched holder to Active. Representative: Jet (sv02-190) + Luminous (sv02-191);
  no Double Turbo in the SV catalog, so multi-provide here is the wildcard kind
  (the `provides` array + matcher still support a future multi-unit energy).
  Demo decks: Ember Jet, Tidal Luminous (different per deck). engineVersion 0.7.0
  → 0.8.0. **Review:** rules+matcher agent CLEAN — brute-forced the matcher
  (13,640 cases, 0 mismatches) and confirmed provision / the Luminous demote /
  the Jet switch; wire+web agent found **1 MEDIUM** — Jet's switch compacts the
  bench, so the ENERGY_ATTACHED **log** (host resolved by index) named the wrong
  Pokémon → **fixed** (resolve by uid) + regression-pinned — plus a LOW
  stale-JSDoc + a stale comment, both fixed. **Verification:** `bun run check`
  green (983 → **1002**: 16 specialEnergy.test.ts + 2 HUD-DOM payability + a log
  host regression). **Live /play smoke** (seed 6, ZERO console errors): boots
  with the re-ingested decks, both special energies fetch 200; the attach
  gestures are the Pixi session-eater so covered by the engine + HUD-DOM + log
  tests + the reviews. Files: cards.ts, registry.ts, continuous.ts, attack.ts,
  turn.ts, interpreter.ts, index.ts, testFixtures.ts, specialEnergy.test.ts +
  GameHud.tsx, logFromEvents.ts/.test.ts, GameHud.cardplay.dom.test.tsx,
  demoDecks.ts/.test.ts.
- **2026-07-18** (build #10) — **P3-M4 slice 4: the Knock Out generalized off
  the Active** (D25; built solo — full context loaded — then a 2-agent Opus
  review, both CLEAN). Two reaches the Active-only + turn-ending KO flow could
  not: **bench spread/snipe damage** and a **mid-turn KO that resumes the
  actor's turn**. `knockOut` KOs any in-play Pokémon by uid (bench KO → discard
  stack, compact bench, prize but no promotion); **`collectKnockOuts`** is the
  ONE post-damage board sweep (prizes-first, §14 tie guard when both seats lost
  a Pokémon) shared by `finishAttack` / `runCheckup` / the mid-turn path — §14
  stays single-sourced. A new **`resumeTurn` PendingStage** + `resolveMidTurnKnockOuts`
  resolve a KO mid-turn then hand the turn back to the actor. **`evolve`** now
  runs the KO check → **closes D24's evolve-below-HP gap** (the pinned
  characterization test flipped to assert the KO). A **`spreadDamage`** op
  (interpreter, derived from a 6th anchored sentence) does flat damage to each
  opponent Benched Pokémon — a benched reduction passive/Tool still applies
  (Bouffer −20), the attacker's Active-only bonus does not — and the interpreter
  only PLACES it, leaving every KO to flow.ts. Web: the sole source change is
  `projection.ts koParkActiveSeat` treating `resumeTurn` as in-turn (the log/HUD
  need nothing — a benched uid resolves the same, the opponent's mid-turn prize
  pick rides the existing `waitingOn` flip). engineVersion 0.6.0 → 0.7.0.
  **Review:** rules+flow agent PROVED the tie guard necessary + sufficient and
  found no defects across 7 risk areas; wire+web agent found none either. 2
  informational notes only (a future Active-only reduction passive; a deliberate
  dead defensive branch). **Verification:** `bun run check` green (974 → **983**;
  8 new `knockout.test.ts` + a mid-turn-park projection test + the flipped
  characterization test). **Live /play smoke** (agent-browser, seed 6, ZERO
  console errors): boots with the re-ingested sv01–03 demo decks — canvas
  renders, all cardPool fetches succeed, the coin-toss action drives
  engine→projection→HUD clean; the new mechanics aren't demo-reachable (no spread
  card; the evolve-below-HP window needs a contrived board) so are covered by the
  engine + web tests + the clean reviews (slice-2 precedent). Files: flow.ts
  (knockOut/collectKnockOuts/resolveMidTurnKnockOuts/resumeTurn), types.ts,
  attack.ts, turn.ts, effects.ts, interpreter.ts, registry.ts, testFixtures.ts,
  knockout.test.ts, stadiumTool.test.ts + projection.ts/.test.ts.
- **2026-07-18** (build #9) — **P3-M4 slice 3: persistent zones — the shared
  Stadium (§7.3) + Pokémon Tools (§7.4) via a continuous-modifier pipeline**
  (built solo — full context loaded — then a 2-agent Opus review; the first
  three Fable 5 review agents died on the usage limit mid-flight and were
  re-spawned on Opus 4.8 after a `/model` switch, so the review is Opus's).
  **Shape (D24):** persistent-zone Trainers are NOT interpreter programs —
  their effects are CONTINUOUS, so a new `packages/engine/src/continuous.ts` is
  the ONE place a rule read consults them: `effectiveRetreatCost` (retreat),
  `effectiveAttackCost` (§8.2), `effectiveMaxHp` (the KO test `isLethallyDamaged`
  in flow.ts + the web `battle.hp`), `passivesOf` (§8.5 — a defender's post-W/R
  reduction now aggregates a printed passive WITH attached Tools; an attacker's
  pre-W/R bonus). It unifies D23's passive hook (Tools + printed passives feed
  one read site). **Stadium** = a single shared `GameState.stadium` {uid, owner}
  played via `playStadium` (one/turn via `TurnAllowances.stadiumPlayed`;
  replace-on-play discards the predecessor to its OWNER's pile; the same-NAME
  ban compares names so the sv02-171/sv03-229 "Artazon" reprints can't
  self-replace; allowed on turn 1). **Tool** = a new `attachTool` action (Tools
  carry a target, so NOT playTrainer): one/Pokémon, uncapped, no allowance, no
  detach — it rides the stack through evolution/switch and discards with a KO
  (the `InPlayPokemon.tools` slot M1 reserved is finally populated). Unauthored
  Stadium/Tool → loud `TRAINER_NOT_SIMULATED`. 4 new error codes, `DAMAGE_DEALT`
  gained `bonus`, new events TOOL_ATTACHED / STADIUM_DISCARDED. **Web:**
  Stadiums are BOTH a HUD button AND a drag onto the shared slot
  (`moveToAction`/`gamePlacementPredicate` gained the one non-own drop target,
  `owner:"global" zone:"stadium"`); Tools attach by drag onto an own Pokémon
  (the energy-attach gesture); the projection renders the shared Stadium public,
  `battle.hp` reads the continuous max HP, HUD retreat/attack costs read the
  effective ones; new log rows + a pre-W/R `· boosted` breadcrumb. Representative
  set (verified vs local D1): Beach Court (sv01-167) / Pokémon League HQ
  (sv03-192) / Vitality Band (sv01-197) / Bravery Charm (sv02-173), DIFFERENT per
  demo deck so the replace path is reachable live. engineVersion 0.5.0 → 0.6.0.
  **Review (2 Opus agents — rules+integration / wire-safety+web-lockstep):**
  wire-safety PROVEN clean (33 hostile `attachTool`/`playStadium` inputs — zero
  throws, zero mutation; every event payload a copy; continuous.ts total on real
  states); lockstep + HUD gating + demo-deck counts confirmed. Two findings: (a)
  the `· boosted` log breadcrumb printed AFTER weakness though it applies BEFORE
  — reordered to §8.5 pipeline order; (b) **the deferred evolve-below-HP KO gap**
  — Bravery Charm is the one effect that can LOWER effective max HP on evolution,
  so a damaged charmed Basic evolving below the new stage's HP should KO the
  instant it evolves (§8.1), but `evolve` runs no KO check and the engine's KO
  flow is Active-only + turn-ending. An Active in that state is cleaned up at the
  next Checkup; a benched one is NOT. A mid-turn KO that RESUMES the actor's turn
  is new flow machinery, so it is DEFERRED with the bench-KO generalization —
  documented at turn.ts/registry.ts/simulator.md and PINNED by a characterization
  test so a future fix flips it deliberately, not silently. **Verification:**
  `bun run check` green (948 → **974 tests** — 18 new engine cardplay covering
  Stadium replace/same-name/one-per-turn + the four continuous effects + Tool
  attach/carry-over/KO-discard/wire-safety/purity, plus new projection/log/
  placement-lockstep/HUD-DOM tests). **Live /play smoke (agent-browser, seed
  frozen to 6, ZERO console errors):** DROVE both new gestures to resolution —
  Beach Court DRAGGED onto the shared stadium slot ("Stadium: Beach Court",
  persisted through two turns + hot-seat flips) which dropped Growlithe's retreat
  button from "Retreat (2)" to "Retreat (1)" LIVE (the continuous discount in the
  HUD), then Vitality Band DRAGGED onto Growlithe ("Growlithe (1 tool)", log row
  "attached Vitality Band → Growlithe"). The shared zone, Tool attachment,
  projection and continuous retreat read all confirmed end-to-end on the real
  Pixi board. Local D1 already held sv01+sv02+sv03 (no re-ingest this session).
- **2026-07-18** (build #8) — **P3-M4 slice 2: Trainers + Abilities + the
  effect-op interpreter/registry** (built solo — full context loaded — then a
  high-effort 8-angle review; no correctness bugs, 2 findings fixed). The real
  first appearance of D8's op-program system (D20's deriver was the sliver).
  **Engine:** M3's attack-private `runEffectSteps` replaced by ONE shared
  resumable interpreter (`interpreter.ts`, `runProgram → done|parked`);
  `EffectStep`→`EffectOp` grew the board/deck ops (draw/discardHand/shuffle/
  searchDeck→bench|hand/switchActive/gust/healChosen). The id-keyed **registry**
  (`registry.ts`) sits above the deriver (`programFor(id)?.attack ??
  derive(text)`) and is the sole Trainer/Ability source. Mid-effect decisions
  PARK via a new **`effect:choose` Phase** with a JSON continuation
  (`{pendingOp, rest, ctx}`) — replayable, outside the KO/win tail (no in-scope
  effect KOs). New actions **playTrainer** (Item §7.1 / Supporter §7.2 + §4
  first-turn ban; card discards up front; `trainerPlayable` rejects
  no-legal-target gust/switch before committing), **useAbility** (activated;
  §9 Active-only + once-per-turn per-Pokémon flag in
  `TurnAllowances.abilitiesUsed`), **resolveEffect** (wire-checks every choice —
  D14 never-throw extended to the effect layer). **Passive** abilities are a
  pipeline hook, not the interpreter (Bouffalant "Bouffer" −20 after W/R →
  `DAMAGE_DEALT.reduction`). 10 new error codes, 6 new events (+"effect"
  DrawReason). **Web:** Trainers/Abilities are HUD buttons (the drag layer
  no-ops on `effect:choose`), `effect:choose` → chooseCards/choosePokemon
  dialog → resolveEffect; §4/§7.2/§9 gating mirrored, engine owns fine legality
  (D19 pill); projection maps the new phase (exhaustive switch caught it at
  compile time); `logFromEvents` rows for all six events; `presentStatuses`
  lifted to types.ts (shared retreat/evolve/switch). **Representative set**
  (real ids, live-verified): Professor's Research/Nest Ball/Boss's Orders/Switch/
  Potion/Energy Search + Chien-Pao ex (*Shivery Chill*) + Bouffalant
  (*Bouffer*); both demo decks share the Trainers, Tidal runs Chien-Pao, Ember
  Bouffalant. Broad coverage = a later opt-in Workflow (user's call). **Review
  fixes:** `searchMove` now clamps to bench space BEFORE removing from the deck
  (removal set = placement set — the M1 card-safety lesson; was guarded but
  fragile), and `presentStatuses` dedup. Deferred: the `effect:choose` search
  candidates leak deck uids in the projection (P4 hidden-info, unobservable in
  hot-seat). **Verification:** `bun run check` green (914 → **948 tests**: 28
  engine cardplay incl. parking/forced-resolve/wire-safety/purity, 5 DOM
  integration tests driving the real GameHud→engine→dialog→resolveEffect flow).
  **Live /play smoke (agent-browser):** boots clean with the new decks — full
  60-card cardPool (all Trainers + Chien-Pao + Bouffalant) fetched from the live
  api, canvas renders, ZERO console errors across setup + two turns; setup drags
  work; the **TurnPanel renders the Trainer buttons live with correct §4/§7.2
  gating** (Boss's Orders disabled turn 1, enabled p1 turn 2; Switch enabled).
  All 8 new ids resolve via `GET /cards/:id` with the exact fields the engine
  reads. NOT driven to a fully resolved effect in-browser — the dealt hands
  lacked gust/search preconditions and the Pixi bench-drag coordinate hit-test
  is the documented session-eater; the resolution path is exhaustively
  unit/DOM-tested. Local D1 already held sv01+sv02+sv03 (no re-ingest needed
  this session). engineVersion 0.5.0.
- **2026-07-17** (build #7) — **P3-M4 slice 1: evolution** (built solo — full
  context loaded — then an 8-angle high-effort review; no correctness bugs
  found). Engine: the `evolve` action (turn.ts) uses the `stack`/`turnPlayed`/
  `tools` fields M1 reserved for exactly this. It places an Evolution card
  (`evolveFromOf(card) !== null`) on the stack top of an own in-play Pokémon
  whose top card NAME equals the card's `evolveFrom` (§10), carrying
  damage/energy/tools and clearing Special Conditions + markers
  (`POKEMON_EVOLVED` + a `STATUS_CLEARED` reason:"evolved" on the new top). The
  timing is deliberately **two** checks (D22): `turnPlayed >= state.turn`
  (came into play this turn / already evolved this turn) PLUS the §4/§10
  first-turn ban (`state.turn === (seat === firstPlayer ? 1 : 2)`) — turnPlayed
  can't make the second because setup Pokémon carry 0. No KO check (evolving
  never KOs). Every wire value runtime-checked (BAD_TARGET / BAD_BENCH_INDEX /
  the string-index trap), purity-tested. 18 engine tests (happy active+bench,
  Stage 2 chain, mismatch, not-an-evolution, both too-soon cases, both
  first-turn bans, carry-over, allowances, wire-safety). **Web:** no projection
  change (it already reads the stack top, so the evolved card + carried damage
  render for free); `moveToAction`/`gamePlacementPredicate` route a Pokémon
  dropped ONTO an own occupant to `evolve` (Active or occupied bench index),
  keeping a free-bench drop as `playBasicToBench` — the SAME indexed-vs-frame
  disambiguation energy-attach uses (confirmed by reading the drop layer's
  `parsePlacement`: occupied slots carry `data-card-index`, the frame carries
  none). Lockstep property extended over a real turn-3 evolvable board (a live
  evolve applies OK end-to-end). `logFromEvents` rows for both events. Demo
  decks gained real lines (Ember Fuecoco→Crocalor→Skeledirge, Tidal
  Buizel→Floatzel) so /play can evolve. **Review (8 angles, high effort):** no
  correctness bugs; 3 reported items — (a) a Basic dropped on an OCCUPIED bench
  slot now routes to evolve→NOT_AN_EVOLUTION rather than benching, CONFIRMED a
  non-regression by reading `parsePlacement` (the bench frame is a separate
  index-less container, so "add to bench" still works); (b) the evolve
  projection-identity pop (CardModel id changes basic-uid→evolution-uid → Pixi
  remounts, not a morph) — animation follow-up, damage/conditions correct; (c)
  no demo evolution line — now added. Suite 892 → **914**; `bun run check`
  green (tsc + biome + vitest). **Session trap:** the `@luminous/engine`
  workspace symlink was MISSING from node_modules (only schema linked) —
  `bun install` restored it (cascade TS2307 across the web app until then).
  And local D1 (apps/api) had drifted to sve/sv06.5/swsh10.5 ONLY (the
  documented trap struck again) — the demo decks' sv01/sv02/sv03 ids 404 until
  a re-ingest, which this session ran. **Browser e2e PASSED (evolve driven
  live):** with Date.now frozen to a seed found offline (p1 opens with a
  Fuecoco + a Crocalor by turn 3), drags were synthesized as real PointerEvents
  against the DOM `[data-card-anchor]`/`[data-card-drop-zone]` elements (the
  Pixi visuals track them; hit-test is by coordinate) — placed both Actives,
  passed to turn 3, dropped Crocalor on Fuecoco → "evolved Fuecoco → Crocalor"
  in the log, the Active re-rendered as Crocalor (HUD shows its HP + attacks),
  clean console. Traps for the next drive: /play's Pass/attach controls are
  aria-label-only buttons (empty textContent — click by `aria-label`, not
  text), and the seed is `Date.now()` (freeze it in-page for a reproducible
  hand). The synthetic-PointerEvent drag recipe (down/move on the playmat root,
  up on window) is the reliable way to drive the Pixi board.
- **2026-07-17** (build #6) — **P3-M3: special conditions + Pokémon Checkup +
  the text-derived effect deriver** (two sequential build agents — engine,
  then web against the as-built event contract — then an 8-finder/7-verifier
  review, three parallel fix agents, and a browser e2e). Engine: the
  M1-reserved `SpecialConditions` slot is live (Active-only); checkup runs
  inside `advance` (NO new phases) in §13 order with rng-threaded flips; KOs
  resolve after the batch via the lifted shared `knockOut` (+
  `isLethallyDamaged`, `activeTop`), parking on the existing ko:* interrupts;
  double-KO ties via speculative evaluateWin (§14 single-sourced); asleep/
  paralyzed gate attack+retreat (engine-exported `isImmobilized`), confusion
  flips with self-KO through the shared `finishAttack` epilogue; benching
  cures. **D20**: `deriveAttackEffect` — five anchored catalog sentences →
  EffectStep programs (applyStatus/heal/coinFlipGate) executed post-damage;
  everything else keeps ATTACK_EFFECT_SKIPPED. 8 new events. Web (**D21**):
  CardModel.battle co-location (5-hop statuses side-table DELETED), status
  chips opposite the damage chip, HUD reason lines, log rows for all events,
  demo decks swapped (Numel sv03-031 ×3, Luvdisc sv02-047 ×3 — for Growlithe
  031 / Cetoddle 058 copies). **Review headliners (10 reported, all fixed):**
  the rules doc ITSELF was wrong on paralysis timing — official wording
  clears only "Paralyzed since the beginning of your last turn", so
  self-paralysis must survive its own checkup; deriver now refuses
  self-Paralyzed + §12/§13.4 corrected at the source (the D15 pattern,
  found by a verifier reading the actual rulebook PDFs). Also: the skip-event
  log said "effect not simulated" for a case where it executed (renderer now
  keys on `effect !== null`); stale activePlayer during between-turns KO
  parks (pending-queue discriminator → activeSeat null); cloneCard aliased
  `battle` + sandbox drags kept chips on the bench (cure-on-bench in the
  mock path too); double-KO prompt order (prizes now before promotes); §14
  tie-guard duplication (speculative-apply); immobilization/lethality
  predicates deduped (3 copies each); the Yawn fixture rewrite had deleted
  the only pure-text skip-payload test (restored via "Lullaby"). REFUTED
  with proof: knockOut's null-guard (correct under never-throw), the
  double-spread "efficiency" claim (wrong arithmetic), interpreter-seam
  extraction (premature — M4 restructures it anyway). **E2e browser PASS,
  zero app bugs:** both status flavors applied with chips + verbatim log
  rows, full burn lifecycle (2 ticks, tails then heads cure, chip removed),
  asleep lock (buttons disabled + reason line) through 3 tails flips to
  wake-up, two KO→prize→promote flows, chips hit-tested above the Pixi
  canvas on the live board, clean console. Suite 825 → **892**; `bun run
  check` green. **Session traps:** the usage limit killed the web build
  agent and 3 of 7 verifiers mid-flight — all resumed via SendMessage with
  zero rework (6th session the pattern holds); /play promote+retreat are
  DIALOGS not drags (drag reports done, no-ops), chips are
  pointer-events:none (hit-tests skip them) → both in the verify skill.
- **2026-07-17** (build #5) — **P3 wire-up: the playable local hot-seat game
  page** (two parallel build agents, then a browser e2e, then an 8-finder /
  6-grouped-verifier review whose 10 reported findings were ALL fixed by four
  parallel fix agents). (A) `getCard` re-added + `fetchCardPool` (D18:
  `/cards/:id` fan-out — CardBrief lacks combat blobs; no api change so no
  gated deploy). (B) `Playmat` → presentational `PlaymatView` (+ mock
  wrapper at /simulator "Sandbox"); `/play` = pregame → `useLocalGame`
  (pure reducer over `applyAction`, viewer follows `waitingOn`) →
  phase-switch `GameHud` → `moveToAction` drag translation → `logFromEvents`;
  demo decks (sv01 Fire vs Water, live-verified ids); damage chips + pile
  counts threaded from the projection. **Browser e2e: a full game played to
  the win overlay** (setup drags, hot-seat flips, payability gating,
  weakness ×2, KO → prize dialog → forced auto-promote, no-Pokémon win).
  **React bug of the session** (found live, root-caused in jsdom): TurnPanel
  and PrizeDialog shared `key={seatKey}` as fragment siblings — on key
  change React's `mapRemainingChildren` dedupes by key, so the shadowed old
  fiber is never deleted: mounted-but-orphaned panels with stale content and
  LIVE buttons dispatching real actions, zero console errors. Fixed with
  panel-prefixed keys, then made structurally impossible by the phase-switch
  composition; regression in `LocalMatch.dom.test.tsx`. **Review headliners
  (all verifier-confirmed, all fixed):** damage chips painted BELOW the Pixi
  canvas (`backdrop-blur` in FRAME_CLASS made every frame a stacking
  context trapping z-61 under the z-60 canvas — blur moved to a `before:`
  overlay; verified live via computed-style stacking walk); hot-seat setup
  flip leaked the first player's face-down placements (redaction moved INTO
  the projection, D17 rev — it's the same filter P4 will apply); rejection
  pill survived the viewer flip (ok-actions now clear `lastError`);
  phase-unaware `canPlace` afforded engine-impossible gestures → the
  placement-predicate seam (D19, property-tested lockstep with
  moveToAction); disabled pass-button styling was Tailwind
  emission-order-dependent (probed with getClassOrder — two of three
  conflicts resolved wrongly; now `disabled:` variants); stale saved-deck
  slot after session expiry; `waitingSeatOf` deduped into the projection's
  `phaseViewOf`; card-pool cache (rejects self-evict, 404s stable);
  live-region pile chips silenced + deck/discard counts added to
  BoardSummary; shared `TransientErrorPill` (+XIcon) for /play + /decks;
  GameHud → exhaustive phase switch, dialogs mount==open, one retreat
  derivation, shared `energyPalette`. One finding REFUTED: moveToAction's
  "unreachable" owner guard is reachable via Stadium drops — guards kept.
  Deferred (verified, in "/play follow-ups"): HUD-reads-raw-GameState (P4),
  pile zones in the animation layer, CardModel.battle, O(n²) log remap,
  overlay re-render memoization, useDeckLibrary, fetch pipelining. Suite
  751 → 825; `bun run check` green. **Session traps:** the usage limit
  killed agents TWICE (all 8 review finders, later all 4 fix agents) — all
  12 resumed via SendMessage with zero rework (4th/5th time the pattern
  holds); agent-browser clicks silently no-op'd after a page reload (eval
  IIFE clicks are the fallback; one `drag` hung 120 s) → recipes written
  into the verify skill; **local D1 had silently LOST sv01/swsh10.5** (only
  sve+sv06.5 remained — `.wrangler` state wipe; the verify skill's set list
  was stale) → re-ingested sv01+sv02+sv03 (767 cards, ~90 s) for the demo
  decks, and the skill now says to check `d1 execute` instead of trusting
  the doc; the "consumption sketch in the projection module" that D17/
  progress cited never existed — citations fixed (guidance = inline
  comments). — **P3-M2 (attacks/KO/prizes/win, D16) + the
  engine→playmat projection (D17)**, two parallel build agents then an xhigh
  review (10 finder angles → 9 grouped verifiers → gap sweep; 15 findings
  reported, every confirmed one fixed in-session by two fix agents).
  (A) Engine M2: staged turn tail (`pending` queue + `advance()` in new
  `flow.ts`; `ko:takePrizes`/`ko:promote` park phases, forced picks
  auto-resolve), attack flow (typed costs w/ Colorless wildcards, §4
  first-turn ban, §8.5 weakness→resistance order), KO cleanup via shared
  `discardFromStack`, prize/promotion choice actions, `evaluateWin` →
  `GameOutcome` win/tie. (B) Projection: per-viewer `GameProjection`
  (drop-in playmat `BoardState` + piles/pokemon/waitingOn/pendingDecision/
  outcome), structural hidden-info redaction, uid-keyed animation identity.
  **Review headliners** (the xhigh pass paid a second time): two
  never-throw violations in M1 code the M1 review missed (`attachEnergy`
  `target:null` and retreat `discardEnergy:{length:1}` both THREW out of
  `applyAction` — probe-proven); `energyProvidesOf` misparsing the
  catalog's own "Basic Darkness/Metal Energy" prints → typed attacks
  permanently unpayable; schema-documented `"+20"` additive weakness
  silently applied as ×2 (→ `DamageModifier` model); `hp:0` rows
  instant-KOing undamaged Pokémon; the projection guessing the wrong
  actor during `ko:promote` + surfacing no pending decision/outcome/damage
  (→ the `activePlayer`/`waitingOn` split). Also: `BASIC_ENERGY_TYPES`
  hoisted to `@luminous/schema` (Fairy added; builder derives its palette),
  win-check consolidated into shared resolve-and-resume helpers,
  `turnTail()` extracted, `PHASE_DESYNC` cross-check hardening. Deferred
  (traps list): stable opaque ids for opponent-hand backs (P4 design),
  image-null → card-back mapping (wire-up slice), ingest columns for ex
  suffix / energy provision / weakness normalization. Suite 683 → 751;
  `bun run check` green. **Session traps:** the usage limit killed 7/10
  finders and the engine fixer mid-flight — ALL resumed via SendMessage
  with zero rework (third session this pattern holds). **The api deploy
  permission gate fired for the THIRD session** — the auto classifier
  rejects `db:migrate:remote` unless the user names the deploy explicitly;
  it genuinely needs the user. **Deploy resolution (same session, after the
  user ran the command):** migration 0003 was ALREADY applied remotely (the
  gate had only ever blocked the Worker upload); `bun run deploy` shipped
  Worker `9b1ec1d1`. Read-only prod smoke green (/health, /cards, /decks →
  401); the WRITE smoke was gate-blocked until the user explicitly asked,
  then passed in full: creates carry `position` (min−1 prepend), foreign-id
  reorder → `400 {"error":"unknown deck id(s)","ids":[…]}`, legit reorder →
  204, persisted, `updated` not bumped (D13 verified in prod). Throwaway
  decks deleted; smoke account remains.
- **2026-07-14** (build #3) — **P3 milestone 1: the engine core** (one build
  sub-agent + a 10-angle review). `packages/engine` is now a real engine
  (D14): pure JSON `GameState` with the mulberry32 `rngState` inside it,
  `applyAction → {ok, state, events} | {ok:false, error}` that never throws
  and never mutates, uid card instances over an injected `cardPool`, seats as
  labels (coin winner *chooses* first), choices-are-actions with mandatory
  steps auto-resolving, and semantic events as the animation/wire contract.
  Surface: setup (shuffle, flip, hands, mulligans, compensation, placements,
  prizes), turn loop + mandatory draw + deck-out loss, 1 energy/turn, Basics
  to bench (cap 5), retreat (named energy pays the exact cost), pass.
  Then an **xhigh review (10 finder angles)** — worth the cost, it found real
  bugs the suite was green over:
  (a) **wire-decoded string indices destroyed cards** — `bench["1"]` resolves
  (string key!) so the guard passed, but `i === index` never matched: the
  energy left the hand and attached to *nothing*; retreat's
  `slice(index + 1)` string-concatenated to `slice("11")` and **deleted every
  benched Pokémon** past the promoted slot. (b) an unvalidated `first` seat
  landed in `firstPlayer` and threw inside `startTurn` *several actions
  later*. (c) `applyAction` returned **undefined** for an unknown action type
  — the never-throw contract P4 rests on didn't hold at the wire. Lesson,
  now written into `simulator.md`: **TS types are not input validation.**
  (d) **the mulligan-compensation RULE was wrong** — it paid only a player who
  hadn't mulliganed. Each player draws 1 per *opponent* mulligan and
  mulliganing yourself forfeits nothing, so **both** seats can be owed. The
  error came from `reference/ptcg-rules.md` §3.5 itself ("the non-mulliganing
  player") — **the reference doc was fixed at the source** (D15) and the draw
  is now clamped so nobody can draw below their 6 prizes. (e) event payloads
  **aliased state arrays** (PRIZES_SET *was* the state's prize array) and the
  caller's action arrays; (f) `setupDrawExtra` advanced the phase emitting
  **zero events** (an event-only P4 client would hang on the prompt forever);
  (g) `shuffle` silently skipped swaps, biasing the permutation. All fixed +
  regression-tested. Also folded in: the 4×-duplicated turn gate → one shared
  `turnGate`, create/action errors → one `ErrorCode` union, poison modeled as
  a counter amount (§12) not a bool, `RETREATED` now carries the bench
  re-index (`promotedFrom`/`benchedTo`) so animators don't re-derive it.
  Suite 623 → 683; `bun run check` green; committed `d34146c`.
  **Session traps:** the Fable 5 usage limit killed the build agent mid-flight
  and later 4 of 10 review finders — all resumed from transcript via
  SendMessage with zero rework (same recovery as the 2026-07-14 build #1
  session; this is now a reliable pattern). **The api deploy was blocked by
  the permission gate for the SECOND session running** — it needs the user.
- **2026-07-14** (build #2) — **P2-M1 e2e pass + task 17** (single-agent).
  (A) FilterRail browser-driven end-to-end (agent-browser vs wrangler dev +
  vite): facets-fed vocabularies, server kinds (`stage=Stage2`), the EX/Mega
  mixed-kind client remainder (wire drops the kind dim; "60 of 79 loaded"
  caption; Load more → page 2), text search (`poison` → 8 right cards;
  numbers aren't searched — damage lives outside the text fields), HP bounds
  (+ inverted range → clean empty state), set + serie filters, **real**
  serie→set narrowing (ingested swsh10.5 locally to get a 2nd serie),
  legalOnly toggle, sort=hp-desc, DeckStats, the Radiant add-time guard
  (deckWideRemaining blocks a 2nd Radiant), and structured legality
  ("Radiant Blastoise is not legal in Standard"). **Verdict: PASS, zero app
  bugs.** The "Load more is dead" scare was agent-browser: clicks DON'T
  auto-scroll inner overflow containers (silent no-op), `fill ""` doesn't
  clear — both now in the recreated `.claude/skills/verify/SKILL.md` (the M9
  recipe was lost with a worktree). Real findings: cel25 ingest aborts
  (cel25-17 ability lacks `name` upstream; all-or-nothing by design → logged
  as follow-up); post-ingest /facets|/sets|/series stay KV-stale ≤1h (flush
  recipe in the skill). (B) **Task 17**: `position` INTEGER on decks+folders
  (D13 — global per-user slots; creates take min−1; nest moves keep the
  slot), migration 0003 with name-order backfill, `GET` lists order by it,
  bulk atomic `POST /decks/reorder` + `/folders/reorder` (≤500 absolute
  assignments, foreign id → 400 naming it, `updated` NOT bumped),
  `unknownCardIds`→`unknownIds`, api client `reorderDecks/Folders`, web
  `applyReorder` now returns `{items, changes}` (slot-permutation keeps the
  array position-sorted) and `Decks.tsx` persists via `persistReorder`
  (failure → pill + resync, the folder-delete precedent). E2e-verified:
  keyboard move → 204 → order survives reload (decks AND folders); probe
  400 correct. Suite 607→623; `bun run check` green. **Api deploy pending**
  — `db:migrate:remote` hit the session permission gate; deploy + smoke is
  the resume point. Local D1 now also holds swsh10.5 (88 cards, serie swsh).
- **2026-07-14** (build) — **P2 milestone 1** (four sub-agent slices + 8-angle
  review + fix pass; committed `b983170`, api deployed `05d46657` +
  prod-smoked same session): filters, panel stats, legality, and the
  full M9 backlog. (A) api: `GET /cards` gains repeatable `id` (≤100, one-call
  deck hydration; chunked IN + in-memory ordering twin), `nameExact`,
  repeatable `stage`/`trainerType`/`energyType`, `serie`, `illustrator`,
  `text`; new `GET /facets`; `CardBrief` += `legal`; KV → `catalog:v3:` with
  bypass for >512-byte keys AND any `?id=` request. (B) M9 backlog cleared:
  guarded `patchWithRollback`, `useDeckLibrary`, api-client-owned 401
  recovery (`setSessionRecoveryHandler`, coalesced probe, retry-once),
  data-layer folder lift-up (parallel PATCHes), visible self-expiring
  error pill (nonce re-announce), `StatusPanel`/`StatusSpinner`, hydration
  self-retry (1s→30s backoff, attempt-unbounded), unknown-id tiles with
  Remove, `src/test/` helpers (fetchStub/fixtures/domShims), glass.ts consts.
  (C) filters server-side with facets-fed options (`useCatalogOptions`);
  kinds → wire params (EX/Mega-only client remainder); hardcoded
  vocabularies deleted. (D) `DeckStats` (supertype counts + type bar) in
  DeckPanel; `Format.legalFlag` unifies `legalOnly` + `isLegalInFormat`;
  Radiant corrected to deck-wide 1 (official rule), Prism Star 1/name.
  Then an 8-angle review (3 correctness, reuse/simplification/efficiency/
  altitude/conventions) → 10 verified findings, ALL fixed in-session — the
  serious two: a **dropped hydration retry** when a batch failed after its
  effect run was disposed (fixed via module-level `liveHydrators` registry;
  failure maps merged + leak fixed) and the **nameExact import regression**
  for names with no print matching the stripped key (fixed: layered
  key→raw→substring resolution). Also: 401 session-expiry no longer raises
  the /decks error pill; LIKE `%`/`_` now escaped api-side; `?id=` requests
  skip KV; dead `getCard` removed; FilterRail/useCardSearch/DeckPanel
  memoized; ACE/Radiant dedup via `deckWideRemaining`. Deferred follow-ups →
  "P2-M1 follow-ups" in `workstreams/deck-builder.md`; D11 revised + D12
  added in `decisions.md`. Suite 528→607; `bun run check` green. NOT
  e2e-driven; api deploy must precede/accompany the web ship (new endpoints).
  Session trap: a usage-limit reset killed 7 review finders mid-flight —
  resumed via SendMessage with zero rework.
- **2026-07-13** (build) — **P1 milestone 9** (four sub-agent slices +
  multi-agent review): the frontend swap. (A) typed zod-free client
  `src/lib/api.ts` (types-only `@luminous/schema` imports, ApiError,
  `credentials:"include"` everywhere) + CSP now derived from
  `VITE_API_ORIGIN` via `loadEnv` (scrydex gone repo-wide). (B) builder on
  the server catalog: api gains repeatable `type`/`rarity` + `sort` +
  extended `CardBrief` (D10; KV `catalog:v2:`); web adapter
  `builder/catalog.ts`, paginated `useCardSearch`, session `cardStore` +
  per-id deck hydration (silent-drop fixed), async server-matched import,
  art via `/assets/cards/{id}` (playmat ids remapped to tcgdex scheme).
  (C) auth: root `AuthProvider` (me() boot), /login + /register (glass form,
  OAuth probe → friendly 503 copy), `AccountButton` corner control.
  (D) decks/folders on the API: optimistic mutations with field-level
  rollback, create-awaits-server, folder-delete lift-up (PATCHes then
  DELETE), builder deck load + debounced serialized PATCH (`deckSaver`),
  localStorage deck store retired; D11 scope trims. E2E-verified via
  agent-browser against wrangler dev (recipe → `.claude/skills/verify/`);
  verification caught two real bugs fixed in-session: **StrictMode
  double-mount permanently disposed the ref-cached saver** (→ effect-owned
  `useDeckSaver`, regression test) and the **register redirect race**
  (render-time `<Navigate to="/">` outran `navigate(from)` — unified).
  Then a 4-finder + 6-verifier + sweep review over the diff: 25+ confirmed
  findings; the 10 serious ones fixed in-session (saver drop-on-unmount
  during in-flight PATCH, name/count caps that could brick saves, auth
  last-writer races, one-off-401 eternal spinner, import-dialog dismissal
  race, `//` redirect guard, hasMore convergence, hydration remount race);
  the rest logged as the **M9 review backlog** in
  `workstreams/deck-builder.md`. Suite 451→528; `bun run check` green.
  NixOS/dev traps: browse dev via `localhost:5173` (CORS `APP_ORIGIN`), the
  cargo `agent-browser` binary is broken (use the Nix-profile one).
- **2026-07-09** (build) — **P1 milestone 8** (sub-agent): lobby Durable
  Object + client WS transport. `LobbyDO` (hibernation API, per-socket
  `serializeAttachment({playerId})`, auto ping/pong) runs the shared
  `lobbyReducer` unchanged; zod wire schemas in
  `packages/schema/src/lobby/wire.ts` with compile-time `Equals<>` proofs
  against the TS types; `lobbyCode` moved into the package. One alarm serves
  disconnect-grace (5 s), countdown→in-game, and empty-lobby TTL (10 min →
  deleteAll). Client `channel.ts` now WebSocket (backoff 400 ms→8 s, send
  queue, ping-as-heartbeat); `useLobby` internals rewritten (server is the
  authority now) but public API + all UI components untouched; API origin
  reader in `src/lib/apiOrigin.ts` (`VITE_API_ORIGIN`). Notable traps fixed:
  zod split out of `protocol.ts` to keep it off the web online chunk
  (97 kB→29 kB); WS route mounts BEFORE hono/cors (101 responses have
  immutable headers). Two-client e2e transcript all green; suite 400→451.
  M7 was committed + deployed + live-smoked this session (deck CRUD in prod).
- **2026-07-09** (build) — **P1 milestone 7** (sub-agent): deck/folder
  persistence API. `packages/schema/src/decks/` (Deck/DeckSummary/Folder +
  create/patch requests); `apps/api/src/decks/` (map/validate/routes);
  `requireUser` middleware extracted from `/auth/me` into
  `apps/api/src/auth/requireUser.ts` (shared session gate). All 9 endpoints
  session-gated; ownership scoping → 404 (no existence leaks); folder-cycle
  guard; card lists validated against the catalog via chunked IN queries
  (D1's 100-bound-params cap → 33-row insert chunks inside one `db.batch`);
  wholesale cards replacement on PATCH; empty PATCH → 400. Suite 343→400.
  M6 auth was committed + deployed + live-smoked this session (register/
  login/me/logout all correct in prod). Note: local D1 had only 123 cards
  (the sub-agent ingested sv01 locally to match test ids — local and remote
  D1 contents drift by design).
- **2026-07-09** (build) — **P1 milestone 6** (sub-agent): auth. Email/password
  + server sessions in `apps/api/src/auth/` — PBKDF2-SHA256 (WebCrypto,
  self-describing `pbkdf2$iters$salt$hash`, dummy-verify timing parity),
  session cookie `Secure; SameSite=None` with **sha256(token)** as the DB row
  id, app-wide CORS (`APP_ORIGIN` var), KV fixed-window rate limits (429 +
  Retry-After), Discord/Google OAuth (state cookie, account-takeover guard:
  unverified-email match → 409; routes 503 until secrets set), verify-email /
  reset-password are 501 pending an email-provider decision. No new
  migration (M3 tables fit). Domain `User` + request schemas in
  `packages/schema/src/auth/`. Suite 273→343. `.dev.vars` gitignored. §3.5
  rewritten as-built. Also this session: **full remote ingest completed**
  (19 sets / 3,698 cards, ~10 min) and M5 deployed + smoke-tested live
  (catalog totals, KV hit, R2 asset miss→hit in production).
- **2026-07-09** (build) — **P1 milestone 5** (sub-agent): public catalog read
  API + the **canonical domain `Card`** (D5) in `packages/schema/src/catalog/`
  (unprefixed names; flat shape, consumers narrow on `category`; `image` is
  OUR asset base path `/assets/cards/{id}`, quality appended by clients).
  Routes in `apps/api/src/catalog/`: `GET /cards` (name/category/type/rarity/
  set/regulationMark/hpMin/hpMax/legal filters; page/pageSize≤100 envelope
  with total), `/cards/:id`, `/sets[?serie=]`, `/sets/:id` (+its cards),
  `/series`; all boundary-parsed through the domain schemas; KV cache-aside
  (binding `CACHE`, TTL 3600, normalized keys, only 200s) with
  `x-luminous-cache`. `@hono/zod-validator@0.8` works with zod 4 (hono range
  bumped to ^4.12). Suite 242→273; wrangler-dev transcript against the real
  123-card local D1 all correct. Uncommitted; deploy + remote ingest pending
  → resume point.
- **2026-07-09** (build) — **P1 milestone 4** (sub-agent) + **D9 logged**:
  ingest pipeline (`apps/api/src/ingest/` sql/map/upserts + 31 tests;
  CLI `apps/api/scripts/ingest.ts` — `--sets|--serie`, `--remote`, `--dry-run`)
  and the lazy R2 asset proxy (`/assets/cards/:id/:file`,
  `/assets/sets/:id/:file`; cache-aside, `x-luminous-cache: hit|miss`).
  Migrations 0001/0002 swap `*_r2_url` → origin `*_url` columns (two-step
  drop-then-add avoids drizzle-kit's interactive rename prompt in non-TTY).
  Local ingest of sve+sv06.5 (123 cards) verified incl. idempotent rerun and
  FK integrity; wrangler-dev curl transcript confirms miss→hit mirroring and
  the 404 allowlist. Suite 242 tests. R2 bucket `luminous-assets` + KV plans
  per §8.5 next. **NixOS quirk:** `wrangler dev` needs
  `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt` for workerd origin
  fetches (production + node-side CLI unaffected). Worker deployed (bindings
  DB + ASSETS live); remote migrations/ingest pending → resume point.
- **2026-07-09** (build) — **P1 milestone 3**: Drizzle schema + D1 migrations
  (sub-agent). `apps/api/src/db/{catalog,users,schema}.ts` — 9 tables per
  §5.3 (updated where reality differed: `series.release_date` added,
  `sets.updated` dropped, `abilities_json` added; `variants_detailed`/
  `pricing`/`boosters`/dp-era extras deliberately not persisted). Migration
  `drizzle/0000_tired_sentry.sql` applied to **local** D1; FK enforcement
  verified. D1 database `luminous` created on the account (EEUR,
  id `735f0fb5-cdc3-494d-8b97-74a8ade0124a`); wrangler.jsonc binds it as `DB`
  with `migrations_dir: "drizzle"`; remote apply verified (9 tables live).
  **Notes for M4 (ingest):** insert series→sets→cards (FKs); upsert,
  never delete+reinsert cards (`deck_cards.card_id` RESTRICT); missing
  upstream `legal` → false/false; JSON columns are Drizzle `mode: "json"` —
  pass raw objects, don't pre-stringify; catalog timestamps ISO text, user
  timestamps epoch-ms integers.
- **2026-07-09** (build) — **P1 milestone 2**, via two sequential sub-agents:
  (a) lobby vocabulary moved — `types.ts` + `lobbyReducer.ts` (+ its 11 tests)
  now live in `packages/schema/src/lobby/`, 7 web importers switched to
  `@luminous/schema` (pure move, clean git renames); (b) tcgdex Zod schemas
  authored in `packages/schema/src/tcgdex/` — discriminated union on card
  `category`, 12 verbatim live fixtures, 19 tests, plus a live sweep script
  (`packages/schema/scripts/validate-live.ts`, outside tsconfig on purpose)
  that validated 390 models over 370 requests with 0 failures. Reality-vs-doc
  corrections folded into §5.1 (notably: `variants_detailed`, `wPromo`,
  `abilities[]`, nullable pricing blocks, tcgplayer dynamic print-run keys).
  `bun run check` green (203 tests) + production `vite build` green. Root
  `package.json` now depends on `@luminous/schema`; the package declares
  `sideEffects: false` so the web bundle tree-shakes unused zod schemas.
- **2026-07-09** (build) — **P1 milestone 1**: Bun-workspace monorepo scaffolded.
  Root `package.json` gained `workspaces: ["apps/*", "packages/*"]` (web app
  stays at root for now, per spec). New: `apps/api` (Hono 4 Worker,
  `wrangler.jsonc`, `GET /health`), `packages/schema` (Zod 4;
  `healthResponseSchema` proves the cross-package import), `packages/engine`
  (stub per D7). Root `tsc -b` references, biome scope, and vitest globs now
  cover all three; `bun run check` green (184 tests). `/health` verified via
  `wrangler dev` + curl, then deployed to
  `https://luminous-api.jofrescari.workers.dev` (user-approved).
  Notes: bun nests workspace deps in each package's own `node_modules`;
  packages export TS source directly (`exports: "./src/index.ts"`, no build
  step); wrangler 4.109 wants `@cloudflare/workers-types` **v5** (peer dep).
- **2026-07-09** — Defined all major decisions (D1–D6); wrote the backend/data
  spec; set up this docs-based continuation system + roadmap. Kicked off
  sub-agents to (a) research the PTCG ruleset → `reference/ptcg-rules.md` and
  (b) map the deck-builder code → `workstreams/deck-builder.md`.
  - Both sub-agents completed: `reference/ptcg-rules.md` (528 lines, SV Standard
    era, engine-oriented) and `workstreams/deck-builder.md` (code map + 19-task
    P2 plan) are written. Continuation system is fully populated.
- **2026-07-09** (design) — Added **D7** (engine lives in `packages/engine`,
  shared by web + api) and **D8** (composable, data-driven card effects: primitive
  op programs over archetype templates + a semantic event stream for animation).
  Queried live tcgdex cards to ground it; expanded `workstreams/simulator.md`.
  Follow-up for P1: add an `abilities_json` column to the `cards` table in
  `workstreams/backend-data.md`.
