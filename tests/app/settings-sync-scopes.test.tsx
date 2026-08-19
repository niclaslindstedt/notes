// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsSync } from "../../src/app/use-settings-sync.ts";
import {
  getAppearance,
  getAppearanceLayer,
  replaceAppearanceLayer,
  setAppearanceNamespace,
  updateAppearance,
} from "../../src/theme/useTheme.ts";

function fakeStore(initial: string | null = null) {
  let current = initial;
  const saves: string[] = [];
  return {
    saves,
    async load() {
      return current;
    },
    async save(text: string) {
      current = text;
      saves.push(text);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  setAppearanceNamespace("default");
  replaceAppearanceLayer("global", {});
  replaceAppearanceLayer("namespace", {});
  replaceAppearanceLayer("device", {});
});

describe("settings sync across the widths", () => {
  it("adopts each backend file into its own layer", async () => {
    const global = fakeStore(JSON.stringify({ theme: "light" }));
    const namespace = fakeStore(JSON.stringify({ fontScale: 1.25 }));
    renderHook(() => useSettingsSync(global, namespace, "default"));

    await waitFor(() => expect(getAppearance().theme).toBe("light"));
    expect(getAppearance().fontScale).toBe(1.25);
    expect(getAppearanceLayer("global")).toEqual({ theme: "light" });
    expect(getAppearanceLayer("namespace")).toEqual({ fontScale: 1.25 });
  });

  it("seeds a missing file from this device's layer", async () => {
    replaceAppearanceLayer("global", { theme: "light" });
    const global = fakeStore(null);
    const namespace = fakeStore(null);
    renderHook(() => useSettingsSync(global, namespace, "default"));

    await waitFor(() => expect(global.saves.length).toBe(1));
    expect(JSON.parse(global.saves[0] as string)).toEqual({ theme: "light" });
    // The namespace layer is empty, and an empty file is exactly right: the
    // namespace has no opinion yet and everything falls through to global.
    await waitFor(() => expect(namespace.saves.length).toBe(1));
    expect(JSON.parse(namespace.saves[0] as string)).toEqual({});
  });

  it("never uploads the device layer", async () => {
    const global = fakeStore(JSON.stringify({}));
    const namespace = fakeStore(JSON.stringify({}));
    renderHook(() => useSettingsSync(global, namespace, "default"));
    await waitFor(() => expect(getAppearanceLayer("global")).toEqual({}));

    const before = [global.saves.length, namespace.saves.length];
    replaceAppearanceLayer("device", { theme: "excel" });
    // The device layer is this install's alone — a shared login must not see
    // one person's choice arrive in everyone's file.
    await new Promise((r) => setTimeout(r, 0));
    expect([global.saves.length, namespace.saves.length]).toEqual(before);
    expect(getAppearance().theme).toBe("excel");
  });

  it("pushes a layer only when that layer changed", async () => {
    const global = fakeStore(JSON.stringify({ theme: "light" }));
    const namespace = fakeStore(JSON.stringify({}));
    renderHook(() => useSettingsSync(global, namespace, "default"));
    await waitFor(() => expect(getAppearance().theme).toBe("light"));

    const namespaceSaves = namespace.saves.length;
    updateAppearance("theme", "monokai");
    await waitFor(() =>
      expect(JSON.parse(global.saves.at(-1) as string)).toEqual({
        theme: "monokai",
      }),
    );
    // The namespace file is bytes nobody changed; re-uploading it on a global
    // edit is a write race between people on a shared login.
    expect(namespace.saves.length).toBe(namespaceSaves);
  });
});
