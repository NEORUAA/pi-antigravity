import { getEventListeners } from "node:events";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
/** Offline application/state-machine regressions independent of the implementation's assertions. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
process.env.ANTIGRAVITY_COMPAT_PROFILE = "codex";
for (const name of ["BASE_URL", "USER_AGENT", "PROJECT_ID", "RUNTIME_MODEL", "OAUTH_ENDPOINT_MODE", "X_GOOG_USER_PROJECT_ENABLED", "SOURCE_ENRICH", "DYNAMIC_DISCOVERY"]) { delete process.env[`ANTIGRAVITY_${name}`]; delete process.env[`NOAGY_${name}`]; }
const { rememberAccount, loadAccountStore, accountAvailable, markAccountHealth } = await import("../src/auth/accounts.js");
const { streamAntigravity, buildRequest } = await import("../src/stream/stream.js");
const { ANTIGRAVITY_MODELS } = await import("../src/models/models.js");
const { CODEX_CATALOG } = await import("../src/compat/catalog.js");
const { consumerEvents } = await import("../src/client/consumer-sse.js");
const { consumerBlockReason, observeConsumerFailure, quotaSignal, durationMillis } = await import("../src/client/codex-transport.js");
const { piToolSchema } = await import("../src/compat/schema.js");
const { codexSessionId } = await import("../src/compat/profile.js");
const { executeAntigravitySearch } = await import("../src/search/search.js");
const { generateAntigravityImageContent } = await import("../src/image/image.js");
const { refreshAntigravityModels } = await import("../src/models/discovery.js");
const model = { ...ANTIGRAVITY_MODELS.find((item) => item.id === "gemini-3.8-flash"), api: "antigravity", provider: "antigravity" } as Model<Api>;
const context: Context = { messages: [{ role: "user", content: "fixture question", timestamp: 0 }] };
const originalFetch = globalThis.fetch;
let groups = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); groups++; console.log(`PASS ${name}`); }
function fresh() { process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "codex-application-")); }
function account(token = "fixture-a", email = "a@example.invalid", projectId = "project-a") { rememberAccount({ access: token, refresh: `refresh-${token}`, expires: Date.now() + 3_600_000, email, projectId }); }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function errorBody(code: number, reason?: string) { return { error: { code, status: code === 429 ? "RESOURCE_EXHAUSTED" : "PERMISSION_DENIED", message: "Synthetic upstream failure", details: reason ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] : [] } }; }
assert.equal(consumerBlockReason(403, JSON.stringify(errorBody(403, "VALIDATION_REQUIRED"))), "VALIDATION_REQUIRED");
assert.equal(consumerBlockReason(403, JSON.stringify({error: {message: "Permission denied", metadata: {label: "TOS_VIOLATION"}}})), undefined);
function sse(documents: unknown[]) { return new Response(documents.map((document) => `data: ${JSON.stringify(document)}\n\n`).join("")); }
const delta = { response: { candidates: [{ content: { parts: [{ text: "already emitted" }] } }] } };
try {
  await test("pinned definitions do not advertise availability without an OAuth account", async () => {
    assert.deepEqual(ANTIGRAVITY_MODELS.map((item) => item.id), CODEX_CATALOG.map((item) => item.id));
    fresh(); let requests = 0; globalThis.fetch = (async () => { requests++; throw new Error("Unexpected network discovery"); }) as typeof fetch;
    const result = await refreshAntigravityModels({ stored: {}, allowNetwork: true, signal: new AbortController().signal, credential: { type: "api_key", key: JSON.stringify({ token: "fixture-a", projectId: "project-a" }) }, force: false, publish: async () => {} } as Parameters<typeof refreshAntigravityModels>[0]);
    assert.equal(requests, 0); assert.equal(result.length, 0);
  });
  await test("schema adapter preserves literal Pi parameter names (documented Go bug compatibility exception)", () => {
    const properties = Object.fromEntries(["type", "format", "$defs", "required", "enum", "properties", "description"].map((name) => [name, { type: "string", enum: ["a", "b"] }]));
    const result = piToolSchema({ type: "object", properties, required: Object.keys(properties) });
    assert.deepEqual(Object.keys(result.properties as object), Object.keys(properties));
    for (const value of Object.values(result.properties as Record<string, { type: string; description: string }>)) { assert.equal(value.type, "string"); assert.equal(value.description, "Allowed: a, b"); }
    assert.deepEqual(result.required, Object.keys(properties));
  });
  await test("scaffolding and nested tool-result normalization precede session hashing; code bytes opaque", () => {
    const request = buildRequest(model, { ...context, systemPrompt: "You are Codex, an agent based on GPT-5. Help.\n```\nOpenCode\n```", messages: [{ role: "user", content: "[OpenMausBot: generated]\nreal question", timestamp: 0 }] }, "project-a", {}, "gemini-3.8-flash-tiered");
    assert.equal(request.request.sessionId, codexSessionId([{ role: "user", parts: [{ text: "real question" }] }]));
    const text = request.request.systemInstruction?.parts.map((part) => part.text).join("\n") ?? "";
    assert.match(text, /You are Antigravity, a large language model built by Google/); assert.ok(text.includes("```\nOpenCode\n```"));
  });
  await test("tool collision names normalize once after payload hook and reverse to exact Pi names", async () => {
    fresh(); let sent: Record<string, any> | undefined;
    globalThis.fetch = (async (_url, init) => { sent = JSON.parse(String(init?.body)); return sse([{ response: { candidates: [{ content: { parts: [{ functionCall: { name: "a_b_eebd4769fc73", args: {} } }] }, finishReason: "STOP" }] } }]); }) as typeof fetch;
    let hookName = "";
    const result = await streamAntigravity(model, { ...context, tools: [{ name: "a b", description: "first", parameters: { type: "object", properties: {} } }, { name: "a_b", description: "second", parameters: { type: "object", properties: {} } }] }, { apiKey: JSON.stringify({ token: "unstored", projectId: "project-a" }), onPayload: (payload) => { hookName = (payload as any).request.tools[0].functionDeclarations[0].name; } }).result();
    assert.equal(hookName, "a b"); assert.equal(sent?.request.tools[0].functionDeclarations[0].name, "a_b_eebd4769fc73"); assert.notEqual(sent?.request.tools[0].functionDeclarations[1].name, "a_b");
    assert.equal(result.content.find((part) => part.type === "toolCall")?.name, "a b");
  });
  for (const afterOutput of [false, true]) for (const [status, reason] of [[403, "VALIDATION_REQUIRED"], [429, "QUOTA_EXHAUSTED"], [503, "MODEL_CAPACITY_EXHAUSTED"], [500, undefined], [401, undefined]] as const) {
    await test(`HTTP200 SSE ${status}/${reason ?? "generic"} ${afterOutput ? "after" : "before"} output: health + no replay`, async () => {
      fresh(); account(); let calls = 0;
      globalThis.fetch = (async () => { calls++; return sse([...(afterOutput ? [delta] : []), errorBody(status, reason)]); }) as typeof fetch;
      const result = await streamAntigravity(model, context, { apiKey: JSON.stringify({ token: "fixture-a", projectId: "project-a" }) }).result();
      assert.equal(result.stopReason, "error"); assert.equal(calls, 1);
      const outcome = loadAccountStore().accounts["a@example.invalid"].health?.lastFailure;
      assert.equal(outcome?.status, status); assert.equal(outcome?.model, "gemini-3.8-flash-tiered");
      if (status === 500) assert.equal(outcome?.kind, "upstream");
      if (status === 401) assert.equal(outcome?.kind, "auth");
      if (afterOutput) assert.ok(result.content.some((part) => part.type === "text" && part.text === "already emitted"));
      assert.equal(accountAvailable("fixture-a", "gemini-3.8-flash-tiered"), ![403, 429, 503].includes(status));
      if (reason === "QUOTA_EXHAUSTED") assert.equal(accountAvailable("fixture-a", "gemini-other"), false);
      if (reason === "MODEL_CAPACITY_EXHAUSTED") assert.equal(accountAvailable("fixture-a", "gemini-other"), true);
    });
  }
  await test("SSE health uses switched account, not the original token/project", async () => {
    fresh(); account(); account("fixture-b", "b@example.invalid", "project-b"); let calls = 0;
    globalThis.fetch = (async (_url, init) => { calls++; const headers = new Headers(init?.headers); if (headers.get("Authorization") === "Bearer fixture-a") return json(errorBody(429, "QUOTA_EXHAUSTED"), 429); assert.equal(JSON.parse(String(init?.body)).project, "project-b"); return sse([errorBody(403, "TOS_VIOLATION")]); }) as typeof fetch;
    const result = await streamAntigravity(model, context, { apiKey: JSON.stringify({ token: "fixture-a", projectId: "project-a" }) }).result();
    assert.equal(result.stopReason, "error"); assert.equal(calls, 3); assert.equal(loadAccountStore().accounts["b@example.invalid"].health?.blockedReason, "TOS_VIOLATION"); assert.equal(loadAccountStore().accounts["a@example.invalid"].health?.blockedReason, undefined);
  });
  await test("quota scopes/unknown reason fallback/retry-after and no family overcooling", () => {
    fresh(); account(); const body = JSON.stringify(errorBody(429, "RATE_LIMIT_EXCEEDED")); observeConsumerFailure("fixture-a", "gemini-a", 429, body);
    assert.equal(accountAvailable("fixture-a", "gemini-a"), false); assert.equal(accountAvailable("fixture-a", "gemini-b"), true);
    const before = loadAccountStore().accounts["a@example.invalid"].health!.cooldowns!["gemini-a"];
    markAccountHealth("fixture-a", "gemini-a", { cooldownMs: 1000 }); assert.equal(loadAccountStore().accounts["a@example.invalid"].health!.cooldowns!["gemini-a"], before);
    assert.equal(quotaSignal(429, JSON.stringify({ error: { message: "quota exhausted", details: [{ "@type": "google.rpc.ErrorInfo", reason: "UNKNOWN_NEW_REASON" }] } }))?.kind, "quota");
    observeConsumerFailure("fixture-a", "gemini-c", 429, JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), new Headers({ "retry-after": "2" }));
    const delay = loadAccountStore().accounts["a@example.invalid"].health!.cooldowns!["gemini-c"] - Date.now(); assert.ok(delay > 1500 && delay <= 2000);
  });
  await test("search shares Hub headers/session/transport and makes no citation probes by default", async () => {
    fresh(); let calls = 0;
    globalThis.fetch = (async (url, init) => { calls++; assert.match(String(url), /^https:\/\/daily-cloudcode-pa.googleapis.com\/v1internal:generateContent$/); const body = JSON.parse(String(init?.body)); assert.match(body.requestId, /^agent\/\d+\/[a-f0-9]{8}$/); assert.match(body.request.sessionId, /^-\d+$/); assert.equal(new Headers(init?.headers).get("User-Agent"), "antigravity/hub/2.19.1 windows/amd64"); return json({ response: { candidates: [{ content: { parts: [{ text: "fixture synthesis" }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.invalid/source", title: "Source" } }] } }] } }); }) as typeof fetch;
    assert.match(await executeAntigravitySearch({ apiKey: JSON.stringify({ token: "unstored", projectId: "project-a" }), query: "fixture" }), /fixture synthesis/); assert.equal(calls, 1);
  });
  await test("search and images never replay a 200 structured error as model/endpoint fallback", async () => {
    for (const image of [false, true]) { fresh(); account(); let calls = 0; globalThis.fetch = (async () => { calls++; return json(errorBody(403, "VALIDATION_REQUIRED")); }) as typeof fetch;
      await assert.rejects(image ? generateAntigravityImageContent({ apiKey: JSON.stringify({ token: "fixture-a", projectId: "project-a" }), prompt: "fixture" }) : executeAntigravitySearch({ apiKey: JSON.stringify({ token: "fixture-a", projectId: "project-a" }), query: "fixture" }), /403/);
      assert.equal(calls, 1); assert.equal(accountAvailable("fixture-a", "any-model"), false);
    }
  });
  await test("source quota reason precedence and Go duration spellings", () => {
    for (const [reason, expected] of [["RATE_LIMIT_EXCEEDED", "rate"], ["QUOTA_EXHAUSTED", "quota"], ["UNKNOWN_NEW_REASON", "capacity"]]) {
      assert.equal(quotaSignal(429, JSON.stringify({ error: { message: "previous MODEL_CAPACITY_EXHAUSTED", details: [{ "@type": "google.rpc.ErrorInfo", reason }] } }))?.kind, expected);
    }
    for (const [text, expected] of [[" +.5s ", 500], ["1.s", 1000], ["1μs", .001], ["0", 0], ["-0s", 0], ["1.123456789s", 1123.456789]] as const) assert.equal(durationMillis(text), expected);
    for (const text of ["-1s", "3garbage", "9223372036854775808ns"]) assert.equal(durationMillis(text), undefined);
  });
  await test("native payload hook keeps non-function tools and normalizes response schema separately from tool schema", async () => {
    fresh(); let sent: any;
    globalThis.fetch = (async (_url, init) => { sent = JSON.parse(String(init?.body)); return sse([{ response: { candidates: [{ content: { parts: [{ text: "fixture answer" }] }, finishReason: "STOP" }] } }]); }) as typeof fetch;
    const result = await streamAntigravity(model, context, { apiKey: JSON.stringify({ token: "unstored", projectId: "project-a" }), onPayload: (payload) => {
      const body = (payload as any).request;
      body.tools = [{ googleSearch: {} }];
      body.generationConfig = { ...body.generationConfig, maxOutputTokens: 1234, responseJsonSchema: { type: "object", properties: { choice: { type: "string", enum: ["a", "b"] } } } };
    } }).result();
    assert.equal(result.stopReason, "stop", result.errorMessage); assert.deepEqual(sent.request.tools, [{ googleSearch: {} }]);
    assert.deepEqual(sent.request.generationConfig.responseSchema, { type: "object", properties: { choice: { type: "string", enum: ["a", "b"] } } });
    assert.equal(sent.request.generationConfig.responseJsonSchema, undefined); assert.equal(sent.request.generationConfig.maxOutputTokens, undefined);
    assert.equal(sent.request.systemInstruction, undefined, "No source-unrelated fallback persona/preamble injection");
  });
  await test("concurrent refresh keeps health updates and does not resurrect a removed account", async () => {
    const previous = getGlobalDispatcher(); const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
    const { refreshAccountAfterUnauthorized, removeAccount } = await import("../src/auth/accounts.js");
    try {
      for (const remove of [false, true]) {
        fresh(); account();
        mock.get("https://oauth2.googleapis.com").intercept({ path: "/token", method: "POST" }).reply(200, { access_token: "fixture-refreshed", refresh_token: "fixture-rotated", expires_in: 3600 }).delay(20);
        if (!remove) mock.get("https://www.googleapis.com").intercept({ path: "/oauth2/v2/userinfo", method: "GET" }).reply(200, { email: "a@example.invalid", verified_email: true, id: "fixture-id" });
        globalThis.fetch = (async () => json({ cloudaicompanionProject: "project-a" })) as typeof fetch;
        const pending = refreshAccountAfterUnauthorized("fixture-a");
        if (remove) await new Promise(resolve=>setImmediate(resolve));
        if (remove) await removeAccount("a@example.invalid"); else markAccountHealth("fixture-a", "gemini-a", { block: "TOS_VIOLATION" });
        const refreshed = await pending;
        if (remove) { assert.equal(refreshed, undefined); assert.equal(Object.keys(loadAccountStore().accounts).length, 0); }
        else { assert.equal(refreshed?.token, "fixture-refreshed"); assert.equal(loadAccountStore().accounts["a@example.invalid"].health?.blockedReason, "TOS_VIOLATION"); }
      }
      mock.assertNoPendingInterceptors();
    } finally { setGlobalDispatcher(previous); await mock.close(); }
  });
  await test("same-frame safety/invalid finish never emits its text or tool call", async () => {
    fresh(); let calls = 0;
    for (const reason of ["SAFETY", "MALFORMED_FUNCTION_CALL"]) {
      globalThis.fetch = (async () => { calls++; return sse([{ response: { candidates: [{ content: { parts: [{ text: "must not escape" }, { functionCall: { name: "fixture", args: {} } }] }, finishReason: reason }] } }]); }) as typeof fetch;
      const result = await streamAntigravity(model, context, { apiKey: JSON.stringify({ token: "unstored", projectId: "project-a" }) }).result();
      assert.equal(result.stopReason, "error"); assert.equal(result.content.length, 0);
    }
    assert.equal(calls, 2);
  });
  await test("consumer deadlines remove abort listeners after consume/cancel/error/abort", async () => {
    const { fetchWithHeaderDeadline } = await import("../src/client/consumer-fetch.js");
    for (const mode of ["consume", "cancel", "error", "abort"] as const) {
      const controller = new AbortController();
      if (mode === "error") await assert.rejects(fetchWithHeaderDeadline("https://fixture.invalid", {}, controller.signal, 1000, 1000, async () => { throw new Error("fixture transport error"); }), /fixture transport/);
      else {
        const response = await fetchWithHeaderDeadline("https://fixture.invalid", {}, controller.signal, 1000, 1000, async () => mode === "abort" ? new Response(new ReadableStream()) : new Response("fixture body"));
        if (mode === "consume") await response.text();
        else if (mode === "cancel") await response.body?.cancel();
        else { controller.abort(new Error("fixture cancelled")); await assert.rejects(response.text(), /fixture cancelled/); }
      }
      assert.equal(getEventListeners(controller.signal, "abort").length, 0, `${mode} leaked an abort listener`);
    }
  });
  await test("shared SSE parser accepts multiple events >8MiB in one chunk, cancels on DONE and malformed events", async () => {
    const frame = `data: ${JSON.stringify({ response: { text: "x".repeat(4 * 1024 * 1024) } })}\n\n`;
    let count = 0; for await (const _document of consumerEvents(new Response(frame.repeat(3)))) count++; assert.equal(count, 3);
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); }, cancel() { cancelled = true; } }));
    for await (const _document of consumerEvents(response)) assert.fail("DONE must not emit content"); assert.equal(cancelled, true);
    await assert.rejects(async () => { for await (const _document of consumerEvents(new Response("data: {broken}\n\n"))) {} }, /Invalid.*SSE/);
  });
} finally { globalThis.fetch = originalFetch; }
console.log(`PASS ${groups} application/state-machine groups`);
