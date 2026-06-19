# Live note sync

When you've connected a **folder, Dropbox, or Google Drive** backend, notes
keeps itself up to date with that backend on its own. Every few seconds it
checks the backend for changes and pulls in anything new — so an edit you make
on one device shows up on your others without a manual refresh, even while you
have the note open in the editor. Write on your laptop and watch the words
appear on your phone.

## How it works

1. **Connect a folder or cloud backend** in **Settings → Storage**. (The
   default "This device" backend has nothing to sync from, so live sync only
   runs on the folder and cloud backends.)
2. notes polls the backend on a fixed cadence — about every ten seconds. It
   pulls the file metadata first and downloads only the notes whose contents
   actually changed, so the check stays cheap.
3. When the backend has a newer version of a note, it replaces what's on
   screen. If that note is the one you have open, the editor updates in place.

## It never overwrites what you're writing

A pull only lands once a note has sat **quiet for the full window** — roughly
ten seconds with no keystroke — and only when there's nothing unsaved, no open
sync conflict, and no save still in flight. So your own typing always wins:
notes waits for a natural pause before adopting a remote change, and it never
yanks a half-typed line out from under you. If two devices are editing the same
note at the same moment, that's still a sync conflict and you get to choose
which copy to keep.
