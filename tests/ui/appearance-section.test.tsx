// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppearanceSection } from "../../src/ui/settings/AppearanceSection.tsx";
import { DEFAULT_APPEARANCE } from "../../src/theme/useTheme.ts";

describe("AppearanceSection", () => {
  it("renders the family modes and the active family's variants", () => {
    render(
      <AppearanceSection appearance={DEFAULT_APPEARANCE} onUpdate={vi.fn()} />,
    );
    // Mode row.
    expect(screen.getByRole("radio", { name: "Dark" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "System" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Custom" })).toBeTruthy();
    // Variant row for the default Dark family.
    expect(screen.getByRole("radio", { name: "One Dark" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Dracula" })).toBeTruthy();
  });

  it("commits a family switch through onUpdate", () => {
    const onUpdate = vi.fn();
    render(
      <AppearanceSection appearance={DEFAULT_APPEARANCE} onUpdate={onUpdate} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(onUpdate).toHaveBeenCalledWith("theme", "light");
  });

  it("seeds the custom theme before switching into Custom", () => {
    const onUpdate = vi.fn();
    render(
      <AppearanceSection appearance={DEFAULT_APPEARANCE} onUpdate={onUpdate} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    // Seeds customTheme first, then flips the preset to custom.
    expect(onUpdate).toHaveBeenCalledWith("customTheme", expect.any(Object));
    expect(onUpdate).toHaveBeenCalledWith("theme", "custom");
  });

  it("hides the colour editor unless Custom is active", () => {
    const { rerender } = render(
      <AppearanceSection appearance={DEFAULT_APPEARANCE} onUpdate={vi.fn()} />,
    );
    expect(screen.queryByText("Backgrounds")).toBeNull();
    rerender(
      <AppearanceSection
        appearance={{ ...DEFAULT_APPEARANCE, theme: "custom" }}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("Backgrounds")).toBeTruthy();
    expect(screen.getByText("Reduce motion")).toBeTruthy();
  });
});
