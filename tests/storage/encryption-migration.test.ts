import { describe, expect, it } from "vitest";

import { createNote, type Note } from "../../src/domain/note.ts";
import { RateLimitError } from "../../src/storage/adapter.ts";
import { runEncryptionMigration } from "../../src/storage/encryption-migration.ts";

function notes(n: number): Note[] {
  return Array.from({ length: n }, (_, i) => createNote(i + 1));
}

describe("runEncryptionMigration", () => {
  it("converts every note once, reporting per-note completion", async () => {
    const done: string[] = [];
    const finished: string[] = [];
    await runEncryptionMigration({
      notes: notes(3),
      convert: async (note) => {
        done.push(note.id);
        return true;
      },
      onNoteDone: (note) => finished.push(note.id),
      paceMs: 0,
    });
    expect(done).toHaveLength(3);
    expect(finished).toEqual(done);
  });

  it("reports fine-grained steps the converter emits", async () => {
    const steps: string[] = [];
    await runEncryptionMigration({
      notes: notes(1),
      convert: async (_note, onStep) => {
        onStep?.({ phase: "attachment", filename: "pic.png" });
        onStep?.({ phase: "note" });
        return true;
      },
      onStep: (_note, step) =>
        steps.push(step.phase === "attachment" ? step.filename : "note"),
      paceMs: 0,
    });
    expect(steps).toEqual(["pic.png", "note"]);
  });

  it("waits out a rate limit and resumes", async () => {
    const sleeps: number[] = [];
    let firstAttempt = true;
    await runEncryptionMigration({
      notes: notes(1),
      convert: async () => {
        if (firstAttempt) {
          firstAttempt = false;
          throw new RateLimitError(5000);
        }
        return true;
      },
      paceMs: 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    // Slept at least the cooldown the rate limit asked for, then succeeded.
    expect(sleeps.some((ms) => ms >= 5000)).toBe(true);
  });

  it("stops early when asked", async () => {
    const done: string[] = [];
    await runEncryptionMigration({
      notes: notes(5),
      convert: async (note) => {
        done.push(note.id);
        return true;
      },
      shouldStop: () => done.length >= 2,
      paceMs: 0,
    });
    expect(done).toHaveLength(2);
  });
});
