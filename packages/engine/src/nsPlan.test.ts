import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import { redactGame } from "./redact";
import {
  NS_PLAN_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// D226 — N's PLAN, and the SINGLE-SOURCE COUPLING it lifts.
//
// "Move up to 2 Energy from your Benched Pokémon to your Active Pokémon."
//
// ⚠️ **THE LAST OF D190's FOUR `DROPPED` WORK ORDERS** (D221 Teal Dance, D222
// Flashing Draw, D223 Carmine, and this). **3 Standard-legal printings** —
// `sv10.5b-083`, `sv10.5b-163`, `sv10.5b-170`, all regulation mark **I**, all
// `legal_standard = 1`, one distinct `effect` string across the three (remote D1
// `luminous`, `735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 2026-08-05).
//
// ⚠️ **THE WORD THAT COSTS IS "Pokémon", AND IT IS PLURAL.** Every other printed
// member of this family says "from **1 of** your Pokémon" (Energy Switch, Poppy,
// Armarouge's "Fire Off", Exp. Share), and `cardplay.ts`'s wire validator enforced
// it verbatim — *"every Energy must come from the same Pokémon"*. So the ordinary
// use of this card, one Energy off each of two benched bodies, was a legal paper
// play and a REJECTED WIRE MESSAGE. Authoring the route without the rider would
// have shipped a card that is legal to play and impossible to answer: the *EXACT
// MAP OR FLAG* doctrine's own case, and the reason D190 dropped the row.
//
// ⚠️ **AND THE COUPLING HAD NEVER BEEN OBSERVABLE ON A PRINTED CARD BEFORE.**
// Armarouge is the only other `benchToActive` printing and it is `max: 1` — one
// pick has one source however the rule reads. Poppy is `max: 2` and free-route, so
// it is the one card that CAN express a two-source answer, which is exactly why it
// is the control on every board below rather than Energy Switch (`max: 1`, where a
// two-source answer is refused first, by the count rule, for a different reason).
//
// ⚠️ WHAT THIS SUITE CAN PUT RED, SAID UP FRONT (the guard rule, conventions.md):
// * Dropping `anySource` from the op, the prompt, the wire schema, `redact.ts` or
//   `projection.ts` fails the two-source play, the wire pin or the round-trip pin.
// * DELETING the coupling in `cardplay.ts` instead of making it conditional fails
//   the POPPY control, which is driven on the same board through the same op.
// * Keeping the coupling fails the two-source play outright.
// * Emitting ONE `ENERGY_MOVED` for a two-source move fails the events pin — and
//   that row would be a lie, since the event's doc promises all its uids share
//   `from` and the log renders it literally.
// * Hard-coding "1 of" back into `moveNote` fails the printed-bytes pin.
// * Authoring the rider WITHOUT `route: "benchToActive"` fails the movable-set pin
//   (the Active's Energy would be offered, which the print does not allow).

/** The three Standard-legal printings, measured 2026-08-05. */
const NS_PLAN_IDS = ["sv10.5b-083", "sv10.5b-163", "sv10.5b-170"] as const;

/** The printed effect, byte for byte (D183 — author against the print, never a
    paraphrase). `moveNote` reproduces it exactly, which is the pin below. */
const NS_PLAN_TEXT = "Move up to 2 Energy from your Benched Pokémon to your Active Pokémon.";

const decks = { p1: NS_PLAN_DECK, p2: NS_PLAN_DECK };
const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const P1_BENCH0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
const P1_BENCH1: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 1 } };

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}
function benchEnergy(state: GameState, seat: "p1" | "p2", index: number): string[] {
  return [...(state.players[seat].bench[index]?.energy ?? [])];
}

/** P1's turn 2 (P2 went first and passed) — their first unrestricted turn, so a
    Supporter is legal. */
function p1Turn(seed: number): GameState {
  return mustApply(driveSetup(seed, decks, { first: "p2" }), {
    type: "endTurn",
    seat: "p2",
  }).state;
}

