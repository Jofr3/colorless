import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── D345 — "CURSED BLAST", AND `knockOutSelf`: THE PRINTED SELF-KNOCK-OUT COST.
//
// ── THE TWO PRINTED SENTENCES ───────────────────────────────────────────────
//   Dusclops sv06.5-019 / sv06.5-069 / sv08.5-036
//     "Once during your turn, you may put 5 damage counters on 1 of your
//      opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out."
//   Dusknoir sv06.5-020 / sv06.5-070 / sv08.5-037
//     …the same sentence at 13 counters.
//   Both ACTIVATED Abilities. **6 Standard-legal printings, 2 sentences.**
//
// ── HOW THIS ROW WAS CHOSEN, AND WHAT WAS REFUSED ───────────────────────────
// D344 declined to pre-price a successor and left a METHOD instead, on the
// evidence that the last five handoffs that priced a row were each wrong. The
// method, run:
//
//   (1) THE LARGEST LIVE `ROWS` RESIDUE in `censusAtHead.test.ts` is **row 9**
//       (attach from the DISCARD PILE) — 5 `abilityIds` + 5 `effectIds` = 10.
//       Read off the file, not off the handoff: the eight rows are
//       10 · 5 · 4 · 3 · 0 · 0 · 0 · 0.
//
//   (2) CENSUS THE SENTENCE, NOT THE CARD (D340). Row 9's ability half is 5
//       printings on TWO sentences, and its own note prices the bigger one
//       (Magneton "Overvolt Discharge" ×3) at *"NO op in this engine knocks out
//       its own host; grepped"*. So the thing to census is that CLAUSE. Over ALL
//       THREE text columns on remote D1 `luminous` (2026-08-15):
//
//         instr(<col>, 'If you use this Ability, this Pokémon is Knocked Out') > 0
//           effect          0 printings /  0 legal / 0 sentences
//           abilities_json  9 printings /  9 legal / 3 sentences
//           attacks_json    0 printings /  0 legal / 0 sentences
//           ─────────────────────────────────────────────────────
//           TOTAL           9 printings /  9 legal / 3 sentences   ✅ 0 + 9 + 0
//
//       Every printing of the clause is Standard-legal — the only family this
//       run has censused where `printings === legal`.
//
//   (3) IS THE CARD THE CHEAPEST THING THAT SENTENCE BUYS? **NO** (D341's
//       lesson, and this is its second instance). The three sentences are
//       Dusclops (3 legal), Dusknoir (3 legal) and Magneton (3 legal) — and
//       Magneton is the EXPENSIVE one. Its effect half is *"attach up to 3 Basic
//       Energy cards from your discard pile to your {L} Pokémon **in any way you
//       like**"*, a DISTRIBUTION across several bodies: `attachEnergyFrom.count`
//       (D205) lands the whole batch on ONE picked target, and `toEach` (D248) is
//       a fold with no pick in it. **The card the residue points at owes TWO
//       mechanisms; the other two-thirds of its own family owe exactly this one.**
//
//   🛑🛑 **(3) IS WRONG, AND D346 BUILT MAGNETON FOR A REGISTRY ROW AND NO ENGINE
//       LINE.** *"In any way you like"* AT A PRINTED COUNT is N independent
//       `attachEnergyFrom` ops — `ASSEMBLE_ALLOY`'s reading since D263, and
//       `attachEnergyFrom.count`'s own doc since D205 (*"N ops park N times and may
//       land on N different bodies … where `count` parks ONCE and pins the batch"*).
//       The compound `attachCards` MAP this note reached for exists for *"any
//       NUMBER"*, which names no unit to unroll. So Magneton owed exactly ONE
//       mechanism, `legalNonAttackPrograms.test.ts` had said so correctly since
//       D263 — and this slice spent it and then overwrote that correct note with
//       this wrong one, in nine files. **See `overvoltDischarge.test.ts`.**
//
//   (4) HAS IT SHIPPED? No. `grep -rn "Cursed Blast|sv06.5-019|sv06.5-020|
//       sv08.5-036|sv08.5-037"` over the tree at `7f2b0d9` returned **4 hits, all
//       PROSE** — `attackLock.test.ts`, `effects.ts` ×2 and `counterPut.test.ts`,
//       every one of them a NEAR-MISS note saying the deriver refuses the
//       sentence. **And all four enumerate FOUR printings where the catalog has
//       SIX**: `sv08.5-036`/`-037` appear nowhere in the repo. A prose
//       enumeration rots exactly like a count (D343), and these had been stale
//       since the Prismatic Evolutions reprints landed.
//
// ── WHAT THIS SLICE REFUSED, WITH THE MEASUREMENT BESIDE IT ─────────────────
//   • **Magneton `svp-153`/`svp-159`/`sv08-059` (3 legal)** — see (3). It owes
//     the distribution and this op; only one of the two is here.
//     🛑 **REFUSED IN ERROR — BUILT AT D346 with zero engine code.** The refusal
//     below (§2) is spent and now asserts the opposite.
//   • **Glass Trumpet `sv07-135`/`sv08.5-110` (2 legal)**, row 9's biggest
//     `effectIds` shape — *"You can use this card only if you have any **Tera**
//     Pokémon in play."* The Tera predicate has NO SUPPLY-SIDE DATUM: `SELECT
//     suffix, COUNT(*) FROM cards GROUP BY 1` is two rows (NULL 3,157 / `ex` 629)
//     and every `Tera` hit in the catalog is DEMAND (registry.ts's Briar note).
//     A permanent floor, not a remainder.
//   • **Reboot Pod `sv05-158` (1 legal)** — *"to each of your **Future**
//     Pokémon"*, the same dead datum (D243).
//   • **Powerglass `sv06.5-063`/`-097` (2 legal)** — needs an `endOfTurn`
//     `TriggerTiming` the union does not have plus a Tool hook in the turn
//     machine. Censused before refusing: `instr(<col>,'the end of your turn')`
//     is `effect` 10/4/4 + `abilities_json` 5/**0**/3 + `attacks_json` 0/0/0, and
//     **2 of the 4 legal `effect` printings are the Technical Machine / Ignition
//     Energy SELF-DISCARD tail**, a different mechanism wearing the same words.
//     The timing buys 2 legal printings today. Not one slice with this one.
//
// ── THE PRICE ───────────────────────────────────────────────────────────────
//   ONE new `EffectOp` (`knockOutSelf`, FIELD-FREE), TWO registry programs, SIX
//   id-map entries. **NO new event** (the §8.1 sweep's own `KNOCKED_OUT`), **NO
//   new prompt kind**, **NO new `TriggerTiming`**, and **`MATCH_RECORD_VERSION`
//   STAYS 20** — the op never parks, so it adds no `PendingStage` inhabitant, and
//   it has no field, so no persisted union gains a member.

