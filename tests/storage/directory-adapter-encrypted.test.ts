import { describe, expect, it } from "vitest";

import {
  attachmentMarkdown,
  type Attachment,
} from "../../src/domain/attachment.ts";
import { createNote, type Note } from "../../src/domain/note.ts";
import {
  bytesToDataUrl,
  type AttachmentEntry,
  type AttachmentStore,
} from "../../src/storage/attachment-store.ts";
import {
  INDEX_FILE_NAME,
  KEY_PARAMS_FILE,
  createDirectoryAdapter,
  type DirectoryCrypto,
} from "../../src/storage/directory-adapter.ts";
import type { FileEntry, FileStore } from "../../src/storage/file-store.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

type MemFile = { text: string; rev: number };

function memoryStore(files = new Map<string, MemFile>()) {
  let counter = 0;
  const store: FileStore & { files: Map<string, MemFile> } = {
    files,
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
  return store;
}

type MemAttachments = AttachmentStore & {
  files: Map<string, { bytes: Uint8Array; mime: string }>;
};

function memoryAttachments(): MemAttachments {
  const files = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    files,
    async list(): Promise<AttachmentEntry[]> {
      return [...files.keys()].map((path) => ({ path }));
    },
    async read(path) {
      return files.get(path)?.bytes ?? null;
    },
    async write(path, bytes, mime) {
      files.set(path, { bytes, mime });
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

const SECRET_BODY = "top secret body text";
const DATA_URL = "data:image/png;base64,SGVsbG8=";

function noteWithImage(seed: number): { note: Note; attachment: Attachment } {
  const attachment: Attachment = {
    filename: "abcd1234-pic.png",
    mime: "image/png",
    data: DATA_URL,
  };
  const note: Note = {
    ...createNote(seed),
    title: "My Secret Title",
    body: `${SECRET_BODY}\n${attachmentMarkdown(attachment)}`,
    attachments: [attachment],
  };
  return { note, attachment };
}

function encAdapter(
  store: FileStore,
  attachments: AttachmentStore,
  passwordRef: { current: string | null },
) {
  const dirCrypto: DirectoryCrypto = { passwordRef };
  return createDirectoryAdapter(
    store,
    { id: "folder", label: "T" },
    attachments,
    dirCrypto,
  );
}

// Pull every attachment's bytes into the snapshot via on-demand fetch — what
// the toggle does before switching representations so the bytes move across.
async function hydrate(
  adapter: ReturnType<typeof encAdapter>,
  text: string,
): Promise<string> {
  const snap = parse(text);
  for (const note of snap.notes) {
    for (const a of note.attachments ?? []) {
      if (a.data) continue;
      const got = await adapter.fetchAttachment!(note, a.filename);
      if (got) a.data = bytesToDataUrl(got.mime, got.bytes);
    }
  }
  return serialize(snap);
}

describe("directory adapter — encrypted per-file", () => {
  it("writes one encrypted file per note + one opaque blob per attachment", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const a = encAdapter(store, att, { current: "pw" });
    const { note } = noteWithImage(1);

    await a.save(serialize({ notes: [note] }));

    const paths = [...store.files.keys()];
    // Exactly one encrypted note file + the key-params metadata; no markdown.
    expect(paths.filter((p) => p.endsWith(".enc"))).toHaveLength(1);
    expect(paths).toContain(KEY_PARAMS_FILE);
    expect(paths.some((p) => p.endsWith(".md"))).toBe(false);

    // One flat, opaque attachment blob (no note-stem folder).
    const attPaths = [...att.files.keys()];
    expect(attPaths).toHaveLength(1);
    expect(attPaths[0]).not.toContain("/");
  });

  it("leaks nothing in the clear — not the body, title, or filename", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const a = encAdapter(store, att, { current: "pw" });
    const { note } = noteWithImage(1);
    await a.save(serialize({ notes: [note] }));

    for (const [path, { text }] of store.files) {
      if (path === KEY_PARAMS_FILE) continue; // salts only, no content
      expect(text).not.toContain(SECRET_BODY);
      expect(text).not.toContain("My Secret Title");
      expect(text).not.toContain("abcd1234-pic.png");
    }
    // The opaque names don't reveal the title or filename either.
    for (const path of store.files.keys()) {
      expect(path).not.toContain("secret");
      expect(path).not.toContain("pic");
    }
    for (const path of att.files.keys()) {
      expect(path).not.toContain("pic");
    }
  });

  it("round-trips the note (metadata-only load) and fetches bytes on demand", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const { note } = noteWithImage(1);
    await encAdapter(store, att, { current: "pw" }).save(
      serialize({ notes: [note] }),
    );

    // A cold adapter with the same passphrase renders the note from the index:
    // title + a preview snippet + attachment metadata, but the body stays
    // deferred (not decrypted) until the note is opened.
    const b = encAdapter(store, att, { current: "pw" });
    const loaded = await b.load();
    const restored = parse(loaded?.text).notes;
    expect(restored).toHaveLength(1);
    expect(restored[0]!.title).toBe("My Secret Title");
    expect(restored[0]!.body).toBeUndefined();
    expect(restored[0]!.preview).toContain(SECRET_BODY);
    expect(restored[0]!.attachments).toEqual([
      { filename: "abcd1234-pic.png", mime: "image/png" },
    ]);

    // Opening the note decrypts its body on demand.
    const body = await b.fetchNoteBody!(restored[0]!);
    expect(body).toContain(SECRET_BODY);

    // And fetches the attachment bytes on demand.
    const got = await b.fetchAttachment!(restored[0]!, "abcd1234-pic.png");
    expect(got).not.toBeNull();
    expect(got!.mime).toBe("image/png");
    expect([...got!.bytes]).toEqual([72, 101, 108, 108, 111]); // "Hello"
  });

  it("reports each note to onDecryptNote in the no-index fallback", async () => {
    // With the index present an unlock decrypts nothing up front (bodies are
    // deferred). When the index is missing — a vault from before the index
    // existed, or a dropped index — the load falls back to decrypting each
    // note file, and that path drives the unlock gate's per-note progress line.
    const store = memoryStore();
    const att = memoryAttachments();
    const notes: Note[] = [
      { ...createNote(1), title: "Groceries", body: "milk" },
      { ...createNote(2), title: "Trip", body: "pack" },
    ];
    await encAdapter(store, att, { current: "pw" }).save(serialize({ notes }));
    // Drop the index → force the per-note fallback.
    store.files.delete(INDEX_FILE_NAME);

    const seen: Array<{ title: string; index: number; total: number }> = [];
    const crypto: DirectoryCrypto = {
      passwordRef: { current: "pw" },
      onDecryptNote: { current: (info) => seen.push(info) },
    };
    const b = createDirectoryAdapter(
      store,
      { id: "folder", label: "T" },
      att,
      crypto,
    );
    await b.load();

    expect(seen).toHaveLength(2);
    expect(seen.map((s) => s.title).sort()).toEqual(["Groceries", "Trip"]);
    expect(seen.every((s) => s.total === 2)).toBe(true);
    expect(seen.map((s) => s.index).sort()).toEqual([1, 2]);
  });

  it("recovers folders on unlock when the listing lags but the sidecar reads", async () => {
    // The Dropbox cold-start / upgrade-reload bug: `list_folder` is eventually
    // consistent and can omit `folders.json` right after startup, so a note's
    // folder id (carried in its encrypted JSON — frontmatter is the source of
    // truth) resolves to nothing and the note renders orphaned until the
    // adapter is rebuilt. A direct read of the known path is consistent, so a
    // referenced folder is still recovered.
    const store = memoryStore();
    const att = memoryAttachments();
    const registry = [
      { id: "f1", name: "Noteringar", createdAt: 1 },
      { id: "f2", name: "Empty", createdAt: 2 },
    ];
    const notes = Array.from({ length: 4 }, (_, i) => ({
      ...createNote(i + 1),
      title: `Note ${i}`,
      body: `secret ${i}`,
      folderId: "f1",
    }));
    await encAdapter(store, att, { current: "pw" }).save(
      serialize({ notes, folders: registry }),
    );

    // A fresh (cold-start) adapter whose listing drops folders.json.
    const lagging: FileStore = {
      list: async () =>
        (await store.list()).filter((e) => e.path !== "folders.json"),
      read: (p) => store.read(p),
      write: (p, t) => store.write(p, t),
      remove: (p) => store.remove(p),
    };
    const reader = encAdapter(lagging, att, { current: "pw" });
    const loaded = await reader.load();
    // Every folder survives — including the empty one no note links to.
    expect(parse(loaded!.text).folders).toEqual(registry);
  });

  it("rejects the wrong passphrase on load", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    await encAdapter(store, att, { current: "right" }).save(
      serialize({ notes: [noteWithImage(1).note] }),
    );
    await expect(
      encAdapter(store, att, { current: "wrong" }).load(),
    ).rejects.toThrow(/wrong password/i);
  });

  it("does not re-upload an unchanged note (stable plaintext hash)", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    let writes = 0;
    const counting: FileStore = {
      list: () => store.list(),
      read: (p) => store.read(p),
      write: (p, t) => {
        if (p.endsWith(".enc")) writes += 1;
        return store.write(p, t);
      },
      remove: (p) => store.remove(p),
    };
    const a = encAdapter(counting, att, { current: "pw" });
    const { note } = noteWithImage(1);
    const s1 = await a.save(serialize({ notes: [note] }));
    expect(writes).toBe(1);
    writes = 0;
    // Re-saving the identical document must not re-encrypt the note file even
    // though a fresh IV would make its ciphertext differ.
    await a.save(serialize({ notes: [note] }), s1.revision);
    expect(writes).toBe(0);
  });

  it("seals only the changed note when one of many is edited", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    // Count how many times note bytes are actually sealed (a `.enc` write is the
    // observable proxy for a `sealString` call). A single edit in a many-note
    // vault must seal exactly one note, not the whole document.
    let encWrites = 0;
    const counting: FileStore = {
      list: () => store.list(),
      read: (p) => store.read(p),
      write: (p, t) => {
        if (p.endsWith(".enc")) encWrites += 1;
        return store.write(p, t);
      },
      remove: (p) => store.remove(p),
    };
    const a = encAdapter(counting, att, { current: "pw" });
    const notes: Note[] = Array.from({ length: 10 }, (_, i) => ({
      ...createNote(i + 1),
      title: `Note ${i}`,
      body: `body ${i}`,
    }));
    const s1 = await a.save(serialize({ notes }));
    expect(encWrites).toBe(10);

    encWrites = 0;
    const edited = notes.map((n, i) =>
      i === 3 ? { ...n, body: "changed body" } : n,
    );
    await a.save(serialize({ notes: edited }), s1.revision);
    expect(encWrites).toBe(1);
  });

  it("an index-fast unlock decrypts no bodies, and a second load reuses the memo", async () => {
    // The unlock renders the list from the index: one index read, zero per-note
    // decryptions, every body deferred. The unlock flow then loads a second time
    // (gate verify, then adapter swap) over identical bytes — the memo returns
    // the same snapshot without even re-reading the index.
    const store = memoryStore();
    const att = memoryAttachments();
    let encReads = 0;
    let indexReads = 0;
    const counting: FileStore = {
      list: () => store.list(),
      read: (p) => {
        if (p.endsWith(".enc")) encReads += 1;
        if (p === INDEX_FILE_NAME) indexReads += 1;
        return store.read(p);
      },
      write: (p, t) => store.write(p, t),
      remove: (p) => store.remove(p),
    };
    const notes: Note[] = Array.from({ length: 5 }, (_, i) => ({
      ...createNote(i + 1),
      title: `Note ${i}`,
      body: `secret ${i}`,
    }));
    await encAdapter(store, att, { current: "pw" }).save(serialize({ notes }));

    const b = encAdapter(counting, att, { current: "pw" });
    const first = parse((await b.load())!.text).notes;
    expect(first).toHaveLength(5);
    // Index-fast: no body was decrypted, the list comes from the index alone.
    expect(encReads).toBe(0);
    expect(indexReads).toBe(1);
    expect(first.every((n) => n.body === undefined)).toBe(true);
    expect(first.map((n) => n.preview).sort()).toEqual(
      notes.map((n) => n.body).sort(),
    );

    // Second load — nothing changed on disk → the memo serves it, no reads.
    encReads = 0;
    indexReads = 0;
    const second = parse((await b.load())!.text).notes;
    expect(encReads).toBe(0);
    expect(indexReads).toBe(0);
    expect(second).toHaveLength(5);

    // Opening one note decrypts exactly that note's file.
    const body = await b.fetchNoteBody!(first[0]!);
    expect(body).toBe(notes.find((n) => n.id === first[0]!.id)!.body);
    expect(encReads).toBe(1);
  });

  it("reflects a remotely-changed note via the index without eager decryption", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    let encReads = 0;
    const counting: FileStore = {
      list: () => store.list(),
      read: (p) => {
        if (p.endsWith(".enc")) encReads += 1;
        return store.read(p);
      },
      write: (p, t) => store.write(p, t),
      remove: (p) => store.remove(p),
    };
    const notes: Note[] = Array.from({ length: 6 }, (_, i) => ({
      ...createNote(i + 1),
      title: `Note ${i}`,
      body: `body ${i}`,
    }));
    const writer = encAdapter(counting, att, { current: "pw" });
    const s1 = await writer.save(serialize({ notes }));

    const reader = encAdapter(counting, att, { current: "pw" });
    await reader.load();

    // A different device edits one note (rewriting its `.enc` and the index);
    // the reader pulls again.
    encReads = 0;
    const edited = notes.map((n, i) =>
      i === 2 ? { ...n, body: "changed" } : n,
    );
    await writer.save(serialize({ notes: edited }), s1.revision);
    const reloaded = parse((await reader.load())!.text).notes;

    // The index covers every note, so the reload decrypts nothing up front; the
    // changed note's new preview comes straight from the refreshed index.
    expect(encReads).toBe(0);
    expect(reloaded).toHaveLength(6);
    const changed = reloaded.find((n) => n.preview === "changed");
    expect(changed).toBeTruthy();
    // Its body is fetched on demand and reflects the edit.
    expect(await reader.fetchNoteBody!(changed!)).toBe("changed");
  });

  it("skips the attachment listing once notes are fully migrated", async () => {
    // A fully-encrypted vault carries attachment metadata in each note's JSON,
    // so a load needn't list the attachment store — proving that saves a cloud
    // round-trip. (With a plaintext remnant present it must still list.)
    const store = memoryStore();
    // Wrap a fresh attachments store so we can count list() calls.
    const backing = memoryAttachments();
    let attLists = 0;
    const countingAtt: MemAttachments = {
      files: backing.files,
      list: () => {
        attLists += 1;
        return backing.list();
      },
      read: (p) => backing.read(p),
      write: (p, b, m) => backing.write(p, b, m),
      remove: (p) => backing.remove(p),
    };

    const { note } = noteWithImage(1);
    await encAdapter(store, countingAtt, { current: "pw" }).save(
      serialize({ notes: [note] }),
    );

    attLists = 0;
    const b = encAdapter(store, countingAtt, { current: "pw" });
    const loaded = parse((await b.load())!.text).notes[0]!;
    // Metadata still reconstructed from the note JSON, with no listing walked.
    expect(loaded.attachments).toEqual([
      { filename: "abcd1234-pic.png", mime: "image/png" },
    ]);
    expect(attLists).toBe(0);
    // Bytes are still fetchable on demand.
    const got = await b.fetchAttachment!(loaded, "abcd1234-pic.png");
    expect([...got!.bytes]).toEqual([72, 101, 108, 108, 111]);
  });

  it("defers every body on an index-fast unlock of many notes (no reports)", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const notes: Note[] = Array.from({ length: 25 }, (_, i) => ({
      ...createNote(i + 1),
      title: `Note ${i}`,
      body: `secret ${i}`,
    }));
    await encAdapter(store, att, { current: "pw" }).save(serialize({ notes }));

    const seen: Array<{ index: number; total: number }> = [];
    const crypto: DirectoryCrypto = {
      passwordRef: { current: "pw" },
      onDecryptNote: { current: (info) => seen.push(info) },
    };
    const b = createDirectoryAdapter(
      store,
      { id: "folder", label: "T" },
      att,
      crypto,
    );
    const loaded = parse((await b.load())!.text).notes;
    expect(loaded).toHaveLength(25);
    // Every body is deferred, the previews come from the index, and — since the
    // index covers everything — nothing is decrypted up front, so the gate's
    // per-note reporter never fires.
    expect(loaded.every((n) => n.body === undefined)).toBe(true);
    expect(loaded.map((n) => n.preview).sort()).toEqual(
      notes.map((n) => n.body).sort(),
    );
    expect(seen).toHaveLength(0);

    // Any note's body is available on demand.
    const some = loaded[7]!;
    expect(await b.fetchNoteBody!(some)).toBe(
      notes.find((n) => n.id === some.id)!.body,
    );
  });

  it("does not write or remove a deferred note on save", async () => {
    // Editing one note must not touch the `.enc` files of notes whose bodies
    // were never loaded — nor delete them as orphans.
    const store = memoryStore();
    const att = memoryAttachments();
    let encWrites = 0;
    let encRemoves = 0;
    const counting: FileStore = {
      list: () => store.list(),
      read: (p) => store.read(p),
      write: (p, t) => {
        if (p.endsWith(".enc")) encWrites += 1;
        return store.write(p, t);
      },
      remove: (p) => {
        if (p.endsWith(".enc")) encRemoves += 1;
        return store.remove(p);
      },
    };
    const notes: Note[] = Array.from({ length: 3 }, (_, i) => ({
      ...createNote(i + 1),
      title: `Note ${i}`,
      body: `body ${i}`,
    }));
    const a = encAdapter(counting, att, { current: "pw" });
    const s1 = await a.save(serialize({ notes }));

    // Fresh adapter: load (bodies deferred), open + edit one note, save back
    // with the other two still deferred.
    const b = encAdapter(counting, att, { current: "pw" });
    const loaded = parse((await b.load())!.text).notes;
    const encPathsBefore = (await store.list())
      .filter((e) => e.path.endsWith(".enc"))
      .map((e) => e.path)
      .sort();

    const opened = loaded.find((n) => n.title === "Note 0")!;
    const body = await b.fetchNoteBody!(opened);
    const next = loaded.map((n) =>
      n.id === opened.id ? { ...n, body: `${body} edited` } : n,
    );
    encWrites = 0;
    encRemoves = 0;
    await b.save(serialize({ notes: next }), s1.revision);

    // Only the edited note's file was written; the two deferred notes were left
    // untouched and none were removed.
    expect(encWrites).toBe(1);
    expect(encRemoves).toBe(0);
    const encPathsAfter = (await store.list())
      .filter((e) => e.path.endsWith(".enc"))
      .map((e) => e.path)
      .sort();
    expect(encPathsAfter).toEqual(encPathsBefore);
  });
});

