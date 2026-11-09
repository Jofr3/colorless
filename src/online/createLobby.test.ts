import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, RequestTimeoutError } from "../lib/api";
import { json, stubFetch } from "../test/fetchStub";
import { CREATE_LOBBY_TIMEOUT_MS, createLobbyCode } from "./createLobby";

afterEach(() => vi.useRealTimers());

describe("createLobbyCode", () => {
  it("returns the minted code", async () => {
    stubFetch({ "POST /lobby": () => json({ code: "ABCD" }, 201) });
    await expect(createLobbyCode()).resolves.toBe("ABCD");
  });

  it("keeps the status of a refusal", async () => {
    stubFetch({ "POST /lobby": () => json({ error: "too many lobbies" }, 429) });
    const failure = await createLobbyCode().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(429);
  });

  it("gives up on a server that does not answer, so Create can be pressed again", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );
    const failure = createLobbyCode().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(CREATE_LOBBY_TIMEOUT_MS);
    expect(await failure).toBeInstanceOf(RequestTimeoutError);
    expect(signal?.aborted).toBe(true);
  });
});
