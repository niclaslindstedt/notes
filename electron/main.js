// The desktop shell's whole main process. It is a window showing the bundled
// web app and nothing else — no IPC, no preload, no storage, no menus of its
// own. Anything that looks like a feature belongs in `../src/`, not here (see
// AGENTS.md, "The wrappers are thin — put the logic in the PWA").
//
// Plain CommonJS rather than TypeScript on purpose: a compile step would mean
// a tsconfig, a `dist/`, and a build to keep in sync, for one file that only
// ever calls Electron's own API.
//
// The one non-obvious choice is the private `notes://app` scheme instead of
// `loadFile`. Every note lives in `localStorage`, which is keyed by origin,
// and a `file://` page is an opaque origin — the notes would be at the mercy
// of where the app happens to be installed. A registered standard scheme is a
// constant, so an update (or a move to another folder) keeps the same notes.
// It has to be registered before `ready`; a scheme registered late loads the
// page as an opaque origin anyway, with no `localStorage` at all.

const { app, BrowserWindow, net, protocol, shell } = require("electron");
const { existsSync, statSync } = require("node:fs");
const { join, normalize, resolve, sep } = require("node:path");
const { pathToFileURL } = require("node:url");

const SCHEME = "notes";
const ORIGIN = `${SCHEME}://app`;

/** The built web app, written here by `scripts/bundle-web.mjs`. `__dirname` is
 * this directory in both shapes the app takes — a checkout run with
 * `electron .`, and a packaged app where both sit inside `app.asar`. */
const WEBROOT = resolve(__dirname, "webroot");

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

/**
 * Resolve one request path to a file inside the webroot, or null when it
 * escapes or does not exist.
 *
 * The containment check is done on the resolved path rather than the raw
 * string, and the decode happens first so a `%2e%2e` cannot slip past it.
 */
function webrootFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // A NUL truncates a path in some syscalls — refuse outright.
  if (decoded.includes("\0")) return null;

  const candidate = resolve(WEBROOT, "." + normalize("/" + decoded));
  if (candidate !== WEBROOT && !candidate.startsWith(WEBROOT + sep))
    return null;
  if (!existsSync(candidate)) return null;
  if (!statSync(candidate).isDirectory()) return candidate;
  // The bundle is a single page; the app routes on the hash (`use-route.ts`),
  // so a directory — including the bare root — is always the app shell.
  const index = join(candidate, "index.html");
  return existsSync(index) ? index : null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 360,
    minHeight: 420,
    // Matches the PWA manifest's background_color so the first frame is the
    // app's own dark rather than a white flash.
    backgroundColor: "#1f2933",
    autoHideMenuBar: true,
    webPreferences: {
      // The renderer is the whole app, so it gets no privileges it does not
      // need: no Node, a sandbox, and an isolated context. There is no
      // preload to punch a hole in any of it.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(`${ORIGIN}/index.html`);

  // A link to somewhere else is the user asking their browser for it, not the
  // shell replacing the notes it is showing with a page that has no way back.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${ORIGIN}/`)) return;
    event.preventDefault();
    openExternally(url);
  });
}

/** Hand a URL to the desktop, but only the schemes a link can legitimately
 * use — `shell.openExternal` will launch anything the OS has registered. */
function openExternally(url) {
  const scheme = url.slice(0, url.indexOf(":") + 1);
  if (["http:", "https:", "mailto:"].includes(scheme))
    void shell.openExternal(url);
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, (request) => {
    const file = webrootFile(new URL(request.url).pathname);
    if (!file) return new Response("Not found", { status: 404 });
    // Electron's file loader sets the Content-Type from the extension, which
    // matters more than it looks: the app is ES modules, and a module served
    // as anything but a JavaScript type is refused with a blank window.
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
