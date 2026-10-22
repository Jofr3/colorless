import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { attackMenuOf } from "./continuous";
import { COPY_FAMILY_MARKER, deriveAttackCopy, deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, deckOf, trainerCard, typedEnergy } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

// ── 🆕🆕🆕 D638 — X1: COPY / BORROWED EFFECTS, 3 TEXTS / 6 PRINTINGS ─────────────────────────────────────────
//
// The D625 re-rank's X1 group, every id and text off the LOCAL D1 (2026-10-10, `legal_standard = 1`):
//
//   Mew ex `30th-066` / `-152` / `-158` "Memory Helix" (Ability) — the NEW `PassiveEffects.memoryHelix`, a fourth
//     `attackMenuOf` section (D578's borrowed-row seam): the printed attacks of each of your Benched Pokémon.
//   Thievul `me05-054` / `-092` "Skill Thief" — `deriveAttackCopy`'s NEW `InPlayAttackCopy` (D573's declaration-time
//     seam over the opponent's Active AND Bench, behind an empty hand), parked as the NEW `useInPlayAttackAs`.
//   Ninetales `me01-020` "Supernatural Shapeshifter" — the NEW field-free `useMilledSupporterEffect` (D580's
//     Look-Alike Show filter over the one card the attack discards).
//
// Rulings (decisions.md D638), each ⚠️ UNRULED:
//   R-MH1 — a Memory Helix row is a Benched Pokémon's PRINTED attack (its top card's); its own Memory Dive / Tool
//           rows are not offered. Reversal: read the benched body's whole `attackMenuOf`.
//   R-MH2 — a copy-family attack (`COPY_FAMILY_MARKER`) is not a Memory Helix row, so every copy park keeps a
//           PRINTED copier index (`resolveCopiedAttack` reads `attacksOf(copier)[index]`). Reversal: read the
//           copier's attack through the menu at the three resume sites — and pay an MRV bump, because a 0.520
//           rollback reads a parked menu index past the printed ones as PHASE_DESYNC.
//   R-SKT1 — Skill Thief reads the hand at DECLARATION, before the choice and every coin (R-CP8's moment); any
//           card in hand is the EMPTY override (declared, nothing resolves). R-CP1 … R-CP4 carry: the copier's
//           cost only, the copier does the attack, no copy-family candidate, a copied gate binds the copier.
//   R-NS1 — Supernatural Shapeshifter: the card is in the discard pile when its effect runs; a Supporter whose
//           printed play condition fails for the attacker (R-LA2 / R-LA2a, carried) does nothing.

const MEW = "30th-066";
const MEW_ALT = "30th-152";
const MEW_ALT2 = "30th-158";
const THIEVUL = "me05-054";
const THIEVUL_ALT = "me05-092";
const NINETALES = "me01-020";
const KLEFKI = "sv01-096";
const CHEREN = "sv10.5w-081";
const CASSIOPEIA = "sv06.5-056";
const PLAIN = "d638-plain";
const HITTER = "d638-hitter";
const GATED = "d638-gated";
const FILLER = "d638-filler";
const ITEM = "d638-item";
const R = "d638-fire";
const P = "d638-psychic";

const MEMORY_HELIX =
  "This Pokémon can use the attacks of any of your Benched Pokémon. (You still need the necessary Energy to use each attack.)";
const TELEPORTATION_BURST = "You may switch this Pokémon with 1 of your Benched Pokémon.";
const SKILL_THIEF =
  "If you have no cards in your hand, choose an attack from 1 of your opponent's Pokémon in play and use it as this attack.";
const SHAPESHIFTER =
  "Discard the top card of your deck, and if that card is a Supporter card, use the effect of that card as the effect of this attack.";
const FIRST_TURN_GATE = "If you go second, you can't use this attack during your first turn.";

const mew = (id: string): Card =>
  battler(id, {
    name: "Mew ex",
    hp: 160,
    types: ["Psychic"],
    retreat: 0,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    abilities: [{ type: "Ability", name: "Memory Helix", effect: MEMORY_HELIX }],
    attacks: [{ cost: ["Psychic"], name: "Teleportation Burst", effect: TELEPORTATION_BURST, damage: 30 }],
  });
