# Next Phase — Backend + Real Card Data

> **Status:** Working spec, all major decisions made. This is a prompt/brief for
> the next build phase; refine as implementation reveals detail.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Backend data strategy | **Own DB** — ingest tcgdex → Cloudflare **D1**, serve our own API |
| D2 | Accounts & persistence | **Full accounts + auth**; users own their decks |
| D2a | Auth methods | **Email + password** *and* **social OAuth (Discord + Google)** |
| D3 | Catalog scope | **Full-history-capable schema, ingest SV-era first** |
| D4 | Card images | **Mirror into R2**, serve from our domain |
| D5 | Card type | **Unify** — one canonical `Card`, with builder/playmat view projections |
| D6 | Online lobby server | **In scope** — real **Durable Object** (WebSocket) lobby server |

---

## 1. Where the project is today

`luminous_ui` is currently a **frontend-only skeleton**: the design language,
the main pages, and simple interactions exist, but there is **no backend and no
persistence** beyond `localStorage`.

- **Stack:** React 19 + Vite 8 (Rolldown) + Tailwind 4, PixiJS 8 + GSAP for the
  animated card layer. Bun 1.3 as the package manager/runtime.
- **Card catalog** is a hand-authored, ~90-card fixture:
  - `src/features/builder/cardPool.ts` — the browsable pool.
  - `src/features/builder/cards.ts` — the `BuilderCard` type, energy types,
    subtypes, rarities, formats, and pure helpers.
  - Scoped to the **Scarlet & Violet era** only; each entry carries a Scrydex
    `cardId` (`{setCode}-{number}`).
- **Card art** is hotlinked from `https://images.scrydex.com/pokemon/{id}/{size}`
  (`cardImageUrl` in `cards.ts`). The production CSP in `vite.config.ts`
  allowlists **only** that host for `img-src`/`connect-src`.
- **Decks** are seed fixtures + folders (`src/features/decks/data.ts`),
  persisted best-effort to `localStorage` via `src/lib/persistedState.ts`.
- **Playmat** uses its own `CardModel` (`src/features/playmat/types.ts`).
- **Online lobby** (`src/features/online/net/*`) is host-authoritative over a
  `BroadcastChannel`, **deliberately written to swap for a real server** with no
  UI changes: `net/types.ts` (LobbySnapshot / LobbyMessage / LobbyIntent),
  `net/lobbyReducer.ts` (the authoritative reducer), `net/channel.ts` (the
  transport seam).

**The gap:** everything is fixtures. This phase makes it real.

---

## 2. Goal of this phase

