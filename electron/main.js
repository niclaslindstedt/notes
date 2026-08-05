// The desktop shell's whole main process. It is a window showing the bundled
// web app and nothing else — no IPC, no preload, no storage, no menus of its
// own. Anything that looks like a feature belongs in `../src/`, not here (see
// AGENTS.md, "The wrappers are thin — put the logic in the PWA").
//
// Plain CommonJS rather than TypeScript on purpose: compiling one file would
// mean a `dist/`, a build to run before both `electron .` and packaging, and a
// `main` field pointing at generated output — so the file that runs would stop
// being the file you read. `// @ts-check` below buys the type safety without
// any of that: `npm run typecheck` checks this against Electron's own
// `electron.d.ts`, with no emit and nothing to keep in sync (see
// `jsconfig.json`).
//
// The one non-obvious choice is the private `notes://app` scheme instead of
// `loadFile`. Every note lives in `localStorage`, which is keyed by origin,
// and a `file://` page is an opaque origin — the notes would be at the mercy
// of where the app happens to be installed. A registered standard scheme is a
// constant, so an update (or a move to another folder) keeps the same notes.
// It has to be registered before `ready`; a scheme registered late loads the
// page as an opaque origin anyway, with no `localStorage` at all.

// @ts-check

const {
  app,
  BrowserWindow,
  net,
  protocol,
  screen,
  shell,
} = require("electron");
const {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} = require("node:fs");
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
 *
 * @param {string} pathname The request URL's path, still percent-encoded.
 * @returns {string | null} An absolute path inside the webroot, or null.
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

/**
 * WHERE THE WINDOW WAS LAST TIME.
 *
 * The one piece of state that legitimately lives in the shell: a web page
 * cannot size or place its own OS window, so there is nowhere in `../src/` to
 * put this (see AGENTS.md, "The wrappers are thin"). It is kept beside the
 * app's own data rather than in `localStorage` for the same reason — the
 * renderer never learns about it.
 *
 * Read back defensively: the file is user-writable, a partial write survives a
 * power cut, and a wrong shape here would take the window down on launch with
 * no UI to report it. Anything that isn't two numbers falls through to the
 * defaults.
 */
function stateFile() {
  return join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  let saved;
  try {
    saved = JSON.parse(readFileSync(stateFile(), "utf8"));
  } catch {
    return null;
  }
  if (!saved || typeof saved !== "object") return null;
  const { x, y, width, height, maximized } = saved;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

  // A window restored onto a display that has since been unplugged — or a
  // laptop reopened away from its desk monitor — is a window the user cannot
  // reach and cannot drag back. Keep the remembered SIZE but drop the position
  // unless the saved rectangle still overlaps some display's work area, which
  // lets the OS place it on the screen that does exist.
  const onScreen =
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    screen.getAllDisplays().some(({ workArea: a }) => {
      return (
        x < a.x + a.width &&
        x + width > a.x &&
        y < a.y + a.height &&
        y + height > a.y
      );
    });

  return {
    width,
    height,
    maximized: maximized === true,
    ...(onScreen ? { x, y } : {}),
  };
}

/** @param {import("electron").BrowserWindow} win */
function saveWindowState(win) {
  if (win.isDestroyed()) return;
  // `getNormalBounds`, not `getBounds`: a maximized or full-screen window
  // reports the screen's size, which would then become the size it restores to
  // when the user un-maximizes it — the window would never shrink back.
  const { x, y, width, height } = win.getNormalBounds();
  try {
    writeFileSync(
      stateFile(),
      JSON.stringify({ x, y, width, height, maximized: win.isMaximized() }),
    );
  } catch {
    // A window that cannot be remembered is not worth failing a quit over.
  }
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state?.width ?? 1100,
    height: state?.height ?? 800,
    // Left undefined when there is nothing sensible remembered, which is what
    // asks the OS to place the window itself.
    x: state?.x,
    y: state?.y,
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

  if (state?.maximized) win.maximize();

  win.loadURL(`${ORIGIN}/index.html`);

  // Written on close rather than on every resize: one write, at the only
  // moment the answer is final. `close` fires before the window is destroyed,
  // so the bounds are still readable — including on Cmd+Q and on the
  // `window-all-closed` quit below.
  win.on("close", () => saveWindowState(win));

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
 * use — `shell.openExternal` will launch anything the OS has registered.
 * @param {string} url */
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
