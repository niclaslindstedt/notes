// Parser for the `notesd://pair?…` URI a notesd daemon prints as a QR code
// (and as a paste-able string) on startup. It carries everything a device
// needs to reach and trust the daemon: the address(es), the SPKI pin to
// validate the self-signed TLS cert against, and a single-use pairing token
// (or, in `--api-key` mode, a static key).
//
// Framework-free on purpose — it's imported by the storage layer and unit
// tested in `tests/storage/`, with no DOM or React dependency.
//
// ## Pin normalisation
//
// The daemon prints the SPKI fingerprint as `sha256:<base64url>` (URL-safe, no
// padding — it rides in the QR's query string). The native `pinned-fetch`
// module's contract (`native/modules/pinned-fetch/index.ts`) is
// `sha256:<base64>` (standard). So the parser converts the digest to **standard
// base64** here, once, and everything downstream stores/sends that form.

/** The fields carried by a `notesd://pair` URI, after validation. */
export interface NotesdPairing {
  /** Daemon display name (the `--name`, or its hostname). */
  name: string;
  /** `host:port` reachable on the LAN, if advertised. */
  lan?: string;
  /** `host:port` reachable from outside (UPnP), if advertised. */
  wan?: string;
  /** SPKI pin, normalised to `sha256:<standard-base64>`. */
  fingerprint: string;
  /** Single-use pairing token to redeem for a per-device key, if present. */
  token?: string;
  /** Static API key (from `--api-key`), if the daemon uses one instead. */
  key?: string;
}

export class PairingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingParseError";
  }
}

// host:port where host is a hostname, IPv4, or bracketed IPv6, and port is
// 1–65535. Deliberately strict so a malformed address can't become a base URL.
const HOST_PORT = /^(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):(\d{1,5})$/;

function validHostPort(value: string): boolean {
  const m = HOST_PORT.exec(value);
  if (!m) return false;
  const port = Number(m[1]);
  return port >= 1 && port <= 65535;
}

/** Convert URL-safe base64 (no padding) to standard base64 (padded). */
function base64urlToBase64(input: string): string {
  const replaced = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = replaced.length % 4;
  return pad ? replaced + "=".repeat(4 - pad) : replaced;
}

/**
 * Normalise and validate an SPKI pin: accept `sha256:<base64url>` or
 * `sha256:<base64>`, and return `sha256:<standard-base64>`. Throws if the digest
 * isn't exactly 32 bytes (a SHA-256).
 */
function normaliseFingerprint(raw: string): string {
  const prefix = "sha256:";
  if (!raw.startsWith(prefix)) {
    throw new PairingParseError("fingerprint must start with sha256:");
  }
  const b64 = base64urlToBase64(raw.slice(prefix.length));
  let bytes: number;
  try {
    bytes = atob(b64).length;
  } catch {
    throw new PairingParseError("fingerprint is not valid base64");
  }
  if (bytes !== 32) {
    throw new PairingParseError("fingerprint is not a 32-byte SHA-256");
  }
  return `${prefix}${b64}`;
}

/**
 * Parse a `notesd://pair?…` URI into a validated {@link NotesdPairing}.
 * Throws {@link PairingParseError} on anything malformed — a wrong scheme, an
 * unsupported version, a bad address, a non-SHA-256 pin, or a missing
 * credential — so a hostile QR can never produce a half-valid config.
 */
export function parsePairingUri(input: string): NotesdPairing {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new PairingParseError("not a valid URI");
  }
  if (url.protocol !== "notesd:") {
    throw new PairingParseError("not a notesd:// URI");
  }
  // Accept both notesd://pair and notesd:pair? shapes; the host is "pair".
  if (url.host && url.host !== "pair") {
    throw new PairingParseError("unexpected notesd URI host");
  }

  const q = url.searchParams;
  if (q.get("v") !== "1") {
    throw new PairingParseError("unsupported pairing version");
  }

  const name = (q.get("name") ?? "").trim() || "Self-hosted";

  const lan = q.get("lan") ?? undefined;
  const wan = q.get("wan") ?? undefined;
  if (lan !== undefined && !validHostPort(lan)) {
    throw new PairingParseError("invalid LAN address");
  }
  if (wan !== undefined && !validHostPort(wan)) {
    throw new PairingParseError("invalid WAN address");
  }
  if (!lan && !wan) {
    throw new PairingParseError("no address in pairing URI");
  }

  const fp = q.get("fp");
  if (!fp) throw new PairingParseError("no fingerprint in pairing URI");
  const fingerprint = normaliseFingerprint(fp);

  const token = q.get("t") ?? undefined;
  const key = q.get("k") ?? undefined;
  if (!token && !key) {
    throw new PairingParseError("no credential in pairing URI");
  }

  return { name, lan, wan, fingerprint, token, key };
}

/**
 * The base URL to reach a paired daemon at, preferring the LAN address (lower
 * latency, no internet round trip) and falling back to the WAN one. Returns
 * `https://host:port` — the daemon is TLS-only.
 */
export function pairingEndpoint(p: Pick<NotesdPairing, "lan" | "wan">): string {
  const hostPort = p.lan ?? p.wan;
  if (!hostPort) throw new PairingParseError("pairing has no address");
  return `https://${hostPort}`;
}

/**
 * A resolved request to connect to a daemon: a single base `endpoint` plus the
 * pin and a credential. Both entry points produce one of these — a scanned/
 * pasted `notesd://pair` URI (via {@link resolvePairing}) and a cloud-discovered
 * daemon (endpoint + pin already known, the user supplies the credential) — so
 * `useNotesdBackend` has one pairing path.
 */
export interface NotesdConnectRequest {
  name: string;
  /** `https://host:port`. */
  endpoint: string;
  /** SPKI pin, `sha256:<base64>`. */
  fingerprint: string;
  token?: string;
  key?: string;
}

/** Collapse a parsed pairing URI to its resolved connect request. */
export function resolvePairing(p: NotesdPairing): NotesdConnectRequest {
  return {
    name: p.name,
    endpoint: pairingEndpoint(p),
    fingerprint: p.fingerprint,
    token: p.token,
    key: p.key,
  };
}
