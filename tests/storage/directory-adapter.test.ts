import { describe, expect, it } from "vitest";

import { createNote, editNote, type Note } from "../../src/domain/note.ts";
import { ConflictError } from "../../src/storage/adapter.ts";
import {
  BLOB_FILE_NAME,
  createDirectoryAdapter,
} from "../../src/storage/directory-adapter.ts";
import { isEncryptedEnvelope } from "../../src/storage/crypto.ts";
import type { FileEntry, FileStore } from "../../src/storage/file-store.ts";
import { noteFileStem } from "../../src/storage/markdown/codec.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

function notePath(note: Note): string {
  return `${noteFileStem(note)}.md`;
}

// In-memory FileStore: each write bumps a global counter used as the file's
// revision, so the directory adapter's aggregate-revision drift detection has
// something to move. `write` returns the new revision, mirroring the real
// backends, so the adapter builds the post-save revision without re-listing.
function memoryStore(): FileStore {
  const files = new Map<string, { text: string; rev: number }>();
  let counter = 0;
  return {
    async list(): Promise<FileEntry[]> {
      return [...files.entries()].map(([path, { rev }]) => ({
        path,
        rev: String(rev),
      }));
    },
    async read(path) {
      return files.get(path)?.text ?? null;
    },
    async write(path, text) {
      const rev = ++counter;
      files.set(path, { text, rev });
      return String(rev);
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

function adapter(store: FileStore) {
  return createDirectoryAdapter(store, { id: "folder", label: "Test" });
}

function notes(): Note[] {
  return [createNote(1), createNote(2)];
}

describe("directory adapter", () => {
  it("writes one markdown file per note and reads them back", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const snapshot = { notes: notes() };
    await a.save(serialize(snapshot));

    const paths = (await store.list()).map((e) => e.path).sort();
    expect(paths.every((p) => p.endsWith(".md"))).toBe(true);
    expect(paths).toHaveLength(2);

    const loaded = await a.load();
    expect(parse(loaded?.text).notes).toEqual(snapshot.notes);
  });

  it("deletes the file for a removed note on the next save", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const [first, second] = notes();
    await a.save(serialize({ notes: [first!, second!] }));
    await a.save(serialize({ notes: [first!] }));
    expect(await store.list()).toHaveLength(1);
  });

  it("raises ConflictError only when a note we're writing moved remotely", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const [first, second] = notes();
    const stored = await a.save(serialize({ notes: [first!, second!] }));
    // Another device edits the SAME note we're about to write.
    await store.write(
      notePath(first!),
      "---\nid: a\ncreated: 1\n---\nremote\n",
    );
    await expect(
      a.save(
        serialize({ notes: [editNote(first!, "local", 9), second!] }),
        stored.revision,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not conflict on (or delete) a note another device added", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const [first, second] = notes();
    const stored = await a.save(serialize({ notes: [first!, second!] }));
    // A note we've never seen appears in the folder. We aren't touching it.
    await store.write("intruder.md", "---\nid: z\ncreated: 1\n---\nhi\n");
    // Editing one of our own notes must succeed and leave the stranger intact.
    await expect(
      a.save(
        serialize({ notes: [editNote(first!, "edited", 9), second!] }),
        stored.revision,
      ),
    ).resolves.toBeDefined();
    const paths = (await store.list()).map((e) => e.path);
    expect(paths).toContain("intruder.md");
  });

  it("writes only the notes whose bytes changed", async () => {
    const store = memoryStore();
    let writes = 0;
    const counting: FileStore = {
      list: () => store.list(),
      read: (p) => store.read(p),
      write: (p, t) => {
        writes += 1;
        return store.write(p, t);
      },
      remove: (p) => store.remove(p),
    };
    const a = adapter(counting);
    const [first, second] = notes();
    const s1 = await a.save(serialize({ notes: [first!, second!] }));
    expect(writes).toBe(2);
    writes = 0;
    // Touch only the first note; the second's file must not be re-uploaded.
    await a.save(
      serialize({ notes: [editNote(first!, "changed", 9), second!] }),
      s1.revision,
    );
    expect(writes).toBe(1);
  });

  it("stores an encrypted envelope as a single blob and clears the markdown", async () => {
    const store = memoryStore();
    const a = adapter(store);
    await a.save(serialize({ notes: notes() }));
    const envelope = JSON.stringify({ encrypted: "notes.encrypted.v1" });
    await a.save(envelope);

    const paths = (await store.list()).map((e) => e.path);
    expect(paths).toEqual([BLOB_FILE_NAME]);
    expect((await a.load())?.text).toBe(envelope);
  });

  // Enabling encryption re-wraps through a fresh adapter when the load that
  // preceded the toggle was served from the offline cache, or when a backend /
  // namespace swap rebuilt the adapter — so the markdown files were never
  // tracked by the instance doing the encrypted write. The blob write must
  // still clear them, otherwise the next load reads the plaintext markdown back
  // and encryption silently has no effect at rest.
  it("clears untracked plaintext markdown when an envelope is written (enable encryption)", async () => {
    const store = memoryStore();
    // One adapter lays down the plaintext notes…
    await adapter(store).save(serialize({ notes: notes() }));
    // …and a *different*, fresh adapter writes the envelope without loading.
    const fresh = adapter(store);
    const envelope = JSON.stringify({ encrypted: "notes.encrypted.v1" });
    await fresh.save(envelope);

    const paths = (await store.list()).map((e) => e.path);
    expect(paths).toEqual([BLOB_FILE_NAME]);
    expect((await adapter(store).load())?.text).toBe(envelope);
  });

  // A backend can drift into holding BOTH the plaintext markdown and a stale
  // `notes.json` envelope. `load` surfaces the markdown (it wins over the
  // blob), so disabling encryption re-saves that markdown — which must drop the
  // orphaned envelope, otherwise the encrypted file lingers forever.
  it("clears a shadowed encrypted blob when the surfaced markdown is re-saved (disable from a both-representations state)", async () => {
    const store = memoryStore();
    await adapter(store).save(serialize({ notes: notes() }));
    // A stale envelope sits beside the markdown.
    await store.write(
      BLOB_FILE_NAME,
      JSON.stringify({ encrypted: "notes.encrypted.v1" }),
    );

    const a = adapter(store);
    const loaded = await a.load();
    // The markdown is what surfaces, not the envelope — which is exactly why
    // the disable path can't gate its re-save on "did the load return a blob".
    expect(isEncryptedEnvelope(loaded!.text)).toBe(false);
    await a.save(loaded!.text, loaded!.revision);

    const paths = (await store.list()).map((e) => e.path).sort();
    expect(paths).not.toContain(BLOB_FILE_NAME);
    expect(paths.every((p) => p.endsWith(".md"))).toBe(true);
  });

  // The symmetric case: disabling encryption writes markdown through whatever
  // adapter is live; a stranded `notes.json` must not linger beside it (and the
  // next load must read the decrypted markdown, not the stale ciphertext).
  it("clears an untracked encrypted blob when markdown is written (disable encryption)", async () => {
    const store = memoryStore();
    const envelope = JSON.stringify({ encrypted: "notes.encrypted.v1" });
    await adapter(store).save(envelope);
    // A fresh adapter writes the decrypted markdown without loading first.
    const fresh = adapter(store);
    const snapshot = { notes: notes() };
    await fresh.save(serialize(snapshot));

    const paths = (await store.list()).map((e) => e.path).sort();
    expect(paths).not.toContain(BLOB_FILE_NAME);
    expect(paths.every((p) => p.endsWith(".md"))).toBe(true);
    expect(parse((await adapter(store).load())?.text).notes).toEqual(
      snapshot.notes,
    );
  });

  it("returns null when nothing is stored", async () => {
    expect(await adapter(memoryStore()).load()).toBeNull();
  });

  it("reuses unchanged notes on load and fetches only what moved", async () => {
    const real = memoryStore();
    let reads = 0;
    const counting: FileStore = {
      list: () => real.list(),
      read: (p) => {
        reads += 1;
        return real.read(p);
      },
      write: (p, t) => real.write(p, t),
      remove: (p) => real.remove(p),
    };
    const a = adapter(counting);
    const [first, second] = notes();
    await a.save(serialize({ notes: [first!, second!] }));
    const full = await a.load();
    expect(reads).toBe(2);

    // A second device edits only the first note, behind our back.
    await real.write(notePath(first!), "---\nid: a\ncreated: 1\n---\nmoved\n");
    reads = 0;
    // Hand the adapter the snapshot we already hold: it should fetch only the
    // note whose revision moved, and reuse the untouched one from memory.
    const next = await a.load(full ?? undefined);
    expect(reads).toBe(1);
    // The result is still complete and correct (both notes present).
    expect(parse(next?.text).notes).toHaveLength(2);
    expect(next?.text).toContain("moved");
  });

  it("reads the directory only once per save (no post-write re-list)", async () => {
    // The post-save revision must come from the write responses, not a second
    // list() — re-listing is what made the cloud backends stamp a stale,
    // eventually-consistent revision the next save misread as a remote edit.
    const real = memoryStore();
    let lists = 0;
    const store: FileStore = {
      async list() {
        lists += 1;
        return real.list();
      },
      read: (p) => real.read(p),
      write: (p, t) => real.write(p, t),
      remove: (p) => real.remove(p),
    };
    const a = adapter(store);
    const stored = await a.save(serialize({ notes: notes() }));
    expect(lists).toBe(1);
    // And the revision it reported is the one a fresh listing now agrees with,
    // so the next save bases on a matching baseline.
    await expect(
      a.save(serialize({ notes: [] }), stored.revision),
    ).resolves.toBeDefined();
  });

  it("tolerates a divergence confined to a file whose write lost its ack", async () => {
    // A network blip can drop the HTTP *response* to a write the backend
    // already committed (Dropbox logs this as `TypeError: Load failed` right
    // after the upload reached the server). The file's rev then moves to a
    // value this adapter caused but never got to record, so the next save sees
    // a divergence it can't find in `produced` — and used to raise a phantom
    // CONFLICT even though no other device touched anything.
    const real = memoryStore();
    let dropAckFor: string | null = null;
    const store: FileStore = {
      list: () => real.list(),
      read: (p) => real.read(p),
      async write(path, text) {
        // The server commits the bytes (rev moves), but the ack is lost.
        const rev = await real.write(path, text);
        if (path === dropAckFor) throw new TypeError("Load failed");
        return rev;
      },
      remove: (p) => real.remove(p),
    };
    const a = adapter(store);

    const one = createNote(1);
    const two = createNote(2);
    const s1 = await a.save(serialize({ notes: [one, two] }));

    // Edit note two; its write commits server-side but loses its ack, so this
    // save throws and never records the new revision for that file.
    const editedTwo = editNote(two, "kept body", 9);
    dropAckFor = notePath(two);
    await expect(
      a.save(serialize({ notes: [one, editedTwo] }), s1.revision),
    ).rejects.toBeInstanceOf(TypeError);
    // The retry, still based on s1, must not read its own lost-ack write as a
    // remote edit — the only diverging file is the one whose ack we dropped.
    dropAckFor = null;
    await expect(
      a.save(serialize({ notes: [one, editedTwo] }), s1.revision),
    ).resolves.toBeDefined();
  });

  it("tolerates a listing that lags this device's own recent write", async () => {
    // Cloud list endpoints are eventually consistent: right after a write,
    // list() can still report the previous directory state. A queued back-to-
    // back save then lists that stale state — but it's one *this* adapter just
    // produced, so it must be treated as our own lag, not another device.
    const real = memoryStore();
    const history: FileEntry[][] = [];
    let lag = false;
    const store: FileStore = {
      async list() {
        const current = await real.list();
        history.push(current);
        // While lagging, reveal the directory as it was one listing ago.
        return lag && history.length >= 2
          ? history[history.length - 2]!
          : current;
      },
      read: (p) => real.read(p),
      write: (p, t) => real.write(p, t),
      remove: (p) => real.remove(p),
    };
    const a = adapter(store);

    const s1 = await a.save(serialize({ notes: [createNote(1)] }));
    const s2 = await a.save(
      serialize({ notes: [createNote(1), createNote(2)] }),
      s1.revision,
    );
    // From here the listing trails the real directory by one step.
    lag = true;
    await expect(
      a.save(serialize({ notes: [createNote(1)] }), s2.revision),
    ).resolves.toBeDefined();
  });
});

describe("directory adapter upload progress", () => {
  // A store whose writes block on a single shared gate, so a save can be caught
  // mid-flight to observe which notes are reported as uploading.
  function gatedStore(): { store: FileStore; release: () => void } {
    const base = memoryStore();
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const store: FileStore = {
      list: () => base.list(),
      read: (p) => base.read(p),
      async write(path, text) {
        await gate;
        return base.write(path, text);
      },
      remove: (p) => base.remove(p),
    };
    return { store, release: () => releaseGate() };
  }

  it("marks each note uploading while its file is written, then clears", async () => {
    const { store, release } = gatedStore();
    const a = adapter(store);
    const [first, second] = notes();
    const expected = [first!.id, second!.id].sort();

    const seen: string[][] = [];
    a.watchUploads!((ids) => seen.push([...ids].sort()));
    // The immediate on-subscribe emit reports nothing in flight.
    expect(seen).toEqual([[]]);

    const savePromise = a.save(serialize({ notes: [first!, second!] }));
    // Let the save reach (and block on) the gated writes.
    for (let i = 0; i < 50 && seen.length < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(seen[seen.length - 1]).toEqual(expected);

    release();
    await savePromise;
    // The set is empty again once the writes settle.
    expect(seen[seen.length - 1]).toEqual([]);
  });

  it("clears the uploading set even when a write fails", async () => {
    const base = memoryStore();
    const store: FileStore = {
      list: () => base.list(),
      read: (p) => base.read(p),
      write: () => Promise.reject(new Error("write failed")),
      remove: (p) => base.remove(p),
    };
    const a = adapter(store);
    const seen: string[][] = [];
    a.watchUploads!((ids) => seen.push([...ids].sort()));

    await expect(a.save(serialize({ notes: [createNote(1)] }))).rejects.toThrow(
      "write failed",
    );
    // First the note is marked, then the finally-block clears it.
    expect(seen[seen.length - 1]).toEqual([]);
    expect(seen.some((s) => s.length > 0)).toBe(true);
  });

  it("stops emitting after the listener unsubscribes", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const seen: string[][] = [];
    const unsubscribe = a.watchUploads!((ids) => seen.push([...ids].sort()));
    unsubscribe();
    await a.save(serialize({ notes: [createNote(1)] }));
    // Only the on-subscribe emit landed before unsubscribing.
    expect(seen).toEqual([[]]);
  });
});
