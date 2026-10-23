import { describe, expect, it } from "vitest";
import { programFor } from "./registry";
import {
  excerptNamesId,
  REFUSED_PRINTINGS,
  RESOLVED_REFUSALS,
  type RefusedPrinting,
} from "./refusedPrintings";

// D480 — THE BUILD-STATE GUARD, AND THE FALSIFICATION THAT BOUGHT IT.
//
// 🛑 WHAT THIS SLICE FOUND, STATED FIRST. D480's work order asked for "two
// hand-authored `registry.ts` rows and nothing else" — Unfair Stamp `sv06-165` and
// Team Rocket's Archer `sv10-170`/`-223`. **Both had already shipped**, at D271 and
// D326, 208 and 153 decisions before the work order was written. The price was not
// wrong in its expensive clause (the failure mode six of the last eight slices hit);
// it was wrong in its CHEAP clause, and the true price was ZERO.
//
// The chain that carried the false claim is worth naming, because every link in it
// was written by a slice that was being careful:
//
//   • **D270** refused the two cards for a play gate *"no `BoardCondition` spells and
//     `GameState` carries no datum for"*. TRUE when written.
//   • **D271** built the datum, the condition member AND Unfair Stamp — and left
//     D270's paragraph standing in two files. It corrected the copy in
//     `censusAtHead.test.ts` (*"the union held 23 members at D270, not five"*) and
//     not the copies in `registry.ts` and `effects.ts`.
//   • **D326** built Team Rocket's Archer, and left the same two paragraphs standing.
//   • **D479** ran a refusal audit, opened `BoardCondition`, `GameState` and
//     `playableIf`, correctly falsified the EXPRESSIBILITY clause — and then wrote
//     *"the two cards … are still unbuilt … for want of a registry row"*, which it
//     took from the paragraph it was falsifying rather than from the id table.
//   • **D480** was commissioned to build them.
//
// ⚠️ **THE GENERAL SHAPE: A REFUSAL CARRIES TWO CLAIMS AND THEY HAVE DIFFERENT
// ORACLES.** *"This cannot be expressed"* is settled by opening a declaration, and
// D479's method is exactly right about it. *"This is not built"* is settled by
// `programFor`, and nothing in this repo was checking it. Three prose rules had been
// written about it — D321's `git grep <id>`, D330's *"check whether the piece has
// shipped before pricing it"*, D343's *"D330's lesson at its second site"* — and the
// fourth occurrence still happened.
//
// 🛑 SO WHAT GOES RED HERE, and every case is an edit somebody will really make
// (D200 → D214: a check whose author cannot name the edit that breaks it is vacuous):
//
//   (1) build a printing listed in `REFUSED_PRINTINGS` and leave its row → §2 fails
//       BY ID, and the row hands you the doc block to correct;
//   (2) delete a `RESOLVED_REFUSALS` correction stamp, or revert the doc block to the
//       state in which the refusal stood alone → §3's citation case fails BY ID;
//   (3) un-build one of D271's/D326's rows → §3's build case fails BY ID;
//   (4) empty either table to make the other pass → §5's non-vacuity cases fail;
//   (5) mistype an id, or move a cited doc block without moving its claim → §4 fails,
//       naming the file and the excerpt that no longer occurs exactly once;
//   (6) weaken `excerptNamesId` to a constant → §4's negative control fails.

// ── 1. The finding, DRIVEN rather than asserted in prose ─────────────────────

/** 🆕🆕🆕 D568 — the citation the four Briar rows carried until D568 built the card and deleted
    them (effects.ts' D207 doc block, now carrying its dated correction). Kept as a literal so
    the suffix-reading rungs keep a witness after the rows are gone. */
const RETIRED_BRIAR_EXCERPT =
  '      remaining" (Briar sv07-132/-163/-171, sv08.5-100 — unbuilt, see registry.ts)';

