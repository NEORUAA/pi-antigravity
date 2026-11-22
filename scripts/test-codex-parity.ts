/** Offline synthetic contract tests, pinned reference in fixtures; no Google traffic. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import type { Api, Model, Context, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { provisionIdentity, selectOnboardTier } from "../src/auth/control-plane.js";
import { loginAntigravity, refreshAntigravityToken, startCallbackServer, OAuthRefreshError } from "../src/auth/oauth.js";
import { CODEX_USER_AGENT, codexSessionId, abortableDelay } from "../src/compat/profile.js";
import { antigravityHeaders, endpointCandidates, defaultUserAgent } from "../src/client/client.js";
import { executeCodexGeneration, SameEndpointBudget, quotaSignal, durationMillis } from "../src/client/codex-transport.js";
import { rememberAccount, loadAccountStore, accountAvailable, markAccountHealth } from "../src/auth/accounts.js";
import { buildRequest, streamAntigravity } from "../src/stream/stream.js";
import { ANTIGRAVITY_MODELS } from "../src/models/index.js";

process.env.ANTIGRAVITY_COMPAT_PROFILE = "codex";
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "codex-parity-"));
for (const key of ["BASE_URL", "USER_AGENT", "PROJECT_ID", "RUNTIME_MODEL", "OAUTH_ENDPOINT_MODE", "X_GOOG_USER_PROJECT_ENABLED"]) {
  delete process.env[`ANTIGRAVITY_${key}`]; delete process.env[`NOAGY_${key}`];
}
const fixture = JSON.parse(readFileSync(new URL("./fixtures/codex-parity/contracts.json", import.meta.url), "utf8"));
const savedFetch = globalThis.fetch;
const dispatcher = getGlobalDispatcher();
const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
const model = { ...ANTIGRAVITY_MODELS[0], api: "antigravity", provider: "antigravity" } as Model<Api>;
const context = { messages: [{ role: "user", content: "fixture question", timestamp: 0 }], systemPrompt: "A long system prompt. ".repeat(30) } as Context;
const build = (project: string) => buildRequest(model, context, project, {}, "gemini-fixture");
let passed = 0;
async function test(name: string, body: () => void | Promise<void>) { await body(); passed++; console.log(`PASS ${name}`); }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function callback(url: string): Promise<number> {
  return new Promise((resolve, reject) => get(url, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode ?? 0)); }).on("error", reject));
}
function tokenReply(token = "fixture-access") {
  mock.get("https://oauth2.googleapis.com").intercept({ path: "/token", method: "POST", headers: { "user-agent": CODEX_USER_AGENT } }).reply(200, { access_token: token, refresh_token: "fixture-rotated", expires_in: 3600 });
}
function profileReply(verified = true) {
  mock.get("https://www.googleapis.com").intercept({ path: "/oauth2/v2/userinfo", method: "GET", headers: { "user-agent": CODEX_USER_AGENT } }).reply(200, { ...fixture.profile, verified_email: verified });
}
try {
  await test("consistent Hub identity and endpoint modes", () => {
    assert.equal(defaultUserAgent(), fixture.userAgent);
    assert.equal(antigravityHeaders("fixture")["User-Agent"], fixture.userAgent);
    assert.deepEqual(endpointCandidates(), ["https://daily-cloudcode-pa.googleapis.com", "https://cloudcode-pa.googleapis.com"]);
    process.env.ANTIGRAVITY_OAUTH_ENDPOINT_MODE = "sandbox";
    assert.deepEqual(endpointCandidates(), ["https://daily-cloudcode-pa.sandbox.googleapis.com"]);
    delete process.env.ANTIGRAVITY_OAUTH_ENDPOINT_MODE;
  });
  await test("load then asynchronous onboard uses pinned payload/header/order", async () => {
    const calls: Array<{ url: string; body: unknown; headers: Headers }> = []; const sleeps: number[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return json(calls.length === 1 ? fixture.loadPending : calls.length === 2 ? fixture.onboardPending : fixture.onboardDone);
    }) as typeof fetch;
    const identity = await provisionIdentity("fixture", { sleep: async (ms) => { sleeps.push(ms); } });
    assert.equal(identity.projectId, "fixture-project");
    assert.deepEqual(calls[0].body, fixture.loadBody); assert.deepEqual(calls[1].body, fixture.onboardBody);
    assert.match(calls[0].url, /^https:\/\/cloudcode-pa.googleapis.com/);
    assert.match(calls[1].url, /^https:\/\/daily-cloudcode-pa.googleapis.com/);
    assert.equal(calls[1].headers.get("X-Goog-Api-Client"), "gl-node/22.21.1");
    assert.ok(calls.every((call) => call.headers.get("User-Agent") === fixture.userAgent));
    assert.deepEqual(sleeps, [2000]);
  });
  await test("load fallback only for 429/5xx and no list/fake project", async () => {
    for (const status of [429, 500, 503]) {
      let calls = 0;
      globalThis.fetch = (async () => ++calls === 1 ? json({ error: {} }, status) : json({ cloudaicompanionProject: "fallback-project" })) as typeof fetch;
      assert.equal((await provisionIdentity("fixture")).projectId, "fallback-project"); assert.equal(calls, 2);
    }
    for (const status of [400, 401, 403, 404]) {
      let calls = 0; globalThis.fetch = (async () => { calls++; return json({ error: {} }, status); }) as typeof fetch;
      await assert.rejects(provisionIdentity("fixture"), new RegExp(String(status))); assert.equal(calls, 1);
    }
  });
  await test("tier selection, caller-owned project and bounded polling", async () => {
    assert.equal(selectOnboardTier({ currentTier: { id: "paid" }, allowedTiers: [{ id: "default", is_default: true }] }), "default");
    assert.equal(selectOnboardTier({ currentTier: { id: "paid" } }), "paid"); assert.equal(selectOnboardTier({}), "free-tier");
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return json(calls === 1 ? fixture.loadPending : fixture.onboardPending); }) as typeof fetch;
    await assert.rejects(provisionIdentity("fixture", { sleep: async () => {} }), /pending/); assert.equal(calls, 11);
    globalThis.fetch = (async (_url, init) => { const body = JSON.parse(String(init?.body)); assert.equal(body.metadata.duetProject, "caller-project"); return json({ currentTier: { id: "enterprise" } }); }) as typeof fetch;
    assert.equal((await provisionIdentity("fixture", { userProjectId: "caller-project" })).projectId, "caller-project");
  });
  await test("loopback random-port callback checks state, path and cancellation", async () => {
    const local = await startCallbackServer("fixture-state");
    assert.match(local.redirectUri ?? "", /^http:\/\/127\.0\.0\.1:\d+\/oauth-callback$/);
    try {
      const waiting = local.waitForCode();
      assert.equal(await callback(`${local.redirectUri}?code=fixture-code&state=fixture-state`), 200);
      assert.deepEqual(await waiting, { code: "fixture-code", state: "fixture-state" });
    } finally { local.cleanup(); }
    const invalid = await startCallbackServer("expected");
    const waiting = invalid.waitForCode();
    const rejection = assert.rejects(waiting, /state mismatch/);
    assert.equal(await callback(`${invalid.redirectUri}?code=fixture-code&state=wrong`), 400);
    await rejection; invalid.cleanup();
  });
  await test("full OAuth URL PKCE/offline/consent/openid and verified identity", async () => {
    tokenReply(); profileReply();
    globalThis.fetch = (async () => json({ cloudaicompanionProject: "fixture-project", currentTier: { id: "free-tier" } })) as typeof fetch;
    let auth: URL | undefined; let callbackFinished: Promise<number> | undefined;
    const credentials = await loginAntigravity({ onAuth: ({ url }) => {
      auth = new URL(url); const params = auth.searchParams;
      assert.equal(params.get("include_granted_scopes"), "true"); assert.equal(params.get("prompt"), "consent");
      assert.equal(params.get("access_type"), "offline"); assert.equal(params.get("code_challenge_method"), "S256");
      assert.ok(params.get("scope")?.split(" ").includes("openid"));
      assert.notEqual(params.get("state"), params.get("code_challenge"));
      callbackFinished = callback(`${params.get("redirect_uri")}?code=fixture-code&state=${params.get("state")}`);
    } } as OAuthLoginCallbacks);
    assert.equal(await callbackFinished, 200); assert.ok(auth); assert.equal(credentials.projectId, "fixture-project");
    assert.equal(credentials.email, fixture.profile.email);
    assert.ok(credentials.expires > Date.now() + 54 * 60_000 && credentials.expires < Date.now() + 56 * 60_000);
  });
  await test("OAuth provider error and unverified profile fail closed", async () => {
    await assert.rejects(loginAntigravity({ onAuth: ({ url }) => { const auth = new URL(url); void callback(`${auth.searchParams.get("redirect_uri")}?error=access_denied&state=${auth.searchParams.get("state")}`); } } as OAuthLoginCallbacks), /access_denied/);
    tokenReply("unverified-access"); profileReply(false);
    await assert.rejects(refreshAntigravityToken({ access: "old", refresh: "unverified-refresh", expires: 0 }), /verified email/);
  });
  await test("parallel refresh single-flight/rotation/revalidated identity", async () => {
    tokenReply("refreshed-fixture"); profileReply(); let loads = 0;
    globalThis.fetch = (async () => { loads++; return json({ cloudaicompanionProject: "new-identity-project" }); }) as typeof fetch;
    const previous = { access: "old", refresh: "parallel-fixture-refresh", expires: 0, projectId: "old-project", idToken: "old-id" };
    const results = await Promise.all(Array.from({ length: 8 }, () => refreshAntigravityToken(previous)));
    assert.equal(loads, 1); assert.ok(results.every((result) => result === results[0]));
    assert.equal(results[0].projectId, "new-identity-project"); assert.equal(results[0].refresh, "fixture-rotated"); assert.equal(results[0].idToken, undefined);
  });
  await test("permanent structured OAuth error vs transient and retry cleanup", async () => {
    for (const [status, code, permanent] of [[400, "invalid_grant", true], [503, "server_error", false]] as const) {
      mock.get("https://oauth2.googleapis.com").intercept({ path: "/token", method: "POST" }).reply(status, { error: code });
      await assert.rejects(refreshAntigravityToken({ access: "old", refresh: `error-${code}`, expires: 0 }), (error) => error instanceof OAuthRefreshError && error.permanent === permanent);
    }
  });
  await test("negative int64 session matches reference SHA-256 and no CLI labels", () => {
    const seed = "first_user_text:fixture question";
    const digest = createHash("sha256").update(`codex2api:antigravity:session\0${seed}`).digest();
    assert.equal(codexSessionId([{ role: "user", parts: [{ text: "fixture question" }] }]), `-${digest.readBigUInt64BE(0) & 0x7fffffffffffffffn}`);
    const request = build("fixture-project"); assert.match(request.requestId, /^agent\/\d+\/[a-f0-9]{8}$/);
    assert.equal(request.request.labels, undefined); assert.equal(request.request.generationConfig?.maxOutputTokens, undefined);
    assert.ok(request.request.systemInstruction, "long native systemInstruction is not automatically folded");
  });
  await test("RPC duration and exact shared same-endpoint budgets", () => {
    assert.equal(durationMillis("4m50s"), 290_000); assert.equal(durationMillis("0.201506475s"), 201.506475);
    assert.equal(durationMillis({ seconds: "1", nanos: 500_000_000 }), 1500);
    const capacity = JSON.stringify({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "MODEL_CAPACITY_EXHAUSTED" }] } });
    const budget = new SameEndpointBudget(); for (let i = 0; i < 8; i++) assert.equal(budget.delay(503, capacity), 1000); assert.equal(budget.delay(503, capacity), undefined);
    const rate = JSON.stringify({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RATE_LIMIT_EXCEEDED" }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0.1s" }] } });
    assert.equal(budget.delay(429, rate), 100); assert.equal(budget.delay(429, rate), 100); assert.equal(budget.delay(429, rate), undefined);
    assert.equal(quotaSignal(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}')?.kind, "rate");
  });
  await test("transport/5xx/404 fallback, stable request/session and terminal 401/403", async () => {
    for (const status of [408, 404, 500, 502, 503, 504]) {
      const bodies: string[] = []; let calls = 0;
      await executeCodexGeneration({ credentials: { token: "dispatch", projectId: "fixture-project" }, model: "gemini-fixture", build, send: async (_url, init) => { bodies.push(String(init.body)); return ++calls === 1 ? json({ error: {} }, status) : json({}); } });
      assert.equal(calls, 2); assert.equal(bodies[0], bodies[1]);
    }
    for (const status of [400, 401, 403]) {
      let calls = 0; await assert.rejects(executeCodexGeneration({ credentials: { token: "not-stored", projectId: "fixture-project" }, model: "gemini-fixture", build, send: async () => { calls++; return json({ error: {} }, status); } }), new RegExp(String(status))); assert.equal(calls, 1);
    }
    let calls = 0;
    await executeCodexGeneration({ credentials: { token: "transport", projectId: "fixture-project" }, model: "gemini-fixture", build, send: async () => { if (++calls === 1) throw new Error("fixture transport"); return json({}); } });
    assert.equal(calls, 2);
  });
  await test("optional user-project header removed once on 403", async () => {
    process.env.ANTIGRAVITY_X_GOOG_USER_PROJECT_ENABLED = "true"; const headers: Headers[] = [];
    await executeCodexGeneration({ credentials: { token: "header", projectId: "fixture-project" }, model: "gemini-fixture", build, send: async (_url, init) => { headers.push(new Headers(init.headers)); return headers.length === 1 ? json({ error: {} }, 403) : json({}); } });
    assert.equal(headers[0].get("x-goog-user-project"), "fixture-project"); assert.equal(headers[1].get("x-goog-user-project"), null);
    delete process.env.ANTIGRAVITY_X_GOOG_USER_PROJECT_ENABLED;
  });
  await test("abort stops retry budget immediately", async () => {
    const controller = new AbortController(); let calls = 0;
    const pending = executeCodexGeneration({ credentials: { token: "cancel", projectId: "fixture-project" }, model: "gemini-fixture", build, signal: controller.signal,
      send: async () => { calls++; return json({ error: { details: [{ "@type": "google.rpc.ErrorInfo", reason: "MODEL_CAPACITY_EXHAUSTED" }] } }, 503); },
      sleep: async (ms, signal) => { controller.abort(new Error("fixture cancelled")); return abortableDelay(ms, signal); } });
    await assert.rejects(pending, /cancelled/); assert.equal(calls, 1);
  });
  await test("quota account failover, family isolation, monotonic cooldown and private storage", async () => {
    rememberAccount({ email: "a@example.invalid", access: "account-a", refresh: "fixture-a", expires: Date.now() + 3600_000, projectId: "project-a" });
    rememberAccount({ email: "b@example.invalid", access: "account-b", refresh: "fixture-b", expires: Date.now() + 3600_000, projectId: "project-b" });
    let calls = 0;
    await executeCodexGeneration({ credentials: { token: "account-a", projectId: "project-a" }, model: "gemini-fixture", build, send: async (_url, init) => {
      calls++; const token = new Headers(init.headers).get("Authorization");
      return token === "Bearer account-a" ? json({ error: { details: [{ "@type": "google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" }] } }, 429) : json({});
    } });
    assert.equal(calls, 3); assert.equal(accountAvailable("account-a", "gemini-other"), false); assert.equal(accountAvailable("account-a", "gemini-4-argon-high"), true);
    const before = loadAccountStore().accounts["a@example.invalid"].health?.cooldowns?.["gemini:shared"];
    markAccountHealth("account-a", "gemini-other", { cooldownMs: 100 }); assert.equal(loadAccountStore().accounts["a@example.invalid"].health?.cooldowns?.["gemini:shared"], before);
    assert.equal(statSync(join(process.env.PI_CODING_AGENT_DIR!, "antigravity-accounts.json")).mode & 0o777, 0o600);
  });
  await test("SSE multiline, malformed events, truncation and no replay after emitted output", async () => {
    const options = { apiKey: JSON.stringify({ token: "sse-fixture", projectId: "fixture-project" }) };
    const text = `data: {"response":\ndata: ${JSON.stringify(fixture.generation.response)}}\n\n`;
    globalThis.fetch = (async () => new Response(text)) as typeof fetch;
    const output = await streamAntigravity(model, context, options).result(); assert.equal(output.stopReason, "stop", output.errorMessage);
    for (const response of ["data: not-json\n\n", 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}}\n\n']) {
      let calls = 0; globalThis.fetch = (async () => { calls++; return new Response(response); }) as typeof fetch;
      const result = await streamAntigravity(model, context, options).result(); assert.equal(result.stopReason, "error"); assert.equal(calls, 1);
    }
  });

  await test("pinned fixed/logical model tiers and tool schema/replay contracts", async () => {
    const { resolveCodexModel, codexThinking, CODEX_CATALOG } = await import("../src/compat/catalog.js");
    const { functionNameMap, codexToolSchema } = await import("../src/compat/request.js");
    assert.equal(CODEX_CATALOG.length, 44);
    assert.equal(resolveCodexModel("gemini-4-argon-low", "high")?.wire, "gemini-4-argon-high");
    assert.equal(resolveCodexModel("gemini-4-argon-low", "high")?.level, "low");
    assert.equal(resolveCodexModel("gemini-3.7-flash")?.budget, 8192);
    assert.equal(resolveCodexModel("gemini-4-neon", "xhigh")?.wire, "gemini-4-neon-xhigh");
    assert.deepEqual(codexThinking("gemini-4-argon-low", "gemini-4-argon-high", "high"), { thinkingLevel: "LOW" });
    assert.throws(() => resolveCodexModel("gemini-3.5-flash"), /retired/);
    const schema = codexToolSchema({ type: "OBJECT", properties: { choice: { type: ["STRING", "null"], enum: ["a", "b"] }, list: { type: "array" } }, required: ["choice", "missing"] });
    assert.deepEqual(schema.required, ["choice"]);
    assert.deepEqual((schema.properties as Record<string, unknown>).list, { type: "array", items: { type: "string" } });
    assert.deepEqual(codexToolSchema({}).required, ["reason"]);
    const names = functionNameMap(["a b", "a_b"]);
    assert.notEqual(names["a b"], names.a_b); assert.ok(Object.values(names).every((name) => name.length <= 64));
    const replayContext = { messages: [
      { role: "user", content: "use tool", timestamp: 0 },
      { role: "assistant", provider: "other", model: "other", content: [{ type: "toolCall", id: "call", name: "a b", arguments: {} }], stopReason: "toolUse", timestamp: 1 },
      { role: "toolResult", toolCallId: "call", toolName: "a b", content: [{ type: "text", text: "fixture result" }, { type: "image", mimeType: "image/png", data: "Zml4dHVyZQ==" }], isError: false, timestamp: 2 },
    ], tools: [{ name: "a b", description: "fixture", parameters: { type: "object", properties: {} } }] } as Context;
    const replay = buildRequest(model, replayContext, "fixture-project", {}, "gemini-fixture");
    const calls = replay.request.contents.flatMap((turn) => turn.parts).filter((part) => "functionCall" in part);
    assert.equal(calls.length, 1); assert.equal(calls[0].thoughtSignature, "skip_thought_signature_validator");
    const results = replay.request.contents.flatMap((turn) => turn.parts).filter((part) => "functionResponse" in part);
    assert.equal(results[0].functionResponse.parts?.length, 1);
  });
  await test("401 refresh revalidates identity once, then refuses repeated 401", async () => {
    process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "codex-401-"));
    rememberAccount({ email: fixture.profile.email, access: "401-old", refresh: "401-refresh", expires: Date.now() + 3600_000, projectId: "old-project" });
    tokenReply("401-new"); profileReply();
    globalThis.fetch = (async () => json({ cloudaicompanionProject: "new-project" })) as typeof fetch;
    let calls = 0;
    await executeCodexGeneration({ credentials: { token: "401-old", projectId: "old-project" }, model: "gemini-fixture", build,
      send: async (_url, init) => {
        calls++; if (calls === 1) return json({ error: {} }, 401);
        assert.equal(new Headers(init.headers).get("Authorization"), "Bearer 401-new");
        assert.equal(JSON.parse(String(init.body)).project, "new-project"); return json({});
      } });
    assert.equal(calls, 2);
    assert.equal(loadAccountStore().accounts[fixture.profile.email].access, "401-new");
    tokenReply("401-newer"); profileReply(); calls = 0;
    await assert.rejects(executeCodexGeneration({ credentials: { token: "401-new", projectId: "new-project" }, model: "gemini-fixture", build,
      send: async () => { calls++; return json({ error: {} }, 401); } }), /401/);
    assert.equal(calls, 2);
  });
  await test("permanent account fences and all-account exhaustion are finite", async () => {
    process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "codex-health-"));
    rememberAccount({ email: "blocked@example.invalid", access: "blocked-token", refresh: "blocked-refresh", expires: Date.now() + 3600_000, projectId: "fixture-project" });
    let calls = 0;
    await assert.rejects(executeCodexGeneration({ credentials: { token: "blocked-token", projectId: "fixture-project" }, model: "gemini-fixture", build,
      send: async () => { calls++; return json({ error: { details: [{ reason: "VALIDATION_REQUIRED" }] } }, 403); } }), /403/);
    assert.equal(calls, 1); assert.equal(accountAvailable("blocked-token", "gemini-fixture"), false);
    process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "codex-exhaustion-"));
    for (const id of ["one", "two"]) rememberAccount({ email: `${id}@example.invalid`, access: `exhaust-${id}`, refresh: `fixture-${id}`, expires: Date.now() + 3600_000, projectId: "fixture-project" });
    calls = 0;
    await assert.rejects(executeCodexGeneration({ credentials: { token: "exhaust-one", projectId: "fixture-project" }, model: "gemini-fixture", build,
      send: async () => { calls++; return json({ error: { details: [{ "@type": "google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" }] } }, 429); } }), /429/);
    assert.equal(calls, 4, "two endpoints each, two accounts, no recursive cycles");
  });
  mock.assertNoPendingInterceptors();
} finally { globalThis.fetch = savedFetch; setGlobalDispatcher(dispatcher); await mock.close(); }
console.log(`Codex default-profile offline contracts: ${passed} groups passed`);
