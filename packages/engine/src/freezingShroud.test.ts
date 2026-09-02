import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── D340 — FROSLASS `sv06-053`/`sv06-174`/`svp-117` "FREEZING SHROUD", THE
//    SELF-EXEMPTING CHECKUP AURA. ────────────────────────────────────────────
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   "During Pokémon Checkup, put 1 damage counter on each Pokémon that has an
//    Ability (both yours and your opponent's), **except any Froslass**."
//   An ABILITY, `trigger: "betweenTurns"`. **3 Standard-legal printings.**
//
// ── 🛑 WHY THIS ROW AND NOT IRON CROWN EX — THE BACKLOG WAS MISPRICED ───────
// The resume point sent this session at Iron Crown ex's *"Future Pokémon,
// except any Iron Crown ex"* aura, split into a blocked half and a *"genuinely
// cheaper engine half"*. **BOTH HALVES ARE REFUSED, AND THE SECOND FOR A REASON
// THE HANDOFF HAD BACKWARDS.**
//
//   (1) THE SUBTYPE PREDICATE IS BLOCKED ON THE INGEST, re-derived at this head
//       rather than carried: `SELECT suffix, COUNT(*) FROM cards GROUP BY 1`
//       returns exactly two rows — NULL 3,157 and `ex` 629. 3,157 + 629 = 3,786
//       ✅, the whole table. **NO COLUMN CLASSIFIES THE Ancient/Future BANNER**,
//       so a `CardFilter` member for *"Future"* would have nothing to read.
//
//   (2) THE BY-NAME EXEMPTION IS NOT A MISSING CAPABILITY — **IT SHIPPED AT
//       D273.** The handoff priced it as *"a genuine engine addition, because
//       `CardFilter` has no negation member of any kind"*. The premise is TRUE
//       (the union has 19 members and `anyOf` is its only combinator — grepped,
//       not assumed) and the CONCLUSION does not follow, because this engine does
//       not negate through the filter union at all. It negates through a RIDER,
//       and it has done so TWICE and on purpose:
//         • `switchActive.exceptNamed` (D273) — Pecharunt ex `sv06.5-039`/
//           `-085`/`-093`/`-095`/`sv08.5-163`, *"except any Pecharunt ex"*, 5
//           legal and BUILT;
//         • `preventOpponentPokemonPlay.only`/`except` (D285, continuous.ts) —
//           *"except for Team Rocket's Pokémon"*, the same subtraction shape.
//       `switchActive.exceptNamed`'s own doc block PRICED the `CardFilter` route
//       and REFUSED it in writing: a `notNamed` member would need `allOf` (the
//       printed noun is an INTERSECTION) plus a `retrieveNoun` arm no printing
//       drives — *"two union members and a dead caption arm, to say what one
//       string field says"*. **D330's shape exactly: THE PIECE HAD ALREADY
//       SHIPPED**, and adding `except` to `seatDamageBonusBeforeWR` on its own
//       would be a member with NO CONSUMER, since its beneficiary noun is the
//       unreadable banner from (1).
//
// ── THE CENSUS THAT FOUND THIS ROW: THE *GRAMMAR*, NOT THE CARD ─────────────
// Re-queried against remote D1 `luminous` (3,786 rows, 2,021 `legal_standard`)
// on 2026-08-15, across ALL THREE text columns, selecting the WHOLE column.
//
//   `instr(<col>,'except any') > 0`:
//     `abilities_json`  19 rows / 14 legal
//     `attacks_json`     1 row  /  0 legal   (Simisage `sv04-005`)
//     `effect`           0 rows /  0 legal
//   TOTAL **20 printings / 14 legal**.  19 + 1 + 0 = 20 ✅  14 + 0 + 0 = 14 ✅
//
// Those 20 are **FIVE SENTENCES ON FIVE CARDS**, and only three are legal:
//     • Iron Crown ex   6 legal — BLOCKED on the banner, see (1) above
//     • Pecharunt ex    5 legal — **BUILT at D273**
//     • Froslass        3 legal — **THIS ROW**, the last legal one unbuilt
//     • Ditto ×2, Moltres/Articuno/Zapdos ×3, Simisage ×1 — `legal_standard = 0`
//   6 + 5 + 3 = 14 ✅, and 14 + 2 + 3 + 1 = 20 ✅.
//
// 🛑 **THE ILLEGAL THREE ARE THE SHARPEST NEAR-MISS THIS FAMILY HAS**: Moltres
//    `swsh10.5-012` prints *"Your Basic Fire Pokémon's attacks, **except any
//    Moltres**, do 10 more damage … (before applying Weakness and Resistance)"* —
//    Iron Crown ex's aura with a base noun the engine CAN read. It is rotated out
//    of Standard, so it buys nothing; it is named here because it is the printing
//    that would unblock `seatDamageBonusBeforeWR.exceptNamed`, and the next
//    session should not have to re-find it.
//
// ── THE SUMMAND THIS ROW MOVES, AND WHAT IT IS KEYED ON ────────────────────
// **`BUILT.ability` 249 → 252, KEYED ON LEGALITY** (all three printings are
// `legal_standard = 1`), so `built` 1,555 → 1,558 and the residue 828 → 825.
//
// ⚠️ **`BUILT.attack` STANDS STILL ON ALL THREE SUMMANDS (1,164 raw / 16
//    registry / 13 split) AND IT IS MEASURED, NOT ASSUMED.** All three ids carry
//    `effect IS NULL` against a **65-char** `attacks_json` holding a bare attack
//    with NO effect text, and a byte-identical **192-char** `abilities_json`
//    (`IS NULL` / `length()` / `category`, remote D1, 2026-08-15). So no attack
//    reader can resolve anything on any of the three, `BUILT.trainer` (105) and
//    `BUILT.specialEnergy` (8) cannot see the sentence at all, and `unbuiltAttack`
//    holds at 539.
//
// ── THE ENGINE DIFF — ONE OP, AND THE FIRST IN FOUR SLICES ─────────────────
// D337/D338/D339 were zero-diff registry rows. This one authors `counterEachAll`,
// `healEachAll`'s COUNTER TWIN — and the parenthetical is the argument: Picnic
// Basket prints *"each Pokémon **(both yours and your opponent's)**"* and this
// card prints the same six words, so the seat-blind `SEATS` walk is the printed
// shape rather than a generalisation. `filter: abilityPokemon` reuses D285's
// existing member whole; `exceptNamed` reuses D273's rider spelling verbatim.
//
// ⚠️ **NO `flow.ts` DIFF**: `trigger: "betweenTurns"` and `runCheckupTriggers`
//    already existed, and the Checkup's own KO sweep resolves a counter-caused
//    Knock Out — `damageActive`'s contract at the same trigger since Trevenant.

