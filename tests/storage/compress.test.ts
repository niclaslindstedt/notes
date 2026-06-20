import { describe, expect, it } from "vitest";

import {
  gunzip,
  gunzipText,
  gzip,
  gzipText,
} from "../../src/storage/compress.ts";

describe("compress", () => {
  it("round-trips text through gzip", async () => {
    const text = "the quick brown fox ".repeat(100);
    const packed = await gzipText(text);
    expect(packed.length).toBeLessThan(text.length);
    expect(await gunzipText(packed)).toBe(text);
  });

  it("round-trips empty input", async () => {
    expect(await gunzipText(await gzipText(""))).toBe("");
    const empty = new Uint8Array(0);
    expect([...(await gunzip(await gzip(empty)))]).toEqual([]);
  });

  it("round-trips arbitrary bytes", async () => {
    const bytes = new Uint8Array(4096);
    crypto.getRandomValues(bytes);
    const packed = await gzip(bytes);
    expect([...(await gunzip(packed))]).toEqual([...bytes]);
  });

  it("round-trips unicode text", async () => {
    const text = "café — naïve — 日本語 — 🎉";
    expect(await gunzipText(await gzipText(text))).toBe(text);
  });
});
