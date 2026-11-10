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

### 3.4 Ingest & asset pipeline (D9: local data ingest, lazy image mirror)

**Card data** is ingested by a local Bun script — `apps/api/scripts/ingest.ts`
(`bun scripts/ingest.ts [--serie sv | --sets sv01,sv02] [--remote] [--dry-run]
[--refresh] [--transport=fetch|sdk] [--allow-legality-change]`, run from `apps/api/`) — not by the request Worker:

1. Traverse serie → sets → each card's full detail from the tcgdex REST API
   (four requests in flight, starts ~50ms apart), validating every payload with
   the Zod schemas in `@colorless/schema`; any card validation failure aborts
   that set with a report. Serie, set and card ids must match
   `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` with no `..` (`TCGDEX_ID_PATTERN`),
   since they become file names, URL segments and R2 keys; the SQL file
   label is also percent-encoded and checked to stay in the run's directory.
   Validated payloads are kept for a day under
   `apps/api/.wrangler/tcgdex-cache/` and revalidated when read back, so a
   rerun (the remote ingest after a local one) does not refetch; `--refresh`
   ignores the cache.
2. Map onto the §5.3 rows (missing `legal` → false/false, so a set in which
   a card stored as legal comes without `legal` is aborted, unless
   `--allow-legality-change`: that is upstream drift, not a rotation; category-specific
   fields NULL elsewhere; `*_url` columns keep the tcgdex **origin** base
   URLs, only when https on `assets.tcgdex.net`, else NULL) and generate batched upsert SQL — `INSERT … ON CONFLICT(id) DO
   UPDATE … WHERE <a column changed>`, ≤100 cards per statement
   (`apps/api/src/ingest/`, unit-tested). Unchanged rows are not rewritten.
3. Apply in FK order (series, then one file per set holding the set row and
   its card statements) via `wrangler d1 execute colorless --local|--remote
   --file …`, then the reprint-legality pass, then stamp `catalog:epoch` in
   the CACHE namespace of the same target (§6). Idempotent by tcgdex `id` —
   rerunning is always safe; `--dry-run` writes SQL, applies nothing.

**Images are NOT mirrored at ingest time.** The Worker's `GET /assets/*`
routes (§6) mirror lazily, cache-aside: R2 hit → serve; miss → resolve the
origin base URL from D1, fetch the original from tcgdex, store it in R2,
respond. Only `assets.tcgdex.net` over https is fetched, and only an `image/*`
body of the file's type (by magic bytes) up to 5 MB is stored; the allowlist
is the files a client uses (`high.webp` for cards). Only an origin 404 or 410
is a missing image (404, cached an hour); any other non-200 (a 429, 403 or 408
is logged as `origin_status`), a network error, a broken body or no full answer
within 10 s is an uncached 502, never stored. An R2 read that throws is logged
(`r2_get_failed`) and served from the origin as a miss. Rationale: a full SV-era backfill is ~10k images — over Worker
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

What each run writes (2026-10-27):
- Each set is one file: the set row, its cards in statements under 90 KB
  (D1 refuses 100 KB), and the reprint pass scoped to that set, so one import
  upserts the cards and settles their effective legality together. An upsert
  never overwrites `legal_*_effective` on an existing row; the passes own it.
  A row whose only change is tcgdex's `updated` stamp is not rewritten.
- The series upsert and the whole-table reprint pass go through `--command`.
  If that pass fails, rerun the same command: unchanged rows are skipped.
- **`--remote` imports each set file**, and wrangler warns that the database
  answers no queries while an import runs (a few seconds a set; 30 sets for a
  full refresh). Run remote ingests at low traffic (user decision, 2026-10-27).
  Each remote run first records a Time Travel bookmark (§3.7.3), prints the
  rows written per file, and does not stamp `catalog:epoch` when it wrote no
  rows, so cached pages and the KV writes to refill them survive a no-op run.
  Run `bun run db:check -- --remote` afterwards.

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
corrupt D1 row). The Zod schemas in `@colorless/schema` remain the validation
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
- **No deadline or retry.** The seam gives every request 15 s, body included,
  and `createSource` retries a failure that may pass up to 3 times: a network
  error, a timeout, a 200 whose body is not JSON, and under `fetch` a 408, 429
  or 5xx. It waits the server's `Retry-After` (at most a minute) or else a
  full-jitter backoff (up to 1, 2, 4 s). Each attempt is paced and counted. A
  404 or another 4xx, and the SDK's `undefined`, fail at once. Under `sdk` the
  deadline only stops the wait, since the SDK takes no signal. A set that still
  fails is listed at the end of the run with the `--sets` command that retries
  it alone.

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
  `session` (`HttpOnly; Secure; SameSite=Lax; Path=/`, 30-day `Max-Age`); the DB row id
  is **sha256(token)**, so a leaked dump authenticates nothing. Expiry is
  enforced on read; an expired row is deleted when its cookie is presented
  (after the response, best effort: a failed delete still answers 401 and is
  logged `expired_session_delete_failed`) or the user signs in again, and a
  daily Cron Trigger (`17 4 * * *`,
  `apps/api/src/auth/sweep.ts`) deletes the rest, 500 rows per statement and
  at most 10,000 per table per run, logging `evt = "d1", kind = "sweep"`.
  The web app is a **different origin but the same site**: the public suffix
  is `workers.dev` itself, so both Workers sit on `jofrescari.workers.dev`
  (locally both are on `localhost`, ports aside), and a Lax cookie rides the
  app's credentialed fetches and the lobby WebSocket. The Worker runs
  `hono/cors` app-wide with `origin = APP_ORIGIN` (wrangler.jsonc `vars`, dev
  default `http://localhost:5175`) and `credentials: true`, and the client
  fetches with `credentials: "include"`. Preflights allow only the
  `Content-Type` request header and `GET, HEAD, POST, PATCH, DELETE`, which is
  all the client sends. `GET /auth/me` re-sends the cookie with its remaining
  lifetime, which replaced the `SameSite=None` cookies set before 2026-10-27.
  **Cross-site guard:** a POST, PUT, PATCH or DELETE whose `Origin` is not an
  app origin (including `null`), or that says `Sec-Fetch-Site: cross-site`,
  gets 403 `{"error":"forbidden origin"}` before it runs
  (`evt = "http", kind = "cross_site_refused"`, throttled). A request with no
  `Origin` (curl, tests) passes, since it carries no visitor's cookie. The lobby
  WebSocket upgrade applies the same origin list.
- **Email + password:** PBKDF2-SHA256 via WebCrypto (zero deps,
  Workers-native) over HMAC-SHA256(`PASSWORD_PEPPER`, password), stored as
  `pbkdf2p$<pepper id>$<iterations>$<salt-b64url>$<hash-b64url>` (security
  audit AU9). Hashes from before the pepper are `pbkdf2$<iterations>$…` and
  still verify. Verify reads the scheme, pepper id and iteration count from the
  encoding, so raising the default (currently 100k) or adding the pepper
  upgrades hashes lazily: a successful login re-hashes at today's iterations
  under today's pepper, and nobody is logged out. The pepper id is 8 base64url
  characters of an HMAC of a fixed string under the pepper, so a hash names its
  pepper without revealing it. **Pepper custody:** `PASSWORD_PEPPER` is a
  `wrangler secret`, never in D1, so an exported database alone cannot be
  cracked offline; the price is that losing it locks every peppered password
  account out of password sign-in (Google sign-in still works) — keep a copy in
  the password manager before `wrangler secret put`. Rotation: set the old value
  as `PASSWORD_PEPPER_PREVIOUS` and the new one as `PASSWORD_PEPPER`; hashes
  under either verify and are re-peppered with the new one on login; drop the
  previous one once the accounts that matter have signed in. **Without the
  secret** the Worker fails safe rather than closed: it keeps making unpeppered
  hashes (as before) and logs a throttled error `evt = "auth", kind =
  "pepper_missing"`, because refusing every sign-up and login over a missing
  secret would be an outage while unpeppered hashes are only the old status
  quo, upgraded on the next login once the secret is back; the release gate
  refuses to release without it (§3.7.2). A stored hash whose pepper the
  Worker does not hold (a lost or mistyped secret) answers 503 + `Retry-After:
  60` (`kind = "pepper_unavailable"`), never a 401, and counts no failure.
  Constant-time
  compare; login burns a dummy verify on unknown emails (timing parity) and
  answers one uniform 401. *Caveat:* 100k iterations ≈ tens of ms CPU (about
  42 ms per PBKDF2 measured in local workerd, 2026-11-09; a login that
  re-hashes runs two) — if
  free-plan Workers CPU limits 500 the auth routes in production, lower the
  count or move to WASM Argon2. The 30 days to 2026-11-09 showed no
  `exceededCpu` outcome on any route. Register/login are rate-limited per scope in
  the D1 table `auth_rate_limits` (`apps/api/src/auth/rateLimit.ts`): login
  (and deletion) 10 attempts per 15 min per (IP, email) and 50 per IP across
  emails; register 5 per hour per IP (security audit AUX1: each allowed
  register writes about 10 rows and leaves a user behind). An IPv6 address
  counts as its /64. Keys are SHA-256 hashes, never the IP or email. In front
  of it, the Workers Rate Limiting binding `AUTH_LIMIT` allows 10 a minute per
  (scope, IP) and refuses a flood with 429 + `Retry-After: 60` before any D1
  write; it fails open on a binding error (`evt = "auth", kind =
  "binding_error"`), like the lobby's, while the D1 limiter behind it still
  fails closed.
  The counting upserts run in the same `db.batch` as the user lookup, so they
  are exact under concurrency and cost no extra round trip; an attempt already
  over budget writes nothing. Over budget → 429 with `Retry-After`. A D1 error
  (such as a spent write quota) fails closed: 503 with `Retry-After: 60`, and
  `evt = "auth", kind = "limiter_error"` (security audit AU5; failing open made
  login an unthrottled password oracle once writes failed). **Per-email
  failure cap** (security audit AU6, decision 9): every failed login also
  counts against an IP-free (login, email) key, unknown emails included; after
  50 failures in an hour, further *failures* answer 429 `too many attempts` +
  `Retry-After` (the end of that hour) instead of 401, and write nothing. The
  password is still checked, so the right one signs in past the cap: anyone
  can make a known email's failures say 429, but nobody can lock its owner out
  of password sign-in, and 429 says nothing 401 did not (both mean "not this
  password", whoever owns the email). It does not slow a guesser spread over
  many addresses — the per-address budgets bound that — it marks the targeted
  account in the logs (`login_failed` with `capped: true`) and tells clients to
  back off. A device-cookie scheme would be the next step if distributed
  guessing is ever seen. A failed login costs one more D1 batch (the failure
  upsert and a read of its window). The profile's
  favourite-deck field is retired: `PATCH /auth/me` ignores `favouriteDeckId`
  and users no longer carry it; the `users.favourite_deck_id` column stays.
- **Sign out everywhere** (security audit AU7): `POST /auth/logout-all` (behind
  `requireUser` and the cross-site guard) deletes every session of the
  caller's account, this one included, and clears the cookie → 204. Settings →
  Account has a "Sign out everywhere" button. Sessions keep their 30-day
  absolute lifetime; the audit's optional idle timeout was not added (it would
  cost a D1 write per active session per day, shared with deck saves). A lobby
  socket opened before keeps its seat until it closes.
