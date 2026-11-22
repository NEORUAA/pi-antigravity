import { legacyProfile, profileUserAgent, abortableDelay } from "../compat/profile.js";
import { provisionIdentity, readControlJSON } from "./control-plane.js";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { fetch as oauthFetch } from "undici";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { defaultProjectId, loadCodeAssist } from "../client/client.js";
import { escapeHtml, antigravityEnv } from "../utils/util.js";
import { resolveCallbackHost, redactSecrets } from "../utils/security.js";
import type { AntigravityOAuthCredentials, CallbackServer } from "../types/types.js";

export const REDIRECT_URI = "http://localhost:51121/oauth-callback";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
export const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
  "https://www.googleapis.com/auth/aicode",
];

/**
 * Default OAuth client is Google's public Antigravity desktop client (not a private app secret).
 * Prefer ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET when you manage your own OAuth app.
 */
export const CLIENT_ID =
  antigravityEnv("CLIENT_ID") ||
  atob(
    "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlc" +
      "C5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
  );
export const CLIENT_SECRET =
  antigravityEnv("CLIENT_SECRET") || atob("R09DU1BYLUs1OEZXUjQ" + "4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");

export type OAuthClientConfig = { key: string; id: string; secret: string };
export function configuredOAuthClients(): OAuthClientConfig[] {
  const configured = new Map<string, OAuthClientConfig>();
  for (const entry of (antigravityEnv("OAUTH_CLIENTS") ?? "").split(";")) {
    const [key, id, secret] = entry.split("|").map((part) => part.trim());
    if (key && id && secret)
      configured.set(key.toLowerCase(), { key: key.toLowerCase(), id, secret });
  }
  return configured.size
    ? [...configured.values()]
    : [{ key: "official", id: CLIENT_ID, secret: CLIENT_SECRET }];
}
function activeOAuthClient(): OAuthClientConfig {
  const clients = configuredOAuthClients();
  const key = antigravityEnv("OAUTH_CLIENT_KEY")?.trim().toLowerCase();
  if (key && !clients.some((client) => client.key === key))
    throw new Error("Configured Antigravity OAuth client key was not found");
  return clients.find((client) => client.key === key) ?? clients[0];
}

export const CALLBACK_HOST = resolveCallbackHost();

function oauthCallbackHeaders(contentType = "text/html; charset=utf-8"): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
  };
}

function sanitizeOAuthProviderError(text: string): string {
  const redacted = redactSecrets(text).trim();
  try {
    const parsed = JSON.parse(redacted) as {
      error?: string;
      error_description?: string;
    };
    const parts = [parsed.error, parsed.error_description].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    if (parts.length) return parts.join(": ").slice(0, 300);
  } catch {
    // not JSON
  }
  return redacted.slice(0, 300) || "unknown OAuth provider error";
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export async function getUserProfile(
  token: string,
  signal?: AbortSignal,
): Promise<{ email?: string }> {
  const url = legacyProfile()
    ? "https://www.googleapis.com/oauth2/v1/userinfo?alt=json"
    : "https://www.googleapis.com/oauth2/v2/userinfo";
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    if (attempt) await abortableDelay(200 * attempt, signal);
    let res;
    try {
      res = await oauthFetch(url, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": profileUserAgent() },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
        redirect: "error",
      });
    } catch (error) {
      signal?.throwIfAborted();
      if (legacyProfile()) return {};
      // Match Go: retry only transient transport errors, never timeout/certificate failures.
      const code = (error as { cause?: { code?: string }; name?: string }).cause?.code ?? "";
      // Deliberately omit raw transport causes, which can contain credential-bearing URLs.
      if (
        attempt === 2 ||
        /CERT|TLS|TIMEOUT|ALTNAME/i.test(code) ||
        (error as Error).name === "TimeoutError"
      )
        // eslint-disable-next-line preserve-caught-error -- raw transport causes can contain credentials
        throw new Error("Antigravity profile transport failed");
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      if (legacyProfile()) return {};
      throw new Error(`Antigravity profile HTTP ${res.status}`);
    }
    const data = await readControlJSON(res);
    if (!data || typeof data !== "object") throw new Error("Invalid Google profile response");
    const profile = data as { email?: string; verified_email?: boolean };
    if (!legacyProfile() && (!profile.email?.trim() || profile.verified_email !== true))
      throw new Error("Google profile did not confirm a verified email");
    return { email: profile.email?.trim() };
  }
  throw new Error("Antigravity profile unavailable");
}

