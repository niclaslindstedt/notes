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
        "Den första icke-tomma raden blir anteckningens titel i listan; allt nedanför är brödtexten. Anteckningar visar Markdown medan du skriver.",
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
      condition: "Stäng av stavningskontroll och autokorrigering.",
      learnMore:
        "Skriver du kod, strukturerade anteckningar eller ett annat språk? Inställningar → Redigerare stoppar enheten från att kontrollera stavning och autokorrigera medan du skriver.",
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
    completionist: {
      name: "Fullbordaren",
      condition: "Lås upp alla andra bedrifter.",
      learnMore:
        "Den sista bedriften på tavlan — intjänad i samma stund du samlat alla andra.",
    },
  },
};

export default achievements;
