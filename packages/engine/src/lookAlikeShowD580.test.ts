import type { Card } from "@luminous/schema";
import { redactedEffectPromptSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { resolvedByAnyReader } from "./censusAttackCorpus";
import { supporterEffectOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { settleProgram } from "./flow";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { opponentSupporterOffer, resumeProgram } from "./interpreter";
import type { EffectChoice, EffectPrompt, PokemonRef } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  deckOf,
  itemTrainer,
  specialEnergy,
  trainerCard,
  typedEnergy,
  walkProgram,
} from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

// ── 🆕🆕🆕 D580 — MR. MIME `sv05-063` "LOOK-ALIKE SHOW" — THE LAST ATTACK ──
//
// {C}, no damage, attack index 0 (1 legal printing): *"Your opponent reveals their hand. You may use
// the effect of a Supporter card you find there as the effect of this attack."* A REGISTRY row
// (`MR_MIME_LOOK_ALIKE_SHOW`): the shipped `revealOpponentHand`, then the NEW
// `useOpponentSupporterEffect` — which offers the opponent's Supporters (one per card id) filtered by
// their PRINTED play conditions for the attacker, parks `chooseCards { min 0, max 1, dest "use" }`,
// and on a pick splices the Supporter's registry `trainer` program into THIS ATTACK's context.
// "Eerie Wave" (index 1) keeps deriving. It RETIRES D445's recorded refusal.
//
// Rulings (decisions.md D580):
//   R-LA1 (by text) — effect only: the card stays in the opponent's hand, no Supporter allowance is
//         spent or required, `supporterPlayedUid` is not written, and "you" is the ATTACKER.
//   R-LA2 (UNRULED) — the offer is filtered by the PRINTED play conditions only (`trainerPlayableIf`,
//         `handCostUnmet` for the attacker); NOT `programPlayable`. Reversal: add it, or drop both.
//   R-LA2a (UNRULED) — a HAND-RELATIVE printed condition is read as if the copied card were played
//         from the attacker's hand, so it EXCLUDES the card itself (cardplay.ts checks it while the
//         card is still in hand): Cassiopeia's "only when it is the last card in your hand"
//         (`yourHandExactly 1`) is offered on an EMPTY attacker hand, never on a 1-card one.
//         Reversal: refuse Cassiopeia (the copied card is never "in your hand").
//   R-LA3 (measured, vacuous) — no Supporter program contains a copy op.
//   R-LA4 (UNRULED) — it is an ATTACK effect: attack-effect shields apply; Supporter shields do not.
//   R-LA5 (by text) — zero eligible Supporters, or a decline, is the reveal only.
//   R-LA6 (measured, vacuous) — card-level keys are NOT carried (`supporterKoPrizeBonus`,
//         `trainerFirstTurnExempt`): Mr. Mime deals no damage, is not Tera, and the attack ends the turn.
// Pinned: Caretaker's `shufflePlayedCardIntoDeck` whiffs (no `playedUid` in an attack context).

const MR_MIME = "sv05-063";
const LOOK_ALIKE =
  "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.";
const EERIE_WAVE = "Your opponent's Active Pokémon is now Confused.";
const PLAIN = "d580la-plain";
const FILLER = "d580la-filler";
const DARK_BODY = "d580la-dark";
const LIGHTNING_BODY = "d580la-lightning";
const ITEM = "d580la-item";
const TOOL = "d580la-tool";
const SPECIAL = "d580la-special";
const DARK_E = "d580la-dark-energy";
const L_E = "d580la-lightning-energy";
const UNPROGRAMMED = "d580la-unprogrammed-supporter";
const COMMUNITY_CENTER = "sv06-146";
const UNAWARE = "fix-unaware";
const NEST_BALL = "sv01-181"; // a REGISTERED Item (FIXTURE_POOL) — a trainer program that is not a Supporter
const UNNERVE = "fix-unnerve";
const EMMA = "me04-077"; // 🆕🆕🆕 D599 — an `me` Supporter with a registry `trainer` program (§8)

/** EVERY Standard-legal Supporter NAME, one representative printing each — 51 names over 140 legal
    printings, measured off the 2026-09-25 audit card JSON (tcgdex) at 7eed24e8, where every printing
    of one name carries the SAME registry object (measured). A committed snapshot (D275's rule). */
const SUPPORTERS: readonly (readonly [string, string])[] = [
  ["sv08.5-093", "Amarys"],
  ["sv05-142", "Bianca's Devotion"],
  ["sv09-142", "Billy & O'Nare"],
  ["sv08.5-096", "Black Belt's Training"],
  ["sv07-132", "Briar"],
  ["sv09-146", "Brock's Scouting"],
  ["sv06-144", "Caretaker"],
  ["sv06-145", "Carmine"],
  ["sv06.5-056", "Cassiopeia"],
  ["sv10.5w-081", "Cheren"],
  ["sv05-145", "Ciphermaniac's Codebreaking"],
  ["sv08-167", "Clemont's Quick Wit"],
  ["sv06.5-057", "Colress's Tenacity"],
  ["sv06-147", "Cook"],
  ["sv07-133", "Crispin"],
  ["sv08-170", "Cyrano"],
  ["sv08-173", "Drasna"],
  ["sv08-174", "Drayton"],
  ["sv10-163", "Emcee's Hype"],
  ["sv05-146", "Eri"],
  ["sv10-165", "Ethan's Adventure"],
  ["sv05-147", "Explorer's Guidance"],
  ["sv10.5b-082", "Fennel"],
  ["sv08.5-109", "Friends in Paldea"],
  ["sv10.5w-083", "Harlequin"],
  ["sv06-151", "Hassel"],
  ["sv10.5w-084", "Hilda"],
  ["sv09-149", "Iris's Fighting Spirit"],
  ["sv06.5-059", "Janine's Secret Art"],
  ["sv08-178", "Jasmine's Gaze"],
  ["sv06-154", "Kieran"],
  ["sv07-138", "Kofu"],
  ["sv07-139", "Lacey"],
  ["sv06-155", "Lana's Aid"],
  ["sv08.5-115", "Larry's Skill"],
  ["sv08-179", "Lisia's Appeal"],
  ["sv06-157", "Lucian"],
  ["sv05-155", "Morty's Conviction"],
  ["sv10.5b-083", "N's Plan"],
  ["sv06-160", "Perrin"],
  ["svp-114", "Picnicker"],
  ["sv09-157", "Ruffian"],
  ["sv05-160", "Salvatore"],
  ["sv08-187", "Surfer"],
  ["sv10-170", "Team Rocket's Archer"],
  ["sv10-171", "Team Rocket's Ariana"],
  ["sv10-174", "Team Rocket's Giovanni"],
  ["sv10-176", "Team Rocket's Petrel"],
  ["sv10-177", "Team Rocket's Proton"],
  ["sv08-190", "Tyme"],
  ["sv06.5-064", "Xerosic's Machinations"],
];
const SUPPORTER_ID: Record<string, string> = Object.fromEntries(SUPPORTERS.map(([id, name]) => [name, id]));
const sup = (name: string): string => SUPPORTER_ID[name] ?? "";

const body = (id: string, extra: Partial<Card>): Card =>
  battler(id, { name: id, hp: 900, types: ["Colorless"], attacks: [{ cost: [], name: "Tap", damage: 10 }], ...extra });

const LOCAL_CARDS: Record<string, Card> = {
  [MR_MIME]: battler(MR_MIME, {
    name: "Mr. Mime",
    hp: 90,
    types: ["Psychic"],
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Look-Alike Show", effect: LOOK_ALIKE },
      { cost: ["Psychic"], name: "Eerie Wave", effect: EERIE_WAVE, damage: 20 },
    ],
  }),
  [PLAIN]: body(PLAIN, {}),
  [FILLER]: body(FILLER, {}),
  [DARK_BODY]: body(DARK_BODY, { types: ["Darkness"] }),
  [LIGHTNING_BODY]: body(LIGHTNING_BODY, { types: ["Lightning"] }),
  [ITEM]: { ...itemTrainer(ITEM), name: "D580 Item" },
  [TOOL]: { ...trainerCard(TOOL, "Tool", "(constructed)"), name: "D580 Tool" },
  [SPECIAL]: specialEnergy(SPECIAL, "D580 Special Energy"),
  [DARK_E]: typedEnergy(DARK_E, "Darkness"),
  [L_E]: typedEnergy(L_E, "Lightning"),
  [UNPROGRAMMED]: { ...trainerCard(UNPROGRAMMED, "Supporter", "(constructed, no program)"), name: "D580 Blank" },
  [COMMUNITY_CENTER]: { ...trainerCard(COMMUNITY_CENTER, "Stadium", "Community Center"), name: "Community Center" },
  [EMMA]: {
    ...trainerCard(EMMA, "Supporter", "Your opponent reveals their hand, and you draw a card for each Pokémon you find there."),
    name: "Emma",
  },
  ...Object.fromEntries(
    SUPPORTERS.map(([id, name]) => [id, { ...trainerCard(id, "Supporter", `(${name})`), name }] as const),
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [MR_MIME]: 2,
  [PLAIN]: 4,
  [DARK_BODY]: 2,
  [LIGHTNING_BODY]: 2,
  [ITEM]: 4,
  [DARK_E]: 5,
  [L_E]: 5,
  [FILLER]: 26,
  "fix-energy": 10,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function opened(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** TEST SURGERY — mint a fresh uid for `id` (any `POOL` card, deck or not; the game's own pool
    holds only the dealt ids, so the card is added to it too) and hand it back. */
let minted = 0;
function mint(state: GameState, id: string): { state: GameState; uid: string } {
  minted += 1;
  const uid = `d580la-${minted}`;
  const card = POOL[id];
  if (card === undefined) throw new Error(`no ${id} in POOL`);
  return {
    uid,
    state: {
      ...state,
      cardIdByUid: { ...state.cardIdByUid, [uid]: id },
      cardPool: { ...state.cardPool, [id]: card },
    },
  };
}

interface Spot {
  id: string;
  energy?: readonly string[];
  tools?: readonly string[];
  damage?: number;
}

/** p1's turn 2: each seat's Active, Bench and HAND built by surgery (fresh uids); the setup's own
    hands, Actives and Benches are emptied into the decks first. */
function table(opts: {
  p1: Spot;
  p1Bench?: readonly Spot[];
  p1Hand?: readonly string[];
  p2: Spot;
  p2Bench?: readonly Spot[];
  p2Hand?: readonly string[];
}): GameState {
  let state = opened(5802);
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
  const build = (spot: Spot): InPlayPokemon => ({
    ...makeInPlay(fresh(spot.id), 0),
    energy: (spot.energy ?? []).map(fresh),
    tools: (spot.tools ?? []).map(fresh),
    damage: spot.damage ?? 0,
  });
  for (const seat of ["p1", "p2"] as const) {
    const active = build(seat === "p1" ? opts.p1 : opts.p2);
    const bench = (seat === "p1" ? (opts.p1Bench ?? []) : (opts.p2Bench ?? [])).map(build);
    const hand = (seat === "p1" ? (opts.p1Hand ?? []) : (opts.p2Hand ?? [])).map(fresh);
    state = withSide(state, seat, { active, bench, hand });
  }
  return state;
}

const MIME: Spot = { id: MR_MIME, energy: ["fix-energy"], damage: 30 };
const look: GameAction = { type: "attack", seat: "p1", index: 0 };
const use = (uid: string): GameAction => ({ type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [uid] } });
const decline: GameAction = { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } };
const types = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);
const turnPassed = (state: GameState): boolean => state.phase.kind === "turn:action" && state.phase.seat === "p2";

