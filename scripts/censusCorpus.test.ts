import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CORPORA, corpusRecords, main, regenerated, withRecords } from "./census-corpus";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Card = [id: string, set: string, category: string, legal: number, attacks: unknown[] | null];

/** A catalog sqlite holding `cards` in the sets sv01 (serie sv) and me01 (serie me). */
function catalog(cards: readonly Card[]): string {
  const dir = mkdtempSync(join(tmpdir(), "census-corpus-"));
  dirs.push(dir);
  const path = join(dir, "catalog.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`create table sets (id text primary key, serie_id text);
    insert into sets values ('sv01', 'sv'), ('me01', 'me');
    create table cards (id text primary key, set_id text, category text, legal_standard integer,
      attacks_json text);`);
  const insert = db.prepare("insert into cards values (?, ?, ?, ?, ?)");
  for (const [id, set, category, legal, attacks] of cards) {
    insert.run(id, set, category, legal, attacks === null ? null : JSON.stringify(attacks));
  }
  db.close();
  return path;
}

const records = (path: string, serie: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return corpusRecords(db, serie);
  } finally {
    db.close();
  }
};

describe("corpusRecords", () => {
  it("counts a serie's legal Pokémon printings per attack sentence, sorted by sentence", () => {
    const path = catalog([
      ["sv01-1", "sv01", "Pokemon", 1, [{ effect: "Flip a coin." }, { effect: "Draw a card." }]],
      ["sv01-2", "sv01", "Pokemon", 1, [{ effect: "Flip a coin." }, { effect: "" }, {}]],
      ["sv01-3", "sv01", "Pokemon", 0, [{ effect: "Rotated out." }]],
      ["sv01-4", "sv01", "Trainer", 1, [{ effect: "A Trainer's attack." }]],
      ["sv01-5", "sv01", "Pokemon", 1, null],
      ["me01-1", "me01", "Pokemon", 1, [{ effect: "Mega only." }]],
    ]);
    expect(records(path, "sv")).toBe("1 Draw a card.\n2 Flip a coin.");
    expect(records(path, "me")).toBe("1 Mega only.");
  });

  it("refuses a sentence the corpus format cannot hold", () => {
    const placeholder = `A $${"{"}x}.`;
    for (const effect of ["Use `this`.", placeholder, "Back\\slash.", "Two\nlines.", " Padded."]) {
      const path = catalog([["sv01-1", "sv01", "Pokemon", 1, [{ effect }]]]);
      expect(() => records(path, "sv"), effect).toThrow("cannot be a corpus record");
    }
  });
});

describe("withRecords", () => {
  const source = "import x;\n\nconst CORPUS = `\n1 Old.\n`;\n\nexport function f() {}\n";

  it("replaces only the literal's body", () => {
    expect(withRecords(source, "CORPUS", "2 New.\n3 Newer.")).toBe(
      "import x;\n\nconst CORPUS = `\n2 New.\n3 Newer.\n`;\n\nexport function f() {}\n",
    );
  });

  it("refuses a file without the literal, or with two", () => {
    expect(() => withRecords(source, "CORPUS_ME", "1 A.")).toThrow("expected one");
    expect(() => withRecords(source + source, "CORPUS", "1 A.")).toThrow("expected one");
  });
});

describe("main", () => {
  it("skips the check without a catalog, and refuses to write without one", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--check"], undefined)).toBe(0);
    expect(log.mock.calls[0]?.[0]).toMatch(/SKIPPED/);
    expect(main([], undefined)).toBe(1);
    expect(error.mock.calls[0]?.[0]).toMatch(/cannot generate/);
  });

  it("fails the check when a corpus differs from the catalog's", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = catalog([["sv01-1", "sv01", "Pokemon", 1, [{ effect: "Flip a coin." }]]]);
    expect(main(["--check"], path)).toBe(1);
    expect(error.mock.calls.map(([line]) => line)).toEqual(
      CORPORA.map(({ out }) => `${out} is STALE — run: bun scripts/census-corpus.ts`),
    );
  });

  it("passes the check when every corpus is what the catalog writes", () => {
    const path = catalog([["sv01-1", "sv01", "Pokemon", 1, [{ effect: "Flip a coin." }]]]);
    const files = regenerated(path);
    const current = new Map(files.map(({ out, body }) => [out, body]));
    expect(
      regenerated(path, (out) => current.get(out) ?? "").every((f) => f.body === f.committed),
    ).toBe(true);
    expect(files[0]?.body).toContain("const CORPUS = `\n1 Flip a coin.\n`;");
  });
});
