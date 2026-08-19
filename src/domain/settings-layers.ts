// The layered-configuration algebra: a small, dependency-free set of pure
// functions over sparse JSON documents that stack on top of one another.
//
// The app's preferences are written at three widths — **global** (everyone on
// the account), **namespace** (everyone using that bucket of notes), and
// **device** (this install only) — and the value that actually applies is the
// narrowest one that has an opinion. That only works if each layer is
// *sparse*: it records the leaves it has an opinion about and nothing else. A
// layer holding a whole document would shadow every wider layer wholesale, so
// "save this one toggle to my device" would silently freeze every other
// setting at whatever it happened to resolve to.
//
// So the vocabulary here is deliberately leaf-shaped:
//   - a **leaf** is a non-object value at a dotted path (`editor.wordWrap`,
//     `customTheme.colors.accent`),
//   - `mergeLayers` stacks sparse layers leaf by leaf,
//   - `changedPaths` names the leaves two documents disagree about, which is
//     what "the settings the user actually touched" reduces to,
//   - `setPath` / `deletePath` write one leaf without disturbing its siblings,
//     pruning the branches a delete empties so an untouched layer stays
//     genuinely empty (and `isEmptyLayer` can answer "does this scope hold
//     anything?" for the Reset menu).
//
// Everything is immutable and JSON-shaped: no class, no DOM, no I/O. The
// appearance-specific bindings — which scopes exist, which keys opt out of
// scoping — live in `src/theme/appearance-scopes.ts`.

/** A sparse configuration layer: a plain JSON object, possibly nested. */
export type Layer = Record<string, unknown>;

/** A dotted path to a leaf, e.g. `editor.wordWrap`. */
export type LeafPath = string;

/**
 * Whether a value is a plain object the algebra should descend into. Arrays
 * are values, not branches — no scoped setting is an array today, and
 * merging two arrays leaf-by-leaf would be meaningless anyway.
 */
function isBranch(value: unknown): value is Layer {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality for JSON values, used to spot a leaf that didn't move. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (!isBranch(a) || !isBranch(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!jsonEqual(a[k], b[k])) return false;
  return true;
}

/**
 * Stack sparse layers left to right: a later layer's leaf wins, and a branch
 * present in both is merged rather than replaced. The inputs are never
 * mutated.
 */
export function mergeLayers(...layers: readonly Layer[]): Layer {
  const out: Layer = {};
  for (const layer of layers) mergeInto(out, layer);
  return out;
}

function mergeInto(target: Layer, source: Layer): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (isBranch(value)) {
      const existing = target[key];
      const branch: Layer = isBranch(existing) ? { ...existing } : {};
      mergeInto(branch, value);
      target[key] = branch;
      continue;
    }
    target[key] = value;
  }
}

/**
 * Every leaf path in `value`, in depth-first order. An empty branch yields no
 * path — it holds no opinion.
 */
export function leafPaths(value: Layer, prefix = ""): LeafPath[] {
  const out: LeafPath[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isBranch(child)) out.push(...leafPaths(child, path));
    else out.push(path);
  }
  return out;
}

/** Read a dotted path, or `undefined` when no layer on the way holds it. */
export function getPath(layer: Layer, path: LeafPath): unknown {
  let cursor: unknown = layer;
  for (const key of path.split(".")) {
    if (!isBranch(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

/** Whether a dotted path is present at all (as distinct from set to `undefined`). */
export function hasPath(layer: Layer, path: LeafPath): boolean {
  let cursor: unknown = layer;
  const keys = path.split(".");
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i] as string;
    if (!isBranch(cursor) || !(key in cursor)) return false;
    cursor = cursor[key];
  }
  return true;
}

/** A copy of `layer` with `path` set to `value`, creating branches as needed. */
export function setPath(layer: Layer, path: LeafPath, value: unknown): Layer {
  const [head, ...rest] = path.split(".");
  if (head === undefined) return layer;
  if (rest.length === 0) return { ...layer, [head]: value };
  const existing = layer[head];
  const branch = isBranch(existing) ? existing : {};
  return { ...layer, [head]: setPath(branch, rest.join("."), value) };
}

/**
 * A copy of `layer` with `path` removed. Branches the delete leaves empty are
 * pruned too, so a layer that has given up its last opinion reads as empty
 * rather than as a husk of `{}`s.
 */
export function deletePath(layer: Layer, path: LeafPath): Layer {
  const [head, ...rest] = path.split(".");
  if (head === undefined || !(head in layer)) return layer;
  if (rest.length === 0) {
    const next = { ...layer };
    delete next[head];
    return next;
  }
  const existing = layer[head];
  if (!isBranch(existing)) return layer;
  const pruned = deletePath(existing, rest.join("."));
  const next = { ...layer };
  if (Object.keys(pruned).length === 0) delete next[head];
  else next[head] = pruned;
  return next;
}

/** Whether a layer holds no opinion at all (no leaves anywhere in it). */
export function isEmptyLayer(layer: Layer): boolean {
  return leafPaths(layer).length === 0;
}

/**
 * The leaf paths at which `next` disagrees with `previous` — the settings the
 * user actually moved. Considers the union of both documents' leaves, so a
 * leaf that appears or disappears counts as a change.
 */
export function changedPaths(previous: Layer, next: Layer): LeafPath[] {
  const paths = new Set([...leafPaths(previous), ...leafPaths(next)]);
  return [...paths].filter(
    (path) => !jsonEqual(getPath(previous, path), getPath(next, path)),
  );
}

/** A copy of `layer` holding only the listed paths. */
export function pickPaths(layer: Layer, paths: readonly LeafPath[]): Layer {
  let out: Layer = {};
  for (const path of paths) {
    if (!hasPath(layer, path)) continue;
    out = setPath(out, path, getPath(layer, path));
  }
  return out;
}

/** A copy of `layer` with every listed path removed. */
export function omitPaths(layer: Layer, paths: readonly LeafPath[]): Layer {
  let out = layer;
  for (const path of paths) out = deletePath(out, path);
  return out;
}
