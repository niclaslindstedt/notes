// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { emptyTransformRule } from "../../src/domain/transform.ts";
import { DEFAULT_APPEARANCE } from "../../src/theme/useTheme.ts";
import { TransformSection } from "../../src/ui/settings/TransformSection.tsx";

const ISSUE_RULE = {
  ...emptyTransformRule("issue"),
  name: "Issue links",
  pattern: "#(\\d+)",
  kind: "link" as const,
  replacement: "https://example.test/issues/$1",
  sample: "fixed #134",
};

function withRules(rules: (typeof ISSUE_RULE)[]) {
  return { ...DEFAULT_APPEARANCE, transforms: rules };
}

describe("TransformSection", () => {
  it("shows the empty state when no rules are configured", () => {
    render(
      <TransformSection appearance={DEFAULT_APPEARANCE} onUpdate={vi.fn()} />,
    );
    expect(screen.getByText("No transforms yet.")).toBeTruthy();
  });

  it("lists a rule by its name, kind and pattern", () => {
    render(
      <TransformSection
        appearance={withRules([ISSUE_RULE])}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("Issue links")).toBeTruthy();
    expect(screen.getByText("Link")).toBeTruthy();
    expect(screen.getByText("#(\\d+)")).toBeTruthy();
  });

  it("falls back to the pattern for an unnamed rule", () => {
    render(
      <TransformSection
        appearance={withRules([{ ...ISSUE_RULE, name: "" }])}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit #(\\d+)" })).toBeTruthy();
  });

  it("parks a rule without deleting it", () => {
    const onUpdate = vi.fn();
    render(
      <TransformSection
        appearance={withRules([ISSUE_RULE])}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Enable Issue links" }),
    );
    expect(onUpdate).toHaveBeenCalledWith("transforms", [
      { ...ISSUE_RULE, enabled: false },
    ]);
  });

  it("deletes a rule", () => {
    const onUpdate = vi.fn();
    render(
      <TransformSection
        appearance={withRules([ISSUE_RULE])}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Issue links" }));
    expect(onUpdate).toHaveBeenCalledWith("transforms", []);
  });

  it("opens the dialog on Add and appends the saved rule", () => {
    const onUpdate = vi.fn();
    render(
      <TransformSection
        appearance={withRules([ISSUE_RULE])}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add transform" }));

    fireEvent.input(screen.getByRole("textbox", { name: "Match" }), {
      target: { value: "TODO" },
    });
    fireEvent.input(screen.getByRole("textbox", { name: "Link address" }), {
      target: { value: "https://example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const [key, value] = onUpdate.mock.calls.at(-1)!;
    expect(key).toBe("transforms");
    expect(value).toHaveLength(2);
    expect(value[1]).toMatchObject({ pattern: "TODO", kind: "link" });
  });

  it("edits an existing rule in place rather than appending it", () => {
    const onUpdate = vi.fn();
    render(
      <TransformSection
        appearance={withRules([ISSUE_RULE])}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Issue links" }));
    fireEvent.input(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Tickets" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onUpdate).toHaveBeenCalledWith("transforms", [
      { ...ISSUE_RULE, name: "Tickets" },
    ]);
  });
});

describe("TransformRuleModal", () => {
  function openBlankDialog() {
    render(
      <TransformSection appearance={DEFAULT_APPEARANCE} onUpdate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add transform" }));
  }

  it("previews the sample through the draft rule", () => {
    openBlankDialog();
    fireEvent.input(screen.getByRole("textbox", { name: "Match" }), {
      target: { value: "#(\\d+)" },
    });
    fireEvent.input(screen.getByRole("textbox", { name: "Link address" }), {
      target: { value: "https://example.test/issues/$1" },
    });
    fireEvent.input(screen.getByRole("textbox", { name: "Sample text" }), {
      target: { value: "fixed #134 today" },
    });

    const output = screen.getByRole("status");
    expect(output.textContent).toBe("fixed #134 today");
    // The matched run renders as a link to the expanded template.
    expect(output.querySelector("[title]")?.getAttribute("title")).toBe(
      "https://example.test/issues/134",
    );
  });

  it("previews a sensitive rule as its mask", () => {
    openBlankDialog();
    fireEvent.input(screen.getByRole("textbox", { name: "Match" }), {
      target: { value: "\\d{10}" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Sensitive" }));
    fireEvent.input(screen.getByRole("textbox", { name: "Sample text" }), {
      target: { value: "call 0761234123" },
    });

    expect(screen.getByRole("status").textContent).toBe("call 076****123");
  });

  it("reports a broken pattern and refuses to save it", () => {
    openBlankDialog();
    fireEvent.input(screen.getByRole("textbox", { name: "Match" }), {
      target: { value: "(unclosed" },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Not a valid regular expression",
    );
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("requires a destination for a link rule but not for a mask", () => {
    openBlankDialog();
    fireEvent.input(screen.getByRole("textbox", { name: "Match" }), {
      target: { value: "\\d+" },
    });
    // Link is the default kind, and it has nowhere to point yet.
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Sensitive" }));
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("offers the mask styles only for a sensitive rule", () => {
    openBlankDialog();
    expect(screen.queryByRole("combobox", { name: "Mask" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Sensitive" }));
    // Defaults to the mask that keeps a phone number recognisable.
    expect(
      screen.getByRole("combobox", { name: "Mask" }).textContent,
    ).toContain("Keep both ends");
  });
});
