// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unlock } from "../../src/achievements/index.ts";
import type { StorageAdapter } from "../../src/storage/adapter.ts";
import type { BackendId } from "../../src/storage/backend-preference.ts";
import type { DirectoryCrypto } from "../../src/storage/directory-adapter.ts";
import {
  type FolderBackendDeps,
  useFolderBackend,
} from "../../src/storage/useFolderBackend.ts";

// The connect verb fires the "localVault" achievement; spy on it rather than
// draining the real bus.
vi.mock("../../src/achievements/index.ts", () => ({ unlock: vi.fn() }));

// The active backend selection is read from localStorage; the hook keys its
// boot probe off it, so make it controllable per test.
let backendMock: BackendId = "browser";
vi.mock("../../src/storage/backend-preference.ts", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../src/storage/backend-preference.ts")
    >();
  return { ...actual, getBackend: () => backendMock };
});

// The IndexedDB-backed handle store reaches real IndexedDB; the hook only needs
// it to load / persist / clear the grant, so stub each and assert the calls.
const loadDirectoryHandle = vi.fn();
const ensurePermission = vi.fn();
const saveDirectoryHandle = vi.fn(async (_h?: FileSystemDirectoryHandle) => {});
const clearDirectoryHandle = vi.fn(async () => {});
vi.mock("../../src/storage/folder/handle-store.ts", () => ({
  loadDirectoryHandle: () => loadDirectoryHandle(),
  ensurePermission: (h: FileSystemDirectoryHandle, req?: boolean) =>
    ensurePermission(h, req),
  saveDirectoryHandle: (h: FileSystemDirectoryHandle) => saveDirectoryHandle(h),
  clearDirectoryHandle: () => clearDirectoryHandle(),
  isFolderBackendAvailable: () => true,
}));

// The folder adapter performs real File System Access I/O; the hook only loads
// from / saves to it during a seed or mirror, so return a fake and assert.
const createFolderAdapter = vi.fn();
vi.mock("../../src/storage/folder/index.ts", () => ({
  createFolderAdapter: (opts: unknown) => createFolderAdapter(opts),
}));

function fakeAdapter(over: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    id: "browser",
    label: "Fake",
    capabilities: new Set(),
    load: vi.fn(async () => null),
    save: vi.fn(async (text: string) => ({ text })),
    ...over,
  };
}

const dummyCrypto: DirectoryCrypto = {
  passwordRef: { current: null },
  onDecryptNote: { current: null },
};

const fakeHandle = {} as FileSystemDirectoryHandle;

// A deps bundle with a live active adapter + namespace and spyable wrap /
// select dependencies. `browserSave` captures what the disconnect mirror writes.
function makeDeps(over: Partial<FolderBackendDeps> = {}): {
  deps: FolderBackendDeps;
  source: StorageAdapter;
  browserSave: ReturnType<typeof vi.fn>;
  selectBackend: ReturnType<typeof vi.fn>;
  wrapBrowserForActive: ReturnType<typeof vi.fn>;
} {
  const source = fakeAdapter();
  const browserSave = vi.fn(async (text: string) => ({ text }));
  const wrapBrowserForActive = vi.fn(() => fakeAdapter({ save: browserSave }));
  const selectBackend = vi.fn();
  const deps: FolderBackendDeps = {
    activeRef: { current: { adapter: source, activeNamespace: "default" } },
    directoryCrypto: dummyCrypto,
    wrapBrowserForActive,
    selectBackend,
    ...over,
  };
  return { deps, source, browserSave, selectBackend, wrapBrowserForActive };
}

