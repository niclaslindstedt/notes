// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  SelectPicker,
  type SelectOption,
} from "../../src/ui/form/SelectPicker.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const OPTIONS: SelectOption<string>[] = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
  { value: "c", label: "Cherry" },
];

describe("SelectPicker", () => {
  it("renders a combobox trigger showing the selected option's label", () => {
    render(
      <SelectPicker
        value="b"
        options={OPTIONS}
        onChange={() => {}}
        ariaLabel="Fruit"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Fruit" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("Banana");
  });

  it("opens a listbox of options on click and commits a selection", () => {
    const onChange = vi.fn();
    render(
      <SelectPicker
        value="a"
        options={OPTIONS}
        onChange={onChange}
        ariaLabel="Fruit"
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Fruit" }));

    expect(screen.getByRole("listbox")).toBeTruthy();
    const optionEls = screen.getAllByRole("option");
    expect(optionEls.map((o) => o.textContent)).toEqual([
      "Apple",
      "Banana",
      "Cherry",
    ]);
    // The current value is marked selected.
    expect(optionEls[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("option", { name: "Cherry" }));
    expect(onChange).toHaveBeenCalledWith("c");
    // The listbox closes after a commit.
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not commit a disabled option", () => {
    const onChange = vi.fn();
    render(
      <SelectPicker
        value="a"
        options={[
          { value: "a", label: "Apple" },
          { value: "b", label: "Banana", disabled: true },
        ]}
        onChange={onChange}
        ariaLabel="Fruit"
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Fruit" }));
    fireEvent.click(screen.getByRole("option", { name: "Banana" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits the highlighted option via the keyboard", () => {
    const onChange = vi.fn();
    render(
      <SelectPicker
        value="a"
        options={OPTIONS}
        onChange={onChange}
        ariaLabel="Fruit"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Fruit" });
    // ArrowDown on the trigger opens the panel (highlight seeded to the
    // selected option), then ArrowDown on the listbox advances it.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
