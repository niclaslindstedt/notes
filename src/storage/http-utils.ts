// Small HTTP helpers shared by the cloud storage adapters (Dropbox, Google
// Drive) and the OAuth PKCE flow. Keeping them in one place stops each
// adapter from re-implementing the same defensive response handling — and
// means a fix (a new fallback, a header quirk) lands once for every backend.

/**
 * Read a response body as text for inclusion in an error message, falling
 * back to a placeholder when the body can't be read (already consumed,
 * aborted stream, …) so building the error never itself throws.
 */
export async function readErrorBody(res: Response): Promise<string> {
  return res.text().catch(() => "<unreadable>");
}

/**
 * Parse an HTTP `Retry-After` header (delta-seconds) into milliseconds,
 * clamped to never return below `fallbackMs`. A missing or non-numeric
 * header yields the fallback; a present value is floored at zero before the
 * seconds→ms conversion.
 */
export function parseRetryAfterMs(
  headers: Headers | undefined,
  fallbackMs: number,
): number {
  const headerSeconds = Number(headers?.get("Retry-After") ?? "");
  const headerMs = Number.isFinite(headerSeconds)
    ? Math.max(0, headerSeconds) * 1000
    : 0;
  return Math.max(headerMs, fallbackMs);
}