/** The populated board every rung starts from: p1's Mr. Mime (30 damage) with three Benched bodies and a
    4-card hand; p2's Active carries a Tool and a Special Energy, two Benched Basics (one with a Tool), and
    `p2Hand`. */
function board(p2Hand: readonly string[], patch: { p1Hand?: readonly string[]; p2?: Spot } = {}): GameState {
  return table({
    p1: MIME,
    p1Bench: [
      { id: DARK_BODY, energy: [DARK_E], damage: 20 },
      { id: LIGHTNING_BODY, energy: [L_E], damage: 20 },
      { id: FILLER },
    ],
    p1Hand: patch.p1Hand ?? [FILLER, FILLER, PLAIN, ITEM],
    p2: patch.p2 ?? { id: PLAIN, tools: [TOOL], energy: [SPECIAL, "fix-energy"] },
    p2Bench: [{ id: PLAIN, tools: [TOOL] }, { id: FILLER }],
    p2Hand,
  });
}

function prompt(state: GameState): EffectPrompt {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}

const sameRef = (a: PokemonRef, b: PokemonRef): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A LEGAL answer to any prompt, taking SOMETHING where the prompt allows it (so the nested effect
    actually runs), the decline otherwise. */
function autoAnswer(p: EffectPrompt): EffectChoice {
  switch (p.kind) {
    case "chooseCards":
      return { kind: "cards", uids: p.candidates.slice(0, Math.max(p.min, Math.min(1, p.max))) };
    case "choosePokemon":
      return p.candidates[0] === undefined ? { kind: "pokemon" } : { kind: "pokemon", ref: p.candidates[0] };
    case "choosePokemonMulti":
      return { kind: "pokemonMulti", refs: p.candidates.slice(0, Math.max(p.min, Math.min(1, p.max))) };
    case "moveEnergy": {
      const first = p.movable[0];
      const dest = first === undefined ? undefined : p.destinations.find((d) => !sameRef(d, first.from));
      return { kind: "moveEnergy", picks: first === undefined || dest === undefined ? [] : [{ uid: first.uid, dest }] };
    }
    case "discardEnergy": {
      const scope = p.scope;
      if (scope.kind === "total") return { kind: "discardEnergy", uids: p.discardable.slice(0, scope.count).map((d) => d.uid) };
      if (scope.kind === "upTo") return { kind: "discardEnergy", uids: [] };
      const seen = new Set<string>();
      const uids: string[] = [];
      for (const d of p.discardable) {
        const key = JSON.stringify(d.from);
        if (!seen.has(key)) {
          seen.add(key);
          uids.push(d.uid);
        }
      }
      return { kind: "discardEnergy", uids };
    }
    case "discardTools":
      return { kind: "discardTools", uids: p.discardable.slice(0, 1).map((d) => d.uid) };
    case "attachCards": {
      const [uid] = p.candidates;
      const [to] = p.targets;
      return { kind: "attachCards", assignments: uid === undefined || to === undefined ? [] : [{ uid, to }] };
    }
    case "mayDraw":
      return { kind: "mayDraw", draw: true };
    case "guessHp":
      return { kind: "hpGuess", hp: 70 };
    case "chooseAttack":
      return { kind: "attack", index: p.candidates[0]?.index ?? 0 };
    case "choosePrize":
      return { kind: "prize", index: p.indices[0] ?? 0 };
    case "confirm":
      return { kind: "confirm", yes: true };
    case "orderCards":
      return { kind: "orderCards", uids: [...p.candidates] };
  }
}

