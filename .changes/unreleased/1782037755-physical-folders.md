---
type: Changed
title: Folders are real directories on disk
---

On the local-folder and cloud (Dropbox / Google Drive) backends a note filed into a folder is now stored in a real subdirectory named after that folder, so the synced folder is browsable and organized in any file manager — the note's `folder:` frontmatter is kept as the authoritative link.
