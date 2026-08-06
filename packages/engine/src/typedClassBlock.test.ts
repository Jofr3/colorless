import { describe, expect, it } from "vitest";
import { POKEMON_TYPE_BY_CODE, deriveAttackEffect } from "./effects";
import type { EffectOp, PokemonType } from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  TYPED_CLASS_BLOCK_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.154.0 → 0.155.0 — the ATTACKER CLASS widened to a printed TYPE EXCLUSION
// (P3-M5 long tail, D239, backlog row 15):
//
//   "During your opponent's next turn, prevent all damage done to this Pokémon
//    by attacks from Basic non-{C} Pokémon."          (7 legal printings)
//
// D146's own `preventDamage.fromClass`, and the whole slice is that ONE field
// stops being a string. Four things turn on it, and none of them is the block:
//
//   • **THE FIELD IS NOW A RECORD** (`AttackerClass`), because the printed noun
//     phrase is a CONJUNCTION of two independently printed facts — a stage word
//     and a type exclusion. A flat `"Basic" | "BasicNonColorless"` union would be
//     their CROSS PRODUCT, eleven codes wide the moment a second one prints, with
//     both conjuncts re-spelled per member (conventions.md's D222 shape);
//   • **THE BRACE CODE IS RESOLVED AT PARSE TIME AND NEVER STORED.** D238's rule:
//     `{C}` must not reach a player's eyes, so the deriver maps it through
//     `POKEMON_TYPE_BY_CODE` and the log row spells "non-Colorless";
//   • **THE FAILURE DIRECTION IS INVERTED FROM EVERY OTHER DEFAULT IN THIS
//     FAMILY.** `effects` absent protects LESS; a *dropped exclusion* protects
//     MORE than the card prints. So an unresolvable code refuses to derive rather
//     than falling back on `{ stage: "basic" }`, and that is driven below;
//   • **THE MERGE COMPARISON WAS A LIVE DEFECT THE MOMENT THE FIELD BECAME A
//     RECORD** — `existing.fromClass === fromClass` is reference equality on two
//     objects, so two installs of the SAME class would have "disagreed" and
//     silently widened to an unfiltered block. `sameAttackerClass` is structural,
//     and the surgery at the bottom of this file is what proves it.
//
// ⚠️ TWO OF THE FOUR PRINTED CLASS PHRASES STILL HAVE NO READER, AND NEITHER IS
// AN UNWRITTEN ARM. Iron Moth sv06.5-009's *"from Ancient Pokémon"* and Miraidon
// sv08-069's *"each of your Future Pokémon … from Pokémon ex"* are both blocked
// on a SUPPLY-SIDE ABSENCE (`Ancient` / `Future` are printed on the card face and
// live in no column of the catalog and no field of tcgdex's model), and the
// second is blocked twice more — on a block installed over a SET of bodies rather
// than "this Pokémon", and on a trailing leave-the-spot terminator the turn stamp
// does not carry. Both stay LOUD, and `censusAtHead.test.ts` counts them.
//
// ⚠️ ALL SEVEN PRINTINGS ARE ONE CARD — Terapagos ex "Crown Opal" ({G}{W}{L},
// 180, attack INDEX 1) as `svp-165` / `sv07-128` / `-170` / `-173` /
// `sv08.5-092` / `-169` / `-180`. Verbatim off the remote D1 (2026-08-06,
// `legal_standard = 1`, `json_each` over all three text columns, GROUPED BY
// SENTENCE). None of those sets is in the local six-set catalog, so the fixture
// is SYNTHETIC by necessity (`fix-crown`) and carries the catalog's own STRING.

/** The printed sentence, byte for byte. */
const EXCLUDED_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic non-{C} Pokémon.";
/** D146's un-excluded sibling — the same anchor with the optional group absent. */
const PLAIN_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.";

const EXCLUDED_CLASS = { stage: "basic", excludingType: "Colorless" } as const;
const PLAIN_CLASS = { stage: "basic" } as const;

/** Nothing in this family flips a coin, so one seed serves the whole suite and
    determinism is a property of the SENTENCE rather than of the shuffle — pinned
    below by an unchanged `rngState` across an install. */
