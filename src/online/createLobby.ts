import { isValidLobbyCode } from "@colorless/schema";
import { ApiError, withDeadline } from "../lib/api";
import { apiUrl } from "../lib/apiOrigin";

/** How long minting a lobby may take before Create gives up and can be pressed again. */
export const CREATE_LOBBY_TIMEOUT_MS = 10_000;

/** Ask the server to mint a lobby (POST /lobby: no body, no credentials — the
    first hello claims the host seat, not this call). Throws on any failure,
    including a malformed code and a server that does not answer in time; a refusal is an ApiError
    with its status, so a 429 can say it was the create limit. */
export function createLobbyCode(): Promise<string> {
  return withDeadline(CREATE_LOBBY_TIMEOUT_MS, async (signal) => {
    const res = await fetch(apiUrl("/lobby"), { method: "POST", signal });
    if (!res.ok) throw new ApiError(res.status, undefined);
    const body = (await res.json()) as { code?: unknown };
    if (typeof body.code !== "string" || !isValidLobbyCode(body.code))
      throw new Error("malformed create response");
    return body.code;
  });
}
