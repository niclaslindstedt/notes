import { describe, expect, it } from "vitest";

import { createNote, type Note } from "../../src/domain/note.ts";
import { RateLimitError } from "../../src/storage/adapter.ts";
import { runEncryptionMigration } from "../../src/storage/encryption-migration.ts";

function notes(n: number): Note[] {
  return Array.from({ length: n }, (_, i) => createNote(i + 1));
}

describe("runEncryptionMigration", () => {
  it("migrates every note once, reporting progress", async () => {
    const done: string[] = [];
    const progress: string[] = [];
    await runEncryptionMigration({
      notes: notes(3),
      migrateNote: async (note) => {
        done.push(note.id);
        return true;
      },
      onProgress: (id) => progress.push(id),
      paceMs: 0,
    });
    expect(done).toHaveLength(3);
    expect(progress).toEqual(done);
  });

  it("waits out a rate limit and resumes", async () => {
    const sleeps: number[] = [];
    let firstAttempt = true;
    await runEncryptionMigration({
      notes: notes(1),
      migrateNote: async () => {
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
      migrateNote: async (note) => {
        done.push(note.id);
        return true;
      },
      shouldStop: () => done.length >= 2,
      paceMs: 0,
    });
    expect(done).toHaveLength(2);
  });
});
