import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  MUNKIDORI_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setConditions,
  setDamage,
  types,
  findEvent,
} from "./testFixtures";

const OH_NO_YOU_DONT =
  "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, and if you have any Pecharunt ex in play, your opponent takes 1 fewer Prize card.";
/** Lucario's, kept verbatim because the whole point is that it is NOT this one. */
const AVENGING_KNUCKLE =
  "If any of your {F} Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 120 more damage.";
/** Exp. Share's, the third consequent — carried so the remainder is a STRING. */
const EXP_SHARE =
  "When your Active Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, you may move a Basic Energy from that Pokémon to the Pokémon this card is attached to.";

const MUNKIDORI_PRIZES = 2;
const REDUCED_PRIZES = 1;

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30, no effect
const yawn = { type: "attack", seat: "p1", index: 2 } as const; // Yawn — no damage, a status
const spread = { type: "attack", seat: "p1", index: 0 } as const;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The rendered log a player actually reads — the same helper shape
    `vengefulPunch.test.ts` uses, so the two suites' rows are comparable. */
function render(
  events: GameEvent[],
  state: GameState,
  names: { p1: string; p2: string } = { p1: "Ember", p2: "Tide" },
): { who: string; text: string }[] {
  const ctx: LogContext = { names, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

function field(
  seed: number,
  opts: {
    holder?: string;
    attacker?: string;
    bench?: { id: string; damage?: number }[];
    holderDamage?: number;
    /** Bench the ATTACKER's side — the "from your OPPONENT'S Pokémon" board. */
    attackerBench?: { id: string; damage?: number }[];
  } = {},
): GameState {
  let state = driveSetup(seed, { p1: MUNKIDORI_DECK, p2: MUNKIDORI_DECK }, { first: "p2" });
  // P2's turn — plant the holder, clear the setup bench, then build the exact one.
  state = setActiveFromDeck(state, "p2", opts.holder ?? "sv06.5-037");
  state = { ...state, players: { ...state.players, p2: { ...state.players.p2, bench: [] } } };
  for (const [i, entry] of (opts.bench ?? []).entries()) {
    state = benchFromDeck(state, "p2", entry.id);
    if (entry.damage !== undefined) state = setBenchDamage(state, "p2", i, entry.damage);
  }
  if (opts.holderDamage !== undefined) state = setDamage(state, "p2", opts.holderDamage);
  // Hand the turn to P1 and field the attacker.
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", opts.attacker ?? "fix-attacker");
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
  for (const [i, entry] of (opts.attackerBench ?? []).entries()) {
    state = benchFromDeck(state, "p1", entry.id);
    if (entry.damage !== undefined) state = setBenchDamage(state, "p1", i, entry.damage);
  }
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// The printed datum — re-queried per claim, never inherited.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed datum — re-queried, not inherited", () => {
  it("authors all THREE printings as one `onKoPrizeReduction` on-KO trigger", () => {
    const authored = {
      name: "Oh No You Don't",
      trigger: "onKnockOut",
      program: [],
      onKoPrizeReduction: { by: 1, requiresInPlay: "Pecharunt ex" },
    };
    // The three ids are ONE body in the catalog, so they are ONE program here.
    expect(programFor("sv06.5-037")?.triggered).toEqual([authored]);
    expect(programFor("sv06.5-083")?.triggered).toEqual([authored]);
    expect(programFor("sv06.5-091")?.triggered).toEqual([authored]);
    // `program` is EMPTY — like Glimmora's, this queues no koTrigger stage. A
    // non-empty one would make the sweep park where the printed card does not.
    expect(programFor("sv06.5-037")?.triggered?.[0]?.program).toEqual([]);
  });

  it("the fixture's Ability string is the D1 row, character for character", () => {
    const ability = FIXTURE_POOL["sv06.5-037"]?.abilities?.[0];
    expect(ability?.name).toBe("Oh No You Don't");
    expect(ability?.effect).toBe(OH_NO_YOU_DONT);
    expect(CATALOG_MANIFEST.printed["sv06.5-037"]?.name).toBe("Munkidori ex");
    expect(CATALOG_MANIFEST.printed["sv06.5-037"]?.abilities).toEqual(["Oh No You Don't"]);
    expect(CATALOG_MANIFEST.printed["sv06.5-037"]?.attacks).toEqual(["Dirty Headbutt"]);
    expect(FIXTURE_POOL["sv06.5-037"]?.attacks?.[0]?.effect).toBe(
      "During your next turn, this Pokémon can't use Dirty Headbutt.",
    );
  });

  it("the BOARD CONDITION names a card with FOUR printings, so it matches by NAME", () => {
    // "if you have any Pecharunt ex in play" — sv06.5-039/-085/-093/-095 in the
    // local D1. No id would cover them, and the sentence names the CARD.
    expect(programFor("sv06.5-037")?.triggered?.[0]?.onKoPrizeReduction?.requiresInPlay).toBe(
      "Pecharunt ex",
    );
    expect(FIXTURE_POOL["sv06.5-039"]?.name).toBe("Pecharunt ex");
    expect(CATALOG_MANIFEST.printed["sv06.5-039"]?.name).toBe("Pecharunt ex");
  });

  it("the sentence is an ABILITY's and never derives as an attack effect", () => {
    // It lives on `abilities_json`. Feeding it to the attack deriver must stay
    // null — the column-blindness this family keeps tripping over, made a test.
    expect(deriveAttackEffect(OH_NO_YOU_DONT)).toBeNull();
  });

  it("LUCARIO's clause is NOT this antecedent, and the older account is right", () => {
    expect(AVENGING_KNUCKLE).toContain("Knocked Out by damage from an attack");
    expect(AVENGING_KNUCKLE).not.toContain("from your opponent's Pokémon");
    expect(AVENGING_KNUCKLE).toContain("during your opponent's last turn");
    expect(OH_NO_YOU_DONT).toContain("from your opponent's Pokémon");
    expect(OH_NO_YOU_DONT).not.toContain("last turn");
    // It is still UNMAPPED, and deliberately: it stays the live fall-through
    // witness in `conditionClause.test.ts` / `conditionalDamage.test.ts`.
    expect(programFor("sv01-114")?.triggered).toBeUndefined();
  });

  it("EXP. SHARE is the same antecedent — MAPPED at D171, and these FIVE pins are RE-POINTED", () => {
    expect(FIXTURE_POOL["sv01-174"]?.effect).toBe(EXP_SHARE);
    expect(CATALOG_MANIFEST.printed["sv01-174"]?.name).toBe("Exp. Share");
    expect(EXP_SHARE).toContain("Knocked Out by damage from an attack from your opponent's");
    expect(EXP_SHARE).toContain("you may");
    expect(EXP_SHARE).toContain("your Active Pokémon");
    expect(OH_NO_YOU_DONT).not.toContain("Active");
    const triggered = programFor("sv01-174")?.triggered;
    expect(triggered).toHaveLength(1);
    expect(triggered?.[0]?.trigger).toBe("onAllyActiveKnockOut");
    expect(triggered?.[0]?.trigger).not.toBe("onKnockOut");
    // …and it carries NEITHER Prize field, so the partition test below stays true
    // of it and the KO sweep never plans a prize off this card.
    expect(triggered?.[0]?.onKoPrizeGuard).toBeUndefined();
    expect(triggered?.[0]?.onKoPrizeReduction).toBeUndefined();
  });

  it("the two on-KO Prize fields PARTITION the registry — total and disjoint", () => {
    const guards: string[] = [];
    const reductions: string[] = [];
    for (const id of Object.keys(FIXTURE_POOL)) {
      for (const t of programFor(id)?.triggered ?? []) {
        if (t.trigger !== "onKnockOut") continue;
        if (t.onKoPrizeGuard !== undefined) guards.push(id);
        if (t.onKoPrizeReduction !== undefined) reductions.push(id);
      }
    }
    expect(guards).toEqual(["sv02-126"]);
    expect(reductions).toEqual(["fix-koprize", "sv06.5-037"]);
    expect(guards.filter((id) => reductions.includes(id))).toEqual([]);
    for (const id of ["sv06.5-037", "sv06.5-083", "sv06.5-091"]) {
      const t = programFor(id)?.triggered?.[0];
      expect(t?.onKoPrizeReduction, id).toEqual({ by: 1, requiresInPlay: "Pecharunt ex" });
      expect(t?.onKoPrizeGuard, id).toBeUndefined();
    }
    // …and Glimmora carries the guard and NOT the reduction, the other half.
    expect(programFor("sv02-126")?.triggered?.[0]?.onKoPrizeReduction).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The headline: the reduction, and the three clauses that refuse it.
// ─────────────────────────────────────────────────────────────────────────────

describe("the reduction — 2 Prizes become 1 when every clause holds", () => {
  it("Munkidori ex is KO'd by Bite with a Pecharunt ex benched: the opponent takes 1", () => {
    // 210 HP pre-damaged to 190; Bite's 30 makes 220 ≥ 210, so it is Knocked Out
    // — and its own Ability cuts the Prize its killer takes from 2 to 1.
    const state = field(1, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    const holder = state.players.p2.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: holder });
    expect(findEvent(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2", // the KO'd side — the Ability's OWNER
      uid: holder,
      ability: "Oh No You Don't",
    });
    expect(findEvent(events, "PRIZE_REDUCED")).toEqual({
      type: "PRIZE_REDUCED",
      seat: "p2",
      uid: holder,
      by: 1,
      count: REDUCED_PRIZES,
    });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: REDUCED_PRIZES });
    // No flip was spent — this card has none, and rng must not advance for it.
    expect(types(events)).not.toContain("ABILITY_COIN_FLIP");
    expect(done.rngState).toBe(state.rngState);
  });

  it("with NO Pecharunt ex in play the SAME board pays face value — 2", () => {
    // The board condition, driven as a one-card difference: the identical KO,
    // with the bench slot holding a body of another name.
    const state = field(2, { holderDamage: 190, bench: [{ id: "fix-titan" }] });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(types(events)).toContain("KNOCKED_OUT");
    expect(findEvent(events, "PRIZE_REDUCED")).toBeUndefined();
    expect(findEvent(events, "ABILITY_TRIGGERED")).toBeUndefined();
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: MUNKIDORI_PRIZES });
  });

  it("a Pecharunt ex on the OPPONENT'S board does not count — 'if YOU have'", () => {
    const state = field(3, {
      holderDamage: 190,
      bench: [{ id: "fix-titan" }],
      attackerBench: [{ id: "sv06.5-039" }],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(findEvent(events, "PRIZE_REDUCED")).toBeUndefined();
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: MUNKIDORI_PRIZES });
  });

  it("an ACTIVE Pecharunt ex counts too — 'in play' is not 'on the Bench'", () => {
    // The scan covers Active and Bench. Here Pecharunt ex is P2's Active and the
    // dying Munkidori ex is BENCHED, which also exercises the next case's clause.
    const state = field(4, {
      holder: "sv06.5-039",
      attacker: "fix-sniper",
      bench: [{ id: "sv06.5-037", damage: 200 }],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(findEvent(events, "PRIZE_REDUCED")).toMatchObject({ seat: "p2", count: REDUCED_PRIZES });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: REDUCED_PRIZES });
  });

  it("a BENCHED Munkidori ex finished by a snipe fires — the clause prints no 'Active'", () => {
    const state = field(5, {
      attacker: "fix-sniper",
      holder: "fix-bigbody",
      bench: [{ id: "sv06.5-037", damage: 200 }, { id: "sv06.5-039" }],
    });
    const benched = state.players.p2.bench[0]?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    // The Active (200 HP fix-bigbody) survives its 30; only the bench body dies.
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    expect(findEvent(events, "PRIZE_REDUCED")).toMatchObject({
      uid: benched,
      count: REDUCED_PRIZES,
    });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: REDUCED_PRIZES });
  });

  it("a hit that does NOT Knock it Out changes nothing — it is a KO clause", () => {
    const state = field(6, { holderDamage: 100, bench: [{ id: "sv06.5-039" }] });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(findEvent(events, "PRIZE_REDUCED")).toBeUndefined();
    expect(done.players.p1.prizes).toHaveLength(6);
  });
});

