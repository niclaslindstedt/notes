# App Store / Play Store listing — source material

Raw material for writing the store listings for the **notes** native app. It
records what the native app offers **over** the web PWA (the reasons to install
it and the differentiators worth leading with), the full feature set it
inherits from the web app, and draft copy to trim into each store's fields.

Keep this honest: the native app is a thin wrapper around the web app
([`README.md`](README.md)), so almost every *feature* is shared with the free
website. What is genuinely **exclusive to the installed app** is short — but
it's real, and it's the sell. Don't claim web features (offline, encryption,
cloud sync) as app-exclusive; they aren't.

---

## What's exclusive to the app (lead with these)

These are the things the website literally cannot do, because a browser tab
can't:

1. **Self-hosted sync — your own server, no cloud, no accounts.**
   Run the tiny `notesd` daemon on a computer you own, pair the app by scanning
   a QR (or pasting a code), and your notes sync privately over your own
   network to a machine you control. The connection is locked to that server's
   own certificate (SPKI pinning), so nothing but your daemon is trusted.
   **The website can't offer this** — a browser can't validate or pin a
   self-signed certificate, so this backend exists only in the app. This is the
   flagship reason to install.

2. **Native haptics.** Real tactile feedback on gestures. Mobile browsers
   (iOS Safari / WKWebView especially) ignore web vibration entirely; the app
   restores it.

3. **A real app, not a browser tab.** Home-screen/App Library presence, no
   browser chrome, full-screen, launches instantly, and updates through the
   store you already trust. Distributed and signed via the App Store and Google
   Play.

Everything below this line is shared with the free web app — describe it to
sell the product, but don't frame it as app-only.

---

## The full product (shared with the web app)

A fast, private, local-first notes app. No account, no sign-up, no server of
ours — your notes live on your device by default and only go somewhere else if
*you* connect a place you own.

- **Write in Markdown with live preview.** Formatting appears as you type,
  Obsidian-style — every line but the one you're editing renders formatted.
- **Private by default.** Notes are stored on-device. Nothing is sent anywhere
  unless you turn on sync yourself. No ads, no analytics, no tracking.
- **Optional end-to-end encryption.** Scramble everything at rest with a
  passphrase only you hold (AES-GCM). Titles, filenames, and images all become
  unreadable; the passphrase never leaves your device.
- **Sync the way you want** — or not at all. Keep notes on-device, in a local
  folder, in your own Dropbox or Google Drive (your account, app-scoped), or on
  your own self-hosted server (app only). Edits on one device appear on your
  others on their own.
- **Attachments.** Paste or drop images and files straight into a note.
- **Organise your way.** Group notes into folders, and keep separate
  **namespaces** (e.g. Personal, Work) side by side.
- **Instant search** across every note.
- **Make it yours.** Multiple themes (light/dark and more), fonts, text size,
  and layout options.
- **Achievements.** Playful unlockables as you discover what the app can do.
- **Works offline**, always. **English and Swedish.**

---

## Draft store copy (trim to each field's limit)

> Refine before submitting. Character limits noted are Apple's; Google Play is
> more generous (short description ≤ 80, full ≤ 4000).

**App name:** notes

**Subtitle / short description** (Apple ≤ 30 chars — pick one):

- `Private notes, your way`
- `Local-first Markdown notes`
- `Notes you actually own`

**Promotional text** (Apple ≤ 170 chars):

> Fast, private Markdown notes that live on your device — not our servers. Sync
> to your own cloud, or to your own self-hosted server. Optional end-to-end
> encryption.

**Description** (Apple ≤ 4000 chars):

> notes is a fast, private place to think. Your notes live on your device by
> default — no account, no sign-up, and no server of ours ever sees them.
>
> Write in Markdown with a live preview that formats as you type. Organise with
> folders and separate namespaces, attach images and files, and find anything
> instantly with full-text search.
>
> When you want your notes on more than one device, you choose where they go —
> and it's always somewhere you control:
>
> • Your own Dropbox or Google Drive (app-scoped — it only ever touches its own
>   files).
> • A local folder on your computer.
> • **Your own self-hosted server** — run the small notesd daemon on a machine
>   you own and pair by scanning a QR. Your notes sync over your own network to
>   hardware you control, with no cloud provider and no accounts involved, over
>   a connection pinned to your server's own certificate. This is exclusive to
>   the app.
>
> Turn on end-to-end encryption and everything is scrambled at rest with a
> passphrase only you hold — titles, filenames, and images included.
>
> No ads. No analytics. No tracking. Works fully offline. English and Swedish.

**Keywords** (Apple ≤ 100 chars, comma-separated, no spaces):

> `markdown,notes,notebook,private,offline,encrypted,self-hosted,dropbox,drive,sync,writing,local`

**What's exclusive to the app** (for the description's tail, an FAQ, or the
"why upgrade from the website" note):

> The app adds what a browser can't: sync to your own self-hosted notesd server
> (a browser can't make the pinned, self-signed connection it needs), native
> haptic feedback, and a real home-screen app that updates through the store.

---

## Notes for whoever writes the final listing

- **Don't overstate app-exclusivity.** Offline, encryption, and cloud sync are
  all in the free website too. The only true app-exclusives are self-hosted
  (notesd) sync, native haptics, and store distribution. Keep that line clean
  or a reviewer (or a user) will call it out.
- **Self-hosting is a power-user hook.** Lead the differentiator with it, but
  keep the mass-market pitch (private, fast, Markdown, yours) up front — most
  buyers won't run a daemon.
- **Screenshots to capture:** the live-preview editor, the note list, the theme
  picker, the storage picker showing **Self-hosted**, and the pairing screen.
- **Privacy nutrition label:** the app collects nothing and has no backend of
  its own; any data movement is user-initiated sync to a destination the user
  owns. Mirror `src/ui/PrivacyPage.tsx`, which is the canonical statement.
- Keep this file in sync when a native-only capability is added or removed (see
  the bridge in `src/platform/native-bridge.ts` — today: haptics + pinned
  fetch).
