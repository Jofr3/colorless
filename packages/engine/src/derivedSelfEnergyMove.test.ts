import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction } from "./index";
import {
  FIXTURE_POOL,
  SELF_ENERGY_MOVE_DECK,
  activeUid,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.145.0 → 0.146.0 — D229, THE ATTACKER'S OWN ENERGY ONTO ITS OWN BENCH: row 5
// of `coverage-backlog-legal.md`, and the FIRST derived arms the `moveEnergy`
// family has ever had.
//
//   "Move an Energy from this Pokémon to 1 of your Benched Pokémon."      (8 legal)
//   "Move 3 Energy from this Pokémon to 1 of your Benched Pokémon."       (3 legal)
//   "Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon." (2 legal)
//
// 13 Standard-legal printings for **2 anchors and ONE `route` value**. No new op,
// no new op FIELD, no wire change, no client change: `selfToBench` is
// `benchToActive` with the endpoints swapped, and everything downstream of the
// PROMPT — the wire validator, `moveEnergyApply`, `ENERGY_MOVED`, both HUD dialogs
// — was already written against a prompt that names its own movable set and its
// own destinations.
//
// 🛑 THE ROW PRICED IT AT **19 PRINTINGS FOR ~7 ARMS** AND BOTH HALVES ARE WRONG,
// IN OPPOSITE DIRECTIONS — the fourth `needs` cell on this branch to misprice and
// the FIRST to over-count. Re-derived (never inherited) against the remote D1
// `luminous` on 2026-08-05, `json_each` + `GLOB`, all three text columns:
// the family is **16** legal printings, not 19, and it is **2** anchors, not 7.
// The numeric and article forms are ONE alternation (`ATTACK_DRAW`'s precedent)
// and the two "all Energy" sentences are not arms at all. ⚠️ **AN EDIT ESTIMATE
// IS A CLAIM EXACTLY LIKE A COUNT IS**, and this page's own rule — re-derive the
// `needs` column, not just the ids — has now been paid in the cheap direction four
// times (D199, D227, D228) and the expensive direction once (here).
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did an Energy move". `moveEnergy` has
// run since M4 and `moveEnergyApply` is shared verbatim, so the board move has
// four suites behind it already. What is NEW is a pair of ENDPOINTS, and the whole
// risk of the slice is that they are the MIRROR of an existing route: a build that
// wrote `benchToActive` here would move an Energy, emit an `ENERGY_MOVED`, park
// on the same prompt kind and pass every generic assertion in this repo. So every
// case below that could survive a crossed build is paired with one that could not.

/** The three sentences these two anchors read, with the program each derives to
    and the printing counts measured for it. Census re-derived (not inherited) on
    2026-08-05 against the remote D1 `luminous` — 3,786 rows / 20 sets, 2,021
    `legal_standard = 1` — over `json_each(attacks_json)` +
    `json_extract(value,'$.effect')` with `GLOB` rather than `LIKE`, because
    SQLite's `LIKE` is ASCII case-insensitive and has cost this repo a census.

    ⚠️ SWEPT OVER ALL THREE TEXT COLUMNS, and the negative result is part of the
    census: `abilities_json` and `effect` return **ZERO** rows for this shape, so
    the whole family is attack text — which is also the fact the `route`'s
    "sources are the Active" reading rests on (§8: only the Active attacks).

    Both figures per row: `printings` over the whole remote catalog,
    `legalPrintings` over the Standard pool. A count without a population AND a
    legality is not a fact. */
const CLAUSES = [
  {
    text: "Move an Energy from this Pokémon to 1 of your Benched Pokémon.",
    program: [
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "selfToBench" },
    ] as EffectOp[],
    note: "Move an Energy from this Pokémon to 1 of your Benched Pokémon.",
    printings: 13,
    legalPrintings: 8,
  },
  {
    text: "Move 3 Energy from this Pokémon to 1 of your Benched Pokémon.",
    program: [
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 3, route: "selfToBench" },
    ] as EffectOp[],
    // ⚠️ THE PROMPT SAYS "up to 3" WHERE THE CARD SAYS "3", and that is the
    // family's standing approximation rather than this slice's invention: every
    // `moveEnergy` printing since M4 is declinable (Energy Switch prints a bare
    // "Move a Basic Energy…"). It is asserted here rather than glossed, because
    // these are the first printings whose `max > 1` makes the gap VISIBLE to a
    // player. See the op's doc in effects.ts.
    note: "Move up to 3 Energy from this Pokémon to 1 of your Benched Pokémon.",
    printings: 3,
    legalPrintings: 3,
  },
  {
    text: "Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon.",
    program: [
      { op: "moveEnergy", filter: { kind: "basicEnergy" }, max: 1, route: "selfToBench" },
    ] as EffectOp[],
    note: "Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon.",
    printings: 2,
    legalPrintings: 2,
  },
] as const;

const ANY = 0;
const THREE = 1;
const BASIC = 2;