/** Answer every park, by whichever seat owes it, until the phase is no longer `effect:choose`. */
function settle(state: GameState): { state: GameState; events: GameEvent[]; parks: string[] } {
  let s = state;
  const events: GameEvent[] = [];
  const parks: string[] = [];
  for (let i = 0; i < 40 && s.phase.kind === "effect:choose"; i += 1) {
    const phase = s.phase;
    parks.push(phase.prompt.kind);
    const r = run(s, {
      type: "resolveEffect",
      seat: phase.answerer ?? phase.seat,
      choice: autoAnswer(phase.prompt),
    } as GameAction);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events, parks };
}

function render(events: GameEvent[], state: GameState): string[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [`${entry.who}: ${entry.segments.map((x) => x.text).join("")}`],
  );
}

describe("D580 Look-Alike Show §0 — the version, the registry row, the census claim", () => {
  it("is built at engine 0.524.0", () => {
    expect(engineVersion).toBe("0.524.0");
  });

  it("sv05-063 authors index 0 only: the reveal, then the NEW op; Eerie Wave (index 1) keeps deriving", () => {
    expect(programFor(MR_MIME)).toEqual({
      attack: { 0: [{ op: "revealOpponentHand" }, { op: "useOpponentSupporterEffect" }] },
    });
    expect(deriveAttackEffect(EERIE_WAVE)).not.toBeNull();
  });

  it("no READER claims the sentence (it stays a registry row, Walking Wake's shape) — D445's reader refusal is unchanged", () => {
    expect(resolvedByAnyReader(LOOK_ALIKE)).toBe(false);
  });
});

