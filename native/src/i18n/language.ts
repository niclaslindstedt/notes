// Which language the native app shows, persisted across launches. The native
// counterpart of the web app's language preference, backed by AsyncStorage
// instead of localStorage. Mirrors `storage/backendPreference.ts`: a small
// best-effort load/save pair around one AsyncStorage key.
//
// Kept on-device on purpose — the chosen UI language is a device preference,
// not part of the synced note document.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { detectInitialLanguage, type Lang } from "../../../src/i18n/index.ts";

const LANGUAGE_KEY = "notes/language";

/**
 * The persisted language choice, or the platform default when nothing is
 * stored yet (or the stored value is corrupt). On React Native
 * `detectInitialLanguage()` falls back to English since `navigator.language`
 * is typically undefined.
 */
export async function loadLanguagePreference(): Promise<Lang> {
  try {
    const raw = await AsyncStorage.getItem(LANGUAGE_KEY);
    return raw === "en" || raw === "sv" ? raw : detectInitialLanguage();
  } catch {
    return detectInitialLanguage();
  }
}

export async function saveLanguagePreference(lang: Lang): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    // Best-effort: a failed write just means the choice isn't remembered
    // across launches, not that the current session breaks.
  }
}
