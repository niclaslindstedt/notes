// Recognising YouTube links in a note. Pure string work — no DOM, no I/O — so
// it stays in `domain/` and is cheap to unit-test. The live-preview editor
// renders a bare YouTube URL as an inline player (`src/ui/YouTubeEmbed.tsx`)
// instead of an anchor, which needs exactly two things out of a URL: the video
// id, and the timestamp it should open at.
//
// Everything else a shared link drags along — the mobile host, tracking and
// attribution parameters (`si`, `pp`, `feature`, `ab_channel`, `ra`, …), the
// playlist it was watched from, the trailing slash — is **trimmed**, because
// none of it changes which video plays. That is the whole point of parsing
// rather than pattern-matching: the URL is reduced to its meaning, and the
// player is rebuilt from that.

/** A YouTube video reference: the 11-character id, plus where to start. */
export type YouTubeVideo = {
  id: string;
  /** Start offset in whole seconds, when the link carried one. */
  start?: number;
};

// Every YouTube video id is exactly eleven URL-safe characters. Requiring the
// full shape keeps a `?v=` that holds something else (a search string, an
// encoded redirect) from rendering a player that would never load.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Path prefixes that carry the id as the next segment: `/embed/<id>`,
// `/shorts/<id>`, `/live/<id>`, the legacy `/v/<id>` and `/e/<id>`, and the
// `/watch/<id>` form some share sheets produce.
const PATH_FORMS = new Set(["embed", "shorts", "live", "v", "e", "watch"]);

/** Whether `host` is a YouTube watch host (any subdomain: `m.`, `music.`, …). */
function isYouTubeHost(host: string): boolean {
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  );
}

/**
 * The video `url` points at, or null when it isn't a single-video YouTube
 * link. Accepts every shape a share sheet, a browser address bar, or a mobile
 * app hands out — `youtube.com/watch?v=…`, `m.` / `music.` subdomains,
 * `youtu.be/…`, `/shorts/…`, `/live/…`, `/embed/…`, the legacy `/v/…`, and
 * `youtube-nocookie.com` — with or without a scheme, and with any number of
 * irrelevant query parameters, which are dropped.
 */
export function youtubeVideo(url: string): YouTubeVideo | null {
  const raw = url.trim();
  if (raw === "") return null;
  // A bare URL may be autolinked as `www.youtube.com/…` with no scheme; give
  // the parser one so it resolves as absolute rather than as a relative path.
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const host = parsed.hostname.toLowerCase();
  const start = startSeconds(parsed);
  const segments = parsed.pathname.split("/").filter((s) => s !== "");

  // `youtu.be/<id>` — the whole path is the id.
  if (host === "youtu.be" || host.endsWith(".youtu.be")) {
    return asVideo(segments[0], start);
  }
  if (!isYouTubeHost(host)) return null;

  // `/watch?v=<id>` — the canonical form, and the one every tracking parameter
  // rides along with.
  const param = parsed.searchParams.get("v");
  if (param !== null) return asVideo(param, start);

  const [form, id] = segments;
  if (form !== undefined && id !== undefined && PATH_FORMS.has(form)) {
    return asVideo(id, start);
  }
  return null;
}

/** Whether `url` is a link to a single YouTube video. */
export function isYouTubeUrl(url: string): boolean {
  return youtubeVideo(url) !== null;
}

// A candidate id (possibly percent-encoded, possibly junk) plus a start offset,
// as a `YouTubeVideo` — or null when the id isn't one.
function asVideo(id: string | undefined, start?: number): YouTubeVideo | null {
  if (id === undefined) return null;
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // A stray `%` that isn't an escape — keep the raw text and let `ID_RE` rule.
  }
  // `/embed/videoseries?list=…` plays a playlist, not a video — and its
  // sentinel happens to be eleven id-shaped characters, so it needs saying.
  if (decoded === "videoseries") return null;
  if (!ID_RE.test(decoded)) return null;
  return start === undefined ? { id: decoded } : { id: decoded, start };
}

/**
 * The start offset a link asks for, in whole seconds: `?t=` (the share-sheet
 * "start at" parameter, either a plain second count or a `1h2m3s` duration),
 * `?start=` (the embed parameter), or the legacy `#t=` fragment. Undefined
 * when absent or unparseable — a bad offset just starts the video at zero.
 */
function startSeconds(url: URL): number | undefined {
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const raw =
    url.searchParams.get("t") ??
    url.searchParams.get("start") ??
    fragment.get("t") ??
    null;
  if (raw === null) return undefined;
  if (/^\d+$/.test(raw)) {
    const seconds = Number.parseInt(raw, 10);
    return seconds > 0 ? seconds : undefined;
  }
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(raw);
  if (!parts || (!parts[1] && !parts[2] && !parts[3])) return undefined;
  const total =
    Number.parseInt(parts[1] ?? "0", 10) * 3600 +
    Number.parseInt(parts[2] ?? "0", 10) * 60 +
    Number.parseInt(parts[3] ?? "0", 10);
  return total > 0 ? total : undefined;
}

/**
 * The player URL for `video`, rebuilt from the id and the start offset alone —
 * every parameter the original link carried is gone.
 *
 * Served from `youtube-nocookie.com`, YouTube's privacy-enhanced host, so
 * watching a video from a note doesn't plant advertising cookies. `rel=0`
 * keeps the end-of-video suggestions to the same channel and `playsinline=1`
 * keeps a phone playing the video in place instead of hijacking the screen.
 */
export function youtubeEmbedSrc(
  video: YouTubeVideo,
  { autoplay = false }: { autoplay?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (autoplay) params.set("autoplay", "1");
  if (video.start !== undefined) params.set("start", String(video.start));
  params.set("rel", "0");
  params.set("playsinline", "1");
  return `https://www.youtube-nocookie.com/embed/${video.id}?${params.toString()}`;
}

/**
 * The poster frame for a video. `hqdefault` is the one size YouTube generates
 * for every video (a `maxresdefault` is missing on plenty of them), and it is
 * 4:3 with letterbox bars the player crops back off — see `YouTubeEmbed`.
 */
export function youtubeThumbnailSrc(video: YouTubeVideo): string {
  return `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
}

/** The canonical watch URL, for the "open on YouTube" way out of the player. */
export function youtubeWatchUrl(video: YouTubeVideo): string {
  const suffix = video.start !== undefined ? `&t=${video.start}` : "";
  return `https://www.youtube.com/watch?v=${video.id}${suffix}`;
}

// URL-shaped runs in a body of text — the same bare-URL shapes the Markdown
// parser autolinks, without the punctuation-trimming nicety (a trailing `.`
// or `)` can't turn a YouTube link into something else).
const URL_RUN_RE = /(?:https?:\/\/|www\.)[^\s<>()[\]]+/gi;

/**
 * Whether `body` holds at least one YouTube link. A regex sweep rather than a
 * full `parseInline` pass, so the achievement watcher can run it over every
 * note on each edit without building nodes it throws away.
 */
export function hasYouTubeLink(body: string): boolean {
  for (const match of body.matchAll(URL_RUN_RE)) {
    if (youtubeVideo(match[0]) !== null) return true;
  }
  return false;
}