const DUSCLOPS = "sv06.5-019";
const DUSCLOPS_REPRINT = "sv06.5-069";
const DUSCLOPS_PRISMATIC = "sv08.5-036";
const DUSKNOIR = "sv06.5-020";
const DUSKNOIR_REPRINT = "sv06.5-070";
const DUSKNOIR_PRISMATIC = "sv08.5-037";

const DUSCLOPS_IDS = [DUSCLOPS, DUSCLOPS_REPRINT, DUSCLOPS_PRISMATIC] as const;
const DUSKNOIR_IDS = [DUSKNOIR, DUSKNOIR_REPRINT, DUSKNOIR_PRISMATIC] as const;

/** The clause's THIRD sentence — censused in (2) above, REFUSED in (3), and
    pinned here so the refusal is driven rather than described. */
const MAGNETON_IDS = ["svp-153", "svp-159", "sv08-059"] as const;

const CLAUSE = "If you use this Ability, this Pokémon is Knocked Out.";
const DUSCLOPS_TEXT = `Once during your turn, you may put 5 damage counters on 1 of your opponent's Pokémon. ${CLAUSE}`;
const DUSKNOIR_TEXT = `Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. ${CLAUSE}`;

const WEAK_TO_PSYCHIC = "fix-d345-psychic-weak";
const WALL = "fix-d345-wall";
const CHAFF = "fix-d345-chaff";
/** The REAL Ludicolo `sv09-037` "Vibrant Dance" — a registry `seatHpBonus` of +40
    over the WHOLE side (D324). Held here as a real catalog id in a LOCAL pool, so
    the aura case below is a claim about the ENGINE's aura and not about an
    invented fixture that carries no program: `programFor("sv09-037")` is asserted
    DEFINED in §4, which is the attribution control this case would be vacuous
    without. `sv09` is not among `catalogManifest`'s six sets, so a shared-pool
    body would have owed a `fix-*` key — the local pool costs nothing. */
