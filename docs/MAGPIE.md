# Magpie: native quota and account catalog (0.16.0)

## Install / identify

1. In **your existing Magpie plugin installation entry**, use
   `https://github.com/NEORUAA/pi-antigravity` from `main`. This is a public source
   extension, not an HTTP API service or standalone executable. No base_url server
   needs to be started. No npm/release artifact is published by this change.
2. Update/reload the installed package and restart its plugin runtime. Confirm the
   installed manifest is **0.16.0**, `main: ./src/magpie.ts`, with `./server` export.
   This matters: the previous Pi bridge could run chat but discarded usage hooks.
   No particular Magpie menu name or undocumented cache path is assumed here.
3. Keep the existing Antigravity Google account if valid. Re-login is **not** the
   remedy for the previous bridge bug. Use the account's existing model-refresh /
   usage entry after reload. There is also a native Google manual-callback sign-in
   method for a browser that cannot reach the plugin machine's loopback listener.
4. Select from that account's returned chat models. A revoked/unverified account
   does not become usable through cached model metadata; failures are not full quota.

Package selection: Magpie loads the root as a **native OpenCode plugin**. The Pi
manifest/keywords/SDK peers which previously forced Magpie's Pi bridge are absent.
Pi's official package manager instead discovers **four `extensions/*.ts` wrappers**.
The root requires no runtime Pi SDK. `private: true` only blocks accidental npm
publication; it does not prevent Git installs or a local package archive.

## What the numbers mean

- The underlying snapshot is synchronized through the existing verified Google
  profile → project/tier → account catalog → quota-summary/credits pipeline.
- Magpie's usage contract takes **used percent**, not remaining fraction:
  remaining 1 becomes used 0; remaining 0 becomes used 100. The host chooses how
  its UI draws that value. Missing/stale observations remain Unknown; failures
  yield an explicit usage error, never a fabricated 100% remaining.
- Gemini and Claude/GPT group windows are associated with their actual account
  models; per-backing observed quota is used when a group summary is unavailable.
  AI credits are labeled **AI credits**, never cash or a guessed token balance.
- Model projection is ported from pinned c2a `AntigravityPublishedModelIDs`:
  34 public definitions + 10 logical compatibility definitions are **44 accepted
  definitions**, not 44 available models. Public tiers require their raw backing;
  future IDs are preserved without invented tiers/modality, internal/chat/tab,
  retired, role-backing and image-only entries are filtered. Disabled placeholders
  may appear in c2a's **admin** view, but are not dispatchable chat models.
- c2a's screenshot count of 27 is an account quota-detail row count, not a fixed
  required constant. We do not hardcode 27, 100%, or infer entitlement from a model
  definition. Native capabilities/limits use observed account metadata; unknown
  limits use the host's zero/unknown convention, not guessed future-model support.
- The earlier 46 screenshot is **not fully reproduced**: the old default path
  registered 44 chat definitions plus one image entry; the pinned Pi bridge
  filtered image entries. No unsupported explanation of the other two is asserted.

Model/usage observations briefly reuse the same verified checkpoint (30 seconds);
explicit Pi force-refresh bypasses it. Failed/pending verification must recover
through synchronization; it cannot service generation. Account selection, normal
OAuth renewal and account removal are owned by Magpie's scoped host, not Pi's
separate active-account registry. HTTP and HTTP-200 structured-error health is
retained as scoped `consumerHealth` metadata in Magpie's account, with the same
classifier/family cooldowns, preserved across usage refresh/token rotation and
restart. Native fetch neither reads/writes Pi's account pool nor switches to a different
Pi account. Pi commands and optional search/URL/image tools remain Pi extensions;
the old Magpie Pi bridge did not expose Pi commands/tools either.

## Evidence / limitations

Offline tests execute **unmodified** MIT-licensed Magpie `host.js` / `pi.js` at
[`9d11d588`](https://github.com/yetone/magpie/tree/9d11d5881f2887883aa92fe95dcfd16f9718f1c7),
including actual native loader, model refresh, auth.usage and Gemini fetch dispatch.
The Pi official 1.5.0 loader separately verifies all four conventional entries.
Independent account/admin goldens come directly from c2a Go at
[`d8e1981f`](https://github.com/james-6-23/codex2api/blob/d8e1981f1cc13d0b00fb4d4354e9c8777392319e/proxy/antigravity_models.go).
The host fixtures are tests only, retain their MIT license and are not shipped.

These are synthetic, isolated-store tests, **not** a real Google login or the
user's installed Magpie build. Actual Google quota, availability and the host's
rendering/version can differ. No lower-risk or Go TLS fingerprint equivalence is
claimed. See [verification](VERIFICATION.md) and [source boundaries](CODEX_PARITY.md).
