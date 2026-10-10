import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { normalizeCardText, normalizedFace } from "./cardText";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { cardOfUid } from "./cards";
import type { GameEvent, GameState } from "./index";
import { applyAction, createGame, engineVersion, normalizeCardText as exported } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  completeSetup,
  deckOf,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D612 — WP06: THE tcgdex MARKUP NORMALISER ─────────────────────────────────────────────────
//
// cardText.ts `normalizeCardText`, applied at ingest (apps/api ingest/map.ts) and at read (cards.ts
// `cardOfUid` → `normalizedFace`). Every RAW text below is LOCAL D1 text as tcgdex served it before the
// D612 re-ingest (2026-10-09); every clean text is the row after it. Three are not whole rows:
// `draconicStar` and `flareSymbol` are EXCERPTS of the non-legal `swsh10.5` Draconic Star attack (`-050` /
// `-081`) and Flare Symbol Ability (`-012`), and `dragonStrike` is a `me02.5-176` row that was already clean (the attack-name control).
// A match created before the re-ingest persists the raw face in `GameState.cardPool`, so §4 drives a raw
// face on a board.

const RAW = {
  hydroPump:
    'This attack does 30 more damage for each <span class="energy-symbol Water" title="Water">Water</span> Energy attached to this Pokémon.',
  hail: "This attack does 30 damage to each of your opponent's Pokémon. <em>(Don't apply Weakness and Resistance for Benched Pokémon.)</em>",
  fightingLightning: "If your opponent's Active Pokémon is a Pokémon <em>ex</em>, this attack does 80 more damage.",
  kaboomNeedles:
    "This attack does 50 damage to each of your opponent's Pokémon. <em>(Don't apply Weakness and Resistance for Benched Pokémon.) </em>This Pokémon also does 130 damage to itself.",
  megaloCannon: "Does 20 damage to 1 of your opponent's Benched Pokémon. <em>\t   (Don't apply Weakness and Resistance for Benched Pokémon.)</em>",
  infernoX:
    "Discard any amount of [R] Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way.",
  fieryFlapping:
    "Once during your turn, if you have Articuno and Zapdos in play, you may use this Ability. Attach a Basic Fire Energy card from your hand to this Pokémon.",
  scaleUp: "If this Pokémon has 6 or more Grass Energy attached, it gets +250 HP.",
  nighttimeByway: "As long as this Pokémon is on your Bench, your Active Pokémon's Retreat Cost is ColorlessColorless less.",
  burnBrightly:
    "Each basic Fire Energy attached to your Pokémon provides FireFire Energy. You can't apply more than 1 Burn Brightly Ability at a time.",
  excitedHeart: "This Pokémon's attacks cost Colorless less for each Prize card your opponent has taken.",
  draconicStar:
    "Look at the top 12 cards of your deck and attach any number of Water or Lightning Energy cards you find there to your Pokémon in any way you like.",
  flareSymbol: "Your Basic Fire Pokémon's attacks, except any Moltres, do 10 more damage to your opponent's Active Pokémon",
  dragonStrike: "During your next turn, this Pokémon can't use Dragon Strike.",
} as const;

const CLEAN = {
  hydroPump: "This attack does 30 more damage for each {W} Energy attached to this Pokémon.",
  hail: "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  fightingLightning: "If your opponent's Active Pokémon is a Pokémon ex, this attack does 80 more damage.",
  kaboomNeedles:
    "This attack does 50 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) This Pokémon also does 130 damage to itself.",
  megaloCannon: "Does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  infernoX:
    "Discard any amount of {R} Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way.",
  fieryFlapping:
    "Once during your turn, if you have Articuno and Zapdos in play, you may use this Ability. Attach a Basic {R} Energy card from your hand to this Pokémon.",
  scaleUp: "If this Pokémon has 6 or more {G} Energy attached, it gets +250 HP.",
  nighttimeByway: "As long as this Pokémon is on your Bench, your Active Pokémon's Retreat Cost is {C}{C} less.",
  burnBrightly:
    "Each basic {R} Energy attached to your Pokémon provides {R}{R} Energy. You can't apply more than 1 Burn Brightly Ability at a time.",
  excitedHeart: "This Pokémon's attacks cost {C} less for each Prize card your opponent has taken.",
  draconicStar:
    "Look at the top 12 cards of your deck and attach any number of {W} or {L} Energy cards you find there to your Pokémon in any way you like.",
  flareSymbol: "Your Basic {R} Pokémon's attacks, except any Moltres, do 10 more damage to your opponent's Active Pokémon",
  dragonStrike: "During your next turn, this Pokémon can't use Dragon Strike.",
} as const;

describe("D612 §1 — the rules, on the texts tcgdex printed", () => {
  for (const key of Object.keys(RAW) as (keyof typeof RAW)[]) {
    it(`${key}: the raw text reads as its clean spelling`, () => {
      expect(normalizeCardText(RAW[key])).toBe(CLEAN[key]);
    });
  }

  it("idempotent: every clean spelling is a fixed point", () => {
    for (const text of Object.values(CLEAN)) expect(normalizeCardText(text)).toBe(text);
    for (const text of Object.values(RAW)) {
      const once = normalizeCardText(text);
      expect(normalizeCardText(once)).toBe(once);
    }
  });

  it("closed: an unknown energy-symbol class keeps its span; any other tag and a lowercase bracket are left alone", () => {
    const unknown = 'a <span class="energy-symbol Plasma" title="Plasma">Plasma</span> Energy';
    expect(normalizeCardText(unknown)).toBe(unknown);
    expect(normalizeCardText("a <b>bold</b> word")).toBe("a <b>bold</b> word");
    expect(normalizeCardText("[r] and [X]")).toBe("[r] and [X]");
    // A type word that is no Energy / Pokémon noun and no cost stays a word.
    expect(normalizeCardText("Fire Blast")).toBe("Fire Blast");
    expect(normalizeCardText("Dragon Pulse deals more")).toBe("Dragon Pulse deals more");
  });

  it("the index exports the one function the ingest calls", () => {
    expect(exported).toBe(normalizeCardText);
  });
});

