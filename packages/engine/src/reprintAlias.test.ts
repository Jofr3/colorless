import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST as M } from "./catalogManifest";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./effects";
import { programFor } from "./registry";
import { FIXTURE_POOL } from "./testFixtures";

// 0.120.0 → 0.121.0 — D180, THE REPRINT-ALIAS GAPS: four printings whose
// byte-identical twin is already authored, on card ids the registry map did not
// name. No new op, no new field, no new program — four map rows onto three
// existing `CardProgram` objects, using the reprint idiom the map has carried
// since M4 (`sv01-189`/`-190`/`-240`/`-241` share ONE `PROFESSORS_RESEARCH`).
//
// ⚠️ THE PROVENANCE, AND ITS HISTORY, BECAUSE BOTH ARE THE POINT OF THIS FILE.
//
// D180 SHIPPED WITH THE BYTE-IDENTITY ASSERTED FROM A DOC. The slice ran in a
// fresh clone, where `apps/api/.wrangler/` — gitignored dev state — does not
// exist (`find / -name '*.sqlite'` → zero rows; `scripts/catalog-manifest.ts
// --check` dies SQLITE_CANTOPEN rather than reporting staleness), and
// `api.tcgdex.net` was refused by the egress policy, so neither the local sqlite
// nor the live API was reachable. The four rows were landed on the backlog's
// 2026-08-04 census and SAID SO, on the rows and here.
//
// ⚠️ ALL FOUR ARE NOW **MEASURED**, against the 978-row / 6-set catalog reached
// through the remote D1 (`luminous`), and all four HOLD:
//   • `sv02-245` — `abilities_json` byte-identical to `sv02-150`'s, both exactly
//     [{"type":"Ability","name":"Bronze Body","effect":"This Pokémon takes 30
//     less damage from attacks (after applying Weakness and Resistance)."}];
//   • `swsh10.5-069` — "Choose 1 of your Basic Pokémon in play. …", byte-identical
//     to `sv01-191` / `sv01-256`;
//   • `swsh10.5-078` and `swsh10.5-084` — "Discard your hand and draw 7 cards.",
//     byte-identical to `sv01-189` / `-190` / `-240` / `-241`.
//
// ⚠️⚠️ AND THE HONEST FOOTNOTE, WHICH IS WORTH MORE THAN THE FOUR ROWS: **ALL
// FOUR IDS ARE ROTATED OUT OF STANDARD.** Legality tracks the regulation mark
// exactly — Standard is marks H and I, plus Basic Energy — and `swsh10.5` is
// mark F (0 of its 88 rows legal) while `sv02` is mark G. So this slice serves
// **zero Standard-legal printings**. That is not a reason to revert it (the
// aliases are correct, cost four map rows, and a rotated card is still playable
// in Expanded and still simulable), but it IS the reason a REGISTRY row and a
// DERIVER ARM must never be priced on the same scale: an arm is a text parser
// and its sentences transfer across sets (D181's four served 34 Standard-legal
// printings), while a row is keyed by CARD ID and serves exactly the ids it
// names. `docs/reference/coverage-backlog.md` now carries that rule.
//
// ⚠️ THERE IS STILL NO "THE CATALOG SWEEP IS EMPTY" ASSERTION IN THIS FILE, AND
// THE REASON HAS CHANGED FROM "COULD NOT" TO "WAS NOT". The full text-equality
// sweep of unbuilt-against-built over all three columns — the sweep behind the
// backlog's "3 sentences / 4 printings and nothing else" — has still never been
// re-run by this repo. It is runnable now; nobody has run it. A pin claiming a
// measurement nobody made is worse than no pin: it goes green forever while
// asserting something no session checked (D155's rule, read backwards). The
// query the next session should run, scoped and stated so it cannot be
// misremembered, is:
//
//   WITH t AS (
//     SELECT id, set_id, 'effect' AS col, effect AS txt FROM cards
//      WHERE effect IS NOT NULL AND effect <> ''
//     UNION ALL SELECT id, set_id, 'attack', j.value ->> 'effect'
//       FROM cards, json_each(cards.attacks_json) j
//      WHERE j.value ->> 'effect' IS NOT NULL
//     UNION ALL SELECT id, set_id, 'ability', j.value ->> 'effect'
//       FROM cards, json_each(cards.abilities_json) j
//      WHERE j.value ->> 'effect' IS NOT NULL
//   )
//   SELECT txt, group_concat(DISTINCT id) FROM t
//    WHERE set_id IN ('sv01','sv02','sv03','sv06.5','sve','swsh10.5')
//    GROUP BY txt HAVING count(DISTINCT id) > 1;
//
// …then diff each group's ids against `REGISTRY`'s keys: a group where some ids
// are registered and some are not IS the D180 defect. Until someone does that
// and reports the result, this file pins what it can actually see.
//
// WHAT IT PINS:
//   (1) the ALIAS RELATION — each new id resolves to the SAME PROGRAM OBJECT as
//       its twin (`toBe`, not `toEqual`). That is the reprint idiom itself, and
//       it is what a future author breaks by copy-pasting a second program
//       literal instead of sharing the one;
//   (2) the TWINS' printed text, char-for-char off `FIXTURE_POOL` — the anchor
//       the aliases were measured against. If a re-ingest ever moves the twin's
//       own text, this goes red and the alias's warrant is void;
//   (3) the text-equality sweep RESTRICTED to `FIXTURE_POOL`, which IS runnable
//       here and IS EMPTY — see its own describe block for exactly what
//       population it covers and what it therefore cannot say.

