// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { PDF_CODE_BACKGROUNDS } from "../../src/domain/pdf.ts";
import {
  DEFAULT_APPEARANCE,
  type Appearance,
} from "../../src/theme/useTheme.ts";
import { ExportSection } from "../../src/ui/settings/ExportSection.tsx";

function renderSection(appearance: Appearance = DEFAULT_APPEARANCE) {
  const onUpdate = vi.fn();
  render(<ExportSection appearance={appearance} onUpdate={onUpdate} />);
  return onUpdate;
}

function withPdf(patch: Partial<Appearance["pdf"]>): Appearance {
  return {
    ...DEFAULT_APPEARANCE,
    pdf: { ...DEFAULT_APPEARANCE.pdf, ...patch },
  };
}

describe("the Export settings tab's content toggles", () => {
  it("turns the title off without disturbing the rest of the settings", () => {
    const onUpdate = renderSection();
    fireEvent.click(screen.getByLabelText("Print the title"));
    expect(onUpdate).toHaveBeenCalledWith("pdf", {
      ...DEFAULT_APPEARANCE.pdf,
      includeTitle: false,
    });
  });

  it("turns page numbers off, taking their format and alignment with them", () => {
    const onUpdate = renderSection();
    // The format and alignment controls only mean anything while there is a
    // number to write, so they follow the toggle rather than sitting greyed.
    expect(screen.queryByText("Number style")).not.toBeNull();
    expect(screen.queryByText("Number position")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Number the pages"));
    expect(onUpdate).toHaveBeenCalledWith("pdf", {
      ...DEFAULT_APPEARANCE.pdf,
      pageNumbers: false,
    });

    cleanup();
    render(
      <ExportSection
        appearance={withPdf({ pageNumbers: false })}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.queryByText("Number style")).toBeNull();
    expect(screen.queryByText("Number position")).toBeNull();
  });
});

describe("the code-background picker's custom swatch", () => {
  // It sits at the end of a row of preset swatches, so it has to read as one
  // of them: same box, and the same selected ring when it is the live choice.
  const presetClass = (): string => {
    const preset = screen.getByTitle(PDF_CODE_BACKGROUNDS[1] as string);
    return preset.className;
  };

  it("wears the same box as the presets beside it", () => {
    renderSection();
    const input = screen.getByLabelText("Custom");
    expect(input.className).toContain("h-7");
    expect(input.className).toContain("w-7");
    expect(presetClass()).toContain("h-7 w-7");
  });

  it("is unselected while a preset is chosen", () => {
    renderSection(
      withPdf({ codeBackground: PDF_CODE_BACKGROUNDS[1] as string }),
    );
    expect(screen.getByLabelText("Custom").className).toContain("border-line");
    expect(screen.getByLabelText("Custom").className).not.toContain(
      "ring-accent",
    );
  });

  it("wears the selected ring once the colour is one no preset offers", () => {
    renderSection(withPdf({ codeBackground: "#ffcc00" }));
    const input = screen.getByLabelText("Custom");
    expect(input.className).toContain("border-accent");
    expect(input.className).toContain("ring-accent/40");
  });

  it("reports the chosen colour up", () => {
    const onUpdate = renderSection();
    const input = screen.getByLabelText("Custom") as HTMLInputElement;
    input.value = "#123456";
    fireEvent.input(input);
    expect(onUpdate).toHaveBeenCalledWith("pdf", {
      ...DEFAULT_APPEARANCE.pdf,
      codeBackground: "#123456",
    });
  });
});
