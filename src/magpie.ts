import {
  consumerLease,
  initializeConsumerHealth,
  consumerHealth,
  updateConsumerHealth,
  type ConsumerLease,
} from "./auth/checkpoint.js";
/** Native OpenCode/Magpie hooks. Uses Magpie's documented Gemini provider API;
 * no local server, host patch or Pi-SDK runtime dependency. Pi uses extensions/. */
import { loginAntigravity, refreshAntigravityToken, getApiKey } from "./auth/oauth.js";
import { observeAccount } from "./auth/account-view.js";
import { accountModelIds, accountSupportsModel } from "./compat/account-catalog.js";
import { CODEX_CATALOG, resolveCodexModel, codexModelDisplayName } from "./compat/catalog.js";
import { codexRequestId } from "./compat/profile.js";
import {
  normalizeNativeGeminiRequest,
  nativeTerminal,
  unwrapNative,
  nativeJSONModeRejection,
  nativeCountTokensRequest,
  unwrapNativeCountTokens,
  claudeJSONMode,
  rewriteJSONModeFrame,
} from "./compat/native-gemini.js";
import { parseApiKey } from "./client/client.js";
import { consumerFetch } from "./client/consumer-fetch.js";
import { consumerEvents } from "./client/consumer-sse.js";
import {
  executeCodexGeneration,
  GenerationHTTPError,
  observeConsumerDocument,
  observeConsumerFailure,
  readConsumerJson,
} from "./client/codex-transport.js";
import {
  quotaGate,
  bucketFamily,
  modelQuotaFamily,
  normalizeWindow,
} from "./auth/quota-snapshot.js";
import { safeError } from "./utils/security.js";
import { isCreditsEnabled } from "./utils/credits.js";
import { isRecord } from "./utils/util.js";
import type { AntigravityOAuthCredentials, GeminiRequestBody } from "./types/types.js";
const ID = "antigravity";
type GetAuth = () => Promise<unknown>;
type Input = {
  client: { auth: { set: (value: { path: { id: string }; body: unknown }) => Promise<unknown> } };
};
const credential = (value: unknown): AntigravityOAuthCredentials => {
  if (
    !isRecord(value) ||
    value.type !== "oauth" ||
    typeof value.access !== "string" ||
    typeof value.refresh !== "string"
  )
    throw new Error("Antigravity requires its Google OAuth sign-in");
  return value as AntigravityOAuthCredentials;
};
const save = async (input: Input, next: AntigravityOAuthCredentials) => {
  await input.client.auth.set({ path: { id: ID }, body: { ...next, type: "oauth" } });
};
async function observed(input: Input, getAuth: GetAuth, signal?: AbortSignal) {
  const old = credential(await getAuth());
  const verified = await observeAccount(old, signal);
  return serializeAccount(verified.subject ?? verified.refresh, async () => {
    const value = await getAuth();
    if (
      !isRecord(value) ||
      value.type !== "oauth" ||
      !(
        (value.access === old.access && value.refresh === old.refresh) ||
        (value.access === verified.access && value.refresh === verified.refresh)
      )
    )
      throw new Error("Account changed while synchronizing; refresh again");
    initializeConsumerHealth(verified, isRecord(old) ? old.consumerHealth : undefined);
    const next = { ...verified, consumerHealth: consumerHealth(consumerLease(verified)) };
    if (JSON.stringify(value) !== JSON.stringify({ ...next, type: "oauth" }))
      await save(input, next);
    return next;
  });
}
const healthFlights = new Map<string, Promise<void>>();
async function serializeAccount<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = healthFlights.get(key) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(work),
    barrier = result.then(
      () => {},
      () => {},
    );
  healthFlights.set(key, barrier);
  try {
    return await result;
  } finally {
    if (healthFlights.get(key) === barrier) healthFlights.delete(key);
  }
}
const family = (model: string) =>
  model.startsWith("gemini-")
    ? model.includes("argon")
      ? "gemini:argon"
      : "gemini:shared"
    : model;
