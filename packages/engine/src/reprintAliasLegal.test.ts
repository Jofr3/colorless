import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST as M } from "./catalogManifest";
import type { GameState } from "./index";
import { canonicalPrinting } from "./printGroups";
import { programFor } from "./registry";
import {
  ALWAYS_ON_REDUCTION_DECK,
  ATTACH_FROM_DECK_DECK,
  COUNTERATTACK_DECK,
  COVERAGE_DECK,
  DISCARD_RETRIEVAL_DECK,
  FIXTURE_POOL,
  LOOK_AT_TOP_DECK,
  SCORCHING_ARMOR_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

const ALIASES = [
  { id: "sv06-002", twin: "sv02-150", card: "Tangrowth — Thicket Body", legal: 8, catalog: 14 },
  { id: "sv07-125", twin: "sv02-150", card: "Dubwool — Soft Wool", legal: 8, catalog: 14 },
  { id: "sv08-054", twin: "sv02-150", card: "Cetitan — Solid Body", legal: 8, catalog: 14 },
  { id: "sv08-201", twin: "sv02-150", card: "Cetitan — Solid Body", legal: 8, catalog: 14 },
  { id: "sv10-108", twin: "sv02-150", card: "Mudsdale — Mud Coat", legal: 8, catalog: 14 },
  { id: "sv10.5w-077", twin: "sv02-150", card: "Bouffalant ex — Bouffer", legal: 8, catalog: 14 },
  { id: "sv10.5w-162", twin: "sv02-150", card: "Bouffalant ex — Bouffer", legal: 8, catalog: 14 },
  { id: "sv10.5w-170", twin: "sv02-150", card: "Bouffalant ex — Bouffer", legal: 8, catalog: 14 },
  // "…takes 20 less damage…" — 2 legal of 2.
  { id: "sv05-010", twin: "sv01-121", card: "Turtwig — Solid Shell", legal: 2, catalog: 2 },
  { id: "sv08.5-088", twin: "sv01-121", card: "Furfrou — Fur Coat", legal: 2, catalog: 2 },
  // "…put 3 damage counters on the Attacking Pokémon." — 3 legal of 4.
  {
    id: "sv05-139",
    twin: "sv01-005",
    card: "Iron Jugulis — Automated Combat",
    legal: 3,
    catalog: 4,
  },
  { id: "sv08-049", twin: "sv01-005", card: "Bruxish — Counterattack", legal: 3, catalog: 4 },
  { id: "sv08-200", twin: "sv01-005", card: "Bruxish — Counterattack", legal: 3, catalog: 4 },
  // "…the Attacking Pokémon is now Burned." — 1 legal of 1.
  { id: "sv06-123", twin: "sv03-044", card: "Heatran — Incandescent Body", legal: 1, catalog: 1 },
  // "All of your Pokémon take 10 less damage…" — 1 legal of 1.
  { id: "sv08.5-067", twin: "sv02-113", card: "Bronzong — Protective Bell", legal: 1, catalog: 1 },
  // Trainers. "Draw 3 cards." — 3 legal of 6, on two card NAMES that are neither
  // of them Nemona: the SENTENCE is the key, not the name.
  { id: "sv08.5-109", twin: "sv01-180", card: "Friends in Paldea", legal: 3, catalog: 6 },
  { id: "sv08.5-137", twin: "sv01-180", card: "Friends in Paldea", legal: 3, catalog: 6 },
  { id: "sv10.5w-081", twin: "sv01-180", card: "Cheren", legal: 3, catalog: 6 },
  // Janine's Secret Art — 2 legal of 2 beyond the two already authored.
  { id: "sv08.5-112", twin: "sv06.5-059", card: "Janine's Secret Art", legal: 2, catalog: 2 },
  { id: "sv08.5-173", twin: "sv06.5-059", card: "Janine's Secret Art", legal: 2, catalog: 2 },
  // Energy Retrieval — 1 legal of 1.
  { id: "sv10.5w-082", twin: "sv01-171", card: "Energy Retrieval", legal: 1, catalog: 1 },
  // Pokégear 3.0 — 1 legal of 1.
  { id: "sv10.5b-084", twin: "sv01-186", card: "Pokégear 3.0", legal: 1, catalog: 1 },
] as const;

const SKIPPED_ZERO_LEGAL = [
  {
    sentence: '"Discard your hand and draw 7 cards." (Professor\'s Research, sv01-189)',
    catalog: 11,
    ids: [
      "sv04.5-087",
      "sv04.5-088",
      "sv08.5-122",
      "sv08.5-123",
      "sv08.5-124",
      "sv08.5-125",
      "sv09-155",
      "sv10.5b-085",
      "svp-221",
      "svp-222",
      "svp-223",
    ],
  },
  {
    sentence:
      '"Prevent all damage done to this Pokémon by attacks from your opponent\'s Pokémon ex and Pokémon V." (Mimikyu Safeguard, sv02-097)',
    catalog: 6,
    ids: ["sv04-134", "sv04-210", "sv04.5-037", "sv04.5-160", "svp-060", "svp-075"],
  },
  {
    sentence:
      '"This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)." — the SAME sentence eight rows above',
    catalog: 14,
    ids: ["sv03.5-009", "sv03.5-184", "sv03.5-200", "sv04-128", "sv04-209", "sv07-030"],
  },
  {
    sentence:
      '"You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 3 cards." (Tinkaton, sv02-105)',
    catalog: 2,
    ids: ["sv04.5-167", "svp-020"],
  },
] as const;

const bite = { type: "attack", seat: "p1", index: 0 } as const; // fix-attacker Bite [C] 30

/** Setup, then open P1's turn (P2 went first and passed). */
function openOn(seed: number, deck: typeof COVERAGE_DECK): GameState {
  const state = driveSetup(seed, { p1: deck, p2: deck }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields fix-attacker with one {C} attached (pays Bite); P2 fields `defender`. */
function fight(state: GameState, defender: string): GameState {
  let next = setActiveFromDeck(state, "p1", "fix-attacker");
  next = attachFromDeck(next, "p1", "fix-energy", 1);
  return setActiveFromDeck(next, "p2", defender);
}

describe("D190 — the 22 STANDARD-LEGAL reprint aliases", () => {
  it("resolves each new id to the SAME PROGRAM OBJECT as its twin, except Heatran `sv06-123`, a renamed copy of its twin's ops (D584)", () => {
    for (const { id, twin, card } of ALIASES) {
      expect(programFor(id), `${id} (${card}) has no program`).toBeDefined();
      if (id === "sv06-123") {
        expect(programFor(id)).not.toBe(programFor(twin));
        expect(JSON.stringify(programFor(id)).replace("Incandescent Body", "Scorching Armor")).toBe(
          JSON.stringify(programFor(twin)),
        );
        continue;
      }
      expect(programFor(id), `${id} (${card}) does not SHARE ${twin}'s program`).toBe(
        programFor(twin),
      );
    }
  });

  it("lands exactly 22 printings over 9 program targets — the census's Tier 0 total", () => {
    expect(ALIASES).toHaveLength(22);
    // Nine DISTINCT program objects, reached through nine distinct anchor ids —
    // both counted, because a copy-pasted literal would keep the id count at 9
    // while the object count went to 10.
    expect(new Set(ALIASES.map((a) => a.twin)).size).toBe(9);
    expect(new Set(ALIASES.map((a) => programFor(a.twin))).size).toBe(9);
    for (const twin of new Set(ALIASES.map((a) => a.twin))) {
      const rows = ALIASES.filter((a) => a.twin === twin);
      expect(rows[0]?.legal).toBe(rows.length);
      expect(rows[0]?.catalog).toBeGreaterThanOrEqual(rows[0]?.legal ?? 0);
    }
  });

  it("pins the NINE targets' actual shapes — the thing the aliases inherit", () => {
    expect(programFor("sv06-002")?.passive).toEqual({ damageReductionAfterWR: 30 });
    expect(programFor("sv05-010")?.passive).toEqual({ damageReductionAfterWR: 20 });
    expect(programFor("sv05-139")?.passive).toEqual({ damageAttacker: { amount: 30 } });
    expect(programFor("sv06-123")?.triggered).toEqual([
      {
        name: "Incandescent Body",
        trigger: "onDamagedByAttack",
        activeOnly: true,
        program: [{ op: "applyStatus", target: "attacker", status: "burned" }],
      },
    ]);
    expect(programFor("sv08.5-067")?.passive).toEqual({
      seatDamageReductionAfterWR: { amount: 10 },
    });
    expect(programFor("sv08.5-109")?.trainer).toEqual([{ op: "drawCards", count: 3 }]);
    expect(programFor("sv08.5-112")?.trainer?.[0]).toMatchObject({ op: "attachFromDeck" });
    expect(programFor("sv10.5w-082")?.trainer).toEqual([
      { op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "hand", max: 2 },
    ]);
    expect(programFor("sv10.5b-084")?.trainer).toEqual([
      { op: "lookAtTopN", n: 7, filter: { kind: "supporter" }, max: 1, reveal: true },
      { op: "shuffleDeck" },
    ]);
  });

  it("keeps every PRE-EXISTING print of the same sentences on one shared program per group (Heatran with Numel ×2 on `INCANDESCENT_BODY`)", () => {
    for (const ids of [
      ["sv02-150", "sv02-245", "sv06-002", "sv10.5w-170"],
      ["sv01-121", "sv05-010", "sv08.5-088"],
      ["sv01-005", "sv01-006", "sv05-139", "sv08-200"],
      ["sv03-044"],
      ["sv06-123", "me02.5-027", "me02.5-223"],
      ["sv02-113", "sv08.5-067"],
      ["sv01-180", "sv08.5-109", "sv10.5w-081"],
      ["sv06.5-059", "sv06.5-088", "sv08.5-112", "sv08.5-173"],
      ["sv01-171", "sv10.5w-082"],
      ["sv01-186", "sv10.5b-084"],
      ["sv01-189", "sv01-190", "sv01-240", "sv01-241", "swsh10.5-078", "swsh10.5-084"],
      ["sv01-191", "sv01-256", "swsh10.5-069"],
    ]) {
      const first = programFor(ids[0] as string);
      expect(first, `${ids[0]} lost its program`).toBeDefined();
      for (const id of ids) expect(programFor(id), `${id} left the group`).toBe(first);
    }
  });

  it("has NO fixture and NO manifest row for any of the 22 — the reason there is no TEXT pin here", () => {
    for (const { id } of ALIASES) {
      expect(FIXTURE_POOL[id], `${id} is now a fixture — pin its TEXT`).toBeUndefined();
      expect(M.printed[id]).toBeUndefined();
      expect(M.absent).not.toContain(id);
      expect(M.sixSet.sets).not.toContain(id.replace(/-[^-]*$/, ""));
    }
    expect(M.sixSet.rows).toBe(978);
    expect(M.sixSet.sets).toHaveLength(6);
  });
});

describe("the SKIPPED candidates — correct aliases with ZERO Standard-legal payoff", () => {
  it("plays each one that shares a print_key through its group's program, and no other", () => {
    for (const { ids, sentence } of SKIPPED_ZERO_LEGAL) {
      for (const id of ids) {
        const canonical = canonicalPrinting(id);
        if (canonical === id) expect(programFor(id), `${id} (${sentence})`).toBeUndefined();
        else expect(programFor(id), `${id} (${sentence})`).toBe(programFor(canonical));
      }
    }
    expect(programFor("sv04.5-087")).toBe(programFor("sv01-189"));
    expect(programFor("sv04.5-037")).toBe(programFor("sv02-097"));
  });
});

const PRINTING_ALIAS_CENSUS = [
  { card: "Arboliva", authored: "sv01-023", unauthored: ["sv04.5-104"] },
  { card: "Armarouge", authored: "sv01-041", unauthored: ["sv04.5-015", "sv04.5-115"] },
  { card: "Artazon", authored: "sv02-171", unauthored: ["sv04.5-076"] },
  { card: "Baxcalibur", authored: "sv02-060", unauthored: ["svp-019", "sv04.5-130"] },
  { card: "Beach Court", authored: "sv01-167", unauthored: ["sv04-263"] },
  { card: "Brassius", authored: "sv03-187", unauthored: ["sv08.5-135"] },
  { card: "Bravery Charm", authored: "sv02-173", unauthored: ["sv07-175"] },
  {
    card: "Charizard ex",
    authored: "sv03-125",
    unauthored: ["svp-056", "svp-074", "svp-196", "sv04.5-054", "sv04.5-234"],
  },
  { card: "Chien-Pao ex", authored: "sv02-061", unauthored: ["svp-030", "sv04.5-242"] },
  { card: "Dachsbun", authored: "sv01-099", unauthored: ["sv04.5-039", "sv04.5-161"] },
  { card: "Earthen Vessel", authored: "sv06.5-096", unauthored: ["sv04-163", "sv08.5-106"] },
  { card: "Electric Generator", authored: "sv01-170", unauthored: ["sv04.5-079"] },
  { card: "Entei", authored: "sv03-030", unauthored: ["sv04.5-112"] },
  { card: "Flamigo", authored: "sv02-170", unauthored: ["sv04.5-211"] },
  {
    card: "Gardevoir ex",
    authored: "sv01-086",
    unauthored: ["sv04.5-029", "sv04.5-217", "sv04.5-233"],
  },
  { card: "Garganacl", authored: "sv02-123", unauthored: ["sv04.5-178"] },
  { card: "Giacomo", authored: "sv02-182", unauthored: ["sv08.5-138"] },
  { card: "Hawlucha", authored: "sv01-118", unauthored: ["svp-007", "sv04.5-175"] },
  { card: "Iono", authored: "sv02-185", unauthored: ["svp-124", "sv04.5-080", "sv04.5-237"] },
  { card: "Jet Energy", authored: "sv02-190", unauthored: ["sv08-252"] },
  // Judge (sv01-176; sv04.5-228 / sv10-167 / sv10-222) is not in this table — see
  // `LANDED_SINCE_EFFECTIVE_LEGALITY` below.
  { card: "Klefki", authored: "sv01-096", unauthored: ["sv04.5-159"] },
  { card: "Koraidon ex", authored: "sv01-125", unauthored: ["svp-029", "sv04.5-245"] },
  { card: "Luminous Energy", authored: "sv02-191", unauthored: ["sv06-226"] },
  { card: "Mawile", authored: "sv03-143", unauthored: ["svp-039"] },
  { card: "Meowscarada ex", authored: "sv02-015", unauthored: ["svp-033", "svp-078"] },
  { card: "Mimikyu", authored: "sv02-097", unauthored: ["svp-075", "sv04.5-037", "sv04.5-160"] },
  { card: "Nemona", authored: "sv01-180", unauthored: ["sv04.5-082", "sv04.5-229", "sv04.5-238"] },
  { card: "Nest Ball", authored: "sv01-181", unauthored: ["sv04.5-084"] },
  { card: "Ortega", authored: "sv03-190", unauthored: ["sv08.5-141"] },
  { card: "Pachirisu", authored: "sv01-068", unauthored: ["sv04.5-138"] },
  { card: "Pawmot", authored: "sv01-076", unauthored: ["svp-006", "sv04.5-144"] },
  // Potion (sv01-188; mfb-33) is in `LANDED_SINCE_EFFECTIVE_LEGALITY` below.
  {
    card: "Professor's Research",
    authored: "sv01-189",
    unauthored: [
      "svp-221",
      "svp-222",
      "svp-223",
      "sv04.5-087",
      "sv04.5-088",
      "sv08.5-122",
      "sv08.5-123",
      "sv08.5-124",
      "sv08.5-125",
      "sv09-155",
      "sv10.5b-085",
    ],
  },
  { card: "Quaquaval", authored: "sv01-054", unauthored: ["svp-005"] },
  { card: "Revavroom", authored: "sv01-142", unauthored: ["svp-008", "sv04.5-065", "sv04.5-193"] },
  { card: "Skwovet", authored: "sv01-151", unauthored: ["sv04.5-205"] },
  { card: "Spiritomb", authored: "sv02-089", unauthored: ["sv04.5-158"] },
  // Switch (sv01-194; sv03.5-206 / mfb-34) is in `LANDED_SINCE_EFFECTIVE_LEGALITY` below.
  { card: "Thundurus", authored: "sv03-070", unauthored: ["sv04.5-139"] },
  { card: "Ting-Lu ex", authored: "sv02-127", unauthored: ["sv04.5-244"] },
  { card: "Tinkaton", authored: "sv02-105", unauthored: ["svp-020", "sv04.5-167"] },
  // Ultra Ball (sv01-196; sv04.5-091) is in `LANDED_SINCE_EFFECTIVE_LEGALITY` below.
] as const;

const LANDED_SINCE_EFFECTIVE_LEGALITY = [
  { card: "Judge", authored: "sv01-176", landed: ["sv04.5-228", "sv10-167", "sv10-222"] },
  { card: "Rare Candy", authored: "sv01-191", landed: ["sv04.5-089"] },
  { card: "Potion", authored: "sv01-188", landed: ["mfb-33"] },
  { card: "Switch", authored: "sv01-194", landed: ["sv03.5-206", "mfb-34"] },
  { card: "Ultra Ball", authored: "sv01-196", landed: ["sv04.5-091"] },
] as const;

const SENTENCE_ONLY_SKIPS = [
  "sv04-134",
  "sv04-210",
  "svp-060",
  "sv03.5-009",
  "sv03.5-184",
  "sv03.5-200",
  "sv04-128",
  "sv04-209",
  "sv07-030",
] as const;

describe("D290 — the COMPLETE per-printing reprint census", () => {
  const flat = PRINTING_ALIAS_CENSUS.flatMap((r) => r.unauthored as readonly string[]);

  it("is 39 incomplete identities over 73 unauthored printings, with no id counted twice, and 44 / 81 with the landed rows added back", () => {
    expect(PRINTING_ALIAS_CENSUS).toHaveLength(39);
    expect(flat).toHaveLength(73);
    expect(new Set(flat).size).toBe(73);
    // …and no identity may be listed twice under two names, which is the other
    // way the table could double-count.
    expect(new Set(PRINTING_ALIAS_CENSUS.map((r) => r.authored)).size).toBe(39);
    const landed = LANDED_SINCE_EFFECTIVE_LEGALITY.flatMap((r) => r.landed as readonly string[]);
    expect(PRINTING_ALIAS_CENSUS.length + LANDED_SINCE_EFFECTIVE_LEGALITY.length).toBe(44);
    expect(flat.length + landed.length).toBe(81);
    for (const id of landed) expect(flat).not.toContain(id);
  });

  it("B01 — every printing that LEFT the census resolves to its authored twin's program object", () => {
    for (const { card, authored, landed } of LANDED_SINCE_EFFECTIVE_LEGALITY) {
      const twin = programFor(authored);
      expect(twin, `${authored} (${card})`).toBeDefined();
      for (const id of landed) expect(programFor(id), `${id} (${card})`).toBe(twin);
    }
  });

  it("plays every print_key twin in it through its authored twin's program, and leaves the one printing whose fields differ unauthored", () => {
    const notTwins: string[] = [];
    for (const { card, authored, unauthored } of PRINTING_ALIAS_CENSUS) {
      for (const id of unauthored) {
        if (canonicalPrinting(id) !== canonicalPrinting(authored)) {
          notTwins.push(id);
          expect(programFor(id), `${id} (${card})`).toBeUndefined();
        } else {
          expect(programFor(id), `${id} (${card})`).toBe(programFor(authored));
        }
      }
    }
    expect(notTwins).toEqual(["svp-196"]);
  });

  it("every row's AUTHORED anchor really carries a non-attack registry program — the attribution control", () => {
    for (const { card, authored } of PRINTING_ALIAS_CENSUS) {
      const program = programFor(authored);
      expect(
        program,
        `${authored} (${card}) anchors a census row and has no program`,
      ).toBeDefined();
      expect(
        Object.keys(program ?? {}).some((key) => key !== "attack"),
        `${authored} (${card}) is attack-only and cannot anchor a NON-ATTACK census row`,
      ).toBe(true);
    }
  });

  it("D190's SKIPPED_ZERO_LEGAL is a 16-of-25 SAMPLE of this census, and neither scope subsumes the other", () => {
    const sampled = SKIPPED_ZERO_LEGAL.flatMap((s) => s.ids as readonly string[]);
    expect(new Set(sampled).size).toBe(25);
    const here = new Set(flat);
    // The overlap, and the two remainders — all three derived from the constants
    // rather than restated, so a future edit to either list moves these numbers.
    expect(sampled.filter((id) => here.has(id))).toHaveLength(16);
    expect(sampled.filter((id) => !here.has(id)).sort()).toEqual([...SENTENCE_ONLY_SKIPS].sort());
    expect(flat.filter((id) => !sampled.includes(id))).toHaveLength(57);
    expect(new Set([...sampled, ...flat]).size).toBe(82);
    // The nine sentence-only ids stay unbuilt too — this block does not license
    // them by describing them.
    for (const id of SENTENCE_ONLY_SKIPS) expect(programFor(id)).toBeUndefined();
  });

  it("the census is DISJOINT from the 22 aliases D190 DID land — refusal and build do not overlap", () => {
    const landed = new Set<string>(ALIASES.map((a) => a.id));
    for (const id of flat) expect(landed.has(id), `${id} is BOTH landed and refused`).toBe(false);
    for (const id of SENTENCE_ONLY_SKIPS) expect(landed.has(id)).toBe(false);
  });

  it("Rare Candy's FOUR printings share ONE program (B04: `sv04.5-089` landed)", () => {
    const first = programFor("sv01-191");
    expect(first?.rareCandy).toBe(true);
    for (const id of ["sv01-256", "swsh10.5-069", "sv04.5-089"]) expect(programFor(id)).toBe(first);
    expect(PRINTING_ALIAS_CENSUS.map((r): string => r.card)).not.toContain("Rare Candy");
    expect(LANDED_SINCE_EFFECTIVE_LEGALITY.find((r) => r.card === "Rare Candy")?.landed).toEqual([
      "sv04.5-089",
    ]);
  });
});

describe("the inherited programs still run end to end (the twins, through the engine)", () => {
  it("damageReductionAfterWR 30 — Bite's 30 is fully absorbed", () => {
    const state = fight(openOn(2, COVERAGE_DECK), "sv02-150");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, bite);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, reduction: 30, dealt: 0 });
    expect(after.players.p2.active?.damage).toBe(0);
  });

  it("damageReductionAfterWR 20 — Bite's 30 lands as 10", () => {
    const state = fight(openOn(3, COVERAGE_DECK), "sv01-121");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, bite);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, reduction: 20, dealt: 10 });
    expect(after.players.p2.active?.damage).toBe(10);
  });

  it("damageAttacker 30 — the defender puts 3 counters back on the Attacking Pokémon", () => {
    const state = fight(openOn(1, COUNTERATTACK_DECK), "sv01-005");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, bite);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p1", amount: 30 });
    expect(after.players.p1.active?.damage).toBe(30);
  });

  it("the onDamagedByAttack trigger — the Attacking Pokémon is now Burned", () => {
    const state = fight(openOn(1, SCORCHING_ARMOR_DECK), "sv03-044");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, bite);
    expect(findEvent(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2",
      ability: "Scorching Armor",
    });
    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "burned" });
    expect(after.players.p1.active?.conditions.burned).toBe(true);
  });

  it("seatDamageReductionAfterWR 10 — a BENCHED source shields the seat's Active", () => {
    let state = openOn(1, ALWAYS_ON_REDUCTION_DECK);
    state = fight(state, "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113"); // Hariyama on the BENCH — the aura is seat-wide
    deepFreeze(state);
    const { events } = mustApply(state, bite);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, reduction: 10, dealt: 20 });
  });

  it("drawCards 3 — the Supporter draws exactly three", () => {
    let state = openOn(1, COVERAGE_DECK);
    state = handFromDeck(state, "p1", "sv01-180", 1);
    const uid = handUid(state, "p1", "sv01-180");
    const before = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(3);
    expect(after.players.p1.hand.length).toBe(before - 1 + 3); // −1 played, +3 drawn
  });

  it("discardPileRetrieval — Energy Retrieval parks on up to 2 Basic Energy", () => {
    let state = openOn(1, DISCARD_RETRIEVAL_DECK);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1);
    state = discardFromDeck(state, "p1", "fix-water-energy", 1);
    state = discardFromDeck(state, "p1", "fix-basic-1", 1); // a Pokémon — excluded
    state = handFromDeck(state, "p1", "sv01-171", 1);
    const uid = handUid(state, "p1", "sv01-171");
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.dest).toBe("hand");
    expect(parked.phase.prompt.max).toBe(2);
    expect(parked.phase.prompt.candidates).toHaveLength(2); // the two Energy, not the Pokémon
  });

  it("lookAtTopN — Pokégear 3.0 parks on the top 7's Supporters only", () => {
    let state = openOn(1, LOOK_AT_TOP_DECK);
    state = handFromDeck(state, "p1", "sv01-186", 1);
    const uid = handUid(state, "p1", "sv01-186");
    deepFreeze(state);
    const { state: after } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    // Seed 1 puts at least one Supporter in the top 7, so the park is the
    // deterministic outcome and no "…or it whiffed" escape hatch is offered —
    // that branch would make the case vacuously green if the op stopped running.
    expect(after.phase.kind).toBe("effect:choose");
    if (after.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (after.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(after.phase.prompt.max).toBe(1);
    expect(after.phase.prompt.dest).toBe("hand");
    expect(after.phase.prompt.candidates.length).toBeGreaterThan(0);
    for (const candidate of after.phase.prompt.candidates) {
      // the `supporter` filter, proved on the candidates rather than assumed
      expect(FIXTURE_POOL[after.cardIdByUid[candidate] ?? ""]?.trainerType).toBe("Supporter");
    }
  });

  it("attachFromDeck — Janine's Secret Art parks on the deck's Basic {D} Energy", () => {
    let state = openOn(1, ATTACH_FROM_DECK_DECK);
    state = setActiveFromDeck(state, "p1", "fix-dark-1"); // a {D} body, so targetType admits it
    state = handFromDeck(state, "p1", "sv06.5-059", 1);
    const uid = handUid(state, "p1", "sv06.5-059");
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt.kind).toBe("attachCards");
  });
});