describe("CAUSE — 'by damage from an attack from your OPPONENT'S Pokémon'", () => {
  it("a POISON Knock Out at the Checkup does NOT reduce the Prize — 'by an attack'", () => {
    let state = field(7, { holderDamage: 200, bench: [{ id: "sv06.5-039" }] });
    state = setConditions(state, "p2", { poisonDamage: 10 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });

    // The poison DID kill it, in its own voice…
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p2", source: "poison" });
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(findEvent(events, "PRIZE_REDUCED")).toBeUndefined();
    expect(findEvent(events, "ABILITY_TRIGGERED")).toBeUndefined();
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: MUNKIDORI_PRIZES });
  });

  it("GLIMMORA on the SAME Checkup board still denies its Prize — the refusal", () => {
    let state = field(8, { holder: "sv02-126", holderDamage: 20 });
    state = setConditions(state, "p2", { poisonDamage: 10 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });

    expect(types(events)).toContain("KNOCKED_OUT");
    expect(findEvent(events, "ABILITY_COIN_FLIP")).toMatchObject({ ability: "Shattering Crystal" });
    // Whichever way the flip lands, the OTHER field never spoke.
    expect(findEvent(events, "PRIZE_REDUCED")).toBeUndefined();
    const prevented = findEvent(events, "PRIZE_PREVENTED") !== undefined;
    expect(done.phase).toEqual(
      prevented
        ? { kind: "ko:promote", seat: "p2" }
        : { kind: "ko:takePrizes", seat: "p1", count: 1 },
    );
  });

  it("a Munkidori ex on the ATTACKER'S OWN board pays nothing — 'from your OPPONENT'S'", () => {
    const state = field(9, {
      attacker: "fix-sniper",
      holder: "fix-bigbody",
      attackerBench: [{ id: "sv06.5-037", damage: 210 }, { id: "sv06.5-039" }],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p1" });
    expect(findEvent(events, "PRIZE_REDUCED")).toBeUndefined();
    // The prizes for a self-KO go to the DEFENDER, at face value.
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: MUNKIDORI_PRIZES });
  });

  it("an ABILITY's mid-turn snipe KO does not reduce it either — the OTHER non-attack path", () => {
    let state = field(11, { holder: "fix-bigbody", bench: [] });
    state = benchFromDeck(state, "p2", "sv06.5-037");
    state = setBenchDamage(state, "p2", 0, 200);
    state = benchFromDeck(state, "p2", "sv06.5-039"); // the board condition HOLDS
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const hand = handUid(state, "p1", "sv01-118");
    deepFreeze(state);

    const { state: parked, events } = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid: hand,
    });
    expect(findEvent(events, "ABILITY_TRIGGERED")).toMatchObject({ ability: "Flying Entry" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");

    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: prompt.candidates.slice(0, 2) },
    });

    // The Ability DID Knock the Munkidori ex Out…
    expect(types(e2)).toContain("KNOCKED_OUT");
    expect(findEvent(e2, "PRIZE_REDUCED")).toBeUndefined();
    const counts = done.pending
      .filter((s) => s.kind === "takePrizes")
      .map((s) => (s as { count: number }).count);
    expect(counts).toEqual([MUNKIDORI_PRIZES]);
  });

  it("a 0-damage attack that KOs nothing leaves both fields silent", () => {
    // Yawn deals no damage: `finishAttack` still runs and still passes
    // `attackerSeat`, but `lethalRefs` is empty and `planPrizes` is never called.
    const state = field(10, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    deepFreeze(state);

    const { events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(findEvent(events, "PRIZE_REDUCED")).toBeUndefined();
  });
});

