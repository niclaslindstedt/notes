---
type: Changed
title: Note files now live in a notes/ subfolder
---

On the folder and cloud backends each note's markdown file is now stored under a `notes/` subfolder (`<namespace>/notes/` for a namespace you created), apart from the `settings.json` beside it — existing notes kept at the old location won't appear until their `.md` files are moved into the new folder.
