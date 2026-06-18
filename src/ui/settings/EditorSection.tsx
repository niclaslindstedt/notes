import {
  EDITOR_MARGINS,
  type EditorMargin,
  type EditorSettings,
} from "../../theme/themes.ts";
import type { Appearance } from "../../theme/useTheme.ts";
import { Field, Section, SegmentedRow, ToggleRow } from "./shared.tsx";

type UpdateAppearance = <K extends keyof Appearance>(
  key: K,
  value: Appearance[K],
) => void;

// The Editor settings tab: how the note-writing surface lays out (margins,
// word wrap) and whether it renders Markdown live as you type. Each control
// applies immediately through the appearance store, like the other tabs.
export function EditorSection({
  appearance,
  onUpdate,
}: {
  appearance: Appearance;
  onUpdate: UpdateAppearance;
}) {
  const editor = appearance.editor;

  function update<K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K],
  ): void {
    onUpdate("editor", { ...editor, [key]: value });
  }

  return (
    <Section title="Editor">
      <Field label="Margins">
        <SegmentedRow<EditorMargin>
          ariaLabel="Margins"
          value={editor.margin}
          options={EDITOR_MARGINS.map((m) => ({ value: m.id, label: m.label }))}
          onChange={(v) => update("margin", v)}
        />
        <p className="text-xs text-muted">
          How much breathing room to leave around the writing column.
        </p>
      </Field>
      <ToggleRow
        label="Word wrap"
        hint="Wrap long lines instead of scrolling sideways."
        checked={editor.wordWrap}
        onChange={(v) => update("wordWrap", v)}
      />
      <ToggleRow
        label="Render Markdown"
        hint="Format Markdown as you type — every line but the one you're on shows formatted, like Obsidian."
        checked={editor.renderMarkdown}
        onChange={(v) => update("renderMarkdown", v)}
      />
    </Section>
  );
}