describe("D480 — the three printings the work order priced as unbuilt", () => {
  it("🛑 all three SHIP, and the price of D479's row was ZERO registry rows", () => {
    // The whole of D480's original work order, read off the registry rather than
    // off a doc block. This is the assertion the work order itself needed.
    expect(programFor("sv06-165")).toEqual({
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn" },
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 2 } }],
    });
    expect(programFor("sv10-170")).toEqual({
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Team Rocket" },
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
    });
    // The alternate art is the SAME program object, as a reprint must be.
    expect(programFor("sv10-223")).toEqual(programFor("sv10-170"));
  });

  it("the two cards are kept APART by the one number that separates them", () => {
    // Not a restatement of the case above: it is the rung that would have caught a
    // build which reused Unfair Stamp's program for Archer's id. The controller's
    // hand is 5 either way, so only the OPPONENT's count tells them apart, and the
    // gates differ only by the `owner` prefix.
    const stamp = programFor("sv06-165");
    const archer = programFor("sv10-170");
    expect(stamp).not.toEqual(archer);
    expect(stamp?.trainerPlayableIf).toEqual({ kind: "yourPokemonKoedOnOpponentsLastTurn" });
    expect(archer?.trainerPlayableIf).toEqual({
      kind: "yourPokemonKoedOnOpponentsLastTurn",
      owner: "Team Rocket",
    });
  });

  it("the fixture demonstrators ship too — three of them, not two", () => {
    // `fix-unfairstamp` (D271), then `fix-stamp` and `fix-archer` (D326, on ONE
    // board so a swap cannot hide). A work order claiming these cards need
    // authoring is claiming these five ids do not resolve.
    for (const id of ["fix-unfairstamp", "fix-stamp", "fix-archer"]) {
      expect(programFor(id), id).toBeDefined();
    }
  });
});

// ── 2. THE GUARD, forward — every refused printing is still refused ──────────

describe("REFUSED_PRINTINGS — the build-state claim, as a command", () => {
  it("🛑 no declared-refused printing has a registry program", () => {
    // (1) in the header. The day one of these is built, THIS is the line that
    // reddens, and it names the id — which is the whole difference between this
    // and the three prose rules that preceded it.
    const built = REFUSED_PRINTINGS.filter((r) => programFor(r.id) !== undefined);
    expect(
      built.map((r) => `${r.id} (${r.card}, ${r.surface}) — refused by ${r.since}`),
      "these printings are BUILT and their refusals are stale: correct the cited doc block, then delete the row",
    ).toEqual([]);
  });

  it("every row names a surface `programFor` is an oracle for — never an attack", () => {
    // D204's per-surface rule, kept live: *"All four N's Zoroark ex printings ALREADY
    // carry a program (their 'Trade' Ability); it is the ATTACK that is unbuilt. A
    // whole-id flag reads that card as built."* The type already excludes `"attack"`;
    // this is the rung that fails if somebody widens the union to admit it.
    const surfaces: readonly RefusedPrinting["surface"][] = [
      "trainer",
      "tool",
      "ability",
      "passive",
      "specialEnergy",
    ];
    for (const row of REFUSED_PRINTINGS) {
      expect(surfaces, `${row.id} names a surface programFor cannot answer for`).toContain(
        row.surface,
      );
    }
  });
});

// ── 3. THE GUARD, reverse — the falsified refusals stay falsified ────────────

describe("RESOLVED_REFUSALS — the correction, as a command", () => {
  it("🛑 every printing D480 found already built is STILL built", () => {
    const missing = RESOLVED_REFUSALS.filter((r) => programFor(r.id) === undefined);
    expect(
      missing.map((r) => `${r.id} (${r.card}) — built by ${r.builtBy}`),
      "a printing D480 recorded as built has lost its registry program",
    ).toEqual([]);
  });

  it("names both the decision that BUILT it and the decision that REFUSED it", () => {
    // D479's own distinction: a refusal that was false when written, one that
    // rotted, and one whose reason alone changed are three different findings, and
    // only a row carrying both ends can say which it is.
    for (const row of RESOLVED_REFUSALS) {
      expect(row.builtBy, row.id).toMatch(/^D\d+$/);
      expect(row.refusedBy, row.id).toContain("D");
      expect(row.refusedBy, row.id).not.toBe(row.builtBy);
    }
  });
});

