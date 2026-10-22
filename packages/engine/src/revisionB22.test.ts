import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { battler, completeSetup, deckOf, trainerCard, typedEnergy } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

// ── CARD REVISION, BATCH B22 (Attacks) ──
//
// The verified finding from the per-unit audit (docs/reference/card-revision.md "B22"), driven on a
// real board through `applyAction` and asserted against the PRINTED text (local D1 `cards.attacks_json`,
// byte for byte below):
//   §1 Mamoswine "Wreck" (`me02-025`), Mega Hawlucha ex "Somersault Dive" (`me02.5-116` / `-268` /
//      `-283`), Chi-Yu "Ground Melter" (`sv06-039`) — *"… Then, discard that Stadium."* — and
//      Eternatus "World Ender" (`sv08-141`) — *"Discard a Stadium in play. …"*. The state was right
//      (the Stadium reached its OWNER's discard pile, the zone emptied), but the `discardStadium` op
//      reused `playStadium`'s `STADIUM_DISCARDED` event and the log rendered every one of those rows as
//      "<Stadium> left play — replaced" — on a board where nothing replaced it. The event now carries a
//      `cause` ("replaced" | "effect") and the log words each one.
//   §2 the control: a Stadium REPLACED by a different-named one played from hand still says "replaced".

const WRECK =
  "If a Stadium is in play, this attack does 120 more damage. Then, discard that Stadium.";
const SOMERSAULT =
  "If a Stadium is in play, this attack does 140 more damage. Then, discard that Stadium.";
const GROUND_MELTER =
  "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.";
const WORLD_ENDER = "Discard a Stadium in play. If you can't, this attack does nothing.";
const LEVINCIA_TEXT =
  "Once during each player's turn, that player may put up to 2 Basic {L} Energy cards from their discard pile into their hand.";
const GRAVITY_TEXT = "Each Stage 2 Pokémon in play (both yours and your opponent's) gets -30 HP.";

const LEVINCIA = "sv09-150";
const GRAVITY = "sv08-177";
const FILLER = "b22-filler";
const C = "b22-colorless";

const ATTACKERS = [
  {
    id: "me02-025",
    name: "Mamoswine",
    stage: "Stage2",
    attack: "Wreck",
    text: WRECK,
    damage: "120+",
    extra: 120,
  },
  {
    id: "me02.5-116",
    name: "Mega Hawlucha ex",
    attack: "Somersault Dive",
    text: SOMERSAULT,
    damage: "120+",
    extra: 140,
  },
  {
    id: "me02.5-268",
    name: "Mega Hawlucha ex",
    attack: "Somersault Dive",
    text: SOMERSAULT,
    damage: "120+",
    extra: 140,
  },
  {
    id: "me02.5-283",
    name: "Mega Hawlucha ex",
    attack: "Somersault Dive",
    text: SOMERSAULT,
    damage: "120+",
    extra: 140,
  },
  {
    id: "sv06-039",
    name: "Chi-Yu",
    attack: "Ground Melter",
    text: GROUND_MELTER,
    damage: "60+",
    extra: 60,
  },
  {
    id: "sv08-141",
    name: "Eternatus",
    attack: "World Ender",
    text: WORLD_ENDER,
    damage: 230,
    extra: 0,
  },
] as const;

const TAP = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    ATTACKERS.map((a) => [
      a.id,
      battler(a.id, {
        name: a.name,
        hp: 300,
        ...("stage" in a ? { stage: a.stage } : {}),
        // Every attacker pays a single {C}: the cost is not the claim, the discard is.
        attacks: [{ cost: ["Colorless"], name: a.attack, effect: a.text, damage: a.damage }],
      }),
    ]),
  ),
  [LEVINCIA]: { ...trainerCard(LEVINCIA, "Stadium", LEVINCIA_TEXT), name: "Levincia" },
  [GRAVITY]: { ...trainerCard(GRAVITY, "Stadium", GRAVITY_TEXT), name: "Gravity Mountain" },
  [FILLER]: battler(FILLER, { name: "B22 Filler", hp: 400, types: ["Colorless"], attacks: TAP }),
  [C]: typedEnergy(C, "Colorless"),
};

const DECK = deckOf({ [FILLER]: 20, [C]: 40 });
const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