const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. */
function armed(): GameState {
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: TYPED_CLASS_BLOCK_DECK, p2: TYPED_CLASS_BLOCK_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "fix-crown");
  return attachFromDeck(state, "p1", "fix-energy", 2);
}

/** `armed`, then the install declared at `index`. Asserts the row actually
    landed, so a board that failed to install can never leave a case asserting
    "nothing was blocked" against nothing. Returns P2's turn. */
function installed(index: 0 | 1 = 0): GameState {
  const { state, events } = mustApply(armed(), { type: "attack", seat: "p1", index });
  if (find(events, "ATTACK_BLOCK_APPLIED") === undefined) {
    throw new Error(`fix-crown index ${index} did not install a block`);
  }
  return state;
}

/** Put `attacker` on P2's Active with `energy` {C} and swing at the shielded
    body. Every cost in this deck is Colorless, so the count is the whole cost. */
function swing(state: GameState, attacker: string, energy = 1) {
  let next = setActiveFromDeck(state, "p2", attacker);
  next = attachFromDeck(next, "p2", "fix-energy", energy);
  return mustApply(next, { type: "attack", seat: "p2", index: 0 });
}

describe("the typed attacker class — derived, not authored", () => {
  it("derives the EXCLUSION as a resolved PokemonType, never the printed code", () => {
    expect(deriveAttackEffect(EXCLUDED_TEXT)).toEqual([
      { op: "preventDamage", fromClass: EXCLUDED_CLASS },
    ]);
    // The point stated as its own assertion: what is STORED is "Colorless", the
    // catalog's own `types` value, and not "C". A record carrying the code would
    // make every read site — the predicate, the log row, a future dialog — do the
    // resolution again and disagree eventually (D238's caption rule).
    const op = (deriveAttackEffect(EXCLUDED_TEXT) as EffectOp[])[0] as Extract<
      EffectOp,
      { op: "preventDamage" }
    >;
    expect(op.fromClass?.excludingType).toBe("Colorless");
    expect(JSON.stringify(op)).not.toContain("{C}");
    // The typographic apostrophe derives identically — a re-ingest that changes
    // only punctuation must not silently un-simulate seven printings (D136/D137).
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(EXCLUDED_TEXT),
    );
  });

  it("keeps `excludingType` ABSENT on the un-excluded sibling — one anchor, two readings", () => {
    expect(deriveAttackEffect(PLAIN_TEXT)).toEqual([
      { op: "preventDamage", fromClass: PLAIN_CLASS },
    ]);
    // ABSENT rather than `null` or `"Colorless"` (D135's absent-key rule), and the
    // KEY SET is the assertion because `toEqual` ignores undefined keys — a
    // deriver that wrote `excludingType: undefined` would pass the line above and
    // fail here, which is exactly the drift worth catching: D146's persisted
    // records must keep reading back as the same claim.
    const op = (deriveAttackEffect(PLAIN_TEXT) as EffectOp[])[0] as Extract<
      EffectOp,
      { op: "preventDamage" }
    >;
    expect(Object.keys(op.fromClass as object)).toEqual(["stage"]);
    // …and the two differ in EXACTLY that key. The whole widening in one line.
    expect({ ...op.fromClass, excludingType: "Colorless" }).toEqual(EXCLUDED_CLASS);
  });

  it("reads EVERY code the notation map holds — the parameterisation is total", () => {
    // D118's rule: the token varies over a closed map, so the anchor takes a
    // CAPTURE rather than a literal `non-\{C\}`. Only `{C}` is printed today, and
    // that is precisely why this is asserted from the MAP rather than from the
    // pool — a hand-kept alternation rots silently and a total map cannot.
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      const text = EXCLUDED_TEXT.replace("{C}", `{${code}}`);
      expect(deriveAttackEffect(text), `code {${code}}`).toEqual([
        { op: "preventDamage", fromClass: { stage: "basic", excludingType: type } },
      ]);
    }
    // And the map really is the type wheel rather than the payable-energy one —
    // `Colorless` and `Dragon` have no Basic Energy and are both in it.
    const resolved = new Set<PokemonType>(Object.values(POKEMON_TYPE_BY_CODE));
    expect(resolved.has("Colorless")).toBe(true);
    expect(resolved.has("Dragon")).toBe(true);
  });

  it("REFUSES an unreadable code rather than dropping the exclusion", () => {
    // 🛑 THE ASYMMETRY THIS FAMILY TURNS ON. Everywhere else in `preventDamage` the
    // conservative default protects LESS (an unresolvable attacker fails a filtered
    // block; `effects` absent means damage only). Here a dropped exclusion protects
    // MORE than the card prints — Terapagos ex would start refusing the Colorless
    // Basics its own sentence lets through — so the arm falls THROUGH to the loud
    // path instead. `{Q}` is not in the map and never will be.
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{Q}"))).toBeNull();
    // Lower case is not a code either: the class is `[A-Z]`, and the catalog
    // prints every code capitalised.
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{c}"))).toBeNull();
  });

  it("captures ONE CHARACTER — and the character class is the PROTOTYPE GUARD", () => {
    // The anchor audit this repo runs on every capture. `([A-Z])` cannot match a
    // word, a phrase or a second brace pair; `(.+)` between literal braces would
    // match all three and then hand `POKEMON_TYPE_BY_CODE` a key it happens to
    // miss — LOUD by luck rather than by construction.
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{Colorless}"))).toBeNull();
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{CD}"))).toBeNull();
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("non-{C}", "non-{C} or {D}"))).toBeNull();
    // 🛑 AND HERE IS WHY "LOUD BY LUCK" IS THE RIGHT WORRY, MEASURED RATHER THAN
    // ASSERTED. `POKEMON_TYPE_BY_CODE` is an OBJECT LITERAL, so it carries
    // `Object.prototype` — `map["constructor"]` really does answer `[class Object]`
    // and `map["toString"]` a function. That is the exact hazard this file's own
    // `CLAUSE_POKEMON_TYPES` doc names as its reason for being a `Map`. The
    // single-character class is what keeps this arm out of it: no prototype key is
    // one uppercase letter, so the lookup can only ever be asked a real code.
    // Widen the capture to `(.+)` and BOTH lines below start deriving a
    // `preventDamage` whose `excludingType` is a FUNCTION.
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{constructor}"))).toBeNull();
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{toString}"))).toBeNull();
  });

  it("is anchored end to end — including the dropped-`$` mutant", () => {
    // A trailing sentence must keep the whole thing LOUD. This is the case that
    // fails if the anchor loses its `$`, and it is written as its own line rather
    // than folded into the group above so the mutant has a named killer.
    expect(deriveAttackEffect(`${EXCLUDED_TEXT} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`${EXCLUDED_TEXT}.`)).toBeNull();
    // …and the `^` half: a coin prefix must not ride in front and install without
    // flipping, which is the exact bug D142's two spellings exist to prevent.
    expect(deriveAttackEffect(`Then, ${EXCLUDED_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(`Flip a coin. If heads, ${EXCLUDED_TEXT.toLowerCase()}`)).toBeNull();
    expect(deriveAttackEffect(EXCLUDED_TEXT.slice(0, -1))).toBeNull();
    expect(deriveAttackEffect(EXCLUDED_TEXT.toLowerCase())).toBeNull();
    // The optional group is a group, not a wildcard: the words around it are
    // still literal.
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("non-{C} ", ""))).toEqual(
      deriveAttackEffect(PLAIN_TEXT),
    );
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("non-{C}", "not-{C}"))).toBeNull();
  });

  it("leaves the row's other two printed sentences LOUD — supply, not effort", () => {
    for (const text of [
      // Iron Moth sv06.5-009 — the Ancient BANNER, in no column of the catalog.
      "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.",
      // Miraidon sv08-069 — three blockers, and the class token is NOT one of
      // them: a block over a SET of bodies, a second demand-only banner, and a
      // trailing leave-the-spot terminator.
      "During your opponent's next turn, prevent all damage done to each of your Future Pokémon by attacks from Pokémon ex. If this Pokémon is no longer your Active Pokémon, this effect ends.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("does not read the damage-CAP sibling that shares its 14-word PREFIX", () => {
    // ⚠️ AN EXPIRED "UNBUILT" CONTROL, RE-HOMED RATHER THAN DELETED (the standing
    // rule). D239 pinned these two sentences derived-to-NULL here, because the
    // backlog row claimed 3 of row 15's 9 printings said "if that damage is 40/60
    // or less" and none of them does — those 3 (`sv10.5w-046`, `sv10.5w-127`,
    // `sv09-002`) never contain "by attacks from" at all and were never inside
    // row 15's GLOB. D240 BUILT them as row 17, so the null assertion is gone and
    // `damageCapBlock.test.ts` owns their behaviour. What survives here is the
    // claim this file is actually the right home for: the two anchors share a
    // 14-word prefix and must not read each other's sentences.
    for (const text of [EXCLUDED_TEXT, PLAIN_TEXT]) {
      const capped = text.replace(
        / by attacks from Basic (?:non-\{C\} )?Pokémon\.$/,
        " by attacks if that damage is 40 or less.",
      );
      expect(capped).not.toEqual(text);
      // The CAP anchor reads it, and this one does not — the same sentence,
      // asserted from both sides so neither anchor can quietly widen into the
      // other's territory.
      expect(deriveAttackEffect(capped)).toEqual([{ op: "preventDamage", maxDamage: 40 }]);
    }
    // …and the class anchor still refuses a sentence carrying BOTH narrowings,
    // which no card prints and neither anchor may invent.
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon if that damage is 40 or less.",
      ),
    ).toBeNull();
  });
});

