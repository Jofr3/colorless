import { describe, expect, it } from "vitest";
import { cardOfUid } from "./cards";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, programFor } from "./index";
import type { GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  LOOK_AT_TOP_DECK,
  ONKO_DECK,
  TRAINER_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  toDeckTop,
  types,
  findEvent,
} from "./testFixtures";

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function ctx(state: GameState): LogContext {
  return { names: NAMES, state, elapsed: formatElapsed(0) };
}

function searchRow(state: GameState, events: GameEvent[]): string {
  const rows = logFromEvents(events, ctx(state));
  const row = rows.find(
    (r) =>
      r.kind === "action" &&
      r.segments.some(
        (s) => s.text.includes("searched their deck") || s.text.includes("looked at the top"),
      ),
  );
  return row?.kind === "action" ? row.segments.map((s) => s.text).join("") : "";
}

function nameOf(state: GameState, uid: string): string {
  const name = cardOfUid(state, uid)?.name;
  if (name === undefined) throw new Error(`no card for ${uid}`);
  return name;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — Trainers play
    freely, the shared board shape of cardplay.test.ts. */
function p1Turn2(seed: number, decks: { p1: string[]; p2: string[] }): GameState {
  return must(
    applyAction(driveSetup(seed, decks, { first: "p2" }), { type: "endTurn", seat: "p2" }),
  );
}

function playAndTake(
  start: GameState,
  cardId: string,
  take: number,
): { state: GameState; events: GameEvent[]; picked: string[] } {
  const state = handFromDeck(start, "p1", cardId, 1);
  const uid = handUid(state, "p1", cardId);
  const parked = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
  if (parked.phase.kind !== "effect:choose") throw new Error(`${cardId} did not park`);
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error(`${cardId} did not prompt for cards`);
  const picked = prompt.candidates.slice(0, take);
  const resolved = mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: picked },
  });
  return { state: resolved.state, events: resolved.events, picked: [...picked] };
}

describe("D225 — log.ts's DECK_SEARCHED arm reads the printed clause, not the destination", () => {
  // A board whose p1 deck is full of nameable fixture cards; the uids are real,
  // so `cardName` resolves through the same pool the engine plays on.
  const board = p1Turn2(1, { p1: TRAINER_DECK, p2: TRAINER_DECK });
  const deck = board.players.p1.deck;
  const one = deck[0] as string;
  const two = deck[1] as string;

  it("names the cards when the sentence prints a reveal", () => {
    const events: GameEvent[] = [
      { type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [one], reveal: true },
    ];
    expect(searchRow(board, events)).toBe(
      `searched their deck — revealed ${nameOf(board, one)} and put it in hand`,
    );
  });

  it("stays a COUNT when it does not — the Cassiopeia ending, and it is deliberate", () => {
    const events: GameEvent[] = [
      { type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [one, two] },
    ];
    const text = searchRow(board, events);
    expect(text).toBe("searched their deck — put 2 cards in hand");
    // The identities are ABSENT, not merely unemphasised: an unfiltered search
    // that prints no reveal must not leak the hand it just built.
    expect(text).not.toContain(nameOf(board, one));
    expect(text).not.toContain(nameOf(board, two));
  });

  it("agrees its verb and pronoun with the count on BOTH endings", () => {
    expect(
      searchRow(board, [
        { type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [one, two], reveal: true },
      ]),
    ).toContain(" and put them in hand");
    expect(
      searchRow(board, [{ type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [one] }]),
    ).toContain("put 1 card in hand");
  });

  it("folds duplicate names to ×N — a search for up to 3 of one name is the common case", () => {
    const events: GameEvent[] = [
      { type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [one, one, two], reveal: true },
    ];
    // `one` and `two` may or may not share a name in this deck; assert the fold
    // on the pair that certainly does.
    expect(searchRow(board, events)).toContain(`${nameOf(board, one)} ×2`);
  });

  it("ignores the flag entirely on a BENCH search — that destination was never the debt", () => {
    const counted = "searched their deck — benched 1 Pokémon";
    expect(
      searchRow(board, [{ type: "DECK_SEARCHED", seat: "p1", dest: "bench", uids: [one] }]),
    ).toBe(counted);
    expect(
      searchRow(board, [
        { type: "DECK_SEARCHED", seat: "p1", dest: "bench", uids: [one], reveal: true },
      ]),
    ).toBe(counted);
  });
});

