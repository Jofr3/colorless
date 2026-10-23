import { describe, expect, it } from "vitest";
import { POKEMON_TYPE_BY_CODE, deriveAttackEffect } from "./effects";
import type { EffectOp, PokemonType } from "./effects";
import { applyAction } from "./index";
import type { GameState } from "./index";
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
  findEvent,
} from "./testFixtures";

/** The printed sentence, byte for byte. */
const EXCLUDED_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic non-{C} Pokémon.";
const PLAIN_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.";

const EXCLUDED_CLASS = { stage: "basic", excludingType: "Colorless" } as const;
const PLAIN_CLASS = { stage: "basic" } as const;

/** Nothing in this family flips a coin, so one seed serves the whole suite and
    determinism is a property of the SENTENCE rather than of the shuffle — pinned
    below by an unchanged `rngState` across an install. */
const SEED = 7;

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. */
function armed(): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: TYPED_CLASS_BLOCK_DECK, p2: TYPED_CLASS_BLOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "fix-crown");
  return attachFromDeck(state, "p1", "fix-energy", 2);
}

function installed(index: 0 | 1 = 0): GameState {
  const { state, events } = mustApply(armed(), { type: "attack", seat: "p1", index });
  if (findEvent(events, "ATTACK_BLOCK_APPLIED") === undefined) {
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
    const op = (deriveAttackEffect(EXCLUDED_TEXT) as EffectOp[])[0] as Extract<
      EffectOp,
      { op: "preventDamage" }
    >;
    expect(op.fromClass?.excludingType).toBe("Colorless");
    expect(JSON.stringify(op)).not.toContain("{C}");
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(EXCLUDED_TEXT),
    );
  });

  it("keeps `excludingType` ABSENT on the un-excluded sibling — one anchor, two readings", () => {
    expect(deriveAttackEffect(PLAIN_TEXT)).toEqual([
      { op: "preventDamage", fromClass: PLAIN_CLASS },
    ]);
    const op = (deriveAttackEffect(PLAIN_TEXT) as EffectOp[])[0] as Extract<
      EffectOp,
      { op: "preventDamage" }
    >;
    expect(Object.keys(op.fromClass as object)).toEqual(["stage"]);
    // …and the two differ in EXACTLY that key. The whole widening in one line.
    expect({ ...op.fromClass, excludingType: "Colorless" }).toEqual(EXCLUDED_CLASS);
  });

  it("reads EVERY code the notation map holds — the parameterisation is total", () => {
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
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{Q}"))).toBeNull();
    // Lower case is not a code either: the class is `[A-Z]`, and the catalog
    // prints every code capitalised.
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{c}"))).toBeNull();
  });

  it("captures ONE CHARACTER — and the character class is the PROTOTYPE GUARD", () => {
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{Colorless}"))).toBeNull();
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{CD}"))).toBeNull();
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("non-{C}", "non-{C} or {D}"))).toBeNull();
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{constructor}"))).toBeNull();
    expect(deriveAttackEffect(EXCLUDED_TEXT.replace("{C}", "{toString}"))).toBeNull();
  });

  it("is anchored end to end — including the dropped-`$` mutant", () => {
    expect(deriveAttackEffect(`${EXCLUDED_TEXT} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`${EXCLUDED_TEXT}.`)).toBeNull();
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
    for (const text of [] as string[]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.",
      ),
    ).toEqual([{ op: "preventDamage", fromClass: { stage: "ancient" } }]);
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, prevent all damage done to each of your Future Pokémon by attacks from Pokémon ex. If this Pokémon is no longer your Active Pokémon, this effect ends.",
      ),
    ).toEqual([{ op: "installSideAttackBlock", banner: "Future", fromClass: { stage: "ex" } }]);
  });

  it("does not read the damage-CAP sibling that shares its 14-word PREFIX", () => {
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
    expect(findEvent(events, "ATTACK_BLOCK_APPLIED")).toEqual({
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p1",
      dealt: 0,
      prevented: true,
    });
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("lets a COLORLESS Basic through in FULL — the case the slice exists for", () => {
    const { state: done, events } = swing(installed(), "fix-colorless-brawler");
    const hit = findEvent(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 40 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(40);
    // …and the block is still sitting there, live and simply not matching.
    expect(done.players.p1.active?.attackBlock?.fromClass).toEqual(EXCLUDED_CLASS);
  });

  it("excludes a DUAL-typed body — `includes`, not `types[0]`", () => {
    const { state: done, events } = swing(installed(), "fix-dual-colorless");
    const hit = findEvent(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 50 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(50);
  });

  it("still bites on the STAGE — the conjunction is really a conjunction", () => {
    const { state: done, events } = swing(installed(), "fix-stage1-brawler");
    const hit = findEvent(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 70 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(70);
  });

  it("cannot block its own MIRROR — Terapagos ex is a Colorless Basic", () => {
    const { events } = swing(installed(), "fix-crown", 2);
    const hit = findEvent(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 60 });
    expect(hit?.prevented).toBeUndefined();
  });

  it("…and the UN-EXCLUDED reading DOES stop that same Colorless Basic", () => {
    // The two readings one printed phrase apart, driven off one card's two attack
    // indexes. This is the assertion that makes every "lands in full" case above a
    // statement about the EXCLUSION rather than about the board.
    const { state: done, events } = swing(installed(1), "fix-colorless-brawler");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p1",
      dealt: 0,
      prevented: true,
    });
    expect(done.players.p1.active?.damage).toBe(0);
  });
});

describe("the typed attacker class — the merge is STRUCTURAL", () => {
  function primed(
    state: GameState,
    cls: GameState["players"]["p1"]["active"] extends null
      ? never
      : NonNullable<NonNullable<GameState["players"]["p1"]["active"]>["attackBlock"]>["fromClass"],
  ) {
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
    const state = primed(armed(), { stage: "basic", excludingType: "Colorless" });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p1.active?.attackBlock?.fromClass).toEqual(EXCLUDED_CLASS);
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
    // The filter is really still there: a Colorless Basic walks through.
    const { events: swung } = swing(done, "fix-colorless-brawler");
    expect(findEvent(swung, "DAMAGE_DEALT")?.prevented).toBeUndefined();
  });

  it("widens to UNFILTERED when the two classes DISAGREE on the exclusion alone", () => {
    // The other half of the same rule, and the case that proves `sameAttackerClass`
    // reads `excludingType` and not only `stage`: the two records agree on the
    // stage word and differ on one optional key, so the merge must widen.
    const state = primed(armed(), { stage: "basic" });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: false });
    expect(done.players.p1.active?.attackBlock?.fromClass).toBeUndefined();
    expect(findEvent(events, "ATTACK_BLOCK_APPLIED")?.fromClass).toBeUndefined();
    // …and unfiltered means unfiltered: the Colorless Basic is now refused too.
    const { events: swung } = swing(done, "fix-colorless-brawler");
    expect(findEvent(swung, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });
});
