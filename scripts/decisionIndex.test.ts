import { describe, expect, it } from "vitest";
import { DECISIONS, decisionIndex, HISTORY, NUMBERED_ARCHIVE, PROGRESS } from "./decision-index";

const files: Record<string, string> = {
  [DECISIONS]: [
    "# Decisions",
    "| # | Decision | Choice |",
    "|---|---|---|",
    "| D1 | Backend data | Own DB |",
    "",
    "### 2026-10-22 — The Lua frontend replaces React",
    "",
    "Text.",
  ].join("\n"),
  [NUMBERED_ARCHIVE]: [
    "# Numbered decisions",
    "",
    "| # | Decision | Choice |",
    "|---|---|---|",
    "| D101 | Klawf parking | choice |",
    "| **D467** | 2026-09-04 | **THE ATTACKER'S OWN BENCH** text |",
    "",
    "### 2026-09-05 — a dated heading here is not an entry",
  ].join("\n"),
  [HISTORY]: "# History\n\n## D14 — Engine core contract\n",
  [PROGRESS]:
    "# Progress\n\n### 2026-08-20 — build session #200 (P3-M5 — D369, cross-board tool)\n",
};

const index = () =>
  decisionIndex((file) => {
    const text = files[file];
    if (text === undefined) throw new Error(`unexpected read: ${file}`);
    return text;
  });

describe("decision-index", () => {
  it("points archived rows at the archive file and the rest at decisions.md", () => {
    const { body, numbered } = index();
    expect(body).toContain("| D1 | Backend data | decisions.md:4 |");
    expect(body).toContain("| D101 | Klawf parking | archive/decisions-numbered.md:5 |");
    expect(body).toContain(
      "| D467 | THE ATTACKER'S OWN BENCH text | archive/decisions-numbered.md:6 |",
    );
    expect(body).toContain("| D14 | Engine core contract | archive/simulator-history.md:3 |");
    expect(body).toContain("| D369 | cross-board tool | archive/progress.md:3 |");
    expect(numbered).toBe(5);
  });

  it("lists dated entries from decisions.md only", () => {
    const { body, dated } = index();
    expect(body).toContain("| 2026-10-22 | The Lua frontend replaces React | decisions.md:6 |");
    expect(body).not.toContain("a dated heading here");
    expect(dated).toBe(1);
  });
});
