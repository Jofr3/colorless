import { isValidLobbyCode } from "@luminous/schema";
import { apiUrl } from "../lib/apiOrigin";

/** Ask the server to mint a lobby (POST /lobby: no body, no credentials — the
    first hello claims the host seat, not this call). Throws on any failure,
    including a malformed code. */
export async function createLobbyCode(): Promise<string> {
  const res = await fetch(apiUrl("/lobby"), { method: "POST" });
  if (!res.ok) throw new Error(`create failed: ${res.status}`);
  const body = (await res.json()) as { code?: unknown };
  if (typeof body.code !== "string" || !isValidLobbyCode(body.code))
    throw new Error("malformed create response");
  return body.code;
}
