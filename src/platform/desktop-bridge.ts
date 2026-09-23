// The seam to the Tauri shell, and the desktop counterpart of
// `./native-bridge.ts`. Where the native bridge talks over `postMessage`, this
// one talks over the private `notes:` scheme the desktop build is already
// served from: the shell answers every request on it, so two reserved paths
// are a request/response channel that costs it no IPC and no injected
// script.
//
// It carries exactly one capability, and only because a web page cannot have
// it: **a loopback listener for one OAuth redirect**. The app runs on the
// `notes:` scheme, which no provider will accept as a redirect URI, so the flow
// RFC 8252 prescribes for native apps is the only one available — open the
// provider in the real browser, catch the redirect on `127.0.0.1`.
//
// The shell holds the socket; every decision stays here and in
// `../storage/oauth-pkce.ts`. Inert everywhere else: on the web and in the
// native wrapper there is no `notes:` scheme to fetch, so these throw rather
// than pretending, and `capabilities().loopbackOauth` is what callers ask
// first.

import { capabilities } from "./capabilities.ts";

// The two paths the shell answers on (`tauri/shell/src/oauth.rs`), asked of
// the page's own origin — which is the shell's, however the platform spells
// it. Deliberately the same constants on both sides — change one and the
// connect flow fails with a 404 that looks like a missing asset.
const BEGIN_PATH = "/__oauth/begin";
const AWAIT_PATH = "/__oauth/await";

/** What the shell answers with on either path. */
type LoopbackReply = {
  redirectUri?: string;
  query?: string;
  error?: string;
};

async function ask(path: string): Promise<LoopbackReply> {
  if (!capabilities().loopbackOauth) {
    throw new Error(
      "The loopback redirect is only available in the desktop app",
    );
  }
  let res: Response;
  try {
    res = await fetch(`${window.location.origin}${path}`);
  } catch (err) {
    throw new Error(`Could not reach the desktop shell: ${String(err)}`, {
      cause: err,
    });
  }
  if (!res.ok) throw new Error(`Desktop shell refused ${path}: ${res.status}`);
  return (await res.json()) as LoopbackReply;
}

/**
 * Open a one-shot loopback listener and resolve with the redirect URI to hand
 * the provider (`http://127.0.0.1:<port>/`). Supersedes any listener already
 * waiting, so an abandoned connect attempt does not strand a socket.
 */
export async function beginLoopbackRedirect(): Promise<string> {
  const reply = await ask(BEGIN_PATH);
  if (reply.error) throw new Error(reply.error);
  if (!reply.redirectUri) {
    throw new Error("Desktop shell returned no redirect URI");
  }
  return reply.redirectUri;
}

/**
 * Resolve with the redirect's query parameters once the provider sends the
 * browser back to the loopback listener. Rejects if the shell gave up waiting
 * (it times the listener out) or was never asked to listen.
 *
 * The parameters are returned unread: whether they carry a `code`, an `error`,
 * or a `state` that doesn't match is the caller's to judge.
 */
export async function awaitLoopbackRedirect(): Promise<URLSearchParams> {
  const reply = await ask(AWAIT_PATH);
  if (reply.error) throw new Error(reply.error);
  return new URLSearchParams(reply.query ?? "");
}