describe("ORDER — the batch is one instant, and the plan is made before it", () => {
  it("a Pecharunt ex dying in the SAME batch still satisfies 'in play'", () => {
    const state = field(11, {
      attacker: "fix-sniper",
      holder: "fix-bigbody",
      bench: [
        { id: "sv06.5-037", damage: 200 },
        { id: "sv06.5-039", damage: 180 },
      ],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    // BOTH bench bodies die (190 HP Pecharunt ex at 180 + 20; 210 at 200 + 20).
    expect(all(events, "KNOCKED_OUT")).toHaveLength(2);
    // …and the Munkidori ex's Prize is still cut.
    expect(findEvent(events, "PRIZE_REDUCED")).toMatchObject({ count: REDUCED_PRIZES });
    // TWO prize stages, in ref order: the Munkidori ex's REDUCED 1 and the
    // Pecharunt ex's untouched 2. The second is the control — a batch-wide (as
    // opposed to per-body) reduction would have cut it as well.
    const counts = done.pending
      .filter((s) => s.kind === "takePrizes")
      .map((s) => (s as { count: number }).count);
    expect(counts).toEqual([REDUCED_PRIZES, MUNKIDORI_PRIZES]);
  });

  it("TWO Munkidori ex in one batch each reduce their OWN Prize", () => {
    const state = field(12, {
      attacker: "fix-sniper",
      holder: "fix-bigbody",
      bench: [
        { id: "sv06.5-037", damage: 200 },
        { id: "sv06.5-037", damage: 200 },
        { id: "sv06.5-039" },
      ],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(all(events, "KNOCKED_OUT")).toHaveLength(2);
    const reduced = all(events, "PRIZE_REDUCED");
    expect(reduced).toHaveLength(2);
    expect(reduced.map((e) => e.count)).toEqual([REDUCED_PRIZES, REDUCED_PRIZES]);
    const counts = done.pending
      .filter((s) => s.kind === "takePrizes")
      .map((s) => (s as { count: number }).count);
    expect(counts).toEqual([REDUCED_PRIZES, REDUCED_PRIZES]); // 2 Prizes total, not 4
  });

  it("the reduction reaches the §14 TIE GUARD — it can decide the game", () => {
    let state = field(13, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    // P1 down to ONE prize: 1 taken from a 2-Prize KO ends the game.
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, prizes: state.players.p1.prizes.slice(0, 1) },
      },
    };
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(findEvent(events, "PRIZE_REDUCED")).toMatchObject({ count: REDUCED_PRIZES });
    expect(done.phase.kind === "ko:takePrizes" || done.phase.kind === "gameOver").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE — rendered under BOTH seats and READ.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the row is SYSTEM, derived rather than inherited", () => {
  it("renders identically under both seats, and states BOTH numbers", () => {
    const state = field(14, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    const rows = render(events, done);
    const row = rows.find((r) => r.text.includes("fewer Prize card"));
    expect(row).toEqual({
      who: "system",
      text: "Munkidori ex — your opponent takes 1 fewer Prize card for it (1 instead of 2)",
    });
    // Swapping the names changes NOTHING, which is what "system" means here.
    expect(render(events, done, { p1: "Tide", p2: "Ember" })).toEqual(rows);
    expect(row?.text).toContain("(1 instead of 2)");
  });

  it("the Ability is NAMED by its own row, in the owner's voice", () => {
    const state = field(15, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, bite);

    const rows = render(events, done);
    const named = rows.find((r) => r.text.includes("Oh No You Don't"));
    expect(named).toBeDefined();
    expect(named?.who).not.toBe("system"); // the Ability's owner speaks; the effect does not

    const order = types(events).filter(
      (t) => t === "ABILITY_TRIGGERED" || t === "PRIZE_REDUCED" || t === "KNOCKED_OUT",
    );
    expect(order).toEqual(["KNOCKED_OUT", "ABILITY_TRIGGERED", "PRIZE_REDUCED"]);
  });

  it("does not borrow PRIZE_PREVENTED's wording — a decrement is not a denial", () => {
    const state = field(16, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, bite);

    const text = render(events, done)
      .map((r) => r.text)
      .join(" | ");
    expect(text).not.toContain("no Prize card is taken");
    expect(types(events)).not.toContain("PRIZE_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The five structural questions.
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural questions — answered, not asserted", () => {
  it("PARK or PERSIST? NEITHER — no key joins `InPlayPokemon`", () => {
    const state = field(17, { holderDamage: 190, bench: [{ id: "sv06.5-039" }] });
    const body = state.players.p2.active;
    expect(body).not.toBeNull();
    expect(Object.keys(body ?? {}).sort()).toEqual(
      [
        "attackBlock",
        "attackDamageDebuff",
        "attackDamageTaken",
        "attackFlipLockTurn",
        "attackLockedTurn",
        "attackTwoFlipLockTurn",
        "benchedTurn",
        "boostedAttack",
        "conditions",
        "costTaxTurn",
        "damage",
        "damageReduction",
        "damageVulnerability",
        "energy",
        "evolvedTurn",
        "handAttachMark",
        "healedTurn",
        "installedRecoil",
        "koBounty",
        "lockedAttacks",
        "markers",
        "noWeaknessTurn",
        "promotedTurn",
        "retreatBlocked",
        "retreatLockedTurn",
        "scheduledEffect",
        "stack",
        "tools",
        "turnPlayed",
        "usedAttack",
        "weaknessRetype",
      ].sort(),
    );
  });

  it("GATES AN ACTION? NO — the payability projection takes a zero diff", () => {
    let state = field(18, { bench: [{ id: "sv06.5-039" }] });
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    const view = redactGame(state, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks.map((a) => a.name)).toEqual(["Dirty Headbutt"]);
    expect(redactGame(state, "p1").phase).toMatchObject({ attacks: [] });
  });

  it("the clamp is DRIVEN, and reaching it took TWO constructed values", () => {
    expect(programFor("fix-koprize")?.triggered?.[0]?.onKoPrizeReduction?.by).toBe(2);
    const state = field(19, {
      holder: "fix-koprize",
      holderDamage: 20,
      bench: [{ id: "sv06.5-039" }],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(types(events)).toContain("KNOCKED_OUT");
    expect(findEvent(events, "PRIZE_REDUCED")).toMatchObject({ by: 1, count: 0 });
    expect(done.pending.filter((s) => s.kind === "takePrizes")).toEqual([]);
    expect(done.players.p1.prizes).toHaveLength(6);
  });

  it("the printed holder never reaches that clamp — its Prize is 2", () => {
    const reduction = programFor("sv06.5-037")?.triggered?.[0]?.onKoPrizeReduction;
    expect(reduction).toEqual({ by: 1, requiresInPlay: "Pecharunt ex" });
    expect(MUNKIDORI_PRIZES - (reduction?.by ?? 0)).toBe(REDUCED_PRIZES);
  });
});
