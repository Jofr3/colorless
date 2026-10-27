/** The KV key ingest stamps after writing the catalog; its value is part of every catalog cache
    key (./cache.ts), so a new stamp retires every response cached before it. */
export const CATALOG_EPOCH_KEY = "catalog:epoch";
