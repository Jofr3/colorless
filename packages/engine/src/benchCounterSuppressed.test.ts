import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effectsModule from "./effects";
import {
  deriveAttackDamageMultiplier,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, logFromEvents } from "./index";
import type { GameState } from "./index";
import {
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  typedEnergy,
  must,
  findEvent,
  driveSetup,
} from "./testFixtures";

const PRINTED =
  "This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon. This attack's damage isn't affected by Weakness.";
const HEAD =
  "This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon.";
const TAIL = "This attack's damage isn't affected by Weakness.";

const RSQUO = "’";
const curly = (text: string): string => text.replaceAll("'", RSQUO);

const ATTACKER = "d493-cynthia-garchomp";
const CYN_BODY = "d493-cynthia-gible";
const PLAIN_BODY = "d493-plain";
const WALL = "d493-weak-tough";
const FIRE = "d493-fire-energy";

const LOCAL_CARDS: Record<string, Card> = {
  [ATTACKER]: battler(ATTACKER, {
    name: "Cynthia's Garchomp",
    hp: 200,
    types: ["Fire"],
    attacks: [{ cost: ["Colorless"], name: "Bench Reckoning", damage: "10×", effect: PRINTED }],
  }),
  [CYN_BODY]: battler(CYN_BODY, { name: "Cynthia's Gible", hp: 90 }),
  [PLAIN_BODY]: battler(PLAIN_BODY, { name: "D493 Plain", hp: 90 }),
  [WALL]: battler(WALL, {
    name: "D493 Wall",
    hp: 340,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Fire", value: "-30" }],
  }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
};

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

const DECK = deckOf({
  [ATTACKER]: 4,
  [CYN_BODY]: 8,
  [PLAIN_BODY]: 8,
  [WALL]: 4,
  [FIRE]: 36,
});

const SEEDS = [4930, 4931, 4933] as const;

/** p2 opens and passes, so p1 carries no §4 first-turn restriction. */
function localSetup(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function board(seed: number): GameState {
  // The shared surgery helpers in `testFixtures.ts` are ZONE MOVERS that consult no
  // pool at all — they read `state.cardIdByUid` — so a locally-created game uses them
  // unchanged. Only the SETUP drive had to be local.
  let state = setActiveFromDeck(localSetup(seed), "p1", ATTACKER);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", FIRE, 1);
  state = setDamage(state, "p1", 90);
  for (const id of [CYN_BODY, CYN_BODY, CYN_BODY, PLAIN_BODY, PLAIN_BODY]) {
    state = benchFromDeck(state, "p1", id);
  }
  for (const [index, damage] of [
    [0, 30],
    [1, 40],
    [2, 50],
    [3, 60],
    [4, 10],
  ] as const) {
    state = setBenchDamage(state, "p1", index, damage);
  }
  state = setActiveFromDeck(state, "p2", WALL);
  return clearBench(state, "p2");
}

function swing(state: GameState) {
  const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the specimen IS a corpus row, at its committed printing count", () => {
  it("the printed sentence is `legalAttackCorpus()` FILE LINE 529, 1 legal printing", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(1);
    expect(legalAttackCorpus().filter(([, s]) => s === HEAD)).toEqual([]);
    expect(legalAttackCorpus().filter(([, s]) => s === TAIL)).toEqual([]);
    expect(POOL[ATTACKER]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(POOL[ATTACKER]?.attacks?.[0]?.damage).toBe("10×");
  });
});

describe("§2 — TWO readers own it, and the other eleven still refuse", () => {
  it("the fold and the suppression, by VALUE, with the refusals kept beside them", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 10,
      count: {
        kind: "damageCountersOnYourBench",
        filter: { kind: "ownerPokemon", owner: "Cynthia" },
      },
    });
    expect(deriveAttackDamageSuppression(PRINTED)).toEqual({ weakness: true });
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    const owners = ["deriveAttackDamageMultiplier", "deriveAttackDamageSuppression"];
    for (const name of attackReaderSurface()) {
      if (owners.includes(name)) continue;
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      expect(read?.(PRINTED) ?? null, name).toBeNull();
    }
  });

  it("the COMPOUND's fold is the HEAD's fold — two anchors that cannot drift apart", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual(deriveAttackDamageMultiplier(HEAD));
  });
});