// ── 4. The citations are REAL — the anti-fiction rung ────────────────────────

describe("the citations", () => {
  it("🛑 every REFUSED row's excerpt actually names its id — whole or as a suffix", () => {
    // Limit 2 in the module's header, and D204's vacuous guard: *"SIX OF TEN FLAGGED
    // ROWS CARRY IDS BELONGING TO OTHER CARDS … Every COUNT was right, which is why
    // nothing caught it."* This engine has no catalog to check an id against, so what
    // it checks instead is that the id and the prose agree — a transposed id cannot be
    // typed here without also being typed into the doc block it claims to quote.
    for (const row of REFUSED_PRINTINGS) {
      expect(
        excerptNamesId(row.cite.excerpt, row.id),
        `${row.id} is not named by the excerpt it cites in ${row.cite.file}`,
      ).toBe(true);
    }
  });

  it("…and the predicate REFUSES an id the excerpt does not name", () => {
    // (6) in the header — the negative control, without which the case above passes
    // on `return true`. `sv99-999` shares neither set nor number with anything cited.
    for (const row of REFUSED_PRINTINGS) {
      expect(excerptNamesId(row.cite.excerpt, "sv99-999"), row.id).toBe(false);
    }
    // And the SUFFIX half is load-bearing rather than decorative: THREE of the nine
    // rows are cited by prose that never spells the id whole (🆕🆕🆕 D555: TWO of the
    // SEVEN — D555 built Samurott `sv10.5w-023`/`-107` and deleted both rows, the
    // suffix-cited `-107` among them; Briar's pair remains), so a build that reduced
    // this to `excerpt.includes(id)` would fail them. Driven, not claimed — and the
    // number is MEASURED here rather than asserted in the module's prose, because a
    // count nothing recomputes is the defect this whole file exists about.
    const suffixOnly = REFUSED_PRINTINGS.filter((r) => !r.cite.excerpt.includes(r.id));
    // 🆕🆕🆕 D568 — `[]`: Briar's pair left with its build (all four rows deleted together), so
    // NO row is suffix-cited at this head. The split reading is still load-bearing for the next
    // shorthand citation, so it is driven below on the retired citation's own bytes.
    expect(suffixOnly.map((r) => r.id)).toEqual([]); // 🆕🆕🆕 D568 — `sv07-163`/`sv07-171` left with Briar's build // 🆕🆕🆕 D555 — `sv10.5w-107` left with its build
    // …and each of those IS matched by the split reading.
    for (const row of suffixOnly)
      expect(excerptNamesId(row.cite.excerpt, row.id), row.id).toBe(true);
    for (const id of ["sv07-163", "sv07-171"])
      expect(excerptNamesId(RETIRED_BRIAR_EXCERPT, id), id).toBe(true);
  });

  it("the split reading does not admit a NEIGHBOURING printing of the same set", () => {
    // The risk the suffix rule buys: `sv07-132/-163/-171` names three printings, and
    // a fourth id in the same set must NOT match off the set alone. `-199` is not in
    // the excerpt, so the number half refuses it.
    // 🆕🆕🆕 D568 — the Briar row is GONE (built), so the rung reads the retired citation's own
    // bytes rather than the table: the predicate's contract did not move with the row.
    expect(REFUSED_PRINTINGS.find((r) => r.id === "sv07-163")).toBeUndefined();
    expect(excerptNamesId(RETIRED_BRIAR_EXCERPT, "sv07-199")).toBe(false);
    // …while the three that ARE printed there all match, so the refusal is not
    // accidentally narrow either. Both directions, this repo's standing rule.
    for (const id of ["sv07-132", "sv07-163", "sv07-171"]) {
      expect(excerptNamesId(RETIRED_BRIAR_EXCERPT, id), id).toBe(true);
    }
  });
});

// ── 5. Non-vacuity and the attribution controls ──────────────────────────────

