// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { haptics, isNative } from "../../src/platform/native-bridge.ts";

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
