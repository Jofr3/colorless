// db-check's `--upstream` diff: stored card ids that tcgdex no longer lists. Report only; nothing
// is deleted. Each set is read on its own, so one set tcgdex stopped serving, or one bad read, is
// reported and the rest of the check still runs.

import { tcgdexSetSchema } from "@colorless/schema";
import { describeError } from "../http/errors";
import { type CatalogSource, SourceRequestError } from "./source";

type Row = Record<string, unknown>;

export type StaleCards = {
  /** Cards tcgdex no longer lists; `reason: "set gone"` when the whole set answers 404. */
  stale: Row[];
  /** Sets whose read failed some other way (a network error, a payload that fails the schema). */
  unreadable: Row[];
};

/** Diffs each stored set's card ids against the set as tcgdex serves it now. */
export async function staleCardIds(
  cards: readonly Row[],
  source: Pick<CatalogSource, "getSet">,
): Promise<StaleCards> {
  const bySet = new Map<string, Set<string>>();
  for (const card of cards) {
    const setId = String(card.set_id);
    const ids = bySet.get(setId) ?? new Set<string>();
    ids.add(String(card.id));
    bySet.set(setId, ids);
  }
  const result: StaleCards = { stale: [], unreadable: [] };
  for (const [setId, stored] of bySet) {
    let upstream: Set<string>;
    try {
      const set = tcgdexSetSchema.parse(await source.getSet(setId));
      upstream = new Set(set.cards.map((card) => card.id));
    } catch (error) {
      if (error instanceof SourceRequestError && error.status === 404) {
        for (const id of stored) result.stale.push({ set_id: setId, id, reason: "set gone" });
      } else {
        result.unreadable.push({ set_id: setId, error: describeError(error) });
      }
      continue;
    }
    for (const id of stored) if (!upstream.has(id)) result.stale.push({ set_id: setId, id });
  }
  return result;
}
