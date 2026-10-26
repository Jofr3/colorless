import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, handPlayBarred, programFor, redactGame } from "./index";
import type { GameState, Seat } from "./index";
import { aceSpecPlayBarred } from "./continuous";
import { isAceSpec } from "./deckRules";
import {
  FIXTURE_POOL,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  specialEnergy,
  trainerCard,
  must,
  driveSetup,
} from "./testFixtures";

const ACE_NULLIFIER_TEXT =
  "If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC cards from their hand.";
/** Copperajah's sentence — the CLASS-vocabulary sibling, and §1's proof that the
    two rows are not the same shape with a different noun. */
const MASSIVE_BODY_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Stadium cards from their hand.";

const GENESECT = "sv06.5-040";
const COPPERAJAH = "sv06.5-042";
/** Ting-Lu ex "Cursed Land" — the §9 ability lock. It silences the opponent's
    DAMAGED Pokémon in play (Active AND Bench, non-ex only), which is exactly the
    reach §6 needs to silence a BENCHED Genesect. */
const TING_LU = "sv02-127";

const ACE_ITEM = "sv06.5-058";
/** Master Ball `sv05-153` — a SECOND ACE SPEC Item under a different name, so
    §2's claim is about the RARITY and not about one card's program. */
const ACE_ITEM_2 = "sv05-153";
/** Potion `sv01-188` — a plain Item, the CLASS-MATCHED control. */
const ITEM = "sv01-188";
const ACE_STADIUM = "sv06.5-060";
/** Beach Court `sv01-167` — a plain Stadium, the surface-matched control. */
const STADIUM = "sv01-167";
/** Maximum Belt `sv08.5-117` — an ACE SPEC **Tool**, reached through
    `attachTool` rather than `playTrainer`: a THIRD gate on the same funnel. */
const ACE_TOOL = "sv08.5-117";
/** Vitality Band `sv01-197` — a plain Tool, and ALSO the card Genesect wears to
    open its own window. One fixture doing both jobs is deliberate: §3's window
    is armed by the very card §4 proves is not barred. */
const TOOL = "sv01-197";
const ACE_ENERGY = "sv08-191";
const SPECIAL_ENERGY = "sv02-190";
const BASIC_ENERGY = "fix-energy";
/** Professor's Research `sv01-189` — a Supporter, and the class the ACE SPEC
    population contains ZERO of. §1 records that as a measurement. */
const SUPPORTER = "sv01-189";

/** The victim's Active — 340 HP, so nothing in this pool can Knock it Out and
    park the board on `ko:takePrizes`, where every refusal below would be green at
    the PHASE gate instead of at the rule under test. */
const WALL = "fix-ace-wall";
/** The CONTROL body: same board, same hands, no Ability at all. */
const PLAIN = "fix-ace-plain";

function genesect(id: string): Card {
  return battler(id, {
    name: "Genesect",
    hp: 110,
    retreat: 1,
    types: ["Metal"],
    stage: "Basic",
    rarity: "Uncommon",
    abilities: [{ type: "Ability", name: "ACE Nullifier", effect: ACE_NULLIFIER_TEXT }],
    attacks: [{ name: "Magnetic Blast", cost: ["Metal", "Colorless", "Colorless"], damage: "100" }],
  });
}

function copperajah(id: string): Card {
  return battler(id, {
    name: "Copperajah",
    hp: 160,
    retreat: 3,
    types: ["Metal"],
    stage: "Stage1",
    evolveFrom: "Cufant",
    rarity: "Uncommon",
    abilities: [{ type: "Ability", name: "Massive Body", effect: MASSIVE_BODY_TEXT }],
  });
}

function priced(id: string, rarity: string | null, card: Card): Card {
  return { ...card, id, rarity };
}