describe("D580 Look-Alike Show §1 — the offer (R-LA2) and its collapse", () => {
  it("offers the Supporters only — not a PROGRAMMED Item (Nest Ball), not a Supporter with no program — one per card id, in hand order", () => {
    const state = board([NEST_BALL, sup("Cheren"), UNPROGRAMMED, sup("Cheren"), sup("Picnicker")]);
    expect(programFor(NEST_BALL)?.trainer).toBeDefined(); // the premise: an Item WITH a program
    const hand = state.players.p2.hand;
    const declared = run(state, look).state;
    const p = prompt(declared);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(p).toMatchObject({ min: 0, max: 1, dest: "use" });
    expect(p.note).toBe("You may use the effect of a Supporter card you find there as the effect of this attack.");
    expect(p.candidates).toEqual([hand[1], hand[4]]);
  });

  it("an EMPTY program (Briar's `[]`) IS offered — once its printed condition holds", () => {
    const six = board([sup("Briar")]);
    expect(opponentSupporterOffer(six, { seat: "p1" })).toEqual([]);
    // Briar: "You can use this card only if your opponent has exactly 2 Prize cards remaining."
    const two = withSide(six, "p2", { prizes: six.players.p2.prizes.slice(0, 2) });
    expect(opponentSupporterOffer(two, { seat: "p1" })).toEqual(two.players.p2.hand);
    expect(supporterEffectOf(sup("Briar"))?.ops).toEqual([]);
  });

  it("trainerPlayableIf is evaluated for the ATTACKER: Cassiopeia (the last card in your hand) and Hassel (KO last turn)", () => {
    expect(opponentSupporterOffer(board([sup("Cassiopeia")]), { seat: "p1" })).toEqual([]);
    // R-LA2a: the copied Cassiopeia is in the OTHER hand, so "the last card in your hand" is an
    // EMPTY attacker hand — a 1-card hand is "Cassiopeia and one other card", which is refused.
    const one = board([sup("Cassiopeia")], { p1Hand: [FILLER] });
    expect(opponentSupporterOffer(one, { seat: "p1" })).toEqual([]);
    const empty = board([sup("Cassiopeia")], { p1Hand: [] });
    expect(empty.players.p1.hand).toEqual([]);
    expect(opponentSupporterOffer(empty, { seat: "p1" })).toEqual(empty.players.p2.hand);
    const hassel = board([sup("Hassel")]);
    expect(opponentSupporterOffer(hassel, { seat: "p1" })).toEqual([]);
    const koed = { ...hassel, lastKoTurn: { ...hassel.lastKoTurn, p1: hassel.turn - 1 } };
    expect(opponentSupporterOffer(koed, { seat: "p1" })).toEqual(koed.players.p2.hand);
    // …and NOT for the opponent: their own KO record does not open it.
    const wrongSeat = { ...hassel, lastKoTurn: { ...hassel.lastKoTurn, p2: hassel.turn - 1 } };
    expect(opponentSupporterOffer(wrongSeat, { seat: "p1" })).toEqual([]);
  });

  it("the hand COST is the ATTACKER's: Kofu (2 cards to the deck bottom) refused on a 1-card hand, offered on 2", () => {
    expect(opponentSupporterOffer(board([sup("Kofu")], { p1Hand: [FILLER] }), { seat: "p1" })).toEqual([]);
    const two = board([sup("Kofu")], { p1Hand: [FILLER, FILLER] });
    expect(opponentSupporterOffer(two, { seat: "p1" })).toEqual(two.players.p2.hand);
  });

  it("🛑 NOT `programPlayable`: a Supporter that could only whiff (Bianca's Devotion, nothing at ≤30 HP left) is still offered", () => {
    const state = board([sup("Bianca's Devotion")]);
    expect(opponentSupporterOffer(state, { seat: "p1" })).toEqual(state.players.p2.hand);
  });
});

