import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { coinFlipShieldPrevents } from "./continuous";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setDamage,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D584 — THE `me` ALIAS TIER 2: RENAMED COPIES, PARAMETER COPIES, WHITESPACE TWINS ──
//
// 18 `me` printings / 11 printed texts whose twin is BUILT on an `sv` id, but which D582's
// same-object alias could not take (reprintAliasMeD582.test.ts's NOT-aliased rows, plus the ones
// its byte-equality join missed). Measured on the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`),
// 2026-10-07, `legal_standard = 1` on every row:
//
//   • "alias"   — the face equals the twin's once tcgdex's markup is normalised (a newline run, or
//                 "ColorlessColorless" for {C}{C}), or differs by a word that does not change the
//                 rule under the SAME Ability name ("place" / "put"), AND the twin's program names no
//                 Ability: keyed on the twin's OBJECT (D190's idiom, `toBe`).
//   • "renamed" — the twin's program NAMES its Ability (or the twin's own alias logged another
//                 card's name: Heatran), so a NEW object carries the twin's ops under the printed
//                 name. Some `me` texts add "use this Ability." (the `me` wording of the same rule).
//   • "param"   — one printed parameter differs (30 for 20; Confused for Paralyzed): a NEW object
//                 with the twin's field at the printed value.
//   • "attack"  — the twin's ATTACK sentence at another INDEX: a NEW object at the printed index.
//
// No `me` row is a fixture, so the printed bytes are carried HERE (transcribed off the D1) and the
// face rung asserts each `me` text against its twin's, through one stated normalisation and one
// stated delta. Where the twin IS a full-text fixture, the table is checked against it too.

/** tcgdex's two markup artefacts on these rows: a run of whitespace (Ultra Ball's "\n" against
    `sv01-196`'s "\n\n") and an energy symbol spelled as its type word ("ColorlessColorless"). */
function normalise(text: string): string {
  return text.replace(/ColorlessColorless/g, "{C}{C}").replace(/\s+/g, " ").trim();
}

type Kind = "alias" | "renamed" | "param" | "attack";

/** [me ids, twin id, kind, printed name (Ability or attack), me text, twin text, delta]. The delta
    is [twin phrase, me phrase] — the ONE edit that turns the twin's text into the `me` text. */
const FACES: readonly (readonly [
  readonly string[],
  string,
  Kind,
  string,
  string,
  string,
  readonly [string, string] | null,
])[] = [
  [
    ["me02.5-213", "me02.5-264"],
    "sv01-196",
    "alias",
    "Ultra Ball",
    "You can use this card only if you discard 2 other cards from your hand.\nSearch your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
    "You can use this card only if you discard 2 other cards from your hand.\n\nSearch your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
    null,
  ],
  [
    ["30th-096"],
    "sv09-089",
    "alias",
    "Nighttime Byway",
    "As long as this Pokémon is on your Bench, your Active Pokémon's Retreat Cost is ColorlessColorless less.",
    "As long as this Pokémon is on your Bench, your Active Pokémon's Retreat Cost is {C}{C} less.",
    null,
  ],
  [
    ["me02.5-068"],
    "sv01-005",
    "alias",
    "Counterattack Quills",
    "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon.",
    "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon.",
    ["put 3", "place 3"],
  ],
  [
    ["me04-073", "me04-105", "me04-119"],
    "sv08-150",
    "renamed",
    "Smooth Coat",
    "If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage.",
    "If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage.",
    null,
  ],
  [
    ["me03-017"],
    "sv03-120",
    "renamed",
    "Shell Spikes",
    "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), discard an Energy from the Attacking Pokémon.",
    "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), discard an Energy from the Attacking Pokémon.",
    null,
  ],
  [
    ["me02.5-027", "me02.5-223", "sv06-123"],
    "sv03-044",
    "renamed",
    "Incandescent Body",
    "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Burned.",
    "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Burned.",
    null,
  ],
  [
    ["me05-068", "me05-094"],
    "sv10-030",
    "renamed",
    "Aerial Draw",
    "Once during your turn, you may use this Ability. Draw a card.",
    "Once during your turn, you may draw a card.",
    ["you may draw a card.", "you may use this Ability. Draw a card."],
  ],
  [
    ["mep-101", "30th-088"],
    "sv09-075",
    "renamed",
    "Share Happiness",
    "Once during your turn, you may use this Ability. Heal 30 damage from 1 of your Pokémon.",
    "Once during your turn, you may heal 30 damage from 1 of your Pokémon.",
    ["you may heal 30", "you may use this Ability. Heal 30"],
  ],
  [
    ["me01-024"],
    "sv03-030",
    "param",
    "Intimidating Fang",
    "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 30 less damage (before applying Weakness and Resistance).",
    "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying Weakness and Resistance).",
    ["do 20 less", "do 30 less"],
  ],
  [
    ["mep-086"],
    "sv01-068",
    "param",
    "Dopey Face",
    "This Pokémon can't be Confused.",
    "This Pokémon can't be Paralyzed.",
    ["Paralyzed", "Confused"],
  ],
  [
    ["30th-073", "30th-136"],
    "sv08-131",
    "attack",
    "Float Up",
    "You may shuffle this Pokémon and all attached cards into your deck.",
    "You may shuffle this Pokémon and all attached cards into your deck.",
    null,
  ],
];

