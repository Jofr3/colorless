import { describe, expect, it } from "vitest";
import { passivesOf, seatPreWRDamageBonus } from "./continuous";
import type { GameEvent, GameState, Seat } from "./index";
import { applyAction, programFor, redactGame } from "./index";
import { attackerPreWRBonus } from "./interpreter";
import {
  FIXTURE_POOL,
  SEAT_AURA_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.158.0 → 0.159.0 — D243, BACKLOG ROW 14-B(b): THE SEAT-WIDE PRE-W/R DAMAGE
// AURA. A second consecutive ABILITY-column slice, and the first pre-W/R bonus in
// this engine whose SOURCE and BENEFICIARY are different bodies.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RE-DERIVATION — the count holds, and THE ROW'S NAMED HALF IS UNBUILDABLE.
// ─────────────────────────────────────────────────────────────────────────────
//
// Row 14-B(b) (`coverage-backlog-legal.md`, written by D242) says **6** — the
// `Future` group — and names the 3-printing Serperior sentence as its "cheapest
// entry point", on the expectation that once the aura exists the Future version
// becomes a RIDER on it. The resume point wrote that down as a prediction: *"the
// count re-derives at 3 on 1 sentence for the bare version and 6 on 1 for the
// Future version … `BUILT.ability` 100 → 109 if both land."*
//
// The query, re-run against the remote D1 `luminous`
// (735f0fb5-cdc3-494d-8b97-74a8ade0124a) over MCP on 2026-08-06, GROUPED BY
// SENTENCE and swept across ALL THREE text columns (`abilities_json`,
// `attacks_json`, `effect` — D205's rule, and here it earns its keep):
//
//   SELECT 'ability', json_extract(j.value,'$.effect') AS sent, COUNT(*),
//          group_concat(c.id)
//     FROM cards c, json_each(c.abilities_json) j
//    WHERE c.legal_standard = 1
//      AND lower(json_extract(j.value,'$.effect')) LIKE '%more damage to your opponent%'
//    GROUP BY 1,2   UNION ALL  …the same over attacks_json and effect…
//
// ✅ **THE COUNT RE-DERIVES TO THE DIGIT FOR THE TENTH ROW RUNNING**: the bare
// Serperior sentence is **3 on 1 sentence** (`sv10.5b-003`/`-156`/`-164`) and the
// Future sentence is **6 on 1** (`svp-146`/`sv05-081`/`-191`/`-206`/`-216`/
// `sv08.5-158`), both exactly as written.
//
// 🛑 **AND THE PREDICTION'S PREMISE IS FALSE: THE `Future` HALF CANNOT BE A RIDER
// ON THIS FIELD, OR ON ANY FIELD, TODAY.** `beneficiary` is a `CardFilter`, and
// every member of that union reads an INGESTED COLUMN. The Ancient/Future banner
// is printed on the card FACE and appears in NO column — D146 found it, D204/D205
// re-found it as *"every occurrence is DEMAND, the SUPPLY side is absent"*, and
// this slice re-verified it at HEAD rather than inheriting it:
//
//   SELECT suffix, COUNT(*) FROM cards WHERE legal_standard = 1 GROUP BY 1;
//     → NULL 1668 ·  ex 353          (two values; no banner column at all)
//
// So the by-name exemption ("except any Iron Crown ex") is expressible today and
// the SUBGROUP it exempts from is not. **The sentence is blocked on the INGEST,
// not on this field**, and no amount of engine work moves it. 🆕 **A "CHEAPEST
// ENTRY POINT" IS A CLAIM ABOUT WHAT COMES AFTER IT, AND IT ROTS LIKE ANY OTHER:**
// the entry point was priced correctly and the thing it was an entry TO was
// already known-unbuildable, in this repo's own comments, two decisions earlier.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT REPLACED IT — the rider proof, on a subgroup the catalog CAN answer.
// ─────────────────────────────────────────────────────────────────────────────
//
// The same sweep returned SEVEN sentences of this aura in the legal ability
// column, **16 printings**, of which the row named two. Ranked, with the split
// this slice ships:
//
//   6  BLOCKED "…your **Future** Pokémon, except any Iron Crown ex, do 20 more…"
//   3  ✅ BUILT "Attacks used by your Pokémon do 20 more damage…"      Serperior ex
//   2  ✅ BUILT "…your **Cynthia's** Pokémon do 30 more damage…"       Roserade
//   2  ✅ BUILT "…your **Hop's** Pokémon do 30 more…doesn't stack."    Snorlax
//   1  DEFERRED "…your **{G} Pokémon and {R} Pokémon** do 20 more…"    `sv09-007`
//   1  DEFERRED "…your **Evolution {R}** Pokémon do 10 more…"          `sv08-021`
//   1  DEFERRED "…do 30 more damage to your opponent's **Active Evolution** …"  `sv07-038`
//
// **7 of 16.** The three deferred singles are measured into the backlog page: the
// first two need a `CardFilter` this union cannot spell (a DISJUNCTION of types,
// and `typedPokemon.stage` which admits only `"basic"`), the third narrows the
// TARGET rather than the beneficiary and is a different seam entirely.
//
// ⚠️ **THE OWNER-PREFIXED PAIR IS THE RIDER PROOF THE `Future` PAIR WAS MEANT TO
// BE**, and it is a better one: it exercises `beneficiary` on a datum that exists,
// on FOUR printings rather than six, using D200's `ownerPokemon` filter rather
// than a second spelling of the same possessive.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE MECHANISM — and why it is NOT the field one line above it.
// ─────────────────────────────────────────────────────────────────────────────
//
// Every pre-W/R bonus this engine has (`damageBonusBeforeWR`,
// `damageBonusBeforeWRIf`, `damageBonusBeforeWRIfTarget`) is folded by
// `passivesOf(attacker)` and modifies its HOLDER alone. That is correct for a Tool
// ("the Pokémon this card is attached to") and for "attacks used by THIS Pokémon".
// It is wrong here by one word: the printed subject is **your Pokémon**, so the
// source is one body and the beneficiaries are the whole seat. The shape is
// `seatDamageReductionAfterWR`'s — Hariyama's aura, one §8.5 step later and on the
// other sign — and the new scan is the aura family's TENTH member.
//
// ⚠️ **READ SITES PRICED BY GREPPING THE FUNCTION, AND COUNTED HERE RATHER THAN
// ESTIMATED** (D240's rule; D242's prediction named the wrong `redact.ts`
// function). The resume point predicted "TWO read sites, `attackerPreWRBonus` and
// nothing else". **It is ONE, and the other seven are measured zeroes:**
//   1. `attackerPreWRBonus` (interpreter.ts) — **NON-ZERO**, one summed term. The
//      attacker's card is resolved INSIDE it, so both of its callers take a byte
//      -identical diff.
//   2. `attack.ts`'s main hit — **ZERO**: it calls site 1. Predicted non-zero.
//   3. `snipeActive` (interpreter.ts) — **ZERO**: same.
//   4. the interpreter's other damage sites (`spreadDamage`, `placeSnipe`) —
//      **ZERO, and structurally correct rather than merely untouched**: the printed
//      clause says "to your opponent's ACTIVE Pokémon", and those two are the
//      bench-reaching sites. They never folded this family and still must not.
//   5. `passivesOf` — **ZERO BY CONSTRUCTION, and the design claim**: the field is
//      deliberately outside that loop, which is why its own enumeration of
//      not-folded fields moved from ELEVEN to TWELVE in the same commit.
//   6. `log.ts` `DAMAGE_DEALT.bonus` — **ZERO**: the number lands INSIDE site 1's
//      return, so the existing field already carries it (contrast
//      `boostedAttackDamage`, summed at the site because it must survive a §9 lock).
//   7. `redact.ts` — **ZERO, and the FUNCTIONS are named**: `redactedAbilitiesOf`
//      enumerates ACTIVATED abilities and a `passive` has nothing to activate;
//      `redactedAttacksOf` reports COST and payability, and a damage number is not
//      a payability fact. ✅ The resume point predicted ZERO here and it HOLDS —
//      after losing twice in the opposite direction.
//   8. `GameHud.tsx` / `projection.ts` — **ZERO**: neither renders a damage total.
//   9. `MATCH_RECORD_VERSION` — **NO BUMP, measured**: this is a CATALOG fact
//      re-derived from the board on every read and persisted nowhere.

const REGAL_CHEER_TEXT =
  "Attacks used by your Pokémon do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
const CHEER_ON_TEXT =
  "Attacks used by your Cynthia's Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
const EXTRA_HELPINGS_TEXT =
  "Attacks used by your Hop's Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). The effect of Extra Helpings doesn't stack.";

const SEED = 43;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup on P1's turn 3 (two passes past the §4 first-turn ban), both benches
    emptied and both Active spots normalised to the inert `fix-basic-1`, so every
    board below is exactly what its own surgeries put on it (D242's idiom, and
    load-bearing for the same reason: four of this deck's Basics carry Abilities
    and one of them is a §9 LOCK that would silence the slice if it started). */
function board(): GameState {
  let state = driveSetup(SEED, { p1: SEAT_AURA_DECK, p2: SEAT_AURA_DECK }, { first: "p1" });
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = clearBench(setActiveFromDeck(state, "p1", "fix-basic-1"), "p1");
  return clearBench(setActiveFromDeck(state, "p2", "fix-basic-1"), "p2");
}

/** P1 attacks with `attacker`; `benched` sources sit on P1's Bench beside it. One
    Energy attached, which every fixture attack in this cast costs. */
function attackingWith(attacker: string, ...benched: string[]): GameState {
  let state = clearBench(setActiveFromDeck(board(), "p1", attacker), "p1");
  for (const id of benched) state = benchFromDeck(state, "p1", id);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The damage P1's Active actually deals, off a real declaration. Every attacker
    in this cast prints a base of 50, so the delta from 50 IS the aura. */
function dealt(state: GameState): { base?: number; bonus?: number; dealt?: number } {
  const hit = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const event = find(hit.events, "DAMAGE_DEALT");
  return { base: event?.base, bonus: event?.bonus, dealt: event?.dealt };
}

function activeOf(state: GameState, seat: Seat) {
  const spot = state.players[seat].active;
  if (spot === null) throw new Error(`${seat} has no Active`);
  return spot;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE SEVEN REGISTRY ROWS — three programs, and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — the seven registry rows", () => {
  const BARE = ["sv10.5b-003", "sv10.5b-156", "sv10.5b-164"] as const;
  const CYNTHIA = ["sv10-008", "sv10-184"] as const;
  const HOP = ["svp-184", "sv09-117"] as const;

  it("authors all THREE bare printings as the aura and NOTHING else", () => {
    for (const id of BARE) {
      const program = programFor(id);
      expect(program?.passive).toEqual({ seatDamageBonusBeforeWR: { amount: 20 } });
      // 🛑 NOT the field one line above it in `PassiveEffects`. A build that
      // reached for `damageBonusBeforeWR` would pass every board on which the
      // Serperior itself attacks and fail every board the card is actually played
      // for — so the negative is asserted, not assumed.
      expect(program?.passive?.damageBonusBeforeWR).toBeUndefined();
      expect(program?.attack).toBeUndefined();
      expect(program?.abilities).toBeUndefined();
    }
  });

  it("authors the FOUR owner-prefixed printings with a BENEFICIARY narrowing", () => {
    for (const id of CYNTHIA) {
      expect(programFor(id)?.passive?.seatDamageBonusBeforeWR).toEqual({
        amount: 30,
        beneficiary: { kind: "ownerPokemon", owner: "Cynthia" },
      });
    }
    for (const id of HOP) {
      expect(programFor(id)?.passive?.seatDamageBonusBeforeWR).toEqual({
        amount: 30,
        beneficiary: { kind: "ownerPokemon", owner: "Hop" },
        noStack: "Extra Helpings",
      });
    }
  });

  it("the seven are SEVEN — the count the backlog cell must match", () => {
    const ids = [...BARE, ...CYNTHIA, ...HOP];
    expect(ids.length).toBe(7);
    expect(new Set(ids).size).toBe(7);
    for (const id of ids) expect(programFor(id)?.passive?.seatDamageBonusBeforeWR).toBeDefined();
  });

  it("🛑 the SIX `Future` printings are STILL unbuilt, and the reason is the INGEST", () => {
    // The row's named half, re-asserted as UNBUILT rather than quietly dropped.
    // This is not a vacuous absence check (conventions: "these ids are unbuilt is
    // nearly always true") — it is paired with the POSITIVE seven above, off the
    // same field, so the pair can only both pass if the slice built exactly the
    // sentences whose subgroup the catalog can answer.
    for (const id of ["svp-146", "sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158"]) {
      expect(programFor(id)).toBeUndefined();
    }
    // The mechanism itself is NOT what blocks them: the field is in place and the
    // amount is identical (20). What is missing is a `CardFilter` member that can
    // name the banner, and no `CardFilter` member reads anything but a column.
    expect(programFor("sv10.5b-003")?.passive?.seatDamageBonusBeforeWR?.amount).toBe(20);
  });

  it("the fixture demonstrators carry the printed bytes VERBATIM", () => {
    expect(FIXTURE_POOL["fix-regalcheer"]?.abilities?.[0]?.effect).toBe(REGAL_CHEER_TEXT);
    expect(FIXTURE_POOL["fix-cynthia-aura"]?.abilities?.[0]?.effect).toBe(CHEER_ON_TEXT);
    expect(FIXTURE_POOL["fix-hop-aura"]?.abilities?.[0]?.effect).toBe(EXTRA_HELPINGS_TEXT);
    // …and each fixture maps to the SAME program object as its real printings, so
    // every board below is testing the authored row and not a fixture-only copy.
    expect(programFor("fix-regalcheer")).toBe(programFor("sv10.5b-003"));
    expect(programFor("fix-cynthia-aura")).toBe(programFor("sv10-008"));
    expect(programFor("fix-hop-aura")).toBe(programFor("svp-184"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE SCAN — the source set, and the one thing it does NOT do.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — `seatPreWRDamageBonus`, the seat-wide scan", () => {
  it("pays from the BENCH — the whole reason this is not a `passivesOf` fold", () => {
    const state = attackingWith("fix-plain-body", "fix-regalcheer");
    const attacker = activeOf(state, "p1");
    // 🛑 THE CENTRAL CLAIM. The source is on the Bench and the beneficiary is in
    // the Active Spot; `passivesOf` folds the ATTACKER's own body and answers 0,
    // and the scan answers 20. A build that used the field one line up would have
    // both numbers at 0 and every damage case below would still be green at 50.
    expect(passivesOf(state, attacker).damageBonusBeforeWR).toBe(0);
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(20);
  });

  it("is SELF-INCLUSIVE — 'your Pokémon' is not 'your OTHER Pokémon'", () => {
    const state = attackingWith("fix-regalcheer");
    expect(state.players.p1.bench.length).toBe(0);
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-regalcheer"])).toBe(20);
  });

  it("SUMS its sources — two copies in play are two printed Abilities", () => {
    const two = attackingWith("fix-plain-body", "fix-regalcheer", "fix-regalcheer");
    expect(seatPreWRDamageBonus(two, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(40);
    const three = attackingWith(
      "fix-plain-body",
      "fix-regalcheer",
      "fix-regalcheer",
      "fix-regalcheer",
    );
    expect(seatPreWRDamageBonus(three, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(60);
  });

  it("is SEAT-RELATIVE — the opponent's aura pays the opponent and never you", () => {
    let state = attackingWith("fix-plain-body");
    state = benchFromDeck(state, "p2", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
    expect(seatPreWRDamageBonus(state, "p2", FIXTURE_POOL["fix-plain-body"])).toBe(20);
  });

  it("reads the STACK TOP, so an unevolved body under an aura pays nothing", () => {
    // Only a TOP card grants a printed Ability. `benchFromDeck` puts a fresh body
    // on the bench, so the control here is the body that is NOT an aura source.
    const state = attackingWith("fix-plain-body", "fix-basic-1");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE BENEFICIARY NARROWING — the rider seam, on a subgroup that exists.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — `beneficiary`, the printed narrowing", () => {
  it("pays a prefixed ATTACKER and REFUSES an unprefixed one, off one source", () => {
    // 🛑 THE NON-VACUOUS PAIR. Both boards carry the identical Roserade on the
    // Bench and differ only in WHO is attacking, so the only thing that can move
    // the number is `beneficiary` being read at all.
    const prefixed = attackingWith("fix-cynthia-body", "fix-cynthia-aura");
    expect(seatPreWRDamageBonus(prefixed, "p1", FIXTURE_POOL["fix-cynthia-body"])).toBe(30);
    const plain = attackingWith("fix-plain-body", "fix-cynthia-aura");
    expect(seatPreWRDamageBonus(plain, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
  });

  it("🛑 filters the BENEFICIARY and NOT the SOURCE — the reading no legal board shows", () => {
    // On every real printing the source is itself in the subgroup, so "filter the
    // attacker" and "filter both" agree on the whole catalog. The separating board
    // is a BARE aura beside a prefixed one: an implementation that also filtered
    // the source would drop the Serperior's 20 when a `Cynthia's ` body attacks,
    // because a Serperior is not a `Cynthia's ` Pokémon.
    const state = attackingWith("fix-cynthia-body", "fix-cynthia-aura", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-cynthia-body"])).toBe(50);
  });

  it("the two owner subgroups are DISJOINT — Hop's aura ignores Cynthia's body", () => {
    const state = attackingWith("fix-cynthia-body", "fix-hop-aura");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-cynthia-body"])).toBe(0);
  });

  it("an undefined attacking card fails every filter and keeps every bare aura", () => {
    // `stadiumPreventsDamage`'s conservative direction: no resolvable card is not
    // a match. The bare aura still pays, because it asks nothing of the attacker.
    const state = attackingWith("fix-cynthia-body", "fix-cynthia-aura", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", undefined)).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. `noStack` — the one printed sentence that overrides the summing rule.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — 'The effect of Extra Helpings doesn't stack.'", () => {
  it("caps a repeated source at ONE contribution where the bare aura SUMS", () => {
    const two = attackingWith("fix-plain-body", "fix-hop-aura", "fix-hop-aura");
    // The attacker is unprefixed, so first prove the aura is live at all on ONE.
    expect(seatPreWRDamageBonus(two, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
    const capped = attackingWith("fix-cynthia-body", "fix-hop-aura", "fix-hop-aura");
    expect(seatPreWRDamageBonus(capped, "p1", FIXTURE_POOL["fix-cynthia-body"])).toBe(0);
    // …now on a HOP'S attacker, where the clause actually bites. The control is
    // the bare aura three lines up, which sums to 40 on the same shaped board.
    let state = clearBench(setActiveFromDeck(board(), "p1", "fix-hop-aura"), "p1");
    state = benchFromDeck(state, "p1", "fix-hop-aura");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(30);
    state = benchFromDeck(state, "p1", "fix-hop-aura");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(30);
  });

  it("does NOT cap a DIFFERENT aura — the key is the printed Ability NAME", () => {
    // 🛑 WHY `noStack` IS A STRING AND NOT A BOOLEAN. Two Snorlax are 30; a
    // Snorlax beside a Serperior is 30 + 20, because "the effect of Extra
    // Helpings" names one Ability and says nothing about anyone else's.
    let state = clearBench(setActiveFromDeck(board(), "p1", "fix-hop-aura"), "p1");
    state = benchFromDeck(state, "p1", "fix-hop-aura");
    state = benchFromDeck(state, "p1", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. §9 — the channel claim, driven on the printing that can carry it.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — a §9 ABILITY-LOCK silences the aura", () => {
  it("Klefki drops the source's contribution and leaves the rest standing", () => {
    // 🛑 D242's PRECEDENT, DRIVEN. All seven printings are printed Pokémon
    // ABILITIES, so a lock must silence them — which is free because the scan
    // consults `disabledAbilityUids`, and wrong-and-silent for a build that read
    // `programFor(top.id)` and stopped there.
    //
    // ⚠️ EVERY SOURCE IN THIS CAST IS SILENCED AT ONCE, AND THAT IS THE FIXTURES'
    // SHAPE RATHER THAN THE PRINT'S — SAID OUT LOUD BECAUSE THE FIRST DRAFT OF
    // THIS CASE ASSERTED THE OPPOSITE AND WENT RED. Klefki's "Mischievous Lock"
    // reaches BASIC Pokémon only, and every fixture here is a `battler`, hence a
    // Basic. In the CATALOG only Hop's Snorlax is one (`sv09-117`, 150 HP);
    // Serperior ex is a Stage 2 ex and Cynthia's Roserade a Stage 1, and no lock
    // this pool fields reaches either. So the claim this case actually carries is
    // "the scan consults `disabledAbilityUids`", and the printing it is TRUE of on
    // a real board is the Snorlax.
    let state = clearBench(setActiveFromDeck(board(), "p1", "fix-hop-aura"), "p1");
    state = benchFromDeck(state, "p1", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(50);
    // Klefki into the OPPONENT's Active Spot — its lock reaches both sides' Basics.
    state = setActiveFromDeck(state, "p2", "sv01-096");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(0);
    // 🛑 THE CONTROL THAT STOPS THIS BEING "A KLEFKI IS IN PLAY, THEREFORE ZERO".
    // Mischievous Lock carries `requiresActive`, so retiring the Klefki to the
    // Bench lifts it and every source comes back — which a build that merely
    // checked for the lock CARD, rather than asking `disabledAbilityUids` per
    // source uid, would get wrong in exactly this direction.
    state = setActiveFromDeck(state, "p2", "fix-basic-1");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(50);
  });

  it("the lock reaches a BENCHED source too, not only the Active one", () => {
    let state = clearBench(setActiveFromDeck(board(), "p1", "fix-plain-body"), "p1");
    state = benchFromDeck(state, "p1", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(20);
    state = setActiveFromDeck(state, "p2", "sv01-096");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE READ SITE — one summed term, and the damage that actually lands.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — `attackerPreWRBonus` and the §8.5 pipeline", () => {
  it("folds the aura into the ONE shared pre-W/R number", () => {
    const state = attackingWith("fix-plain-body", "fix-regalcheer");
    const defender = activeOf(state, "p2");
    const defenderCard = FIXTURE_POOL[state.cardIdByUid[defender.stack[0] ?? ""] ?? ""];
    if (defenderCard === undefined) throw new Error("no defender card");
    expect(attackerPreWRBonus(state, activeOf(state, "p1"), "p1", defenderCard)).toBe(20);
  });

  it("a real declaration deals base + aura, reported in `DAMAGE_DEALT.bonus`", () => {
    // 🛑 THE END-TO-END NON-VACUOUS PAIR: the same attacker, the same 50 base, the
    // only difference being one benched Serperior. If the read site were dropped
    // the two rows would be identical and this case is the one that goes red.
    expect(dealt(attackingWith("fix-plain-body"))).toEqual({
      base: 50,
      bonus: undefined,
      dealt: 50,
    });
    expect(dealt(attackingWith("fix-plain-body", "fix-regalcheer"))).toEqual({
      base: 50,
      bonus: 20,
      dealt: 70,
    });
  });

  it("the owner narrowing survives to the DEALT number, both ways", () => {
    expect(dealt(attackingWith("fix-cynthia-body", "fix-cynthia-aura")).dealt).toBe(80);
    expect(dealt(attackingWith("fix-plain-body", "fix-cynthia-aura")).dealt).toBe(50);
  });

  it("REFUSES to touch the WIRE projection — a damage total is not a payability fact", () => {
    // Read site 7, driven rather than asserted in prose. The attack row on the
    // wire is byte-identical with and without the aura: `redactedAttacksOf`
    // reports cost and playability, `redactedAbilitiesOf` reports ACTIVATED
    // abilities and a `passive` has none.
    const withAura = redactGame(attackingWith("fix-plain-body", "fix-regalcheer"), "p1");
    const without = redactGame(attackingWith("fix-plain-body"), "p1");
    if (withAura.phase.kind !== "turn:action" || without.phase.kind !== "turn:action") {
      throw new Error("expected turn:action");
    }
    expect(withAura.phase.attacks).toEqual(without.phase.attacks);
    expect(withAura.phase.abilities).toEqual([]);
    expect(without.phase.abilities).toEqual([]);
    // The non-vacuous control: the row is not empty, so "equal" is not "both blank".
    expect(withAura.phase.attacks.length).toBe(1);
    expect(withAura.phase.attacks[0]?.playable).toBe(true);
  });

  it("does NOT reach the BENCH — the printed target clause is 'your opponent's ACTIVE'", () => {
    // The three bench-reaching damage sites never folded this family and still do
    // not. Driven through the one path this cast can reach: the aura is live, and
    // the number that moved is the Active's alone.
    //
    // ⚠️ P2's ACTIVE IS THE 150 HP BODY AND NOT THE 60 HP DEFAULT, because 50 + 20
    // KNOCKS OUT a `fix-basic-1` and the Active spot then reads `null` — the first
    // draft of this case asserted `damage` on a body the attack had removed. P2's
    // own Hop's aura is inert here: it pays P2's attacks, and P2 is not attacking.
    let state = attackingWith("fix-plain-body", "fix-regalcheer");
    state = clearBench(setActiveFromDeck(state, "p2", "fix-hop-aura"), "p2");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    const hit = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const damaged = hit.state.players.p2;
    expect(damaged.active?.damage).toBe(70);
    expect(damaged.bench.length).toBe(1);
    expect(damaged.bench.every((b) => b.damage === 0)).toBe(true);
  });

  it("an empty board answers ZERO rather than throwing", () => {
    const state = attackingWith("fix-plain-body");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });
});
