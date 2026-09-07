import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import { applyAction, engineVersion, programFor } from "./index";
import type { GameEvent, GameState, Seat, StatusName } from "./index";
import {
  DEFENDER_STATUS_PAIR_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.325.0 → 0.326.0 — D424, THE TWO-STATUS PAIR: *"Your opponent's Active Pokémon
// is now {X} and {Y}."* and its coin-flipped twin, TWO `applyStatus` ops in PRINTED
// ORDER behind two new anchors and one shared helper.
//
// 🛑 **WHAT THIS SLICE IS ACTUALLY ABOUT IS THE PAIR IT REFUSES.** The printed
// shape is trivial — two status words, two ops, a program `registry.ts` has shipped
// for Dangerous Laser `sv06.5-058` since D257. What the shape does NOT advertise is
// that `Asleep`, `Paralyzed` and `Confused` are three VALUES OF ONE FIELD
// (`SpecialConditions.rotation`), so a bare `(X) and (Y)` over the five status words
// would admit *"Asleep and Confused"* — a program whose second op silently
// overwrites its first, which RESOLVES, emits two `STATUS_APPLIED` rows, and leaves
// the board carrying ONE of the two printed conditions. That is a LIE THAT RESOLVES,
// and the conventions are explicit that a wrong-but-plausible program is strictly
// worse than an unbuilt one. §3 is the refusal and the population claim behind it.
//
// ⚠️ **THE WARRANT FOR A TEMPLATE RATHER THAN A LITERAL, MEASURED (D121).** Over the
// committed `legal_standard = 1` attack column (640 sentences / 1,732 printings)
// these two anchors claim 3 sentences / 5 printings carrying THREE DISTINCT PAIRS —
// Burned+Confused (3), Confused+Poisoned (1), Paralyzed+Poisoned (1) — and BOTH
// slots vary across them. D121 wants two printings with ONE token varying before a
// parameter is justified; this has two tokens varying across three pairs, so the
// warrant is satisfied on each axis separately (§2 asserts exactly that). A literal
// would also have cost MORE here, not less: the bare form alone needs two of them,
// because `splitAttackTrailingClause` reaches Confused+Poisoned through this same
// anchor (§5).
//
// ⚠️ **THE CARDS, READ COLUMN BY COLUMN OFF THE REMOTE D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) ON 2026-08-26** — not off memory, and not
// off the local catalog, which holds none of these four sets (978 cards / 6 sets:
// `sv01`, `sv02`, `sv03`, `sv06.5`, `sve`, `swsh10.5`). Every fixture is therefore a
// `fix-` key.

/** The bare pair, byte-for-byte off corpus row 678. ⚠️ **THE APOSTROPHE IS ASCII
    U+0027 AND THE `é` IS U+00E9 (`C3 A9`)** — measured with `hexdump -C` on the
    corpus line, not assumed. A brief for an earlier slice asserted U+2019 for a
    sibling sentence and was wrong; D423's was ASCII too. The anchors still carry the
    `['’]` class as insurance, which is the repo idiom (D136/D137) and is what stops a
    punctuation-only re-ingest from un-deriving every status attack at once. */
const BURN_CONFUSE = "Your opponent's Active Pokémon is now Burned and Confused.";
/** The coin-flipped twin at Confused+Poisoned — Ekans `sv05-100` "Poison Blend". */
const FLIP_CONFUSE_POISON =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Confused and Poisoned.";
/** The coin-flipped twin at Paralyzed+Poisoned — Glimmora `sv06-109` "Stun Poison". */
const FLIP_PARALYZE_POISON =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned.";
/** 🆕🆕 D478 — corpus FILE LINE 263, 2 printings: this family's pair on HEADS with a
    SINGLE status on TAILS. It is here because it is a genuine member of §2's sweep — its
    heads arm is `FLIP_DEFENDER_STATUS_PAIR`'s program byte for byte — and because the slot
    that used to hold it in `LEFT_LOUD` was refusing it for a reason that was never true. */
const HEADS_PAIR_TAILS_SINGLE =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused.";
/** The COMPOUND this slice claims WITHOUT writing an anchor for it — Accelgor
    `sv09-013` "Poisonous Ploy". Head is `DEFENDER_STATUS_PAIR`'s, tail is D189's. */
const CONFUSE_POISON_SWITCH =
  "Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.";

/** The three printed sentences of the same family this slice deliberately LEAVES on
    the loud path, each with its reason. Every one is a REAL printing in the same
    legal column — not a constructed near miss. */
const LEFT_LOUD = {
  /** 2 printings. A heads/tails compound with a DIFFERENT tail: `coinFlipGate`
      carries no tails branch, so the mechanism is absent rather than the anchor
      narrow.

      🛑🛑 **D478 — THE PARAGRAPH ABOVE IS KEPT VERBATIM (D178) AND ITS SECOND CLAUSE WAS
      FALSE ON THE DAY IT WAS WRITTEN.** `coinFlipGate.otherwise` shipped at **D269**
      (`0.184.0 → 0.185.0`, Picnicker/Drasna), `interpreter.ts` splices it with the same
      `unshift` that splices `then`, and `deriveAttackEffect` arm 6d has emitted a
      two-armed gate since **D416** — three hundred lines below the anchor whose comment
      said the mechanism was absent. What was missing was an ANCHOR and an ARM. D478 built
      corpus FILE LINE 263; it derives to ONE gate with BOTH arms filled and is driven in
      `flipStatusHeadsTails.test.ts`.

      ⚠️ **THE SLOT IS RE-POINTED AND NOT DELETED (D418), ONTO THE SUBJECT THAT STILL HAS
      THE OLD PROPERTY (D444).** The property is *a printed heads/tails compound whose
      branches this reader does not claim*, and over all 640 corpus rows exactly **three**
      sentences print both branches — file line 244 (built at D416), 263 (built here) and
      **268**, which is what this slot now holds. Its tails branch is *"this attack does
      nothing"*: an attack-level CANCEL resolving at the §8 declaration seam, which
      `deriveAttackEffect` has nowhere to put, so it is blocked by a SEAM rather than by a
      vocabulary and no widening of an anchor in this family can reach it.
      ⚠️ It is now load-bearing in three files; a successor building it owes the re-point. */
  headsTails:
    "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
  /** 🆕🆕 **RE-POINTED A SECOND TIME AT D464, AND THE PARAGRAPH IT REPLACES IS KEPT
      VERBATIM BELOW BECAUSE IT WAS WRONG IN AN INSTRUCTIVE WAY (D178).**

      D462 wrote, of corpus FILE LINE 264: *"`FLIP_DEFENDER_NOW` refuses it because a
      COMMA sits where its `\.$` demands a period; the pair and triple anchors refuse it
      because `(${STATUS_WORDS})` admits no comma and no verb. **Loosen any one of those
      three and this sentence is claimed with its Energy discard silently thrown away.**"*

      🛑 **TWO OF THE THREE ARE FALSE, AND ONE REGEX EACH DISPROVES THEM.** MEASURED over
      the whole 640-row column: loosening `FLIP_DEFENDER_STATUS_PAIR`'s second slot to
      `(.+)`, or dropping its `\.$`, claims line 263 and NOT line 264; and
      `DEFENDER_STATUS_TRIPLE` claims exactly one row under EVERY single-axis loosening it
      has, line 264 in none of them — it demands a SECOND comma that sentence never prints,
      and its `^Your opponent` prefix refuses the flip clause besides. **The
      `FLIP_DEFENDER_NOW` half was right**: dropping that `\.$` takes it from 2 rows / 29
      printings to 6 / 35, line 264 among the four gained.

      D464 then BUILT line 264 (`FLIP_DEFENDER_STATUS_THEN_DISCARD`), so this slot had to
      move regardless — and it moves onto the set the same probe NAMES rather than onto
      another guess. These are the THREE real printings that `DEFENDER_NOW`'s own `\.$`
      refuses: corpus FILE LINES 685, 686 and 690, one printing each, every one a real
      print whose second clause is an unbuilt mechanic. Drop that one byte and all three
      are claimed with that clause silently thrown away — which is exactly the job this
      slot has held since D424, pointed for the first time at an anchor that has it. */
  dotAnchorTrio: [
    "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
    "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.",
    "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, Energy cards can't be attached from your opponent's hand to that Pokémon.",
  ],
} as const;

/** 🛑 THE COLLISION SENTENCES, AND THEY ARE CONSTRUCTED — SAID OUT LOUD. No card
    prints two rotation statuses together (§3 pins that on the POPULATION), so this
    refusal can only ever be driven SYNTHETICALLY. That is the same standing as arm
    5d's pronoun clause, which no card prints alone either, and it is stated here for
    the reason the repo states it there: an arm with no printing behind it is a
    deliberate choice, and an undeclared one reads as an accident. */
const COLLISIONS = [
  "Your opponent's Active Pokémon is now Asleep and Confused.",
  "Your opponent's Active Pokémon is now Confused and Asleep.",
  "Your opponent's Active Pokémon is now Asleep and Paralyzed.",
  "Your opponent's Active Pokémon is now Paralyzed and Confused.",
  "Your opponent's Active Pokémon is now Confused and Paralyzed.",
  "Your opponent's Active Pokémon is now Paralyzed and Asleep.",
] as const;

/** One seed for the whole suite: nothing here depends on a shuffle. The two flip
    printings DO take a coin, and they are driven through both faces by seeding the
    board rather than by stubbing the RNG — see §4. */
const SEED = 11;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The two status words a derived program lands, or `null` when the program is not
    a pair — looking THROUGH a `coinFlipGate` so the bare form and the flipped form
    answer alike. It is the instrument §2 sweeps the whole column with, and it is
    deliberately keyed on the OPS rather than on the sentence: a regex that had
    drifted into a floating match would still be refused here, because what is
    checked is what the reader RETURNED. */
function statusPairOf(text: string): StatusName[] | null {
  const ops = deriveAttackEffect(text);
  if (ops === null) return null;
  const head = ops[0];
  const steps: EffectOp[] =
    ops.length === 1 && head !== undefined && head.op === "coinFlipGate" ? head.then : ops;
  if (steps.length !== 2) return null;
  const statuses = steps.map((o) => (o.op === "applyStatus" ? o.status : null));
  return statuses.every((x): x is StatusName => x !== null) ? statuses : null;
}

/** Every attacker this suite declares, with the PRINTED index and the energy its
    printed cost needs — read off the D1 row per printing (D144's rule). */
const ATTACKERS = {
  ninetales: { card: "fix-ninetales", index: 0, energy: [{ id: "fix-fire-energy", count: 2 }] },
  houndoom: { card: "fix-tr-houndoom", index: 0, energy: [{ id: "fix-fire-energy", count: 1 }] },
  "houndoom-scorch": {
    card: "fix-tr-houndoom",
    index: 1,
    energy: [
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  },
  ekans: { card: "fix-ekans", index: 0, energy: [{ id: "fix-dark-energy", count: 1 }] },
  glimmora: { card: "fix-glimmora", index: 0, energy: [{ id: "fix-energy", count: 1 }] },
  accelgor: {
    card: "fix-accelgor",
    index: 0,
    energy: [
      { id: "fix-grass-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  },
} as const;
type Attacker = keyof typeof ATTACKERS;

/** A board with `attacker` Active for `by` and `defender` Active for the other seat.
    `bench` keeps the attacker's bench (Accelgor's tail needs somewhere to switch to);
    every other board clears it, so a stray body can never absorb a switch. */
function board(
  attacker: Attacker,
  defender: string,
  { by = "p1" as Seat, bench = false, seed = SEED } = {},
): GameState {
  const opener: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: DEFENDER_STATUS_PAIR_DECK, p2: DEFENDER_STATUS_PAIR_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKERS[attacker].card);
  if (!bench) state = clearBench(state, by);
  for (const { id, count } of ATTACKERS[attacker].energy) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  state = clearBench(state, opener);
  return state;
}
function swing(state: GameState, attacker: Attacker, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
}

/** Re-text ONE attack on a board's OWN `cardPool` copy. ⚠️ **NOT A FIXTURE EDIT** —
    `FIXTURE_POOL` is shared by every suite in this package and D412 reddened three
    boards by widening a shared fixture. This mutates a per-board clone, so nothing
    outside the calling `it` can see it. It exists for the sentences that have NO
    printing — the rotation collisions of §3 — and for the two real printings this
    slice deliberately left loud (§7). */
function withEffect(state: GameState, cardId: string, effect: string): GameState {
  const card = state.cardPool[cardId];
  if (card === undefined) throw new Error(`no ${cardId} in pool`);
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error(`${cardId} has no attack 0`);
  return {
    ...state,
    cardPool: { ...state.cardPool, [cardId]: { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] } },
  };
}
/** The defender's live `SpecialConditions`, from the seat that is NOT attacking. */
function defenderConditions(state: GameState, by: Seat = "p1") {
  const active = state.players[by === "p1" ? "p2" : "p1"].active;
  if (active === null) throw new Error("no defender");
  return active.conditions;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, transcribed rather than recognised", () => {
  it("carries Ninetales sv06-027's WHOLE printed attack list verbatim", () => {
    expect(FIXTURE_POOL["fix-ninetales"]).toMatchObject({
      category: "Pokemon",
      stage: "Stage1",
      evolveFrom: "Vulpix",
      hp: 120,
      types: ["Fire"],
      retreat: 2,
      weaknesses: [{ type: "Water", value: "×2" }],
    });
    expect(FIXTURE_POOL["fix-ninetales"]?.abilities ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-ninetales"]?.attacks).toEqual([
      { cost: ["Fire", "Fire"], name: "Eerie Glow", effect: BURN_CONFUSE, damage: 90 },
    ]);
  });

  it("…and Team Rocket's Houndoom sv10-038's, whose pair attack prints NO damage", () => {
    // 🛑 THE SECOND BODY IS NOT DECORATION. This family's 3 legal printings are ONE
    // distinct sentence across TWO cards, so a reader keyed on anything but the TEXT
    // — an id, a type, a cost, the PRESENCE OF A DAMAGE KEY — would satisfy a
    // one-card suite and fail here. Ninetales is {R}{R} for 90; this is a bare {R}
    // with no `damage` key at all.
    expect(FIXTURE_POOL["fix-tr-houndoom"]).toMatchObject({
      stage: "Stage1",
      evolveFrom: "Team Rocket's Houndour",
      hp: 130,
      types: ["Fire"],
      retreat: 2,
    });
    expect(FIXTURE_POOL["fix-tr-houndoom"]?.attacks).toEqual([
      { cost: ["Fire"], name: "Cruel Coal", effect: BURN_CONFUSE },
      {
        cost: ["Fire", "Colorless"],
        name: "Scorching Fire",
        effect: "Discard an Energy from this Pokémon.",
        damage: 120,
      },
    ]);
    expect(FIXTURE_POOL["fix-tr-houndoom"]?.attacks?.[0]).not.toHaveProperty("damage");
  });

  it("…and the three flip/compound carriers, each at its PRINTED index", () => {
    expect(FIXTURE_POOL["fix-ekans"]?.attacks).toEqual([
      { cost: ["Darkness"], name: "Poison Blend", effect: FLIP_CONFUSE_POISON },
      { cost: ["Darkness", "Darkness"], name: "Bite", damage: 30 },
    ]);
    expect(FIXTURE_POOL["fix-glimmora"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Stun Poison", effect: FLIP_PARALYZE_POISON },
      {
        cost: ["Fighting"],
        name: "Venoshock",
        effect: "If your opponent's Active Pokémon is Poisoned, this attack does 100 more damage.",
        damage: "30+",
      },
    ]);
    expect(FIXTURE_POOL["fix-accelgor"]?.attacks).toEqual([
      { cost: ["Grass", "Colorless"], name: "Poisonous Ploy", effect: CONFUSE_POISON_SWITCH, damage: 70 },
    ]);
  });

  it("🛑 the sentences are the CORPUS's bytes, and the apostrophe is ASCII U+0027", () => {
    // D183's rule: author and assert against the printed bytes, never a paraphrase.
    // The corpus IS the `legal_standard = 1` attack column, so this is the strongest
    // available statement that the fixture text is the printed text.
    const rows = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(rows.get(BURN_CONFUSE)).toBe(3);
    expect(rows.get(FLIP_CONFUSE_POISON)).toBe(1);
    expect(rows.get(FLIP_PARALYZE_POISON)).toBe(1);
    expect(rows.get(CONFUSE_POISON_SWITCH)).toBe(1);
    expect(rows.get(LEFT_LOUD.headsTails)).toBe(2);
    // 🆕 D464 — the trio replaces `paralyzedComma`; all three are corpus rows, 1 printing
    // each (FILE LINES 685, 686, 690), and the transcription is asserted the same way.
    for (const text of LEFT_LOUD.dotAnchorTrio) expect(rows.get(text)).toBe(1);
    // The apostrophe byte, asserted rather than eyeballed.
    for (const s of [BURN_CONFUSE, FLIP_CONFUSE_POISON, FLIP_PARALYZE_POISON]) {
      expect(s.includes("opponent's")).toBe(true);
      expect(s.includes("opponent’s")).toBe(false);
      expect(s.includes("Pokémon")).toBe(true);
    }
  });

  it("no registry row shadows any of them — the deriver is what answers", () => {
    // D204's defect: `programFor(id)?.attack` reads the REGISTRY only, while attack
    // programs resolve `registry ?? deriveAttackEffect`. If a row existed the arm
    // would be dead code and this suite would be testing the row.
    for (const id of ["fix-ninetales", "fix-tr-houndoom", "fix-ekans", "fix-glimmora", "fix-accelgor"]) {
      expect(programFor(id)?.attack ?? null).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation, and the parameterisation on BOTH axes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, parameterised on both axes", () => {
  it("🛑 derives TWO `applyStatus` ops in PRINTED ORDER", () => {
    // Two ops and not one op with a list: `applyStatus`'s `status` is a single
    // `StatusName`. This is Dangerous Laser sv06.5-058's shipped registry program
    // (`registry.ts`, the SAME sentence in the Trainer channel) reached from the
    // attack side — cited rather than reinvented — and arm 5c's ops-in-printed-order
    // rule.
    expect(deriveAttackEffect(BURN_CONFUSE)).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
      { op: "applyStatus", target: "defender", status: "confused" },
    ]);
  });

  it("🛑 the ORDER is the PRINTED order, not a canonical one", () => {
    // The sharpest single assertion in §2: if the arm sorted, normalised or
    // slot-ordered its two ops, this would still land both conditions and every
    // model assertion in §4 would still pass. Only the ORDER can see it.
    const printedFirst = deriveAttackEffect(BURN_CONFUSE) as { status: string }[];
    expect(printedFirst.map((o) => o.status)).toEqual(["burned", "confused"]);
    // …and a sentence whose printed order is the OTHER way round comes back the
    // other way round. `Confused and Poisoned` puts the ROTATION word first, where
    // `Burned and Confused` puts it second — so between the two, neither
    // "rotation first" nor "independent first" is a rule the arm could be using.
    const other = deriveAttackEffect(
      "Your opponent's Active Pokémon is now Confused and Poisoned.",
    ) as { status: string }[];
    expect(other.map((o) => o.status)).toEqual(["confused", "poisoned"]);
  });

  it("🛑 BOTH SLOTS are parameters — the D121 warrant, on the printed pool", () => {
    // The template-vs-literal call, made from the pool rather than asserted. THREE
    // distinct pairs are printed and both slots move across them: slot X takes
    // Burned, Confused and Paralyzed; slot Y takes Confused and Poisoned. A literal
    // over a pool of one is what D121 refuses, and this is the opposite of that.
    const distinct = new Set(
      legalAttackCorpus()
        .map(([, sentence]) => statusPairOf(sentence))
        .filter((pair): pair is StatusName[] => pair !== null)
        .map((pair) => pair.join("+")),
    );
    expect([...distinct].sort()).toEqual([
      "burned+confused",
      "confused+poisoned",
      "paralyzed+poisoned",
    ]);
    // Both axes, spelled separately — the claim is "two parameters", not "one".
    expect([...new Set([...distinct].map((p) => p.split("+")[0]))].sort()).toEqual([
      "burned",
      "confused",
      "paralyzed",
    ]);
    expect([...new Set([...distinct].map((p) => p.split("+")[1]))].sort()).toEqual([
      "confused",
      "poisoned",
    ]);
  });

  it("the flip twin wraps the SAME two ops in a `coinFlipGate`", () => {
    expect(deriveAttackEffect(FLIP_CONFUSE_POISON)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "applyStatus", target: "defender", status: "confused" },
          { op: "applyStatus", target: "defender", status: "poisoned" },
        ],
      },
    ]);
    expect(deriveAttackEffect(FLIP_PARALYZE_POISON)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          { op: "applyStatus", target: "defender", status: "poisoned" },
        ],
      },
    ]);
  });

  it("🛑 the anchors claim EXACTLY 3 sentences / 5 printings, and no more", () => {
    // ⚠️ THE FALSE-POSITIVE SWEEP, over the WHOLE 640-sentence column rather than
    // over the rows this slice went looking for. A `^…$` anchor that had drifted
    // into a floating match would show up here and nowhere else.
    // 🆕🆕 **D478 — 3 / 5 → 4 / 7, AND THE FOURTH IS A GENUINE MEMBER RATHER THAN A DRIFT.**
    // `statusPairOf` reads the `then` list of a one-op `coinFlipGate`, and corpus FILE LINE
    // 263's HEADS arm *is* this family's pair, byte for byte — so widening the expected set
    // is the honest answer and narrowing the helper would have hidden a real inhabitant.
    // ⚠️ **BUT THE WIDENING ALONE WOULD HAVE COST THIS SWEEP ITS GRIP ON THE NEW ROW**
    // (D438): `statusPairOf` discards `otherwise`, so a build that dropped the tails branch
    // entirely would still sit in this set and this rung would stay green. The second
    // assertion is what keeps it — EXACTLY ONE of the four carries a second arm, and it is
    // the one D478 built.
    const hits = legalAttackCorpus().filter(([, sentence]) => statusPairOf(sentence) !== null);
    expect(hits.map(([, s]) => s).sort()).toEqual(
      [BURN_CONFUSE, FLIP_CONFUSE_POISON, FLIP_PARALYZE_POISON, HEADS_PAIR_TAILS_SINGLE].sort(),
    );
    expect(hits.reduce((sum, [units]) => sum + units, 0)).toBe(7);
    const twoArmed = hits.filter(([, s]) => {
      const ops = deriveAttackEffect(s);
      const head = ops?.[0];
      return ops?.length === 1 && head?.op === "coinFlipGate" && head.otherwise !== undefined;
    });
    expect(twoArmed.map(([, s]) => s)).toEqual([HEADS_PAIR_TAILS_SINGLE]);
    expect(twoArmed.reduce((sum, [units]) => sum + units, 0)).toBe(2);
  });

  it("🛑 the five REAL near misses stay on the loud path, and `\\.$` is why", () => {
    // Each is a printing in the same legal column, not a constructed string.
    // ⚠️ 🆕🆕 **D478 — `headsTails` IS THE ONE MEMBER THIS RUNG'S TITLE WAS NEVER ABOUT, AND
    // SAYING SO IS THE POINT (D452).** The `dotAnchorTrio` really is refused by a `\.$`.
    // The old `headsTails` was too, until D478 built it; its replacement (corpus FILE LINE
    // 268) is refused by NO byte of any anchor here — it is refused because its tails
    // branch resolves at a different SEAM. One rung, two mechanisms, and folding them
    // under one title is exactly the mistake D464 corrected two anchors over.
    expect(deriveAttackEffect(LEFT_LOUD.headsTails)).toBeNull();
    for (const text of LEFT_LOUD.dotAnchorTrio) expect(deriveAttackEffect(text)).toBeNull();
    // The compound is refused WHOLE — deliberately, so the SPLITTER claims it (§5)
    // rather than a hand-written anchor shadowing the composition path.
    expect(deriveAttackEffect(CONFUSE_POISON_SWITCH)).toBeNull();
  });

  it("🆕🆕 D464 — and the byte is MEASURED: `DEFENDER_NOW` minus its `\\.$` claims all three", () => {
    // 🛑 THE RUNG D462's PROSE NEEDED AND DID NOT HAVE. A doc block that names the byte
    // refusing a sentence is one regex from being checked, and D462's named the wrong
    // anchor for two of its three claims. This drives the claim instead of asserting it:
    // the strict anchor takes 4 rows / 74 printings, and dropping ONE byte takes it to 16
    // rows / 96 — the trio above among the twelve it gains, each with a second clause the
    // engine cannot run. Both numbers come off the POPULATION, not off a specimen.
    const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
    const strict = new RegExp(`^Your opponent['’]s Active Pokémon is now (${W})\\.$`);
    const drifted = new RegExp(`^Your opponent['’]s Active Pokémon is now (${W})`);
    const rows = legalAttackCorpus();
    const hit = (re: RegExp) => rows.filter(([, s]) => re.test(s));
    expect([hit(strict).length, hit(strict).reduce((a, [n]) => a + n, 0)]).toEqual([4, 74]);
    expect([hit(drifted).length, hit(drifted).reduce((a, [n]) => a + n, 0)]).toEqual([16, 96]);
    for (const text of LEFT_LOUD.dotAnchorTrio) {
      expect(strict.test(text)).toBe(false);
      expect(drifted.test(text)).toBe(true);
    }
    // …and the row this slot used to hold is NOT reachable from the list anchors at all,
    // under any single-axis loosening — which is the half of D462's reason that was false.
    const CLAIMED_AT_D464 =
      "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.";
    for (const re of [
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (.+), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (.+)\\.$`),
      new RegExp(`Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})\\.$`),
      new RegExp(`^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W}) and (.+)\\.$`),
    ]) {
      expect(re.test(CLAIMED_AT_D464)).toBe(false);
    }
    // …while the one anchor D462 named correctly DOES reach it once its `\.$` is gone.
    expect(
      new RegExp(`^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W})`).test(
        CLAIMED_AT_D464,
      ),
    ).toBe(true);
  });

  it("the single-status arms are untouched — the four anchors are disjoint", () => {
    // ORDER against arms 1 and 2 is a refactor and not behaviour, and this is the
    // assertion that says so: all four are `^…$`, and the single-status pair demand
    // `\.$` immediately after ONE status word.
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Burned.")).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
    expect(
      deriveAttackEffect("Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."),
    ).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE ROTATION COLLISION: refused at the reader, pinned on the POPULATION.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the rotation collision, refused at the reader", () => {
  it("🛑 refuses every pair that shares a `SpecialConditions` field", () => {
    // Six constructed sentences: all three unordered rotation pairs, both ways
    // round. Each would otherwise derive to two ops whose second overwrites the
    // first — the program would RESOLVE and be a lie.
    for (const s of COLLISIONS) expect(deriveAttackEffect(s)).toBeNull();
    // …and behind a coin flip too, since the refusal lives in the shared helper and
    // not in either arm. If it had been written into the bare arm only, this line is
    // the one that would go red.
    for (const s of COLLISIONS) {
      expect(
        deriveAttackEffect(`Flip a coin. If heads, ${s.replace("Your opponent's", "your opponent's")}`),
      ).toBeNull();
    }
  });

  it("🛑 refuses a DOUBLED word for the same reason, not a second one", () => {
    // A word shares a slot with itself. The invariant is "both printed words are
    // observable on the model afterwards", and a doubled word lands ONE condition.
    for (const w of ["Burned", "Confused", "Poisoned", "Asleep", "Paralyzed"]) {
      expect(deriveAttackEffect(`Your opponent's Active Pokémon is now ${w} and ${w}.`)).toBeNull();
    }
  });

  it("…while a pair in TWO DIFFERENT slots is admitted even though nothing prints it", () => {
    // 🛑 THE CONTROL THAT MAKES THE REFUSAL DISCRIMINATING. Without it, an arm that
    // simply returned `null` for every pair would pass every line above. Burned and
    // Poisoned occupy two different fields, so the pair is coherent — and no card
    // prints it, which is exactly why it is the control and not a claim about the
    // catalog.
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Burned and Poisoned.")).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
  });

  it("🛑 PINNED ON THE POPULATION: ZERO printings carry a same-slot pair", () => {
    // ⚠️ D423'S RULE, AND THE REASON THIS IS NOT A SPECIMEN GUARD. That slice found
    // an absence pinned by asserting ONE constructed string derives to null; the
    // assertion was true and the claim was false, and it sat green for 255 decisions
    // while warning future slices away from correct work. So the claim here is
    // quantified over the CORPUS — every sentence in the `legal_standard = 1` attack
    // column — and it is what licenses the refusal above being unreachable from any
    // real card.
    const ROTATION = ["Asleep", "Paralyzed", "Confused"];
    const WORD = "Asleep|Burned|Confused|Paralyzed|Poisoned";
    const anyPair = new RegExp(`(${WORD}) and (${WORD})`, "g");
    const offenders = legalAttackCorpus().filter(([, s]) =>
      [...s.matchAll(anyPair)].some(
        ([, a, b]) =>
          (ROTATION.includes(a as string) && ROTATION.includes(b as string)) || a === b,
      ),
    );
    expect(offenders).toEqual([]);
    // …and the same question asked of the SHAPE rather than the words: every printed
    // `X and Y` pair in the column, listed. Three, and each is one rotation word plus
    // one independent one. A fourth appearing here is the trigger to re-read §3.
    const printed = new Set<string>();
    for (const [, s] of legalAttackCorpus()) {
      for (const [, a, b] of s.matchAll(anyPair)) printed.add(`${a}+${b}`);
    }
    expect([...printed].sort()).toEqual([
      "Burned+Confused",
      "Confused+Poisoned",
      "Paralyzed+Poisoned",
    ]);
  });

  it("🛑 the refusal is LOUD — a collision reaches ATTACK_EFFECT_SKIPPED", () => {
    // Refusing at the reader is only correct because `null` means "say so". This
    // drives the whole path: a body whose printed text is a collision keeps its
    // sentence, and the engine announces that it did not simulate it.
    const collided = board("ninetales", "fix-titan");
    const active = collided.players.p1.active;
    if (active === null) throw new Error("no attacker");
    const { state, events } = swing(withEffect(collided, "fix-ninetales", COLLISIONS[0]), "ninetales");
    expect(find(events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(COLLISIONS[0]);
    expect(all(events, "STATUS_APPLIED")).toEqual([]);
    expect(defenderConditions(state).rotation).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the two conditions LAND on the model. Fields, not a status list. Both seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — both conditions land, asserted on the FIELDS", () => {
  it("🛑 Burn and Confusion land in TWO DIFFERENT FIELDS, both observable", () => {
    // ⚠️ ASSERTED ON THE FIELDS AND NOT ON A STATUS LIST. `presentStatuses` folds
    // the three fields into one array, so a list assertion cannot tell "rotation is
    // confused AND burned is true" from a board that happens to render the same way.
    // The whole hazard this slice exists for is a SECOND WRITE TO ONE FIELD, and only
    // the fields can see it.
    const { state, events } = swing(board("ninetales", "fix-titan"), "ninetales");
    expect(defenderConditions(state)).toEqual({
      rotation: "confused",
      poisonDamage: 0,
      burned: true,
    });
    // Two rows, one per op, in printed order.
    expect(all(events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["burned", "confused"]);
  });

  it("…and on the SECOND body, where the same sentence prints no damage", () => {
    const { state, events } = swing(board("houndoom", "fix-titan"), "houndoom");
    expect(defenderConditions(state)).toEqual({
      rotation: "confused",
      poisonDamage: 0,
      burned: true,
    });
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("🛑 BOTH SEATS — the same sentence read from p2 lands on p1's Active", () => {
    // D213's rule, re-earned by D412: the server-side twin passing proves nothing
    // about the other seat. `applyStatus`'s `target: "defender"` is resolved from the
    // ATTACKING seat, so a hard-coded `p2` would pass every line above and fail here.
    const { state } = swing(board("ninetales", "fix-titan", { by: "p2" }), "ninetales", "p2");
    expect(defenderConditions(state, "p2")).toEqual({
      rotation: "confused",
      poisonDamage: 0,
      burned: true,
    });
    // …and the ATTACKER is untouched — `defender` is not `self`.
    expect(state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
  });

  it("🛑 Poison lands with its COUNTER AMOUNT, not merely as a flag", () => {
    // `poisonDamage` is a number, and `0` means "not Poisoned". A pair arm that set a
    // boolean would be invisible to a status-list assertion and visible here.
    const heads = flipBoard("ekans", true);
    const { state } = swing(heads, "ekans");
    const c = defenderConditions(state);
    expect(c.rotation).toBe("confused");
    expect(c.poisonDamage).toBe(10);
    expect(c.burned).toBe(false);
  });

  it("the flip twin applies BOTH on heads and NEITHER on tails", () => {
    const { state: onHeads, events: headsEvents } = swing(flipBoard("glimmora", true), "glimmora");
    expect(defenderConditions(onHeads)).toEqual({
      rotation: "paralyzed",
      poisonDamage: 10,
      burned: false,
    });
    expect(all(headsEvents, "STATUS_APPLIED").map((e) => e.status)).toEqual([
      "paralyzed",
      "poisoned",
    ]);
    const { state: onTails, events: tailsEvents } = swing(flipBoard("glimmora", false), "glimmora");
    expect(defenderConditions(onTails)).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
    expect(all(tailsEvents, "STATUS_APPLIED")).toEqual([]);
    // 🛑 THE GATE IS ALL-OR-NOTHING, which is the assertion a one-op flip arm could
    // not have needed: a `coinFlipGate` that gated only its FIRST step would land
    // Poison on tails and nothing here would otherwise notice.
    expect(find(tailsEvents, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("🛑 order-independence where the model allows it: the pair is idempotent-safe", () => {
    // The two ops touch disjoint fields, so applying them in either order reaches the
    // same board. That is a property of the MODEL (a slot map), and it is what makes
    // "printed order" a faithfulness claim rather than a correctness one — worth
    // pinning, because the day it stops being true the refusal in §3 is the thing
    // that has broken.
    const forward = swing(board("ninetales", "fix-titan"), "ninetales").state;
    const reversed = swing(board("houndoom", "fix-titan"), "houndoom").state;
    expect(defenderConditions(forward)).toEqual(defenderConditions(reversed));
  });

  it("a pre-existing rotation is REPLACED, and the independent fields are not", () => {
    // §12's actual rule, and the reason the collision matters: the rotation slot
    // overwrites. Here that is CORRECT — one printed sentence, one rotation word.
    let state = board("ninetales", "fix-titan");
    const defender = state.players.p2.active;
    if (defender === null) throw new Error("no defender");
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active: { ...defender, conditions: { rotation: "asleep", poisonDamage: 20, burned: false } },
        },
      },
    };
    const after = swing(state, "ninetales").state;
    expect(defenderConditions(after)).toEqual({
      rotation: "confused", // replaced Asleep — §12
      poisonDamage: 20, // untouched: a different field
      burned: true, // newly set
    });
  });
});

/** A board seeded so `attacker`'s coin lands the way the test needs. The seed is
    SEARCHED rather than stubbed — the RNG is part of what this suite claims about
    the flip arms, and a stub would answer about the stub. */
function flipBoard(attacker: Attacker, wantHeads: boolean): GameState {
  for (let seed = 1; seed < 400; seed++) {
    // ⚠️ A SEED MAY SIMPLY NOT WORK: the shuffle can leave the attacker or its
    // Energy in HAND rather than in DECK, and the surgery helpers read the deck. A
    // seed that cannot build the board is not a seed that flipped the wrong way, so
    // it is skipped rather than counted.
    let candidate: GameState;
    try {
      candidate = board(attacker, "fix-titan", { seed });
    } catch {
      continue;
    }
    const flip = find(swing(candidate, attacker).events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip?.result === (wantHeads ? "heads" : "tails")) return candidate;
  }
  throw new Error(`no seed under 400 gives ${wantHeads ? "heads" : "tails"} for ${attacker}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the COMPOUND composes for free.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the compound composes, without an anchor of its own", () => {
  it("🛑 `splitAttackTrailingClause` now takes it — because its HEAD became claimed", () => {
    // ⚠️ THIS IS THE SLICE'S ONE FREE PRINTING, AND IT IS A MEASUREMENT RATHER THAN A
    // PREDICTION. Before the pair anchor landed this returned `null` (the head was
    // claimed by nobody); the splitter itself did not change, and this slice wrote no
    // line of composition code. That is the property D409 bought the splitter for —
    // "every future compound whose clauses this file already reads" — observed.
    expect(splitAttackTrailingClause(CONFUSE_POISON_SWITCH)).toEqual({
      head: "Your opponent's Active Pokémon is now Confused and Poisoned.",
      tail: "Switch this Pokémon with 1 of your Benched Pokémon.",
    });
    // The two halves, each claimed by the reader that owns it.
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Confused and Poisoned.")).toEqual([
      { op: "applyStatus", target: "defender", status: "confused" },
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
    expect(deriveAttackEffect("Switch this Pokémon with 1 of your Benched Pokémon.")).toEqual([
      { op: "switchActive" },
    ]);
  });

  it("🛑 …and the WHOLE printing resolves on a real board: both statuses AND the switch", () => {
    // Driving it, not inferring it (D422: a cited precedent that is never driven is
    // how a false claim propagates). The bench is deliberately KEPT here so the tail
    // has somewhere to land.
    const before = board("accelgor", "fix-titan", { bench: true });
    const benchBefore = before.players.p1.bench.length;
    expect(benchBefore).toBeGreaterThan(0);
    const { state, events } = swing(before, "accelgor");
    // the head
    expect(defenderConditions(state)).toEqual({
      rotation: "confused",
      poisonDamage: 10,
      burned: false,
    });
    // the tail — a different body is Active now
    const activeCardId = (st: GameState) => st.cardIdByUid[st.players.p1.active?.stack[0] ?? ""] ?? null;
    expect(activeCardId(before)).toBe("fix-accelgor");
    expect(activeCardId(state)).not.toBe("fix-accelgor");
    // and the printed damage still landed
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
    // 🛑 NOTHING WAS SKIPPED: the whole sentence was accounted for, which is the
    // difference between composition and a prefix match that ships half a card.
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the §11 block: TWO refusal rows for ONE printed sentence.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a §11 effects block refuses the pair", () => {
  /** D142's WIDE block, surgeried onto the defender for the installing turn. */
  function shielded(state: GameState, seat: Seat = "p2"): GameState {
    const active = state.players[seat].active;
    if (active === null) throw new Error("no defender to shield");
    return {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...state.players[seat], active: { ...active, attackBlock: { turn: 2, effects: true } } },
      },
    };
  }

  it("🛑 TWO `ATTACK_EFFECT_PREVENTED` ROWS FOR ONE PRINTED SENTENCE — and that is CORRECT", () => {
    // ⚠️ IT LOOKS LIKE A BUG AND IS NOT, SO IT IS PINNED RATHER THAN LEFT TO BE
    // "FIXED" BY A SUCCESSOR (D421's rule: a decision that is not pinned is
    // indistinguishable from an oversight). `interpreter.ts` states the rule in as
    // many words — *"one ATTACK_EFFECT_PREVENTED row per refused op, because the
    // alternative is an attack clause that silently does nothing"* — and this
    // sentence is TWO ops. The row is per-OP, not per-SENTENCE, and a reader who
    // collapsed them would be making a refusal quieter than the thing it refuses.
    const { state, events } = swing(shielded(board("ninetales", "fix-titan")), "ninetales");
    expect(all(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(2);
    expect(all(events, "STATUS_APPLIED")).toEqual([]);
    expect(defenderConditions(state)).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
    // The DAMAGE half is refused by the other, silent gate — one sentence, two
    // mechanisms, and the counts do not borrow from each other.
    expect(find(events, "DAMAGE_DEALT")?.prevented).toBe(true);
  });

  it("the single-status sentence next door gets exactly ONE row — the control", () => {
    // 🛑 WITHOUT THIS, "two rows" is not a finding: an engine that emitted two rows
    // for EVERY blocked effect would pass the line above. One op, one row.
    const single = withEffect(
      board("ninetales", "fix-titan"),
      "fix-ninetales",
      "Your opponent's Active Pokémon is now Burned.",
    );
    expect(all(swing(shielded(single), "ninetales").events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("a blocked pair is not a SKIPPED pair — the two loudnesses are different rows", () => {
    // D140/D142's distinction: "I could not read this" and "I read it and a rule
    // refused it" are different sentences, and conflating them would tell a player
    // the card is unimplemented.
    const { events } = swing(shielded(board("ninetales", "fix-titan")), "ninetales");
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — nothing is SKIPPED in either direction.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the printed text stops being flagged, on every carrier", () => {
  it("🛑 no `ATTACK_EFFECT_SKIPPED` on any of the five bodies", () => {
    // Before this slice all five emitted it carrying the whole sentence. Both seats,
    // because the skip marker is written at the declaration seam and a seat-shaped
    // defect there would be invisible from p1 alone.
    for (const seat of ["p1", "p2"] as const) {
      for (const attacker of ["ninetales", "houndoom", "accelgor"] as const) {
        const b = board(attacker, "fix-titan", { by: seat, bench: attacker === "accelgor" });
        expect(find(swing(b, attacker, seat).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
      }
    }
  });

  it("…including on TAILS, where the gate fired and applied nothing", () => {
    // A resolved-to-nothing clause must not print a "not simulated" row: loudness is
    // owed to UNREAD text (D140), and this text was read.
    expect(find(swing(flipBoard("ekans", false), "ekans").events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("the four sentences this slice LEFT are still flagged — the loud path still works", () => {
    // 🛑 THE ATTRIBUTION CONTROL (D214). Without it, "no skip marker" could be true
    // because the marker stopped being emitted at all. These are real printings the
    // slice deliberately did not claim, and they must still be announced.
    // 🆕 D464 — `paralyzedComma` was BUILT and is replaced by `dotAnchorTrio`; the
    // control keeps its job and gains two members rather than losing one (D418).
    const b = board("ninetales", "fix-titan");
    for (const text of [LEFT_LOUD.headsTails, ...LEFT_LOUD.dotAnchorTrio]) {
      const doctored = withEffect(b, "fix-ninetales", text);
      expect(find(swing(doctored, "ninetales").events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(text);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — purity, and the persisted question.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — purity and the structural answers", () => {
  it("never mutates the board it is handed — the bare pair", () => {
    const frozen = deepFreeze(board("ninetales", "fix-titan"));
    const snapshot = JSON.stringify(frozen);
    expect(swing(frozen, "ninetales").state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("…and the flip twin, whose gate takes a coin", () => {
    const frozen = deepFreeze(flipBoard("glimmora", true));
    const snapshot = JSON.stringify(frozen);
    expect(swing(frozen, "glimmora").state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("🛑 `MATCH_RECORD_VERSION` STAYS 26, and it is DRIVEN rather than reasoned", () => {
    // ⚠️ `MATCH_RECORD_VERSION` IS NOT EXPORTED FROM THIS PACKAGE (it lives in
    // `apps/api/src/lobby/match.ts`), so the claim is DRIVEN, the way D421–D423 drove
    // theirs. The bump trigger at this address is a PERSISTED structure gaining or
    // renaming a required field. `applyStatus` resolves INLINE and never parks — it
    // returns a new state directly — so this slice writes no new persisted shape and
    // adds no field to `SpecialConditions`, whose three keys it only ever assigns.
    //
    // THE DRIVE: build the board, ROUND-TRIP IT THROUGH JSON (which is what
    // persistence actually does to it), and replay the attack. If this slice had
    // added anything to the persisted shape, the replayed board would differ from the
    // live one or produce different rows.
    const live = board("ninetales", "fix-titan");
    const persisted = JSON.parse(JSON.stringify(live)) as GameState;
    const liveRun = swing(live, "ninetales");
    const replayedRun = swing(persisted, "ninetales");
    expect(replayedRun.events).toEqual(liveRun.events);
    expect(replayedRun.state.players.p2.active?.conditions).toEqual(
      liveRun.state.players.p2.active?.conditions,
    );
    // …and the CONDITIONS record's key set is unmoved, asserted as a LITERAL rather
    // than as a diff between two boards of ONE build — a diff is blind to a key that
    // grew on both (D279). This slice reads all three and adds none.
    expect(Object.keys(liveRun.state.players.p2.active?.conditions ?? {}).sort()).toEqual([
      "burned",
      "poisonDamage",
      "rotation",
    ]);
  });

  it("🛑 there is no PARK on this path — the ops resolve inline", () => {
    // D416's rule inverted: a suite whose boards never park cannot claim anything
    // about parking, so the claim here is the opposite one — that this path HAS no
    // park, which is what makes the version prediction true.
    const { state } = swing(board("ninetales", "fix-titan"), "ninetales");
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});
