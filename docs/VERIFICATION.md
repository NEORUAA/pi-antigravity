# Verification record

Local final review: 2026-11-22 18:59 JST (unpublished). Node v24.22.1, Yarn 4.18.0, Linux.

No dependency lifecycle scripts, personal credential reads, Google logins,
real Google upstream calls, live smoke scripts or account-risk tests were run.
All stores and fixtures were isolated inside the private implementation checkout.
The runner overrides inherited OAuth configuration with synthetic client values.

| Check                                                   | Actual result                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Yarn install --immutable                                | PASS; lockfile unchanged; scripts disabled                                                                                      |
| Source typecheck                                        | PASS                                                                                                                            |
| Source lint                                             | PASS                                                                                                                            |
| Original security-check                                 | PASS                                                                                                                            |
| Prettier check                                          | PASS                                                                                                                            |
| Default codex consumer contracts                        | PASS: 19 groups (multiple cases/group)                                                                                          |
| Independent pinned-Go differential vectors              | PASS: 714 vectors; 32 oracle executions; one source-nondeterministic malformed-schema case explicitly records observed variants |
| Application/state-machine regressions                   | PASS: 24 groups, including before/after-output errors, switched identity, refresh races, native hook and tool transport         |
| Independent Go quota-gate differentials                 | PASS: 558 source-extracted vectors                                                                                              |
| One-shot Sync lifecycle                                 | PASS: 11 groups; source stage order/recovery, snapshot semantics, concurrent removal                                            |
| Durable checkpoint / actual restart                     | PASS: 17 groups, including quarantine, subject changes, abort, atomic cleanup, deletion and stale SDK recovery                  |
| Original Pi regression scripts, explicit legacy profile | 23/24 PASS                                                                                                                      |
| Combined offline test command                           | **FAIL**, correctly returns nonzero for the baseline URL-reader failure below                                                   |

All follow-up revisions are local only. No second push, merge, new PR or PR readiness
change was made. One-shot Sync/gates and the previously missing pending-checkpoint/
restart lifecycle are implemented. See [SOURCE_REVIEW.md](SOURCE_REVIEW.md) for the
bounded final source trace and explicit Pi/platform adaptations. Passing offline
fixtures do not establish live upstream behavior or lower account risk.

## Existing URL-reader failure

`scripts/test-web-fetch.ts` fails in `scenarioLongFence` at line 502:
“The character budget is too small for page provenance.”

It was reproduced with the same Node, locked dependencies, isolated paths and
network guard in a detached worktree at untouched Pi baseline
`67706dd5fcc0a710f69f89412a6867673c58a684` before pushing. The stack points to the
same `src/features/read-url-content.ts:120`. Neither that implementation nor its
test was changed to hide the failure. Therefore this run is **not all-green**,
even though the failure is present before this migration.

## Reproduce without credentials

```bash
yarn install --immutable
yarn test:codex          # 19 contracts + 714/558 Go vectors + 24 application + 11 Sync + 17 checkpoint/restart groups
yarn test                # Source checks + original legacy-profile scripts + new contracts
yarn format:check
```

The runner writes local logs/results under ignored `.cache/`, substitutes an empty
HOME/auth directory, and preloads `scripts/offline-guard.mjs`. The preloader blocks
unmocked non-loopback fetches and disables external Undici connections; tests
explicitly supply MockAgent interceptors or local/in-memory mock responses.
The original scripts are run under `ANTIGRAVITY_COMPAT_PROFILE=pi` because their
assertions intentionally require the old CLI labels, retry session mutation and
capacity sibling routing. They do **not** establish new-profile equivalence by
themselves; that is why the separate default-profile suite exists.

## Independent source oracle

Optional regeneration (Go toolchain required only for this development command):

```bash
python3 scripts/reference-oracle.py /path/to/codex2api-at-d8e1981f
python3 scripts/quota-reference-oracle.py /path/to/codex2api-at-d8e1981f
# If not automatically formatted, run yarn prettier --write scripts/fixtures/codex-parity/reference.json
```

The generator verifies the source commit, records SHA256 hashes and extracts only
reviewed standard-library functions. It does not start codex2api, fetch modules,
log in, invoke its scripts or send network requests. Normal test runs read committed
golden fixtures and need no Go toolchain. One malformed input yields multiple
upstream Go-map-order results; only **actually observed** variants are accepted,
not TypeScript-generated expectations.

## Remote CI snapshot (first revision only)

[Run 45004945823](https://github.com/NEORUAA/pi-antigravity/actions/runs/45004945823)
was read once; Node 22.19.0, 24 and 26 each failed only the same inherited
scenarioLongFence test. Other legacy scripts and the original default consumer
suite passed. This run covers `e04eac9`, not the unpublished local revision.
No remote retry or polling loop was started.

## Covered default-profile cases

- Shared Hub UA, host policy and overrides; real local random-port callback.
- OAuth openid/offline/consent/PKCE/state URL; provider denial and state mismatch;
  verified-profile enforcement; token error classification; parallel refresh,
  token rotation and identity/project rebuilding.
- loadCodeAssist payload/host order, 429/5xx fallback, terminal 4xx, no fake/list
  project; pending/done onboarding, bounded calls and enterprise tier selection.
- 44 pinned model definitions, fixed/logical reasoning, schema normalization,
  colliding function names, missing-signature tool replay and tool image parts.
- Stable request/session on generation fallback; 408/404/5xx and transport errors;
  terminal 400/401/403; x-goog-user-project retry removal; caller cancellation.
- Structured quota durations and retry budgets, family cooldown monotonicity,
  Argon isolation, account exhaustion and validation fences; private file modes.
- A remembered account's forced 401 refresh and project replacement; a repeated
  401 stops. Multiline SSE, malformed events, truncation and no internal replay
  after partial output.
- System/conversation/product normalization, exact code-block preservation,
  Unicode/CRLF/Go whitespace semantics, switches and recursive tool values.
- Full schema/ref/union kernel and the separately tested Pi property-name adaptation;
  native response-schema cleaning; Unicode/colliding tool names and payload hooks.
- Source SSE framing/status inference (bare, array, unprefixed continuation), bounded
  per-event not per-chunk sizing, DONE cancellation, same-frame safety rejection.
- HTTP-200 error health before/after output, current switched identity, no JSON/SSE
  model-fallback replay, no citation or catalog probes without explicit opt-in.
- Refresh preserves concurrent account fences and cannot resurrect a removed account;
  quota reason precedence and Go duration spellings.

Not tested: real consent/token issuance/model availability; official browser/TLS
fingerprints; real quotas; cross-process file races; all arbitrary gateway
payload/schema/prompt variants. See [the parity boundaries](CODEX_PARITY.md).
