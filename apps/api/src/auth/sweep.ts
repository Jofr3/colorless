// The daily sweep (wrangler.jsonc `triggers.crons`, run by `scheduled` in ../index.ts): deletes
// expired sessions and sign-in counters whose window has passed. Both are already ignored on
// read, so this only stops the tables growing with rows nobody will present again: a session
// whose browser never comes back, a counter for an address that never retries.
//
// Deletes run in chunks of SWEEP_CHUNK rows, so no single statement holds the database for
// long, and stop after SWEEP_MAX_CHUNKS per table: a large backlog clears over several days
// rather than one run spending a large share of the Free plan's 100,000 D1 rows written a day.
// DELETE … LIMIT needs a SQLite compile option, hence the rowid subquery.

const SWEEP_CHUNK = 500;
const SWEEP_MAX_CHUNKS = 20;

export type SweepCounts = { sessions: number; rateLimits: number };

async function sweepTable(
  db: D1Database,
  statement: string,
  nowMs: number,
  chunk: number,
  maxChunks: number,
): Promise<number> {
  let deleted = 0;
  for (let round = 0; round < maxChunks; round++) {
    const { meta } = await db.prepare(statement).bind(nowMs, chunk).run();
    deleted += meta.changes;
    if (meta.changes < chunk) break;
  }
  return deleted;
}

export async function sweepExpired(
  db: D1Database,
  nowMs: number,
  { chunk = SWEEP_CHUNK, maxChunks = SWEEP_MAX_CHUNKS } = {},
): Promise<SweepCounts> {
  return {
    sessions: await sweepTable(
      db,
      "DELETE FROM sessions WHERE rowid IN (SELECT rowid FROM sessions WHERE expires_at <= ?1 LIMIT ?2)",
      nowMs,
      chunk,
      maxChunks,
    ),
    rateLimits: await sweepTable(
      db,
      "DELETE FROM auth_rate_limits WHERE rowid IN (SELECT rowid FROM auth_rate_limits WHERE reset_at <= ?1 LIMIT ?2)",
      nowMs,
      chunk,
      maxChunks,
    ),
  };
}
