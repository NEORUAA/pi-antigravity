# Source review and local follow-up

Both source pins and licensing are recorded in [CODEX_PARITY.md](CODEX_PARITY.md).
This is a local, unpublished follow-up to the first draft PR commit, not a claim
that new code is already on GitHub.

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

Remaining **specific durability gap**: the Pi SDK returns credentials-or-error,
not both. If a token refresh succeeds but subsequent mandatory profile/project/
catalog validation fails, new credentials are not checkpointed in a DB-first
pending-revalidation record; the SDK receives an error and may require re-login.
This behavior must not be described as identical to Go's durable recovery path.
Missing project on a fresh login fails closed rather than creating an unusable
management account. See CODEX_PARITY for immediate local V2 promotion and explicit
active-account affinity vs full gateway pool scheduling. No background polling,
distributed CAS, DB/Redis or sidecar was introduced.

## Remote CI snapshot

Read once, no polling: [run 45004945823](https://github.com/NEORUAA/pi-antigravity/actions/runs/45004945823).
Node 22.19.0, 24 and 26 all failed only the inherited `scripts/test-web-fetch.ts`
scenarioLongFence check; the other 23 legacy scripts and the first default suite
passed. That remote run covers **e04eac9**, not this unpublished local revision.
The unchanged failure was independently reproduced at the pinned Pi baseline.
