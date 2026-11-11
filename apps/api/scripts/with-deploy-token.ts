// Runs one command with the production-write Cloudflare token. The ambient
// CLOUDFLARE_API_TOKEN is read-only, so wrangler can list, query and read production but not change
// it; a write goes through here (or through release-gate.ts's deploy, which loads the same token).
//
//   bun scripts/with-deploy-token.ts wrangler d1 migrations apply colorless --remote
//   bun scripts/with-deploy-token.ts bunx wrangler rollback <version id> -m "<why>"
//   bun scripts/with-deploy-token.ts bun scripts/ingest.ts --remote ...
//
// The token is read from ~/.local/state/secrets/CLOUDFLARE_DEPLOY_TOKEN, or the file
// CLOUDFLARE_DEPLOY_TOKEN_FILE names (backend-data.md §3.7.2, "Cloudflare tokens").

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { deployTokenEnv } from "../src/releaseChecks.ts";

/** A file's text, or undefined when it cannot be read. */
export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) {
    console.error("usage: bun scripts/with-deploy-token.ts <command> [args...]");
    process.exit(1);
  }
  const withToken = deployTokenEnv(process.env, homedir(), readText);
  if ("error" in withToken) {
    console.error(withToken.error);
    process.exit(1);
  }
  const run = spawnSync(command, args, { stdio: "inherit", env: withToken.env });
  if (run.error) console.error(`with-deploy-token: ${command}: ${run.error.message}`);
  process.exit(run.status ?? 1);
}