beforeEach(() => {
  vi.clearAllMocks();
  backendMock = "browser";
  loadDirectoryHandle.mockResolvedValue(null);
  ensurePermission.mockResolvedValue("granted");
  createFolderAdapter.mockReturnValue(fakeAdapter());
  Object.defineProperty(window, "showDirectoryPicker", {
    configurable: true,
    writable: true,
    value: vi.fn(async () => fakeHandle),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useFolderBackend", () => {
  it("resolves loaded with no handle when the backend isn't the folder", async () => {
    const { deps } = makeDeps();
    const { result } = renderHook(() => useFolderBackend(deps));
    await waitFor(() => expect(result.current.folderHandleLoaded).toBe(true));
    expect(result.current.folderHandle).toBeNull();
    expect(result.current.folderReconnectNeeded).toBe(false);
    expect(loadDirectoryHandle).not.toHaveBeenCalled();
  });

  it("boot probe rehydrates a still-granted folder handle", async () => {
    backendMock = "folder";
    loadDirectoryHandle.mockResolvedValue(fakeHandle);
    ensurePermission.mockResolvedValue("granted");
    const { deps } = makeDeps();
    const { result } = renderHook(() => useFolderBackend(deps));
    await waitFor(() => expect(result.current.folderHandle).toBe(fakeHandle));
    expect(result.current.folderHandleLoaded).toBe(true);
    expect(result.current.folderReconnectNeeded).toBe(false);
    expect(ensurePermission).toHaveBeenCalledWith(fakeHandle, false);
  });

  it("boot probe surfaces a reconnect cue when the grant was revoked", async () => {
    backendMock = "folder";
    loadDirectoryHandle.mockResolvedValue(fakeHandle);
    ensurePermission.mockResolvedValue("prompt-denied");
    const { deps } = makeDeps();
    const { result } = renderHook(() => useFolderBackend(deps));
    await waitFor(() =>
      expect(result.current.folderReconnectNeeded).toBe(true),
    );
    expect(result.current.folderHandle).toBeNull();
    expect(result.current.folderHandleLoaded).toBe(true);
  });

  it("boot probe with no stored handle just resolves loaded", async () => {
    backendMock = "folder";
    loadDirectoryHandle.mockResolvedValue(null);
    const { deps } = makeDeps();
    const { result } = renderHook(() => useFolderBackend(deps));
    await waitFor(() => expect(result.current.folderHandleLoaded).toBe(true));
    expect(result.current.folderHandle).toBeNull();
    expect(result.current.folderReconnectNeeded).toBe(false);
    expect(ensurePermission).not.toHaveBeenCalled();
  });

  it("markFolderPermissionLost drops the handle and asks to reconnect", async () => {
    backendMock = "folder";
    loadDirectoryHandle.mockResolvedValue(fakeHandle);
    ensurePermission.mockResolvedValue("granted");
    const { deps } = makeDeps();
    const { result } = renderHook(() => useFolderBackend(deps));
    await waitFor(() => expect(result.current.folderHandle).toBe(fakeHandle));
    act(() => result.current.markFolderPermissionLost());
    expect(result.current.folderHandle).toBeNull();
    expect(result.current.folderReconnectNeeded).toBe(true);
  });

  it("connectFolder seeds an empty folder from the active document and switches", async () => {
    const folderSave = vi.fn(async (text: string) => ({ text }));
    createFolderAdapter.mockReturnValue(
      fakeAdapter({ load: vi.fn(async () => null), save: folderSave }),
    );
    const { deps, source } = makeDeps();
    source.load = vi.fn(async () => ({ text: "DOC" }));
    const { result } = renderHook(() => useFolderBackend(deps));
    await act(async () => {
      await result.current.connectFolder();
    });
    // Empty folder → seeded with the current document.
    expect(folderSave).toHaveBeenCalledWith("DOC");
    expect(saveDirectoryHandle).toHaveBeenCalledWith(fakeHandle);
    expect(deps.selectBackend).toHaveBeenCalledWith("folder");
    expect(unlock).toHaveBeenCalledWith("localVault");
    expect(result.current.folderHandle).toBe(fakeHandle);
  });

  it("connectFolder adopts a non-empty folder without overwriting it", async () => {
    const folderSave = vi.fn(async (text: string) => ({ text }));
    createFolderAdapter.mockReturnValue(
      fakeAdapter({
        load: vi.fn(async () => ({ text: "REMOTE" })),
        save: folderSave,
      }),
    );
    const { deps, source } = makeDeps();
    source.load = vi.fn(async () => ({ text: "DOC" }));
    const { result } = renderHook(() => useFolderBackend(deps));
    await act(async () => {
      await result.current.connectFolder();
    });
    // Folder already holds notes → it wins, no seed write.
    expect(folderSave).not.toHaveBeenCalled();
    expect(deps.selectBackend).toHaveBeenCalledWith("folder");
    expect(result.current.folderHandle).toBe(fakeHandle);
  });

  it("connectFolder is a no-op when the picker is dismissed", async () => {
    (window.showDirectoryPicker as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException("dismissed", "AbortError"),
    );
    const { deps } = makeDeps();
    const { result } = renderHook(() => useFolderBackend(deps));
    await act(async () => {
      await result.current.connectFolder();
    });
    expect(deps.selectBackend).not.toHaveBeenCalled();
    expect(saveDirectoryHandle).not.toHaveBeenCalled();
    expect(result.current.folderHandle).toBeNull();
  });

  it("disconnectFolder mirrors the folder back to the browser store and switches", async () => {
    backendMock = "folder";
    loadDirectoryHandle.mockResolvedValue(fakeHandle);
    ensurePermission.mockResolvedValue("granted");
    const { deps, browserSave } = makeDeps();
    const { result } = renderHook(() => useFolderBackend(deps));
    await waitFor(() => expect(result.current.folderHandle).toBe(fakeHandle));
    // The disconnect mirror reads the folder's current document.
    createFolderAdapter.mockReturnValue(
      fakeAdapter({ load: vi.fn(async () => ({ text: "FOLDERDOC" })) }),
    );
    await act(async () => {
      await result.current.disconnectFolder();
    });
    expect(browserSave).toHaveBeenCalledWith("FOLDERDOC");
    expect(clearDirectoryHandle).toHaveBeenCalled();
    expect(deps.selectBackend).toHaveBeenCalledWith("browser");
    expect(result.current.folderHandle).toBeNull();
  });

  it("reconnectFolder re-grants an already-stored handle", async () => {
    loadDirectoryHandle.mockResolvedValue(fakeHandle);
    ensurePermission.mockResolvedValue("granted");
    const { deps } = makeDeps();
    const { result } = renderHook(() => useFolderBackend(deps));
    await waitFor(() => expect(result.current.folderHandleLoaded).toBe(true));
    await act(async () => {
      await result.current.reconnectFolder();
    });
    expect(ensurePermission).toHaveBeenCalledWith(fakeHandle, true);
    expect(result.current.folderHandle).toBe(fakeHandle);
    expect(result.current.folderReconnectNeeded).toBe(false);
  });

  it("reconnectFolder falls back to the picker when nothing is stored", async () => {
    loadDirectoryHandle.mockResolvedValue(null);
    createFolderAdapter.mockReturnValue(
      fakeAdapter({ load: vi.fn(async () => null) }),
    );
    const { deps, source } = makeDeps();
    source.load = vi.fn(async () => ({ text: "DOC" }));
    const { result } = renderHook(() => useFolderBackend(deps));
    await waitFor(() => expect(result.current.folderHandleLoaded).toBe(true));
    await act(async () => {
      await result.current.reconnectFolder();
    });
    // Fell through to connectFolder → picked + switched.
    expect(window.showDirectoryPicker).toHaveBeenCalled();
    expect(deps.selectBackend).toHaveBeenCalledWith("folder");
  });
});
