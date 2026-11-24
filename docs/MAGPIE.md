# Magpie: native quota and account catalog (0.16.1 candidate)

This revision is a **local review candidate**, not yet pushed/released. The existing
GitHub `main` remains the prior version until separately approved publication.
Do not repeatedly reinstall or re-login to work around a not-yet-published fix.

## Install / identify

1. In **your existing Magpie plugin installation entry**, use
   `https://github.com/NEORUAA/pi-antigravity` from `main`. This is a public source
   extension, not an HTTP API service or standalone executable. No base_url server
   needs to be started. No npm/release artifact is published by this change.
2. Update/reload the installed package and restart its plugin runtime. Confirm the
   installed candidate manifest is **0.16.1**, `main: ./src/magpie.ts`, with `./server` export.
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
separate active-account registry. HTTP and HTTP-200 structured-error protection is
authoritative in the credential-generation checkpoint, **not** in the host's
`consumerHealth` metadata projection. Host metadata saves may interleave freely;
they cannot erase the canonical block/cooldown. Same-epoch rotation preserves it;
fresh verified consent uses a new epoch, and revoked generations cannot write it.
The journal remains single-writer per plugin runtime, not a distributed database. Native fetch neither reads/writes Pi's account pool nor switches to a different
Pi account. Pi commands and optional search/URL/image tools remain Pi extensions;
the old Magpie Pi bridge did not expose Pi commands/tools either.

## Compact provider card and usage detail

The user's later observation (multi-family usage page works, compact provider
card shows only Gemini) is consistent with Magpie's non-pool `slice(0,2)` branch;
it is **not evidence that live Claude/GPT observations were absent**. Real summary
groups now carry `pool` and real 5-hour/weekly names, with backing-model members.
The actual compact UI renders all reported pools/windows. Independently, a partial
summary no longer suppresses other models' observed quota or Unknown rows.
An uncovered backing model gets its own exact-backing pool plus detail member;
this is not a fabricated family allowance, weekly/5-hour window, or entitlement.

## Windows/Bun persistence note

The former checkpoint unconditionally opened the parent directory read-only and
fsynced it. Windows/libuv's `FlushFileBuffers` requires a write-capable handle;
this path can report `EPERM: ... fsync` even after the file fsync and rename.
The friend has now confirmed **Windows**, versus Linux on the server. That
matches this failure mechanism, but the exact stack/sole cause and completed
Google authentication are still not established. The host also fsyncs writable files.

The candidate retains exclusive `wx`/0600 file creation, mandatory **file** fsync,
atomic same-directory rename and permission checks. Only recognized unsupported
**directory** synchronization errors are explicitly downgraded with the redacted
`ANTIGRAVITY_DIRECTORY_FSYNC_UNAVAILABLE` warning. File fsync, write, chmod, rename,
EACCES, disk-full and I/O failures still fail closed. No alternate credential/log
copy or plaintext fallback is introduced. Without directory fsync, power-loss
persistence of the renamed entry is not guaranteed; a process restart and a sudden
power loss are different guarantees. Windows uses the user's existing profile
ACLs: POSIX 0600 is not a portable promise of a new Windows owner-only ACL.

Only Linux Node/Bun and injected win32 faults were tested, **not Windows hardware
or the friend's Magpie version**. OS/runtime version and a sanitized stack can
pinpoint any remaining host/file sync failure; do not rotate through more accounts.
Sources: [Microsoft FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers),
[Bun Windows libuv fsync](https://github.com/oven-sh/bun/blob/6618e7f7/src/sys/sys_uv.rs),
[libuv Windows filesystem](https://github.com/libuv/libuv/blob/v1.51.0/src/win/fs.c).

## Evidence / limitations

Offline tests execute **unmodified** MIT-licensed Magpie `host.js` / `pi.js` at
[`9d11d588`](https://github.com/yetone/magpie/tree/9d11d5881f2887883aa92fe95dcfd16f9718f1c7),
including actual native loader, model refresh, auth.usage and Gemini fetch dispatch.
Unmodified quota-card functions at the same pin are also executed; their full
source Git blob is `902bb7b7fb11747a8a1df6bc06b03f45608a238e`.
The Pi official 1.5.0 loader separately verifies all four conventional entries.
Independent account/admin goldens come directly from c2a Go at
[`d8e1981f`](https://github.com/james-6-23/codex2api/blob/d8e1981f1cc13d0b00fb4d4354e9c8777392319e/proxy/antigravity_models.go).
The host fixtures are tests only, retain their MIT license and are not shipped.

These are synthetic, isolated-store tests, **not** a real Google login or the
user's installed Magpie build. Actual Google quota, availability and the host's
rendering/version can differ. No lower-risk or Go TLS fingerprint equivalence is
claimed. See [verification](VERIFICATION.md) and [source boundaries](CODEX_PARITY.md).

## Native stream cancellation and sign-out scope (local review follow-up)

A downstream **body.cancel** now owns an internal request abort, rather than
queueing `AsyncGenerator.return()` behind a silent pending read. It interrupts
the upstream reader first, then completes iteration and removes listeners/timers
and reader locks. Caller abort also errors queued output even before its first
read. Cancellation never becomes an auth/quota penalty or an internal replay.
The initial error/status peek is preserved: before a Response exists, cancellation
uses the caller signal; body-only cancellation is tested before/after the first
**downstream** read. This distinction is not hidden by aborting the test's caller.

Pinned Magpie signOut (`host.js:1240-1245,3809-3813`) deletes host auth, forgets
its loader and emits an outgoing UI notification. It invokes **no plugin deletion
callback**. `client.auth.remove` is an operation a plugin may initiate, not a
notification of host/UI signOut; registering an invented hook cannot fix that.
The plugin therefore cannot reliably observe all idle sign-outs or perform a
uniform journal revoke/erase without changing the host or watching private files.
Neither workaround is introduced.

**Native signOut does not currently revoke/erase the checkpoint.** Locally
protected pending/verified material can remain; it must not be described as
revoked or securely erased. It is not an active host account: an explicitly
deleted key receives no native loader, and even an old loader refuses generation
when its scoped getAuth is absent. Other surviving accounts may still be selected
by the host's normal routing; that is not revival of the removed account. A fresh
OAuth login creates a separate family/epoch as appropriate and late old refresh
cannot overwrite its credentials/health. Actual host regressions cover this.
Pi's explicit remove command separately revokes its checkpoint; direct journal
revoke unit tests are not claimed as native host signOut end-to-end evidence.
