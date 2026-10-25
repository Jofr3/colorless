import { describe, expect, it } from "vitest";
import { BANNER_BY_ID, bannerOfId } from "./banners";
import { FOSSIL_IDS } from "./fossils";
import { canonicalPrinting, withReprints } from "./printGroups";
import { programFor, registryCardIds } from "./registry";
import { PROGRAM_ALIAS } from "./registryAliases.generated";

const REGENERATE = "re-run `bun scripts/registry-aliases.ts`";

/** Each print_key group with a reprint, keyed by its canonical printing, members included. */
const groups = new Map<string, string[]>();
for (const [member, canonical] of Object.entries(PROGRAM_ALIAS)) {
  const members = groups.get(canonical) ?? [canonical];
  members.push(member);
  groups.set(canonical, members);
}

describe("reprints that share a print_key share one program", () => {
  it("maps each reprint straight to a canonical printing that is not itself aliased", () => {
    const chained = Object.entries(PROGRAM_ALIAS).filter(
      ([member, canonical]) => member === canonical || Object.hasOwn(PROGRAM_ALIAS, canonical),
    );
    expect(chained).toEqual([]);
    expect(groups.size).toBeGreaterThan(0);
  });

  it("keys a REGISTRY row only on its group's canonical printing", () => {
    const onReprint = registryCardIds().filter((id) => Object.hasOwn(PROGRAM_ALIAS, id));
    expect(
      onReprint.map((id) => `${id} (canonical ${PROGRAM_ALIAS[id]})`),
      `a reprint carries its own REGISTRY row: delete it, or ${REGENERATE} if it is the group's only row`,
    ).toEqual([]);
  });

  it("resolves every printing of a group to the canonical printing's program", () => {
    const programmed = [...groups].filter(([canonical]) => programFor(canonical) !== undefined);
    expect(programmed.length).toBeGreaterThan(0);
    const split: string[] = [];
    for (const [canonical, members] of groups) {
      const program = programFor(canonical);
      for (const id of members) if (programFor(id) !== program) split.push(`${id} vs ${canonical}`);
    }
    expect(split, `a group reaches two programs; ${REGENERATE}`).toEqual([]);
  });

  it("reads a listed banner on every printing of its group", () => {
    const split: string[] = [];
    for (const [id, banner] of Object.entries(BANNER_BY_ID)) {
      for (const member of withReprints([id])) {
        if (bannerOfId(member) !== banner) split.push(`${member} vs ${id}`);
      }
    }
    expect(split).toEqual([]);
  });

  it("lists every printing of an Antique Fossil's group as a fossil", () => {
    for (const id of FOSSIL_IDS) {
      for (const member of withReprints([id])) expect(FOSSIL_IDS.has(member), member).toBe(true);
    }
  });

  it("leaves a printing without a reprint as its own canonical printing", () => {
    expect(canonicalPrinting("fix-attacker")).toBe("fix-attacker");
    expect([...withReprints(["fix-attacker"])]).toEqual(["fix-attacker"]);
  });
});