function closeServerGracefully(server: Server): void {
  if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  server.close();
}

export function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolveCode!: (value: { code: string; state: string }) => void;
    let rejectCode!: (error: Error) => void;
    const codePromise = new Promise<{ code: string; state: string }>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });
    void codePromise.catch(() => {});

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      fn();
    };

    const server = createServer((req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, oauthCallbackHeaders("text/plain; charset=utf-8"));
        res.end("Method Not Allowed");
        return;
      }

      const url = new URL(req.url || "", REDIRECT_URI);
      if (url.pathname !== "/oauth-callback") {
        res.writeHead(404, oauthCallbackHeaders());
        res.end("Antigravity OAuth callback route not found.");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (state !== expectedState) {
        res.writeHead(400, oauthCallbackHeaders());
        res.end("Antigravity authentication failed: invalid state.");
        finish(() => rejectCode(new Error("OAuth state mismatch")));
        return;
      }
      if (error) {
        const safe = escapeHtml(error.slice(0, 200));
        res.writeHead(400, oauthCallbackHeaders());
        res.end(`Antigravity authentication failed: ${safe}`);
        finish(() => rejectCode(new Error(`OAuth error: ${error.slice(0, 200)}`)));
        return;
      }
      if (!code || !state) {
        res.writeHead(400, oauthCallbackHeaders());
        res.end("Antigravity authentication failed: missing code or state.");
        finish(() => rejectCode(new Error("Missing code or state in OAuth callback")));
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400, oauthCallbackHeaders());
        res.end("Antigravity authentication failed: invalid state.");
        finish(() => rejectCode(new Error("OAuth state mismatch")));
        return;
      }

      res.writeHead(200, oauthCallbackHeaders());
      res.end("Antigravity authentication complete. You can close this window and return to Pi.");
      finish(() => resolveCode({ code, state }));
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            "Port 51121 is already in use by another process. Please close the process using port 51121 and retry /login antigravity.",
          ),
        );
      } else {
        reject(err);
      }
    });

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      closeServerGracefully(server);
    };
    const cleanup = () => {
      finish(() => rejectCode(new Error("OAuth callback cancelled")));
      close();
    };

    server.listen(
      legacyProfile() ? 51121 : 0,
      legacyProfile() ? CALLBACK_HOST : "127.0.0.1",
      () => {
        timeout = setTimeout(() => {
          finish(() => rejectCode(new Error("OAuth callback timed out waiting for browser login")));
          close();
        }, OAUTH_CALLBACK_TIMEOUT_MS);
        const address = server.address();
        const redirectUri = legacyProfile()
          ? REDIRECT_URI
          : `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/oauth-callback`;
        resolve({ server, redirectUri, waitForCode: () => codePromise, cleanup });
      },
    );
  });
}

function credentialProjectId(credentials: OAuthCredentials): string | undefined {
  const projectId = (credentials as AntigravityOAuthCredentials).projectId;
  return typeof projectId === "string" ? projectId : undefined;
}

function credentialEmail(credentials: OAuthCredentials): string | undefined {
  const email = (credentials as AntigravityOAuthCredentials).email;
  return typeof email === "string" ? email : undefined;
}

/**
 * Parse a callback URL (or bare query string) pasted by the user from a
 * remote/headless browser that could not reach the local callback server.
 * Returns the validated {code, state} or throws a descriptive error. The checks
 * mirror the local callback server so a pasted URL is accepted under the exact
 * same rules as a same-machine browser redirect.
 */
