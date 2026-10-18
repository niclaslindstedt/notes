// @vitest-environment jsdom
// The phone app's build (`VITE_TARGET=native`) offers no Dropbox and no local
// folder — not a greyed-out option, not a mention — and its privacy page names
// no other edition, while the website and the desktop app keep all of it
// exactly as before. Each case stubs the build's environment, then
// loads the modules afresh so their build-time constants are read under it.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UseStorageBackend } from "../../src/storage/useStorageBackend.ts";
import type { EncryptionConversionState } from "../../src/ui/settings/EncryptionLogModal.tsx";

const PHONE = { VITE_TARGET: "native" };
const WEB = { VITE_TARGET: "" };

function build(env: Record<string, string>, key = "a-dropbox-key") {
  vi.resetModules();
  vi.stubEnv("VITE_DROPBOX_APP_KEY", key);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  document.body.innerHTML = "";
});

const idle: EncryptionConversionState = {
  busy: false,
  direction: null,
  message: null,
  done: 0,
  total: 0,
  error: null,
  log: [],
};

function stubStorage(over: Partial<UseStorageBackend> = {}): UseStorageBackend {
  return {
    backend: "browser",
    // Everything a surface can offer, so only the build decides.
    dropboxAvailable: true,
    dropboxConnected: false,
    folderAvailable: true,
    folderConnected: false,
    folderReconnectNeeded: false,
    icloudAvailable: true,
    encryption: "plaintext",
    selectBrowser: vi.fn(),
    connectFolder: vi.fn(() => Promise.resolve()),
    reconnectFolder: vi.fn(() => Promise.resolve()),
    disconnectFolder: vi.fn(() => Promise.resolve()),
    connectDropbox: vi.fn(),
    disconnectDropbox: vi.fn(),
    enableEncryption: vi.fn(() => Promise.resolve()),
    disableEncryption: vi.fn(() => Promise.resolve()),
    namespaces: [{ slug: "default", name: "Default" }],
    activeNamespace: "default",
    namespaceHasPin: () => false,
    setNamespacePin: vi.fn(() => Promise.resolve(true)),
    clearNamespacePin: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as unknown as UseStorageBackend;
}

// The storage picker's options, rendered under the stubbed build. Preact and
// the testing library are loaded with the section, after the reset, so all
// three share one renderer.
async function pickerRadios(
  over: Partial<UseStorageBackend> = {},
): Promise<HTMLButtonElement[]> {
  const { render, screen } = await import("@testing-library/preact");
  const { StorageSection } =
    await import("../../src/ui/settings/StorageSection.tsx");
  render(<StorageSection storage={stubStorage(over)} conversion={idle} />);
  return screen.getAllByRole("radio") as HTMLButtonElement[];
}

async function pickerOptions(): Promise<string[]> {
  return (await pickerRadios()).map((r) => r.textContent ?? "");
}

describe("Dropbox in the phone app's build", () => {
  it("is not in the build, and no key reaches it", async () => {
    build(PHONE);
    const m = await import("../../src/storage/cloud-configured.ts");
    expect(m.DROPBOX_IN_BUILD).toBe(false);
    expect(m.DROPBOX_APP_KEY).toBe("");
    expect(m.isDropboxConfigured()).toBe(false);
  });

  it("is not listed in the storage picker at all", async () => {
    build(PHONE);
    const options = await pickerOptions();
    expect(options).toContain("iCloud Drive");
    expect(options).toContain("Nextcloud");
    expect(options.join(" ")).not.toMatch(/dropbox/i);
  });

  it("lists this device, iCloud Drive and Nextcloud, and nothing else", async () => {
    build(PHONE);
    expect(await pickerOptions()).toEqual([
      "This device",
      "iCloud Drive",
      "Nextcloud",
    ]);
  });

  it("opens an install that chose Dropbox on this device's store", async () => {
    build(PHONE);
    localStorage.setItem("notes:backend", "dropbox");
    const { getBackend } =
      await import("../../src/storage/backend-preference.ts");
    expect(getBackend()).toBe("browser");
    // The stored choice is left as it was.
    expect(localStorage.getItem("notes:backend")).toBe("dropbox");
  });

  it("drops the Dropbox blocks from the bundled feature docs", async () => {
    build(PHONE);
    const { FEATURE_DOCS } =
      await import("../../src/ui/changelog/feature-docs.ts");
    for (const doc of Object.values(FEATURE_DOCS)) {
      expect(`${doc.title}\n${doc.body}`).not.toMatch(/dropbox|<!--/i);
    }
    expect(FEATURE_DOCS.storage?.body).toMatch(/iCloud Drive/);
  });

  it("leaves Dropbox out of the privacy policy", async () => {
    build(PHONE);
    const { render } = await import("@testing-library/preact");
    const { PrivacyPage } = await import("../../src/ui/PrivacyPage.tsx");
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).not.toMatch(/dropbox/i);
    expect(container.textContent).toMatch(/Nextcloud/);
  });
});