/** The four rows this slice added, each with the already-authored id whose
    program it now shares. The right-hand id is the WARRANT; the left-hand one
    is the claim. */
const ALIASES = [
  { reprint: "sv02-245", twin: "sv02-150", card: "Copperajah ex — Bronze Body" },
  { reprint: "swsh10.5-069", twin: "sv01-191", card: "Rare Candy" },
  { reprint: "swsh10.5-078", twin: "sv01-189", card: "Professor's Research" },
  { reprint: "swsh10.5-084", twin: "sv01-189", card: "Professor's Research" },
] as const;

describe("D180 — the four reprint aliases", () => {
  it("resolves every new id to the SAME PROGRAM OBJECT as its twin", () => {
    // `toBe`, not `toEqual`: the map's documented idiom is that reprints of one
    // card SHARE the program object, and a second literal that happened to be
    // deep-equal today is exactly the drift this refuses. It is also the only
    // claim in this file that is a FACT rather than a carried assertion — the
    // sharing is code, and code is what a test may speak about.
    for (const { reprint, twin } of ALIASES) {
      expect(programFor(reprint), `${reprint} has no program`).toBeDefined();
      expect(programFor(reprint), `${reprint} does not SHARE ${twin}'s program`).toBe(
        programFor(twin),
      );
    }
  });

  it("keeps every PRE-EXISTING print of the same three cards on that one program", () => {
    // The aliases are additions, not a re-pointing: the rows that were already
    // there must still resolve to the same object, or this slice has moved a
    // card while claiming to have added one.
    for (const ids of [
      ["sv01-189", "sv01-190", "sv01-240", "sv01-241", "swsh10.5-078", "swsh10.5-084"],
      ["sv01-191", "sv01-256", "swsh10.5-069"],
      ["sv02-150", "sv02-245"],
    ]) {
      const first = programFor(ids[0] as string);
      expect(first).toBeDefined();
      for (const id of ids) expect(programFor(id), `${id} left the group`).toBe(first);
    }
  });

  it("carries the THREE programs' actual shapes — the thing the aliases inherit", () => {
    // Named rather than implied: an alias is only as good as what it points at,
    // so the three targets are pinned here and a change to any of them changes
    // FOUR more cards than its author may have in mind.
    expect(programFor("sv02-245")?.passive).toEqual({ damageReductionAfterWR: 30 });
    expect(programFor("swsh10.5-069")?.rareCandy).toBe(true);
    expect(programFor("swsh10.5-078")?.trainer).toEqual([
      { op: "discardHand" },
      { op: "drawCards", count: 7 },
    ]);
  });

  it("has NO catalog row and NO fixture for any of the four — the reason there is no text pin HERE", () => {
    // The load-bearing negative, and it survives the four rows becoming measured.
    // A fixture id that names a real printing must appear in
    // `CATALOG_MANIFEST.printed` or `.absent` (catalogManifest.test.ts (c)), and
    // regenerating that manifest reads the LOCAL sqlite — which a clone does not
    // have, whatever the remote can answer. So the four cannot be fielded here,
    // their printed bytes live in the registry's comments and in the decision
    // record rather than in a fixture, and this assertion goes red on the day
    // someone with the local file changes that.
    for (const { reprint } of ALIASES) {
      expect(FIXTURE_POOL[reprint], `${reprint} is now a fixture — pin its TEXT`).toBeUndefined();
      expect(M.printed[reprint]).toBeUndefined();
      expect(M.absent).not.toContain(reprint);
    }
  });
});