/** P1's turn 3 (past the §4 first-turn ban) on a 60-card filler deck. */
function base(): GameState {
  const created = createGame({ seed: 2222, decks: { p1: DECK, p2: DECK }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

/** TEST SURGERY — P1's Active is `attacker` with one {C}, P2's Active a 400-HP Filler, the Stadium
    `stadium` (owned by `owner`) in the zone, and P1's hand `hand`. Fresh uids for every card placed. */
function table(
  attacker: string,
  stadium: { id: string; owner: Seat } | null,
  hand: readonly string[] = [],
) {
  const state: GameState = JSON.parse(JSON.stringify(base()));
  let n = 0;
  const alloc = (id: string): string => {
    const uid = `b22#${n++}`;
    state.cardIdByUid[uid] = id;
    const card = LOCAL[id];
    if (card === undefined) throw new Error(`no local face for ${id}`);
    state.cardPool = { ...state.cardPool, [id]: card };
    return uid;
  };
  const body = (id: string, energy: readonly string[]): InPlayPokemon => ({
    ...makeInPlay(alloc(id), 1),
    energy: energy.map(alloc),
  });
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    state.players[seat] = {
      ...side,
      active: seat === "p1" ? body(attacker, [C]) : body(FILLER, []),
      bench: [],
      hand: seat === "p1" ? hand.map(alloc) : [],
      discard: [],
      deck: Array.from({ length: 10 }, () => alloc(FILLER)),
    };
  }
  const stadiumUid = stadium === null ? null : alloc(stadium.id);
  state.stadium =
    stadium === null || stadiumUid === null ? null : { uid: stadiumUid, owner: stadium.owner };
  return { state, stadiumUid };
}

function must(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok)
    throw new Error(`${action.type} rejected: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
function render(events: readonly GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

const attack: GameAction = { type: "attack", seat: "p1", index: 0 };

// ─────────────────────────────────────────────────────────────────────────────

describe("B22 §1 — an attack that discards the Stadium logs a DISCARD, not a replacement", () => {
  for (const a of ATTACKERS) {
    for (const [stadiumId, stadiumName, owner] of [
      [LEVINCIA, "Levincia", "p1"],
      [GRAVITY, "Gravity Mountain", "p2"],
    ] as const) {
      it(`${a.id} "${a.attack}" on ${stadiumName} (owned by ${owner}): the zone empties, the OWNER's pile gains it, and the row says it was discarded`, () => {
        const { state: board, stadiumUid } = table(a.id, { id: stadiumId, owner });
        const { state, events } = must(board, attack);
        // The state half was already right; pinned so a log-only fix cannot regress it.
        expect(state.stadium).toBeNull();
        expect(state.players[owner].discard).toContain(stadiumUid);
        // …and the printed damage landed (the "more damage" read the Stadium BEFORE it left).
        expect(state.players.p2.active?.damage).toBe(
          (typeof a.damage === "number" ? a.damage : Number.parseInt(a.damage, 10)) + a.extra,
        );
        expect(ofType(events, "STADIUM_DISCARDED")).toEqual([
          { type: "STADIUM_DISCARDED", seat: owner, uid: stadiumUid, cause: "effect" },
        ]);
        const texts = render(events, state).map((r) => r.text);
        expect(texts).toContain(`${stadiumName} was discarded`);
        expect(texts.some((t) => t.includes("replaced"))).toBe(false);
      });
    }
  }
});

describe("B22 §2 — the control: a Stadium replaced from hand still logs a replacement", () => {
  it("Levincia (p2's) replaced by P1's Gravity Mountain: one STADIUM_DISCARDED with cause \"replaced\", worded as such", () => {
    const { state: board, stadiumUid } = table(FILLER, { id: LEVINCIA, owner: "p2" }, [GRAVITY]);
    const gravity = board.players.p1.hand[0];
    if (gravity === undefined) throw new Error("no Gravity Mountain in hand");
    const { state, events } = must(board, { type: "playTrainer", seat: "p1", uid: gravity });
    expect(state.stadium).toEqual({ uid: gravity, owner: "p1" });
    expect(state.players.p2.discard).toContain(stadiumUid);
    expect(ofType(events, "STADIUM_DISCARDED")).toEqual([
      { type: "STADIUM_DISCARDED", seat: "p2", uid: stadiumUid, cause: "replaced" },
    ]);
    expect(render(events, state).map((r) => r.text)).toContain("Levincia left play — replaced");
  });
});
