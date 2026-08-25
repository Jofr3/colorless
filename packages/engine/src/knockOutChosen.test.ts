import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import { deriveAttackEffect } from "./effects";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { conditionHolds, knockOutChosenTargets, runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  activeUid,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";
import { koByEffectMarker } from "./types";

// 🆕🆕 D416 — §8.1, THE KNOCK OUT THAT IS A *CHOICE*.
//
//   "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon.
//    If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."          (4)
//   "Knock Out 1 of your opponent's Pokémon that has exactly 6 damage
//    counters on it."                                                          (2)
//
// — 2 sentences / 6 legal printings on ONE new `EffectOp`, `knockOutChosen`, and
// the two sentences were BUILT TOGETHER ON PURPOSE.
//
// 🛑 **BECAUSE `target` IS A REQUIRED FIELD ON A *PARKING* OP, AND A PARKING OP'S
// FIELDS ARE PERSISTED.** The op rides `phase.cont.pendingOp` while the pick is
// open. Shipping the counter sentence alone would have put a two-member union on
// the wire with exactly ONE member ever exercised — and a union whose second
// member is first written after the first is already persisted is how a field
// turns out to be the wrong shape *after* it is the wrong shape. The two printed
// producers disagree about scope in print: the coin's TAILS arm names the BENCH,
// the counter sentence names the whole opponent board. Both members are live from
// the first commit, and §3 and §4 below are those two boards.
//
// 🛑 **THE COMPARATOR IS IN THE FIELD NAME, AND THAT IS THE SAME ARGUMENT.** Only
// *"exactly"* prints anywhere in the corpus, so a `{ comparator, count }` selector
// would be vocabulary no card prints (D135's trap). A bare `damageCounters` would
// have to be RENAMED the day *"at least"* prints — and a rename on a PARKING op is
// a `MATCH_RECORD_VERSION` bump (`damageChosen.source`, 2 → 3; D309's rename bump).
// `damageCountersExactly` makes the future sentence a WIDENING instead.
//
// ✅ **AND IT BUMPS NOTHING (still 26)**, which is D307's paragraph in `match.ts`
// reached again: that slice shipped a new PARKING op AND a new prompt value at no
// cost, because the constant gates records written by an OLDER deploy and no v26
// deploy can author `{ op: "knockOutChosen", … }`. This op adds less than D307's
// did — the EXISTING `choosePokemon` prompt with no new key, the EXISTING
// `KNOCKED_OUT` event through §8.1's own sweep, and D414's EXISTING
// `koByEffect:<turn>` string in the EXISTING `markers: string[]`.
//
// ⚠️ **WHAT THIS SLICE DID *NOT* HAVE TO BUILD IS THE INTERESTING HALF.**
//   • `flow.ts` — NOTHING. `lethalRefs`, `koRecoilOf` and `byAttackFor` all
//     already scan the Active AND the Bench, so a BENCHED body carrying D414's
//     non-damage marker is classified correctly for free. §6 drives that rather
//     than trusting it: it is the first time in this engine that a benched body
//     on the DEFENDER's board becomes lethal without being damaged.
//   • `cardplay.ts` — NOTHING. `validateChoice`'s `choosePokemon` arm reads the
//     PROMPT and nothing else, and `programPlayable` is never reached (§8: both
//     producers are attacks).
//   • the shared Knock Out body — `doomBodyAt`, factored out of `knockOutSelf`
//     (D345) and `knockOutDefender` (D414) because this is the first op that can
//     name a body that is neither its own host nor an Active.
//
// ⚠️ **FIXTURE_POOL IS UNTOUCHED — D190's local-pool idiom, D275's `cardPool`**,
// and this file brings its OWN deck for the reason `knockOutDefender.test.ts`
// states in its own header: that suite's §6 carries a NINE-SEED table measured on
// `KO_DEFENDER_DECK`'s shuffle, so a row added there moves an install flip nobody
// in this file can see. §3's `TAILS_SEEDS` is this file's own such table, measured
// on `KO_CHOSEN_DECK` and pinned by its own case.

// ── the printed sentences, verbatim off `censusAttackCorpus.ts` ──────────────

/** 4 printings (`censusAttackCorpus.ts` line 242). ONE `coinFlipGate` with BOTH
    arms filled: the printed *"If tails, …"* is D269's `otherwise`, a second
    consequent on the SAME coin rather than a second flip. */
const FLIP_KO_TEXT =
  "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.";
/** 2 printings (`censusAttackCorpus.ts` line 391). The ONLY sentence in the family
    whose scope is the opponent's WHOLE board — which is what makes
    `target: "opponentAny"` a live member rather than a forecast. */
const SIX_COUNTERS_TEXT =
  "Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it.";

// ── the local pool (FIXTURE_POOL untouched — D190's idiom, D275's `cardPool`) ─

const LOCAL_CARDS: Record<string, Card> = {
  /** 🛑 THE COIN DEMONSTRATOR, AND ITS TWO ATTACKS ARE A CONTROL PAIR. Both cost
      {C}, so ONE `fix-energy` pays either and no board differs by an attached card
      between the effect Knock Out and the damage one:

        idx 0 "Coin Cull" — NO printed damage at all, so the §8.5 pipeline is never
          entered and the ONLY thing that can make anything on the far side lethal
          is the op. A demonstrator that also hit would leave "was it the damage?"
          answerable two ways on every board below.
        idx 1 "Plain Bite" — 200 flat, no effect text: the ordinary attack Knock
          Out every 🛑 case is measured against.

      200 HP so that nothing in this deck (Vengeful Punch's 40 included) can kill
      the attacker mid-case and take a board into §14. */
  "fix-koc-flip": battler("fix-koc-flip", {
    hp: 200,
    attacks: [
      { cost: ["Colorless"], name: "Coin Cull", effect: FLIP_KO_TEXT },
      { cost: ["Colorless"], name: "Plain Bite", damage: 200 },
    ],
  }),
  /** The counter-window demonstrator, built as the SAME control pair and for the
      same reason. Separate from `fix-koc-flip` so a §4 board can never be read as
      a §3 one, and so no board has both sentences reachable at once. */
  "fix-koc-six": battler("fix-koc-six", {
    hp: 200,
    attacks: [
      { cost: ["Colorless"], name: "Counter Cull", effect: SIX_COUNTERS_TEXT },
      { cost: ["Colorless"], name: "Plain Bite", damage: 200 },
    ],
  }),
  /** The victim: a BASIC at 120 HP, no attacks. 120 > 70, so a body parked at the
      SEVEN-counter near-miss is still comfortably alive and its survival is the
      window's doing rather than arithmetic's; 120 < 200 so Plain Bite kills it. */
  "fix-koc-basic": battler("fix-koc-basic", { hp: 120 }),
  /** A SECOND, DISTINGUISHABLE Basic victim — the two-candidate park needs two
      bodies a reader can tell apart in an assertion, and a park is the one ending
      that cannot be reached with one. */
  "fix-koc-basic2": battler("fix-koc-basic2", { hp: 120 }),
  /** ⚠️ THE NEGATIVE CONTROL FOR *BOTH* HALVES OF THE PRINTED WORD "Basic": the
      heads arm's target restriction (§2) and the tails arm's candidate narrowing
      (§3). Same HP, same retreat, same (absent) attacks as `fix-koc-basic` — the
      ONLY thing that differs is `stage`, so nothing else can be doing the work
      when it is passed over. */
  "fix-koc-stage1": battler("fix-koc-stage1", {
    hp: 120,
    stage: "Stage1",
    evolveFrom: "fix-koc-basic",
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270's rule), 60 counted before the first run:
    4+4+6+4+6+4+4+4+10+14. Every non-local entry earns its place:
      • `fix-mist-energy` — Mist Energy, an ENERGY-borne
        `preventAttackEffects`: the §11 shield §5 needs, and the ONLY shield in the
        pool that can be put on a BENCHED body by surgery alone (no coin, so this
        file's one seed table stays §3's);
      • `sv03-197` Vengeful Punch — the KO-conditioned recoil §6 reads, reused
        rather than re-fixtured so this suite and `vengefulPunch.test.ts` argue
        about the same card;
      • `fix-titan` — 340 HP, no attacks: a promote target and a bench filler no
        attack in this deck can Knock Out, so a board has exactly the KOs it means;
      • `fix-bigbody` — 200 HP: the DOMINANT mulligan-free starter on both seats,
        so no case needs a seed search to get past setup;
      • `fix-energy` — Colorless Basic: every printed cost in this deck is {C}. */
const KO_CHOSEN_DECK = deckOf({
  "fix-koc-flip": 4,
  "fix-koc-six": 4,
  "fix-koc-basic": 6,
  "fix-koc-basic2": 4,
  "fix-koc-stage1": 6,
  "fix-mist-energy": 4,
  "sv03-197": 4,
  "fix-titan": 4,
  "fix-bigbody": 10,
  "fix-energy": 14,
});

const COIN_CULL = 0;
const COUNTER_CULL = 0;
const PLAIN_BITE = 1;

/** The two ops the deriver produces, spelled once so §3/§4/§5 can drive the
    funnel DIRECTLY as well as through a board. Typed against the union rather
    than inferred, so a field that changed name here fails to compile instead of
    silently becoming an excess property. */
const BENCH_BASIC_OP = {
  op: "knockOutChosen",
  target: "opponentBench",
  basicOnly: true,
} as const satisfies Extract<EffectOp, { op: "knockOutChosen" }>;
const ANY_SIX_OP = {
  op: "knockOutChosen",
  target: "opponentAny",
  damageCountersExactly: 6,
} as const satisfies Extract<EffectOp, { op: "knockOutChosen" }>;

/** D414's revenge clause, spelled once. §6 drives the READER rather than only
    the mark, because the mark is a means and the gate is the end. */
const BY_ATTACK = { kind: "yourPokemonKoedOnOpponentsLastTurn", byAttack: true } as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: KO_CHOSEN_DECK, p2: KO_CHOSEN_DECK },
    cardPool: POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. P1's
    Active is `attacker` with the one {C} either of its attacks costs; P2's Active
    is `victim` and P2's Bench is EXACTLY `bench`, in order — every case below
    states its own opponent board rather than inheriting one, because "which
    bodies are candidates" is the whole subject of this suite. */
function armed(
  seed: number,
  attacker: string,
  victim: string,
  bench: readonly string[],
): GameState {
  let state = must(applyAction(localSetup(seed, "p2"), { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", attacker);
  state = clearBench(state, "p1");
  // P1 keeps ONE benched body: an emptied Active Spot on the attacker's side would
  // end the game rather than the turn, and no case here is about §14.
  state = benchFromDeck(state, "p1", "fix-titan");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", victim);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

/** Walk the §8.1 stages a Knock Out queues — Prize, then promotion — and hand back
    the board on the seat-after turn. `knockOutDefender.test.ts`'s `settle`
    verbatim, so the two suites' post-KO boards are comparable. */
function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count } = next.phase;
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat,
          prizeIndices: Array.from({ length: count }, (_, i) => i),
        }),
      );
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

/** The parked prompt, or a throw — every §3/§4/§5 park case reads its candidates
    through this, so "it parked" and "it parked on THIS set" are one assertion. */
function parkedOn(state: GameState): { candidates: readonly unknown[]; note: string } {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE DERIVER. Two programs, asserted as exact equality.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 the deriver — two sentences, six printings, one parking op", () => {
  it("derives the coin sentence to ONE gate with BOTH arms filled", () => {
    // 🛑 PROGRAM EQUALITY, NOT A NON-NULL. Three different half-right arms satisfy
    // a non-null and are each catastrophically wrong: one that drops the heads
    // gate Knocks Out every Active in the format, one that drops `basicOnly`
    // Knocks Out Evolutions the sentence does not name, and one that spells the
    // tails arm as a SECOND `coinFlipGate` flips two coins where the card prints
    // one and desynchronises `rngState`.
    expect(deriveAttackEffect(FLIP_KO_TEXT)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "conditionGate",
            cond: { kind: "opponentActiveIsBasic" },
            // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
            then: [{ op: "knockOutDefender" }],
          },
        ],
        otherwise: [{ op: "knockOutChosen", target: "opponentBench", basicOnly: true }],
      },
    ]);
  });

  it("derives the counter sentence to ONE op scoped to the WHOLE opponent board", () => {
    // ⚠️ `opponentAny` IS THE ASSERTION HERE. The printed noun is "1 of your
    // opponent's **Pokémon**" with no zone word at all, and the sentence directly
    // above prints "**Benched**" — two sentences, two scopes, one required field.
    expect(deriveAttackEffect(SIX_COUNTERS_TEXT)).toEqual([
      { op: "knockOutChosen", target: "opponentAny", damageCountersExactly: 6 },
    ]);
  });

  it("reads the printed counter COUNT rather than a constant, and refuses a printed 0", () => {
    // The pool prints only 6 today, so a hard-coded 6 passes every board in this
    // file and this is the one place it cannot hide.
    expect(deriveAttackEffect(SIX_COUNTERS_TEXT.replace("exactly 6", "exactly 3"))).toEqual([
      { op: "knockOutChosen", target: "opponentAny", damageCountersExactly: 3 },
    ]);
    // …and the `>= 1` guard: a printed 0 is a window that admits every UNDAMAGED
    // body on the opponent's board, which is the loudest way for a Knock Out to be
    // wrong. The loud ATTACK_EFFECT_SKIPPED path is the correct behaviour.
    expect(deriveAttackEffect(SIX_COUNTERS_TEXT.replace("exactly 6", "exactly 0"))).toBeNull();
  });

  it("is anchored end to end — both sentences, both ends", () => {
    for (const text of [FLIP_KO_TEXT, SIX_COUNTERS_TEXT]) {
      expect(deriveAttackEffect(`Flip a coin. If heads, ${text}`)).toBeNull();
      expect(deriveAttackEffect(text.replace(/\.$/, ""))).toBeNull();
      expect(deriveAttackEffect(text.toLowerCase())).toBeNull();
      expect(deriveAttackEffect(`${text} Draw a card.`)).toBeNull();
    }
  });

  it("🛑 D136/D137 — both apostrophe spellings derive the SAME program", () => {
    // 🛑 THE RULE THE TWO D414 ANCHORS IN THIS FAMILY BROKE. The catalog prints
    // BOTH `'` and U+2019, so an anchor spelling only one silently un-derives its
    // printings the day a punctuation-normalising re-ingest runs — and it fails
    // SILENTLY, onto the loud skip path where nothing counts it. D414 shipped two
    // anchors without the class and it was caught by a suite author noticing the
    // asymmetry rather than by any rung; both of this slice's carry it from the
    // first draft, and the FLIP sentence carries it TWICE (one possessive per arm),
    // which is what this loop's second half is for.
    //
    // ⚠️ ASSERTED AS PROGRAM EQUALITY, not as a non-null: an anchor that resolved
    // the curly form to some OTHER program would satisfy a non-null and be wrong.
    for (const text of [FLIP_KO_TEXT, SIX_COUNTERS_TEXT]) {
      const curly = text.replace(/'/g, "’");
      expect(curly).not.toBe(text);
      expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(text));
      expect(deriveAttackEffect(curly)).not.toBeNull();
    }
    // …and ONE possessive folded while the other stays straight, which is the
    // board a single `['’]` in a two-possessive anchor actually produces.
    const mixed = FLIP_KO_TEXT.replace("opponent's Active", "opponent’s Active");
    expect(mixed).toContain("opponent’s Active");
    expect(mixed).toContain("opponent's Benched");
    expect(deriveAttackEffect(mixed)).toEqual(deriveAttackEffect(FLIP_KO_TEXT));
  });

  it("keeps the local fixtures' printed text verbatim — the sentence IS the wiring", () => {
    // On the deriver path a one-character drift does not throw: the card drops onto
    // ATTACK_EFFECT_SKIPPED with no other failure anywhere, so the bytes get pinned.
    expect(LOCAL_CARDS["fix-koc-flip"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Coin Cull",
      effect: FLIP_KO_TEXT,
    });
    expect(LOCAL_CARDS["fix-koc-six"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Counter Cull",
      effect: SIX_COUNTERS_TEXT,
    });
    for (const text of [FLIP_KO_TEXT, SIX_COUNTERS_TEXT]) {
      expect(text).toContain("opponent's");
      expect(text).toContain("Pokémon");
      expect(text).not.toContain("’");
    }
  });

  it("the deck is 60 and every id resolves in the LOCAL pool", () => {
    expect(KO_CHOSEN_DECK).toHaveLength(60);
    for (const id of new Set(KO_CHOSEN_DECK)) expect(POOL[id], id).toBeDefined();
    // FIXTURE_POOL is untouched — the local demonstrators exist ONLY here.
    for (const id of Object.keys(LOCAL_CARDS)) expect(FIXTURE_POOL[id], id).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE COIN, and A's HEADS arm (which is D414's arm 6a byte for byte).
// ─────────────────────────────────────────────────────────────────────────────

/** Seeds on which "Coin Cull"'s single flip comes up TAILS, measured over [1..24]
    on `KO_CHOSEN_DECK` — pinned by its own case below, so a deck edit that shifts
    the shuffle fails loudly instead of silently turning §3 vacuous. The flip is
    the first and only coin either board draws and the surgeries consume no rng, so
    the face is a property of the seed and the deck alone. */
const TAILS_SEEDS: readonly number[] = [1, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 21, 24];
/** …and its complement over the same range, so "both faces are reachable" is a
    measurement rather than an assumption.

    ⚠️ **IT IS THE SAME NINE-SEED LIST `knockOutDefender.test.ts` AND
    `preventBlock.test.ts` EACH MEASURED ON THEIR OWN DECKS**, which is a fact
    about the seam rather than a coincidence and is named here so a reader who
    notices it does not suspect a copied constant: this gate's flip is the FIRST
    coin this board draws after setup, exactly as their install flip is, and no
    surgery in any of the three files consumes rng — so the face is a property of
    the SEED alone and not of the deck. */
const HEADS_SEEDS: readonly number[] = [2, 3, 6, 7, 16, 18, 20, 22, 23];

function coinFace(seed: number, bench: readonly string[]): "heads" | "tails" {
  const board = armed(seed, "fix-koc-flip", "fix-koc-basic", bench);
  const { events } = mustApply(board, { type: "attack", seat: "p1", index: COIN_CULL });
  const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
  if (flip === undefined) throw new Error(`seed ${seed} flipped no coin`);
  return flip.result;
}

describe("§2 the coin and the HEADS arm — the Active, and only if it is Basic", () => {
  it("the seed table is MEASURED, and both faces are reachable", () => {
    // Without this the two arms could each be driven on a face nobody checked was
    // the face they got — and a suite in which one arm never runs passes forever.
    const tails: number[] = [];
    const heads: number[] = [];
    for (let seed = 1; seed <= 24; seed += 1) {
      (coinFace(seed, ["fix-koc-basic2"]) === "tails" ? tails : heads).push(seed);
    }
    expect(tails).toEqual([...TAILS_SEEDS]);
    expect(heads).toEqual([...HEADS_SEEDS]);
    expect(TAILS_SEEDS.length).toBeGreaterThan(0);
    expect(HEADS_SEEDS.length).toBeGreaterThan(0);
  });

  it("HEADS Knocks Out a BASIC Active — no damage anywhere in it", () => {
    const before = armed(headsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const victim = activeUid(before, "p2");
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    // The op is not damage and must not pretend to be.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // …and the heads arm asked NOTHING: the target is named by the print.
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 HEADS against a NON-Basic Active does nothing — and the bench is not a fallback", () => {
    // 🛑 THE NEGATIVE CONTROL THE HEADS ARM EXISTS FOR, AND A RULES READING RATHER
    // THAN AN ATTESTED FACT. `knockOutDefender` checks only that an Active EXISTS;
    // the printed noun is "your opponent's Active **Basic** Pokémon". Nothing in
    // this tree settles whether that adjective RESTRICTS the target or merely
    // describes the boards these cards expect — it is read as a restriction because
    // the same adjective provably narrows a candidate SET one clause later, in the
    // tails arm. So it is DRIVEN, on a board whose only difference from the case
    // above is the victim's `stage`.
    const before = armed(headsSeed(), "fix-koc-flip", "fix-koc-stage1", ["fix-koc-basic2"]);
    const survivor = activeUid(before, "p2");
    const benched = benchTopUid(before, "p2", 0);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    expect(types(events)).not.toContain("KNOCKED_OUT");
    // Not merely un-Knocked-Out — UNTOUCHED. The op marks lethal against
    // `effectiveMaxHp`, so a gate that fired and was undone would leave 120 damage
    // sitting on a 120 HP body.
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
    expect(state.players.p2.active?.stack).toContain(survivor);
    // 🛑 AND THE HEADS ARM DID NOT FALL THROUGH TO THE TAILS ONE. A declined gate
    // is not a tails result: the benched Basic is standing and no prompt is open.
    expect(state.players.p2.bench[0]?.stack).toContain(benched);
    expect(state.players.p2.bench[0]?.damage).toBe(0);
    expect(state.phase.kind).toBe("turn:action");
    // The attack RESOLVED — a gate answering "no" is not a skipped effect.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the ORDINARY attack kills the same Stage 1 — the gate is about the OP, not the body", () => {
    // ⚠️ WITHOUT THIS THE CONTROL IS AMBIGUOUS: "nothing happened against a Stage
    // 1" could mean the gate declined OR that this fixture is somehow unkillable.
    const before = armed(6, "fix-koc-flip", "fix-koc-stage1", ["fix-koc-basic2"]);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 200 });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — A's TAILS arm: `parkOrForce`'s three endings, on the BENCH.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 the TAILS arm — nothing / forced / parked, over the opponent's BENCH", () => {
  it("🛑 an EMPTY opponent Bench is a SILENT no-op — but the coin still flipped", () => {
    // 🛑 `parkOrForce`'s ZERO arm, and the assertion that makes it a claim rather
    // than a tautology is the SECOND half: an op that silently does nothing and an
    // attack that never ran produce the same board, and only the COIN row tells
    // them apart. §8.6's "do as much as you can" — there is nothing to ask about,
    // so nothing is asked and nothing is announced beyond the flip the card told
    // the player to watch.
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", []);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")).toEqual({
      type: "ATTACK_EFFECT_COIN_FLIP",
      seat: "p1",
      result: "tails",
    });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // Nothing parked, nothing died, and the turn ended normally.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench).toHaveLength(0);
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p1.prizes).toHaveLength(6);
  });

  it("🛑 ONE candidate is FORCED — no prompt, and it is the BENCHED body", () => {
    // 🛑 `parkOrForce`'s ONE arm (the M1 no-choice rule: a question with one answer
    // is not a question) AND the scope claim in one board. P2's ACTIVE is a Basic
    // too, so an `opponentAny` scope would find TWO candidates here and PARK. It
    // does not: the print says "Benched", the field says `opponentBench`, and the
    // Active walks away.
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const active = activeUid(before, "p2");
    const benched = benchTopUid(before, "p2", 0);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    // 🛑 THE ACTIVE IS UNTOUCHED — the whole of "Benched", on a board where the
    // Active is an eligible Basic and would have been the other candidate.
    expect(state.players.p2.active?.stack).toContain(active);
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
    // The Prize is PROMPTED and the LOSING seat owes NO promotion: a benched Knock
    // Out leaves the Active Spot occupied, which is the half §8.1 gets for free.
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const settled = settle(state);
    expect(settled.players.p1.prizes).toHaveLength(5);
    expect(settled.players.p2.discard).toContain(benched);
    expect(settled.players.p2.bench).toHaveLength(0);
    expect(settled.players.p2.active?.stack).toContain(active);
  });

  it("🛑 TWO candidates PARK on `choosePokemon`, and the answer resolves the picked one", () => {
    // 🛑 `parkOrForce`'s ≥2 arm — the only ending that produces a decision, and the
    // reason this op is a PARKING op at all (which is what makes `target` a
    // PERSISTED required field; see the header).
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-basic",
      "fix-koc-basic2",
    ]);
    const first = benchTopUid(before, "p2", 0);
    const second = benchTopUid(before, "p2", 1);
    deepFreeze(before);

    const { state: parked, events: parkEvents } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COIN_CULL,
    });

    const { candidates, note } = parkedOn(parked);
    expect(candidates).toEqual([
      { seat: "p2", spot: { spot: "bench", index: 0 } },
      { seat: "p2", spot: { spot: "bench", index: 1 } },
    ]);
    // The caption names EXACTLY the set the funnel offered, in the card's own word
    // order — a dialog that said anything else would contradict its own validator.
    expect(note).toBe("Knock Out 1 of your opponent's Benched Basic Pokémon.");
    // Nothing has died yet: the epilogue is waiting behind the decision.
    expect(types(parkEvents)).not.toContain("KNOCKED_OUT");
    expect(parked.players.p2.bench).toHaveLength(2);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 1 } } },
    });

    // The PICKED body died and the other one did not — a park that resolved the
    // wrong ref, or both, passes a "something was Knocked Out" assertion.
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: second });
    const settled = settle(done);
    expect(settled.players.p2.discard).toContain(second);
    expect(settled.players.p2.discard).not.toContain(first);
    expect(settled.players.p2.bench).toHaveLength(1);
    expect(settled.players.p2.bench[0]?.stack).toContain(first);
  });

  it("🛑 `basicOnly` drops a benched EVOLUTION — one candidate left, so it FORCES", () => {
    // Same two-body Bench as the park above with ONE card swapped for its Stage 1.
    // An op that ignored `basicOnly` would park with two candidates here; one that
    // honoured it forces onto the single Basic. The two endings are distinguishable
    // in one assertion, which is why this board carries exactly two bodies.
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-stage1",
      "fix-koc-basic2",
    ]);
    const evolution = benchTopUid(before, "p2", 0);
    const basic = benchTopUid(before, "p2", 1);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: basic });
    const settled = settle(state);
    expect(settled.players.p2.discard).toContain(basic);
    expect(settled.players.p2.bench).toHaveLength(1);
    expect(settled.players.p2.bench[0]?.stack).toContain(evolution);
    expect(settled.players.p2.bench[0]?.damage).toBe(0);
  });

  it("🛑 a Bench of NOTHING BUT Evolutions is the ZERO arm again — narrowed to empty", () => {
    // The composition of the two riders' endings: `basicOnly` can empty a NON-empty
    // Bench, and an emptied candidate set is `parkOrForce`'s whiff. Without this
    // case the previous one is satisfied by an implementation that narrows only
    // when at least one candidate survives.
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-stage1",
      "fix-koc-stage1",
    ]);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench).toHaveLength(2);
    expect(state.players.p2.bench.every((p) => p.damage === 0)).toBe(true);
  });

  it("the FUNNEL itself, asked directly — scope and rider, on one board", () => {
    // The same claims one level down, where the two riders can be swapped
    // independently of a coin. `knockOutChosenTargets` is exported for exactly this
    // (and for the `programPlayable` gate the day a registry row prints this op).
    const board = armed(1, "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2", "fix-koc-stage1"]);
    expect(knockOutChosenTargets(board, "p1", BENCH_BASIC_OP)).toEqual([
      { seat: "p2", spot: { spot: "bench", index: 0 } },
    ]);
    // Unnarrowed, the SAME scope keeps the Evolution…
    expect(
      knockOutChosenTargets(board, "p1", { op: "knockOutChosen", target: "opponentBench" }),
    ).toHaveLength(2);
    // …and the OTHER scope leads with the Active (`oppAnyRefs`' order, so a forced
    // single-candidate board reads naturally).
    expect(
      knockOutChosenTargets(board, "p1", { op: "knockOutChosen", target: "opponentAny" }),
    ).toEqual([
      { seat: "p2", spot: { spot: "active" } },
      { seat: "p2", spot: { spot: "bench", index: 0 } },
      { seat: "p2", spot: { spot: "bench", index: 1 } },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — B: the damage-counter window, over the WHOLE opponent board.
// ─────────────────────────────────────────────────────────────────────────────

/** P1 fields the counter demonstrator; P2's Active and Bench take the damage the
    case names (in HP — a counter is ten of it, which is the whole subject here). */
function counterBoard(
  seed: number,
  activeDamage: number,
  bench: readonly { id: string; damage: number }[],
): GameState {
  let state = armed(
    seed,
    "fix-koc-six",
    "fix-koc-basic",
    bench.map((b) => b.id),
  );
  state = setDamage(state, "p2", activeDamage);
  bench.forEach((b, index) => {
    state = setBenchDamage(state, "p2", index, b.damage);
  });
  return state;
}

describe("§4 the counter window — EXACTLY six, and the two near-misses", () => {
  it("🛑 sixty HP of damage is SIX counters and is Knocked Out — Active included", () => {
    // 🛑 `opponentAny` IS THE ASSERTION. The candidate is the opponent's ACTIVE and
    // the Bench holds nothing eligible, so a `opponentBench` scope finds zero and
    // silently does nothing — the exact board the two-member union exists for.
    const before = counterBoard(1, 60, [{ id: "fix-koc-basic2", damage: 0 }]);
    const victim = activeUid(before, "p2");
    deepFreeze(before);

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });

    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // One candidate, so no prompt: the M1 rule again, one op over.
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("🛑 FIVE counters and SEVEN counters are BOTH passed over", () => {
    // 🛑 THE TWO NEAR-MISSES ARE ONE ASSERTION AND THEY BRACKET THE WINDOW. Five
    // alone is satisfied by `>= 6`; seven alone by `<= 6`; a body at each, on one
    // board with no sixth counter anywhere, is satisfied only by equality.
    const before = counterBoard(50, 50, [
      { id: "fix-koc-basic", damage: 70 },
      { id: "fix-koc-basic2", damage: 0 },
    ]);
    deepFreeze(before);

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.phase.kind).not.toBe("effect:choose");
    // Untouched rather than merely alive — the op marks lethal, so a window that
    // fired and was undone would leave the body's damage at its maximum.
    expect(state.players.p2.active?.damage).toBe(50);
    expect(state.players.p2.bench[0]?.damage).toBe(70);
    expect(state.players.p2.active?.markers).toEqual([]);
    expect(state.players.p2.bench[0]?.markers).toEqual([]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 SIXTY-FIVE HP of damage is still SIX counters — the floor, not an equality on HP", () => {
    // 🛑 `Math.floor(damage / 10) === 6` AND NOT `damage === 60`, WHICH IS THE
    // HOUSE SPELLING AND IS OBSERVABLE. `attack.ts` converts this way at three
    // sites for the printed "for each damage counter on …" scalings, and a body
    // sitting at 65 carries SIX counters by that reading — so an `=== 60` window
    // answers NO to a sentence the print answers YES to. No printing in the pool
    // can produce a 5-HP remainder today; the reading is what is being pinned.
    const before = counterBoard(2, 65, [{ id: "fix-koc-basic2", damage: 0 }]);
    const victim = activeUid(before, "p2");
    const { events } = mustApply(before, { type: "attack", seat: "p1", index: COUNTER_CULL });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
  });

  it("🛑 an UNDAMAGED board is the ZERO arm — nothing is offered and nothing dies", () => {
    // Zero counters is not six, and the whole board saying so is what stops the
    // window from being satisfiable by "any damaged body".
    const before = counterBoard(3, 0, [
      { id: "fix-koc-basic", damage: 0 },
      { id: "fix-koc-basic2", damage: 0 },
    ]);
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 TWO bodies at six counters PARK — Active and Bench in one prompt", () => {
    // The ≥2 arm on the OTHER scope, and the one board that shows `oppAnyRefs`'
    // ordering reaching a real prompt: the Active leads, then the Bench in index
    // order. The near-miss body on the same Bench is absent from the candidates,
    // so this case pins the window and the scope together.
    const before = counterBoard(4, 60, [
      { id: "fix-koc-basic", damage: 60 },
      { id: "fix-koc-basic2", damage: 70 },
    ]);
    const active = activeUid(before, "p2");
    const benched = benchTopUid(before, "p2", 0);
    deepFreeze(before);

    const { state: parked } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });

    const { candidates, note } = parkedOn(parked);
    expect(candidates).toEqual([
      { seat: "p2", spot: { spot: "active" } },
      { seat: "p2", spot: { spot: "bench", index: 0 } },
    ]);
    expect(note).toBe(
      "Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it.",
    );

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
    });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    const settled = settle(done);
    expect(settled.players.p2.discard).toContain(benched);
    expect(settled.players.p2.active?.stack).toContain(active);
    expect(settled.players.p2.active?.damage).toBe(60);
  });

  it("refuses a wire answer that names a body OUTSIDE the offered set", () => {
    // `validateChoice`'s `choosePokemon` arm reads the PROMPT and nothing else,
    // which is what a P4 client is checked by — and it is why the §11 filter at the
    // funnel is sufficient and no second ask is needed on the resolve path.
    const before = counterBoard(4, 60, [
      { id: "fix-koc-basic", damage: 60 },
      { id: "fix-koc-basic2", damage: 70 },
    ]);
    const { state: parked } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 1 } } },
    });
    expect(rejected.ok).toBe(false);
  });

  it("the FUNNEL itself, asked directly — the window is on COUNTERS, not on HP", () => {
    const board = counterBoard(5, 60, [
      { id: "fix-koc-basic", damage: 50 },
      { id: "fix-koc-basic2", damage: 70 },
    ]);
    expect(knockOutChosenTargets(board, "p1", ANY_SIX_OP)).toEqual([
      { seat: "p2", spot: { spot: "active" } },
    ]);
    // The SAME board with the window moved one counter each way picks up exactly
    // one of the two near-misses — so the field is read rather than compared to a
    // constant, at the funnel as well as at the deriver.
    expect(
      knockOutChosenTargets(board, "p1", {
        op: "knockOutChosen",
        target: "opponentAny",
        damageCountersExactly: 5,
      }),
    ).toEqual([{ seat: "p2", spot: { spot: "bench", index: 0 } }]);
    expect(
      knockOutChosenTargets(board, "p1", {
        op: "knockOutChosen",
        target: "opponentAny",
        damageCountersExactly: 7,
      }),
    ).toEqual([{ seat: "p2", spot: { spot: "bench", index: 1 } }]);
    // …and with NO window every body in scope is a candidate, which is the
    // "absent = no narrowing" contract stated as a board.
    expect(
      knockOutChosenTargets(board, "p1", { op: "knockOutChosen", target: "opponentAny" }),
    ).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §11. A shielded body is not OFFERED (a FILTER, not a guard).
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 §11 — `unshieldedRefs` filters the CANDIDATES, it does not refuse the op", () => {
  it("🛑 a shielded benched Basic is NOT offered — the other one is FORCED instead", () => {
    // 🛑 D259's finding, reached by a Knock Out for the first time: refusing the op
    // WHOLE would mean one shielded body on a five-body Bench protecting the whole
    // Bench, a rule no printing states. Filtering is what "done to this Pokémon"
    // says, and it falls out of `parkOrForce` for free — this board would PARK with
    // two candidates and instead FORCES onto the one that is not shielded.
    let before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-basic",
      "fix-koc-basic2",
    ]);
    before = attachBenchFromDeck(before, "p2", 0, "fix-mist-energy", 1);
    const shielded = benchTopUid(before, "p2", 0);
    const exposed = benchTopUid(before, "p2", 1);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toEqual({
      type: "ATTACK_EFFECT_PREVENTED",
      seat: "p2",
      uid: shielded,
    });
    // FORCED, not parked: the shielded body left the candidate set before
    // `parkOrForce` counted it.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: exposed });
    const settled = settle(state);
    expect(settled.players.p2.bench).toHaveLength(1);
    expect(settled.players.p2.bench[0]?.stack).toContain(shielded);
    expect(settled.players.p2.bench[0]?.damage).toBe(0);
    expect(settled.players.p2.bench[0]?.markers).toEqual([]);
  });

  it("🛑 THE CONTROL — the SAME board with the Energy removed PARKS with both", () => {
    // Without this the case above is satisfied by a build that cannot offer bench
    // index 0 at all. One card is stripped and nothing else moves.
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-basic",
      "fix-koc-basic2",
    ]);
    const { state: parked } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });
    expect(parkedOn(parked).candidates).toHaveLength(2);
  });

  it("🛑 the ONLY candidate being shielded is the ZERO arm — nothing dies", () => {
    // An emptied candidate set is a whiff, which is the third of `parkOrForce`'s
    // endings reached by the shield rather than by the board.
    let before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    before = attachBenchFromDeck(before, "p2", 0, "fix-mist-energy", 1);
    const shielded = benchTopUid(before, "p2", 0);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2", uid: shielded });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench[0]?.damage).toBe(0);
    expect(state.players.p2.bench[0]?.markers).toEqual([]);
  });

  it("🛑 …and on the OTHER scope: a shielded ACTIVE at six counters is passed over", () => {
    // The same filter reaching the Active through `opponentAny`, which is the arm
    // `unshieldedRefs` never saw before this op: every earlier candidate-set caller
    // (`gust`, `returnBenched`, `opponentSwitchOut`) offers a BENCH only.
    let before = counterBoard(6, 60, [{ id: "fix-koc-basic", damage: 60 }]);
    before = attachFromDeck(before, "p2", "fix-mist-energy", 1);
    const active = activeUid(before, "p2");
    const benched = benchTopUid(before, "p2", 0);
    deepFreeze(before);

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });

    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2", uid: active });
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    expect(state.players.p2.active?.stack).toContain(active);
    expect(state.players.p2.active?.damage).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — 🛑 THE CLAIM THIS SLICE MADE ABOUT `flow.ts`: it needed NOTHING.
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 §6 the BENCHED non-damage Knock Out — `flow.ts` needed nothing, driven", () => {
  it("stamps D414's marker on a BENCHED body and marks it lethal where it stands", () => {
    // 🛑 DRIVEN THROUGH `runProgram` RATHER THAN THROUGH AN ATTACK, and the reason
    // is observability rather than convenience — `knockOutDefender.test.ts` §5's
    // seam, one zone over: on a real attack the marked body is discarded by §8.1
    // inside the same reduction, so there is no state in which a test can read the
    // marker it wrote.
    //
    // 🛑 THIS IS THE FIRST TIME IN THIS ENGINE A BODY ON THE DEFENDER'S *BENCH*
    // BECOMES LETHAL WITHOUT BEING DAMAGED. `doomBodyAt` writes
    // `damage >= effectiveMaxHp` wherever the body stands, which is the ONE thing
    // §8.1's sweep reads — so the Prize, the whole-stack discard, `KNOCKED_OUT` and
    // the promotion are all `lethalRefs`' own, with no fourth copy of any of them.
    const board = armed(1, "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const events: GameEvent[] = [];
    const result = runProgram(board, [BENCH_BASIC_OP], { seat: "p1", invokedBy: "attack" }, events);
    const doomed = result.state.players.p2.bench[0];
    expect(doomed?.markers).toEqual([koByEffectMarker(board.turn)]);
    expect(doomed?.damage).toBe(120);
    // …and the ACTIVE beside it is untouched, so the write landed on the bench slot
    // the ref named rather than on the seat's default body.
    expect(result.state.players.p2.active?.damage).toBe(0);
    expect(result.state.players.p2.active?.markers).toEqual([]);
    // ⚠️ IDEMPOTENT, `knockOutDefender`'s contract inherited through the shared
    // body: a re-run re-computes the SAME string, so `markers` does not become a log.
    const twice: GameEvent[] = [];
    const again = runProgram(
      result.state,
      [BENCH_BASIC_OP],
      { seat: "p1", invokedBy: "attack" },
      twice,
    );
    expect(again.state.players.p2.bench[0]?.markers).toEqual([koByEffectMarker(board.turn)]);
  });

  it("…and §8.1 collects it off the BENCH — Prize, discard, no promotion owed", () => {
    // The same doom through a real attack, which is where `lethalRefs`' Active-then-
    // Bench scan is the thing being claimed. A benched Knock Out leaves the Active
    // Spot occupied, so the LOSING seat owes no promotion — the ending that
    // distinguishes this from every `knockOutDefender` board.
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const active = activeUid(before, "p2");
    const benched = benchTopUid(before, "p2", 0);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const settled = settle(state);
    expect(settled.players.p1.prizes).toHaveLength(5);
    expect(settled.players.p2.discard).toContain(benched);
    expect(settled.players.p2.active?.stack).toContain(active);
    expect(settled.phase.kind).toBe("turn:action");
  });

  it("🛑 `byAttackFor` answers FALSE for it — the revenge clause is not owed", () => {
    // 🛑 THE MECHANISM D414 BOUGHT THE MARKER FOR, ON A BENCHED BODY. Four built
    // sentences / six printings read "if any of your Pokémon were Knocked Out **by
    // damage from an attack** during your opponent's last turn"; `byAttackFor` is
    // PER BODY and finds this one by scanning `[active, ...bench]`, so a benched
    // effect Knock Out is correctly not "by damage" — for free, with no `flow.ts`
    // diff in this slice. The CONTROL below is the same board one attack index over.
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const after = settle(mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL }).state);
    expect(after.phase.kind).toBe("turn:action");
    expect(conditionHolds(after, "p2", BY_ATTACK)).toBe(false);
  });

  it("🛑 …AND ON THE PARKED PATH TOO — the arm a ONE-CANDIDATE BOARD never reaches", () => {
    // 🛑 THIS CASE EXISTS BECAUSE A MUTANT SURVIVED, AND THE SURVIVOR WAS RIGHT.
    // Every other marker assertion in §6 runs on a bench of ONE, where
    // `parkOrForce` FORCES and the `applyChoice` arm is never entered — so
    // dropping the stamp from the resumed path was invisible to the whole suite
    // while looking perfectly guarded. **THE PARK IS THE POINT OF THIS OP**, and
    // the marker is what keeps D414's two mechanisms repaired, so the one path
    // that carries both had no witness at all.
    //
    // ⚠️ THE READER IS DRIVEN, NOT THE MARK. `byAttackFor` is the mechanism the
    // stamp exists for; asserting the string on the body would pass on a build
    // that stamped it somewhere nothing reads.
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-basic",
      "fix-koc-basic2",
    ]);
    const parked = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL }).state;
    // Two candidates, so this really is the parked arm and not a forced one.
    expect(parkedOn(parked).candidates).toHaveLength(2);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 1 } } },
    });
    const after = settle(done);
    expect(after.phase.kind).toBe("turn:action");
    expect(conditionHolds(after, "p2", BY_ATTACK)).toBe(false);
  });

  it("🛑 THE CONTROL — an ordinary damage Knock Out on the same board DOES owe it", () => {
    // Without this the case above is satisfied by a reader that answers false
    // always. Same deck, same seats, same attacker card — index 1 instead of 0.
    const before = armed(3, "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const after = settle(mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE }).state);
    expect(conditionHolds(after, "p2", BY_ATTACK)).toBe(true);
  });

  it("🛑 Vengeful Punch on a BENCHED holder pays NO recoil for an effect Knock Out", () => {
    // 🛑 `koRecoilOf`'s printed "by damage" — discharged by PLACEMENT until D414 and
    // by the marker since. It scans `[active, ...bench]`, so a benched Tool holder
    // reaches it; this is the first thing that can put a marker there.
    let before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    before = attachToolFromDeck(before, "p2", 0, "sv03-197");
    deepFreeze(before);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    // The attacker is untouched: 4 counters would be 40 damage on a 200 HP body.
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("🛑 THE CONTROL — the SAME benched Tool holder DOES pay when it dies to damage", () => {
    // Without this the case above is satisfied by a build in which a benched Tool
    // is simply never read. The holder is put at lethal damage by surgery — no
    // marker, so `koRecoilOf`'s narrowing lets it through — and the §8.1 sweep the
    // attack's epilogue runs collects it beside the effect Knock Out this attack
    // does NOT make (nothing on this board is at six counters).
    let before = armed(1, "fix-koc-six", "fix-koc-basic", ["fix-koc-basic2"]);
    before = attachToolFromDeck(before, "p2", 0, "sv03-197");
    before = setBenchDamage(before, "p2", 0, 120);
    deepFreeze(before);
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.players.p1.active?.damage).toBe(40);
  });
});

// The two seed helpers live at the bottom because they read the tables above and
// are used by every section — a `throw` here means the measured table went stale,
// which is the loud failure the measurement case is there to produce first.
function tailsSeed(): number {
  const seed = TAILS_SEEDS[0];
  if (seed === undefined) throw new Error("TAILS_SEEDS is empty — re-measure §2's table");
  return seed;
}
function headsSeed(): number {
  const seed = HEADS_SEEDS[0];
  if (seed === undefined) throw new Error("HEADS_SEEDS is empty — re-measure §2's table");
  return seed;
}

/** A marker spelling this file asserts rather than imports blindly: the stamp is
    `koByEffect:<turn>`, and a suite reading `markers` for emptiness (§2, §3, §5)
    is only meaningful while the non-empty form is a real string. */
describe("§7 the marker string", () => {
  it("is D414's turn stamp, unchanged", () => {
    expect(koByEffectMarker(7)).toBe("koByEffect:7");
    expect(koByEffectMarker(7)).not.toBe(koByEffectMarker(8));
  });
});