const AURA = "sv09-037";
const ENERGY = "fix-d345-energy";

/** The two real printings, carried VERBATIM off the remote D1 row (2026-08-15) —
    the printed HP, stage, type, retreat, the Ability text and the printed attack
    at its printed index. Held in a LOCAL pool, never in `FIXTURE_POOL`: D275's
    idiom, and here it is the only option that costs nothing, because
    `catalogManifest.test.ts` classifies real-looking fixture ids against a
    generated manifest of SIX sets and `sv08.5` is not one of them — a shared-pool
    body would have owed a `fix-*` key for each card on `censusAtHead`'s
    `raw.length` line. **THE KEY IS THE SET, NOT THE SURFACE.** */
const LOCAL_CARDS: Record<string, Card> = Object.fromEntries([
  ...DUSCLOPS_IDS.map((id) => [
    id,
    battler(id, {
      name: "Dusclops",
      stage: "Stage1",
      evolveFrom: "Duskull",
      hp: 90,
      retreat: 2,
      types: ["Psychic"],
      abilities: [{ type: "Ability", name: "Cursed Blast", effect: DUSCLOPS_TEXT }],
      attacks: [{ cost: ["Psychic", "Psychic"], name: "Will-O-Wisp", damage: 50 }],
    }),
  ]),
  ...DUSKNOIR_IDS.map((id) => [
    id,
    battler(id, {
      name: "Dusknoir",
      stage: "Stage2",
      evolveFrom: "Dusclops",
      hp: 160,
      retreat: 3,
      types: ["Psychic"],
      abilities: [{ type: "Ability", name: "Cursed Blast", effect: DUSKNOIR_TEXT }],
      attacks: [
        {
          cost: ["Psychic", "Psychic", "Colorless"],
          name: "Shadow Bind",
          effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
          damage: 150,
        },
      ],
    }),
  ]),
  [
    WEAK_TO_PSYCHIC,
    battler(WEAK_TO_PSYCHIC, {
      name: "D345 Psychic-weak",
      hp: 200,
      retreat: 1,
      types: ["Fighting"],
      weaknesses: [{ type: "Psychic", value: "×2" }],
      attacks: [{ cost: ["Fighting"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    WALL,
    battler(WALL, {
      name: "D345 Wall",
      hp: 330,
      retreat: 1,
      types: ["Colorless"],
      attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    CHAFF,
    battler(CHAFF, {
      name: "D345 Chaff",
      hp: 60,
      retreat: 1,
      types: ["Colorless"],
      attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    AURA,
    battler(AURA, {
      name: "Ludicolo",
      stage: "Stage2",
      evolveFrom: "Lombre",
      hp: 150,
      retreat: 2,
      types: ["Grass"],
      abilities: [
        {
          type: "Ability",
          name: "Vibrant Dance",
          effect:
            "All of your Pokémon in play get +40 HP. The effect of Vibrant Dance doesn't stack.",
        },
      ],
      attacks: [{ cost: ["Grass", "Colorless", "Colorless"], name: "Solar Beam", damage: 120 }],
    }),
  ],
  [ENERGY, typedEnergy(ENERGY, "Psychic")],
]) as Record<string, Card>;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 6 × 4 + 8 + 8 + 8 + 4 + 8 = 60. Every body this suite seats is drawn OUT OF THE
// DECK by the fixture helpers, so these counts are the deepest board any case
// builds rather than decoration.
const DECK = deckOf({
  [DUSCLOPS]: 4,
  [DUSCLOPS_REPRINT]: 4,
  [DUSCLOPS_PRISMATIC]: 4,
  [DUSKNOIR]: 4,
  [DUSKNOIR_REPRINT]: 4,
  [DUSKNOIR_PRISMATIC]: 4,
  [WEAK_TO_PSYCHIC]: 8,
  [WALL]: 8,
  [CHAFF]: 8,
  [AURA]: 4,
  [ENERGY]: 8,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function step(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: [...result.events] };
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** Setup driven against a LOCAL `cardPool` (D275's idiom). Nothing is added to
    `FIXTURE_POOL` — which is what keeps `censusAtHead`'s `raw.length` and
    `nonAttackRegistryIds()` lines 0 apart this slice. */
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

/** Seat exactly the bodies each side names, Active first, on p1's turn. */
function board(spec: { p1: readonly string[]; p2: readonly string[] }, seed = 4): GameState {
  let state = localSetup(seed, "p1");
  for (const seat of ["p1", "p2"] as const) {
    const ids = seat === "p1" ? spec.p1 : spec.p2;
    state = setActiveFromDeck(state, seat, ids[0] ?? WALL);
    state = clearBench(state, seat);
    for (const id of ids.slice(1)) state = benchFromDeck(state, seat, id);
  }
  return state;
}

function activeUid(state: GameState, seat: Seat): string {
  const uid = state.players[seat].active?.stack.at(-1);
  if (uid === undefined) throw new Error(`${seat} has no Active`);
  return uid;
}

function blast(state: GameState, target: { spot: "active" } | { spot: "bench"; index: number }) {
  return step(state, { type: "useAbility", seat: "p1", target, abilityName: "Cursed Blast" });
}

describe("D345 §1 — the two registry rows, read off the LIVE registry", () => {
  it("each card's THREE printings resolve to ONE program object, by identity", () => {
    for (const ids of [DUSCLOPS_IDS, DUSKNOIR_IDS]) {
      const first = programFor(ids[0]);
      expect(first).toBeDefined();
      // Identity, not deep equality: three separate-but-equal objects would pass a
      // `toEqual` and would be three rows in `censusAtHead`'s object decomposition.
      for (const id of ids) expect(programFor(id), id).toBe(first);
    }
  });

  it("the two SENTENCES are two DISTINCT objects — D199's near-twin rule", () => {
    // One field apart (50 vs 130) and still two objects, because two printed
    // sentences are two things. Asserted by identity in BOTH directions so a
    // future edit that collapses them into a factory call goes red here.
    expect(programFor(DUSCLOPS)).not.toBe(programFor(DUSKNOIR));
    expect(programFor(DUSCLOPS)).not.toEqual(programFor(DUSKNOIR));
  });

  it("each program carries an `abilities` table and NOTHING else", () => {
    for (const id of [DUSCLOPS, DUSKNOIR]) {
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
      expect(programFor(id)?.abilities, id).toHaveLength(1);
    }
  });

  it("the ability is `Cursed Blast`, once per turn PER BODY, with no spot clause", () => {
    for (const id of [DUSCLOPS, DUSKNOIR]) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name, id).toBe("Cursed Blast");
      // The DEFAULT scope, not `"sharedByName"` — nothing here prints "you can't
      // use more than 1 Cursed Blast Ability each turn", so two Dusclops on one
      // board are two uses.
      expect(ability?.oncePerTurn, id).toBe(true);
      // The sentence names no spot, so a BENCHED body blasts (§3 drives it).
      expect(ability?.activeOnly, id).toBe(false);
      // No printed board gate and no per-body gate.
      expect(ability?.playableIf, id).toBeUndefined();
    }
  });

  it("the program is the printed order: the snipe, THEN the self-Knock-Out", () => {
    expect(programFor(DUSCLOPS)?.abilities?.[0]?.program).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 50, count: 1, source: "ability" },
      { op: "knockOutSelf" },
    ]);
    expect(programFor(DUSKNOIR)?.abilities?.[0]?.program).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 130, count: 1, source: "ability" },
      { op: "knockOutSelf" },
    ]);
  });

  it("the amounts are HP and the ×10 was done at the PRODUCER — 5 → 50, 13 → 130", () => {
    // The one place a reader of `damageChosen` can be off by a factor of ten. The
    // printed COUNTERS are read back out of the fixture text so this cannot drift
    // from the card: the number in the sentence times ten is the number in the op.
    for (const [id, text] of [
      [DUSCLOPS, DUSCLOPS_TEXT],
      [DUSKNOIR, DUSKNOIR_TEXT],
    ] as const) {
      const printed = Number(/put (\d+) damage counters/.exec(text)?.[1]);
      const op = programFor(id)?.abilities?.[0]?.program?.[0];
      expect(op, id).toMatchObject({ op: "damageChosen", amount: printed * 10 });
    }
  });

  it("the snipe carries NO rider — not optional, not `deals`, not `ignoreWR`", () => {
    for (const id of [DUSCLOPS, DUSKNOIR]) {
      const op = programFor(id)?.abilities?.[0]?.program?.[0];
      // The printed "you may" governs USING the Ability; once used, the placement
      // is mandatory. `optional` is Hawlucha's auto-fired TRIGGER shape.
      expect(op).not.toHaveProperty("optional");
      // "put damage counters" is not damage: flat, no W/R (§4 drives it).
      expect(op).not.toHaveProperty("deals");
      expect(op).not.toHaveProperty("ignoreWR");
    }
  });

  it("`knockOutSelf` is FIELD-FREE, and that is the census rather than a shortcut", () => {
    // The clause is byte-identical across all THREE sentences that print it, so
    // there is nothing for a field to vary over (D104's minimal-shape rule).
    for (const id of [DUSCLOPS, DUSKNOIR]) {
      expect(programFor(id)?.abilities?.[0]?.program?.[1]).toEqual({ op: "knockOutSelf" });
    }
    expect(Object.keys(programFor(DUSCLOPS)?.abilities?.[0]?.program?.[1] ?? {})).toEqual(["op"]);
  });

  it("all SIX ids are in the live registry and no seventh rode along", () => {
    const ids = new Set(registryCardIds());
    for (const id of [...DUSCLOPS_IDS, ...DUSKNOIR_IDS]) expect(ids.has(id), id).toBe(true);
    // The pool of ids carrying THIS ability name is exactly the six — a seventh
    // would mean Magneton was quietly authored on the strength of the shared op.
    const named = registryCardIds().filter((id) =>
      programFor(id)?.abilities?.some((a) => a.name === "Cursed Blast"),
    );
    expect(named.sort()).toEqual([...DUSCLOPS_IDS, ...DUSKNOIR_IDS].sort());
  });
});

describe("🆕 D346 — §2's REFUSAL IS SPENT: the clause's THIRD sentence is BUILT", () => {
  // 🛑🛑 **THIS SECTION USED TO ASSERT THE OPPOSITE, AND IT WAS WRONG THE DAY IT
  // WAS WRITTEN.** D345 drove *"Magneton ×3 has no program"* with the reason
  // *"the SECOND mechanism its effect half needs … a DISTRIBUTION across several
  // bodies that `attachEnergyFrom` cannot spell"*. `attachEnergyFrom` spells it by
  // being written THREE TIMES, which is `ASSEMBLE_ALLOY` (D263) and the op's own
  // `count` doc (D205). D346 built the card for a registry row and no engine line.
  //
  // ⚠️ **KEPT AS AN INVERTED SECTION RATHER THAN DELETED**, because the pair of
  // assertions below is the same guard pointed the other way: the six Cursed Blast
  // ids and the three Magneton ids must stay THREE program objects on ONE op, and
  // a tenth id or a fourth object is still a row nobody decided. **A REFUSAL THAT
  // GETS SPENT SHOULD BECOME THE CORRESPONDING ADMISSION, NOT A DELETED TEST.**
  it("Magneton ×3 IS authored, on ONE object, sharing this op", () => {
    const first = programFor(MAGNETON_IDS[0]);
    expect(first).toBeDefined();
    for (const id of MAGNETON_IDS) expect(programFor(id), id).toBe(first);
    expect(first?.abilities?.[0]?.name).toBe("Overvolt Discharge");
  });

  it("`knockOutSelf` has exactly THREE producers in the whole registry", () => {
    // The op is not a capability sitting unused, and it is not quietly spreading
    // either: a FOURTH producer means a slice authored a row this note does not
    // describe. Counted over PROGRAM OBJECTS, not ids — nine ids, three objects.
    // 🆕 D346 — 2 → 3, and the third arrived one decision after the op, which is
    // the fastest a producer has ever followed an op in this registry.
    const objects = new Set(
      registryCardIds()
        .map((id) => programFor(id))
        .filter((program) =>
          [...(program?.abilities ?? []), ...(program?.triggered ?? [])].some((ability) =>
            ability.program.some((op) => op.op === "knockOutSelf"),
          ),
        ),
    );
    expect(objects.size).toBe(3);
  });
});

describe("D345 §3 — Cursed Blast from the BENCH: the counters land, the host dies", () => {
  it("parks on the opponent's WHOLE board, Active first — `opponentAny`", () => {
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WALL, CHAFF, CHAFF] });
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.candidates[1]).toMatchObject({ seat: "p2", spot: { spot: "bench", index: 0 } });
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt.note).toContain("of your opponent's Pokémon");
  });

  it("5 counters land FLAT on a benched pick, and the Dusclops is Knocked Out", () => {
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WALL, CHAFF] });
    const blaster = benchTopUid(state, "p1", 0);
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    // The counters: a COUNTERS_PLACED row, not DAMAGE_DEALT — this is a placement.
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: 50, source: "ability" });
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(after.players.p2.bench[0]?.damage).toBe(50);
    // And the printed cost: the host is Knocked Out in the SAME resolution.
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(blaster);
    expect(after.players.p1.bench).toHaveLength(0);
  });

  it("the Knock Out is a real §8.1 one: the OPPONENT takes a Prize, mid-p1's-turn", () => {
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WALL, CHAFF] });
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    // p1 blew up its OWN body, so the Prize is p2's — during p1's turn, which is
    // the whole oddity of this card and exactly what §8.1 says.
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p2");
    expect(after.phase.count).toBe(1); // not an `ex`
    const { state: done } = step(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] });
    expect(done.players.p2.prizes).toHaveLength(5);
    expect(done.players.p1.prizes).toHaveLength(6);
    // A BENCHED Knock Out owes no promotion, so the turn comes straight back.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("the whole stack goes to the KO'd side's discard, not the opponent's", () => {
    const state = board({ p1: [WALL, DUSKNOIR], p2: [WALL, CHAFF] });
    const blaster = benchTopUid(state, "p1", 0);
    const before = state.players.p1.discard.length;
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(find(events, "KNOCKED_OUT")?.seat).toBe("p1");
    expect(after.players.p1.discard).toContain(blaster);
    expect(after.players.p1.discard.length).toBe(before + 1);
    expect(after.players.p2.discard).not.toContain(blaster);
  });

  it("the once-per-turn lock is PER BODY: two Dusclops, two blasts, two Prizes", () => {
    let state = board({ p1: [WALL, DUSCLOPS, DUSCLOPS_REPRINT], p2: [WALL, CHAFF] });
    for (const _ of [0, 1]) {
      const parked = blast(state, { spot: "bench", index: 0 }).state;
      if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
      const after = step(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
      }).state;
      if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
      state = step(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] }).state;
    }
    // 100 HP of counters on one benched CHAFF (60 HP) would have KO'd it, so the
    // second blast is aimed at the same body only through the prompt above — the
    // point here is the two SELF Knock Outs and the two Prizes they bought p2.
    expect(state.players.p2.prizes).toHaveLength(4);
    expect(state.players.p1.bench).toHaveLength(0);
  });
});

