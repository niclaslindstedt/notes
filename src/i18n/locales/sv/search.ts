import type { SearchCatalog } from "../en/search.ts";

const search: SearchCatalog = {
  title: "Sök",
  placeholder: "Sök anteckningar på titel eller text…",
  clear: "Rensa sökning",
  prompt: "Sök igenom alla anteckningar — titlar och brödtext.",
  hint: "Vanlig text, luddig som standard. Använd jokertecken (recipe*, dr?ft) eller ett /regex/.",
  matchesOne: "1 anteckning",
  matchesOther: "{n} anteckningar",
  noResults: "Inga träffar för ”{query}”.",
  invalidRegex: "Det reguljära uttrycket är inte giltigt.",
};

export default search;
