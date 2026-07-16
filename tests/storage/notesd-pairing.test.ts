import { describe, expect, it } from "vitest";

import {
  PairingParseError,
  parsePairingUri,
  pairingEndpoint,
} from "../../src/storage/notesd/pairing.ts";

// A real 32-byte SHA-256 digest (sha256 of the empty string), standard base64.
const FP_STD = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
// The same digest in URL-safe base64, no padding — what the daemon prints.
const FP_URL = "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU";

function uri(params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return `notesd://pair?${q}`;
}

describe("parsePairingUri", () => {
  it("parses a full token pairing and normalises the pin to standard base64", () => {
    const p = parsePairingUri(
      uri({
        v: "1",
        name: "niclas imac",
        lan: "192.168.1.20:8443",
        wan: "203.0.113.5:8443",
        fp: `sha256:${FP_URL}`,
        t: "tok123",
      }),
    );
    expect(p.name).toBe("niclas imac");
    expect(p.lan).toBe("192.168.1.20:8443");
    expect(p.wan).toBe("203.0.113.5:8443");
    expect(p.fingerprint).toBe(`sha256:${FP_STD}`);
    expect(p.token).toBe("tok123");
    expect(p.key).toBeUndefined();
  });

  it("accepts a static-key pairing and an already-standard pin", () => {
    const p = parsePairingUri(
      uri({
        v: "1",
        lan: "10.0.0.2:9000",
        fp: `sha256:${FP_STD}`,
        k: "static",
      }),
    );
    expect(p.key).toBe("static");
    expect(p.token).toBeUndefined();
    expect(p.fingerprint).toBe(`sha256:${FP_STD}`);
    expect(p.name).toBe("Self-hosted"); // default when omitted
  });

  it("prefers the LAN address for the endpoint, falling back to WAN", () => {
    expect(pairingEndpoint({ lan: "192.168.1.20:8443", wan: "x:1" })).toBe(
      "https://192.168.1.20:8443",
    );
    expect(pairingEndpoint({ wan: "203.0.113.5:8443" })).toBe(
      "https://203.0.113.5:8443",
    );
  });

  it("rejects a non-notesd scheme", () => {
    expect(() => parsePairingUri("https://pair?v=1")).toThrow(
      PairingParseError,
    );
  });

  it("rejects an unsupported version", () => {
    expect(() =>
      parsePairingUri(
        uri({ v: "2", lan: "a:1", fp: `sha256:${FP_STD}`, t: "x" }),
      ),
    ).toThrow(/version/);
  });

  it("rejects a malformed address (no path traversal into a base URL)", () => {
    expect(() =>
      parsePairingUri(
        uri({ v: "1", lan: "not a host", fp: `sha256:${FP_STD}`, t: "x" }),
      ),
    ).toThrow(/LAN address/);
    expect(() =>
      parsePairingUri(
        uri({ v: "1", lan: "host:99999", fp: `sha256:${FP_STD}`, t: "x" }),
      ),
    ).toThrow(/LAN address/);
  });

  it("rejects a pin that is not a 32-byte SHA-256", () => {
    expect(() =>
      parsePairingUri(uri({ v: "1", lan: "a:1", fp: "sha256:YWJj", t: "x" })),
    ).toThrow(/32-byte/);
    expect(() =>
      parsePairingUri(uri({ v: "1", lan: "a:1", fp: `md5:${FP_STD}`, t: "x" })),
    ).toThrow(/sha256:/);
  });

  it("rejects a URI with no address and one with no credential", () => {
    expect(() =>
      parsePairingUri(uri({ v: "1", fp: `sha256:${FP_STD}`, t: "x" })),
    ).toThrow(/no address/);
    expect(() =>
      parsePairingUri(uri({ v: "1", lan: "a:1", fp: `sha256:${FP_STD}` })),
    ).toThrow(/no credential/);
  });
});
