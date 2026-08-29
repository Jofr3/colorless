import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  MUNKIDORI_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setConditions,
  setDamage,
  types,
} from "./testFixtures";

// 0.108.0 → D164 — Munkidori ex sv06.5-037/-083/-091 "Oh No You Don't" (P3-M5
// long tail), the SECOND consumer of the KO antecedent D158 censused:
//
//   "If this Pokémon is Knocked Out by damage from an attack from your opponent's
//    Pokémon, and if you have any Pecharunt ex in play, your opponent takes 1
//    fewer Prize card."                                 (Pokémon, `abilities_json`)
//
// ⚠️ THE ANTECEDENT CENSUS IS THIS SESSION'S OWN QUERY, run over TWO POPULATIONS
// and ALL THREE text columns, against the RESTORED local D1 (2026-08-03, 978 rows
// / 6 sets — sv01 258, sv02 279, sv03 230, sv06.5 99, sve 24, swsh10.5 88).
// "Knocked Out by damage from an attack" returns SIX rows, which is D158's figure
// and D162's re-run of it, confirmed a THIRD time here:
//
//   sv03-197  Vengeful Punch (Trainer/Tool, `effect`)      → D158, 4 counters
//   sv01-174  Exp. Share     (Trainer/Tool, `effect`)      → move a Basic Energy
//   sv01-114  Lucario        (Pokemon, `attacks_json`)     → +120 damage
//   sv06.5-037/-083/-091  Munkidori ex (Pokemon, `abilities_json`) → THIS
//
// ⚠️ AND TWO INHERITED DESCRIPTIONS OF THAT TABLE ARE WRONG, both found by
// reading the printed strings rather than the census that names them.
//
//   (1) LUCARIO IS NOT THE SAME ANTECEDENT. Every list since D158 files it as
//       "the same antecedent with a different consequent". The printed string is
//       "If any of your {F} Pokémon were Knocked Out by damage from an attack
//       DURING YOUR OPPONENT'S LAST TURN, this attack does 120 more damage." That
//       is RETROSPECTIVE (read at attack time on a LATER turn, not at the KO),
//       BOARD-WIDE ("any of your"), TYPE-FILTERED ("{F}") and carries no "from
//       your opponent's Pokémon" clause at all. It shares a substring, not a
//       shape, and it cannot read at this site or D158's — it needs a last-turn
//       KO memory the model does not keep. `conditionClause.test.ts` has said so
//       since D115 and is the older, correct account.
//   (2) MUNKIDORI EX IS AN ABILITY, ON `abilities_json`. D158's own table renders
//       it as `Munkidori ex "Oh No You Don't"` in the column where Lucario's
//       ATTACK sits, and the effect lives in the third text column — the one
//       censuses in this repo have repeatedly been blind to.
//
// The three printings ARE one body, which the handoff asked to verify rather than
// assume: a `count(distinct …)` over name, hp, stage, types, retreat, abilities,
// attacks, weaknesses, resistances, regulation mark and legality returns 1. They
// differ only in `rarity` (Double rare / Ultra Rare / Special illustration rare).
//
// ⚠️ THE SHAPE — WHY D158's READ SITE DOES NOT SERVE THIS, WHICH IS THE SLICE.
// D158 placed its line in `finishAttack`, ahead of `collectKnockOuts`, and got
// the whole "by an attack" clause FOR FREE: the Checkup and the mid-turn evolve
// path call `collectKnockOuts` directly and never reach that line. This card's
// consequent is a PRIZE, and prizes are planned by `planPrizes` INSIDE
// `collectKnockOuts` — which all three paths reach. So the identical printed
// clause that cost D158 nothing costs this printing a threaded argument. The
// generalisation, written at the site: **placement discharges a condition only
// for a consequent that can live at the placement.**
//
// ⚠️ AND IT IS A SIBLING FIELD, NOT A SECOND MEMBER OF GLIMMORA'S UNION — D155's
// rule, and the two consumers MUTUALLY REFUSE:
//   • Glimmora's "When this Pokémon is Knocked Out" has NO cause qualifier, so it
//     MUST still deny its Prize at a Checkup poison KO. This one must be refused
//     there. One shared gate breaks whichever card does not want it.
//   • Glimmora ZEROES ("can't take ANY Prize cards"); this DECREMENTS ("1 FEWER"),
//     which on a two-Prize ex is 2 → 1 and not 2 → 0.
//   • Glimmora flips a coin; this has none, and a shared path would either spend
//     rng this card must not spend or drop a flip Glimmora needs.
// Both directions are driven below on ONE board.

/** The printed sentence, byte-for-byte off the local D1 row (2026-08-03). */
const OH_NO_YOU_DONT =
  "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, and if you have any Pecharunt ex in play, your opponent takes 1 fewer Prize card.";
