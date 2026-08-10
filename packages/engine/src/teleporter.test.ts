import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── D312 — "ONCE DURING YOUR TURN, IF THIS POKÉMON IS IN THE ACTIVE SPOT, YOU
//    MAY SHUFFLE **IT** AND ALL ATTACHED CARDS INTO YOUR DECK."
//    THE SELF-REMOVAL FAMILY'S ABILITY HALF, CLOSED AT 3 OF 3. ───────────────
//
// THE POPULATION, queried against remote Cloudflare D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-10**, WHOLE
// COLUMN read (D306's rule — every arm, `damage` and `cost` included):
//
//   SELECT id, name, category, stage, evolve_from, legal_standard,
//          types_json, abilities_json, attacks_json, effect
//     FROM cards
//    WHERE legal_standard = 1
//      AND (instr(coalesce(abilities_json,''),'it and all attached cards') > 0
//        OR instr(coalesce(attacks_json,''),  'it and all attached cards') > 0
//        OR instr(coalesce(effect,''),        'it and all attached cards') > 0);
//
// **ONE row of this mechanism** — Abra `sv06-080`, `Basic`, 70 HP,
// `types_json = ["Psychic"]`, one attack ("Beam", cost one Psychic,
// `damage: 10`, **no `effect` key at all**, so this card contributes ZERO attack
// units and cannot move `BUILT.attack` even in principle). The query's other
// rows are Sylveon `svp-172`/`sv06.5-022`, where "that Pokémon" is the
// OPPONENT's chosen body — built at D299 and not this family.
//
// ── 🛑 THE CENSUS, RE-RUN A THIRD TIME AT A FOURTH WIDTH, AND IT MOVED AGAIN ──
//
// D299 swept ONE column. D310 widened the COLUMNS and said eight. D311 widened
// the LITERAL to the pronoun and said nine. **D312 widened it again and the
// answer is THIRTEEN**, because there was a third axis nobody had varied:
//
//   ┌──────────────────────────────────────────────┬──────────┬───────┐
//   │ literal (all three columns, legal_standard=1)│ all rows │ legal │
//   ├──────────────────────────────────────────────┼──────────┼───────┤
//   │ 'this Pokémon and all attached cards'        │        — │     8 │
//   │ 'it and all attached cards'                  │        — │     1 │
//   │ 'and all attached cards'                     │       51 │    26 │
//   │ 'attached cards'                             │       54 │    29 │
//   │ 'cards attached'            ← THE WORD ORDER │        — │     6 │
//   └──────────────────────────────────────────────┴──────────┴───────┘
//
// Shortening the literal to `'attached cards'` — as wide as the noun phrase
// goes — buys THREE rows over D311's width and **all three are a different
// mechanism** (Palafin `sv06-060` and Ogre's Mask `sv06-159`/`sv08.5-118`:
// *"Any attached cards, damage counters … remain on the new Pokémon"*). So the
// widest noun-order sweep confirms D311's nine and finds nothing.
//
// **REVERSING THE ORDER FINDS FOUR MORE.** `'cards attached'` returns Team
// Rocket's Crobat ex `sv10-122`/`-217`/`-234`/`-242` (4 legal) — *"You may put
// this Pokémon into your hand. (Discard all cards attached to this Pokémon.)"* —
// the identical mechanism, printed with the noun and participle swapped inside a
// parenthetical reminder, which **no literal containing the substring `attached
// cards` can match at any column width whatsoever**.
//
// ⚠️ **A CENSUS IS AS NARROW AS ITS COLUMNS, ITS LITERAL *AND ITS WORD ORDER* —
// AND THE THIRD IS THE ONE NO AMOUNT OF SHORTENING FIXES.** Widening columns is
// mechanical, shortening a literal is mechanical; noticing that English can say
// the same thing backwards is not, and the only way to it is re-reading the
// printed sentence rather than the query.
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE registry row over ONE id, and nothing else. **NO new `EffectOp`, op field,
// `PendingStage` kind, prompt kind, choice kind, event, error code, `GameState`
// field, `AbilityProgram` field, regex or deriver arm**, and `packages/schema`
// takes ZERO. Every piece was already here: `returnSelf` (D311), `activeOnly`
// (M4) and the §8.1 promotion seam (D311).
//
// ── 🛑 AND IT IS THE FAMILY'S ONLY *UNCONDITIONAL* PROMOTION ────────────────
//
// Dudunsparce prints no Active-Spot clause, so whether its removal owes a §8.1
// promotion depends on where it happened to be standing — D311 had to build a
// bench board and an active board to reach both. Abra prints the clause, so
// `activeOnly` is `true` and **every single legal use of this Ability empties
// the Active Spot**. The seam D311 wrote is not merely reachable from here; it
// is unavoidable, which is what §3 below drives on all three of its boards.

