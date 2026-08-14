import { describe, expect, it } from "vitest";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState } from "./index";
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
} from "./testFixtures";

// D331 — LISIA'S APPEAL `sv08-179`/`-234`/`-246`, AND THE CLAUSE OF ITS OWN
// PRICE THAT WAS FALSE.
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   "Switch in 1 of your opponent's Benched **Basic** Pokémon to the Active
//    Spot. If you do, the new Active Pokémon is now Confused."
//   `sv08-179` / `sv08-234` / `sv08-246` — Supporter, **3 Standard-legal
//   printings and they are the whole population**: `instr(effect,'Benched Basic
//   Pok') > 0` returns exactly these 3 rows of 3,786, all `legal_standard = 1`
//   (remote D1 `luminous`, 2026-08-13).
//
// ── THE CENSUS, AT THREE WIDTHS AND OVER ALL THREE TEXT COLUMNS ─────────────
// Re-run at this head rather than inherited, and the per-column split is written
// out because a split that does not sum to its total is the cheapest census
// check there is (D330 published two that did not).
//
//   (a) `instr(<col>,'Benched Basic Pok') > 0` — the ADJECTIVE, anywhere:
//         `effect`         3 rows / 3 legal — the three Lisia's Appeal, only.
//         `attacks_json`   4 rows / 4 legal — Alolan Exeggutor ex `sv08-133`/
//                          `-225`/`-242`/`-248`, and it is a DIFFERENT verb
//                          ("Knock Out 1 of your opponent's Benched Basic
//                          Pokémon"), not a switch.
//         `abilities_json` 2 rows / 0 legal.
//       TOTAL 9 rows / 7 legal.  3 + 4 + 2 = 9 ✅   3 + 4 + 0 = 7 ✅
//
//   (b) `instr(<col>,'Switch in 1 of your opponent') > 0` — the VERB, widened
//       off the adjective so a pronoun or a stage word cannot hide a row:
//         `effect`         10 rows /  5 legal
//         `attacks_json`   18 rows / 10 legal
//         `abilities_json`  0 rows /  0 legal
//       TOTAL 28 rows / 15 legal. 10 + 18 + 0 = 28 ✅  5 + 10 + 0 = 15 ✅
//
//   (c) the INTERSECTION, which is the measurement that sized the field:
//       `instr(attacks_json,'Benched Basic') > 0 AND instr(attacks_json,'Active
//       Spot') > 0` → **0 rows**. No ATTACK anywhere in the catalog gusts a
//       stage-narrowed body.
//
// 🛑 **SO THE STAGE WORD ON THIS OP IS THREE PRINTINGS OUT OF 28, AND THE WORD
//    IS ALWAYS "Basic".** The five legal `effect` rows of (b) are Prime Catcher
//    ×2 and Lisia's Appeal ×3; the non-legal remainder is Boss's Orders ×3 and
//    Counter Catcher ×2, none of which prints a stage. That is why the rider is
//    `basicOnly?: true` and not a `stage?: "basic" | "evolution"` (which would
//    ship an `"evolution"` value no printing spells) and not a `CardFilter`
//    (which would ship a whole union no sentence asks this op for). **Narrow it,
//    do not widen it** — and the measurement is what makes that a decision
//    rather than a preference.
//
// ── WHAT THE INHERITED PRICE GOT RIGHT, AND THE ONE CLAUSE THAT WAS FALSE ───
// D329 re-priced this row and D330 confirmed the re-price. It read:
//
//     "ONE Basic rider on `gust`'s candidate scan (`unshieldedRefs(oppBenchRefs
//      (state, ctx.seat))`, still carrying no stage rider) plus 3 registry rows.
//      The rider is **shared with `programPlayable`'s empty-Bench refusal**, so
//      the whiff arm follows for free."
//
// ✅ The first half is exact. `gust`'s scan carried no stage rider, `recordAs`
//    is genuinely unnecessary (`applyStatus target: "defender"` reads
//    `otherSeat(ctx.seat).active` at OP TIME, so after the gust it IS the printed
//    "new Active Pokémon" — D330 settled this for Florges), and the registry cost
//    is 3 rows over 1 program.
//
// 🛑 **THE SECOND HALF WAS FALSE AT THIS HEAD, AND IT IS THE HALF THAT MADE THE
//    ROW LOOK CHEAP.** `programPlayable`'s refusal was
//
//        if (op.op === "gust" && state.players[otherSeat(seat)].bench.length === 0)
//
//    — a raw bench **LENGTH**. It never touched `oppBenchRefs`, shares nothing
//    with the candidate scan, and **cannot see a rider**. Had the rider gone onto
//    the scan alone, this Supporter would have been PLAYABLE into an opponent
//    Bench holding nothing but Evolutions: the turn's one Supporter (§7.2) spent,
//    a prompt parked with ZERO candidates, and the printed sentence unable to do
//    the thing it just charged for.
//
// ⚠️ **THAT IS D206's FINDING ONE OP OVER, ARRIVING ELEVEN DECISIONS LATE.** D206
//    replaced exactly this shape on `switchActive` — its note still sits three
//    lines above the gust line in cardplay.ts, saying *"the op's own candidate
//    function answers instead … so the refusal and the offer can never
//    disagree"* — and did not carry the repair across to the mirror op, because
//    no printing had yet narrowed a gust. **A LENGTH TEST IS A CANDIDATE SCAN
//    ONLY WHILE NOTHING NARROWS THE SET**, and the day a rider lands it becomes a
//    second copy of the printed rule that is already wrong. The fix is
//    `gustTargets` (interpreter.ts), exported for cardplay.ts on
//    `switchActiveTargets`' precedent and for its stated reason.
//
// 🆕 **THE LESSON, WHICH IS NOT "THE PRICE WAS WRONG" BUT SOMETHING SHARPER: A
//    `needs` STRING CAN NAME THE RIGHT PIECE AND BE WRONG ABOUT WHO ELSE READS
//    IT.** Every earlier rot mode on this table was about the PIECE (wrong card,
//    already built, wrong grain, wrong vocabulary). This one names the piece
//    correctly — a Basic rider on the candidate scan — and then asserts a
//    SHARING that does not exist. D328's rule was *"when a slice makes a number
//    movable, ask what else reads it"*; this is its exact instance, and the
//    answer was two readers where the handoff assumed one. **Grep the readers of
//    the thing you are about to narrow, before believing anything downstream is
//    free.**