- **Audit trail** (security audit AU10): `registered`, `login_ok` (`method`
  password or oauth, `rehashed`), `login_failed`, `logout`, `logout_all`,
  `profile_updated`, `delete_failed`, `account_deleted`, `oauth_created`,
  `oauth_linked` (`claimed`, with `identitiesRemoved` and `sessionsRevoked` for
  a claim) and `oauth_refused` lines under `evt = "auth"`. Each names its
  account by a tag, `HMAC-SHA256(LOG_TAG_KEY, "account\n" + userId)` cut to 12
  base64url characters (`apps/api/src/http/logTag.ts`), and `rate_limited` names
  the network by the same MAC of its clientIpKey (`net`). Without the
  `LOG_TAG_KEY` secret every tag reads `untagged`. No line carries an email,
  IP, user id or `avatarSeed` (public in lobbies); Cloudflare's own invocation
  event beside it does hold the IP (§3.7.4). Losing or rotating the key
  only stops old tags matching new ones.
- **Account deletion** (database audit OP6): `DELETE /auth/me` with
  `{password?, confirmEmail?}`. An account with a password must send it (wrong
  or missing → 401 `invalid password`, counted by the limiter in its own
  `delete` scope, so a stolen cookie cannot guess it fast); an OAuth-only
  account must send its email as typed, compared trimmed and case-insensitively
  (missing or different → 403 `email confirmation mismatch`, security audit
  WC1), so the cookie alone never deletes an account. The client never prefills
  that field. One
  `DELETE FROM users`, scoped to the verified hash like the login's session
  insert, and the `ON DELETE CASCADE` keys remove its sessions, identities,
  folders, decks and deck cards. The 204 clears the cookie as logout does and
  logs `evt = "auth", kind = "account_deleted"` with the account tag and no id
  or email. Limiter
  rows age out on their own; a lobby seat bound to the id only compares it, and
  the handoff's deck read finds nothing. There is no purge of unverified
  accounts. The web app asks for the password (or, without one, the email) in
  the Settings account tab and needs a second press to confirm.
