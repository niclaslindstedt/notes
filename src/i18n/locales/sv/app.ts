import type { AppCatalog } from "../en/app.ts";

const app: AppCatalog = {
  title: "Notes",
  empty:
    "Inga anteckningar än. Tryck på + (eller tryck Enter) för att skriva din första.",
  loading: "Laddar anteckningar…",
  newNote: "Ny anteckning",
  back: "Tillbaka",
  startWriting: "Börja skriva…",
  titlePlaceholder: "Titel",
  attachments: "Bilagor",
  dropTitle: "Släpp för att importera",
  dropHint:
    "Släpp för att lägga till dina Markdown-filer som anteckningar — varje filnamn blir anteckningens titel.",
  archive: "Arkivera",
  archiveNote: "Arkivera anteckning",
  delete: "Ta bort",
  noteActions: "Anteckningsåtgärder",
  copy: {
    label: "Kopiera anteckning",
    copied: "Kopierat",
  },
  encryptedNote: "Krypterad i vila",
  uploadingNote: "Synkar…",
  decrypting: "Dekrypterar…",
};

export default app;
