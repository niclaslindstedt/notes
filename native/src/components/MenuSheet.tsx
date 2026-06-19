// The native stand-in for the web side menu (src/ui/SideMenu.tsx): a slide-up
// sheet holding the global actions that live outside the note list — Undo /
// Redo (the web "Edit" section) and, on iOS, the storage-backend picker
// (the web "Settings → Storage" choice). It is driven entirely by the shared
// `useNotes` surface and the native backend registry passed down from App.
//
// The web side menu also lists the document's notes and the namespace
// switcher; on native the notes are the main screen, and namespaces collapse
// to the single default bucket (the shared registry has no synchronous home
// on React Native, so it falls back to default-only) — so neither needs a row
// here.

import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { BackendOption, NativeBackendId } from "../storage/backends.ts";
import { glyphs, strings } from "../strings.ts";
import { radius, spacing, useTokens } from "../theme.ts";

export function MenuSheet({
  visible,
  onClose,
  backends,
  activeBackendId,
  onSelectBackend,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  visible: boolean;
  onClose: () => void;
  /** Storage backends offered on this device (>1 only on iOS, with iCloud). */
  backends: BackendOption[];
  activeBackendId: NativeBackendId;
  onSelectBackend: (id: NativeBackendId) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const tokens = useTokens();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: tokens.surface, borderColor: tokens.border },
        ]}
      >
        <View style={styles.sheetHeader}>
          <Text style={[styles.heading, { color: tokens.textBright }]}>
            {strings.menu.heading}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.menu.close}
            hitSlop={8}
            onPress={onClose}
          >
            <Text style={[styles.close, { color: tokens.textMuted }]}>
              {glyphs.close}
            </Text>
          </Pressable>
        </View>

        <ScrollView>
          <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>
            {strings.menu.edit}
          </Text>
          <View style={styles.undoRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.menu.undo}
              disabled={!canUndo}
              onPress={onUndo}
              style={styles.undoButton}
            >
              <Text
                style={[
                  styles.action,
                  { color: canUndo ? tokens.text : tokens.textMuted },
                ]}
              >
                {glyphs.undo} {strings.menu.undo}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.menu.redo}
              disabled={!canRedo}
              onPress={onRedo}
              style={styles.undoButton}
            >
              <Text
                style={[
                  styles.action,
                  { color: canRedo ? tokens.text : tokens.textMuted },
                ]}
              >
                {glyphs.redo} {strings.menu.redo}
              </Text>
            </Pressable>
          </View>

          {backends.length > 1 ? (
            <>
              <View
                style={[styles.divider, { backgroundColor: tokens.border }]}
              />
              <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>
                {strings.menu.storage}
              </Text>
              {backends.map((b) => {
                const isActive = b.id === activeBackendId;
                return (
                  <Pressable
                    key={b.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isActive }}
                    style={styles.backendRow}
                    onPress={() => onSelectBackend(b.id)}
                  >
                    <Text
                      style={[
                        styles.radio,
                        { color: isActive ? tokens.accent : tokens.textMuted },
                      ]}
                    >
                      {isActive ? glyphs.radioOn : glyphs.radioOff}
                    </Text>
                    <Text
                      style={[
                        styles.backendLabel,
                        {
                          color: isActive ? tokens.accent : tokens.text,
                          fontWeight: isActive ? "700" : "500",
                        },
                      ]}
                    >
                      {b.label}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "75%",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.lg,
  },
  heading: {
    fontSize: 18,
    fontWeight: "700",
  },
  close: {
    fontSize: 18,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  undoRow: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingVertical: spacing.md,
  },
  undoButton: {
    paddingVertical: spacing.xs,
  },
  action: {
    fontSize: 16,
    fontWeight: "600",
  },
  backendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  radio: {
    fontSize: 16,
    width: 20,
  },
  backendLabel: {
    flexShrink: 1,
    fontSize: 16,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.sm,
  },
});
