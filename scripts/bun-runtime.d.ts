/**
 * THE BUN-RUNTIME SHIM (D481) — the two Bun APIs `scripts/` actually uses.
 *
 * WHY A SHIM RATHER THAN `@types/bun`. D481 put `scripts/` inside `tsc -b` for
 * the first time and measured what the region costs to typecheck: SIX errors
 * across twelve files, and TWO of them were `scripts/catalog-manifest.ts`
 * reaching for Bun's runtime — `bun:sqlite` (TS2307) and the `Bun` global
 * (TS2868). Neither is a defect in the file; both are a missing type package.
 *
 * The obvious fix is `bun add -d @types/bun`. It was refused HERE, deliberately
 * and with the reason recorded, because a slice whose whole subject is
 * verification coverage should not also be the slice that adds a transitive
 * dependency tree to the repo — and `@types/bun` redeclares globals that
 * `@types/node` also declares, which is a measurement of its own that this
 * slice did not take. **If that dependency ever lands, DELETE THIS FILE**: it
 * exists only while the real types are absent.
 *
 * ⚠️ WHAT A SHIM CAN AND CANNOT DO. It cannot certify that the two signatures
 * below match Bun's — they are hand-written, and a hand-written type is exactly
 * the kind of claim this slice exists to stop trusting. What it CAN do is make
 * the other 365 lines of `catalog-manifest.ts` checkable instead of unchecked,
 * which is the trade being made.
 *
 * ⚠️ SO IT IS DELIBERATELY NARROW — only the members the one caller uses. A new
 * Bun API reached for from `scripts/` does NOT silently typecheck as `any`; it
 * fails with "property does not exist", and the next author has to widen this
 * file on purpose. A wide `declare const Bun: any` would have been shorter and
 * would have re-opened the hole it is here to close.
 */

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

/** Bun's file handle — `.text()` only; nothing here streams or writes. */
interface BunFile {
  text(): Promise<string>;
}

declare const Bun: {
  file(path: string): BunFile;
};
