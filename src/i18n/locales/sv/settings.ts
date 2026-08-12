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
    transform: "Omvandling",
    export: "Export",
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
    lineNumbers: "Radnummer",
    lineNumbersHint:
      "Numrera varje rad längs redigerarens vänsterkant, som i en kodredigerare. Tryck på ett nummer för att markera hela raden. Kräver att Markdown-rendering är på.",
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
    capitaliseSentences: "Stor bokstav i meningar",
    capitaliseSentencesHint:
      "Inled varje mening med stor bokstav medan du skriver — efter punkt, frågetecken och utropstecken, och i början av en rad. Kodblock lämnas orörda, och versalen är en helt vanlig ändring, så Backsteg eller Ångra tar bort den direkt.",
    disableSpellcheck: "Inaktivera stavningskontroll",
    disableSpellcheckHint:
      "Sluta låta enheten kontrollera stavning medan du skriver, döljer de röda vågorna.",
    disableAutocorrect: "Inaktivera autokorrigering",
    disableAutocorrectHint:
      "Sluta låta enheten autokorrigera och automatiskt göra versaler medan du skriver (påverkar mest mobiltangentbord), och sluta avsluta meningen med punkt när mellanslag trycks två gånger. Åsidosätter Stor bokstav i meningar.",
    trimTrailingSpaces: "Ta bort släpande blanksteg",
    trimTrailingSpacesHint:
      "Ta bort blanksteg som lämnats kvar i slutet av varje rad när en anteckning sparas.",
    trailingNewline: "Avsluta med radbrytning",
    trailingNewlineHint:
      "Se till att en sparad anteckning avslutas med en enda avslutande radbrytning.",
    copyScope: "Kopiera",
    copyScopeHint:
      "Vad Export → Kopiera till urklipp lägger på urklipp. Brödtext är bara det du skrev; de andra lägger till titeln, eller hela .md-filen med dess YAML-frontmatter.",
    copyBody: "Brödtext",
    copyTitleBody: "Titel & brödtext",
    copyFrontMatter: "Frontmatter & brödtext",
  },

  transform: {
    rulesTitle: "Omvandlingsregler",
    blurb:
      "Ändra vad en anteckning visar utan att ändra vad den sparar. En regel matchar en del av en anteckning med ett reguljärt uttryck och visar något annat i dess ställe — ett ärendenummer som en länk till ärendet, ett telefonnummer med mitten maskad. Anteckningen behåller exakt det du skrev: sätt markören på raden för att se det, och kopiering kopierar alltid originalet.",
    scopeBlurb:
      "Varje regel hör till en namnrymd, så att jobb och hem kan skriva om olika saker. Regler från dina andra namnrymder listas också här, nedtonade — de körs inte över anteckningarna du har öppna.",
    empty: "Inga omvandlingar ännu.",
    add: "Lägg till omvandling",
    orderHint:
      "Reglerna körs uppifrån och ner, och den första som tar en textbit vinner.",
    toggleAria: "Aktivera {name}",
    editAria: "Redigera {name}",
    deleteAria: "Ta bort {name}",

    ruleTitleAdd: "Lägg till omvandling",
    ruleTitleEdit: "Redigera omvandling",
    name: "Namn",
    namePlaceholder: "Ärendelänkar",
    scope: "Gäller för",
    scopeAll: "Alla namnrymder",
    scopeHint:
      "Vilka anteckningar regeln skriver om. En ny regel börjar i namnrymden du är i; välj Alla namnrymder för att köra den överallt.",
    pattern: "Matcha",
    patternPlaceholder: "#(\\d+)",
    patternHint:
      "Ett reguljärt uttryck. Omslut en del med parenteser för att fånga den, och använd sedan $1, $2 … i ersättningen ($& är hela träffen).",
    patternInvalid: "Inte ett giltigt reguljärt uttryck: {error}",
    ignoreCase: "Ignorera skiftläge",
    helperToggle: "Regex-referens",
    tokenGroup: {
      match: "Matcha ett tecken",
      repeat: "Upprepa",
      group: "Gruppera",
      position: "Position",
    },
    token: {
      digit: "Vilken siffra som helst, 0 till 9",
      word: "Vilken bokstav, siffra eller understreck som helst",
      space: "Ett mellanslag, en tabb eller en radbrytning",
      any: "Vilket enskilt tecken som helst",
      set: "Något av tecknen du räknar upp",
      notSet: "Vilket tecken som helst utom de du räknar upp",
      range: "Ett teckenintervall — lägg det inuti […]",
      oneOrMore: "En eller flera av det som kom före",
      zeroOrMore: "Hur många som helst av det som kom före, även noll",
      optional: "Det som kom före, men det får saknas",
      count: "Mellan 2 och 4 av det som kom före — ändra siffrorna",
      capture:
        "Fånga det som står inuti, för att återanvända som $1 i ersättningen",
      nonCapture: "Gruppera utan att fånga — för att upprepa en hel fras",
      alternate: "Antingen vänstra eller högra sidan",
      lineStart: "Radens början",
      lineEnd: "Radens slut",
      wordBoundary: "Ett ordslut, så att #12 inte matchar inuti ab#123",
      escape: "Behandla nästa tecken som sig självt, inte som en regex-symbol",
    },
    kind: "Ersätt med",
    kindLink: "Länk",
    kindText: "Text",
    kindSensitive: "Känsligt",
    kindHint:
      "Länk behåller den matchade texten och gör den till en länk; Text visar något helt annat; Känsligt döljer träffen bakom en mask.",
    replacementLink: "Länkadress",
    replacementLinkHint:
      "Vart träffen pekar. Den matchade texten står kvar på skärmen; bara dess destination byggs av det här.",
    replacementLinkPlaceholder: "https://github.com/acme/repo/issues/$1",
    replacementText: "Ersättning",
    replacementTextHint: "Vad som ska visas i stället för träffen.",
    replacementTextPlaceholder: "$1",
    replacementSensitive: "Maska detta (valfritt)",
    replacementSensitiveHint:
      "Lämna tomt för att maska hela träffen. Fyll i för att i stället maska något som byggs av träffen.",
    mask: "Mask",
    maskAll: "Dölj allt",
    maskFixed: "Fast längd",
    maskEnds: "Behåll båda ändarna",
    maskLast: "Behåll slutet",
    maskFirst: "Behåll början",
    maskHint:
      "Hur mycket av träffen som fortfarande syns. Fast längd ritar alltid lika många stjärnor, så längden döljs också.",
    sample: "Exempeltext",
    samplePlaceholder: "Fixat i #134",
    output: "Resultat",
    outputEmpty: "Skriv lite exempeltext för att se vad regeln gör.",
    outputHint: "Hur exemplet ovan läses när regeln har tillämpats.",
  },

  export: {
    title: "Export",
    blurb:
      "Hur en anteckning ser ut när du exporterar den till PDF. Appen sätter och skriver filen själv, så inget annat än din anteckning hamnar på sidan. Export till Markdown skriver samma .md-fil som dina anteckningar lagras som, så den har inget att formge.",
    pageTitle: "Sida",
    textTitle: "Text",
    codeTitle: "Kod",
    listsTitle: "Listor",
    contentTitle: "Innehåll",
    pageSize: "Papper",
    pageLetter: "Letter",
    pageLegal: "Legal",
    orientation: "Orientering",
    portrait: "Stående",
    landscape: "Liggande",
    margins: "Marginaler",
    marginsHint: "Den tomma ramen runt sidans alla fyra kanter.",
    marginNarrow: "Smala",
    marginNormal: "Normala",
    marginWide: "Breda",
    bodyFont: "Typsnitt",
    fontSans: "Sanserif",
    fontSerif: "Serif",
    fontMono: "Fast breddsteg",
    bodyFontHint:
      "Typsnittet brödtexten sätts i. Endast familjerna som varje PDF-läsare redan har, så filen förblir liten och läses likadant överallt — appens egna webbtypsnitt hör inte dit.",
    fontSize: "Textstorlek",
    lineHeight: "Radavstånd",
    headingScale: "Rubrikstorlek",
    headingScaleFlat: "Platt",
    headingScaleSmall: "Liten",
    headingScaleNormal: "Normal",
    headingScaleLarge: "Stor",
    headingScaleHint:
      "Hur mycket större än brödtexten rubrikerna blir. Platt håller dem nära brödtextens storlek; Stor ger en titelsida mer tyngd.",
    headingFont: "Rubriktypsnitt",
    headingFontBody: "Som brödtexten",
    headingFontHint:
      "Typsnittet rubrikerna sätts i. Låt dem följa brödtexten, eller blanda de två — sanserifrubriker över en serifbrödtext är den klassiska kombinationen.",
    codeFont: "Kodtypsnitt",
    codeFontHint:
      "Kodblock och kod i löpande text har alltid fast breddsteg; här väljer du vilken familj. Courier finns i varje PDF-läsare; DejaVu Sans Mono bäddas in i filen, vilket lägger till några kilobyte och läses bättre.",
    codeSize: "Kodstorlek",
    codeBackground: "Kodbakgrund",
    codeBackgroundHint:
      "Fyllningen bakom kodblock och kod i löpande text. Skrivare respekterar den, så en mörk färg kostar bläck.",
    codeBackgroundNone: "Ingen bakgrund",
    codeBackgroundCustom: "Egen",
    bullet: "Punkt",
    bulletHint:
      "Punkten på en listrad på översta nivån ({name}). Nästlade nivåer fortsätter genom de övriga tecknen, så varje nivå förblir tydlig.",
    bulletDisc: "Rund",
    bulletCircle: "Ring",
    bulletSquare: "Fyrkant",
    bulletDash: "Streck",
    bulletArrow: "Pil",
    includeTitle: "Skriv ut titeln",
    includeTitleHint:
      "Inled sidan med anteckningens titel. Stäng av när anteckningen redan börjar med en egen rubrik.",
    pageNumbers: "Numrera sidorna",
    pageNumbersHint:
      "Sätt sidnumret längst ned på varje sida. Det är det enda appen skriver i marginalerna — webbadressen och datumet som en utskriftsdialog lägger till skrivs aldrig.",
    pageNumberFormat: "Nummerstil",
    pageNumberFormatHint:
      "Hur sidfoten skriver numret. Utelämna totalen när läsaren inte behöver veta var dokumentet slutar.",
    pageNumberAlign: "Nummerplacering",
    pageNumberAlignHint: "Vilken kant av textspalten numret ligger mot.",
    alignLeft: "Vänster",
    alignCenter: "Mitten",
    alignRight: "Höger",
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
    listLayoutList: "Lista",
    listLayoutHint:
      "Rader är en kompakt enradslista; kort är högre och visar mer av varje anteckning innan den tonas ut; lista är en avskalad filträdsvy med endast titlar.",
    sidebar: "Sidofält",
    favoritesFolders: "Mappar i Favoriter",
    favoritesFoldersHint:
      "Gruppera avsnittet Favoriter efter mapparna anteckningarna ligger i. Avstängt listas alla favoriter platt.",
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
    backendNotesd: "Egen server",
    notesdConnected:
      "Dina anteckningar synkas till din egen notesd-server — inget moln, inga konton.",
    notesdUnconnected:
      "Kör notesd-tjänsten på din egen dator och parkoppla appen för att synka privat över ditt nätverk. Endast tillgängligt i den installerade appen.",
    notesdPair: "Parkoppla en server…",
    notesdPairHint:
      "Starta notesd på din dator och klistra in parkopplingskoden den skriver ut (notesd://…) eller skanna dess QR-kod.",
    notesdPairPlaceholder: "notesd://pair?…",
    notesdPairSubmit: "Parkoppla",
    notesdScan: "Skanna QR",
    notesdPairing: "Parkopplar…",
    notesdDiscovered: "Hittade i din {source}:",
    notesdKnownHint:
      "Ange en ny parkopplingskod från ”{name}” — starta notesd och kopiera koden den visar.",
    notesdTokenPlaceholder: "Parkopplingstoken eller notesd://-kod",
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
    conversionRetry:
      "Kunde inte nå backend – försöker igen med ”{title}” (försök {attempt})…",
    conversionPaused:
      "Pausad medan du är offline – återupptas när anslutningen kommer tillbaka.",
    conversionUntitled: "den här anteckningen",
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
    hintRemote:
      "Kryptering aktiverades från en annan enhet. Ange lösenfrasen du valde där för att låsa upp dina anteckningar på den här enheten.",
    passphrase: "Lösenfras",
    unlock: "Lås upp",
    statusAria: "Upplåsningsförlopp",
    stepDerivingKey: "Kontrollerar din lösenfras…",
    stepDecrypting: "Dekrypterar dina anteckningar…",
    stepFinalizing: "Låser upp dina anteckningar…",
    decryptingNote: "Dekrypterar ”{title}” ({index}/{total})…",
    untitledNote: "Namnlös anteckning",
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
