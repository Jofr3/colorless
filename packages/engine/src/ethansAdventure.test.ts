import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  ETHANS_ADVENTURE_DECK,
  FIXTURE_POOL,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
} from "./testFixtures";

// D337 — ETHAN'S ADVENTURE `sv10-165`/`-221`/`-236`, THE FLAT CAP OVER AN
// OWNER-PREFIXED UNION, AND THE FIRST INHERITED PRICE IN SEVEN SLICES THAT WAS
// TRUE IN THE CLAUSE IT WAS FLAGGED ON.
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   "Search your deck for **up to 3 in any combination of Ethan's Pokémon and
//    Basic {R} Energy cards**, reveal them, and put them into your hand. Then,
//    shuffle your deck."
//   Supporter, **3 Standard-legal printings on one byte-identical `effect`**.
//
// ── THE CENSUS, RE-RUN AT THIS HEAD OVER ALL THREE TEXT COLUMNS ─────────────
// Every figure re-queried against remote D1 `luminous` (3,786 rows, 2,021
// `legal_standard`) on 2026-08-14 rather than inherited from the work order, and
// every per-column split re-added against its own total.
//
//   (a) THE GRAMMAR — `instr(<col>,'in any combination of') > 0`:
//         `effect`         15 rows / 10 legal
//         `attacks_json`    4 rows /  3 legal
//         `abilities_json`  0 rows /  0 legal
//       TOTAL 19 printings / 13 legal.  15 + 4 + 0 = 19 ✅  10 + 3 + 0 = 13 ✅
//
//   (b) 🛑 THE GRAMMAR *UNDER THIS OP* — the widened form that decided the row,
//       `instr(<col>,'earch your deck for') > 0 AND
//        instr(<col>,'in any combination of') > 0`:
//         `effect`          3 rows / 3 legal — Ethan's Adventure ×3
//         `attacks_json`    3 rows / 3 legal — Heatmor ×2, Maushold ×1
//         `abilities_json`  0 rows / 0 legal
//       TOTAL 6 printings / 6 legal.  3 + 3 + 0 = 6 ✅  3 + 3 + 0 = 6 ✅
//
//       **SO THE SENTENCE IS NOT A TRAINER SENTENCE — HALF ITS PRINTINGS ARE
//       ATTACKS**, and the work order named only the `effect` half:
//
//         surface | printings | legal | noun                     | card
//         effect  |     3     |   3   | `Ethan's Pokémon`        | Ethan's Adventure
//         attacks |     2     |   2   | `{R} Pokémon`            | Heatmor `sv10.5w-019`/`-104`
//         attacks |     1     |   1   | `Maushold`/`Maushold ex` | Maushold `sv08-158`
//       3 + 2 + 1 = 6 ✅   and all six are `legal_standard = 1`.
//
//   🆕 **HEATMOR IS THIS ROW'S SENTENCE WITH ONE NOUN CHANGED AND IT IS NOT
//   BUILT HERE.** *"Search your deck for up to 3 in any combination of **{R}
//   Pokémon** and Basic {R} Energy cards, reveal them, and put them into your
//   hand. Then, shuffle your deck."* — same op, same flat `max: 3`, same
//   `dest: "hand"`, same printed reveal, same trailing shuffle, and
//   `anyOf[typedPokemon{Fire}, basicEnergy{Fire}]` in place of this row's
//   `anyOf[ownerPokemon{Ethan}, basicEnergy{Fire}]`. It is deliberately left for
//   a successor because it moves `BUILT.attack`, which swaps the whole
//   thirteen-reader census set for the ATTACK thirteen — a different slice, not a
//   wider one. `effects.ts`'s refused-noun list already counts it ("(2)").
//
//   ⚠️ AND THE NEAR MISS IS THE ONE THE WORK ORDER ITSELF SPELLS. `also` (D336)
//   is one cap PER NOUN; this is ONE FLAT cap over a UNION. The two printed
//   sentences are one clause apart and mean OPPOSITE things about a legal answer:
//   `also` here would refuse the three-Ethan's-Pokémon take this card explicitly
//   permits, and a flat cap on Larry's Skill would permit the three Pokémon that
//   card explicitly refuses. §3 below drives that answer.
//
// ── 🛑 THE PRICE, AND THE CLAUSE IT WAS FLAGGED ON ──────────────────────────
// The resume point priced this row as ZERO engine diff and flagged **the
// caption** as the clause most likely to be false, on the ground that
// `retrieveNoun`'s `anyOf` arm joins `" or "` where the card prints "and".
//
// ✅ **THE FLAG WAS DISCHARGED BY READING, AND THE PRICE HELD.** The joiner
// disagreement is the ESTABLISHED READING, settled at D264 and inherited at D333
// — Lana's Aid `sv06-155`/`-207`/`-219` and Bug Catching Set
// `sv06-143`/`sv08.5-102` BOTH print this very "in any combination of … and …"
// grammar and BOTH caption " or ", each asserted byte for byte in its own suite.
// This row is the THIRD witness, not a new decision. `searchNote`'s SINGLE-group
// arm is the pre-D336 function byte for byte and reads `retrieveNoun` without
// knowing a filter kind exists, so `anyOf` flows through it untouched. The LOG
// side was grepped too and is card-keyed: `DECK_SEARCHED` carries
// `{seat, dest, uids, reveal}` and names CARDS, never a filter noun.
//
// 🛑 **WHAT THE SLICE ACTUALLY COST WAS THE FIXTURE POOL**, which no clause of
// the price mentioned: `grep -n "Ethan" testFixtures.ts` returned ZERO at head,
// so the `ownerPokemon{owner: "Ethan"}` arm had nothing to admit and nothing to
// refuse. FOUR Pokémon bodies buy both directions, and their NAMES are the
// printed ones (re-queried, `name LIKE 'Ethan''s %'`) because the filter's second
// conjunct reads the name.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ETHANS_ADVENTURE_DECK, p2: ETHANS_ADVENTURE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The uids in p1's DECK carrying `id`. The deck is the whole search zone, so —
    unlike the look-at-top family — no window needs seeding: what is in the deck
    is what is offered. D336's helper, transferred. */