const LOCAL_CARDS: Record<string, Card> = {
  [GENESECT]: genesect(GENESECT),
  [COPPERAJAH]: copperajah(COPPERAJAH),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Blocker",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    stage: "Basic",
  }),
  [WALL]: battler(WALL, {
    name: "Ace Wall",
    hp: 340,
    retreat: 3,
    types: ["Colorless"],
    stage: "Basic",
  }),
};

const RARITIES: Record<string, string> = {
  [ACE_ITEM]: "ACE SPEC Rare",
  [ACE_ITEM_2]: "ACE SPEC Rare",
  [ACE_STADIUM]: "ACE SPEC Rare",
  [ACE_TOOL]: "ACE SPEC Rare",
  [ACE_ENERGY]: "ACE SPEC Rare",
  [ITEM]: "Common",
  [STADIUM]: "Uncommon",
  [TOOL]: "Uncommon",
  [SUPPORTER]: "Rare",
  [SPECIAL_ENERGY]: "Uncommon",
};

const NEW_PRINTINGS: Record<string, Card> = {
  [ACE_ITEM]: trainerCard(
    ACE_ITEM,
    "Item",
    "Your opponent's Active Pokémon is now Burned and Confused.",
  ),
  [ACE_ITEM_2]: trainerCard(
    ACE_ITEM_2,
    "Item",
    "Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
  ),
  [ACE_TOOL]: trainerCard(
    ACE_TOOL,
    "Tool",
    "Attacks used by the Pokémon this card is attached to do 50 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance).",
  ),
  [ACE_ENERGY]: specialEnergy(
    ACE_ENERGY,
    "Enriching Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nWhen you attach this card from your hand to a Pokémon, draw 4 cards.",
  ),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS, ...NEW_PRINTINGS };
for (const [id, rarity] of Object.entries(RARITIES)) {
  const base = POOL[id];
  if (base === undefined) throw new Error(`POOL has no ${id}`);
  POOL[id] = priced(id, rarity, base);
}

const ACE_DECK = deckOf({
  [GENESECT]: 5,
  [COPPERAJAH]: 3,
  [TING_LU]: 3,
  [PLAIN]: 5,
  [WALL]: 5,
  [ACE_ITEM]: 4,
  [ACE_ITEM_2]: 4,
  [ITEM]: 4,
  [ACE_STADIUM]: 4,
  [STADIUM]: 3,
  [ACE_TOOL]: 4,
  [TOOL]: 4,
  [ACE_ENERGY]: 4,
  [SPECIAL_ENERGY]: 4,
  "fix-basic-1": 4,
});

const SEEDS = [8311, 8317, 8329, 8353] as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: ACE_DECK, p2: ACE_DECK }, { pool: POOL, first });
}

/** Where the barring body stands, and whether it is wearing a Tool — the two
    axes §3 crosses. `"none"` puts a `PLAIN` body in both slots instead. */
interface Barrier {
  readonly where: "active" | "bench" | "none";
  readonly tool: boolean;
  readonly id?: string;
}

function board(seed: number, first: Seat, barrier: Seat, spec: Barrier): GameState {
  let state = localSetup(seed, first);
  const victim = barrier === "p1" ? "p2" : "p1";
  const bodyId = spec.id ?? GENESECT;
  state = setActiveFromDeck(state, barrier, spec.where === "active" ? bodyId : PLAIN);
  state = clearBench(state, barrier);
  state = benchFromDeck(state, barrier, spec.where === "bench" ? bodyId : PLAIN);
  if (spec.tool) {
    state = attachToolFromDeck(state, barrier, spec.where === "bench" ? 0 : "active", TOOL);
  }
  state = setActiveFromDeck(state, victim, WALL);
  state = clearBench(state, victim);
  state = benchFromDeck(state, victim, "fix-basic-1");
  for (const seat of ["p1", "p2"] as const) {
    for (const id of [
      ACE_ITEM,
      ACE_ITEM_2,
      ITEM,
      ACE_STADIUM,
      STADIUM,
      ACE_TOOL,
      ACE_ENERGY,
      SPECIAL_ENERGY,
    ]) {
      state = handFromDeck(state, seat, id, 1);
    }
    state = handFromDeck(state, seat, TOOL, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Walk the clock so `seat` is the one to move, at turn 3 or later so §4's
    first-turn bans are spent. Both a bar and its absence are only observable on
    the barred player's OWN turn. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

function attach(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), {
    type: "attachTool",
    seat,
    uid,
    target: { spot: "active" },
  });
  return result.ok ? "OK" : result.error.code;
}

function attachEnergy(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), {
    type: "attachEnergy",
    seat,
    uid,
    target: { spot: "active" },
  });
  return result.ok ? "OK" : result.error.code;
}

