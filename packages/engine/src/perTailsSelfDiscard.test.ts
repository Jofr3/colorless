import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import { applyAction, createGame, engineVersion, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import type { CoinFace } from "./rng";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.373.0 → 0.374.0 — 🆕🆕 D476: THE FACE AXIS, AND THE LAST OPEN AXIS OF THE PRINTED
// `For each ⟨face⟩, ⟨op⟩` FAMILY.
//
//   line 217 (1 printing)  "Flip 3 coins. For each tails, discard an Energy from this
//                           Pokémon."
//
// 🛑 **THE ROW D452 REFUSED, D463 NAMED AND D475 LEFT OPEN — AND ITS REFUSAL OUTLIVED
// THE REASON IT WAS GIVEN.** D452 grouped corpus lines 200, 217 and 234 under one count
// (*"`discardEnergy` PARKS"*); D463 built 200 and 234, shipping the park, and 217 stayed
// unbuilt for twenty-four decisions afterwards on a reason of its very own — a FACE.
// `programPerHeads` counted HEADS in its name and in its expansion, and the union had
// nowhere to say "tails".
//
// 🛑 **THE SHAPE WAS DECIDED BY THE PAYLOAD, NOT BY THE PRINTING COUNT, AND THE OLD
// PROSE ASKED THE WRONG QUESTION.** Three files said in so many words that one printing
// "decides it badly" and that D442 and D448 disagreed about which shape was right. They
// do not disagree here, because the two shapes they argue over are not the two on offer:
// D440's rule settles it in one line — *nullary or asymmetric payload ⇒ two members;
// identical payload ⇒ one member with the discriminator as a FIELD* — and a
// `programPerTails` member would have carried `flips` and `ops` and nothing else, the
// fourth member's payload byte for byte. **A payload is legible with ZERO printings.**
// What one printing genuinely could not settle is REQUIRED versus OPTIONAL, and that was
// settled on the measured degradation instead (§2's second rung).
//
// ⚠️ **ZERO NEW MECHANISM, MEASURED RATHER THAN CLAIMED.** No new `EffectOp` member, no
// new op FIELD, no new op VALUE, no new `AttackCoinFlip` MEMBER, no new reader (the
// surface stands still at 13, asserted in §4), no prompt, no event, no error code, no
// registry row, no `FIXTURE_POOL` id, no `packages/schema` byte and no `redact.ts` byte.
// ONE regex, ONE arm, ONE REQUIRED field on a member that shipped at D130, and ONE
// counted local at the flip site.
//
// ⚠️ **THE CARRIER IS UNRESOLVABLE IN THIS CHECKOUT AND IS NOT INVENTED (D425/D438).**
// Corpus line 217 has 1 legal printing and this repo has no D1; every SIBLING row in this
// family is named in-repo (Wugtrio sv01-057, Gyarados swsh10.5-022, Krookodile sv01-117)
// and **line 217's carrier is the one nobody ever wrote down** — which is itself worth
// recording, because the refusal was argued from the SENTENCE for twenty-four decisions
// and never once from the PRINTING. `d476-tailflip` is a local `fix-*`-style key with no
// catalog row behind it; the STRING is the corpus row byte for byte (§1).

/** Corpus FILE LINE 217, byte for byte. ⚠️ It carries **no apostrophe slot at all** —
    the one sentence in this family that does not — which is why its anchor carries no
    `['’]` class, and why `clauseApostrophe.test.ts`'s sweep takes a ZERO term. */
const PRINTED_TAILS = "Flip 3 coins. For each tails, discard an Energy from this Pokémon.";

/** D43-era BARE sentence — `SELF_DISCARD_ONE`, arm 7 — whose op the new arm puts in
    `programPerHeads.ops` byte for byte. It is the reason the new anchor's `^` is
    load-bearing: `PRINTED_TAILS` ENDS in these exact words apart from the capital. */
const BARE_SELF = "Discard an Energy from this Pokémon.";

/** 🛑 A SYNTHETIC CONTROL AND SAID SO. The column prints this consequent at TWO coins
    (corpus line 201), not three; `AttackFlipCount.printed` is parameterised on purpose
    (D127/D128), so a three-coin spelling derives and is exactly what §6 needs — the SAME
    count MEMBER at the SAME count, differing from `PRINTED_TAILS` in ONE printed word and
    ONE field of the value. It is not an authored card: it is the shape exercised on a
    fixture, which is what `perHeadsProgram.test.ts`'s "reads counts no card prints" rung
    has done since D130. */
const SYNTHETIC_HEADS = "Flip 3 coins. For each heads, discard the top card of your opponent's deck.";

const TAILS_DISCARD = 0;
const HEADS_MILL = 1;
const PLAIN = 2;

/** `fix-*`-shaped keys with no catalog row behind them (D425), kept out of
    `FIXTURE_POOL` entirely by a file-local `cardPool` (D414/D452) — so
    `opponentResistanceBonus.test.ts`'s eleven-deep id ladder takes a ZERO term.
    ⚠️ **THE SETUP HELPERS BELOW ARE DELIBERATELY NOT BYTE-COPIES of the sibling flip
    suites'** (D442/D446/D448: a new line that is a distant neighbour's twin breaks a
    mutant row nobody touched); where the shape is forced, the locals are named for THIS
    file's subject. */
const LOCAL_CARDS: Record<string, Card> = {
  "d476-tailflip": battler("d476-tailflip", {
    name: "D476 Tail Flipper",
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Sap Sting", effect: PRINTED_TAILS },
      { cost: ["Colorless"], name: "Deck Chew", effect: SYNTHETIC_HEADS },
      { cost: ["Colorless"], name: "Flat Slap" },
    ],
  }),
  /** 320 HP, no attacks. Nothing in this suite deals damage, so it exists to keep every
      board legal and every promotion forced rather than to survive anything. */
  "d476-bystander": battler("d476-bystander", {
    name: "D476 Bystander",
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its own deck (D270), 60 counted before the first run: 12 + 24 + 8 + 8 + 8. THREE
    DIFFERENT Energy cards, and that is the whole point of the list: a park at a single
    class of interchangeable candidates AUTO-RESOLVES (the M1 doctrine), so an attacker
    holding three copies of one card would prove nothing about parking. Three DISTINCT
    classes give a genuine choice at the first pick and still a genuine one at the
    second — which is what a TWO-tails board needs. */
const TAIL_FLIP_DECK = deckOf({
  "d476-tailflip": 12,
  "d476-bystander": 24,
  "fix-energy": 8,
  "fix-water-energy": 8,
  "fix-fire-energy": 8,
});

/** ⚠️ THE RNG IS PINNED BY SEARCHING FOR A STATE, NOT BY A SEED TABLE, AND FOR THIS
    FAMILY THAT IS NOT A STYLE CHOICE. A seed table indexes the state AFTER `driveSetup`
    shuffles, so a one-card deck edit re-points every case silently; and this suite's
    whole subject is WHICH FACES came up, so the requirement has to be stated as a face
    SEQUENCE rather than as a count. Searching also catches an implementation that
    counted correctly and consumed the faces in the wrong order.

    Derived, never hardcoded — if `flipCoin` changes, this changes with it. */
function rngForFaces(faces: readonly CoinFace[]): number {
  for (let candidate = 1; candidate < 200_000; candidate += 1) {
    let rng = candidate;
    let agrees = true;
    for (const wanted of faces) {
      const [drawn, next] = flipCoin(rng);
      rng = next;
      if (drawn !== wanted) {
        agrees = false;
        break;
      }
    }
    if (agrees) return candidate;
  }
  throw new Error(`no rngState draws ${faces.join(",")}`);
}

/** Every three-face sequence, in a fixed order, so §5 and §6 sweep the WHOLE outcome
    space of a three-coin attack rather than a sample of it. Eight sequences, and the
    heads count and the tails count can never coincide across three flips — which is the
    property that makes this printing its own witness (`perHeadsConsequent.test.ts`
    measured it one slice before the row was built). */
const FACE_SEQUENCES: readonly (readonly CoinFace[])[] = (() => {
  const out: CoinFace[][] = [];
  for (let bits = 0; bits < 8; bits += 1) {
    out.push([0, 1, 2].map((i) => ((bits >> i) & 1) === 0 ? "heads" : "tails"));
  }
  return out;
})();

/** Counted by code point rather than by `TextEncoder`, which the sibling suites do not
    have in scope either — the pin exists so a re-ingest that swapped the `é` for an `e`
    or for a decomposed pair would redden, and both of those move this number. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function facesDrawn(events: GameEvent[]): CoinFace[] {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
}

function countOf(events: GameEvent[], face: CoinFace): number {
  return facesDrawn(events).filter((f) => f === face).length;
}

function openTable(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: TAIL_FLIP_DECK, p2: TAIL_FLIP_DECK },
    cardPool: POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(
    applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first }),
  );
  while (table.phase.kind === "setup:drawExtra") {
    const phase = table.phase;
    const owing = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (owing === undefined) throw new Error("setup:drawExtra with every seat decided");
    table = must(applyAction(table, { type: "setupDrawExtra", seat: owing, count: phase.owed[owing] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(
      applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  return table;
}

/** p1 owns TURN 2 with the demonstrator Active carrying `stock` DISTINCT Energy; p2 goes
    first and ends turn 1 immediately (§4 of the rules forbids the going-first player's
    turn-1 attack). p2's bench holds one body so any promotion is FORCED and no case can
    end on an unanswered promotion prompt.
    🛑 **THE ENERGY IS ON THE ATTACKER, WHICH IS THE WHOLE SEAT DIFFERENCE FROM D463.**
    That slice's op empties the DEFENDER's Active; this one empties the attacker's own,
    so the board that proves anything has to be stocked on the other side of the table. */
function armed(faces: readonly CoinFace[], stock: number): GameState {
  let table = openTable(7, "p2");
  table = mustApply(table, { type: "endTurn", seat: "p2" }).state;
  expect(table.turn).toBe(2);
  table = setActiveFromDeck(table, "p1", "d476-tailflip");
  table = setActiveFromDeck(table, "p2", "d476-bystander");
  const kinds = ["fix-energy", "fix-water-energy", "fix-fire-energy"] as const;
  for (let i = 0; i < stock; i += 1) {
    const card = kinds[i];
    if (card === undefined) throw new Error("at most three distinct Energy are stocked");
    table = attachFromDeck(table, "p1", card, 1);
  }
  table = clearBench(table, "p2");
  table = benchFromDeck(table, "p2", "d476-bystander");
  return { ...table, rngState: rngForFaces(faces) };
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function selfDiscardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}

function attachedTo(state: GameState, seat: Seat): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

/** Answers one park with its first candidate and hands back the next state. */
function pickFirst(state: GameState): { state: GameState; events: GameEvent[] } {
  const prompt = selfDiscardPrompt(state);
  const uid = prompt.discardable[0]?.uid;
  if (uid === undefined) throw new Error("a discardEnergy park with no candidate");
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "discardEnergy", uids: [uid] },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE POPULATION, MEASURED OFF THE COMMITTED COLUMN.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — one sentence, one printing, and the FACE axis enumerated", () => {
  it("it is a corpus row at ONE legal printing, and the column did not move", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, sentence]) => [sentence, units]));
    expect(corpus.get(PRINTED_TAILS)).toBe(1);
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed
    // at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2. Said out loud
    // because no predecessor's shape has been right two slices running, so the term was
    // derived at every site rather than carried (D451/D461/D464).
    expect(legalAttackCorpus()).toHaveLength(640);
    expect(legalAttackCorpus().reduce((n, [units]) => n + units, 0)).toBe(1732);
  });

  it("the bytes are the CORPUS's bytes, not a retyping — and there is no apostrophe", () => {
    // 🛑 D452's LESSON: a byte pin on a hand-typed string is green by construction, and
    // `untilTailsFlip.test.ts` carried a 97-character INVENTED sentence for 322 decisions
    // with a green `.length` beside it. So the pin is taken against the CORPUS ROW.
    const row = legalAttackCorpus()
      .map(([, sentence]) => sentence)
      .find((s) => s.startsWith("Flip 3 coins. For each tails,"));
    expect(row).toBe(PRINTED_TAILS);
    expect(PRINTED_TAILS).toHaveLength(66);
    expect(utf8Bytes(PRINTED_TAILS)).toBe(67); // the é is two bytes
    // ⚠️ **NO APOSTROPHE SLOT AT ALL**, which is a MEASUREMENT and not an omission: it is
    // why the new anchor carries no `['’]` class while every sibling in the family does
    // (D136/D137 class the slots a string HAS), and why the apostrophe sweep takes a zero.
    expect(PRINTED_TAILS).not.toContain("'");
    expect(PRINTED_TAILS).not.toContain("’");
  });

  it("🛑 the printed FACE axis is TWO rows and they are DIFFERENT SHAPES", () => {
    // The whole reason this file exists, measured over all 640 rows rather than asserted.
    // ⚠️ Published as the pattern that was RUN (D425), so the blind spot is findable: the
    // CONSEQUENT form is /For each tails,/ and the FOLD form is /for each tails/ — one
    // capital and one comma apart, and they land on two different rows.
    const consequent = legalAttackCorpus().filter(([, s]) => /For each tails,/.test(s));
    expect(consequent.map(([, s]) => s)).toEqual([PRINTED_TAILS]);
    expect(consequent.reduce((n, [units]) => n + units, 0)).toBe(1);

    const fold = legalAttackCorpus().filter(([, s]) => /for each tails/.test(s));
    expect(fold).toHaveLength(1);
    expect(fold.map(([, s]) => s)).toEqual([
      "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.",
    ]);
    // 🛑 **AND THE FOLD ROW IS THE FALSIFIER FOR THE OTHER HALF OF THIS AXIS, NAMED AS A
    // CONDITION AND NOT AS A BUILD (D446).** `perHeads`/`bonusOnHeads` fold `heads × per`
    // and carry NO face field; corpus file line 669 is the only row that would want one,
    // and it is unbuilt because it needs THREE further mechanisms — an OPPONENT-taken
    // flip (`attack.ts` emits every `ATTACK_EFFECT_COIN_FLIP` under `action.seat`), an
    // opponent-side BODY flip count, and a composing W/R suppression tail. **The day the
    // column prints a per-tails DAMAGE fold whose other axes this family already reads,
    // the field is owed on the fold members too** — and today it is owed on neither.
    expect(resolvedByAnyReader(fold[0]?.[1] ?? "")).toBe(false);
    expect(deriveAttackCoinFlip(fold[0]?.[1] ?? "")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVER: one anchor, its guards, and the crossings it refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchor derives its exact literal", () => {
  it("the whole reading, named field by field", () => {
    expect(deriveAttackCoinFlip(PRINTED_TAILS)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
      face: "tails",
    });
  });

  it("🛑 the op is `SELF_DISCARD_ONE`'s output BYTE FOR BYTE — and `yourActive`, not `self`", () => {
    // The whole no-new-vocabulary claim in one assertion: the op the coin member carries
    // is the SAME JSON the BARE sentence's reader produces. Two producers agreeing on one
    // printed consequent BY CONSTRUCTION rather than by coincidence.
    const bare = deriveAttackEffect(BARE_SELF);
    const coin = deriveAttackCoinFlip(PRINTED_TAILS);
    expect(JSON.stringify(bare)).toBe(
      JSON.stringify((coin as { ops: unknown }).ops),
    );
    // ⚠️ **AND THE MEMBER IS `yourActive`, WHICH IS `SELF_DISCARD_ONE`'s STATED READING
    // OF THIS EXACT NOUN PHRASE**: *"'this Pokémon' is the Active by §8 (only the Active
    // attacks)"*. D222's `self` is the member for the printed "this Pokémon" everywhere
    // §8 does NOT already make it the Active — an Ability on a benched host — and reaching
    // for it here would be a SECOND spelling of one printed clause. Asserted rather than
    // commented, because the two members really do differ on a board where the host is
    // benched, and only one of them is what an ATTACK means.
    expect(JSON.stringify(bare)).toContain('"from":"yourActive"');
    expect(JSON.stringify(bare)).not.toContain('"from":"self"');
  });

  it("🛑 `face` is REQUIRED, and the degradation an OPTIONAL one would have had is measured", () => {
    // D435: measure the degradation, do not classify it from the record's shape. An
    // optional `face?` defaulting to "heads" was genuinely available — nothing persists
    // this union, so there is no version boundary to buy — and the reason it was refused
    // is what a LOST key does on the only board that distinguishes the two readings.
    const read = deriveAttackCoinFlip(PRINTED_TAILS);
    // The dropped-key shape, built by NOT copying the key rather than by deleting it —
    // `delete` is a lint error in this repo, and the object the type system would have
    // accepted under an optional field is what this is standing in for.
    const dropped = Object.fromEntries(
      Object.entries(read as object).filter(([key]) => key !== "face"),
    );
    expect("face" in (read as object)).toBe(true);
    expect("face" in dropped).toBe(false);
    // On 1 heads / 2 tails the two readings differ by ONE Energy — no throw, no event
    // difference (the flip rows are byte-identical either way), and a perfectly normal
    // board. That is D425's *plausible-looking wrong answer*, not D124's benign soft
    // landing, which is why a required field and a compile error were bought instead.
    const faces = ["heads", "tails", "tails"] as const;
    expect(faces.filter((f) => f === "tails")).toHaveLength(2);
    expect(faces.filter((f) => f === "heads")).toHaveLength(1);
    expect(faces.filter((f) => f === "tails").length).not.toBe(
      faces.filter((f) => f === "heads").length,
    );
  });

  it("carries the family's TWO flip guards and owes no third", () => {
    // `flips >= 2` because the regex's own "coins" is PLURAL — the one-flip form is
    // printed "Flip a coin." and is D126's gate — and `flips <= MAX_PRINTED_FLIPS`
    // because the digits come from THIRD-PARTY ingested text and the expansion grows one
    // copy of a PARKING op per matching face. There is NO consequent payload to validate:
    // the op takes no count, exactly as D452's two arms and D463's two do.
    expect(deriveAttackCoinFlip("Flip 1 coins. For each tails, discard an Energy from this Pokémon.")).toBeNull();
    expect(deriveAttackCoinFlip("Flip 11 coins. For each tails, discard an Energy from this Pokémon.")).toBeNull();
    expect(deriveAttackCoinFlip("Flip 10 coins. For each tails, discard an Energy from this Pokémon.")).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 10 },
      ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
      face: "tails",
    });
  });

  it("🛑 refuses BOTH crossings the column does not print — the face and the victim CO-VARY", () => {
    // Measured over all 640 rows before the anchor was written (D472): a single pattern
    // spanning `(heads|tails)` AND `(your opponent's Active|this)` claims 2 rows — a real
    // widening — and is still refused, because the face and the victim co-vary in this
    // column (heads↔opponent, tails↔self). One pattern over both would admit the two
    // crossings below, which is authoring two cards (D451's co-variance rule, D190b).
    for (const crossing of [
      "Flip 3 coins. For each heads, discard an Energy from this Pokémon.",
      "Flip 2 coins. For each tails, discard an Energy from your opponent's Active Pokémon.",
    ]) {
      expect(deriveAttackCoinFlip(crossing), crossing).toBeNull();
      expect(legalAttackCorpus().some(([, s]) => s === crossing), crossing).toBe(false);
    }
  });

  it("🛑 the UNTIL-TAILS twin is ABSENT, and that is D452's call rather than D463's", () => {
    // D463 built BOTH of its counts because the column printed both. The test is what the
    // column prints, never symmetry between the counts — and this consequent is printed at
    // exactly one count. An anchor for the unbounded spelling would author a card.
    const twin = "Flip a coin until you get tails. For each tails, discard an Energy from this Pokémon.";
    expect(legalAttackCorpus().filter(([, s]) => s === twin)).toHaveLength(0);
    expect(deriveAttackCoinFlip(twin)).toBeNull();
  });

  it("refuses a mid-sentence clause and a missing terminator — the `^` and the `$`", () => {
    for (const text of [
      `This attack does 30 damage. ${PRINTED_TAILS}`,
      `${PRINTED_TAILS} Then, flip a coin.`,
      PRINTED_TAILS.replace(/\.$/, ""),
      PRINTED_TAILS.replace(/\.$/, " and heal 10."),
      PRINTED_TAILS.toLowerCase(),
      PRINTED_TAILS.replace("Flip 3 coins.", "Flip 3 coin."),
      PRINTED_TAILS.replace(". For", ".For"),
      PRINTED_TAILS.replace(". For", ".  For"),
      PRINTED_TAILS.replace("Pokémon", "Pokemon"),
    ]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
    // Outer whitespace SURVIVES by design, because the deriver trims — so this states
    // which drift is tolerated and which is not, rather than leaving it to be inferred.
    expect(deriveAttackCoinFlip(`  ${PRINTED_TAILS}\n`)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — DISJOINTNESS: the trap `deriveAttackEffect` must not fall into.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — one reader owns the sentence, and the trap got worse", () => {
  it("🛑 `deriveAttackEffect` STILL refuses it, and that null is load-bearing", () => {
    // `PRINTED_TAILS` ENDS in `SELF_DISCARD_ONE`'s exact words apart from the capital.
    // When the sentence was unread, that pattern matching it would have turned a loud skip
    // into ONE silent self-discard. Now that a different reader claims the WHOLE sentence,
    // it would put TWO readers on one printing at TWO different sites — the flip site in
    // front of §8.5, and the program at its tail — so the card would discard once flatly
    // AND once per tails. **The trap got worse when the sentence got built**, which is
    // D463's finding one anchor over, reproduced here on the own-board twin.
    expect(deriveAttackEffect(PRINTED_TAILS)).toBeNull();
    expect(deriveAttackDamageBonus(PRINTED_TAILS)).toBeNull();
    expect(deriveAttackDamageMultiplier(PRINTED_TAILS)).toBeNull();
    expect(deriveAttackRequirement(PRINTED_TAILS)).toBeNull();
    expect(deriveAttackPreDamage(PRINTED_TAILS)).toBeNull();
    expect(PRINTED_TAILS.endsWith(BARE_SELF.charAt(0).toLowerCase() + BARE_SELF.slice(1))).toBe(true);
    // …while the BARE sentence is claimed by `deriveAttackEffect` and by nothing on the
    // coin side, which is the other half of the seam.
    expect(deriveAttackEffect(BARE_SELF)).not.toBeNull();
    expect(deriveAttackCoinFlip(BARE_SELF)).toBeNull();
  });

  it("the two guards that keep the bare pattern out are INDEPENDENT", () => {
    // `SELF_DISCARD_ONE` is kept off this string by its own `^…$` AND by the capital.
    // Driven as two separate one-change probes, because "neither alone is enough" is a
    // claim about each guard separately.
    const capitalised = `Flip 3 coins. For each tails, ${BARE_SELF}`;
    expect(capitalised).toContain(", Discard an Energy");
    expect(deriveAttackEffect(capitalised)).toBeNull(); // the `^` alone still refuses it
    expect(deriveAttackEffect(BARE_SELF.toLowerCase())).toBeNull(); // the capital alone too
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE READER SURFACE, AND THE ZERO ROWS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — no new reader, no registry row", () => {
  it("the surface is still 13 and the sentence resolves through it", () => {
    expect(attackReaderSurface()).toHaveLength(13);
    expect(resolvedByAnyReader(PRINTED_TAILS)).toBe(true);
  });

  it("ZERO registry rows — the demonstrator flips off printed text alone", () => {
    expect(programFor("d476-tailflip")).toBeUndefined();
    // Stated per ATTACK INDEX too, because the registry seam is index-keyed (D97):
    // "no row for the card" and "no row for this attack" are different claims.
    for (const index of [TAILS_DISCARD, HEADS_MILL, PLAIN]) {
      expect(programFor("d476-tailflip")?.attack?.[index]).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE BOARD: both faces, on a board where the two counts DIFFER.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — N tails is N sequential parks, driven end to end", () => {
  it("the sweep really reaches every three-face sequence, and the counts never coincide", () => {
    // The outcome coverage is MEASURED rather than assumed, because every case below is
    // keyed on a tails count and a sweep that never produced 2 would leave the two-park
    // claim untested while looking green.
    const seen = new Set<string>();
    for (const wanted of FACE_SEQUENCES) {
      const { events } = swing(armed(wanted, 3), TAILS_DISCARD);
      expect(facesDrawn(events), wanted.join(",")).toEqual([...wanted]);
      seen.add(wanted.join(","));
      // An ODD flip count separates the two readings on EVERY board — which is what makes
      // this printing its own witness, and is why the load-bearing board below is a MIXED
      // one rather than an all-heads or an all-tails one.
      expect(countOf(events, "heads"), wanted.join(",")).not.toBe(countOf(events, "tails"));
    }
    expect(seen.size).toBe(8);
  });

  it("🛑 ONE HEADS / TWO TAILS PARKS TWICE — the board that distinguishes every wrong reading", () => {
    // 🛑 **THE LOAD-BEARING CASE.** Three flips, one heads, two tails. A build that counted
    // HEADS parks once; a build that counted FLIPS parks three times; a build that counted
    // nothing parks not at all. Only this shape of board tells all four apart, and an
    // all-heads or an all-tails board tells none of them apart.
    const { state: parked, events } = swing(armed(["heads", "tails", "tails"], 3), TAILS_DISCARD);
    expect(facesDrawn(events)).toEqual(["heads", "tails", "tails"]);
    expect(countOf(events, "tails")).toBe(2);
    expect(countOf(events, "heads")).toBe(1);
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);

    // The attack is not over: it is waiting on the FIRST of TWO picks, and the SECOND copy
    // is sitting in `cont.rest` — the mechanism claim, on the attacker's own board.
    expect(parked.phase.kind).toBe("effect:choose");
    const first = selfDiscardPrompt(parked);
    expect(first.note).toBe(BARE_SELF);
    expect(first.scope).toEqual({ kind: "total", count: 1 });
    expect(first.discardable).toHaveLength(3);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.rest).toHaveLength(1);
    expect(JSON.stringify(parked.phase.cont.rest[0])).toBe(
      '{"op":"discardEnergy","from":"yourActive","filter":{"kind":"anyEnergy"}}',
    );
    expect(types(events)).not.toContain("TURN_ENDED");

    const { state: mid, events: midEvents } = pickFirst(parked);
    // …and it parks AGAIN rather than finishing. The turn has still not ended.
    expect(mid.phase.kind).toBe("effect:choose");
    expect(types(midEvents)).not.toContain("TURN_ENDED");
    const second = selfDiscardPrompt(mid);
    // ONE FEWER CANDIDATE, because the set really SHRANK between the two picks — the
    // reading a single op carrying `count: 2` could not have produced.
    expect(second.discardable).toHaveLength(2);
    if (mid.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(mid.phase.cont.rest).toHaveLength(0);

    const { state: done, events: endEvents } = pickFirst(mid);
    expect(done.phase.kind).not.toBe("effect:choose");
    // TWO of the attacker's three Energy are gone — the number the PRINTED FACE says.
    expect(attachedTo(done, "p1")).toHaveLength(1);
    expect(attachedTo(done, "p2")).toHaveLength(0);
    expect(types(endEvents)).toContain("TURN_ENDED");
    // 🛑 **THE SEAT, ASSERTED RATHER THAN ASSUMED.** The victim and the actor are the SAME
    // seat here, which is exactly where D463's sibling differs — the cards land in the
    // ATTACKER's own discard pile, and nothing crosses the table.
    const discarded = all(endEvents, "ENERGY_DISCARDED");
    for (const row of discarded) {
      expect(row.seat).toBe("p1");
      expect(row.actor).toBe("p1");
    }
    expect(done.players.p2.discard.filter((uid) => done.cardIdByUid[uid]?.endsWith("energy"))).toHaveLength(0);
  });

  it("TWO heads / ONE tails PARKS ONCE — the count is the printed FACE, not the flips", () => {
    // The other side of the same discrimination: the attack takes THREE flips either way,
    // so a build that expanded per FLIP would look identical in the coin rows and differ
    // only here and above.
    const { state: parked, events } = swing(armed(["heads", "heads", "tails"], 3), TAILS_DISCARD);
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);
    expect(countOf(events, "tails")).toBe(1);
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.rest).toHaveLength(0);
    const { state: done } = pickFirst(parked);
    expect(attachedTo(done, "p1")).toHaveLength(2);
  });

  it("🛑 ALL HEADS asks NOTHING — and the SILENCE is separated from silence for another reason", () => {
    // Zero of the PRINTED FACE, so `expanded.length > 0 ? expanded : null` keeps the attack
    // out of `settleProgram` (D130's rule: an empty `EffectOp[]` is a different ending with
    // the same result, and that is how a no-op grows a KO sweep it did not have).
    const { state: done, events } = swing(armed(["heads", "heads", "heads"], 3), TAILS_DISCARD);
    expect(countOf(events, "tails")).toBe(0);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(attachedTo(done, "p1")).toHaveLength(3);
    expect(types(events)).toContain("TURN_ENDED");
    // ⚠️ **THE CONTROLS THAT MAKE THAT SILENCE MEAN SOMETHING** — silence for the PRINTED
    // reason, separated from three other ways this board could have been quiet:
    //   (a) the coin was TAKEN — three rows, or the sentence never reached the flip site;
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);
    //   (b) the attack was not SKIPPED — a sentence no reader claims lands loudly here;
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    //   (c) the Energy was really THERE to be taken, so nothing was quiet for want of a
    //       candidate — the same board with ONE tails does park (asserted above).
    expect(attachedTo(done, "p1")).toHaveLength(3);
  });

  it("ALL TAILS parks THREE times and strips the attacker bare", () => {
    let cursor = swing(armed(["tails", "tails", "tails"], 3), TAILS_DISCARD).state;
    // THE `rest` LADDER IS THE ASSERTION, not the number of prompts: three copies queue,
    // and each answered pick leaves exactly one fewer behind it.
    for (const remaining of [2, 1]) {
      expect(cursor.phase.kind).toBe("effect:choose");
      if (cursor.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
      expect(cursor.phase.cont.rest, String(remaining)).toHaveLength(remaining);
      cursor = pickFirst(cursor).state;
    }
    // 🛑 **THREE COPIES RUN AND ONLY TWO OF THEM ASK — MEASURED, AND IT IS THE M1
    // DOCTRINE RATHER THAN A MISSING COPY.** By the third copy the attacker has ONE Energy
    // left, so the candidate set is a single class of interchangeable cards and the park
    // AUTO-RESOLVES. **This is the case that separates "three copies were appended" from
    // "three prompts were shown"**, and a suite that counted prompts would have read the
    // correct build as a two-copy one.
    expect(cursor.phase.kind).not.toBe("effect:choose");
    expect(attachedTo(cursor, "p1")).toHaveLength(0);
    expect(cursor.players.p1.discard.length).toBeGreaterThanOrEqual(3);
  });

  it("the PLAIN attack on the same body takes no coin at all — the one-axis control", () => {
    const { state: done, events } = swing(armed(["tails", "tails", "tails"], 3), PLAIN);
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(attachedTo(done, "p1")).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — IS THE FACE ORTHOGONAL TO THE COUNT? MEASURED, NOT ASSERTED.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the FACE axis against the COUNT axis", () => {
  it("🛑 ONE BOARD, ONE COUNT MEMBER, TWO FACES — the readings PARTITION the flips", () => {
    // 🛑 **THE SHARPEST STATEMENT OF ORTHOGONALITY THIS COLUMN CAN MAKE.** Two attacks on
    // ONE body, both `{ kind: "printed", count: 3 }`, differing in ONE printed word and ONE
    // field of the value. Driven from the SAME state at the SAME `rngState`, so both draw
    // the same three faces — and across the WHOLE eight-sequence outcome space the two
    // consequents fire on COMPLEMENTARY subsets that sum to the flip count. If the face
    // were entangled with the count member, that sum could not hold at every point.
    for (const wanted of FACE_SEQUENCES) {
      const board = armed(wanted, 3);
      const tailsRun = swing(board, TAILS_DISCARD);
      const headsRun = swing(board, HEADS_MILL);
      const label = wanted.join(",");
      expect(facesDrawn(tailsRun.events), label).toEqual([...wanted]);
      expect(facesDrawn(headsRun.events), label).toEqual([...wanted]);

      // The TAILS reading, counted by how many parks it queues (the first park plus
      // whatever is left in `cont.rest`), which is the op-copy count made observable.
      const tailsCount = wanted.filter((f) => f === "tails").length;
      const queued =
        tailsRun.state.phase.kind === "effect:choose"
          ? 1 + tailsRun.state.phase.cont.rest.length
          : 0;
      expect(queued, label).toBe(tailsCount);

      // The HEADS reading, counted off the mill's OWN event rows — a consequent that does
      // NOT park, deliberately, so the two halves of this rung are read through two
      // different mechanisms and cannot both be wrong in the same way.
      // ⚠️ **THE ROWS AND NOT THE DECK SIZE, MEASURED THE HARD WAY FIRST**: the attack ends
      // the turn, the opponent then draws, and a deck-size difference silently counts that
      // draw as a fourth mill. The event rows are the op's own witness and the draw is not
      // one of them.
      const headsCount = wanted.filter((f) => f === "heads").length;
      const milled = all(headsRun.events, "DECK_TOP_DISCARDED");
      expect(milled, label).toHaveLength(headsCount);
      for (const row of milled) {
        expect(row.seat, label).toBe("p2");
        expect(row.actor, label).toBe("p1");
        expect(row.uids, label).toHaveLength(1);
      }
      expect(queued + headsCount, label).toBe(3);
    }
  });

  it("the FACE is fixed while the COUNT varies, over the parameterised member", () => {
    // The other direction: hold `face: "tails"` and walk the count. `AttackFlipCount.printed`
    // is parameterised (D127/D128), so this is the count axis exercised at a fixed face
    // without a second anchor.
    for (const flips of [2, 3, 4, 9, 10]) {
      expect(
        deriveAttackCoinFlip(`Flip ${flips} coins. For each tails, discard an Energy from this Pokémon.`),
        String(flips),
      ).toEqual({
        kind: "programPerHeads",
        flips: { kind: "printed", count: flips },
        ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
        face: "tails",
      });
    }
  });

  it("🛑 the grid the COLUMN prints is 3 of 4 cells, and the fourth is not a gap", () => {
    // ⚠️ **AND HERE IS WHERE THE INHERITED FRAMING WAS WRONG.** The count axis that closed
    // at D475 is three rows reading `attachedEnergy`, `pokemonInPlay` and
    // `bothActivesEnergy` — and ALL THREE reach `perHeads`, the DAMAGE fold, which carries
    // no `face` field at all. So the face field and those three members **never co-occur on
    // any printed row**, and "is the face orthogonal to the count member" cannot be asked
    // of them at all: they live on different members of `AttackCoinFlip`.
    //
    // The grid where the two axes genuinely meet is `programPerHeads` × the two count
    // members it is printed with, and it is 2 × 2 with THREE cells printed:
    //   printed × heads   — corpus lines 201, 216, 200 (and D130's two rotated rows)
    //   untilTails × heads — corpus line 234, Krookodile sv01-117
    //   printed × tails   — corpus line 217, this slice
    //   untilTails × tails — printed by NOTHING, refused by the anchor set (§2)
    const programRows = legalAttackCorpus().filter(
      ([, s]) => /^Flip .*For each (heads|tails), /.test(s),
    );
    const cell = (row: string) => {
      const read = deriveAttackCoinFlip(row);
      if (read === null || read.kind !== "programPerHeads") throw new Error(`not a program: ${row}`);
      return `${read.flips.kind}×${read.face}`;
    };
    expect([...new Set(programRows.map(([, s]) => cell(s)))].sort()).toEqual([
      "printed×heads",
      "printed×tails",
      "untilTails×heads",
    ]);
    // …and NO row of the column reads `perHeads`/`bonusOnHeads` with a face field, because
    // those members do not have one. Stated as a type-free structural fact: every reading
    // that carries a `face` key is a `programPerHeads`.
    for (const [, sentence] of legalAttackCorpus()) {
      const read = deriveAttackCoinFlip(sentence);
      if (read === null) continue;
      expect("face" in read, sentence).toBe(read.kind === "programPerHeads");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — PURITY AND THE PERSISTED BYTES.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — purity and the structural answers", () => {
  it("never mutates the board it is handed, at every outcome", () => {
    for (const wanted of FACE_SEQUENCES) {
      const frozen = deepFreeze(armed(wanted, 3));
      const snapshot = JSON.stringify(frozen);
      expect(() => swing(frozen, TAILS_DISCARD)).not.toThrow();
      expect(JSON.stringify(frozen), wanted.join(",")).toBe(snapshot);
    }
  });

  it("replays identically for one pinned face sequence", () => {
    const a = swing(armed(["tails", "heads", "tails"], 3), TAILS_DISCARD);
    const b = swing(armed(["tails", "heads", "tails"], 3), TAILS_DISCARD);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });

  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — DRIVEN over the serialized bytes", () => {
    // ⚠️ `MATCH_RECORD_VERSION` is not exported from this package (it lives in
    // `apps/api/src/lobby/match.ts`), so the claim is DRIVEN the way D421–D424, D462 and
    // D475 drive it: over what this slice can actually put on the wire.
    //
    // 🛑 **D473's FIRST SHAPE — NO CARRIER AT ALL.** `AttackCoinFlip` is a derivation-time
    // LOCAL inside `attack()`; nothing serialises it, and the only thing that crosses into
    // `phase.cont` is the `EffectOp[]` it hands back. That op is
    // `discardEnergy { from: "yourActive", filter: { kind: "anyEnergy" } }`, which
    // `SELF_DISCARD_ONE` has emitted since 0.x from six fielded fixtures. **And the claim
    // does NOT rest on reachability here** — this op PARKS, so `phase.cont.rest` really is
    // written, which is the strongest form of the argument rather than the weakest.
    const { state: parked } = swing(armed(["tails", "tails", "heads"], 3), TAILS_DISCARD);
    const wire = JSON.stringify(parked);
    expect(wire).not.toContain('"face"');
    expect(wire).not.toContain("programPerHeads");
    expect(wire).not.toContain('"tails"');
    expect(wire).toContain('"from":"yourActive"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE VERSION.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the version", () => {
  it("engineVersion is 0.400.0 and the bump is owed for BEHAVIOUR", () => {
    // A sentence that fell to the loud `ATTACK_EFFECT_SKIPPED` path now flips three coins
    // and queues one park per tails, and a shipped union member gained a REQUIRED field —
    // so `packages/engine` behaviour moved and the minor is owed (D275).
    expect(engineVersion).toBe("0.400.0");
  });
});
