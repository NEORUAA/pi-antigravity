import {
  validatedCredential,
  verifiedCredentialForToken,
  credentialNeedsRecovery,
  sameCredentialFamily,
  revokeCredentialCheckpoint,
  checkpointTokenUsable,
  CredentialCheckpointError,
} from "./checkpoint.js";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { defaultProjectId } from "../client/client.js";
import type { AntigravityApiKey, AntigravityOAuthCredentials } from "../types/types.js";
import { quotaGate } from "./quota-snapshot.js";
import { legacyProfile } from "../compat/profile.js";
import { OAuthRefreshError, refreshAntigravityToken } from "./oauth.js";

const ACCOUNTS_FILE = "antigravity-accounts.json";
const AUTH_FILE = "auth.json";
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export type StoredAccount = AntigravityOAuthCredentials & {
  accountId: string;
  addedAt: number;
  lastUsedAt: number;
  health?: {
    blockedReason?: string;
    cooldowns?: Record<string, number>;
    /** Sanitized outcome only: never persist raw upstream error bodies or tokens. */
    lastFailure?: { at: number; status: number; kind: string; model: string };
  };
};

type AccountsFile = {
  version: 1;
  activeAccountId?: string;
  accounts: Record<string, StoredAccount>;
};

export type AccountSummary = {
  accountId: string;
  email?: string;
  active: boolean;
  lastUsedAt: number;
  syncWarnings?: string[];
};

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function accountsPath(): string {
  return join(agentDir(), ACCOUNTS_FILE);
}

