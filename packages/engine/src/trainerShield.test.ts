import { describe, expect, it } from "vitest";
import { passivesOf, seatShieldedFromSupporterEffects } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  FIXTURE_POOL,
  TRAINER_SHIELD_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const UNNERVE_TEXT =
  "Whenever your opponent plays an Item or Supporter card from their hand, prevent all effects of that card done to this Pokémon.";
const WIDE_WALL_TEXT =
  "As long as this Pokémon is in the Active Spot, whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to all of your Pokémon.";

function board(holderId: string, benchIds: readonly string[]): GameState {
  let state = driveSetup(1, { p1: TRAINER_SHIELD_DECK, p2: TRAINER_SHIELD_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", holderId);
  state = clearBench(state, "p2");
  for (const id of benchIds) state = benchFromDeck(state, "p2", id);
  state = attachFromDeck(state, "p2", "fix-energy", 1);
  for (let i = 0; i < benchIds.length; i++) {
    state = attachBenchFromDeck(state, "p2", i, "fix-energy", 1);
  }
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return setActiveFromDeck(state, "p1", "fix-bigbody");
}

/** P1 plays `cardId` out of hand. Returns the resulting state, its events and the
    prompt kind if it parked — the three things every case below reads. */
function play(state: GameState, cardId: string) {
  const withCard = handFromDeck(state, "p1", cardId, 1);
  const { state: next, events } = mustApply(withCard, {
    type: "playTrainer",
    seat: "p1",
    uid: handUid(withCard, "p1", cardId),
  });
  return { state: next, events, phase: next.phase.kind };
}

function prevented(events: readonly GameEvent[]): GameEvent[] {
  return events.filter((e) => e.type === "TRAINER_EFFECT_PREVENTED");
}

function offered(state: GameState): string[] {
  if (state.phase.kind !== "effect:choose") return [];
  const prompt = state.phase.prompt;
  const refs =
    prompt.kind === "choosePokemon"
      ? prompt.candidates
      : prompt.kind === "discardEnergy"
        ? prompt.discardable.map((c) => c.from)
        : [];
  return refs.map((ref) => (ref.spot.spot === "active" ? "active" : `bench:${ref.spot.index}`));
}

function energyCount(state: GameState, seat: "p1" | "p2", index: number | "active"): number {
  const side = state.players[seat];
  const body = index === "active" ? side.active : side.bench[index];
  return body?.energy.length ?? 0;
}

describe("the registry data rows — 4 + 1 on two sentences", () => {
  it("authors the FOUR holder-rule printings as one shared bare passive", () => {
    for (const id of ["sv06.5-045", "sv06.5-077", "sv10-065", "sv10-210"]) {
      expect(programFor(id)?.passive, id).toEqual({ preventTrainerEffects: true });
    }
    // One printed sentence, one object — the reprints are not separate rows.
    expect(programFor("sv06.5-077")).toBe(programFor("sv06.5-045"));
    expect(programFor("sv10-210")).toBe(programFor("sv10-065"));
    expect(programFor("sv10-065")).toBe(programFor("sv06.5-045"));
  });

  it("authors the ONE seat-rule printing as its own field", () => {
    expect(programFor("sv07-076")?.passive).toEqual({
      preventSupporterEffectsWhileActive: true,
    });
  });

  it("keeps the two fields disjoint — neither sentence sets the other's flag", () => {
    expect(programFor("sv06.5-045")?.passive?.preventSupporterEffectsWhileActive).toBeUndefined();
    expect(programFor("sv07-076")?.passive?.preventTrainerEffects).toBeUndefined();
  });

  it("authors NO attack program on any of the five printings", () => {
    for (const id of ["sv06.5-045", "sv06.5-077", "sv10-065", "sv10-210", "sv07-076"]) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  it("authors nothing on the sibling prevention rows", () => {
    for (const id of ["sv05-024", "sv06-020", "sv10.5b-023", "sv07-044", "sv03-070"]) {
      expect(programFor(id)?.passive?.preventTrainerEffects, id).toBeUndefined();
      expect(programFor(id)?.passive?.preventSupporterEffectsWhileActive, id).toBeUndefined();
    }
  });

  it("has exactly ONE fixture demonstrator per sentence", () => {
    const holders = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventTrainerEffects === true,
    );
    expect(holders).toEqual(["fix-unnerve"]);
    const seats = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventSupporterEffectsWhileActive === true,
    );
    expect(seats).toEqual(["fix-widewall"]);
    expect(programFor("fix-unnerve")).toBe(programFor("sv06.5-045"));
    expect(programFor("fix-widewall")).toBe(programFor("sv07-076"));
  });

  it("the fixture bodies print the real sentences", () => {
    expect(FIXTURE_POOL["fix-unnerve"]?.abilities?.[0]?.effect).toBe(UNNERVE_TEXT);
    expect(FIXTURE_POOL["fix-widewall"]?.abilities?.[0]?.effect).toBe(WIDE_WALL_TEXT);
  });
});

describe("the fold and the scan — the two predicates", () => {
  it("passivesOf folds the holder rule wherever the holder stands", () => {
    const active = board("fix-unnerve", ["fix-titan"]);
    const activeBody = active.players.p2.active;
    if (activeBody === null) throw new Error("board");
    expect(passivesOf(active, activeBody).preventTrainerEffects).toBe(true);

    const benched = board("fix-titan", ["fix-unnerve"]);
    const benchedBody = benched.players.p2.bench[0];
    if (benchedBody === undefined) throw new Error("board");
    expect(passivesOf(benched, benchedBody).preventTrainerEffects).toBe(true);
    expect(passivesOf(benched, benchedBody).preventDamageAndEffectsWhileBenched).toBe(false);
  });

  it("the fold does NOT reach a teammate — it is a HOLDER rule", () => {
    const state = board("fix-unnerve", ["fix-titan"]);
    const teammate = state.players.p2.bench[0];
    if (teammate === undefined) throw new Error("board");
    expect(passivesOf(state, teammate).preventTrainerEffects).toBe(false);
  });

  it("the seat scan is TRUE from the Active Spot and FALSE from the Bench", () => {
    expect(seatShieldedFromSupporterEffects(board("fix-widewall", ["fix-titan"]), "p2")).toBe(true);
    expect(seatShieldedFromSupporterEffects(board("fix-titan", ["fix-widewall"]), "p2")).toBe(
      false,
    );
  });

  it("the seat scan answers about the SEAT, so the other side is untouched", () => {
    const state = board("fix-widewall", ["fix-titan"]);
    expect(seatShieldedFromSupporterEffects(state, "p1")).toBe(false);
  });

  it("an empty Active Spot is not a source", () => {
    const state = board("fix-widewall", ["fix-titan"]);
    const emptied: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(seatShieldedFromSupporterEffects(emptied, "p2")).toBe(false);
  });
});

describe("the ITEM half — Crushing Hammer's opponentChosen discard", () => {
  it("drops ONLY the shielded body from the candidate set", () => {
    const start = board("fix-titan", ["fix-unnerve", "fix-titan"]);
    const { state, events } = play(start, "fix-hammer");
    expect(offered(state)).toEqual(["active", "bench:1"]);
    expect(prevented(events)).toHaveLength(1);
    expect(prevented(events)[0]).toMatchObject({ seat: "p2", trainerType: "item" });
  });

  it("shields a BENCHED holder, which no attack-borne board could reach", () => {
    const start = board("fix-titan", ["fix-unnerve", "fix-titan"]);
    const { state } = play(start, "fix-hammer");
    expect(offered(state)).toEqual(["active", "bench:1"]);
  });

  // The ACTIVE holder, and the one survivor auto-resolves — so the assertion is
  // on the BOARD: the shielded Active keeps its Energy, the bench body loses one.
  it("shields an ACTIVE holder too — the sentence prints no zone", () => {
    const start = board("fix-unnerve", ["fix-titan"]);
    const { state, events } = play(start, "fix-hammer");
    expect(prevented(events)).toHaveLength(1);
    expect(energyCount(state, "p2", "active")).toBe(1);
    expect(energyCount(state, "p2", 0)).toBe(0);
  });

  it("Wide Wall does NOT stop an Item — the trigger narrowing is real", () => {
    const { state, events } = play(board("fix-widewall", ["fix-titan"]), "fix-hammer");
    expect(prevented(events)).toEqual([]);
    expect(offered(state)).toEqual(["active", "bench:0"]);
  });

  // §7's whiff gate, and the ruling that keeps the card PLAYABLE. Every candidate
  // is shielded, so the play is legal, resolves, files no discard and moves no
  // Energy — "blocked by an effect in play", not by the game state.
  it("a fully shielded board whiffs the Item without rejecting the play", () => {
    const start = board("fix-unnerve", ["fix-unnerve"]);
    const before = energyCount(start, "p2", "active") + energyCount(start, "p2", 0);
    const { state, events, phase } = play(start, "fix-hammer");
    expect(phase).not.toBe("effect:choose");
    expect(prevented(events)).toHaveLength(2);
    expect(energyCount(state, "p2", "active") + energyCount(state, "p2", 0)).toBe(before);
  });

  it("announces ONE row for a body carrying three Energy", () => {
    let start = board("fix-unnerve", ["fix-titan"]);
    start = attachFromDeck(start, "p2", "fix-energy", 2);
    expect(energyCount(start, "p2", "active")).toBe(3);
    const { events } = play(start, "fix-hammer");
    expect(prevented(events)).toHaveLength(1);
  });
});

describe("the SUPPORTER half — Boss's Orders' gust", () => {
  it("drops a shielded benched body from the gust's candidate set", () => {
    const start = board("fix-titan", ["fix-unnerve", "fix-titan", "fix-titan"]);
    const { state, events } = play(start, "sv02-172");
    expect(offered(state)).toEqual(["bench:1", "bench:2"]);
    expect(prevented(events)).toHaveLength(1);
    expect(prevented(events)[0]).toMatchObject({ seat: "p2", trainerType: "supporter" });
  });

  it("Wide Wall shields the WHOLE Bench from a Supporter", () => {
    const start = board("fix-widewall", ["fix-titan", "fix-titan"]);
    const { state, events, phase } = play(start, "sv02-172");
    expect(phase).not.toBe("effect:choose");
    expect(prevented(events)).toHaveLength(2);
    // The gust never happened: P2's Active is still the wall.
    expect(state.cardIdByUid[state.players.p2.active?.stack[0] ?? ""]).toBe("fix-widewall");
  });

  // …and the zone negative, which is the other half of that sentence.
  it("a BENCHED Wide Wall shields nothing at all", () => {
    const start = board("fix-titan", ["fix-widewall", "fix-titan"]);
    const { state, events } = play(start, "sv02-172");
    expect(prevented(events)).toEqual([]);
    expect(offered(state)).toEqual(["bench:0", "bench:1"]);
  });

  it("the holder rule also stops a Supporter — it names BOTH card types", () => {
    const start = board("fix-titan", ["fix-unnerve"]);
    const { events, phase } = play(start, "sv02-172");
    expect(phase).not.toBe("effect:choose");
    expect(prevented(events)).toHaveLength(1);
  });
});

describe("the boundaries — what the channel must NOT refuse", () => {
  it("your own Trainer is not refused by your own shield", () => {
    let state = driveSetup(
      1,
      { p1: TRAINER_SHIELD_DECK, p2: TRAINER_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-widewall");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-unnerve");
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1);
    // P2 has nothing to gust, so drive the ITEM at P1's own shielded bench body:
    // `fix-hammer` aims at the OPPONENT, so instead assert the seat test directly
    // — P1's own bodies are on `ctx.seat` and the channel skips them.
    const own = state.players.p1.bench[0];
    if (own === undefined) throw new Error("board");
    expect(passivesOf(state, own).preventTrainerEffects).toBe(true);
    expect(seatShieldedFromSupporterEffects(state, "p1")).toBe(true);
    const { events } = play(state, "sv02-172");
    expect(prevented(events)).toEqual([]);
  });

  it("labels a played Item's program as a Trainer: `invokedBy` is `item`", () => {
    const state = board("fix-unnerve", ["fix-titan"]);
    // Nothing in this deck has a parking Ability; the claim is about the setter,
    // and cardplay.ts labels ONLY the trainer call. A grep-shaped assertion would
    // be vacuous, so drive the positive instead: a played Item IS labelled.
    const twoTargets = board("fix-titan", ["fix-titan"]);
    const withCard = handFromDeck(twoTargets, "p1", "fix-hammer", 1);
    const { state: parked } = mustApply(withCard, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(withCard, "p1", "fix-hammer"),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.ctx.invokedBy).toBe("item");
    expect(state.players.p2.active).not.toBeNull();
  });

  it("Klefki's Ability lock switches BOTH shields off", () => {
    let state = board("fix-unnerve", ["fix-titan"]);
    state = setActiveFromDeck(state, "p1", "sv01-096");
    const shielded = state.players.p2.active;
    if (shielded === null) throw new Error("board");
    expect(passivesOf(state, shielded).preventTrainerEffects).toBe(false);
    const { events } = play(state, "fix-hammer");
    expect(prevented(events)).toEqual([]);

    let wall = board("fix-widewall", ["fix-titan"]);
    wall = setActiveFromDeck(wall, "p1", "sv01-096");
    expect(seatShieldedFromSupporterEffects(wall, "p2")).toBe(false);
  });
});

describe("the record and the wire", () => {
  it("a park carrying the widened invokedBy still resolves from a frozen state", () => {
    const start = deepFreeze(board("fix-titan", ["fix-unnerve", "fix-titan"]));
    const { state: parked } = play(start, "fix-hammer");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const pick = prompt.discardable[0];
    if (pick === undefined) throw new Error("no candidate");
    const { state: done } = mustApply(deepFreeze(parked), {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick.uid] },
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    // The shielded body kept its Energy; the pick came off somebody else.
    expect(energyCount(done, "p2", 0)).toBe(1);
  });

  it("renders a readable row naming the card TYPE", async () => {
    const { logFromEvents } = await import("./log");
    const render = (result: { state: GameState; events: GameEvent[] }) =>
      logFromEvents(result.events, {
        names: { p1: "P1", p2: "P2" },
        state: result.state,
        elapsed: "+00:10",
      })
        .flatMap((r) => (r.kind === "action" ? [r.segments.map((seg) => seg.text).join("")] : []))
        .join("\n");

    expect(render(play(board("fix-unnerve", ["fix-titan"]), "fix-hammer"))).toContain(
      "prevented the effect of the Item",
    );
    expect(render(play(board("fix-widewall", ["fix-titan"]), "sv02-172"))).toContain(
      "prevented the effect of the Supporter",
    );
  });

  it("consumes no rng — the whole suite is seed-free", () => {
    const start = board("fix-titan", ["fix-unnerve", "fix-titan"]);
    const { state } = play(start, "sv02-172");
    expect(state.rngState).toBe(start.rngState);
  });
});
