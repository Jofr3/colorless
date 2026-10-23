import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { normalizeCardText } from "./cardText";
import {
  deriveAttackEffect,
  deriveAttackOptionalCostBoost,
  optionalCostBoostProgram,
  splitAttackTrailingClause,
} from "./effects";
import type { GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D608 — WP30: THE `me` SNIPE / SPREAD WORDING ───────────────────────────────────────────────
//
// 7 attack sentences / 13 `me` printings newly reader-built, plus 5 `30th` printings keyed by id
// (tcgdex's `<em>` markup, WP06) — 18 attack printings, 15 printings finished. Every id and text off the
// LOCAL D1, 2026-10-08, `legal_standard = 1`; no id was referenced in the tree before this slice.
//
//   "each of 2"  — `CHOSEN_ANY_TARGET` / `SELF_DISCARD_THEN_ANY_TARGET` read it as the shipped arity
//                  (Mega Eelektross ex "Split Bomb" ×3, Ambipom "Dual Tail" ×2).
//   Disaster Shock ×3 — the fourth optional-cost skeleton, payoff `defenderStatus` (an inner confirm).
//   Sonic Ripper ×2, Phantasmal Barrage — two literal cost-then-snipe compounds.
//   Bone Sniper — the new `damageChosen.specialEnergyOnly` board narrowing.
//   Stealthy Slash ×3 — `BENCHED_SNIPE_TARGET_COUNTERS` without "Benched" is `opponentAny`; the two
//                  `30th` faces are keyed (`STEALTHY_SLASH`). [🆕🆕🆕 D612: the key is RETIRED — WP06's
//                  normaliser strips the `<em>`, so the `30th` faces read `mep-099`'s sentence.]
//   Photon Bullets ×3 — the ex-only spread, keyed (`PHOTON_BULLETS`): D492's op without `ignoreWR`.

const SPLIT_BOMB =
  "This attack does 60 damage to each of 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const DUAL_TAIL =
  "Discard 2 Energy from this Pokémon, and this attack does 60 damage to each of 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const DISASTER_SHOCK =
  "You may discard 2 {L} Energy from this Pokémon and make your opponent's Active Pokémon Paralyzed.";
const SONIC_RIPPER =
  "Shuffle all Energy attached to this Pokémon into your deck, and this attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const BONE_SNIPER =
  "This attack does 70 damage to 1 of your opponent's Pokémon that has any Special Energy attached. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const STEALTHY_SLASH =
  "This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const PHANTASMAL_BARRAGE =
  "Discard all Energy from this Pokémon and place 12 damage counters on 1 of your opponent's Pokémon.";
const STEALTHY_SLASH_EM =
  "This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. <em>(Don't apply Weakness and Resistance for Benched Pokémon.)</em>";
const PHOTON_BULLETS =
  "This attack does 50 damage to each of your opponent's Pokémon <em>ex</em>. <em>(Don't apply Weakness and Resistance for Benched Pokémon.)</em>";

/** [attack text, the `me` printing ids that print it] — the seven reader-built sentences. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [SPLIT_BOMB, ["me02.5-061", "me02.5-266", "me02.5-278"]],
  [DISASTER_SHOCK, ["me02.5-061", "me02.5-266", "me02.5-278"]],
  [DUAL_TAIL, ["me02-079", "me02-107"]],
  [SONIC_RIPPER, ["me03-055", "me03-106"]],
  [BONE_SNIPER, ["me05-050"]],
  [STEALTHY_SLASH, ["mep-099"]],
  [PHANTASMAL_BARRAGE, ["me02.5-098"]],
];

/** [markup text, the keyed `30th` ids, the registry object's attack index 0].
    🆕🆕🆕 D612 — the RAW tcgdex texts: the corpus now holds their normalised forms (WP06), and a
    persisted pre-D612 face still carries these (§7 drives them through `cardOfUid`). */
const KEYED: readonly (readonly [string, readonly string[]])[] = [
  [PHOTON_BULLETS, ["30th-064", "30th-151", "30th-157"]],
  [STEALTHY_SLASH_EM, ["30th-021", "30th-148"]],
];

/** WP30's rest, named: each needs vocabulary beyond this slice (8 texts / 8 printings).
    [🆕🆕🆕 D629 (D539): seven BUILT at D629 (S1); Psyspear `me04-032` stays unbuilt.] [🆕🆕🆕 D645 (D539): Psyspear BUILT at D645.] */
const WP30_REST: readonly (readonly [string, string])[] = [
  // tcgdex markup (WP06) AND a typed self-discard in front of the any-target hit.
  // 🆕🆕🆕 D612 — the normalised text (WP06): the markup is gone; the typed self-discard stays unread.
  [
    "Discard all {L} Energy from this Pokémon, and this attack does 90 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    "30th-051",
  ],
  // a Special-Condition gate in front of a counter placement on the Bench.
  [
    "If your opponent's Active Pokémon is affected by a Special Condition, place 6 damage counters on 1 of your opponent's Benched Pokémon.",
    "me02.5-086",
  ],
  // a discard-pile count gate BEHIND a snipe.
  [
    "This attack does 140 damage to 1 of your opponent's Pokémon. If you don't have 10 or more Basic {F} Energy cards in your discard pile, this attack does nothing. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    "me02.5-120",
  ],
  // a TYPED per-Energy multiplier on a chosen target (`perEnergyOnSelf` is untyped).
  [
    "This attack does 20 damage to 1 of your opponent's Pokémon for each {G} Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    "me02-008",
  ],
  [
    "This attack does 30 damage to 1 of your opponent's Pokémon for each {W} Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    "me05-014",
  ],
  // a clause AFTER the parenthetical (the trailing splitter cuts at the first period).
  // [🆕🆕🆕 D629 (D539): WITHDRAWN — `COMPOUND_CLAUSE_BREAK` breaks after `.)` too; both compose since D629.]
  [
    "This attack does 20 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) Your opponent's Active Pokémon is now Asleep.",
    "me01-043",
  ],
  [
    "This attack does 50 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) This Pokémon also does 130 damage to itself.",
    "30th-104",
  ],
  // an extra-Energy gate (~~a count source, not a `BoardCondition`~~) on a bench snipe. [🆕🆕🆕 D645 (D539): WITHDRAWN —
  // read at D645 as the NEW `BoardCondition` `extraEnergyBeyondAttackCost`, answered at declaration, never in the shared table.]
  [
    "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    "me04-032",
  ],
];

describe("D608 §1 — the texts", () => {
  it("7 sentences / 13 printings, each a row of the committed `me` corpus, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      // 🆕🆕🆕 D612 — Stealthy Slash's row is 3: the two `30th` faces normalise into it (WP06).
      expect([text, me.get(text)]).toEqual([
        text,
        text === STEALTHY_SLASH ? ids.length + 2 : ids.length,
      ]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(13);
    expect(new Set(SENTENCES.flatMap(([, ids]) => ids)).size).toBe(10);
  });

  it("the two markup sentences: unread, keyed by id at attack index 0, 5 printings (🆕🆕🆕 D612: normalised — Photon Bullets ×3 still unread and keyed; Stealthy Slash ×2 read, its key retired)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, ids] of KEYED) {
      // 🆕🆕🆕 D612 — the raw text is gone from the corpus; its normalised form is the row.
      expect(me.has(text), text).toBe(false);
      const clean = normalizeCardText(text);
      expect([clean, me.get(clean)]).toEqual([
        clean,
        text === PHOTON_BULLETS ? ids.length : ids.length + 1,
      ]);
      expect(resolvedByAnyReader(text), text).toBe(false);
      if (text === PHOTON_BULLETS) {
        expect(resolvedByAnyReader(clean), clean).toBe(false);
        for (const id of ids) expect(Object.keys(programFor(id)?.attack ?? {}), id).toEqual(["0"]);
      } else {
        expect(clean).toBe(STEALTHY_SLASH);
        expect(resolvedByAnyReader(clean), clean).toBe(true);
        for (const id of ids) expect(programFor(id), id).toBeUndefined();
      }
    }
  });

  it('WP30\'s rest ~~stays unbuilt~~: 8 texts / 8 printings, named (🆕🆕🆕 D629 (D539): WITHDRAWN for seven — S1 builds all but Deoxys `me04-032` "Psyspear"; `snipeSpreadRestMeD629.test.ts`) (🆕🆕🆕 D645 (D539): and Psyspear is built at D645)', () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, id] of WP30_REST) {
      expect([id, me.get(text)]).toEqual([id, 1]);
      // 🆕🆕🆕 D629 — seven are built (two by composition); ~~Psyspear alone stays unread~~ [🆕🆕🆕 D645 (D539):
      // WITHDRAWN — Psyspear is reader-built at D645; all eight are built].
      expect([id, resolvedByAnyReader(text) || splitAttackTrailingClause(text) !== null]).toEqual([
        id,
        true,
      ]);
      expect(programFor(id), id).toBeUndefined();
    }
  });
});

