import { describe, expect, it } from "vitest";

import {
  type ConfigPlaneStore,
  type PublishedDaemon,
  parseConfigPlane,
  publishDaemon,
  readPublishedDaemons,
  serializeConfigPlane,
  upsertDaemon,
} from "../../src/storage/notesd/config-plane.ts";

const A: PublishedDaemon = {
  name: "imac",
  endpoint: "https://192.168.1.20:8443",
  fingerprint: "sha256:AAA",
};
const B: PublishedDaemon = {
  name: "nas",
  endpoint: "https://10.0.0.9:8443",
  fingerprint: "sha256:BBB",
};

function memoryStore(initial: string | null = null): ConfigPlaneStore {
  let text = initial;
  return {
    load: async () => text,
    save: async (t) => {
      text = t;
    },
  };
}

describe("config plane codec", () => {
  it("round-trips a daemon list", () => {
    const raw = serializeConfigPlane([A, B]);
    expect(parseConfigPlane(raw)).toEqual([A, B]);
  });

  it("returns [] for missing or corrupt input", () => {
    expect(parseConfigPlane(null)).toEqual([]);
    expect(parseConfigPlane("not json")).toEqual([]);
    expect(parseConfigPlane("{}")).toEqual([]);
    expect(parseConfigPlane('{"daemons":"nope"}')).toEqual([]);
  });

  it("drops malformed entries and never trusts a bad endpoint or pin", () => {
    const raw = JSON.stringify({
      v: 1,
      daemons: [
        A,
        { name: "x", endpoint: "http://insecure:1", fingerprint: "sha256:C" },
        { name: "y", endpoint: "https://ok:1", fingerprint: "md5:D" },
        { name: "z", endpoint: "https://ok:1" },
        "garbage",
      ],
    });
    expect(parseConfigPlane(raw)).toEqual([A]);
  });

  it("dedupes by fingerprint, first seen wins", () => {
    const raw = JSON.stringify({
      v: 1,
      daemons: [A, { ...B, fingerprint: A.fingerprint }],
    });
    expect(parseConfigPlane(raw)).toEqual([A]);
  });

  it("upsert replaces the same fingerprint and appends new ones", () => {
    const renamed = { ...A, name: "imac-pro" };
    expect(upsertDaemon([A, B], renamed)).toEqual([B, renamed]);
    expect(upsertDaemon([A], B)).toEqual([A, B]);
  });
});

describe("config plane store", () => {
  it("publishes into an empty store and reads it back", async () => {
    const store = memoryStore();
    await publishDaemon(store, A);
    expect(await readPublishedDaemons(store)).toEqual([A]);
  });

  it("publish is insert-or-update, keyed by fingerprint", async () => {
    const store = memoryStore(serializeConfigPlane([A, B]));
    await publishDaemon(store, { ...A, endpoint: "https://newaddr:9" });
    const list = await readPublishedDaemons(store);
    expect(list).toHaveLength(2);
    expect(list.find((d) => d.fingerprint === A.fingerprint)?.endpoint).toBe(
      "https://newaddr:9",
    );
  });
});
