---
type: Fixed
title: Phantom sync conflicts on a single device
---

Cloud and folder backends now sync each note as its own file — only the notes you actually changed are uploaded, and a save raises a "changed on another device" conflict only when a note you're editing really moved remotely — so typing no longer collides with your own in-flight or lagging uploads.
