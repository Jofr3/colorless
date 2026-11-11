# Backend and data: the original plan and the 2026-08 deploy notes (history)

Moved verbatim from `docs/workstreams/backend-data.md` on 2026-11-11 (DOC-P2); that file is now the as-built reference.

---

*From the title, status note and founding decisions table (above §1), and §1-2:*

# Next Phase — Backend + Real Card Data

> **Status:** Working spec, all major decisions made. This is a prompt/brief for
> the next build phase; refine as implementation reveals detail.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Backend data strategy | **Own DB** — ingest tcgdex → Cloudflare **D1**, serve our own API |
| D2 | Accounts & persistence | **Full accounts + auth**; users own their decks |
| D2a | Auth methods | **Email + password** *and* **social OAuth (Google)** |
| D3 | Catalog scope | **Full-history-capable schema, ingest SV-era first** |
| D4 | Card images | **Mirror into R2**, serve from our domain |
| D5 | Card type | **Unify** — one canonical `Card`, with builder/playmat view projections |
| D6 | Online lobby server | **In scope** — real **Durable Object** (WebSocket) lobby server |

---

## 1. Where the project is today

`colorless` is currently a **frontend-only skeleton**: the design language,
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
5. **Add accounts + auth** (email/password + Google OAuth); persist
   users' **decks** server-side.
6. **Promote the online lobby to a real server** — a Durable Object over
   WebSocket, reusing the existing lobby reducer + message types.

Out of scope: the real-time **match engine** (playing an actual game of cards).
This phase gets players into a real shared lobby; the match itself stays a
placeholder.


---

*From §3's July diagram and §3.1-3.3, the plan as written:*

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
colorless/
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

---

*From §3.6 as it stood before the 2026-11-11 rewrite:*

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
     create), `storage.deleteAll()` wipes the lobby and frees the code; a socket
     upgrade for a never-created/expired code is accepted and closed at once
     with 4004 (`LOBBY_WS_NOT_FOUND`), which the client shows as "not found".
     A lobby nobody has said hello in derives its expiry from `created`
     instead of storing `cleanupAt` (security LB3), so a create writes 2 keys and an alarm and its wipe deletes 2 keys: 5 rows
     written, down from 8.
  4. *Inactivity ceiling* — a lobby with sockets but no commit or accepted
     action or seated hello for an hour (`INACTIVE_LOBBY_MS`, judged from an `activeAt` stamp
     written at most every 5 min, else `created`) is closed: every socket gets
     close code `LOBBY_WS_CLOSED` (4000), which the client takes as "not found"
     and does not reconnect after, and the lobby is wiped (security LB2).
