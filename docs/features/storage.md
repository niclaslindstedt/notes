# Storage backends

`notes` runs entirely in your browser and has no server of its own — so where
your notes are kept is **your** choice, and they only ever go to a place you
control. Open **Settings → Where your notes are stored** and pick one:

- **This device** — the default. Notes are kept in this browser's local
  storage. Nothing leaves the device.
- **Local folder** — pick a folder on your computer and `notes` writes each
  note as its own markdown file inside it (one `.md` per note, named after the
  note's first line). The files are plain text: open them in any editor, render
  them on GitHub, or keep the folder in git. Available in Chromium-based
  browsers (Chrome, Edge, Brave, Arc); hidden where the File System Access API
  isn't supported.
- **Dropbox** / **Google Drive** — sign in through the provider's own screen
  and `notes` keeps your notes in that account from then on, ready to pick up on
  your next device. Each note is stored as a markdown file in the app's folder,
  so you can read and edit them straight from Dropbox or Drive too.

However you store them, your notes are saved as **one markdown file per note**,
so they stay readable and portable outside the app.

## Encryption

You can lock your notes down at the same time. Turn on **encryption** with a
passphrase and your notes are scrambled (AES-GCM) before they're ever written.
The passphrase itself never leaves your device and is never stored anywhere —
there is no recovery, so if you forget it the notes can't be read. After a
reload the app asks you to re-enter it before showing your notes. Your
appearance settings stay readable either way, so the unlock screen still wears
your theme.

## Working offline and conflicts

A cloud backend keeps a copy of your notes on the device you're using, so on a
plane or in a tunnel you can still open the app, read, and write — your changes
are held on the device and sync back up automatically when you're online again.
The header sync chip shows when you're synced, when a save is in flight, when
you're on the offline copy, and when something needs your attention; tap it for
details and the action to fix it (reconnect, try again, save now).

Because two devices can edit the same notes at once, the app watches for
collisions. When one happens, a **conflict** prompt asks which copy to keep;
nothing is merged behind your back.

## Settings travel too

Your appearance settings (theme, font, custom-theme tweaks) are written
alongside the notes as a `settings.json` file at the backend's root, so they
follow a synced or shared folder onto your other devices. They're kept as plain
JSON even when the notes are encrypted — theme choices aren't secret, and
keeping them readable is what lets the unlock screen render in your theme.

## Configuring the cloud backends

The Dropbox and Google Drive options only appear when their app credentials are
built in. Set them at build time (see `.env.example`):

- `VITE_DROPBOX_APP_KEY` — a Dropbox "Scoped access / App folder" app key.
- `VITE_GOOGLE_CLIENT_ID` — a Google OAuth client id with the Drive API
  enabled.

Unset, each backend is simply hidden from the picker; This device, Local folder,
and encryption work without any configuration.

For the **deployed** app these are read from GitHub Actions secrets of the same
name (`VITE_DROPBOX_APP_KEY`, `VITE_GOOGLE_CLIENT_ID`). Adding the secrets is
not enough on its own — Actions does not expose secrets to steps automatically,
so each `npm run build` step in `.github/workflows/pages.yml` maps them into its
`env:`. If you add a new build step or workflow that ships a deploy, map both
secrets there too or that build will silently disable the cloud backends.
