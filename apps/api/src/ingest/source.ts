// The only place the ingest touches the network. Both transports return raw `unknown` payloads so
// Zod validation upstream cannot be bypassed. The SDK path uses `client.fetch` because its model
// endpoints rename keys. The fetch transport is the default because the SDK discards non-5xx error
// statuses. The seam owns the inter-request delay, the per-request deadline and the retries for
// both. Not re-exported from ./index.ts, to keep the SDK out of the Worker bundle.

import TCGdex from "@tcgdex/sdk";
import { deadline } from "../http/deadline";

/** The transports the CLI's `--transport` flag accepts. */
export const TRANSPORTS = ["fetch", "sdk"] as const;
export type Transport = (typeof TRANSPORTS)[number];

/**
 * The three reads the ingest performs. Deliberately no wider than that: a set's
 * card list arrives inside its full `/sets/{id}` payload and a serie's set list
 * inside `/series/{id}`, so there is nothing for a `listSets`/`getSetCards` to
 * add. Every return is `unknown` — see the header.
 */
export interface CatalogSource {
  readonly transport: Transport;
  /** Requests issued so far, for the CLI's run summary. */
  readonly requestCount: number;
  getSerie(serieId: string): Promise<unknown>;
  getSet(setId: string): Promise<unknown>;
  getCard(cardId: string): Promise<unknown>;
}

/** Default REST root; matches packages/schema/scripts/validate-live.ts. */
export const DEFAULT_BASE_URL = "https://api.tcgdex.net/v2/en";
/** Default inter-request spacing, in ms. */
export const DEFAULT_DELAY_MS = 50;
/** Default deadline for one request, body included. Without one a stalled socket holds a set for
    about six minutes. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Default retries after a failed attempt that may pass: a network error, a timeout, 408, 429 or
    5xx. One such failure among a set's few hundred cards would otherwise fail the set. */
export const DEFAULT_RETRIES = 3;
/** Full-jitter backoff: attempt n waits a random time up to min(MAX, BASE * 2^n). */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 20_000;
/** The longest Retry-After honoured; a longer one waits this long and tries anyway. */
const RETRY_AFTER_MAX_MS = 60_000;

export interface SourceOptions {
  /** Inter-request spacing. Applied by the seam, not by the transport. */
  delayMs?: number;
  /** Injected by tests so pacing and backoff are asserted without real time passing. */
  sleep?: (ms: number) => Promise<void>;
  /** Deadline for one request. */
  timeoutMs?: number;
  /** Retries after the first attempt (createSource only); 0 turns them off. */
  retries?: number;
  /** Injected by tests to fix the backoff jitter; Math.random otherwise. */
  random?: () => number;
}

/** A failed request, and whether trying it again may succeed. */
export class SourceRequestError extends Error {
  readonly retryable: boolean;
  /** How long the server asked us to wait, from Retry-After. */
  readonly retryAfterMs: number | undefined;
  /** The HTTP status, when the server answered one (the fetch transport only). */
  readonly status: number | undefined;

