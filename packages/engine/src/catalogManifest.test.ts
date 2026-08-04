import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST as M } from "./catalogManifest";
import { programFor } from "./registry";
import { FIXTURE_POOL } from "./testFixtures";

// D156 — HARDENING, NOT A CARD SLICE: THE CATALOG CLAIMS BECOME CHECKABLE.
//
// D150 is the precedent and the model: it found a table that asserted every op
// HAD a verdict and never that the verdict was TRUE, and it paid the hour to
// turn the claim into a proof. This slice does the same thing one level out —
// for the claims the engine makes about the CATALOG.
//
// THREE CONSECUTIVE SLICES FOUND THE SAME DEFECT, AND IT IS ALWAYS A COMMENT.
//   • D151 diffed `FIXTURE_POOL` against the D1 field by field and found real-card
//     fixtures missing a printed Ability or attack — "a fixture can be wrong by
//     OMISSION, and `toEqual` on the fields it HAS will never say so."
//   • D154 found the local D1 holds FIVE sets and that `FIXTURE_POOL` fields cards
//     from a sixth, so every census claiming to have run "against the local D1"
//     was blind to a whole population. A census owes its SCOPE.
//   • D155 found D154 had repeated the number it should have measured: the file
//     holds 890 rows, not the 978 that ~20 census comments quote, and 978 matches
//     no table in it. A number nothing reads is the one that never gets checked.
//
// ⚠️ AND D155's OWN INFERENCE IS THE FOURTH INSTANCE OF THE SAME DEFECT, WHICH IS
// WHY THIS FILE EXISTS RATHER THAN A FIFTH COMMENT. "978 matches no table in the
// file" is TRUE of the file today and does not license "none of them ever
// measured it". They did. **D112 (2026-08-01) recorded the six-set breakdown in
// `decisions.md` verbatim** — *"The local pool is 978 cards over SIX sets, not 890
// over five — sv01/sv02/sv03/sv06.5/sve PLUS swsh10.5 (Pokémon GO, 88 cards)"* —
// and three arithmetics corroborate it: 890 + 88 = 978, and on
// `legal_standard = 0` the docs' 851 is exactly this file's 763 + 88, and D147's
// census table (2026-08-02) lists Pidove `swsh10.5-061` as a QUERY RESULT.
// **The catalog SHRANK between 2026-08-02 and 2026-08-03** — no `cards`, `sets`
// or `series` row for the set survived, and the main .sqlite's mtime never moved,
// so the ingest had lived in a WAL that was never checkpointed.
//
// ⚠️ D160 RE-INGESTED THE SET AND CHECKPOINTED IT, AND EVERY CLAIM D156 MADE FROM
// ARITHMETIC IS NOW CONFIRMED BY QUERY. The catalog is 978 / 6 again and
// `CATALOG_MANIFEST.history` records the episode as HISTORY rather than as a live
// divergence — the dates, what the restored set contributes to each count, and
// D156's committed census of the shrunken catalog, reconciled by SUBTRACTION on
// four independent axes.
//
// That settles the two slices in front of it, by measurement rather than by
// inference. D154's `FIXTURE_POOL` cards "from a set the D1 does not hold" were
// transcribed from rows that WERE there, and D160 diffed all twelve against the
// restored rows field by field: **no wrong value on any field either carries**.
// And D155's downward corrections of §D149's "5 printings" and §D151's "six rows"
// were the outage speaking — re-run against the restored catalog,
// `less damage (before applying` returns SIX rows across all three columns, FIVE
// of them on `attacks_json`, so both original figures were exact.
//
// ⚠️ THE RESIDUE, AND IT IS THE MOST USEFUL LINE IN THIS FILE. The rows came back;
// the comments written while they were gone did not change. Every census in this
// repo dated 2026-08-03 ran against the 890 / 5 catalog and is a FLOOR against
// this one — D154's, D155's, D156's own, and D157's, D158's and D159's, which
// state "890 rows / 5 sets" in their own headers. `history.censusedInTheGap` is
// the list, and `history.shrunken` is the population those numbers describe.
//
// Every one of those survived because it lived in a comment. This file is where
// that stops. It reads `catalogManifest.ts` — a COMMITTED, generated measurement
// of the local D1 (`bun run scripts/catalog-manifest.ts`) — and fails on:
//
//   (a) a fixture whose printed NAME disagrees with the catalog;
//   (b) a fixture MISSING a printed Ability or attack, unless the omission is
//       declared below WITH A REASON;
//   (c) a fixture id with NO catalog row at all, unless declared below;
//   (d) a fixture attack sitting at the wrong printed INDEX — the omission that
//       silently renumbers every reader keyed on an index (the `attack` action,
//       the registry's `attack` map, D154's `lockedAttackIndex`, D155's
//       `boostedAttack.attackIndex`);
//   (e) a three-or-four-digit "N cards" anywhere in `packages/engine/src` that is
//       not a MEASURED number — and, when it is a catalog ROW COUNT, one that does
//       not carry its SET COUNT. That last clause is the real lesson: both 890 and
//       978 are true, of different populations, and the ~20 repetitions were
//       unreadable not because the number was wrong but because it was SCOPELESS.
//
// ⚠️ WHY A COMMITTED SNAPSHOT AND NOT A TEST THAT OPENS THE SQLITE. The local D1
// lives under `apps/api/.wrangler/state/` — dev state, not a build input. It is
// absent on a fresh clone and in CI, and its contents depend on when someone last
// ran the ingest. A vitest case that opened it would be flaky BY CONSTRUCTION:
// green here, red or (far worse) vacuously green elsewhere. So the sqlite is read
// exactly once, by a script, and the numbers are committed.
//
// THE TRADEOFF, STATED RATHER THAN HIDDEN: the manifest can go stale against the
// sqlite and no test can see that. What every test here CAN see is each
// CONSEQUENCE of the manifest, and `bun run scripts/catalog-manifest.ts --check`
// answers "is it current?" in one command for anyone who has the file. That is
// the same bargain `testFixtures.ts` already makes — a committed transcription of
// catalog rows — except that the transcription is now generated and diffed rather
// than typed and trusted.
//
// ⚠️ EVERY ALLOWLIST BELOW IS TOTAL IN BOTH DIRECTIONS (D150's rule). A declared
// omission that no longer exists FAILS, exactly as an undeclared one does — a
// suppression nobody can retire is the same disease as a claim nobody re-measures.
// And every entry carries a REASON, because a silent skip is the thing this file
// was written against.

