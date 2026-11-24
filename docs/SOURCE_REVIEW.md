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
- Historical 0.16.0 attempted to persist classified HTTP/SSE health in scoped
  host auth metadata; independent review proved its refresh race unsafe. The
  0.16.1 correction below replaces that authority with the generation journal. It uses caller-owned account routing; it must not fail over to
  the separate Pi account registry. TLS/HTTP/platform and gateway DB boundaries
  remain as documented above.

The earlier screenshot's 46 entries cannot be fully reproduced from the pinned
loader: old plugin = 44 chat definitions + one image entry, old Pi bridge filters
image entries. Additional entries/cache origins are not established from source.

## Independent native audit repair — local 0.16.1 candidate

The earlier nine host groups passed but **missed substantive native defects**.
The independent audit reproduced refreshed-away VALIDATION_REQUIRED/cooldowns,
partial SSE reported as successful EOF, explicit thinking overwrite, parallel
response/image grouping, signature aliases, forced tool-choice renaming, missing
usage restoration, and a compact quota-card pool-contract omission. Its original
counterexamples were run before changes, then retained in regression tests. The
user's usage-page/compact-card difference is a presentation contract defect; the
partial-summary fallback is a separate offline finding, not asserted live data.

| Original pinned c2a / host source                                                                  | Candidate implementation and independent evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `antigravity_gemini.go:140-260,372-538` native normalize/wrap, scaffolding and native schema rules | `compat/native-gemini.ts`; **212 original-Go vectors** cover full envelopes/normalization, not a TS self-oracle; 22 request vectors additionally traverse the real host. Pi intentionally retains its typed SDK/property-name schema adaptation.                                                                                                                                                                                                                                                                                                                                 |
| `antigravity_gemini.go:263-363,539-825`; `antigravity_function_names.go:112-291`                   | Shared `compat/gemini-parts.ts` handles parallel results/images, roles and camel/snake/nested signature semantics; both paths rename forced-tool selectors. Native name extraction, duplicate declarations, schema aliases and response-name paths match source vectors.                                                                                                                                                                                                                                                                                                         |
| `antigravity_gemini.go:827-1050` native unwrap/usage/finish/SSE                                    | `cpaUsageMetadata` restored; nonstream missing camel finishReason gets STOP; stream must have genuine finishReason/promptFeedback terminal. Empty/truncated/structured-error/cancel cannot turn into success or trigger internal replay.                                                                                                                                                                                                                                                                                                                                         |
| `antigravity_gemini.go:65-137` countTokens                                                         | Same consumer dispatch; count-specific stripped envelope, non-Claude leading-user rule and bounded response unwrap; actual-host test plus original Go envelope vectors.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `antigravity_json_mode.go:21-215` Claude schema mode                                               | Original raw args spelling/order retained by weak JSON metadata; json_mode text conversion, thought retention, other-text removal, stream-wide OTHER→STOP, declared-own-tool exemption, nested tool_choice rejection. Original-Go frame vectors plus actual-host integration. New Go/gjson tooling is development-only; no sidecar/runtime dependency.                                                                                                                                                                                                                           |
| `auth/store.go:13157-13166,13268-13297`; Magpie `renewLocked:3247-3293`                            | Canonical generation-journal health survives same-epoch pending rotation and any host auth-object merge order. Synchronous read/check/merge/atomic rename contains no await; one-time 0.16.0 metadata adoption cannot clear canonical protection or re-poison a fresh epoch. Captured epoch cannot write after fresh consent/revocation; a health write does not clobber pending credentials or advance the rotation revision. Actual unmodified-host 403/429 races, late metadata save and real restart stay blocked; deletion during renewal does not revive the host account. |
| Magpie `host.js:3348-3353,3411-3431`, `app.js:14451-15019`; c2a quota cells/detail/model-list      | Actual host→unmodified UI regression shows both real pools/four windows, partial-summary model allowances and Unknown, and model detail retention. No inferred family quota, 27-model target, or fabricated full quota.                                                                                                                                                                                                                                                                                                                                                          |
| Checkpoint file→directory fsync path; Windows FlushFileBuffers access contract                     | `auth/directory-sync.ts`: mandatory file sync and atomic rename retained; narrowly recognized directory capability failure is warned, not confused with file/disk/permission failure. 71 cross-platform injected failure cases; no Windows hardware claim.                                                                                                                                                                                                                                                                                                                       |

