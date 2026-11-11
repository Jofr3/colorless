import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT, repoPath } from "../lib/repo";
import { mergeCorpus } from "./merge-corpus";

const CORPUS = "scripts/mutation/mutants.ts";
const SCRIPT = repoPath("scripts/mutation/merge-corpus.ts");
const HEAD = "export type Mutant = { id: string };\n\nexport const MUTANTS: Mutant[] = [";

const row = (id: string, what = "x") => `\n  {\n    id: "${id}",\n    what: "${what}",\n  },`;
const corpus = (rows: string[], head = HEAD) => `${head}${rows.join("")}\n];\n`;

function merged(base: string, ours: string, theirs: string): string {
  const merge = mergeCorpus(base, ours, theirs);
  if (!merge.ok) throw new Error(merge.problems.join("\n"));
  return merge.text;
}

function problems(base: string, ours: string, theirs: string): string[] {
  const merge = mergeCorpus(base, ours, theirs);
  return merge.ok ? [] : merge.problems;
}

const dir = mkdtempSync(join(tmpdir(), "merge-corpus-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("mergeCorpus", () => {
  const base = corpus([row("a"), row("b")]);

  it("keeps ours' rows, then appends the rows only theirs added, in their order", () => {
    const ours = corpus([row("a"), row("b"), row("o1"), row("o2")]);
    const theirs = corpus([row("a"), row("b"), row("t1"), row("t2")]);
    expect(merged(base, ours, theirs)).toBe(
      corpus([row("a"), row("b"), row("o1"), row("o2"), row("t1"), row("t2")]),
    );
  });

  it("takes a row from the one side that changed it", () => {
    const ours = corpus([row("a", "ours"), row("b")]);
    const theirs = corpus([row("a"), row("b", "theirs")]);
    expect(merged(base, ours, theirs)).toBe(corpus([row("a", "ours"), row("b", "theirs")]));
  });

  it("refuses a row changed differently on both sides, by id", () => {
    expect(
      problems(base, corpus([row("a", "ours"), row("b")]), corpus([row("a", "theirs"), row("b")])),
    ).toEqual(["a: changed differently on both sides"]);
  });

  it("drops a row one side deleted and the other kept, and refuses one the other changed", () => {
    expect(merged(base, corpus([row("a"), row("b")]), corpus([row("b")]))).toBe(corpus([row("b")]));
    expect(merged(base, corpus([row("b")]), corpus([row("a"), row("b")]))).toBe(corpus([row("b")]));
    expect(problems(base, corpus([row("a", "ours"), row("b")]), corpus([row("b")]))).toEqual([
      "a: deleted on one side and changed on the other",
    ]);
  });

  it("keeps a row both sides added alike once, and refuses one they added differently", () => {
    const same = corpus([row("a"), row("b"), row("n")]);
    expect(merged(base, same, same)).toBe(same);
    expect(problems(base, same, corpus([row("a"), row("b"), row("n", "other")]))).toEqual([
      "n: added on both sides with different text",
    ]);
  });

  it("merges the text before the rows like a row", () => {
    const head = HEAD.replace("{ id: string }", "{ id: string; file: string }");
    expect(
      merged(base, corpus([row("a"), row("b"), row("o")]), corpus([row("a"), row("b")], head)),
    ).toBe(corpus([row("a"), row("b"), row("o")], head));
  });

  it("adds the comma ours' last row lacks before appending theirs", () => {
    const bare = corpus([row("a")]).replace(/,\n\];\n$/, "\n];\n");
    expect(merged(corpus([row("a")]), bare, corpus([row("a"), row("t")]))).toBe(
      corpus([row("a"), row("t")]),
    );
  });

  it("refuses an input in which two rows carry one id", () => {
    expect(problems(base, corpus([row("a"), row("a", "twin")]), base)).toEqual([
      "ours: more than one row carries id a",
    ]);
  });
});

const PAST = { merge: "e37c5bba5", ours: "0459b3e32", theirs: "edd023f27" };
const inHistory = Object.values(PAST).every(
  (rev) => spawnSync("git", ["cat-file", "-e", `${rev}^{commit}`], { cwd: REPO_ROOT }).status === 0,
);
const show = (rev: string) =>
  execFileSync("git", ["show", `${rev}:${CORPUS}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });

describe.skipIf(!inHistory)(
  "mergeCorpus on a real conflict (needs history; CI's test job is shallow)",
  () => {
    it("re-merges e37c5bba5's parents into its committed corpus, byte for byte", () => {
      const base = execFileSync("git", ["merge-base", PAST.ours, PAST.theirs], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).trim();
      expect(merged(show(base), show(PAST.ours), show(PAST.theirs)) === show(PAST.merge)).toBe(
        true,
      );
    }, 30_000);
  },
);

describe("merge-corpus as a command", () => {
  const base = corpus([row("a")]);

  /** Runs the script as git runs its merge driver, and returns its run and what it left in %A. */
  function driver(ours: string, theirs: string) {
    const [o, a, b] = [join(dir, "O"), join(dir, "A"), join(dir, "B")];
    writeFileSync(o, base);
    writeFileSync(a, ours);
    writeFileSync(b, theirs);
    const run = spawnSync("bun", [SCRIPT, o, a, b], { encoding: "utf8" });
    return { status: run.status, stderr: run.stderr, written: readFileSync(a, "utf8") };
  }

  it("writes the merge into %A as git's merge driver", () => {
    const run = driver(corpus([row("a"), row("o")]), corpus([row("a"), row("t")]));
    expect(run.status).toBe(0);
    expect(run.written).toBe(corpus([row("a"), row("o"), row("t")]));
  });

  it("exits 1 on a refusal and leaves git's ordinary conflict in %A", () => {
    const run = driver(corpus([row("a", "ours")]), corpus([row("a", "theirs")]));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("a: changed differently on both sides");
    expect(run.written).toContain("<<<<<<< ours");
  });

  it("resolves a conflicted merge from the index's stages when run by hand", () => {
    const repo = join(dir, "repo");
    mkdirSync(join(repo, "scripts/mutation"), { recursive: true });
    const git = (...args: string[]) =>
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
    const write = (text: string) => writeFileSync(join(repo, CORPUS), text);
    git("init", "-q", "-b", "main");
    write(base);
    git("add", CORPUS);
    git("commit", "-qm", "base");
    git("switch", "-qc", "theirs");
    write(corpus([row("a"), row("t")]));
    git("commit", "-qam", "theirs");
    git("switch", "-q", "main");
    write(corpus([row("a"), row("o")]));
    git("commit", "-qam", "ours");
    expect(git("merge", "-q", "theirs").status).not.toBe(0);
    const run = spawnSync("bun", [SCRIPT], { cwd: repo, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(readFileSync(join(repo, CORPUS), "utf8")).toBe(corpus([row("a"), row("o"), row("t")]));
  });
});
