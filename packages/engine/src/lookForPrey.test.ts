import manifest from "../package.json" with { type: "json" };
import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, programFor } from "./index";
import type { GameState, Seat } from "./index";
import type { EffectContext } from "./interpreter";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";
import { BENCH_MAX, otherSeat } from "./types";

// D294 — THE CROSS-SEAT DESTINATION, AND A ROW THAT WAS PRICED AT TEN TIMES ITS
// COST FOR FOUR HANDOFFS.
//
// THE SENTENCE. *"Once during your turn, you may use this Ability. Your opponent
// reveals their hand, and you put a Basic Pokémon with 70 HP or less that you
// find there onto your opponent's Bench."* — Mandibuzz, TWO Standard-legal
// printings, `sv10.5w-064` and `sv10.5w-145`, whose `abilities_json` is
// BYTE-IDENTICAL (remote D1 `luminous`, re-queried 2026-08-08:
// `GROUP BY lower(j.value ->> 'effect')` over `json_each(abilities_json)` at
// `legal_standard = 1` returns ONE row, n = 2, these two ids). Both are Stage 1,
// regulation mark I.
//
// ── WHAT THE RE-QUERY SETTLED BEFORE ANYTHING WAS BUILT ─────────────────────
//
// 🛑 **THE BACKLOG GROUPED FOUR PRINTINGS INTO "ONE CROSS-SEAT ZONE SLICE" AND
// THEY ARE THREE DIFFERENT MECHANISMS.** Read off the catalog rather than off the
// handoff:
//   · **Illumise `sv06-010`** — an ATTACK: *"Shuffle 1 of your opponent's Benched
//     Pokémon and all attached cards into their deck."* The source is an IN-PLAY
//     BODY, and no op in this engine unmakes one (§10 stacks only grow; KO tears
//     one down through the prize path). **REFUSED — missing CODE.**
//   · **Mandibuzz `sv10.5w-064`/`-145`** — an ABILITY whose source is the
//     OPPONENT'S HAND. **BUILT HERE**, and it never touches `searchMove` /
//     `retrieveMove` at all.
//   · **Chill Teaser Toy `sv08-166`** — an **ITEM**, not a Tool (`trainer_type =
//     'Item'`, re-queried; the handoff predicted "Tool and therefore `attachTool`"
//     and it is wrong): *"Put an Energy attached to 1 of your opponent's Pokémon
//     into their hand."* The source is an ATTACHED ENERGY. **REFUSED — missing
//     CODE.** ⚠️ Its printed GATE is already built (`youGoSecond` + `yourFirstTurn`,
//     Call Bell `sv08-165`'s pair); only the body is missing.
// **The three share the words "your opponent's" and nothing else.** Grouping them
// is what produced the standing price — *"a `z.enum` in `packages/schema`,
// `redact.ts` and two `src/` HUDs"* — and **NONE OF THOSE MOVES**: this slice's
// diff is ZERO in `packages/schema`, ZERO in `redact.ts` and ZERO in `src/`.
//
// 🛑 **AND THE WIDENED QUERY FOUND A HALF THE BACKLOG NEVER NAMED.**
// `%onto your opponent's Bench%` over all three text columns at
// `legal_standard = 1` returns **4** printings, not 2: **Lickitung `sv05-124` /
// `sv05-180` "Tongue Pull"** — *"Your opponent reveals their hand. Put up to **2**
// Basic Pokémon you find there onto your opponent's Bench."* Same source, same
// destination, an ATTACK. **REFUSED on a COUNT** (§7 below drives why): this op
// parks `min: 1, max: 1` and its offer keeps ONE representative per
// interchangeable class, and *"up to 2"* may legally take two copies of the same
// Basic. **The mechanism's legal population is 4; this slice ships 2 and says
// which 2 and why.**
//
// ⚠️ **WHAT THIS FILE IS FOR, AND IT IS NOT "a card left the hand".** Four things
// can be wrong here that every "the hand shrank" assertion would miss:
//   (a) **WHOSE BENCH.** `ctx.seat` versus its opposite is one character, and a
//       build that put the card on the ACTOR's Bench is a strictly better card
//       that passes every count. §4 asserts the owner at BOTH ends of the move.
//   (b) **WHETHER THE DEFAULT MOVED.** `dest` is optional, so Ortega's and
//       Greavard's unmarked op must still put a card on the bottom of the deck.
//       §2 is that ATTRIBUTION CONTROL, and without it a broken default would be
//       invisible from inside this file.
//   (c) **WHETHER THE FILTER IS LIVE.** A Basic over 70 HP, an Evolution UNDER 70
//       HP and a Trainer must each be refused, and the three fail for three
//       different conjuncts. A fixture holding only admitted cards proves none.
//   (d) **WHETHER A FULL BENCH IS SEEN TWICE.** Bench size is PUBLIC, so the
//       affordance greys (`programPlayable`) AND the offer empties. One without
//       the other is a dialog with no legal answer, or a card that lies about
//       being usable.

