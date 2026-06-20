import {
  COPY_SCOPES,
  DEFAULT_TITLE_SCHEMES,
  type CopyScope,
  type DefaultTitleScheme,
} from "../../domain/note.ts";
import { useT } from "../../i18n/index.ts";
import {
  EDITOR_MARGINS,
  type EditorMargin,
  type EditorSettings,
} from "../../theme/themes.ts";
import type { Appearance } from "../../theme/useTheme.ts";
import { SelectPicker } from "../form/SelectPicker.tsx";
import { Field, Section, SegmentedRow, ToggleRow } from "./shared.tsx";

type UpdateAppearance = <K extends keyof Appearance>(
  key: K,
  value: Appearance[K],
) => void;

// The Editor settings tab: how the note-writing surface lays out (margins,
// word wrap) and whether it renders Markdown live as you type. Split into
// focused bordered sections (mirroring the General tab) so the controls group
// by what they affect — new notes, the writing column, Markdown rendering,
// typing aids, and copying. Each control applies immediately through the
// appearance store, like the other tabs.
export function EditorSection({
  appearance,
  onUpdate,
}: {
  appearance: Appearance;
  onUpdate: UpdateAppearance;
}) {
  const t = useT();
  const editor = appearance.editor;

  function update<K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K],
  ): void {
    onUpdate("editor", { ...editor, [key]: value });
  }

  const titleSchemeLabel: Record<DefaultTitleScheme, string> = {
    none: t("settings.editor.defaultTitleOff"),
    dateTime: t("settings.editor.defaultTitleDateTime"),
    numbered: t("settings.editor.defaultTitleNumbered"),
  };

  const copyScopeLabel: Record<CopyScope, string> = {
    body: t("settings.editor.copyBody"),
    titleBody: t("settings.editor.copyTitleBody"),
    frontMatter: t("settings.editor.copyFrontMatter"),
  };

  return (
    <>
      <Section title={t("settings.editor.newNotesTitle")}>
        <Field label={t("settings.editor.defaultTitle")}>
          <SegmentedRow<DefaultTitleScheme>
            ariaLabel={t("settings.editor.defaultTitle")}
            value={editor.defaultTitle}
            options={DEFAULT_TITLE_SCHEMES.map((s) => ({
              value: s,
              label: titleSchemeLabel[s],
            }))}
            onChange={(v) => update("defaultTitle", v)}
          />
          <p className="text-xs text-muted">
            {t("settings.editor.defaultTitleHint")}
          </p>
        </Field>
      </Section>

      <Section title={t("settings.editor.layoutTitle")}>
        <Field label={t("settings.editor.margins")}>
          <SegmentedRow<EditorMargin>
            ariaLabel={t("settings.editor.margins")}
            value={editor.margin}
            options={EDITOR_MARGINS.map((m) => ({
              value: m.id,
              label: m.label,
            }))}
            onChange={(v) => update("margin", v)}
          />
          <p className="text-xs text-muted">
            {t("settings.editor.marginsHint")}
          </p>
        </Field>
        <ToggleRow
          label={t("settings.editor.wordWrap")}
          hint={t("settings.editor.wordWrapHint")}
          checked={editor.wordWrap}
          onChange={(v) => update("wordWrap", v)}
        />
      </Section>

      <Section title={t("settings.editor.markdownTitle")}>
        <ToggleRow
          label={t("settings.editor.renderMarkdown")}
          hint={t("settings.editor.renderMarkdownHint")}
          checked={editor.renderMarkdown}
          onChange={(v) => update("renderMarkdown", v)}
        />
      </Section>

      <Section title={t("settings.editor.attachmentsTitle")}>
        <ToggleRow
          label={t("settings.editor.imagesAtEnd")}
          hint={t("settings.editor.imagesAtEndHint")}
          checked={editor.imagesAtEnd}
          onChange={(v) => update("imagesAtEnd", v)}
        />
        <ToggleRow
          label={t("settings.editor.filesAtEnd")}
          hint={t("settings.editor.filesAtEndHint")}
          checked={editor.filesAtEnd}
          onChange={(v) => update("filesAtEnd", v)}
        />
      </Section>

      <Section title={t("settings.editor.typingTitle")}>
        <ToggleRow
          label={t("settings.editor.disableSpellcheck")}
          hint={t("settings.editor.disableSpellcheckHint")}
          checked={editor.disableSpellcheck}
          onChange={(v) => update("disableSpellcheck", v)}
        />
        <ToggleRow
          label={t("settings.editor.disableAutocorrect")}
          hint={t("settings.editor.disableAutocorrectHint")}
          checked={editor.disableAutocorrect}
          onChange={(v) => update("disableAutocorrect", v)}
        />
      </Section>

      <Section title={t("settings.editor.formattingTitle")}>
        <ToggleRow
          label={t("settings.editor.trimTrailingSpaces")}
          hint={t("settings.editor.trimTrailingSpacesHint")}
          checked={editor.trimTrailingSpaces}
          onChange={(v) => update("trimTrailingSpaces", v)}
        />
        <ToggleRow
          label={t("settings.editor.trailingNewline")}
          hint={t("settings.editor.trailingNewlineHint")}
          checked={editor.trailingNewline}
          onChange={(v) => update("trailingNewline", v)}
        />
      </Section>

      <Section title={t("settings.editor.copyTitle")}>
        <Field label={t("settings.editor.copyScope")}>
          <SelectPicker<CopyScope>
            value={editor.copyScope}
            options={COPY_SCOPES.map((s) => ({
              value: s,
              label: copyScopeLabel[s],
            }))}
            onChange={(v) => update("copyScope", v)}
            ariaLabel={t("settings.editor.copyScope")}
          />
          <p className="text-xs text-muted">
            {t("settings.editor.copyScopeHint")}
          </p>
        </Field>
      </Section>
    </>
  );
}
