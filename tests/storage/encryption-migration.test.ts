import { describe, expect, it } from "vitest";

import { createNote, type Note } from "../../src/domain/note.ts";
import {
  AuthError,
  ConflictError,
  RateLimitError,
  type StoredSnapshot,
} from "../../src/storage/adapter.ts";
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

  it("retries a transient failure with backoff, then resumes the same note", async () => {
    const sleeps: number[] = [];
    const retries: number[] = [];
    const list = notes(2);
    const firstId = list[0]!.id;
    let firstAttempts = 0;
    const converted: string[] = [];
    await runEncryptionMigration({
      notes: list,
      convert: async (note) => {
        // The first note's first two attempts drop the connection ("Load
        // failed"); the third succeeds and the second note converts cleanly.
        if (note.id === firstId) {
          firstAttempts += 1;
          if (firstAttempts <= 2) throw new Error("Load failed");
        }
        converted.push(note.id);
        return true;
      },
      onRetry: (_note, _err, attempt) => retries.push(attempt),
      paceMs: 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    // Both notes end up converted (nothing stranded half-done)...
    expect(converted).toEqual([firstId, list[1]!.id]);
    // ...after two backoff waits whose 1-based attempt numbers were reported.
    expect(retries).toEqual([1, 2]);
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every((ms) => ms > 0)).toBe(true);
  });

  it("gives up after the transient-retry budget so it doesn't spin forever", async () => {
    let attempts = 0;
    const retries: number[] = [];
    await expect(
      runEncryptionMigration({
        notes: notes(1),
        convert: async () => {
          attempts += 1;
          throw new Error("Load failed");
        },
        onRetry: (_note, _err, attempt) => retries.push(attempt),
        maxTransientRetries: 3,
        paceMs: 0,
        sleep: async () => {},
      }),
    ).rejects.toThrow("Load failed");
    // 1 initial attempt + 3 retries, then it aborts (resumes on the next mount).
    expect(attempts).toBe(4);
    expect(retries).toEqual([1, 2, 3]);
  });

  it("aborts immediately on a permanent error without retrying", async () => {
    for (const permanent of [
      new AuthError("expired"),
      new ConflictError({ text: "{}" } as StoredSnapshot),
    ]) {
      let attempts = 0;
      let retried = false;
      await expect(
        runEncryptionMigration({
          notes: notes(1),
          convert: async () => {
            attempts += 1;
            throw permanent;
          },
          onRetry: () => {
            retried = true;
          },
          paceMs: 0,
          sleep: async () => {},
        }),
      ).rejects.toBe(permanent);
      // No retries — auth/conflict have their own UI and can't be waited out.
      expect(attempts).toBe(1);
      expect(retried).toBe(false);
    }
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