const FROSLASS = "sv06-053";
const FROSLASS_REPRINT = "sv06-174";
const FROSLASS_PROMO = "svp-117";
const FROSLASS_IDS = [FROSLASS, FROSLASS_REPRINT, FROSLASS_PROMO] as const;

/** A Pokémon that HAS an Ability — the printed noun's positive case. */
const ABILITY_BODY = "fix-d340-abilitybody";
/** The SAME body without an Ability — the noun's negative case, and the only
    thing separating it from `ABILITY_BODY` is the `abilities` array itself. */
const PLAIN_BODY = "fix-d340-plainbody";
/** 🛑 A body NAMED "Froslass" that is NOT one of the three catalog ids and has
    NO registry program. The exemption is keyed on the printed NAME, so this must
    be exempt too — and it is the body that tells `card.name === exceptNamed`
    apart from any read of the SOURCE, of the id, or of the program. */
const IMPOSTOR_FROSLASS = "fix-d340-impostor";
/** 🛑 A name that strictly CONTAINS "Froslass" as a prefix. **NOT exempt** — it
    catches a `startsWith` where the printed word is an equality. */
const FROSLASSY = "fix-d340-froslassy";
const WALL = "fix-d340-wall";
const ENERGY = "fix-d340-energy";

const SHROUD_ABILITY = [
  {
    type: "Ability",
    name: "Freezing Shroud",
    effect:
      "During Pokémon Checkup, put 1 damage counter on each Pokémon that has an Ability (both yours and your opponent's), except any Froslass.",
  },
];

