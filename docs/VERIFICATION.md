# Verification record

Local final review: 2026-11-22 19:10 JST. Node v24.22.1, Yarn 4.18.0, Linux.

No dependency lifecycle scripts, personal credential reads, Google logins,
real Google upstream calls, live smoke scripts or account-risk tests were run.
All stores and fixtures were isolated inside local implementation checkouts.
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
| Durable checkpoint / actual restart                     | PASS: 18 groups, including quarantine, subject changes, abort, atomic cleanup, deletion and stale SDK recovery                  |
| Original Pi regression scripts, explicit legacy profile | 23/24 PASS                                                                                                                      |
| Combined offline test command                           | **FAIL**, correctly returns nonzero for the baseline URL-reader failure below                                                   |

The tested implementation ends at `9e730068137545288a327e3378048b1a14f7b8ee`;
subsequent release/public-fork documentation edits do not change runtime code.
Publication target: the public native fork `NEORUAA/pi-antigravity`, branch `main`.
Migration merge `7ed8fd7` and all implementation commits remain in its history.
The old independent private repository's PR/Actions records are not migrated. One-shot Sync/gates and the
previously missing pending-checkpoint/restart lifecycle are implemented. See [SOURCE_REVIEW.md](SOURCE_REVIEW.md) for the
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
yarn test:codex          # 19 contracts + 714/558 Go vectors + 24 application + 11 Sync + 18 checkpoint/restart groups
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

Historical private-repository run `45004945823` (record not migrated)
was read once; Node 22.19.0, 24 and 26 each failed only the same inherited
scenarioLongFence test. Other legacy scripts and the original default consumer
suite passed. This run covers `e04eac9`, not the later follow-up changes.
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

## Public fork recreation

The public native fork preserves the complete migration commit history, MIT
license and pinned source provenance. Before publication every migration commit
tree was scanned for credential-shaped values and private runtime paths; no
personal credentials or runtime stores were found. Built-in public OAuth client
configuration is not a user credential. Only committed source/docs/tests are
pushed, never local caches. `package.json` remains `private: true` solely to
prevent npm publication. Public-fork acceptance reruns the same offline suite;
its inherited URL-reader failure remains a failure, not a suppressed green result.

Public-fork local rerun: 2026-11-22 22:14 JST. All 32 command groups ran;
only the unchanged baseline URL-reader script failed. Typecheck/lint/security
and all five new suites passed. Runtime source is unchanged from `7ed8fd7`.

## Magpie/account-catalog acceptance — 2026-11-24 JST

Version **0.16.0**, Node 24.22.1, Yarn 4.18.0, Bun 1.4.4. This section
supersedes earlier runtime-end statements for the account-view follow-up.

- Default contracts: 19 groups PASS; existing Go request/schema vectors: 714 PASS;
  existing quota-gate vectors: 558 PASS; application: 24 groups PASS; Sync: 11
  PASS; durable checkpoint/restart: 18 PASS.
- New account/public/admin projection: **334 independent pinned-Go vectors PASS**
  plus internal/disabled/forbidden/logical backing eligibility cases. Generator:
  `python3 scripts/generate-account-model-oracle.py /path/to/codex2api-at-d8e1981f`.
- New **9 actual-host/Pi-loader integration groups PASS**: unmodified pinned MIT
  Magpie native loader/usage dispatcher/model refresh; official Pi four-entry
  discovery/loading; distinct/parallel account quota and models; missing/unknown/
  403/temporary profile failures; pending verification recovery without re-login;
  unverified imported cache rejection; restart; expired refresh/token rotation;
  manual and real loopback OAuth callbacks; invalid state cleanup; in-flight
  deletion fence; Gemini streaming/nonstreaming; tool-name restoration; wrong
  account model rejection; before/after-output errors with no replay; cancellation;
  scoped durable HTTP-200 quota health across usage refresh/restart without Pi
  account-registry writes. Host fixture Git blobs are checked against provenance.
- Typecheck/lint/security/format PASS; dependency install was scripts-disabled;
  workspace lockfile changes only remove the two Pi SDK peer entries (SDK stays
  a development dependency). CI explicitly installs pinned Bun for the real-host
  test; that test is not silently skipped when Bun is missing.
- Package dry-run includes native root/server and all four Pi wrappers; excludes
  test fixtures/runtime stores/caches. No package/archive/release was published.
- Original legacy tests remain **23/24 PASS**, only unchanged `scenarioLongFence`
  fails. Complete `node scripts/verify-offline.mjs` runs **34 command groups** and
  correctly exits nonzero for that baseline failure; this is not an all-green run.

The first application contract was intentionally changed from “44 model entries
without OAuth” to “44 definitions do not establish availability; no OAuth yields
zero discovered account models.” It is independently backed by source goldens
and real host refresh checks, not a relaxation to hide an unrelated failure.
All Google calls in these tests are synthetic endpoint fixtures. Bun's fixture
preload denies unrecognized hosts/RPCs; Node suites keep the offline guard and
MockAgent. No personal auth store, real login/quota or user Magpie build was used.
No account-risk reduction is verified. Prior platform/DB boundaries remain.

## Independent native audit repair — local 0.16.1 candidate (2026-11-24 JST)

**Not pushed, not in a PR, not merged. Awaiting independent review.** The older
0.16.0 nine host groups above passed but omitted the audit's real concurrency,
native-conversion and compact-UI counterexamples; they did not establish parity.

