/** Consumer request dispatch adapted from codex2api d8e1981f's
 * proxy/antigravity_responses.go and antigravity_quota.go. */
import type { AntigravityApiKey } from "../types/types.js";
import {
  accountAvailable,
  failoverToNextAccount,
  markAccountHealth,
  refreshAccountAfterUnauthorized,
} from "../auth/accounts.js";
import { endpointCandidates, antigravityHeaders } from "./client.js";
import { abortableDelay } from "../compat/profile.js";
import { antigravityEnv, isRecord } from "../utils/util.js";
import { safeError } from "../utils/security.js";
import { setLastEndpoint, setLastStatus, setLastProjectId } from "../diagnostics/diagnostics.js";

export type QuotaSignal = {
  kind: "rate" | "quota" | "capacity";
  delay?: number;
  model?: string;
  reason?: string;
};
export function durationMillis(value: unknown): number | undefined {
  let nanoseconds: number | undefined;
  if (typeof value === "number") nanoseconds = Math.trunc(value * 1e9);
  if (isRecord(value) && ("seconds" in value || "nanos" in value))
    nanoseconds =
      Math.trunc(Number(value.seconds ?? 0) * 1e9) + Math.trunc(Number(value.nanos ?? 0));
  if (typeof value === "string") {
    let text = value.trim();
    if (!text || text.length > 128) return undefined;
    let negative = false;
    if (/^[+-]/.test(text)) {
      negative = text[0] === "-";
      text = text.slice(1);
    }
    if (text === "0") return 0;
    const units: Record<string, bigint> = {
      h: 3_600_000_000_000n,
      m: 60_000_000_000n,
      s: 1_000_000_000n,
      ms: 1_000_000n,
      us: 1000n,
      µs: 1000n,
      μs: 1000n,
      ns: 1n,
    };
    const pattern = /((?:\d+(?:\.\d*)?|\.\d+))(ms|us|µs|μs|ns|h|m|s)/gy;
    let total = 0n,
      cursor = 0,
      match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const [integer, fraction = ""] = match[1].split(".");
      const precision = fraction.slice(0, 30);
      total += BigInt(integer || "0") * units[match[2]];
      if (precision)
        total += (BigInt(precision) * units[match[2]]) / 10n ** BigInt(precision.length);
      cursor = pattern.lastIndex;
      if (total > 0x7fffffffffffffffn) return undefined;
    }
    if (!cursor || cursor !== text.length || (negative && total > 0n)) return undefined;
    return Number(total) / 1e6;
  }
  return nanoseconds !== undefined &&
    Number.isFinite(nanoseconds) &&
    nanoseconds >= 0 &&
    nanoseconds < 2 ** 63
    ? nanoseconds / 1e6
    : undefined;
}
export function quotaSignal(status: number, body: string): QuotaSignal | undefined {
  if (status !== 429 && status !== 503) return undefined;
  let error: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && isRecord(parsed.error)) error = parsed.error;
  } catch {
    /* text fallback */
  }
  let reason = "",
    model: string | undefined,
    delay: number | undefined;
  for (const detail of Array.isArray(error.details) ? error.details : []) {
    if (!isRecord(detail)) continue;
    const type = String(detail["@type"] ?? "");
    if (type.endsWith("google.rpc.ErrorInfo")) {
      if (!reason && typeof detail.reason === "string") reason = detail.reason.trim().toUpperCase();
      if (isRecord(detail.metadata)) {
        if (typeof detail.metadata.model === "string")
          model ??= detail.metadata.model
            .toLowerCase()
            .split("/models/")
            .pop()
            ?.replace(/^models\//, "");
        delay ??= durationMillis(detail.metadata.quotaResetDelay);
      }
    }
    if (type.endsWith("google.rpc.RetryInfo")) delay = durationMillis(detail.retryDelay) ?? delay;
  }
  const lower = body.toLowerCase();
  if (reason === "MODEL_CAPACITY_EXHAUSTED") return { kind: "capacity", delay, model, reason };
  if (reason === "QUOTA_EXHAUSTED") return { kind: "quota", delay, model, reason };
  if (reason === "RATE_LIMIT_EXCEEDED")
    return {
      kind: delay !== undefined && delay >= 300_000 ? "quota" : "rate",
      delay,
      model,
      reason,
    };
  if (lower.includes("model_capacity_exhausted")) return { kind: "capacity", delay, model, reason };
  if (/quota_exhausted|quota exhausted|exhausted your capacity on this model/.test(lower))
    return { kind: "quota", delay, model, reason };
  if (
    status === 429 &&
    (String(error.status ?? "")
      .trim()
      .toUpperCase() === "RESOURCE_EXHAUSTED" ||
      delay !== undefined)
  )
    return { kind: "rate", delay, model, reason };
  return undefined;
}
export class SameEndpointBudget {
  capacity = 0;
  instant = 0;
  delay(status: number, text: string): number | undefined {
    const quota = quotaSignal(status, text);
    if (quota?.kind === "capacity" && this.capacity < 8) {
      this.capacity++;
      return quota.delay && quota.delay < 3000 ? quota.delay : 1000;
    }
    if (quota?.kind === "rate" && quota.delay && quota.delay < 3000 && this.instant < 2) {
      this.instant++;
      return quota.delay;
    }
    return undefined;
  }
}
export class GenerationHTTPError extends Error {
  readonly status: number;
  readonly body: string;
  readonly fromBody: boolean;
  readonly headers?: Headers;
  constructor(status: number, body: string, fromBody = false, headers?: Headers) {
    let message = body;
    try {
      const value: unknown = JSON.parse(body);
      if (isRecord(value) && isRecord(value.error) && typeof value.error.message === "string")
        message = value.error.message;
    } catch {
      /* plain HTTP error */
    }
    super(`Antigravity HTTP ${status}: ${safeError(message).slice(0, 400)}`);
    this.status = status;
    this.body = body;
    this.fromBody = fromBody;
    this.headers = headers;
  }
}
export async function boundedErrorBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024 * 1024) throw new Error("Antigravity error response exceeds 1 MiB");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export type GenerationDispatchOptions = {
  /** Native hosts own account routing; never cross into Pi's active-account pool. */
  accountPolicy?: "caller";
  credentials: AntigravityApiKey;
  model: string;
  build: (projectId: string) => object | Promise<object>;
  method?: "generateContent" | "streamGenerateContent";
  onAccount?: (credentials: AntigravityApiKey) => void;
  send: (url: string, init: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
  sleep?: typeof abortableDelay;
};
export async function executeCodexGeneration(
  options: GenerationDispatchOptions,
): Promise<Response> {
  let credentials = options.credentials;
  const tried = new Set<string>([credentials.token]);
  const refreshed = new Set<string>();
  for (;;) {
    options.signal?.throwIfAborted();
    if (options.accountPolicy !== "caller" && !accountAvailable(credentials.token, options.model)) {
      const next =
        options.accountPolicy === "caller"
          ? undefined
          : await failoverToNextAccount(tried, options.model);
      if (!next) throw new Error("Antigravity account is blocked or model quota is cooling down");
      credentials = next;
      tried.add(next.token);
      continue;
    }
    try {
      options.onAccount?.(credentials);
      return await dispatchAccount(credentials);
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!(error instanceof GenerationHTTPError)) throw error;
      if (
        options.accountPolicy !== "caller" &&
        error.status === 401 &&
        !refreshed.has(credentials.token)
      ) {
        refreshed.add(credentials.token);
        const next = await refreshAccountAfterUnauthorized(credentials.token);
        if (next && !tried.has(next.token)) {
          credentials = next;
          tried.add(next.token);
          refreshed.add(next.token);
          continue;
        }
      }
      if (options.accountPolicy !== "caller")
        observeConsumerFailure(
          credentials.token,
          options.model,
          error.status,
          error.body,
          error.headers,
        );
      const quota = quotaSignal(error.status, error.body);
      if (quota?.kind !== "capacity" && (error.status === 429 || quota)) {
        const next =
          options.accountPolicy === "caller"
            ? undefined
            : await failoverToNextAccount(tried, options.model);
        if (next) {
          credentials = next;
          tried.add(next.token);
          continue;
        }
      }
      throw error;
    }
  }
  async function dispatchAccount(account: AntigravityApiKey): Promise<Response> {
    const body = JSON.stringify(await options.build(account.projectId));
    const budget = new SameEndpointBudget();
    let userProject = /^(1|true|yes|on)$/i.test(
      antigravityEnv("X_GOOG_USER_PROJECT_ENABLED")?.trim() ?? "",
    );
    let last: GenerationHTTPError | undefined;
    let transportError: unknown;
    for (let headerAttempt = 0; headerAttempt < 2; headerAttempt++) {
      let retryWithoutUserProject = false;
      for (const endpoint of endpointCandidates()) {
        options.signal?.throwIfAborted();
        setLastEndpoint(endpoint);
        setLastProjectId(account.projectId);
        for (;;) {
          let response: Response;
          try {
            response = await options.send(
              `${endpoint}/v1internal:${options.method === "generateContent" ? "generateContent" : "streamGenerateContent?alt=sse"}`,
              {
                method: "POST",
                headers: {
                  ...antigravityHeaders(account.token),
                  ...(userProject ? { "x-goog-user-project": account.projectId } : {}),
                },
                body,
                signal: options.signal,
                redirect: "error",
              },
            );
          } catch (error) {
            options.signal?.throwIfAborted();
            transportError = error;
            break;
          }
          setLastStatus(response.status);
          if (response.ok) return response;
          const text = await boundedErrorBody(response);
          last = new GenerationHTTPError(response.status, text, false, response.headers);
          if (response.status === 408 || response.status === 429 || response.status >= 500) {
            const delay = budget.delay(response.status, text);
            if (delay !== undefined) {
              await (options.sleep ?? abortableDelay)(delay, options.signal);
              continue;
            }
            break;
          }
          if (response.status === 403 && userProject) {
            userProject = false;
            retryWithoutUserProject = true;
            break;
          }
          if (
            response.status === 404 ||
            (response.status === 403 && /"(?:reason|status)"\s*:\s*"SERVICE_DISABLED"/i.test(text))
          )
            break;
          throw last;
        }
        if (retryWithoutUserProject) break;
      }
      if (!retryWithoutUserProject) break;
    }
    if (last) throw last;
    throw transportError instanceof Error
      ? transportError
      : new Error("Antigravity endpoints unavailable");
  }
}

