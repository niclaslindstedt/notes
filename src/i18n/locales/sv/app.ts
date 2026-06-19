import type { AppCatalog } from "../en/app.ts";

const app: AppCatalog = {
  title: "Notes",
  empty:
    "Inga anteckningar än. Tryck på + (eller tryck Enter) för att skriva din första.",
  newNote: "Ny anteckning",
  back: "Tillbaka",
  startWriting: "Börja skriva…",
  titlePlaceholder: "Titel",
  dropTitle: "Släpp för att importera",
  dropHint:
    "Släpp för att lägga till dina Markdown-filer som anteckningar — varje filnamn blir anteckningens titel.",
  archive: "Arkivera",
  archiveNote: "Arkivera anteckning",
  delete: "Ta bort",
  copy: {
    label: "Kopiera anteckning",
    copied: "Kopierat",
  },
};

export default app;
