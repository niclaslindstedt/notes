// The pinned header on the note-list screen: the app wordmark and a button
// that opens the menu sheet (the native stand-in for the web side menu).
// The web list header (src/app/App.tsx) carries the same wordmark plus the
// trophy / sync affordances, which are web-only surfaces for now.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { glyphs, strings } from "../strings.ts";
import { radius, spacing, useTokens } from "../theme.ts";

export function Header({
  count,
  onOpenMenu,
}: {
  count: number;
  onOpenMenu: () => void;
}) {
  const tokens = useTokens();

  return (
    <View style={[styles.header, { borderColor: tokens.border }]}>
      <View style={styles.titleWrap}>
        <Text style={[styles.title, { color: tokens.textBright }]}>
          {strings.app.title}
        </Text>
        {count > 0 ? (
          <Text style={[styles.count, { color: tokens.textMuted }]}>
            {count}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.app.openMenu}
        hitSlop={8}
        onPress={onOpenMenu}
        style={[styles.menuButton, { backgroundColor: tokens.surfaceAlt }]}
      >
        <Text style={[styles.menuGlyph, { color: tokens.text }]}>
          {glyphs.menu}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  count: {
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  menuGlyph: {
    fontSize: 20,
    lineHeight: 22,
  },
});