const thievul = (id: string): Card =>
  battler(id, {
    name: "Thievul",
    hp: 100,
    stage: "Stage1",
    evolveFrom: "Nickit",
    types: ["Darkness"],
    retreat: 1,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Skill Thief", effect: SKILL_THIEF },
      { cost: ["Darkness", "Colorless", "Colorless"], name: "Sharp Fang", damage: 80 },
    ],
  });
const body = (id: string, name: string, attacks: Card["attacks"]): Card =>
  battler(id, { name, hp: 900, types: ["Colorless"], retreat: 1, attacks });

const LOCAL: Record<string, Card> = {
  [MEW]: mew(MEW),
  [MEW_ALT]: mew(MEW_ALT),
  [MEW_ALT2]: mew(MEW_ALT2),
  [THIEVUL]: thievul(THIEVUL),
  [THIEVUL_ALT]: thievul(THIEVUL_ALT),
  [NINETALES]: battler(NINETALES, {
    name: "Ninetales",
    hp: 120,
    stage: "Stage1",
    evolveFrom: "Vulpix",
    types: ["Fire"],
    retreat: 1,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Supernatural Shapeshifter", effect: SHAPESHIFTER },
      { cost: ["Fire", "Colorless"], name: "Combustion", damage: 60 },
    ],
  }),
  [KLEFKI]: battler(KLEFKI, {
    name: "Klefki",
    hp: 900,
    types: ["Psychic"],
    abilities: [
      {
        type: "Ability",
        name: "Mischievous Lock",
        effect:
          "As long as this Pokémon is in the Active Spot, Basic Pokémon in play (both yours and your opponent's) have no Abilities, except for Mischievous Lock.",
      },
    ],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [CHEREN]: { ...trainerCard(CHEREN, "Supporter", "Draw 3 cards."), name: "Cheren" },
  [CASSIOPEIA]: { ...trainerCard(CASSIOPEIA, "Supporter", "(Cassiopeia)"), name: "Cassiopeia" },
  [PLAIN]: body(PLAIN, "D638 Plain", [{ cost: [], name: "Tap", damage: 10 }]),
  [HITTER]: body(HITTER, "D638 Hitter", [{ cost: ["Fire"], name: "Big Hit", damage: 60 }]),
  [GATED]: body(GATED, "D638 Gated", [{ cost: [], name: "Opening Shot", damage: 50, effect: FIRST_TURN_GATE }]),
  [FILLER]: body(FILLER, "D638 Filler", [{ cost: [], name: "Tap", damage: 10 }]),
  [ITEM]: { ...trainerCard(ITEM, "Item", "(constructed)"), name: "D638 Item" },
  [R]: typedEnergy(R, "Fire"),
  [P]: typedEnergy(P, "Psychic"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({ [PLAIN]: 6, [FILLER]: 34, "fix-energy": 20 });

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

/** Setup, then P1's turn 2 (P2 went first and passed). */
function opened(): GameState {
  const created = createGame({ seed: 6381, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function withSide(state: GameState, seat: Seat, patch: Partial<GameState["players"]["p1"]>): GameState {
  return { ...state, players: { ...state.players, [seat]: { ...state.players[seat], ...patch } } };
}

let minted = 0;
/** TEST SURGERY — a fresh uid for `id`, its card added to the game's pool. */
function mint(state: GameState, id: string): { state: GameState; uid: string } {
  minted += 1;
  const uid = `d638-${minted}`;
  const card = POOL[id];
  if (card === undefined) throw new Error(`no ${id} in POOL`);
  return { uid, state: { ...state, cardIdByUid: { ...state.cardIdByUid, [uid]: id }, cardPool: { ...state.cardPool, [id]: card } } };
}

interface Spot {
  id: string;
  energy?: readonly string[];
}

/** p1's turn 2, both boards and hands built by surgery (the setup's own cards emptied into the decks first);
    `p1Top` is put on top of p1's deck. */
function table(opts: {
  p1: Spot;
  p1Bench?: readonly Spot[];
  p1Hand?: readonly string[];
  p1Top?: string;
  p2: Spot;
  p2Bench?: readonly Spot[];
}): GameState {
  let state = opened();
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy]),
    ];
    state = withSide(state, seat, { hand: [], active: null, bench: [], deck: [...side.deck, ...back] });
  }
  const fresh = (id: string): string => {
    const m = mint(state, id);
    state = m.state;
    return m.uid;
  };
  const build = (spot: Spot): InPlayPokemon => ({ ...makeInPlay(fresh(spot.id), 0), energy: (spot.energy ?? []).map(fresh) });
  for (const seat of ["p1", "p2"] as const) {
    const active = build(seat === "p1" ? opts.p1 : opts.p2);
    const bench = (seat === "p1" ? (opts.p1Bench ?? []) : (opts.p2Bench ?? [])).map(build);
    const hand = (seat === "p1" ? (opts.p1Hand ?? []) : []).map(fresh);
    state = withSide(state, seat, { active, bench, hand });
  }
  if (opts.p1Top !== undefined) {
    const top = fresh(opts.p1Top);
    state = withSide(state, "p1", { deck: [top, ...state.players.p1.deck] });
  }
  return state;
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const pick = (index: number): GameAction => ({ type: "resolveEffect", seat: "p1", choice: { kind: "attack", index } });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const defenderDamage = (state: GameState) => state.players.p2.active?.damage ?? -1;
const turnPassed = (state: GameState) => state.phase.kind === "turn:action" && state.phase.seat === "p2";
const menuNames = (state: GameState) => {
  const active = state.players.p1.active;
  return active === null ? [] : attackMenuOf(state, "p1", active).map((e) => [e.attack.name, e.origin]);
};

function render(events: GameEvent[], state: GameState): string[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [`${entry.who}: ${entry.segments.map((x) => x.text).join("")}`],
  );
}

describe("D638 §1 — the texts and the keys", () => {
  it("the two attack sentences are `me` corpus rows (2 + 1 printings), no legal `sv` row, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of [
      [SKILL_THIEF, 2],
      [SHAPESHIFTER, 1],
    ] as const) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
    // The other attacks the six printings print: Teleportation Burst is reader-built, the rest are damage only.
    expect(resolvedByAnyReader(TELEPORTATION_BURST)).toBe(true);
  });

  it("Mew ex ×3 is keyed `passive: { memoryHelix }` alone; Thievul ×2 and Ninetales stay unkeyed (readers)", () => {
    for (const id of [MEW, MEW_ALT, MEW_ALT2]) expect(programFor(id), id).toEqual({ passive: { memoryHelix: true } });
    for (const id of [THIEVUL, THIEVUL_ALT, NINETALES]) expect(programFor(id), id).toBeUndefined();
  });

  it("no new anchor claims a legal `sv` sentence: no `sv` row opens like either", () => {
    const opening = /^If you have no cards in your hand, choose an attack|^Discard the top card of your deck, and if that card is a Supporter/;
    expect(legalAttackCorpus().filter(([, text]) => opening.test(text))).toEqual([]);
  });
});