function authPath(): string {
  return join(agentDir(), AUTH_FILE);
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const fd = openSync(tempPath, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tempPath, path);
    chmodSync(path, 0o600);
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

function emptyStore(): AccountsFile {
  return { version: 1, accounts: {} };
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<StoredAccount>;
  return typeof account.refresh === "string" && account.refresh.length > 0;
}

function normalizeStore(value: Record<string, unknown> | undefined): AccountsFile {
  if (!value || value.version !== 1 || !value.accounts || typeof value.accounts !== "object") {
    return emptyStore();
  }
  const accounts: Record<string, StoredAccount> = {};
  for (const [key, raw] of Object.entries(value.accounts as Record<string, unknown>)) {
    if (!isStoredAccount(raw)) continue;
    const accountId =
      typeof raw.accountId === "string" && raw.accountId.trim() ? raw.accountId : key;
    accounts[accountId] = { ...raw, accountId };
  }
  const activeAccountId =
    typeof value.activeAccountId === "string"
      ? value.activeAccountId
      : typeof value.activeEmail === "string"
        ? value.activeEmail
        : undefined;
  return {
    version: 1,
    activeAccountId: activeAccountId && accounts[activeAccountId] ? activeAccountId : undefined,
    accounts,
  };
}

export function loadAccountStore(): AccountsFile {
  const parsed = readJsonObject(accountsPath());
  if (!legacyProfile() && existsSync(accountsPath()) && !parsed)
    throw new Error("Refusing to overwrite unreadable Antigravity account store");
  return normalizeStore(parsed);
}

function saveAccountStore(store: AccountsFile): void {
  writePrivateJson(accountsPath(), store);
}

function accountIdFor(credentials: OAuthCredentials): string {
  const email = (credentials as AntigravityOAuthCredentials).email?.trim().toLowerCase();
  if (email) return email;
  return `account-${createHash("sha256").update(credentials.refresh).digest("hex").slice(0, 16)}`;
}

function accountFromCredentials(
  credentials: AntigravityOAuthCredentials,
  existing?: StoredAccount,
): StoredAccount {
  if (!legacyProfile()) credentials = validatedCredential(credentials);
  const now = Date.now();
  return {
    ...existing,
    ...credentials,
    accountId: existing?.accountId || accountIdFor(credentials),
    addedAt: existing?.addedAt || now,
    lastUsedAt: now,
  };
}

function sortedAccounts(store: AccountsFile): StoredAccount[] {
  return Object.values(store.accounts).sort((a, b) => {
    if (a.addedAt !== b.addedAt) return a.addedAt - b.addedAt;
    return a.accountId.localeCompare(b.accountId);
  });
}

function findAccount(
  store: AccountsFile,
  credentials: OAuthCredentials,
): StoredAccount | undefined {
  const email = (credentials as AntigravityOAuthCredentials).email?.trim().toLowerCase();
  return Object.values(store.accounts).find(
    (account) =>
      account.refresh === credentials.refresh ||
      (!legacyProfile() &&
        (account.accountId === accountIdFor(credentials) ||
          sameCredentialFamily(account, credentials as AntigravityOAuthCredentials))) ||
      (email !== undefined && account.email?.trim().toLowerCase() === email),
  );
}

function findAccountId(store: AccountsFile, selector: string): string | undefined {
  const normalized = selector.trim().toLowerCase();
  if (!normalized) return undefined;
  const entries = sortedAccounts(store);
  if (/^\d+$/.test(normalized)) {
    const index = Number.parseInt(normalized, 10);
    if (index >= 1 && index <= entries.length) return entries[index - 1]?.accountId;
    return undefined;
  }
  return entries.find(
    (account) =>
      account.accountId.toLowerCase() === normalized ||
      account.email?.trim().toLowerCase() === normalized,
  )?.accountId;
}

function readAuthFile(): Record<string, unknown> {
  const path = authPath();
  if (!existsSync(path)) return {};
  const parsed = readJsonObject(path);
  if (!parsed) {
    throw new Error("Refusing to overwrite unreadable Pi auth.json");
  }
  return parsed;
}

function writeActiveCredential(account: StoredAccount | undefined): void {
  const auth = readAuthFile();
  if (account) {
    auth.antigravity = {
      type: "oauth",
      email: account.email,
      subject: account.subject,
      access: account.access,
      refresh: account.refresh,
      expires: account.expires,
      projectId: account.projectId,
      identity: account.identity,
      quota: account.quota,
      oauthClientKey: account.oauthClientKey,
      oauthClientId: account.oauthClientId,
      oauthClientSecret: account.oauthClientSecret,
      idToken: account.idToken,
      scope: account.scope,
    };
  } else {
    delete auth.antigravity;
  }
  writePrivateJson(authPath(), auth);
}

function currentAuthCredentials(): AntigravityOAuthCredentials | undefined {
  const current = readJsonObject(authPath())?.antigravity;
  if (!current || typeof current !== "object") return undefined;
  const record = current as Record<string, unknown>;
  if (typeof record.refresh !== "string" || !record.refresh) return undefined;
  return {
    subject: typeof record.subject === "string" ? record.subject : undefined,
    identity: record.identity as AntigravityOAuthCredentials["identity"],
    quota: record.quota as AntigravityOAuthCredentials["quota"],
    oauthClientKey: typeof record.oauthClientKey === "string" ? record.oauthClientKey : undefined,
    oauthClientId: typeof record.oauthClientId === "string" ? record.oauthClientId : undefined,
    oauthClientSecret:
      typeof record.oauthClientSecret === "string" ? record.oauthClientSecret : undefined,
    idToken: typeof record.idToken === "string" ? record.idToken : undefined,
    scope: typeof record.scope === "string" ? record.scope : undefined,
    access: typeof record.access === "string" ? record.access : "",
    refresh: record.refresh,
    expires: typeof record.expires === "number" ? record.expires : 0,
    projectId: typeof record.projectId === "string" ? record.projectId : undefined,
    email: typeof record.email === "string" ? record.email : undefined,
  };
}

export function syncCurrentAuth(): void {
  let credentials = currentAuthCredentials();
  if (!credentials) return;
  if (!legacyProfile()) {
    try {
      credentials = validatedCredential(credentials);
    } catch (error) {
      if (error instanceof CredentialCheckpointError) return;
      throw error;
    }
  }
  const store = loadAccountStore();
  const existing = findAccount(store, credentials);
  if (
    !legacyProfile() &&
    existing &&
    existing.access !== credentials.access &&
    existing.expires > credentials.expires
  )
    return;
  const account = accountFromCredentials(credentials, existing);
  store.accounts[account.accountId] = account;
  store.activeAccountId = account.accountId;
  saveAccountStore(store);
}

export function rememberAccount(credentials: AntigravityOAuthCredentials): StoredAccount {
  syncCurrentAuth();
  const store = loadAccountStore();
  const existing = findAccount(store, credentials);
  const account = accountFromCredentials(credentials, existing);
  account.health = {}; // Explicit fresh login clears permanent fences.
  store.accounts[account.accountId] = account;
  store.activeAccountId = account.accountId;
  saveAccountStore(store);
  return account;
}

export function updateRememberedAccount(
  previous: OAuthCredentials,
  credentials: AntigravityOAuthCredentials,
): void {
  const store = loadAccountStore();
  const existing = findAccount(store, previous);
  if (!existing) return;
  const account = accountFromCredentials(credentials, existing);
  delete store.accounts[existing.accountId];
  store.accounts[account.accountId] = account;
  if (store.activeAccountId === existing.accountId) {
    store.activeAccountId = account.accountId;
  }
  saveAccountStore(store);
}

export function listAccounts(): AccountSummary[] {
  syncCurrentAuth();
  const store = loadAccountStore();
  return sortedAccounts(store).map((account) => ({
    accountId: account.accountId,
    email: account.email,
    active: account.accountId === store.activeAccountId,
    lastUsedAt: account.lastUsedAt,
    syncWarnings: account.quota?.warnings.filter((value) =>
      [
        "quota_summary_incomplete",
        "quota_summary_unavailable",
        "ai_credits_unavailable",
        "entitlements_unavailable",
      ].includes(value),
    ),
  }));
}

async function ensureFresh(account: StoredAccount): Promise<StoredAccount> {
  if (!legacyProfile() && account.health?.blockedReason)
    throw new Error(`Antigravity account needs re-login: ${account.health.blockedReason}`);
  // expires already carries the SDK's five-minute lead; do not subtract it twice.
  if (!legacyProfile() && !checkpointTokenUsable(account.access))
    return accountFromCredentials(await refreshAntigravityToken(account), account);
  if (account.access && account.expires > Date.now() + (legacyProfile() ? REFRESH_SKEW_MS : 0))
    return account;
  return accountFromCredentials(await refreshAntigravityToken(account), account);
}

function apiKeyFor(account: StoredAccount): AntigravityApiKey {
  if (!legacyProfile() && !account.projectId)
    throw new Error("Antigravity account has no provisioned project. Re-login required.");
  const email = account.email?.trim();
  return {
    token: account.access,
    projectId: account.projectId || defaultProjectId(email || "antigravity-default"),
  };
}

export async function activateAccount(selector: string): Promise<StoredAccount> {
  syncCurrentAuth();
  const store = loadAccountStore();
  const accountId = findAccountId(store, selector);
  if (!accountId) throw new Error(`Antigravity account not found: ${selector}`);
  const existing = store.accounts[accountId];
  if (!existing) throw new Error(`Antigravity account not found: ${selector}`);
  const account = await ensureFresh(existing);
  const latest = loadAccountStore();
  const live = latest.accounts[account.accountId];
  if (!live) throw new Error("Antigravity account was removed during activation");
  account.health = live.health;
  if (!legacyProfile() && account.health?.blockedReason)
    throw new Error("Antigravity account became blocked during activation");
  account.lastUsedAt = Date.now();
  latest.accounts[account.accountId] = account;
  latest.activeAccountId = account.accountId;
  saveAccountStore(latest);
  writeActiveCredential(account);
  return account;
}

export async function removeAccount(selector: string): Promise<StoredAccount | undefined> {
  syncCurrentAuth();
  const store = loadAccountStore();
  const accountId = findAccountId(store, selector);
  if (!accountId) throw new Error(`Antigravity account not found: ${selector}`);
  const wasActive = store.activeAccountId === accountId;
  if (!legacyProfile()) revokeCredentialCheckpoint(store.accounts[accountId]);
  delete store.accounts[accountId];
  if (wasActive) store.activeAccountId = undefined;
  // Publish removal before any fallback-account network wait. Clearing the old
  // SDK projection also prevents syncCurrentAuth from importing it again.
  saveAccountStore(store);
  if (!wasActive) return undefined;
  writeActiveCredential(undefined);
  const next = sortedAccounts(store).sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
  if (!next) return undefined;
  let updated: StoredAccount;
  try {
    updated = await ensureFresh(next);
  } catch (error) {
    if (error instanceof OAuthRefreshError && error.permanent)
      markAccountHealth(next.access, "", { block: "oauth_refresh_invalid" });
    return undefined;
  }
  const latest = loadAccountStore();
  if (latest.activeAccountId) return latest.accounts[latest.activeAccountId];
  const live = latest.accounts[next.accountId];
  if (!live || (!legacyProfile() && live.health?.blockedReason)) return undefined;
  updated.health = live.health;
  updated.lastUsedAt = Date.now();
  latest.accounts[updated.accountId] = updated;
  latest.activeAccountId = updated.accountId;
  saveAccountStore(latest);
  writeActiveCredential(updated);
  return updated;
}

/**
 * Switch to the next stored account that has not already been tried in this request.
 * Used when Antigravity returns a hard quota wall (HTTP 429).
 */
export async function failoverToNextAccount(
  triedAccessTokens: ReadonlySet<string>,
  model?: string,
): Promise<AntigravityApiKey | undefined> {
  syncCurrentAuth();
  const store = loadAccountStore();
  const candidates = sortedAccounts(store).filter(
    (account) =>
      !triedAccessTokens.has(account.access) && (legacyProfile() || available(account, model)),
  );
  for (const candidate of candidates) {
    try {
      const account = await ensureFresh(candidate);
      if (!account.access || triedAccessTokens.has(account.access)) continue;
      account.lastUsedAt = Date.now();
      const latest = loadAccountStore();
      const live = latest.accounts[account.accountId];
      if (!live || (!legacyProfile() && !available(live, model))) continue;
      account.health = live.health;
      latest.accounts[account.accountId] = account;
      latest.activeAccountId = account.accountId;
      saveAccountStore(latest);
      writeActiveCredential(account);
      return apiKeyFor(account);
    } catch (error) {
      if (error instanceof OAuthRefreshError && error.permanent) {
        const latest = loadAccountStore();
        const live = latest.accounts[candidate.accountId];
        // Failure from an old flight must not resurrect deletion or fence a
        // newer credential generation which has already recovered.
        if (live && live.access === candidate.access && live.refresh === candidate.refresh) {
          live.health = { ...live.health, blockedReason: "oauth_refresh_invalid" };
          saveAccountStore(latest);
        }
      }
    }
  }
  return undefined;
}

function family(model: string): string {
  return model.startsWith("gemini-")
    ? model.includes("argon")
      ? "gemini:argon"
      : "gemini:shared"
    : model;
}
function available(account: StoredAccount, model?: string): boolean {
  if (!legacyProfile()) {
    try {
      account = { ...account, ...validatedCredential(account) };
    } catch (error) {
      if (error instanceof CredentialCheckpointError) return false;
      throw error;
    }
  }
  if (
    (!legacyProfile() && !checkpointTokenUsable(account.access)) ||
    account.health?.blockedReason ||
    (!legacyProfile() && quotaGate(account.quota, model ?? "").blocked)
  )
    return false;
  const cooldowns = account.health?.cooldowns;
  return !model || Math.max(cooldowns?.[model] ?? 0, cooldowns?.[family(model)] ?? 0) <= Date.now();
}
function accountForToken(store: AccountsFile, token: string): StoredAccount | undefined {
  const exact = Object.values(store.accounts).find((account) => account.access === token);
  if (exact || legacyProfile()) return exact;
  const verified = verifiedCredentialForToken(token);
  return verified ? findAccount(store, verified) : undefined;
}
export function accountAvailable(token: string, model: string): boolean {
  if (!legacyProfile() && !checkpointTokenUsable(token)) return false;
  const account = accountForToken(loadAccountStore(), token);
  if (legacyProfile()) return !account || available(account, model);
  return account
    ? available(account, model)
    : !quotaGate(verifiedCredentialForToken(token)?.quota, model).blocked;
}
/** Model/wire cooldowns; only quota exhaustion cools an entire Gemini family. */
export function markAccountHealth(
  token: string,
  model: string,
  options: {
    block?: string;
    cooldownMs?: number;
    familyQuota?: boolean;
    quotaModel?: string;
    failure?: { at: number; status: number; kind: string; model: string };
  },
): void {
  const store = loadAccountStore();
  const account = accountForToken(store, token);
  if (!account) return;
  account.health ??= {};
  if (options.block) account.health.blockedReason = options.block;
  if (options.failure) account.health.lastFailure = options.failure;
  if (options.cooldownMs) {
    account.health.cooldowns ??= {};
    const familyKey = model.startsWith("gemini-")
      ? family(model)
      : options.quotaModel
        ? family(options.quotaModel)
        : model;
    for (const key of [model, ...(options.familyQuota ? [familyKey] : [])])
      account.health.cooldowns[key] = Math.max(
        account.health.cooldowns[key] ?? 0,
        Date.now() + options.cooldownMs,
      );
  }
  saveAccountStore(store);
}
/** One forced refresh after a 401, never export a different identity's old project. */
export async function refreshAccountAfterUnauthorized(
  token: string,
): Promise<AntigravityApiKey | undefined> {
  const store = loadAccountStore();
  const previous = accountForToken(store, token);
  if (!previous) return undefined;
  try {
    const input =
      legacyProfile() || credentialNeedsRecovery(previous)
        ? previous
        : validatedCredential(previous);
    const updated = accountFromCredentials(await refreshAntigravityToken(input), previous);
    const latest = loadAccountStore();
    // Do not resurrect an account removed while the refresh was in flight.
    if (!latest.accounts[previous.accountId]) return undefined;
    updated.health = latest.accounts[previous.accountId].health;
    latest.accounts[previous.accountId] = updated;
    saveAccountStore(latest);
    if (latest.activeAccountId === previous.accountId) writeActiveCredential(updated);
    return apiKeyFor(updated);
  } catch (error) {
    if (
      error instanceof CredentialCheckpointError &&
      !loadAccountStore().accounts[previous.accountId]
    )
      return undefined;
    if (error instanceof OAuthRefreshError && error.permanent)
      markAccountHealth(token, "", { block: "oauth_refresh_invalid" });
    throw error;
  }
}

/** Session-start repair only for the explicitly active pending account. No
 * periodic polling and no catalog/identity probes for normal verified accounts. */
export async function recoverPendingActiveAccount(): Promise<boolean> {
  if (legacyProfile()) return false;
  syncCurrentAuth();
  const store = loadAccountStore();
  const active = store.activeAccountId ? store.accounts[store.activeAccountId] : undefined;
  if (!active || !credentialNeedsRecovery(active)) return false;
  await activateAccount(active.accountId);
  return true;
}