describe("D580 Look-Alike Show §2 — a pick: the effect runs for the ATTACKER, the card never moves (R-LA1)", () => {
  it("Cheren: p1 draws 3; the event and the log row; Cheren stays in p2's hand; no TRAINER_PLAYED, no allowance spent", () => {
    const state = board([sup("Cheren"), FILLER]);
    const cheren = state.players.p2.hand[0] ?? "";
    const declared = run(state, look);
    expect(types(declared.events)).toContain("HAND_REVEALED");
    expect(declared.state.allowances.supporterPlayed).toBe(false);
    const before = declared.state.players.p1.hand.length;
    const picked = run(declared.state, use(cheren));
    expect(picked.events).toContainEqual({ type: "SUPPORTER_EFFECT_USED", seat: "p1", uid: cheren });
    expect(types(picked.events)).not.toContain("TRAINER_PLAYED");
    expect(render(picked.events, picked.state)).toContain("p1: Mr. Mime's Look-Alike Show used the effect of Cheren");
    // p1's turn is over, so read the draw off the events: 3 cards to p1, none to p2.
    const draws = picked.events.filter((e): e is Extract<GameEvent, { type: "CARDS_DRAWN" }> => e.type === "CARDS_DRAWN");
    expect(draws.filter((d) => d.seat === "p1").reduce((n, d) => n + d.uids.length, 0)).toBe(3);
    expect(picked.state.players.p1.hand.length).toBe(before + 3);
    expect(picked.state.players.p2.hand).toContain(cheren);
    expect(picked.state.players.p2.discard).not.toContain(cheren);
    expect(turnPassed(picked.state)).toBe(true);
  });

  it("the attacker's Supporter allowance is untouched mid-attack (a parked nested question shows the bag)", () => {
    const state = board([sup("Brock's Scouting")]);
    const declared = run(state, look).state;
    const nested = run(declared, use(declared.players.p2.hand[0] ?? "")).state;
    expect(prompt(nested).kind).toBe("chooseCards"); // Brock's Scouting's own search
    expect(nested.allowances.supporterPlayed).toBe(false);
    expect(nested.allowances.supporterPlayedUid).toBeNull();
  });

  it("an ALREADY-spent allowance does not refuse the copy (no Supporter is played)", () => {
    const state = board([sup("Cheren")]);
    const spent = { ...state, allowances: { ...state.allowances, supporterPlayed: true } };
    expect(opponentSupporterOffer(spent, { seat: "p1" })).toEqual(spent.players.p2.hand);
  });

  it("Iris's Fighting Spirit: the hand COST comes out of the ATTACKER's hand, then p1 draws up to 6", () => {
    const state = board([sup("Iris's Fighting Spirit")], { p1Hand: [FILLER, ITEM] });
    const declared = run(state, look).state;
    const nested = run(declared, use(declared.players.p2.hand[0] ?? "")).state;
    const p = prompt(nested);
    expect(p.kind).toBe("chooseCards");
    if (p.kind !== "chooseCards") return;
    expect(p.candidates.every((u) => nested.players.p1.hand.includes(u))).toBe(true);
    const paid = run(nested, use(p.candidates[0] ?? "")).state;
    expect(paid.players.p1.hand.length).toBe(6);
  });

  it("🛑 Caretaker's `shufflePlayedCardIntoDeck` WHIFFS (no `playedUid` in an attack): Community Center in play, nothing shuffled", () => {
    let state = board([sup("Caretaker")]);
    const cc = mint(state, COMMUNITY_CENTER);
    state = { ...cc.state, stadium: { uid: cc.uid, owner: "p2" } };
    const caretaker = state.players.p2.hand[0] ?? "";
    const declared = run(state, look).state;
    const picked = run(declared, use(caretaker));
    expect(types(picked.events)).not.toContain("DISCARD_RETRIEVED");
    expect(picked.state.players.p2.hand).toContain(caretaker);
    expect(turnPassed(picked.state)).toBe(true);
  });
});