describe("the typed attacker class — installing it", () => {
  it("installs with NO coin and writes the RECORD onto the board", () => {
    const before = armed();
    const installer = activeUid(before, "p1");
    const { state: done, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(done.rngState).toBe(before.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "ATTACK_BLOCK_APPLIED")).toEqual({
      type: "ATTACK_BLOCK_APPLIED",
      seat: "p1",
      uid: installer,
      effects: false,
      fromClass: EXCLUDED_CLASS,
    });
    expect(done.players.p1.active?.attackBlock).toEqual({
      turn: 3,
      effects: false,
      fromClass: EXCLUDED_CLASS,
    });
  });

  it("index 1 installs the UN-EXCLUDED class off the same card", () => {
    const { state: done } = mustApply(armed(), { type: "attack", seat: "p1", index: 1 });
    expect(done.players.p1.active?.attackBlock).toEqual({
      turn: 3,
      effects: false,
      fromClass: PLAIN_CLASS,
    });
    expect(done.players.p1.active?.attackBlock?.fromClass?.excludingType).toBeUndefined();
  });

  it("names the TYPE in the log row and never the brace code", () => {
    // D238's caption rule, on the first row that could have broken it. Before this
    // slice the renderer interpolated the field directly; against a record that
    // reads "[object Object] Pokémon's attacks" on all seven printings, which is
    // why the phrase is a function rather than a template hole.
    const { state: done, events } = mustApply(armed(), { type: "attack", seat: "p1", index: 0 });
    const ctx: LogContext = {
      names: { p1: "Ember", p2: "Tide" },
      state: done,
      elapsed: "+00:07",
    };
    const texts = logFromEvents(events, ctx).map((entry) =>
      entry.kind === "turn" ? "" : entry.segments.map((s) => s.text).join(""),
    );
    const rendered = texts.find((t) => t.includes("is protected from damage"));
    expect(rendered).toContain(
      "is protected from damage from Basic non-Colorless Pokémon's attacks during your opponent's next turn",
    );
    expect(rendered).not.toContain("{C}");
    expect(rendered).not.toContain("object Object");
    expect(rendered).not.toContain("basic");
  });
});