describe("Dropbox on the website and the desktop app", () => {
  it("is in the build with the key it was given", async () => {
    build(WEB);
    const m = await import("../../src/storage/cloud-configured.ts");
    expect(m.DROPBOX_IN_BUILD).toBe(true);
    expect(m.DROPBOX_APP_KEY).toBe("a-dropbox-key");
    expect(m.isDropboxConfigured()).toBe(true);
  });

  it("is listed in the storage picker", async () => {
    build(WEB);
    expect(await pickerOptions()).toContain("Dropbox");
  });

  // Unchanged from before: without a key the option is listed, greyed out.
  it("is listed but disabled when the build has no key", async () => {
    build(WEB, "");
    const { isDropboxConfigured } =
      await import("../../src/storage/cloud-configured.ts");
    expect(isDropboxConfigured()).toBe(false);
    const radios = await pickerRadios({ dropboxAvailable: false });
    const dropbox = radios.find((r) => r.textContent === "Dropbox");
    expect(dropbox?.disabled).toBe(true);
  });

  it("keeps a stored Dropbox choice", async () => {
    build(WEB);
    localStorage.setItem("notes:backend", "dropbox");
    const { getBackend } =
      await import("../../src/storage/backend-preference.ts");
    expect(getBackend()).toBe("dropbox");
  });

  it("keeps the Dropbox blocks in the feature docs, without their markers", async () => {
    build(WEB);
    const { FEATURE_DOCS } =
      await import("../../src/ui/changelog/feature-docs.ts");
    expect(FEATURE_DOCS.storage?.body).toMatch(/\*\*Dropbox\*\*/);
    expect(FEATURE_DOCS.storage?.body).toMatch(/VITE_DROPBOX_APP_KEY/);
    expect(FEATURE_DOCS.storage?.body).not.toMatch(/<!--/);
  });

  it("describes Dropbox in the privacy policy", async () => {
    build(WEB);
    const { render } = await import("@testing-library/preact");
    const { PrivacyPage } = await import("../../src/ui/PrivacyPage.tsx");
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).toMatch(/your own Dropbox/);
  });
});

describe("the local folder in the phone app's build", () => {
  it("is not in the build", async () => {
    build(PHONE);
    const m = await import("../../src/storage/cloud-configured.ts");
    expect(m.FOLDER_IN_BUILD).toBe(false);
  });

  it("is not listed in the storage picker, even where a picker exists", async () => {
    build(PHONE);
    const options = (await pickerRadios({ folderAvailable: true })).map(
      (r) => r.textContent ?? "",
    );
    expect(options.join(" ")).not.toMatch(/folder/i);
  });

  it("is not explained either", async () => {
    build(PHONE);
    await pickerRadios();
    expect(document.body.textContent).not.toMatch(/folder|browser/i);
    expect(document.body.textContent).toMatch(/on this device only/);
  });

  it("shows no folder panel, whatever the backend says", async () => {
    build(PHONE);
    await pickerRadios({ backend: "folder", folderAvailable: true });
    expect(document.body.textContent).not.toMatch(/folder/i);
  });

  it("opens an install that chose the folder on this device's store, its notes untouched", async () => {
    build(PHONE);
    const { LOCAL_STORAGE_KEY } =
      await import("../../src/storage/local/index.ts");
    localStorage.setItem("notes:backend", "folder");
    localStorage.setItem(LOCAL_STORAGE_KEY, '{"notes":"on the device"}');
    const { getBackend } =
      await import("../../src/storage/backend-preference.ts");
    expect(getBackend()).toBe("browser");
    expect(localStorage.getItem("notes:backend")).toBe("folder");
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBe(
      '{"notes":"on the device"}',
    );
  });
});

describe("the local folder on the website and the desktop app", () => {
  it("is in the build, listed, and greyed out without a directory picker", async () => {
    build(WEB);
    const m = await import("../../src/storage/cloud-configured.ts");
    expect(m.FOLDER_IN_BUILD).toBe(true);
    const radios = await pickerRadios({ folderAvailable: false });
    const folder = radios.find((r) => r.textContent === "Local folder");
    expect(folder?.disabled).toBe(true);
  });

  it("is enabled where the browser can pick a folder", async () => {
    build(WEB);
    const radios = await pickerRadios({ folderAvailable: true });
    const folder = radios.find((r) => r.textContent === "Local folder");
    expect(folder?.disabled).toBe(false);
  });

  it("keeps a stored folder choice", async () => {
    build(WEB);
    localStorage.setItem("notes:backend", "folder");
    const { getBackend } =
      await import("../../src/storage/backend-preference.ts");
    expect(getBackend()).toBe("folder");
  });
});

// What would name another edition, or the web host, on the phone app's
// privacy page.
const ANOTHER_EDITION =
  /website|web page|browser|desktop|PWA|GitHub|static site|localStorage|address bar|local folder|this site/i;

async function privacyText(env: Record<string, string>): Promise<string> {
  build(env);
  const { render } = await import("@testing-library/preact");
  const { PrivacyPage } = await import("../../src/ui/PrivacyPage.tsx");
  const { container } = render(<PrivacyPage />);
  return container.textContent ?? "";
}

describe("the phone app's privacy page", () => {
  it("names no other edition, no web host and no local folder", async () => {
    const text = await privacyText(PHONE);
    expect(text).not.toMatch(ANOTHER_EDITION);
  });

  it("still describes what the phone app does", async () => {
    const text = await privacyText(PHONE);
    expect(text).toMatch(/runs entirely on your device/);
    expect(text).toMatch(/iCloud Drive \(iPhone and iPad\)/);
    expect(text).toMatch(/Nextcloud/);
    expect(text).toMatch(/youtube-nocookie\.com/);
    expect(text).toMatch(/sends no request to any server/);
  });
});

describe("the website's and the desktop app's privacy page", () => {
  it("keeps the web host, the local folder and the other editions", async () => {
    const text = await privacyText(WEB);
    expect(text).toMatch(/The website is served by GitHub Pages/);
    expect(text).toMatch(/Local folder\./);
    expect(text).toMatch(/installed PWA/);
    expect(text).toMatch(
      /The website and the desktop app do not offer this option\./,
    );
  });
});