describe("D580 Look-Alike Show §3 — the decline, the empty hand, no Supporter (R-LA5)", () => {
  it("a DECLINE is the reveal only: no event, nothing drawn, the turn passes", () => {
    const state = board([sup("Cheren")]);
    const declared = run(state, look).state;
    const declined = run(declared, decline);
    expect(types(declined.events)).not.toContain("SUPPORTER_EFFECT_USED");
    expect(types(declined.events).filter((t) => t === "CARDS_DRAWN").length).toBe(1); // p2's turn draw only
    expect(turnPassed(declined.state)).toBe(true);
  });

  it("an EMPTY opposing hand still reveals (zero uids) and asks nothing", () => {
    const state = board([]);
    const r = run(state, look);
    expect(r.events).toContainEqual(expect.objectContaining({ type: "HAND_REVEALED", seat: "p2", uids: [] }));
    expect(types(r.events)).not.toContain("SUPPORTER_EFFECT_USED");
    expect(turnPassed(r.state)).toBe(true);
  });

  it("a hand of no Supporters (Items, Pokémon) asks nothing", () => {
    const r = run(board([ITEM, FILLER]), look);
    expect(turnPassed(r.state)).toBe(true);
  });
});

describe("D580 Look-Alike Show §4 — R-LA4: an ATTACK effect for the shields", () => {
  it("Lisia's Appeal's Confusion is REFUSED by an attack-effect shield (Unaware) and NOT by a Supporter shield (Unnerve)", () => {
    for (const [shield, confused] of [
      [UNAWARE, false],
      [UNNERVE, true],
    ] as const) {
      const state = table({ p1: MIME, p1Hand: [FILLER], p2: { id: shield }, p2Hand: [sup("Lisia's Appeal")] });
      const declared = run(state, look).state;
      const picked = run(declared, use(declared.players.p2.hand[0] ?? ""));
      const done = settle(picked.state);
      const active = done.state.players.p2.active as InPlayPokemon;
      expect(active.conditions.rotation === "confused", shield).toBe(confused);
    }
  });
});

describe("D580 Look-Alike Show §5 — the population pins (R-LA3, R-LA6)", () => {
  it("R-LA3: no Supporter program contains a copy op (no `useOpponentSupporterEffect` anywhere in the 51)", () => {
    for (const [id] of SUPPORTERS) {
      const ops = walkProgram(programFor(id)?.trainer ?? []);
      expect(ops.some((op: EffectOp) => op.op === "useOpponentSupporterEffect"), id).toBe(false);
    }
  });

  it("R-LA6: the card-level keys live on Briar / Carmine / Team Rocket's Proton only, and the copy hands over only `ops` + `playableIf`", () => {
    // 🆕🆕🆕 D599 (D539): "only" is over THESE 51 `sv` names (the 2026-09-25 snapshot). The `me`
    // Supporter Anthea & Concordia `me02.5-182` also carries `supporterKoPrizeBonus` now; R-LA6
    // holds for it the same way (the copy hands over `ops` + `playableIf`, its `ops` empty).
    const carriers = SUPPORTERS.filter(([id]) => {
      const p = programFor(id);
      return p?.supporterKoPrizeBonus !== undefined || p?.trainerFirstTurnExempt !== undefined;
    }).map(([, name]) => name);
    expect(carriers).toEqual(["Briar", "Carmine", "Team Rocket's Proton"]);
    expect(Object.keys(supporterEffectOf(sup("Briar")) ?? {}).sort()).toEqual(["ops", "playableIf"]);
  });

  it("R-LA2a's population: the Supporter play conditions are four, and `yourHandExactly` (Cassiopeia) is the ONLY hand-relative kind — none nests", () => {
    const conditions = SUPPORTERS.flatMap(([id, name]) => {
      const cond = programFor(id)?.trainerPlayableIf;
      return cond === undefined ? [] : [[name, cond.kind] as const];
    });
    expect(conditions).toEqual([
      ["Briar", "opponentPrizesRemaining"],
      ["Cassiopeia", "yourHandExactly"],
      ["Hassel", "yourPokemonKoedOnOpponentsLastTurn"],
      ["Team Rocket's Archer", "yourPokemonKoedOnOpponentsLastTurn"],
    ]);
    expect(programFor(sup("Cassiopeia"))?.trainerPlayableIf).toEqual({ kind: "yourHandExactly", count: 1 });
  });

  it("every one of the 51 names carries a registry `trainer` program", () => {
    expect(SUPPORTERS).toHaveLength(51);
    expect(SUPPORTERS.filter(([id]) => programFor(id)?.trainer === undefined)).toEqual([]);
  });
});

/** The four names whose printed condition is false on the base board, and the surgery that opens it. */
function unlocked(name: string, state: GameState): GameState {
  switch (name) {
    case "Briar":
      return withSide(state, "p2", { prizes: state.players.p2.prizes.slice(0, 2) });
    case "Cassiopeia":
      // R-LA2a — "the last card in your hand", the card itself excluded: an EMPTY attacker hand.
      return withSide(state, "p1", { hand: [] });
    case "Hassel":
      return { ...state, lastKoTurn: { ...state.lastKoTurn, p1: state.turn - 1 } };
    case "Team Rocket's Archer":
      return {
        ...state,
        lastKoTurn: { ...state.lastKoTurn, p1: state.turn - 1 },
        lastKoMarks: { ...state.lastKoMarks, p1: [{ uid: "gone", name: "Team Rocket's Rattata", byAttack: true }] },
      };
    default:
      return state;
  }
}

