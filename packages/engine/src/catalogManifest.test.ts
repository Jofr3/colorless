import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST as M } from "./catalogManifest";
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
// or `series` row for the set survives, and the main .sqlite's mtime never moved,
// so the ingest lived in a WAL that was never checkpointed. See
// `CATALOG_MANIFEST.priorState`, which is marked INHERITED because none of it
// came from a query this session could run.
//
// That reframes the two slices in front of it. D154's `FIXTURE_POOL` cards "from
// a set the D1 does not hold" were transcribed from rows that WERE there, so the
// twelve `swsh10.5` fixtures' "verbatim off the local D1" doc blocks are HONEST.
// And D155's downward corrections of §D149's "5 printings" and §D151's "six rows"
// are wrong: both counted a real catalogued card that this file has since lost.
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

/** (c) Real-card fixtures with NO catalog row IN THE FILE AS IT STANDS — D154's
    population, enumerated here for the first time. All twelve are `swsh10.5`.

    ⚠️ AND THE RIGHT READING IS THE OPPOSITE OF THE OBVIOUS ONE. Seven carry a doc
    block saying the card is "VERBATIM off the local D1", some down to a byte count
    of the effect string. Those claims are TRUE: the set was in this database when
    they were written (`CATALOG_MANIFEST.priorState`), and it is gone now. The
    fixtures are not unverified transcriptions — they are the only surviving copy
    of eighty-eight catalog rows.

    What the list therefore enumerates is EXPOSURE, not error: every census run
    since 2026-08-03 is blind to these twelve cards and to the 76 more that never
    reached the pool, so a "this is the whole mapped set" claim made against
    today's file can UNDERCOUNT. Re-ingesting `swsh10.5` is priced on the
    remainder list; this table is what makes the gap impossible to forget. */
const NO_CATALOG_ROW: Record<string, string> = {
  "swsh10.5-009": "Charmeleon — the swsh-era SPELLED-OUT discard notation (D43).",
  "swsh10.5-010": "Charizard — Charmeleon's twin on the same spelled-out notation.",
  "swsh10.5-018": "Radiant Blastoise — 'Pump Shot', a registry-authored Ability.",
  "swsh10.5-022": "Gyarados — 'Wreak Havoc', the second `programPerHeads` printing (D130).",
  "swsh10.5-025": "Wimpod — 'Punk Out', the tenth retreat-COST printing (D114).",
  "swsh10.5-026": "Golisopod — the multi-clause requirement witness (D125).",
  "swsh10.5-027": "Pikachu — 'Buddy Bolt', a conditional-damage clause hapax (D115).",
  "swsh10.5-031": "Mewtwo VSTAR — 'Psy Purge', the registry's second index-keyed attack (D97).",
  "swsh10.5-032": "Natu — a conditional-damage clause witness (D120).",
  "swsh10.5-035": "Sylveon — 'Wonder Flash', a conditional-damage clause witness (D120).",
  "swsh10.5-055": "Snorlax — 'Block', the only continuous retreat-lock aura in the pool (D113).",
  "swsh10.5-061": "Pidove — the SECOND printing of D149's 20 debuff, and the row that made §D149's '5 printings' and §D151's 'six rows' overcount the CATALOG (D155).",
};

