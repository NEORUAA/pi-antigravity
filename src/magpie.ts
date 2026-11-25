import {
  consumerLease,
  initializeConsumerHealth,
  consumerHealth,
  updateConsumerHealth,
  type ConsumerCooldown,
  type ConsumerHealth,
  type ConsumerLease,
} from "./auth/checkpoint.js";
/** Native OpenCode/Magpie hooks. Uses Magpie's documented Gemini provider API;
 * no local server, host patch or Pi-SDK runtime dependency. Pi uses extensions/. */
import { loginAntigravity, refreshAntigravityToken, getApiKey } from "./auth/oauth.js";
import { observeAccount } from "./auth/account-view.js";
import { accountModelIds, accountSupportsModel } from "./compat/account-catalog.js";
import { CODEX_CATALOG, codexModelBaseName, type Variant } from "./compat/catalog.js";
import { codexRequestId } from "./compat/profile.js";
import {
  normalizeNativeGeminiRequest,
  nativeThinkingLevel,
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
  consumerBlockReason,
  durationMillis,
  quotaSignal,
  retryAfterMillis,
  observeConsumerDocument,
  observeConsumerFailure,
  readConsumerJson,
} from "./client/codex-transport.js";
import {
  quotaGate,
  bucketFamily,
  modelQuotaFamily,
  type QuotaSnapshot,
} from "./auth/quota-snapshot.js";
import { safeError, stripValidationUrls } from "./utils/security.js";
import { cleanText } from "./utils/text.js";
import { isCreditsEnabled } from "./utils/credits.js";
import { isRecord } from "./utils/util.js";
import type { AntigravityOAuthCredentials, GeminiRequestBody } from "./types/types.js";
const ID = "antigravity";
type ModelFamily = (typeof CODEX_CATALOG)[number];
const modelFamilies = new Map(
  CODEX_CATALOG.filter((model) => !model.wire).map((model) => [model.id, model]),
);
const fixedWires = new Map(
  CODEX_CATALOG.flatMap(({ id, wire }) => (wire ? [[id, wire] as const] : [])),
);
const tierId = (id: string, variant: Variant) => `${id}-${variant.level}`;
const tierFamilies = new Map(
  [...modelFamilies.values()].flatMap((model) =>
    model.variants.map((variant) => [tierId(model.id, variant), model] as const),
  ),
);

function availableVariants(model: ModelFamily, ids: ReadonlySet<string>): Variant[] {
  return model.variants.filter((variant) => ids.has(tierId(model.id, variant)));
}

function magpieCatalog(quota: QuotaSnapshot) {
  const ids = new Set(accountModelIds(quota));
  const models = new Map<string, { variants: Variant[]; wires: string[] }>();
  for (const id of ids) {
    const model = tierFamilies.get(id);
    if (model) {
      if (models.has(model.id)) continue;
      const variants = availableVariants(model, ids);
      models.set(model.id, {
        variants,
        wires: [...new Set(variants.map((variant) => variant.wire))],
      });
    } else if (!modelFamilies.has(id.toLowerCase())) {
      models.set(id, { variants: [], wires: [fixedWires.get(id.toLowerCase()) ?? id] });
    }
  }
  return models;
}

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

type NativeError = { message: string; code: string | number; status?: string; details?: object[] };
const rpcType = "type.googleapis.com/google.rpc.";
const verificationMessage = "Google requires you to verify your account.";
const restrictedMessage =
  "Google Antigravity is disabled in this account for violation of Terms of Service.";
const overloadedMessage = "The requested model is overloaded at Google Antigravity.";
const rpcStatus = (status: number) =>
  status === 403
    ? "PERMISSION_DENIED"
    : status === 429
      ? "RESOURCE_EXHAUSTED"
      : status === 503
        ? "UNAVAILABLE"
        : undefined;

function redactUpstreamText(value: string, credentials?: AntigravityOAuthCredentials): string {
  const secrets = [
    credentials?.access,
    credentials?.refresh,
    credentials?.idToken,
    credentials?.oauthClientSecret,
  ];
  for (const secret of secrets) if (secret) value = value.replaceAll(secret, "[redacted]");
  const normalized = cleanText(value, value.length) ?? "";
  return cleanText(stripValidationUrls(safeError(normalized)), 2048) ?? "";
}