Current bounded run: `node scripts/verify-offline.mjs` = **40/41 groups PASS**,
exit 1 solely for the unchanged legacy `scenarioLongFence` (`test-web-fetch.ts:502`,
`read-url-content.ts:120`, provenance character budget). Both files are unchanged
from the base and Pi pin; no test/workflow/gate was weakened to hide it.

- Typecheck, lint, security-check, full Prettier check: PASS.
- Existing default 19 / Go schema-request 714 / quota gate 558 / account/admin
  334 / application 24 / Sync 11 / durable pending/restart 18: retained PASS.
- **212 new genuine original-Go native vectors PASS**: full request normalization,
  native schema aliases, explicit thinking, roles/grouped parallel results/images,
  signature aliases, function-name collision/choice paths, usage/nonstream finish,
  terminal aliases/blocks/truncation, raw JSON-mode and countTokens envelopes.
  Generator: `scripts/native-oracle.py`; exact source/dependency/adapters recorded
  in `scripts/fixtures/native-oracle-provenance.json`. Normal tests need no Go/network.
- Expanded **10 real-host/Pi-loader groups PASS**. Among them 22 original-Go
  request goldens go through the unmodified Magpie native loader; real fetch checks
  cover missing finishReason vs nonstream STOP, legitimate promptFeedback, usage,
  countTokens, raw-order Claude schema conversion, separate OTHER finish, own-tool
  passthrough and unsupported-schema HTTP 400. Nine distinct streamed scenarios
  assert exactly nine upstream dispatches (no output/error replay).
- Three new real unmodified-host race groups PASS: VALIDATION_REQUIRED and quota
  arriving during refresh remain **403/429** after rotation, after a deliberately
  later metadata overwrite, and after an actual process restart. Sign-out during
  renewal leaves the account absent. Epoch-journal cases additionally verify
  temporary pending rotation, throwing-update atomicity, fresh consent/revocation
  fencing, per-account isolation, legacy-metadata adoption and corrupt health data.
- Actual host→**unmodified same-pin compact UI functions** PASS: Gemini and
  Claude/GPT four real windows visible, partial summary preserves other backing
  allowances/Unknown, detail members retained, errors do not show full quota.
  UI Git blob `902bb7b7fb11747a8a1df6bc06b03f45608a238e` verified read-only on GitHub;
  extracted function bytes are hash-checked and retain Magpie's MIT license.
- **71 directory/file durability fault cases PASS**: win32 directory-open/fsync
  EPERM is isolated from POSIX EPERM and real EACCES/EIO/ENOSPC/EROFS/EBADF;
  mandatory file flush and write/rename/chmod failures fail closed. An unsupported
  directory flush retains a genuinely file-fsynced recoverable **pending**, not
  usable, rotated tuple and emits a redacted capability warning. This is injected
  cross-platform testing on Linux, not actual Windows/NTFS/Bun hardware validation.
- `npm pack --dry-run --ignore-scripts`: 0.16.1, **82 files**, native root/server,
  new runtime helpers and **four Pi wrappers**; no scripts/fixtures/stores/cache.
  No archive/release/tag/npm publication was performed. The package remains private
  to accidental npm publication, while its GitHub fork remains public.

Short targeted reruns: `yarn test:native` (seven new groups), `yarn test:codex`
(all consumer/native groups). Full default runner preserves all legacy failures.
Runtime remains Node 24.22.1 / Bun 1.4.4 on Linux; no personal token/store or real
Google request was used. The friend has since confirmed Windows (server Linux). The EPERM report is
consistent with the former directory fsync path, but its exact stack/sole cause
and completed Google login remain unproven.

Remaining boundaries: single-writer local journal (no cross-process distributed
CAS), host-owned account selection/keep-alive, no gateway UI/DB/Redis/external
OpenAI/Anthropic server, no Go TLS/HTTP wire fingerprint equivalence, no real
Google entitlement/risk or user's installed host/Windows build verification.
No perfection or lower-ban-risk conclusion follows from these offline results.

### Second-review follow-up — 2026-11-24 JST (local only)

The independent 1520951 review did not approve publication: although prior
counterexamples passed, its body.cancel-only fixture exposed a new P2. The same
independent fixture failed locally before the follow-up and now passes without
aborting its original caller signal. `test-native-cancel.ts` expands it to **17**
cases, including watchdog on/off, cancel before/after downstream read, initial
upstream silence with caller abort, network failures before/after output, empty
EOF, legal finish and cancel-after-finish, original abort with unread output,
concurrent request isolation, no replay, released upstream locks, removed caller
listeners, no unhandled rejections, no quota/auth penalties and stale-loader
rejection after host auth disappears. The initial first-frame/error peek still
requires caller abort until a downstream Response exists; this is explicit.

The actual unmodified-host deletion race now also holds an old refresh, signs out
its specific key, confirms **no loader/no dispatch but journal retained**, performs
fresh verified OAuth consent, then releases the old token response. The new
family/epoch/credentials/health remain intact; no fabricated signOut callback or
claim of native checkpoint revocation is made. Host routing to other existing
accounts is distinct from reviving a deleted key.

The full offline runner now has **42 groups** (41 PASS and the same untouched
scenarioLongFence FAIL). The eight new native groups remain in the normal runner;
Bun is mandatory for the original-repro test, not silently skipped. Existing Go
212/714/558/334 vectors, Pi/default/legacy/host/UI/checkpoint suites are retained.
See `.cache/review-cancel-full.log` / per-group logs for this local run. No real
Google, user credentials, remote updates, release, npm publish or host edits.