/** A fixture id naming a real printing rather than a synthetic `fix-*` body.
    Kept identical to the generator's classifier — the totality case below proves
    the two agree, so an id shape neither of them knows about fails loudly instead
    of being silently skipped by both. */
const REAL_ID = /^(sv|swsh)/;

const realFixtureIds = Object.keys(FIXTURE_POOL).filter((id) => REAL_ID.test(id)).sort();

/** (c) Real-card fixtures with NO catalog row IN THE FILE AS IT STANDS. D154 found
    the population, D156 enumerated it at TWELVE — all `swsh10.5` — and **D160
    emptied it by re-ingesting the set.**

    ⚠️ THE EMPTY TABLE IS A RESULT, NOT AN ABSENCE OF ONE. Seven of the twelve
    carried a doc block saying the card was "VERBATIM off the local D1", some down
    to a byte count of the effect string, and for the length of the outage nothing
    in this repo could check a single one of them: they were the only surviving
    copies of rows the database had lost. D160 diffed all twelve against the
    restored rows field by field — name, hp, stage, evolveFrom, types, retreat,
    weaknesses, resistances, effect, and every attack's and Ability's cost, damage
    and effect string — and **found no wrong VALUE on any field any of them
    carries.** The three real findings are omissions, and they are declared in
    `INCOMPLETE` below rather than here, because they now have catalog rows.

    The table is KEPT rather than deleted. A fixture id with no catalog row is
    precisely the defect this file exists to surface, the entry cost is one line,
    and the suite below is total in both directions — so an undeclared absence
    fails whether the table is empty or not. */
const NO_CATALOG_ROW: Record<string, string> = {};

/** (b)+(d) Fixtures that do not carry the whole printed card, each with the
    reason it does not. The pool is deliberately a set of SIMPLIFIED stand-ins —
    the registry keys on the ID, not on the stage or the attack list — so most of
    these are declared in the fixture's own doc block and this table is the place
    those declarations become CHECKED.

    `attacks` / `abilities` are the printed NAMES the fixture omits, `invented` a
    name the fixture carries that the card does not print, and `reindexed: true`
    marks a fixture where dropping (or substituting) a LEADING attack moved every
    attack after it — the sharpest entry in the table, because an index is exactly
    what the `attack` action and the registry's `attack` map key on, and a suite
    pinning "index 0" on such a body is pinning the wrong index while green.

    ⚠️ `reindexed` IS NOW UNUSED, AND THAT IS THE RESULT RATHER THAN A DEAD FIELD
    (D173). It carried SIX entries — `sv06.5-026`, `sv01-124`, `sv01-079`,
    `sv01-032`, `sv01-096` (D156's five) and `swsh10.5-009` (D160's, the only one
    found BY this table rather than declared into it). All six now carry their
    whole printed attack list at printed indices and every declaration that named
    the old number has been re-pointed. The field is KEPT, exactly as
    `NO_CATALOG_ROW` is kept empty: `(d)` below asserts the set is EMPTY in both
    directions, so the next fixture that drops a leading attack has to declare
    itself here rather than being absorbed by a table that no longer has a column
    for it. An omission this file cannot NAME is one it cannot count. */
const INCOMPLETE: Record<
  string,
  { attacks?: string[]; abilities?: string[]; invented?: string[]; reindexed?: true; why: string }