1. **Stand up the backend** — a Bun + Hono API on Cloudflare Workers.
2. **Import real card data** from [tcgdex.dev](https://tcgdex.dev/) into our own
   **D1** database; define **Zod schemas for every tcgdex model** we read.
3. **Mirror card images into R2**, served from our own domain.
4. **Serve the catalog** to the frontend, replacing the hand-written fixtures.
5. **Add accounts + auth** (email/password + Discord/Google OAuth); persist
   users' **decks** server-side.
6. **Promote the online lobby to a real server** — a Durable Object over
   WebSocket, reusing the existing lobby reducer + message types.

Out of scope: the real-time **match engine** (playing an actual game of cards).
This phase gets players into a real shared lobby; the match itself stays a
placeholder.

---

## 3. Proposed architecture

```text
                 ┌───────────────────────────── Cloudflare ─────────────────────────────┐
tcgdex.dev ──▶   │  ingest job ──▶ D1 (cards/sets/series)     Hono Worker ──▶ web app    │
(REST/SDK)       │      └──────▶ R2 (mirrored images)   ▲          │  │                   │
                 │                                      └─ D1 (users/sessions/decks)      │
                 │   Lobby Durable Object ◀── WS ───────────────────┘  KV (cache/limits)  │
                 └───────────────────────────────────────────────────────────────────────┘
```

### 3.1 Repo layout — Bun-workspace monorepo

```text
luminous_ui/
  apps/
    web/            # the existing Vite app (relocated from repo root — can be deferred)
    api/            # NEW — Bun + Hono Cloudflare Worker (+ Lobby Durable Object)
  packages/
    schema/         # NEW — shared Zod schemas + TS types (tcgdex, domain, lobby)
  package.json      # workspaces: ["apps/*", "packages/*"]
```

> The web app can stay at the repo root initially; start `apps/api` +
> `packages/schema` first, relocate `web` in a follow-up commit.
>
> **Move the lobby vocabulary** (`net/types.ts` — LobbySnapshot / LobbyMessage /
> LobbyIntent — and the pure `lobbyReducer.ts`) into `packages/schema` so both
> the web client and the Durable Object import the same source of truth.

### 3.2 Backend — Bun + Hono on Cloudflare Workers

- **Hono** app deployed as a **Cloudflare Worker** (`wrangler`), config in
  `wrangler.jsonc`; local dev via `wrangler dev`.
- **Validation** with **Zod** from `packages/schema`; typed routes via
  `@hono/zod-validator`.
- **DB access:** D1 via **Drizzle** (typed migrations + queries) — *≈ assumption,
  revisit if we'd rather hand-write SQL*.

### 3.3 Storage & compute bindings (Cloudflare)

- **D1** (SQLite), two logical schemas in one DB:
  1. **Catalog:** `series`, `sets`, `cards` (§5.3).
  2. **User data:** `users`, `oauth_identities`, `sessions`, `folders`, `decks`,
     `deck_cards`.
- **R2** — mirrored card images + set logos/symbols, served via our domain.
- **KV** — response cache for hot catalog reads + rate-limit counters.
- **Durable Objects** — one instance **per lobby** (keyed by the join code);
  holds the authoritative `LobbySnapshot` and fans out over WebSocket.

### 3.4 Ingest & asset pipeline (D9: local data ingest, lazy image mirror)

**Card data** is ingested by a local Bun script — `apps/api/scripts/ingest.ts`
(`bun scripts/ingest.ts [--serie sv | --sets sv01,sv02] [--remote] [--dry-run]
[--transport=fetch|sdk]`, run from `apps/api/`) — not by the request Worker:

1. Traverse serie → sets → each card's full detail from the tcgdex REST API
   (sequential, ~50ms spacing), validating every payload with the Zod schemas
   in `@luminous/schema`; any card validation failure aborts that set with a
   report.
2. Map onto the §5.3 rows (missing `legal` → false/false; category-specific
   fields NULL elsewhere; `*_url` columns keep the tcgdex **origin** base
   URLs) and generate batched upsert SQL — `INSERT … ON CONFLICT(id) DO
   UPDATE`, ≤100 cards per file (`apps/api/src/ingest/`, unit-tested).
3. Apply in FK order (series → set → card chunks) via
   `wrangler d1 execute luminous --local|--remote --file …`. Idempotent by
   tcgdex `id` — rerunning is always safe; `--dry-run` writes SQL, applies
   nothing.

**Images are NOT mirrored at ingest time.** The Worker's `GET /assets/*`
routes (§6) mirror lazily, cache-aside: R2 hit → serve; miss → resolve the
origin base URL from D1, fetch the original from tcgdex, store it in R2,
respond. Rationale: a full SV-era backfill is ~10k images — over Worker
subrequest limits, slow via CLI puts, and mostly assets nobody views.

A future **Cron Trigger** (stretch) will run small incremental data deltas
in-Worker; the big backfill stays a local script.

#### 3.4.1 How to actually run an ingest

The catalog in local D1 is rebuilt from scratch like this, from `apps/api/`
**on a machine with outbound access to `api.tcgdex.net`**:

```sh
bun run db:migrate:local                     # tables must exist first
bun scripts/ingest.ts --sets sve --dry-run   # smallest set (24 cards): SQL only
bun scripts/ingest.ts --sets sve             # …then really apply it
bun scripts/ingest.ts --serie sv             # the whole Scarlet & Violet serie
bun scripts/ingest.ts --serie sv --remote    # the production backfill
```

`--dry-run` writes the SQL files under `apps/api/.wrangler/tmp/ingest-<stamp>/`
and applies nothing — always the first thing to run against an unfamiliar set.
Everything is an idempotent upsert keyed by the tcgdex id, so a rerun (or a
rerun after a partial failure) is always safe. A card whose payload fails Zod
validation aborts **that set only**, printing the offending ids and their zod
issues; the run exits non-zero if any set failed.

#### 3.4.2 Transport seam — `--transport=fetch|sdk` (D188)

Network access lives behind `apps/api/src/ingest/source.ts`, a three-method
seam (`getSerie` / `getSet` / `getCard`) with two implementations:

| `--transport` | Implementation | Notes |
|---|---|---|
| `fetch` (**default**) | raw `fetch` against `https://api.tcgdex.net/v2/en` | the historical path; the only one proven end-to-end |
| `sdk` | `@tcgdex/sdk` (pinned `2.9.0`, `apps/api` only) | uses the SDK's **raw** `client.fetch(...)`, never its model endpoints |

**Every method returns `unknown`.** The SDK is used for TRANSPORT ONLY: it
ships TypeScript *types*, which are erased at runtime and therefore cannot
hold the property that makes this pipeline safe (D5 — every external payload
is parsed at the boundary, so upstream drift is a loud failure rather than a
corrupt D1 row). The Zod schemas in `@luminous/schema` remain the validation
boundary, unchanged and unconditional; changing transport cannot change
whether validation happens. Mapping, chunking, SQL and FK order are untouched.

Why `fetch` is still the default, and still exists at all:

- It is the only transport ever proven against the live API end-to-end.
- The SDK's error model is strictly weaker. `actualFetch` returns `undefined`
  for **any non-200 below 500**, discarding the status, so a 404, a 429
  rate-limit and an empty result are indistinguishable; its `>= 500` branch
  throws inside its own `try`, so every 5xx surfaces as one fixed string. The
  seam re-raises that `undefined` as an error (abort-on-failure still holds)
  but cannot recover what the SDK threw away. Observed directly: the same
  blocked request reports `HTTP 403 for /sets/sv01` under `fetch` and
  `no payload for set sv01 — @tcgdex/sdk returned undefined` under `sdk`.

Two more things the SDK does *not* do for us:

- **No whole-set fetching.** `fetchCards(setId)` just returns `set.cards`, i.e.
  the same card *resumes* the full `/sets/{id}` payload already contains — not
  full card detail. The N sequential per-card detail requests remain necessary.
- **No pacing or backoff**, only a per-URL in-process cache. So the seam owns
  the 50 ms inter-request spacing for *both* transports; the politeness posture
  is identical either way.

`source.ts` lives under `src/` (so it typechecks and is unit-tested with
stubs) but is deliberately **not** re-exported from the `src/ingest/` barrel,
and the CLI imports it by path — the SDK must not reach the Worker bundle
through that barrel.

`apps/api/src/ingest/sdkContract.test.ts` pins the SDK's type claims against
the committed fixtures and against its own runtime behaviour, including
`@ts-expect-error` drift detectors that fail `tsc` the day the SDK starts
declaring a field it currently omits (`Card.pricing`, `Card.updated`,
`Card.variants_detailed`, `variants.wPromo`, `Set.abbreviation`,
`Serie.releaseDate`/`firstSet`). It also pins the reason the seam avoids the
SDK's model endpoints: `CardModel.fill` renames `variants_detailed` →
`variantsDetailed`, which Zod's strip mode would drop *silently* — invisible
data loss rather than a validation failure.

### 3.5 Auth (D2 / D2a) — as built (P1 milestone 6, `apps/api/src/auth/`)

- **Server sessions** (not stateless JWT — easy logout/rotation) in D1
  `sessions`. The browser holds a 256-bit random token in an http-only cookie
  `session` (`Secure; SameSite=None; Path=/`, 30-day `Max-Age`); the DB row id
  is **sha256(token)**, so a leaked dump authenticates nothing. Expiry is
  enforced on read; expired rows are deleted lazily — no sweeper.
  `SameSite=None` because the web app lives on a **different origin**: the
  Worker runs `hono/cors` app-wide with `origin = APP_ORIGIN` (wrangler.jsonc
  `vars`, dev default `http://localhost:5173`) and `credentials: true`, and
  the client fetches with `credentials: "include"`.
- **Email + password:** PBKDF2-SHA256 via WebCrypto (zero deps,
  Workers-native), stored as `pbkdf2$<iterations>$<salt-b64url>$<hash-b64url>`
  — verify reads the iteration count from the encoding, so raising the
  default (currently 100k) upgrades hashes lazily on login. Constant-time
  compare; login burns a dummy verify on unknown emails (timing parity) and
  answers one uniform 401. *Caveat:* 100k iterations ≈ tens of ms CPU — if
  free-plan Workers CPU limits 500 the auth routes in production, lower the
  count or move to WASM Argon2. Register/login are rate-limited
  10 attempts / 15 min per (IP, email) via approximate KV counters on `CACHE`.
- **Password-reset + email-verify are 501 stubs** — they need an outbound
  email provider, which is not chosen yet; no token plumbing exists until it
  is (`POST /auth/verify-email`, `POST /auth/reset-password` explain this).
- **OAuth (Discord + Google):** standard authorization-code flow; CSRF state
  in a short-lived http-only cookie (also carrying the allowlisted relative
  `?redirect=` path). On callback: verify state → exchange code → fetch
  profile (Discord `identify email` scopes via `/api/users/@me`; Google
  `openid email profile` via OIDC userinfo) → find-or-create: linked
  `oauth_identities` row → that user; else user by **provider-verified**
  email → link (unverified match ⇒ 409, no takeover); else create user
  (`email_verified` from the provider) + identity. Then session + redirect to
  `APP_ORIGIN`. A single user may hold both a password and OAuth identities.
- **Providers activate by configuration alone** — with secrets absent the
  routes answer `503 {"error":"provider not configured"}`. To activate, register
  the apps (Discord: <https://discord.com/developers/applications> → OAuth2;
  Google: <https://console.cloud.google.com/auth/clients>, Web application)
  with BOTH redirect URIs per provider:
  - `https://luminous-api.jofrescari.workers.dev/auth/oauth/{discord|google}/callback`
  - `http://localhost:8787/auth/oauth/{discord|google}/callback` (wrangler dev)

  then install the secrets (from `apps/api/`):

  ```sh
  wrangler secret put DISCORD_CLIENT_ID
  wrangler secret put DISCORD_CLIENT_SECRET
  wrangler secret put GOOGLE_CLIENT_ID
  wrangler secret put GOOGLE_CLIENT_SECRET
  ```

  For local dev put the same names in `apps/api/.dev.vars` (gitignored).

### 3.6 Lobby Durable Object (D6) — as built (P1 milestone 8, `apps/api/src/lobby/`)

- **One `LobbyDO` per lobby code** (`idFromName(code)`), exported from the
  Worker entry; binding `LOBBY`, migration `v1 new_sqlite_classes`. It is the
  server-side replacement for the BroadcastChannel model's authoritative
  "host peer": it owns the one true `LobbySnapshot` in DO storage, applies
  every change through the **shared, unchanged `lobbyReducer`**
  (`packages/schema/src/lobby/`), and broadcasts `{kind:"state"}` to every
  socket. Both players — host included — are now plain clients that send
  intents; policies the old host hook enforced in `useLobby.ts` moved verbatim
  into pure helpers (`lobby/logic.ts`: hello/seat-takeover rule, countdown
  stamping, connectivity-drops-ready) with the DO a thin shell around them.
- **Wire protocol** (`packages/schema/src/lobby/wire.ts`): hand-written Zod
  schemas mirroring `types.ts`, with exported compile-time proofs that each
  schema infers to EXACTLY the shared type. Client → server is
  `LobbyClientMessage` = hello | intent | kick | bye — the kick being the same
  `reject …"kicked"` frame the old host posted at its guest, narrowed so a
  client can't fabricate "full". Server → client is `LobbyServerMessage` =
  state | reject. **Every inbound frame is Zod-validated; junk and forged
  `from` ids (socket attachment ≠ claimed id) are dropped.** Zod-free protocol
  constants (`COUNTDOWN_MS`, ping/pong strings) live in `lobby/protocol.ts` so
  the web bundle doesn't pull Zod in.
- **Hibernation:** sockets accepted via `state.acceptWebSocket`
  (hibernatable); per-socket player identity survives eviction in the socket
  attachment (`ws.serializeAttachment`, `lobby/attachment.ts`); keepalive is a
  raw `"ping"`/`"pong"` pair answered by `setWebSocketAutoResponse` without
  waking the instance — an idle lobby burns no duration.
- **Lifecycle (one alarm, three duties — earliest deadline wins):**
  1. *Disconnect grace* — a socket dropping without a `bye` only marks its
     seat disconnected after 5 s (the old model's `PRESENCE_TIMEOUT_MS`)
     without a reconnect, so refreshes and the probe→room socket handoff never
     flicker the opponent to "disconnected". Same session id always re-seats
     with deck/ready intact (host id is pinned for the lobby's lifetime; a
     *different* id may take over only an abandoned guest seat, pre-match —
     the old host's exact rule).
  2. *Countdown* — the DO stamps `countdownStartedAt` on entering the phase
     and its alarm flips countdown → in-game after `COUNTDOWN_MS`, demoting
     instead any seat whose player has no live socket (the old host's
     liveness check). A guest `bye` frees the seat immediately; a host `bye`
     just marks the seat disconnected (lobby survives, host can return).
  3. *Empty-lobby expiry* — 10 min after the last socket goes (also arms at
     create), `storage.deleteAll()` + `deleteAlarm()` wipe the lobby and free
     the code; a socket upgrade for a never-created/expired code is refused
     (404), which the client reads as silence → "not found".
- **Anonymity:** lobbies stay account-less this phase, matching the client
  model — players are lobby-scoped session ids minted by the browser
  (`net/session.ts`), no auth cookie or user row involved.
- **Frontend swap (done):** `net/channel.ts` is now a WebSocket transport with
  the same `LobbyChannel` interface — reconnect with capped backoff (400 ms
  doubling to 8 s), posts queued while down, server pongs surfaced as
  heartbeat frames so the hook's presence math still works. `useLobby.ts` runs
  one unified client path for both roles (the host seeds a local snapshot only
  as first paint); `OnlineHub` creates via `POST /lobby` instead of minting a
  code locally. `LobbyRoom.tsx` and all components are untouched.

### 3.7 Deployment

- API + DO: `wrangler deploy`; secrets via `wrangler secret`.
- Web: Cloudflare Pages / Workers static assets, calling the API over HTTPS.
- Images: R2 bound to a custom domain / Worker route.

#### 3.7.1 The deploy runbook — RUN IN THIS ORDER (D203)

Four slices (D188, D194, D197, D198) each ended with a piece of this owed, and
each left it in a commit message. It is written down once, here, because the
first step is a **PREREQUISITE**: skipping it does not degrade the API, it
**500s an endpoint outright**.

Verified against production D1 (`735f0fb5-…`) on **2026-08-04**: the applied
migration list is `0000, 0001, 0002, 0003` — so **three migrations are pending,
not one**. `0004` (`decks.cover_card_id`), `0005` (`users.favourite_deck_id`)
and `0006` (`cards.suffix`) have all NEVER been applied remotely, and the code
on `main` reads all three columns. `wrangler d1 migrations apply` applies them
in order, so this is still one command — but "only 0006 is missing" is wrong,
and the blast radius is `/decks`, `/auth/me` **and** `/facets`, not `/facets`
alone.

```sh
# 1. PREREQUISITE — apply pending migrations to the REMOTE database.
#    Must precede the deploy: `/facets` selects `cards.suffix` inside the same
#    db.batch() as the other seven vocabularies, so an unmigrated database
#    fails the WHOLE endpoint, not just the new field. Likewise `/decks`
#    (0004) and `GET /auth/me` (0005). `wrangler deploy` does NOT run this.
cd apps/api && bun run db:migrate:remote

# 2. Deploy the Worker.
cd apps/api && bun run deploy          # or, from the repo root: bun run api:deploy

# 3. Backfill the catalog (needs network access to api.tcgdex.net — see below).
#    Populates `cards.suffix` (NULL on all 3,786 rows today) and rewrites the
#    "None" sentinels in D1 itself: 34 `mfb` rows in `rarity`, 2 of them also in
#    `regulation_mark` (36 values / 34 rows). Until it runs, `/facets` serves
#    `"suffixes": []` and the builder's rail hides the section — the filter is
#    unreachable rather than broken (§5.3.3) — and the read-side normaliser in
#    `apps/api/src/sentinel.ts` hides the sentinels from the API while leaving
#    them in the rows.
cd apps/api && bun scripts/ingest.ts --serie sv --remote

# 4. The KV catalog cache is NOT invalidated by step 3 (a data-only change does
#    not bump `CACHE_VERSION`, by design — see apps/api/src/catalog/cache.ts).
#    Cached `/facets` and `/cards` bodies keep the pre-ingest answer for up to
#    the 1h TTL. Nothing to run; just do not treat the first hour as a failure.
```

**Command check (against `package.json` and `apps/api/package.json`):**

| Command | Exists? |
| --- | --- |
| `bun run db:migrate:remote` **from the repo root** | ❌ **NO** — the root `package.json` has no such script. It is defined only in `apps/api/package.json`, so it must be run as `cd apps/api && bun run db:migrate:remote` (or `bun run --cwd apps/api db:migrate:remote`). Commit messages that quote the bare form are wrong. |
| `cd apps/api && bun run db:migrate:remote` | ✅ `wrangler d1 migrations apply luminous --remote` |
| `cd apps/api && bun scripts/ingest.ts --remote` | ✅ the script exists; `--remote` and `--serie` are real flags (`apps/api/scripts/ingest.ts`). Note it is `bun scripts/ingest.ts`, **not** `bun run` — there is no npm script wrapping it. |
| `bun run api:deploy` (repo root) | ✅ `bun run --cwd apps/api deploy` → `wrangler deploy` |
| `cd apps/api && bun run db:migrate:local` | ✅ the local twin, used for the pre-flight |

**Why step 3 has never run here.** `api.tcgdex.net` is refused by this
environment's network policy — the same wall D188, D194, D197 and D198 hit. The
ingest is the only step that needs the public internet; steps 1, 2 and 4 do not,
and step 1 is therefore unblocked TODAY and should not wait for the backfill.

---

## 4. tcgdex.dev integration reference

Researched from the official docs so the implementation can be exact.

### 4.1 Access methods

- **REST** base: `https://api.tcgdex.net/v2/{lang}/` (`lang` = `en`, `fr`, `de`,
  `es`, `it`, `pt`, `ja`, …). HTTPS only, **GET only**, JSON.
- **GraphQL**: `https://api.tcgdex.net/v2/graphql`.
- **Official SDK**: `@tcgdex/sdk` (TS/JS) — ingest traversal; validate at our
  boundary with our own Zod schemas. **Adopted at D188** as one of two
  interchangeable transports (`--transport=sdk`, §3.4.2), for transport only;
  its types are never the boundary.

### 4.2 Core endpoints (REST)

| Purpose | Path |
|---|---|
| Search cards | `/cards` |
| One card (global id) | `/cards/{id}` — e.g. `/cards/swsh3-136` |
| One card by set + local id | `/sets/{setId}/{localId}` |
| Search sets | `/sets` |
| One set | `/sets/{setId}` |
| Search series | `/series` |
| One serie | `/series/{serieId}` |
| Enumerate a field's values | `/{field}` — e.g. `/rarities`, `/types`, `/hp`, `/illustrators` |

### 4.3 Filtering / sorting / pagination

- **Filter:** `?field=value` (laxist, partial + case-insensitive by default).
  Prefixes: `eq:` (strict), `like:`, `not:`/`neq:`, `gte:`/`lte:`/`gt:`/`lt:`
  (numbers), `null:`/`notnull:`. Multiple values: `field=eq:A|B`. Wildcards `*`.
  - e.g. `/cards?name=pikachu&hp=gte:120`
- **Sort:** `?sort:field={f}&sort:order={ASC|DESC}` (default:
  `releaseDate > localId > id`).
- **Paginate:** `?pagination:page={n}&pagination:itemsPerPage={n}` (default 100).

### 4.4 Image assets

`image` (card), `logo`/`symbol` (set) are **base URLs without an extension**:

- **Card:** `{image}/{quality}.{ext}` — `quality` ∈ `high | low`,
  `ext` ∈ `png | webp | jpg` — e.g.
  `https://assets.tcgdex.net/en/swsh/swsh3/136/high.png`
- **Set logo/symbol:** `{logo}.{ext}` / `{symbol}.{ext}`.

> We **mirror into R2 lazily (D4/D9)**: the catalog stores these extensionless
> origin base URLs (`cards.image_url`, `sets.logo_url`/`symbol_url`,
> `series.logo_url`), and the `/assets/*` routes (§3.4, §6) copy an asset into
> R2 the first time it is requested. tcgdex ids (`swsh3-136`) become our
> canonical id — no more Scrydex reconciliation.

---

## 5. Schemas & data model

### 5.1 tcgdex models (Zod, in `packages/schema`)

Author Zod schemas + inferred types mirroring the API, then map onto our domain.
Implemented in `packages/schema/src/tcgdex/` against live responses (verbatim
fixtures in `__fixtures__/`; live sweep via `packages/schema/scripts/validate-live.ts`).

- **Card** (full): `id, localId, name, image?, category ("Pokemon"|"Trainer"|
  "Energy"), illustrator?, rarity?, set (SetBrief), variants? {normal, reverse,
  holo, firstEdition, wPromo}, variants_detailed?, boosters?, pricing?,
  regulationMark?, legal? {standard, expanded}, updated` — `updated` is an ISO
  datetime mixing `Z` and `+HH:MM` offsets. Modeled as a discriminated union on
  `category`.
  - **Pokémon** extras: `dexId?, hp?, types?, evolveFrom?, description?, level?
    (number|string), stage?, suffix?, abilities? [{type, name, effect}],
    item? {name?, effect?}` (dp-era held item; live data serves `{}`),
    `attacks?, weaknesses?, resistances?, retreat?`
  - **Trainer** extras: `effect?, trainerType` · **Energy** extras: `effect?
    (absent on basic energies), energyType ("Normal"|"Special")`
  - Nested: **Attack** `{cost?: string[], name, effect?, damage?: number|string
    ("60+")}`, **WeakRes** `{type, value ("×2"|"+20"|"-30")}`, **Variants**,
    **VariantDetailed** `{type, size?, variantId?, foil?, stamp?, pricing?}`
    (one entry per physical print), **Legal**, **Pricing** — `{cardmarket?,
    tcgplayer?}`, either can be `null`; cardmarket = nullable EUR aggregates
    (`avg/low/trend/avg1/avg7/avg30` + `-holo` twins), tcgplayer = `unit,
    updated` + one `{productId, low/mid/high/market/directLowPrice}` block per
    dynamic print-run key (`normal`, `holofoil`, `reverse-holofoil`, …),
    **Booster** (documented upstream, not yet observed on live `en` payloads).
- **CardBrief / CardResume:** `{id, localId, name, image?}`.
- **Set** (full): `id, name, logo?, symbol?, cardCount {total, official, reverse?,
  holo?, firstEd?, normal?}, serie (SerieBrief), abbreviation? {official,
  localized?}, tcgOnline?, releaseDate (YYYY-MM-DD), legal {standard,
  expanded}, boosters?, cards: CardBrief[]`
- **SetBrief:** `{id, name, logo?, symbol?, cardCount {total, official}}`
- **Serie** (full): `{id, name, logo?, releaseDate?, firstSet?: SetBrief,
  lastSet?: SetBrief, sets: SetBrief[]}` · **SerieBrief:** `{id, name, logo?}`

### 5.2 Canonical domain `Card` (D5 = unify)

Define **one** canonical `Card` in `packages/schema`, mapped from the tcgdex
model, and derive the two existing view shapes from it:
- **`BuilderCard`** view (`src/features/builder/cards.ts`) — browse/filter/deck
  math. Preserve the existing energy-type/subtype/rarity/format vocabulary.
- **`CardModel`** view (`src/features/playmat/types.ts`) — in-play card.

> **Status (M5):** the canonical domain now exists in
> `packages/schema/src/catalog/` — unprefixed `Card`/`CardBrief`,
> `Set`/`SetBrief`/`SetWithCards`, `Serie`/`SerieBrief` and the
> `paginatedSchema` envelope. One flat object per card (nullability mirrors
> the §5.3 columns; consumers narrow on `category`), and `image`/`logo`/
> `symbol` are OUR asset **base paths** (`/assets/cards/{id}`,
> `/assets/sets/{id}` — clients append `/{quality}.{ext}` / `/logo.{ext}` /
> `/symbol.{ext}`), null when the row has no origin URL. The
> `BuilderCard`/`CardModel` view projections remain future work
> (M9 frontend swap / P2).

Keep the existing `Deck` / `Folder` shapes (`src/features/decks/data.ts`) as the
API's deck representation, extended with a card list.

> **Status (M7):** the deck/folder domain schemas now live in
> `packages/schema/src/decks/` — `Folder`, `Deck` (+ `cards: [{cardId, count}]`),
> `DeckSummary` (cards replaced by the summed `cardCount`), and the
> create/patch request schemas for both resources.

### 5.3 D1 relational schema

Full-history-capable; SV-era rows only, for now. Implemented with Drizzle in
`apps/api/src/db/` (`catalog.ts` / `users.ts`); migrations in `apps/api/drizzle/`.

```sql
-- Catalog (ingested; read-only to the app)
series(id PK, name, release_date, logo_url)
sets(id PK, serie_id FK, name, logo_url, symbol_url,
     release_date, count_total, count_official, legal_standard, legal_expanded,
     tcg_online)
cards(id PK, set_id FK, local_id, name, category,        -- Pokemon|Trainer|Energy
      illustrator, rarity, regulation_mark,
      hp, stage, suffix, evolve_from, types_json, retreat, -- Pokémon fields (nullable)
      abilities_json, attacks_json, weaknesses_json, resistances_json,
      trainer_type, energy_type, effect,                 -- Trainer/Energy fields
      legal_standard, legal_expanded,
      variants_json, image_url, updated)

-- User data (read-write)
users(id PK, email UNIQUE, display_name, password_hash?, email_verified, created_at)
oauth_identities(provider, provider_id, user_id FK, PRIMARY KEY(provider, provider_id))
sessions(id PK, user_id FK, expires_at, created_at)
folders(id PK, user_id FK, parent_id FK?, name)
decks(id PK, user_id FK, folder_id FK?, name, format, tint, updated)
deck_cards(deck_id FK, card_id FK, count, PRIMARY KEY(deck_id, card_id))
```

Deltas from the first draft, per the live tcgdex shapes: `series.release_date`
added; `sets.updated` dropped (tcgdex sets carry no `updated`);
`cards.abilities_json` added. Per D9 (§3.4), the asset columns are the tcgdex
**origin** base URLs — extensionless, per §4.4 — not R2 URLs: the original
`*_r2_url` columns were replaced by `cards.image_url`, `sets.logo_url`/
`symbol_url`, `series.logo_url` (migrations 0001/0002). tcgdex
`variants_detailed` (per-physical-print foil/stamp data), `pricing` and
`boosters` are deliberately **not** persisted — rationale in
`apps/api/src/db/catalog.ts`. Catalog dates/timestamps are ISO text verbatim
from tcgdex; user-data timestamps are integer epoch ms.

#### 5.3.1 "No value" sentinels — the `mfb` set (D194)

Upstream is inconsistent about absence. Almost everywhere a missing value is a
missing KEY (→ SQL NULL, which is what the app means by "no rarity" / "no
regulation mark" — 66 cards legitimately carry no mark: 36 Basic Energy, 29
pre-mark Pokémon, 1 Trainer). But the `mfb` set ("My First Battle", 34 cards)
ships the literal STRING `"None"`, which is not NULL: it survives `?? null`,
becomes its own `GROUP BY` bucket, and — because rarity and regulation mark
are both `GET /facets` vocabularies — renders as a dead chip in the deck
builder's FilterRail.

Swept against the production catalog (3,786 cards, 2026-08-04) over every
nullable text column the ingest path writes, for `""`/whitespace/`none`/
`null`/`nil`/`n/a`/`-`/`unknown`/`undefined`/… case-insensitively:

| column | sentinel rows |
| --- | --- |
| `cards.rarity` | **34** = `"None"` (all of `mfb`) |
| `cards.regulation_mark` | **2** = `"None"` (`mfb-33` Potion, `mfb-34` Switch) |
| `cards.illustrator`, `.category`, `.stage`, `.trainer_type`, `.energy_type`, `.evolve_from`, `.name`, `.local_id`, `.effect`, `.image_url`, `.updated` | 0 |
| `sets.name`, `sets.tcg_online`, `series.name` | 0 |
| `cards.types_json` (the other facet vocabulary — an array per row) | 0 — no `"None"`/`""` element, no `[]` |

`"None"` is therefore the only sentinel in the catalog — but it is in **two**
columns, not the one first reported, and `rarity` is the larger leak.
`apps/api/src/sentinel.ts` normalises it to NULL at **both** boundaries:
`src/ingest/map.ts` on WRITE (so it never re-enters) and `src/catalog/map.ts`
+ the `/facets` handler on READ (so today's 34 already-stored rows are clean
without a re-ingest). The KV cache prefix went `v3`→`v4` so the stale facet
body can't outlive the deploy by up to a TTL.

The write-side guard only takes effect on the next ingest of `mfb`; the rows
in D1 still hold `"None"` until then. To discharge it at the source:

```sh
cd apps/api && bun scripts/ingest.ts --sets mfb --remote
```

(Idempotent — every statement is an `ON CONFLICT DO UPDATE` upsert, and
mapping now emits NULL for those two columns.) It could not be run in the
session that landed the fix: `api.tcgdex.net` is blocked by the network
policy there.

#### 5.3.2 Catalog query census (D197) — three measurements, one migration

Measured against the production catalog on 2026-08-04: **3,786 cards / 20
sets**, 3,233 Pokémon + 499 Trainer + 54 Energy.

**`text` reached none of the Trainer/Energy rules text.** The predicate LIKEd
`abilities_json` and `attacks_json` only, and those two columns are NULL on
**every** row that carries `effect`, while `effect` is NULL on every Pokémon —
the sets are exactly disjoint. So `?text=` was structurally incapable of
returning a Trainer or a Special Energy for ANY term:

| | rows | with `effect` | of those, Standard-legal |
| --- | --- | --- | --- |
| Trainer | 499 | 499 | **264** |
| Energy | 54 | 18 (15 Special + 3 Normal) | **11** (8 Special + 3 Normal) |
| Pokémon | 3,233 | 0 | 0 |

D197 added `effect` as a third LIKE disjunct (same `escapeLike` + `ESCAPE '\'`
treatment, pinned per-disjunct by a test). Standard-legal result deltas:
`Search your deck` 135→193, `discard` 329→405, `draw` 89→138, `Switch` 60→79,
`Supporter` 22→32, `Poison` 46→53.

The documented **JSON-key over-match** hazard is real and now quantified —
`?text=effect` matches **2,816** of 3,786 rows and `?text=damage` **3,175**,
almost all of it hitting the `{cost,name,effect,damage}` KEY names inside
`attacks_json`, not prose. It does **not** extend to the new disjunct:
`cards.effect` is plain text with no serialized keys in it, which is precisely
why widening into it is safe. KV prefix `v4`→`v5` (a cached `?text=…` body is
now wrong, not merely stale).

**The `/cards` sort had a JS twin.** `compareCardRows` mirrored the SQL
`cardsOrder` by hand, because `?id=` hydration fanned its ≤100 ids across a
chunked `db.batch` (D1 caps bound parameters at 100, and LIMIT/OFFSET bind
too) and so had no single statement to order. The two agreed — the only
divergence class is SQLite BINARY collation (UTF-8 memcmp) vs JS `<` (UTF-16
code units), which differ only where an astral code point meets a BMP one, and
the catalog has **13** rows with a non-ASCII `name` (11 distinct: `Flabébé`,
`Nidoran♀`, `Nidoran♂`, the `Poké*` family), all BMP, zero astral; `set_id` /
`local_id` are pure ASCII; no `cards` column carries a `COLLATE` clause. D197
removed the twin's *reason* instead of syncing it: the id list now binds as one
JSON array expanded by `json_each`, so `id` is an ordinary clause in
`buildCardsWhere` and `/cards` is a single ordered, paged SQL statement.
Verified against production D1 with the real bound parameter — duplicate ids
dedupe (`IN` is set membership), unknown ids drop, a full 100-id list is still
ONE bind.

**`suffix` is now a column (migration `0006_clumsy_fat_cobra`).** tcgdex's
print-kind marker on a Pokémon's name line — `"ex"`, `"V"`, `"VMAX"`,
`"MEGA"`, … — was parsed by `packages/schema` and dropped by ingest. Without
it an EX/Mega selection cannot be a server param, so the web re-derives the
kind from the card NAME and thins each page client-side; a mixed selection
therefore pages badly (a 60-card page can render nearly empty while `total`
claims hundreds). The column is added, `mapCard` writes it (sentinel-normalised
like the other facet vocabularies — see §5.3.1), and `CARDS_COLUMNS` emits it,
so the next ingest populates it.

⚠️ **Unproven until a re-ingest: the column has no values.** Discharge with:

```sh
cd apps/api && bun scripts/ingest.ts --remote     # then re-check the census below
```

```sql
SELECT suffix, COUNT(*) FROM cards WHERE suffix IS NOT NULL GROUP BY suffix;
```

`api.tcgdex.net` is blocked by the network policy in this session too (as it
was for D188, D194 and D197), so the ingest half remains outstanding.

⚠️ **AND THE COLUMN IS NOT IN PRODUCTION AT ALL.** D197 recorded it as "NULL on
all 3,786 rows"; it is stronger than that — migration `0006` was generated and
proven against a fresh LOCAL D1, but **never applied to the remote database**
(`PRAGMA table_info(cards)` on production has no `suffix`; `wrangler d1
migrations apply` is a manual step and `deploy` does not run it). That is a
deploy ORDERING constraint for D198, not a code problem, and it is sharp: the
`/facets` handler now selects `cards.suffix` inside the same `db.batch()` as
the other seven vocabularies, so deploying the Worker against an unmigrated
database fails the WHOLE endpoint, not just the new field. **Apply the
migration first:**

```sh
cd apps/api && bun run db:migrate:remote        # 0006 — before deploying D198
```

⚠️ **AND IT IS NOT ONLY `0006` (D203).** Production's `d1_migrations` table lists
`0000`–`0003` only, checked 2026-08-04: `0004` (`decks.cover_card_id`) and `0005`
(`users.favourite_deck_id`) are pending too, and `/decks` and `GET /auth/me`
already read those columns. The command above is unchanged — it applies all
three in order — but the ordering constraint is wider than this section said.
**Full runbook: §3.7.1.**

### 5.3.3 `?suffix=` and `CatalogFacets.suffixes` (D198)

The filter D197 deferred, landed with the mechanism that makes it safe. The
vocabulary comes from the DATA (`SELECT DISTINCT suffix … WHERE suffix IS NOT
NULL`, through the same `facetVocabulary` sentinel guard as the other seven),
and the rail renders one chip per value — so an empty column yields an empty
list, no chip, and no way to reach the filter from the UI. Verified end to end
against a real local D1 rather than argued: with every `suffix` NULL, `/facets`
serves `"suffixes":[]` while the other seven stay populated and
`GET /cards?suffix=ex` returns `total: 0` (reachable only by hand-writing the
URL); with one row set to `ex`, the value appears in `suffixes` and the filter
returns exactly that row. A literal `"None"` is dropped from the vocabulary by
the same guard.

`suffix` is its own filter DIMENSION, not extra chips in the kind dimension:
`buildCardsWhere` ANDs dimensions and ORs within one, so `?stage=Basic&suffix=ex`
means "a Basic that is also an ex" — which is what the rail's two sections say.
It is Pokémon-only by construction (the ingest writes NULL for Trainer and
Energy rows, §3.4), so the builder offers the section only under Pokémon/All.

KV prefix `v5`→`v6`, derived: the web client is types-only (no runtime
validation), so a cached v5 `/facets` body reaches the rail as a `CatalogFacets`
whose required `suffixes` is `undefined` — a crash, not a stale chip list.

---

## 6. API surface (v1)

```
GET    /health

# Catalog (public; KV cache-aside on every 200, 1h TTL, `x-luminous-cache: hit|miss`,
# key = `catalog:v6:` + normalized path+sorted-query — bump the version prefix
# whenever a cached shape — or its values for already-ingested rows — changes;
# invalid query params → terse 400 JSON)
GET    /cards            # CardBrief page `{items, page, pageSize, total}`; filters:
                         #   name (substring, case-insensitive), nameExact, category,
                         #   type, rarity, stage, suffix, trainerType, energyType, set,
                         #   serie, illustrator, text, regulationMark, hpMin/hpMax
                         #   (inclusive),
                         #   legal=standard|expanded; type & rarity are REPEATABLE
                         #   (?type=Fire&type=Water — OR within the dimension, M9);
                         #   id is REPEATABLE too (≤100, deck hydration) and is now an
                         #   ORDINARY where clause — one JSON bind expanded by
                         #   json_each — so it orders and pages in SQL like any other
                         #   query (D197 deleted the JS sort twin that path used to
                         #   need; §5.3.2);
                         #   text = substring over abilities_json + attacks_json + the
                         #   plain-text `effect` column (D197 — before that it reached
                         #   NO Trainer or Energy row at all, §5.3.2);
                         #   suffix (printed rule box: ex/V/VMAX/MEGA/…) is REPEATABLE
                         #   too and ANDs with stage; its vocabulary is /facets
                         #   `suffixes`, EMPTY until an ingest fills the column, which
                         #   is what keeps an unreachable filter unreachable (D198,
                         #   §5.3.3);
                         #   sort=name|hp-desc|set (default set); page (1-based,
                         #   default 1), pageSize (default 50, max 100)
GET    /cards/:id        # full canonical Card; 404 JSON if absent
GET    /sets             # SetBrief[] (optional ?serie=), ordered by releaseDate
GET    /sets/:id         # full Set + cards: CardBrief[] (ordered by local_id)
GET    /series           # Serie[] = SerieBrief + nested SetBrief[]
GET    /facets           # CatalogFacets — the EIGHT filter vocabularies actually
                         #   present: rarities, types, stages, trainerTypes,
                         #   energyTypes, illustrators, regulationMarks, suffixes.
                         #   One db.batch of DISTINCTs, each through the sentinel
                         #   guard (D194); a list is EMPTY when the column has no
                         #   values, and the builder's rail hides the section it
                         #   feeds — the only thing standing between an unpopulated
                         #   column and a filter that empties a page (D198, §5.3.3)

# Assets — lazy tcgdex→R2 mirror (D9, §3.4); strict :file allowlists, else 404
GET    /assets/cards/:cardId/:file   # high|low . webp|png|jpg (e.g. high.webp)
GET    /assets/sets/:setId/:file     # logo|symbol . png|webp  (e.g. symbol.png)

# Auth (D2a) — implemented (§3.5 as-built); bodies validated, users
# boundary-parsed through @luminous/schema userSchema (never any hash field)
POST   /auth/register            # {email, password, displayName?} → 201 user + session
                                 #   cookie; 400 invalid body; 409 duplicate email; 429 rate-limited
POST   /auth/login               # {email, password} → 200 user + session cookie;
                                 #   uniform 401 on any failure; 429 rate-limited
POST   /auth/logout              # deletes the session row, clears the cookie → 204
GET    /auth/me                  # session cookie → user, else 401 (expiry enforced here)
GET    /auth/oauth/:provider     # discord | google — 302 to provider; 503 until secrets installed
GET    /auth/oauth/:provider/callback  # state-checked code exchange → session, 302 to APP_ORIGIN
POST   /auth/verify-email  ·  POST /auth/reset-password
                                 # both 501 — blocked on choosing an email provider (§3.5)

# Decks & folders — implemented (P1 m7, apps/api/src/decks/). ALL routes need a
# valid session cookie (requireUser, §3.5) → else 401; every :id lookup is
# scoped WHERE user_id = ? so someone else's (or a missing) resource is the
# SAME 404 — no existence leak; a folderId/parentId you don't own → 400. NO KV
# cache: user data reads fresh. Responses boundary-parsed through the
# @luminous/schema deck/folder schemas. Card lists: {cardId, count 1–99},
# ≤200 distinct entries, duplicate cardIds → 400, ids absent from the catalog
# → 400 `{"error":"unknown card id(s)","cardIds":[…]}` (checked with a chunked
# IN query against `cards`, never the FK error text).
GET    /decks            # DeckSummary[]: {id, name, format, tint, folderId,
                         #   updated, cardCount} — cardCount = summed copy counts
GET    /decks/:id        # full Deck: summary shape minus cardCount, plus
                         #   cards: [{cardId, count}]
POST   /decks            # {name, tint 0–360, format?, folderId?, cards?}
                         #   → 201 Deck (server-minted UUID id)
PATCH  /decks/:id        # any of {name, tint, format?, folderId?} (null clears
                         #   the nullable ones) AND/OR wholesale `cards`
                         #   replacement (delete+reinsert in one db.batch);
                         #   refreshes `updated`; empty patch → 400
DELETE /decks/:id        # 204 (deck_cards cascade away)
GET    /folders          # Folder[]: {id, name, parentId} — FLAT list, the
                         #   client builds the tree
POST   /folders          # {name, parentId?} → 201 Folder
PATCH  /folders/:id      # rename and/or move; cycle guard walks the target
                         #   parent's ancestor chain — self/descendant → 400
DELETE /folders/:id      # 204 — subfolders cascade-delete with it; contained
                         #   decks fall to the library root (folder_id SET NULL)

# Lobby (Durable Object) — implemented (P1 m8, apps/api/src/lobby/; §3.6
# as-built). Account-less: neither route reads the session cookie.
POST   /lobby                    # mint an unused code (draw + claim via the DO,
                                 #   retry on 409 collision) → 201 {code}; 503
                                 #   after five straight collisions
GET    /lobby/:code/ws           # strict code check (404) → upgrade check (426)
                                 #   → forward to the code's LobbyDO; 404 from
                                 #   the DO for never-created/expired lobbies.
                                 #   Mounted BEFORE the CORS middleware: ws
                                 #   handshakes aren't CORS-guarded and the 101
                                 #   response's headers are immutable
```

---

## 7. Frontend changes

- Typed **API client** (shared or `apps/web/src/lib/api.ts`) replacing fixture
  imports.
- Swap `CARD_POOL` for a fetched, paginated, server-filtered card search.
- Point deck + folder persistence at the API (behind the `persistedState` seam);
  add **auth UI** (login/register, Discord/Google buttons, session state).
- ✅ **Lobby transport swapped** (P1 m8): `net/channel.ts` is a WebSocket
  channel against the DO; lobby types/reducer/codes come from
  `packages/schema`. The api origin is read ONCE, in `src/lib/apiOrigin.ts`,
  from **`VITE_API_ORIGIN`** (default `http://localhost:8787`; ws(s):// is
  derived from it) — the M9 API client should reuse that module.
- ✅ **CSP updated** (M9): `vite.config.ts` derives it from `VITE_API_ORIGIN`
  via `loadEnv` (img-src + connect-src get the api origin, connect-src also
  its ws(s) twin; scrydex removed). NOTE: the config re-derives the origin —
  it can't import `apiOrigin.ts` (`import.meta.env`); a shared env-free
  module is on the M9 review backlog (deck-builder.md).

---

## 8. Work plan (milestones)

1. ✅ **Scaffold** `apps/api` (Hono + wrangler) + `packages/schema` (+ stub
   `packages/engine`); Bun workspaces; `/health` deployed green at
   `https://luminous-api.jofrescari.workers.dev/health`.
2. ✅ **Schemas** — tcgdex Zod schemas (`packages/schema/src/tcgdex/`, fixtures
   + 19 tests + live sweep via `bun packages/schema/scripts/validate-live.ts`,
   370 requests / 0 failures); lobby types/reducer moved to
   `packages/schema/src/lobby/`, web importers now use `@luminous/schema`.
3. ✅ **D1 migrations** — catalog + user tables via Drizzle
   (`apps/api/src/db/`, migration `apps/api/drizzle/0000_tired_sentry.sql`,
   scripts `db:generate` / `db:migrate:local` / `db:migrate:remote`). Applied
   locally and remotely.
4. ✅ **Ingest + R2 mirror** — local CLI `apps/api/scripts/ingest.ts` (validated
   upserts, idempotent, `--dry-run`) + lazy cache-aside `/assets/*` mirror (D9,
   §3.4). *Remote migrations 0001/0002 + full `--serie sv --remote` run pending
   user approval.*
5. ✅ **Catalog read API** — cards/sets/series with filtering/pagination + KV
   cache (`apps/api/src/catalog/`); canonical domain `Card` in
   `packages/schema/src/catalog/` (§5.2, §6).
6. ✅ **Auth** — email/password + sessions + Discord/Google OAuth
   (`apps/api/src/auth/`, §3.5 as-built; email flows 501 pending provider;
   OAuth 503 until the user sets the four `wrangler secret`s).
7. ✅ **Deck persistence API** — decks/folders CRUD tied to the session user
   (`apps/api/src/decks/`, §6 as-built; domain schemas in
   `packages/schema/src/decks/`; session gate extracted to
   `apps/api/src/auth/requireUser.ts`, now also backing `GET /auth/me`).
8. ✅ **Lobby Durable Object** — `LobbyDO` WS server running the shared
   reducer (hibernation + alarms, `apps/api/src/lobby/`, §3.6 as-built); wire
   schemas + `lobbyCode` moved into `packages/schema/src/lobby/`; client
   transport swapped to WebSocket (`net/channel.ts`, `VITE_API_ORIGIN`).
9. ✅ **Frontend swap (M9, 2026-07-13)** — typed zod-free client
   `src/lib/api.ts`; builder on the server catalog (adapter
   `src/features/builder/catalog.ts`, `useCardSearch`, `cardStore` deck
   hydration; api gained repeatable type/rarity + sort + extended CardBrief —
   D10, cache keys `catalog:v2:`); auth UI (`src/features/auth/`,
   AuthProvider/AuthPage/AccountButton); decks & folders + deck contents on
   the API (optimistic updates; localStorage deck store retired); CSP from
   `VITE_API_ORIGIN`. Deferred items → deck-builder.md "M9 review backlog".
10. **(stretch)** Cron Trigger to refresh new sets; widen ingest scope.

---

## 9. Assumptions locked unless overridden

- Bun-workspace monorepo; API + Lobby DO on Cloudflare **Workers** via `wrangler`.
- **Hono** + **Zod**; **Drizzle** over D1; official `@tcgdex/sdk` for ingest.
- Server **sessions** (http-only cookie), not stateless JWT.
- Ingest filters to SV-era but writes the full-history schema.
- English (`en`) first; schema leaves room for i18n later.
- Match engine (actual gameplay) stays a placeholder this phase.
```