describe("the typed attacker class — the truth table, driven off bodies", () => {
  it("PREVENTS a Basic whose type is not excluded", () => {
    const state = installed();
    deepFreeze(state);
    const { state: done, events } = swing(state, "fix-attacker");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("lets a COLORLESS Basic through in FULL — the case the slice exists for", () => {
    // Stage ✓, type ✗. No row announces the failure: `DAMAGE_DEALT` with
    // `prevented` absent and the real number in `dealt` is the whole story, and a
    // "the block declined" row would be announcing a non-event (D140).
    const { state: done, events } = swing(installed(), "fix-colorless-brawler");
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 40 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(40);
    // …and the block is still sitting there, live and simply not matching.
    expect(done.players.p1.active?.attackBlock?.fromClass).toEqual(EXCLUDED_CLASS);
  });

  it("excludes a DUAL-typed body — `includes`, not `types[0]`", () => {
    // ⚠️ A DECLARED PROBE. No Standard-legal Pokémon is dual-typed (measured on
    // the remote D1: zero rows with `json_array_length(types_json) > 1`), so this
    // difference is invisible off every printing in the pool — and `types[0] ===`
    // is the reading a careless author writes. `fix-dual-colorless` is Fire FIRST,
    // so an equality read admits it to the block and this case goes red.
    const { state: done, events } = swing(installed(), "fix-dual-colorless");
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 50 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(50);
  });

  it("still bites on the STAGE — the conjunction is really a conjunction", () => {
    // Type ✓, stage ✗. Without this case a predicate that had quietly dropped
    // `isBasicPokemon` would pass every other row in this file, because the only
    // bodies that reach them are Basics.
    const { state: done, events } = swing(installed(), "fix-stage1-brawler");
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 70 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(70);
  });

  it("cannot block its own MIRROR — Terapagos ex is a Colorless Basic", () => {
    // The printed card's own joke, and it is a real behaviour rather than a
    // curiosity: the seven printings that carry this sentence are the one card the
    // sentence does not protect against. A fixture that had quietly made the
    // installer Grass would have hidden it.
    const { events } = swing(installed(), "fix-crown", 2);
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 60 });
    expect(hit?.prevented).toBeUndefined();
  });

  it("…and the UN-EXCLUDED reading DOES stop that same Colorless Basic", () => {
    // The two readings one printed phrase apart, driven off one card's two attack
    // indexes. This is the assertion that makes every "lands in full" case above a
    // statement about the EXCLUSION rather than about the board.
    const { state: done, events } = swing(installed(1), "fix-colorless-brawler");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
    expect(done.players.p1.active?.damage).toBe(0);
  });
});

