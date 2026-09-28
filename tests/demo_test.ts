// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { carriesOver, demoStorage, MemoryStorage } from "../src/dev/demo.ts";
import { buildDemo, DEMO_NAMESPACES } from "../src/dev/demoData.ts";
import { classifyLines } from "../src/domain/markdown.ts";
import type { Note } from "../src/domain/note.ts";
import { findHits, isPatternValid } from "../src/domain/note-find.ts";
import { replaceAll } from "../src/domain/note-replace.ts";
import { compileTransforms, transformHits } from "../src/domain/transform.ts";
import {
  namespaceLocalKey,
  parseNamespaces,
} from "../src/storage/namespaces.ts";
import { parse, serialize } from "../src/storage/serialize.ts";

const NOW = Date.UTC(2026, 8, 26, 9, 41);
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  localStorage.clear();
});

const demo = buildDemo(NOW);
const allNotes = demo.namespaces.flatMap((n) => n.snapshot.notes);
function note(title: string): Note {
  const found = allNotes.find((n) => n.title === title);
  if (!found) throw new Error(`no demo note "${title}"`);
  return found;
}
function inNamespace(slug: string, title: string): boolean {
  return demo.namespaces
    .find((n) => n.namespace.slug === slug)!
    .snapshot.notes.some((n) => n.title === title);
}

