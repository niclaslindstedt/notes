import type { Widen } from "./_widen.ts";

// Strings for the search modal — the input chrome, the empty / no-result /
// invalid-regex states, and the result-count label. Opened from the magnifier
// on the side-menu action bar; see `src/ui/SearchModal.tsx`.

const search = {
  title: "Search",
  placeholder: "Search notes by title or text…",
  clear: "Clear search",
  // The empty-input prompt and the one-line syntax hint beneath the field.
  prompt: "Search across every note — titles and body text.",
  hint: "Plain text, fuzzy by default. Use wildcards (recipe*, dr?ft) or a /regex/.",
  // Result chrome.
  matchesOne: "1 note",
  matchesOther: "{n} notes",
  // Empty / error states.
  noResults: "No matches for “{query}”.",
  invalidRegex: "That regular expression isn’t valid.",
} as const;

export type SearchCatalog = Widen<typeof search>;

export default search;
