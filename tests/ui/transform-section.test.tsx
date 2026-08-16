// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/preact";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { emptyTransformRule } from "../../src/domain/transform.ts";
import type { Namespace } from "../../src/storage/namespaces.ts";
import {
  DEFAULT_APPEARANCE,
  type Appearance,
} from "../../src/theme/useTheme.ts";
import { TransformSection } from "../../src/ui/settings/TransformSection.tsx";

// The pattern field reveals itself on focus (`scrollFocusedIntoView`), and the
// regex helper focuses it to place the caret. jsdom has no layout and no
// `scrollIntoView`, so stub it for the file rather than let the reveal throw
// out of an event handler.
const realScrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  HTMLElement.prototype.scrollIntoView = realScrollIntoView;
});

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

// One namespace is the quiet case the scope UI stays out of; the tests that
// care about scoping pass `NAMESPACES` instead.
const SOLO: Namespace[] = [{ slug: "default", name: "Default" }];
const NAMESPACES: Namespace[] = [
  { slug: "default", name: "Default" },
  { slug: "work", name: "Work" },
];

function renderSection(
  appearance: Appearance,
  onUpdate: <K extends keyof Appearance>(key: K, value: Appearance[K]) => void,
  namespaces: Namespace[] = SOLO,
  activeNamespace = "default",
) {
  return render(
    <TransformSection
      appearance={appearance}
      onUpdate={onUpdate}
      namespaces={namespaces}
      activeNamespace={activeNamespace}
    />,
  );
}

