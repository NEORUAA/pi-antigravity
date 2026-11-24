# Source review and migration

Both source pins and licensing are recorded in [CODEX_PARITY.md](CODEX_PARITY.md).
Delivery target: the public native fork `NEORUAA/pi-antigravity`, branch `main`.
Migration merge `7ed8fd7` and every implementation commit are retained. The former
private repository's PR/Actions records are not migrated; this document and Git
history preserve implementation evidence.

## Source-to-port trace

| Source at codex2api d8e1981f                                                                                                      | Local implementation / evidence                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client_scaffolding.go:126–332,366–556`; `antigravity_responses.go:947–1022`                                                      | `compat/scaffolding.ts`; code fences of different lengths, inline spans across single lines, CRLF/Unicode/Go regex whitespace, switches and product-only tool values; independent Go vectors |
| `antigravity_gemini_schema.go`; `antigravity_schema_refs.go`; `antigravity_schema.go:8–137`; `antigravity_responses.go:1579–1788` | `compat/schema.ts`; independent kernel vectors plus the explicitly separate Pi property-name compatibility adaptation                                                                        |
| `antigravity_gemini.go:221–258`                                                                                                   | Native response schema alias cleanup after Pi payload hook; independent response-schema vectors; no tool placeholder/enum-to-prose transformation                                            |
| `antigravity_function_names.go:17–109,164–179`                                                                                    | Unicode-rune sanitizer, UTF8-byte sort, collision hash and Pi name restoration; independent Go vectors                                                                                       |
| `antigravity_stream_errors.go:57–278`; `sse_line.go`; `antigravity_responses.go:2534–2554`                                        | `client/consumer-sse.ts`, `client/codex-transport.ts`, stream pre-emission failure checks; independent framing/status vectors plus before/after-output health regressions                    |
| `antigravity_quota.go:95–152,233–262,475–565`                                                                                     | Named reason precedence; Go duration spellings; same-endpoint budgets; HTTP and internal-SSE persistent model/family cooldowns, no capacity account penalty                                  |
| `auth/antigravity_client.go:482–559,634–772,797–954`                                                                              | PKCE/token/client selection, profile verification, project/onboard/tier flow, client identity and refresh handling in OAuth/control-plane modules                                            |

## Independent diff review fixes

- Prevented repeated tool/schema normalization around the Pi payload hook. Kept
  non-function tools such as native `googleSearch` intact; response schemas use
  the source's separate cleaner.
- Refresh/failover updates reload current state after awaiting refresh, preserve
  concurrent validation/quota changes, and never restore deleted accounts.
- HTTP-200 failures observe the account actually dispatched after refresh/failover,
  not the original access token/project. Body failures cannot enter model fallback.
- Rate-limit family scoping corrected: only quota exhaustion cools the Gemini
  family; capacity/rate retain model scope. Unknown ErrorInfo reasons still allow
  source textual fallback, but recognized reasons take precedence over message text.
- A large network chunk containing many small SSE events no longer trips a
  whole-chunk frame limit; readers cancel on errors/early exit/DONE. Malformed,
  bare, continuation-line and array-wrapped error documents are handled explicitly.
- Removed default model-discovery/citation-enrichment probes; retained explicit
  opt-ins and explicitly invoked Pi tool semantics. No unrelated URL-reader
  long-fence implementation or test was changed.

## One-shot Sync follow-up

The substantive missing one-shot lifecycle was **implemented locally**, not
reclassified as a scheduler/UI boundary:

| Pinned source                                                                   | Port / offline evidence                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/antigravity_client.go:562–676`                                            | OAuth `synchronizeAntigravityCredential`: verified identity, one profile-401 recovery, quota-401 refresh + full identity/project rebuild, no recursive refresh loop |
| `1012–1103`                                                                     | `quota-snapshot.ts`: sandbox/daily/production catalog, per-endpoint project-less 403 retry, final forbidden, model/catalog/internal/forwarding normalization        |
| `1229–1298`                                                                     | Optional group/credit observations, fallback status rules, missing-vs-zero credit/fraction preservation, snake-case credit metadata                                 |
| `1116–1227`; `antigravity_quota_family.go`; `antigravity_quota_gate.go:264–406` | Trusted local V2 metadata, authoritative-group replacement, reset/TTL/stale-zero/family gates; 558 independent source-extracted Go vectors                          |

The Sync suite also tests single-flight over the entire normal refresh/sync,
401 principal/project replacement, final forbidden, optional failures, unknown
fraction vs zero and deletion races. The previous parallel-refresh test now asserts
all four control-plane stages, not the obsolete single `loadCodeAssist` call.

## Durable pending/restart follow-up and bounded final review

