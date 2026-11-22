/** loadCodeAssist/onboardUser application behavior, adapted from codex2api's
 * auth/antigravity_client.go at d8e1981f. See the provenance/limits document. */
import { antigravityFetch } from "../utils/http.js";
import { antigravityEnv, isRecord } from "../utils/util.js";
import { safeError } from "../utils/security.js";
import { abortableDelay, DAILY, PRODUCTION, SANDBOX, profileHeaders } from "../compat/profile.js";

export type Tier = {
  id?: string;
  name?: string;
  quotaTier?: string;
  isDefault?: boolean;
  is_default?: boolean;
  userDefinedCloudaicompanionProject?: boolean;
};
export type IdentityContext = {
  projectId: string;
  currentTier?: Tier;
  paidTier?: Tier;
  allowedTiers?: Tier[];
  ineligibleTiers?: unknown[];
};
export class ControlPlaneError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function project(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isRecord(value) && typeof value.id === "string" && value.id.trim()) return value.id.trim();
  return undefined;
}
export function selectOnboardTier(context: Omit<IdentityContext, "projectId">): string {
  return (
    context.allowedTiers
      ?.find((tier) => (tier.isDefault || tier.is_default) && tier.id?.trim())
      ?.id?.trim() ||
    context.currentTier?.id?.trim() ||
    "free-tier"
  );
}
async function post(
  token: string,
  base: string,
  method: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(30_000);
  const res = await antigravityFetch(`${base}/v1internal:${method}`, {
    method: "POST",
    headers: {
      ...profileHeaders(token),
      ...(method === "onboardUser" ? { "X-Goog-Api-Client": "gl-node/22.21.1" } : {}),
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: "error",
  });
  // Bound control-plane responses just like the Go client (4 MiB).
  const data = await readControlJSON(res);
  if (!res.ok)
    throw new ControlPlaneError(
      res.status,
      `Antigravity ${method} HTTP ${res.status}: ${safeError(JSON.stringify(data)).slice(0, 300)}`,
    );
  return data;
}
export async function readControlJSON(res: {
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
      releaseLock(): void;
    };
  } | null;
}): Promise<unknown> {
  if (!res.body) throw new Error("Empty Antigravity control-plane response");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      size += next.value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error("Antigravity response exceeds 4 MiB");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export type ControlPlaneOptions = {
  signal?: AbortSignal;
  userProjectId?: string;
  /** Dependency injection for offline contract tests; never configured by an upstream response. */
  loadBases?: string[];
  onboardBases?: string[];
  sleep?: typeof abortableDelay;
};
export async function provisionIdentity(
  token: string,
  options: ControlPlaneOptions = {},
): Promise<IdentityContext> {
  const userProject = options.userProjectId ?? antigravityEnv("PROJECT_ID")?.trim();
  const metadata: Record<string, string> = { ideType: "ANTIGRAVITY" };
  const body: Record<string, unknown> = { metadata };
  if (userProject) {
    body.cloudaicompanionProject = userProject;
    metadata.duetProject = userProject;
  }
  let loaded: Record<string, unknown> | undefined;
  let lastError: unknown = new Error("Antigravity loadCodeAssist did not succeed");
  for (const base of options.loadBases ?? [PRODUCTION, SANDBOX, DAILY]) {
    options.signal?.throwIfAborted();
    try {
      const result = await post(token, base, "loadCodeAssist", body, options.signal);
      if (!isRecord(result)) throw new Error("Invalid loadCodeAssist response");
      loaded = result;
      break;
    } catch (error) {
      options.signal?.throwIfAborted();
      lastError = error;
      // Go fetchEntitlements stops on status<500 except 429, including transport status=0.
      if (!(error instanceof ControlPlaneError) || (error.status !== 429 && error.status < 500))
        throw error;
    }
  }
  if (!loaded) throw lastError;
  const context: IdentityContext = {
    projectId: project(loaded.cloudaicompanionProject) ?? "",
    currentTier: isRecord(loaded.currentTier) ? loaded.currentTier : undefined,
    paidTier: isRecord(loaded.paidTier) ? loaded.paidTier : undefined,
    allowedTiers: Array.isArray(loaded.allowedTiers) ? loaded.allowedTiers.filter(isRecord) : [],
    ineligibleTiers: Array.isArray(loaded.ineligibleTiers) ? loaded.ineligibleTiers : [],
  };
  if (!context.projectId && context.currentTier && userProject) context.projectId = userProject;
  if (context.projectId) return context;
  const tierId = selectOnboardTier(context);
  const onboardMetadata: Record<string, string> = {
    ideType: "ANTIGRAVITY",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  };
  const onboardBody: Record<string, unknown> = { tierId, metadata: onboardMetadata };
  if (userProject && tierId !== "free-tier") {
    onboardBody.cloudaicompanionProject = userProject;
    onboardMetadata.duetProject = userProject;
  }
  for (const base of options.onboardBases ?? [DAILY, PRODUCTION]) {
    for (let attempt = 0; attempt < 5; attempt++) {
      options.signal?.throwIfAborted();
      if (attempt) await (options.sleep ?? abortableDelay)(2_000, options.signal);
      let response: unknown;
      try {
        response = await post(token, base, "onboardUser", onboardBody, options.signal);
      } catch (error) {
        options.signal?.throwIfAborted();
        lastError = error;
        if (!(error instanceof ControlPlaneError) || (error.status !== 429 && error.status < 500))
          break;
        continue;
      }
      if (!isRecord(response)) throw new Error("Invalid onboardUser response");
      const provisioned = isRecord(response.response)
        ? project(response.response.cloudaicompanionProject)
        : undefined;
      if (provisioned) return { ...context, projectId: provisioned };
      if (response.done !== true) {
        lastError = new Error("onboardUser operation is still pending");
        continue;
      }
      if (userProject) return { ...context, projectId: userProject };
      lastError = new Error(
        `onboardUser completed without a project id (tier ${tierId}); Workspace/enterprise tiers may require ANTIGRAVITY_PROJECT_ID`,
      );
      break;
    }
  }
  throw lastError;
}