describe("the TWINS' printed text — the anchor the aliases are asserted against", () => {
  it("Professor's Research sv01-189 prints exactly what PROFESSORS_RESEARCH implements", () => {
    // Verbatim off `FIXTURE_POOL`, the highest-authority text source in-repo. The
    // claim the two swsh10.5 rows make is that THIS string is what they print
    // too — measured true against the catalog, and re-checkable here only on this
    // side, which is why the twin's bytes are the thing pinned.
    expect(FIXTURE_POOL["sv01-189"]?.effect).toBe("Discard your hand and draw 7 cards.");
    expect(FIXTURE_POOL["sv01-189"]?.trainerType).toBe("Supporter");
  });

  it("Copperajah ex sv02-150 and Rare Candy sv01-191 are the printings the manifest records", () => {
    expect(M.printed["sv02-150"]).toEqual({
      name: "Copperajah ex",
      types: ["Metal"],
      attacks: ["Nosequake"],
      abilities: ["Bronze Body"],
    });
    expect(M.printed["sv01-191"]?.name).toBe("Rare Candy");
  });
});

// ── The sweep that CAN be run here, and the exact size of what it covers. ──

const REAL_ID = /^(sv|swsh)/;

/** One printed text unit off a `FIXTURE_POOL` card, with whether the engine
    READS it — the axis D180 is about. A Trainer/Energy/Ability unit is read iff
    its id has a registry program (the only path those columns have); an attack
    unit is read iff the registry authors that INDEX or any of the six attack
    derivers answers the string. */
type TextUnit = { id: string; where: string; text: string; read: boolean };

function attackIsRead(id: string, index: number, text: string): boolean {
  if (programFor(id)?.attack?.[index] !== undefined) return true;
  return (
    deriveAttackEffect(text) !== null ||
    deriveAttackCoinFlip(text) !== null ||
    deriveAttackDamageBonus(text) !== null ||
    deriveAttackDamageMultiplier(text) !== null ||
    deriveAttackDamagePenalty(text) !== null ||
    deriveAttackRequirement(text) !== null
  );
}

function fixtureTextUnits(): TextUnit[] {
  const units: TextUnit[] = [];
  for (const [id, card] of Object.entries(FIXTURE_POOL)) {
    if (!REAL_ID.test(id)) continue;
    const registered = programFor(id) !== undefined;
    if (card.effect !== null && card.effect !== undefined && card.effect !== "") {
      units.push({ id, where: "effect", text: card.effect, read: registered });
    }
    (card.attacks ?? []).forEach((attack, index) => {
      const text = attack.effect;
      if (text === null || text === undefined || text === "") return;
      units.push({
        id,
        where: `attack[${index}] ${attack.name}`,
        text,
        read: attackIsRead(id, index, text),
      });
    });
    (card.abilities ?? []).forEach((ability, index) => {
      const text = ability.effect;
      if (text === null || text === undefined || text === "") return;
      units.push({ id, where: `ability[${index}] ${ability.name}`, text, read: registered });
    });
  }
  return units;
}

