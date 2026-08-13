import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState } from "./index";
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
} from "./testFixtures";

// D330 — THE TWO `DROPPED` ROWS THAT RE-PRICED TO **ZERO NEW ENGINE FIELDS**.
//
// ── WHAT THE RE-PRICING RETURNED ────────────────────────────────────────────
// `legalNonAttackPrograms.test.ts`'s `DROPPED` table is a ranked work order in
// which every row carries a `needs` string, and that file itself records FOUR
// ways such a string rots: the wrong CARD (Blood Moon), an ALREADY-BUILT piece
// (Lacey), a piece built at a COARSER GRAIN (Metallic Signal), and the right
// obstacle in the wrong vocabulary (Ripening Charge). D330 re-read all four
// remaining rows against the code at `579de00` and found the SECOND mode twice:
//
//   row 1  Festival Grounds (7 legal)   `needs` CORRECT. There is no
//          attack-again state under any spelling, and no named-Stadium
//          `BoardCondition` member. Two absences, unchanged.
//   row 2  Iron Crown ex aura (6 legal) 🛑 ROTTED. It asks for "a SEAT-WIDE
//          pre-W/R damage AURA … `seatDamageReductionAfterWR`'s scan shape
//          pointed at the bonus seam". That is `seatDamageBonusBeforeWR` and it
//          SHIPPED AT D243, with its `beneficiary` and `target` riders at D245 —
//          and the row's own named "cheapest entry point", `sv10.5b-003`, is
//          BUILT (`seatDamageAura.test.ts`). What remains is a "Future" subtype
//          filter and a by-name exemption, not an aura.
//   row 3  Lisia's Appeal (3 legal)     D329's re-price HOLDS: one Basic rider
//          on `gust`'s candidate scan, which is still unfiltered by stage.
//   row 4  double-filter window (4)     ⚠️ HALF-ROTTED, and THIS SLICE TAKES THE
//          DIVIDEND. See §3 below.
//
// ⚠️ **NEITHER CARD BUILT HERE IS IN ANY ROW'S `ids` ARRAY, WHICH IS EXACTLY WHY
// NOTHING WENT RED TO SAY SO.** The `DROPPED` assertion guards each row's IDS.
// Florges is named only in a `needs` STRING and Petrel only in a PARENTHETICAL,
// and prose is not asserted. `DROPPED` therefore stays at 4 across this slice
// while three legal printings leave the unbuilt pool — the QUIET rot direction
// that file names and cannot catch.

const FLORGES = "sv06-088";
const PETREL_IDS = ["sv10-176", "sv10-226"] as const;

