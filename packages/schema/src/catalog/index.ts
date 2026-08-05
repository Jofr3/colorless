// Canonical catalog domain models (P1 milestone 5, D5 — backend-data.md §5.2):
// the vocabulary OUR api serves and the web app consumes. Distinct from
// ../tcgdex (the ingest-side mirror of tcgdex payloads, Tcgdex*-prefixed):
// these are unprefixed, asset URLs are our own `/assets/...` base paths, and
// nullability mirrors the D1 columns (§5.3) instead of upstream optionality.
// The BuilderCard / CardModel view projections stay in the web app for now
// and get derived from `Card` in the frontend-swap milestone.

export * from "./card";
export * from "./common";
export * from "./facets";
export * from "./page";
export * from "./serie";
export * from "./set";
