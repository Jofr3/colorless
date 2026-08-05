// tcgdex.dev REST API models (P1 milestone 2) — Zod schemas + inferred types
// for everything we read from https://api.tcgdex.net/v2/en/. Authored against
// live responses (committed in ./__fixtures__, unit-tested in tcgdex.test.ts)
// and swept against the live API by ../../scripts/validate-live.ts.
//
// Names are `tcgdex`-prefixed to leave room for our future canonical domain
// `Card` in the same barrel (docs/workstreams/backend-data.md §5.2).

export * from "./card";
export * from "./common";
export * from "./pricing";
export * from "./serie";
export * from "./set";
