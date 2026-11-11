import { describe, expect, it } from "vitest";
import { docsWritesReport, logicalLines } from "./docs-writes";

const report = (path: string, text: string) => docsWritesReport([{ path, text }]);
const failure = (path: string, text: string) => {
  const result = report(path, text);
  expect(result.ok).toBe(false);
  return result.lines.join("\n");
};

describe("docs-writes", () => {
  it.each([
    ["a secret put", "bunx wrangler secret put PASSWORD_PEPPER"],
    ["a rollback", 'then `bunx wrangler rollback <version id> -m "<why>"`'],
    ["a Time Travel restore", "bunx wrangler d1 time-travel restore colorless --bookmark=<b>"],
    ["a KV put", "bunx wrangler kv key put catalog:epoch 1 --binding CACHE --remote"],
    ["an R2 delete", "bunx wrangler r2 object delete colorless-assets/a.png"],
    ["a remote execute", "bunx wrangler d1 execute colorless --remote --yes --file f.sql"],
    ["a remote migration", "wrangler d1 migrations apply colorless --remote"],
    ["a remote ingest", "cd apps/api && bun scripts/ingest.ts --serie me --remote"],
  ])("fails %s", (_label, line) => {
    expect(failure("README.md", `# Deploy\n\n${line}\n`)).toContain(`README.md:3: ${line}`);
  });

  it("passes the wrapped forms, local targets, the drill and dry runs", () => {
    const text = [
      "bun scripts/with-deploy-token.ts bunx wrangler secret put LOG_TAG_KEY",
      "bun apps/api/scripts/with-deploy-token.ts bunx wrangler rollback <version id>",
      "bunx wrangler d1 execute colorless --local --command 'SELECT 1'",
      "bunx wrangler d1 migrations apply colorless --local",
      "bun scripts/ingest.ts --sets sve",
      "bun scripts/ingest.ts --remote --dry-run",
      "bunx wrangler d1 time-travel restore colorless-drill --bookmark=<B>",
      "bunx wrangler deployments list",
    ].join("\n");
    expect(report("docs/workstreams/backend-data.md", text)).toEqual({
      ok: true,
      lines: ["1 files give every production write the deploy token"],
    });
  });

  it("reads an inline code span wrapped over two lines as one line", () => {
    const text = "Run it (`cd apps/api && bun scripts/ingest.ts\n  --remote`) once.\n";
    expect(failure("docs/workstreams/deck-builder.md", text)).toContain(
      "docs/workstreams/deck-builder.md:1: Run it (`cd apps/api && bun scripts/ingest.ts --remote`)",
    );
    expect(
      report(
        "docs/a.md",
        "Run (`bun scripts/with-deploy-token.ts bun scripts/ingest.ts\n  --remote`).",
      ).ok,
    ).toBe(true);
  });

  it("does not join across a fence or a blank line", () => {
    const fenced = "```sh\necho `date\nbunx wrangler rollback <id>\n```\n";
    expect(failure("docs/a.md", fenced)).toContain("docs/a.md:3: bunx wrangler rollback <id>");
    expect(logicalLines({ path: "docs/a.md", text: "a `b\n\nc` d" })).toEqual([
      { line: 1, text: "a `b" },
      { line: 2, text: "" },
      { line: 3, text: "c` d" },
    ]);
  });

  it("reads a script's printed hints line by line", () => {
    const text = "console.log(`  restore: bunx wrangler d1 time-travel restore colorless`);";
    expect(failure("apps/api/scripts/d1.ts", text)).toContain("apps/api/scripts/d1.ts:1:");
    expect(
      logicalLines({ path: "apps/api/scripts/x.ts", text: "const a = `b\nc`;" }).map((l) => l.line),
    ).toEqual([1, 2]);
  });
});
