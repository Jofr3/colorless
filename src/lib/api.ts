// The typed client for the api Worker (backend-data.md §6) — the ONE module
// features go through to talk to the backend over http. Every URL derives
// from apiOrigin.ts, every request sends the session cookie (`credentials:
// "include"` — the cookie is SameSite=None and the api is cross-origin), and
// every non-2xx becomes a typed ApiError so features can branch on `.status`.
//
// TYPES-ONLY by design: this module imports nothing but types from
// @luminous/schema — no zod, no runtime schema values — so the web bundle
// stays zod-free (the same constraint that split zod off the online chunk in
// M8). The api already boundary-parses everything it serves; the client
// trusts the wire and casts to the shared types.

import type {
  Card,
  CardBrief,
  CardCategory,
  CatalogFacets,
  CreateDeckRequest,
  CreateFolderRequest,
  Deck,
  DeckSummary,
  Folder,
  LoginRequest,
  Paginated,
  PatchDeckRequest,
  PatchFolderRequest,
  RegisterRequest,
  ReorderRequest,
  Serie,
  SetBrief,
  SetWithCards,
  UpdateProfileRequest,
  User,
} from "@luminous/schema";
import { apiUrl } from "./apiOrigin";

/** A non-2xx api response. `status` is the http status; `body` is the parsed
    JSON error payload when the api sent one (terse `{error}` objects, plus
    extras like the 400 `cardIds` list), else undefined. Notable statuses:
    401 logged out · 404 absent/not-yours · 409 duplicate email · 429
    rate-limited · 503 OAuth not configured. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const detail =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `request failed with status ${status}`;
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** The api's 400 `{error: "unknown card id(s)", cardIds}` payload, if that's
    what an ApiError's `.body` is — the ids the catalog rejected. */
export function unknownCardIdsOf(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null || !("cardIds" in body)) return null;
  const ids = (body as { cardIds: unknown }).cardIds;
  return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : null;
}

// ---- Session recovery (the ONE owner of 401 → re-probe → retry-once) --------
// A mid-session 401 usually means the cookie expired, but it can also be a
// one-off (a session rotated in another tab, a hiccup). Instead of every
// feature hand-rolling "on 401, refresh() the auth context", the client owns
// it: an unexpected 401 asks the installed handler to re-probe the session,
// and if the session turns out to still be alive the failed request is
// retried once. When the probe lands on signed-out, the handler's own state
// change (AuthProvider → "anonymous") flips the UI; the 401 then propagates
// to the caller as before.

/** Re-probe the session; resolve true when it's still alive (retry the
    request), false when the user is really signed out. */
type SessionRecoveryHandler = () => Promise<boolean>;

let sessionRecovery: SessionRecoveryHandler | null = null;
/** In-flight probe, shared so a burst of parallel 401s asks once. */
let recovery: Promise<boolean> | null = null;

/** Installed by AuthProvider (null on teardown). One owner at a time. */
export function setSessionRecoveryHandler(handler: SessionRecoveryHandler | null): void {
  sessionRecovery = handler;
}

function attemptRecovery(): Promise<boolean> {
  const handler = sessionRecovery;
  if (handler === null) return Promise.resolve(false);
  recovery ??= handler().then(
    (alive) => {
      recovery = null;
      return alive;
    },
    () => {
      recovery = null;
      return false;
    },
  );
  return recovery;
}

/** How a call reaches the wire: the http verb, an optional JSON body, and
    whether a 401 is worth recovering from. */
interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Opt OUT of session recovery: a 401 propagates as-is, unprobed and
      unretried. Set by the endpoints where a 401 IS the answer rather than a
      symptom — the whole /auth surface (me() = signed out, login = wrong
      credentials, and the recovery probe itself is /auth/me, so recovering
      there would recurse). Declared per call instead of inferred from a
      `/auth/` path prefix (the P2-M1 shape): the prefix silently decided for
      any route added under it, and couldn't express the reverse case. */
  recoverSession?: false;
}

/** The one fetch wrapper every call goes through: cookie on every request,
    JSON in/out, non-2xx → ApiError, 204 → undefined. A 401 runs the
    session-recovery hook above and retries once, unless the call opted out. */