The genuine native Go oracle copies the pinned pure source kernels, with original
`gjson` v1.18.0 (original go.sum checksums). Explicit deterministic adapters are
listed in `scripts/fixtures/native-oracle-provenance.json`: request/session IDs,
expose-thoughts=true, and no gateway administrator redirects. Session hash/ID
behavior retains prior independent vectors. Normal tests use committed goldens;
regeneration requires the isolated dev dependency cache and pinned source checkout.

### Bounded review / remaining non-equivalence

- OAuth/PKCE/state/code exchange, durable pending rotation/restart/identity checks,
  load/onboard/tier/catalog/quota, UA/headers/session/body reuse, consumer retry and
  endpoint rules retain their earlier protocol/state-machine evidence. New repairs
  add native counterparts rather than replacing these with only Pi tests.
- The journal is a **single-writer process** checkpoint, not cross-process CAS.
  Magpie serializes its own renewal/save and rechecks token identity/deletion;
  its metadata projection is not journal authority. Do not share the same checkpoint
  path between independent plugin processes and claim distributed race protection.
- Magpie chooses request accounts/background keep-alive; Pi uses its active account
  and request-level health/failover. No gateway DB/Redis/scheduler, management UI,
  external OpenAI/Anthropic server entry, server model redirects or background
  quota polling is installed. Pi optional tools are not new native Magpie tools.
- JS JSON objects are semantically compared except JSON-mode text, where raw args
  are preserved. No Go wire-byte/TLS/HTTP2/OS proxy equivalence or live entitlement,
  host-build, Windows hardware, crash-power-loss or reduced account-risk claim.
- The inherited long-fence URL-reader failure is unrelated, unchanged and visible.
  This candidate remains local awaiting independent review; no push/PR/merge.

## Second local review: body cancellation / lifecycle precision

Independent review of `1520951` passed its prior counterexamples but found one
additional P2: after one frame, `reader.cancel()` queued `iterator.return()` behind
a silent `next()` and did not cancel upstream until external abort/watchdog. The
reviewer's independently authored native fixture reproduced false/false for
cancel-settled/upstream-cancelled before this repair (preserved `.cache/cancel-before.log`).

- `magpie.ts`: each native request now owns an AbortController linked to the
  original signal; body.cancel first aborts it, then returns the iterator. Output
  abort is handled even with an unread queued first chunk. Every terminal path
  removes linked listeners; cancel does not persist failure or retry a request.
- `consumer-sse.ts`: optional cancellation directly cancels a pending reader and
  checks abort before yielding buffered lines. This also works when watchdogs
  are disabled or a synthetic fetch does not itself observe its signal.
- `consumer-fetch.ts`: the body guard releases its underlying reader on EOF,
  network error, caller abort and downstream cancellation, after pending reads
  settle; stale scheduled pulls cannot read an already-released reader.
- Source counterpart remains c2a `antigravity_gemini.go:945-949`: Close closes the
  upstream source, not an await of a future SSE event. No wire/TLS claim is made.
- `scripts/test-native-cancel.ts` extends the independent native repro into
  **17** body-only/initial silence/before-after downstream read/network/EOF/finish/
  original abort/isolation/no-replay/lock/listener/health/stale-auth cases. It does
  not call host abort RPC or external abort to make a body.cancel case pass.

The pinned host has no signOut plugin callback. Its `removeAuth:1240-1245` and
`signOut:3809-3813` only mutate host auth/cache and send outbound notifications;
`client.auth.remove:1409-1412` is a callable operation, not a lifecycle subscription.
No fictitious hook, host patch or credential-file watcher is installed. Thus
native signOut leaves protected journal material retained, **not journal-revoked**.
Actual-host tests now explicitly assert this distinction, the deleted key has no
loader, a stale native loader without scoped auth cannot dispatch, and explicit
fresh consent fences an older held token response. Retained checkpoint records
are not active accounts. Pi explicit remove still has its real revoke path.

Friend OS is now confirmed Windows, server Linux; directory-fsync evidence remains
fault-injection on Linux, not a Windows device test or sole-cause/auth-success proof.
All report dates/times use JST. These follow-ups remain local for second review.

## 0.16.2 local Argon projection repair (awaiting independent review)

Two **presentation/projection** defects were reproduced using the actual pinned
Magpie host + unmodified UI, not inferred from successful internal snapshots:
`usageView` permanently excluded Argon from Gemini summary scope, and `modelView`
reused the raw high backing's displayName for each public tier. Real 0.16.1
usage-page data for the other families was already present; this is not a new
claim that the user's live service omitted those families.

Source evidence and implementation:

- c2a `auth/antigravity_quota_family.go:20-22,25-59,68-109` defines shared Argon
  fallback to Gemini when no recognized-window Argon bucket is present.
  `modelQuotaFamily` is now shared between gate and UI; each reported group's
  recognized bucket IDs establish coverage. It resolves public aliases to their
  backing before scope/grouping. No percentage equality heuristic, blanket model
  deletion or guessed windows. Unknown-family buckets do not establish invented
  UI coverage. Existing conservative quota-gate enforcement remains unchanged.
- c2a `frontend/src/lib/antigravityQuota.ts:summarizeQuotaGroups` renders the
  actual summary groups; raw per-model detail is not evidence of a new separate
  quota family. Covered backing details are retained as members of the real pool.
- c2a `proxy/antigravity_models.go` / native normalize→convert→wrap maps all
  `gemini-4-argon-low/medium/high` to `gemini-4-argon-high`, with distinct native
  thinking levels; the existing request mapping is correct. The label projection
  now takes a known explicit public tier from the catalog, not the backing label.
  Unknown models retain their existing identity/label semantics.
- The live c2a HEAD was read-only pinned as
  `fb03ccd3d14eba9d962616f60841ad0a037e6f08` (9 commits after audited `d8e1981`).
  GitHub compare shows none of the above quota-family, quota-summary or model
  implementation files changed. No floating upgrade or new upstream behavior is
  claimed. Original source and MIT/README-license provenance above still apply.

Independent expectations: `scripts/argon-source-oracle.py` compiles original Go
family/scope/window functions for 30 coverage masks (merged/dedicated/invalid
window/unknown family). `scripts/native-oracle.py` adds 75 Argon request/count
vectors: **287 total**, retaining every one of the original 212 input/expected
pairs unchanged. Actual host-native capture checks the generated wire and request,
including explicit camel/snake thinking precedence. The actual host/UI test
checks dedicated→merged refresh in-process and across persisted restart, absence
of the stale group, independent-account partial-summary allowances/Unknown, and
six labels in two shared-backing tier families. No real Google call occurred.

Unchanged boundaries: no zero-risk/perfect-equivalence claim; no Go TLS/HTTP2
fingerprint emulation or gateway/DB port; native host sign-out still has no
supported plugin callback to erase its inaccessible checkpoint residue. The
user reports Windows login now works, while our own cross-platform fsync testing
remains fault injection, not Windows hardware testing.

### 5c18f61 follow-up: project bucket scope all the way into the consumer

Independent review found the helper correctly implemented the original Go scope,
but usage projection incorrectly unioned the entire group's families. The native
`usageView` now projects **each bucket** with that scope. Same-group windows share
a pool only when their exact model sets match. Group identity and model-set
identity, not displayName alone, define the projection unit. Human pool labels
are disambiguated for mixed/same-name scopes; fallback labels also get unique
identities to avoid accidental UI suppression. Original bucket order is retained.
Unknown bucket families establish no invented model coverage. Recognized family
membership for an unrecognized window is exactly the source scope, but that raw
window gets no fabricated rolling duration; Argon fallback detection still
requires recognized summary windows, exactly as in original Go.

Because Magpie `poolWindows` associates detail members **only by pool string**,
backing rows are now emitted into every actual matching pool with that pool's
member subset. A final-group overwrite cannot silently remove earlier members.
Uncovered model aliases retain real reported or Unknown fallback pools, and
empty groups establish no coverage. No model wire/thinking conversion, OAuth,
health, persistence, host code or upstream code was changed in this follow-up.

Original Go `antigravityQuotaScopeForModel(..., false)` expectations are compiled
for the actual fixture layouts by `scripts/argon-source-oracle.py` into
`quota-host-oracle.json`: 18 layouts, 144 masks. The regression runs each through
the unmodified SHA-verified host and UI and compares both per-bucket `models`
and real rendered pool `members`. This closes the previous helper-only gap,
including the audited Argon `[false,true]` / ordinary Gemini `[true,false]`
counterexample. It is still an offline compatibility test, not proof of the
user's live group layout, reduced account risk or perfect equivalence.

Oracle adapter is explicit in the fixture provenance: UI coverage uses the Go
function's `known && scope(bucket)`. For an unknown model family Go returns
`ScopeAll, false` as a conservative **enforcement** fallback; that is not evidence
that its quota is shared with every reported UI pool. The unknown model instead
retains its independent Unknown/model detail. Known models' per-bucket scopes
are the original Go result. Quota-gate conservative behavior is unchanged.