// ── THE CENSUS, TRANSCRIBED SO IT CAN BE RE-RUN ─────────────────────────────
// Remote D1 `luminous` (uuid 735f0fb5-cdc3-494d-8b97-74a8ade0124a, 3,786 rows,
// 2,021 `legal_standard`), 2026-08-13, run at three widths and over all three
// text columns, because inherited counts on this page have been wrong in BOTH
// directions:
//
//   instr(abilities_json,'Captivating Invitation') > 0
//     → 1 row, `sv06-088`, `legal_standard = 1`. THE WHOLE POPULATION.
//
//   ('is now Confused' in any column) AND ('Active Spot' in any column)
//     → 9 rows / **5** legal. Florges; the three Lisia's Appeal (the Basic-clause
//       twin, still unbuilt and still row 3 of `DROPPED`); Pangoro `sv07-093`,
//       whose two clauses are on SEPARATE attacks and never meet. The other **4**
//       are illegal Venusaur ex printings.
//       ⚠️ THIS LINE READ "9 rows / 4 legal … the other 5" ON ITS FIRST DRAFT, off
//       the SHAPE of a result set rather than off a `COUNT(*)`. Re-running it as a
//       count returned 5 and 4. **A FIGURE READ OFF A SCREEN IS NOT A MEASUREMENT**
//       (D310, D316, and `lavaZone.test.ts`'s own header, which records the exact
//       same slip on the exact same kind of row).
//
//   ('Benched Pokémon to the Active Spot' in any column) AND legal_standard = 1
//     → 18 rows, and the per-column split is **10 `attacks_json` / 3
//       `abilities_json` / 5 `effect`** — asserted as three separate `COUNT(*)`s
//       because 13 + 5 + 3 was the first draft's arithmetic and it does not sum
//       to 18. The gust family entire: 10 attack printings (deriver territory,
//       `BUILT.attack` cannot move), Prime Catcher ×2 and Team Rocket's
//       Giovanni ×3 (Trainers, built), and THREE Abilities — Meowstic
//       `sv08-085`, Hop's Dubwool `sv09-136` (BUILT as `DEFIANT_HORN`) and
//       Florges. ⚠️ **A SPLIT THAT DOES NOT SUM TO ITS TOTAL IS THE CHEAPEST
//       CENSUS CHECK THERE IS, AND IT ONLY WORKS IF THE SPLIT IS WRITTEN DOWN.**
//
// 🛑 **THE PRINTED NOUN IS "Benched Pokémon" WITH NO BASIC CLAUSE**, which is the
// entire reason this row is free and its Lisia's Appeal twin is not:
//
//   "Once during your turn, you may flip a coin. If heads, switch in 1 of your
//    opponent's Benched Pokémon to the Active Spot, and the new Active Pokémon
//    is now Confused."
//
// versus Lisia's Appeal's "…Benched **Basic** Pokémon…". One adjective is the
// whole difference between a registry row and an engine field.

/** ⚠️ THE RNG IS PINNED BY SEARCHING FOR A STATE, NOT BY A SEED TABLE —
    `expertHider.test.ts`'s idiom and its reason. A seed table goes vacuous the
    day `deckOf` order changes by one card; searching the state space states the
    requirement directly ("a board whose next coin is heads") and is derived from
    `flipCoin` itself, so if the RNG changes this changes with it. */
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