- **Password-reset + email-verify are 501 stubs** — they need an outbound
  email provider, which is not chosen yet; no token plumbing exists until it
  is (`POST /auth/verify-email`, `POST /auth/reset-password` explain this).
  **Known limit (security audit AU11, decision 11, accepted):** with no email
  verification and no reset, `POST /auth/register` is an account-enumeration
  oracle (409 `email already registered`, slowed only by the register budget),
  and anyone can register someone else's address. Its owner can recover a
  squatted address only by signing in with Google under it (the verified-email
  claim below, which clears the squatter's password, sessions and identities);
  without a Google account there is no recovery. Revisit when an email provider
  is chosen: register would answer a generic 202 and finish through a link.
- **OAuth (Google):** standard authorization-code flow with PKCE (S256,
  security audit AU12); CSRF state, the PKCE code verifier and the allowlisted
  relative `?redirect=` path ride in one short-lived http-only cookie
  (`state.verifier.b64url(redirect)`), and only the verifier's SHA-256 goes to
  Google; the token exchange sends the verifier. A sign-in started before the
  PKCE deploy fails once with `?authError=state`. A provider `?error=` for this
  browser's state (`oauth_denied`, its code logged) goes back with no
  `authError` for `access_denied` (Cancel on the consent screen) and with
  `exchange` for any other; without the matching state it is a `state`
  failure. On callback: verify state →
  exchange code → fetch profile (Google `openid email` via OIDC userinfo;
  no `profile` scope, since no profile claim is read) → find-or-create: linked `oauth_identities` row → that user; else
  user by **provider-verified** email → link (unverified match ⇒
  `?authError=email-in-use`, no takeover); else, only for a provider-verified
  email, create user + identity (unverified ⇒ `?authError=email-unverified`, no
  account; security audit AU4). Linking a verified email to an **unverified**
  account claims it: one batch removes its password, its sessions **and every
  other OAuth identity** (AU4), then links this one, so whoever registered the
  address first keeps no way in. Then session + redirect to `APP_ORIGIN`. A
  D1 failure in find-or-create or the session insert goes back the same way
  with `?authError=unavailable` (logged `evt = "auth", kind =
  "oauth_unavailable"` at error level), never a JSON 500 at the API origin.
  Each Google request (token exchange, userinfo) gives up after 10 s, body
  included, as an `exchange` or `profile` failure. The account keeps the
  address Google gives (a longer one than 254 characters is a `profile`
  failure); `userSchema` returns any non-empty email up to that length, since
  Google verifies some `z.email()` refuses (API audit AUTH1). A single user may
  hold both a password and OAuth identities.
- **Providers activate by configuration alone** — with secrets absent the
  routes answer `503 {"error":"provider not configured"}`. To activate, register
  a Google OAuth client (<https://console.cloud.google.com/auth/clients>, Web application)
  with BOTH redirect URIs per provider:
  - `https://colorless-api.jofrescari.workers.dev/auth/oauth/google/callback`
  - `http://localhost:8787/auth/oauth/google/callback` (wrangler dev)

  then install the secrets (from `apps/api/`):

  ```sh
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
| `cd apps/api && bun run db:migrate:remote` | ✅ `wrangler d1 migrations apply colorless --remote` |
| `cd apps/api && bun scripts/ingest.ts --remote` | ✅ the script exists; `--remote` and `--serie` are real flags (`apps/api/scripts/ingest.ts`). Note it is `bun scripts/ingest.ts`, **not** `bun run` — there is no npm script wrapping it. |
| `bun run api:deploy` (repo root) | ✅ `bun run --cwd apps/api deploy` → `release-gate.ts migrations clean-tree ci -- wrangler deploy --minify`, which deploys with the commit's tag and message (§3.7.2) |
| `cd apps/api && bun run db:migrate:local` | ✅ the local twin, used for the pre-flight |

**Why step 3 has never run here.** `api.tcgdex.net` is refused by this
environment's network policy — the same wall D188, D194, D197 and D198 hit. The
ingest is the only step that needs the public internet; steps 1, 2 and 4 do not,
and step 1 is therefore unblocked TODAY and should not wait for the backfill.

#### 3.7.2 Release gates (2026-10-27; identity and checks 2026-11-10, BLD-P1)

`bun run release` runs, in order:

1. `check`.
2. `release:gate` (apps/api), whose steps are:
   - `pin`: writes HEAD to `tmp/release.json`, so the rest of the release can
     require that commit. It refuses while another commit's release holds a pin
     younger than 15 minutes. A pin of the same commit is an earlier, failed
     run of this release, and it is taken over.
   - `clean-tree`: no uncommitted changes, and HEAD is the remote's main, read
     with `git ls-remote` (a Dependabot merge on GitHub leaves the local
     `origin/main` behind).
   - `audit`: `bun scripts/audit.ts`, the production advisory audit CI runs,
     with the same dated ignore list (`scripts/audit-ignore.txt`). It blocks.
   - `ci`: prints CI's result for HEAD (static, test, mutants) from
     `gh api …/commits/<sha>/check-runs`. It never blocks: CI usually is
     still running at this point, and local `check` ran the same suites.
   - `secrets`: the production Worker holds every secret in
     `apps/api/src/requiredSecrets.ts` (`PASSWORD_PEPPER`, `LOG_TAG_KEY`,
     `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). It reads `wrangler secret
     list`, which shows names only, and prints the `wrangler secret put` lines
     to run.
   - `bookmark`: records the remote Time Travel bookmark.
   - `versions`: records each Worker's running version (`wrangler
     deployments status`).
   - `print-keys`: the local and remote catalogs agree on every card's
     `print_key`, because the engine's `PROGRAM_ALIAS` table is generated from
     the local one.
3. `build`: the web bundle, before anything remote changes. `build:lua` needs
   `BALATRO_SOURCE`. Vite writes `dist/build-info.json` (commit, dirty tree,
   origins, strict `/love/` versions) and puts the commit in the page as
   `<meta name="build">`.
4. `db:migrate:remote`.
5. `api:deploy`.
6. `release:health`.
7. `deploy:web`.
8. `release:finish`.

When any step fails, `release-gate.ts abort` drops the pin and the release
exits 1.

The API `deploy` script is `release-gate.ts migrations clean-tree ci --
wrangler deploy --minify`. It fails unless every file in `drizzle/` is applied
remotely, so a bare `api:deploy` cannot ship a Worker ahead of its migrations
(the D203 incident above). Then it re-checks the tree, prints CI's line, and
runs `wrangler deploy --minify --tag <short sha> --message <commit subject>`.

`deploy:web` is `release-gate.ts clean-tree web-dist ci -- wrangler deploy`,
then `web-health`. `web-dist` refuses a `dist/` that is not a clean build of
HEAD, a lenient Lua build, origins other than `.env.production`'s, and a site
origin that is not the API's `APP_ORIGIN`. A bare `deploy:web` after new
commits therefore says to rebuild with `bun run deploy`, which is `build` then
`deploy:web`.

The tree is checked again right before each `wrangler deploy`, because other
agents share the checkout and wrangler ships what is on disk at that moment.
While a release holds the pin, that check also requires HEAD to be the pinned
commit, so a commit pushed mid-release is never deployed by it.

`release:health` (`release-gate.ts health`) checks the deployed API in three
stages, each tried up to six times, five seconds apart:

1. `GET /health` names the version tagged with the released commit
   (`version.tag`, from the `CF_VERSION_METADATA` binding).
2. `GET /health/db` reads D1 and counts as many migrations as `drizzle/` has
   files.
3. `GET /sets` answers 200 and `GET /auth/me` answers 401, both as JSON.

It reads the origin from `.env.production`. `API_ORIGIN=http://localhost:8787`
points it at a local `wrangler dev`, and `HEALTH_TAG=<tag>` (`*` for any)
replaces the tag it waits for, for example after a rollback.

`web-health`, the last step of `deploy:web`, fetches the site and needs two
things. The page's `<meta name="build">` must be the released commit. Every
`/assets/` and `/love/` file the page references must answer 200, and a script
or style that comes back as `text/html` counts as missing, because the SPA
fallback serves `index.html` for a missing file.

`release:finish` does four things:

1. Appends a line to `tmp/releases.log`: the time, the tag, the commit, each
   Worker's version before and after, the bookmark, and the balatro-source
   commit from `dist/love/asset-manifest.json`.
2. Prints the release notes, which are the commit subjects since the previous
   `release-*` tag.
3. Tags HEAD `release-YYYYMMDD-HHMM` (UTC, annotated with the log line) and
   pushes the tag.
4. Drops the pin.

All the gates only read production.

**Which commit is live.** `curl -s
https://colorless-api.jofrescari.workers.dev/health` gives `version.tag` (the
API's commit). The page source's `<meta name="build">` gives the web's commit.
`bunx wrangler deployments list` shows each version's tag and message. `git tag
--list 'release-*'` and `tmp/releases.log` hold the release history.

**Cloudflare tokens (build audit DEP3, BLD-P5).** Two account-owned tokens, each
restricted to this account. `colorless-agents-read` is the ambient
`CLOUDFLARE_API_TOKEN`: Workers Scripts, D1, Workers KV, R2, Account Settings,
Account Analytics, Workers Observability and Workers Tail, all Read. It runs every
listing, `d1 execute` SELECT, `d1 migrations list`, `time-travel info` and every
release-gate step except the deploy. `colorless-deploy` adds Write on Workers
Scripts, D1, Workers KV and R2. It lives in
`~/.local/state/secrets/CLOUDFLARE_DEPLOY_TOKEN`, decrypted from the dotfiles'
`secrets/CLOUDFLARE_DEPLOY_TOKEN.age`, or the file `CLOUDFLARE_DEPLOY_TOKEN_FILE`
names. Only the production writes load it: release-gate.ts's
`-- wrangler deploy` (both Workers), `db:migrate:remote`, and anything run by hand
through `bun apps/api/scripts/with-deploy-token.ts <command>`. That covers
`bunx wrangler rollback`, `wrangler secret put`, `d1 time-travel restore`,
`ingest.ts --remote`, and a writing `d1 execute --remote`. Run any of those
commands below through it. A missing file stops the write with the path.
The split stops a mistaken write, not a deliberate one: any process running as
this user can read the file.

**A dead pin.** A release killed before `abort` ran (a closed terminal) leaves
`tmp/release.json` for 15 minutes. Releasing the same commit again takes it
over. To release another commit sooner, run `bun
apps/api/scripts/release-gate.ts unlock`, but only when no release is running.

**Before releasing, run `bun run e2e`** (`scripts/e2e.ts`; needs `CHROMIUM`, or
chromium on PATH, and `BALATRO_SOURCE`; about 70 s). It is the one check of the
real love.js page against a real local API and LobbyDO: boot, a sandbox game, a
crash and its reload, the builder's last save as the page is hidden, navigated
away and closed (a keepalive PATCH), a stalled boot, and an online match through
a rematch whose guest socket goes silent mid-match and is replaced by the
watchdog. It is opt-in, not a `release` step (CI cannot build game.data either),
because it needs a browser and takes a minute; it touches nothing remote and
nothing in the dev D1. `--gpu` adds the CRT shader parity check. **`bun run e2e
--firefox`** (needs `FIREFOX`, or firefox on PATH; about 80 s) runs the same
steps in Firefox over WebDriver BiDi, on its own Xvfb with Mesa's software GL
(fetched from nixpkgs when missing), since headless Firefox makes no WebGL
context. Run it when a change touches page lifecycle, fetch or WebSocket code;
the 2026-10-28 run passed on Firefox 157 (`tmp/rel/qa2/`).

**When a release step fails.** Every step is safe to repeat, so `bun run
release` again is always a valid recovery once the cause is fixed; it records a
new bookmark each time, and a restore wants the first one of the release (the
earliest line for it in `tmp/d1-bookmarks.log`). From `apps/api` unless noted:

| Failed step | What production is running | Recovery |
| --- | --- | --- |
| `check`, `release:gate`, `build` | Nothing changed. | Fix what it printed and release again. |
| `db:migrate:remote` | The files before the failing one are applied; the failing one rolled back (one transaction per file). The old Worker reads the expanded schema fine. | A transient error: release again. A SQL error: fix the file (it is not applied remotely), commit, push, release again. |
| `api:deploy` | New schema, old Worker. | Release again, or `bun run api:deploy`, then `bun run release:health`, then `bun run deploy:web` from the repo root (`web-dist` refuses a `dist/` built at another commit: then `bun run deploy`). |
| `release:health` | New Worker, which cannot read D1, sees another migration count or fails a route; or the new version never answered `/health`. | The tag never matched: `bunx wrangler deployments list` shows whether the deploy took; rerun `bun run release:health` once it has. A D1 error: `evt = "d1", kind = "health_failed"` in Workers Logs (§3.7.4) carries the error and cause names and `quota`. `quota: true` is a spent daily quota (wait for 00:00 UTC); otherwise it is a binding or schema problem (`bunx wrangler d1 migrations list colorless --remote`): fix it, rerun `bun run release:health`. Bad code (a failed `/sets` or `/auth/me` probe, or D1 errors from the code): `bunx wrangler rollback <version id> -m "<why>"` to the version before the release (the `versions` line it printed), and check `HEALTH_TAG='*' bun run release:health` again. The schema stays: the old Worker reads it (expand, then contract). |
| `deploy:web` (`web-dist`, the deploy, `web-health`) | New API, and the old web app, or a new one `web-health` found broken. The old web app is fine when the API change kept the old client working, as an API-first release should. | `bun run deploy` from the repo root, then `bun run --cwd apps/api release:finish` if the pin is still there (`abort` dropped it otherwise, and the release goes untagged; tag it by hand as below). A bad web build: `bunx wrangler deployments list` and `bunx wrangler rollback <version id>` from the repo root (Worker `colorless`). |
| `release:finish` | Both new. Only the record is missing: the log line, the tag, or its push. | It prints the `git tag -a … && git push origin refs/tags/…` to run. A missing log line can be rebuilt from `bunx wrangler deployments list` (both Workers) and `tmp/d1-bookmarks.log`. |

Never revert or edit a migration file that is applied remotely: undo it with a
new migration. A rollback of the API across a change of
`MATCH_RECORD_VERSION` (the engine's game-state version) retires the matches
the newer Worker stored, so players in a match at that moment lose it.

A Durable Object migration (a `migrations` entry in apps/api/wrangler.jsonc that
adds, renames or deletes a class) blocks `wrangler rollback` to any API version
before it: Cloudflare refuses a rollback across a DO class change. Ship such a
migration in a release with no other API change, so the version before it is
not one a rollback would need (build audit DEP2).

**Secrets before the first Phase 5 release (security audit 2026-10-27).** Generate
`PASSWORD_PEPPER` and `LOG_TAG_KEY` (`openssl rand -base64 32` each), save both in
the password manager, then from `apps/api/` run `bunx wrangler secret put
PASSWORD_PEPPER` and `bunx wrangler secret put LOG_TAG_KEY`, and only then `bun
run release`. A secret put applies to the running Worker at once and the old code
ignores both, so the order is safe; the gate refuses the release until both exist.
Nobody is logged out: existing hashes are re-peppered at each account's next
sign-in. Google sign-ins in flight at the deploy fail once (PKCE changed the state
cookie). `check:static` adds `migration-guard.ts` (no unreviewed table rebuild,
drop or rename) and `drizzle-drift.ts` (schema.ts matches the migrations); see
docs/conventions.md "Database migrations".

The daily sweep's Cron Trigger and the lobby's rate-limit bindings live in
`apps/api/wrangler.jsonc` and take effect with `api:deploy`; there is no
separate step. A rate-limit binding's `namespace_id` must be unique within the
Cloudflare account.

`bun run db:check` (apps/api; `--remote` for production) runs the read-only
consistency checks in `apps/api/src/db/consistency.ts`: SQLite integrity and
foreign keys, ownership the routes enforce, value domains, the reprint
post-pass, and whether stored `print_key`s still match today's `printKey`
(a mismatch means a full re-ingest is owed). `--upstream` (needs network, run
through `scripts/with-system-certs.ts`) also lists cards tcgdex no longer has;
those are only reported. Run it after every remote ingest.

#### 3.7.3 Backup and recovery

What can be lost, and how it comes back:

| Store | Recovery |
| --- | --- |
| D1 user tables (`users`, `sessions`, `oauth_identities`, `folders`, `decks`, `deck_cards`) | Time Travel, or an export taken before a risky change. Nothing else can recreate them. |
| D1 `auth_rate_limits` | Disposable: at worst a caller gets a fresh sign-in budget. |
| D1 catalog (`series`, `sets`, `cards`) | Re-run the ingest (§3.4.1); Time Travel only when user rows reference cards an ingest removed. |
| KV `CACHE` | Disposable: stamp a new `catalog:epoch`. |
| R2 `ASSETS` | Disposable: refilled from tcgdex on demand. |
| LobbyDO storage | Ephemeral by design; matches in progress are lost. |

**Time Travel** is always on: the database can be restored to any minute in
the last 7 days on the Free plan (30 on paid). `release` and
`ingest.ts --remote` record the bookmark taken just before they write, with
the reason, in `tmp/d1-bookmarks.log` (gitignored) and print the restore
command. A restore rewinds the WHOLE database, catalog and user data
together, so every deck edit, registration and login after that point is lost.
Prefer a targeted repair (re-ingest the catalog, or re-import rows from an
export) when the damage is confined to one side.

```sh
cd apps/api
bunx wrangler d1 time-travel info colorless                       # current bookmark
bunx wrangler d1 time-travel restore colorless --bookmark=<bookmark>
bunx wrangler d1 time-travel restore colorless --timestamp=2026-10-27T09:00:00Z
# After any restore, in this order:
bun scripts/release-gate.ts migrations    # "not applied remotely" = the restore rewound a migration
bun run db:check -- --remote
bunx wrangler kv key put catalog:epoch $(date +%s) --binding CACHE --remote
HEALTH_TAG='*' bun run release:health    # any version: the live one may not be HEAD's
```

**A restore that crosses a release.** Time Travel rewinds `d1_migrations` with
everything else, and the `release` bookmark is taken before
`db:migrate:remote`, so restoring to it puts the database back at the previous
migration level while the new Worker still reads the new columns: those
endpoints 500 (the D203 class), and `db:check` does not notice, since it never
reads `d1_migrations`. When `release-gate.ts migrations` lists a file as not
applied remotely:

1. Roll the API back to the version deployed before the release: `bunx
   wrangler deployments list`, then `bunx wrangler rollback <version id> -m
   "D1 restored to <bookmark>"`. Then `curl -fsS
   https://colorless-api.jofrescari.workers.dev/health/db` should count the
   files minus the ones listed (`release:health` compares with all of
   `drizzle/`, so it fails until step 3). Roll the web app back too (`bunx
   wrangler rollback` from the repo root) if it needs the new API.
2. Do not follow the gate's hint to run `db:migrate:remote` yet: it re-applies
   the migration that did the damage. Fix that migration or remove it in a
   new commit; it is no longer applied remotely, so editing it is allowed here.
   A local database that applied the old version needs a fresh state
   (`rm -rf .wrangler/state`, `bun run db:migrate:local`, re-ingest).
3. Release again.

**Before a migration that rebuilds or rewrites a user table**, export the whole
database. The file holds emails and password hashes, so keep it in `tmp/`
(gitignored) and delete it once it is no longer needed. It also holds the
catalog and the `d1_migrations` rows, which say how far the export was
migrated. About 6 MB today, a few seconds; the database answers no other query
while an export runs.

```sh
cd apps/api
mkdir -p ../../tmp/backup
bunx wrangler d1 export colorless --remote --no-schema \
  --output ../../tmp/backup/colorless-$(date +%F-%H%M).sql
```

Always export with `--no-schema` and import into a database the migrations
built: a schema export writes `CREATE TABLE cards` before `sets` and does not
re-import as written.

**Rebuilding from an export** into an empty database that `db:migrate:remote`
has migrated to the current `drizzle/` (a new database, or one whose rows are
gone). The export is one `INSERT` per line, so its rows can be picked by table.
A file that `wrangler d1 execute --file` imports is one transaction, its
foreign keys checked at the end because of the PRAGMA, so a chunk may reference
only rows in itself or in an earlier chunk: the catalog before the decks that
use its cards, and users, folders and decks together (a user's favourite deck
points back at the user, a folder at its parent folder). A single 5 MB file
fails with `D1_RESET_DO`, so chunks stay under about 700 KB:

```sh
cd apps/api
F=../../tmp/backup/colorless-2026-10-28-0900.sql      # the export
D=../../tmp/restore && rm -rf $D && mkdir -p $D
# 1. Every table in the export, with its row count.
grep -o '^INSERT INTO "[a-z0-9_]*"' $F | sort | uniq -c
# 2. Chunks, parent first. d1_migrations and sqlite_sequence stay out (importing them into
#    a migrated database fails on UNIQUE d1_migrations.id); auth_rate_limits is disposable.
rows() { for t in "$@"; do grep "^INSERT INTO \"$t\" " $F; done; }
rows series sets > $D/01-catalog.sql
rows cards | split -C 600K -d -a 3 --additional-suffix=.sql - $D/02-cards-
rows users folders decks > $D/03-owners.sql
rows deck_cards | split -C 600K -d -a 3 --additional-suffix=.sql - $D/04-deck-cards-
rows sessions oauth_identities > $D/05-sign-in.sql
sed -i '1i PRAGMA defer_foreign_keys=TRUE;' $D/*.sql
ls -l $D    # each file under ~700 KB; a table step 1 lists but no chunk holds needs a chunk
# 3. Import in name order. A failed file imported nothing: fix the cause and rerun the loop,
#    which resumes at that file.
for f in $D/*.sql; do bunx wrangler d1 execute colorless --remote --yes --file $f && mv $f $f.done || break; done
# 4. Backfills. A migration newer than the export never ran its data statements on these
#    rows. List the export's migrations and compare with drizzle/:
grep '^INSERT INTO "d1_migrations"' $F | grep -o "'[0-9]\{4\}_[a-z0-9_]*\.sql'"
ls drizzle/*.sql
#    For each newer file that has UPDATE, INSERT or DELETE lines (0003 and 0012 today),
#    run them, which start at the first such line (docs/conventions.md "Database migrations"):
sed -n '/^\(UPDATE\|INSERT\|DELETE\)/,$p' drizzle/0012_users_name_prompt.sql > $D/backfill-0012.sql
bunx wrangler d1 execute colorless --remote --yes --file $D/backfill-0012.sql
# 5. Check, compare the row counts it prints with step 1, and retire the cached catalog.
bun run db:check -- --remote
bunx wrangler kv key put catalog:epoch $(date +%s) --binding CACHE --remote
```

A target that still holds its catalog (only user rows are gone) takes the user
chunks alone: `rm $D/01-* $D/02-*` before step 3. An older export of the user
tables alone (no catalog chunks) needs the catalog first: run the ingest
(§3.4.1) for every serie production holds before step 3. Either way, a
deck_cards chunk that then fails its foreign keys uses a card the catalog no
longer has.

**Repairing rows in the live database**, when some rows were lost and the rest
are current: build the chunks the same way, keep only those of the damaged
tables, and make them skip rows that still exist before step 3:

```sh
sed -i 's/^INSERT INTO /INSERT OR IGNORE INTO /' $D/*.sql
```

A plain `INSERT` aborts the whole chunk on the first row that still exists.
`OR IGNORE` puts back only the missing rows and keeps every live one. Never
use `INSERT OR REPLACE` on `users`, `folders` or `decks`: REPLACE deletes the
live row first, and its `ON DELETE CASCADE` deletes the sessions, decks and
deck cards that hang off it, including those created after the export (both
proven in the 2026-10-28 drill). `OR IGNORE` does not overwrite a damaged
value in a row that still exists: for that, import the export into a local copy
(below) and write `UPDATE`s from it, or use Time Travel. A backfill from step 4
must then run only over the restored rows; for 0012, add `AND id IN (...)` with
their user ids.

**Rehearsing locally.** Every command above also runs against a local copy:
`wrangler d1 execute` and `migrations apply` take `--local --persist-to <dir>`
in place of `--remote`, `bun run db:check -- --persist-to <dir>` checks that
copy, and `wrangler d1 export` (which has no `--persist-to`) takes `--local -c
<config>` with a config whose `.wrangler/state` is that dir (the config's
`database_id` must match `apps/api/wrangler.jsonc`, which names the file). The
2026-10-28 drill ran the rebuild and the repair this way, from an export taken
at migration 0011 with synthetic users, about 12,700 user rows and the full
catalog: export about 2 s, 14 chunks imported in 86 s, and the result matched the
source migrated in place, table for table, `name_prompt` included
(docs/decisions.md, "Data ops and the release pipeline").

**Changing `database_id`** in wrangler.jsonc orphans the local Miniflare file
under `.wrangler/state/v3/d1/`. Run `bun run db:migrate:local` to create the
new file, then copy the old one into it with sqlite's `.backup`.

**Web Worker rollback rehearsal** (run 2026-11-10 at the user's request, build
audit DEP2). Production's web Worker went back one version and forward again
with `bun apps/api/scripts/with-deploy-token.ts bunx wrangler rollback <version
id> -m "…" -y`. The ambient token was the read-only one, so only the deploy
token wrote. The step back was from `b0ed6d08` (0a8feadf, with the 404 script) to
`b95dba73` (0a2c8644, static assets only). Each step served the target build's
`<meta name="build">` within 30 s, the whole drill took 59 s, and `web-health`
passed after the step forward. While the old version served, a missing chunk
was again `200 text/html`: the 404 script ships with a version, so rolling back
past it brings that behaviour back. The API Worker's rollback is still not
rehearsed. It is the same command from `apps/api/`, but it also changes the
code that reads D1 and holds live matches.

**Remote Time Travel rehearsal** (run 2026-10-28 with the user's OK: every
expectation below held, and `colorless-drill` was deleted afterwards; it needs
`CI=true` so `d1 create` does not prompt). It proves the remote restore path,
including that a restore rewinds `d1_migrations`, on a throwaway database that
nothing else uses. From the repo root, about ten minutes:

```sh
mkdir -p tmp/drill/migrations && cd tmp/drill
printf '{ "name": "colorless-drill", "compatibility_date": "2026-06-01" }\n' > wrangler.jsonc
bunx wrangler d1 create colorless-drill --binding DB --update-config    # adds it to tmp/drill/wrangler.jsonc only
printf 'CREATE TABLE drill (id integer PRIMARY KEY, note text NOT NULL);\n' > migrations/0000_drill.sql
bunx wrangler d1 migrations apply colorless-drill --remote
bunx wrangler d1 execute colorless-drill --remote --command "INSERT INTO drill (note) VALUES ('kept')"
bunx wrangler d1 time-travel info colorless-drill                         # note the bookmark: B
printf "ALTER TABLE drill ADD extra text;\nUPDATE drill SET note = 'damaged';\n" > migrations/0001_damage.sql
bunx wrangler d1 migrations apply colorless-drill --remote
bunx wrangler d1 execute colorless-drill --remote --command "INSERT INTO drill (note) VALUES ('lost')"
bunx wrangler d1 time-travel restore colorless-drill --bookmark=<B>
bunx wrangler d1 execute colorless-drill --remote --command "SELECT * FROM drill; SELECT name FROM d1_migrations"
#   expect: one row (1, 'kept') with no `extra` column, and only 0000_drill.sql
bunx wrangler d1 migrations list colorless-drill --remote                 # expect 0001_damage.sql unapplied
bunx wrangler d1 delete colorless-drill
cd ../.. && rm -rf tmp/drill
```

Record the restore's duration and anything that differed here.

#### 3.7.4 Monitoring

The account is on the Workers Free plan. These limits are per day, account-wide,
and reset at 00:00 UTC; past one, the binding fails until then:

| Resource | Free limit / day | Main spenders |
| --- | ---: | --- |
| D1 rows read | 5,000,000 | free-text searches (about 5,100 rows each), deep /cards pages, decklist import, catalog KV misses (a /cards miss runs its page and a `count(*)`, each about 5k rows unless the filter is `set`, `id` or `nameExact`; pages 1-3 of one new filter cost 15-30k) |
| D1 rows written | 100,000 | remote ingest, deck saves, sessions, sign-in counters (two per allowed attempt, one more per failed login below the per-email cap), the daily sweep (at most 20,000) |
| KV reads | 100,000 | every KV-cached catalog request |
| KV writes | 1,000 | catalog KV misses (only /facets, /series, /sets, /sets/:id and /cards pages 1-3 at page size 4, 8 or 50; never an empty result) |
| Worker requests | 100,000 | every API request, including WebSocket upgrades and the asset mirror; nothing limits traffic before the Worker on workers.dev |
| Durable Object requests | 100,000 | lobby creation, each WebSocket upgrade and each incoming frame |
| Durable Object rows written | 100,000 | lobby snapshot and match writes (one per accepted change, a socket's frames capped at 40 then 5 a second), each liveness `setAlarm` (one per 30 s while a lobby has sockets, for at most an hour without play), and about 5 per lobby created and wiped |
| Workers Logs events | 200,000 | one per Worker and Durable Object invocation, plus one per log line. Past it only the logs stop (the API keeps serving); kept 3 days. Workers Logs moves to Cloudflare Observability pricing on 2026-12-01: recheck this figure then |

D1 rows read run out first: about 200-330 new catalog filters missing KV
spend the day's 5M (the peak day to 2026-11-09 read 2.4M, mostly builder
pages and their counts). The builder no longer spends them once its card
index has loaded: from then on it slices every page from the index in the
browser (API audit CAT1). The KV write quota is the other tight one, and only
the catalog cache spends it. Sign-in no longer touches KV. The Workers Rate Limiting bindings are free and
store nothing; they bound bursts, not a day:

| Binding | Limit | Key | On a binding error |
| --- | --- | --- | --- |
| `LOBBY_CREATE_LIMIT` | 10 / 60 s | IP | open |
| `LOBBY_SOCKET_LIMIT` | 60 / 60 s | IP | open |
| `AUTH_LIMIT` | 10 / 60 s | scope (register, login, delete) + IP | open; the D1 sign-in limiter behind it fails closed |
| `DECK_WRITE_LIMIT` | 60 / 60 s | account | open |
| `DECK_WRITE_IP_LIMIT` | 180 / 60 s | IP | open |
| `CATALOG_SEARCH_LIMIT` | 30 / 60 s | IP | open |

IP keys count an IPv6 address as its /64. Deck writes are POST, PATCH and
DELETE `/decks`; the builder saves at most once a second (600 ms debounce, one
save in flight, save starts at least 1 s apart), and the client backs off on a
429. An account at its limit
swapping 200-entry lists still writes about 36,000 D1 rows a minute, so the
deck bindings do not protect the daily write quota from a determined account
(security audit DK1, decision 4: bindings now, a denormalized list later).

**Known availability risk (security audit AE2, accepted).** Workers Free allows
100,000 requests a day across the account, and every API request counts,
including the ones a limiter refuses: all the limits above run inside the
Worker, and workers.dev has nothing in front of it. A loop of about 1.2
requests a second for a day, or a short burst from a few hosts, spends the
quota, and the API answers Cloudflare error 1027 until 00:00 UTC (the static web
Worker keeps serving). If that abuse is seen, move the web app **and** the API
to one custom domain on a Cloudflare zone (`workers_dev: false`) and add the
Free WAF rate-limiting rule on `/auth/*`, `/decks*` and `/lobby*`, rather than
upgrading to Workers Paid. Both must stay on one registrable domain: the session
cookie is `SameSite=Lax`, so an API on another site would lose it. The move
changes `VITE_API_ORIGIN`, the CSP, `APP_ORIGIN` and the Google redirect URI,
and logs everyone out once.

D1 rows read is the other one anonymous traffic can spend: about 1,000
free-text searches, or about 500-1,000 cacheable `/cards` pages that miss KV
(5-10k rows each, mostly the count), use the day's 5M, and then sign-in, decks
and the lobby fail until 00:00 UTC. `GET /cards` therefore refuses a page that
skips more than 1,000 cards (`MAX_CARDS_OFFSET`) and a filter value over 100
characters (300 for `name`, `nameExact` and `text`), and `CATALOG_SEARCH_LIMIT`
(namespace 1003) allows 30 catalog reads a minute per IP that reach D1 (an IPv6
address counts as its /64). It runs after the KV cache, so a hit never spends
it and every miss does: a cacheable page that misses, a query that bypasses KV,
a key too long for KV, and each repeat once the day's KV writes are spent. An
`id` or `nameExact` query is an index lookup and is never limited. `/facets`
and `/cards/index` spend the same budget on a miss; `/sets`, `/sets/:id`,
`/series`, `/cards/:id` and `/cards/full` read a few hundred rows at most and
are not limited. Until its card index has loaded, the builder asks `/cards`
only for the pages KV caches (pages 1-3 at its page sizes, three requests per
settled filter change) and serves every other page, free text and HP bounds
included, from `GET /cards/index` in the browser (one KV entry per catalog
epoch); once it has loaded, every page comes from it. A builder therefore
spends at most a few misses a minute, and a 429 there shows the search's "Try
again" message. The limit slows a careless loop but not a determined one (one
address can still read about 150k rows a minute).

**After every deploy**, check that the new version answers, that it reaches D1 and that the remote
migration count matches the files; `release` runs this as `release:health`:

```sh
cd apps/api && bun run release:health    # HEALTH_TAG='*' when the live version is not HEAD's
# The same by hand:
curl -fsS https://colorless-api.jofrescari.workers.dev/health
# {..., "version":{"id":"<version id>","tag":"<short sha>"}}: the live API's commit.
curl -fsS https://colorless-api.jofrescari.workers.dev/health/db
# {"ok":true,"migrations":13}, where 13 = `ls apps/api/drizzle/*.sql | wc -l`.
# 503 {"ok":false}: a D1 error (binding, schema, quota); the reason is not in
# the body, look for `evt = "d1", kind = "health_failed"` in Workers Logs and
# in `wrangler tail`: `quota: true` means the day's D1 quota is spent.
```

`GET /health` never touches D1, so it stays green through all of these.

**Which statements read the most rows** (remote only, experimental; also
`--sort-by writes|time|count`, `--sort-type avg`, `--json`):

```sh
cd apps/api
bunx wrangler d1 insights colorless --time-period 1d --sort-by reads --limit 10
```

**Daily usage against the limits** is in the Cloudflare dashboard: the D1
database `colorless` → Metrics (rows read and rows written per day), and the KV
namespace `colorless-cache` → Metrics (reads and writes per day). Compare them
with the table above. Worker requests are under Workers & Pages → `colorless-api`
→ Metrics, and the Durable Object figures under Workers & Pages → Durable Objects
→ `LobbyDO` → Metrics (requests and rows written per day); Account Home →
Workers & Pages → Usage shows the account-wide totals.

**Workers Logs** (`colorless-api` → Observability; `observability.enabled` in
`apps/api/wrangler.jsonc`) keeps two kinds of event for 3 days. The app's own
lines (`$metadata.type = "cf-worker"`) come from `apps/api/src/http/log.ts`:
JSON with an `evt` field, and repeating failures are throttled to one line per
10 minutes per isolate (per `evt` and `kind`, so one route's line can hide
another's), carrying a `suppressed` count. Cloudflare adds one invocation event
per request, cron run and Durable Object call (`$metadata.type =
"cf-worker-event"`), with its outcome, status, CPU time, URL and request
headers; a console line shares `$workers.requestId` with its invocation. Levels:
info for what went as intended (sign-ins and the other account successes, the
sweep's counts, a lobby forfeit or wipe), warn for a refusal or a degradation
the code handled, error for a failure nothing handled. Filter on level `warn` or
`error` to see only trouble. Info lines (`console.log`) arrive with no level, so
a level filter neither selects nor excludes them, and invocation events are
level info, so a query for the app's info lines also needs `$metadata.type =
"cf-worker"`. The log queries below filter on `evt` and see every level. A
failure line's error fields come from `errorFields`
(`apps/api/src/http/errors.ts`): `error` and `cause` names, `query` (the SQL
without its parameters) and `quota: true` when the error reads as a spent daily
quota, never a message or a bound value. The lobby's `error` field is the
exception: `describeError` gives `name: message` up to 200 characters (for a
failed query only the error and cause names), and those messages come from the
engine and the runtime.

**What the logs hold about a player.** The app's lines carry no email, IP,
password, session token or player-typed string: an account or an address is
the keyed tag from `apps/api/src/http/logTag.ts`. `scripts/log-guard.ts`
(`check:static`) fails on a `console` call outside log.ts, on a log field on its
deny-list (any key containing `email`, `password`, `token`, `cookie` or
`secret`, and `ip`, `name`, `displayName`, `deckName`, `deckId`, `userId`,
`accountId`, `session` and `sessionId`), and on an `evt` and `kind` this section
does not name. Cloudflare's invocation event is another matter: its request
headers include the client IP (`cf-connecting-ip`), and `request.cf` the city,
postal code, coordinates, ASN and TLS fingerprint, next to the full URL with its
query string. It is kept 3 days and readable by
the account and its read tokens, and an `account` tag can be joined to it
through `$workers.requestId`. That was accepted (observability audit LOG1,
decision 1a).

**Workers Issues** (`colorless-api` → Observability → Issues) groups errors
into issues with an occurrence count; by Cloudflare's description it records an
uncaught exception, a failed invocation, a 5xx response or a logged error. It is
off until `observability.issues.enabled` is set in `apps/api/wrangler.jsonc`
(observability audit ERR1, decision 2a), since a dashboard toggle is undone by
the next deploy. Which of the app's error lines it picks up is checked when it
is enabled. Once it is on, look there first.

Log queries:

| Query | What it finds |
| --- | --- |
| `evt = "kv"` | Catalog cache `get_failed`, `put_failed` and `epoch_failed`, with the route and the error fields: `quota: true` means the day's KV quota is spent. |
| `evt = "auth"` | The account audit trail (`apps/api/src/auth/routes.ts`, §3.5): `registered`, `login_ok`, `login_failed` (`reason`; `capped: true` past the per-email cap), `logout`, `logout_all` (`sessions` ended), `profile_updated`, `delete_failed`, `account_deleted`, `oauth_created`, `oauth_linked` (`claimed`, `identitiesRemoved`, `sessionsRevoked`), `oauth_refused` and the other OAuth failures: `oauth_denied` (the provider's `?error=` for this browser's sign-in, its code in `providerError`; `access_denied` is a Cancel), `oauth_state` (`reason`: `no_cookie`, `no_state`, `mismatch` or `no_code`), `oauth_exchange` and `oauth_profile` (the provider's `status` and `providerError`). The successes are info level, the rest warn. `account` is the keyed tag of the user id (`apps/api/src/http/logTag.ts`, secret `LOG_TAG_KEY`; `untagged` without it): filter on one tag to follow an account across addresses. `rate_limited` (with `by: "binding"` when `AUTH_LIMIT` refused it) carries `net`, the same kind of tag for the address; `limiter_error` from the D1 limiter and `binding_error` from the binding. `expired_session_delete_failed` (throttled, with the error fields): an expired session presented to a route could not be deleted; the 401 stands and the daily sweep gets the row. Error level: `logout_failed` (the session row could not be deleted; the cookie is cleared anyway), `oauth_unavailable` (D1 failed while the callback found the account or recorded the session; the browser is sent back with `unavailable`), both with the error fields, `pepper_missing` (no `PASSWORD_PEPPER`; set it) and `pepper_unavailable` (a stored hash needs a pepper the Worker lacks: restore the secret or `PASSWORD_PEPPER_PREVIOUS`). No line carries an email, IP or user id. |
| `evt = "decks"` | `rate_limited` and `binding_error` from the deck write limits (`apps/api/src/decks/routes.ts`). |
| `evt = "lobby"` | Lobby Durable Object events (`apps/api/src/lobby/`, kinds below), and `rate_limited` / `limiter_error` from the per-IP limits on its routes. |
| `evt = "http"` | `unhandled`: a request that threw (a 500), with the method, route pattern and the error fields. Logged at error level. `invalid_request` (throttled): a validator 400, with the route pattern, `target` (`body` or `query`), the `issues` count and the first five issue `paths` (`cards.3.cardId`), never the values or messages; a run of them after a release means the client sends what the server rejects. `cross_site_refused` (throttled): an unsafe request from another site (§3.5), with the method and route pattern. |
| `evt = "d1"` | `health_failed`: a `/health/db` failure, with the error fields (`quota: true` is a spent quota, otherwise a binding or schema problem). The daily sweep: one info-level `sweep` line with the rows deleted, or an error-level `sweep_failed` with the error name (the run also shows as failed under the Worker's Cron Events). `catalog_reads` (info level): each isolate's tally of `/cards` queries that missed KV (cacheable misses and bypasses alike), at most one line a minute: `queries`, `rows_read`, and the heaviest query's `max_rows_read` and `max_params` (param names, never values). |
| `evt = "catalog"` | `rate_limited` / `limiter_error` from `CATALOG_SEARCH_LIMIT` on `/cards`, `/cards/index` or `/facets` (the `route` field). |
| `evt = "assets"` | `origin_refused` with a `reason` (`origin_url`, `redirect`, `content_type`, `magic`, `too_large`): the asset mirror would not store what the origin sent. `origin_status` with the `status`: the origin answered something other than 200, 404, 410 or a 5xx (a 429, 403 or 408), served as an uncached 502. `r2_get_failed` with the `error` name: an R2 read threw and the image came from the origin. |
| `evt = "after_response"` | `failed`: other deferred work that failed after its response, such as an R2 asset mirror write, with the route and the error fields. |
| `$workers.outcome = "exception"` | An invocation that threw past every handler: the daily cron (also under Cron Events) or a Durable Object call, such as a lobby frame whose storage write failed. It names no `evt` or lobby code; open the invocation for the exception, whose stack the uploaded source map resolves (no such event has been seen in production yet). An HTTP route that throws is answered by `onError` with a 500 and an `http` `unhandled` line, so its outcome stays `ok`. |

Every `evt = "lobby"` line carries the lobby's `code` as `lobby`. None carries
an account id, a session id, an email, a seat secret, a deck id or a name:
`signedIn` and `seated` say only whether there was one. The refusals and
closes a client can repeat are throttled (marked *t*); the throttle is per
`kind` (per `kind` and action `type` for `action_threw`, per `kind` and frame
for `frame_failed`), so one cause can hide another's line for 10 minutes,
counted in `suppressed`. `match_started`, `match_ended`, `forfeit` and
`lobby_wiped` are info level. A code defect is error level: `frame_failed`,
`action_threw`, `alarm_failed`, and `handoff_failed` when starting the match
threw. The rest are warn. The security audit trail (LB8) is
the first six:

| `kind` | Fields | When |
| --- | --- | --- |
| `hello_refused` *t* | `cause`, `signedIn`, `spectating` | A hello claimed no seat. `cause`: `credential` (the `from` is no seat secret, as from a client older than LB6), `full` (both seats are held by others), `bound` (the seat is bound to an account this socket is not signed in as). A `full` that only makes the socket a spectator of a running match is how watching works, and is not logged. |
| `seat_evicted` | `sockets` | An account bound a seat, closing (1008) the sockets on it that were not the account's (LBX1). |
| `socket_closed` *t* | `cause`, `code`, `frames`, `chars`, `seated`, `ageMs` | A socket closed for its frames (LB1): `frame_rate` (1008, its budget ran out) or `frame_size` (1009, a frame over 16K characters). `frames` counts the frames it sent since the instance woke, the closing one included; `chars` is the closing frame's size; `ageMs` the time since its upgrade. One line per socket, never one per frame. |
| `overflow_closed` *t* | `cause`, `code`, `sockets` | Sockets past the cap closed with 1013 (LB2): `turned_away` (one sent a frame and was answered full) or `no_hello` (a sweep let go `sockets` that never said hello). |
| `ws_refused` *t* | `cause`, `error` | An upgrade refused: `lobby_full` (503, the hard socket cap) or `session_lookup` (503, D1 failed resolving the cookie). |
| `rematch_refused` | `cause`, `sockets`, `requester` | A rematch refused because a seat's session ended (`session_ended`, MI4): the `sockets` holding it were closed (1008), `requester` says whether the asker's own was one. |
| `rematch_unchecked` *t* | `cause`, `error` | The rematch's session read failed (`session_lookup`) and the rematch went ahead; the handoff's deck read re-checks each session. |
| `lobby_wiped` | `cause`, `sockets`, `ageMs`, `inGame` | The lobby was deleted: `empty` (its expiry), `inactive` (an hour without play; `sockets` were closed with 4000) or `legacy` (stored before the LB6 cutover). |
| `handoff_failed`, `handoff_deferred` | `cause`, `error` / `attempts` | A match could not start: `d1_error`, `deck_unresolved` or `match_refused` (the engine refused the decks, or starting the match threw, with `error`; the throw is error level); or the lobby kept changing under the handoff. |
| `match_started` | | The handoff began a match (one line per match; several under one lobby code are rematches). |
| `match_ended` | `cause`, `turns`, `durationMs` | A match reached its result. `cause`: the engine's reason for a win (`prizesTaken`, `noPokemon`, `deckOut`, `cardEffect`, `conceded` for the Concede button), `tie`, or a forfeit's `left` or `abandoned` (each also logs `forfeit`). `turns` is the turn it ended on, `durationMs` the time since it started. A `match_started` with no `match_ended` is a match that never finished: retired (`match_retired`), wiped with its lobby, or ended by the host's kick. Count both with `evt = "lobby" AND kind IN (match_started, match_ended)`, grouped by `cause`. |
| `forfeit` | `seat`, `cause` | A seat conceded by leaving (`left`) or by its forfeit clock (`abandoned`). |
| `action_threw` *t* | `type`, `error` | The engine threw on an action, error level; it was refused like any move (MI3). Throttled per action `type`, so a throw on another type still logs (API audit LOB7). |
| `frame_failed` *t* | `frame`, `error` | Handling a frame threw, error level: most likely a storage write refused (a spent daily DO write quota, or a value too large). `frame` is the frame's kind (`hello`, `intent`, `action`, `reject`, `bye`, `rematch`), and the throttle is per frame kind. The error is rethrown, so the invocation also ends as an exception, and the player gets no reply: the table freezes, and the client's hello retry fails the same way. `lobby` is null when reading the code failed too (ERR3). |
| `match_migrated`, `match_retired` | `from`, `to` / `cause` | A stored match was migrated to this build's version, or retired as unreadable. |
| `seat_orphaned` | `seats` | An alarm pass found `seats` shown connected that no socket holds (their sockets went in a deploy without a close the DO heard) and gave each the reconnect grace. |
| `alarm_failed` | `error` | An alarm pass threw, error level; the alarm is re-armed, no sooner than 5 s later until a pass succeeds (LOB1). |

**A player reports…** Ask for the time, to the minute, and for a match the
lobby code from the address bar (`/?lobby=CODE`). Then:

| Report | Where to look |
| --- | --- |
| Anything | Workers Issues first, once it is on; then Account Home → Workers & Pages → Usage, and the table at the top of this section, for a spent daily quota. |
| A deck didn't save | Invocations whose URL contains `/decks` with a status of 400 or more, then that invocation's `decks` or `http` line (`rate_limited`, `binding_error`, `invalid_request`, `unhandled`). |
| Sign-in fails | `evt = "auth"`, kinds `oauth_*`, `login_failed`, `rate_limited`, `limiter_error` and the error-level ones. |
| A match froze or will not start | `lobby = "<CODE>"`: `frame_failed` (a frame threw, usually a refused storage write), `handoff_failed`, `action_threw`, `alarm_failed`. Then the invocations whose URL contains `/lobby/<CODE>/ws`, and `$workers.outcome = "exception"` around the time, since an exception carries no lobby code. |
| Cards or images don't load | `evt = "kv"`, `evt = "catalog"` and `evt = "assets"`. An asset 502 from a failing origin has no line, only its invocation's status. |

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
> `DeckSummary` (the summed `cardCount`, with `cards` only on complete decks), and the
> create/patch request schemas for both resources.

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

Every response carries `X-Content-Type-Options: nosniff` and
`Cross-Origin-Resource-Policy: same-site` (the web app and the API share the
`<account>.workers.dev` site). Every error body is JSON `{error, …}`: unmatched
routes (404), Hono's own errors such as a malformed JSON body (400), and
uncaught throws (500 `internal error`, logged as `evt = "http", kind =
"unhandled"` with the method, route pattern, error and cause names, the SQL
without its parameters, and a `quota` flag; never the message, which holds a
failed query's bound values). A request body over 64 KB answers 413 `{error:
"body too large", limit}` before it is parsed; the largest real body, a
200-entry deck save, is about 8 KB. A failed validation answers 400 `{error:
"invalid body" | "invalid query", issues}` with at most 20 issues. Routes
behind a session check it before validating the body, so an anonymous caller
gets 401 without the API validating anything.

```
GET    /health
GET    /health/db        # one D1 read: {ok:true, migrations:<applied count>} or 503
                         #   {ok:false}; no-store; post-deploy check (§3.7.4)

# Catalog (public; every 200 carries `public, max-age=300, swr=3600` + ETag;
# best-effort KV cache-aside, 1-day TTL, on the 200s of /facets, /series, /sets,
# /sets/:id and /cards pages 1-3 only (MAX_CACHED_CARDS_PAGE) — each miss spends
# one of the account's 1,000 KV writes/day;
# `x-colorless-cache: hit|miss|bypass` (bypass: /cards/:id, /cards/full, /cards
# page 4+, a /cards query carrying `total` or a pageSize other than 4, 8 or 50,
# and free-text/id/hpMin/hpMax queries); an empty list or page is never stored;
# key = `catalog:<CACHE_VERSION>:<ingest epoch>:` + path (route params decoded)
# + the VALIDATED query: only schema keys, defaults dropped, repeats sorted —
# /facets, /series and /sets/:id ignore the query, so `?bust=N` cannot mint
# entries; bump the version prefix whenever a cached shape — or its values for
# already-ingested rows — changes (catalog/cacheShape.d1.test.ts pins each
# version's response schemas and card index columns, so a shape change fails
# until it is bumped); a hit or miss under a key carries a weak ETag hashed from
# the key, not the body, so a hit or 304 of the 1.9 MB card index hashes no body
# (a bypass keeps hono/etag's body digest); KV get/put/epoch failures log
# `evt = "kv"` with the error's names and `quota`; invalid query params → terse
# 400 JSON, before KV is touched)
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
                         #   default 1), pageSize (default 50, max 100); total = a
                         #   count an earlier page reported, echoed instead of
                         #   recounting; a free-text query (name/nameExact/text)
                         #   counts in its page statement (window count), and the
                         #   builder fetches its pages three to a request;
                         #   400 when (page-1)*pageSize > 1000 (MAX_CARDS_OFFSET);
                         #   400 for a value over 100 characters (300 for name,
                         #   nameExact, text);
                         #   429 {error} + Retry-After: 60 past 30 KV misses a minute
                         #   per IP (CATALOG_SEARCH_LIMIT, after the cache: any miss
                         #   or bypass not bounded by id/nameExact; fails open; §3.7.4)
GET    /cards/index      # every card as one compact row (CardIndexPayload: filter
                         #   values plus abilities/attacks/effect text) for the
                         #   builder's in-browser name and rules-text search and the
                         #   decklist import; one KV entry per epoch; a KV miss reads
                         #   the catalog once and spends CATALOG_SEARCH_LIMIT;
                         #   about 2 MB raw, 280 KB gzip; `version`
                         #   (CARD_INDEX_VERSION) changes with the columns, and the
                         #   client refuses one it does not know (falls back to /cards)
GET    /cards/:id        # full canonical Card; 404 JSON if absent; never in KV (a
                         #   1-row PK read is cheaper than a KV write)
GET    /cards/full       # full Card[] for ?id= (repeatable, 1-100) in id order; unknown
                         #   ids are omitted; id batches never enter KV (card-pool load)
GET    /sets             # SetBrief[] (optional ?serie=), ordered by releaseDate
GET    /sets/:id         # full Set + cards: CardBrief[] (ordered by local_id)
GET    /series           # Serie[] = SerieBrief + nested SetBrief[]
GET    /facets           # CatalogFacets — the EIGHT filter vocabularies actually
                         #   present: rarities, types, stages, trainerTypes,
                         #   energyTypes, illustrators, regulationMarks, suffixes.
                         #   One aggregate pass over cards (json_group_array(DISTINCT)
                         #   per column, sorted in byte order in the handler), each
                         #   through the sentinel guard (D194); a list is EMPTY when
                         #   the column has no values, and the builder's rail hides
                         #   the section it feeds — the only thing standing
                         #   between an unpopulated column and a filter that
                         #   empties a page (D198, §5.3.3)
                         #   A KV miss spends CATALOG_SEARCH_LIMIT.

# Assets — lazy tcgdex→R2 mirror (D9, §3.4); strict :file allowlists and tcgdex-id
# shaped :cardId/:setId, else 404. Fetches only https://assets.tcgdex.net/ (also
# after redirects) and stores only an image/* body whose magic bytes match the
# file type, at most 5 MB; anything else answers as missing (404, logged). An
# origin 404/410 is missing (404, max-age=3600); any other non-200 origin status,
# a network error or a timeout is an uncached 502 (§3.4)
GET    /assets/cards/:cardId/:file   # high.webp only (the one file the web app shows)
GET    /assets/sets/:setId/:file     # logo.webp | symbol.webp

# Auth (D2a) — implemented (§3.5 as-built); bodies validated, users
# boundary-parsed through @colorless/schema userSchema (never any hash field)
POST   /auth/register            # {email, password, displayName?} → 201 user + session
                                 #   cookie; 400 invalid body; 409 duplicate email; 429 rate-limited
                                 #   (AUTH_LIMIT 10/min, then 5/hour per IP in D1); 503 when the
                                 #   limiter cannot count (D1 error)
POST   /auth/login               # {email, password} → 200 user + session cookie;
                                 #   uniform 401 on any failure; 429 rate-limited (AUTH_LIMIT
                                 #   10/min, then the D1 budgets), or a failure past the email's
                                 #   50 failures/hour (the right password still → 200); 503 as
                                 #   above, or when the stored hash's pepper is missing
POST   /auth/logout              # deletes the session row, clears the cookie → 204; a failed
                                 #   delete is logged (logout_failed) and still clears it → 204
POST   /auth/logout-all          # session cookie → deletes every session of the account, clears
                                 #   the cookie → 204; 401 without a live session
GET    /auth/me                  # session cookie → user, else 401 (expiry enforced here)
DELETE /auth/me                  # {password?, confirmEmail?} → 204, deletes the account (cascades),
                                 #   clears the cookie; 401 wrong/missing password; 403 OAuth-only
                                 #   account without its typed email; 429 rate-limited
GET    /auth/oauth/:provider     # google — 302 to provider with a PKCE S256 challenge; 503
                                 #   until secrets installed
GET    /auth/oauth/:provider/callback  # state-checked code exchange (PKCE verifier) → session, 302
                                 #   to APP_ORIGIN; failures 302 back with ?authError= state |
                                 #   exchange | profile | no-email | email-in-use | email-unverified |
                                 #   unavailable (D1 failed)
POST   /auth/verify-email  ·  POST /auth/reset-password
                                 # both 501 — blocked on choosing an email provider (§3.5)

# Decks — implemented (P1 m7, apps/api/src/decks/). ALL routes need a
# valid session cookie (requireUser, §3.5) → else 401; every :id lookup is
# scoped WHERE user_id = ? so someone else's (or a missing) resource is the
# SAME 404 — no existence leak. NO KV cache: user data reads fresh. Responses
# boundary-parsed through the @colorless/schema deck schemas. The folder and
# reorder routes are retired (they had no caller): `folderId` is accepted only
# as null (a non-null value → 400), lists still order by `position`, and the
# `folders` table and `decks.folder_id` column stay. Card lists: {cardId, count 1–99},
# ≤200 distinct entries, duplicate cardIds → 400, ids absent from the catalog
# → 400 `{"error":"unknown card id(s)","cardIds":[…]}` naming at most 20 (checked
# with a chunked IN query against `cards`, never the FK error text). On writes a
# card id (and `chosenCoverCardId`) is 1–40 characters of `[A-Za-z0-9._-]`, else
# 400 (security audit DK3; catalog ids are 12 at most today); read schemas do not
# check it, so a deck saved earlier always loads. POST, PATCH and DELETE are
# limited to 60 a minute per account and 180 per IP (Workers Rate Limiting,
# §3.7.4) → 429 `{"error":"too many requests"}` + Retry-After: 60.
GET    /decks            # DeckSummary[]: {id, name, format, tint, folderId,
                         #   updated, version, cardCount, coverCardId, cards?}
                         #   — cardCount = summed copy counts (0 when empty);
                         #   `cards` (as GET /decks/:id orders them) only on a
                         #   deck of exactly DECK_SIZE, so the sandbox/online
                         #   pickers and the library's legality check need no
                         #   per-deck GET, and each row stays ≤60 entries.
                         #   Optional on the wire: a client falls back to
                         #   GET /decks/:id when it is absent (an older api)
GET    /decks/:id        # full Deck: summary shape minus cardCount, plus
                         #   cards: [{cardId, count}]
POST   /decks            # {name, tint 0–360, format?, folderId? (null), cards?}
                         #   → 201 Deck (server-minted UUID id, version 0);
                         #   409 {"error":"deck limit reached","limit":500} once
                         #   the account holds MAX_DECKS_PER_USER decks. The
                         #   insert counts the decks in the same statement
                         #   (INSERT … SELECT … WHERE count < cap) and the cards
                         #   insert is guarded by EXISTS on the deck row, so
                         #   racing creates never pass the cap (security DK2)
PATCH  /decks/:id        # any of {name, tint, format?, folderId? (null)} (null clears
                         #   the nullable ones) AND/OR wholesale `cards`
                         #   replacement (only the differing rows, in one
                         #   db.batch); writes only the named fields; refreshes
                         #   `updated` and bumps `version`; an empty patch (or
                         #   a lone `version`) → 400. Optional `version` = the
                         #   one the save was made from: the patch applies only
                         #   while the deck is still at it, else 409
                         #   {"error", "deck"} with the current deck and nothing
                         #   written. Every statement of the write batch carries
                         #   that precondition (the card writes as EXISTS guards,
                         #   ahead of the UPDATE that moves `version`), because a
                         #   D1 batch does not stop at an UPDATE that changes no
                         #   row. Without `version` it is last-writer-wins (web
                         #   builds from before versions, the library's rename).
                         #   The builder makes each save from the version the
                         #   previous one returned, and on a 409 reloads the deck
                         #   from the body with a notice; the stale copy's
                         #   unsaved edits are dropped.
DELETE /decks/:id        # 204 (deck_cards cascade away)

# Lobby (Durable Object) — implemented (P1 m8, apps/api/src/lobby/; §3.6
# as-built). Account-less: neither route reads the session cookie. Both are
# limited per IP (Workers Rate Limiting) → 429 + Retry-After: 60.
POST   /lobby                    # mint an unused code (draw + claim via the DO,
                                 #   retry on 409 collision) → 201 {code}; 503
                                 #   after five straight collisions; 10/min/IP
GET    /lobby/:code/ws           # strict code check (404) → upgrade check (426)
                                 #   → Origin check (403 {"error":"forbidden
                                 #   origin"}) → 60/min/IP (429)
                                 #   → forward to the code's LobbyDO: a code
                                 #   that names no lobby (never created or
                                 #   expired) gets a 101 closed at once with
                                 #   4004; 503 {error} when the lobby is full
                                 #   ("lobby full") or the session lookup
                                 #   fails ("lobby unavailable, try again").
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
```
