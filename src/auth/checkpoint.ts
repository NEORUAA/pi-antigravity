/** Single-writer durable OAuth credential-family checkpoint. All token material is
 * owner-only local data. No unverified ID-token decoding or upstream calls here. */
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import type { AntigravityOAuthCredentials } from "../types/types.js";

type State = "baseline" | "pending" | "verified" | "permanent" | "revoked";
type RecordValue = {
  epoch: string;
  revision: number;
  state: State;
  credentials?: AntigravityOAuthCredentials;
  previousIdentity?: Pick<AntigravityOAuthCredentials, "email" | "subject" | "projectId" | "quota">;
  failure?: { at: number; kind: "temporary" | "permanent"; code: string };
};
type Journal = {
  version: 1;
  families: Record<string, RecordValue>;
  refreshAliases: Record<string, string>;
  accessAliases: Record<string, string[]>;
};
export type CredentialFlight = {
  family: string;
  epoch: string;
  revision: number;
  state: State;
  candidate: AntigravityOAuthCredentials;
  previousIdentity?: Pick<AntigravityOAuthCredentials, "email" | "subject" | "projectId" | "quota">;
};
export class CredentialCheckpointError extends Error {
  readonly code: "revoked" | "permanent" | "superseded" | "pending" | "stale" | "corrupt";
  constructor(code: "revoked" | "permanent" | "superseded" | "pending" | "stale" | "corrupt") {
    super(`Antigravity credential ${code}; retry validation or re-login`);
    this.code = code;
  }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function path(): string {
  return join(
    process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
    "antigravity-checkpoints.json",
  );
}
function load(): Journal {
  if (!existsSync(path()))
    return { version: 1, families: {}, refreshAliases: {}, accessAliases: {} };
  try {
    const value = JSON.parse(readFileSync(path(), "utf8")) as Journal;
    if (value.version !== 1 || !value.families || !value.refreshAliases || !value.accessAliases)
      throw new Error("schema");
    const plain = (v: unknown): v is Record<string, unknown> =>
      !!v && typeof v === "object" && !Array.isArray(v);
    if (!plain(value.families) || !plain(value.refreshAliases) || !plain(value.accessAliases))
      throw new Error("maps");
    const owned = (family: string) =>
      /^[a-f0-9]{64}$/.test(family) && Object.hasOwn(value.families, family);
    if (
      Object.entries(value.refreshAliases).some(
        ([key, family]) =>
          !/^[a-f0-9]{64}$/.test(key) || typeof family !== "string" || !owned(family),
      ) ||
      Object.entries(value.accessAliases).some(
        ([key, families]) =>
          !/^[a-f0-9]{64}$/.test(key) ||
          !Array.isArray(families) ||
          families.some((family) => typeof family !== "string" || !owned(family)),
      )
    )
      throw new Error("aliases");
    // Corruption is fail-closed, never silently overwrite recoverable credentials.
    for (const record of Object.values(value.families))
      if (
        !record ||
        typeof record.epoch !== "string" ||
        !Number.isSafeInteger(record.revision) ||
        !["baseline", "pending", "verified", "permanent", "revoked"].includes(record.state) ||
        (record.credentials &&
          (typeof record.credentials.refresh !== "string" ||
            typeof record.credentials.access !== "string" ||
            !Number.isFinite(record.credentials.expires)))
      )
        throw new Error("record");
    return value;
  } catch {
    throw new CredentialCheckpointError("corrupt");
  }
}
function save(journal: Journal): void {
  const target = path(),
    dir = dirname(target);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(journal)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, target);
    chmodSync(target, 0o600);
    // File fsync + directory fsync: the checkpoint rename survives a restart/crash.
    const directory = openSync(dir, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}
function recordFor(
  journal: Journal,
  credentials: Pick<AntigravityOAuthCredentials, "refresh">,
): [string, RecordValue] | undefined {
  const family = journal.refreshAliases[hash(credentials.refresh)];
  const record = family && journal.families[family];
  return record ? [family, record] : undefined;
}
function alias(journal: Journal, family: string, credentials: AntigravityOAuthCredentials): void {
  if (credentials.refresh) {
    const key = hash(credentials.refresh),
      existing = journal.refreshAliases[key];
    if (existing && existing !== family) throw new CredentialCheckpointError("superseded");
    journal.refreshAliases[key] = family;
  }
  if (credentials.access) {
    const key = hash(credentials.access),
      families = journal.accessAliases[key] ?? [];
    if (!families.includes(family)) families.push(family);
    journal.accessAliases[key] = families;
  }
}
/** Named token tuple only: old profile/project/quota MUST NOT cross a rotation. */
function unvalidated(credentials: AntigravityOAuthCredentials): AntigravityOAuthCredentials {
  return {
    access: credentials.access,
    refresh: credentials.refresh,
    expires: credentials.expires,
    oauthClientId: credentials.oauthClientId,
    oauthClientSecret: credentials.oauthClientSecret,
    oauthClientKey: credentials.oauthClientKey,
    idToken: credentials.idToken,
    scope: credentials.scope,
  };
}
export function beginCredentialFlight(
  credentials: AntigravityOAuthCredentials,
  freshLogin = false,
  validation = false,
): CredentialFlight {
  const journal = load();
  let found = recordFor(journal, credentials);
  if (!found) {
    const family = hash(`antigravity-family\0${credentials.refresh}`);
    const record: RecordValue = {
      epoch: randomBytes(16).toString("hex"),
      revision: 0,
      state: "baseline",
      credentials: { ...credentials },
    };
    journal.families[family] = record;
    alias(journal, family, credentials);
    found = [family, record];
  }
  const [family, record] = found;
  if (freshLogin) {
    record.epoch = randomBytes(16).toString("hex");
    record.revision++;
    record.state = "pending";
    record.credentials = unvalidated(credentials);
    delete record.failure;
    delete record.previousIdentity;
    alias(journal, family, credentials);
  } else if (record.state === "revoked" || record.state === "permanent")
    throw new CredentialCheckpointError(record.state);
  else if (validation && record.state !== "pending") {
    record.previousIdentity = {
      email: record.credentials?.email,
      subject: record.credentials?.subject,
      projectId: record.credentials?.projectId,
      quota: record.credentials?.quota,
    };
    record.revision++;
    record.state = "pending";
    record.credentials = unvalidated(record.credentials ?? credentials);
    delete record.failure;
  }
  if (!record.credentials) throw new CredentialCheckpointError("corrupt");
  save(journal);
  return {
    family,
    epoch: record.epoch,
    revision: record.revision,
    state: record.state,
    candidate: { ...record.credentials },
    previousIdentity: record.previousIdentity,
  };
}
function fenced(journal: Journal, flight: CredentialFlight): RecordValue {
  const record = journal.families[flight.family];
  if (
    !record ||
    record.epoch !== flight.epoch ||
    record.revision !== flight.revision ||
    record.state === "revoked" ||
    record.state === "permanent"
  )
    throw new CredentialCheckpointError("superseded");
  return record;
}
export function checkpointRotation(
  flight: CredentialFlight,
  credentials: AntigravityOAuthCredentials,
): void {
  const journal = load(),
    record = fenced(journal, flight);
  alias(journal, flight.family, credentials);
  if (record.state === "verified" || record.state === "baseline")
    record.previousIdentity = {
      email: record.credentials?.email,
      subject: record.credentials?.subject,
      projectId: record.credentials?.projectId,
      quota: record.credentials?.quota,
    };
  if (!record.previousIdentity?.subject && credentials.subject)
    record.previousIdentity = {
      ...record.previousIdentity,
      email: credentials.email,
      subject: credentials.subject,
      projectId: credentials.projectId,
      quota: record.previousIdentity?.quota,
    };
  record.credentials = unvalidated(credentials);
  record.state = "pending";
  record.revision++;
  delete record.failure;
  save(journal);
  flight.revision = record.revision;
  flight.state = "pending";
  flight.candidate = { ...record.credentials };
  flight.previousIdentity = record.previousIdentity;
}
export function promoteCheckpoint(
  flight: CredentialFlight,
  credentials: AntigravityOAuthCredentials,
): void {
  const journal = load(),
    record = fenced(journal, flight);
  if (
    record.credentials?.access !== credentials.access ||
    record.credentials.refresh !== credentials.refresh
  )
    throw new CredentialCheckpointError("superseded");
  record.credentials = { ...credentials };
  delete record.previousIdentity;
  record.state = "verified";
  record.revision++;
  delete record.failure;
  save(journal);
  flight.revision = record.revision;
  flight.state = "verified";
}
export function checkpointFailure(
  flight: CredentialFlight,
  kind: "temporary" | "permanent",
  code: string,
): void {
  const journal = load();
  let record: RecordValue;
  try {
    record = fenced(journal, flight);
  } catch (error) {
    if (error instanceof CredentialCheckpointError && error.code === "superseded") return;
    throw error;
  }
  // Never save arbitrary error messages/bodies/URLs. Caller supplies a fixed code.
  const allowed = [
    "validation_unavailable",
    "unverified_profile",
    "principal_transition",
    "oauth_refresh_invalid",
    "validation_required",
    "tos_violation",
  ];
  record.failure = {
    at: Date.now(),
    kind,
    code: allowed.includes(code) ? code : "validation_unavailable",
  };
  if (kind === "permanent") {
    record.state = "permanent";
    if (code === "oauth_refresh_invalid") delete record.credentials;
  }
  record.revision++;
  save(journal);
  flight.revision = record.revision;
}
export function revokeCredentialCheckpoint(credentials: AntigravityOAuthCredentials): void {
  const journal = load();
  let found = recordFor(journal, credentials);
  if (!found) {
    const family = hash(`antigravity-family\0${credentials.refresh}`);
    journal.families[family] = { epoch: "", revision: 0, state: "baseline" };
    alias(journal, family, credentials);
    found = [family, journal.families[family]];
  }
  const [, record] = found;
  record.epoch = randomBytes(16).toString("hex");
  record.revision++;
  record.state = "revoked";
  delete record.credentials;
  delete record.previousIdentity;
  delete record.failure;
  save(journal);
}
/** Stale SDK snapshots resolve to the last validated tuple; pending/revoked never
 * resolve to API credentials, even when their access-token expiry is in the future. */
export function validatedCredential(
  credentials: AntigravityOAuthCredentials,
): AntigravityOAuthCredentials {
  const found = recordFor(load(), credentials);
  if (!found) return credentials;
  const [, record] = found;
  if (record.state === "pending" || record.state === "revoked" || record.state === "permanent")
    throw new CredentialCheckpointError(record.state);
  return record.state === "verified" && record.credentials
    ? { ...record.credentials }
    : credentials;
}
export function sameCredentialFamily(
  a: AntigravityOAuthCredentials,
  b: AntigravityOAuthCredentials,
): boolean {
  const journal = load(),
    left = recordFor(journal, a),
    right = recordFor(journal, b);
  return !!left && !!right && left[0] === right[0];
}
export function assertCheckpointToken(token: string): void {
  const journal = load(),
    families = journal.accessAliases[hash(token)] ?? [];
  const records = families.map((f) => journal.families[f]).filter(Boolean);
  // Imported access tokens can be shared by different refresh-token families.
  // Never infer family/identity from that coincidence or merge those families.
  if (records.some((r) => r.state === "pending" && r.credentials?.access === token))
    throw new CredentialCheckpointError("pending");
  if (records.some((r) => r.state === "verified" && r.credentials?.access === token)) return;
  const blocked = records.find(
    (r) => r.state === "revoked" || r.state === "permanent" || r.state === "pending",
  );
  if (blocked)
    throw new CredentialCheckpointError(blocked.state as "revoked" | "permanent" | "pending");
  if (
    records.length &&
    !records.some((r) => r.state === "baseline" && r.credentials?.access === token)
  )
    throw new CredentialCheckpointError("stale");
}
export function checkpointTokenUsable(token: string): boolean {
  try {
    assertCheckpointToken(token);
    return true;
  } catch (error) {
    if (error instanceof CredentialCheckpointError) return false;
    throw error;
  }
}

export function assertCredentialFlight(flight: CredentialFlight): void {
  fenced(load(), flight);
}

export function credentialNeedsRecovery(credentials: AntigravityOAuthCredentials): boolean {
  return recordFor(load(), credentials)?.[1].state === "pending";
}

/** Repair the account-file projection after a crash between journal promotion and
 * SDK/account-file publication, without treating a pending tuple as validated. */
export function verifiedCredentialForToken(token: string): AntigravityOAuthCredentials | undefined {
  const journal = load();
  for (const family of journal.accessAliases[hash(token)] ?? []) {
    const record = journal.families[family];
    if (record?.state === "verified" && record.credentials?.access === token)
      return { ...record.credentials };
  }
  return undefined;
}

export function credentialFlightKey(credentials: AntigravityOAuthCredentials): string | undefined {
  const found = recordFor(load(), credentials);
  return found ? `${found[0]}:${found[1].epoch}` : undefined;
}