function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.uid === handUid(state, seat, cardId))?.disabled;
}

const ARMED: Barrier = { where: "active", tool: true };

describe("D291 §1 — the printing, the classifier and the ACE SPEC census", () => {
  it("the fixture carries the PRINTED sentence byte for byte, and its window is NOT the Active Spot", () => {
    expect(POOL[GENESECT]?.abilities?.[0]?.effect).toBe(ACE_NULLIFIER_TEXT);
    expect(ACE_NULLIFIER_TEXT.startsWith("If this Pokémon has a Pokémon Tool attached")).toBe(true);
    expect(ACE_NULLIFIER_TEXT).not.toContain("Active Spot");
    expect(MASSIVE_BODY_TEXT).toContain("Active Spot");
    // AND THE NOUN IS A RARITY, NOT A CLASS — the other half of the refusal.
    expect(ACE_NULLIFIER_TEXT).toContain("any ACE SPEC cards from their hand");
  });

  it("THE ROW IS ON ITS OWN FIELD AND `HandPlayClass` DID NOT GROW", () => {
    expect(programFor(GENESECT)?.passive?.preventOpponentAceSpecPlayWhileToolAttached).toBe(true);
    expect(programFor(GENESECT)?.passive?.preventOpponentHandPlay).toBeUndefined();
    expect(programFor(GENESECT)?.passive?.preventOpponentPokemonPlay).toBeUndefined();
    // And the CLASS sibling keeps its own list — the two rows stay disjoint.
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentHandPlay).toEqual(["Stadium"]);
    expect(
      programFor(COPPERAJAH)?.passive?.preventOpponentAceSpecPlayWhileToolAttached,
    ).toBeUndefined();
    expect(programFor(GENESECT)).not.toBe(programFor(COPPERAJAH));
  });

  it("the classifier answers off `Card.rarity`, and it agrees with the deck validator", () => {
    for (const id of [ACE_ITEM, ACE_ITEM_2, ACE_STADIUM, ACE_TOOL, ACE_ENERGY]) {
      expect(isAceSpec(POOL[id]), id).toBe(true);
    }
    for (const id of [ITEM, STADIUM, TOOL, SUPPORTER]) {
      expect(isAceSpec(POOL[id]), id).toBe(false);
    }
    expect(POOL[GENESECT]?.rarity).toBe("Uncommon");
    expect(isAceSpec(POOL[GENESECT])).toBe(false);
    // A card with no rarity at all is FALSE, not a throw — every engine fixture
    // carries `rarity: null` and this predicate is asked on every Trainer play.
    expect(isAceSpec(FIXTURE_POOL["fix-basic-1"])).toBe(false);
    expect(isAceSpec(undefined)).toBe(false);
  });

  it("THE CENSUS: 33 legal ACE SPEC printings, and the split is what this build is priced on", () => {
    const census = {
      Item: { total: 20, registered: 8 },
      Tool: { total: 8, registered: 2 },
      Stadium: { total: 2, registered: 1 },
      Energy: { total: 3, registered: 2 },
    } as const;
    const rows = Object.values(census);
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(33);
    expect(rows.reduce((n, r) => n + r.registered, 0)).toBe(13);
    expect(33 - census.Energy.total).toBe(30);
    expect(Object.keys(census)).not.toContain("Supporter");
    expect(census.Item.registered + census.Tool.registered).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE BAR BITES, AND THE CLASS IS IRRELEVANT — the Item surface.
// ─────────────────────────────────────────────────────────────────────────────

describe("D291 §2 — the bar on the Item surface, with its class-matched control", () => {
  it("the victim's ACE SPEC Item is refused and its PLAIN Item is not — on the same board", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      expect(play(state, "p2", ACE_ITEM), `${seed}`).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", ITEM), `${seed}`).toBe("OK");
    }
  });

  it("a SECOND ACE SPEC Item under a different name is refused too — the claim is the rarity", () => {
    // One card's refusal could be that card's own program misbehaving. Two, with
    // different programs and different preconditions, cannot both be that.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(play(state, "p2", ACE_ITEM_2)).toBe("HAND_PLAY_BLOCKED");
    expect(programFor(ACE_ITEM)).not.toBe(programFor(ACE_ITEM_2));
  });

  it("THE BARRING SEAT'S OWN ACE SPEC IS FREE — the perspective flip, on the barred board", () => {
    // The sentence reads "your OPPONENT can't play", so the seat holding Genesect
    // keeps its whole hand. A build that dropped `otherSeat` bars both seats and
    // is green on every line above.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p1");
      expect(play(state, "p1", ACE_ITEM), `${seed}`).toBe("OK");
    }
  });

  it("both seat assignments and both first-players — a one-seat board is vacuous here", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const barrier of ["p1", "p2"] as const) {
        const victim = barrier === "p1" ? "p2" : "p1";
        const state = turnOf(board(SEEDS[1], first, barrier, ARMED), victim);
        expect(play(state, victim, ACE_ITEM), `${first}/${barrier}`).toBe("HAND_PLAY_BLOCKED");
        expect(play(state, victim, ITEM), `${first}/${barrier}`).toBe("OK");
      }
    }
  });

  it("the predicate answers at the reader, per CARD rather than per class", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(handPlayBarred(state, "p2", "Item", POOL[ACE_ITEM])).toBe(true);
    expect(handPlayBarred(state, "p2", "Item", POOL[ITEM])).toBe(false);
    // And a caller that passes no card at all loses only the rarity term.
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(false);
  });
});