function nativeUpstreamError(
  error: GenerationHTTPError,
  credentials?: AntigravityOAuthCredentials,
  stream = false,
): NativeError {
  let source: Record<string, unknown> = {};
  let message = "";
  try {
    const document: unknown = JSON.parse(error.body);
    if (isRecord(document)) {
      source = isRecord(document.error) ? document.error : document;
      message =
        typeof source.message === "string"
          ? source.message
          : typeof document.error === "string"
            ? document.error
            : "";
    }
  } catch {
    if (!/^\s*[[{<]/.test(error.body)) message = error.body;
  }
  const block = consumerBlockReason(error.status, error.body);
  const redact = (value: string) => redactUpstreamText(value, credentials);
  // Normalize invisible separators before matching credential patterns.
  message = redact(message);
  if (
    block === "TOS_VIOLATION" &&
    !/disabled in this account for violation of Terms of Service/i.test(message)
  )
    message = message ? `${message}\n${restrictedMessage}` : restrictedMessage;
  if (
    block === "VALIDATION_REQUIRED" &&
    stream &&
    !/verify your account|account verification required/i.test(message)
  )
    message = message ? `${message}\n${verificationMessage}` : verificationMessage;
  if (
    error.status === 503 &&
    quotaSignal(error.status, error.body)?.kind === "capacity" &&
    !/overloaded/i.test(message)
  )
    message = message ? `${message}\n${overloadedMessage}` : overloadedMessage;
  const details: object[] = [];
  for (const entry of Array.isArray(source.details) ? source.details.slice(0, 16) : []) {
    if (!isRecord(entry)) continue;
    if (entry["@type"] === `${rpcType}RetryInfo`) {
      const delay = durationMillis(entry.retryDelay);
      if (delay !== undefined)
        details.push({ "@type": entry["@type"], retryDelay: `${delay / 1000}s` });
    } else if (
      (entry["@type"] === undefined ||
        entry["@type"] === `${rpcType}ErrorInfo` ||
        entry["@type"] === "google.rpc.ErrorInfo") &&
      typeof entry.reason === "string" &&
      /^[A-Z][A-Z0-9_]{0,79}$/.test(entry.reason) &&
      redact(entry.reason) === entry.reason
    ) {
      details.push({ "@type": `${rpcType}ErrorInfo`, reason: entry.reason });
    }
  }
  return {
    message:
      message ||
      (block === "VALIDATION_REQUIRED"
        ? verificationMessage
        : `Google Antigravity returned HTTP ${error.status}.`),
    code:
      typeof source.code === "number" ||
      (typeof source.code === "string" &&
        /^[A-Za-z0-9_-]{1,80}$/.test(source.code) &&
        redact(source.code) === source.code)
        ? source.code
        : error.status,
    status:
      typeof source.status === "string" &&
      /^[A-Z][A-Z_]{0,63}$/.test(source.status) &&
      redact(source.status) === source.status
        ? source.status
        : rpcStatus(error.status),
    ...(details.length > 0 && { details }),
  };
}

// Only machine-readable reasons go in the credential journal and host auth data.
// Upstream messages can contain account or request data and stay in this process.
const recentFailures = new Map<string, { error: NativeError; until: number }>();
const errorCacheKey = (lease: ConsumerLease, c: AntigravityOAuthCredentials, scope: string) =>
  JSON.stringify([lease.family, lease.epoch, c.projectId, scope]);

function localError(status: number, message: string, reason?: string): NativeError {
  return {
    code: status,
    status: rpcStatus(status),
    message,
    ...(reason && { details: [{ "@type": `${rpcType}ErrorInfo`, reason }] }),
  };
}

function recordFailure(
  c: AntigravityOAuthCredentials,
  model: string,
  error: unknown,
  upstream: NativeError | undefined,
  lease?: ConsumerLease,
) {
  if (!(error instanceof GenerationHTTPError) || !lease || !upstream) return;
  const now = Date.now();
  let quote: { key: string; until: number } | undefined;
  const written = updateConsumerHealth(lease, (health) =>
    observeConsumerFailure(
      c.access,
      model,
      error.status,
      error.body,
      error.headers,
      (_token, _model, update) => {
        if (update.block) {
          health.blockedReason = update.block;
          quote = {
            key: errorCacheKey(lease, c, `account:${update.block}:${model}`),
            until: now + 30 * 60_000,
          };
        }
        if (update.failure) health.lastFailure = update.failure;
        if (update.cooldownMs) {
          health.cooldowns ??= {};
          health.cooldownReasons ??= {};
          for (const [key, until] of Object.entries(health.cooldowns)) {
            if (until > now) continue;
            delete health.cooldowns[key];
            delete health.cooldownReasons[key];
          }
          const shared = model.startsWith("gemini-")
            ? family(model)
            : update.quotaModel
              ? family(update.quotaModel)
              : model;
          const until = now + update.cooldownMs;
          const kind = update.failure?.kind;
          const reason: ConsumerCooldown = {
            status: error.status === 503 ? 503 : 429,
            kind: kind === "quota" || kind === "rate" || kind === "capacity" ? kind : "unknown",
          };
          for (const id of new Set([model, ...(update.familyQuota ? [shared] : [])])) {
            if (until < (health.cooldowns[id] ?? 0)) continue;
            health.cooldowns[id] = until;
            health.cooldownReasons[id] = reason;
            if (id === model) quote = { key: errorCacheKey(lease, c, `model:${model}`), until };
          }
        }
      },
    ),
  );
  if (!written || !quote) return;
  for (const [key, value] of recentFailures) if (value.until <= now) recentFailures.delete(key);
  recentFailures.delete(quote.key);
  if (recentFailures.size >= 128) recentFailures.delete(recentFailures.keys().next().value!);
  const { details, ...summary } = upstream;
  // A relative reset in a replay would restart Magpie's countdown.
  const reason = summary.message
    .replace(
      /\b(?:(?:your )?quota will reset after|resets? (?:in|after)|try again in|retry (?:in|after))\s+\d(?:\.(?=\d)|[^.!?])*(?:[.!?]|$)/gi,
      "",
    )
    .replace(/(?:请\s*)?\d+\s*(?:秒|分钟)钟?\s*(?:之?后)(?:再试|重试)?[。！]?/g, "")
    .trim();
  const stableDetails = details?.filter(
    (detail) => isRecord(detail) && detail["@type"] !== `${rpcType}RetryInfo`,
  );
  recentFailures.set(quote.key, {
    until: quote.until,
    error: {
      ...summary,
      message: reason,
      ...(stableDetails?.length && { details: stableDetails }),
    },
  });
}

function cachedFailure(
  lease: ConsumerLease,
  c: AntigravityOAuthCredentials,
  scope: string,
  now = Date.now(),
) {
  const entry = recentFailures.get(errorCacheKey(lease, c, scope));
  return entry && entry.until > now && entry.error.message ? entry.error : undefined;
}

function accountBlockResponse(
  health: ConsumerHealth,
  lease: ConsumerLease,
  c: AntigravityOAuthCredentials,
  runtime: string,
): Response | undefined {
  if (health.blockedReason) {
    const fallback =
      health.blockedReason === "VALIDATION_REQUIRED"
        ? localError(403, verificationMessage, "VALIDATION_REQUIRED")
        : health.blockedReason === "TOS_VIOLATION"
          ? localError(403, restrictedMessage, "TOS_VIOLATION")
          : localError(403, "Google Antigravity access is restricted for this account.");
    return Response.json(
      { error: cachedFailure(lease, c, `account:${health.blockedReason}:${runtime}`) ?? fallback },
      { status: 403 },
    );
  }
  if (c.quota?.forbidden)
    return Response.json(
      {
        error: localError(403, "Google Antigravity denied access to this account's quota catalog."),
      },
      { status: 403 },
    );
}

function cooldownResponse(
  health: ConsumerHealth,
  lease: ConsumerLease,
  c: AntigravityOAuthCredentials,
  id: string,
  runtime: string,
): Response | undefined {
  const now = Date.now();
  const cooldowns = health.cooldowns ?? {};
  const key = [runtime, id, family(runtime)].reduce((current, next) =>
    (cooldowns[next] ?? 0) > (cooldowns[current] ?? 0) ? next : current,
  );
  const hold = cooldowns[key] ?? 0;
  const quota = quotaGate(c.quota, runtime, now);
  if (hold <= now && !quota.blocked) return undefined;
  const recorded = health.cooldownReasons?.[key];
  const legacy =
    health.lastFailure?.model === key && [429, 503].includes(health.lastFailure.status)
      ? health.lastFailure
      : undefined;
  const kind = quota.blocked ? "quota" : (recorded?.kind ?? legacy?.kind);
  const cached =
    key === runtime && hold > now ? cachedFailure(lease, c, `model:${runtime}`, now) : undefined;
  const status = !quota.blocked && (recorded?.status ?? legacy?.status) === 503 ? 503 : 429;
  const message =
    kind === "quota"
      ? "Individual quota reached for the requested model on this account."
      : kind === "rate"
        ? "Rate limit reached. Credentials for the requested model are cooling down."
        : kind === "capacity"
          ? overloadedMessage
          : "Credentials for the requested model are cooling down after a Google Antigravity error.";
  const cachedStatus = health.cooldownReasons?.[runtime]?.status;
  const error =
    cached && cachedStatus === status && (!quota.blocked || recorded?.kind === "quota")
      ? cached
      : localError(
          status,
          message,
          kind === "quota"
            ? "QUOTA_EXHAUSTED"
            : kind === "rate"
              ? "RATE_LIMIT_EXCEEDED"
              : kind === "capacity"
                ? "MODEL_CAPACITY_EXHAUSTED"
                : undefined,
        );
  const until = Math.max(hold, quota.resetAt ?? 0);
  const headers =
    until > now ? { "retry-after": String(Math.ceil((until - now) / 1000)) } : undefined;
  return Response.json({ error }, { status, headers });
}
function usageView(c: AntigravityOAuthCredentials) {
  const q = c.quota;
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
  const catalog = magpieCatalog(q);
  const backing = new Map<string, string[]>();
  for (const [id, model] of catalog)
    for (const wire of model.wires) backing.set(wire, [...(backing.get(wire) ?? []), id]);
  // c2a scopes each bucket, not the union of the enclosing group's families.
  // Magpie uses the *pool string* as identity for both windows and member rows.
  // Keep same-group/same-member windows together, but never merge distinct scopes
  // (or separate groups) merely because their vendor display names coincide.
  const projected = (q.groupsObserved ? q.groups : []).flatMap((group, groupIndex) =>
    group.buckets.map((bucket, bucketIndex) => {
      const scopeFamily = bucketFamily(bucket.bucketId);
      const wires = scopeFamily
        ? [...backing.keys()].filter((wire) => modelQuotaFamily(q, wire) === scopeFamily)
        : [];
      const scope = [...new Set(wires.flatMap((wire) => backing.get(wire) ?? []))];
      return {
        bucket,
        wires,
        scope,
        key: JSON.stringify([groupIndex, wires.length ? wires.sort() : bucketIndex]),
        base: group.displayName.trim() || "Reported quota",
        label: scope.length
          ? ({ gemini: "Gemini", argon: "Argon", "3p": "Claude / GPT" }[scopeFamily] ?? scopeFamily)
          : bucket.bucketId || "Unknown scope",
      };
    }),
  );
  const units = new Map(projected.map((row) => [row.key, row]));
  const nameCounts = new Map<string, number>();
  for (const row of units.values()) nameCounts.set(row.base, (nameCounts.get(row.base) ?? 0) + 1);
  const usedNames = new Set<string>();
  const allocatePool = (base: string) => {
    let name = base;
    for (let suffix = 2; usedNames.has(name); suffix++) name = `${base} #${suffix}`;
    usedNames.add(name);
    return name;
  };
  const poolNames = new Map<string, string>();
  const pools = new Map<string, string[]>();
  for (const row of units.values()) {
    const pool = allocatePool(
      nameCounts.get(row.base) === 1 ? row.base : `${row.base} · ${row.label}`,
    );
    poolNames.set(row.key, pool);
    for (const wire of row.wires) pools.set(wire, [...(pools.get(wire) ?? []), pool]);
  }
  for (const { bucket, scope, key } of projected) {
    const known =
      bucket.fractionPresent &&
      typeof bucket.remainingFraction === "number" &&
      Number.isFinite(bucket.remainingFraction) &&
      Date.now() - bucket.observedAt <= bucket.ttlSeconds * 1000;
    out.windows.push({
      name:
        bucket.window === "5h" ? "5 hours" : bucket.window === "weekly" ? "1 week" : bucket.window,
      pool: poolNames.get(key),
      models: scope,
      ...(known
        ? { used: (1 - Math.max(0, Math.min(1, bucket.remainingFraction!))) * 100 }
        : { display: "Unknown" }),
      resetsAt: bucket.resetTime || undefined,
      span: bucket.window === "5h" ? 18000 : bucket.window === "weekly" ? 604800 : undefined,
    });
  }
  for (const [wire, models] of backing) {
    const m = q.models.find((row) => row.modelId === wire);
    const name =
      models.length === 1 &&
      modelFamilies.has(models[0]) &&
      catalog.get(models[0])?.wires.length === 1
        ? codexModelBaseName(m?.displayName ?? "") || models[0]
        : m?.displayName || wire;
    const matched = pools.get(wire);
    const known =
      m?.fractionPresent &&
      typeof m.remainingFraction === "number" &&
      Number.isFinite(m.remainingFraction) &&
      Date.now() - q.updatedAt <= 300000;
    const family = /^gemini/i.test(wire)
      ? "Gemini"
      : /^claude/i.test(wire)
        ? "Claude"
        : /^gpt/i.test(wire)
          ? "GPT"
          : wire;
    for (const pool of matched ?? [allocatePool(name)]) {
      out.windows.push({
        name: matched ? name : "Reported quota",
        pool,
        ...(matched ? { family } : {}),
        models,
        ...(known
          ? { used: (1 - Math.max(0, Math.min(1, m.remainingFraction!))) * 100 }
          : { display: "Unknown" }),
        resetsAt: m?.resetTime || undefined,
      });
      if (!matched) out.windows.push({ ...out.windows.at(-1)!, name, family });
    }
  }
  if (!out.windows.length && !out.balance) out.error = "Quota data unavailable";
  return out;
}
function modelView(c: AntigravityOAuthCredentials) {
  if (!c.quota) return {};
  const metadata = new Map(c.quota.models.map((model) => [model.modelId, model]));
  return Object.fromEntries(
    [...magpieCatalog(c.quota)].map(([id, { wires, variants }]) => {
      const observed = wires.map((wire) => metadata.get(wire));
      const images = observed.every((model) => model?.supportsImages === true);
      const displayName = observed.find((model) => model?.displayName)?.displayName ?? "";
      const limit = (key: "maxTokens" | "maxOutputTokens") => {
        const limits = observed
          .map((model) => model?.[key] ?? 0)
          .filter((value) => Number.isFinite(value) && value > 0);
        return limits.length ? Math.min(...limits) : 0;
      };
      return [
        id,
        {
          id,
          name: (variants.length ? codexModelBaseName(displayName) : displayName) || id,
          providerID: ID,
          api: { id, url: "https://antigravity.invalid/v1beta", npm: "@ai-sdk/google" },
          status: "active",
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: limit("maxTokens"), output: limit("maxOutputTokens") },
          capabilities: {
            temperature: true,
            reasoning: variants.length > 0 || observed.some((model) => model?.supportsThinking),
            attachment: images,
            toolcall: true,
            input: { text: true, image: images },
            output: { text: true },
          },
          ...(variants.length && {
            variants: Object.fromEntries(variants.map(({ level }) => [level, {}])),
          }),
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
  const responseHeaders = new Headers();
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
    lease = consumerLease(c);
    const health = consumerHealth(lease);
    const model = modelFamilies.get(id.toLowerCase());
    const variants =
      c.quota && model ? availableVariants(model, new Set(accountModelIds(c.quota))) : [];
    const headers = new Headers(
      init?.headers ?? (url instanceof Request ? url.headers : undefined),
    );
    const effort = model
      ? headers.get("x-magpie-effort")?.trim().toLowerCase() || nativeThinkingLevel(raw)
      : "";
    const variant =
      variants.find((tier) => tier.level === (effort || model?.defaultLevel)) ??
      (effort ? undefined : variants[0]);
    const wire = variant?.wire ?? fixedWires.get(id.toLowerCase()) ?? id;
    const blocked = accountBlockResponse(health, lease, c, wire);
    if (blocked) return blocked;
    if (!c.quota || (model ? !variants.length : !accountSupportsModel(c.quota, id)))
      return Response.json(
        { error: { message: "Model is not in this account's synchronized catalog" } },
        { status: 404 },
      );
    if (effort && !variant) {
      const supported = variants.map(({ level }) => `'${level}'`).join(", ");
      return Response.json(
        {
          error: {
            message: `Reasoning effort is not available for this account and model. Supported values are: ${supported}`,
            param: "reasoning_effort",
          },
        },
        { status: 400 },
      );
    }
    const held = cooldownResponse(health, lease, c, id, wire);
    if (held) return held;
    const request = structuredClone(raw) as unknown as GeminiRequestBody;
    const requestModel = model && variant ? tierId(model.id, variant) : id;
    const names = normalizeNativeGeminiRequest(request, requestModel, wire, Boolean(variant));
    if (wire !== id && match[2] !== "countTokens") responseHeaders.set("x-magpie-sent-model", wire);
    selected = wire;
    jsonModeRequested = claudeJSONMode(request, wire);
    const response = await executeCodexGeneration({
      accountPolicy: "caller",
      credentials: parseApiKey(getApiKey(c)),
      model: wire,
      signal,
      send: consumerFetch,
      method: match[2] as "generateContent" | "streamGenerateContent" | "countTokens",
      build: (project) =>
        match[2] === "countTokens"
          ? nativeCountTokensRequest(request, wire)
          : {
              project,
              model: wire,
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
        observeConsumerDocument(c.access, wire, payload, false);
        if (!isRecord(payload.response)) break;
        payload = payload.response;
      }
      sawTerminal ||= nativeTerminal(payload);
      return unwrapNative(d, names, nonstream);
    };
    if (match[2] === "countTokens") {
      const document = await readConsumerJson(response, 1024 * 1024);
      observeConsumerDocument(c.access, wire, document, false);
      return Response.json(unwrapNativeCountTokens(document), { headers: responseHeaders });
    }
    if (match[2] === "generateContent")
      return Response.json(
        checked(
          (await readConsumerJson(response, 8 * 1024 * 1024)) as Record<string, unknown>,
          true,
        ),
        { headers: responseHeaders },
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
    responseHeaders.set("content-type", "text/event-stream");
    responseHeaders.set("cache-control", "no-cache");
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
            if (signal.aborted) {
              controller.error(signal.reason);
            } else if (e instanceof GenerationHTTPError) {
              const error = nativeUpstreamError(e, c, true);
              recordFailure(c, wire, e, error, lease);
              // The stream head is already committed. Magpie reads an HTTP code from the error frame.
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ error: { ...error, code: e.status } })}\n\n`,
                ),
              );
              controller.close();
            } else {
              controller.error(new Error(safeError(e)));
            }
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
      { headers: responseHeaders },
    );
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    const upstream =
      error instanceof GenerationHTTPError ? nativeUpstreamError(error, bound) : undefined;
    if (bound) recordFailure(bound, selected, error, upstream, lease);
    if (jsonModeRequested && error instanceof GenerationHTTPError && error.status === 400) {
      const rejection = nativeJSONModeRejection(error.body, selectedPublic);
      if (rejection)
        return Response.json(
          {
            error: { ...rejection, message: redactUpstreamText(String(rejection.message), bound) },
          },
          { status: 400, headers: responseHeaders },
        );
    }
    if (error instanceof GenerationHTTPError && upstream) {
      const delay = retryAfterMillis(error.headers) ?? quotaSignal(error.status, error.body)?.delay;
      if (delay && delay > 0) responseHeaders.set("retry-after", String(Math.ceil(delay / 1000)));
      const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
      return Response.json({ error: upstream }, { status, headers: responseHeaders });
    }
    return Response.json(
      { error: { message: safeError(error) } },
      { status: 502, headers: responseHeaders },
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