describe("D638 §2 — the readings", () => {
  it("Skill Thief: the NEW in-play kind; its wording variants stay loud", () => {
    expect(deriveAttackCopy(SKILL_THIEF)).toEqual({ from: "opponentInPlay", ifEmptyHand: true });
    expect(deriveAttackCopy(SKILL_THIEF.replace("’", "'"))).toEqual({ from: "opponentInPlay", ifEmptyHand: true });
    expect(deriveAttackCopy(SKILL_THIEF.replace("no cards", "1 card"))).toBeNull();
    expect(deriveAttackCopy(SKILL_THIEF.replace(" in play", " on the Bench"))).toBeNull();
    expect(deriveAttackEffect(SKILL_THIEF)).toBeNull();
    expect(COPY_FAMILY_MARKER.test(SKILL_THIEF)).toBe(true);
  });

  it("Supernatural Shapeshifter: the one field-free op; a Pokémon variant (Seek Inspiration's noun) is not this reader's", () => {
    const op: EffectOp = { op: "useMilledSupporterEffect" };
    expect(deriveAttackEffect(SHAPESHIFTER)).toEqual([op]);
    expect(deriveAttackEffect(SHAPESHIFTER.replace("a Supporter card", "an Item card"))).toBeNull();
    expect(deriveAttackCopy(SHAPESHIFTER)).toBeNull();
  });
});

