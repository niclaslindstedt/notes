// The desktop shell's whole main process. It is a window showing the bundled
// web app and nothing else — no IPC, no preload, no storage, no menus of its
// own. Anything that looks like a feature belongs in `../src/`, not here (see
// AGENTS.md, "The wrappers are thin — put the logic in the PWA").
//
// It owns exactly two things a web page cannot do for itself: remember the
// window's size and position, and hold open a loopback HTTP listener for one
// OAuth redirect. Neither decides anything — the page asks, the shell answers.
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
const { createServer } = require("node:http");
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
 * A LOOPBACK LISTENER FOR ONE OAUTH REDIRECT.
 *
 * The other thing a web page cannot do for itself. The app is served from
 * `notes://app`, and no OAuth provider will register a custom scheme as a
 * redirect URI — which is why cloud sync was simply withheld on the desktop.
 * The way out is the one RFC 8252 prescribes for native apps: send the user to
 * the provider in their real browser, and catch the redirect on a loopback
 * server the app opens for the occasion.
 *
 * The shell holds the socket and nothing else. It does not know which provider
 * is being connected, what scopes were asked for, or what the code is worth —
 * `../src/storage/oauth-pkce.ts` builds the authorization URL, checks `state`,
 * and trades the code for tokens. This answers two questions: "what URI can I
 * be redirected to?" and "what came back?".
 *
 * Bound to `127.0.0.1` — never `0.0.0.0`, which would put a listener holding a
 * live authorization code on the local network.
 */

// A fixed, tiny set rather than an ephemeral port: providers match redirect
// URIs exactly, so every port the app might use has to be registered on the
// OAuth app up front (see `../src/storage/dropbox/index.ts`). Three is enough
// slack for something else already holding the first one, and few enough to
// register by hand.
const LOOPBACK_PORTS = [53682, 53683, 53684];

// Long enough to find the browser window, sign in, and approve; short enough
// that an abandoned flow doesn't leave a socket open for the session. The
// listener also closes the moment a redirect arrives.
const LOOPBACK_TIMEOUT_MS = 5 * 60_000;

