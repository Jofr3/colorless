// The only place the ingest touches the network. Both transports return raw `unknown` payloads so
// Zod validation upstream cannot be bypassed. The SDK path uses `client.fetch` because its model
// endpoints rename keys. The fetch transport is the default because the SDK discards non-5xx error
// statuses. The seam owns the inter-request delay for both. Not re-exported from ./index.ts, to
// keep the SDK out of the Worker bundle.

import TCGdex from "@tcgdex/sdk";

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

export interface SourceOptions {
  /** Inter-request spacing. Applied by the seam, not by the transport. */
  delayMs?: number;
  /** Injected by tests so pacing is asserted without real time passing. */
  sleep?: (ms: number) => Promise<void>;
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
 * except the first" rule both transports obey.
 */
function createPacer(options: SourceOptions): {
  pace: () => Promise<void>;
  count: () => number;
} {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let requests = 0;
  return {
    async pace(): Promise<void> {
      if (requests > 0 && delayMs > 0) {
        await sleep(delayMs);
      }
      requests += 1;
    },
    count: () => requests,
  };
}

/**
 * Raw-`fetch` transport — the historical path, byte-for-byte the request the
 * ingest has always made. Non-2xx throws with the status, which is what the
 * CLI's per-set abort reports.
 */
export function createFetchSource(options: FetchSourceOptions = {}): CatalogSource {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const { pace, count } = createPacer(options);

  async function fetchJson(path: string): Promise<unknown> {
    await pace();
    const response = await fetchImpl(`${baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${path}`);
    }
    return response.json();
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
  const { pace, count } = createPacer(options);

  async function required(kind: string, id: string, payload: unknown): Promise<unknown> {
    if (payload === undefined) {
      // The SDK collapses 404/429/4xx into `undefined` and drops the status.
      throw new Error(
        `no payload for ${kind} ${id} — @tcgdex/sdk returned undefined (non-200 below 500; status not recoverable)`,
      );
    }
    return payload;
  }

  return {
    transport: "sdk",
    get requestCount() {
      return count();
    },
    async getSerie(serieId) {
      await pace();
      return required("serie", serieId, await client.fetch("series", serieId));
    },
    async getSet(setId) {
      await pace();
      return required("set", setId, await client.fetch("sets", setId));
    },
    async getCard(cardId) {
      await pace();
      return required("card", cardId, await client.fetch("cards", cardId));
    },
  };
}

/** Untestable-without-network boundary, isolated to one named function. */
function createDefaultSdkClient(lang = "en"): TcgdexRawClient {
  return new TCGdex(lang as ConstructorParameters<typeof TCGdex>[0]);
}

/** Build the source the CLI's `--transport` flag selected. */
export function createSource(
  transport: Transport,
  options: FetchSourceOptions & SdkSourceOptions = {},
): CatalogSource {
  return transport === "sdk" ? createSdkSource(options) : createFetchSource(options);
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