const LOCAL_CARDS: Record<string, Card> = {
  [FROSLASS]: battler(FROSLASS, {
    name: "Froslass",
    hp: 90,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "Snorunt",
    types: ["Water"],
    abilities: SHROUD_ABILITY,
    attacks: [{ cost: ["Water"], name: "Frost Smash", damage: 30 }],
  }),
  [FROSLASS_REPRINT]: battler(FROSLASS_REPRINT, {
    name: "Froslass",
    hp: 90,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "Snorunt",
    types: ["Water"],
    abilities: SHROUD_ABILITY,
    attacks: [{ cost: ["Water"], name: "Frost Smash", damage: 30 }],
  }),
  [FROSLASS_PROMO]: battler(FROSLASS_PROMO, {
    name: "Froslass",
    hp: 90,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "Snorunt",
    types: ["Water"],
    abilities: SHROUD_ABILITY,
    attacks: [{ cost: ["Water"], name: "Frost Smash", damage: 30 }],
  }),
  [ABILITY_BODY]: battler(ABILITY_BODY, {
    name: "D340 Ability Body",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: "D340 Idle", effect: "This Ability does nothing." }],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [PLAIN_BODY]: battler(PLAIN_BODY, {
    name: "D340 Plain Body",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [IMPOSTOR_FROSLASS]: battler(IMPOSTOR_FROSLASS, {
    name: "Froslass",
    hp: 200,
    retreat: 1,
    types: ["Water"],
    abilities: [{ type: "Ability", name: "D340 Idle", effect: "This Ability does nothing." }],
    attacks: [{ cost: ["Water"], name: "Tap", damage: 10 }],
  }),
  [FROSLASSY]: battler(FROSLASSY, {
    name: "Froslassy",
    hp: 200,
    retreat: 1,
    types: ["Water"],
    abilities: [{ type: "Ability", name: "D340 Idle", effect: "This Ability does nothing." }],
    attacks: [{ cost: ["Water"], name: "Tap", damage: 10 }],
  }),
  [WALL]: battler(WALL, {
    name: "D340 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: typedEnergy(ENERGY, "Water"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 6 + 2 + 2 + 8 + 8 + 8 + 8 + 8 + 10 = 60. Every body this suite seats is drawn
// OUT OF THE DECK by the fixture helpers, so these counts are the deepest board
// any case builds rather than decoration.
const DECK = deckOf({
  [FROSLASS]: 6,
  [FROSLASS_REPRINT]: 2,
  [FROSLASS_PROMO]: 2,
  [ABILITY_BODY]: 8,
  [PLAIN_BODY]: 8,
  [IMPOSTOR_FROSLASS]: 8,
  [FROSLASSY]: 8,
  [WALL]: 8,
  [ENERGY]: 10,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function countersOn(events: readonly GameEvent[]): { seat: Seat; uid: string; amount: number }[] {
  return events
    .filter(
      (e): e is Extract<GameEvent, { type: "COUNTERS_PLACED" }> => e.type === "COUNTERS_PLACED",
    )
    .map((e) => ({ seat: e.seat, uid: e.uid, amount: e.amount }));
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** Setup driven against a LOCAL `cardPool` (D275's idiom, D338's and D339's
    practice). Nothing is added to `FIXTURE_POOL` — which is what keeps
    `raw.length`'s two lines 0 apart.
    🛑 D343: this note used to end "and `revealClause`'s `swept.size` at 27". The
    sweep's population is now `registryCardIds()` ∪ the pool and `swept.size` is
    **103**, so the pool clause buys nothing here any more. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** Seat exactly the bodies each side names, Active first, on p1's turn. Every
    body is drawn OUT OF THE DECK so each uid stays in exactly one zone. */
function board(spec: { p1: readonly string[]; p2: readonly string[] }): GameState {
  let state = localSetup(4, "p1");
  for (const seat of ["p1", "p2"] as const) {
    const ids = seat === "p1" ? spec.p1 : spec.p2;
    state = setActiveFromDeck(state, seat, ids[0] ?? WALL);
    state = clearBench(state, seat);
    for (const id of ids.slice(1)) state = benchFromDeck(state, seat, id);
  }
  return state;
}

/** Run the Checkup by ending `seat`'s turn, returning what it emitted. */
function checkup(state: GameState, seat: Seat = "p1"): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, { type: "endTurn", seat });
  if (!result.ok) throw new Error(`endTurn failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
}

function damageOf(state: GameState, seat: Seat, index: number): number {
  const side = state.players[seat];
  const body = index === 0 ? side.active : side.bench[index - 1];
  if (body === undefined || body === null) throw new Error(`no body at ${seat}[${index}]`);
  return body.damage;
}

describe("D340 §1 — the registry row, read off the LIVE registry", () => {
  it("all THREE printings resolve to ONE program object, by identity", () => {
    const first = programFor(FROSLASS);
    expect(first).toBeDefined();
    for (const id of FROSLASS_IDS) {
      // Identity, not deep equality: three separate-but-equal objects would pass a
      // `toEqual` and would be three rows in `censusAtHead`'s object decomposition,
      // which this slice asserts steps by exactly ONE.
      expect(programFor(id), id).toBe(first);
    }
  });

  it("the program is a betweenTurns TRIGGERED ability and carries nothing else", () => {
    const program = programFor(FROSLASS);
    expect(Object.keys(program ?? {})).toEqual(["triggered"]);
    expect(program?.triggered).toHaveLength(1);
    const ability = program?.triggered?.[0];
    expect(ability?.name).toBe("Freezing Shroud");
    expect(ability?.trigger).toBe("betweenTurns");
    // 🛑 NO `activeOnly` — the printed sentence carries no spot clause, where
    // Trevenant's "if this Pokémon is in the Active Spot" does. That absence is
    // the whole difference between the two Checkup rows, and §3 drives it.
    expect(ability?.activeOnly).toBeUndefined();
    // Mandatory: "put", not "you may put".
    expect(ability?.optional).toBeUndefined();
    // The sentence is not "The effect of Freezing Shroud doesn't stack."
    expect(ability?.doesNotStack).toBeUndefined();
  });

  it("the op is `counterEachAll` with the printed amount, noun and exemption", () => {
    const program = programFor(FROSLASS);
    expect(program?.triggered?.[0]?.program).toEqual([
      {
        op: "counterEachAll",
        amount: 10,
        filter: { kind: "abilityPokemon" },
        // 🆕🆕🆕 D450 — TWO REQUIRED FIELDS ARRIVED WITH THE OP'S FIRST ATTACK PRODUCER,
        // and this row's values are the ones that were HARDCODED in the interpreter
        // until then: the printed parenthetical is `side: "both"`, and the provenance
        // the COUNTERS_PLACED row prints is `source: "ability"` — true of this trigger
        // and false of every one of `deriveAttackEffect`'s three fold arms.
        side: "both",
        source: "ability",
        exceptNamed: "Froslass",
      },
    ]);
  });

  it("🛑 `amount` is 10 HP and NOT the printed 1 — the ×10 happens once", () => {
    const op = programFor(FROSLASS)?.triggered?.[0]?.program?.[0];
    // ⚠️ THE MUTANT THIS KILLS: `amount: 1`. The printed text says "1 damage
    // counter"; §12 makes a counter 10 HP, and the conversion is done HERE at the
    // registry (TREVENANT's rule) so the interpreter cannot convert twice. A `1`
    // would be a silent tenth-strength aura that every board-level assertion below
    // would also catch — which is the point of asserting it in both places.
    expect(op).toMatchObject({ amount: 10 });
  });

  it("🛑 `exceptNamed` is the FULL printed name and matches the catalog rows", () => {
    const op = programFor(FROSLASS)?.triggered?.[0]?.program?.[0];
    // ⚠️ THE MUTANT THIS KILLS: `exceptNamed: "Froslas"` / `"Froslass ex"`. The
    // rider is exact-case equality on `Card.name`, so a truncation or a suffix
    // would silently stop exempting the card the sentence names.
    expect(op).toMatchObject({ exceptNamed: "Froslass" });
    for (const id of FROSLASS_IDS) {
      expect(LOCAL_CARDS[id]?.name, id).toBe("Froslass");
    }
  });

  it("the three ids are the WHOLE registry cohort for this program — both directions", () => {
    const target = programFor(FROSLASS);
    const live = registryCardIds()
      .filter((id) => programFor(id) === target)
      .sort();
    // Both directions: an id added to the registry without a census visit reddens
    // here, and an id removed from the registry reddens here too.
    expect(live).toEqual([...FROSLASS_IDS].sort());
  });
});

describe("D340 §2 — the printed noun: only Pokémon that HAVE an Ability", () => {
  it("a body WITH an Ability takes a counter; the same body WITHOUT one does not", () => {
    const state = board({ p1: [WALL, ABILITY_BODY, PLAIN_BODY, FROSLASS], p2: [WALL] });
    const after = checkup(state).state;
    // p1[1] has an Ability → 10; p1[2] is the identical body minus `abilities` → 0.
    expect(damageOf(after, "p1", 1)).toBe(10);
    expect(damageOf(after, "p1", 2)).toBe(0);
  });

  it("🛑 the WALL is untouched — the filter is not `anyPokemon`", () => {
    const state = board({ p1: [WALL, ABILITY_BODY, FROSLASS], p2: [WALL, PLAIN_BODY] });
    const after = checkup(state).state;
    // ⚠️ THE MUTANT THIS KILLS: `filter: { kind: "anyPokemon" }`. Every body on
    // this board that lacks an Ability sits at 0, on BOTH seats, so a widened
    // filter reddens in four places at once rather than one.
    expect(damageOf(after, "p1", 0)).toBe(0);
    expect(damageOf(after, "p2", 0)).toBe(0);
    expect(damageOf(after, "p2", 1)).toBe(0);
    expect(damageOf(after, "p1", 1)).toBe(10);
  });

  it("the two bodies differ in `abilities` and in NOTHING else — the attribution control", () => {
    // Without this, §2's first case could pass because the two fixtures differ in
    // HP, type or attacks and the filter read one of THOSE. D214's rule: a check
    // whose subject is a shared artifact needs an attribution control.
    const withAbility = { ...LOCAL_CARDS[ABILITY_BODY], id: "", name: "", abilities: undefined };
    const without = { ...LOCAL_CARDS[PLAIN_BODY], id: "", name: "", abilities: undefined };
    expect(withAbility).toEqual(without);
    expect(LOCAL_CARDS[ABILITY_BODY]?.abilities).toHaveLength(1);
    // ⚠️ `battler`'s blank spells an absent Ability as `null`, not `undefined` —
    // asserted as the falsy value it actually is rather than the one a reader
    // would guess, because `toBeUndefined()` passes on neither.
    expect(LOCAL_CARDS[PLAIN_BODY]?.abilities).toBeNull();
  });
});

describe("D340 §3 — *(both yours and your opponent's)*: the seat-blind walk", () => {
  it("BOTH boards take counters from ONE Froslass", () => {
    const state = board({
      p1: [FROSLASS, ABILITY_BODY],
      p2: [ABILITY_BODY, ABILITY_BODY],
    });
    const after = checkup(state).state;
    expect(damageOf(after, "p1", 1)).toBe(10);
    // ⚠️ THE MUTANT THIS KILLS: a `ctx.seat` walk instead of a `SEATS` walk —
    // `healEach` instead of `healEachAll`. The opponent's two bodies would sit at
    // 0 and the controller's would be right, which is exactly the shape a
    // single-seat board could never distinguish.
    expect(damageOf(after, "p2", 0)).toBe(10);
    expect(damageOf(after, "p2", 1)).toBe(10);
  });

  it("each COUNTERS_PLACED is tagged with the DAMAGED body's own seat, not the controller's", () => {
    const state = board({ p1: [FROSLASS, ABILITY_BODY], p2: [ABILITY_BODY] });
    const { events } = checkup(state);
    const placed = countersOn(events);
    expect(placed).toHaveLength(2);
    // `healEachAll`'s rule: the event names the Pokémon's OWN seat. A controller-
    // tagged event would put the opponent's damage on the wrong side of the log.
    expect(placed.map((p) => p.seat).sort()).toEqual(["p1", "p2"]);
    for (const row of placed) expect(row.amount).toBe(10);
  });

  it("🛑 a Froslass on the BENCH still fires — there is no `activeOnly`", () => {
    const state = board({ p1: [WALL, FROSLASS], p2: [ABILITY_BODY] });
    const after = checkup(state).state;
    // Garganacl's "Blessed Salt" shape, and the opposite of Trevenant's. A build
    // that copied Trevenant's `activeOnly: true` would leave this board at 0.
    expect(damageOf(after, "p2", 0)).toBe(10);
  });

  it("a Froslass in the opponent's seat counters the controller's board too", () => {
    const state = board({ p1: [ABILITY_BODY], p2: [WALL, FROSLASS] });
    const after = checkup(state).state;
    // The aura is not owner-scoped in either direction — the sentence says "each
    // Pokémon", and whose turn is ending changes nothing.
    expect(damageOf(after, "p1", 0)).toBe(10);
  });
});

describe("D340 §4 — *except any Froslass*: the SUBTRACTION, not a conjunction", () => {
  it("🛑 the source Froslass exempts ITSELF, though it satisfies the noun", () => {
    const state = board({ p1: [FROSLASS, ABILITY_BODY], p2: [WALL] });
    const after = checkup(state).state;
    // 🛑 THE CENTRAL CLAIM OF THE ROW. Froslass HAS an Ability, so it passes
    // `abilityPokemon` and is removed ONLY by the exemption.
    // ⚠️ THE MUTANTS THIS KILLS: dropping `exceptNamed` entirely, and reading the
    // two predicates as `&&` instead of as a subtraction — under either, this
    // body sits at 10.
    expect(damageOf(after, "p1", 0)).toBe(0);
    expect(damageOf(after, "p1", 1)).toBe(10);
  });

  it("🛑 EVERY Froslass is exempt, on both seats — the word is *any*", () => {
    const state = board({
      p1: [FROSLASS, FROSLASS_REPRINT, ABILITY_BODY],
      p2: [FROSLASS_PROMO, ABILITY_BODY],
    });
    const after = checkup(state).state;
    // Not just the source: the printed word is "any Froslass", so a second copy
    // and a copy across the table are exempt too. A build that exempted only
    // `ctx.sourceUid` would leave three of these four bodies damaged.
    expect(damageOf(after, "p1", 0)).toBe(0);
    expect(damageOf(after, "p1", 1)).toBe(0);
    expect(damageOf(after, "p2", 0)).toBe(0);
    // 🛑 AND THE NON-EXEMPT BODIES TAKE **30**, NOT 10 — THREE Froslass are in
    // play and the sentence prints no non-stacking clause, so the Checkup runs
    // three separate firings. The first draft of this case asserted 10 and was
    // simply FALSE: the board was never too narrow, the assertion was wrong, and
    // widening the board would have fixed nothing (D339's rule, met again). It is
    // written as arithmetic so the count of SOURCES is what the number says.
    const sources = 3;
    expect(damageOf(after, "p1", 2)).toBe(sources * 10);
    expect(damageOf(after, "p2", 1)).toBe(sources * 10);
  });

  it("🛑 a body merely NAMED Froslass is exempt — the rider reads the NAME, not the id", () => {
    const state = board({ p1: [FROSLASS, IMPOSTOR_FROSLASS, ABILITY_BODY], p2: [WALL] });
    const after = checkup(state).state;
    // `IMPOSTOR_FROSLASS` has NO registry program and is not one of the three
    // catalog ids; it is exempt purely because `card.name === "Froslass"`.
    // ⚠️ THE MUTANT THIS KILLS: an exemption implemented as `programFor(id) ===
    // <this program>` or as an id-set membership test, both of which are green on
    // every board that holds only real Froslass printings.
    expect(damageOf(after, "p1", 1)).toBe(0);
    expect(damageOf(after, "p1", 2)).toBe(10);
    expect(programFor(IMPOSTOR_FROSLASS)).toBeUndefined();
  });

  it('🛑 "Froslassy" is NOT exempt — equality, not `startsWith`', () => {
    const state = board({ p1: [FROSLASS, FROSLASSY], p2: [WALL] });
    const after = checkup(state).state;
    // ⚠️ THE MUTANT THIS KILLS: `card.name.startsWith(exceptNamed)`. That reading
    // is byte-identical on every board holding only real printings, and only a
    // name that strictly CONTAINS the printed one as a prefix can tell them apart.
    expect(damageOf(after, "p1", 1)).toBe(10);
  });

  it("an exempt body emits NO event at all — it is skipped, not countered for zero", () => {
    const state = board({ p1: [FROSLASS, ABILITY_BODY], p2: [WALL] });
    const { events } = checkup(state);
    const placed = countersOn(events);
    expect(placed).toHaveLength(1);
    // A zero-amount row would put a lie in the log even with the board right.
    expect(placed[0]?.amount).toBe(10);
  });
});

describe("D340 §5 — the walk itself", () => {
  it("counters ACCUMULATE across two Checkups rather than being re-set", () => {
    const state = board({ p1: [FROSLASS, ABILITY_BODY], p2: [WALL] });
    const first = checkup(state).state;
    expect(damageOf(first, "p1", 1)).toBe(10);
    const second = checkup(first, "p2").state;
    // `damage + amount`, not `damage = amount` — a mutant that assigned would be
    // green after one Checkup and wrong after two.
    expect(damageOf(second, "p1", 1)).toBe(20);
  });

  it("TWO Froslass fire TWICE — the sentence prints no non-stacking clause", () => {
    const state = board({ p1: [FROSLASS, FROSLASS_REPRINT, ABILITY_BODY], p2: [WALL] });
    const after = checkup(state).state;
    // Gnawing Curse's rule rather than Darkest Impulse's: `doesNotStack` is absent
    // from the row (§1), so two sources place two counters.
    expect(damageOf(after, "p1", 2)).toBe(20);
    // …and both Froslass are still exempt from BOTH firings.
    expect(damageOf(after, "p1", 0)).toBe(0);
    expect(damageOf(after, "p1", 1)).toBe(0);
  });

  it("a board with NO Froslass takes nothing — the aura has a source", () => {
    const state = board({ p1: [ABILITY_BODY, ABILITY_BODY], p2: [ABILITY_BODY] });
    const { state: after, events } = checkup(state);
    expect(countersOn(events)).toHaveLength(0);
    expect(damageOf(after, "p1", 0)).toBe(0);
    expect(damageOf(after, "p2", 0)).toBe(0);
  });

  it("an empty opponent board does not stop the controller's own side resolving", () => {
    const state = board({ p1: [FROSLASS, ABILITY_BODY], p2: [WALL] });
    const stripped: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, bench: [] } },
    };
    const after = checkup(stripped).state;
    expect(damageOf(after, "p1", 1)).toBe(10);
  });

  it("every damaged body is a body the filter admits — no stray counters anywhere", () => {
    const state = board({
      p1: [FROSLASS, ABILITY_BODY, PLAIN_BODY, WALL],
      p2: [WALL, ABILITY_BODY, FROSLASSY, IMPOSTOR_FROSLASS],
    });
    const { state: after, events } = checkup(state);
    // The whole-board sweep: exactly the three admitted bodies, and nothing else.
    expect(countersOn(events)).toHaveLength(3);
    expect(damageOf(after, "p1", 1)).toBe(10);
    expect(damageOf(after, "p2", 1)).toBe(10);
    expect(damageOf(after, "p2", 2)).toBe(10);
    for (const [seat, index] of [
      ["p1", 0],
      ["p1", 2],
      ["p1", 3],
      ["p2", 0],
      ["p2", 3],
    ] as const) {
      expect(damageOf(after, seat, index), `${seat}[${index}]`).toBe(0);
    }
  });
});

describe("D340 §6 — the census this row moves, asserted as ARITHMETIC", () => {
  it("the three printings are ONE card, ONE sentence and ONE object", () => {
    expect(new Set(FROSLASS_IDS.map((id) => LOCAL_CARDS[id]?.name)).size).toBe(1);
    expect(new Set(FROSLASS_IDS.map((id) => programFor(id))).size).toBe(1);
    // So the column steps 3, the name list 1, the object list 1 and the JOIN 1 —
    // a 3:1:1:1 step, which is what `censusAtHead` records.
    expect(FROSLASS_IDS).toHaveLength(3);
  });

  it("🛑 the `except any` family closes at 14 legal, of which 3 were unbuilt", () => {
    // 6 (Iron Crown ex, blocked on the banner) + 5 (Pecharunt ex, BUILT at D273)
    // + 3 (this row) = 14 legal, and 14 + 6 illegal = the 20 printings the census
    // returned. Written as arithmetic so a future re-query can disagree with a
    // NUMBER rather than with a paragraph.
    expect(6 + 5 + 3).toBe(14);
    expect(14 + 2 + 3 + 1).toBe(20);
  });

  it("🛑 the by-name exemption predates this row — `switchActive.exceptNamed` is LIVE", () => {
    // The claim the backlog got wrong, asserted against the registry rather than
    // argued in prose: Pecharunt ex already consumes an `exceptNamed` rider, so
    // this slice REUSES a spelling rather than inventing one.
    const pecharunt = programFor("sv06.5-039");
    expect(pecharunt).toBeDefined();
    const ops = JSON.stringify(pecharunt);
    expect(ops).toContain('"exceptNamed":"Pecharunt ex"');
  });

  it("the suite adds NOTHING to the shared FIXTURE_POOL — the census decision", () => {
    // 🛑 THIS IS WHAT KEEPS `raw.length`'s two lines 0 apart. (It used to claim
    // `swept.size` at 27 as well; D343 repointed that sweep at
    // `registryCardIds()` ∪ the pool and the figure is **103**, so the pool
    // clause no longer carries it.) Neither `sv06` nor `svp` is among
    // `catalogManifest`'s six sets, so a
    // shared-pool body would owe a `fix-froslass` key AND redden
    // `revealClause`'s sweep — exactly what D335's `fix-drakloak` (also a Pokémon,
    // also `sv06`) had to pay. THE KEY IS THE SET, NOT THE SURFACE.
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(Object.hasOwn(FIXTURE_POOL, id), `${id} leaked into FIXTURE_POOL`).toBe(false);
    }
  });
});