> = {
  // — the §9 reactive-recoil / trigger cast: the behaviour is a REGISTRY row keyed
  //   by id, and these bodies only ever DEFEND, so the printed attack is never paid.
  "sv01-005": { attacks: ["Light Punch"], why: "Cacnea — registry passive 'Counterattack Quills'; a defender only, never pays an attack." },
  "sv01-006": { attacks: ["Spike Shot"], why: "Cacturne — Cacnea's twin, same reason." },
  "sv03-112": { attacks: ["Rumble"], why: "Stunfisk — registry passive 'Custom Trap' (the Tool-gated recoil); a defender only." },
  "sv03-044": { attacks: ["Steam Artillery"], why: "Armarouge — registry `onDamagedByAttack` trigger 'Scorching Armor'; a defender only." },
  "sv03-120": { attacks: ["Falling Press"], why: "Klawf ex — registry `onDamagedByAttack` trigger 'Counterattacking Pincer'; declared in its doc block ('No `attacks`: it is always the DEFENDER')." },
  // — the Ability-lock aura cast: the printed `abilities` NAME is load-bearing here
  //   (Mischievous Lock's `exemptAbilityNamed` matches against it), so these carry
  //   the Ability and drop the attack. ⚠️ Klefki sv01-096 USED TO BE THE ODD ONE
  //   OUT of this file's six `reindexed` entries — it SUBSTITUTED fix-attacker's
  //   Bite for the printed "Joust" rather than dropping anything, which is why it
  //   was the only entry carrying both an `attacks` and an `invented` name. D173
  //   gave it its own printed attack and the entry is gone. ⚠️ SPIRITOMB
  //   sv02-089 IS GONE FOR THE SAME REASON AT D175 — it declared "Fade Out"
  //   absent with the reason "the body never attacks", which is a statement about
  //   the SUITES rather than about the CARD, and it was the pin holding a wrong
  //   `types` value in place (correcting one axis alone would have left the other
  //   wrong). The whole cast that remains below omits an attack because the body
  //   only ever DEFENDS; Spiritomb never even did that.
  "sv02-097": { abilities: ["Safeguard"], why: "Mimikyu — declared in its doc block: Safeguard is authored in the REGISTRY, keyed by id, which makes this the sharpest zero-registry-ROW witness (`programFor` is defined, `.attack` is not). D151 called this the LIVE case; it is documented, and its residual cost is that a `FIXTURE_POOL` sweep for the printed sentence cannot see it." },
  // — the always-on damage-reduction / debuff passives: registry rows, tanky bodies
  //   fielded to be HIT.
  "sv02-150": { attacks: ["Nosequake"], abilities: ["Bronze Body"], why: "Copperajah ex — registry passive (−30 after W/R); a tanky body fielded to absorb an attack." },
  "sv01-121": { attacks: ["Mega Kick"], abilities: ["Exoskeleton"], why: "Stonjourner — registry passive (−20 after W/R); same shape as Copperajah ex." },
  "sv03-082": { attacks: ["Wondrous Moon"], why: "Clefable ex — registry passive 'Lunar Zone' (the `noRetreatCostAura` source); a retreat test, never an attack one." },
  // — the activated / triggered Ability cast (M4 slices 6–9): real ids so
  //   `programFor` finds the program, simplified bodies so surgery can place them.
  "sv01-023": { attacks: ["Solar Beam"], abilities: ["Enriching Oil"], why: "Arboliva — registry `onEvolve` trigger; declared in the slice's section comment (stages/evolveFrom simplified to the fixture line)." },
  "sv02-170": { attacks: ["United Wings"], abilities: ["Insta-Flock"], why: "Flamigo — registry `onPlayToBench` trigger; same section comment." },
  "sv02-123": { attacks: ["Knocking Hammer"], abilities: ["Blessed Salt"], why: "Garganacl — registry `betweenTurns` trigger; a Basic here so it sits without an evolution." },
  "sv03-012": { attacks: ["Lock Up"], abilities: ["Forest Miasma"], why: "Trevenant — registry `betweenTurns` trigger; a Basic for the same reason." },
  "sv01-118": { attacks: ["Wing Attack"], abilities: ["Flying Entry"], why: "Hawlucha — registry `onPlayToBench` trigger (the snipe cast)." },
  "sv02-015": { attacks: ["Scratching Nails"], abilities: ["Bouquet Magic"], why: "Meowscarada ex — registry activated Ability; a Basic HERE though the print is a Stage 2 (declared in its doc block)." },
  "sv02-126": { attacks: ["Poison Petals"], why: "Glimmora — registry `onKnockOut` trigger; 30 HP so one Bite Knocks it Out, which is the whole point." },
  "sv03-143": { abilities: ["Special Eater"], why: "Mawile — declared in its doc block: 'the Ability lives in the registry, so the card needs no `abilities` here'." },
  "sv01-054": { attacks: ["Hydro Kick"], abilities: ["Energy Carnival"], why: "Quaquaval — registry activated Ability (attachEnergyFrom); declared in the slice's section comment." },
  "sv02-060": { attacks: ["Buster Tail"], abilities: ["Super Cold"], why: "Baxcalibur — Quaquaval's twin, same section comment." },
  // ⚠️ GARDEVOIR EX sv01-086 USED TO DECLARE `attacks: ["Miracle Force"]` HERE AND
  //   DOES NOT SINCE D177 — the seventh entry struck out on the D173/D175 rule, and
  //   the one with the sharpest consequence. Its reason ("registry activated
  //   Ability … same section comment") was a statement about the SUITE that fielded
  //   the body, not about the card; the attack it declared absent turned out to
  //   print the whole subject of a family nobody had counted, so for the length of
  //   that declaration **a FIXTURE_POOL census could not see its own subject** while
  //   the catalog census could. The two reprints sv01-228 / sv01-245 arrived at the
  //   same time carrying the same attack, so all three declare only the Ability.
  "sv01-086": { abilities: ["Psychic Embrace"], why: "Gardevoir ex — registry activated Ability with the counter/KO riders; same section comment. Its printed attack 'Miracle Force' is CARRIED since D177 (it is the ATTACK half of the `clearStatus` family)." },
  "sv01-228": { abilities: ["Psychic Embrace"], why: "Gardevoir ex (Ultra Rare) — the sv01-086 reprint, same registry row (`GARDEVOIR_EX`) keyed by id; carries its printed 'Miracle Force' so the text-keyed deriver claim is drivable on a reprint." },
  "sv01-245": { abilities: ["Psychic Embrace"], why: "Gardevoir ex (Special illustration rare) — the second sv01-086 reprint, same reason." },
  "sv01-145": { abilities: ["Busybody Nurse"], why: "Blissey — registry activated Ability (D177's `clearStatus`, `activeOnly: false` so a benched Blissey nurses the Active); the Mawile/Armarouge shape, `programFor` finds the program so an `abilities` array here would be inert. Its printed attack 'Happy Cyclone' rides along at its PRINTED index 0." },
  "sv01-125": { attacks: ["Wild Impact"], abilities: ["Dino Cry"], why: "Koraidon ex — registry activated Ability with `endsTurn`; the attach is the test." },
  "sv01-041": { abilities: ["Fire Off"], why: "Armarouge sv01-041 — declared in its doc block: the Ability is the registry's, and 'its printed attack rides along because a fixture Pokémon that cannot attack makes an awkward Active'." },
  "sv02-140": { abilities: ["Tri Howl"], why: "Hydreigon — same declaration, and Tri Howl is usable from the Bench so the suites need it in both spots." },
  "sv01-142": { abilities: ["Rumbling Engine"], why: "Revavroom — registry activated Ability (the payment-ORDER witness)." },
  "sv01-151": { abilities: ["Nest Stash"], why: "Skwovet — registry activated Ability; its printed attack is a plain 20 kept so an Active Skwovet cannot put an unrelated effect into an Ability test." },
  "sv03-125": { abilities: ["Infernal Reign"], why: "Charizard ex — registry `onEvolve` trigger; its doc block declares `evolveFrom` as the ONE deviation and is the block that names a false verbatim banner as a defect." },
  // — ⚠️ THE EXACT-N / TYPED `discardEnergy` CAST (D43) HAD FOUR ENTRIES HERE and
  //   has NONE. Slither Wing sv06.5-026, Koraidon sv01-124, Kilowattrel sv01-079
  //   and Arcanine ex sv01-032 each carried only their DISCARDING attack, which the
  //   card prints at index 1 — declared in their two section comments, which is
  //   what made a wrong index legible without making it wrong. D173 gave all four
  //   their whole printed attack list and re-pointed every `{ index: 0 }` that
  //   named the fixture's number instead of the card's.
  // — pre-evolutions and one deliberate Ability omission.
  "sv03-061": { attacks: ["Tail Smack"], why: "Finizen — declared: 'NO ATTACKS are carried … giving it an attack would only invite a case to use the wrong one'. It exists to be retreated in and evolved." },
  "sv06.5-039": { abilities: ["Subjugating Chains"], why: "Pecharunt ex — declared in its own doc block, which is also the block that states the standard: omit an unexercised printed field rather than 'claim a verbatim card while quietly dropping one'." },
  // — ⚠️ THE `swsh10.5` OMISSIONS, CHECKABLE FOR THE FIRST TIME (D160). For the
  //   whole life of these fixtures their set had no catalog rows, so nothing in
  //   this repo could see what they left out; D156 could only file all twelve
  //   under `NO_CATALOG_ROW`. The re-ingest turned that list into this one. It was
  //   THREE; D173 made Charmeleon `swsh10.5-009` complete (it dropped its printed
  //   index-0 "Scratch") and it is TWO. The other ten are COMPLETE, and no field
  //   on any of the twelve carries a wrong VALUE — the "verbatim off the local D1"
  //   doc blocks were telling the truth.
  "swsh10.5-010": { abilities: ["Burn Brightly"], why: "Charizard — declared in its own doc block as 'A THIRD simplification, beyond the two the header declares', with the reason: 'Burn Brightly' is a PROVISION modifier and `continuous.ts unitsOf` has no hook for a Pokémon Ability that changes what attached Energy provides. The declaration predates any catalog that could check it and is exact." },
  "swsh10.5-018": { abilities: ["Pump Shot"], why: "Radiant Blastoise — the registry-authored-Ability cast (`RADIANT_BLASTOISE`, keyed by id), same shape as Mawile sv03-143 and Armarouge sv01-041: `programFor` finds the program, so the printed `abilities` array would be inert. Its printed attack 'Torrential Cannon' rides along at its PRINTED index 0 and is D154's fifth per-attack-lock printing." },
};