const ME_IDS = FACES.flatMap(([ids]) => ids).filter((id) => id !== "sv06-123");

/** Every Ability name a program carries — what the log shows (`name` / `ability` strings). */
function programAbilityNames(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) programAbilityNames(x, out);
  else if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if ((k === "name" || k === "ability") && typeof x === "string") out.push(x);
      programAbilityNames(x, out);
    }
  return out;
}

describe("D584 §1 — the faces: 18 `me` printings and Heatran, each pinned to its twin's text", () => {
  it("11 texts / 18 `me` printings (plus Heatran `sv06-123`, the D190 row the Numel fix shares)", () => {
    expect(FACES).toHaveLength(11);
    expect(ME_IDS).toHaveLength(18);
    expect(new Set(ME_IDS).size).toBe(18);
    const kinds = (k: Kind) => FACES.filter(([, , kind]) => kind === k).flatMap(([ids]) => ids).length;
    expect([kinds("alias"), kinds("renamed"), kinds("param"), kinds("attack")]).toEqual([4, 11, 2, 2]);
  });

  it("every `me` text IS its twin's — normalised, and through the one stated delta", () => {
    for (const [ids, twin, , name, meText, twinText, delta] of FACES) {
      const from = delta === null ? twinText : twinText.replace(delta[0], delta[1]);
      if (delta !== null) expect(twinText, `${twin}: the delta's left side`).toContain(delta[0]);
      expect(normalise(meText), `${ids.join(" / ")} (${name}) ~ ${twin}`).toBe(normalise(from));
    }
  });

  it("the normalisation is load-bearing exactly where the table says (no silent widening)", () => {
    const [ultra, zoroark] = FACES;
    expect(ultra?.[4]).not.toBe(ultra?.[5]); // one newline apart
    expect(zoroark?.[4]).toContain("ColorlessColorless");
    expect(normalise("Retreat Cost is ColorlessColorless less.")).toBe("Retreat Cost is {C}{C} less.");
    // A lone type word is text, not markup, and survives.
    expect(normalise("a Colorless Pokémon")).toBe("a Colorless Pokémon");
  });

  it("the twin texts the shared fixture pool carries in full agree with this table", () => {
    const fixtureText: Record<string, string | null | undefined> = {
      "sv01-196": FIXTURE_POOL["sv01-196"]?.effect,
      "sv03-030": FIXTURE_POOL["sv03-030"]?.abilities?.[0]?.effect,
      "sv01-068": FIXTURE_POOL["sv01-068"]?.abilities?.[0]?.effect,
    };
    for (const [twin, text] of Object.entries(fixtureText)) {
      const row = FACES.find(([, t]) => t === twin);
      expect(row?.[5], twin).toBe(text);
    }
  });
});

