// One row in the note list, mirroring the web `NoteCard` (src/app/App.tsx):
// the note's title (its first non-empty line) over a one-line preview of the
// rest of the body. Tapping it opens the note in the editor. Title and
// preview come straight from the shared pure helpers so the two surfaces
// derive them identically.

import { memo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { noteTitle, notePreview, type Note } from "../../../src/domain/note.ts";
import { radius, spacing, useTokens } from "../theme.ts";

function NoteCardImpl({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const tokens = useTokens();
  const preview = notePreview(note);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={[
        styles.card,
        { backgroundColor: tokens.surface, borderColor: tokens.border },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.title, { color: tokens.textBright }]}
      >
        {noteTitle(note)}
      </Text>
      {preview ? (
        <Text
          numberOfLines={1}
          style={[styles.preview, { color: tokens.textMuted }]}
        >
          {preview}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 16,
    fontWeight: "500",
  },
  preview: {
    marginTop: 2,
    fontSize: 14,
  },
});

// Memoised so editing one note doesn't reconcile the whole list — the shared
// edit verbs keep stable note identities precisely so this works.
export const NoteCard = memo(NoteCardImpl);