async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  let response = await send(path, init);
  if (response.status === 401 && init?.recoverSession !== false && (await attemptRecovery())) {
    response = await send(path, init);
  }
  if (!response.ok) throw new ApiError(response.status, await errorBody(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function send(path: string, init?: { method?: string; body?: unknown }): Promise<Response> {
  const hasBody = init?.body !== undefined;
  return fetch(apiUrl(path), {
    method: init?.method ?? "GET",
    credentials: "include",
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init?.body) : undefined,
  });
}

/** The parsed error payload, or undefined when it isn't JSON (proxies and
    the runtime itself can answer with plain-text error pages). */
async function errorBody(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("application/json")) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** `?key=value…` from the defined, non-empty params — or "" when none
    survive, so an unfiltered call hits the bare path. An array value emits
    one occurrence per non-empty item (`?type=Fire&type=Water`) — the api's
    repeatable-param convention; an empty array is omitted entirely. */
function queryString(params: Record<string, string | number | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== "") search.append(key, item);
      }
    } else {
      search.append(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

// ---- Catalog (public, KV-cached server-side) --------------------------------

/** GET /cards filters (backend-data.md §6). Declared here — the schema
    package types the response envelope but not the query params. All
    optional; empties are omitted from the query string. */
export type CardsQuery = {
  /** Exact card id(s), e.g. "sv06.5-001" — batched deck hydration. Repeatable;
      the server caps the list at 100 values (400 above), dedupes duplicates
      and silently omits unknown ids. Composes with every other filter. */
  id?: string[];
  /** Substring match, case-insensitive. */
  name?: string;
  /** Case-insensitive WHOLE-name equality (no wildcards) — the import flow's
      "find this exact card" lookup, distinct from the substring `name`. */
  nameExact?: string;
  category?: CardCategory;
  /** Energy type(s), e.g. "Grass" — an array ORs within the dimension. */
  type?: string | string[];
  /** Exact rarity string(s), e.g. "Double rare" — an array ORs within the dimension. */
  rarity?: string | string[];
  /** Pokémon stage(s), wire vocabulary ("Basic" | "Stage1" | "Stage2" | …). */
  stage?: string | string[];
  /** Printed rule-box marker(s) — exact values from GET /facets `suffixes`
      ("ex" | "V" | "VMAX" | "MEGA" | …), an array ORs within the dimension.
      Pokémon-only in the data; NULL on every row until an ingest fills the
      column, so the vocabulary (and the rail section it feeds) is empty. */
  suffix?: string | string[];
  /** Trainer subtype(s) ("Item" | "Supporter" | "Stadium" | "Tool" | …). */
  trainerType?: string | string[];
  /** Energy subtype(s): "Normal" | "Special". */
  energyType?: string | string[];
  /** A set id, e.g. "sv06". */
  set?: string;
  /** A serie id, e.g. "sv" — cards whose set belongs to the serie. */
  serie?: string;
  /** Exact illustrator, case-sensitive — values come verbatim from GET /facets. */
  illustrator?: string;
  /** Case-insensitive substring over RULES TEXT: ability/attack names and
      effects, plus Trainer/Special-Energy `effect` prose. (Known imprecision:
      the ability/attack halves match inside the stored JSON blobs, so a term
      can brush a key name; the `effect` half is prose and does not. The
      Trainer/Energy half landed in D197 — before it, no term could return a
      Trainer at all.) */
  text?: string;
  regulationMark?: string;
  /** Inclusive hp bounds. */
  hpMin?: number;
  hpMax?: number;
  legal?: "standard" | "expanded";
  /** Result order; the server defaults to "set" (collector order). */
  sort?: "name" | "hp-desc" | "set";
  /** 1-based; defaults server-side to 1. */
  page?: number;
  /** Defaults server-side to 50, max 100. */
  pageSize?: number;
};

/** Search the card catalog — a page of briefs plus the total match count. */
export function getCards(params: CardsQuery = {}): Promise<Paginated<CardBrief>> {
  return request(`/cards${queryString(params)}`);
}

/** One full canonical card by tcgdex id, e.g. "sv06.5-001". Unknown id → 404. */
export function getCard(id: string): Promise<Card> {
  return request(`/cards/${encodeURIComponent(id)}`);
}

/** Every set brief (optionally one serie's), ordered by release date. */
export function getSets(serie?: string): Promise<SetBrief[]> {
  return request(`/sets${queryString({ serie })}`);
}

/** One full set with its card briefs, ordered by local id. */
export function getSet(id: string): Promise<SetWithCards> {
  return request(`/sets/${encodeURIComponent(id)}`);
}

/** Every serie with its nested set briefs. */
export function getSeries(): Promise<Serie[]> {
  return request("/series");
}

/** The catalog's filter vocabularies (each a sorted string[]) — what the
    builder's option-driven filters offer instead of hardcoded constants. */
export function getFacets(): Promise<CatalogFacets> {
  return request("/facets");
}

// ---- Assets (plain URLs — these feed <img src>, not fetch) ------------------

/** The url of a card scan on the api's lazy R2 mirror. */
export function cardImageUrl(
  cardId: string,
  quality: "high" | "low",
  ext: "webp" | "png" | "jpg" = "webp",
): string {
  return apiUrl(`/assets/cards/${encodeURIComponent(cardId)}/${quality}.${ext}`);
}

/** The url of a set's logo or symbol on the api's lazy R2 mirror. */
export function setAssetUrl(
  setId: string,
  kind: "logo" | "symbol",
  ext: "png" | "webp" = "png",
): string {
  return apiUrl(`/assets/sets/${encodeURIComponent(setId)}/${kind}.${ext}`);
}

// ---- Auth -------------------------------------------------------------------
// Every call here carries `recoverSession: false`: on this surface a 401 IS
// the answer, not a symptom to re-probe (and me() is the probe itself).

/** Create an account; the 201 sets the session cookie. 409 = duplicate email. */
export function register(body: RegisterRequest): Promise<User> {
  return request("/auth/register", { method: "POST", body, recoverSession: false });
}

/** Sign in; the 200 sets the session cookie. Uniform 401 on any failure. */
export function login(body: LoginRequest): Promise<User> {
  return request("/auth/login", { method: "POST", body, recoverSession: false });
}

/** End the session server-side and clear the cookie. */
export function logout(): Promise<void> {
  return request("/auth/logout", { method: "POST", recoverSession: false });
}

/** Who the session cookie says I am. Throws ApiError 401 when logged out —
    deliberately NOT swallowed here; "401 means signed out" is the caller's
    branch, not this module's. */
export function me(): Promise<User> {
  return request("/auth/me", { recoverSession: false });
}

/** Rename yourself (P5-5). 400 when the name is blank or over 64 chars; 401
    when the session is gone — and, like every /auth call, NOT retried through
    session recovery, because there a 401 IS the answer. */
export function updateProfile(body: UpdateProfileRequest): Promise<User> {
  return request("/auth/me", { method: "PATCH", body, recoverSession: false });
}

/** The url that STARTS an OAuth flow — assign it to window.location (it
    302s to the provider), don't fetch it. The api answers 503 until the
    provider's secrets are installed. */
export function oauthStartUrl(provider: "discord" | "google"): string {
  return apiUrl(`/auth/oauth/${provider}`);
}

// ---- Decks & folders (every route needs a session; 401 otherwise) -----------

/** Every deck of mine as list rows (`cardCount`, no card lists). */
export function listDecks(): Promise<DeckSummary[]> {
  return request("/decks");
}

/** One full deck of mine, card list included. Someone else's id → 404. */
export function getDeck(id: string): Promise<Deck> {
  return request(`/decks/${encodeURIComponent(id)}`);
}

/** Create a deck; the server mints the id. Unknown cardIds → ApiError 400
    whose body carries the offending `cardIds`. */
export function createDeck(body: CreateDeckRequest): Promise<Deck> {
  return request("/decks", { method: "POST", body });
}

/** Patch fields and/or wholesale-replace `cards`. Absent = keep, null =
    clear (format, folderId); an empty patch → 400. */
export function patchDeck(id: string, body: PatchDeckRequest): Promise<Deck> {
  return request(`/decks/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

export function deleteDeck(id: string): Promise<void> {
  return request(`/decks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Persist a manual reorder: absolute `position` assignments, applied
    atomically (all land or none do). An id that isn't mine → ApiError 400
    naming it in `ids`. */
export function reorderDecks(positions: ReorderRequest["positions"]): Promise<void> {
  return request("/decks/reorder", { method: "POST", body: { positions } });
}

/** Every folder of mine as a FLAT list — the client builds the tree. */
export function listFolders(): Promise<Folder[]> {
  return request("/folders");
}

export function createFolder(body: CreateFolderRequest): Promise<Folder> {
  return request("/folders", { method: "POST", body });
}

/** Rename and/or move. Moving under itself or a descendant → 400. */
export function patchFolder(id: string, body: PatchFolderRequest): Promise<Folder> {
  return request(`/folders/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

/** Subfolders cascade away; contained decks fall to the library root. */
export function deleteFolder(id: string): Promise<void> {
  return request(`/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Folder twin of `reorderDecks` — same body, same atomicity, same 400. */
export function reorderFolders(positions: ReorderRequest["positions"]): Promise<void> {
  return request("/folders/reorder", { method: "POST", body: { positions } });
}