  constructor(
    message: string,
    retryable: boolean,
    options: { retryAfterMs?: number; cause?: unknown; status?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "SourceRequestError";
    this.retryable = retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.status = options.status;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function describeFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `timed out after ${timeoutMs} ms`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Retry-After as milliseconds (delta-seconds or an HTTP date), or undefined when absent. */
function retryAfterMs(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isNaN(ms) ? undefined : Math.min(RETRY_AFTER_MAX_MS, Math.max(0, ms));
}

export interface FetchSourceOptions extends SourceOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * The sliver of `TCGdex` the seam uses — the RAW json endpoints only. Narrow
 * on purpose: it is what makes the SDK transport unit-testable with a stub,
 * and it fails to compile the day the SDK drops or renames `fetch`.
 */
export interface TcgdexRawClient {
  fetch(...endpoint: ["series", string]): Promise<unknown>;
  fetch(...endpoint: ["sets", string]): Promise<unknown>;
  fetch(...endpoint: ["cards", string]): Promise<unknown>;
}

export interface SdkSourceOptions extends SourceOptions {
  /** Injected by tests; production builds one from `lang`. */
  client?: TcgdexRawClient;
  lang?: string;
}

/**
 * Shared bookkeeping: the request counter and the "delay before every request
 * except the first" rule both transports obey. Starts are spaced in call
 * order even when requests overlap, so concurrent callers share one rate.
 */
function createPacer(options: SourceOptions): {
  pace: () => Promise<void>;
  count: () => number;
} {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  let calls = 0;
  let requests = 0;
  let lastStart: Promise<void> = Promise.resolve();
  return {
    pace(): Promise<void> {
      const spaced = calls > 0 && delayMs > 0;
      calls += 1;
      lastStart = lastStart.then(async () => {
        if (spaced) await sleep(delayMs);
        requests += 1;
      });
      return lastStart;
    },
    count: () => requests,
  };
}

/**
 * Raw-`fetch` transport — the historical path, the same URL the ingest has
 * always requested, now under a deadline. Non-2xx throws with the status, which
 * is what the CLI's per-set abort reports; every failure names the path.
 */
export function createFetchSource(options: FetchSourceOptions = {}): CatalogSource {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { pace, count } = createPacer(options);

  async function fetchJson(path: string): Promise<unknown> {
    await pace();
    // One signal for the headers and the body, so a body that stalls mid-stream is cut too.
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { signal });
    } catch (error) {
      throw new SourceRequestError(`${describeFailure(error, timeoutMs)} for ${path}`, true, {
        cause: error,
      });
    }
    if (!response.ok) {
      const status = response.status;
      throw new SourceRequestError(
        `HTTP ${status} for ${path}`,
        status === 408 || status === 429 || status >= 500,
        { retryAfterMs: retryAfterMs(response.headers.get("retry-after")), status },
      );
    }
    try {
      return await response.json();
    } catch (error) {
      // A cut-off body, or a proxy's HTML error page sent with 200.
      throw new SourceRequestError(
        `unreadable JSON for ${path}: ${describeFailure(error, timeoutMs)}`,
        true,
        { cause: error },
      );
    }
  }

  return {
    transport: "fetch",
    get requestCount() {
      return count();
    },
    getSerie: (serieId) => fetchJson(`/series/${encodeURIComponent(serieId)}`),
    getSet: (setId) => fetchJson(`/sets/${encodeURIComponent(setId)}`),
    getCard: (cardId) => fetchJson(`/cards/${encodeURIComponent(cardId)}`),
  };
}

/**
 * @tcgdex/sdk transport. The SDK owns URL construction, the language segment
 * and its user-agent header; we own pacing, and we re-raise its `undefined`
 * (any non-200 below 500) as an error so a miss can never be mistaken for an
 * empty payload downstream.
 */
export function createSdkSource(options: SdkSourceOptions = {}): CatalogSource {
  // The one line in this module that cannot be exercised without network: the
  // default client. Tests inject `client` and cover everything below it.
  const client: TcgdexRawClient = options.client ?? createDefaultSdkClient(options.lang);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { pace, count } = createPacer(options);

  async function read(kind: string, id: string, request: () => Promise<unknown>) {
    await pace();
    let payload: unknown;
    // The SDK takes no signal, so a request past the deadline keeps running until it settles.
    const limit = deadline(timeoutMs);
    try {
      payload = await limit.within(request());
    } catch (error) {
      // The SDK throws on a 5xx or a network failure, both worth another try.
      throw new SourceRequestError(`${describeFailure(error, timeoutMs)} for ${kind} ${id}`, true, {
        cause: error,
      });
    } finally {
      limit.clear();
    }
    if (payload === undefined) {
      // The SDK collapses 404/429/4xx into `undefined` and drops the status.
      throw new SourceRequestError(
        `no payload for ${kind} ${id} — @tcgdex/sdk returned undefined (non-200 below 500; status not recoverable)`,
        false,
      );
    }
    return payload;
  }

  return {
    transport: "sdk",
    get requestCount() {
      return count();
    },
    getSerie: (serieId) => read("serie", serieId, () => client.fetch("series", serieId)),
    getSet: (setId) => read("set", setId, () => client.fetch("sets", setId)),
    getCard: (cardId) => read("card", cardId, () => client.fetch("cards", cardId)),
  };
}

/** Untestable-without-network boundary, isolated to one named function. */
function createDefaultSdkClient(lang = "en"): TcgdexRawClient {
  return new TCGdex(lang as ConstructorParameters<typeof TCGdex>[0]);
}

/**
 * Retries each read after a failure that may pass (SourceRequestError.retryable), up to `retries`
 * times, waiting the server's Retry-After or else a full-jitter backoff. Each attempt goes back
 * through the transport, so it is paced and counted like any request.
 */
export function withRetries(source: CatalogSource, options: SourceOptions = {}): CatalogSource {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  async function attempt(read: () => Promise<unknown>): Promise<unknown> {
    for (let failures = 0; ; failures++) {
      try {
        return await read();
      } catch (error) {
        if (!(error instanceof SourceRequestError) || !error.retryable) throw error;
        if (failures >= retries) {
          if (failures === 0) throw error;
          throw new SourceRequestError(`${error.message} (${failures + 1} attempts)`, false, {
            cause: error,
          });
        }
        const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** failures);
        await sleep(error.retryAfterMs ?? Math.floor(random() * backoff));
      }
    }
  }

  return {
    get transport() {
      return source.transport;
    },
    get requestCount() {
      return source.requestCount;
    },
    getSerie: (serieId) => attempt(() => source.getSerie(serieId)),
    getSet: (setId) => attempt(() => source.getSet(setId)),
    getCard: (cardId) => attempt(() => source.getCard(cardId)),
  };
}

/** Build the source the CLI's `--transport` flag selected, with retries. */
export function createSource(
  transport: Transport,
  options: FetchSourceOptions & SdkSourceOptions = {},
): CatalogSource {
  const source = transport === "sdk" ? createSdkSource(options) : createFetchSource(options);
  return withRetries(source, options);
}

/**
 * Validate a `--transport` argument. `fetch` is the default: it is the only
 * transport proven end-to-end against the live API (see the header).
 */
export function parseTransport(value: string | undefined): Transport {
  if (value === undefined) {
    return "fetch";
  }
  const match = TRANSPORTS.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new Error(`unknown --transport "${value}" (expected ${TRANSPORTS.join(" | ")})`);
  }
  return match;
}
