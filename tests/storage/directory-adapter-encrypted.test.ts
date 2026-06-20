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

    // A cold adapter with the same passphrase reconstructs the note + the
    // attachment metadata, but not the attachment bytes.
    const b = encAdapter(store, att, { current: "pw" });
    const loaded = await b.load();
    const restored = parse(loaded?.text).notes;
    expect(restored).toHaveLength(1);
    expect(restored[0]!.title).toBe("My Secret Title");
    expect(restored[0]!.body).toContain(SECRET_BODY);
    expect(restored[0]!.attachments).toEqual([
      { filename: "abcd1234-pic.png", mime: "image/png" },
    ]);

    // Opening the note fetches + decrypts the bytes on demand.
    const got = await b.fetchAttachment!(restored[0]!, "abcd1234-pic.png");
    expect(got).not.toBeNull();
    expect(got!.mime).toBe("image/png");
    expect([...got!.bytes]).toEqual([72, 101, 108, 108, 111]); // "Hello"
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
});
