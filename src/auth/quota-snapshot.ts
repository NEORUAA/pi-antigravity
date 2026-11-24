/** Pinned codex2api auth/antigravity_client.go Sync quota/summary/credits steps,
 * with local V2 group observations (quota_gate.go/quota_family.go). No polling. */
import { DAILY, PRODUCTION, SANDBOX, profileUserAgent } from "../compat/profile.js";
import { isRecord, antigravityEnv } from "../utils/util.js";
import { postControl, ControlPlaneError } from "./control-plane.js";

export type QuotaBucket = {
  bucketId: string;
  window: string;
  remainingFraction?: number;
  fractionPresent: boolean;
  resetTime: string;
  observedAt: number;
  observationSeq: number;
  ttlSeconds: number;
};
export type QuotaGroup = { displayName: string; description: string; buckets: QuotaBucket[] };
export type QuotaSnapshot = {
  schemaVersion: 2;
  updatedAt: number;
  forbidden: boolean;
  models: Array<{
    modelId: string;
    remainingFraction?: number;
    fractionPresent: boolean;
    resetTime: string;
    remainingPercent: number;
    displayName?: string;
    supportsImages?: boolean;
    supportsThinking?: boolean;
    thinkingBudget?: number;
    recommended?: boolean;
    maxTokens?: number;
    maxOutputTokens?: number;
    supportedMimeTypes?: Record<string, boolean>;
  }>;
  catalogModelIds: string[];
  internalModelIds: string[];
  modelForwardingRules: Record<string, string>;
  groups: QuotaGroup[];
  groupsMeta?: { appliedSeq: number; observedAt: number; summaryIntegrity: boolean };
  aiCredits?: number;
  groupsObserved: boolean;
  aiCreditsObserved: boolean;
  warnings: string[];
};
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const bases = [SANDBOX, DAILY, PRODUCTION];
const status = (error: unknown): number => (error instanceof ControlPlaneError ? error.status : 0);
export function normalizeQuotaModels(payload: Record<string, unknown>, now: number): QuotaSnapshot {
  const snapshot: QuotaSnapshot = {
    schemaVersion: 2,
    updatedAt: now,
    forbidden: false,
    models: [],
    catalogModelIds: [],
    internalModelIds: [],
    modelForwardingRules: {},
    groups: [],
    groupsObserved: false,
    aiCreditsObserved: false,
    warnings: [],
  };
  if (isRecord(payload.models))
    for (const [id, value] of Object.entries(payload.models)) {
      if (!isRecord(value)) continue;
      const trimmed = id.trim();
      if (
        Buffer.byteLength(trimmed) > 0 &&
        Buffer.byteLength(trimmed) <= 200 &&
        !/[\r\n\t ]/.test(trimmed)
      ) {
        snapshot.catalogModelIds.push(trimmed);
        if (value.isInternal === true) snapshot.internalModelIds.push(trimmed);
      }
      if (
        !/^(gemini|claude|gpt|image|imagen)/.test(id.trim().toLowerCase()) ||
        !isRecord(value.quotaInfo)
      )
        continue;
      const raw = value.quotaInfo.remainingFraction;
      const fraction =
        typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : undefined;
      snapshot.models.push({
        modelId: id,
        displayName: text(value.displayName),
        supportsImages:
          typeof value.supportsImages === "boolean" ? value.supportsImages : undefined,
        supportsThinking:
          typeof value.supportsThinking === "boolean" ? value.supportsThinking : undefined,
        thinkingBudget: typeof value.thinkingBudget === "number" ? value.thinkingBudget : undefined,
        recommended: typeof value.recommended === "boolean" ? value.recommended : undefined,
        maxTokens: typeof value.maxTokens === "number" ? value.maxTokens : undefined,
        maxOutputTokens:
          typeof value.maxOutputTokens === "number" ? value.maxOutputTokens : undefined,
        supportedMimeTypes: isRecord(value.supportedMimeTypes)
          ? (Object.fromEntries(
              Object.entries(value.supportedMimeTypes).filter(([, v]) => typeof v === "boolean"),
            ) as Record<string, boolean>)
          : undefined,
        fractionPresent: fraction !== undefined,
        remainingFraction: fraction,
        remainingPercent: Math.trunc((fraction ?? 0) * 100),
        resetTime: text(value.quotaInfo.resetTime),
      });
    }
  snapshot.models.sort((a, b) => Buffer.compare(Buffer.from(a.modelId), Buffer.from(b.modelId)));
  const byteSort = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
  snapshot.catalogModelIds.sort(byteSort);
  snapshot.internalModelIds.sort(byteSort);
  if (isRecord(payload.deprecatedModelIds))
    for (const [id, rule] of Object.entries(payload.deprecatedModelIds)) {
      if (id.trim() && isRecord(rule) && text(rule.newModelId).trim())
        snapshot.modelForwardingRules[id] = text(rule.newModelId).trim();
    }
  return snapshot;
}
export function normalizeWindow(raw: string): "5h" | "weekly" | undefined {
  const key = raw.trim().toLowerCase();
  if (["5h", "five_hour", "5_hour", "fivehour"].includes(key)) return "5h";
  if (["weekly", "week", "7d", "seven_day"].includes(key)) return "weekly";
  return undefined;
}
export function validateQuotaReset(
  raw: string,
  observedAt: number,
  window: string,
): number | undefined {
  // Date.parse alone accepts dates/rollovers which Go time.Parse(RFC3339) rejects.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(raw.trim())) return;
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/.exec(raw.trim())!;
  const [, y, m, d, h, min, sec] = match.map(Number);
  if (
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate() ||
    h > 23 ||
    min > 59 ||
    sec > 59
  )
    return;
  const reset = Date.parse(raw.trim().replace(",", "."));
  const max = window === "5h" ? 6 * 3600_000 : window === "weekly" ? 8 * 86400_000 : 0;
  return reset > observedAt && reset - observedAt <= max ? reset : undefined;
}
export function bucketFamily(id: string): string {
  id = id.trim().toLowerCase();
  return id.includes("argon")
    ? "argon"
    : id.startsWith("3p")
      ? "3p"
      : id.startsWith("gemini")
        ? "gemini"
        : "";
}
/** Same family fallback as c2a auth/antigravity_quota_family.go:77–109.
 * Shared by enforcement and presentation; labels and percentages are not scope evidence.
 */
