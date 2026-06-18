// In-memory pub/sub for manual achievement unlocks.
//
// Most achievements derive from a note / appearance transition and never
// touch this file. The remainder — folder/cloud connect, encryption,
// namespace create, install, undo, reload from backend, conflict resolve —
// fire from outside that state. Those callers invoke `unlock(id)`, which
// queues the id here; the watcher mounted in App subscribes, drains the queue
// on each notification, and records the unlock through the appearance store.
// The queue survives across-component-tree dispatches but does NOT persist
// across page reloads — a manual unlock must be fired by a still-mounted
// surface that observes the user's action.
//
// Why an in-memory bus instead of a context? Callers like `useStorageBackend`
// and the side menu's undo run before — and outside the subtree of — the
// watcher. A bus decouples timing: anyone can unlock at any moment; the
// watcher catches up when it's ready.

const pending = new Set<string>();
const listeners = new Set<() => void>();

export function unlock(id: string): void {
  if (id === "") return;
  if (pending.has(id)) return;
  pending.add(id);
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Called by the watcher to consume queued ids in one shot. Returns the
// snapshot and empties the queue. Avoids the listener-during-dispatch race by
// handing back a stable array.
export function drain(): string[] {
  if (pending.size === 0) return [];
  const ids = [...pending];
  pending.clear();
  return ids;
}

// Test-only escape hatch — tests instantiate fresh watchers and would
// otherwise see leftover ids from prior cases.
export function resetBus(): void {
  pending.clear();
  listeners.clear();
}
