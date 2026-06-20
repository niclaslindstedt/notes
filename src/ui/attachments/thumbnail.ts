// Thumbnail generation for attached images. A pasted/dropped image is stored
// at full size (the file the user opens on click), but the inline preview in
// the note body renders a small, downscaled copy so a note with many images
// stays light to render and scroll. The thumbnail is generated on paste — and
// regenerated lazily on first view after a reload — via a canvas, then cached
// in memory keyed by the attachment's (stable, unique) filename so it's
// computed at most once per session.
//
// DOM-bound (canvas, Image), so it lives in `ui/`, never in `domain/` or
// `storage/`.

import { useEffect, useState } from "react";

// Longest edge of a generated thumbnail, in CSS pixels (×DPR headroom). Big
// enough to look crisp in the ~160px inline box, small enough to keep the
// decoded bitmap cheap.
const MAX_EDGE = 320;

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("thumbnail: image failed to load"));
    img.src = dataUrl;
  });
}

async function render(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  // iOS Safari can fire `onload` before the bitmap is actually decoded and
  // ready to paint — drawing it then yields a blank (black) canvas. This bites
  // hardest when a second large image is pasted while the first is still being
  // processed: the draw races its own decode and the thumbnail comes out solid
  // black. Awaiting `decode()` guarantees the pixels are there before we draw.
  if (typeof img.decode === "function") {
    try {
      await img.decode();
    } catch {
      // Some browsers reject `decode()` on an already-complete image; it loaded
      // fine via `onload`, so fall through and draw it anyway.
    }
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  // No 2D context (rare) — fall back to the full image.
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  try {
    // JPEG keeps the thumbnail small; alpha is irrelevant at preview size.
    const out = canvas.toDataURL("image/jpeg", 0.72);
    // Release the backing store so iOS reclaims canvas memory between pastes.
    canvas.width = canvas.height = 0;
    return out;
  } catch {
    // Tainted canvas / encoder refusal — fall back to the full image.
    return dataUrl;
  }
}

/**
 * Generate (or fetch the cached) thumbnail for an attachment. Coalesces
 * concurrent requests for the same filename so a paste-then-render doesn't
 * decode the image twice.
 */
export function getThumbnail(
  filename: string,
  dataUrl: string,
): Promise<string> {
  const hit = cache.get(filename);
  if (hit) return Promise.resolve(hit);
  const pending = inFlight.get(filename);
  if (pending) return pending;
  const promise = render(dataUrl)
    .then((thumb) => {
      cache.set(filename, thumb);
      inFlight.delete(filename);
      return thumb;
    })
    .catch((err: unknown) => {
      inFlight.delete(filename);
      throw err;
    });
  inFlight.set(filename, promise);
  return promise;
}

/** Pre-warm the thumbnail cache (called when an image is pasted/dropped). */
export function warmThumbnail(filename: string, dataUrl: string): void {
  void getThumbnail(filename, dataUrl).catch(() => {});
}

/**
 * The thumbnail for an attachment, or null until it's generated. Falls back to
 * the full image if generation fails, so a preview always renders something.
 */
export function useThumbnail(filename: string, dataUrl: string): string | null {
  const [thumb, setThumb] = useState<string | null>(
    () => cache.get(filename) ?? null,
  );
  useEffect(() => {
    let cancelled = false;
    const hit = cache.get(filename);
    if (hit) {
      setThumb(hit);
      return;
    }
    getThumbnail(filename, dataUrl)
      .then((t) => {
        if (!cancelled) setThumb(t);
      })
      .catch(() => {
        if (!cancelled) setThumb(dataUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [filename, dataUrl]);
  return thumb;
}
