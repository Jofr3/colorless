import { describe, expect, it } from "vitest";
import { applyAction, engineVersion } from "./index";
import type { GameState } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  LISIAS_APPEAL_DECK,
  activeUid,
  benchFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

// ── The printed bytes, verbatim off `effect` (`sv08-179`) ───────────────────
const LISIAS_APPEAL =
  "Switch in 1 of your opponent's Benched Basic Pokémon to the Active Spot. If you do, the new Active Pokémon is now Confused.";
/** Boss's Orders `sv02-172` — the SAME sentence with the adjective removed, kept
    here so "what the adjective buys" is a diff and not an assertion. */
const BOSSS_ORDERS = "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.";

const PRINTINGS = ["sv08-179", "sv08-234", "sv08-246"] as const;

function supporterTurn(seed: number): GameState {
  const first = driveSetup(
    seed,
    { p1: LISIAS_APPEAL_DECK, p2: LISIAS_APPEAL_DECK },
    {
      first: "p2",
    },
  );
  return mustApply(first, { type: "endTurn", seat: "p2" }).state;
}

function mixedBench(seed: number): GameState {
  let state = supporterTurn(seed);
  state = setActiveFromDeck(state, "p2", "fix-incumbent");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-invitee");
  state = benchFromDeck(state, "p2", "fix-plain-body");
  return benchFromDeck(state, "p2", "fix-evolvedinvitee");
}

/** The opponent's Bench holds the STAGE 1 and NOTHING ELSE — the whiff board, and
    the one the inherited price said came for free. */
function evolutionOnlyBench(seed: number): GameState {
  let state = supporterTurn(seed);
  state = setActiveFromDeck(state, "p2", "fix-incumbent");
  state = clearBench(state, "p2");
  return benchFromDeck(state, "p2", "fix-evolvedinvitee");
}

function singleBasicBench(seed: number): GameState {
  let state = supporterTurn(seed);
  state = setActiveFromDeck(state, "p2", "fix-incumbent");
  state = clearBench(state, "p2");
  return benchFromDeck(state, "p2", "fix-invitee");
}

/** TWO Basics and no Evolution — the plain success board, benched in this order so
    `candidates[0]` is `fix-invitee`, and ≥2 so it parks. */
function basicOnlyBench(seed: number): GameState {
  let state = supporterTurn(seed);
  state = setActiveFromDeck(state, "p2", "fix-incumbent");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-invitee");
  return benchFromDeck(state, "p2", "fix-plain-body");
}

/** Put the Supporter into p1's hand and return its uid. */
function withCard(state: GameState, id = "fix-lisiasappeal"): { state: GameState; uid: string } {
  const next = handFromDeck(state, "p1", id, 1);
  return { state: next, uid: handUid(next, "p1", id) };
}

function playIt(state: GameState, uid: string) {
  return applyAction(state, { type: "playTrainer", seat: "p1", uid });
}

function choosePrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function offeredIds(state: GameState): string[] {
  const prompt = choosePrompt(state);
  return prompt.candidates
    .map((ref) => {
      const side = state.players[ref.seat];
      const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
      const uid = body?.stack[body.stack.length - 1];
      return uid === undefined ? "?" : (state.cardIdByUid[uid] as string);
    })
    .sort();
}

