/** Native OpenCode/Magpie hooks. Uses Magpie's documented Gemini provider API;
 * no local server, host patch or Pi-SDK runtime dependency. Pi uses extensions/. */
import { loginAntigravity, refreshAntigravityToken, getApiKey } from "./auth/oauth.js";
import { observeAccount } from "./auth/account-view.js";
import { accountModelIds, accountSupportsModel } from "./compat/account-catalog.js";
import { CODEX_CATALOG, codexThinking, resolveCodexModel } from "./compat/catalog.js";
import { codexRequestId, codexSessionId } from "./compat/profile.js";
import { normalizeCodexRequest } from "./compat/request.js";
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
import { quotaGate } from "./auth/quota-snapshot.js";
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
    const next = { ...verified, consumerHealth: value.consumerHealth };
    if (JSON.stringify(value) !== JSON.stringify({ ...next, type: "oauth" }))
      await save(input, next);
    return next;
  });
}
type CallerHealth = {
  blockedReason?: string;
  cooldowns?: Record<string, number>;
  lastFailure?: { at: number; status: number; kind: string; model: string };
};
const healthFlights = new Map<string, Promise<void>>();
async function serializeAccount<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = healthFlights.get(key) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(work);
  const barrier = result.then(
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
function callerHealth(c: AntigravityOAuthCredentials): CallerHealth {
  return isRecord(c.consumerHealth) ? c.consumerHealth : {};
}
async function recordFailure(
  input: Input,
  getAuth: GetAuth,
  c: AntigravityOAuthCredentials,
  model: string,
  error: unknown,
) {
  if (!(error instanceof GenerationHTTPError)) return;
  const key = c.subject ?? c.refresh;
  const previous = healthFlights.get(key) ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const value = await getAuth();
      if (
        !isRecord(value) ||
        value.type !== "oauth" ||
        value.access !== c.access ||
        value.refresh !== c.refresh
      )
        return;
      const current = credential(value),
        health = structuredClone(callerHealth(current));
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
      );
      await save(input, { ...current, consumerHealth: health });
    });
  healthFlights.set(key, task);
  try {
    await task;
  } finally {
    if (healthFlights.get(key) === task) healthFlights.delete(key);
  }
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
  for (const group of q.groupsObserved ? q.groups : []) {
    const scope = /gemini/i.test(group.displayName)
      ? ids.filter((id) => id.startsWith("gemini"))
      : /claude|gpt/i.test(group.displayName)
        ? ids.filter((id) => /^(claude|gpt)/.test(id))
        : ids;
    for (const b of group.buckets) {
      const known =
        b.fractionPresent &&
        typeof b.remainingFraction === "number" &&
        Number.isFinite(b.remainingFraction) &&
        Date.now() - b.observedAt <= b.ttlSeconds * 1000;
      out.windows.push({
        name: group.displayName + " · " + b.window,
        models: scope,
        ...(known
          ? { used: (1 - Math.max(0, Math.min(1, b.remainingFraction!))) * 100 }
          : { display: "Unknown" }),
        resetsAt: b.resetTime || undefined,
        span: b.window === "5h" ? 18000 : b.window === "weekly" ? 604800 : undefined,
      });
    }
  }
  if (!out.windows.length) {
    // The summary endpoint can be unavailable on free plans. Preserve actual
    // per-backing readings; do not manufacture a shared family or a full balance.
    const visible = new Set(ids);
    for (const m of q.models) {
      const mapped = ids.filter((id) => {
        const d = CODEX_CATALOG.find((x) => x.id === id);
        return d?.wire === m.modelId || id === m.modelId;
      });
      if (!mapped.length && !visible.has(m.modelId)) continue;
      out.windows.push({
        name: m.displayName || m.modelId,
        models: mapped.length ? mapped : [m.modelId],
        ...(m.fractionPresent &&
        typeof m.remainingFraction === "number" &&
        Number.isFinite(m.remainingFraction) &&
        Date.now() - q.updatedAt <= 300000
          ? { used: (1 - Math.max(0, Math.min(1, m.remainingFraction))) * 100 }
          : { display: "Unknown" }),
        resetsAt: m.resetTime || undefined,
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
          name: metadata?.displayName || id,
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
function restoreNames(value: unknown, names: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((x) => restoreNames(x, names));
  if (!isRecord(value)) return value;
  for (const [k, v] of Object.entries(value)) {
    if (k === "functionCall" && isRecord(v) && typeof v.name === "string" && names[v.name])
      v.name = names[v.name];
    else value[k] = restoreNames(v, names);
  }
  return value;
}
async function nativeFetch(
  input: Input,
  getAuth: GetAuth,
  url: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let bound: AntigravityOAuthCredentials | undefined;
  let selected = "";
  const signal = init?.signal ?? (url instanceof Request ? url.signal : undefined) ?? undefined;
  try {
    signal?.throwIfAborted();
    const endpoint = new URL(url instanceof Request ? url.url : String(url));
    const match = /\/models\/([^/]+):(streamGenerateContent|generateContent)$/.exec(
      endpoint.pathname,
    );
    if (!match)
      return Response.json(
        { error: { message: "Expected a Gemini generateContent request" } },
        { status: 400 },
      );
    const id = decodeURIComponent(match[1]);
    selected = id;
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
    const health = callerHealth(c);
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
    const names = normalizeCodexRequest(request, runtime);
    request.sessionId = codexSessionId(request.contents);
    selected = runtime;
    const thinking = codexThinking(id, runtime);
    if (thinking)
      request.generationConfig = { ...request.generationConfig, thinkingConfig: thinking };
    const response = await executeCodexGeneration({
      accountPolicy: "caller",
      credentials: parseApiKey(getApiKey(c)),
      model: runtime,
      signal,
      send: consumerFetch,
      method: match[2] as "generateContent" | "streamGenerateContent",
      build: (project) => ({
        project,
        model: runtime,
        request,
        requestType: "agent",
        userAgent: "antigravity",
        requestId: codexRequestId(),
        ...(isCreditsEnabled() ? { enabledCreditTypes: ["GOOGLE_ONE_AI"] } : {}),
      }),
    });
    const checked = (d: Record<string, unknown>) => {
      observeConsumerDocument(c.access, runtime, d, false);
      return restoreNames(isRecord(d.response) ? d.response : d, names);
    };
    if (match[2] === "generateContent")
      return Response.json(checked((await readConsumerJson(response)) as Record<string, unknown>));
    const iterator = consumerEvents(response);
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
    return new Response(
      new ReadableStream<Uint8Array>({
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
              done = true;
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
            done = true;
            await iterator.return(undefined).catch(() => {});
            await recordFailure(input, getAuth, c, runtime, e);
            controller.error(new Error(safeError(e)));
          }
        },
        async cancel() {
          done = true;
          await iterator.return(undefined).catch(() => {});
        },
      }),
      { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } },
    );
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (bound) await recordFailure(input, getAuth, bound, selected, error);
    const status = error instanceof GenerationHTTPError ? error.status : 502;
    return Response.json(
      { error: { message: safeError(error) } },
      { status: status >= 400 && status <= 599 ? status : 502 },
    );
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
        return { ...(await refreshAntigravityToken(old)), consumerHealth: old.consumerHealth };
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
