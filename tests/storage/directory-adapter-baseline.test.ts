// The "desktop typed a lot, then mobile opened and blew it away" regression.
//
// The file backends detect a collision by comparing each file's current
// revision against the baseline the caller is writing from. The dangerous case
// is the caller that has *no* baseline: a mount load that failed, or one whose
// result the sync engine declined to adopt. An absent `baseRevision` used to
// disable the conflict gate outright, so that save overwrote every note file on
// the backend with whatever this device happened to be holding.

import { describe, expect, it } from "vitest";

import { createNote, type Note } from "../../src/domain/note.ts";
import { ConflictError } from "../../src/storage/adapter.ts";
import { createDirectoryAdapter } from "../../src/storage/directory-adapter.ts";
import type { FileEntry, FileStore } from "../../src/storage/file-store.ts";
import { noteFileStem } from "../../src/storage/markdown/codec.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

function notePath(note: Note): string {
  return `${noteFileStem(note)}.md`;
}

// In-memory FileStore shared by two adapters, so one can play "desktop" and the
// other "mobile" against the same folder.
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
  return createDirectoryAdapter(store, { id: "dropbox", label: "Test" });
}

describe("directory adapter save baseline", () => {
  it("refuses to overwrite a file it has never seen when no base revision is given", async () => {
    const store = memoryStore();
    const note = createNote(1);

    // Desktop writes a long note.
    const desktop = adapter(store);
    await desktop.save(
      serialize({ notes: [{ ...note, body: "the long thing I just typed" }] }),
    );

    // Mobile comes up on a fresh adapter whose load never landed, holding a
    // stale copy of the same note, and saves with no baseline.
    const mobile = adapter(store);
    await expect(
      mobile.save(serialize({ notes: [{ ...note, body: "stale" }] })),
    ).rejects.toBeInstanceOf(ConflictError);

    // The desktop's text is still on the backend.
    const onDisk = await store.read(notePath(note));
    expect(onDisk).toContain("the long thing I just typed");
  });

  it("carries the remote copy on the conflict so the caller can offer a choice", async () => {
    const store = memoryStore();
    const note = createNote(1);
    const desktop = adapter(store);
    await desktop.save(serialize({ notes: [{ ...note, body: "theirs" }] }));

    const mobile = adapter(store);
    const err = await mobile
      .save(serialize({ notes: [{ ...note, body: "mine" }] }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    const remote = parse((err as ConflictError).remote.text);
    expect(remote.notes[0]!.body).toContain("theirs");
  });

  it("still writes the first note into an empty folder with no baseline", async () => {
    // The genuine no-baseline case: nothing is on the backend to collide with,
    // so the gate must stay out of the way.
    const store = memoryStore();
    const a = adapter(store);
    await a.save(serialize({ notes: [createNote(1)] }));
    expect(await store.list()).toHaveLength(1);
  });

  it("still writes when the baseline is unknown but every file is one it just read", async () => {
    // A device that loaded successfully knows the current state of each file
    // even if the caller didn't thread the revision back, so a save must not
    // be turned into a spurious conflict.
    const store = memoryStore();
    const first = adapter(store);
    const note = createNote(1);
    await first.save(serialize({ notes: [{ ...note, body: "one" }] }));

    const second = adapter(store);
    await second.load();
    await second.save(serialize({ notes: [{ ...note, body: "two" }] }));
    expect(await store.read(notePath(note))).toContain("two");
  });

  it("leaves a note the other device did not touch alone", async () => {
    // Per-file scoping: mobile's stale save collides only on the note both
    // devices changed, so a divergence is never all-or-nothing.
    const store = memoryStore();
    const [a, b] = [createNote(1), createNote(2)];
    const desktop = adapter(store);
    await desktop.save(serialize({ notes: [a!, b!] }));
    const base = (await desktop.load())!.revision;

    // Mobile pulls the same starting point, then both devices go their own way.
    const mobile = adapter(store);
    await mobile.load();

    // Desktop edits note A.
    await desktop.save(
      serialize({ notes: [{ ...a!, body: "desktop edit" }, b!] }),
      base,
    );

    // Mobile, still on the old baseline, edits note B only. No overlap, so its
    // save must land without disturbing the note it didn't touch.
    await mobile.save(
      serialize({ notes: [a!, { ...b!, body: "mobile edit" }] }),
      base,
    );

    expect(await store.read(notePath(a!))).toContain("desktop edit");
    expect(await store.read(notePath(b!))).toContain("mobile edit");
  });
});
