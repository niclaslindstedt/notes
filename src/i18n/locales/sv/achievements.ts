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
    emphasis: {
      name: "Betoning",
      condition:
        "Märk upp ett ord som fetstilt, kursivt, överstruket eller kod.",
      learnMore:
        "Omge ett ord med `**` för fetstil, `*` för kursiv, `~~` för överstruket eller bakåtfnuttar för kod, så formaterar redigeraren det medan du skriver. Raden du står på behåller formateringen den också — markörerna dyker bara upp bredvid, nedtonade, så att du ser vad som håller ordet uppe och kan ta bort det igen.",
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
    guillotine: {
      name: "Giljotinen",
      condition: "Klipp ut något med klipp ut-knappen (eller Ctrl/Cmd+K).",
      learnMore:
        "Saxknappen uppe till höger i en anteckning klipper ut till urklipp: det du har markerat, eller — utan markering — hela raden som markören står på, så att städa en anteckning blir ett tryck i stället för att markera och sudda eller hålla in Backsteg. Står markören mitt i en mening tas bara det som kommer efter den på raden, så det du ville behålla står kvar. Ctrl/Cmd+K gör samma sak från tangentbordet, och Ångra lägger tillbaka det.",
    },
    stylist: {
      name: "Stilisten",
      condition: "Formatera något med formateringsraden.",
      learnMore:
        "Formateringsknappen uppe till höger i en anteckning fäller ut en rad ovanför texten — rubriker, fet, kursiv, genomstruken, kod i text, punktlistor och numrerade listor, citat, kodblock, indrag, länkar, bilder och avdelare, en knapp var. Den skriver vanlig Markdown, så allt du når där kan du lika gärna skriva för hand; varje knapp är en växel, så ett tryck på en tänd knapp tar bort formateringen igen.",
    },

    fullStop: {
      name: "Punkt slut",
      condition: "Avsluta en mening genom att trycka mellanslag två gånger.",
      learnMore:
        'Tryck mellanslag två gånger efter ett ord så avslutar anteckningen meningen åt dig: det första mellanslaget sväljs och en punkt skrivs i dess ställe, med markören kvar efter ". " redo för nästa mening. Det är samma genväg som telefonen tillämpar i vilket annat textfält som helst — editorn skriver varje tangenttryck in i anteckningen själv, vilket sätter tryckningen utom räckhåll för tangentbordet, så den gör utbytet i stället och gör det likadant på en dator. Två mellanslag efter en punkt förblir två mellanslag, och inuti ett kodblock skrivs ingenting om. Stäng av det med "Inaktivera autokorrigering" under Inställningar → Redigerare.',
    },
    capitalIdea: {
      name: "Stor idé",
      condition:
        "Låt anteckningen skriva den stora bokstaven som inleder en mening.",
      learnMore:
        'Börja en mening så skriver anteckningen den stora bokstaven åt dig \u2014 första tecknet på en rad, och första tecknet efter punkt, frågetecken eller utropstecken. Det är samma versal som telefonen sätter in åt dig överallt annars, gjord av appen eftersom editorn skriver varje tangenttryck in i anteckningen själv, vilket sätter tryckningen utom räckhåll för tangentbordet; det är också därför det fungerar likadant på en dator, där ingenting erbjuder det alls. Ett filnamn eller ett decimaltal behåller sina små bokstäver, kodblock lämnas precis som du skrev dem, och eftersom versalen är en helt vanlig ändring tar Backsteg eller Ångra bort den igen. Stäng av det med "Stor bokstav i meningar" under Inställningar \u2192 Redigerare.',
    },
    pinpoint: {
      name: "Pricksäker",
      condition: "Hitta text inuti anteckningen du har öppen.",
      learnMore:
        "Förstoringsglaset i en antecknings sidhuvud fäller ut ett sökfält under toppraden, med markören redan i det. Det du skriver matchas ordagrant och utan hänsyn till versaler mot anteckningen du läser — alla träffar lyser upp samtidigt, pilarna stegar mellan dem (Enter och Skift+Enter gör samma sak från tangentbordet) och räknaren säger vilken av hur många du står på. Den söker bara i den öppna anteckningen; förstoringsglaset i sidomenyn är det som söker i allihop.",
    },
    starStruck: {
      name: "Stjärnögd",
      condition: "Lägg till en anteckning bland favoriterna.",
      learnMore:
        "Stjärnan till vänster i en antecknings sidhuvud gör den till favorit, och sidomenyn får ett avsnitt Favoriter ovanför anteckningslistan med allt du stjärnmärkt. Det är en genväg, inte en flytt: anteckningen behåller sin mapp, sin plats i den vanliga listan och allt annat — stjärnan sätter bara en extra dörr på den, så att de få anteckningar du ständigt återvänder till är ett tryck bort hur djupt de än ligger. Som standard struntar Favoriter helt i mapparna och listar anteckningarna platt; under Inställningar → Utseende → Sidomeny kan du i stället låta mappstrukturen synas där.",
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
    gallery: {
      name: "Galleri",
      condition: "Växla anteckningslistan till en annan layout.",
      learnMore:
        "Inställningar → Utseende visar översikten på tre sätt: kompakta enradsrader, högre kort som visar flera rader av varje anteckning och tonar ut slutet, eller en avskalad filträdsvy med endast titlar. Välj det som är lättast för dig att överblicka.",
    },
    sidebarArranger: {
      name: "Omarrangeraren",
      condition: "Ändra hur sidomenyn ordnar mappar och anteckningar.",
      learnMore:
        "Inställningar → Utseende → Sidofält avgör om mappar fästs ovanför anteckningarna eller blandas in bland dem, och om sidomenyn sorterar efter namn eller efter vad du senast ändrade.",
    },
    spaceSaver: {
      name: "Utrymmesspararen",
      condition:
        "Fäll ihop sidomenyns sidfot för att ge mer plats åt anteckningar.",
      learnMore:
        "Den tunna pilraden precis ovanför sidfoten fäller ihop raderna Donera, troféer, Om och Inställningar och ger det lodräta utrymmet till din anteckningslista. Tryck igen för att ta tillbaka sidfoten — valet kommer ihåg mellan omladdningar.",
    },
    marginalia: {
      name: "Marginalanteckningar",
      condition: "Justera redigerarens skrivkolumnmarginaler.",
      learnMore:
        "Inställningar → Redigerare smalnar av skrivkolumnen för en mer fokuserad, sidlik känsla — eller låter den löpa över skärmens fulla bredd.",
    },
    fencedIn: {
      name: "Inom staketet",
      condition: "Skriv ett kodblock med ``` i en anteckning.",
      learnMore:
        "Omslut rader med ``` så visar redigeraren dem som ett kodblock — ordagrant, utan någon Markdown-formatering inuti. Själva staketraderna döljs när blocket är stängt och kommer tillbaka så fort du placerar markören inuti det.",
    },
    quoteUnquote: {
      name: "Citat, slut citat",
      condition: "Skriv ett citat som löper över mer än en rad.",
      learnMore:
        "Tryck Enter inuti ett citat så öppnas ytterligare en citatrad, så att ett långt stycke kan skrivas i ett svep i stället för att varje rad märks upp för hand. Citatet fortsätter tills du lämnar det: tryck Citat igen för att ta bort märkningen från raden, eller placera markören på en rad som inte är ett citat.",
    },
    subPoint: {
      name: "Underpunkt",
      condition: "Lägg en listpunkt under en annan.",
      learnMore:
        "Tryck Enter på en punkt- eller nummerrad så öppnas nästa, så att en lista kan skrivas i ett svep — och Tab på en rad lägger den under raden ovanför (Skift+Tab drar ut den igen). En tom punkt avslutar listan: ett Enter drar ut en indragen punkt en nivå, nästa tömmer raden. Skift+Enter öppnar i stället ytterligare en rad inuti punkten du står på i stället för att börja en ny.",
    },
    checkedOff: {
      name: "Avbockat",
      condition: "Bocka av en kryssruta i en anteckning.",
      learnMore:
        "En listrad skriven `- [ ] mjölk` visas som en riktig kryssruta. Tryck på den så bockas punkten av direkt — markören flyttas aldrig till raden, så ingenting öppnas och inget tangentbord fälls upp på telefonen. Bockningen skrivs rakt in i Markdown som `- [x]` och följer därför med anteckningen dit den än synkas. Enter på en uppgiftsrad öppnar nästa, alltid obockad.",
    },
    plainText: {
      name: "Enkelt och rent",
      condition: "Stäng av direkt Markdown-visning.",
      learnMore:
        "Föredrar du ren text? Inställningar → Redigerare stänger av direktförhandsvisningen så att anteckningar förblir vanlig, oformaterad källtext.",
    },
    countTheLines: {
      name: "Räkna raderna",
      condition: "Slå på radnummer i redigeraren.",
      learnMore:
        "Inställningar → Redigerare numrerar varje rad längs vänsterkanten, som i en kodredigerare. Tryck på ett nummer för att markera hela raden — redo att klippa ut, ersätta eller formatera om.",
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
    appendix: {
      name: "Appendix",
      condition: "Visa bilagor i slutet av anteckningen.",
      learnMore:
        "Inställningar → Redigerare kan samla en anteckningas bilder och filer i ett block längst ned i anteckningen istället för att visa dem inline där du klistrade in dem — praktiskt när bilagorna är referenser snarare än en del av flödet. Bilder och filer växlas oberoende av varandra.",
    },
    shortAndSweet: {
      name: "Kort och gott",
      condition: "Slå på länkförkortning.",
      learnMore:
        "Inställningar → Redigerare kortar ned långa inklistrade URL:er i förhandsvisningen till domänen plus några tecken på var sida om en [...]-markör, så att en spårningslänk inte längre breder ut sig över anteckningen. Hela länken sparas och öppnas fortfarande när du klickar — bara visningen förkortas.",
    },
    nowPlaying: {
      name: "På spelning",
      condition: "Lägg in en YouTube-länk i en anteckning.",
      learnMore:
        "En YouTube-länk du klistrar in i en anteckning blir en spelare precis där den står — alla länkformer fungerar (youtu.be, /shorts/, mobilsajten, en embed-adress), och spårningsparametrarna som följer med trimmas bort. Ingenting hämtas från YouTube förrän du trycker på play; knappen i spelarens hörn lyfter upp den i bredbild över en suddad anteckning, och lägger tillbaka den utan att du tappar din plats i videon.",
    },
    archivist: {
      name: "Arkivarie",
      condition: "Arkivera en anteckning.",
      learnMore:
        "Svep en anteckning åt höger i översikten för att arkivera den — eller högerklicka på den på en dator — så lämnar den listan utan att tas bort. Hitta arkiverade anteckningar under Arkiv i sidomenyn, där du kan återställa eller ta bort dem permanent.",
    },
    compartments: {
      name: "Fack",
      condition: "Skapa en andra namnrymd.",
      learnMore:
        "Namnrymder är separata, fristående uppsättningar anteckningar — jobb och hem, till exempel. Växla mellan dem från sidomenyn; var och en kan synka till sin egen mapp.",
    },
    organizer: {
      name: "Arkiveringssystem",
      condition: "Skapa en mapp för att gruppera anteckningar.",
      learnMore:
        "Mappar grupperar anteckningar inuti en namnrymd — en ”Inloggningsfunktion”, en ”Semester 2025”. Tryck på mappknappen vid Anteckningar-rubriken i sidomenyn för att skapa en, och dra sedan anteckningar till den för att lägga undan dem. En mapp kan fällas ut för att skapa en ny anteckning direkt i den.",
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
    rightClick: {
      name: "Kontextväxling",
      condition: "Öppna en antecknings högerklicksmeny.",
      learnMore:
        "På en dator kan du högerklicka på en anteckning — i översikten eller sidomenyn — för en snabb meny med dess åtgärder: arkivera (eller återställ från Arkiv-vyn) och ta bort. Det är datormotsvarigheten till svepgesterna du använder på en pekskärm.",
    },
    copycat: {
      name: "Kopiekatt",
      condition: "Kopiera en anteckning till urklipp.",
      learnMore:
        "”Kopiera till urklipp” i en antecknings exportmeny — uppåtpilen i sidhuvudet — lägger den öppna anteckningen på urklipp. Inställningar → Redigerare väljer hur mycket som tas med — bara brödtexten, titel och brödtext, eller hela .md-filen med dess YAML-frontmatter.",
    },
    printPress: {
      name: "Tryckpress",
      condition: "Exportera en anteckning till PDF.",
      learnMore:
        "Uppåtpilen i en antecknings sidhuvud exporterar den. ”Exportera till PDF” sätter anteckningen som ett dokument — rubriker, listor, citat och kodblock — och lämnar den till enhetens utskriftsdialog, där ”Spara som PDF” skriver filen. Inställningar → Export styr hur sidan ser ut: pappersstorlek och marginaler, typsnitten och deras storlekar, den fasta breddsteg-familjen och bakgrunden bakom kod, samt punkttecknet.",
    },
    takeaway: {
      name: "Avhämtning",
      condition: "Exportera en anteckning som en Markdown-fil.",
      learnMore:
        "”Exportera till MD” i samma meny laddar ner anteckningen som en vanlig .md-fil — byte för byte samma fil som mapp- och molnlagringen skriver, med YAML-frontmatter — så den öppnas i vilken Markdown-app som helst och kommer tillbaka till notes oförändrad.",
    },
    snippetSnatcher: {
      name: "Kodsnattare",
      condition: "Kopiera ett kodblock med dess kopieringsknapp.",
      learnMore:
        "Varje stängt kodblock har en liten kopieringsknapp uppe till höger. Ett tryck lägger koden — allt mellan ```-staketen, och inget annat — på urklipp, utan att du behöver placera markören i anteckningen eller markera en enda rad för hand.",
    },
    seeker: {
      name: "Sökare",
      condition: "Sök bland dina anteckningar.",
      learnMore:
        "Förstoringsglaset på sidomenyns åtgärdsrad söker igenom varje antecknings titel och brödtext på en gång. Den är vanlig text och luddig som standard — skriv en grov förkortning så hittar den ändå anteckningen — och tar även jokertecken (recipe*, dr?ft) eller ett /regex/. På krypterade lagringsbackender söker den i samma förhandsvisning som anteckningsindexet redan har, så den fungerar utan att låsa upp varje anteckning.",
    },
    whereYouLeftOff: {
      name: "Precis där du var",
      condition:
        "Öppna en anteckning igen och hamna vid markören och rullningen du lämnade.",
      learnMore:
        "Så länge appen är öppen kommer den ihåg var markören satt och hur långt du rullat i varje anteckning, så att hoppa mellan anteckningar tar dig tillbaka precis dit du var — samma rad, samma plats på skärmen — i stället för till toppen. På en telefon kommer tangentbordet upp igen med markören redan på plats. Det gäller per session: en ny omladdning börjar varje anteckning på nytt.",
    },
    retrace: {
      name: "Tillbakaspårning",
      condition:
        "Använd webbläsarens bakåtknapp för att gå till en anteckning.",
      learnMore:
        "Varje förflyttning du gör — att öppna en anteckning, hoppa till en annan, kliva in i arkivet — lämnar ett steg i webbläsarens historik, så bakåtknappen tar dig genom anteckningarna du besökt (och framåtknappen tillbaka ut igen). Det fungerar med bakåtknappen, tangentbordsgenvägen och Androids bakåtgest.",
    },
    deepLink: {
      name: "Direktlänk",
      condition: "Öppna en länk som går rakt till en anteckning.",
      learnMore:
        "Anteckningen du har öppen har en egen adress — kopiera den från adressfältet, eller högerklicka på en anteckning och välj ”Kopiera länk”, så öppnas exakt den anteckningen igen senare, från ett bokmärke, en kalenderpost eller ett meddelande till dig själv. Länken bär även namnrymden, så att följa en växlar till rätt namnrymd först; en länk till en namnrymd som den här enheten inte har landar helt enkelt i översikten. Adressen ligger efter # och skickas därför aldrig till någon server, och den fungerar bara där dina anteckningar redan finns — länken är en genväg för dig, inte ett sätt att dela en anteckning med någon annan.",
    },

    // ── Proffs ────────────────────────────────────────────────────────
    shapeshifter: {
      name: "Formskiftaren",
      condition: "Lägg till en omvandlingsregel.",
      learnMore:
        "Inställningar → Omvandling matchar en del av en anteckning med ett reguljärt uttryck och visar något annat i dess ställe: ett ärendenummer som en länk till ärendet, en bokningskod som orden den står för, ett telefonnummer med mitten maskad. Själva anteckningen ändras aldrig — sätt markören på raden för att se exakt vad du skrev, och kopiering kopierar alltid originalet.",
    },
    localDialect: {
      name: "Lokal dialekt",
      condition: "Ha omvandlingsregler i två olika namnrymder.",
      learnMore:
        "En omvandlingsregel hör till en namnrymd, så att ärendelänkarna du vill ha på jobbet aldrig skriver om inköpslistan hemma. Inställningar → Omvandling listar fortfarande alla dina regler — de som hör till dina andra namnrymder är nedtonade — och regelns ”Gäller för” vidgar tillbaka en regel till alla namnrymder när den verkligen gäller allt.",
    },
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
    selfHoster: {
      name: "Egen värd",
      condition: "Parkoppla med din egen notesd-server.",
      learnMore:
        "Kör notesd-tjänsten på din egen dator och parkoppla appen till den — dina anteckningar synkas över ditt nätverk till en server du styr, utan moln och utan konton. Anslutningen är låst till tjänstens eget certifikat. Endast tillgängligt i den installerade appen.",
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
    straggler: {
      name: "Eftersläntraren",
      condition:
        "Avgör vad som ska hända med en fil som inte är en anteckning.",
      learnMore:
        "Din anteckningsmapp är en riktig mapp som du kan skriva i, så det hamnar saker där som inte är anteckningar. Appen tar aldrig bort dem bakom ryggen på dig — den visar vad den hittat och låter dig importera, ta bort eller lämna filen i fred.",
    },
    pictureThis: {
      name: "En bild säger mer",
      condition: "Klistra in eller släpp en bild i en anteckning.",
      learnMore:
        "Med en lokal mapp eller molnbackend kan du klistra in (Ctrl/Cmd+V) eller dra en bild rakt in i redigeraren. Den sparas som en riktig bildfil i en attachments-mapp bredvid dina anteckningar och visas inline som en miniatyr du kan klicka på för att öppna i full storlek.",
    },
    paperTrail: {
      name: "Pappersspår",
      condition: "Bifoga en fil till en anteckning.",
      learnMore:
        "Med en lokal mapp eller molnbackend kan du klistra in eller dra vilken fil som helst — en PDF, ett arkiv, ett kalkylark — rakt in i redigeraren. Den sparas som en riktig fil i en attachments-mapp bredvid dina anteckningar och visas som en bricka med sin typikon som du kan klicka på för att ladda ner.",
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
    fortKnox: {
      name: "Fort Knox",
      condition: "Kryptera varje anteckning och alla dess bilagor i vila.",
      learnMore:
        "Varje anteckning blir sin egen krypterade fil och varje bilaga sin egen krypterade blob, komprimerad och med ogenomskinligt namn. Ett grönt lås fylls i anteckning för anteckning medan bakgrundsmigreringen förseglar dem — när varje anteckning är låst är du här.",
    },
    keyHandoff: {
      name: "Nyckelöverlämning",
      condition:
        "Öppna appen på en enhet efter att ha krypterat från en annan.",
      learnMore:
        "Krypteringen följer med dina anteckningar. Aktivera den på en enhet, så märker nästa enhet som synkar samma mapp de krypterade anteckningarna, låser sig själv och ber om lösenfrasen du valde — så att en enhet utan kryptering aldrig i tysthet kan ligga bredvid dina förseglade anteckningar.",
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
