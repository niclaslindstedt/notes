import { describe, expect, it } from "vitest";

import {
  decryptEnvelope,
  deriveFileKey,
  deriveRef,
  deriveSessionKeys,
  encryptText,
  isEncryptedEnvelope,
  newKeyParams,
  parseEnvelope,
  parseKeyParams,
  serializeKeyParams,
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

  it("reports its progress phases in order when encrypting and decrypting", async () => {
    const encryptSteps: string[] = [];
    const envelope = await encryptText("hi", "pw", (s) => encryptSteps.push(s));
    expect(encryptSteps).toEqual(["derivingKey", "encrypting"]);

    const decryptSteps: string[] = [];
    await decryptEnvelope(envelope, "pw", (s) => decryptSteps.push(s));
    expect(decryptSteps).toEqual(["derivingKey", "decrypting"]);
  });

  it("compresses the envelope and still round-trips", async () => {
    const text = "repeat ".repeat(500);
    const envelope = await encryptText(text, "pw");
    expect(parseEnvelope(envelope)?.compression).toBe("gzip");
    expect(await decryptEnvelope(envelope, "pw")).toBe(text);
  });

  it("decrypts a legacy envelope with no compression field (raw UTF-8)", async () => {
    // A v1 envelope written before compression existed stored the plaintext as
    // raw UTF-8. Forge one and confirm it still opens.
    const text = "hello legacy";
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      enc.encode("pw"),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
      passwordKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        enc.encode(text),
      ),
    );
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    const legacy = JSON.stringify({
      encrypted: "notes.encrypted.v1",
      kdf: "PBKDF2",
      hash: "SHA-256",
      iterations: 600_000,
      salt: b64(salt),
      iv: b64(iv),
      ciphertext: b64(ct),
      // no `compression` field
    });
    expect(await decryptEnvelope(legacy, "pw")).toBe(text);
  });
});

describe("session keys + deterministic naming", () => {
  it("serializes and parses key params", () => {
    const params = newKeyParams();
    expect(parseKeyParams(serializeKeyParams(params))).toEqual(params);
    expect(parseKeyParams("not json")).toBeNull();
    expect(parseKeyParams('{"v":"other"}')).toBeNull();
  });

  it("derives a stable opaque ref for the same inputs", async () => {
    const params = newKeyParams();
    const { fileKey } = await deriveSessionKeys("pw", params);
    const a = await deriveRef(fileKey, "note", "id-123");
    const b = await deriveRef(fileKey, "note", "id-123");
    expect(a).toBe(b);
    // Lowercase base32, no padding, fixed length (16 bytes → 26 chars).
    expect(a).toMatch(/^[a-z2-7]{26}$/);
  });

  it("derives different refs for different ids/labels", async () => {
    const fileKey = await deriveFileKey("pw", newKeyParams());
    const note = await deriveRef(fileKey, "note", "id-123");
    const other = await deriveRef(fileKey, "note", "id-124");
    const labelled = await deriveRef(fileKey, "att", "id-123");
    expect(note).not.toBe(other);
    expect(note).not.toBe(labelled);
  });

  it("does not leak the id in the ref (different password → different ref)", async () => {
    const params = newKeyParams();
    const one = await deriveRef(
      await deriveFileKey("pw1", params),
      "note",
      "x",
    );
    const two = await deriveRef(
      await deriveFileKey("pw2", params),
      "note",
      "x",
    );
    expect(one).not.toBe(two);
  });
});