/** The two sentences of the same family D229 deliberately did NOT read, with the
    legal count each carries. They were DEFERRED for a reason about `max` and not
    about the endpoints — see the op's doc — and they are pinned here so the
    deferral has a live subject rather than a comment.

    🆕🆕 **D441 COLLECTED THE FIRST AND LEFT THE SECOND, AND THE SPLIT IS THE
    WHOLE FINDING.** D229's note said the blocker was `max`. It was half right: the
    quantifier was one edit (`max: "all"`), and what actually stood in the way was
    that *"any amount"* and *"all"* disagree about ZERO — a DECLINABILITY gap, which
    is what `min` on the prompt closes. The second sentence carries the identical
    quantifier and is still refused, **for a reason that was never about `max` at
    all**: *"to your Benched Pokémon **in any way you like**"* spreads one answer
    over MANY destinations, and the `moveEnergy` answer names ONE `dest` for every
    pick (`{ kind: "moveEnergy"; uids: string[]; dest: PokemonRef }`).

    So the list is now split by REASON rather than kept as one deferral, because a
    single list would have gone on saying `max` about a sentence whose blocker is
    the answer shape. Each row carries its legal printing count and its own
    falsifier. */
const COLLECTED_AT_D441 = [
  ["Move all Energy from this Pokémon to 1 of your Benched Pokémon.", 2],
] as const;

/** 🆕🆕 **D442 COLLECTED THIS HALF, AND THE FALSIFIER THE LIST CARRIED IS EXACTLY
    WHAT FIRED.** It said the row *"reverses the day `moveEnergy`'s answer becomes a
    MAP (pick → destination), which is `attachCards`' shipped shape and a wire-choice
    change of its own"* — which is what D442 built, and the wire-choice change turned
    out NOT to be a `MATCH_RECORD_VERSION` question at all (an `EffectChoice` is never
    serialized; the PROMPT is, and its new key is optional).

    The list is kept rather than deleted, and it is asserted as its PROGRAM rather
    than as `!== null` (D438): the sentence differs from `COLLECTED_AT_D441`'s by its
    destination clause alone, so the claim that discriminates is that it derives with
    `anyDest: true` and its sibling derives WITHOUT — a boolean is true under a build
    where D441's anchor swallowed this string and dropped the rider. */
const COLLECTED_AT_D442 = [
  ["Move all Energy from this Pokémon to your Benched Pokémon in any way you like.", 1],
] as const;

/** 🛑 THE FAMILY'S REAL NEAR MISS, AND IT IS A CATALOG ROW RATHER THAN A
    CONSTRUCTION: the same sentence with a TYPED noun (2 printings, **0 legal** —
    both rotated). It wants a filter these arms do not build: `basicEnergy` narrows
    the CATEGORY, and nothing in the op says "{D}". A `(\d+)[^.]*Energy` anchor
    would swallow it and quietly move ANY Energy at all, which is the exact class
    of defect D183 names — an arm that matches a paraphrase and no real card, read
    from the other end. */
const TYPED_NEAR_MISS = "Move 2 {D} Energy from this Pokémon to 1 of your Benched Pokémon.";

