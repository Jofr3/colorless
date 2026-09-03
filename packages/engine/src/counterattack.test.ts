import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  COUNTERATTACK_DECK,
  FIXTURE_POOL,
  VENGEFUL_PUNCH_DECK,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.89.0 → 0.90.0 — the §9 RECOIL LABEL (D141). attack.ts's reactive recoil
// pushed `COUNTERS_PLACED` source `"ability"` as a string literal, so every Rocky
// Helmet sv01-193 — a Pokémon TOOL — has rendered "Ability: 20 damage to …" in
// every match since 0.57.0. Found by D140, checked rather than assumed, and LIVE
// rather than latent: no card has to be added and no clause derived for a player
// to see it. D136's finding 1 on a THIRD axis — not the row's VOICE and not
// attack-vs-Ability, but Ability-vs-TOOL.
//
// ⚠️ THE JUDGEMENT IS THE WHOLE SLICE, AND THE SUM DECIDES IT. `passivesOf`
// aggregates `damageAttacker` over the holder's own passive AND every attached
// Tool into ONE seat-free number, and attack.ts emits ONE event carrying it. So a
// row can be an Ability's 50 plus a Tool's 20 at the same time — and that board is
// the CARD'S OWN, not a contrivance: Stunfisk sv03-112 "Custom Trap" does not fire
// unless a Tool is attached, and Rocky Helmet is a Tool. A provenance member
// (`"tool"`, or `"ability"` kept beside it) cannot be true of that row, because the
// amount has two provenances and the row has one label. So the new member names
// the MECHANISM — `"counterattack"`, the enum's first mechanism member since
// `"confusion"` — and the answer to "should a real Ability and a Tool render
// differently at all" is NO, on the strongest available grounds: the engine's own
// aggregation makes them indistinguishable at the read site by construction.
//
// The label is deliberately not "Recoil": this event already uses that word for
// `"self"`, an attacker damaging ITSELF with its own printed attack, which is the
// opposite direction and must not read alike.

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30, no effect

/** The printed sentence the whole family shares — the census key, taken from the
    catalog text rather than from a list of ids. */
const RECOIL_CLAUSE = "damage counters on the Attacking Pokémon";

/** Rocky Helmet's own contribution, read off the registry so a data change moves
    every expectation in this file at once. */
const HELMET = (programFor("sv01-193")?.passive?.damageAttacker?.amount ?? 0) as number;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Setup with P2 first, so P2 can field + equip its defender before handing the
    turn to P1. Returns the state mid-P2's-turn. */
function board(seed: number): GameState {
  return driveSetup(seed, { p1: COUNTERATTACK_DECK, p2: COUNTERATTACK_DECK }, { first: "p2" });
}

/** Attach a Tool from P2's deck onto P2's Active. */
function equip(state: GameState, toolId: string): GameState {
  const withCard = handFromDeck(state, "p2", toolId, 1);
  const uid = handUid(withCard, "p2", toolId);
  const done = mustApply(withCard, {
    type: "attachTool",
    seat: "p2",
    uid,
    target: { spot: "active" },
  }).state;
  expect(done.players.p2.active?.tools).toContain(uid);
  return done;
}

/** Hand the turn to P1 and field the plain-damage attacker with its {C}. */
function armAttacker(state: GameState): GameState {
  let next = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  next = setActiveFromDeck(next, "p1", "fix-attacker");
  return attachFromDeck(next, "p1", "fix-energy", 1);
}

/** P2 fields `defenderId` (Active), optionally wearing `toolId`; then P1 Bites it. */
function fight(
  seed: number,
  defenderId: string,
  toolId?: string,
): { state: GameState; events: GameEvent[]; before: GameState } {
  let state = setActiveFromDeck(board(seed), "p2", defenderId);
  if (toolId !== undefined) state = equip(state, toolId);
  state = armAttacker(state);
  deepFreeze(state);
  const { state: done, events } = mustApply(state, bite);
  return { state: done, events, before: state };
}

/** D158 — the same fight for the family's KO-CONDITIONED half, on the board its
    condition actually needs: the holder is one hit from lethal, so Bite KNOCKS IT
    OUT instead of merely damaging it. Its own 60 (`VENGEFUL_PUNCH_DECK`) so every
    seeded board built on `COUNTERATTACK_DECK` above stays byte-identical. */