/** (e) The catalog STATES a census comment could be quoting, and the set count
    each one owes. A comment quoting a row count must say which population it
    means — that is exactly the information ~20 comments left out, and it is why
    "978" read as fiction to the slice that only had the shrunken file to check it
    against.

    ⚠️ WHY A LIST AND A `Map` RATHER THAN AN OBJECT LITERAL (D160). D156 wrote this
    as `{ [M.rows]: M.setRows, [M.priorState.rows]: M.priorState.setCount }`, which
    stopped COMPILING the moment the catalog was restored: both states became
    978 → 6 and the computed keys collided (TS1117). Deleting a key would have
    deleted the check, and hard-coding one would have re-introduced the copied-
    forward number this whole file exists against. So the states are declared as a
    LIST — each with the population it names — and the lookup is derived from it.

    Two states coinciding is now the EXPECTED condition and must be silent: the
    catalog before the loss and the catalog after the restore are the same 978 / 6,
    and a future re-ingest could make a third agree with them. What must still go
    RED is two states agreeing on ROWS and disagreeing on SETS, because that is the
    case where the sweep below would have to pick one answer and would silently
    stop enforcing the other. A `Map` built by `new Map(...)` would last-wins that
    away, so it is asserted as its own case rather than left to the builder. */
const CATALOG_STATE_LIST: readonly { rows: number; sets: number; population: string }[] = [
  {
    rows: M.rows,
    sets: M.setRows,
    population:
      "the file on disk today — and, identically, the catalog before the loss: the re-ingest restored the state D112 measured, not a new one",
  },
  {
    rows: M.history.shrunken.rows,
    sets: M.history.shrunken.setCount,
    population: `the catalog during the ${M.history.set} outage (${M.history.firstMissing} → ${M.history.restored}), which every census dated 2026-08-03 queried`,
  },
];

const CATALOG_STATES: ReadonlyMap<number, number> = new Map(
  CATALOG_STATE_LIST.map((s) => [s.rows, s.sets]),
);

/** Numbers that look like a catalog census and are not one. Everything else
    matching `N cards` for a three- or four-digit N must be a MEASURED value from
    the manifest (or from `priorState`, marked inherited there) — that is what
    makes a copied-forward count go red. */
const NOT_A_CATALOG_COUNT: Record<number, string> = {
  999: "deckTopMill.test.ts — an INVENTED sentence fed to the deriver ('Discard the top 999 cards of your deck.'), pinning that the mill reader takes its count from the capture. No card prints it.",
  3698: "index.ts — the LIVE REMOTE D1's row count, a different database this session cannot query. INHERITED and unverified, and said so rather than quietly rewritten: D156's whole finding is that a number from another population is not a wrong number, it is an unscoped one.",
};

/** Every source file in the engine, as text — the only way to check a claim that
    lives in a COMMENT, which is where all three of D151/D154/D155's defects lived.
    A GLOB rather than a list, because a sweep that names its inputs cannot see the
    file nobody added to it (D148's lesson, D150's second payout).

    The local cast is deliberate and is the cheapest of the three ways to type
    this. `"types": ["node"]` would put Node globals in scope for a package that
    runs in a Worker and in the browser; `"types": ["vite/client"]` would put
    `import.meta.env` there; a `.d.ts` merging onto `ImportMeta` reads to biome as
    an unused interface. Vitest resolves the call at runtime either way, so the
    cast buys the types without widening anything the engine can see. */
const ENGINE_SOURCES: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("./*.ts", { query: "?raw", import: "default", eager: true });