describe("D612 §2 — every `sv` text is a fixed point, and so is every regenerated `me` row", () => {
  it("the 640 legal `sv` attack sentences and the 442 `me` ones come back unchanged", () => {
    const sv = legalAttackCorpus();
    const me = meAttackCorpus();
    expect([sv.length, me.length]).toEqual([640, 442]);
    for (const [, text] of [...sv, ...me]) expect(normalizeCardText(text)).toBe(text);
  });
});

describe("D612 §3 — `normalizedFace`: the same object unless a text changes", () => {
  const clean = battler("d612-clean", { attacks: [{ cost: ["Water"], name: "Hydro Pump", effect: CLEAN.hydroPump }] });
  const raw = battler("d612-raw", {
    abilities: [{ type: "Ability", name: "Scale Up", effect: RAW.scaleUp }],
    attacks: [
      { cost: ["Colorless"], name: "Tackle", damage: 10 },
      { cost: ["Water"], name: "Hydro Pump", effect: RAW.hydroPump, damage: "60+" },
    ],
  });

  it("a clean face is returned as itself", () => {
    expect(normalizedFace(clean)).toBe(clean);
  });

  it("a raw face comes back as a copy with clean text; the input is untouched and the copy is memoised", () => {
    const face = normalizedFace(raw);
    expect(face).not.toBe(raw);
    expect(face.attacks?.[1]?.effect).toBe(CLEAN.hydroPump);
    expect(face.attacks?.[0]).toBe(raw.attacks?.[0]);
    expect(face.abilities?.[0]?.effect).toBe(CLEAN.scaleUp);
    expect(raw.attacks?.[1]?.effect).toBe(RAW.hydroPump);
    expect(normalizedFace(raw)).toBe(face);
    expect({ ...face, attacks: null, abilities: null }).toEqual({ ...raw, attacks: null, abilities: null });
  });

  it("a Trainer's rules text is normalised too", () => {
    const item = { ...FIXTURE_POOL["fix-energy"], id: "d612-item", category: "Trainer", effect: RAW.burnBrightly } as Card;
    expect(normalizedFace(item).effect).toBe(CLEAN.burnBrightly);
  });
});

// ── ON A BOARD: a persisted pre-D612 face ──

const KYOGRE = "30th-019";
const FILLER = "d612-filler";
const WATER = "d612-water";

const LOCAL: Record<string, Card> = {
  // Kyogre `30th-019` as tcgdex served it before the re-ingest (LOCAL D1 2026-10-08).
  [KYOGRE]: battler(KYOGRE, {
    name: "Kyogre",
    hp: 140,
    types: ["Water"],
    retreat: 4,
    attacks: [{ cost: ["Colorless", "Colorless", "Colorless", "Colorless"], name: "Hydro Pump", effect: RAW.hydroPump, damage: "60+" }],
  }),
  [FILLER]: battler(FILLER, { name: "D612 Filler", hp: 900, types: ["Colorless"], retreat: 1 }),
  [WATER]: typedEnergy(WATER, "Water"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({ [FILLER]: 30, [KYOGRE]: 4, [WATER]: 26 });

function p1Turn(): GameState {
  const created = createGame({ seed: 612, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return state;
}

const dealt = (events: readonly GameEvent[]) =>
  events.filter((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT")[0]?.dealt ?? 0;

describe("D612 §4 — a raw face in a persisted pool reads like the re-ingested row", () => {
  it("the pool keeps the raw face; `cardOfUid` hands the engine the clean one", () => {
    const state = p1Turn();
    expect(state.cardPool[KYOGRE]?.attacks?.[0]?.effect).toBe(RAW.hydroPump);
    const uid = Object.keys(state.cardIdByUid).find((u) => state.cardIdByUid[u] === KYOGRE) as string;
    expect(cardOfUid(state, uid)?.attacks?.[0]?.effect).toBe(CLEAN.hydroPump);
    // The JSON round trip a MatchRecord takes changes nothing.
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(cardOfUid(revived, uid)?.attacks?.[0]?.effect).toBe(CLEAN.hydroPump);
    // A clean face is the pool's own object.
    const filler = Object.keys(state.cardIdByUid).find((u) => state.cardIdByUid[u] === FILLER) as string;
    expect(cardOfUid(state, filler)).toBe(state.cardPool[FILLER]);
  });

  it("Kyogre's raw Hydro Pump plays the reader's program: 60 + 30 for each {W} Energy", () => {
    expect(resolvedByAnyReader(RAW.hydroPump)).toBe(false);
    expect(resolvedByAnyReader(CLEAN.hydroPump)).toBe(true);
    expect(programFor(KYOGRE)).toBeUndefined();
    let state = p1Turn();
    state = clearBench(setActiveFromDeck(state, "p1", KYOGRE), "p1");
    state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
    state = attachFromDeck(state, "p1", WATER, 4);
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    if (!result.ok) throw new Error(result.error.message);
    expect(dealt(result.events)).toBe(60 + 4 * 30);
  });
});

describe("D612 §5 — the version", () => {
  it("is built at engine 0.523.0", () => {
    expect(engineVersion).toBe("0.523.0");
  });
});
