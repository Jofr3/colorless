// The full D1 schema — what drizzle.config.ts points drizzle-kit at, and what
// app code imports tables from. Two logical schemas, one database (§3.3):
// catalog (ingested, read-only) and user data (read-write).

export * from "./catalog";
export * from "./users";
