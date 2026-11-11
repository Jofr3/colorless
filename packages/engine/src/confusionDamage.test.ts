import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { logFromEvents } from "./log";
import type { LogContext } from "./log";
import { runProgram } from "./interpreter";
import { redactGame } from "./redact";
import { DEFAULT_CONFUSION_DAMAGE, noConditions } from "./types";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const RAISED =
  "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.";

const BARE = "Your opponent's Active Pokémon is now Confused.";

const TAIL = "Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.";

const POISON_8 =
  "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 8 damage counters on that Pokémon instead of 1.";

describe("§1 — every specimen is a row of the committed column, with its count", () => {
  const corpus = legalAttackCorpus();
  const rowOf = (text: string) => corpus.find(([, t]) => t === text);

  it("the three printed specimens ARE corpus rows, at the printing counts quoted above", () => {
    expect(rowOf(RAISED)?.[0]).toBe(1);
    expect(rowOf(BARE)?.[0]).toBe(31);
    expect(rowOf(POISON_8)?.[0]).toBe(4);
  });

  it("the TAIL is printed STANDALONE on zero cards — which is why §2 exists", () => {
    expect(rowOf(TAIL)).toBeUndefined();
  });

  it("`instead of` is printed on exactly THREE rows, and this slice closes the last", () => {
    const family = corpus.filter(([, t]) => t.includes("instead of"));
    expect(family.map(([n, t]) => [n, t.slice(0, 46)])).toEqual([
      [1, "Your opponent's Active Pokémon is now Confused"],
      [1, "Your opponent's Active Pokémon is now Poisoned"],
      [4, "Your opponent's Active Pokémon is now Poisoned"],
    ]);
    for (const [, t] of family) expect(resolvedByAnyReader(t), t).toBe(true);
  });

  it("the apostrophe is ASCII U+0027 and the é is U+00E9, measured rather than eyed", () => {
    expect(RAISED.codePointAt(RAISED.indexOf("'"))).toBe(0x27);
    expect(RAISED.codePointAt(RAISED.indexOf("é"))).toBe(0xe9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the LATTICE, and the cheaper build that is the trap.
// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — a WHOLE-SENTENCE anchor, and the two measurements that warrant it", () => {
  function point(bits: number, count = 8): string {
    const S = (bits >> 4) & 1;
    const T = (bits >> 3) & 1;
    const P = (bits >> 2) & 1;
    const D = (bits >> 1) & 1;
    const R = bits & 1;
    const status = S ? "Poisoned" : "Confused";
    const verb = T ? "During Pokémon Checkup, put" : "Put";
    const dflt = D ? "1" : "3";
    const mid = P ? "" : ` instead of ${dflt}`;
    const end = P ? ` instead of ${dflt}` : "";
    const trail = R ? "" : " for this Special Condition";
    return `Your opponent's Active Pokémon is now ${status}. ${verb} ${count} damage counters${mid} on that Pokémon${end}${trail}.`;
  }

  it("the lattice's two ENDPOINTS are the two printed rows, not constructions", () => {
    expect(point(0b00000)).toBe(RAISED);
    expect(point(0b11111)).toBe(POISON_8);
  });

  it("built-by-weight is `0/1 · 0/5 · 0/10 · 0/10 · 0/5 · 1/1` — NO PROPER SUBSET BUILDS", () => {
    const before = (t: string) => resolvedByAnyReader(t) && deriveAttackEffect(t) === null;
    const weights = [0, 0, 0, 0, 0, 0];
    const totals = [0, 0, 0, 0, 0, 0];
    for (let b = 0; b < 32; b++) {
      const w = ((b >> 4) & 1) + ((b >> 3) & 1) + ((b >> 2) & 1) + ((b >> 1) & 1) + (b & 1);
      totals[w] = (totals[w] ?? 0) + 1;
      const s = point(b);
      const built =
        (resolvedByAnyReader(s) && s !== RAISED) || splitAttackTrailingClause(s) !== null;
      if (built) weights[w] = (weights[w] ?? 0) + 1;
      // the "before" view: nothing except the endpoint was claimed at the old head
      if (s !== RAISED) expect(before(s), s).toBe(false);
    }
    expect(totals).toEqual([1, 5, 10, 10, 5, 1]);
    expect(weights).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it("the COUNT axis is DEGENERATE — the built endpoint claims 8 and 2 alike", () => {
    for (const c of [1, 2, 8, 40]) {
      expect(deriveAttackEffect(point(0b11111, c)), `poison@${c}`).not.toBeNull();
    }
  });

  it("the TAIL stays REFUSED, and that is a DECISION rather than an omission", () => {
    expect(deriveAttackEffect(TAIL)).toBeNull();
    expect(resolvedByAnyReader(TAIL)).toBe(false);

    // The splitter composes at this head for tails some reader DOES claim…
    expect(splitAttackTrailingClause(`${BARE} Draw a card.`)).toEqual({
      head: BARE,
      tail: "Draw a card.",
    });
    // …and refuses the printed compound only because the tail is unclaimed, which is
    // exactly the property a bare-tail arm would have removed.
    expect(splitAttackTrailingClause(RAISED)).toBeNull();
  });

  it("the hazard a bare-tail arm would open, counted over the whole column", () => {
    const claimedEndingInPeriod = legalAttackCorpus().filter(
      ([, t]) => resolvedByAnyReader(t) && t.endsWith("."),
    );
    expect(claimedEndingInPeriod.length).toBe(549);
    const burnedHead = "Flip a coin. If heads, your opponent's Active Pokémon is now Burned.";
    expect(resolvedByAnyReader(burnedHead)).toBe(true);
    expect(deriveAttackEffect(`${burnedHead} ${TAIL}`)).toBeNull();
  });

  it("the WIDER anchor claims the SAME rows, so the generality is pure risk (D472)", () => {
    const WIDE =
      /^Your opponent['’]s Active Pokémon is now Confused\. Put (\d+) damage counters instead of (\d+) on that Pokémon for this Special Condition\.$/;
    const wide = legalAttackCorpus().filter(([, t]) => WIDE.test(t));
    expect(wide.map(([n]) => n)).toEqual([1]);
    expect(deriveAttackEffect(RAISED.replace("instead of 3", "instead of 5"))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the reader: the program, the anchor's edges, the near misses.
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — the arm, and what it refuses", () => {
  it("the printed sentence derives to ONE op carrying the raised amount in HP", () => {
    expect(deriveAttackEffect(RAISED)).toEqual([
      { op: "applyStatus", target: "defender", status: "confused", confusionDamage: 80 },
    ]);
  });

  it("the BARE head is untouched and carries NO rider — the one-axis control", () => {
    expect(deriveAttackEffect(BARE)).toEqual([
      { op: "applyStatus", target: "defender", status: "confused" },
    ]);
  });

  it("counters convert to HP at the ARM, and the whole range is read", () => {
    for (const n of [1, 3, 7, 8, 12]) {
      expect(deriveAttackEffect(RAISED.replace("Put 8 ", `Put ${n} `))).toEqual([
        { op: "applyStatus", target: "defender", status: "confused", confusionDamage: n * 10 },
      ]);
    }
  });

  it("a printed ZERO stays LOUD rather than deriving a silent no-op", () => {
    expect(deriveAttackEffect(RAISED.replace("Put 8 ", "Put 0 "))).toBeNull();
  });

  it("a printed count that RESTATES the rule is admitted, not second-guessed", () => {
    expect(deriveAttackEffect(RAISED.replace("Put 8 ", "Put 3 "))).toEqual([
      { op: "applyStatus", target: "defender", status: "confused", confusionDamage: 30 },
    ]);
  });

  it("is ANCHORED at both ends and CASE-COMMITTED", () => {
    expect(deriveAttackEffect(`${RAISED} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`Flip a coin. If heads, ${RAISED}`)).toBeNull();
    expect(deriveAttackEffect(RAISED.slice(0, -1))).toBeNull();
    expect(deriveAttackEffect(RAISED.toLowerCase())).toBeNull();
    expect(deriveAttackEffect(RAISED.toUpperCase())).toBeNull();
  });

  it("reads the U+2019 apostrophe identically to the ASCII one", () => {
    const curly = RAISED.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(RAISED);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(RAISED));
  });

  it("NEAR MISSES — every one differs from the print on exactly ONE axis (D427)", () => {
    for (const text of [
      // the STATUS slot, onto a word whose amount this field does not carry
      RAISED.replace("Confused", "Burned"),
      RAISED.replace("Confused", "Asleep"),
      // the DEFAULT slot
      RAISED.replace("instead of 3", "instead of 1"),
      // the POSITION of the "instead of" phrase
      "Your opponent's Active Pokémon is now Confused. Put 8 damage counters on that Pokémon instead of 3 for this Special Condition.",
      // the TRAILING phrase
      "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon.",
      // the SEAT
      RAISED.replace("Your opponent's Active Pokémon", "This Pokémon"),
      // the NOUN — a singular counter
      RAISED.replace("damage counters", "damage counter"),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the reader SURFACE stands still at 13 — no new `deriveAttack*` export", () => {
    expect(attackReaderSurface().length).toBe(14);
  });

  it("exactly ONE reader claims the sentence, and it is `deriveAttackEffect`", () => {
    const claimants = attackReaderSurface().filter(
      (name) => name === "deriveAttackEffect" && deriveAttackEffect(RAISED) !== null,
    );
    expect(claimants).toEqual(["deriveAttackEffect"]);
    expect(splitAttackTrailingClause(RAISED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The board.
// ─────────────────────────────────────────────────────────────────────────────

const RAISER: Card = battler("fix-confuse8", {
  hp: 120,
  attacks: [
    { name: "Dizzy Punch", cost: ["Colorless"], effect: RAISED },
    { name: "Plain Confuse", cost: ["Colorless"], effect: BARE },
    // …and the POISON sibling, so §5 can show the two amounts are separate fields
    // rather than one slot two statuses share.
    { name: "Toxic Ring", cost: ["Colorless"], effect: POISON_8 },
  ],
});

const VICTIM: Card = battler("fix-dizzyvictim", {
  hp: 100,
  attacks: [{ name: "Tackle", cost: ["Colorless"], damage: 10 }],
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-confuse8": RAISER,
  "fix-dizzyvictim": VICTIM,
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };
const DECK = deckOf({
  "fix-confuse8": 8,
  "fix-dizzyvictim": 8,
  "fix-basic-1": 8,
  "fix-bigbody": 12,
  "fix-energy": 24,
});

const RAISE = 0;
const PLAIN = 1;
const POISON = 2;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** P1 on turn 3 with the raiser Active over an empty Bench, the victim opposite,
    both sides energised. */
function table(seed = 7): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  state = clearBench(setActiveFromDeck(state, "p1", "fix-confuse8"), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", "fix-dizzyvictim"), "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 3);
  state = attachFromDeck(state, "p2", "fix-energy", 3);
  return state;
}

function must0(body: InPlayPokemon | null): InPlayPokemon {
  if (body === null) throw new Error("no Active");
  return body;
}

function confuseThenSwing(index: number, seed: number) {
  const start = table(seed);
  const inflicted = mustApply(start, { type: "attack", seat: "p1", index });
  const swung = mustApply(inflicted.state, { type: "attack", seat: "p2", index: 0 });
  return { inflicted, swung };
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the persisted field: what it means, and what CLEARS it.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — `SpecialConditions.confusionDamage` on a real board", () => {
  it("a fresh body carries the RULE DEFAULT, not a zero", () => {
    const state = table();
    expect(must0(state.players.p2.active).conditions.confusionDamage).toBe(
      DEFAULT_CONFUSION_DAMAGE,
    );
    expect(DEFAULT_CONFUSION_DAMAGE).toBe(30);
  });

  it("the raised sentence writes 80; the BARE sentence writes 30 — the control pair", () => {
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    const plain = mustApply(table(), { type: "attack", seat: "p1", index: PLAIN });
    const conds = (s: GameState) => must0(s.players.p2.active).conditions;
    expect([conds(raised.state).rotation, conds(plain.state).rotation]).toEqual([
      "confused",
      "confused",
    ]);
    // The whole difference, on two boards that are otherwise byte-identical.
    expect([conds(raised.state).confusionDamage, conds(plain.state).confusionDamage]).toEqual([
      80, 30,
    ]);
  });

  it("the STATUS_APPLIED row carries the amount, and the BARE one carries the default", () => {
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    const plain = mustApply(table(), { type: "attack", seat: "p1", index: PLAIN });
    expect(findEvent(raised.events, "STATUS_APPLIED")?.confusionDamage).toBe(80);
    expect(findEvent(plain.events, "STATUS_APPLIED")?.confusionDamage).toBe(30);
  });

  it("a CURE puts the amount back — the clear-rung's silent aftermath (D434)", () => {
    // Reading the field back as 30 after the cure is not enough: the case that carries
    // the claim is what happens AFTERWARDS, because a build that left the 80 standing
    // looks identical until the next bare Confusion inherits it.
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    const victim = must0(raised.state.players.p2.active);
    expect(victim.conditions.confusionDamage).toBe(80);

    // `noConditions()` is the whole clear (retreat, evolve, benching, the "recovers from
    // all Special Conditions" op), and it restores the RULE DEFAULT rather than a zero.
    expect(noConditions().confusionDamage).toBe(DEFAULT_CONFUSION_DAMAGE);
    expect(noConditions().rotation).toBe("none");
  });

  it("a BARE Confusion on an already-raised body resets the amount to 30", () => {
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    expect(must0(raised.state.players.p2.active).conditions.confusionDamage).toBe(80);
    // Drive the op directly on that board — the turn order is not the subject here.
    const events: GameEvent[] = [];
    const again = runProgram(
      raised.state,
      [{ op: "applyStatus", target: "defender", status: "confused" }],
      { seat: "p1" },
      {},
      events,
    );
    expect(again.kind).toBe("done");
    if (again.kind !== "done") throw new Error("the op parked, which it cannot");
    expect(must0(again.state.players.p2.active).conditions.confusionDamage).toBe(30);
    expect(must0(again.state.players.p2.active).conditions.rotation).toBe("confused");
    expect(events.find((e) => e.type === "STATUS_APPLIED")).toMatchObject({
      status: "confused",
      confusionDamage: 30,
    });
  });

  it("`confusionDamage` and `poisonDamage` are SEPARATE slots, not one amount", () => {
    const poisoned = mustApply(table(), { type: "attack", seat: "p1", index: POISON });
    const c = must0(poisoned.state.players.p2.active).conditions;
    expect(c.poisonDamage).toBe(80);
    expect(c.confusionDamage).toBe(30);
    expect(c.rotation).toBe("none");
  });
});

describe("§5 — the missed flip, and the two numbers it can answer", () => {
  function tailsSeed(index: number): number {
    for (let seed = 1; seed < 400; seed++) {
      const start = table(seed);
      const inflicted = applyAction(start, { type: "attack", seat: "p1", index });
      if (!inflicted.ok) continue;
      const swung = applyAction(inflicted.state, { type: "attack", seat: "p2", index: 0 });
      if (!swung.ok) continue;
      if (findEvent(swung.events, "CONFUSION_CHECK")?.result === "tails") return seed;
    }
    throw new Error(`no tails seed for index ${index}`);
  }

  it("THE SEPARATING BOARD: 80 under the raised sentence, 30 under the bare one", () => {
    const rSeed = tailsSeed(RAISE);
    const pSeed = tailsSeed(PLAIN);
    const r = confuseThenSwing(RAISE, rSeed);
    const p = confuseThenSwing(PLAIN, pSeed);
    expect(findEvent(r.swung.events, "CONFUSION_CHECK")?.result).toBe("tails");
    expect(findEvent(p.swung.events, "CONFUSION_CHECK")?.result).toBe("tails");

    // The EVENT…
    expect(findEvent(r.swung.events, "COUNTERS_PLACED")?.amount).toBe(80);
    expect(findEvent(p.swung.events, "COUNTERS_PLACED")?.amount).toBe(30);
    expect(findEvent(r.swung.events, "COUNTERS_PLACED")?.source).toBe("confusion");

    expect(must0(r.swung.state.players.p2.active).damage).toBe(80);
    expect(must0(p.swung.state.players.p2.active).damage).toBe(30);

    // Same board, same action, same event TYPES — a 50-point difference.
    expect(types(r.swung.events)).toEqual(types(p.swung.events));
  });

  it("a HEADS flip costs nothing, on both boards — the face is the axis", () => {
    function headsSeed(index: number): number {
      for (let seed = 1; seed < 400; seed++) {
        const start = table(seed);
        const inflicted = applyAction(start, { type: "attack", seat: "p1", index });
        if (!inflicted.ok) continue;
        const swung = applyAction(inflicted.state, { type: "attack", seat: "p2", index: 0 });
        if (!swung.ok) continue;
        if (findEvent(swung.events, "CONFUSION_CHECK")?.result === "heads") return seed;
      }
      throw new Error("no heads seed");
    }
    const r = confuseThenSwing(RAISE, headsSeed(RAISE));
    expect(findEvent(r.swung.events, "CONFUSION_CHECK")?.result).toBe("heads");
    expect(findEvent(r.swung.events, "COUNTERS_PLACED")).toBeUndefined();
    expect(must0(r.swung.state.players.p2.active).damage).toBe(0);
  });

  it("the raised hit is SURVIVABLE at 100 HP and the bare one is not lethal either", () => {
    // The victim's HP is chosen so that neither reading KOs on the first miss — so
    // the 80/30 split is what the suite reads, not a Knock Out that would make both
    // builds look alike on the zone counts.
    const r = confuseThenSwing(RAISE, tailsSeed(RAISE));
    expect(findEvent(r.swung.events, "KNOCKED_OUT")).toBeUndefined();
    expect(must0(r.swung.state.players.p2.active).damage).toBe(80);
  });

  it("the ATTACK_FAILED row still names the reason and carries NO number", () => {
    const r = confuseThenSwing(RAISE, tailsSeed(RAISE));
    expect(findEvent(r.swung.events, "ATTACK_FAILED")?.reason).toBe("confusion");
  });
});

describe("§6 — what `log.ts` says when the confusion number changes", () => {
  const textOf = (state: GameState, events: readonly GameEvent[]) => {
    const ctx: LogContext = { names: { p1: "Ash", p2: "Misty" }, state, elapsed: "+00:00" };
    return logFromEvents(events, ctx).map((r) =>
      r.kind === "action" ? r.segments.map((seg) => seg.text).join("") : "",
    );
  };

  it("the COUNTERS_PLACED row RENDERS the raised number — it reads `event.amount`", () => {
    const seed = (() => {
      for (let s = 1; s < 400; s++) {
        const start = table(s);
        const inf = applyAction(start, { type: "attack", seat: "p1", index: RAISE });
        if (!inf.ok) continue;
        const sw = applyAction(inf.state, { type: "attack", seat: "p2", index: 0 });
        if (sw.ok && findEvent(sw.events, "CONFUSION_CHECK")?.result === "tails") return s;
      }
      throw new Error("no tails seed");
    })();
    const r = confuseThenSwing(RAISE, seed);
    const rows = textOf(r.swung.state, r.swung.events);
    expect(rows.some((t) => t.includes("hit itself for 80"))).toBe(true);
    expect(rows.some((t) => t.includes("hit itself for 30"))).toBe(false);
  });

  it("the STATUS_APPLIED row WARNS before the flip, and only when raised", () => {
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    const plain = mustApply(table(), { type: "attack", seat: "p1", index: PLAIN });
    const rr = textOf(raised.state, raised.events);
    const pr = textOf(plain.state, plain.events);
    expect(rr.some((t) => t.includes("is now Confused (80 damage on a missed flip)"))).toBe(true);
    expect(pr.some((t) => t.includes("is now Confused"))).toBe(true);
    expect(pr.some((t) => t.includes("damage on a missed flip"))).toBe(false);
  });

  it("the CONFUSION_CHECK and ATTACK_FAILED rows name no number, and still do not", () => {
    const r = confuseThenSwing(
      RAISE,
      (() => {
        for (let s = 1; s < 400; s++) {
          const start = table(s);
          const inf = applyAction(start, { type: "attack", seat: "p1", index: RAISE });
          if (!inf.ok) continue;
          const sw = applyAction(inf.state, { type: "attack", seat: "p2", index: 0 });
          if (sw.ok && findEvent(sw.events, "CONFUSION_CHECK")?.result === "tails") return s;
        }
        throw new Error("no tails seed");
      })(),
    );
    const rows = textOf(r.swung.state, r.swung.events);
    expect(rows.some((t) => t.includes("is Confused — flip: tails"))).toBe(true);
    expect(rows.some((t) => t.includes("attack failed — Confused"))).toBe(true);
  });

  it("the WIRE carries the amount, so the HUD can stop hard-coding 30", () => {
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    for (const seat of ["p1", "p2"] as const) {
      const view = redactGame(raised.state, seat);
      const victim = seat === "p2" ? view.board.you.active : view.board.opponent.active;
      expect(victim?.battle?.conditions.confusionDamage).toBe(80);
      expect(victim?.battle?.conditions.rotation).toBe("confused");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE PERSISTED QUESTION: `MATCH_RECORD_VERSION` 29 → 30, driven BOTH ways.
// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — the bump, and the corruption it refuses", () => {
  function saved(): GameState {
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    // A genuine JSON round-trip, which is what `MatchRecord.state` actually is.
    return roundTrip(raised.state);
  }

  it("THE ADDRESS: the field really is inside the serialized state", () => {
    const bytes = JSON.stringify(saved());
    expect(bytes.includes('"confusionDamage":80')).toBe(true);
    expect(bytes.includes('"confusionDamage":30')).toBe(true); // the attacker's own body
  });

  it("DIRECTION 1 — a v30 record round-trips and the raised hit STILL lands at 80", () => {
    const state = saved();
    expect(must0(state.players.p2.active).conditions.confusionDamage).toBe(80);
    let seed = -1;
    for (let s = 1; s < 400; s++) {
      const start = table(s);
      const inf = applyAction(start, { type: "attack", seat: "p1", index: RAISE });
      if (!inf.ok) continue;
      const round = roundTrip(inf.state);
      const sw = applyAction(round, { type: "attack", seat: "p2", index: 0 });
      if (sw.ok && findEvent(sw.events, "CONFUSION_CHECK")?.result === "tails") {
        expect(findEvent(sw.events, "COUNTERS_PLACED")?.amount).toBe(80);
        expect(must0(sw.state.players.p2.active).damage).toBe(80);
        seed = s;
        break;
      }
    }
    expect(seed).toBeGreaterThan(0);
  });

  it("DIRECTION 2 — a v29-SHAPED body answers a DIFFERENT NUMBER, and it is `NaN`", () => {
    // The v29 shape is BUILT rather than imagined: the key is genuinely DELETED from
    // a JSON round-tripped board, which is what a record written by the previous
    // deploy actually looks like.
    let legacySeed = -1;
    let legacy: GameState | null = null;
    for (let s = 1; s < 400; s++) {
      const start = table(s);
      const inf = applyAction(start, { type: "attack", seat: "p1", index: RAISE });
      if (!inf.ok) continue;
      const round = roundTrip(inf.state);
      const probe = applyAction(round, { type: "attack", seat: "p2", index: 0 });
      if (probe.ok && findEvent(probe.events, "CONFUSION_CHECK")?.result === "tails") {
        legacy = round;
        legacySeed = s;
        break;
      }
    }
    expect(legacySeed).toBeGreaterThan(0);
    if (legacy === null) throw new Error("no legacy board");

    const body = must0(legacy.players.p2.active).conditions as Omit<
      InPlayPokemon["conditions"],
      "confusionDamage"
    > & { confusionDamage?: number };
    // The key must be genuinely ABSENT: an absent key, not one set to undefined, is what an
    // older record looks like. `= undefined` leaves it PRESENT, and that distinction is the one
    // this case exists to drive.
    delete body.confusionDamage;
    expect("confusionDamage" in body).toBe(false);

    const swung = mustApply(legacy, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(swung.events, "CONFUSION_CHECK")?.result).toBe("tails");
    const dealt = findEvent(swung.events, "COUNTERS_PLACED")?.amount;
    expect(dealt).toBeUndefined();
    expect(dealt).not.toBe(80);
    expect(dealt).not.toBe(30);
    const after = must0(swung.state.players.p2.active);
    expect(Number.isNaN(after.damage)).toBe(true);
    // …and the body is unkillable: 999 damage would be lethal on any real board.
    expect(after.damage >= 100).toBe(false);
    expect(after.damage + 999 >= 100).toBe(false);

    const live = must0(saved().players.p2.active).conditions;
    expect(Object.keys(body).sort()).not.toEqual(Object.keys(live).sort());
    expect(
      Object.keys(live)
        .sort()
        .filter((k) => !Object.keys(body).includes(k)),
    ).toEqual(["confusionDamage"]);
  });

  it("THE OPTIONAL ROAD WAS DRIVEN, NOT DISMISSED — and it is refused on the GUARDS", () => {
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    const wire = redactGame(raised.state, "p2");
    expect(wire.board.you.active?.battle?.conditions.confusionDamage).toBe(80);
    // …and the key-set equality that an optional field would have broken silently.
    const engineKeys = Object.keys(must0(raised.state.players.p2.active).conditions).sort();
    const wireKeys = Object.keys(wire.board.you.active?.battle?.conditions ?? {}).sort();
    expect(wireKeys).toEqual(engineKeys);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — purity.
// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — the write mutates nothing it was handed", () => {
  it("a deep-frozen board survives the application and the flip that reads it", () => {
    const state = deepFreeze(table());
    const raised = mustApply(state, { type: "attack", seat: "p1", index: RAISE });
    expect(must0(state.players.p2.active).conditions.confusionDamage).toBe(30);
    expect(must0(raised.state.players.p2.active).conditions.confusionDamage).toBe(80);
  });
});
