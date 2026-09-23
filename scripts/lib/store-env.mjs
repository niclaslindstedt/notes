// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// THE STORE PIPELINE'S ENVIRONMENT — the two or three values a submission
// needs that must never be committed, read the way the tools that consume
// them read one.
//
// Everything else in a listing is copy and lives in `native/store/listing.ts`.
// These are not copy: an App Store Connect key is a credential, and the review
// PHONE NUMBER is a personal detail Apple actually rings. THIS REPOSITORY IS
// PUBLIC, so both come out of `native/.env` (gitignored) or the process
// environment, and the committed `native/.env.example` documents each one.
//
// Two rules live here rather than in each caller, because both are how a
// checkout ends up "configured" without working:
//
//   1. A HALF-FILLED TEMPLATE CONFIGURES NOTHING. A value still equal to the
//      one in `.env.example` counts as absent, so a copied template does not
//      read as filled in.
//   2. A PLACEHOLDER PHONE IS NOT A PHONE. A run of zeros is the template,
//      not a badly typed number, and treating it as set is how a listing
//      reaches review with nobody on the other end of the line.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

/** A `KEY=value` file, parsed the way dotenv parses one. Missing file → {}. */
export function parseEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * The values the submission tools would see: `native/.env`, with the process
 * environment winning and a leftover from `.env.example` treated as absent.
 *
 * `exists` is about the FILE, not about any value in it — a report needs to
 * be able to say "copy the template" rather than name eight missing keys.
 */
export function nativeEnv(root) {
  const dir = join(root, "native");
  const file = join(dir, ".env");
  const dotenv = parseEnvFile(file);
  const template = parseEnvFile(join(dir, ".env.example"));
  return {
    file,
    dir,
    exists: existsSync(file),
    value(key) {
      const value = process.env[key] ?? dotenv[key] ?? "";
      if (!value) return "";
      return value === template[key] ? "" : value;
    },
  };
}

/** A number that is really the shipped placeholder rather than a real line. */
const isPlaceholder = (phone) => /0{6,}/.test(phone.replace(/[\s-]/g, ""));

/**
 * The App Store review contact number, or "" when nobody has set one.
 *
 * It is the one listing field that behaves like a credential: Apple rings it,
 * so it has to be a line somebody answers, and committing one publishes it to
 * everybody who ever clones this tree. Every caller reports the gap instead of
 * shipping a placeholder — `make store-preflight` fails on it, and the
 * metadata generator drops the field rather than hand review a dead number.
 */
export function reviewPhone(root) {
  const fromEnv = nativeEnv(root).value("ASC_REVIEW_PHONE");
  return fromEnv && !isPlaceholder(fromEnv) ? fromEnv : "";
}

/**
 * The App Store Connect API key, resolved as `fastlane deliver` resolves it:
 * a key id, an issuer id, and the `.p8` from either a path (relative to
 * `native/`, where the lanes run) or a base64 blob for CI.
 *
 * Never throws — `missing` is the list of what to tell the operator, so one
 * report can name every gap at once instead of one per run.
 */
export function ascCredentials(root) {
  const env = nativeEnv(root);
  const keyId = env.value("ASC_KEY_ID");
  const issuerId = env.value("ASC_ISSUER_ID");
  const keyPath = env.value("ASC_KEY_PATH");
  const keyContent = env.value("ASC_KEY_CONTENT");

  const missing = [];
  if (!keyId) missing.push("ASC_KEY_ID — the id in the AuthKey_<KEY_ID>.p8 filename");
  if (!issuerId) missing.push("ASC_ISSUER_ID — one per team, above the key list (a UUID)");

  let keyFile = "";
  if (keyPath && keyContent) {
    missing.push(
      "exactly one of ASC_KEY_PATH / ASC_KEY_CONTENT — both are set, and the loser " +
        "is silently ignored",
    );
  } else if (keyContent) {
    keyFile = "(from ASC_KEY_CONTENT)";
  } else if (keyPath) {
    const resolved = join(env.dir, keyPath);
    if (existsSync(resolved)) keyFile = resolved;
    else {
      missing.push(
        `ASC_KEY_PATH → ${keyPath} does not exist (a relative path resolves against ` +
          "native/, where fastlane runs)",
      );
    }
  } else {
    missing.push(
      "ASC_KEY_PATH or ASC_KEY_CONTENT — App Store Connect → Users and Access → " +
        "Integrations → an App Manager key. The .p8 downloads exactly once",
    );
  }

  return { keyId, issuerId, keyFile, missing, envFile: env.file };
}
