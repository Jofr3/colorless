// The typed client for the api Worker, the one module features use to talk to the backend. Every
// request sends the session cookie (`credentials: "include"`, since the api is a different origin
// of the same site and the cookie is SameSite=Lax), and every non-2xx becomes a typed ApiError.

import type {
  Card,
  CardBrief,
  CardIndexPayload,
  CardsQueryParams,
  CatalogFacets,
  CreateDeckRequest,
  Deck,
  DeleteAccountRequest,
  DeckSummary,
  LoginRequest,
  OAuthProvider,
  Paginated,
  PatchDeckRequest,
  RegisterRequest,
  Serie,
  SetBrief,
  UpdateProfileRequest,
  User,
} from "@colorless/schema";
import { apiUrl } from "./apiOrigin";

/** A non-2xx api response. `status` is the http status; `body` is the parsed
    JSON error payload when the api sent one (terse `{error}` objects, plus
    extras like the 400 `cardIds` list), else undefined. Notable statuses:
    401 logged out · 403 a cross-site request, or the wrong email to confirm
    an account deletion · 404 absent/not-yours · 409 duplicate email, a deck
    changed since this version (the body carries the current deck) or the
    deck limit · 429 rate-limited · 503 OAuth not configured, sign-in briefly
    unavailable (with Retry-After) or no free lobby code. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** The seconds a 429 or 503 said to wait (its `Retry-After`), when it said. */
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, body: unknown, retryAfterSeconds?: number) {
    const detail =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `request failed with status ${status}`;
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Session recovery: an unexpected 401 asks the installed handler to re-probe the session, and if it
// is still alive the failed request is retried once.

/** Re-probe the session; resolve true when it's still alive (retry the
    request), false when the user is really signed out. */
type SessionRecoveryHandler = () => Promise<boolean>;

let sessionRecovery: SessionRecoveryHandler | null = null;
/** In-flight probe, shared so a burst of parallel 401s asks once. */
let recovery: Promise<boolean> | null = null;

/** Installed by src/lua/bridge.ts (null on teardown). One owner at a time. */
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
  /** How long the call may take, body included, before it is abandoned. Default
      REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Let the request outlive the page (a save sent as the tab is hidden or closed). */
  keepalive?: boolean;
}

/** How long a call may take before it is abandoned, in ms: a stalled connection otherwise leaves
    it pending for minutes, and the screen that made it waiting on it. */
export const REQUEST_TIMEOUT_MS = 20_000;
/** A deck write carries a whole card list, and a lost one is recovered from (src/lua/builder.ts),
    so it gets longer before it is given up. */
export const DECK_WRITE_TIMEOUT_MS = 30_000;
/** The card index is one large payload. */
const CARD_INDEX_TIMEOUT_MS = 60_000;

/** A call abandoned at its deadline. Not an ApiError: no response arrived, so a write may still
    have been applied. Nothing retries it here; the screens offer Retry. */
export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`request timed out after ${timeoutMs} ms`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Runs `call` with a signal that aborts after `timeoutMs`, and rejects with a
    RequestTimeoutError then even when the call ignores its signal. Timed with setTimeout, so fake
    timers drive it. */