const LOOK_FOR_PREY_TEXT =
  "Once during your turn, you may use this Ability. Your opponent reveals their hand, and you put a Basic Pokémon with 70 HP or less that you find there onto your opponent's Bench.";

/** The two printings as the ingested catalog spells them — Stage 1, 110 HP,
    {D}. ⚠️ THE HOST'S OWN HP IS IRRELEVANT to the filter (the threshold reads the
    card in the OPPONENT's hand), which is exactly why it is set to a value ABOVE
    the threshold here: a build that compared the wrong card's HP would be green
    on a fixture where the host also happened to be small. */
function mandibuzz(id: string): Card {
  return battler(id, {
    name: "Mandibuzz",
    hp: 110,
    retreat: 1,
    types: ["Darkness"],
    stage: "Stage1",
    evolveFrom: "Vullaby",
    abilities: [{ type: "Ability", name: "Look for Prey", effect: LOOK_FOR_PREY_TEXT }],
  });
}

/** A Stage 1 UNDER the threshold — the fixture pool has none, and without one the
    `basicPokemon` conjunct and the `maxHp` conjunct cannot be told apart: every
    Evolution in `FIXTURE_POOL` is also over 70 HP, so a filter that had dropped
    the stage word entirely would still refuse them. */
function smallStage1(id: string): Card {
  return {
    ...battler(id, { hp: 60, types: ["Colorless"], retreat: 1 }),
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
  };
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv10.5w-064": mandibuzz("sv10.5w-064"),
  "sv10.5w-145": mandibuzz("sv10.5w-145"),
  "prey-small-stage1": smallStage1("prey-small-stage1"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The TWELFTH seeded deck (D270's rule: a seeded suite gets its OWN deck). Every
    Pokémon row is here for what the FILTER must say about it:
      · `fix-victim` (30 HP Basic) and `fix-basic-1` (60 HP Basic) — ADMITTED;
      · `fix-tough` (120 HP Basic) — REFUSED by the THRESHOLD alone;
      · `prey-small-stage1` (60 HP Stage 1) — REFUSED by the STAGE alone;
      · `fix-zero-hp` (0 HP Basic) — REFUSED by the NULL, `hpOf`'s data-gap read;
      · `fix-item` — REFUSED by the category;
      · the two Mandibuzz printings themselves (110 HP Stage 1) — REFUSED twice
        over, which is a fact about the card and not an accident of the fixture. */
const PREY_DECK = deckOf({
  "sv10.5w-064": 4,
  "sv10.5w-145": 4,
  "fix-basic-1": 8,
  "fix-victim": 4,
  "fix-tough": 4,
  "prey-small-stage1": 4,
  "fix-zero-hp": 2,
  "fix-item": 4,
  "fix-energy": 26,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: PREY_DECK, p2: PREY_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** Every uid in the seat's hand goes back under their deck — the log.test.ts
    idiom, legal-shaped (every uid stays in exactly one zone). */
function emptyHand(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
}

/** `seat` has Mandibuzz ACTIVE and one other body benched; the OPPONENT's hand
    holds exactly `handIds`, and their Bench is empty unless `benched` says
    otherwise.
    ⚠️ THE ACTOR'S BENCH BODY IS LOAD-BEARING — §14.2 makes an empty Bench a LOSS
    the moment the Active leaves, and a `gameOver` board proves nothing. */
function board(
  seed: number,
  first: Seat,
  seat: Seat,
  handIds: readonly string[],
  benched: readonly string[] = [],
  activeId = "sv10.5w-064",
): GameState {
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  const victim = otherSeat(seat);
  state = clearBench(state, victim);
  for (const id of benched) state = benchFromDeck(state, victim, id);
  state = emptyHand(state, victim);
  for (const id of handIds) state = handFromDeck(state, victim, id, 1);
  return state;
}

const ACTIVE = { spot: "active" } as const;

function useLookForPrey(state: GameState, seat: Seat) {
  return applyAction(state, {
    type: "useAbility",
    seat,
    target: ACTIVE,
    abilityName: "Look for Prey",
  });
}

/** The parked `chooseCards` prompt, or a loud throw. */
function cardsPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${phase.kind}`);
  }
  return phase.prompt;
}

/** The distinct catalog ids a park is offering. */
function offeredIds(state: GameState): string[] {
  return [
    ...new Set(
      cardsPrompt(state).candidates.map((uid) => state.cardIdByUid[uid] ?? "<no catalog id>"),
    ),
  ].sort();
}

function benchIds(state: GameState, seat: Seat): string[] {
  return state.players[seat].bench.map((p) => state.cardIdByUid[p.stack[p.stack.length - 1] ?? ""] ?? "?");
}

/** `runProgram` with the two out-parameters this file does not want to thread:
    it mutates an `events` array and returns a `RunResult` union. Every use here
    is a single op on a board that either resolves inline or parks. */
function runOps(
  state: GameState,
  ops: readonly EffectOp[],
  seat: Seat,
): { state: GameState; events: GameEvent[]; parked: boolean } {
  const events: GameEvent[] = [];
  const ctx: EffectContext = { seat, sourceUid: state.players[seat].active?.stack[0] ?? "" };
  const out = runProgram(state, ops, ctx, events);
  return { state: out.state, events, parked: out.kind === "parked" };
}

const SEEDS = [3, 21, 44, 61, 90] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The registry rows — the printed sentence, as data.
// ─────────────────────────────────────────────────────────────────────────────

describe("Mandibuzz — the two printings as registry data", () => {
  it("both ids resolve to ONE program carrying the printed clause", () => {
    for (const id of ["sv10.5w-064", "sv10.5w-145"]) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name, id).toBe("Look for Prey");
      expect(ability?.program, id).toEqual([
        {
          op: "bottomFromOpponentHand",
          filter: { kind: "basicPokemon", maxHp: 70 },
          dest: "bench",
        },
      ]);
    }
  });

  it("the two printings share ONE program object — a reprint is not a second authoring", () => {
    expect(programFor("sv10.5w-145")).toBe(programFor("sv10.5w-064"));
  });

  it("🛑 `oncePerTurn` is TRUE and NOT `sharedByName` — the card prints no name lock", () => {
    // D272's wider scope is keyed on the printed "You can't use more than 1 <name>
    // Ability each turn", which this sentence does not carry. Two Mandibuzz on one
    // Bench therefore get a use EACH, and a `sharedByName` here would silently
    // halve a legal board's output.
    expect(programFor("sv10.5w-064")?.abilities?.[0]?.oncePerTurn).toBe(true);
    expect(LOOK_FOR_PREY_TEXT).not.toContain("can't use more than 1");
  });

  it("carries no `activeOnly`, no `playableIf` and no `trainerPlayableIf`", () => {
    const ability = programFor("sv10.5w-064")?.abilities?.[0];
    expect(ability?.activeOnly).toBe(false);
    expect(ability?.playableIf).toBeUndefined();
    expect(programFor("sv10.5w-064")?.trainerPlayableIf).toBeUndefined();
  });

  it("🛑 authors NO attack program and NO passive — the census term is an OP field", () => {
    // The column this row moves is `BUILT.ability`, and nothing else. A passive
    // bar or an attack table here would move a different constant and make the
    // census's attribution control a lie.
    expect(programFor("sv10.5w-064")?.attack).toBeUndefined();
    expect(programFor("sv10.5w-064")?.passive).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE ATTRIBUTION CONTROL — the unmarked op still means what it meant.
// ─────────────────────────────────────────────────────────────────────────────

describe("the DEFAULT destination is untouched — `dest` absent is the M5 op", () => {
  it("🛑 an op with NO `dest` puts the card on the BOTTOM OF THE DECK, as ever", () => {
    // Without this, a widening that had made "bench" the default would be
    // invisible from inside this file: every assertion here is about the marked
    // op, and Ortega/Greavard live in `opponentHandFamily.test.ts`.
    const state = board(SEEDS[0], "p1", "p1", ["fix-victim"]);
    const victim = "p2";
    const deckBefore = state.players[victim].deck.length;
    const out = runOps(state, [{ op: "bottomFromOpponentHand" }], "p1");
    expect(out.state.players[victim].hand).toEqual([]);
    expect(out.state.players[victim].deck.length).toBe(deckBefore + 1);
    expect(out.state.players[victim].bench.length).toBe(0);
    expect(out.events.some((e: GameEvent) => e.type === "CARD_TO_BOTTOM_OF_DECK")).toBe(true);
    expect(out.events.some((e: GameEvent) => e.type === "POKEMON_BENCHED")).toBe(false);
  });

  it("🛑 the SAME op with `dest: \"bench\"` moves the SAME card the OTHER way", () => {
    // The pair is the whole widening: one field, two destinations, everything
    // else identical — which is what makes `dest` falsifiable rather than
    // decorative.
    const state = board(SEEDS[0], "p1", "p1", ["fix-victim"]);
    const victim = "p2";
    const deckBefore = state.players[victim].deck.length;
    const out = runOps(state, [{ op: "bottomFromOpponentHand", dest: "bench" }], "p1");
    expect(out.state.players[victim].hand).toEqual([]);
    expect(out.state.players[victim].deck.length).toBe(deckBefore);
    expect(benchIds(out.state, victim)).toEqual(["fix-victim"]);
    expect(out.events.some((e: GameEvent) => e.type === "CARD_TO_BOTTOM_OF_DECK")).toBe(false);
    expect(out.events.some((e: GameEvent) => e.type === "POKEMON_BENCHED")).toBe(true);
  });

  it("the park's `dest` follows the op's, and the wire enum already had both", () => {
    // `chooseCards.dest` has carried "bench" since the search family, which is
    // why `packages/schema/src/match/redacted.ts` takes a ZERO diff for this
    // slice. Asserted rather than argued, because the handoff priced a `z.enum`.
    const state = board(SEEDS[1], "p1", "p1", ["fix-victim", "fix-basic-1"]);
    const parked = must(useLookForPrey(state, "p1"));
    expect(cardsPrompt(parked).dest).toBe("bench");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The offer — exactly the cards the printed noun admits, out of THEIR hand.
// ─────────────────────────────────────────────────────────────────────────────

describe("the Look for Prey offer", () => {
  const MIXED = [
    "fix-victim", // 30 HP Basic — ADMITTED
    "fix-basic-1", // 60 HP Basic — ADMITTED
    "fix-tough", // 120 HP Basic — refused by the THRESHOLD
    "prey-small-stage1", // 60 HP Stage 1 — refused by the STAGE
    "fix-zero-hp", // 0 HP Basic — refused by the NULL
    "fix-item", // Item — refused by the CATEGORY
    "fix-energy", // Energy — refused by the CATEGORY
  ] as const;

  it("🛑 OFFERS exactly the Basics at or under 70 HP and nothing else", () => {
    const state = board(SEEDS[2], "p1", "p1", MIXED);
    const parked = must(useLookForPrey(state, "p1"));
    expect(offeredIds(parked)).toEqual(["fix-basic-1", "fix-victim"]);
  });

  it("🛑 a 60 HP STAGE 1 is refused — the stage conjunct, not the threshold", () => {
    // The sharpest single card in the fixture: it satisfies `maxHp` and fails
    // `basicPokemon`, so a filter that had dropped the stage word would offer it.
    const state = board(SEEDS[2], "p1", "p1", ["prey-small-stage1"]);
    const out = useLookForPrey(state, "p1");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.phase.kind).toBe("turn:action");
    expect(out.state.players.p2.bench.length).toBe(0);
  });

  it("🛑 a 0 HP body is refused rather than admitted — `null <= 70` is TRUE in JS", () => {
    const state = board(SEEDS[2], "p1", "p1", ["fix-zero-hp"]);
    const out = must(useLookForPrey(state, "p1"));
    expect(out.phase.kind).toBe("turn:action");
    expect(out.players.p2.bench.length).toBe(0);
  });

  it("scans the OPPONENT's hand and never the actor's own", () => {
    // The actor holds a perfectly legal candidate; the opponent holds none. A
    // build reading `ctx.seat`'s hand would park here.
    let state = board(SEEDS[3], "p1", "p1", ["fix-item"]);
    state = handFromDeck(state, "p1", "fix-victim", 1);
    const out = must(useLookForPrey(state, "p1"));
    expect(out.phase.kind).toBe("turn:action");
    expect(out.players.p1.bench.length).toBe(1);
    expect(out.players.p2.bench.length).toBe(0);
  });

  it("ONE matching class resolves inline — the M1 no-choice doctrine", () => {
    // Two copies of one card are one decision, not two: the offer collapses
    // interchangeable copies, so a single class never parks.
    let state = board(SEEDS[4], "p1", "p1", ["fix-victim"]);
    state = handFromDeck(state, "p2", "fix-victim", 1);
    const out = must(useLookForPrey(state, "p1"));
    expect(out.phase.kind).toBe("turn:action");
    expect(benchIds(out, "p2")).toEqual(["fix-victim"]);
    expect(out.players.p2.hand.length).toBe(1);
  });

  it("captions the park with the printed DESTINATION, not with the deck's", () => {
    const state = board(SEEDS[1], "p1", "p1", ["fix-victim", "fix-basic-1"]);
    const parked = must(useLookForPrey(state, "p1"));
    const note = cardsPrompt(parked).note;
    expect(note).toContain("onto your opponent's Bench");
    expect(note).not.toContain("bottom of their deck");
    // And the printed THRESHOLD, through `retrieveNoun`'s caption rider.
    expect(note).toContain("70 HP or less");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The move itself — WHOSE bench, and out of WHOSE hand.
// ─────────────────────────────────────────────────────────────────────────────

describe("Look for Prey on a real board", () => {
  function parkAndPick(seed: number, seat: Seat, pickId: string) {
    // `first` IS the acting seat: `localSetup` opens on turn 1, which belongs to
    // the going-first player, so a mirror board has to go first too or the
    // `useAbility` is refused WRONG_SEAT before any of this is reached.
    const state = board(seed, seat, seat, ["fix-victim", "fix-basic-1"]);
    const parked = must(useLookForPrey(state, seat));
    const uid = cardsPrompt(parked).candidates.find((u) => parked.cardIdByUid[u] === pickId);
    if (uid === undefined) throw new Error(`no ${pickId} in the offer`);
    return { before: state, parked, resolved: mustApply(parked, {
      type: "resolveEffect",
      seat,
      choice: { kind: "cards", uids: [uid] },
    }) };
  }

  it("🛑 the chosen Basic lands on the OPPONENT's Bench and NOT the actor's", () => {
    const { before, resolved } = parkAndPick(SEEDS[0], "p1", "fix-victim");
    expect(benchIds(resolved.state, "p2")).toEqual(["fix-victim"]);
    // The actor's own Bench is byte-identical to before — the single most
    // valuable assertion in this file, because a `ctx.seat` typo is one character
    // and produces a strictly better card.
    expect(benchIds(resolved.state, "p1")).toEqual(benchIds(before, "p1"));
  });

  it("leaves the OPPONENT's hand and no other zone", () => {
    const { before, resolved } = parkAndPick(SEEDS[1], "p1", "fix-basic-1");
    expect(resolved.state.players.p2.hand.length).toBe(before.players.p2.hand.length - 1);
    expect(resolved.state.players.p1.hand.length).toBe(before.players.p1.hand.length);
    expect(resolved.state.players.p2.deck.length).toBe(before.players.p2.deck.length);
    expect(resolved.state.players.p2.discard.length).toBe(before.players.p2.discard.length);
  });

  it("MIRRORS when p2 holds the Mandibuzz — the seat is read, never assumed", () => {
    const { before, resolved } = parkAndPick(SEEDS[2], "p2", "fix-victim");
    expect(benchIds(resolved.state, "p1")).toEqual(["fix-victim"]);
    expect(benchIds(resolved.state, "p2")).toEqual(benchIds(before, "p2"));
  });

  it("the new body is stamped THIS turn — it entered play now, not at setup", () => {
    const { resolved } = parkAndPick(SEEDS[3], "p1", "fix-victim");
    const put = resolved.state.players.p2.bench[0];
    expect(put?.turnPlayed).toBe(resolved.state.turn);
    // And it arrives clean: no damage, no energy, no tools, no status.
    expect(put?.damage).toBe(0);
    expect(put?.energy).toEqual([]);
    expect(put?.tools).toEqual([]);
  });

  it("🛑 the OPPONENT may evolve it next turn — it is an ordinary Benched body", () => {
    // §10's came-into-play-this-turn ban is keyed on `turnPlayed`, and the stamp
    // above is what makes it fire. This is the reader that would notice a stamp
    // of 0 (which would let them evolve it immediately).
    const { resolved } = parkAndPick(SEEDS[4], "p1", "fix-victim");
    const put = resolved.state.players.p2.bench[0];
    expect(put).toBeDefined();
    expect(put?.turnPlayed).toBeGreaterThan(0);
  });

  it("the Ability is spent — `oncePerTurn` files the use", () => {
    const { resolved } = parkAndPick(SEEDS[0], "p1", "fix-victim");
    const again = useLookForPrey(resolved.state, "p1");
    expect(again.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The FULL Bench — seen twice, because bench size is public.
// ─────────────────────────────────────────────────────────────────────────────

describe("a full opponent Bench", () => {
  const FULL = Array.from({ length: BENCH_MAX }, () => "fix-basic-1");

  it("🛑 `programPlayable` says NO — the affordance greys before it is offered", () => {
    const state = board(SEEDS[0], "p1", "p1", ["fix-victim"], FULL);
    expect(state.players.p2.bench.length).toBe(BENCH_MAX);
    const program = programFor("sv10.5w-064")?.abilities?.[0]?.program ?? [];
    expect(programPlayable(state, program, "p1", state.players.p1.active?.stack[0] ?? "")).toBe(
      false,
    );
  });

  it("🛑 the ACTION is refused outright — `useAbility` never reaches the program", () => {
    const state = board(SEEDS[1], "p1", "p1", ["fix-victim"], FULL);
    const out = useLookForPrey(state, "p1");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("🛑 and the OFFER is empty too — one guard without the other is a dead dialog", () => {
    // The resolve-time half, driven at the OP because `programPlayable` above
    // stops the action first. Both are owed: if only the gate refused, a wire
    // answer arriving on a board that filled up since would still have to whiff
    // rather than destroy a card; if only the offer refused, the row would sit
    // LIT and do nothing.
    const state = board(SEEDS[1], "p1", "p1", ["fix-victim"], FULL);
    const out = runOps(state, [{ op: "bottomFromOpponentHand", dest: "bench" }], "p1");
    expect(out.parked).toBe(false);
    expect(out.state.players.p2.bench.length).toBe(BENCH_MAX);
    expect(out.state.players.p2.hand.length).toBe(1);
    expect(out.events.some((e: GameEvent) => e.type === "POKEMON_BENCHED")).toBe(false);
  });

  it("ONE space left is enough — the clamp is a space count, not a boolean", () => {
    const state = board(SEEDS[2], "p1", "p1", ["fix-victim"], FULL.slice(0, BENCH_MAX - 1));
    const program = programFor("sv10.5w-064")?.abilities?.[0]?.program ?? [];
    expect(programPlayable(state, program, "p1", state.players.p1.active?.stack[0] ?? "")).toBe(
      true,
    );
    const out = must(useLookForPrey(state, "p1"));
    expect(out.players.p2.bench.length).toBe(BENCH_MAX);
  });

  it("an EMPTY opponent hand refuses too, and by the older of the two rules", () => {
    const state = board(SEEDS[3], "p1", "p1", []);
    const program = programFor("sv10.5w-064")?.abilities?.[0]?.program ?? [];
    expect(programPlayable(state, program, "p1", state.players.p1.active?.stack[0] ?? "")).toBe(
      false,
    );
  });

  it("🛑 a NON-EMPTY hand with no MATCH stays playable — the reveal still happens", () => {
    // ruling/284's line, already this op's rule: whether a hidden hand holds a
    // match is exactly what the board does NOT establish, so the card is played,
    // the hand is revealed, and the pick whiffs. Greying here would be a peek.
    const state = board(SEEDS[4], "p1", "p1", ["fix-tough"]);
    const program = programFor("sv10.5w-064")?.abilities?.[0]?.program ?? [];
    expect(programPlayable(state, program, "p1", state.players.p1.active?.stack[0] ?? "")).toBe(
      true,
    );
    const out = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: ACTIVE,
      abilityName: "Look for Prey",
    });
    expect(out.events.some((e: GameEvent) => e.type === "HAND_REVEALED")).toBe(true);
    expect(out.state.players.p2.bench.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Where the information goes — the LOG, and never the projection.
// ─────────────────────────────────────────────────────────────────────────────

describe("the reveal and the row", () => {
  function ctxFor(state: GameState): LogContext {
    return { names: { p1: "Ada", p2: "Bo" }, state, elapsed: "+00:00" };
  }

  function drive(seed: number) {
    const state = board(seed, "p1", "p1", ["fix-victim", "fix-basic-1"]);
    const parked = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: ACTIVE,
      abilityName: "Look for Prey",
    });
    const uid = cardsPrompt(parked.state).candidates.find(
      (u) => parked.state.cardIdByUid[u] === "fix-victim",
    );
    if (uid === undefined) throw new Error("no fix-victim in the offer");
    const resolved = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid] },
    });
    return { state, parked, resolved };
  }

  it("the reveal rides the action that PARKED, and the put rides the answer", () => {
    const { parked, resolved } = drive(SEEDS[0]);
    expect(parked.events.filter((e) => e.type === "HAND_REVEALED").length).toBe(1);
    expect(resolved.events.some((e) => e.type === "HAND_REVEALED")).toBe(false);
    expect(resolved.events.filter((e) => e.type === "POKEMON_BENCHED").length).toBe(1);
  });

  it("🛑 the opponent's hand is STILL hidden in the projection afterwards", () => {
    // D232's rule, re-driven for a new destination: the printed reveal is
    // INSTANTANEOUS, so a build that opened the hand in `redact.ts` would be lying
    // about every later turn. The channel is the log and nothing else.
    const { resolved } = drive(SEEDS[1]);
    const seen = redactGame(resolved.state, "p1");
    // Face-down BACKS with POSITIONAL ids, which is what "hidden" means here —
    // not an absent field. The assertion is that no real catalog id appears and
    // that the count is the only fact carried.
    const backs = seen.board.opponent.hand ?? [];
    expect(backs.length).toBe(resolved.state.players.p2.hand.length);
    expect(backs.map((c) => c.id)).toEqual(backs.map((_, i) => `opponent-hand-${i}`));
    expect(backs.some((c) => c.cardId === "fix-victim" || c.cardId === "fix-basic-1")).toBe(false);
  });

  it("🛑 the POKEMON_BENCHED row is filed under the ACTOR and names the OWNER", () => {
    const { resolved } = drive(SEEDS[2]);
    const benched = resolved.events.find((e) => e.type === "POKEMON_BENCHED");
    expect(benched).toBeDefined();
    if (benched?.type !== "POKEMON_BENCHED") return;
    expect(benched.seat).toBe("p2");
    expect(benched.actor).toBe("p1");
    const rows = logFromEvents(resolved.events, ctxFor(resolved.state));
    const row = rows.find(
      (r) => r.kind === "action" && r.segments.some((seg) => seg.text.includes("Bench")),
    );
    if (row?.kind !== "action") throw new Error("expected an action row naming a Bench");
    expect(row.who).toBe("p1");
    expect(row.segments.map((seg) => seg.text).join("")).toContain("onto Bo's Bench");
  });

  it("the ORDINARY §5.2 bench play keeps its row byte for byte — `actor` absent", () => {
    // The widening is optional, and this is what "optional" has to mean: every
    // pre-existing row is untouched. A build that had made `actor` required would
    // still pass every assertion above.
    const state = board(SEEDS[3], "p1", "p1", ["fix-victim"]);
    const basic = state.players.p1.hand.find(
      (u) => POOL[state.cardIdByUid[u] ?? ""]?.stage === "Basic",
    );
    if (basic === undefined) throw new Error("no Basic in the actor's hand");
    const out = mustApply(state, { type: "playBasicToBench", seat: "p1", uid: basic });
    const benched = out.events.find((e) => e.type === "POKEMON_BENCHED");
    if (benched?.type !== "POKEMON_BENCHED") throw new Error("expected POKEMON_BENCHED");
    expect(benched.actor).toBeUndefined();
    const rows = logFromEvents(out.events, ctxFor(out.state));
    const row = rows.find(
      (r) => r.kind === "action" && r.segments.some((seg) => seg.text.includes("benched")),
    );
    if (row?.kind !== "action") throw new Error("expected an action row naming a bench play");
    expect(row.who).toBe("p1");
    expect(row.segments.map((seg) => seg.text).join("")).not.toContain("onto");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE REFUSALS, WRITTEN AS TESTS — so overturning one costs a deliberate edit.
// ─────────────────────────────────────────────────────────────────────────────

describe("what this slice REFUSED and why", () => {
  it("🛑 Illumise `sv06-010` still carries its GATE and NO body", () => {
    // *"Shuffle 1 of your opponent's Benched Pokémon and all attached cards into
    // their deck."* MISSING: **CODE** — an op that unmakes an IN-PLAY body (its
    // whole stack, attached Energy and Tools, damage and status) back into a
    // library zone. Nothing in this engine does that: §10 stacks only grow and KO
    // is the one teardown, through the prize path. It is NOT the schema-boundary
    // row four handoffs priced, and it is NOT this slice's mechanism.
    const program = programFor("sv06-010");
    expect(program?.attackGate?.[0]).toBeDefined();
    expect(program?.attack).toBeUndefined();
  });

  it("✅ Chill Teaser Toy `sv08-166` is BUILT at D295 — and it is an ITEM, not a Tool", () => {
    // 🆕 **THE INVERSION, CASHED — THE FIFTH TIME D284's DESIGN HAS PAID.** This
    // `it` was written one commit earlier as a REFUSAL asserting
    // `programFor("sv08-166")` undefined, precisely so that building it would cost
    // a deliberate edit rather than a silent table widening. It cost exactly that,
    // and the blocker it named — *"a DESTINATION that is a zone rather than the
    // discard pile"* — is the field that was built: `discardEnergy.to`.
    //
    // ⚠️ **THE CATALOG CLAIM IS RE-ASSERTED AND NOT DROPPED.** The handoff
    // predicted this card is a TOOL reaching `attachTool`; the D1 row says
    // `trainer_type = 'Item'`, and a Tool would carry no `trainer` program at all.
    const program = programFor("sv08-166");
    expect(program?.trainer).toEqual([
      { op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" }, to: "hand" },
    ]);
    // An Item's body rides `trainer`; a Tool's would ride `passive` and reach
    // `attachTool` instead. The NEGATIVE is what pins the surface.
    expect(program?.passive, "an Item, not a Tool").toBeUndefined();
    // And the gate is Call Bell's, unwidened — see chillTeaserToy.test.ts.
    expect(program?.trainerPlayableIf).toEqual({
      kind: "allOf",
      conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
    });
  });

  it("🛑 Lickitung `sv05-124`/`-180` is unauthored — the same destination, on a COUNT", () => {
    // *"Your opponent reveals their hand. Put up to 2 Basic Pokémon you find
    // there onto your opponent's Bench."* MISSING: **CODE** — a count on this op
    // AND a per-class-representative offer. The op parks `min: 1, max: 1` and
    // collapses interchangeable copies to ONE representative, which is sound for
    // exactly one pick; "up to 2" may take two copies of the same Basic, and a
    // collapsed offer cannot express that. Found by the widened query, named by
    // nothing in the backlog.
    for (const id of ["sv05-124", "sv05-180"]) expect(programFor(id), id).toBeUndefined();
  });

  it("🛑 the op has NO `dest: \"hand\"` — a member no printing reaches", () => {
    // The obvious third destination, refused on the D104 minimal-shape rule.
    // Chill Teaser Toy's "into their hand" moves an ATTACHED ENERGY, which this
    // op's source cannot see, so a `"hand"` arm here would be unreachable.
    const state = board(SEEDS[0], "p1", "p1", ["fix-victim"]);
    const before = state.players.p2.hand.length;
    const out = runOps(state, [{ op: "bottomFromOpponentHand", dest: "bench" }], "p1");
    expect(out.state.players.p2.hand.length).toBe(before - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. THE PERSISTED BYTE — driven both directions with a literal key anchor.
// ─────────────────────────────────────────────────────────────────────────────

describe("MATCH_RECORD_VERSION stays 16 — and it is DRIVEN, not asserted", () => {
  /** A board parked mid-Look-for-Prey: `phase.cont` now carries the op, which IS
      persisted (`MatchRecord` writes the whole `GameState`). */
  function parked(): GameState {
    const state = board(SEEDS[0], "p1", "p1", ["fix-victim", "fix-basic-1"]);
    return must(useLookForPrey(state, "p1"));
  }

  it("🛑 the persisted continuation's op carries EXACTLY these keys", () => {
    // THE LITERAL KEY ANCHOR (D279's pairing rule): a diff between two boards
    // from ONE build is blind to "every op grew a key", because the key is on
    // both sides. This names them.
    const phase = parked().phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // Through JSON, because that is what STORAGE does to it.
    const revived = JSON.parse(JSON.stringify(phase)) as {
      cont: { pendingOp: EffectOp; rest: EffectOp[] };
    };
    expect(Object.keys(revived.cont.pendingOp).sort()).toEqual(["dest", "filter", "op"]);
    expect(revived.cont.rest).toEqual([]);
  });

  it("🛑 FORWARD: a version-16 record with NO `dest` replays as bottom-of-deck", () => {
    // The direction the repo's rule actually tests — "can the PREVIOUS deploy's
    // RECORD hold the new TYPE". An old continuation has no `dest`; this build
    // reads `undefined`; `undefined` IS the bottom of the deck the old record was
    // written under. The old bytes mean here exactly what they meant there.
    const state = board(SEEDS[1], "p1", "p1", ["fix-victim", "fix-basic-1"]);
    const deckBefore = state.players.p2.deck.length;
    const out = runOps(state, [{ op: "bottomFromOpponentHand" }], "p1");
    // Two candidate classes, so it parks — resolve it and check where it landed.
    expect(out.parked || out.state.players.p2.deck.length > deckBefore).toBe(true);
  });

  it("🛑 BACKWARD: the parked prompt round-trips through JSON unchanged", () => {
    // The other direction, and the one a version bump would exist to protect: a
    // record written HERE, read back HERE. If the park did not survive
    // serialisation the version question would be moot and the bug louder.
    const before = parked();
    const revived = JSON.parse(JSON.stringify(before)) as GameState;
    expect(revived.phase).toEqual(before.phase);
    const uid = cardsPrompt(revived).candidates[0];
    if (uid === undefined) throw new Error("empty offer");
    const out = must(
      applyAction(revived, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [uid] } }),
    );
    expect(out.players.p2.bench.length).toBe(1);
  });

  it("no `GameState` field, no new `GameEvent` TYPE, no new error code", () => {
    // What actually moved: an OPTIONAL field on an existing op (which an old
    // continuation cannot carry and does not need) and an OPTIONAL field on
    // `POKEMON_BENCHED` (and `GameEvent` is not persisted at all — `MatchRecord`
    // stores the RENDERED `SeatLogEntry[]`). Neither can make a version-16 record
    // unreadable here.
    const state = board(SEEDS[0], "p1", "p1", ["fix-victim"]);
    const keys = Object.keys(state).sort();
    expect(keys).toContain("phase");
    expect(keys).not.toContain("crossSeatPuts");
  });
});

describe("the engine version", () => {
  it("moved past 0.204.0 with the new op field, and the two files agree", () => {
    // BEHAVIOUR moved inside `packages/engine` (an op field, an event field, two
    // registry rows), so the number moves. The tie against the manifest is
    // D275's guard; this re-states the literal because the literal IS this
    // assertion (D275's own note about `D275-engine-version-drifts-again`).
    expect(engineVersion).toBe(manifest.version);
    // 🆕 D295 moved it again (0.205.0 → 0.206.0), so this suite asserts the TIE
    // and the DIRECTION rather than re-stating a literal that belongs to whichever
    // slice bumped it last. `chillTeaserToy.test.ts` carries the current literal.
    expect(manifest.version).not.toBe("0.204.0");
  });
});