/** The board this card is printed for: a bare Active (`fix-basic-1`) and TWO
    benched bodies (`fix-basic-2`) each carrying one Basic Energy of its own type,
    so a two-source answer is expressible and each moved uid is traceable to the
    body it came off. */
function twoSourceBoard(seed: number): GameState {
  let state = p1Turn(seed);
  state = setActiveFromDeck(state, "p1", "fix-basic-1");
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
  state = benchFromDeck(state, "p1", "fix-basic-2"); // index 0
  state = benchFromDeck(state, "p1", "fix-basic-2"); // index 1
  state = attachBenchFromDeck(state, "p1", 0, "fix-fire-energy", 1);
  state = attachBenchFromDeck(state, "p1", 1, "fix-water-energy", 1);
  return state;
}

/** Play `cardId` out of p1's hand and require it to PARK on a moveEnergy prompt. */
function park(state: GameState, cardId: string): GameState {
  const armed = handFromDeck(state, "p1", cardId, 1);
  const parked = mustApply(armed, {
    type: "playTrainer",
    seat: "p1",
    uid: handUid(armed, "p1", cardId),
  }).state;
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (parked.phase.prompt.kind !== "moveEnergy") throw new Error("expected a moveEnergy prompt");
  return parked;
}

type MovePrompt = Extract<
  Extract<GameState["phase"], { kind: "effect:choose" }>["prompt"],
  { kind: "moveEnergy" }
>;

function movePrompt(state: GameState): MovePrompt {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "moveEnergy") {
    throw new Error("not parked on a moveEnergy prompt");
  }
  return state.phase.prompt;
}

describe("D226 — N's Plan: the registry rows and the printed prompt", () => {
  it("every Standard-legal printing resolves the SAME program, and it is the two fields", () => {
    const first = programFor(NS_PLAN_IDS[0]);
    expect(first).toBeDefined();
    for (const id of NS_PLAN_IDS) expect(programFor(id)).toBe(first);
    expect(first?.trainer).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: 2,
        route: "benchToActive",
        anySource: true,
      },
    ]);
  });

  it("the prompt note is the PRINTED BYTES — the plural is what `anySource` spells", () => {
    const parked = park(twoSourceBoard(1), "fix-nsplan");
    expect(movePrompt(parked).note).toBe(NS_PLAN_TEXT);
    // …and the coupled sibling on the SAME route keeps its article, so the note is
    // reading the rider rather than the route. (Armarouge, `benchToActive`,
    // max 1 — "Move a Fire Energy from 1 of your Benched Pokémon to your Active
    // Pokémon."; the only printed difference is "1 of".)
    expect(NS_PLAN_TEXT.includes("from your Benched Pokémon")).toBe(true);
    expect(NS_PLAN_TEXT.includes("1 of")).toBe(false);
  });

  it("offers the BENCH as sources and the ACTIVE as the sole destination (the route)", () => {
    let state = twoSourceBoard(2);
    state = attachFromDeck(state, "p1", "fix-energy", 1); // Energy ON the Active
    const prompt = movePrompt(park(state, "fix-nsplan"));
    expect(prompt.anySource).toBe(true);
    expect(prompt.max).toBe(2);
    // The Active's own Energy is NOT movable — the print says "from your Benched
    // Pokémon". Without `route`, `movable` would be all three.
    expect(prompt.movable).toHaveLength(2);
    expect(prompt.movable.map((m) => m.from)).toEqual([P1_BENCH0, P1_BENCH1]);
    expect(prompt.destinations).toEqual([P1_ACTIVE]);
  });
});