describe("the guard cannot pass by being empty or by being unwired", () => {
  it("both tables are non-empty and their ids are unique", () => {
    // (4) in the header. §2 is trivially green on an empty table and §3 is trivially
    // green on an empty one; the two guard each other only if neither can be emptied
    // without a red line.
    expect(REFUSED_PRINTINGS.length).toBeGreaterThanOrEqual(1); // 🆕 CARD REVISION B08 — 2 -> 1, Reversal Energy sv02-192 built (Standard-legal) and deleted; // 🆕🆕🆕 D568 — 6 -> 2, Briar ×4 built and deleted together; // 🆕🆕🆕 D555 — 9 -> 7, the Samurott pair built and deleted; 🆕🆕🆕 D562 — 7 -> 6, Survival Brace built and deleted
    expect(RESOLVED_REFUSALS.length).toBe(3);
    const refusedIds = REFUSED_PRINTINGS.map((r) => r.id);
    const resolvedIds = RESOLVED_REFUSALS.map((r) => r.id);
    expect(new Set(refusedIds).size).toBe(refusedIds.length);
    expect(new Set(resolvedIds).size).toBe(resolvedIds.length);
    // And the two tables are DISJOINT — a printing cannot be refused and resolved.
    expect(refusedIds.filter((id) => resolvedIds.includes(id))).toEqual([]);
  });

  it("🛑 the oracle is wired — it returns BOTH answers over this file's own ids", () => {
    // The D214 shape, and the one that matters most here: §2 would be green on a
    // broken `programFor` import that returned `undefined` for everything, and it
    // would be green for exactly the wrong reason. So the same call is driven to a
    // DEFINED answer on the same run, on the ids this slice is about.
    //
    // 🆕🆕🆕 D562 — RE-POINTED from Unfair Stamp `sv06-165` (built) / Survival Brace
    // `sv06-164` (refused): D562 BUILT the Brace and deleted its row, so that pair is now
    // built/built and could not tell a working oracle from one answering "defined" for
    // everything. The new pair keeps the rung's whole shape — neighbouring printings in
    // ONE set, one built and one refused, MEASURED at this head: Crispin `sv07-133` is
    // BUILT (D561) and Briar `sv07-132` is REFUSED (a `REFUSED_PRINTINGS` row).
    // 🆕🆕🆕 D568 — RE-POINTED AGAIN: D568 BUILT Briar and deleted its rows, so Crispin/Briar is
    // built/built. The new pair, MEASURED at this head, keeps the shape — neighbouring printings
    // in ONE set, one built and one refused: `sv02-193` is BUILT and Reversal Energy's second
    // printing `sv02-192` is REFUSED (a `REFUSED_PRINTINGS` row).
    // 🆕 CARD REVISION B08 — RE-POINTED AGAIN: B08 BUILT `sv02-192` (Standard-legal since
    // 714256b3, a `REVERSAL_ENERGY` row) and deleted its row, so `sv02-193`/`sv02-192` is
    // built/built. The new pair, MEASURED at this head, keeps the shape — printings in ONE set,
    // one built and one refused: Koraidon ex `sv01-125` is BUILT and Muk `sv01-127` is REFUSED
    // (the table's last row).
    expect(programFor("sv01-125")).toBeDefined();
    expect(programFor("sv01-127")).toBeUndefined();
    // Sharper still: the two are neighbouring printings in the SAME set, one built
    // and one refused, so a `programFor` keyed on anything coarser than the id fails
    // here rather than passing quietly.
    expect(REFUSED_PRINTINGS.some((r) => r.id === "sv01-127")).toBe(true);
    expect(REFUSED_PRINTINGS.some((r) => r.id === "sv01-125")).toBe(false);
  });

  it("every row carries a reason and a decision, so the list is a record and not an allowlist", () => {
    // D471: a class defined NEGATIVELY describes the instrument. A bare id list would
    // be a suppression file; a row that must state WHY and SINCE is a finding.
    for (const row of REFUSED_PRINTINGS) {
      expect(row.why.length, row.id).toBeGreaterThan(80);
      expect(row.since, row.id).toMatch(/^D\d+$/);
      expect(row.card.length, row.id).toBeGreaterThan(0);
    }
  });
});
