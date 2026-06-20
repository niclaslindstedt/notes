// Type icons for non-image file attachments — the small glyph shown on a file
// chip (`FileAttachment.tsx`) so the most common file kinds are recognisable
// at a glance. Like the rest of the app's icons these are inline SVGs painted
// with `currentColor` (no `lucide-react` dependency), sharing the 24×24
// stroked frame the icon set uses. `fileIconCategory` maps a filename's
// extension to one of a handful of buckets; an unknown extension falls back to
// the generic document glyph.

import { type ReactNode } from "react";

import { extensionOf } from "../../domain/attachment.ts";

type IconProps = { className?: string };

type FileIconCategory =
  | "pdf"
  | "archive"
  | "audio"
  | "video"
  | "sheet"
  | "doc"
  | "slides"
  | "code"
  | "text"
  | "generic";

// Extension → category. Kept explicit (and small) so the common cases get a
// distinct glyph and everything else reads as a plain document.
const EXT_CATEGORY: Readonly<Record<string, FileIconCategory>> = {
  pdf: "pdf",
  zip: "archive",
  gz: "archive",
  tar: "archive",
  rar: "archive",
  "7z": "archive",
  bz2: "archive",
  xz: "archive",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  m4a: "audio",
  aac: "audio",
  mp4: "video",
  webm: "video",
  mov: "video",
  mkv: "video",
  avi: "video",
  csv: "sheet",
  xls: "sheet",
  xlsx: "sheet",
  ods: "sheet",
  doc: "doc",
  docx: "doc",
  odt: "doc",
  rtf: "doc",
  ppt: "slides",
  pptx: "slides",
  odp: "slides",
  js: "code",
  ts: "code",
  tsx: "code",
  jsx: "code",
  json: "code",
  html: "code",
  css: "code",
  py: "code",
  rb: "code",
  go: "code",
  rs: "code",
  java: "code",
  c: "code",
  cpp: "code",
  sh: "code",
  yml: "code",
  yaml: "code",
  xml: "code",
  txt: "text",
  md: "text",
  markdown: "text",
};

function fileIconCategory(filename: string): FileIconCategory {
  return EXT_CATEGORY[extensionOf(filename)] ?? "generic";
}

// The folded-corner document outline every file glyph is built on.
function Page({ className, children }: IconProps & { children?: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      className={className}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      {children}
    </svg>
  );
}

/** The type icon for an attachment filename. */
export function FileTypeIcon({
  className,
  filename,
}: IconProps & { filename: string }) {
  const category = fileIconCategory(filename);
  switch (category) {
    case "pdf":
      // "PDF" baseline mark.
      return (
        <Page className={className}>
          <path d="M8.5 17v-3.2h1a1 1 0 0 1 0 2h-1" />
          <path d="M12.4 17v-3.2h.9a1.2 1.6 0 0 1 0 3.2h-.9" />
          <path d="M15.8 17v-3.2h1.6M15.8 15.4h1.2" />
        </Page>
      );
    case "archive":
      // Zip pull + teeth down the spine.
      return (
        <Page className={className}>
          <path d="M11 3v2M11 7v2M11 11v2" />
          <path d="M10 14h2v3a1 1 0 0 1-2 0Z" />
        </Page>
      );
    case "audio":
      return (
        <Page className={className}>
          <path d="M10 17v-4l4-1v4" />
          <circle cx="9" cy="17" r="1.1" />
          <circle cx="13" cy="16" r="1.1" />
        </Page>
      );
    case "video":
      return (
        <Page className={className}>
          <path d="M10 13.5v4l4-2Z" />
        </Page>
      );
    case "sheet":
      return (
        <Page className={className}>
          <path d="M8 13.5h8M8 16.5h8M11 12v6M14 12v6" />
        </Page>
      );
    case "doc":
      return (
        <Page className={className}>
          <path d="M8.5 13h6M8.5 15.5h6M8.5 18h4" />
        </Page>
      );
    case "slides":
      return (
        <Page className={className}>
          <rect x="8" y="12.5" width="8" height="5" rx="0.5" />
        </Page>
      );
    case "code":
      return (
        <Page className={className}>
          <path d="M10 13.5 8 15.5l2 2M14 13.5l2 2-2 2" />
        </Page>
      );
    case "text":
      return (
        <Page className={className}>
          <path d="M8.5 13h7M8.5 15.5h7M8.5 18h5" />
        </Page>
      );
    default:
      return <Page className={className} />;
  }
}
