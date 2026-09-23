// The iCloud Drive backend against a fake host: what lands in the container,
// what a second device reads back, how each store is confined to its own
// folder, and — the point of the exercise — that with encryption on nothing
// but ciphertext ever reaches the host, exactly as for Dropbox.
//
// The fake mirrors what the native module reports: every file in the container
// by `/`-separated path, with a revision token, and dot-files left out of the
// listing (the Swift side skips them) while still readable by name.

import { describe, expect, it } from "vitest";

import { createNote, type Note } from "../../src/domain/note.ts";
import type { ICloudHost } from "../../src/platform/icloud-host.ts";
import { KEY_PARAMS_FILE } from "../../src/storage/directory-adapter.ts";
import {
  ICLOUD_LABEL,
  base64ToBytes,
  bytesToBase64,
  createICloudAdapter,
  createICloudNamespaceStore,
  createICloudSettingsStore,
  deleteICloudNamespace,
  icloudNotesPath,
} from "../../src/storage/icloud/index.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

function fakeHost() {
  const files = new Map<string, string>();
  const writes: { path: string; payload: string }[] = [];
  let counter = 0;
  const revs = new Map<string, number>();
  const put = (path: string, payload: string) => {
    files.set(path, payload);
    revs.set(path, ++counter);
    writes.push({ path, payload });
  };
  const host: ICloudHost = {
    version: 1,
    status: async () => "ready",
    list: async () =>
      [...files.keys()]
        .filter((path) => !path.split("/").pop()!.startsWith("."))
        .map((path) => ({ path, rev: String(revs.get(path)) })),
    read: async (path) => files.get(path) ?? null,
    write: async (path, text) => put(path, text),
    readBytes: async (path) => files.get(path) ?? null,
    writeBytes: async (path, base64) => put(path, base64),
    remove: async (path) => {
      files.delete(path);
    },
  };
  return { host, files, writes, paths: () => [...files.keys()].sort() };
}

function plainNote(overrides: Partial<Note> = {}): Note {
  return { ...createNote(1), title: "Hello", body: "world", ...overrides };
}

const SECRET_TITLE = "My Secret Title";
const SECRET_BODY = "top secret body text";

describe("createICloudAdapter", () => {
  it("advertises its id, label, and the attachments capability", () => {
    const a = createICloudAdapter(fakeHost().host);
    expect(a.id).toBe("icloud");
    expect(a.label).toBe(ICLOUD_LABEL);
    expect(a.capabilities.has("attachments")).toBe(true);
  });

  it("returns null when nothing has been written yet", async () => {
    expect(await createICloudAdapter(fakeHost().host).load()).toBeNull();
  });

  it("writes one markdown file per note under notes/, and a second device reads them back", async () => {
    const fake = fakeHost();
    await createICloudAdapter(fake.host).save(
      serialize({ notes: [plainNote({ title: "Groceries", body: "milk" })] }),
    );

    const notePaths = fake.paths().filter((p) => p.endsWith(".md"));
    expect(notePaths).toHaveLength(1);
    expect(notePaths[0]!.startsWith("notes/")).toBe(true);
    expect(fake.files.get(notePaths[0]!)).toContain("milk");

    const loaded = await createICloudAdapter(fake.host).load();
    const notes = parse(loaded!.text).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("Groceries");
    expect(notes[0]!.body).toBe("milk");
  });

  it("keeps a namespace in its own folder, apart from the default one", async () => {
    const fake = fakeHost();
    await createICloudAdapter(fake.host).save(
      serialize({ notes: [plainNote({ title: "Home" })] }),
    );
    await createICloudAdapter(fake.host, "work").save(
      serialize({ notes: [plainNote({ ...createNote(2), title: "Work" })] }),
    );

    expect(fake.paths().some((p) => p.startsWith("work/notes/"))).toBe(true);
    const home = parse((await createICloudAdapter(fake.host).load())!.text);
    const work = parse(
      (await createICloudAdapter(fake.host, "work").load())!.text,
    );
    expect(home.notes.map((n) => n.title)).toEqual(["Home"]);
    expect(work.notes.map((n) => n.title)).toEqual(["Work"]);
  });

  it("with encryption on, hands the host nothing but ciphertext", async () => {
    const fake = fakeHost();
    const crypto = { passwordRef: { current: "pw" } };
    await createICloudAdapter(fake.host, "default", crypto).save(
      serialize({
        notes: [plainNote({ title: SECRET_TITLE, body: SECRET_BODY })],
      }),
    );

    // Sealed per file, as on Dropbox: an opaque `.enc` note, no markdown.
    const paths = fake.paths();
    expect(paths.some((p) => p.endsWith(".enc"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".md"))).toBe(false);
    // Nothing that crossed to the host carries the note in the clear — not
    // its body, not its title, not in a file name.
    for (const { path, payload } of fake.writes) {
      expect(path).not.toContain("Secret");
      if (path.endsWith(KEY_PARAMS_FILE)) continue; // salts only
      expect(payload).not.toContain(SECRET_BODY);
      expect(payload).not.toContain(SECRET_TITLE);
    }

    // The same passphrase on another device opens it.
    const b = createICloudAdapter(fake.host, "default", {
      passwordRef: { current: "pw" },
    });
    const restored = parse((await b.load())!.text).notes;
    expect(restored[0]!.title).toBe(SECRET_TITLE);
    expect(await b.fetchNoteBody!(restored[0]!)).toContain(SECRET_BODY);
  });
});

describe("the iCloud root stores", () => {
  it("keeps settings.json and namespaces.json at the container root", async () => {
    const fake = fakeHost();
    await createICloudSettingsStore(fake.host).save('{"theme":"dark"}');
    await createICloudNamespaceStore(fake.host).save("[]");
    expect(fake.files.has("settings.json")).toBe(true);
    expect(fake.files.has("namespaces.json")).toBe(true);
    expect(await createICloudSettingsStore(fake.host).load()).toBe(
      '{"theme":"dark"}',
    );
  });
});

describe("deleteICloudNamespace", () => {
  it("removes every file under the namespace's folder and nothing else", async () => {
    const fake = fakeHost();
    await createICloudAdapter(fake.host).save(
      serialize({ notes: [plainNote({ title: "Keep" })] }),
    );
    await createICloudAdapter(fake.host, "work").save(
      serialize({ notes: [plainNote({ title: "Drop" })] }),
    );

    await deleteICloudNamespace(fake.host, "work");

    expect(fake.paths().some((p) => p.startsWith("work/"))).toBe(false);
    expect(fake.paths().some((p) => p.startsWith("notes/"))).toBe(true);
  });

  it("never touches the default namespace, whose files share the root", async () => {
    const fake = fakeHost();
    await createICloudAdapter(fake.host).save(
      serialize({ notes: [plainNote()] }),
    );
    const before = fake.paths();
    await deleteICloudNamespace(fake.host, "default");
    expect(fake.paths()).toEqual(before);
  });
});

describe("iCloud paths and bytes", () => {
  it("names the folder the user finds in the Files app", () => {
    expect(icloudNotesPath()).toBe("iCloud Drive/Notes/notes");
    expect(icloudNotesPath("work")).toBe("iCloud Drive/Notes/work/notes");
  });

  it("round-trips bytes through base64, past the spread limit", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });
});