describe("the manifest is internally consistent", () => {
  it("the per-set counts sum to the row count — the SCOPE and the TOTAL are one query apart", () => {
    const summed = Object.values(M.sets).reduce((a, b) => a + b, 0);
    expect(summed).toBe(M.rows);
    // D154's finding restated as an assertion, and D160 is the day it changed
    // sides: the list was five sets while `swsh10.5` was missing, and the comment
    // here said "re-ingesting the set makes this fail, which is the day the twelve
    // NO_CATALOG_ROW entries become checkable again". That day came. The list is
    // pinned at SIX so a second silent loss is a failure and not a shrug.
    expect(Object.keys(M.sets).sort()).toEqual([
      "sv01",
      "sv02",
      "sv03",
      "sv06.5",
      "sve",
      "swsh10.5",
    ]);
  });

  it("the category split sums to the row count, and names all three categories", () => {
    expect(Object.values(M.categories).reduce((a, b) => a + b, 0)).toBe(M.rows);
    expect(Object.keys(M.categories).sort()).toEqual(["Energy", "Pokemon", "Trainer"]);
  });

  it("distinct names are FEWER than rows — a card is a printing, not a species", () => {
    expect(M.distinctNames).toBeLessThan(M.rows);
  });

  it("the three text columns each have their own count, and `any` is their union", () => {
    const { effect, attacksJson, abilitiesJson, any } = M.textColumns;
    // Not a sum: a Pokémon row can carry attacks AND an Ability. The union must
    // sit between the largest single column and the (over-counting) total, and
    // must never exceed the row count.
    expect(any).toBeGreaterThanOrEqual(Math.max(effect, attacksJson, abilitiesJson));
    expect(any).toBeLessThanOrEqual(effect + attacksJson + abilitiesJson);
    expect(any).toBeLessThanOrEqual(M.rows);
    // ⚠️ D156 ASSERTED `attacksJson === categories.Pokemon` — "every Pokémon row
    // carries attacks and nothing else does" — and the restored set brought the
    // counterexample back with it. Ditto `swsh10.5-053` prints NO attacks at all:
    // its Ability "Sudden Transformation" borrows them from the discard pile. So
    // the equality was true of the FIVE-set catalog and is false of the six-set
    // one, which is the same shape of defect this file was built for, caught by
    // the file itself. Restated as the identity that actually holds, with the
    // exceptions ENUMERATED rather than counted — D129/D130's "cards with
    // attacks" denominator is `attacksJson`, never the category.
    expect(attacksJson + M.pokemonWithoutAttacks.length).toBe(M.categories.Pokemon);
    expect([...M.pokemonWithoutAttacks]).toEqual(["swsh10.5-053"]);
  });

  it("records WHICH file it measured, and when that file was last written", () => {
    expect(M.source.path).toContain("miniflare-D1DatabaseObject");
    expect(M.source.bytes).toBeGreaterThan(0);
    // Not the generation date: the catalog is ingest output and does not drift on
    // its own, so the sqlite's mtime is the honest provenance for every number.
    expect(new Date(M.source.mtime).getTime()).toBeGreaterThan(0);
  });

  it("D137's apostrophe premise holds: ZERO curly apostrophes in the whole catalog", () => {
    // The fold exists against a future re-ingest, not against today's bytes —
    // which is only worth saying because it is now measured rather than recalled.
    expect(M.curlyApostropheAnywhere).toBe(0);
    expect(M.straightApostropheInAttacks).toBeGreaterThan(0);
  });
});

describe("(c) every real-card fixture is either in the catalog or declared absent", () => {
  it("classifies every real fixture id, and the generator agrees with this suite", () => {
    const classified = [...Object.keys(M.printed), ...M.absent].sort();
    expect(classified).toEqual(realFixtureIds);
  });

  it("every absent id carries a REASON, and no reason is dead", () => {
    expect(Object.keys(NO_CATALOG_ROW).sort()).toEqual([...M.absent].sort());
    for (const [id, why] of Object.entries(NO_CATALOG_ROW)) {
      expect(why.length, `${id} needs a real reason`).toBeGreaterThan(20);
    }
  });

});

