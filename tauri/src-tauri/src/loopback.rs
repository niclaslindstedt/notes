// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! The loopback OAuth redirect — the effects half of `notes_shell::oauth`,
//! which owns every decision this file acts on: the paths, the ports, the
//! timeout, what counts as the redirect, and the shape of every reply.
//!
//! One flow at a time. The socket and the flow's RESULT are deliberately
//! separate lifetimes: the listener closes the instant a redirect lands, but
//! the result has to outlive it — the page asks for the redirect URI, opens
//! the browser, and only then asks what came back, and a provider the user
//! has already authorized can redirect inside that gap. Tying the two together
//! would drop exactly the fastest, most ordinary sign-in on the floor.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notes_shell::oauth::{
    begin_reply, error_reply, query_reply, redirect_query, redirect_uri, DONE_PAGE, LOOPBACK_PORTS,
    LOOPBACK_TIMEOUT,
};

/// A flow's answer, once there is one: the JSON the await path replies with.
type Outcome = Arc<(Mutex<Option<String>>, Condvar)>;

struct Flow {
    /// Set to stop the listener — a later flow supersedes this one.
    cancel: Arc<AtomicBool>,
    outcome: Outcome,
}

static FLOW: Mutex<Option<Flow>> = Mutex::new(None);

fn settle(outcome: &Outcome, reply: String) {
    let (slot, ready) = &**outcome;
    if let Ok(mut value) = slot.lock() {
        if value.is_none() {
            *value = Some(reply);
            ready.notify_all();
        }
    }
}

/// Open a one-shot listener and answer with the redirect URI (as the JSON the
/// begin path replies with). Replaces any flow already waiting: a second
/// connect attempt supersedes the first, and two sockets waiting for one
/// redirect is never right.
pub fn begin() -> String {
    let Ok(mut current) = FLOW.lock() else {
        return error_reply("the sign-in state is unavailable");
    };
    if let Some(previous) = current.take() {
        previous.cancel.store(true, Ordering::SeqCst);
        settle(
            &previous.outcome,
            error_reply("superseded by a new sign-in"),
        );
    }

    let Some((listener, port)) = LOOPBACK_PORTS.iter().find_map(|&port| {
        TcpListener::bind(("127.0.0.1", port))
            .ok()
            .map(|listener| (listener, port))
    }) else {
        return error_reply("no loopback port available");
    };
    if listener.set_nonblocking(true).is_err() {
        return error_reply("could not listen for the redirect");
    }

    let flow = Flow {
        cancel: Arc::new(AtomicBool::new(false)),
        outcome: Arc::new((Mutex::new(None), Condvar::new())),
    };
    let cancel = Arc::clone(&flow.cancel);
    let outcome = Arc::clone(&flow.outcome);
    thread::spawn(move || listen(listener, cancel, outcome));
    *current = Some(flow);
    begin_reply(&redirect_uri(port))
}

/// Wait for the current flow's answer. Blocks — call it off the main thread.
/// A wait with no flow behind it is a bug in the page rather than a redirect
/// that will arrive, so it answers at once instead of hanging.
pub fn wait() -> String {
    let outcome = match FLOW.lock() {
        Ok(current) => match current.as_ref() {
            Some(flow) => Arc::clone(&flow.outcome),
            None => return error_reply("no flow"),
        },
        Err(_) => return error_reply("the sign-in state is unavailable"),
    };
    let (slot, ready) = &*outcome;
    let Ok(mut value) = slot.lock() else {
        return error_reply("the sign-in state is unavailable");
    };
    while value.is_none() {
        value = match ready.wait(value) {
            Ok(value) => value,
            Err(_) => return error_reply("the sign-in state is unavailable"),
        };
    }
    value.clone().unwrap_or_else(|| error_reply("no answer"))
}

fn listen(listener: TcpListener, cancel: Arc<AtomicBool>, outcome: Outcome) {
    let deadline = Instant::now() + LOOPBACK_TIMEOUT;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        if Instant::now() >= deadline {
            settle(
                &outcome,
                error_reply("timed out waiting for the authorization redirect"),
            );
            return;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(query) = answer(stream) {
                    settle(&outcome, query_reply(&query));
                    // Dropping the listener here closes the socket; the result
                    // stays readable in `FLOW` until the page asks for it.
                    return;
                }
            }
            Err(err) if err.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => thread::sleep(Duration::from_millis(50)),
        }
    }
}

/// Read one request and answer it: the done page for the redirect, a 404 for
/// anything else (the browser's own favicon request, say). The page is written
/// and flushed BEFORE the flow settles — closing tears the socket down, and
/// the browser has to have the page first or the user is left looking at a
/// connection error after a successful sign-in.
fn answer(mut stream: TcpStream) -> Option<String> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut head = Vec::new();
    let mut buf = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") && head.len() < 16 * 1024 {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => head.extend_from_slice(&buf[..n]),
        }
    }
    let query = redirect_query(&String::from_utf8_lossy(&head));
    let response = match &query {
        Some(_) => format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{DONE_PAGE}",
            DONE_PAGE.len()
        ),
        None => {
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
        }
    };
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    query
}

#[cfg(test)]
mod tests {
    use super::{begin, wait};
    use std::io::{Read, Write};
    use std::net::TcpStream;

    fn port_of(reply: &str) -> u16 {
        let start = reply.find("127.0.0.1:").expect("a loopback URI") + "127.0.0.1:".len();
        reply[start..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>()
            .parse()
            .expect("a port")
    }

    fn get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("the listener");
        write!(stream, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    /// The whole round trip, on a real socket: begin, the browser's own
    /// favicon request (which must not end the wait), the redirect, and the
    /// answer the page reads — asked for AFTER the redirect landed, which is
    /// the fastest, most ordinary sign-in there is.
    #[test]
    fn a_redirect_reaches_the_page_even_when_it_lands_first() {
        let reply = begin();
        assert!(reply.contains("redirectUri"), "{reply}");
        let port = port_of(&reply);

        assert!(get(port, "/favicon.ico").starts_with("HTTP/1.1 404"));
        let page = get(port, "/?code=abc&state=xyz");
        assert!(page.starts_with("HTTP/1.1 200"));
        assert!(page.contains("You can close this tab"));

        assert_eq!(wait(), r#"{"query":"code=abc&state=xyz"}"#);
        // The listener closed once the redirect landed.
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    }
}