/** (b)+(d) Fixtures that do not carry the whole printed card, each with the
    reason it does not. The pool is deliberately a set of SIMPLIFIED stand-ins —
    the registry keys on the ID, not on the stage or the attack list — so most of
    these are declared in the fixture's own doc block and this table is the place
    those declarations become CHECKED.

    `attacks` / `abilities` are the printed NAMES the fixture omits, `invented` a
    name the fixture carries that the card does not print, and `reindexed: true`
    marks the five fixtures where dropping a LEADING attack moved every attack
    after it — the sharpest entry in the table, because an index is exactly what
    the `attack` action and the registry's `attack` map key on, and a suite
    pinning "index 0" on such a body is pinning the wrong index while green. */
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
  //   the Ability and drop the attack.
  "sv01-096": {
    attacks: ["Joust"],
    invented: ["Bite"],
    reindexed: true,
    why: "Klefki — ONE DECLARED DEVIATION in its doc block: the real 'Joust' carries an unsimulated Tool-discard rider, so it borrows fix-attacker's plain Bite ({C}, 30) to let the lock-ON / lock-OFF pair compare the SAME printed 30.",
  },
  "sv02-089": { attacks: ["Fade Out"], why: "Spiritomb — registry passive 'Fettered in Misfortune'; the aura is the whole test and the body never attacks." },
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
  "sv01-086": { attacks: ["Miracle Force"], abilities: ["Psychic Embrace"], why: "Gardevoir ex — registry activated Ability with the counter/KO riders; same section comment." },
  "sv01-125": { attacks: ["Wild Impact"], abilities: ["Dino Cry"], why: "Koraidon ex — registry activated Ability with `endsTurn`; the attach is the test." },
  "sv01-041": { abilities: ["Fire Off"], why: "Armarouge sv01-041 — declared in its doc block: the Ability is the registry's, and 'its printed attack rides along because a fixture Pokémon that cannot attack makes an awkward Active'." },
  "sv02-140": { abilities: ["Tri Howl"], why: "Hydreigon — same declaration, and Tri Howl is usable from the Bench so the suites need it in both spots." },
  "sv01-142": { abilities: ["Rumbling Engine"], why: "Revavroom — registry activated Ability (the payment-ORDER witness)." },
  "sv01-151": { abilities: ["Nest Stash"], why: "Skwovet — registry activated Ability; its printed attack is a plain 20 kept so an Active Skwovet cannot put an unrelated effect into an Ability test." },
  "sv03-125": { abilities: ["Infernal Reign"], why: "Charizard ex — registry `onEvolve` trigger; its doc block declares `evolveFrom` as the ONE deviation and is the block that names a false verbatim banner as a defect." },
  // — the exact-N / typed discardEnergy cast (D43): TWO SIMPLIFICATIONS DECLARED IN
  //   THE SECTION COMMENTS, and the second is why these four are `reindexed`.
  "sv06.5-026": { attacks: ["Iron Smasher"], reindexed: true, why: "Slither Wing — declared: 'the cards with two printed attacks carry only the discarding one — so a fixture's `index: 0` is Slither Wing's and Koraidon's SECOND printed attack'. (Its 'Iron Smasher' also asks about the Future banner, which has no datum anywhere — D146.)" },
  "sv01-124": { attacks: ["Claw Slash"], reindexed: true, why: "Koraidon — the same declaration, same section comment." },
  "sv01-079": { attacks: ["Skill Dive"], reindexed: true, why: "Kilowattrel — declared: 'so Kilowattrel's `index: 0` is its SECOND printed attack'." },
  "sv01-032": { attacks: ["Raging Claws"], reindexed: true, why: "Arcanine ex — the same declaration, same section comment." },
  // — pre-evolutions and one deliberate Ability omission.
  "sv03-061": { attacks: ["Tail Smack"], why: "Finizen — declared: 'NO ATTACKS are carried … giving it an attack would only invite a case to use the wrong one'. It exists to be retreated in and evolved." },
  "sv06.5-039": { abilities: ["Subjugating Chains"], why: "Pecharunt ex — declared in its own doc block, which is also the block that states the standard: omit an unexercised printed field rather than 'claim a verbatim card while quietly dropping one'." },
};

/** (e) The two catalog STATES, and the set count each one owes. A census comment
    quoting a row count must say which population it means — that is exactly the
    information ~20 comments left out, and it is why "978" read as fiction to the
    slice that only had today's file to check it against. */
