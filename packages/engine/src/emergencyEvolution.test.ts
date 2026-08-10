import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, redactGame } from "./index";
import type { GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  EMERGENCY_DECK,
  FIXTURE_POOL,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// ── D310 — "ONCE DURING YOUR TURN, IF THIS POKÉMON'S REMAINING HP IS 30 OR LESS,
//    YOU MAY SEARCH YOUR DECK FOR AN UNFEZANT OR UNFEZANT EX AND PUT IT ONTO THIS
//    PIDOVE TO EVOLVE IT." THE EVOLVE-FROM-DECK FAMILY'S **ABILITY** PRINTING. ──
//
// THE POPULATION, queried against remote Cloudflare D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-10**, WHOLE
// COLUMN read (D306's rule — every arm, `damage` and `cost` included):
//
//   SELECT id, name, legal_standard, stage, evolve_from, category, types_json,
//          abilities_json, attacks_json
//     FROM cards
//    WHERE instr(abilities_json,'remaining HP is 30 or less') > 0;
//
// **ONE ROW, AND IT IS LEGAL.** Pidove `sv05-133`, `legal_standard = 1`,
// `stage = Basic`, `evolve_from = NULL`, `types_json = ["Colorless"]`; its only
// attack is "Gust" (`cost: ["Colorless"]`, `damage: 10`) **with no `effect` key at
// all**, so Pidove contributes ZERO attack units and this row cannot move
// `BUILT.attack` even in principle.
//
// ⚠️ **THE WIDER QUERY RETURNS THE SAME SINGLE ROW.** `instr(abilities_json,
// 'remaining HP is') > 0 OR instr(abilities_json,'to evolve it') > 0` — both
// halves of the sentence, each at its widest honest spelling — returns `sv05-133`
// and nothing else. So the clause has **no sibling at any width**, and this is
// not a row sampled out of a family.
//
// ── 🛑 THE HANDOFF PRICED A FILTER. IT IS A SUBSTITUTION. ───────────────────
//
// The resume point priced this row as *"a **named-pair filter** on the candidate
// set"* — a NARROWING of what `evolveFromDeck` already offers. **That reading
// builds a card that can never be played, and finding out why is this slice's
// result.**
//
// `evolveFromDeck`'s standing candidate rule is §10's own chain match, asked of
// the deck (D307): `evolveFromOf(card) === <this body's top card>.name`. For a
// **Pidove** body that set is **Tranquill**. The card the printed sentence NAMES
// is **Unfezant** — and:
//
//   SELECT id, name, legal_standard, stage, evolve_from FROM cards
//    WHERE instr(name,'Unfezant') > 0 OR instr(name,'Pidove') > 0;
//
// returns four `Unfezant` (`sv05-135`, `sv10.5b-073`, `sv10.5b-150`,
// `swsh10.5-063`) and **every one of them is `Stage2` with `evolve_from =
// 'Tranquill'`**, against four `Pidove` that are all `Basic` with
// `evolve_from = NULL`. **So chain ∧ name is EMPTY ON EVERY BOARD THAT WILL EVER
// EXIST.**
//
// That is `conventions.md`'s D207 defect — *"a predicate over a banner no column
// CLASSIFIES yields a permanently empty candidate set, which `programPlayable`
// turns into a card that can never be played"* — reached from the OPPOSITE
// direction, and that is why it is worth writing down: at D207 the predicate was
// wrong. Here **both halves are individually correct** and it is their CONJUNCTION
// that is dead. A slice that read the handoff and wrote `&&` would have shipped a
// green suite (every assertion about a refusal passes when nothing is ever
// offered) and a card that does nothing forever.
//
// ⚠️ **WHAT THE PRINT IS LICENSING IS A SKIPPED STAGE** — a Stage 2 straight onto
// a Basic, Rare Candy's shape printed on an Ability. `evolveOnto` imposes no chain
// check of its own, so `names` REPLACING the predicate is the whole build.
//
// ⚠️ **AND "Unfezant ex" HAS ZERO PRINTINGS IN THE CATALOG.** The same query is
// the witness: four `Unfezant`, no `Unfezant ex`, over all 3,786 rows. The name is
// authored anyway — a registry row is an EXACT MAP of the print (D190b) and
// transcribing beats interpolating (D306) — and §2 drives it on a fixture, because
// an authored-but-undriven array member is one a build reading `names[0]` would
// satisfy.
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE optional field on `evolveFromDeck` (`names`), ONE optional field on
// `AbilityProgram` (`remainingHpAtMost`), ONE shared helper (`abilityBodyGateMet`)
// and ONE registry row. **NO new `EffectOp`, prompt kind, choice kind, event,
// error code, `GameState` field, `CardFilter` member, regex or deriver arm** —
// there is no ability deriver in this engine at all, which is why an ability row
// is registry-keyed by construction and buys exactly its own legal printings.
// `packages/schema` takes ZERO.

/** The printed sentence, transcribed off the D1 row rather than assembled. */
const PRINTED =
  "Once during your turn, if this Pokémon's remaining HP is 30 or less, you may search your deck for an Unfezant or Unfezant ex and put it onto this Pidove to evolve it. Then, shuffle your deck.";

/** The printed threshold, as a number, so every boundary rung below is keyed to
    the SAME literal the registry row authors rather than to a repeated `30`. */
const GATE = 30;

/** The pool is `FIXTURE_POOL` unchanged — every card this file needs is a
    demonstrator that lives there, so there is no local pool to drift from it. */
const POOL: Record<string, Card> = FIXTURE_POOL;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: EMERGENCY_DECK, p2: EMERGENCY_DECK },
    cardPool: POOL,
  });
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

