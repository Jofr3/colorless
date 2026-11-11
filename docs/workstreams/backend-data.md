# Backend and data (as built)

The API Worker and its stores, the catalog ingest, accounts, the lobby Durable Object, releasing
and production operations, and the API reference (§6). The founding decisions D1-D6 are in
`docs/decisions.md`. The July plan this file started as (its §1-2 and §7-9) and the 2026-08
deploy runbook are in `docs/archive/backend-data-plan.md`.

---

## 3. Architecture

```text
browser ──▶ colorless        static web Worker: dist/ (the love.js page), src/notFoundWorker.ts
   │                         the page runs the engine itself for local play (src/game)
   └──HTTPS + WebSocket──▶ colorless-api   Hono Worker, apps/api
                              ├── D1 `colorless`: catalog and user data (§5.3)
                              ├── KV `CACHE`: catalog responses (§6)
                              ├── R2 `ASSETS`: card images, mirrored lazily from tcgdex (§3.4)
                              ├── LobbyDO: one per lobby code; runs the engine, redacts per seat (§3.6)
                              └── daily cron: the session and limiter sweep (§3.5)
tcgdex.dev ──▶ apps/api/scripts/ingest.ts (local Bun script) ──▶ D1 catalog (§3.4)
```

The July plan's diagram is in the archive. README "Architecture" describes the page side.

### 3.1 Repo layout

`apps/api` (the API Worker and `LobbyDO`), `packages/schema` (the shared Zod schemas and types:
tcgdex, catalog, decks, auth, lobby, match), `packages/engine` (the game, run by the DO and by
the page) and the web app at the root (`src/`, `frontend/lua/`). README "Project structure" has
the tree.

### 3.2 Backend

Hono on Cloudflare Workers, configured in `apps/api/wrangler.jsonc`. Bodies and queries are
parsed with the `packages/schema` schemas through `validate` (`apps/api/src/http/validation.ts`).
D1 is read through Drizzle (`apps/api/src/db/`); migrations are generated into
`apps/api/drizzle/`. Locally, `bun run api:dev` runs `wrangler dev` after applying the local
migrations.

### 3.3 Storage & compute bindings (Cloudflare)

- **D1** `DB`, two logical schemas in one database: the catalog and user data (§5.3).
- **R2** `ASSETS`: mirrored card images and set logos and symbols, served through `/assets/*`.
- **KV** `CACHE`: the catalog response cache and its `catalog:epoch` (§6). No rate limit lives
  in KV.
- **Durable Objects** `LOBBY`: one `LobbyDO` per lobby code (§3.6).
- **Rate limiting** bindings (`ratelimits`, §3.7.4), the sign-in counters in D1
  (`auth_rate_limits`, §3.5), the daily Cron Trigger (`triggers.crons`) and
  `CF_VERSION_METADATA`, which `/health` reports.

### 3.4 Ingest & asset pipeline (D9: local data ingest, lazy image mirror)