// Shown in the browser tab the provider redirected. Deliberately plain and
// self-contained: it is served by a socket that is about to close, so it can
// reference nothing — including the app's own name, which the packaged build
// gets from a build variable this string has no access to.
const LOOPBACK_DONE_PAGE = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>Signed in</title>
<style>html{color-scheme:dark light}body{margin:0;min-height:100vh;display:flex;
align-items:center;justify-content:center;background:#1f2933;color:#e6edf3;
font:16px/1.5 system-ui,sans-serif}p{text-align:center;padding:2rem}</style>
</head><body><p>You&rsquo;re connected.<br>You can close this tab.</p></body></html>`;

/**
 * The current flow: its socket while one is open, and its outcome for as long
 * as nobody has asked for it.
 *
 * The socket and the flow are deliberately separate lifetimes. The listener
 * closes the instant a redirect lands, but the result has to outlive it — the
 * page asks for the redirect URI, opens the browser, and only then asks what
 * came back, and a provider the user has already authorized can redirect
 * inside that gap. Tying the two together would drop exactly the fastest,
 * most ordinary sign-in on the floor.
 *
 * @type {{
 *   server: import("node:http").Server | null,
 *   redirectUri: string,
 *   result: Promise<{ query: string } | { error: string }>,
 * } | null}
 */
let loopback = null;

/** Close the socket, keeping the flow's result readable. */
function closeLoopbackSocket() {
  const server = loopback?.server;
  if (!server || !loopback) return;
  loopback.server = null;
  server.close();
  // `close` only stops NEW connections; a browser holding the socket open with
  // keep-alive would keep the port bound, and the next flow would step down to
  // the following port for no reason. The response has already been flushed by
  // every path that gets here.
  server.closeAllConnections();
}

/** Close the socket and forget the flow entirely. */
function discardLoopback() {
  closeLoopbackSocket();
  loopback = null;
}

/**
 * @param {import("node:http").Server} server
 * @param {number} port
 * @returns {Promise<void>}
 */
function listenOnPort(server, port) {
  return new Promise((resolvePort, rejectPort) => {
    const onError = (/** @type {Error} */ err) => {
      server.off("listening", onListening);
      rejectPort(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePort();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Open a one-shot loopback listener and report the URI to be redirected to.
 * Replaces any listener already waiting — a second connect attempt supersedes
 * the first, and two sockets waiting for one redirect is never right.
 *
 * @returns {Promise<string>} The redirect URI to hand the provider.
 */
async function startLoopback() {
  discardLoopback();

  /** @type {(value: { query: string } | { error: string }) => void} */
  let settle = () => {};
  /** @type {Promise<{ query: string } | { error: string }>} */
  const result = new Promise((res) => {
    settle = res;
  });

  const server = createServer((req, res) => {
    let search = "";
    try {
      search = new URL(req.url ?? "/", "http://127.0.0.1").search;
    } catch {
      search = "";
    }
    // Browsers ask for `/favicon.ico` off their own bat. Anything without a
    // query string is not the redirect, so it must not end the wait.
    if (!search) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    // Settle on `finish`, not before: closing tears the socket down, and the
    // browser has to have the page first or the user is left looking at a
    // connection error after a successful sign-in.
    res.on("finish", () => {
      settle({ query: search.slice(1) });
      closeLoopbackSocket();
    });
    res.end(LOOPBACK_DONE_PAGE);
  });

  let bound = null;
  for (const port of LOOPBACK_PORTS) {
    try {
      await listenOnPort(server, port);
      bound = port;
      break;
    } catch {
      // In use by something else (or by a listener this app has not finished
      // closing) — try the next one.
    }
  }
  if (bound === null) {
    server.close();
    throw new Error("no loopback port available");
  }

  const timer = setTimeout(() => {
    settle({ error: "timed out waiting for the authorization redirect" });
    closeLoopbackSocket();
  }, LOOPBACK_TIMEOUT_MS);
  // An abandoned sign-in must not be the reason the app refuses to quit.
  timer.unref();
  void result.then(() => clearTimeout(timer));

  loopback = { server, redirectUri: `http://127.0.0.1:${bound}/`, result };
  return loopback.redirectUri;
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

/**
 * The loopback capability's whole surface, answered on the scheme the app is
 * already served from. This is why there is still no preload and no IPC: the
 * protocol handler is a request/response seam that exists anyway, and the page
 * reaches it with a plain `fetch` (see `../src/platform/desktop-bridge.ts`,
 * which owns these two paths on the other side).
 *
 * `/__oauth/begin` opens the listener and answers with the redirect URI.
 * `/__oauth/await` resolves when the redirect lands — or when it times out.
 *
 * Under `__oauth/`, which `webrootFile` could never resolve to: Vite emits no
 * such directory, and a path that escaped the webroot is refused there anyway.
 *
 * @param {string} pathname
 * @returns {Promise<Response> | null} null when this is not a loopback request.
 */
function handleLoopbackRequest(pathname) {
  if (pathname === "/__oauth/begin") {
    return startLoopback().then(
      (redirectUri) => Response.json({ redirectUri }),
      (err) => Response.json({ error: String(err?.message ?? err) }),
    );
  }
  if (pathname === "/__oauth/await") {
    // A wait with no flow behind it is a bug in the page, not a redirect that
    // will arrive — answer rather than hang forever. It is NOT what a redirect
    // that already landed looks like: that flow is still here, with its result
    // settled and waiting to be read.
    if (!loopback) return Promise.resolve(Response.json({ error: "no flow" }));
    return loopback.result.then((value) => Response.json(value));
  }
  return null;
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const loopbackResponse = handleLoopbackRequest(pathname);
    if (loopbackResponse) return loopbackResponse;

    const file = webrootFile(pathname);
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
  // A sign-in the user walked away from must not keep a socket bound after the
  // window it was started from is gone.
  discardLoopback();
  if (process.platform !== "darwin") app.quit();
});
