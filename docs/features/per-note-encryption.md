# Per-note, per-attachment encryption

When at-rest encryption is on, **notes** keeps every note and every attachment
as its own encrypted file rather than folding the whole document into a single
blob. This makes encryption both more private and far lighter to sync.

## What changed

- **One encrypted file per note, one encrypted blob per attachment.** Each note
  is sealed into its own file and each pasted image or file into its own blob.
  They are never bundled together, so opening a note downloads only *that*
  note's attachments — not every image in every note.
- **Compressed, then encrypted.** Note text and attachment bytes are gzip-
  compressed before sealing, so the encrypted copy is smaller than the original.
- **Opaque filenames.** Each file's name is a keyed hash, so the original title,
  filename, extension, and even which attachments belong to which note never
  appear in your cloud folder.
- **On-demand attachments.** The note list loads without any attachment bytes;
  an image's bytes are fetched only when you open the note that shows it.
- **A green lock you can watch fill in.** Turning encryption on starts a paced
  background migration that seals one note at a time (so it never floods the
  cloud API). Each note shows a green lock in the overview and the side menu the
  moment it — and all of its attachments — are fully encrypted at rest.
- **Atomic, lossless conversion.** Every conversion writes the new encrypted
  copy and verifies it can be read back *before* the old copy is removed. An
  interruption — a crash, a closed tab, a dropped connection — at worst leaves
  both copies; the next run finishes the job. No note or attachment can be lost.

## Unlocking

The passphrase is held only for the session. After a reload the app is locked
until you re-enter it; the offline cache keeps a sealed copy so you can unlock
and read your notes even with no connection.

Turning encryption off reverses the whole process, decrypting every note and
attachment back to plain files — just as carefully, with no data loss.
