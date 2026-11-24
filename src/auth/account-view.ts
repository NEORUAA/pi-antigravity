/** Account-scoped observations shared by Pi and Magpie. No global active account. */
import {
  validatedCredential,
  credentialNeedsRecovery,
  verifiedCredentialForToken,
  sameCredentialFamily,
} from "./checkpoint.js";
import { synchronizeAntigravityCredential } from "./oauth.js";
import type { AntigravityOAuthCredentials } from "../types/types.js";
export async function observeAccount(
  credentials: AntigravityOAuthCredentials,
  signal?: AbortSignal,
  force = false,
): Promise<AntigravityOAuthCredentials> {
  signal?.throwIfAborted();
  if (credentialNeedsRecovery(credentials))
    return synchronizeAntigravityCredential(credentials, { signal });
  const current = validatedCredential(credentials);
  const verified = verifiedCredentialForToken(current.access);
  // OAuth already performs Sync. Briefly reuse that verified account's observation;
  // explicit forced refresh bypasses it. Unknown/failed data is never cached as full.
  const age = Date.now() - (current.quota?.updatedAt ?? 0);
  if (
    !force &&
    verified &&
    sameCredentialFamily(current, verified) &&
    current.subject &&
    current.quota &&
    age >= 0 &&
    age < 30_000 &&
    current.expires > Date.now() &&
    !current.quota.warnings.includes("quota_summary_unavailable")
  )
    return current;
  return synchronizeAntigravityCredential(current, { signal });
}
