import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import { battler, completeSetup, deckOf, trainerCard, typedEnergy } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

// ── CARD REVISION, BATCH B21 (Abilities) ──
//
// The verified findings from the per-unit audit (docs/reference/card-revision.md "B21"), driven on a
// real board through `applyAction` and asserted against the PRINTED text (local D1
// `cards.abilities_json` / `attacks_json` / `effect`, byte for byte below):
//   §1 Turtonator "Shell Spikes" (`me03-017`) — *"discard an Energy from the Attacking Pokémon."* The
//      reaction runs after the attack's own effect program, and it read the attacker seat's CURRENT
//      Active (`discardEnergy from: "opponentActive"`). Croconaw "Reverse Thrust" (*"Switch this
//      Pokémon with 1 of your Benched Pokémon."*) put the attacker on the Bench first, so the Pokémon
//      it promoted lost the Energy. Klawf ex "Counterattacking Pincer" (`sv03-120`) is the same program.
//   §2 the same defect on the status twins: Armarouge "Scorching Armor" (`sv03-044`), Heatran / Numel
//      "Incandescent Body" (`sv06-123`, `me02.5-027`, `me02.5-223`) Burned, and the five "Poison Point"
//      printings Poisoned, the promoted Pokémon that never attacked. Team Rocket's Hypnotizer
//      (`me02.5-206`, a Tool on the same stage) put it to sleep.
//   §3 Whimsicott "Wafting Heal" (`sv05-015` / `sv08.5-008`) — *"If you healed any damage in this way,
//      discard all Energy from that Pokémon."* Under Yveltal "Life-Locked" (`30th-100`) the heal heals
//      nothing, and the Energy was still discarded.

const SHELL_SPIKES =
  "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), discard an Energy from the Attacking Pokémon.";
const PINCER = SHELL_SPIKES;
const BURN_TEXT =
  "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Burned.";
const POISON_TEXT =
  "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Poisoned.";
const HYPNOTIZER_TEXT =
  "If the Team Rocket's Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Team Rocket's Pokémon is Knocked Out), the Attacking Pokémon is now Asleep.";
const REVERSE_THRUST = "Switch this Pokémon with 1 of your Benched Pokémon.";
const WAFTING_HEAL =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may heal all damage from your Active {G} Pokémon. If you healed any damage in this way, discard all Energy from that Pokémon.";
const LIFE_LOCKED = "Your opponent's Active Pokémon can't be healed.";

const TURTONATOR = "me03-017";
const KLAWF = "sv03-120";
const CROCONAW = "sv05-040";
const BURNERS = [
  { id: "sv03-044", name: "Armarouge", ability: "Scorching Armor" },
  { id: "sv06-123", name: "Heatran", ability: "Incandescent Body" },
  { id: "me02.5-027", name: "Numel", ability: "Incandescent Body" },
  { id: "me02.5-223", name: "Numel", ability: "Incandescent Body" },
] as const;
const POISONERS = [
  { id: "sv05-008", name: "Roselia" },
  { id: "sv05-009", name: "Roserade" },
  { id: "sv10.5b-056", name: "Scolipede" },
  { id: "sv10.5b-134", name: "Scolipede" },
  { id: "me04-052", name: "Qwilfish" },
] as const;
const HYPNOTIZER = "me02.5-206";
const WHIMSICOTTS = ["sv05-015", "sv08.5-008"] as const;
const COTTONEE = "sv05-014";
const YVELTAL = "30th-100";
const ROCKET = "b21-rocket";
const GRASSY = "b21-grassy";
const FILLER = "b21-filler";
const G = "b21-grass";
const W = "b21-water";

const ability = (name: string, effect: string) => [{ type: "Ability", name, effect }];
const TAP = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
/** Every reacting holder gets 200 HP, so neither attack Knocks it Out (the KO path is not the claim). */
const holder = (id: string, name: string, abilityName: string, text: string): Card =>
  battler(id, { name, hp: 200, abilities: ability(abilityName, text), attacks: TAP });

