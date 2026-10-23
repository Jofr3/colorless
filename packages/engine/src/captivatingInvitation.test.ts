import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameState } from "./index";
import { flipCoin } from "./rng";
import { programFor } from "./registry";
import {
  CAPTIVATING_INVITATION_DECK,
  activeUid,
  benchFromDeck,
  benchTopUid,
  clearBench,
  driveSetup,
  setActiveFromDeck,
  handFromDeck,
  handUid,
  mustApply,
  types,
  findEvent,
} from "./testFixtures";

const FLORGES = "sv06-088";
const PETREL_IDS = ["sv10-176", "sv10-226"] as const;

function rngForFirstFace(want: "heads" | "tails"): number {
  for (let s = 1; s < 100_000; s++) {
    if (flipCoin(s)[0] === want) return s;
  }
  throw new Error(`no rngState produces ${want}`);
}

const HEADS = rngForFirstFace("heads");
const TAILS = rngForFirstFace("tails");

function withRng(state: GameState, rngState: number): GameState {
  return { ...state, rngState };
}

/** Setup with NO named Active, so no seed has to be hunted for a hand — every
    body this file needs is placed afterwards by `setActiveFromDeck`, which pulls
    a fresh copy out of the deck. */
function plainSetup(seed: number): GameState {
  return driveSetup(
    seed,
    { p1: CAPTIVATING_INVITATION_DECK, p2: CAPTIVATING_INVITATION_DECK },
    { first: "p1" },
  );
}

function supporterTurn(seed: number): GameState {
  const first = driveSetup(
    seed,
    { p1: CAPTIVATING_INVITATION_DECK, p2: CAPTIVATING_INVITATION_DECK },
    { first: "p2" },
  );
  return mustApply(first, { type: "endTurn", seat: "p2" }).state;
}

/** p1 on `CAPTIVATING_INVITATION_DECK` with the Ability holder ACTIVE, and the
    opponent holding `fix-incumbent` in the Active Spot with `fix-invitee` alone
    on their Bench. Turn 1, p1 to act. */
function board(seed: number): GameState {
  let state = plainSetup(seed);
  state = setActiveFromDeck(state, "p1", "fix-captivatinginvitation");
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", "fix-incumbent");
  state = clearBench(state, "p2");
  return benchFromDeck(state, "p2", "fix-invitee");
}

/** The same board with the opponent's Bench EMPTY — the one that would confuse
    the wrong body if the gate were not shared. */
function emptyBenchBoard(seed: number): GameState {
  let state = plainSetup(seed);
  state = setActiveFromDeck(state, "p1", "fix-captivatinginvitation");
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", "fix-incumbent");
  return clearBench(state, "p2");
}

const useInvitation = (state: GameState) =>
  applyAction(state, {
    type: "useAbility",
    seat: "p1",
    target: { spot: "active" },
    abilityName: "Captivating Invitation",
  });