describe("D608 §2 — the readings", () => {
  it('"each of 2" is the shipped arity: the same op as "2 of"', () => {
    const two = {
      op: "damageChosen",
      target: "opponentAny",
      amount: 60,
      count: 2,
      source: "attack",
      deals: true,
    };
    expect(deriveAttackEffect(SPLIT_BOMB)).toEqual([two]);
    expect(deriveAttackEffect(SPLIT_BOMB.replace("each of 2", "2"))).toEqual([two]);
    expect(deriveAttackEffect(DUAL_TAIL)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
      two,
    ]);
    // "each of 1" is printed nowhere and is refused on both anchors.
    expect(deriveAttackEffect(SPLIT_BOMB.replace("each of 2", "each of 1"))).toBeNull();
    expect(deriveAttackEffect(DUAL_TAIL.replace("each of 2", "each of 1"))).toBeNull();
  });

  it("Disaster Shock: the D589 typed cost row, then Paralyzed — one gate, one confirm, no decline arm", () => {
    const reading = deriveAttackOptionalCostBoost(DISASTER_SHOCK);
    expect(reading).toEqual({
      cond: { kind: "yourActiveEnergyAtLeast", count: 2, energy: "Lightning" },
      ops: [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "providesEnergy", energyType: "Lightning" },
          count: 2,
        },
      ],
      payoff: { kind: "defenderStatus", status: "paralyzed" },
    });
    expect(deriveAttackEffect(DISASTER_SHOCK)).toBeNull();
    if (reading === null) throw new Error("unread");
    expect(optionalCostBoostProgram(reading, 190, DISASTER_SHOCK)).toEqual([
      {
        op: "conditionGate",
        cond: reading.cond,
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-step list.
        then: [
          {
            op: "optional",
            note: DISASTER_SHOCK,
            // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-step list.
            then: [...reading.ops, { op: "applyStatus", target: "defender", status: "paralyzed" }],
          },
        ],
      },
    ]);
    // A cost the table cannot pay keeps the sentence unread (the Paralyzed sibling `me` prints).
    expect(
      deriveAttackOptionalCostBoost(
        "You may have this Pokémon also do 60 damage to itself and make your opponent's Active Pokémon Paralyzed.",
      ),
    ).toBeNull();
  });

  it("the three literal compounds", () => {
    expect(deriveAttackEffect(SONIC_RIPPER)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "anyEnergy" },
        count: "all",
        to: "deck",
      },
      { op: "shuffleDeck" },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 220,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackEffect(BONE_SNIPER)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 70,
        count: 1,
        source: "attack",
        deals: true,
        specialEnergyOnly: true,
      },
    ]);
    expect(deriveAttackEffect(PHANTASMAL_BARRAGE)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "damageChosen", target: "opponentAny", amount: 120, count: 1, source: "attack" },
    ]);
    // Printed zeros stay loud.
    expect(deriveAttackEffect(SONIC_RIPPER.replace("220", "0"))).toBeNull();
    expect(deriveAttackEffect(BONE_SNIPER.replace("70", "0"))).toBeNull();
    expect(deriveAttackEffect(PHANTASMAL_BARRAGE.replace("12", "0"))).toBeNull();
  });

  it("Stealthy Slash is `opponentAny`; the Benched sentence keeps `opponentBench`; the keyed program is the reader's (🆕🆕🆕 D612: the key is retired — the raw `30th` text normalises to the reader's sentence)", () => {
    const anyTarget = deriveAttackEffect(STEALTHY_SLASH);
    expect(anyTarget).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 30,
        count: 1,
        source: "attack",
        deals: true,
        perDamageCounterOnTarget: true,
      },
    ]);
    expect(
      deriveAttackEffect(
        STEALTHY_SLASH.replace("opponent's Pokémon for", "opponent's Benched Pokémon for"),
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 30,
        count: 1,
        source: "attack",
        deals: true,
        perDamageCounterOnTarget: true,
      },
    ]);
    // 🆕🆕🆕 D612 — no key: the `30th` text, normalised, IS the reader's sentence.
    for (const id of ["30th-021", "30th-148"]) expect(programFor(id), id).toBeUndefined();
    expect(deriveAttackEffect(normalizeCardText(STEALTHY_SLASH_EM))).toEqual(anyTarget);
  });

  it("Photon Bullets is D492's filtered spread WITHOUT `ignoreWR` (🆕🆕🆕 D622: or `wrOnly`)", () => {
    const shipped = deriveAttackEffect(
      "This attack does 50 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
    );
    // 🆕🆕🆕 D622 — the bare tail's `wrOnly` goes with `ignoreWR`: Photon Bullets prints no W/R tail.
    const {
      ignoreWR: _dropped,
      wrOnly: _bare,
      ...withoutIgnore
    } = (shipped?.[0] ?? {}) as Record<string, unknown>;
    for (const id of ["30th-064", "30th-151", "30th-157"]) {
      expect(programFor(id)?.attack?.[0], id).toEqual([withoutIgnore]);
    }
  });
});

