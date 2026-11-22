# Antigravity consumer compatibility migration

This is an **independent private derivative**, not a GitHub fork-network member.
It retains Pi provider registration, calls, streaming events and account commands.
It does not turn Pi into codex2api's HTTP gateway.

**Application-layer compatibility is not proof of official-client equivalence,
lower account risk, compliance, or protection from account suspension.** No personal
Google credentials or real Google requests were used to implement/test this work.

## Pinned provenance and licensing

- Pi baseline: Rahularya01/pi-antigravity
  [`67706dd5fcc0a710f69f89412a6867673c58a684`](https://github.com/Rahularya01/pi-antigravity/tree/67706dd5fcc0a710f69f89412a6867673c58a684).
  Full reachable baseline history (88 commits) and its Rahul Arya MIT `LICENSE`
  are retained; the baseline is the independent repository's `main` branch.
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
  `proxy/antigravity_gemini.go`. Existing notices in the Pi base are retained.
  Consult the reference's rights holder before externally redistributing if the
  absent root license text creates a compliance concern.

## Default path and acceptance matrix

Unset `ANTIGRAVITY_COMPAT_PROFILE` selects the new consumer path. `pi` selects the
old Pi routing/request path for regression comparison; it is not a risk-reduction
mode. `ANTIGRAVITY_LOCATION` enterprise routing remains the existing Pi adapter,
not a clone of the reference's consumer OAuth gateway.

| Area             | Implemented behavior                                                                                                                                                                                                                                             | Offline evidence                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| OAuth            | Auth code, independent state + S256 PKCE; `openid`, offline, consent, include_granted_scopes; ephemeral IPv4 loopback callback; manual paste and cancellation retained                                                                                           | Browser redirect simulated against a real local callback listener; denial/state tests |
| Client identity  | `antigravity/hub/2.19.1 windows/amd64` on token/profile/control/generation requests; one override; body userAgent remains `antigravity`                                                                                                                          | Header/payload fixtures                                                               |
| OAuth clients    | Existing direct CLIENT_ID/SECRET plus semicolon-separated `OAUTH_CLIENTS=key\|id\|secret` and `OAUTH_CLIENT_KEY`; stored tuple preferred during refresh, configured alternatives, built-in fallback on client-compatible errors                                  | Token endpoint MockAgent tests; no real credentials                                   |
| Refresh          | In-process single-flight; rotated refresh retained; stale ID token cleared; structured permanent errors; no retry storm on transport/5xx; profile and project rebuilt for newly minted access token                                                              | Concurrent refresh, invalid_grant vs transient, forced 401 refresh                    |
| Identity         | `/oauth2/v2/userinfo`, verified email required, bounded profile/control reads                                                                                                                                                                                    | Verified/unverified synthetic profiles                                                |
| Project          | loadCodeAssist production → sandbox → daily on 429/5xx; no listCloudAICompanionProjects or generated project on default login                                                                                                                                    | Payload/order/failure tests                                                           |
| Onboarding       | Default allowed tier → current tier → free-tier; daily → production; platform/plugin metadata; gl-node header; five calls/host with 2s waits; string/object project IDs; caller-owned enterprise project                                                         | Pending/done, fallback, exhaustion and tier fixtures                                  |
| Generation       | Daily → production; sandbox explicit-only; no anonymous prewarm; same serialized request and session on endpoint retry; opt-in x-goog-user-project removed once after 403                                                                                        | Transport/408/404/5xx and header tests                                                |
| Models/thinking  | 44 pinned fixed/logical definitions; fixed tier wins; Argon shared high backing; named Gemini thinking levels and numeric older budgets; retired/disabled IDs rejected                                                                                           | Catalog/tier tests; existing Pi model tests in legacy profile                         |
| Request envelope | agent/milliseconds/8-hex request ID; negative 63-bit big-endian SHA session; Pi sessionId maps to metadata.session_id seed; no invented CLI trajectory labels; native long systemInstruction; no Gemini maxOutputTokens                                          | Hash/envelope fixtures                                                                |
| Tools/multimodal | Existing Pi transcript conversion; JSON-schema normalization, local dereferencing, union cleanup, enum hints, empty reason schema, deterministic name collisions and name restoration, Gemini replay signature stub, image results inside functionResponse.parts | Original adapter suite + new replay/schema tests                                      |
| Retry/health     | Structured ErrorInfo/RetryInfo; 8 capacity waits shared across endpoints, 2 instant waits below 3s; capacity does not churn accounts; monotonic per-model/Gemini-family cooldowns; Argon isolation; validation/TOS and permanent refresh fences                  | Budget, quota failover, finite exhaustion, private file permissions                   |
| 401              | One forced refresh for a remembered token; rebuilt project; second 401 terminal                                                                                                                                                                                  | Token/profile mocks and two-request assertions                                        |
| Streaming        | Header/stall deadlines retained; UTF-8 SSE multiline events, bounded frame/error reads, strict malformed/terminal checks, reader cancellation; no internal retry after streaming begins                                                                          | Existing deadline/SSE tests plus default multiline/truncation/no-replay cases         |
| Persistence      | Random exclusive 0600 temporary file, fsync, atomic rename, 0700 newly-created directory; coherent OAuth metadata; stale auth snapshot protection                                                                                                                | Synthetic isolated stores; original account tests                                     |

All contract fixtures are synthetic and describe the pinned source, **not an
observed capture of official AGY**. The 44 definitions are a snapshot, not a claim
that Google currently makes any named model available to this account.

## Deliberate differences and remaining parity gaps

This is a substantial **consumer main-chain port**, not a claim that every
codex2api behavior has been cloned:

1. **Transport/browser:** Node/Undici is not Go net/http. TLS ClientHello,
   ALPN/HTTP2, header order/canonicalization, pooling, proxy/DNS/decompression and
   browser fingerprints are not equivalent. No Go sidecar, TLS impersonation or
   official browser environment was introduced.
2. **Pi semantics:** provider/model registration, transcript adaptation, Pi's
   system-prompt normalization and SDK-specific events remain. The reference's
   entire gateway client-scaffolding regex/code-block masking engine, arbitrary
   OpenAI/Anthropic payload adapters, structured-output gateway emulation, and
   every malformed-schema edge case have **not** been translated. Schema tests
   cover the supported Pi input contract, not full differential fuzz equivalence.
3. **Additional Pi features:** search, URL reader, image-generation tools,
   on-demand model discovery and usage diagnostics remain their Pi implementations
   with the shared default UA. They are not new codex2api gateway endpoints;
   their envelope/probing behavior is not claimed to be identical.
4. **Quota/scheduler:** request-related cooldown/health handling is ported. Full
   gateway account-affinity balancing, distributed CAS/outbox coordination,
   quota-summary/AI-credit background snapshots and automatic polling are not
   installed. No additional background Google traffic was added. Capacity
   pressure does not silently select a weaker sibling model on the default path.
5. **Storage:** Pi keeps its owner-only plaintext local auth store. It is not
   encrypted-at-rest or a transactional multi-process database. Refresh de-dupe
   is per-process; run only one Pi writer per auth directory. SDK expiry stores
   the five-minute lead once, rather than Go's raw expiry + dispatch skew.
6. **SSE failures:** HTTP-side health handling is structured; errors carried
   inside a 200 SSE stream fail closed without internal replay. They do not yet
   update all persistent health/quota snapshots in the same manner as gateway
   handler-side classification. The Pi host may have its own retry policy.
7. **Validation limits:** no user credential migration, real OAuth consent,
   real generation, live quota check, transport capture, or account-risk experiment
   was performed. Runtime behavior with Google remains unverified.

These gaps are explicit acceptance boundaries, not hidden behind “complete” or
“safer” labels. If full gateway-level byte-for-byte and scheduler parity is the
requirement, this PR is not sufficient and should not be merged as such.

## Install / roll out

1. Review the private PR and this matrix. The PR does not merge itself. The
   `main` baseline remains upstream Pi behavior until the reviewed change lands.
2. After merging, install **this private repository**, not npm:pi-antigravity or
   Rahularya01's public URL: `pi install git:github.com/NEORUAA/pi-antigravity`.
   Git authentication for that private repository must already work on your own
   computer. Alternatively clone it yourself, install its locked dependencies,
   and use Pi's local-extension installation mechanism.
3. Node >=22.19 and the existing Pi peer requirements still apply. Install with
   Corepack/Yarn and `yarn install --immutable`; lifecycle scripts remain off.
   No build/Go process, new database or Redis is required.
4. Back up your auth directory privately before rollout. Existing credentials
   with a real project ID remain usable; no credentials were copied from this
   execution environment. Prefer `/login antigravity` again to populate the
   verified identity, project/tier, and OAuth client tuple coherently.
5. Default login callback is `http://127.0.0.1:<ephemeral-port>/oauth-callback`.
   Remote/headless users should paste the actual full callback URL shown in the
   browser; the historical fixed 51121 SSH-tunnel example does not apply to the
   default profile. Never post callback URLs or token files into issues/chat.
6. Optional settings: `ANTIGRAVITY_USER_AGENT` changes the same UA everywhere;
   `ANTIGRAVITY_PROJECT_ID` supplies a caller-owned project;
   `ANTIGRAVITY_OAUTH_ENDPOINT_MODE=daily|sandbox|all` controls generation hosts.
   Leave overrides unset for the pinned reference defaults.
7. Roll back by reverting this PR or selecting the baseline revision. The
   explicit `ANTIGRAVITY_COMPAT_PROFILE=pi` switch restores the old Pi request/
   routing path, not a security guarantee. Never run both copies against one
   writable auth directory simultaneously.

`package.json` is private to prevent accidental npm publication. The inherited
publish workflow is replaced by an inert notice; no release/tag/publish action
is part of this migration.

## Verification

- `yarn test:codex`: default-profile offline contracts.
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