describe("D225 — log.ts's DECK_TOP_REVEALED arm carries the same rider", () => {
  const board = p1Turn2(1, { p1: LOOK_AT_TOP_DECK, p2: LOOK_AT_TOP_DECK });
  const top = board.players.p1.deck[0] as string;

  it("names the taken card when the sentence prints 'you may reveal a …'", () => {
    expect(
      searchRow(board, [{ type: "DECK_TOP_REVEALED", seat: "p1", uids: [top], reveal: true }]),
    ).toBe(`looked at the top of their deck — revealed ${nameOf(board, top)} and put it in hand`);
  });

  it("stays a COUNT without it — the Hassel / Explorer's Guidance ending", () => {
    const text = searchRow(board, [{ type: "DECK_TOP_REVEALED", seat: "p1", uids: [top] }]);
    expect(text).toBe("looked at the top of their deck — put 1 card in hand");
    expect(text).not.toContain(nameOf(board, top));
  });
});

// ── 2. Driven end to end — the same op, one printed clause apart ─────────────

describe("D225 — driven through real programs, the clause is the only difference", () => {
  it("Energy Search NAMES the Basic Energy it found (printed 'reveal it')", () => {
    const start = p1Turn2(1, { p1: TRAINER_DECK, p2: TRAINER_DECK });
    const { state, events, picked } = playAndTake(start, "sv01-172", 1);
    const searched = findEvent(events, "DECK_SEARCHED");
    expect(searched?.dest).toBe("hand");
    expect(searched?.reveal).toBe(true);
    expect(searchRow(state, events)).toBe(
      `searched their deck — revealed ${nameOf(state, picked[0] as string)} and put it in hand`,
    );
    expect(types(events)).toContain("SHUFFLE");
  });

  it('Nest Ball stays a count — same op, `dest: "bench"`, no printed reveal', () => {
    const start = p1Turn2(1, { p1: TRAINER_DECK, p2: TRAINER_DECK });
    const { state, events, picked } = playAndTake(start, "sv01-181", 1);
    const searched = findEvent(events, "DECK_SEARCHED");
    expect(searched?.dest).toBe("bench");
    expect(searched).not.toHaveProperty("reveal");
    expect(searchRow(state, events)).toBe("searched their deck — benched 1 Pokémon");
    expect(searchRow(state, events)).not.toContain(nameOf(state, picked[0] as string));
  });

  it("Great Ball NAMES its taken Pokémon (printed 'You may reveal a Pokémon')", () => {
    let start = p1Turn2(1, { p1: LOOK_AT_TOP_DECK, p2: LOOK_AT_TOP_DECK });
    start = toDeckTop(start, "p1", "fix-basic-1", 2);
    const { state, events, picked } = playAndTake(start, "sv02-183", 1);
    const revealed = findEvent(events, "DECK_TOP_REVEALED");
    expect(revealed?.reveal).toBe(true);
    expect(searchRow(state, events)).toBe(
      `looked at the top of their deck — revealed ${nameOf(state, picked[0] as string)} and put it in hand`,
    );
  });
});

describe("D225 — a to-hand search with NO printed reveal, driven, still says nothing", () => {
  const SEED = 4;

  it("fix-onko's Last Wish puts a Basic in hand and the opponent reads only a number", () => {
    let state = driveSetup(SEED, { p1: ONKO_DECK, p2: ONKO_DECK }, { first: "p2" });
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "fix-onko");
    const afterAttack = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    const parked = mustApply(afterAttack, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("Last Wish did not park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const pick = prompt.candidates.slice(0, 1);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: pick },
    });

    const searched = findEvent(events, "DECK_SEARCHED");
    expect(searched?.dest).toBe("hand");
    expect(searched).not.toHaveProperty("reveal");
    expect(Object.keys(searched ?? {}).sort()).toEqual(["dest", "seat", "type", "uids"]);

    const text = searchRow(done, events);
    expect(text).toBe("searched their deck — put 1 card in hand");
    expect(text).not.toContain(nameOf(done, pick[0] as string));
    expect(done.players.p2.hand).toContain(pick[0]);
  });
});

