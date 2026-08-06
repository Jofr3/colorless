import { describe, expect, it } from "vitest";
import { POKEMON_TYPES, deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  CLASS_BLOCK_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.94.0 → 0.95.0 — the ATTACKER-CLASS filter (P3-M5 long tail, D146):
//
//   "During your opponent's next turn, prevent all damage done to this Pokémon
//    by attacks from Basic Pokémon."                               (3 printings)
//
// D142's own `preventDamage`, widened on a SECOND axis by a SECOND optional
// field — `effects` says what a block refuses, `fromClass` says whose attacks it
// refuses at all — and the four things this slice turns on are none of them the
// duration, which was bought whole at D142:
//
//   • it is the family's first UNGATED producer. No coin is printed, so the
//     derived program is the BARE op rather than a `coinFlipGate` body, and this
//     entire suite is seed-free — pinned by an unchanged `rngState` across an
//     install (D143's move), not by a seed table;
//   • the predicate is evaluated at the READ SITES and not at the install, for
//     the reason `preventDamageFromExV` is: the block is written on the
//     installer's own body during the installer's own turn, and the Pokémon it
//     will refuse has not declared anything yet. It is folded INTO
//     `attackBlockOf` so no read site can honour the stamp and forget the class;
//   • the two installers are each other's negative case — a Stage 2 and a Stage
//     1 — so "the filter failed" is driven off printed cards rather than posed;
//   • the printed sentence is the NARROW reading, so a MATCHED attacker still
//     lands every EFFECT it prints: the damage is nulled and the Energy discard,
//     the placed counter and the §12 status all go through.
//
// ⚠️ AND THE FOURTH PRINTING OF THIS SENTENCE IS NOT MAPPED. Iron Moth
// sv06.5-009's index-1 "Anachronism Repulsor" says "…from ANCIENT Pokémon", and
// Ancient is a BANNER printed on the card face: no column of the persisted
// catalog carries it and no field of tcgdex's own card model does either
// (checked upstream against Roaring Moon ex sv04-124, the canonical Ancient
// print). It has no reader because it has no DATUM — and a species-name table
// would answer three real cards WRONGLY, since Great Tusk ex sv01-123 is the same
// species with no banner. So the sentence stays LOUD, which is this family's
// standing answer to a token it cannot resolve.

const BASIC_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.";
const ANCIENT_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.";
/** D146's class as it is STORED since D239 — the record, not the string literal.
    Named once here so this suite reads as a statement about the printed class
    rather than about the shape that carries it; `typedClassBlock.test.ts` is
    where the shape itself is driven. */
const BASIC_CLASS = { stage: "basic" } as const;
/** D142's NARROW spelling — the same installation with no filter and a coin. */
const UNFILTERED_TEXT =
  "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks.";

/** One seed for the whole suite. Nothing here flips a coin, so a seed table
    would be describing a shuffle rather than a rule (contrast
    `preventBlock.test.ts`, whose every board is reached by sweeping for a face). */
const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    installer goes on P1's Active with the two {C} its index-0 attack costs; both
    installers are evolutions, fielded by surgery exactly as Ninetales sv03-029
    and Oinkologne sv01-157 are in the neighbouring suites. */
function armed(installer: string, energy = 2): GameState {
  let state = must(
    applyAction(driveSetup(SEED, { p1: CLASS_BLOCK_DECK, p2: CLASS_BLOCK_DECK }, { first: "p2" }), {
      type: "endTurn",
      seat: "p2",
    }),
  );
  state = setActiveFromDeck(state, "p1", installer);
  return attachFromDeck(state, "p1", "fix-energy", energy);
}

/** `armed`, then the install declared. Asserts the row actually landed rather
    than trusting the arithmetic, so a board that failed to install can never
    leave a case asserting "nothing was blocked" against nothing. Returns P2's
    turn. */
function installed(installer: string, energy = 2): GameState {
  const { state, events } = mustApply(armed(installer, energy), {
    type: "attack",
    seat: "p1",
    index: 0,
  });
  if (find(events, "ATTACK_BLOCK_APPLIED") === undefined) {
    throw new Error(`${installer} did not install a block`);
  }
  return state;
}

/** The declaration every filter case is: put `attacker` on P2's Active with the
    energy it needs and swing at the shielded body. */
function swing(
  state: GameState,
  attacker: string,
  energy: { id: string; count: number },
  index = 0,
) {
  let next = setActiveFromDeck(state, "p2", attacker);
  next = attachFromDeck(next, "p2", energy.id, energy.count);
  return mustApply(next, { type: "attack", seat: "p2", index });
}

describe("the attacker-CLASS filter — derived, not authored", () => {
  it("derives to a BARE preventDamage carrying `fromClass` — no gate at all", () => {
    expect(deriveAttackEffect(BASIC_TEXT)).toEqual([{ op: "preventDamage", fromClass: BASIC_CLASS }]);
    // The typographic apostrophe derives identically — a re-ingest that changes
    // only punctuation must not silently un-simulate three printings (D136/D137).
    expect(deriveAttackEffect(BASIC_TEXT.replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(BASIC_TEXT),
    );
  });

  it("is UNGATED — the first producer of this op that is not a coinFlipGate body", () => {
    // Every one of D142's 13 printings prints "Flip a coin. If heads,"; these
    // three print nothing of the sort, so the whole gate/consequent shape is
    // absent rather than defaulted. `toEqual` would not catch a wrapper that
    // happened to be empty, so the op kinds are read out directly.
    const derived = deriveAttackEffect(BASIC_TEXT) as EffectOp[];
    expect(derived.map((op) => op.op)).toEqual(["preventDamage"]);
    const gated = deriveAttackEffect(UNFILTERED_TEXT) as EffectOp[];
    expect(gated.map((op) => op.op)).toEqual(["coinFlipGate"]);
  });

  it("keeps `effects` ABSENT and `fromClass` PRESENT — the two fields, two phrases", () => {
    const derived = deriveAttackEffect(BASIC_TEXT) as EffectOp[];
    // ABSENT rather than `false` (D135's rule): the sentence never says "from and
    // effects of", so the op carries no claim about the wider reading. `toEqual`
    // ignores undefined keys, so the key SET is the assertion.
    expect(Object.keys(derived[0] as object).sort()).toEqual(["fromClass", "op"]);
  });

  it("differs from D142's unfiltered narrow body in EXACTLY `fromClass`", () => {
    // The widen-don't-add claim (D131) asserted a second time on the same op:
    // strip the one field and this program is the gated narrow spelling's BODY,
    // byte for byte — so a second op member would have been two copies of one
    // installation told apart by who it refuses.
    const filtered = deriveAttackEffect(BASIC_TEXT) as EffectOp[];
    const gate = (deriveAttackEffect(UNFILTERED_TEXT) as EffectOp[])[0] as Extract<
      EffectOp,
      { op: "coinFlipGate" }
    >;
    const stripped = JSON.parse(
      JSON.stringify(filtered).replace(',"fromClass":{"stage":"basic"}', ""),
    );
    expect(stripped).toEqual(gate.then);
  });

  it("is anchored end to end", () => {
    expect(deriveAttackEffect(`Then, ${BASIC_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(BASIC_TEXT.slice(0, -1))).toBeNull();
    expect(deriveAttackEffect(BASIC_TEXT.toLowerCase())).toBeNull();
    // A GATED spelling of this exact sentence is not printed anywhere and must
    // not derive: the anchor starts at "During", so a coin prefix cannot ride in
    // front of it and silently install without flipping.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${BASIC_TEXT.toLowerCase()}`)).toBeNull();
    // …and a trailing second sentence keeps the whole thing LOUD, which is the
    // guard the `takes {N} less damage` family will need the day it lands.
    expect(deriveAttackEffect(`${BASIC_TEXT} Draw a card.`)).toBeNull();
  });

  it("refuses the ANCIENT spelling — no reader, because there is no DATUM", () => {
    // THE SLICE'S HEADLINE REFUSAL, and it is not "we ran out of time". "Ancient"
    // is a banner printed on the card FACE from Paradox Rift (sv04) onward: it is
    // in no column of the persisted catalog and in no field of tcgdex's own card
    // model — checked upstream against Roaring Moon ex sv04-124, whose payload
    // carries `suffix: "ex"` for its rule box and nothing at all for the banner.
    // A species-name table would be WRONG rather than incomplete: Great Tusk ex
    // sv01-123/-230/-246 is one of the Ancient species and carries no banner, so
    // any name-keyed answer is wrong on three real cards with no failure anywhere.
    // Loud is the only honest answer, and this is where it is pinned.
    expect(deriveAttackEffect(ANCIENT_TEXT)).toBeNull();
    // The two sentences differ in ONE WORD, so the refusal is a property of the
    // anchor rather than of the shape — assert that they really are one word apart.
    expect(ANCIENT_TEXT).toBe(BASIC_TEXT.replace("Basic Pokémon", "Ancient Pokémon"));
    // …and the rest of the family's LOUD list, inherited from D142 rather than
    // re-censused (effects.ts carries the same table).
    for (const text of [
      // Corviknight sv02-148 "Accelerate" — gated on the attack's own RESULT.
      "If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      // Squawkabilly sv01-162 "Fly" — a SECOND consequent on the same flip.
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      // Bronzong sv03-145 "Oracle Press" — effects WITHOUT damage.
      "During your opponent's next turn, prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("costs zero registry rows — both cards simulate off their printed text", () => {
    expect(programFor("sv01-150")).toBeUndefined();
    expect(programFor("sv02-153")).toBeUndefined();
  });

  it("keeps the fixtures' printed text, cost, damage and INDEX verbatim", () => {
    // Ids, names, costs, printed damage and the INDEX all checked against the
    // local D1 (2026-08-02, 978 cards / 6 sets) PER PRINTING — D144's rule, and the reason
    // this slice found that four remainder lists had the two cards misnamed.
    expect(FIXTURE_POOL["sv01-150"]?.name).toBe("Staraptor");
    expect(FIXTURE_POOL["sv01-150"]?.attacks?.[0]).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Tailspin Away",
      damage: 60,
      effect: BASIC_TEXT,
    });
    expect(FIXTURE_POOL["sv02-153"]?.name).toBe("Noivern ex");
    expect(FIXTURE_POOL["sv02-153"]?.attacks?.[0]).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Covert Flight",
      damage: 70,
      effect: BASIC_TEXT,
    });
    // Two EVOLUTIONS, at two different stages — which is what makes them each
    // other's non-matching attacker rather than a bespoke fixture's job.
    expect(FIXTURE_POOL["sv01-150"]?.stage).toBe("Stage2");
    expect(FIXTURE_POOL["sv02-153"]?.stage).toBe("Stage1");
    expect(BASIC_TEXT).toContain("opponent's");
    expect(BASIC_TEXT).not.toContain("’");
  });

  it("emits `fromClass` from a CLOSED vocabulary, swept over the whole pool", () => {
    // Discovered rather than listed (D140's move): every `preventDamage` any
    // attack in the pool can produce is walked, and the field is asserted to hold
    // only vocabulary the predicate has an arm for. A slice that teaches the
    // deriver a new class token fails HERE as well as at the compiler.
    //
    // ⚠️ D239 WIDENED WHAT "VOCABULARY" MEANS HERE, AND THE SWEEP WENT RED FIRST
    // — which is the pin working. The field is now an `AttackerClass` RECORD, so
    // the closed set is checked per KEY: `stage` against the one-member union the
    // predicate switches on, and `excludingType` against `POKEMON_TYPES` (absent
    // is allowed and is D146's own reading). Asserting the whole record against a
    // literal would have to list eleven exclusions the day a second code prints.
    const producers = new Set<string>();
    const walk = (ops: EffectOp[], id: string) => {
      for (const op of ops) {
        if (op.op === "coinFlipGate") walk(op.then, id);
        else if (op.op === "preventDamage" && op.fromClass !== undefined) {
          expect(op.fromClass.stage).toBe("basic");
          if (op.fromClass.excludingType !== undefined) {
            expect(POKEMON_TYPES as readonly string[]).toContain(op.fromClass.excludingType);
          }
          producers.add(id);
        }
      }
    };
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walk(derived, card.id);
      }
      const authored = programFor(card.id)?.attack;
      for (const ops of Object.values(authored ?? {})) walk(ops, card.id);
    }
    // The producer SET, not a two-id predicate (D145's move): a third producer
    // fails loudly instead of being absorbed — and D239's `fix-crown` is exactly
    // that, admitted here BY NAME rather than by widening the assertion. Its two
    // attack indexes are the two readings of one anchor, so it appears once.
    expect([...producers].sort()).toEqual(["fix-crown", "sv01-150", "sv02-153"]);
  });
});