export function modelQuotaFamily(snapshot: QuotaSnapshot | undefined, model: string): string {
  const modelId = model
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");
  let family = modelId.includes("argon")
    ? "argon"
    : modelId.startsWith("gemini")
      ? "gemini"
      : /^(claude|gpt)/.test(modelId)
        ? "3p"
        : "";
  if (
    family === "argon" &&
    !snapshot?.groups
      .flatMap((g) => g.buckets)
      .some((b) => normalizeWindow(b.window) && bucketFamily(b.bucketId) === "argon")
  )
    family = "gemini";
  return family;
}
export function quotaGate(
  snapshot: QuotaSnapshot | undefined,
  model: string,
  now = Date.now(),
): { blocked: boolean; resetAt?: number; reason?: string } {
  if (!snapshot) return { blocked: false };
  if (snapshot.forbidden) return { blocked: true, reason: "quota_access_denied" };
  if (antigravityEnv("QUOTA_GATE_ENABLED") === "0") return { blocked: false };
  const meta = snapshot.groupsMeta;
  if (
    snapshot.schemaVersion !== 2 ||
    !meta ||
    !(meta.appliedSeq > 0) ||
    !(meta.observedAt > 0) ||
    meta.observedAt > now
  )
    return { blocked: false };
  const buckets = snapshot.groups.flatMap((group) => group.buckets);
  const modelId = model
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");
  const family = modelQuotaFamily(snapshot, modelId);
  const evaluate = (include: (family: string) => boolean) => {
    let resetAt: number | undefined, reason: string | undefined;
    for (const bucket of buckets) {
      const scope = bucketFamily(bucket.bucketId);
      if (!include(scope)) continue;
      const window = normalizeWindow(bucket.window);
      if (!window || !bucket.fractionPresent || bucket.remainingFraction !== 0) continue;
      const trustedReset = validateQuotaReset(bucket.resetTime, bucket.observedAt, window);
      const end = trustedReset ?? bucket.observedAt + bucket.ttlSeconds * 1000;
      if (now < end && (resetAt === undefined || end > resetAt)) {
        resetAt = end;
        reason =
          trustedReset && now > bucket.observedAt + bucket.ttlSeconds * 1000
            ? "stale_zero"
            : "known_zero";
      }
    }
    return { blocked: resetAt !== undefined, resetAt, reason };
  };
  const targeted = evaluate((scope) => !family || !scope || scope === family);
  if (modelId && targeted.blocked) return targeted;
  // Account-wide fallback: unknown-family zero blocks everyone; otherwise an
  // account is wholly exhausted only if EVERY observed family is blocked.
  const unknown = evaluate((scope) => !scope);
  if (unknown.blocked) return unknown;
  const families = new Set(
    buckets
      .filter((b) => normalizeWindow(b.window))
      .map((b) => bucketFamily(b.bucketId))
      .filter(Boolean),
  );
  const all = [...families].map((f) => evaluate((scope) => scope === f));
  if (all.length && all.every((item) => item.blocked))
    return all.reduce((a, b) => ((a.resetAt ?? Infinity) < (b.resetAt ?? Infinity) ? a : b));
  return { blocked: false };
}
export type SnapshotOptions = {
  signal?: AbortSignal;
  previous?: QuotaSnapshot;
  now?: () => number;
};
/** Only call with revalidated profile/project identity. A caller must drop previous
 * whenever the verified email or project changes. 401 is terminal to this step:
 * OAuth orchestrator performs at most one refresh + full identity rebuild. */