function searchOps(id: string): EffectOp[] {
  const program = programFor(id);
  if (program === undefined) throw new Error(`no program for ${id}`);
  const found: EffectOp[] = [];
  const walk = (ops: readonly EffectOp[] | undefined): void => {
    for (const op of ops ?? []) {
      if (op.op === "searchDeck" || op.op === "lookAtTopN") found.push(op);
      if ("then" in op) walk(op.then);
    }
  };
  walk(program.trainer);
  walk(program.stadium?.ability?.program);
  for (const ability of program.abilities ?? []) walk(ability.program);
  for (const trigger of program.triggered ?? []) walk(trigger.program);
  for (const ops of Object.values(program.attack ?? {})) walk(ops);
  return found;
}

/** The printed-reveal rows, one id per distinct SENTENCE (reprints ride the same
    object and are pinned elsewhere), with the clause each was authored from. */
const REVEALING: readonly [id: string, printed: string][] = [
  ["sv01-166", "Arven — an Item card and a Pokémon Tool card, reveal them"],
  ["sv01-172", "Energy Search — 'reveal it, and put it into your hand'"],
  ["sv01-175", "Jacq — 'reveal them'"],
  ["sv02-061", "Chien-Pao ex 'Shivery Chill' (Ability) — 'reveal them'"],
  ["sv01-178", "Mesagoza (Stadium, inside a coinFlipGate) — 'reveals it'"],
  ["sv03-196", "Town Store (Stadium) — 'reveal it'"],
  ["sv02-170", "Flamigo 'Insta-Flock' (onPlayToBench trigger) — 'reveal them'"],
  ["sv01-196", "Ultra Ball — 'reveal it'"],
  ["sv06.5-096", "Earthen Vessel — 'reveal them'"],
  ["sv01-185", "Poké Ball (inside a coinFlipGate) — 'reveal it'"],
  ["sv05-153", "Master Ball — 'reveal it'"],
  ["sv08.5-131", "Treasure Tracker — 'reveal them'"],
  ["sv10-103", "Cynthia's Gabite 'Champion's Call' (Ability) — 'reveal it'"],
  ["sv10-050", "Misty's Lapras 'Swim Together' (attack 0) — 'reveal them'"],
  ["sv10-169", "Spikemuth Gym (Stadium, EITHER player) — 'reveal it'"],
  ["sv10-177", "Team Rocket's Proton — 'reveal them' (D224's unpaid clause)"],
  ["sv10-176", "Team Rocket's Petrel — 'reveal it, and put it into your hand'"],
  ["sv02-183", "Great Ball (lookAtTopN) — 'You may reveal a Pokémon you find there'"],
  ["sv01-186", "Pokégear 3.0 (lookAtTopN) — 'You may reveal a Supporter card …'"],
  ["svp-118", "Tatsugiri 'Attract Customers' (Ability, lookAtTopN) — 'reveal a Supporter card'"],
  [
    "fix-metallicsignal",
    "Genesect ex 'Metallic Signal' (Ability, FIXTURE of sv10.5b-067) — 'reveal them'",
  ],
  ["fix-callbell", "Call Bell (Item, FIXTURE of sv08-165) — 'reveal it'"],
  ["fix-drayton", "Drayton (Supporter, FIXTURE of sv08-174) — 'You may reveal a … and a …'"],
  ["sv08.5-127", "Roto-Stick (lookAtTopN) — 'You may reveal any number of Supporter cards'"],
  ["sv06-143", "Bug Catching Set (lookAtTopN) — 'You may reveal up to 2 in any combination of …'"],
  [
    "sv08.5-115",
    "Larry's Skill (searchDeck, 3 nouns) — 'reveal them, and put them into your hand'",
  ],
  ["sv06-163", "Secret Box (searchDeck, 4 nouns) — 'reveal them, and put them into your hand'"],
  [
    "sv10-165",
    "Ethan's Adventure (searchDeck, flat cap over a union) — 'reveal them, and put them into your hand'",
  ],
  [
    "sv10.5w-019",
    "Heatmor 'Licking Catch' (searchDeck on an ATTACK, flat cap over a TYPED union) — 'reveal them, and put them into your hand'",
  ],
  [
    "sv07-118",
    "Fan Rotom 'Fan Call' (searchDeck on an ABILITY, typed + HP-capped filter) — 'search your deck for up to 3 {C} Pokémon with 100 HP or less, REVEAL THEM, and put them into your hand'",
  ],
  [
    "sv09-079",
    "Mamoswine ex 'Mammoth Hauler' (Ability) — 'search your deck for a Pokémon, reveal it'",
  ],
  [
    "sv05-017",
    "Sawsbuck 'Changing Seasons' (Ability) — 'search your deck for a Stadium card, reveal it'",
  ],
  [
    "sv10-033",
    "Ethan's Quilava 'Bonded by the Journey' (Ability) — 'search your deck for an Ethan's Adventure card, reveal it'",
  ],
  ["sv10.5w-084", "Hilda — 'an Evolution Pokémon and an Energy card, reveal them'"],
  ["sv06.5-057", "Colress's Tenacity — 'a Stadium card and an Energy card, reveal them'"],
  ["sv08-170", "Cyrano — 'up to 3 Pokémon ex, reveal them'"],
  ["sv06-152", "Hyper Aroma — 'up to 3 Stage 1 Pokémon, reveal them'"],
  [
    "sv10-178",
    "Team Rocket's Transceiver — 'a Supporter card that has \"Team Rocket\" in its name, reveal it'",
  ],
  [
    "sv08-176",
    "Energy Search Pro — 'any number of Basic Energy cards of different types, reveal them'",
  ],
  ["sv05-143", "Boxed Order — 'up to 2 Item cards, reveal them' (then the turn ends)"],
  [
    "sv10-175",
    "Team Rocket's Great Ball — 'an Evolution / a Basic Team Rocket's Pokémon, reveal it' (both faces)",
  ],
  [
    "sv10-181",
    "TM Machine — 'up to 3 Pokémon Tool cards that have \"Technical Machine\" in their name, reveal them'",
  ],
  ["sv08-175", "Dusk Ball — 'Look at the bottom 7 … You may reveal a Pokémon you find there'"],
  [
    "sv06-160",
    "Perrin — 'search your deck for up to that many Pokémon, reveal them' (behind its recordGate)",
  ],
  ["sv07-133", "Crispin — 'up to 2 Basic Energy cards of different types, reveal them'"],
  [
    "sv06-156",
    "Love Ball — 'a Pokémon with the same name as 1 of your opponent's Pokémon in play, reveal it'",
  ],
  ["sv09-146", "Brock's Scouting — 'up to 2 Basic Pokémon or 1 Evolution Pokémon, reveal them'"],
  ["sv06-142", "Accompanying Flute — 'Reveal the top 5 cards of your opponent's deck'"],
  ["sv08-189", "Tera Orb — 'a Tera Pokémon, reveal it'"],
  [
    "sv07-115",
    "Noctowl 'Jewel Seeker' — 'up to 2 Trainer cards, reveal them' (behind its conditionGate)",
  ],
  ["me03-036", "Aromatisse 'Scent Collection' (Ability) — 'reveal them'"],
  ["me02-089", "Firebreather — 'up to 7 Basic {R} Energy cards, reveal them'"],
  ["me01-116", "Fighting Gong — 'a Basic {F} Energy card or a Basic {F} Pokémon, reveal it'"],
  ["me02.5-198", "Poké Pad — 'a Pokémon that doesn't have a Rule Box, reveal it'"],
  ["me02.5-185", "Canari — 'up to 4 {L} Pokémon, reveal them'"],
  ["me05-070", "Silvally 'Call a Buddy' (Ability) — 'a Supporter card, reveal it'"],
  [
    "me02.5-007",
    "Erika's Tangela 'Gathering of Blossoms' (Ability) — 'an Erika's Pokémon, reveal it'",
  ],
  ["30th-008", "Vivillon 'Guiding Dance' (Ability) — 'If heads, … a Pokémon, reveal it'"],
  ["me01-121", "Mega Signal — 'a Mega Evolution Pokémon ex, reveal it'"],
  ["me02.5-151", "Dragonair 'Evolutionary Guidance' (Ability) — 'an Evolution Pokémon, reveal it'"],
  [
    "me02-087",
    "Dawn (Supporter) — 'a Basic Pokémon, a Stage 1 Pokémon, and a Stage 2 Pokémon, reveal them'",
  ],
  [
    "me03-062",
    "Meowth ex 'Last-Ditch Catch' (Ability) — 'a Supporter card, reveal it, and put it into your hand'",
  ],
];