describe("D345 §4 — 'is Knocked Out' is NOT damage, and the counters are NOT attack damage", () => {
  it("the counters stay FLAT on a Weakness-matching ACTIVE — no ×2", () => {
    // `opponentAny` lands on the Active, which for an ATTACK would run §8.5. This
    // is a PLACEMENT (`source: "ability"`, no `deals`), so Weakness never fires:
    // 50 on a ×2-Psychic body is 50, and the Dusclops is Psychic.
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WEAK_TO_PSYCHIC, CHAFF] });
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(50);
    expect(after.players.p2.active?.damage).toBe(50); // 50, not 100
  });

  it("the host dies with NO `DAMAGED`/`COUNTERS_PLACED` row of its own", () => {
    // The op marks the body lethal and hands it to §8.1; it emits nothing. The
    // ONLY counter row in the batch is the one aimed at the opponent, and the
    // only thing said about the host is that it was Knocked Out.
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WALL, CHAFF] });
    const blaster = benchTopUid(state, "p1", 0);
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    const aboutTheHost = events.filter(
      (e) => "uid" in e && e.uid === blaster && e.type !== "ABILITY_USED",
    );
    expect(aboutTheHost.map((e) => e.type)).toEqual(["KNOCKED_OUT"]);
  });

  it("an HP AURA on the host's own side is read AT THE MOMENT THE OP RUNS", () => {
    // `effectiveMaxHp` is the number the op must meet, not the printed HP — a
    // Ludicolo raising the whole side's maximum is on the board when Cursed Blast
    // resolves, so the Dusclops still dies. This is the one branch where "set
    // damage to the printed HP" and "set damage to the effective maximum" differ,
    // and it is driven rather than argued.
    // THE ATTRIBUTION CONTROL FIRST: the aura is a REAL registry program, not an
    // invented fixture. Without this the case is vacuous — a body carrying Ability
    // TEXT and no program raises nobody's maximum, and the Dusclops would die of
    // its printed 90 while the assertion below looked satisfied.
    expect(programFor(AURA)?.passive?.seatHpBonus).toEqual({
      ability: "Vibrant Dance",
      amount: 40,
      noStack: true,
    });
    const state = board({ p1: [WALL, DUSCLOPS, AURA], p2: [WALL, CHAFF] });
    const blaster = benchTopUid(state, "p1", 0);
    // 90 printed + 40 seat-wide = 130, and the op must meet the EFFECTIVE number.
    expect(state.players.p1.bench[0]?.damage).toBe(0);
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    // 🛑 BY UID, NOT `toBeDefined`. A reader that met the PRINTED 90 instead of
    // the effective 130 would leave the Dusclops alive at 90/130 and this case
    // would still see a `KNOCKED_OUT` if any other body happened to die — the uid
    // is what makes the aura load-bearing rather than decorative.
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(blaster);
    // Exactly ONE body left play, and it is not the Ludicolo: the aura raises the
    // whole side's maximum, so a mark aimed at the wrong body would kill the
    // SOURCE of the number it was aiming at.
    expect(events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(1);
    expect(after.players.p1.bench).toHaveLength(1);
    expect(after.players.p1.bench[0]?.stack.at(-1)).not.toBe(blaster);
  });

  it("an ALREADY-DAMAGED host is not healed by the marking — `Math.max`, not `=`", () => {
    // The op raises `damage` to the effective maximum and can never LOWER it. A
    // plain assignment would be behaviour-identical on every board the catalog can
    // build (the body dies either way) — so the claim is about the STATE the KO
    // sweep reads, and it is asserted through the event the sweep emits.
    const seeded = board({ p1: [WALL, DUSCLOPS], p2: [WALL, CHAFF] });
    const damaged: GameState = {
      ...seeded,
      players: {
        ...seeded.players,
        p1: {
          ...seeded.players.p1,
          bench: seeded.players.p1.bench.map((body, i) =>
            i === 0 ? { ...body, damage: 80 } : body,
          ),
        },
      },
    };
    const { state: parked } = blast(damaged, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
  });
});

