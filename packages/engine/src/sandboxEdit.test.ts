import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameState, SandboxDestination, SandboxEdit, Seat } from "./index";
import { logFromEvents, redactGame, redactedCardOf } from "./index";
import {
  FIXTURE_POOL,
  MIXED_DECK,
  battler,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  patchSide,
  roundTrip,
  trainerCard,
} from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const STADIUM = trainerCard("edit-stadium", "Stadium", "A test Stadium.");
const STADIUM_2 = trainerCard("edit-stadium-2", "Stadium", "Another test Stadium.");
const TOOL = trainerCard("edit-tool", "Tool", "A test Tool.");
const BIG = battler("edit-big", { name: "Big Pokémon", hp: 300 });
const POOL: Record<string, Card> = { ...FIXTURE_POOL, [STADIUM.id]: STADIUM, [TOOL.id]: TOOL };

/** p1's main phase on turn 1, with an empty Bench. */
function start(): GameState {
  const state = driveSetup(7, { p1: MIXED_DECK, p2: MIXED_DECK }, { pool: POOL, first: "p1" });
  expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
  return clearBench(state, "p1");
}

const edit = (edit: SandboxEdit, seat: Seat = "p1"): GameAction => ({
  type: "sandboxEdit",
  seat,
  edit,
});

function apply(state: GameState, e: SandboxEdit, seat: Seat = "p1") {
  return mustApply(state, edit(e, seat));
}

const firstOf = (state: GameState, seat: Seat, cardId: string, zone: "deck" | "hand") => {
  const uid = state.players[seat][zone].find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`no ${cardId} in ${zone}`);
  return uid;
};

function logText(state: GameState, events: Parameters<typeof logFromEvents>[0]): string[] {
  return logFromEvents(events, { names: { p1: "Ann", p2: "Bo" }, state, elapsed: "+00:00" }).map(
    (entry) => (entry.kind === "action" ? entry.segments.map((s) => s.text).join("") : ""),
  );
}