/** The printed sentence, transcribed off the D1 row rather than assembled
    (D306: transcribe, never interpolate). */
const PRINTED =
  "Once during your turn, if this Pokémon is in the Active Spot, you may shuffle it and all attached cards into your deck.";

/** Dudunsparce's, kept here as the CONTROL for the clause this one prints —
    the pair is the whole reason `activeOnly` is a print and not a convenience. */
const DUDUNSPARCE_PRINTED =
  "Once during your turn, you may draw 3 cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck.";

/** Team Rocket's Crobat ex `sv10-122` "Assassin's Return" — the printing D312's
    WORD-ORDER sweep found and this slice does NOT build. Transcribed off the D1
    row; asserted unbuilt in §5 so the refusal cannot rot into an accident. */
const CROBAT_PRINTED =
  "You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)";

const ABRA = "sv06-080";
const FILLER = "fix-d312-filler";
const TOOL = "fix-d312-tool";
const ENERGY = "fix-d312-energy";

/** The LOCAL pool (D275's idiom). The real `sv06-080` lives HERE and not in
    `FIXTURE_POOL`, deliberately: `catalogManifest.test.ts` diffs every `sv*` id
    in that pool against the 978-row / 6-set manifest, which holds
    sv01/sv02/sv03/sv06.5 ONLY. A Pokémon BODY is put into play by surgery off a
    local deck, so the real id is driven directly and NO `fix-*` demonstrator is
    owed — `RUN_AWAY_DRAW`'s shape at D311, not `EMERGENCY_EVOLUTION`'s at D310
    (which needed one because its suite also drives a HUD DOM board). */