// ── The printed bytes, verbatim off `effect` (`sv08-179`) ───────────────────
const LISIAS_APPEAL =
  "Switch in 1 of your opponent's Benched Basic Pokémon to the Active Spot. If you do, the new Active Pokémon is now Confused.";
/** Boss's Orders `sv02-172` — the SAME sentence with the adjective removed, kept
    here so "what the adjective buys" is a diff and not an assertion. */
const BOSSS_ORDERS = "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.";

const PRINTINGS = ["sv08-179", "sv08-234", "sv08-246"] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** p1's own first turn reached as TURN TWO — p2 goes first and ends. Lisia's
    Appeal is a **Supporter**, and §4 forbids the going-FIRST player one on turn 1
    (`FIRST_TURN_SUPPORTER`), so the going-second seat's turn is the only board on
    which this card is playable at all. `captivatingInvitation.test.ts`'s idiom,
    which took it from `carmine.test.ts`. */
function supporterTurn(seed: number): GameState {
  const first = driveSetup(seed, { p1: LISIAS_APPEAL_DECK, p2: LISIAS_APPEAL_DECK }, {
    first: "p2",
  });
  return mustApply(first, { type: "endTurn", seat: "p2" }).state;
}

/** 🛑 **EVERY BOARD BELOW THAT WANTS A *PROMPT* CARRIES **TWO** ADMISSIBLE
    BASICS, AND THAT IS `parkOrForce`'s M1 NO-CHOICE RULE, NOT PADDING.**
    `parkOrForce` (interpreter.ts) is documented *"no candidate = no-op, one =
    forced (auto-resolve), ≥2 = park"* — so a Bench whose ADMITTED set is a single
    body never parks at all; the op resolves in place and the phase stays
    `turn:action`. The first draft of this suite benched one Basic beside one
    Stage 1 and asked for the offer, which under the rider is a set of ONE: the
    prompt it wanted to read was never built, and six cases died on `expected a
    park`. **The narrowing is what makes the board fall through the no-choice
    rule, so the rider under test is itself what hides the evidence of it** — the
    boards are widened by one Basic rather than the assertions being relaxed to
    accept a forced resolve, because a forced resolve cannot show WHICH bodies
    were admissible and that is the entire question this file asks. */

/** The opponent's Bench holds TWO Basics and a STAGE 1. The board the adjective is
    actually about: with the rider the offer is the two Basics, without it all
    three bodies — both sides ≥2, so both PARK and the two prompts are comparable
    as prompts. */
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

/** ONE Basic and nothing else — `evolutionOnlyBench`'s exact twin at the SAME
    bench length, differing only in the stage of the single body on it. The
    tightest possible control for the refusal: if this board is playable and that
    one is not, the only thing that can have decided it is the adjective. */
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

