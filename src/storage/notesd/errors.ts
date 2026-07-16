// Non-ok response → Error mapper for the notesd adapter, mirroring
// `../dropbox/errors.ts` but tuned to the daemon's status codes:
//   - 401  → AuthError (a bad/absent bearer key, or a revoked device).
//   - 429  → RateLimitError (the daemon's per-IP lockout; honour Retry-After).
//   - else → a plain labelled failure.
//
// 409 (a save conflict) is handled inline in the adapter — it carries the
// current document bytes the caller needs for keep-mine/keep-theirs — so it
// never reaches here.

import { AuthError, RateLimitError } from "../adapter.ts";
import { parseRetryAfterMs, readErrorBody } from "../http-utils.ts";

// Floor for the cooldown after the daemon returns 429 (its lockout is at least
// a few seconds; a missing Retry-After shouldn't retry instantly).
const RATE_LIMIT_FALLBACK_MS = 5000;

export async function notesdError(op: string, res: Response): Promise<Error> {
  if (res.status === 401) {
    const body = await readErrorBody(res);
    return new AuthError(`notesd auth failed: 401 ${body}`);
  }
  if (res.status === 429) {
    return new RateLimitError(
      parseRetryAfterMs(res.headers, RATE_LIMIT_FALLBACK_MS),
    );
  }
  const detail = await readErrorBody(res);
  return new Error(`notesd ${op} failed: ${res.status} ${detail}`);
}
