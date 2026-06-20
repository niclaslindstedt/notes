import type { AchievementsCatalog } from "../en/achievements.ts";

const achievements: AchievementsCatalog = {
  button: {
    open: "Bedrifter",
    unseenOne: "1 ny bedrift",
    unseenOther: "{n} nya bedrifter",
  },
  unlockModal: {
    titleOne: "Bedrift upplåst!",
    titleOther: "{n} bedrifter upplåsta!",
    dismiss: "Toppen!",
  },
  modal: {
    title: "Bedrifter",
    counter: "{unlocked} av {total} upplåsta · {earned}/{max} poäng",
    intro:
      "Varje funktion i appen är också en bedrift. När du använder den — skriver en anteckning, byter tema, ansluter molnet — tjänar du tyst ihop bedrifter. Du jagar dem inte; de hittar dig.",
    learnMore: "Läs mer",
    locked: "Låst",
    tier: {
      beginner: {
        title: "Nybörjare",
        subtitle: "Har precis öppnat appen — hittar dina fötter.",
      },
      intermediate: {
        title: "Van",
        subtitle: "Gör den till din egen.",
      },
      pro: {
        title: "Proffs",
        subtitle: "Synka den, säkra den, ta den överallt.",
      },
      expert: {
        title: "Expert",
        subtitle: "Forma appen helt efter ditt arbetssätt.",
      },
    },
  },
  catalog: {
    // ── Nybörjare ─────────────────────────────────────────────────────
    firstNote: {
      name: "Första anteckningen",
      condition: "Skriv din första anteckning.",
      learnMore:
        "Tryck på +-knappen (eller tryck Enter i den tomma listan) för att börja en anteckning. Allt du skriver sparas automatiskt medan du skriver.",
    },
    wordsmith: {
      name: "Ordkonstnär",
      condition: "Skriv en anteckning som sträcker sig över mer än en rad.",
      learnMore:
        "En antecknings titel är ett eget fält högst upp; allt nedanför är brödtexten. Anteckningar visar Markdown medan du skriver.",
    },
    headliner: {
      name: "Rubriksättaren",
      condition: "Ge en anteckning en titel.",
      learnMore:
        "Titeln är en egen rad högst upp i anteckningen — skriv den där i stället för som första raden i brödtexten. Den går inte att nå genom att backa från brödtexten, och den namnger anteckningens fil när du synkar till en mapp eller molnet.",
    },
    interiorDesigner: {
      name: "Inredaren",
      condition: "Byt till ett annat tema.",
      learnMore:
        "Inställningar → Utseende erbjuder en rad ljusa och mörka redigerartema. Ditt val sparas på den här enheten (och följer med molnsynk).",
    },
    biggerPicture: {
      name: "Den större bilden",
      condition: "Ändra gränssnittets textstorlek.",
      learnMore:
        "Inställningar → Utseende skalar hela gränssnittet upp eller ner, så att appen läses bekvämt på vilken skärm som helst.",
    },
    secondThoughts: {
      name: "Ångrar mig",
      condition: "Ångra en redigering.",
      learnMore:
        "Använd Ångra i sidomenyn (eller Ctrl/Cmd+Z) för att stega bakåt genom dina redigeringar — att skapa, ta bort och skriva går allt att ångra.",
    },
    homeScreen: {
      name: "Hemskärmen",
      condition: "Installera appen på din enhet.",
      learnMore:
        "notes är en Progressive Web App: lägg till den på hemskärmen eller i appstartaren så öppnas den i helskärm och fungerar offline, precis som en inbyggd app.",
    },

    // ── Van ───────────────────────────────────────────────────────────
    collector: {
      name: "Samlaren",
      condition: "Ha fem anteckningar samtidigt.",
      learnMore:
        "Det finns ingen gräns för hur många anteckningar du behåller. Listan sorterar de senast redigerade högst upp så att det du jobbar med stannar inom räckhåll.",
    },
    fontFanatic: {
      name: "Typsnittsnörd",
      condition: "Välj ett annat typsnitt.",
    },
    marginalia: {
      name: "Marginalanteckningar",
      condition: "Justera redigerarens skrivkolumnmarginaler.",
      learnMore:
        "Inställningar → Redigerare smalnar av skrivkolumnen för en mer fokuserad, sidlik känsla — eller låter den löpa över skärmens fulla bredd.",
    },
    plainText: {
      name: "Enkelt och rent",
      condition: "Stäng av direkt Markdown-visning.",
      learnMore:
        "Föredrar du ren text? Inställningar → Redigerare stänger av direktförhandsvisningen så att anteckningar förblir vanlig, oformaterad källtext.",
    },
    freehand: {
      name: "Frihand",
      condition: "Inaktivera stavningskontroll eller autokorrigering.",
      learnMore:
        "Skriver du kod, strukturerade anteckningar eller ett annat språk? Inställningar → Redigerare kan stoppa enheten från att kontrollera stavning och autokorrigera medan du skriver.",
    },
    namingConvention: {
      name: "Namnsättning",
      condition: "Ändra standardtiteln för nya anteckningar.",
      learnMore:
        "Inställningar → Redigerare avgör vad en helt ny anteckning heter innan du själv titulerar den — datum och tid, en automatiskt räknande ”Note”, ”Note 2”, … , eller ingenting alls.",
    },
    tidyUp: {
      name: "Städa upp",
      condition: "Ändra hur anteckningar städas när de sparas.",
      learnMore:
        "Inställningar → Redigerare städar varje anteckning när den sparas — tar bort släpande blanksteg från varje rad och avslutar anteckningen med en enda radbrytning. Stäng av endera för att behålla dina anteckningar precis som du skrev dem.",
    },
    archivist: {
      name: "Arkivarie",
      condition: "Arkivera en anteckning.",
      learnMore:
        "Svep en anteckning åt höger i översikten för att arkivera den — den lämnar listan utan att tas bort. Hitta arkiverade anteckningar under Arkiv i sidomenyn, där du kan återställa eller ta bort dem permanent.",
    },
    compartments: {
      name: "Fack",
      condition: "Skapa en andra namnrymd.",
      learnMore:
        "Namnrymder är separata, fristående uppsättningar anteckningar — jobb och hem, till exempel. Växla mellan dem från sidomenyn; var och en kan synka till sin egen mapp.",
    },
    polyglot: {
      name: "Polyglott",
      condition: "Byt appens språk.",
      learnMore:
        "notes talar engelska och svenska — byt i Inställningar → Allmänt så följer hela gränssnittet med. Ditt val kommer ihåg på den här enheten.",
    },
    importer: {
      name: "Importör",
      condition: "Dra och släpp en Markdown-fil i appen.",
      learnMore:
        "På datorn kan du släppa en eller flera Markdown-filer var som helst på fönstret så blir varje fil en anteckning — filnamnet blir titeln och innehållet fyller anteckningen.",
    },
    copycat: {
      name: "Kopiekatt",
      condition: "Kopiera en anteckning till urklipp.",
      learnMore:
        "Kopieringsknappen bredvid synkglyfen lägger den öppna anteckningen på urklipp. Inställningar → Redigerare väljer hur mycket som tas med — bara brödtexten, titel och brödtext, eller hela .md-filen med dess YAML-frontmatter.",
    },

    // ── Proffs ────────────────────────────────────────────────────────
    localVault: {
      name: "Lokalt valv",
      condition: "Anslut en mapp på din enhet.",
      learnMore:
        "Inställningar → Lagring kan spara varje anteckning som en vanlig Markdown-fil i en mapp du väljer, så att dina anteckningar lever som vanliga filer du helt äger.",
    },
    cloudWalker: {
      name: "Molnvandraren",
      condition: "Anslut en molnlagring.",
      learnMore:
        "Anslut Dropbox eller Google Drive så synkas dina anteckningar till din egen molnlagring, så att de följer dig till varje enhet du loggar in på.",
    },
    freshPull: {
      name: "Färskt drag",
      condition: "Ladda om dina anteckningar från backend.",
      learnMore:
        "Synkdetaljdialogen kan läsa om dokumentet från den anslutna backenden och hämta in redigeringar en annan enhet gjort.",
    },
    peacemaker: {
      name: "Fredsmäklaren",
      condition: "Lös en synkkonflikt.",
      learnMore:
        "När två enheter ändrar samma anteckningar medan de är åtskilda lyfter appen fram krocken och låter dig behålla dina eller ta deras — inga redigeringar tyst förlorade.",
    },
    pictureThis: {
      name: "En bild säger mer",
      condition: "Klistra in eller släpp en bild i en anteckning.",
      learnMore:
        "Med en lokal mapp eller molnbackend kan du klistra in (Ctrl/Cmd+V) eller dra en bild rakt in i redigeraren. Den sparas som en riktig bildfil i en attachments-mapp bredvid dina anteckningar och visas inline som en miniatyr du kan klicka på för att öppna i full storlek.",
    },
    liveSync: {
      name: "Telepati",
      condition: "Se en redigering från en annan enhet dyka upp av sig själv.",
      learnMore:
        "Med en mapp- eller molnbackend ansluten letar notes tyst efter ändringar med några sekunders mellanrum och hämtar in dem av sig själv — så att en redigering du gör på en enhet dyker upp på en annan medan du tittar, även med anteckningen öppen, så länge du pausat skrivandet.",
    },

    // ── Expert ────────────────────────────────────────────────────────
    paranoidMode: {
      name: "Paranoialäge",
      condition: "Slå på kryptering i vila.",
      learnMore:
        "Inställningar → Lagring krypterar dina anteckningar med en lösenfras bara du har. De förseglas på disken och i molnet tills du låser upp dem.",
    },
    themeWizard: {
      name: "Tematrollkarl",
      condition: "Bygg ditt eget anpassade tema.",
      learnMore:
        "Det egna temat i Inställningar → Utseende öppnar varje färg, hörnrundning och radtäthet för dig för ett utseende som är helt ditt eget.",
    },
    stillness: {
      name: "Stillhet",
      condition: "Slå på reducerad rörelse.",
    },
    minimalist: {
      name: "Minimalisten",
      condition: "Dölj den flytande menyknappen.",
      learnMore:
        "I den installerade mobilappen kan du dölja den flytande menyknappen helt och öppna sidomenyn med ett inåtsvep från skärmkanten.",
    },
    underTheHood: {
      name: "Under huven",
      condition: "Slå på utvecklarläget.",
      learnMore:
        "Inställningar → Allmänt → Utvecklarläge visar en Utvecklare-flik vars diagnostik — som att spara den inbyggda loggen mellan omladdningar — hjälper dig spåra ett synkproblem från enheten där det inträffar.",
    },
    holodeck: {
      name: "Holodäck",
      condition: "Ladda exempeldatan.",
    },
    completionist: {
      name: "Fullbordaren",
      condition: "Lås upp alla andra bedrifter.",
      learnMore:
        "Den sista bedriften på tavlan — intjänad i samma stund du samlat alla andra.",
    },
  },
};

export default achievements;