describe("D226 — the two-source answer the coupling used to refuse", () => {
  it("takes one Energy off EACH benched body onto the Active, in ONE reduction", () => {
    const parked = deepFreeze(park(twoSourceBoard(3), "fix-nsplan"));
    const fire = benchEnergy(parked, "p1", 0)[0] as string;
    const water = benchEnergy(parked, "p1", 1)[0] as string;

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: fire, dest: P1_ACTIVE }, { uid: water, dest: P1_ACTIVE }] },
    });

    expect(activeEnergy(done, "p1")).toEqual([fire, water]);
    expect(benchEnergy(done, "p1", 0)).toEqual([]);
    expect(benchEnergy(done, "p1", 1)).toEqual([]);
    expect(done.phase.kind).toBe("turn:action");

    // ⚠️ ONE `ENERGY_MOVED` PER SOURCE, not one widened row. The event's own doc
    // promises every `uids` entry came off the one `from`, and `log.ts` renders
    // that literally ("moved N energy from X to Y") — so a single row naming one
    // bench body for both cards would be a false sentence in the game log. Two
    // honest rows cost no event-shape change and no `MATCH_RECORD_VERSION` move.
    const moved = find(events, "ENERGY_MOVED");
    expect(moved).toHaveLength(2);
    expect(moved.map((e) => e.uids)).toEqual([[fire], [water]]);
    expect(moved.map((e) => e.from)).toEqual([
      { spot: "bench", index: 0 },
      { spot: "bench", index: 1 },
    ]);
    for (const e of moved) expect(e.to).toEqual({ spot: "active" });
  });

  it("still takes BOTH off ONE body when the player answers that way (one row)", () => {
    // The rider WIDENS the legal answers; it does not require the wide one. Same
    // card, same prompt, two uids off a single bench body → exactly one event,
    // byte-identical to what a coupled op has always produced.
    let state = twoSourceBoard(4);
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1); // bench 0 now holds two
    const parked = park(state, "fix-nsplan");
    const [a, b] = benchEnergy(parked, "p1", 0) as [string, string];

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: a, dest: P1_ACTIVE }, { uid: b, dest: P1_ACTIVE }] },
    });
    expect(activeEnergy(done, "p1")).toEqual([a, b]);
    expect(benchEnergy(done, "p1", 0)).toEqual([]);
    const moved = find(events, "ENERGY_MOVED");
    expect(moved).toHaveLength(1);
    expect(moved[0]?.uids).toEqual([a, b]);
    expect(moved[0]?.from).toEqual({ spot: "bench", index: 0 });
  });

  it("is still DECLINABLE — the printed 'up to' is untouched by the rider", () => {
    const parked = park(twoSourceBoard(5), "fix-nsplan");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(find(events, "ENERGY_MOVED")).toHaveLength(0);
    expect(benchEnergy(done, "p1", 0)).toHaveLength(1);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("REFUSES a third Energy — `max` is the count rule and the rider is not it", () => {
    let state = twoSourceBoard(6);
    state = benchFromDeck(state, "p1", "fix-basic-1"); // index 2 — a third source
    state = attachBenchFromDeck(state, "p1", 2, "fix-energy", 1);
    const parked = park(state, "fix-nsplan");
    const uids = parked.phase.kind === "effect:choose" ? movePrompt(parked).movable : [];
    expect(uids).toHaveLength(3);
    const refused = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: uids.map((m) => m.uid).map((uid) => ({ uid, dest: P1_ACTIVE })) },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
      expect(refused.error.message).toBe("move at most 2 Energy");
    }
  });
});

