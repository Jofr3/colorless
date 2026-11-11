// Canonical catalog domain models (backend-data.md §5.2):
// the vocabulary OUR api serves and the web app consumes. Distinct from
// ../tcgdex (the ingest-side mirror of tcgdex payloads, Tcgdex*-prefixed):
// these are unprefixed, asset URLs are our own `/assets/...` base paths, and
// nullability mirrors the D1 columns (§5.3) instead of upstream optionality.

export * from "./card";
export * from "./common";
export * from "./facets";
export * from "./page";
export * from "./query";
export * from "./serie";
export * from "./set";
export * from "./cardIndex";
