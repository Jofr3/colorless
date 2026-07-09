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

### 3.4 Ingest & image-sync pipeline

A separate entrypoint (not the request Worker), runnable on demand and later on
a **Cron Trigger**:

1. Traverse series → sets → cards from tcgdex (**≈ assumption:** official
   `@tcgdex/sdk`; validate each payload with our Zod schemas).
2. **Filter to SV-era / Standard scope** (D3) on ingest, but store into the
   **full-history-capable schema** so widening scope is data-only later.
3. Upsert into D1 (idempotent by tcgdex `id`; skip unchanged via `updated`).
4. Per asset: fetch `{image}/high.webp` (+ small), **stream into R2** under a
   stable key, persist the R2 URL on the row.

### 3.5 Auth (D2 / D2a)

- `users`, `oauth_identities`, `sessions` in D1; secure **http-only session
  cookie** (server sessions, not stateless JWT — easy logout/rotation).
- **Email + password:** hash with a Workers-compatible Argon2id/scrypt (WASM) or
  PBKDF2 (WebCrypto). Include password-reset + email-verify flows.
- **OAuth (Discord + Google):** standard authorization-code flow; on callback,
  find-or-create a `user` and link an `oauth_identities` row. Requires app
  registration + redirect URIs per environment; client secrets via
  `wrangler secret`.
- A single user may hold both a password and one or more OAuth identities.

### 3.6 Lobby Durable Object (D6)

- One **Durable Object per lobby code**. It owns the authoritative
  `LobbySnapshot` and runs the **existing `lobbyReducer`** server-side.
- Clients connect over **WebSocket**; the DO validates each incoming
  `LobbyIntent`, applies it via the reducer, and broadcasts the new snapshot —
  exactly the host-authoritative model the client already assumes.
- **Frontend change is minimal by design:** swap `net/channel.ts` from
  `BroadcastChannel` to a WebSocket transport; the reducer, snapshot, and
  message types are unchanged (now imported from `packages/schema`).
- Handle reconnect (session id already exists on `PlayerState`), heartbeat, and
  DO hibernation.

### 3.7 Deployment

- API + DO: `wrangler deploy`; secrets via `wrangler secret`.
- Web: Cloudflare Pages / Workers static assets, calling the API over HTTPS.
- Images: R2 bound to a custom domain / Worker route.

---

## 4. tcgdex.dev integration reference

Researched from the official docs so the implementation can be exact.

### 4.1 Access methods

- **REST** base: `https://api.tcgdex.net/v2/{lang}/` (`lang` = `en`, `fr`, `de`,
  `es`, `it`, `pt`, `ja`, …). HTTPS only, **GET only**, JSON.
- **GraphQL**: `https://api.tcgdex.net/v2/graphql`.
- **Official SDK**: `@tcgdex/sdk` (TS/JS) — ingest traversal; validate at our
  boundary with our own Zod schemas.

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

> We **mirror into R2 (D4)**: ingest resolves these tcgdex asset URLs, stores the
> bytes in R2, and persists **our** R2 URL. tcgdex ids (`swsh3-136`) become our
> canonical id — no more Scrydex reconciliation.

---

## 5. Schemas & data model

### 5.1 tcgdex models (Zod, in `packages/schema`)

Author Zod schemas + inferred types mirroring the API, then map onto our domain.

- **Card** (full): `id, localId, name, image?, category ("Pokemon"|"Trainer"|
  "Energy"), illustrator?, rarity?, set (SetBrief), variants {normal, reverse,
  holo, firstEdition}, boosters?, pricing?, updated`
  - **Pokémon** extras: `dexId?, hp?, types?, evolveFrom?, description?, level?,
    stage?, suffix?, item? {name, effect}, attacks?, weaknesses?, resistances?,
    retreat?, regulationMark?, legal? {standard, expanded}`
  - **Trainer** extras: `effect, trainerType` · **Energy** extras: `effect,
    energyType`
  - Nested: **Attack** `{cost?: string[], name, effect?, damage?}`,
    **WeakRes** `{type, value}`, **Variants**, **Legal**, **Pricing**
    (TCGPlayer + Cardmarket), **Booster**.
- **CardBrief / CardResume:** `{id, localId, name, image?}` (+ variants on lists).
- **Set** (full): `id, name, logo?, symbol?, cardCount {total, official, reverse,
  holo, firstEd}, serie (SerieBrief), tcgOnline?, releaseDate, legal {standard,
  expanded}, boosters?, cards: CardBrief[]`
- **SetBrief:** `{id, name, logo?, symbol?, cardCount {total, official}}`
- **Serie** (full): `{id, name, logo?, sets: SetBrief[]}` · **SerieBrief:** `{id, name}`

