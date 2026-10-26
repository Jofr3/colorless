// Types for the one Bun API `scripts/` uses, `bun:sqlite`, narrowed to the members the scripts
// call. Delete this file if `@types/bun` is ever added.

declare module "bun:sqlite" {
  /** A prepared statement, in the two shapes the scripts read. */
  export interface Statement {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }
  export class Database {
    constructor(filename: string, options?: { readonly?: boolean });
    query(sql: string): Statement;
  }
}