describe("sandboxEdit", () => {
  it("is legal only in the acting seat's own main phase", () => {
    const state = start();
    const uid = state.players.p1.hand[0] as string;
    expectErr(state, edit({ kind: "move", uid, to: { zone: "discard" } }, "p2"), "WRONG_SEAT");
    const setup = { ...state, phase: { kind: "setup:chooseFirst", coinWinner: "p1" } } as GameState;
    expectErr(setup, edit({ kind: "move", uid, to: { zone: "discard" } }), "BAD_PHASE");
  });

  it("moves a loose card between piles: the deck takes it on top, the others at the end", () => {
    const state = start();
    const uid = state.players.p1.hand[0] as string;
    const toDeck = apply(state, { kind: "move", uid, to: { zone: "deck" } });
    expect(toDeck.state.players.p1.deck[0]).toBe(uid);
    expect(toDeck.state.players.p1.hand).not.toContain(uid);
    const toDiscard = apply(toDeck.state, { kind: "move", uid, to: { zone: "discard" } });
    expect(toDiscard.state.players.p1.discard.at(-1)).toBe(uid);
    expect(toDiscard.state.players.p1.deck).not.toContain(uid);
  });

  it("a Prize leaving the Prizes also leaves the face-up list, and flipPrize toggles it", () => {
    const state = start();
    const prize = state.players.p1.prizes[0] as string;
    const up = apply(state, { kind: "flipPrize", uid: prize });
    expect(up.state.players.p1.faceUpPrizes).toEqual([prize]);
    expect(logText(up.state, up.events)[0]).toContain("face up (Prize) (edit mode)");
    const down = apply(up.state, { kind: "flipPrize", uid: prize });
    expect(down.state.players.p1.faceUpPrizes).toEqual([]);
    expect(logText(down.state, down.events)).toEqual(["turned a Prize card face down (edit mode)"]);
    const moved = apply(up.state, { kind: "move", uid: prize, to: { zone: "hand" } });
    expect(moved.state.players.p1.prizes).not.toContain(prize);
    expect(moved.state.players.p1.faceUpPrizes).toEqual([]);
    expectErr(
      state,
      edit({ kind: "flipPrize", uid: state.players.p1.hand[0] as string }),
      "EDIT_NOT_A_PRIZE",
    );
  });

  it("hidePrizes turns every face-up Prize face down in one edit", () => {
    const state = start();
    const [a, b] = state.players.p1.prizes as [string, string];
    expectErr(state, edit({ kind: "hidePrizes" }), "EDIT_NO_OP");
    const up = apply(apply(state, { kind: "flipPrize", uid: a }).state, {
      kind: "flipPrize",
      uid: b,
    });
    const down = apply(up.state, { kind: "hidePrizes" });
    expect(down.state.players.p1.faceUpPrizes).toEqual([]);
    expect(down.state.players.p1.prizes).toEqual(state.players.p1.prizes);
    expect(logText(down.state, down.events)).toEqual([
      "turned 2 Prize cards face down (edit mode)",
    ]);
  });

  it("puts a Pokémon into an empty Active Spot or onto the Bench as a fresh body", () => {
    const state = start();
    const uid = firstOf(state, "p1", "fix-basic-1", "deck");
    expectErr(state, edit({ kind: "move", uid, to: { zone: "active" } }), "EDIT_SPOT_OCCUPIED");
    const benched = apply(state, { kind: "move", uid, to: { zone: "bench" } });
    expect(benched.state.players.p1.bench).toEqual([makeInPlay(uid, state.turn)]);
    const energy = firstOf(state, "p1", "fix-energy", "deck");
    expectErr(
      state,
      edit({ kind: "move", uid: energy, to: { zone: "bench" } }),
      "EDIT_BAD_DESTINATION",
    );
  });

  it("refuses a Bench at its limit", () => {
    let state = start();
    for (let i = 0; i < 5; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
    const uid = firstOf(state, "p1", "fix-basic-0", "deck");
    expectErr(state, edit({ kind: "move", uid, to: { zone: "bench" } }), "BENCH_FULL");
  });

  it("attaches an Energy or a Tool, stacks a Pokémon with no evolution rules, refuses an Item", () => {
    const state = start();
    const onto: SandboxDestination = { zone: "onto", target: { spot: "active" } };
    const host = state.players.p1.active?.stack.at(-1) as string;
    const energy = firstOf(state, "p1", "fix-energy", "deck");
    const charged = apply(state, { kind: "move", uid: energy, to: onto });
    expect(charged.state.players.p1.active?.energy).toContain(energy);
    expect(logText(charged.state, charged.events)).toEqual([
      `moved fix-energy from the deck onto ${state.cardIdByUid[host]} (edit mode)`,
    ]);
    const tooled = apply(charged.state, { kind: "add", card: TOOL, to: onto });
    expect(tooled.state.players.p1.active?.tools).toHaveLength(1);
    const big = apply(tooled.state, { kind: "add", card: BIG, to: onto });
    const active = big.state.players.p1.active;
    expect(active?.stack).toEqual([host, "p1#e1"]);
    expect(active?.energy).toContain(energy);
    expect(big.events.map((e) => e.type)).toEqual(["SANDBOX_EDIT"]);
    expect(logText(big.state, big.events)).toEqual([
      `added Big Pokémon onto ${state.cardIdByUid[host]} (edit mode)`,
    ]);
    const item = firstOf(state, "p1", "fix-item", "deck");
    expectErr(state, edit({ kind: "move", uid: item, to: onto }), "EDIT_BAD_DESTINATION");
  });

  it("moves an in-play Pokémon with everything attached, and refuses a card under the top", () => {
    const state = start();
    const host = state.players.p1.active?.stack.at(-1) as string;
    const onto: SandboxDestination = { zone: "onto", target: { spot: "active" } };
    const energy = firstOf(state, "p1", "fix-energy", "deck");
    const built = apply(apply(state, { kind: "move", uid: energy, to: onto }).state, {
      kind: "add",
      card: BIG,
      to: onto,
    }).state;
    expectErr(built, edit({ kind: "move", uid: host, to: { zone: "hand" } }), "EDIT_NOT_TOP");
    const toHand = apply(built, { kind: "move", uid: "p1#e0", to: { zone: "hand" } });
    expect(toHand.state.players.p1.active).toBeNull();
    expect(toHand.state.players.p1.hand.slice(-3)).toEqual([host, "p1#e0", energy]);
    expect(logText(toHand.state, toHand.events)).toEqual([
      "moved Big Pokémon and 2 attached cards from the Active Spot to the hand (edit mode)",
    ]);
    const toDeck = apply(built, { kind: "move", uid: "p1#e0", to: { zone: "deck" } });
    expect(toDeck.state.players.p1.deck.slice(0, 3)).toEqual([host, "p1#e0", energy]);
  });

  it("moves bodies between spots, keeping damage, and swaps two bodies", () => {
    let state = benchFromDeck(start(), "p1", "fix-basic-1");
    state = benchFromDeck(state, "p1", "fix-basic-2");
    const side = state.players.p1;
    const body = side.active as InPlayPokemon;
    const active = body.stack[0] as string;
    const [b0, b1] = side.bench.map((each) => each.stack[0] as string) as [string, string];
    state = patchSide(state, "p1", {
      active: { ...body, damage: 30, conditions: { ...body.conditions, burned: true } },
    });
    const swapped = apply(state, {
      kind: "move",
      uid: active,
      to: { zone: "onto", target: { spot: "bench", index: 1 } },
    });
    const after = swapped.state.players.p1;
    expect(after.active?.stack[0]).toBe(b1);
    expect(after.bench.map((b) => b.stack[0])).toEqual([b0, active]);
    expect(after.bench[1]?.damage).toBe(30);
    expect(after.bench[1]?.conditions.burned).toBe(false);
    expect(logText(swapped.state, swapped.events)).toEqual([
      `swapped ${state.cardIdByUid[active]} with ${state.cardIdByUid[b1]} (edit mode)`,
    ]);
    const benchSwap = apply(state, {
      kind: "move",
      uid: b0 as string,
      to: { zone: "onto", target: { spot: "bench", index: 1 } },
    });
    expect(benchSwap.state.players.p1.bench.map((b) => b.stack[0])).toEqual([b1, b0]);
    expectErr(
      state,
      edit({ kind: "move", uid: active, to: { zone: "onto", target: { spot: "active" } } }),
      "EDIT_NO_OP",
    );
    expectErr(state, edit({ kind: "move", uid: active, to: { zone: "active" } }), "EDIT_NO_OP");
    expectErr(
      state,
      edit({ kind: "move", uid: active, to: { zone: "stadium" } }),
      "EDIT_BAD_DESTINATION",
    );

    const benchedActive = apply(state, { kind: "move", uid: active, to: { zone: "bench" } });
    expect(benchedActive.state.players.p1.active).toBeNull();
    expect(benchedActive.state.players.p1.bench.at(-1)?.damage).toBe(30);
    const promoted = apply(benchedActive.state, {
      kind: "move",
      uid: b0 as string,
      to: { zone: "active" },
    });
    expect(promoted.state.players.p1.active?.stack[0]).toBe(b0);
    expect(promoted.state.players.p1.bench.map((b) => b.stack[0])).toEqual([b1, active]);
  });

  it("puts a Stadium into play, sending the one it replaces to its owner's discard pile", () => {
    const state = start();
    const theirs = apply(
      { ...state, phase: { ...state.phase, seat: "p2" } as GameState["phase"] },
      { kind: "add", card: STADIUM, to: { zone: "stadium" } },
      "p2",
    );
    const back = { ...theirs.state, phase: state.phase };
    const p2Stadium = back.stadium?.uid as string;
    expect(back.stadium).toEqual({ uid: "p2#e0", owner: "p2" });
    const mine = apply(back, { kind: "add", card: STADIUM_2, to: { zone: "stadium" } });
    expect(mine.state.stadium).toEqual({ uid: "p1#e0", owner: "p1" });
    expect(mine.state.players.p2.discard.at(-1)).toBe(p2Stadium);
    expect(mine.state.cardPool[STADIUM_2.id]).toEqual(STADIUM_2);
    expect(mine.events.map((e) => e.type)).toEqual(["SANDBOX_EDIT", "STADIUM_DISCARDED"]);
    expectErr(back, edit({ kind: "move", uid: p2Stadium, to: { zone: "hand" } }), "EDIT_NOT_YOURS");
    const discarded = apply(back, { kind: "move", uid: p2Stadium, to: { zone: "discard" } });
    expect(discarded.state.stadium).toBeNull();
    expect(discarded.state.players.p2.discard.at(-1)).toBe(p2Stadium);
    expect(logText(discarded.state, discarded.events)[0]).toContain("to the discard pile (Bo's)");
    const item = firstOf(state, "p1", "fix-item", "deck");
    expectErr(
      state,
      edit({ kind: "move", uid: item, to: { zone: "stadium" } }),
      "EDIT_BAD_DESTINATION",
    );
  });

  it("mints the smallest unused uid and keeps a card it pooled", () => {
    const state = start();
    const first = apply(state, { kind: "add", card: BIG, to: { zone: "hand" } });
    const second = apply(first.state, { kind: "add", card: BIG, to: { zone: "discard" } });
    expect(first.state.cardIdByUid["p1#e0"]).toBe(BIG.id);
    expect(second.state.cardIdByUid["p1#e1"]).toBe(BIG.id);
    expect(second.state.players.p1.hand.at(-1)).toBe("p1#e0");
    expect(logText(first.state, first.events)).toEqual(["added a card to the hand (edit mode)"]);
    expect(logText(second.state, second.events)).toEqual([
      "added Big Pokémon to the discard pile (edit mode)",
    ]);
    expect(state.cardIdByUid["p1#e0"]).toBeUndefined();
  });

  it("removes a card or a whole Pokémon from the game, keeping its identity", () => {
    const state = benchFromDeck(start(), "p1", "fix-basic-1");
    const uid = state.players.p1.bench[0]?.stack[0] as string;
    const removed = apply(state, { kind: "remove", uid });
    expect(removed.state.players.p1.bench).toEqual([]);
    expect(removed.state.cardIdByUid[uid]).toBe("fix-basic-1");
    expect(logText(removed.state, removed.events)).toEqual([
      "removed fix-basic-1 on the Bench from the game (edit mode)",
    ]);
    const card = state.players.p1.hand[0] as string;
    const gone = apply(state, { kind: "remove", uid: card });
    expect(gone.state.players.p1.hand).not.toContain(card);
    expect(logText(gone.state, gone.events)).toEqual([
      "removed a card in the hand from the game (edit mode)",
    ]);
  });

  it("refuses a uid off the acting seat's side and every malformed edit, without throwing", () => {
    const state = deepFreeze(start());
    const theirs = state.players.p2.hand[0] as string;
    expectErr(state, edit({ kind: "move", uid: theirs, to: { zone: "hand" } }), "EDIT_UNKNOWN_UID");
    expectErr(state, edit({ kind: "remove", uid: "nope" }), "EDIT_UNKNOWN_UID");
    const junk: unknown[] = [
      undefined,
      null,
      "move",
      [],
      { kind: "bogus" },
      { kind: "move", uid: 5, to: { zone: "hand" } },
      { kind: "move", uid: theirs },
      { kind: "move", uid: theirs, to: { zone: "nowhere" } },
      { kind: "move", uid: theirs, to: { zone: "onto" } },
      { kind: "move", uid: theirs, to: { zone: "onto", target: { spot: "bench", index: "0" } } },
      { kind: "add", to: { zone: "hand" } },
      { kind: "add", card: { id: "x", name: "x" }, to: { zone: "hand" } },
      {
        kind: "add",
        card: { id: "x", name: "x", category: "Pokemon", hp: "lots" },
        to: { zone: "hand" },
      },
      {
        kind: "add",
        card: { id: "__proto__", name: "x", category: "Energy" },
        to: { zone: "hand" },
      },
      { kind: "flipPrize" },
    ];
    for (const value of junk) {
      expectErr(
        state,
        { type: "sandboxEdit", seat: "p1", edit: value } as unknown as GameAction,
        "EDIT_BAD_SHAPE",
      );
    }
    const minimal = { id: "edit-min", name: "Minimal", category: "Pokemon" } as unknown as Card;
    const added = apply(state, { kind: "add", card: minimal, to: { zone: "bench" } });
    expect(added.state.cardPool["edit-min"]?.attacks).toBeNull();
    redactGame(added.state, "p1");
  });

  it("replays deterministically through applyAction and survives a JSON round trip", () => {
    const state = start();
    const energy = firstOf(state, "p1", "fix-energy", "deck");
    const edits: SandboxEdit[] = [
      { kind: "add", card: BIG, to: { zone: "bench" } },
      { kind: "move", uid: energy, to: { zone: "onto", target: { spot: "bench", index: 0 } } },
      { kind: "move", uid: "p1#e0", to: { zone: "onto", target: { spot: "active" } } },
      { kind: "add", card: STADIUM, to: { zone: "stadium" } },
      { kind: "flipPrize", uid: state.players.p1.prizes[2] as string },
    ];
    const run = (from: GameState) =>
      edits.reduce((s, e) => roundTrip(apply(s, e).state), roundTrip(from));
    const a = run(state);
    expect(run(state)).toEqual(a);
    expect(a.players.p1.active?.stack).toEqual(["p1#e0"]);
    expect(a.players.p1.active?.energy).toEqual([energy]);
  });

  it("exposes the redacted card a viewer's discard pile shows", () => {
    const state = start();
    const uid = state.players.p1.hand[0] as string;
    const moved = apply(state, { kind: "move", uid, to: { zone: "discard" } }).state;
    const shown = redactGame(moved, "p1").board.you.discard.at(-1);
    expect(redactedCardOf(moved, uid)).toEqual(shown);
  });
});