/** The effects that may move cards of p2's HAND themselves, so the copied card may leave it. */
const MOVES_P2_HAND = new Set(["Harlequin", "Lucian", "Team Rocket's Archer", "Xerosic's Machinations"]);

describe("D580 Look-Alike Show §6 — THE POPULATION LOOP: all 51 Supporter names, through the attack", () => {
  const parked = new Map<string, string[]>();

  it("every name is offered on its board, used, and SETTLES — no throw, every nested park answered, the turn passed", () => {
    const refusedOnBase: string[] = [];
    for (const [id, name] of SUPPORTERS) {
      const base = board([id, ITEM, FILLER, FILLER, PLAIN]);
      if (opponentSupporterOffer(base, { seat: "p1" }).length === 0) refusedOnBase.push(name);
      const state = unlocked(name, base);
      const card = state.players.p2.hand[0] ?? "";
      const declared = run(state, look);
      const p = prompt(declared.state);
      expect(p.kind === "chooseCards" && p.dest === "use" && p.candidates.includes(card), name).toBe(true);
      const picked = run(declared.state, use(card));
      expect(picked.events, name).toContainEqual({ type: "SUPPORTER_EFFECT_USED", seat: "p1", uid: card });
      const done = settle(picked.state);
      parked.set(name, done.parks);
      const all = [...declared.events, ...picked.events, ...done.events];
      expect(done.state.phase.kind === "turn:action" || done.state.phase.kind === "gameOver", name).toBe(true);
      if (done.state.phase.kind === "turn:action") expect(done.state.phase.seat, name).toBe("p2");
      expect(types(all).filter((t) => t === "TRAINER_PLAYED"), name).toEqual([]);
      // The COPY never moves the card (R-LA1); only an effect that itself moves p2's hand may.
      if (!MOVES_P2_HAND.has(name)) {
        expect(done.state.players.p2.hand, name).toContain(card);
        expect(done.state.players.p2.discard, name).not.toContain(card);
      }
    }
    // The four printed conditions the base board does not meet (R-LA2), and nothing else.
    expect(refusedOnBase.sort()).toEqual(["Briar", "Cassiopeia", "Hassel", "Team Rocket's Archer"]);
  });

  it("…and the NESTED parks really happened — every Supporter's own questions, asked inside the attack (measured, pinned whole)", () => {
    // The prompt kinds each copied program parked, in order, on the population board, every one
    // answered by `autoAnswer` (taking something where allowed). An empty list is a program that
    // resolved inline on this board (a draw, a heal, a whiffing search over a deck with no match).
    expect(Object.fromEntries(parked)).toEqual({
      Amarys: [],
      "Bianca's Devotion": [],
      "Billy & O'Nare": [],
      "Black Belt's Training": [],
      Briar: [],
      "Brock's Scouting": ["chooseCards"],
      Caretaker: [],
      Carmine: [],
      Cassiopeia: ["chooseCards"],
      Cheren: [],
      "Ciphermaniac's Codebreaking": ["chooseCards", "orderCards"],
      "Clemont's Quick Wit": [],
      "Colress's Tenacity": ["chooseCards"],
      Cook: [],
      Crispin: ["chooseCards", "confirm", "choosePokemon"],
      Cyrano: [],
      Drasna: [],
      Drayton: ["chooseCards"],
      "Emcee's Hype": [],
      Eri: ["chooseCards"],
      "Ethan's Adventure": [],
      "Explorer's Guidance": ["chooseCards"],
      Fennel: [],
      "Friends in Paldea": [],
      Harlequin: [],
      Hassel: ["chooseCards"],
      Hilda: ["chooseCards"],
      "Iris's Fighting Spirit": ["chooseCards"],
      "Janine's Secret Art": ["attachCards"],
      "Jasmine's Gaze": [],
      Kieran: ["confirm", "choosePokemon"],
      Kofu: ["chooseCards", "orderCards"],
      Lacey: [],
      "Lana's Aid": [],
      "Larry's Skill": ["chooseCards"],
      "Lisia's Appeal": ["choosePokemon"],
      Lucian: [],
      "Morty's Conviction": ["chooseCards"],
      "N's Plan": ["moveEnergy"],
      Perrin: ["chooseCards", "chooseCards"],
      Picnicker: [],
      Ruffian: ["choosePokemon"],
      Salvatore: [],
      Surfer: ["choosePokemon"],
      "Team Rocket's Archer": [],
      "Team Rocket's Ariana": [],
      "Team Rocket's Giovanni": [],
      "Team Rocket's Petrel": ["chooseCards"],
      "Team Rocket's Proton": [],
      Tyme: ["chooseCards", "guessHp"],
      "Xerosic's Machinations": ["chooseCards"],
    });
  });

  it("the SCHEDULED and INSTALLED effects land for the ATTACKER: Amarys's turn-end discard, Jasmine's Gaze's window", () => {
    const through = (name: string) => {
      const declared = run(board([sup(name), ITEM, FILLER, FILLER, PLAIN]), look).state;
      const picked = run(declared, use(declared.players.p2.hand[0] ?? ""));
      const done = settle(picked.state);
      return { state: done.state, events: [...picked.events, ...done.events] };
    };
    // Amarys: draw 4 (4 + 4 = 8 ≥ 5), so the attacker's hand is discarded at the end of THIS turn.
    const amarys = through("Amarys");
    expect(amarys.events).toContainEqual(expect.objectContaining({ type: "HAND_DISCARDED", seat: "p1" }));
    expect(amarys.state.players.p1.hand).toEqual([]);
    // Jasmine's Gaze: the attacker's side takes 30 less during the opponent's next turn.
    // 🆕🆕🆕 D630 (D539): `not.toBeNull()` is vacuous on the D630 LIST — asked as one live entry instead.
    expect(through("Jasmine's Gaze").state.players.p1.sideDamageReduction).toHaveLength(1);
  });
});

