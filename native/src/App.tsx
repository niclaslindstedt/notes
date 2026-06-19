// Root of the React Native app. It is deliberately thin: all of the state,
// persistence, undo/redo and domain logic come from the shared `useNotes`
// hook under ../../src/app — the very same code the web PWA runs. This file
// only wires that surface to native views and owns the small bits of
// screen-local UI state (which note is open, the menu sheet, the active
// backend), mirroring the web shell in src/app/App.tsx.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useNotes } from "../../src/app/use-notes.ts";
import { isBlank } from "../../src/domain/note.ts";
import {
  LanguageProvider as SharedLanguageProvider,
  ensureCatalog,
  useT,
  type Lang,
} from "../../src/i18n/index.ts";

// The shared i18n layer is typed against the web app's `@types/react`, while
// this Expo project pins its own (older) copy — so the two `ReactNode`
// definitions don't line up and `SharedLanguageProvider` reads as an invalid
// JSX component here. It's the same component at runtime; re-type it against
// this project's React so it renders cleanly (cf. the `crypto.randomUUID`
// runtime shim in `polyfills.ts`).
const LanguageProvider = SharedLanguageProvider as (props: {
  value: Lang;
  children: ReactNode;
}) => ReactNode;

import { Header } from "./components/Header.tsx";
import { MenuSheet } from "./components/MenuSheet.tsx";
import { NoteCard } from "./components/NoteCard.tsx";
import { NoteEditor } from "./components/NoteEditor.tsx";
import {
  availableBackends,
  backendById,
  type NativeBackendId,
} from "./storage/backends.ts";
import {
  loadBackendPreference,
  saveBackendPreference,
} from "./storage/backendPreference.ts";
import {
  loadLanguagePreference,
  saveLanguagePreference,
} from "./i18n/language.ts";
import { glyphs } from "./strings.ts";
import { spacing, useTokens } from "./theme.ts";

function AppInner({
  lang,
  onSelectLanguage,
}: {
  lang: Lang;
  onSelectLanguage: (lang: Lang) => void;
}) {
  const tokens = useTokens();
  const t = useT();

  // Which storage backend is active. Starts on the on-device default and is
  // reconciled with the persisted choice once it loads from AsyncStorage.
  // The set of options is platform-gated: `availableBackends()` only includes
  // iCloud on iOS, so the picker below is empty everywhere else.
  const backends = useMemo(() => availableBackends(), []);
  const [backendId, setBackendId] = useState<NativeBackendId>("browser");

  useEffect(() => {
    let cancelled = false;
    void loadBackendPreference().then((id) => {
      if (!cancelled) setBackendId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectBackend = useCallback((id: NativeBackendId) => {
    setBackendId(id);
    void saveBackendPreference(id);
  }, []);

  // The active backend instance. Rebuilt when the choice changes so the sync
  // engine — which reloads on adapter identity change — picks up the new
  // backend's document.
  const adapter = useMemo(() => backendById(backendId).create(), [backendId]);

  const store = useNotes(adapter);

  // Live cross-device sync: backends that push remote changes (iCloud, via
  // its `watch` capability) wake the app so another device's edit appears
  // without a manual refresh. Backends without `watch` (the on-device one)
  // skip this entirely.
  const reload = store.sync.reload;
  useEffect(() => {
    if (!adapter.watch) return;
    return adapter.watch(() => {
      void reload();
    });
  }, [adapter, reload]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const editing = editingId
    ? (store.allNotes.find((n) => n.id === editingId) ?? null)
    : null;

  // Switch what's open in the editor, dropping the note we're leaving if it
  // was never typed into so abandoned "new note" taps don't pile up — the
  // same rule the web shell applies.
  const switchTo = (id: string | null) => {
    if (editing && isBlank(editing) && editing.id !== id) {
      store.remove(editing.id);
    }
    setEditingId(id);
  };

  const openNew = () => {
    if (editing && isBlank(editing)) store.remove(editing.id);
    setEditingId(store.create());
  };

  const removeNote = (id: string) => {
    store.remove(id);
    if (id === editingId) setEditingId(null);
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tokens.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {editing ? (
          <NoteEditor
            key={editing.id}
            note={editing}
            onChange={(body) => store.update(editing.id, body)}
            onClose={() => switchTo(null)}
            onDelete={() => removeNote(editing.id)}
          />
        ) : (
          <>
            <Header
              count={store.notes.length}
              onOpenMenu={() => setMenuOpen(true)}
            />
            <FlatList
              data={store.notes}
              keyExtractor={(note) => note.id}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <NoteCard note={item} onOpen={() => switchTo(item.id)} />
              )}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: tokens.textMuted }]}>
                  {t("native.empty")}
                </Text>
              }
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("native.newNote")}
              onPress={openNew}
              style={[styles.fab, { backgroundColor: tokens.accent }]}
            >
              <Text style={[styles.fabGlyph, { color: tokens.accentText }]}>
                {glyphs.add}
              </Text>
            </Pressable>
          </>
        )}
      </KeyboardAvoidingView>

      <MenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        backends={backends}
        activeBackendId={backendId}
        onSelectBackend={selectBackend}
        lang={lang}
        onSelectLanguage={onSelectLanguage}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        onUndo={store.undo}
        onRedo={store.redo}
      />

      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

export default function App() {
  // The active UI language. Starts on English and is reconciled with the
  // persisted choice once it loads from AsyncStorage — mirroring how the
  // backend preference is hydrated in `AppInner`.
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    let cancelled = false;
    void loadLanguagePreference().then((stored) =>
      ensureCatalog(stored).then(() => {
        if (!cancelled) setLang(stored);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the target catalog before switching so the first paint in the new
  // language never falls back to English, then persist the choice on-device.
  const selectLanguage = useCallback((next: Lang) => {
    void ensureCatalog(next).then(() => {
      setLang(next);
      void saveLanguagePreference(next);
    });
  }, []);

  return (
    <LanguageProvider value={lang}>
      <SafeAreaProvider>
        <AppInner lang={lang} onSelectLanguage={selectLanguage} />
      </SafeAreaProvider>
    </LanguageProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: 96,
  },
  empty: {
    textAlign: "center",
    marginTop: spacing.xl,
    fontSize: 15,
  },
  fab: {
    position: "absolute",
    bottom: spacing.xl,
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabGlyph: {
    fontSize: 30,
    fontWeight: "300",
    lineHeight: 34,
  },
});
