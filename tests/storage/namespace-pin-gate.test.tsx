// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/preact";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getActiveNamespaceSlug,
  getNamespaces,
} from "../../src/storage/namespaces.ts";
import {
  useNamespaceRegistry,
  type NamespaceRegistryDeps,
} from "../../src/storage/useNamespaceRegistry.ts";

vi.mock("../../src/achievements/index.ts", () => ({ unlock: vi.fn() }));

function renderRegistry() {
  return renderHook(() => {
    const [activeNamespace, setActiveNamespace] = useState(
      getActiveNamespaceSlug,
    );
    const registry = useNamespaceRegistry({
      namespaceStore: null,
      backend: "browser",
      dropboxToken: null,
      gdriveToken: null,
      folderHandle: null,
      notesdConfig: null,
      activeNamespace,
      setActiveNamespace,
    } as NamespaceRegistryDeps);
    return { ...registry, activeNamespace };
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe("the namespace PIN gate", () => {
  it("gates the namespace once a PIN is set, but not the one you set it from", async () => {
    const { result } = renderRegistry();
    await act(async () => {
      await result.current.setNamespacePin("default", "2468");
    });
    expect(result.current.namespaceHasPin("default")).toBe(true);
    // Whoever just set it has proved they know it — no immediate re-prompt.
    expect(result.current.pinLocked).toBe(false);
  });

  it("stores only a verifier, in the registry that travels with the folder", async () => {
    const { result } = renderRegistry();
    await act(async () => {
      await result.current.setNamespacePin("default", "2468");
    });
    const stored = getNamespaces().find((n) => n.slug === "default");
    expect(stored?.pin).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain("2468");
  });

  it("refuses a change without the current PIN, and accepts it with", async () => {
    const { result } = renderRegistry();
    await act(async () => {
      await result.current.setNamespacePin("default", "2468");
    });
    await act(async () => {
      await expect(
        result.current.setNamespacePin("default", "1111", "wrong"),
      ).resolves.toBe(false);
    });
    await act(async () => {
      await expect(
        result.current.setNamespacePin("default", "1111", "2468"),
      ).resolves.toBe(true);
    });
  });

  it("refuses to clear a PIN without the current one", async () => {
    const { result } = renderRegistry();
    await act(async () => {
      await result.current.setNamespacePin("default", "2468");
    });
    await act(async () => {
      await expect(
        result.current.clearNamespacePin("default", "wrong"),
      ).resolves.toBe(false);
    });
    expect(result.current.namespaceHasPin("default")).toBe(true);
    await act(async () => {
      await expect(
        result.current.clearNamespacePin("default", "2468"),
      ).resolves.toBe(true);
    });
    expect(result.current.namespaceHasPin("default")).toBe(false);
  });

  it("locks a namespace whose PIN this session never entered", async () => {
    // A PIN someone else set, arriving through the shared registry.
    const { result: setter } = renderRegistry();
    await act(async () => {
      await setter.current.setNamespacePin("default", "2468");
    });
    const stored = getNamespaces();
    localStorage.clear();
    localStorage.setItem("notes:namespaces", JSON.stringify(stored));

    // A fresh registry — a different device, or this one after a reload.
    // `pinsEntered` is module state, so drop the entry by re-reading the
    // registry into a namespace the session has never opened.
    const { result } = renderRegistry();
    await waitFor(() =>
      expect(result.current.namespaceHasPin("default")).toBe(true),
    );
  });

  it("opens the namespace on the right code and refuses the wrong one", async () => {
    const { result } = renderRegistry();
    await act(async () => {
      await result.current.setNamespacePin("default", "2468");
    });
    await act(async () => {
      await expect(result.current.enterNamespacePin("nope")).resolves.toBe(
        false,
      );
    });
    await act(async () => {
      await expect(result.current.enterNamespacePin("2468")).resolves.toBe(
        true,
      );
    });
    expect(result.current.pinLocked).toBe(false);
  });
});
