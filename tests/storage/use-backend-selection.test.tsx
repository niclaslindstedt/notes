// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryCrypto } from "../../src/storage/directory-adapter.ts";
import {
  type BackendSelectionDeps,
  useBackendSelection,
} from "../../src/storage/useBackendSelection.ts";

// makeInner's dropbox/gdrive branches build real cloud adapters, which only log
// on construction (no network until load/save), so they're safe to build here;
// the folder branch only stashes the handle. A minimal crypto/seal/unseal is
// enough — none of it runs at construction time.
const crypto: DirectoryCrypto = { passwordRef: { current: null } };

function deps(over: Partial<BackendSelectionDeps> = {}): BackendSelectionDeps {
  return {
    backend: "browser",
    dropboxToken: null,
    dropboxRefresh: null,
    gdriveToken: null,
    rememberDropboxAccessToken: vi.fn(),
    folderHandle: null,
    folderHandleLoaded: false,
    markFolderPermissionLost: vi.fn(),
    directoryCrypto: crypto,
    seal: async (s) => s,
    unseal: async (s) => s,
    ...over,
  };
}

const fakeHandle = {} as FileSystemDirectoryHandle;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("useBackendSelection — selection resolution", () => {
  it("defaults to the browser backend", () => {
    const { result } = renderHook(() => useBackendSelection(deps()));
    expect(result.current.selection).toEqual({ kind: "browser" });
  });

  it("resolves dropbox only when the token is present", () => {
    const connected = renderHook(() =>
      useBackendSelection(deps({ backend: "dropbox", dropboxToken: "tok" })),
    );
    expect(connected.result.current.selection.kind).toBe("dropbox");

    const noToken = renderHook(() =>
      useBackendSelection(deps({ backend: "dropbox", dropboxToken: null })),
    );
    // Falls through to the browser store so editing keeps working pre-connect.
    expect(noToken.result.current.selection.kind).toBe("browser");
  });

  it("carries the dropbox auth, wiring the refresh callback through", () => {
    const rememberDropboxAccessToken = vi.fn();
    const { result } = renderHook(() =>
      useBackendSelection(
        deps({
          backend: "dropbox",
          dropboxToken: "acc",
          dropboxRefresh: "ref",
          rememberDropboxAccessToken,
        }),
      ),
    );
    const sel = result.current.selection;
    if (sel.kind !== "dropbox") throw new Error("expected dropbox selection");
    expect(sel.auth.accessToken).toBe("acc");
    expect(sel.auth.refreshToken).toBe("ref");
    sel.auth.onAccessTokenRefreshed("fresh");
    expect(rememberDropboxAccessToken).toHaveBeenCalledWith("fresh");
  });

  it("resolves gdrive only when the token is present", () => {
    expect(
      renderHook(() =>
        useBackendSelection(deps({ backend: "gdrive", gdriveToken: "g" })),
      ).result.current.selection,
    ).toEqual({ kind: "gdrive", token: "g" });

    expect(
      renderHook(() =>
        useBackendSelection(deps({ backend: "gdrive", gdriveToken: null })),
      ).result.current.selection.kind,
    ).toBe("browser");
  });

  it("resolves folder only once the boot probe has a live handle", () => {
    // Handle present but probe not yet resolved → browser fallback.
    expect(
      renderHook(() =>
        useBackendSelection(
          deps({
            backend: "folder",
            folderHandle: fakeHandle,
            folderHandleLoaded: false,
          }),
        ),
      ).result.current.selection.kind,
    ).toBe("browser");

    // Probe resolved, no handle (revoked grant) → browser fallback.
    expect(
      renderHook(() =>
        useBackendSelection(
          deps({
            backend: "folder",
            folderHandle: null,
            folderHandleLoaded: true,
          }),
        ),
      ).result.current.selection.kind,
    ).toBe("browser");

    // Resolved with a live handle → folder.
    expect(
      renderHook(() =>
        useBackendSelection(
          deps({
            backend: "folder",
            folderHandle: fakeHandle,
            folderHandleLoaded: true,
          }),
        ),
      ).result.current.selection.kind,
    ).toBe("folder");
  });
});

describe("useBackendSelection — makeInner dispatch", () => {
  it("builds a browser adapter for the browser selection", () => {
    const { result } = renderHook(() => useBackendSelection(deps()));
    expect(result.current.makeInner("default").id).toBe("browser");
  });

  it("builds a dropbox adapter (offline-cache wrapped) that keeps its id", () => {
    const { result } = renderHook(() =>
      useBackendSelection(deps({ backend: "dropbox", dropboxToken: "tok" })),
    );
    expect(result.current.makeInner("default").id).toBe("dropbox");
  });

  it("builds a gdrive adapter (offline-cache wrapped) that keeps its id", () => {
    const { result } = renderHook(() =>
      useBackendSelection(deps({ backend: "gdrive", gdriveToken: "g" })),
    );
    expect(result.current.makeInner("default").id).toBe("gdrive");
  });

  it("builds a folder adapter for the folder selection", () => {
    const { result } = renderHook(() =>
      useBackendSelection(
        deps({
          backend: "folder",
          folderHandle: fakeHandle,
          folderHandleLoaded: true,
        }),
      ),
    );
    expect(result.current.makeInner("default").id).toBe("folder");
  });

  it("builds an adapter for any namespace, not just the active one", () => {
    const { result } = renderHook(() => useBackendSelection(deps()));
    // Distinct namespaces get distinct localStorage-scoped browser adapters.
    const a = result.current.makeInner("work");
    const b = result.current.makeInner("travel");
    expect(a.id).toBe("browser");
    expect(b.id).toBe("browser");
    expect(a).not.toBe(b);
  });
});