/** p1's own first turn, reached as TURN TWO — p2 goes first and ends. Petrel is
    a **Supporter**, and §4 forbids the going-FIRST player one on turn 1
    (`FIRST_TURN_SUPPORTER`), so the only board on which this card is playable at
    all is the going-second seat's turn. `carmine.test.ts`'s `turnTwo` idiom. */
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

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
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
    // 🛑 THE CLAUSE THAT IS PRINTED BY ITS ABSENCE. Both neighbours this program
    // was assembled from (`SCALDING_STEAM`, `ATTRACT_CUSTOMERS`) are Active-only,
    // so a copied `true` is the single likeliest defect in this row — and it
    // would be invisible to every other assertion in this file except §2's
    // benched board. Asserted here AND driven there.
    expect(ability?.activeOnly).toBe(false);
    expect(ability?.program).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: [{ op: "gust" }, { op: "applyStatus", target: "defender", status: "confused" }],
      },
    ]);
  });

  it("🛑 BOTH ops sit INSIDE the gate — a tails flip does nothing at all", () => {
    // The printed "If heads" governs BOTH consequents ("switch in 1 … , AND the
    // new Active Pokémon is now Confused"), so an `applyStatus` hoisted out of
    // `then` would Confuse the opponent's Active on a TAILS flip — a wrong card
    // that no count assertion could see. Driven on a real board in §2.
    const program = programFor(FLORGES)?.abilities?.[0]?.program;
    const gate = program?.[0];
    expect(program).toHaveLength(1);
    expect(gate?.op).toBe("coinFlipGate");
    expect(gate?.op === "coinFlipGate" ? gate.then : []).toHaveLength(2);
    // No `otherwise`: the printed sentence has no "If tails" arm.
    expect(gate?.op === "coinFlipGate" ? gate.otherwise : undefined).toBeUndefined();
    expect(gate?.op === "coinFlipGate" ? gate.onTails : undefined).toBeUndefined();
  });

  it("🛑 the ORDER is gust-then-status, which is the whole content of the row", () => {
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
  it("🛑 HEADS drags the BENCHED body up and Confuses THAT ONE, by uid", () => {
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

    // 🆕 D328's §7 LESSON, APPLIED: the prose of this pin is "the NEW Active is
    // Confused", so the numbers must distinguish it from "the OLD Active is
    // Confused". Both bodies are checked, in both directions.
    expect(done.players.p2.active?.conditions.rotation).toBe("confused");
    const benched = done.players.p2.bench.find((p) => topOf(p) === incumbent);
    expect(benched?.conditions.rotation ?? "none").toBe("none");

    // And the STATUS_APPLIED row names the invitee's uid, not the incumbent's —
    // the log and the board agree about which body it was.
    expect(find(events, "STATUS_APPLIED")).toMatchObject({
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

  it("🛑 TAILS does NOTHING — no switch, and NOBODY is Confused", () => {
    const state = withRng(board(4), TAILS);
    const incumbent = activeUid(state, "p2");
    const invitee = benchTopUid(state, "p2", 0);

    const { state: done, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Captivating Invitation",
    });

    // ⚠️ THE MUTANT THIS KILLS is `applyStatus` hoisted OUT of the gate: the
    // board would be unswitched and the incumbent Confused, which "somebody is
    // Confused" would not tell apart from the heads case.
    expect(activeUid(done, "p2")).toBe(incumbent);
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
    const stillBenched = done.players.p2.bench.find((p) => topOf(p) === invitee);
    expect(stillBenched?.conditions.rotation ?? "none").toBe("none");
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(types(events)).not.toContain("POKEMON_SWITCHED");
  });

  it("🛑 works from the BENCH — the printed text has no Active-Spot clause", () => {
    // The `activeOnly: false` clause of §1, driven. Both programs this row was
    // assembled from are Active-only, so this is the board that makes the flag
    // observable rather than merely asserted.
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

  it("🛑 an EMPTY opponent Bench REFUSES the Ability — the wrong-body arm is unreachable", () => {
    // THE BOARD THIS ROW WOULD HAVE GOT WRONG FOR FREE. With no opponent Bench
    // the `gust` is a no-op, so a program that ran would Confuse the Active that
    // was already there — the printed "new Active Pokémon" naming a body that
    // never moved. It costs nothing to close because the gate is already shared:
    // `programPlayable` descends into `coinFlipGate.then` and refuses a `gust`
    // whose opponent Bench is empty, and `useAbility` is put through that very
    // call. Asserted through the REJECT, not through a board that never happens.
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
  // 🛑 THE ROW'S OWN `needs` STRING SAID THIS WAS BLOCKED, AND THE BLOCKER HAD
  // SHIPPED. `DROPPED` row 4 prices itself at "a `trainer` `CardFilter` kind —
  // `supporter` and `toolCard` exist, the supertype does not (WHICH ALONE DROPS
  // TEAM ROCKET'S PETREL, 2 legal)". `{ kind: "trainerCard" }` is a full member
  // of the union with `matchesFilter`, `retrieveNoun` and `HAND_SEARCH_NOUNS`
  // rows — and, before this slice, ZERO registry consumers.
  //
  // ⚠️ **A FILTER MEMBER CAN BE GREEN AND DEAD**: every line that reads it was
  // covered, and no printed card had ever selected it. Reaching a line is not the
  // same as a printed sentence depending on it, and only the second is a card.

  it("the search offers EVERY Trainer class and NO non-Trainer", () => {
    let state = supporterTurn(11);
    state = handFromDeck(state, "p1", "fix-trainersearch", 1);
    const uid = handUid(state, "p1", "fix-trainersearch");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    const ids = offered(parked);
    // ⚠️ NAMED IN BOTH DIRECTIONS. Three Trainer subtypes must be present —
    // Supporter, Tool and Item — because `supporter` and `toolCard` already
    // existed and a program authored with either of them would still return a
    // non-empty prompt. Two non-Trainers must be absent, because `anyCard` would
    // also return a non-empty prompt.
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
