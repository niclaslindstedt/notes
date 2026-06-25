import { useEffect, useId, useMemo, useRef, useState } from "react";

import { unlock } from "../achievements/index.ts";
import { noteTitle, type Snapshot } from "../domain/note.ts";
import {
  buildSearchIndex,
  search,
  segmentMatches,
  type MatchRange,
  type NoteResult,
} from "../domain/search.ts";
import { useT } from "../i18n/index.ts";
import { ChevronRightIcon, CloseIcon, NoteIcon, SearchIcon } from "./icons.tsx";
import { Modal } from "./Modal.tsx";

// The search surface: a full-screen sheet on mobile, a centred card from `sm`
// up (the default `Modal` shell). It builds a flat search index over the live
// document and runs the query (substring → fuzzy, wildcards, or a /regex/) as
// the user types, grouping the hits per note and highlighting the matched
// characters in place. Picking a result opens that note in the editor and
// closes.
//
// On the encrypted file/cloud backends a note's body is deferred, so the index
// searches each note's `preview` — the same projection the note index already
// carries — which is why full-text search works without unlocking every note
// (see `domain/search.ts`).

// Note bodies can be long; show a window around the first match.
const NOTE_CLIP = 160;

/** Render text with its matched ranges wrapped in <mark>. */
function Highlighted({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  return (
    <>
      {segmentMatches(text, ranges).map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="rounded-[2px] bg-accent/30 text-fg-bright [font-weight:inherit]"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/** Clip a long body around its first match, shifting the ranges to suit. */
function clipBody(
  text: string,
  ranges: MatchRange[],
): { text: string; ranges: MatchRange[] } {
  if (text.length <= NOTE_CLIP || ranges.length === 0) {
    return { text, ranges };
  }
  const first = ranges[0]![0];
  // Centre the window on the first match, clamped to the text bounds.
  let start = Math.max(0, first - Math.floor(NOTE_CLIP / 3));
  let end = Math.min(text.length, start + NOTE_CLIP);
  start = Math.max(0, end - NOTE_CLIP);
  const lead = start > 0 ? "…" : "";
  const trail = end < text.length ? "…" : "";
  const shifted = ranges
    .filter(([s, e]) => e > start && s < end)
    .map(
      ([s, e]) =>
        [
          Math.max(0, s - start) + lead.length,
          Math.max(0, Math.min(end, e) - start) + lead.length,
        ] as MatchRange,
    );
  return { text: lead + text.slice(start, end) + trail, ranges: shifted };
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** The live document to search. */
  snapshot: Snapshot;
  /** Open the picked note in the editor. */
  onOpen: (noteId: string) => void;
};

export function SearchModal({ open, onClose, snapshot, onOpen }: Props) {
  const t = useT();
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  // The index is derived from the live document, so it stays current as the
  // user edits between searches; cheap to rebuild for the sizes this app holds.
  const index = useMemo(() => buildSearchIndex(snapshot), [snapshot]);
  const { results, invalidRegex } = useMemo(
    () => search(index, query),
    [index, query],
  );
  const trimmed = query.trim();

  // Clear any stale query each time the modal opens, so it never reopens onto
  // a previous search. Focus is owned by `Modal` via `initialFocusRef={inputRef}`
  // below: it focuses the field in a layout effect, so when the open is
  // dispatched inside `flushSync` from the tap (see `SideMenu`) the focus lands
  // within that gesture and iOS raises the soft keyboard.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  // Searching is the gesture the "Seeker" trophy watches for. The unlock bus
  // dedupes, so firing on every keystroke records it only once.
  useEffect(() => {
    if (trimmed) unlock("seeker");
  }, [trimmed]);

  function go(noteId: string) {
    onOpen(noteId);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={headingId}
      initialFocusRef={inputRef}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-3 px-3 py-2">
        <span className="pl-1 text-muted">
          <SearchIcon className="h-5 w-5" />
        </span>
        <h2 id={headingId} className="sr-only">
          {t("search.title")}
        </h2>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          aria-label={t("search.title")}
          className="min-w-0 flex-1 border-0 bg-transparent py-1 text-base text-fg-bright outline-none placeholder:text-muted/70 [appearance:none] [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label={t("search.clear")}
            title={t("search.clear")}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg-bright"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="-mr-1 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg-bright"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
        {!trimmed ? (
          <div className="px-6 py-10 text-center text-sm text-muted">
            <SearchIcon className="mx-auto mb-3 h-8 w-8 opacity-40" />
            <p>{t("search.prompt")}</p>
            <p className="mx-auto mt-2 max-w-sm text-xs text-muted/80">
              {t("search.hint")}
            </p>
          </div>
        ) : invalidRegex ? (
          <Empty message={t("search.invalidRegex")} />
        ) : results.length === 0 ? (
          <Empty message={t("search.noResults", { query: trimmed })} />
        ) : (
          <>
            <p className="px-4 pt-3 pb-1 text-xs tracking-wide text-muted uppercase">
              {results.length === 1
                ? t("search.matchesOne")
                : t("search.matchesOther", { n: String(results.length) })}
            </p>
            <ul className="m-0 list-none p-0 pb-[env(safe-area-inset-bottom)]">
              {results.map((r) => (
                <ResultRow
                  key={r.noteId}
                  result={r}
                  onSelect={() => go(r.noteId)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="px-6 py-10 text-center text-sm text-muted">{message}</p>;
}

// One note's result: its title (highlighted if matched, else the untitled
// fallback) with, beneath it, a clipped window of the body around the first
// body match. The whole row opens the note in the editor.
function ResultRow({
  result,
  onSelect,
}: {
  result: NoteResult;
  onSelect: () => void;
}) {
  const body = result.body
    ? clipBody(result.body.text, result.body.ranges)
    : null;
  // The same "Untitled note" fallback the note list shows for a never-titled
  // note; `noteTitle` only reads `.title`, so a minimal note resolves it.
  const untitled = noteTitle({
    id: result.noteId,
    title: result.title,
    createdAt: 0,
    updatedAt: 0,
  });
  return (
    <li className="border-b border-line">
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full cursor-pointer items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-2"
      >
        <span className="mt-0.5 shrink-0 text-accent">
          <NoteIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg-bright">
            {result.titleRanges ? (
              <Highlighted text={result.title} ranges={result.titleRanges} />
            ) : (
              untitled
            )}
          </span>
          {body && (
            <span className="mt-0.5 line-clamp-2 text-xs text-muted">
              <Highlighted text={body.text} ranges={body.ranges} />
            </span>
          )}
        </span>
        <ChevronRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      </button>
    </li>
  );
}