describe("D584 §2 — the registry relation, per kind", () => {
  it("alias: the `me` id shares the twin's OBJECT, and that object names no Ability", () => {
    for (const [ids, twin, kind] of FACES) {
      if (kind !== "alias") continue;
      for (const id of ids) expect(programFor(id), `${id} ~ ${twin}`).toBe(programFor(twin));
      expect(programAbilityNames(programFor(twin)), twin).toEqual([]);
    }
  });

  it("renamed: a NEW object — the twin's ops, byte for byte, under the printed name", () => {
    for (const [ids, twin, kind, name] of FACES) {
      if (kind !== "renamed") continue;
      const program = programFor(ids[0] as string);
      expect(program, `${ids[0]}`).toBeDefined();
      for (const id of ids) expect(programFor(id), id).toBe(program);
      expect(program).not.toBe(programFor(twin));
      const [twinName] = programAbilityNames(programFor(twin));
      expect(twinName, twin).toBeDefined();
      expect(JSON.stringify(program).replaceAll(name, twinName as string)).toBe(JSON.stringify(programFor(twin)));
    }
  });

  it("param: a NEW object — the twin's field at the printed value", () => {
    expect(programFor("me01-024")).toEqual({ passive: { opponentActiveAttackDebuff: 30 } });
    expect(programFor("sv03-030")).toEqual({ passive: { opponentActiveAttackDebuff: 20 } });
    expect(programFor("mep-086")).toEqual({ passive: { statusImmunities: ["confused"] } });
    expect(programFor("sv01-068")).toEqual({ passive: { statusImmunities: ["paralyzed"] } });
  });

  it("attack: Surf Back's ops at Drifloon's printed index 0, and nothing at index 1", () => {
    const floatUp = programFor("30th-073");
    expect(programFor("30th-136")).toBe(floatUp);
    expect(Object.keys(floatUp ?? {})).toEqual(["attack"]);
    expect(Object.keys(floatUp?.attack ?? {})).toEqual(["0"]);
    expect(floatUp?.attack?.[0]).toEqual(programFor("sv08-131")?.attack?.[1]);
  });

  it("every keyed program names ONLY the Ability its `me` printing prints", () => {
    for (const [ids, , kind, name] of FACES) {
      for (const id of ids) {
        const names = programAbilityNames(programFor(id));
        if (kind === "renamed") expect(names, id).toEqual([name]);
        else expect(names, id).toEqual([]);
      }
    }
  });
});

// ── ON A BOARD: every new object logs the PRINTED name, and every parameter is the printed one ──

const PSYCHIC = "d584-psychic";
const FILLER = "d584-filler";
const ATTACKER = "d584-attacker";

function body(id: string, name: string, hp: number, stage: string, type: string, extra: Partial<Card>): Card {
  return battler(id, { name, hp, stage, types: [type], retreat: 2, ...extra });
}

function ability(name: string, effect: string): Partial<Card> {
  return { abilities: [{ type: "Ability", name, effect }] };
}

const text = (id: string) => FACES.find(([ids]) => ids.includes(id))?.[4] ?? "";

/** The LOCAL pool (D275's idiom): the real ids, printed names, texts and HP. No Weakness is
    carried (nothing below reads it). */
