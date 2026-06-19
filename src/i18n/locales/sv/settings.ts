import type { SettingsCatalog } from "../en/settings.ts";

const settings: SettingsCatalog = {
  title: "Inställningar",
  close: "Stäng inställningar",
  sections: "Inställningssektioner",
  chooseSection: "Välj sektion",

  tab: {
    general: "Allmänt",
    appearance: "Utseende",
    editor: "Redigerare",
    storage: "Lagring",
  },

  general: {
    languageTitle: "Språk",
    languageChoose: "Välj språk",
    languageHint: "Översätt gränssnittet mellan engelska och svenska.",
    achievementsTitle: "Bedrifter",
    menuTitle: "Meny",
    language: "Språk",
    disableAchievements: "Inaktivera bedrifter",
    disableAchievementsHint:
      "Sluta spåra bedrifter och dölj troféknappen. Bedrifter du redan låst upp behålls.",
    menuButton: "Visa menyknapp",
    menuButtonHint:
      "När den är av sveper du in från skärmkanten för att öppna menyn.",
    diagnosticsTitle: "Diagnostik",
    verboseLogging: "Utförlig synkloggning",
    verboseLoggingHint:
      "Spela in ett detaljerat spår av varje sparning så att ett synkproblem kan felsökas. Lämna av vid vanlig användning.",
    logsHint:
      "Återskapa problemet och kopiera sedan loggarna till en buggrapport.",
    logsEmpty: "Inga loggar har fångats än.",
    copyLogs: "Kopiera loggar",
    logsCopied: "Kopierat!",
    clearLogs: "Rensa",
  },

  editor: {
    title: "Redigerare",
    margins: "Marginaler",
    marginsHint: "Hur mycket andrum som lämnas runt skrivkolumnen.",
    wordWrap: "Radbrytning",
    wordWrapHint: "Bryt långa rader istället för att skrolla i sidled.",
    renderMarkdown: "Rendera Markdown",
    renderMarkdownHint:
      "Formatera Markdown medan du skriver — varje rad utom den du står på visas formaterad, som i Obsidian.",
    disableSpellcheck: "Inaktivera stavningskontroll",
    disableSpellcheckHint:
      "Sluta låta enheten kontrollera stavning medan du skriver, döljer de röda vågorna.",
    disableAutocorrect: "Inaktivera autokorrigering",
    disableAutocorrectHint:
      "Sluta låta enheten autokorrigera och automatiskt göra versaler medan du skriver (påverkar mest mobiltangentbord).",
  },

  appearance: {
    theme: "Tema",
    mode: "Läge",
    variant: "Variant",
    systemNote: "Följer enhetens ljusa/mörka inställning.",
    font: "Typsnitt",
    fontFamily: "Typsnittsfamilj",
    textSize: "Textstorlek",
    colours: "Färger",
    shapeMotion: "Form och rörelse",
    cornerRadius: "Hörnradie",
    density: "Täthet",
    reduceMotion: "Minska rörelser",
    reduceMotionHint: "Inaktivera animationer och övergångar.",
  },

  storage: {
    backendTitle: "Var dina anteckningar lagras",
    backendBlurb:
      "Anteckningar sparas som en markdown-fil per anteckning. Behåll dem på den här enheten, i en mapp du väljer, eller i ditt eget moln — de rör aldrig en server hos oss.",
    backendAria: "Lagringsbackend",
    backendBrowser: "Den här enheten",
    backendFolder: "Lokal mapp",
    backendDropbox: "Dropbox",
    backendGoogleDrive: "Google Drive",
    browserHint:
      "Anteckningar finns bara i den här webbläsaren. De stannar på den här enheten och delas inte med dina andra enheter.",
    folderConnected:
      "Dina anteckningar sparas som markdown-filer i mappen du valde.",
    folderUnconnected:
      "Välj en mapp att spara dina anteckningar i som markdown-filer.",
    folderReconnectHint:
      "Den här webbläsaren förlorade åtkomst till mappen. Återanslut för att fortsätta spara där.",
    folderReconnect: "Återanslut mapp",
    folderChoose: "Välj mapp…",
    dropboxConnected: "Dina anteckningar synkas till din Dropbox-appmapp.",
    dropboxUnconnected:
      "Logga in för att behålla dina anteckningar i din egen Dropbox.",
    gdriveConnected:
      "Dina anteckningar synkas till en mapp i din Google Drive.",
    gdriveUnconnected:
      "Logga in för att behålla dina anteckningar i din egen Google Drive.",
    encryptionTitle: "Kryptering",
    encryptionOn: "Kryptering är på",
    encryptionOff: "Kryptering är av",
    encryptionHint:
      "Kryptera dina anteckningar (AES-GCM) med en lösenfras innan de sparas. Lösenfrasen lämnar aldrig den här enheten och kan inte återställas — glöm den och anteckningarna kan inte läsas.",
    enableEncryption: "Aktivera kryptering",
    disableEncryption: "Stäng av kryptering",
    passphrase: "Lösenfras",
    passphraseConfirm: "Bekräfta lösenfras",
    passphraseWarning:
      "Det finns ingen återställning. Om du glömmer lösenfrasen kan dina anteckningar inte läsas.",
    passphraseTooShort: "Använd en lösenfras på minst 4 tecken.",
    passphraseMismatch: "Lösenfraserna matchar inte.",
  },

  unlock: {
    title: "Anteckningarna är låsta",
    hint: "Ange din lösenfras för att låsa upp och läsa dina anteckningar på den här enheten.",
    passphrase: "Lösenfras",
    unlock: "Lås upp",
    wrong: "Den lösenfrasen fungerade inte.",
    offline:
      "Du är offline och inget är cachat på den här enheten ännu. Anslut till internet och försök igen.",
  },
};

export default settings;
