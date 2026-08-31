import { describe, expect, it } from "vitest";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import { disabledAbilityUids } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  SELF_SCALING_PENALTY_DECK,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// 0.108.0 → 0.109.0 — the SELF-SCALING DAMAGE PENALTY (P3-M5 long tail, D163),
// the LAST unread rows of §D147's thirty-one-printing `less damage` census:
//
//   "This attack does 10 less damage for each damage counter on this Pokémon."
//        (Skeledirge ex sv02-037/-233/-258/-272 "Burning Voice", idx 1, "270-")
//   "This attack does 20 less damage for each damage counter on this Pokémon."
//                     (Cetitan sv01-060 "Sweeping Tackle", idx 1, "200-")
//
// ⚠️ TWO POPULATIONS, SWEPT SEPARATELY (D156's rule), AND THE COUNTS ARE
// MEASUREMENTS. The local D1 (2026-08-03, 978 rows / 6 sets — sv01 258, sv02 279,
// sv03 230, sv06.5 99, sve 24, swsh10.5 88) returns FIVE rows for
// `LIKE '%less damage for each%'` across all three text columns, and all five are
// `attacks_json`: the four Skeledirge ex rarities and Cetitan. `FIXTURE_POOL` (289
// entries AT D163; 293 since D167 added the multiply twin's two bodies) is a
// different population that also fields synthetic `fix-*` bodies the
// catalog will never hold; swept for the same string it returned ONE row before
// this slice — sv02-037's "Burning Voice", carried verbatim by D133's board-heal
// fixture since 0.94.0 and never read by anything.
//
// ⚠️ THE INHERITED "5 printings / 3 sentences" IS WRONG ON ITS SECOND FIGURE, IN
// THREE PLACES. `simulator.md` carries it at §D147, at §D149 and in "Still unmapped
// after D161", and the pool prints exactly TWO distinct sentences (10-less and
// 20-less), which one `(\d+)` capture spans. Five printings is exact. A count
// copied forward rather than re-queried — the standing shape, on the sentence
// figure rather than the printing figure this time.
//
// ⚠️ AND THE PRICING IT ARRIVED WITH — "it may be ONE REGEX AND A SIGN" — IS RIGHT
// ABOUT THE REGEX AND WRONG ABOUT WHERE THE SIGN GOES. `deriveAttackDamageBonus`
// really does express the positive direction of this exact clause
// (SELF_COUNTER_SCALE, the "more" twin, read since M2), and the count evaluator,
// the fold site, the clamp and the reported field all pre-existed. But `per` cannot
// simply go negative, because the field the additive fold reports through
// (`DAMAGE_DEALT.scaled`) is DIRECTION-COMMITTED AT BOTH OF ITS CONSUMERS: it is
// emitted only when `scaledTotal > 0`, so a negative would vanish from the row
// entirely, and log.ts renders it ` · scaled +${n}`, so a surviving negative would
// print "+-40". The number therefore lands in `debuff` — the pre-W/R SUBTRACTION
// field D149 created for exactly this direction at exactly this step — and the
// reader is a THIRD function beside the additive and multiply ones, which is how
// this family already splits (by FOLD, over one shared `{per, count}` interface and
// one shared count evaluator).
//
// ⚠️ ONE MECHANISM, AND THE READ SITES SAY SO RATHER THAN STYLE (D155's test). The
// two printed sentences differ in ONE captured digit run: same reader, same count
// source, same fold, same field, same crumb, same §9 answer. Against its "more"
// twin it is one mechanism SPLIT by the only consumer that can tell them apart —
// the event row — which is the same test answering the other way.

/** The two printed sentences, byte-for-byte off the local D1 rows (2026-08-03,
    978 rows / 6 sets). */
const BURNING_VOICE = "This attack does 10 less damage for each damage counter on this Pokémon.";
const SWEEPING_TACKLE = "This attack does 20 less damage for each damage counter on this Pokémon.";
/** The "more" twin, printed on seven catalog rows and read since M2 — the sentence
    this slice's regex must refuse and whose reader must refuse this slice's. */
const RAGING_HORNS = "This attack does 10 more damage for each damage counter on this Pokémon.";
/** The multiply twin on the SAME count source — no adjective at all (Drifloon
    sv01-089 idx 1 "Balloon Blast" 30×, Onix swsh10.5-036 idx 1 "Raging Swing" 50×).
    Two printings, UNREAD when this suite was written and pinned here as an absence
    so the day someone added them to `deriveAttackDamageMultiplier` this suite would
    say the family had moved. **D167 is that day** — the pin below is re-pointed to
    the presence, and `selfCounterMultiply.test.ts` drives the fold. This constant
    stays because the DISJOINTNESS cases still need it. */