const CATALOG_STATES: Record<number, number> = {
  [M.rows]: M.setRows,
  [M.priorState.rows]: M.priorState.setCount,
};

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
    // D154's finding restated as an assertion, with D156's correction folded in:
    // `swsh10.5` is not one of the sets TODAY, so every census against this file
    // is blind to it — but it WAS one, so this is a live gap rather than a fact
    // about the pool's design. Re-ingesting the set makes this fail, which is the
    // day the twelve NO_CATALOG_ROW entries become checkable again.
    expect(Object.keys(M.sets).sort()).toEqual(["sv01", "sv02", "sv03", "sv06.5", "sve"]);
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
    // Every Pokémon row carries attacks and nothing else does — the reason
    // `attacks_json`-only censuses (D129/D130's "cards with attacks") have a
    // denominator of their own.
    expect(attacksJson).toBe(M.categories.Pokemon);
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
  it("names every reindexed fixture, and no other", () => {
    const shifted = Object.keys(M.printed).filter((id) => {
      const names = (FIXTURE_POOL[id]?.attacks ?? []).map((a) => a.name);
      return names.some((n, i) => M.printed[id]?.attacks[i] !== n);
    });
    const declared = Object.entries(INCOMPLETE)
      .filter(([, e]) => e.reindexed === true)
      .map(([id]) => id);
    expect(shifted.sort()).toEqual(declared.sort());
  });

  it("a registry-authored attack index always points at the attack the card prints there", () => {
    // The consequence that would actually be a BUG rather than a hazard: the
    // registry authors programs BY INDEX, so a reindexed fixture with a registry
    // `attack` row would run the wrong program. None exists today — asserted, not
    // assumed, so the day one lands this is what says so.
    for (const [id, entry] of Object.entries(INCOMPLETE)) {
      if (entry.reindexed !== true) continue;
      const fixture = FIXTURE_POOL[id];
      expect(fixture, id).toBeDefined();
      expect((fixture?.attacks ?? []).length, `${id} carries more than one attack`).toBeLessThanOrEqual(1);
    }
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
    // Inherited, and marked as such in the manifest: the six-set catalog's own
    // sub-population counts, which is what §D129/§D130 and §D137 quote.
    M.priorState.legalStandardZero,
    M.priorState.rowsWithAttacks,
    M.priorState.straightApostropheInAttacks,
  ]);

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
        if (MEASURED.has(n) || n in CATALOG_STATES || n in NOT_A_CATALOG_COUNT) continue;
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
        const expected = CATALOG_STATES[rows];
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
    expect(effects).toContain(`${M.priorState.rows} cards / ${M.priorState.setCount} sets`);
    expect(effects.match(/\b\d{3,4} cards \/ \d+ sets/g)?.length ?? 0).toBeGreaterThan(10);
  });
});

describe("the set the catalog LOST is recorded, not silently absent", () => {
  // ⚠️ THE FINDING THIS SUITE EXISTS TO CARRY. Everything below is arithmetic over
  // numbers the repo already wrote down, checked against numbers this session
  // measured — which is the only kind of evidence available for a population that
  // no longer exists to be queried.
  it("the missing set reconciles all three counts the docs quote", () => {
    expect(M.rows + M.priorState.missingRows).toBe(M.priorState.rows);
    expect(M.legalStandardZero + M.priorState.missingRows).toBe(M.priorState.legalStandardZero);
    expect(M.setRows + 1).toBe(M.priorState.setCount);
  });

  it("the set is gone from `cards`, `sets` AND `series` — a structural loss, not a filter", () => {
    expect(M.sets[M.priorState.missingSet]).toBeUndefined();
    // One serie row (`sv`) for five sets: a `swsh10.5` set would have needed a
    // `swsh` serie, and the FK chain means its absence is checkable from the
    // counts alone.
    expect(M.serieRows).toBe(1);
    expect(M.setRows).toBe(Object.keys(M.sets).length);
  });

  it("every fixture with no catalog row belongs to exactly that set", () => {
    // The two facts are one fact. If a future absence appears on a DIFFERENT set,
    // this is what refuses to let it be filed under the same explanation.
    for (const id of M.absent) expect(id.startsWith(`${M.priorState.missingSet}-`)).toBe(true);
    expect(M.absent.length).toBeGreaterThan(0);
  });
});
