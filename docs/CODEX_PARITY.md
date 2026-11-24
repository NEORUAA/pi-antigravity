# Antigravity consumer compatibility migration

This is a **public native GitHub fork of Rahularya01/pi-antigravity**, in its
fork network. The canonical repository is `NEORUAA/pi-antigravity`.
It retains Pi provider registration, calls, streaming events and account commands.
It does not turn Pi into codex2api's HTTP gateway.

**Application-layer compatibility is not proof of official-client equivalence,
lower account risk, compliance, or protection from account suspension.** No personal
Google credentials or real Google requests were used to implement/test this work.

## Pinned provenance and licensing

- Pi baseline: Rahularya01/pi-antigravity
  [`67706dd5fcc0a710f69f89412a6867673c58a684`](https://github.com/Rahularya01/pi-antigravity/tree/67706dd5fcc0a710f69f89412a6867673c58a684).
  Full reachable baseline history (88 commits) and its Rahul Arya MIT `LICENSE`
  are retained; the baseline remains an ancestor of this fork's `main` branch.
- Reference: james-6-23/codex2api
  [`d8e1981f1cc13d0b00fb4d4354e9c8777392319e`](https://github.com/james-6-23/codex2api/tree/d8e1981f1cc13d0b00fb4d4354e9c8777392319e).
  Its [README declares MIT](https://github.com/james-6-23/codex2api/blob/d8e1981f1cc13d0b00fb4d4354e9c8777392319e/README.md#L597-L601),
  but that snapshot has **no root LICENSE file**. This document records that
  limitation; a complete missing license or copyright notice has not been invented.
  No unrelated third-party source/license was copied as the project's license.
- Application algorithms/tables adapted in `src/compat`, `auth/control-plane.ts`
  and `client/codex-transport.ts` come from that pinned reference's
  `auth/antigravity_client.go`, `proxy/antigravity_responses.go`,
  `proxy/antigravity_quota.go`, `proxy/antigravity_models.go`,
  `proxy/antigravity_function_names.go`, `proxy/antigravity_schema.go`, and
  `proxy/antigravity_gemini.go`, `proxy/antigravity_gemini_schema.go`,
  `proxy/antigravity_schema_refs.go`, `proxy/client_scaffolding.go`, and
  `proxy/antigravity_stream_errors.go`. Existing notices in the Pi base are retained.
  Consult the reference's rights holder before externally redistributing if the
  absent root license text creates a compliance concern.

## Default path and acceptance matrix

Unset `ANTIGRAVITY_COMPAT_PROFILE` selects the new consumer path. `pi` selects the
old Pi routing/request path for regression comparison; it is not a risk-reduction
mode. `ANTIGRAVITY_LOCATION` enterprise routing remains the existing Pi adapter,
not a clone of the reference's consumer OAuth gateway.

| Area             | Implemented behavior                                                                                                                                                                                                                                                                                                                                               | Offline evidence                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| OAuth            | Auth code, independent state + S256 PKCE; `openid`, offline, consent, include_granted_scopes; ephemeral IPv4 loopback callback; manual paste and cancellation retained                                                                                                                                                                                             | Browser redirect simulated against a real local callback listener; denial/state tests |
| Client identity  | `antigravity/hub/2.19.1 windows/amd64` on token/profile/control/generation requests; one override; body userAgent remains `antigravity`                                                                                                                                                                                                                            | Header/payload fixtures                                                               |
| OAuth clients    | Existing direct CLIENT_ID/SECRET plus semicolon-separated `OAUTH_CLIENTS=key\|id\|secret` and `OAUTH_CLIENT_KEY`; stored tuple preferred during refresh, configured alternatives, built-in fallback on client-compatible errors                                                                                                                                    | Token endpoint MockAgent tests; no real credentials                                   |
| Refresh          | In-process single-flight; rotated refresh retained; stale ID token cleared; structured permanent errors; no retry storm on transport/5xx; profile and project rebuilt for newly minted access token                                                                                                                                                                | Concurrent refresh, invalid_grant vs transient, forced 401 refresh                    |
| Identity         | `/oauth2/v2/userinfo`, verified email required, bounded profile/control reads                                                                                                                                                                                                                                                                                      | Verified/unverified synthetic profiles                                                |
| Project          | loadCodeAssist production → sandbox → daily on 429/5xx; no listCloudAICompanionProjects or generated project on default login                                                                                                                                                                                                                                      | Payload/order/failure tests                                                           |
| Onboarding       | Default allowed tier → current tier → free-tier; daily → production; platform/plugin metadata; gl-node header; five calls/host with 2s waits; string/object project IDs; caller-owned enterprise project                                                                                                                                                           | Pending/done, fallback, exhaustion and tier fixtures                                  |
| Generation       | Daily → production; sandbox explicit-only; no anonymous prewarm; same serialized request and session on endpoint retry; opt-in x-goog-user-project removed once after 403                                                                                                                                                                                          | Transport/408/404/5xx and header tests                                                |
| Models/thinking  | 44 pinned fixed/logical definitions; fixed tier wins; Argon shared high backing; named Gemini thinking levels and numeric older budgets; retired/disabled IDs rejected                                                                                                                                                                                             | Catalog/tier tests; existing Pi model tests in legacy profile                         |
| Request envelope | agent/milliseconds/8-hex request ID; negative 63-bit big-endian SHA session; Pi sessionId maps to metadata.session_id seed; no invented CLI trajectory labels; native long systemInstruction; no Gemini maxOutputTokens                                                                                                                                            | Hash/envelope fixtures                                                                |
| Tools/multimodal | Existing Pi transcript conversion; JSON-schema normalization, local dereferencing, union cleanup, enum hints, empty reason schema, deterministic name collisions and name restoration, Gemini replay signature stub, image results inside functionResponse.parts                                                                                                   | Original adapter suite + new replay/schema tests                                      |
| Retry/health     | Structured ErrorInfo/RetryInfo; 8 capacity waits shared across endpoints, 2 instant waits below 3s; capacity has a 10s model cooldown without immediate account rotation; named rate limits 30s, bare RESOURCE_EXHAUSTED 5s; only quota exhaustion cools a Gemini family; monotonic shared cooldowns; Argon isolation; validation/TOS and permanent refresh fences | Budget, quota failover, finite exhaustion, private file permissions                   |
| 401              | One forced refresh for a remembered token; rebuilt project; second 401 terminal                                                                                                                                                                                                                                                                                    | Token/profile mocks and two-request assertions                                        |
| Streaming        | Header/stall deadlines retained; UTF-8 SSE multiline events, bounded frame/error reads, strict malformed/terminal checks, reader cancellation; no internal retry after streaming begins                                                                                                                                                                            | Existing deadline/SSE tests plus default multiline/truncation/no-replay cases         |
| Persistence      | Random exclusive 0600 temporary file, fsync, atomic rename, 0700 newly-created directory; coherent OAuth metadata; stale auth snapshot protection                                                                                                                                                                                                                  | Synthetic isolated stores; original account tests                                     |

All contract fixtures are synthetic and describe the pinned source, **not an
observed capture of official AGY**. The 44 definitions are a snapshot, not a claim
that Google currently makes any named model available to this account.

## Local second review (not published yet)

The first PR revision did not implement several application behaviors. The local
second revision now adds:

- The reference's system/conversation/product-scaffolding normalization, three-pass
  phrase obfuscation, fenced/inline code masking, reminder switches, 1MiB byte
  budget and native tool-result recursion. Session hashing occurs **after** this
  normalization; no unrelated fallback persona is added when Pi supplies none.
- Malformed schema repair, local JSON Pointer expansion/cycle hints, source union
  selection/merge, required cleanup, enum descriptions and empty-tool placeholder.
  Native response JSON schemas use their **separate** cleaner (not tool placeholders).
- Shared HTTP/SSE health handling for validation/TOS fences and quota/rate/capacity
  cooldowns; sanitized status/kind/model outcome persistence (no raw error bodies);
  string/numeric/RPC error status inference; multiline, unprefixed,
  bare and array-wrapped error envelopes. No consumed stream is internally replayed.
  Safety/failed-finish frames are checked before emitting their text/tool calls.
- Shared consumer pool, header/body deadlines, identity/request/session envelope and
  dispatch for search and image generation. Image body errors cannot silently select
  another model. URL-reader RPCs retain Pi's crawler contract but share UA/pool,
  deadlines and terminal-error health observation.
- Default pinned model registration without startup catalog probes (separate from the required login/refresh quota catalog observation). Explicit
  `/antigravity.refresh` still queries; automatic discovery requires
  `ANTIGRAVITY_DYNAMIC_DISCOVERY=1`. Citation redirect/title enrichment requires
  `ANTIGRAVITY_SOURCE_ENRICH=1`; public citations never receive bearer headers.
  Anonymous prewarm stays disabled. Existing **explicit** Pi credit-overage opt-in
  remains supported; it is a Pi extension, not a claim about codex2api defaults.
- Refresh saves re-read live account state, preserve concurrent health writes and
  do not resurrect deleted accounts. Tool names are normalized once after Pi's
  payload hook, including non-function native tools and collision restoration.

### Independent source evidence and intentional Pi adaptation

`reference.json` contains **714 source-derived vectors**, generated by a
standard-library-only development Go oracle from the pinned checkout. The generator
records SHA256 provenance, executes the real source algorithms 32 times, and never
runs the upstream application. Go is **not** a runtime/sidecar dependency.

One malformed-schema vector has multiple genuine upstream results: Go map iteration
can make conflicting keyword/property-bag assignments overwrite each other. Those
observed variants are explicitly retained in the fixture, not hidden or replaced
with TypeScript-generated expectations. Every deterministic vector must match exactly.

The source cleaner also confuses schema keywords with parameter names in a properties
map (e.g. it deletes a legitimate `type` parameter). `codexToolSchema` is the
source-equivalence kernel; `piToolSchema` makes the smallest position-aware adaptation
so Pi parameters named `type`, `format`, `$defs`, `required` or `enum` survive.
This is a deliberate compatibility fix, not byte-for-byte replication of that bug.
The differential kernel and the Pi adaptation have separate tests.

## One-shot Sync and pre-dispatch observations

The previously missing **separate `AntigravityClient.Sync`** lifecycle is now
wired to default-profile OAuth login and refresh by `synchronizeAntigravityCredential`
and `auth/quota-snapshot.ts`, rather than being dismissed as background polling:

- Verified profile, load/onboard/project, then sandbox → daily → production
  `fetchAvailableModels`; each 403 with a project retries without it once.
  401 is terminal to this stage; it permits one refresh and **full identity/project
  rebuild** before retry, not reuse of a different principal's old observations.
- Catalog/internal/forwarding IDs and per-model fraction presence (missing is not
  zero), normalized model fractions and supported model metadata are persisted.
- `retrieveUserQuotaSummary` follows the source 403/404/429/5xx fallback policy;
  daily AI-credit `loadCodeAssist` uses the separate snake-case IDE metadata.
  Missing credit amount means zero; unreadable/failed optional facts stay unknown.
- Same-identity incomplete/failed summaries retain old bucket timestamps instead
  of washing away known zero. Nonempty authoritative groups replace absent buckets.
  Owner-only account/auth snapshots carry observations; doctor shows only fixed,
  sanitized warning codes.
- Generation/search/image dispatch and failover consume local V2 gates: trusted
  observation sequence, fraction presence, model-family/Argon fallback, unknown
  buckets, reset plausibility, stale zero and TTL. There is **no background loop**.
  `ANTIGRAVITY_QUOTA_GATE_ENABLED=0` disables group-quota gates, not hard denial.

`quota-reference.json` adds **558 independent Go gate vectors** to the original
714 vectors. The additional offline Sync suite covers stage order, 401 identity
replacement, forbidden/no-project retries, optional failures and concurrent removal.

### Explicit Pi lifecycle adaptations (not hidden source equivalence claims)

- Pi has an explicitly selected active account. It remains the request's identity
  until eligible failover, rather than installing the gateway's weighted pool,
  expiry-priority scheduler or distributed session-binding service. Session seeds,
  intra-request identity consistency and request-level health/failover are retained.
- Because Pi has no summary scheduler, a successful **nonempty one-shot summary**
  is immediately promoted to a local trusted V2 observation (2-hour TTL, the source
  default interval's derived TTL). Source's standalone client Sync returns facts;
  its separate durable summary producer normally attaches V2 scheduling metadata.
- SDK login/refresh still returns validated credentials or an error, but a new
  owner-only `antigravity-checkpoints.json` **durably records a received rotated
  tuple before profile/project/catalog validation**. Pending material never reaches
  normal API-key/consumer calls, including when the legacy protocol-comparison
  profile is selected. Successful validation promotes the journal before
  SDK/account-file projection, so restart can repair an interrupted publication.
- Temporary failures/cancellation retain the rotated tuple for revalidation without
  another unnecessary token exchange. A pending active account is repaired once at
  session start; `/antigravity.accounts switch <index|email>` retries explicitly.
  Normal verified sessions cause no additional recovery probes or background loop.
- New validations require Google userinfo's verified email **and actual subject ID**,
  never decoded ID-token claims. A changed known subject stays quarantined even if
  the replacement is verified. Pi's minimal equivalent of the source administrative
  identity sync is **fresh OAuth consent**. Existing Pi credentials without a subject
  can bootstrap one from verified userinfo only when no previous identity contradicts
  it; project/snapshots are revalidated, not imported from an ID token.
- Journal family epochs/revisions fence late refresh/consent results. Account removal
  wipes raw journal tuples and keeps hashed tombstones, preventing stale SDK auth
  from resurrecting them. Permanent invalid_grant clears unusable tuples; unverified
  or changed-principal failures remain fenced until fresh consent/removal. Failure
  metadata contains fixed codes, never upstream bodies, token values or URLs.
- Pi reports provider errors/events, not the gateway's HTTP 429/Retry-After envelope.
  No real Google/credential test or safety-risk comparison has been performed.

## Actual architectural / SDK differences

1. **Transport/browser:** Node/Undici is not Go net/http. TLS ClientHello,
   ALPN/HTTP2, header order/canonicalization, pooling, proxy/DNS/decompression and
   browser fingerprints are not equivalent. Quota clocks use JavaScript millisecond
   precision rather than Go nanoseconds; unusual/noncanonical timestamps may be
   treated as unknown and use the bounded TTL fallback. No Go sidecar or impersonation was added.
2. **Pi-facing contract:** Pi provider registration, transcript conversion,
   streaming events, manual callback and explicitly invoked extra tools remain.
   No external OpenAI/Anthropic gateway, administration UI or database is installed.
   Pi's explicit session ID maps to the reference's metadata session seed.
   Arbitrary SDK prompt promises cannot be forcibly cancelled without host support;
   losing OAuth race results are ignored and listeners/server/timers are cleaned up.
3. **State:** owner-only plaintext local auth, atomic rename and in-process refresh
   de-duplication are not encryption-at-rest, distributed CAS/Redis or multi-writer
   transactions. The journal uses exclusive 0600 temp files, file fsync, atomic
   rename and directory fsync; the tested guarantee requires a filesystem/platform
   supporting those operations (Linux/POSIX was exercised). Existing directories
   are not silently chmodded. One Pi writer per auth directory is required. Full gateway pool
   balancing, periodic snapshot polling and expiry-priority scheduling are not installed.
4. **Local model UI:** the 44 published IDs come from the pin, not live availability.
   Pi-required UI price/context fields reuse inherited family metadata and are not
   verified quotas/prices/limits for newer IDs. No default Gemini output-token cap
   is sent (matching the source), even when Pi's UI displays a local token budget.
5. **Validation:** no real consent, Google call, live quota check, transport capture
   or account-risk experiment was performed. Runtime behavior with Google remains
   unverified. The Pi host can independently retry an error; the provider does not
   replay a consumed HTTP-200 body or partial output.

## Install / roll out

1. Install this fork's `main`. Its history retains upstream Pi and migration
   merge `7ed8fd7a530ffb5aac34aeec5976bb1b7becad82`, plus the public-fork
   documentation update. The former independent private repository was replaced;
   its PR/Actions records are not transferred. Review this matrix and verification record.
2. Install **this public fork** from `main`, not npm:pi-antigravity or
   Rahularya01's public URL: `pi install git:github.com/NEORUAA/pi-antigravity`.
   No private-repository Git authentication is needed. Alternatively clone it
   yourself, install its locked dependencies,
   and use Pi's local-extension installation mechanism.
3. Node >=22.19 and the existing Pi peer requirements still apply. Install with
   Corepack/Yarn and `yarn install --immutable`; lifecycle scripts remain off.
   No build/Go process, new database or Redis is required.
4. Back up your auth directory privately before rollout. Existing credentials
   with a real project ID remain usable; no credentials were copied from this
   execution environment. Prefer `/login antigravity` again to populate the
   verified identity, Google subject, project/tier, and OAuth client tuple coherently.
   Keep the checkpoint file with your private auth backup; do not copy it to logs
   or publish it. Pending/permanent states intentionally block ordinary requests.
5. Default login callback is `http://127.0.0.1:<ephemeral-port>/oauth-callback`.
   Remote/headless users should paste the actual full callback URL shown in the
   browser; the historical fixed 51121 SSH-tunnel example does not apply to the
   default profile. Never post callback URLs or token files into issues/chat.
6. Optional settings: `ANTIGRAVITY_USER_AGENT` changes the same UA everywhere;
   `ANTIGRAVITY_PROJECT_ID` supplies a caller-owned project;
   `ANTIGRAVITY_OAUTH_ENDPOINT_MODE=daily|sandbox|all` controls generation hosts.
   Leave overrides unset for the pinned reference defaults.
7. Roll back by reverting migration merge `7ed8fd7` or selecting the baseline revision. The
   explicit `ANTIGRAVITY_COMPAT_PROFILE=pi` switch restores the old Pi request/
   routing path, not a security guarantee. Never run both copies against one
   writable auth directory simultaneously.

`package.json` retains `private: true` to prevent accidental npm publication;
this is separate from the GitHub repository, which is public. The inherited
publish workflow is replaced by an inert notice; no release/tag/publish action
is part of this migration.

## Verification

- `yarn test:codex`: 19 default-profile contract groups, 714 source-derived vectors,
  558 quota-gate vectors, 24 application/state-machine groups, 11 one-shot Sync
  groups and 18 durable checkpoint/restart groups.
- `yarn test`: isolated original Pi regression scripts under the explicit legacy
  profile plus default-profile contracts, source typecheck, lint and security-check.
  It runs every group even if one fails, and returns nonzero if anything fails.
- `yarn typecheck`, `yarn lint`, `yarn security-check`, `yarn format:check` remain
  available. Live smoke/probe scripts are not part of this acceptance run.
- The test preloader disables external Undici networking and rejects unmocked
  non-loopback fetches. Fixtures, home, auth stores and temporary artifacts are
  inside the implementation checkout's ignored `.cache` directory.

See [VERIFICATION.md](VERIFICATION.md) for the actual run results and the original
URL-reader failure reproduced unchanged at the pinned Pi baseline.

## 0.16.0 Magpie account-view correction

The account-facing integration now uses Magpie's supported native OpenCode root
entry with real `auth.usage` and `provider.models`, not ignored Pi metadata. Pi
keeps four conventional extensions. Default refresh no longer advertises 44
pinned definitions as account entitlement. Published/admin model projection is
independently checked against the pinned Go source; internal/disabled filtering
and quota-family scopes are preserved. See [MAGPIE.md](MAGPIE.md).

Magpie owns its scoped account selection, OAuth expiry refresh and removal. Its
Gemini request adapter reuses this migration's consumer transport, project,
headers, scaffolding/schema normalization, tool-name restoration, SSE/error and
cancellation paths, without selecting Pi's unrelated active account. This is a
supported loader integration, not a host patch, monkey-patch or local gateway.
No real Google account/quota was exercised; no Go TLS equivalence or risk
reduction is asserted. Source pins and existing architecture boundaries remain.