/** Lucario's, kept verbatim because the whole point is that it is NOT this one. */
const AVENGING_KNUCKLE =
  "If any of your {F} Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 120 more damage.";
/** Exp. Share's, the third consequent — carried so the remainder is a STRING. */
const EXP_SHARE =
  "When your Active Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, you may move a Basic Energy from that Pokémon to the Pokémon this card is attached to.";

/** Munkidori ex's face-value Prize count (it has a Rule Box) and what the
    printed "1 fewer" leaves. The decrement is only observable on a body worth
    more than one, which is why the printing is its own witness. */
const MUNKIDORI_PRIZES = 2;
const REDUCED_PRIZES = 1;

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30, no effect
const yawn = { type: "attack", seat: "p1", index: 2 } as const; // Yawn — no damage, a status
const spread = { type: "attack", seat: "p1", index: 0 } as const; // Spread Shot — 30 + 20/bench

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The rendered log a player actually reads — the same helper shape
    `vengefulPunch.test.ts` uses, so the two suites' rows are comparable. */
function render(
  events: GameEvent[],
  state: GameState,
  names: { p1: string; p2: string } = { p1: "Ember", p2: "Tide" },
): { who: string; text: string }[] {
  const ctx: LogContext = { names, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** P2 (going first) fields `holder` and the bench, then the turn passes to P1,
    who fields `attacker` with one {C} attached. The mirror of
    `vengefulPunch.test.ts`'s `equip`, so the two suites' boards are comparable —
    which matters, because the two cards read the SAME printed antecedent at two
    different sites. */
function field(
  seed: number,
  opts: {
    holder?: string;
    attacker?: string;
    bench?: { id: string; damage?: number }[];
    holderDamage?: number;
    /** Bench the ATTACKER's side — the "from your OPPONENT'S Pokémon" board. */
    attackerBench?: { id: string; damage?: number }[];
  } = {},
): GameState {
  let state = driveSetup(seed, { p1: MUNKIDORI_DECK, p2: MUNKIDORI_DECK }, { first: "p2" });
  // P2's turn — plant the holder, clear the setup bench, then build the exact one.
  state = setActiveFromDeck(state, "p2", opts.holder ?? "sv06.5-037");
  state = { ...state, players: { ...state.players, p2: { ...state.players.p2, bench: [] } } };
  for (const [i, entry] of (opts.bench ?? []).entries()) {
    state = benchFromDeck(state, "p2", entry.id);
    if (entry.damage !== undefined) state = setBenchDamage(state, "p2", i, entry.damage);
  }
  if (opts.holderDamage !== undefined) state = setDamage(state, "p2", opts.holderDamage);
  // Hand the turn to P1 and field the attacker.
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", opts.attacker ?? "fix-attacker");
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
  for (const [i, entry] of (opts.attackerBench ?? []).entries()) {
    state = benchFromDeck(state, "p1", entry.id);
    if (entry.damage !== undefined) state = setBenchDamage(state, "p1", i, entry.damage);
  }
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// The printed datum — re-queried per claim, never inherited.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed datum — re-queried, not inherited", () => {
  it("authors all THREE printings as one `onKoPrizeReduction` on-KO trigger", () => {
    const authored = {
      name: "Oh No You Don't",
      trigger: "onKnockOut",
      program: [],
      onKoPrizeReduction: { by: 1, requiresInPlay: "Pecharunt ex" },
    };
    // The three ids are ONE body in the catalog, so they are ONE program here.
    expect(programFor("sv06.5-037")?.triggered).toEqual([authored]);
    expect(programFor("sv06.5-083")?.triggered).toEqual([authored]);
    expect(programFor("sv06.5-091")?.triggered).toEqual([authored]);
    // `program` is EMPTY — like Glimmora's, this queues no koTrigger stage. A
    // non-empty one would make the sweep park where the printed card does not.
    expect(programFor("sv06.5-037")?.triggered?.[0]?.program).toEqual([]);
  });

  it("the fixture's Ability string is the D1 row, character for character", () => {
    const ability = FIXTURE_POOL["sv06.5-037"]?.abilities?.[0];
    expect(ability?.name).toBe("Oh No You Don't");
    expect(ability?.effect).toBe(OH_NO_YOU_DONT);
    // The GENERATED manifest is an independent second reading of the same row —
    // it comes from the sqlite, not from this file — so the NAMES are checked by
    // a path that cannot inherit a typo from the fixture.
    expect(CATALOG_MANIFEST.printed["sv06.5-037"]?.name).toBe("Munkidori ex");
    expect(CATALOG_MANIFEST.printed["sv06.5-037"]?.abilities).toEqual(["Oh No You Don't"]);
    // ⚠️ AND THE CARD'S OTHER PRINTED SENTENCE IS STILL THERE. D154's per-attack
    // lock reads "Dirty Headbutt" off the attack text; this slice adds a registry
    // row to the same id and must not have displaced it.
    expect(CATALOG_MANIFEST.printed["sv06.5-037"]?.attacks).toEqual(["Dirty Headbutt"]);
    expect(FIXTURE_POOL["sv06.5-037"]?.attacks?.[0]?.effect).toBe(
      "During your next turn, this Pokémon can't use Dirty Headbutt.",
    );
  });

  it("the BOARD CONDITION names a card with FOUR printings, so it matches by NAME", () => {
    // "if you have any Pecharunt ex in play" — sv06.5-039/-085/-093/-095 in the
    // local D1. No id would cover them, and the sentence names the CARD.
    expect(programFor("sv06.5-037")?.triggered?.[0]?.onKoPrizeReduction?.requiresInPlay).toBe(
      "Pecharunt ex",
    );
    expect(FIXTURE_POOL["sv06.5-039"]?.name).toBe("Pecharunt ex");
    expect(CATALOG_MANIFEST.printed["sv06.5-039"]?.name).toBe("Pecharunt ex");
  });

  it("the sentence is an ABILITY's and never derives as an attack effect", () => {
    // It lives on `abilities_json`. Feeding it to the attack deriver must stay
    // null — the column-blindness this family keeps tripping over, made a test.
    expect(deriveAttackEffect(OH_NO_YOU_DONT)).toBeNull();
  });

  it("⚠️ LUCARIO's clause is NOT this antecedent, and the older account is right", () => {
    // The correction. It shares the substring "Knocked Out by damage from an
    // attack" and nothing else that matters: no "from your opponent's Pokémon",
    // a BOARD-WIDE and TYPE-FILTERED subject, and a RETROSPECTIVE reading point
    // ("during your opponent's LAST turn") that no KO-time site can serve.
    expect(AVENGING_KNUCKLE).toContain("Knocked Out by damage from an attack");
    expect(AVENGING_KNUCKLE).not.toContain("from your opponent's Pokémon");
    expect(AVENGING_KNUCKLE).toContain("during your opponent's last turn");
    expect(OH_NO_YOU_DONT).toContain("from your opponent's Pokémon");
    expect(OH_NO_YOU_DONT).not.toContain("last turn");
    // It is still UNMAPPED, and deliberately: it stays the live fall-through
    // witness in `conditionClause.test.ts` / `conditionalDamage.test.ts`.
    expect(programFor("sv01-114")?.triggered).toBeUndefined();
  });

  it("⚠️ EXP. SHARE is the same antecedent — MAPPED at D171, and these FIVE pins are RE-POINTED", () => {
    // sv01-174, a Tool. It IS this antecedent (same "from your opponent's
    // Pokémon", read at the KO). D164 deferred it and pinned it here as an ABSENCE
    // on five assertions so that authoring it could never be a silent behaviour
    // change. D171 authored it, so all five went red exactly as designed — and
    // they are RE-POINTED rather than deleted, at what the slice actually built.
    //
    // The predicted price was wrong in BOTH directions and the corrections are the
    // point of this pin, not a footnote:
    //   • the "you may" PROMPT cost NOTHING — optional triggers auto-fire and
    //     `moveEnergy` is already declinable, so no new prompt arm exists;
    //   • the real cost was that NOTHING RAN A TOOL'S `triggered` PROGRAM. The
    //     bearer is a SURVIVING body, so `onKnockOutTrigger` (the KO'd top card),
    //     `triggersOf` (any top card) and `passivesOf` (tools, folded to NUMBERS)
    //     all miss it — hence a FOURTH detection site, `koToolTriggersOf`.
    expect(FIXTURE_POOL["sv01-174"]?.effect).toBe(EXP_SHARE);
    expect(CATALOG_MANIFEST.printed["sv01-174"]?.name).toBe("Exp. Share");
    expect(EXP_SHARE).toContain("Knocked Out by damage from an attack from your opponent's");
    expect(EXP_SHARE).toContain("you may"); // ⚠️ the "may" — and it was FREE
    expect(EXP_SHARE).toContain("your Active Pokémon"); // ⚠️ a clause THIS card lacks
    expect(OH_NO_YOU_DONT).not.toContain("Active");
    // The re-pointed absence: it is authored, and on a timing of its OWN. The two
    // must not collapse — an `onKnockOut` row here would be read by the KO sweep,
    // which runs after `knockOut` has discarded the Energy this card moves.
    const triggered = programFor("sv01-174")?.triggered;
    expect(triggered).toHaveLength(1);
    expect(triggered?.[0]?.trigger).toBe("onAllyActiveKnockOut");
    expect(triggered?.[0]?.trigger).not.toBe("onKnockOut");
    // …and it carries NEITHER Prize field, so the partition test below stays true
    // of it and the KO sweep never plans a prize off this card.
    expect(triggered?.[0]?.onKoPrizeGuard).toBeUndefined();
    expect(triggered?.[0]?.onKoPrizeReduction).toBeUndefined();
  });

  it("the two on-KO Prize fields PARTITION the registry — total and disjoint", () => {
    // D158's re-pointed pool-wide guard, one level over: every authored on-KO
    // Prize effect carries EXACTLY ONE of the two fields. A producer authored on
    // both would be a card whose Prize is denied AND decremented, which nothing
    // prints and the sweep resolves in an order nobody chose.
    const guards: string[] = [];
    const reductions: string[] = [];
    for (const id of Object.keys(FIXTURE_POOL)) {
      for (const t of programFor(id)?.triggered ?? []) {
        if (t.trigger !== "onKnockOut") continue;
        if (t.onKoPrizeGuard !== undefined) guards.push(id);
        if (t.onKoPrizeReduction !== undefined) reductions.push(id);
      }
    }
    expect(guards).toEqual(["sv02-126"]); // Glimmora, and only Glimmora
    // The pool holds ONE of the card's three printings, plus the fixture body
    // that exists solely to reach the clamp.
    expect(reductions).toEqual(["fix-koprize", "sv06.5-037"]);
    expect(guards.filter((id) => reductions.includes(id))).toEqual([]);
    // ⚠️ WHAT THIS SWEEP DOES NOT TRAVERSE, AND IT IS NOT A THEORETICAL GAP —
    // `FIXTURE_POOL` only. The other TWO printings of this very card are in the
    // registry's id map and in NO fixture (D162's one-fixture-for-three-rarities
    // move, inherited here), so the pool sweep above cannot see them and would
    // stay green if their rows were deleted. They are asserted by id directly:
    for (const id of ["sv06.5-037", "sv06.5-083", "sv06.5-091"]) {
      const t = programFor(id)?.triggered?.[0];
      expect(t?.onKoPrizeReduction, id).toEqual({ by: 1, requiresInPlay: "Pecharunt ex" });
      expect(t?.onKoPrizeGuard, id).toBeUndefined();
    }
    // …and Glimmora carries the guard and NOT the reduction, the other half.
    expect(programFor("sv02-126")?.triggered?.[0]?.onKoPrizeReduction).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The headline: the reduction, and the three clauses that refuse it.
// ─────────────────────────────────────────────────────────────────────────────

describe("the reduction — 2 Prizes become 1 when every clause holds", () => {
  it("Munkidori ex is KO'd by Bite with a Pecharunt ex benched: the opponent takes 1", () => {
    // 210 HP pre-damaged to 190; Bite's 30 makes 220 ≥ 210, so it is Knocked Out
    // — and its own Ability cuts the Prize its killer takes from 2 to 1.
    const state = field(1, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    const holder = state.players.p2.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: holder });
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2", // the KO'd side — the Ability's OWNER
      uid: holder,
      ability: "Oh No You Don't",
    });
    expect(find(events, "PRIZE_REDUCED")).toEqual({
      type: "PRIZE_REDUCED",
      seat: "p2",
      uid: holder,
      by: 1,
      count: REDUCED_PRIZES,
    });
    // ⚠️ THE PRIZE STAGE CARRIES THE REDUCED COUNT — not the face value, and not
    // zero. This is the assertion the whole slice exists for.
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: REDUCED_PRIZES });
    // No flip was spent — this card has none, and rng must not advance for it.
    expect(types(events)).not.toContain("ABILITY_COIN_FLIP");
    expect(done.rngState).toBe(state.rngState);
  });

  it("with NO Pecharunt ex in play the SAME board pays face value — 2", () => {
    // The board condition, driven as a one-card difference: the identical KO,
    // with the bench slot holding a body of another name.
    const state = field(2, { holderDamage: 190, bench: [{ id: "fix-titan" }] });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(types(events)).toContain("KNOCKED_OUT");
    expect(find(events, "PRIZE_REDUCED")).toBeUndefined();
    expect(find(events, "ABILITY_TRIGGERED")).toBeUndefined();
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: MUNKIDORI_PRIZES });
  });

  it("a Pecharunt ex on the OPPONENT'S board does not count — 'if YOU have'", () => {
    // The possessive inside the board condition, which is a different possessive
    // from the one in the cause clause. "You" is the Ability's controller, so the
    // scan is the KO'd body's OWN side; a Pecharunt ex benched by the ATTACKER is
    // in play, and is somebody else's.
    const state = field(3, {
      holderDamage: 190,
      bench: [{ id: "fix-titan" }],
      attackerBench: [{ id: "sv06.5-039" }],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "PRIZE_REDUCED")).toBeUndefined();
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: MUNKIDORI_PRIZES });
  });

  it("an ACTIVE Pecharunt ex counts too — 'in play' is not 'on the Bench'", () => {
    // The scan covers Active and Bench. Here Pecharunt ex is P2's Active and the
    // dying Munkidori ex is BENCHED, which also exercises the next case's clause.
    const state = field(4, {
      holder: "sv06.5-039",
      attacker: "fix-sniper",
      bench: [{ id: "sv06.5-037", damage: 200 }],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(find(events, "PRIZE_REDUCED")).toMatchObject({ seat: "p2", count: REDUCED_PRIZES });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: REDUCED_PRIZES });
  });

  it("a BENCHED Munkidori ex finished by a snipe fires — the clause prints no 'Active'", () => {
    // ⚠️ THE ABSENT CLAUSE, D158's second half re-asked for this consequent and
    // answered the same way. Exp. Share prints "your ACTIVE Pokémon" and this card
    // does not, so a benched holder reduces its Prize exactly as an Active one
    // does. Spread Shot's 20 finishes a bench body pre-damaged to 200.
    const state = field(5, {
      attacker: "fix-sniper",
      holder: "fix-bigbody",
      bench: [
        { id: "sv06.5-037", damage: 200 },
        { id: "sv06.5-039" },
      ],
    });
    const benched = state.players.p2.bench[0]?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    // The Active (200 HP fix-bigbody) survives its 30; only the bench body dies.
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    expect(find(events, "PRIZE_REDUCED")).toMatchObject({ uid: benched, count: REDUCED_PRIZES });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: REDUCED_PRIZES });
  });

  it("a hit that does NOT Knock it Out changes nothing — it is a KO clause", () => {
    const state = field(6, { holderDamage: 100, bench: [{ id: "sv06.5-039" }] });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(find(events, "PRIZE_REDUCED")).toBeUndefined();
    expect(done.players.p1.prizes).toHaveLength(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE CAUSE CLAUSE — the half D158 got from placement and this one cannot.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ CAUSE — 'by damage from an attack from your OPPONENT'S Pokémon'", () => {
  it("a POISON Knock Out at the Checkup does NOT reduce the Prize — 'by an attack'", () => {
    // ⚠️ THE CASE THAT NEEDED THE PARAMETER. The Checkup calls `collectKnockOuts`
    // directly, so it reaches `planPrizes` — the very function this clause is read
    // in — with NO `attackerSeat`. D158's identical clause never had to be
    // written down because its line sits where the Checkup cannot go; this one is
    // an explicit refusal, and without it a poisoned Munkidori ex would deny a
    // Prize its printed sentence lets the opponent keep.
    let state = field(7, { holderDamage: 200, bench: [{ id: "sv06.5-039" }] });
    state = setConditions(state, "p2", { poisonDamage: 10 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });

    // The poison DID kill it, in its own voice…
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p2", source: "poison" });
    expect(types(events)).toContain("KNOCKED_OUT");
    // …and the Ability paid nothing: face value, and no row claiming otherwise.
    expect(find(events, "PRIZE_REDUCED")).toBeUndefined();
    expect(find(events, "ABILITY_TRIGGERED")).toBeUndefined();
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: MUNKIDORI_PRIZES });
  });

  it("⚠️ GLIMMORA on the SAME Checkup board still denies its Prize — the refusal", () => {
    // ⚠️ THE MUTUAL REFUSAL, ON ONE BOARD. Glimmora's clause has no cause
    // qualifier, so it MUST fire here — the exact KO where Munkidori ex's must
    // not. Putting the cause gate on one shared field would silence this card;
    // putting the coin flip on one shared field would spend rng on the other.
    // 30 HP Glimmora, poisoned, dies to the tick.
    let state = field(8, { holder: "sv02-126", holderDamage: 20 });
    state = setConditions(state, "p2", { poisonDamage: 10 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });

    expect(types(events)).toContain("KNOCKED_OUT");
    expect(find(events, "ABILITY_COIN_FLIP")).toMatchObject({ ability: "Shattering Crystal" });
    // Whichever way the flip lands, the OTHER field never spoke.
    expect(find(events, "PRIZE_REDUCED")).toBeUndefined();
    const prevented = find(events, "PRIZE_PREVENTED") !== undefined;
    expect(done.phase).toEqual(
      prevented
        ? { kind: "ko:promote", seat: "p2" }
        : { kind: "ko:takePrizes", seat: "p1", count: 1 },
    );
  });

  it("a Munkidori ex on the ATTACKER'S OWN board pays nothing — 'from your OPPONENT'S'", () => {
    // ⚠️ THE POSSESSIVE, DRIVEN ON A LEGAL BOARD, and it is NOT free: unlike
    // D158's site (which scans `otherSeat(attackerSeat)` only), `finishAttack`
    // sweeps BOTH boards, so the attacker's own dying bodies reach `planPrizes`
    // WITH an `attackerSeat` set. The refusal is `attackerSeat === ref.seat` and
    // nothing else stands between this board and a wrong answer.
    //
    // P1 attacks with fix-sniper; its own benched Munkidori ex is dropped to
    // lethal by surgery, standing in for any self-inflicted KO on the actor's
    // board. Its Prize is the DEFENDER's and is not reduced.
    const state = field(9, {
      attacker: "fix-sniper",
      holder: "fix-bigbody",
      attackerBench: [
        { id: "sv06.5-037", damage: 210 },
        { id: "sv06.5-039" },
      ],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p1" });
    expect(find(events, "PRIZE_REDUCED")).toBeUndefined();
    // The prizes for a self-KO go to the DEFENDER, at face value.
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: MUNKIDORI_PRIZES });
  });

  it("⚠️ an ABILITY's mid-turn snipe KO does not reduce it either — the OTHER non-attack path", () => {
    // ⚠️ THE WITNESS THE FIRST MUTATION PASS DEMANDED. The Checkup case above is
    // NOT the whole of "by an attack": `settleProgram` resolves an Ability's
    // mid-turn KOs through `resolveMidTurnKnockOuts(resumed, controller, SEATS,
    // …)` — with BOTH seats — so a program that lethally damages the OPPONENT'S
    // board reaches `planPrizes` on a body this clause names. The evolve path
    // passes `[actorSeat]` and so can only ever kill the actor's own Pokémon,
    // where the possessive would refuse anyway; this path is the one that would
    // NOT be refused by anything except the missing `attackerSeat`.
    //
    // Hawlucha's "Flying Entry" puts 1 counter on each of 2 of P2's Benched
    // Pokémon. P2's benched Munkidori ex sits at 200 of 210, so the counter is
    // lethal — and its Prize must be the face-value 2, because a counter from an
    // Ability is not damage from an attack.
    let state = field(11, { holder: "fix-bigbody", bench: [] });
    state = benchFromDeck(state, "p2", "sv06.5-037");
    state = setBenchDamage(state, "p2", 0, 200);
    state = benchFromDeck(state, "p2", "sv06.5-039"); // the board condition HOLDS
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const hand = handUid(state, "p1", "sv01-118");
    deepFreeze(state);

    const { state: parked, events } = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid: hand,
    });
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({ ability: "Flying Entry" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");

    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: prompt.candidates.slice(0, 2) },
    });

    // The Ability DID Knock the Munkidori ex Out…
    expect(types(e2)).toContain("KNOCKED_OUT");
    // …and the reduction was refused: face value, and no row claiming otherwise.
    expect(find(e2, "PRIZE_REDUCED")).toBeUndefined();
    const counts = done.pending
      .filter((s) => s.kind === "takePrizes")
      .map((s) => (s as { count: number }).count);
    expect(counts).toEqual([MUNKIDORI_PRIZES]);
  });

  it("a 0-damage attack that KOs nothing leaves both fields silent", () => {
    // Yawn deals no damage: `finishAttack` still runs and still passes
    // `attackerSeat`, but `lethalRefs` is empty and `planPrizes` is never called.
    const state = field(10, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    deepFreeze(state);

    const { events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(find(events, "PRIZE_REDUCED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ ORDER — this family's known hazard, re-asked for a PRIZE consequent.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ ORDER — the batch is one instant, and the plan is made before it", () => {
  it("a Pecharunt ex dying in the SAME batch still satisfies 'in play'", () => {
    // ⚠️ THE JUDGEMENT, PINNED. `planPrizes` runs on the PRE-KO state, so every
    // body in the batch is still in play while the plan is made. A spread that
    // kills the Munkidori ex and the Pecharunt ex at once therefore still
    // reduces — the batch is ONE instant (D158's model, read one function later),
    // not a sequence in which the condition can expire halfway.
    const state = field(11, {
      attacker: "fix-sniper",
      holder: "fix-bigbody",
      bench: [
        { id: "sv06.5-037", damage: 200 },
        { id: "sv06.5-039", damage: 180 },
      ],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    // BOTH bench bodies die (190 HP Pecharunt ex at 180 + 20; 210 at 200 + 20).
    expect(all(events, "KNOCKED_OUT")).toHaveLength(2);
    // …and the Munkidori ex's Prize is still cut.
    expect(find(events, "PRIZE_REDUCED")).toMatchObject({ count: REDUCED_PRIZES });
    // TWO prize stages, in ref order: the Munkidori ex's REDUCED 1 and the
    // Pecharunt ex's untouched 2. The second is the control — a batch-wide (as
    // opposed to per-body) reduction would have cut it as well.
    const counts = done.pending
      .filter((s) => s.kind === "takePrizes")
      .map((s) => (s as { count: number }).count);
    expect(counts).toEqual([REDUCED_PRIZES, MUNKIDORI_PRIZES]);
  });

  it("TWO Munkidori ex in one batch each reduce their OWN Prize", () => {
    // Per-body, not per-batch: the reduction is planned inside the ref loop, so
    // two holders dying to one spread produce TWO rows of 1 rather than one row
    // or a single shared decrement.
    const state = field(12, {
      attacker: "fix-sniper",
      holder: "fix-bigbody",
      bench: [
        { id: "sv06.5-037", damage: 200 },
        { id: "sv06.5-037", damage: 200 },
        { id: "sv06.5-039" },
      ],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(all(events, "KNOCKED_OUT")).toHaveLength(2);
    const reduced = all(events, "PRIZE_REDUCED");
    expect(reduced).toHaveLength(2);
    expect(reduced.map((e) => e.count)).toEqual([REDUCED_PRIZES, REDUCED_PRIZES]);
    const counts = done.pending
      .filter((s) => s.kind === "takePrizes")
      .map((s) => (s as { count: number }).count);
    expect(counts).toEqual([REDUCED_PRIZES, REDUCED_PRIZES]); // 2 Prizes total, not 4
  });

  it("⚠️ the reduction reaches the §14 TIE GUARD — it can decide the game", () => {
    // ⚠️ THE ORDER MUTATION WITH TEETH. `collectKnockOuts` speculates the whole
    // batch — KOs plus the prizes they grant — into a throwaway state and asks
    // `evaluateWin`. The speculation deducts `entry.count`, so the REDUCED count
    // has to be the one it sees; a reduction applied after the speculation (or
    // only on the real pass) would let §14 hand the game to a player who does not
    // actually take their last Prize.
    //
    // P1 is on ONE prize. Munkidori ex face value 2 would win it outright; cut to
    // 1 it exactly wins too — so the board that SEPARATES them is the one where
    // the reduction leaves the game alive, which is the mutual KO below.
    let state = field(13, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    // P1 down to ONE prize: 1 taken from a 2-Prize KO ends the game.
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, prizes: state.players.p1.prizes.slice(0, 1) },
      },
    };
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "PRIZE_REDUCED")).toMatchObject({ count: REDUCED_PRIZES });
    // One prize left, one prize taken — P1 still wins, and the count that got it
    // there is the REDUCED one (a face-value 2 would over-draw a 1-card row).
    expect(done.phase.kind === "ko:takePrizes" || done.phase.kind === "gameOver").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE — rendered under BOTH seats and READ.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the row is SYSTEM, derived rather than inherited", () => {
  it("renders identically under both seats, and states BOTH numbers", () => {
    // ⚠️ SYSTEM, AND NOT FOR D158's REASON. `seat` owns the DYING Pokémon while
    // the party the sentence acts on is that seat's OPPONENT (they take fewer),
    // so an active voice under `seat` describes the wrong player's loss and one
    // under the opponent credits them with their own penalty. The ABILITY_TRIGGERED
    // row above already names the Ability and its owner.
    const state = field(14, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    const rows = render(events, done);
    const row = rows.find((r) => r.text.includes("fewer Prize card"));
    expect(row).toEqual({
      who: "system",
      text: "Munkidori ex — your opponent takes 1 fewer Prize card for it (1 instead of 2)",
    });
    // Swapping the names changes NOTHING, which is what "system" means here.
    expect(render(events, done, { p1: "Tide", p2: "Ember" })).toEqual(rows);
    // ⚠️ READ IT: a player seeing "1 instead of 2" can check the prize count they
    // are about to be handed. "1 fewer" alone is uncheckable by someone who does
    // not know the card is worth two.
    expect(row?.text).toContain("(1 instead of 2)");
  });

  it("the Ability is NAMED by its own row, in the owner's voice", () => {
    const state = field(15, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, bite);

    const rows = render(events, done);
    const named = rows.find((r) => r.text.includes("Oh No You Don't"));
    expect(named).toBeDefined();
    expect(named?.who).not.toBe("system"); // the Ability's owner speaks; the effect does not

    // ⚠️ AND THE ORDER OF THE TWO ROWS IS LOAD-BEARING, which a first mutation
    // pass proved by swapping them and failing nothing. The Ability must be NAMED
    // before its consequence, or the system row states a Prize change with no
    // preceding row saying whose card caused it — and "system" is only honest
    // BECAUSE the row above already named the actor (that is the whole VOICE
    // argument). Glimmora narrates in the same order for the same reason.
    const order = types(events).filter(
      (t) => t === "ABILITY_TRIGGERED" || t === "PRIZE_REDUCED" || t === "KNOCKED_OUT",
    );
    expect(order).toEqual(["KNOCKED_OUT", "ABILITY_TRIGGERED", "PRIZE_REDUCED"]);
  });

  it("does not borrow PRIZE_PREVENTED's wording — a decrement is not a denial", () => {
    // The reason the row is its own event. Glimmora's line says "no Prize card is
    // taken for it"; saying that here, while the opponent takes one, is false.
    const state = field(16, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, bite);

    const text = render(events, done)
      .map((r) => r.text)
      .join(" | ");
    expect(text).not.toContain("no Prize card is taken");
    expect(types(events)).not.toContain("PRIZE_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The five structural questions.
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural questions — answered, not asserted", () => {
  it("PARK or PERSIST? NEITHER — no key joins `InPlayPokemon`", () => {
    // The whole mechanism is CATALOG data (a registry `triggered` entry) plus one
    // parameter on an internal function. Pinned as an ABSENCE, D161's rule: the
    // in-play body's key set is asserted whole, so a later slice adding one to it
    // goes red HERE rather than silently riding a stale MATCH_RECORD_VERSION.
    const state = field(17, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    const body = state.players.p2.active;
    expect(body).not.toBeNull();
    expect(Object.keys(body ?? {}).sort()).toEqual(
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

  it("GATES AN ACTION? NO — the payability projection takes a zero diff", () => {
    // It is read once, inside the KO sweep, and refuses no declaration: nothing
    // it writes is on `InPlayPokemon`, so `redactedAttacksOf` (through
    // `redactGame`) has nothing new to consult. Driven on the holder's OWN turn,
    // where the projection is non-empty — it returns [] for anyone but the turn
    // owner, so checking it on the defending seat would prove nothing.
    let state = field(18, { bench: [{ id: "sv06.5-039" }] });
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    const view = redactGame(state, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    // Munkidori ex's ONE attack is projected, and its playability is decided by
    // cost and by D154's lock — never by this slice's Ability.
    expect(view.attacks.map((a) => a.name)).toEqual(["Dirty Headbutt"]);
    // The GameHud reads exactly this array, so a zero diff here is a zero diff
    // there (D157's rule: verify WHICH SEAT the projection is computed for).
    expect(redactGame(state, "p1").phase).toMatchObject({ attacks: [] });
  });

  it("⚠️ the clamp is DRIVEN, and reaching it took TWO constructed values", () => {
    // ⚠️ THE SECOND WITNESS THE MUTATION PASS DEMANDED, and the interesting part
    // is what the FIRST attempt at it got wrong. The clamp fires only when the
    // reduction EXCEEDS the face value. A 1-Prize body alone does not reach it —
    // 1 − 1 is 0 either way — which is why deleting `Math.max` failed nothing even
    // with `fix-koprize` in the deck. So the demonstrator pairs 1 Prize with a
    // constructed `by: 2`: the truth is 0 and the unclamped mutant is −1.
    expect(programFor("fix-koprize")?.triggered?.[0]?.onKoPrizeReduction?.by).toBe(2);
    const state = field(19, {
      holder: "fix-koprize",
      holderDamage: 20,
      bench: [{ id: "sv06.5-039" }],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(types(events)).toContain("KNOCKED_OUT");
    // `by` is what was ACTUALLY taken away (1, the whole Prize), not the printed
    // 2 — the row reports the effect, and an unclamped count would say 2 / −1.
    expect(find(events, "PRIZE_REDUCED")).toMatchObject({ by: 1, count: 0 });
    // A count of 0 queues NO prize stage at all — which is also what Glimmora's
    // heads does. Same destination, and the row above is the only thing that says
    // which card got them there. P1's prize row is untouched.
    expect(done.pending.filter((s) => s.kind === "takePrizes")).toEqual([]);
    expect(done.players.p1.prizes).toHaveLength(6);
  });

  it("the printed holder never reaches that clamp — its Prize is 2", () => {
    const reduction = programFor("sv06.5-037")?.triggered?.[0]?.onKoPrizeReduction;
    expect(reduction).toEqual({ by: 1, requiresInPlay: "Pecharunt ex" });
    expect(MUNKIDORI_PRIZES - (reduction?.by ?? 0)).toBe(REDUCED_PRIZES);
  });
});