const NOT_REVEALING: readonly [id: string, why: string][] = [
  [
    "sv01-081",
    "Miraidon ex Tandem Unit — Basic Lightning Pokémon onto the Bench; no reveal printed",
  ],
  ["sv01-181", "Nest Ball — 'put it onto your Bench', no reveal printed"],
  ["sv02-171", "Artazon (Stadium) — onto the Bench"],
  ["sv09-147", "Hop's Bag — onto the Bench"],
  ["sv10-083", "Steven's Baltoy 'Summoning Sign' (attack 0) — onto the Bench"],
  ["sv09-068", "Lillie's Comfey 'Inviting Flowers' (attack 0) — onto the Bench"],
  ["fix-onko", "FIXTURE 'Last Wish' — synthetic, no printed sentence (the driven control)"],
  ["fix-pilescan", "FIXTURE — synthetic filter demonstrator, no printed sentence"],
  [
    "sv05-147",
    "Explorer's Guidance (lookAtTopN) — 'put 2 of them into your hand', a MANDATORY take and no reveal printed",
  ],
  [
    "sv06-129",
    "Drakloak 'Recon Directive' (lookAtTopN, ABILITY) — 'put 1 of them into your hand', mandatory, no reveal printed",
  ],
  ["sv04-172", "Rika (lookAtTopN) — 'put 2 of them into your hand', mandatory, no reveal printed"],
  [
    "sv08-158",
    "Maushold 'Familial March' (attack 0) — 'put them onto your Bench', no reveal printed",
  ],
  [
    "sv06-072",
    "Morpeko 'Snack Seek' (lookAtTopN, ABILITY) — 'You may discard that card', a declinable one-card look into the OPEN pile, no reveal printed",
  ],
  [
    "sv06-151",
    "Hassel (lookAtTopN 8, up to 3 to hand) — 'Look at the top 8 cards of your deck and put up to 3 of them into your hand.' A LOOK is private by construction; no reveal printed",
  ],
  [
    "sv05-144",
    "Buddy-Buddy Poffin (searchDeck to BENCH, basicPokemon maxHp 70, max 2) — 'put them onto your Bench', no reveal printed. The table's bench rule again: the move is public by itself",
  ],
  [
    "sv07-011",
    "Eldegoss 'Breezy Gift' (searchDeck on an ATTACK, anyCard to hand, max 3) — 'search your deck for up to 3 cards and put them into your hand', no reveal printed",
  ],
  [
    "sv05-145",
    "Ciphermaniac's Codebreaking (searchDeck anyCard, exact, dest deckTop) — 'Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order.' No reveal printed, and the cards go to a FACE-DOWN zone",
  ],
  [
    "sv08-185",
    "Precious Trolley — 'any number of Basic Pokémon and put them onto your Bench', no reveal printed",
  ],
  [
    "sv06.5-056",
    "Cassiopeia — 'Search your deck for up to 2 cards and put them into your hand', no reveal printed",
  ],
  [
    "sv08-164",
    "Brilliant Blender — 'Search your deck for up to 5 cards and discard them', no reveal printed (public pile)",
  ],
  [
    "sv05-085",
    "Drilbur 'Dig Dig Dig' — 'up to 3 Basic {F} Energy cards and discard them', no reveal printed (public pile)",
  ],
  [
    "sv10-125",
    "Team Rocket's Koffing 'Smog Signals' — 'put them onto your Bench', no reveal printed (a bench move)",
  ],
  [
    "sv06-015",
    "Thwackey 'Boom Boom Groove' — 'a card and put it into your hand', no reveal printed",
  ],
  [
    "sv06-132",
    "Farfetch'd 'Impromptu Carrier' — 'a Pokémon Tool card and attach it to this Pokémon', no reveal printed",
  ],
  [
    "sv08-162",
    "Amulet of Hope — 'search your deck for up to 3 cards and put them into your hand', no reveal printed",
  ],
  [
    "me01-017",
    "Ninjask 'Cast-Off Shell' — 'a Shedinja and put it onto your Bench', no reveal printed (a bench move)",
  ],
  [
    "me02.5-012",
    "Silcoon 'Multiplying Cocoon' — 'a Silcoon or a Cascoon and put it onto your Bench', no reveal printed (a bench move)",
  ],
  [
    "me02.5-143",
    "Pecharunt 'Final Chain' — 'search your deck for a card and put it into your hand', no reveal printed",
  ],
  ["me03-077", "Lumiose City (Stadium) — a Basic Pokémon onto the Bench, no reveal printed"],
  ["me05-076", "Fossil Quarry (Stadium) — up to 2 Antique Items onto the Bench, no reveal printed"],
  [
    "me04-051",
    "Crobat 'Nighttime Maneuvers' (Ability) — 'a card … put that card on top of it', no reveal printed (a FACE-DOWN zone)",
  ],
  [
    "me02-090",
    "Grimsley's Move (Supporter) — 'put a {D} Pokémon you find there onto your Bench', no reveal printed (a bench move)",
  ],
];

