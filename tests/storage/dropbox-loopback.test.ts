// @vitest-environment jsdom
//
// The desktop Dropbox sign-in is the framework's `runLoopbackAuth` (its flow
// and its failure modes are tested there). What notes owns is the wiring:
// that the desktop connect reaches the framework's Dropbox flow with THIS
// app's key and log, rather than a copy of the flow that could drift.

import { afterEach, describe, expect, it, vi } from "vitest";

const frameworkConnect = vi.fn(async () => ({
  accessToken: "at",
  refreshToken: "rt",
}));
vi.mock("@niclaslindstedt/oss-framework/storage", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@niclaslindstedt/oss-framework/storage")
  >()),
  connectDropboxLoopback: (...args: unknown[]) =>
    frameworkConnect(...(args as [])),
}));

import { DROPBOX_APP_KEY } from "../../src/storage/cloud-configured.ts";
import { connectDropboxLoopback } from "../../src/storage/dropbox/index.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("connectDropboxLoopback", () => {
  it("runs the framework's flow with this app's key, fetch and log", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(connectDropboxLoopback(fetchImpl)).resolves.toEqual({
      accessToken: "at",
      refreshToken: "rt",
    });
    expect(frameworkConnect).toHaveBeenCalledTimes(1);
    const [key, passedFetch, logger] = frameworkConnect.mock
      .calls[0] as unknown as [string, typeof fetch, Record<string, unknown>];
    expect(key).toBe(DROPBOX_APP_KEY);
    expect(passedFetch).toBe(fetchImpl);
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });
});