function deckUids(state: GameState, id: string): string[] {
  return state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === id);
}

/** Play `id` out of p1's hand and return the parked chooseCards prompt with it.
    Neither this card nor the Energy Search control carries a cost op, so the
    FIRST park is the search in both cases. */
function play(state: GameState, id: string) {
  const withCard = handFromDeck(state, "p1", id, 1);
  const uid = handUid(withCard, "p1", id);
  const { state: parked, events } = mustApply(withCard, {
    type: "playTrainer",
    seat: "p1",
    uid,
  });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { parked, prompt: parked.phase.prompt, events, seeded: withCard };
}

const ETHANS_ADVENTURE_IDS = ["sv10-165", "sv10-221", "sv10-236"] as const;

describe("D337 — Ethan's Adventure, a flat cap over an owner-prefixed union", () => {
  // ── §1 THE PRINTED SHAPE, READ OFF THE REGISTRY BEFORE ANY BOARD RUNS ──────

  it("the registry resolves a program for all THREE printings AND for the demonstrator", () => {
    for (const id of ETHANS_ADVENTURE_IDS) expect(programFor(id), id).toBeDefined();
    expect(programFor("fix-ethansadventure")).toBeDefined();
  });

  it("the three printings share ONE program object — reprints, not three authorings", () => {
    const first = programFor("sv10-165");
    for (const id of ETHANS_ADVENTURE_IDS) expect(programFor(id), id).toBe(first);
    expect(programFor("fix-ethansadventure")).toBe(first);
  });

  it("🛑 the program is `anyOf` under a FLAT cap — and carries NO `also`", () => {
    // 🛑 THE FIELD THE SIBLING SENTENCE WANTS AND THIS ONE MUST NOT HAVE. D336
    // shipped `searchDeck.also` one slice ago; an author reaching for "several
    // nouns, one search" now finds it first. `toEqual` is exact, so an `also`
    // added here goes red on this line rather than on a subtle answer four cases
    // down — and the explicit `undefined` check names the field out loud.
    const op = programFor("fix-ethansadventure")?.trainer?.[0];
    if (op?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    expect(op).toEqual({
      op: "searchDeck",
      filter: {
        kind: "anyOf",
        filters: [
          { kind: "ownerPokemon", owner: "Ethan" },
          { kind: "basicEnergy", energyType: "Fire" },
        ],
      },
      dest: "hand",
      max: 3,
      reveal: true,
    });
    expect(op.also).toBeUndefined();
  });

  it("the row is TWO ops and the second is the printed trailing shuffle", () => {
    const program = programFor("fix-ethansadventure");
    expect(program?.trainer).toHaveLength(2);
    expect(program?.trainer?.[1]).toEqual({ op: "shuffleDeck" });
  });

  it("🛑 the `ownerPokemon` member carries NO `stage` — the print names none", () => {
    // The rider a plausible build adds and the print does not carry. It is
    // asserted on the FILTER as well as driven on a board (§2) because the two
    // failures look different: a `stage: "basic"` here silently refuses Ethan's
    // Typhlosion, and a board that happened to hold no Ethan's Evolution would
    // never notice.
    const op = programFor("fix-ethansadventure")?.trainer?.[0];
    if (op?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    if (op.filter.kind !== "anyOf") throw new Error("expected an anyOf filter");
    const [pokemon] = op.filter.filters;
    if (pokemon?.kind !== "ownerPokemon") throw new Error("expected ownerPokemon first");
    expect(pokemon.stage).toBeUndefined();
    expect(pokemon.owner).toBe("Ethan");
  });

  it("the demonstrator carries the printed bytes, and all three printings are Supporters", () => {
    expect(FIXTURE_POOL["fix-ethansadventure"]?.effect).toBe(
      "Search your deck for up to 3 in any combination of Ethan's Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    );
    expect(FIXTURE_POOL["fix-ethansadventure"]?.trainerType).toBe("Supporter");
  });

  // ── §2 THE UNION — WHAT IT ADMITS AND WHAT IT REFUSES ─────────────────────

  it("🛑 offers BOTH members — an Ethan's Pokémon and a Basic {R} Energy", () => {
    const state = board(3);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).toContain(deckUids(parked, "fix-ethans-cyndaquil")[0]);
    expect(prompt.candidates).toContain(deckUids(parked, "fix-fire-energy")[0]);
  });

  it("🛑 admits an Ethan's STAGE 2 — the printed noun carries no stage", () => {
    const state = board(4);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).toContain(deckUids(parked, "fix-ethans-typhlosion")[0]);
  });

  it("🛑 admits an Ethan's {L} Pokémon — the noun is OWNER-narrowed, not TYPE-narrowed", () => {
    // 🛑 THE CASE THAT SEPARATES THIS CARD FROM HEATMOR. The union's Energy
    // member is narrowed by the printed `{R}`; its Pokémon member is narrowed by
    // the printed possessive and by NOTHING ELSE. A build that let the type leak
    // across the members refuses this Pokémon and stays green everywhere else in
    // this file.
    const state = board(5);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).toContain(deckUids(parked, "fix-ethans-pichu")[0]);
  });

  it("🛑 REFUSES a {R} Pokémon with no owner prefix — one printed word apart", () => {
    const state = board(6);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    // Same category, same stage, same type as `fix-ethans-cyndaquil`; the ONLY
    // difference is the printed possessive.
    expect(prompt.candidates).not.toContain(deckUids(parked, "fix-plain-cyndaquil")[0]);
  });

  it("🛑 REFUSES a Basic Energy of another type — the printed {R} on the second member", () => {
    const state = board(7);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).not.toContain(deckUids(parked, "fix-grass-energy")[0]);
  });

  it("🛑 REFUSES a SPECIAL Energy — the printed \"Basic\"", () => {
    const state = board(8);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).not.toContain(deckUids(parked, "fix-special")[0]);
  });

  it("🛑 REFUSES an owner-prefixed NON-Pokémon — `ownerPokemon`'s category conjunct", () => {
    // 🛑 THE CONJUNCT'S PRINTED WITNESS. Team Rocket's Energy `sv10-182` carries
    // a possessive prefix and is not a Pokémon, and the sentence that names the
    // subgroup is printed on that very card. A build that matched the possessive
    // on the NAME alone would hand this back as an "Ethan's Pokémon" the day the
    // Ethan's equivalent is printed — and this row's own union is where it would
    // land, since the second member is Energy too.
    const state = board(9);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).not.toContain(deckUids(parked, "fix-tr-energy")[0]);
  });

  it("🛑 the ATTRIBUTION CONTROL — Energy Search offers what this card refuses", () => {
    // 🛑 THE SAME OP, THE SAME DESTINATION, THE SAME PRINTED REVEAL, ONE DECK,
    // OPPOSITE VERDICTS. Energy Search `sv01-172` is `searchDeck` over an
    // UNTYPED `basicEnergy` at `max: 1` with no cost. It offers the {G} Energy
    // this card refuses — so "the union narrowed correctly" and "the deck holds
    // little else" are told apart — and it offers no Pokémon at all, which is the
    // other half of the same control.
    const state = board(10);
    const { prompt, parked } = play(state, "sv01-172");
    expect(prompt.candidates).toContain(deckUids(parked, "fix-grass-energy")[0]);
    expect(prompt.candidates).toContain(deckUids(parked, "fix-fire-energy")[0]);
    expect(prompt.candidates).not.toContain(deckUids(parked, "fix-ethans-cyndaquil")[0]);
    expect(prompt.max).toBe(1);
  });

  // ── §3 THE FLAT CAP — "IN ANY COMBINATION", NOT "ONE OF EACH" ─────────────

  it("🛑 the cap is a FLAT 3 over the whole union, and carries no per-group caps", () => {
    const state = board(11);
    const { prompt } = play(state, "fix-ethansadventure");
    expect(prompt.max).toBe(3);
    // D336 gave `chooseCards` a LIST of caps for the per-noun grammar. This
    // sentence must park WITHOUT one: a cap list here is the `also` build, and it
    // would refuse the answer the very next case takes.
    expect(prompt.caps ?? []).toEqual([]);
  });

  it("🛑 THREE ETHAN'S POKÉMON IS A LEGAL ANSWER — \"in any combination\", not \"one of each\"", () => {
    // 🛑 THE CASE THE `also` BUILD FAILS. Three cards of ONE member, taken
    // against a flat total of three — the answer the card explicitly permits and
    // a per-noun cap of 1 explicitly refuses. It is driven over THREE DISTINCT
    // PRINTINGS rather than three copies of one id (D328's §7: a cap tested over
    // interchangeable copies cannot name which card was offered).
    const state = board(12);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const b = deckUids(parked, "fix-ethans-typhlosion")[0] as string;
    const c = deckUids(parked, "fix-ethans-pichu")[0] as string;
    expect(new Set([a, b, c]).size).toBe(3);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [a, b, c] },
    });

    expect(done.phase.kind).toBe("turn:action");
    for (const uid of [a, b, c]) {
      expect(done.players.p1.hand).toContain(uid);
      expect(done.players.p1.deck).not.toContain(uid);
    }
    const searched = find(events, "DECK_SEARCHED");
    expect(searched?.reveal).toBe(true);
    expect(new Set(searched?.uids)).toEqual(new Set([a, b, c]));
  });

  it("🛑 THREE BASIC {R} ENERGY IS ALSO LEGAL — the union's OTHER member, alone", () => {
    // The mirror of the case above, and it is not decoration: a build that capped
    // the FIRST member at 3 and the second at 0 would pass that case and fail
    // this one. Three copies of one printing is the only form available here —
    // the deck holds exactly one Basic {R} Energy printing — and that is stated
    // rather than glossed.
    const state = board(13);
    const { parked } = play(state, "fix-ethansadventure");
    const energy = deckUids(parked, "fix-fire-energy").slice(0, 3);
    expect(energy).toHaveLength(3);

    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: energy },
    });
    expect(done.phase.kind).toBe("turn:action");
    for (const uid of energy) expect(done.players.p1.hand).toContain(uid);
  });

  it("🛑 A MIXTURE IS LEGAL — two Pokémon and one Energy, the printed grammar", () => {
    const state = board(14);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const b = deckUids(parked, "fix-ethans-pichu")[0] as string;
    const e = deckUids(parked, "fix-fire-energy")[0] as string;

    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [a, b, e] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand).toContain(a);
    expect(done.players.p1.hand).toContain(b);
    expect(done.players.p1.hand).toContain(e);
  });

  it("🛑 REFUSES a FOURTH card — the flat total is the only thing bounding the answer", () => {
    const state = board(15);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const b = deckUids(parked, "fix-ethans-typhlosion")[0] as string;
    const c = deckUids(parked, "fix-ethans-pichu")[0] as string;
    const d = deckUids(parked, "fix-fire-energy")[0] as string;
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [a, b, c, d] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("🛑 REFUSES a refused card even inside an otherwise legal answer", () => {
    // The union is a filter on EVERY uid in the answer, not a property of the
    // answer's size: two admitted cards plus one refused one is under the cap and
    // must still be rejected.
    const state = board(16);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const e = deckUids(parked, "fix-fire-energy")[0] as string;
    const bad = deckUids(parked, "fix-plain-cyndaquil")[0] as string;
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [a, e, bad] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("takes FEWER than the cap — the printed \"up to\"", () => {
    const state = board(17);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [a] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand).toContain(a);
  });

  it("takes NOTHING — the empty answer the printed \"up to\" also permits", () => {
    const state = board(18);
    const { parked } = play(state, "fix-ethansadventure");
    const handBefore = parked.players.p1.hand.length;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand.length).toBe(handBefore);
  });

  // ── §4 THE CAPTION — THE CLAUSE THE PRICE WAS FLAGGED ON ──────────────────

  it("🛑 the caption joins with \" or \" — the THIRD witness, settled at D264", () => {
    // 🛑 **THE CLAUSE THE WORK ORDER SAID WAS MOST LIKELY FALSE, AND IT IS
    // TRUE.** `retrieveNoun`'s `anyOf` arm joins " or " where this card prints
    // "and", deliberately: the predicate is a union asked about ONE card, and an
    // English "and" between two noun phrases there reads as a conjunction the
    // filter does not mean. Lana's Aid (D264) and Bug Catching Set (D333) print
    // the identical "in any combination of … and …" grammar and caption the
    // identical join, each asserted byte for byte in its own suite. This row
    // inherits the reading rather than changing it.
    //
    // ⚠️ AND THE NOUNS ARE `retrieveNoun`'s OWN, not a second vocabulary: the
    // possessive comes out whole from the `ownerPokemon` arm ("Ethan's Pokémon",
    // invariant in number), and the brace code `{R}` is written out as "Fire" for
    // `typedPokemon`'s stated reason — the rows the player then clicks are card
    // NAMES, so a dialog quoting `{R}` back would be a second vocabulary.
    const state = board(19);
    const { prompt } = play(state, "fix-ethansadventure");
    expect(prompt.note).toBe(
      "Search your deck for up to 3 Ethan's Pokémon or Basic Fire Energy cards into your hand.",
    );
  });

  it("the caption spells NO serial comma — this is the single-group arm", () => {
    // D336's multi-noun arm spells "A, B, and C". This sentence has ONE group, so
    // it must take the arm that predates it — the pluralised single-noun
    // sentence, unmoved. A build that routed `anyOf` through the group join would
    // still read plausibly and would be wrong.
    const state = board(20);
    const { prompt } = play(state, "fix-ethansadventure");
    expect(prompt.note).not.toContain(", and ");
    expect(prompt.note).not.toContain(" and ");
    expect(prompt.note).toContain(" or ");
  });

  // ── §5 THE EPILOGUE — THE PRINTED SHUFFLE AND THE PLAYED CARD ─────────────

  it("the deck is SHUFFLED after the search — the printed \"Then, shuffle your deck\"", () => {
    const state = board(21);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [a] },
    });
    expect(find(events, "SHUFFLE")).toBeDefined();
  });

  it("the Supporter itself is in the DISCARD once the row resolves", () => {
    // `playTrainer` moves the played card to the discard before the program runs
    // — the same fact Ultra Ball's "other cards" relies on. Measured off the
    // PARKED state rather than the seeded one, which is D336's rule: playing the
    // Trainer has already moved it.
    const state = board(22);
    const withCard = handFromDeck(state, "p1", "fix-ethansadventure", 1);
    const uid = handUid(withCard, "p1", "fix-ethansadventure");
    const { state: parked } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
    expect(parked.players.p1.discard).toContain(uid);
  });
});