// ── ON A BOARD ──

const FILLER = "d608-filler";
const TARGET_L = "d608-weak-to-lightning";
const TARGET_W = "d608-weak-to-water";
const TARGET_EX = "d608-target-ex";
const L = "d608-lightning";
const M = "d608-metal";
const P = "d608-psychic";
const W = "d608-water";
const D = "d608-darkness";

const mon = (
  id: string,
  name: string,
  hp: number,
  type: string,
  attacks: Card["attacks"],
  extra: Partial<Card> = {},
) => battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  "me02.5-061": mon(
    "me02.5-061",
    "Mega Eelektross ex",
    350,
    "Lightning",
    [
      { cost: ["Lightning", "Lightning"], name: "Split Bomb", effect: SPLIT_BOMB },
      {
        cost: ["Lightning", "Lightning", "Lightning"],
        name: "Disaster Shock",
        damage: 190,
        effect: DISASTER_SHOCK,
      },
    ],
    { stage: "Stage2", evolveFrom: "Eelektrik" },
  ),
  "me02-079": mon(
    "me02-079",
    "Ambipom",
    110,
    "Colorless",
    [
      { cost: ["Colorless", "Colorless"], name: "Slap", damage: 50 },
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Dual Tail", effect: DUAL_TAIL },
    ],
    { stage: "Stage1", evolveFrom: "Aipom" },
  ),
  "me03-055": mon("me03-055", "Mega Skarmory ex", 260, "Metal", [
    { cost: ["Metal", "Metal", "Colorless"], name: "Sonic Ripper", effect: SONIC_RIPPER },
  ]),
  "me05-050": mon(
    "me05-050",
    "Mandibuzz",
    120,
    "Darkness",
    [
      { cost: ["Darkness"], name: "Bone Sniper", effect: BONE_SNIPER },
      { cost: ["Darkness", "Darkness", "Colorless"], name: "Blasting Wind", damage: 120 },
    ],
    { stage: "Stage1", evolveFrom: "Vullaby" },
  ),
  "mep-099": mon(
    "mep-099",
    "Greninja ex",
    300,
    "Water",
    [
      { cost: ["Water"], name: "Stealthy Slash", effect: STEALTHY_SLASH },
      { cost: ["Water", "Water"], name: "Aqua Edge", damage: 160 },
    ],
    { stage: "Stage2", evolveFrom: "Frogadier" },
  ),
  "30th-021": mon("30th-021", "Greninja ex", 300, "Water", [
    { cost: ["Water"], name: "Stealthy Slash", effect: STEALTHY_SLASH_EM },
    { cost: ["Water", "Water"], name: "Aqua Edge", damage: 160 },
  ]),
  "30th-064": mon("30th-064", "Mewtwo ex", 230, "Psychic", [
    { cost: ["Psychic", "Psychic"], name: "Photon Bullets", effect: PHOTON_BULLETS },
    {
      cost: ["Psychic", "Psychic", "Psychic"],
      name: "Psychic Powers",
      damage: 230,
      effect: "During your next turn, this Pokémon can't use attacks.",
    },
  ]),
  "me02.5-098": mon("me02.5-098", "Spectrier", 120, "Psychic", [
    { cost: ["Psychic"], name: "Spooky Shot", damage: 30 },
    {
      cost: ["Psychic", "Psychic", "Colorless"],
      name: "Phantasmal Barrage",
      effect: PHANTASMAL_BARRAGE,
    },
  ]),
  [FILLER]: mon(FILLER, "D608 Filler", 400, "Colorless", TAP),
  [TARGET_L]: mon(TARGET_L, "D608 Volt Target", 400, "Water", TAP, {
    weaknesses: [{ type: "Lightning", value: "×2" }],
  }),
  [TARGET_W]: mon(TARGET_W, "D608 Tide Target", 400, "Fire", TAP, {
    weaknesses: [{ type: "Water", value: "×2" }],
  }),
  [TARGET_EX]: mon(TARGET_EX, "D608 Target ex", 400, "Fighting", TAP, {
    weaknesses: [{ type: "Psychic", value: "×2" }],
  }),
  [L]: typedEnergy(L, "Lightning"),
  [M]: typedEnergy(M, "Metal"),
  [P]: typedEnergy(P, "Psychic"),
  [W]: typedEnergy(W, "Water"),
  [D]: typedEnergy(D, "Darkness"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me02.5-061": 1,
  "me02-079": 1,
  "me03-055": 1,
  "me05-050": 1,
  "mep-099": 1,
  "30th-021": 1,
  "30th-064": 1,
  "me02.5-098": 1,
  [FILLER]: 8,
  [TARGET_L]: 2,
  [TARGET_W]: 2,
  [TARGET_EX]: 3,
  [L]: 4,
  [M]: 3,
  [P]: 4,
  [W]: 2,
  [D]: 2,
  "fix-blend": 4,
  "fix-energy": 18,
});
const BOARD_IDS = new Set([...Object.keys(LOCAL).filter((id) => id !== FILLER), "fix-blend"]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6081, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = {
      ...state,
      players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
    };
  }
  return state;
}