describe("TransformSection", () => {
  it("shows the empty state when no rules are configured", () => {
    renderSection(DEFAULT_APPEARANCE, vi.fn());
    expect(screen.getByText("No transforms yet.")).toBeTruthy();
  });

  it("lists a rule by its name, kind and pattern", () => {
    renderSection(withRules([ISSUE_RULE]), vi.fn());
    expect(screen.getByText("Issue links")).toBeTruthy();
    expect(screen.getByText("Link")).toBeTruthy();
    expect(screen.getByText("#(\\d+)")).toBeTruthy();
  });

  it("falls back to the pattern for an unnamed rule", () => {
    renderSection(withRules([{ ...ISSUE_RULE, name: "" }]), vi.fn());
    expect(screen.getByRole("button", { name: "Edit #(\\d+)" })).toBeTruthy();
  });

  it("parks a rule without deleting it", () => {
    const onUpdate = vi.fn();
    renderSection(withRules([ISSUE_RULE]), onUpdate);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Enable Issue links" }),
    );
    expect(onUpdate).toHaveBeenCalledWith("transforms", [
      { ...ISSUE_RULE, enabled: false },
    ]);
  });

  it("deletes a rule", () => {
    const onUpdate = vi.fn();
    renderSection(withRules([ISSUE_RULE]), onUpdate);
    fireEvent.click(screen.getByRole("button", { name: "Delete Issue links" }));
    expect(onUpdate).toHaveBeenCalledWith("transforms", []);
  });

  it("opens the dialog on Add and appends the saved rule", () => {
    const onUpdate = vi.fn();
    renderSection(withRules([ISSUE_RULE]), onUpdate);
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
    renderSection(withRules([ISSUE_RULE]), onUpdate);
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

describe("namespace scoping", () => {
  const WORK_RULE = {
    ...ISSUE_RULE,
    id: "work",
    name: "Work links",
    namespace: "work",
  };

  it("says nothing about scope while the device has one namespace", () => {
    renderSection(withRules([ISSUE_RULE]), vi.fn());
    expect(screen.queryByText("All namespaces")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add transform" }));
    expect(screen.queryByRole("combobox", { name: "Applies to" })).toBeNull();
  });

  it("names the namespace each rule runs in", () => {
    renderSection(withRules([ISSUE_RULE, WORK_RULE]), vi.fn(), NAMESPACES);
    // The rule with no scope is global; the other wears its namespace's name.
    expect(screen.getByText("All namespaces")).toBeTruthy();
    expect(screen.getByText("Work")).toBeTruthy();
  });

  it("still lists the rules of the namespaces you aren't in", () => {
    renderSection(withRules([WORK_RULE]), vi.fn(), NAMESPACES, "default");
    expect(screen.getByText("Work links")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit Work links" }),
    ).toBeTruthy();
  });

  it("starts a new rule in the namespace you're in", () => {
    const onUpdate = vi.fn();
    renderSection(DEFAULT_APPEARANCE, onUpdate, NAMESPACES, "work");
    fireEvent.click(screen.getByRole("button", { name: "Add transform" }));
    expect(
      screen.getByRole("combobox", { name: "Applies to" }).textContent,
    ).toContain("Work");

    fireEvent.input(screen.getByRole("textbox", { name: "Match" }), {
      target: { value: "#(\\d+)" },
    });
    fireEvent.input(screen.getByRole("textbox", { name: "Link address" }), {
      target: { value: "https://example.test/issues/$1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const [, value] = onUpdate.mock.calls.at(-1)!;
    expect(value[0]).toMatchObject({ namespace: "work" });
  });

  it("widens a rule back to every namespace", () => {
    const onUpdate = vi.fn();
    renderSection(withRules([WORK_RULE]), onUpdate, NAMESPACES, "work");
    fireEvent.click(screen.getByRole("button", { name: "Edit Work links" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Applies to" }));
    fireEvent.click(screen.getByRole("option", { name: "All namespaces" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onUpdate).toHaveBeenCalledWith("transforms", [
      { ...WORK_RULE, namespace: null },
    ]);
  });
});

describe("TransformRuleModal", () => {
  function openBlankDialog() {
    renderSection(DEFAULT_APPEARANCE, vi.fn());
    fireEvent.click(screen.getByRole("button", { name: "Add transform" }));
  }

  it("titles itself for the button that opened it", () => {
    renderSection(withRules([ISSUE_RULE]), vi.fn());

    fireEvent.click(screen.getByRole("button", { name: "Add transform" }));
    expect(screen.getByRole("heading", { name: "Add transform" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit Issue links" }));
    expect(
      screen.getByRole("heading", { name: "Edit transform" }),
    ).toBeTruthy();
  });

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

  // The ignore-case Checkbox hides its real `<input>` with `sr-only`, which is
  // `position: absolute`. Unless the scrolling body establishes a containing
  // block, that input resolves against the Modal card instead, escaping this
  // panel's clip — it inflates the card's own scroll height, and focusing it
  // scrolls the card, which is `overflow: hidden` and never scrolls back, so
  // the dialog goes blank. jsdom has no layout, so what's pinned here is the
  // class that prevents it.
  it("contains the visually-hidden input its checkbox focuses", () => {
    openBlankDialog();
    const body = screen
      .getByRole("checkbox", { name: "Ignore case" })
      .closest("div.overflow-y-auto");
    expect(body).not.toBeNull();
    expect(body?.className).toContain("relative");
  });
});

describe("the regex helper", () => {
  function openBlankDialog() {
    renderSection(DEFAULT_APPEARANCE, vi.fn());
    fireEvent.click(screen.getByRole("button", { name: "Add transform" }));
  }

  function patternField() {
    return screen.getByRole("textbox", {
      name: "Match",
    }) as HTMLInputElement;
  }

  it("is collapsed until the toggle is pressed", () => {
    openBlankDialog();
    const toggle = screen.getByRole("button", { name: /regex reference/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Any digit, 0 to 9")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Any digit, 0 to 9")).toBeTruthy();
    // Each entry shows the snippet beside what it does.
    expect(
      screen.getByRole("menuitem", { name: /^\\d Any digit/ }),
    ).toBeTruthy();
  });

  it("opens the app's dropdown rather than a control of its own", () => {
    openBlankDialog();
    const toggle = screen.getByRole("button", { name: /regex reference/i });
    expect(toggle.getAttribute("aria-haspopup")).toBe("menu");

    fireEvent.click(toggle);
    // The panel is portalled out of the dialog body, so the rows live in a
    // menu of their own rather than in flow under the field.
    const menu = screen.getByRole("menu", { name: /regex reference/i });
    expect(menu.contains(toggle)).toBe(false);
    expect(toggle.getAttribute("aria-controls")).toBe(menu.id);
  });

  it("types a token into the pattern at the caret", () => {
    openBlankDialog();
    fireEvent.click(screen.getByRole("button", { name: /regex reference/i }));

    const field = patternField();
    fireEvent.input(field, { target: { value: "#" } });
    field.setSelectionRange(1, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /^\\d Any digit/ }));

    expect(patternField().value).toBe("#\\d");
  });

  it("wraps the selected part of the pattern in a capture group", () => {
    openBlankDialog();
    fireEvent.click(screen.getByRole("button", { name: /regex reference/i }));

    const field = patternField();
    fireEvent.input(field, { target: { value: "#\\d+" } });
    field.setSelectionRange(1, 4);
    fireEvent.click(screen.getByRole("menuitem", { name: /^\(…\) Capture/ }));

    expect(patternField().value).toBe("#(\\d+)");
  });

  it("stays open so several tokens can be typed in a row", () => {
    openBlankDialog();
    fireEvent.click(screen.getByRole("button", { name: /regex reference/i }));

    const digit = screen.getByRole("menuitem", { name: /^\\d Any digit/ });
    fireEvent.click(digit);
    fireEvent.click(screen.getByRole("menuitem", { name: /^\+ One or more/ }));

    expect(patternField().value).toBe("\\d+");
    expect(
      screen
        .getByRole("button", { name: /regex reference/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
