// @vitest-environment jsdom
// No build of notes says "no account", in any language (the owner's
// decision): the copy says what is true instead — nothing to sign up for, no
// sign-in. The privacy page is rendered as the phone app's build and as the
// website's, the website's home page as itself, and every locale's strings are
// read as text.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const NO_ACCOUNT =
  /no account|inget? (?:något )?konto|utan (?:något )?konto|no accounts/i;

const PHONE = { VITE_TARGET: "native" };
const WEB = { VITE_TARGET: "" };

function build(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

async function text(page: "PrivacyPage" | "HomePage"): Promise<string> {
  const { render } = await import("@testing-library/preact");
  const Page =
    page === "PrivacyPage"
      ? (await import("../../src/ui/PrivacyPage.tsx")).PrivacyPage
      : (await import("../../src/ui/HomePage.tsx")).HomePage;
  const { container } = render(<Page />);
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

describe("the sign-up wording", () => {
  it("is nothing to sign up for on the phone app's privacy page", async () => {
    build(PHONE);
    const copy = await text("PrivacyPage");
    expect(copy).not.toMatch(NO_ACCOUNT);
    expect(copy).toMatch(/nothing to sign up for/);
  });

  it("is nothing to sign up for on the website's privacy and home pages", async () => {
    build(WEB);
    const privacy = await text("PrivacyPage");
    expect(privacy).not.toMatch(NO_ACCOUNT);
    expect(privacy).toMatch(/nothing to sign up for/);
    document.body.innerHTML = "";
    const home = await text("HomePage");
    expect(home).not.toMatch(NO_ACCOUNT);
    expect(home).toMatch(/nothing to sign up for/);
  });

  it("appears in no locale", () => {
    const root = join("src", "i18n", "locales");
    for (const lang of readdirSync(root)) {
      for (const file of readdirSync(join(root, lang))) {
        const source = readFileSync(join(root, lang, file), "utf8");
        expect(source, `${lang}/${file}`).not.toMatch(NO_ACCOUNT);
      }
    }
  });
});