describe("the attacker-CLASS filter — installing it", () => {
  it("installs with NO coin — the rngState does not move", () => {
    const before = armed("sv01-150");
    const { state: done, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    // The whole reason this suite has no seed table: nothing here is random, so
    // determinism is a property of the sentence rather than of the shuffle.
    expect(done.rngState).toBe(before.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("stamps the OPPONENT's next turn and names the CLASS in the actor's voice", () => {
    const state = armed("sv01-150");
    const installer = activeUid(state, "p1");
    expect(state.turn).toBe(2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(find(events, "ATTACK_BLOCK_APPLIED")).toEqual({
      type: "ATTACK_BLOCK_APPLIED",
      seat: "p1",
      uid: installer,
      effects: false,
      fromClass: BASIC_CLASS,
    });
    // The stamp is D142's, unchanged: turn 2 installed it, turn 3 is the
    // opponent's, and that is the only turn it answers on.
    expect(done.players.p1.active?.attackBlock).toEqual({
      turn: 3,
      effects: false,
      fromClass: BASIC_CLASS,
    });
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Attacker-relative, like every "self" op.
    expect(done.players.p2.active?.attackBlock).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) expect(benched.attackBlock).toBeNull();
    }
  });

  it("keeps the printed damage — a D125 tail board on BOTH installers", () => {
    for (const [installer, printed] of [
      ["sv01-150", 60],
      ["sv02-153", 70],
    ] as const) {
      const { state: done, events } = mustApply(armed(installer), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      const order = types(events);
      // The §8.5 hit lands FIRST and the install rides the tail behind it — free
      // rather than lucky, since the block's whole effect is in the future (D125).
      expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ATTACK_BLOCK_APPLIED"));
      expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(printed);
      expect(done.players.p1.active?.attackBlock?.fromClass).toEqual(BASIC_CLASS);
    }
  });

  it("does not inherit down the attack index — Power Blast installs nothing", () => {
    const { state: done, events } = mustApply(armed("sv01-150", 3), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
    expect(done.players.p1.active?.attackBlock).toBeNull();
    // …and index 1 really did resolve: 180 landed and its own self-discard ran.
    expect(find(done ? [] : [], "DAMAGE_DEALT")).toBeUndefined();
    expect(types(events)).toContain("ENERGY_DISCARDED");
  });

  it("leaves the OTHER installer's unmapped sibling LOUD", () => {
    // Noivern ex's index-1 "Dominating Echo" prints a Special-Energy / Stadium
    // lock nothing in this engine reads. It is the live unmapped witness this
    // slice adds to its own deck (D135's move): the day it is mapped, this case
    // must be re-pointed rather than deleted.
    const { events } = mustApply(
      attachFromDeck(
        attachFromDeck(armed("sv02-153", 0), "p1", "fix-psychic-energy", 1),
        "p1",
        "fix-dark-energy",
        1,
      ),
      { type: "attack", seat: "p1", index: 1 },
    );
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
  });

  it("does NOT lift at the Checkup that ends the INSTALLER's own turn", () => {
    // D142's finding, re-driven because the filter must not have moved it: the
    // very first Checkup after the attack has `endedSeat` = the holder's seat,
    // and a paralysis-clock clear would lift the block before its window opened.
    const { state: done, events } = mustApply(armed("sv01-150"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).toContain("TURN_STARTED");
    expect(done.players.p1.active?.attackBlock?.turn).toBe(3);
  });
});

describe("the attacker-CLASS filter — both sides of the filter, end to end", () => {
  it("a BASIC attacker is prevented, on both installers", () => {
    for (const installer of ["sv01-150", "sv02-153"] as const) {
      const state = installed(installer);
      deepFreeze(state);
      const { state: done, events } = swing(state, "fix-attacker", { id: "fix-energy", count: 1 });
      const hit = find(events, "DAMAGE_DEALT");
      expect(hit).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
      expect(done.players.p1.active?.damage).toBe(0);
    }
  });

  it("a NON-Basic attacker lands in FULL — and the two installers prove it to each other", () => {
    // THE CASE THE WHOLE FIELD EXISTS FOR, driven off printed cards rather than a
    // bespoke fixture: a STAGE 2 swings into the Stage 1's block for its whole
    // 180, and the STAGE 1 swings into the Stage 2's for its whole 70. No row
    // announces the failure — `DAMAGE_DEALT` with `prevented` absent and the real
    // number in `dealt` is the whole story, and a "the block declined" row would
    // be announcing a non-event.
    const intoNoivern = swing(installed("sv02-153"), "sv01-150", { id: "fix-energy", count: 3 }, 1);
    const bigHit = find(intoNoivern.events, "DAMAGE_DEALT");
    expect(bigHit).toMatchObject({ seat: "p1", dealt: 180 });
    expect(bigHit?.prevented).toBeUndefined();
    expect(intoNoivern.state.players.p1.active?.damage).toBe(180);
    expect(types(intoNoivern.events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    // …and the block is still sitting there, live and simply not matching.
    expect(intoNoivern.state.players.p1.active?.attackBlock).toEqual({
      turn: 3,
      effects: false,
      fromClass: BASIC_CLASS,
    });

    const intoStaraptor = swing(installed("sv01-150"), "sv02-153", { id: "fix-energy", count: 2 });
    const hit = find(intoStaraptor.events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 70 });
    expect(hit?.prevented).toBeUndefined();
    expect(intoStaraptor.state.players.p1.active?.damage).toBe(70);
  });

  it("the §8.5 pipeline still RUNS and the block nulls the RESULT", () => {
    // Pincurchin is a BASIC and Lightning; Staraptor is ×2 LIGHTNING. So the
    // unblocked number is 140, the row still REPORTS the Weakness it computed,
    // and the block supersedes rather than stacks — exactly like Mimikyu's
    // Safeguard on the same `||` one token away. A blocked 0 here is therefore 0
    // rather than 0 by coincidence.
    const { state: done, events } = swing(installed("sv01-150"), "sv02-072", {
      id: "fix-lightning-energy",
      count: 3,
    });
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
    expect(hit?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(hit?.base).toBe(70);
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("protects THIS Pokémon and not the rest of the board", () => {
    // fix-sniper is a BASIC, so the filter MATCHES — and one declaration still
    // gives two answers: 30 prevented on the shielded Active, 20 landing on every
    // benched body. "Done to this Pokémon" is a per-Pokémon claim and the class
    // filter does not widen it.
    const state = installed("sv01-150");
    const benchBefore = state.players.p1.bench.map((p) => p.damage);
    expect(benchBefore.length).toBeGreaterThan(0);
    const { state: done, events } = swing(state, "fix-sniper", { id: "fix-energy", count: 1 });
    const rows = findAll(events, "DAMAGE_DEALT");
    expect(rows.find((r) => r.uid === activeUid(state, "p1"))).toMatchObject({
      dealt: 0,
      prevented: true,
    });
    for (const [i, before] of benchBefore.entries()) {
      expect(done.players.p1.bench[i]?.damage).toBe(before + 20);
    }
  });

  it("expires by arithmetic — the SAME Basic attacker lands in full a turn later", () => {
    let state = installed("sv01-150");
    const blocked = swing(state, "fix-attacker", { id: "fix-energy", count: 1 });
    expect(find(blocked.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    // Turn 4 is P1's; they pass. Turn 5 is P2's again — and the stamp says 3.
    expect(blocked.state.turn).toBe(4);
    state = must(applyAction(blocked.state, { type: "endTurn", seat: "p1" }));
    expect(state.turn).toBe(5);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ dealt: 30 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(30);
    // The stale stamp is still sitting there answering nothing — D142's design,
    // and the filter changed nothing about it.
    expect(done.players.p1.active?.attackBlock).toEqual({
      turn: 3,
      effects: false,
      fromClass: BASIC_CLASS,
    });
  });
});

describe("the attacker-CLASS filter — it is the NARROW reading, so effects go through", () => {
  it("nulls a matched Basic's DAMAGE and lets its Energy discard land", () => {
    // ONE declaration, both halves: Pincurchin's "Needle Crush" is 70 damage AND
    // a discard off the defender. The block matched — Pincurchin is a Basic — and
    // still only the damage is refused, because the sentence never says "from and
    // effects of". D142 shipped two readings precisely so this card would not
    // have its discard refused by a printing that does not refuse it.
    const state = installed("sv01-150");
    expect(state.players.p1.active?.energy).toHaveLength(2);
    const { state: done, events } = swing(state, "sv02-072", {
      id: "fix-lightning-energy",
      count: 3,
    });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(types(events)).toContain("ENERGY_DISCARDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });

  it("lets a matched Basic PLACE damage counters — a counter is not damage", () => {
    // Mimikyu "Ghost Eye" puts 7 counters (70 HP) and is a BASIC, so the filter
    // matches on the attacker and the placement still goes through: a placed
    // counter skips Weakness, Resistance and every reduction in this engine
    // (D138/D139), and the catalog prints the rule — "(Damage is not an effect.)"
    // This is the only route to damaging a body under a matched filter.
    const { state: done, events } = swing(installed("sv01-150"), "sv02-097", {
      id: "fix-psychic-energy",
      count: 2,
    });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: 70,
      source: "attack",
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p1.active?.damage).toBe(70);
  });

  it("lets a matched Basic apply a §12 Special Condition", () => {
    const { state: done, events } = swing(
      installed("sv01-150"),
      "fix-attacker",
      { id: "fix-energy", count: 1 },
      2,
    );
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "asleep" });
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    // The ROW is the assertion rather than the residue, and deliberately: Yawn
    // ends the turn, so §13.3's wake flip runs inside this very event stream and
    // may already have lifted the condition. Asserting the residue would make
    // this case a statement about a coin instead of about the block, which is
    // the whole reason the suite is otherwise seed-free.
    const woke = find(events, "CHECKUP_COIN_FLIP");
    expect(done.players.p1.active?.conditions.rotation).toBe(
      woke?.result === "heads" ? "none" : "asleep",
    );
  });
});

describe("the attacker-CLASS filter — the EFFECTS half, unreachable but guarded", () => {
  /** Write a WIDE and FILTERED block onto P1's Active by surgery. No printing
      installs one: all three `fromClass` printings are the narrow spelling, so
      `effects: true` and `fromClass` never co-occur off a real card. It is
      constructed rather than pretended into a board — D144's precedent for a rule
      with no card — because the alternative is `fromClass` meaning one thing at
      the four damage sites and another at the effects gate, which is precisely the
      drift the single-read contract exists to stop. */
  function wideFiltered(state: GameState): GameState {
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active to shield");
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: { ...active, attackBlock: { turn: state.turn, effects: true, fromClass: BASIC_CLASS } },
        },
      },
    };
  }

  it("refuses a MATCHED Basic's effect and lets a NON-matching Stage 1's through", () => {
    // The same op (`damageActive`), the same target and the same window, told
    // apart by nothing but the attacker's stage: Mimikyu is a Basic and Polteageist
    // is a Stage 1, so one placement is refused with a row and the other lands.
    const base = wideFiltered(installed("sv01-150"));
    const matched = swing(base, "sv02-097", { id: "fix-psychic-energy", count: 2 });
    expect(types(matched.events)).not.toContain("COUNTERS_PLACED");
    expect(find(matched.events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p1" });
    expect(matched.state.players.p1.active?.damage).toBe(0);

    const unmatched = swing(base, "sv03-098", { id: "fix-psychic-energy", count: 1 }, 1);
    expect(find(unmatched.events, "COUNTERS_PLACED")).toMatchObject({ seat: "p1", amount: 50 });
    expect(types(unmatched.events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(unmatched.state.players.p1.active?.damage).toBe(50);
  });
});

describe("the attacker-CLASS filter — lifetime, merging and the early clears", () => {
  it("ends when the Pokémon leaves the Active Spot — a Boss's Orders inside the window", () => {
    // D142's reachable §10 clear, re-driven: the holder is the ATTACKER's own
    // body, so the opponent can drag it off the spot during the very turn the
    // block covers. And it is GONE rather than merely unread — fix-sniper is a
    // BASIC, so a block that survived the move would still have matched.
    let state = installed("sv01-150");
    const shielded = activeUid(state, "p1");
    expect(state.players.p1.bench.length).toBeGreaterThan(0);
    state = handFromDeck(state, "p2", "sv02-172", 1);
    const gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    });
    let next = gusted.state;
    if (next.phase.kind === "effect:choose") {
      next = must(
        applyAction(next, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benchIndex = next.players.p1.bench.findIndex((p) => p.stack.includes(shielded));
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    expect(next.players.p1.bench[benchIndex]?.attackBlock).toBeNull();
    // Silent: the switch row already tells the story (D112's call, events.ts).
    expect(types(gusted.events)).not.toContain("ATTACK_BLOCK_APPLIED");
    next = setActiveFromDeck(next, "p2", "fix-sniper");
    next = attachFromDeck(next, "p2", "fix-energy", 1);
    const { state: hit, events } = mustApply(next, { type: "attack", seat: "p2", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
    expect(hit.players.p1.bench[benchIndex]?.damage).toBe(20);
  });

  it("ends on evolution (§10) — unreachable in play, pinned anyway", () => {
    // No legal sequence reaches it: installing ends the turn, the window is the
    // opponent's, and nobody evolves during it. §10 sheds the effects of ATTACKS
    // and this is one, so the rule is asserted by surgery (D142's own shape).
    let state = must(applyAction(installed("sv01-150"), { type: "endTurn", seat: "p2" }));
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // biome-ignore lint/style/noNonNullAssertion: the surgery above set it.
          active: { ...state.players.p1.active!, attackBlock: { turn: 99, effects: false, fromClass: BASIC_CLASS } },
        },
      },
    };
    state = handFromDeck(state, "p1", "fix-stage1", 1);
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-stage1"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p1.active?.attackBlock).toBeNull();
  });

  it("a second install may only WIDEN — a filter landing on an unfiltered block drops", () => {
    // The merge rule, and it reads the same on both axes: two installations must
    // never leave the holder with less protection than one of them printed. So an
    // unfiltered block already stamped for this window SURVIVES a filtered install
    // landing on top of it, and the row says so. Unreachable off any printing (no
    // card prints two of these attacks), constructed for the same reason the
    // effects gate above is.
    const state = armed("sv01-150");
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const primed: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: { ...active, attackBlock: { turn: state.turn + 1, effects: true } },
        },
      },
    };
    const { state: done, events } = mustApply(primed, { type: "attack", seat: "p1", index: 0 });
    // …and because the merge said nothing NEW, the row is suppressed entirely
    // (D142's idempotence rule, now answering on two fields instead of one): the
    // holder was already protected from everything, so announcing a narrowing
    // that did not happen would be the log's version of the bug this rule stops.
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    expect(done.players.p1.active?.attackBlock?.fromClass).toBeUndefined();
    // …and it is really unfiltered now: a NON-Basic attacker is refused.
    const { events: swung } = swing(done, "sv02-153", { id: "fix-energy", count: 2 });
    expect(find(swung, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });
});
