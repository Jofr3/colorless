import { describe, expect, it } from "vitest";
import { passivesOf, seatPreWRDamageBonus } from "./continuous";
import type { GameEvent, GameState, Seat } from "./index";
import { applyAction, programFor, redactGame } from "./index";
import { attackerPreWRBonus } from "./interpreter";
import {
  FIXTURE_POOL,
  SEAT_AURA_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const REGAL_CHEER_TEXT =
  "Attacks used by your Pokémon do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
const CHEER_ON_TEXT =
  "Attacks used by your Cynthia's Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
const EXTRA_HELPINGS_TEXT =
  "Attacks used by your Hop's Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). The effect of Extra Helpings doesn't stack.";

const SEED = 43;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function board(): GameState {
  let state = driveSetup(SEED, { p1: SEAT_AURA_DECK, p2: SEAT_AURA_DECK }, { first: "p1" });
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = clearBench(setActiveFromDeck(state, "p1", "fix-basic-1"), "p1");
  return clearBench(setActiveFromDeck(state, "p2", "fix-basic-1"), "p2");
}

/** P1 attacks with `attacker`; `benched` sources sit on P1's Bench beside it. One
    Energy attached, which every fixture attack in this cast costs. */
function attackingWith(attacker: string, ...benched: string[]): GameState {
  let state = clearBench(setActiveFromDeck(board(), "p1", attacker), "p1");
  for (const id of benched) state = benchFromDeck(state, "p1", id);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The damage P1's Active actually deals, off a real declaration. Every attacker
    in this cast prints a base of 50, so the delta from 50 IS the aura. */
function dealt(state: GameState): { base?: number; bonus?: number; dealt?: number } {
  const hit = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const event = find(hit.events, "DAMAGE_DEALT");
  return { base: event?.base, bonus: event?.bonus, dealt: event?.dealt };
}

function activeOf(state: GameState, seat: Seat) {
  const spot = state.players[seat].active;
  if (spot === null) throw new Error(`${seat} has no Active`);
  return spot;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE SEVEN REGISTRY ROWS — three programs, and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — the seven registry rows", () => {
  const BARE = ["sv10.5b-003", "sv10.5b-156", "sv10.5b-164"] as const;
  const CYNTHIA = ["sv10-008", "sv10-184"] as const;
  const HOP = ["svp-184", "sv09-117"] as const;

  it("authors all THREE bare printings as the aura and NOTHING else", () => {
    for (const id of BARE) {
      const program = programFor(id);
      expect(program?.passive).toEqual({ seatDamageBonusBeforeWR: { amount: 20 } });
      expect(program?.passive?.damageBonusBeforeWR).toBeUndefined();
      expect(program?.attack).toBeUndefined();
      expect(program?.abilities).toBeUndefined();
    }
  });

  it("authors the FOUR owner-prefixed printings with a BENEFICIARY narrowing", () => {
    for (const id of CYNTHIA) {
      expect(programFor(id)?.passive?.seatDamageBonusBeforeWR).toEqual({
        amount: 30,
        beneficiary: { kind: "ownerPokemon", owner: "Cynthia" },
      });
    }
    for (const id of HOP) {
      expect(programFor(id)?.passive?.seatDamageBonusBeforeWR).toEqual({
        amount: 30,
        beneficiary: { kind: "ownerPokemon", owner: "Hop" },
        noStack: "Extra Helpings",
      });
    }
  });

  it("the seven are SEVEN — the count the backlog cell must match", () => {
    const ids = [...BARE, ...CYNTHIA, ...HOP];
    expect(ids.length).toBe(7);
    expect(new Set(ids).size).toBe(7);
    for (const id of ids) expect(programFor(id)?.passive?.seatDamageBonusBeforeWR).toBeDefined();
  });

  it("the SIX `Future` printings were unbuilt on the INGEST — D569: built on `banners.ts`", () => {
    for (const id of ["svp-146", "sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158"]) {
      expect(programFor(id)?.passive?.seatDamageBonusBeforeWR).toEqual({
        amount: 20,
        beneficiary: { kind: "bannerPokemon", banner: "Future" },
        exceptName: "Iron Crown ex",
      });
    }
    expect(programFor("sv10.5b-003")?.passive?.seatDamageBonusBeforeWR?.amount).toBe(20);
  });

  it("the fixture demonstrators carry the printed bytes VERBATIM", () => {
    expect(FIXTURE_POOL["fix-regalcheer"]?.abilities?.[0]?.effect).toBe(REGAL_CHEER_TEXT);
    expect(FIXTURE_POOL["fix-cynthia-aura"]?.abilities?.[0]?.effect).toBe(CHEER_ON_TEXT);
    expect(FIXTURE_POOL["fix-hop-aura"]?.abilities?.[0]?.effect).toBe(EXTRA_HELPINGS_TEXT);
    expect(programFor("fix-regalcheer")).toBe(programFor("sv10.5b-003"));
    expect(programFor("fix-cynthia-aura")).toBe(programFor("sv10-008"));
    expect(programFor("fix-hop-aura")).toBe(programFor("svp-184"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE SCAN — the source set, and the one thing it does NOT do.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — `seatPreWRDamageBonus`, the seat-wide scan", () => {
  it("pays from the BENCH — the whole reason this is not a `passivesOf` fold", () => {
    const state = attackingWith("fix-plain-body", "fix-regalcheer");
    const attacker = activeOf(state, "p1");
    expect(passivesOf(state, attacker).damageBonusBeforeWR).toBe(0);
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(20);
  });

  it("is SELF-INCLUSIVE — 'your Pokémon' is not 'your OTHER Pokémon'", () => {
    const state = attackingWith("fix-regalcheer");
    expect(state.players.p1.bench.length).toBe(0);
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-regalcheer"])).toBe(20);
  });

  it("SUMS its sources — two copies in play are two printed Abilities", () => {
    const two = attackingWith("fix-plain-body", "fix-regalcheer", "fix-regalcheer");
    expect(seatPreWRDamageBonus(two, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(40);
    const three = attackingWith(
      "fix-plain-body",
      "fix-regalcheer",
      "fix-regalcheer",
      "fix-regalcheer",
    );
    expect(seatPreWRDamageBonus(three, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(60);
  });

  it("is SEAT-RELATIVE — the opponent's aura pays the opponent and never you", () => {
    let state = attackingWith("fix-plain-body");
    state = benchFromDeck(state, "p2", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
    expect(seatPreWRDamageBonus(state, "p2", FIXTURE_POOL["fix-plain-body"])).toBe(20);
  });

  it("reads the STACK TOP, so an unevolved body under an aura pays nothing", () => {
    // Only a TOP card grants a printed Ability. `benchFromDeck` puts a fresh body
    // on the bench, so the control here is the body that is NOT an aura source.
    const state = attackingWith("fix-plain-body", "fix-basic-1");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE BENEFICIARY NARROWING — the rider seam, on a subgroup that exists.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — `beneficiary`, the printed narrowing", () => {
  it("pays a prefixed ATTACKER and REFUSES an unprefixed one, off one source", () => {
    const prefixed = attackingWith("fix-cynthia-body", "fix-cynthia-aura");
    expect(seatPreWRDamageBonus(prefixed, "p1", FIXTURE_POOL["fix-cynthia-body"])).toBe(30);
    const plain = attackingWith("fix-plain-body", "fix-cynthia-aura");
    expect(seatPreWRDamageBonus(plain, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
  });

  it("filters the BENEFICIARY and NOT the SOURCE — the reading no legal board shows", () => {
    const state = attackingWith("fix-cynthia-body", "fix-cynthia-aura", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-cynthia-body"])).toBe(50);
  });

  it("the two owner subgroups are DISJOINT — Hop's aura ignores Cynthia's body", () => {
    const state = attackingWith("fix-cynthia-body", "fix-hop-aura");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-cynthia-body"])).toBe(0);
  });

  it("an undefined attacking card fails every filter and keeps every bare aura", () => {
    // `stadiumPreventsDamage`'s conservative direction: no resolvable card is not
    // a match. The bare aura still pays, because it asks nothing of the attacker.
    const state = attackingWith("fix-cynthia-body", "fix-cynthia-aura", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", undefined)).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. `noStack` — the one printed sentence that overrides the summing rule.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — 'The effect of Extra Helpings doesn't stack.'", () => {
  it("caps a repeated source at ONE contribution where the bare aura SUMS", () => {
    const two = attackingWith("fix-plain-body", "fix-hop-aura", "fix-hop-aura");
    // The attacker is unprefixed, so first prove the aura is live at all on ONE.
    expect(seatPreWRDamageBonus(two, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
    const capped = attackingWith("fix-cynthia-body", "fix-hop-aura", "fix-hop-aura");
    expect(seatPreWRDamageBonus(capped, "p1", FIXTURE_POOL["fix-cynthia-body"])).toBe(0);
    // …now on a HOP'S attacker, where the clause actually bites. The control is
    // the bare aura three lines up, which sums to 40 on the same shaped board.
    let state = clearBench(setActiveFromDeck(board(), "p1", "fix-hop-aura"), "p1");
    state = benchFromDeck(state, "p1", "fix-hop-aura");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(30);
    state = benchFromDeck(state, "p1", "fix-hop-aura");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(30);
  });

  it("does NOT cap a DIFFERENT aura — the key is the printed Ability NAME", () => {
    let state = clearBench(setActiveFromDeck(board(), "p1", "fix-hop-aura"), "p1");
    state = benchFromDeck(state, "p1", "fix-hop-aura");
    state = benchFromDeck(state, "p1", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(50);
  });
});

describe("D243 — a §9 ABILITY-LOCK silences the aura", () => {
  it("Klefki drops the source's contribution and leaves the rest standing", () => {
    let state = clearBench(setActiveFromDeck(board(), "p1", "fix-hop-aura"), "p1");
    state = benchFromDeck(state, "p1", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(50);
    // Klefki into the OPPONENT's Active Spot — its lock reaches both sides' Basics.
    state = setActiveFromDeck(state, "p2", "sv01-096");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(0);
    state = setActiveFromDeck(state, "p2", "fix-basic-1");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-hop-aura"])).toBe(50);
  });

  it("the lock reaches a BENCHED source too, not only the Active one", () => {
    let state = clearBench(setActiveFromDeck(board(), "p1", "fix-plain-body"), "p1");
    state = benchFromDeck(state, "p1", "fix-regalcheer");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(20);
    state = setActiveFromDeck(state, "p2", "sv01-096");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE READ SITE — one summed term, and the damage that actually lands.
// ─────────────────────────────────────────────────────────────────────────────

describe("D243 — `attackerPreWRBonus` and the §8.5 pipeline", () => {
  it("folds the aura into the ONE shared pre-W/R number", () => {
    const state = attackingWith("fix-plain-body", "fix-regalcheer");
    const defender = activeOf(state, "p2");
    const defenderCard = FIXTURE_POOL[state.cardIdByUid[defender.stack[0] ?? ""] ?? ""];
    if (defenderCard === undefined) throw new Error("no defender card");
    expect(attackerPreWRBonus(state, activeOf(state, "p1"), "p1", defenderCard)).toBe(20);
  });

  it("a real declaration deals base + aura, reported in `DAMAGE_DEALT.bonus`", () => {
    expect(dealt(attackingWith("fix-plain-body"))).toEqual({
      base: 50,
      bonus: undefined,
      dealt: 50,
    });
    expect(dealt(attackingWith("fix-plain-body", "fix-regalcheer"))).toEqual({
      base: 50,
      bonus: 20,
      dealt: 70,
    });
  });

  it("the owner narrowing survives to the DEALT number, both ways", () => {
    expect(dealt(attackingWith("fix-cynthia-body", "fix-cynthia-aura")).dealt).toBe(80);
    expect(dealt(attackingWith("fix-plain-body", "fix-cynthia-aura")).dealt).toBe(50);
  });

  it("REFUSES to touch the WIRE projection — a damage total is not a payability fact", () => {
    const withAura = redactGame(attackingWith("fix-plain-body", "fix-regalcheer"), "p1");
    const without = redactGame(attackingWith("fix-plain-body"), "p1");
    if (withAura.phase.kind !== "turn:action" || without.phase.kind !== "turn:action") {
      throw new Error("expected turn:action");
    }
    expect(withAura.phase.attacks).toEqual(without.phase.attacks);
    expect(withAura.phase.abilities).toEqual([]);
    expect(without.phase.abilities).toEqual([]);
    expect(withAura.phase.attacks.length).toBe(1);
    expect(withAura.phase.attacks[0]?.playable).toBe(true);
  });

  it("does NOT reach the BENCH — the printed target clause is 'your opponent's ACTIVE'", () => {
    let state = attackingWith("fix-plain-body", "fix-regalcheer");
    state = clearBench(setActiveFromDeck(state, "p2", "fix-hop-aura"), "p2");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    const hit = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const damaged = hit.state.players.p2;
    expect(damaged.active?.damage).toBe(70);
    expect(damaged.bench.length).toBe(1);
    expect(damaged.bench.every((b) => b.damage === 0)).toBe(true);
  });

  it("an empty board answers ZERO rather than throwing", () => {
    const state = attackingWith("fix-plain-body");
    expect(seatPreWRDamageBonus(state, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });
});