const LOCAL: Record<string, Card> = {
  "me04-073": body("me04-073", "Cinccino ex", 240, "Stage1", "Colorless", ability("Smooth Coat", text("me04-073"))),
  "me03-017": body("me03-017", "Turtonator", 120, "Basic", "Fire", ability("Shell Spikes", text("me03-017"))),
  "me02.5-027": body("me02.5-027", "Numel", 80, "Basic", "Fire", ability("Incandescent Body", text("me02.5-027"))),
  "sv06-123": body("sv06-123", "Heatran", 140, "Basic", "Metal", ability("Incandescent Body", text("sv06-123"))),
  "me05-068": body("me05-068", "Toucannon", 150, "Stage2", "Colorless", ability("Aerial Draw", text("me05-068"))),
  "mep-101": body("mep-101", "Nidorina", 90, "Stage1", "Darkness", ability("Share Happiness", text("mep-101"))),
  "me01-024": body("me01-024", "Pyroar", 130, "Stage1", "Fire", ability("Intimidating Fang", text("me01-024"))),
  "mep-086": body("mep-086", "Slowpoke", 80, "Basic", "Psychic", ability("Dopey Face", text("mep-086"))),
  "30th-073": body("30th-073", "Drifloon", 70, "Basic", "Psychic", {
    attacks: [{ cost: ["Psychic"], name: "Float Up", damage: 20, effect: text("30th-073") }],
  }),
  [FILLER]: battler(FILLER, { name: "D584 Filler", hp: 300, types: ["Colorless"], attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }] }),
  [PSYCHIC]: typedEnergy(PSYCHIC, "Psychic"),
  [ATTACKER]: battler(ATTACKER, {
    name: "D584 Attacker",
    hp: 300,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      { cost: ["Colorless"], name: "Confuse Ray", effect: "Your opponent's Active Pokémon is now Confused." },
    ],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const BODIES = Object.keys(LOCAL).filter((id) => id !== FILLER && id !== PSYCHIC && id !== ATTACKER);
const DECK = deckOf({
  ...Object.fromEntries(BODIES.map((id) => [id, 3])),
  [ATTACKER]: 3,
  "sv03-030": 3,
  [FILLER]: 13,
  "fix-energy": 8,
  [PSYCHIC]: 6,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then `seat`'s own turn (the other seat went first and passed). */
function turnOf(seat: Seat): GameState {
  const first: Seat = seat === "p1" ? "p2" : "p1";
  const created = createGame({ seed: 5841, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }));
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
  return must(applyAction(state, { type: "endTurn", seat: first }));
}

/** P1 attacks with the local attacker (one {C} attached: Bite, 30) into P2's Active `defender`. */
function fight(defender: string): GameState {
  let state = setActiveFromDeck(turnOf("p1"), "p1", ATTACKER);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return setActiveFromDeck(state, "p2", defender);
}

const BITE = { type: "attack", seat: "p1", index: 0 } as const;

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function use(abilityName: string): GameAction {
  return { type: "useAbility", seat: "p1", target: { spot: "bench", index: 0 }, abilityName };
}

describe("D584 §3 — the renamed copies log the PRINTED name", () => {
  it("Cinccino ex: the coin is flipped under \"Smooth Coat\"", () => {
    const state = fight("me04-073");
    const cinccino = state.players.p2.active;
    if (cinccino === null) throw new Error("no Active");
    const events: GameEvent[] = [];
    coinFlipShieldPrevents(state, cinccino, "p2", 30, events);
    expect(all(events, "ABILITY_COIN_FLIP").map((e) => e.ability)).toEqual(["Smooth Coat"]);
    // …and on the real attack, the same row.
    const { events: hit } = mustApply(state, BITE);
    expect(all(hit, "ABILITY_COIN_FLIP").map((e) => e.ability)).toEqual(["Smooth Coat"]);
  });

  it("Turtonator: the reaction triggers as \"Shell Spikes\"", () => {
    const { events } = mustApply(fight("me03-017"), BITE);
    expect(all(events, "ABILITY_TRIGGERED").map((e) => [e.seat, e.ability])).toEqual([["p2", "Shell Spikes"]]);
  });

  it("Numel and Heatran: the attacker is Burned under \"Incandescent Body\" — never \"Scorching Armor\"", () => {
    for (const id of ["me02.5-027", "sv06-123"]) {
      const { events } = mustApply(fight(id), BITE);
      expect(all(events, "ABILITY_TRIGGERED").map((e) => [e.seat, e.ability]), id).toEqual([["p2", "Incandescent Body"]]);
      expect(all(events, "STATUS_APPLIED").map((e) => [e.seat, e.status]), id).toEqual([["p1", "burned"]]);
    }
  });

  it("Toucannon: \"Aerial Draw\" draws a card from the Bench; the twin's \"Hurried Gait\" is no such Ability", () => {
    let state = setActiveFromDeck(turnOf("p1"), "p1", FILLER);
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "me05-068");
    const hand = state.players.p1.hand.length;
    const { state: after, events } = mustApply(state, use("Aerial Draw"));
    expect(after.players.p1.hand.length).toBe(hand + 1);
    expect(all(events, "ABILITY_USED").map((e) => e.ability)).toEqual(["Aerial Draw"]);
    expectErr(state, use("Hurried Gait"), "NO_SUCH_ABILITY");
    expectErr(after, use("Aerial Draw"), "ABILITY_ALREADY_USED");
  });

  it("Nidorina: \"Share Happiness\" heals 30 from 1 of your Pokémon; \"Confectionary Gift\" is no such Ability", () => {
    // Nidorina alone in play, so the one-target `healChosen` resolves with no pick.
    let state = setActiveFromDeck(turnOf("p1"), "p1", "mep-101");
    state = clearBench(state, "p1");
    state = setDamage(state, "p1", 50);
    const active = { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Share Happiness" } as const;
    expectErr(state, { ...active, abilityName: "Confectionary Gift" }, "NO_SUCH_ABILITY");
    const { state: next, events } = mustApply(state, active);
    expect(all(events, "ABILITY_USED").map((e) => e.ability)).toEqual(["Share Happiness"]);
    expect(all(events, "HEALED").map((e) => e.amount)).toEqual([30]);
    expect(next.players.p1.active?.damage).toBe(20);
  });
});

describe("D584 §4 — the parameter copies carry the PRINTED number and status", () => {
  it("Pyroar: Bite's 30 is debuffed by 30 (Entei's Pressure: by 20)", () => {
    const pyroar = all(mustApply(fight("me01-024"), BITE).events, "DAMAGE_DEALT");
    expect(pyroar[0]).toMatchObject({ seat: "p2", dealt: 0, debuff: 30 });
    const entei = all(mustApply(fight("sv03-030"), BITE).events, "DAMAGE_DEALT");
    expect(entei[0]).toMatchObject({ seat: "p2", dealt: 10, debuff: 20 });
  });

  it("Slowpoke: Confuse Ray is prevented (the control Filler is Confused)", () => {
    const action = { type: "attack", seat: "p1", index: 1 } as const; // Confuse Ray
    const slowpoke = mustApply(fight("mep-086"), action).events;
    expect(all(slowpoke, "STATUS_PREVENTED").map((e) => [e.seat, e.status])).toEqual([["p2", "confused"]]);
    expect(all(slowpoke, "STATUS_APPLIED")).toEqual([]);
    const control = mustApply(fight(FILLER), action).events;
    expect(all(control, "STATUS_APPLIED").map((e) => [e.seat, e.status])).toEqual([["p2", "confused"]]);
  });
});

describe("D584 §5 — Drifloon's \"Float Up\" (attack index 0)", () => {
  function drifloon(): GameState {
    let state = setActiveFromDeck(turnOf("p1"), "p1", "30th-073");
    state = attachFromDeck(state, "p1", PSYCHIC, 1);
    return setActiveFromDeck(state, "p2", FILLER);
  }
  const FLOAT_UP = { type: "attack", seat: "p1", index: 0 } as const;
  const confirm = (yes: boolean) => ({ type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } }) as const;

  it("is declared under its printed name, deals 20, and asks the printed \"You may\"", () => {
    const { state, events } = mustApply(drifloon(), FLOAT_UP);
    expect(all(events, "ATTACK_DECLARED").map((e) => [e.attack, e.index])).toEqual([["Float Up", 0]]);
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ seat: "p2", dealt: 20 });
    expect(JSON.stringify(state.phase)).toContain(text("30th-073"));
  });

  it("yes: Drifloon and its Energy go into the deck; no: it stays Active", () => {
    const parked = mustApply(drifloon(), FLOAT_UP).state;
    const uid = parked.players.p1.active?.stack.at(-1) ?? "";
    const yes = mustApply(parked, confirm(true)).state;
    expect(yes.players.p1.deck).toContain(uid);
    const no = mustApply(parked, confirm(false)).state;
    expect(no.players.p1.active?.stack.at(-1)).toBe(uid);
  });
});
