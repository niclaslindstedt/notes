// The "stop asking about this file" list behind the orphan-files prompt.
//
// An orphan is a file in the notes folder that a load couldn't match to a note
// (see `OrphanFile` in `./adapter.ts`). Most are a one-off decision — adopt it
// or delete it — but some are permanent residents: a `README.md` the user keeps
// beside their notes, a file another tool owns and rewrites. Those need a third
// answer that sticks, or the prompt becomes a nag on every load and the user
// learns to dismiss it without reading — exactly the habit that would let a real
// stray file slip past.
//
// Deliberately **device-local** (`localStorage`), not part of the synced
// appearance store: "don't bother *me* about this" is a per-device preference,
// and syncing it would mean one device silencing a file the others have never
// shown their user. It is keyed per backend + namespace so ignoring a file in
// one synced folder doesn't silence a same-named file in another.

const PREFIX = "notes:orphans:ignored";

/** Storage key for one backend + namespace pair. */
export function orphanIgnoreKey(backendId: string, namespace: string): string {
  return `${PREFIX}:${backendId}:${namespace}`;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeStorage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage can throw on access alone (Safari private browsing, a blocked
    // third-party context). Ignoring is then simply not persisted.
    return null;
  }
}

/** The paths currently ignored for this backend + namespace. */
export function readIgnoredOrphans(
  backendId: string,
  namespace: string,
  storage: Store | null = safeStorage(),
): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(orphanIgnoreKey(backendId, namespace));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((p): p is string => typeof p === "string"));
  } catch {
    // A corrupt list must not break the load; an empty one just means the
    // prompt asks again, which is the safe direction to fail in.
    return new Set();
  }
}

/** Add `path` to the ignore list, returning the updated set. */
export function ignoreOrphanPath(
  backendId: string,
  namespace: string,
  path: string,
  storage: Store | null = safeStorage(),
): Set<string> {
  const next = readIgnoredOrphans(backendId, namespace, storage);
  next.add(path);
  if (storage) {
    try {
      storage.setItem(
        orphanIgnoreKey(backendId, namespace),
        JSON.stringify([...next]),
      );
    } catch {
      // Out of quota or storage blocked — the file stays ignored for this
      // session only. Not worth failing the user's click over.
    }
  }
  return next;
}

/**
 * Drop `path` from the ignore list — used when the file is adopted or deleted,
 * so a *new* file that later lands on the same path is flagged again rather
 * than being silently covered by a stale entry.
 */
export function forgetOrphanPath(
  backendId: string,
  namespace: string,
  path: string,
  storage: Store | null = safeStorage(),
): Set<string> {
  const next = readIgnoredOrphans(backendId, namespace, storage);
  if (!next.delete(path)) return next;
  if (storage) {
    try {
      const key = orphanIgnoreKey(backendId, namespace);
      if (next.size === 0) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify([...next]));
    } catch {
      // See above — best-effort.
    }
  }
  return next;
}
