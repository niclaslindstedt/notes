// @vitest-environment jsdom
// The phone app (`VITE_TARGET=native`) carries no What's new, by owner
// decision — the App Store's own What's New tells a phone what each update
// brought. Its side menu has no entry, its app no modal, and its bundle none of
// CHANGELOG.md or the feature docs (`CHANGELOG_IN_BUILD`; the bundle script
// refuses a webroot that has them). The website and the desktop app keep it.
// Each case stubs the build's environment, then loads the modules afresh so
// their build-time constants are read under it.
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModalCommand } from "../../src/ui/modal-bus.ts";

const PHONE = "native";
const WEB = "";

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

function build(target: string) {
  vi.resetModules();
  vi.stubEnv("VITE_TARGET", target);
}

// The About dropdown's rows, rendered under the stubbed build, and the
// dispatch they would call.
async function aboutRows(): Promise<{
  rows: string[];
  dispatch: ReturnType<typeof vi.fn<(command: ModalCommand) => void>>;
}> {
  const { fireEvent, render, screen } = await import("@testing-library/preact");
  const { ModalBusContext } = await import("../../src/ui/modal-bus.ts");
  const { SideMenuFooter } = await import("../../src/ui/SideMenuFooter.tsx");
  const dispatch = vi.fn<(command: ModalCommand) => void>();
  render(
    <ModalBusContext.Provider
      value={{ dispatch, active: null, close: vi.fn() }}
    >
      <SideMenuFooter onClose={vi.fn()} />
    </ModalBusContext.Provider>,
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "About" }));
  const rows = screen
    .getAllByRole("menuitem")
    .map((row) => row.textContent ?? "");
  return { rows, dispatch };
}

// The What's new host, rendered with the changelog command already open.
async function openChangelogHost(): Promise<void> {
  const { render } = await import("@testing-library/preact");
  const { ModalBusContext } = await import("../../src/ui/modal-bus.ts");
  const { ChangelogModalHost } =
    await import("../../src/app/modals/ChangelogModalHost.tsx");
  render(
    <ModalBusContext.Provider
      value={{
        dispatch: vi.fn(),
        active: { kind: "changelog" },
        close: vi.fn(),
      }}
    >
      <ChangelogModalHost />
    </ModalBusContext.Provider>,
  );
}

describe("What's new in the phone app", () => {
  it("is not in the build", async () => {
    build(PHONE);
    const { CHANGELOG_IN_BUILD, PHONE_BUILD } =
      await import("../../src/build-env.ts");
    expect(PHONE_BUILD).toBe(true);
    expect(CHANGELOG_IN_BUILD).toBe(false);
  });

  it("has no entry in the side menu", async () => {
    build(PHONE);
    const { rows } = await aboutRows();
    expect(rows).toContain("Privacy");
    expect(rows.join(" ")).not.toMatch(/what's new/i);
  });

  it("opens nothing, even when asked to", async () => {
    build(PHONE);
    await openChangelogHost();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.body.textContent).toBe("");
  });

  it("carries none of the changelog's strings", async () => {
    build(PHONE);
    const { en } = await import("../../src/i18n/locales/en/index.ts");
    const { sv } = await import("../../src/i18n/locales/sv/index.ts");
    expect(en.changelog).toEqual({});
    expect(sv.changelog).toEqual({});
  });
});

describe("What's new on the website and the desktop app", () => {
  it("is in the build, with its entry in the side menu", async () => {
    build(WEB);
    const { CHANGELOG_IN_BUILD } = await import("../../src/build-env.ts");
    expect(CHANGELOG_IN_BUILD).toBe(true);
    const { fireEvent, screen } = await import("@testing-library/preact");
    const { rows, dispatch } = await aboutRows();
    expect(rows).toContain("What's new");
    fireEvent.click(screen.getByRole("menuitem", { name: "What's new" }));
    expect(dispatch).toHaveBeenCalledWith({ kind: "changelog" });
  });

  it("opens the release history", async () => {
    build(WEB);
    const { screen } = await import("@testing-library/preact");
    await openChangelogHost();
    expect(await screen.findByText(/1\.5\.0/)).toBeTruthy();
  });
});

describe("the phone bundle's refusal of What's new", () => {
  // `native/scripts/bundle-web.mjs` refuses a webroot carrying CHANGELOG.md's
  // header line, so that line has to stay in CHANGELOG.md for the check to
  // bite.
  it("looks for a line CHANGELOG.md has", () => {
    const script = readFileSync("native/scripts/bundle-web.mjs", "utf8");
    expect(script).toContain('"Keep a Changelog"');
    expect(readFileSync("CHANGELOG.md", "utf8")).toContain("Keep a Changelog");
  });
});
