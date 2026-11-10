// The Worker secrets production must hold before a release, checked by the `secrets` step of
// scripts/release-gate.ts against `wrangler secret list` (names only; values are never readable).
// Every secret production uses is gated, because none of them fails where the release would see
// it (src/env.ts). The pepper and the log key degrade quietly: an unpeppered production keeps
// hashing passwords the old way, and an untagged one logs no account trail. The Google client's
// two answer a loud 503, but only to someone who tries Google sign-in, so a deleted or renamed one
// would go unnoticed until a user hit it (build audit ENV6, decision 12).

export const REQUIRED_SECRETS = [
  "PASSWORD_PEPPER",
  "LOG_TAG_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

/** The secret names in `wrangler secret list --format json` output, which is a JSON array of
    `{name, type}` that wrangler may precede with warning lines. Throws when there is no such
    array, so a changed or failed listing is never read as "nothing missing". */
export function secretNamesOf(listOutput: string): string[] {
  const end = listOutput.lastIndexOf("]");
  let parsed: unknown = null;
  // The list starts on a line of its own; a warning line may hold a "[" of its own ("[WARNING]").
  for (const line of listOutput.matchAll(/^[ \t]*\[/gm)) {
    try {
      parsed = JSON.parse(listOutput.slice(line.index, end + 1));
      break;
    } catch {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`wrangler secret list printed no JSON list:\n${listOutput}`);
  }
  return parsed.map((entry: unknown) => {
    const name =
      typeof entry === "object" && entry !== null && "name" in entry ? entry.name : undefined;
    if (typeof name !== "string") {
      throw new Error(`wrangler secret list printed an entry without a name:\n${listOutput}`);
    }
    return name;
  });
}

/** The required secrets the listing lacks, in REQUIRED_SECRETS order. */
export function missingSecrets(
  listOutput: string,
  required: readonly string[] = REQUIRED_SECRETS,
): string[] {
  const present = new Set(secretNamesOf(listOutput));
  return required.filter((name) => !present.has(name));
}
