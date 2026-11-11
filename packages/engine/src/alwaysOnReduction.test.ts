import { describe, expect, it } from "vitest";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import { passivesOf, seatDamageReduction } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  ALWAYS_ON_REDUCTION_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  findEvent,
  findEvents,
} from "./testFixtures";

/** The two printed sentences, byte-for-byte off the local D1 rows. */
const ROCK_CHESTPLATE =
  "The {F} Pokémon this card is attached to takes 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).";
const ARM_THRUST_PRACTICE =
  "All of your Pokémon take 10 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).";

const SEED = 7;

const ATTACKERS = {
  "fix-attacker": {
    card: "fix-attacker",
    index: 1,
    energy: [
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  }, // FIRE "Flame" (60)
  "fix-attacker-bite": { card: "fix-attacker", index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // the same body's idx-0 "Bite" (30)
  "fix-sniper": { card: "fix-sniper", index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Spread Shot" (30 + 20 each benched)
  "sv01-069": { card: "sv01-069", index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // Rotom — "Linear Attack" (opponentAny 20, deals)
  "fix-feint": { card: "fix-feint", index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Feint Attack" (opponentAny 50, ignoreWR)
  "sv02-127": { card: "sv02-127", index: 0, energy: [{ id: "fix-fighting-energy", count: 3 }] }, // Ting-Lu ex — "Land Scoop" (150) + Cursed Land
  "sv01-139": {
    card: "sv01-139",
    index: 1,
    energy: [
      { id: "fix-metal-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
  }, // Forretress — "Rolling Shell" (90, installs 50)
} as const;

type Attacker = keyof typeof ATTACKERS;

function board(attacker: Attacker, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: ALWAYS_ON_REDUCTION_DECK, p2: ALWAYS_ON_REDUCTION_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKERS[attacker].card);
  state = clearBench(state, by);
  for (const { id, count } of ATTACKERS[attacker].energy) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

function swing(state: GameState, attacker: Attacker, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
}

/** The seat's benched body carrying `cardId` (found by card id, not by slot — a
    board built by successive surgeries does not put it at index 0). */
function benchedIndex(state: GameState, seat: Seat, cardId: string): number {
  const at = state.players[seat].bench.findIndex(
    (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === cardId,
  );
  if (at < 0) throw new Error(`${seat} has no benched ${cardId}`);
  return at;
}

function rowFor(events: GameEvent[], uid: string | undefined) {
  return findEvents(events, "DAMAGE_DEALT").find((e) => e.uid === uid);
}

/** Answer a parked `opponentAny` snipe by naming one of P2's spots — the one move
    that lets a single printed declaration hit a source and a non-source. */
function aimAt(parked: GameState, spot: { spot: "active" } | { spot: "bench"; index: number }) {
  if (parked.phase.kind !== "effect:choose") throw new Error("the snipe did not park");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const pick = prompt.candidates.find(
    (ref) =>
      ref.seat === "p2" &&
      ref.spot.spot === spot.spot &&
      (spot.spot === "active" || (ref.spot.spot === "bench" && ref.spot.index === spot.index)),
  );
  if (pick === undefined) throw new Error("no such candidate");
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [pick] },
  });
}

function withInstalledReduction(state: GameState, seat: Seat, amount: number): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, damageReduction: { turn: state.turn, amount } } },
    },
  };
}

