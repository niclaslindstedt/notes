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
    developer: "Utvecklare",
    logs: "Loggar",
  },

  general: {
    languageTitle: "Språk",
    languageChoose: "Välj språk",
    languageHint: "Översätt gränssnittet mellan engelska och svenska.",
    achievementsTitle: "Bedrifter",
    menuTitle: "Meny",
    developerTitle: "Utvecklare",
    language: "Språk",
    disableAchievements: "Inaktivera bedrifter",
    disableAchievementsHint:
      "Sluta spåra bedrifter och dölj troféknappen. Bedrifter du redan låst upp behålls.",
    menuActivation: "Öppna menyn med",
    menuActivationHint:
      "Välj hur sidomenyn öppnas på den här enheten — tryck på den flytande knappen eller svep in från skärmkanten.",
    menuActivationSwipe: "Högersvep",
    menuActivationButton: "Flytande knapp",
    devMode: "Utvecklarläge",
    devModeHint:
      "Visa fliken Utvecklare med diagnostikverktyg. Stannar på den här enheten.",
  },

  developer: {
    title: "Utvecklare",
    blurb:
      "Diagnostik för utveckling. De här inställningarna stannar på den här enheten och följer aldrig med en synkad mapp eller moln.",
    captureLogs: "Spara loggar",
    captureLogsHint:
      "Spela in den inbyggda loggen i den här webbläsaren så att den överlever en omladdning, och visa fliken Loggar. Av som standard.",
    fakeData: "Falska data",
    fakeDataHint:
      "Ersätt dina anteckningar med ett exempeldokument i minnet för den här sessionen. Ladda om (eller stäng av) för att återgå till dina riktiga anteckningar — exemplet sparas aldrig.",
  },

  editor: {
    title: "Redigerare",
    newNotesTitle: "Nya anteckningar",
    layoutTitle: "Skrivkolumn",
    markdownTitle: "Markdown",
    typingTitle: "Skrivhjälp",
    formattingTitle: "Formatering vid sparande",
    copyTitle: "Kopiering",
    defaultTitle: "Standardtitel",
    defaultTitleHint:
      "Vad en ny anteckning ska heta innan du ger den en egen titel.",
    defaultTitleOff: "Av",
    defaultTitleDateTime: "Datum & tid",
    defaultTitleNumbered: "Numrerad",
    margins: "Marginaler",
    marginsHint: "Hur mycket andrum som lämnas runt skrivkolumnen.",
    wordWrap: "Radbrytning",
    wordWrapHint: "Bryt långa rader istället för att skrolla i sidled.",
    renderMarkdown: "Rendera Markdown",
    renderMarkdownHint:
      "Formatera Markdown medan du skriver — varje rad utom den du står på visas formaterad, som i Obsidian.",
    shortenLinks: "Förkorta länkar",
    shortenLinksHint:
      "Korta ned långa inklistrade URL:er i förhandsvisningen till domänen och några tecken på var sida om en [...]-markör. Hela länken sparas och öppnas fortfarande — bara visningen förkortas.",
    shortenLinksOff: "Av",
    attachmentsTitle: "Bilagor",
    imagesAtEnd: "Bilder i slutet",
    imagesAtEndHint:
      "Samla inklistrade eller släppta bilder i ett block längst ned i anteckningen istället för att visa dem inline där du lade till dem.",
    filesAtEnd: "Filer i slutet",
    filesAtEndHint:
      "Samla bifogade filer (allt som inte är en bild) i ett block längst ned i anteckningen istället för inline.",
    disableSpellcheck: "Inaktivera stavningskontroll",
    disableSpellcheckHint:
      "Sluta låta enheten kontrollera stavning medan du skriver, döljer de röda vågorna.",
    disableAutocorrect: "Inaktivera autokorrigering",
    disableAutocorrectHint:
      "Sluta låta enheten autokorrigera och automatiskt göra versaler medan du skriver (påverkar mest mobiltangentbord).",
    trimTrailingSpaces: "Ta bort släpande blanksteg",
    trimTrailingSpacesHint:
      "Ta bort blanksteg som lämnats kvar i slutet av varje rad när en anteckning sparas.",
    trailingNewline: "Avsluta med radbrytning",
    trailingNewlineHint:
      "Se till att en sparad anteckning avslutas med en enda avslutande radbrytning.",
    copyScope: "Kopiera",
    copyScopeHint:
      "Vad redigerarens kopieringsknapp lägger på urklipp. Brödtext är bara det du skrev; de andra lägger till titeln, eller hela .md-filen med dess YAML-frontmatter.",
    copyBody: "Brödtext",
    copyTitleBody: "Titel & brödtext",
    copyFrontMatter: "Frontmatter",
  },

  appearance: {
    theme: "Tema",
    mode: "Läge",
    variant: "Variant",
    systemNote: "Följer enhetens ljusa/mörka inställning.",
    list: "Anteckningslista",
    listLayout: "Layout",
    listLayoutRows: "Rader",
    listLayoutCards: "Kort",
    listLayoutHint:
      "Rader är en kompakt enradslista; kort är högre och visar mer av varje anteckning innan den tonas ut.",
    sidebar: "Sidofält",
    folderPlacement: "Mappar",
    folderPlacementTop: "Överst",
    folderPlacementMixed: "Blandat",
    folderPlacementHint:
      "Håll mapparna fästa ovanför anteckningarna, eller sortera in dem bland anteckningarna.",
    sortBy: "Sortera efter",
    sortByModified: "Senast ändrad",
    sortByName: "Namn",
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
    encryptionBusyEnabling: "Aktiverar kryptering…",
    encryptionBusyDisabling: "Stänger av kryptering…",
    encryptionStepReading: "Läser dina anteckningar…",
    encryptionStepDerivingKey: "Härleder krypteringsnyckel…",
    encryptionStepEncrypting: "Krypterar dina anteckningar…",
    encryptionStepDecrypting: "Dekrypterar dina anteckningar…",
    encryptionStepSaving: "Sparar dina anteckningar…",
    encryptionStepFinalizing: "Slutför…",
    encryptingNote: "Krypterar ”{title}”…",
    encryptingAttachment: "Krypterar ”{filename}” (bilaga till ”{title}”)…",
    decryptingNote: "Dekrypterar ”{title}”…",
    decryptingAttachment: "Dekrypterar ”{filename}” (bilaga till ”{title}”)…",
    conversionCanClose:
      "Du kan stänga inställningarna nu – det här slutförs i bakgrunden.",
    encryptionFailed: "Något gick fel. Tryck för att se loggen.",
    encryptionStatusAria: "Krypteringsförlopp",
    encryptionLogTitle: "Krypteringslogg",
    encryptionLogEmpty: "Inget loggades.",
  },

  unlock: {
    title: "Anteckningarna är låsta",
    hint: "Ange din lösenfras för att låsa upp och läsa dina anteckningar på den här enheten.",
    passphrase: "Lösenfras",
    unlock: "Lås upp",
    statusAria: "Upplåsningsförlopp",
    wrong: "Den lösenfrasen fungerade inte.",
    offline:
      "Du är offline och inget är cachat på den här enheten ännu. Anslut till internet och försök igen.",
  },

  logs: {
    title: "Loggar",
    filterLabel: "Filter",
    filterAll: "Alla",
    filterInfo: "Info",
    filterWarn: "Varningar",
    filterError: "Fel",
    copy: "Kopiera",
    copied: "Kopierat till urklipp.",
    copyFailed: "Kopieringen misslyckades.",
    clear: "Rensa",
    empty: "Inga poster.",
    entryCount: "{count} poster.",
  },
};

export default settings;
