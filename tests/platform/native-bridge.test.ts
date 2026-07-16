// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPinnedFetch,
  haptics,
  isNative,
  pinnedFetch,
} from "../../src/platform/native-bridge.ts";

type PostMessage = ReturnType<typeof vi.fn>;

function installWebView(): PostMessage {
  const postMessage = vi.fn();
  (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = {
    postMessage,
  };
  return postMessage;
}

function removeWebView(): void {
  delete (window as unknown as { ReactNativeWebView?: unknown })
    .ReactNativeWebView;
}

function lastMessage(post: PostMessage): Record<string, unknown> {
  const call = post.mock.calls.at(-1);
  expect(call).toBeDefined();
  return JSON.parse(call![0] as string) as Record<string, unknown>;
}

function replyFromNative(payload: Record<string, unknown>): void {
  (
    window as unknown as {
      __NOTES_NATIVE__: { resolve(p: Record<string, unknown>): void };
    }
  ).__NOTES_NATIVE__.resolve(payload);
}

afterEach(() => {
  removeWebView();
  vi.restoreAllMocks();
});

describe("isNative", () => {
  it("is false without the WebView bridge and true with it", () => {
    expect(isNative()).toBe(false);
    installWebView();
    expect(isNative()).toBe(true);
  });
});

describe("haptics.vibrate", () => {
  it("falls back to navigator.vibrate on the web", () => {
    const vibrate = vi.fn();
    (navigator as unknown as { vibrate: unknown }).vibrate = vibrate;
    haptics.vibrate(8);
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it("posts a native message inside the wrapper", () => {
    const post = installWebView();
    haptics.vibrate([10, 20]);
    expect(lastMessage(post)).toMatchObject({
      v: 1,
      type: "haptics.vibrate",
      pattern: [10, 20],
    });
  });
});

describe("pinnedFetch", () => {
  it("rejects on the web (no bridge to pin through)", async () => {
    await expect(
      pinnedFetch("https://x.test/", undefined, "pin"),
    ).rejects.toThrow(/only available in the native wrapper/);
  });

  it("sends a request and resolves the native reply as a Response", async () => {
    const post = installWebView();
    const promise = pinnedFetch(
      "https://daemon.test/v1/notes",
      { method: "POST", body: "payload", headers: { "x-test": "1" } },
      "sha256:abc",
    );

    // Let the async body read settle so the message is posted.
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    const msg = lastMessage(post);
    expect(msg).toMatchObject({
      v: 1,
      type: "pinnedFetch.request",
      url: "https://daemon.test/v1/notes",
      method: "POST",
      spkiPin: "sha256:abc",
    });
    expect((msg.headers as Record<string, string>)["x-test"]).toBe("1");
    // "payload" base64-encoded.
    expect(msg.bodyBase64).toBe(btoa("payload"));

    replyFromNative({
      id: msg.id,
      status: 201,
      statusText: "Created",
      headers: { "content-type": "text/plain" },
      bodyBase64: btoa("ok"),
    });

    const res = await promise;
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("ok");
  });

  it("propagates a native error", async () => {
    const post = installWebView();
    const promise = pinnedFetch(
      "https://daemon.test/",
      { method: "GET" },
      "pin",
    );
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    const msg = lastMessage(post);
    // GET carries no body.
    expect(msg.bodyBase64).toBeNull();

    replyFromNative({
      id: msg.id,
      error: { name: "PinFailure", message: "certificate pin mismatch" },
    });

    await expect(promise).rejects.toThrow(/certificate pin mismatch/);
  });
});

describe("createPinnedFetch", () => {
  it("binds a pin into a fetch-shaped function", async () => {
    const post = installWebView();
    const fetchImpl = createPinnedFetch("sha256:bound");
    void fetchImpl("https://daemon.test/v1/rev");
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(lastMessage(post).spkiPin).toBe("sha256:bound");
  });
});