function koFight(
  seed: number,
  toolId: string,
  holderDamage = 100,
): { state: GameState; events: GameEvent[] } {
  let state = driveSetup(
    seed,
    { p1: VENGEFUL_PUNCH_DECK, p2: VENGEFUL_PUNCH_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-wall"); // 120 HP, no passive of its own
  state = attachToolFromDeck(state, "p2", "active", toolId);
  state = setDamage(state, "p2", holderDamage); // 100 → Bite's 30 makes 130 ≥ 120
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  deepFreeze(state);
  return mustApply(state, bite);
}

describe("the §9 recoil row — the MECHANISM label, whatever card granted it", () => {
  it("a TOOL's recoil (Rocky Helmet) is no longer called an Ability", () => {
    // ⚠️ THE DEFECT, DRIVEN. A bare fix-bigbody has no passive of its own, so the
    // ONLY source of these counters is the Tool — and before 0.90.0 the row said
    // `"ability"`, which the log renders as the literal word Ability.
    const { state: done, events } = fight(1, "fix-bigbody", "sv01-193");

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: activeUid(done, "p1"),
      amount: HELMET,
      source: "counterattack",
    });
    expect(done.players.p1.active?.damage).toBe(HELMET);
  });

  it("and a real ABILITY's recoil (Counterattack Quills) gets the SAME label", () => {
    // The fix is NOT "Tools get their own member". Cacturne's recoil IS an
    // Ability's, and it still renders as a counterattack — because the row is
    // telling the reader what happened, not which slot on the card did it. A
    // build that split the label by provenance fails HERE, not on the Tool case.
    const quills = programFor("sv01-006")?.passive?.damageAttacker?.amount;
    const { state: done, events } = fight(2, "sv01-006");

    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: quills,
      source: "counterattack",
    });
    expect(done.players.p1.active?.damage).toBe(quills);
  });
});

describe("⚠️ why no PROVENANCE label can be honest — one row, two provenances", () => {
  it("Stunfisk (Ability 50) wearing Rocky Helmet (Tool 20) is ONE row of 70", () => {
    // THE CASE THE WHOLE JUDGEMENT RESTS ON, and it needs no new card: Custom
    // Trap is gated on `requiresTool`, so a Stunfisk that retaliates at all has a
    // Tool attached — and the Tool the catalog gives it for that job carries a
    // recoil of its own. `passivesOf` ADDS them, attack.ts emits ONE event, and
    // there is exactly one `source` slot for a number that came from two cards.
    const trap = programFor("sv03-112")?.passive?.damageAttacker?.amount ?? 0;
    expect(programFor("sv03-112")?.passive?.damageAttacker?.requiresTool).toBe(true);

    const { state: done, events } = fight(3, "sv03-112", "sv01-193");

    const placed = all(events, "COUNTERS_PLACED");
    expect(placed).toHaveLength(1); // NOT one row per contributing card
    expect(placed[0]).toMatchObject({
      seat: "p1",
      amount: trap + HELMET,
      source: "counterattack",
    });
    // Read from the two authored amounts rather than written as 70, so the
    // arithmetic is asserted rather than the constant.
    expect(trap + HELMET).toBe(70);
    expect(done.players.p1.active?.damage).toBe(70);
  });

  it("and the read site is handed a bare NUMBER — no provenance survives the sum", () => {
    // The structural half of the same claim: the passive record itself carries no
    // kind, so attack.ts could not label by provenance even if it wanted to. This
    // is the assertion that fails the day somebody adds a `kind: "tool"` field to
    // `damageAttacker` and reaches for a provenance member again — at which point
    // the sum above is still two cards and one row, and the answer is still no.
    for (const id of ["sv01-005", "sv01-006", "sv03-112", "sv01-193"]) {
      const recoil = programFor(id)?.passive?.damageAttacker;
      expect(recoil, id).toBeDefined();
      expect(Object.keys(recoil ?? {}).sort()).not.toContain("source");
      for (const key of Object.keys(recoil ?? {})) {
        expect(["amount", "requiresTool"], `${id} carries ${key}`).toContain(key);
      }
    }
  });
});