async function recordFailure(
  _input: Input,
  _getAuth: GetAuth,
  c: AntigravityOAuthCredentials,
  model: string,
  error: unknown,
  lease?: ConsumerLease,
) {
  if (!(error instanceof GenerationHTTPError) || !lease) return;
  updateConsumerHealth(lease, (health) =>
    observeConsumerFailure(
      c.access,
      model,
      error.status,
      error.body,
      error.headers,
      (_token, _model, update) => {
        if (update.block) health.blockedReason = update.block;
        if (update.failure) health.lastFailure = update.failure;
        if (update.cooldownMs) {
          health.cooldowns ??= {};
          const shared = model.startsWith("gemini-")
            ? family(model)
            : update.quotaModel
              ? family(update.quotaModel)
              : model;
          for (const id of [model, ...(update.familyQuota ? [shared] : [])])
            health.cooldowns[id] = Math.max(
              health.cooldowns[id] ?? 0,
              Date.now() + update.cooldownMs,
            );
        }
      },
    ),
  );
}
function usageView(c: AntigravityOAuthCredentials) {
  const q = c.quota,
    ids = q ? accountModelIds(q) : [];
  const out: {
    user?: string;
    plan?: string;
    balance?: string;
    error?: string;
    windows: Array<Record<string, unknown>>;
  } = { user: c.email, plan: c.identity?.paidTier?.id ?? c.identity?.currentTier?.id, windows: [] };
  if (!q) {
    out.error = "Quota data unavailable";
    return out;
  }
  if (q.forbidden) {
    out.error = "Quota access denied";
    return out;
  }
  if (q.aiCreditsObserved && typeof q.aiCredits === "number" && Number.isFinite(q.aiCredits))
    out.balance = String(q.aiCredits) + " AI credits";
  const pools = new Map<string, string>();
  for (const group of q.groupsObserved ? q.groups : []) {
    const pool = group.displayName;
    const families = new Set(
      group.buckets
        .filter((b) => normalizeWindow(b.window))
        .map((b) => bucketFamily(b.bucketId))
        .filter(Boolean),
    );
    const scope = ids.filter((id) =>
      families.has(modelQuotaFamily(q, resolveCodexModel(id)?.wire ?? id)),
    );
    if (group.buckets.length) for (const id of scope) pools.set(id, pool);
    for (const bucket of group.buckets) {
      const known =
        bucket.fractionPresent &&
        typeof bucket.remainingFraction === "number" &&
        Number.isFinite(bucket.remainingFraction) &&
        Date.now() - bucket.observedAt <= bucket.ttlSeconds * 1000;
      out.windows.push({
        name:
          bucket.window === "5h"
            ? "5 hours"
            : bucket.window === "weekly"
              ? "1 week"
              : bucket.window,
        pool,
        models: scope,
        ...(known
          ? { used: (1 - Math.max(0, Math.min(1, bucket.remainingFraction!))) * 100 }
          : { display: "Unknown" }),
        resetsAt: bucket.resetTime || undefined,
        span: bucket.window === "5h" ? 18000 : bucket.window === "weekly" ? 604800 : undefined,
      });
    }
  }
  // Always emit observed/backing model rows, including models missing quota.
  // Real summary pools supersede their member rows in the compact card. A raw
  // backing without a summary is its own model pool, NEVER an invented 5h/week.
  const backing = new Map<string, string[]>();
  for (const id of ids) {
    const wire = resolveCodexModel(id)?.wire ?? id;
    backing.set(wire, [...(backing.get(wire) ?? []), id]);
  }
  for (const [wire, models] of backing) {
    const m = q.models.find((row) => row.modelId === wire),
      pool = pools.get(models[0]);
    const known =
      m?.fractionPresent &&
      typeof m.remainingFraction === "number" &&
      Number.isFinite(m.remainingFraction) &&
      Date.now() - q.updatedAt <= 300000;
    out.windows.push({
      name: pool ? m?.displayName || wire : "Reported quota",
      pool: pool ?? (m?.displayName || wire),
      ...(pool
        ? {
            family: /^gemini/i.test(wire)
              ? "Gemini"
              : /^claude/i.test(wire)
                ? "Claude"
                : /^gpt/i.test(wire)
                  ? "GPT"
                  : wire,
          }
        : {}),
      models,
      ...(known
        ? { used: (1 - Math.max(0, Math.min(1, m.remainingFraction!))) * 100 }
        : { display: "Unknown" }),
      resetsAt: m?.resetTime || undefined,
    });
    if (!pool) {
      const summary = out.windows.at(-1)!;
      out.windows.push({
        ...summary,
        name: m?.displayName || wire,
        family: /^gemini/i.test(wire)
          ? "Gemini"
          : /^claude/i.test(wire)
            ? "Claude"
            : /^gpt/i.test(wire)
              ? "GPT"
              : wire,
      });
    }
  }
  if (!out.windows.length && !out.balance) out.error = "Quota data unavailable";
  return out;
}
function modelView(c: AntigravityOAuthCredentials) {
  return Object.fromEntries(
    (c.quota ? accountModelIds(c.quota) : []).map((id) => {
      const wire = resolveCodexModel(id)?.wire ?? id;
      const metadata = c.quota?.models.find((m) => m.modelId === wire);
      const images = metadata?.supportsImages === true;
      const limit = (v: number | undefined) =>
        typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
      return [
        id,
        {
          id,
          name: codexModelDisplayName(id, metadata?.displayName),
          providerID: ID,
          api: { id, url: "https://antigravity.invalid/v1beta", npm: "@ai-sdk/google" },
          status: "active",
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: limit(metadata?.maxTokens), output: limit(metadata?.maxOutputTokens) },
          capabilities: {
            temperature: true,
            reasoning:
              metadata?.supportsThinking === true ||
              CODEX_CATALOG.some((x) => x.id === id && x.variants.length > 0),
            attachment: images,
            toolcall: true,
            input: { text: true, image: images },
            output: { text: true },
          },
          options: {},
        },
      ];
    }),
  );
}
async function nativeFetch(
  input: Input,
  getAuth: GetAuth,
  url: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let bound: AntigravityOAuthCredentials | undefined;
  let selected = "";
  let selectedPublic = "";
  let jsonModeRequested = false;
  let lease: ConsumerLease | undefined;
  const callerSignal =
    init?.signal ?? (url instanceof Request ? url.signal : undefined) ?? undefined;
  const controller = new AbortController(),
    signal = controller.signal;
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", forwardAbort, { once: true });
  if (callerSignal?.aborted) forwardAbort();
  let handedOff = false;
  let onStreamAbort: (() => void) | undefined;
  const cleanup = () => {
    callerSignal?.removeEventListener("abort", forwardAbort);
    if (onStreamAbort) signal.removeEventListener("abort", onStreamAbort);
  };
  try {
    signal?.throwIfAborted();
    const endpoint = new URL(url instanceof Request ? url.url : String(url));
    const match = /\/models\/([^/]+):(streamGenerateContent|generateContent|countTokens)$/.exec(
      endpoint.pathname,
    );
    if (!match)
      return Response.json(
        { error: { message: "Expected a Gemini generation or countTokens request" } },
        { status: 400 },
      );
    const id = decodeURIComponent(match[1])
      .trim()
      .replace(/^models\//, "");
    selected = id;
    selectedPublic = id;
    const raw: unknown = JSON.parse(
      typeof init?.body === "string" ? init.body : url instanceof Request ? await url.text() : "{}",
    );
    if (!isRecord(raw) || !Array.isArray(raw.contents))
      return Response.json({ error: { message: "Gemini contents are required" } }, { status: 400 });
    const c = await observed(input, getAuth, signal);
    bound = c;
    if (!c.quota || !accountSupportsModel(c.quota, id))
      return Response.json(
        { error: { message: "Model is not in this account's synchronized catalog" } },
        { status: 404 },
      );
    if (quotaGate(c.quota, id).blocked)
      return Response.json({ error: { message: "Model quota unavailable" } }, { status: 429 });
    lease = consumerLease(c);
    const health = consumerHealth(lease);
    if (
      health.blockedReason ||
      Math.max(
        health.cooldowns?.[id] ?? 0,
        health.cooldowns?.[resolveCodexModel(id)?.wire ?? id] ?? 0,
        health.cooldowns?.[family(id)] ?? 0,
      ) > Date.now()
    )
      return Response.json(
        { error: { message: "Account blocked or model quota cooling down" } },
        { status: health.blockedReason ? 403 : 429 },
      );
    const runtime = resolveCodexModel(id)?.wire ?? id,
      request = structuredClone(raw) as unknown as GeminiRequestBody;
    const names = normalizeNativeGeminiRequest(request, id, runtime);
    selected = runtime;
    jsonModeRequested = claudeJSONMode(request, runtime);
    const response = await executeCodexGeneration({
      accountPolicy: "caller",
      credentials: parseApiKey(getApiKey(c)),
      model: runtime,
      signal,
      send: consumerFetch,
      method: match[2] as "generateContent" | "streamGenerateContent" | "countTokens",
      build: (project) =>
        match[2] === "countTokens"
          ? nativeCountTokensRequest(request, runtime)
          : {
              project,
              model: runtime,
              request,
              requestType: "agent",
              userAgent: "antigravity",
              requestId: codexRequestId(),
              ...(isCreditsEnabled() ? { enabledCreditTypes: ["GOOGLE_ONE_AI"] } : {}),
            },
    });
    let sawTerminal = false;
    const jsonMode = jsonModeRequested,
      jsonModeState = { toolCalled: false };
    const checked = (d: Record<string, unknown>, nonstream = false) => {
      if (jsonMode) rewriteJSONModeFrame(d, jsonModeState);
      let payload = d;
      for (;;) {
        observeConsumerDocument(c.access, runtime, payload, false);
        if (!isRecord(payload.response)) break;
        payload = payload.response;
      }
      sawTerminal ||= nativeTerminal(payload);
      return unwrapNative(d, names, nonstream);
    };
    if (match[2] === "countTokens") {
      const document = await readConsumerJson(response, 1024 * 1024);
      observeConsumerDocument(c.access, runtime, document, false);
      return Response.json(unwrapNativeCountTokens(document));
    }
    if (match[2] === "generateContent")
      return Response.json(
        checked(
          (await readConsumerJson(response, 8 * 1024 * 1024)) as Record<string, unknown>,
          true,
        ),
      );
    const iterator = consumerEvents(response, undefined, signal);
    let first: IteratorResult<unknown, void> | undefined;
    try {
      first = await iterator.next();
      if (!first.done) first = { ...first, value: checked(first.value as Record<string, unknown>) };
    } catch (e) {
      await iterator.return(undefined).catch(() => {});
      throw e;
    }
    const encoder = new TextEncoder();
    let done = false;
    let output: ReadableStreamDefaultController<Uint8Array>;
    onStreamAbort = () => {
      if (done) return;
      done = true;
      output.error(signal.reason);
      cleanup();
      void iterator.return(undefined).catch(() => {});
    };
    handedOff = true;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          output = controller;
          signal.addEventListener("abort", onStreamAbort!, { once: true });
          if (signal.aborted) onStreamAbort!();
        },
        async pull(controller) {
          try {
            if (done) {
              controller.close();
              return;
            }
            const item = first;
            first = undefined;
            const next = item ?? (await iterator.next());
            if (next.done) {
              if (!sawTerminal)
                throw new Error(
                  "Antigravity Gemini stream ended before a terminal response: unexpected EOF",
                );
              done = true;
              cleanup();
              controller.close();
              return;
            }
            controller.enqueue(
              encoder.encode(
                "data: " +
                  JSON.stringify(
                    item ? next.value : checked(next.value as Record<string, unknown>),
                  ) +
                  "\n\n",
              ),
            );
          } catch (e) {
            if (done) return;
            done = true;
            cleanup();
            await iterator.return(undefined).catch(() => {});
            if (!signal.aborted) await recordFailure(input, getAuth, c, runtime, e, lease);
            controller.error(new Error(safeError(e)));
          }
        },
        async cancel(reason) {
          done = true;
          // AsyncGenerator.return queues behind a pending next(). Abort its
          // read first, like c2a Close closes the underlying source immediately.
          controller.abort(reason ?? new DOMException("Response body cancelled", "AbortError"));
          cleanup();
          await iterator.return(undefined).catch(() => {});
        },
      }),
      { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } },
    );
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (bound) await recordFailure(input, getAuth, bound, selected, error, lease);
    if (jsonModeRequested && error instanceof GenerationHTTPError && error.status === 400) {
      const rejection = nativeJSONModeRejection(error.body, selectedPublic);
      if (rejection)
        return Response.json(
          { error: { ...rejection, message: safeError(new Error(String(rejection.message))) } },
          { status: 400 },
        );
    }
    const status = error instanceof GenerationHTTPError ? error.status : 502;
    return Response.json(
      { error: { message: safeError(error) } },
      { status: status >= 400 && status <= 599 ? status : 502 },
    );
  } finally {
    if (!handedOff) cleanup();
  }
}
function googleMethod(manual: boolean) {
  return {
    type: "oauth",
    label: manual ? "Google (remote/manual callback)" : "Sign in with Google",
    async authorize(_inputs?: unknown, options?: { signal?: AbortSignal }) {
      const controller = new AbortController();
      const abort = () => controller.abort(options?.signal?.reason);
      options?.signal?.addEventListener("abort", abort, { once: true });
      if (options?.signal?.aborted) abort();
      let shown!: (v: { url: string; instructions?: string }) => void,
        prompted: ((v: string) => void) | undefined;
      const url = new Promise<{ url: string; instructions?: string }>((resolve) => {
        shown = resolve;
      });
      const result = loginAntigravity({
        onAuth: shown,
        onPrompt: () => {
          // A native callback RPC is one submission, not Pi's re-prompting TUI.
          if (prompted)
            return Promise.reject(
              new Error("Invalid OAuth callback or state; start sign-in again"),
            );
          return new Promise<string>((resolve) => {
            prompted = resolve;
          });
        },
        onProgress: () => {},
        onDeviceCode: () => {
          throw new Error("Device authorization is not used");
        },
        onSelect: async () => {
          throw new Error("Unexpected OAuth selection");
        },
        signal: controller.signal,
      });
      const cleanup = () => options?.signal?.removeEventListener("abort", abort);
      void result.then(cleanup, cleanup);
      const info = await Promise.race([
        url,
        result.then(() => {
          throw new Error("OAuth completed without authorization URL");
        }),
      ]);
      return {
        ...info,
        method: manual ? "code" : "auto",
        instructions: manual
          ? "Complete Google sign-in and paste the full loopback callback URL here. Never share it in logs or chat."
          : info.instructions,
        async callback(pasted?: string, callbackOptions?: { signal?: AbortSignal }) {
          const cancel = () => controller.abort(callbackOptions?.signal?.reason);
          callbackOptions?.signal?.addEventListener("abort", cancel, { once: true });
          if (callbackOptions?.signal?.aborted) cancel();
          try {
            if (pasted) prompted?.(pasted);
            return { type: "success", ...(await result) };
          } finally {
            callbackOptions?.signal?.removeEventListener("abort", cancel);
            controller.abort();
            cleanup();
          }
        },
      };
    },
  };
}
export default async function AntigravityMagpie(input: Input) {
  return {
    config(config: { provider?: Record<string, unknown> }) {
      config.provider ??= {};
      config.provider[ID] = {
        name: "Antigravity",
        npm: "@ai-sdk/google",
        api: "https://antigravity.invalid/v1beta",
        models: {},
      };
    },
    auth: {
      provider: ID,
      methods: [googleMethod(false), googleMethod(true)],
      async refresh(stored: unknown) {
        const old = credential(stored);
        const next = await refreshAntigravityToken(old);
        initializeConsumerHealth(next, isRecord(stored) ? stored.consumerHealth : undefined);
        return { ...next, consumerHealth: consumerHealth(consumerLease(next)) };
      },
      async usage(getAuth: GetAuth, _provider: unknown, options?: { signal?: AbortSignal }) {
        try {
          return usageView(await observed(input, getAuth, options?.signal));
        } catch (e) {
          return { windows: [], error: safeError(e) };
        }
      },
      async loader(getAuth: GetAuth) {
        return {
          apiKey: "oauth",
          baseURL: "https://antigravity.invalid/v1beta",
          fetch: (url: RequestInfo | URL, init?: RequestInit) =>
            nativeFetch(input, getAuth, url, init),
        };
      },
    },
    provider: {
      id: ID,
      async models(_provider: unknown, context: { auth: unknown }) {
        return modelView(await observed(input, async () => context.auth));
      },
    },
  };
}
/** Tests use objects, never extra exported plugin functions. */
export const _internal = { usageView, modelView };