describe("D580 Look-Alike Show §7 — the wire, the replay, and MRV 41 under a 0.463 rollback", () => {
  const parkedState = (): GameState => run(board([sup("Cheren")]), look).state;

  it("the park is WIRE-legal for the attacker, and the OPPONENT is not the answerer", () => {
    const parked = parkedState();
    const wire = redactGame(parked, "p1").phase;
    if (wire.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(() => redactedEffectPromptSchema.parse(wire.prompt)).not.toThrow();
    expect(parked.phase.kind === "effect:choose" && (parked.phase.answerer ?? parked.phase.seat)).toBe("p1");
    const theirs = applyAction(parked, { type: "resolveEffect", seat: "p2", choice: { kind: "cards", uids: [] } });
    expect(theirs.ok).toBe(false);
  });

  it("a JSON round-trip of the parked state resolves identically", () => {
    const parked = parkedState();
    const pick = use(parked.players.p2.hand[0] ?? "");
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(JSON.stringify(run(revived, pick).state)).toBe(JSON.stringify(run(parked, pick).state));
  });

  it("🛑 under a 0.463 rollback (an op name it does not know) a PICK is an inert whiff — the decline's board exactly", () => {
    const parked = parkedState();
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect((phase.cont.pendingOp as EffectOp).op).toBe("useOpponentSupporterEffect");
    const cont = { ...phase.cont, pendingOp: { op: "unknownTo0463" } as unknown as EffectOp };
    const events: GameEvent[] = [];
    const rolled = settleProgram(
      resumeProgram(parked, cont, { kind: "cards", uids: [parked.players.p2.hand[0] ?? ""] }, events),
      phase.seat,
      events,
      { resumeTail: phase.resumeTail === true, endsTurn: phase.endsTurn === true },
    );
    if (!rolled.ok) throw new Error("the rollback reading failed");
    expect(types(rolled.events)).not.toContain("SUPPORTER_EFFECT_USED");
    expect(JSON.stringify(rolled.state)).toBe(JSON.stringify(run(parked, decline).state));
    expect(turnPassed(rolled.state)).toBe(true);
  });
});

describe("D580 Look-Alike Show §8 — 🆕🆕🆕 D599: an `me` Supporter through the copy (Emma `me04-077`)", () => {
  it("Emma is offered and used for the ATTACKER: p2 reveals again and p1 draws one card per Pokémon in p2's hand", () => {
    // p2's hand: Emma (a Trainer), 2 Pokémon, an Item → 2. p1's own hand holds 3 Pokémon, so a
    // count of the attacker's hand would draw 3.
    const state = board([EMMA, PLAIN, FILLER, ITEM]);
    const emma = state.players.p2.hand[0] ?? "";
    expect(opponentSupporterOffer(state, { seat: "p1" })).toEqual([emma]);
    const declared = run(state, look).state;
    const before = declared.players.p1.hand.length;
    const picked = run(declared, use(emma));
    expect(picked.events).toContainEqual({ type: "SUPPORTER_EFFECT_USED", seat: "p1", uid: emma });
    expect(picked.events.filter((e) => e.type === "HAND_REVEALED")).toEqual([
      expect.objectContaining({ seat: "p2", uids: declared.players.p2.hand }),
    ]);
    const draws = picked.events.filter((e): e is Extract<GameEvent, { type: "CARDS_DRAWN" }> => e.type === "CARDS_DRAWN");
    expect(draws.filter((d) => d.seat === "p1").reduce((n, d) => n + d.uids.length, 0)).toBe(2);
    expect(picked.state.players.p1.hand.length).toBe(before + 2);
    expect(picked.state.players.p2.hand).toContain(emma);
    expect(turnPassed(picked.state)).toBe(true);
  });
});