function parsePastedCallback(
  raw: string,
  expectedState: string,
  redirectUri: string,
): { code: string; state: string } {
  const text = (raw ?? "").trim();
  if (!text) {
    throw new Error(
      `No callback pasted. Paste the full URL from your browser's address bar (${redirectUri}?…).`,
    );
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // Bare query string: "state=…&code=…" or "?state=…&code=…"
    const qs = text.startsWith("?") ? text.slice(1) : text;
    url = new URL(`${redirectUri}?${qs}`);
  }
  const error = url.searchParams.get("error");
  if (error) throw new Error(`OAuth error from browser: ${error.slice(0, 200)}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    throw new Error(
      `Pasted text is missing 'code' or 'state'. Paste the FULL callback URL from your browser's address bar (${redirectUri}?…).`,
    );
  }
  if (state !== expectedState) {
    throw new Error(
      "State mismatch: that callback is from a different sign-in. Re-run /login antigravity, sign in again, and paste the new URL.",
    );
  }
  return { code, state };
}

/**
 * Resolve the authorization code from either the local callback server (browser
 * on the same machine) or a pasted callback URL (browser on a remote/headless
 * machine that cannot reach localhost:51121). Whichever provides a valid code
 * first wins; the losing path is cancelled. Honors callbacks.signal for cancel.
 */
async function acquireAuthCode(
  expectedState: string,
  opts: {
    waitForCode: () => Promise<{ code: string; state: string }>;
    callbacks: OAuthLoginCallbacks;
    redirectUri: string;
  },
): Promise<{ code: string; state: string }> {
  const { waitForCode, callbacks, redirectUri } = opts;
  // Signals the losing candidate(s) to stop once the race settles.
  const settle = new AbortController();
  const candidates: Promise<{ code: string; state: string }>[] = [waitForCode()];

  // Manual paste path: offered whenever the callback surface can prompt.
  if (typeof callbacks.onPrompt === "function") {
    const promptLoop = async (): Promise<{ code: string; state: string }> => {
      let promptMessage =
        `Remote/headless machine (your browser can't reach ${new URL(redirectUri).host})? ` +
        "After signing in, paste the full callback URL shown in your browser's address bar.";
      while (true) {
        if (callbacks.signal?.aborted || settle.signal.aborted) {
          throw new Error("Login cancelled");
        }
        let text: string;
        try {
          text = await callbacks.onPrompt({
            message: promptMessage,
            placeholder: `${redirectUri}?state=…&code=…`,
          });
        } catch (err: unknown) {
          // Prompt/transport failure — propagate, do not retry.
          throw err instanceof Error ? err : new Error(String(err));
        }
        if (callbacks.signal?.aborted || settle.signal.aborted) {
          throw new Error("Login cancelled");
        }
        try {
          return parsePastedCallback(text, expectedState, redirectUri);
        } catch (err: unknown) {
          if (callbacks.signal?.aborted || settle.signal.aborted) {
            throw new Error("Login cancelled", { cause: err });
          }
          const errorMessage = err instanceof Error ? err.message : String(err);
          promptMessage = `Invalid callback (${errorMessage}). Please paste the full URL:`;
        }
      }
    };
    candidates.push(promptLoop());
  }

  // Flow cancellation (escape) aborts the whole login when a signal is provided.
  let removeAbortListener: (() => void) | undefined;
  if (callbacks.signal) {
    candidates.push(
      new Promise<never>((_resolve, reject) => {
        const signal = callbacks.signal as AbortSignal;
        if (signal.aborted) return reject(new Error("Login cancelled"));
        const onAbort = () => reject(new Error("Login cancelled"));
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      }),
    );
  }

  // Suppress unhandled rejections from losing candidates after the race settles.
  for (const candidate of candidates) {
    candidate.catch(() => {});
  }

  try {
    return await Promise.race(candidates);
  } finally {
    settle.abort();
    removeAbortListener?.();
  }
}