/** The rendered log, flattened to `{ who, text }` — the shape the neighbouring
    suites read a sequence in. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The data: the catalog rows, the fixtures, and the registry rows.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed data — re-queried, not inherited", () => {
  it("carries every NAME, printed Ability and printed attack verbatim", () => {
    expect(FIXTURE_POOL["sv02-113"]).toMatchObject({
      name: "Hariyama",
      category: "Pokemon",
      stage: "Stage1",
      evolveFrom: "Makuhita",
      hp: 140,
      types: ["Fighting"],
      retreat: 3,
      weaknesses: [{ type: "Psychic", value: "×2" }],
    });
    expect(FIXTURE_POOL["sv02-113"]?.abilities).toEqual([
      { type: "Ability", name: "Arm Thrust Practice", effect: ARM_THRUST_PRACTICE },
    ]);
    expect(FIXTURE_POOL["sv02-113"]?.attacks).toEqual([
      { cost: ["Fighting", "Colorless", "Colorless"], name: "Rocket Slap", damage: 120 },
    ]);
    expect(FIXTURE_POOL["sv01-192"]).toMatchObject({
      category: "Trainer",
      trainerType: "Tool",
      effect: ROCK_CHESTPLATE,
    });
  });

  it("AUTHORS both printings on TWO programs, and neither is an attack", () => {
    expect(programFor("sv01-192")?.passive).toEqual({
      damageReductionAfterWRIfType: { amount: 30, type: "Fighting" },
    });
    expect(programFor("sv02-113")?.passive).toEqual({
      seatDamageReductionAfterWR: { amount: 10 },
    });
    // Nothing here reaches the deriver: one sentence is a Tool's, the other an
    // Ability's, and neither card has an authored attack program.
    for (const id of ["sv01-192", "sv02-113"] as const) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
  });

  it("…and BOTH sentences STAY LOUD as attack text", () => {
    for (const text of [ROCK_CHESTPLATE, ARM_THRUST_PRACTICE]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "reduceDamage", amount: 30 }]);
  });

  it("is the WHOLE mapped set — the census, SWEPT out of the pool rather than listed", () => {
    const typed = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.damageReductionAfterWRIfType !== undefined,
    );
    expect(typed).toEqual(["sv01-192"]);
    const seatWide = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.seatDamageReductionAfterWR !== undefined,
    );
    expect(seatWide).toEqual(["sv02-113"]);
    const ungated = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.damageReductionAfterWR !== undefined,
    );
    expect(ungated.filter((id) => !id.startsWith("fix-")).sort()).toEqual([
      "sv01-121",
      "sv02-150",
      "sv03-174",
    ]);
    expect(ungated.filter((id) => id.startsWith("fix-")).sort()).toEqual([
      "fix-carapace-tough",
      "fix-resistwall",
      "fix-suppresswall",
    ]);
  });
});

describe("Rock Chestplate — the HOLDER's type gate, folded inside passivesOf", () => {
  it("pays into `damageReductionAfterWR` ITSELF, which is why no read site moved", () => {
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(passivesOf(state, active).damageReductionAfterWR).toBe(30);
  });

  it("READS THE HOLDER's types and not the ATTACKER's — the ends are NOT swapped", () => {
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const { events } = swing(state, "fix-attacker");
    // Flame 60, no Weakness (Hariyama is ×2 Psychic), 30 from the Tool + 10 from
    // Hariyama's own seat-wide aura.
    expect(findEvent(events, "DAMAGE_DEALT")?.reduction).toBe(40);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("MISSES a holder of another type — on a PRINTED card, not a synthetic one", () => {
    // Forretress is METAL. The identical Tool on the identical site pays nothing,
    // and the only surviving reduction is the benched Hariyama's seat-wide 10.
    let state = board("fix-attacker", "sv01-139");
    state = benchFromDeck(state, "p2", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(passivesOf(state, active).damageReductionAfterWR).toBe(0);
    const { events } = swing(state, "fix-attacker");
    // 60 × 2 (Forretress is ×2 Fire) − 10 = 110.
    expect(findEvent(events, "DAMAGE_DEALT")?.reduction).toBe(10);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(110);
  });

  it("SUMS over sources rather than taking the last — two Tools on one holder", () => {
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(passivesOf(state, active).damageReductionAfterWR).toBe(60);
  });

  it("is LIVE-READ off the TOP card — the gate is not resolved once at attach", () => {
    let state = board("fix-attacker", "sv02-113");
    state = benchFromDeck(state, "p2", "sv01-139");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    state = attachToolFromDeck(state, "p2", benchedIndex(state, "p2", "sv01-139"), "sv01-192");
    const active = state.players.p2.active;
    const benched = state.players.p2.bench[benchedIndex(state, "p2", "sv01-139")];
    if (active === null || benched === undefined) throw new Error("board not built");
    expect(passivesOf(state, active).damageReductionAfterWR).toBe(30);
    expect(passivesOf(state, benched).damageReductionAfterWR).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mechanism 2 — Hariyama: the seat-wide scan.
// ─────────────────────────────────────────────────────────────────────────────

describe("seatDamageReduction — the aura-scan family's NINTH member", () => {
  it("has NO source clause and NO target clause — the printed sentence scopes neither", () => {
    let state = board("fix-attacker", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(seatDamageReduction(state, active, "all", "p1")).toBe(10);

    let other = board("fix-attacker", "sv02-113");
    other = benchFromDeck(other, "p2", "fix-bigbody");
    const benched = other.players.p2.bench[benchedIndex(other, "p2", "fix-bigbody")];
    if (benched === undefined) throw new Error("no benched body");
    expect(seatDamageReduction(other, benched, "all", "p1")).toBe(10);
  });

  it("is SELF-INCLUSIVE — the source shields itself", () => {
    const state = board("fix-attacker", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(seatDamageReduction(state, active, "all", "p1")).toBe(10);
  });

  it("SUMS over sources — `opposingRetreatSurcharge`'s answer, not `opposingAttackDebuff`'s", () => {
    let state = board("fix-attacker", "sv02-113");
    state = benchFromDeck(state, "p2", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(seatDamageReduction(state, active, "all", "p1")).toBe(20);
    const { events } = swing(state, "fix-attacker");
    expect(findEvent(events, "DAMAGE_DEALT")?.reduction).toBe(20);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(40);
  });

  it("is OWN-SIDE ONLY — no aura reaches across the table", () => {
    // The seat is DERIVED from the body's own uid, so a Hariyama on the ATTACKING
    // side does nothing for the defender. Dropping the `continue` that skips the
    // wrong side would make this board read 10.
    let state = board("fix-attacker", "fix-bigbody");
    state = benchFromDeck(state, "p1", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(seatDamageReduction(state, active, "all", "p1")).toBe(0);
    expect(findEvent(swing(state, "fix-attacker").events, "DAMAGE_DEALT")?.dealt).toBe(60);
  });

  it("…and the OWN-SIDE early return is UNREACHABLE-as-a-difference, asserted not assumed", () => {
    let state = board("fix-attacker", "sv02-113");
    state = benchFromDeck(state, "p1", "sv02-113");
    state = benchFromDeck(state, "p1", "sv02-113");
    const uids = new Set<string>();
    for (const seat of ["p1", "p2"] as const) {
      const side = state.players[seat];
      for (const p of side.active === null ? side.bench : [side.active, ...side.bench]) {
        const uid = p.stack.at(-1);
        if (uid === undefined) throw new Error("empty stack");
        expect(uids.has(uid)).toBe(false); // no uid is on two sides — the whole argument
        uids.add(uid);
      }
    }
    const defender = state.players.p2.active;
    const attacker = state.players.p1.active;
    if (defender === null || attacker === null) throw new Error("board not built");
    // p2 has ONE source (itself); p1 has TWO. Neither total leaks across.
    expect(seatDamageReduction(state, defender, "all", "p1")).toBe(10);
    expect(seatDamageReduction(state, attacker, "all", "p2")).toBe(20);
  });

  it("is LIVE-READ — nothing is stamped, so losing the source ends it immediately", () => {
    let state = board("fix-attacker", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(seatDamageReduction(state, active, "all", "p1")).toBe(10);
    const stripped = clearBench(state, "p2");
    const strippedActive = stripped.players.p2.active;
    if (strippedActive === null) throw new Error("no Active");
    expect(seatDamageReduction(stripped, strippedActive, "all", "p1")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The four §8.5 read sites — one printed attacker each.
// ─────────────────────────────────────────────────────────────────────────────

describe("the four damage sites — each driven by its own printed attack", () => {
  it("attack.ts's MAIN HIT", () => {
    const state = board("fix-attacker", "sv02-113");
    const { events } = swing(state, "fix-attacker");
    expect(findEvent(events, "DAMAGE_DEALT")?.reduction).toBe(10);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(50);
  });

  it("spreadDamage — the BENCH, reachable off a printed card for the FIRST time", () => {
    let state = board("fix-sniper", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    state = benchFromDeck(state, "p2", "fix-titan");
    const { events } = swing(state, "fix-sniper");
    const rows = findEvents(events, "DAMAGE_DEALT");
    // 30 to the Active − 10; 20 to each benched − 10, INCLUDING the source itself.
    expect(rows.map((r) => r.dealt)).toEqual([20, 10, 10]);
    for (const r of rows) expect(r.reduction).toBe(10);
  });

  it("snipeActive AND placeSnipe — one `opponentAny` declaration, aimed two ways", () => {
    // A lone opposing Pokémon makes `opponentAny` a forced pick rather than a park,
    // which is the cheapest way to reach `snipeActive` with no prompt in the way.
    const alone = board("sv01-069", "sv02-113");
    const { events } = swing(alone, "sv01-069");
    expect(findEvent(events, "DAMAGE_DEALT")?.reduction).toBe(10);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    // …and the same declaration aimed at the BENCH is `placeSnipe`'s damage arm.
    let state = board("sv01-069", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    const at = benchedIndex(state, "p2", "sv02-113");
    const uid = benchTopUid(state, "p2", at);
    const done = aimAt(swing(state, "sv01-069").state, { spot: "bench", index: at });
    expect(rowFor(done.events, uid)?.reduction).toBe(10);
    expect(rowFor(done.events, uid)?.dealt).toBe(10);
  });

  it("ALL THREE SOURCES sum into ONE number — the claim no printed board can make", () => {
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    state = withInstalledReduction(state, "p2", 50);
    const { events } = swing(state, "fix-attacker");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.reduction).toBe(90);
    expect(row?.dealt).toBe(0);
    expect(row?.prevented).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The §8.5 ORDERING — the printed parenthetical, driven both ways.
// ─────────────────────────────────────────────────────────────────────────────

function pipeline(
  row: {
    base: number;
    weakness: DamageModifier | null;
    resistance: DamageModifier | null;
    reduction?: number;
  },
  order: "printed" | "reversed",
): number {
  const reduction = row.reduction ?? 0;
  if (order === "printed") {
    const afterWR = applyDamageModifier(
      applyDamageModifier(row.base, row.weakness),
      row.resistance,
    );
    return Math.max(0, Math.max(0, afterWR) - reduction);
  }
  const reduced = Math.max(0, row.base - reduction);
  return Math.max(
    0,
    applyDamageModifier(applyDamageModifier(reduced, row.weakness), row.resistance),
  );
}

describe("the printed parenthetical — `after applying Weakness and Resistance`", () => {
  it("the two new sources sit at D147's STEP, and a Weakness makes it observable", () => {
    let state = board("fix-attacker", "sv01-139");
    state = benchFromDeck(state, "p2", "sv02-113");
    const row = findEvent(swing(state, "fix-attacker").events, "DAMAGE_DEALT");
    if (row === undefined) throw new Error("no damage row");
    expect(row.dealt).toBe(110);
    expect(pipeline(row, "printed")).toBe(row.dealt);
    expect(pipeline(row, "reversed")).toBe(100);
    expect(pipeline(row, "reversed")).not.toBe(row.dealt);
  });

  it("…and the Tool's 30 answers the same way, on the same body", () => {
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const row = findEvent(swing(state, "fix-attacker").events, "DAMAGE_DEALT");
    if (row === undefined) throw new Error("no damage row");
    expect(row.weakness).toBeNull();
    expect(row.dealt).toBe(20);
    expect(
      pipeline({ ...row, weakness: null, resistance: { op: "subtract", amount: 30 } }, "printed"),
    ).toBe(
      pipeline({ ...row, weakness: null, resistance: { op: "subtract", amount: 30 } }, "reversed"),
    );
  });
});

describe("`ignoreWR` — decided PER BOARD, because the source set contains the target set", () => {
  it("NULLS the target's OWN 10 and leaves a TEAMMATE's, off ONE declaration", () => {
    // One board, one printed attack, two picks. `fix-feint` is `opponentAny`, so a
    // benched Hariyama and a benched non-source are both legal targets of the same
    // declaration — which is what makes this an asymmetry rather than two boards.
    let state = board("fix-feint", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    state = benchFromDeck(state, "p2", "fix-titan");
    const hariyama = benchedIndex(state, "p2", "sv02-113");
    const titan = benchedIndex(state, "p2", "fix-titan");
    const hariyamaUid = benchTopUid(state, "p2", hariyama);
    const titanUid = benchTopUid(state, "p2", titan);

    const parked = swing(state, "fix-feint").state;
    const atSelf = aimAt(parked, { spot: "bench", index: hariyama });
    // The aura's only source IS the pick, so "any effects on that Pokémon" reaches
    // all of it: no reduction at all.
    expect(rowFor(atSelf.events, hariyamaUid)?.reduction).toBeUndefined();
    expect(rowFor(atSelf.events, hariyamaUid)?.dealt).toBe(50);

    const atTeammate = aimAt(parked, { spot: "bench", index: titan });
    expect(rowFor(atTeammate.events, titanUid)?.reduction).toBe(10);
    expect(rowFor(atTeammate.events, titanUid)?.dealt).toBe(40);
  });

  it("…and a NO-`ignoreWR` control on the same body proves the aura was live", () => {
    let state = board("sv01-069", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    const hariyama = benchedIndex(state, "p2", "sv02-113");
    const uid = benchTopUid(state, "p2", hariyama);
    const done = aimAt(swing(state, "sv01-069").state, { spot: "bench", index: hariyama });
    expect(rowFor(done.events, uid)?.reduction).toBe(10);
    expect(rowFor(done.events, uid)?.dealt).toBe(10);
  });

  it("at snipeActive too — a sniped Hariyama keeps a BENCHED Hariyama's 10", () => {
    // The same reading at the other arm, and the case that shows the answer is
    // "the target's own contribution" rather than "the whole aura": the Active
    // Hariyama loses its own 10 and the benched one's still lands.
    let state = board("fix-feint", "sv02-113");
    state = benchFromDeck(state, "p2", "sv02-113");
    const done = aimAt(swing(state, "fix-feint").state, { spot: "active" });
    const row = rowFor(done.events, activeUid(state, "p2"));
    expect(row?.reduction).toBe(10);
    expect(row?.dealt).toBe(40);
  });

  it("NULLS Rock Chestplate outright — a Tool IS an effect on that Pokémon", () => {
    // The holder-side half needs no new answer: it rides `passivesOf`, which
    // `ignoreWR` has nulled since 0.x. The contrast with the line above is the whole
    // of the two mechanisms' fourth axis.
    let state = board("fix-feint", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    state = benchFromDeck(state, "p2", "fix-titan"); // a second candidate, so the pick PARKS
    const done = aimAt(swing(state, "fix-feint").state, { spot: "active" });
    expect(rowFor(done.events, activeUid(state, "p2"))?.reduction).toBeUndefined();
    expect(rowFor(done.events, activeUid(state, "p2"))?.dealt).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the Ability-lock reaches ONE of the two mechanisms, on ONE board.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the lock silences the ABILITY and cannot reach the TOOL", () => {
  it("ONE board, ONE field flipped: a damaged Hariyama keeps its Tool and loses its aura", () => {
    let base = board("sv02-127", "sv02-113");
    base = attachToolFromDeck(base, "p2", "active", "sv01-192");

    const unlocked = swing(base, "sv02-127");
    // Tool 30 + own aura 10 = 40 → 110 dealt.
    expect(findEvent(unlocked.events, "DAMAGE_DEALT")?.reduction).toBe(40);
    expect(findEvent(unlocked.events, "DAMAGE_DEALT")?.dealt).toBe(110);

    const locked = swing(setDamage(base, "p2", 10), "sv02-127");
    // The Ability is silenced; the Tool is not an Ability and keeps paying.
    expect(findEvent(locked.events, "DAMAGE_DEALT")?.reduction).toBe(30);
    expect(findEvent(locked.events, "DAMAGE_DEALT")?.dealt).toBe(120);
  });

  it("locks a BENCHED source too — the aura's reachability follows the SOURCE", () => {
    let state = board("sv02-127", "fix-titan");
    state = benchFromDeck(state, "p2", "sv02-113");
    const at = benchedIndex(state, "p2", "sv02-113");
    expect(findEvent(swing(state, "sv02-127").events, "DAMAGE_DEALT")?.dealt).toBe(140);
    const damaged = setBenchDamage(state, "p2", at, 10);
    expect(findEvent(swing(damaged, "sv02-127").events, "DAMAGE_DEALT")?.dealt).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE, and the §11 / action-gate answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("the log row — rendered under BOTH seats and READ", () => {
  it("NO ROW MOVED: the number lands in the existing `DAMAGE_DEALT.reduction`", () => {
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const { state: after, events } = swing(state, "fix-attacker");
    expect(events.some((e) => e.type === "DAMAGE_REDUCTION_APPLIED")).toBe(false);
    const rows = rendered(after, events);
    const hit = rows.find((r) => r.text.includes("· reduced 40"));
    expect(hit?.who).toBe("p1");
    expect(hit?.text).toBe("dealt 20 damage to Hariyama · reduced 40");
    expect(rows.filter((r) => r.text.includes("reduced"))).toHaveLength(1);
  });

  it("…and reads identically when the OTHER seat is shielded", () => {
    let state = board("fix-attacker", "sv02-113", "p2");
    state = attachToolFromDeck(state, "p1", "active", "sv01-192");
    const { state: after, events } = swing(state, "fix-attacker", "p2");
    const hit = rendered(after, events).find((r) => r.text.includes("· reduced 40"));
    expect(hit?.who).toBe("p2");
    expect(hit?.text).toBe("dealt 20 damage to Hariyama · reduced 40");
  });
});

describe("the structural answers", () => {
  it("PERSIST: NOTHING was written to `InPlayPokemon`, so MATCH_RECORD_VERSION stays 10", () => {
    const state = board("fix-attacker", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(Object.keys(active).sort()).toEqual(
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

  it("GATES NO ACTION — the payability projection takes a zero diff", () => {
    let shielded = board("fix-attacker", "fix-bigbody");
    shielded = setActiveFromDeck(shielded, "p1", "sv02-113");
    shielded = clearBench(shielded, "p1");
    shielded = attachToolFromDeck(shielded, "p1", "active", "sv01-192");
    shielded = attachFromDeck(shielded, "p1", "fix-fighting-energy", 1);
    shielded = attachFromDeck(shielded, "p1", "fix-energy", 2);
    // The HUD projection offers Rocket Slap with the aura and the Tool both live on
    // the declaring body — swept rather than sampled, and the gate agrees.
    const view = redactGame(shielded, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(1);
    expect(view.attacks[0]).toMatchObject({ index: 0, name: "Rocket Slap", playable: true });
    expect(applyAction(shielded, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });
});