describe("(a) no fixture NAME is wrong", () => {
  // D146 and D147 each found real cards misnamed in comments and in a test TITLE,
  // and D149 found three more; the standing rule is "verify by QUERY, never by
  // recognition". D151 measured that no fixture NAME is wrong. This is that
  // measurement turned into an assertion.
  it("every fixture with a catalog row carries the printed name — or is a Trainer named by its id", () => {
    const idNamed: string[] = [];
    for (const [id, printed] of Object.entries(M.printed)) {
      const fixture = FIXTURE_POOL[id];
      if (fixture === undefined) throw new Error(`manifest row with no fixture: ${id}`);
      if (fixture.name === printed.name) continue;
      // The ONE systemic exception, and it is a rule rather than a list: the
      // `trainerCard` / `itemTrainer` helpers name a Trainer by its own id,
      // because `programFor` keys on the id and no Trainer rule reads a name.
      expect(fixture.name, `${id} (${printed.name}) has a WRONG name`).toBe(id);
      idNamed.push(id);
    }
    // …and that exception may never reach a Pokémon, whose name IS read (evolution
    // matching, `byName` search, the aura's `exemptAbilityNamed`).
    for (const id of idNamed) expect(FIXTURE_POOL[id]?.category).toBe("Trainer");
    expect(idNamed.length).toBeGreaterThan(0);
  });

  // ⚠️ D173 — THE FIRST NON-NAME FIELD THIS FILE CHECKS, AND IT WAS FOUND BY
  // ACCIDENT. The wrong-index slice read Klefki sv01-096's catalog row to transcribe
  // its attack and noticed the fixture says `types: ["Fairy"]` where the card prints
  // `["Psychic"]` — a wrong VALUE, not an omission, on a body this repo has fielded
  // since D100. Nothing could see it: `M.printed` recorded NAMES only, so every
  // assertion in this file could pass on a fixture carrying the wrong ELEMENT.
  //
  // ⚠️ AND IT IS A DIFFERENT DEFECT CLASS FROM EVERYTHING ABOVE. `(b)`/`(d)` catch
  // what a fixture LACKS; D160's field-by-field diff of the twelve `swsh10.5` rows
  // caught wrong values but ran ONCE, by hand, over one set, and reported ZERO —
  // a measurement, not a guard. This is that measurement turned into a standing
  // assertion over the WHOLE pool, which is D150's move and this file's own reason
  // for existing: a claim nobody records is a claim nobody can contradict.
  //
  // The exceptions are ENUMERATED with the value each side holds, never counted —
  // D160's rule from the `pokemonWithoutAttacks` restatement. Type is not cosmetic
  // here: it is what Weakness/Resistance match on and what an Energy cost is paid
  // in, so a divergence is a live damage-math difference wherever the fixture is a
  // DEFENDER. The sweep found FIVE, and the split was the finding: THREE were the
  // `battler` helper's `["Colorless"]` DEFAULT showing through on a fixture that
  // never set the field, and TWO were values a human WROTE and got wrong. The
  // default is the cheaper defect — it is visible in the fixture as an absence —
  // and the written ones are the dangerous class, because "Fairy" is a retired type
  // this catalog folds into Psychic and so reads as DELIBERATE rather than stale.
  //
  // ⚠️ AND ONE OF THE TWO WRITTEN ONES IS NOW FIXED RATHER THAN DECLARED. Klefki
  // sv01-096 was corrected to its printed `["Psychic"]` at the merge, on the slice's
  // own finding that A DECLARATION IS NOT A FIX: an enumerated exception costs one
  // line and a corrected fixture costs one line, and the entry wins every time it is
  // offered — which is exactly how six wrong-index fixtures survived four slices.
  // The fix was free (nothing read the element: Klefki is the aura source in
  // abilityLock/attackCostDelta/punkOut/block/lunarZone/trapTerritory and attacks
  // only in abilityLock and expShare, always into a body with no Fire/Psychic W or
  // R), and the ONLY thing that went red was THIS TABLE over-declaring it — which is
  // the bidirectional assertion below working exactly as designed.
  //
  // ⚠️ AND AT D175 THE TABLE IS **EMPTY**, BY ONE FIX AND ONE RULE. The five
  // split two ways and each half was closed on its own terms:
  //
  //   • the WRITTEN ones — Klefki sv01-096 `["Fairy"]` (D173) and Spiritomb
  //     sv02-089 `["Darkness"]` (D175) — were FIXED to the print. Spiritomb's was
  //     not free and that is why D173 did not take it: its printed "Fade Out" was
  //     declared absent in INCOMPLETE, so correcting one axis alone would have
  //     left the body right on the type and wrong on the attack list. Both landed
  //     together. The value was the card's WEAKNESS column (`weaknesses_json`
  //     `[{"type":"Darkness","value":"×2"}]`) written into `types` — the wrong
  //     FIELD, not a wrong element, which is why it read as deliberate.
  //   • the DEFAULTED ones — Garganacl sv02-123 and Trevenant sv03-012 — were not
  //     fixed at all. `battler` now derives an unnamed `types` from
  //     `CATALOG_MANIFEST.printed`, so both carry their print by construction and
  //     the fixture written the same way tomorrow carries it too. PENDING EDITS
  //     BECAME A RULE.
  //
  // ⚠️ AND THE THIRD "DEFAULT" WAS NOT ONE — THE CLASSIFICATION ABOVE WAS WRONG.
  // Arboliva sv01-023 is a RAW LITERAL, not a `battler` call (it is a Stage 1 with
  // an `evolveFrom`, so it never went through the helper), and its `["Colorless"]`
  // was WRITTEN — copied from the helper's shape rather than from the card. The
  // rule could not reach it and it took the one hand-edit after all. **A DEFECT
  // FILED UNDER THE WRONG CLASS IS ONE A RULE AIMED AT THAT CLASS WILL MISS**, and
  // nothing but this sweep going red could say so: "fixture Colorless, print
  // Grass" is the same OBSERVATION for a default and for a hand-write, and D173
  // inferred the cause from the value instead of from the construction site. So
  // the written column is 3 of 5, not 2 — and it was the whole population.
  //
  // The table is KEPT, exactly as `NO_CATALOG_ROW` and `reindexed` are kept: the
  // sweep below is total in BOTH directions, so a dead declaration fails as
  // loudly as an undeclared divergence whether the table is empty or not, and an
  // omission this file cannot NAME is one it cannot count.
  //
  // ⚠️ AND THE EMPTINESS IS PINNED SEPARATELY (D173's `shifted` precedent). With
  // the table empty, `diverged` vs its keys is `[] vs []` and would pass for a
  // fixture that diverges AND declares itself — which is precisely the move this
  // slice exists to stop. `expect(diverged).toEqual([])` makes a SIXTH divergence
  // a FAILURE rather than a table entry, so the only way to satisfy this file is
  // to fix the fixture.
  const TYPES_DIVERGE: Record<string, string> = {};

  it("every fixture with a catalog row carries the printed TYPES, or declares why not", () => {
    const diverged: string[] = [];
    for (const [id, printed] of Object.entries(M.printed)) {
      const fixture = FIXTURE_POOL[id];
      if (fixture === undefined) throw new Error(`manifest row with no fixture: ${id}`);
      // Trainers and Energy print no types and the helpers give them none.
      if (printed.types.length === 0) {
        expect(fixture.types ?? [], `${id} prints no types`).toEqual([]);
        continue;
      }
      if (JSON.stringify(fixture.types ?? []) === JSON.stringify(printed.types)) continue;
      diverged.push(id);
      expect(
        TYPES_DIVERGE[id],
        `${id} (${printed.name}) carries ${JSON.stringify(fixture.types)} where the card prints ${JSON.stringify(printed.types)} — declare it or fix it`,
      ).toBeDefined();
    }
    // Total in BOTH directions: a declaration for a fixture that no longer
    // diverges is as dead as an undeclared divergence is silent.
    expect(diverged.sort()).toEqual(Object.keys(TYPES_DIVERGE).sort());
    // …and PINNED EMPTY on top of that, so a sixth divergence cannot be absorbed
    // by declaring it — the table above is empty and must stay so.
    expect(diverged).toEqual([]);
    for (const why of Object.values(TYPES_DIVERGE)) expect(why.length).toBeGreaterThan(30);
    // The sweep read a real population — an empty `printed` satisfies the loop.
    expect(Object.values(M.printed).filter((p) => p.types.length > 0).length).toBeGreaterThan(100);
  });
});

describe("(b) a fixture may omit a printed attack or Ability only with a stated reason", () => {
  /** The printed names the fixture does not carry, and the ones it carries that
      the card does not print. Computed off the manifest, never off the fixture's
      own doc block — the omission failure mode is precisely that the doc block
      and the card disagree and nothing can see it. */
  function diffOf(id: string) {
    const printed = M.printed[id];
    const fixture = FIXTURE_POOL[id];
    if (printed === undefined || fixture === undefined) throw new Error(`no row for ${id}`);
    const fixtureAttacks = (fixture.attacks ?? []).map((a) => a.name);
    const fixtureAbilities = (fixture.abilities ?? []).map((a) => a.name);
    return {
      attacks: printed.attacks.filter((n) => !fixtureAttacks.includes(n)),
      abilities: printed.abilities.filter((n) => !fixtureAbilities.includes(n)),
      invented: fixtureAttacks.filter((n) => !printed.attacks.includes(n)),
      reindexed: fixtureAttacks.some((n, i) => printed.attacks[i] !== n),
    };
  }

  it("every incomplete fixture is declared, and every declaration is exact", () => {
    for (const id of Object.keys(M.printed)) {
      const d = diffOf(id);
      const declared = INCOMPLETE[id];
      const complete = !d.attacks.length && !d.abilities.length && !d.invented.length && !d.reindexed;
      if (complete) {
        expect(declared, `${id} is complete — remove its INCOMPLETE entry`).toBeUndefined();
        continue;
      }
      expect(declared, `${id} (${M.printed[id]?.name}) omits ${JSON.stringify(d)} and is NOT declared`).toBeDefined();
      expect(declared?.attacks ?? [], `${id} attacks`).toEqual(d.attacks);
      expect(declared?.abilities ?? [], `${id} abilities`).toEqual(d.abilities);
      expect(declared?.invented ?? [], `${id} invented`).toEqual(d.invented);
      expect(declared?.reindexed === true, `${id} reindexed`).toBe(d.reindexed);
    }
  });

  it("no declaration is dead — every id in the table still names a real fixture with a row", () => {
    for (const id of Object.keys(INCOMPLETE)) {
      expect(M.printed[id], `${id} has no catalog row — it cannot be an INCOMPLETE entry`).toBeDefined();
      expect(FIXTURE_POOL[id], `${id} is no longer a fixture`).toBeDefined();
    }
  });

  it("every declaration carries a REASON, not a bare suppression", () => {
    for (const [id, entry] of Object.entries(INCOMPLETE)) {
      expect(entry.why.length, `${id} needs a real reason`).toBeGreaterThan(30);
    }
  });
});