export async function fetchQuotaSnapshot(
  token: string,
  projectId: string,
  options: SnapshotOptions = {},
): Promise<QuotaSnapshot> {
  const now = options.now ?? Date.now;
  const payload = projectId.trim() ? { project: projectId.trim() } : {};
  let snapshot: QuotaSnapshot | undefined, last: unknown;
  for (const [index, base] of bases.entries()) {
    let body = payload;
    for (let attempt = 0; attempt < 2; attempt++) {
      options.signal?.throwIfAborted();
      try {
        const result = await postControl(token, base, "fetchAvailableModels", body, options.signal);
        if (!isRecord(result)) throw new Error("Invalid quota catalog response");
        snapshot = normalizeQuotaModels(result, now());
        break;
      } catch (error) {
        options.signal?.throwIfAborted();
        last = error;
        const code = status(error);
        if (code === 403 && Object.keys(body).length && attempt === 0) {
          body = {};
          continue;
        }
        if (code === 403) {
          if (index === bases.length - 1) {
            snapshot = normalizeQuotaModels({}, now());
            snapshot.forbidden = true;
          }
          break;
        }
        if (code === 401 || (code !== 0 && code !== 429 && code < 500)) throw error;
        break;
      }
    }
    if (snapshot) break;
  }
  if (!snapshot)
    throw last instanceof Error ? last : new Error("Antigravity quota catalog unavailable");
  const previous = options.previous;
  // Retain prior observations only within caller-verified identity scope; failures
  // and empty summaries must not wash an old known-zero fact into a new timestamp.
  snapshot.groups = previous?.groups ?? [];
  snapshot.groupsMeta = previous?.groupsMeta;
  for (const base of bases) {
    options.signal?.throwIfAborted();
    const observedAt = now();
    try {
      const result = await postControl(
        token,
        base,
        "retrieveUserQuotaSummary",
        payload,
        options.signal,
      );
      if (!isRecord(result)) throw new Error("Invalid quota summary response");
      snapshot.groupsObserved = true;
      if (Array.isArray(result.groups) && result.groups.length > 0) {
        const seq = (previous?.groupsMeta?.appliedSeq ?? 0) + 1;
        snapshot.groups = result.groups.filter(isRecord).map((group) => ({
          displayName: text(group.displayName),
          description: text(group.description),
          buckets: (Array.isArray(group.buckets) ? group.buckets : [])
            .filter(isRecord)
            .map((bucket) => ({
              bucketId: text(bucket.bucketId),
              window: normalizeWindow(text(bucket.window)) ?? text(bucket.window),
              remainingFraction:
                typeof bucket.remainingFraction === "number" ? bucket.remainingFraction : undefined,
              fractionPresent: typeof bucket.remainingFraction === "number",
              resetTime: text(bucket.resetTime),
              observedAt,
              observationSeq: seq,
              ttlSeconds: 7200,
            })),
        }));
        snapshot.groupsMeta = { appliedSeq: seq, observedAt, summaryIntegrity: true };
      } else snapshot.warnings.push("quota_summary_incomplete");
      break;
    } catch (error) {
      options.signal?.throwIfAborted();
      const code = status(error);
      if (code >= 400 && code < 500 && ![403, 404, 429].includes(code)) break;
    }
  }
  if (!snapshot.groupsObserved) snapshot.warnings.push("quota_summary_unavailable");
  const product = profileUserAgent().trim().split(" ")[0];
  const version = /^(?:antigravity\/hub\/|antigravity\/)(.+)$/i.exec(product)?.[1] ?? "2.19.1";
  try {
    const result = await postControl(
      token,
      DAILY,
      "loadCodeAssist",
      { metadata: { ide_type: "ANTIGRAVITY", ide_version: version, ide_name: "antigravity" } },
      options.signal,
    );
    if (!isRecord(result)) throw new Error("Invalid AI credits response");
    const credits =
      isRecord(result.paidTier) && Array.isArray(result.paidTier.availableCredits)
        ? result.paidTier.availableCredits
        : [];
    if (!credits.length) snapshot.aiCreditsObserved = true;
    else if (isRecord(credits[0])) {
      const raw = credits[0].creditAmount;
      const parsed =
        raw == null
          ? 0
          : typeof raw === "number" || (typeof raw === "string" && raw.trim())
            ? Number(raw)
            : NaN;
      if (Number.isFinite(parsed)) {
        snapshot.aiCredits = parsed;
        snapshot.aiCreditsObserved = true;
      }
    }
  } catch {
    options.signal?.throwIfAborted();
  }
  if (!snapshot.aiCreditsObserved) {
    snapshot.warnings.push("ai_credits_unavailable");
    snapshot.aiCredits = previous?.aiCredits;
  }
  return snapshot;
}