### 5.2 Canonical domain `Card` (D5 = unify)

Define **one** canonical `Card` in `packages/schema`, mapped from the tcgdex
model, and derive the two existing view shapes from it:
- **`BuilderCard`** view (`src/features/builder/cards.ts`) — browse/filter/deck
  math. Preserve the existing energy-type/subtype/rarity/format vocabulary.
- **`CardModel`** view (`src/features/playmat/types.ts`) — in-play card.

Keep the existing `Deck` / `Folder` shapes (`src/features/decks/data.ts`) as the
API's deck representation, extended with a card list.

### 5.3 D1 relational schema (draft)

Full-history-capable; SV-era rows only, for now.

```sql
-- Catalog (ingested; read-only to the app)
series(id PK, name, logo_r2_url)
sets(id PK, serie_id FK, name, logo_r2_url, symbol_r2_url,
     release_date, count_total, count_official, legal_standard, legal_expanded,
     tcg_online, updated)
cards(id PK, set_id FK, local_id, name, category,        -- Pokemon|Trainer|Energy
      illustrator, rarity, regulation_mark,
      hp, stage, evolve_from, types_json,                -- Pokémon fields (nullable)
      trainer_type, energy_type, effect,                 -- Trainer/Energy fields
      legal_standard, legal_expanded,
      variants_json, image_r2_url, updated,
      attacks_json, weaknesses_json, resistances_json, retreat)

-- User data (read-write)
users(id PK, email UNIQUE, display_name, password_hash?, email_verified, created_at)
oauth_identities(provider, provider_id, user_id FK, PRIMARY KEY(provider, provider_id))
sessions(id PK, user_id FK, expires_at, created_at)
folders(id PK, user_id FK, parent_id FK?, name)
decks(id PK, user_id FK, folder_id FK?, name, format, tint, updated)
deck_cards(deck_id FK, card_id FK, count, PRIMARY KEY(deck_id, card_id))
```

---

## 6. API surface (v1)

```
GET    /health

# Catalog (public, KV-cached)
GET    /cards            # search: name, types, hp, rarity, set, regulationMark, page…
GET    /cards/:id
GET    /sets
GET    /sets/:id
GET    /series

# Auth (D2a)
POST   /auth/register            # email + password
POST   /auth/login
POST   /auth/logout
GET    /auth/me
GET    /auth/oauth/:provider     # discord | google — start
GET    /auth/oauth/:provider/callback
POST   /auth/verify-email  ·  POST /auth/reset-password

# Decks & folders (auth required)
GET    /decks   ·  POST /decks   ·  GET/PATCH/DELETE /decks/:id
GET    /folders ·  POST /folders ·  GET/PATCH/DELETE /folders/:id

# Lobby (Durable Object)
GET    /lobby/:code/ws           # WebSocket upgrade → the lobby's DO
POST   /lobby                    # create a lobby (mint code, return it)
```

---

## 7. Frontend changes

- Typed **API client** (shared or `apps/web/src/lib/api.ts`) replacing fixture
  imports.
- Swap `CARD_POOL` for a fetched, paginated, server-filtered card search.
- Point deck + folder persistence at the API (behind the `persistedState` seam);
  add **auth UI** (login/register, Discord/Google buttons, session state).
- **Swap the lobby transport** `net/channel.ts` from `BroadcastChannel` to
  WebSocket against the DO; import lobby types/reducer from `packages/schema`.
- **Update the CSP** in `vite.config.ts`: replace `images.scrydex.com` with our
  API origin, R2 image domain, and `wss:` for the lobby socket.

---

## 8. Work plan (milestones)

1. ✅ **Scaffold** `apps/api` (Hono + wrangler) + `packages/schema` (+ stub
   `packages/engine`); Bun workspaces; `/health` deployed green at
   `https://luminous-api.jofrescari.workers.dev/health`.
2. **Schemas** — tcgdex Zod schemas, tested against live responses; move lobby
   types/reducer into `packages/schema`.
3. **D1 migrations** — catalog + user tables (Drizzle).
4. **Ingest + R2 mirror** — traverse tcgdex (SV-era), upsert D1, stream images
   to R2; idempotent + re-runnable.
5. **Catalog read API** — cards/sets/series with filtering/pagination + KV cache.
6. **Auth** — email/password + Discord/Google OAuth; sessions.
7. **Deck persistence API** — decks/folders CRUD tied to user.
8. **Lobby Durable Object** — WS server running the reducer; swap client
   transport.
9. **Frontend swap** — API client; replace `CARD_POOL`; auth UI; CSP update.
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