describe("D638 §3 — Memory Helix on a board (R-MH1 / R-MH2)", () => {
  const helixBoard = (energy: readonly string[], p2: Spot = { id: PLAIN }) =>
    table({
      p1: { id: MEW, energy },
      p1Bench: [{ id: HITTER }, { id: THIEVUL }, { id: MEW_ALT }],
      p1Hand: [ITEM],
      p2,
    });

  it("the menu: Mew ex's printed attack, then each Benched Pokémon's printed attacks — Skill Thief excluded (R-MH2)", () => {
    expect(menuNames(helixBoard([P]))).toEqual([
      ["Teleportation Burst", "printed"],
      ["Big Hit", "memoryHelix"],
      ["Sharp Fang", "memoryHelix"],
      ["Teleportation Burst", "memoryHelix"],
    ]);
  });

  it("the wire offers the same rows; the borrowed cost is charged (Big Hit unpayable on {P})", () => {
    const view = redactGame(helixBoard([P]), "p1");
    if (view.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(view.phase.attacks.map((a) => [a.index, a.name, a.playable])).toEqual([
      [0, "Teleportation Burst", true],
      [1, "Big Hit", false],
      [2, "Sharp Fang", false],
      [3, "Teleportation Burst", true],
    ]);
    const refused = applyAction(helixBoard([P]), attack(1));
    expect(refused.ok ? null : refused.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("with {R} attached, Big Hit is declared by Mew ex: 60 to the Defending Pokémon, the row's own name, the turn ends", () => {
    const done = run(helixBoard([P, R]), attack(1));
    expect(of(done.events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Big Hit", index: 1 });
    expect(defenderDamage(done.state)).toBe(60);
    expect(turnPassed(done.state)).toBe(true);
  });

  it("the licence is the holder's: a Benched Mew ex gives the Active nothing", () => {
    const state = table({ p1: { id: HITTER, energy: [R] }, p1Bench: [{ id: MEW }, { id: PLAIN }], p2: { id: PLAIN } });
    expect(menuNames(state)).toEqual([["Big Hit", "printed"]]);
  });

  it("§9: an opponent's Active Klefki silences the Ability — the printed attack only", () => {
    expect(menuNames(helixBoard([P], { id: KLEFKI }))).toEqual([["Teleportation Burst", "printed"]]);
  });

  it("an empty Bench offers nothing borrowed", () => {
    expect(menuNames(table({ p1: { id: MEW, energy: [P] }, p2: { id: PLAIN } }))).toEqual([["Teleportation Burst", "printed"]]);
  });
});

describe("D638 §4 — Skill Thief on a board (R-SKT1)", () => {
  const thiefBoard = (hand: readonly string[] = [], p2Bench: readonly Spot[] = [{ id: HITTER }, { id: THIEVUL_ALT }]) =>
    table({ p1: { id: THIEVUL, energy: ["fix-energy", "fix-energy"] }, p1Hand: hand, p2: { id: PLAIN }, p2Bench });

  it("an empty hand: ONE prompt over every eligible (Pokémon, attack) pair in play, Active first; Skill Thief itself is not offered", () => {
    const parked = run(thiefBoard(), attack(0)).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the park");
    expect(parked.phase.prompt).toEqual({
      kind: "chooseAttack",
      candidates: [
        { index: 0, name: "Tap (D638 Plain)" },
        { index: 1, name: "Big Hit (D638 Hitter)" },
        { index: 2, name: "Sharp Fang (Thievul)" },
      ],
      note: "Choose an attack to use as Skill Thief.",
    });
    expect(parked.phase.cont.pendingOp).toMatchObject({ op: "useInPlayAttackAs", index: 0 });
  });

  it("picking a BENCHED attack: the copier does it (60, its cost ignored — R-CP1), stamped `as`", () => {
    const parked = run(thiefBoard(), attack(0)).state;
    const done = run(parked, pick(1));
    expect(of(done.events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Skill Thief", as: "Big Hit" });
    expect(defenderDamage(done.state)).toBe(60);
    expect(turnPassed(done.state)).toBe(true);
  });

  it("a card in hand: declared, nothing resolves, no prompt (R-SKT1)", () => {
    const done = run(thiefBoard([ITEM]), attack(0));
    expect(of(done.events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(defenderDamage(done.state)).toBe(0);
    expect(turnPassed(done.state)).toBe(true);
  });

  it("one eligible pair is forced, no prompt; a copied timing gate binds the copier (R-CP4)", () => {
    const forced = run(thiefBoard([], []), attack(0));
    expect(of(forced.events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Tap" });
    expect(defenderDamage(forced.state)).toBe(10);
    // p1 went second and this is p1's first turn: Opening Shot is barred for the copier, so Tap is forced.
    const gated = run(thiefBoard([], [{ id: GATED }]), attack(0));
    expect(of(gated.events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Tap" });
  });

  it("an answer past the list is refused; a stale copier is PHASE_DESYNC", () => {
    const parked = run(thiefBoard(), attack(0)).state;
    const bad = applyAction(parked, pick(7));
    expect(bad.ok ? null : bad.error.code).toBe("BAD_EFFECT_CHOICE");
    const swapped = withSide(parked, "p1", { active: { ...makeInPlay("d638-stale", 0) } });
    const stale = applyAction({ ...swapped, cardIdByUid: { ...swapped.cardIdByUid, "d638-stale": THIEVUL } }, pick(0));
    expect(stale.ok ? null : stale.error.code).toBe("PHASE_DESYNC");
  });

  it("Mew ex never borrows Skill Thief (R-MH2), so no copy park is made at a non-printed index", () => {
    const state = table({ p1: { id: MEW, energy: [P] }, p1Bench: [{ id: THIEVUL }], p2: { id: PLAIN } });
    expect(menuNames(state)).toEqual([
      ["Teleportation Burst", "printed"],
      ["Sharp Fang", "memoryHelix"],
    ]);
  });
});

describe("D638 §5 — Supernatural Shapeshifter on a board (R-NS1)", () => {
  const foxBoard = (top: string | undefined, hand: readonly string[] = [ITEM]) =>
    table({
      p1: { id: NINETALES, energy: ["fix-energy"] },
      p1Hand: hand,
      ...(top === undefined ? {} : { p1Top: top }),
      p2: { id: PLAIN },
    });

  it("a Supporter on top: discarded, then its effect is the attack's (Cheren: p1 draws 3); the event and the log row", () => {
    const state = foxBoard(CHEREN);
    const top = state.players.p1.deck[0] ?? "";
    const done = run(state, attack(0));
    expect(of(done.events, "DECK_TOP_DISCARDED")).toEqual([{ type: "DECK_TOP_DISCARDED", seat: "p1", actor: "p1", uids: [top] }]);
    expect(done.events).toContainEqual({ type: "SUPPORTER_EFFECT_USED", seat: "p1", uid: top, milled: true });
    expect(of(done.events, "CARDS_DRAWN").filter((d) => d.seat === "p1").reduce((n, d) => n + d.uids.length, 0)).toBe(3);
    expect(done.state.players.p1.hand).toHaveLength(4);
    expect(done.state.players.p1.discard).toContain(top);
    expect(of(done.events, "TRAINER_PLAYED")).toEqual([]);
    expect(done.state.allowances.supporterPlayed).toBe(false);
    expect(render(done.events, done.state)).toContain("p1: Ninetales's Supernatural Shapeshifter used the effect of Cheren");
    expect(turnPassed(done.state)).toBe(true);
  });

  it("anything else on top: discarded, nothing else", () => {
    const done = run(foxBoard(PLAIN), attack(0));
    expect(of(done.events, "DECK_TOP_DISCARDED")).toHaveLength(1);
    expect(of(done.events, "SUPPORTER_EFFECT_USED")).toEqual([]);
    expect(done.state.players.p1.hand).toHaveLength(1);
    expect(turnPassed(done.state)).toBe(true);
  });

  it("an empty deck discards nothing and ends", () => {
    const state = withSide(foxBoard(undefined), "p1", { deck: [] });
    const done = run(state, attack(0));
    expect(of(done.events, "DECK_TOP_DISCARDED")).toEqual([]);
    expect(of(done.events, "SUPPORTER_EFFECT_USED")).toEqual([]);
  });

  it("the printed play condition is read for the attacker (R-LA2a carried): Cassiopeia needs an EMPTY hand", () => {
    const held = run(foxBoard(CASSIOPEIA, [ITEM]), attack(0));
    expect(of(held.events, "SUPPORTER_EFFECT_USED")).toEqual([]);
    expect(turnPassed(held.state)).toBe(true);
    const empty = run(foxBoard(CASSIOPEIA, []), attack(0));
    expect(of(empty.events, "SUPPORTER_EFFECT_USED")).toHaveLength(1);
  });
});

describe("D638 §6 — the version", () => {
  it("is built at engine 0.555.0", () => {
    expect(engineVersion).toBe("0.555.0");
  });
});