describe("D225 — which registry rows carry the rider", () => {
  it("every printed row in the table spells `reveal: true`, on all five surfaces", () => {
    for (const [id, printed] of REVEALING) {
      const ops = searchOps(id);
      expect(ops, `${id} (${printed}) has no search op`).toHaveLength(1);
      expect(ops[0], `${id} (${printed}) lost its printed reveal`).toMatchObject({ reveal: true });
    }
    expect(REVEALING).toHaveLength(62);
  });

  it("D556 — Team Rocket's Great Ball's TAILS arm (the `otherwise` `searchOps` does not descend) reveals too", () => {
    const gate = programFor("sv10-175")?.trainer?.[0];
    if (gate?.op !== "coinFlipGate") throw new Error("expected Great Ball's coin gate");
    expect(gate.then).toHaveLength(1);
    expect(gate.otherwise).toHaveLength(1);
    expect(gate.then[0]).toMatchObject({ op: "searchDeck", reveal: true });
    expect(gate.otherwise?.[0]).toMatchObject({ op: "searchDeck", reveal: true });
  });

  it("no bench search and no fixture carries it — absent, not `false` (D135)", () => {
    for (const [id, why] of NOT_REVEALING) {
      const ops = searchOps(id);
      expect(ops, `${id} (${why}) has no search op`).toHaveLength(1);
      expect(ops[0], `${id} (${why}) grew a reveal it does not print`).not.toHaveProperty("reveal");
    }
    expect(NOT_REVEALING).toHaveLength(32);
  });

  it("SWEEPS THE REGISTRY for search ops nobody classified — a DISCOVERED census", () => {
    const population = [...new Set([...registryCardIds(), ...Object.keys(FIXTURE_POOL)])];
    const classified = new Set([...REVEALING, ...NOT_REVEALING].map(([id]) => programFor(id)));
    const unclassified = new Set<string>();
    const swept = new Set<string>();
    for (const id of population) {
      const program = programFor(id);
      if (program === undefined || searchOps(id).length === 0) continue;
      swept.add(id);
      if (!classified.has(program)) unclassified.add(id);
    }
    expect([...unclassified].sort(), "a deck search nobody decided the reveal for").toEqual([]);
    expect(classified.size).toBe(94);
    expect(swept.size).toBe(219);
  });
});
