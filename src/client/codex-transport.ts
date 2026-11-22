/** Consumer request dispatch adapted from codex2api d8e1981f's
 * proxy/antigravity_responses.go and antigravity_quota.go. */
import type { AntigravityApiKey, AntigravityGenerateRequest } from "../types/types.js";
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

export type QuotaSignal = { kind: "rate" | "quota" | "capacity"; delay?: number; model?: string };
export function durationMillis(value: unknown): number | undefined {
  let result: number | undefined;
  if (typeof value === "number") result = value * 1000;
  if (isRecord(value) && ("seconds" in value || "nanos" in value))
    result = Number(value.seconds ?? 0) * 1000 + Number(value.nanos ?? 0) / 1e6;
  if (typeof value === "string" && /^(?:\d+(?:\.\d+)?(?:h|m|s|ms|us|µs|ns))+$/.test(value)) {
    const units: Record<string, number> = {
      h: 3_600_000,
      m: 60_000,
      s: 1000,
      ms: 1,
      us: 0.001,
      µs: 0.001,
      ns: 0.000001,
    };
    result = Array.from(value.matchAll(/(\d+(?:\.\d+)?)(ms|us|µs|ns|h|m|s)/g)).reduce(
      (sum, match) => sum + Number(match[1]) * units[match[2]],
      0,
    );
  }
  return result !== undefined && Number.isFinite(result) && result >= 0 ? result : undefined;
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
  if (
    reason === "MODEL_CAPACITY_EXHAUSTED" ||
    (!reason && lower.includes("model_capacity_exhausted"))
  )
    return { kind: "capacity", delay, model };
  if (
    reason === "QUOTA_EXHAUSTED" ||
    (!reason && /quota_exhausted|quota exhausted|exhausted your capacity on this model/.test(lower))
  )
    return { kind: "quota", delay, model };
  if (reason === "RATE_LIMIT_EXCEEDED")
    return { kind: delay !== undefined && delay >= 300_000 ? "quota" : "rate", delay, model };
  if (status === 429 && (error.status === "RESOURCE_EXHAUSTED" || delay !== undefined))
    return { kind: "rate", delay, model };
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
  constructor(status: number, body: string) {
    super(`Antigravity HTTP ${status}: ${safeError(body).slice(0, 400)}`);
    this.status = status;
    this.body = body;
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
  credentials: AntigravityApiKey;
  model: string;
  build: (projectId: string) => AntigravityGenerateRequest | Promise<AntigravityGenerateRequest>;
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
    if (!accountAvailable(credentials.token, options.model)) {
      const next = await failoverToNextAccount(tried, options.model);
      if (!next) throw new Error("Antigravity account is blocked or model quota is cooling down");
      credentials = next;
      tried.add(next.token);
      continue;
    }
    try {
      return await dispatchAccount(credentials);
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!(error instanceof GenerationHTTPError)) throw error;
      if (error.status === 401 && !refreshed.has(credentials.token)) {
        refreshed.add(credentials.token);
        const next = await refreshAccountAfterUnauthorized(credentials.token);
        if (next && !tried.has(next.token)) {
          credentials = next;
          tried.add(next.token);
          refreshed.add(next.token);
          continue;
        }
      }
      if (error.status === 403) {
        const reason = /VALIDATION_REQUIRED|TOS_VIOLATION/.exec(error.body)?.[0];
        if (reason) markAccountHealth(credentials.token, options.model, { block: reason });
      }
      const quota = quotaSignal(error.status, error.body);
      if (error.status === 429 && quota?.kind !== "capacity") {
        const cooldown =
          quota?.delay ??
          (quota?.kind === "quota" ? 300_000 : quota?.kind === "rate" ? 5000 : 30_000);
        markAccountHealth(credentials.token, options.model, {
          cooldownMs: Math.min(1_800_000, Math.max(1, cooldown)),
        });
        const next = await failoverToNextAccount(tried, options.model);
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
            response = await options.send(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
              method: "POST",
              headers: {
                ...antigravityHeaders(account.token),
                ...(userProject ? { "x-goog-user-project": account.projectId } : {}),
              },
              body,
              redirect: "error",
            });
          } catch (error) {
            options.signal?.throwIfAborted();
            transportError = error;
            break;
          }
          setLastStatus(response.status);
          if (response.ok) return response;
          const text = await boundedErrorBody(response);
          last = new GenerationHTTPError(response.status, text);
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
