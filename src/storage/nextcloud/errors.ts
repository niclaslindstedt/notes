// Non-ok response → Error mapper for the Nextcloud adapter, the sibling of
// `../dropbox/errors.ts` and `../notesd/errors.ts` tuned to what a Nextcloud
// (SabreDAV) server answers with:
//
//   - 401 → AuthError. The app password was revoked, changed, or never valid;
//     there is no refresh path, so the UI must ask for a new one.
//   - 429 → RateLimitError. Nextcloud's brute-force throttle and any reverse
//     proxy in front of it both use it; honour `Retry-After`.
//   - 423 → a plain failure, but named: SabreDAV locks a file while another
//     client writes it, which clears on its own.
//   - 507 → a plain failure, but named: the account is out of quota, which
//     otherwise reads as an unexplained write failure.
//
// A raw network rejection (DNS, refused connection, a missing CORS grant)
// never reaches here — `fetch` rejects with a TypeError before there is a
// response, which the offline mirror reads as "unreachable" (see
// `../cache/index.ts`) and the connect verb explains in full.

import { AuthError, RateLimitError } from "../adapter.ts";
import { parseRetryAfterMs, readErrorBody } from "../http-utils.ts";

// Floor for the cooldown after a 429, matching the other backends.
const RATE_LIMIT_FALLBACK_MS = 5000;

export async function nextcloudError(
  op: string,
  res: Response,
): Promise<Error> {
  if (res.status === 401) {
    const body = await readErrorBody(res);
    return new AuthError(`Nextcloud auth failed: 401 ${body}`);
  }
  if (res.status === 429) {
    return new RateLimitError(
      parseRetryAfterMs(res.headers, RATE_LIMIT_FALLBACK_MS),
    );
  }
  if (res.status === 423) {
    return new Error(
      `Nextcloud ${op} failed: the file is locked by another client (423)`,
    );
  }
  if (res.status === 507) {
    return new Error(
      `Nextcloud ${op} failed: the account is out of storage space (507)`,
    );
  }
  const detail = await readErrorBody(res);
  return new Error(`Nextcloud ${op} failed: ${res.status} ${detail}`);
}