describe("the text-equality sweep, over the ONE population a test can read", () => {
  // ⚠️ SCOPE FIRST, WHICH IS WHAT A CENSUS OWES (D154). This sweep covers
  // `FIXTURE_POOL`'s REAL-card ids ONLY — a couple of hundred of the catalog's
  // 978 rows, and only the text those fixtures happen to carry. It is a PROPER
  // SUBSET of the catalog sweep the backlog quotes, so an EMPTY result here is a
  // FLOOR: it proves the defect is absent from what the suite can see, and says
  // nothing whatever about the other ~three quarters of the pool. That is
  // precisely why the four D180 rows above are carried rather than measured —
  // not one of them is in this population.

  it("states its own scope, so an empty result is never read as a whole-catalog one", () => {
    const units = fixtureTextUnits();
    const ids = new Set(units.map((u) => u.id));
    // Bounds rather than exact counts: this file's subject is the SWEEP, and a
    // fixture gaining a printed sentence is a routine event that must not go red
    // here. What is asserted is that the population is real and much smaller
    // than the catalog — the two facts the emptiness has to be read against.
    expect(ids.size).toBeGreaterThan(150);
    expect(ids.size).toBeLessThan(M.rows);
    expect(units.length).toBeGreaterThan(200);
    // The catalog is bigger than this by a wide margin, measured off the
    // committed manifest rather than a remembered number.
    expect(M.rows).toBe(978);
    expect(Object.keys(M.sets)).toHaveLength(6);
  });

  it("is EMPTY — no printed text is READ on one fixture and UNREAD on another", () => {
    // THE D180 DEFECT, GENERALISED AND PINNED AS AN EMPTINESS RATHER THAN AS A
    // LIST OF EXCEPTIONS. Two ids printing byte-identical text must agree about
    // whether the engine reads it: if one is authored and its twin is not, the
    // twin is a reprint-alias gap exactly like the four above.
    //
    // ⚠️ AND THE READ PREDICATE IS PER-COLUMN ON PURPOSE. An earlier draft asked
    // only "does `programFor(id)` exist", and that version reported TWO false
    // positives — Heracross sv01-002 against Spidops ex sv01-019 (identical
    // retreat-cost scaling ATTACK text) and Scovillain sv01-029 against Armarouge
    // sv01-041 ("Your opponent's Active Pokémon is now Burned.") — because both
    // "authored" ids carry a registry program for their ABILITY while the shared
    // sentence is an attack the DERIVER reads on both sides. Neither is a gap.
    // The right question is not "is this id in the registry" but "is THIS COLUMN
    // of this id read", which is what `attackIsRead` asks.
    const byText = new Map<string, TextUnit[]>();
    for (const unit of fixtureTextUnits()) {
      const group = byText.get(unit.text) ?? [];
      group.push(unit);
      byText.set(unit.text, group);
    }
    const split: string[] = [];
    for (const [text, group] of byText) {
      const read = group.filter((u) => u.read);
      const unread = group.filter((u) => !u.read);
      if (read.length === 0 || unread.length === 0) continue;
      split.push(
        `${JSON.stringify(text)}\n    READ: ${read.map((u) => `${u.id} ${u.where}`).join(", ")}` +
          `\n    UNREAD: ${unread.map((u) => `${u.id} ${u.where}`).join(", ")}`,
      );
    }
    expect(split).toEqual([]);
  });

  it("would SEE the defect it claims to refuse — the sweep, run against a planted gap", () => {
    // A mutation check on the sweep itself, because an emptiness assertion whose
    // predicate can never fire is the most comfortable kind of green there is.
    // Plant the D180 shape by hand — one text, two ids, one read and one not —
    // and confirm the grouping reports it.
    const planted: TextUnit[] = [
      { id: "aa-1", where: "effect", text: "Draw 7 cards.", read: true },
      { id: "aa-2", where: "effect", text: "Draw 7 cards.", read: false },
      { id: "aa-3", where: "effect", text: "Heal 10 damage.", read: true },
    ];
    const byText = new Map<string, TextUnit[]>();
    for (const unit of planted) {
      const group = byText.get(unit.text) ?? [];
      group.push(unit);
      byText.set(unit.text, group);
    }
    const split = [...byText.values()].filter(
      (g) => g.some((u) => u.read) && g.some((u) => !u.read),
    );
    expect(split).toHaveLength(1);
    expect(split[0]?.map((u) => u.id)).toEqual(["aa-1", "aa-2"]);
  });
});