/** The card ids a `choosePokemon` prompt offers, NAMED rather than counted — a
    filter that admits the wrong class cannot pass by returning the right number
    of candidates (D330's rule, and the reason the two invitees have distinct
    names). */
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

  it("⚠️ NO `recordAs` and NO `recordGate` — the 'If you do' is discharged elsewhere", () => {
    // D329's correction, kept drivable: the antecedent is discharged by
    // `programPlayable` refusing a gust that cannot happen, so the consequent
    // needs no §9.2 record to hang off. A `recordAs` appearing here later would
    // mean somebody re-added a piece this row was re-priced to NOT need.
    const ops = programFor("sv08-179")?.trainer ?? [];
    expect(ops).toHaveLength(2);
    expect(ops[0]).not.toHaveProperty("recordAs");
    expect(ops.some((op) => op.op === "recordGate")).toBe(false);
  });

  it("the adjective is the ONLY diff from Boss's Orders' sentence", () => {
    // Drives the census claim rather than restating it: the two printed strings
    // differ by exactly the word this slice added a field for.
    //
    // ⚠️ BOTH SIDES ARE READ OUT OF `FIXTURE_POOL` AND NEITHER IS THE HAND-TYPED
    // CONSTANT, because a diff between two literals in this file proves only that
    // this file is self-consistent. `sv02-172` is a REAL catalog row carried in
    // the pool, and it is the same object the attribution control above plays.
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
  it("🛑 a mixed Bench offers BOTH BASICS and NOT the Stage 1 — named, not counted", () => {
    const { state, uid } = withCard(mixedBench(SEED));
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(offeredIds(parked)).toEqual(["fix-invitee", "fix-plain-body"]);
    // The Stage 1 is on that Bench and was dropped — asserted against the BOARD,
    // so this cannot pass on a board that simply never held one.
    expect(parked.players.p2.bench).toHaveLength(3);
  });

  it("⚠️ ATTRIBUTION CONTROL — the SAME board under an UNRIDDEN gust offers BOTH", () => {
    // Without this the section proves nothing: a prompt naming one body is what
    // a Bench of one body also produces, and `basicOnly` could be doing nothing
    // at all. Boss's Orders `sv02-172` is the identical op with the rider ABSENT,
    // and it is already in the fixture pool, so the diff is the field and only
    // the field.
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
  it("🛑 a Bench of nothing but EVOLUTIONS refuses the card outright", () => {
    // THE CENTRAL CASE OF THIS SLICE. Before `gustTargets`, `programPlayable`
    // read `bench.length === 0`; this Bench has length 1, so the old gate said
    // PLAYABLE — spending §7.2's one Supporter and parking an empty prompt.
    const { state, uid } = withCard(evolutionOnlyBench(SEED));
    expect(state.players.p2.bench).toHaveLength(1);
    const result = playIt(state, uid);
    expect(result.ok).toBe(false);
  });

  it("⚠️ DRIVEN IN BOTH DIRECTIONS — the same board with a BASIC benched is playable", () => {
    // The refusal above is worthless if the card were unplayable for some other
    // reason (wrong turn, no Supporter allowance, a bad seed). ONE body swapped,
    // everything else identical — same bench LENGTH, same seat, same turn, and the
    // stage of that single body is the only difference between the two boards.
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

  it("🛑 THE OFFER AND THE REFUSAL ARE THE SAME SET — no board offers zero candidates", () => {
    // The invariant `gustTargets` exists to hold, driven across every Bench shape
    // this file builds rather than asserted about the helper. If a board is
    // playable, the park it produces has at least one candidate; if it is not,
    // there is no park at all. A rider honoured in one reader and not the other
    // breaks exactly this and nothing else.
    // ⚠️ AND IT COVERS BOTH OUTCOMES OF `parkOrForce`, WHICH IS WHY THE FORCED
    // BRANCH IS SPELLED OUT RATHER THAN SKIPPED: a one-candidate board does not
    // park, so "playable ⇒ the prompt has candidates" would be VACUOUSLY TRUE
    // there while saying nothing. Playable-and-not-parked has to mean the gust
    // actually happened, and that is checked on the opponent's Active by uid.
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

  it("⚠️ Boss's Orders is UNAFFECTED on the Evolution-only Bench — the funnel is behaviour-preserving", () => {
    // Every gust printing that shipped before this slice must keep its exact
    // playability: with no rider `gustTargets` returns `oppBenchRefs`, whose
    // length IS the bench length the old gate read. This is the board where a
    // careless funnel would have started refusing a card that used to work.
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
    expect(find(events, "POKEMON_SWITCHED")).toBeDefined();

    // "the new Active Pokémon is now Confused" — the body that MOVED, by uid.
    expect(done.players.p2.active?.conditions.rotation).toBe("confused");

    // …and the incumbent is on the Bench and is NOT Confused. Without this the
    // assertion above passes on a board where `applyStatus` hit the wrong body
    // and the switch never happened — D328's §7 lesson (a pin can be
    // mutation-proof and still assert the wrong thing).
    const benched = done.players.p2.bench.find(
      (b) => b.stack[b.stack.length - 1] === incumbent,
    );
    expect(benched).toBeDefined();
    expect(benched?.conditions.rotation ?? "none").toBe("none");
  });

  it("⚠️ ORDER — the Confusion lands on the promoted body, which is only true AFTER the gust", () => {
    // `applyStatus target: "defender"` reads `otherSeat(ctx.seat).active` at OP
    // TIME. Swap the two ops and the incumbent gets Confused and then walks to
    // the Bench carrying it — a board this case distinguishes by uid, which is
    // the entire reason the cast has three distinct opposing names.
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
    // Three printings that did nothing now do something, and the engine grew a
    // field — a minor is owed. The literal is tied in `legacyEnergy.test.ts`
    // against `package.json`; this is the slice-local end of it.
    //
    // 🆕 D332 — REPAIRED WITH A DRIVER, BECAUSE THE EXACT PIN WAS A TAX AND NOT A
    // CHECK. This line read `expect(engineVersion).toBe("0.237.0")`, which made the
    // version tie a FIVE-file fact where every handoff on the page said four — and
    // the first bump after it (0.238.0) would have reddened a suite that has
    // nothing to do with the bump. Worse, re-pointing it to the new literal makes
    // it say nothing about D331 at all. The only non-drifting claim a slice-local
    // pin can make is that ITS OWN bump was never rolled back, so that is what it
    // asserts now: at or past 0.237.0, compared numerically rather than as a
    // string so 0.240.0 does not read as less than 0.237.0.
    const [major, minor] = engineVersion.split(".").map(Number) as [number, number, number];
    expect(major).toBe(0);
    expect(minor).toBeGreaterThanOrEqual(237);
  });

  it("🛑 D331 OWED NO `MATCH_RECORD_VERSION` BUMP, and the reason is drivable rather than argued", () => {
    // 🆕 D335 — THE LITERAL IS GONE FROM THIS TITLE RATHER THAN CORRECTED. It read
    // "STAYS 19" and D335 bumped the constant to 20 for a change on a different op
    // entirely; the claim this case actually makes is about D331's OWN slice, which
    // is true forever and mentions no number. D334's rule, applied the first time it
    // came due: a count in a title is a count that will be wrong, so delete it or
    // make it executable — and the executable copy lives in `match.test.ts`.
    // D125's condition as `match.ts` states it: a WIDENING BY CONSTRUCTION does
    // not bump, because no older deploy can author the new value. `basicOnly` is
    // OPTIONAL and additive — a version-19 record parks `{ op: "gust" }`, and
    // read under this deploy that is `basicOnly === undefined`, which is exactly
    // the pre-D331 behaviour. Driven: the unridden op's candidate set on a mixed
    // Bench is the FULL Bench, i.e. what a v19 deploy would have offered.
    const { state, uid } = withCard(mixedBench(SEED), "sv02-172");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(choosePrompt(parked).candidates).toHaveLength(3);
    // The inverse — D309's rename case, the ONE exception — does not apply:
    // nothing was renamed and nothing REQUIRED was added.
    expect(programFor("sv02-172")?.trainer?.[0]).not.toHaveProperty("basicOnly");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — REACHABILITY IS NOT THE SAME AS BEING PRINTED (D330's finding, applied)
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 the field has a printed consumer", () => {
  it("🛑 `gust.basicOnly` is consumed by REGISTRY ROWS and not merely by the type system", () => {
    // D330 found `{ kind: "trainerCard" }` fully wired — `matchesFilter`,
    // `retrieveNoun`, `HAND_SEARCH_NOUNS`, type-checked, covered — with ZERO
    // registry consumers: green on every line and dead to every printed card.
    // This case is the standing check against shipping that shape again. It
    // counts CONSUMERS, so deleting the three keys turns it red even though the
    // field would still compile, still be reachable, and still be covered.
    const consumers = PRINTINGS.filter((id) =>
      (programFor(id)?.trainer ?? []).some((op) => op.op === "gust" && op.basicOnly === true),
    );
    expect(consumers).toEqual([...PRINTINGS]);
  });

  it("⚠️ the FIXTURE POOL prints the sentence, so the pins above run on the real bytes", () => {
    // The other half of D330's finding: a program can be exercised entirely
    // through hand-built ops and never meet the printed string it exists for.
    // `fix-lisiasappeal` carries the `effect` verbatim.
    expect(FIXTURE_POOL["fix-lisiasappeal"]?.effect ?? "").toBe(LISIAS_APPEAL);
    // …and it is the card the boards above actually play: the uid staged into
    // p1's hand resolves back to that same fixture id.
    const staged = withCard(supporterTurn(SEED));
    expect(staged.state.cardIdByUid[staged.uid]).toBe("fix-lisiasappeal");
  });
});