const LOCAL: Record<string, Card> = {
  [TURTONATOR]: holder(TURTONATOR, "Turtonator", "Shell Spikes", SHELL_SPIKES),
  [KLAWF]: holder(KLAWF, "Klawf ex", "Counterattacking Pincer", PINCER),
  ...Object.fromEntries(BURNERS.map((b) => [b.id, holder(b.id, b.name, b.ability, BURN_TEXT)])),
  ...Object.fromEntries(POISONERS.map((p) => [p.id, holder(p.id, p.name, "Poison Point", POISON_TEXT)])),
  [CROCONAW]: battler(CROCONAW, {
    name: "Croconaw",
    hp: 90,
    stage: "Stage1",
    attacks: [{ cost: ["Water"], name: "Reverse Thrust", effect: REVERSE_THRUST, damage: 30 }],
  }),
  [HYPNOTIZER]: { ...trainerCard(HYPNOTIZER, "Tool", HYPNOTIZER_TEXT), name: "Team Rocket's Hypnotizer" },
  [ROCKET]: battler(ROCKET, { name: "Team Rocket's B21", hp: 200, types: ["Darkness"], attacks: TAP }),
  ...Object.fromEntries(
    WHIMSICOTTS.map((id) => [
      id,
      battler(id, {
        name: "Whimsicott",
        hp: 100,
        stage: "Stage1",
        evolveFrom: "Cottonee",
        abilities: ability("Wafting Heal", WAFTING_HEAL),
        attacks: [{ cost: ["Grass"], name: "Seed Bomb", damage: 40 }],
      }),
    ]),
  ),
  [COTTONEE]: battler(COTTONEE, { name: "Cottonee", hp: 60, attacks: TAP }),
  [YVELTAL]: battler(YVELTAL, {
    name: "Yveltal",
    hp: 120,
    abilities: ability("Life-Locked", LIFE_LOCKED),
    attacks: [{ cost: ["Darkness", "Colorless", "Colorless"], name: "Dark Cutter", damage: 90 }],
  }),
  [GRASSY]: battler(GRASSY, { name: "B21 Grassy", hp: 200, types: ["Grass"], attacks: TAP }),
  [FILLER]: battler(FILLER, { name: "B21 Filler", hp: 300, types: ["Colorless"], attacks: TAP }),
  [G]: typedEnergy(G, "Grass"),
  [W]: typedEnergy(W, "Water"),
};

const DECK = deckOf({ [FILLER]: 20, [G]: 40 });

