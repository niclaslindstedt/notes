import type { NamespaceCatalog } from "../en/namespace.ts";

const namespace: NamespaceCatalog = {
  heading: "Namnrymder",
  blurb:
    "En namnrymd är en fristående grupp av anteckningar. Växla mellan dem för att hålla till exempel personliga och delade anteckningar åtskilda. Varje namnrymd kan ha sin egen ikon och färg.",
  newLabel: "Ny namnrymd",
  nameLabel: "Namn på namnrymd",
  namePlaceholder: "t.ex. Jobb, Familj",
  colorLabel: "Färg",
  glyphLabel: "Ikon",
  switchTo: "Byt till {name}",
  rename: "Byt namn",
  deleteAction: "Ta bort namnrymd",
  deleteConfirm:
    "Ta bort ”{name}” och alla dess anteckningar? Detta går inte att ångra.",
  nameRequired: "Ett namn krävs",
  defaultBadge: "Standard",
  noIcon: "Ingen ikon",
  newColorPrefix: "Ny namnrymd färg",
  newGlyphNone: "Ny namnrymd, ingen ikon",
  newGlyphPrefix: "Ny namnrymd ikon",
  switchTitle: "Öppna en annan namnrymd",
  switchHint: "Andra namnrymder påverkas inte — öppna en av dem i stället.",
  stillLocked: "Låst",

  pinTitle: "PIN-kod",
  pinHint:
    "Fråga efter en kort kod innan den här namnrymden öppnas. Koden följer med namnrymden, så varje enhet — och alla du delar den med — får frågan.",
  pinSoftWarning:
    "En PIN-kod är en lätt spärr: den stoppar en feltryckning eller en lånad telefon, men anteckningarna lagras fortfarande i klartext och alla som delar kontot kan angripa koden offline. Slå på kryptering för sådant som verkligen behöver skyddas.",
  pinSet: "Ange en PIN-kod",
  pinChange: "Byt PIN-kod",
  pinRemove: "Ta bort PIN-kod",
  pinOn: "Den här namnrymden frågar efter en PIN-kod",
  pinOff: "Den här namnrymden har ingen PIN-kod",
  pinLabel: "PIN-kod",
  pinCurrentLabel: "Nuvarande PIN-kod",
  pinConfirmLabel: "Bekräfta PIN-kod",
  pinTooShort: "Använd en PIN-kod med minst {min} tecken.",
  pinMismatch: "PIN-koderna stämmer inte överens.",
  pinWrong: "PIN-koden fungerade inte.",
  pinGateTitle: "”{namespace}” kräver en PIN-kod",
  pinGateHint: "Ange namnrymdens PIN-kod för att öppna den på den här enheten.",
  pinGateSubmit: "Öppna",
};

export default namespace;
