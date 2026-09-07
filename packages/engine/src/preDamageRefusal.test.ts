import { describe, expect, it } from "vitest";
import { attackReaderSurface, resolvedByAnyReader } from "./censusAttackCorpus";
import { engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  PRE_DAMAGE_FAMILY_DECK,
  attachFromDeck,
  attachToolFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.331.0 → 0.332.0 — 🆕🆕 D430: ROUTING THE PRE-DAMAGE SEAM THROUGH THE §11 GATE.
//
// 🛑 **THIS IS A CORRECTNESS SLICE AND IT BUYS ZERO NEW PRINTINGS.** Not one sentence
// is claimed, not one reader is added, and every census figure of the built corpus
// stands still. It exists because D429 found a live rules gap, wrote it down in prose,
// and DELIBERATELY DID NOT PIN THE BROKEN BEHAVIOUR — a guard that reddens when
// somebody fixes a defect actively defends the defect (D418). So the fix meets no
// resistance from the suite, and this file is where the corrected rule lands.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 ① **THE DEFECT, EXACTLY.**
//
// `attack.ts`'s `stripPreDamage` — the act all four members of the pre-damage family
// perform — consulted §11's refusal gate NOWHERE. Grepping the whole applier for
// `effectRefused|refused|prevent` at D429's head returned ZERO hits. Meanwhile row
// 74's *"…your opponent's Active Pokémon is now Paralyzed."* goes through the
// interpreter's own `applyStatus`, which HAS asked §11 since D142.
//
// So ONE printed sentence had two effects, one gated and one not — and the board is
// reachable off two real cards today: Klefki `sv01-096` "Joust" (*"Before doing
// damage, discard all Pokémon Tools from your opponent's Active Pokémon."*) into a
// body wearing Mist Energy `sv05-161` (*"Prevent all effects of attacks used by your
// opponent's Pokémon done to the Pokémon this card is attached to. (Existing effects
// are not removed. Damage is not an effect.)"*). The Tool came off anyway.
//
// A discard is an EFFECT of an attack done to a Pokémon. That is the whole argument,
// and the printed parenthetical settles the only plausible objection: damage is not an
// effect, so the shield lets the 10 through and stops the strip.
//
// 🛑 ② **THE PER-ROW SEMANTICS DIFFER, AND ROW 72 IS THE CRUX.**
//
//   · rows 71 / 73 / 74 aim at *"your opponent's Active Pokémon"* — a shield on THAT
//     body refuses them, and §2 drives all three;
//   · **row 72 aims at *"this Pokémon"* — the ATTACKER's own body — and is refusable
//     by NOTHING.** Every §11 printing in the pool names the attack's SOURCE, and
//     every one of them names the holder's OPPONENT (§1 measures this on the
//     population rather than on a specimen). An opponent's Mist Energy is not even on
//     the target; the attacker's OWN Mist Energy is on the target and still does not
//     apply, because the attack is used by its own Pokémon and not by the opponent's.
//     §3 drives both placements.
//
// The rule therefore lives in `effectRefusedOn` as `seat === ctx.seat ⇒ false` on the
// attack channel — the exact guard the TRAINER channel has spelled since D259 — and
// NOT as an `if (seat !== actor)` at the pre-damage call site. A caller re-deciding
// what the funnel owns is D222's second reader, quiet the day a fifth member prints a
// different victim.
//
// 🛑 ③ **AND IF A SELF-STRIP WERE EVER REFUSED, ROW 72's CANCEL WOULD FIRE.** The
// printed *"If you can't discard any, this attack does nothing."* is conditioned on
// the ACT's result, and a refused act discarded none. That falls out of the existing
// `nothing` return and costs no code; it is UNREACHABLE today for the printed reason
// above, so it is stated at the site and NOT tested around — an unreachable branch
// with a guard written for it is the next vacuous test (D205/D206/D208).
//
// 🛑 ④ **NOTHING DOUBLES, AND THE EVENT COUNT IS WHY THE DEFECT HID.** On a shielded
// board row 74 now refuses the STRIP, so `stripPreDamage` reports `tools: 0` and the
// pre-existing `if (stripped.tools === 0) return stripped;` never reaches
// `applyStatus`. Exactly ONE `ATTACK_EFFECT_PREVENTED` is filed — and exactly one was
// filed BEFORE this slice too, for the opposite and wrong reason (the Tool came off
// unrefused, and only the Paralysis was blocked). **The log is identical either way.**
// That is precisely why nothing went red, and why the rung that catches the defect has
// to read the BOARD — the Tool is still attached — rather than the event stream. §4
// asserts both halves.
//
// ⚠️ **THE SIBLING DEFECTS THE FUNNEL LINE FIXED, NAMED SO THEY ARE NOT MISTAKEN FOR
// SCOPE CREEP.** `applyStatus`'s `target: "self"` arm and `preventRetreat` /
// `preventAttack`'s `"self"` arms all ask the gate on their OWN seat. Their doc blocks
// said the self arm "can never be refused in practice", reasoning from the INSTALLED
// block's clock — the only channel that existed at D142. D260 added the AURA channels,
// which carry no clock, so a self-inflicted Special Condition on an attacker wearing
// Mist Energy was being cancelled by the attacker's own card. Both blocks are
// corrected in place and DATED (D423): rotted, not wrong-when-written.
//
// ⚠️ **THE IDS THAT COULD NOT BE RESOLVED ARE NOT INVENTED** (D425). This checkout has
// no D1, so the three cards printing corpus rows 71/72/74 stay unnamed, exactly as
// `preDamageFamily.test.ts` leaves them. `sv05-161` and `sv01-096` ARE named, because
// both are resolvable: Klefki is a real-id fixture (`FIXTURE_POOL["sv01-096"]`, whose
// "Joust" prints row 73 verbatim) and Mist Energy's program is a registry row keyed on
// `sv05-161` that `fix-mist-energy` shares. ⚠️ **THE BRIEF'S CLAIM THAT BOTH IDS ARE
// IN THE FIXTURE POOL IS HALF TRUE**: `sv01-096` is a pool key; `sv05-161` is NOT and
// cannot be, because `catalogManifest.ts` holds no `sv05` row and its generator cannot
// be run here. The demonstrator is `fix-mist-energy`, carrying the printed sentence
// verbatim and mapped to the SAME `MIST_ENERGY` program the real id is.

/** One seed for the whole suite, `preDamageFamily.test.ts`'s reason verbatim: nothing
    here flips a coin and every Active, Tool and Energy is placed by surgery. */
const SEED = 11;

/** `fix-preseam`'s indices — the same body the family suite drives. */
const IDX = { purge: 0, pry: 1, shed: 2, lock: 3, plain: 4, loud: 5 } as const;

const CHESTPLATE = "sv01-192"; // Tool: −30 after W/R on an {F} holder
const BAND = "sv01-197"; // Tool: the ATTACKER's own +10, before W/R
const MIST = "fix-mist-energy"; // Special Energy: §11 — "prevent all effects of attacks"
const THERAPEUTIC = "sv02-193"; // Special Energy: §12 — the holder can't be Paralyzed
const BASIC = "fix-energy"; // Basic Energy: the card-class control

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

/** `preDamageFamily.test.ts`'s board, verbatim: `fix-preseam` Active for `seat`,
    `fix-seamwall` opposite, two Colorless on the attacker, the turn handed to `seat`. */
function board(seat: Seat = "p1"): GameState {
  const decks = { p1: PRE_DAMAGE_FAMILY_DECK, p2: PRE_DAMAGE_FAMILY_DECK };
  let state = driveSetup(SEED, decks, { first: other(seat) });
  state = setActiveFromDeck(state, seat, "fix-preseam");
  state = setActiveFromDeck(state, other(seat), "fix-seamwall");
  state = attachFromDeck(state, seat, BASIC, 2);
  return mustApply(state, { type: "endTurn", seat: other(seat) }).state;
}

/** 🛑 **THE ONE-AXIS PAIR THIS WHOLE SUITE TURNS ON (D427).** The defender wears a
    Rock Chestplate either way; `shielded` adds a Mist Energy and changes NOTHING else.
    Same seed, same bodies, same Tool, same attack — one attached card apart. */
function tooled(seat: Seat = "p1"): GameState {
  return attachToolFromDeck(board(seat), other(seat), "active", CHESTPLATE);
}
function shielded(seat: Seat = "p1"): GameState {
  return attachFromDeck(tooled(seat), other(seat), MIST, 1);
}

function swing(
  state: GameState,
  index: number,
  seat: Seat = "p1",
): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat, index });
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((event) => event.type === type) as
    | Extract<GameEvent, { type: T }>
    | undefined;
}