export async function withDeadline<T>(
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Rejected before the abort, so the race settles with the timeout rather than with the
      // AbortError the aborted fetch rejects with.
      reject(new RequestTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([call(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** The one fetch wrapper every call goes through: cookie on every request,
    JSON in/out, non-2xx → ApiError, 204 → undefined, and a deadline. A 401 runs
    the session-recovery hook above and retries once, unless the call opted out. */
function request<T>(path: string, init?: RequestOptions): Promise<T> {
  return withDeadline(init?.timeoutMs ?? REQUEST_TIMEOUT_MS, (signal) =>
    exchange<T>(path, init, signal),
  );
}

async function exchange<T>(path: string, init: RequestOptions | undefined, signal: AbortSignal) {
  let response = await send(path, init, signal);
  if (response.status === 401 && init?.recoverSession !== false && (await attemptRecovery())) {
    response = await send(path, init, signal);
  }
  if (!response.ok) {
    throw new ApiError(response.status, await errorBody(response), retryAfter(response));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function send(
  path: string,
  init: RequestOptions | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const hasBody = init?.body !== undefined;
  return fetch(apiUrl(path), {
    method: init?.method ?? "GET",
    credentials: "include",
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init?.body) : undefined,
    signal,
    keepalive: init?.keepalive,
  });
}

/** A `Retry-After` given in seconds (the API never sends the date form), else undefined. */
function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("Retry-After");
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value);
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

/** Search the card catalog — a page of briefs plus the total match count. */
export function getCards(params: CardsQueryParams = {}): Promise<Paginated<CardBrief>> {
  return request(`/cards${queryString(params)}`);
}

/** Every card as a compact search row, for searching names and rules text in the browser. */
export function getCardIndex(): Promise<CardIndexPayload> {
  return request("/cards/index", { timeoutMs: CARD_INDEX_TIMEOUT_MS });
}

/** One full canonical card by tcgdex id, e.g. "sv06.5-001". Unknown id → 404. */
export function getCard(id: string): Promise<Card> {
  return request(`/cards/${encodeURIComponent(id)}`);
}

/** The full Cards of up to MAX_ID_VALUES ids, in id order; unknown ids are left out. */
export function getFullCards(ids: string[]): Promise<Card[]> {
  return request(`/cards/full${queryString({ id: ids })}`);
}

/** Every set brief (optionally one serie's), ordered by release date. */
export function getSets(serie?: string): Promise<SetBrief[]> {
  return request(`/sets${queryString({ serie })}`);
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

/** The url of a card scan on the api's lazy R2 mirror, which serves only the high-quality WebP
    (apps/api/src/assets/files.ts `CARD_ASSET_FILES`). */
export function cardImageUrl(cardId: string, quality: "high"): string {
  return apiUrl(`/assets/cards/${encodeURIComponent(cardId)}/${quality}.webp`);
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

/** End every session of my account, this one included, and clear the cookie. 401 when the
    session is already gone. */
export function logoutAll(): Promise<void> {
  return request("/auth/logout-all", { method: "POST", recoverSession: false });
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

/** Delete your own account and everything it owns; the 204 clears the cookie. 401 with
    `{error: "invalid password"}` for a wrong or missing password, or `{error: "unauthorized"}`
    when the session is gone; 403 `{error: "email confirmation mismatch"}` when an OAuth-only
    account's typed email is missing or different; 429 when the password has been guessed at too
    often. */
export function deleteAccount(body: DeleteAccountRequest): Promise<void> {
  return request("/auth/me", { method: "DELETE", body, recoverSession: false });
}

/** The url that STARTS an OAuth flow — assign it to window.location (it
    302s to the provider), don't fetch it. The api answers 503 until the
    provider's secrets are installed. */
export function oauthStartUrl(provider: OAuthProvider, redirect = "/"): string {
  return apiUrl(`/auth/oauth/${provider}?${new URLSearchParams({ redirect })}`);
}

// ---- Decks (every route needs a session; 401 otherwise) --------------------

/** Every deck of mine as list rows: `cardCount`, and the card list of a complete deck. */
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
  return request("/decks", { method: "POST", body, timeoutMs: DECK_WRITE_TIMEOUT_MS });
}

/** Patch fields and/or wholesale-replace `cards`. Absent = keep, null =
    clear (format, folderId); an empty patch → 400. `keepalive` lets the
    request outlive the page. */
export function patchDeck(
  id: string,
  body: PatchDeckRequest,
  options: { keepalive?: boolean } = {},
): Promise<Deck> {
  return request(`/decks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    timeoutMs: DECK_WRITE_TIMEOUT_MS,
    keepalive: options.keepalive,
  });
}

export function deleteDeck(id: string): Promise<void> {
  return request(`/decks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    timeoutMs: DECK_WRITE_TIMEOUT_MS,
  });
}