/** Same persistent classification for HTTP failures and errors inside HTTP-200 SSE/JSON.
 * Observers never dispatch: a consumed frame can NEVER trigger request replay. */
export function observeConsumerFailure(
  token: string,
  model: string,
  status: number,
  body: string,
  headers?: Headers,
  write: typeof markAccountHealth = markAccountHealth,
): void {
  const quota = quotaSignal(status, body);
  const block = status === 403 ? /VALIDATION_REQUIRED|TOS_VIOLATION/.exec(body)?.[0] : undefined;
  const failure = {
    at: Date.now(),
    status,
    model,
    kind: block ?? quota?.kind ?? (status === 401 ? "auth" : status >= 500 ? "upstream" : "client"),
  };
  if (status !== 429 && !quota) {
    write(token, model, { block, failure });
    return;
  }
  let cooldown =
    quota?.kind === "capacity"
      ? 10_000
      : quota?.delay && quota.delay > 0
        ? quota.delay
        : quota?.kind === "quota"
          ? 300_000
          : quota?.reason
            ? 30_000
            : 5000;
  if (quota?.delay === undefined && headers?.has("retry-after")) {
    const raw = headers.get("retry-after")!;
    const value = /^\d+$/.test(raw.trim()) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
    if (Number.isFinite(value) && value > 0) cooldown = value;
  }
  write(token, model, {
    failure,
    block,
    cooldownMs: Math.min(1_800_000, Math.max(1000, cooldown)),
    familyQuota: quota?.kind === "quota",
    quotaModel: quota?.model,
  });
}
export function consumerErrorStatus(error: Record<string, unknown>): number {
  const code =
    typeof error.code === "number"
      ? Math.trunc(error.code)
      : typeof error.code === "string" && /^[+-]?\d+$/.test(error.code.trim())
        ? Number(error.code.trim())
        : 0;
  if (code >= 400 && code <= 599) return code;
  const statuses: Record<string, number> = {
    INVALID_ARGUMENT: 400,
    FAILED_PRECONDITION: 400,
    OUT_OF_RANGE: 400,
    UNAUTHENTICATED: 401,
    PERMISSION_DENIED: 403,
    NOT_FOUND: 404,
    ALREADY_EXISTS: 409,
    ABORTED: 409,
    RESOURCE_EXHAUSTED: 429,
    UNIMPLEMENTED: 501,
    INTERNAL: 500,
    UNKNOWN: 500,
    DATA_LOSS: 500,
    UNAVAILABLE: 503,
    DEADLINE_EXCEEDED: 504,
  };
  return (
    statuses[
      String(error.status ?? "")
        .trim()
        .toUpperCase()
    ] ?? 502
  );
}
export function observeConsumerDocument(
  token: string,
  model: string,
  document: unknown,
  persist = true,
): void {
  if (!isRecord(document)) return;
  const envelope =
    !Object.hasOwn(document, "error") && isRecord(document.response) ? document.response : document;
  if (!Object.hasOwn(envelope, "error")) return;
  const error = isRecord(envelope.error) ? envelope.error : {};
  const status = consumerErrorStatus(error);
  const body = JSON.stringify({ error });
  if (persist) observeConsumerFailure(token, model, status, body);
  throw new GenerationHTTPError(status, body, true);
}
/** Bound nonstream responses without a buffering .json() call. */
export async function readConsumerJson(
  response: Response,
  maxBytes = 32 * 1024 * 1024,
): Promise<unknown> {
  if (!response.body) throw new Error("Antigravity returned an empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maxBytes) throw new Error("Antigravity JSON response exceeds its size limit");
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