function count(events: GameEvent[], type: GameEvent["type"]): number {
  return events.filter((event) => event.type === type).length;
}

/** What §8.5 said it dealt to the defending Active. */
function dealt(events: GameEvent[]): number | undefined {
  return find(events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — 🛑 THE POPULATION: what "refused" can mean, measured rather than asserted.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — every §11 printing names the OPPONENT as the attack's source", () => {
  /** Every distinct printed sentence in `FIXTURE_POOL` that talks about preventing the
      EFFECTS of attacks — swept across all three text carriers a fixture can hold
      (`effect` for Energy and Trainer cards, `abilities[].effect`, `attacks[].effect`),
      because a census is as narrow as the columns its query names (D310) and this one
      is the warrant for a rule in `interpreter.ts`.

      ⚠️ **THE PATTERN IS PUBLISHED SO ITS EDGES ARE VISIBLE (D424/D425).** It is
      `/effects of attacks/` — the loosest shape the family is spelled in, deliberately
      shorter than "Prevent all effects of attacks" so that the two printed word orders
      (*"prevent all effects of attacks"* and *"prevent all damage from and effects of
      attacks"*) and any future *"…the effects of attacks…"* all land in it. What it
      CANNOT see: a printing that says "effect of an attack" in the singular, or that
      spells the rule without the word "attacks" at all. */
  const SHIELD = /effects of attacks/;
  const shieldSentences: { id: string; where: string; text: string }[] = [];
  for (const [id, card] of Object.entries(FIXTURE_POOL)) {
    const carriers: [string, string | null | undefined][] = [
      ["effect", card.effect],
      ...(card.abilities ?? []).map(
        (ability, i): [string, string | null | undefined] => [`abilities[${i}]`, ability.effect],
      ),
      ...(card.attacks ?? []).map(
        (attack, i): [string, string | null | undefined] => [`attacks[${i}]`, attack.effect],
      ),
    ];
    for (const [where, text] of carriers) {
      if (typeof text === "string" && SHIELD.test(text)) shieldSentences.push({ id, where, text });
    }
  }

  /** The two ways a printing can restrict itself to the opponent, spelled as the
      corpus spells them. ⚠️ **THE SOURCE CLASS IS `(?:used by|from|by) your opponent's
      Pokémon` AND NOT A BARE `opponent`, WHICH IS THE WHOLE POINT OF THIS RUNG.** A
      bare `/opponent/` passes on `sv03-004` — *"…during your **opponent's** next turn,
      prevent all damage from and effects of attacks done to this Pokémon."* — which
      carries NO source clause at all and would have made a true assertion stand in for
      a false claim (D423's exact shape, caught here by reading all eight hits rather
      than by trusting the first green). */
  const SOURCE = /(?:used by|from|by) your opponent's Pokémon/;
  const CLOCK = /your opponent's next turn/;

  it("🛑 the sweep is NON-EMPTY and both disjuncts have witnesses", () => {
    // D200→D214's rule: an "every X has property P" assertion over an EMPTY set is
    // green forever, and so is one where every member takes the same easy arm. Floors
    // rather than frozen counts, so a slice adding a §11 fixture need not touch this
    // file. Measured at this head: EIGHT sentences — six carrying a SOURCE clause
    // (`fix-mist-energy`, `fix-mightyshell`, `fix-teaparty`, `fix-spherical`,
    // `fix-unaware`, `fix-repellingveil`), two in the ATTACK column carrying the CLOCK
    // (`sv03-004`, `sv03-145`), and `sv03-145` carrying both.
    expect(shieldSentences.length).toBeGreaterThanOrEqual(8);
    expect(shieldSentences.filter(({ text }) => SOURCE.test(text)).length).toBeGreaterThanOrEqual(6);
    expect(shieldSentences.filter(({ text }) => CLOCK.test(text)).length).toBeGreaterThanOrEqual(2);
    expect(
      shieldSentences.filter(({ text }) => CLOCK.test(text) && !SOURCE.test(text)).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("🛑 EVERY ONE of them is confined to the opponent — the FALSIFIER for the rule", () => {
    // 🛑 **THIS IS THE EXECUTABLE FALSIFIER FOR `effectRefusedOn`'s OWN-SIDE RULE
    // (D428).** That line answers `false` whenever the effect's target is the
    // attacker's own side, and its entire warrant is that no §11 printing in the pool
    // can be true of an attack used by the holder's OWN Pokémon — either because it
    // names the opponent as the SOURCE, or because it is only live during the
    // opponent's turn. Pinned on the POPULATION and not on a specimen (D423): the day
    // a §11 sentence lands with neither restriction, this goes RED and the funnel's
    // rule has to be re-derived before that fixture can be committed.
    for (const { id, where, text } of shieldSentences) {
      expect(SOURCE.test(text) || CLOCK.test(text), `${id} ${where}`).toBe(true);
    }
  });

  it("⚠️ the CLOCK-only printings are exactly the INSTALLED ones, in the ATTACK column", () => {
    // The two disjuncts are not interchangeable and this rung says which is which. An
    // AURA (`passivesOf`) has no duration, so it MUST carry a source clause or it
    // would be true of its holder's own attacks; an INSTALLED block (`attackBlockOf`)
    // is stamped `turn: state.turn + 1` on its installer's own turn and read under
    // `block.turn !== state.turn`, so it is live on exactly the opponent's next turn
    // and structurally cannot be live on its holder's own — which is why `sv03-004`
    // may print no source clause and still be confined.
    for (const { id, where, text } of shieldSentences) {
      if (where.startsWith("attacks")) expect(CLOCK.test(text), `${id} ${where}`).toBe(true);
      else expect(SOURCE.test(text), `${id} ${where}`).toBe(true);
    }
  });

  it("🛑 ZERO NEW PRINTINGS — the reader surface and all four family sentences stand still", () => {
    // 🛑 **THE SLICE'S CENTRAL CLAIM, ASSERTED RATHER THAN ASSUMED.** A correctness
    // slice that accidentally moved a census figure would be a slice that changed what
    // the engine CLAIMS to understand, and the whole point here is that it changed only
    // what the engine DOES. The reader surface is 13 (unchanged since D428), and all
    // four members of the pre-damage family were already claimed at D429 — the refusal
    // is a rule applied to a sentence, never a sentence.
    expect(attackReaderSurface()).toHaveLength(13);
    for (const sentence of [
      "Before doing damage, discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon.",
      "Before doing damage, discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing.",
      "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.",
      "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon. If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.",
    ]) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
  });

  it("the demonstrator carries Mist Energy's printed bytes, source clause included", () => {
    // The sentence the whole slice is decided by, read off the fixture rather than
    // transcribed here (D415: a claim copied is a claim that rots in N places).
    expect(FIXTURE_POOL[MIST]?.effect).toContain(
      "Prevent all effects of attacks used by your opponent's Pokémon done to the Pokémon this card is attached to.",
    );
    expect(FIXTURE_POOL[MIST]?.effect).toContain("Damage is not an effect.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — 🛑 THE OPPONENT-SIDE STRIP IS REFUSED, with the one-axis control beside it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the shielded body keeps its Tool, and the identical board loses it", () => {
  it("🛑🛑 ROW 73 — THE DEFECT. The Tool STAYS, and the unshielded twin loses it", () => {
    // 🛑 **THE PAIR IS THE RUNG.** Two boards, one attached card apart (D427): both
    // wear a Rock Chestplate, one also wears a Mist Energy. Before D430 the Tool came
    // off BOTH, and every event assertion in this file passed on that build — which is
    // why the claim is made on the BOARD.
    const refused = swing(shielded(), IDX.pry);
    expect(refused.state.players.p2.active?.tools).toHaveLength(1);
    expect(refused.state.players.p2.discard).toEqual([]);
    expect(find(refused.events, "TOOLS_DISCARDED")).toBeUndefined();
    expect(find(refused.events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");

    // ⚠️ **THE ADMISSION THAT MAKES THE REFUSAL MEAN SOMETHING (D424).** Without it the
    // rung above passes on a build that refuses every strip on every board.
    const admitted = swing(tooled(), IDX.pry);
    expect(admitted.state.players.p2.active?.tools).toEqual([]);
    expect(find(admitted.events, "TOOLS_DISCARDED")?.uids).toHaveLength(1);
    expect(find(admitted.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
  });

  it("🛑 THE NUMBER MOVES WITH IT: 70 refused, 100 admitted, on the same pair", () => {
    // The Chestplate's −30 is what makes the refusal observable as arithmetic and not
    // only as a card in a zone — a refusal that left the board right and the damage
    // wrong would pass every assertion above. 100 − 30 = 70 when the Tool survives.
    expect(dealt(swing(shielded(), IDX.pry).events)).toBe(70);
    expect(dealt(swing(tooled(), IDX.pry).events)).toBe(100);
  });

  it("🛑 *(Damage is not an effect.)* — the printed parenthetical, on this seam", () => {
    // The shield refuses the STRIP and lets the hit through in full. A build that
    // routed the refusal into §8.5 instead would hand the holder total immunity, which
    // is the one mis-read the printed reminder exists to stop.
    const refused = swing(shielded(), IDX.pry);
    expect(dealt(refused.events)).toBe(70);
    expect(refused.state.players.p2.active?.damage).toBe(70);
    // …and the attack still resolved: the turn ended and the attacker is spent.
    expect(find(refused.events, "ATTACK_FAILED")).toBeUndefined();
  });

  it("🛑 ROW 71 — BOTH ZONES are refused together, including the shield's own card", () => {
    // Row 71 takes Tools AND Special Energy, so on a shielded body the Mist Energy is
    // itself in the strip's sights. The gate is asked BEFORE either zone is read, so
    // the shield saves itself and the Tool and the Basic in one refusal.
    let state = shielded();
    state = attachFromDeck(state, "p2", BASIC, 1);
    const refused = swing(state, IDX.purge);
    expect(refused.state.players.p2.active?.tools).toHaveLength(1);
    expect(refused.state.players.p2.active?.energy).toHaveLength(2); // Mist + Basic
    expect(find(refused.events, "TOOLS_DISCARDED")).toBeUndefined();
    expect(find(refused.events, "ENERGY_DISCARDED")).toBeUndefined();
    expect(count(refused.events, "ATTACK_EFFECT_PREVENTED")).toBe(1);

    // ⚠️ THE ADMISSION, one axis apart: the same board WITHOUT the Mist Energy loses
    // its Tool and keeps its Basic (row 71's card-class control still holds).
    let unshielded = tooled();
    unshielded = attachFromDeck(unshielded, "p2", THERAPEUTIC, 1);
    unshielded = attachFromDeck(unshielded, "p2", BASIC, 1);
    const admitted = swing(unshielded, IDX.purge);
    expect(admitted.state.players.p2.active?.tools).toEqual([]);
    expect(admitted.state.players.p2.active?.energy).toHaveLength(1); // the Basic survived
  });

  it("🛑 a REFUSED strip files no row claiming a discard, and is not silent either", () => {
    // Both halves of "what is emitted on refusal", asserted together because either one
    // alone admits a wrong build: a silent refusal is a Tool that stays with nothing
    // saying why, and a `TOOLS_DISCARDED` with an empty `uids` is a row that has to be
    // read to learn nothing (`HEALED`'s never-0 rule).
    const { events } = swing(shielded(), IDX.pry);
    const prevented = find(events, "ATTACK_EFFECT_PREVENTED");
    expect(prevented).toBeDefined();
    expect(prevented?.uid).toBe(shielded().players.p2.active?.stack.at(-1));
    expect(count(events, "TOOLS_DISCARDED")).toBe(0);
    expect(count(events, "ENERGY_DISCARDED")).toBe(0);
    // …and it is the SAME event every other refused attack effect files, not a new one.
    expect(events.map((e) => e.type)).toContain("ATTACK_EFFECT_PREVENTED");
  });

  it("🛑 the refusal is about the BODY, not the seat: a shielded ATTACKER is no shield", () => {
    // A build that read the wrong side's passives would refuse here. The Mist Energy
    // goes on the ATTACKER while the DEFENDER wears the Tool; the strip must land.
    let state = attachFromDeck(tooled(), "p1", MIST, 1);
    const admitted = swing(state, IDX.pry);
    expect(admitted.state.players.p2.active?.tools).toEqual([]);
    expect(find(admitted.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    // …and the same board with the shield moved one body over refuses (one axis).
    state = attachFromDeck(tooled(), "p2", MIST, 1);
    expect(swing(state, IDX.pry).state.players.p2.active?.tools).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — 🛑 ROW 72's SELF-TARGET: refusable by NOTHING, decided from the printed text.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — row 72 strips *this Pokémon* and no shield can stop it", () => {
  /** The attacker wears a Vitality Band — row 72's own +10, so the strip is observable
      as a NUMBER as well as a zone (`attackerPreWRBonus` folds it pre-W/R). */
  function banded(seat: Seat = "p1"): GameState {
    return attachToolFromDeck(board(seat), seat, "active", BAND);
  }

  it("🛑🛑 THE ATTACKER'S OWN MIST ENERGY DOES NOT SAVE THE ATTACKER'S OWN TOOL", () => {
    // 🛑 **THE DECISION THIS SLICE HAD TO MAKE, DRIVEN.** The shield is ON the target
    // body and the target body is the attacker's own. It still does not apply: Mist
    // Energy prevents effects of attacks *"used by your opponent's Pokémon"*, and this
    // attack is used by the holder's own Pokémon. A build that routed row 72 through
    // the gate WITHOUT `effectRefusedOn`'s own-side rule keeps the Band here and
    // reddens this line — which is what makes the decision executable rather than
    // argued (D428).
    const state = attachFromDeck(banded(), "p1", MIST, 1);
    const { state: after, events } = swing(state, IDX.shed);
    expect(after.players.p1.active?.tools).toEqual([]);
    expect(find(events, "TOOLS_DISCARDED")?.seat).toBe("p1");
    expect(find(events, "TOOLS_DISCARDED")?.actor).toBe("p1");
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    // …and the number moved with it: 110 with the Band, 100 once it is discarded.
    expect(dealt(events)).toBe(100);
    expect(dealt(swing(banded(), IDX.plain).events)).toBe(110);
  });

  it("🛑 …and the OPPONENT's Mist Energy does not either — it is not on the target", () => {
    // The near-miss, one axis from the rung above: same board, the shield moved to the
    // other side of the table. Row 72 never looks at that body at all, so this is the
    // control that stops "no refusal" being read as "the gate is off for row 72".
    const state = attachFromDeck(banded(), "p2", MIST, 1);
    const { state: after, events } = swing(state, IDX.shed);
    expect(after.players.p1.active?.tools).toEqual([]);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(dealt(events)).toBe(100);
  });

  it("🛑 …while the SAME shield on the SAME body refuses an opponent-side sentence", () => {
    // 🛑 **THE ATTRIBUTION CONTROL (D214).** Without it, both rungs above are equally
    // satisfied by a build where Mist Energy does nothing at all. One board, two
    // indices: index 2 (row 72, self) is admitted and index 1 (row 73, opponent) is
    // refused, and the ONLY difference is which body the printed sentence names.
    let state = attachToolFromDeck(banded(), "p2", "active", CHESTPLATE);
    state = attachFromDeck(state, "p2", MIST, 1);
    expect(swing(state, IDX.shed).state.players.p1.active?.tools).toEqual([]);
    expect(swing(state, IDX.pry).state.players.p2.active?.tools).toHaveLength(1);
  });

  it("🛑 the printed CANCEL still fires on a bare own body, shield or no shield", () => {
    // The cancel is conditioned on the ACT's result. Its antecedent is "no Tool on this
    // Pokémon", which a shield cannot create and cannot remove — so the branch answers
    // identically with the Mist Energy attached, which is the observable half of
    // "a self-strip is never refused".
    for (const [label, state] of [
      ["bare", board()],
      ["bare + shield", attachFromDeck(board(), "p1", MIST, 1)],
    ] as [string, GameState][]) {
      const { events } = swing(state, IDX.shed);
      expect(find(events, "ATTACK_FAILED")?.reason, label).toBe("preDamage");
      expect(find(events, "DAMAGE_DEALT"), label).toBeUndefined();
      expect(find(events, "ATTACK_EFFECT_PREVENTED"), label).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — 🛑 ROW 74: one refusal for two effects, and NO doubled prevention row.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — row 74's strip and status are refused by ONE gate, announced ONCE", () => {
  it("🛑🛑 the Tool STAYS, nothing is Paralyzed, and there is EXACTLY ONE row", () => {
    // 🛑 **THE EVENT COUNT IS 1 BEFORE AND 1 AFTER THIS SLICE, WHICH IS WHY THE DEFECT
    // HID.** The old build discarded the Tool (unrefused) and then had `applyStatus`
    // refuse the Paralysis — one `ATTACK_EFFECT_PREVENTED`. The new build refuses the
    // STRIP, reports `tools: 0`, and returns before `applyStatus` is ever called — one
    // `ATTACK_EFFECT_PREVENTED`. Only the BOARD tells them apart.
    const { state, events } = swing(shielded(), IDX.lock);
    expect(state.players.p2.active?.tools).toHaveLength(1);
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    expect(count(events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(count(events, "TOOLS_DISCARDED")).toBe(0);
    expect(count(events, "STATUS_APPLIED")).toBe(0);
    expect(count(events, "STATUS_PREVENTED")).toBe(0);
    // The Chestplate survived, so the damage is the reduced figure.
    expect(dealt(events)).toBe(70);
  });

  it("⚠️ the ADMISSION: the same board without the shield discards AND Paralyzes", () => {
    const { state, events } = swing(tooled(), IDX.lock);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(count(events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(count(events, "STATUS_APPLIED")).toBe(1);
    expect(dealt(events)).toBe(100);
  });

  it("🛑 §12's immunity is a DIFFERENT refusal and still behaves as it did", () => {
    // Therapeutic Energy `sv02-193` prints a §12 immunity, not a §11 shield: the Tool
    // IS discarded and only the Paralysis is refused, with `STATUS_PREVENTED` rather
    // than `ATTACK_EFFECT_PREVENTED`. This rung is the one-axis neighbour of the first
    // one in this section — same body, same Tool, a different Special Energy — and it
    // is what proves the new gate did not swallow the old distinction.
    const state = attachFromDeck(tooled(), "p2", THERAPEUTIC, 1);
    const { state: after, events } = swing(state, IDX.lock);
    expect(after.players.p2.active?.tools).toEqual([]);
    expect(count(events, "TOOLS_DISCARDED")).toBe(1);
    expect(count(events, "STATUS_PREVENTED")).toBe(1);
    expect(count(events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(after.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("🛑 BOTH Energies at once: §11 wins, because it refuses the act that gates §12", () => {
    // The composition, driven rather than reasoned about. §11 refuses the strip, so
    // `tools === 0` and `applyStatus` — which owns §12 — is never reached: ONE
    // `ATTACK_EFFECT_PREVENTED` and NO `STATUS_PREVENTED`. A build that asked §12 first
    // would file the wrong row, and a build that asked §11 twice would file two.
    let state = attachFromDeck(shielded(), "p2", THERAPEUTIC, 1);
    state = attachFromDeck(state, "p2", BASIC, 1);
    const { state: after, events } = swing(state, IDX.lock);
    expect(after.players.p2.active?.tools).toHaveLength(1);
    expect(count(events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(count(events, "STATUS_PREVENTED")).toBe(0);
    expect(count(events, "STATUS_APPLIED")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — BOTH SEATS, and the loud path in both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — both seats, and nothing is reported as skipped", () => {
  it("🛑 p2 attacking: the shield on p1's Active refuses p2's strip", () => {
    // D361's rule. A build that hard-coded the shielded seat passes every p1 rung above.
    const refused = swing(shielded("p2"), IDX.pry, "p2");
    expect(refused.state.players.p1.active?.tools).toHaveLength(1);
    expect(find(refused.events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p1");
    expect(dealt(refused.events)).toBe(70);

    const admitted = swing(tooled("p2"), IDX.pry, "p2");
    expect(admitted.state.players.p1.active?.tools).toEqual([]);
    expect(find(admitted.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(dealt(admitted.events)).toBe(100);
  });

  it("🛑 p2 attacking: row 72 still strips p2's OWN Tool through its OWN shield", () => {
    let state = attachToolFromDeck(board("p2"), "p2", "active", BAND);
    state = attachFromDeck(state, "p2", MIST, 1);
    const { state: after, events } = swing(state, IDX.shed, "p2");
    expect(after.players.p2.active?.tools).toEqual([]);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
  });

  it("a REFUSED sentence is still SIMULATED — no ATTACK_EFFECT_SKIPPED, either way", () => {
    // D130's rule: the report is about whether a READER claimed the sentence, never
    // about whether the act moved anything. A refusal must not be laundered into "the
    // engine does not understand this card".
    for (const index of [IDX.purge, IDX.pry, IDX.shed, IDX.lock]) {
      expect(find(swing(shielded(), index).events, "ATTACK_EFFECT_SKIPPED"), String(index)).toBeUndefined();
      expect(find(swing(tooled(), index).events, "ATTACK_EFFECT_SKIPPED"), String(index)).toBeUndefined();
    }
  });

  it("🛑 THE ATTRIBUTION CONTROL — index 5's unread sentence IS still reported", () => {
    // Without it the rung above passes on a build where the report is broken outright,
    // which is the vacuous-guard shape this repo keeps finding (D200→D214).
    const skipped = find(swing(shielded(), IDX.loud).events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe("Each player draws 3 cards.");
    expect(resolvedByAnyReader("Each player draws 3 cards.")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — nothing persisted moves, and the seam is still pure and un-parkable.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — persistence, purity, and the property the export did not cost", () => {
  it("🛑 `MATCH_RECORD_VERSION` STAYS 26 — a boolean gate adds no persisted shape", () => {
    // ⚠️ THE CONSTANT LIVES IN `apps/api/src/lobby/match.ts` and is not exported from
    // this package, so this rung drives the SHAPES it governs, `preDamageFamily.test.ts`
    // §9's move. Four ways this slice could have owed a bump, and none of them fires:
    //   ① a new `GameState` / `InPlayPokemon` FIELD — none; the refusal WRITES NOTHING,
    //      it returns the input board `===` unchanged;
    //   ② a new `EffectOp` inhabitant reaching `phase.cont` — none;
    //   ③ a new key on the effect CONTINUATION — none: this seam still never parks, and
    //      `effectRefused` returns a `boolean`, which carries neither a prompt nor a
    //      continuation for a resolver to drain (D429's property, at the type);
    //   ④ a new EVENT type — none: the refusal files `ATTACK_EFFECT_PREVENTED`, which
    //      `applyStatus` has filed since D142.
    const refused = swing(shielded(), IDX.pry);
    expect(refused.state.phase.kind).toBe("turn:action");
    expect(refused.state.pending).toEqual([]);
    expect("cont" in refused.state.phase).toBe(false);
    // The shielded body's key set as a LITERAL, so "every body grew a key" cannot hide
    // inside a same-tree comparison (aquaWash's rule).
    expect(Object.keys(refused.state.players.p2.active ?? {}).sort()).toEqual([
      "attackBlock",
      "attackDamageDebuff",
      "attackLockedTurn",
      "boostedAttack",
      "conditions",
      "damage",
      "damageReduction",
      "energy",
      "evolvedTurn",
      "healedTurn",
      "installedRecoil",
      "lockedAttacks",
      "markers",
      // 🆕🆕 D432 — the attack-installed §8.5 NO-WEAKNESS bar's stamp (MATCH_RECORD_VERSION 26 -> 27).
      "noWeaknessTurn",
      "promotedTurn",
      "retreatBlocked",
      "retreatLockedTurn",
      "scheduledEffect",
      "stack",
      "tools",
      "turnPlayed",
      "usedAttack",
    ]);
    // …and the refusal event's own key set, for the same reason.
    const prevented = find(refused.events, "ATTACK_EFFECT_PREVENTED");
    expect(Object.keys(prevented ?? {}).sort()).toEqual(["seat", "type", "uid"]);
  });

  it("🛑 a v26 record round-trips BOTH DIRECTIONS through every refused sentence", () => {
    for (const [label, start, index] of [
      ["row71-refused", attachFromDeck(shielded(), "p2", BASIC, 1), IDX.purge],
      ["row73-refused", shielded(), IDX.pry],
      ["row74-refused", shielded(), IDX.lock],
      ["row72-unrefusable", attachFromDeck(attachToolFromDeck(board(), "p1", "active", BAND), "p1", MIST, 1), IDX.shed],
    ] as [string, GameState, number][]) {
      // BACKWARD: a record written by an older deploy — the board serialized BEFORE
      // this slice's code could have touched it — rehydrates and answers identically.
      const rehydrated = JSON.parse(JSON.stringify(start)) as GameState;
      const live = swing(start, index);
      const replayed = swing(rehydrated, index);
      expect(JSON.stringify(replayed.events), label).toBe(JSON.stringify(live.events));
      expect(JSON.stringify(replayed.state), label).toBe(JSON.stringify(live.state));
      // FORWARD: the board this slice produces survives the same trip unchanged.
      const after = JSON.parse(JSON.stringify(live.state)) as GameState;
      expect(JSON.stringify(after), label).toBe(JSON.stringify(live.state));
    }
  });

  it("🛑 the swing mutates NOTHING it was given — deep-frozen boards resolve", () => {
    // Strict mode makes any write to a frozen object throw, so this is the whole
    // no-mutation claim rather than a sample of it. THE PAIR is the point: the REFUSED
    // path is the one this slice added and it must not write, and the ADMITTED path on
    // the identical board must still write — a frozen board that refuses everything
    // would pass the first half alone.
    const frozenRefused = deepFreeze(shielded());
    const refused = swing(frozenRefused, IDX.pry);
    expect(frozenRefused.players.p2.active?.tools).toHaveLength(1);
    expect(refused.state.players.p2.active?.tools).toHaveLength(1);
    // 🛑 THE BOARD IS RETURNED IDENTICAL, not rebuilt — the strip's silent-no-op
    // contract, which the refusal reuses rather than re-spelling.
    expect(refused.state.players.p2.active?.tools).toBe(frozenRefused.players.p2.active?.tools);

    const frozenAdmitted = deepFreeze(tooled());
    const admitted = swing(frozenAdmitted, IDX.pry);
    expect(frozenAdmitted.players.p2.active?.tools).toHaveLength(1);
    expect(admitted.state.players.p2.active?.tools).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the version pin.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the version", () => {
  it("the engine version is pinned, and it is THIS slice's pin", () => {
    // 🆕🆕 D430 — the SIXTEENTH `engineVersion` literal pin in the suite (fifteen
    // inherited plus this one) and the NINETEENTH site overall, counting
    // `legacyEnergy.test.ts`'s `manifest.version` pin, `packages/engine/package.json`,
    // `index.ts`'s declaration and `D275`'s mutant anchor. ⚠️ **RE-MEASURED, NOT
    // INHERITED** (D429: extending a streak asserts it afresh). D429's note said
    // 15 / 18 and it re-derives EXACTLY at this head: `grep -rn '"0.331.0"'` before the
    // bump returned 15 assertion lines in 14 test files (14 `engineVersion` + 1
    // `manifest.version`) plus `package.json`, the declaration and the mutant `find`.
    // The increment is this line — the pin being AUTHORED, which is the one D427 named
    // as the thing every note forgets.
    expect(engineVersion).toBe("0.379.0");
  });
});
