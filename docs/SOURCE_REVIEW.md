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

## Substantive remaining work: one-shot Sync and quota gates

`auth/antigravity_client.go:562–631` is a separate `Sync` entry point, beyond
`ExchangeOAuthAuthorizationCode` and token refresh. It does:

1. profile/entitlements (one 401-triggered refresh/revalidation);
2. `fetchQuota` (`1012–1048`), sandbox → daily → production, retry 403 without
   project once per endpoint; terminal 401; final forbidden snapshot;
3. quota-401 refresh, then **rebuild all identity-bound snapshots** before retry;
4. model/catalog/fraction-presence normalization (`1051–1103`);
5. quota groups (`1229–1271`) and AI credits (`1274–1298`), retaining unknown vs zero;
6. account entitlement/quota gates consuming those snapshots (not just HTTP 429
   cooldowns), with source TTL/reset/presence semantics.

The current Pi login/refresh performs token/profile/project provisioning but not
that complete one-shot Sync state machine. Existing explicit Pi usage commands
are not a substitute. This must not be described as merely an excluded Redis,
CAS, management UI or background-frequency feature.

Next implementation should introduce an isolated one-shot Sync service and
normalized owner-only snapshots, wire it to login/refresh or an explicitly reviewed
Pi lifecycle point, add request-level gates without installing a background polling
loop, and test: 401 principal/project replacement, 403 project-less retry/final
forbidden, 429/5xx failover, unknown fraction vs zero, reset/TTL expiry, group
integrity and negative/malformed quota. Only after that review can full application
chain completion be assessed. No real credential/upstream test is authorized here.

## Remote CI snapshot

Read once, no polling: [run 45004945823](https://github.com/NEORUAA/pi-antigravity/actions/runs/45004945823).
Node 22.19.0, 24 and 26 all failed only the inherited `scripts/test-web-fetch.ts`
scenarioLongFence check; the other 23 legacy scripts and the first default suite
passed. That remote run covers **e04eac9**, not this unpublished local revision.
The unchanged failure was independently reproduced at the pinned Pi baseline.
