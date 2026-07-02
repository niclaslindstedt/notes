// The Dropbox mirror of gdrive's `gdriveError` (`../gdrive/drive-fs.ts`):
// build the Error to throw for a non-ok Dropbox response, so the eight-odd
// `throw new Error("Dropbox <op> failed: <status> <body>")` sites across the
// file store, attachment store, list walk, and namespace delete don't each
// hand-roll the message.
//
// Tuned to Dropbox's semantics rather than gdrive's uniform mapping:
//   - 401 never reaches here — the authed fetch (`createAuthedFetch`) handles
//     it via silent refresh and throws AuthError itself, so there is no 401
//     branch.
//   - Only the upload paths pass `rateLimit: true`; a 429 there is the
//     transient throttle rapid saves hit, so it becomes a RateLimitError. The
//     read / list / delete paths leave `rateLimit` unset, so a 429 there stays
//     a plain labelled failure — matching the pre-existing per-call-site
//     behaviour (this is a pure refactor, not a change to which statuses count
//     as transient).

import { RateLimitError } from "../adapter.ts";
import { parseRetryAfterMs, readErrorBody } from "../http-utils.ts";

// Floor for the cooldown after Dropbox returns 429.
const RATE_LIMIT_FALLBACK_MS = 5000;

export async function dropboxError(
  op: string,
  res: Response,
  opts: { rateLimit?: boolean } = {},
): Promise<Error> {
  if (opts.rateLimit && res.status === 429) {
    return new RateLimitError(
      parseRetryAfterMs(res.headers, RATE_LIMIT_FALLBACK_MS),
    );
  }
  const detail = await readErrorBody(res);
  return new Error(`Dropbox ${op} failed: ${res.status} ${detail}`);
}