**Card data** is ingested by a local Bun script — `apps/api/scripts/ingest.ts`
(`bun scripts/ingest.ts [--serie sv | --sets sv01,sv02] [--remote] [--dry-run]
[--refresh] [--transport=fetch|sdk] [--allow-legality-change]`, run from `apps/api/`; with neither
`--serie` nor `--sets` it fetches the whole catalog, `CATALOG_SCOPE` in
`apps/api/src/ingest/scope.ts`) — not by the request Worker:

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
   its card statements) via `wrangler d1 execute colorless --file …` against
   the `--local` or `--remote` database, then the reprint-legality pass, then stamp `catalog:epoch` in
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
bun scripts/ingest.ts                        # the whole catalog
```

The whole catalog is `CATALOG_SCOPE` (`apps/api/src/ingest/scope.ts`): the
`sv` and `me` series (Mega Evolution since D581) and the set `swsh10.5`
(Pokémon GO, for its reprints). A new serie or set joins it there. For
production, run it through the deploy token:

```sh
bun scripts/with-deploy-token.ts bun scripts/ingest.ts --remote
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
  the password manager before putting the secret (README, "API secrets"). Rotation: set the old value
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
  bun scripts/with-deploy-token.ts bunx wrangler secret put GOOGLE_CLIENT_ID
  bun scripts/with-deploy-token.ts bunx wrangler secret put GOOGLE_CLIENT_SECRET
  ```

  For local dev put the same names in `apps/api/.dev.vars` (gitignored).

### 3.6 Lobby and match lifecycle (as built, `apps/api/src/lobby/`)

One `LobbyDO` per lobby code (`idFromName(code)`, binding `LOBBY`, DO migration
`v1 new_sqlite_classes`). `POST /lobby` mints a code and claims it in its DO; `GET
/lobby/:code/ws` forwards the upgrade, with its `session` cookie, to that DO (§6). The wire
types in `packages/schema/src/lobby/` (`types.ts`, `wire.ts`, `serverWire.ts`, `protocol.ts`)
are authoritative.

| Module | Owns |
| --- | --- |
| `lobbyDO.ts` | storage, sockets, the alarm, frame dispatch, the match handoff and broadcasts |
| `snapshot.ts` | the pure seat and phase transitions (`seatGuest`, `applyIntent`, `recomputePhase`, `removeGuest`) |
| `logic.ts` | the pure policies and their constants: hello decisions, seat binding, forfeit deadlines, frame budgets, `endMatch`, `rematch`, `applyBye` |
| `match.ts` | the engine handoff (`beginMatch`), `applyMatchAction`, each viewer's redacted frame (`matchFrameFor`), `MATCH_RECORD_VERSION`, the log cap |
| `matchStore.ts` | the stored match: a head, the card tables once, and the log in 64-row chunks |
| `deckLoad.ts`, `sessionCheck.ts` | the D1 reads: a player's deck at the handoff, and the sessions a rematch re-checks |
| `attachment.ts` | what a socket keeps across hibernation: its seat, account, `logDeltas`, spectating |

- **Phases.** `waiting` (the host alone) → `selecting` (both seated, choosing decks) →
  `countdown` (both ready, `COUNTDOWN_MS`) → `in-game`. There is no finished phase: a finished
  match is an `in-game` lobby whose stored game is over.
  - A seat change re-derives the phase (`recomputePhase`) among the three pre-match phases.
    Ready needs a chosen deck, and a seat that loses its socket loses its ready.
  - The alarm ends the countdown. With a live socket on both seats, the handoff reads both decks
    (owner-scoped to the seat's account, and only while that socket's session lives) and the card
    pool from D1, and `beginMatch` starts the game, refusing a deck illegal in its format. The
    match is stored before the lobby flips to `in-game`, then each socket gets its `match` frame.
    A deck that will not resolve or is refused puts both seats back in `selecting`, un-readied,
    with a `match-error`. A seat with no live socket is marked away instead.
  - The engine ends the game (prizes, no Pokémon, deck out, a card effect, a tie), or a seat
    concedes: the Concede button (an `action`), a `bye` mid-match (`left`), or the forfeit clock
    (`abandoned`). The lobby stays `in-game` on the result.
  - `rematch`, only on a finished game and after the session re-check below, drops the match,
    returns to `selecting` and readies the asker; the other seat's `rematch` or ready accepts. The
    last game's loser chooses who goes first (`nextChooser`); a tie goes to the coin.
  - The host's kick (`reject` `kicked`) removes the guest and returns to `waiting`, dropping a
    running match. Outside a match a guest's `bye` frees its seat; the host's only marks it away.
- **Seats and accounts.** The browser mints a seat secret per lobby (`src/online/session.ts`,
  in sessionStorage). A hello presents it; the DO keeps only its hash, the public seat id that
  snapshots and frames name (`packages/schema/src/lobby/seatId.ts`). The first hello claims the
  host seat, and the host's id always re-seats as host. Another id takes the guest seat when it is
  free, or before a match when its holder is gone. A socket keeps the account its cookie resolved
  to at the upgrade. The first signed-in hello binds its seat to that account (`seatUsers`, never
  broadcast): from then on only that account may hold it, and other sockets on it are closed
  (1008). A seat without an account can sit but not play, since the handoff reads only a
  signed-in player's saved deck. A socket with no seat watches a running match: it is answered
  `reject` `full` and sent the snapshot and the spectators' board.
- **Frames.** JSON. Every client frame spends from its socket's budget, then is Zod-validated;
  an invalid one, or one whose `from` is not the socket's own seat, is dropped.

  | Frame | Direction | Purpose |
  | --- | --- | --- |
  | `hello` | client → DO | claim or reclaim a seat: the seat secret, a name, `logDeltas` |
  | `intent` | client → DO | `select-deck` (the deck id stays in the DO) or `set-ready` |
  | `action` | client → DO | a game action, run for the socket's own seat |
  | `reject` `kicked` | host → DO → guest | the host's kick |
  | `bye` | client → DO | leaving; concedes a running match |
  | `rematch` | client → DO | play again after a finished game |
  | `state` | DO → every socket | the lobby snapshot after each change |
  | `match` | DO → each socket | that viewer's redacted game and the seat log; with `logFrom`, only the rows from that index |
  | `reject` `full` | DO → one socket | no seat for this hello |
  | `reject-action` | DO → the actor | a refused action, with the engine's reason |
  | `match-error` | DO → every socket | the match could not start, or a stored one was retired |

  The keepalive is a raw `"ping"`/`"pong"` pair answered by `setWebSocketAutoResponse` without
  waking the DO; `heartbeat` exists only in the client's channel union, made from those pongs.
  Close codes: 1001 keepalive lost; 1008 frame rate, an ended session, or a seat an account
  claimed; 1009 a frame over 16K characters; 1011 the session lookup failed; 1013 lobby full;
  4000 closed for good (`LOBBY_WS_CLOSED`); 4004 no such lobby (`LOBBY_WS_NOT_FOUND`). The
  client stops reconnecting on 4000 and 4004 only.
- **Hibernation.** Sockets are accepted hibernatable (`state.acceptWebSocket`), and a socket's
  seat and account survive eviction in its attachment, so a lobby can sleep between alarm passes
  (a two-seat lobby's `SEATED_LIVENESS_SWEEP_MS` keeps it in memory).
- **The alarm.** One alarm, set for the earliest deadline (`scheduleMaintenance`), covers:
  1. liveness sweeps: a socket silent past `SOCKET_SILENCE_MS` is closed, checked every
     `LIVENESS_SWEEP_MS`, or `SEATED_LIVENESS_SWEEP_MS` while both seats are held;
  2. disconnect graces: a seat whose last socket dropped shows away after `DISCONNECT_GRACE_MS`;
  3. the countdown and its handoff;
  4. match forfeits: a seat away from a running match forfeits after `ABANDON_GRACE_MS`, stored
     as the seat's `forfeitAt`, so the opponent's countdown and the alarm read one number;
  5. empty-lobby expiry: `EMPTY_LOBBY_TTL_MS` after the last socket (after `created` for a lobby
     nobody said hello in), `storage.deleteAll()` frees the code.

  The same pass closes a lobby with no commit, accepted action or seated hello for
  `INACTIVE_LOBBY_MS`: every socket gets 4000 and the lobby is wiped. A failed pass logs
  `alarm_failed` and re-arms. Constants: `apps/api/src/lobby/logic.ts` and
  `packages/schema/src/lobby/protocol.ts`.
- **Reconnect and the log.** The client reconnects with backoff (400 ms doubling to 8 s), queues
  up to 32 frames while down, repeats its hello until it is answered, and replaces a socket
  silent for 10 s (`src/online/channel.ts`, `src/online/lobbyClient.ts`). A hello with the seat's
  secret re-seats it with its deck and ready kept and clears any forfeit; in a match it also gets
  the whole match frame. A socket whose hello set `logDeltas` gets only the new log rows
  (`logFrom`) after an accepted action or a forfeit. The handoff, a reconnect, a repeated hello,
  spectating and a trimmed log send the whole log, and the client answers a gap with a hello. A
  stored match from an older build is migrated on read (`match_migrated`), or retired when
  unreadable: the lobby leaves `in-game` and both seats get `match-error`. A rollback across a
  `MATCH_RECORD_VERSION` change retires the newer matches (§3.7.2).
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

### 3.7 Deployment

Two Workers on one `workers.dev` site: `colorless-api` (`apps/api/wrangler.jsonc`) and the static
web Worker `colorless` (root `wrangler.jsonc`), which calls the API over HTTPS. Images come
through the API's `/assets/*` routes; there is no custom domain and no staging environment.
Every production write goes through `bun run release` or the deploy-token wrapper (§3.7.2).

#### 3.7.1 Releasing

Prerequisites:
- the deploy token file (§3.7.2, "Cloudflare tokens");
- Balatro's source beside the main checkout or at `BALATRO_SOURCE`, and a Lua 5.1 for `check:lua`;
- push access to `origin`, and network to Cloudflare, GitHub and the npm registry; `gh` is
  optional (the `ci` step only prints);
- a local catalog ingested from the same series as production (§3.4.1), or `print-keys` refuses.

Before:
1. Merge into main and push. `clean-tree` refuses a dirty tree or a HEAD that is not the
   remote's main.
2. Run `bun run e2e` (and `--firefox`) when the change touches page lifecycle, fetch or
   WebSocket code (§3.7.2).
3. Put a new required secret first, through the wrapper; the `secrets` step prints the command.
4. Ship a Durable Object migration in a release of its own (§3.7.2).

Run `bun run release` from the repo root. It runs `bun install --frozen-lockfile`, `check`,
`release:gate`, `build`, `db:migrate:remote`, `api:deploy`, `release:health`, `deploy:web` and
`release:finish`, and drops its pin when a step fails; §3.7.2 has each step and the recovery
table. `bun run api:deploy` and `bun run deploy` alone are partial deploys: no bookmark, health
check or tag.

After:
1. Read the Workers Issues page (`colorless-api` → Observability → Issues, §3.7.4).
2. After about an hour of use, `bun run --cwd apps/api prod:report --release` (read-only).

#### 3.7.2 Release gates (2026-10-27; identity and checks 2026-11-10, BLD-P1)

`bun run release` runs, in order:

0. `bun install --frozen-lockfile`.
1. `check`.
2. `release:gate` (apps/api), whose steps are:
   - `pin`: writes HEAD to `tmp/release.json`, so the rest of the release can
     require that commit. It refuses while another commit's release holds a pin
     younger than 15 minutes. A pin of the same commit is an earlier, failed
     run of this release, and it is taken over. It also refuses while `tmp/`
     still holds `releases.log` or `d1-bookmarks.log`, and prints the `mv`
     that moves the file to `.local/`.
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
     list`, which shows names only, and prints the secret puts to run,
     through the deploy token.
   - `bookmark`: records the remote Time Travel bookmark.
   - `versions`: records each Worker's running version (`wrangler
     deployments status`).
   - `print-keys`: the local and remote catalogs agree on every card's
     `print_key`, because the engine's `PROGRAM_ALIAS` table is generated from
     the local one.
3. `build`: the web bundle, before anything remote changes. `build:lua` needs
   Balatro's source beside the main checkout or at `BALATRO_SOURCE`. Vite writes `dist/build-info.json` (commit, dirty tree,
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
(the D203 incident of 2026-08). Then it re-checks the tree, prints CI's line, and
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
or style that comes back as `text/html` counts as missing, because that is the
host page served in its place; a missing build file otherwise answers 404
(`src/notFoundWorker.ts`).

`release:finish` does four things:

1. Appends a line to `.local/releases.log`: the time, the tag, the commit, each
   Worker's version before and after, the bookmark, and the balatro-source
   commit from `dist/love/asset-manifest.json`.
2. Prints the release notes, which are the commit subjects since the previous
   `release-*` tag.
3. Tags HEAD `release-YYYYMMDD-HHMM` (UTC, annotated with the log line) and
   pushes the tag.
4. Drops the pin.

All the gates only read production.

**The records.** `.local/releases.log` (the release history) and
`.local/d1-bookmarks.log` (§3.7.3) are created on demand in the main
checkout's `.local/`, which is gitignored; a release or ingest run from a
worktree writes there too. `tmp/` is scratch: anything in it can be deleted,
except `tmp/release.json` while a release runs and a backup export (§3.7.3)
still needed.

**Which commit is live.** `curl -s
https://colorless-api.jofrescari.workers.dev/health` gives `version.tag` (the
API's commit). The page source's `<meta name="build">` gives the web's commit.
`bunx wrangler deployments list` shows each version's tag and message. `git tag
--list 'release-*'` and `.local/releases.log` hold the release history. There is no
CHANGELOG: a release's notes are `git log --format=%s <previous tag>..<tag>`.

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
through `bun apps/api/scripts/with-deploy-token.ts <command>`: a Worker
rollback, a secret put, a Time Travel restore, a remote KV key put (the
catalog epoch), a remote ingest, and a writing remote `d1 execute`. Every such
command in README and the workstream docs is written with the wrapper, and
`scripts/docs-writes.ts` in `check:static` fails on one that is not. A missing
token file stops the write with the path.
The split stops a mistaken write, not a deliberate one: any process running as
this user can read the file.

**A dead pin.** A release killed before `abort` ran (a closed terminal) leaves
`tmp/release.json` for 15 minutes. Releasing the same commit again takes it
over. To release another commit sooner, run `bun
apps/api/scripts/release-gate.ts unlock`, but only when no release is running.

**Before releasing, run `bun run e2e`** (`scripts/e2e.ts`; needs `CHROMIUM`, or
chromium on PATH, and Balatro's source; about 70 s). It is the one check of the
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
earliest line for it in `.local/d1-bookmarks.log`). From `apps/api` unless noted:

| Failed step | What production is running | Recovery |
| --- | --- | --- |
| `check`, `release:gate`, `build` | Nothing changed. | Fix what it printed and release again. |
| `db:migrate:remote` | The files before the failing one are applied; the failing one rolled back (one transaction per file). The old Worker reads the expanded schema fine. | A transient error: release again. A SQL error: fix the file (it is not applied remotely), commit, push, release again. |
| `api:deploy` | New schema, old Worker. | Release again, or `bun run api:deploy`, then `bun run release:health`, then `bun run deploy:web` from the repo root (`web-dist` refuses a `dist/` built at another commit: then `bun run deploy`). |
| `release:health` | New Worker, which cannot read D1, sees another migration count or fails a route; or the new version never answered `/health`. | The tag never matched: `bunx wrangler deployments list` shows whether the deploy took; rerun `bun run release:health` once it has. A D1 error: `evt = "d1", kind = "health_failed"` in Workers Logs (§3.7.4) carries the error and cause names and `quota`. `quota: true` is a spent daily quota (wait for 00:00 UTC); otherwise it is a binding or schema problem (`bunx wrangler d1 migrations list colorless --remote`): fix it, rerun `bun run release:health`. Bad code (a failed `/sets` or `/auth/me` probe, or D1 errors from the code): from `apps/api`, `bun scripts/with-deploy-token.ts bunx wrangler rollback <version id> -m "<why>"` to the version before the release (the `versions` line it printed; after a retry, see below), and check `HEALTH_TAG='*' bun run release:health` again. The schema stays: the old Worker reads it (expand, then contract). |
| `deploy:web` (`web-dist`, the deploy, `web-health`) | New API, and the old web app, or a new one `web-health` found broken. The old web app is fine when the API change kept the old client working, as an API-first release should. | Release again. By hand instead: `bun run deploy` from the repo root, then tag the commit yourself, since `abort` dropped the pin and `release:finish` refuses without one: `git tag -a release-<UTC YYYYMMDD-HHMM> -m "Release <short sha>" <sha> && git push origin refs/tags/release-<UTC YYYYMMDD-HHMM>` (the log line is then missing, as in the next row). A bad web build: `bunx wrangler deployments list` and `bun apps/api/scripts/with-deploy-token.ts bunx wrangler rollback <version id>` from the repo root (Worker `colorless`). |
| `release:finish` | Both new. Only the record is missing: the log line, the tag, or its push. | It prints the `git tag -a … && git push origin refs/tags/…` to run. A missing log line can be rebuilt from `bunx wrangler deployments list` (both Workers) and `.local/d1-bookmarks.log`. |

When an earlier attempt of the same release got past `api:deploy`, the retry's
`versions` line records that attempt's version as the one "before" it. To roll back after a retry, pick the newest version
in `bunx wrangler deployments list` whose tag is not this release's short sha.

Never revert or edit a migration file that is applied remotely: undo it with a
new migration. A rollback of the API across a change of
`MATCH_RECORD_VERSION` (the engine's game-state version) retires the matches
the newer Worker stored, so players in a match at that moment lose it.

A Durable Object migration (a `migrations` entry in apps/api/wrangler.jsonc that
adds, renames or deletes a class) blocks a rollback to any API version
before it: Cloudflare refuses a rollback across a DO class change. Ship such a
migration in a release with no other API change, so the version before it is
not one a rollback would need (build audit DEP2).

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

What each store holds about a player, how long, and how it comes back:

| Store | Personal data | Kept for | Recovery |
| --- | --- | --- | --- |
| D1 user tables (`users`, `sessions`, `oauth_identities`, `folders`, `decks`, `deck_cards`) | email, display name, password hash, the Google account id, the deck library; sessions by the SHA-256 of their token | until the account is deleted (`DELETE /auth/me`; the rest cascades), with no purge of unverified accounts; a session 30 days, then the daily sweep | Time Travel, or an export taken before a risky change. Nothing else can recreate them. |
| D1 `auth_rate_limits` | SHA-256 keys of the IP (an IPv6 /64) or email per scope, with counts | until its window ends (15 minutes to an hour), then the daily sweep | Disposable: at worst a caller gets a fresh sign-in budget. |
| D1 catalog (`series`, `sets`, `cards`) | none | until an ingest changes it | Re-run the ingest (§3.4.1); Time Travel only when user rows reference cards an ingest removed. |
| KV `CACHE` | none (public catalog responses) | a day, or until the next `catalog:epoch` | Disposable: stamp a new `catalog:epoch`. |
| R2 `ASSETS` | none (card images) | indefinitely | Disposable: refilled from tcgdex on demand. |
| LobbyDO storage | seat names, chosen deck names and ids, each seat's account id (`seatUsers`), the match and its log | until the lobby is wiped: 10 minutes after its last socket, or after an hour without play | Ephemeral by design; matches in progress are lost. |
| Workers Logs | the app's lines: keyed tags, never an email, IP or id (§3.7.4); Cloudflare's invocation event: the IP, city, postal code, coordinates and headers, the URL without its query | 3 days | Not backed up. |
| The browser | localStorage: preferences, a sandbox game, the online name; sessionStorage: each lobby's seat secret; IndexedDB: card art; the http-only `session` cookie | until the player clears them; sessionStorage until the tab closes; the cookie 30 days | Nothing to recover. |
| `tmp/backup/` exports (below) | all of D1, emails and password hashes included | until deleted by hand, once no longer needed | They are the backup. |

A deleted account stays in D1's Time Travel history for its 7 days (30 on paid), so a restore
to before the deletion brings it back.

**Time Travel** is always on: the database can be restored to any minute in
the last 7 days on the Free plan (30 on paid). `release` and a remote
ingest record the bookmark taken just before they write, with
the reason, in `.local/d1-bookmarks.log` (gitignored) and print the restore
command. A restore rewinds the WHOLE database, catalog and user data
together, so every deck edit, registration and login after that point is lost.
Prefer a targeted repair (re-ingest the catalog, or re-import rows from an
export) when the damage is confined to one side.

```sh
cd apps/api
bunx wrangler d1 time-travel info colorless                       # current bookmark
bun scripts/with-deploy-token.ts bunx wrangler d1 time-travel restore colorless --bookmark=<bookmark>
bun scripts/with-deploy-token.ts bunx wrangler d1 time-travel restore colorless --timestamp=2026-10-27T09:00:00Z
# After any restore, in this order:
bun scripts/release-gate.ts migrations    # "not applied remotely" = the restore rewound a migration
bun run db:check -- --remote
bun scripts/with-deploy-token.ts bunx wrangler kv key put catalog:epoch $(date +%s) --binding CACHE --remote
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
   wrangler deployments list`, then
   `bun scripts/with-deploy-token.ts bunx wrangler rollback <version id> -m "D1 restored to <bookmark>"`. Then `curl -fsS
   https://colorless-api.jofrescari.workers.dev/health/db` should count the
   files minus the ones listed (`release:health` compares with all of
   `drizzle/`, so it fails until step 3). Roll the web app back too
   (`bun apps/api/scripts/with-deploy-token.ts bunx wrangler rollback <version id>`
   from the repo root) if it needs the new API.
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
for f in $D/*.sql; do bun scripts/with-deploy-token.ts bunx wrangler d1 execute colorless --remote --yes --file $f && mv $f $f.done || break; done
# 4. Backfills. A migration newer than the export never ran its data statements on these
#    rows. List the export's migrations and compare with drizzle/:
grep '^INSERT INTO "d1_migrations"' $F | grep -o "'[0-9]\{4\}_[a-z0-9_]*\.sql'"
ls drizzle/*.sql
#    For each newer file that has UPDATE, INSERT or DELETE lines (0003 and 0012 today),
#    run them, which start at the first such line (docs/conventions.md "Database migrations"):
sed -n '/^\(UPDATE\|INSERT\|DELETE\)/,$p' drizzle/0012_users_name_prompt.sql > $D/backfill-0012.sql
bun scripts/with-deploy-token.ts bunx wrangler d1 execute colorless --remote --yes --file $D/backfill-0012.sql
# 5. Check, compare the row counts it prints with step 1, and retire the cached catalog.
bun run db:check -- --remote
bun scripts/with-deploy-token.ts bunx wrangler kv key put catalog:epoch $(date +%s) --binding CACHE --remote
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
nothing else uses. From the repo root, about ten minutes. Each write below
(create, migrate, execute, restore, delete) needs the deploy token: prefix it
with `bun ../../apps/api/scripts/with-deploy-token.ts`.

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

**Standing it up from zero** (a new account, or new resource names). It was done once, in
5b4125d3c (2026-10-22), as a rename that copied the D1 data from the old database; the order
below is derived from the config and has not been run end to end. Every Cloudflare write goes
through the deploy token.

1. Make the two tokens of §3.7.2, "Cloudflare tokens": the read one as `CLOUDFLARE_API_TOKEN`,
   the deploy one in its file.
2. Create the stores, from `apps/api/` (`CI=true` stops `d1 create` prompting):

   ```sh
   CI=true bun scripts/with-deploy-token.ts bunx wrangler d1 create colorless
   bun scripts/with-deploy-token.ts bunx wrangler kv namespace create colorless-cache
   bun scripts/with-deploy-token.ts bunx wrangler r2 bucket create colorless-assets
   ```

   Paste the printed `database_id` and KV `id` into `apps/api/wrangler.jsonc`. Keep the names:
   `colorless` and `colorless-api` are also in `apps/api/package.json`,
   `apps/api/scripts/{d1,release-gate,prod-report}.ts` and `scripts/e2e.ts`. The Free plan
   allows 10 D1 databases per account.
3. Check that no other Worker on the account uses the `ratelimits` `namespace_id`s.
4. Set the origins together: the web Worker's `https://colorless.<subdomain>.workers.dev` as
   `APP_ORIGIN` (`apps/api/wrangler.jsonc` `vars`) and `VITE_SITE_ORIGIN`, the API's as
   `VITE_API_ORIGIN` (`.env.production`, which also builds the CSP). `web-dist` refuses a build
   whose site origin is not `APP_ORIGIN`. Both must stay on one site (§3.5).
5. Register the new callback `https://<API origin>/auth/oauth/google/callback` on the Google
   client (README "Google login").
6. Commit and push, then `bun run db:migrate:remote` and `bun run api:deploy`, so the Worker
   exists. Put the four secrets `release:gate`'s `secrets` step lists (README "API secrets"),
   each with `bun scripts/with-deploy-token.ts bunx wrangler secret put <NAME>`. Then
   `bun run deploy` from the repo root, so the web Worker exists too (`release:gate`'s
   `versions` step reads both; unverified on a never-deployed one).
7. Ingest the full catalog locally and with `--remote` (§3.4.1), then `bun run release`.
8. Update the URLs written into README and this file.

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
headers; a console line shares `$workers.requestId` with its invocation. Levels
(observability audit LOG3, decision 8a): info for what went as intended
(sign-ins and the other account successes, the sweep's counts, a lobby forfeit
or wipe); warn for an expected degradation (a spent quota, a limiter or binding
failure, a D1 or origin failure the code answers for) or a refusal; error for a
code defect or an unexpected exception. Filter on level `warn` or `error` to see
only trouble. Each level has its console method: info lines go out through
`console.info`, since a `console.log` line arrives with no level at all (that
`console.info` gives level info is checked on the first release with it). Invocation events are level info too, so
a query for the app's info lines also needs `$metadata.type = "cf-worker"`. The
log queries below filter on `evt` and see every level. A failure line's error
fields come from `errorFields` (`apps/api/src/http/errors.ts`): `error` and
`cause` names, `query` (the SQL without its parameters) and `quota: true` when
the error reads as a spent daily quota, never a message or a bound value. An
error-level line for a failure nothing handled (`http` `unhandled`, `d1`
`sweep_failed`) adds `frames`: up to 5 of the stack's innermost `at` lines, 200
characters each, read from below the message so no bound value can ride along.
They come from the minified bundle and are not resolved by the source map, but
function names survive minification. The lobby's `error` field is the
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
postal code, coordinates, ASN and TLS fingerprint, next to the URL. The API
Worker sets `observability.redact_query_string`, so its URLs are stored without
the query string (a catalog search's text, the OAuth callback's code and
state). It is kept 3 days and readable by
the account and its read tokens, and an `account` tag can be joined to it
through `$workers.requestId`. That was accepted (observability audit LOG1,
decision 1a).

**Workers Issues** (`colorless-api` → Observability → Issues) groups errors
into issues with an occurrence count; by Cloudflare's description it records an
uncaught exception, a failed invocation, a 5xx response or a logged error
(`console.error`, which here is only the error level above). It is on through
`observability.issues.enabled` in `apps/api/wrangler.jsonc` (observability audit
ERR1, decision 2a), set in config because a deploy without it turns Issues off.
It is free while in beta; recheck that with the 2026-12-01 Workers Logs change.
An `http` `unhandled` line is both a 5xx and a logged error. Whether Issues
groups the app's `console.error` lines, and Durable Object exceptions, is
checked on the first release with it. Look there first. Nothing emails the
developer about a new issue: the account's Alerts → Platform Notifications list
has no Workers issue type (checked 2026-11-11; searching "worker" finds none),
and Issues → Automations sends only to a coding agent, a webhook, a chat or an
incident tool, never to email. So the Issues page is read by hand after each
release and when a player reports a problem; an outage still emails through the
Production watch's failed run.

The web Worker (`colorless` → Observability) has Workers Logs on too. Its
script runs only on an asset miss that is not a navigation, so it logs a few
events a month: each `/assets/` or `/love/` 404, grouped per
`$workers.scriptVersion.id` after a web deploy, is a tab that outlived its
build.

Log queries:

| Query | What it finds |
| --- | --- |
| `evt = "kv"` | Catalog cache `get_failed`, `put_failed` and `epoch_failed`, with the route and the error fields: `quota: true` means the day's KV quota is spent. |
| `evt = "auth"` | The account audit trail (`apps/api/src/auth/routes.ts`, §3.5): `registered`, `login_ok`, `login_failed` (`reason`; `capped: true` past the per-email cap), `logout`, `logout_all` (`sessions` ended), `profile_updated`, `delete_failed`, `account_deleted`, `oauth_created`, `oauth_linked` (`claimed`, `identitiesRemoved`, `sessionsRevoked`), `oauth_refused` and the other OAuth failures: `oauth_denied` (the provider's `?error=` for this browser's sign-in, its code in `providerError`; `access_denied` is a Cancel), `oauth_state` (`reason`: `no_cookie`, `no_state`, `mismatch` or `no_code`), `oauth_exchange` and `oauth_profile` (the provider's `status` and `providerError`; with `status: null`, the fetch failed and `cause` is `timeout` or `network`). The successes are info level, the rest warn. `account` is the keyed tag of the user id (`apps/api/src/http/logTag.ts`, secret `LOG_TAG_KEY`; `untagged` without it): filter on one tag to follow an account across addresses. `rate_limited` (with `by: "binding"` when `AUTH_LIMIT` refused it) carries `net`, the same kind of tag for the address; `limiter_error` from the D1 limiter and `binding_error` from the binding. `expired_session_delete_failed` (throttled, with the error fields): an expired session presented to a route could not be deleted; the 401 stands and the daily sweep gets the row. `logout_failed` (the session row could not be deleted; the cookie is cleared anyway) and `oauth_unavailable` (D1 failed while the callback found the account or recorded the session; the browser is sent back with `unavailable`), both warn with the error fields. Error level: `pepper_missing` (no `PASSWORD_PEPPER`; set it) and `pepper_unavailable` (a stored hash needs a pepper the Worker lacks: restore the secret or `PASSWORD_PEPPER_PREVIOUS`). No line carries an email, IP or user id. |
| `evt = "decks"` | `rate_limited` and `binding_error` from the deck write limits (`apps/api/src/decks/routes.ts`). |
| `evt = "lobby"` | Lobby Durable Object events (`apps/api/src/lobby/`, kinds below), and `rate_limited` / `limiter_error` from the per-IP limits on its routes. |
| `evt = "http"` | `unhandled`: a request that threw (a 500), with the method, route pattern, the error fields and `frames`. Logged at error level. `invalid_request` (throttled): a validator 400, with the route pattern, `target` (`body` or `query`), the `issues` count and the first five issue `paths` (`cards.3.cardId`), never the values or messages; a run of them after a release means the client sends what the server rejects. `cross_site_refused` (throttled): an unsafe request from another site (§3.5), with the method and route pattern. |
| `evt = "d1"` | `health_failed`: a `/health/db` failure, with the error fields (`quota: true` is a spent quota, otherwise a binding or schema problem). The daily sweep: one info-level `sweep` line with the rows deleted, or an error-level `sweep_failed` with the error fields and `frames` (the run also shows as failed under the Worker's Cron Events). `catalog_reads` (info level): each isolate's tally of `/cards` queries that missed KV (cacheable misses and bypasses alike), at most one line a minute: `queries`, `rows_read`, and the heaviest query's `max_rows_read` and `max_params` (param names, never values). |
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

**Production report.** `bun run --cwd apps/api prod:report [--days N] [--release]` is the one-command view of production. It reads only, with the ambient read token, and exits 1 only on a crit. It shows usage against the Free quotas per UTC day, requests by status with CPU and wall time, 5xx by day and version, latency by route, the top D1 queries, the watched lines and the cron, the two SLOs and the match completion share. Run it monthly with `--days 30`, and after a release with `--release`, which compares the new API version with the one it replaced. A `quota` warn or crit names the day: look up that day's `quota: true` lines (§3.7.4 Log queries) and which Worker or database on the account spent it. An `unreadable` line is a refused or failed read; rerun before acting on the rest.

**A player reports…** Ask for the time, to the minute, and for a match the
lobby code from the address bar (`/online/<CODE>`). Then:

| Report | Where to look |
| --- | --- |
| Anything | Workers Issues first; then Account Home → Workers & Pages → Usage, and the table at the top of this section, for a spent daily quota. |
| A `Run failed: Production watch` email (not a player) | Open the run: its `PROD DOWN` annotation names each check that failed after three tries (a 5xx, no answer, a timeout or a wrong body). `/health` down: the API Worker is not answering (`bunx wrangler deployments list` in apps/api; Cloudflare's status page). `/health/db` 503: `evt = "d1", kind = "health_failed"`; `quota: true` is a spent daily quota (heals at 00:00 UTC). `/sets` or `/auth/me` failing beside a healthy `/health`: bad API code, roll back (§3.7.2). A web file answering 404 or text/html: the web deploy lost files; redeploy or roll back the `colorless` Worker. Rerun the workflow, or `bun scripts/prod-watch.ts` locally, to see whether it has healed. `PROD HELD` warnings (a 4xx) do not fail the run. |
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

One flat `Card` per print, in `packages/schema/src/catalog/` with `CardBrief`,
`Set`/`SetBrief`/`SetWithCards`, `Serie`/`SerieBrief` and the `paginatedSchema` envelope. Its
nullability follows the §5.3 columns rather than tcgdex's optionality; consumers narrow on
`category`. `image`, `logo` and `symbol` are this API's asset base paths (`/assets/cards/{id}`,
`/assets/sets/{id}`; the client appends `/high.webp`, `/logo.webp` or `/symbol.webp`), null when
the row has no origin URL. The deck library's schemas are in `packages/schema/src/decks/`:
`Deck` (with `cards: [{cardId, count}]`), `DeckSummary` and the request bodies.

### 5.3 D1 relational schema

One database, two logical schemas. `apps/api/src/db/catalog.ts` and `users.ts` are authoritative
for columns and indexes (`schema.ts` exports both); the migrations are in `apps/api/drizzle/`
(docs/conventions.md "Database migrations"). Catalog dates are ISO text verbatim from tcgdex;
user-data timestamps are integer epoch ms.

| Table | Holds | Key, unique | Foreign keys (ON DELETE) | Written by |
| --- | --- | --- | --- | --- |
| `series` | tcgdex series | `id` | none | ingest |
| `sets` | sets: counts, legality, origin logo and symbol URLs | `id` | `serie_id` → series (no action) | ingest |
| `cards` | one row per print: the Pokémon, Trainer and Energy fields (lists as JSON), `suffix`, per-print and effective legality, `print_key`, the origin `image_url` | `id`; unique (`set_id`, `local_id`) | `set_id` → sets (no action) | ingest and its reprint pass |
| `users` | email, display name, password hash (null for OAuth-only), `email_verified`, `name_prompt`, the retired `favourite_deck_id` | `id`; unique `email` | `favourite_deck_id` → decks (SET NULL) | register, the OAuth callback, `PATCH /auth/me` |
| `oauth_identities` | a provider account linked to a user | (`provider`, `provider_id`) | `user_id` → users (CASCADE) | the OAuth callback |
| `sessions` | SHA-256 of the cookie token, expiry | `id` | `user_id` → users (CASCADE) | register, login, the OAuth callback; the sweep |
| `folders` | retired with its routes; kept | `id` | `user_id` → users (CASCADE), `parent_id` → folders (CASCADE) | nothing |
| `decks` | name, format, tint, `cover_card_id`, `position`, `version`, `updated` | `id` (a UUID) | `user_id` → users (CASCADE), `folder_id` → folders (SET NULL), `cover_card_id` → cards (no action) | the deck routes |
| `deck_cards` | each card's count in a deck | (`deck_id`, `card_id`) | `deck_id` → decks (CASCADE), `card_id` → cards (no action) | the deck routes |
| `auth_rate_limits` | sign-in counters: a hashed key, its count and `reset_at` | `key` | none | the D1 limiter (§3.5); the sweep |

"No action" refuses deleting a row another row still points at, so an ingest cannot orphan a
deck. Deleting a user removes its sessions, identities, folders, decks and deck cards in one
statement (§3.5); conventions.md "Database migrations" warns what that cascade does to a table
rebuild. The reprint rule: `print_key` is a card's functional identity (ingest `map.ts`
`printKey`), and `legal_*_effective` is legality OR'd across every print sharing it (the ingest
post-pass `reprintLegalitySql`); readers fall back to the per-print flags, and the engine's
`PROGRAM_ALIAS` table (`scripts/registry-aliases.ts`) is generated from it. tcgdex
`variants_detailed`, `pricing` and `boosters` are not stored.

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

The ingest has written NULL there since. The 2026-08 note on the then-pending re-ingest
is in `docs/archive/backend-data-plan.md`.

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

The 2026-08 notes that the column was still empty and its migration unapplied in
production are in `docs/archive/backend-data-plan.md`; `release` now applies every
migration before it deploys (§3.7.2).

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
PATCH  /auth/me                  # {displayName} → 200 user, and clears namePrompt; 400 blank or
                                 #   over 64 characters once cleaned; 401 checked before the body;
                                 #   a retired favouriteDeckId is ignored
DELETE /auth/me                  # {password?, confirmEmail?} → 204, deletes the account (cascades),
                                 #   clears the cookie; 401 wrong/missing password; 403 OAuth-only
                                 #   account without its typed email; 429 rate-limited
GET    /auth/oauth/:provider     # google — 302 to provider with a PKCE S256 challenge; 503
                                 #   until secrets installed; 404 {"error":"unknown provider"}
GET    /auth/oauth/:provider/callback  # state-checked code exchange (PKCE verifier) → session, 302
                                 #   to APP_ORIGIN; failures 302 back with ?authError= state |
                                 #   exchange | profile | no-email | email-in-use | email-unverified |
                                 #   unavailable (D1 failed); 404 for an unknown provider
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
                         #   position, updated, version, cardCount, coverCardId,
                         #   cards?}, ordered by position
                         #   — cardCount = summed copy counts (0 when empty);
                         #   `cards` (as GET /decks/:id orders them) only on a
                         #   deck of exactly DECK_SIZE, so the sandbox/online
                         #   pickers and the library's legality check need no
                         #   per-deck GET, and each row stays ≤60 entries.
                         #   Optional on the wire: a client falls back to
                         #   GET /decks/:id when it is absent (an older api)
GET    /decks/:id        # full Deck: {id, name, format, tint, folderId, position,
                         #   updated, version, cards: [{cardId, count}],
                         #   chosenCoverCardId} — the owner's cover pick, null for
                         #   automatic (the summary's coverCardId is the face drawn)
POST   /decks            # {name, tint 0–360, format?, folderId? (null), cards?}
                         #   → 201 Deck (server-minted UUID id, version 0);
                         #   409 {"error":"deck limit reached","limit":500} once
                         #   the account holds MAX_DECKS_PER_USER decks. The
                         #   insert counts the decks in the same statement
                         #   (INSERT … SELECT … WHERE count < cap) and the cards
                         #   insert is guarded by EXISTS on the deck row, so
                         #   racing creates never pass the cap (security DK2)
PATCH  /decks/:id        # any of {name, tint, format?, folderId? (null),
                         #   chosenCoverCardId?} (null clears the nullable ones;
                         #   a cover must be a card the deck holds after the patch,
                         #   else 400 {"error":"cover card not in deck"}, and a
                         #   `cards` replacement drops a pin whose card left)
                         #   AND/OR wholesale `cards`
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
# as-built). Neither route needs a session; the upgrade forwards the `session`
# cookie to the DO, which binds a signed-in seat to its account. Both are
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

**Adding an API route.**
1. Write the handler in its area's `routes.ts` (`apps/api/src/<area>/`). Validate a body or
   query with `validate("json" | "query", schema)` (`apps/api/src/http/validation.ts`), behind
   `requireUser` when it needs a session, so a signed-out caller gets 401 before validation.
2. Put the request and response schemas in `packages/schema/src/<area>/` and export them from
   the package index; the web client (`src/lib/api.ts`) imports only their types.
3. Mount a new area in `apps/api/src/index.ts` with `app.route`, after the CORS, cross-site and
   body-limit middleware (only the lobby WebSocket mounts before them).
4. Classify the route in `ACCESS` (`apps/api/src/routeAccess.d1.test.ts`) as `public`,
   `requireUser` or `owner`; the sweep fails on a route missing there.
5. Name any new log `evt` and `kind` in §3.7.4 (`scripts/log-guard.ts` fails otherwise). A new
   rate limit is a `ratelimits` entry in `apps/api/wrangler.jsonc` with an unused
   `namespace_id`, and a row in §3.7.4's binding table.
6. Add the route's line above, and its tests beside it (`useTestD1` from
   `apps/api/src/testing/d1.ts` for one that needs D1).