/** p1 on turn 2 with the Pidove on the BENCH at index 0 — deliberately NOT the
    Active, because the printed clause says nothing about where the body stands
    and `activeOnly` is authored `false` on the strength of that. `ee-plain` holds
    the Active spot so the board is legal without giving Pidove the seat. */
function board(seed = 7): GameState {
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-emergencyevolution");
  return state;
}

/** TEST SURGERY — put `n` damage on p1's bench-0 body. The gate is the only thing
    in this file that reads it, and no printed attack in this pool could place a
    chosen amount on a chosen body. */
function damaged(state: GameState, n: number): GameState {
  const side = state.players.p1;
  const body = side.bench[0];
  if (body === undefined || body === null) throw new Error("p1 bench 0 is empty");
  const bench = [...side.bench];
  bench[0] = { ...body, damage: n };
  return { ...state, players: { ...state.players, p1: { ...side, bench } } };
}

/** TEST SURGERY — every copy of `cardId` leaves p1's deck for the DISCARD, so the
    deck stays honest about what is searchable. */
function stripDeck(state: GameState, cardIds: readonly string[]): GameState {
  const side = state.players.p1;
  const drop = new Set(cardIds);
  const removed = side.deck.filter((uid) => drop.has(state.cardIdByUid[uid] ?? ""));
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((uid) => !drop.has(state.cardIdByUid[uid] ?? "")),
        discard: [...side.discard, ...removed],
      },
    },
  };
}

const USE = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Emergency Evolution",
} as const;

function use(state: GameState): GameState {
  return mustApply(state, USE).state;
}

function cardsPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${phase.kind}`);
  }
  return phase.prompt;
}

function candidateIds(state: GameState, uids: readonly string[]): string[] {
  return [...new Set(uids.map((uid) => state.cardIdByUid[uid] ?? ""))].sort();
}

function resolve(state: GameState, uids: readonly string[]): GameState {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  }).state;
}

/** The card ids stacked on p1's bench-0 body, bottom to top. */
function stackIds(state: GameState): string[] {
  const body = state.players.p1.bench[0];
  if (body === undefined || body === null) throw new Error("p1 bench 0 is empty");
  return body.stack.map((uid) => state.cardIdByUid[uid] ?? "");
}

// ────────────────────────────────────────────────────────────────────────────
describe("D310 §1 — the print, the population, and the registry row that maps it", () => {
  it("the fixture carries the printed sentence VERBATIM", () => {
    // D183's rule: author and assert against the printed bytes. The fixture text
    // and this file's constant are two transcriptions of one D1 row, and a
    // divergence between them means one of them was typed rather than copied.
    expect(FIXTURE_POOL["fix-emergencyevolution"]?.abilities?.[0]?.effect).toBe(PRINTED);
    expect(FIXTURE_POOL["fix-emergencyevolution"]?.abilities?.[0]?.name).toBe(
      "Emergency Evolution",
    );
  });

  it("the registry row is an EXACT MAP of the sentence — both names, the threshold, the shuffle", () => {
    const ability = programFor("sv05-133")?.abilities?.[0];
    expect(ability?.name).toBe("Emergency Evolution");
    // "Once during your turn," — the §9/§15.J key.
    expect(ability?.oncePerTurn).toBe(true);
    // 🛑 The printed clause says nothing about the Active Spot, so the card works
    // from the Bench. Asserted rather than left absent: `activeOnly` is a REQUIRED
    // field, so `false` is a decision and not a default.
    expect(ability?.activeOnly).toBe(false);
    expect(ability?.remainingHpAtMost).toBe(GATE);
    // BOTH printed names, in printed order — the second is unreachable in the
    // catalog and is authored anyway.
    expect(ability?.program).toEqual([
      { op: "evolveFromDeck", names: ["Unfezant", "Unfezant ex"] },
      { op: "shuffleDeck" },
    ]);
  });

  it("the fixture demonstrator and the real id share ONE program object", () => {
    expect(programFor("fix-emergencyevolution")).toBe(programFor("sv05-133"));
  });

  it("🛑 the named cards do NOT evolve from Pidove — the fixtures record the catalog fact the build turns on", () => {
    // THIS IS THE ROW THE WHOLE SLICE RESTS ON. If either named card evolved from
    // Pidove, the chain predicate and the name predicate would agree on every
    // board and nothing below could tell a `&&` build from a replacement build.
    expect(POOL["fix-unfezant"]?.evolveFrom).toBe("Tranquill");
    expect(POOL["fix-unfezant-ex"]?.evolveFrom).toBe("Tranquill");
    expect(POOL["fix-emergencyevolution"]?.name).toBe("Pidove");
    // …and the CONTROL really is a chain candidate, or it controls for nothing.
    expect(POOL["fix-tranquill"]?.evolveFrom).toBe("Pidove");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D310 §2 — the SUBSTITUTION: the offer is the NAMED SET and not the chain", () => {
  it("🛑 offers both named cards and REFUSES the Tranquill the chain would have offered", () => {
    const state = use(damaged(board(), 40));
    const prompt = cardsPrompt(state);
    // The named set, and nothing else. `fix-tranquill` is sitting in the deck ×4
    // on this very board — it is the card §10's chain match selects for a Pidove
    // body, and it is exactly what must NOT appear.
    expect(candidateIds(state, prompt.candidates)).toEqual(["fix-unfezant", "fix-unfezant-ex"]);
    // Said the other way, so the claim cannot be satisfied by an empty offer:
    expect(candidateIds(state, prompt.candidates)).not.toContain("fix-tranquill");
    // The count is DERIVED from the deck rather than written down: copies stray
    // into the opening hand and the prizes, so a literal here would be a claim
    // about the shuffle. What must hold is that EVERY named copy still in the
    // deck is offered, and no other card is.
    const namedInDeck = state.players.p1.deck.filter((uid) =>
      ["fix-unfezant", "fix-unfezant-ex"].includes(state.cardIdByUid[uid] ?? ""),
    );
    expect(prompt.candidates.length).toBe(namedInDeck.length);
    expect([...prompt.candidates].sort()).toEqual([...namedInDeck].sort());
  });

  it("…and the chain candidate is genuinely IN the deck, so its absence from the offer is a refusal", () => {
    const state = use(damaged(board(), 40));
    const deckIds = candidateIds(state, state.players.p1.deck);
    expect(deckIds).toContain("fix-tranquill");
  });

  it("the SECOND printed name is reachable on its own — a build reading names[0] goes red", () => {
    // Strip every `fix-unfezant` and the offer must fall back to the ex, not to
    // nothing. This is the only rung that can fail for an authored-but-unread
    // array member.
    const state = use(damaged(stripDeck(board(), ["fix-unfezant"]), 40));
    expect(candidateIds(state, cardsPrompt(state).candidates)).toEqual(["fix-unfezant-ex"]);
  });

  it("🛑 with NEITHER named card in the deck the Ability RESOLVES SILENTLY — and still shuffles", () => {
    // ⚠️ **THE WOULD-ONLY-WHIFF GATE DOES NOT REACH THIS OP, AND THAT IS D309's
    // FINDING HOLDING RATHER THAN A HOLE.** `programPlayable` never reads the deck,
    // so the all-whiff board is a LEGAL use that resolves to nothing — the silent
    // ending `searchDeck` and `evolveFromDeck` both already take. Asserted here
    // because a reader who expected `NO_LEGAL_TARGET` would "fix" it by teaching
    // `programPlayable` the deck, which is the change D309 argued against by name.
    //
    // AND IT IS STILL THE FILE'S SHARPEST DISCRIMINATOR: four Tranquill remain in
    // the deck, so a chain-predicate build PARKS here on a real prompt. This build
    // must not park at all.
    const state = damaged(stripDeck(board(), ["fix-unfezant", "fix-unfezant-ex"]), 40);
    const deckBefore = [...state.players.p1.deck];
    const result = applyAction(state, USE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No park: the turn is back with the player, not sitting on a choice.
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(stackIds(result.state)).toEqual(["fix-emergencyevolution"]);
    // …and the trailing `shuffleDeck` fired anyway — same cards, different order.
    expect(result.state.players.p1.deck.length).toBe(deckBefore.length);
    expect(result.state.players.p1.deck).not.toEqual(deckBefore);
  });

  it("the prompt NOTE names the cards rather than describing a chain it does not use", () => {
    // A park told "a card that evolves from Pidove" would describe its own
    // candidates falsely — the D307 mutant's defect one field over.
    const prompt = cardsPrompt(use(damaged(board(), 40)));
    expect(prompt.note).toBe(
      "Search your deck for Unfezant or Unfezant ex and put it onto Pidove to evolve it.",
    );
    expect(prompt.note).not.toContain("evolves from");
  });

  it("the park is the family's standing shape — min 0, max 1, dest `evolve`", () => {
    const prompt = cardsPrompt(use(damaged(board(), 40)));
    // "you may" is this `min: 0` and NOT an `optional` op wrapping it.
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(1);
    expect(prompt.dest).toBe("evolve");
  });

  it("the UNNAMED printings still take the chain — `names` absent changes nothing", () => {
    // The converse guard. D307/D308/D309's arms author no `names`, and this is the
    // rung that goes red if the replacement leaked into the default path.
    const offer = programFor("sv05-133")?.abilities?.[0]?.program?.[0];
    expect(offer).toHaveProperty("names");
    // Duosion's deriver-built op carries none, asserted through the registry's
    // absence rather than by re-running the deriver (that is D309's file's job).
    expect(programFor("sv10.5b-038")).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D310 §3 — the PER-BODY HP gate, at its printed boundary", () => {
  it("refuses at FULL health — 70 remaining is not 30 or less", () => {
    const result = applyAction(board(), USE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ABILITY_CONDITION_NOT_MET");
      expect(result.error.message).toContain("remaining HP is 30 or less");
    }
  });

  it("refuses ONE damage counter above the window — 40 remaining", () => {
    // 70 − 30 = 40. The rung immediately outside the boundary.
    const result = applyAction(damaged(board(), 30), USE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ABILITY_CONDITION_NOT_MET");
  });

  it("🛑 OPENS EXACTLY AT the boundary — 30 remaining, the printed `or less`", () => {
    // 70 − 40 = 30. A `<` build passes every other rung in this describe and fails
    // this one, which is the only reason to build the fixture at 70 HP.
    expect(applyAction(damaged(board(), 40), USE).ok).toBe(true);
  });

  it("…and stays open well below it — 10 remaining", () => {
    expect(applyAction(damaged(board(), 60), USE).ok).toBe(true);
  });

  it("🛑 the maximum is `effectiveMaxHp`, so a BRAVERY CHARM closes an open window", () => {
    // 40 damage on a 70 HP body is 30 remaining and the Ability is usable — the
    // rung two above. Attach +50 and the same body has 120 − 40 = 80 remaining, so
    // the gate must shut. A build reading the printed `hpOf` passes every other
    // rung in this file and fails only here.
    const charmed = attachToolFromDeck(damaged(board(), 40), "p1", 0, "sv02-173");
    const result = applyAction(charmed, USE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ABILITY_CONDITION_NOT_MET");
  });

  it("…and the Charm re-opens it once the damage catches up", () => {
    // 120 − 90 = 30, the same boundary on a different maximum. This is what says
    // the Charm rung above is about the MAXIMUM and not about "a Tool blocks it".
    const charmed = attachToolFromDeck(damaged(board(), 90), "p1", 0, "sv02-173");
    expect(applyAction(charmed, USE).ok).toBe(true);
  });

  it("the reject names the printed threshold rather than a hard-coded number", () => {
    const result = applyAction(board(), USE);
    if (result.ok) throw new Error("expected a reject");
    expect(result.error.message).toContain(`remaining HP is ${GATE} or less`);
    expect(result.error.message).toContain("§9");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D310 §4 — the PLACEMENT: a Stage 2 onto a Basic, and the stage that is skipped", () => {
  it("🛑 puts the Stage 2 straight onto the Basic — the printed SKIPPED STAGE", () => {
    let state = use(damaged(board(), 40));
    const pick = cardsPrompt(state).candidates.find(
      (uid) => state.cardIdByUid[uid] === "fix-unfezant",
    );
    if (pick === undefined) throw new Error("no Unfezant in the offer");
    state = resolve(state, [pick]);
    // Basic at the bottom, Stage 2 on top, and NO Tranquill between them — which
    // is the whole shape §10 would otherwise forbid.
    expect(stackIds(state)).toEqual(["fix-emergencyevolution", "fix-unfezant"]);
  });

  it("the chosen card LEAVES the deck", () => {
    let state = use(damaged(board(), 40));
    const before = state.players.p1.deck.length;
    const pick = cardsPrompt(state).candidates[0];
    if (pick === undefined) throw new Error("empty offer");
    state = resolve(state, [pick]);
    expect(state.players.p1.deck.length).toBe(before - 1);
    expect(state.players.p1.deck).not.toContain(pick);
  });

  it("the Tranquill in the deck is untouched — nothing was consumed to reach the Stage 2", () => {
    let state = use(damaged(board(), 40));
    const countTranquill = (s: GameState) =>
      s.players.p1.deck.filter((uid) => s.cardIdByUid[uid] === "fix-tranquill").length;
    const before = countTranquill(state);
    expect(before).toBeGreaterThan(0); // or the claim is about an empty set
    const pick = cardsPrompt(state).candidates[0];
    if (pick === undefined) throw new Error("empty offer");
    state = resolve(state, [pick]);
    expect(countTranquill(state)).toBe(before);
  });

  it("DECLINING is legal, and the trailing shuffle still fires", () => {
    // `min: 0` is the printed "you may". The deck order must change and the deck
    // size must not.
    let state = use(damaged(board(), 40));
    const before = [...state.players.p1.deck];
    state = resolve(state, []);
    expect(state.players.p1.deck.length).toBe(before.length);
    expect(state.players.p1.deck).not.toEqual(before);
    expect(stackIds(state)).toEqual(["fix-emergencyevolution"]);
  });

  it("a wire frame naming the chain candidate is REJECTED AT THE PROMPT — and the belt behind it is §7's", () => {
    // ⚠️ **THE OUTER GUARD FIRES FIRST, AND THAT IS WORTH RECORDING RATHER THAN
    // ROUTING AROUND.** This rung was written expecting the silent no-op that
    // `evolveFromDeckMove`'s own re-derivation produces; what actually happens is
    // that `validateChoice` refuses the frame against the PARK's candidate list
    // before the resolution is reached at all. A real Tranquill uid, in the real
    // deck, and a legal §10 evolution for this body — and the wire never gets to
    // ask.
    //
    // So the two nets are DIFFERENT nets and this file drives both: this rung is
    // the prompt-level one, and §7's v18 bag — which rewrites the prompt too — is
    // the only board on which `evolveFromDeckMove`'s `names` re-derivation is the
    // thing answering. A build that dropped `names` from the resolution signature
    // would pass THIS rung and fail that one.
    const state = use(damaged(board(), 40));
    const tranquill = state.players.p1.deck.find(
      (uid) => state.cardIdByUid[uid] === "fix-tranquill",
    );
    if (tranquill === undefined) throw new Error("no Tranquill in the deck");
    const result = applyAction(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [tranquill] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BAD_EFFECT_CHOICE");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D310 §5 — the §9 gate ORDER, and the once-per-turn lock above it", () => {
  it("a spent Ability reports ABILITY_ALREADY_USED even on a board whose HP window is open", () => {
    // The order `useAbility` states in its own comment: the body gate sits BELOW
    // the once-per-turn lock, so a player who already used it is told that rather
    // than being told about a window they can read off the card.
    let state = use(damaged(board(), 40));
    state = resolve(state, []);
    const again = applyAction(state, USE);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("…and the HP gate is what answers when the lock is not yet spent", () => {
    // The same call on the same turn with the window CLOSED reports the gate — the
    // pair of rungs is what says the order is an order and not a coincidence.
    const result = applyAction(board(), USE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ABILITY_CONDITION_NOT_MET");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D310 §6 — the ONLINE HUD mirrors the gate, so no surface affords a refused click", () => {
  function abilityRow(state: GameState) {
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    const row = phase.abilities.find((a) => a.abilityName === "Emergency Evolution");
    if (row === undefined) throw new Error("no Emergency Evolution row in the redacted view");
    return row;
  }

  it("greys the row and NAMES the printed clause while the window is shut", () => {
    const row = abilityRow(board());
    expect(row.disabled).toBe(true);
    expect(row.reason).toBe(`Only if this Pokémon's remaining HP is ${GATE} or less`);
  });

  it("…and lights it at the boundary the engine opens at", () => {
    // The two rungs together are the afford-then-reject guard: the HUD and
    // `useAbility` must change their answer on the SAME board (D222).
    const row = abilityRow(damaged(board(), 40));
    expect(row.disabled).toBe(false);
    expect(row.reason).toBe(null);
    expect(applyAction(damaged(board(), 40), USE).ok).toBe(true);
  });

  it("greys it under a Bravery Charm exactly as the engine refuses it", () => {
    const charmed = attachToolFromDeck(damaged(board(), 40), "p1", 0, "sv02-173");
    expect(abilityRow(charmed).disabled).toBe(true);
    expect(applyAction(charmed, USE).ok).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D310 §7 — `MATCH_RECORD_VERSION` STAYS 18, and the skip is DRIVEN", () => {
  it("🛑 a version-18 parked bag — an `evolveFromDeck` with NO `names` — reads back as the CHAIN", () => {
    // The classification, DRIVEN rather than asserted. A v18 deploy cannot author
    // `names`; what it CAN author is the bare op, parked with the candidates ITS
    // predicate produced — the chain set. So the v18 record is reconstructed on
    // both halves at once: the pending op in the old spelling AND the prompt that
    // deploy would have written.
    //
    // The board is §2's, where the chain set and the named set are DISJOINT —
    // which is the only reason the two readings are distinguishable at all.
    const parked = use(damaged(board(), 40));
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected a park");
    const chain = parked.players.p1.deck.filter(
      (uid) => parked.cardIdByUid[uid] === "fix-tranquill",
    );
    expect(chain.length).toBeGreaterThan(0);
    const v18 = {
      ...parked,
      phase: {
        ...phase,
        prompt: { ...phase.prompt, candidates: chain },
        cont: { ...phase.cont, pendingOp: { op: "evolveFromDeck" as const } },
      },
    } as GameState;
    const tranquill = chain[0];
    if (tranquill === undefined) throw new Error("no Tranquill in the deck");
    // The old record means "the chain", and this deploy honours it: the Tranquill
    // goes on. `names === undefined` is not a gap to be defaulted — it IS v18's
    // sentence, and reading it any other way would silently re-aim a resumed match.
    const resolved = resolve(v18, [tranquill]);
    expect(stackIds(resolved)).toEqual(["fix-emergencyevolution", "fix-tranquill"]);
  });

  it("…and the SAME bag in the new spelling refuses that card and takes the named one", () => {
    // The other direction, which is what makes the pair a discrimination rather
    // than an observation.
    let state = use(damaged(board(), 40));
    const unfezant = cardsPrompt(state).candidates.find(
      (uid) => state.cardIdByUid[uid] === "fix-unfezant",
    );
    if (unfezant === undefined) throw new Error("no Unfezant in the offer");
    state = resolve(state, [unfezant]);
    expect(stackIds(state)).toEqual(["fix-emergencyevolution", "fix-unfezant"]);
  });
});
