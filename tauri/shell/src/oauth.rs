// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! The loopback OAuth redirect — the decisions half.
//!
//! The one thing a web page cannot do for itself. The app is served from the
//! `notes:` scheme, and no OAuth provider will register a custom scheme as a
//! redirect URI. The way out is the one RFC 8252 prescribes for native apps:
//! send the user to the provider in their real browser, and catch the redirect
//! on a loopback listener the app opens for the occasion.
//!
//! The shell holds the socket and nothing else. It does not know which
//! provider is being connected, what scopes were asked for, or what the code
//! is worth — the framework's `runLoopbackAuth` builds the authorization URL,
//! checks `state`, and trades the code for tokens. The shell answers two questions,
//! on two reserved paths of the app's own scheme: "what URI can I be
//! redirected to?" and "what came back?". The page reaches them with a plain
//! `fetch` (the framework's `desktop-loopback.ts`, which owns the same two
//! paths).

use std::time::Duration;

/// Opens the listener and answers with the redirect URI.
pub const BEGIN_PATH: &str = "/__oauth/begin";

/// Answers once the redirect lands — or once the listener gives up.
pub const AWAIT_PATH: &str = "/__oauth/await";

/// A fixed, tiny set rather than an ephemeral port: providers match redirect
/// URIs exactly, so every port the app might use has to be registered on the
/// OAuth app up front (see `src/storage/dropbox/index.ts`). Three is enough
/// slack for something else already holding the first one, and few enough to
/// register by hand.
pub const LOOPBACK_PORTS: [u16; 3] = [53682, 53683, 53684];

/// Long enough to find the browser window, sign in, and approve; short enough
/// that an abandoned flow does not leave a socket open for the session. The
/// listener also closes the moment a redirect arrives.
pub const LOOPBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Shown in the browser tab the provider redirected. Deliberately plain and
/// self-contained: it is served by a socket that is about to close, so it can
/// reference nothing.
pub const DONE_PAGE: &str = "<!doctype html><html lang=\"en\"><head>\
<meta charset=\"utf-8\"><title>Signed in</title>\
<style>html{color-scheme:dark light}body{margin:0;min-height:100vh;display:flex;\
align-items:center;justify-content:center;background:#0e1116;color:#e6edf3;\
font:16px/1.5 system-ui,sans-serif}p{text-align:center;padding:2rem}</style>\
</head><body><p>You&rsquo;re connected.<br>You can close this tab.</p></body></html>";

/// The URI the provider is told to redirect to. Bound to `127.0.0.1` — never
/// `0.0.0.0`, which would put a listener holding a live authorization code on
/// the local network — and with the trailing slash the providers match on.
pub fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}/")
}

/// The query string of the request the browser sent the listener, given the
/// request's head, or `None` when this is not the redirect.
///
/// Browsers ask for `/favicon.ico` off their own bat, and anything without a
/// query string is not the redirect, so it must not end the wait.
pub fn redirect_query(request_head: &str) -> Option<String> {
    let line = request_head.lines().next()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    if method != "GET" {
        return None;
    }
    let (_, query) = target.split_once('?')?;
    let query = query.split('#').next().unwrap_or("");
    (!query.is_empty()).then(|| query.to_string())
}

/// `{"redirectUri": …}` — the answer to [`BEGIN_PATH`].
pub fn begin_reply(uri: &str) -> String {
    format!("{{\"redirectUri\":{}}}", json_string(uri))
}

/// `{"query": …}` — the answer to [`AWAIT_PATH`] once the redirect landed.
pub fn query_reply(query: &str) -> String {
    format!("{{\"query\":{}}}", json_string(query))
}

/// `{"error": …}` — the answer to either path when the flow cannot go on.
pub fn error_reply(message: &str) -> String {
    format!("{{\"error\":{}}}", json_string(message))
}

/// A JSON string literal. The replies are three fields of plain text, spelled
/// out here so their format reads at a glance beside the page's side of it; the
/// query is whatever the provider sent, so it is escaped rather than trusted.
fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
