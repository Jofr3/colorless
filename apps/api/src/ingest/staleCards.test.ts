import { describe, expect, it } from "vitest";
import { createSource } from "./source";
import { staleCardIds } from "./staleCards";

const sv01 = {
  id: "sv01",
  name: "Scarlet & Violet",
  cardCount: { total: 1, official: 1 },
  cards: [{ id: "sv01-001", localId: "001", name: "Pineco" }],
  serie: { id: "sv", name: "SV" },
  releaseDate: "2023-03-31",
  legal: { standard: true, expanded: true },
};

/** tcgdex as the fetch transport sees it: sv01 served, `gone1` removed, `drift1` reshaped. */
const source = createSource("fetch", {
  delayMs: 0,
  retries: 0,
  fetchImpl: (async (url: string) => {
    if (url.endsWith("/sets/gone1")) return Response.json({ error: "not found" }, { status: 404 });
    if (url.endsWith("/sets/drift1")) return Response.json({ id: "drift1", cards: "none" });
    if (url.endsWith("/sets/locked1")) return new Response("no", { status: 403 });
    return Response.json(sv01);
  }) as unknown as typeof fetch,
});

describe("staleCardIds", () => {
  it("reports a removed set's cards and an unreadable set, and still checks the others", async () => {
    const result = await staleCardIds(
      [
        { set_id: "gone1", id: "gone1-001" },
        { set_id: "gone1", id: "gone1-002" },
        { set_id: "drift1", id: "drift1-001" },
        { set_id: "locked1", id: "locked1-001" },
        { set_id: "sv01", id: "sv01-001" },
        { set_id: "sv01", id: "sv01-999" },
      ],
      source,
    );
    expect(result.stale).toEqual([
      { set_id: "gone1", id: "gone1-001", reason: "set gone" },
      { set_id: "gone1", id: "gone1-002", reason: "set gone" },
      { set_id: "sv01", id: "sv01-999" },
    ]);
    expect(result.unreadable).toEqual([
      { set_id: "drift1", error: expect.stringMatching(/^ZodError/) },
      { set_id: "locked1", error: "SourceRequestError: HTTP 403 for /sets/locked1" },
    ]);
  });
});
