// Builds the web app into `electron/webroot/`, which `main.js` serves from the
// private `notes://app` scheme.
//
// A script rather than an npm script line for one reason: the build needs
// `VITE_TARGET=electron` in the environment (relative asset base, no service
// worker — see vite.config.ts), and a `FOO=bar cmd` prefix is not a thing
// npm can run on Windows, where the release workflow packages the Windows
// build. Vite's own binary is invoked through `node` for the same reason —
// no `.cmd` shim, no shell.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VITE = fileURLToPath(
  new URL("../../node_modules/vite/bin/vite.js", import.meta.url),
);

execFileSync(
  process.execPath,
  [VITE, "build", "--outDir", "electron/webroot", "--emptyOutDir"],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, VITE_TARGET: "electron" },
  },
);