The previous durability gap is **implemented**, not waived. The source anchors are
`auth/store.go:12714–12759,12785–12897,12902–12930`: rotated credentials survive
validation failure, pending identity is quarantined, and principal changes require
an explicit identity-sync decision. `auth/checkpoint.ts` provides the single-writer
local equivalent with owner-only atomic/fsynced JSON, family aliases, epochs and
revision fences. It deliberately does not introduce a distributed DB/lease service.

| Consumer lifecycle                    | Final local review / evidence                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization/callback/token exchange | Existing state/PKCE/random-port/manual flow retained; bounded token-error bodies and fixed OAuth error-code output                                                                                |
| Refresh and failures                  | Received rotation checkpointed before verified userinfo; pending recoveries skip needless token exchange; mixed refresh/sync calls share one family flight                                        |
| Verified identity                     | Userinfo ID/email required, no ID-token claim authentication; known-subject change is quarantined until fresh consent; same subject may rename email                                              |
| Durability and restart                | Real child process exits after failed validation, next process recovers; promotion-before-projection is resolved through the verified journal; old SDK tuples do not override new identity        |
| Deletion/revocation/cleanup           | Before-network and late-response revocation tests; fresh consent supersedes old epoch; corrupt stores fail closed; failed atomic rename removes temp files; invalid_grant clears unusable secrets |
| Project/tier/onboarding               | Production/sandbox/daily entitlement policy, bounded async onboarding, caller-project behavior retained; identity is re-observed before old project/quota facts can be retained                   |
| Model/request/scaffolding/schema      | Prior independent Go vectors remain unchanged; Pi property-name and native-tool/hook adaptations retained                                                                                         |
| Generation/HTTP/SSE                   | Shared transport/identity/retry budgets, persistent sanitized health, no internal replay of consumed errors/partial output, bounded parsing/cancellation retained                                 |
| Quota and account routing             | One-shot catalog/groups/credits and 558 source Go gate vectors; same-principal/project old zero observations retain their original timestamp after optional failure                               |
| Pi extra tools                        | Shared consumer identity/deadlines/pool; native crawler contract retained; optional discovery/citation probes remain explicit opt-in                                                              |

No additional applicable Pi core-login/consumer blocker was identified in this
bounded review. This is not a claim of universal Go/Node equivalence or real-Google
validation. Explicit boundaries remain: single-writer local files rather than
cross-process/distributed CAS, Pi-selected account rather than the gateway weighted
pool/administration service, no background scheduler, Pi error/events rather than
HTTP gateway envelopes, and the documented Node/Go transport/clock differences.

## Remote CI snapshot

Historical snapshot from the replaced private repository: run `45004945823`
(read once, no polling; Actions records are not migrated).
Node 22.19.0, 24 and 26 all failed only the inherited `scripts/test-web-fetch.ts`
scenarioLongFence check; the other 23 legacy scripts and the first default suite
passed. That remote run covers **e04eac9**, not the later follow-up changes.
The unchanged failure was independently reproduced at the pinned Pi baseline.

## Magpie/account view follow-up (0.16.0)

- c2a `proxy/antigravity_models.go:26-431`: 34 public + 10 logical accepted
  definitions versus raw-account published/admin projections.
  `src/compat/account-catalog.ts` ports the algorithm; 334 seeded/edge vectors
  compare directly against an extracted Go oracle, with source SHA256 recorded.
- c2a `auth/store.go:12682-12699`: internal raw models excluded before projection;
  `admin/antigravity_accounts.go` and quota-detail UI count account display rows,
  not the complete compatibility definition registry. No fixed count of 27.
- Magpie `9d11d5881f2887883aa92fe95dcfd16f9718f1c7`:
  `internal/plugin/pi.js` intentionally handles providers only and drops usage;
  `internal/plugin/host.js` native `auth.usage`, `provider.models`, scoped auth
  writes, authorize/callback and Gemini fetch are exercised **without alteration**.
- `src/magpie.ts`: native root/server entry; `extensions/` preserves Pi package
  discovery. Runtime native import graph has no Pi SDK dependency (only built-in
  Node modules plus existing Undici). Magpie commands/tools were not supplied by
  its old Pi bridge; Pi commands and three optional tools remain available in Pi.
- Account view reuses only a same-family **verified** fresh checkpoint; pending
  validation can recover through Sync, never through an unverified ID token or
  fabricated quota. Failed/deleted account writes remain fenced by the host.
- Native generation persists classified HTTP/SSE health in the scoped host auth
  metadata (not Pi's account store), including monotonic shared cooldowns and
  restart recovery. It uses caller-owned account routing; it must not fail over to
  the separate Pi account registry. TLS/HTTP/platform and gateway DB boundaries
  remain as documented above.

The earlier screenshot's 46 entries cannot be fully reproduced from the pinned
loader: old plugin = 44 chat definitions + one image entry, old Pi bridge filters
image entries. Additional entries/cache origins are not established from source.
