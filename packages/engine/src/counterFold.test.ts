import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect, logFromEvents } from "./index";
import type { EffectOp, GameEvent, GameState, LogContext } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  COUNTER_FOLD_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  findEvent,
  roundTrip,
  mustDerive,
} from "./testFixtures";

function placements(
  events: readonly GameEvent[],
): Extract<GameEvent, { type: "COUNTERS_PLACED" }>[] {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "COUNTERS_PLACED" }> => e.type === "COUNTERS_PLACED",
  );
}

/** The three printed sentences, transcribed byte for byte off the committed column. */
const ABILITY_FOLD =
  "Put 6 damage counters on each Pokémon that has an Ability (both yours and your opponent's).";
const BOARD_FOLD = "Put 2 damage counters on each of your opponent's Pokémon.";
const WOUNDED_FOLD =
  "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.";

/** `fix-counterfold`'s attack indices, named so a board reads as a sentence. */
const IDX = { ability: 0, board: 1, wounded: 2, plain: 3 } as const;

/** Both Actives pinned to `fix-bigbody` (200 HP, NO printed Ability), p1's turn open.
    The Ability-free default matters: every board below that wants a body IN the
    `abilityPokemon` fold has to say so, so no case is green by accident. */
function table(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: COUNTER_FOLD_DECK, p2: COUNTER_FOLD_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `fix-counterfold` with one {L} attached (the {C} cost, and the type that
    arms Bellibolt's clause). Both benches are cleared after the Active surgeries,
    because `setActiveFromDeck` DISPLACES rather than removes. */
function fielded(
  seed: number,
  opts: { defender?: string; mine?: readonly string[]; theirs?: readonly string[] } = {},
): GameState {
  let state = setActiveFromDeck(table(seed), "p1", "fix-counterfold");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-lightning-energy", 1);
  for (const body of opts.mine ?? []) state = benchFromDeck(state, "p1", body);
  if (opts.defender !== undefined) state = setActiveFromDeck(state, "p2", opts.defender);
  state = clearBench(state, "p2");
  for (const body of opts.theirs ?? []) state = benchFromDeck(state, "p2", body);
  return state;
}

function attack(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the population: what is claimed, and what the family still refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the three printed folds, and the placement family's remaining refusals", () => {
  it("all three are in the legal attack column at the printing counts this slice claims", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(ABILITY_FOLD)).toBe(1);
    expect(rows.get(BOARD_FOLD)).toBe(1);
    expect(rows.get(WOUNDED_FOLD)).toBe(1);
  });

  it("all three resolve through the reader SURFACE, and the surface did not grow", () => {
    for (const s of [ABILITY_FOLD, BOARD_FOLD, WOUNDED_FOLD]) {
      expect(resolvedByAnyReader(s), s).toBe(true);
    }
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the PLACEMENT family closes from TEN rows to SEVEN to TWO to ZERO, each departure by name", () => {
    const family = legalAttackCorpus().filter(([, t]) => /put \d* ?damage counters/i.test(t));
    expect(family).toHaveLength(19);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(38);
    const unread = family.filter(([, t]) => !resolvedByAnyReader(t));
    expect(family.every(([, t]) => resolvedByAnyReader(t))).toBe(true);
    expect(family.filter(([, t]) => resolvedByAnyReader(t))).toHaveLength(19);
    expect(family.filter(([, t]) => resolvedByAnyReader(t)).reduce((sum, [n]) => sum + n, 0)).toBe(
      38,
    );
    expect(unread.map(([, t]) => t)).toHaveLength(0);
    expect(unread.reduce((sum, [n]) => sum + n, 0)).toBe(0);
    for (const [text, program] of [
      [
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
        [{ op: "installRecoil", amount: 60 }],
      ],
      [
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
        [{ op: "installRecoil", amount: "damageTaken" }],
      ],
    ] as const) {
      expect(
        unread.map(([, t]) => t),
        text,
      ).not.toContain(text);
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
    const unbuilt = unread.map(([, t]) => t);
    for (const s of [ABILITY_FOLD, BOARD_FOLD, WOUNDED_FOLD]) expect(unbuilt).not.toContain(s);

    expect(unbuilt).not.toContain(
      "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
    );
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
      )?.map((o) => o.op),
    ).toEqual(["damageChosen", "discardPileRetrieval", "shuffleDeck"]);
    expect(deriveAttackEffect("Then, shuffle those Energy cards into your deck.")).toBeNull();

    expect(new Map(legalAttackCorpus()).has(1)).toBe(true); // the column really is loaded
    expect(
      legalAttackCorpus().some(([, t]) => t.includes("for each of your Maushold in play")),
    ).toBe(false);

    for (const s of [
      "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.",
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.",
    ]) {
      expect(unbuilt, s).not.toContain(s);
      expect(deriveAttackEffect(s)?.[0]?.op, s).toBe("counterUntilRemainingHp");
    }
    // …and the FOLD really is the near miss, driven rather than asserted in prose: arm
    // 23e's sentence and line 425 differ on the amount AND on the zone, so the two
    // programs are unequal and neither is null.
    expect(deriveAttackEffect(BOARD_FOLD)).not.toEqual(
      deriveAttackEffect(
        "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.",
      ),
    );

    expect(unbuilt).not.toContain(
      "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
    );
    expect(
      deriveAttackEffect(
        "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
      ),
    ).toEqual([{ op: "applyStatus", target: "defender", status: "confused", confusionDamage: 80 }]);

    expect(
      deriveAttackEffect(
        "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the three anchors: what they claim, and what they must refuse.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchors derive their own ops, and the prefix pair stays disjoint", () => {
  it("each sentence derives the exact literal, counters converted to HP at the producer", () => {
    expect(deriveAttackEffect(ABILITY_FOLD)).toEqual([
      {
        op: "counterEachAll",
        amount: 60,
        filter: { kind: "abilityPokemon" },
        side: "both",
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(BOARD_FOLD)).toEqual([
      {
        op: "counterEachAll",
        amount: 20,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(WOUNDED_FOLD)).toEqual([
      {
        op: "counterEachAll",
        amount: 20,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
        damagedOnly: true,
      },
    ]);
  });

  it("the two opponent anchors are a PREFIX PAIR and the `$` is the whole of the fence", () => {
    expect(deriveAttackEffect(BOARD_FOLD)).not.toEqual(deriveAttackEffect(WOUNDED_FOLD));
    // …and the difference is exactly one key, which is what makes the pair a hazard.
    const bare = mustDerive(deriveAttackEffect, BOARD_FOLD)[0] as EffectOp;
    const windowed = mustDerive(deriveAttackEffect, WOUNDED_FOLD)[0] as EffectOp;
    expect(Object.keys(windowed).filter((k) => !Object.keys(bare).includes(k))).toEqual([
      "damagedOnly",
    ]);
  });

  it("refuses every near miss, each on a different axis", () => {
    for (const [why, text] of [
      // THE ZONE WORD, on a sentence the legal column does not carry at all.
      [
        "the Bench-scoped windowed fold",
        "Put 2 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
      ],
      // THE SEAT, dropped: "each Pokémon" with no parenthetical names no side.
      ["no seat and no parenthetical", "Put 2 damage counters on each Pokémon."],
      // THE PARENTHETICAL, dropped from arm 23d — the printed SUBJECT is what the
      // `side` field holds, so a sentence without it has no seat scope to read.
      [
        "the ability fold with the parenthetical removed",
        "Put 6 damage counters on each Pokémon that has an Ability.",
      ],
      [
        "one counter, singular",
        "Put 1 damage counter on each of your opponent's Pokémon for each of your Maushold in play.",
      ],
      // THE CASE and the POSITION: Froslass's own registry sentence, which this file's
      // op was born for and which arm 23d must never claim.
      [
        "the lowercase mid-sentence Ability printing",
        "During Pokémon Checkup, put 1 damage counter on each Pokémon that has an Ability (both yours and your opponent's), except any Froslass.",
      ],
      // A LEADING RIDER pins `^`; a trailing one pins `$`.
      [
        "a gate clause in front",
        "Flip a coin. If heads, put 2 damage counters on each of your opponent's Pokémon.",
      ],
      [
        "a second sentence riding it",
        "Put 2 damage counters on each of your opponent's Pokémon. During your next turn, this Pokémon can't attack.",
      ],
      ["empty", ""],
    ] as const) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
    const pick = deriveAttackEffect("Put 2 damage counters on 1 of your opponent's Pokémon.");
    expect(pick).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack" },
    ]);
    expect(pick).not.toEqual(deriveAttackEffect(BOARD_FOLD));
  });

  it("derives the CURLY apostrophe identically, and rejects a NON-BREAKING space", () => {
    for (const s of [ABILITY_FOLD, BOARD_FOLD, WOUNDED_FOLD]) {
      const curly = s.replaceAll("'", "’");
      expect(curly).not.toBe(s);
      expect(deriveAttackEffect(curly), s).toEqual(deriveAttackEffect(s));
    }
    // U+00A0, spelled as an ESCAPE rather than typed: byte-different from an ASCII space
    // and INVISIBLE in a diff, which is the whole reason it is written this way.
    expect(deriveAttackEffect(BOARD_FOLD.replace(" damage", " damage"))).toBeNull();
    // Outer whitespace SURVIVES by design (the deriver trims), so this states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${BOARD_FOLD}\n`)).toEqual(deriveAttackEffect(BOARD_FOLD));
  });

  it("accepts the unprinted counts, which is a claim about the GAME and not the INGEST", () => {
    expect(deriveAttackEffect("Put 9 damage counters on each of your opponent's Pokémon.")).toEqual(
      [
        {
          op: "counterEachAll",
          amount: 90,
          filter: { kind: "anyPokemon" },
          side: "opponent",
          source: "attack",
        },
      ],
    );
    expect(
      deriveAttackEffect("Put 0 damage counters on each of your opponent's Pokémon."),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Put 0 damage counters on each Pokémon that has an Ability (both yours and your opponent's).",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted op, and the version prediction DRIVEN over the bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — TWO REQUIRED fields on a shipped op, and the record version does not move", () => {
  it("the version PREDICTION, driven over the SERIALIZED BYTES in THREE directions", () => {
    // **DIRECTION 1 — FORWARD: the literal this deploy writes, whole.** Key sets are
    // asserted rather than eyeballed, because "the object looked right" is how an
    // optional key goes missing.
    const fresh = mustDerive(deriveAttackEffect, BOARD_FOLD)[0] as EffectOp;
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"counterEachAll","amount":20,"filter":{"kind":"anyPokemon"},"side":"opponent","source":"attack"}',
    );
    expect(Object.keys(fresh).sort()).toEqual(["amount", "filter", "op", "side", "source"]);
    expect(roundTrip(fresh)).toEqual(fresh);
    // …and the registry's own literal, which gained the SAME two keys in the same commit.
    const shroud = programFor("sv06-053")?.triggered?.[0]?.program?.[0] as EffectOp;
    expect(JSON.stringify(shroud)).toBe(
      '{"op":"counterEachAll","amount":10,"filter":{"kind":"abilityPokemon"},"side":"both","source":"ability","exceptNamed":"Froslass"}',
    );

    const authored: EffectOp[][] = [];
    for (const id of registryCardIds()) {
      const card = programFor(id);
      if (card === undefined) continue;
      for (const ops of Object.values(card.attack ?? {})) authored.push(ops);
      for (const ability of card.abilities ?? []) authored.push(ability.program);
      for (const trigger of card.triggered ?? []) authored.push(trigger.program);
      if (card.trainer !== undefined) authored.push(card.trainer);
    }
    const producers = authored.filter((ops) => ops.some((o) => o.op === "counterEachAll"));
    expect(producers).toHaveLength(4);
    for (const ops of producers) {
      expect(ops).toHaveLength(1);
      expect(ops[0]?.op).toBe("counterEachAll");
    }
    for (const index of [IDX.ability, IDX.board, IDX.wounded]) {
      const { state } = attack(fielded(20 + index, { theirs: ["fix-bigbody"] }), index);
      expect(state.phase.kind, `index ${index}`).not.toBe("effect:choose");
    }

    for (const key of ["op", "amount", "filter", "side", "source"] as const) {
      const dropped = JSON.parse(
        JSON.stringify(fresh, (k, v) => (k === key ? undefined : v)),
      ) as Record<string, unknown>;
      expect(Object.keys(dropped), key).not.toContain(key);
      // the mutilated record is not the op any producer in this engine emits…
      expect(dropped).not.toEqual(fresh);
      expect(dropped).not.toEqual(shroud);
    }
    // …and the two lost values have NO default anywhere: `side` cannot fall back to
    // `"both"` and `source` cannot fall back to `"ability"`, which are precisely the two
    // values that would have made a loss look like a working board.
    expect(fresh).not.toMatchObject({ side: "both" });
    expect(fresh).not.toMatchObject({ source: "ability" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the BOTH-SEATS fold: the filter, the attacker's own board, and flatness.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — arm 23d walks both boards and the noun decides who is on it", () => {
  it("counters land on every Ability body on BOTH seats and on nothing else", () => {
    // Four bodies, two on each side, and exactly two of them carry a printed Ability.
    // The attacker itself carries none — deliberately (see the fixture), so "walks my
    // board" cannot be confused with "walks the body it is standing on".
    const state = fielded(30, {
      mine: ["fix-idlebody", "fix-bigbody"],
      defender: "fix-idlebody",
      theirs: ["fix-bigbody"],
    });
    const { state: after, events } = attack(state, IDX.ability);
    const placed = placements(events);
    expect(placed).toHaveLength(2);
    expect(placed.map((e) => e.seat).sort()).toEqual(["p1", "p2"]);
    expect(placed.every((e) => e.amount === 60)).toBe(true);
    // 6 counters = 60 HP, at the PRODUCER.
    expect(after.players.p1.bench[0]?.damage).toBe(60); // own Ability body — the seam
    expect(after.players.p2.active?.damage).toBe(60);
    expect(after.players.p1.active?.damage).toBe(0);
    expect(after.players.p1.bench[1]?.damage).toBe(0);
    expect(after.players.p2.bench[0]?.damage).toBe(0);
  });

  it("a board with NO Ability body anywhere is a silent whiff, not an error", () => {
    const { state: after, events } = attack(
      fielded(31, { mine: ["fix-bigbody"], theirs: ["fix-bigbody"] }),
      IDX.ability,
    );
    expect(placements(events)).toHaveLength(0);
    expect(after.players.p1.active?.damage).toBe(0);
    expect(after.players.p2.active?.damage).toBe(0);
    // the turn still ends on the attack — a whiffed effect is not a refused attack
    expect(findEvent(events, "ATTACK_DECLARED")).toBeDefined();
  });

  it("the placement is FLAT — a ×2 Weakness does not double it", () => {
    const { state: after } = attack(fielded(32, { defender: "fix-lightning-weak" }), IDX.board);
    expect(after.players.p2.active?.damage).toBe(20);
    // …and the printed-damage control on the SAME body does double, which is what makes
    // the 20 above a measurement rather than a coincidence.
    const { state: control } = attack(fielded(32, { defender: "fix-lightning-weak" }), IDX.plain);
    expect(control.players.p2.active?.damage).toBe(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the SEAT: arm 23e reaches one board and stops.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — arm 23e walks the opponent's board only", () => {
  it("every opponent body takes counters and the attacker's whole board is untouched", () => {
    const state = fielded(40, {
      mine: ["fix-idlebody", "fix-bigbody"],
      theirs: ["fix-bigbody", "fix-lightning-weak"],
    });
    const { state: after, events } = attack(state, IDX.board);
    const placed = placements(events);
    expect(placed).toHaveLength(3); // their Active + both benched bodies
    expect(placed.every((e) => e.seat === "p2")).toBe(true);
    expect(after.players.p2.active?.damage).toBe(20);
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([20, 20]);
    expect(after.players.p1.active?.damage).toBe(0);
    expect(after.players.p1.bench.map((b) => b.damage)).toEqual([0, 0]);
  });

  it("the noun is BARE, so a body with no Ability is in scope where arm 23d skipped it", () => {
    // The same board through both arms: `anyPokemon` admits `fix-bigbody`,
    // `abilityPokemon` does not. Read as an INEQUALITY of boards rather than as two
    // separate claims, because that is what tells the two filters apart.
    const state = fielded(41, { theirs: ["fix-bigbody"] });
    const viaBare = attack(state, IDX.board).state.players.p2;
    const viaAbility = attack(state, IDX.ability).state.players.p2;
    expect(viaBare.active?.damage).toBe(20);
    expect(viaBare.bench[0]?.damage).toBe(20);
    expect(viaAbility.active?.damage).toBe(0);
    expect(viaAbility.bench[0]?.damage).toBe(0);
  });
});

describe("§6 — arm 23f narrows to bodies that already carry damage", () => {
  it("only the already-damaged bodies take counters, and the control takes them all", () => {
    let state = fielded(50, { theirs: ["fix-bigbody", "fix-bigbody"] });
    state = setDamage(state, "p2", 30); // their Active is wounded
    state = setBenchDamage(state, "p2", 1, 10); // …and the SECOND benched body only
    const { state: after, events } = attack(state, IDX.wounded);
    expect(placements(events)).toHaveLength(2);
    expect(after.players.p2.active?.damage).toBe(50);
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([0, 30]);
    const { state: control } = attack(state, IDX.board);
    expect(control.players.p2.active?.damage).toBe(50);
    expect(control.players.p2.bench.map((b) => b.damage)).toEqual([20, 30]);
  });

  it("the threshold is `damage > 0` and not `>= 10`, so a HALVED hit is a candidate", () => {
    let state = fielded(51, { theirs: ["fix-bigbody"] });
    state = setBenchDamage(state, "p2", 0, 5);
    const { state: after } = attack(state, IDX.wounded);
    expect(after.players.p2.active?.damage).toBe(0); // undamaged Active, skipped
    expect(after.players.p2.bench[0]?.damage).toBe(25); // 5 + 20
  });

  it("a board where nothing is damaged is a whiff", () => {
    const { state: after, events } = attack(fielded(52, { theirs: ["fix-bigbody"] }), IDX.wounded);
    expect(placements(events)).toHaveLength(0);
    expect(after.players.p2.active?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — §11: which printed shield refuses a PLACED counter, and how far it reaches.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the prevention gate, asked PER BODY", () => {
  it("the EFFECTS shield REFUSES the placement — and the DAMAGE shield does not", () => {
    const shielded = attack(fielded(60, { defender: "fix-unaware" }), IDX.board);
    expect(findEvent(shielded.events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2" });
    expect(placements(shielded.events)).toHaveLength(0);
    expect(shielded.state.players.p2.active?.damage).toBe(0);
    const shieldedControl = attack(fielded(60, { defender: "fix-unaware" }), IDX.plain);
    expect(findEvent(shieldedControl.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 20 });
    expect(shieldedControl.state.players.p2.active?.damage).toBe(20);

    // `sv03-078` Bellibolt — "Prevent all damage done to this Pokémon by attacks from
    // your opponent's {L} Pokémon." The attacker is {L}, so the clause is ARMED: it
    // prevents the control outright and must not touch the placement.
    const damageShield = attack(fielded(61, { defender: "sv03-078" }), IDX.board);
    expect(findEvent(damageShield.events, "COUNTERS_PLACED")).toMatchObject({ amount: 20 });
    expect(findEvent(damageShield.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(damageShield.state.players.p2.active?.damage).toBe(20);
    const damageShieldControl = attack(fielded(61, { defender: "sv03-078" }), IDX.plain);
    expect(findEvent(damageShieldControl.events, "DAMAGE_DEALT")).toMatchObject({
      prevented: true,
      dealt: 0,
    });
    expect(damageShieldControl.state.players.p2.active?.damage).toBe(0);
  });

  it("a shield on ONE body silences exactly that body — the rest of the fold lands", () => {
    const state = fielded(62, { theirs: ["fix-unaware", "fix-bigbody"] });
    const { state: after, events } = attack(state, IDX.board);
    expect(placements(events)).toHaveLength(2);
    expect(after.players.p2.active?.damage).toBe(20);
    expect(after.players.p2.bench[0]?.damage).toBe(0); // the shielded BENCHED body
    expect(after.players.p2.bench[1]?.damage).toBe(20);
    const prevented = events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED");
    expect(prevented).toHaveLength(1);
  });

  it("the refusal is asked AFTER the narrowing, so a body the sentence never names is silent", () => {
    const named = attack(fielded(63, { defender: "fix-unaware" }), IDX.ability);
    expect(named.events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    const notNamed = attack(fielded(63, { defender: "fix-unaware" }), IDX.wounded);
    expect(notNamed.events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
    expect(notNamed.state.players.p2.active?.damage).toBe(0);
  });

  it("the OWN-SIDE half of the both-seats fold is refused by NOTHING, and the gate says so", () => {
    const state = fielded(64, { mine: ["fix-unaware"], defender: "fix-idlebody" });
    const { state: after, events } = attack(state, IDX.ability);
    expect(after.players.p1.bench[0]?.damage).toBe(60); // own shielded body: countered
    expect(after.players.p2.active?.damage).toBe(60);
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the Knock Out: the Prize is paid, on either seat, and the cause is DAMAGE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — a lethal placement Knocks Out and pays a Prize to the other seat", () => {
  it("the opponent-side KO owes the ATTACKER a Prize", () => {
    // The op never KOs; `finishAttack`'s TWO-SEAT sweep does (flow.ts), and `lethalRefs`
    // walks Active AND Bench on both seats — which is what makes the own-side case below
    // work with no code written for it.
    let state = fielded(70, { theirs: ["fix-bigbody"] });
    state = setDamage(state, "p2", 180); // 200 HP at 180 → 20 is exactly lethal
    const { state: after, events } = attack(state, IDX.board);
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(findEvent(events, "PRIZES_OWED")).toMatchObject({ seat: "p1", count: 1 });
    // …and the benched body's own placement is not swallowed by the KO
    expect(after.players.p2.bench[0]?.damage).toBe(20);
    expect(after.phase.kind).toBe("ko:takePrizes");
  });

  it("the OWN-SIDE KO owes the OPPONENT a Prize — D425's seam, reached by a placement", () => {
    let state = fielded(71, { mine: ["fix-idlebody"], defender: "fix-bigbody" });
    state = setBenchDamage(state, "p1", 0, 140); // 200 HP at 140 → 60 is exactly lethal
    const { events } = attack(state, IDX.ability);
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p1" });
    expect(findEvent(events, "PRIZES_OWED")).toMatchObject({ seat: "p2", count: 1 });
    // the defender carries no printed Ability, so it is NOT in the fold and this board
    // has exactly one Knock Out — a two-sided batch would make the seat above ambiguous.
    expect(events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(1);
  });

  it("the KO is BY DAMAGE, and Vengeful Punch is where D414's marker is observable", () => {
    let state = fielded(72);
    state = attachToolFromDeck(state, "p2", "active", "sv03-197");
    state = setDamage(state, "p2", 180);
    const { state: after, events } = attack(state, IDX.board);
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(after.players.p1.active?.damage).toBe(40); // 4 counters, back onto the attacker
  });
});

describe("§9 — `source` on the wire, and the shipped Ability path unchanged", () => {
  it("an attack's placement renders in the PRINTED verb and never the word Ability", () => {
    const { state: after, events } = attack(fielded(80, { defender: "fix-idlebody" }), IDX.board);
    expect(placements(events).every((e) => e.source === "attack")).toBe(true);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: after, elapsed: "+00:07" };
    const rendered = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );
    const placed = rendered.find((r) => r.text.startsWith("Put:"));
    expect(placed).toBeDefined();
    expect(placed?.who).toBe("system");
    expect(placed?.text).toContain("20");
    expect(placed?.text).not.toContain("Ability");
    const own = attack(
      fielded(81, { mine: ["fix-idlebody"], defender: "fix-bigbody" }),
      IDX.ability,
    );
    const ownRows = logFromEvents(own.events, {
      names: { p1: "Ember", p2: "Tide" },
      state: own.state,
      elapsed: "+00:08",
    }).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );
    const ownPlaced = ownRows.find((r) => r.text.startsWith("Put:"));
    expect(ownPlaced?.who).toBe("system");
    expect(placements(own.events)[0]?.seat).toBe("p1"); // the ATTACKER's own body
  });

  it("the registry Ability path is byte-identical across this slice", () => {
    const program = programFor("sv06-053")?.triggered?.[0]?.program;
    expect(program).toEqual([
      {
        op: "counterEachAll",
        amount: 10,
        filter: { kind: "abilityPokemon" },
        side: "both",
        source: "ability",
        exceptNamed: "Froslass",
      },
    ]);
  });
});

describe("§10 — the attack really is the turn's last action", () => {
  it("refuses a second attack after the fold resolves", () => {
    const { state } = attack(fielded(90, { theirs: ["fix-bigbody"] }), IDX.board);
    expect(applyAction(state, { type: "attack", seat: "p1", index: IDX.board }).ok).toBe(false);
  });
});