const BALLOON_BLAST = "This attack does 30 damage for each damage counter on this Pokémon.";

/** One seed for the whole suite: nothing in this family flips a coin and every
    Active is placed by surgery, so a seed table would describe a shuffle rather
    than a rule (D143's move, D147's inheritance). */
const SEED = 5;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Every attacker this suite declares, with the printed INDEX and the energy its
    cost needs — read off the local D1 per printing (D144's rule). */
const ATTACKERS = {
  cetitan: {
    card: "sv01-060",
    index: 1,
    energy: [
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
  }, // "Sweeping Tackle" ({W}{C}{C}, "200-", 20 less per counter)
  "cetitan-hammer": { card: "sv01-060", index: 0, energy: [{ id: "fix-energy", count: 2 }] }, // "Hammer In" ({C}{C}, 50, NO effect key)
  skeledirge: { card: "sv02-037", index: 1, energy: [{ id: "fix-fire-energy", count: 2 }] }, // "Burning Voice" ({R}{R}, "270-", 10 less per counter)
  "skeledirge-song": { card: "sv02-037", index: 0, energy: [{ id: "fix-fire-energy", count: 1 }] }, // "Vitality Song" ({R}, 50, board heal)
  rage: { card: "fix-attacker", index: 3, energy: [{ id: "fix-energy", count: 1 }] }, // "Rage" ({C}, "10+", 10 MORE per counter)
  fury: { card: "fix-attacker", index: 4, energy: [{ id: "fix-energy", count: 1 }] }, // "Fury" ({C}, no base, 20 MORE per counter)
} as const;

type Attacker = keyof typeof ATTACKERS;

/** `by`'s opponent opens and passes, so the attacking seat carries no §4
    first-turn restriction. Both bodies are placed by surgery and BOTH benches are
    cleared: every number in this family is read off the CURRENT board at
    declaration, and a stray displaced body is a silent extra Ability source. */
function board(attacker: Attacker, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: SELF_SCALING_PENALTY_DECK, p2: SELF_SCALING_PENALTY_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKERS[attacker].card);
  state = clearBench(state, by);
  for (const { id, count } of ATTACKERS[attacker].energy) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

function swing(state: GameState, attacker: Attacker, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
}

/** The rendered log, flattened to `{ who, text }` — the shape the neighbouring
    suites read a sequence in. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The data: the catalog rows and the two Cetitans.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed data — re-queried, not recognised", () => {
  it("carries Cetitan sv01-060's WHOLE printed attack list verbatim", () => {
    expect(FIXTURE_POOL["sv01-060"]).toMatchObject({
      name: "Cetitan",
      category: "Pokemon",
      stage: "Stage1",
      evolveFrom: "Cetoddle",
      hp: 180,
      types: ["Water"],
      retreat: 3,
      weaknesses: [{ type: "Metal", value: "×2" }],
    });
    // The WHOLE list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode) and so no later slice indexes into a short one. The printed damage
    // marker is a trailing "-" — the sign this family's reader consumes.
    expect(FIXTURE_POOL["sv01-060"]?.attacks).toEqual([
      { cost: ["Colorless", "Colorless"], name: "Hammer In", damage: 50 },
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Sweeping Tackle",
        effect: SWEEPING_TACKLE,
        damage: "200-",
      },
    ]);
    expect(FIXTURE_POOL["sv01-060"]?.abilities ?? null).toBeNull();
  });

  it("…and Skeledirge ex sv02-037's, which was ALREADY COMPLETE and already carried the sentence", () => {
    // ⚠️ D159's "does the thing you need already exist?" check, run on a FIXTURE
    // rather than on a log field, and the answer is yes: D133 fielded this body for
    // the own-board heal at 0.94.0 and carried its index-1 "Burning Voice" whole —
    // effect string, "270-" marker and all — while calling it "a scaling clause
    // belonging to another family". It has sat in the pool unread ever since. This
    // slice adds no fixture for four of its five printings.
    expect(FIXTURE_POOL["sv02-037"]?.attacks).toEqual([
      {
        cost: ["Fire"],
        name: "Vitality Song",
        effect: "Heal 30 damage from each of your Pokémon.",
        damage: 50,
      },
      { cost: ["Fire", "Fire"], name: "Burning Voice", effect: BURNING_VOICE, damage: "270-" },
    ]);
  });

  it("⚠️ THE TWO CETITANS DIFFER IN NOTHING BUT THEIR ATTACKS", () => {
    // The board "verify by QUERY, never by recognition" (D146) exists for. sv02-055
    // is ALSO called Cetitan, is ALSO a 180 HP Water Stage 1 from Cetoddle with
    // retreat 3 and ×2 Metal, and prints "Icicle Missile" / "Special Horn" — the
    // Special-Energy class clause D118 built. Six printed fields agree; only the
    // attack list separates them, and a slice that reached for "the Cetitan already
    // in the pool" would have got the wrong card with every assertion passing.
    const [a, b] = [FIXTURE_POOL["sv01-060"], FIXTURE_POOL["sv02-055"]];
    for (const field of ["name", "hp", "stage", "evolveFrom", "retreat"] as const) {
      expect(a?.[field]).toEqual(b?.[field]);
    }
    expect(a?.types).toEqual(b?.types);
    expect(a?.weaknesses).toEqual(b?.weaknesses);
    expect(a?.attacks?.map((x) => x.name)).toEqual(["Hammer In", "Sweeping Tackle"]);
    expect(b?.attacks?.map((x) => x.name)).toEqual(["Icicle Missile", "Special Horn"]);
  });

  it("AUTHORS nothing — both printings are read off the TEXT", () => {
    // The deriver is the whole mechanism: no registry row, no `attack` map entry,
    // no passive. A registry-authored program would win over the reader (D8), so
    // this is the claim that says the text path is the one being driven below.
    for (const id of ["sv01-060", "sv02-037"] as const) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamagePenalty — one regex, two amounts", () => {
  it("reads BOTH printed sentences with a POSITIVE `per`", () => {
    expect(deriveAttackDamagePenalty(SWEEPING_TACKLE)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamagePenalty(BURNING_VOICE)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("is DISJOINT from its two siblings in both directions", () => {
    // The word is the whole discriminator, and each reader must refuse the others'
    // sentences or two folds would fire on one printing.
    expect(deriveAttackDamagePenalty(RAGING_HORNS)).toBeNull();
    expect(deriveAttackDamagePenalty(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackDamageBonus(SWEEPING_TACKLE)).toBeNull();
    expect(deriveAttackDamageBonus(BURNING_VOICE)).toBeNull();
    expect(deriveAttackDamageMultiplier(SWEEPING_TACKLE)).toBeNull();
    expect(deriveAttackDamageMultiplier(BURNING_VOICE)).toBeNull();
    // …and the "more" twin still reads, unchanged, on the same count source.
    expect(deriveAttackDamageBonus(RAGING_HORNS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("⚠️ AT MOST ONE of the three readers answers ANY attack in the pool", () => {
    // attack.ts reads the three scaling families in sequence and guards each on its
    // predecessors having declined — the idiom the multiply reader has carried
    // since 0.35.0. That guard is FREE: mutating it away (running the penalty
    // reader unconditionally) changes no test, because the three regexes are
    // disjoint by their adjective. It is KEPT rather than deleted, because deleting
    // it would make one of three sibling calls read differently from the other two
    // for no reason a later slice could reconstruct — and D157's rule says the fix
    // for a guard whose mutation is invisible is to write down WHY, as an
    // assertion rather than a comment. This is that assertion, swept over the whole
    // pool: every fixture, every attack, no double answer anywhere (289 fixtures
    // when this was written; 293 since D167, and the sweep never named a count —
    // which is why it kept holding).
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const text = attack.effect ?? "";
        const answers = [
          deriveAttackDamageBonus(text),
          deriveAttackDamageMultiplier(text),
          deriveAttackDamagePenalty(text),
        ].filter((x) => x !== null).length;
        expect(answers, `${id} ${attack.name}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("⚠️ the multiply twin on the same count source is the MULTIPLY reader's (D167)", () => {
    // ⚠️ RE-POINTED, NOT DELETED — and the re-pointing is the case working. Drifloon
    // sv01-089 idx 1 "Balloon Blast" (30×) and Onix swsh10.5-036 idx 1 "Raging
    // Swing" (50×) print "This attack does {N} damage for each damage counter on
    // this Pokémon." — no adjective. This case was written as an ABSENCE
    // (`deriveAttackDamageMultiplier(...)` → null) precisely so that adding the
    // regex — the whole of that item's price — would fail HERE and be noticed. D167
    // added it; this went red; the assertion flips to the PRESENCE and names the
    // reader that now owns the sentence. Its three siblings are untouched and still
    // true: THIS suite's reader, the additive reader and the op deriver must all
    // still refuse it, which is what keeps "at most one fold per printing" checked
    // from this side of the family.
    expect(deriveAttackDamageMultiplier(BALLOON_BLAST)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamagePenalty(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackDamageBonus(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackEffect(BALLOON_BLAST)).toBeNull();
  });

  it("STAYS LOUD as an op — the sentence derives no post-damage program", () => {
    // A pre-damage fold derived into a tail op would run AFTER the §8.5 pipeline
    // and could not touch a number already computed (D125's classification rule).
    for (const text of [SWEEPING_TACKLE, BURNING_VOICE]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("refuses a printed 0, and every near-miss the anchors exist for", () => {
    // The zero guard every arm in this family carries: a 0 subtracts nothing, so it
    // must stay LOUD rather than claim a simulated sentence that does nothing.
    expect(
      deriveAttackDamagePenalty("This attack does 0 less damage for each damage counter on this Pokémon."),
    ).toBeNull();
    for (const near of [
      // a lowercased first word
      "this attack does 20 less damage for each damage counter on this Pokémon.",
      // no trailing period
      "This attack does 20 less damage for each damage counter on this Pokémon",
      // leading text
      "Flip a coin. This attack does 20 less damage for each damage counter on this Pokémon.",
      // trailing text
      "This attack does 20 less damage for each damage counter on this Pokémon. Discard an Energy from this Pokémon.",
      // the DEFENDER-side count. Its "more" form is NO LONGER unread — D168 gave
      // Dedenne sv01-095, Espeon sv03-086 and Bloodmoon Ursaluna sv06.5-025 the
      // fifth `DamageCountSource` — but this "less" spelling is UNPRINTED in the
      // whole pool and stays refused: the tail is what separates the two count
      // sources, and it must go on separating them at every sign.
      "This attack does 20 less damage for each damage counter on your opponent's Active Pokémon.",
      // a real Pokémon with a lookalike é would fall off the path silently
      "This attack does 20 less damage for each damage counter on this Pokemon.",
    ]) {
      expect(deriveAttackDamagePenalty(near)).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The census, SWEPT out of the pool rather than listed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the census — discovered from the population, not enumerated", () => {
  it("🆕🆕 D438 — is exactly FOUR fixture attacks, on TWO count sources", () => {
    // D145's move (D147/D159/D161's inheritance): discover the producers by
    // deriving every attack in the pool, so a third printing added without a case
    // fails HERE.
    //
    // ⚠️ WHAT THIS SWEEP DOES NOT TRAVERSE, said rather than left: it enumerates
    // `FIXTURE_POOL`, so a CATALOG row with no fixture is invisible to it (three of
    // this family's five printings are exactly that — the Skeledirge ex rarities
    // -233/-258/-272, byte-identical rows served by one fixture), and it reads
    // ATTACK text only, so an Ability or Trainer printing of the same sentence
    // would not appear. The catalog side is crossed only by
    // `catalogManifest.test.ts`.
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const read = deriveAttackDamagePenalty(attack.effect ?? "");
        if (read !== null) found.push(`${id}[${index}] ${read.count.kind}`);
      }
    }
    // 🆕🆕 **D438 — THIS RUNG WAS THE TRIPWIRE AND IT FIRED.** It was written as a
    // DISCOVERED sweep precisely so that a third printing landing without a case
    // would redden here, and D438 is that: `deriveAttackDamagePenalty` gained a
    // second count source — `opponentActiveRetreatCost`, corpus rows 573/603,
    // *"This attack does {30|50} less damage for each {C} in your opponent's Active
    // Pokémon's Retreat Cost."* — so the demonstrator `fix-retreatless` prints two
    // more sentences this reader claims. ⚠️ **THE COUNT SOURCE IS ASSERTED BESIDE
    // THE ID, WHICH THE OLD LIST COULD NOT DO**: a build that answered the new
    // sentences with `damageCountersOnSelf` (the arm one line up, the real
    // neighbour copy) would return the identical four ids and this rung would have
    // stayed green on it. The header comment above still holds for the D163 half —
    // three of that family's five printings are byte-identical Skeledirge ex
    // rarities served by one fixture.
    expect(found.sort()).toEqual([
      "fix-retreatless[0] opponentActiveRetreatCost",
      "fix-retreatless[1] opponentActiveRetreatCost",
      "sv01-060[1] damageCountersOnSelf",
      "sv02-037[1] damageCountersOnSelf",
    ]);
  });

  it("…and the SIGN-FLIPPED TWIN's producers are asserted beside them", () => {
    // The claim this slice makes is about a PAIR of directions, so the other half
    // is swept too: a reader that started answering both would collapse these two
    // lists into one and this case would say so.
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const bonus = deriveAttackDamageBonus(attack.effect ?? "");
        if (bonus?.count.kind === "damageCountersOnSelf") found.push(`${id}[${index}]`);
      }
    }
    expect(found.sort()).toEqual([
      "fix-attacker[3]",
      "fix-attacker[4]",
      "sv01-032[0]", // Arcanine ex "Raging Claws" — carried since D173
      "sv02-028[0]",
      "sv03-161[0]",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fold.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fold — the printed base is KEPT and `per × counters` comes off it", () => {
  it("subtracts NOTHING at zero counters, and the base lands whole", () => {
    // "200-" parses to base 200 with a "-" marker, and at zero counters the attack
    // really does its printed number — which is what makes the marker a marker.
    const { state, events } = swing(board("cetitan", "fix-titan"), "cetitan");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 200, dealt: 200 });
    expect(find(events, "DAMAGE_DEALT")?.debuff).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(200);
  });

  it("subtracts 20 PER COUNTER for Cetitan…", () => {
    let state = board("cetitan", "fix-titan");
    state = setDamage(state, "p1", 30); // 3 damage counters
    const { events } = swing(state, "cetitan");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 200, debuff: 60, dealt: 140 });
  });

  it("…and 10 PER COUNTER for Skeledirge ex, off ONE regex", () => {
    // TWO amounts on one capture: a hardcoded per-unit satisfies one printing and
    // fails the other, which is D121's second-printing warrant met by the pool.
    let state = board("skeledirge", "fix-titan");
    state = setDamage(state, "p1", 100); // 10 damage counters
    const { events } = swing(state, "skeledirge");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 270, debuff: 100, dealt: 170 });
  });

  it("counts the ATTACKER's counters, never the defender's", () => {
    // The count source is `damageCountersOnSelf` and "self" is the attacking body.
    // A reader that took the target's damage would be right about nothing and would
    // pass every zero-counter case above.
    let state = board("cetitan", "fix-titan");
    state = setDamage(state, "p2", 150);
    const { events } = swing(state, "cetitan");
    expect(find(events, "DAMAGE_DEALT")?.debuff).toBeUndefined();
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(200);
  });

  it("reads the counters at DECLARATION, so a body healed to zero pays nothing", () => {
    // The same site every other member of the family counts at — this attack's own
    // result cannot bootstrap the number it reads, and neither can a heal that has
    // not happened.
    let state = board("skeledirge-song", "fix-titan");
    state = setDamage(state, "p1", 100);
    // "Vitality Song" heals 30 from the whole own board AFTER its 50 lands, so the
    // attacker is at 70 when the next declaration reads it.
    const healed = swing(state, "skeledirge-song").state;
    expect(healed.players.p1.active?.damage).toBe(70);
  });

  it("leaves index 0 ALONE — a sibling attack does not inherit the clause", () => {
    // "Hammer In" carries no `effect` key at all. A fold keyed on the CARD rather
    // than on the declared attack's text would take 60 off this too.
    let state = board("cetitan-hammer", "fix-titan");
    state = setDamage(state, "p1", 30);
    const { events } = swing(state, "cetitan-hammer");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 50, dealt: 50 });
    expect(find(events, "DAMAGE_DEALT")?.debuff).toBeUndefined();
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("⚠️ the SIGN-FLIPPED TWIN still ADDS, on the same board and the same count", () => {
    // One body, one damage total, two readers: "Rage" (idx 3, "10+") folds 10 per
    // counter ON and reports through `scaled`; "Fury" (idx 4, no base) folds 20 per
    // counter on with nothing to add to. If the penalty reader ever started
    // answering "more" — or the additive reader "less" — these two rows would move
    // in the wrong direction, which no assertion on the printings alone can see.
    let state = board("rage", "fix-titan");
    state = setDamage(state, "p1", 30);
    expect(find(swing(state, "rage").events, "DAMAGE_DEALT")).toMatchObject({
      base: 10,
      scaled: 30,
      dealt: 40,
    });
    let fury = board("fury", "fix-titan");
    fury = setDamage(fury, "p1", 30);
    const furyRow = find(swing(fury, "fury").events, "DAMAGE_DEALT");
    expect(furyRow).toMatchObject({ base: 0, scaled: 60, dealt: 60 });
    expect(furyRow?.debuff).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The clamp.
// ─────────────────────────────────────────────────────────────────────────────

describe("the clamp — inherited, taken over the WHOLE pre-W/R sum", () => {
  it("floors at 0 when the penalty reaches the base, and STILL emits the row", () => {
    // §8.5's "damage cannot go below 0", read at the step the printed clause names
    // (D149's placement). The row is the loud half: base 200, debuff 200, dealt 0 —
    // where a fold that returned early on a zeroed total would emit nothing at all
    // and read to a player exactly like an attack that does not exist.
    let state = board("cetitan", "fix-titan");
    state = setDamage(state, "p1", 100); // 10 counters × 20 = 200
    const { events } = swing(state, "cetitan");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 200, debuff: 200, dealt: 0 });
    // …and a clamped zero is NOT a prevention (D147's rule, inherited by summing
    // into the number it guarded).
    expect(row?.prevented).toBeUndefined();
  });

  it("⚠️ THE CLAMP IS ON THE SUM, NOT PER TERM — a Vitality Band cannot survive it", () => {
    // 15 counters is a 300 penalty against a printed 200 and a Tool's +10. Summed
    // and floored ONCE the answer is 0; floored per term it would be
    // `max(0, 200 − 300) + 10 = 10`, doubled by Skeledirge's ×2 Water into 20. The
    // board separates them by 20 HP, off two printed cards and one surgery.
    let state = board("cetitan", "sv02-037");
    state = setDamage(state, "p1", 150);
    state = attachToolFromDeck(state, "p1", "active", "sv01-197");
    const { events } = swing(state, "cetitan");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 200, debuff: 300, dealt: 0 });
    expect(find(events, "DAMAGE_DEALT")?.bonus).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ORDER, mutated rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ORDER — BEFORE Weakness, and the oracle is re-driven from the row", () => {
  it("subtracts before the ×2, and the reversed order KOs a body the right one does not", () => {
    // Cetitan (WATER) into Skeledirge ex (340 HP, ×2 Water) at 3 counters:
    //   correct   (200 − 60) × 2 = 280 — survives with 60 HP left
    //   reversed   200 × 2  − 60 = 340 — exactly lethal
    // Two observables move together, and the second is not a number a reader can
    // talk themselves into.
    let state = board("cetitan", "sv02-037");
    state = setDamage(state, "p1", 30);
    const { state: after, events } = swing(state, "cetitan");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 200, debuff: 60, dealt: 280 });
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(after.players.p2.active?.damage).toBe(280);
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("…and the oracle is derived from the ROW's OWN fields, in both placements", () => {
    // D147's move (D149/D161's inheritance): re-derive the number the engine
    // reported from the fields that row carries, rather than from the constants the
    // test was written with — so a fold that changed BOTH the number and the
    // reported base would still be caught.
    let state = board("cetitan", "sv02-037");
    state = setDamage(state, "p1", 30);
    const row = find(swing(state, "cetitan").events, "DAMAGE_DEALT");
    if (row === undefined) throw new Error("no damage row");
    const weakness: DamageModifier | null = row.weakness;
    const raw = row.base + (row.scaled ?? 0) + (row.bonus ?? 0);
    const before = applyDamageModifier(Math.max(0, raw - (row.debuff ?? 0)), weakness);
    const after = Math.max(0, applyDamageModifier(raw, weakness) - (row.debuff ?? 0));
    expect(before).toBe(row.dealt);
    expect(after).not.toBe(row.dealt);
    expect([before, after]).toEqual([280, 340]);
  });

  it("commutes with the pre-W/R BONUS, which is what summing into one term means", () => {
    // A Vitality Band adds 10 at the same step in the opposite direction:
    // (200 + 10 − 60) × 2 = 300. `bonus` and `debuff` are two fields of ONE sum, so
    // no ordering between THEM is observable — which is the honest form of the
    // "inherits D149's order" claim.
    let state = board("cetitan", "sv02-037");
    state = setDamage(state, "p1", 30);
    state = attachToolFromDeck(state, "p1", "active", "sv01-197");
    const { events } = swing(state, "cetitan");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 200,
      bonus: 10,
      debuff: 60,
      dealt: 300,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// One field, three sources.
// ─────────────────────────────────────────────────────────────────────────────

describe("`debuff` — the third source on a field that already summed two", () => {
  it("SUMS with Entei's always-on Pressure into ONE number", () => {
    // Entei sv03-030 "Pressure" takes 20 off attacks used by the opponent's Active
    // (D151, always-on, cross-board). Cetitan at 3 counters brings 60 of its own.
    // One field reports 80, and (200 − 80) × 2 = 240 on Entei's ×2 Water.
    //
    // ⚠️ WHAT THAT COSTS, driven rather than asserted in prose: no reader of this
    // row can say which card took which 20. That is D141's judgement and the same
    // trade `bonus` makes for a Tool plus an installed boost — one number per STEP
    // AND DIRECTION, never one per card (D155).
    let state = board("cetitan", "sv03-030");
    state = setDamage(state, "p1", 30);
    const { events } = swing(state, "cetitan");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 200, debuff: 80, dealt: 240 });
  });

  it("…with BOTH halves of that sum separated on their own boards", () => {
    // Pressure alone: 20. The penalty alone: 60. Neither control can be produced by
    // an implementation that reported only one of the two sources.
    const pressureOnly = find(swing(board("cetitan", "sv03-030"), "cetitan").events, "DAMAGE_DEALT");
    expect(pressureOnly).toMatchObject({ debuff: 20, dealt: 360 });
    let penaltyOnly = board("cetitan", "fix-titan");
    penaltyOnly = setDamage(penaltyOnly, "p1", 30);
    expect(find(swing(penaltyOnly, "cetitan").events, "DAMAGE_DEALT")).toMatchObject({
      debuff: 60,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 and ignoreWR.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 and `ignoreWR` — where this printing sits on both axes", () => {
  it("⚠️ AN ABILITY-LOCK REACHES THE VERY BODY AND STILL CANNOT TOUCH THE NUMBER", () => {
    // Ting-Lu ex "Cursed Land" silences the opponent's DAMAGED non-ex Pokémon.
    // Cetitan is damaged (which is the whole premise of this clause), is not an ex,
    // and the lock is asserted LIVE on its own uid — so the §9 answer is measured
    // on a body the lock genuinely addresses rather than on one it never reached.
    // The clause survives because it is printed on the ATTACK, not on an Ability:
    // a fourth value on the axis D159 opened (suppresses / suppresses / cannot
    // reach a STADIUM) and D161 widened (cannot reach a TOOL).
    let state = board("cetitan", "sv02-127");
    state = setDamage(state, "p1", 30);
    expect(disabledAbilityUids(state).has(activeUid(state, "p1"))).toBe(true);
    const { events } = swing(state, "cetitan");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 200, debuff: 60, dealt: 140 });
  });

  it("`ignoreWR` cannot reach it either, and the reason is STRUCTURAL", () => {
    // Feint Attack's clause scopes "any effects on that Pokémon" and is honoured at
    // the interpreter's two SNIPE arms. This number is not an effect on the damaged
    // body and never reaches those arms at all: a snipe's amount comes from its OP,
    // while this clause modifies the attack's PRINTED damage, which only the main
    // hit reads. Unreachable by construction rather than merely undriven — pinned
    // as the absence of an `ignoreWR`-carrying route into the fold, because the
    // sentence derives no op whatsoever.
    expect(deriveAttackEffect(SWEEPING_TACKLE)).toBeNull();
    expect(deriveAttackEffect(BURNING_VOICE)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the crumb, rendered under BOTH seats and READ", () => {
  it("reads `· weakened −60` under the ATTACKER's name, and the row is filed under the defender", () => {
    // `DAMAGE_DEALT.seat` owns the DAMAGED Pokémon (D136's finding 1) and log.ts
    // renders the line under `otherSeat(seat)` — the one row in this family spoken
    // from the opposite chair to its own contract. So the crumb had to be true from
    // the ATTACKER's side, and it is, because it names the FACT (the damage was
    // reduced before Weakness) rather than a rule or an owner. NO NEW ARM: the
    // existing D149 crumb already says exactly this.
    let state = board("cetitan", "sv03-030");
    state = setDamage(state, "p1", 30);
    const { state: after, events } = swing(state, "cetitan");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("dealt 240 damage to Entei · weakened −80 · weakness ×2");
  });

  it("renders the SAME sequence when the attacking seat is p2", () => {
    // Both seats, because the row is the one whose filing seat and rendering seat
    // differ — a hardcoded seat would look right on exactly one of these.
    let state = board("cetitan", "sv03-030", "p2");
    state = setDamage(state, "p2", 30);
    const { state: after, events } = swing(state, "cetitan", "p2");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p2");
    expect(row?.text).toBe("dealt 240 damage to Entei · weakened −80 · weakness ×2");
  });

  it("says nothing at all when the penalty is 0", () => {
    // Loudness is owed to UNREAD text (D140): a clause that took nothing off must
    // not print a crumb saying so.
    const { state: after, events } = swing(board("cetitan", "fix-titan"), "cetitan");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.text).toBe("dealt 200 damage to fix-titan");
  });

  it("⚠️ AND THE PRINTED TEXT STOPS BEING FLAGGED — both halves of it", () => {
    // Before this slice both printings emitted ATTACK_EFFECT_SKIPPED carrying the
    // whole sentence AND the "-" damage marker. The reader consumes both, so both
    // terms of that row's guard had to move; leaving `modifierSimulated` alone
    // would keep five printings loudly flagged for text the engine now resolves.
    for (const attacker of ["cetitan", "skeledirge"] as const) {
      let state = board(attacker, "fix-titan");
      state = setDamage(state, "p1", 30);
      expect(find(swing(state, attacker).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural answers", () => {
  it("PERSIST: NOTHING was written to `InPlayPokemon`, so MATCH_RECORD_VERSION stays 10", () => {
    // Neither park nor persist. The clause is CATALOG text read at declaration by a
    // pure function of the current state; no stamp, no op, no event type, no enum
    // value, no union member. The dodge was priced and REFUSED (D155's rule): a
    // per-attack penalty cached on the body would go stale on every heal, every
    // damage counter and every evolution, and would have bought a bump for nothing.
    // Pinned as an ABSENCE (D161's move), which is the only way a no-bump claim is
    // checkable. (`MATCH_RECORD_VERSION` itself lives in `apps/api/src/lobby/
    // match.ts`; the engine cannot import it, so the assertion this side can make
    // is the one that would FORCE the bump.)
    //
    // ⚠️ D412 — THIS PARENTHETICAL USED TO NAME THE LITERAL ("is pinned at 10 by
    // `match.test.ts`") AND IT WENT STALE THE FIRST TIME ANYBODY BUMPED IT. The
    // number is DELETED rather than stepped, because it was the one part of the
    // sentence this file cannot check: a figure about ANOTHER file, carried in
    // prose, with nothing comparing them — the exact shape conventions.md warns
    // about. **What this slice MEASURED is preserved and unchanged**: at D161 the
    // constant was 10 and this slice wrote nothing to `InPlayPokemon`. The second
    // half is still asserted below; the first half was never this file's to keep
    // current.
    const active = board("cetitan", "fix-titan").players.p1.active;
    if (active === null) throw new Error("no Active");
    expect(Object.keys(active).sort()).toEqual(
      [
        "attackBlock",
        "attackDamageDebuff",
        "attackLockedTurn",
        "boostedAttack",
        "conditions",
        "damage",
        "damageReduction",
        "energy",
        // 🆕🆕 D386 — `healedTurn` JOINS THE LIST (a second per-turn stamp on this
        // structure, and `MATCH_RECORD_VERSION` 22 → 23 with it). THIS slice still wrote
        // nothing: the pin is on the HEAD's key set, so it moves whenever anybody adds a
        // key, and what it asserts is that none of them was added HERE.
        "evolvedTurn",
        "healedTurn",
        "installedRecoil",
        "lockedAttacks",
        "markers",
        // 🆕🆕 D432 — the attack-installed §8.5 NO-WEAKNESS bar's stamp (MATCH_RECORD_VERSION 26 -> 27).
        "noWeaknessTurn",
        "promotedTurn",
        "retreatBlocked",
        // 🆕🆕 D412 — the SELF-installed §11 retreat lock's stamp (MATCH_RECORD_VERSION 25 → 26).
        "retreatLockedTurn",
        "scheduledEffect",
        "stack",
        "tools",
        "turnPlayed",
        // 🆕🆕 D394 — `usedAttack` JOINS THE LIST (a FOURTH per-turn stamp on this
        // structure, and `MATCH_RECORD_VERSION` 24 → 25 with it). THIS slice still
        // wrote nothing; the pin is on the HEAD's key set.
        "usedAttack",
      ].sort(),
    );
  });

  it("GATES NO ACTION — the attack is still offered when it would deal 0", () => {
    // Checked rather than assumed (D157's rule): the clause says nothing about
    // legality or cost, so `redactedAttacksOf` must keep offering it even on the
    // board where it does literally nothing — refusing there would be the engine
    // inventing a rule the card does not print. Both payability projections read
    // the same `attacks` array, and `GameHud.tsx` takes no diff because no new
    // field reaches it.
    let state = board("cetitan", "fix-titan");
    state = setDamage(state, "p1", 150);
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[1]).toMatchObject({ index: 1, name: "Sweeping Tackle", playable: true });
    expect(applyAction(state, { type: "attack", seat: "p1", index: 1 }).ok).toBe(true);
  });
});
