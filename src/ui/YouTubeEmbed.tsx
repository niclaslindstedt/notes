import { useState, type MouseEvent as ReactMouseEvent } from "react";

import {
  youtubeEmbedSrc,
  youtubeThumbnailSrc,
  type YouTubeVideo,
} from "../domain/youtube.ts";
import { useT } from "../i18n/index.ts";
import { useEscapeKey } from "./hooks/useEscapeKey.ts";
import { MinimizeIcon, PlayIcon, WidescreenIcon } from "./icons.tsx";

// The inline video player a bare YouTube link renders as, in the live-preview
// editor and the read-only note view alike (see the `link` case in
// `MarkdownLine.tsx`). Rendered in place of the anchor once
// `youtubeVideo(href)` recognises the URL — the link's source text is
// untouched and comes back the moment the caret lands on its line.
//
// Nothing is loaded from YouTube until the video is played: the card shows the
// poster frame and only the press swaps in the player iframe (which is served
// from `youtube-nocookie.com`). That keeps the note cheap to open — a real
// embed drags in a megabyte of player code, per link — and keeps a note full
// of links from opening a session with YouTube on the reader's behalf.
//
// **Widescreen** lifts the same player out of the line: the card goes
// full-screen over a blurred backdrop, as wide as the viewport allows. It is a
// class swap on the element the iframe already lives in, deliberately *not* a
// second player rendered in an overlay — the DOM node survives the transition,
// so the video keeps playing through it instead of restarting.

type Props = {
  video: YouTubeVideo;
  /** Source column of the link node, for the editor's click-to-caret map. */
  srcOffset: number;
  /** Source length of the link, so a selection maps back over the whole URL. */
  srcLength: number;
};

export function YouTubeEmbed({ video, srcOffset, srcLength }: Props) {
  const t = useT();
  const [playing, setPlaying] = useState(false);
  const [wide, setWide] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  useEscapeKey(wide, () => setWide(false));

  // Every press inside the card must stop the editor's line-level mousedown, or
  // the caret rolls onto this line and the whole player is replaced by its raw
  // source mid-click.
  const keepCaretAway = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <span
      data-src={srcOffset}
      // The rendered player carries no text, so a selection ending inside it
      // needs the source length to map back to the end of the URL.
      data-len={srcLength}
      contentEditable={false}
      className="my-1 block"
    >
      {/* Holds the line's height while the player is lifted into widescreen,
          so the note doesn't reflow under the overlay. */}
      <span
        aria-hidden
        className={
          wide
            ? "block aspect-video w-full max-w-[36rem] rounded-[var(--radius)] border border-dashed border-line"
            : "hidden"
        }
      />
      <span
        className={
          wide
            ? "fixed inset-0 z-[95] flex items-center justify-center bg-page-bg/70 p-3 backdrop-blur-md sm:p-8"
            : "block"
        }
      >
        {/* A full-bleed button behind the player is the backdrop: a click (or
            tab+Enter) anywhere around the video puts it back in the note, with
            no click handler on a non-interactive element. Rendered in its own
            child slot so toggling it never shifts the player's position among
            its siblings — React would remount the iframe and restart the
            video. */}
        {wide && (
          <button
            type="button"
            aria-label={t("common.close")}
            onMouseDown={keepCaretAway}
            onClick={(e) => {
              keepCaretAway(e);
              setWide(false);
            }}
            className="absolute inset-0 cursor-zoom-out bg-transparent"
          />
        )}
        <span
          className={
            wide
              ? // As wide as the screen allows, but never so tall that the
                // 16:9 box runs into the edges — the second term is the width
                // at which the height still leaves the backdrop showing above
                // and below, which is what says "the note is still there".
                "relative block w-full max-w-[min(80rem,calc((100vh_-_5rem)*16/9))]"
              : "block max-w-[36rem]"
          }
        >
          <span className="relative block aspect-video w-full overflow-hidden rounded-[var(--radius)] border border-line bg-black">
            {playing ? (
              <iframe
                src={youtubeEmbedSrc(video, { autoplay: true })}
                title={t("app.youtube.player")}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                className="absolute inset-0 h-full w-full border-0"
              />
            ) : (
              <button
                type="button"
                title={t("app.youtube.play")}
                aria-label={t("app.youtube.play")}
                onMouseDown={keepCaretAway}
                onClick={(e) => {
                  keepCaretAway(e);
                  setPlaying(true);
                }}
                className="group absolute inset-0 flex h-full w-full cursor-pointer items-center justify-center focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
              >
                {!posterFailed && (
                  // `hqdefault` is 4:3 with letterbox bars; cropping it to the
                  // card's 16:9 box takes exactly those bars back off.
                  <img
                    src={youtubeThumbnailSrc(video)}
                    alt=""
                    aria-hidden
                    draggable={false}
                    referrerPolicy="no-referrer"
                    onError={() => setPosterFailed(true)}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white shadow-lg transition group-hover:bg-accent group-hover:text-page-bg">
                  <PlayIcon className="ml-0.5 h-7 w-7" />
                </span>
              </button>
            )}
            <button
              type="button"
              title={
                wide
                  ? t("app.youtube.exitWidescreen")
                  : t("app.youtube.widescreen")
              }
              aria-label={
                wide
                  ? t("app.youtube.exitWidescreen")
                  : t("app.youtube.widescreen")
              }
              aria-pressed={wide}
              onMouseDown={keepCaretAway}
              onClick={(e) => {
                keepCaretAway(e);
                // Going wide is a "watch this now" gesture, so it starts the
                // video as well when it hasn't been played yet.
                if (!wide) setPlaying(true);
                setWide((w) => !w);
              }}
              className="absolute top-2 right-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--radius)] bg-black/60 text-white transition hover:bg-accent hover:text-page-bg focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
            >
              {wide ? (
                <MinimizeIcon className="h-4 w-4" />
              ) : (
                <WidescreenIcon className="h-4 w-4" />
              )}
            </button>
          </span>
        </span>
      </span>
    </span>
  );
}