describe("(d) a fixture attack sits at its PRINTED index unless the shift is declared", () => {
  // The sharpest case in the file. An attack's INDEX is what the `attack` action
  // carries, what the registry's `attack` map is keyed by, and what D154's
  // `lockedAttackIndex` and D155's `boostedAttack.attackIndex` store — so a
  // fixture that drops a LEADING attack renumbers every reader on that body, and
  // a suite pinning "index 0" on it pins the wrong index while staying green.
  // D144's index trap, living in the fixture pool rather than in a comment.
  //
  // ⚠️ AND SINCE D173 THE SET IS EMPTY, which changes what this block has to do.
  // While six fixtures were shifted, both cases below were about CONTAINING the
  // hazard; with none left they would both be VACUOUS — a `for` over an empty
  // table and an `toEqual` of two empty arrays pass whatever the engine does. So
  // the first case pins the emptiness EXPLICITLY (a shifted fixture is now a
  // failure, not a table entry), and the second is widened from "the reindexed
  // ones" to EVERY registry-authored attack index in the pool, which is the
  // invariant the narrow version was a proxy for and which only became checkable
  // once nothing was allowed to be shifted.
  it("no fixture is reindexed, and the table agrees", () => {
    const shifted = Object.keys(M.printed).filter((id) => {
      const names = (FIXTURE_POOL[id]?.attacks ?? []).map((a) => a.name);
      return names.some((n, i) => M.printed[id]?.attacks[i] !== n);
    });
    const declared = Object.entries(INCOMPLETE)
      .filter(([, e]) => e.reindexed === true)
      .map(([id]) => id);
    expect(shifted.sort()).toEqual(declared.sort());
    // …and the value both sides hold. D156 found five of these, D160 a sixth, and
    // D173 fixed all six; a seventh must go RED here rather than be absorbed.
    expect(shifted).toEqual([]);
  });

  it("a registry-authored attack index always points at the attack the card prints there", () => {
    // The consequence that would actually be a BUG rather than a hazard: the
    // registry authors programs BY INDEX (`CardProgram.attack` is keyed by
    // attackIndex), so a body whose fixture attack list disagrees with the print
    // would run the wrong program. Swept over the WHOLE pool, both ways: the
    // fixture must carry an attack at that index, and the catalog must print the
    // SAME NAME there.
    let checked = 0;
    for (const id of Object.keys(M.printed)) {
      const authored = programFor(id)?.attack;
      if (authored === undefined) continue;
      const fixture = FIXTURE_POOL[id];
      const printed = M.printed[id];
      for (const key of Object.keys(authored)) {
        const index = Number(key);
        const carried = (fixture?.attacks ?? [])[index];
        expect(carried, `${id} authors attack ${index} and the fixture has none there`).toBeDefined();
        expect(printed?.attacks[index], `${id} authors attack ${index} and the card prints none there`).toBeDefined();
        expect(carried?.name, `${id} attack ${index}`).toBe(printed?.attacks[index]);
        checked++;
      }
    }
    // The sweep read something — an empty registry would satisfy the loop above.
    expect(checked).toBeGreaterThan(0);
  });
});