/** TEST SURGERY — every Prize whose id is a board id swapped with a Filler / fix-energy deck card. */
function unprize(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!BOARD_IDS.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !BOARD_IDS.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active is `attacker` with `energy`; P2's Active is `defender` with `bench` behind it. */
function table(
  attacker: string,
  energy: readonly (readonly [string, number])[],
  defender: string = FILLER,
  bench: readonly string[] = [],
): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const)
    state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const bench = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const pick = (state: GameState, refs: readonly PokemonRef[]) =>
  mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [...refs] },
  } as GameAction);
const say = (state: GameState, yes: boolean) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });
const damageOf = (state: GameState) => [
  state.players.p2.active?.damage ?? -1,
  ...state.players.p2.bench.map((b) => b.damage),
];
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

function parkedMulti(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "choosePokemonMulti") {
    throw new Error(`expected a pokemonMulti park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}

describe('D608 §3 — "each of 2" on a board', () => {
  it("Split Bomb: pick EXACTLY two; the Active takes Weakness (120), a Benched body 60, the third nothing", () => {
    const parked = mustApply(
      table("me02.5-061", [[L, 2]], TARGET_L, [FILLER, FILLER]),
      attack(0),
    ).state;
    const prompt = parkedMulti(parked);
    expect([prompt.min, prompt.max, prompt.candidates.length]).toEqual([2, 2, 3]);
    expect(prompt.note).toBe("Choose 2 of your opponent's Pokémon (60 damage each).");
    const result = pick(parked, [ACTIVE, bench(1)]);
    expect(damageOf(result.state)).toEqual([120, 0, 60]);
  });

  it("Split Bomb over a lone Active is forced (§8.6): 120 and no park", () => {
    const result = mustApply(table("me02.5-061", [[L, 2]], TARGET_L), attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damageOf(result.state)).toEqual([120]);
  });

  it("Dual Tail: two Energy discarded first, then 60 to each of two Benched bodies", () => {
    const parked = mustApply(
      table("me02-079", [["fix-energy", 3]], FILLER, [FILLER, FILLER]),
      attack(1),
    ).state;
    expect(parkedMulti(parked).max).toBe(2);
    expect(parked.players.p1.active?.energy).toHaveLength(1);
    const result = pick(parked, [bench(0), bench(1)]);
    expect(damageOf(result.state)).toEqual([0, 60, 60]);
    expect(ids(result.state, result.state.players.p1.discard)).toEqual([
      "fix-energy",
      "fix-energy",
    ]);
  });
});

describe("D608 §4 — Disaster Shock: the optional discard and the Paralysis", () => {
  const swing = (yes: boolean) => {
    const parked = mustApply(table("me02.5-061", [[L, 3]], FILLER), attack(1));
    expect(of(parked.events, "DAMAGE_DEALT")[0]?.dealt).toBe(190); // the printed base lands first
    if (
      parked.state.phase.kind !== "effect:choose" ||
      parked.state.phase.prompt.kind !== "confirm"
    ) {
      throw new Error(`expected a confirm, got ${parked.state.phase.kind}`);
    }
    return say(parked.state, yes);
  };

  it("yes: two {L} discarded, the Defending Pokémon Paralyzed, still 190", () => {
    const result = swing(true);
    expect(of(result.events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["paralyzed"]);
    expect(ids(result.state, result.state.players.p1.active?.energy ?? [])).toEqual([L]);
    expect(ids(result.state, result.state.players.p1.discard)).toEqual([L, L]);
    expect(result.state.players.p2.active?.damage).toBe(190);
  });

  it("no: nothing discarded, no status, the 190 stands", () => {
    const result = swing(false);
    expect(of(result.events, "STATUS_APPLIED")).toEqual([]);
    expect(result.state.players.p1.active?.energy).toHaveLength(3);
    expect(result.state.players.p2.active?.damage).toBe(190);
  });
});

describe("D608 §5 — the literal compounds on a board", () => {
  it("Sonic Ripper: every Energy shuffled into the deck, then 220 to the chosen body", () => {
    const before = table(
      "me03-055",
      [
        [M, 2],
        ["fix-energy", 1],
      ],
      FILLER,
      [FILLER],
    );
    const parked = mustApply(before, attack(0));
    expect(parked.state.players.p1.active?.energy).toEqual([]);
    expect(parked.state.players.p1.deck.length).toBe(before.players.p1.deck.length + 3);
    expect(of(parked.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
    const result = pick(parked.state, [bench(0)]);
    expect(damageOf(result.state)).toEqual([0, 220]);
    expect(ids(result.state, result.state.players.p1.discard)).toEqual([]);
  });

  it("Phantasmal Barrage: every Energy discarded, then 12 counters PLACED (no Weakness) on the chosen body", () => {
    const parked = mustApply(table("me02.5-098", [[P, 3]], TARGET_EX, [FILLER]), attack(1));
    expect(ids(parked.state, parked.state.players.p1.discard)).toEqual([P, P, P]);
    const result = pick(parked.state, [ACTIVE]);
    expect(damageOf(result.state)).toEqual([120, 0]);
    expect(of(result.events, "DAMAGE_DEALT")).toEqual([]);
    expect(of(result.events, "COUNTERS_PLACED")[0]?.amount).toBe(120);
  });
});

describe("D608 §6 — Bone Sniper: only a body with a Special Energy attached", () => {
  it("one such body (Benched) is forced: 70 there and nowhere else", () => {
    let state = table("me05-050", [[D, 1]], FILLER, [FILLER, FILLER]);
    state = attachBenchFromDeck(state, "p2", 1, "fix-blend", 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1); // a Basic on the Active does not qualify
    const result = mustApply(state, attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damageOf(result.state)).toEqual([0, 0, 70]);
  });

  it("none: the attack does nothing and asks nothing", () => {
    const result = mustApply(table("me05-050", [[D, 1]], FILLER, [FILLER]), attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(of(result.events, "DAMAGE_DEALT")).toEqual([]);
  });

  it("two: the park offers exactly them and names the narrowing", () => {
    let state = table("me05-050", [[D, 1]], FILLER, [FILLER, FILLER]);
    state = attachFromDeck(state, "p2", "fix-blend", 1);
    state = attachBenchFromDeck(state, "p2", 1, "fix-blend", 1);
    const parked = mustApply(state, attack(0)).state;
    const prompt = parkedMulti(parked);
    expect(prompt.candidates).toEqual([ACTIVE, bench(1)]);
    expect(prompt.note).toBe(
      "Choose 1 of your opponent's Pokémon that has any Special Energy attached (70 damage each).",
    );
    expect(damageOf(pick(parked, [ACTIVE]).state)).toEqual([70, 0, 0]);
  });
});

describe("D608 §7 — Stealthy Slash and Photon Bullets on a board", () => {
  // 🆕🆕🆕 D612 — `30th-021`'s face here is the RAW `<em>` text (a persisted pre-D612 pool face): it
  // plays through cards.ts `cardOfUid`'s normaliser on the reader's program, with no registry key.
  for (const id of ["mep-099", "30th-021"]) {
    it(`${id}: 30 per counter on the CHOSEN body — the Active with Weakness, a Benched body flat`, () => {
      let state = table(id, [[W, 1]], TARGET_W, [FILLER]);
      state = setBenchDamage(setDamage(state, "p2", 30), "p2", 0, 20);
      const parked = mustApply(state, attack(0)).state;
      expect(parkedMulti(parked).note).toBe(
        "Choose 1 of your opponent's Pokémon (30 damage for each damage counter on it).",
      );
      expect(damageOf(pick(parked, [ACTIVE]).state)).toEqual([30 + 180, 20]);
      expect(damageOf(pick(parked, [bench(0)]).state)).toEqual([30, 20 + 60]);
    });
  }

  it("30th-064: 50 to each ex — the ex Active with Weakness, a Benched ex flat, a non-ex untouched; no park", () => {
    const result = mustApply(
      table("30th-064", [[P, 2]], TARGET_EX, [TARGET_EX, FILLER]),
      attack(0),
    );
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damageOf(result.state)).toEqual([100, 50, 0]);
  });

  it("30th-064: a non-ex Active is not hit", () => {
    const result = mustApply(table("30th-064", [[P, 2]], TARGET_W, [TARGET_EX]), attack(0));
    expect(damageOf(result.state)).toEqual([0, 50]);
  });
});