- **Abuse limits (security Phase 3, `lobby/logic.ts`):** every frame spends
  from a per-socket token bucket before it is parsed (burst 40, which covers a
  reconnect's 32 queued frames plus its hello; refill 5 a second); a frame past
  it closes the socket with 1008, and a frame over 16K characters (the largest
  legitimate one, an action over a whole deck, is about 4K) with 1009. Both run
  `socketGone`, so the seat gets its grace. A lobby holds 12 sockets (2 seats,
  8 spectators, 2 for a reload's old and new socket); past that a socket is
  turned away (its hello is answered `reject full`, shown as "Lobby is full",
  and it is closed with 1013), except that an account holding a seat is let in
  up to 16; up to 4 turned-away sockets are held at once and any further
  upgrade is refused with 503. `scheduleMaintenance` keeps an alarm already due
  at or before the next deadline, so a commit no longer re-sets the alarm (one
  row per commit instead of two). Each distinct match frame (a seat's view, the
  spectators' shared one) is built once per broadcast. The match log keeps at
  most 2000 rows: past that it is cut to the newest 1500 behind a system row
  "Earlier log entries were trimmed." and sent whole (security MIX2).
- **Session re-check (security Phase 5, MI4, user decision 13):** a socket
  keeps the account its cookie resolved to at the upgrade for as long as it
  stays open. A `rematch` re-reads the session of every socket holding a seat
  (`lobby/sessionCheck.ts`, one primary-key read, none for anonymous seats),
  and refuses the rematch if one ended (a logout, a revoked session, a deleted
  account, whose sessions cascade): the asker gets a `reject-action` saying who
  is signed out, and the sockets on the ended session are closed with 1008.
  Their reconnect, with no live cookie, is refused the account-bound seat and
  watches. A failed read lets the rematch through, since the handoff's deck
  read re-checks each session in the same query. Nothing else re-reads a
  session: a match already running plays out.
- **Names:** a seat's name comes only from its hello, the account's name for a
  signed-in socket. The `set-name` intent is gone from the wire (security
  AU8); a frame carrying it fails validation and is dropped, after spending
  from the socket's budget like any frame.
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

---

*From §3.7's intro and §3.7.1, the 2026-08 deploy runbook (D203):*

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
cd apps/api && bun scripts/with-deploy-token.ts bun scripts/ingest.ts --serie sv --remote

# 4. Step 3 ends by stamping a new `catalog:epoch` in the CACHE KV namespace,
#    which is part of every catalog cache key (apps/api/src/catalog/cache.ts), so
#    the pre-ingest KV entries stop being served within about six minutes; a
#    browser may show its own cached body for up to an hour more. A data-only
#    change does not bump `CACHE_VERSION`.
```

**Command check (against `package.json` and `apps/api/package.json`):**

| Command | Exists? |
| --- | --- |
| `bun run db:migrate:remote` **from the repo root** | ❌ **NO** — the root `package.json` has no such script. It is defined only in `apps/api/package.json`, so it must be run as `cd apps/api && bun run db:migrate:remote` (or `bun run --cwd apps/api db:migrate:remote`). Commit messages that quote the bare form are wrong. |
| `cd apps/api && bun run db:migrate:remote` | ✅ `with-deploy-token.ts wrangler d1 migrations apply colorless --remote` |
| `cd apps/api && bun scripts/with-deploy-token.ts bun scripts/ingest.ts --remote` | ✅ the script exists; `--remote` and `--serie` are real flags (`apps/api/scripts/ingest.ts`). Note it is `bun scripts/ingest.ts`, **not** `bun run` — there is no npm script wrapping it. |
| `bun run api:deploy` (repo root) | ✅ `bun run --cwd apps/api deploy` → `release-gate.ts migrations clean-tree ci -- wrangler deploy --minify`, which deploys with the commit's tag and message (§3.7.2) |
| `cd apps/api && bun run db:migrate:local` | ✅ the local twin, used for the pre-flight |

**Why step 3 has never run here.** `api.tcgdex.net` is refused by this
environment's network policy — the same wall D188, D194, D197 and D198 hit. The
ingest is the only step that needs the public internet; steps 1, 2 and 4 do not,
and step 1 is therefore unblocked TODAY and should not wait for the backfill.

---

*From §3.7.2, the one-time secrets step of 2026-10-27:*

**Secrets before the first Phase 5 release (security audit 2026-10-27).** Generate
`PASSWORD_PEPPER` and `LOG_TAG_KEY` (`openssl rand -base64 32` each), save both in
the password manager, then from `apps/api/` run
`bun scripts/with-deploy-token.ts bunx wrangler secret put PASSWORD_PEPPER` and
`bun scripts/with-deploy-token.ts bunx wrangler secret put LOG_TAG_KEY`, and only
then `bun run release`. A secret put applies to the running Worker at once and the old code
ignores both, so the order is safe; the gate refuses the release until both exist.
Nobody is logged out: existing hashes are re-peppered at each account's next
sign-in. Google sign-ins in flight at the deploy fail once (PKCE changed the state
cookie). `check:static` adds `migration-guard.ts` (no unreviewed table rebuild,
drop or rename) and `drizzle-drift.ts` (schema.ts matches the migrations); see
docs/conventions.md "Database migrations".

---

*From §3.7.3, the drill's closing line:*

Record the restore's duration and anything that differed here.

---

*From §5.2 as it stood (the React-era view shapes):*

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
> `DeckSummary` (the summed `cardCount`, with `cards` only on complete decks), and the
> create/patch request schemas for both resources.

---

*From §5.3's column sketch and its first-draft deltas:*

### 5.3 D1 relational schema

Full-history-capable; SV-era rows only, for now. Implemented with Drizzle in
`apps/api/src/db/` (`catalog.ts` / `users.ts`); migrations in `apps/api/drizzle/`.

```sql
-- Catalog (ingested; read-only to the app)
series(id PK, name, release_date, logo_url)
sets(id PK, serie_id FK, name, logo_url, symbol_url,
     release_date, count_total, count_official, legal_standard, legal_expanded,
     tcg_online, abbreviation)              -- abbreviation: tcgdex abbreviation.official
cards(id PK, set_id FK, local_id, name, category,        -- Pokemon|Trainer|Energy
      illustrator, rarity, regulation_mark,
      hp, stage, suffix, evolve_from, types_json, retreat, -- Pokémon fields (nullable)
      abilities_json, attacks_json, weaknesses_json, resistances_json,
      trainer_type, energy_type, effect,                 -- Trainer/Energy fields
      legal_standard, legal_expanded,                    -- tcgdex, per print
      print_key, legal_standard_effective, legal_expanded_effective,
        -- the reprint rule: print_key = the card's functional identity (ingest
        -- map.ts printKey); *_effective = legality OR'd across prints sharing
        -- it (ingest post-pass reprintLegalitySql). Readers coalesce onto the
        -- per-print flags. The engine's PROGRAM_ALIAS table
        -- (scripts/registry-aliases.ts) is generated from print_key, so one
        -- registry row programs every print in the group.
      variants_json, image_url, updated)

-- User data (read-write)
users(id PK, email UNIQUE, display_name, password_hash?, email_verified, name_prompt, created_at)
  -- display_name: typed, or a generated "Trainer-XXXX" handle (AU3); name_prompt: ask once to
  -- choose a public name (accounts from before handles; PATCH /auth/me clears it)
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

---

*From §5.3.1, the pending `mfb` re-ingest (D194):*

The write-side guard only takes effect on the next ingest of `mfb`; the rows
in D1 still hold `"None"` until then. To discharge it at the source:

```sh
cd apps/api && bun scripts/with-deploy-token.ts bun scripts/ingest.ts --sets mfb --remote
```

(Idempotent — every statement is an `ON CONFLICT DO UPDATE` upsert, and
mapping now emits NULL for those two columns.) It could not be run in the
session that landed the fix: `api.tcgdex.net` is blocked by the network
policy there.

---

*From §5.3.2, the pending `suffix` re-ingest and migrations (D197, D198, D203):*

⚠️ **Unproven until a re-ingest: the column has no values.** Discharge with:

```sh
cd apps/api && bun scripts/with-deploy-token.ts bun scripts/ingest.ts --remote     # then re-check the census below
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

---

*From §7-9: frontend changes, the milestone plan and the locked assumptions:*

## 7. Frontend changes

- Typed **API client** (shared or `apps/web/src/lib/api.ts`) replacing fixture
  imports.
- Swap `CARD_POOL` for a fetched, paginated, server-filtered card search.
- Point deck + folder persistence at the API (behind the `persistedState` seam);
  add **auth UI** (login/register, Google buttons, session state).
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
   `https://colorless-api.jofrescari.workers.dev/health`.
2. ✅ **Schemas** — tcgdex Zod schemas (`packages/schema/src/tcgdex/`, fixtures
   + 19 tests + live sweep via `bun packages/schema/scripts/validate-live.ts`,
   370 requests / 0 failures); lobby types/reducer moved to
   `packages/schema/src/lobby/`, web importers now use `@colorless/schema`.
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
6. ✅ **Auth** — email/password + sessions + Google OAuth
   (`apps/api/src/auth/`, §3.5 as-built; email flows 501 pending provider;
   OAuth 503 until the user sets the two Google `wrangler secret`s).
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
