// Top-level language wrapper, mounted from `main.tsx` around the app shell.
// Ported from checklist, trimmed to notes: notes has no toast system, so this
// only provides the active language to the tree, keeps `<html lang>` in step
// for accessibility, and gates the first paint until the persisted language's
// catalog is resident (so a returning Swedish user never sees a flash of
// English). The `UpdateToast` stays mounted inside `App`, where it already
// lives, rather than moving here.

import { useEffect, useState, type ReactNode } from "react";

import {
  LanguageProvider,
  bcp47,
  ensureCatalog,
  isCatalogLoaded,
  type Lang,
} from "./index.ts";
import {
  LANGUAGE_EVENT,
  readLanguagePreference,
} from "./language-preference.ts";

export function LanguageRoot({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => readLanguagePreference());
  // English is resident synchronously, so English users never gate; a
  // returning non-English user gates until the persisted catalog loads.
  const [booted, setBooted] = useState<boolean>(() => isCatalogLoaded(lang));

  useEffect(() => {
    // Apply a language switch only once its catalog is resident. Flipping
    // the context to a not-yet-loaded language would render the English
    // fallback and leave it stuck there (the context value wouldn't change
    // again when the catalog later arrives). Loading first means the single
    // context change already has the real strings.
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Lang>).detail;
      if (detail !== "en" && detail !== "sv") return;
      void ensureCatalog(detail).then(() => setLang(detail));
    };
    window.addEventListener(LANGUAGE_EVENT, onChange);
    return () => window.removeEventListener(LANGUAGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = bcp47(lang);
  }, [lang]);

  useEffect(() => {
    if (isCatalogLoaded(lang)) {
      setBooted(true);
      return;
    }
    // Only reached for a returning non-English user on first paint — load
    // the persisted language's catalog, then unblock the render.
    let cancelled = false;
    void ensureCatalog(lang).then(() => {
      if (!cancelled) setBooted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  return (
    <LanguageProvider value={lang}>{booted ? children : null}</LanguageProvider>
  );
}