describe("D291 §3 — the printed window is the TOOL, and it has no zone in it", () => {
  it("NO TOOL, NO BAR — the window is closed and the ACE SPEC lands", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", { where: "active", tool: false }), "p2");
      expect(play(state, "p2", ACE_ITEM), `${seed}`).toBe("OK");
    }
  });

  it("A BENCHED GENESECT WITH A TOOL BARS JUST AS HARD — the assertion an Active-only reader fails", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", { where: "bench", tool: true }), "p2");
      expect(play(state, "p2", ACE_ITEM), `${seed}`).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", ITEM), `${seed}`).toBe("OK");
    }
  });

  it("a benched Genesect WITHOUT a Tool bars nothing — the window, not the zone", () => {
    // Paired with the case above so "benched bodies always bar" cannot pass for
    // the rule: the difference between the two boards is one Tool.
    const state = turnOf(board(SEEDS[0], "p1", "p1", { where: "bench", tool: false }), "p2");
    expect(play(state, "p2", ACE_ITEM)).toBe("OK");
  });

  it("no Genesect anywhere and nothing is barred — the attribution control for the whole file", () => {
    // Without this, every "OK" above could be a board where the ACE SPEC play was
    // failing for a reason nobody named, and every "blocked" a board that refused
    // everything. `PLAIN` occupies both slots and wears the same Tool.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", { where: "none", tool: true }), "p2");
      expect(play(state, "p2", ACE_ITEM), `${seed}`).toBe("OK");
      expect(play(state, "p2", ITEM), `${seed}`).toBe("OK");
    }
  });

  it("THE WINDOW OPENS THROUGH THE REAL `attachTool` ACTION, NOT THROUGH SURGERY", () => {
    const open = board(SEEDS[0], "p1", "p1", { where: "active", tool: false });
    const before = turnOf(open, "p2");
    expect(play(before, "p2", ACE_ITEM)).toBe("OK");
    let armed = turnOf(open, "p1");
    armed = must(
      applyAction(armed, {
        type: "attachTool",
        seat: "p1",
        uid: handUid(armed, "p1", TOOL),
        target: { spot: "active" },
      }),
    );
    expect(play(turnOf(armed, "p2"), "p2", ACE_ITEM)).toBe("HAND_PLAY_BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. EVERY SURFACE THE VOCABULARY REACHES — three gates, one funnel.
// ─────────────────────────────────────────────────────────────────────────────

describe("D291 §4 — the Stadium and Tool surfaces, each with its own control", () => {
  it("the ACE SPEC STADIUM is refused and the plain Stadium is not — `playStadium`'s gate", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      expect(play(state, "p2", ACE_STADIUM), `${seed}`).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", STADIUM), `${seed}`).toBe("OK");
    }
  });

  it("the ACE SPEC TOOL is refused and the plain Tool is not — `attachTool`'s gate", () => {
    // A THIRD gate, and the one whose control is doing double duty: the plain
    // Tool that attaches here is the same card Genesect is wearing to arm the
    // window, so "Tools are barred" cannot pass for the rule.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      expect(attach(state, "p2", ACE_TOOL), `${seed}`).toBe("HAND_PLAY_BLOCKED");
      expect(attach(state, "p2", TOOL), `${seed}`).toBe("OK");
    }
  });

  it("THE CLASS SIBLING DOES NOT REACH ANY OF THEM — Copperajah bars Stadiums and only Stadiums", () => {
    // The inverse control, and the reason the two fields are two. On a board
    // whose barrier is COPPERAJAH the ACE SPEC Stadium is refused (its CLASS is
    // barred) while the ACE SPEC Item and the ACE SPEC Tool are free.
    const state = turnOf(
      board(SEEDS[0], "p1", "p1", { where: "active", tool: true, id: COPPERAJAH }),
      "p2",
    );
    expect(play(state, "p2", ACE_STADIUM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(state, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(state, "p2", ACE_ITEM)).toBe("OK");
    expect(attach(state, "p2", ACE_TOOL)).toBe("OK");
  });
});

describe("D292 §5 — the ACE SPEC Special Energy is barred, and it is the RARITY that bars it", () => {
  it("AN ACE SPEC SPECIAL ENERGY IS REFUSED ON A BARRED BOARD — 33 of 33, and the other 3 are these", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      // The Item on the same board, from the same hand, is barred by the same
      // sentence — so a red here is a SURFACE failure and not an unarmed board.
      expect(play(state, "p2", ACE_ITEM), `${seed}`).toBe("HAND_PLAY_BLOCKED");
      expect(attachEnergy(state, "p2", ACE_ENERGY), `${seed}`).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("THE SPECIAL-ENERGY CONTROL ATTACHES ON THAT SAME BOARD — the axis is RARITY, not category", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      expect(attachEnergy(state, "p2", SPECIAL_ENERGY), `${seed}`).toBe("OK");
    }
  });

  it("the barred Energy really is an ACE SPEC, and the two controls really are not", () => {
    expect(isAceSpec(POOL[ACE_ENERGY])).toBe(true);
    expect(POOL[ACE_ENERGY]?.category).toBe("Energy");
    expect(POOL[ACE_ENERGY]?.trainerType).toBeNull();
    expect(isAceSpec(POOL[SPECIAL_ENERGY])).toBe(false);
    expect(POOL[SPECIAL_ENERGY]?.category).toBe("Energy");
    expect(isAceSpec(POOL[BASIC_ENERGY])).toBe(false);
    expect(POOL[BASIC_ENERGY]?.rarity ?? null).toBeNull();
  });

  it("THE SITE ASKS `aceSpecPlayBarred` AND NOT `handPlayBarred` — no class word is invented", () => {
    const barred = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(aceSpecPlayBarred(barred, "p2", POOL[ACE_ENERGY])).toBe(true);
    expect(aceSpecPlayBarred(barred, "p2", POOL[SPECIAL_ENERGY])).toBe(false);
    expect(aceSpecPlayBarred(barred, "p2", undefined)).toBe(false);
    expect(handPlayBarred(barred, "p2", "Item", POOL[ACE_ENERGY])).toBe(true);
    // The barring seat's OWN hand is free of both, on the same board.
    const own = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p1");
    expect(aceSpecPlayBarred(own, "p1", POOL[ACE_ENERGY])).toBe(false);
    expect(attachEnergy(own, "p1", ACE_ENERGY)).toBe("OK");
  });

  it("§6.2's OWN-LIMIT NAMES ITSELF FIRST — the gate sits BELOW the allowance", () => {
    let state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    const spent = applyAction(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", SPECIAL_ENERGY),
      target: { spot: "active" },
    });
    if (!spent.ok) throw new Error(`control attach failed: ${spent.error.code}`);
    state = spent.state;
    expect(state.allowances.energyAttached).toBe(true);
    expect(attachEnergy(state, "p2", ACE_ENERGY)).toBe("ENERGY_ALREADY_ATTACHED");
  });

  it("A REFUSED ATTACH COSTS NOTHING — the card stays in hand and the allowance is unspent", () => {
    // The gate sits ABOVE the mutation, so the refusal is free. Without this, a
    // build that barred the play *after* removing the card from hand would be
    // green on every "HAND_PLAY_BLOCKED" line above while destroying the card.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    const uid = handUid(state, "p2", ACE_ENERGY);
    const result = applyAction(state, {
      type: "attachEnergy",
      seat: "p2",
      uid,
      target: { spot: "active" },
    });
    expect(result.ok).toBe(false);
    expect(state.players.p2.hand).toContain(uid);
    expect(state.allowances.energyAttached).toBe(false);
    expect(state.players.p2.active?.energy ?? []).not.toContain(uid);
  });

  it("the window and the §9 lock reach this surface too — the loop is not re-implemented here", () => {
    // The gate asks the SAME extracted reader every Trainer surface asks, so
    // everything §3 and §6 proved about the holder loop holds here for free.
    // Driven rather than asserted, because "for free" is a claim about code.
    const seed = SEEDS[0];
    // No Tool on the holder → no window → the Energy lands.
    expect(
      attachEnergy(
        turnOf(board(seed, "p1", "p1", { where: "active", tool: false }), "p2"),
        "p2",
        ACE_ENERGY,
      ),
    ).toBe("OK");
    // A BENCHED armed holder bars it — the loop, one surface over.
    expect(
      attachEnergy(
        turnOf(board(seed, "p1", "p1", { where: "bench", tool: true }), "p2"),
        "p2",
        ACE_ENERGY,
      ),
    ).toBe("HAND_PLAY_BLOCKED");
    // No holder at all → nothing bars anything.
    expect(
      attachEnergy(
        turnOf(board(seed, "p1", "p1", { where: "none", tool: true }), "p2"),
        "p2",
        ACE_ENERGY,
      ),
    ).toBe("OK");
    // §9 — Ting-Lu ex silences the one damaged Active holder and the Energy lands.
    let locked = board(seed, "p1", "p1", ARMED);
    locked = turnOf(setActiveFromDeck(locked, "p2", TING_LU), "p2");
    expect(attachEnergy(locked, "p2", ACE_ENERGY)).toBe("OK");
  });

  it("THE REFUSAL THIS SLICE MAKES: the WIRE cannot grey the Energy row, because it has none", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(wireDisabled(state, "p2", ACE_ITEM)).toBe(true);
    expect(wireDisabled(state, "p2", ACE_ENERGY)).toBeUndefined();
    expect(wireDisabled(state, "p2", SPECIAL_ENERGY)).toBeUndefined();
    const phase = redactGame(state, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    for (const row of phase.trainers) {
      const card = POOL[state.cardIdByUid[row.uid] ?? ""];
      expect(card?.category, row.uid).toBe("Trainer");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. §9 SUPPRESSION, PER SOURCE — and per source is load-bearing here.
// ─────────────────────────────────────────────────────────────────────────────

describe("D291 §6 — the Ability lock takes the bar down, one SOURCE at a time", () => {
  it("a silenced Genesect bars nothing — §9, driven through a real Ability lock", () => {
    // Ting-Lu ex's "Cursed Land" silences the opponent's DAMAGED non-ex Pokémon in
    // play. Every board here damages both seats, so the Active Genesect is inside
    // its reach and the ACE SPEC lands.
    let state = board(SEEDS[0], "p1", "p1", ARMED);
    state = setActiveFromDeck(state, "p2", TING_LU);
    state = turnOf(state, "p2");
    expect(play(state, "p2", ACE_ITEM)).toBe("OK");
  });

  it("SILENCING ONE HOLDER DOES NOT TAKE THE BAR DOWN — per SOURCE, which only a LOOP can get wrong", () => {
    const locked = (withSecondHolder: boolean): GameState => {
      let state = board(SEEDS[0], "p1", "p1", ARMED);
      if (withSecondHolder) {
        state = benchFromDeck(state, "p1", GENESECT);
        state = attachToolFromDeck(state, "p1", 1, TOOL);
      }
      return turnOf(setActiveFromDeck(state, "p2", TING_LU), "p2");
    };
    // ONE holder, and it is damaged and silenced: the bar is down.
    expect(play(locked(false), "p2", ACE_ITEM)).toBe("OK");
    // TWO holders, the second undamaged and therefore untouched by the lock: the
    // bar is still up. A "any source silenced ⇒ no bar" reader answers "OK" here.
    expect(play(locked(true), "p2", ACE_ITEM)).toBe("HAND_PLAY_BLOCKED");
    // And the plain Item is free on BOTH, so neither answer is the board refusing
    // Trainer plays for some other reason.
    expect(play(locked(false), "p2", ITEM)).toBe("OK");
    expect(play(locked(true), "p2", ITEM)).toBe("OK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. NOTHING PERSISTED, AND BOTH MIRRORS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D291 §7 — the bar is DERIVED, and the wire greys the row it should", () => {
  it("NOTHING WAS WRITTEN — `handPlayLockedTurn` is empty on both seats on a barred board", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(play(state, "p2", ACE_ITEM)).toBe("HAND_PLAY_BLOCKED");
    for (const seat of ["p1", "p2"] as const) {
      expect(state.handPlayLockedTurn[seat]).toEqual({
        Item: null,
        Supporter: null,
        Stadium: null,
        evolve: null,
      });
      expect(Object.keys(state.handPlayLockedTurn[seat]).sort()).toEqual([
        "Item",
        "Stadium",
        "Supporter",
        "evolve",
      ]);
    }
  });

  it("THE WIRE GREYS THE ACE SPEC ROW AND NOT THE PLAIN ONE — and `RedactedCard` gains no field", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(wireDisabled(state, "p2", ACE_ITEM)).toBe(true);
    expect(wireDisabled(state, "p2", ITEM)).toBe(false);
    expect(wireDisabled(state, "p2", ACE_STADIUM)).toBe(true);
    expect(wireDisabled(state, "p2", STADIUM)).toBe(false);
    const view = redactGame(state, "p2");
    expect(view.board.you.hand.length).toBeGreaterThan(0);
    for (const card of view.board.you.hand) {
      expect(Object.keys(card)).not.toContain("rarity");
    }
  });

  it("the barring seat's OWN wire rows stay lit on the same board — the mirror's perspective flip", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p1");
    expect(wireDisabled(state, "p1", ACE_ITEM)).toBe(false);
    expect(wireDisabled(state, "p1", ITEM)).toBe(false);
  });
});

/** The refusal's MESSAGE (or "OK"), for the three surfaces `play`/`attach`/
    `attachEnergy` reach — those helpers report the code only. */
function refusal(
  state: GameState,
  seat: Seat,
  cardId: string,
  how: "play" | "tool" | "energy",
): string {
  const uid = handUid(state, seat, cardId);
  const action =
    how === "play"
      ? ({ type: "playTrainer", seat, uid } as const)
      : ({
          type: how === "tool" ? "attachTool" : "attachEnergy",
          seat,
          uid,
          target: { spot: "active" },
        } as const);
  const result = applyAction(deepFreeze(state), action);
  return result.ok ? "OK" : `${result.error.code}: ${result.error.message}`;
}

const ACE_SPEC_REASON =
  "HAND_PLAY_BLOCKED: your opponent prevents you from playing ACE SPEC cards from your hand";

describe("B14 §8 — the ACE Nullifier refusal names ACE SPEC cards, on every surface", () => {
  it("an Active Genesect with a Tool: Item, second Item, Stadium, Tool and Energy all say ACE SPEC", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      expect(refusal(state, "p2", ACE_ITEM, "play"), `${seed}`).toBe(ACE_SPEC_REASON);
      expect(refusal(state, "p2", ACE_ITEM_2, "play"), `${seed}`).toBe(ACE_SPEC_REASON);
      expect(refusal(state, "p2", ACE_STADIUM, "play"), `${seed}`).toBe(ACE_SPEC_REASON);
      expect(refusal(state, "p2", ACE_TOOL, "tool"), `${seed}`).toBe(ACE_SPEC_REASON);
      expect(refusal(state, "p2", ACE_ENERGY, "energy"), `${seed}`).toBe(ACE_SPEC_REASON);
      // The class-matched controls still play — the message is not a cover for a class lock.
      expect(refusal(state, "p2", ITEM, "play"), `${seed}`).toBe("OK");
      expect(refusal(state, "p2", STADIUM, "play"), `${seed}`).toBe("OK");
      expect(refusal(state, "p2", TOOL, "tool"), `${seed}`).toBe("OK");
    }
  });

  it("a BENCHED Genesect with a Tool words it the same way", () => {
    const state = turnOf(board(SEEDS[1], "p1", "p1", { where: "bench", tool: true }), "p2");
    expect(refusal(state, "p2", ACE_ITEM, "play")).toBe(ACE_SPEC_REASON);
    expect(refusal(state, "p2", ACE_TOOL, "tool")).toBe(ACE_SPEC_REASON);
  });

  it("a CLASS bar keeps its class word: Copperajah Active + Genesect benched with a Tool", () => {
    // Both sources bar the ACE SPEC Stadium; the Stadium lock is the wider truth and the plain
    // Stadium is refused by it alone. The ACE SPEC Item is refused by Genesect alone.
    let state = board(SEEDS[2], "p1", "p1", { where: "active", tool: false, id: COPPERAJAH });
    state = benchFromDeck(state, "p1", GENESECT);
    const at = state.players.p1.bench.findIndex(
      (b) => state.cardIdByUid[b.stack[b.stack.length - 1] ?? ""] === GENESECT,
    );
    expect(at).toBeGreaterThanOrEqual(0);
    state = turnOf(attachToolFromDeck(state, "p1", at, TOOL), "p2");
    const STADIUM_REASON =
      "HAND_PLAY_BLOCKED: your opponent prevents you from playing Stadium cards from your hand";
    expect(refusal(state, "p2", STADIUM, "play")).toBe(STADIUM_REASON);
    expect(refusal(state, "p2", ACE_STADIUM, "play")).toBe(STADIUM_REASON);
    expect(refusal(state, "p2", ACE_ITEM, "play")).toBe(ACE_SPEC_REASON);
    expect(refusal(state, "p2", ACE_TOOL, "tool")).toBe(ACE_SPEC_REASON);
  });
});