describe("directory adapter — atomic representation switch", () => {
  it("enable: writes encrypted, then removes the superseded plaintext", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const ref = { current: null as string | null };
    const a = encAdapter(store, att, ref);
    const { note } = noteWithImage(1);

    // Plaintext first.
    await a.save(serialize({ notes: [note] }));
    expect([...store.files.keys()].some((p) => p.endsWith(".md"))).toBe(true);
    expect([...att.files.keys()][0]).toContain("/"); // plaintext attachment

    // Read the plaintext + pull attachment bytes in (mirrors enableEncryption),
    // then turn crypto on and re-save through the same adapter.
    const plain = await hydrate(a, (await a.load())!.text);
    ref.current = "pw";
    await a.save(plain);

    const paths = [...store.files.keys()];
    expect(paths.some((p) => p.endsWith(".md"))).toBe(false);
    expect(paths.filter((p) => p.endsWith(".enc"))).toHaveLength(1);
    // The plaintext attachment file is gone; an opaque blob remains.
    const attPaths = [...att.files.keys()];
    expect(attPaths).toHaveLength(1);
    expect(attPaths[0]).not.toContain("/");
  });

  it("disable: writes plaintext, then removes the superseded ciphertext", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const ref = { current: "pw" as string | null };
    const a = encAdapter(store, att, ref);
    const { note } = noteWithImage(1);
    await a.save(serialize({ notes: [note] }));

    const plain = await hydrate(a, (await a.load())!.text);
    ref.current = null;
    await a.save(plain);

    const paths = [...store.files.keys()];
    expect(paths.some((p) => p.endsWith(".enc"))).toBe(false);
    expect(paths.some((p) => p.endsWith(".md"))).toBe(true);
    expect([...att.files.keys()][0]).toContain("/"); // back to plaintext file
  });

  it("loses no data when a crash interrupts between write and delete", async () => {
    // Simulate a crash during the enable switch: the encrypted file is written
    // but removing the plaintext throws. Both representations then coexist; the
    // next load must read the encrypted (authoritative) copy intact, and a
    // retry must finish the cleanup.
    const files = new Map<string, MemFile>();
    const real = memoryStore(files);
    const att = memoryAttachments();
    const ref = { current: null as string | null };

    await encAdapter(real, att, ref).save(
      serialize({ notes: [noteWithImage(1).note] }),
    );
    // Read the plaintext + pull attachment bytes in while crypto is still off.
    const plain = await hydrate(
      encAdapter(real, att, ref),
      (await encAdapter(real, att, ref).load())!.text,
    );

    let failRemove = true;
    const flaky: FileStore = {
      list: () => real.list(),
      read: (p) => real.read(p),
      write: (p, t) => real.write(p, t),
      async remove(p) {
        if (failRemove && p.endsWith(".md")) throw new TypeError("crash");
        return real.remove(p);
      },
    };
    ref.current = "pw";
    const a = encAdapter(flaky, att, ref);
    await expect(a.save(plain)).rejects.toThrow();

    // Both the new `.enc` and the old `.md` are on disk after the crash.
    const after = [...files.keys()];
    expect(after.some((p) => p.endsWith(".enc"))).toBe(true);
    expect(after.some((p) => p.endsWith(".md"))).toBe(true);

    // The authoritative (encrypted) copy still reads back intact — no loss.
    const recovered = parse(
      (await encAdapter(real, att, ref).load())!.text,
    ).notes;
    expect(recovered[0]!.body).toContain(SECRET_BODY);

    // The retry (no longer crashing) finishes removing the plaintext.
    failRemove = false;
    await encAdapter(flaky, att, ref).save(plain);
    expect([...files.keys()].some((p) => p.endsWith(".md"))).toBe(false);
  });
});