const SEED = 91;

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE REGISTRY ROWS ARE THE PRINTED BYTES
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 Lisia's Appeal — the program is the sentence", () => {
  it("all THREE printings resolve to one program, and it is gust+confuse with the adjective on", () => {
    for (const id of PRINTINGS) {
      expect(programFor(id)?.trainer, `${id}`).toEqual([
        { op: "gust", basicOnly: true },
        { op: "applyStatus", target: "defender", status: "confused" },
      ]);
    }
    // The three are ONE program object, not three equal literals — the reprints
    // cannot drift apart.
    expect(programFor("sv08-234")?.trainer).toBe(programFor("sv08-179")?.trainer);
    expect(programFor("sv08-246")?.trainer).toBe(programFor("sv08-179")?.trainer);
  });

  it("NO `recordAs` and NO `recordGate` — the 'If you do' is discharged elsewhere", () => {
    const ops = programFor("sv08-179")?.trainer ?? [];
    expect(ops).toHaveLength(2);
    expect(ops[0]).not.toHaveProperty("recordAs");
    expect(ops.some((op) => op.op === "recordGate")).toBe(false);
  });

  it("the adjective is the ONLY diff from Boss's Orders' sentence", () => {
    const boss = FIXTURE_POOL["sv02-172"]?.effect ?? "";
    const lisia = FIXTURE_POOL["fix-lisiasappeal"]?.effect ?? "";
    expect(boss).toBe(BOSSS_ORDERS);
    expect(lisia).toBe(LISIAS_APPEAL);
    // The adjective is an INSERTION, and the first sentence is otherwise byte-
    // identical — `startsWith` rather than `toBe` because Lisia's Appeal carries a
    // second sentence Boss's Orders does not print.
    expect(lisia.startsWith(boss.replace("Benched Pokémon", "Benched Basic Pokémon"))).toBe(true);
    // …and the ONLY thing that insertion added is the word itself.
    expect(lisia.replace("Benched Basic Pokémon", "Benched Pokémon").startsWith(boss)).toBe(true);
    expect(boss).not.toContain("Basic");
    // The remainder — everything Boss's Orders does not buy — is the second op.
    expect(lisia.slice(boss.length + " Basic".length).trim()).toBe(
      "If you do, the new Active Pokémon is now Confused.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE ADJECTIVE NARROWS THE OFFER (both directions, on one board)
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 the offer", () => {
  it("a mixed Bench offers BOTH BASICS and NOT the Stage 1 — named, not counted", () => {
    const { state, uid } = withCard(mixedBench(SEED));
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(offeredIds(parked)).toEqual(["fix-invitee", "fix-plain-body"]);
    // The Stage 1 is on that Bench and was dropped — asserted against the BOARD,
    // so this cannot pass on a board that simply never held one.
    expect(parked.players.p2.bench).toHaveLength(3);
  });

  it("ATTRIBUTION CONTROL — the SAME board under an UNRIDDEN gust offers BOTH", () => {
    const { state, uid } = withCard(mixedBench(SEED), "sv02-172");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(offeredIds(parked)).toEqual(["fix-evolvedinvitee", "fix-invitee", "fix-plain-body"]);
    // …and the two programs differ by exactly the rider.
    expect(programFor("sv02-172")?.trainer?.[0]).toEqual({ op: "gust" });
  });

  it("the prompt CAPTION carries the printed stage word, and the unridden one does not", () => {
    // The caption must name exactly the set the funnel offers, or the dialog
    // contradicts its own validator (`switchTargetNoun`'s rule one op over).
    const lisia = withCard(mixedBench(SEED));
    const lisiaParked = mustApply(lisia.state, {
      type: "playTrainer",
      seat: "p1",
      uid: lisia.uid,
    }).state;
    expect(choosePrompt(lisiaParked).note).toBe(
      "Gust up which of the opponent's Benched Basic Pokémon?",
    );
    const boss = withCard(mixedBench(SEED), "sv02-172");
    const bossParked = mustApply(boss.state, {
      type: "playTrainer",
      seat: "p1",
      uid: boss.uid,
    }).state;
    expect(choosePrompt(bossParked).note).toBe("Gust up which of the opponent's Benched Pokémon?");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE WHIFF ARM, WHICH DID **NOT** COME FOR FREE
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 the refusal — the piece the inherited price said was already shared", () => {
  it("a Bench of nothing but EVOLUTIONS refuses the card outright", () => {
    const { state, uid } = withCard(evolutionOnlyBench(SEED));
    expect(state.players.p2.bench).toHaveLength(1);
    const result = playIt(state, uid);
    expect(result.ok).toBe(false);
  });

  it("DRIVEN IN BOTH DIRECTIONS — the same board with a BASIC benched is playable", () => {
    const { state, uid } = withCard(singleBasicBench(SEED));
    expect(state.players.p2.bench).toHaveLength(1);
    const result = playIt(state, uid);
    expect(result.ok).toBe(true);
  });

  it("an EMPTY opponent Bench still refuses — the pre-existing arm is unchanged", () => {
    let state = supporterTurn(SEED);
    state = setActiveFromDeck(state, "p2", "fix-incumbent");
    state = clearBench(state, "p2");
    const staged = withCard(state);
    expect(staged.state.players.p2.bench).toHaveLength(0);
    expect(playIt(staged.state, staged.uid).ok).toBe(false);
  });

  it("THE OFFER AND THE REFUSAL ARE THE SAME SET — no board offers zero candidates", () => {
    for (const board of [mixedBench, basicOnlyBench, singleBasicBench, evolutionOnlyBench]) {
      const { state, uid } = withCard(board(SEED));
      const before = activeUid(state, "p2");
      const result = playIt(state, uid);
      if (!result.ok) continue;
      if (result.state.phase.kind === "effect:choose") {
        expect(choosePrompt(result.state).candidates.length).toBeGreaterThan(1);
      } else {
        // Forced resolve: exactly one admissible body, and it MOVED.
        expect(activeUid(result.state, "p2")).not.toBe(before);
      }
    }
  });

  it("Boss's Orders is UNAFFECTED on the Evolution-only Bench — the funnel is behaviour-preserving", () => {
    const { state, uid } = withCard(evolutionOnlyBench(SEED), "sv02-172");
    expect(playIt(state, uid).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE WHOLE SENTENCE ON A REAL BOARD
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 the resolution", () => {
  it("the Basic is promoted and THAT body — not the incumbent — is Confused", () => {
    const { state, uid } = withCard(mixedBench(SEED));
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const incumbent = activeUid(parked, "p2");
    const target = choosePrompt(parked).candidates[0];
    if (target === undefined) throw new Error("no candidate");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: target },
    });

    // The gust happened, and it moved the BASIC.
    const promoted = activeUid(done, "p2");
    expect(promoted).not.toBe(incumbent);
    expect(done.cardIdByUid[promoted as string]).toBe("fix-invitee");
    expect(findEvent(events, "POKEMON_SWITCHED")).toBeDefined();

    // "the new Active Pokémon is now Confused" — the body that MOVED, by uid.
    expect(done.players.p2.active?.conditions.rotation).toBe("confused");

    const benched = done.players.p2.bench.find((b) => b.stack[b.stack.length - 1] === incumbent);
    expect(benched).toBeDefined();
    expect(benched?.conditions.rotation ?? "none").toBe("none");
  });

  it("ORDER — the Confusion lands on the promoted body, which is only true AFTER the gust", () => {
    const { state, uid } = withCard(basicOnlyBench(SEED));
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const incumbent = activeUid(parked, "p2");
    const target = choosePrompt(parked).candidates[0];
    if (target === undefined) throw new Error("no candidate");
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: target },
    });
    const promoted = activeUid(done, "p2");
    expect(done.cardIdByUid[promoted as string]).toBe("fix-invitee");
    expect(done.players.p2.active?.conditions.rotation).toBe("confused");
    expect(promoted).not.toBe(incumbent);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE VERSION TIE AND `MATCH_RECORD_VERSION`
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 the version questions", () => {
  it("the engine minor moved for this slice, and has not gone backwards since", () => {
    const [major, minor] = engineVersion.split(".").map(Number) as [number, number, number];
    expect(major).toBe(0);
    expect(minor).toBeGreaterThanOrEqual(237);
  });

  it("D331 OWED NO `MATCH_RECORD_VERSION` BUMP, and the reason is drivable rather than argued", () => {
    const { state, uid } = withCard(mixedBench(SEED), "sv02-172");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(choosePrompt(parked).candidates).toHaveLength(3);
    expect(programFor("sv02-172")?.trainer?.[0]).not.toHaveProperty("basicOnly");
  });
});

describe("§6 the field has a printed consumer", () => {
  it("`gust.basicOnly` is consumed by REGISTRY ROWS and not merely by the type system", () => {
    const consumers = PRINTINGS.filter((id) =>
      (programFor(id)?.trainer ?? []).some((op) => op.op === "gust" && op.basicOnly === true),
    );
    expect(consumers).toEqual([...PRINTINGS]);
  });

  it("the FIXTURE POOL prints the sentence, so the pins above run on the real bytes", () => {
    expect(FIXTURE_POOL["fix-lisiasappeal"]?.effect ?? "").toBe(LISIAS_APPEAL);
    // …and it is the card the boards above actually play: the uid staged into
    // p1's hand resolves back to that same fixture id.
    const staged = withCard(supporterTurn(SEED));
    expect(staged.state.cardIdByUid[staged.uid]).toBe("fix-lisiasappeal");
  });
});