describe("(e) every catalog count in the engine sources is MEASURED and SCOPED", () => {
  // D155's defect, made red — and made red on the right axis. The ~20 repetitions
  // were not wrong, they were SCOPELESS: 978 and 890 are both true, of a six-set
  // and a five-set catalog. So the rule is not "the number must be 890"; it is
  // "a row count must name how many sets it counted", which is D154's finding
  // stated as something a regex can check.
  const MEASURED = new Set<number>([
    M.rows,
    M.distinctNames,
    M.straightApostropheInAttacks,
    M.legalStandardZero,
    M.textColumns.effect,
    M.textColumns.attacksJson,
    M.textColumns.abilitiesJson,
    M.textColumns.any,
    ...Object.values(M.sets),
    ...Object.values(M.categories),
    // The shrunken catalog's own sub-population counts, RECORDED in the manifest
    // rather than measurable now. Kept in the allowlist because a comment written
    // during the outage may still quote them — and because dropping them would
    // make a real historical measurement read as an unmeasured number.
    M.history.shrunken.legalStandardZero,
    M.history.shrunken.rowsWithAttacks,
    M.history.shrunken.straightApostropheInAttacks,
  ]);

  it("no two catalog states agree on ROWS and disagree on SETS — the collision the Map would swallow", () => {
    // ⚠️ THE CHECK THAT REPLACED A COMPILE ERROR (D160). As an object literal this
    // table stopped compiling the day the two states coincided (TS1117), which is
    // the wrong failure: two states legitimately naming the same population is the
    // EXPECTED condition after a restore. What is a real defect is two states
    // whose row counts match and whose set counts do not — then `CATALOG_STATES`
    // has to pick one, and the sweep below silently stops enforcing the other.
    // `new Map` resolves that by last-wins, so it is asserted here instead.
    const owed = new Map<number, { sets: number; population: string }>();
    for (const state of CATALOG_STATE_LIST) {
      const seen = owed.get(state.rows);
      if (seen === undefined) {
        owed.set(state.rows, state);
        continue;
      }
      expect(
        state.sets,
        `two catalog states claim ${state.rows} rows with different set counts — "${seen.population}" owes ${seen.sets}, "${state.population}" owes ${state.sets}`,
      ).toBe(seen.sets);
    }
    // …and the derived lookup must not have lost a state to that collapse.
    expect(CATALOG_STATES.size).toBe(owed.size);
    // Both states are still DISTINCT populations today, which is what keeps the
    // sweep enforcing two numbers rather than one.
    expect(CATALOG_STATES.size).toBe(2);
    for (const sets of CATALOG_STATES.values()) expect(sets).toBeGreaterThan(0);
  });

  it("sweeps every engine source file, not a list of them", () => {
    expect(Object.keys(ENGINE_SOURCES).length).toBeGreaterThan(80);
    expect(ENGINE_SOURCES["./effects.ts"]).toBeDefined();
    expect(ENGINE_SOURCES["./testFixtures.ts"]).toBeDefined();
  });

  it("finds no count that no query produced", () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(ENGINE_SOURCES)) {
      for (const match of source.matchAll(/\b(\d{3,4}) cards\b/g)) {
        const n = Number(match[1]);
        if (MEASURED.has(n) || CATALOG_STATES.has(n) || n in NOT_A_CATALOG_COUNT) continue;
        offenders.push(`${file}: "${match[0]}" — not a measured number`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds no ROW COUNT quoted without its SET COUNT — the whole lesson, mechanised", () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(ENGINE_SOURCES)) {
      // The manifest itself and this suite are where the two states are DEFINED
      // and compared, so they are the one place a bare row count is the subject
      // rather than a provenance note.
      if (file === "./catalogManifest.ts" || file === "./catalogManifest.test.ts") continue;
      for (const match of source.matchAll(/\b(\d{3,4}) cards(?: \/ (\d+) sets)?/g)) {
        const rows = Number(match[1]);
        const expected = CATALOG_STATES.get(rows);
        if (expected === undefined) continue; // a sub-population count, not a state
        if (match[2] !== undefined && Number(match[2]) === expected) continue;
        offenders.push(`${file}: "${match[0]}" — a ${rows}-row catalog has ${expected} sets; say so`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps no dead exception — every listed non-count is still written somewhere", () => {
    const all = Object.values(ENGINE_SOURCES).join("\n");
    for (const [n, why] of Object.entries(NOT_A_CATALOG_COUNT)) {
      expect(all, `${n} is no longer written anywhere — drop its exception`).toContain(`${n} cards`);
      expect(why.length).toBeGreaterThan(30);
    }
  });

  it("the scoped form is actually written where the census comments are", () => {
    // A one-sided proof would not be one (D150): "no unscoped count" passes on a
    // file that quotes no count at all, so the scoped form must be PRESENT.
    const effects = ENGINE_SOURCES["./effects.ts"] ?? "";
    expect(effects).toContain(`${M.rows} cards / ${M.setRows} sets`);
    expect(effects.match(/\b\d{3,4} cards \/ \d+ sets/g)?.length ?? 0).toBeGreaterThan(10);
  });
});

describe("the set the catalog LOST AND GOT BACK is recorded as HISTORY", () => {
  // ⚠️ THE FINDING THIS SUITE EXISTS TO CARRY, AND D160 TURNED IT OVER. D156 could
  // only do arithmetic over numbers the repo had written down, because the
  // population it was reasoning about no longer existed to be queried. The
  // re-ingest makes one side of every one of those sums measurable again — so the
  // sums are now a RECONCILIATION between a measured present and a recorded past,
  // and they are what would catch a re-ingest that brought back the wrong rows.
  it("the restored set reconciles the shrunken catalog on FOUR independent axes", () => {
    const { contributes, shrunken } = M.history;
    expect(M.rows - contributes.rows).toBe(shrunken.rows);
    expect(M.legalStandardZero - contributes.legalStandardZero).toBe(shrunken.legalStandardZero);
    expect(M.textColumns.attacksJson - contributes.rowsWithAttacks).toBe(shrunken.rowsWithAttacks);
    expect(M.straightApostropheInAttacks - contributes.straightApostropheInAttacks).toBe(
      shrunken.straightApostropheInAttacks,
    );
    // FOUR and not one: a re-ingest of a DIFFERENT 88 rows reconciles on the row
    // count alone. This is the only check available for a population nothing can
    // query any more, so it is made on every axis the manifest records.
    expect(M.setRows - 1).toBe(shrunken.setCount);
  });

  it("the set is back in `cards`, `sets` AND `series` — a structural restore, not a filter", () => {
    // A card's `set_id` FKs to `sets` and a set's `serie_id` to `series`, so the
    // loss was a missing row in all three tables and the restore had to be a row
    // in all three. `serieRows` 1 → 2 is the `swsh` serie coming back: it is the
    // half of the restore that cannot be faked by inserting `cards` rows.
    expect(M.sets[M.history.set]).toBe(M.history.contributes.rows);
    expect(M.serieRows).toBe(2);
    expect(M.setRows).toBe(Object.keys(M.sets).length);
  });

  it("NO fixture is without a catalog row — the twelve became checkable at D160", () => {
    // The assertion that flipped. While the set was missing this read
    // `expect(M.absent.length).toBeGreaterThan(0)` and every absent id had to
    // belong to the lost set; now the population is empty and stays empty, and an
    // absence on ANY set is a finding rather than a known gap.
    expect([...M.absent]).toEqual([]);
    expect(Object.keys(M.printed).length).toBe(
      Object.keys(FIXTURE_POOL).filter((id) => REAL_ID.test(id)).length,
    );
  });

  it("names the decisions whose censuses ran against the SHRUNKEN catalog", () => {
    // ⚠️ THE RESIDUE OF THE OUTAGE, AND THE ONE THING A FUTURE SESSION MOST NEEDS.
    // The rows came back; the comments written while they were gone did not
    // change. Every count in these six decisions is a FLOOR against today's
    // catalog, and the list is asserted non-empty so it cannot be quietly dropped
    // once the episode stops feeling recent.
    expect(M.history.censusedInTheGap.length).toBeGreaterThan(0);
    expect([...M.history.censusedInTheGap]).toContain("D159");
    expect(M.history.lastSeen < M.history.firstMissing).toBe(true);
    expect(M.history.firstMissing <= M.history.restored).toBe(true);
  });
});
