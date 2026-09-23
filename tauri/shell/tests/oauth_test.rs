// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! The loopback OAuth redirect's decisions (`notes_shell::oauth`).
//!
//! The page owns the other side of both paths and the provider owns the list
//! of redirect URIs, so the constants here are contracts rather than choices:
//! a drift is a sign-in that fails at the consent screen or a fetch that 404s.

use notes_shell::oauth::{
    begin_reply, error_reply, query_reply, redirect_query, redirect_uri, AWAIT_PATH, BEGIN_PATH,
    LOOPBACK_PORTS,
};

#[test]
fn the_paths_are_the_ones_the_page_asks_on() {
    // The framework's `LOOPBACK_BEGIN_PATH` / `LOOPBACK_AWAIT_PATH` spell these too.
    assert_eq!(BEGIN_PATH, "/__oauth/begin");
    assert_eq!(AWAIT_PATH, "/__oauth/await");
}

#[test]
fn the_ports_are_the_ones_registered_on_the_provider() {
    // Dropbox matches redirect URIs exactly; these three are on its allowlist.
    assert_eq!(LOOPBACK_PORTS, [53682, 53683, 53684]);
    assert_eq!(redirect_uri(53682), "http://127.0.0.1:53682/");
}

#[test]
fn the_redirect_is_the_request_with_a_query() {
    let head = "GET /?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n";
    assert_eq!(redirect_query(head).as_deref(), Some("code=abc&state=xyz"));
}

#[test]
fn a_decline_is_still_the_redirect() {
    // The page judges what came back; an error is an answer, not noise.
    let head = "GET /?error=access_denied&state=xyz HTTP/1.1\r\n\r\n";
    assert_eq!(
        redirect_query(head).as_deref(),
        Some("error=access_denied&state=xyz")
    );
}

#[test]
fn the_browsers_own_requests_do_not_end_the_wait() {
    assert_eq!(redirect_query("GET /favicon.ico HTTP/1.1\r\n\r\n"), None);
    assert_eq!(redirect_query("GET / HTTP/1.1\r\n\r\n"), None);
    assert_eq!(redirect_query("GET /? HTTP/1.1\r\n\r\n"), None);
    assert_eq!(redirect_query("POST /?code=a HTTP/1.1\r\n\r\n"), None);
    assert_eq!(redirect_query(""), None);
}

#[test]
fn a_fragment_is_not_part_of_the_query() {
    assert_eq!(
        redirect_query("GET /?code=a#frag HTTP/1.1\r\n\r\n").as_deref(),
        Some("code=a")
    );
}

#[test]
fn the_replies_are_json_the_page_can_read() {
    assert_eq!(
        begin_reply("http://127.0.0.1:53682/"),
        r#"{"redirectUri":"http://127.0.0.1:53682/"}"#
    );
    assert_eq!(
        query_reply("code=a&state=b"),
        r#"{"query":"code=a&state=b"}"#
    );
    assert_eq!(error_reply("no flow"), r#"{"error":"no flow"}"#);
}

#[test]
fn whatever_the_provider_sent_cannot_break_out_of_the_reply() {
    assert_eq!(
        query_reply("a\"b\\c\nd\u{1}"),
        r#"{"query":"a\"b\\c\nd\u0001"}"#
    );
}
