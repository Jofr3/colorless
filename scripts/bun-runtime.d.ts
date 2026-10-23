// Types for the one Bun API `scripts/` uses, `bun:sqlite`, narrowed to the members
// catalog-manifest.ts calls. Delete this file if `@types/bun` is ever added.

declare module "bun:sqlite" {
  /** A prepared statement, in the two shapes `catalog-manifest.ts` reads. */
  export interface Statement {
    all(): unknown[];
    get(): unknown;
  }
  export class Database {
    constructor(filename: string, options?: { readonly?: boolean });
    query(sql: string): Statement;
  }
}
