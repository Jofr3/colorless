import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import {
  deriveAttackEffect,
  normaliseMeWording,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D592 — WP02: THE `me` READER WORDING DRIFT AND CORROSIVE LIQUID ──
//
// 11 printed attack texts / 18 `me` printings, all read by `deriveAttackEffect`. Ten are `me`
// phrasings of sentences the readers already build in their `sv` wording; `normaliseMeWording`
// (effects.ts) rewrites each to that wording before the anchors run. The eleventh is Corrosive
// Liquid (Mega Dragalge ex ×3), Megaton Blower's two sweeps on an attack. Every id and text measured
// on the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-08, `legal_standard = 1`; no
// id was referenced anywhere in the tree before this slice. No `me` row is a fixture, so the printed
// faces used on a board are carried HERE.

/** [the `me` sentence, its legal `me` printings, the `sv` wording it is read as]. */
const DRIFT: readonly (readonly [string, number, string])[] = [
  [
    // Mega Absol ex `me01-086` / `-161` / `-180` "Claw of Darkness"
    "Your opponent reveals their hand, and you discard a card you find there.",
    3,
    "Your opponent reveals their hand. Discard a card you find there.",
  ],
  [
    // Miraidon `mep-082` "Thunder"
    "This Pokémon does 30 damage to itself.",
    1,
    "This Pokémon also does 30 damage to itself.",
  ],
  [
    // Eternatus `me02-069` "Power Rush"
    "Flip a coin. If tails, during your next turn, this Pokémon can't use attacks.",
    1,
    "Flip a coin. If tails, during your next turn, this Pokémon can't attack.",
  ],
  [
    // Aipom `me02-078` "Astonish"
    "Choose a random card from your opponent's hand, and your opponent reveals that card and shuffles it into their deck.",
    1,
    "Choose a random card from your opponent's hand. Your opponent reveals that card and shuffles it into their deck.",
  ],
  [
    // Haunter `me03-049` "Haunt"
    "Place 3 damage counters on your opponent's Active Pokémon.",
    1,
    "Put 3 damage counters on your opponent's Active Pokémon.",
  ],
  [
    // Mega Dragalge ex `me04-065` / `-104` / `-118` "Pernicious Poison"
    "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, place 16 damage counters on that Pokémon instead of 1.",
    3,
    "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 16 damage counters on that Pokémon instead of 1.",
  ],
  [
    // Mega Slowbro ex `me05-031` "Shellnado Spin"
    "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), place 12 damage counters on the Attacking Pokémon.",
    1,
    "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 12 damage counters on the Attacking Pokémon.",
  ],
  [
    // Annihilape `me05-041` "Ghostly Blow"
    "Place 5 damage counters on 1 of your opponent's Benched Pokémon.",
    1,
    "Put 5 damage counters on 1 of your opponent's Benched Pokémon.",
  ],
  [
    // Gengar ex `30th-090` / `-154` "Chaotic Pain"
    "Place 13 damage counters on 1 of your opponent's Pokémon.",
    2,
    "Put 13 damage counters on 1 of your opponent's Pokémon.",
  ],
  [
    // Hisuian Zoroark `30th-123` "Swirling Resentment"
    "Place damage counters on your opponent's Active Pokémon until its remaining HP is 50.",
    1,
    "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.",
  ],
];

const CORROSIVE_LIQUID =
  "Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon.";

/** Every splitter fragment of a sentence, the sentence first. */
function fragments(text: string): string[] {
  const out = [text];
  const gate = splitAttackGateClause(text);
  if (gate !== null && gate.body !== "") out.push(gate.body);
  const trailing = splitAttackTrailingClause(text);
  if (trailing !== null) out.push(trailing.head, trailing.tail);
  return out;
}

describe("D592 §1 — the synonym table: each `me` sentence reads as its `sv` wording", () => {
  it("the ten sentences are the `me` corpus's rows at 15 printings, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of DRIFT) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(DRIFT.reduce((sum, [, n]) => sum + n, 0)).toBe(15);
  });

  it("each rewrites to exactly its `sv` wording and derives that wording's program", () => {
    for (const [text, , wording] of DRIFT) {
      expect(normaliseMeWording(text)).toBe(wording);
      const program = deriveAttackEffect(wording);
      expect(program, wording).not.toBeNull();
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("the programs, spelled out", () => {
    const programs = DRIFT.map(([text]) => deriveAttackEffect(text));
    expect(programs).toEqual([
      [{ op: "bottomFromOpponentHand", dest: "discard" }],
      [{ op: "damageSelf", amount: 30 }],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      [{ op: "coinFlipGate", onTails: true, then: [{ op: "preventAttack" }] }],
      [{ op: "randomFromOpponentHand", to: "deck" }],
      [{ op: "damageActive", amount: 30, source: "attack" }],
      [{ op: "applyStatus", target: "defender", status: "poisoned", poisonDamage: 160 }],
      [{ op: "installRecoil", amount: 120 }],
      [{ op: "damageChosen", target: "opponentBench", amount: 50, count: 1, source: "attack" }],
      [{ op: "damageChosen", target: "opponentAny", amount: 130, count: 1, source: "attack" }],
      [{ op: "counterUntilRemainingHp", target: "opponentActive", remainingHp: 50, source: "attack" }],
    ]);
  });

  it("the typographic apostrophe reads the same on the two rows whose anchor spells one", () => {
    for (const text of [DRIFT[2]?.[0], DRIFT[3]?.[0]] as string[]) {
      expect(deriveAttackEffect(text.replace("'", "’")), text).toEqual(deriveAttackEffect(text));
    }
  });
});

describe("D592 §2 — the table cannot reach an `sv` sentence", () => {
  it("it is the identity on every legal `sv` sentence and on every splitter fragment of one", () => {
    let checked = 0;
    for (const [, text] of legalAttackCorpus()) {
      for (const fragment of fragments(text)) {
        expect(normaliseMeWording(fragment), fragment).toBe(fragment);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(640);
  });

  it("over the `me` corpus it rewrites the ten sentences above and five that stay unbuilt", () => {
    const changed = meAttackCorpus()
      .map(([, text]) => text)
      .filter((text) => normaliseMeWording(text) !== text);
    const drift = new Set(DRIFT.map(([text]) => text));
    const unbuilt = changed.filter((text) => !drift.has(text));
    expect(changed.filter((text) => drift.has(text))).toHaveLength(10);
    // Each still needs vocabulary beyond a synonym (a hand-count source, a gate, a trigger, …).
    // 🆕🆕🆕 D609 (D539): ~~5~~ 7 — WP36 widened the lookahead to the singular "damage counter on", so the
    // table also rewrites Sneaky Placement (built, `COUNTER_PUT_ON_OPPONENT_ANY`) and the Active singular
    // (still unbuilt, the §3 control). 🆕🆕🆕 D627 (D539): WITHDRAWN, kept as written — the Active singular is
    // Furtive Drop `me05-005`, BUILT at D627 (H1); the §3 control is re-pointed to "Place 2 damage counter…".
    expect(unbuilt).toHaveLength(7);
    // 🆕🆕🆕 D600 (D539): "five that stay unbuilt" is WITHDRAWN, kept as written — four: Powerful Hand
    // ×3 is built by WP14's hand-count source (`damageActive.per`), the vocabulary named above.
    const powerfulHand = "Place 2 damage counters on your opponent's Active Pokémon for each card in your hand.";
    expect(unbuilt).toContain(powerfulHand);
    expect(deriveAttackEffect(powerfulHand)).not.toBeNull();
    // 🆕🆕🆕 D608 (D539): and three — Phantasmal Barrage is built by WP30's literal compound
    // (`SELF_DISCARD_ALL_THEN_COUNTERS`, read after this table rewrote its "place").
    const barrage = "Discard all Energy from this Pokémon and place 12 damage counters on 1 of your opponent's Pokémon.";
    expect(unbuilt).toContain(barrage);
    expect(deriveAttackEffect(barrage)).not.toBeNull();
    const sneaky = "Place 1 damage counter on 1 of your opponent's Pokémon.";
    expect(unbuilt).toContain(sneaky);
    expect(deriveAttackEffect(sneaky)).not.toBeNull();
    // 🆕🆕🆕 D627 (D539): and two more — Furtive Drop (the Active singular, `COUNTER_PUT_ON_DEFENDER` at 1) and
    // Matcha Spin (arm 6e-septies, read after this table rewrote its lower-case "place") are built by H1.
    const furtive = "Place 1 damage counter on your opponent's Active Pokémon.";
    const matcha =
      "If you have 6 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, place 4 damage counters on each of your opponent's Pokémon.";
    for (const text of [furtive, matcha]) {
      expect(unbuilt).toContain(text);
      expect(deriveAttackEffect(text), text).not.toBeNull();
    }
    // 🆕🆕🆕 D629 (D539): and one more — Mismagius "Assassin's Magic" (`CLAUSE_GATED_BENCH_COUNTERS`, read
    // after this table rewrote its lower-case "place") is built by S1.
    const assassin =
      "If your opponent's Active Pokémon is affected by a Special Condition, place 6 damage counters on 1 of your opponent's Benched Pokémon.";
    expect(unbuilt).toContain(assassin);
    expect(deriveAttackEffect(assassin)).not.toBeNull();
    // 🆕🆕🆕 D636 (D539): and one more — Pachirisu "Electrified Incisors" (`HAND_ATTACH_COUNTERS`, read after this
    // table rewrote its lower-case "place") is built by L1. The rewritten sentences that stay unbuilt: none.
    const incisors =
      "During your opponent's next turn, whenever they attach an Energy card from their hand to the Defending Pokémon, place 8 damage counters on that Pokémon.";
    expect(unbuilt).toContain(incisors);
    expect(deriveAttackEffect(incisors)).not.toBeNull();
    const built = [powerfulHand, barrage, sneaky, furtive, matcha, assassin, incisors];
    expect(unbuilt.filter((t) => !built.includes(t))).toHaveLength(0);
    for (const text of unbuilt.filter((t) => !built.includes(t))) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

describe("D592 §3 — near misses stay null, one token apart each", () => {
  it("every control is unbuilt", () => {
    const controls: Record<string, string> = {
      // 🆕🆕🆕 D609 (D539): the table now rewrites this singular "place" too (WP36); it stays null because no
      // anchor reads a 1-counter put on the Active.
      // 🆕🆕🆕 D627 (D539): WITHDRAWN, kept as written — the printed singular is BUILT (Poltchageist "Furtive
      // Drop", H1). The control is re-pointed onto its number-agreement near miss, which stays null.
      "a singular counter (no 'counters')": "Place 2 damage counter on your opponent's Active Pokémon.",
      // 🆕🆕🆕 D600 (D539): the printed Powerful Hand is BUILT (WP14) — this control is its seat near miss.
      "Powerful Hand over THEIR hand (the printed row is built, WP14)":
        "Place 2 damage counters on your opponent's Active Pokémon for each card in their hand.",
      "the comma-join on another head": "Look at your opponent's hand, and you discard a card you find there.",
      "the comma-join with another count": "Your opponent reveals their hand, and you discard 2 cards you find there.",
      "Astonish's comma-join to another zone":
        "Choose a random card from your opponent's hand, and your opponent reveals that card and puts it on the bottom of their deck.",
      "the 'also'-less recoil with a suffix": "This Pokémon does 30 damage to itself. Draw a card.",
      "the 'also'-less recoil with a scaling rider": "This Pokémon does 30 damage to itself for each damage counter on it.",
      "the heads lock": "Flip a coin. If heads, during your next turn, this Pokémon can't use attacks.",
      "Corrosive Liquid on the Active only":
        "Discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon.",
      "Corrosive Liquid without the Special Energy": "Discard all Pokémon Tools from all of your opponent's Pokémon.",
      "Corrosive Liquid with a prefix": `Draw a card. ${CORROSIVE_LIQUID}`,
      "Corrosive Liquid with a suffix": `${CORROSIVE_LIQUID} Draw a card.`,
    };
    for (const [why, text] of Object.entries(controls)) expect(deriveAttackEffect(text), why).toBeNull();
  });

  it("the shipped `sv` sentences the rows sit beside keep their programs", () => {
    expect(deriveAttackEffect("During your next turn, this Pokémon can't use attacks.")).toEqual([
      { op: "preventAttack" },
    ]);
    expect(
      deriveAttackEffect(
        "This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out.",
      ),
    ).not.toBeNull();
  });
});

describe("D592 §4 — Corrosive Liquid: Megaton Blower's two sweeps on an attack", () => {
  it("the sentence is the `me` corpus's row at 3 printings and is not printed in `sv`", () => {
    expect(new Map(meAttackCorpus().map(([n, text]) => [text, n])).get(CORROSIVE_LIQUID)).toBe(3);
    expect(legalAttackCorpus().some(([, text]) => text === CORROSIVE_LIQUID)).toBe(false);
  });

  it("it derives, in printed order, to the first two ops of Megaton Blower's program", () => {
    const program = [
      { op: "discardTools", count: "all" },
      { op: "discardEnergy", from: "opponentEach", filter: { kind: "specialEnergy" }, count: "all" },
    ];
    expect(deriveAttackEffect(CORROSIVE_LIQUID)).toEqual(program);
    expect(programFor("sv08-182")?.trainer?.slice(0, 2)).toEqual(program);
    expect(deriveAttackEffect(CORROSIVE_LIQUID.replace("'", "’"))).toEqual(program);
  });

  it("no printing of this slice is registry-keyed (🆕🆕🆕 D598 (D539): WITHDRAWN for Annihilape `me05-041` — keyed for its Ability \"Durable Body\"; its attack is still the reader's; 🆕🆕🆕 D626 (D539): and for Miraidon `mep-082` and Gengar ex `30th-090` / `-154` — keyed for their Abilities \"Photon Cord\" / \"Fainting Spell\"; their attacks are still the reader's)", () => {
    for (const id of ["me04-065", "me04-104", "me04-118", "me01-086", "me02-069", "me02-078", "me03-049", "me05-031", "30th-123"]) {
      expect(programFor(id), id).toBeUndefined();
    }
    expect(Object.keys(programFor("me05-041") ?? {})).toEqual(["passive"]);
    // 🆕🆕🆕 D626 — an Ability key only: no `attack` key, so "Thunder" / "Chaotic Pain" still derive.
    expect(Object.keys(programFor("mep-082") ?? {})).toEqual(["triggered"]);
    for (const id of ["30th-090", "30th-154"]) expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
  });
});

// ── ON A BOARD ──

const MEGA_DRAGALGE = "me04-065";
const MEGA_ABSOL = "me01-086";
const MIRAIDON = "mep-082";
const FILLER = "d592-filler"; // a {C} Basic, 300 HP
const DARK = "d592-darkness";
const LIGHTNING = "d592-lightning";
const TOOL = "fix-tool";
const SPECIAL = "fix-special";

const LOCAL: Record<string, Card> = {
  [MEGA_DRAGALGE]: battler(MEGA_DRAGALGE, {
    name: "Mega Dragalge ex",
    stage: "Stage1",
    evolveFrom: "Skrelp",
    hp: 330,
    types: ["Dragon"],
    retreat: 2,
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Corrosive Liquid", effect: CORROSIVE_LIQUID },
      { cost: ["Water", "Darkness"], name: "Pernicious Poison", effect: DRIFT[5]?.[0] as string },
    ],
  } as Partial<Card>),
  [MEGA_ABSOL]: battler(MEGA_ABSOL, {
    name: "Mega Absol ex",
    hp: 280,
    types: ["Darkness"],
    retreat: 2,
    attacks: [
      {
        cost: ["Darkness", "Colorless"],
        name: "Terminal Period",
        effect: "If your opponent's Active Pokémon has exactly 6 damage counters on it, that Pokémon is Knocked Out.",
      },
      {
        cost: ["Darkness", "Darkness", "Colorless"],
        name: "Claw of Darkness",
        damage: 200,
        effect: DRIFT[0]?.[0] as string,
      },
    ],
  } as Partial<Card>),
  [MIRAIDON]: battler(MIRAIDON, {
    name: "Miraidon",
    hp: 120,
    types: ["Lightning"],
    retreat: 1,
    attacks: [
      { cost: ["Lightning", "Lightning"], name: "Thunder", damage: 90, effect: DRIFT[1]?.[0] as string },
    ],
  } as Partial<Card>),
  [FILLER]: battler(FILLER, { name: "D592 Filler", hp: 300, types: ["Colorless"], retreat: 1 }),
  [DARK]: typedEnergy(DARK, "Darkness"),
  [LIGHTNING]: typedEnergy(LIGHTNING, "Lightning"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [MEGA_DRAGALGE]: 1,
  [MEGA_ABSOL]: 1,
  [MIRAIDON]: 1,
  [FILLER]: 20,
  [DARK]: 4,
  [LIGHTNING]: 4,
  [TOOL]: 6,
  [SPECIAL]: 6,
  "fix-energy": 17,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup (P2 first), then P1's turn 4 with both hands back in the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 5921, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    // Every Prize is swapped for a Filler or a Colorless Energy, so each named card is findable.
    let deck = [...side.deck, ...side.hand];
    const prizes = side.prizes.map((u) => {
      if ([FILLER, "fix-energy"].includes(state.cardIdByUid[u] as string)) return u;
      const swap = deck.find((d) => [FILLER, "fix-energy"].includes(state.cardIdByUid[d] as string));
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** P1 attacks with `active`; P2 has a FILLER Active and `oppBench` Fillers. */
function table(active: string, oppBench = 0): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", active), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  for (let i = 0; i < oppBench; i++) state = benchFromDeck(state, "p2", FILLER);
  return state;
}

/** Move `ids` from P2's deck into P2's hand. */
function p2Hand(state: GameState, ids: readonly string[]): GameState {
  const side = state.players.p2;
  let deck = [...side.deck];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`p2 deck has no ${id}`);
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, p2: { ...side, hand, deck } } };
}

const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

describe("D592 §5 — Corrosive Liquid on a board: every Tool and Special Energy on the opponent's side", () => {
  it("strips the Active and every Benched Pokémon of Tools and Special Energy; Basic Energy and the attacker's own Tool stay", () => {
    let state = table(MEGA_DRAGALGE, 2);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    state = attachToolFromDeck(state, "p1", "active", TOOL);
    state = attachToolFromDeck(state, "p2", "active", TOOL);
    state = attachFromDeck(state, "p2", SPECIAL, 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachToolFromDeck(state, "p2", 0, TOOL);
    state = attachBenchFromDeck(state, "p2", 0, SPECIAL, 2);
    state = attachBenchFromDeck(state, "p2", 1, "fix-energy", 1);
    const { state: after } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const p2 = after.players.p2;
    expect(p2.active?.tools).toEqual([]);
    expect(idsOf(after, p2.active?.energy ?? [])).toEqual(["fix-energy"]);
    expect(p2.bench[0]?.tools).toEqual([]);
    expect(p2.bench[0]?.energy).toEqual([]);
    expect(idsOf(after, p2.bench[1]?.energy ?? [])).toEqual(["fix-energy"]);
    // Two Tools and three Special Energy went to their owner's discard pile; none to the attacker's.
    expect(idsOf(after, p2.discard).sort()).toEqual([SPECIAL, SPECIAL, SPECIAL, TOOL, TOOL]);
    expect(after.players.p1.active?.tools).toHaveLength(1);
    expect(after.players.p1.discard).toEqual([]);
    // Nothing asked: the attack resolved and the turn passed.
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(after.turn).toBe(state.turn + 1);
  });

  it("an opponent wearing neither is a silent no-op", () => {
    let state = table(MEGA_DRAGALGE, 1);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: after } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(after.players.p2.discard).toEqual([]);
    expect(after.players.p2.active?.energy).toHaveLength(1);
    expect(after.turn).toBe(state.turn + 1);
  });
});

describe("D592 §6 — Claw of Darkness and Thunder on a board", () => {
  it("Claw of Darkness: 200 damage, then the attacker picks a card in the revealed hand and it is discarded", () => {
    let state = table(MEGA_ABSOL);
    state = attachFromDeck(state, "p1", DARK, 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = p2Hand(state, [FILLER, TOOL]);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(of(parked.events, "DAMAGE_DEALT")[0]?.dealt).toBe(200);
    const phase = parked.state.phase;
    if (phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${phase.kind}`);
    expect(phase.prompt).toMatchObject({ kind: "chooseCards" });
    const tool = parked.state.players.p2.hand.find((u) => parked.state.cardIdByUid[u] === TOOL) as string;
    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [tool] },
    } as GameAction);
    // (P2 then draws for its turn, so the hand is asserted by membership.)
    expect(done.state.players.p2.hand).not.toContain(tool);
    expect(idsOf(done.state, done.state.players.p2.hand)).toContain(FILLER);
    expect(done.state.players.p2.discard).toEqual([tool]);
  });

  it("Thunder: 90 to the Defending Pokémon and 30 to Miraidon itself", () => {
    let state = table(MIRAIDON);
    state = attachFromDeck(state, "p1", LIGHTNING, 2);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(of(events, "DAMAGE_DEALT")[0]?.dealt).toBe(90);
    expect(after.players.p2.active?.damage).toBe(90);
    expect(after.players.p1.active?.damage).toBe(30);
  });
});

describe("D592 §7 — the version", () => {
  it("is built at engine 0.546.0", () => {
    expect(engineVersion).toBe("0.546.0");
  });
});
