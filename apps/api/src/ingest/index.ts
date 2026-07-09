// Ingest library barrel (P1 milestone 4) — pure, unit-tested modules the
// ingest CLI (apps/api/scripts/ingest.ts) composes: tcgdex→row mapping,
// SQL-literal escaping, and per-table upsert builders.

export * from "./map";
export * from "./sql";
export * from "./upserts";