describe("directory adapter — paced per-note migration", () => {
  it("merges plaintext remnants on load and reports per-note status", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const ref = { current: null as string | null };
    // Two plaintext notes.
    await encAdapter(store, att, ref).save(
      serialize({ notes: [noteWithImage(1).note, noteWithImage(2).note] }),
    );

    // Turn encryption on (mode flips; nothing converted yet).
    ref.current = "pw";
    const a = encAdapter(store, att, ref);
    const loaded = parse((await a.load())!.text);
    // Both notes are present (merged remnants) and both report pending.
    expect(loaded.notes).toHaveLength(2);
    const status = a.getEncryptionStatus!();
    expect([...status.values()].every((s) => s === "pending")).toBe(true);
  });

  it("migrateNote removes a folder-placed plaintext note (no leak)", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const ref = { current: null as string | null };
    // A note filed into a folder → plaintext lives at `<folder-dir>/<stem>.md`.
    const filed: Note = { ...noteWithImage(1).note, folderId: "f1" };
    await encAdapter(store, att, ref).save(
      serialize({
        notes: [filed],
        folders: [{ id: "f1", name: "Secret Plans", createdAt: 1 }],
      }),
    );
    expect(
      [...store.files.keys()].some(
        (p) => p.startsWith("secret-plans/") && p.endsWith(".md"),
      ),
    ).toBe(true);

    // Enable encryption and migrate the one note: the folder-placed plaintext
    // must be found and removed, not left stranded in the clear.
    ref.current = "pw";
    const a = encAdapter(store, att, ref);
    const note = parse((await a.load())!.text).notes[0]!;
    expect(await a.migrateNote!(note)).toBe(true);
    expect([...store.files.keys()].some((p) => p.endsWith(".md"))).toBe(false);
    expect(
      [...store.files.keys()].filter((p) => p.endsWith(".enc")),
    ).toHaveLength(1);
  });

  it("migrateNote converts one note atomically and flips its status", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const ref = { current: null as string | null };
    await encAdapter(store, att, ref).save(
      serialize({ notes: [noteWithImage(1).note] }),
    );

    ref.current = "pw";
    const a = encAdapter(store, att, ref);
    const loaded = parse((await a.load())!.text);
    const note = loaded.notes[0]!;
    expect(a.getEncryptionStatus!().get(note.id)).toBe("pending");

    const did = await a.migrateNote!(note);
    expect(did).toBe(true);
    expect(a.getEncryptionStatus!().get(note.id)).toBe("encrypted");

    // On disk: the plaintext is gone, an encrypted note file + opaque blob
    // remain, and the bytes still decrypt to the original.
    expect([...store.files.keys()].some((p) => p.endsWith(".md"))).toBe(false);
    expect(
      [...store.files.keys()].filter((p) => p.endsWith(".enc")),
    ).toHaveLength(1);
    expect([...att.files.keys()][0]).not.toContain("/");

    const after = encAdapter(store, att, ref);
    const reloaded = parse((await after.load())!.text).notes[0]!;
    expect(after.getEncryptionStatus!().get(reloaded.id)).toBe("encrypted");
    const got = await after.fetchAttachment!(reloaded, "abcd1234-pic.png");
    expect([...got!.bytes]).toEqual([72, 101, 108, 108, 111]);

    // Migrating again is an idempotent no-op.
    expect(await after.migrateNote!(reloaded)).toBe(false);
  });

  it("demigrateNote reverses one note back to plaintext and flips its status", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const ref = { current: "pw" as string | null };
    const { note } = noteWithImage(1);
    // Start fully encrypted (one .enc note + one opaque blob).
    await encAdapter(store, att, ref).save(serialize({ notes: [note] }));
    expect([...store.files.keys()].some((p) => p.endsWith(".enc"))).toBe(true);

    const a = encAdapter(store, att, ref);
    const loaded = parse((await a.load())!.text).notes[0]!;
    expect(a.getEncryptionStatus!().get(loaded.id)).toBe("encrypted");

    const did = await a.demigrateNote!(loaded);
    expect(did).toBe(true);
    expect(a.getEncryptionStatus!().get(loaded.id)).toBeUndefined();

    // On disk: the ciphertext is gone, a plaintext .md + grouped attachment
    // file remain.
    expect([...store.files.keys()].some((p) => p.endsWith(".enc"))).toBe(false);
    expect([...store.files.keys()].some((p) => p.endsWith(".md"))).toBe(true);
    expect([...att.files.keys()][0]).toContain("/");

    // A plaintext adapter (no passphrase) reads it back intact, bytes included.
    const plain = encAdapter(store, att, { current: null });
    const reloaded = parse((await plain.load())!.text).notes[0]!;
    expect(reloaded.title).toBe("My Secret Title");
    expect(reloaded.body).toContain(SECRET_BODY);
    const got = await plain.fetchAttachment!(reloaded, "abcd1234-pic.png");
    expect([...got!.bytes]).toEqual([72, 101, 108, 108, 111]);

    // Demigrating again is an idempotent no-op.
    expect(await encAdapter(store, att, ref).demigrateNote!(loaded)).toBe(
      false,
    );
  });

  it("round-trips a note through encrypt → decrypt with no data loss", async () => {
    const store = memoryStore();
    const att = memoryAttachments();
    const ref = { current: null as string | null };
    const { note } = noteWithImage(1);

    // Plaintext → encrypt the whole document → migrate (already sealed) is a
    // no-op, so seal via demigrate's inverse: start plaintext, turn on, then off.
    await encAdapter(store, att, ref).save(serialize({ notes: [note] }));
    const plain = await hydrate(
      encAdapter(store, att, ref),
      (await encAdapter(store, att, ref).load())!.text,
    );
    ref.current = "pw";
    await encAdapter(store, att, ref).save(plain); // now encrypted

    // Decrypt note-by-note via demigrateNote, then drop the passphrase.
    const enc = encAdapter(store, att, ref);
    const loaded = parse((await enc.load())!.text).notes[0]!;
    await enc.demigrateNote!(loaded);
    ref.current = null;

    const final = encAdapter(store, att, { current: null });
    const out = parse((await final.load())!.text).notes[0]!;
    expect(out.body).toContain(SECRET_BODY);
    const got = await final.fetchAttachment!(out, "abcd1234-pic.png");
    expect([...got!.bytes]).toEqual([72, 101, 108, 108, 111]);
  });
});

