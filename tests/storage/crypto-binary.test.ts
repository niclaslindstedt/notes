import { describe, expect, it } from "vitest";

import {
  deriveContentKey,
  newKeyParams,
  type KeyParams,
} from "../../src/storage/crypto.ts";
import {
  isBinaryEnvelope,
  openBytes,
  openString,
  sealBytes,
  sealString,
} from "../../src/storage/crypto-binary.ts";

async function key(params: KeyParams = newKeyParams()): Promise<CryptoKey> {
  return deriveContentKey("correct horse", params);
}

describe("crypto-binary container", () => {
  it("round-trips bytes + header", async () => {
    const k = await key();
    const payload = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);
    const blob = await sealBytes(k, payload, {
      mime: "image/png",
      filename: "secret.png",
    });
    expect(isBinaryEnvelope(blob)).toBe(true);
    const opened = await openBytes(k, blob);
    expect(opened.header).toEqual({
      mime: "image/png",
      filename: "secret.png",
    });
    expect([...opened.bytes]).toEqual([...payload]);
  });

  it("does not leak the header (mime/filename) in the clear", async () => {
    const k = await key();
    const blob = await sealBytes(k, new Uint8Array([0]), {
      filename: "very-secret-name.pdf",
    });
    const asText = new TextDecoder("latin1").decode(blob);
    expect(asText).not.toContain("very-secret-name");
    expect(asText).not.toContain("filename");
  });

  it("fails to open with the wrong key", async () => {
    const blob = await sealBytes(await key(), new Uint8Array([9, 9, 9]));
    await expect(openBytes(await key(), blob)).rejects.toThrow(
      /wrong password/i,
    );
  });

  it("round-trips a string through the base64 wrapper", async () => {
    const k = await key();
    const text = '{"id":"a","body":"hello"}';
    const sealed = await sealString(k, text);
    expect(sealed).not.toContain("hello");
    const opened = await openString(k, sealed);
    expect(new TextDecoder().decode(opened.bytes)).toBe(text);
  });

  it("rejects non-container bytes", () => {
    expect(isBinaryEnvelope(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isBinaryEnvelope(new Uint8Array(0))).toBe(false);
  });
});
