// The full-screen note editor, the native stand-in for the web `Editor`
// (src/app/App.tsx). A pinned header with Back and Delete sits above a single
// full-height multiline input bound to the note's body; every keystroke calls
// the shared `update` verb, which coalesces a run of edits into one undo step
// (the `edit:<id>` merge key in use-notes.ts).
//
// The web app renders a live Markdown preview while typing (MarkdownEditor);
// that view is DOM/CSS-bound, so the native editor starts as a plain text
// field — the same fallback the web app drops to when "render Markdown" is
// off. A native Markdown preview can grow here later without touching the
// shared core.

import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useT } from "../../../src/i18n/index.ts";
import type { Note } from "../../../src/domain/note.ts";
import { glyphs } from "../strings.ts";
import { spacing, useTokens } from "../theme.ts";

export function NoteEditor({
  note,
  onChange,
  onClose,
  onDelete,
}: {
  note: Note;
  onChange: (body: string) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const tokens = useTokens();
  const t = useT();
  // Hold the body locally so the field stays responsive; the shared `update`
  // verb is called alongside every change so persistence and undo see it too.
  const [value, setValue] = useState(note.body);
  const inputRef = useRef<TextInput>(null);

  const change = (text: string) => {
    setValue(text);
    onChange(text);
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { borderColor: tokens.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("native.back")}
          hitSlop={8}
          onPress={onClose}
        >
          <Text style={[styles.back, { color: tokens.accent }]}>
            {glyphs.back} {t("native.back")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("native.deleteNote")}
          hitSlop={8}
          onPress={onDelete}
        >
          <Text style={[styles.delete, { color: tokens.danger }]}>
            {t("native.delete")}
          </Text>
        </Pressable>
      </View>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={change}
        multiline
        autoFocus
        textAlignVertical="top"
        placeholder={t("native.placeholder")}
        placeholderTextColor={tokens.textMuted}
        style={[styles.input, { color: tokens.text }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    fontSize: 16,
    fontWeight: "600",
  },
  delete: {
    fontSize: 15,
    fontWeight: "600",
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
});