describe("the typed attacker class — the merge is STRUCTURAL", () => {
  /** Prime P1's Active with a block for the window this turn's attack will land
      in, carrying `cls`. Constructed rather than driven: no card prints two of
      these attacks, so the merge rule is unreachable off any printing and is
      guarded by surgery for D144's reason. */
  function primed(state: GameState, cls: GameState["players"]["p1"]["active"] extends null
    ? never
    : NonNullable<NonNullable<GameState["players"]["p1"]["active"]>["attackBlock"]>["fromClass"]) {
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active to shield");
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: {
            ...active,
            attackBlock: { turn: state.turn + 1, effects: false, fromClass: cls },
          },
        },
      },
    };
  }

  it("keeps the filter when two installs AGREE — the reference-equality defect", () => {
    // 🛑 THE DEFECT THIS SLICE INTRODUCED AND FIXED IN ONE MOVE. While `fromClass`
    // was a string literal, `existing.fromClass === fromClass` was exact. Against
    // two records it is REFERENCE equality — and the record on the board came from
    // a previous derive call, so it can never be the same object as the one this
    // install carries. The merge would have read "they disagree", collapsed to an
    // UNFILTERED block, and made the holder strictly MORE protected than either
    // printing says: the one direction this family's merge rule forbids.
    const state = primed(armed(), { stage: "basic", excludingType: "Colorless" });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p1.active?.attackBlock?.fromClass).toEqual(EXCLUDED_CLASS);
    // …and because the merge said nothing NEW, the row is suppressed entirely
    // (D142's idempotence rule, now answering on a record instead of a token).
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
    // The filter is really still there: a Colorless Basic walks through.
    const { events: swung } = swing(done, "fix-colorless-brawler");
    expect(find(swung, "DAMAGE_DEALT")?.prevented).toBeUndefined();
  });

  it("widens to UNFILTERED when the two classes DISAGREE on the exclusion alone", () => {
    // The other half of the same rule, and the case that proves `sameAttackerClass`
    // reads `excludingType` and not only `stage`: the two records agree on the
    // stage word and differ on one optional key, so the merge must widen.
    const state = primed(armed(), { stage: "basic" });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: false });
    expect(done.players.p1.active?.attackBlock?.fromClass).toBeUndefined();
    expect(find(events, "ATTACK_BLOCK_APPLIED")?.fromClass).toBeUndefined();
    // …and unfiltered means unfiltered: the Colorless Basic is now refused too.
    const { events: swung } = swing(done, "fix-colorless-brawler");
    expect(find(swung, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });
});
