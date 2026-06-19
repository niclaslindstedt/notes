import type { SyncCatalog } from "../en/sync.ts";

const sync: SyncCatalog = {
  offline: "Offline",
  saving: "Sparar…",
  failed: "Synkroniseringen misslyckades",
  throttled: "Hastighetsbegränsad — försöker igen",
  reauthRequired: "Återanslutning krävs",
  syncConflict: "Synkroniseringskonflikt",
  saveUnsaved: "Spara osparade ändringar",
  syncedTo: "Synkroniserat till {provider}",

  cloudSync: "Molnsynkronisering",
  status: "Status",
  backend: "Lagring",
  fileLocation: "Filplats",
  reconnectTo: "Återanslut till {provider}",
  saveNow: "Spara nu",
  reloadFromBackend: "Läs in från lagringen",
  openIn: "Öppna i {provider}",

  offlineHeading: "Du är offline",
  offlineDetail:
    "Du redigerar kopian som är sparad på den här enheten. Den synkas tillbaka till {provider} när anslutningen återställs.",
  syncingNow: "Synkroniserar nu…",
  failedHeading: "Synkroniseringen misslyckades",
  failedDetailFallback:
    "Den senaste sparningen till {provider} gick inte igenom.",
  throttledHeading: "Hastighetsbegränsad",
  throttledDetail:
    "{provider} begränsar sparningar. Dina senaste ändringar synkas automatiskt om en stund.",
  reauthHeading: "Återanslutning krävs",
  reauthDetail:
    "Din anslutning till {provider} har gått ut. Återanslut för att fortsätta synka.",
  conflictHeading: "Synkroniseringskonflikt",
  conflictDetail:
    "En annan enhet ändrade de här anteckningarna. Välj vilken kopia du vill behålla i konfliktrutan.",
  pendingHeading: "Osparade ändringar",
  pendingDetail: "Du har ändringar som ännu inte har sparats till {provider}.",
  syncedHeading: "Synkroniserat till {provider}",

  conflict: {
    title: "De här anteckningarna ändrades på en annan enhet",
    hint: "Din kopia på den här enheten och kopian i lagringen har båda ändrats. Behåll en — ingenting slås samman automatiskt.",
    keepMineOne: "Behåll den här enhetens kopia ({n} anteckning)",
    keepMineOther: "Behåll den här enhetens kopia ({n} anteckningar)",
    keepTheirsOne: "Behåll den andra kopian ({n} anteckning)",
    keepTheirsOther: "Behåll den andra kopian ({n} anteckningar)",
  },
};

export default sync;
