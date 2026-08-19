import { describe, expect, it } from "vitest";

import {
  createNamespacePin,
  isNamespacePin,
  PIN_MIN_LENGTH,
  verifyNamespacePin,
} from "../../src/storage/namespace-pin.ts";

describe("namespace PIN verifier", () => {
  it("verifies the code it was minted from", async () => {
    const pin = await createNamespacePin("2468");
    await expect(verifyNamespacePin("2468", pin)).resolves.toBe(true);
  });

  it("rejects a wrong code, including a matching prefix", async () => {
    const pin = await createNamespacePin("2468");
    await expect(verifyNamespacePin("2469", pin)).resolves.toBe(false);
    await expect(verifyNamespacePin("246", pin)).resolves.toBe(false);
    await expect(verifyNamespacePin("24680", pin)).resolves.toBe(false);
    await expect(verifyNamespacePin("", pin)).resolves.toBe(false);
  });

  it("never stores the code itself", async () => {
    const pin = await createNamespacePin("hunter2");
    expect(JSON.stringify(pin)).not.toContain("hunter2");
  });

  it("salts every PIN separately, so two identical codes don't match", async () => {
    const a = await createNamespacePin("2468");
    const b = await createNamespacePin("2468");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    // Both still verify — the salt travels with the verifier.
    await expect(verifyNamespacePin("2468", a)).resolves.toBe(true);
    await expect(verifyNamespacePin("2468", b)).resolves.toBe(true);
  });

  it("refuses a code shorter than the minimum", async () => {
    await expect(
      createNamespacePin("1".repeat(PIN_MIN_LENGTH - 1)),
    ).rejects.toThrow(/at least/);
  });

  it("guards the stored shape so a corrupt entry can't read back ungated", () => {
    expect(isNamespacePin({ salt: "a", hash: "b", iterations: 1 })).toBe(true);
    expect(isNamespacePin({ salt: "", hash: "b", iterations: 1 })).toBe(false);
    expect(isNamespacePin({ salt: "a", hash: "b" })).toBe(false);
    expect(isNamespacePin({ salt: "a", hash: "b", iterations: 0 })).toBe(false);
    expect(isNamespacePin(null)).toBe(false);
    expect(isNamespacePin("2468")).toBe(false);
  });

  it("survives a corrupt hash rather than throwing", async () => {
    await expect(
      verifyNamespacePin("2468", {
        salt: (await createNamespacePin("2468")).salt,
        hash: "!!!not base64!!!",
        iterations: 1000,
      }),
    ).resolves.toBe(false);
  });
});
