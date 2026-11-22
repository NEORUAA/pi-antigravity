# Verification record

Execution: 2026-11-22 17:52 JST. Node v24.22.1, Yarn 4.18.0, Linux.

No dependency lifecycle scripts, personal credential reads, Google logins,
real Google upstream calls, live smoke scripts or account-risk tests were run.
All stores and fixtures were isolated inside the private implementation checkout.

| Check                                                   | Actual result                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Yarn install --immutable                                | PASS; lockfile unchanged; scripts disabled                                    |
| Source typecheck                                        | PASS                                                                          |
| Source lint                                             | PASS                                                                          |
| Original security-check                                 | PASS                                                                          |
| Prettier check                                          | PASS                                                                          |
| Default codex consumer contracts                        | PASS: 19 groups (multiple cases/group)                                        |
| Original Pi regression scripts, explicit legacy profile | 23/24 PASS                                                                    |
| Combined offline test command                           | **FAIL**, correctly returns nonzero for the baseline URL-reader failure below |

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
yarn test:codex          # Default profile; 19 synthetic contract groups
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

Not tested: real consent/token issuance/model availability; official browser/TLS
fingerprints; real quotas; cross-process file races; all arbitrary gateway
payload/schema/prompt variants. See [the parity boundaries](CODEX_PARITY.md).