describe("⚠️ the guard, ASSERTED over the POOL rather than at one hand-picked site", () => {
  // D140's move, reused: the old "guard" here was the ACCIDENT that whoever wrote
  // the literal was thinking of Cacnea. `rockyHelmet.test.ts:95` then pinned the
  // wrong side of it as intended — the D136 "the suite asserts the bug" pattern
  // for a third time. So the family is DISCOVERED from the catalog text and every
  // member found is driven, rather than a list somebody maintains.
  const producers = Object.entries(FIXTURE_POOL)
    .filter(([, card]) =>
      [card.effect ?? "", ...(card.abilities ?? []).map((a) => a.effect ?? "")].some((text) =>
        text.includes(RECOIL_CLAUSE),
      ),
    )
    .map(([id, card]) => ({ id, category: card.category, trainerType: card.trainerType }));

  it("discovers the §9 recoil family from the printed text, and it spans BOTH kinds", () => {
    // The census, pinned so a fixture landing later fails this and gets swept in.
    // ⚠️ AND IT DID EXACTLY THAT AT D158: adding the Vengeful Punch sv03-197
    // fixture failed this line, this file's authored-census line AND its drive
    // loop, which is the whole reason the family is discovered from TEXT instead
    // of from a maintained list. All three were re-pointed rather than relaxed.
    expect(producers.map((p) => p.id).sort()).toEqual([
      "sv01-005", // Cacnea — Counterattack Quills (Ability)
      "sv01-006", // Cacturne — Counterattack Quills (Ability)
      "sv01-193", // Rocky Helmet (Pokémon TOOL) — on DAMAGE
      "sv03-112", // Stunfisk — Custom Trap (Ability, requiresTool)
      "sv03-197", // Vengeful Punch (Pokémon TOOL) — on the KNOCK OUT (D158)
    ]);
    // ⚠️ AND IT IS MIXED, which is the fact the hardcoded label denied. A build in
    // which every producer is a Pokémon can honestly say "Ability"; this one
    // cannot, and the assertion states that rather than leaving it to be noticed.
    expect(new Set(producers.map((p) => p.category))).toEqual(new Set(["Pokemon", "Trainer"]));
    expect(producers.find((p) => p.id === "sv01-193")?.trainerType).toBe("Tool");
  });

  /** The family's two halves, split by the CONDITION each pays on. Since D158 the
      one printed clause is served by two fields read at two sites, so the census
      partitions rather than mapping onto one field. */
  const onDamage = producers.filter(
    (p) => programFor(p.id)?.passive?.damageAttacker !== undefined,
  );
  const onKo = producers.filter(
    (p) => programFor(p.id)?.passive?.damageAttackerOnKo !== undefined,
  );

  it("every discovered producer is AUTHORED — text census = program census", () => {
    // The two censuses must agree in both directions: a printed sentence with no
    // program would mean the sweep below drives nothing, and an authored recoil
    // with no printing would mean the sweep misses a producer.
    //
    // ⚠️ AND SINCE D158 THE PARTITION IS THE CLAIM, not the field. The same printed
    // clause is now served by `damageAttacker` (pays on DAMAGE, read at attack.ts's
    // §9) and `damageAttackerOnKo` (pays on the KNOCK OUT, read at flow.ts's §8.1
    // sweep). Asserting the split is TOTAL and DISJOINT is strictly stronger than
    // the old single-field check: a producer authored on neither field fails, and
    // so does one authored on BOTH — which would fire twice on a lethal hit and is
    // precisely the merge D155's rule refused.
    expect([...onDamage, ...onKo]).toHaveLength(producers.length);
    expect(onDamage.filter((p) => onKo.includes(p))).toEqual([]);
    expect(onDamage.length).toBeGreaterThan(1);
    expect(onKo.length).toBeGreaterThan(0);
  });

  it("and DRIVES every one of them — not one emits a row that says 'ability'", () => {
    // TOTAL over the discovered set. A Pokémon producer is fielded Active; a Tool
    // producer is bolted onto a passive-less body. Every Pokémon case wears Rocky
    // Helmet as well, so a `requiresTool` producer actually fires instead of
    // passing this vacuously — which also means every one of these rows is a SUM,
    // and every one of them still carries exactly one label.
    let seed = 10;
    for (const producer of onDamage) {
      const own = programFor(producer.id)?.passive?.damageAttacker?.amount ?? 0;
      const { events } =
        producer.category === "Pokemon"
          ? fight(seed++, producer.id, "sv01-193")
          : fight(seed++, "fix-bigbody", producer.id);
      const placed = all(events, "COUNTERS_PLACED");
      expect(placed, producer.id).toHaveLength(1);
      expect(placed[0]?.source, `${producer.id} labelled its recoil`).toBe("counterattack");
      // The amount is this producer's own plus the Helmet's, except for the
      // Helmet itself (which is not doubled up).
      expect(placed[0]?.amount, producer.id).toBe(
        producer.id === "sv01-193" ? own : own + HELMET,
      );
      // …and the row is on the ATTACKER's seat, never the holder's.
      expect(placed[0]?.seat, producer.id).toBe("p1");
    }
  });

  it("…and DRIVES the KO-conditioned half too, on the board ITS condition needs", () => {
    // TOTAL over the other partition (D158). The claim is identical and that is
    // the point: a second read site, a second condition, a second field — and the
    // row it emits is the SAME `"counterattack"` member on the SAME seat, which is
    // the fourth payout on D141's judgement that the axis is the MECHANISM.
    let seed = 40;
    for (const producer of onKo) {
      const own = programFor(producer.id)?.passive?.damageAttackerOnKo?.amount ?? 0;
      const { events } = koFight(seed++, producer.id);
      const placed = all(events, "COUNTERS_PLACED");
      expect(placed, producer.id).toHaveLength(1);
      expect(placed[0]?.source, `${producer.id} labelled its recoil`).toBe("counterattack");
      expect(placed[0]?.amount, producer.id).toBe(own);
      expect(placed[0]?.seat, producer.id).toBe("p1");
      // …and the KO really happened, so this is not passing vacuously on a board
      // where the condition was never met.
      expect(types(events), producer.id).toContain("KNOCKED_OUT");
    }
  });

  it("the KO half pays NOTHING on a hit its holder survives — the partition, driven", () => {
    // The partition asserted above is a claim about BEHAVIOUR, not about which
    // key a record happens to carry. On the ordinary damage board every `onKo`
    // producer is silent, and that is what makes it a different effect rather than
    // a differently-spelled one.
    let seed = 60;
    for (const producer of onKo) {
      const { events } = koFight(seed++, producer.id, 0); // an UNDAMAGED holder
      expect(types(events), producer.id).toContain("DAMAGE_DEALT"); // it WAS hit…
      expect(types(events), producer.id).not.toContain("KNOCKED_OUT"); // …and lived
      expect(all(events, "COUNTERS_PLACED"), producer.id).toEqual([]);
    }
  });
});