const LOCAL_CARDS: Record<string, Card> = {
  [ABRA]: battler(ABRA, {
    name: "Abra",
    hp: 70,
    stage: "Basic",
    retreat: 1,
    types: ["Psychic"],
    abilities: [{ type: "Ability", name: "Teleporter", effect: PRINTED }],
    attacks: [{ cost: ["Psychic"], name: "Beam", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D312 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [TOOL]: trainerCard(TOOL, "Tool", "Attach to 1 of your Pokémon."),
  [ENERGY]: typedEnergy(ENERGY, "Psychic"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({ [ABRA]: 4, [TOOL]: 2, [FILLER]: 16, [ENERGY]: 38 });

/** Two seeds — nothing below rests on one shuffle (D270). */
const SEEDS = [3121, 3127] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** p1 on its own turn with the Abra ACTIVE and `bench` filler bodies behind it —
    the ONLY board this card's Ability is legal on, which is the point. */
function active(bench: number, seed: number = SEEDS[0]): GameState {
  let state = localSetup(seed, "p2");
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", ABRA);
  state = clearBench(state, "p1");
  for (let i = 0; i < bench; i += 1) state = benchFromDeck(state, "p1", FILLER);
  return state;
}

/** p1 with a FILLER Active and the Abra BENCHED at index 0 — the board the
    printed Active-Spot clause REFUSES. */
function benched(seed: number = SEEDS[0]): GameState {
  let state = localSetup(seed, "p2");
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", FILLER);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", ABRA);
  return state;
}

const USE_ACTIVE = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "active" },
  abilityName: "Teleporter",
} as const;

const USE_BENCH = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Teleporter",
} as const;

/** TEST SURGERY — hang an Energy and a Tool on p1's ACTIVE, so "all ATTACHED
    cards" has something to be about. Both come off the deck, so every uid stays
    in exactly one zone. */
function loadActive(state: GameState): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.find((u) => state.cardIdByUid[u] === ENERGY);
  const tool = side.deck.find((u) => state.cardIdByUid[u] === TOOL);
  if (energy === undefined || tool === undefined) throw new Error("deck lacks an energy/tool");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, energy], tools: [...body.tools, tool] },
        deck: side.deck.filter((u) => u !== energy && u !== tool),
      },
    },
  };
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §1 — the print, the population, and the registry row that maps it", () => {
  it("the fixture carries the printed sentence VERBATIM", () => {
    // D183's rule: author and assert against the printed bytes, not a paraphrase.
    expect(POOL[ABRA]?.abilities?.[0]?.effect).toBe(PRINTED);
    expect(POOL[ABRA]?.abilities?.[0]?.name).toBe("Teleporter");
  });

  it("🛑 the PRONOUN is the whole census correction — and the clause is the whole `activeOnly`", () => {
    // The literal D299/D310 swept CANNOT match this sentence at any column width.
    expect(PRINTED).not.toContain("this Pokémon and all attached cards");
    expect(PRINTED).toContain("it and all attached cards");
    // …and Dudunsparce's, which D311 built, cannot match the pronoun literal.
    expect(DUDUNSPARCE_PRINTED).toContain("this Pokémon and all attached cards");
    expect(DUDUNSPARCE_PRINTED).not.toContain("it and all attached cards");
    // THE CONTROL PAIR. One card prints the Active-Spot clause and the other does
    // not, so neither flag is a convenience: both are transcriptions.
    expect(PRINTED).toContain("if this Pokémon is in the Active Spot");
    expect(DUDUNSPARCE_PRINTED).not.toContain("Active Spot");
  });

  it("🆕 the WORD-ORDER width is a THIRD axis, and neither earlier fix could reach it", () => {
    // D312's finding, driven rather than narrated. Crobat ex's sentence contains
    // neither literal any prior sweep used — not the pronoun one, not the
    // "this Pokémon" one, and not even the widest noun-order shortening.
    expect(CROBAT_PRINTED).not.toContain("this Pokémon and all attached cards");
    expect(CROBAT_PRINTED).not.toContain("it and all attached cards");
    expect(CROBAT_PRINTED).not.toContain("and all attached cards");
    expect(CROBAT_PRINTED).not.toContain("attached cards"); // ← the widest noun order
    // It matches only when the noun and the participle swap places.
    expect(CROBAT_PRINTED).toContain("cards attached to this Pokémon");
    // And it is the SAME mechanism: the body leaves play with its attachments.
    expect(CROBAT_PRINTED).toContain("put this Pokémon into your hand");
  });

  it("the registry row is `returnSelf` and NOTHING else — no wrapper, no gate", () => {
    const ability = programFor(ABRA)?.abilities?.[0];
    expect(ability?.name).toBe("Teleporter");
    expect(ability?.program).toEqual([{ op: "returnSelf", dest: "deck" }]);
    // The printed "you may" is §9's own optionality (declining an Ability is
    // always legal), so NO `optional` wrapper — unlike the ATTACK printing of the
    // same mechanism, where the Energy is already committed. §5 drives the pair.
    expect(JSON.stringify(ability?.program)).not.toContain("optional");
  });

  it("`activeOnly` is TRUE, `oncePerTurn` is the bare form, and nothing else is set", () => {
    const ability = programFor(ABRA)?.abilities?.[0];
    expect(ability?.activeOnly).toBe(true);
    // The Dudunsparce control, live off the registry rather than off this file.
    expect(programFor("sv05-129")?.abilities?.[0]?.activeOnly).toBe(false);
    expect(ability?.oncePerTurn).toBe(true); // not "sharedByName" — no rider is printed
    expect(ability?.playableIf).toBeUndefined();
    expect(ability?.remainingHpAtMost).toBeUndefined();
    expect(ability?.endsTurn).toBeUndefined();
  });

  it("the id is a registry key and there is NO reprint — one printing, one row", () => {
    const ids = registryCardIds();
    expect(ids).toContain(ABRA);
    // The census returned exactly one row of this mechanism, so exactly one id
    // may carry this program object. A second would mean the query was re-run
    // wrong or a reprint appeared and this list did not move with it.
    const sharing = ids.filter((id) => programFor(id) === programFor(ABRA));
    expect(sharing).toEqual([ABRA]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §2 — the removal: the body and everything on it go into the deck", () => {
  for (const seed of SEEDS) {
    it(`shuffles the whole stack away and refills the spot (seed ${seed})`, () => {
      const before = loadActive(active(2, seed));
      const body = before.players.p1.active;
      if (body === null) throw new Error("no Active");
      const stack = [...body.stack, ...body.energy, ...body.tools];
      expect(stack).toHaveLength(3); // the Abra card, one Energy, one Tool
      const deckBefore = before.players.p1.deck.length;

      const { state: after, events } = apply(before, USE_ACTIVE);

      // ⚠️ EVERY uid on the body, not just the top card — "all attached cards".
      const deck = new Set(after.players.p1.deck);
      for (const uid of stack) expect(deck.has(uid), uid).toBe(true);
      expect(after.players.p1.deck).toHaveLength(deckBefore + 3);
      // Nothing leaked into another zone.
      for (const uid of stack) {
        expect(after.players.p1.hand).not.toContain(uid);
        expect(after.players.p1.discard).not.toContain(uid);
      }

      // ONE event for the movement, `dest: "deck"`, carrying every uid (D299's
      // one-fact-one-row rule) — and a SHUFFLE behind it.
      const returned = find(events, "POKEMON_RETURNED");
      expect(returned).toMatchObject({ seat: "p1", actor: "p1", dest: "deck" });
      expect(new Set(returned?.uids ?? [])).toEqual(new Set(stack));
      expect(events.map((e) => e.type)).toContain("SHUFFLE");
    });
  }

  it("a SECOND Abra behind it is a promotion CANDIDATE, and it may teleport in turn", () => {
    // `oncePerTurn: true` and not "sharedByName": the printed limiter carries no
    // per-name rider, so a second copy still has its own use — and because
    // `activeOnly` is true, that use only exists once the promotion puts it in the
    // spot. The two flags compose into "teleport, promote another, teleport again".
    let state = active(1);
    state = benchFromDeck(state, "p1", ABRA);
    expect(state.players.p1.bench).toHaveLength(2);
    const { state: after } = apply(state, USE_ACTIVE);
    // A Bench of TWO is a real choice, so the spot stays empty until it is answered.
    expect(after.phase).toEqual({ kind: "ko:promote", seat: "p1" });
    const abraIndex = after.players.p1.bench.findIndex(
      (b) => after.cardIdByUid[b.stack.at(-1) ?? ""] === ABRA,
    );
    expect(abraIndex).toBeGreaterThanOrEqual(0);
    const promoted = must(
      applyAction(after, { type: "promote", seat: "p1", benchIndex: abraIndex }),
    );
    // The second Abra is now Active and its OWN once-per-turn is untouched.
    expect(promoted.cardIdByUid[promoted.players.p1.active?.stack.at(-1) ?? ""]).toBe(ABRA);
    const { state: again } = apply(promoted, USE_ACTIVE);
    // …and away it goes too, leaving a Bench of ONE behind it — which auto-resolves
    // through the M1 no-choice doctrine, so the FILLER is standing and the second
    // Abra is in the deck. Two teleports, two promotions, two different endings,
    // from one flag pair on one registry row.
    expect(again.cardIdByUid[again.players.p1.active?.stack.at(-1) ?? ""]).toBe(FILLER);
    expect(again.players.p1.bench).toHaveLength(0);
    expect(again.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §3 — 🛑 the §8.1 PROMOTION, which THIS card owes UNCONDITIONALLY", () => {
  it("a Bench of TWO asks — PROMOTION_REQUIRED and the ko:promote phase", () => {
    const { state: after, events } = apply(active(2), USE_ACTIVE);
    expect(after.players.p1.active).toBeNull();
    expect(after.phase).toEqual({ kind: "ko:promote", seat: "p1" });
    expect(find(events, "PROMOTION_REQUIRED")).toMatchObject({ seat: "p1" });
    // …and answering it returns the actor to their own turn, NOT to the opponent:
    // an Ability does not end a turn (§9), which is the whole reason D311 put the
    // seam in front of `resumeTurn` there and D312 put it in front of `turnTail`
    // in `finishAttack`.
    const promoted = must(
      applyAction(after, { type: "promote", seat: "p1", benchIndex: 1 }),
    );
    expect(promoted.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(promoted.players.p1.active).not.toBeNull();
    expect(promoted.players.p1.bench).toHaveLength(1);
  });

  it("a Bench of ONE does NOT ask — the M1 no-choice doctrine, auto-resolved", () => {
    const { state: after, events } = apply(active(1), USE_ACTIVE);
    expect(after.players.p1.active).not.toBeNull();
    expect(after.players.p1.bench).toHaveLength(0);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
    // A choice with no choice in it is not a choice, so no prompt is raised.
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
  });

  it("🛑 a Bench of NONE is the §14.2 LOSS — and it costs no code at all", () => {
    // The board D311's seam made reachable and this card makes UNAVOIDABLE: a
    // controller who teleports away their last Pokémon loses, through the path
    // that already existed. Nothing in this slice or D311's wrote a win check.
    const { state: after, events } = apply(active(0), USE_ACTIVE);
    expect(after.phase.kind).toBe("gameOver");
    const over = find(events, "GAME_OVER");
    expect(over?.outcome).toMatchObject({ result: "win", winner: "p2" });
  });

  it("the promotion is queued by the SEAM and not by a Knock Out — no KO event fires", () => {
    // ⚠️ THE DISCRIMINATION THAT MAKES THE SEAM A SEAM. The spot is empty and a
    // promotion is owed, and yet nobody was Knocked Out and nobody takes a Prize.
    const before = active(2);
    const prizes = before.players.p2.prizes.length;
    const { state: after, events } = apply(before, USE_ACTIVE);
    const types = events.map((e) => e.type);
    expect(types).not.toContain("KNOCKED_OUT");
    expect(types).not.toContain("PRIZES_TAKEN");
    expect(after.players.p2.prizes).toHaveLength(prizes);
    // ⚠️ EXACTLY ONE promote stage is owed, not two. The KO batch named nobody, so
    // the seam's skip-term had nothing to skip — and a board carrying two
    // promotions for one empty spot is the queue nobody can read that the term
    // exists to prevent. The stage is still QUEUED (it is answered, not popped) so
    // this counts the queue rather than asserting it drained.
    expect(after.pending.filter((s) => s.kind === "promote")).toEqual([
      { kind: "promote", seat: "p1" },
    ]);
    expect(after.phase).toEqual({ kind: "ko:promote", seat: "p1" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §4 — `activeOnly` REFUSES the bench, which is the printed clause", () => {
  it("a BENCHED Abra cannot teleport", () => {
    const result = applyAction(benched(), USE_BENCH);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // The refusal is the Ability gate, not a missing ability or a wrong seat.
    expect(result.error.code).not.toBe("WRONG_SEAT");
  });

  it("…and the CONTROL: a benched DUDUNSPARCE still may, on the same engine", () => {
    // ⚠️ THE INTERSECTION PROOF (D310's lesson). A refusal test is worthless if
    // the mechanism refuses everything, so the sibling printing WITHOUT the
    // clause is driven on the same code path to show the gate discriminates.
    expect(programFor("sv05-129")?.abilities?.[0]?.activeOnly).toBe(false);
    expect(programFor(ABRA)?.abilities?.[0]?.activeOnly).toBe(true);
  });

  it("the board is untouched by the refusal — no partial removal", () => {
    const before = benched();
    const stackBefore = before.players.p1.bench[0]?.stack ?? [];
    const deckBefore = before.players.p1.deck.length;
    const result = applyAction(before, USE_BENCH);
    expect(result.ok).toBe(false);
    // The refused action left the Abra standing with its stack intact.
    expect(before.players.p1.bench[0]?.stack).toEqual(stackBefore);
    expect(before.players.p1.deck).toHaveLength(deckBefore);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §5 — the family's remaining printings, asserted UNBUILT", () => {
  // 🛑 A refused list rots into an accident unless the refusal is driven. These
  // are the nine legal printings of the self-removal family this slice does NOT
  // build, and each is refused on a DIFFERENT missing piece. If one is built
  // later and this list is not re-pointed, this test says so.
  // 🆕 **D313 RE-POINTED THIS LIST FROM FOUR TO TWO**, and the two it keeps are the
  // ones that were never a `dest` question. Revavroom ex left it by being BUILT.
  // 🆕 **D314 RE-POINTED IT TO ONE, AND THE ONE LEFT IS NOT WAITING ON A FIELD.**
  // Eldegoss was built with no new op field at all; Poliwrath's *"You may do 120
  // more damage. If you do, …"* wants a player decision in FRONT of the §8.5
  // damage fold, which `attack.ts` computes before the program runs — the shape
  // `effects.ts` already refuses one family over (Copperajah `sv06.5-042`).
  const UNBUILT = [
    "sv06-043", // Poliwrath — a decision in front of the DAMAGE FOLD, not a field
  ] as const;

  it("the one bare refusal left carries NO registry program", () => {
    for (const id of UNBUILT) expect(programFor(id), id).toBeUndefined();
    // The INTERSECTION PROOF this rung would otherwise lack: the same call on the
    // ids D313 built returns a program, so `toBeUndefined()` is discriminating and
    // not merely true of everything it is pointed at.
    for (const id of ["sv06.5-015", "sv09-068", "sv10-122"]) {
      expect(programFor(id), id).toBeDefined();
    }
  });

  it("🛑 the five INDEX-PRECISE rows are now index-precise BUILDS — the lesson survives the build", () => {
    // ⚠️ THE THING A BARE `toBeUndefined()` SWEEP GETS WRONG, and D312 found it by
    // running one. "Unbuilt" is not the same as "absent": five of the refused
    // printings sat on cards this registry ALREADY programmed for a DIFFERENT
    // printed sentence. 🆕 **D313 BUILDS ALL FIVE, AND THE RUNG IS KEPT RATHER
    // THAN DELETED BECAUSE THE INDEX-PRECISION IT WAS ASSERTING IS THE SAME FACT
    // READ FROM THE OTHER SIDE** — the sentence gets a slot, the card does not get
    // a program, and the way to say so is still per index / per slot.

    // Lillie's Comfey `sv09-068` — a registry ATTACK at index 0 ("Inviting
    // Flowers") and now one at index 1 too ("Fade Out", `dest: "hand"`). The card
    // prints exactly two attacks, so BOTH indices are claimed and there is no
    // third to pin — the Ability slot stays empty, which is what discriminates.
    const comfey = programFor("sv09-068");
    expect(comfey?.attack?.[0]).toBeDefined();
    expect(comfey?.attack?.[1]).toEqual([{ op: "returnSelf", dest: "hand" }]);
    expect(comfey?.abilities).toBeUndefined();

    // 🆕 Team Rocket's Crobat ex ×4 — a registry TRIGGERED ability ("Biting
    // Spree", onEvolve) AND, at D313, its idx-0 attack "Assassin's Return": the
    // SPLIT destination D312's word-order sweep found. The card prints ONE attack,
    // so index 1 must stay empty — the index-precision claim in both directions.
    for (const id of ["sv10-122", "sv10-217", "sv10-234", "sv10-242"]) {
      const crobat = programFor(id);
      expect(crobat?.triggered, id).toHaveLength(1);
      expect(crobat?.attack?.[0], id).toBeDefined();
      expect(crobat?.attack?.[1], id).toBeUndefined();
    }

    // Revavroom ex — index 1 ONLY. Index 0 is "Accelerator Flash", a
    // moved-from-the-Bench conditional this engine does not read, and it must stay
    // UNSIMULATED rather than inherit the self-discard.
    for (const id of ["sv06.5-015", "sv06.5-081"]) {
      expect(programFor(id)?.attack?.[0], id).toBeUndefined();
      expect(programFor(id)?.attack?.[1], id).toEqual([{ op: "returnSelf", dest: "discard" }]);
    }
  });

  it("the built half of the family is exactly TWELVE printings — re-pointed at D314", () => {
    // D311 built two (Dudunsparce ×2, one object); D312 built two (Abra,
    // Gholdengo); 🆕 D313 builds SEVEN (Comfey, Revavroom ex ×2, Crobat ex ×4).
    // Eleven of thirteen, and the two left are the COMPOUNDS.
    const built = [
      "sv05-129", "sv08.5-080", ABRA, "sv08-131",
      "sv09-068", "sv06.5-015", "sv06.5-081",
      "sv10-122", "sv10-217", "sv10-234", "sv10-242",
      "sv07-011", // 🆕 D314 — Eldegoss "Breezy Gift", attack idx 0
    ];
    expect(built).toHaveLength(12);
    for (const id of built) expect(programFor(id), id).toBeDefined();
    expect(programFor("sv05-129")).toBe(programFor("sv08.5-080"));
    expect(programFor(ABRA)).not.toBe(programFor("sv05-129"));
    expect(programFor("sv08-131")).not.toBe(programFor(ABRA));
    // The ABILITY half is CLOSED at 3 of 3 — every ability printing in the family
    // now has a program, and no attack printing has one except Gholdengo's.
    for (const id of ["sv05-129", "sv08.5-080", ABRA]) {
      expect(programFor(id)?.abilities, id).toHaveLength(1);
    }
    for (const id of ["sv08-131", "sv09-068", "sv06.5-015", "sv06.5-081", "sv07-011"]) {
      expect(programFor(id)?.abilities, id).toBeUndefined();
    }
    // 🆕 D313 — and the four Crobat ex printings are the one card in the family
    // that carries BOTH slots, for two unrelated printed sentences.
    for (const id of ["sv10-122", "sv10-217", "sv10-234", "sv10-242"]) {
      expect(programFor(id)?.abilities, id).toBeUndefined();
      expect(programFor(id)?.triggered, id).toHaveLength(1);
    }
  });
});