export async function loginAntigravity(
  callbacks: OAuthLoginCallbacks,
): Promise<AntigravityOAuthCredentials> {
  const client = activeOAuthClient();
  const { verifier, challenge } = generatePKCE();
  // State must be independent of the PKCE verifier so a leaked callback URL
  // cannot also disclose the code_verifier needed to mint tokens.
  const state = base64Url(randomBytes(32));
  const { waitForCode, cleanup, redirectUri = REDIRECT_URI } = await startCallbackServer(state);
  try {
    const authParams = new URLSearchParams({
      client_id: client.id,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES.filter((scope) => !legacyProfile() || scope !== "openid").join(" "),
      ...(!legacyProfile() ? { include_granted_scopes: "true" } : {}),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent",
    });
    callbacks.onAuth({
      url: `${AUTH_URL}?${authParams.toString()}`,
      instructions:
        "Complete Google sign-in. Pi captures the local callback automatically — or, on a remote/headless machine, paste the callback URL when prompted.",
    });

    const { code, state: returnedState } = await acquireAuthCode(state, {
      waitForCode,
      callbacks,
      redirectUri,
    });
    if (returnedState !== state) throw new Error("OAuth state mismatch");

    const tokenResponse = await oauthFetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": profileUserAgent(),
      },
      signal: callbacks.signal
        ? AbortSignal.any([callbacks.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
      redirect: "error",
      body: new URLSearchParams({
        client_id: client.id,
        client_secret: client.secret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    if (!tokenResponse.ok) {
      throw new Error(
        `Token exchange failed: ${sanitizeOAuthProviderError(await tokenResponse.text())}`,
      );
    }
    const tokenData = (await readControlJSON(tokenResponse)) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    if (
      typeof tokenData.access_token !== "string" ||
      !tokenData.access_token.trim() ||
      !Number.isFinite(tokenData.expires_in) ||
      tokenData.expires_in <= 0
    )
      throw new Error("OAuth server returned an invalid access token or expiry");
    if (!tokenData.refresh_token) {
      throw new Error(
        "No refresh token received. Re-run /login antigravity and allow offline access.",
      );
    }

    const { email } = await getUserProfile(tokenData.access_token, callbacks.signal);
    const identity = legacyProfile()
      ? undefined
      : await provisionIdentity(tokenData.access_token, { signal: callbacks.signal });
    const discoveredProject = identity?.projectId ?? (await loadCodeAssist(tokenData.access_token));
    return {
      refresh: tokenData.refresh_token,
      access: tokenData.access_token,
      expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
      projectId: discoveredProject || defaultProjectId(email || "antigravity-default"),
      email,
      identity,
      oauthClientKey: client.key,
      oauthClientId: client.id,
      oauthClientSecret: client.secret,
    };
  } finally {
    cleanup();
  }
}

export class OAuthRefreshError extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.permanent = permanent;
  }
}
const refreshing = new Map<string, Promise<AntigravityOAuthCredentials>>();
export function refreshAntigravityToken(
  credentials: OAuthCredentials,
): Promise<AntigravityOAuthCredentials> {
  const stored = credentials as AntigravityOAuthCredentials;
  const key = createHash("sha256")
    .update(
      `${credentials.refresh}\0${stored.oauthClientId ?? CLIENT_ID}\0${stored.oauthClientSecret ?? CLIENT_SECRET}`,
    )
    .digest("hex");
  let pending = refreshing.get(key);
  if (!pending) {
    pending = refreshTokenUncached(credentials).finally(() => refreshing.delete(key));
    refreshing.set(key, pending);
  }
  return pending;
}
async function refreshTokenUncached(
  credentials: OAuthCredentials,
): Promise<AntigravityOAuthCredentials> {
  if (!credentials.refresh?.trim())
    throw new OAuthRefreshError("Antigravity refresh token is required", true);
  const stored = credentials as AntigravityOAuthCredentials;
  const officialId = atob(
    "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
  );
  const officialSecret = atob("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");
  const configured = configuredOAuthClients();
  const active = activeOAuthClient();
  const candidates = [
    ...(stored.oauthClientId && stored.oauthClientSecret
      ? [
          {
            key: stored.oauthClientKey || stored.oauthClientId.toLowerCase(),
            id: stored.oauthClientId,
            secret: stored.oauthClientSecret,
          },
        ]
      : []),
    ...configured.filter((client) => client.key === stored.oauthClientKey),
    active,
    ...configured,
    ...(!legacyProfile() ? [{ key: "official", id: officialId, secret: officialSecret }] : []),
  ].filter(
    (candidate, index, all) => all.findIndex((item) => item.key === candidate.key) === index,
  );

  let allPermanent = true;
  let message = "Antigravity refresh failed";
  for (const candidate of candidates) {
    let response;
    try {
      response = await oauthFetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": profileUserAgent(),
        },
        body: new URLSearchParams({
          client_id: candidate.id,
          client_secret: candidate.secret,
          refresh_token: credentials.refresh,
          grant_type: "refresh_token",
        }).toString(),
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
    } catch {
      throw new OAuthRefreshError("Antigravity refresh transport failed", false);
    }
    if (!response.ok) {
      const data = await readControlJSON(response);
      const code =
        typeof data === "object" && data && "error" in data && typeof data.error === "string"
          ? data.error
          : "unknown_oauth_error";
      const permanent =
        response.status >= 400 &&
        response.status < 500 &&
        ["invalid_grant", "invalid_client", "unauthorized_client", "access_denied"].includes(code);
      allPermanent &&= permanent;
      message = `Antigravity token refresh failed: ${code.replace(/[^a-z_]/gi, "").slice(0, 60)} (HTTP ${response.status})`;
      if (
        response.status === 400 ||
        response.status === 401 ||
        code === "unauthorized_client" ||
        code === "invalid_client"
      )
        continue;
      break;
    }
    const data = (await readControlJSON(response)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
      scope?: string;
    };
    if (!data.access_token?.trim() || !Number.isFinite(data.expires_in) || data.expires_in! <= 0)
      throw new OAuthRefreshError("OAuth server returned an invalid access token or expiry", false);
    const profile = legacyProfile()
      ? { email: credentialEmail(credentials) }
      : await getUserProfile(data.access_token);
    // Never carry identity-bound snapshots across a refresh without revalidation.
    const identity = legacyProfile() ? undefined : await provisionIdentity(data.access_token);
    const discoveredProject =
      identity?.projectId ??
      credentialProjectId(credentials) ??
      (await loadCodeAssist(data.access_token));
    if (!discoveredProject && !legacyProfile())
      throw new Error("Antigravity has no provisioned project");
    return {
      ...credentials,
      refresh: data.refresh_token?.trim() || credentials.refresh,
      access: data.access_token.trim(),
      expires: Date.now() + data.expires_in! * 1000 - 5 * 60 * 1000,
      projectId: discoveredProject || defaultProjectId(profile.email || "antigravity-default"),
      email: profile.email,
      identity,
      oauthClientKey: candidate.key,
      oauthClientId: candidate.id,
      oauthClientSecret: candidate.secret,
      idToken: data.id_token,
      scope: data.scope || stored.scope,
    };
  }
  throw new OAuthRefreshError(message, allPermanent);
}

export function getApiKey(credentials: OAuthCredentials): string {
  const email = credentialEmail(credentials);
  if (!legacyProfile() && !credentialProjectId(credentials))
    throw new Error("Antigravity has no provisioned project. Run /login antigravity.");
  return JSON.stringify({
    token: credentials.access,
    projectId: credentialProjectId(credentials) || defaultProjectId(email || "antigravity-default"),
  });
}

export type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
