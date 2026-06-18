import { describe, expect, it } from "vitest";

import {
  decryptEnvelope,
  encryptText,
  isEncryptedEnvelope,
  parseEnvelope,
} from "../../src/storage/crypto.ts";

describe("storage crypto", () => {
  it("round-trips plaintext through an AES-GCM envelope", async () => {
    const text = JSON.stringify({ notes: [{ id: "a", body: "secret" }] });
    const envelope = await encryptText(text, "correct horse");
    expect(isEncryptedEnvelope(envelope)).toBe(true);
    expect(envelope).not.toContain("secret");
    expect(await decryptEnvelope(envelope, "correct horse")).toBe(text);
  });

  it("rejects the wrong password", async () => {
    const envelope = await encryptText("hi", "right");
    await expect(decryptEnvelope(envelope, "wrong")).rejects.toThrow(
      /wrong password/i,
    );
  });

  it("uses a fresh salt + iv per encryption", async () => {
    const a = parseEnvelope(await encryptText("x", "pw"));
    const b = parseEnvelope(await encryptText("x", "pw"));
    expect(a?.salt).not.toBe(b?.salt);
    expect(a?.iv).not.toBe(b?.iv);
  });

  it("does not mistake plaintext JSON for an envelope", () => {
    expect(isEncryptedEnvelope('{"notes":[]}')).toBe(false);
    expect(isEncryptedEnvelope("not json")).toBe(false);
  });
});
