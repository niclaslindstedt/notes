import { describe, expect, it } from "vitest";

// The whole point of the Preact swap is the bytes it saves, and the only thing
// standing between that and a silent regression is one alias table. Every
// `import … from "react"` in `src/` — and inside the framework package — is
// supposed to resolve to `preact/compat` (see the aliases in `vite.config.ts`
// and the mirrored `paths` in `tsconfig.json`). If that mapping is ever
// dropped the app keeps building and every other test keeps passing; it just
// quietly ships React again, twice the size. This is what notices.
describe("the react → preact/compat alias", () => {
  it("resolves bare `react` to preact/compat", async () => {
    const [react, compat] = await Promise.all([
      import("react"),
      import("preact/compat"),
    ]);
    expect(react.default).toBe(compat.default);
    expect(react.useState).toBe(compat.useState);
  });

  it("resolves `react-dom` and its `client` entry to preact/compat", async () => {
    const [reactDom, reactDomClient, compat] = await Promise.all([
      import("react-dom"),
      import("react-dom/client"),
      import("preact/compat"),
    ]);
    expect(reactDom.default).toBe(compat.default);
    expect(reactDom.createPortal).toBe(compat.createPortal);
    expect(typeof reactDomClient.createRoot).toBe("function");
  });

  it("builds Preact vnodes from the `react` entry", async () => {
    const [{ createElement }, preact] = await Promise.all([
      import("react"),
      import("preact"),
    ]);
    // `isValidElement` is Preact's own vnode check — a React element fails it.
    expect(preact.isValidElement(createElement("div", null))).toBe(true);
  });
});
