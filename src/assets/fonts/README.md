# PDF export fonts

The [PDF export](../../ui/export/pdf-document.ts) sets a note in the PDF
standard fonts — Helvetica, Times and Courier, which every reader already has,
cost nothing to embed, and cover Latin-1 only. These three files are what it
reaches for when that isn't enough:

- `dejavu-sans-subset.ttf` / `dejavu-sans-bold-subset.ttf` — the **Unicode
  fallback**, used for runs the standard fonts cannot encode: Greek, Cyrillic,
  arrows, maths, the odd symbol.
- `dejavu-mono-subset.ttf` — **DejaVu Sans Mono**, the second choice in the
  code-font setting, for someone who doesn't want Courier's thin, dated code
  blocks.

None of them is loaded with the app. The export fetches a file the first time a
note actually needs it, so a Latin-1 note set in Courier never downloads a byte.
jsPDF subsets whatever it embeds, so an exported PDF carries only the handful of
glyphs it used, not the whole file.

## Provenance

Subset from Debian's `fonts-dejavu-core` 2.37 (`/usr/share/fonts/truetype/dejavu/`)
with [fontTools](https://github.com/fonttools/fonttools):

```sh
U="U+0020-00FF,U+0100-024F,U+0370-03FF,U+0400-052F,U+2000-206F,U+20A0-20BF,\
U+2116,U+2122,U+2126,U+212E,U+2190-2199,U+21A9,U+21AA,U+2202,U+2206,U+220F,\
U+2211-2212,U+221A,U+221E,U+2248,U+2260-2265,U+25A0-25A1,U+25AA,U+25AB,U+25B2,\
U+25B6,U+25BC,U+25C0,U+25CB,U+25CF,U+25E6,U+2605,U+2606,U+2610-2612,U+2660-2667,\
U+2690,U+2691,U+26A0,U+2713-2718,U+2726,U+2727,U+274C,U+2794,U+FFFD"

python3 -m fontTools.subset DejaVuSans.ttf \
  --unicodes="$U" --layout-features="" --no-hinting \
  --drop-tables+=DSIG --output-file=dejavu-sans-subset.ttf
```

…and the same command against `DejaVuSans-Bold.ttf`. Regenerating is a one-off
maintenance job, not part of any build: the files are committed, and CI never
needs fontTools.

The ranges are the ones a note plausibly carries beyond Latin-1. **CJK and emoji
are deliberately out** — covering them means megabytes, not kilobytes, and this
file is fetched on a phone. Text outside both the standard fonts and this subset
exports as `�`; see `docs/overview.md#pdf-fallback-font`.

List markers, checkboxes and rules are drawn as vectors by the layout engine
rather than set as glyphs, so the fallback is never needed just to print a
bullet.

## Licence

DejaVu Sans is Bitstream Vera-derived; the full licence is in
[`LICENSE-DejaVu.txt`](LICENSE-DejaVu.txt). It permits modification (including
subsetting) provided the font is not renamed to something containing
"Bitstream" or "Vera", which "DejaVu Sans" is not — the subsets keep their
upstream family name.