describe("D226 — THE CONTROL: the coupling still holds where it is PRINTED", () => {
  it("POPPY refuses the very answer N's Plan accepts, on the same board", () => {
    // 🛑 THE ASSERTION THIS WHOLE SLICE TURNS ON. A suite that only proves the
    // plural case works cannot distinguish "the rider was added" from "the
    // coupling was deleted" — and deleting it is the cheaper, likelier mistake,
    // since the rule lived in four lines of `validateChoice`. Poppy prints "from
    // 1 of your Pokémon" and carries no rider, so the identical two-source answer
    // must still be refused, with the identical message.
    const board = twoSourceBoard(7);
    const parked = park(board, "sv03-193"); // Poppy — max 2, free route, NO rider
    const prompt = movePrompt(parked);
    expect(prompt.anySource).toBeUndefined();
    expect(prompt.max).toBe(2);
    const fire = benchEnergy(parked, "p1", 0)[0] as string;
    const water = benchEnergy(parked, "p1", 1)[0] as string;

    const refused = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: fire, dest: P1_ACTIVE }, { uid: water, dest: P1_ACTIVE }] },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
      expect(refused.error.message).toBe("every Energy must come from the same Pokémon");
    }

    // …and the SINGLE-source answer off the same prompt applies fine, so the
    // refusal above is the coupling and not an unplayable card.
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: fire, dest: P1_ACTIVE }] },
    });
    expect(activeEnergy(done, "p1")).toEqual([fire]);
  });

  it("the SELF-MOVE rule survives the rewrite — it is now per pick, same message", () => {
    // The rule used to ride on the single `source` the coupling produced, so
    // relaxing the coupling could have taken it out with it. Driven through Poppy,
    // which is the only printing whose destinations include a source (N's Plan's
    // route makes source and destination disjoint by construction, so the case is
    // unreachable there — stated rather than tested around).
    const parked = park(twoSourceBoard(8), "sv03-193");
    const fire = benchEnergy(parked, "p1", 0)[0] as string;
    const refused = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: fire, dest: P1_BENCH0 }] },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.message).toBe("cannot move a Pokémon's Energy onto itself");
    }
  });
});

describe("D226 — the wire, and the park that predates the rider", () => {
  it("`anySource` CROSSES to the answerer and survives the round-trip home", () => {
    const parked = park(twoSourceBoard(9), "fix-nsplan");
    const wire = redactGame(parked, "p1");
    if (wire.phase.kind !== "effect:choose") throw new Error("expected effect:choose on the wire");
    const wirePrompt = wire.phase.prompt;
    if (wirePrompt === null || wirePrompt.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy wire prompt");
    }
    expect(wirePrompt.anySource).toBe(true);
    expect(wirePrompt.movable).toHaveLength(2);
    expect(wirePrompt.destinations).toHaveLength(1);
    expect(wirePrompt.note).toBe(NS_PLAN_TEXT);
    // …and the OPPONENT is told nothing: this is a controller-answered kind, so
    // the answerer gate withholds it whole (unchanged by the rider, pinned so a
    // future widening of the prompt cannot leak through this arm).
    const theirs = redactGame(parked, "p2");
    if (theirs.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(theirs.phase.prompt).toBeNull();
    // The way HOME — `projectionFromRedacted` rebuilding this prompt for the
    // client — is the third read site, and it is pinned in `projection.test.ts`
    // (there, because this package must not import from `src/`).
  });

  it("A PARK WITHOUT THE KEY IS BYTE-IDENTICAL — so MATCH_RECORD_VERSION stays 12", () => {
    // 🛑 DRIVEN, NOT ARGUED. `moveEnergy` PARKS, so its prompt is embedded in the
    // persisted `GameState.phase` — the position D140's 2 → 3 bump was about. The
    // question the version doc asks is "could the PREVIOUS deploy's record be
    // misread by THIS one", so the test is whether an op that sets no rider still
    // produces the object it always did: absent, not `undefined`, in the park AND
    // on the wire. Absent reads back as the coupling, which is what a pre-D226
    // record meant. A WIDENING, not a missing required field.
    const parked = park(twoSourceBoard(10), "sv03-193"); // Poppy sets no rider
    const prompt = movePrompt(parked);
    expect(Object.keys(prompt).sort()).toEqual(["destinations", "kind", "max", "movable", "note"]);
    expect("anySource" in prompt).toBe(false);

    const wire = redactGame(parked, "p1");
    if (wire.phase.kind !== "effect:choose" || wire.phase.prompt === null) {
      throw new Error("expected a wire prompt");
    }
    expect("anySource" in wire.phase.prompt).toBe(false);
  });
});