describe("the VOICE — `seat` owns the DAMAGED Pokémon, which here is the ATTACKER", () => {
  it("files the row under the attacker's seat and uid, though the CAUSER is the defender", () => {
    // The mirror image of D136's finding 1. Everywhere else in this family the
    // row's seat is the non-actor's; here it is the actor's — and the causer is
    // the other player, which is why the row must NOT be active-voiced under this
    // seat (it would read as the attacker damaging itself). Pinned from the state
    // rather than by eye.
    const { state: done, events } = fight(4, "fix-bigbody", "sv01-193");
    const placed = find(events, "COUNTERS_PLACED");
    expect(placed?.seat).toBe("p1"); // the attacking player
    expect(placed?.uid).toBe(activeUid(done, "p1")); // …and their own Active
    expect(done.players.p2.active?.damage).toBe(30); // the holder took only the Bite
  });

  it("lands immediately behind the hit it reacts to, before any turn end", () => {
    const { events } = fight(5, "fix-bigbody", "sv01-193");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });
});

describe("the log — the row a player actually reads", () => {
  function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
    return logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );
  }

  it("renders a SYSTEM row that never says Ability — the Tool case", () => {
    const { state: done, events } = fight(6, "fix-bigbody", "sv01-193");
    const rows = render(events, done);

    const row = rows.find((r) => r.text.startsWith("Counterattack:"));
    expect(row).toBeDefined();
    expect(row?.who).toBe("system");
    expect(row?.text).toBe(`Counterattack: ${HELMET} damage to fix-attacker`);
    // ⚠️ THE ASSERTION THE OLD SUITE HAD BACKWARDS. This is what a Rocky Helmet
    // printed for three engine versions, and it is the line that fails if the
    // literal is restored.
    expect(row?.text).not.toContain("Ability");
    // Nothing else announces the recoil — it is a passive, so no
    // ABILITY_TRIGGERED row names a source above it. This row is the whole
    // explanation, which is why it has to be true on its own.
    expect(rows.filter((r) => r.text.includes("damage to fix-attacker"))).toHaveLength(1);
  });

  it("renders the Ability + Tool SUM as ONE row, and cannot say which card did it", () => {
    const { state: done, events } = fight(7, "sv03-112", "sv01-193");
    const rows = render(events, done).filter((r) => r.text.startsWith("Counterattack:"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe("Counterattack: 70 damage to fix-attacker");
    // Neither card's name appears, and neither could: the number is their sum.
    expect(rows[0]?.text).not.toContain("Stunfisk");
    expect(rows[0]?.text).not.toContain("Rocky Helmet");
  });

  it("still renders a genuine ABILITY placement as an Ability row — both values reach the log", () => {
    // A member is only meaningful if the value it replaced still reaches the log
    // from its own producers (D140's move). Trevenant's between-turns placement is
    // an Ability, says so, and is untouched by this slice.
    const authored = programFor("sv03-012")?.triggered?.[0]?.program?.[0] as { source: string };
    expect(authored.source).toBe("ability");
    const { state: done } = fight(8, "fix-bigbody", "sv01-193");
    const rows = render(
      [
        {
          type: "COUNTERS_PLACED",
          seat: "p1",
          uid: activeUid(done, "p1") ?? "",
          amount: 10,
          source: "ability",
        },
      ],
      done,
    );
    expect(rows[0]).toEqual({ who: "system", text: "Ability: 10 damage to fix-attacker" });
  });

  it("does NOT read like the attacker's own self-recoil — the word 'Recoil' stays free", () => {
    // `"self"` is an attacker damaging ITSELF with its own printed attack
    // (Skeledirge "Blazing Shout") — the OPPOSITE direction, in the attacker's own
    // voice. Naming this member `"recoil"` would have collided with a meaning the
    // event's own doc block already uses, so the two are pinned apart here.
    const { state: done } = fight(9, "fix-bigbody", "sv01-193");
    const uid = activeUid(done, "p1") ?? "";
    const [counter] = render(
      [{ type: "COUNTERS_PLACED", seat: "p1", uid, amount: 20, source: "counterattack" }],
      done,
    );
    const [self] = render(
      [{ type: "COUNTERS_PLACED", seat: "p1", uid, amount: 20, source: "self" }],
      done,
    );
    expect(counter?.who).toBe("system");
    expect(self?.who).toBe("p1"); // the attacker's own voice
    expect(counter?.text).not.toBe(self?.text);
    expect(self?.text).toContain("to itself");
    expect(counter?.text).not.toContain("itself");
  });
});

