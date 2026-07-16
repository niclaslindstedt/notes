# Self-hosted sync (notesd)

**notesd** is a tiny server you run on a computer you own. Pair the app to it
and your notes sync privately over your own network — no cloud provider, no
accounts, and nothing of ours in the middle. It is the self-hosted alternative
to the Dropbox and Google Drive backends, for people who would rather trust
their own machine than a third party.

This backend is available **only in the installed app**, not on the website —
see [Why the app only](#why-the-app-only) below.

## What it is

`notesd` is a small single-binary daemon (its source lives in
[`notesd/`](../../notesd/README.md) in this repository). You point it at a
folder on your computer:

```sh
notesd ~/my-notes
```

On startup it prints a **QR code** (and a paste-able `notesd://pair?…` code).
In the app, open **Settings → Where your notes are stored → Self-hosted**, and
paste that code (or scan the QR). That is the whole setup.

## How your notes get there safely

- **Encrypted, pinned connection.** The daemon serves its own self-signed TLS
  certificate. The pairing code carries that certificate's fingerprint, and the
  app pins to it — so the connection is validated against *your* daemon
  specifically, not against the public certificate authorities. There is no
  window in which a stranger's certificate would be trusted.
- **Per-device key.** Pairing redeems a single-use token for a key unique to
  that device, which the daemon can revoke on its own without affecting your
  other devices. The key is held only on the device.
- **Your bytes, your machine.** The daemon stores whatever the app sends and
  nothing else. Turn on at-rest encryption and it only ever sees an encrypted
  blob.

## Why the app only

A web browser cannot validate a self-signed certificate from a page's
JavaScript, nor pin to one — so the website has no way to make the secure
connection notesd needs. The installed app can, through a small native module.
That is why **Self-hosted** appears in the app's storage picker but not on the
website, and it is one of the reasons to install the app.

## Finding your server on your other devices

Pairing once is enough per device, but you shouldn't have to hunt down the QR
again for each one. If you also have Dropbox or Google Drive connected, pairing
publishes your server's **address and certificate fingerprint** (never a key) to
a small `notesd.json` in that cloud folder. Your other devices read it and show
the server in **Settings → Self-hosted** ready to pair — you just supply a fresh
pairing code to mint that device's own key. Config comes from the cloud; your
notes still come straight from home.

Nothing secret is ever put in the cloud: the fingerprint is a public-key hash
and the address is just where the server lives, so neither grants access without
a key. That's a deliberate choice — it keeps each device's key private and
revocable.

## What syncs today

The pairing syncs your **note document** (all your notes, including any inline
image attachments) for the default namespace. Appearance settings, additional
namespaces, and separately-stored attachments stay on the device for now; those
are tracked follow-ups. Everything else about the app — the editor, themes,
search, encryption — works exactly as it does on any other backend.