// ── The board. Indices 14-16 on `fix-trainerops`, appended by D229. ──
const VOLT_CYCLONE = 14;
const JET_CYCLONE = 15;
const HURRICANE = 16;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: SELF_ENERGY_MOVE_DECK, p2: SELF_ENERGY_MOVE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops` holding `basics` Basic Energy and `specials`
    Special Energy, over a Bench of `ownBench` bodies. p2 is a plain `fix-bigbody`
    with a Bench of its own — set explicitly on BOTH sides, because the crossed
    builds this file guards against would reach for the other seat's. */
function ready(
  seed: number,
  { basics = 1, specials = 0, ownBench = 2 }: { basics?: number; specials?: number; ownBench?: number },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  if (basics > 0) state = attachFromDeck(state, "p1", "fix-energy", basics);
  if (specials > 0) state = attachFromDeck(state, "p1", "fix-special", specials);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The parked `moveEnergy` prompt an attack produced, narrowed. */
function parkedMove(state: GameState): {
  movable: readonly { uid: string; from: PokemonRef }[];
  destinations: readonly PokemonRef[];
  max: number;
  note?: string;
} {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
  return prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

describe("the two anchors — three printed sentences, one new route value", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 13 of the family's 16 legal printings, across 3 sentences", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one anchor would still pass every accept case above.
    expect(CLAUSES).toHaveLength(3);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(13);
    expect(CLAUSES[ANY].legalPrintings).toBe(8);
    expect(CLAUSES[THREE].legalPrintings).toBe(3);
    expect(CLAUSES[BASIC].legalPrintings).toBe(2);
    // …and the residual, which is the other half of the same census: 3 more legal
    // printings over two sentences. 🆕 D441 SPLIT THAT RESIDUAL 2 + 1 rather than
    // shrinking it, so the arithmetic below still totals the family's 16 and the
    // two halves are told apart by their REASON rather than by their count.
    expect(COLLECTED_AT_D441.reduce((sum, [, legal]) => sum + legal, 0)).toBe(2);
    expect(COLLECTED_AT_D442.reduce((sum, [, legal]) => sum + legal, 0)).toBe(1);
    // 🛑 THE COLLECTED HALF IS ASSERTED AS ITS PROGRAM, NOT AS `!== null` (D438):
    // a boolean is true under the real build and under a build that claimed the
    // sentence with the WRONG route or the WRONG quantifier, and this file exists
    // because `benchToActive` here would pass every generic assertion in the repo.
    for (const [text] of COLLECTED_AT_D441) {
      expect(deriveAttackEffect(text), text).toEqual([
        { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: "all", route: "selfToBench" },
      ]);
    }
    // 🆕 D442 — …and the OTHER half is now claimed too, BY ITS OWN ANCHOR AND WITH
    // ITS OWN RIDER. Asserted as the program (D438) rather than as `!== null`,
    // because the failure this rung has to see is not "unclaimed" — it is D441's
    // anchor widening to swallow this string, which would derive the SIBLING's
    // program (no `anyDest`) and pass every truthiness test. The pair above and
    // this line are each other's control: same op, same route, same quantifier,
    // and exactly one key apart.
    for (const [text] of COLLECTED_AT_D442) {
      expect(deriveAttackEffect(text), text).toEqual([
        {
          op: "moveEnergy",
          filter: { kind: "anyEnergy" },
          max: "all",
          route: "selfToBench",
          anyDest: true,
        },
      ]);
    }
    // 13 + 2 + 1 = 16, which is the number the backlog row says is 19.
    expect(
      CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) +
        COLLECTED_AT_D441.reduce((sum, [, legal]) => sum + legal, 0) +
        COLLECTED_AT_D442.reduce((sum, [, legal]) => sum + legal, 0),
    ).toBe(16);
  });

  it("🛑 REFUSES the TYPED sibling — the family's one real near miss", () => {
    // A CATALOG ROW, not a construction: "Move 2 {D} Energy from this Pokémon to 1
    // of your Benched Pokémon." (2 printings, 0 legal). It is one anchor byte away
    // from the numeric arm and means something the op cannot say, so reading it
    // would silently move ANY Energy where the card names a type.
    expect(deriveAttackEffect(TYPED_NEAR_MISS)).toBeNull();
    // …and the shape that WOULD have swallowed it is named, so a future widening
    // has to walk past this line: the noun is bare, and the number is a `\d+`
    // directly in front of it.
    expect(TYPED_NEAR_MISS).toContain("{D} Energy from this Pokémon");
    expect(deriveAttackEffect("Move 2 Energy from this Pokémon to 1 of your Benched Pokémon.")).toEqual(
      [{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 2, route: "selfToBench" }],
    );
  });

  it("the numeric and article forms are ONE anchor, and the missing group IS max 1", () => {
    // The alternation `(?:(\d+)|an)`, asserted as behaviour: "an Energy" and
    // "3 Energy" derive to programs that differ in `max` and in NOTHING else. A
    // build that split them into two anchors would pass the accept cases above and
    // is exactly the "~7 arms" the backlog row priced.
    const [one] = deriveAttackEffect(CLAUSES[ANY].text) ?? [];
    const [three] = deriveAttackEffect(CLAUSES[THREE].text) ?? [];
    expect(one).toEqual({ ...three, max: 1 });
    expect(three).toEqual({ ...one, max: 3 });
    // …and a number the catalog does not print today rides the same arm, which is
    // the whole reason the count is captured rather than alternated over 1 and 3.
    expect(deriveAttackEffect("Move 12 Energy from this Pokémon to 1 of your Benched Pokémon.")).toEqual(
      [{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 12, route: "selfToBench" }],
    );
  });

  it("the BASIC arm differs by its filter and by nothing else", () => {
    const [any] = deriveAttackEffect(CLAUSES[ANY].text) ?? [];
    const [basic] = deriveAttackEffect(CLAUSES[BASIC].text) ?? [];
    expect(basic).toEqual({ ...any, filter: { kind: "basicEnergy" } });
    // …which is the one word that differs in print, too.
    expect(CLAUSES[BASIC].text).toBe(CLAUSES[ANY].text.replace("an Energy", "a Basic Energy"));
  });

  it("carries NO new op and NO new op field — one `route` value is the whole cost", () => {
    // The honest price of the slice, asserted. Every arm emits `moveEnergy`, which
    // the Trainer path has run since M4, and the only key any of them adds to an
    // op this repo already builds is `route: "selfToBench"`.
    for (const { program } of CLAUSES) {
      expect(program.map((o) => o.op)).toEqual(["moveEnergy"]);
      const [op] = program;
      expect(op?.op === "moveEnergy" ? op.route : undefined).toBe("selfToBench");
      expect(op?.op === "moveEnergy" ? Object.keys(op).sort() : []).toEqual([
        "filter",
        "max",
        "op",
        "route",
      ]);
    }
  });

  it("refuses the anchor, punctuation and case rewrites", () => {
    const bare = CLAUSES[ANY].text;
    const rewrites = [
      // A leading clause — the shape a `$`-only build eats.
      `Draw a card. ${bare}`,
      // A trailing clause — the shape a `^`-only build eats. ⚠️ CONSTRUCTED, AND
      // SAID SO: no printed sentence in this family carries a tail, so there is no
      // catalog witness for the `$` and D228's finding applies — a dropped `$`
      // would survive a harness fed only real rows.
      `${bare} Your opponent draws a card.`,
      // Case, both ends.
      bare.replace("Move", "move"),
      bare.replace("Benched", "benched"),
      // The trailing period.
      bare.slice(0, -1),
      // The DIRECTION reversed, which is the whole content of the route and is
      // also a real printed shape (Armarouge's Ability, `benchToActive`).
      "Move an Energy from 1 of your Benched Pokémon to this Pokémon.",
      // The FREE route's printed sentence — Energy Switch, a Trainer, whose
      // program is authored in the registry and must not be derived off text.
      "Move a Basic Energy from 1 of your Pokémon to another of your Pokémon.",
      // The opponent's board, which no member of this family reaches.
      "Move an Energy from this Pokémon to 1 of your opponent's Benched Pokémon.",
      // A COUNTER move, one noun away and a different op entirely.
      "Move all damage counters from this Pokémon to 1 of your Benched Pokémon.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("hands no clause to the coin reader, and carries no apostrophe to curl", () => {
    for (const { text } of CLAUSES) expect(deriveAttackCoinFlip(text), text).toBeNull();
    // ⚠️ A PREDICTION ABOUT A SIBLING CENSUS, WHICH IS THE CHEAPEST CHECK THERE IS
    // (D227's note predicted D228's 86 → 88 by name). `clauseApostrophe.test.ts`
    // sweeps every FIXTURE_POOL attack sentence that CONTAINS an apostrophe; these
    // three contain none, so that census must be UNMOVED by this slice — it is
    // still 88. If any sentence here grew a possessive, that number would move and
    // this line says which way to look.
    for (const { text } of CLAUSES) {
      expect(text.includes("'"), text).toBe(false);
      expect(text.includes("’"), text).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FIXTURE — the printings, present and pinned
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVENANCE — the demonstrator carries all three sentences at 14-16", () => {
  it("fields the family at indices 14-16, appended and not inserted", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    // 48 at D236 (43 at D235, 35 at D234, 29 at D232, 25 at D231, 20 at D230, 17 at D229, 14
    // at D228, 13 at D227, 9 at D189, 8 at D181). TEN slices, ten appends, zero
    // inserts — which is what every index constant in ten suites depends on.
    // ⚠️ FIFTY-FIVE AT D240; **58 at D241**, which appended 55-57 (look at the
    // top N — "Summoning Gate" / "Larimar Rain" / "Dig It Up").
    // `derivedLookAtTop.test.ts` owns 55-57. ELEVEN slices, eleven appends, zero
    // inserts.
    // 🆕🆕 **63 AT D426**, which appended **61-62** — the opponent-chooses hand
    // discard (*"Your opponent discards 2 cards from their hand."* / *"…a card…"*).
    // `opponentHandDiscard.test.ts` owns them, and the append-never-insert
    // discipline this whole paragraph exists for holds again: 0-60 are addressed by
    // constant in a dozen sibling suites and every one of them still means what it
    // meant. ⚠️ NO ORDINAL IS CLAIMED (*"the Nth slice"*) — the running count above
    // was last written at D241 and was already one append behind by D246, which is
    // exactly how a count in a comment rots. The LENGTH is the executable half and
    // it is the line below.
    // 🆕🆕 **68 AT D443**, which appended **66-67** — the OPPONENT-BOARD pair
    // (`derivedOpponentEnergyMove.test.ts` owns them). TWELVE sibling suites carry
    // this pin and all twelve were stepped in one pass, as D442 stepped eleven.
    // 🆕🆕 **66 AT D442**, which appended **63-65** — the destination-side SPREAD
    // (*"Move all Energy from this Pokémon to your Benched Pokémon in any way you
    // like."* / *"You may move any amount of [{M}] Energy from your Pokémon to your
    // other Pokémon in any way you like."*). `derivedSpreadEnergyMove.test.ts` owns
    // them, and the append-never-insert discipline held again: 0-62 are addressed by
    // constant in a dozen sibling suites and every one still means what it meant —
    // which THIS rung is what proves, and it is the rung that caught the append.
    expect(attacks).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
    expect(attacks[VOLT_CYCLONE]?.effect).toBe(CLAUSES[ANY].text);
    expect(attacks[JET_CYCLONE]?.effect).toBe(CLAUSES[THREE].text);
    expect(attacks[HURRICANE]?.effect).toBe(CLAUSES[BASIC].text);
    // The indices the sibling suites address by constant did not move.
    expect(attacks[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks[13]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.",
    );
  });

  it("NO printed base damage on any of the three — stated, because it is a CHOICE", () => {
    // ⚠️ D228's LESSON APPLIED TO THE FIELDS RATHER THAN THE STRING. Unlike D227's
    // Grimmsnarl — where the catalog prints no `damage` and the fixture invented
    // one — the real printings here DO print damage (Iron Thorns ex 120, Yanmega ex
    // 200, Tornadus 120) and this fixture deliberately omits it, so that the Bench
    // body receiving the Energy cannot be Knocked Out by the same attack that fed
    // it. That is a divergence from the printing, so it is asserted and explained
    // rather than left for a reader to assume it is the catalog's shape.
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    for (const index of [VOLT_CYCLONE, JET_CYCLONE, HURRICANE]) {
      expect(attacks[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does, so this is
    // an assertion about these three rows and not about the fixture at large.
    expect(attacks[3]?.damage).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE POINT OF THE SLICE — which end is which
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — off the ATTACKER, onto the attacker's OWN Bench", () => {
  it("parks offering the ATTACKER's Energy and the controller's own Bench", () => {
    const state = ready(11, { basics: 2, ownBench: 2 });
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });

    const prompt = parkedMove(parked);
    expect(parked.phase.kind === "effect:choose" ? parked.phase.seat : undefined).toBe("p1");
    // 🛑 THE ASSERTION THE WHOLE SLICE IS ABOUT, HALF ONE: every movable Energy
    // comes off the ACTIVE. A `benchToActive` build offers the Bench's instead,
    // and on this board that set is EMPTY — so the crossed build would not even
    // park, which the pairing below makes explicit.
    expect(prompt.movable).toHaveLength(2);
    for (const m of prompt.movable) {
      expect(m.from).toEqual({ seat: "p1", spot: { spot: "active" } });
    }
    expect(prompt.movable.map((m) => m.uid).sort()).toEqual(
      [...(parked.players.p1.active?.energy ?? [])].sort(),
    );
    // 🛑 HALF TWO: every destination is one of the CONTROLLER's own benched
    // bodies. The Active is excluded (a Pokémon may not move Energy onto itself)
    // and so is the whole opposite side of the table.
    expect(prompt.destinations).toHaveLength(2);
    for (const d of prompt.destinations) {
      expect(d.seat).toBe("p1");
      expect(d.spot.spot).toBe("bench");
    }
    expect(prompt.max).toBe(1);
    expect(prompt.note).toBe(CLAUSES[ANY].note);
    // Nothing has moved yet, and the attacker is still where it was.
    expect(activeUid(parked, "p1")).toBe(attacker);
    expect(parked.players.p1.active?.energy).toHaveLength(2);
  });

  it("🛑 the MIRROR route on the SAME board offers the two sets INVERTED", () => {
    // ⚠️ THE PAIR THAT MAKES THE ROUTE LOAD-BEARING, and the one case in this file
    // a crossed build cannot survive. Same seed, same board, same op, same prompt
    // kind: only which end is the source differs. `benchToActive`'s movable set on
    // this board is the BENCH's Energy — which is empty — and its destination is
    // the Active, which is precisely the body `selfToBench` refuses as a
    // destination.
    const state = ready(11, { basics: 2, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    const mine = parkedMove(parked);

    // The mirror, driven through `programPlayable` rather than an attack, because
    // no printing puts `benchToActive` on an attack — the endpoints are what is
    // being compared, and the gate reads the same `moveEndpoints` the park does.
    const mirror: EffectOp[] = [
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "benchToActive" },
    ];
    // No Energy anywhere on p1's Bench, so the mirror can only whiff and the gate
    // says so — while this slice's route on the identical board is playable.
    expect(programPlayable(state, mirror, "p1")).toBe(false);
    expect(programPlayable(state, CLAUSES[ANY].program, "p1")).toBe(true);
    // …and with the Energy on a BENCHED body instead, the verdicts swap. Neither
    // route can be quietly substituted for the other on any board.
    const flipped = attachBenchFromDeck(
      { ...state, players: { ...state.players, p1: { ...state.players.p1, active: state.players.p1.active === null ? null : { ...state.players.p1.active, energy: [] } } } },
      "p1",
      0,
      "fix-energy",
      1,
    );
    expect(programPlayable(flipped, mirror, "p1")).toBe(true);
    expect(programPlayable(flipped, CLAUSES[ANY].program, "p1")).toBe(false);
    // The destination sets are disjoint too, which is the other half of "mirror".
    expect(mine.destinations.some((d) => d.spot.spot === "active")).toBe(false);
  });

  it("🛑 an Energy on a BENCHED body is NOT movable — the source is the attacker", () => {
    // The printed subject is "this Pokémon", and the route answers it with the
    // Active. A build that read `attachedEnergies(…, "all")` — the FREE route's
    // scope, one ternary away — would offer this Energy and let the attack move
    // Energy between two benched bodies, which the sentence never says.
    let state = ready(12, { basics: 1, ownBench: 2 });
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 2);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    const prompt = parkedMove(parked);
    const benchEnergy = new Set(parked.players.p1.bench[0]?.energy ?? []);
    expect(benchEnergy.size).toBe(2);
    expect(prompt.movable).toHaveLength(1);
    expect(benchEnergy.has(prompt.movable[0]?.uid ?? "")).toBe(false);
  });

  it("the answer MOVES it: off the Active, onto the chosen benched body", () => {
    const state = ready(13, { basics: 2, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    const prompt = parkedMove(parked);
    const moved = prompt.movable[0]?.uid as string;
    const dest = prompt.destinations[1] as PokemonRef;

    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: moved, dest }] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.active?.energy).not.toContain(moved);
    expect(done.state.players.p1.bench[1]?.energy).toContain(moved);
    expect(done.state.players.p1.bench[0]?.energy).not.toContain(moved);
    // The event names both ends, and the seat is the ATTACKER's on both.
    const rows = all(done.events, "ENERGY_MOVED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seat: "p1",
      uids: [moved],
      from: { spot: "active" },
      to: { spot: "bench", index: 1 },
    });
    // 🛑 AND THE OPPONENT'S BOARD IS UNTOUCHED — the seat control, which a build
    // that reached for `otherSeat` (this engine's most-repeated defect: gust vs
    // self-switch are one `otherSeat` apart) would fail and nothing else here
    // would. The BOARD, not the whole side: resolving this park ends the turn, so
    // p2's deck and hand move for reasons that have nothing to do with this op.
    expect(done.state.players.p2.active).toEqual(parked.players.p2.active);
    expect(done.state.players.p2.bench).toEqual(parked.players.p2.bench);
    expect(done.state.players.p2.discard).toEqual(parked.players.p2.discard);
  });

  it("DECLINES: an empty pick is a legal answer and moves nothing", () => {
    // The family's standing "up to" semantics, inherited rather than invented —
    // and the reason the prompt for "Move 3 Energy" reads "up to 3".
    const state = ready(14, { basics: 2, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    // D442 — the decline names no destination now, so the park is read only to
    // prove it IS a park.
    expect(parkedMove(parked).movable.length).toBeGreaterThan(0);
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(all(done.events, "ENERGY_MOVED")).toHaveLength(0);
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
  });

  it("A LONE benched body is still a park — ONE destination is enough on this route", () => {
    // ⚠️ `needed` IS 1 AND NOT 2, WHICH IS THE FREE ROUTE'S VALUE AND THE ONE A
    // copy would carry. That rule exists because the free route's SOURCE is also a
    // candidate destination (Energy Switch: "1 of your Pokémon to ANOTHER"), so it
    // needs two bodies to have a legal answer at all. Here source and destination
    // are disjoint by construction — the Active is not on the Bench — so a single
    // benched body is a complete offer. A `needed: 2` build silently whiffs on
    // exactly this board and passes every two-body case in this file.
    const state = ready(17, { basics: 1, ownBench: 1 });
    expect(state.players.p1.bench).toHaveLength(1);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    const prompt = parkedMove(parked);
    expect(prompt.destinations).toHaveLength(1);
    expect(prompt.destinations[0]).toEqual({ seat: "p1", spot: { spot: "bench", index: 0 } });
    // …and it is answerable, not merely offered.
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: prompt.movable[0]?.uid as string, dest: prompt.destinations[0] as PokemonRef },
        ],
      },
    });
    expect(done.state.players.p1.bench[0]?.energy).toHaveLength(1);
  });

  it("AN EMPTY OWN BENCH is a whiff, not a refusal — §8 declares against the COST", () => {
    // The route's reachable zero-destination board, and it is genuinely reachable
    // here where `benchToActive`'s vacant-Active twin is not. The attack is
    // declared against its Energy cost and never against whether its effect can
    // accomplish anything, so it resolves and does nothing.
    const state = ready(15, { basics: 2, ownBench: 0 });
    expect(state.players.p1.bench).toHaveLength(0);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VOLT_CYCLONE,
    });
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_MOVED")).toHaveLength(0);
    expect(after.players.p1.active?.energy).toHaveLength(2);
    // …and the turn moved on, which is what "the attack was used" means.
    expect(after.phase.kind).toBe("turn:action");
  });

  it("NO ENERGY on the attacker is UNREACHABLE through an attack, and says so", () => {
    // ⚠️ THE ZERO-SOURCE BOARD IS THE ONE THIS ROUTE CANNOT BE DRIVEN TO FROM THE
    // ACTION API, and the reason is the §8 cost rather than anything in the op:
    // every printing of this family costs Energy, so a body that can declare the
    // attack necessarily holds at least one Energy for the unfiltered arm to
    // offer. Asserted as the REFUSAL it actually is, rather than skipped — the
    // filtered arm's version of the same board IS reachable and is driven below.
    const state = ready(16, { basics: 0, ownBench: 2 });
    expect(state.players.p1.active?.energy ?? []).toHaveLength(0);
    const refused = applyAction(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false ? refused.error.code : undefined).toBe("ATTACK_COST_UNMET");
    // The op's own no-op ending is therefore only observable through the gate,
    // which reads the identical `moveEndpoints` — see the last describe below.
    expect(programPlayable(state, CLAUSES[ANY].program, "p1")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE OTHER TWO ARMS — the count, and the filter
// ─────────────────────────────────────────────────────────────────────────────

describe("the numeric arm — `max` is the printed count, and it is a CEILING", () => {
  it("offers up to 3 and moves all three onto one body", () => {
    const state = ready(21, { basics: 4, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: JET_CYCLONE });
    const prompt = parkedMove(parked);
    expect(prompt.max).toBe(3);
    expect(prompt.note).toBe(CLAUSES[THREE].note);
    expect(prompt.movable).toHaveLength(4);
    const picks = prompt.movable.slice(0, 3).map((m) => m.uid);
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: picks.map((uid) => ({ uid, dest: prompt.destinations[0] as PokemonRef })) },
    });
    expect(done.state.players.p1.active?.energy).toHaveLength(1);
    expect(done.state.players.p1.bench[0]?.energy).toEqual(picks);
    // ONE event, not three: every pick shares the one source, which is what the
    // single-source coupling buys and what `ENERGY_MOVED`'s doc promises.
    expect(all(done.events, "ENERGY_MOVED")).toHaveLength(1);
  });

  it("refuses a FOURTH pick, and the one-Energy arm refuses a second", () => {
    const state = ready(22, { basics: 4, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: JET_CYCLONE });
    const prompt = parkedMove(parked);
    const tooMany = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: prompt.movable.map((m) => m.uid).map((uid) => ({ uid, dest: prompt.destinations[0] as PokemonRef })),
      },
    });
    expect(tooMany.ok).toBe(false);
    expect(tooMany.ok === false ? tooMany.error.code : undefined).toBe("BAD_EFFECT_CHOICE");

    // …and the article arm's ceiling is 1, which is the alternation's other half
    // observed on a board rather than on a derived object.
    const { state: single } = mustApply(ready(22, { basics: 4, ownBench: 2 }), {
      type: "attack",
      seat: "p1",
      index: VOLT_CYCLONE,
    });
    const singlePrompt = parkedMove(single);
    expect(singlePrompt.max).toBe(1);
    const pair = applyAction(single, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: singlePrompt.movable.slice(0, 2).map((m) => m.uid).map((uid) => ({ uid, dest: singlePrompt.destinations[0] as PokemonRef })),
      },
    });
    expect(pair.ok).toBe(false);
  });

  it("moving onto the Active is refused — the destination set says so first", () => {
    const state = ready(23, { basics: 2, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    const prompt = parkedMove(parked);
    const onto = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: prompt.movable[0]?.uid as string, dest: { seat: "p1", spot: { spot: "active" } } },
        ],
      },
    });
    expect(onto.ok).toBe(false);
    // The message is the DESTINATION one, not the self-move one — because on this
    // route the Active was never offered, where on the free route it is offered
    // and then rejected per pick. Two different refusals for the same board.
    expect(onto.ok === false ? onto.error.message : undefined).toContain("legal destination");
    // …and so is the opponent's Bench, which is the seat control on the wire.
    const across = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: prompt.movable[0]?.uid as string, dest: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        ],
      },
    });
    expect(across.ok).toBe(false);
  });
});

describe("the BASIC arm — the filter, on a board that can tell the difference", () => {
  it("🛑 offers only the Basic Energy, where the ANY arm offers both", () => {
    // ⚠️ THE BOARD THIS SUITE'S OWN DECK EXISTS FOR. `TRAINER_OPS_DECK` carries no
    // Special Energy at all, so on it `basicEnergy` and `anyEnergy` are the SAME
    // predicate and the filter word in the arm could be deleted with nothing going
    // red. `SELF_ENERGY_MOVE_DECK` substitutes four `fix-special` for four
    // `fix-energy` precisely so this pair can exist.
    const state = ready(31, { basics: 1, specials: 1, ownBench: 2 });
    expect(state.players.p1.active?.energy).toHaveLength(2);

    const { state: filtered } = mustApply(state, { type: "attack", seat: "p1", index: HURRICANE });
    const basicPrompt = parkedMove(filtered);
    expect(basicPrompt.note).toBe(CLAUSES[BASIC].note);
    expect(basicPrompt.movable).toHaveLength(1);
    const basicUid = basicPrompt.movable[0]?.uid as string;
    expect(filtered.cardIdByUid[basicUid]).toBe("fix-energy");

    const { state: unfiltered } = mustApply(ready(31, { basics: 1, specials: 1, ownBench: 2 }), {
      type: "attack",
      seat: "p1",
      index: VOLT_CYCLONE,
    });
    const anyPrompt = parkedMove(unfiltered);
    expect(anyPrompt.movable).toHaveLength(2);
    expect(anyPrompt.movable.map((m) => unfiltered.cardIdByUid[m.uid]).sort()).toEqual([
      "fix-energy",
      "fix-special",
    ]);
  });

  it("a Special-only attacker makes the BASIC arm a whiff and the ANY arm a park", () => {
    // The same discrimination from the other side, and the sharper one: the arm
    // does not merely offer less, it offers NOTHING, so the attack resolves having
    // moved no Energy while its unfiltered sibling parks on the identical board.
    const state = ready(32, { basics: 0, specials: 2, ownBench: 2 });
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: HURRICANE,
    });
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_MOVED")).toHaveLength(0);

    const { state: parked } = mustApply(ready(32, { basics: 0, specials: 2, ownBench: 2 }), {
      type: "attack",
      seat: "p1",
      index: VOLT_CYCLONE,
    });
    expect(parkedMove(parked).movable).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE GATE — which this family does NOT reach, said out loud
// ─────────────────────────────────────────────────────────────────────────────

describe("programPlayable — the gate and the op read the SAME endpoints", () => {
  it("agrees with the park on every board: no source, no destination, or both", () => {
    // `moveEnergyPlayable` and the park both go through `moveEndpoints`, which is
    // the one-rule-two-readers arrangement that helper exists for — the gate and
    // the play disagreeing is how a card becomes playable and then does nothing.
    // Driven for the NEW route rather than assumed from the shared helper.
    const both = ready(41, { basics: 1, ownBench: 2 });
    const noBench = ready(42, { basics: 1, ownBench: 0 });
    const noEnergy = ready(43, { basics: 0, ownBench: 2 });
    expect(programPlayable(both, CLAUSES[ANY].program, "p1")).toBe(true);
    expect(programPlayable(noBench, CLAUSES[ANY].program, "p1")).toBe(false);
    expect(programPlayable(noEnergy, CLAUSES[ANY].program, "p1")).toBe(false);
    // …and the filtered arm refuses a board the unfiltered one accepts.
    const specialOnly = ready(44, { basics: 0, specials: 1, ownBench: 2 });
    expect(programPlayable(specialOnly, CLAUSES[ANY].program, "p1")).toBe(true);
    expect(programPlayable(specialOnly, CLAUSES[BASIC].program, "p1")).toBe(false);
  });

  it("✅ NO NEW `programPlayable` ARM WAS OWED, and that is a MEASURED result", () => {
    // ⚠️ THE HANDOFF THIS SLICE INHERITED ASKED FOR ONE ARM AND THE ANSWER IS
    // ZERO, WHICH IS WHY THE SLICE MOVED. The gate is a CARD-PLAY gate — it runs
    // for `playTrainer`, `useAbility` and `useStadiumAbility` — and all 13 legal
    // printings of this family are ATTACK text, which is declared against its
    // Energy cost (§8) and never reaches this function at all. The op nonetheless
    // answers correctly if a registry row ever authors it (the case above), which
    // is the difference between "no arm needed" and "a hole".
    //
    // 🛑 AND THE SAME ANSWER RETIRED THE PREVIOUS RESUME POINT: D227 left an
    // `opponentSwitchOut` arm unwritten as speculative, and the printing that was
    // supposed to make it reachable — Samurott `sv10.5w-023`/`-107`'s Ability —
    // does NOT, because its op sits inside a `recordGate` this gate deliberately
    // does not descend into (only `coinFlipGate.then` is scanned) and its
    // ANTECEDENT is a `switchActive` the gate already refuses. Asserted here so
    // the finding is a red-able fact rather than a paragraph in a doc.
    const samurott: EffectOp[] = [
      { op: "switchActive", recordAs: "moved" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      { op: "recordGate", slot: "moved", then: [{ op: "opponentSwitchOut" }] },
    ];
    // An empty own Bench: the antecedent cannot happen, so the Ability is refused
    // — by `switchActive`'s existing arm, with no `opponentSwitchOut` arm involved.
    const noBench = ready(45, { basics: 1, ownBench: 0 });
    expect(programPlayable(noBench, samurott, "p1")).toBe(false);
    // An own Bench and an EMPTY opponent Bench: the card does the first half of
    // what it prints, so it stays playable — which is exactly what a speculative
    // `opponentSwitchOut` arm would have broken.
    let state = ready(46, { basics: 1, ownBench: 2 });
    state = clearBench(state, "p2");
    expect(state.players.p2.bench).toHaveLength(0);
    expect(programPlayable(state, samurott, "p1")).toBe(true);
    // …and the bare op at TOP level is not gated either, which is the arm that was
    // declined: the gate has no `opponentSwitchOut` line, so an empty opponent
    // Bench does not refuse it. Recorded as behaviour so a future arm has to argue
    // with a test rather than with a comment.
    expect(programPlayable(state, [{ op: "opponentSwitchOut" }], "p1")).toBe(true);
  });
});