/** P1's turn 3 (past the §4 first-turn ban) on a 60-card filler deck. */
function base(): GameState {
  const created = createGame({ seed: 2121, decks: { p1: DECK, p2: DECK }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

interface Spec {
  id: string;
  energy?: readonly string[];
  tools?: readonly string[];
  damage?: number;
}
interface SideSpec {
  active: Spec;
  bench?: readonly Spec[];
  hand?: readonly string[];
}

/** TEST SURGERY — fresh uids for every card placed; both boards replaced. */
function table(p1: SideSpec, p2: SideSpec): GameState {
  const state: GameState = JSON.parse(JSON.stringify(base()));
  let n = 0;
  const alloc = (id: string): string => {
    const uid = `b21#${n++}`;
    state.cardIdByUid[uid] = id;
    const card = LOCAL[id];
    if (card === undefined) throw new Error(`no local face for ${id}`);
    state.cardPool = { ...state.cardPool, [id]: card };
    return uid;
  };
  const body = (spec: Spec): InPlayPokemon => ({
    ...makeInPlay(alloc(spec.id), 1),
    energy: (spec.energy ?? []).map(alloc),
    tools: (spec.tools ?? []).map(alloc),
    damage: spec.damage ?? 0,
  });
  for (const [seat, spec] of [
    ["p1", p1],
    ["p2", p2],
  ] as const) {
    const side = state.players[seat];
    state.players[seat] = {
      ...side,
      active: body(spec.active),
      bench: (spec.bench ?? []).map(body),
      hand: (spec.hand ?? []).map(alloc),
      deck: Array.from({ length: 10 }, () => alloc(FILLER)),
    };
  }
  return state;
}

function must(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

const activeOf = (state: GameState, seat: Seat): InPlayPokemon => {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`no ${seat} Active`);
  return body;
};
const benchAt = (state: GameState, seat: Seat, index: number): InPlayPokemon => {
  const body = state.players[seat].bench[index];
  if (body === undefined) throw new Error(`no ${seat} bench ${index}`);
  return body;
};
const idOf = (state: GameState, body: InPlayPokemon): string | undefined => state.cardIdByUid[body.stack.at(-1) ?? ""];
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

const attack: GameAction = { type: "attack", seat: "p1", index: 0 };

/** P1's Active Croconaw ({W}{W}) uses Reverse Thrust, with one Benched Filler ({G}{G}) to switch in;
    P2's Active is `defender` (carrying `tools`). The lone Bench target and the two identical {W} make
    every pick forced, so the attack resolves in one action. */
function reverseThrust(defender: string, tools: readonly string[] = []) {
  const state = table(
    { active: { id: CROCONAW, energy: [W, W] }, bench: [{ id: FILLER, energy: [G, G] }] },
    { active: { id: defender, tools } },
  );
  const croconaw = activeOf(state, "p1").stack.at(-1);
  const filler = benchAt(state, "p1", 0).stack.at(-1);
  const result = must(state, attack);
  return { ...result, croconaw, filler };
}

/** The control: P1's Active Filler ({G}{G}) uses Tap and stays the Active. */
function tap(defender: string, tools: readonly string[] = []) {
  const state = table({ active: { id: FILLER, energy: [G, G] } }, { active: { id: defender, tools } });
  return must(state, attack);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("B21 §1 — Shell Spikes / Counterattacking Pincer discard from the ATTACKING Pokémon, wherever it now is", () => {
  for (const [id, name] of [
    [TURTONATOR, "Shell Spikes"],
    [KLAWF, "Counterattacking Pincer"],
  ] as const) {
    it(`${id} "${name}": Reverse Thrust benches Croconaw first — the Energy comes off Croconaw, not the promoted Filler`, () => {
      const { state, events, croconaw, filler } = reverseThrust(id);
      expect(state.phase.kind).not.toBe("effect:choose");
      expect(ofType(events, "POKEMON_SWITCHED")).toHaveLength(1);
      expect(ofType(events, "ABILITY_TRIGGERED")).toEqual([
        { type: "ABILITY_TRIGGERED", seat: "p2", uid: expect.any(String), ability: name },
      ]);
      const discarded = ofType(events, "ENERGY_DISCARDED");
      expect(discarded).toHaveLength(1);
      expect(discarded[0]?.host).toBe(croconaw);
      // The promoted Filler never attacked and keeps both {G}.
      const promoted = activeOf(state, "p1");
      expect(promoted.stack.at(-1)).toBe(filler);
      expect(promoted.energy).toHaveLength(2);
      const benched = benchAt(state, "p1", 0);
      expect(idOf(state, benched)).toBe(CROCONAW);
      expect(benched.energy).toHaveLength(1);
    });

    it(`${id} "${name}": two different Energy on the benched Croconaw park for P2, who picks one of CROCONAW's`, () => {
      const state = table(
        { active: { id: CROCONAW, energy: [W, G] }, bench: [{ id: FILLER, energy: [G, G] }] },
        { active: { id } },
      );
      const croconaw = activeOf(state, "p1");
      const parked = must(state, attack).state;
      if (parked.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${parked.phase.kind}`);
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "discardEnergy") throw new Error(`unexpected prompt ${prompt.kind}`);
      expect(parked.phase.seat).toBe("p2");
      expect(prompt.note).toBe("Discard an Energy from the Attacking Pokémon.");
      expect(prompt.discardable.map((d) => d.uid).sort()).toEqual([...croconaw.energy].sort());
      expect(prompt.discardable.every((d) => d.from.seat === "p1" && d.from.spot.spot === "bench")).toBe(true);
      const water = croconaw.energy[0] as string;
      const after = must(parked, { type: "resolveEffect", seat: "p2", choice: { kind: "discardEnergy", uids: [water] } }).state;
      expect(benchAt(after, "p1", 0).energy).toEqual([croconaw.energy[1]]);
      expect(activeOf(after, "p1").energy).toHaveLength(2);
      expect(after.players.p1.discard).toContain(water);
    });

    it(`${id} "${name}", the control: an attacker that stays Active loses the Energy`, () => {
      const { state, events } = tap(id);
      expect(ofType(events, "ENERGY_DISCARDED")).toHaveLength(1);
      expect(activeOf(state, "p1").energy).toHaveLength(1);
    });
  }
});

describe("B21 §2 — \"the Attacking Pokémon is now Burned / Poisoned / Asleep\" never lands on a Pokémon that did not attack", () => {
  const cases = [
    ...BURNERS.map((b) => ({ id: b.id, name: b.ability, status: "burned" as const, tools: [] as string[] })),
    ...POISONERS.map((p) => ({ id: p.id, name: "Poison Point", status: "poisoned" as const, tools: [] as string[] })),
    { id: ROCKET, name: "Team Rocket's Hypnotizer", status: "asleep" as const, tools: [HYPNOTIZER] },
  ];
  for (const c of cases) {
    it(`${c.id} "${c.name}": after Reverse Thrust no Special Condition lands — not on the promoted Filler, not on the benched Croconaw`, () => {
      const { state, events, filler } = reverseThrust(c.id, c.tools);
      expect(ofType(events, "POKEMON_SWITCHED")).toHaveLength(1);
      expect(activeOf(state, "p1").stack.at(-1)).toBe(filler);
      // A Benched Pokémon cannot be affected by a Special Condition, and the Pokémon now in the
      // Active Spot did not attack.
      expect(ofType(events, "STATUS_APPLIED")).toEqual([]);
    });

    it(`${c.id} "${c.name}", the control: an attacker that stays Active is ${c.status}`, () => {
      const state = table({ active: { id: FILLER, energy: [G, G] } }, { active: { id: c.id, tools: c.tools } });
      const attacker = activeOf(state, "p1").stack.at(-1);
      const { events } = must(state, attack);
      expect(ofType(events, "STATUS_APPLIED").map((e) => [e.seat, e.uid, e.status])).toEqual([["p1", attacker, c.status]]);
    });
  }
});

describe("B21 §3 — Wafting Heal discards only if it healed any damage", () => {
  it("both printings carry the printed sentence and the one program", () => {
    for (const id of WHIMSICOTTS) {
      expect(LOCAL[id]?.abilities?.[0]?.effect, id).toBe(WAFTING_HEAL);
      expect(programFor(id), id).toBe(programFor(WHIMSICOTTS[0]));
    }
  });

  /** P1's Active B21 Grassy ({G}{G}, 40 damage); P1 evolves its Benched Cottonee into `id`. */
  function evolve(id: string, lifeLocked: boolean): GameState {
    const state = table(
      { active: { id: GRASSY, energy: [G, G], damage: 40 }, bench: [{ id: COTTONEE }], hand: [id] },
      { active: { id: FILLER }, bench: lifeLocked ? [{ id: YVELTAL }] : [] },
    );
    let { state: after } = must(state, {
      type: "evolve",
      seat: "p1",
      uid: state.players.p1.hand[0] as string,
      target: { spot: "bench", index: 0 },
    });
    if (after.phase.kind === "effect:choose") {
      after = must(after, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } }).state;
    }
    expect(after.phase.kind).toBe("turn:action");
    return after;
  }

  for (const id of WHIMSICOTTS) {
    it(`🛑 ${id}: under Yveltal "Life-Locked" nothing is healed, so no Energy is discarded`, () => {
      const active = activeOf(evolve(id, true), "p1");
      expect(active.damage).toBe(40);
      expect(active.energy).toHaveLength(2);
    });

    it(`${id}, the control: with no lock all 40 is healed and both Energy are discarded`, () => {
      const after = evolve(id, false);
      const active = activeOf(after, "p1");
      expect(active.damage).toBe(0);
      expect(active.energy).toHaveLength(0);
      expect(after.players.p1.discard.filter((u) => after.cardIdByUid[u] === G)).toHaveLength(2);
    });
  }
});