describe("directory adapter — legacy notes.json split", () => {
  it("upgrades a legacy whole-document blob to per-file form, then removes it", async () => {
    const { encryptText } = await import("../../src/storage/crypto.ts");
    const store = memoryStore();
    const att = memoryAttachments();
    // A legacy encrypted blob: the whole snapshot (attachments inline) in one
    // envelope at notes.json — the old at-rest format.
    const { note } = noteWithImage(1);
    const legacy = await encryptText(serialize({ notes: [note] }), "pw");
    store.files.set("notes.json", { text: legacy, rev: 1 });

    const ref = { current: "pw" as string | null };
    const a = encAdapter(store, att, ref);

    // Load decrypts the legacy blob so the document is readable.
    const loaded = parse((await a.load())!.text);
    expect(loaded.notes[0]!.body).toContain(SECRET_BODY);

    // The split converts it to per-file form and drops notes.json.
    expect(await a.splitLegacyBlob!()).toBe(true);
    const paths = [...store.files.keys()];
    expect(paths).not.toContain("notes.json");
    expect(paths.filter((p) => p.endsWith(".enc"))).toHaveLength(1);
    expect([...att.files.keys()][0]).not.toContain("/"); // opaque blob

    // A cold adapter reads the per-file form: the list renders from the index
    // (body deferred, preview present) and the body + bytes decrypt on demand.
    const b = encAdapter(store, att, ref);
    const reloaded = parse((await b.load())!.text).notes[0]!;
    expect(reloaded.body).toBeUndefined();
    expect(reloaded.preview).toContain(SECRET_BODY);
    expect(b.getEncryptionStatus!().get(reloaded.id)).toBe("encrypted");
    expect(await b.fetchNoteBody!(reloaded)).toContain(SECRET_BODY);
    const got = await b.fetchAttachment!(reloaded, "abcd1234-pic.png");
    expect([...got!.bytes]).toEqual([72, 101, 108, 108, 111]);

    // Idempotent — nothing to split now.
    expect(await b.splitLegacyBlob!()).toBe(false);
  });
});
