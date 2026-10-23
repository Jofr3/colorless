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

const ALIASES = [
  { reprint: "sv02-245", twin: "sv02-150", card: "Copperajah ex — Bronze Body" },
  { reprint: "swsh10.5-069", twin: "sv01-191", card: "Rare Candy" },
  { reprint: "swsh10.5-078", twin: "sv01-189", card: "Professor's Research" },
  { reprint: "swsh10.5-084", twin: "sv01-189", card: "Professor's Research" },
] as const;

describe("D180 — the four reprint aliases", () => {
  it("resolves every new id to the SAME PROGRAM OBJECT as its twin", () => {
    for (const { reprint, twin } of ALIASES) {
      expect(programFor(reprint), `${reprint} has no program`).toBeDefined();
      expect(programFor(reprint), `${reprint} does not SHARE ${twin}'s program`).toBe(
        programFor(twin),
      );
    }
  });

  it("keeps every PRE-EXISTING print of the same three cards on that one program", () => {
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
    for (const { reprint } of ALIASES) {
      expect(FIXTURE_POOL[reprint], `${reprint} is now a fixture — pin its TEXT`).toBeUndefined();
      expect(M.printed[reprint]).toBeUndefined();
      expect(M.absent).not.toContain(reprint);
    }
  });
});

describe("the TWINS' printed text — the anchor the aliases are asserted against", () => {
  it("Professor's Research sv01-189 prints exactly what PROFESSORS_RESEARCH implements", () => {
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
  it("states its own scope, so an empty result is never read as a whole-catalog one", () => {
    const units = fixtureTextUnits();
    const ids = new Set(units.map((u) => u.id));
    expect(ids.size).toBeGreaterThan(150);
    expect(ids.size).toBeLessThan(M.rows);
    expect(units.length).toBeGreaterThan(200);
    expect(M.sixSet.rows).toBe(978);
    expect(M.sixSet.sets).toHaveLength(6);
    expect(M.rows).toBeGreaterThan(M.sixSet.rows);
  });

  it("is EMPTY — no printed text is READ on one fixture and UNREAD on another", () => {
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
