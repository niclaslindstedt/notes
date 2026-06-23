import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// compute-bump.mjs is the release-sizing brain: the Release workflow runs
// it with `bump: auto` and trusts the single word it prints on stdout to
// pick patch/minor/major. These tests drive the real script the way the
// workflow does — in a temp working directory holding fragment files —
// so the stdout contract and the type→bump mapping stay locked down.

const SCRIPT = join(process.cwd(), "scripts", "release", "compute-bump.mjs");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compute-bump-"));
  mkdirSync(join(dir, ".changes", "unreleased"), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fragment(name: string, front: string, body = "A change."): void {
  writeFileSync(
    join(dir, ".changes", "unreleased", name),
    `---\n${front}\n---\n\n${body}\n`,
  );
}

// Returns the trimmed stdout (the resolved bump word).
function run(): string {
  return execFileSync("node", [SCRIPT], { cwd: dir, encoding: "utf8" }).trim();
}

describe("compute-bump", () => {
  it("maps Fixed/Security fragments to patch", () => {
    fragment("1-a.md", "type: Fixed");
    fragment("2-b.md", "type: Security");
    expect(run()).toBe("patch");
  });

  it("escalates to minor for Added/Changed/Removed/Deprecated", () => {
    fragment("1-a.md", "type: Fixed");
    fragment("2-b.md", "type: Added");
    expect(run()).toBe("minor");

    fragment("3-c.md", "type: Removed");
    expect(run()).toBe("minor");
  });

  it("takes the highest level across all fragments", () => {
    fragment("1-a.md", "type: Fixed");
    fragment("2-b.md", "type: Changed");
    fragment("3-c.md", "type: Security");
    expect(run()).toBe("minor");
  });

  it("forces major when any fragment is flagged breaking", () => {
    fragment("1-a.md", "type: Fixed");
    fragment("2-b.md", "type: Removed\nbreaking: true");
    expect(run()).toBe("major");
  });

  it("treats yes/1 as breaking too, and anything else as not", () => {
    fragment("1-a.md", "type: Added\nbreaking: yes");
    expect(run()).toBe("major");

    fragment("1-a.md", "type: Added\nbreaking: false");
    expect(run()).toBe("minor");
  });

  it("prints only the bump word on stdout, nothing else", () => {
    fragment("1-a.md", "type: Changed");
    expect(run()).toBe("minor");
  });

  it("exits non-zero when there are no fragments", () => {
    expect(() => run()).toThrow();
  });

  it("fails loudly on an unknown type", () => {
    fragment("1-a.md", "type: Bogus");
    expect(() => run()).toThrow();
  });
});