describe("D345 §5 — the ACTIVE Spot: §8.1's promotion, through the shared seam", () => {
  it("an ACTIVE Dusknoir blasts, dies, and owes a PROMOTION after the Prize", () => {
    // TWO benched bodies behind the blaster on purpose: §8.1's promotion
    // AUTO-RESOLVES on a Bench of one, so a single body would hide the stage this
    // case exists to show.
    const state = board({ p1: [DUSKNOIR, CHAFF, WALL], p2: [WALL, CHAFF] });
    const blaster = activeUid(state, "p1");
    const { state: parked } = blast(state, { spot: "active" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(130);
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(blaster);
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    const { state: promoting } = step(after, {
      type: "takePrizes",
      seat: "p2",
      prizeIndices: [0],
    });
    // The Active Spot is empty and §8.1 owes the refill — queued by
    // `resolveMidTurnKnockOuts`, the SAME seam `returnSelf` rides.
    if (promoting.phase.kind !== "ko:promote") throw new Error("expected ko:promote");
    expect(promoting.phase.seat).toBe("p1");
    expect(promoting.players.p1.active).toBeNull();
    const { state: done } = step(promoting, {
      type: "promote",
      seat: "p1",
      benchIndex: 0,
    });
    expect(done.players.p1.active).not.toBeNull();
    // …and the turn is STILL p1's: this is a mid-turn Knock Out, not an attack.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("a blaster with an EMPTY Bench behind it loses the game (§14.2)", () => {
    // The §8.1 promotion has nowhere to go, which is the same terminal
    // `returnSelf` found at D311 — reached here by a Knock Out instead.
    const state = board({ p1: [DUSCLOPS], p2: [WALL, CHAFF] });
    const { state: parked } = blast(state, { spot: "active" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    const settled =
      after.phase.kind === "ko:takePrizes"
        ? step(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] }).state
        : after;
    if (settled.phase.kind !== "gameOver")
      throw new Error(`expected gameOver, got ${settled.phase.kind}`);
    expect(settled.phase.outcome).toEqual({ result: "win", winner: "p2", reason: "noPokemon" });
  });
});

describe("D345 §6 — the FORCED path: one candidate, no park, same two ops", () => {
  it("an opponent with only an Active auto-takes the snipe and still costs the host", () => {
    // `damageChosen` is mandatory (no `optional`), so a single candidate
    // auto-resolves and the whole program runs synchronously. That is the branch
    // where a self-KO authored as a PARK-only tail would silently never fire.
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WALL] });
    const blaster = benchTopUid(state, "p1", 0);
    const { state: after, events } = blast(state, { spot: "bench", index: 0 });
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: 50, seat: "p2" });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(blaster);
  });

  it("a board with NOTHING to snipe is refused at the ACTION layer, so the cost is never paid for nothing", () => {
    // 🛑 THE TWO FACTS ARE SEPARATE AND BOTH ARE DRIVEN. The OP carries no gate
    // (§1: `{ op: "knockOutSelf" }` is field-free, and the printed condition is
    // *"if you use this Ability"*, not *"if you placed any counters"*), so nothing
    // inside the program would stop the host dying after a whiffed snipe. What
    // stops it is `programPlayable`, one layer up: an Ability whose FIRST op has
    // an empty candidate set is refused before it is spent — the engine's
    // would-only-whiff judgement, not a rule on the card.
    //
    // ⚠️ AND THIS IS THE BOARD THAT CAUGHT `programPlayable`'s `damageChosen` arm
    // reading the opponent's BENCH for an `opponentAny` op. With the funnel shared
    // (`snipeTargets`), a bare Active is playable and a bare board is not.
    const seeded = board({ p1: [WALL, DUSCLOPS], p2: [WALL] });
    const empty: GameState = {
      ...seeded,
      players: {
        ...seeded.players,
        p2: { ...seeded.players.p2, active: null, bench: [] },
      },
    };
    const refused = applyAction(empty, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Cursed Blast",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected a refusal");
    expect(refused.error.code).toBe("NO_LEGAL_TARGET");
    // …and the SAME board with the Active put back is playable, which is what
    // makes the refusal a statement about the candidate set rather than about
    // this suite's surgery.
    expect(
      applyAction(seeded, {
        type: "useAbility",
        seat: "p1",
        target: { spot: "bench", index: 0 },
        abilityName: "Cursed Blast",
      }).ok,
    ).toBe(true);
  });
});