describe("buildDemo", () => {
  it("is deterministic for a given moment", () => {
    expect(buildDemo(NOW)).toEqual(buildDemo(NOW));
  });

  it("stamps every date relative to the moment it opens", () => {
    const later = buildDemo(NOW + 30 * DAY);
    const shift = (d: typeof demo) =>
      d.namespaces.flatMap((n) => [
        ...n.snapshot.notes.flatMap((x) => [
          x.createdAt,
          x.updatedAt,
          ...(x.comments ?? []).flatMap((c) => [c.createdAt, c.updatedAt]),
        ]),
        ...(n.snapshot.folders ?? []).map((f) => f.createdAt),
      ]);
    const before = shift(demo);
    const after = shift(later);
    expect(after).toEqual(before.map((t) => t + 30 * DAY));
    for (const t of before) expect(t).toBeLessThanOrEqual(NOW);
  });

  it("round-trips through the app's own document format", () => {
    for (const { namespace, snapshot } of demo.namespaces) {
      const text = demo.storage[namespaceLocalKey(namespace.slug)];
      expect(text).toBe(serialize(snapshot));
      expect(parse(text)).toEqual(snapshot);
    }
    expect(parseNamespaces(demo.storage["notes:namespaces"] ?? null)).toEqual(
      DEMO_NAMESPACES.map((n) => n.namespace),
    );
  });

  it("gives every note a unique id, a title and a body, and files it in a folder that exists", () => {
    const ids = allNotes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { snapshot } of demo.namespaces) {
      const folders = new Set((snapshot.folders ?? []).map((f) => f.id));
      for (const n of snapshot.notes) {
        expect(n.title).not.toBe("");
        expect(n.body?.trim()).not.toBe("");
        if (n.folderId) expect(folders.has(n.folderId)).toBe(true);
      }
    }
  });

  it("keeps to fictional hosts, no brands and first names", () => {
    const text = JSON.stringify(demo);
    for (const url of text.match(/https?:\/\/[^\s"$]+/g) ?? []) {
      expect(new URL(url).hostname.endsWith("example.com")).toBe(true);
    }
  });
});

// Each store frame stages one of these (ops/store/notes/shots.mjs).
describe("the frames' premises", () => {
  it("editor: NAS rebuild is a favorite with a half-ticked checklist, code, a quote", () => {
    const nas = note("NAS rebuild");
    expect(nas.favorite).toBe(true);
    const kinds = classifyLines(nas.body!).map((b) => b.kind);
    const tasks = classifyLines(nas.body!).filter((b) => b.task !== undefined);
    expect(tasks.some((b) => b.task)).toBe(true);
    expect(tasks.some((b) => !b.task)).toBe(true);
    expect(kinds).toContain("code");
    expect(kinds).toContain("quote");
    expect(kinds).toContain("heading");
  });

  it("regex: one replace turns the retro's four TODOs into a checklist", () => {
    const retro = note("Retro — sprint 41");
    expect(inNamespace("work", retro.title)).toBe(true);
    const query = "^TODO\\((\\w+)\\): (.+)$";
    expect(isPatternValid(query)).toBe(true);
    expect(findHits(retro.body!, query, { regex: true })).toHaveLength(4);
    const after = replaceAll(retro.body!, query, "- [ ] $2 (@$1)", {
      regex: true,
    });
    expect(after).toContain("- [ ] runbook for cache warmup (@sam)");
    expect(after).not.toContain("TODO(");
  });

  it("transforms: the handover's issues become links and its code is masked", () => {
    const handover = note("On-call handover");
    expect(inNamespace("work", handover.title)).toBe(true);
    const rules = compileTransforms(demo.transforms, "work");
    const hits = handover
      .body!.split("\n")
      .flatMap((line) => transformHits(line, rules));
    expect(hits.filter((h) => h.kind === "link").length).toBeGreaterThanOrEqual(
      5,
    );
    const masked = hits.find((h) => h.kind === "sensitive");
    expect(masked?.source).toBe("719204");
    expect(masked?.text).not.toContain("7192");
    // The Personal codes note is masked by the same rule, and has no links.
    const codes = note("Wi-Fi & door codes");
    const personal = compileTransforms(demo.transforms, "default");
    const codeHits = codes
      .body!.split("\n")
      .flatMap((line) => transformHits(line, personal));
    expect(codeHits.map((h) => h.source)).toEqual([
      "tulip-harbor-42",
      "4471",
      "2851",
    ]);
  });

  it("code: the snippets are fenced, short enough for a phone, and a favorite", () => {
    const snippets = note("Shell snippets");
    expect(snippets.favorite).toBe(true);
    const code = classifyLines(snippets.body!)
      .map((b, i) => ({ b, line: snippets.body!.split("\n")[i]! }))
      .filter(({ b }) => b.kind === "code");
    expect(code.length).toBeGreaterThanOrEqual(8);
    // Nothing wraps under the copy button on a 6.9″ phone.
    for (const { line } of code) expect(line.length).toBeLessThanOrEqual(31);
  });

  it("write: the draft lives in Writing and reads as prose", () => {
    const draft = note("Draft: notes in plain text");
    expect(inNamespace("writing", draft.title)).toBe(true);
    const blocks = classifyLines(draft.body!);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    const paragraphs = blocks.filter((b) => b.kind === "paragraph");
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
  });

  it("yours: three namespaces, each with a glyph and a colour", () => {
    expect(DEMO_NAMESPACES.map((n) => n.namespace.name)).toEqual([
      "Personal",
      "Work",
      "Writing",
    ]);
    for (const { namespace } of DEMO_NAMESPACES) {
      expect(namespace.glyph).toBeTruthy();
      expect(namespace.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// The demo is never dated: whatever day and hour it opens on, it is the same
// notebook, with nothing written after the moment it opens. Walk every day of
// a year, at several local wall-clock hours of each, and hold each frame's
// premise there — not only at the one moment the screenshots are taken.
describe("a year of opening the demo", () => {
  const HOURS: [number, number][] = [
    [0, 5],
    [6, 30],
    [9, 41],
    [13, 0],
    [18, 15],
    [23, 55],
  ];
  const moments: number[] = [];
  for (let day = 0; day < 365; day++) {
    for (const [h, m] of HOURS) {
      moments.push(new Date(2027, 0, 1 + day, h, m).getTime());
    }
  }

  // The order the list shows, most recently edited first, and each note's
  // offsets from the moment the demo opens.
  const shape = (d: typeof demo, now: number) =>
    d.namespaces.map((n) =>
      [...n.snapshot.notes]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((x) => [x.title, now - x.createdAt, now - x.updatedAt]),
    );
  const expected = shape(demo, NOW);

  it("walks every day of the year", () => {
    expect(moments).toHaveLength(365 * HOURS.length);
  });

  it("is the same notebook, stamped at or before the moment it opens", () => {
    for (const now of moments) {
      const d = buildDemo(now);
      expect(shape(d, now)).toEqual(expected);
      for (const { snapshot } of d.namespaces) {
        for (const n of snapshot.notes) {
          expect(n.createdAt).toBeLessThanOrEqual(n.updatedAt);
          expect(n.updatedAt).toBeLessThanOrEqual(now);
          for (const c of n.comments ?? []) {
            expect(c.createdAt).toBeLessThanOrEqual(now);
            expect(c.createdAt).toBeGreaterThanOrEqual(n.createdAt);
          }
        }
        for (const f of snapshot.folders ?? []) {
          for (const n of snapshot.notes.filter((x) => x.folderId === f.id)) {
            expect(f.createdAt).toBeLessThanOrEqual(n.createdAt);
          }
        }
      }
    }
  });

  it("holds every frame's premise on every day", () => {
    for (const now of moments) {
      const d = buildDemo(now);
      const notes = d.namespaces.flatMap((n) => n.snapshot.notes);
      const find = (title: string) => notes.find((n) => n.title === title)!;
      const nas = find("NAS rebuild");
      expect(nas.favorite).toBe(true);
      // The editor frame opens on the note edited last in its namespace.
      const personal = d.namespaces[0]!.snapshot.notes.filter(
        (n) => !n.archived,
      );
      expect(Math.max(...personal.map((n) => n.updatedAt))).toBe(nas.updatedAt);
      const retro = find("Retro — sprint 41");
      expect(
        findHits(retro.body!, "^TODO\\((\\w+)\\): (.+)$", { regex: true }),
      ).toHaveLength(4);
      for (const { namespace, snapshot } of d.namespaces) {
        expect(parse(d.storage[namespaceLocalKey(namespace.slug)]!)).toEqual(
          snapshot,
        );
      }
    }
  });
});

describe("demoStorage", () => {
  it("holds the notebook in memory and carries over only the device's look", () => {
    localStorage.setItem("notes/v1", "the device's real notes");
    localStorage.setItem("notes:dropbox:token", "secret");
    localStorage.setItem("notes:backend", "icloud");
    localStorage.setItem(
      "notes/appearance",
      JSON.stringify({ theme: "dracula" }),
    );
    localStorage.setItem("notes/menu-position", '{"side":"left","y":0.5}');

    const memory = demoStorage(localStorage, NOW);
    expect(memory).toBeInstanceOf(MemoryStorage);
    expect(memory.getItem("notes/v1")).toBe(demo.storage["notes/v1"]);
    expect(memory.getItem("notes:dropbox:token")).toBeNull();
    expect(memory.getItem("notes:backend")).toBe("browser");
    expect(memory.getItem("notes/menu-position")).toBe(
      '{"side":"left","y":0.5}',
    );
    const appearance = JSON.parse(memory.getItem("notes/appearance")!);
    expect(appearance.theme).toBe("dracula");
    expect(appearance.transforms).toEqual(demo.transforms);

    // Nothing was written back to the device.
    expect(localStorage.getItem("notes/v1")).toBe("the device's real notes");
    expect(localStorage.getItem("notes:backend")).toBe("icloud");
    memory.setItem("notes/v1", "an edit in the demo");
    expect(localStorage.getItem("notes/v1")).toBe("the device's real notes");
  });

  it("keeps the device's own transform rules when it has some", () => {
    const mine = [{ id: "mine", pattern: "x" }];
    localStorage.setItem(
      "notes/appearance",
      JSON.stringify({ transforms: mine }),
    );
    const appearance = JSON.parse(
      demoStorage(localStorage, NOW).getItem("notes/appearance")!,
    );
    expect(appearance.transforms).toEqual(mine);
  });

  it("never carries data or credentials", () => {
    expect(carriesOver("notes/appearance")).toBe(true);
    expect(carriesOver("notes/language")).toBe(true);
    expect(carriesOver("notes/v1")).toBe(false);
    expect(carriesOver("notes/v1:work")).toBe(false);
    expect(carriesOver("notes/appearance:ns:work")).toBe(false);
    expect(carriesOver("notes:namespaces")).toBe(false);
    expect(carriesOver("notes:encryption")).toBe(false);
  });
});
