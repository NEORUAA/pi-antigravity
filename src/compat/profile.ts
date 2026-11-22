/** Application-layer reference: codex2api d8e1981f (see docs/CODEX_PARITY.md).
 * No transport/browser fingerprint equivalence or account-risk claim is made. */
import { createHash, randomBytes } from "node:crypto";

export const CODEX_USER_AGENT = "antigravity/hub/2.19.1 windows/amd64";
export const DAILY = "https://daily-cloudcode-pa.googleapis.com";
export const PRODUCTION = "https://cloudcode-pa.googleapis.com";
export const SANDBOX = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export function legacyProfile(): boolean {
  return (process.env.ANTIGRAVITY_COMPAT_PROFILE || process.env.NOAGY_COMPAT_PROFILE) === "pi";
}
export function codexSessionId(contents: unknown[], sessionId?: string): string {
  let seed = sessionId?.trim() ? `metadata.session_id:${sessionId.trim()}` : "";
  if (!seed) {
    for (const content of contents) {
      const turn = content as { role?: string; parts?: Array<{ text?: string }> };
      if (turn.role !== "user") continue;
      const text = turn.parts?.find(
        (part) => typeof part.text === "string" && part.text.trim(),
      )?.text;
      if (text) {
        seed = `first_user_text:${text}`;
        break;
      }
    }
  }
  const bytes = seed
    ? createHash("sha256").update(`codex2api:antigravity:session\0${seed}`).digest()
    : randomBytes(8);
  return `-${bytes.readBigUInt64BE(0) & 0x7fffffffffffffffn}`;
}
export function codexRequestId(): string {
  return `agent/${Date.now()}/${randomBytes(4).toString("hex")}`;
}
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Request aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function profileUserAgent(): string {
  return (
    (process.env.ANTIGRAVITY_USER_AGENT || process.env.NOAGY_USER_AGENT)?.trim() || CODEX_USER_AGENT
  );
}
export function profileHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": profileUserAgent(),
  };
}