describe("§3 — the fork, measured over every corpus row rather than argued", () => {
  const readers = attackReaderSurface().map(
    (n) => (effectsModule as unknown as Record<string, (t: string) => unknown>)[n],
  );
  const claimedByAny = (s: string): boolean => readers.some((r) => (r?.(s) ?? null) !== null);

  it("(A) ALONE frees NOTHING: the bare clause is printed standalone ZERO times", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === TAIL)).toEqual([]);
    const asTail = legalAttackCorpus().filter(([, s]) => s !== TAIL && s.endsWith(` ${TAIL}`));
    expect(asTail).toHaveLength(2);
    expect(asTail.map(([, s]) => s)).toContain(PRINTED);
    const other = asTail.map(([, s]) => s).find((s) => s !== PRINTED) ?? "";
    expect(other).toBe(
      "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.",
    );
    expect(deriveAttackDamageMultiplier(other)).toBeNull();
    expect(deriveAttackDamageSuppression(other)).toEqual({ weakness: true });
    expect(
      (
        effectsModule as unknown as Record<string, (t: string) => unknown>
      ).deriveAttackDamageBonus?.(other),
    ).not.toBeNull();
    // …and the ORIGINAL discrimination is kept on a subject that still has the property:
    // this anchor's own head, with the tail removed, is claimed by nobody but the bare
    // multiply sibling — so widening THIS pattern's tail is still visible here.
    expect(claimedByAny(`${HEAD} Draw a card.`)).toBe(false);
  });

  it("(B) ALONE frees NOTHING: no residue compound has a head-claimed + suppression tail", () => {
    const BREAK = /(?<=\.)\s+(?=[A-Z(])/;
    const wouldCompose = legalAttackCorpus().filter(([, s]) => {
      if (claimedByAny(s)) return false;
      if (splitAttackTrailingClause(s) !== null) return false;
      const parts = s.split(BREAK);
      if (parts.length < 2) return false;
      const tail = parts[parts.length - 1] ?? "";
      const head = parts.slice(0, -1).join(" ");
      return claimedByAny(head) && claimedByAny(tail) && deriveAttackEffect(tail) === null;
    });
    expect(wouldCompose).toEqual([]);
  });

  it("(A)+(B) TOGETHER free exactly the ONE row this anchor frees", () => {
    const BREAK = /(?<=\.)\s+(?=[A-Z(])/;
    const pairWouldFree = legalAttackCorpus().filter(([, s]) => {
      const parts = s.split(BREAK);
      if (parts.length < 2) return false;
      const tail = parts[parts.length - 1] ?? "";
      const head = parts.slice(0, -1).join(" ");
      return tail === TAIL && claimedByAny(head);
    });
    expect(pairWouldFree.map(([, s]) => s)).toEqual([
      "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.",
      PRINTED,
    ]);
    expect(pairWouldFree.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    // …and neither is served by the composition path today, which is what makes the
    // rung above (`(B) ALONE frees NOTHING`) still true after both builds.
    for (const [, s] of pairWouldFree) expect(splitAttackTrailingClause(s), s).toBeNull();
  });

  it("the anchor's TIGHT tail buys the same rows a LOOSE one would (D472)", () => {
    const HEAD_SRC =
      "This attack does (\\d+) damage for each damage counter on all of your Benched ([^.]+ Pokémon)\\.";
    const spellings = [
      new RegExp(`^${HEAD_SRC} This attack['’]s damage isn['’]t affected by Weakness\\.$`),
      new RegExp(
        `^${HEAD_SRC} This attack['’]s damage isn['’]t affected by (?:Weakness or Resistance|Resistance|Weakness)\\.$`,
      ),
      new RegExp(`^${HEAD_SRC} (.+)$`),
    ];
    for (const re of spellings) {
      const hits = legalAttackCorpus().filter(([, s]) => re.test(s));
      expect(
        hits.map(([, s]) => s),
        re.source,
      ).toEqual([PRINTED]);
      expect(
        hits.reduce((sum, [n]) => sum + n, 0),
        re.source,
      ).toBe(1);
    }
    const bare = new RegExp(`^${HEAD_SRC}$`);
    const compound = spellings[0] as RegExp;
    expect(legalAttackCorpus().filter(([, s]) => bare.test(s) && compound.test(s))).toEqual([]);
    expect(legalAttackCorpus().filter(([, s]) => bare.test(s)).length).toBeGreaterThan(0);
  });
});

describe("§4 — the PAIRING GATE: the two readers cannot half-build a sentence", () => {
  it("an UNMAPPED printed noun leaves the WHOLE sentence loud, not half-read", () => {
    const ancient =
      "This attack does 10 damage for each damage counter on all of your Benched Future Pokémon. This attack's damage isn't affected by Weakness.";
    expect(deriveAttackDamageMultiplier(ancient)).toBeNull();
    expect(deriveAttackDamageSuppression(ancient)).toBeNull();
    expect(resolvedByAnyReader(ancient)).toBe(false);
  });

  it("a PRINTED ZERO leaves the WHOLE sentence loud — the family's other guard", () => {
    const zero = PRINTED.replace("does 10 damage", "does 0 damage");
    expect(deriveAttackDamageMultiplier(zero)).toBeNull();
    expect(deriveAttackDamageSuppression(zero)).toBeNull();
    expect(resolvedByAnyReader(zero)).toBe(false);
  });

  it("…and the vocabulary is UNCHANGED: the bare clause is still refused by all 13", () => {
    expect(deriveAttackDamageSuppression(TAIL)).toBeNull();
    expect(resolvedByAnyReader(TAIL)).toBe(false);
    expect(
      deriveAttackDamageSuppression(
        "This attack's damage isn't affected by Weakness or Resistance.",
      ),
    ).toEqual({ weakness: true, resistance: true });
  });

  it("the `^` END: a sentence with LEADING text stays on the LOUD path", () => {
    const led = `Discard an Energy from this Pokémon. ${PRINTED}`;
    expect(deriveAttackDamageMultiplier(led)).toBeNull();
    expect(deriveAttackDamageSuppression(led)).toBeNull();
    expect(resolvedByAnyReader(led)).toBe(false);
    expect(deriveAttackEffect("Discard an Energy from this Pokémon.")).not.toBeNull();
  });

  it("the `$` END: a sentence CONTINUING past the rider is a SPLIT, not a claim", () => {
    const trailed = `${PRINTED} Draw a card.`;
    expect(splitAttackTrailingClause(trailed)).toEqual({ head: PRINTED, tail: "Draw a card." });
    expect(deriveAttackDamageMultiplier(trailed)).toBeNull();
    expect(deriveAttackDamageSuppression(trailed)).toBeNull();
    expect(
      legalAttackCorpus().filter(([, t]) => t !== PRINTED && t.startsWith(`${PRINTED} `)),
    ).toEqual([]);
  });

  it("the SPLITTERS still refuse it, now at the SHADOW refusal rather than the tail", () => {
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(deriveAttackEffect(TAIL)).toBeNull();
  });
});

describe("§5 — the BOARD: the fold, the zone, the filter and the §8.5 step", () => {
  it("the printed answer is 90, and it is the same from every seed", () => {
    for (const seed of SEEDS) {
      const dealt = findEvent(swing(board(seed)).events, "DAMAGE_DEALT")?.dealt;
      expect(dealt, `seed ${seed}`).toBe(90);
    }
  });

  it("the row reports WHICH §8.5 steps ran — Weakness NULLED, Resistance APPLIED", () => {
    const row = findEvent(swing(board(SEEDS[0])).events, "DAMAGE_DEALT");
    expect(row).toMatchObject({
      base: 0,
      scaled: 120,
      weakness: null,
      resistance: { op: "subtract", amount: 30 },
      dealt: 90,
    });
    expect(deriveAttackDamageSuppression(PRINTED)).toEqual({ weakness: true });
    expect(deriveAttackDamageSuppression(PRINTED)).not.toEqual({
      weakness: true,
      resistance: true,
    });
    // …and the base is the FOLD, which pins the zone and the filter in one number:
    // 12 counters × 10. Every wrong walk enumerated in `board`'s block answers a
    // different base (190 / 210 / 30 / 50 / 0).
    expect(row?.scaled).toBe(120);
    expect(row?.dealt).toBe(90);
  });

  it("the sentence is SIMULATED — no `ATTACK_EFFECT_SKIPPED` row", () => {
    const events = swing(board(SEEDS[0])).events;
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toEqual([]);
  });
});

describe("§5b — the LOG ROW, rendered (D456: render it before calling the slice done)", () => {
  it("the row prints the FOLD and prints NO Weakness segment", () => {
    const result = swing(board(SEEDS[0]));
    const lines = logFromEvents(result.events, {
      names: { p1: "P1", p2: "P2" },
      state: result.state,
      elapsed: "+00:10",
    });
    const text = lines
      .flatMap((l) => (l.kind === "action" ? l.segments.map((seg) => seg.text) : []))
      .join("");
    expect(text).toContain("scaled +120");
    expect(text).toContain("90");
    // The Weakness step did not run…
    expect(text).not.toContain("×2");
    expect(text).toContain("−30");
  });
});

describe("§6 — the U+2019 fold, on BOTH readers", () => {
  it("reads the curly spelling IDENTICALLY, and not merely non-null", () => {
    expect(deriveAttackDamageSuppression(curly(PRINTED))).toEqual(
      deriveAttackDamageSuppression(PRINTED),
    );
    expect(deriveAttackDamageMultiplier(curly(PRINTED))).toEqual(
      deriveAttackDamageMultiplier(PRINTED),
    );
    expect(deriveAttackDamageMultiplier(curly(PRINTED))).not.toBeNull();
    expect(curly(PRINTED).split(RSQUO)).toHaveLength(4); // three apostrophes rewritten
  });
});

describe("§7 — `MATCH_RECORD_VERSION` stays 29: there is NO CARRIER", () => {
  it("the reading is in NO byte of a persisted record, and the NUMBER is", () => {
    const after = swing(board(SEEDS[0])).state;
    const bytes = JSON.stringify(after);
    // The DERIVED shapes — the count member and its filter — appear NOWHERE. They are
    // computed inside `attack()` from the card's text and discarded in the same tick.
    for (const needle of ["damageCountersOnYourBench", "ownerPokemon"]) {
      expect(bytes.includes(needle), needle).toBe(false);
    }
    expect(bytes.includes(PRINTED)).toBe(true);
    // The number the reading decided IS in the bytes, which is what makes the absence
    // above a measurement rather than a serialisation that dropped everything.
    expect(after.players.p2.active?.damage).toBe(90);
    expect(after.phase.kind).not.toBe("effect:choose");
  });
});