/** The stack-top uid of an in-play body — the card that IS the Pokémon. */
function topOf(pokemon: { stack: string[] } | null | undefined): string | undefined {
  return pokemon?.stack[pokemon.stack.length - 1];
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The distinct card ids a prompt offers — what the FILTER admitted, NAMED
    rather than counted, so a filter that admits the wrong class cannot pass by
    returning the right number of candidates. */
function offered(state: GameState): Set<string> {
  return new Set(cardsPrompt(state).candidates.map((uid) => state.cardIdByUid[uid] as string));
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE REGISTRY ROWS ARE THE PRINTED BYTES
// ─────────────────────────────────────────────────────────────────────────────

describe("D330 §1 — the two programs, and the clauses they each spell", () => {
  it("Florges carries ONE activated Ability whose program is the coin gate", () => {
    const abilities = programFor(FLORGES)?.abilities;
    expect(abilities, `${FLORGES} has no abilities`).toBeDefined();
    expect(abilities).toHaveLength(1);
    const ability = abilities?.[0];
    expect(ability?.name).toBe("Captivating Invitation");
    // The printed "Once during your turn".
    expect(ability?.oncePerTurn).toBe(true);
    expect(ability?.activeOnly).toBe(false);
    expect(ability?.program).toEqual([
      {
        op: "coinFlipGate",
        then: [{ op: "gust" }, { op: "applyStatus", target: "defender", status: "confused" }],
      },
    ]);
  });

  it("BOTH ops sit INSIDE the gate — a tails flip does nothing at all", () => {
    const program = programFor(FLORGES)?.abilities?.[0]?.program;
    const gate = program?.[0];
    expect(program).toHaveLength(1);
    expect(gate?.op).toBe("coinFlipGate");
    expect(gate?.op === "coinFlipGate" ? gate.then : []).toHaveLength(2);
    // No `otherwise`: the printed sentence has no "If tails" arm.
    expect(gate?.op === "coinFlipGate" ? gate.otherwise : undefined).toBeUndefined();
    expect(gate?.op === "coinFlipGate" ? gate.onTails : undefined).toBeUndefined();
  });

  it("the ORDER is gust-then-status, which is the whole content of the row", () => {
    // Reversed, the Confusion lands on the body that is Active BEFORE the drag —
    // the opponent's incumbent — and the gust then replaces it with a clean body.
    // Both orders switch someone and Confuse someone; only one is the card.
    const then = (() => {
      const gate = programFor(FLORGES)?.abilities?.[0]?.program?.[0];
      return gate?.op === "coinFlipGate" ? gate.then : [];
    })();
    expect(then.map((op) => op.op)).toEqual(["gust", "applyStatus"]);
  });

  it("both Petrel printings share ONE program object, and it is the search", () => {
    for (const id of PETREL_IDS) {
      expect(programFor(id)?.trainer, `${id} has no trainer program`).toEqual([
        { op: "searchDeck", filter: { kind: "trainerCard" }, dest: "hand", max: 1, reveal: true },
        { op: "shuffleDeck" },
      ]);
    }
    // One shared object, not two transcriptions that could drift.
    expect(programFor("sv10-226")).toBe(programFor("sv10-176"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — CAPTIVATING INVITATION, DRIVEN THROUGH THE REAL ENGINE
// ─────────────────────────────────────────────────────────────────────────────

describe("D330 §2 — the coin-gated gust, and the body the Confusion lands on", () => {
  it("HEADS drags the BENCHED body up and Confuses THAT ONE, by uid", () => {
    const state = withRng(board(3), HEADS);
    // The two bodies, named before anything moves, so the assertion below is
    // about IDENTITY and not about which spot happens to be occupied.
    const incumbent = activeUid(state, "p2");
    const invitee = benchTopUid(state, "p2", 0);
    expect(incumbent).not.toBe(invitee);

    const { state: done, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Captivating Invitation",
    });

    // The gust really moved the board.
    expect(activeUid(done, "p2")).toBe(invitee);
    expect(done.players.p2.bench.map((p) => topOf(p))).toContain(incumbent);

    expect(done.players.p2.active?.conditions.rotation).toBe("confused");
    const benched = done.players.p2.bench.find((p) => topOf(p) === incumbent);
    expect(benched?.conditions.rotation ?? "none").toBe("none");

    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({
      seat: "p2",
      uid: invitee,
      status: "confused",
    });
    // The event ORDER is the program's order.
    const order = types(events).filter(
      (t) => t === "POKEMON_SWITCHED" || t === "STATUS_APPLIED" || t === "COIN_FLIPPED",
    );
    expect(order.indexOf("POKEMON_SWITCHED")).toBeLessThan(order.indexOf("STATUS_APPLIED"));
  });

  it("TAILS does NOTHING — no switch, and NOBODY is Confused", () => {
    const state = withRng(board(4), TAILS);
    const incumbent = activeUid(state, "p2");
    const invitee = benchTopUid(state, "p2", 0);

    const { state: done, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Captivating Invitation",
    });

    expect(activeUid(done, "p2")).toBe(incumbent);
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
    const stillBenched = done.players.p2.bench.find((p) => topOf(p) === invitee);
    expect(stillBenched?.conditions.rotation ?? "none").toBe("none");
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(types(events)).not.toContain("POKEMON_SWITCHED");
  });

  it("works from the BENCH — the printed text has no Active-Spot clause", () => {
    let state = plainSetup(5);
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = clearBench(state, "p1");
    state = setActiveFromDeck(state, "p2", "fix-incumbent");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p1", "fix-captivatinginvitation");
    state = benchFromDeck(state, "p2", "fix-invitee");
    const invitee = benchTopUid(state, "p2", 0);

    const { state: done } = mustApply(withRng(state, HEADS), {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Captivating Invitation",
    });
    expect(activeUid(done, "p2")).toBe(invitee);
    expect(done.players.p2.active?.conditions.rotation).toBe("confused");
    // p1's own Active is untouched — `defender` is the OTHER seat.
    expect(done.players.p1.active?.conditions.rotation).toBe("none");
  });

  it("an EMPTY opponent Bench REFUSES the Ability — the wrong-body arm is unreachable", () => {
    const state = withRng(emptyBenchBoard(6), HEADS);
    expect(state.players.p2.bench).toHaveLength(0);
    const incumbent = activeUid(state, "p2");
    const result = useInvitation(state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
    // And nothing moved — the refusal is before any commitment.
    expect(activeUid(state, "p2")).toBe(incumbent);
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("is ONCE per turn — and the lock is spent even on a TAILS flip", () => {
    // The printed "Once during your turn" is spent by USING the Ability, not by
    // the flip landing: the flip is procedure, not effect. A lock written on the
    // heads path would give a tails player a free retry.
    const state = withRng(board(7), TAILS);
    const { state: after } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Captivating Invitation",
    });
    const again = useInvitation(after);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ABILITY_ALREADY_USED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — TEAM ROCKET'S PETREL, AND THE FILTER THAT WAS GREEN AND DEAD
// ─────────────────────────────────────────────────────────────────────────────

describe("D330 §3 — `trainerCard`'s first printed consumer", () => {
  it("the search offers EVERY Trainer class and NO non-Trainer", () => {
    let state = supporterTurn(11);
    state = handFromDeck(state, "p1", "fix-trainersearch", 1);
    const uid = handUid(state, "p1", "fix-trainersearch");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    const ids = offered(parked);
    expect(ids).toContain("fix-trainersearch"); // Supporter
    expect(ids).toContain("fix-tool"); // Pokémon Tool
    expect(ids).toContain("fix-item"); // Item
    expect(ids).not.toContain("fix-basic-1"); // a Pokémon
    expect(ids).not.toContain("fix-energy"); // an Energy
    expect(cardsPrompt(parked).max).toBe(1);
    expect(cardsPrompt(parked).dest).toBe("hand");
    // The candidates are the actor's OWN deck — never the opponent's.
    for (const candidate of cardsPrompt(parked).candidates) {
      expect(parked.players.p1.deck).toContain(candidate);
    }
  });

  it("the chosen card reaches the HAND and the deck is shuffled after", () => {
    let state = supporterTurn(12);
    state = handFromDeck(state, "p1", "fix-trainersearch", 1);
    const uid = handUid(state, "p1", "fix-trainersearch");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    const pick = cardsPrompt(parked).candidates[0] as string;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(done.players.p1.hand).toContain(pick);
    expect(done.players.p1.deck).not.toContain(pick);
    // "Then, shuffle your deck" — the trailing op, OUTSIDE any gate.
    expect(types(events)).toContain("SHUFFLE");
    // The printed "reveal it" — the taken card is named in the log.
    expect(types(events)).toContain("DECK_SEARCHED");
    expect(done.phase.kind).not.toBe("effect:choose");
  });
});