describe("the family this label must still cover — three printings, none an Ability", () => {
  // ⚠️ WHY THE MECHANISM AXIS GENERALISES AND A PROVENANCE ONE DOES NOT. The local
  // D1 (2026-08-02, 978 cards / 6 sets) prints "…damage counters on the Attacking Pokémon"
  // on EIGHT printings: three Ability printings (all authored), two TOOL printings
  // and three ATTACK printings. So the same one row already has to serve three
  // different kinds of card, and a `"tool"` member would have been wrong before it
  // shipped. When one lands it joins this label with NO new member — which is the
  // test of whether the axis was right.
  //
  // ⚠️ RE-QUERIED AT D158 AGAINST THE SHRUNKEN CATALOG (2026-08-03, 890 rows /
  // 5 sets) AND THE EIGHT ROWS ARE THE SAME EIGHT. `FIXTURE_POOL` was swept as its
  // own population beside it (D156's rule) and no `swsh10.5` fixture carries the
  // clause, so the count is not a five-set undercount. Of the three cases below,
  // TWO have now landed and been re-pointed rather than deleted — Scary Fangs at
  // D152, Vengeful Punch at D158 — and each landed with no new `source` member,
  // which is the third and fourth payout on D141's judgement.
  //
  // ⚠️ AND SEE D160/D162. The 890 / 5 above is the OUTAGE-WINDOW catalog and is
  // left standing as the population D158 actually queried; D160 re-ingested
  // `swsh10.5` (978 rows / 6 sets) and D162 re-ran this census against the
  // restored catalog — the needle still returns the SAME EIGHT rows, the restored
  // set contributing ZERO. The floor above is also the TOTAL.

  it("Vengeful Punch sv03-197 — the SECOND recoil TOOL, LANDED at D158, and it joins THIS label", () => {
    // ⚠️ THE WITNESS RE-POINTED RATHER THAN DELETED, which is what makes it worth
    // having had. Until D158 this case asserted the sentence derived to NOTHING.
    //
    // "If the Pokémon this card is attached to is Knocked Out by damage from an
    // attack from your opponent's Pokémon, put 4 damage counters on the Attacking
    // Pokémon." — the same mechanism on a KO condition rather than a damaged one,
    // so it needed a READ SITE (flow.ts's §8.1 sweep) rather than a label. And the
    // claim this file is really making is D141's own: a SECOND read site now feeds
    // this row and it STILL needs no new `source` member. A board carrying both
    // Tools produces two `"counterattack"` rows from two sites — driven in
    // vengefulPunch.test.ts, which owns the rest of the printing.
    expect(programFor("sv03-197")?.passive).toEqual({ damageAttackerOnKo: { amount: 40 } });
    // …and it is a SIBLING field, not this one: the two consumers refuse each
    // other's condition, so nothing here changed shape.
    expect(programFor("sv03-197")?.passive?.damageAttacker).toBeUndefined();
  });

  it("Lycanroc ex sv02-117/-241 'Scary Fangs' — LANDED at D152, and it joins THIS label", () => {
    // ⚠️ THE WITNESS RE-POINTED RATHER THAN DELETED, which is what makes it worth
    // having had. Until D152 this case asserted the sentence derived to NOTHING.
    // It now derives to `installRecoil` — a stamp on the holder's own body, summed
    // into `passivesOf().damageAttacker` at the very site above — and the claim the
    // file is really making is the one D141 staked: a THIRD kind of card
    // (an ATTACK) now feeds this row and it STILL needs no new `source` member.
    expect(programFor("sv02-117")).toBeUndefined(); // no registry row: it derives from the TEXT
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put 10 damage counters on the Attacking Pokémon.",
      ),
    ).toEqual([{ op: "installRecoil", amount: 100 }]);
  });

  it("the SCALED twin — LANDED at D456, and it joins THIS label too", () => {
    // 🆕🆕 **RE-POINTED RATHER THAN DELETED (D418), AND THE OLD RUNG WAS ASSERTING A
    // STRING THE CATALOG DOES NOT PRINT.** Until D456 this case asserted the sentence
    // derived to NOTHING — spelled with *"(even if **it** is Knocked Out)"*. Corpus line
    // 180 spells it *"(even if **this Pokémon** is Knocked Out)"* and is its only
    // printing, so the rung was a claim about a hand-written paraphrase (D183's defect
    // reaching a refusal). BOTH strings are asserted below: the printed one for what it
    // now derives to, the paraphrase for the fact that the widened anchor admits it too
    // — stated rather than hidden, since no printing carries that spelling today.
    expect(programFor("sv02-143")).toBeUndefined(); // no registry row: it derives from the TEXT
    expect(deriveAttackEffect("During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.")).toEqual([
      { op: "installRecoil", amount: "damageTaken" },
    ]);
    expect(deriveAttackEffect("During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.")).toEqual([
      { op: "installRecoil", amount: "damageTaken" },
    ]);
    // …and this is the claim the file is really making, D141's stake for the FOURTH
    // time: an attack whose amount is not even a NUMBER feeds this row, and it STILL
    // needs no new `COUNTERS_PLACED.source` member.
  });
});
